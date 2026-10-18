import { batteryFromProto, nodeIdFromNum, parseNodeId, positionFromProto, utf8Length } from './mesh-mappers';

describe('mesh mappers', () => {
  it('formats node ids as ! plus 8 hex digits', () => {
    expect(nodeIdFromNum(0x0acb0984)).toBe('!0acb0984');
    expect(nodeIdFromNum(0xff)).toBe('!000000ff');
  });

  it('scales integer coordinates by 1e-7', () => {
    expect(positionFromProto({ latitudeI: 510447000, longitudeI: -1140719000, altitude: 1045, time: 1792300000 }))
      .toEqual({ lat: 51.0447, lng: -114.0719, alt: 1045, at: new Date(1792300000 * 1000) });
  });

  it('returns null when there is no GPS fix', () => {
    expect(positionFromProto({ latitudeI: 0, longitudeI: 0 })).toBeNull();
    expect(positionFromProto({})).toBeNull();
  });

  it('treats battery level above 100 as external power', () => {
    expect(batteryFromProto(101, 4.2)).toEqual({ battery: undefined, externalPower: true, voltage: 4.2 });
    expect(batteryFromProto(87)).toEqual({ battery: 87, externalPower: false, voltage: undefined });
  });

  it('parses a typed node id, blank meaning broadcast', () => {
    expect(parseNodeId('!0acb0984')).toBe(0x0acb0984);
    expect(parseNodeId('  0ACB0984 ')).toBe(0x0acb0984);
    expect(parseNodeId('')).toBeUndefined();
    expect(parseNodeId('   ')).toBeUndefined();
    expect(parseNodeId('!xyz')).toBeNull();
    expect(parseNodeId('!123456789')).toBeNull();
  });

  it('counts UTF-8 bytes, not characters', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('привет')).toBe(12);
  });
});
