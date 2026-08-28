import type { ComponentCatalogItem, ForgeState } from './forge-types';

export const componentCatalog: ComponentCatalogItem[] = [
  { catalogId: 'conveyor', name: 'Precision conveyor', kind: 'conveyor', description: '6.8 m low-slip belt with integrated drive', color: '#26343d', defaultPosition: [-1.1, 0.42, 0], defaultRotation: [0, 0, 0], ports: [{ id: 'drive', type: 'power', direction: 'input' }], capabilities: ['transport', 'variable_speed'], quantityLimit: 1 },
  { catalogId: 'color-sensor', name: 'RGB line sensor', kind: 'color_sensor', description: 'Fast color classification beam', color: '#49dcff', defaultPosition: [-0.8, 1.05, 0], defaultRotation: [0, 0, 0], ports: [{ id: 'signal', type: 'signal', direction: 'output' }], capabilities: ['color', 'presence', 'drag_rail'], quantityLimit: 1 },
  { catalogId: 'servo-diverter', name: 'Servo diverter', kind: 'servo_diverter', description: '±32° high-torque sorting paddle', color: '#ffad45', defaultPosition: [1.2, 0.82, 0], defaultRotation: [0, 0, 0], ports: [{ id: 'command', type: 'signal', direction: 'input' }, { id: 'shaft', type: 'mechanical', direction: 'output' }], capabilities: ['rotate', 'timed_actuation'], quantityLimit: 1 },
  { catalogId: 'ramp-red', name: 'Red output ramp', kind: 'ramp', description: 'Left material guide', color: '#d83b48', defaultPosition: [2.85, 0.35, -1.05], defaultRotation: [0, -0.18, 0], ports: [{ id: 'mount', type: 'mechanical', direction: 'input' }], capabilities: ['guide'], quantityLimit: 1 },
  { catalogId: 'ramp-blue', name: 'Blue output ramp', kind: 'ramp', description: 'Right material guide', color: '#367fee', defaultPosition: [2.85, 0.35, 1.05], defaultRotation: [0, 0.18, 0], ports: [{ id: 'mount', type: 'mechanical', direction: 'input' }], capabilities: ['guide'], quantityLimit: 1 },
  { catalogId: 'bin-red', name: 'Red collection bin', kind: 'bin', description: 'Left counted output', color: '#8c2730', defaultPosition: [4.05, 0.4, -1.75], defaultRotation: [0, 0, 0], ports: [{ id: 'entry', type: 'mechanical', direction: 'input' }], capabilities: ['collect', 'count'], quantityLimit: 1 },
  { catalogId: 'bin-blue', name: 'Blue collection bin', kind: 'bin', description: 'Right counted output', color: '#1e4f9d', defaultPosition: [4.05, 0.4, 1.75], defaultRotation: [0, 0, 0], ports: [{ id: 'entry', type: 'mechanical', direction: 'input' }], capabilities: ['collect', 'count'], quantityLimit: 1 },
  { catalogId: 'aux-motor', name: 'Auxiliary motor', kind: 'motor', description: '0.1–3.0 m/s variable drive', color: '#8d9ba5', defaultPosition: [-2.7, 0.3, -1.1], defaultRotation: [0, 0, 0], ports: [{ id: 'power', type: 'power', direction: 'output' }], capabilities: ['drive'], quantityLimit: 2 },
  { catalogId: 'proximity-sensor', name: 'Proximity sensor', kind: 'proximity_sensor', description: 'Short-range package presence sensor', color: '#75e5a9', defaultPosition: [0, 1, 0], defaultRotation: [0, 0, 0], ports: [{ id: 'signal', type: 'signal', direction: 'output' }], capabilities: ['presence'], quantityLimit: 2 },
  { catalogId: 'rotary-joint', name: 'Rotary joint', kind: 'joint', description: 'Constrained ±90° mechanical joint', color: '#a6b3bb', defaultPosition: [0, 0.8, 0], defaultRotation: [0, 0, 0], ports: [{ id: 'axis', type: 'mechanical', direction: 'input' }], capabilities: ['rotate'], quantityLimit: 2 },
];

export const demoComponentIds = ['conveyor', 'color-sensor', 'servo-diverter', 'ramp-red', 'ramp-blue', 'bin-red', 'bin-blue'] as const;

export const defaultGoal = { throughputBpm: 20, minAccuracyPct: 95, maxComponents: 7, colors: ['red', 'blue'] as Array<'red' | 'blue'>, brief: 'Sort red and blue boxes at 20+ boxes/min using no more than 7 components.' };

export function createInitialForgeState(screen: ForgeState['screen'] = 'landing'): ForgeState {
  return {
    schemaVersion: 1,
    workspaceId: 'FT-COLOR-SORTER-01',
    workspaceNonce: crypto.randomUUID(),
    revision: 0,
    designRevision: 0,
    designHash: 'empty-00000000',
    phase: 'empty',
    screen,
    goal: null,
    components: [],
    connections: [],
    sensorAttachments: [],
    actuatorAttachments: [],
    controlRules: [],
    motorSpeed: 2,
    actuatorDelayMs: 1040,
    actuatorHoldMs: 520,
    runs: [],
    revisions: [],
    humanConstraints: [],
    activity: [],
    activitySeq: 0,
    selectedComponentId: null,
    xray: false,
    replayRunId: null,
    replayMode: 'normal',
    compareOpen: false,
    catalogOpen: false,
  };
}
