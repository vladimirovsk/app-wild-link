import { MeshDevice } from '@meshtastic/core';
import { TransportWebSerial } from '@meshtastic/transport-web-serial';

describe('meshtastic packages', () => {
  it('load in the Angular build', () => {
    expect(typeof MeshDevice).toBe('function');
    expect(typeof TransportWebSerial.create).toBe('function');
  });
});
