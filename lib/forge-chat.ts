import type { ForgeState } from './forge-types';

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
