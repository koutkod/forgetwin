import { describe, expect, it } from 'vitest';
import { createInitialForgeState } from './forge-data';
import { buildAsciiStl } from './forge-export';
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
  it('exports every component as finite, transformed STL triangles', () => {
    const state = exportWorld();
    const stl = buildAsciiStl(state);
    expect(stl).toMatch(/^solid exported/);
    expect(stl).toMatch(/endsolid exported\s*$/);
    expect(stl).not.toMatch(/NaN|Infinity/);
    expect(stl.match(/facet normal/g)?.length).toBeGreaterThan(30);
    expect(stl).toContain('vertex');
  });

  it('rejects an empty world instead of downloading a misleading CAD file', () => {
    expect(() => buildAsciiStl(createInitialForgeState('lab'))).toThrow(/at least one physical body/i);
  });
});
