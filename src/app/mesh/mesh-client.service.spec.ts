import { TestBed, discardPeriodicTasks, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Types } from '@meshtastic/core';
import { DeviceLogLine, MeshClientService, MeshStatus, MeshTextMessage } from './mesh-client.service';
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

/** When set, the next FakeDevice's configure() returns this promise. */
let nextConfigure: Promise<number> | null = null;

class FakeDevice {
  events = {
    onMyNodeInfo: new FakeDispatcher<unknown>(),
    onNodeInfoPacket: new FakeDispatcher<unknown>(),
    onPositionPacket: new FakeDispatcher<unknown>(),
    onTelemetryPacket: new FakeDispatcher<unknown>(),
    onUserPacket: new FakeDispatcher<unknown>(),
    onMessagePacket: new FakeDispatcher<unknown>(),
    onDeviceStatus: new FakeDispatcher<Types.DeviceStatusEnum>(),
    onLogRecord: new FakeDispatcher<unknown>(),
  };
  configureCalls = 0;
  heartbeats = 0;
  sent: Array<{ text: string; to: unknown }> = [];
  configureResult: Promise<number> = nextConfigure ?? Promise.resolve(1);
  disconnectResult: Promise<void> = Promise.resolve();
  configure(): Promise<number> { this.configureCalls++; return this.configureResult; }
  heartbeat(): Promise<number> { this.heartbeats++; return Promise.resolve(1); }
  sendText(text: string, to?: unknown): Promise<number> { this.sent.push({ text, to }); return Promise.resolve(42); }
  disconnect(): Promise<void> { return this.disconnectResult; }
}

/** Raw transport whose incoming stream the test controls. */
class FakeTransport {
  disconnects = 0;
  private controller!: ReadableStreamDefaultController<unknown>;
  readonly fromDevice = new ReadableStream<unknown>({ start: c => { this.controller = c; } });
  readonly toDevice = new WritableStream<Uint8Array>();
  disconnect(): Promise<void> { this.disconnects++; return Promise.resolve(); }
  emitStatus(status: Types.DeviceStatusEnum, reason?: string): void {
    this.controller.enqueue({ type: 'status', data: { status, reason } });
  }
}

describe('MeshClientService', () => {
  let devices: FakeDevice[];
  let transports: FakeTransport[];
  let transportCalls: number;

  function setup(webSerial = true): { client: MeshClientService; store: NodeStoreService } {
    devices = [];
    nextConfigure = null;
    transports = [];
    transportCalls = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: WEB_SERIAL_SUPPORTED, useValue: webSerial },
        {
          provide: MESH_TRANSPORT_FACTORY,
          useValue: () => {
            transportCalls++;
            const t = new FakeTransport();
            transports.push(t);
            return Promise.resolve(t as unknown as Types.Transport);
          },
        },
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
  const transport = (): FakeTransport => transports[transports.length - 1];
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it('pings the device every minute once configured and stops after disconnect', fakeAsync(() => {
    const { client } = setup();
    void client.connect();
    flushMicrotasks();
    device().events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceConfigured);

    tick(60_000);
    expect(device().heartbeats).toBe(1);
    tick(60_000);
    expect(device().heartbeats).toBe(2);

    void client.disconnect();
    flushMicrotasks();
    tick(180_000);
    expect(device().heartbeats).toBe(2);
    discardPeriodicTasks();
  }));

  it('treats a disconnect reported by the transport as an unplug', async () => {
    const { client, store } = setup();
    await client.connect();
    device().events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceConfigured);
    device().events.onPositionPacket.dispatch({ from: OTHER, rxTime, data: { latitudeI: 510000000, longitudeI: -1140000000 } });

    transport().emitStatus(Types.DeviceStatusEnum.DeviceDisconnected, 'serial-disconnected');
    await flush();

    expect(client.status$.value).toBe('disconnected');
    expect(transport().disconnects).toBeGreaterThan(0);
    expect(store.snapshot().length).toBe(1);
    expect(device().events.onPositionPacket.count).toBe(0);
  });

  it('closes the port and can reconnect even when the device fails to disconnect', async () => {
    const { client } = setup();
    await client.connect();
    device().disconnectResult = Promise.reject(new Error('stream is locked'));

    await client.disconnect();

    expect(client.status$.value).toBe('disconnected');
    expect(transport().disconnects).toBeGreaterThan(0);
    await client.connect();
    expect(transportCalls).toBe(2);
  });

  it('ignores a late configure failure after the user disconnected', async () => {
    const { client } = setup();
    let failConfigure!: (e: Error) => void;
    nextConfigure = new Promise<number>((_, reject) => { failConfigure = reject; });
    const connecting = client.connect();
    await flush();

    await client.disconnect();
    failConfigure(new Error('Packet does not exist'));
    await connecting;

    expect(client.status$.value).toBe('disconnected');
  });

  it('does not mark nodes as heard from the replay during configuration', async () => {
    const { client, store } = setup();
    await client.connect();
    expect(client.status$.value).toBe('configuring');

    device().events.onNodeInfoPacket.dispatch({ num: OTHER, snr: 0, lastHeard: 1792300000, user: { shortName: 'KID', longName: 'Kid' } });
    device().events.onPositionPacket.dispatch({ from: OTHER, to: OTHER, rxTime: new Date(), data: { latitudeI: 510000000, longitudeI: -1140000000 } });
    device().events.onUserPacket.dispatch({ from: OTHER, to: OTHER, rxTime: new Date(), data: { shortName: 'KID', longName: 'Kid' } });

    expect(store.snapshot().find(n => n.num === OTHER)?.lastHeard).toEqual(new Date(1792300000 * 1000));
  });

  it('uses the arrival time when the device clock is unset', async () => {
    const { client, store } = setup();
    await client.connect();
    device().events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceConfigured);
    const before = Date.now();

    device().events.onPositionPacket.dispatch({ from: OTHER, rxTime: new Date(0), data: { latitudeI: 510000000, longitudeI: -1140000000 } });

    const heard = store.snapshot().find(n => n.num === OTHER)?.lastHeard.getTime() ?? 0;
    expect(heard).toBeGreaterThanOrEqual(before);
  });

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

  it('streams the device log records', async () => {
    const { client } = setup();
    const lines: DeviceLogLine[] = [];
    client.deviceLog$.subscribe(l => lines.push(l));
    await client.connect();

    device().events.onLogRecord.dispatch({ message: 'New GPS pos', source: 'GPS', time: 1792300000, level: 20 });

    expect(lines).toEqual([{ at: new Date(1792300000 * 1000), source: 'GPS', message: 'New GPS pos' }]);
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
