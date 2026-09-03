import { Euler, Quaternion, Vector3 } from 'three';
import { resolveDrivenJointEndpoint } from './forge-joint-drive';
import type { Actuator, Joint, MachineComponent, Motor, SimulationRun, Vec3 } from './forge-types';

const STEERING_RATE = 0.82;
const ACCUMULATION_ZONE_SECONDS = 1.45;
const ACCUMULATION_ZONE_COUNT = 4;
const ACCUMULATION_ACTIVE_PHASE = .82;
const ACCUMULATION_ROLLER_RADIANS_PER_SECOND = 5.2;
const RECYCLING_BELT_CYCLES_PER_SECOND = .72;
const RECYCLING_BLOWER_RADIANS_PER_SECOND = 9.2;

export type MechanismOperationPose = { position: Vec3; rotation: Vec3; animated: boolean };

export type ProductOperationPose = { position: Vec3; rotation: Vec3 };

type Driver = { angularSpeed: number; linearSpeed: number; direction: number };
type Transform = { position: Vector3; rotation: Quaternion; animated: boolean };

export type MechanismMotionGraph = {
  poseAt(componentId: string, elapsed: number): MechanismOperationPose | null;
};

export type ScenePlaybackInput = {
  previewPlaying: boolean;
  previewElapsed: number;
  frameTime?: number | null;
  replayMode?: 'normal' | 'failure' | null;
  evaluationLevel?: SimulationRun['evaluationLevel'] | null;
};

export type ScenePlayback = {
  mode: 'idle' | 'preview' | 'replay';
  elapsed: number;
  active: boolean;
  frameDriven: boolean;
  replayMode: 'normal' | 'failure' | null;
  evaluationLevel: SimulationRun['evaluationLevel'] | null;
  authoritativeBodyTransforms: boolean;
};

/** Resolve one deterministic scene clock for rest, kinematic preview, and
 * recorded simulation playback. A replay frame is authoritative over the
 * preview toggle: local visual DOFs such as rotors must still be sampled when
 * the UI turns previewPlaying off to show a normal or failure replay. */
export function resolveScenePlayback(input: ScenePlaybackInput): ScenePlayback {
  const hasFrame = typeof input.frameTime === 'number' && Number.isFinite(input.frameTime);
  const evaluationLevel = input.evaluationLevel ?? null;
  if (hasFrame) {
    return {
      mode: 'replay',
      elapsed: Math.max(0, input.frameTime as number),
      active: true,
      frameDriven: true,
      replayMode: input.replayMode === 'failure' ? 'failure' : 'normal',
      evaluationLevel,
      authoritativeBodyTransforms: evaluationLevel === 'physics-replay',
    };
  }
  if (input.previewPlaying) {
    return {
      mode: 'preview',
      elapsed: Number.isFinite(input.previewElapsed) ? Math.max(0, input.previewElapsed) : 0,
      active: true,
      frameDriven: false,
      replayMode: null,
      evaluationLevel: 'kinematic-preview',
      authoritativeBodyTransforms: false,
    };
  }
  return {
    mode: 'idle', elapsed: 0, active: false, frameDriven: false,
    replayMode: null, evaluationLevel: null, authoritativeBodyTransforms: false,
  };
}

export type LocalMotionDof =
  | 'wheel-roll' | 'wheel-steer' | 'steering-control' | 'buffer-gate'
  | 'servo-horn' | 'linear-extension' | 'spring-compression'
  | 'conveyor-surface' | 'roller-spin' | 'shaft-spin' | 'propulsor-spin';

/** Describes motion rendered inside a component's local shape. The outer
 * mechanism graph must not apply the same DOF a second time. Components may
 * still receive a distinct assembly transform (for example, a rolling wheel
 * can inherit a suspension or shared steering-pivot transform). */
export function componentOwnsLocalMotion(component: Pick<MachineComponent, 'primitive' | 'bodyType' | 'parameters'>): LocalMotionDof[] {
  const parameters = component.parameters ?? {};
  const dofs: LocalMotionDof[] = [];
  if (parameters.road_vehicle_wheel || parameters.road_vehicle_brake || parameters.motorcycle_wheel || parameters.bicycle_wheel) dofs.push('wheel-roll');
  if (parameters.road_vehicle_wheel && parameters.road_vehicle_front_steering) dofs.push('wheel-steer');
  if (parameters.road_vehicle_steering_wheel) dofs.push('steering-control');
  if (parameters.buffer_gate) dofs.push('buffer-gate');
  if (component.primitive === 'servo' && !parameters.robot_joint && !parameters.robot_arm_joint) dofs.push('servo-horn');
  if (component.primitive === 'piston') dofs.push('linear-extension');
  if (component.primitive === 'spring') dofs.push('spring-compression');
  if (component.primitive === 'conveyor') dofs.push('conveyor-surface');
  if (component.primitive === 'roller') dofs.push('roller-spin');
  if (component.primitive === 'shaft' && (parameters.operation_spin || (component.bodyType === 'dynamic' && !parameters.solar_pivot_axle))) dofs.push('shaft-spin');
  if (component.primitive === 'propeller' || component.primitive === 'rotor') dofs.push('propulsor-spin');
  return dofs;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const finiteTime = (elapsed: number) => Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;

const finiteSpeedScale = (speedScale: number) => Number.isFinite(speedScale)
  ? Math.min(3, Math.max(0, Math.abs(speedScale)))
  : 1;

const wrappedProgress = (progress: number) => {
  if (!Number.isFinite(progress)) return 0;
  return ((progress % 1) + 1) % 1;
};

const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/**
 * Samples an authored material-flow route without rounding its corners.
 *
 * A previous two-point interpolation cut diagonally through diverters and bin
 * walls. Explicit segments make the visible operation obey the same physical
 * clearances a real line needs: move laterally before the selector, travel
 * above the chute, clear the bin rim, and only then drop into the container.
 */
export function sampleClearancePath(progress: number, points: Vec3[], weights?: number[]): Vec3 {
  if (!points.length) return [0, 0, 0];
  if (points.length === 1) return [...points[0]] as Vec3;
  const segments = points.length - 1;
  const normalizedWeights = weights?.length === segments && weights.every((weight) => weight > 0)
    ? weights
    : Array.from({ length: segments }, () => 1);
  const total = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  let cursor = clamp01(progress) * total;
  for (let index = 0; index < segments; index += 1) {
    const weight = normalizedWeights[index];
    if (cursor <= weight || index === segments - 1) {
      const t = smoothstep(cursor / weight);
      return points[index].map((value, axis) => value + (points[index + 1][axis] - value) * t) as Vec3;
    }
    cursor -= weight;
  }
  return [...points[points.length - 1]] as Vec3;
}

function clearancePathPlanarDistance(progress: number, points: Vec3[], weights?: number[]) {
  if (points.length < 2) return 0;
  const segments = points.length - 1;
  const normalizedWeights = weights?.length === segments && weights.every((weight) => weight > 0)
    ? weights
    : Array.from({ length: segments }, () => 1);
  const total = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  let cursor = clamp01(progress) * total;
  let distance = 0;
  for (let index = 0; index < segments; index += 1) {
    const weight = normalizedWeights[index];
    const segmentDistance = Math.hypot(points[index + 1][0] - points[index][0], points[index + 1][2] - points[index][2]);
    if (cursor <= weight || index === segments - 1) {
      distance += segmentDistance * smoothstep(cursor / weight);
      break;
    }
    distance += segmentDistance;
    cursor -= weight;
  }
  return distance;
}

const tomatoRoute = (lane: number): { points: Vec3[]; weights: number[] } => ({
  points: [
    [-3.25, 1.23, 0],
    [.12, 1.23, 0],
    [.12, 1.28, lane * .42],
    [1.35, 1.31, lane * .46],
    [2.18, 1.18, lane * .88],
    [3.18, 1.12, lane * 1.45],
    [3.18, .66, lane * 1.45],
    [3.18, .66, lane * 1.45],
  ],
  weights: [.34, .07, .13, .16, .13, .1, .07],
});

/** Absolute, radius-aware tomato roll sampled from its authored route. The
 * final vertical drop contributes no artificial spin because only distance in
 * the conveyor plane is accumulated. Non-tomato components remain still. */
export function tomatoRollingAngle(component: Pick<MachineComponent, 'dimensions' | 'parameters'>, progress: number) {
  if (component.parameters.product_form !== 'tomato') return 0;
  const lane = component.parameters.grade === 'ripe' ? -1 : 1;
  const route = tomatoRoute(lane);
  const radius = Math.max(.08, Math.max(component.dimensions[0], component.dimensions[2]) / 2);
  const distance = clearancePathPlanarDistance(wrappedProgress(progress), route.points, route.weights);
  return distance === 0 ? 0 : -distance / radius;
}

export function productOperationPoseAtProgress(component: MachineComponent, progress: number): ProductOperationPose | null {
  const form = String(component.parameters.product_form ?? '');
  if (!form) return null;
  const rotation = [...component.rotation] as Vec3;
  const p = wrappedProgress(progress);

  if (form.startsWith('package-')) {
    const lane = form.endsWith('red') ? -1 : 1;
    return {
      position: sampleClearancePath(p, [
        [-3.15, 1.3, 0],
        [.08, 1.3, 0],
        [.08, 1.34, lane * .55],
        [1.28, 1.34, lane * .58],
        [2.45, 1.28, lane * 1.02],
        [3.65, 1.33, lane * 1.85],
        [3.65, .78, lane * 1.85],
        [3.65, .78, lane * 1.85],
      ], [.34, .07, .12, .17, .14, .1, .06]),
      rotation,
    };
  }

  if (form === 'shipping-carton') {
    const staged = p < .2 ? p * 1.25 : p < .48 ? .25 : p < .68 ? .25 + (p - .48) * 1.25 : .5 + (p - .68) * 1.56;
    return { position: [-3.45 + Math.min(1, staged) * 7, 1.28, 0], rotation };
  }

  if (form === 'tomato') {
    const lane = component.parameters.grade === 'ripe' ? -1 : 1;
    const route = tomatoRoute(lane);
    rotation[2] += tomatoRollingAngle(component, p);
    return {
      position: sampleClearancePath(p, route.points, route.weights),
      rotation,
    };
  }

  if (['metal-can', 'plastic-bottle', 'reject-object'].includes(form)) {
    const routeZ = form === 'metal-can' ? -1.65 : form === 'plastic-bottle' ? 0 : 1.65;
    const routeX = form === 'reject-object' ? 2.05 : 3.45;
    const outletZ = form === 'metal-can' ? -.62 : form === 'plastic-bottle' ? .45 : .82;
    const chuteZ = routeZ * .72;
    rotation[0] += p * Math.PI * (form === 'metal-can' ? 4 : 2.4);
    return {
      position: sampleClearancePath(p, [
        [-3.05, 2.08, 0],
        [-2.2, 1.76, 0],
        [-1.02, 1.62, 0],
        [.72, 1.56, 0],
        [1.28, 1.52, outletZ],
        [routeX - .65, 1.25, chuteZ],
        [routeX, 1.34, routeZ],
        [routeX, .68, routeZ],
        [routeX, .68, routeZ],
      ], [.12, .15, .19, .1, .13, .12, .11, .08]),
      rotation,
    };
  }

  return null;
}

export function productOperationPose(component: MachineComponent, elapsed: number): ProductOperationPose | null {
  const phaseSeed = Number(component.parameters.queue_index ?? component.parameters.operation_index ?? (component.id.length % 5));
  return productOperationPoseAtProgress(component, elapsed * .14 + phaseSeed * .19);
}

export function animatedCableEndpoints(component: MachineComponent, elapsed: number, operating: boolean): { start: Vec3; end: Vec3 } | null {
  const start = [Number(component.parameters.start_x), Number(component.parameters.start_y), Number(component.parameters.start_z)] as Vec3;
  const end = [Number(component.parameters.end_x), Number(component.parameters.end_y), Number(component.parameters.end_z)] as Vec3;
  if (![...start, ...end].every(Number.isFinite)) return null;
  if (!operating) return { start, end };
  const liftWave = .5 - Math.cos(elapsed * 1.45) * .5;
  if (component.parameters.drawbridge_cable === 'deck') {
    const pivotX = Number(component.parameters.drawbridge_pivot_x);
    const pivotY = Number(component.parameters.drawbridge_pivot_y);
    const direction = Number(component.parameters.drawbridge_direction ?? 1);
    const angle = drawbridgeLiftAngle(elapsed, direction);
    const dx = end[0] - pivotX;
    const dy = end[1] - pivotY;
    end[0] = pivotX + dx * Math.cos(angle) - dy * Math.sin(angle);
    end[1] = pivotY + dx * Math.sin(angle) + dy * Math.cos(angle);
  }
  if (component.parameters.drawbridge_cable === 'counterweight') end[1] -= liftWave * .62;
  if (component.parameters.rigging) end[1] += liftWave * Math.max(0, Number(component.parameters.winch_travel_m ?? 1.05));
  if (component.parameters.winch_cable && component.parameters.cable_segment === 'load') end[1] += liftWave * Math.min(1.6, Number(component.parameters.winch_travel_m ?? 1));
  return { start, end };
}

export function translateInForgeCoordinates(position: Vec3, instruction: string, lateralInstruction: string, distance: number): Vec3 {
  const moved = [...position] as Vec3;
  if (/\bleft\b/.test(lateralInstruction)) moved[2] -= distance;
  if (/\bright\b/.test(lateralInstruction)) moved[2] += distance;
  if (/\b(?:up|higher|raise)\b/.test(instruction)) moved[1] += distance;
  if (/\b(?:down|lower)\b/.test(instruction)) moved[1] -= distance;
  if (/\bforward\b/.test(instruction)) moved[0] += distance;
  if (/\b(?:back|backward)\b/.test(instruction)) moved[0] -= distance;
  return moved;
}

export function localPointToWorld(position: Vec3, rotation: Vec3, localPoint: Vec3): Vec3 {
  const point = new Vector3(...localPoint).applyQuaternion(new Quaternion().setFromEuler(new Euler(...rotation, 'XYZ'))).add(new Vector3(...position));
  return [Number(point.x.toFixed(5)), Number(point.y.toFixed(5)), Number(point.z.toFixed(5))];
}

export function worldPointToLocal(position: Vec3, rotation: Vec3, worldPoint: Vec3): Vec3 {
  const inverse = new Quaternion().setFromEuler(new Euler(...rotation, 'XYZ')).invert();
  const point = new Vector3(...worldPoint).sub(new Vector3(...position)).applyQuaternion(inverse);
  return [Number(point.x.toFixed(5)), Number(point.y.toFixed(5)), Number(point.z.toFixed(5))];
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function excursion(elapsed: number, limits: [number, number], rate: number, direction = 1, maximumSpan = Number.POSITIVE_INFINITY) {
  const [minimum, maximum] = limits;
  const start = clamp(0, minimum, maximum);
  const preferred = direction < 0 ? minimum : maximum;
  const alternate = direction < 0 ? maximum : minimum;
  const targetLimit = Math.abs(preferred - start) > 1e-6 ? preferred : alternate;
  const target = start + clamp(targetLimit - start, -maximumSpan, maximumSpan);
  const progress = .5 - .5 * Math.cos(elapsed * clamp(Math.abs(rate), .35, 1.5));
  return start + (target - start) * progress;
}

/**
 * Builds a deterministic visual kinematics graph from the same joints and
 * drives used by the physics world. It deliberately animates only driven
 * revolute/prismatic joints; fixed descendants inherit their parent's rigid
 * transform so assemblies stay connected instead of "shaking apart".
 */
export function createMechanismMotionGraph(components: MachineComponent[], joints: Joint[], motors: Motor[], actuators: Actuator[]): MechanismMotionGraph {
  const byId = new Map(components.map((component) => [component.id, component]));
  const initialRotation = new Map(components.map((component) => [component.id, new Quaternion().setFromEuler(new Euler(...component.rotation, 'XYZ'))]));
  type OrientedJoint = { joint: Joint; parentId: string; parentAnchor: Vec3; childAnchor: Vec3 };
  const parentJoint = new Map<string, OrientedJoint>();
  for (const joint of joints) {
    const endpoint = resolveDrivenJointEndpoint(joint, components);
    if (!endpoint || parentJoint.has(endpoint.driven.id)) continue;
    // Gear/belt constraints couple two rotating bodies; treating either as a
    // rigid child would make the second shaft orbit around the first.
    if (joint.type === 'gear' || joint.type === 'belt') continue;
    const drivenIsB = endpoint.drivenEndpoint === 'B';
    parentJoint.set(endpoint.driven.id, {
      joint,
      parentId: endpoint.support.id,
      parentAnchor: drivenIsB ? joint.anchorA : joint.anchorB,
      childAnchor: drivenIsB ? joint.anchorB : joint.anchorA,
    });
  }

  const drivers = new Map<string, Driver>();
  for (const motor of motors) {
    if (!motor.jointId) continue;
    drivers.set(motor.jointId, {
      angularSpeed: clamp(Math.abs(motor.maxRpm) * Math.PI / 30, .45, 3.2),
      linearSpeed: .7,
      direction: motor.direction < 0 ? -1 : 1,
    });
  }
  for (const actuator of actuators) {
    drivers.set(actuator.jointId, {
      angularSpeed: clamp(Math.abs(actuator.maxSpeed), .45, 1.5),
      linearSpeed: clamp(Math.abs(actuator.maxSpeed), .25, 1.5),
      direction: 1,
    });
  }

  let cachedElapsed = Number.NaN;
  let cache = new Map<string, Transform>();
  const visiting = new Set<string>();

  const solve = (componentId: string, elapsed: number): Transform | null => {
    if (elapsed !== cachedElapsed) { cachedElapsed = elapsed; cache = new Map(); visiting.clear(); }
    const cached = cache.get(componentId);
    if (cached) return cached;
    const component = byId.get(componentId);
    const initial = initialRotation.get(componentId);
    if (!component || !initial) return null;
    const resting: Transform = { position: new Vector3(...component.position), rotation: initial.clone(), animated: false };
    const oriented = parentJoint.get(componentId);
    if (!oriented || visiting.has(componentId)) { cache.set(componentId, resting); return resting; }
    const { joint } = oriented;
    visiting.add(componentId);
    const parent = byId.get(oriented.parentId);
    const parentInitialRotation = initialRotation.get(oriented.parentId);
    const parentPose = solve(oriented.parentId, elapsed);
    if (!parent || !parentInitialRotation || !parentPose) { visiting.delete(componentId); cache.set(componentId, resting); return resting; }

    // Rebuild the authored child orientation from the parent's current pose,
    // then place the two joint anchors on the same world point. Anchor-based
    // placement prevents visual gaps even when a generated body's center is
    // offset from its hinge or slider.
    const rotation = parentPose.rotation.clone().multiply(parentInitialRotation.clone().invert()).multiply(initial);
    const pivot = new Vector3(...oriented.parentAnchor).applyQuaternion(parentPose.rotation).add(parentPose.position.clone());
    const position = pivot.clone().sub(new Vector3(...oriented.childAnchor).applyQuaternion(rotation));
    let animated = parentPose.animated;
    const driver = drivers.get(joint.id);

    if (driver && joint.type === 'revolute') {
      const angle = joint.limits
        ? excursion(elapsed, joint.limits, driver.angularSpeed, driver.direction, Math.PI * .82)
        : elapsed * driver.angularSpeed * driver.direction;
      const axis = new Vector3(...joint.axis).normalize().applyQuaternion(parentPose.rotation);
      const motion = new Quaternion().setFromAxisAngle(axis, angle);
      position.sub(pivot).applyQuaternion(motion).add(pivot);
      rotation.premultiply(motion);
      animated = true;
    } else if (driver && joint.type === 'prismatic' && joint.limits) {
      const distance = excursion(elapsed, joint.limits, driver.linearSpeed, driver.direction);
      const axis = new Vector3(...joint.axis).normalize().applyQuaternion(parentPose.rotation);
      position.addScaledVector(axis, distance);
      animated = true;
    }

    const solved = { position, rotation, animated };
    visiting.delete(componentId);
    cache.set(componentId, solved);
    return solved;
  };

  return {
    poseAt(componentId, elapsed) {
      const solved = solve(componentId, elapsed);
      if (!solved) return null;
      const euler = new Euler().setFromQuaternion(solved.rotation, 'XYZ');
      return {
        position: [solved.position.x, solved.position.y, solved.position.z],
        rotation: [euler.x, euler.y, euler.z],
        animated: solved.animated,
      };
    },
  };
}

export function roadVehicleSteeringCycle(elapsed: number) {
  return Math.sin(elapsed * STEERING_RATE);
}

export function ackermannSteeringAngles(cycle: number, wheelbase = 1.7, track = 1.38, maximum = .36) {
  const centerAngle = cycle * maximum;
  if (Math.abs(centerAngle) < 1e-6) return { left: 0, right: 0 };
  const radius = wheelbase / Math.tan(Math.abs(centerAngle));
  const inner = Math.atan(wheelbase / Math.max(.12, radius - track / 2));
  const outer = Math.atan(wheelbase / (radius + track / 2));
  const sign = Math.sign(centerAngle);
  return centerAngle > 0 ? { left: sign * inner, right: sign * outer } : { left: sign * outer, right: sign * inner };
}

export function roadVehicleWheelYaw(elapsed: number, role: string, frontSteering = false, side?: string, wheelbase = 1.7, track = 1.38) {
  if (!frontSteering && !/\bfront\b/i.test(role)) return 0;
  const cycle = roadVehicleSteeringCycle(elapsed);
  const steeringSide = side?.trim() || (/\bleft\b/i.test(role) ? 'left' : /\bright\b/i.test(role) ? 'right' : 'center');
  const angles = ackermannSteeringAngles(cycle, wheelbase, track);
  return steeringSide === 'left' ? angles.left : steeringSide === 'right' ? angles.right : cycle * .36;
}

export function roadVehicleWheelRoll(elapsed: number) {
  // The go-kart faces +X with wheel axles along Z. Negative Z rotation is
  // therefore the forward-rolling direction at the tire contact patch.
  return -elapsed * 4.6;
}

/** A radius-aware wheel angle keeps different tire sizes moving at the same
 * visible ground speed instead of making large rover tires whirl like casters. */
export function rollingWheelAngle(elapsed: number, radius: number, linearSpeed = 1.55) {
  return -elapsed * linearSpeed / Math.max(.12, Math.abs(radius));
}

/** Independent terrain inputs are centered around the authored ride height.
 * Opposite corners are phase shifted so a rover reads as articulating over
 * terrain, not as four wheels bobbing together or floating upward. */
export function terrainWheelTravel(elapsed: number, index: number, amplitude = .075) {
  const phase = [0, Math.PI * .82, Math.PI * 1.43, Math.PI * 2.17][Math.abs(index) % 4];
  return Math.sin(elapsed * 1.18 + phase) * amplitude;
}

export type RoverSpringMotion = {
  wheelTravel: number;
  centerTravel: number;
  compression: number;
  scaleY: number;
};

/** Couples a rover spring to the terrain input at its existing operation
 * index. Translating its center by half the wheel travel while scaling about
 * that center keeps the chassis end fixed and the upright end attached. */
export function roverSpringMotion(component: Pick<MachineComponent, 'dimensions' | 'parameters'>, elapsed: number): RoverSpringMotion {
  if (!component.parameters.rover_suspension_spring) return { wheelTravel: 0, centerTravel: 0, compression: 0, scaleY: 1 };
  const rawIndex = Number(component.parameters.operation_index ?? 0);
  const index = Number.isFinite(rawIndex) ? Math.floor(rawIndex) : 0;
  const rawAmplitude = Number(component.parameters.operation_travel_m ?? .075);
  const amplitude = Number.isFinite(rawAmplitude) ? Math.min(.18, Math.max(0, Math.abs(rawAmplitude))) : .075;
  const wheelTravel = terrainWheelTravel(finiteTime(elapsed), index, amplitude);
  const springLength = Math.max(.2, Math.abs(component.dimensions[1]));
  return {
    wheelTravel,
    centerTravel: wheelTravel * .5,
    compression: wheelTravel,
    scaleY: Math.min(1.28, Math.max(.72, 1 - wheelTravel / springLength)),
  };
}

export function motorcycleSteeringAngle(elapsed: number) {
  return Math.sin(elapsed * .72) * .19;
}

/** Rotate a component around a shared world-space pivot. This is used for
 * steering forks and other assemblies whose children must remain connected. */
export function rotatePoseAroundPivot(position: Vec3, rotation: Vec3, pivot: Vec3, axis: Vec3, angle: number): ProductOperationPose {
  const unitAxis = new Vector3(...axis).normalize();
  const motion = new Quaternion().setFromAxisAngle(unitAxis, angle);
  const moved = new Vector3(...position).sub(new Vector3(...pivot)).applyQuaternion(motion).add(new Vector3(...pivot));
  const orientation = motion.multiply(new Quaternion().setFromEuler(new Euler(...rotation, 'XYZ')));
  const euler = new Euler().setFromQuaternion(orientation, 'XYZ');
  return { position: [moved.x, moved.y, moved.z], rotation: [euler.x, euler.y, euler.z] };
}

export function aircraftControlSurfaceAngle(elapsed: number, controlAxis: string, side = '') {
  const command = Math.sin(elapsed * .78);
  if (controlAxis === 'roll') return command * (side === 'left' ? .18 : -.18);
  if (controlAxis === 'yaw') return command * .14;
  return Math.sin(elapsed * .62 + .6) * .14;
}

/** A takeoff would require aerodynamics that this concept sandbox does not
 * claim. The rotorcraft preview therefore performs a stable ground-effect
 * hover check: smooth lift, a short hover, and a smooth return to the skids. */
export function rotorcraftHoverOffset(elapsed: number) {
  return (.5 - .5 * Math.cos(elapsed * .58)) * .32;
}

export type PropulsorVisualMotion = { axis: 'y' | 'z'; angle: number; radiansPerSecond: number };

/** Return one—and only one—visual rotation for a powered propulsor. Forward
 * and tail propellers spin around local Z (their component transform maps it
 * to the authored shaft); vertical lift rotors spin around local Y. */
export function propulsorVisualMotion(component: Pick<MachineComponent, 'primitive' | 'role' | 'parameters'>, elapsed: number, speedScale = 1): PropulsorVisualMotion {
  const declared = String(component.parameters.rotor_axis ?? '').toLowerCase();
  const vertical = declared === 'vertical' || declared === 'up' || (component.primitive === 'rotor' && !['forward', 'tail', 'horizontal'].includes(declared));
  const base = component.parameters.main_rotor ? 4.8 : component.parameters.tail_rotor ? 8.6 : /aircraft propeller/i.test(component.role) ? 7.4 : 4.2;
  const radiansPerSecond = base * Math.max(.35, Math.min(3, Math.abs(speedScale)));
  const direction = component.parameters.tail_rotor ? -1 : 1;
  return { axis: vertical ? 'y' : 'z', angle: elapsed * radiansPerSecond * direction, radiansPerSecond };
}

/** Convert the local blade-spin axis used by PropulsorBody into the authored
 * world frame. This makes render orientation directly comparable with the
 * revolute-joint axis and catches a propeller that looks correct in metadata
 * but spins across the wrong visual plane after component rotation. */
export function propulsorWorldAxis(component: Pick<MachineComponent, 'primitive' | 'role' | 'parameters' | 'rotation'>): Vec3 {
  const localAxis = propulsorVisualMotion(component, 0).axis === 'y'
    ? new Vector3(0, 1, 0)
    : new Vector3(0, 0, 1);
  localAxis.applyQuaternion(new Quaternion().setFromEuler(new Euler(...component.rotation, 'XYZ'))).normalize();
  return [localAxis.x, localAxis.y, localAxis.z];
}

export function roadVehicleDriveDirection(direction: number) {
  return direction === 0 ? 0 : -Math.abs(direction);
}

export function roadVehicleSteeringWheelTurn(elapsed: number) {
  return roadVehicleSteeringCycle(elapsed) * 0.72;
}

export function roadVehicleRackTravel(elapsed: number) {
  return roadVehicleSteeringCycle(elapsed) * 0.055;
}

export function drawbridgeLiftAngle(elapsed: number, direction = 1) {
  const liftWave = .5 - Math.cos(elapsed * 1.45) * .5;
  return (direction < 0 ? -1 : 1) * liftWave * .96;
}

/**
 * Returns a smooth 0..1 drive command for one zero-pressure accumulation
 * zone. Only one zone is released at a time, matching the state-machine
 * control rule instead of making every roller bank spin continuously.
 */
export function accumulationZoneActivity(elapsed: number, zoneIndex: number) {
  const normalizedIndex = Math.max(0, Math.min(ACCUMULATION_ZONE_COUNT - 1, Math.floor(zoneIndex)));
  const phase = ((elapsed / ACCUMULATION_ZONE_SECONDS) % ACCUMULATION_ZONE_COUNT + ACCUMULATION_ZONE_COUNT) % ACCUMULATION_ZONE_COUNT;
  const local = (phase - normalizedIndex + ACCUMULATION_ZONE_COUNT) % ACCUMULATION_ZONE_COUNT;
  if (local >= ACCUMULATION_ACTIVE_PHASE) return 0;
  return Math.sin(Math.PI * local / ACCUMULATION_ACTIVE_PHASE) ** 2;
}

/** Absolute roller angle for a zero-pressure accumulation zone. This is the
 * analytic integral of `accumulationZoneActivity`, so a paused zone holds its
 * last angle and replay scrubbing never depends on previously rendered frames. */
export function accumulationZoneRollerAngle(elapsed: number, zoneIndex: number, speedScale = 1) {
  const time = finiteTime(elapsed);
  const normalizedIndex = Number.isFinite(zoneIndex)
    ? Math.max(0, Math.min(ACCUMULATION_ZONE_COUNT - 1, Math.floor(zoneIndex)))
    : 0;
  const firstStart = normalizedIndex * ACCUMULATION_ZONE_SECONDS;
  if (time <= firstStart) return 0;
  const period = ACCUMULATION_ZONE_SECONDS * ACCUMULATION_ZONE_COUNT;
  const activeDuration = ACCUMULATION_ZONE_SECONDS * ACCUMULATION_ACTIVE_PHASE;
  const shifted = time - firstStart;
  const fullCycles = Math.floor(shifted / period);
  const remainder = shifted - fullCycles * period;
  const activeTime = Math.min(remainder, activeDuration);
  const partialIntegral = activeTime <= 0
    ? 0
    : activeTime / 2 - activeDuration / (4 * Math.PI) * Math.sin(2 * Math.PI * activeTime / activeDuration);
  const activityIntegral = fullCycles * activeDuration / 2 + partialIntegral;
  if (activityIntegral === 0) return 0;
  return -activityIntegral * ACCUMULATION_ROLLER_RADIANS_PER_SECOND * finiteSpeedScale(speedScale);
}

/** Normalized surface travel for the flagged magnetic takeaway belt. The
 * renderer can wrap each marker with this 0..1 phase at any replay timestamp. */
export function recyclingBeltSurfaceOffset(component: Pick<MachineComponent, 'parameters'>, elapsed: number, speedScale = 1) {
  if (!component.parameters.magnetic_belt) return 0;
  const rawRate = Number(component.parameters.belt_cycles_per_second ?? RECYCLING_BELT_CYCLES_PER_SECOND);
  const rate = Number.isFinite(rawRate) ? Math.max(0, Math.abs(rawRate)) : RECYCLING_BELT_CYCLES_PER_SECOND;
  const cycles = finiteTime(elapsed) * rate * finiteSpeedScale(speedScale);
  return cycles - Math.floor(cycles);
}

/** Absolute local impeller angle for the flagged recycling air classifier.
 * The motor housing remains fixed; only its internal rotor should use this. */
export function recyclingBlowerAngle(component: Pick<MachineComponent, 'parameters'>, elapsed: number, speedScale = 1) {
  if (!component.parameters.classifier_blower) return 0;
  const rawRate = Number(component.parameters.operation_spin ?? RECYCLING_BLOWER_RADIANS_PER_SECOND);
  const rate = Number.isFinite(rawRate) ? Math.abs(rawRate) : RECYCLING_BLOWER_RADIANS_PER_SECOND;
  return finiteTime(elapsed) * rate * finiteSpeedScale(speedScale);
}
