export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Actor = 'WebMCP' | 'UI' | 'Human' | 'ModelAgent' | 'Deterministic' | 'System';

export type PrimitiveKind =
  | 'beam' | 'plate' | 'frame' | 'wheel' | 'shaft' | 'gear' | 'pulley'
  | 'belt' | 'motor' | 'servo' | 'piston' | 'spring' | 'sensor' | 'camera'
  | 'conveyor' | 'ramp' | 'gripper' | 'container' | 'counterweight'
  | 'support' | 'controller' | 'cable' | 'hook' | 'roller' | 'light'
  | 'tube' | 'bearing' | 'linkage' | 'seat' | 'steering' | 'pedal' | 'battery'
  | 'body-shell' | 'aerofoil' | 'fuselage' | 'propeller' | 'rotor'
  | 'landing-gear' | 'track';

export type ShapeKind = 'box' | 'cylinder' | 'sphere' | 'capsule';
export type BodyType = 'fixed' | 'dynamic' | 'kinematic';
export type JointType = 'fixed' | 'revolute' | 'prismatic' | 'spherical' | 'spring' | 'rope' | 'gear' | 'belt';
export type SensorType = 'distance' | 'position' | 'angle' | 'speed' | 'load' | 'force' | 'imu' | 'camera' | 'color' | 'light' | 'limit' | 'presence';
export type ActuatorType = 'rotary-motor' | 'servo' | 'linear' | 'piston' | 'winch' | 'brake';
export type ControlMode = 'pid' | 'threshold' | 'state-machine' | 'tracking' | 'timed' | 'synchronized';
export type Capability = 'structure' | 'transport' | 'classify' | 'lift' | 'suspend' | 'mobile' | 'manipulate' | 'transmit' | 'stabilize' | 'track' | 'buffer' | 'contain' | 'rotate' | 'measure';

export type ForgeToolName =
  | 'inspect_workspace' | 'inspect_primitive_catalog' | 'set_design_goal'
  | 'create_assembly' | 'create_component' | 'set_dimensions' | 'set_material'
  | 'set_mass' | 'move_component' | 'rotate_component' | 'connect_components'
  | 'create_joint' | 'add_motor' | 'add_sensor' | 'add_actuator'
  | 'set_motor_speed' | 'set_sensor_range' | 'set_actuator_timing'
  | 'set_control_logic' | 'update_control_logic' | 'run_simulation' | 'inspect_telemetry'
  | 'inspect_failure' | 'measure_constraint' | 'optimize_design'
  | 'remove_component' | 'remove_joint' | 'compare_designs' | 'restore_revision';

export type ConstraintOperator = 'min' | 'max' | 'exact';

export interface GoalConstraint {
  metric: string;
  label: string;
  operator: ConstraintOperator;
  target: number;
  unit: string;
  source: 'user' | 'inferred';
}

export interface MaterialSpec {
  id: string;
  name: string;
  density: number;
  friction: number;
  restitution: number;
  strength: number;
  color: string;
}

export interface PrimitiveCatalogItem {
  id: string;
  name: string;
  kind: PrimitiveKind;
  family: string;
  description: string;
  shape: ShapeKind;
  defaultDimensions: Vec3;
  defaultMaterial: string;
  defaultBodyType: BodyType;
  capabilities: string[];
  color: string;
}

export interface WorldSpec {
  gravity: Vec3;
  timestepHz: 60;
  duration: number;
  bounds: Vec3;
  environment: string;
  seed: 424242;
}

export interface AssemblyBlueprint { id: string; name: string; purpose: string; parentId?: string }

export interface ComponentBlueprint {
  id: string;
  primitive: PrimitiveKind;
  assemblyId: string;
  role: string;
  position: Vec3;
  rotation: Vec3;
  dimensions: Vec3;
  materialId: string;
  bodyType: BodyType;
  mass?: number;
  color?: string;
  parameters?: Record<string, number | string | boolean>;
}

export interface JointBlueprint {
  id: string;
  type: JointType;
  componentA: string;
  componentB: string;
  anchorA: Vec3;
  anchorB: Vec3;
  axis: Vec3;
  limits?: [number, number];
  ratio?: number;
  stiffness?: number;
  damping?: number;
}

export interface MotorBlueprint { id: string; componentId: string; jointId?: string; maxTorque: number; maxRpm: number; direction: number }
export interface SensorBlueprint { id: string; componentId: string; type: SensorType; channel: string; targetId?: string; range: number }
export interface ActuatorBlueprint { id: string; componentId: string; jointId: string; type: ActuatorType; maxForce: number; maxSpeed: number; travel: number }

export interface ControlBlueprint {
  id: string;
  name: string;
  mode: ControlMode;
  sensorIds: string[];
  actuatorIds: string[];
  /** Motors are first-class controller outputs. Keeping them separate from
   * joint actuators makes the complete sensor -> controller -> drive chain
   * inspectable without pretending a motor is a linear/servo actuator. */
  motorIds?: string[];
  expression: string;
  setpoint: number;
  kp: number;
  ki: number;
  kd: number;
  calibrationX: number;
}

export interface ConnectionBlueprint {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'mechanical' | 'power' | 'signal';
  channel: string;
}

export interface DesignGoal {
  machineName: string;
  domain: string;
  brief: string;
  summary: string;
  capabilities: Capability[];
  constraints: GoalConstraint[];
  maxComponents: number;
  assumptions: string[];
  disclaimer: string;
  simulationModel: string;
  editableComponentId: string;
  editableLabel: string;
  orientation: MachineOrientation;
}

export interface MachineOrientation {
  front: '+X';
  forward: '+X';
  rear: '-X';
  left: '-Z';
  right: '+Z';
  up: '+Y';
  down: '-Y';
  vectors: { front: Vec3; rear: Vec3; left: Vec3; right: Vec3; up: Vec3; down: Vec3 };
  description: string;
}

export interface EngineeringPlan {
  userRequest: string;
  normalizedRequest: string;
  corrections: Array<{ from: string; to: string; reason: string }>;
  machineType: string;
  scope: string;
  functions: string[];
  constraints: string[];
  coordinateConvention: MachineOrientation;
  assemblies: Array<{ id: string; purpose: string }>;
  components: Array<{ id: string; primitive: PrimitiveKind; role: string; dimensions: Vec3; material: string; mass: number | null; rationale: string }>;
  connections: ConnectionBlueprint[];
  joints: Array<{ id: string; type: JointType; parent: string; child: string; axis: Vec3 }>;
  actuators: ActuatorBlueprint[];
  motors: MotorBlueprint[];
  sensors: SensorBlueprint[];
  controlLogic: Array<{ id: string; mode: ControlMode; expression: string }>;
  supportMap: Array<{ componentId: string; supportedBy: string[] }>;
  validation: { status: 'pending' | 'ready'; issueCount: number; repairs: string[] };
  simulationReadiness: { grounded: boolean; connected: boolean; driven: boolean };
}

export interface CompiledWorldPlan {
  brief: string;
  goal: DesignGoal;
  world: WorldSpec;
  assemblies: AssemblyBlueprint[];
  components: ComponentBlueprint[];
  connections: ConnectionBlueprint[];
  joints: JointBlueprint[];
  motors: MotorBlueprint[];
  sensors: SensorBlueprint[];
  actuators: ActuatorBlueprint[];
  controls: ControlBlueprint[];
  assumptions: string[];
  engineeringPlan?: EngineeringPlan;
}

export interface Assembly extends AssemblyBlueprint { componentIds: string[] }

export interface MachineComponent {
  id: string;
  primitive: PrimitiveKind;
  name: string;
  assemblyId: string;
  role: string;
  shape: ShapeKind;
  position: Vec3;
  rotation: Vec3;
  dimensions: Vec3;
  materialId: string;
  mass: number;
  bodyType: BodyType;
  color: string;
  parameters: Record<string, number | string | boolean>;
  lastModifiedBy: Actor;
  humanLockedFields: Array<'position' | 'rotation' | 'dimensions' | 'material' | 'mass'>;
}

export type Connection = ConnectionBlueprint;
export type Joint = JointBlueprint;
export type Motor = MotorBlueprint;
export type Sensor = SensorBlueprint;
export type Actuator = ActuatorBlueprint;
export type ControlLogic = ControlBlueprint;

export interface MetricReading extends Omit<GoalConstraint, 'source'> {
  value: number;
  status: 'pass' | 'fail' | 'info';
  provenance: string;
  evidence: 'replay-telemetry' | 'rapier-contact' | 'reduced-order-model' | 'design-inspection' | 'not-evaluated';
}

export type RequirementCoverageStatus = 'complete' | 'partial' | 'failed' | 'not-evaluated';
export type RequirementCategory = 'user requirement' | 'AI assumption' | 'safety requirement' | 'optimization target';

export interface RequirementCoverage {
  id: string;
  category: RequirementCategory;
  requirement: string;
  status: RequirementCoverageStatus;
  componentIds: string[];
  simulationEvidence: string;
  missingItems: string[];
  recommendedCorrection: string;
}

export interface Metrics {
  score: number;
  componentCount: number;
  jointCount: number;
  totalMass: number;
  energy: number;
  collisions: number;
  measures: MetricReading[];
}

export interface TelemetrySample { time: number; channels: Record<string, number> }
export type CollisionClassification = 'expected-contact' | 'connected-component-contact' | 'ground-contact' | 'clearance-violation' | 'self-interference' | 'harmful-impact';
export interface CollisionEvent { id: string; time: number; bodyA: string; bodyB: string; impulse: number; point: Vec3; replayFrame: number; harmful: boolean; classification: CollisionClassification; reason: string }
export interface FailureEvent { id: string; type: string; time: number; title: string; detail: string; componentIds: string[]; replayFrame: number; evidenceChannels: string[] }

export interface ReplayItem {
  id: string;
  label: string;
  color: string;
  shape: ShapeKind;
  size: Vec3;
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
  state: 'moving' | 'delivered' | 'failed';
}

export interface ReplayFrame { time: number; items: ReplayItem[]; actuatorValues: Record<string, number>; sensorValues: Record<string, number>; collisionPoints: Vec3[] }

export interface OptimizationAction { targetId: string; field: string; before: number | string; after: number | string; reason: string }

export interface SimulationRun {
  id: string;
  designRevision: number;
  designHash: string;
  seed: 424242;
  startedAt: string;
  status: 'failed' | 'partial' | 'passed';
  evaluationLevel: 'physics-replay' | 'reduced-order' | 'kinematic-preview' | 'concept-only';
  metrics: Metrics;
  requirementCoverage: RequirementCoverage[];
  telemetry: TelemetrySample[];
  collisions: CollisionEvent[];
  failures: FailureEvent[];
  replay: ReplayFrame[];
  objective: number;
  diagnosis: { summary: string; evidence: string; action: string; recommendations: OptimizationAction[] };
  configuration: { editablePosition: Vec3; componentCount: number; jointCount: number; totalMass: number; optimizationLevel: number };
  physics: { engine: 'Rapier'; timestepHz: 60; simulatedSeconds: number; model: string; seed: 424242; bodies: number; joints: number };
}

export interface DesignSnapshot {
  id: string;
  revision: number;
  designRevision: number;
  label: string;
  actor: Actor;
  at: string;
  designHash: string;
  goal: DesignGoal | null;
  world: WorldSpec;
  assemblies: Assembly[];
  components: MachineComponent[];
  connections: Connection[];
  joints: Joint[];
  motors: Motor[];
  sensors: Sensor[];
  actuators: Actuator[];
  controls: ControlLogic[];
  optimizationLevel: number;
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
  fields: Array<'position' | 'rotation' | 'dimensions' | 'material' | 'mass'>;
  lockedForAgent: boolean;
  changedAtRevision: number;
}

export interface ForgeState {
  schemaVersion: 3;
  workspaceId: string;
  workspaceNonce: string;
  revision: number;
  designRevision: number;
  designHash: string;
  phase: 'empty' | 'building' | 'ready' | 'simulating' | 'failed' | 'partial' | 'passed';
  screen: 'landing' | 'lab';
  world: WorldSpec;
  goal: DesignGoal | null;
  assemblies: Assembly[];
  components: MachineComponent[];
  connections: Connection[];
  joints: Joint[];
  motors: Motor[];
  sensors: Sensor[];
  actuators: Actuator[];
  controls: ControlLogic[];
  optimizationLevel: number;
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

export interface ToolSuccess { ok: true; workspace_id: string; workspace_nonce: string; revision: number; design_revision: number; design_hash: string; message: string; data?: unknown }
export interface ToolFailure { ok: false; workspace_id: string; workspace_nonce: string; revision: number; error: { code: string; message: string } }
export type ToolResult = ToolSuccess | ToolFailure;
