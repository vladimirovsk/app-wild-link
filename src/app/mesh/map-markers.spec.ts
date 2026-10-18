import { discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { MeshNode } from './mesh-node.model';
import { toMarkers, withClock } from './map-markers';

describe('withClock', () => {
  it('re-emits the latest value every period so staleness is recomputed without new packets', fakeAsync(() => {
    const source = new BehaviorSubject<string>('nodes');
    const seen: Array<{ value: string; now: Date }> = [];
    const sub = withClock(source, 30_000).subscribe(e => seen.push(e));

    tick(30_000);
    tick(30_000);

    expect(seen.length).toBe(3);
    expect(seen.map(e => e.value)).toEqual(['nodes', 'nodes', 'nodes']);
    expect(seen[2].now.getTime() - seen[0].now.getTime()).toBe(60_000);
    sub.unsubscribe();
    discardPeriodicTasks();
  }));
});

const now = new Date('2026-10-18T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

function node(partial: Partial<MeshNode> & { num: number }): MeshNode {
  return { id: `!${partial.num.toString(16).padStart(8, '0')}`, externalPower: false, lastHeard: now, isSelf: false, ...partial };
}

describe('toMarkers', () => {
  it('skips nodes without a position', () => {
    const markers = toMarkers([
      node({ num: 1, lat: 51, lng: -114 }),
      node({ num: 2 }),
      node({ num: 3, lat: 51.1, lng: -114.1 }),
    ], now);

    expect(markers.map(m => m.id)).toEqual(['!00000001', '!00000003']);
  });

  it('labels a marker by long name, then short name, then id', () => {
    const markers = toMarkers([
      node({ num: 1, lat: 51, lng: -114, longName: 'Kid backpack', shortName: 'KID' }),
      node({ num: 2, lat: 51, lng: -114, shortName: 'DAD' }),
      node({ num: 3, lat: 51, lng: -114 }),
    ], now);

    expect(markers.map(m => m.label)).toEqual(['Kid backpack', 'DAD', '!00000003']);
  });

  it('marks a node stale when last heard more than 15 minutes ago', () => {
    const markers = toMarkers([
      node({ num: 1, lat: 51, lng: -114, lastHeard: minutesAgo(16) }),
      node({ num: 2, lat: 51, lng: -114, lastHeard: minutesAgo(14) }),
    ], now);

    expect(markers.map(m => m.stale)).toEqual([true, false]);
  });

  it('carries the self flag and coordinates', () => {
    const [marker] = toMarkers([node({ num: 1, lat: 51.0447, lng: -114.0719, isSelf: true })], now);

    expect(marker).toEqual({ id: '!00000001', label: '!00000001', lat: 51.0447, lng: -114.0719, self: true, stale: false });
  });
});
