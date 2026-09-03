import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { accumulationZoneActivity, ackermannSteeringAngles, aircraftControlSurfaceAngle, animatedCableEndpoints, createMechanismMotionGraph, drawbridgeLiftAngle, motorcycleSteeringAngle, productOperationPoseAtProgress, propulsorVisualMotion, roadVehicleDriveDirection, roadVehicleRackTravel, roadVehicleSteeringWheelTurn, roadVehicleWheelRoll, roadVehicleWheelYaw, rollingWheelAngle, rotatePoseAroundPivot, rotorcraftHoverOffset, sampleClearancePath, terrainWheelTravel, translateInForgeCoordinates } from './forge-motion';
import type { Joint, MachineComponent, Motor } from './forge-types';

function body(id: string, position: [number, number, number], bodyType: 'fixed' | 'dynamic' = 'dynamic'): MachineComponent {
  return { id, primitive: 'beam', name: id, assemblyId: 'test', role: id, shape: 'box', position, rotation: [0, 0, 0], dimensions: [1, .2, .2], materialId: 'steel', mass: 1, bodyType, color: '#fff', parameters: { nominal_x: position[0] }, lastModifiedBy: 'ModelAgent', humanLockedFields: [] };
}

const motor = (jointId: string): Motor => ({ id: `motor-${jointId}`, componentId: 'base', jointId, maxTorque: 20, maxRpm: 30, direction: 1 });

function product(form: string, dimensions: [number, number, number], parameters: Record<string, string | number> = {}): MachineComponent {
  return { ...body(form, [0, 0, 0]), primitive: 'container', dimensions, parameters: { product_form: form, ...parameters } };
}

function intersectsExpandedBox(position: [number, number, number], center: [number, number, number], dimensions: [number, number, number], clearance: [number, number, number]) {
  return position.every((value, axis) => Math.abs(value - center[axis]) < dimensions[axis] / 2 + clearance[axis]);
}

describe('collision-safe material-flow animation', () => {
  it('follows explicit segments instead of cutting across waypoint corners', () => {
    const position = sampleClearancePath(.5, [[0, 0, 0], [0, 0, 1], [1, 0, 1]], [.5, .5]);
    expect(position).toEqual([0, 0, 1]);
  });

  it('routes every tomato around the selector before entering the correct open bin', () => {
    for (const grade of ['ripe', 'unripe', 'damaged']) {
      const tomato = product('tomato', [.43, .43, .43], { grade });
      const lane = grade === 'ripe' ? -1 : 1;
      for (let step = 0; step <= 200; step += 1) {
        const pose = productOperationPoseAtProgress(tomato, step / 200)!;
        expect(intersectsExpandedBox(pose.position, [1.35, 1.05, 0], [1.3, .3, .28], [.215, .215, .215])).toBe(false);
      }
      const aboveRim = productOperationPoseAtProgress(tomato, .83)!.position;
      expect(aboveRim[1]).toBeGreaterThan(1.08);
      const collected = productOperationPoseAtProgress(tomato, .999)!.position;
      expect(collected[0]).toBeCloseTo(3.18, 2);
      expect(collected[2]).toBeCloseTo(lane * 1.45, 2);
      expect(collected[1]).toBeGreaterThan(.3);
      expect(collected[1]).toBeLessThan(.87);
    }
  });

  it('keeps sorter cartons outside the diverter and drops them inside—not through—the bin walls', () => {
    for (const form of ['package-red', 'package-blue']) {
      const carton = product(form, [.68, .56, .62]);
      const lane = form === 'package-red' ? -1 : 1;
      for (let step = 0; step <= 200; step += 1) {
        const pose = productOperationPoseAtProgress(carton, step / 200)!;
        expect(intersectsExpandedBox(pose.position, [1.15, 1.1, 0], [1.35, .34, .28], [.34, .28, .31])).toBe(false);
      }
      const collected = productOperationPoseAtProgress(carton, .999)!.position;
      expect(collected[0]).toBeCloseTo(3.65, 2);
      expect(collected[2]).toBeCloseTo(lane * 1.85, 2);
      expect(collected[1]).toBeGreaterThan(.31);
      expect(collected[1]).toBeLessThan(.97);
    }
  });

  it('gives every free showcase product a finite, bounded route', () => {
    const products = [
      product('tomato', [.4, .4, .4], { grade: 'ripe' }),
      product('package-red', [.68, .56, .62]),
      product('package-blue', [.68, .56, .62]),
      product('shipping-carton', [.7, .52, .68]),
      product('metal-can', [.46, .66, .46]),
      product('plastic-bottle', [.4, .72, .4]),
      product('reject-object', [.5, .52, .5]),
    ];
    for (const item of products) for (let step = 0; step <= 100; step += 1) {
      const pose = productOperationPoseAtProgress(item, step / 100)!;
      expect(pose.position.every(Number.isFinite)).toBe(true);
      expect(Math.abs(pose.position[0])).toBeLessThan(5);
      expect(pose.position[1]).toBeGreaterThanOrEqual(.3);
      expect(pose.position[1]).toBeLessThan(2.5);
      expect(Math.abs(pose.position[2])).toBeLessThan(2.5);
    }
  });
});

describe('road vehicle operation motion', () => {
  it('computes a larger inside-wheel angle with Ackermann geometry', () => {
    const left = ackermannSteeringAngles(1, 1.7, 1.38);
    const right = ackermannSteeringAngles(-1, 1.7, 1.38);
    expect(left.left).toBeGreaterThan(left.right);
    expect(Math.abs(right.right)).toBeGreaterThan(Math.abs(right.left));
  });
  it('uses +X forward and negative Z left for natural-language moves', () => {
    expect(translateInForgeCoordinates([.85, .5, -.8], 'move the wheel right', ' right', .2)[2]).toBeCloseTo(-.6, 6);
    expect(translateInForgeCoordinates([.85, .5, -.8], 'move the wheel left', ' left', .2)[2]).toBeCloseTo(-1, 6);
    expect(translateInForgeCoordinates([.85, .5, -.8], 'move the wheel forward', ' forward', .2)[0]).toBeCloseTo(1.05, 6);
  });

  it('rolls road wheels in the forward +X direction', () => {
    expect(roadVehicleWheelRoll(1)).toBeLessThan(0);
    expect(roadVehicleWheelRoll(2)).toBeLessThan(roadVehicleWheelRoll(1));
    expect(roadVehicleDriveDirection(1)).toBe(-1);
    expect(roadVehicleDriveDirection(-1)).toBe(-1);
    expect(roadVehicleDriveDirection(0)).toBe(0);
  });

  it('steers both front wheels left and right while rear wheels stay straight', () => {
    const leftPhase = Math.PI / (2 * 0.82);
    const rightPhase = Math.PI * 3 / (2 * 0.82);
    expect(roadVehicleWheelYaw(leftPhase, 'front left steering wheel', true, 'left')).toBeGreaterThan(0);
    expect(roadVehicleWheelYaw(leftPhase, 'front right steering wheel', true, 'right')).toBeGreaterThan(0);
    expect(roadVehicleWheelYaw(rightPhase, 'front left steering wheel', true, 'left')).toBeLessThan(0);
    expect(roadVehicleWheelYaw(rightPhase, 'front right steering wheel', true, 'right')).toBeLessThan(0);
    expect(roadVehicleWheelYaw(leftPhase, 'rear left drive wheel')).toBe(0);
  });

  it('keeps steering wheel and rack synchronized with the wheel yaw cycle', () => {
    const phase = Math.PI / (2 * 0.82);
    expect(roadVehicleSteeringWheelTurn(phase)).toBeGreaterThan(0);
    expect(roadVehicleRackTravel(phase)).toBeGreaterThan(0);
  });

  it('uses tire radius to keep rover, kart, and motorcycle ground speed consistent', () => {
    const elapsed = 1.75;
    const linearSpeed = 1.4;
    for (const radius of [.29, .4, .51]) expect(Math.abs(rollingWheelAngle(elapsed, radius, linearSpeed) * radius / elapsed)).toBeCloseTo(linearSpeed, 6);
  });

  it('articulates terrain wheels independently around—not above—the authored ride height', () => {
    const samples = [0, 1, 2, 3].map((index) => terrainWheelTravel(1.2, index));
    expect(new Set(samples.map((value) => value.toFixed(4))).size).toBeGreaterThan(2);
    expect(samples.every((value) => Math.abs(value) <= .075 + 1e-9)).toBe(true);
    expect(terrainWheelTravel(0, 0)).toBeCloseTo(0, 8);
  });

  it('steers a motorcycle fork and front wheel around one shared head pivot', () => {
    const pivot: [number, number, number] = [.72, 1.55, 0];
    const angle = motorcycleSteeringAngle(1.8);
    const fork = rotatePoseAroundPivot([.95, 1.1, -.11], [0, 0, 0], pivot, [0, 1, 0], angle);
    const wheel = rotatePoseAroundPivot([1.18, .62, 0], [0, 0, 0], pivot, [0, 1, 0], angle);
    const initialDistance = Math.hypot(.95 - 1.18, 1.1 - .62, -.11);
    const movedDistance = Math.hypot(...fork.position.map((value, axis) => value - wheel.position[axis]));
    expect(movedDistance).toBeCloseTo(initialDistance, 6);
    expect(fork.rotation[1]).toBeCloseTo(wheel.rotation[1], 6);
  });
});

describe('aircraft and rotorcraft operation motion', () => {
  it('moves paired ailerons in opposite directions and keeps elevator travel bounded', () => {
    const left = aircraftControlSurfaceAngle(1.7, 'roll', 'left');
    const right = aircraftControlSurfaceAngle(1.7, 'roll', 'right');
    expect(left).toBeCloseTo(-right, 8);
    expect(Math.abs(aircraftControlSurfaceAngle(8.2, 'pitch'))).toBeLessThanOrEqual(.14);
  });

  it('keeps the helicopter hover smooth, positive, and close to the ground', () => {
    expect(rotorcraftHoverOffset(0)).toBe(0);
    for (let time = 0; time <= 12; time += .1) expect(rotorcraftHoverOffset(time)).toBeGreaterThanOrEqual(0);
    expect(rotorcraftHoverOffset(Math.PI / .58)).toBeCloseTo(.32, 6);
  });

  it('uses one correct spin axis for airplane, main-rotor, and tail-rotor blades', () => {
    const airplane = { ...body('aircraft propeller', [0, 0, 0]), primitive: 'propeller' as const, role: 'three-blade aircraft propeller', parameters: { rotor_axis: 'forward' } };
    const main = { ...body('main rotor', [0, 0, 0]), primitive: 'rotor' as const, role: 'four-blade main lift rotor', parameters: { rotor_axis: 'vertical', main_rotor: true } };
    const tail = { ...body('tail rotor', [0, 0, 0]), primitive: 'propeller' as const, role: 'anti-torque tail rotor', parameters: { rotor_axis: 'tail', tail_rotor: true } };
    expect(propulsorVisualMotion(airplane, 1, 1)).toMatchObject({ axis: 'z', angle: 7.4 });
    expect(propulsorVisualMotion(main, 1, 1)).toMatchObject({ axis: 'y', angle: 4.8 });
    expect(propulsorVisualMotion(tail, 1, 1)).toMatchObject({ axis: 'z', angle: -8.6 });
  });
});

describe('cable operation motion', () => {
  it('keeps the crane cable top fixed while its lower termination follows the lifted hook', () => {
    const cable = { ...body('load-cable', [2, 3, 0]), primitive: 'cable' as const, parameters: { start_x: 2, start_y: 5, start_z: 0, end_x: 2, end_y: 1.5, end_z: 0, rigging: true } };
    const start = animatedCableEndpoints(cable, 0, true)!;
    const lifted = animatedCableEndpoints(cable, Math.PI / 1.45, true)!;
    expect(lifted.start).toEqual(start.start);
    expect(lifted.end[1] - start.end[1]).toBeCloseTo(1.05, 6);
    expect(lifted.end[1]).toBeLessThan(lifted.start[1]);
  });

  it('keeps the tower end fixed while the drawbridge cable follows the rising leaf', () => {
    const cable = { ...body('bridge-cable', [0, 2, 0]), primitive: 'cable' as const, parameters: { start_x: -2.5, start_y: 3, start_z: 0, end_x: 1, end_y: 1.4, end_z: 0, drawbridge_cable: 'deck', drawbridge_pivot_x: -2, drawbridge_pivot_y: 1.2, drawbridge_direction: 1 } };
    const closed = animatedCableEndpoints(cable, 0, true)!;
    const open = animatedCableEndpoints(cable, Math.PI / 1.45, true)!;
    expect(open.start).toEqual(closed.start);
    expect(open.end[1]).toBeGreaterThan(closed.end[1] + 2);
    expect(drawbridgeLiftAngle(Math.PI / 1.45, 1)).toBeGreaterThan(0);
    expect(drawbridgeLiftAngle(Math.PI / 1.45, -1)).toBeLessThan(0);
  });
});

describe('zero-pressure accumulation motion', () => {
  it('drives only one roller zone at a time and advances through all four zones', () => {
    const samples = [0.58, 2.03, 3.48, 4.93];
    samples.forEach((elapsed, expectedZone) => {
      const commands = [0, 1, 2, 3].map((zone) => accumulationZoneActivity(elapsed, zone));
      expect(commands[expectedZone]).toBeGreaterThan(.8);
      expect(commands.filter((command) => command > .01)).toHaveLength(1);
    });
  });
});

describe('joint-authored operation motion', () => {
  it('rotates a continuous driven joint around its anchor without separating it', () => {
    const components = [body('base', [0, 0, 0], 'fixed'), body('arm', [1, 0, 0])];
    const joints: Joint[] = [{ id: 'pivot', type: 'revolute', componentA: 'base', componentB: 'arm', anchorA: [0, 0, 0], anchorB: [-1, 0, 0], axis: [0, 0, 1] }];
    const pose = createMechanismMotionGraph(components, joints, [motor('pivot')], []).poseAt('arm', .5)!;
    const anchor = new Vector3(-1, 0, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(...pose.rotation, 'XYZ'))).add(new Vector3(...pose.position));
    expect(pose.animated).toBe(true);
    expect(anchor.length()).toBeLessThan(1e-6);
    expect(Math.abs(pose.rotation[2])).toBeGreaterThan(.1);
  });

  it('moves bounded prismatic joints only along their axis and carries fixed descendants', () => {
    const components = [body('base', [0, 0, 0], 'fixed'), body('carriage', [0, 1, 0]), body('tool', [.4, 1, 0])];
    const joints: Joint[] = [
      { id: 'slide', type: 'prismatic', componentA: 'base', componentB: 'carriage', anchorA: [0, 1, 0], anchorB: [0, 0, 0], axis: [0, 1, 0], limits: [0, .8] },
      { id: 'tool-mount', type: 'fixed', componentA: 'carriage', componentB: 'tool', anchorA: [.4, 0, 0], anchorB: [0, 0, 0], axis: [1, 0, 0] },
    ];
    const graph = createMechanismMotionGraph(components, joints, [], [{ id: 'slide-drive', componentId: 'base', jointId: 'slide', type: 'linear', maxForce: 10, maxSpeed: 1, travel: .8 }]);
    const carriage = graph.poseAt('carriage', Math.PI)!;
    const tool = graph.poseAt('tool', Math.PI)!;
    expect(carriage.position[0]).toBeCloseTo(0, 6);
    expect(carriage.position[2]).toBeCloseTo(0, 6);
    expect(carriage.position[1]).toBeGreaterThan(1.2);
    expect(tool.position[0] - carriage.position[0]).toBeCloseTo(.4, 6);
    expect(tool.position[1] - carriage.position[1]).toBeCloseTo(0, 6);
    expect(tool.animated).toBe(true);
  });

  it('eases a bounded revolute joint inside its limits while preserving the hinge point', () => {
    const components = [body('base', [0, 0, 0], 'fixed'), body('door', [1, 0, 0])];
    const joints: Joint[] = [{ id: 'hinge', type: 'revolute', componentA: 'base', componentB: 'door', anchorA: [0, 0, 0], anchorB: [-1, 0, 0], axis: [0, 1, 0], limits: [0, .7] }];
    const pose = createMechanismMotionGraph(components, joints, [motor('hinge')], []).poseAt('door', Math.PI)!;
    const orientation = new Quaternion().setFromEuler(new Euler(...pose.rotation, 'XYZ'));
    const hinge = new Vector3(-1, 0, 0).applyQuaternion(orientation).add(new Vector3(...pose.position));
    expect(hinge.length()).toBeLessThan(1e-6);
    expect(pose.rotation[1]).toBeGreaterThan(0);
    expect(pose.rotation[1]).toBeLessThanOrEqual(.7);
  });
});
