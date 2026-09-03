import { catalogFor, componentMass, materialFor, materials, primitiveCatalog } from './forge-data';
import { localPointToWorld, worldPointToLocal } from './forge-motion';
import { FORGE_COORDINATE_CONVENTION } from './forge-intent';
import type {
  Actor, Assembly, BodyType, Capability, ControlMode, DesignGoal, DesignSnapshot,
  ForgeState, ForgeToolName, GoalConstraint, JointType, MachineComponent,
  OptimizationAction, PrimitiveKind, SensorType, SimulationRun, ToolResult, Vec3,
} from './forge-types';

const clone = <T,>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const mutationTools = new Set<ForgeToolName>([
  'set_design_goal', 'create_assembly', 'create_component', 'set_dimensions', 'set_material', 'set_mass',
  'move_component', 'rotate_component', 'connect_components', 'create_joint', 'add_motor', 'add_sensor',
  'set_motor_speed', 'set_sensor_range', 'add_actuator', 'set_actuator_timing', 'set_control_logic',
  'update_control_logic', 'optimize_design', 'remove_component', 'remove_joint', 'restore_revision',
]);

function stablePayload(state: ForgeState) {
  return {
    world: state.world,
    goal: state.goal,
    assemblies: state.assemblies,
    components: state.components.map((component) => {
      const physicalState: Partial<MachineComponent> = { ...component };
      delete physicalState.lastModifiedBy;
      return physicalState;
    }),
    connections: state.connections,
    joints: state.joints,
    motors: state.motors,
    sensors: state.sensors,
    actuators: state.actuators,
    controls: state.controls,
  };
}

export function computeDesignHash(state: ForgeState) {
  const payload = JSON.stringify(stablePayload(state));
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) hash = Math.imul(hash ^ payload.charCodeAt(index), 16777619);
  return `world-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function addActivity(state: ForgeState, tool: ForgeToolName | 'human_drag' | 'checkpoint', detail: string, actor: Actor, outcome: 'success' | 'failed' | 'running' | 'read' = 'success') {
  const seq = state.activitySeq + 1;
  return { ...state, activitySeq: seq, activity: [{ id: `activity-${seq}`, seq, tool, detail, actor, outcome, at: now() }, ...state.activity].slice(0, 140) };
}

function snapshot(state: ForgeState, label: string, actor: Actor): DesignSnapshot {
  return {
    id: `revision-${state.revision}`, revision: state.revision, designRevision: state.designRevision,
    label, actor, at: now(), designHash: state.designHash, goal: clone(state.goal), world: clone(state.world),
    assemblies: clone(state.assemblies), components: clone(state.components), connections: clone(state.connections),
    joints: clone(state.joints), motors: clone(state.motors), sensors: clone(state.sensors), actuators: clone(state.actuators),
    controls: clone(state.controls), optimizationLevel: state.optimizationLevel, metrics: state.runs.at(-1)?.metrics ?? null,
  };
}

function success(state: ForgeState, message: string, data?: unknown): ToolResult {
  return { ok: true, workspace_id: state.workspaceId, workspace_nonce: state.workspaceNonce, revision: state.revision, design_revision: state.designRevision, design_hash: state.designHash, message, data };
}

function assertGuard(state: ForgeState, input: Record<string, unknown>) {
  if (input.expected_workspace_nonce !== state.workspaceNonce) throw new Error('WRONG_WORKSPACE: inspect the active workspace and retry with its nonce.');
  if (input.expected_revision !== state.revision) throw new Error(`STALE_REVISION: expected revision ${state.revision}. Inspect the shared world before retrying.`);
}

function designMutation(state: ForgeState, tool: ForgeToolName, label: string, actor: Actor, detail: string) {
  let next: ForgeState = { ...state, revision: state.revision + 1, designRevision: state.designRevision + 1, phase: state.components.length ? 'ready' : 'building', replayRunId: null };
  next.designHash = computeDesignHash(next);
  next = addActivity(next, tool, detail, actor);
  next.revisions = [...next.revisions, snapshot(next, label, actor)].slice(-60);
  return next;
}

function idValue(value: unknown, label = 'id') {
  const id = String(value ?? '');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error(`INVALID_INPUT: ${label} must be lowercase kebab-case.`);
  return id;
}

function vector(value: unknown, label: string, range: [number, number]): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) throw new Error(`INVALID_INPUT: ${label} must contain three finite numbers.`);
  if (value.some((item) => item < range[0] || item > range[1])) throw new Error(`CONSTRAINT_VIOLATION: ${label} is outside the world envelope.`);
  return value.map((item) => Number(item.toFixed(4))) as Vec3;
}

function position(value: unknown, state: ForgeState) {
  const bound = Math.max(...state.world.bounds);
  return vector(value, 'position', [-bound, bound]);
}

function rotation(value: unknown) { return vector(value, 'rotation', [-Math.PI * 2, Math.PI * 2]); }

function dimensions(value: unknown) {
  const result = vector(value, 'dimensions', [.02, 30]);
  if (result.some((item) => item <= 0)) throw new Error('INVALID_INPUT: dimensions must be positive.');
  return result;
}

function component(state: ForgeState, value: unknown) {
  const found = state.components.find((item) => item.id === value);
  if (!found) throw new Error(`INVALID_INPUT: component “${String(value)}” was not found.`);
  return found;
}

function assembly(state: ForgeState, value: unknown) {
  const found = state.assemblies.find((item) => item.id === value);
  if (!found) throw new Error(`INVALID_INPUT: assembly “${String(value)}” was not found.`);
  return found;
}

function joint(state: ForgeState, value: unknown) {
  const found = state.joints.find((item) => item.id === value);
  if (!found) throw new Error(`INVALID_INPUT: joint “${String(value)}” was not found.`);
  return found;
}

function driveBodyInterfacesWithJoint(
  state: ForgeState,
  driveComponentId: string,
  targetJoint: Pick<ForgeState['joints'][number], 'id' | 'componentA' | 'componentB'>,
) {
  const endpoints = new Set([targetJoint.componentA, targetJoint.componentB]);
  if (endpoints.has(driveComponentId)) return true;
  const interfacesEndpoint = (left: string, right: string) => (left === driveComponentId && endpoints.has(right))
    || (right === driveComponentId && endpoints.has(left));
  return state.connections.some((item) => ['mechanical', 'power'].includes(item.type) && interfacesEndpoint(item.sourceId, item.targetId))
    || state.joints.some((item) => item.id !== targetJoint.id && interfacesEndpoint(item.componentA, item.componentB));
}

function driveBodyHasOutputInterface(state: ForgeState, driveComponentId: string) {
  return state.connections.some((item) => ['mechanical', 'power'].includes(item.type)
    && (item.sourceId === driveComponentId || item.targetId === driveComponentId));
}

function assertDrivenJoint(state: ForgeState, targetJoint: ForgeState['joints'][number], driveComponentId: string, actor: Actor) {
  const driven = component(state, targetJoint.componentB);
  if (targetJoint.type === 'fixed') throw new Error('INVALID_TOPOLOGY: a drive cannot actuate a fixed joint.');
  if (driven.bodyType === 'fixed') throw new Error('INVALID_TOPOLOGY: a drive joint must have a movable component_b endpoint.');
  if (actor === 'WebMCP' && !driveBodyInterfacesWithJoint(state, driveComponentId, targetJoint)) {
    throw new Error('INVALID_TOPOLOGY: connect the drive body to the driven joint support or moving child before attaching the drive.');
  }
}

function runFor(state: ForgeState, value: unknown) {
  const found = value === undefined ? state.runs.at(-1) : state.runs.find((item) => item.id === value);
  if (!found) throw new Error('INVALID_PHASE: run the simulation before inspecting evidence.');
  return found;
}

function lockField(state: ForgeState, target: MachineComponent, field: 'position' | 'rotation' | 'dimensions' | 'material' | 'mass', actor: Actor) {
  if (target.humanLockedFields.includes(field) && actor !== 'Human') throw new Error(`LOCKED_BY_HUMAN: preserve the human-authored ${field} and redesign around it.`);
  target.lastModifiedBy = actor;
  if (actor === 'Human' && !target.humanLockedFields.includes(field)) {
    target.humanLockedFields.push(field);
    const existing = state.humanConstraints.find((item) => item.componentId === target.id);
    if (existing) {
      if (!existing.fields.includes(field)) existing.fields.push(field);
      existing.changedAtRevision = state.revision + 1;
    } else state.humanConstraints.push({ componentId: target.id, fields: [field], lockedForAgent: true, changedAtRevision: state.revision + 1 });
  }
}

function asGoal(input: Record<string, unknown>): DesignGoal {
  const brief = String(input.brief ?? '').trim();
  if (brief.length < 12 || brief.length > 500) throw new Error('INVALID_INPUT: brief must be 12–500 characters.');
  const machineName = String(input.machine_name ?? '').trim();
  const domain = String(input.domain ?? 'General mechanical engineering').trim();
  if (machineName.length < 3 || machineName.length > 80) throw new Error('INVALID_INPUT: machine_name must be 3–80 characters.');
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities.map(String) as Capability[] : [];
  if (!capabilities.length) throw new Error('INVALID_INPUT: at least one engineering capability is required.');
  const allowedCapabilities = new Set<Capability>(['structure', 'transport', 'classify', 'lift', 'suspend', 'mobile', 'manipulate', 'transmit', 'stabilize', 'track', 'buffer', 'contain', 'rotate', 'measure']);
  if (capabilities.some((item) => !allowedCapabilities.has(item))) throw new Error('INVALID_INPUT: unknown capability.');
  const constraints = clone(input.constraints) as GoalConstraint[];
  if (!Array.isArray(constraints) || !constraints.length || constraints.some((item) => !item || !['min', 'max', 'exact'].includes(item.operator) || !Number.isFinite(item.target))) throw new Error('INVALID_INPUT: provide typed measurable constraints.');
  const maxComponents = Number(input.max_components);
  if (!Number.isInteger(maxComponents) || maxComponents < 1 || maxComponents > 80) throw new Error('CONSTRAINT_VIOLATION: max_components must be 1–80.');
  return {
    machineName, domain, brief,
    summary: String(input.summary ?? `Compose ${capabilities.join(', ')} behavior from physical primitives.`).slice(0, 240),
    capabilities, constraints, maxComponents,
    assumptions: Array.isArray(input.assumptions) ? input.assumptions.map(String).slice(0, 16) : [],
    disclaimer: String(input.disclaimer ?? 'Concept-level rigid-body model; validate safety-critical designs before fabrication.').slice(0, 240),
    simulationModel: String(input.simulation_model ?? 'Generic multi-body Rapier world').slice(0, 160),
    editableComponentId: String(input.editable_component_id ?? ''),
    editableLabel: String(input.editable_label ?? 'selected primitive').slice(0, 80),
    orientation: structuredClone(FORGE_COORDINATE_CONVENTION),
  };
}

function failedFactor(reading: SimulationRun['metrics']['measures'][number]) {
  if (reading.operator === 'min') return Math.max(1.08, reading.target / Math.max(Math.abs(reading.value), .001) * 1.08);
  if (reading.operator === 'max') return Math.max(1.08, Math.abs(reading.value) / Math.max(Math.abs(reading.target), .001) * 1.08);
  return Math.max(1.08, Math.abs(reading.target) / Math.max(Math.abs(reading.value), .001));
}

function optimizationActions(state: ForgeState, run: SimulationRun) {
  const actions: OptimizationAction[] = [];
  const failed = run.metrics.measures.filter((reading) => reading.status === 'fail' && reading.metric !== 'component_count');
  const metrics = new Set(failed.map((reading) => reading.metric));
  const factorFor = (...keys: string[]) => Math.min(4, Math.max(1.12, ...failed.filter((item) => keys.includes(item.metric)).map(failedFactor)));
  const controlMetrics = ['placement_error', 'platform_tilt', 'tracking_error', 'response_time', 'sorting_accuracy', 'control_error', 'peak_acceleration', 'collisions', 'alignment_error'];
  const satisfyingValue = (reading: SimulationRun['metrics']['measures'][number]) => reading.operator === 'min'
    ? reading.target * 1.02
    : reading.operator === 'max'
      ? reading.target * .98
      : reading.target;
  const pressRam = state.components.find((item) => item.parameters.hydraulic_ram);
  const pressActuator = pressRam ? state.actuators.find((item) => item.componentId === pressRam.id) : undefined;
  const pressControl = state.controls.find((item) => /press/i.test(item.name));
  const winchDrum = state.components.find((item) => item.parameters.winch_drum);
  const winchMotorBody = state.components.find((item) => item.parameters.electric_winch_motor);
  const winchMotor = winchMotorBody ? state.motors.find((item) => item.componentId === winchMotorBody.id) : undefined;
  const winchActuator = state.actuators.find((item) => item.type === 'winch' && state.joints.some((jointItem) => jointItem.id === item.jointId && state.components.find((componentItem) => componentItem.id === jointItem.componentB)?.parameters.winch_hook));
  const winchControl = state.controls.find((item) => /winch/i.test(item.name));

  const forceReading = failed.find((item) => item.metric === 'pressing_force');
  if (forceReading && pressActuator) {
    const before = pressActuator.maxForce;
    pressActuator.maxForce = Number(Math.max(1, satisfyingValue(forceReading)).toFixed(1));
    if (pressActuator.maxForce !== before) actions.push({ targetId: pressActuator.id, field: 'maxForce', before, after: pressActuator.maxForce, reason: 'Resize the hydraulic ram force limit from the measured press-force shortfall.' });
    const barrel = state.components.find((item) => item.parameters.hydraulic_barrel);
    if (barrel) {
      const ratingBefore = Number(barrel.parameters.rated_force_n ?? 0);
      barrel.parameters.rated_force_n = pressActuator.maxForce;
      if (ratingBefore !== pressActuator.maxForce) actions.push({ targetId: barrel.id, field: 'rated_force_n', before: ratingBefore, after: pressActuator.maxForce, reason: 'Match the cylinder pressure-vessel rating to the redesigned ram force.' });
    }
    if (pressControl && pressControl.setpoint !== forceReading.target) {
      const setpointBefore = pressControl.setpoint;
      pressControl.setpoint = forceReading.target;
      actions.push({ targetId: pressControl.id, field: 'setpoint', before: setpointBefore, after: pressControl.setpoint, reason: 'Align the press controller setpoint with the requested force envelope.' });
    }
  }

  const strokeReading = failed.find((item) => item.metric === 'stroke');
  if (strokeReading && pressActuator) {
    const requestedStroke = Number(Math.max(.001, satisfyingValue(strokeReading)).toFixed(4));
    const before = pressActuator.travel;
    pressActuator.travel = requestedStroke;
    if (before !== pressActuator.travel) actions.push({ targetId: pressActuator.id, field: 'travel', before, after: pressActuator.travel, reason: 'Set the hydraulic actuator travel from the measured ram-stroke error.' });
    const guide = state.joints.find((item) => item.id === pressActuator.jointId);
    if (guide) {
      const lower = guide.limits?.[0] ?? 0;
      const limitBefore = guide.limits?.[1] ?? 0;
      guide.limits = [lower, Math.max(lower + .001, requestedStroke)];
      if (guide.limits[1] !== limitBefore) actions.push({ targetId: guide.id, field: 'upper travel limit', before: limitBefore, after: guide.limits[1], reason: 'Match the physical platen guide limit to the redesigned hydraulic stroke.' });
    }
    for (const item of state.components.filter((componentItem) => componentItem.parameters.hydraulic_ram || componentItem.parameters.press_platen || componentItem.parameters.press_tooling === 'upper' || componentItem.parameters.press_load_cell)) {
      if (typeof item.parameters.operation_travel === 'number') {
        const travelBefore = item.parameters.operation_travel;
        item.parameters.operation_travel = requestedStroke;
        if (travelBefore !== requestedStroke) actions.push({ targetId: item.id, field: 'operation_travel', before: travelBefore, after: requestedStroke, reason: 'Keep the visible press tooling motion synchronized with the redesigned stroke.' });
      }
      if (item.parameters.hydraulic_ram) {
        const strokeBefore = Number(item.parameters.stroke_m ?? 0);
        item.parameters.stroke_m = requestedStroke;
        if (strokeBefore !== requestedStroke) actions.push({ targetId: item.id, field: 'stroke_m', before: strokeBefore, after: requestedStroke, reason: 'Update the hydraulic ram specification to the redesigned physical travel.' });
      }
    }
  }

  const parallelismReading = failed.find((item) => item.metric === 'platen_parallelism');
  if (parallelismReading && pressControl) {
    const desiredError = Math.max(.001, satisfyingValue(parallelismReading));
    const sensorCount = Math.max(1, pressControl.sensorIds.length);
    const sensor = state.sensors.find((item) => pressControl.sensorIds.includes(item.id));
    const sensorBody = sensor ? state.components.find((item) => item.id === sensor.componentId) : undefined;
    const calibrationError = sensorBody ? Math.abs(sensorBody.position[0] - pressControl.calibrationX) : 0;
    const desiredQuality = Math.max(.08, Math.min(1.7, (2.4 / desiredError - 1 - sensorCount * .5) / 2));
    const before = pressControl.kp;
    pressControl.kp = Number(Math.min(10, Math.max(.01, desiredQuality * (1 + calibrationError * 3.5) - pressControl.kd * .35)).toFixed(3));
    if (pressControl.kp !== before) actions.push({ targetId: pressControl.id, field: 'kp', before, after: pressControl.kp, reason: 'Retune the platen feedback loop from the measured parallelism error.' });
  }

  const lineSpeedReading = failed.find((item) => item.metric === 'line_speed');
  const drumRadius = Number(winchDrum?.parameters.drum_radius_m ?? 0);
  if (lineSpeedReading && winchMotor && drumRadius > 0) {
    const requestedSpeed = Math.max(.001, satisfyingValue(lineSpeedReading));
    const requestedRpm = Number((requestedSpeed / (2 * Math.PI * drumRadius) * 60).toFixed(3));
    const before = winchMotor.maxRpm;
    winchMotor.maxRpm = requestedRpm;
    if (winchMotor.maxRpm !== before) actions.push({ targetId: winchMotor.id, field: 'maxRpm', before, after: winchMotor.maxRpm, reason: 'Set drum speed from the measured cable speed and the modeled winding radius.' });
    if (winchActuator && winchActuator.maxSpeed !== requestedSpeed) {
      const speedBefore = winchActuator.maxSpeed;
      winchActuator.maxSpeed = Number(requestedSpeed.toFixed(4));
      actions.push({ targetId: winchActuator.id, field: 'maxSpeed', before: speedBefore, after: winchActuator.maxSpeed, reason: 'Keep the hook command synchronized with the redesigned drum line speed.' });
    }
    if (winchControl && winchControl.setpoint !== lineSpeedReading.target) {
      const setpointBefore = winchControl.setpoint;
      winchControl.setpoint = lineSpeedReading.target;
      actions.push({ targetId: winchControl.id, field: 'setpoint', before: setpointBefore, after: winchControl.setpoint, reason: 'Align the winch controller setpoint with the requested cable speed.' });
    }
  }

  const cableReading = failed.find((item) => item.metric === 'cable_safety_factor');
  if (cableReading) {
    const payload = state.components.find((item) => item.parameters.winch_payload);
    const payloadMass = Number(payload?.parameters.payload_kg ?? payload?.mass ?? 0);
    const ratedLoad = Number((Math.max(.001, satisfyingValue(cableReading)) * Math.max(payloadMass * 9.81, 1)).toFixed(1));
    for (const cable of state.components.filter((item) => item.parameters.winch_cable)) {
      const before = Number(cable.parameters.rated_breaking_load_n ?? 0);
      cable.parameters.rated_breaking_load_n = ratedLoad;
      if (ratedLoad !== before) actions.push({ targetId: cable.id, field: 'rated_breaking_load_n', before, after: ratedLoad, reason: 'Select cable capacity from the suspended design load and measured safety-factor requirement.' });
    }
  }

  if (failed.some((reading) => controlMetrics.includes(reading.metric))) for (const control of state.controls) {
    const before = control.kp;
    control.kp = Number(Math.min(1.65, Math.max(.95, control.kp * factorFor(...controlMetrics))).toFixed(3));
    if (control.kp !== before) actions.push({ targetId: control.id, field: 'kp', before, after: control.kp, reason: 'Increase closed-loop authority from the measured tracking error.' });
    const sensor = state.sensors.find((item) => item.id === control.sensorIds[0]);
    const sensorBody = sensor ? state.components.find((item) => item.id === sensor.componentId) : undefined;
    if (sensorBody && control.calibrationX !== sensorBody.position[0]) {
      const calibrationBefore = control.calibrationX;
      control.calibrationX = sensorBody.position[0];
      actions.push({ targetId: control.id, field: 'calibrationX', before: calibrationBefore, after: control.calibrationX, reason: 'Retune the control datum around the human-authored sensor position.' });
    }
    if (metrics.has('peak_acceleration')) {
      const beforeKd = control.kd;
      control.kd = Number(Math.min(.9, Math.max(.22, control.kd * factorFor('peak_acceleration') * 1.35)).toFixed(3));
      if (control.kd !== beforeKd) actions.push({ targetId: control.id, field: 'kd', before: beforeKd, after: control.kd, reason: 'Add damping from the measured acceleration overshoot.' });
    }
  }

  if (failed.some((reading) => ['payload_capacity', 'joint_margin', 'clamp_force'].includes(reading.metric))) for (const actuator of state.actuators) {
    const before = actuator.maxForce;
    actuator.maxForce = Number((actuator.maxForce * factorFor('payload_capacity', 'joint_margin', 'clamp_force')).toFixed(1));
    if (actuator.maxForce !== before) actions.push({ targetId: actuator.id, field: 'maxForce', before, after: actuator.maxForce, reason: 'Restore actuation margin under the measured payload.' });
  }

  if (failed.some((reading) => ['payload_capacity', 'output_torque', 'joint_margin', 'traction_margin'].includes(reading.metric))) for (const motor of state.motors) {
    const before = motor.maxTorque;
    motor.maxTorque = Number((motor.maxTorque * factorFor('payload_capacity', 'output_torque', 'joint_margin', 'traction_margin')).toFixed(1));
    if (motor.maxTorque !== before) actions.push({ targetId: motor.id, field: 'maxTorque', before, after: motor.maxTorque, reason: 'Raise the measured drive-torque reserve.' });
  }

  if (failed.some((reading) => ['throughput', 'course_time', 'flow_rate'].includes(reading.metric))) for (const motor of state.motors) {
    const before = motor.maxRpm;
    motor.maxRpm = Number(Math.min(2400, motor.maxRpm * factorFor('throughput', 'course_time', 'flow_rate')).toFixed(1));
    if (motor.maxRpm !== before) actions.push({ targetId: motor.id, field: 'maxRpm', before, after: motor.maxRpm, reason: 'Increase cycle speed from measured throughput or travel time.' });
  }

  const angularTravelReading = failed.find((reading) => reading.metric === 'angular_travel');
  if (angularTravelReading) for (const motor of state.motors) {
    const before = motor.maxRpm;
    const requestedTravel = Math.max(.001, satisfyingValue(angularTravelReading));
    const measuredTravel = Math.max(Math.abs(angularTravelReading.value), .001);
    const travelScale = requestedTravel / measuredTravel;
    motor.maxRpm = Number(Math.min(2400, Math.max(.1, motor.maxRpm * travelScale)).toFixed(3));
    if (motor.maxRpm !== before) actions.push({ targetId: motor.id, field: 'maxRpm', before, after: motor.maxRpm, reason: 'Retune shaft speed from the measured angular travel over the simulation window.' });
  }

  if (metrics.has('peak_acceleration')) for (const actuator of state.actuators) {
    const before = actuator.maxSpeed;
    actuator.maxSpeed = Number(Math.max(.08, actuator.maxSpeed / factorFor('peak_acceleration')).toFixed(3));
    if (actuator.maxSpeed !== before) actions.push({ targetId: actuator.id, field: 'maxSpeed', before, after: actuator.maxSpeed, reason: 'Reduce commanded speed to remain inside the acceleration envelope.' });
  } else if (metrics.has('response_time')) for (const actuator of state.actuators) {
    const before = actuator.maxSpeed;
    actuator.maxSpeed = Number(Math.min(8, actuator.maxSpeed * factorFor('response_time')).toFixed(3));
    if (actuator.maxSpeed !== before) actions.push({ targetId: actuator.id, field: 'maxSpeed', before, after: actuator.maxSpeed, reason: 'Increase actuator slew rate from measured response time.' });
  }

  for (const item of state.components) {
    if (item.primitive === 'spring' && failed.some((reading) => ['platform_tilt', 'stability_margin'].includes(reading.metric))) {
      const before = Number(item.parameters.stiffness ?? 18000);
      item.parameters.stiffness = Number((before * factorFor('platform_tilt', 'stability_margin')).toFixed(0));
      item.parameters.damping = Number((Number(item.parameters.damping ?? 2200) * Math.sqrt(factorFor('platform_tilt'))).toFixed(0));
      actions.push({ targetId: item.id, field: 'stiffness', before, after: item.parameters.stiffness as number, reason: 'Reduce measured chassis or platform oscillation.' });
    }
    if (item.primitive === 'counterweight' && metrics.has('stability_margin') && !item.humanLockedFields.includes('mass')) {
      const before = item.mass;
      item.mass = Number((item.mass * factorFor('stability_margin')).toFixed(1));
      actions.push({ targetId: item.id, field: 'mass', before, after: item.mass, reason: 'Increase the support margin derived from center of mass.' });
    }
    if (['beam', 'plate'].includes(item.primitive) && failed.some((reading) => ['deflection', 'safety_factor', 'load_capacity'].includes(reading.metric)) && !item.humanLockedFields.includes('dimensions')) {
      const before = item.dimensions[1];
      const stiffnessFactor = metrics.has('deflection') ? Math.cbrt(factorFor('deflection')) : Math.sqrt(factorFor('safety_factor', 'load_capacity'));
      item.dimensions[1] = Number(Math.min(4, item.dimensions[1] * Math.max(1.14, stiffnessFactor)).toFixed(3));
      item.mass = componentMass(item.primitive, item.dimensions, item.materialId);
      actions.push({ targetId: item.id, field: 'section depth', before, after: item.dimensions[1], reason: 'Reduce graph-derived member deflection under the design load.' });
    }
    if (item.primitive === 'gear' && metrics.has('transmission_efficiency')) {
      const before = Number(item.parameters.mesh_efficiency ?? .85);
      item.parameters.mesh_efficiency = Math.max(.9, Math.min(.97, failed.find((reading) => reading.metric === 'transmission_efficiency')!.target / 100 + .025));
      actions.push({ targetId: item.id, field: 'mesh_efficiency', before, after: item.parameters.mesh_efficiency as number, reason: 'Select a lower-loss mesh specification from the measured transmission loss.' });
    }
    if (item.primitive === 'ramp' && metrics.has('drop_height') && !item.humanLockedFields.includes('position')) {
      const conveyor = state.components.find((componentItem) => componentItem.primitive === 'conveyor');
      if (conveyor) {
        const before = item.position[1];
        item.position[1] = Number((conveyor.position[1] - Math.min(.08, item.dimensions[1] / 2)).toFixed(3));
        actions.push({ targetId: item.id, field: 'position.y', before, after: item.position[1], reason: 'Align the transfer surfaces to reduce the measured drop.' });
      }
    }
  }

  if (metrics.has('assembly_integrity') && state.components.length > 1) {
    const connected = new Set<string>([state.components[0].id]);
    for (const edge of [...state.connections.filter((item) => item.type === 'mechanical').map((item) => [item.sourceId, item.targetId]), ...state.joints.map((item) => [item.componentA, item.componentB])]) {
      if (connected.has(edge[0])) connected.add(edge[1]);
      if (connected.has(edge[1])) connected.add(edge[0]);
    }
    for (const item of state.components.filter((componentItem) => !connected.has(componentItem.id))) {
      const id = `repair-connection-${state.connections.length + 1}`;
      state.connections.push({ id, sourceId: state.components[0].id, targetId: item.id, type: 'mechanical', channel: 'optimization_repair' });
      connected.add(item.id);
      actions.push({ targetId: id, field: 'mechanical connection', before: 'disconnected', after: 'connected', reason: 'Repair the disconnected assembly graph revealed by the integrity measurement.' });
    }
  }
  return actions;
}

export function applyForgeTool(current: ForgeState, name: ForgeToolName, input: Record<string, unknown>, actor: Actor): { state: ForgeState; result: ToolResult } {
  let state = clone(current);
  if (mutationTools.has(name)) assertGuard(state, input);

  if (name === 'inspect_workspace') {
    const since = typeof input.since_revision === 'number' ? input.since_revision : null;
    state = addActivity(state, name, `Inspected ${state.components.length} bodies, ${state.joints.length} joints, and ${state.controls.length} controllers.`, actor, 'read');
    return { state, result: success(state, 'World inspected.', { phase: state.phase, world: state.world, goal: state.goal, assemblies: state.assemblies, components: state.components, connections: state.connections, joints: state.joints, motors: state.motors, sensors: state.sensors, actuators: state.actuators, controls: state.controls, human_constraints: state.humanConstraints, latest_run: state.runs.at(-1) ?? null, changes_since_revision: since === null ? [] : state.revisions.filter((item) => item.revision > since).map((item) => ({ revision: item.revision, label: item.label, actor: item.actor })) }) };
  }
  if (name === 'inspect_primitive_catalog') {
    const query = String(input.query ?? '').toLowerCase();
    const items = query ? primitiveCatalog.filter((item) => `${item.name} ${item.family} ${item.capabilities.join(' ')}`.toLowerCase().includes(query)) : primitiveCatalog;
    state = addActivity(state, name, `Inspected ${items.length} reusable primitives and ${materials.length} materials.`, actor, 'read');
    return { state, result: success(state, 'Primitive catalog inspected.', { architecture: 'world-first-v3', primitives: items, materials, note: 'Semantic machines are assemblies created from these lower-level bodies; no complete machine templates are stored.' }) };
  }
  if (name === 'inspect_telemetry') {
    const run = runFor(state, input.run_id);
    state = addActivity(state, name, `Read ${run.telemetry.length} samples and objective ${run.objective.toFixed(3)}.`, actor, 'read');
    return { state, result: success(state, 'Telemetry inspected.', { run_id: run.id, metrics: run.metrics, diagnosis: run.diagnosis, physics: run.physics, samples: run.telemetry.slice(0, 120) }) };
  }
  if (name === 'inspect_failure') {
    const run = runFor(state, input.run_id);
    state = addActivity(state, name, `Inspected ${run.failures.length} causal failure${run.failures.length === 1 ? '' : 's'}.`, actor, 'read');
    return { state, result: success(state, 'Failure evidence inspected.', { failures: run.failures, collisions: run.collisions, recommendations: run.diagnosis.recommendations }) };
  }
  if (name === 'measure_constraint') {
    const run = runFor(state, input.run_id);
    const metric = String(input.metric ?? '');
    const reading = run.metrics.measures.find((item) => item.metric === metric);
    if (!reading) throw new Error(`INVALID_INPUT: metric “${metric}” is not present in this run.`);
    state = addActivity(state, name, `Measured ${reading.label}: ${reading.value}${reading.unit} from ${reading.provenance}.`, actor, 'read');
    return { state, result: success(state, 'Constraint measured.', reading) };
  }
  if (name === 'compare_designs') {
    const a = state.revisions.find((item) => item.revision === input.revision_a) ?? state.revisions.at(0);
    const b = state.revisions.find((item) => item.revision === input.revision_b) ?? state.revisions.at(-1);
    if (!a || !b) throw new Error('INVALID_INPUT: two saved revisions are required.');
    state = addActivity(state, name, `Compared revision ${a.revision} with ${b.revision}.`, actor, 'read');
    return { state, result: success(state, 'Designs compared.', { from: a, to: b, changes: { component_delta: b.components.length - a.components.length, joint_delta: b.joints.length - a.joints.length, mass_delta: Number((b.components.reduce((sum, item) => sum + item.mass, 0) - a.components.reduce((sum, item) => sum + item.mass, 0)).toFixed(2)), optimization_delta: b.optimizationLevel - a.optimizationLevel } }) };
  }
  if (name === 'export_design') {
    const formats = Array.isArray(input.formats) ? input.formats.map(String) : [];
    if (!formats.length) throw new Error('INVALID_INPUT: choose at least one export format.');
    state = addActivity(state, name, `Exported revision ${state.revision} as ${formats.map((item) => item.toUpperCase()).join(', ')}.`, actor);
    return { state, result: success(state, 'Design exports downloaded.', {
      revision: state.revision,
      formats,
      body_count: state.components.length,
      joint_count: state.joints.length,
      verification_status: state.runs.at(-1)?.status ?? 'not-run',
    }) };
  }

  if (name === 'set_design_goal') {
    state.goal = asGoal(input);
    if (input.world && typeof input.world === 'object') {
      const requested = input.world as Record<string, unknown>;
      const allowed = new Set(['gravity', 'duration', 'bounds', 'environment']);
      if (Object.keys(requested).some((key) => !allowed.has(key))) throw new Error('INVALID_INPUT: world only accepts gravity, duration, bounds, and environment. Fixed-step rate and seed are immutable.');
      const gravity = requested.gravity === undefined ? state.world.gravity : vector(requested.gravity, 'world.gravity', [-30, 30]);
      const bounds = requested.bounds === undefined ? state.world.bounds : vector(requested.bounds, 'world.bounds', [.1, 60]);
      const duration = requested.duration === undefined ? state.world.duration : Number(requested.duration);
      if (!Number.isFinite(duration) || duration < 1 || duration > 30) throw new Error('INVALID_INPUT: world.duration must be between 1 and 30 seconds.');
      const environment = requested.environment === undefined ? state.world.environment : String(requested.environment).slice(0, 80);
      state.world = { gravity, bounds, duration, environment, timestepHz: 60, seed: 424242 };
    }
    state.phase = 'building';
    state.optimizationLevel = 0;
    state = designMutation(state, name, 'Design goal decomposed', actor, `${state.goal.machineName}: ${state.goal.capabilities.join(', ')}; ${state.goal.constraints.length} measured constraints.`);
    return { state, result: success(state, 'Design goal set.', state.goal) };
  }
  if (name === 'create_assembly') {
    const id = idValue(input.assembly_id, 'assembly_id');
    if (state.assemblies.some((item) => item.id === id)) throw new Error('CONSTRAINT_VIOLATION: assembly_id already exists.');
    if (input.parent_id) assembly(state, input.parent_id);
    const value: Assembly = { id, name: String(input.name ?? id).slice(0, 80), purpose: String(input.purpose ?? 'Mechanical subsystem').slice(0, 160), parentId: input.parent_id ? String(input.parent_id) : undefined, componentIds: [] };
    state.assemblies.push(value);
    state = designMutation(state, name, `${value.name} assembly created`, actor, `Created empty assembly “${value.name}”.`);
    return { state, result: success(state, 'Assembly created.', value) };
  }
  if (name === 'create_component') {
    if (!state.goal) throw new Error('INVALID_PHASE: set a design goal before creating bodies.');
    if (state.components.length >= state.goal.maxComponents) throw new Error('CONSTRAINT_VIOLATION: component budget reached.');
    const id = idValue(input.component_id, 'component_id');
    if (state.components.some((item) => item.id === id)) throw new Error('CONSTRAINT_VIOLATION: component_id already exists.');
    const primitive = String(input.primitive ?? '') as PrimitiveKind;
    const catalog = catalogFor(primitive);
    const targetAssembly = assembly(state, input.assembly_id);
    const size = dimensions(input.dimensions ?? catalog.defaultDimensions);
    const materialId = String(input.material_id ?? catalog.defaultMaterial);
    const material = materialFor(materialId);
    if (material.id !== materialId) throw new Error('INVALID_INPUT: material_id is not in the material library.');
    const bodyType = String(input.body_type ?? catalog.defaultBodyType) as BodyType;
    if (!['fixed', 'dynamic', 'kinematic'].includes(bodyType)) throw new Error('INVALID_INPUT: body_type must be fixed, dynamic, or kinematic.');
    const explicitMass = input.mass === undefined ? undefined : Number(input.mass);
    if (explicitMass !== undefined && (!Number.isFinite(explicitMass) || explicitMass <= 0 || explicitMass > 100000)) throw new Error('INVALID_INPUT: mass must be a positive finite value below 100000 kg.');
    const value: MachineComponent = {
      id, primitive, name: catalog.name, assemblyId: targetAssembly.id, role: String(input.role ?? catalog.name).slice(0, 80), shape: catalog.shape,
      position: position(input.position ?? [0, .5, 0], state), rotation: rotation(input.rotation ?? [0, 0, 0]), dimensions: size,
      materialId, mass: explicitMass ?? componentMass(primitive, size, materialId), bodyType, color: String(input.color ?? material.color ?? catalog.color).slice(0, 20),
      parameters: input.parameters && typeof input.parameters === 'object' ? clone(input.parameters as Record<string, number | string | boolean>) : {}, lastModifiedBy: actor, humanLockedFields: [],
    };
    state.components.push(value); targetAssembly.componentIds.push(id);
    state = designMutation(state, name, `${value.role} created`, actor, `Created ${primitive} “${id}” with ${value.materialId}, ${value.mass} kg, and ${value.dimensions.join(' × ')} m dimensions.`);
    return { state, result: success(state, 'Component created.', value) };
  }
  if (name === 'set_dimensions') {
    const target = component(state, input.component_id); lockField(state, target, 'dimensions', actor);
    const previousDimensions = [...target.dimensions] as Vec3;
    const previousMass = target.mass;
    target.dimensions = dimensions(input.dimensions);
    if (!target.humanLockedFields.includes('mass')) {
      const previousEnvelopeMass = componentMass(target.primitive, previousDimensions, target.materialId);
      const nextEnvelopeMass = componentMass(target.primitive, target.dimensions, target.materialId);
      target.mass = Number(Math.max(.05, previousMass * nextEnvelopeMass / Math.max(.05, previousEnvelopeMass)).toFixed(2));
    }
    state = designMutation(state, name, `${target.role} resized`, actor, `Set ${target.id} dimensions to ${target.dimensions.join(' × ')} m.`);
    return { state, result: success(state, 'Dimensions updated.', target) };
  }
  if (name === 'set_material') {
    const target = component(state, input.component_id); lockField(state, target, 'material', actor);
    const previousMaterial = materialFor(target.materialId);
    const previousMass = target.mass;
    const materialId = String(input.material_id ?? ''); const material = materialFor(materialId);
    if (material.id !== materialId) throw new Error('INVALID_INPUT: unknown material.');
    target.materialId = materialId; target.color = material.color;
    if (!target.humanLockedFields.includes('mass')) target.mass = Number(Math.max(.05, previousMass * material.density / Math.max(1, previousMaterial.density)).toFixed(2));
    state = designMutation(state, name, `${target.role} material changed`, actor, `Set ${target.id} to ${material.name}; mass scaled by material density to ${target.mass} kg.`);
    return { state, result: success(state, 'Material updated.', target) };
  }
  if (name === 'set_mass') {
    const target = component(state, input.component_id); lockField(state, target, 'mass', actor);
    const mass = Number(input.mass);
    if (!Number.isFinite(mass) || mass <= 0 || mass > 100000) throw new Error('INVALID_INPUT: mass must be positive and below 100000 kg.');
    target.mass = Number(mass.toFixed(3));
    state = designMutation(state, name, `${target.role} mass changed`, actor, `Set ${target.id} mass to ${target.mass} kg.`);
    return { state, result: success(state, 'Mass updated.', target) };
  }
  if (name === 'move_component') {
    const target = component(state, input.component_id); lockField(state, target, 'position', actor);
    const nextPosition = position(input.position, state);
    for (const mount of state.joints.filter((item) => item.componentA === target.id || item.componentB === target.id)) {
      const targetIsA = mount.componentA === target.id;
      const other = component(state, targetIsA ? mount.componentB : mount.componentA);
      const targetAnchor = targetIsA ? mount.anchorA : mount.anchorB;
      const relocatedWorldAnchor = localPointToWorld(nextPosition, target.rotation, targetAnchor);
      const relocatedOtherAnchor = worldPointToLocal(other.position, other.rotation, relocatedWorldAnchor);
      if (targetIsA) mount.anchorB = relocatedOtherAnchor; else mount.anchorA = relocatedOtherAnchor;
    }
    target.position = nextPosition;
    state = designMutation(state, name, `${target.role} moved`, actor, `${actor === 'Human' ? 'Human locked' : 'Moved'} ${target.id} at [${target.position.join(', ')}].`);
    if (actor === 'Human') state = addActivity(state, 'human_drag', `Shared geometry changed at revision ${state.revision}; the optimizer must preserve it.`, actor);
    return { state, result: success(state, 'Component moved.', target) };
  }
  if (name === 'rotate_component') {
    const target = component(state, input.component_id); lockField(state, target, 'rotation', actor);
    const nextRotation = rotation(input.rotation);
    for (const mount of state.joints.filter((item) => item.componentA === target.id || item.componentB === target.id)) {
      const targetIsA = mount.componentA === target.id;
      const other = component(state, targetIsA ? mount.componentB : mount.componentA);
      const otherAnchor = targetIsA ? mount.anchorB : mount.anchorA;
      const fixedWorldAnchor = localPointToWorld(other.position, other.rotation, otherAnchor);
      const rotatedTargetAnchor = worldPointToLocal(target.position, nextRotation, fixedWorldAnchor);
      if (targetIsA) mount.anchorA = rotatedTargetAnchor; else mount.anchorB = rotatedTargetAnchor;
    }
    target.rotation = nextRotation;
    state = designMutation(state, name, `${target.role} rotated`, actor, `${actor === 'Human' ? 'Human locked' : 'Rotated'} ${target.id}.`);
    return { state, result: success(state, 'Component rotated.', target) };
  }
  if (name === 'connect_components') {
    const source = component(state, input.source_id); const target = component(state, input.target_id);
    if (source.id === target.id) throw new Error('INVALID_TOPOLOGY: a component cannot connect to itself.');
    const type = String(input.connection_type ?? 'mechanical') as 'mechanical' | 'power' | 'signal';
    if (!['mechanical', 'power', 'signal'].includes(type)) throw new Error('INVALID_INPUT: unsupported connection_type.');
    if (state.connections.some((item) => item.sourceId === source.id && item.targetId === target.id && item.type === type)) throw new Error('CONSTRAINT_VIOLATION: connection already exists.');
    const value = { id: idValue(input.connection_id ?? `connection-${state.connections.length + 1}`, 'connection_id'), sourceId: source.id, targetId: target.id, type, channel: String(input.channel ?? type).slice(0, 48) };
    if (state.connections.some((item) => item.id === value.id)) throw new Error('CONSTRAINT_VIOLATION: connection_id already exists.');
    state.connections.push(value);
    state = designMutation(state, name, 'Component connection created', actor, `Connected ${source.id} → ${target.id} by ${type}.`);
    return { state, result: success(state, 'Components connected.', value) };
  }
  if (name === 'create_joint') {
    const a = component(state, input.component_a); const b = component(state, input.component_b);
    if (a.id === b.id) throw new Error('INVALID_TOPOLOGY: a joint needs two different bodies.');
    if (state.joints.some((item) => (item.componentA === a.id && item.componentB === b.id) || (item.componentA === b.id && item.componentB === a.id))) {
      throw new Error('INVALID_TOPOLOGY: the same body pair already has a joint; replace or edit that joint instead of overconstraining it.');
    }
    const id = idValue(input.joint_id, 'joint_id');
    if (state.joints.some((item) => item.id === id)) throw new Error('CONSTRAINT_VIOLATION: joint_id already exists.');
    const type = String(input.joint_type ?? '') as JointType;
    if (!['fixed', 'revolute', 'prismatic', 'spherical', 'spring', 'rope', 'gear', 'belt'].includes(type)) throw new Error('INVALID_INPUT: unsupported joint_type.');
    if (type !== 'fixed' && a.bodyType === 'fixed' && b.bodyType === 'fixed') throw new Error('INVALID_TOPOLOGY: a motion joint cannot connect two fixed bodies.');
    const rawAxis = vector(input.axis ?? [0, 1, 0], 'axis', [-1, 1]);
    const axisLength = Math.hypot(...rawAxis);
    if (axisLength < .5) throw new Error('INVALID_INPUT: joint axis must be non-zero.');
    const axis = rawAxis.map((value) => Number((value / axisLength).toFixed(5))) as Vec3;
    const limits = input.limits === undefined ? undefined : vector([...(input.limits as number[]), 0].slice(0, 3), 'limits', [-100, 100]).slice(0, 2) as [number, number];
    if (limits && limits[0] > limits[1]) throw new Error('INVALID_INPUT: joint limits are reversed.');
    const ratio = input.ratio === undefined ? undefined : Number(input.ratio);
    if ((type === 'gear' || type === 'belt') && (!ratio || !Number.isFinite(ratio) || ratio <= 0)) throw new Error('INVALID_INPUT: gear and belt joints require a positive ratio.');
    const stiffness = input.stiffness === undefined ? undefined : Number(input.stiffness);
    const damping = input.damping === undefined ? undefined : Number(input.damping);
    if ((stiffness !== undefined && (!Number.isFinite(stiffness) || stiffness < 0)) || (damping !== undefined && (!Number.isFinite(damping) || damping < 0))) throw new Error('INVALID_INPUT: stiffness and damping must be finite and non-negative.');
    const value = { id, type, componentA: a.id, componentB: b.id, anchorA: vector(input.anchor_a ?? [0, 0, 0], 'anchor_a', [-30, 30]), anchorB: vector(input.anchor_b ?? [0, 0, 0], 'anchor_b', [-30, 30]), axis, limits, ratio, stiffness, damping };
    state.joints.push(value);
    state = designMutation(state, name, `${type} joint created`, actor, `Joined ${a.id} ↔ ${b.id} with ${type} joint “${id}”.`);
    return { state, result: success(state, 'Joint created.', value) };
  }
  if (name === 'add_motor') {
    const target = component(state, input.component_id);
    const targetJoint = input.joint_id ? joint(state, input.joint_id) : undefined;
    const jointId = targetJoint?.id;
    if (target.primitive !== 'motor' && target.parameters.human_power_input !== true) throw new Error('INVALID_INPUT: add_motor targets a motor primitive or an explicitly modeled human-power input.');
    if (targetJoint) assertDrivenJoint(state, targetJoint, target.id, actor);
    else if (actor === 'WebMCP' && !driveBodyHasOutputInterface(state, target.id)) throw new Error('INVALID_TOPOLOGY: connect an unbound motor to its physical output before registering the drive.');
    const value = { id: idValue(input.motor_id, 'motor_id'), componentId: target.id, jointId, maxTorque: Number(input.max_torque), maxRpm: Number(input.max_rpm), direction: Number(input.direction ?? 1) };
    if (state.motors.some((item) => item.id === value.id)) throw new Error('CONSTRAINT_VIOLATION: motor_id already exists.');
    if (![value.maxTorque, value.maxRpm, value.direction].every(Number.isFinite) || value.maxTorque <= 0 || value.maxRpm <= 0) throw new Error('INVALID_INPUT: motor torque and rpm must be positive finite values.');
    state.motors.push(value);
    state = designMutation(state, name, 'Motor drive added', actor, `Motor ${value.id}: ${value.maxTorque} N·m at ${value.maxRpm} rpm.`);
    return { state, result: success(state, 'Motor added.', value) };
  }
  if (name === 'set_motor_speed') {
    const target = state.motors.find((item) => item.id === input.motor_id);
    if (!target) throw new Error(`INVALID_INPUT: motor “${String(input.motor_id)}” was not found.`);
    const maxRpm = Number(input.max_rpm); const direction = Number(input.direction);
    if (!Number.isFinite(maxRpm) || maxRpm <= 0 || maxRpm > 100000 || !Number.isFinite(direction) || direction < -1 || direction > 1) throw new Error('INVALID_INPUT: motor rpm and direction are outside the supported range.');
    target.maxRpm = maxRpm; target.direction = direction;
    state = designMutation(state, name, 'Motor speed retuned', actor, `Set ${target.id} to ${target.maxRpm} rpm with direction ${target.direction}.`);
    return { state, result: success(state, 'Motor speed updated.', target) };
  }
  if (name === 'add_sensor') {
    // A sensor channel may be integrated into any physical part (for example
    // a strain-gauged brake lever or an encoder inside a bearing). Dedicated
    // sensor/camera primitives remain available when a visible housing is
    // useful, but are not required for every embedded measurement.
    const target = component(state, input.component_id);
    if (input.target_id) component(state, input.target_id);
    const type = String(input.sensor_type ?? 'position') as SensorType;
    const allowed: SensorType[] = ['distance', 'position', 'angle', 'speed', 'load', 'force', 'imu', 'camera', 'color', 'light', 'limit', 'presence'];
    if (!allowed.includes(type)) throw new Error('INVALID_INPUT: unsupported sensor_type.');
    const value = { id: idValue(input.sensor_id, 'sensor_id'), componentId: target.id, type, channel: String(input.channel ?? type).slice(0, 48), targetId: input.target_id ? String(input.target_id) : undefined, range: Number(input.range ?? 4) };
    if (state.sensors.some((item) => item.id === value.id)) throw new Error('CONSTRAINT_VIOLATION: sensor_id already exists.');
    if (!Number.isFinite(value.range) || value.range <= 0 || value.range > 100) throw new Error('INVALID_INPUT: sensor range must be 0–100 m.');
    state.sensors.push(value);
    state = designMutation(state, name, 'Sensor channel added', actor, `${value.id} measures ${value.channel}${value.targetId ? ` on ${value.targetId}` : ''}.`);
    return { state, result: success(state, 'Sensor added.', value) };
  }
  if (name === 'set_sensor_range') {
    const target = state.sensors.find((item) => item.id === input.sensor_id);
    if (!target) throw new Error(`INVALID_INPUT: sensor “${String(input.sensor_id)}” was not found.`);
    const range = Number(input.range); if (!Number.isFinite(range) || range <= 0 || range > 100) throw new Error('INVALID_INPUT: sensor range must be 0–100 m.');
    target.range = range;
    state = designMutation(state, name, 'Sensor range retuned', actor, `Set ${target.id} range to ${target.range} m.`);
    return { state, result: success(state, 'Sensor range updated.', target) };
  }
  if (name === 'add_actuator') {
    const target = component(state, input.component_id); const targetJoint = joint(state, input.joint_id);
    if (!['motor', 'servo', 'piston'].includes(target.primitive)) throw new Error('INVALID_INPUT: actuator body must be motor, servo, or piston.');
    assertDrivenJoint(state, targetJoint, target.id, actor);
    const value = { id: idValue(input.actuator_id, 'actuator_id'), componentId: target.id, jointId: targetJoint.id, type: String(input.actuator_type ?? 'servo') as 'rotary-motor' | 'servo' | 'linear' | 'piston' | 'winch' | 'brake', maxForce: Number(input.max_force), maxSpeed: Number(input.max_speed), travel: Number(input.travel) };
    if (state.actuators.some((item) => item.id === value.id)) throw new Error('CONSTRAINT_VIOLATION: actuator_id already exists.');
    if (![value.maxForce, value.maxSpeed, value.travel].every(Number.isFinite) || value.maxForce <= 0 || value.maxSpeed <= 0 || value.travel <= 0) throw new Error('INVALID_INPUT: actuator limits must be positive finite values.');
    state.actuators.push(value);
    state = designMutation(state, name, 'Actuator added', actor, `${value.id} drives ${targetJoint.id} with ${value.maxForce} N limit.`);
    return { state, result: success(state, 'Actuator added.', value) };
  }
  if (name === 'set_actuator_timing') {
    const target = state.actuators.find((item) => item.id === input.actuator_id);
    if (!target) throw new Error(`INVALID_INPUT: actuator “${String(input.actuator_id)}” was not found.`);
    const maxSpeed = Number(input.max_speed); const travel = Number(input.travel);
    if (![maxSpeed, travel].every(Number.isFinite) || maxSpeed <= 0 || maxSpeed > 10000 || travel <= 0 || travel > 100) throw new Error('INVALID_INPUT: actuator speed and travel are outside the supported range.');
    target.maxSpeed = maxSpeed; target.travel = travel;
    state = designMutation(state, name, 'Actuator timing retuned', actor, `Set ${target.id} to ${target.maxSpeed} m/s over ${target.travel} m travel.`);
    return { state, result: success(state, 'Actuator timing updated.', target) };
  }
  if (name === 'set_control_logic') {
    const sensorIds = Array.isArray(input.sensor_ids) ? input.sensor_ids.map(String) : [];
    const actuatorIds = Array.isArray(input.actuator_ids) ? input.actuator_ids.map(String) : [];
    const motorIds = Array.isArray(input.motor_ids) ? input.motor_ids.map(String) : [];
    sensorIds.forEach((id) => { if (!state.sensors.some((item) => item.id === id)) throw new Error(`INVALID_INPUT: sensor “${id}” was not found.`); });
    actuatorIds.forEach((id) => { if (!state.actuators.some((item) => item.id === id)) throw new Error(`INVALID_INPUT: actuator “${id}” was not found.`); });
    motorIds.forEach((id) => { if (!state.motors.some((item) => item.id === id)) throw new Error(`INVALID_INPUT: motor “${id}” was not found.`); });
    if (!sensorIds.length) throw new Error('INVALID_TOPOLOGY: a closed-loop controller requires at least one sensor input.');
    if (!actuatorIds.length && !motorIds.length) throw new Error('INVALID_TOPOLOGY: a controller requires at least one actuator or motor output.');
    const mode = String(input.mode ?? 'pid') as ControlMode;
    if (!['pid', 'threshold', 'state-machine', 'tracking', 'timed', 'synchronized'].includes(mode)) throw new Error('INVALID_INPUT: unsupported control mode.');
    const firstSensor = state.sensors.find((item) => item.id === sensorIds[0]);
    const sensorBody = firstSensor ? state.components.find((item) => item.id === firstSensor.componentId) : undefined;
    const value = { id: idValue(input.control_id, 'control_id'), name: String(input.name ?? 'Controller').slice(0, 80), mode, sensorIds, actuatorIds, motorIds, expression: String(input.expression ?? 'hold measured state at setpoint').slice(0, 180), setpoint: Number(input.setpoint ?? 0), kp: Number(input.kp ?? .55), ki: Number(input.ki ?? .02), kd: Number(input.kd ?? .08), calibrationX: Number(input.calibration_x ?? sensorBody?.position[0] ?? 0) };
    if (state.controls.some((item) => item.id === value.id)) throw new Error('CONSTRAINT_VIOLATION: control_id already exists.');
    if (![value.setpoint, value.kp, value.ki, value.kd, value.calibrationX].every(Number.isFinite)) throw new Error('INVALID_INPUT: control values must be finite.');
    state.controls.push(value);
    state = designMutation(state, name, 'Control logic added', actor, `${value.mode} controller “${value.id}” connects ${sensorIds.length} sensor${sensorIds.length === 1 ? '' : 's'} to ${actuatorIds.length + motorIds.length} drive output${actuatorIds.length + motorIds.length === 1 ? '' : 's'}.`);
    return { state, result: success(state, 'Control logic set.', value) };
  }
  if (name === 'update_control_logic') {
    const target = state.controls.find((item) => item.id === input.control_id);
    if (!target) throw new Error(`INVALID_INPUT: control “${String(input.control_id)}” was not found.`);
    const setpoint = Number(input.setpoint), kp = Number(input.kp), ki = Number(input.ki), kd = Number(input.kd);
    if (![setpoint, kp, ki, kd].every(Number.isFinite) || [kp, ki, kd].some((value) => value < 0 || value > 10)) throw new Error('INVALID_INPUT: control values must be finite and PID gains must be 0–10.');
    target.expression = String(input.expression).slice(0, 180); target.setpoint = setpoint; target.kp = kp; target.ki = ki; target.kd = kd;
    state = designMutation(state, name, 'Control logic retuned', actor, `Updated ${target.id} setpoint and gains in place.`);
    return { state, result: success(state, 'Control logic updated.', target) };
  }
  if (name === 'optimize_design') {
    const latest = runFor(state, input.run_id);
    if (latest.status === 'passed') throw new Error('INVALID_PHASE: the latest design already satisfies every measured constraint.');
    if (latest.designHash !== state.designHash || latest.designRevision !== state.designRevision) throw new Error('STALE_RUN: the world changed after this run. Simulate the current design before optimizing it.');
    const actions = optimizationActions(state, latest);
    if (!actions.length) throw new Error('NO_CAUSAL_REDESIGN: no unlocked physical, control, or topology field can address the measured failure.');
    state.optimizationLevel += 1;
    state = designMutation(state, name, `Optimization pass ${state.optimizationLevel}`, actor, `Applied ${actions.length} bounded physical and control changes from failure evidence; human locks preserved.`);
    return { state, result: success(state, 'Design optimized.', { actions, objective_before: latest.objective, human_constraints_preserved: state.humanConstraints }) };
  }
  if (name === 'remove_joint') {
    const target = joint(state, input.joint_id);
    const removedActuators = new Set(state.actuators.filter((item) => item.jointId === target.id).map((item) => item.id));
    state.joints = state.joints.filter((item) => item.id !== target.id);
    state.motors = state.motors.filter((item) => item.jointId !== target.id);
    state.actuators = state.actuators.filter((item) => item.jointId !== target.id);
    state.controls = state.controls.map((item) => ({ ...item, actuatorIds: item.actuatorIds.filter((id) => !removedActuators.has(id)), motorIds: (item.motorIds ?? []).filter((id) => state.motors.some((motor) => motor.id === id)) })).filter((item) => item.sensorIds.length && (item.actuatorIds.length || (item.motorIds?.length ?? 0)));
    state = designMutation(state, name, `${target.type} joint removed`, actor, `Removed ${target.id} and dependent drives.`);
    return { state, result: success(state, 'Joint removed.') };
  }
  if (name === 'remove_component') {
    const target = component(state, input.component_id);
    if (target.humanLockedFields.length && actor !== 'Human') throw new Error('LOCKED_BY_HUMAN: the component contains human-authored fields.');
    const attachedJoints = state.joints.filter((item) => item.componentA === target.id || item.componentB === target.id).map((item) => item.id);
    const removedSensors = new Set(state.sensors.filter((item) => item.componentId === target.id || item.targetId === target.id).map((item) => item.id));
    const removedActuators = new Set(state.actuators.filter((item) => item.componentId === target.id || attachedJoints.includes(item.jointId)).map((item) => item.id));
    state.components = state.components.filter((item) => item.id !== target.id);
    state.assemblies.forEach((item) => { item.componentIds = item.componentIds.filter((id) => id !== target.id); });
    state.joints = state.joints.filter((item) => !attachedJoints.includes(item.id));
    state.connections = state.connections.filter((item) => item.sourceId !== target.id && item.targetId !== target.id);
    state.motors = state.motors.filter((item) => item.componentId !== target.id && (!item.jointId || !attachedJoints.includes(item.jointId)));
    state.sensors = state.sensors.filter((item) => item.componentId !== target.id && item.targetId !== target.id);
    state.actuators = state.actuators.filter((item) => item.componentId !== target.id && !attachedJoints.includes(item.jointId));
    state.controls = state.controls.map((item) => ({ ...item, sensorIds: item.sensorIds.filter((id) => !removedSensors.has(id)), actuatorIds: item.actuatorIds.filter((id) => !removedActuators.has(id)), motorIds: (item.motorIds ?? []).filter((id) => state.motors.some((motor) => motor.id === id)) })).filter((item) => item.sensorIds.length && (item.actuatorIds.length || (item.motorIds?.length ?? 0)));
    state.humanConstraints = state.humanConstraints.filter((item) => item.componentId !== target.id);
    state = designMutation(state, name, `${target.role} removed`, actor, `Removed ${target.id} and dependent graph edges.`);
    return { state, result: success(state, 'Component removed.') };
  }
  if (name === 'restore_revision') {
    const source = state.revisions.find((item) => item.revision === input.revision);
    if (!source) throw new Error('INVALID_INPUT: revision was not found.');
    const preserveHumanLocks = actor === 'WebMCP' || actor === 'ModelAgent' || actor === 'Deterministic' || actor === 'System';
    const currentLocks = new Map(preserveHumanLocks ? state.components.filter((item) => item.humanLockedFields.length).map((item) => [item.id, clone(item)]) : []);
    const currentConstraints = preserveHumanLocks ? clone(state.humanConstraints) : [];
    state.goal = clone(source.goal); state.world = clone(source.world); state.assemblies = clone(source.assemblies); state.components = clone(source.components); state.connections = clone(source.connections); state.joints = clone(source.joints); state.motors = clone(source.motors); state.sensors = clone(source.sensors); state.actuators = clone(source.actuators); state.controls = clone(source.controls); state.optimizationLevel = source.optimizationLevel;
    for (const [id, locked] of currentLocks) {
      let restored = state.components.find((item) => item.id === id);
      if (!restored) {
        const originalAssemblyId = current.components.find((item) => item.id === id)?.assemblyId;
        let targetAssembly = state.assemblies.find((item) => item.id === originalAssemblyId) ?? state.assemblies[0];
        if (!targetAssembly) {
          targetAssembly = { id: 'restored-human-assembly', name: 'Restored human assembly', purpose: 'Retains a human-authored body across history restore.', componentIds: [] };
          state.assemblies.push(targetAssembly);
        }
        restored = { ...clone(locked), assemblyId: targetAssembly.id };
        state.components.push(restored);
        if (!targetAssembly.componentIds.includes(id)) targetAssembly.componentIds.push(id);
      }
      for (const field of locked.humanLockedFields) {
        if (field === 'position') restored.position = clone(locked.position);
        if (field === 'rotation') restored.rotation = clone(locked.rotation);
        if (field === 'dimensions') { restored.dimensions = clone(locked.dimensions); restored.mass = locked.mass; }
        if (field === 'material') { restored.materialId = locked.materialId; restored.color = locked.color; restored.mass = locked.mass; }
        if (field === 'mass') restored.mass = locked.mass;
      }
      restored.humanLockedFields = clone(locked.humanLockedFields); restored.lastModifiedBy = 'Human';
    }
    state.humanConstraints = preserveHumanLocks
      ? currentConstraints.filter((item) => currentLocks.has(item.componentId)).map((item) => ({ ...item, fields: clone(currentLocks.get(item.componentId)!.humanLockedFields) }))
      : state.components.filter((item) => item.humanLockedFields.length).map((item) => ({ componentId: item.id, fields: clone(item.humanLockedFields), lockedForAgent: true, changedAtRevision: source.revision }));
    state = designMutation(state, name, `Revision ${source.revision} restored`, actor, preserveHumanLocks ? `Created a new head from revision ${source.revision}; current human locks were preserved.` : `Restored revision ${source.revision} exactly for the human editor.`);
    return { state, result: success(state, 'Revision restored.') };
  }
  if (name === 'run_simulation') throw new Error('INVALID_PHASE: run_simulation is asynchronous and must use the physics runner.');
  throw new Error(`INVALID_INPUT: unsupported tool ${name}.`);
}

export function markSimulationRunning(state: ForgeState, actor: Actor) {
  if (!state.goal || !state.components.length) throw new Error('INVALID_DESIGN: create a goal and physical bodies before running physics.');
  return addActivity({ ...state, phase: 'simulating' }, 'run_simulation', `Running ${state.components.length} Rapier bodies and ${state.joints.length} joint definitions at ${state.world.timestepHz} Hz.`, actor, 'running');
}

export function commitSimulation(state: ForgeState, run: SimulationRun, actor: Actor): { state: ForgeState; result: ToolResult } {
  if (run.designHash !== state.designHash || run.designRevision !== state.designRevision) throw new Error('STALE_RUN: simulation evidence does not match the current shared world.');
  let next: ForgeState = { ...state, phase: run.status, runs: [...state.runs, run].slice(-20), replayRunId: run.id, replayMode: run.status === 'failed' ? 'failure' : 'normal' };
  const label = run.status === 'passed' ? 'Passed' : run.status === 'partial' ? 'Partial' : 'Failed';
  next = addActivity(next, 'run_simulation', `${label} at ${run.evaluationLevel} fidelity with objective ${run.objective.toFixed(3)}; ${run.metrics.measures.filter((item) => item.status === 'pass').length}/${run.metrics.measures.length} measured targets pass.`, actor, run.status === 'failed' ? 'failed' : 'success');
  return { state: next, result: success(next, `Simulation ${run.status}.`, run) };
}

export function createCheckpoint(state: ForgeState, label: string) {
  let next: ForgeState = { ...state, revision: state.revision + 1 };
  next = addActivity(next, 'checkpoint', label, 'UI');
  next.revisions = [...next.revisions, snapshot(next, label, 'UI')].slice(-60);
  return next;
}

export function toggleUi(state: ForgeState, patch: Partial<Pick<ForgeState, 'screen' | 'selectedComponentId' | 'xray' | 'replayRunId' | 'replayMode' | 'compareOpen' | 'catalogOpen'>>) {
  return { ...state, ...patch };
}
