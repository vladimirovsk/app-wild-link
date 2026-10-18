import { Observable, combineLatest, map, timer } from 'rxjs';
import { MeshNode } from './mesh-node.model';

/** How often views recompute staleness when no packets arrive. */
export const CLOCK_PERIOD_MS = 30_000;

/** Pairs the latest value with the current time, re-emitting every period. */
export function withClock<T>(source$: Observable<T>, periodMs: number = CLOCK_PERIOD_MS): Observable<{ value: T; now: Date }> {
  return combineLatest([source$, timer(0, periodMs)]).pipe(map(([value]) => ({ value, now: new Date() })));
}

/**
 * A node is stale after Meshtastic's default position broadcast interval (15 min).
 * Phase 2 replaces this with the group's own interval.
 */
export const STALE_AFTER_MS = 15 * 60_000;

export interface MapMarker {
  id: string;
  label: string;
  lat: number;
  lng: number;
  self: boolean;
  stale: boolean;
}

export function nodeLabel(node: MeshNode): string {
  return node.longName || node.shortName || node.id;
}

export function isStale(lastHeard: Date, now: Date): boolean {
  return now.getTime() - lastHeard.getTime() > STALE_AFTER_MS;
}

export function toMarkers(nodes: MeshNode[], now: Date = new Date()): MapMarker[] {
  return nodes
    .filter(n => n.lat !== undefined && n.lng !== undefined)
    .map(n => ({
      id: n.id,
      label: nodeLabel(n),
      lat: n.lat as number,
      lng: n.lng as number,
      self: n.isSelf,
      stale: isStale(n.lastHeard, now),
    }));
}
