import { BASE_LAYERS } from './base-layers';

describe('BASE_LAYERS', () => {
  it('starts with the street map, then the topographic map', () => {
    expect(BASE_LAYERS.map(l => l.name)).toEqual(['Streets', 'Topo']);
  });

  it('uses only keyless HTTPS tile servers (CARTO now needs an API key)', () => {
    for (const layer of BASE_LAYERS) {
      expect(layer.url).toMatch(/^https:\/\//);
      expect(layer.url).toContain('{z}/{x}/{y}');
      expect(layer.url).not.toContain('cartocdn');
    }
  });

  it('credits OpenStreetMap on every layer, as its licence requires', () => {
    for (const layer of BASE_LAYERS) {
      expect(layer.attribution).toContain('OpenStreetMap');
    }
  });

  it('caps zoom at what each server provides', () => {
    expect(BASE_LAYERS.map(l => l.maxZoom)).toEqual([19, 17]);
  });
});
