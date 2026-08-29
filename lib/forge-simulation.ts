import { materialFor, primitiveCatalog } from './forge-data';
import { SUPPORTED_METRICS } from './forge-metrics';
import type {
  CollisionEvent, FailureEvent, ForgeState, GoalConstraint, Joint,
  MetricReading, OptimizationAction, ReplayFrame, ReplayItem, SimulationRun,
  TelemetrySample, Vec3,
} from './forge-types';

const DT = 1 / 60;
const SEED = 424242 as const;
let rapierReady: Promise<typeof import('@dimforge/rapier3d-compat')> | null = null;

async function loadRapier() {
  if (!rapierReady) rapierReady = import('@dimforge/rapier3d-compat').then(async (rapier) => { await rapier.init(); return rapier; });
  return rapierReady;
}

const round = (value: number, places = 2) => Number(value.toFixed(places));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const unique = (values: string[], label: string) => {
  if (new Set(values).size !== values.length) throw new Error(`INVALID_DESIGN: duplicate ${label} id.`);
};

export function assertRunnableDesign(state: ForgeState) {
  if (!state.goal) throw new Error('INVALID_DESIGN: set a measurable design goal before running physics.');
  if (!state.assemblies.length || !state.components.length) throw new Error('INVALID_DESIGN: create at least one assembly and one physical body.');
  if (state.components.length > state.goal.maxComponents) throw new Error('INVALID_DESIGN: the world exceeds its component budget.');
  if (state.world.timestepHz !== 60 || state.world.seed !== SEED) throw new Error('INVALID_DESIGN: timestep and deterministic seed are immutable.');
  for (const constraint of state.goal.constraints) if (!SUPPORTED_METRICS.has(constraint.metric)) throw new Error(`UNSUPPORTED_MEASUREMENT: “${constraint.metric}” has no registered evaluator.`);

  unique(state.assemblies.map((item) => item.id), 'assembly');
  unique(state.components.map((item) => item.id), 'component');
  unique(state.connections.map((item) => item.id), 'connection');
  unique(state.joints.map((item) => item.id), 'joint');
  unique(state.motors.map((item) => item.id), 'motor');
  unique(state.sensors.map((item) => item.id), 'sensor');
  unique(state.actuators.map((item) => item.id), 'actuator');
  unique(state.controls.map((item) => item.id), 'control');

  const assemblyIds = new Set(state.assemblies.map((item) => item.id));
  const componentIds = new Set(state.components.map((item) => item.id));
  const jointIds = new Set(state.joints.map((item) => item.id));
  const sensorIds = new Set(state.sensors.map((item) => item.id));
  const actuatorIds = new Set(state.actuators.map((item) => item.id));
  for (const item of state.assemblies) if (item.parentId && !assemblyIds.has(item.parentId)) throw new Error(`INVALID_DESIGN: ${item.id} references a missing parent assembly.`);
  for (const item of state.components) {
    if (!assemblyIds.has(item.assemblyId)) throw new Error(`INVALID_DESIGN: ${item.id} references a missing assembly.`);
    if (!primitiveCatalog.some((primitive) => primitive.kind === item.primitive)) throw new Error(`INVALID_DESIGN: ${item.id} has an unsupported primitive.`);
    if (!item.dimensions.every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(item.mass) || item.mass <= 0) throw new Error(`INVALID_DESIGN: ${item.id} has invalid physical properties.`);
  }
  for (const item of state.connections) if (item.sourceId === item.targetId || !componentIds.has(item.sourceId) || !componentIds.has(item.targetId)) throw new Error(`INVALID_DESIGN: connection ${item.id} has invalid endpoints.`);
  for (const item of state.joints) {
    if (item.componentA === item.componentB || !componentIds.has(item.componentA) || !componentIds.has(item.componentB)) throw new Error(`INVALID_DESIGN: joint ${item.id} has invalid endpoints.`);
    if (!item.axis.every(Number.isFinite) || Math.hypot(...item.axis) < .5) throw new Error(`INVALID_DESIGN: joint ${item.id} has an invalid axis.`);
  }
  const moving = state.goal.capabilities.some((capability) => ['transport', 'lift', 'mobile', 'manipulate', 'transmit', 'track', 'rotate'].includes(capability));
  if (moving && !state.motors.length && !state.actuators.length) throw new Error('INVALID_DESIGN: the requested motion has no motor or actuator.');
  for (const item of state.motors) if (!componentIds.has(item.componentId) || (item.jointId && !jointIds.has(item.jointId))) throw new Error(`INVALID_DESIGN: motor ${item.id} has a dangling reference.`);
  for (const item of state.sensors) if (!componentIds.has(item.componentId) || (item.targetId && !componentIds.has(item.targetId))) throw new Error(`INVALID_DESIGN: sensor ${item.id} has a dangling reference.`);
  for (const item of state.actuators) if (!componentIds.has(item.componentId) || !jointIds.has(item.jointId)) throw new Error(`INVALID_DESIGN: actuator ${item.id} has a dangling reference.`);
  for (const item of state.controls) {
    if (item.sensorIds.some((id) => !sensorIds.has(id)) || item.actuatorIds.some((id) => !actuatorIds.has(id))) throw new Error(`INVALID_DESIGN: control ${item.id} has a dangling channel.`);
    if (![item.setpoint, item.kp, item.ki, item.kd, item.calibrationX].every(Number.isFinite)) throw new Error(`INVALID_DESIGN: control ${item.id} has non-finite gains.`);
  }
}

function eulerQuaternion(rotation: Vec3) {
  const [x, y, z] = rotation.map((value) => value / 2) as Vec3;
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return { x: sx * cy * cz - cx * sy * sz, y: cx * sy * cz + sx * cy * sz, z: cx * cy * sz - sx * sy * cz, w: cx * cy * cz + sx * sy * sz };
}

type QuaternionLike = { x: number; y: number; z: number; w: number };

function multiplyQuaternion(a: QuaternionLike, b: QuaternionLike): QuaternionLike {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function rotateVectorByQuaternion(vector: Vec3, quaternion: QuaternionLike): Vec3 {
  const [x, y, z] = vector;
  const { x: qx, y: qy, z: qz, w: qw } = quaternion;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function connectivityRatio(state: ForgeState) {
  if (state.components.length <= 1) return 1;
  const parent = new Map(state.components.map((item) => [item.id, item.id]));
  const find = (id: string): string => { const value = parent.get(id) ?? id; if (value === id) return id; const root = find(value); parent.set(id, root); return root; };
  const join = (a: string, b: string) => { const rootA = find(a), rootB = find(b); if (rootA !== rootB) parent.set(rootB, rootA); };
  state.joints.forEach((item) => join(item.componentA, item.componentB));
  state.connections.filter((item) => item.type === 'mechanical').forEach((item) => join(item.sourceId, item.targetId));
  const counts = new Map<string, number>();
  state.components.forEach((item) => counts.set(find(item.id), (counts.get(find(item.id)) ?? 0) + 1));
  return Math.max(...counts.values()) / state.components.length;
}

function worldAnalysis(state: ForgeState) {
  const totalMass = state.components.reduce((sum, item) => sum + item.mass, 0);
  const payloads = state.components.filter((item) => item.primitive === 'container' || /payload|patient|cargo|design load/.test(item.role));
  const payloadMass = Math.max(1, ...payloads.map((item) => Number(item.parameters.payload_kg ?? item.mass)));
  const supports = state.components.filter((item) => item.bodyType === 'fixed' && ['frame', 'support', 'beam', 'plate'].includes(item.primitive) && !/sensor|controller|brace/.test(item.role));
  const supportX = supports.flatMap((item) => [item.position[0] - item.dimensions[0] / 2, item.position[0] + item.dimensions[0] / 2]);
  const supportZ = supports.flatMap((item) => [item.position[2] - item.dimensions[2] / 2, item.position[2] + item.dimensions[2] / 2]);
  const footprintX = supportX.length ? Math.max(...supportX) - Math.min(...supportX) : 0;
  const footprintZ = supportZ.length ? Math.max(...supportZ) - Math.min(...supportZ) : 0;
  const centerHeight = state.components.reduce((sum, item) => sum + item.position[1] * item.mass, 0) / Math.max(totalMass, 1);
  const counterMass = state.components.filter((item) => item.primitive === 'counterweight').reduce((sum, item) => sum + item.mass, 0);
  const motorTorque = state.motors.reduce((sum, item) => sum + item.maxTorque, 0);
  const motorRpm = Math.max(0, ...state.motors.map((item) => item.maxRpm));
  const actuatorForce = state.actuators.reduce((sum, item) => sum + item.maxForce, 0);
  const actuatorSpeed = Math.max(.05, ...state.actuators.map((item) => item.maxSpeed));
  const springs = state.components.filter((item) => item.primitive === 'spring');
  const springStiffness = springs.length ? springs.reduce((sum, item) => sum + Number(item.parameters.stiffness ?? 18000), 0) / springs.length : 0;
  const springDamping = springs.length ? springs.reduce((sum, item) => sum + Number(item.parameters.damping ?? 2200), 0) / springs.length : 0;
  const wheelCount = state.components.filter((item) => item.primitive === 'wheel' && !/flywheel/.test(item.role)).length;
  const sensorCount = state.sensors.length;
  const actuatorCount = state.actuators.length;
  const calibrationErrors = state.controls.map((control) => {
    const sensor = state.sensors.find((item) => item.id === control.sensorIds[0]);
    const body = sensor ? state.components.find((item) => item.id === sensor.componentId) : undefined;
    return body ? Math.abs(body.position[0] - control.calibrationX) : 0;
  });
  const calibrationError = calibrationErrors.length ? Math.max(...calibrationErrors) : 0;
  const baseControl = state.controls.length ? state.controls.reduce((sum, item) => sum + item.kp + item.kd * .35, 0) / state.controls.length : .55;
  const controlQuality = clamp(baseControl / (1 + calibrationError * 3.5), .08, 1.7);
  const gearRelations = state.joints.filter((item) => item.type === 'gear' || item.type === 'belt');
  const gearRatio = gearRelations.reduce((product, item) => product * (item.ratio ?? 1), 1);
  const gears = state.components.filter((item) => item.primitive === 'gear');
  const meshEfficiency = gears.length ? gears.reduce((sum, item) => sum + Number(item.parameters.mesh_efficiency ?? .85), 0) / gears.length : .9;
  const reach = state.components.filter((item) => /serial link|arm link/.test(item.role)).reduce((sum, item) => sum + Number(item.parameters.link_length ?? item.dimensions[0]), 0);
  const spanBodies = state.components.filter((item) => /span deck|hinged span/.test(item.role));
  const span = spanBodies.length ? Math.max(...spanBodies.map((item) => item.position[0] + item.dimensions[0] / 2)) - Math.min(...spanBodies.map((item) => item.position[0] - item.dimensions[0] / 2)) : 0;
  const liftHeight = Math.max(0, ...state.joints.filter((item) => item.type === 'prismatic' || item.type === 'rope').map((item) => item.limits?.[1] ?? 0), ...state.actuators.map((item) => item.travel));
  const wheelRadius = Math.max(.2, ...state.components.filter((item) => item.primitive === 'wheel' && !/flywheel/.test(item.role)).map((item) => item.dimensions[0] / 2));
  const tireFriction = Math.max(.35, ...state.components.filter((item) => item.primitive === 'wheel' && !/flywheel/.test(item.role)).map((item) => materialFor(item.materialId).friction));
  const structural = state.components.filter((item) => ['beam', 'plate', 'frame', 'support'].includes(item.primitive));
  const structuralCapacity = structural.reduce((sum, item) => {
    const area = Math.max(.0005, item.dimensions[1] * item.dimensions[2]);
    return sum + materialFor(item.materialId).strength * 1e6 * area * .000152;
  }, 0) / 9.81;
  const continuousTravel = state.joints.some((item) => item.type === 'revolute' && !item.limits) ? motorRpm * 6 * state.world.duration : 0;
  const angularTravel = Math.max(continuousTravel, ...state.joints.filter((item) => item.type === 'revolute' && item.limits).map((item) => Math.abs(item.limits![1] - item.limits![0]) * 180 / Math.PI), 0);
  const piston = state.components.find((item) => item.primitive === 'piston' && Number(item.parameters.bore_m) > 0);
  const bore = Number(piston?.parameters.bore_m ?? 0);
  const stroke = Number(piston?.parameters.stroke_m ?? 0);
  const flowRate = bore && stroke ? Math.PI * Math.pow(bore / 2, 2) * stroke * motorRpm * meshEfficiency * 1000 : 0;
  const conveyor = state.components.find((item) => item.primitive === 'conveyor');
  const ramps = state.components.filter((item) => item.primitive === 'ramp');
  const dropHeight = conveyor && ramps.length ? Math.max(...ramps.map((item) => Math.abs((conveyor.position[1] + conveyor.dimensions[1] / 2) - (item.position[1] + item.dimensions[1] / 2)) * 100)) : 0;
  return {
    totalMass, payloadMass, footprintX, footprintZ, centerHeight, counterMass, motorTorque, motorRpm,
    actuatorForce, actuatorSpeed, springCount: springs.length, springStiffness, springDamping, wheelCount,
    sensorCount, actuatorCount, controlQuality, calibrationError, gearRatio, meshEfficiency, reach, span,
    liftHeight, wheelRadius, tireFriction, structuralCapacity, angularTravel, flowRate, dropHeight,
    connectivity: connectivityRatio(state),
  };
}

function deflectionMm(state: ForgeState, analysis: ReturnType<typeof worldAnalysis>) {
  const deck = state.components.find((item) => /span deck|hinged span/.test(item.role));
  if (!deck || analysis.span <= 0) return 0;
  const elastic = deck.materialId === 'steel' ? 200e9 : deck.materialId === 'aluminum' ? 69e9 : 25e9;
  const inertia = Math.max(1e-7, deck.dimensions[2] * Math.pow(deck.dimensions[1], 3) / 12);
  const braceCount = state.components.filter((item) => /span brace/.test(item.role)).length;
  const jointFlexibility = 8 / Math.max(1, braceCount);
  return analysis.payloadMass * 9.81 * Math.pow(analysis.span, 3) / (48 * elastic * inertia) * 1000 * jointFlexibility;
}

function source(metric: string) {
  const sources: Record<string, string> = {
    payload_capacity: 'registered force and torque limits divided by gravity and adjusted by measured control calibration',
    lift_height: 'prismatic/rope joint limits and actuator travel', stability_margin: 'support footprint, mass-weighted center height, and explicit counterweight mass',
    placement_error: 'sensor coverage, controller gains, and current sensor calibration offset', peak_acceleration: 'actuator speed and controller damping proxy',
    span: 'union of active span-member geometry', load_capacity: 'member section and material yield proxy',
    deflection: 'Euler–Bernoulli reduced-order model using active span, section, material, braces, and payload', safety_factor: 'structural capacity divided by explicit payload',
    speed_ratio: 'configured gear/belt coupling ratio', output_torque: 'registered input torque × ratio × component mesh efficiency',
    output_speed: 'registered input speed ÷ coupling ratio', transmission_efficiency: 'mesh efficiency stored on the active gear primitives',
    reach: 'sum of articulated link lengths', joint_margin: 'registered joint force/torque divided by payload moment',
    course_time: 'wheel radius and registered motor speed over a 10 m test course', platform_tilt: 'spring stiffness, damping, controller quality, and center height proxy',
    traction_margin: 'wheel friction and drive torque divided by demanded tractive force', tracking_error: 'sensor coverage, controller gains, and sensor calibration offset',
    actuator_count: 'registered joint actuators', response_time: 'actuator slew rate and controller quality', throughput: 'drive rpm and calibrated flow-control quality',
    sorting_accuracy: 'classification sensor count and calibrated routing-control quality', collisions: 'harmful Rapier contact episodes only',
    drop_height: 'vertical difference between active transport and transfer surfaces', control_error: 'controller gain and current sensor calibration offset',
    assembly_integrity: 'largest mechanically connected graph component', component_count: 'physical body count in the shared world',
    flow_rate: 'piston swept volume × crank rpm × volumetric efficiency', angular_travel: 'continuous motor travel or bounded revolute-joint envelope over simulated time',
    alignment_error: 'vision and position sensor coverage combined with fixture-controller calibration',
    clamp_force: 'sum of registered hold-down actuator force limits',
    plate_count: 'count of individually modeled corrugated heat-transfer plates',
    port_count: 'count of modeled hot- and cold-side process connections',
  };
  return sources[metric];
}

function rawMetric(metric: string, state: ForgeState, a: ReturnType<typeof worldAnalysis>, harmfulCollisions: number) {
  const stability = Math.max(0, Math.min(a.footprintX, a.footprintZ || a.footprintX) / 2 - a.centerHeight * .16 + a.counterMass / Math.max(a.payloadMass, 1) * .12);
  const safety = a.structuralCapacity / Math.max(a.payloadMass, 1) * a.connectivity;
  const payloadCapacity = a.actuatorForce > 0 ? a.actuatorForce / 9.81 * a.controlQuality : a.motorTorque * 2.2 / 9.81;
  const springAuthority = a.springCount ? Math.sqrt(a.springStiffness / 15000) + a.springDamping / 8000 : 0;
  const values: Record<string, number> = {
    payload_capacity: state.goal?.capabilities.some((item) => ['lift', 'manipulate', 'mobile'].includes(item)) ? payloadCapacity : a.structuralCapacity * .4,
    lift_height: a.liftHeight,
    stability_margin: stability,
    placement_error: 27 / Math.max(.5, .45 + a.controlQuality * 12 + a.sensorCount * .4),
    peak_acceleration: a.actuatorSpeed * 1.15 / Math.max(.55, .5 + state.controls.reduce((sum, item) => sum + item.kd, 0) / Math.max(1, state.controls.length) * 3),
    span: a.span,
    load_capacity: a.structuralCapacity,
    deflection: deflectionMm(state, a),
    safety_factor: safety,
    speed_ratio: a.gearRatio,
    output_torque: a.motorTorque * a.gearRatio * a.meshEfficiency,
    output_speed: a.motorRpm / Math.max(a.gearRatio, .01),
    transmission_efficiency: a.meshEfficiency * 100,
    reach: a.reach,
    joint_margin: (a.actuatorForce + a.motorTorque * 3) / Math.max(a.payloadMass * 9.81 * Math.max(a.reach, .5), 1),
    course_time: 10 / Math.max(.15, a.wheelRadius * a.motorRpm * Math.PI / 30 * .72),
    platform_tilt: 15 / Math.max(.7, 1 + springAuthority + a.controlQuality),
    traction_margin: a.motorTorque * Math.max(1, a.wheelCount / 2) * a.tireFriction / Math.max((a.payloadMass + 30) * 9.81 * a.wheelRadius, 1),
    tracking_error: 12 / Math.max(.5, .4 + a.controlQuality * 2.4 + a.sensorCount * .25),
    actuator_count: a.actuatorCount,
    response_time: 2.5 / Math.max(.2, .35 + a.controlQuality * 1.5 + a.actuatorSpeed),
    throughput: a.motorRpm / 3.6 * (.75 + a.controlQuality * .2),
    sorting_accuracy: Math.min(100, 91 + Math.min(5, a.sensorCount * 3) + a.controlQuality * 2.5),
    collisions: harmfulCollisions,
    drop_height: a.dropHeight,
    control_error: 9 / Math.max(.3, .4 + a.controlQuality * 1.4 + a.sensorCount * .2),
    assembly_integrity: a.connectivity * 100,
    component_count: state.components.length,
    flow_rate: a.flowRate,
    angular_travel: a.angularTravel,
    alignment_error: 18 / Math.max(1, 1 + a.controlQuality * 5 + a.sensorCount * 1.25),
    clamp_force: a.actuatorForce,
    plate_count: state.components.filter((item) => item.parameters.bphe_plate).length,
    port_count: state.components.filter((item) => item.parameters.bphe_port).length,
  };
  const value = values[metric];
  if (value === undefined) throw new Error(`UNSUPPORTED_MEASUREMENT: “${metric}” has no registered evaluator.`);
  return value;
}

function meets(constraint: GoalConstraint, value: number) {
  if (constraint.operator === 'min') return value >= constraint.target;
  if (constraint.operator === 'max') return value <= constraint.target;
  return Math.abs(value - constraint.target) <= Math.max(.001, Math.abs(constraint.target) * .02);
}

function evaluate(state: ForgeState, harmfulCollisions: number) {
  const analysis = worldAnalysis(state);
  const measures: MetricReading[] = state.goal!.constraints.map((constraint) => {
    const value = round(rawMetric(constraint.metric, state, analysis, harmfulCollisions), constraint.target < 10 ? 3 : 1);
    return { metric: constraint.metric, label: constraint.label, operator: constraint.operator, target: constraint.target, unit: constraint.unit, value, status: meets(constraint, value) ? 'pass' : 'fail', provenance: source(constraint.metric) };
  });
  if (!measures.some((item) => item.metric === 'component_count')) measures.push({ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: state.goal!.maxComponents, unit: '', value: state.components.length, status: state.components.length <= state.goal!.maxComponents ? 'pass' : 'fail', provenance: source('component_count') });
  return { analysis, measures };
}

function objective(measures: MetricReading[]) {
  return measures.reduce((sum, item) => {
    if (item.status !== 'fail') return sum;
    const scale = Math.max(Math.abs(item.target), 1);
    return sum + (item.operator === 'min' ? Math.max(0, item.target - item.value) : item.operator === 'max' ? Math.max(0, item.value - item.target) : Math.abs(item.value - item.target)) / scale;
  }, 0);
}

function recommendations(state: ForgeState, failed: MetricReading[]): OptimizationAction[] {
  const actions: OptimizationAction[] = [];
  const add = (targetId: string, field: string, before: number | string, after: number | string, reason: string) => actions.push({ targetId, field, before, after, reason });
  if (failed.some((item) => ['payload_capacity', 'output_torque', 'joint_margin', 'traction_margin', 'clamp_force'].includes(item.metric))) {
    state.actuators.slice(0, 2).forEach((item) => add(item.id, 'maxForce', item.maxForce, round(item.maxForce * 1.5, 1), 'Increase force from measured load margin.'));
    state.motors.slice(0, 2).forEach((item) => add(item.id, 'maxTorque', item.maxTorque, round(item.maxTorque * 1.5, 1), 'Increase torque from measured drive margin.'));
  }
  if (failed.some((item) => ['throughput', 'course_time', 'flow_rate'].includes(item.metric))) state.motors.slice(0, 2).forEach((item) => add(item.id, 'maxRpm', item.maxRpm, round(item.maxRpm * 1.3, 1), 'Increase cycle speed from measured throughput.'));
  if (failed.some((item) => ['deflection', 'safety_factor', 'load_capacity'].includes(item.metric))) state.components.filter((item) => ['beam', 'plate'].includes(item.primitive)).slice(0, 2).forEach((item) => add(item.id, 'section depth', item.dimensions[1], round(item.dimensions[1] * 1.2, 3), 'Increase section stiffness from structural evidence.'));
  if (failed.some((item) => ['stability_margin', 'platform_tilt'].includes(item.metric))) state.components.filter((item) => ['spring', 'counterweight'].includes(item.primitive)).slice(0, 2).forEach((item) => add(item.id, item.primitive === 'spring' ? 'stiffness' : 'mass', item.primitive === 'spring' ? Number(item.parameters.stiffness ?? 18000) : item.mass, item.primitive === 'spring' ? Number(item.parameters.stiffness ?? 18000) * 1.3 : item.mass * 1.3, 'Increase stability authority from measured motion.'));
  if (failed.some((item) => ['placement_error', 'tracking_error', 'sorting_accuracy', 'control_error', 'peak_acceleration', 'alignment_error'].includes(item.metric))) state.controls.slice(0, 2).forEach((item) => add(item.id, 'controller calibration/gain', item.kp, Math.min(1.65, Math.max(.95, item.kp * 1.5)), 'Retune gains and sensor datum from measured error.'));
  if (failed.some((item) => item.metric === 'transmission_efficiency')) state.components.filter((item) => item.primitive === 'gear').forEach((item) => add(item.id, 'mesh_efficiency', Number(item.parameters.mesh_efficiency ?? .85), .92, 'Specify the lower-loss active mesh.'));
  return actions;
}

function jointData(RAPIER: typeof import('@dimforge/rapier3d-compat'), item: Joint) {
  const a = { x: item.anchorA[0], y: item.anchorA[1], z: item.anchorA[2] };
  const b = { x: item.anchorB[0], y: item.anchorB[1], z: item.anchorB[2] };
  const norm = Math.hypot(...item.axis) || 1;
  const axis = { x: item.axis[0] / norm, y: item.axis[1] / norm, z: item.axis[2] / norm };
  if (item.type === 'fixed') return RAPIER.JointData.fixed(a, { x: 0, y: 0, z: 0, w: 1 }, b, { x: 0, y: 0, z: 0, w: 1 });
  if (item.type === 'revolute') {
    const data = RAPIER.JointData.revolute(a, b, axis);
    if (item.limits) { data.limitsEnabled = true; data.limits = item.limits; }
    return data;
  }
  if (item.type === 'prismatic') {
    const data = RAPIER.JointData.prismatic(a, b, axis);
    if (item.limits) { data.limitsEnabled = true; data.limits = item.limits; }
    return data;
  }
  if (item.type === 'spherical') return RAPIER.JointData.spherical(a, b);
  if (item.type === 'spring') return RAPIER.JointData.spring(item.limits?.[1] ?? 1, item.stiffness ?? 18000, item.damping ?? 2200, a, b);
  if (item.type === 'rope') return RAPIER.JointData.rope(item.limits?.[1] ?? 2, a, b);
  return null;
}

type ReplayBody = { translation(): { x: number; y: number; z: number }; linvel(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } };

function bodySensorValue(state: ForgeState, bodyById: Map<string, ReplayBody>, sensorId: string, progress: number) {
  const sensor = state.sensors.find((item) => item.id === sensorId)!;
  const body = bodyById.get(sensor.targetId ?? sensor.componentId);
  const p = body?.translation() ?? { x: 0, y: 0, z: 0 };
  const v = body?.linvel() ?? { x: 0, y: 0, z: 0 };
  const q = body?.rotation() ?? { x: 0, y: 0, z: 0, w: 1 };
  if (sensor.type === 'position' || sensor.type === 'distance') return Math.hypot(p.x, p.y, p.z);
  if (sensor.type === 'speed') return Math.hypot(v.x, v.y, v.z);
  if (sensor.type === 'angle' || sensor.type === 'imu') return 2 * Math.acos(clamp(Math.abs(q.w), 0, 1)) * 180 / Math.PI;
  if (sensor.type === 'load' || sensor.type === 'force') return state.components.find((item) => item.id === sensor.targetId)?.mass ?? 0;
  if (sensor.type === 'limit') return progress > .95 ? 1 : 0;
  if (sensor.type === 'light') return Math.abs(.5 - progress) * 2;
  if (sensor.type === 'color' || sensor.type === 'camera' || sensor.type === 'presence') return progress > .18 && progress < .82 ? 1 : 0;
  return 0;
}

function sortingPackages(state: ForgeState, progress: number): ReplayItem[] {
  const conveyor = state.components.find((item) => item.primitive === 'conveyor');
  const diverter = state.components.find((item) => item.parameters.sorting_diverter);
  const redBin = state.components.find((item) => item.parameters.sorting_bin && item.parameters.route_color === 'red');
  const blueBin = state.components.find((item) => item.parameters.sorting_bin && item.parameters.route_color === 'blue');
  if (!conveyor || !diverter || !redBin || !blueBin) return [];
  const startX = conveyor.position[0] - conveyor.dimensions[0] / 2 + .35;
  const beltY = conveyor.position[1] + conveyor.dimensions[1] / 2 + .27;
  const branchX = diverter.position[0] - .18;
  return Array.from({ length: 6 }, (_, index) => {
    const phase = (progress + index / 6) % 1;
    const red = index % 2 === 0;
    const target = red ? redBin : blueBin;
    const branchAt = .62;
    let x: number, y: number, z: number, yaw = 0;
    if (phase <= branchAt) {
      const t = phase / branchAt;
      x = startX + (branchX - startX) * t;
      y = beltY;
      z = Math.sin(t * Math.PI * 2) * .018;
    } else {
      const t = (phase - branchAt) / (1 - branchAt);
      const eased = t * t * (3 - 2 * t);
      x = branchX + (target.position[0] - branchX) * eased;
      y = beltY + (target.position[1] + target.dimensions[1] * .24 - beltY) * eased + Math.sin(t * Math.PI) * .08;
      z = target.position[2] * eased;
      yaw = Math.atan2(target.position[2], Math.max(.1, target.position[0] - branchX));
    }
    return {
      id: `sort-package-${red ? 'red' : 'blue'}-${Math.floor(index / 2) + 1}`,
      label: `${red ? 'red' : 'blue'} sorting box ${Math.floor(index / 2) + 1}`,
      color: red ? '#ef4058' : '#318dff',
      shape: 'box' as const,
      size: [.62, .48, .54] as Vec3,
      position: [round(x, 3), round(y, 3), round(z, 3)] as Vec3,
      rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] as [number, number, number, number],
      velocity: [0, 0, 0] as Vec3,
      state: phase > .95 ? 'delivered' as const : 'moving' as const,
    };
  });
}

export async function simulateDesign(state: ForgeState): Promise<SimulationRun> {
  assertRunnableDesign(state);
  const RAPIER = await loadRapier();
  const world = new RAPIER.World({ x: state.world.gravity[0], y: state.world.gravity[1], z: state.world.gravity[2] });
  world.timestep = DT;
  world.numSolverIterations = 8;
  world.numInternalPgsIterations = 2;
  const queue = new RAPIER.EventQueue(true);
  const bodyById = new Map<string, ReturnType<typeof world.createRigidBody>>();
  const colliderOwner = new Map<number, string>();
  const rotorHub = state.components.find((item) => item.parameters.cad_form === 'rotor_hub');
  const rotorBlades = rotorHub ? state.components.filter((item) => item.assemblyId === rotorHub.assemblyId && item.parameters.cad_form === 'aero_blade') : [];
  const rotorBladeIds = new Set(rotorBlades.map((item) => item.id));
  const isCompoundRotorJoint = (item: Joint) => Boolean(rotorHub && item.type === 'fixed' && ((item.componentA === rotorHub.id && rotorBladeIds.has(item.componentB)) || (item.componentB === rotorHub.id && rotorBladeIds.has(item.componentA))));
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.16, 0));
  const floorCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(state.world.bounds[0] / 2, .12, state.world.bounds[2] / 2).setFriction(.85).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), floor);
  colliderOwner.set(floorCollider.handle, 'world-floor');

  for (const item of state.components) {
    // A machined rotor is one rigid body. Its authored blade components become
    // colliders on the hub below instead of independent bodies connected by a
    // stiff constraint network, which is both more accurate and more stable.
    if (rotorBladeIds.has(item.id)) continue;
    const descriptor = item.bodyType === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : item.bodyType === 'kinematic' ? RAPIER.RigidBodyDesc.kinematicVelocityBased() : RAPIER.RigidBodyDesc.dynamic();
    descriptor.setTranslation(item.position[0], item.position[1], item.position[2]).setRotation(eulerQuaternion(item.rotation)).setLinearDamping(.28).setAngularDamping(.38);
    if (item.parameters.bicycle_wheel || item.parameters.bicycle_sprocket) descriptor.setAdditionalSolverIterations(10);
    const body = world.createRigidBody(descriptor);
    const half = item.dimensions.map((value) => Math.max(.01, value / 2)) as Vec3;
    // Bicycle wheels use an open spoked visual. Their reduced-order physics
    // body is the rotating hub, not a solid disc that would incorrectly strike
    // every fork and frame tube passing through the wheel plane.
    const colliderDescriptor = item.parameters.bicycle_wheel
      ? RAPIER.ColliderDesc.cylinder(half[1], Math.min(.13, half[0] * .2))
      : item.shape === 'sphere' ? RAPIER.ColliderDesc.ball(half[0]) : item.shape === 'cylinder' ? RAPIER.ColliderDesc.cylinder(half[1], half[0]) : item.shape === 'capsule' ? RAPIER.ColliderDesc.capsule(Math.max(.02, half[1] - half[0]), half[0]) : RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]);
    const material = materialFor(item.materialId);
    colliderDescriptor.setFriction(material.friction).setRestitution(material.restitution).setMass(item.mass).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (item.parameters.cad_form === 'rotor_hub' || item.parameters.bicycle_wheel) colliderDescriptor.setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 });
    // The duct shroud is represented by a torus in the editor. A solid box
    // collider would incorrectly fill its opening and jam the rotor.
    if (item.parameters.cad_form !== 'rotor_shroud' && !item.parameters.bicycle_chain) {
      const collider = world.createCollider(colliderDescriptor, body);
      colliderOwner.set(collider.handle, item.id);
    }
    bodyById.set(item.id, body);
  }

  if (rotorHub && rotorBlades.length) {
    const hubBody = bodyById.get(rotorHub.id);
    if (!hubBody) throw new Error('INVALID_DESIGN: rotor hub body was not instantiated.');
    for (const blade of rotorBlades) {
      const half = blade.dimensions.map((value) => Math.max(.01, value / 2)) as Vec3;
      const colliderDescriptor = RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]);
      const material = materialFor(blade.materialId);
      colliderDescriptor
        .setTranslation(blade.position[0] - rotorHub.position[0], blade.position[1] - rotorHub.position[1], blade.position[2] - rotorHub.position[2])
        .setRotation(eulerQuaternion(blade.rotation))
        .setFriction(material.friction)
        .setRestitution(material.restitution)
        .setMass(blade.mass)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = world.createCollider(colliderDescriptor, hubBody);
      bodyById.set(blade.id, hubBody);
      colliderOwner.set(collider.handle, blade.id);
    }
  }

  let instantiatedJoints = 0;
  const expectedJoints = state.joints.filter((item) => !['gear', 'belt'].includes(item.type) && !isCompoundRotorJoint(item) && !(bodyById.get(item.componentA)?.isFixed() && bodyById.get(item.componentB)?.isFixed())).length;
  for (const item of state.joints) {
    const bodyA = bodyById.get(item.componentA), bodyB = bodyById.get(item.componentB);
    const other = rotorHub && item.componentA === rotorHub.id ? state.components.find((component) => component.id === item.componentB) : rotorHub && item.componentB === rotorHub.id ? state.components.find((component) => component.id === item.componentA) : undefined;
    const physicalJoint = rotorHub && other && item.type === 'revolute' && (item.componentA === rotorHub.id || item.componentB === rotorHub.id)
      ? {
          ...item,
          anchorA: item.componentA === rotorHub.id ? [0, 0, 0] as Vec3 : rotorHub.position.map((value, index) => value - other.position[index]) as Vec3,
          anchorB: item.componentB === rotorHub.id ? [0, 0, 0] as Vec3 : rotorHub.position.map((value, index) => value - other.position[index]) as Vec3,
          limits: undefined,
        }
      : item;
    const data = jointData(RAPIER, physicalJoint);
    if (!bodyA || !bodyB || !data || isCompoundRotorJoint(item) || (bodyA.isFixed() && bodyB.isFixed())) continue;
    try { world.createImpulseJoint(data, bodyA, bodyB, true); instantiatedJoints += 1; }
    catch { throw new Error(`INVALID_DESIGN: Rapier could not instantiate joint ${item.id}.`); }
  }
  if (instantiatedJoints !== expectedJoints) throw new Error('INVALID_DESIGN: one or more required physical joints were skipped.');

  let testBody: ReturnType<typeof world.createRigidBody> | null = null;
  let testColliderHandle: number | null = null;
  if (state.goal!.capabilities.includes('transport')) {
    testBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(-3.8, .95, 0));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(.28, .28, .28).setMass(2).setFriction(.62).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), testBody);
    testColliderHandle = collider.handle; colliderOwner.set(collider.handle, 'test-payload');
  }

  const declaredPairs = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  state.joints.forEach((item) => declaredPairs.add(pairKey(item.componentA, item.componentB)));
  state.connections.filter((item) => item.type === 'mechanical').forEach((item) => declaredPairs.add(pairKey(item.sourceId, item.targetId)));
  const telemetry: TelemetrySample[] = [];
  const replay: ReplayFrame[] = [];
  const collisions: CollisionEvent[] = [];
  const seenPairs = new Set<string>();
  let peakSpeed = 0;
  let peakHeight = 0;
  let peakControlledAcceleration = 0;
  let physicsHealthy = true;
  const steps = Math.round(state.world.duration / DT);
  const analysis = worldAnalysis(state);
  const bicycleWheels = state.components.filter((item) => item.parameters.bicycle_wheel);
  const drivenBicycleWheel = bicycleWheels.find((item) => /rear/i.test(item.role)) ?? bicycleWheels[0];

  for (let tick = 0; tick <= steps; tick += 1) {
    const time = tick * DT;
    const progress = clamp(time / state.world.duration, 0, 1);
    for (const motor of state.motors) {
      const targetJoint = motor.jointId ? state.joints.find((item) => item.id === motor.jointId) : null;
      const driven = targetJoint ? bodyById.get(targetJoint.componentB) : bodyById.get(motor.componentId);
      if (!driven?.isDynamic()) continue;
      const axis = targetJoint?.axis ?? [0, 1, 0];
      const norm = Math.hypot(...axis) || 1;
      const target = motor.maxRpm * Math.PI / 30 * motor.direction;
      const current = driven.angvel();
      const along = (current.x * axis[0] + current.y * axis[1] + current.z * axis[2]) / norm;
      const maxDelta = motor.maxTorque / Math.max(.25, driven.mass()) * DT;
      const next = along + clamp(target - along, -maxDelta, maxDelta);
      driven.setAngvel({ x: axis[0] / norm * next, y: axis[1] / norm * next, z: axis[2] / norm * next }, true);
    }
    for (const relation of state.joints.filter((item) => item.type === 'gear' || item.type === 'belt')) {
      const input = bodyById.get(relation.componentA), output = bodyById.get(relation.componentB);
      if (!input || !output?.isDynamic()) continue;
      const axis = relation.axis; const norm = Math.hypot(...axis) || 1;
      const omega = input.angvel();
      const inputAlong = (omega.x * axis[0] + omega.y * axis[1] + omega.z * axis[2]) / norm;
      const outputAlong = inputAlong / Math.max(.01, relation.ratio ?? 1) * (relation.type === 'gear' ? -1 : 1);
      output.setAngvel({ x: axis[0] / norm * outputAlong, y: axis[1] / norm * outputAlong, z: axis[2] / norm * outputAlong }, true);
    }
    // A free-rolling bicycle front wheel is not powered, but it must rotate at
    // the same ground speed as the driven rear wheel. Rapier has no tire model,
    // so this deterministic rolling constraint supplies that missing contact
    // behavior while both revolute hubs remain fully simulated and anchored.
    if (drivenBicycleWheel && bicycleWheels.length > 1) {
      const drivenBody = bodyById.get(drivenBicycleWheel.id);
      const omega = drivenBody?.angvel().z ?? 0;
      for (const wheel of bicycleWheels) {
        const body = bodyById.get(wheel.id);
        if (body?.isDynamic()) body.setAngvel({ x: 0, y: 0, z: omega }, true);
      }
    }
    for (const actuator of state.actuators) {
      const targetJoint = state.joints.find((item) => item.id === actuator.jointId);
      const driven = targetJoint ? bodyById.get(targetJoint.componentB) : null;
      if (!driven?.isDynamic()) continue;
      const control = state.controls.find((item) => item.actuatorIds.includes(actuator.id));
      const sensor = control ? state.sensors.find((item) => item.id === control.sensorIds[0]) : undefined;
      const sensorBody = sensor ? state.components.find((item) => item.id === sensor.componentId) : undefined;
      const calibrationError = control && sensorBody ? Math.abs(sensorBody.position[0] - control.calibrationX) : 0;
      const quality = clamp((control?.kp ?? .55) / (1 + calibrationError * 3.5), .08, 1.7);
      const sign = progress < .5 ? 1 : -1;
      const targetSpeed = actuator.maxSpeed * quality * sign;
      const axis = targetJoint?.axis ?? [0, 1, 0]; const norm = Math.hypot(...axis) || 1;
      const linear = targetJoint?.type === 'prismatic' || actuator.type === 'piston' || actuator.type === 'linear' || actuator.type === 'winch';
      const current = linear ? driven.linvel() : driven.angvel();
      const along = (current.x * axis[0] + current.y * axis[1] + current.z * axis[2]) / norm;
      const maxDelta = actuator.maxForce / Math.max(.25, driven.mass()) * DT;
      const next = along + clamp(targetSpeed - along, -maxDelta, maxDelta);
      peakControlledAcceleration = Math.max(peakControlledAcceleration, Math.abs(next - along) / DT);
      const velocity = { x: axis[0] / norm * next, y: axis[1] / norm * next, z: axis[2] / norm * next };
      if (linear) driven.setLinvel(velocity, true); else driven.setAngvel(velocity, true);
    }
    if (testBody) {
      const speed = Math.max(.7, analysis.motorRpm / 90) * (.75 + analysis.controlQuality * .2);
      const lateral = analysis.calibrationError * .24 + Math.max(0, .9 - analysis.controlQuality) * .08;
      testBody.setLinvel({ x: speed, y: 0, z: lateral * Math.sin(progress * Math.PI * 3) }, true);
    }
    world.step(queue);
    queue.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      const bodyA = colliderOwner.get(first) ?? `collider-${first}`;
      const bodyB = colliderOwner.get(second) ?? `collider-${second}`;
      const pair = pairKey(bodyA, bodyB);
      if (declaredPairs.has(pair) || seenPairs.has(pair)) return;
      seenPairs.add(pair);
      const a = first === testColliderHandle ? testBody : bodyById.get(bodyA) ?? null;
      const b = second === testColliderHandle ? testBody : bodyById.get(bodyB) ?? null;
      const av = a?.linvel() ?? { x: 0, y: 0, z: 0 }, bv = b?.linvel() ?? { x: 0, y: 0, z: 0 };
      const relativeSpeed = Math.hypot(av.x - bv.x, av.y - bv.y, av.z - bv.z);
      const massA = a?.mass() ?? 1e6, massB = b?.mass() ?? 1e6;
      const reducedMass = massA * massB / Math.max(.001, massA + massB);
      const impulse = round(relativeSpeed * Math.min(20, reducedMass), 2);
      const p = a?.translation() ?? b?.translation() ?? { x: 0, y: .5, z: 0 };
      const supportContact = bodyA === 'world-floor' || bodyB === 'world-floor';
      const itemA = state.components.find((item) => item.id === bodyA), itemB = state.components.find((item) => item.id === bodyB);
      const sameAssemblyContact = Boolean(itemA && itemB && itemA.assemblyId === itemB.assemblyId);
      const expectedTransport = (bodyA === 'test-payload' || bodyB === 'test-payload') && [bodyA, bodyB].some((id) => state.components.some((item) => item.id === id && ['conveyor', 'ramp', 'container'].includes(item.primitive)));
      collisions.push({ id: `collision-${collisions.length + 1}`, time: round(time, 3), bodyA, bodyB, impulse, point: [round(p.x, 3), round(p.y, 3), round(p.z, 3)], replayFrame: replay.length, harmful: !supportContact && !expectedTransport && !sameAssemblyContact && impulse > 6 });
    });

    if (tick % 3 === 0) {
      const items: ReplayItem[] = [];
      for (const item of state.components) {
        if (item.bodyType === 'fixed') continue;
        const body = bodyById.get(item.id); if (!body) continue;
        const p = body.translation(), q = body.rotation(), v = body.linvel();
        let replayPosition: Vec3 = [p.x, p.y, p.z];
        let replayRotation: QuaternionLike = q;
        let replayVelocity: Vec3 = [v.x, v.y, v.z];
        if (rotorHub && rotorBladeIds.has(item.id)) {
          const localOffset = item.position.map((value, index) => value - rotorHub.position[index]) as Vec3;
          const offset = rotateVectorByQuaternion(localOffset, q);
          const angular = body.angvel();
          replayPosition = [p.x + offset[0], p.y + offset[1], p.z + offset[2]];
          replayRotation = multiplyQuaternion(q, eulerQuaternion(item.rotation));
          replayVelocity = [
            v.x + angular.y * offset[2] - angular.z * offset[1],
            v.y + angular.z * offset[0] - angular.x * offset[2],
            v.z + angular.x * offset[1] - angular.y * offset[0],
          ];
        }
        const speed = Math.hypot(...replayVelocity);
        peakSpeed = Math.max(peakSpeed, speed); peakHeight = Math.max(peakHeight, replayPosition[1]);
        if (![...replayPosition, replayRotation.x, replayRotation.y, replayRotation.z, replayRotation.w, ...replayVelocity].every(Number.isFinite)) physicsHealthy = false;
        items.push({ id: item.id, label: item.role, color: item.color, shape: item.shape, size: item.dimensions, position: replayPosition.map((value) => round(value, 3)) as Vec3, rotation: [round(replayRotation.x, 4), round(replayRotation.y, 4), round(replayRotation.z, 4), round(replayRotation.w, 4)], velocity: replayVelocity.map((value) => round(value, 3)) as Vec3, state: replayPosition[1] < -.3 ? 'failed' : progress > .97 ? 'delivered' : 'moving' });
      }
      const routedPackages = state.goal!.capabilities.includes('classify') ? sortingPackages(state, progress) : [];
      if (routedPackages.length) items.push(...routedPackages);
      else if (testBody) {
        const p = testBody.translation(), q = testBody.rotation(), v = testBody.linvel();
        items.push({ id: 'test-payload', label: 'simulation payload', color: '#48a9e8', shape: 'box', size: [.56, .56, .56], position: [round(p.x, 3), round(p.y, 3), round(p.z, 3)], rotation: [q.x, q.y, q.z, q.w], velocity: [round(v.x, 3), round(v.y, 3), round(v.z, 3)], state: progress > .97 ? 'delivered' : 'moving' });
      }
      const actuatorValues = Object.fromEntries(state.actuators.map((item) => [item.id, round(clamp(progress < .5 ? progress * 2 : (1 - progress) * 2, 0, 1), 3)]));
      const sensorValues = Object.fromEntries(state.sensors.map((item) => [item.id, round(bodySensorValue(state, bodyById as Map<string, ReplayBody>, item.id, progress), 3)]));
      replay.push({ time: round(time, 3), items, actuatorValues, sensorValues, collisionPoints: collisions.filter((item) => item.replayFrame === replay.length).map((item) => item.point) });
    }
    if (tick % 15 === 0) telemetry.push({ time: round(time, 2), channels: { progress_pct: round(progress * 100, 1), active_bodies: state.components.filter((item) => item.bodyType !== 'fixed').length, joint_count: state.joints.length, peak_speed_mps: round(peakSpeed, 3), peak_height_m: round(peakHeight, 3), peak_controlled_acceleration_mps2: round(peakControlledAcceleration, 3), contact_events: collisions.length, harmful_contacts: collisions.filter((item) => item.harmful).length, control_quality: round(analysis.controlQuality, 3), calibration_error_m: round(analysis.calibrationError, 3) } });
  }

  const evaluated = evaluate(state, collisions.filter((item) => item.harmful).length);
  const failed = evaluated.measures.filter((item) => item.status === 'fail');
  const score = round(evaluated.measures.filter((item) => item.status === 'pass').length / evaluated.measures.length * 100, 1);
  const runObjective = round(objective(evaluated.measures) + (physicsHealthy ? 0 : 1), 4);
  const firstHarmful = collisions.find((item) => item.harmful);
  const failureFrame = firstHarmful?.replayFrame ?? Math.max(0, Math.min(replay.length - 1, Math.round(replay.length * .62)));
  const primary = failed[0];
  const failureComponents = primary ? (['stability_margin', 'platform_tilt'].includes(primary.metric) ? state.components.filter((item) => ['counterweight', 'spring', 'frame'].includes(item.primitive)).map((item) => item.id) : ['output_torque', 'payload_capacity', 'joint_margin', 'traction_margin'].includes(primary.metric) ? [...state.motors.map((item) => item.componentId), ...state.actuators.map((item) => item.componentId)] : ['deflection', 'safety_factor', 'load_capacity'].includes(primary.metric) ? state.components.filter((item) => ['beam', 'plate', 'support'].includes(item.primitive)).map((item) => item.id) : state.components.filter((item) => ['sensor', 'camera', 'controller', 'motor', 'servo', 'piston'].includes(item.primitive)).map((item) => item.id)) : [];
  const failures: FailureEvent[] = primary ? [{ id: 'failure-1', type: `constraint-${primary.metric}`, time: replay[failureFrame]?.time ?? round(state.world.duration * .62, 2), title: `${primary.label} is outside the goal envelope`, detail: `${primary.value}${primary.unit} measured against ${primary.operator} ${primary.target}${primary.unit}. Source: ${primary.provenance}.`, componentIds: [...new Set(failureComponents)].slice(0, 4), replayFrame: failureFrame, evidenceChannels: [primary.metric, 'peak_speed_mps', 'harmful_contacts'] }] : physicsHealthy ? [] : [{ id: 'failure-physics-health', type: 'physics-health', time: replay[failureFrame]?.time ?? 0, title: 'The physical world became numerically unstable', detail: 'A dynamic body left the bounded engineering world or produced a non-finite transform.', componentIds: state.components.filter((item) => item.bodyType === 'dynamic').map((item) => item.id).slice(0, 4), replayFrame: failureFrame, evidenceChannels: ['peak_speed_mps', 'active_bodies'] }];
  const suggested = recommendations(state, failed);
  const metrics = { score, componentCount: state.components.length, jointCount: state.joints.length, totalMass: round(evaluated.analysis.totalMass, 1), energy: round((evaluated.analysis.motorTorque * evaluated.analysis.motorRpm * Math.PI / 30 + evaluated.analysis.actuatorForce * evaluated.analysis.actuatorSpeed) * state.world.duration / 3600, 2), collisions: collisions.filter((item) => item.harmful).length, measures: evaluated.measures };
  const editable = state.components.find((item) => item.id === state.goal!.editableComponentId) ?? state.components[0];
  const passed = failed.length === 0 && physicsHealthy;
  world.free(); queue.free();

  return {
    id: `RUN-${state.designRevision.toString().padStart(2, '0')}-${Date.now().toString(36).toUpperCase()}`,
    designRevision: state.designRevision, designHash: state.designHash, seed: SEED, startedAt: new Date().toISOString(), status: passed ? 'passed' : 'failed', metrics, telemetry, collisions, failures, replay, objective: runObjective,
    diagnosis: { summary: passed ? 'Every measured constraint is inside the current concept envelope.' : failures[0]?.title ?? 'The design needs another measured revision.', evidence: passed ? `${metrics.score}% of registered constraints pass from ${state.components.length} bodies and ${instantiatedJoints} instantiated Rapier joints.` : failures[0]?.detail ?? 'Review the fixed-step telemetry.', action: passed ? 'Save or perturb the design to test a new condition.' : `Apply ${suggested.length} causal changes to physical or control fields, then rerun the unchanged measurements.`, recommendations: suggested },
    configuration: { editablePosition: [...editable.position], componentCount: state.components.length, jointCount: state.joints.length, totalMass: metrics.totalMass, optimizationLevel: state.optimizationLevel },
    physics: { engine: 'Rapier', timestepHz: 60, simulatedSeconds: state.world.duration, model: state.goal!.simulationModel, seed: SEED, bodies: state.components.length - rotorBlades.length + (testBody ? 2 : 1), joints: instantiatedJoints },
  };
}
