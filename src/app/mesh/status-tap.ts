import { Types } from '@meshtastic/core';

/**
 * transport-web-serial 0.2.5 reports connection changes as `{ type: 'status' }`
 * chunks on its incoming stream, but @meshtastic/core 2.6.6 only understands
 * 'packet' and 'debug' chunks and drops the rest — so an unplugged board would
 * go unnoticed. This wrapper reads the source eagerly, hands status chunks to
 * `onStatus` and forwards everything else to the device.
 */
type StatusChunk = { type: 'status'; data: { status: Types.DeviceStatusEnum; reason?: string } };
type TransportChunk = Types.DeviceOutput | StatusChunk;

export function tapTransportStatus(
  source: Types.Transport,
  onStatus: (status: Types.DeviceStatusEnum, reason?: string) => void,
): Types.Transport {
  const reader = (source.fromDevice as ReadableStream<TransportChunk>).getReader();

  const fromDevice = new ReadableStream<Types.DeviceOutput>({
    start(controller) {
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value.type === 'status') {
              onStatus(value.data.status, value.data.reason);
            } else {
              controller.enqueue(value);
            }
          }
          onStatus(Types.DeviceStatusEnum.DeviceDisconnected, 'stream-closed');
        } catch {
          onStatus(Types.DeviceStatusEnum.DeviceDisconnected, 'read-error');
        }
        try { controller.close(); } catch { /* already closed or cancelled */ }
      })();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return {
    fromDevice,
    toDevice: source.toDevice,
    disconnect: () => source.disconnect(),
  };
}
