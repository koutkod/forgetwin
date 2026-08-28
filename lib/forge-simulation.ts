import { componentCatalog } from './forge-data';
import type { CollisionEvent, FailureEvent, ForgeState, ReplayBox, ReplayFrame, SimulationRun, TelemetrySample, Vec3 } from './forge-types';

const COLORS = ['red', 'blue', 'blue', 'red', 'red', 'blue', 'red', 'blue', 'blue', 'red'] as const;
const DT = 1 / 60;
const DURATION = 18;
const SPAWN_INTERVAL = 1.45;
const DIVERTER_X = 1.2;
const SERVO_TARGET = 0.54;
const SERVO_SPEED = 4.32;
const SERVO_SETTLE_MS = 125;
const SAFETY_LEAD_MS = 80;
const REQUIRED_CATALOG_IDS = ['conveyor', 'color-sensor', 'servo-diverter', 'ramp-red', 'ramp-blue', 'bin-red', 'bin-blue'] as const;

type BoxRecord = {
  id: string;
  color: 'red' | 'blue';
  body: { translation(): { x: number; y: number; z: number }; rotation(): { x: number; y: number; z: number; w: number }; linvel(): { x: number; y: number; z: number }; setLinvel(velocity: { x: number; y: number; z: number }, wake: boolean): void; setAngvel(velocity: { x: number; y: number; z: number }, wake: boolean): void; setEnabled(enabled: boolean): void };
  spawnTime: number;
  detectedAt: number | null;
  arrivedAt: number | null;
  deliveredAt: number | null;
  correct: boolean | null;
  impactRecorded: boolean;
  jamRecorded: boolean;
  state: 'moving' | 'delivered' | 'jammed';
};

let rapierReady: Promise<typeof import('@dimforge/rapier3d-compat')> | null = null;

async function loadRapier() {
  if (!rapierReady) {
    rapierReady = import('@dimforge/rapier3d-compat').then(async (rapier) => {
      await rapier.init();
      return rapier;
    });
  }
  return rapierReady;
}

const round = (value: number, places = 1) => Number(value.toFixed(places));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const median = (values: number[]) => {
  if (!values.length) return 1000;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function assertRunnableDesign(state: ForgeState) {
  if (!state.goal) throw new Error('INVALID_DESIGN: Set a measurable design goal before running physics.');
  const missing = REQUIRED_CATALOG_IDS.filter((catalogId) => !state.components.some((component) => component.catalogId === catalogId));
  if (missing.length) throw new Error(`INVALID_DESIGN: Add the required ${missing.join(', ')} component${missing.length === 1 ? '' : 's'} before running physics.`);
  const hasSignalConnection = state.connections.some((connection) => connection.sourceId === 'sensor-color' && connection.sourcePort === 'signal' && connection.targetId === 'diverter-servo' && connection.targetPort === 'command' && connection.type === 'signal');
  if (!hasSignalConnection) throw new Error('INVALID_DESIGN: Connect the color sensor signal to the servo command port before running physics.');
  const sensorAttached = state.sensorAttachments.some((attachment) => attachment.sensorId === 'sensor-color' && attachment.channel === 'color' && attachment.targetZone === 'conveyor-main');
  if (!sensorAttached) throw new Error('INVALID_DESIGN: Attach the color sensor to the conveyor decision lane before running physics.');
  const actuatorAttachment = state.actuatorAttachments.find((attachment) => attachment.actuatorId === 'diverter-servo' && attachment.targetId === 'diverter-servo');
  if (!actuatorAttachment) throw new Error('INVALID_DESIGN: Attach the servo actuator to the diverter before running physics.');
  if (actuatorAttachment.axis !== 'y' || actuatorAttachment.travelDegrees < 30) throw new Error('INVALID_DESIGN: The validated diverter needs a Y-axis actuator with at least 30° of travel.');
  const rulesReady = (['red', 'blue'] as const).every((color) => state.controlRules.some((rule) => rule.condition === color && rule.sensorId === 'sensor-color' && rule.actuatorId === 'diverter-servo'));
  if (!rulesReady) throw new Error('INVALID_DESIGN: Create both red and blue sensor-to-diverter control rules before running physics.');

  for (const component of state.components.filter((candidate) => REQUIRED_CATALOG_IDS.includes(candidate.catalogId as typeof REQUIRED_CATALOG_IDS[number]))) {
    const catalogItem = componentCatalog.find((candidate) => candidate.catalogId === component.catalogId)!;
    const positionAxes = component.catalogId === 'color-sensor' ? [1, 2] : [0, 1, 2];
    const positionChanged = positionAxes.some((axis) => Math.abs(component.position[axis] - catalogItem.defaultPosition[axis]) > 0.05);
    const rotationChanged = component.rotation.some((value, axis) => Math.abs(value - catalogItem.defaultRotation[axis]) > 0.05);
    if (positionChanged || rotationChanged) throw new Error(`INVALID_DESIGN: ${component.name} is outside the validated fixture geometry. Restore its catalog transform or move only the color sensor along its X rail.`);
  }
}

export async function simulateDesign(state: ForgeState): Promise<SimulationRun> {
  assertRunnableDesign(state);
  const RAPIER = await loadRapier();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;

  const sensor = state.components.find((item) => item.catalogId === 'color-sensor');
  const sensorX = sensor?.position[0] ?? -0.8;
  const componentCount = state.components.length;

  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.15, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(6.3, 0.15, 3.2).setFriction(0.82), floor);
  const belt = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-1.05, 0.42, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(3.55, 0.12, 0.72).setFriction(0.8), belt);
  const stopper = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(2.72, 0.77, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.08, 0.28, 0.3).setFriction(0.9).setRestitution(0.03), stopper);
  const diverterBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(DIVERTER_X, 0.78, 0));
  // The kinematic paddle pose is authoritative for timing and steering. Its
  // thin sensor collider lets Rapier track overlap without double-applying a
  // response on top of the controlled servo force below.
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.62, 0.12, 0.06).setSensor(true), diverterBody);

  const boxes: BoxRecord[] = [];
  const collisions: CollisionEvent[] = [];
  const failures: FailureEvent[] = [];
  const telemetry: TelemetrySample[] = [];
  const replay: ReplayFrame[] = [];
  const sensorTravel: number[] = [];
  const commands: Array<{ startsAt: number; endsAt: number; target: number; color: 'red' | 'blue'; boxId: string }> = [];
  let servoAngle = 0;
  let previousServoAngle = 0;
  let nextSpawn = 0;
  let spawnIndex = 0;
  let lastSensorPulse: 'red' | 'blue' | null = null;

  const addFailure = (event: Omit<FailureEvent, 'id' | 'replayFrame'>, frameIndex: number) => {
    if (failures.some((item) => item.type === event.type && item.componentIds[0] === event.componentIds[0])) return;
    failures.push({ ...event, id: `failure-${failures.length + 1}`, replayFrame: frameIndex });
  };

  const addCollision = (box: BoxRecord, time: number, point: Vec3, bodyB: string, impulse: number) => {
    if (collisions.some((item) => item.bodyA === box.id && item.bodyB === bodyB)) return;
    collisions.push({ id: `collision-${collisions.length + 1}`, time: round(time, 2), bodyA: box.id, bodyB, impulse: round(impulse, 1), point, replayFrame: replay.length, harmful: true });
  };

  for (let tick = 0; tick <= DURATION / DT; tick += 1) {
    const time = tick * DT;
    lastSensorPulse = null;

    if (spawnIndex < COLORS.length && time + 0.0001 >= nextSpawn) {
      const color = COLORS[spawnIndex];
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(-4.55, 0.82, 0)
          .setLinearDamping(0.12)
          .setAngularDamping(3)
          .setCcdEnabled(true)
          .enabledRotations(false, false, false),
      );
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.24, 0.24, 0.24).setDensity(1.2).setFriction(0.55).setRestitution(0.04), body);
      boxes.push({ id: `box-${spawnIndex + 1}`, color, body, spawnTime: time, detectedAt: null, arrivedAt: null, deliveredAt: null, correct: null, impactRecorded: false, jamRecorded: false, state: 'moving' });
      spawnIndex += 1;
      nextSpawn += SPAWN_INTERVAL;
    }

    const activeCommand = [...commands].reverse().find((command) => time >= command.startsAt && time <= command.endsAt);
    const desiredAngle = activeCommand?.target ?? 0;
    const maxStep = SERVO_SPEED * DT;
    previousServoAngle = servoAngle;
    servoAngle += clamp(desiredAngle - servoAngle, -maxStep, maxStep);
    diverterBody.setNextKinematicRotation({ x: 0, y: Math.sin(servoAngle / 2), z: 0, w: Math.cos(servoAngle / 2) });
    const servoAngularVelocity = Math.abs(servoAngle - previousServoAngle) / DT;

    for (const box of boxes) {
      if (box.state !== 'moving') continue;
      const position = box.body.translation();
      const velocity = box.body.linvel();
      const direction = box.color === 'red' ? -1 : 1;

      if (box.detectedAt === null && position.x >= sensorX) {
        box.detectedAt = time;
        lastSensorPulse = box.color;
        const rule = state.controlRules.find((candidate) => candidate.condition === box.color && candidate.sensorId === 'sensor-color' && candidate.actuatorId === 'diverter-servo')!;
        const target = clamp(rule.targetAngle * Math.PI / 180, -SERVO_TARGET, SERVO_TARGET);
        commands.push({ startsAt: time + state.actuatorDelayMs / 1000, endsAt: time + (state.actuatorDelayMs + state.actuatorHoldMs) / 1000, target, color: box.color, boxId: box.id });
      }

      if (box.arrivedAt === null && position.x >= DIVERTER_X) {
        box.arrivedAt = time;
        if (box.detectedAt !== null) sensorTravel.push(time - box.detectedAt);
        const aligned = Math.abs(servoAngle) >= 0.38 && Math.sign(servoAngle) === direction;
        if (!aligned) {
          addFailure({ type: 'late_actuation', time: round(time, 2), title: 'Diverter missed its actuation window', detail: `${box.id} reached the diverter before the paddle was aligned.`, componentIds: [box.id, 'servo-diverter'] }, replay.length);
        }
      }

      let nextZ = velocity.z * 0.96;
      if (position.x > 0.92 && position.x < 2.62 && Math.abs(servoAngle) > 0.2) {
        const paddleDirection = Math.sign(servoAngle);
        nextZ += paddleDirection * 0.12;
        nextZ = clamp(nextZ, -2.45, 2.45);
      }
      box.body.setLinvel({ x: state.motorSpeed, y: velocity.y, z: nextZ }, true);
      box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

      if (!box.impactRecorded && box.arrivedAt !== null && time - box.arrivedAt < 0.18 && Math.abs(position.x - DIVERTER_X) < 0.34 && Math.abs(position.z) < 0.5 && servoAngularVelocity > 0.7 && (Math.abs(servoAngle) < 0.38 || Math.sign(servoAngle) !== direction)) {
        box.impactRecorded = true;
        const point: Vec3 = [round(position.x, 2), round(position.y, 2), round(position.z, 2)];
        addCollision(box, time, point, 'servo-diverter', 18 + servoAngularVelocity * 3.4);
        addFailure({ type: 'moving_diverter_impact', time: round(time, 2), title: 'Package struck a moving diverter', detail: `${box.id} contacted the paddle while it was rotating at ${round(servoAngularVelocity, 1)} rad/s.`, componentIds: [box.id, 'servo-diverter'] }, replay.length);
      }

      const updated = box.body.translation();
      if (!box.jamRecorded && updated.x > 2.35 && Math.abs(updated.z) < 0.54 && box.arrivedAt !== null && time - box.arrivedAt > 0.76) {
        box.jamRecorded = true;
        box.state = 'jammed';
        const point: Vec3 = [round(updated.x, 2), round(updated.y, 2), round(updated.z, 2)];
        addCollision(box, time, point, 'center-stopper', 28.4);
        addFailure({ type: 'jam', time: round(time, 2), title: 'Decision-zone jam detected', detail: `${box.id} remained below the lateral clearance threshold for more than 0.75 seconds.`, componentIds: [box.id, 'center-stopper'] }, replay.length);
        box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }

      if (updated.x >= 3.55 && Math.abs(updated.z) >= 0.62) {
        box.deliveredAt = time;
        box.correct = (updated.z < 0 && box.color === 'red') || (updated.z > 0 && box.color === 'blue');
        box.state = 'delivered';
        if (!box.correct) addFailure({ type: 'missort', time: round(time, 2), title: 'Package entered the wrong bin', detail: `${box.id} was routed to the opposite color channel.`, componentIds: [box.id] }, replay.length);
        box.body.setEnabled(false);
      }
    }

    world.step();

    if (tick % 3 === 0) {
      const frameBoxes: ReplayBox[] = boxes.filter((box) => box.state !== 'delivered').map((box) => {
        const p = box.body.translation();
        const r = box.body.rotation();
        const v = box.body.linvel();
        return { id: box.id, color: box.color, position: [round(p.x, 3), round(p.y, 3), round(p.z, 3)], rotation: [round(r.x, 4), round(r.y, 4), round(r.z, 4), round(r.w, 4)], velocity: [round(v.x, 3), round(v.y, 3), round(v.z, 3)], state: box.state };
      });
      const recentPoints = collisions.filter((event) => time - event.time < 0.16).map((event) => event.point);
      replay.push({ time: round(time, 3), boxes: frameBoxes, diverterAngle: round(servoAngle, 4), sensorPulse: lastSensorPulse, collisionPoints: recentPoints });
    }

    if (tick % 15 === 0) {
      telemetry.push({ time: round(time, 2), queueDepth: boxes.filter((box) => box.state === 'moving').length, delivered: boxes.filter((box) => box.state === 'delivered').length, diverterAngle: round(servoAngle, 3), beltVelocity: state.motorSpeed, collisionCount: collisions.length });
    }
  }

  const delivered = boxes.filter((box) => box.deliveredAt !== null);
  const correct = delivered.filter((box) => box.correct).length;
  const deliveredTimes = delivered.map((box) => box.deliveredAt!).sort((a, b) => a - b);
  const throughput = deliveredTimes.length > 1 ? ((deliveredTimes.length - 1) * 60) / (deliveredTimes.at(-1)! - deliveredTimes[0]) : 0;
  const cycleTimes = delivered.map((box) => box.deliveredAt! - box.spawnTime);
  const metrics = {
    throughput: round(throughput),
    accuracy: round(delivered.length ? (correct / delivered.length) * 100 : 0),
    collisions: collisions.length,
    jams: boxes.filter((box) => box.state === 'jammed').length,
    componentCount,
    cycleTime: round(cycleTimes.length ? cycleTimes.reduce((sum, value) => sum + value, 0) / cycleTimes.length : 0, 2),
    delivered: delivered.length,
    spawned: boxes.length,
  };
  const travelMs = Math.round(median(sensorTravel) * 1000);
  const recommendedDelayMs = clamp(Math.round(travelMs - SERVO_SETTLE_MS - SAFETY_LEAD_MS), 120, 2200);
  if (metrics.throughput < (state.goal?.throughputBpm ?? 20)) {
    failures.push({ id: `failure-${failures.length + 1}`, type: 'throughput_shortfall', time: DURATION, title: 'Throughput target missed', detail: `${metrics.throughput} boxes/min is below the ${(state.goal?.throughputBpm ?? 20)} boxes/min goal.`, componentIds: ['conveyor'], replayFrame: replay.length - 1 });
  }
  const passed = metrics.throughput >= (state.goal?.throughputBpm ?? 20)
    && metrics.accuracy >= (state.goal?.minAccuracyPct ?? 95)
    && metrics.componentCount <= (state.goal?.maxComponents ?? 7)
    && metrics.jams === 0
    && metrics.collisions === 0
    && metrics.delivered / Math.max(metrics.spawned, 1) >= 0.9;

  world.free();
  return {
    id: `RUN-${state.designRevision.toString().padStart(2, '0')}-${Date.now().toString(36).toUpperCase()}`,
    designRevision: state.designRevision,
    designHash: state.designHash,
    seed: 424242,
    startedAt: new Date().toISOString(),
    status: passed ? 'passed' : 'failed',
    metrics,
    telemetry,
    collisions,
    failures,
    replay,
    sensorToDiverterMs: travelMs,
    recommendedDelayMs,
    configuration: {
      sensorPosition: [...(sensor?.position ?? [-0.8, 1.05, 0])] as Vec3,
      motorSpeed: state.motorSpeed,
      actuatorDelayMs: state.actuatorDelayMs,
      actuatorHoldMs: state.actuatorHoldMs,
      componentCount,
    },
    physics: { engine: 'Rapier', timestepHz: 60, simulatedSeconds: DURATION },
  };
}
