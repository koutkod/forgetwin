'use client';

import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Bot, Box, Check, ChevronDown,
  CircleDot, Clock3, Code2, Cpu, Gauge, GitCompareArrows, History, Layers3, Move3D,
  KeyRound, MessageSquareText, MoveHorizontal, Play, Radio, Redo2, RotateCcw, Save, Send,
  Settings2, Sparkles, Square, TimerReset, Undo2, Waypoints, X, Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ForgeScene } from '../components/forge/forge-scene';
import {
  getAgentStatus, requestAgentEdit, requestAgentPlan, requestAgentRedesign,
  type AgentEditAction, type AgentRuntimeMode, type AgentTraceItem,
} from '../lib/forge-agent';
import { catalogFor, engineeringExamples, materials, primitiveCatalog } from '../lib/forge-data';
import { CHALLENGE_EXAMPLES, compileDesignBrief, DEFAULT_DESIGN_PROMPT } from '../lib/forge-prompt';
import { FORGE_TOOL_COUNT, useForge, useForgeWebMCP } from '../lib/use-forge';
import type {
  EngineeringExample,
} from '../lib/forge-data';
import type {
  Actor, ForgeState, ForgeToolName, MachineComponent, MetricReading, Metrics,
  PrimitiveKind, SimulationRun, ToolResult,
} from '../lib/forge-types';

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const constraintSymbol = (operator: 'min' | 'max' | 'exact') => operator === 'min' ? '≥' : operator === 'max' ? '≤' : '=';
type EditMessage = { id: string; role: 'user' | 'agent'; text: string };
type EditCommand = { tool: ForgeToolName; input: Record<string, unknown>; label: string };

export function ForgeTwinApp() {
  const forge = useForge();
  const { state, hydrated, command, runMachine, moveComponentAsHuman, patchUi, checkpoint, reset, getSnapshot } = forge;
  const registeredTools = useForgeWebMCP(command, runMachine, getSnapshot, hydrated);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'chat' | 'activity' | 'history'>('activity');
  const [drawer, setDrawer] = useState<'telemetry' | 'compare' | 'catalog' | 'history' | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalPrompt, setGoalPrompt] = useState(DEFAULT_DESIGN_PROMPT);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntimeMode>('checking');
  const [agentModel, setAgentModel] = useState('gpt-5.6-sol');
  const [agentKey, setAgentKey] = useState('');
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [agentTrace, setAgentTrace] = useState<AgentTraceItem[]>([]);
  const [editPrompt, setEditPrompt] = useState('');
  const [editMessages, setEditMessages] = useState<EditMessage[]>([]);
  const [agentCancelable, setAgentCancelable] = useState(false);
  const traceSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3600); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const controller = new AbortController();
    void getAgentStatus(controller.signal).then((status) => {
      setAgentModel(status.model); setAgentRuntime(status.configured ? 'server-model' : 'deterministic');
    }).catch(() => setAgentRuntime('deterministic'));
    return () => controller.abort();
  }, []);
  const must = (result: ToolResult) => { if (!result.ok) throw new Error(result.error.message); return result; };
  const ensureActive = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Agent run cancelled.', 'AbortError'); };
  const call = async (name: ForgeToolName, input: Record<string, unknown> = {}, delay = 20, actor: Actor = 'Deterministic', signal?: AbortSignal) => { ensureActive(signal); const result = must(command(name, input, actor)); await pause(delay); ensureActive(signal); return result; };
  const addTrace = (kind: AgentTraceItem['kind'], title: string, detail: string) => {
    traceSeq.current += 1;
    const item: AgentTraceItem = { id: `agent-trace-${traceSeq.current}`, kind, title, detail, at: new Date().toISOString() };
    setAgentTrace((current) => [...current, item].slice(-30));
  };
  const runtimeActor = (): Actor => agentRuntime === 'server-model' || agentRuntime === 'session-model' ? 'ModelAgent' : 'Deterministic';
  const updateGoalPrompt = (prompt: string) => { setGoalPrompt(prompt); setPromptError(null); };

  const redesignRun = async (failed: SimulationRun, prompt: string, requestedActor: Actor, signal?: AbortSignal) => {
    let actor = requestedActor;
    let steps: Array<{ tool: 'inspect_telemetry' | 'inspect_failure' | 'measure_constraint' | 'optimize_design' | 'run_simulation'; metric: string; objective: string }> = [
      { tool: 'inspect_telemetry', metric: '', objective: '' },
      { tool: 'inspect_failure', metric: '', objective: '' },
      { tool: 'measure_constraint', metric: failed.metrics.measures.find((item) => item.status === 'fail')?.metric ?? '', objective: '' },
      { tool: 'optimize_design', metric: '', objective: 'minimize normalized constraint violation while preserving human locks' },
      { tool: 'run_simulation', metric: '', objective: '' },
    ];
    if (requestedActor === 'ModelAgent') {
      try {
        const response = await requestAgentRedesign(prompt, {
          run_id: failed.id,
          machine_name: getSnapshot().goal?.machineName ?? 'Mechanical system',
          summary: failed.diagnosis.summary,
          evidence: `${failed.diagnosis.evidence} ${failed.diagnosis.action}`,
          failed_metrics: failed.metrics.measures.filter((item) => item.status === 'fail').map((item) => ({ metric: item.metric, label: item.label, value: item.value, target: item.target, unit: item.unit, operator: item.operator })),
          human_locks: getSnapshot().humanConstraints.map((item) => ({ component_id: item.componentId, fields: item.fields })),
        }, agentKey || undefined, signal);
        setAgentModel(response.model);
        steps = response.result.tool_sequence;
        if (!steps.some((step) => step.tool === 'optimize_design')) steps = [...steps.filter((step) => step.tool !== 'run_simulation'), { tool: 'optimize_design', metric: '', objective: response.result.objective }, ...steps.filter((step) => step.tool === 'run_simulation')];
        if (steps.at(-1)?.tool !== 'run_simulation') steps.push({ tool: 'run_simulation', metric: '', objective: '' });
        addTrace('reasoning', 'Model diagnosed the failed trial', response.result.diagnosis);
        addTrace('action', 'Model selected the evidence loop', steps.map((step) => step.tool).join(' → '));
      } catch (caught) {
        actor = 'Deterministic'; setAgentRuntime('deterministic');
        addTrace('fallback', 'Model redesign unavailable', `${caught instanceof Error ? caught.message : 'The model request failed.'} Continuing with the bounded local evidence loop.`);
      }
    }
    const failedMetric = failed.metrics.measures.find((item) => item.status === 'fail');
    for (const step of steps.slice(0, 9)) {
      ensureActive(signal);
      if (step.tool === 'run_simulation') { must(await runMachine(actor)); continue; }
      if (step.tool === 'measure_constraint') {
        const metric = failed.metrics.measures.some((item) => item.metric === step.metric) ? step.metric : failedMetric?.metric;
        if (metric) await call(step.tool, { run_id: failed.id, metric }, 35, actor, signal);
        continue;
      }
      if (step.tool === 'optimize_design') await call(step.tool, { run_id: failed.id, objective: (step.objective || 'satisfy measured constraints with the smallest bounded redesign').slice(0, 120) }, 70, actor, signal);
      else await call(step.tool, { run_id: failed.id }, 40, actor, signal);
    }
    return actor;
  };

  const generateFromPrompt = async (prompt: string) => {
    if (busy) return;
    const requestedPrompt = prompt.trim();
    setGoalPrompt(prompt);
    if (requestedPrompt.length < 12) { setPromptError('Describe a physical goal with at least one requirement.'); return; }
    const controller = new AbortController(); abortRef.current = controller; setAgentCancelable(true);
    setBusy(true); setError(null); setPromptError(null);
    traceSeq.current += 1;
    setAgentTrace([{ id: `agent-trace-${traceSeq.current}`, kind: 'goal', title: 'New engineering mission', detail: requestedPrompt, at: new Date().toISOString() }]);
    try {
      let actor: Actor = runtimeActor();
      let planningPrompt = requestedPrompt;
      let modelAssumptions: string[] = [];
      let shouldUseModel = actor === 'ModelAgent';
      if (agentRuntime === 'checking' && !agentKey) {
        try {
          const status = await getAgentStatus(controller.signal);
          setAgentModel(status.model); setAgentRuntime(status.configured ? 'server-model' : 'deterministic');
          shouldUseModel = status.configured; actor = status.configured ? 'ModelAgent' : 'Deterministic';
        } catch { setAgentRuntime('deterministic'); actor = 'Deterministic'; shouldUseModel = false; }
      }
      if (agentKey) { shouldUseModel = true; actor = 'ModelAgent'; setAgentRuntime('session-model'); }
      if (shouldUseModel) {
        addTrace('action', 'Asking the model to plan', 'Interpreting constraints, selecting a composable architecture, and choosing verification metrics.');
        try {
          const response = await requestAgentPlan(requestedPrompt, agentKey || undefined, controller.signal);
          planningPrompt = response.result.normalized_prompt; modelAssumptions = response.result.assumptions;
          setAgentModel(response.model);
          addTrace('reasoning', response.result.reasoning_summary, `Architecture: ${response.result.architecture.join(' · ')}. Verify: ${response.result.verification_focus.join(', ')}.`);
        } catch (caught) {
          actor = 'Deterministic'; setAgentRuntime('deterministic');
          addTrace('fallback', 'Switched to the local engineer', `${caught instanceof Error ? caught.message : 'The model request failed.'} The deterministic planner will still build, simulate, and repair the machine.`);
        }
      } else addTrace('fallback', 'Local deterministic engineer active', 'No model key is connected. This mode still executes the guarded world tools and real Rapier simulation; connect a model for model-selected planning and redesign decisions.');

      let plan;
      try { plan = compileDesignBrief(planningPrompt); }
      catch (caught) { throw new Error(caught instanceof Error ? caught.message.replace(/^[A-Z_]+:\s*/, '') : 'The physical goal could not be decomposed.'); }
      plan.brief = requestedPrompt; plan.goal.brief = requestedPrompt;
      plan.assumptions = [...modelAssumptions, ...plan.assumptions].filter((item, index, list) => list.indexOf(item) === index).slice(0, 10);
      addTrace('reasoning', 'World plan compiled', `${plan.assemblies.length} assemblies, ${plan.components.length} bodies, ${plan.joints.length} joints, ${plan.motors.length + plan.actuators.length} drives, and ${plan.controls.length} control loops.`);

      reset('lab'); await pause(40); ensureActive(controller.signal);
      await call('inspect_primitive_catalog', {}, 45, actor, controller.signal);
      await call('set_design_goal', {
        machine_name: plan.goal.machineName, domain: plan.goal.domain, brief: plan.brief,
        summary: plan.goal.summary, capabilities: plan.goal.capabilities, constraints: plan.goal.constraints,
        max_components: plan.goal.maxComponents, assumptions: plan.assumptions,
        disclaimer: plan.goal.disclaimer, simulation_model: plan.goal.simulationModel,
        editable_component_id: plan.goal.editableComponentId, editable_label: plan.goal.editableLabel,
        world: { gravity: plan.world.gravity, duration: plan.world.duration, bounds: plan.world.bounds, environment: plan.world.environment },
      }, 35, actor, controller.signal);
      addTrace('action', 'Building the shared world', 'Creating the planned bodies, connections, joints, sensors, actuators, and control channels through guarded tools.');
      for (const item of plan.assemblies) await call('create_assembly', { assembly_id: item.id, name: item.name, purpose: item.purpose, parent_id: item.parentId }, 20, actor, controller.signal);
      for (const item of plan.components) await call('create_component', {
        component_id: item.id, primitive: item.primitive, assembly_id: item.assemblyId, role: item.role,
        position: item.position, rotation: item.rotation, dimensions: item.dimensions, material_id: item.materialId,
        body_type: item.bodyType, mass: item.mass, color: item.color, parameters: item.parameters,
      }, 20, actor, controller.signal);
      const connected = new Set<string>();
      for (const item of plan.connections) {
        connected.add([item.sourceId, item.targetId].sort().join('-'));
        await call('connect_components', { connection_id: item.id, source_id: item.sourceId, target_id: item.targetId, connection_type: item.type, channel: item.channel }, 20, actor, controller.signal);
      }
      for (const [index, item] of plan.joints.entries()) {
        const pair = [item.componentA, item.componentB].sort().join('-');
        if (!connected.has(pair)) {
          connected.add(pair);
          await call('connect_components', { connection_id: `edge-${index + 1}`, source_id: item.componentA, target_id: item.componentB, connection_type: 'mechanical', channel: item.type }, 20, actor, controller.signal);
        }
        await call('create_joint', { joint_id: item.id, joint_type: item.type, component_a: item.componentA, component_b: item.componentB, anchor_a: item.anchorA, anchor_b: item.anchorB, axis: item.axis, limits: item.limits, ratio: item.ratio, stiffness: item.stiffness, damping: item.damping }, 20, actor, controller.signal);
      }
      for (const item of plan.motors) await call('add_motor', { motor_id: item.id, component_id: item.componentId, joint_id: item.jointId, max_torque: item.maxTorque, max_rpm: item.maxRpm, direction: item.direction }, 20, actor, controller.signal);
      for (const item of plan.sensors) await call('add_sensor', { sensor_id: item.id, component_id: item.componentId, sensor_type: item.type, channel: item.channel, target_id: item.targetId, range: item.range }, 20, actor, controller.signal);
      for (const item of plan.actuators) await call('add_actuator', { actuator_id: item.id, component_id: item.componentId, joint_id: item.jointId, actuator_type: item.type, max_force: item.maxForce, max_speed: item.maxSpeed, travel: item.travel }, 20, actor, controller.signal);
      for (const item of plan.controls) await call('set_control_logic', { control_id: item.id, name: item.name, mode: item.mode, sensor_ids: item.sensorIds, actuator_ids: item.actuatorIds, expression: item.expression, setpoint: item.setpoint, kp: item.kp, ki: item.ki, kd: item.kd, calibration_x: item.calibrationX }, 20, actor, controller.signal);

      addTrace('action', 'Running the first physics trial', 'Instantiating the current world in Rapier at 60 Hz and measuring every registered constraint.');
      must(await runMachine(actor));
      const firstRun = getSnapshot().runs.at(-1);
      if (firstRun) addTrace('observation', firstRun.status === 'passed' ? 'Physics accepted the first design' : 'Physics rejected the first design', `${firstRun.diagnosis.summary} Constraint score: ${firstRun.metrics.score}%.`);
      for (let iteration = 0; iteration < 2 && getSnapshot().runs.at(-1)?.status === 'failed'; iteration += 1) {
        const failed = getSnapshot().runs.at(-1)!;
        setToast(`${failed.diagnosis.summary} — agent is inspecting the evidence`);
        actor = await redesignRun(failed, requestedPrompt, actor, controller.signal);
        const rerun = getSnapshot().runs.at(-1);
        if (rerun) addTrace('observation', `Trial ${rerun.id} ${rerun.status}`, `${rerun.metrics.score}% constraint score · objective ${rerun.objective.toFixed(3)}.`);
      }
      const finalRun = getSnapshot().runs.at(-1);
      if (finalRun?.status !== 'passed') throw new Error('The bounded optimizer still misses a target. Open telemetry to inspect the remaining physical constraint.');
      addTrace('complete', 'Engineering mission complete', `${plan.goal.machineName} passes ${finalRun.metrics.measures.filter((item) => item.status === 'pass').length}/${finalRun.metrics.measures.length} measured constraints with ${plan.components.length} generated bodies.`);
      setToast(`${plan.goal.machineName} engineered from ${plan.components.length} primitives · ${finalRun.metrics.score}% constraints pass`);
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') { addTrace('observation', 'Engineering run stopped', 'The current agent run was cancelled. The last committed world revision is still available.'); setToast('Agent run cancelled'); }
      else { const message = caught instanceof Error ? caught.message : 'The machine could not be engineered.'; setError(message); addTrace('error', 'Engineering run stopped', message); }
    } finally { abortRef.current = null; setAgentCancelable(false); setBusy(false); }
  };

  const diagnoseAndFix = async () => {
    if (busy) return; setBusy(true); setError(null);
    try {
      const failed = getSnapshot().runs.at(-1);
      if (!failed || failed.status !== 'failed') throw new Error('Run a failing physics trial before optimizing.');
      addTrace('action', 'Redesign requested', 'The agent is reading the failed trial before changing the world.');
      await redesignRun(failed, goalPrompt, runtimeActor());
      const repaired = getSnapshot().runs.at(-1);
      if (repaired?.status !== 'passed') throw new Error('One or more constraints still fail after the bounded redesign.');
      addTrace('complete', 'Measured redesign accepted', `${repaired.metrics.score}% constraint score after the agent-selected evidence loop.`);
      setToast('Measured redesign passes every constraint');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The redesign could not finish.'); }
    finally { setBusy(false); }
  };

  const retuneHumanEdit = async () => {
    if (busy) return; setBusy(true); setError(null);
    try {
      let actor = runtimeActor();
      const before = getSnapshot();
      const preserved = before.humanConstraints.map((constraint) => {
        const component = before.components.find((item) => item.id === constraint.componentId);
        return { componentId: constraint.componentId, fields: [...constraint.fields], values: component ? { position: component.position, rotation: component.rotation, dimensions: component.dimensions, material: [component.materialId, component.color], mass: component.mass } : null };
      });
      if (!preserved.length || preserved.some((item) => !item.values)) throw new Error('Edit a component in the shared world first.');
      await call('inspect_workspace', { since_revision: Math.max(0, before.revision - 2) }, 60, actor);
      must(await runMachine(actor));
      for (let iteration = 0; iteration < 2 && getSnapshot().runs.at(-1)?.status === 'failed'; iteration += 1) {
        const failed = getSnapshot().runs.at(-1)!;
        actor = await redesignRun(failed, `${goalPrompt}\nPreserve every human-authored field and retune the surrounding design.`, actor);
      }
      const after = getSnapshot();
      const final = after.runs.at(-1);
      if (final?.status !== 'passed') throw new Error('The redesign still misses a target; your geometry remains locked.');
      for (const item of preserved) {
        const current = after.components.find((component) => component.id === item.componentId)!;
        for (const field of item.fields) {
          const currentValue = field === 'material' ? [current.materialId, current.color] : current[field];
          if (JSON.stringify(currentValue) !== JSON.stringify(item.values![field])) throw new Error(`The human-authored ${field} on ${current.role} was not preserved.`);
        }
      }
      setToast(`Agent redesigned around ${preserved.length} human-edited ${preserved.length === 1 ? 'body' : 'bodies'}; every lock was preserved`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The human-edit redesign could not finish.'); }
    finally { setBusy(false); }
  };

  const runHeaderSimulation = async () => {
    if (!state.components.length) return generateFromPrompt(goalPrompt);
    if (busy) return;
    setBusy(true); setError(null);
    const result = await runMachine('UI');
    if (!result.ok) setError(result.error.message); else setToast(`Physics run ${getSnapshot().phase}`);
    setBusy(false);
  };

  const handleEditableMove = (componentId: string, x: number) => {
    if (busy) return setToast('Wait for the active physics run to finish');
    const result = moveComponentAsHuman(componentId, x);
    if (!result.ok) setError(result.error.message);
    else { patchUi({ selectedComponentId: componentId, replayRunId: null }); setToast(`Human geometry locked at x ${x.toFixed(2)} m — prior calibration is stale`); }
  };

  const selected = state.components.find((item) => item.id === state.selectedComponentId) ?? null;
  const manualUpdate = (name: ForgeToolName, input: Record<string, unknown>, message: string) => {
    if (busy) return;
    const result = command(name, input, 'Human');
    if (!result.ok) setError(result.error.message); else { patchUi({ replayRunId: null }); setToast(message); }
  };
  const addPrimitive = (kind: PrimitiveKind) => {
    if (!state.goal || !state.assemblies[0]) return setToast('Enter a design goal before adding a primitive');
    const item = catalogFor(kind); let index = state.components.filter((component) => component.primitive === kind).length + 1;
    while (state.components.some((component) => component.id === `${kind}-manual-${index}`)) index += 1;
    const componentId = `${kind}-manual-${index}`;
    const result = command('create_component', { component_id: componentId, primitive: kind, assembly_id: state.assemblies[0].id, role: `manual ${item.name.toLowerCase()}`, position: [0, 1 + index * .08, 0], rotation: [0, 0, 0], dimensions: item.defaultDimensions, material_id: item.defaultMaterial, body_type: item.defaultBodyType }, 'Human');
    if (!result.ok) setError(result.error.message); else { patchUi({ selectedComponentId: componentId }); setDrawer(null); setToast(`${item.name} added to the shared world`); }
  };

  const undo = () => {
    const target = state.revisions.at(-2);
    if (!target) return setToast('No earlier revision to restore');
    const result = command('restore_revision', { revision: target.revision }, 'UI');
    if (!result.ok) setError(result.error.message); else setToast(`Restored revision ${target.revision} as a new head`);
  };

  const connectTemporaryModel = (key: string) => {
    const value = key.trim();
    if (value.length < 20) { setError('Enter a complete OpenAI API key. It stays only in this browser tab.'); return; }
    setAgentKey(value); setAgentRuntime('session-model'); setAgentSettingsOpen(false);
    setToast('Model connected for this tab — the next mission will use model-selected planning');
  };
  const disconnectTemporaryModel = () => {
    setAgentKey(''); setAgentRuntime('checking'); setAgentSettingsOpen(false);
    void getAgentStatus().then((status) => { setAgentModel(status.model); setAgentRuntime(status.configured ? 'server-model' : 'deterministic'); }).catch(() => setAgentRuntime('deterministic'));
    setToast('Temporary model key removed from this tab');
  };
  const cancelAgentRun = () => { abortRef.current?.abort(); setAgentCancelable(false); };

  const modelEditCommands = (actions: AgentEditAction[]): EditCommand[] => actions.map((action, index) => {
    if (action.tool === 'set_dimensions') return { tool: action.tool, input: { component_id: action.component_id, dimensions: action.dimensions }, label: `Resize ${action.component_id}` };
    if (action.tool === 'set_material') return { tool: action.tool, input: { component_id: action.component_id, material_id: action.material_id }, label: `Change ${action.component_id} material` };
    if (action.tool === 'set_mass') return { tool: action.tool, input: { component_id: action.component_id, mass: action.mass }, label: `Retune ${action.component_id} mass` };
    if (action.tool === 'move_component') return { tool: action.tool, input: { component_id: action.component_id, position: action.position }, label: `Move ${action.component_id}` };
    if (action.tool === 'rotate_component') return { tool: action.tool, input: { component_id: action.component_id, rotation: action.rotation }, label: `Rotate ${action.component_id}` };
    if (action.tool === 'remove_component') return { tool: action.tool, input: { component_id: action.component_id }, label: `Remove ${action.component_id}` };
    if (action.tool === 'create_component') return { tool: action.tool, input: { component_id: action.component_id, primitive: action.primitive, assembly_id: action.assembly_id, role: action.role, position: action.position, rotation: action.rotation, dimensions: action.dimensions, material_id: action.material_id, body_type: action.body_type, ...(action.mass > 0 ? { mass: action.mass } : {}) }, label: `Create ${action.role || action.primitive}` };
    if (action.tool === 'connect_components') return { tool: action.tool, input: { connection_id: `chat-edge-${getSnapshot().revision + index + 1}`, source_id: action.source_id, target_id: action.target_id, connection_type: action.connection_type, channel: action.channel || 'chat_edit' }, label: `Connect ${action.source_id} to ${action.target_id}` };
    return { tool: 'create_joint', input: { joint_id: action.joint_id, joint_type: action.joint_type, component_a: action.source_id, component_b: action.target_id, anchor_a: [0, 0, 0], anchor_b: [0, 0, 0], axis: action.axis, limits: action.limits }, label: `Joint ${action.source_id} to ${action.target_id}` };
  });

  const localEditCommands = (instruction: string): EditCommand[] => {
    const world = getSnapshot();
    const text = instruction.toLowerCase();
    const aliases: Record<string, string[]> = { boom: ['boom'], mast: ['mast'], base: ['base', 'chassis'], wheel: ['wheel'], counterweight: ['counterweight'], sensor: ['sensor', 'camera'], gripper: ['gripper'], arm: ['serial link', 'link'], platform: ['platform'], bridge: ['span', 'deck'], gear: ['gear'], conveyor: ['conveyor', 'transport surface'], support: ['support', 'outrigger'] };
    const named = Object.entries(aliases).find(([name]) => text.includes(name))?.[1] ?? [];
    const target = world.components.find((item) => named.some((term) => item.role.includes(term)))
      ?? world.components.find((item) => item.id === world.selectedComponentId)
      ?? world.components.find((item) => !item.humanLockedFields.length);
    if (!target) throw new Error('Select or name a component to edit.');
    const primitiveRequest = primitiveCatalog.find((item) => new RegExp(`\\b${item.kind}s?\\b`).test(text));
    if (/\b(add|create|attach)\b/.test(text) && primitiveRequest) {
      const count = world.components.filter((item) => item.primitive === primitiveRequest.kind).length + 1;
      const id = `chat-${primitiveRequest.kind}-${count}`;
      const assemblyId = target.assemblyId || world.assemblies[0].id;
      return [
        { tool: 'create_component', input: { component_id: id, primitive: primitiveRequest.kind, assembly_id: assemblyId, role: `chat-added ${primitiveRequest.name.toLowerCase()}`, position: [target.position[0], target.position[1] + Math.max(.35, target.dimensions[1]), target.position[2]], rotation: [0, 0, 0], dimensions: primitiveRequest.defaultDimensions, material_id: primitiveRequest.defaultMaterial, body_type: primitiveRequest.defaultBodyType }, label: `Add ${primitiveRequest.name}` },
        { tool: 'connect_components', input: { connection_id: `chat-edge-${world.revision + 2}`, source_id: target.id, target_id: id, connection_type: 'mechanical', channel: 'chat_edit' }, label: `Connect ${primitiveRequest.name}` },
        { tool: 'create_joint', input: { joint_id: `chat-fixed-${world.revision + 3}`, joint_type: 'fixed', component_a: target.id, component_b: id, anchor_a: [0, 0, 0], anchor_b: [0, 0, 0], axis: [0, 1, 0] }, label: `Fix ${primitiveRequest.name} to ${target.role}` },
      ];
    }
    if (/\b(remove|delete)\b/.test(text)) return [{ tool: 'remove_component', input: { component_id: target.id }, label: `Remove ${target.role}` }];
    const material = materials.find((item) => text.includes(item.id));
    if (material) return [{ tool: 'set_material', input: { component_id: target.id, material_id: material.id }, label: `Use ${material.name}` }];
    if (/\b(heavier|increase mass|more mass)\b/.test(text)) return [{ tool: 'set_mass', input: { component_id: target.id, mass: Number((target.mass * 1.25).toFixed(3)) }, label: `Increase ${target.role} mass` }];
    if (/\b(lighter|reduce mass|less mass)\b/.test(text)) return [{ tool: 'set_mass', input: { component_id: target.id, mass: Number((target.mass * .8).toFixed(3)) }, label: `Reduce ${target.role} mass` }];
    const distance = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:m|meter)/)?.[1] ?? .5);
    const moved = [...target.position] as [number, number, number];
    if (/\b(left)\b/.test(text)) moved[0] -= distance;
    if (/\b(right)\b/.test(text)) moved[0] += distance;
    if (/\b(up|higher|raise)\b/.test(text)) moved[1] += distance;
    if (/\b(down|lower)\b/.test(text)) moved[1] -= distance;
    if (/\b(forward)\b/.test(text)) moved[2] += distance;
    if (/\b(back|backward)\b/.test(text)) moved[2] -= distance;
    if (moved.some((value, index) => value !== target.position[index])) return [{ tool: 'move_component', input: { component_id: target.id, position: moved }, label: `Move ${target.role}` }];
    if (/\brotate|angle|tilt\b/.test(text)) {
      const degrees = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:°|degrees?)/)?.[1] ?? 15);
      return [{ tool: 'rotate_component', input: { component_id: target.id, rotation: [target.rotation[0], target.rotation[1], target.rotation[2] + degrees * Math.PI / 180] }, label: `Rotate ${target.role}` }];
    }
    const scale = /\b(shorter|smaller|narrower|reduce|shrink)\b/.test(text) ? .8 : /\b(much|significantly)\b/.test(text) ? 1.4 : 1.2;
    const dimensions = [...target.dimensions] as [number, number, number];
    if (/\b(taller|height)\b/.test(text)) dimensions[1] *= scale;
    else if (/\b(wider|width|stabil|outrigger)\b/.test(text)) { dimensions[0] *= scale; dimensions[2] *= scale; }
    else {
      const axis = dimensions.indexOf(Math.max(...dimensions)); dimensions[axis] *= scale;
    }
    return [{ tool: 'set_dimensions', input: { component_id: target.id, dimensions: dimensions.map((value) => Number(value.toFixed(3))) }, label: `Resize ${target.role}` }];
  };

  const editWithChat = async (instruction: string) => {
    const prompt = instruction.trim();
    if (busy || prompt.length < 3) return;
    if (!state.components.length) { setError('Engineer a machine before editing it with chat.'); return; }
    const userMessage: EditMessage = { id: `edit-user-${Date.now()}`, role: 'user', text: prompt };
    setEditMessages((current) => [...current, userMessage].slice(-18)); setEditPrompt('');
    const controller = new AbortController(); abortRef.current = controller; setAgentCancelable(true); setBusy(true); setError(null);
    let actor = runtimeActor();
    try {
      await call('inspect_workspace', { since_revision: Math.max(0, state.revision - 1) }, 35, actor, controller.signal);
      let commands: EditCommand[];
      let summary: string;
      if (actor === 'ModelAgent') {
        addTrace('action', 'Model is editing the current world', prompt);
        try {
          const current = getSnapshot();
          const response = await requestAgentEdit(prompt, {
            machine_name: current.goal?.machineName ?? 'Mechanical system', goal: current.goal?.brief ?? goalPrompt,
            selected_component_id: current.selectedComponentId ?? '', assembly_ids: current.assemblies.map((item) => item.id),
            components: current.components.map((item) => ({ id: item.id, role: item.role, primitive: item.primitive, assembly_id: item.assemblyId, position: item.position, rotation: item.rotation, dimensions: item.dimensions, material_id: item.materialId, body_type: item.bodyType, mass: item.mass, human_locked_fields: item.humanLockedFields })),
          }, agentKey || undefined, controller.signal);
          setAgentModel(response.model); summary = response.result.summary; commands = modelEditCommands(response.result.actions);
          addTrace('reasoning', 'Model proposed an in-place revision', summary);
        } catch (caught) {
          actor = 'Deterministic'; setAgentRuntime('deterministic'); commands = localEditCommands(prompt);
          summary = `The model was unavailable, so the local chat interpreter applied: ${commands.map((item) => item.label).join(' · ')}.`;
          addTrace('fallback', 'Local chat editor took over', caught instanceof Error ? caught.message : 'The model edit request failed.');
        }
      } else {
        commands = localEditCommands(prompt); summary = `Local chat edit: ${commands.map((item) => item.label).join(' · ')}.`;
      }
      for (const edit of commands) await call(edit.tool, edit.input, 45, actor, controller.signal);
      addTrace('action', 'Chat revision committed', commands.map((item) => item.tool).join(' → '));
      must(await runMachine(actor));
      for (let iteration = 0; iteration < 2 && getSnapshot().runs.at(-1)?.status === 'failed'; iteration += 1) actor = await redesignRun(getSnapshot().runs.at(-1)!, `${goalPrompt}\nThe user then requested this in-place edit: ${prompt}`, actor, controller.signal);
      const final = getSnapshot().runs.at(-1);
      const resultText = `${summary} ${final?.status === 'passed' ? `Physics passes at ${final.metrics.score}% after the edit.` : 'The revision is applied; open telemetry to inspect the remaining failed constraint.'}`;
      setEditMessages((current) => [...current, { id: `edit-agent-${Date.now()}`, role: 'agent' as const, text: resultText }].slice(-18));
      addTrace(final?.status === 'passed' ? 'complete' : 'observation', 'Chat edit verified', resultText);
      setToast(final?.status === 'passed' ? 'Chat edit applied and physics verified' : 'Chat edit applied; inspect the remaining constraint');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The chat edit could not be applied.';
      setEditMessages((current) => [...current, { id: `edit-agent-${Date.now()}`, role: 'agent' as const, text: message }].slice(-18)); setError(message);
    } finally { abortRef.current = null; setAgentCancelable(false); setBusy(false); }
  };
  const enterScratchWorld = () => {
    if (busy) return;
    reset('lab');
    const goalResult = command('set_design_goal', {
      machine_name: 'Untitled mechanism', domain: 'Manual sandbox', brief: 'Manually assemble a new mechanical system from reusable primitives.',
      summary: 'An unconstrained scratch world for human-led assembly.', capabilities: ['structure'],
      constraints: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 80, unit: '', source: 'inferred' }],
      max_components: 80, assumptions: ['Concept-level manual assembly'], disclaimer: 'Concept-level rigid-body sandbox; not a fabrication or safety certification.', simulation_model: 'Rapier rigid bodies plus registered reduced-order metrics.',
      world: { gravity: [0, -9.81, 0], duration: 8, bounds: [16, 10, 12], environment: 'bounded industrial lab' },
    }, 'UI');
    if (!goalResult.ok) { setError(goalResult.error.message); return; }
    const assemblyResult = command('create_assembly', { assembly_id: 'scratch-assembly', name: 'Scratch assembly', purpose: 'Human-authored primitive workspace.' }, 'UI');
    if (!assemblyResult.ok) { setError(assemblyResult.error.message); return; }
    addTrace('goal', 'Manual sandbox opened', 'Add primitives from the catalog, edit their physical fields, connect them through WebMCP, or enter a new goal at any time.');
    setToast('Scratch world ready — the primitive library is unlocked');
  };

  if (state.screen === 'landing') return <><Landing state={state} toolCount={registeredTools} prompt={goalPrompt} promptError={promptError} busy={busy} agentRuntime={agentRuntime} agentModel={agentModel} onConfigureAgent={() => setAgentSettingsOpen(true)} onPromptChange={updateGoalPrompt} onEnter={enterScratchWorld} onGenerate={generateFromPrompt} onExample={(example) => { setGoalPrompt(example.prompt); setPromptError(null); }} />{agentSettingsOpen && <AgentSettingsDialog runtime={agentRuntime} model={agentModel} hasTemporaryKey={Boolean(agentKey)} onConnect={connectTemporaryModel} onDisconnect={disconnectTemporaryModel} onClose={() => setAgentSettingsOpen(false)} />}</>;

  const latestRun = state.runs.at(-1) ?? null;
  const firstFailedRun = state.runs.find((run) => run.status === 'failed') ?? null;
  const humanChallenge = state.phase === 'passed' && !state.humanConstraints.length;
  const humanEdited = state.humanConstraints.length > 0 && (!latestRun || latestRun.designHash !== state.designHash);
  const finalHumanPass = state.phase === 'passed' && state.humanConstraints.length > 0 && latestRun?.designHash === state.designHash;

  return <div className="forge-shell"><a className="skip-link" href="#forge-main">Skip to engineering workspace</a>
    <header className="forge-header">
      <button className="brand-lockup" aria-label="ForgeTwin home" onClick={() => patchUi({ screen: 'landing' })} disabled={busy}><span className="brand-mark"><span>F</span></span><span><strong>ForgeTwin</strong><small>world-first AI engineering</small></span></button>
      <div className="header-center"><span className={`live-dot ${agentRuntime === 'server-model' || agentRuntime === 'session-model' ? 'cyan' : ''}`} />{agentRuntime === 'server-model' || agentRuntime === 'session-model' ? `${agentModel} connected` : 'Local engineer ready'} <span className="header-divider" /> REV {state.revision.toString().padStart(2, '0')} <span className="header-divider" /> {registeredTools === FORGE_TOOL_COUNT ? `${registeredTools} WebMCP tools live` : 'WebMCP host not connected'}</div>
      <div className="header-actions"><button className="ghost-button chat-edit-button" disabled={busy} onClick={() => setSideTab('chat')}><MessageSquareText size={14} />Edit with chat</button><button className="ghost-button" disabled={busy} onClick={() => setAgentSettingsOpen(true)}><KeyRound size={14} />Agent</button><button className="ghost-button" disabled={busy} onClick={() => { checkpoint('Manual world checkpoint'); setToast('World checkpoint saved'); }}><Save size={14} />Checkpoint</button><button className="ghost-button" disabled={busy} onClick={undo}><Undo2 size={14} />Undo</button><button className="ghost-button" disabled={busy} onClick={() => setDrawer('compare')}><GitCompareArrows size={14} />Compare runs</button><button className="ghost-button" disabled={busy} onClick={() => { reset('landing'); setGoalPrompt(DEFAULT_DESIGN_PROMPT); setPromptError(null); setAgentTrace([]); setEditMessages([]); setToast('Sandbox reset — ready for any mechanical goal'); }}><RotateCcw size={14} />Reset</button><button className="run-button" onClick={runHeaderSimulation} disabled={busy}>{busy ? <Cpu size={14} /> : <Play size={14} fill="currentColor" />}{busy ? 'Engineering…' : 'Run physics'}</button></div>
    </header>
    <main id="forge-main" className="forge-main">
      <aside className="catalog-panel" aria-label="World hierarchy">
        <div className="panel-heading"><div><span className="eyebrow">Generated world graph</span><h2>Assemblies</h2></div><button aria-label="Open primitive catalog" onClick={() => setDrawer('catalog')}><Settings2 size={16} /></button></div>
        <div className="capacity"><span>{state.components.length} / {state.goal?.maxComponents ?? 80} bodies</span><span>{state.joints.length} joints</span><i><b style={{ width: `${Math.min(100, state.components.length / (state.goal?.maxComponents ?? 80) * 100)}%` }} /></i></div>
        <AssemblyTree state={state} onSelect={(id) => patchUi({ selectedComponentId: id })} />
        {!state.components.length && <div className="empty-feed"><Layers3 size={23} /><strong>Empty physical world</strong><p>Enter a goal and the agent will create assemblies from low-level primitives.</p></div>}
        <div className="constraint-card"><span className="eyebrow">{state.goal?.domain ?? 'World-first planner'}</span><p>{state.goal?.summary ?? 'Describe a physical system. The planner composes reusable bodies, joints, devices, and controls instead of selecting a machine template.'}</p>{state.goal?.brief && <blockquote>“{state.goal.brief}”</blockquote>}<button onClick={() => setGoalOpen((value) => !value)} aria-expanded={goalOpen}>Inspect constraints <ChevronDown size={14} className={goalOpen ? 'rotate-180' : ''} /></button>{goalOpen && <ul className="constraint-list">{state.goal?.constraints.map((constraint) => <li key={constraint.metric}><Check size={11} />{constraint.label} {constraintSymbol(constraint.operator)} {constraint.target}{constraint.unit}</li>)}<li><Check size={11} />Rapier · 60 Hz · seed 424242</li></ul>}<button className="new-goal-link" onClick={() => patchUi({ screen: 'landing' })}>Engineer a different system</button></div>
        {selected && <ComponentInspector component={selected} state={state} busy={busy} onMove={(x) => handleEditableMove(selected.id, x)} onUpdate={manualUpdate} />}
      </aside>
      <section className="viewport-panel" aria-label="3D mechanical world">
        <ForgeScene state={state} onComponentMove={handleEditableMove} onSelect={(id) => patchUi({ selectedComponentId: id || null })} />
        <div className="viewport-topbar"><div className="scene-path"><span>{state.goal?.domain ?? 'Mechanical world'}</span><i>/</i><strong>{state.goal?.machineName ?? 'Empty sandbox'}</strong>{selected && <><i>/</i><b>{selected.role}</b></>}</div><div className="view-controls"><button onClick={() => patchUi({ xray: !state.xray })} aria-pressed={state.xray} className={state.xray ? 'active' : ''}><Layers3 size={14} />X-Ray</button><button onClick={() => setDrawer('telemetry')}><Gauge size={14} />Telemetry</button><button onClick={() => { setSideTab('history'); setDrawer('history'); }}><History size={14} />Revisions</button></div></div>
        <div className="viewport-status"><span className="live-dot cyan" />RAPIER MULTI-BODY <i />60 HZ <i />SEED 424242 <i />{state.components.length} BODIES · {state.joints.length} JOINTS</div>
        {!state.components.length && <div className="empty-machine-card"><span className="goal-avatar"><Sparkles size={18} /></span><span className="eyebrow">General-purpose physical sandbox</span><h1>Describe the system.<br />ForgeTwin builds the world.</h1><p>No profile selector. The agent creates reusable primitives, physical properties, joints, sensing, actuation, and control logic from scratch.</p><GoalComposer id="lab-design-goal" prompt={goalPrompt} error={promptError} busy={busy} compact agentRuntime={agentRuntime} onPromptChange={updateGoalPrompt} onGenerate={generateFromPrompt} /></div>}
        {state.phase === 'failed' && latestRun && <FailureBanner run={latestRun} onReplay={() => patchUi({ replayRunId: latestRun.id, replayMode: 'failure' })} onFix={diagnoseAndFix} busy={busy} />}
        {humanChallenge && <div className="challenge-banner"><span className="challenge-icon"><Move3D size={18} /></span><div><span className="eyebrow">Generated + physics verified</span><strong>Now perturb the shared world yourself.</strong><p>Select or drag the highlighted {state.goal?.editableLabel}. The agent must preserve your change and redesign around it.</p></div><div className="challenge-actions">{firstFailedRun && <button className="secondary" onClick={() => patchUi({ replayRunId: firstFailedRun.id, replayMode: 'failure' })}><TimerReset size={13} />Replay failure</button>}<button onClick={() => { patchUi({ selectedComponentId: state.goal?.editableComponentId ?? null, xray: true }); setToast(`Selected ${state.goal?.editableLabel}`); }}>Select editable body</button></div></div>}
        {humanEdited && <div className="challenge-banner human"><span className="challenge-icon"><Radio size={18} /></span><div><span className="eyebrow">Human edit detected</span><strong>{state.humanConstraints.length} {state.humanConstraints.length === 1 ? 'body has' : 'bodies have'} locked fields.</strong><p>{state.humanConstraints.map((item) => `${state.components.find((component) => component.id === item.componentId)?.role ?? item.componentId}: ${item.fields.join(', ')}`).join(' · ')}. The agent will preserve every field and redesign the surrounding world.</p></div><button onClick={retuneHumanEdit} disabled={busy}>{busy ? 'Redesigning…' : 'Redesign around my change'}</button></div>}
        {finalHumanPass && latestRun && <div className="pass-banner"><span><BadgeCheck size={20} /></span><div><strong>All constraints pass with the human edit preserved.</strong><p>{latestRun.metrics.measures.slice(0, 3).map((item) => `${item.label} ${item.value}${item.unit}`).join(' · ')}</p></div><button onClick={() => setDrawer('compare')}>Compare designs</button></div>}
      </section>
      <aside className="agent-panel" aria-label="Agent activity"><div className="side-tabs"><button className={sideTab === 'chat' ? 'active' : ''} onClick={() => setSideTab('chat')}><MessageSquareText size={13} />Chat edit</button><button className={sideTab === 'activity' ? 'active' : ''} onClick={() => setSideTab('activity')}><Activity size={13} />Activity</button><button className={sideTab === 'history' ? 'active' : ''} onClick={() => setSideTab('history')}><History size={13} />History</button></div>{sideTab === 'chat' ? <AgentChat state={state} messages={editMessages} prompt={editPrompt} busy={busy} model={agentModel} modelConnected={agentRuntime === 'server-model' || agentRuntime === 'session-model'} selected={selected} onPromptChange={setEditPrompt} onSubmit={editWithChat} /> : sideTab === 'activity' ? <AgentFeed state={state} toolCount={registeredTools} trace={agentTrace} runtime={agentRuntime} model={agentModel} busy={busy} canCancel={agentCancelable} onCancel={cancelAgentRun} onConfigure={() => setAgentSettingsOpen(true)} /> : <RevisionHistory state={state} onRestore={(revision) => { const result = command('restore_revision', { revision }, 'UI'); if (result.ok) setToast(`Revision ${revision} restored`); else setError(result.error.message); }} />}<MetricStack metrics={latestRun?.designHash === state.designHash ? latestRun.metrics : null} phase={latestRun?.designHash === state.designHash ? state.phase : state.components.length ? 'ready' : state.phase} />{state.goal && <p className="model-note"><AlertTriangle size={12} />{state.goal.disclaimer}</p>}</aside>
    </main>
    {error && <div className="error-toast" role="alert"><AlertTriangle size={15} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X size={14} /></button></div>}
    {toast && <div className="success-toast" role="status"><Check size={14} />{toast}</div>}
    {drawer && <Drawer type={drawer} state={state} onClose={() => setDrawer(null)} onRestore={(revision) => { const result = command('restore_revision', { revision }, 'UI'); if (result.ok) setToast(`Revision ${revision} restored`); else setError(result.error.message); }} onAddPrimitive={addPrimitive} />}
    {agentSettingsOpen && <AgentSettingsDialog runtime={agentRuntime} model={agentModel} hasTemporaryKey={Boolean(agentKey)} onConnect={connectTemporaryModel} onDisconnect={disconnectTemporaryModel} onClose={() => setAgentSettingsOpen(false)} />}
    <div className="sr-only" aria-live="polite">{busy ? 'Agent is engineering the shared physical world' : toast ?? error ?? ''}</div>
  </div>;
}

function AssemblyTree({ state, onSelect }: { state: ForgeState; onSelect: (id: string) => void }) {
  const assemblyIds = new Set(state.assemblies.map((item) => item.id));
  const roots = state.assemblies.filter((item) => !item.parentId || !assemblyIds.has(item.parentId));
  const renderAssembly = (assemblyId: string, depth: number, path: Set<string>): React.ReactNode => {
    const assembly = state.assemblies.find((item) => item.id === assemblyId);
    if (!assembly || path.has(assemblyId)) return null;
    const nextPath = new Set(path).add(assemblyId);
    const children = state.assemblies.filter((item) => item.parentId === assemblyId);
    return <section key={assembly.id} className={`assembly-group ${depth ? 'nested' : ''}`} role="treeitem" aria-selected={false} aria-expanded={children.length ? true : undefined} aria-level={depth + 1} style={{ marginLeft: `${depth * 10}px` }}><header><Layers3 size={13} /><strong>{assembly.name}</strong><small>{assembly.componentIds.length + children.length}</small></header><div role="group">{assembly.componentIds.map((id) => { const item = state.components.find((component) => component.id === id); if (!item) return null; const Icon = ['sensor', 'camera'].includes(item.primitive) ? CircleDot : ['motor', 'servo', 'piston'].includes(item.primitive) ? Zap : ['beam', 'frame', 'support'].includes(item.primitive) ? Waypoints : Box; return <button key={item.id} role="treeitem" aria-level={depth + 2} className={`catalog-card ${state.selectedComponentId === item.id ? 'placed' : ''}`} onClick={() => onSelect(item.id)} aria-selected={state.selectedComponentId === item.id}><span className="catalog-icon"><Icon size={16} /></span><span><strong>{item.role}</strong><small>{item.primitive} · {item.mass.toFixed(1)} kg</small></span>{item.humanLockedFields.length ? <Radio size={12} /> : null}</button>; })}{children.map((child) => renderAssembly(child.id, depth + 1, nextPath))}</div></section>;
  };
  return <div className="catalog-list hierarchy-list" role="tree" aria-label="Generated assembly hierarchy"><div className="assembly-graph-summary" role="note"><span>{state.connections.length} edges</span><span>{state.sensors.length} sensors</span><span>{state.actuators.length + state.motors.length} drives</span><span>{state.controls.length} controls</span></div>{roots.map((root) => renderAssembly(root.id, 0, new Set()))}</div>;
}

function Landing({ state, toolCount, prompt, promptError, busy, agentRuntime, agentModel, onConfigureAgent, onPromptChange, onEnter, onGenerate, onExample }: { state: ForgeState; toolCount: number; prompt: string; promptError: string | null; busy: boolean; agentRuntime: AgentRuntimeMode; agentModel: string; onConfigureAgent: () => void; onPromptChange: (prompt: string) => void; onEnter: () => void; onGenerate: (prompt: string) => void; onExample: (example: EngineeringExample) => void }) {
  const modelConnected = agentRuntime === 'server-model' || agentRuntime === 'session-model';
  return <div className="landing-shell"><header className="landing-nav"><button className="brand-lockup" aria-label="ForgeTwin home" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><span className="brand-mark"><span>F</span></span><span><strong>ForgeTwin</strong><small>world-first AI engineering</small></span></button><div><span className={`landing-status ${modelConnected ? 'model-connected' : ''}`}><i />{agentRuntime === 'checking' ? 'Checking agent' : modelConnected ? `${agentModel} connected` : 'Local engineer ready'}</span><button className="ghost-button" onClick={onConfigureAgent}><KeyRound size={13} />{modelConnected ? 'Agent settings' : 'Connect AI'}</button><button className="ghost-button" onClick={onEnter}>Open sandbox</button></div></header>
    <main className="landing-hero"><div className="hero-copy"><span className="hero-kicker"><Sparkles size={13} />Agent-native physical engineering</span><h1>Don’t generate it.<br /><em>Engineer it.</em></h1><p>Describe almost any mechanical system. ForgeTwin decomposes the goal into reusable primitives, creates a jointed physical world, simulates it, measures failures, and redesigns the causal parts until the constraints pass.</p><GoalComposer id="design-goal" prompt={prompt} error={promptError} busy={busy} agentRuntime={agentRuntime} onPromptChange={onPromptChange} onGenerate={onGenerate} /><div className={`agent-runtime-card ${modelConnected ? 'connected' : 'local'}`}><span><Bot size={16} /></span><div><strong>{modelConnected ? `Flagship engineering agent · ${agentModel}` : 'Local deterministic engineer'}</strong><p>{modelConnected ? 'GPT-5.6 Sol plans, edits the existing world through chat, and selects evidence-driven redesigns. Every action still passes through guarded tools.' : 'Fully functional offline build, physics, telemetry, and bounded chat edits. Connect the flagship model for model-selected reasoning.'}</p></div><button type="button" onClick={onConfigureAgent}>{modelConnected ? 'Manage' : 'Connect model'}</button></div><div className="quick-examples" aria-label="Example engineering systems">{CHALLENGE_EXAMPLES.slice(0, 7).map((example) => <button key={example.id} type="button" onClick={() => onExample(example)}>{example.title}</button>)}</div><div className="hero-actions"><button className="ghost-button hero-secondary" onClick={onEnter} type="button"><Code2 size={15} />Explore empty world</button></div><div className="hero-proof"><span><strong>{primitiveCatalog.length}</strong> reusable primitives</span><span><strong>8</strong> joint types</span><span><strong>60 Hz</strong> multi-body physics</span></div></div>
      <div className="hero-machine"><ForgeScene state={state} preview onComponentMove={() => undefined} onSelect={() => undefined} /><div className="hero-hud top"><span>LIVE PHYSICAL WORLD</span><strong>PROMPT → PRIMITIVES → PHYSICS</strong></div><div className="hero-hud bottom"><span>NO COMPLETE-MACHINE TEMPLATES</span><strong>ASSEMBLIES ARE SYNTHESIZED</strong></div><div className="hero-orbit-label one"><i />Explicit mass + material</div><div className="hero-orbit-label two"><i />Joints + control graph</div></div></main>
    <section className="landing-strip" aria-label="How ForgeTwin works"><article><Cpu size={17} /><div><strong>Agent decomposes</strong><span>Goals become capabilities, constraints, bodies, joints, and control channels.</span></div></article><article><AlertTriangle size={17} /><div><strong>Physics rejects</strong><span>Mass, geometry, support, torque, contacts, and control become evidence.</span></div></article><article><Redo2 size={17} /><div><strong>Optimizer redesigns</strong><span>The agent changes causal fields and reruns the same shared world.</span></div></article><small>{toolCount === FORGE_TOOL_COUNT ? `${toolCount}/${FORGE_TOOL_COUNT} WebMCP tools live in this browser host` : `WebMCP host not connected · ${FORGE_TOOL_COUNT} local tools available`}</small></section>
    <section className="sector-library" aria-labelledby="sector-heading"><div><span className="eyebrow">Open engineering prompt gallery</span><h2 id="sector-heading">Crane, rover, gearbox, arm, bridge—or something new.</h2><p>These are editable prompts, not machine profiles. Each one is synthesized from the same low-level world vocabulary.</p></div><div className="sector-grid">{engineeringExamples.map((example) => <button key={example.id} onClick={() => { onExample(example); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span>{example.sector}</span><strong>{example.title}</strong><small>compose from primitives</small></button>)}</div><p className="simulation-disclosure">ForgeTwin is a concept-level rigid-body sandbox. Production structures, medical equipment, vehicles, and lifting systems require professional analysis and certification.</p></section>
  </div>;
}

function GoalComposer({ id, prompt, error, busy, agentRuntime, compact = false, onPromptChange, onGenerate }: { id: string; prompt: string; error: string | null; busy: boolean; agentRuntime: AgentRuntimeMode; compact?: boolean; onPromptChange: (prompt: string) => void; onGenerate: (prompt: string) => void }) {
  const hintId = `${id}-hint`, errorId = `${id}-error`;
  const modelConnected = agentRuntime === 'server-model' || agentRuntime === 'session-model';
  return <form className={`goal-composer ${compact ? 'compact' : ''}`} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); onGenerate(prompt); }}><label htmlFor={id}>What should ForgeTwin engineer?</label><textarea id={id} value={prompt} onChange={(event) => onPromptChange(event.target.value)} maxLength={500} rows={compact ? 4 : 3} aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`} aria-invalid={Boolean(error)} disabled={busy} /><div className="goal-composer-meta"><span id={hintId}>{prompt.length}/500 · free-form world synthesis · measurable constraints</span><button className="run-button hero" type="submit" disabled={busy || prompt.trim().length < 12}><Sparkles size={15} />{busy ? 'Engineering…' : modelConnected ? 'Engineer with AI' : 'Engineer locally'}</button></div>{error && <p className="goal-error" id={errorId} role="alert"><AlertTriangle size={13} />{error}</p>}</form>;
}

function AgentSettingsDialog({ runtime, model, hasTemporaryKey, onConnect, onDisconnect, onClose }: { runtime: AgentRuntimeMode; model: string; hasTemporaryKey: boolean; onConnect: (key: string) => void; onDisconnect: () => void; onClose: () => void }) {
  const [key, setKey] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  const serverConnected = runtime === 'server-model' && !hasTemporaryKey;
  return <div className="agent-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="agent-settings" role="dialog" aria-modal="true" aria-labelledby="agent-settings-title"><header><span><Bot size={18} /></span><div><small>ForgeTwin runtime</small><h2 id="agent-settings-title">AI agent connection</h2></div><button onClick={onClose} aria-label="Close agent settings"><X size={16} /></button></header><div className="agent-settings-body"><div className={`connection-state ${runtime === 'server-model' || runtime === 'session-model' ? 'connected' : 'local'}`}><i /><div><strong>{runtime === 'server-model' || runtime === 'session-model' ? `${model} connected` : 'Local deterministic engineer active'}</strong><p>{runtime === 'server-model' || runtime === 'session-model' ? 'GPT-5.6 Sol handles natural-language planning, in-place chat edits, and redesign decisions. Physics and tools still run inside ForgeTwin.' : 'The app remains fully usable without a model, with deterministic planning and a bounded local chat editor.'}</p></div></div>{!serverConnected && !hasTemporaryKey && <form onSubmit={(event) => { event.preventDefault(); onConnect(key); }}><label htmlFor="temporary-openai-key">Temporary OpenAI API key</label><input id="temporary-openai-key" type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="sk-…" /><p><KeyRound size={12} />Kept only in this tab and sent to the same-origin agent endpoint. It is never stored in localStorage or the project.</p><button className="run-button" type="submit" disabled={key.trim().length < 20}><Bot size={14} />Connect GPT-5.6 Sol for this tab</button></form>}{serverConnected && <p className="server-key-note"><BadgeCheck size={14} />A server-side model key is configured. It is never exposed to the browser.</p>}{hasTemporaryKey && <button className="disconnect-agent" onClick={onDisconnect}>Remove temporary key</button>}</div><footer><span>Model reasoning is advisory. Rapier measurements—not model claims—determine pass or fail.</span><button onClick={onClose}>Done</button></footer></section></div>;
}

function FailureBanner({ run, onReplay, onFix, busy }: { run: SimulationRun; onReplay: () => void; onFix: () => void; busy: boolean }) {
  const failed = run.metrics.measures.find((item) => item.status === 'fail');
  return <div className="failure-banner"><span className="failure-icon"><AlertTriangle size={19} /></span><div><span className="eyebrow">Trial {run.id} · physics rejected</span><strong>{run.diagnosis.summary}</strong><p>{failed ? `${failed.label} ${failed.value}${failed.unit} vs ${constraintSymbol(failed.operator)} ${failed.target}${failed.unit} · ${failed.provenance}` : run.diagnosis.evidence}</p></div><button onClick={onReplay}><TimerReset size={13} />Replay 0.25×</button><button className="fix" onClick={onFix} disabled={busy}><Sparkles size={13} />{busy ? 'Optimizing…' : 'Inspect & redesign'}</button></div>;
}

function ComponentInspector({ component, state, onMove, onUpdate, busy }: { component: MachineComponent; state: ForgeState; onMove: (x: number) => void; onUpdate: (name: ForgeToolName, input: Record<string, unknown>, message: string) => void; busy: boolean }) {
  const x = component.position[0]; const materialIndex = materials.findIndex((item) => item.id === component.materialId); const nextMaterial = materials[(materialIndex + 1) % materials.length];
  return <div className="sensor-inspector component-inspector"><span className="eyebrow">Selected body · {component.primitive}</span><div><strong>{component.role}</strong><code>{component.mass.toFixed(1)} kg</code></div><p>{component.dimensions.map((value) => value.toFixed(2)).join(' × ')} m · {component.materialId}</p><label htmlFor="selected-body-x">X position</label><input id="selected-body-x" aria-label={`${component.role} X position`} type="range" min={-state.world.bounds[0] / 2} max={state.world.bounds[0] / 2} step="0.05" value={x} onChange={(event) => onMove(Number(event.target.value))} disabled={busy || state.phase === 'simulating'} /><div className="nudge-row"><button disabled={busy} onClick={() => onMove(x - .5)} aria-label={`Move ${component.role} left 0.5 meters`}><ArrowLeft size={12} />.5 m</button><button disabled={busy} onClick={() => onMove(x + .5)} aria-label={`Move ${component.role} right 0.5 meters`}>.5 m<ArrowRight size={12} /></button></div><div className="inspector-actions"><button disabled={busy} onClick={() => onUpdate('rotate_component', { component_id: component.id, rotation: [component.rotation[0], component.rotation[1] + Math.PI / 12, component.rotation[2]] }, `${component.role} rotated and human-locked`)}>Rotate 15°</button><button disabled={busy} onClick={() => onUpdate('set_dimensions', { component_id: component.id, dimensions: component.dimensions.map((value) => Number((value * 1.1).toFixed(3))) }, `${component.role} resized +10%`)}>Size +10%</button><button disabled={busy} onClick={() => onUpdate('set_material', { component_id: component.id, material_id: nextMaterial.id }, `Material changed to ${nextMaterial.name}`)}>Next material</button></div>{component.humanLockedFields.length > 0 && <p><Radio size={11} />Human locks: {component.humanLockedFields.join(', ')}</p>}</div>;
}

function wholeMachineChatExamples(state: ForgeState) {
  const roles = state.components.map((item) => item.role).join(' ');
  if (/conveyor|sorting|chute|bin/.test(roles)) return ['Lengthen the powered conveyor by 15%', 'Move the vision portal upstream 0.5 m', 'Widen both output chutes by 20%'];
  if (/crane|boom|counterweight|outrigger/.test(roles)) return ['Widen the crane carrier base by 20%', 'Increase the rear counterweight mass by 25%', 'Lengthen the lifting boom by 15%'];
  if (/road wheel|mobile chassis|suspension/.test(roles)) return ['Widen the wheelbase by 15%', 'Lower the payload deck by 0.2 m', 'Use aluminum for the mobile chassis'];
  if (/robotic|serial link|gripper/.test(roles)) return ['Lengthen the final arm link by 10%', 'Move the vision camera higher 0.3 m', 'Make the gripper 15% wider'];
  if (/rotor|aerodynamic blade|impeller/.test(roles)) return ['Make every aerodynamic blade 10% longer', 'Use aluminum for every aerodynamic blade', 'Move the rotor speed encoder up 0.2 m'];
  if (/gear|shaft|transmission/.test(roles)) return ['Make the output gear 10% larger', 'Use steel for both shafts', 'Move the speed sensor right 0.2 m'];
  if (/span|bridge|truss/.test(roles)) return ['Deepen the bridge deck by 15%', 'Add another structural support', 'Use steel for the span deck'];
  return ['Make the primary support 15% wider', 'Move the feedback sensor up 0.3 m', 'Add another structural support'];
}

function AgentChat({ state, messages, prompt, busy, model, modelConnected, selected, onPromptChange, onSubmit }: { state: ForgeState; messages: EditMessage[]; prompt: string; busy: boolean; model: string; modelConnected: boolean; selected: MachineComponent | null; onPromptChange: (value: string) => void; onSubmit: (value: string) => void }) {
  const examples = selected
    ? [`Make ${selected.role} 20% larger`, `Move ${selected.role} up 0.5 m`, `Use aluminum for ${selected.role}`]
    : wholeMachineChatExamples(state);
  return <div className="agent-chat"><div className="panel-heading"><div><span className="eyebrow">Natural-language world revision</span><h2>Edit with chat</h2></div><span className={`agent-live ${modelConnected ? 'model' : 'local'}`}><i />{modelConnected ? model : 'LOCAL'}</span></div>
    <div className="chat-context"><MessageSquareText size={16} /><div><strong>{selected ? `Editing around ${selected.role}` : 'Editing the complete machine'}</strong><p>The agent modifies this world in place, preserves human locks, reruns physics, and keeps every change in version history.</p></div></div>
    <div className="chat-messages" aria-live="polite">{messages.length ? messages.map((message) => <article key={message.id} className={message.role}><span>{message.role === 'agent' ? <Bot size={13} /> : 'YOU'}</span><p>{message.text}</p></article>) : <div className="chat-empty"><Sparkles size={20} /><strong>Describe a revision</strong><p>Try “{examples[0].toLowerCase()}” or select a body for targeted edits.</p></div>}</div>
    <div className="chat-suggestions" aria-label="Suggested edits">{examples.map((example) => <button key={example} type="button" disabled={busy} onClick={() => onPromptChange(example)}>{example}</button>)}</div>
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); onSubmit(prompt); }}><label className="sr-only" htmlFor="machine-edit-prompt">Describe a change to the current machine</label><textarea id="machine-edit-prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder={`e.g. ${examples[0]}`} maxLength={300} rows={3} disabled={busy} /><button type="submit" disabled={busy || prompt.trim().length < 3} aria-label="Apply chat edit">{busy ? <Cpu size={14} /> : <Send size={14} />}{busy ? 'Engineering…' : 'Apply & simulate'}</button></form>
    <p className="chat-proof"><BadgeCheck size={12} />Every edit becomes guarded tool calls, a new revision, and a measured physics run.</p>
  </div>;
}

function AgentFeed({ state, toolCount, trace, runtime, model, busy, canCancel, onCancel, onConfigure }: { state: ForgeState; toolCount: number; trace: AgentTraceItem[]; runtime: AgentRuntimeMode; model: string; busy: boolean; canCancel: boolean; onCancel: () => void; onConfigure: () => void }) {
  const modelConnected = runtime === 'server-model' || runtime === 'session-model';
  const actorLabel = (actor: Actor) => actor === 'WebMCP' ? 'External WebMCP agent' : actor === 'ModelAgent' ? `Model agent · ${model}` : actor === 'Deterministic' ? 'Local deterministic engineer' : actor === 'Human' ? 'Human' : actor === 'System' ? 'Legacy local automation' : 'Guided UI';
  return <div className="feed-wrap"><div className="panel-heading"><div><span className="eyebrow">Shared-world execution</span><h2>Agent console</h2></div><span className={`agent-live ${modelConnected ? 'model' : 'local'}`}><i />{runtime === 'checking' ? 'CHECKING' : modelConnected ? 'MODEL' : 'LOCAL'}</span></div>
    <div className={`agent-identity ${modelConnected ? 'connected' : 'local'}`}><span><Bot size={16} /></span><div><strong>{modelConnected ? model : 'Deterministic engineer'}</strong><p>{modelConnected ? 'Model decisions → guarded tools → Rapier evidence' : 'Guarded local planning → Rapier evidence'}</p></div><button onClick={onConfigure}>{modelConnected ? 'Manage' : 'Connect AI'}</button>{busy && canCancel && <button className="cancel-agent" onClick={onCancel}><Square size={10} fill="currentColor" />Stop</button>}</div>
    {trace.length > 0 && <ol className="agent-transcript" aria-label="Agent reasoning and observations">{[...trace].reverse().slice(0, 9).map((item) => <li key={item.id} className={item.kind}><span>{item.kind === 'complete' ? <BadgeCheck size={13} /> : item.kind === 'error' ? <AlertTriangle size={13} /> : item.kind === 'goal' ? <Sparkles size={13} /> : <Bot size={13} />}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{formatTime(item.at)}</time></li>)}</ol>}
    <div className="feed-divider"><span>World tool calls</span><small>{toolCount === FORGE_TOOL_COUNT ? 'External host connected' : 'In-app execution'}</small></div>
    {state.activity.length ? <ol className="activity-list">{state.activity.slice(0, 12).map((event) => <li key={event.id} className={event.outcome}><span>{event.tool === 'run_simulation' ? <Activity size={14} /> : event.actor === 'Human' ? <MoveHorizontal size={14} /> : <Cpu size={14} />}</span><div><code>{event.tool}</code><p>{event.detail}</p><small>{actorLabel(event.actor)}</small></div><time>{formatTime(event.at)}</time></li>)}</ol> : <div className="empty-feed"><Cpu size={23} /><strong>No world actions yet</strong><p>Enter a physical goal. The in-app engineer will plan and execute it; WebMCP is optional for an external agent.</p></div>}
    <div className="tool-footer"><span>{toolCount}/{FORGE_TOOL_COUNT} WebMCP registered</span><code>{FORGE_TOOL_COUNT} in-app tools · rev {state.revision}</code></div></div>;
}

function MetricStack({ metrics, phase }: { metrics: Metrics | null; phase: ForgeState['phase'] }) {
  const values = metrics?.measures.slice(0, 6) ?? [];
  return <div className="metric-stack"><div className="metric-title"><span className="eyebrow">Measured output</span><span className={`phase-chip ${phase}`}>{phase}</span></div><div className="metric-grid generic">{values.length ? values.map((reading) => <div key={reading.metric} className={reading.status === 'fail' ? 'danger' : reading.status === 'pass' ? 'metric-pass' : ''}><small>{reading.label}</small><strong>{reading.value}<em>{reading.unit}</em></strong>{reading.target !== undefined && <span>{constraintSymbol(reading.operator)} {reading.target}{reading.unit}</span>}</div>) : <><div><small>Constraint 01</small><strong>—</strong></div><div><small>Constraint 02</small><strong>—</strong></div><div><small>Bodies</small><strong>—</strong></div><div><small>Physics state</small><strong>—</strong></div></>}</div></div>;
}

function RevisionHistory({ state, onRestore }: { state: ForgeState; onRestore: (revision: number) => void }) {
  return <div className="history-wrap"><div className="panel-heading"><div><span className="eyebrow">Immutable world snapshots</span><h2>Version history</h2></div><Clock3 size={15} /></div>{state.revisions.length ? <ol className="revision-list">{[...state.revisions].reverse().slice(0, 14).map((item, index) => <li key={item.id}><i className={index === 0 ? 'current' : ''} /><div><strong>REV {item.revision.toString().padStart(2, '0')}</strong><span>{item.label}</span><small>{item.actor} · {formatTime(item.at)}</small></div>{index > 0 && <button onClick={() => onRestore(item.revision)} aria-label={`Restore revision ${item.revision}: ${item.label}`}>Restore</button>}</li>)}</ol> : <div className="empty-feed"><History size={23} /><strong>No revisions yet</strong><p>Every physical or control mutation will create a revision.</p></div>}</div>;
}

function readingFor(run: SimulationRun, metric: string) { return run.metrics.measures.find((item) => item.metric === metric); }
function formatReading(reading: MetricReading | undefined) { return reading ? `${reading.value}${reading.unit}` : '—'; }

function Drawer({ type, state, onClose, onRestore, onAddPrimitive }: { type: 'telemetry' | 'compare' | 'catalog' | 'history'; state: ForgeState; onClose: () => void; onRestore: (revision: number) => void; onAddPrimitive: (kind: PrimitiveKind) => void }) {
  const latest = state.runs.at(-1); const baseline = [...state.runs].reverse().find((run) => run.status === 'failed' && run.id !== latest?.id); const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; const dialog = document.querySelector<HTMLElement>('.drawer'); const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog?.querySelector<HTMLElement>('button[aria-label="Close panel"]')?.focus(); const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; } if (event.key !== 'Tab' || !dialog) return; const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]; if (!focusable.length) return; const first = focusable[0], last = focusable.at(-1)!; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }; document.addEventListener('keydown', handle); return () => { document.removeEventListener('keydown', handle); document.body.style.overflow = previousOverflow; previousFocus?.focus(); }; }, []);
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="drawer" role="dialog" aria-modal="true" aria-label={`${type} panel`}><header><div><span className="eyebrow">ForgeTwin world analysis</span><h2>{type === 'telemetry' ? 'Physics telemetry' : type === 'compare' ? 'Compare worlds' : type === 'history' ? 'Version history' : 'Primitive library'}</h2></div><button onClick={onClose} aria-label="Close panel"><X size={17} /></button></header>
    {type === 'telemetry' && <div className="drawer-content">{latest ? <><div className="telemetry-hero"><Gauge size={21} /><div><strong>{latest.status === 'passed' ? 'Goal envelope satisfied' : 'Causal failure captured'}</strong><span>{latest.physics.engine} · {latest.physics.timestepHz} Hz · {latest.physics.bodies} bodies · {latest.physics.joints} instantiated joints</span></div></div><div className="telemetry-cards"><div><small>Constraint score</small><strong>{latest.metrics.score}%</strong></div><div><small>Objective</small><strong>{latest.objective}</strong></div><div><small>Total mass</small><strong>{latest.metrics.totalMass} kg</strong></div></div><h3>Constraint evidence</h3>{latest.metrics.measures.map((reading) => <article className="event-row" key={reading.metric}><span className={reading.status}>{reading.status}</span><div><strong>{reading.label}: {reading.value}{reading.unit}</strong><p>Target {constraintSymbol(reading.operator)} {reading.target}{reading.unit} · {reading.provenance}</p></div></article>)}<h3>Diagnosis</h3><article className="event-row"><span>{latest.failures[0]?.time.toFixed(2) ?? '—'}s</span><div><strong>{latest.diagnosis.summary}</strong><p>{latest.diagnosis.evidence} {latest.diagnosis.action}</p></div></article></> : <div className="empty-feed"><Gauge size={23} /><strong>No telemetry yet</strong><p>Run physics to populate graph-derived measurements.</p></div>}</div>}
    {type === 'compare' && <div className="drawer-content">{baseline && latest ? <><div className="compare-head"><span>Failed world</span><GitCompareArrows size={18} /><span>Current world</span></div>{latest.metrics.measures.slice(0, 6).map((reading) => <CompareMetric key={reading.metric} label={reading.label} before={formatReading(readingFor(baseline, reading.metric))} after={formatReading(reading)} good={reading.status === 'pass'} />)}<CompareMetric label="Total mass" before={`${baseline.configuration.totalMass} kg`} after={`${latest.configuration.totalMass} kg`} good /><CompareMetric label="Optimization passes" before={`${baseline.configuration.optimizationLevel}`} after={`${latest.configuration.optimizationLevel}`} good />{latest.status === 'passed' && state.humanConstraints.length > 0 && <div className="preserved-note"><MoveHorizontal size={16} /><span><strong>Human fields preserved.</strong>The agent changed surrounding physical or control fields.</span></div>}</> : <div className="empty-feed"><GitCompareArrows size={23} /><strong>Two runs are needed</strong><p>Generate a failing baseline and a measured redesign to compare evidence.</p></div>}</div>}
    {type === 'catalog' && <div className="drawer-content catalog-drawer">{primitiveCatalog.map((item) => <article key={item.id}><span style={{ background: item.color }} /><div><strong>{item.name}</strong><p>{item.description}</p><small>{item.family} · {item.capabilities.join(' · ')}</small></div><button onClick={() => onAddPrimitive(item.kind)} disabled={!state.goal} aria-label={`Add ${item.name}`}>Add</button></article>)}</div>}
    {type === 'history' && <div className="drawer-content"><RevisionHistory state={state} onRestore={onRestore} /></div>}
    <footer><span>{state.revisions.length} revisions · {state.runs.length} physics runs</span>{state.revisions.length > 1 && <button onClick={() => onRestore(state.revisions.at(-2)!.revision)} aria-label={`Restore previous revision ${state.revisions.at(-2)!.revision}`}>Restore previous</button>}</footer></section></div>;
}

function CompareMetric({ label, before, after, good }: { label: string; before: string; after: string; good: boolean }) {
  return <div className="compare-row"><span>{label}</span><strong>{before}</strong><ArrowRight size={13} /><strong className={good ? 'good' : ''}>{after}</strong></div>;
}
