import { InjectionToken } from '@angular/core';
import { MeshDevice, Types } from '@meshtastic/core';
import { TransportWebSerial } from '@meshtastic/transport-web-serial';

/** The part of MeshDevice the app uses; tests provide a fake with the same shape. */
export type MeshDeviceLike = Pick<MeshDevice, 'events' | 'configure' | 'heartbeat' | 'sendText' | 'disconnect'>;

const SERIAL_BAUD_RATE = 115200;

/** Opens a transport to the head device (Web Serial now, Web Bluetooth in phase 2). */
export const MESH_TRANSPORT_FACTORY = new InjectionToken<() => Promise<Types.Transport>>('MESH_TRANSPORT_FACTORY', {
  providedIn: 'root',
  factory: () => () => TransportWebSerial.create(SERIAL_BAUD_RATE),
});

export const MESH_DEVICE_FACTORY = new InjectionToken<(transport: Types.Transport) => MeshDeviceLike>('MESH_DEVICE_FACTORY', {
  providedIn: 'root',
  factory: () => (transport: Types.Transport) => new MeshDevice(transport),
});

export const WEB_SERIAL_SUPPORTED = new InjectionToken<boolean>('WEB_SERIAL_SUPPORTED', {
  providedIn: 'root',
  factory: () => typeof navigator !== 'undefined' && 'serial' in navigator,
});
