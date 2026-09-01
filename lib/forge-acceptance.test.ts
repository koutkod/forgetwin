import { describe, expect, it } from 'vitest';
import { agentIntentSchema } from './forge-agent';
import { contextualMechanicalEdits } from './forge-chat';
import { normalizeEngineeringIntent } from './forge-intent';
import { agentPlanFromCompiled, compileAgentPlan } from './forge-model-plan';
import { compileDesignBrief } from './forge-prompt';
import { assemblePlan, testCommand } from './forge-test-utils';
import { preflightCompiledWorldPlan, prepareForgeToolArguments } from './use-forge';

describe('judge prompt acceptance matrix', () => {
  it('normalizes domain misspellings without changing the requested machine family', () => {
    expect(normalizeEngineeringIntent('Build a byclicle with a break light.').normalizedRequest).toBe('Build a bicycle with a brake light.');
    expect(normalizeEngineeringIntent('Build an airplnae with landing gear.').normalizedRequest).toBe('Build an airplane with landing gear.');
  });

  it('builds a bicycle with a correctly mounted front headlight and rear brake light', () => {
    const plan = compileDesignBrief('Build a bycicle with a headlight and a break light.');
    expect(plan.goal.machineName).toContain('bicycle');
    expect(plan.components.filter((item) => item.parameters?.bicycle_wheel)).toHaveLength(2);
    const front = plan.components.find((item) => item.parameters?.headlight);
    const rear = plan.components.find((item) => item.parameters?.brake_light);
    expect(front?.parameters).toMatchObject({ facing_x: 1, light_direction: 'front' });
    expect(rear).toMatchObject({ color: '#ff313d' });
    expect(rear?.parameters).toMatchObject({ facing_x: -1, light_direction: 'rear' });
    const supports = plan.connections.filter((item) => item.type === 'mechanical' && [item.sourceId, item.targetId].includes(rear!.id));
    expect(supports.some((edge) => {
      const support = plan.components.find((item) => item.id === (edge.sourceId === rear!.id ? edge.targetId : edge.sourceId));
      return support?.primitive !== 'wheel' && support?.bodyType !== 'dynamic';
    })).toBe(true);
    expect(plan.engineeringPlan).toMatchObject({ machineType: 'bicycle', coordinateConvention: { forward: '+X', rear: '-X' } });
  });

  it('adds a rear-facing brake light through a schema-valid atomic follow-up', () => {
    let state = assemblePlan(compileDesignBrief('Build a bycicle with a headlight.'));
    const edits = contextualMechanicalEdits(state, 'Add a break light to the back of the bycicle.');
    expect(edits.map((item) => item.tool)).toEqual(expect.arrayContaining(['create_component', 'connect_components', 'create_joint']));
    for (const edit of edits) state = testCommand(state, edit.tool, edit.input, 'ModelAgent');
    const light = state.components.find((item) => item.parameters.brake_light);
    expect(light?.parameters).toMatchObject({ facing_x: -1, light_direction: 'rear' });
    expect(state.joints.some((joint) => joint.componentB === light?.id && joint.type === 'fixed')).toBe(true);
  });

  it('moves the rider saddle rather than a bicycle frame member', () => {
    const state = assemblePlan(compileDesignBrief('Build a bicycle with a headlight.'));
    const saddle = state.components.find((item) => item.role === 'rider saddle')!;
    const edit = contextualMechanicalEdits(state, 'Move the seat backward.').find((item) => item.tool === 'move_component');
    expect(edit?.input.component_id).toBe(saddle.id);
    expect((edit?.input.position as number[])[0]).toBeLessThan(saddle.position[0]);
  });

  it('builds a solar-powered bicycle as one coherent vehicle', () => {
    const plan = compileDesignBrief('Build me a byclicle powered by a solar panel.');
    expect(plan.goal.machineName).toBe('Solar electric bicycle');
    expect(plan.components.some((item) => item.parameters?.bicycle_solar_panel)).toBe(true);
    expect(plan.connections.some((item) => item.type === 'power' && item.channel === 'solar_charge_bus')).toBe(true);
    expect(plan.goal.summary).not.toContain('tracking-axis');
  });

  it('builds a complete fixed-wing airplane from misspelled and explicit prompts', () => {
    const typoPlan = compileDesignBrief('Build an airplnae with landing gear.');
    expect(typoPlan.components.filter((item) => item.primitive === 'landing-gear')).toHaveLength(3);
    expect(typoPlan.components.some((item) => item.role === 'left main wing')).toBe(true);
    expect(typoPlan.components.some((item) => item.role === 'right main wing')).toBe(true);

    const plan = compileDesignBrief('Build an airplane with two wings, a propeller and navigation lights.');
    expect(plan.components.filter((item) => /main wing/.test(item.role))).toHaveLength(2);
    expect(plan.components.some((item) => item.primitive === 'propeller')).toBe(true);
    expect(plan.components.filter((item) => item.parameters?.aircraft_navigation_light)).toHaveLength(3);
    expect(plan.components.filter((item) => item.parameters?.aircraft_control_surface).length).toBeGreaterThanOrEqual(3);
  });

  it('preflights a verbose model-authored airplane without exceeding world-tool text limits', () => {
    const prompt = 'Build an airplane with two wings, a propeller and navigation lights.';
    const deterministic = compileDesignBrief(prompt);
    const architecture = [
      'Central fuselage with cockpit and internal structural frame',
      'Two cantilever main wings with separately hinged control surfaces',
      'Tailplane and vertical fin with elevator and rudder mechanisms',
      'Nose motor, supported shaft, bearing, and propeller assembly',
      'Tricycle landing gear mounted to reinforced fuselage hardpoints',
      'Battery, pilot controls, and conventional navigation-light circuit',
    ];
    const intent = agentIntentSchema.parse({
      normalized_prompt: prompt, design_brief: prompt, machine_name: 'Twin-wing propeller airplane', domain: 'Light aviation',
      reasoning_summary: 'Compose a recognizable fixed-wing airplane with supported propulsion, control surfaces, landing gear, and navigation lighting.',
      architecture, assumptions: ['Concept-level rigid-body aircraft'], capabilities: deterministic.goal.capabilities,
      requirements: deterministic.goal.constraints.slice(0, 8),
    });
    const raw = agentPlanFromCompiled(prompt, intent, deterministic);
    const plan = compileAgentPlan(prompt, raw);
    expect(plan.goal.summary.length).toBeLessThanOrEqual(240);
    expect(() => preflightCompiledWorldPlan(plan)).not.toThrow();
  });

  it('builds and contextually edits a four-wheel electric go-kart', () => {
    let state = assemblePlan(compileDesignBrief('Build a four-wheel electric go kart.'));
    expect(state.goal?.machineName).toBe('Electric go-kart');
    expect(state.components.filter((item) => item.parameters.road_vehicle_wheel)).toHaveLength(4);
    const wheelsBefore = new Map(state.components.filter((item) => item.primitive === 'wheel').map((item) => [item.id, item.dimensions[0]]));
    const seatBefore = state.components.find((item) => item.primitive === 'seat')!;
    const seatBeforeX = seatBefore.position[0];
    const edits = contextualMechanicalEdits(state, 'Make the wheels bigger and move the seat backward.');
    expect(edits.filter((item) => item.tool === 'set_dimensions')).toHaveLength(4);
    expect(edits.some((item) => item.tool === 'move_component')).toBe(true);
    for (const edit of edits) state = testCommand(state, edit.tool, edit.input, 'ModelAgent');
    for (const wheel of state.components.filter((item) => item.primitive === 'wheel')) expect(wheel.dimensions[0]).toBeGreaterThan(wheelsBefore.get(wheel.id)!);
    expect(state.components.find((item) => item.id === seatBefore.id)!.position[0]).toBeLessThan(seatBeforeX);

    const lightEdits = contextualMechanicalEdits(state, 'Add a rear brake light and make sure it faces backward.');
    for (const edit of lightEdits) state = testCommand(state, edit.tool, edit.input, 'ModelAgent');
    expect(state.components.find((item) => item.parameters.brake_light)?.parameters.facing_x).toBe(-1);
  });
});

describe('schema-safe tool preparation', () => {
  it('repairs representation-only optional fields before executing a tool', () => {
    const prepared = prepareForgeToolArguments('create_joint', {
      joint_id: 'wheel-joint', joint_type: 'revolute', component_a: 'frame', component_b: 'wheel',
      anchor_a: [0, 0, 0], anchor_b: [0, 0, 0], axis: [0, 0, 1], limits: null, ratio: 0,
      expected_revision: 3, expected_workspace_nonce: 'workspace-nonce',
    });
    expect(prepared.repaired).toBe(true);
    expect(prepared.input).not.toHaveProperty('limits');
    expect(prepared.input).not.toHaveProperty('ratio');
  });

  it('bounds optional goal copy before guarded execution', () => {
    const prepared = prepareForgeToolArguments('set_design_goal', {
      machine_name: 'Airplane', domain: 'Aviation', brief: 'Build a complete propeller airplane.', capabilities: ['structure'],
      constraints: [{ metric: 'component_count', label: 'Parts', operator: 'max', target: 40, unit: '', source: 'inferred' }],
      max_components: 40, summary: 'x'.repeat(420), expected_revision: 0, expected_workspace_nonce: 'workspace-nonce',
    });
    expect(prepared.repaired).toBe(true);
    expect(String(prepared.input.summary)).toHaveLength(240);
  });

  it('does not repair away freshness guards', () => {
    expect(() => prepareForgeToolArguments('move_component', { component_id: 'wheel', position: [1, 1, 1] })).toThrow();
  });
});
