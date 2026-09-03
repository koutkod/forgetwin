import { catalogFor } from './forge-data';
import { normalizeEngineeringIntent } from './forge-intent';
import type { ForgeState, ForgeToolName, MachineComponent, Vec3 } from './forge-types';

export type ChatMessage = {
  role: 'user' | 'agent';
  text: string;
  kind?: 'message' | 'clarification';
};

export type ConveyorSpeedEdit = {
  motorId: string;
  previousRpm: number;
  maxRpm: number;
  direction: number;
};

export type ContextualMechanicalEdit = { tool: ForgeToolName; input: Record<string, unknown>; label: string };

function uniqueId(state: ForgeState, prefix: string) {
  const used = new Set([
    ...state.components.map((item) => item.id), ...state.connections.map((item) => item.id),
    ...state.joints.map((item) => item.id), ...state.motors.map((item) => item.id),
  ]);
  let index = 1; let candidate = `${prefix}-${index}`;
  while (used.has(candidate)) { index += 1; candidate = `${prefix}-${index}`; }
  return candidate.slice(0, 64);
}

function stationaryRearLightMount(state: ForgeState) {
  const ordered = [
    /seat post/, /seat stay/, /rear.*(?:frame|rack|crossmember|bumper|chassis)/,
    /tail.*(?:frame|support)/, /chassis rail/, /frame/, /body/,
  ];
  for (const expression of ordered) {
    const match = state.components.find((component) => component.bodyType !== 'dynamic' && component.primitive !== 'wheel' && expression.test(component.role.toLowerCase()));
    if (match) return match;
  }
  return state.components.find((component) => component.bodyType === 'fixed' && component.primitive !== 'wheel');
}

function rearLightPosition(state: ForgeState, mount: MachineComponent): Vec3 {
  const vehicleParts = state.components.filter((item) => item.primitive !== 'light' && !item.parameters.product_form);
  const rearX = vehicleParts.length ? Math.min(...vehicleParts.map((item) => item.position[0] - item.dimensions[0] / 2)) : mount.position[0] - .25;
  const bicycle = state.components.some((item) => item.parameters.bicycle_wheel === true);
  return [Number((bicycle ? Math.max(rearX + .18, mount.position[0] - .24) : rearX - .04).toFixed(3)), Number((mount.position[1] + (bicycle ? .04 : .12)).toFixed(3)), mount.position[2]];
}

/** Resolve high-confidence, multi-action engineering edits before asking a
 * model. These are semantic operations, not templates: they inspect the live
 * world, choose existing supports, and preserve every unrelated body. */
export function contextualMechanicalEdits(state: ForgeState, instruction: string): ContextualMechanicalEdit[] {
  const text = normalizeEngineeringIntent(instruction, `${state.goal?.machineName ?? ''} ${state.goal?.domain ?? ''}`).normalizedRequest.toLowerCase();
  const commands: ContextualMechanicalEdit[] = [];
  const addBrakeLight = /\b(?:add|attach|create|install|put)\b[^.]{0,55}\b(?:brake|rear|tail) lights?\b/.test(text);
  if (addBrakeLight && !state.components.some((component) => component.primitive === 'light' && /brake|tail|rear.*light/.test(component.role.toLowerCase()))) {
    const mount = stationaryRearLightMount(state);
    if (!mount) return [];
    const lightSpec = catalogFor('light');
    const lightId = uniqueId(state, 'chat-rear-brake-light');
    const edgeId = uniqueId(state, 'chat-brake-light-edge');
    const jointId = uniqueId(state, 'chat-brake-light-joint');
    const position = rearLightPosition(state, mount);
    const anchorA = position.map((value, index) => Number((value - mount.position[index]).toFixed(3))) as Vec3;
    commands.push(
      { tool: 'create_component', input: { component_id: lightId, primitive: 'light', assembly_id: mount.assemblyId, role: 'rear LED brake light', position, rotation: [0, 0, 0], dimensions: [.22, .15, .16], material_id: lightSpec.defaultMaterial, body_type: 'fixed', mass: .16, color: '#ff313d', parameters: { brake_light: true, vehicle_light: true, light_direction: 'rear', facing_x: -1, beam_range: 2.1 } }, label: 'Create rear-facing brake light' },
      { tool: 'connect_components', input: { connection_id: edgeId, source_id: mount.id, target_id: lightId, connection_type: 'mechanical', channel: 'rear_light_bracket' }, label: `Mount brake light to ${mount.role}` },
      { tool: 'create_joint', input: { joint_id: jointId, joint_type: 'fixed', component_a: mount.id, component_b: lightId, anchor_a: anchorA, anchor_b: [0, 0, 0], axis: [0, 1, 0] }, label: 'Fix brake light to stationary support' },
    );
    const power = state.components.find((component) => component.primitive === 'battery' || /battery/.test(component.role.toLowerCase()));
    if (power) commands.push({ tool: 'connect_components', input: { connection_id: uniqueId(state, 'chat-brake-light-power'), source_id: power.id, target_id: lightId, connection_type: 'power', channel: 'brake_light_bus' }, label: 'Connect brake light power' });
  }

  const resizeWheels = /\b(?:wheels?)\b[^.]{0,35}\b(?:bigger|larger|enlarge|increase|resize)\b|\b(?:bigger|larger|enlarge)\b[^.]{0,35}\bwheels?\b/.test(text);
  if (resizeWheels) {
    for (const wheel of state.components.filter((component) => component.primitive === 'wheel')) {
      const dimensions = wheel.dimensions.map((value, index) => Number((value * (index === 1 ? 1.08 : 1.2)).toFixed(3))) as Vec3;
      commands.push({ tool: 'set_dimensions', input: { component_id: wheel.id, dimensions }, label: `Enlarge ${wheel.role}` });
    }
  }
  const moveSeatRearward = /\b(?:seat|saddle)\b[^.]{0,45}\b(?:back|backward|rearward)\b|\bmove\b[^.]{0,25}\b(?:seat|saddle)\b[^.]{0,25}\bback/.test(text);
  if (moveSeatRearward) {
    const seat = state.components.find((component) => component.primitive === 'seat')
      ?? state.components.find((component) => /\b(?:rider|driver|operator|passenger)?\s*(?:seat|saddle)\b/.test(component.role.toLowerCase())
        && !/\b(?:seat post|seat stay|seat tube|seat rail|seat crossmember|seat support)\b/.test(component.role.toLowerCase()));
    if (seat) commands.push({ tool: 'move_component', input: { component_id: seat.id, position: [Number((seat.position[0] - .25).toFixed(3)), seat.position[1], seat.position[2]] }, label: `Move ${seat.role} rearward` });
  }
  const movePedals = /\b(?:move|shift|position)\b[^.]{0,45}\bpedals?\b|\bpedals?\b[^.]{0,45}\b(?:back|forward|up|down|left|right)\b/.test(text);
  if (movePedals) {
    const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(cm|centimeters?|m|meters?|mm|millimeters?)/);
    const amount = amountMatch ? Number(amountMatch[1]) * (amountMatch[2] === 'mm' || amountMatch[2].startsWith('mill') ? .001 : amountMatch[2].startsWith('c') ? .01 : 1) : .15;
    const delta: Vec3 = /\b(?:back|backward|rearward)\b/.test(text) ? [-amount, 0, 0]
      : /\bforward\b/.test(text) ? [amount, 0, 0]
        : /\bup(?:ward)?\b/.test(text) ? [0, amount, 0]
          : /\bdown(?:ward)?\b/.test(text) ? [0, -amount, 0]
            : /\bleft\b/.test(text) ? [0, 0, -amount] : /\bright\b/.test(text) ? [0, 0, amount] : [-amount, 0, 0];
    for (const pedal of state.components.filter((component) => component.parameters.bicycle_pedal || component.primitive === 'pedal')) {
      commands.push({ tool: 'move_component', input: { component_id: pedal.id, position: pedal.position.map((value, index) => Number((value + delta[index]).toFixed(3))) as Vec3 }, label: `Move ${pedal.role} ${Math.round(amount * 100)} cm` });
    }
  }
  return commands;
}

export function pendingClarification(messages: ChatMessage[]) {
  const questionIndex = messages.findLastIndex((message) => message.role === 'agent' && message.kind === 'clarification');
  if (questionIndex < 0 || messages.slice(questionIndex + 1).some((message) => message.role === 'agent')) return null;
  const request = messages.slice(0, questionIndex).findLast((message) => message.role === 'user');
  if (!request) return null;
  return { request: request.text, question: messages[questionIndex].text };
}

export function resolvedEditPrompt(messages: ChatMessage[], answer: string) {
  const pending = pendingClarification(messages);
  if (!pending) return answer.trim().slice(0, 300);
  const request = pending.request.replace(/\s+/g, ' ').trim().slice(0, 95);
  const question = pending.question.replace(/\s+/g, ' ').trim().slice(0, 65);
  const response = answer.replace(/\s+/g, ' ').trim().slice(0, 70);
  return `Execute the resolved edit now. Original: "${request}" Question: "${question}" Answer: "${response}" Do not ask the same question again.`.slice(0, 300);
}

function speedScale(instruction: string) {
  const text = instruction.toLowerCase();
  if (!/\b(conveyor|belt|material line|package line|sorting line|roller zone|accumulation)\b/.test(text)) return null;
  const faster = /\b(faster|speed up|increase(?: the)? speed|raise(?: the)? speed|accelerate)\b/.test(text);
  const slower = /\b(slower|slow down|decrease(?: the)? speed|reduce(?: the)? speed|decelerate)\b/.test(text);
  if (faster === slower) return null;
  const requestedPercent = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/)?.[1] ?? 20);
  const boundedPercent = Math.max(1, Math.min(80, requestedPercent));
  return faster ? 1 + boundedPercent / 100 : Math.max(.1, 1 - boundedPercent / 100);
}

export function conveyorSpeedEdits(state: ForgeState, instruction: string): ConveyorSpeedEdit[] {
  const scale = speedScale(instruction);
  if (scale === null) return [];
  const conveyorIds = new Set(state.components
    .filter((component) => component.primitive === 'conveyor' || component.parameters.accumulation_zone || component.parameters.conveyor)
    .map((component) => component.id));
  if (!conveyorIds.size) return [];

  const connectedMotorBodies = new Set<string>();
  for (const connection of state.connections) {
    if (connection.type !== 'power') continue;
    if (conveyorIds.has(connection.sourceId)) connectedMotorBodies.add(connection.targetId);
    if (conveyorIds.has(connection.targetId)) connectedMotorBodies.add(connection.sourceId);
  }
  for (const joint of state.joints) {
    if (!conveyorIds.has(joint.componentA) && !conveyorIds.has(joint.componentB)) continue;
    for (const motor of state.motors) if (motor.jointId === joint.id) connectedMotorBodies.add(motor.componentId);
  }

  const related = state.motors.filter((motor) => {
    const body = state.components.find((component) => component.id === motor.componentId);
    return connectedMotorBodies.has(motor.componentId)
      || conveyorIds.has(motor.componentId)
      || Boolean(body && /conveyor|belt|roller|zone|line drive/.test(`${body.role} ${Object.values(body.parameters).join(' ')}`.toLowerCase()));
  });

  return related.map((motor) => ({
    motorId: motor.id,
    previousRpm: motor.maxRpm,
    maxRpm: Number(Math.max(1, Math.min(3_000, motor.maxRpm * scale)).toFixed(2)),
    direction: motor.direction,
  }));
}
