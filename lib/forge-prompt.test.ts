import { describe, expect, it } from 'vitest';
import { createInitialForgeState } from './forge-data';
import { applyForgeTool } from './forge-engine';
import { compileDesignBrief, DEFAULT_DESIGN_PROMPT } from './forge-prompt';
import type { ForgeState, ForgeToolName } from './forge-types';

function command(state: ForgeState, name: ForgeToolName, input: Record<string, unknown>) {
  return applyForgeTool(state, name, { ...input, expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, 'System').state;
}

describe('ForgeTwin design brief compiler', () => {
  it('compiles the hackathon brief into a complete deterministic plan', () => {
    const plan = compileDesignBrief(DEFAULT_DESIGN_PROMPT);
    expect(plan.goal).toEqual({ throughputBpm: 20, minAccuracyPct: 95, maxComponents: 7, colors: ['red', 'blue'] });
    expect(plan.componentIds).toEqual(['conveyor', 'color-sensor', 'servo-diverter', 'ramp-red', 'ramp-blue', 'bin-red', 'bin-blue']);
    expect(plan.motorSpeed).toBe(2);
    expect(plan.initialDelayMs).toBe(1040);
    expect(plan.assumptions).toEqual(['95% minimum accuracy']);
  });

  it('parses equivalent phrasing, number words, and explicit custom constraints', () => {
    const plan = compileDesignBrief('SORT blue/red boxes at 35 BPM with 99 percent accuracy — MAX eight parts.');
    expect(plan.goal).toEqual({ throughputBpm: 35, minAccuracyPct: 99, maxComponents: 8, colors: ['red', 'blue'] });
    expect(plan.motorSpeed).toBeGreaterThan(2);
    expect(plan.assumptions).toEqual([]);
  });

  it('uses visible deterministic defaults for a valid but underspecified sorter', () => {
    const plan = compileDesignBrief('Build a red and blue color sorter for boxes.');
    expect(plan.goal).toMatchObject({ throughputBpm: 20, minAccuracyPct: 95, maxComponents: 7 });
    expect(plan.assumptions).toEqual(['20 boxes/min minimum', '95% minimum accuracy', '7-component maximum']);
  });

  it.each([
    ['Sort red and blue boxes using at most 6 components.', /needs 7 components/i],
    ['Sort red and green boxes at 20 boxes/min.', /supports red and blue routes only/i],
    ['Build a coffee roaster at 20 units/min.', /conveyor-based package sorters/i],
    ['Sort red and blue boxes at 20-30 boxes/min.', /one minimum throughput/i],
    ['Sort red and blue boxes at 20 boxes/min and 30 boxes/min.', /conflicting throughput/i],
    ['Sort red and blue boxes at 41 boxes/min.', /between 5 and 40/i],
    ['Sort red and blue boxes with 101% accuracy.', /between 50 and 100/i],
    ['Sort red and blue boxes using at least 7 components.', /maximum budget/i],
    ['Sort red and blue boxes at less than 20 boxes/min.', /throughput must be a minimum/i],
    ['Sort red and blue boxes with at most 90% accuracy.', /accuracy must be a minimum/i],
    ['Sort red and blue boxes with 90-95% accuracy.', /one minimum accuracy/i],
    ['Sort red and blue boxes using fewer than 8 components.', /inclusive component budget/i],
    ['Do not sort red and blue boxes at 20 boxes/min.', /says not to perform/i],
    ['Sort blue boxes without any red packages.', /red.*explicitly excluded/i],
    ['Sort gray and teal boxes at 20 boxes/min.', /supports red and blue routes only/i],
  ])('rejects unsupported or infeasible briefs without pretending: %s', (brief, expected) => {
    expect(() => compileDesignBrief(brief)).toThrow(expected);
  });

  it('emits a plan that assembles the seven-part topology through scoped tools', () => {
    const plan = compileDesignBrief('Sort red and blue packages at 30 boxes/min with 98% accuracy using at most 8 components.');
    let state = createInitialForgeState('lab');
    state = command(state, 'set_design_goal', { throughput_bpm: plan.goal.throughputBpm, min_accuracy_pct: plan.goal.minAccuracyPct, max_components: plan.goal.maxComponents, brief: plan.brief });
    for (const catalogId of plan.componentIds) state = command(state, 'add_component', { catalog_id: catalogId });
    state = command(state, 'connect_components', { source_id: 'sensor-color', source_port: 'signal', target_id: 'diverter-servo', target_port: 'command' });
    state = command(state, 'attach_sensor', { sensor_id: 'sensor-color', channel: 'color', target_zone: 'conveyor-main', range: 1.4 });
    state = command(state, 'attach_actuator', { actuator_id: 'diverter-servo', target_id: 'diverter-servo', axis: 'y', travel_degrees: 32 });
    state = command(state, 'create_control_rule', { sensor_id: 'sensor-color', condition: 'red', actuator_id: 'diverter-servo', priority: 1 });
    state = command(state, 'create_control_rule', { sensor_id: 'sensor-color', condition: 'blue', actuator_id: 'diverter-servo', priority: 1 });
    state = command(state, 'set_motor_speed', { component_id: 'conveyor-main', speed_mps: plan.motorSpeed });
    state = command(state, 'set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: plan.initialDelayMs, hold_ms: plan.actuatorHoldMs });

    expect(state.goal).toMatchObject({ throughputBpm: 30, minAccuracyPct: 98, maxComponents: 8, brief: plan.brief });
    expect(state.components).toHaveLength(7);
    expect(state.connections).toHaveLength(1);
    expect(state.sensorAttachments).toHaveLength(1);
    expect(state.actuatorAttachments).toHaveLength(1);
    expect(state.controlRules.map((rule) => rule.condition).sort()).toEqual(['blue', 'red']);
    expect(state.motorSpeed).toBe(plan.motorSpeed);
  });
});
