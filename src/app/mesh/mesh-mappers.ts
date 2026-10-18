/** Position fields as Meshtastic sends them: coordinates are integers × 1e-7. */
export interface ProtoPosition {
  latitudeI?: number;
  longitudeI?: number;
  altitude?: number;
  time?: number;
}

export interface Position {
  lat: number;
  lng: number;
  alt?: number;
  at?: Date;
}

export interface Battery {
  battery?: number;
  externalPower: boolean;
  voltage?: number;
}

const COORD_SCALE = 1e-7;

/** '!' + node number in lowercase hex, 8 digits — the id format Meshtastic apps show. */
export function nodeIdFromNum(num: number): string {
  return '!' + (num >>> 0).toString(16).padStart(8, '0');
}

/** Returns null when the device has no GPS fix (both coordinates 0 or missing). */
export function positionFromProto(p: ProtoPosition): Position | null {
  const latI = p.latitudeI ?? 0;
  const lngI = p.longitudeI ?? 0;
  if (latI === 0 && lngI === 0) return null;

  const position: Position = {
    lat: round7(latI * COORD_SCALE),
    lng: round7(lngI * COORD_SCALE),
  };
  if (p.altitude !== undefined) position.alt = p.altitude;
  if (p.time) position.at = new Date(p.time * 1000);
  return position;
}

/** Meshtastic reports a level above 100 when the board runs on external power. */
export function batteryFromProto(level?: number, voltage?: number): Battery {
  const externalPower = level !== undefined && level > 100;
  return {
    battery: externalPower ? undefined : level,
    externalPower,
    voltage,
  };
}

/**
 * Parses a node id the user typed ('!0acb0984' or '0acb0984').
 * Returns undefined for blank input (broadcast) and null when it is not a valid id.
 */
export function parseNodeId(input: string): number | undefined | null {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const hex = trimmed.startsWith('!') ? trimmed.slice(1) : trimmed;
  if (!/^[0-9a-fA-F]{1,8}$/.test(hex)) return null;
  return parseInt(hex, 16);
}

/** Text limits on LoRa are in bytes; Cyrillic letters take 2 bytes each. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function round7(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}
