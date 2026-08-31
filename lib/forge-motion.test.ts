import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { accumulationZoneActivity, animatedCableEndpoints, createMechanismMotionGraph, drawbridgeLiftAngle, roadVehicleDriveDirection, roadVehicleRackTravel, roadVehicleSteeringWheelTurn, roadVehicleWheelRoll, roadVehicleWheelYaw, translateInForgeCoordinates } from './forge-motion';
import type { Joint, MachineComponent, Motor } from './forge-types';

function body(id: string, position: [number, number, number], bodyType: 'fixed' | 'dynamic' = 'dynamic'): MachineComponent {
  return { id, primitive: 'beam', name: id, assemblyId: 'test', role: id, shape: 'box', position, rotation: [0, 0, 0], dimensions: [1, .2, .2], materialId: 'steel', mass: 1, bodyType, color: '#fff', parameters: { nominal_x: position[0] }, lastModifiedBy: 'ModelAgent', humanLockedFields: [] };
}

const motor = (jointId: string): Motor => ({ id: `motor-${jointId}`, componentId: 'base', jointId, maxTorque: 20, maxRpm: 30, direction: 1 });

describe('road vehicle operation motion', () => {
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
