import { describe, expect, it } from 'vitest';
import { createInitialForgeState, defaultGoal, demoComponentIds } from './forge-data';
import { applyForgeTool } from './forge-engine';
import type { Actor, ForgeState, ForgeToolName } from './forge-types';

function command(state: ForgeState, name: ForgeToolName, input: Record<string, unknown>, actor: Actor = 'UI') {
  return applyForgeTool(state, name, { ...input, expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, actor).state;
}

function builtState() {
  let state = createInitialForgeState('lab');
  state = command(state, 'set_design_goal', { throughput_bpm: defaultGoal.throughputBpm, min_accuracy_pct: defaultGoal.minAccuracyPct, max_components: defaultGoal.maxComponents });
  for (const catalogId of demoComponentIds) state = command(state, 'add_component', { catalog_id: catalogId });
  return state;
}

describe('ForgeTwin shared command engine', () => {
  it('validates sorter goals even when the engine is called outside the Zod hook', () => {
    const state = createInitialForgeState('lab');
    expect(() => command(state, 'set_design_goal', { throughput_bpm: 80, min_accuracy_pct: 95, max_components: 7 })).toThrow(/5–40/);
    expect(() => command(state, 'set_design_goal', { throughput_bpm: 20, min_accuracy_pct: 101, max_components: 7 })).toThrow(/50–100/);
    expect(() => command(state, 'set_design_goal', { throughput_bpm: 20, min_accuracy_pct: 95, max_components: 6 })).toThrow(/7–12/);
  });

  it('keeps equivalent compiled designs stable even when their source briefs differ', () => {
    const initial = createInitialForgeState('lab');
    const first = command(initial, 'set_design_goal', { throughput_bpm: 20, min_accuracy_pct: 95, max_components: 7, brief: 'Sort red and blue boxes at 20 boxes/min.' });
    const second = command(createInitialForgeState('lab'), 'set_design_goal', { throughput_bpm: 20, min_accuracy_pct: 95, max_components: 7, brief: 'Build the standard two-color sorter.' });
    expect(first.designHash).toBe(second.designHash);
  });

  it('enforces optimistic concurrency and the component limit', () => {
    const state = builtState();
    expect(state.components).toHaveLength(7);
    expect(() => applyForgeTool(state, 'set_motor_speed', { component_id: 'conveyor-main', speed_mps: 2.1, expected_revision: state.revision - 1, expected_workspace_nonce: state.workspaceNonce }, 'WebMCP')).toThrow(/STALE_REVISION/);
    expect(() => applyForgeTool(state, 'add_component', { catalog_id: 'aux-motor', expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, 'WebMCP')).toThrow(/component limit/i);
  });

  it('records a human transform lock and prevents agent overwrite', () => {
    let state = builtState();
    state = command(state, 'move_component', { component_id: 'sensor-color', position: [-2, 1.05, 0] }, 'Human');
    const sensor = state.components.find((component) => component.id === 'sensor-color');
    expect(sensor).toMatchObject({ position: [-2, 1.05, 0], humanLocked: true, lastModifiedBy: 'Human' });
    expect(state.humanConstraints).toHaveLength(1);
    expect(() => applyForgeTool(state, 'move_component', { component_id: 'sensor-color', position: [-0.8, 1.05, 0], expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, 'WebMCP')).toThrow(/LOCKED_BY_HUMAN/);
  });

  it('restores an earlier design as a new revision while preserving the human sensor', () => {
    let state = builtState();
    const baselineRevision = state.revisions.at(-1)!.revision;
    state = command(state, 'move_component', { component_id: 'sensor-color', position: [-2.2, 1.05, 0] }, 'Human');
    state = command(state, 'set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: 1510, hold_ms: 520 });
    const revisionBeforeRestore = state.revision;
    state = command(state, 'restore_revision', { revision: baselineRevision });
    expect(state.revision).toBe(revisionBeforeRestore + 1);
    expect(state.components.find((component) => component.id === 'sensor-color')?.position).toEqual([-2.2, 1.05, 0]);
    expect(state.components.find((component) => component.id === 'sensor-color')?.humanLocked).toBe(true);
  });

  it('validates connection port compatibility', () => {
    const state = builtState();
    expect(() => command(state, 'connect_components', { source_id: 'sensor-color', source_port: 'signal', target_id: 'bin-red', target_port: 'entry' })).toThrow(/INVALID_TOPOLOGY/);
  });
});
