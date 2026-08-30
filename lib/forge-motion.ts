const STEERING_RATE = 0.82;

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

export function roadVehicleSteeringWheelTurn(elapsed: number) {
  return roadVehicleSteeringCycle(elapsed) * 0.72;
}

export function roadVehicleRackTravel(elapsed: number) {
  return roadVehicleSteeringCycle(elapsed) * 0.055;
}
