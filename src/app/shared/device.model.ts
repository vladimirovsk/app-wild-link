export interface Device {
  nodeId: string;
  name: string;
  lat: number;
  lng: number;
  alt: number;
  status: 'online' | 'offline' | 'warning';
  battery: number;
  voltage: number;
  batMv: number;
  usbPower: boolean;
  isCharging: boolean;
  uptime: number;
  sats: number;
  pdop: number;
  speed: number;
  airUtilTx: number;
  channelUtilization: number;
  hasGps: boolean;
  connectedAt: Date;
  lastSeenAt: Date;
  usbVendorId?: number;
  usbProductId?: number;
}

export function makeEmptyDevice(nodeId: string, portInfo?: SerialPortInfo): Device {
  return {
    nodeId,
    name: `!${nodeId}`,
    lat: 0, lng: 0, alt: 0,
    status: 'online',
    battery: 0, voltage: 0, batMv: 0,
    usbPower: false, isCharging: false,
    uptime: 0, sats: 0, pdop: 0, speed: 0,
    airUtilTx: 0, channelUtilization: 0,
    hasGps: false,
    connectedAt: new Date(),
    lastSeenAt: new Date(),
    usbVendorId: portInfo?.usbVendorId,
    usbProductId: portInfo?.usbProductId,
  };
}

export function formatLastSeen(d: Device): string {
  const diff = Math.floor((Date.now() - d.lastSeenAt.getTime()) / 1000);
  if (diff < 5)    return 'just now';
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
