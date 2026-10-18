import { MeshNode } from '../../mesh/mesh-node.model';
import { BackendDevice } from '../../shared/backend-device.service';
import { toDeviceRows } from './device-rows';

const now = new Date('2026-10-18T12:00:00Z');

function node(partial: Partial<MeshNode> & { num: number }): MeshNode {
  return { id: `!${partial.num.toString(16).padStart(8, '0')}`, externalPower: false, lastHeard: now, isSelf: false, ...partial };
}

function backend(deviceId: string, name: string, lastSeenAt = '2026-10-17T09:00:00Z'): BackendDevice {
  return {
    _id: deviceId, userId: 'u1', deviceId, name, model: 'htit-wb32-laf-v4.2', connectionType: 'serial',
    isActive: false, registeredAt: '2026-10-01T00:00:00Z', lastSeenAt,
  };
}

describe('toDeviceRows', () => {
  it('lists every mesh node, using the registered name when there is one', () => {
    const rows = toDeviceRows(
      [node({ num: 0x0acb0984, isSelf: true }), node({ num: 0x11111111, longName: 'Kid backpack' })],
      [backend('0acb0984', 'Base camp')],
      now,
    );

    expect(rows.map(r => [r.nodeId, r.name, r.registered])).toEqual([
      ['!0acb0984', 'Base camp', true],
      ['!11111111', 'Kid backpack', false],
    ]);
  });

  it('adds registered devices not heard this session as offline rows', () => {
    const rows = toDeviceRows([], [backend('22222222', 'Spare board')], now);

    expect(rows.length).toBe(1);
    expect(rows[0].active).toBeFalse();
    expect(rows[0].lastHeard).toEqual(new Date('2026-10-17T09:00:00Z'));
  });

  it('lists active nodes first, own node at the top', () => {
    const rows = toDeviceRows(
      [
        node({ num: 1, lastHeard: new Date(now.getTime() - 20 * 60_000) }),
        node({ num: 2 }),
        node({ num: 3, isSelf: true }),
      ],
      [],
      now,
    );

    expect(rows.map(r => r.nodeId)).toEqual(['!00000003', '!00000002', '!00000001']);
    expect(rows.map(r => r.active)).toEqual([true, true, false]);
  });
});
