import { describe, expect, it } from 'vitest';
import { createInitialForgeState, defaultGoal, demoComponentIds } from './forge-data';
import { applyForgeTool } from './forge-engine';
import { simulateDesign } from './forge-simulation';
import type { ForgeState, ForgeToolName } from './forge-types';

function command(state: ForgeState, name: ForgeToolName, input: Record<string, unknown>) {
  return applyForgeTool(state, name, { ...input, expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, 'UI').state;
}

function builtState() {
  let state = createInitialForgeState('lab');
  state = command(state, 'set_design_goal', { throughput_bpm: defaultGoal.throughputBpm, min_accuracy_pct: defaultGoal.minAccuracyPct, max_components: defaultGoal.maxComponents });
  for (const catalogId of demoComponentIds) state = command(state, 'add_component', { catalog_id: catalogId });
  return state;
}

describe('ForgeTwin deterministic physics', () => {
  it('fails late timing, then passes after telemetry-derived retuning', async () => {
    let state = builtState();
    const failed = await simulateDesign(state);
    expect(failed.physics).toEqual({ engine: 'Rapier', timestepHz: 60, simulatedSeconds: 18 });
    expect(failed.status).toBe('failed');
    expect(failed.failures.some((event) => event.type === 'late_actuation' || event.type === 'moving_diverter_impact')).toBe(true);
    expect(failed.recommendedDelayMs).toBeGreaterThanOrEqual(700);
    expect(failed.recommendedDelayMs).toBeLessThanOrEqual(850);

    state = command(state, 'set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: failed.recommendedDelayMs, hold_ms: 520 });
    const passed = await simulateDesign(state);
    expect(passed.status).toBe('passed');
    expect(passed.metrics.throughput).toBeGreaterThanOrEqual(20);
    expect(passed.metrics.accuracy).toBeGreaterThanOrEqual(95);
    expect(passed.metrics.collisions).toBe(0);
    expect(passed.metrics.jams).toBe(0);
  }, 30_000);

  it('preserves a human sensor move and succeeds by retuning around it', async () => {
    let state = builtState();
    state = command(state, 'set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: 795, hold_ms: 520 });
    state = applyForgeTool(state, 'move_component', { component_id: 'sensor-color', position: [-2, 1.05, 0], expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, 'Human').state;
    const stale = await simulateDesign(state);
    expect(stale.status).toBe('failed');
    expect(stale.recommendedDelayMs).toBeGreaterThan(1300);
    expect(() => applyForgeTool(state, 'move_component', { component_id: 'sensor-color', position: [-0.8, 1.05, 0], expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, 'WebMCP')).toThrow(/LOCKED_BY_HUMAN/);

    const sensorBefore = state.components.find((component) => component.id === 'sensor-color')!.position;
    state = command(state, 'set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: stale.recommendedDelayMs, hold_ms: 520 });
    const retuned = await simulateDesign(state);
    expect(retuned.status).toBe('passed');
    expect(state.components.find((component) => component.id === 'sensor-color')!.position).toEqual(sensorBefore);
  }, 30_000);
});
