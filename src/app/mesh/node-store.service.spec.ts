import { MeshNode } from './mesh-node.model';
import { NodeStoreService } from './node-store.service';

const NODE = 0x0acb0984;
const t1 = new Date('2026-10-18T10:00:00Z');
const t2 = new Date('2026-10-18T10:01:00Z');

describe('NodeStoreService', () => {
  let store: NodeStoreService;

  beforeEach(() => {
    store = new NodeStoreService();
  });

  function node(num = NODE): MeshNode | undefined {
    return store.snapshot().find(n => n.num === num);
  }

  it('creates a node from a position packet', () => {
    store.applyPosition(NODE, { latitudeI: 510447000, longitudeI: -1140719000 }, t1);

    expect(node()?.id).toBe('!0acb0984');
    expect(node()?.lat).toBe(51.0447);
    expect(node()?.lng).toBe(-114.0719);
    expect(node()?.lastHeard).toEqual(t1);
  });

  it('keeps the last known position when a packet has no fix, but still marks the node heard', () => {
    store.applyPosition(NODE, { latitudeI: 510447000, longitudeI: -1140719000 }, t1);
    store.applyPosition(NODE, { latitudeI: 0, longitudeI: 0 }, t2);

    expect(node()?.lat).toBe(51.0447);
    expect(node()?.lng).toBe(-114.0719);
    expect(node()?.lastHeard).toEqual(t2);
  });

  it('shows external power instead of a level above 100', () => {
    store.applyBattery(NODE, 101, 4.2, t1);

    expect(node()?.externalPower).toBeTrue();
    expect(node()?.battery).toBeUndefined();
    expect(node()?.voltage).toBe(4.2);
  });

  it('fills every field from a node info record', () => {
    store.applyNodeInfo({
      num: NODE,
      shortName: 'KID',
      longName: 'Kid backpack',
      position: { latitudeI: 510447000, longitudeI: -1140719000, altitude: 1045 },
      batteryLevel: 87,
      voltage: 3.9,
      snr: 6.5,
      hopsAway: 1,
      lastHeard: 1792300000,
    });

    const n = node();
    expect(n?.shortName).toBe('KID');
    expect(n?.longName).toBe('Kid backpack');
    expect(n?.lat).toBe(51.0447);
    expect(n?.alt).toBe(1045);
    expect(n?.battery).toBe(87);
    expect(n?.voltage).toBe(3.9);
    expect(n?.snr).toBe(6.5);
    expect(n?.hopsAway).toBe(1);
    expect(n?.lastHeard).toEqual(new Date(1792300000 * 1000));
  });

  it('updates names from a user packet', () => {
    store.applyName(NODE, 'MOM', 'Mom phone node', t1);

    expect(node()?.shortName).toBe('MOM');
    expect(node()?.longName).toBe('Mom phone node');
  });

  it('marks exactly one node as self', () => {
    store.applyPosition(NODE, { latitudeI: 510447000, longitudeI: -1140719000 }, t1);
    store.applyPosition(0x11111111, { latitudeI: 510000000, longitudeI: -1140000000 }, t1);

    store.setSelf(NODE);

    expect(node()?.isSelf).toBeTrue();
    expect(node(0x11111111)?.isSelf).toBeFalse();
  });

  it('emits a new array on every change', () => {
    const emissions: MeshNode[][] = [];
    store.nodes$.subscribe(list => emissions.push(list));

    store.applyPosition(NODE, { latitudeI: 510447000, longitudeI: -1140719000 }, t1);
    store.applyBattery(NODE, 50, undefined, t2);

    // initial empty list + two updates
    expect(emissions.length).toBe(3);
    expect(emissions[1]).not.toBe(emissions[2]);
    expect(emissions[2][0].battery).toBe(50);
  });

  it('forgets every node on clear', () => {
    store.applyPosition(NODE, { latitudeI: 510447000, longitudeI: -1140719000 }, t1);
    store.clear();

    expect(store.snapshot()).toEqual([]);
  });
});
