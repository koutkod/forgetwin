'use client';

import {
  Activity, AlertTriangle, ArrowRight, BadgeCheck, Bot, Box, Check, ChevronDown,
  CircleDot, Clock3, Code2, Cpu, Download, FileText, Gauge, GitCompareArrows, History, Image as ImageIcon, Layers3, Move3D,
  KeyRound, MessageSquareText, MoveHorizontal, Pause, Play, Radio, Redo2, RotateCcw, Save, Send,
  Search, Settings2, Sparkles, Square, TimerReset, Undo2, Waypoints, X, Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ForgeScene } from '../components/forge/forge-scene';
import {
  AgentRequestError, getAgentStatus, normalizeRedesignSequence, requestAgentEdit, requestAgentPlan, requestAgentRedesign, validateAgentKey,
  type AgentEditAction, type AgentPlan, type AgentRuntimeMode, type AgentTraceItem,
} from '../lib/forge-agent';
import { catalogFor, engineeringExamples, materials, primitiveCatalog } from '../lib/forge-data';
import { contextualMechanicalEdits, conveyorSpeedEdits, pendingClarification, resolvedEditPrompt, type ChatMessage } from '../lib/forge-chat';
import { compileAgentPlan, localAnchorAt, semanticParametersForEdit } from '../lib/forge-model-plan';
import { translateInForgeCoordinates } from '../lib/forge-motion';
import { CHALLENGE_EXAMPLES, compileDesignBrief, DEFAULT_DESIGN_PROMPT } from '../lib/forge-prompt';
import { exportForgeDesign, type ForgeExportFormat } from '../lib/forge-export';
import { FORGE_TOOL_COUNT, preflightCompiledWorldPlan, useForge, useForgeWebMCP, WEBMCP_CHECKING } from '../lib/use-forge';
import type {
  EngineeringExample,
} from '../lib/forge-data';
import type {
  Actor, CompiledWorldPlan, ForgeState, ForgeToolName, MachineComponent, MetricReading, Metrics,
  PrimitiveKind, SimulationRun, ToolResult,
} from '../lib/forge-types';

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const constraintSymbol = (operator: 'min' | 'max' | 'exact') => operator === 'min' ? '≥' : operator === 'max' ? '≤' : '=';
type EditMessage = ChatMessage & { id: string };
type EditCommand = { tool: ForgeToolName; input: Record<string, unknown>; label: string };
type GenerationPhase = 'interpreting' | 'planning' | 'assembling' | 'linking' | 'simulating' | 'optimizing' | 'complete';
type GenerationVisualState = {
  phase: GenerationPhase;
  goal: string;
  progress: number;
  headline: string;
  detail: string;
  machineName?: string;
  builtBodies?: number;
  totalBodies?: number;
  builtLinks?: number;
  totalLinks?: number;
};

export function ForgeTwinApp() {
  const forge = useForge();
  const { state, hydrated, command, commandBatch, runMachine, moveComponentAsHuman, patchUi, checkpoint, reset, getSnapshot } = forge;
  const registeredTools = useForgeWebMCP(command, runMachine, getSnapshot, hydrated);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'chat' | 'activity' | 'history'>('activity');
  const [drawer, setDrawer] = useState<'telemetry' | 'compare' | 'catalog' | 'history' | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalPrompt, setGoalPrompt] = useState(DEFAULT_DESIGN_PROMPT);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntimeMode>('deterministic');
  const [agentModel, setAgentModel] = useState('gpt-5.6-sol');
  const [agentKey, setAgentKey] = useState('');
  const [sharedAgentAvailable, setSharedAgentAvailable] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [rotationSnapDegrees, setRotationSnapDegrees] = useState<number | null>(15);
  const [agentConnecting, setAgentConnecting] = useState(false);
  const [agentConnectionError, setAgentConnectionError] = useState<string | null>(null);
  const [agentTrace, setAgentTrace] = useState<AgentTraceItem[]>([]);
  const [editPrompt, setEditPrompt] = useState('');
  const [editMessages, setEditMessages] = useState<EditMessage[]>([]);
  const [chatThinking, setChatThinking] = useState(false);
  const [agentCancelable, setAgentCancelable] = useState(false);
  const [generationVisual, setGenerationVisual] = useState<GenerationVisualState | null>(null);
  const [animationState, setAnimationState] = useState({ designHash: state.designHash, playing: false });
  const animationPlaying = animationState.designHash === state.designHash && animationState.playing;
  const setAnimationPlaying = (playing: boolean) => setAnimationState({ designHash: state.designHash, playing });
  const traceSeq = useRef(0);
  const agentConnectSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3600); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const controller = new AbortController();
    void getAgentStatus(controller.signal).then((status) => {
      setAgentModel(status.model); setSharedAgentAvailable(status.configured);
      setAgentRuntime((current) => current === 'session-model' ? current : status.configured ? 'server-model' : 'deterministic');
    }).catch(() => undefined);
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
  const recordModelFailure = (caught: unknown) => {
    const message = caught instanceof Error ? caught.message : 'The model request failed.';
    const disconnected = caught instanceof AgentRequestError && ['MODEL_KEY_REJECTED', 'MODEL_ACCESS_DENIED'].includes(caught.code);
    setAgentConnectionError(message);
    if (disconnected) { setAgentKey(''); setAgentRuntime(sharedAgentAvailable ? 'server-model' : 'deterministic'); }
    return { message, disconnected };
  };
  const runtimeActor = (): Actor => agentRuntime !== 'deterministic' ? 'ModelAgent' : 'Deterministic';
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
        steps = normalizeRedesignSequence(response.result);
        addTrace('reasoning', 'Model diagnosed the failed trial', response.result.diagnosis);
        addTrace('action', 'Model selected the evidence loop', steps.map((step) => step.tool).join(' → '));
      } catch (caught) {
        actor = 'Deterministic';
        const failure = recordModelFailure(caught);
        addTrace('fallback', 'Model redesign unavailable', `${failure.message} Continuing with the bounded local evidence loop.${failure.disconnected ? ' The hosted model or another visitor key can be used on the next retry.' : ' The model remains available for the next retry.'}`);
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
    // A new machine starts a new edit conversation. Keeping chat from the
    // previous world made unrelated winch edits appear beside a scissor lift
    // or steering assembly and gave the impression that context was leaking.
    setEditMessages([]); setEditPrompt('');
    setGenerationVisual({
      phase: 'interpreting', goal: requestedPrompt, progress: 4,
      headline: 'Reading the engineering intent',
      detail: 'Separating the object identity, physical requirements, and measurable constraints.',
    });
    traceSeq.current += 1;
    setAgentTrace([{ id: `agent-trace-${traceSeq.current}`, kind: 'goal', title: 'New engineering mission', detail: requestedPrompt, at: new Date().toISOString() }]);
    try {
      let actor: Actor = runtimeActor();
      let modelPlan: AgentPlan | null = null;
      let shouldUseModel = actor === 'ModelAgent';
      if (agentKey) { shouldUseModel = true; actor = 'ModelAgent'; setAgentRuntime('session-model'); }
      if (shouldUseModel) {
        setGenerationVisual((current) => current ? { ...current, progress: 9, headline: 'Reasoning across the constraints', detail: `${agentModel} is choosing an architecture that preserves the requested machine identity.` } : current);
        addTrace('action', 'Asking the model to plan', 'Interpreting constraints, selecting a composable architecture, and choosing verification metrics.');
        try {
          const response = await requestAgentPlan(requestedPrompt, agentKey || undefined, controller.signal);
          modelPlan = response.result;
          setAgentModel(response.model); setAgentConnectionError(null);
          addTrace('reasoning', response.result.reasoning_summary, `Interpreted as: ${response.result.normalized_prompt}. Architecture: ${response.result.architecture.join(' · ')}. ForgeTwin expanded the compact AI intent into a grounded, connected, executable physical graph.`);
        } catch (caught) {
          actor = 'Deterministic';
          const failure = recordModelFailure(caught);
          addTrace('fallback', 'Switched to the local engineer for this run', `${failure.message} The deterministic planner will still build, simulate, and repair the machine.${failure.disconnected ? ' The hosted model or another visitor key can be used on the next retry.' : ' The model remains available for the next retry.'}`);
        }
      } else addTrace('fallback', 'Local deterministic engineer active', 'No model key is connected. This mode still executes the guarded world tools and real Rapier simulation; connect a model for model-selected planning and redesign decisions.');

      let plan: CompiledWorldPlan;
      let certifiedPlan: CompiledWorldPlan | null = null;
      if (modelPlan) {
        try {
          certifiedPlan = compileDesignBrief(requestedPrompt);
          preflightCompiledWorldPlan(certifiedPlan);
        } catch {
          // A novel mechanism can still proceed through the fully model-authored
          // graph below. The certified path is only used for machine families
          // whose topology and replay contracts are covered by the test suite.
        }
      }
      if (modelPlan && certifiedPlan) {
        plan = certifiedPlan;
        addTrace('action', 'AI intent mapped to a certified mechanism', `${modelPlan.machine_name} matched a tested ${certifiedPlan.goal.domain.toLowerCase()} primitive architecture. The model interpretation is preserved while known joints, controls, and replay-safe geometry replace an unstable free-form approximation.`);
      } else if (modelPlan) {
        try {
          plan = compileAgentPlan(requestedPrompt, modelPlan);
          preflightCompiledWorldPlan(plan);
          addTrace('action', 'AI architecture compiled', `${modelPlan.machine_name} will be materialized from ${modelPlan.components.length} guarded bodies and ${modelPlan.joints.length} validated joints selected from the model-authored engineering intent.`);
        } catch (caught) {
          actor = 'Deterministic';
          addTrace('fallback', 'AI graph could not be materialized', caught instanceof Error ? `${caught.message} Trying a known high-fidelity local mechanism instead.` : 'Trying a known high-fidelity local mechanism instead.');
          try { plan = compileDesignBrief(requestedPrompt); preflightCompiledWorldPlan(plan); }
          catch (fallbackError) { throw new Error(fallbackError instanceof Error ? fallbackError.message.replace(/^[A-Z_]+:\s*/, '') : 'The physical goal could not be decomposed.'); }
        }
      } else {
        try { plan = compileDesignBrief(requestedPrompt); preflightCompiledWorldPlan(plan); }
        catch (caught) { throw new Error(caught instanceof Error ? caught.message.replace(/^[A-Z_]+:\s*/, '') : 'The physical goal could not be decomposed.'); }
      }
      plan.brief = requestedPrompt; plan.goal.brief = requestedPrompt;
      setGenerationVisual((current) => current ? {
        ...current, phase: 'planning', progress: 22, machineName: plan.goal.machineName,
        headline: 'Architecture resolved',
        detail: `${plan.components.length} bodies, ${plan.joints.length} joints, and ${plan.motors.length + plan.actuators.length} driven elements are ready to compose.`,
        builtBodies: 0, totalBodies: plan.components.length, builtLinks: 0,
        totalLinks: plan.connections.length + plan.joints.length + plan.motors.length + plan.sensors.length + plan.actuators.length + plan.controls.length,
      } : current);
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
      await call('inspect_workspace', { since_revision: 0 }, 20, actor, controller.signal);
      addTrace('observation', 'Goal revision confirmed', `Workspace revision ${getSnapshot().revision} accepted the normalized specification and coordinate contract.`);
      addTrace('action', 'Building the shared world', 'Creating the planned bodies, connections, joints, sensors, actuators, and control channels through guarded tools.');
      for (const item of plan.assemblies) await call('create_assembly', { assembly_id: item.id, name: item.name, purpose: item.purpose, parent_id: item.parentId }, 20, actor, controller.signal);
      setGenerationVisual((current) => current ? { ...current, phase: 'assembling', progress: 28, headline: 'Materializing the machine', detail: 'Placing dimensioned physical bodies into the shared 3D world.' } : current);
      for (const [index, item] of plan.components.entries()) {
        await call('create_component', {
          component_id: item.id, primitive: item.primitive, assembly_id: item.assemblyId, role: item.role,
          position: item.position, rotation: item.rotation, dimensions: item.dimensions, material_id: item.materialId,
          body_type: item.bodyType, mass: item.mass, color: item.color, parameters: item.parameters,
        }, 20, actor, controller.signal);
        setGenerationVisual((current) => current ? {
          ...current, builtBodies: index + 1,
          progress: Math.round(28 + ((index + 1) / Math.max(1, plan.components.length)) * 34),
          detail: `${item.role} placed · ${index + 1} of ${plan.components.length} physical bodies`,
        } : current);
      }
      await call('inspect_workspace', { since_revision: Math.max(0, getSnapshot().revision - plan.components.length) }, 20, actor, controller.signal);
      addTrace('observation', 'Body placement confirmed', `${getSnapshot().components.length} current bodies are visible in the shared world at revision ${getSnapshot().revision}.`);
      const connected = new Set<string>();
      let builtLinks = 0;
      const totalLinks = plan.connections.length + plan.joints.length + plan.motors.length + plan.sensors.length + plan.actuators.length + plan.controls.length;
      const advanceLinkVisual = (detail: string) => {
        builtLinks += 1;
        setGenerationVisual((current) => current ? { ...current, phase: 'linking', headline: 'Wiring the physical graph', detail, builtLinks, totalLinks, progress: Math.round(63 + (builtLinks / Math.max(1, totalLinks)) * 16) } : current);
      };
      for (const item of plan.connections) {
        connected.add([item.sourceId, item.targetId].sort().join('-'));
        await call('connect_components', { connection_id: item.id, source_id: item.sourceId, target_id: item.targetId, connection_type: item.type, channel: item.channel }, 20, actor, controller.signal);
        advanceLinkVisual(`${item.type} connection established · ${builtLinks + 1} of ${totalLinks} graph links`);
      }
      for (const [index, item] of plan.joints.entries()) {
        const pair = [item.componentA, item.componentB].sort().join('-');
        if (!connected.has(pair)) {
          connected.add(pair);
          await call('connect_components', { connection_id: `edge-${index + 1}`, source_id: item.componentA, target_id: item.componentB, connection_type: 'mechanical', channel: item.type }, 20, actor, controller.signal);
        }
        await call('create_joint', { joint_id: item.id, joint_type: item.type, component_a: item.componentA, component_b: item.componentB, anchor_a: item.anchorA, anchor_b: item.anchorB, axis: item.axis, limits: item.limits, ratio: item.ratio, stiffness: item.stiffness, damping: item.damping }, 20, actor, controller.signal);
        advanceLinkVisual(`${item.type} joint constrained · ${builtLinks + 1} of ${totalLinks} graph links`);
      }
      for (const item of plan.motors) { await call('add_motor', { motor_id: item.id, component_id: item.componentId, joint_id: item.jointId, max_torque: item.maxTorque, max_rpm: item.maxRpm, direction: item.direction }, 20, actor, controller.signal); advanceLinkVisual(`${item.id} drive channel online · ${builtLinks + 1} of ${totalLinks} graph links`); }
      for (const item of plan.sensors) { await call('add_sensor', { sensor_id: item.id, component_id: item.componentId, sensor_type: item.type, channel: item.channel, target_id: item.targetId, range: item.range }, 20, actor, controller.signal); advanceLinkVisual(`${item.type} sensing channel online · ${builtLinks + 1} of ${totalLinks} graph links`); }
      for (const item of plan.actuators) { await call('add_actuator', { actuator_id: item.id, component_id: item.componentId, joint_id: item.jointId, actuator_type: item.type, max_force: item.maxForce, max_speed: item.maxSpeed, travel: item.travel }, 20, actor, controller.signal); advanceLinkVisual(`${item.type} actuator online · ${builtLinks + 1} of ${totalLinks} graph links`); }
      for (const item of plan.controls) { await call('set_control_logic', { control_id: item.id, name: item.name, mode: item.mode, sensor_ids: item.sensorIds, actuator_ids: item.actuatorIds, motor_ids: item.motorIds, expression: item.expression, setpoint: item.setpoint, kp: item.kp, ki: item.ki, kd: item.kd, calibration_x: item.calibrationX }, 20, actor, controller.signal); advanceLinkVisual(`${item.mode} control loop compiled · ${builtLinks + 1} of ${totalLinks} graph links`); }
      await call('inspect_workspace', { since_revision: Math.max(0, getSnapshot().revision - totalLinks) }, 20, actor, controller.signal);
      addTrace('observation', 'Executable graph validated', `${getSnapshot().joints.length} joints and ${getSnapshot().motors.length + getSnapshot().actuators.length} drives reference the current workspace revision.`);

      setGenerationVisual((current) => current ? { ...current, phase: 'simulating', progress: 82, headline: 'Physics is taking over', detail: 'Rapier is advancing the assembled world at 60 Hz and measuring every registered constraint.' } : current);
      addTrace('action', 'Running the first physics trial', 'Instantiating the current world in Rapier at 60 Hz and measuring every registered constraint.');
      must(await runMachine(actor));
      const firstRun = getSnapshot().runs.at(-1);
      if (firstRun) addTrace('observation', firstRun.status === 'passed' ? 'Run evidence satisfies the goal' : firstRun.status === 'partial' ? 'Run completed with explicit limits' : 'Run evidence rejected the design', `${firstRun.diagnosis.summary} Measured-target score: ${firstRun.metrics.score}%.`);
      for (let iteration = 0; iteration < 2 && getSnapshot().runs.at(-1)?.status === 'failed'; iteration += 1) {
        const failed = getSnapshot().runs.at(-1)!;
        setGenerationVisual((current) => current ? { ...current, phase: 'optimizing', progress: 90 + iteration * 3, headline: 'Failure found. Redesigning.', detail: `${failed.diagnosis.summary} The agent is changing only evidence-linked fields.` } : current);
        setToast(`${failed.diagnosis.summary} — agent is inspecting the evidence`);
        actor = await redesignRun(failed, requestedPrompt, actor, controller.signal);
        const rerun = getSnapshot().runs.at(-1);
        if (rerun) addTrace('observation', `Trial ${rerun.id} ${rerun.status}`, `${rerun.metrics.score}% constraint score · objective ${rerun.objective.toFixed(3)}.`);
      }
      const finalRun = getSnapshot().runs.at(-1);
      if (!finalRun || finalRun.status === 'failed') throw new Error('The bounded optimizer still misses a target. Open telemetry to inspect the remaining physical constraint.');
      await call('inspect_workspace', { since_revision: Math.max(0, getSnapshot().revision - 1) }, 20, actor, controller.signal);
      addTrace('complete', finalRun.status === 'passed' ? 'Engineering mission complete' : 'Concept run complete with limits', `${plan.goal.machineName} has ${finalRun.metrics.measures.filter((item) => item.status === 'pass').length}/${finalRun.metrics.measures.length} measured targets passing at ${finalRun.evaluationLevel} fidelity with ${plan.components.length} generated bodies.`);
      setGenerationVisual((current) => current ? { ...current, phase: 'complete', progress: 100, headline: finalRun.status === 'passed' ? 'Engineered. Simulated. Evidence passed.' : 'Engineered. Simulated. Partially evaluated.', detail: `${plan.goal.machineName}: ${finalRun.metrics.measures.filter((item) => item.status === 'pass').length}/${finalRun.metrics.measures.length} measured targets pass; requirement coverage is ${finalRun.status}.` } : current);
      setToast(`${plan.goal.machineName} engineered from ${plan.components.length} primitives · run ${finalRun.status}`);
      await pause(950);
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') { addTrace('observation', 'Engineering run stopped', 'The current agent run was cancelled. The last committed world revision is still available.'); setToast('Agent run cancelled'); }
      else {
        const message = caught instanceof Error ? caught.message : 'The machine could not be engineered.';
        if (getSnapshot().screen === 'landing') setPromptError(message);
        else setError(message);
        addTrace('error', 'Engineering run stopped', message);
      }
    } finally { abortRef.current = null; setAgentCancelable(false); setBusy(false); setGenerationVisual(null); }
  };

  const diagnoseAndFix = async () => {
    if (busy) return; setAnimationPlaying(false); setBusy(true); setError(null);
    try {
      const failed = getSnapshot().runs.at(-1);
      if (!failed || failed.status !== 'failed') throw new Error('Run a failing physics trial before optimizing.');
      addTrace('action', 'Redesign requested', 'The agent is reading the failed trial before changing the world.');
      await redesignRun(failed, goalPrompt, runtimeActor());
      const repaired = getSnapshot().runs.at(-1);
      if (!repaired || repaired.status === 'failed') throw new Error('One or more constraints still fail after the bounded redesign.');
      addTrace('complete', 'Measured redesign accepted', `${repaired.metrics.score}% constraint score after the agent-selected evidence loop.`);
      setToast(repaired.status === 'passed' ? 'Measured redesign satisfies every evaluated requirement' : 'Measured redesign completed with explicit evaluation limits');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The redesign could not finish.'); }
    finally { setBusy(false); }
  };

  const retuneHumanEdit = async () => {
    if (busy) return; setAnimationPlaying(false); setBusy(true); setError(null);
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
      if (!final || final.status === 'failed') throw new Error('The redesign still misses a target; your geometry remains locked.');
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
    setAnimationPlaying(false); setBusy(true); setError(null);
    const result = await runMachine('UI');
    if (!result.ok) setError(result.error.message); else setToast(`Physics run ${getSnapshot().phase}`);
    setBusy(false);
  };

  const handleEditableMove = (componentId: string, position: [number, number, number]) => {
    if (busy) return setToast('Wait for the active physics run to finish');
    const result = moveComponentAsHuman(componentId, position);
    if (!result.ok) setError(result.error.message);
    else { patchUi({ selectedComponentId: componentId, replayRunId: null }); setToast(`Human geometry locked at X ${position[0].toFixed(2)}, Y ${position[1].toFixed(2)}, Z ${position[2].toFixed(2)} m — prior calibration is stale`); }
  };
  const handleEditableRotate = (componentId: string, rotation: [number, number, number]) => {
    if (busy) return setToast('Wait for the active physics run to finish');
    const result = command('rotate_component', { component_id: componentId, rotation }, 'Human');
    if (!result.ok) setError(result.error.message);
    else { patchUi({ selectedComponentId: componentId, replayRunId: null }); setToast('Human X/Y/Z rotation locked in the shared WebMCP world'); }
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

  const connectTemporaryModel = async (key: string) => {
    const value = key.trim();
    if (value.length < 20 || value.length > 300) { setAgentConnectionError('Enter a complete OpenAI API key between 20 and 300 characters.'); return; }
    if (value.includes('\\')) { setAgentConnectionError('The pasted key contains a backslash. Copy the original key directly from the OpenAI dashboard and try again.'); return; }
    const requestId = ++agentConnectSeq.current;
    setAgentConnecting(true); setAgentConnectionError(null);
    try {
      const response = await validateAgentKey(value);
      if (requestId !== agentConnectSeq.current) return;
      setAgentKey(value); setAgentRuntime('session-model'); setAgentModel(response.model); setAgentSettingsOpen(false);
      setToast(`${response.model} verified and connected for this tab`);
    } catch (caught) {
      if (requestId !== agentConnectSeq.current) return;
      setAgentKey(''); setAgentRuntime(sharedAgentAvailable ? 'server-model' : 'deterministic');
      setAgentConnectionError(caught instanceof Error ? caught.message : 'OpenAI could not validate this key.');
    } finally { if (requestId === agentConnectSeq.current) setAgentConnecting(false); }
  };
  const disconnectTemporaryModel = () => {
    agentConnectSeq.current += 1; setAgentConnecting(false); setAgentConnectionError(null);
    setAgentKey(''); setAgentRuntime(sharedAgentAvailable ? 'server-model' : 'deterministic'); setAgentSettingsOpen(false);
    setToast('Your OpenAI key was removed from this tab');
  };
  const cancelAgentRun = () => { abortRef.current?.abort(); setAgentCancelable(false); };

  const modelEditCommands = (actions: AgentEditAction[]): EditCommand[] => {
    const snapshot = getSnapshot();
    const transforms = new Map(snapshot.components.map((item) => [item.id, { position: [...item.position] as [number, number, number], rotation: [...item.rotation] as [number, number, number] }]));
    const commands: EditCommand[] = [];
    for (const action of actions) {
      if (action.tool === 'create_assembly') commands.push({ tool: action.tool, input: { assembly_id: action.assembly_id, name: action.name, purpose: action.purpose, ...(action.parent_id ? { parent_id: action.parent_id } : {}) }, label: `Create ${action.name}` });
      else if (action.tool === 'set_dimensions') commands.push({ tool: action.tool, input: { component_id: action.component_id, dimensions: action.dimensions }, label: `Resize ${action.component_id}` });
      else if (action.tool === 'set_material') commands.push({ tool: action.tool, input: { component_id: action.component_id, material_id: action.material_id }, label: `Change ${action.component_id} material` });
      else if (action.tool === 'set_mass') commands.push({ tool: action.tool, input: { component_id: action.component_id, mass: action.mass }, label: `Retune ${action.component_id} mass` });
      else if (action.tool === 'move_component') { const transform = transforms.get(action.component_id); if (transform) transform.position = [...action.position]; commands.push({ tool: action.tool, input: { component_id: action.component_id, position: action.position }, label: `Move ${action.component_id}` }); }
      else if (action.tool === 'rotate_component') { const transform = transforms.get(action.component_id); if (transform) transform.rotation = [...action.rotation]; commands.push({ tool: action.tool, input: { component_id: action.component_id, rotation: action.rotation }, label: `Rotate ${action.component_id}` }); }
      else if (action.tool === 'remove_component') { transforms.delete(action.component_id); commands.push({ tool: action.tool, input: { component_id: action.component_id }, label: `Remove ${action.component_id}` }); }
      else if (action.tool === 'create_component') {
        transforms.set(action.component_id, { position: [...action.position], rotation: [...action.rotation] });
        commands.push({
          tool: action.tool,
          input: {
            component_id: action.component_id, primitive: action.primitive, assembly_id: action.assembly_id, role: action.role,
            position: action.position, rotation: action.rotation, dimensions: action.dimensions, material_id: action.material_id,
            body_type: action.body_type, ...(action.mass > 0 ? { mass: action.mass } : {}), ...(action.color ? { color: action.color } : {}),
            parameters: semanticParametersForEdit(action, snapshot.goal?.machineName ?? 'Mechanical system'),
          },
          label: `Create ${action.role}`,
        });
      } else if (action.tool === 'connect_components') commands.push({ tool: action.tool, input: { connection_id: action.connection_id, source_id: action.source_id, target_id: action.target_id, connection_type: action.connection_type, channel: action.channel }, label: `Connect ${action.source_id} to ${action.target_id}` });
      else if (action.tool === 'create_joint') {
        const a = transforms.get(action.component_a), b = transforms.get(action.component_b);
        if (!a || !b) throw new Error(`The model joint ${action.joint_id} references a body without a known transform.`);
        const shared = a.position.map((value, index) => (value + b.position[index]) / 2) as [number, number, number];
        const anchorA = localAnchorAt(a, shared);
        const anchorB = localAnchorAt(b, shared);
        commands.push({ tool: action.tool, input: {
          joint_id: action.joint_id, joint_type: action.joint_type, component_a: action.component_a, component_b: action.component_b,
          anchor_a: anchorA, anchor_b: anchorB, axis: action.axis, ...(action.limits ? { limits: action.limits } : {}),
          ...(action.ratio > 0 ? { ratio: action.ratio } : {}), ...(action.stiffness > 0 ? { stiffness: action.stiffness } : {}), ...(action.damping > 0 ? { damping: action.damping } : {}),
        }, label: `Joint ${action.component_a} to ${action.component_b}` });
      } else if (action.tool === 'remove_joint') commands.push({ tool: action.tool, input: { joint_id: action.joint_id }, label: `Remove joint ${action.joint_id}` });
      else if (action.tool === 'add_motor') commands.push({ tool: action.tool, input: { motor_id: action.motor_id, component_id: action.component_id, ...(action.joint_id ? { joint_id: action.joint_id } : {}), max_torque: action.max_torque, max_rpm: action.max_rpm, direction: action.direction }, label: `Drive ${action.component_id}` });
      else if (action.tool === 'set_motor_speed') commands.push({ tool: action.tool, input: { motor_id: action.motor_id, max_rpm: action.max_rpm, direction: action.direction }, label: `Retune ${action.motor_id}` });
      else if (action.tool === 'add_sensor') commands.push({ tool: action.tool, input: { sensor_id: action.sensor_id, component_id: action.component_id, sensor_type: action.sensor_type, channel: action.channel, ...(action.target_id ? { target_id: action.target_id } : {}), range: action.range }, label: `Sense ${action.channel}` });
      else if (action.tool === 'set_sensor_range') commands.push({ tool: action.tool, input: { sensor_id: action.sensor_id, range: action.range }, label: `Retune ${action.sensor_id}` });
      else if (action.tool === 'add_actuator') commands.push({ tool: action.tool, input: { actuator_id: action.actuator_id, component_id: action.component_id, joint_id: action.joint_id, actuator_type: action.actuator_type, max_force: action.max_force, max_speed: action.max_speed, travel: action.travel }, label: `Actuate ${action.component_id}` });
      else if (action.tool === 'set_actuator_timing') commands.push({ tool: action.tool, input: { actuator_id: action.actuator_id, max_speed: action.max_speed, travel: action.travel }, label: `Retune ${action.actuator_id}` });
      else if (action.tool === 'set_control_logic') commands.push({ tool: action.tool, input: { control_id: action.control_id, name: action.name, mode: action.mode, sensor_ids: action.sensor_ids, actuator_ids: action.actuator_ids, expression: action.expression, setpoint: action.setpoint, kp: action.kp, ki: action.ki, kd: action.kd }, label: `Control ${action.name}` });
      else commands.push({ tool: action.tool, input: { control_id: action.control_id, expression: action.expression, setpoint: action.setpoint, kp: action.kp, ki: action.ki, kd: action.kd }, label: `Retune ${action.control_id}` });
    }
    return commands;
  };

  const localEditCommands = (instruction: string): EditCommand[] => {
    const world = getSnapshot();
    const text = instruction.toLowerCase();
    const headlightRequest = /\b(headlights?|head lamps?|lamps?|bike lights?|work lights?)\b/.test(text);
    const addingComponent = /\b(add|create|attach)\b/.test(text);
    const aliases: Record<string, string[]> = {
      'metal recovery chute': ['metal recovery chute'], 'plastic recovery chute': ['plastic recovery chute'], 'reject recovery chute': ['reject recovery chute'],
      'trommel drum': ['perforated rotating trommel drum'], trommel: ['perforated rotating trommel drum'],
      'optical sensor': ['bottle and reject optical sensor'], 'speed sensor': ['speed sensor', 'speed pickup', 'encoder'],
      'feedback sensor': ['feedback sensor', 'sensor', 'camera', 'encoder', 'pickup'], 'rotor speed encoder': ['rotor speed encoder'],
      'vision portal': ['vision portal', 'vision tunnel', 'camera portal', 'color sensor'], 'vision camera': ['vision camera', 'camera'],
      'output chute': ['output chute', 'recovery chute', 'sorting chute'], chute: ['recovery chute', 'feed chute', 'output chute'], hopper: ['feed hopper'],
      handlebar: ['handlebar'], saddle: ['saddle', 'seat'], seat: ['saddle', 'seat'], battery: ['battery'], chain: ['drive chain', 'sprocket'],
      headlight: ['headlight', 'light module'], lamp: ['headlight', 'light module'],
      'solar panel': ['solar charging panel'], panel: ['solar charging panel', 'tracked panel'], fork: ['front fork'], bicycle: ['top tube', 'chain stay'],
      'crane carrier base': ['crane carrier base', 'carrier base', 'chassis'], 'lifting boom': ['lifting boom', 'boom'],
      'rear counterweight': ['rear counterweight', 'counterweight'], boom: ['boom'], mast: ['mast'], base: ['base', 'chassis'],
      'mobile chassis': ['mobile chassis', 'chassis'], wheelbase: ['mobile chassis', 'chassis', 'chassis rail'], 'payload deck': ['payload deck'],
      wheel: ['wheel'], motor: ['motor'], counterweight: ['counterweight'], shaft: ['shaft'],
      sensor: ['sensor', 'camera', 'pickup', 'encoder'], gripper: ['gripper'], 'final arm link': ['final arm link', 'wrist link', 'serial link'], arm: ['serial link', 'link'],
      platform: ['platform'], 'bridge deck': ['bridge deck', 'span deck', 'deck'], 'span deck': ['span deck', 'bridge deck', 'deck'], bridge: ['span', 'deck'],
      'output gear': ['output gear'], gear: ['gear', 'sprocket'], 'powered conveyor': ['powered conveyor', 'conveyor', 'transport surface'], conveyor: ['conveyor', 'transport surface'],
      'winding drum': ['grooved cable winding drum', 'winding drum'], 'cable drum': ['grooved cable winding drum', 'cable drum'], fairlead: ['overhead cable fairlead', 'fairlead'],
      'cable load cell': ['winch cable load cell', 'cable load cell'], 'winch controller': ['winch speed and overload controller'],
      'discharge outlet': ['tangential discharge outlet pipe', 'volute tangential discharge neck', 'discharge outlet'], 'flow sensor': ['discharge flow sensor', 'flow sensor'],
      'pump base': ['pump and motor skid base', 'pump base'], 'planet gear': ['planet gear'], 'differential housing': ['compact differential bench housing', 'open differential housing ring'],
      'press bed': ['adjustable press bed', 'press bed'], platen: ['moving press platen', 'platen'], 'force sensor': ['platen force and position transducer', 'force sensor'],
      'press controller': ['two-hand press safety controller', 'press controller'],
      'moving jaw': ['cast moving vise jaw', 'moving vise jaw'], 'vise jaw': ['cast moving vise jaw', 'cast fixed vise jaw', 'vise jaw'],
      handwheel: ['sliding vise handwheel', 'handwheel'], 'lead screw': ['Acme-thread lead screw', 'lead screw'],
      'lifting saddle': ['serrated lifting saddle', 'lifting saddle'], 'pump handle': ['removable pump handle', 'pump handle'],
      nacelle: ['wind-turbine nacelle housing', 'nacelle'], 'yaw ring': ['slewing yaw bearing ring', 'yaw bearing ring'], 'wind vane': ['nacelle wind-direction vane', 'wind-direction vane'],
      'work table': ['slotted drill work table', 'drill work table'], spindle: ['precision drill spindle', 'drill spindle'], 'drill bit': ['twist drill bit', 'drill bit'],
      'steering rack': ['toothed steering rack', 'steering rack'], 'tie rod': ['steering tie rod', 'tie rod'], 'steering wheel': ['driver steering wheel', 'steering wheel'],
      'brake rotor': ['ventilated bicycle brake rotor', 'brake rotor'], 'brake pad': ['bicycle brake pad', 'brake pad'], caliper: ['rigid bicycle brake caliper', 'brake caliper'], 'hand lever': ['cable hand lever', 'hand lever'],
      'grinding roller': ['left fluted grinding roller', 'right fluted grinding roller'], flywheel: ['drive flywheel', 'flywheel'],
      'aerodynamic blade': ['aerodynamic blade', 'blade'], 'primary support': ['primary support', 'main support', 'support'], support: ['support', 'outrigger', 'stay'],
    };
    const namedEntry = Object.entries(aliases)
      .filter(([name]) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(text))
      .sort(([left], [right]) => right.length - left.length)[0];
    const named = namedEntry?.[1] ?? [];
    const exactRoleTargets = world.components.filter((item) => named.some((term) => item.role === term));
    const primitiveTargets = world.components.filter((item) => named.some((term) => item.primitive === term || item.primitive === term.replace(/s$/, '')));
    const fuzzyRoleTargets = world.components.filter((item) => named.some((term) => item.role.includes(term)));
    const coarseNamedTargets = exactRoleTargets.length ? exactRoleTargets : primitiveTargets.length ? primitiveTargets : fuzzyRoleTargets;
    const namedMatch = namedEntry ? text.match(new RegExp(`\\b${namedEntry[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`)) : null;
    const qualifierContext = namedMatch?.index === undefined ? '' : text.slice(Math.max(0, namedMatch.index - 36), namedMatch.index);
    const requestedQualifiers = ['front', 'rear', 'left', 'right', 'input', 'output', 'upper', 'lower'].filter((qualifier) => new RegExp(`\\b${qualifier}\\b`).test(qualifierContext));
    const qualifiedTargets = requestedQualifiers.length ? coarseNamedTargets.filter((item) => requestedQualifiers.every((qualifier) => item.role.includes(qualifier))) : [];
    const namedTargets = qualifiedTargets.length ? qualifiedTargets : coarseNamedTargets;
    const headlightMount = headlightRequest && addingComponent
      ? world.components.find((item) => item.role === 'handlebar stem')
        ?? world.components.find((item) => item.role === 'steering head tube')
        ?? world.components.find((item) => /front.*fork|front.*frame|vehicle.*frame/.test(item.role))
      : undefined;
    const target = headlightMount
      ?? namedTargets[0]
      ?? world.components.find((item) => item.id === world.selectedComponentId);
    if (!target) throw new Error('Select or name a component to edit.');
    const bulkRequest = /\b(?:all|both|every)\b/.test(text);
    const editTargets = bulkRequest && namedTargets.length ? namedTargets : [target];
    const primitiveRequest = headlightRequest ? catalogFor('light') : primitiveCatalog.find((item) => new RegExp(`\\b${item.kind}s?\\b`).test(text));
    if (addingComponent && primitiveRequest) {
      const count = world.components.filter((item) => item.primitive === primitiveRequest.kind).length + 1;
      const id = `chat-${primitiveRequest.kind}-${count}`;
      const assemblyId = target.assemblyId || world.assemblies[0].id;
      const bicycleWorld = world.components.some((item) => Boolean(item.parameters.bicycle_wheel));
      const position: [number, number, number] = headlightRequest
        ? [Number((target.position[0] + .2).toFixed(3)), Number((target.position[1] - .08).toFixed(3)), Number((target.position[2] + (count > 1 ? (count % 2 ? -.14 : .14) : 0)).toFixed(3))]
        : [target.position[0], target.position[1] + Math.max(.35, target.dimensions[1]), target.position[2]];
      const role = headlightRequest ? (bicycleWorld ? 'front LED bicycle headlight' : 'directional LED headlight') : `chat-added ${primitiveRequest.name.toLowerCase()}`;
      const anchorA = position.map((value, index) => Number((value - target.position[index]).toFixed(3))) as [number, number, number];
      return [
        { tool: 'create_component', input: { component_id: id, primitive: primitiveRequest.kind, assembly_id: assemblyId, role, position, rotation: [0, 0, 0], dimensions: primitiveRequest.defaultDimensions, material_id: primitiveRequest.defaultMaterial, body_type: primitiveRequest.defaultBodyType, ...(headlightRequest ? { mass: .24, color: '#e9f5ff', parameters: { headlight: true, beam_range: 5 } } : {}) }, label: `Add ${primitiveRequest.name}` },
        { tool: 'connect_components', input: { connection_id: `chat-edge-${world.revision + 2}`, source_id: target.id, target_id: id, connection_type: 'mechanical', channel: 'chat_edit' }, label: `Connect ${primitiveRequest.name}` },
        { tool: 'create_joint', input: { joint_id: `chat-fixed-${world.revision + 3}`, joint_type: 'fixed', component_a: target.id, component_b: id, anchor_a: anchorA, anchor_b: [0, 0, 0], axis: [0, 1, 0] }, label: `Fix ${primitiveRequest.name} to ${target.role}` },
      ];
    }
    if (/\b(remove|delete)\b/.test(text)) return editTargets.map((item) => ({ tool: 'remove_component', input: { component_id: item.id }, label: `Remove ${item.role}` }));
    const material = materials.find((item) => text.includes(item.id));
    if (material) return editTargets.map((item) => ({ tool: 'set_material', input: { component_id: item.id, material_id: material.id }, label: `Use ${material.name} for ${item.role}` }));
    if (/\b(heavier|increase mass|more mass)\b/.test(text)) return editTargets.map((item) => ({ tool: 'set_mass', input: { component_id: item.id, mass: Number((item.mass * 1.25).toFixed(3)) }, label: `Increase ${item.role} mass` }));
    if (/\b(lighter|reduce mass|less mass)\b/.test(text)) return editTargets.map((item) => ({ tool: 'set_mass', input: { component_id: item.id, mass: Number((item.mass * .8).toFixed(3)) }, label: `Reduce ${item.role} mass` }));
    const distanceMatch = text.match(/(\d+(?:\.\d+)?)\s*(mm|millimeters?|cm|centimeters?|m|meters?)\b/);
    const rawDistance = Number(distanceMatch?.[1] ?? .5);
    const distance = distanceMatch?.[2]?.startsWith('mm') ? rawDistance / 1000 : distanceMatch?.[2]?.startsWith('c') ? rawDistance / 100 : rawDistance;
    const movementContext = namedMatch?.index === undefined ? text : text.slice(namedMatch.index + namedMatch[0].length);
    const movementRequested = /\b(?:left|right|up|higher|raise|down|lower|forward|back|backward)\b/.test(text);
    if (movementRequested) return editTargets.map((item) => {
      const moved = translateInForgeCoordinates(item.position, text, movementContext, distance);
      return { tool: 'move_component', input: { component_id: item.id, position: moved }, label: `Move ${item.role}` };
    });
    if (/\brotate|angle|tilt\b/.test(text)) {
      const degrees = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:°|degrees?)/)?.[1] ?? 15);
      return editTargets.map((item) => ({ tool: 'rotate_component', input: { component_id: item.id, rotation: [item.rotation[0], item.rotation[1], item.rotation[2] + degrees * Math.PI / 180] }, label: `Rotate ${item.role}` }));
    }
    const resizeIntent = /\b(longer|shorter|larger|bigger|smaller|wider|narrower|taller|thicker|thinner|height|width|thickness|lengthen|enlarge|resize|scale|reduce|shrink|stabilize|stabilise|outrigger)\b/.test(text);
    if (!resizeIntent) throw new Error('The local chat editor cannot map that request safely. Name the component and action, or connect your OpenAI key for a generative in-place edit.');
    const reducing = /\b(shorter|smaller|narrower|thinner|reduce|shrink)\b/.test(text);
    const requestedPercent = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/)?.[1] ?? 0);
    const scale = requestedPercent > 0
      ? (reducing ? Math.max(.1, 1 - requestedPercent / 100) : 1 + requestedPercent / 100)
      : reducing ? .8 : /\b(much|significantly)\b/.test(text) ? 1.4 : 1.2;
    return editTargets.map((item) => {
      const dimensions = [...item.dimensions] as [number, number, number];
      if (/\b(taller|height|thicker|thinner|thickness)\b/.test(text)) dimensions[1] *= scale;
      else if (/\b(wider|width|stabil|outrigger)\b/.test(text)) { dimensions[0] *= scale; dimensions[2] *= scale; }
      else {
        const axis = dimensions.indexOf(Math.max(...dimensions)); dimensions[axis] *= scale;
      }
      return { tool: 'set_dimensions', input: { component_id: item.id, dimensions: dimensions.map((value) => Number(value.toFixed(3))) }, label: `Resize ${item.role}` };
    });
  };

  const editWithChat = async (instruction: string) => {
    const prompt = instruction.trim();
    if (busy || prompt.length < 3) return;
    if (!state.components.length) { setError('Engineer a machine before editing it with chat.'); return; }
    const userMessage: EditMessage = { id: `edit-user-${Date.now()}`, role: 'user', text: prompt };
    setEditMessages((current) => [...current, userMessage].slice(-18)); setEditPrompt('');
    const priorClarification = pendingClarification(editMessages);
    const effectivePrompt = priorClarification ? `${priorClarification.request} ${prompt}` : prompt;
    const modelPrompt = resolvedEditPrompt(editMessages, prompt);
    const controller = new AbortController(); abortRef.current = controller; setAgentCancelable(true); setAnimationPlaying(false); setBusy(true); setChatThinking(true); setError(null);
    let actor = runtimeActor();
    try {
      await call('inspect_workspace', { since_revision: Math.max(0, state.revision - 1) }, 35, actor, controller.signal);
      let commands: EditCommand[];
      let summary: string;
      let expectedRevision = getSnapshot().revision;
      let expectedDesignHash = getSnapshot().designHash;
      let preserveComponentIds: string[] = [];
      const current = getSnapshot();
      const directMechanical = contextualMechanicalEdits(current, effectivePrompt);
      const directSpeedEdits = conveyorSpeedEdits(current, effectivePrompt);
      if (directMechanical.length) {
        commands = directMechanical;
        summary = `Resolved the mechanical edit from the current shared world: ${directMechanical.map((edit) => edit.label).join(' · ')}.`;
        addTrace('reasoning', 'Resolved contextual mechanical edit directly', summary);
      } else if (directSpeedEdits.length) {
        commands = directSpeedEdits.map((edit) => ({
          tool: 'set_motor_speed',
          input: { motor_id: edit.motorId, max_rpm: edit.maxRpm, direction: edit.direction },
          label: `Retune ${edit.motorId} from ${edit.previousRpm} to ${edit.maxRpm} rpm`,
        }));
        const increasing = directSpeedEdits[0].maxRpm > directSpeedEdits[0].previousRpm;
        summary = `${increasing ? 'Increased' : 'Reduced'} ${directSpeedEdits.length === 1 ? 'the conveyor drive' : `all ${directSpeedEdits.length} conveyor drives`} to ${directSpeedEdits.map((edit) => `${edit.maxRpm} rpm`).join(', ')} without changing the machine geometry.`;
        addTrace('reasoning', 'Resolved conveyor speed edit directly', summary);
      } else if (actor === 'ModelAgent') {
        addTrace('action', 'Model is editing the current world', modelPrompt);
        try {
          expectedRevision = current.revision; expectedDesignHash = current.designHash;
          const latest = current.runs.at(-1) ?? null;
          const response = await requestAgentEdit(modelPrompt, {
            revision: current.revision, design_hash: current.designHash,
            machine_name: current.goal?.machineName ?? 'Mechanical system', goal: current.goal?.brief ?? goalPrompt,
            max_components: current.goal?.maxComponents ?? 80, selected_component_id: current.selectedComponentId ?? '',
            world: { gravity: current.world.gravity, bounds: current.world.bounds, environment: current.world.environment },
            goal_constraints: current.goal?.constraints.map((item) => ({ metric: item.metric, label: item.label, operator: item.operator, target: item.target, unit: item.unit })) ?? [],
            assemblies: current.assemblies.map((item) => ({ id: item.id, name: item.name, purpose: item.purpose, parent_id: item.parentId ?? '' })),
            components: current.components.map((item) => ({
              id: item.id, role: item.role, primitive: item.primitive, assembly_id: item.assemblyId,
              position: item.position, rotation: item.rotation, dimensions: item.dimensions,
              material_id: item.materialId, body_type: item.bodyType, mass: item.mass, color: item.color,
              parameters: item.parameters, human_locked_fields: item.humanLockedFields,
            })),
            connections: current.connections.map((item) => ({ id: item.id, source_id: item.sourceId, target_id: item.targetId, connection_type: item.type, channel: item.channel })),
            joints: current.joints.map((item) => ({ id: item.id, joint_type: item.type, component_a: item.componentA, component_b: item.componentB, axis: item.axis, limits: item.limits ?? null, ratio: item.ratio ?? null, stiffness: item.stiffness ?? null, damping: item.damping ?? null })),
            motors: current.motors.map((item) => ({ id: item.id, component_id: item.componentId, joint_id: item.jointId ?? '', max_torque: item.maxTorque, max_rpm: item.maxRpm, direction: item.direction })),
            sensors: current.sensors.map((item) => ({ id: item.id, component_id: item.componentId, sensor_type: item.type, channel: item.channel, target_id: item.targetId ?? '', range: item.range })),
            actuators: current.actuators.map((item) => ({ id: item.id, component_id: item.componentId, joint_id: item.jointId, actuator_type: item.type, max_force: item.maxForce, max_speed: item.maxSpeed, travel: item.travel })),
            controls: current.controls.map((item) => ({ id: item.id, name: item.name, mode: item.mode, sensor_ids: item.sensorIds, actuator_ids: item.actuatorIds, expression: item.expression, setpoint: item.setpoint, kp: item.kp, ki: item.ki, kd: item.kd })),
            latest_run: latest ? { status: latest.status, score: latest.metrics.score, failed_metrics: latest.metrics.measures.filter((item) => item.status === 'fail').map((item) => item.metric) } : null,
            conversation: [...editMessages.slice(-7), userMessage].map((item) => ({ role: item.role, text: item.text })),
          }, agentKey || undefined, controller.signal);
          setAgentModel(response.model); setAgentConnectionError(null);
          if (response.result.needs_clarification) {
            const question = response.result.clarification_question;
            if (priorClarification) {
              commands = localEditCommands(effectivePrompt);
              summary = `The model repeated a clarification after your answer, so ForgeTwin resolved the bounded edit locally: ${commands.map((item) => item.label).join(' · ')}.`;
              addTrace('fallback', 'Clarification loop prevented', 'The user answer was merged with the original request and executed through the guarded local editor.');
            } else {
              setEditMessages((messages) => [...messages, { id: `edit-agent-${Date.now()}`, role: 'agent' as const, kind: 'clarification' as const, text: question }].slice(-18));
              addTrace('reasoning', 'Chat edit needs one detail', `${response.result.understanding} ${question}`);
              setToast('The agent asked one clarification before changing the world');
              return;
            }
          } else {
            summary = response.result.understanding; commands = modelEditCommands(response.result.actions);
            preserveComponentIds = response.result.preserve_ids;
            addTrace('reasoning', 'Model proposed an in-place revision', summary);
          }
        } catch (caught) {
          actor = 'Deterministic'; const failure = recordModelFailure(caught); commands = localEditCommands(effectivePrompt);
          summary = `The model was unavailable, so the local chat interpreter applied: ${commands.map((item) => item.label).join(' · ')}.`;
          addTrace('fallback', 'Local chat editor took over for this edit', `${failure.message}${failure.disconnected ? ' The hosted model or another visitor key can be used on the next retry.' : ' The model remains available for the next retry.'}`);
        }
      } else {
        commands = localEditCommands(effectivePrompt); summary = `Local chat edit: ${commands.map((item) => item.label).join(' · ')}.`;
      }
      ensureActive(controller.signal);
      must(commandBatch(commands.map((edit) => ({ name: edit.tool, input: edit.input })), actor, { expectedRevision, expectedDesignHash, preserveComponentIds }));
      await pause(Math.min(220, Math.max(45, commands.length * 25)));
      ensureActive(controller.signal);
      addTrace('action', 'Chat revision committed', commands.map((item) => item.tool).join(' → '));
      must(await runMachine(actor));
      for (let iteration = 0; iteration < 2 && getSnapshot().runs.at(-1)?.status === 'failed'; iteration += 1) actor = await redesignRun(getSnapshot().runs.at(-1)!, `${goalPrompt}\nThe user then requested this in-place edit: ${prompt}`, actor, controller.signal);
      const final = getSnapshot().runs.at(-1);
      const resultText = `${summary} ${final?.status === 'passed' ? `All evaluated requirements pass at ${final.metrics.score}% after the edit.` : final?.status === 'partial' ? `The edit is applied; the run is partial at ${final.evaluationLevel} fidelity, so review requirement coverage.` : 'The revision is applied; open telemetry to inspect the remaining failed constraint.'}`;
      setEditMessages((current) => [...current, { id: `edit-agent-${Date.now()}`, role: 'agent' as const, text: resultText }].slice(-18));
      addTrace(final?.status === 'passed' ? 'complete' : 'observation', 'Chat edit evaluated', resultText);
      setToast(final?.status === 'passed' ? 'Chat edit applied and run evidence passed' : final?.status === 'partial' ? 'Chat edit applied; run is partially evaluated' : 'Chat edit applied; inspect the remaining constraint');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The chat edit could not be applied.';
      setEditMessages((current) => [...current, { id: `edit-agent-${Date.now()}`, role: 'agent' as const, text: message }].slice(-18)); setError(message);
    } finally { abortRef.current = null; setAgentCancelable(false); setChatThinking(false); setBusy(false); }
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

  if (state.screen === 'landing') return <><Landing state={state} toolCount={registeredTools} prompt={goalPrompt} promptError={promptError} busy={busy} agentRuntime={agentRuntime} agentModel={agentModel} onConfigureAgent={() => setAgentSettingsOpen(true)} onPromptChange={updateGoalPrompt} onEnter={enterScratchWorld} onGenerate={generateFromPrompt} onExample={(example) => { setGoalPrompt(example.prompt); setPromptError(null); }} />{generationVisual && <GenerationSequence state={generationVisual} onCancel={cancelAgentRun} />}{agentSettingsOpen && <AgentSettingsDialog runtime={agentRuntime} model={agentModel} hasTemporaryKey={Boolean(agentKey)} connecting={agentConnecting} connectionError={agentConnectionError} onConnect={connectTemporaryModel} onDisconnect={disconnectTemporaryModel} onClose={() => setAgentSettingsOpen(false)} />}</>;

  const latestRun = state.runs.at(-1) ?? null;
  const firstFailedRun = state.runs.find((run) => run.status === 'failed') ?? null;
  const startFailureReplay = (runId: string) => { setAnimationPlaying(false); patchUi({ replayRunId: runId, replayMode: 'failure' }); };
  const humanChallenge = ['passed', 'partial'].includes(state.phase) && !state.humanConstraints.length;
  const humanEdited = state.humanConstraints.length > 0 && (!latestRun || latestRun.designHash !== state.designHash);
  const finalHumanPass = state.phase === 'passed' && state.humanConstraints.length > 0 && latestRun?.designHash === state.designHash;

  return <div className="forge-shell"><a className="skip-link" href="#forge-main">Skip to engineering workspace</a>
    <header className="forge-header">
      <button className="brand-lockup" aria-label="ForgeTwin home" onClick={() => patchUi({ screen: 'landing' })} disabled={busy}><span className="brand-mark"><span>F</span></span><span><strong>ForgeTwin</strong><small>world-first AI engineering</small></span></button>
      <div className="header-center"><span className={`live-dot ${agentRuntime !== 'deterministic' ? 'cyan' : ''}`} />{agentRuntime === 'session-model' ? `${agentModel} · your key` : agentRuntime === 'server-model' ? `${agentModel} · hosted AI ready` : 'Local engineer ready'} <span className="header-divider" /> REV {state.revision.toString().padStart(2, '0')} <span className="header-divider" /> {registeredTools === FORGE_TOOL_COUNT ? `${registeredTools} WebMCP tools live` : registeredTools === WEBMCP_CHECKING ? 'Connecting WebMCP…' : 'Open in a WebMCP-enabled browser'}</div>
      <div className="header-actions"><button className="ghost-button chat-edit-button" disabled={busy} onClick={() => setSideTab('chat')}><MessageSquareText size={14} />Chat edit</button><button className="ghost-button" disabled={busy} onClick={() => setAgentSettingsOpen(true)}><KeyRound size={14} />Agent</button><button className="ghost-button export-button" disabled={busy || !state.components.length} onClick={() => setExportOpen(true)}><Download size={14} />Export</button><button className="ghost-button" disabled={busy} onClick={() => { checkpoint('Manual world checkpoint'); setToast('World checkpoint saved'); }}><Save size={14} />Checkpoint</button><button className="ghost-button" disabled={busy} onClick={undo}><Undo2 size={14} />Undo</button><button className="ghost-button" disabled={busy} onClick={() => setDrawer('compare')}><GitCompareArrows size={14} />Compare runs</button><button className="ghost-button" disabled={busy} onClick={() => { setAnimationPlaying(false); reset('landing'); setGoalPrompt(DEFAULT_DESIGN_PROMPT); setPromptError(null); setAgentTrace([]); setEditMessages([]); setToast('Sandbox reset — ready for any mechanical goal'); }}><RotateCcw size={14} />Reset</button><button className="run-button" onClick={runHeaderSimulation} disabled={busy}>{busy ? <Cpu size={14} /> : <Play size={14} fill="currentColor" />}{busy ? 'Engineering…' : 'Run physics'}</button></div>
    </header>
    <main id="forge-main" className="forge-main">
      <aside className="catalog-panel" aria-label="World hierarchy">
        <div className="panel-heading"><div><span className="eyebrow">Generated world graph</span><h2>Assemblies</h2></div><button aria-label="Open primitive catalog" onClick={() => setDrawer('catalog')}><Settings2 size={16} /></button></div>
        <div className="capacity"><span>{state.components.length} / {state.goal?.maxComponents ?? 80} bodies</span><span>{state.joints.length} joints</span><i><b style={{ width: `${Math.min(100, state.components.length / (state.goal?.maxComponents ?? 80) * 100)}%` }} /></i></div>
        <AssemblyTree state={state} onSelect={(id) => patchUi({ selectedComponentId: id })} />
        {!state.components.length && <div className="empty-feed"><Layers3 size={23} /><strong>Empty physical world</strong><p>Enter a goal and the agent will create assemblies from low-level primitives.</p></div>}
        <div className="constraint-card"><span className="eyebrow">{state.goal?.domain ?? 'World-first planner'}</span><p>{state.goal?.summary ?? 'Describe a physical system. The planner composes reusable bodies, joints, devices, and controls instead of selecting a machine template.'}</p>{state.goal?.brief && <blockquote>“{state.goal.brief}”</blockquote>}<button onClick={() => setGoalOpen((value) => !value)} aria-expanded={goalOpen}>Inspect constraints <ChevronDown size={14} className={goalOpen ? 'rotate-180' : ''} /></button>{goalOpen && <ul className="constraint-list">{state.goal?.constraints.map((constraint) => <li key={constraint.metric}><Check size={11} />{constraint.label} {constraintSymbol(constraint.operator)} {constraint.target}{constraint.unit}</li>)}<li><Check size={11} />Rapier · 60 Hz · seed 424242</li></ul>}<button className="new-goal-link" onClick={() => patchUi({ screen: 'landing' })}>Engineer a different system</button></div>
        {selected && <ComponentInspector component={selected} state={state} busy={busy} rotationSnapDegrees={rotationSnapDegrees} onRotationSnapChange={setRotationSnapDegrees} onMove={(position) => handleEditableMove(selected.id, position)} onRotate={(rotation) => handleEditableRotate(selected.id, rotation)} onUpdate={manualUpdate} />}
      </aside>
      <section className="viewport-panel" aria-label="3D mechanical world">
        <ForgeScene state={state} operating={animationPlaying} rotationSnapDegrees={rotationSnapDegrees} onComponentMove={handleEditableMove} onComponentRotate={handleEditableRotate} onSelect={(id) => patchUi({ selectedComponentId: id || null })} />
        <div className="viewport-topbar"><div className="scene-path"><span>{state.goal?.domain ?? 'Mechanical world'}</span><i>/</i><strong>{state.goal?.machineName ?? 'Empty sandbox'}</strong>{selected && <><i>/</i><b>{selected.role}</b></>}</div><div className="view-controls"><button className={animationPlaying ? 'active animation-control' : 'animation-control'} onClick={() => { const next = !animationPlaying; if (next) patchUi({ replayRunId: null, replayMode: 'normal' }); setAnimationPlaying(next); setToast(next ? 'Kinematic mechanism preview playing' : 'Kinematic preview paused'); }} aria-pressed={animationPlaying} disabled={busy || !state.components.length}>{animationPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{animationPlaying ? 'Pause preview' : 'Kinematic preview'}</button>{latestRun && <button className={state.replayRunId === latestRun.id ? 'active' : ''} onClick={() => { setAnimationPlaying(false); patchUi({ replayRunId: latestRun.id, replayMode: 'normal' }); setToast('Simulation replay ready'); }}><TimerReset size={14} />Replay simulation</button>}<button onClick={() => patchUi({ xray: !state.xray })} aria-pressed={state.xray} className={state.xray ? 'active' : ''}><Layers3 size={14} />X-Ray</button><button onClick={() => setDrawer('telemetry')}><Gauge size={14} />Results</button><button onClick={() => { setSideTab('history'); setDrawer('history'); }}><History size={14} />Revisions</button><button className="viewport-export" onClick={() => setExportOpen(true)} disabled={!state.components.length}><Download size={14} />Export</button></div></div>
        <div className="viewport-status"><span className="live-dot cyan" />RAPIER MULTI-BODY <i />60 HZ <i />SEED 424242 <i />{state.components.length} BODIES · {state.joints.length} JOINTS</div>
        {!state.components.length && <div className="empty-machine-card"><span className="goal-avatar"><Sparkles size={18} /></span><span className="eyebrow">General-purpose physical sandbox</span><h1>Describe the system.<br />ForgeTwin builds the world.</h1><p>No profile selector. The agent creates reusable primitives, physical properties, joints, sensing, actuation, and control logic from scratch.</p><GoalComposer id="lab-design-goal" prompt={goalPrompt} error={promptError} busy={busy} compact agentRuntime={agentRuntime} onPromptChange={updateGoalPrompt} onGenerate={generateFromPrompt} /></div>}
        {state.phase === 'failed' && latestRun && <FailureBanner run={latestRun} onReplay={() => startFailureReplay(latestRun.id)} onFix={diagnoseAndFix} busy={busy} />}
        {humanChallenge && <div className="challenge-banner"><span className="challenge-icon"><Move3D size={18} /></span><div><span className="eyebrow">Generated + run evidence available</span><strong>Now perturb the shared world yourself.</strong><p>Drag the highlighted {state.goal?.editableLabel} across the floor for X/Z, hold Shift while dragging for height, or use the three-axis controls. The agent must preserve your change.</p></div><div className="challenge-actions">{firstFailedRun && <button className="secondary" onClick={() => startFailureReplay(firstFailedRun.id)}><TimerReset size={13} />Replay failure</button>}<button onClick={() => { patchUi({ selectedComponentId: state.goal?.editableComponentId ?? null, xray: true }); setToast(`Selected ${state.goal?.editableLabel}`); }}>Select editable body</button></div></div>}
        {humanEdited && <div className="challenge-banner human"><span className="challenge-icon"><Radio size={18} /></span><div><span className="eyebrow">Human edit detected</span><strong>{state.humanConstraints.length} {state.humanConstraints.length === 1 ? 'body has' : 'bodies have'} locked fields.</strong><p>{state.humanConstraints.map((item) => `${state.components.find((component) => component.id === item.componentId)?.role ?? item.componentId}: ${item.fields.join(', ')}`).join(' · ')}. The agent will preserve every field and redesign the surrounding world.</p></div><button onClick={retuneHumanEdit} disabled={busy}>{busy ? 'Redesigning…' : 'Redesign around my change'}</button></div>}
        {finalHumanPass && latestRun && <div className="pass-banner"><span><BadgeCheck size={20} /></span><div><strong>All constraints pass with the human edit preserved.</strong><p>{latestRun.metrics.measures.slice(0, 3).map((item) => `${item.label} ${item.value}${item.unit}`).join(' · ')}</p></div><button onClick={() => setDrawer('compare')}>Compare designs</button></div>}
      </section>
      <aside className="agent-panel" aria-label="Agent activity"><div className="side-tabs"><button className={sideTab === 'chat' ? 'active' : ''} onClick={() => setSideTab('chat')}><MessageSquareText size={13} />Chat edit</button><button className={sideTab === 'activity' ? 'active' : ''} onClick={() => setSideTab('activity')}><Activity size={13} />Activity</button><button className={sideTab === 'history' ? 'active' : ''} onClick={() => setSideTab('history')}><History size={13} />History</button></div>{sideTab === 'chat' ? <AgentChat state={state} messages={editMessages} prompt={editPrompt} busy={busy} thinking={chatThinking} model={agentModel} modelConnected={agentRuntime !== 'deterministic'} selected={selected} onPromptChange={setEditPrompt} onSubmit={editWithChat} /> : sideTab === 'activity' ? <AgentFeed state={state} toolCount={registeredTools} trace={agentTrace} runtime={agentRuntime} model={agentModel} busy={busy} canCancel={agentCancelable} onCancel={cancelAgentRun} onConfigure={() => setAgentSettingsOpen(true)} /> : <RevisionHistory state={state} onRestore={(revision) => { const result = command('restore_revision', { revision }, 'UI'); if (result.ok) setToast(`Revision ${revision} restored`); else setError(result.error.message); }} />}<MetricStack metrics={latestRun?.designHash === state.designHash ? latestRun.metrics : null} phase={latestRun?.designHash === state.designHash ? state.phase : state.components.length ? 'ready' : state.phase} />{state.goal && <p className="model-note"><AlertTriangle size={12} />{state.goal.disclaimer}</p>}</aside>
    </main>
    {error && <div className="error-toast" role="alert"><AlertTriangle size={15} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X size={14} /></button></div>}
    {toast && <div className="success-toast" role="status"><Check size={14} />{toast}</div>}
    {drawer && <Drawer type={drawer} state={state} onClose={() => setDrawer(null)} onRestore={(revision) => { const result = command('restore_revision', { revision }, 'UI'); if (result.ok) setToast(`Revision ${revision} restored`); else setError(result.error.message); }} onAddPrimitive={addPrimitive} />}
    {generationVisual && <GenerationSequence state={generationVisual} onCancel={cancelAgentRun} />}
    {agentSettingsOpen && <AgentSettingsDialog runtime={agentRuntime} model={agentModel} hasTemporaryKey={Boolean(agentKey)} connecting={agentConnecting} connectionError={agentConnectionError} onConnect={connectTemporaryModel} onDisconnect={disconnectTemporaryModel} onClose={() => setAgentSettingsOpen(false)} />}
    {exportOpen && <ExportDialog state={state} onClose={() => setExportOpen(false)} onSuccess={(message) => setToast(message)} onError={(message) => setError(message)} />}
    <div className="sr-only" aria-live="polite">{busy ? 'Agent is engineering the shared physical world' : toast ?? error ?? ''}</div>
  </div>;
}

const EXPORT_OPTIONS: Array<{ format: ForgeExportFormat; title: string; extension: string; description: string; icon: 'image' | 'report' | 'cad' | 'data' }> = [
  { format: 'png', title: 'Presentation PNG', extension: '.PNG · 1800 × 1200', description: 'Lossless 3:2 image of the current live camera view with design evidence.', icon: 'image' },
  { format: 'png-fallback', title: 'Compatibility CPU PNG', extension: '.PNG · 1800 × 1200 · NO WEBGL', description: 'Guaranteed visible engineering projection for browsers, judges, or devices where WebGL capture is unavailable.', icon: 'image' },
  { format: 'jpg', title: 'Shareable JPG', extension: '.JPG · 1800 × 1200', description: 'High-quality compressed image for galleries, slides, and submissions.', icon: 'image' },
  { format: 'pdf', title: 'Engineering report', extension: '.PDF · MULTI-PAGE', description: 'Branded design summary, current render, metrics, constraints, and bill of materials.', icon: 'report' },
  { format: 'stl', title: 'CAD exchange geometry', extension: '.STL · BINARY · MM', description: 'Compact combined assembly mesh in millimeters for SolidWorks, Creo, Fusion 360, FreeCAD, ShareCAD, and other CAD tools.', icon: 'cad' },
  { format: 'json', title: 'Engineering data', extension: '.JSON · FULL WORLD', description: 'Machine goal, bodies, transforms, materials, joints, controls, and latest telemetry.', icon: 'data' },
];

function ExportDialog({ state, onClose, onSuccess, onError }: { state: ForgeState; onClose: () => void; onSuccess: (message: string) => void; onError: (message: string) => void }) {
  const [exporting, setExporting] = useState<ForgeExportFormat | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('button[aria-label="Close export dialog"]')?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [exporting]);
  const startExport = async (format: ForgeExportFormat) => {
    setExporting(format);
    try {
      await exportForgeDesign(state, format);
      onSuccess(format === 'stl' ? 'CAD assembly exported for SolidWorks, Creo, and compatible tools' : `${format.toUpperCase()} export downloaded`);
    } catch (caught) { onError(caught instanceof Error ? caught.message : 'The design could not be exported.'); }
    finally { setExporting(null); }
  };
  const iconFor = (kind: typeof EXPORT_OPTIONS[number]['icon']) => kind === 'image' ? <ImageIcon size={20} /> : kind === 'report' ? <FileText size={20} /> : kind === 'cad' ? <Box size={20} /> : <Code2 size={20} />;
  return <div className="export-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !exporting) onClose(); }}><section ref={dialogRef} className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title"><header><div><span className="eyebrow">Fabrication handoff</span><h2 id="export-title">Export this engineered world</h2><p>Take the current camera view, evidence report, or exchange geometry into the next tool.</p></div><button onClick={onClose} disabled={Boolean(exporting)} aria-label="Close export dialog"><X size={17} /></button></header><div className="export-grid">{EXPORT_OPTIONS.map((option) => <button key={option.format} type="button" className={`export-option ${option.format === 'stl' ? 'featured' : ''}`} onClick={() => startExport(option.format)} disabled={Boolean(exporting)}><span className="export-option-icon">{exporting === option.format ? <Cpu size={20} /> : iconFor(option.icon)}</span><span><small>{option.extension}</small><strong>{option.title}</strong><p>{option.description}</p></span><Download size={15} className="export-download-icon" /></button>)}</div><footer><span><BadgeCheck size={13} />Exports preserve the current revision and human-authored transforms.</span><p><strong>CAD note:</strong> STL is real triangulated exchange geometry. Native SolidWorks/Creo parametric feature trees require reconstruction after import.</p></footer></section></div>;
}

const GENERATION_PHASES: Array<{ id: GenerationPhase; label: string; short: string }> = [
  { id: 'interpreting', label: 'Intent', short: 'Parse goal' },
  { id: 'planning', label: 'Architecture', short: 'Choose primitives' },
  { id: 'assembling', label: 'Assembly', short: 'Place bodies' },
  { id: 'linking', label: 'Systems', short: 'Wire joints' },
  { id: 'simulating', label: 'Physics', short: 'Run at 60 Hz' },
  { id: 'complete', label: 'Evaluated', short: 'Report evidence' },
];

function GenerationSequence({ state, onCancel }: { state: GenerationVisualState; onCancel: () => void }) {
  const cancelActionRef = useRef(onCancel);
  const phaseRef = useRef(state.phase);
  const activeIndex = state.phase === 'optimizing' ? 4 : GENERATION_PHASES.findIndex((item) => item.id === state.phase);
  useEffect(() => { cancelActionRef.current = onCancel; }, [onCancel]);
  useEffect(() => { phaseRef.current = state.phase; }, [state.phase]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === 'Escape' && phaseRef.current !== 'complete') { event.preventDefault(); cancelActionRef.current(); } };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, []);
  return <div className={`generation-backdrop phase-${state.phase}`}>
    <section className="generation-stage" aria-label="Live engineering progress">
      <span className="sr-only" role="status" aria-live="polite" aria-label="Live engineering progress">{state.headline}</span>
      <header className="generation-header"><span className="generation-live-icon"><Cpu size={16} /></span><div><small>BUILDING IN THE VISIBLE WORLD</small><strong>{state.headline}</strong></div><b>{Math.round(state.progress)}%</b></header>
      <div className="generation-copy">
        <span className="generation-kicker"><Sparkles size={12} />{state.machineName ?? 'Interpreting the physical system'}</span>
        <p aria-hidden="true">{state.detail}</p>
        <div className="generation-counters" aria-label="Build counters">
          <span><small>Bodies</small><strong>{state.totalBodies ? `${state.builtBodies ?? 0}/${state.totalBodies}` : '—'}</strong></span>
          <span><small>Links</small><strong>{state.totalLinks ? `${state.builtLinks ?? 0}/${state.totalLinks}` : '—'}</strong></span>
          <span><small>Physics</small><strong>60 Hz</strong></span>
        </div>
      </div>
      <ol className="generation-timeline" aria-label="Engineering stages">
        {GENERATION_PHASES.map((item, index) => <li key={item.id} title={item.short} className={index < activeIndex || state.phase === 'complete' ? 'done' : index === activeIndex ? 'active' : ''}><span>{index < activeIndex || state.phase === 'complete' ? <Check size={10} /> : index + 1}</span><strong>{item.label}</strong></li>)}
      </ol>
      <footer className="generation-footer"><div className="generation-progress" role="progressbar" aria-label="Engineering progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress)}><i style={{ width: `${state.progress}%` }} /></div><button type="button" onClick={onCancel} disabled={state.phase === 'complete'}>{state.phase === 'complete' ? <><Check size={12} />Evaluated</> : <><X size={12} />Cancel</>}</button></footer>
    </section>
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
  const modelConnected = agentRuntime !== 'deterministic';
  const visitorModel = agentRuntime === 'session-model';
  const [templateQuery, setTemplateQuery] = useState('');
  const [templateSector, setTemplateSector] = useState('All sectors');
  const templateSectors = ['All sectors', ...new Set(engineeringExamples.map((example) => example.sector))];
  const visibleExamples = engineeringExamples.filter((example) => (templateSector === 'All sectors' || example.sector === templateSector)
    && `${example.title} ${example.description} ${example.prompt} ${example.builds}`.toLowerCase().includes(templateQuery.trim().toLowerCase()));
  return <div className="landing-shell"><header className="landing-nav"><button className="brand-lockup" aria-label="ForgeTwin home" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><span className="brand-mark"><span>F</span></span><span><strong>ForgeTwin</strong><small>world-first AI engineering</small></span></button><div><span className={`landing-status ${modelConnected ? 'model-connected' : ''}`}><i />{visitorModel ? `${agentModel} · your key` : modelConnected ? `${agentModel} · AI included` : 'Local engineer ready'}</span><button className="ghost-button" onClick={onConfigureAgent}><KeyRound size={13} />{visitorModel ? 'Agent settings' : 'Connect AI'}</button><button className="ghost-button" onClick={onEnter}>Open sandbox</button></div></header>
    <main className="landing-hero"><div className="hero-copy"><span className="hero-kicker"><Sparkles size={13} />Agent-native physical engineering</span><h1>Don’t generate it.<br /><em>Engineer it.</em></h1><p>Describe almost any mechanical system. ForgeTwin decomposes the goal into reusable primitives, creates a jointed physical world, simulates it, measures failures, and redesigns the causal parts until the constraints pass.</p><GoalComposer id="design-goal" prompt={prompt} error={promptError} busy={busy} agentRuntime={agentRuntime} onPromptChange={onPromptChange} onGenerate={onGenerate} /><div className={`agent-runtime-card ${modelConnected ? 'connected' : 'local'}`}><span><Bot size={16} /></span><div><strong>{modelConnected ? `Engineering agent · ${agentModel}` : 'Local deterministic engineer'}</strong><p>{modelConnected ? `${agentModel} plans, edits the existing world through chat, and selects evidence-driven redesigns. Every action still passes through guarded tools.` : 'Fully functional offline build, physics, telemetry, and bounded chat edits. Connect the flagship model for model-selected reasoning.'}</p></div><button type="button" onClick={onConfigureAgent}>{modelConnected ? 'Manage' : 'Connect model'}</button></div><div className="quick-examples" aria-label="Example engineering systems">{CHALLENGE_EXAMPLES.slice(0, 7).map((example) => <button key={example.id} type="button" onClick={() => onExample(example)}>{example.title}</button>)}</div><div className="hero-actions"><button className="ghost-button hero-secondary" onClick={onEnter} type="button"><Code2 size={15} />Explore empty world</button></div><div className="hero-proof"><span><strong>{primitiveCatalog.length}</strong> reusable primitives</span><span><strong>8</strong> joint types</span><span><strong>60 Hz</strong> multi-body physics</span></div></div>
      <div className="hero-machine"><ForgeScene state={state} preview operating onComponentMove={() => undefined} onSelect={() => undefined} /><div className="hero-hud top"><span>LIVE PHYSICAL WORLD</span><strong>PROMPT → PRIMITIVES → PHYSICS</strong></div><div className="hero-hud bottom"><span>NO COMPLETE-MACHINE TEMPLATES</span><strong>ASSEMBLIES ARE SYNTHESIZED</strong></div><div className="hero-orbit-label one"><i />Explicit mass + material</div><div className="hero-orbit-label two"><i />Joints + control graph</div></div></main>
    <section className="landing-strip" aria-label="How ForgeTwin works"><article><Cpu size={17} /><div><strong>Agent decomposes</strong><span>Goals become capabilities, constraints, bodies, joints, and control channels.</span></div></article><article><AlertTriangle size={17} /><div><strong>Physics rejects</strong><span>Mass, geometry, support, torque, contacts, and control become evidence.</span></div></article><article><Redo2 size={17} /><div><strong>Optimizer redesigns</strong><span>The agent changes causal fields and reruns the same shared world.</span></div></article><small>{toolCount === FORGE_TOOL_COUNT ? `${toolCount}/${FORGE_TOOL_COUNT} WebMCP tools live in this browser host` : toolCount === WEBMCP_CHECKING ? 'Connecting to this browser’s WebMCP host…' : `Open in ChatGPT’s in-app browser or Chrome with WebMCP enabled · ${FORGE_TOOL_COUNT} local tools remain available`}</small></section>
    <section className="sector-library" aria-labelledby="sector-heading"><div><span className="eyebrow">Editable engineering prompt gallery</span><h2 id="sector-heading">Start with a machine anyone can recognize.</h2><p>Choose a complete example, edit its exact goal, or write your own. The card, submitted prompt, mechanisms, animation plan, and success checks share one definition.</p></div><div className="template-filters"><label><Search size={14} /><span className="sr-only">Search templates</span><input type="search" value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} placeholder="Search machines or components" aria-label="Search engineering templates" /></label><label><span className="sr-only">Filter templates by sector</span><select value={templateSector} onChange={(event) => setTemplateSector(event.target.value)} aria-label="Template sector"><option>All sectors</option>{templateSectors.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label><span>{visibleExamples.length} designs</span></div><div className="sector-grid">{visibleExamples.map((example) => <button key={example.id} aria-label={`Use ${example.title} prompt: ${example.description}`} onClick={() => { onExample(example); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><span>{example.sector}</span><strong>{example.title}</strong><p>{example.description}</p><small><b>Builds</b>{example.builds}</small><div className="template-success"><b>Success</b>{example.correctMetrics.slice(0, 3).join(' · ')}</div><em><Clock3 size={11} />About {example.expectedGenerationSeconds}s · replay included</em></button>)}</div>{!visibleExamples.length && <div className="template-empty">No matching designs. Clear the search or describe the machine above.</div>}<p className="simulation-disclosure">ForgeTwin is a concept-level rigid-body sandbox. Production structures, medical equipment, vehicles, and lifting systems require professional analysis and certification.</p></section>
  </div>;
}

function GoalComposer({ id, prompt, error, busy, agentRuntime, compact = false, onPromptChange, onGenerate }: { id: string; prompt: string; error: string | null; busy: boolean; agentRuntime: AgentRuntimeMode; compact?: boolean; onPromptChange: (prompt: string) => void; onGenerate: (prompt: string) => void }) {
  const hintId = `${id}-hint`, errorId = `${id}-error`;
  const modelConnected = agentRuntime !== 'deterministic';
  return <form className={`goal-composer ${compact ? 'compact' : ''}`} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); onGenerate(prompt); }}><label htmlFor={id}>What should ForgeTwin engineer?</label><textarea id={id} value={prompt} onChange={(event) => onPromptChange(event.target.value)} maxLength={500} rows={compact ? 4 : 3} aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`} aria-invalid={Boolean(error)} disabled={busy} /><div className="goal-composer-meta"><span id={hintId}>{prompt.length}/500 · free-form world synthesis · measurable constraints</span><button className="run-button hero" type="submit" disabled={busy || prompt.trim().length < 12}><Sparkles size={15} />{busy ? 'Engineering…' : modelConnected ? 'Engineer with AI' : 'Engineer locally'}</button></div>{error && <p className="goal-error" id={errorId} role="alert"><AlertTriangle size={13} />{error}</p>}</form>;
}

function AgentSettingsDialog({ runtime, model, hasTemporaryKey, connecting, connectionError, onConnect, onDisconnect, onClose }: { runtime: AgentRuntimeMode; model: string; hasTemporaryKey: boolean; connecting: boolean; connectionError: string | null; onConnect: (key: string) => Promise<void>; onDisconnect: () => void; onClose: () => void }) {
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
  const visitorModel = runtime === 'session-model' && hasTemporaryKey;
  const hostedModel = runtime === 'server-model';
  const modelConnected = visitorModel || hostedModel;
  return <div className="agent-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !connecting) onClose(); }}><section ref={dialogRef} className="agent-settings" role="dialog" aria-modal="true" aria-labelledby="agent-settings-title"><header><span><Bot size={18} /></span><div><small>AI model access</small><h2 id="agent-settings-title">Hosted AI or your own key</h2></div><button onClick={onClose} aria-label="Close agent settings" disabled={connecting}><X size={16} /></button></header><div className="agent-settings-body"><div className={`connection-state ${modelConnected ? 'connected' : 'local'}`}><i /><div><strong>{connecting ? `Checking ${model} access…` : visitorModel ? `${model} connected with your key` : hostedModel ? `${model} hosted AI is ready` : 'Local deterministic engineer active'}</strong><p>{connecting ? 'Validating the key and model without storing the key or generating a design.' : visitorModel ? 'Your key overrides the built-in model for planning, chat edits, and redesign decisions.' : hostedModel ? 'Judges receive the complete AI planning and chat-editing experience without entering credentials.' : 'ForgeTwin remains functional locally. Add your own key below to enable model-selected reasoning.'}</p></div></div>{connectionError && <p className="agent-connection-error" role="alert"><AlertTriangle size={13} />{connectionError}</p>}{!hasTemporaryKey && <form onSubmit={(event) => { event.preventDefault(); void onConnect(key); }}><label htmlFor="temporary-openai-key">Your OpenAI API key</label><input id="temporary-openai-key" type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="off" spellCheck={false} maxLength={300} placeholder="sk-…" disabled={connecting} /><p><KeyRound size={12} />Optional: your key overrides the hosted model only for this browser tab. It is sent to ForgeTwin’s same-origin route and never stored in localStorage or the project.</p><button className="run-button" type="submit" disabled={connecting || key.trim().length < 20 || key.trim().length > 300}><Bot size={14} />{connecting ? 'Verifying key…' : 'Verify & connect for this tab'}</button></form>}{hasTemporaryKey && <button className="disconnect-agent" onClick={onDisconnect} disabled={connecting}>Remove my key from this tab</button>}</div><footer><span>{visitorModel ? 'Your OpenAI account is charged only for model requests in this tab.' : 'Hosted AI is included for the hackathon demo.'} Rapier measurements—not model claims—determine pass or fail.</span><button onClick={onClose} disabled={connecting}>Done</button></footer></section></div>;
}

function FailureBanner({ run, onReplay, onFix, busy }: { run: SimulationRun; onReplay: () => void; onFix: () => void; busy: boolean }) {
  const failed = run.metrics.measures.find((item) => item.status === 'fail');
  return <div className="failure-banner"><span className="failure-icon"><AlertTriangle size={19} /></span><div><span className="eyebrow">Trial {run.id} · physics rejected</span><strong>{run.diagnosis.summary}</strong><p>{failed ? `${failed.label} ${failed.value}${failed.unit} vs ${constraintSymbol(failed.operator)} ${failed.target}${failed.unit} · ${failed.provenance}` : run.diagnosis.evidence}</p></div><button onClick={onReplay}><TimerReset size={13} />Replay 0.25×</button><button className="fix" onClick={onFix} disabled={busy}><Sparkles size={13} />{busy ? 'Optimizing…' : 'Inspect & redesign'}</button></div>;
}

function ComponentInspector({ component, state, onMove, onRotate, onUpdate, rotationSnapDegrees, onRotationSnapChange, busy }: { component: MachineComponent; state: ForgeState; onMove: (position: [number, number, number]) => void; onRotate: (rotation: [number, number, number]) => void; onUpdate: (name: ForgeToolName, input: Record<string, unknown>, message: string) => void; rotationSnapDegrees: number | null; onRotationSnapChange: (value: number | null) => void; busy: boolean }) {
  const materialIndex = materials.findIndex((item) => item.id === component.materialId);
  const nextMaterial = materials[(materialIndex + 1) % materials.length];
  const axisNames = ['X · forward/back', 'Y · up/down', 'Z · left/right'];
  const rotationAxes = ['X · roll', 'Y · yaw', 'Z · pitch'];
  const axisBounds: Array<[number, number]> = [[-state.world.bounds[0] / 2, state.world.bounds[0] / 2], [0, state.world.bounds[1]], [-state.world.bounds[2] / 2, state.world.bounds[2] / 2]];
  const moveAxis = (axis: number, value: number) => { const next = [...component.position] as [number, number, number]; next[axis] = value; onMove(next); };
  const rotateAxis = (axis: number, degrees: number) => { const next = [...component.rotation] as [number, number, number]; next[axis] = Math.atan2(Math.sin(next[axis] + degrees * Math.PI / 180), Math.cos(next[axis] + degrees * Math.PI / 180)); onRotate(next); };
  const setAngle = (axis: number, degrees: number) => { const next = [...component.rotation] as [number, number, number]; next[axis] = Math.atan2(Math.sin(degrees * Math.PI / 180), Math.cos(degrees * Math.PI / 180)); onRotate(next); };
  return <div className="sensor-inspector component-inspector"><span className="eyebrow">Selected body · {component.primitive}</span><div><strong>{component.role}</strong><code>{component.mass.toFixed(1)} kg</code></div><p>{component.dimensions.map((value) => value.toFixed(2)).join(' × ')} m · {component.materialId}</p><p className="drag-help"><Move3D size={12} />Drag X/Z · Shift-drag Y · colored rings rotate</p>{axisNames.map((label, axis) => <div className="axis-control" key={label}><label htmlFor={`selected-body-axis-${axis}`}>{label}<code>{component.position[axis].toFixed(2)} m</code></label><input id={`selected-body-axis-${axis}`} aria-label={`${component.role} ${label}`} type="range" min={axisBounds[axis][0]} max={axisBounds[axis][1]} step="0.05" value={component.position[axis]} onChange={(event) => moveAxis(axis, Number(event.target.value))} disabled={busy || state.phase === 'simulating'} /><div className="nudge-row"><button disabled={busy} onClick={() => moveAxis(axis, component.position[axis] - .5)}>− 0.5 m</button><button disabled={busy} onClick={() => moveAxis(axis, component.position[axis] + .5)}>+ 0.5 m</button></div></div>)}<div className="rotation-editor"><label>Rotation snap<select aria-label="Rotation snapping" value={rotationSnapDegrees ?? 'free'} onChange={(event) => onRotationSnapChange(event.target.value === 'free' ? null : Number(event.target.value))}><option value="free">Free</option><option value="1">1°</option><option value="5">5°</option><option value="15">15°</option><option value="45">45°</option></select></label><div className="rotation-fields">{rotationAxes.map((label, axis) => <label key={`${component.id}-${label}`}>{label}<input key={`${component.id}-${axis}-${component.rotation[axis]}`} type="number" min="-360" max="360" step="1" defaultValue={(component.rotation[axis] * 180 / Math.PI).toFixed(1)} onBlur={(event) => setAngle(axis, Number(event.target.value))} onKeyDown={(event) => { if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur(); }} disabled={busy} /></label>)}</div><div className="nudge-row rotation-nudges">{rotationAxes.map((label, axis) => <button key={label} disabled={busy} onClick={() => rotateAxis(axis, rotationSnapDegrees ?? 15)}>+{rotationSnapDegrees ?? 15}° {label[0]}</button>)}</div></div><div className="inspector-actions"><button disabled={busy} onClick={() => onRotate([0, 0, 0])}>Reset rotation</button><button disabled={busy} onClick={() => onUpdate('set_dimensions', { component_id: component.id, dimensions: component.dimensions.map((value) => Number((value * 1.1).toFixed(3))) }, `${component.role} resized +10%`)}>Size +10%</button><button disabled={busy} onClick={() => onUpdate('set_material', { component_id: component.id, material_id: nextMaterial.id }, `Material changed to ${nextMaterial.name}`)}>Next material</button></div>{component.humanLockedFields.length > 0 && <p><Radio size={11} />Human locks: {component.humanLockedFields.join(', ')}</p>}</div>;
}

function wholeMachineChatExamples(state: ForgeState) {
  const galleryExample = engineeringExamples.find((example) => state.goal?.brief.trim().toLowerCase() === example.prompt.toLowerCase());
  if (galleryExample) return galleryExample.suggestedEdits;
  const roles = state.components.map((item) => item.role).join(' ');
  if (/hydraulic press|press platen|press column/.test(roles)) return ['Make the press bed 10% thicker', 'Move the force sensor left 0.1 m', 'Use aluminum for the press controller'];
  if (/winch|winding drum|cable fairlead/.test(roles)) return ['Make the winding drum 10% larger', 'Move the cable load cell up 0.2 m', 'Use aluminum for the winch controller'];
  if (/vise jaw|vise handwheel|acme-thread lead screw/i.test(roles)) return ['Make the moving jaw 10% wider', 'Make the handwheel 15% larger', 'Use steel for the lead screw'];
  if (/bottle-jack|lifting saddle|hydraulic pump cylinder/.test(roles)) return ['Make the lifting saddle 10% larger', 'Lengthen the pump handle by 15%', 'Use aluminum for the jack pressure sensor'];
  if (/yaw bearing|wind-turbine nacelle|wind-direction vane/.test(roles)) return ['Make the yaw ring 10% larger', 'Move the wind vane up 0.2 m', 'Use aluminum for the nacelle'];
  if (/drill-press|drill spindle|drill work table|twist drill bit/.test(roles)) return ['Make the work table 15% wider', 'Lengthen the drill bit by 10%', 'Move the speed sensor up 0.2 m'];
  if (/steering rack|steering tie rod|steering pinion/.test(roles)) return ['Make the steering rack 10% wider', 'Lengthen both tie rods by 10%', 'Make the steering wheel 10% larger'];
  if (/bicycle brake rotor|bicycle brake pad|brake caliper/.test(roles)) return ['Make the brake rotor 10% larger', 'Make both brake pads 10% thicker', 'Use aluminum for the caliper'];
  if (/grain hopper|grinding roller|grain outlet|drive flywheel/.test(roles)) return ['Make both grinding rollers 10% larger', 'Make the hopper 15% wider', 'Make the flywheel 10% larger'];
  if (/centrifugal pump|pump volute|discharge flow/.test(roles)) return ['Make the discharge outlet 15% wider', 'Move the flow sensor up 0.2 m', 'Use aluminum for the pump base'];
  if (/planetary differential|planet carrier|planet gear/.test(roles)) return ['Make every planet gear 10% larger', 'Move the left output speed sensor up 0.2 m', 'Use aluminum for the differential housing'];
  if (/trommel|material recovery|recovered cans|recovered bottles/.test(roles)) return ['Make the metal recovery chute 20% wider', 'Increase the trommel drum diameter by 10%', 'Move the optical sensor up 0.3 m'];
  if (/conveyor|sorting|chute|bin/.test(roles)) return ['Lengthen the powered conveyor by 15%', 'Move the vision portal upstream 0.5 m', 'Widen both output chutes by 20%'];
  if (/crane|boom|counterweight|outrigger/.test(roles)) return ['Widen the crane carrier base by 20%', 'Increase the rear counterweight mass by 25%', 'Lengthen the lifting boom by 15%'];
  if (/road wheel|mobile chassis|suspension/.test(roles)) return ['Widen the wheelbase by 15%', 'Lower the payload deck by 0.2 m', 'Use aluminum for the mobile chassis'];
  if (/robotic|serial link|gripper/.test(roles)) return ['Lengthen the final arm link by 10%', 'Move the vision camera higher 0.3 m', 'Make the gripper 15% wider'];
  if (/rotor|aerodynamic blade|impeller/.test(roles)) return ['Make every aerodynamic blade 10% longer', 'Use aluminum for every aerodynamic blade', 'Move the rotor speed encoder up 0.2 m'];
  if (/gear|shaft|transmission/.test(roles)) return ['Make the output gear 10% larger', 'Use steel for both shafts', 'Move the speed sensor right 0.2 m'];
  if (/span|bridge|truss/.test(roles)) return ['Deepen the bridge deck by 15%', 'Add another structural support', 'Use steel for the span deck'];
  return ['Make the primary support 15% wider', 'Move the feedback sensor up 0.3 m', 'Add another structural support'];
}

function AgentChat({ state, messages, prompt, busy, thinking, model, modelConnected, selected, onPromptChange, onSubmit }: { state: ForgeState; messages: EditMessage[]; prompt: string; busy: boolean; thinking: boolean; model: string; modelConnected: boolean; selected: MachineComponent | null; onPromptChange: (value: string) => void; onSubmit: (value: string) => void }) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, thinking]);
  const examples = selected
    ? [`Make ${selected.role} 20% larger`, `Move ${selected.role} up 0.5 m`, `Use aluminum for ${selected.role}`]
    : wholeMachineChatExamples(state);
  return <div className="agent-chat"><div className="panel-heading"><div><span className="eyebrow">Natural-language world revision</span><h2>Edit with chat</h2></div><span className={`agent-live ${modelConnected ? 'model' : 'local'}`}><i />{modelConnected ? model : 'LOCAL'}</span></div>
    <div className="chat-context"><MessageSquareText size={16} /><div><strong>{selected ? `Editing around ${selected.role}` : 'Editing the complete machine'}</strong><p>The agent modifies this world in place, preserves human locks, reruns physics, and keeps every change in version history.</p></div></div>
    <div className="chat-messages" aria-live="polite">{messages.length ? messages.map((message) => <article key={message.id} className={message.role}><span>{message.role === 'agent' ? <Bot size={13} /> : 'YOU'}</span><p>{message.text}</p></article>) : !thinking && <div className="chat-empty"><Sparkles size={20} /><strong>Describe a revision</strong><p>Try “{examples[0].toLowerCase()}” or select a body for targeted edits.</p></div>}{thinking && <article className="agent chat-thinking" role="status" aria-label="ForgeTwin agent is thinking"><span><Bot size={13} /></span><p><i /><i /><i /><b className="sr-only">ForgeTwin agent is thinking</b></p></article>}<div ref={chatEndRef} /></div>
    <div className="chat-suggestions" aria-label="Suggested edits">{examples.map((example) => <button key={example} type="button" disabled={busy} onClick={() => onPromptChange(example)}>{example}</button>)}</div>
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); onSubmit(prompt); }}><label className="sr-only" htmlFor="machine-edit-prompt">Describe a change to the current machine</label><textarea id="machine-edit-prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder={`e.g. ${examples[0]}`} maxLength={300} rows={3} disabled={busy} /><button type="submit" disabled={busy || prompt.trim().length < 3} aria-label="Apply chat edit">{busy ? <Cpu size={14} /> : <Send size={14} />}{busy ? 'Engineering…' : 'Apply & simulate'}</button></form>
    <p className="chat-proof"><BadgeCheck size={12} />Every edit becomes guarded tool calls, a new revision, and a measured physics run.</p>
  </div>;
}

function AgentFeed({ state, toolCount, trace, runtime, model, busy, canCancel, onCancel, onConfigure }: { state: ForgeState; toolCount: number; trace: AgentTraceItem[]; runtime: AgentRuntimeMode; model: string; busy: boolean; canCancel: boolean; onCancel: () => void; onConfigure: () => void }) {
  const modelConnected = runtime !== 'deterministic';
  const actorLabel = (actor: Actor) => actor === 'WebMCP' ? 'External WebMCP agent' : actor === 'ModelAgent' ? `Model agent · ${model}` : actor === 'Deterministic' ? 'Local deterministic engineer' : actor === 'Human' ? 'Human' : actor === 'System' ? 'Legacy local automation' : 'Guided UI';
  return <div className="feed-wrap"><div className="panel-heading"><div><span className="eyebrow">Shared-world execution</span><h2>Agent console</h2></div><span className={`agent-live ${modelConnected ? 'model' : 'local'}`}><i />{modelConnected ? 'MODEL' : 'LOCAL'}</span></div>
    <div className={`agent-identity ${modelConnected ? 'connected' : 'local'}`}><span><Bot size={16} /></span><div><strong>{modelConnected ? model : 'Deterministic engineer'}</strong><p>{modelConnected ? 'Model decisions → guarded tools → Rapier evidence' : 'Guarded local planning → Rapier evidence'}</p></div><button onClick={onConfigure}>{modelConnected ? 'Manage' : 'Connect AI'}</button>{busy && canCancel && <button className="cancel-agent" onClick={onCancel}><Square size={10} fill="currentColor" />Stop</button>}</div>
    {trace.length > 0 && <ol className="agent-transcript" aria-label="Agent reasoning and observations">{[...trace].reverse().slice(0, 9).map((item) => <li key={item.id} className={item.kind}><span>{item.kind === 'complete' ? <BadgeCheck size={13} /> : item.kind === 'error' ? <AlertTriangle size={13} /> : item.kind === 'goal' ? <Sparkles size={13} /> : <Bot size={13} />}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{formatTime(item.at)}</time></li>)}</ol>}
    <div className="feed-divider"><span>World tool calls</span><small>{toolCount === FORGE_TOOL_COUNT ? 'External host connected' : toolCount === WEBMCP_CHECKING ? 'Detecting WebMCP host' : 'In-app execution'}</small></div>
    {state.activity.length ? <ol className="activity-list">{state.activity.slice(0, 12).map((event) => <li key={event.id} className={event.outcome}><span>{event.tool === 'run_simulation' ? <Activity size={14} /> : event.actor === 'Human' ? <MoveHorizontal size={14} /> : <Cpu size={14} />}</span><div><code>{event.tool}</code><p>{event.detail}</p><small>{actorLabel(event.actor)}</small></div><time>{formatTime(event.at)}</time></li>)}</ol> : <div className="empty-feed"><Cpu size={23} /><strong>No world actions yet</strong><p>Enter a physical goal. The in-app engineer will plan and execute it; WebMCP is optional for an external agent.</p></div>}
    <div className="tool-footer"><span>{toolCount === WEBMCP_CHECKING ? 'Registering WebMCP tools…' : `${toolCount}/${FORGE_TOOL_COUNT} WebMCP registered`}</span><code>{FORGE_TOOL_COUNT} in-app tools · rev {state.revision}</code></div></div>;
}

function MetricStack({ metrics, phase }: { metrics: Metrics | null; phase: ForgeState['phase'] }) {
  const values = metrics?.measures.slice(0, 6) ?? [];
  return <div className="metric-stack"><div className="metric-title"><span className="eyebrow">Run evidence</span><span className={`phase-chip ${phase}`}>{phase}</span></div><div className="metric-grid generic">{values.length ? values.map((reading) => <div key={reading.metric} className={reading.status === 'fail' ? 'danger' : reading.status === 'pass' ? 'metric-pass' : ''}><small>{reading.label}</small><strong>{reading.value}<em>{reading.unit}</em></strong>{reading.target !== undefined && <span>{constraintSymbol(reading.operator)} {reading.target}{reading.unit}</span>}<b>{(reading.evidence ?? 'not-evaluated').replaceAll('-', ' ')}</b></div>) : <><div><small>Constraint 01</small><strong>—</strong></div><div><small>Constraint 02</small><strong>—</strong></div><div><small>Bodies</small><strong>—</strong></div><div><small>Physics state</small><strong>—</strong></div></>}</div></div>;
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
    {type === 'telemetry' && <div className="drawer-content">{latest ? <><div className={`telemetry-hero ${latest.status}`}><Gauge size={21} /><div><strong>{latest.status === 'passed' ? 'Requirement evidence passed' : latest.status === 'partial' ? 'Partially evaluated — review limits' : 'Measured requirement failure'}</strong><span>{(latest.evaluationLevel ?? 'concept-only').replaceAll('-', ' ')} · {latest.physics.engine} · {latest.physics.timestepHz} Hz · {latest.physics.bodies} bodies · {latest.physics.joints} joints</span></div></div><div className="telemetry-cards"><div><small>Constraint score</small><strong>{latest.metrics.score}%</strong></div><div><small>Evaluation level</small><strong>{(latest.evaluationLevel ?? 'concept-only').replaceAll('-', ' ')}</strong></div><div><small>Total mass</small><strong>{latest.metrics.totalMass} kg</strong></div></div><h3>Requirement coverage</h3><div className="coverage-table" role="table" aria-label="Requirement coverage"><div className="coverage-head" role="row"><span role="columnheader">Requirement</span><span role="columnheader">Status</span></div>{(latest.requirementCoverage ?? []).map((item) => <article key={item.id} className={`coverage-row ${item.status}`} role="row"><div role="cell"><strong>{item.requirement}</strong><p>{item.category.replaceAll('-', ' ')} · {item.simulationEvidence}</p>{item.componentIds.length > 0 && <small>Components: {item.componentIds.join(', ')}</small>}{item.missingItems.length > 0 && <small className="coverage-missing">Missing: {item.missingItems.join(', ')}</small>}<small>Next: {item.recommendedCorrection}</small></div><span role="cell">{item.status.replaceAll('-', ' ')}</span></article>)}</div><h3>Measured constraints</h3>{latest.metrics.measures.map((reading) => <article className="event-row" key={reading.metric}><span className={reading.status}>{reading.status}</span><div><strong>{reading.label}: {reading.value}{reading.unit}</strong><p>Target {constraintSymbol(reading.operator)} {reading.target}{reading.unit} · {reading.provenance}</p><small className="evidence-chip">{(reading.evidence ?? 'not-evaluated').replaceAll('-', ' ')}</small></div></article>)}<details className="technical-details"><summary>Technical details</summary><h3>Diagnosis</h3><article className="event-row"><span>{latest.failures[0]?.time.toFixed(2) ?? '—'}s</span><div><strong>{latest.diagnosis.summary}</strong><p>{latest.diagnosis.evidence} {latest.diagnosis.action}</p></div></article><h3>Collision and contact events</h3>{latest.collisions.length ? latest.collisions.map((collision) => <article className="event-row collision-row" key={collision.id}><span>{collision.time.toFixed(2)}s</span><div><strong>{(collision.classification ?? 'connected-component-contact').replaceAll('-', ' ')} · {collision.impulse} N·s</strong><p>{collision.bodyA} ↔ {collision.bodyB} at [{(collision.point ?? [0, 0, 0]).join(', ')}] · replay frame {collision.replayFrame ?? 0}. {collision.reason ?? 'Legacy contact; rerun for current classification.'}</p></div></article>) : <div className="clean-run"><BadgeCheck size={15} />No contact event was emitted by this run.</div>}<h3>Run objective</h3><article className="event-row"><span>OBJ</span><div><strong>{latest.objective}</strong><p>{latest.telemetry.length} fixed-step samples are attached to this immutable run.</p></div></article></details></> : <div className="empty-feed"><Gauge size={23} /><strong>No run evidence yet</strong><p>Run physics to populate measurements, contacts, and requirement coverage.</p></div>}</div>}
    {type === 'compare' && <div className="drawer-content">{baseline && latest ? <><div className="compare-head"><span>Failed world</span><GitCompareArrows size={18} /><span>Current world</span></div>{latest.metrics.measures.slice(0, 6).map((reading) => <CompareMetric key={reading.metric} label={reading.label} before={formatReading(readingFor(baseline, reading.metric))} after={formatReading(reading)} good={reading.status === 'pass'} />)}<CompareMetric label="Total mass" before={`${baseline.configuration.totalMass} kg`} after={`${latest.configuration.totalMass} kg`} good /><CompareMetric label="Optimization passes" before={`${baseline.configuration.optimizationLevel}`} after={`${latest.configuration.optimizationLevel}`} good />{latest.status === 'passed' && state.humanConstraints.length > 0 && <div className="preserved-note"><MoveHorizontal size={16} /><span><strong>Human fields preserved.</strong>The agent changed surrounding physical or control fields.</span></div>}</> : <div className="empty-feed"><GitCompareArrows size={23} /><strong>Two runs are needed</strong><p>Generate a failing baseline and a measured redesign to compare evidence.</p></div>}</div>}
    {type === 'catalog' && <div className="drawer-content catalog-drawer">{primitiveCatalog.map((item) => <article key={item.id}><span style={{ background: item.color }} /><div><strong>{item.name}</strong><p>{item.description}</p><small>{item.family} · {item.capabilities.join(' · ')}</small></div><button onClick={() => onAddPrimitive(item.kind)} disabled={!state.goal} aria-label={`Add ${item.name}`}>Add</button></article>)}</div>}
    {type === 'history' && <div className="drawer-content"><RevisionHistory state={state} onRestore={onRestore} /></div>}
    <footer><span>{state.revisions.length} revisions · {state.runs.length} physics runs</span>{state.revisions.length > 1 && <button onClick={() => onRestore(state.revisions.at(-2)!.revision)} aria-label={`Restore previous revision ${state.revisions.at(-2)!.revision}`}>Restore previous</button>}</footer></section></div>;
}

function CompareMetric({ label, before, after, good }: { label: string; before: string; after: string; good: boolean }) {
  return <div className="compare-row"><span>{label}</span><strong>{before}</strong><ArrowRight size={13} /><strong className={good ? 'good' : ''}>{after}</strong></div>;
}
