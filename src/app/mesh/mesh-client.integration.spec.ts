import { TestBed } from '@angular/core/testing';
import { create, toBinary } from '@bufbuild/protobuf';
import { MeshDevice, Protobuf, Types } from '@meshtastic/core';
import { MeshClientService } from './mesh-client.service';
import { MESH_DEVICE_FACTORY, MESH_TRANSPORT_FACTORY, WEB_SERIAL_SUPPORTED } from './mesh-tokens';
import { NodeStoreService } from './node-store.service';

/**
 * Runs MeshClientService against the real MeshDevice from @meshtastic/core over
 * an in-memory transport, so the library's own decoding and replay behaviour is
 * what the assertions see.
 */

const SELF = 0x0acb0984;
const OTHER = 0x11111111;
const CONFIG_ID = 4321;
const THREE_HOURS_AGO = Math.floor(Date.now() / 1000) - 3 * 3600;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function fromRadio(variant: Protobuf.Mesh.FromRadio['payloadVariant']): { type: 'packet'; data: Uint8Array } {
  return {
    type: 'packet',
    data: toBinary(Protobuf.Mesh.FromRadioSchema, create(Protobuf.Mesh.FromRadioSchema, { payloadVariant: variant })),
  };
}

class MemoryTransport {
  private controller!: ReadableStreamDefaultController<unknown>;
  readonly fromDevice = new ReadableStream<unknown>({ start: c => { this.controller = c; } });
  readonly toDevice = new WritableStream<Uint8Array>();
  push(chunk: unknown): void { this.controller.enqueue(chunk); }
  disconnect(): Promise<void> { return Promise.resolve(); }
}

describe('MeshClientService with the real MeshDevice', () => {
  let transport: MemoryTransport;
  let client: MeshClientService;
  let store: NodeStoreService;

  beforeEach(() => {
    transport = new MemoryTransport();
    TestBed.configureTestingModule({
      providers: [
        { provide: WEB_SERIAL_SUPPORTED, useValue: true },
        { provide: MESH_TRANSPORT_FACTORY, useValue: () => Promise.resolve(transport as unknown as Types.Transport) },
        { provide: MESH_DEVICE_FACTORY, useValue: (t: Types.Transport) => new MeshDevice(t, CONFIG_ID) },
      ],
    });
    client = TestBed.inject(MeshClientService);
    store = TestBed.inject(NodeStoreService);
  });

  afterEach(async () => {
    await client.disconnect();
  });

  async function configure(): Promise<void> {
    void client.connect();
    await flush();
    transport.push(fromRadio({ case: 'myInfo', value: create(Protobuf.Mesh.MyNodeInfoSchema, { myNodeNum: SELF }) }));
    transport.push(fromRadio({
      case: 'nodeInfo',
      value: create(Protobuf.Mesh.NodeInfoSchema, {
        num: OTHER,
        lastHeard: THREE_HOURS_AGO,
        user: { shortName: 'KID', longName: 'Kid backpack' },
        position: { latitudeI: 510000000, longitudeI: -1140000000 },
      }),
    }));
    transport.push(fromRadio({ case: 'configCompleteId', value: CONFIG_ID }));
    await flush();
  }

  it('loads the node database and reports connected when configuration completes', async () => {
    await configure();

    expect(client.status$.value).toBe('connected');
    expect(client.myNodeNum$.value).toBe(SELF);
    const kid = store.snapshot().find(n => n.num === OTHER);
    expect(kid?.shortName).toBe('KID');
    expect(kid?.lat).toBe(51);
  });

  it('keeps the last-heard time from the node database instead of the replay time', async () => {
    await configure();

    const kid = store.snapshot().find(n => n.num === OTHER);
    expect(kid?.lastHeard).toEqual(new Date(THREE_HOURS_AGO * 1000));
  });

  it('notices when the transport reports the board was unplugged', async () => {
    await configure();

    transport.push({ type: 'status', data: { status: Types.DeviceStatusEnum.DeviceDisconnected, reason: 'serial-disconnected' } });
    await flush();

    expect(client.status$.value).toBe('disconnected');
    expect(store.snapshot().length).toBeGreaterThan(0);
  });
});
