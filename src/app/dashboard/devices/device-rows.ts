import { isStale, nodeLabel } from '../../mesh/map-markers';
import { MeshNode } from '../../mesh/mesh-node.model';
import { BackendDevice } from '../../shared/backend-device.service';

export interface DeviceRow {
  /** Backend device id: node id without '!' */
  deviceId: string;
  /** '!0acb0984' */
  nodeId: string;
  name: string;
  /** Has a backend record (only those can be renamed or deleted) */
  registered: boolean;
  isSelf: boolean;
  active: boolean;
  lat?: number;
  lng?: number;
  alt?: number;
  battery?: number;
  externalPower: boolean;
  voltage?: number;
  snr?: number;
  hopsAway?: number;
  lastHeard: Date;
}

/** Mesh nodes heard this session, plus registered devices not heard yet. */
export function toDeviceRows(nodes: MeshNode[], registered: BackendDevice[], now: Date = new Date()): DeviceRow[] {
  const byId = new Map(registered.map(d => [d.deviceId, d]));

  const rows: DeviceRow[] = nodes.map(n => {
    const deviceId = n.id.slice(1);
    const record = byId.get(deviceId);
    byId.delete(deviceId);
    return {
      deviceId,
      nodeId: n.id,
      name: record?.name || nodeLabel(n),
      registered: !!record,
      isSelf: n.isSelf,
      active: !isStale(n.lastHeard, now),
      lat: n.lat,
      lng: n.lng,
      alt: n.alt,
      battery: n.battery,
      externalPower: n.externalPower,
      voltage: n.voltage,
      snr: n.snr,
      hopsAway: n.hopsAway,
      lastHeard: n.lastHeard,
    };
  });

  byId.forEach(d => rows.push({
    deviceId: d.deviceId,
    nodeId: `!${d.deviceId}`,
    name: d.name,
    registered: true,
    isSelf: false,
    active: false,
    lat: d.lat,
    lng: d.lng,
    alt: d.alt,
    battery: d.battery,
    externalPower: false,
    voltage: d.voltage,
    lastHeard: new Date(d.lastSeenAt),
  }));

  return rows.sort((a, b) =>
    Number(b.isSelf) - Number(a.isSelf) ||
    Number(b.active) - Number(a.active) ||
    b.lastHeard.getTime() - a.lastHeard.getTime());
}
