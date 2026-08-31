import { Euler, Quaternion, Vector3 } from 'three';
import type { Actuator, Joint, MachineComponent, Motor, Vec3 } from './forge-types';

const STEERING_RATE = 0.82;
const ACCUMULATION_ZONE_SECONDS = 1.45;
const ACCUMULATION_ZONE_COUNT = 4;

export type MechanismOperationPose = { position: Vec3; rotation: Vec3; animated: boolean };

type Driver = { angularSpeed: number; linearSpeed: number; direction: number };
type Transform = { position: Vector3; rotation: Quaternion; animated: boolean };

export type MechanismMotionGraph = {
  poseAt(componentId: string, elapsed: number): MechanismOperationPose | null;
};

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

export function roadVehicleWheelYaw(elapsed: number, role: string, frontSteering = false, side?: string) {
  if (!frontSteering && !/\bfront\b/i.test(role)) return 0;
  const cycle = roadVehicleSteeringCycle(elapsed);
  const steeringSide = side?.trim() || (/\bleft\b/i.test(role) ? 'left' : /\bright\b/i.test(role) ? 'right' : 'center');
  // Positive yaw turns the +X vehicle heading toward its left side (-Z).
  // The inside tire receives a little more angle to suggest Ackermann geometry.
  const inside = (cycle >= 0 && steeringSide === 'left') || (cycle < 0 && steeringSide === 'right');
  return cycle * 0.36 * (inside ? 1.12 : 0.92);
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
