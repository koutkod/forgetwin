import { Euler, Quaternion, Vector3 } from 'three';
import type { Actuator, Joint, MachineComponent, Motor, Vec3 } from './forge-types';

const STEERING_RATE = 0.82;
const ACCUMULATION_ZONE_SECONDS = 1.45;
const ACCUMULATION_ZONE_COUNT = 4;

export type MechanismOperationPose = { position: Vec3; rotation: Vec3; animated: boolean };

export type ProductOperationPose = { position: Vec3; rotation: Vec3 };

type Driver = { angularSpeed: number; linearSpeed: number; direction: number };
type Transform = { position: Vector3; rotation: Quaternion; animated: boolean };

export type MechanismMotionGraph = {
  poseAt(componentId: string, elapsed: number): MechanismOperationPose | null;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

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

export function productOperationPoseAtProgress(component: MachineComponent, progress: number): ProductOperationPose | null {
  const form = String(component.parameters.product_form ?? '');
  if (!form) return null;
  const rotation = [...component.rotation] as Vec3;
  const p = ((progress % 1) + 1) % 1;

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
    return {
      position: sampleClearancePath(p, [
        [-3.25, 1.23, 0],
        [.12, 1.23, 0],
        [.12, 1.28, lane * .42],
        [1.35, 1.31, lane * .46],
        [2.18, 1.18, lane * .88],
        [3.18, 1.12, lane * 1.45],
        [3.18, .66, lane * 1.45],
        [3.18, .66, lane * 1.45],
      ], [.34, .07, .13, .16, .13, .1, .07]),
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
  if (component.parameters.rigging) end[1] += liftWave * 1.05;
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
  const parentJoint = new Map<string, Joint>();
  for (const joint of joints) {
    if (!byId.has(joint.componentA) || !byId.has(joint.componentB) || parentJoint.has(joint.componentB)) continue;
    // Gear/belt constraints couple two rotating bodies; treating either as a
    // rigid child would make the second shaft orbit around the first.
    if (joint.type === 'gear' || joint.type === 'belt') continue;
    parentJoint.set(joint.componentB, joint);
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
    const joint = parentJoint.get(componentId);
    if (!joint || visiting.has(componentId)) { cache.set(componentId, resting); return resting; }
    visiting.add(componentId);
    const parent = byId.get(joint.componentA);
    const parentInitialRotation = initialRotation.get(joint.componentA);
    const parentPose = solve(joint.componentA, elapsed);
    if (!parent || !parentInitialRotation || !parentPose) { visiting.delete(componentId); cache.set(componentId, resting); return resting; }

    // Rebuild the authored child orientation from the parent's current pose,
    // then place the two joint anchors on the same world point. Anchor-based
    // placement prevents visual gaps even when a generated body's center is
    // offset from its hinge or slider.
    const rotation = parentPose.rotation.clone().multiply(parentInitialRotation.clone().invert()).multiply(initial);
    const pivot = new Vector3(...joint.anchorA).applyQuaternion(parentPose.rotation).add(parentPose.position.clone());
    const position = pivot.clone().sub(new Vector3(...joint.anchorB).applyQuaternion(rotation));
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
  if (local >= .82) return 0;
  return Math.sin(Math.PI * local / .82) ** 2;
}
