import { describe, expect, it } from 'vitest';
import { conveyorSpeedEdits, directMotorSpeedEdits, pendingClarification, resolvedEditPrompt } from './forge-chat';
import type { ForgeState } from './forge-types';

function conveyorState(): ForgeState {
  return {
    components: [
      { id: 'belt-a', primitive: 'conveyor', parameters: {}, role: 'powered conveyor' },
      { id: 'belt-b', primitive: 'conveyor', parameters: { accumulation_zone: true }, role: 'accumulation conveyor' },
      { id: 'drive-a', primitive: 'motor', parameters: {}, role: 'conveyor line drive' },
      { id: 'drive-b', primitive: 'motor', parameters: {}, role: 'roller zone drive' },
    ],
    connections: [
      { id: 'power-a', sourceId: 'drive-a', targetId: 'belt-a', type: 'power', channel: 'drive' },
      { id: 'power-b', sourceId: 'drive-b', targetId: 'belt-b', type: 'power', channel: 'drive' },
    ],
    joints: [],
    motors: [
      { id: 'motor-a', componentId: 'drive-a', maxRpm: 100, direction: 1 },
      { id: 'motor-b', componentId: 'drive-b', maxRpm: 80, direction: -1 },
    ],
  } as unknown as ForgeState;
}

describe('chat clarification state', () => {
  const conversation = [
    { role: 'user' as const, text: 'Make the conveyor faster' },
    { role: 'agent' as const, kind: 'clarification' as const, text: 'Which conveyor zone should I speed up?' },
  ];

  it('recognizes an unanswered clarification', () => {
    expect(pendingClarification(conversation)).toEqual({
      request: 'Make the conveyor faster',
      question: 'Which conveyor zone should I speed up?',
    });
  });

  it('turns the next answer into one resolved executable prompt', () => {
    const resolved = resolvedEditPrompt(conversation, 'All of them');
    expect(resolved).toContain('Original: "Make the conveyor faster"');
    expect(resolved).toContain('Answer: "All of them"');
    expect(resolved).toContain('Do not ask the same question again');
    expect(resolved.length).toBeLessThanOrEqual(300);
  });
});

describe('bounded conveyor speed edits', () => {
  it('speeds every coordinated conveyor drive by 20% without clarification', () => {
    expect(conveyorSpeedEdits(conveyorState(), 'Make the conveyor belt faster')).toEqual([
      { motorId: 'motor-a', previousRpm: 100, maxRpm: 120, direction: 1 },
      { motorId: 'motor-b', previousRpm: 80, maxRpm: 96, direction: -1 },
    ]);
  });

  it('honors an explicit slower percentage', () => {
    expect(conveyorSpeedEdits(conveyorState(), 'Slow down the material line by 25%').map((edit) => edit.maxRpm)).toEqual([75, 60]);
  });

  it('does not hijack unrelated speed requests', () => {
    expect(conveyorSpeedEdits(conveyorState(), 'Make the rover wheels faster')).toEqual([]);
  });
});

describe('explicit motor speed edits', () => {
  it('retunes a non-conveyor vehicle drive to the requested rpm', () => {
    const state = conveyorState();
    state.components = [{ id: 'traction-drive', primitive: 'motor', parameters: {}, role: 'electric motorcycle drive motor' }] as ForgeState['components'];
    state.motors = [{ id: 'motor-drive', componentId: 'traction-drive', maxRpm: 520, direction: -1 }] as ForgeState['motors'];
    expect(directMotorSpeedEdits(state, 'Reduce the drive motor speed to 580 rpm')).toEqual([
      { motorId: 'motor-drive', previousRpm: 520, maxRpm: 580, direction: -1 },
    ]);
  });

  it('retains the deterministic conveyor percentage behavior', () => {
    expect(directMotorSpeedEdits(conveyorState(), 'Make the conveyor belt faster').map((edit) => edit.maxRpm)).toEqual([120, 96]);
  });

  it('retunes every drive for an unambiguous whole-machine speed request', () => {
    const state = conveyorState();
    state.components = [
      { id: 'front-drive', primitive: 'motor', parameters: {}, role: 'front traction motor' },
      { id: 'rear-drive', primitive: 'motor', parameters: {}, role: 'rear traction motor' },
    ] as ForgeState['components'];
    state.motors = [
      { id: 'front-motor', componentId: 'front-drive', maxRpm: 400, direction: 1 },
      { id: 'rear-motor', componentId: 'rear-drive', maxRpm: 500, direction: 1 },
    ] as ForgeState['motors'];
    expect(directMotorSpeedEdits(state, 'Make the vehicle 25% faster').map((edit) => edit.maxRpm)).toEqual([500, 625]);
  });
});
