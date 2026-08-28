import { describe, expect, it } from 'vitest';
import { createInitialForgeState, defaultGoal, demoComponentIds } from './forge-data';
import { applyForgeTool } from './forge-engine';
import { compileDesignBrief } from './forge-prompt';
import { simulateDesign } from './forge-simulation';
import type { ForgeState, ForgeToolName } from './forge-types';

function command(state: ForgeState, name: ForgeToolName, input: Record<string, unknown>) {
  return applyForgeTool(state, name, { ...input, expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, 'UI').state;
}

function builtState(goal = defaultGoal) {
  let state = createInitialForgeState('lab');
  state = command(state, 'set_design_goal', { throughput_bpm: goal.throughputBpm, min_accuracy_pct: goal.minAccuracyPct, max_components: goal.maxComponents, brief: goal.brief });
  for (const catalogId of demoComponentIds) state = command(state, 'add_component', { catalog_id: catalogId });
  state = command(state, 'connect_components', { source_id: 'sensor-color', source_port: 'signal', target_id: 'diverter-servo', target_port: 'command' });
  state = command(state, 'attach_sensor', { sensor_id: 'sensor-color', channel: 'color', target_zone: 'conveyor-main', range: 1.4 });
  state = command(state, 'attach_actuator', { actuator_id: 'diverter-servo', target_id: 'diverter-servo', axis: 'y', travel_degrees: 32 });
  state = command(state, 'create_control_rule', { sensor_id: 'sensor-color', condition: 'red', actuator_id: 'diverter-servo', priority: 1 });
  state = command(state, 'create_control_rule', { sensor_id: 'sensor-color', condition: 'blue', actuator_id: 'diverter-servo', priority: 1 });
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

  it('rejects a visually incomplete machine instead of simulating hidden parts', async () => {
    const incomplete = createInitialForgeState('lab');
    await expect(simulateDesign(incomplete)).rejects.toThrow(/INVALID_DESIGN/);
    const missingRules = { ...builtState(), controlRules: [] };
    await expect(simulateDesign(missingRules)).rejects.toThrow(/red and blue/i);
  });

  it('rejects unsupported fixture transforms and actuator geometry instead of simulating a hidden canonical layout', async () => {
    let movedFixture = builtState();
    movedFixture = command(movedFixture, 'move_component', { component_id: 'diverter-servo', position: [1.8, 0.82, 0] });
    await expect(simulateDesign(movedFixture)).rejects.toThrow(/outside the validated fixture geometry/i);

    let invalidActuator = builtState();
    invalidActuator = command(invalidActuator, 'attach_actuator', { actuator_id: 'diverter-servo', target_id: 'diverter-servo', axis: 'z', travel_degrees: 20 });
    await expect(simulateDesign(invalidActuator)).rejects.toThrow(/Y-axis actuator/i);
  });

  it('uses a custom compiled goal to configure and verify the generated machine', async () => {
    const plan = compileDesignBrief('Sort red and blue packages at 35 boxes/min with 99% accuracy using at most 8 components.');
    let state = builtState({ ...plan.goal, brief: plan.brief });
    state = command(state, 'set_motor_speed', { component_id: 'conveyor-main', speed_mps: plan.motorSpeed });
    state = command(state, 'set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: plan.initialDelayMs, hold_ms: plan.actuatorHoldMs });
    const failed = await simulateDesign(state);
    expect(failed.status).toBe('failed');
    state = command(state, 'set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: failed.recommendedDelayMs, hold_ms: plan.actuatorHoldMs });
    const passed = await simulateDesign(state);
    expect(passed.status).toBe('passed');
    expect(passed.metrics.throughput).toBeGreaterThanOrEqual(35);
    expect(passed.metrics.accuracy).toBeGreaterThanOrEqual(99);
    expect(passed.metrics.componentCount).toBeLessThanOrEqual(8);
  }, 30_000);
});
