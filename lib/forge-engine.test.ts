import { describe, expect, it } from 'vitest';
import { createInitialForgeState } from './forge-data';
import { applyForgeTool, computeDesignHash } from './forge-engine';
import { compileDesignBrief } from './forge-prompt';
import { localPointToWorld } from './forge-motion';
import { assemblePlan, testCommand } from './forge-test-utils';

describe('ForgeTwin shared world command engine', () => {
  it('creates arbitrary assemblies and physical bodies without a profile ID', () => {
    const plan = compileDesignBrief('Build a rotating inspection hatch with one sensor.');
    const state = assemblePlan(plan);
    expect(state.goal?.brief).toContain('inspection hatch');
    expect(state.assemblies.length).toBeGreaterThan(0);
    expect(state.components.length).toBe(plan.components.length);
    expect(state.joints.length).toBe(plan.joints.length);
    expect(state.designHash).toMatch(/^world-/);
  });

  it('includes dimensions, material, mass, joints, motors, sensors, actuators, and controls in the design hash', () => {
    const plan = compileDesignBrief('Build a patient lift that raises 90 kg by 1 meter.');
    const baseline = assemblePlan(plan);
    const target = baseline.components.find((item) => item.primitive === 'plate')!;
    const resized = testCommand(baseline, 'set_dimensions', { component_id: target.id, dimensions: target.dimensions.map((value) => value * 1.1) });
    expect(resized.designHash).not.toBe(baseline.designHash);
    const rematerialed = testCommand(resized, 'set_material', { component_id: target.id, material_id: 'composite' });
    expect(rematerialed.designHash).not.toBe(resized.designHash);
    const remassed = testCommand(rematerialed, 'set_mass', { component_id: target.id, mass: target.mass + 12 });
    expect(remassed.designHash).not.toBe(rematerialed.designHash);
    expect(computeDesignHash(remassed)).toBe(remassed.designHash);
  });

  it('enforces optimistic concurrency and validates topology', () => {
    const state = assemblePlan(compileDesignBrief('Build a 4:1 gearbox with 120 rpm input.'));
    expect(() => applyForgeTool(state, 'set_mass', { component_id: state.components[0].id, mass: 10, expected_revision: state.revision - 1, expected_workspace_nonce: state.workspaceNonce }, 'WebMCP')).toThrow(/STALE_REVISION/);
    expect(() => testCommand(state, 'create_joint', { joint_id: 'bad-joint', joint_type: 'revolute', component_a: state.components[0].id, component_b: state.components[0].id, anchor_a: [0, 0, 0], anchor_b: [0, 0, 0], axis: [0, 1, 0] })).toThrow(/two different bodies/i);
    expect(() => testCommand(state, 'create_joint', { joint_id: 'bad-gear', joint_type: 'gear', component_a: state.components[0].id, component_b: state.components[1].id, anchor_a: [0, 0, 0], anchor_b: [0, 0, 0], axis: [0, 1, 0] })).toThrow(/positive ratio/i);
  });

  it('locks human-authored fields against agent overwrite and preserves them on restore', () => {
    const original = assemblePlan(compileDesignBrief('Build a crane that lifts 80 kg by 2 meters without tipping.'));
    const target = original.components.find((item) => item.id === original.goal?.editableComponentId)!;
    const revision = original.revisions.at(-1)!.revision;
    const movedPosition: [number, number, number] = [Number((target.position[0] + .7).toFixed(4)), target.position[1], target.position[2]];
    let state = testCommand(original, 'move_component', { component_id: target.id, position: movedPosition }, 'Human');
    expect(state.components.find((item) => item.id === target.id)?.humanLockedFields).toContain('position');
    expect(() => applyForgeTool(state, 'move_component', { component_id: target.id, position: target.position, expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, 'WebMCP')).toThrow(/LOCKED_BY_HUMAN/);
    state = testCommand(state, 'restore_revision', { revision }, 'ModelAgent');
    expect(state.components.find((item) => item.id === target.id)?.position).toEqual(movedPosition);
  });

  it('retargets joint anchors when chat or a human moves a mounted body', () => {
    const original = assemblePlan(compileDesignBrief('Build an electric go-kart with four wheels and steering.'));
    const wheel = original.components.find((item) => item.role === 'front left steering wheel')!;
    const moved = testCommand(original, 'move_component', { component_id: wheel.id, position: [wheel.position[0], wheel.position[1], wheel.position[2] + .2] }, 'ModelAgent');
    const updatedWheel = moved.components.find((item) => item.id === wheel.id)!;
    const mount = moved.joints.find((item) => item.componentA === wheel.id || item.componentB === wheel.id)!;
    const other = moved.components.find((item) => item.id === (mount.componentA === wheel.id ? mount.componentB : mount.componentA))!;
    const wheelAnchor = mount.componentA === wheel.id ? mount.anchorA : mount.anchorB;
    const otherAnchor = mount.componentA === wheel.id ? mount.anchorB : mount.anchorA;
    const wheelWorld = localPointToWorld(updatedWheel.position, updatedWheel.rotation, wheelAnchor);
    const otherWorld = localPointToWorld(other.position, other.rotation, otherAnchor);
    expect(wheelWorld[0]).toBeCloseTo(otherWorld[0], 4);
    expect(wheelWorld[1]).toBeCloseTo(otherWorld[1], 4);
    expect(wheelWorld[2]).toBeCloseTo(otherWorld[2], 4);
    expect(updatedWheel.position[2]).toBeCloseTo(wheel.position[2] + .2, 4);
  });

  it('rejects invalid body properties and cascades topology deletion safely', () => {
    const plan = compileDesignBrief('Build a robotic arm with a gripper that reaches 2 meters.');
    let state = assemblePlan(plan);
    const component = state.components[1];
    expect(() => testCommand(state, 'set_dimensions', { component_id: component.id, dimensions: [-1, 1, 1] })).toThrow(/dimensions/i);
    expect(() => testCommand(state, 'set_mass', { component_id: component.id, mass: Number.NaN })).toThrow(/mass/i);
    const attached = state.joints.filter((item) => item.componentA === component.id || item.componentB === component.id);
    state = testCommand(state, 'remove_component', { component_id: component.id });
    expect(state.components.some((item) => item.id === component.id)).toBe(false);
    expect(state.joints.some((item) => attached.some((removed) => removed.id === item.id))).toBe(false);
  });

  it('keeps deterministic world fields immutable and rejects duplicate graph ids', () => {
    const initial = createInitialForgeState('lab');
    const plan = compileDesignBrief('Build a rotating inspection hatch with one sensor.');
    const guarded = { expected_revision: initial.revision, expected_workspace_nonce: initial.workspaceNonce };
    expect(() => applyForgeTool(initial, 'set_design_goal', { ...guarded, machine_name: plan.goal.machineName, domain: plan.goal.domain, brief: plan.brief, capabilities: plan.goal.capabilities, constraints: plan.goal.constraints, max_components: plan.goal.maxComponents, world: { seed: 7 } }, 'UI')).toThrow(/immutable/i);
    const state = assemblePlan(plan);
    const sensor = state.sensors[0];
    expect(() => testCommand(state, 'add_sensor', { sensor_id: sensor.id, component_id: sensor.componentId, sensor_type: sensor.type, channel: sensor.channel, range: sensor.range })).toThrow(/already exists/i);
    expect(state.world).toMatchObject({ timestepHz: 60, seed: 424242 });
  });

  it('removes dangling control channels when devices or joints are deleted', () => {
    let state = assemblePlan(compileDesignBrief('Build a robotic arm with a camera and gripper that reaches 2 meters.'));
    const actuator = state.actuators[0];
    const controlId = state.controls.find((item) => item.actuatorIds.includes(actuator.id))!.id;
    state = testCommand(state, 'remove_joint', { joint_id: actuator.jointId });
    expect(state.controls.find((item) => item.id === controlId)?.actuatorIds).not.toContain(actuator.id);
    const sensor = state.sensors[0];
    state = testCommand(state, 'remove_component', { component_id: sensor.componentId });
    expect(state.controls.some((item) => item.sensorIds.includes(sensor.id))).toBe(false);
  });

  it('retunes existing motors, sensors, actuators, and controllers without recreating devices', () => {
    let state = assemblePlan(compileDesignBrief('Build a conveyor system that sorts red and blue boxes into separate bins at 20 boxes per minute.'));
    const motor = state.motors[0], sensor = state.sensors[0], actuator = state.actuators[0], control = state.controls[0];
    state = testCommand(state, 'set_motor_speed', { motor_id: motor.id, max_rpm: 75, direction: -1 }, 'ModelAgent');
    state = testCommand(state, 'set_sensor_range', { sensor_id: sensor.id, range: 8 }, 'ModelAgent');
    state = testCommand(state, 'set_actuator_timing', { actuator_id: actuator.id, max_speed: .35, travel: .8 }, 'ModelAgent');
    state = testCommand(state, 'update_control_logic', { control_id: control.id, expression: 'hold the tool pose at the requested target', setpoint: 1.25, kp: .7, ki: .03, kd: .12 }, 'ModelAgent');
    expect(state.motors.find((item) => item.id === motor.id)).toMatchObject({ maxRpm: 75, direction: -1 });
    expect(state.sensors.find((item) => item.id === sensor.id)?.range).toBe(8);
    expect(state.actuators.find((item) => item.id === actuator.id)).toMatchObject({ maxSpeed: .35, travel: .8 });
    expect(state.controls.find((item) => item.id === control.id)).toMatchObject({ setpoint: 1.25, kp: .7, ki: .03, kd: .12 });
  });

  it('preserves dependent mass, color, and all human lock metadata across restore', () => {
    let state = assemblePlan(compileDesignBrief('Build a patient lift that raises 90 kg by 1 meter.'));
    const revision = state.revisions.at(-1)!.revision;
    const target = state.components.find((item) => item.primitive === 'plate')!;
    const dimensions = target.dimensions.map((value) => Number((value * 1.2).toFixed(3)));
    state = testCommand(state, 'set_dimensions', { component_id: target.id, dimensions }, 'Human');
    state = testCommand(state, 'set_material', { component_id: target.id, material_id: 'composite' }, 'Human');
    const locked = state.components.find((item) => item.id === target.id)!;
    const expected = { dimensions: locked.dimensions, materialId: locked.materialId, color: locked.color, mass: locked.mass };
    state = testCommand(state, 'restore_revision', { revision }, 'ModelAgent');
    expect(state.components.find((item) => item.id === target.id)).toMatchObject(expected);
    expect(state.humanConstraints.find((item) => item.componentId === target.id)?.fields).toEqual(expect.arrayContaining(['dimensions', 'material']));
  });

  it('lets the human Undo restore an earlier revision exactly', () => {
    let state = assemblePlan(compileDesignBrief('Build a patient lift that raises 90 kg by 1 meter.'));
    const target = state.components.find((item) => item.primitive === 'plate')!;
    const originalX = target.position[0];
    const revision = state.revisions.at(-1)!.revision;
    state = testCommand(state, 'move_component', { component_id: target.id, position: [originalX + 1, target.position[1], target.position[2]] }, 'Human');
    expect(state.components.find((item) => item.id === target.id)?.position[0]).toBe(originalX + 1);
    state = testCommand(state, 'restore_revision', { revision }, 'UI');
    expect(state.components.find((item) => item.id === target.id)?.position[0]).toBe(originalX);
    expect(state.components.find((item) => item.id === target.id)?.humanLockedFields).not.toContain('position');
  });

  it('starts from a clean schema-v3 world', () => {
    expect(createInitialForgeState('lab')).toMatchObject({ schemaVersion: 3, goal: null, assemblies: [], components: [], joints: [], optimizationLevel: 0 });
  });
});
