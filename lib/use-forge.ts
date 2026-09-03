'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { createInitialForgeState } from './forge-data';
import { applyForgeTool, commitSimulation, createCheckpoint, markSimulationRunning, toggleUi } from './forge-engine';
import { simulateDesign } from './forge-simulation';
import { exportForgeDesign, type ForgeExportFormat } from './forge-export';
import type { Actor, CollisionClassification, CompiledWorldPlan, ForgeState, ForgeToolName, MetricReading, RequirementCoverage, SimulationRun, ToolResult, Vec3 } from './forge-types';

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
  create_component: z.object({ component_id: id, primitive: z.enum(['beam', 'plate', 'frame', 'wheel', 'shaft', 'gear', 'pulley', 'belt', 'motor', 'servo', 'piston', 'spring', 'sensor', 'camera', 'light', 'conveyor', 'ramp', 'gripper', 'container', 'counterweight', 'support', 'controller', 'cable', 'hook', 'roller', 'tube', 'bearing', 'linkage', 'seat', 'steering', 'pedal', 'battery', 'body-shell', 'aerofoil', 'fuselage', 'propeller', 'rotor', 'landing-gear', 'track']), assembly_id: id, role: z.string().min(1).max(80), position: vec3, rotation: vec3, dimensions: vec3, material_id: id, body_type: z.enum(['fixed', 'dynamic', 'kinematic']), mass: z.number().finite().positive().max(100000).optional(), color: z.string().max(20).optional(), parameters: z.record(z.string(), parameter).optional(), ...guard }).strict(),
  set_dimensions: z.object({ component_id: id, dimensions: vec3, ...guard }).strict(),
  set_material: z.object({ component_id: id, material_id: id, ...guard }).strict(),
  set_mass: z.object({ component_id: id, mass: z.number().finite().positive().max(100000), ...guard }).strict(),
  move_component: z.object({ component_id: id, position: vec3, ...guard }).strict(),
  rotate_component: z.object({ component_id: id, rotation: vec3, ...guard }).strict(),
  connect_components: z.object({ connection_id: id.optional(), source_id: id, target_id: id, connection_type: z.enum(['mechanical', 'power', 'signal']), channel: key, ...guard }).strict(),
  create_joint: z.object({ joint_id: id, joint_type: z.enum(['fixed', 'revolute', 'prismatic', 'spherical', 'spring', 'rope', 'gear', 'belt']), component_a: id, component_b: id, anchor_a: vec3, anchor_b: vec3, axis: vec3, limits: z.tuple([z.number().finite(), z.number().finite()]).optional(), ratio: z.number().finite().positive().optional(), stiffness: z.number().finite().positive().optional(), damping: z.number().finite().nonnegative().optional(), ...guard }).strict(),
  add_motor: z.object({ motor_id: id, component_id: id, joint_id: id.optional(), max_torque: z.number().finite().positive(), max_rpm: z.number().finite().positive(), direction: z.number().finite().min(-1).max(1).optional(), ...guard }).strict(),
  set_motor_speed: z.object({ motor_id: id, max_rpm: z.number().finite().positive().max(100000), direction: z.number().finite().min(-1).max(1), ...guard }).strict(),
  add_sensor: z.object({ sensor_id: id, component_id: id, sensor_type: z.enum(['distance', 'position', 'angle', 'speed', 'load', 'force', 'imu', 'camera', 'color', 'light', 'limit', 'presence']), channel: key, target_id: id.optional(), range: z.number().finite().positive().max(100), ...guard }).strict(),
  set_sensor_range: z.object({ sensor_id: id, range: z.number().finite().positive().max(100), ...guard }).strict(),
  add_actuator: z.object({ actuator_id: id, component_id: id, joint_id: id, actuator_type: z.enum(['rotary-motor', 'servo', 'linear', 'piston', 'winch', 'brake']), max_force: z.number().finite().positive(), max_speed: z.number().finite().positive(), travel: z.number().finite().positive(), ...guard }).strict(),
  set_actuator_timing: z.object({ actuator_id: id, max_speed: z.number().finite().positive().max(10000), travel: z.number().finite().positive().max(100), ...guard }).strict(),
  set_control_logic: z.object({ control_id: id, name: z.string().min(1).max(80), mode: z.enum(['pid', 'threshold', 'state-machine', 'tracking', 'timed', 'synchronized']), sensor_ids: z.array(id).min(1).max(12), actuator_ids: z.array(id).max(12), motor_ids: z.array(id).max(12).optional(), expression: z.string().min(1).max(180), setpoint: z.number().finite(), kp: z.number().finite().min(0).max(10), ki: z.number().finite().min(0).max(10), kd: z.number().finite().min(0).max(10), calibration_x: z.number().finite().min(-60).max(60).optional(), ...guard }).strict().refine((value) => value.actuator_ids.length > 0 || (value.motor_ids?.length ?? 0) > 0, { message: 'A controller requires at least one actuator or motor output.' }),
  update_control_logic: z.object({ control_id: id, expression: z.string().min(1).max(180), setpoint: z.number().finite(), kp: z.number().finite().min(0).max(10), ki: z.number().finite().min(0).max(10), kd: z.number().finite().min(0).max(10), ...guard }).strict(),
  run_simulation: z.object(guard).strict(),
  inspect_telemetry: z.object({ run_id: z.string().max(80).optional() }).strict(),
  inspect_failure: z.object({ run_id: z.string().max(80).optional() }).strict(),
  measure_constraint: z.object({ run_id: z.string().max(80).optional(), metric: key }).strict(),
  optimize_design: z.object({ run_id: z.string().max(80).optional(), objective: z.string().max(120).optional(), ...guard }).strict(),
  remove_component: z.object({ component_id: id, ...guard }).strict(),
  remove_joint: z.object({ joint_id: id, ...guard }).strict(),
  compare_designs: z.object({ revision_a: revision, revision_b: revision }).strict(),
  restore_revision: z.object({ revision, ...guard }).strict(),
  export_design: z.object({ formats: z.array(z.enum(['png', 'pdf', 'stl', 'json'])).min(1).max(4), ...guard }).strict(),
} satisfies Record<ForgeToolName, z.ZodType<Record<string, unknown>>>;

export const FORGE_TOOL_COUNT = Object.keys(schemas).length;
export const WEBMCP_CHECKING = -1;
const readTools = new Set<ForgeToolName>(['inspect_workspace', 'inspect_primitive_catalog', 'inspect_telemetry', 'inspect_failure', 'measure_constraint', 'compare_designs']);
const guardedTools = new Set<ForgeToolName>([...Object.keys(schemas).filter((name) => !readTools.has(name as ForgeToolName)) as ForgeToolName[]]);

function compactToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactToolValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .map(([key, child]) => [key, compactToolValue(child)]));
}

/** Repair only representation-level mistakes that preserve engineering intent.
 * Missing references, wrong topology, stale revisions, and invalid dimensions
 * still fail and force the agent to inspect the world before retrying. */
export function prepareForgeToolArguments(name: ForgeToolName, rawInput: Record<string, unknown>) {
  const direct = schemas[name].safeParse(rawInput);
  if (direct.success) return { input: direct.data as Record<string, unknown>, repaired: false, detail: '' };
  const repaired = compactToolValue(rawInput) as Record<string, unknown>;
  for (const key of ['parent_id', 'joint_id', 'target_id']) if (repaired[key] === '' || repaired[key] === null) delete repaired[key];
  if (name === 'create_joint') {
    if (repaired.limits === null) delete repaired.limits;
    if (repaired.ratio === 0 || repaired.ratio === null) delete repaired.ratio;
    if (repaired.stiffness === 0 || repaired.stiffness === null) delete repaired.stiffness;
    if (repaired.damping === null) delete repaired.damping;
  }
  if (name === 'create_component' && (repaired.mass === 0 || repaired.mass === null)) delete repaired.mass;
  if (name === 'add_motor' && repaired.direction === undefined) repaired.direction = 1;
  const boundedText = (key: string, maximum: number) => {
    if (typeof repaired[key] === 'string' && repaired[key].length > maximum) repaired[key] = repaired[key].slice(0, maximum).trimEnd();
  };
  if (name === 'set_design_goal') {
    boundedText('summary', 240); boundedText('disclaimer', 240); boundedText('simulation_model', 160); boundedText('editable_label', 80);
    if (Array.isArray(repaired.assumptions)) repaired.assumptions = repaired.assumptions.map((item) => typeof item === 'string' ? item.slice(0, 180).trimEnd() : item).slice(0, 16);
  }
  if (name === 'create_assembly') { boundedText('name', 80); boundedText('purpose', 160); }
  if (name === 'create_component') boundedText('role', 80);
  const parsed = schemas[name].safeParse(repaired);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'root'} ${issue.message}`).join('; ');
    throw new Error(`INVALID_INPUT: ${name} arguments are invalid: ${detail}`);
  }
  return { input: parsed.data as Record<string, unknown>, repaired: true, detail: 'Removed empty optional fields and normalized schema-safe defaults before execution.' };
}

/** Verify every command emitted by a compiled design before resetting the
 * visible workspace. This turns model/schema drift into a bounded fallback
 * instead of leaving the user in an empty world after the first tool call. */
export function preflightCompiledWorldPlan(plan: CompiledWorldPlan) {
  const guard = { expected_revision: 0, expected_workspace_nonce: 'preflight-workspace' };
  const steps: Array<{ name: ForgeToolName; input: Record<string, unknown> }> = [
    { name: 'set_design_goal', input: {
      machine_name: plan.goal.machineName, domain: plan.goal.domain, brief: plan.brief,
      summary: plan.goal.summary, capabilities: plan.goal.capabilities, constraints: plan.goal.constraints,
      max_components: plan.goal.maxComponents, assumptions: plan.assumptions,
      disclaimer: plan.goal.disclaimer, simulation_model: plan.goal.simulationModel,
      editable_component_id: plan.goal.editableComponentId, editable_label: plan.goal.editableLabel,
      world: { gravity: plan.world.gravity, duration: plan.world.duration, bounds: plan.world.bounds, environment: plan.world.environment },
    } },
    ...plan.assemblies.map((item) => ({ name: 'create_assembly' as const, input: { assembly_id: item.id, name: item.name, purpose: item.purpose, parent_id: item.parentId } })),
    ...plan.components.map((item) => ({ name: 'create_component' as const, input: {
      component_id: item.id, primitive: item.primitive, assembly_id: item.assemblyId, role: item.role,
      position: item.position, rotation: item.rotation, dimensions: item.dimensions, material_id: item.materialId,
      body_type: item.bodyType, mass: item.mass, color: item.color, parameters: item.parameters,
    } })),
    ...plan.connections.map((item) => ({ name: 'connect_components' as const, input: { connection_id: item.id, source_id: item.sourceId, target_id: item.targetId, connection_type: item.type, channel: item.channel } })),
    ...plan.joints.map((item) => ({ name: 'create_joint' as const, input: { joint_id: item.id, joint_type: item.type, component_a: item.componentA, component_b: item.componentB, anchor_a: item.anchorA, anchor_b: item.anchorB, axis: item.axis, limits: item.limits, ratio: item.ratio, stiffness: item.stiffness, damping: item.damping } })),
    ...plan.motors.map((item) => ({ name: 'add_motor' as const, input: { motor_id: item.id, component_id: item.componentId, joint_id: item.jointId, max_torque: item.maxTorque, max_rpm: item.maxRpm, direction: item.direction } })),
    ...plan.sensors.map((item) => ({ name: 'add_sensor' as const, input: { sensor_id: item.id, component_id: item.componentId, sensor_type: item.type, channel: item.channel, target_id: item.targetId, range: item.range } })),
    ...plan.actuators.map((item) => ({ name: 'add_actuator' as const, input: { actuator_id: item.id, component_id: item.componentId, joint_id: item.jointId, actuator_type: item.type, max_force: item.maxForce, max_speed: item.maxSpeed, travel: item.travel } })),
    ...plan.controls.map((item) => ({ name: 'set_control_logic' as const, input: { control_id: item.id, name: item.name, mode: item.mode, sensor_ids: item.sensorIds, actuator_ids: item.actuatorIds, motor_ids: item.motorIds, expression: item.expression, setpoint: item.setpoint, kp: item.kp, ki: item.ki, kd: item.kd, calibration_x: item.calibrationX } })),
  ];
  return steps.map((step) => ({ name: step.name, ...prepareForgeToolArguments(step.name, { ...step.input, ...guard }) }));
}

function recordSchemaRepair(state: ForgeState, name: ForgeToolName, actor: Actor, detail: string) {
  const seq = state.activitySeq + 1;
  return { ...state, activitySeq: seq, activity: [{ id: `activity-${seq}`, seq, tool: name, detail: `Schema repair · ${detail}`, actor, outcome: 'success' as const, at: new Date().toISOString() }, ...state.activity].slice(0, 140) };
}

const descriptions: Record<ForgeToolName, string> = {
  inspect_workspace: 'Read the complete shared physical world: assemblies, bodies, dimensions, materials, masses, joints, devices, controls, revisions, and human locks.',
  inspect_primitive_catalog: 'Inspect reusable low-level primitives and material properties. Complete machines are not catalog entries.',
  set_design_goal: 'Create a free-form engineering goal with typed constraints and composable capabilities; no profile or machine template is selected. Use mobile when the machine itself travels. Reserve transport for loose-material or workpiece flow through conveyors, chutes, rollers, and processing lines.',
  create_assembly: 'Create an empty mechanical subsystem that can contain arbitrary physical bodies.',
  create_component: 'Create one requested or mechanically required physical body from a reusable primitive with explicit geometry, transform, material, mass, and rigid-body mode. Do not add visible calibration boxes or temporary test payloads; run_simulation supplies non-design measurement probes when appropriate.',
  set_dimensions: 'Resize one body and recalculate mass from material density unless mass is human-locked.',
  set_material: 'Change one body material and its friction, strength proxy, color, and density-derived mass.',
  set_mass: 'Set an explicit body mass for payloads, counterweights, or calibrated mechanisms.',
  move_component: 'Move any body in the shared world while preserving human-locked transforms.',
  rotate_component: 'Rotate any body in the shared world while preserving human-locked transforms.',
  connect_components: 'Create a declared mechanical, power, or signal graph edge between two bodies.',
  create_joint: 'Create a fixed, revolute, prismatic, spherical, spring, rope, gear, or belt joint with anchors, axis, limits, and physical parameters.',
  add_motor: 'Attach a torque- and rpm-limited motor to a physical motor body and optional joint.',
  set_motor_speed: 'Retune the speed and direction of an existing motor without replacing its body or joint.',
  add_sensor: 'Register a typed measurement channel on a sensor or camera body.',
  set_sensor_range: 'Retune the measurement range of an existing sensor while preserving its mounting and channel.',
  add_actuator: 'Bind a per-joint rotary, servo, linear, piston, or winch actuator with force, speed, and travel limits.',
  set_actuator_timing: 'Retune the speed and travel envelope of an existing actuator without rebuilding the mechanism.',
  set_control_logic: 'Create bounded declarative PID, tracking, synchronized, threshold, timed, or state-machine logic between device IDs.',
  update_control_logic: 'Retune an existing control expression, setpoint, and PID gains in place.',
  run_simulation: 'Instantiate the current bodies and supported joints in a fixed-step Rapier world and capture telemetry, replay, contacts, and measured constraints.',
  inspect_telemetry: 'Read physics configuration, time-series channels, constraint evidence, objective, and recommended changes.',
  inspect_failure: 'Read causal failed constraints, involved component IDs, evidence channels, contacts, and bounded redesign recommendations.',
  measure_constraint: 'Read one measured constraint with value, target, unit, status, and its physical provenance.',
  optimize_design: 'Apply a bounded evidence-driven redesign to unlocked material, geometry, mass, motor, actuator, spring, and controller fields.',
  remove_component: 'Remove one physical body and its dependent joints and devices for topology redesign.',
  remove_joint: 'Remove one joint and dependent drives for topology redesign.',
  compare_designs: 'Compare two immutable world revisions by topology, physical mass, measurements, and optimization level.',
  restore_revision: 'Create a new head revision from an earlier world while preserving current human-locked fields.',
  export_design: 'Download the current verified revision as a presentation PNG, engineering PDF, CAD-ready binary STL, and/or structured JSON world without opening the export menu.',
};

const persistedState = z.object({ schemaVersion: z.literal(3), workspaceId: z.string(), workspaceNonce: nonce, revision, designRevision: revision, assemblies: z.array(z.unknown()), components: z.array(z.unknown()), joints: z.array(z.unknown()), runs: z.array(z.unknown()), revisions: z.array(z.unknown()), activity: z.array(z.unknown()) }).passthrough();

const metricEvidence = new Set<MetricReading['evidence']>(['replay-telemetry', 'rapier-contact', 'reduced-order-model', 'design-inspection', 'not-evaluated']);
const collisionClassifications = new Set<CollisionClassification>(['expected-contact', 'connected-component-contact', 'ground-contact', 'clearance-violation', 'self-interference', 'harmful-impact']);

/** Keep saved pre-evidence workspaces usable without presenting historical
 * heuristic numbers as newly measured proof. A fresh Run Physics action will
 * replace these conservative migration labels with current replay evidence. */
export function migratePersistedState(state: ForgeState): ForgeState {
  const runs = (Array.isArray(state.runs) ? state.runs : []).map((run, runIndex) => {
    const candidate = run as SimulationRun;
    const sourceMeasures = Array.isArray(candidate.metrics?.measures) ? candidate.metrics.measures : [];
    const legacyEvidence = sourceMeasures.some((reading) => !metricEvidence.has(reading.evidence))
      || !Array.isArray(candidate.requirementCoverage)
      || !candidate.evaluationLevel;
    const measures: MetricReading[] = sourceMeasures.map((reading) => {
      const evidence = metricEvidence.has(reading.evidence) ? reading.evidence : 'not-evaluated';
      return { ...reading, evidence, status: evidence === 'not-evaluated' ? 'info' : reading.status };
    });
    const fallbackCoverage: RequirementCoverage[] = measures.map((reading, index) => ({
      id: `migrated-${runIndex}-${index}`,
      category: 'user requirement',
      requirement: reading.label,
      status: 'not-evaluated',
      componentIds: [],
      simulationEvidence: 'Saved before the current evidence contract; this value is not treated as verified.',
      missingItems: ['fresh fixed-step replay'],
      recommendedCorrection: 'Run Physics again to produce current telemetry and contact evidence.',
    }));
    const requirementCoverage = Array.isArray(candidate.requirementCoverage)
      ? candidate.requirementCoverage.map((item, index) => ({
        id: item.id || `migrated-${runIndex}-${index}`,
        category: item.category || 'user requirement',
        requirement: item.requirement || measures[index]?.label || `Requirement ${index + 1}`,
        status: item.status || 'not-evaluated',
        componentIds: Array.isArray(item.componentIds) ? item.componentIds : [],
        simulationEvidence: item.simulationEvidence || 'No saved evidence description.',
        missingItems: Array.isArray(item.missingItems) ? item.missingItems : [],
        recommendedCorrection: item.recommendedCorrection || 'Run Physics again for current evidence.',
      }))
      : fallbackCoverage;
    const collisions = (Array.isArray(candidate.collisions) ? candidate.collisions : []).map((collision, index) => ({
      ...collision,
      id: collision.id || `migrated-contact-${runIndex}-${index}`,
      point: collision.point ?? [0, 0, 0],
      replayFrame: collision.replayFrame ?? 0,
      harmful: collision.harmful ?? false,
      classification: collisionClassifications.has(collision.classification) ? collision.classification : 'connected-component-contact',
      reason: collision.reason || 'Legacy contact retained for replay; rerun to classify it with the current collision model.',
    }));
    return {
      ...candidate,
      status: legacyEvidence && candidate.status === 'passed' ? 'partial' : candidate.status,
      evaluationLevel: candidate.evaluationLevel ?? 'concept-only',
      metrics: { ...candidate.metrics, measures },
      requirementCoverage,
      collisions,
    };
  });
  const latest = runs.at(-1);
  return {
    ...state,
    runs,
    phase: latest && state.phase === 'passed' && latest.status !== 'passed' ? latest.status : state.phase,
    controls: (Array.isArray(state.controls) ? state.controls : [])
      .map((control) => ({ ...control, motorIds: control.motorIds ?? (control.actuatorIds.length ? [] : state.motors.map((motor) => motor.id)) }))
      .filter((control) => control.sensorIds.length > 0 && (control.actuatorIds.length > 0 || (control.motorIds?.length ?? 0) > 0)),
  };
}

function hydrate(): ForgeState {
  if (typeof window === 'undefined') return createInitialForgeState();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (persistedState.safeParse(parsed).success) {
      return migratePersistedState(parsed as ForgeState);
    }
  } catch { /* Corrupt or unavailable storage falls back to a deterministic world. */ }
  return createInitialForgeState();
}

function failure(state: ForgeState, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : 'The tool could not run.';
  const [candidate, ...rest] = message.split(': ');
  const code = /^[A-Z_]+$/.test(candidate) ? candidate : error instanceof z.ZodError ? 'INVALID_INPUT' : 'INVALID_STATE';
  return { ok: false, workspace_id: state.workspaceId, workspace_nonce: state.workspaceNonce, revision: state.revision, error: { code, message: error instanceof z.ZodError ? 'Arguments did not match the controlled world-tool schema.' : rest.join(': ') || message } };
}

function preservationFingerprint(state: ForgeState, componentId: string) {
  const component = state.components.find((item) => item.id === componentId);
  if (!component) return null;
  const joints = state.joints.filter((item) => item.componentA === componentId || item.componentB === componentId).sort((a, b) => a.id.localeCompare(b.id));
  const connections = state.connections.filter((item) => item.sourceId === componentId || item.targetId === componentId).sort((a, b) => a.id.localeCompare(b.id));
  const jointIds = new Set(joints.map((item) => item.id));
  const motors = state.motors.filter((item) => item.componentId === componentId || Boolean(item.jointId && jointIds.has(item.jointId))).sort((a, b) => a.id.localeCompare(b.id));
  const sensors = state.sensors.filter((item) => item.componentId === componentId || item.targetId === componentId).sort((a, b) => a.id.localeCompare(b.id));
  const actuators = state.actuators.filter((item) => item.componentId === componentId || jointIds.has(item.jointId)).sort((a, b) => a.id.localeCompare(b.id));
  const deviceIds = new Set([...motors.map((item) => item.id), ...sensors.map((item) => item.id), ...actuators.map((item) => item.id)]);
  const controls = state.controls.filter((item) => [...item.sensorIds, ...item.actuatorIds].some((id) => deviceIds.has(id))).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ component, joints, connections, motors, sensors, actuators, controls });
}

export function useForge() {
  const [state, setState] = useState<ForgeState>(createInitialForgeState);
  const [hydrated, setHydrated] = useState(false);
  const stateRef = useRef(state);

  useEffect(() => {
    const timeout = window.setTimeout(() => { const loaded = hydrate(); stateRef.current = loaded; setState(loaded); setHydrated(true); }, 0);
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
      const prepared = prepareForgeToolArguments(name, enriched);
      const applied = applyForgeTool(current, name, prepared.input, actor);
      commit(prepared.repaired ? recordSchemaRepair(applied.state, name, actor, prepared.detail) : applied.state); return applied.result;
    } catch (error) { return failure(current, error); }
  }, [commit]);

  const commandBatch = useCallback((
    steps: Array<{ name: ForgeToolName; input?: Record<string, unknown> }>,
    actor: Actor = 'UI',
    options: { expectedRevision?: number; expectedDesignHash?: string; preserveComponentIds?: string[] } = {},
  ): ToolResult => {
    const before = stateRef.current;
    if (!steps.length) return failure(before, new Error('INVALID_INPUT: An atomic command batch needs at least one action.'));
    if (actor === 'WebMCP') return failure(before, new Error('INVALID_INPUT: WebMCP actions must remain individually revision-guarded.'));
    if (options.expectedRevision !== undefined && options.expectedRevision !== before.revision) return failure(before, new Error('STALE_REVISION: The world changed while the edit was being planned. Inspect it and retry.'));
    if (options.expectedDesignHash && options.expectedDesignHash !== before.designHash) return failure(before, new Error('STALE_REVISION: The design changed while the edit was being planned. Inspect it and retry.'));
    const preserved = new Map((options.preserveComponentIds ?? []).map((componentId) => [componentId, preservationFingerprint(before, componentId)]));
    if ([...preserved.values()].some((item) => !item)) return failure(before, new Error('INVALID_STATE: The edit tried to preserve a component that no longer exists.'));
    let next = before;
    let finalResult: ToolResult | null = null;
    try {
      for (const step of steps) {
        if (!guardedTools.has(step.name) || step.name === 'run_simulation') throw new Error(`INVALID_INPUT: ${step.name} cannot run inside an atomic edit batch.`);
        const rawInput = step.input ?? {};
        const enriched = guardedTools.has(step.name)
          ? { ...rawInput, expected_revision: next.revision, expected_workspace_nonce: next.workspaceNonce }
          : rawInput;
        const prepared = prepareForgeToolArguments(step.name, enriched);
        const applied = applyForgeTool(next, step.name, prepared.input, actor);
        next = prepared.repaired ? recordSchemaRepair(applied.state, step.name, actor, prepared.detail) : applied.state;
        finalResult = applied.result;
      }
      for (const [componentId, original] of preserved) if (preservationFingerprint(next, componentId) !== original) throw new Error(`HUMAN_LOCKED: The edit changed preserved component ${componentId} or its functional graph.`);
      commit(next);
      return finalResult!;
    } catch (error) {
      return failure(before, error);
    }
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

  const moveComponentAsHuman = useCallback((componentId: string, position: Vec3) => {
    const current = stateRef.current;
    const target = current.components.find((item) => item.id === componentId);
    if (!target) return failure(current, new Error('INVALID_PHASE: generate or select a component before editing geometry.'));
    const bounded: Vec3 = [
      Math.min(current.world.bounds[0] / 2, Math.max(-current.world.bounds[0] / 2, Math.round(position[0] * 20) / 20)),
      Math.min(current.world.bounds[1], Math.max(0, Math.round(position[1] * 20) / 20)),
      Math.min(current.world.bounds[2] / 2, Math.max(-current.world.bounds[2] / 2, Math.round(position[2] * 20) / 20)),
    ];
    return command('move_component', { component_id: target.id, position: bounded }, 'Human');
  }, [command]);
  const patchUi = useCallback((patch: Parameters<typeof toggleUi>[1]) => commit(toggleUi(stateRef.current, patch)), [commit]);
  const checkpoint = useCallback((label: string) => commit(createCheckpoint(stateRef.current, label)), [commit]);
  const reset = useCallback((screen: ForgeState['screen'] = 'lab') => { try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Reset still works in memory. */ } commit(createInitialForgeState(screen)); }, [commit]);
  return { state, hydrated, command, commandBatch, runMachine, moveComponentAsHuman, patchUi, checkpoint, reset, getSnapshot };
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
    create_component: { properties: { component_id: identifier, primitive: { enum: ['beam', 'plate', 'frame', 'wheel', 'shaft', 'gear', 'pulley', 'belt', 'motor', 'servo', 'piston', 'spring', 'sensor', 'camera', 'light', 'conveyor', 'ramp', 'gripper', 'container', 'counterweight', 'support', 'controller', 'cable', 'hook', 'roller', 'tube', 'bearing', 'linkage', 'seat', 'steering', 'pedal', 'battery', 'body-shell', 'aerofoil', 'fuselage', 'propeller', 'rotor', 'landing-gear', 'track'] }, assembly_id: identifier, role: { type: 'string' }, position: vector, rotation: vector, dimensions: vector, material_id: identifier, body_type: { enum: ['fixed', 'dynamic', 'kinematic'] }, mass: { type: 'number', exclusiveMinimum: 0 }, color: { type: 'string' }, parameters: { type: 'object' }, ...common }, required: ['component_id', 'primitive', 'assembly_id', 'role', 'position', 'rotation', 'dimensions', 'material_id', 'body_type', ...requiredCommon] },
    set_dimensions: { properties: { component_id: identifier, dimensions: vector, ...common }, required: ['component_id', 'dimensions', ...requiredCommon] },
    set_material: { properties: { component_id: identifier, material_id: identifier, ...common }, required: ['component_id', 'material_id', ...requiredCommon] },
    set_mass: { properties: { component_id: identifier, mass: { type: 'number', exclusiveMinimum: 0 }, ...common }, required: ['component_id', 'mass', ...requiredCommon] },
    move_component: { properties: { component_id: identifier, position: vector, ...common }, required: ['component_id', 'position', ...requiredCommon] },
    rotate_component: { properties: { component_id: identifier, rotation: vector, ...common }, required: ['component_id', 'rotation', ...requiredCommon] },
    connect_components: { properties: { connection_id: identifier, source_id: identifier, target_id: identifier, connection_type: { enum: ['mechanical', 'power', 'signal'] }, channel: metricKey, ...common }, required: ['source_id', 'target_id', 'connection_type', 'channel', ...requiredCommon] },
    create_joint: { properties: { joint_id: identifier, joint_type: { enum: ['fixed', 'revolute', 'prismatic', 'spherical', 'spring', 'rope', 'gear', 'belt'] }, component_a: identifier, component_b: identifier, anchor_a: vector, anchor_b: vector, axis: vector, limits: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } }, ratio: { type: 'number', exclusiveMinimum: 0 }, stiffness: { type: 'number', exclusiveMinimum: 0 }, damping: { type: 'number', minimum: 0 }, ...common }, required: ['joint_id', 'joint_type', 'component_a', 'component_b', 'anchor_a', 'anchor_b', 'axis', ...requiredCommon] },
    add_motor: { properties: { motor_id: identifier, component_id: identifier, joint_id: identifier, max_torque: { type: 'number', exclusiveMinimum: 0 }, max_rpm: { type: 'number', exclusiveMinimum: 0 }, direction: { type: 'number', minimum: -1, maximum: 1 }, ...common }, required: ['motor_id', 'component_id', 'max_torque', 'max_rpm', ...requiredCommon] },
    set_motor_speed: { properties: { motor_id: identifier, max_rpm: { type: 'number', exclusiveMinimum: 0, maximum: 100000 }, direction: { type: 'number', minimum: -1, maximum: 1 }, ...common }, required: ['motor_id', 'max_rpm', 'direction', ...requiredCommon] },
    add_sensor: { properties: { sensor_id: identifier, component_id: identifier, sensor_type: { enum: ['distance', 'position', 'angle', 'speed', 'load', 'force', 'imu', 'camera', 'color', 'light', 'limit', 'presence'] }, channel: metricKey, target_id: identifier, range: { type: 'number', exclusiveMinimum: 0 }, ...common }, required: ['sensor_id', 'component_id', 'sensor_type', 'channel', 'range', ...requiredCommon] },
    set_sensor_range: { properties: { sensor_id: identifier, range: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, ...common }, required: ['sensor_id', 'range', ...requiredCommon] },
    add_actuator: { properties: { actuator_id: identifier, component_id: identifier, joint_id: identifier, actuator_type: { enum: ['rotary-motor', 'servo', 'linear', 'piston', 'winch', 'brake'] }, max_force: { type: 'number', exclusiveMinimum: 0 }, max_speed: { type: 'number', exclusiveMinimum: 0 }, travel: { type: 'number', exclusiveMinimum: 0 }, ...common }, required: ['actuator_id', 'component_id', 'joint_id', 'actuator_type', 'max_force', 'max_speed', 'travel', ...requiredCommon] },
    set_actuator_timing: { properties: { actuator_id: identifier, max_speed: { type: 'number', exclusiveMinimum: 0, maximum: 10000 }, travel: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, ...common }, required: ['actuator_id', 'max_speed', 'travel', ...requiredCommon] },
    set_control_logic: { properties: { control_id: identifier, name: { type: 'string' }, mode: { enum: ['pid', 'threshold', 'state-machine', 'tracking', 'timed', 'synchronized'] }, sensor_ids: { type: 'array', minItems: 1, items: identifier }, actuator_ids: { type: 'array', items: identifier }, motor_ids: { type: 'array', items: identifier }, expression: { type: 'string' }, setpoint: { type: 'number' }, kp: { type: 'number' }, ki: { type: 'number' }, kd: { type: 'number' }, calibration_x: { type: 'number', minimum: -60, maximum: 60 }, ...common }, required: ['control_id', 'name', 'mode', 'sensor_ids', 'actuator_ids', 'expression', 'setpoint', 'kp', 'ki', 'kd', ...requiredCommon] },
    update_control_logic: { properties: { control_id: identifier, expression: { type: 'string' }, setpoint: { type: 'number' }, kp: { type: 'number', minimum: 0, maximum: 10 }, ki: { type: 'number', minimum: 0, maximum: 10 }, kd: { type: 'number', minimum: 0, maximum: 10 }, ...common }, required: ['control_id', 'expression', 'setpoint', 'kp', 'ki', 'kd', ...requiredCommon] },
    run_simulation: { properties: common, required: requiredCommon },
    inspect_telemetry: { properties: { run_id: { type: 'string' } }, required: [] },
    inspect_failure: { properties: { run_id: { type: 'string' } }, required: [] },
    measure_constraint: { properties: { run_id: { type: 'string' }, metric: metricKey }, required: ['metric'] },
    optimize_design: { properties: { run_id: { type: 'string' }, objective: { type: 'string' }, ...common }, required: requiredCommon },
    remove_component: { properties: { component_id: identifier, ...common }, required: ['component_id', ...requiredCommon] },
    remove_joint: { properties: { joint_id: identifier, ...common }, required: ['joint_id', ...requiredCommon] },
    compare_designs: { properties: { revision_a: rev, revision_b: rev }, required: ['revision_a', 'revision_b'] },
    restore_revision: { properties: { revision: rev, ...common }, required: ['revision', ...requiredCommon] },
    export_design: { properties: { formats: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { enum: ['png', 'pdf', 'stl', 'json'] } }, ...common }, required: ['formats', ...requiredCommon] },
  };
  return { type: 'object', properties: definitions[name].properties, required: definitions[name].required, additionalProperties: false };
}

export function useForgeWebMCP(command: ReturnType<typeof useForge>['command'], runMachine: ReturnType<typeof useForge>['runMachine'], getSnapshot: ReturnType<typeof useForge>['getSnapshot'], hydrated = true) {
  const [count, setCount] = useState(WEBMCP_CHECKING);
  const commandRef = useRef(command), runRef = useRef(runMachine), snapshotRef = useRef(getSnapshot);
  useEffect(() => { commandRef.current = command; runRef.current = runMachine; snapshotRef.current = getSnapshot; }, [command, runMachine, getSnapshot]);
  useEffect(() => {
    if (!hydrated) return;
    const lifecycle = new AbortController();
    const names = Object.keys(schemas) as ForgeToolName[];
    let discoveryTimer: number | undefined;
    let registering = false;
    let attempts = 0;
    let activeContext: typeof document.modelContext | undefined;

    // ChatGPT can attach the WebMCP host after the page has already hydrated.
    // Keep discovery alive instead of permanently deciding that the host is
    // absent from one early read of document.modelContext.
    const discoverAndRegister = async () => {
      if (lifecycle.signal.aborted || registering) return;
      const context = document.modelContext;
      if (!context) {
        discoveryTimer = window.setTimeout(() => { void discoverAndRegister(); }, 250);
        return;
      }
      if (context === activeContext) {
        discoveryTimer = window.setTimeout(() => { void discoverAndRegister(); }, 2_000);
        return;
      }
      registering = true;
      attempts += 1;
      window.clearTimeout(unavailableTimer);
      setCount(WEBMCP_CHECKING);
      const registrations = names.map((name) => context.registerTool({ name, title: name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), description: descriptions[name], inputSchema: jsonSchemaFor(name), annotations: { readOnlyHint: readTools.has(name) }, execute: async (raw, { signal }) => {
        signal?.throwIfAborted();
        try {
          const prepared = prepareForgeToolArguments(name, raw);
          const input = prepared.input;
          const before = snapshotRef.current();
          if (guardedTools.has(name) && (input.expected_revision !== before.revision || input.expected_workspace_nonce !== before.workspaceNonce)) throw new Error(`STALE_REVISION: inspect revision ${before.revision} before retrying.`);
          if (name === 'run_simulation') return await runRef.current('WebMCP', input);
          if (name === 'export_design') {
            const formats = input.formats as ForgeExportFormat[];
            for (const format of formats) {
              signal?.throwIfAborted();
              await exportForgeDesign(before, format);
            }
          }
          return commandRef.current(name, raw, 'WebMCP');
        } catch (error) { return failure(snapshotRef.current(), error); }
      } }, { signal: lifecycle.signal }));
      const results = await Promise.allSettled(registrations);
      if (lifecycle.signal.aborted) return;
      const registered = results.filter((result) => result.status === 'fulfilled').length;
      setCount(registered);
      registering = false;
      // Some hosts expose modelContext just before they are ready to accept
      // registrations. A complete rejection is safe to retry because no tool
      // from that attempt was installed.
      if (registered > 0) {
        activeContext = context;
        discoveryTimer = window.setTimeout(() => { void discoverAndRegister(); }, 2_000);
      } else if (attempts < 5) discoveryTimer = window.setTimeout(() => { void discoverAndRegister(); }, 500);
    };

    const unavailableTimer = window.setTimeout(() => {
      if (!lifecycle.signal.aborted && !document.modelContext) setCount(0);
    }, 3500);
    void discoverAndRegister();
    return () => {
      lifecycle.abort();
      if (discoveryTimer !== undefined) window.clearTimeout(discoveryTimer);
      window.clearTimeout(unavailableTimer);
    };
  }, [hydrated]);
  return count;
}

export function editableX(state: ForgeState) {
  return state.components.find((item) => item.id === state.goal?.editableComponentId)?.position[0] ?? 0;
}

export type HumanMove = (x: number) => ToolResult;
export type ScenePosition = Vec3;
