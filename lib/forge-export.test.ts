import { describe, expect, it } from 'vitest';
import { createInitialForgeState } from './forge-data';
import { buildBinaryStl } from './forge-export';
import { testCommand } from './forge-test-utils';

function exportWorld() {
  let state = createInitialForgeState('lab');
  state = testCommand(state, 'set_design_goal', {
    machine_name: 'Export fixture', domain: 'Mechanical testing', brief: 'Build a small fixture that proves CAD geometry export.',
    summary: 'A deterministic export test.', capabilities: ['structure'], constraints: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 10, unit: '', source: 'user' }], max_components: 10,
    assumptions: [], disclaimer: 'Test model.', simulation_model: 'Rapier rigid bodies.',
    world: { gravity: [0, -9.81, 0], duration: 4, bounds: [10, 8, 10], environment: 'test lab' },
  });
  state = testCommand(state, 'create_assembly', { assembly_id: 'fixture', name: 'Fixture', purpose: 'Export test' });
  state = testCommand(state, 'create_component', { component_id: 'base', primitive: 'plate', assembly_id: 'fixture', role: 'fixture base', position: [1, 1, 2], rotation: [0, .2, 0], dimensions: [2, .2, 1], material_id: 'steel', body_type: 'fixed' });
  state = testCommand(state, 'create_component', { component_id: 'wheel', primitive: 'wheel', assembly_id: 'fixture', role: 'test wheel', position: [-1, 1, 0], rotation: [0, 0, 0], dimensions: [.8, .2, .8], material_id: 'rubber', body_type: 'dynamic' });
  state = testCommand(state, 'create_component', { component_id: 'ball', primitive: 'container', assembly_id: 'fixture', role: 'spherical payload', position: [0, 2, 0], rotation: [0, 0, 0], dimensions: [.5, .6, .5], material_id: 'polymer', body_type: 'dynamic', parameters: { visual_form: 'tomato', tomato_grade: 'ripe' } });
  return state;
}

describe('ForgeTwin CAD export', () => {
  it('exports every component as finite, transformed binary STL triangles in millimeters', () => {
    const state = exportWorld();
    const stl = buildBinaryStl(state);
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
    const triangles = view.getUint32(80, true);
    expect(triangles).toBeGreaterThan(30);
    expect(stl.byteLength).toBe(84 + triangles * 50);

    let largestCoordinate = 0;
    for (let triangle = 0; triangle < triangles; triangle += 1) {
      const triangleOffset = 84 + triangle * 50;
      for (let coordinate = 0; coordinate < 9; coordinate += 1) {
        const value = view.getFloat32(triangleOffset + 12 + coordinate * 4, true);
        expect(Number.isFinite(value)).toBe(true);
        largestCoordinate = Math.max(largestCoordinate, Math.abs(value));
      }
    }
    expect(largestCoordinate).toBeGreaterThan(1_000);
  });

  it('rejects an empty world instead of downloading a misleading CAD file', () => {
    expect(() => buildBinaryStl(createInitialForgeState('lab'))).toThrow(/at least one physical body/i);
  });
});
