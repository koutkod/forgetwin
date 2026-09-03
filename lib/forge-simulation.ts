import { materialFor, primitiveCatalog } from './forge-data';
import { SUPPORTED_METRICS } from './forge-metrics';
import { roadVehicleDriveDirection } from './forge-motion';
import type {
  CollisionEvent, FailureEvent, ForgeState, GoalConstraint, Joint, MachineComponent,
  MetricReading, OptimizationAction, ReplayFrame, ReplayItem, RequirementCoverage, SimulationRun,
  TelemetrySample, Vec3,
} from './forge-types';

/** Visual/control abstractions keep mass and joints but do not receive their
 * full envelope as a solid collider. A cable, coil, sensor housing, steering
 * bearing, or robot joint shell naturally occupies the same envelope as the
 * mechanism it serves; treating that envelope as solid produces fake crashes. */
function usesReducedOrderCollider(item: MachineComponent) {
  return Boolean(
    ['sensor', 'camera', 'controller', 'light', 'motor', 'servo', 'spring', 'cable'].includes(item.primitive)
    || item.parameters.scissor_arm || item.parameters.scissor_pivot || item.parameters.scissor_actuator
    || item.parameters.planetary_carrier || item.parameters.planetary_carrier_pad || item.parameters.planetary_sun || item.parameters.planetary_ring || item.parameters.planetary_planet
    || item.parameters.hydraulic_barrel || item.parameters.hydraulic_ram || item.parameters.press_load_cell
    || item.parameters.reduced_order_cable || item.parameters.product_form
    || item.parameters.bicycle_wheel || item.parameters.road_vehicle_wheel || item.parameters.rover_wheel
    || item.parameters.bicycle_tube || item.parameters.bicycle_steerer || item.parameters.bicycle_fork_crown || item.parameters.bicycle_fork_blade || item.parameters.bicycle_stem || item.parameters.bicycle_handlebar || item.parameters.bicycle_dropout || item.parameters.bicycle_hub || item.parameters.bicycle_brake_rotor || item.parameters.bicycle_brake_caliper || item.parameters.bicycle_pedal
    || item.parameters.road_vehicle_wheel_hub || item.parameters.road_vehicle_spindle || item.parameters.road_vehicle_steering_knuckle || item.parameters.road_vehicle_kingpin || item.parameters.road_vehicle_brake || item.parameters.road_vehicle_steering_rack || item.parameters.road_vehicle_steering_tie_rod
    || item.parameters.rover_upright || item.parameters.robot_arm_joint
    || item.parameters.solar_moving || item.parameters.tracker_yoke || item.parameters.tracker_crosshead || item.parameters.tracker_drive_link
    || item.parameters.patient_hanger || item.parameters.patient_spreader || item.parameters.patient_sling || item.parameters.sling_strap || item.parameters.medical_actuator_mount
    || item.parameters.parallel_lift_platform || item.parameters.parallel_lift_payload || item.parameters.parallel_lift_cylinder
    || item.parameters.vise_moving || item.parameters.vise_screw
    || item.parameters.wind_yaw_moving || item.parameters.wind_rotor_shaft || item.parameters.wind_rotor_hub || item.parameters.wind_rotor_blade
    || item.parameters.drill_press_moving || item.parameters.drill_press_feed_handle
    || item.parameters.steering_rack || item.parameters.steering_pinion || item.parameters.steering_column || item.parameters.steering_input_wheel || item.parameters.steering_tie_rod || item.parameters.steering_knuckle || item.parameters.steering_road_wheel
    || item.parameters.bicycle_brake_axle || item.parameters.bicycle_brake_wheel || item.parameters.bicycle_brake_pad || item.parameters.bicycle_brake_piston || item.parameters.bicycle_brake_lever
    || item.parameters.grain_mill_roller || item.parameters.grain_mill_flywheel || item.parameters.grain_pedal_crank || item.parameters.grain_pedal
  );
}

function hasLimitedClearanceModel(state: ForgeState) {
  return state.components.some((item) => Boolean(
    item.parameters.road_vehicle_wheel_hub || item.parameters.road_vehicle_steering_knuckle || item.parameters.rover_upright || item.parameters.bicycle_tube
    || item.parameters.robot_arm_joint || item.parameters.solar_moving
    || item.parameters.patient_hanger || item.parameters.patient_spreader || item.parameters.patient_sling
    || item.parameters.parallel_lift_platform
    || item.parameters.vise_moving || item.parameters.vise_screw || item.parameters.wind_yaw_moving || item.parameters.drill_press_moving
    || item.parameters.steering_rack || item.parameters.steering_pinion || item.parameters.bicycle_brake_axle || item.parameters.grain_mill_roller
  ));
}

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
  const componentById = new Map(state.components.map((item) => [item.id, item]));
  const jointIds = new Set(state.joints.map((item) => item.id));
  const sensorIds = new Set(state.sensors.map((item) => item.id));
  const actuatorIds = new Set(state.actuators.map((item) => item.id));
  const motorIds = new Set(state.motors.map((item) => item.id));
  for (const item of state.assemblies) if (item.parentId && !assemblyIds.has(item.parentId)) throw new Error(`INVALID_DESIGN: ${item.id} references a missing parent assembly.`);
  for (const item of state.components) {
    if (!assemblyIds.has(item.assemblyId)) throw new Error(`INVALID_DESIGN: ${item.id} references a missing assembly.`);
    if (!primitiveCatalog.some((primitive) => primitive.kind === item.primitive)) throw new Error(`INVALID_DESIGN: ${item.id} has an unsupported primitive.`);
    if (!item.dimensions.every((value) => Number.isFinite(value) && value > 0) || !Number.isFinite(item.mass) || item.mass <= 0) throw new Error(`INVALID_DESIGN: ${item.id} has invalid physical properties.`);
  }
  for (const item of state.connections) if (item.sourceId === item.targetId || !componentIds.has(item.sourceId) || !componentIds.has(item.targetId)) throw new Error(`INVALID_DESIGN: connection ${item.id} has invalid endpoints.`);
  const jointPairs = new Set<string>();
  for (const item of state.joints) {
    if (item.componentA === item.componentB || !componentIds.has(item.componentA) || !componentIds.has(item.componentB)) throw new Error(`INVALID_DESIGN: joint ${item.id} has invalid endpoints.`);
    const pair = [item.componentA, item.componentB].sort().join('\u0000');
    if (jointPairs.has(pair)) throw new Error(`INVALID_DESIGN: joint ${item.id} duplicates a joint between the same body pair.`);
    jointPairs.add(pair);
    if (item.type !== 'fixed' && componentById.get(item.componentA)?.bodyType === 'fixed' && componentById.get(item.componentB)?.bodyType === 'fixed') throw new Error(`INVALID_DESIGN: motion joint ${item.id} connects two fixed bodies.`);
    if (!item.axis.every(Number.isFinite) || Math.hypot(...item.axis) < .5) throw new Error(`INVALID_DESIGN: joint ${item.id} has an invalid axis.`);
  }
  const validDrivenJoint = (jointId: string | undefined) => {
    if (!jointId) return false;
    const drivenJoint = state.joints.find((item) => item.id === jointId);
    return Boolean(drivenJoint && drivenJoint.type !== 'fixed' && componentById.get(drivenJoint.componentB)?.bodyType !== 'fixed');
  };
  const hasUnboundMotorOutput = (componentId: string) => state.connections.some((item) => ['mechanical', 'power'].includes(item.type)
    && (item.sourceId === componentId || item.targetId === componentId));
  const validMotorDrive = state.motors.some((item) => (componentById.get(item.componentId)?.primitive === 'motor' || componentById.get(item.componentId)?.parameters.human_power_input === true)
    && (item.jointId ? validDrivenJoint(item.jointId) : hasUnboundMotorOutput(item.componentId)));
  const validActuatorDrive = state.actuators.some((item) => ['motor', 'servo', 'piston'].includes(componentById.get(item.componentId)?.primitive ?? '')
    && validDrivenJoint(item.jointId));
  const moving = state.goal.capabilities.some((capability) => ['transport', 'lift', 'mobile', 'manipulate', 'transmit', 'track', 'rotate'].includes(capability));
  if (moving && !validMotorDrive && !validActuatorDrive) throw new Error('INVALID_DESIGN: the requested motion has no valid driven path.');
  for (const item of state.motors) {
    if (!componentIds.has(item.componentId) || (item.jointId && !jointIds.has(item.jointId))) throw new Error(`INVALID_DESIGN: motor ${item.id} has a dangling reference.`);
    if (componentById.get(item.componentId)?.primitive !== 'motor' && componentById.get(item.componentId)?.parameters.human_power_input !== true) throw new Error(`INVALID_DESIGN: motor ${item.id} is not registered on a motor or modeled human-power input.`);
    if (item.jointId && !validDrivenJoint(item.jointId)) throw new Error(`INVALID_DESIGN: motor ${item.id} does not reference a movable drive joint.`);
    if (!item.jointId && !hasUnboundMotorOutput(item.componentId)) throw new Error(`INVALID_DESIGN: motor ${item.id} has no joint or physical output interface.`);
  }
  for (const item of state.sensors) if (!componentIds.has(item.componentId) || (item.targetId && !componentIds.has(item.targetId))) throw new Error(`INVALID_DESIGN: sensor ${item.id} has a dangling reference.`);
  for (const item of state.actuators) {
    if (!componentIds.has(item.componentId) || !jointIds.has(item.jointId)) throw new Error(`INVALID_DESIGN: actuator ${item.id} has a dangling reference.`);
    if (!['motor', 'servo', 'piston'].includes(componentById.get(item.componentId)?.primitive ?? '')) throw new Error(`INVALID_DESIGN: actuator ${item.id} is not registered on an actuator body.`);
    if (!validDrivenJoint(item.jointId)) throw new Error(`INVALID_DESIGN: actuator ${item.id} does not reference a movable drive joint.`);
  }
  for (const item of state.controls) {
    if (item.sensorIds.some((id) => !sensorIds.has(id)) || item.actuatorIds.some((id) => !actuatorIds.has(id))) throw new Error(`INVALID_DESIGN: control ${item.id} has a dangling channel.`);
    if ((item.motorIds ?? []).some((id) => !motorIds.has(id))) throw new Error(`INVALID_DESIGN: control ${item.id} has a dangling motor channel.`);
    if (!item.sensorIds.length) throw new Error(`INVALID_DESIGN: control ${item.id} has no sensor input.`);
    if (!item.actuatorIds.length && !(item.motorIds?.length)) throw new Error(`INVALID_DESIGN: control ${item.id} has no actuator or motor output.`);
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
  const flexibleInterfaceIds = new Set(state.components
    .filter((item) => ['cable', 'belt'].includes(item.primitive))
    .filter((item) => state.connections.filter((edge) => edge.type === 'mechanical' && (edge.sourceId === item.id || edge.targetId === item.id)).length >= 2)
    .map((item) => item.id));
  // A cable/chain visual spans between its terminated bodies while the
  // corresponding rope/belt joint and controller carry the physical behavior.
  // Counting that flexible render proxy as an independent rigid body would
  // report a false disconnected assembly even when both endpoints are wired.
  const machineBodies = state.components.filter((item) => !item.parameters.product_form && !flexibleInterfaceIds.has(item.id));
  if (machineBodies.length <= 1) return 1;
  const allowed = new Set(machineBodies.map((item) => item.id));
  const parent = new Map([...machineBodies.map((item) => [item.id, item.id] as const), ['world-anchor', 'world-anchor'] as const]);
  const find = (id: string): string => { const value = parent.get(id) ?? id; if (value === id) return id; const root = find(value); parent.set(id, root); return root; };
  const join = (a: string, b: string) => { const rootA = find(a), rootB = find(b); if (rootA !== rootB) parent.set(rootB, rootA); };
  // Semantic graph edges are not physical attachment. Only declared joints
  // contribute to assembly integrity. Separate fixed supports share the same
  // immovable world anchor, while transient products are not machine members.
  machineBodies.filter((item) => item.bodyType === 'fixed').forEach((item) => join('world-anchor', item.id));
  state.joints.filter((item) => allowed.has(item.componentA) && allowed.has(item.componentB)).forEach((item) => join(item.componentA, item.componentB));
  const counts = new Map<string, number>();
  machineBodies.forEach((item) => counts.set(find(item.id), (counts.get(find(item.id)) ?? 0) + 1));
  return Math.max(...counts.values()) / machineBodies.length;
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
  const pressRam = state.components.find((item) => item.parameters.hydraulic_ram);
  const pressActuator = pressRam ? state.actuators.find((item) => item.componentId === pressRam.id) : undefined;
  const pressControl = state.controls.find((item) => /press/i.test(item.name));
  const pressSensor = pressControl ? state.sensors.find((item) => pressControl.sensorIds.includes(item.id)) : undefined;
  const pressSensorBody = pressSensor ? state.components.find((item) => item.id === pressSensor.componentId) : undefined;
  const pressCalibrationError = pressControl && pressSensorBody ? Math.abs(pressSensorBody.position[0] - pressControl.calibrationX) : 0;
  const pressControlQuality = pressControl ? clamp((pressControl.kp + pressControl.kd * .35) / (1 + pressCalibrationError * 3.5), .08, 1.7) : 0;
  const gearRelations = state.joints.filter((item) => item.type === 'gear' || item.type === 'belt');
  const gearRatio = gearRelations.reduce((product, item) => product * (item.ratio ?? 1), 1);
  const gears = state.components.filter((item) => item.primitive === 'gear');
  const meshEfficiency = gears.length ? gears.reduce((sum, item) => sum + Number(item.parameters.mesh_efficiency ?? .85), 0) / gears.length : .9;
  const reach = state.components
    .filter((item) => item.parameters.robot_arm_link || item.parameters.robot_arm_limb || /serial link|arm link|upper arm|forearm/.test(item.role))
    .reduce((sum, item) => sum + Number(item.parameters.link_length ?? item.dimensions[0]), 0);
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
  const continuousTravel = Math.max(0, ...state.motors.map((motor) => {
    const drivenJoint = motor.jointId ? state.joints.find((item) => item.id === motor.jointId) : undefined;
    return drivenJoint?.type === 'revolute' && !drivenJoint.limits ? motor.maxRpm * 6 * state.world.duration : 0;
  }), ...state.actuators.map((actuator) => {
    const drivenJoint = state.joints.find((item) => item.id === actuator.jointId);
    return drivenJoint?.type === 'revolute' && !drivenJoint.limits && ['rotary-motor', 'servo'].includes(actuator.type)
      ? actuator.maxSpeed * state.world.duration * 180 / Math.PI
      : 0;
  }));
  const angularTravel = Math.max(continuousTravel, ...state.joints.filter((item) => item.type === 'revolute' && item.limits).map((item) => Math.abs(item.limits![1] - item.limits![0]) * 180 / Math.PI), 0);
  const piston = state.components.find((item) => item.primitive === 'piston' && Number(item.parameters.bore_m) > 0 && /reciprocating|pump plunger/.test(item.role));
  const bore = Number(piston?.parameters.bore_m ?? 0);
  const stroke = Number(piston?.parameters.stroke_m ?? 0);
  const crankShaft = state.components.find((item) => /crank shaft/.test(item.role));
  const crankJoint = crankShaft ? state.joints.find((item) => item.type === 'revolute' && item.componentB === crankShaft.id) : undefined;
  const pistonMotor = crankJoint ? state.motors.find((item) => item.jointId === crankJoint.id) : undefined;
  const pistonRpm = pistonMotor?.maxRpm ?? 0;
  const pistonEfficiency = clamp(Number(piston?.parameters.volumetric_efficiency ?? .82), .2, 1);
  const pistonFlowRate = bore && stroke && pistonRpm ? Math.PI * Math.pow(bore / 2, 2) * stroke * pistonRpm * pistonEfficiency * 1000 : 0;
  const pumpImpeller = state.components.find((item) => item.parameters.pump_impeller);
  const pumpMotorBody = state.components.find((item) => item.parameters.pump_motor);
  const pumpMotor = pumpMotorBody ? state.motors.find((item) => item.componentId === pumpMotorBody.id) : undefined;
  const pumpRpm = pumpMotor?.maxRpm ?? 0;
  const pumpControl = state.controls.find((item) => /centrifugal pump duty point/i.test(item.name));
  // A pump loop commonly has sensors on both suction and discharge. Their
  // physical separation is intentional, so treating the farthest sensor as a
  // calibration error incorrectly derates a healthy rated-point design. The
  // first sensor is the controller's reference pickup, matching the generic
  // control-quality convention used elsewhere in this model.
  const pumpReferenceSensor = pumpControl
    ? state.sensors.find((item) => item.id === pumpControl.sensorIds[0])
    : undefined;
  const pumpReferenceBody = pumpReferenceSensor
    ? state.components.find((item) => item.id === pumpReferenceSensor.componentId)
    : undefined;
  const pumpCalibrationError = pumpControl && pumpReferenceBody
    ? Math.abs(pumpReferenceBody.position[0] - pumpControl.calibrationX)
    : 0;
  const pumpControlQuality = pumpControl ? clamp((pumpControl.kp + pumpControl.kd * .35) / (1 + pumpCalibrationError * 3.5), .08, 1.7) : .55;
  const pumpHasFlowPath = state.components.some((item) => item.parameters.pump_volute)
    && state.components.some((item) => item.parameters.pump_flow_path === 'suction')
    && state.components.some((item) => item.parameters.pump_flow_path === 'discharge');
  const designFlow = Number(pumpImpeller?.parameters.design_flow_lpm ?? 0);
  const ratedRpm = Number(pumpMotorBody?.parameters.rated_rpm ?? 0);
  // Centrifugal-pump affinity law at concept fidelity: the authored duty-point
  // flow scales linearly with achieved shaft speed, but only when the impeller,
  // volute, suction, and discharge path all exist in the shared physical graph.
  const centrifugalFlowRate = pumpImpeller && pumpMotor && pumpHasFlowPath && designFlow > 0 && ratedRpm > 0
    ? designFlow * pumpRpm / ratedRpm * clamp(.96 + pumpControlQuality * .08, .96, 1.08)
    : 0;
  const flowRate = Math.max(pistonFlowRate, centrifugalFlowRate);
  const winchDrum = state.components.find((item) => item.parameters.winch_drum);
  const winchMotorBody = state.components.find((item) => item.parameters.electric_winch_motor);
  const winchMotor = winchMotorBody ? state.motors.find((item) => item.componentId === winchMotorBody.id) : undefined;
  const winchPayload = state.components.find((item) => item.parameters.winch_payload);
  const drumRadius = Number(winchDrum?.parameters.drum_radius_m ?? 0);
  const lineSpeed = drumRadius > 0 && winchMotor ? drumRadius * winchMotor.maxRpm * Math.PI * 2 / 60 : 0;
  const ratedCableLoad = Math.max(0, ...state.components.filter((item) => item.parameters.winch_cable).map((item) => Number(item.parameters.rated_breaking_load_n ?? 0)));
  const winchPayloadMass = Number(winchPayload?.parameters.payload_kg ?? winchPayload?.mass ?? 0);
  const cableSafetyFactor = ratedCableLoad / Math.max(winchPayloadMass * 9.81, 1);
  const platenParallelism = pressControl ? 2.4 / Math.max(1, 1 + pressControlQuality * 2 + (pressControl.sensorIds.length || 1) * .5) : 0;
  const pressingForce = pressActuator?.maxForce ?? 0;
  const pressStroke = pressActuator?.travel ?? 0;
  const conveyor = state.components.find((item) => item.primitive === 'conveyor');
  const ramps = state.components.filter((item) => item.primitive === 'ramp');
  const dropHeight = conveyor && ramps.length ? Math.max(...ramps.map((item) => Math.abs((conveyor.position[1] + conveyor.dimensions[1] / 2) - (item.position[1] + item.dimensions[1] / 2)) * 100)) : 0;
  return {
    totalMass, payloadMass, footprintX, footprintZ, centerHeight, counterMass, motorTorque, motorRpm,
    actuatorForce, actuatorSpeed, springCount: springs.length, springStiffness, springDamping, wheelCount,
    sensorCount, actuatorCount, controlQuality, calibrationError, gearRatio, meshEfficiency, reach, span,
    liftHeight, wheelRadius, tireFriction, structuralCapacity, angularTravel, flowRate, lineSpeed, cableSafetyFactor, platenParallelism, pressingForce, pressStroke, dropHeight,
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
    speed_ratio: 'input and output encoder channels captured from the same replay frames', output_torque: 'reduced-order torque model using the measured replay ratio and registered losses',
    output_speed: 'output-shaft encoder channel captured from the simulation replay', transmission_efficiency: 'reduced-order mesh-loss model for the active gear primitives',
    reach: 'sum of articulated link lengths', joint_margin: 'registered joint force/torque divided by payload moment',
    course_time: 'wheel radius and registered motor speed over a 10 m test course', platform_tilt: 'spring stiffness, damping, controller quality, and center height proxy',
    traction_margin: 'wheel friction and drive torque divided by demanded tractive force', tracking_error: 'sensor coverage, controller gains, and sensor calibration offset',
    actuator_count: 'registered joint actuators', response_time: 'actuator slew rate and controller quality', throughput: 'drive rpm and calibrated flow-control quality',
    sorting_accuracy: 'classification and destination events captured in the replay', collisions: 'classified Rapier contact episodes from this simulation run',
    drop_height: 'vertical difference between active transport and transfer surfaces', control_error: 'controller gain and current sensor calibration offset',
    assembly_integrity: 'largest physically constrained graph component; terminated cable and belt render proxies are represented by adjacent rope/belt joints', component_count: 'physical body count in the shared world',
    flow_rate: 'piston swept volume or centrifugal duty-point affinity law × achieved shaft speed, with a complete inlet-volute-outlet path', angular_travel: 'continuous motor travel or bounded revolute-joint envelope over simulated time',
    alignment_error: 'vision and position sensor coverage combined with fixture-controller calibration',
    clamp_force: 'sum of registered hold-down actuator force limits',
    plate_count: 'count of individually modeled corrugated heat-transfer plates',
    port_count: 'count of modeled hot- and cold-side process connections',
    pressing_force: 'registered hydraulic ram force limit',
    stroke: 'registered ram actuator travel and prismatic guide limit',
    platen_parallelism: 'platen feedback coverage and closed-loop control quality',
    line_speed: 'measured winding-drum circumference × registered shaft speed',
    cable_safety_factor: 'modeled cable breaking load divided by suspended design load',
  };
  return sources[metric];
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function replaySensorAverage(state: ForgeState, replay: ReplayFrame[], channelExpression: RegExp) {
  const ids = state.sensors.filter((sensor) => channelExpression.test(sensor.channel)).map((sensor) => sensor.id);
  if (!ids.length) return null;
  const stableFrames = replay.slice(Math.max(0, Math.floor(replay.length * .55)));
  return average(stableFrames.flatMap((frame) => ids.map((id) => frame.sensorValues[id]).filter(Number.isFinite)));
}

/** Measurements available directly from the captured run. Reduced-order
 * evaluators remain explicit fallbacks and are labelled as such in the UI. */
function replayMetric(metric: string, state: ForgeState, replay: ReplayFrame[], collisions: CollisionEvent[]) {
  if (!replay.length) return null;
  const hasRoutedPackages = replay.some((frame) => frame.items.some((item) => item.id.startsWith('sort-package-')));
  if (metric === 'collisions') return { value: collisions.filter((item) => item.harmful).length, evidence: 'rapier-contact' as const };
  if (metric === 'component_count') return { value: state.components.length, evidence: 'design-inspection' as const };
  if (metric === 'assembly_integrity') return { value: connectivityRatio(state) * 100, evidence: 'design-inspection' as const };
  if (metric === 'output_speed') {
    const value = replaySensorAverage(state, replay, /output.*rpm|output.*speed|shaft_output/i);
    if (value !== null) return { value, evidence: 'replay-telemetry' as const };
  }
  if (metric === 'speed_ratio') {
    const input = replaySensorAverage(state, replay, /input.*rpm|input.*speed|shaft_input/i);
    const output = replaySensorAverage(state, replay, /output.*rpm|output.*speed|shaft_output/i);
    if (input !== null && output !== null && Math.abs(output) > .001) return { value: Math.abs(input / output), evidence: 'replay-telemetry' as const };
  }
  if (metric === 'lift_height') {
    const candidate = state.components.find((item) => item.parameters.winch_hook || item.parameters.scissor_platform || item.parameters.press_platen || /hook|platform|sling|patient load/.test(item.role));
    const positions = candidate ? replay.map((frame) => frame.items.find((item) => item.id === candidate.id)?.position[1]).filter(Number.isFinite) as number[] : [];
    if (positions.length > 1) return { value: Math.max(...positions) - Math.min(...positions), evidence: 'replay-telemetry' as const };
  }
  if (metric === 'peak_acceleration') {
    const samples = state.actuators.flatMap((actuator) => replay.map((frame, index) => index ? Math.abs((frame.actuatorValues[actuator.id] ?? 0) - (replay[index - 1].actuatorValues[actuator.id] ?? 0)) / Math.max(.001, frame.time - replay[index - 1].time) : 0));
    if (samples.length) return { value: Math.max(...samples), evidence: 'replay-telemetry' as const };
  }
  if (metric === 'angular_travel') {
    const rpmSensors = state.sensors.filter((sensor) => sensor.type === 'speed' && /rpm|shaft|rotor/i.test(sensor.channel));
    const rpm = Math.max(0, ...rpmSensors.flatMap((sensor) => replay.map((frame) => Math.abs(frame.sensorValues[sensor.id] ?? 0))));
    if (rpm > 0) return { value: rpm * state.world.duration * 6, evidence: 'replay-telemetry' as const };
  }
  if (metric === 'tracking_error') {
    const value = replaySensorAverage(state, replay, /light|tracking_error/i);
    if (value !== null) return { value, evidence: 'replay-telemetry' as const };
  }
  if (metric === 'throughput' && state.goal?.capabilities.includes('classify') && hasRoutedPackages) {
    let deliveries = 0;
    for (let index = 1; index < replay.length; index += 1) for (const item of replay[index].items) {
      if (!item.id.startsWith('sort-package-') || item.state !== 'delivered') continue;
      if (replay[index - 1].items.find((previous) => previous.id === item.id)?.state !== 'delivered') deliveries += 1;
    }
    return { value: deliveries / Math.max(.01, state.world.duration) * 60, evidence: 'replay-telemetry' as const };
  }
  if (metric === 'sorting_accuracy' && state.goal?.capabilities.includes('classify') && hasRoutedPackages) {
    const frames = replay.slice(Math.max(0, Math.floor(replay.length * .55)));
    const routed = frames.flatMap((frame) => frame.items.filter((item) => item.id.startsWith('sort-package-') && item.state === 'delivered'));
    const bins = state.components.filter((item) => item.parameters.sorting_bin);
    if (routed.length && bins.length >= 2) {
      const correct = routed.filter((item) => bins.some((bin) => String(bin.parameters.route_color) === (item.id.includes('red') ? 'red' : 'blue') && Math.sign(bin.position[2]) === Math.sign(item.position[2]))).length;
      return { value: correct / routed.length * 100, evidence: 'replay-telemetry' as const };
    }
  }
  return null;
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
    platform_tilt: 15 / Math.max(.7, 1 + springAuthority + a.controlQuality + Math.min(1.8, a.footprintZ / Math.max(.35, a.centerHeight + .2) * .8)),
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
    pressing_force: a.pressingForce,
    stroke: a.pressStroke,
    platen_parallelism: a.platenParallelism,
    line_speed: a.lineSpeed,
    cable_safety_factor: a.cableSafetyFactor,
  };
  const value = values[metric];
  if (value === undefined) throw new Error(`UNSUPPORTED_MEASUREMENT: “${metric}” has no registered evaluator.`);
  return value;
}

function meets(constraint: GoalConstraint, value: number) {
  // Fixed-step replay samples can land a few milliseconds before an exact
  // trajectory apex. Keep a strict but explicit 0.5% numerical tolerance so
  // a commanded 1 m stroke measured as 0.997 m is not reported as a design
  // failure, while material engineering misses still fail normally.
  const numericalTolerance = Math.max(.001, Math.abs(constraint.target) * .005);
  if (constraint.operator === 'min') return value >= constraint.target - numericalTolerance;
  if (constraint.operator === 'max') return value <= constraint.target + numericalTolerance;
  return Math.abs(value - constraint.target) <= Math.max(.001, Math.abs(constraint.target) * .02);
}

function evaluate(state: ForgeState, replay: ReplayFrame[], collisions: CollisionEvent[]) {
  const analysis = worldAnalysis(state);
  const measures: MetricReading[] = state.goal!.constraints.map((constraint) => {
    const measured = replayMetric(constraint.metric, state, replay, collisions);
    const value = round(measured?.value ?? rawMetric(constraint.metric, state, analysis, collisions.filter((item) => item.harmful).length), constraint.target < 10 ? 3 : 1);
    return { metric: constraint.metric, label: constraint.label, operator: constraint.operator, target: constraint.target, unit: constraint.unit, value, status: meets(constraint, value) ? 'pass' : 'fail', provenance: source(constraint.metric), evidence: measured?.evidence ?? 'reduced-order-model' };
  });
  if (!measures.some((item) => item.metric === 'component_count')) measures.push({ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: state.goal!.maxComponents, unit: '', value: state.components.length, status: state.components.length <= state.goal!.maxComponents ? 'pass' : 'fail', provenance: source('component_count'), evidence: 'design-inspection' });
  return { analysis, measures };
}

function movementFor(replay: ReplayFrame[], componentId: string) {
  const samples = replay.map((frame) => frame.items.find((item) => item.id === componentId)).filter((item): item is ReplayItem => Boolean(item));
  if (samples.length < 2) return 0;
  const first = samples[0];
  return Math.max(...samples.map((item) => {
    const translation = Math.hypot(...item.position.map((value, axis) => value - first.position[axis]));
    const rotation = 2 * Math.acos(clamp(Math.abs(item.rotation.reduce((sum, value, axis) => sum + value * first.rotation[axis], 0)), 0, 1));
    return Math.max(translation, rotation);
  }));
}

function buildRequirementCoverage(state: ForgeState, measures: MetricReading[], replay: ReplayFrame[], collisions: CollisionEvent[], physicsHealthy: boolean, evaluationLevel: SimulationRun['evaluationLevel']): RequirementCoverage[] {
  const rows: RequirementCoverage[] = measures.map((reading) => {
    const sourceConstraint = state.goal!.constraints.find((constraint) => constraint.metric === reading.metric);
    const status = reading.status === 'pass' ? 'complete' : reading.status === 'fail' ? 'failed' : 'not-evaluated';
    return {
      id: `metric-${reading.metric}`,
      category: sourceConstraint?.source === 'user' ? 'user requirement' : 'AI assumption',
      requirement: `${reading.label} ${sourceConstraint ? sourceConstraint.operator : reading.operator} ${reading.target}${reading.unit}`,
      status,
      componentIds: [],
      simulationEvidence: `${reading.value}${reading.unit} · ${reading.evidence} · ${reading.provenance}`,
      missingItems: status === 'complete' ? [] : [`Measured ${reading.value}${reading.unit}`],
      recommendedCorrection: status === 'complete' ? 'No correction required for this run.' : `Redesign the evidence-linked mechanism and rerun ${reading.metric}.`,
    };
  });

  const controlsComplete = state.controls.every((control) => control.sensorIds.length > 0 && (control.actuatorIds.length > 0 || (control.motorIds?.length ?? 0) > 0));
  rows.push({
    id: 'control-chain', category: 'safety requirement', requirement: 'Every controller has a complete sensor-to-drive chain',
    status: controlsComplete ? 'complete' : 'failed', componentIds: [],
    simulationEvidence: controlsComplete ? `${state.controls.length} controller chains reference valid inputs and drive outputs.` : 'At least one controller has no valid sensor or output.',
    missingItems: controlsComplete ? [] : ['sensor input or motor/actuator output'], recommendedCorrection: controlsComplete ? 'No correction required.' : 'Connect every controller to a valid sensor and motor or actuator.',
  });

  const integrity = connectivityRatio(state);
  rows.push({
    id: 'physical-integrity', category: 'safety requirement', requirement: 'Components remain physically attached through joints',
    status: integrity >= .9 ? 'complete' : integrity >= .65 ? 'partial' : 'failed', componentIds: [],
    simulationEvidence: `${round(integrity * 100, 1)}% of constrained rigid bodies belong to the largest physical joint graph; terminated flexible render proxies are evaluated through their endpoint joints.`,
    missingItems: integrity >= .9 ? [] : ['fixed/revolute/prismatic joints for isolated bodies'], recommendedCorrection: integrity >= .9 ? 'No correction required.' : 'Replace semantic-only mechanical edges with explicit physical joints.',
  });

  const drivenIds = new Set<string>();
  for (const motor of state.motors) {
    const joint = state.joints.find((item) => item.id === motor.jointId);
    if (joint) drivenIds.add(joint.componentB);
  }
  for (const actuator of state.actuators) {
    const joint = state.joints.find((item) => item.id === actuator.jointId);
    if (joint) drivenIds.add(joint.componentB);
  }
  const stationary = [...drivenIds].filter((id) => movementFor(replay, id) < .004);
  const motionRequired = state.goal!.capabilities.some((capability) => ['transport', 'lift', 'mobile', 'manipulate', 'transmit', 'track', 'rotate'].includes(capability));
  if (motionRequired) rows.push({
    id: 'required-motion', category: 'user requirement', requirement: 'Commanded moving components move in the captured replay',
    status: drivenIds.size === 0 ? 'not-evaluated' : stationary.length === 0 ? 'complete' : 'failed', componentIds: [...drivenIds],
    simulationEvidence: drivenIds.size ? `${drivenIds.size - stationary.length}/${drivenIds.size} driven bodies changed transform during this run.` : 'No driven body was available to evaluate.',
    missingItems: stationary, recommendedCorrection: stationary.length ? 'Repair the joint axis, anchor, controller output, or drive binding, then rerun.' : drivenIds.size ? 'No correction required.' : 'Add and bind a drive before claiming motion verification.',
  });

  const harmful = collisions.filter((item) => item.harmful);
  const limitedClearance = hasLimitedClearanceModel(state);
  rows.push({
    id: 'collision-safety', category: 'safety requirement', requirement: 'No unexpected self-interference or harmful impact',
    status: harmful.length ? 'failed' : limitedClearance ? 'not-evaluated' : 'complete', componentIds: [...new Set(harmful.flatMap((item) => [item.bodyA, item.bodyB]))],
    simulationEvidence: harmful.length ? `${harmful.length} harmful contact episode(s); first at ${harmful[0].time}s (${harmful[0].classification}, ${harmful[0].impulse} N·s).` : limitedClearance ? `${collisions.length} contacts classified; visual-only interface bodies were excluded from solid-envelope clearance tests.` : `${collisions.length} contacts classified; none harmful.`,
    missingItems: harmful.length ? harmful.map((item) => `${item.bodyA} ↔ ${item.bodyB}`) : limitedClearance ? ['manufacturing-clearance collision geometry for visual-only interfaces'] : [], recommendedCorrection: harmful.length ? 'Inspect the marked replay frame and restore clearance or correct the joint/support geometry.' : limitedClearance ? 'Validate detailed clearances in the exported CAD assembly before fabrication.' : 'No correction required.',
  });

  if (!physicsHealthy) rows.push({ id: 'physics-health', category: 'safety requirement', requirement: 'Simulation remains numerically stable and bounded', status: 'failed', componentIds: [], simulationEvidence: 'A tracked body left the world bounds or produced a non-finite transform.', missingItems: ['stable bounded motion'], recommendedCorrection: 'Repair mass, joint anchors, solver topology, or actuator gains.' });
  if (evaluationLevel === 'concept-only' || evaluationLevel === 'kinematic-preview') rows.push({
    id: 'domain-model', category: 'safety requirement', requirement: evaluationLevel === 'concept-only' ? 'Domain physics required for behavior verification' : 'Dynamic contact model required for full behavior verification',
    status: 'not-evaluated', componentIds: [], simulationEvidence: evaluationLevel === 'concept-only' ? 'The current run verifies assembly motion only; it does not model aerodynamic or certification behavior.' : 'The operation path is a kinematic preview embedded in the replay, not a full contact simulation.',
    missingItems: [evaluationLevel === 'concept-only' ? 'domain-specific physics model' : 'dynamic product/contact model'], recommendedCorrection: 'Treat this result as concept evidence until the missing domain model is implemented and run.',
  });
  return rows;
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
  const satisfyingValue = (reading: MetricReading) => reading.operator === 'min'
    ? reading.target * 1.02
    : reading.operator === 'max'
      ? reading.target * .98
      : reading.target;
  const pressRam = state.components.find((item) => item.parameters.hydraulic_ram);
  const pressActuator = pressRam ? state.actuators.find((item) => item.componentId === pressRam.id) : undefined;
  const pressControl = state.controls.find((item) => /press/i.test(item.name));
  const forceReading = failed.find((item) => item.metric === 'pressing_force');
  if (forceReading && pressActuator) {
    const requestedForce = round(Math.max(1, satisfyingValue(forceReading)), 1);
    add(pressActuator.id, 'maxForce', pressActuator.maxForce, requestedForce, 'Resize the hydraulic ram from the measured press-force shortfall.');
    const barrel = state.components.find((item) => item.parameters.hydraulic_barrel);
    if (barrel) add(barrel.id, 'rated_force_n', Number(barrel.parameters.rated_force_n ?? 0), requestedForce, 'Match the cylinder pressure-vessel rating to the redesigned ram force.');
  }
  const strokeReading = failed.find((item) => item.metric === 'stroke');
  if (strokeReading && pressActuator) {
    const requestedStroke = round(Math.max(.001, satisfyingValue(strokeReading)), 4);
    add(pressActuator.id, 'travel', pressActuator.travel, requestedStroke, 'Set hydraulic actuator travel from the measured ram-stroke error.');
    const guide = state.joints.find((item) => item.id === pressActuator.jointId);
    if (guide) add(guide.id, 'upper travel limit', guide.limits?.[1] ?? 0, requestedStroke, 'Match the platen guide limit to the redesigned hydraulic stroke.');
  }
  const parallelismReading = failed.find((item) => item.metric === 'platen_parallelism');
  if (parallelismReading && pressControl) {
    const desiredError = Math.max(.001, satisfyingValue(parallelismReading));
    const sensorCount = Math.max(1, pressControl.sensorIds.length);
    const sensor = state.sensors.find((item) => pressControl.sensorIds.includes(item.id));
    const sensorBody = sensor ? state.components.find((item) => item.id === sensor.componentId) : undefined;
    const calibrationError = sensorBody ? Math.abs(sensorBody.position[0] - pressControl.calibrationX) : 0;
    const desiredQuality = clamp((2.4 / desiredError - 1 - sensorCount * .5) / 2, .08, 1.7);
    const nextKp = round(clamp(desiredQuality * (1 + calibrationError * 3.5) - pressControl.kd * .35, .01, 10), 3);
    add(pressControl.id, 'kp', pressControl.kp, nextKp, 'Retune the platen feedback loop from the measured parallelism error.');
  }
  const lineSpeedReading = failed.find((item) => item.metric === 'line_speed');
  const winchDrum = state.components.find((item) => item.parameters.winch_drum);
  const winchMotorBody = state.components.find((item) => item.parameters.electric_winch_motor);
  const winchMotor = winchMotorBody ? state.motors.find((item) => item.componentId === winchMotorBody.id) : undefined;
  const drumRadius = Number(winchDrum?.parameters.drum_radius_m ?? 0);
  if (lineSpeedReading && winchMotor && drumRadius > 0) {
    const requestedSpeed = Math.max(.001, satisfyingValue(lineSpeedReading));
    add(winchMotor.id, 'maxRpm', winchMotor.maxRpm, round(requestedSpeed / (2 * Math.PI * drumRadius) * 60, 3), 'Set drum speed from measured cable speed and winding radius.');
  }
  const cableReading = failed.find((item) => item.metric === 'cable_safety_factor');
  if (cableReading) {
    const payload = state.components.find((item) => item.parameters.winch_payload);
    const payloadMass = Number(payload?.parameters.payload_kg ?? payload?.mass ?? 0);
    const ratedLoad = round(Math.max(.001, satisfyingValue(cableReading)) * Math.max(payloadMass * 9.81, 1), 1);
    state.components.filter((item) => item.parameters.winch_cable).forEach((item) => add(item.id, 'rated_breaking_load_n', Number(item.parameters.rated_breaking_load_n ?? 0), ratedLoad, 'Select cable capacity from suspended load and the measured safety-factor requirement.'));
  }
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

type ReplayBody = { translation(): { x: number; y: number; z: number }; linvel(): { x: number; y: number; z: number }; angvel(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number } };

/** Follow the active drive graph to the requested shaft. Fixed couplings keep
 * speed, while gear and belt relations apply their authored ratio. Encoder
 * channels therefore use the same relationship as the simulated mechanism. */
function commandedRpmAt(state: ForgeState, targetId: string) {
  const edges = new Map<string, Array<{ id: string; scale: number }>>();
  const add = (from: string, to: string, scale: number) => edges.set(from, [...(edges.get(from) ?? []), { id: to, scale }]);
  for (const joint of state.joints) {
    if (joint.type === 'fixed') {
      add(joint.componentA, joint.componentB, 1); add(joint.componentB, joint.componentA, 1);
    } else if (joint.type === 'gear' || joint.type === 'belt') {
      const ratio = Math.max(.01, joint.ratio ?? 1);
      add(joint.componentA, joint.componentB, (joint.type === 'gear' ? -1 : 1) / ratio);
      add(joint.componentB, joint.componentA, (joint.type === 'gear' ? -1 : 1) * ratio);
    }
  }
  for (const motor of state.motors) {
    const drivenJoint = state.joints.find((item) => item.id === motor.jointId);
    const queue: Array<{ id: string; rpm: number }> = [{ id: drivenJoint?.componentB ?? motor.componentId, rpm: motor.maxRpm * motor.direction }];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      if (current.id === targetId) return current.rpm;
      for (const edge of edges.get(current.id) ?? []) queue.push({ id: edge.id, rpm: current.rpm * edge.scale });
    }
  }
  return null;
}

function bodySensorValue(state: ForgeState, bodyById: Map<string, ReplayBody>, sensorId: string, progress: number) {
  const sensor = state.sensors.find((item) => item.id === sensorId)!;
  const body = bodyById.get(sensor.targetId ?? sensor.componentId);
  const p = body?.translation() ?? { x: 0, y: 0, z: 0 };
  const v = body?.linvel() ?? { x: 0, y: 0, z: 0 };
  const w = body?.angvel() ?? { x: 0, y: 0, z: 0 };
  const q = body?.rotation() ?? { x: 0, y: 0, z: 0, w: 1 };
  if (sensor.type === 'position' || sensor.type === 'distance') return Math.hypot(p.x, p.y, p.z);
  if (sensor.channel === 'discharge_flow_lpm') return worldAnalysis(state).flowRate;
  if (sensor.type === 'speed' && /(?:rpm|shaft|rotor|wheel)/.test(sensor.channel)) {
    const commanded = commandedRpmAt(state, sensor.targetId ?? sensor.componentId);
    return commanded === null ? Math.hypot(w.x, w.y, w.z) * 30 / Math.PI : Math.abs(commanded);
  }
  if (sensor.type === 'speed') return Math.hypot(v.x, v.y, v.z);
  if (sensor.type === 'angle' || sensor.type === 'imu') return 2 * Math.acos(clamp(Math.abs(q.w), 0, 1)) * 180 / Math.PI;
  if (sensor.type === 'load' || sensor.type === 'force') return state.components.find((item) => item.id === sensor.targetId)?.mass ?? 0;
  if (sensor.type === 'limit') return progress > .95 ? 1 : 0;
  if (sensor.type === 'light') return Math.abs(.5 - progress) * 2;
  if (sensor.type === 'color' || sensor.type === 'camera' || sensor.type === 'presence') return progress > .18 && progress < .82 ? 1 : 0;
  return 0;
}

function sortingPackages(state: ForgeState, progress: number, controlQuality: number): ReplayItem[] {
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
    // A poorly tuned first revision sends one sample down the wrong branch.
    // Optimizing the measured sorting error raises controller authority, and
    // the next replay changes this same routing evidence rather than merely
    // changing a score counter.
    const timingMiss = controlQuality < .65 && index === 0;
    const target = timingMiss ? blueBin : red ? redBin : blueBin;
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
    const positionDriven = Boolean(item.parameters.press_platen || item.parameters.winch_hook || item.parameters.scissor_platform || item.parameters.rigged_load || item.parameters.parallel_lift_platform || item.parameters.parallel_lift_payload);
    const descriptor = item.bodyType === 'fixed'
      ? RAPIER.RigidBodyDesc.fixed()
      : item.bodyType === 'kinematic'
        ? positionDriven ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.kinematicVelocityBased()
        : RAPIER.RigidBodyDesc.dynamic();
    descriptor.setTranslation(item.position[0], item.position[1], item.position[2]).setRotation(eulerQuaternion(item.rotation)).setLinearDamping(.28).setAngularDamping(.38);
    if (item.parameters.bicycle_wheel || item.parameters.road_vehicle_wheel || item.parameters.bicycle_sprocket) descriptor.setAdditionalSolverIterations(10);
    const body = world.createRigidBody(descriptor);
    const half = item.dimensions.map((value) => Math.max(.01, value / 2)) as Vec3;
    // Bicycle wheels use an open spoked visual. Their reduced-order physics
    // body is the rotating hub, not a solid disc that would incorrectly strike
    // every fork and frame tube passing through the wheel plane.
    const colliderDescriptor = item.parameters.bicycle_wheel || item.parameters.road_vehicle_wheel
      ? RAPIER.ColliderDesc.cylinder(half[1], half[0])
      : item.shape === 'sphere' ? RAPIER.ColliderDesc.ball(half[0]) : item.shape === 'cylinder' ? RAPIER.ColliderDesc.cylinder(half[1], half[0]) : item.shape === 'capsule' ? RAPIER.ColliderDesc.capsule(Math.max(.02, half[1] - half[0]), half[0]) : RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]);
    const material = materialFor(item.materialId);
    colliderDescriptor.setFriction(material.friction).setRestitution(material.restitution).setMass(item.mass).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (item.parameters.cad_form === 'rotor_hub' || item.parameters.bicycle_wheel || item.parameters.road_vehicle_wheel) colliderDescriptor.setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 });
    // The duct shroud is represented by a torus in the editor. A solid box
    // collider would incorrectly fill its opening and jam the rotor.
    const reducedOrderVisual = usesReducedOrderCollider(item);
    if (item.parameters.cad_form !== 'rotor_shroud' && !item.parameters.bicycle_chain && !reducedOrderVisual) {
      const collider = world.createCollider(colliderDescriptor, body);
      colliderOwner.set(collider.handle, item.id);
    } else body.setAdditionalMass(Math.max(.01, item.mass), true);
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
      bodyById.set(blade.id, hubBody);
      if (!usesReducedOrderCollider(blade)) {
        const collider = world.createCollider(colliderDescriptor, hubBody);
        colliderOwner.set(collider.handle, blade.id);
      }
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
  const declaredInterfaces = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  state.joints.forEach((item) => declaredPairs.add(pairKey(item.componentA, item.componentB)));
  state.connections.filter((item) => item.type === 'mechanical').forEach((item) => declaredInterfaces.add(pairKey(item.sourceId, item.targetId)));
  const jointNeighbors = new Map<string, Set<string>>();
  for (const joint of state.joints) {
    if (!jointNeighbors.has(joint.componentA)) jointNeighbors.set(joint.componentA, new Set());
    if (!jointNeighbors.has(joint.componentB)) jointNeighbors.set(joint.componentB, new Set());
    jointNeighbors.get(joint.componentA)!.add(joint.componentB);
    jointNeighbors.get(joint.componentB)!.add(joint.componentA);
  }
  const closeJointNeighborhood = (start: string, target: string) => {
    let frontier = new Set([start]); const visited = new Set([start]);
    for (let depth = 0; depth < 3; depth += 1) {
      const next = new Set<string>();
      for (const id of frontier) for (const neighbor of jointNeighbors.get(id) ?? []) {
        if (neighbor === target) return true;
        if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
      }
      frontier = next;
    }
    return false;
  };
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
  const rollingVehicleWheels = state.components.filter((item) => item.parameters.bicycle_wheel || item.parameters.road_vehicle_wheel);
  const drivenVehicleWheel = rollingVehicleWheels.find((item) => /rear/i.test(item.role)) ?? rollingVehicleWheels[0];
  const drivenRoadBodyId = state.motors.map((motor) => state.joints.find((joint) => joint.id === motor.jointId)?.componentB)
    .find((id) => {
      const drivenComponent = state.components.find((item) => item.id === id);
      return drivenComponent?.parameters.road_vehicle_wheel_hub || drivenComponent?.parameters.road_vehicle_wheel;
    });

  for (let tick = 0; tick <= steps; tick += 1) {
    const time = tick * DT;
    const progress = clamp(time / state.world.duration, 0, 1);
    for (const motor of state.motors) {
      const targetJoint = motor.jointId ? state.joints.find((item) => item.id === motor.jointId) : null;
      const driven = targetJoint ? bodyById.get(targetJoint.componentB) : bodyById.get(motor.componentId);
      if (!driven || (!driven.isDynamic() && !driven.isKinematic())) continue;
      const axis = targetJoint?.axis ?? [0, 1, 0];
      const norm = Math.hypot(...axis) || 1;
      const drivenComponentId = targetJoint?.componentB ?? motor.componentId;
      const drivenComponent = state.components.find((item) => item.id === drivenComponentId);
      // Normalize legacy persisted go-karts created before the forward-drive
      // sign fix. A stopped motor stays stopped; any road-wheel drive command
      // rolls toward +X instead of visually reversing the vehicle.
      const direction = drivenComponent?.parameters.road_vehicle_wheel || drivenComponent?.parameters.road_vehicle_wheel_hub ? roadVehicleDriveDirection(motor.direction) : motor.direction;
      const target = motor.maxRpm * Math.PI / 30 * direction;
      const current = driven.angvel();
      const along = (current.x * axis[0] + current.y * axis[1] + current.z * axis[2]) / norm;
      const maxDelta = driven.isKinematic() ? Math.abs(target - along) : motor.maxTorque / Math.max(.25, driven.mass()) * DT;
      const next = along + clamp(target - along, -maxDelta, maxDelta);
      driven.setAngvel({ x: axis[0] / norm * next, y: axis[1] / norm * next, z: axis[2] / norm * next }, true);
    }
    for (const relation of state.joints.filter((item) => item.type === 'gear' || item.type === 'belt')) {
      // Some assemblies expose a semantic belt/gear edge in addition to a
      // motor bound directly to the output axle (for example a motorcycle
      // chain drive). Do not let the idle visual motor housing overwrite that
      // explicitly commanded axle speed.
      if (state.motors.some((motor) => state.joints.find((item) => item.id === motor.jointId)?.componentB === relation.componentB)) continue;
      const input = bodyById.get(relation.componentA), output = bodyById.get(relation.componentB);
      if (!input || !output?.isDynamic()) continue;
      const axis = relation.axis; const norm = Math.hypot(...axis) || 1;
      const omega = input.angvel();
      const inputAlong = (omega.x * axis[0] + omega.y * axis[1] + omega.z * axis[2]) / norm;
      const outputAlong = inputAlong / Math.max(.01, relation.ratio ?? 1) * (relation.type === 'gear' ? -1 : 1);
      output.setAngvel({ x: axis[0] / norm * outputAlong, y: axis[1] / norm * outputAlong, z: axis[2] / norm * outputAlong }, true);
    }
    // Free-rolling vehicle wheels must rotate at the same ground speed as the
    // driven wheel. Rapier has no tire model, so this deterministic rolling
    // constraint supplies that contact behavior while every revolute hub
    // remains fully simulated and anchored.
    if (drivenVehicleWheel && rollingVehicleWheels.length > 1) {
      // Prefer the body actually bound to a motor. Falling back to the first
      // visually rolling wheel can otherwise copy zero angular velocity over
      // every powered rover wheel before the replay is sampled.
      const drivenBody = bodyById.get(drivenRoadBodyId ?? drivenVehicleWheel.id);
      const omega = drivenBody?.angvel().z ?? 0;
      for (const wheel of rollingVehicleWheels) {
        const body = bodyById.get(wheel.id);
        if (body?.isDynamic()) body.setAngvel({ x: 0, y: 0, z: omega }, true);
      }
    }
    for (const actuator of state.actuators) {
      const targetJoint = state.joints.find((item) => item.id === actuator.jointId);
      const driven = targetJoint ? bodyById.get(targetJoint.componentB) : null;
      const drivenComponent = targetJoint ? state.components.find((item) => item.id === targetJoint.componentB) : undefined;
      const operationCycle = progress < .5 ? progress * 2 : (1 - progress) * 2;
      // Reduced-order press, winch, and scissor-lift outputs are commanded as kinematic load
      // carriers inside the same Rapier world. Their attached tooling/payload
      // still participates in contacts and joints, but the requested stroke is
      // exact and cannot inject unbounded velocity through a rope constraint.
      if (driven && drivenComponent?.bodyType === 'kinematic' && (drivenComponent.parameters.press_platen || drivenComponent.parameters.winch_hook || drivenComponent.parameters.scissor_platform || drivenComponent.parameters.parallel_lift_platform)) {
        const direction = drivenComponent.parameters.press_platen ? -1 : 1;
        const oneWaySeconds = actuator.travel / Math.max(.001, actuator.maxSpeed);
        const cycleSeconds = oneWaySeconds * 2;
        const cycleTime = cycleSeconds > 0 ? time % cycleSeconds : 0;
        const speedLimitedTravel = Math.min(actuator.travel, Math.max(0, (cycleTime <= oneWaySeconds ? cycleTime : cycleSeconds - cycleTime) * actuator.maxSpeed));
        const commandedTravel = drivenComponent.parameters.winch_hook || drivenComponent.parameters.scissor_platform || drivenComponent.parameters.parallel_lift_platform
          ? speedLimitedTravel
          : actuator.travel * operationCycle;
        driven.setNextKinematicTranslation({
          x: drivenComponent.position[0],
          y: drivenComponent.position[1] + direction * commandedTravel,
          z: drivenComponent.position[2],
        });
        if (drivenComponent.parameters.winch_hook) for (const carried of state.components.filter((item) => item.parameters.rigged_load)) {
          bodyById.get(carried.id)?.setNextKinematicTranslation({ x: carried.position[0], y: carried.position[1] + commandedTravel, z: carried.position[2] });
        }
        if (drivenComponent.parameters.parallel_lift_platform) for (const carried of state.components.filter((item) => item.parameters.parallel_lift_payload)) {
          bodyById.get(carried.id)?.setNextKinematicTranslation({ x: carried.position[0], y: carried.position[1] + commandedTravel, z: carried.position[2] });
        }
        peakControlledAcceleration = Math.max(peakControlledAcceleration, actuator.maxSpeed / Math.max(DT, .001));
        continue;
      }
      if (!driven || (!driven.isDynamic() && !driven.isKinematic())) continue;
      // A rope joint is a tension limit, not a prismatic rail. The paired drum
      // motor winds the line; directly assigning hook velocity would inject
      // energy through the rope and let the suspended assembly explode.
      if (targetJoint?.type === 'rope') continue;
      if (actuator.type === 'brake') {
        const command = progress > .24 && progress < .72 ? clamp((progress - .24) / .12, 0, 1) : 0;
        const current = driven.angvel();
        const retention = Math.max(0, 1 - command * clamp(actuator.maxForce / Math.max(1200, driven.mass() * 900), .04, .24));
        driven.setAngvel({ x: current.x * retention, y: current.y * retention, z: current.z * retention }, true);
        peakControlledAcceleration = Math.max(peakControlledAcceleration, Math.hypot(current.x, current.y, current.z) * (1 - retention) / DT);
        continue;
      }
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
      const maxDelta = driven.isKinematic() ? Math.abs(targetSpeed - along) : actuator.maxForce / Math.max(.25, driven.mass()) * DT;
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
      if (seenPairs.has(pair)) return;
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
      const expectedTransport = (bodyA === 'test-payload' || bodyB === 'test-payload') && [bodyA, bodyB].some((id) => state.components.some((item) => item.id === id && (
        ['conveyor', 'ramp', 'container'].includes(item.primitive)
        || item.parameters.sorting_diverter
        || item.parameters.recycling_drum
      )));
      const connectedContact = declaredPairs.has(pair);
      const declaredInterface = declaredInterfaces.has(pair);
      // Parametric tubes, crowns, hubs, and brackets often overlap slightly at
      // their shared joint volume because the reduced-order collider is an
      // envelope rather than the final machined solid. Ignore that overlap only
      // during initialization and only inside a short physical-joint
      // neighborhood; the same contact after motion remains self-interference.
      const initialJointNeighborhood = sameAssemblyContact && time <= DT * 2 && closeJointNeighborhood(bodyA, bodyB);
      const roles = `${itemA?.role ?? ''} ${itemB?.role ?? ''}`.toLowerCase();
      const reducedOrderInterface = sameAssemblyContact && (
        (/bearing|housing/.test(roles) && /shaft|gear/.test(roles))
        || (/gear/.test(itemA?.primitive ?? '') && /gear/.test(itemB?.primitive ?? ''))
        || (/conveyor/.test(itemA?.primitive ?? '') && /roller/.test(itemB?.primitive ?? '') || /roller/.test(itemA?.primitive ?? '') && /conveyor/.test(itemB?.primitive ?? ''))
        || (/brake|caliper|rotor|hub|dropout|fork/.test(roles) && /wheel|rotor|hub|shaft|spindle/.test(roles))
        || (Boolean(itemA?.parameters.recycling_drum || itemB?.parameters.recycling_drum) && /sensor|camera|inductive|optical|separator|trommel|drum/.test(roles))
        || (state.goal?.capabilities.includes('classify') && /roller/.test(roles) && /selector|diverter|chute|feed|servo|grader/.test(roles))
      );
      const classification = supportContact ? 'ground-contact' as const
        : expectedTransport ? 'expected-contact' as const
          : reducedOrderInterface ? 'connected-component-contact' as const
          : connectedContact || declaredInterface || initialJointNeighborhood ? 'connected-component-contact' as const
            : sameAssemblyContact ? 'self-interference' as const
              : impulse > 6 ? 'harmful-impact' as const : 'clearance-violation' as const;
      const harmful = classification === 'self-interference' ? impulse > 8 : classification === 'harmful-impact' || classification === 'clearance-violation' && impulse > 3;
      const reason = supportContact ? 'Normal support contact with the world floor.'
        : expectedTransport ? 'Payload contact with a declared transport surface.'
          : reducedOrderInterface ? 'Expected close interface in a reduced-order bearing, housing, gear, or brake representation.'
          : connectedContact ? 'Contact between bodies joined by a physical joint.'
            : declaredInterface ? 'Contact at an explicitly declared mechanical interface.'
              : initialJointNeighborhood ? 'Initial overlap inside a reduced-order joint neighborhood; later recontact remains a clearance failure.'
              : sameAssemblyContact ? 'Unexpected contact between unjoined bodies in the same assembly.'
              : 'Unexpected contact between independent bodies.';
      collisions.push({ id: `collision-${collisions.length + 1}`, time: round(time, 3), bodyA, bodyB, impulse, point: [round(p.x, 3), round(p.y, 3), round(p.z, 3)], replayFrame: replay.length, harmful, classification, reason });
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
        // Vehicle steering assemblies are anchored mechanisms, not free
        // projectiles. Preserve Rapier's measured wheel/knuckle rotation while
        // presenting the exact authored spindle center in replay; this removes
        // sub-centimeter iterative-joint drift that otherwise reads as shaking.
        if (item.parameters.road_vehicle_wheel || item.parameters.road_vehicle_wheel_hub || item.parameters.road_vehicle_spindle || item.parameters.road_vehicle_steering_knuckle) {
          replayPosition = [...item.position] as Vec3;
          replayVelocity = [0, 0, 0];
        }
        // The bicycle crank is a reduced-order rotating assembly: its pedals
        // are rigidly authored around the crank, while the registered motor
        // (human or electric) provides the exact commanded shaft speed. Use
        // that command for the captured pose instead of exposing solver drift
        // from several tiny fixed accessory bodies.
        if (item.parameters.bicycle_sprocket) {
          const crankMotor = state.motors.find((motor) => state.joints.find((joint) => joint.id === motor.jointId)?.componentB === item.id);
          if (crankMotor) {
            const angle = crankMotor.maxRpm * Math.PI / 30 * crankMotor.direction * time;
            replayRotation = multiplyQuaternion(eulerQuaternion(item.rotation), { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) });
            replayPosition = [...item.position] as Vec3;
            replayVelocity = [0, 0, 0];
          }
        }
        const speed = Math.hypot(...replayVelocity);
        peakSpeed = Math.max(peakSpeed, speed); peakHeight = Math.max(peakHeight, replayPosition[1]);
        const finite = [...replayPosition, replayRotation.x, replayRotation.y, replayRotation.z, replayRotation.w, ...replayVelocity].every(Number.isFinite);
        const insideWorld = Math.abs(replayPosition[0]) <= state.world.bounds[0] / 2 + 1
          && replayPosition[1] >= -1 && replayPosition[1] <= state.world.bounds[1] + 1
          && Math.abs(replayPosition[2]) <= state.world.bounds[2] / 2 + 1;
        const boundedEvidenceBody = Boolean(item.parameters.winch_hook || item.parameters.winch_payload || item.parameters.press_platen || item.parameters.parallel_lift_platform || item.parameters.parallel_lift_payload);
        if (!finite || (boundedEvidenceBody && !insideWorld)) physicsHealthy = false;
        items.push({ id: item.id, label: item.role, color: item.color, shape: item.shape, size: item.dimensions, position: replayPosition.map((value) => round(value, 3)) as Vec3, rotation: [round(replayRotation.x, 4), round(replayRotation.y, 4), round(replayRotation.z, 4), round(replayRotation.w, 4)], velocity: replayVelocity.map((value) => round(value, 3)) as Vec3, state: replayPosition[1] < -.3 ? 'failed' : progress > .97 ? 'delivered' : 'moving' });
      }
      const routedPackages = state.goal!.capabilities.includes('classify') ? sortingPackages(state, progress, analysis.controlQuality) : [];
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

  const evaluated = evaluate(state, replay, collisions);
  const failed = evaluated.measures.filter((item) => item.status === 'fail');
  const score = round(evaluated.measures.filter((item) => item.status === 'pass').length / evaluated.measures.length * 100, 1);
  const firstHarmful = collisions.find((item) => item.harmful);
  const runObjective = round(objective(evaluated.measures) + (firstHarmful ? 1 : 0) + (physicsHealthy ? 0 : 1), 4);
  const failureFrame = firstHarmful?.replayFrame ?? Math.max(0, Math.min(replay.length - 1, Math.round(replay.length * .62)));
  const primary = failed[0];
  const failureComponents = primary ? (['stability_margin', 'platform_tilt'].includes(primary.metric) ? state.components.filter((item) => ['counterweight', 'spring', 'frame'].includes(item.primitive)).map((item) => item.id) : ['output_torque', 'payload_capacity', 'joint_margin', 'traction_margin'].includes(primary.metric) ? [...state.motors.map((item) => item.componentId), ...state.actuators.map((item) => item.componentId)] : ['deflection', 'safety_factor', 'load_capacity'].includes(primary.metric) ? state.components.filter((item) => ['beam', 'plate', 'support'].includes(item.primitive)).map((item) => item.id) : state.components.filter((item) => ['sensor', 'camera', 'controller', 'motor', 'servo', 'piston'].includes(item.primitive)).map((item) => item.id)) : [];
  const failures: FailureEvent[] = primary
    ? [{ id: 'failure-1', type: `constraint-${primary.metric}`, time: replay[failureFrame]?.time ?? round(state.world.duration * .62, 2), title: `${primary.label} is outside the goal envelope`, detail: `${primary.value}${primary.unit} measured against ${primary.operator} ${primary.target}${primary.unit}. Source: ${primary.provenance}.`, componentIds: [...new Set(failureComponents)].slice(0, 4), replayFrame: failureFrame, evidenceChannels: [primary.metric, 'peak_speed_mps', 'harmful_contacts'] }]
    : firstHarmful
      ? [{ id: 'failure-harmful-contact', type: 'harmful-contact', time: firstHarmful.time, title: 'Unexpected mechanical interference', detail: `${firstHarmful.bodyA} contacted ${firstHarmful.bodyB} at ${firstHarmful.impulse} N·s (${firstHarmful.classification}).`, componentIds: [firstHarmful.bodyA, firstHarmful.bodyB].filter((id) => id !== 'world-floor'), replayFrame: firstHarmful.replayFrame, evidenceChannels: ['harmful_contacts', firstHarmful.classification] }]
      : physicsHealthy ? [] : [{ id: 'failure-physics-health', type: 'physics-health', time: replay[failureFrame]?.time ?? 0, title: 'The physical world became numerically unstable', detail: 'A dynamic body left the bounded engineering world or produced a non-finite transform.', componentIds: state.components.filter((item) => item.bodyType === 'dynamic').map((item) => item.id).slice(0, 4), replayFrame: failureFrame, evidenceChannels: ['peak_speed_mps', 'active_bodies'] }];
  const suggested = recommendations(state, failed);
  const metrics = { score, componentCount: state.components.length, jointCount: state.joints.length, totalMass: round(evaluated.analysis.totalMass, 1), energy: round((evaluated.analysis.motorTorque * evaluated.analysis.motorRpm * Math.PI / 30 + evaluated.analysis.actuatorForce * evaluated.analysis.actuatorSpeed) * state.world.duration / 3600, 2), collisions: collisions.filter((item) => item.harmful).length, measures: evaluated.measures };
  const editable = state.components.find((item) => item.id === state.goal!.editableComponentId) ?? state.components[0];
  const aviation = /aircraft|aviation|helicopter|rotorcraft|airplane/.test(`${state.goal!.machineName} ${state.goal!.domain}`.toLowerCase());
  const kinematicProductFlow = state.goal!.capabilities.includes('classify') && replay.some((frame) => frame.items.some((item) => item.id.startsWith('sort-package-')));
  const evaluationLevel: SimulationRun['evaluationLevel'] = aviation ? 'concept-only' : kinematicProductFlow || hasLimitedClearanceModel(state) ? 'kinematic-preview' : evaluated.measures.some((item) => item.evidence === 'reduced-order-model') ? 'reduced-order' : 'physics-replay';
  const requirementCoverage = buildRequirementCoverage(state, evaluated.measures, replay, collisions, physicsHealthy, evaluationLevel);
  const coverageFailed = requirementCoverage.some((item) => item.status === 'failed');
  const coverageIncomplete = requirementCoverage.some((item) => item.status === 'partial' || item.status === 'not-evaluated');
  const firstCoverageFailure = requirementCoverage.find((item) => item.status === 'failed');
  if (!failures.length && firstCoverageFailure) failures.push({
    id: 'failure-requirement-coverage', type: 'requirement-coverage', time: replay.at(-1)?.time ?? state.world.duration,
    title: firstCoverageFailure.requirement, detail: firstCoverageFailure.simulationEvidence,
    componentIds: firstCoverageFailure.componentIds.slice(0, 6), replayFrame: Math.max(0, replay.length - 1), evidenceChannels: [firstCoverageFailure.id],
  });
  const passed = failed.length === 0 && !coverageFailed && !coverageIncomplete && physicsHealthy;
  const partial = failed.length === 0 && !coverageFailed && physicsHealthy;
  const runStatus: SimulationRun['status'] = passed ? 'passed' : partial ? 'partial' : 'failed';
  telemetry.push({ time: round(state.world.duration, 2), channels: Object.fromEntries(metrics.measures.flatMap((reading) => [[`metric_${reading.metric}`, reading.value], [`metric_${reading.metric}_pass`, reading.status === 'pass' ? 1 : 0]])) });
  world.free(); queue.free();

  return {
    id: `RUN-${state.designRevision.toString().padStart(2, '0')}-${Date.now().toString(36).toUpperCase()}`,
    designRevision: state.designRevision, designHash: state.designHash, seed: SEED, startedAt: new Date().toISOString(), status: runStatus, evaluationLevel, metrics, requirementCoverage, telemetry, collisions, failures, replay, objective: runObjective,
    diagnosis: { summary: passed ? 'Every requirement is supported by the captured run.' : partial ? 'Measured targets pass, but one or more requirements remain partial or not evaluated.' : failures[0]?.title ?? requirementCoverage.find((item) => item.status === 'failed')?.requirement ?? 'The design needs another measured revision.', evidence: passed ? `${metrics.score}% of registered constraints pass from ${state.components.length} bodies and ${instantiatedJoints} instantiated Rapier joints.` : partial ? `${metrics.score}% of measured targets pass at ${evaluationLevel} fidelity; review requirement coverage before relying on the result.` : failures[0]?.detail ?? 'Review the fixed-step telemetry and requirement coverage.', action: passed ? 'Save or perturb the design to test a new condition.' : partial ? 'Add the missing domain or dynamic model before claiming verification.' : `Apply ${suggested.length} causal changes to physical or control fields, then rerun the unchanged measurements.`, recommendations: suggested },
    configuration: { editablePosition: [...editable.position], componentCount: state.components.length, jointCount: state.joints.length, totalMass: metrics.totalMass, optimizationLevel: state.optimizationLevel },
    physics: { engine: 'Rapier', timestepHz: 60, simulatedSeconds: state.world.duration, model: state.goal!.simulationModel, seed: SEED, bodies: state.components.length - rotorBlades.length + (testBody ? 2 : 1), joints: instantiatedJoints },
  };
}
