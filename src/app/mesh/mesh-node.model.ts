/** Latest known state of one node in the mesh, as the app sees it. */
export interface MeshNode {
  num: number;
  /** '!0acb0984' */
  id: string;
  shortName?: string;
  longName?: string;
  lat?: number;
  lng?: number;
  alt?: number;
  positionAt?: Date;
  /** 0–100; undefined when the board runs on external power */
  battery?: number;
  externalPower: boolean;
  voltage?: number;
  snr?: number;
  hopsAway?: number;
  lastHeard: Date;
  /** true for the node this app is connected to */
  isSelf: boolean;
}
