import { Types } from '@meshtastic/core';
import { tapTransportStatus } from './status-tap';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function rawTransport() {
  let controller!: ReadableStreamDefaultController<unknown>;
  const fromDevice = new ReadableStream<unknown>({ start: c => { controller = c; } });
  const toDevice = new WritableStream<Uint8Array>();
  const state = { disconnects: 0 };
  const transport = {
    fromDevice,
    toDevice,
    disconnect: () => { state.disconnects++; return Promise.resolve(); },
  } as unknown as Types.Transport;
  return { transport, controller: () => controller, state };
}

async function readN(stream: ReadableStream<unknown>, n: number): Promise<unknown[]> {
  const reader = stream.getReader();
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) out.push((await reader.read()).value);
  reader.releaseLock();
  return out;
}

describe('tapTransportStatus', () => {
  it('passes packets and debug lines through and reports status chunks instead of forwarding them', async () => {
    const raw = rawTransport();
    const statuses: Types.DeviceStatusEnum[] = [];
    const tapped = tapTransportStatus(raw.transport, s => statuses.push(s));

    const packet = { type: 'packet', data: new Uint8Array([1, 2]) };
    const debug = { type: 'debug', data: 'boot' };
    raw.controller().enqueue(packet);
    raw.controller().enqueue({ type: 'status', data: { status: Types.DeviceStatusEnum.DeviceConnected } });
    raw.controller().enqueue(debug);

    expect(await readN(tapped.fromDevice, 2)).toEqual([packet, debug]);
    expect(statuses).toEqual([Types.DeviceStatusEnum.DeviceConnected]);
  });

  it('reports status even when nothing reads the tapped stream', async () => {
    const raw = rawTransport();
    const statuses: Types.DeviceStatusEnum[] = [];
    tapTransportStatus(raw.transport, s => statuses.push(s));

    raw.controller().enqueue({ type: 'status', data: { status: Types.DeviceStatusEnum.DeviceDisconnected, reason: 'serial-disconnected' } });
    await flush();

    expect(statuses).toEqual([Types.DeviceStatusEnum.DeviceDisconnected]);
  });

  it('reports a disconnect when the source stream fails', async () => {
    const raw = rawTransport();
    const statuses: Types.DeviceStatusEnum[] = [];
    const tapped = tapTransportStatus(raw.transport, s => statuses.push(s));

    raw.controller().error(new Error('device lost'));
    await flush();

    expect(statuses).toEqual([Types.DeviceStatusEnum.DeviceDisconnected]);
    const result = await tapped.fromDevice.getReader().read();
    expect(result.done).toBeTrue();
  });

  it('delegates disconnect and the outgoing stream to the source transport', async () => {
    const raw = rawTransport();
    const tapped = tapTransportStatus(raw.transport, () => undefined);

    await tapped.disconnect();

    expect(raw.state.disconnects).toBe(1);
    expect(tapped.toDevice).toBe(raw.transport.toDevice);
  });
});
