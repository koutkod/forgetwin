'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { createInitialForgeState } from './forge-data';
import { applyForgeTool, commitSimulation, createCheckpoint, markSimulationRunning, toggleUi } from './forge-engine';
import { simulateDesign } from './forge-simulation';
import type { Actor, ForgeState, ForgeToolName, ToolResult, Vec3 } from './forge-types';

export const STORAGE_KEY = 'forgetwin-workspace-v3';
const revision = z.number().int().nonnegative();
const nonce = z.string().min(8).max(100);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const guard = { expected_revision: revision, expected_workspace_nonce: nonce };
const parameter = z.union([z.string().max(120), z.number().finite(), z.boolean()]);
const constraint = z.object({ metric: key, label: z.string().min(1).max(80), operator: z.enum(['min', 'max', 'exact']), target: z.number().finite().nonnegative(), unit: z.string().max(12), source: z.enum(['user', 'inferred']) }).strict();
const capabilities = z.enum(['structure', 'transport', 'classify', 'lift', 'suspend', 'mobile', 'manipulate', 'transmit', 'stabilize', 'track', 'buffer', 'contain', 'rotate', 'measure']);

export const schemas = {
  inspect_workspace: z.object({ since_revision: revision.optional() }).strict(),
  inspect_primitive_catalog: z.object({ query: z.string().max(40).optional() }).strict(),
  set_design_goal: z.object({ machine_name: z.string().min(3).max(80), domain: z.string().min(2).max(80), brief: z.string().trim().min(12).max(500), summary: z.string().max(240).optional(), capabilities: z.array(capabilities).min(1).max(14), constraints: z.array(constraint).min(1).max(12), max_components: z.number().int().min(1).max(80), assumptions: z.array(z.string().max(180)).max(16).optional(), disclaimer: z.string().max(240).optional(), simulation_model: z.string().max(160).optional(), editable_component_id: id.optional(), editable_label: z.string().max(80).optional(), world: z.object({ gravity: z.tuple([z.number().min(-30).max(30), z.number().min(-30).max(30), z.number().min(-30).max(30)]).optional(), duration: z.number().min(1).max(30).optional(), bounds: z.tuple([z.number().positive().max(60), z.number().positive().max(60), z.number().positive().max(60)]).optional(), environment: z.string().max(80).optional() }).strict().optional(), ...guard }).strict(),
  create_assembly: z.object({ assembly_id: id, name: z.string().min(1).max(80), purpose: z.string().min(1).max(160), parent_id: id.optional(), ...guard }).strict(),
  create_component: z.object({ component_id: id, primitive: z.enum(['beam', 'plate', 'frame', 'wheel', 'shaft', 'gear', 'pulley', 'belt', 'motor', 'servo', 'piston', 'spring', 'sensor', 'camera', 'conveyor', 'ramp', 'gripper', 'container', 'counterweight', 'support', 'controller', 'cable', 'hook', 'roller']), assembly_id: id, role: z.string().min(1).max(80), position: vec3, rotation: vec3, dimensions: vec3, material_id: id, body_type: z.enum(['fixed', 'dynamic', 'kinematic']), mass: z.number().finite().positive().max(100000).optional(), color: z.string().max(20).optional(), parameters: z.record(z.string(), parameter).optional(), ...guard }).strict(),
  set_dimensions: z.object({ component_id: id, dimensions: vec3, ...guard }).strict(),
  set_material: z.object({ component_id: id, material_id: id, ...guard }).strict(),
  set_mass: z.object({ component_id: id, mass: z.number().finite().positive().max(100000), ...guard }).strict(),
  move_component: z.object({ component_id: id, position: vec3, ...guard }).strict(),
  rotate_component: z.object({ component_id: id, rotation: vec3, ...guard }).strict(),
  connect_components: z.object({ connection_id: id.optional(), source_id: id, target_id: id, connection_type: z.enum(['mechanical', 'power', 'signal']), channel: key, ...guard }).strict(),
  create_joint: z.object({ joint_id: id, joint_type: z.enum(['fixed', 'revolute', 'prismatic', 'spherical', 'spring', 'rope', 'gear', 'belt']), component_a: id, component_b: id, anchor_a: vec3, anchor_b: vec3, axis: vec3, limits: z.tuple([z.number().finite(), z.number().finite()]).optional(), ratio: z.number().finite().positive().optional(), stiffness: z.number().finite().positive().optional(), damping: z.number().finite().nonnegative().optional(), ...guard }).strict(),
  add_motor: z.object({ motor_id: id, component_id: id, joint_id: id.optional(), max_torque: z.number().finite().positive(), max_rpm: z.number().finite().positive(), direction: z.number().finite().min(-1).max(1).optional(), ...guard }).strict(),
  add_sensor: z.object({ sensor_id: id, component_id: id, sensor_type: z.enum(['distance', 'position', 'angle', 'speed', 'load', 'force', 'imu', 'camera', 'color', 'light', 'limit', 'presence']), channel: key, target_id: id.optional(), range: z.number().finite().positive().max(100), ...guard }).strict(),
  add_actuator: z.object({ actuator_id: id, component_id: id, joint_id: id, actuator_type: z.enum(['rotary-motor', 'servo', 'linear', 'piston', 'winch']), max_force: z.number().finite().positive(), max_speed: z.number().finite().positive(), travel: z.number().finite().positive(), ...guard }).strict(),
  set_control_logic: z.object({ control_id: id, name: z.string().min(1).max(80), mode: z.enum(['pid', 'threshold', 'state-machine', 'tracking', 'timed', 'synchronized']), sensor_ids: z.array(id).max(12), actuator_ids: z.array(id).max(12), expression: z.string().min(1).max(180), setpoint: z.number().finite(), kp: z.number().finite().min(0).max(10), ki: z.number().finite().min(0).max(10), kd: z.number().finite().min(0).max(10), calibration_x: z.number().finite().min(-60).max(60).optional(), ...guard }).strict(),
  run_simulation: z.object(guard).strict(),
  inspect_telemetry: z.object({ run_id: z.string().max(80).optional() }).strict(),
  inspect_failure: z.object({ run_id: z.string().max(80).optional() }).strict(),
  measure_constraint: z.object({ run_id: z.string().max(80).optional(), metric: key }).strict(),
  optimize_design: z.object({ run_id: z.string().max(80).optional(), objective: z.string().max(120).optional(), ...guard }).strict(),
  remove_component: z.object({ component_id: id, ...guard }).strict(),
  remove_joint: z.object({ joint_id: id, ...guard }).strict(),
  compare_designs: z.object({ revision_a: revision, revision_b: revision }).strict(),
  restore_revision: z.object({ revision, ...guard }).strict(),
} satisfies Record<ForgeToolName, z.ZodType<Record<string, unknown>>>;

export const FORGE_TOOL_COUNT = Object.keys(schemas).length;
const readTools = new Set<ForgeToolName>(['inspect_workspace', 'inspect_primitive_catalog', 'inspect_telemetry', 'inspect_failure', 'measure_constraint', 'compare_designs']);
const guardedTools = new Set<ForgeToolName>([...Object.keys(schemas).filter((name) => !readTools.has(name as ForgeToolName)) as ForgeToolName[]]);

const descriptions: Record<ForgeToolName, string> = {
  inspect_workspace: 'Read the complete shared physical world: assemblies, bodies, dimensions, materials, masses, joints, devices, controls, revisions, and human locks.',
  inspect_primitive_catalog: 'Inspect reusable low-level primitives and material properties. Complete machines are not catalog entries.',
  set_design_goal: 'Create a free-form engineering goal with typed constraints and composable capabilities; no profile or machine template is selected.',
  create_assembly: 'Create an empty mechanical subsystem that can contain arbitrary physical bodies.',
  create_component: 'Create one physical body from a reusable primitive with explicit geometry, transform, material, mass, and rigid-body mode.',
  set_dimensions: 'Resize one body and recalculate mass from material density unless mass is human-locked.',
  set_material: 'Change one body material and its friction, strength proxy, color, and density-derived mass.',
  set_mass: 'Set an explicit body mass for payloads, counterweights, or calibrated mechanisms.',
  move_component: 'Move any body in the shared world while preserving human-locked transforms.',
  rotate_component: 'Rotate any body in the shared world while preserving human-locked transforms.',
  connect_components: 'Create a declared mechanical, power, or signal graph edge between two bodies.',
  create_joint: 'Create a fixed, revolute, prismatic, spherical, spring, rope, gear, or belt joint with anchors, axis, limits, and physical parameters.',
  add_motor: 'Attach a torque- and rpm-limited motor to a physical motor body and optional joint.',
  add_sensor: 'Register a typed measurement channel on a sensor or camera body.',
  add_actuator: 'Bind a per-joint rotary, servo, linear, piston, or winch actuator with force, speed, and travel limits.',
  set_control_logic: 'Create bounded declarative PID, tracking, synchronized, threshold, timed, or state-machine logic between device IDs.',
  run_simulation: 'Instantiate the current bodies and supported joints in a fixed-step Rapier world and capture telemetry, replay, contacts, and measured constraints.',
  inspect_telemetry: 'Read physics configuration, time-series channels, constraint evidence, objective, and recommended changes.',
  inspect_failure: 'Read causal failed constraints, involved component IDs, evidence channels, contacts, and bounded redesign recommendations.',
  measure_constraint: 'Read one measured constraint with value, target, unit, status, and its physical provenance.',
  optimize_design: 'Apply a bounded evidence-driven redesign to unlocked material, geometry, mass, motor, actuator, spring, and controller fields.',
  remove_component: 'Remove one physical body and its dependent joints and devices for topology redesign.',
  remove_joint: 'Remove one joint and dependent drives for topology redesign.',
  compare_designs: 'Compare two immutable world revisions by topology, physical mass, measurements, and optimization level.',
  restore_revision: 'Create a new head revision from an earlier world while preserving current human-locked fields.',
};

const persistedState = z.object({ schemaVersion: z.literal(3), workspaceId: z.string(), workspaceNonce: nonce, revision, designRevision: revision, assemblies: z.array(z.unknown()), components: z.array(z.unknown()), joints: z.array(z.unknown()), runs: z.array(z.unknown()), revisions: z.array(z.unknown()), activity: z.array(z.unknown()) }).passthrough();

function hydrate(): ForgeState {
  if (typeof window === 'undefined') return createInitialForgeState();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (persistedState.safeParse(parsed).success) return parsed as ForgeState;
  } catch { /* Corrupt or unavailable storage falls back to a deterministic world. */ }
  return createInitialForgeState();
}

function failure(state: ForgeState, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : 'The tool could not run.';
  const [candidate, ...rest] = message.split(': ');
  const code = /^[A-Z_]+$/.test(candidate) ? candidate : error instanceof z.ZodError ? 'INVALID_INPUT' : 'INVALID_STATE';
  return { ok: false, workspace_id: state.workspaceId, workspace_nonce: state.workspaceNonce, revision: state.revision, error: { code, message: error instanceof z.ZodError ? 'Arguments did not match the controlled world-tool schema.' : rest.join(': ') || message } };
}

export function useForge() {
  const [state, setState] = useState<ForgeState>(createInitialForgeState);
  const stateRef = useRef(state);

  useEffect(() => {
    const timeout = window.setTimeout(() => { const loaded = hydrate(); stateRef.current = loaded; setState(loaded); }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const commit = useCallback((next: ForgeState) => {
    stateRef.current = next; setState(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep the in-memory shared state usable. */ }
  }, []);
  const getSnapshot = useCallback(() => stateRef.current, []);

  const command = useCallback((name: ForgeToolName, rawInput: Record<string, unknown> = {}, actor: Actor = 'UI'): ToolResult => {
    const current = stateRef.current;
    try {
      const enriched = guardedTools.has(name) && actor !== 'WebMCP' ? { ...rawInput, expected_revision: current.revision, expected_workspace_nonce: current.workspaceNonce } : rawInput;
      const input = schemas[name].parse(enriched) as Record<string, unknown>;
      const applied = applyForgeTool(current, name, input, actor); commit(applied.state); return applied.result;
    } catch (error) { return failure(current, error); }
  }, [commit]);

  const runMachine = useCallback(async (actor: Actor = 'UI', rawInput: Record<string, unknown> = {}) => {
    const before = stateRef.current;
    try {
      const input = schemas.run_simulation.parse(actor === 'WebMCP' ? rawInput : { expected_revision: before.revision, expected_workspace_nonce: before.workspaceNonce });
      if (input.expected_revision !== before.revision || input.expected_workspace_nonce !== before.workspaceNonce) throw new Error('STALE_REVISION: inspect the current world before running physics.');
      commit(markSimulationRunning(before, actor));
      const run = await simulateDesign(before);
      const current = stateRef.current;
      if (current.revision !== before.revision || current.designHash !== before.designHash || current.workspaceNonce !== before.workspaceNonce) throw new Error('STALE_SIMULATION: the world changed while physics was running.');
      const applied = commitSimulation(current, run, actor); commit(applied.state); return applied.result;
    } catch (error) {
      const current = stateRef.current;
      if (current.phase === 'simulating') commit({ ...current, phase: current.components.length ? 'ready' : 'empty' });
      return failure(stateRef.current, error);
    }
  }, [commit]);

  const moveComponentAsHuman = useCallback((componentId: string, x: number) => {
    const current = stateRef.current;
    const target = current.components.find((item) => item.id === componentId);
    if (!target) return failure(current, new Error('INVALID_PHASE: generate or select a component before editing geometry.'));
    return command('move_component', { component_id: target.id, position: [Math.min(current.world.bounds[0] / 2, Math.max(-current.world.bounds[0] / 2, Math.round(x * 20) / 20)), target.position[1], target.position[2]] }, 'Human');
  }, [command]);
  const patchUi = useCallback((patch: Parameters<typeof toggleUi>[1]) => commit(toggleUi(stateRef.current, patch)), [commit]);
  const checkpoint = useCallback((label: string) => commit(createCheckpoint(stateRef.current, label)), [commit]);
  const reset = useCallback((screen: ForgeState['screen'] = 'lab') => { try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Reset still works in memory. */ } commit(createInitialForgeState(screen)); }, [commit]);
  return { state, command, runMachine, moveComponentAsHuman, patchUi, checkpoint, reset, getSnapshot };
}

function jsonSchemaFor(name: ForgeToolName): Record<string, unknown> {
  const rev = { type: 'integer', minimum: 0 };
  const common = { expected_revision: rev, expected_workspace_nonce: { type: 'string', minLength: 8, maxLength: 100 } };
  const identifier = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' };
  const metricKey = { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' };
  const vector = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } };
  const requiredCommon = ['expected_revision', 'expected_workspace_nonce'];
  const definitions: Record<ForgeToolName, { properties: Record<string, unknown>; required: string[] }> = {
    inspect_workspace: { properties: { since_revision: rev }, required: [] },
    inspect_primitive_catalog: { properties: { query: { type: 'string', maxLength: 40 } }, required: [] },
    set_design_goal: { properties: { machine_name: { type: 'string' }, domain: { type: 'string' }, brief: { type: 'string', minLength: 12, maxLength: 500 }, summary: { type: 'string' }, capabilities: { type: 'array', items: { enum: ['structure', 'transport', 'classify', 'lift', 'suspend', 'mobile', 'manipulate', 'transmit', 'stabilize', 'track', 'buffer', 'contain', 'rotate', 'measure'] } }, constraints: { type: 'array', items: { type: 'object', properties: { metric: metricKey, label: { type: 'string' }, operator: { enum: ['min', 'max', 'exact'] }, target: { type: 'number' }, unit: { type: 'string' }, source: { enum: ['user', 'inferred'] } }, required: ['metric', 'label', 'operator', 'target', 'unit', 'source'], additionalProperties: false } }, max_components: { type: 'integer', minimum: 1, maximum: 80 }, assumptions: { type: 'array', items: { type: 'string' } }, disclaimer: { type: 'string' }, simulation_model: { type: 'string' }, editable_component_id: identifier, editable_label: { type: 'string' }, world: { type: 'object', properties: { gravity: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: -30, maximum: 30 } }, duration: { type: 'number', minimum: 1, maximum: 30 }, bounds: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', exclusiveMinimum: 0, maximum: 60 } }, environment: { type: 'string', maxLength: 80 } }, additionalProperties: false }, ...common }, required: ['machine_name', 'domain', 'brief', 'capabilities', 'constraints', 'max_components', ...requiredCommon] },
    create_assembly: { properties: { assembly_id: identifier, name: { type: 'string' }, purpose: { type: 'string' }, parent_id: identifier, ...common }, required: ['assembly_id', 'name', 'purpose', ...requiredCommon] },
    create_component: { properties: { component_id: identifier, primitive: { enum: ['beam', 'plate', 'frame', 'wheel', 'shaft', 'gear', 'pulley', 'belt', 'motor', 'servo', 'piston', 'spring', 'sensor', 'camera', 'conveyor', 'ramp', 'gripper', 'container', 'counterweight', 'support', 'controller', 'cable', 'hook', 'roller'] }, assembly_id: identifier, role: { type: 'string' }, position: vector, rotation: vector, dimensions: vector, material_id: identifier, body_type: { enum: ['fixed', 'dynamic', 'kinematic'] }, mass: { type: 'number', exclusiveMinimum: 0 }, color: { type: 'string' }, parameters: { type: 'object' }, ...common }, required: ['component_id', 'primitive', 'assembly_id', 'role', 'position', 'rotation', 'dimensions', 'material_id', 'body_type', ...requiredCommon] },
    set_dimensions: { properties: { component_id: identifier, dimensions: vector, ...common }, required: ['component_id', 'dimensions', ...requiredCommon] },
    set_material: { properties: { component_id: identifier, material_id: identifier, ...common }, required: ['component_id', 'material_id', ...requiredCommon] },
    set_mass: { properties: { component_id: identifier, mass: { type: 'number', exclusiveMinimum: 0 }, ...common }, required: ['component_id', 'mass', ...requiredCommon] },
    move_component: { properties: { component_id: identifier, position: vector, ...common }, required: ['component_id', 'position', ...requiredCommon] },
    rotate_component: { properties: { component_id: identifier, rotation: vector, ...common }, required: ['component_id', 'rotation', ...requiredCommon] },
    connect_components: { properties: { connection_id: identifier, source_id: identifier, target_id: identifier, connection_type: { enum: ['mechanical', 'power', 'signal'] }, channel: metricKey, ...common }, required: ['source_id', 'target_id', 'connection_type', 'channel', ...requiredCommon] },
    create_joint: { properties: { joint_id: identifier, joint_type: { enum: ['fixed', 'revolute', 'prismatic', 'spherical', 'spring', 'rope', 'gear', 'belt'] }, component_a: identifier, component_b: identifier, anchor_a: vector, anchor_b: vector, axis: vector, limits: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } }, ratio: { type: 'number', exclusiveMinimum: 0 }, stiffness: { type: 'number', exclusiveMinimum: 0 }, damping: { type: 'number', minimum: 0 }, ...common }, required: ['joint_id', 'joint_type', 'component_a', 'component_b', 'anchor_a', 'anchor_b', 'axis', ...requiredCommon] },
    add_motor: { properties: { motor_id: identifier, component_id: identifier, joint_id: identifier, max_torque: { type: 'number', exclusiveMinimum: 0 }, max_rpm: { type: 'number', exclusiveMinimum: 0 }, direction: { type: 'number', minimum: -1, maximum: 1 }, ...common }, required: ['motor_id', 'component_id', 'max_torque', 'max_rpm', ...requiredCommon] },
    add_sensor: { properties: { sensor_id: identifier, component_id: identifier, sensor_type: { enum: ['distance', 'position', 'angle', 'speed', 'load', 'force', 'imu', 'camera', 'color', 'light', 'limit', 'presence'] }, channel: metricKey, target_id: identifier, range: { type: 'number', exclusiveMinimum: 0 }, ...common }, required: ['sensor_id', 'component_id', 'sensor_type', 'channel', 'range', ...requiredCommon] },
    add_actuator: { properties: { actuator_id: identifier, component_id: identifier, joint_id: identifier, actuator_type: { enum: ['rotary-motor', 'servo', 'linear', 'piston', 'winch'] }, max_force: { type: 'number', exclusiveMinimum: 0 }, max_speed: { type: 'number', exclusiveMinimum: 0 }, travel: { type: 'number', exclusiveMinimum: 0 }, ...common }, required: ['actuator_id', 'component_id', 'joint_id', 'actuator_type', 'max_force', 'max_speed', 'travel', ...requiredCommon] },
    set_control_logic: { properties: { control_id: identifier, name: { type: 'string' }, mode: { enum: ['pid', 'threshold', 'state-machine', 'tracking', 'timed', 'synchronized'] }, sensor_ids: { type: 'array', items: identifier }, actuator_ids: { type: 'array', items: identifier }, expression: { type: 'string' }, setpoint: { type: 'number' }, kp: { type: 'number' }, ki: { type: 'number' }, kd: { type: 'number' }, calibration_x: { type: 'number', minimum: -60, maximum: 60 }, ...common }, required: ['control_id', 'name', 'mode', 'sensor_ids', 'actuator_ids', 'expression', 'setpoint', 'kp', 'ki', 'kd', ...requiredCommon] },
    run_simulation: { properties: common, required: requiredCommon },
    inspect_telemetry: { properties: { run_id: { type: 'string' } }, required: [] },
    inspect_failure: { properties: { run_id: { type: 'string' } }, required: [] },
    measure_constraint: { properties: { run_id: { type: 'string' }, metric: metricKey }, required: ['metric'] },
    optimize_design: { properties: { run_id: { type: 'string' }, objective: { type: 'string' }, ...common }, required: requiredCommon },
    remove_component: { properties: { component_id: identifier, ...common }, required: ['component_id', ...requiredCommon] },
    remove_joint: { properties: { joint_id: identifier, ...common }, required: ['joint_id', ...requiredCommon] },
    compare_designs: { properties: { revision_a: rev, revision_b: rev }, required: ['revision_a', 'revision_b'] },
    restore_revision: { properties: { revision: rev, ...common }, required: ['revision', ...requiredCommon] },
  };
  return { type: 'object', properties: definitions[name].properties, required: definitions[name].required, additionalProperties: false };
}

export function useForgeWebMCP(command: ReturnType<typeof useForge>['command'], runMachine: ReturnType<typeof useForge>['runMachine'], getSnapshot: ReturnType<typeof useForge>['getSnapshot']) {
  const [count, setCount] = useState(0);
  const commandRef = useRef(command), runRef = useRef(runMachine), snapshotRef = useRef(getSnapshot);
  useEffect(() => { commandRef.current = command; runRef.current = runMachine; snapshotRef.current = getSnapshot; }, [command, runMachine, getSnapshot]);
  useEffect(() => {
    if (!('modelContext' in document) || !document.modelContext) return;
    const lifecycle = new AbortController();
    const names = Object.keys(schemas) as ForgeToolName[];
    const registrations = names.map((name) => document.modelContext!.registerTool({ name, title: name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), description: descriptions[name], inputSchema: jsonSchemaFor(name), annotations: { readOnlyHint: readTools.has(name) }, execute: async (raw, { signal }) => {
      signal?.throwIfAborted();
      try {
        const input = schemas[name].parse(raw) as Record<string, unknown>;
        const before = snapshotRef.current();
        if (guardedTools.has(name) && (input.expected_revision !== before.revision || input.expected_workspace_nonce !== before.workspaceNonce)) throw new Error(`STALE_REVISION: inspect revision ${before.revision} before retrying.`);
        return name === 'run_simulation' ? await runRef.current('WebMCP', input) : commandRef.current(name, input, 'WebMCP');
      } catch (error) { return failure(snapshotRef.current(), error); }
    } }, { signal: lifecycle.signal }));
    void Promise.allSettled(registrations).then((results) => { if (!lifecycle.signal.aborted) setCount(results.filter((result) => result.status === 'fulfilled').length); });
    return () => { lifecycle.abort(); setCount(0); };
  }, []);
  return count;
}

export function editableX(state: ForgeState) {
  return state.components.find((item) => item.id === state.goal?.editableComponentId)?.position[0] ?? 0;
}

export type HumanMove = (x: number) => ToolResult;
export type ScenePosition = Vec3;
