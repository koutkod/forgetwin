import { componentCatalog } from './forge-data';
import type { Actor, DesignSnapshot, ForgeState, ForgeToolName, MachineComponent, SimulationRun, ToolResult, Vec3 } from './forge-types';

const mutationTools = new Set<ForgeToolName>(['set_design_goal', 'add_component', 'move_component', 'rotate_component', 'connect_components', 'attach_sensor', 'attach_actuator', 'create_control_rule', 'set_motor_speed', 'set_actuator_timing', 'restore_revision']);

const clone = <T,>(value: T): T => structuredClone(value);
const componentIdFor = (catalogId: string) => ({ conveyor: 'conveyor-main', 'color-sensor': 'sensor-color', 'servo-diverter': 'diverter-servo' }[catalogId] ?? catalogId);
const now = () => new Date().toISOString();

function hashDesign(state: Pick<ForgeState, 'goal' | 'components' | 'connections' | 'sensorAttachments' | 'actuatorAttachments' | 'controlRules' | 'motorSpeed' | 'actuatorDelayMs' | 'actuatorHoldMs'>) {
  const goal = state.goal ? { throughputBpm: state.goal.throughputBpm, minAccuracyPct: state.goal.minAccuracyPct, maxComponents: state.goal.maxComponents, colors: state.goal.colors } : null;
  const payload = JSON.stringify({ goal, components: state.components.map(({ id, catalogId, position, rotation, humanLocked }) => ({ id, catalogId, position, rotation, humanLocked })), connections: state.connections, sensorAttachments: state.sensorAttachments, actuatorAttachments: state.actuatorAttachments, controlRules: state.controlRules, motorSpeed: state.motorSpeed, actuatorDelayMs: state.actuatorDelayMs, actuatorHoldMs: state.actuatorHoldMs });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) hash = Math.imul(hash ^ payload.charCodeAt(index), 16777619);
  return `design-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function activity(state: ForgeState, tool: ForgeToolName | 'human_drag' | 'checkpoint', detail: string, actor: Actor, outcome: 'success' | 'failed' | 'running' | 'read' = 'success') {
  const seq = state.activitySeq + 1;
  return { ...state, activitySeq: seq, activity: [{ id: `activity-${seq}`, seq, tool, detail, actor, outcome, at: now() }, ...state.activity].slice(0, 80) };
}

function snapshot(state: ForgeState, label: string, actor: Actor): DesignSnapshot {
  return {
    id: `revision-${state.revision}`,
    revision: state.revision,
    designRevision: state.designRevision,
    label,
    actor,
    at: now(),
    designHash: state.designHash,
    components: clone(state.components),
    connections: clone(state.connections),
    sensorAttachments: clone(state.sensorAttachments),
    actuatorAttachments: clone(state.actuatorAttachments),
    controlRules: clone(state.controlRules),
    goal: clone(state.goal),
    motorSpeed: state.motorSpeed,
    actuatorDelayMs: state.actuatorDelayMs,
    actuatorHoldMs: state.actuatorHoldMs,
    metrics: state.runs.at(-1)?.metrics ?? null,
  };
}

function success(state: ForgeState, message: string, data?: unknown): ToolResult {
  return { ok: true, workspace_id: state.workspaceId, workspace_nonce: state.workspaceNonce, revision: state.revision, design_revision: state.designRevision, design_hash: state.designHash, message, data };
}

function assertGuard(state: ForgeState, input: Record<string, unknown>) {
  if (input.expected_workspace_nonce !== state.workspaceNonce) throw new Error('WRONG_WORKSPACE: inspect the active workspace and retry with its nonce.');
  if (input.expected_revision !== state.revision) throw new Error(`STALE_REVISION: expected revision ${state.revision}. Inspect shared state before retrying.`);
}

function designMutation(state: ForgeState, tool: ForgeToolName, label: string, actor: Actor, detail: string) {
  let next: ForgeState = { ...state, revision: state.revision + 1, designRevision: state.designRevision + 1, phase: state.components.length ? 'ready' : 'building', replayRunId: null };
  next.designHash = hashDesign(next);
  next = activity(next, tool, detail, actor);
  next.revisions = [...next.revisions, snapshot(next, label, actor)].slice(-30);
  return next;
}

function boundedPosition(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) throw new Error('INVALID_INPUT: position must contain three finite numbers.');
  const position = value as Vec3;
  if (position[0] < -5 || position[0] > 5 || position[1] < 0 || position[1] > 3 || position[2] < -3 || position[2] > 3) throw new Error('CONSTRAINT_VIOLATION: position is outside the engineering workspace.');
  return position.map((item) => Number(item.toFixed(2))) as Vec3;
}

function boundedRotation(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) throw new Error('INVALID_INPUT: rotation must contain three finite numbers.');
  const rotation = value as Vec3;
  if (rotation.some((item) => Math.abs(item) > Math.PI * 2)) throw new Error('CONSTRAINT_VIOLATION: rotation exceeds the bounded Euler range.');
  return rotation.map((item) => Number(item.toFixed(4))) as Vec3;
}

function findComponent(state: ForgeState, id: unknown) {
  const component = state.components.find((item) => item.id === id);
  if (!component) throw new Error('INVALID_INPUT: component was not found in the active design.');
  return component;
}

export function applyForgeTool(current: ForgeState, name: ForgeToolName, input: Record<string, unknown>, actor: Actor): { state: ForgeState; result: ToolResult } {
  let state = clone(current);
  if (mutationTools.has(name)) assertGuard(state, input);

  if (name === 'inspect_workspace') {
    const sinceRevision = typeof input.since_revision === 'number' ? input.since_revision : null;
    state = activity(state, name, `Inspected revision ${state.revision}; ${state.components.length} components and ${state.humanConstraints.length} human constraint${state.humanConstraints.length === 1 ? '' : 's'} visible.`, actor, 'read');
    return { state, result: success(state, 'Workspace inspected.', { phase: state.phase, goal: state.goal, components: state.components, connections: state.connections, sensor_attachments: state.sensorAttachments, actuator_attachments: state.actuatorAttachments, control_rules: state.controlRules, motor_speed: state.motorSpeed, actuator_delay_ms: state.actuatorDelayMs, actuator_hold_ms: state.actuatorHoldMs, latest_run: state.runs.at(-1) ? { id: state.runs.at(-1)!.id, status: state.runs.at(-1)!.status, metrics: state.runs.at(-1)!.metrics } : null, human_constraints: state.humanConstraints, changes_since_revision: sinceRevision === null ? [] : state.revisions.filter((item) => item.revision > sinceRevision).map((item) => ({ revision: item.revision, label: item.label, actor: item.actor })) }) };
  }
  if (name === 'inspect_component_catalog') {
    state = activity(state, name, `Inspected ${componentCatalog.length} validated catalog components.`, actor, 'read');
    return { state, result: success(state, 'Component catalog inspected.', { catalog_version: '2026.08', components: componentCatalog }) };
  }
  if (name === 'inspect_telemetry') {
    const run = state.runs.find((item) => item.id === input.run_id) ?? state.runs.at(-1);
    if (!run) throw new Error('INVALID_PHASE: run the simulation before inspecting telemetry.');
    state = activity(state, name, `Measured ${run.sensorToDiverterMs} ms sensor-to-diverter travel; recommended ${run.recommendedDelayMs} ms command delay.`, actor, 'read');
    return { state, result: success(state, 'Telemetry inspected.', { run_id: run.id, sensor_to_diverter_ms: run.sensorToDiverterMs, servo_settle_ms: 125, recommended_delay_ms: run.recommendedDelayMs, metrics: run.metrics, samples: run.telemetry.slice(0, 80) }) };
  }
  if (name === 'get_failure_events') {
    const run = state.runs.find((item) => item.id === input.run_id) ?? state.runs.at(-1);
    if (!run) throw new Error('INVALID_PHASE: no simulation run exists.');
    state = activity(state, name, `Found ${run.failures.length} measured failure event${run.failures.length === 1 ? '' : 's'}.`, actor, 'read');
    return { state, result: success(state, 'Failure events inspected.', run.failures.slice(0, 30)) };
  }
  if (name === 'inspect_collisions') {
    const run = state.runs.find((item) => item.id === input.run_id) ?? state.runs.at(-1);
    if (!run) throw new Error('INVALID_PHASE: no simulation run exists.');
    state = activity(state, name, `Inspected ${run.collisions.length} harmful collision${run.collisions.length === 1 ? '' : 's'} from Rapier body poses.`, actor, 'read');
    return { state, result: success(state, 'Collisions inspected.', run.collisions.slice(0, 30)) };
  }
  if (name === 'compare_designs') {
    const a = state.revisions.find((item) => item.revision === input.revision_a) ?? state.revisions.at(0);
    const b = state.revisions.find((item) => item.revision === input.revision_b) ?? state.revisions.at(-1);
    if (!a || !b) throw new Error('INVALID_INPUT: two saved design revisions are required.');
    const componentMoves = b.components.flatMap((component) => {
      const before = a.components.find((item) => item.id === component.id);
      return before && JSON.stringify(before.position) !== JSON.stringify(component.position) ? [{ id: component.id, from: before.position, to: component.position, actor: component.lastModifiedBy }] : [];
    });
    state = activity(state, name, `Compared revision ${a.revision} with ${b.revision}.`, actor, 'read');
    return { state, result: success(state, 'Designs compared.', { from: a, to: b, changes: { component_delta: b.components.length - a.components.length, timing_delta_ms: b.actuatorDelayMs - a.actuatorDelayMs, motor_speed_delta: b.motorSpeed - a.motorSpeed, component_moves: componentMoves } }) };
  }

  if (name === 'set_design_goal') {
    const throughputBpm = Number(input.throughput_bpm);
    const minAccuracyPct = Number(input.min_accuracy_pct);
    const maxComponents = Number(input.max_components);
    if (!Number.isFinite(throughputBpm) || throughputBpm < 5 || throughputBpm > 40) throw new Error('CONSTRAINT_VIOLATION: throughput must be 5–40 boxes/min for this validated cell.');
    if (!Number.isFinite(minAccuracyPct) || minAccuracyPct < 50 || minAccuracyPct > 100) throw new Error('CONSTRAINT_VIOLATION: accuracy must be 50–100%.');
    if (!Number.isInteger(maxComponents) || maxComponents < 7 || maxComponents > 12) throw new Error('CONSTRAINT_VIOLATION: the two-lane sorter requires a 7–12 component budget.');
    const brief = typeof input.brief === 'string' && input.brief.trim() ? input.brief.trim().slice(0, 500) : undefined;
    state.goal = { throughputBpm, minAccuracyPct, maxComponents, colors: ['red', 'blue'], brief };
    state.phase = 'building';
    state = designMutation(state, name, 'Design goal set', actor, `Target locked: ≥${throughputBpm} boxes/min, ≥${minAccuracyPct}% accuracy, ≤${maxComponents} components.`);
    return { state, result: success(state, 'Design goal set.', state.goal) };
  }
  if (name === 'add_component') {
    const catalogId = String(input.catalog_id ?? '');
    const item = componentCatalog.find((candidate) => candidate.catalogId === catalogId);
    if (!item) throw new Error('INVALID_INPUT: catalog component does not exist.');
    if (!state.goal) throw new Error('INVALID_PHASE: set the design goal before adding components.');
    if (state.components.length >= state.goal.maxComponents) throw new Error('CONSTRAINT_VIOLATION: the component limit has been reached.');
    if (state.components.filter((component) => component.catalogId === catalogId).length >= item.quantityLimit) throw new Error('CONSTRAINT_VIOLATION: catalog quantity limit reached.');
    const position = input.position ? boundedPosition(input.position) : item.defaultPosition;
    const component: MachineComponent = { id: componentIdFor(catalogId), catalogId, name: item.name, kind: item.kind, position, rotation: item.defaultRotation, color: item.color, parameters: {}, lastModifiedBy: actor, humanLocked: false };
    state.components.push(component);
    state = designMutation(state, name, `${item.name} added`, actor, `Placed ${item.name} at [${position.join(', ')}].`);
    return { state, result: success(state, `${item.name} added.`, component) };
  }
  if (name === 'move_component') {
    const component = findComponent(state, input.component_id);
    if (component.humanLocked && actor !== 'Human') throw new Error('LOCKED_BY_HUMAN: preserve the human-positioned component and retune around it.');
    component.position = boundedPosition(input.position);
    component.lastModifiedBy = actor;
    if (actor === 'Human') {
      component.humanLocked = true;
      state.humanConstraints = [...state.humanConstraints.filter((item) => item.componentId !== component.id), { componentId: component.id, fields: ['position'], lockedForAgent: true, changedAtRevision: state.revision + 1 }];
    }
    state = designMutation(state, name, `${component.name} moved`, actor, `${actor === 'Human' ? 'Human moved and locked' : 'Moved'} ${component.name} to x ${component.position[0].toFixed(2)} m.`);
    if (actor === 'Human') state = activity(state, 'human_drag', `Manual change detected at revision ${state.revision}; sensor position preserved for agent retuning.`, actor);
    return { state, result: success(state, `${component.name} moved.`, { component, human_constraint: component.humanLocked }) };
  }
  if (name === 'rotate_component') {
    const component = findComponent(state, input.component_id);
    if (component.humanLocked && actor !== 'Human') throw new Error('LOCKED_BY_HUMAN: preserve the human transform.');
    component.rotation = boundedRotation(input.rotation);
    component.lastModifiedBy = actor;
    state = designMutation(state, name, `${component.name} rotated`, actor, `Rotated ${component.name}.`);
    return { state, result: success(state, `${component.name} rotated.`, component) };
  }
  if (name === 'connect_components') {
    const source = findComponent(state, input.source_id);
    const target = findComponent(state, input.target_id);
    const sourceCatalog = componentCatalog.find((item) => item.catalogId === source.catalogId)!;
    const targetCatalog = componentCatalog.find((item) => item.catalogId === target.catalogId)!;
    const sourcePort = sourceCatalog.ports.find((item) => item.id === input.source_port && item.direction === 'output');
    const targetPort = targetCatalog.ports.find((item) => item.id === input.target_port && item.direction === 'input');
    if (!sourcePort || !targetPort || sourcePort.type !== targetPort.type) throw new Error('INVALID_TOPOLOGY: ports are missing or incompatible.');
    if (state.connections.some((item) => item.sourceId === source.id && item.targetId === target.id && item.sourcePort === sourcePort.id)) throw new Error('CONSTRAINT_VIOLATION: connection already exists.');
    state.connections.push({ id: `connection-${state.connections.length + 1}`, sourceId: source.id, sourcePort: sourcePort.id, targetId: target.id, targetPort: targetPort.id, type: sourcePort.type });
    state = designMutation(state, name, 'Control connection created', actor, `Connected ${source.name} → ${target.name} (${sourcePort.type}).`);
    return { state, result: success(state, 'Components connected.', state.connections.at(-1)) };
  }
  if (name === 'attach_sensor') {
    const sensor = findComponent(state, input.sensor_id);
    if (sensor.kind !== 'color_sensor' && sensor.kind !== 'proximity_sensor') throw new Error('INVALID_INPUT: target is not a sensor.');
    state.sensorAttachments = [...state.sensorAttachments.filter((item) => item.sensorId !== sensor.id), { sensorId: sensor.id, channel: input.channel === 'presence' ? 'presence' : 'color', targetZone: String(input.target_zone ?? 'conveyor-main'), range: Math.min(2, Math.max(0.1, Number(input.range ?? 1.4))) }];
    state = designMutation(state, name, 'Sensor attached', actor, `${sensor.name} now observes the conveyor decision lane.`);
    return { state, result: success(state, 'Sensor attached.', state.sensorAttachments.at(-1)) };
  }
  if (name === 'attach_actuator') {
    const actuator = findComponent(state, input.actuator_id);
    if (actuator.kind !== 'servo_diverter') throw new Error('INVALID_INPUT: target is not a compatible actuator.');
    state.actuatorAttachments = [...state.actuatorAttachments.filter((item) => item.actuatorId !== actuator.id), { actuatorId: actuator.id, targetId: String(input.target_id ?? actuator.id), axis: input.axis === 'x' || input.axis === 'z' ? input.axis : 'y', travelDegrees: Math.min(60, Math.max(10, Number(input.travel_degrees ?? 32))) }];
    state = designMutation(state, name, 'Actuator attached', actor, 'Bound servo diverter to a constrained ±32° rotary path.');
    return { state, result: success(state, 'Actuator attached.', state.actuatorAttachments.at(-1)) };
  }
  if (name === 'create_control_rule') {
    const sensor = findComponent(state, input.sensor_id);
    const actuator = findComponent(state, input.actuator_id);
    const condition = input.condition === 'blue' ? 'blue' : 'red';
    state.controlRules = [...state.controlRules.filter((item) => item.condition !== condition), { id: `rule-${condition}`, sensorId: sensor.id, condition, actuatorId: actuator.id, targetAngle: condition === 'red' ? -32 : 32, priority: Number(input.priority ?? 1) }];
    state = designMutation(state, name, `${condition} route rule created`, actor, `${condition} signal routes the diverter to ${condition === 'red' ? '−32°' : '+32°'}.`);
    return { state, result: success(state, 'Control rule created.', state.controlRules.at(-1)) };
  }
  if (name === 'set_motor_speed') {
    findComponent(state, input.component_id);
    const speed = Number(input.speed_mps);
    if (!Number.isFinite(speed) || speed < 0.3 || speed > 3) throw new Error('CONSTRAINT_VIOLATION: belt speed must be 0.3–3.0 m/s.');
    state.motorSpeed = Number(speed.toFixed(2));
    state = designMutation(state, name, 'Conveyor speed tuned', actor, `Set belt velocity to ${state.motorSpeed.toFixed(2)} m/s.`);
    return { state, result: success(state, 'Motor speed set.', { speed_mps: state.motorSpeed }) };
  }
  if (name === 'set_actuator_timing') {
    findComponent(state, input.actuator_id);
    const delay = Number(input.delay_ms);
    const hold = Number(input.hold_ms ?? state.actuatorHoldMs);
    if (!Number.isFinite(delay) || delay < 120 || delay > 2200 || !Number.isFinite(hold) || hold < 300 || hold > 1400) throw new Error('CONSTRAINT_VIOLATION: actuator timing is outside the catalog-safe envelope.');
    state.actuatorDelayMs = Math.round(delay);
    state.actuatorHoldMs = Math.round(hold);
    state = designMutation(state, name, 'Actuator timing retuned', actor, `Set diverter delay to ${state.actuatorDelayMs} ms; sensor position unchanged.`);
    return { state, result: success(state, 'Actuator timing set.', { delay_ms: state.actuatorDelayMs, hold_ms: state.actuatorHoldMs }) };
  }
  if (name === 'restore_revision') {
    const restored = state.revisions.find((item) => item.revision === input.revision);
    if (!restored) throw new Error('INVALID_INPUT: revision was not found.');
    const humanLocked = state.components.filter((item) => item.humanLocked);
    state = { ...state, goal: clone(restored.goal), components: clone(restored.components), connections: clone(restored.connections), sensorAttachments: clone(restored.sensorAttachments), actuatorAttachments: clone(restored.actuatorAttachments), controlRules: clone(restored.controlRules), motorSpeed: restored.motorSpeed, actuatorDelayMs: restored.actuatorDelayMs, actuatorHoldMs: restored.actuatorHoldMs };
    for (const locked of humanLocked) {
      const index = state.components.findIndex((item) => item.id === locked.id);
      if (index >= 0) state.components[index] = clone(locked);
    }
    state = designMutation(state, name, `Restored revision ${restored.revision}`, actor, `Restored design while preserving ${humanLocked.length} human-locked transform${humanLocked.length === 1 ? '' : 's'}.`);
    return { state, result: success(state, 'Revision restored as a new head.', { restored_revision: restored.revision, preserved_human_constraints: humanLocked.map((item) => item.id) }) };
  }
  throw new Error(`INVALID_INPUT: unsupported tool ${name}.`);
}

export function markSimulationRunning(current: ForgeState, actor: Actor) {
  return activity({ ...current, phase: 'simulating' }, 'run_simulation', 'Rapier world running at a fixed 60 Hz timestep with seed 424242.', actor, 'running');
}

export function commitSimulation(current: ForgeState, run: SimulationRun, actor: Actor) {
  if (run.designHash !== current.designHash || run.designRevision !== current.designRevision) throw new Error('STALE_SIMULATION: the design changed while physics was running.');
  let state: ForgeState = { ...current, revision: current.revision + 1, phase: run.status, runs: [...current.runs, run].slice(-8), replayRunId: run.id, replayMode: run.status === 'failed' ? 'failure' : 'normal' };
  state = activity(state, 'run_simulation', `${run.status === 'passed' ? 'Goal passed' : 'Trial failed'}: ${run.metrics.throughput} boxes/min, ${run.metrics.accuracy}% accuracy, ${run.metrics.collisions} collisions, ${run.metrics.jams} jams.`, actor);
  const latestRevision = state.revisions.at(-1);
  if (latestRevision) latestRevision.metrics = clone(run.metrics);
  return { state, result: success(state, `Simulation ${run.status}.`, { run_id: run.id, status: run.status, metrics: run.metrics, failures: run.failures, physics: run.physics }) };
}

export function createCheckpoint(current: ForgeState, label: string) {
  const state = activity({ ...current, revision: current.revision + 1 }, 'checkpoint', label, 'UI');
  state.revisions = [...state.revisions, snapshot(state, label, 'UI')].slice(-30);
  return state;
}

export function toggleUi(current: ForgeState, patch: Partial<Pick<ForgeState, 'screen' | 'xray' | 'selectedComponentId' | 'replayRunId' | 'replayMode' | 'compareOpen' | 'catalogOpen'>>) {
  return { ...current, ...patch };
}
