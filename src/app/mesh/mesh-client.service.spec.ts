import { TestBed } from '@angular/core/testing';
import { Types } from '@meshtastic/core';
import { MeshClientService, MeshStatus, MeshTextMessage } from './mesh-client.service';
import { MESH_DEVICE_FACTORY, MESH_TRANSPORT_FACTORY, MeshDeviceLike, WEB_SERIAL_SUPPORTED } from './mesh-tokens';
import { NodeStoreService } from './node-store.service';

const SELF = 0x0acb0984;
const OTHER = 0x11111111;
const rxTime = new Date('2026-10-18T10:00:00Z');

/** Minimal stand-in for ste-simple-events' SimpleEventDispatcher. */
class FakeDispatcher<T> {
  private handlers: Array<(value: T) => void> = [];
  subscribe(fn: (value: T) => void): () => void {
    this.handlers.push(fn);
    return () => { this.handlers = this.handlers.filter(h => h !== fn); };
  }
  dispatch(value: T): void {
    this.handlers.forEach(h => h(value));
  }
  get count(): number { return this.handlers.length; }
}

class FakeDevice {
  events = {
    onMyNodeInfo: new FakeDispatcher<unknown>(),
    onNodeInfoPacket: new FakeDispatcher<unknown>(),
    onPositionPacket: new FakeDispatcher<unknown>(),
    onTelemetryPacket: new FakeDispatcher<unknown>(),
    onUserPacket: new FakeDispatcher<unknown>(),
    onMessagePacket: new FakeDispatcher<unknown>(),
    onDeviceStatus: new FakeDispatcher<Types.DeviceStatusEnum>(),
  };
  configureCalls = 0;
  sent: Array<{ text: string; to: unknown }> = [];
  configure(): Promise<number> { this.configureCalls++; return Promise.resolve(1); }
  sendText(text: string, to?: unknown): Promise<number> { this.sent.push({ text, to }); return Promise.resolve(42); }
  disconnect(): Promise<void> { return Promise.resolve(); }
}

describe('MeshClientService', () => {
  let devices: FakeDevice[];
  let transportCalls: number;

  function setup(webSerial = true): { client: MeshClientService; store: NodeStoreService } {
    devices = [];
    transportCalls = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: WEB_SERIAL_SUPPORTED, useValue: webSerial },
        { provide: MESH_TRANSPORT_FACTORY, useValue: () => { transportCalls++; return Promise.resolve({} as Types.Transport); } },
        {
          provide: MESH_DEVICE_FACTORY,
          useValue: () => {
            const d = new FakeDevice();
            devices.push(d);
            return d as unknown as MeshDeviceLike;
          },
        },
      ],
    });
    return { client: TestBed.inject(MeshClientService), store: TestBed.inject(NodeStoreService) };
  }

  const device = (): FakeDevice => devices[devices.length - 1];

  it('configures the device once and reports connected after DeviceConfigured', async () => {
    const { client } = setup();
    const statuses: MeshStatus[] = [];
    client.status$.subscribe(s => statuses.push(s));

    await client.connect();
    device().events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceConfigured);

    expect(device().configureCalls).toBe(1);
    expect(statuses).toEqual(['disconnected', 'connecting', 'configuring', 'connected']);
  });

  it('puts position packets into the node store', async () => {
    const { client, store } = setup();
    await client.connect();

    device().events.onPositionPacket.dispatch({
      from: SELF, rxTime, data: { latitudeI: 510447000, longitudeI: -1140719000 },
    });

    const node = store.snapshot().find(n => n.num === SELF);
    expect(node?.lat).toBe(51.0447);
    expect(node?.lng).toBe(-114.0719);
  });

  it('fills the store from node info records', async () => {
    const { client, store } = setup();
    await client.connect();

    device().events.onNodeInfoPacket.dispatch({
      num: OTHER, snr: 5, lastHeard: 1792300000, hopsAway: 2,
      user: { shortName: 'KID', longName: 'Kid backpack' },
      position: { latitudeI: 510000000, longitudeI: -1140000000 },
      deviceMetrics: { batteryLevel: 64, voltage: 3.8 },
    });

    const node = store.snapshot().find(n => n.num === OTHER);
    expect(node?.shortName).toBe('KID');
    expect(node?.battery).toBe(64);
    expect(node?.hopsAway).toBe(2);
    expect(node?.lat).toBe(51);
  });

  it('takes battery from device-metrics telemetry only', async () => {
    const { client, store } = setup();
    await client.connect();

    device().events.onTelemetryPacket.dispatch({
      from: OTHER, rxTime, data: { variant: { case: 'deviceMetrics', value: { batteryLevel: 71, voltage: 3.9 } } },
    });
    device().events.onTelemetryPacket.dispatch({
      from: OTHER, rxTime, data: { variant: { case: 'environmentMetrics', value: { temperature: 4 } } },
    });

    const node = store.snapshot().find(n => n.num === OTHER);
    expect(node?.battery).toBe(71);
    expect(node?.voltage).toBe(3.9);
  });

  it('updates names from user packets', async () => {
    const { client, store } = setup();
    await client.connect();

    device().events.onUserPacket.dispatch({ from: OTHER, rxTime, data: { shortName: 'DAD', longName: 'Dad' } });

    expect(store.snapshot().find(n => n.num === OTHER)?.shortName).toBe('DAD');
  });

  it('records its own node number and marks that node as self', async () => {
    const { client, store } = setup();
    await client.connect();

    device().events.onPositionPacket.dispatch({ from: SELF, rxTime, data: { latitudeI: 510447000, longitudeI: -1140719000 } });
    device().events.onMyNodeInfo.dispatch({ myNodeNum: SELF });

    expect(client.myNodeNum$.value).toBe(SELF);
    expect(store.snapshot().find(n => n.num === SELF)?.isSelf).toBeTrue();
  });

  it('emits text from other nodes and ignores its own echo', async () => {
    const { client } = setup();
    const received: MeshTextMessage[] = [];
    client.messages$.subscribe(m => received.push(m));
    await client.connect();
    device().events.onMyNodeInfo.dispatch({ myNodeNum: SELF });

    device().events.onMessagePacket.dispatch({ id: 1, from: OTHER, to: 0xffffffff, rxTime, data: 'hello' });
    device().events.onMessagePacket.dispatch({ id: 2, from: SELF, to: 0xffffffff, rxTime, data: 'mine' });

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ id: 1, from: OTHER, to: 0xffffffff, text: 'hello', at: rxTime, direction: 'incoming' });
  });

  it('sends text through the device', async () => {
    const { client } = setup();
    await client.connect();
    device().events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceConfigured);

    const id = await client.sendText('hi', OTHER);

    expect(id).toBe(42);
    expect(device().sent).toEqual([{ text: 'hi', to: OTHER }]);
  });

  it('refuses to send while not connected', async () => {
    const { client } = setup();

    await expectAsync(client.sendText('hi')).toBeRejectedWithError('Not connected to a device');
  });

  it('keeps known nodes when the board is unplugged and can connect again', async () => {
    const { client, store } = setup();
    await client.connect();
    const first = device();
    first.events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceConfigured);
    first.events.onPositionPacket.dispatch({ from: OTHER, rxTime, data: { latitudeI: 510000000, longitudeI: -1140000000 } });

    first.events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceDisconnected);

    expect(client.status$.value).toBe('disconnected');
    expect(store.snapshot().length).toBe(1);
    expect(first.events.onPositionPacket.count).toBe(0);

    await client.connect();
    expect(devices.length).toBe(2);
    expect(client.status$.value).toBe('configuring');
  });

  it('reports unsupported without Web Serial and never opens a port', async () => {
    const { client } = setup(false);

    expect(client.status$.value).toBe('unsupported');
    await client.connect();
    expect(transportCalls).toBe(0);
    expect(client.status$.value).toBe('unsupported');
  });

  it('reports an error when the port cannot be opened', async () => {
    devices = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: WEB_SERIAL_SUPPORTED, useValue: true },
        { provide: MESH_TRANSPORT_FACTORY, useValue: () => Promise.reject(new Error('No port selected')) },
        { provide: MESH_DEVICE_FACTORY, useValue: () => new FakeDevice() as unknown as MeshDeviceLike },
      ],
    });
    const client = TestBed.inject(MeshClientService);

    await client.connect();

    expect(client.status$.value).toBe('error');
  });
});
