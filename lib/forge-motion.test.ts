import { describe, expect, it } from 'vitest';
import { roadVehicleDriveDirection, roadVehicleRackTravel, roadVehicleSteeringWheelTurn, roadVehicleWheelRoll, roadVehicleWheelYaw } from './forge-motion';

describe('road vehicle operation motion', () => {
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
