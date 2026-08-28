export type Vec3 = [number, number, number];
export type Actor = 'WebMCP' | 'UI' | 'Human' | 'System';
export type ComponentKind = 'conveyor' | 'color_sensor' | 'servo_diverter' | 'ramp' | 'bin' | 'motor' | 'proximity_sensor' | 'joint';
export type ForgeToolName =
  | 'inspect_workspace'
  | 'inspect_component_catalog'
  | 'set_design_goal'
  | 'add_component'
  | 'move_component'
  | 'rotate_component'
  | 'connect_components'
  | 'attach_sensor'
  | 'attach_actuator'
  | 'create_control_rule'
  | 'set_motor_speed'
  | 'set_actuator_timing'
  | 'run_simulation'
  | 'inspect_telemetry'
  | 'get_failure_events'
  | 'inspect_collisions'
  | 'compare_designs'
  | 'restore_revision';

export interface ComponentCatalogItem {
  catalogId: string;
  name: string;
  kind: ComponentKind;
  description: string;
  color: string;
  defaultPosition: Vec3;
  defaultRotation: Vec3;
  ports: Array<{ id: string; type: 'power' | 'signal' | 'mechanical'; direction: 'input' | 'output' }>;
  capabilities: string[];
  quantityLimit: number;
}

export interface MachineComponent {
  id: string;
  catalogId: string;
  name: string;
  kind: ComponentKind;
  position: Vec3;
  rotation: Vec3;
  color: string;
  parameters: Record<string, number | string | boolean>;
  lastModifiedBy: Actor;
  humanLocked: boolean;
}

export interface Connection {
  id: string;
  sourceId: string;
  sourcePort: string;
  targetId: string;
  targetPort: string;
  type: 'power' | 'signal' | 'mechanical';
}

export interface SensorAttachment {
  sensorId: string;
  channel: 'color' | 'presence';
  targetZone: string;
  range: number;
}

export interface ActuatorAttachment {
  actuatorId: string;
  targetId: string;
  axis: 'x' | 'y' | 'z';
  travelDegrees: number;
}

export interface ControlRule {
  id: string;
  sensorId: string;
  condition: 'red' | 'blue';
  actuatorId: string;
  targetAngle: number;
  priority: number;
}

export interface DesignGoal {
  throughputBpm: number;
  minAccuracyPct: number;
  maxComponents: number;
  colors: Array<'red' | 'blue'>;
  brief?: string;
}

export interface Metrics {
  throughput: number;
  accuracy: number;
  collisions: number;
  jams: number;
  componentCount: number;
  cycleTime: number;
  delivered: number;
  spawned: number;
}

export interface TelemetrySample {
  time: number;
  queueDepth: number;
  delivered: number;
  diverterAngle: number;
  beltVelocity: number;
  collisionCount: number;
}

export interface CollisionEvent {
  id: string;
  time: number;
  bodyA: string;
  bodyB: string;
  impulse: number;
  point: Vec3;
  replayFrame: number;
  harmful: boolean;
}

export interface FailureEvent {
  id: string;
  type: 'late_actuation' | 'moving_diverter_impact' | 'jam' | 'missort' | 'throughput_shortfall';
  time: number;
  title: string;
  detail: string;
  componentIds: string[];
  replayFrame: number;
}

export interface ReplayBox {
  id: string;
  color: 'red' | 'blue';
  position: Vec3;
  rotation: [number, number, number, number];
  velocity: Vec3;
  state: 'moving' | 'delivered' | 'jammed';
}

export interface ReplayFrame {
  time: number;
  boxes: ReplayBox[];
  diverterAngle: number;
  sensorPulse: 'red' | 'blue' | null;
  collisionPoints: Vec3[];
}

export interface SimulationRun {
  id: string;
  designRevision: number;
  designHash: string;
  seed: 424242;
  startedAt: string;
  status: 'failed' | 'passed';
  metrics: Metrics;
  telemetry: TelemetrySample[];
  collisions: CollisionEvent[];
  failures: FailureEvent[];
  replay: ReplayFrame[];
  sensorToDiverterMs: number;
  recommendedDelayMs: number;
  configuration: {
    sensorPosition: Vec3;
    motorSpeed: number;
    actuatorDelayMs: number;
    actuatorHoldMs: number;
    componentCount: number;
  };
  physics: { engine: 'Rapier'; timestepHz: 60; simulatedSeconds: number };
}

export interface DesignSnapshot {
  id: string;
  revision: number;
  designRevision: number;
  label: string;
  actor: Actor;
  at: string;
  designHash: string;
  components: MachineComponent[];
  connections: Connection[];
  sensorAttachments: SensorAttachment[];
  actuatorAttachments: ActuatorAttachment[];
  controlRules: ControlRule[];
  goal: DesignGoal | null;
  motorSpeed: number;
  actuatorDelayMs: number;
  actuatorHoldMs: number;
  metrics: Metrics | null;
}

export interface ActivityEvent {
  id: string;
  seq: number;
  tool: ForgeToolName | 'human_drag' | 'checkpoint';
  detail: string;
  actor: Actor;
  outcome: 'success' | 'failed' | 'running' | 'read';
  at: string;
}

export interface HumanConstraint {
  componentId: string;
  fields: Array<'position' | 'rotation'>;
  lockedForAgent: boolean;
  changedAtRevision: number;
}

export interface ForgeState {
  schemaVersion: 1;
  workspaceId: string;
  workspaceNonce: string;
  revision: number;
  designRevision: number;
  designHash: string;
  phase: 'empty' | 'building' | 'ready' | 'simulating' | 'failed' | 'passed';
  screen: 'landing' | 'lab';
  goal: DesignGoal | null;
  components: MachineComponent[];
  connections: Connection[];
  sensorAttachments: SensorAttachment[];
  actuatorAttachments: ActuatorAttachment[];
  controlRules: ControlRule[];
  motorSpeed: number;
  actuatorDelayMs: number;
  actuatorHoldMs: number;
  runs: SimulationRun[];
  revisions: DesignSnapshot[];
  humanConstraints: HumanConstraint[];
  activity: ActivityEvent[];
  activitySeq: number;
  selectedComponentId: string | null;
  xray: boolean;
  replayRunId: string | null;
  replayMode: 'normal' | 'failure';
  compareOpen: boolean;
  catalogOpen: boolean;
}

export interface ToolSuccess {
  ok: true;
  workspace_id: string;
  workspace_nonce: string;
  revision: number;
  design_revision: number;
  design_hash: string;
  message: string;
  data?: unknown;
}

export interface ToolFailure {
  ok: false;
  workspace_id: string;
  workspace_nonce: string;
  revision: number;
  error: { code: string; message: string };
}

export type ToolResult = ToolSuccess | ToolFailure;
