import { describe, expect, it } from 'vitest';
import { agentEditSchema, validateAgentEditSemantics, type AgentEdit, type EditContext } from './forge-agent';

function editContext(): EditContext {
  return {
    revision: 7,
    design_hash: 'world-edit-test',
    machine_name: 'Instrumented test arm',
    goal: 'Build a grounded motorized arm with feedback control.',
    max_components: 12,
    selected_component_id: 'moving-arm',
    world: { gravity: [0, -9.81, 0], bounds: [12, 8, 10], environment: 'test cell' },
    goal_constraints: [],
    assemblies: [{ id: 'machine', name: 'Machine', purpose: 'Edit validation fixture', parent_id: '' }],
    components: [
      { id: 'ground-base', role: 'grounded support base', primitive: 'support', assembly_id: 'machine', position: [0, .2, 0], rotation: [0, 0, 0], dimensions: [2, .4, 1.5], material_id: 'steel', body_type: 'fixed', mass: 30, color: '#334155', parameters: {}, human_locked_fields: [] },
      { id: 'moving-arm', role: 'pivoting output arm', primitive: 'beam', assembly_id: 'machine', position: [1, 1.2, 0], rotation: [0, 0, .2], dimensions: [2, .2, .2], material_id: 'aluminum', body_type: 'dynamic', mass: 6, color: '#94a3b8', parameters: {}, human_locked_fields: [] },
      { id: 'drive-motor-body', role: 'arm drive motor', primitive: 'motor', assembly_id: 'machine', position: [0, .8, .35], rotation: [0, 0, 0], dimensions: [.4, .3, .3], material_id: 'steel', body_type: 'fixed', mass: 4, color: '#0ea5e9', parameters: {}, human_locked_fields: [] },
      { id: 'angle-sensor-body', role: 'arm angle encoder', primitive: 'sensor', assembly_id: 'machine', position: [0, .9, -.3], rotation: [0, 0, 0], dimensions: [.2, .2, .2], material_id: 'polymer', body_type: 'fixed', mass: .2, color: '#22d3ee', parameters: {}, human_locked_fields: [] },
    ],
    connections: [
      { id: 'motor-mount', source_id: 'ground-base', target_id: 'drive-motor-body', connection_type: 'mechanical', channel: 'mount' },
      { id: 'sensor-mount', source_id: 'ground-base', target_id: 'angle-sensor-body', connection_type: 'mechanical', channel: 'mount' },
    ],
    joints: [{ id: 'arm-pivot', joint_type: 'revolute', component_a: 'ground-base', component_b: 'moving-arm', axis: [0, 0, 1], limits: [-.4, .9], ratio: null, stiffness: null, damping: null }],
    motors: [{ id: 'arm-drive', component_id: 'drive-motor-body', joint_id: 'arm-pivot', max_torque: 120, max_rpm: 30, direction: 1 }],
    sensors: [{ id: 'arm-angle', component_id: 'angle-sensor-body', sensor_type: 'angle', channel: 'arm_angle', target_id: 'moving-arm', range: 3.14 }],
    actuators: [{ id: 'arm-servo', component_id: 'drive-motor-body', joint_id: 'arm-pivot', actuator_type: 'servo', max_force: 1500, max_speed: 1.2, travel: 1.3 }],
    controls: [{ id: 'arm-control', name: 'Arm angle loop', mode: 'pid', sensor_ids: ['arm-angle'], actuator_ids: ['arm-servo'], motor_ids: [], expression: 'hold arm angle at setpoint', setpoint: .2, kp: .8, ki: .03, kd: .1 }],
    latest_run: { status: 'passed', score: 96, failed_metrics: [] },
    conversation: [],
  };
}

function resolved(actions: AgentEdit['actions'], targetIds: string[], overrides: Partial<AgentEdit> = {}) {
  return agentEditSchema.parse({
    understanding: 'Apply the requested bounded in-place mechanical revision.',
    needs_clarification: false,
    clarification_question: '',
    target_ids: targetIds,
    preserve_ids: [],
    requested_invariants: ['Keep all unmentioned geometry and functional links unchanged'],
    actions,
    verification: ['Confirm the requested value and affected functional graph after the edit'],
    ...overrides,
  });
}

describe('ForgeTwin chat-edit semantic guard', () => {
  it('accepts precise geometry and material changes but protects human-authored fields', () => {
    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_dimensions', component_id: 'moving-arm', dimensions: [2.4, .22, .22] },
      { tool: 'set_material', component_id: 'moving-arm', material_id: 'composite' },
      { tool: 'set_mass', component_id: 'moving-arm', mass: 5.5 },
    ], ['moving-arm']), context)).not.toThrow();

    context.components.find((item) => item.id === 'moving-arm')!.human_locked_fields = ['dimensions'];
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_dimensions', component_id: 'moving-arm', dimensions: [2.4, .22, .22] },
    ], ['moving-arm']), context)).toThrow(/human-locked dimensions/i);
  });

  it('requires truthful targets and observable user-facing verification', () => {
    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_material', component_id: 'moving-arm', material_id: 'composite' },
    ], ['moving-arm', 'ground-base']), context)).toThrow(/ground-base is not changed/i);
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_material', component_id: 'moving-arm', material_id: 'composite' },
    ], ['moving-arm'], { verification: [] }), context)).toThrow(/observable verification/i);
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_material', component_id: 'moving-arm', material_id: 'composite' },
    ], ['moving-arm'], { clarification_question: 'Which arm?' }), context)).toThrow(/clarification_question empty/i);
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_material', component_id: 'moving-arm', material_id: 'composite' },
    ], ['moving-arm', 'moving-arm']), context)).toThrow(/target IDs must be unique/i);
  });

  it('accounts for the full functional graph when retuning motors, sensors, actuators, and controls', () => {
    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_motor_speed', motor_id: 'arm-drive', max_rpm: 24, direction: -1 },
      { tool: 'set_sensor_range', sensor_id: 'arm-angle', range: 2.5 },
      { tool: 'set_actuator_timing', actuator_id: 'arm-servo', max_speed: .8, travel: 1.1 },
      { tool: 'update_control_logic', control_id: 'arm-control', expression: 'hold 0.35 rad without overshoot', setpoint: .35, kp: .7, ki: .02, kd: .14 },
    ], ['drive-motor-body', 'ground-base', 'moving-arm', 'angle-sensor-body']), context)).not.toThrow();

    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_motor_speed', motor_id: 'arm-drive', max_rpm: 24, direction: 1 },
    ], ['drive-motor-body']), context)).toThrow(/ground-base.*target_ids/i);
  });

  it('accepts an explicitly powered conveyor body as affected by a motor-speed edit', () => {
    const context = editContext();
    context.components.push({ id: 'conveyor-bed', role: 'powered rubber belt conveyor', primitive: 'conveyor', assembly_id: 'machine', position: [0, .5, 1.2], rotation: [0, 0, 0], dimensions: [3, .3, 1], material_id: 'steel', body_type: 'fixed', mass: 20, color: '#475569', parameters: {}, human_locked_fields: [] });
    context.connections.push({ id: 'belt-power', source_id: 'drive-motor-body', target_id: 'conveyor-bed', connection_type: 'power', channel: 'belt-drive' });
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_motor_speed', motor_id: 'arm-drive', max_rpm: 36, direction: 1 },
    ], ['drive-motor-body', 'ground-base', 'moving-arm', 'conveyor-bed']), context)).not.toThrow();
  });

  it('rejects inert drives and controllers without a controlled actuator', () => {
    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'add_motor', motor_id: 'spare-drive', component_id: 'drive-motor-body', joint_id: '', max_torque: 20, max_rpm: 100, direction: 1 },
    ], ['drive-motor-body']), context)).toThrow(/references missing ID|motion-capable joint/i);

    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_control_logic', control_id: 'monitor-only', name: 'Monitor only', mode: 'threshold', sensor_ids: ['arm-angle'], actuator_ids: [], motor_ids: [], expression: 'observe angle', setpoint: .5, kp: 0, ki: 0, kd: 0 },
    ], ['angle-sensor-body', 'moving-arm']), context)).toThrow(/at least one actuator/i);
  });

  it('accepts a motor-only feedback controller without inventing an actuator', () => {
    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'set_control_logic', control_id: 'motor-speed-loop', name: 'Arm drive speed', mode: 'pid', sensor_ids: ['arm-angle'], actuator_ids: [], motor_ids: ['arm-drive'], expression: 'hold the motorized arm at the commanded rate', setpoint: .5, kp: .7, ki: .02, kd: .1 },
    ], ['angle-sensor-body', 'moving-arm', 'drive-motor-body', 'ground-base']), context)).not.toThrow();
  });

  it('allows a recognizable mounted addition and rejects signal-only floating hardware', () => {
    const context = editContext();
    const headlight = { tool: 'create_component' as const, component_id: 'work-light', primitive: 'light' as const, assembly_id: 'machine', role: 'forward LED work light', position: [.8, 1.1, .4] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], dimensions: [.3, .2, .2] as [number, number, number], material_id: 'polymer' as const, body_type: 'fixed' as const, mass: .25, color: '#e9f5ff', semantic_tags: ['headlight'] };
    expect(() => validateAgentEditSemantics(resolved([
      headlight,
      { tool: 'connect_components', connection_id: 'light-mount', source_id: 'ground-base', target_id: 'work-light', connection_type: 'mechanical', channel: 'mount' },
    ], ['ground-base', 'work-light']), context)).not.toThrow();

    expect(() => validateAgentEditSemantics(resolved([
      headlight,
      { tool: 'connect_components', connection_id: 'light-signal', source_id: 'angle-sensor-body', target_id: 'work-light', connection_type: 'signal', channel: 'light_command' },
    ], ['angle-sensor-body', 'work-light']), context)).toThrow(/physical connection or joint/i);
  });

  it('mirrors removal cascades so later actions cannot address deleted devices', () => {
    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'remove_component', component_id: 'moving-arm' },
      { tool: 'set_motor_speed', motor_id: 'arm-drive', max_rpm: 15, direction: 1 },
    ], ['moving-arm', 'ground-base', 'drive-motor-body', 'angle-sensor-body']), context)).toThrow(/motor speed edit references missing ID/i);

    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'remove_component', component_id: 'moving-arm' },
    ], ['moving-arm', 'ground-base', 'drive-motor-body', 'angle-sensor-body']), context)).not.toThrow();

    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'remove_component', component_id: 'drive-motor-body' },
    ], ['drive-motor-body']), editContext())).toThrow(/ground-base.*target_ids/i);
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'remove_component', component_id: 'drive-motor-body' },
    ], ['drive-motor-body', 'ground-base', 'moving-arm', 'angle-sensor-body']), editContext())).not.toThrow();
  });

  it('rejects removal of a human-locked body or a joint that strands the mechanism', () => {
    const lockedContext = editContext();
    lockedContext.components.find((item) => item.id === 'moving-arm')!.human_locked_fields = ['position'];
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'remove_component', component_id: 'moving-arm' },
    ], ['moving-arm', 'ground-base', 'drive-motor-body', 'angle-sensor-body']), lockedContext)).toThrow(/cannot remove human-locked/i);

    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'remove_joint', joint_id: 'arm-pivot' },
    ], ['ground-base', 'moving-arm', 'drive-motor-body', 'angle-sensor-body']), context)).toThrow(/mechanically disconnected/i);
  });

  it('rejects duplicate graph edges before an atomic batch reaches the engine', () => {
    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'connect_components', connection_id: 'duplicate-mount', source_id: 'ground-base', target_id: 'drive-motor-body', connection_type: 'mechanical', channel: 'second_mount' },
    ], ['ground-base', 'drive-motor-body']), context)).toThrow(/duplicates an existing mechanical edge/i);
  });

  it('rejects duplicate joints and motion joints between two fixed bodies', () => {
    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'create_joint', joint_id: 'second-arm-pivot', joint_type: 'revolute', component_a: 'ground-base', component_b: 'moving-arm', axis: [0, 0, 1], limits: [-.5, .5], ratio: 0, stiffness: 0, damping: 0 },
    ], ['ground-base', 'moving-arm']), context)).toThrow(/duplicates an existing joint/i);

    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'create_joint', joint_id: 'fixed-body-hinge', joint_type: 'revolute', component_a: 'ground-base', component_b: 'drive-motor-body', axis: [0, 0, 1], limits: [-.5, .5], ratio: 0, stiffness: 0, damping: 0 },
    ], ['ground-base', 'drive-motor-body']), context)).toThrow(/two fixed bodies/i);
  });

  it('rejects a newly added drive whose component_b endpoint cannot move', () => {
    const context = editContext();
    expect(() => validateAgentEditSemantics(resolved([
      { tool: 'create_joint', joint_id: 'reversed-drive-joint', joint_type: 'revolute', component_a: 'moving-arm', component_b: 'angle-sensor-body', axis: [0, 0, 1], limits: [-.4, .4], ratio: 0, stiffness: 0, damping: 0 },
      { tool: 'add_motor', motor_id: 'reversed-drive', component_id: 'drive-motor-body', joint_id: 'reversed-drive-joint', max_torque: 40, max_rpm: 20, direction: 1 },
    ], ['moving-arm', 'angle-sensor-body', 'drive-motor-body']), context)).toThrow(/movable component_b/i);
  });
});
