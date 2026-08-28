import { createInitialForgeState } from './forge-data';
import { applyForgeTool } from './forge-engine';
import type { Actor, CompiledWorldPlan, ForgeState, ForgeToolName } from './forge-types';

export function testCommand(state: ForgeState, name: ForgeToolName, input: Record<string, unknown>, actor: Actor = 'UI') {
  return applyForgeTool(state, name, { ...input, expected_revision: state.revision, expected_workspace_nonce: state.workspaceNonce }, actor).state;
}

export function assemblePlan(plan: CompiledWorldPlan) {
  let state = createInitialForgeState('lab');
  state = testCommand(state, 'set_design_goal', { machine_name: plan.goal.machineName, domain: plan.goal.domain, brief: plan.brief, summary: plan.goal.summary, capabilities: plan.goal.capabilities, constraints: plan.goal.constraints, max_components: plan.goal.maxComponents, assumptions: plan.assumptions, disclaimer: plan.goal.disclaimer, simulation_model: plan.goal.simulationModel, editable_component_id: plan.goal.editableComponentId, editable_label: plan.goal.editableLabel, world: { gravity: plan.world.gravity, duration: plan.world.duration, bounds: plan.world.bounds, environment: plan.world.environment } });
  for (const item of plan.assemblies) state = testCommand(state, 'create_assembly', { assembly_id: item.id, name: item.name, purpose: item.purpose, parent_id: item.parentId });
  for (const item of plan.components) state = testCommand(state, 'create_component', { component_id: item.id, primitive: item.primitive, assembly_id: item.assemblyId, role: item.role, position: item.position, rotation: item.rotation, dimensions: item.dimensions, material_id: item.materialId, body_type: item.bodyType, mass: item.mass, color: item.color, parameters: item.parameters });
  for (const item of plan.connections) state = testCommand(state, 'connect_components', { connection_id: item.id, source_id: item.sourceId, target_id: item.targetId, connection_type: item.type, channel: item.channel });
  for (const item of plan.joints) state = testCommand(state, 'create_joint', { joint_id: item.id, joint_type: item.type, component_a: item.componentA, component_b: item.componentB, anchor_a: item.anchorA, anchor_b: item.anchorB, axis: item.axis, limits: item.limits, ratio: item.ratio, stiffness: item.stiffness, damping: item.damping });
  for (const item of plan.motors) state = testCommand(state, 'add_motor', { motor_id: item.id, component_id: item.componentId, joint_id: item.jointId, max_torque: item.maxTorque, max_rpm: item.maxRpm, direction: item.direction });
  for (const item of plan.sensors) state = testCommand(state, 'add_sensor', { sensor_id: item.id, component_id: item.componentId, sensor_type: item.type, channel: item.channel, target_id: item.targetId, range: item.range });
  for (const item of plan.actuators) state = testCommand(state, 'add_actuator', { actuator_id: item.id, component_id: item.componentId, joint_id: item.jointId, actuator_type: item.type, max_force: item.maxForce, max_speed: item.maxSpeed, travel: item.travel });
  for (const item of plan.controls) state = testCommand(state, 'set_control_logic', { control_id: item.id, name: item.name, mode: item.mode, sensor_ids: item.sensorIds, actuator_ids: item.actuatorIds, expression: item.expression, setpoint: item.setpoint, kp: item.kp, ki: item.ki, kd: item.kd, calibration_x: item.calibrationX });
  return state;
}
