'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { createInitialForgeState } from './forge-data';
import { applyForgeTool, commitSimulation, createCheckpoint, markSimulationRunning, toggleUi } from './forge-engine';
import { simulateDesign } from './forge-simulation';
import type { Actor, ForgeState, ForgeToolName, ToolResult, Vec3 } from './forge-types';

const STORAGE_KEY = 'forgetwin-workspace-v1';
const revision = z.number().int().nonnegative();
const nonce = z.string().min(8).max(100);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const guard = { expected_revision: revision, expected_workspace_nonce: nonce };

const schemas = {
  inspect_workspace: z.object({ since_revision: revision.optional() }).strict(),
  inspect_component_catalog: z.object({ category: z.string().max(30).optional() }).strict(),
  set_design_goal: z.object({ throughput_bpm: z.number().min(5).max(40), min_accuracy_pct: z.number().min(50).max(100), max_components: z.number().int().min(7).max(12), brief: z.string().trim().min(12).max(500).optional(), ...guard }).strict(),
  add_component: z.object({ catalog_id: id, position: vec3.optional(), ...guard }).strict(),
  move_component: z.object({ component_id: id, position: vec3, ...guard }).strict(),
  rotate_component: z.object({ component_id: id, rotation: vec3, ...guard }).strict(),
  connect_components: z.object({ source_id: id, source_port: id, target_id: id, target_port: id, ...guard }).strict(),
  attach_sensor: z.object({ sensor_id: id, channel: z.enum(['color', 'presence']), target_zone: id, range: z.number().min(0.1).max(2), ...guard }).strict(),
  attach_actuator: z.object({ actuator_id: id, target_id: id, axis: z.enum(['x', 'y', 'z']), travel_degrees: z.number().min(10).max(60), ...guard }).strict(),
  create_control_rule: z.object({ sensor_id: id, condition: z.enum(['red', 'blue']), actuator_id: id, priority: z.number().int().min(1).max(10).default(1), ...guard }).strict(),
  set_motor_speed: z.object({ component_id: id, speed_mps: z.number().min(0.3).max(3), ...guard }).strict(),
  set_actuator_timing: z.object({ actuator_id: id, delay_ms: z.number().int().min(120).max(2200), hold_ms: z.number().int().min(300).max(1400), ...guard }).strict(),
  run_simulation: z.object(guard).strict(),
  inspect_telemetry: z.object({ run_id: z.string().max(80).optional() }).strict(),
  get_failure_events: z.object({ run_id: z.string().max(80).optional() }).strict(),
  inspect_collisions: z.object({ run_id: z.string().max(80).optional() }).strict(),
  compare_designs: z.object({ revision_a: revision, revision_b: revision }).strict(),
  restore_revision: z.object({ revision, ...guard }).strict(),
} satisfies Record<ForgeToolName, z.ZodType<Record<string, unknown>>>;

const readTools = new Set<ForgeToolName>(['inspect_workspace', 'inspect_component_catalog', 'inspect_telemetry', 'get_failure_events', 'inspect_collisions', 'compare_designs']);
const mutationNames = new Set<ForgeToolName>(['set_design_goal', 'add_component', 'move_component', 'rotate_component', 'connect_components', 'attach_sensor', 'attach_actuator', 'create_control_rule', 'set_motor_speed', 'set_actuator_timing', 'run_simulation', 'restore_revision']);

const descriptions: Record<ForgeToolName, string> = {
  inspect_workspace: 'Read the active machine, revision guards, human-authored constraints, and latest run without changing the design.',
  inspect_component_catalog: 'Inspect allowlisted physical components, ports, quantity limits, and capabilities.',
  set_design_goal: 'Set a validated design brief plus measurable throughput, accuracy, and component-count constraints for the active workspace.',
  add_component: 'Add one validated catalog component at a bounded workspace position.',
  move_component: 'Move one rendered component in shared state. Agent calls cannot override a human-locked transform; the validated sorter fixture currently permits only sensor X-rail motion during physics.',
  rotate_component: 'Rotate one rendered component using bounded Euler angles while respecting human locks. Physics reports fixture transforms that leave the validated sorter envelope.',
  connect_components: 'Connect compatible power, signal, or mechanical ports.',
  attach_sensor: 'Attach a catalog sensor to a controlled observation channel and target zone.',
  attach_actuator: 'Attach a catalog actuator to a bounded rotary path.',
  create_control_rule: 'Create one declarative sensor-to-actuator rule; arbitrary code is not accepted.',
  set_motor_speed: 'Set conveyor velocity inside the catalog-safe envelope.',
  set_actuator_timing: 'Set diverter delay and hold timing without moving any components.',
  run_simulation: 'Run the current immutable design in Rapier at a fixed 60 Hz timestep and commit engine-derived telemetry only if state is unchanged.',
  inspect_telemetry: 'Read bounded measured telemetry from a completed simulation run.',
  get_failure_events: 'Read classified failure events with replay-frame references.',
  inspect_collisions: 'Read harmful collision events measured from Rapier body poses.',
  compare_designs: 'Compare two immutable design revisions and their metric/configuration deltas.',
  restore_revision: 'Copy an earlier design into a new head revision while preserving current human-locked transforms.',
};

const persistedState = z.object({ schemaVersion: z.literal(1), workspaceId: z.string(), workspaceNonce: nonce, revision, designRevision: revision, components: z.array(z.unknown()), runs: z.array(z.unknown()), revisions: z.array(z.unknown()), activity: z.array(z.unknown()) }).passthrough();

function hydrate(): ForgeState {
  if (typeof window === 'undefined') return createInitialForgeState();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (persistedState.safeParse(parsed).success) return parsed as ForgeState;
  } catch {
    // Corrupt local state is replaced with the deterministic fixture.
  }
  return createInitialForgeState();
}

function failure(state: ForgeState, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : 'The tool could not run.';
  const [candidate, ...rest] = message.split(': ');
  const code = /^[A-Z_]+$/.test(candidate) ? candidate : error instanceof z.ZodError ? 'INVALID_INPUT' : 'INVALID_STATE';
  return { ok: false, workspace_id: state.workspaceId, workspace_nonce: state.workspaceNonce, revision: state.revision, error: { code, message: error instanceof z.ZodError ? 'Arguments did not match the controlled tool schema.' : rest.join(': ') || message } };
}

export function useForge() {
  const [state, setState] = useState<ForgeState>(createInitialForgeState);
  const stateRef = useRef(state);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loaded = hydrate();
      stateRef.current = loaded;
      setState(loaded);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const commit = useCallback((next: ForgeState) => {
    stateRef.current = next;
    setState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be blocked or full. Keep the live shared workspace usable in memory.
    }
  }, []);

  const getSnapshot = useCallback(() => stateRef.current, []);

  const command = useCallback((name: ForgeToolName, rawInput: Record<string, unknown> = {}, actor: Actor = 'UI'): ToolResult => {
    const current = stateRef.current;
    try {
      const enriched = mutationNames.has(name) && actor !== 'WebMCP' ? { ...rawInput, expected_revision: current.revision, expected_workspace_nonce: current.workspaceNonce } : rawInput;
      const input = schemas[name].parse(enriched) as Record<string, unknown>;
      const applied = applyForgeTool(current, name, input, actor);
      commit(applied.state);
      return applied.result;
    } catch (error) {
      return failure(current, error);
    }
  }, [commit]);

  const runMachine = useCallback(async (actor: Actor = 'UI', rawInput: Record<string, unknown> = {}) => {
    const before = stateRef.current;
    try {
      const input = schemas.run_simulation.parse(actor === 'WebMCP' ? rawInput : { expected_revision: before.revision, expected_workspace_nonce: before.workspaceNonce });
      if (input.expected_revision !== before.revision || input.expected_workspace_nonce !== before.workspaceNonce) throw new Error('STALE_REVISION: inspect the current workspace before running physics.');
      commit(markSimulationRunning(before, actor));
      const run = await simulateDesign(before);
      const current = stateRef.current;
      if (current.revision !== before.revision || current.designHash !== before.designHash || current.workspaceNonce !== before.workspaceNonce) throw new Error('STALE_SIMULATION: the design changed while physics was running.');
      const applied = commitSimulation(current, run, actor);
      commit(applied.state);
      return applied.result;
    } catch (error) {
      const current = stateRef.current;
      if (current.phase === 'simulating') commit({ ...current, phase: current.components.length ? 'ready' : 'empty' });
      return failure(stateRef.current, error);
    }
  }, [commit]);

  const moveSensorAsHuman = useCallback((x: number) => command('move_component', { component_id: 'sensor-color', position: [Math.min(0.2, Math.max(-3.1, Math.round(x * 20) / 20)), 1.05, 0] }, 'Human'), [command]);
  const patchUi = useCallback((patch: Parameters<typeof toggleUi>[1]) => commit(toggleUi(stateRef.current, patch)), [commit]);
  const checkpoint = useCallback((label: string) => commit(createCheckpoint(stateRef.current, label)), [commit]);
  const reset = useCallback((screen: ForgeState['screen'] = 'lab') => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // A blocked storage API should not prevent a deterministic demo reset.
    }
    commit(createInitialForgeState(screen));
  }, [commit]);

  return { state, command, runMachine, moveSensorAsHuman, patchUi, checkpoint, reset, getSnapshot };
}

function jsonSchemaFor(name: ForgeToolName): Record<string, unknown> {
  const rev = { type: 'integer', minimum: 0 };
  const common = { expected_revision: rev, expected_workspace_nonce: { type: 'string', minLength: 8, maxLength: 100 } };
  const ids = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' };
  const vector = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } };
  const properties: Record<ForgeToolName, Record<string, unknown>> = {
    inspect_workspace: { since_revision: rev },
    inspect_component_catalog: { category: { type: 'string', maxLength: 30 } },
    set_design_goal: { throughput_bpm: { type: 'number', minimum: 5, maximum: 40 }, min_accuracy_pct: { type: 'number', minimum: 50, maximum: 100 }, max_components: { type: 'integer', minimum: 7, maximum: 12 }, brief: { type: 'string', minLength: 12, maxLength: 500 }, ...common },
    add_component: { catalog_id: ids, position: vector, ...common },
    move_component: { component_id: ids, position: vector, ...common },
    rotate_component: { component_id: ids, rotation: vector, ...common },
    connect_components: { source_id: ids, source_port: ids, target_id: ids, target_port: ids, ...common },
    attach_sensor: { sensor_id: ids, channel: { enum: ['color', 'presence'] }, target_zone: ids, range: { type: 'number', minimum: 0.1, maximum: 2 }, ...common },
    attach_actuator: { actuator_id: ids, target_id: ids, axis: { enum: ['x', 'y', 'z'] }, travel_degrees: { type: 'number', minimum: 10, maximum: 60 }, ...common },
    create_control_rule: { sensor_id: ids, condition: { enum: ['red', 'blue'] }, actuator_id: ids, priority: { type: 'integer', minimum: 1, maximum: 10 }, ...common },
    set_motor_speed: { component_id: ids, speed_mps: { type: 'number', minimum: 0.3, maximum: 3 }, ...common },
    set_actuator_timing: { actuator_id: ids, delay_ms: { type: 'integer', minimum: 120, maximum: 2200 }, hold_ms: { type: 'integer', minimum: 300, maximum: 1400 }, ...common },
    run_simulation: common,
    inspect_telemetry: { run_id: { type: 'string', maxLength: 80 } },
    get_failure_events: { run_id: { type: 'string', maxLength: 80 } },
    inspect_collisions: { run_id: { type: 'string', maxLength: 80 } },
    compare_designs: { revision_a: rev, revision_b: rev },
    restore_revision: { revision: rev, ...common },
  };
  const required: Record<ForgeToolName, string[]> = {
    inspect_workspace: [], inspect_component_catalog: [], inspect_telemetry: [], get_failure_events: [], inspect_collisions: [],
    compare_designs: ['revision_a', 'revision_b'],
    set_design_goal: ['throughput_bpm', 'min_accuracy_pct', 'max_components', 'expected_revision', 'expected_workspace_nonce'],
    add_component: ['catalog_id', 'expected_revision', 'expected_workspace_nonce'],
    move_component: ['component_id', 'position', 'expected_revision', 'expected_workspace_nonce'],
    rotate_component: ['component_id', 'rotation', 'expected_revision', 'expected_workspace_nonce'],
    connect_components: ['source_id', 'source_port', 'target_id', 'target_port', 'expected_revision', 'expected_workspace_nonce'],
    attach_sensor: ['sensor_id', 'channel', 'target_zone', 'range', 'expected_revision', 'expected_workspace_nonce'],
    attach_actuator: ['actuator_id', 'target_id', 'axis', 'travel_degrees', 'expected_revision', 'expected_workspace_nonce'],
    create_control_rule: ['sensor_id', 'condition', 'actuator_id', 'expected_revision', 'expected_workspace_nonce'],
    set_motor_speed: ['component_id', 'speed_mps', 'expected_revision', 'expected_workspace_nonce'],
    set_actuator_timing: ['actuator_id', 'delay_ms', 'hold_ms', 'expected_revision', 'expected_workspace_nonce'],
    run_simulation: ['expected_revision', 'expected_workspace_nonce'],
    restore_revision: ['revision', 'expected_revision', 'expected_workspace_nonce'],
  };
  return { type: 'object', properties: properties[name], required: required[name], additionalProperties: false };
}

export function useForgeWebMCP(command: ReturnType<typeof useForge>['command'], runMachine: ReturnType<typeof useForge>['runMachine'], getSnapshot: ReturnType<typeof useForge>['getSnapshot']) {
  const [count, setCount] = useState(0);
  const commandRef = useRef(command);
  const runRef = useRef(runMachine);
  const snapshotRef = useRef(getSnapshot);
  useEffect(() => { commandRef.current = command; runRef.current = runMachine; snapshotRef.current = getSnapshot; }, [command, runMachine, getSnapshot]);

  useEffect(() => {
    if (!('modelContext' in document) || !document.modelContext) return;
    const lifecycle = new AbortController();
    const names = Object.keys(schemas) as ForgeToolName[];
    const registrations = names.map((name) => document.modelContext!.registerTool({
      name,
      title: name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      description: descriptions[name],
      inputSchema: jsonSchemaFor(name),
      annotations: { readOnlyHint: readTools.has(name) },
      execute: async (raw, { signal }) => {
        signal?.throwIfAborted();
        try {
          const input = schemas[name].parse(raw) as Record<string, unknown>;
          const before = snapshotRef.current();
          if (mutationNames.has(name) && (input.expected_revision !== before.revision || input.expected_workspace_nonce !== before.workspaceNonce)) throw new Error(`STALE_REVISION: inspect revision ${before.revision} before retrying.`);
          return name === 'run_simulation' ? await runRef.current('WebMCP', input) : commandRef.current(name, input, 'WebMCP');
        } catch (error) {
          return failure(snapshotRef.current(), error);
        }
      },
    }, { signal: lifecycle.signal }));
    void Promise.allSettled(registrations).then((results) => { if (!lifecycle.signal.aborted) setCount(results.filter((result) => result.status === 'fulfilled').length); });
    return () => { lifecycle.abort(); setCount(0); };
  }, []);
  return count;
}

export function sensorX(state: ForgeState) {
  return state.components.find((item) => item.id === 'sensor-color')?.position[0] ?? -0.8;
}

export function recommendedDelay(state: ForgeState) {
  return state.runs.at(-1)?.recommendedDelayMs ?? Math.round(((1.2 - sensorX(state)) / state.motorSpeed) * 1000 - 205);
}

export type HumanMove = (x: number) => ToolResult;
export type ScenePosition = Vec3;
