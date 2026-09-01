import { describe, expect, it } from 'vitest';
import { componentMass, primitiveCatalog } from './forge-data';

describe('component envelope mass estimates', () => {
  it('does not treat packaged motors and controllers as solid billets', () => {
    expect(componentMass('motor', [.7, .65, .62], 'steel')).toBeLessThan(60);
    expect(componentMass('controller', [.65, .62, .38], 'steel')).toBeLessThan(40);
  });

  it('keeps solid transmission parts materially heavier than sensing hardware', () => {
    const gear = componentMass('gear', [.7, .2, .7], 'steel');
    const sensor = componentMass('sensor', [.7, .2, .7], 'steel');
    expect(gear).toBeGreaterThan(sensor * 8);
  });
});

describe('general-purpose CAD primitive catalog', () => {
  it('includes reusable mobility, aviation, and robotics families', () => {
    const kinds = new Set(primitiveCatalog.map((item) => item.kind));
    expect(primitiveCatalog).toHaveLength(39);
    for (const kind of ['tube', 'bearing', 'linkage', 'seat', 'steering', 'pedal', 'battery', 'body-shell', 'aerofoil', 'fuselage', 'propeller', 'rotor', 'landing-gear', 'track']) expect(kinds.has(kind as never), `missing ${kind}`).toBe(true);
  });
});
