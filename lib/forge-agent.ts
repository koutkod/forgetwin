import { z } from 'zod';
import { SUPPORTED_METRIC_KEYS } from './forge-metrics';
import { normalizeEngineeringIntent } from './forge-intent';

const conciseText = z.string().trim().min(1).max(500);
const identifier = z.string().trim().regex(/^[a-z][a-z0-9-]{0,63}$/);
const channelKey = z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const supportedMetric = z.enum(SUPPORTED_METRIC_KEYS);
const capability = z.enum(['structure', 'transport', 'classify', 'lift', 'suspend', 'mobile', 'manipulate', 'transmit', 'stabilize', 'track', 'buffer', 'contain', 'rotate', 'measure']);
const primitiveKind = z.enum(['beam', 'plate', 'frame', 'wheel', 'shaft', 'gear', 'pulley', 'belt', 'motor', 'servo', 'piston', 'spring', 'sensor', 'camera', 'light', 'conveyor', 'ramp', 'gripper', 'container', 'counterweight', 'support', 'controller', 'cable', 'hook', 'roller', 'tube', 'bearing', 'linkage', 'seat', 'steering', 'pedal', 'battery', 'body-shell', 'aerofoil', 'fuselage', 'propeller', 'rotor', 'landing-gear', 'track']);
const bodyType = z.enum(['fixed', 'dynamic', 'kinematic']);
const materialId = z.enum(['steel', 'aluminum', 'copper', 'polymer', 'rubber', 'concrete', 'composite']);
const jointType = z.enum(['fixed', 'revolute', 'prismatic', 'spherical', 'spring', 'rope', 'gear', 'belt']);
const sensorType = z.enum(['distance', 'position', 'angle', 'speed', 'load', 'force', 'imu', 'camera', 'color', 'light', 'limit', 'presence']);
const actuatorType = z.enum(['rotary-motor', 'servo', 'linear', 'piston', 'winch']);
const controlMode = z.enum(['pid', 'threshold', 'state-machine', 'tracking', 'timed', 'synchronized']);
const connectionType = z.enum(['mechanical', 'power', 'signal']);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const jointLimits = z.union([z.tuple([z.number().finite(), z.number().finite()]), z.null()]);
const dimensions3 = z.tuple([
  z.number().finite().min(.02).max(30),
  z.number().finite().min(.02).max(30),
  z.number().finite().min(.02).max(30),
]);
const semanticTag = z.string().trim().regex(/^[a-z][a-z0-9-]{0,31}$/);

const planAssemblySchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(1).max(160),
  parent_id: z.string().trim().max(64),
}).strict();

const planComponentSchema = z.object({
  id: identifier,
  primitive: primitiveKind,
  assembly_id: identifier,
  role: z.string().trim().min(1).max(80),
  position: vec3,
  rotation: vec3,
  dimensions: dimensions3,
  material_id: materialId,
  body_type: bodyType,
  mass: z.number().finite().min(0).max(100000),
  color: z.string().trim().regex(/^(?:|#[0-9a-fA-F]{6})$/),
  semantic_tags: z.array(semanticTag).max(8),
}).strict();

const planConnectionSchema = z.object({ id: identifier, source_id: identifier, target_id: identifier, connection_type: connectionType, channel: channelKey }).strict();
const planJointSchema = z.object({
  id: identifier, joint_type: jointType, component_a: identifier, component_b: identifier, axis: vec3,
  limits: jointLimits,
  ratio: z.number().finite().min(0).max(1000), stiffness: z.number().finite().min(0).max(10000000), damping: z.number().finite().min(0).max(1000000),
}).strict();
const planMotorSchema = z.object({ id: identifier, component_id: identifier, joint_id: z.string().trim().max(64), max_torque: z.number().finite().positive().max(1000000), max_rpm: z.number().finite().positive().max(100000), direction: z.number().finite().min(-1).max(1) }).strict();
const planSensorSchema = z.object({ id: identifier, component_id: identifier, sensor_type: sensorType, channel: channelKey, target_id: z.string().trim().max(64), range: z.number().finite().positive().max(100) }).strict();
const planActuatorSchema = z.object({ id: identifier, component_id: identifier, joint_id: identifier, actuator_type: actuatorType, max_force: z.number().finite().positive().max(10000000), max_speed: z.number().finite().positive().max(10000), travel: z.number().finite().positive().max(100) }).strict();
const planControlSchema = z.object({ id: identifier, name: z.string().trim().min(1).max(80), mode: controlMode, sensor_ids: z.array(identifier).max(12), actuator_ids: z.array(identifier).max(12), expression: z.string().trim().min(1).max(180), setpoint: z.number().finite(), kp: z.number().finite().min(0).max(10), ki: z.number().finite().min(0).max(10), kd: z.number().finite().min(0).max(10) }).strict();
const planRequirementSchema = z.object({ metric: supportedMetric, label: z.string().trim().min(1).max(80), operator: z.enum(['min', 'max', 'exact']), target: z.number().finite().nonnegative(), unit: z.string().trim().max(12), source: z.enum(['user', 'inferred']) }).strict();

// The model plans a compact engineering intent instead of serializing the
// entire rigid-body graph. ForgeTwin's deterministic graph compiler expands
// this brief into guarded bodies, joints, drives, sensors, and controls. This
// keeps model latency low while making graph validity deterministic.
export const agentIntentSchema = z.object({
  normalized_prompt: z.string().trim().min(12).max(500),
  design_brief: z.string().trim().min(12).max(500),
  machine_name: z.string().trim().min(3).max(80),
  domain: z.string().trim().min(2).max(80),
  reasoning_summary: z.string().trim().min(12).max(500),
  architecture: z.array(z.string().trim().min(1).max(100)).min(1).max(8),
  assumptions: z.array(z.string().trim().min(1).max(180)).max(6),
  capabilities: z.array(capability).min(1).max(14),
  requirements: z.array(planRequirementSchema).min(1).max(8),
}).strict();

export const agentPlanSchema = z.object({
  normalized_prompt: z.string().trim().min(12).max(500),
  machine_name: z.string().trim().min(3).max(80),
  domain: z.string().trim().min(2).max(80),
  reasoning_summary: z.string().trim().min(12).max(700),
  architecture: z.array(z.string().trim().min(1).max(100)).min(1).max(12),
  assumptions: z.array(z.string().trim().min(1).max(180)).max(8),
  capabilities: z.array(capability).min(1).max(14),
  requirements: z.array(planRequirementSchema).min(1).max(8),
  assemblies: z.array(planAssemblySchema).min(1).max(8),
  components: z.array(planComponentSchema).min(2).max(40),
  connections: z.array(planConnectionSchema).max(80),
  joints: z.array(planJointSchema).max(60),
  motors: z.array(planMotorSchema).max(12),
  sensors: z.array(planSensorSchema).max(12),
  actuators: z.array(planActuatorSchema).max(12),
  controls: z.array(planControlSchema).max(8),
  editable_component_id: identifier,
}).strict();

export const redesignStepSchema = z.object({ tool: z.enum(['inspect_telemetry', 'inspect_failure', 'measure_constraint', 'optimize_design', 'run_simulation']), metric: z.union([supportedMetric, z.literal('')]), objective: z.string().trim().max(120) }).strict();
export const agentRedesignSchema = z.object({ diagnosis: z.string().trim().min(8).max(700), objective: z.string().trim().min(8).max(120), tool_sequence: z.array(redesignStepSchema).min(1).max(8) }).strict();

const editActionSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('create_assembly'), assembly_id: identifier, name: z.string().trim().min(1).max(80), purpose: z.string().trim().min(1).max(160), parent_id: z.string().trim().max(64) }).strict(),
  z.object({ tool: z.literal('set_dimensions'), component_id: identifier, dimensions: dimensions3 }).strict(),
  z.object({ tool: z.literal('set_material'), component_id: identifier, material_id: materialId }).strict(),
  z.object({ tool: z.literal('set_mass'), component_id: identifier, mass: z.number().finite().positive().max(100000) }).strict(),
  z.object({ tool: z.literal('move_component'), component_id: identifier, position: vec3 }).strict(),
  z.object({ tool: z.literal('rotate_component'), component_id: identifier, rotation: vec3 }).strict(),
  z.object({ tool: z.literal('create_component'), component_id: identifier, primitive: primitiveKind, assembly_id: identifier, role: z.string().trim().min(1).max(80), position: vec3, rotation: vec3, dimensions: dimensions3, material_id: materialId, body_type: bodyType, mass: z.number().finite().min(0).max(100000), color: z.string().trim().regex(/^(?:|#[0-9a-fA-F]{6})$/), semantic_tags: z.array(semanticTag).max(8) }).strict(),
  z.object({ tool: z.literal('remove_component'), component_id: identifier }).strict(),
  z.object({ tool: z.literal('connect_components'), connection_id: identifier, source_id: identifier, target_id: identifier, connection_type: connectionType, channel: channelKey }).strict(),
  z.object({ tool: z.literal('create_joint'), joint_id: identifier, joint_type: jointType, component_a: identifier, component_b: identifier, axis: vec3, limits: jointLimits, ratio: z.number().finite().min(0).max(1000), stiffness: z.number().finite().min(0).max(10000000), damping: z.number().finite().min(0).max(1000000) }).strict(),
  z.object({ tool: z.literal('remove_joint'), joint_id: identifier }).strict(),
  z.object({ tool: z.literal('add_motor'), motor_id: identifier, component_id: identifier, joint_id: z.string().trim().max(64), max_torque: z.number().finite().positive().max(1000000), max_rpm: z.number().finite().positive().max(100000), direction: z.number().finite().min(-1).max(1) }).strict(),
  z.object({ tool: z.literal('set_motor_speed'), motor_id: identifier, max_rpm: z.number().finite().positive().max(100000), direction: z.number().finite().min(-1).max(1) }).strict(),
  z.object({ tool: z.literal('add_sensor'), sensor_id: identifier, component_id: identifier, sensor_type: sensorType, channel: channelKey, target_id: z.string().trim().max(64), range: z.number().finite().positive().max(100) }).strict(),
  z.object({ tool: z.literal('set_sensor_range'), sensor_id: identifier, range: z.number().finite().positive().max(100) }).strict(),
  z.object({ tool: z.literal('add_actuator'), actuator_id: identifier, component_id: identifier, joint_id: identifier, actuator_type: actuatorType, max_force: z.number().finite().positive().max(10000000), max_speed: z.number().finite().positive().max(10000), travel: z.number().finite().positive().max(100) }).strict(),
  z.object({ tool: z.literal('set_actuator_timing'), actuator_id: identifier, max_speed: z.number().finite().positive().max(10000), travel: z.number().finite().positive().max(100) }).strict(),
  z.object({ tool: z.literal('set_control_logic'), control_id: identifier, name: z.string().trim().min(1).max(80), mode: controlMode, sensor_ids: z.array(identifier).max(12), actuator_ids: z.array(identifier).max(12), expression: z.string().trim().min(1).max(180), setpoint: z.number().finite(), kp: z.number().finite().min(0).max(10), ki: z.number().finite().min(0).max(10), kd: z.number().finite().min(0).max(10) }).strict(),
  z.object({ tool: z.literal('update_control_logic'), control_id: identifier, expression: z.string().trim().min(1).max(180), setpoint: z.number().finite(), kp: z.number().finite().min(0).max(10), ki: z.number().finite().min(0).max(10), kd: z.number().finite().min(0).max(10) }).strict(),
]);

export const agentEditActionSchema = editActionSchema;
export const agentEditSchema = z.object({
  understanding: z.string().trim().min(8).max(500),
  needs_clarification: z.boolean(),
  clarification_question: z.string().trim().max(240),
  target_ids: z.array(identifier).max(40),
  preserve_ids: z.array(identifier).max(40),
  requested_invariants: z.array(z.string().trim().min(1).max(140)).max(12),
  actions: z.array(editActionSchema).max(48),
  verification: z.array(z.string().trim().min(1).max(140)).max(8),
}).strict();

const agentStatusSchema = z.object({ ok: z.literal(true), configured: z.boolean(), model: z.string().min(1).max(100) }).strict();
const agentConnectionSchema = z.object({ ok: z.literal(true), configured: z.literal(true), model: z.string().min(1).max(100) }).strict();
const agentPlanResponseSchema = z.object({ ok: z.literal(true), mode: z.literal('model'), model: z.string().min(1).max(100), result: agentPlanSchema }).strict();
const agentRedesignResponseSchema = z.object({ ok: z.literal(true), mode: z.literal('model'), model: z.string().min(1).max(100), result: agentRedesignSchema }).strict();
const agentEditResponseSchema = z.object({ ok: z.literal(true), mode: z.literal('model'), model: z.string().min(1).max(100), result: agentEditSchema }).strict();

export type AgentPlan = z.infer<typeof agentPlanSchema>;
export type AgentIntent = z.infer<typeof agentIntentSchema>;
export type AgentRedesign = z.infer<typeof agentRedesignSchema>;
export type AgentEdit = z.infer<typeof agentEditSchema>;
export type AgentEditAction = z.infer<typeof agentEditActionSchema>;
export type AgentRuntimeMode = 'server-model' | 'session-model' | 'deterministic';

export function normalizeRedesignSequence(decision: AgentRedesign) {
  const evidence = decision.tool_sequence.filter((step) => step.tool !== 'optimize_design' && step.tool !== 'run_simulation').slice(0, 6);
  const selectedOptimization = decision.tool_sequence.find((step) => step.tool === 'optimize_design');
  const optimization = selectedOptimization ? { ...selectedOptimization, objective: selectedOptimization.objective || decision.objective } : { tool: 'optimize_design' as const, metric: '' as const, objective: decision.objective };
  return [...evidence, optimization, { tool: 'run_simulation' as const, metric: '' as const, objective: '' }];
}

export interface AgentTraceItem { id: string; kind: 'goal' | 'reasoning' | 'action' | 'observation' | 'complete' | 'fallback' | 'error'; title: string; detail: string; at: string }
export interface RedesignContext { run_id: string; machine_name: string; summary: string; evidence: string; failed_metrics: Array<{ metric: string; label: string; value: number; target: number; unit: string; operator: 'min' | 'max' | 'exact' }>; human_locks: Array<{ component_id: string; fields: string[] }> }
export interface EditContext {
  revision: number; design_hash: string; machine_name: string; goal: string; max_components: number; selected_component_id: string;
  world: { gravity: [number, number, number]; bounds: [number, number, number]; environment: string };
  goal_constraints: Array<{ metric: string; label: string; operator: 'min' | 'max' | 'exact'; target: number; unit: string }>;
  assemblies: Array<{ id: string; name: string; purpose: string; parent_id: string }>;
  components: Array<{ id: string; role: string; primitive: string; assembly_id: string; position: [number, number, number]; rotation: [number, number, number]; dimensions: [number, number, number]; material_id: string; body_type: string; mass: number; color: string; parameters: Record<string, string | number | boolean>; human_locked_fields: string[] }>;
  connections: Array<{ id: string; source_id: string; target_id: string; connection_type: string; channel: string }>;
  joints: Array<{ id: string; joint_type: string; component_a: string; component_b: string; axis: [number, number, number]; limits: [number, number] | null; ratio: number | null; stiffness: number | null; damping: number | null }>;
  motors: Array<{ id: string; component_id: string; joint_id: string; max_torque: number; max_rpm: number; direction: number }>;
  sensors: Array<{ id: string; component_id: string; sensor_type: string; channel: string; target_id: string; range: number }>;
  actuators: Array<{ id: string; component_id: string; joint_id: string; actuator_type: string; max_force: number; max_speed: number; travel: number }>;
  controls: Array<{ id: string; name: string; mode: string; sensor_ids: string[]; actuator_ids: string[]; expression: string; setpoint: number; kp: number; ki: number; kd: number }>;
  latest_run: { status: string; score: number; failed_metrics: string[] } | null;
  conversation: Array<{ role: 'user' | 'agent'; text: string }>;
}

export class AgentRequestError extends Error { constructor(public readonly code: string, message: string, public readonly status: number) { super(message); this.name = 'AgentRequestError'; } }
async function readJson(response: Response) { const payload = await response.json().catch(() => null) as { ok?: unknown; code?: unknown; error?: unknown } | null; if (!response.ok || payload?.ok === false) { const code = typeof payload?.code === 'string' ? payload.code : 'AGENT_REQUEST_FAILED'; const message = typeof payload?.error === 'string' ? payload.error : 'The model agent could not complete this request.'; throw new AgentRequestError(code, message, response.status); } return payload; }
function agentHeaders(apiKey?: string) { const headers: Record<string, string> = { 'content-type': 'application/json' }; if (apiKey?.trim()) headers['x-forgetwin-openai-key'] = apiKey.trim(); return headers; }
export async function getAgentStatus(signal?: AbortSignal) { const response = await fetch('/api/agent', { method: 'GET', cache: 'no-store', signal }); return agentStatusSchema.parse(await readJson(response)); }
export async function validateAgentKey(apiKey: string, signal?: AbortSignal) { const response = await fetch('/api/agent', { method: 'PUT', redirect: 'error', cache: 'no-store', headers: agentHeaders(apiKey), signal }); return agentConnectionSchema.parse(await readJson(response)); }
export async function requestAgentPlan(prompt: string, apiKey?: string, signal?: AbortSignal) { const response = await fetch('/api/agent', { method: 'POST', redirect: 'error', headers: agentHeaders(apiKey), body: JSON.stringify({ task: 'plan', prompt: conciseText.parse(prompt) }), signal }); return agentPlanResponseSchema.parse(await readJson(response)); }
export async function requestAgentRedesign(prompt: string, context: RedesignContext, apiKey?: string, signal?: AbortSignal) { const response = await fetch('/api/agent', { method: 'POST', redirect: 'error', headers: agentHeaders(apiKey), body: JSON.stringify({ task: 'redesign', prompt: conciseText.parse(prompt), context }), signal }); return agentRedesignResponseSchema.parse(await readJson(response)); }
export async function requestAgentEdit(prompt: string, context: EditContext, apiKey?: string, signal?: AbortSignal) { const response = await fetch('/api/agent', { method: 'POST', redirect: 'error', headers: agentHeaders(apiKey), body: JSON.stringify({ task: 'edit', prompt: z.string().trim().min(3).max(300).parse(prompt), context }), signal }); return agentEditResponseSchema.parse(await readJson(response)); }

function unique(values: string[], label: string) { if (new Set(values).size !== values.length) throw new Error(`${label} IDs must be unique.`); }
function assertReference(ids: Set<string>, value: string, label: string, allowEmpty = false) { if (allowEmpty && !value) return; if (!ids.has(value)) throw new Error(`${label} references missing ID “${value}”.`); }

const identityChecks: Array<{ requested: RegExp; designed: RegExp }> = [
  { requested: /\b(?:bracket|mounting bracket)\b/, designed: /\bbracket\b/ },
  { requested: /\b(?:housing|enclosure|casing)\b/, designed: /\b(?:housing|enclosure|casing)\b/ },
  { requested: /(?:^|\s)(?:(?:ball|roller|thrust|plain|sleeve|wheel|shaft)\s+)?bearing(?:\s+(?:block|assembly|housing|unit))?\b/, designed: /\bbearing\b/ },
  { requested: /\b(?:duct|air duct)\b/, designed: /\bduct\b/ },
  { requested: /\b(?:hvac|heat exchanger|braz(?:e|ing|ed))\b[^.]{0,80}\b(?:fixture|jig)\b|\b(?:fixture|jig)\b[^.]{0,80}\b(?:hvac|heat exchanger|braz(?:e|ing|ed))\b/, designed: /\b(?:hvac|heat exchanger|braz(?:e|ing|ed)|pipe alignment)\b[^.]{0,80}\b(?:fixture|jig)\b|\b(?:fixture|jig)\b[^.]{0,80}\b(?:hvac|heat exchanger|braz(?:e|ing|ed)|pipe alignment)\b/ },
  { requested: /\b(?:brazed plate|plate heat exchanger|heat exchanger|bphe)\b/, designed: /\b(?:heat exchanger|brazed plate|transfer plate|bphe)\b/ },
  { requested: /\b(?:fixture|jig)\b/, designed: /\b(?:fixture|jig)\b/ },
  { requested: /\b(?:bench vise|vise)\b/, designed: /\bvise\b/ },
  { requested: /\b(?:bicycle|bike)\s+(?:suspension\s+)?fork\b/, designed: /\b(?:bicycle|bike|suspension)\s+fork\b|\bfork\b/ },
  { requested: /\bscissor(?:[- ]type)?\s+lift\b/, designed: /\bscissor(?:[- ]type)?\s+lift\b/ },
  { requested: /\b(?:car jack|patient lift|lift|elevator|hoist)\b/, designed: /\b(?:jack|lift|elevator|hoist)\b/ },
  { requested: /\b(?:four[- ]bar|toggle|crank[- ]rocker|parallel)\s+linkage\b|\blinkage\s+mechanism\b|^(?:please\s+)?(?:build|design|create|engineer|make)\s+(?:an?|the)?\s*linkage\b/, designed: /\b(?:four[- ]bar|toggle|crank[- ]rocker|parallel)\s+linkage\b|\blinkage(?:\s+mechanism)?\b/ },
  { requested: /\b(?:(?:hydraulic|pneumatic|mechanical|arbor|shop)\s+press|press\s+(?:machine|mechanism))\b|^(?:please\s+)?(?:build|design|create|engineer|make)\s+(?:an?|the)?\s*press\b/, designed: /\b(?:(?:hydraulic|pneumatic|mechanical|arbor|shop)\s+press|press(?:\s+(?:machine|mechanism))?)\b/ },
  { requested: /\b(?:electric|manual|powered|cable|drum)?\s*winch\b/, designed: /\bwinch\b/ },
  { requested: /\b(?:crane)\b/, designed: /\b(?:crane|boom|hoist)\b/ },
  { requested: /\b(?:go-kart|gokart|go cart|kart)\b/, designed: /\b(?:go-kart|gokart|kart)\b/ },
  { requested: /\b(?:bicycle|bike)\b/, designed: /\b(?:bicycle|bike)\b/ },
  { requested: /\b(?:motorcycle|motorbike|dirt bike|scooter)\b/, designed: /\b(?:motorcycle|motorbike|scooter)\b/ },
  { requested: /\b(?:airplane|aeroplane|fixed[- ]wing aircraft)\b/, designed: /\b(?:airplane|aircraft|fixed[- ]wing|fuselage)\b/ },
  { requested: /\b(?:helicopter|rotorcraft)\b/, designed: /\b(?:helicopter|rotorcraft|main rotor)\b/ },
  { requested: /\b(?:humanoid|service|walking|quadruped|tracked)\s+robot\b/, designed: /\b(?:humanoid|service|walking|quadruped|tracked|articulated)\s+robot\b/ },
  { requested: /\b(?:rover|agv)\b/, designed: /\b(?:rover|agv|mobile robot)\b/ },
  { requested: /\b(?:car|automobile|buggy|vehicle)\b/, designed: /\b(?:car|automobile|buggy|vehicle)\b/ },
  { requested: /\b(?:gearbox|gear train|transmission)\b/, designed: /\b(?:gearbox|gear train|transmission|gear mesh)\b/ },
  { requested: /\b(?:robotic arm|robot arm|manipulator)\b/, designed: /\b(?:robotic arm|robot arm|manipulator|serial link)\b/ },
  { requested: /\b(?:suspension)\b/, designed: /\b(?:suspension|spring|damper|control arm)\b/ },
  { requested: /\b(?:solar tracker|track(?:ing)? (?:the )?sun)\b/, designed: /\b(?:solar tracker|tracking axis|tracked panel)\b/ },
  { requested: /\b(?:drawbridge)\b/, designed: /\b(?:drawbridge|folding span|hinged span)\b/ },
  { requested: /\b(?:bridge|truss)\b/, designed: /\b(?:bridge|truss|structural span)\b/ },
  { requested: /\b(?:centrifugal pump|reciprocating pump|piston pump|pump)\b/, designed: /\b(?:pump|impeller|plunger)\b/ },
  { requested: /\b(?:wind turbine|turbine)\b/, designed: /\b(?:wind turbine|turbine|rotor|blade)\b/ },
  { requested: /\b(?:recycling|material separator)\b/, designed: /\b(?:recycling|material separator|trommel|recovery)\b/ },
  { requested: /\b(?:tomato grader|tomato sorter|tomatoes)\b/, designed: /\b(?:tomato|grader|grading)\b/ },
  { requested: /\b(?:warehouse buffer|factory buffer|buffer system)\b/, designed: /\b(?:buffer|accumulation|queue)\b/ },
  { requested: /\b(?:conveyor|package sorter|box sorter|sorting system)\b/, designed: /\b(?:conveyor|sorter|sorting|diverter)\b/ },
];

function validatePhysicalSignature(plan: AgentPlan, requested: string) {
  const count = (primitive: string) => plan.components.filter((item) => item.primitive === primitive).length;
  const roles = plan.components.map((item) => `${item.role} ${item.semantic_tags.join(' ')}`).join(' ').toLowerCase();
  const requireSignature = (condition: boolean, description: string) => { if (!condition) throw new Error(`The design graph lacks the physical signature of the requested object: ${description}.`); };
  const componentById = new Map(plan.components.map((item) => [item.id, item]));
  const drivenJointIds = new Set([
    ...plan.motors.map((item) => item.joint_id).filter(Boolean),
    ...plan.actuators.map((item) => item.joint_id),
  ]);
  const motionJoints = plan.joints.filter((item) => item.joint_type !== 'fixed');
  const componentText = (id: string) => {
    const component = componentById.get(id);
    return component ? `${component.role} ${component.semantic_tags.join(' ')}`.toLowerCase() : '';
  };
  const jointTouches = (joint: AgentPlan['joints'][number], predicate: (component: AgentPlan['components'][number], text: string) => boolean) => [joint.component_a, joint.component_b]
    .some((id) => { const component = componentById.get(id); return component ? predicate(component, componentText(id)) : false; });
  const relevantDrivenJoints = (predicate: (component: AgentPlan['components'][number], text: string) => boolean) => motionJoints
    .filter((joint) => drivenJointIds.has(joint.id) && jointTouches(joint, predicate));
  const pathHasMotionCount = (start: (component: AgentPlan['components'][number]) => boolean, end: (component: AgentPlan['components'][number]) => boolean, minimum: number) => {
    const adjacency = new Map(plan.components.map((component) => [component.id, [] as Array<{ id: string; moving: boolean }>]));
    for (const joint of plan.joints) {
      const moving = joint.joint_type !== 'fixed';
      adjacency.get(joint.component_a)?.push({ id: joint.component_b, moving });
      adjacency.get(joint.component_b)?.push({ id: joint.component_a, moving });
    }
    const queue = plan.components.filter(start).map((component) => ({ id: component.id, motions: 0 }));
    const visited = new Set(queue.map((item) => `${item.id}:0`));
    while (queue.length) {
      const current = queue.shift()!;
      const body = componentById.get(current.id);
      if (body && end(body) && current.motions >= minimum) return true;
      for (const edge of adjacency.get(current.id) ?? []) {
        const motions = Math.min(minimum, current.motions + (edge.moving ? 1 : 0));
        const state = `${edge.id}:${motions}`;
        if (!visited.has(state)) { visited.add(state); queue.push({ id: edge.id, motions }); }
      }
    }
    return false;
  };
  const hasJointPath = (starts: Set<string>, ends: Set<string>, allowed: Set<string>) => {
    const adjacency = new Map([...allowed].map((id) => [id, new Set<string>()]));
    for (const joint of plan.joints) {
      if (!allowed.has(joint.component_a) || !allowed.has(joint.component_b)) continue;
      adjacency.get(joint.component_a)!.add(joint.component_b); adjacency.get(joint.component_b)!.add(joint.component_a);
    }
    const visited = new Set([...starts].filter((id) => allowed.has(id))); const queue = [...visited];
    while (queue.length) {
      const current = queue.shift()!; if (ends.has(current) && !starts.has(current)) return true;
      for (const neighbor of adjacency.get(current) ?? []) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
    }
    return false;
  };

  const bicycleFork = /\b(?:bicycle|bike)\s+(?:suspension\s+)?fork\b/.test(requested);
  const vehicleSuspension = /\b(?:car|automotive|vehicle|rover)\s+suspension\b|\bsuspension\b[^.]{0,28}\b(?:for|of)\s+(?:an?\s+)?(?:car|vehicle|rover)\b/.test(requested);
  const vehicleChassis = /\b(?:car|automotive|vehicle|rover|go-kart|gokart|kart)\s+(?:chassis|frame)\b/.test(requested);
  const vehicleWheel = /\b(?:car|automotive|vehicle|rover|go-kart|gokart|kart)\s+(?:road\s+)?wheel\b/.test(requested);
  const vehicleAxle = /\b(?:car|automotive|vehicle|rover|go-kart|gokart|kart)\s+(?:drive\s+)?axle\b/.test(requested);
  const cranePart = requested.match(/\bcrane\s+(hook|boom|jib|pulley|counterweight)\b/)?.[1];
  const pumpHousing = /\b(?:centrifugal\s+|reciprocating\s+|piston\s+)?pump\s+(?:housing|casing|enclosure)\b/.test(requested);
  const transmissionHousing = /\b(?:gearbox|transmission)\s+(?:housing|casing|enclosure)\b/.test(requested);
  const scissorLift = /\bscissor(?:[- ]type)?\s+lift\b/.test(requested);
  const fourBarLinkage = /\bfour[- ]bar\s+linkage\b/.test(requested);
  const linkage = fourBarLinkage || /\b(?:toggle|crank[- ]rocker|parallel)\s+linkage\b|\blinkage\s+mechanism\b|^(?:please\s+)?(?:build|design|create|engineer|make)\s+(?:an?|the)?\s*linkage\b/.test(requested);
  const press = /\b(?:(?:hydraulic|pneumatic|mechanical|arbor|shop)\s+press|press\s+(?:machine|mechanism))\b|^(?:please\s+)?(?:build|design|create|engineer|make)\s+(?:an?|the)?\s*press\b/.test(requested);
  const winch = /\b(?:electric|manual|powered|cable|drum)?\s*winch\b/.test(requested);
  const hvacFixture = /\b(?:hvac|heat exchanger|braz(?:e|ing|ed))\b[^.]{0,80}\b(?:fixture|jig)\b|\b(?:fixture|jig)\b[^.]{0,80}\b(?:hvac|heat exchanger|braz(?:e|ing|ed))\b/.test(requested);
  const parentPartMatch = requested.match(/\b(?:pump|gearbox|transmission|conveyor|robotic arm|robot arm|car|automotive|vehicle|bicycle|bike)\s+(?:mounting\s+)?(bracket|housing|casing|enclosure|bearing|shaft|impeller|seal|cover|flange|manifold|gear|coupling|roller|belt|gripper|joint|pedal|disc|caliper|rack)\b/);
  const parentPart = parentPartMatch && !(['roller', 'belt'].includes(parentPartMatch[1]) && /\bconveyor\s+(?:roller|belt)\s+(?:system|line|bed|machine)\b/.test(requested)) ? parentPartMatch[1] : undefined;

  // A named part of a familiar machine is still a part-level request. Validate
  // its own geometry, then stop before the parent-machine signatures below can
  // demand an entire pump, conveyor, vehicle, or robotic arm.
  if (parentPart) {
    if (parentPart === 'bracket') requireSignature(count('plate') + count('frame') + count('support') >= 1 && /bracket/.test(roles), 'a recognizable mounting bracket body');
    else if (['housing', 'casing', 'enclosure', 'cover', 'manifold'].includes(parentPart)) requireSignature(count('plate') + count('frame') + count('support') >= 1 && new RegExp(`${parentPart}|housing|casing|enclosure|shell`).test(roles), `a recognizable ${parentPart} body`);
    else if (parentPart === 'bearing') requireSignature(/bearing/.test(roles), 'a recognizable bearing body');
    else if (parentPart === 'shaft') requireSignature(count('shaft') >= 1, 'a shaft body');
    else if (parentPart === 'impeller') requireSignature((count('gear') + count('plate') + count('shaft') >= 1) && /impeller/.test(roles), 'a vaned impeller body');
    else if (parentPart === 'seal') requireSignature(/seal/.test(roles), 'a recognizable sealing body');
    else if (parentPart === 'flange') requireSignature(/flange/.test(roles), 'a recognizable flange body');
    else if (parentPart === 'gear') requireSignature(count('gear') >= 1, 'a gear body');
    else if (parentPart === 'coupling') requireSignature((count('shaft') + count('gear') + count('frame') >= 1) && /coupling/.test(roles), 'a recognizable shaft coupling');
    else if (parentPart === 'roller') requireSignature(count('roller') >= 1, 'a conveyor roller body');
    else if (parentPart === 'belt') requireSignature(count('belt') >= 1, 'a conveyor belt body');
    else if (parentPart === 'gripper') requireSignature(count('gripper') >= 1, 'a robotic gripper body');
    else if (parentPart === 'joint') requireSignature(plan.joints.some((joint) => joint.joint_type !== 'fixed'), 'a motion-capable robotic joint');
    else if (parentPart === 'pedal') requireSignature(count('plate') + count('beam') >= 1 && /pedal/.test(roles), 'a recognizable vehicle pedal');
    else if (parentPart === 'disc') requireSignature(count('gear') + count('plate') >= 1 && /disc|rotor/.test(roles), 'a recognizable brake disc');
    else if (parentPart === 'caliper') requireSignature(count('gripper') + count('piston') + count('frame') >= 1 && /caliper/.test(roles), 'a recognizable brake caliper');
    else if (parentPart === 'rack') requireSignature(count('shaft') + count('gear') >= 1 && /rack/.test(roles), 'a recognizable steering rack');
    return;
  }

  if (cranePart === 'hook') requireSignature(count('hook') >= 1, 'a recognizable load hook');
  if (cranePart === 'boom' || cranePart === 'jib') requireSignature(count('beam') + count('frame') >= 1 && /boom|jib/.test(roles), 'a structural crane boom or jib');
  if (cranePart === 'pulley') requireSignature(count('pulley') >= 1, 'a grooved crane pulley');
  if (cranePart === 'counterweight') requireSignature(count('counterweight') >= 1, 'a crane counterweight body');
  if (pumpHousing || transmissionHousing) requireSignature(count('plate') + count('frame') + count('support') >= 1 && /housing|casing|enclosure|shell/.test(roles), 'a dimensioned housing or casing body');
  if (vehicleChassis) requireSignature(count('frame') + count('beam') + count('tube') + count('plate') >= 2 && /chassis|frame|rail/.test(roles), 'a load-bearing chassis frame');
  if (vehicleWheel) requireSignature(count('wheel') >= 1, 'a road wheel and hub body');
  if (vehicleAxle) requireSignature(count('shaft') >= 1, 'a supported axle shaft');
  if (bicycleFork) requireSignature(count('beam') + count('tube') + count('frame') >= 2 && /fork|stanchion|steerer/.test(roles), 'paired fork members and a steerer or crown');
  if (vehicleSuspension) requireSignature(count('spring') >= 1 && count('beam') + count('frame') + count('wheel') >= 1, 'a compliant suspension member connected to an arm, frame, or wheel');

  if (/\bcrane\b/.test(requested) && !cranePart) {
    requireSignature(count('beam') + count('frame') + count('support') >= 2, 'a supported mast or boom structure');
    requireSignature(count('hook') + count('cable') + count('pulley') >= 1, 'a hook, cable, or pulley load path');
    requireSignature(relevantDrivenJoints((component, text) => ['hook', 'cable', 'pulley'].includes(component.primitive) || /boom|jib|hoist|winch|cable|pulley|hook/.test(text)).length >= 1, 'a drive coupled to the hoist, boom, or lifting path');
  }
  if (/\b(?:bench vise|vise)\b/.test(requested)) {
    requireSignature(count('plate') + count('beam') + count('support') >= 2 && (count('shaft') + count('piston') + count('servo') >= 1), 'opposed jaws and a screw or linear clamp drive');
  }
  if (/\b(?:go-kart|gokart|go cart|kart|car|automobile|buggy|rover|agv|vehicle)\b/.test(requested) && !/\bcar\s+(?:jack|lift|hoist)\b/.test(requested) && !vehicleSuspension && !vehicleChassis && !vehicleWheel && !vehicleAxle) {
    requireSignature(count('wheel') >= 3, 'a multi-wheel rolling chassis');
    requireSignature(count('frame') + count('plate') + count('beam') + count('tube') >= 1, 'a load-bearing chassis');
    requireSignature(relevantDrivenJoints((component, text) => (component.primitive === 'wheel' && /road wheel|drive wheel|driven wheel|front[^.]{0,24}wheel|rear[^.]{0,24}wheel|traction|wheel hub/.test(text))
      || (component.primitive === 'shaft' && /drive axle|powered axle|axle shaft|traction/.test(text))).length >= 1, 'a drive coupled to a road wheel or axle');
  }
  if (/\b(?:bicycle|bike)\b/.test(requested) && !bicycleFork) {
    requireSignature(count('wheel') >= 2 && count('beam') + count('tube') + count('frame') >= 2, 'two wheels and a recognizable frame');
    const rollingWheelIds = new Set(motionJoints.filter((joint) => joint.joint_type === 'revolute' && jointTouches(joint, (component) => component.primitive === 'wheel'))
      .flatMap((joint) => [joint.component_a, joint.component_b]).filter((id) => componentById.get(id)?.primitive === 'wheel'));
    requireSignature(rollingWheelIds.size >= 2, 'two independently mounted rolling wheels');
    const manualCrank = motionJoints.some((joint) => jointTouches(joint, (_component, text) => /pedal|crank/.test(text)));
    const manualTransmission = plan.connections.some((edge) => ['mechanical', 'power'].includes(edge.connection_type)
      && [edge.source_id, edge.target_id].some((id) => /chain|sprocket|crank|pedal/.test(componentText(id))));
    requireSignature(relevantDrivenJoints((component, text) => component.primitive === 'wheel' || /crank|chain|sprocket/.test(text)).length >= 1 || (manualCrank && manualTransmission), 'a crank, chain, or wheel drive coupled to the bicycle drivetrain');
  }
  if (/\b(?:gearbox|gear train|transmission)\b/.test(requested) && !transmissionHousing) {
    const gearMesh = plan.joints.some((joint) => joint.joint_type === 'gear'
      && componentById.get(joint.component_a)?.primitive === 'gear' && componentById.get(joint.component_b)?.primitive === 'gear');
    requireSignature(count('gear') >= 2 && count('shaft') >= 2 && gearMesh, 'at least two meshing gears on distinct input and output shafts');
    requireSignature(relevantDrivenJoints((component) => component.primitive === 'gear' || component.primitive === 'shaft').length >= 1, 'a driven input shaft coupled into the gear train');
  }
  if (/\b(?:robotic arm|robot arm|manipulator)\b/.test(requested)) {
    requireSignature(count('beam') + count('linkage') >= 2 && count('gripper') >= 1, 'an articulated link chain and end effector');
    const armDrivenJoints = new Set(relevantDrivenJoints((component, text) => ['beam', 'gripper', 'servo', 'motor'].includes(component.primitive) || /arm|joint|link|gripper|wrist/.test(text)).map((joint) => joint.id));
    requireSignature(armDrivenJoints.size >= 2, 'multiple independently actuated arm joints');
    requireSignature(pathHasMotionCount((component) => component.body_type === 'fixed', (component) => component.primitive === 'gripper', 2), 'a connected base-to-gripper chain with at least two articulated degrees of freedom');
  }
  if (/\b(?:motorcycle|motorbike|dirt bike|scooter)\b/.test(requested)) {
    requireSignature(count('wheel') >= 2 && count('tube') + count('frame') + count('beam') >= 3, 'two wheels on a recognizable tubular motorcycle frame');
    requireSignature(count('seat') >= 1 && count('steering') >= 1, 'a rider saddle and handlebar steering control');
    requireSignature(relevantDrivenJoints((component, text) => component.primitive === 'wheel' || /chain|drive wheel|traction/.test(text)).length >= 1, 'a power unit coupled to the rear wheel');
  }
  if (/\b(?:airplane|aeroplane|fixed[- ]wing aircraft)\b/.test(requested)) {
    requireSignature(count('fuselage') >= 1 && count('aerofoil') >= 2, 'a fuselage with main wing and stabilizing tail surfaces');
    requireSignature(count('propeller') + count('rotor') >= 1 && count('landing-gear') >= 2, 'a powered propulsor and supported landing gear');
    requireSignature(relevantDrivenJoints((component) => component.primitive === 'propeller' || component.primitive === 'rotor').length >= 1, 'a motor coupled to the aircraft propeller');
  }
  if (/\b(?:helicopter|rotorcraft)\b/.test(requested)) {
    requireSignature(count('fuselage') >= 1 && count('rotor') >= 1 && count('propeller') >= 1, 'a cabin, main lift rotor, and anti-torque tail rotor');
    requireSignature(count('tube') >= 3 && /tail boom|landing skid/.test(roles), 'a supported tail boom and grounded landing skids');
    requireSignature(relevantDrivenJoints((component) => component.primitive === 'rotor' || component.primitive === 'propeller').length >= 2, 'separately driven main and tail rotors');
  }
  if (/\b(?:humanoid|service|walking|quadruped|tracked)\s+robot\b/.test(requested)) {
    requireSignature(count('linkage') >= 4 && count('servo') >= 2, 'multiple articulated limb links with powered joints');
    requireSignature(count('camera') + count('sensor') >= 1 && count('controller') >= 1, 'perception and motion control hardware');
  }
  if (scissorLift) {
    const scissorArmIds = new Set(plan.components.filter((component) => ['beam', 'frame'].includes(component.primitive) && /scissor|cross|lift arm/.test(componentText(component.id))).map((component) => component.id));
    const platformIds = new Set(plan.components.filter((component) => /platform|deck|table/.test(componentText(component.id))).map((component) => component.id));
    const crossedArms = scissorArmIds.size;
    const armPivots = motionJoints.filter((joint) => joint.joint_type === 'revolute' && jointTouches(joint, (component, text) => ['beam', 'frame'].includes(component.primitive) && /scissor|cross|lift arm/.test(text))).length;
    requireSignature(crossedArms >= 4 && /platform|deck|table/.test(roles), 'crossed scissor arms supporting a lift platform');
    requireSignature(armPivots >= 3 && relevantDrivenJoints((component, text) => /scissor|lift arm|platform|piston|cylinder/.test(text) || component.primitive === 'piston').length >= 1, 'a pinned scissor linkage with a coupled lift actuator');
    requireSignature(platformIds.size >= 1 && hasJointPath(scissorArmIds, platformIds, new Set([...scissorArmIds, ...platformIds])), 'a lift platform mechanically carried by the scissor-arm linkage');
  }
  if (linkage) {
    const linkCount = plan.components.filter((component) => ['beam', 'shaft', 'plate'].includes(component.primitive) && /link|crank|rocker|coupler/.test(componentText(component.id))).length;
    const linkagePivots = motionJoints.filter((joint) => joint.joint_type === 'revolute' && jointTouches(joint, (_component, text) => /link|crank|rocker|coupler/.test(text))).length;
    requireSignature(linkCount >= (fourBarLinkage ? 3 : 2) && linkagePivots >= (fourBarLinkage ? 4 : 2), fourBarLinkage ? 'a ground link plus crank, coupler, and rocker joined by four pivots' : 'multiple links joined by revolute pivots');
  }
  if (press) {
    const pressSlides = motionJoints.filter((joint) => joint.joint_type === 'prismatic' && jointTouches(joint, (component, text) => component.primitive === 'piston' || /ram|platen|press slide/.test(text)));
    requireSignature(count('support') + count('frame') + count('beam') >= 2 && /bed|table|anvil|bolster/.test(roles), 'a rigid press frame with a work table or anvil');
    requireSignature(pressSlides.length >= 1 && pressSlides.some((joint) => drivenJointIds.has(joint.id)), 'a driven ram or platen constrained by a prismatic guide');
  }
  if (winch) {
    const drumJoints = motionJoints.filter((joint) => joint.joint_type === 'revolute' && jointTouches(joint, (component, text) => ['shaft', 'pulley', 'roller'].includes(component.primitive) || /drum|spool|winch/.test(text)));
    requireSignature(count('cable') >= 1 && count('shaft') + count('pulley') + count('roller') >= 1 && /drum|spool|winch/.test(roles), 'a cable wound on a supported drum or spool');
    requireSignature(drumJoints.some((joint) => drivenJointIds.has(joint.id)), 'a motor or actuator coupled to the winch drum joint');
  }
  if (/\bsuspension\b/.test(requested) && !bicycleFork && !vehicleSuspension) requireSignature(count('spring') >= 1 && count('beam') + count('frame') + count('wheel') >= 1, 'a compliant member connected into a supported mechanism');
  if (/\b(?:solar tracker|track(?:ing)? (?:the )?sun)\b/.test(requested)) {
    requireSignature(count('plate') + count('frame') >= 1 && /solar|panel|array/.test(roles), 'a framed solar panel or array');
    requireSignature(relevantDrivenJoints((component, text) => /solar|panel|array|tracker|tracking axis|slew|tilt/.test(text)).length >= 1 && count('sensor') + count('camera') >= 1, 'a panel-coupled tracking drive and light feedback');
  }
  if (/\bdrawbridge\b/.test(requested)) {
    requireSignature(count('beam') + count('plate') >= 2 && plan.joints.some((item) => item.joint_type === 'revolute'), 'a hinged structural span');
    requireSignature(count('counterweight') + count('pulley') + count('cable') >= 1 && relevantDrivenJoints((component, text) => ['counterweight', 'pulley', 'cable'].includes(component.primitive) || /bridge span|drawbridge|hinged span|winch/.test(text)).length >= 1, 'a counterbalanced or cable drive coupled to the bridge span');
  } else if (/\b(?:bridge|truss)\b/.test(requested)) {
    const bridgeSupportIds = new Set(plan.components.filter((component) => component.primitive === 'support' || /abutment|pier|bridge support/.test(componentText(component.id))).map((component) => component.id));
    const bridgeSpanIds = new Set(plan.components.filter((component) => ['beam', 'plate', 'frame'].includes(component.primitive) && /deck|span|truss|girder|chord/.test(componentText(component.id))).map((component) => component.id));
    const supports = [...bridgeSupportIds]; const bridgeGraph = new Set([...bridgeSupportIds, ...bridgeSpanIds]);
    const spansBetweenSupports = supports.some((left, index) => supports.slice(index + 1).some((right) => hasJointPath(new Set([left]), new Set([right]), bridgeGraph)));
    requireSignature(count('beam') + count('plate') >= 3 && bridgeSupportIds.size >= 2 && bridgeSpanIds.size >= 1 && spansBetweenSupports, 'a structural deck or truss physically spanning between two grounded supports');
  }
  if (/\b(?:centrifugal pump|reciprocating pump|piston pump|pump)\b/.test(requested) && !pumpHousing) {
    const centrifugal = /\bcentrifugal\s+pump\b/.test(requested) || /impeller|volute/.test(roles);
    const reciprocating = /\b(?:reciprocating|piston)\s+pump\b/.test(requested) || /plunger|pump piston/.test(roles);
    const pumpDrive = relevantDrivenJoints((component, text) => component.primitive === 'piston' || component.primitive === 'shaft' || /impeller|pump rotor|plunger|pump piston/.test(text));
    const hasPumpBody = count('frame') + count('plate') + count('container') + count('support') >= 1 && /housing|casing|volute|chamber|pump body/.test(roles);
    const inletIds = new Set(plan.components.filter((component) => /\b(?:inlet|intake|suction)\b/.test(componentText(component.id))).map((component) => component.id));
    const outletIds = new Set(plan.components.filter((component) => /\b(?:outlet|discharge)\b/.test(componentText(component.id))).map((component) => component.id));
    const hasSeparatePorts = [...inletIds].some((inletId) => [...outletIds].some((outletId) => outletId !== inletId));
    const pumpingElement = centrifugal
      ? count('shaft') >= 1 && /impeller|pump rotor/.test(roles)
      : reciprocating
        ? count('piston') >= 1 && motionJoints.some((joint) => joint.joint_type === 'prismatic' && jointTouches(joint, (component, text) => component.primitive === 'piston' || /plunger|pump piston/.test(text)))
        : count('piston') + count('shaft') >= 1 && /impeller|pump rotor|plunger|pump piston/.test(roles);
    requireSignature(hasPumpBody && hasSeparatePorts && pumpingElement && pumpDrive.length >= 1, 'a housed pumping chamber with separate inlet and outlet flow paths and a drive coupled to its pumping element');
  }
  if (hvacFixture) {
    const exchangerBodies = plan.components.filter((component) => /heat exchanger|exchanger core|coil/.test(componentText(component.id))).length;
    const pipeBodies = plan.components.filter((component) => /pipe|tube|inlet|outlet/.test(componentText(component.id))).length;
    const locatingBodies = plan.components.filter((component) => ['gripper', 'piston', 'support', 'frame'].includes(component.primitive) && /clamp|locator|nest|fixture|stop/.test(componentText(component.id))).length;
    requireSignature(count('support') + count('frame') + count('plate') >= 1 && exchangerBodies >= 1 && pipeBodies >= 2, 'a fixture base holding one heat exchanger and two separately represented pipes');
    requireSignature(locatingBodies >= 2, 'multiple clamps or locators that establish the brazing alignment');
  }
  if (/\b(?:wind turbine|turbine)\b/.test(requested)) {
    requireSignature(count('shaft') >= 1 && (/blade|rotor/.test(roles) || count('beam') + count('plate') >= 3), 'a bladed rotor on a shaft');
  }
  if (/\b(?:recycling|material separator)\b/.test(requested)) {
    requireSignature(count('container') >= 2 && count('sensor') + count('camera') >= 1, 'multiple recovery streams and material sensing');
  }
  if (/\b(?:tomato grader|tomato sorter|tomatoes)\b/.test(requested)) {
    requireSignature(count('container') >= 2 && count('sensor') + count('camera') >= 1 && /tomato/.test(roles), 'individual tomatoes, inspection, and distinct output bins');
  }
  if (/\b(?:warehouse buffer|factory buffer|buffer system)\b/.test(requested)) {
    requireSignature(count('conveyor') >= 2 && count('sensor') >= 1, 'multiple accumulation zones with occupancy sensing');
  }
  if (/\b(?:package sorter|box sorter|sorting system)\b/.test(requested) || (/\bconveyor\b/.test(requested) && /\bsort/.test(requested))) {
    requireSignature(count('conveyor') >= 1 && count('container') >= 2 && count('sensor') + count('camera') >= 1, 'a conveyor, classification sensor, and separate destinations');
  } else if (/\bconveyor\b/.test(requested)) {
    requireSignature(count('conveyor') >= 1, 'a recognizable conveyor bed and transport surface');
    requireSignature(relevantDrivenJoints((component, text) => ['conveyor', 'roller', 'belt'].includes(component.primitive) || /conveyor|drive roller|belt/.test(text)).length >= 1, 'a motor coupled to a conveyor belt or drive roller');
  }
  if (/\b(?:brake|rear|tail) lights?\b/.test(requested)) {
    const brakeLights = plan.components.filter((component) => component.primitive === 'light' && /brake|rear|tail|brake-light/.test(`${component.role} ${component.semantic_tags.join(' ')}`.toLowerCase()));
    const safelyMounted = brakeLights.some((light) => plan.connections.some((edge) => edge.connection_type === 'mechanical' && [edge.source_id, edge.target_id].includes(light.id)
      && [edge.source_id, edge.target_id].filter((id) => id !== light.id).some((id) => {
        const support = componentById.get(id); return support && support.primitive !== 'wheel' && support.body_type !== 'dynamic';
      })));
    requireSignature(brakeLights.length >= 1 && safelyMounted, 'a rear-facing brake light mounted to a stationary frame or body support');
  }
}

function validateExplicitRequirements(plan: AgentPlan, requested: string) {
  const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
  const numberToken = '(\\d[\\d,]*(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)';
  const valueOf = (value: string) => numberWords[value.toLowerCase()] ?? Number(value.replaceAll(',', ''));
  const unitOf = (value: string) => {
    const unit = value.toLowerCase().replaceAll(' ', '').replaceAll('²', '2').replace(/[·⋅*.-]/g, '');
    if (unit === 'kg' || unit.startsWith('kilogram')) return 'kg';
    if (unit === 'mm' || unit.startsWith('millimeter') || unit.startsWith('millimetre')) return 'mm';
    if (unit === 'm' || unit.startsWith('meter') || unit.startsWith('metre')) return 'm';
    if (unit === 'cm' || unit.startsWith('centimeter') || unit.startsWith('centimetre')) return 'cm';
    if (unit === 'nm' || unit.startsWith('newtonmeter') || unit.startsWith('newtonmetre')) return 'nm';
    if (unit === 'n' || unit.startsWith('newton')) return 'n';
    if (unit === 'kn' || unit.startsWith('kilonewton')) return 'kn';
    if (unit === 'l/min' || unit.includes('liter/min') || unit.includes('litre/min') || unit.includes('literperminute') || unit.includes('litreperminute')) return 'l/min';
    if (unit === 's' || unit === 'sec' || unit.startsWith('second')) return 's';
    if (unit === 'm/s2' || /met(?:er|re)s?persecondsquared/.test(unit)) return 'm/s2';
    if (unit === 'm/s' || /^met(?:er|re)s?persecond$/.test(unit)) return 'm/s';
    if (unit.includes('/min') || unit.includes('perminute')) return '/min';
    if (unit === '%' || unit === 'percent') return '%';
    if (unit === '°' || unit.startsWith('degree')) return 'deg';
    return unit;
  };
  const requirement = (metrics: string[], target: number, operator: 'min' | 'max' | 'exact', units: string[]) => plan.requirements.some((item) => metrics.includes(item.metric)
    && item.operator === operator && item.source === 'user'
    && Math.abs(item.target - target) <= Math.max(.001, Math.abs(target) * .001)
    && units.includes(unitOf(item.unit)));
  const expectTarget = (target: number | null, metrics: string[], description: string, operator: 'min' | 'max' | 'exact', units: string[]) => {
    if (target !== null && !requirement(metrics, target, operator, units)) throw new Error(`The design graph drops or misstates the user’s explicit ${description} target.`);
  };

  const ratio = requested.match(new RegExp(`${numberToken}\\s*(?::|to)\\s*1\\b`));
  expectTarget(ratio ? valueOf(ratio[1]) : null, ['speed_ratio'], 'transmission ratio', 'exact', ['']);

  const torque = requested.match(new RegExp(`${numberToken}\\s*(?:n\\s*(?:[·⋅*.-]\\s*)?m|newton[- ]?met(?:er|re)s?)\\b`));
  if (torque) {
    const prefix = requested.slice(Math.max(0, (torque.index ?? 0) - 28), torque.index);
    const operator = /(?:no more than|at most|maximum|max|under|less than)\s*$/.test(prefix) ? 'max' : /(?:exactly|equal to)\s*$/.test(prefix) ? 'exact' : 'min';
    expectTarget(valueOf(torque[1]), ['output_torque'], 'output torque', operator, ['nm']);
  }

  const liftHeight = requested.match(new RegExp(`\\b(?:lift|raise|hoist|elevat\\w*)\\b[^.]{0,90}?\\b(?:by|through|to|height(?:\\s+of)?)\\s*${numberToken}\\s*(m|meters?|metres?|cm|centimeters?|centimetres?)\\b`));
  if (liftHeight) {
    const distance = valueOf(liftHeight[1]); const unit = unitOf(liftHeight[2]);
    expectTarget(unit === 'cm' ? distance / 100 : distance, ['lift_height'], 'lift height', 'min', ['m']);
  }

  const reach = requested.match(new RegExp(`\\b(?:reach|reaches|spans?|spanning)\\b[^.]{0,40}?${numberToken}\\s*(m|meters?|metres?)\\b`));
  const labelledSpan = requested.match(new RegExp(`${numberToken}\\s*(m|meters?|metres?)\\s+(?:clear\\s+)?span\\b`));
  const reachOrSpan = reach ?? labelledSpan;
  if (reachOrSpan) expectTarget(valueOf(reachOrSpan[1]), ['reach', 'span'], 'reach or span', 'min', ['m']);

  const actionLoad = requested.match(new RegExp(`\\b(?:lift|raise|carry|carries|carrying|support|supports|hoist|pull|pulls|pulling)\\b[^,.]{0,75}?${numberToken}\\s*(kg|kilograms?)\\b`));
  const labelledLoad = requested.match(new RegExp(`${numberToken}\\s*(kg|kilograms?)\\s+(?:(?:rated|moving|patient|payload|design)\\s+){0,2}(?:payload|load|patient|beam)\\b`));
  const load = actionLoad ?? labelledLoad;
  if (load) expectTarget(valueOf(load[1]), ['payload_capacity', 'load_capacity'], 'load target', 'min', ['kg']);

  const throughput = requested.match(new RegExp(`${numberToken}\\s*\\+?\\s*(?:boxes?|packages?|parts?|items?|objects?|containers?|bags?|tablets?|cookies?|bottles?|cans?|pieces?)?\\s*(?:per\\s+minute|/\\s*(?:min|minute))\\b`));
  if (throughput) expectTarget(valueOf(throughput[1]), ['throughput'], 'throughput', 'min', ['/min']);

  const componentLimit = requested.match(new RegExp(`(?:no more than|at most|maximum|max(?:imum)? of)\\s+${numberToken}\\s+(?:physical\\s+)?components?\\b`));
  if (componentLimit) expectTarget(valueOf(componentLimit[1]), ['component_count'], 'component-count limit', 'max', ['']);

  const accuracy = requested.match(new RegExp(`${numberToken}\\s*(%|percent)\\s+(?:sorting\\s+accuracy|accuracy|successful\\s+(?:sorting|separation))\\b`));
  if (accuracy) expectTarget(valueOf(accuracy[1]), ['sorting_accuracy'], 'sorting-accuracy', 'min', ['%']);

  const tilt = requested.match(new RegExp(`(?:tilt|tilting)[^.]{0,35}?(?:below|under|less than|no more than|at most)\\s*${numberToken}\\s*(°|degrees?)\\b`));
  if (tilt) expectTarget(valueOf(tilt[1]), ['platform_tilt'], 'tilt limit', 'max', ['deg']);

  const drop = requested.match(new RegExp(`(?:drop|dropping|dropped)[^.]{0,55}?(?:below|under|less than|no more than|at most|more than|over|exceed(?:ing)?)\\s*${numberToken}\\s*(m|meters?|metres?|cm|centimeters?|centimetres?)\\b`));
  if (drop) {
    const distance = valueOf(drop[1]); const unit = unitOf(drop[2]);
    expectTarget(unit === 'm' ? distance * 100 : distance, ['drop_height'], 'drop-height limit', 'max', ['cm']);
  }

  const flowRate = requested.match(new RegExp(`${numberToken}\\s*(l\\s*/\\s*min|liters?\\s+per\\s+minute|litres?\\s+per\\s+minute)\\b`));
  if (flowRate) expectTarget(valueOf(flowRate[1]), ['flow_rate'], 'flow-rate', 'min', ['l/min']);

  const pressForce = requested.match(new RegExp(`${numberToken}\\s*(kn|kilonewtons?|n|newtons?)\\b[^.]{0,36}\\b(?:press(?:ing)?|clamp(?:ing)?|force)\\b|\\b(?:press(?:ing)?|clamp(?:ing)?|force)\\b[^.]{0,36}?${numberToken}\\s*(kn|kilonewtons?|n|newtons?)\\b`));
  if (pressForce) {
    const valueIndex = pressForce[1] ? 1 : 3; const unitIndex = pressForce[2] ? 2 : 4;
    const force = valueOf(pressForce[valueIndex]); const forceUnit = unitOf(pressForce[unitIndex]);
    expectTarget(forceUnit === 'kn' ? force * 1000 : force, ['pressing_force', 'clamp_force'], 'press or clamp force', 'min', ['n']);
  }

  const distanceUnitToken = '(mm|millimeters?|millimetres?|cm|centimeters?|centimetres?|m|meters?|metres?)';
  const labelledStroke = requested.match(new RegExp(`\\b(?:stroke|ram\\s+travel|piston\\s+travel|plunger\\s+travel)\\b[^.]{0,36}?${numberToken}\\s*${distanceUnitToken}\\b`));
  const suffixedStroke = requested.match(new RegExp(`${numberToken}\\s*${distanceUnitToken}\\b\\s*(?:of\\s+)?(?:(?:linear|ram|piston|plunger|press)\\s+)?(?:stroke|travel)\\b`));
  const statedStroke = labelledStroke ?? suffixedStroke;
  if (statedStroke) {
    const distance = valueOf(statedStroke[1]); const unit = unitOf(statedStroke[2]);
    const meters = unit === 'mm' ? distance / 1000 : unit === 'cm' ? distance / 100 : distance;
    expectTarget(meters, ['stroke'], 'stroke length', 'min', ['m']);
  }

  const speedUnitToken = '(m\\s*\\/\\s*s|meters?\\s+per\\s+second|metres?\\s+per\\s+second)';
  const labelledLineSpeed = requested.match(new RegExp(`\\b(?:winch|hoist|cable|line\\s+speed|winding)\\b[^.]{0,100}?${numberToken}\\s*${speedUnitToken}\\b`));
  const suffixedLineSpeed = requested.match(new RegExp(`${numberToken}\\s*${speedUnitToken}\\b[^.]{0,45}?\\b(?:line\\s+speed|winch|hoist|cable|winding)\\b`));
  const lineSpeed = labelledLineSpeed ?? suffixedLineSpeed;
  if (lineSpeed) expectTarget(valueOf(lineSpeed[1]), ['line_speed'], 'winch line speed', 'exact', ['m/s']);

  const trackingTolerance = requested.match(new RegExp(`\\b(?:track|tracker|tracking|follow|following|point|pointing|align|aligned|keep|keeps|keeping|panel)\\b[^.]{0,80}?\\b(?:within|error(?:\\s+of)?|tolerance(?:\\s+of)?|no more than|at most)\\s*${numberToken}\\s*(°|degrees?)\\b`));
  if (trackingTolerance) expectTarget(valueOf(trackingTolerance[1]), ['tracking_error'], 'tracking-error', 'max', ['deg']);

  const alignmentTolerance = requested.match(new RegExp(`\\b(?:align|alignment|position|positioning)\\b[^.]{0,65}?\\b(?:within|tolerance(?:\\s+of)?|error(?:\\s+of)?|no more than|at most)\\s*${numberToken}\\s*(mm|millimeters?|millimetres?)\\b`));
  if (alignmentTolerance) expectTarget(valueOf(alignmentTolerance[1]), ['alignment_error'], 'alignment tolerance', 'max', ['mm']);

  const courseTime = requested.match(new RegExp(`\\b(?:reach|reaches|reaching|finish|finishes|complete|completes|target|course)\\b[^.]{0,65}?\\b(?:in\\s+)?(?:under|within|less than|no more than|at most)?\\s*${numberToken}\\s*(s|sec|seconds?)\\b`));
  if (courseTime) expectTarget(valueOf(courseTime[1]), ['course_time'], 'course-time', 'max', ['s']);

  const acceleration = requested.match(new RegExp(`\\b(?:acceleration|accelerating|accelerate)\\b[^.]{0,55}?\\b(?:below|under|less than|no more than|at most|not exceed(?:ing)?|without exceeding)\\s*${numberToken}\\s*(m\\s*/\\s*s(?:2|²)|meters?\\s+per\\s+second\\s+squared|metres?\\s+per\\s+second\\s+squared)\\b`));
  if (acceleration) expectTarget(valueOf(acceleration[1]), ['peak_acceleration'], 'peak-acceleration limit', 'max', ['m/s2']);
}

function validatePromptFidelity(plan: AgentPlan, originalPrompt: string) {
  const requested = originalPrompt.toLowerCase();
  const designed = [plan.machine_name, ...plan.architecture, ...plan.assemblies.flatMap((item) => [item.name, item.purpose]), ...plan.components.map((item) => item.role)].join(' ').toLowerCase();
  const identity = identityChecks.find((item) => item.requested.test(requested));
  if (identity && !identity.designed.test(designed)) throw new Error('The design graph does not preserve the user’s requested mechanical object identity.');
  if (!identity) {
    const head = requested.replace(/^(?:please\s+)?(?:build|design|create|engineer|make)\s+(?:an?|the)?\s*/, '').split(/\b(?:that|which|while|using|with|to)\b/)[0];
    const ignored = new Set(['machine', 'mechanism', 'system', 'device', 'tool', 'part', 'rig', 'model', 'prototype', 'assembly', 'test', 'display', 'concept', 'mechanical', 'physical', 'automatic', 'powered', 'good', 'compact', 'small', 'large', 'industrial', 'electric', 'hydraulic', 'pneumatic', 'portable', 'heavy-duty', 'high-speed', 'low-speed']);
    const tokens = head.match(/[a-z][a-z-]{3,}/g)?.filter((token) => !ignored.has(token)) ?? [];
    const headNoun = tokens.at(-1);
    if (headNoun && !designed.includes(headNoun) && !(headNoun.endsWith('s') && designed.includes(headNoun.slice(0, -1)))) throw new Error('The design graph does not preserve the main object named in the user goal.');
  }
  const primitiveNames: Record<string, string> = { wheel: 'wheel', wheels: 'wheel', wing: 'aerofoil', wings: 'aerofoil', gear: 'gear', gears: 'gear', sensor: 'sensor', sensors: 'sensor', motor: 'motor', motors: 'motor', servo: 'servo', servos: 'servo', piston: 'piston', pistons: 'piston', spring: 'spring', springs: 'spring', bin: 'container', bins: 'container', container: 'container', containers: 'container', ramp: 'ramp', ramps: 'ramp', pulley: 'pulley', pulleys: 'pulley', headlight: 'light', headlights: 'light', 'brake light': 'light', 'brake lights': 'light' };
  const countWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  const quantityPattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+)\s+(wheels?|wings?|gears?|sensors?|motors?|servos?|pistons?|springs?|bins?|containers?|ramps?|pulleys?|headlights?|brake lights?)\b/g;
  for (const match of requested.matchAll(quantityPattern)) {
    const expected = countWords[match[1]] ?? Number(match[1]); const primitive = primitiveNames[match[2]];
    if (Number.isFinite(expected) && plan.components.filter((item) => item.primitive === primitive).length < expected) throw new Error(`The design graph drops the explicit request for ${expected} ${match[2]}.`);
  }
  validatePhysicalSignature(plan, requested);
  validateExplicitRequirements(plan, requested);
}

export function validateAgentPlanSemantics(plan: AgentPlan, originalPrompt?: string) {
  unique(plan.assemblies.map((item) => item.id), 'Assembly'); unique(plan.components.map((item) => item.id), 'Component'); unique(plan.connections.map((item) => item.id), 'Connection'); unique(plan.joints.map((item) => item.id), 'Joint'); unique(plan.motors.map((item) => item.id), 'Motor'); unique(plan.sensors.map((item) => item.id), 'Sensor'); unique(plan.actuators.map((item) => item.id), 'Actuator'); unique(plan.controls.map((item) => item.id), 'Control');
  const assemblyIds = new Set(plan.assemblies.map((item) => item.id)); const componentIds = new Set(plan.components.map((item) => item.id)); const jointIds = new Set(plan.joints.map((item) => item.id)); const sensorIds = new Set(plan.sensors.map((item) => item.id)); const actuatorIds = new Set(plan.actuators.map((item) => item.id));
  const bodyById = new Map(plan.components.map((item) => [item.id, item]));
  for (const item of plan.assemblies) { if (item.parent_id) assertReference(assemblyIds, item.parent_id, `Assembly ${item.id} parent`); if (item.parent_id === item.id) throw new Error(`Assembly ${item.id} cannot parent itself.`); }
  for (const start of plan.assemblies) {
    const visited = new Set<string>(); let current = start;
    while (current.parent_id) { if (visited.has(current.id)) throw new Error('The assembly hierarchy contains a cycle.'); visited.add(current.id); current = plan.assemblies.find((item) => item.id === current.parent_id)!; }
  }
  for (const item of plan.components) {
    assertReference(assemblyIds, item.assembly_id, `Component ${item.id} assembly`);
    if (item.position.some((value) => Math.abs(value) > 25)) throw new Error(`Component ${item.id} is outside the 50 m concept workspace.`);
    if (item.rotation.some((value) => Math.abs(value) > Math.PI * 2)) throw new Error(`Component ${item.id} rotation must stay within ±2π radians.`);
  }
  const explicitComponentLimit = plan.requirements.find((item) => item.metric === 'component_count' && item.operator === 'max' && item.source === 'user');
  if (explicitComponentLimit && plan.components.length > explicitComponentLimit.target) throw new Error(`The design graph exceeds the user’s explicit component-count limit of ${explicitComponentLimit.target}.`);
  unique(plan.connections.map((item) => `${item.connection_type}|${[item.source_id, item.target_id].sort().join('|')}|${item.channel}`), 'Connection edge');
  for (const item of plan.connections) { assertReference(componentIds, item.source_id, `Connection ${item.id}`); assertReference(componentIds, item.target_id, `Connection ${item.id}`); if (item.source_id === item.target_id) throw new Error(`Connection ${item.id} cannot target itself.`); }
  unique(plan.joints.map((item) => [item.component_a, item.component_b].sort().join('|')), 'Joint body pair');
  for (const item of plan.joints) { assertReference(componentIds, item.component_a, `Joint ${item.id}`); assertReference(componentIds, item.component_b, `Joint ${item.id}`); if (item.component_a === item.component_b) throw new Error(`Joint ${item.id} needs two bodies.`); if (Math.hypot(...item.axis) < .5) throw new Error(`Joint ${item.id} needs a non-zero axis.`); if (item.limits && item.limits[0] > item.limits[1]) throw new Error(`Joint ${item.id} has reversed limits.`); if (['prismatic', 'spring', 'rope'].includes(item.joint_type) && !item.limits) throw new Error(`Joint ${item.id} needs finite travel limits.`); if (['gear', 'belt'].includes(item.joint_type) && item.ratio <= 0) throw new Error(`Joint ${item.id} needs a positive ratio.`); if (item.joint_type !== 'fixed' && bodyById.get(item.component_a)?.body_type === 'fixed' && bodyById.get(item.component_b)?.body_type === 'fixed') throw new Error(`Joint ${item.id} cannot create motion between two fixed bodies.`); }
  for (const item of plan.motors) { assertReference(componentIds, item.component_id, `Motor ${item.id}`); assertReference(jointIds, item.joint_id, `Motor ${item.id}`, true); if (plan.components.find((part) => part.id === item.component_id)?.primitive !== 'motor') throw new Error(`Motor ${item.id} must target a motor primitive.`); if (item.joint_id) { const driven = plan.joints.find((joint) => joint.id === item.joint_id)!; if (driven.joint_type === 'fixed' || bodyById.get(driven.component_b)?.body_type === 'fixed') throw new Error(`Motor ${item.id} must drive the movable component_b endpoint of a motion joint.`); } }
  for (const item of plan.sensors) { assertReference(componentIds, item.component_id, `Sensor ${item.id}`); assertReference(componentIds, item.target_id, `Sensor ${item.id}`, true); if (!['sensor', 'camera'].includes(plan.components.find((part) => part.id === item.component_id)?.primitive ?? '')) throw new Error(`Sensor ${item.id} must target a sensor or camera primitive.`); }
  for (const item of plan.actuators) { assertReference(componentIds, item.component_id, `Actuator ${item.id}`); assertReference(jointIds, item.joint_id, `Actuator ${item.id}`); if (!['motor', 'servo', 'piston'].includes(plan.components.find((part) => part.id === item.component_id)?.primitive ?? '')) throw new Error(`Actuator ${item.id} needs a motor, servo, or piston body.`); const driven = plan.joints.find((joint) => joint.id === item.joint_id)!; if (driven.joint_type === 'fixed' || bodyById.get(driven.component_b)?.body_type === 'fixed') throw new Error(`Actuator ${item.id} must drive the movable component_b endpoint of a motion joint.`); }
  for (const item of plan.controls) { item.sensor_ids.forEach((id) => assertReference(sensorIds, id, `Control ${item.id}`)); item.actuator_ids.forEach((id) => assertReference(actuatorIds, id, `Control ${item.id}`)); }
  assertReference(componentIds, plan.editable_component_id, 'Editable component');
  if (!plan.components.some((item) => item.body_type === 'fixed')) throw new Error('The design needs at least one grounded fixed body.');
  if (plan.components.length > 2 && !plan.connections.length && !plan.joints.length) throw new Error('The design is an unconnected parts pile.');
  const adjacency = new Map(plan.components.map((item) => [item.id, new Set<string>()]));
  for (const joint of plan.joints) { adjacency.get(joint.component_a)!.add(joint.component_b); adjacency.get(joint.component_b)!.add(joint.component_a); }
  for (const connection of plan.connections.filter((item) => item.connection_type === 'mechanical')) { adjacency.get(connection.source_id)!.add(connection.target_id); adjacency.get(connection.target_id)!.add(connection.source_id); }
  const reachable = new Set(plan.components.filter((item) => item.body_type === 'fixed').map((item) => item.id));
  const queue = [...reachable];
  while (queue.length) for (const neighbor of adjacency.get(queue.shift()!) ?? []) if (!reachable.has(neighbor)) { reachable.add(neighbor); queue.push(neighbor); }
  const intentionallyFree = new Set(['payload', 'package-red', 'package-blue', 'shipping-carton', 'tomato-ripe', 'tomato-reject', 'metal-can', 'plastic-bottle', 'reject-object']);
  const orphan = plan.components.find((item) => !reachable.has(item.id) && !item.semantic_tags.some((tag) => intentionallyFree.has(tag)));
  if (orphan) throw new Error(`Component ${orphan.id} is not mechanically reachable from a grounded body.`);
  const active = plan.capabilities.some((item) => ['transport', 'lift', 'mobile', 'manipulate', 'transmit', 'track', 'rotate'].includes(item));
  const motionJointIds = new Set(plan.joints.filter((joint) => joint.joint_type !== 'fixed'
    && bodyById.get(joint.component_b)?.body_type !== 'fixed').map((joint) => joint.id));
  const hasDrivenPath = plan.actuators.some((actuator) => motionJointIds.has(actuator.joint_id))
    || plan.motors.some((motor) => motionJointIds.has(motor.joint_id));
  const hasManualDrive = plan.joints.some((joint) => joint.joint_type !== 'fixed' && [joint.component_a, joint.component_b].some((id) => /\b(?:pedal|crank|handwheel|hand wheel|manual handle|treadle)\b/.test(`${bodyById.get(id)?.role ?? ''} ${bodyById.get(id)?.semantic_tags.join(' ') ?? ''}`.toLowerCase())));
  if (active && !hasDrivenPath && !hasManualDrive) throw new Error('An active machine needs a motor, actuator, or explicit manual drive connected to the mechanism it drives.');
  if (originalPrompt) validatePromptFidelity(plan, normalizeEngineeringIntent(originalPrompt).normalizedRequest);
  return plan;
}

const FREE_BODY_TAGS = new Set(['payload', 'package-red', 'package-blue', 'shipping-carton', 'tomato-ripe', 'tomato-reject', 'metal-can', 'plastic-bottle', 'reject-object']);

/**
 * Repair the narrow topology mistakes that language models commonly make.
 * This never invents a new body or changes user requirements; it only grounds
 * an existing non-product body by attaching it to the nearest reachable body.
 */
export function repairAgentPlanGraph(input: AgentPlan): AgentPlan {
  const plan = structuredClone(input);
  if (!plan.components.length) return plan;
  const supportScore = (item: AgentPlan['components'][number]) => {
    const text = `${item.role} ${item.semantic_tags.join(' ')}`.toLowerCase();
    return (/(?:ground|base|frame|chassis|support|foundation|mount)/.test(text) ? 8 : 0)
      + (['support', 'frame', 'plate', 'beam', 'body-shell'].includes(item.primitive) ? 4 : 0)
      - item.position[1];
  };
  if (!plan.components.some((item) => item.body_type === 'fixed')) {
    [...plan.components].sort((a, b) => supportScore(b) - supportScore(a))[0].body_type = 'fixed';
  }
  const pairKey = (a: string, b: string) => [a, b].sort().join('|');
  const jointPairs = new Set(plan.joints.map((item) => pairKey(item.component_a, item.component_b)));
  const usedJointIds = new Set(plan.joints.map((item) => item.id));
  const nextJointId = (componentId: string) => {
    const stem = `auto-mount-${componentId}`.slice(0, 58);
    let id = stem; let suffix = 2;
    while (usedJointIds.has(id)) { id = `${stem}-${suffix}`.slice(0, 64); suffix += 1; }
    usedJointIds.add(id); return id;
  };
  const adjacency = () => {
    const graph = new Map(plan.components.map((item) => [item.id, new Set<string>()]));
    for (const joint of plan.joints) { graph.get(joint.component_a)?.add(joint.component_b); graph.get(joint.component_b)?.add(joint.component_a); }
    for (const edge of plan.connections.filter((item) => item.connection_type === 'mechanical')) { graph.get(edge.source_id)?.add(edge.target_id); graph.get(edge.target_id)?.add(edge.source_id); }
    return graph;
  };
  const reachableBodies = () => {
    const graph = adjacency();
    const reachable = new Set(plan.components.filter((item) => item.body_type === 'fixed').map((item) => item.id));
    const queue = [...reachable];
    while (queue.length) for (const neighbor of graph.get(queue.shift()!) ?? []) if (!reachable.has(neighbor)) { reachable.add(neighbor); queue.push(neighbor); }
    return reachable;
  };
  const distance = (a: AgentPlan['components'][number], b: AgentPlan['components'][number]) => Math.hypot(
    a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2],
  );
  const preferredJoint = (item: AgentPlan['components'][number]) => {
    const text = `${item.role} ${item.semantic_tags.join(' ')}`.toLowerCase();
    if (item.body_type === 'fixed' || ['motor', 'servo', 'sensor', 'camera', 'controller', 'light', 'battery', 'seat'].includes(item.primitive)) return { joint_type: 'fixed' as const, axis: [0, 1, 0] as [number, number, number], limits: null };
    if (item.primitive === 'piston') return { joint_type: 'prismatic' as const, axis: [0, 1, 0] as [number, number, number], limits: [-.25, .25] as [number, number] };
    if (item.primitive === 'spring') return { joint_type: 'spring' as const, axis: [0, 1, 0] as [number, number, number], limits: [-.15, .15] as [number, number] };
    if (['wheel', 'gear', 'pulley', 'shaft', 'roller', 'rotor', 'propeller'].includes(item.primitive)) {
      const axis: [number, number, number] = /(?:vertical|yaw|turntable|main rotor)/.test(text) ? [0, 1, 0] : [0, 0, 1];
      return { joint_type: 'revolute' as const, axis, limits: null };
    }
    if (['steering', 'linkage'].includes(item.primitive) || /(?:hinge|lever|arm|door|gate)/.test(text)) return { joint_type: 'revolute' as const, axis: [0, 1, 0] as [number, number, number], limits: [-.7, .7] as [number, number] };
    return { joint_type: 'fixed' as const, axis: [0, 1, 0] as [number, number, number], limits: null };
  };

  for (let pass = 0; pass < plan.components.length; pass += 1) {
    const reachable = reachableBodies();
    const orphan = plan.components.find((item) => !reachable.has(item.id) && !item.semantic_tags.some((tag) => FREE_BODY_TAGS.has(tag)));
    if (!orphan) break;
    const candidates = plan.components.filter((item) => reachable.has(item.id) && item.id !== orphan.id)
      .sort((a, b) => (a.assembly_id === orphan.assembly_id ? -3 : 0) + distance(a, orphan) - ((b.assembly_id === orphan.assembly_id ? -3 : 0) + distance(b, orphan)));
    const parent = candidates[0];
    if (!parent) break;
    const pair = pairKey(parent.id, orphan.id);
    if (jointPairs.has(pair)) break;
    const joint = preferredJoint(orphan);
    // A fixed child cannot be placed on a motion joint. Keep the attachment
    // rigid rather than mutating the model-authored body classification.
    const jointType = parent.body_type === 'fixed' && orphan.body_type === 'fixed' ? 'fixed' : joint.joint_type;
    plan.joints.push({
      id: nextJointId(orphan.id), joint_type: jointType,
      component_a: parent.id, component_b: orphan.id, axis: joint.axis,
      limits: jointType === 'fixed' ? null : joint.limits,
      ratio: 0, stiffness: jointType === 'spring' ? 800 : 0, damping: jointType === 'spring' ? 45 : 0,
    });
    jointPairs.add(pair);
  }
  return plan;
}

export function validateAgentEditSemantics(edit: AgentEdit, context: EditContext) {
  if (edit.needs_clarification) {
    if (!edit.clarification_question || edit.actions.length) throw new Error('A clarification response needs one question and zero actions.');
    return edit;
  }
  if (!edit.actions.length) throw new Error('A resolved edit needs at least one guarded action.');
  if (edit.clarification_question) throw new Error('A resolved edit must leave clarification_question empty.');
  if (!edit.verification.length) throw new Error('A resolved edit needs at least one observable verification check.');
  unique(edit.target_ids, 'Resolved target'); unique(edit.preserve_ids, 'Preserved component');

  const identifiers = (tool: AgentEditAction['tool'], key: string) => edit.actions.filter((action) => action.tool === tool).map((action) => (action as unknown as Record<string, string>)[key]);
  const created = {
    assemblies: identifiers('create_assembly', 'assembly_id'),
    components: identifiers('create_component', 'component_id'),
    connections: identifiers('connect_components', 'connection_id'),
    joints: identifiers('create_joint', 'joint_id'),
    motors: identifiers('add_motor', 'motor_id'),
    sensors: identifiers('add_sensor', 'sensor_id'),
    actuators: identifiers('add_actuator', 'actuator_id'),
    controls: identifiers('set_control_logic', 'control_id'),
  };
  for (const [label, ids] of Object.entries(created)) unique(ids, `New ${label.slice(0, -1)}`);
  const existing = {
    assemblies: new Set(context.assemblies.map((item) => item.id)), components: new Set(context.components.map((item) => item.id)),
    connections: new Set(context.connections.map((item) => item.id)), joints: new Set(context.joints.map((item) => item.id)),
    motors: new Set(context.motors.map((item) => item.id)), sensors: new Set(context.sensors.map((item) => item.id)),
    actuators: new Set(context.actuators.map((item) => item.id)), controls: new Set(context.controls.map((item) => item.id)),
  };
  for (const key of Object.keys(created) as Array<keyof typeof created>) for (const id of created[key]) if (existing[key].has(id)) throw new Error(`${key.slice(0, -1)} “${id}” already exists.`);

  const assemblies = new Set(existing.assemblies), components = new Set(existing.components), joints = new Set(existing.joints), sensors = new Set(existing.sensors), actuators = new Set(existing.actuators);
  const connections = new Set(existing.connections), motors = new Set(existing.motors), controls = new Set(existing.controls);
  const primitiveById = new Map(context.components.map((item) => [item.id, item.primitive]));
  const bodyTypeById = new Map(context.components.map((item) => [item.id, item.body_type]));
  const parametersById = new Map(context.components.map((item) => [item.id, item.parameters]));
  const createdTagsById = new Map<string, string[]>();
  const jointById = new Map(context.joints.map((item) => [item.id, { ...item }]));
  const connectionById = new Map(context.connections.map((item) => [item.id, { ...item }]));
  const motorById = new Map(context.motors.map((item) => [item.id, { component_id: item.component_id, joint_id: item.joint_id }]));
  const sensorById = new Map(context.sensors.map((item) => [item.id, { component_id: item.component_id, target_id: item.target_id }]));
  const actuatorById = new Map(context.actuators.map((item) => [item.id, { component_id: item.component_id, joint_id: item.joint_id }]));
  const controlById = new Map(context.controls.map((item) => [item.id, { sensor_ids: [...item.sensor_ids], actuator_ids: [...item.actuator_ids] }]));
  const locked = new Map(context.components.map((item) => [item.id, new Set(item.human_locked_fields)]));
  const preserved = new Set(edit.preserve_ids); const declaredTargets = new Set(edit.target_ids); const touched = new Set<string>();
  edit.preserve_ids.forEach((id) => assertReference(existing.components, id, 'Preserved component'));
  const touch = (id: string) => { touched.add(id); if (!declaredTargets.has(id)) throw new Error(`Touched component ${id} must be declared in target_ids.`); if (preserved.has(id)) throw new Error(`Edit cannot change preserved component ${id}.`); };
  const mutableField = (id: string, field: string) => { assertReference(components, id, `Edit ${field}`); touch(id); if (locked.get(id)?.has(field)) throw new Error(`Edit would overwrite human-locked ${field} on ${id}.`); };
  const touchJoint = (jointId: string) => {
    const joint = jointById.get(jointId); if (!joint) return;
    touch(joint.component_a); touch(joint.component_b);
  };
  const requireDrivenJoint = (jointId: string, label: string) => {
    const joint = jointById.get(jointId);
    if (!joint || joint.joint_type === 'fixed' || bodyTypeById.get(joint.component_b) === 'fixed') throw new Error(`${label} must drive the movable component_b endpoint of a motion joint.`);
    return joint;
  };
  const touchMotor = (motorId: string) => {
    const motor = motorById.get(motorId); if (!motor) return;
    assertReference(components, motor.component_id, `Motor ${motorId}`); touch(motor.component_id); if (motor.joint_id) { requireDrivenJoint(motor.joint_id, `Motor ${motorId}`); touchJoint(motor.joint_id); }
    // A speed change also changes the observable behavior of a belt, roller,
    // wheel, or other body reached by the motor's explicit power edge. Count a
    // model-declared powered target as truthful even when it is not itself the
    // motion-joint child (common for conveyor roller/belt abstractions).
    for (const edge of connectionById.values()) {
      if (edge.connection_type !== 'power') continue;
      const powered = edge.source_id === motor.component_id ? edge.target_id : edge.target_id === motor.component_id ? edge.source_id : '';
      if (powered && declaredTargets.has(powered)) touch(powered);
    }
  };
  const touchSensor = (sensorId: string) => {
    const sensor = sensorById.get(sensorId); if (!sensor) return;
    assertReference(components, sensor.component_id, `Sensor ${sensorId}`); touch(sensor.component_id);
    if (sensor.target_id) { assertReference(components, sensor.target_id, `Sensor ${sensorId}`); touch(sensor.target_id); }
  };
  const touchActuator = (actuatorId: string) => {
    const actuator = actuatorById.get(actuatorId); if (!actuator) return;
    assertReference(components, actuator.component_id, `Actuator ${actuatorId}`); requireDrivenJoint(actuator.joint_id, `Actuator ${actuatorId}`); touch(actuator.component_id); touchJoint(actuator.joint_id);
  };
  const touchControl = (controlId: string) => {
    const control = controlById.get(controlId); if (!control) return;
    control.sensor_ids.forEach(touchSensor); control.actuator_ids.forEach(touchActuator);
  };

  const reachableFromFixed = (componentIds: Set<string>, graph: Map<string, { component_a: string; component_b: string }>) => {
    const adjacency = new Map([...componentIds].map((id) => [id, new Set<string>()]));
    for (const joint of graph.values()) {
      if (!componentIds.has(joint.component_a) || !componentIds.has(joint.component_b)) continue;
      adjacency.get(joint.component_a)!.add(joint.component_b); adjacency.get(joint.component_b)!.add(joint.component_a);
    }
    const reachable = new Set([...componentIds].filter((id) => bodyTypeById.get(id) === 'fixed'));
    const queue = [...reachable];
    while (queue.length) for (const neighbor of adjacency.get(queue.shift()!) ?? []) if (!reachable.has(neighbor)) { reachable.add(neighbor); queue.push(neighbor); }
    return reachable;
  };
  const baselineReachable = reachableFromFixed(new Set(existing.components), new Map(context.joints.map((item) => [item.id, item])));

  for (const action of edit.actions) {
    if (action.tool === 'create_assembly') { if (action.parent_id) assertReference(assemblies, action.parent_id, `Assembly ${action.assembly_id}`); assemblies.add(action.assembly_id); continue; }
    if (action.tool === 'create_component') {
      assertReference(assemblies, action.assembly_id, `Component ${action.component_id}`); touch(action.component_id);
      if (action.position.some((value, index) => Math.abs(value) > context.world.bounds[index] / 2)) throw new Error(`Component ${action.component_id} is outside the current world bounds.`);
      if (action.rotation.some((value) => Math.abs(value) > Math.PI * 2)) throw new Error(`Component ${action.component_id} rotation must stay within ±2π radians.`);
      components.add(action.component_id); primitiveById.set(action.component_id, action.primitive); bodyTypeById.set(action.component_id, action.body_type); createdTagsById.set(action.component_id, action.semantic_tags); continue;
    }
    if (action.tool === 'set_dimensions') { mutableField(action.component_id, 'dimensions'); continue; }
    if (action.tool === 'set_material') { mutableField(action.component_id, 'material'); continue; }
    if (action.tool === 'set_mass') { mutableField(action.component_id, 'mass'); continue; }
    if (action.tool === 'move_component') {
      mutableField(action.component_id, 'position');
      [...jointById.values()].filter((item) => item.component_a === action.component_id || item.component_b === action.component_id).forEach((item) => touch(item.component_a === action.component_id ? item.component_b : item.component_a));
      if (action.position.some((value, index) => Math.abs(value) > context.world.bounds[index] / 2)) throw new Error(`${action.component_id} would leave the current world bounds.`); continue;
    }
    if (action.tool === 'rotate_component') {
      mutableField(action.component_id, 'rotation');
      [...jointById.values()].filter((item) => item.component_a === action.component_id || item.component_b === action.component_id).forEach((item) => touch(item.component_a === action.component_id ? item.component_b : item.component_a));
      if (action.rotation.some((value) => Math.abs(value) > Math.PI * 2)) throw new Error(`${action.component_id} rotation must stay within ±2π radians.`); continue;
    }
    if (action.tool === 'remove_component') {
      mutableField(action.component_id, 'remove');
      if ((locked.get(action.component_id)?.size ?? 0) > 0) throw new Error(`Edit cannot remove human-locked component ${action.component_id}.`);
      const attachedJoints = [...jointById.values()].filter((item) => item.component_a === action.component_id || item.component_b === action.component_id);
      const attachedJointIds = new Set(attachedJoints.map((item) => item.id));
      for (const joint of attachedJoints) touch(joint.component_a === action.component_id ? joint.component_b : joint.component_a);
      for (const edge of [...connectionById.values()].filter((item) => item.source_id === action.component_id || item.target_id === action.component_id)) touch(edge.source_id === action.component_id ? edge.target_id : edge.source_id);
      const removedSensorIds = new Set([...sensorById].filter(([, item]) => item.component_id === action.component_id || item.target_id === action.component_id).map(([id]) => id));
      const removedActuatorIds = new Set([...actuatorById].filter(([, item]) => item.component_id === action.component_id || attachedJointIds.has(item.joint_id)).map(([id]) => id));
      const removedMotorIds = new Set([...motorById].filter(([, item]) => item.component_id === action.component_id || Boolean(item.joint_id && attachedJointIds.has(item.joint_id))).map(([id]) => id));
      for (const id of removedSensorIds) {
        const sensor = sensorById.get(id)!;
        if (sensor.component_id !== action.component_id) touch(sensor.component_id);
        if (sensor.target_id && sensor.target_id !== action.component_id) touch(sensor.target_id);
        sensorById.delete(id); sensors.delete(id);
      }
      for (const id of removedActuatorIds) {
        const actuator = actuatorById.get(id)!;
        if (actuator.component_id !== action.component_id) touch(actuator.component_id);
        if (jointById.has(actuator.joint_id)) touchJoint(actuator.joint_id);
        actuatorById.delete(id); actuators.delete(id);
      }
      for (const id of removedMotorIds) {
        const motor = motorById.get(id)!;
        if (motor.component_id !== action.component_id) touch(motor.component_id);
        if (motor.joint_id && jointById.has(motor.joint_id)) touchJoint(motor.joint_id);
        motorById.delete(id); motors.delete(id);
      }
      for (const [id, control] of controlById) {
        const changed = control.sensor_ids.some((item) => removedSensorIds.has(item)) || control.actuator_ids.some((item) => removedActuatorIds.has(item));
        control.sensor_ids = control.sensor_ids.filter((item) => !removedSensorIds.has(item)); control.actuator_ids = control.actuator_ids.filter((item) => !removedActuatorIds.has(item));
        if (!control.sensor_ids.length && !control.actuator_ids.length) { controlById.delete(id); controls.delete(id); }
        else if (changed) touchControl(id);
      }
      for (const [id, edge] of connectionById) if (edge.source_id === action.component_id || edge.target_id === action.component_id) { connectionById.delete(id); connections.delete(id); }
      attachedJoints.forEach((item) => { jointById.delete(item.id); joints.delete(item.id); });
      components.delete(action.component_id); primitiveById.delete(action.component_id); bodyTypeById.delete(action.component_id); parametersById.delete(action.component_id); createdTagsById.delete(action.component_id); continue;
    }
    if (action.tool === 'connect_components') {
      assertReference(components, action.source_id, `Connection ${action.connection_id}`); assertReference(components, action.target_id, `Connection ${action.connection_id}`); if (action.source_id === action.target_id) throw new Error(`Connection ${action.connection_id} cannot target itself.`);
      if ([...connectionById.values()].some((item) => item.source_id === action.source_id && item.target_id === action.target_id && item.connection_type === action.connection_type)) throw new Error(`Connection ${action.connection_id} duplicates an existing ${action.connection_type} edge.`);
      touch(action.source_id); touch(action.target_id); connections.add(action.connection_id); connectionById.set(action.connection_id, {
        id: action.connection_id, source_id: action.source_id, target_id: action.target_id, connection_type: action.connection_type, channel: action.channel,
      }); continue;
    }
    if (action.tool === 'create_joint') {
      assertReference(components, action.component_a, `Joint ${action.joint_id}`); assertReference(components, action.component_b, `Joint ${action.joint_id}`); if (action.component_a === action.component_b) throw new Error(`Joint ${action.joint_id} needs two bodies.`);
      if (Math.hypot(...action.axis) < .5 || (action.limits && action.limits[0] > action.limits[1])) throw new Error(`Joint ${action.joint_id} has an invalid axis or limits.`); if (['prismatic', 'spring', 'rope'].includes(action.joint_type) && !action.limits) throw new Error(`Joint ${action.joint_id} needs finite travel limits.`); if (['gear', 'belt'].includes(action.joint_type) && action.ratio <= 0) throw new Error(`Joint ${action.joint_id} needs a positive ratio.`);
      if (action.joint_type !== 'fixed' && bodyTypeById.get(action.component_a) === 'fixed' && bodyTypeById.get(action.component_b) === 'fixed') throw new Error(`Joint ${action.joint_id} cannot create motion between two fixed bodies.`);
      if ([...jointById.values()].some((joint) => new Set([joint.component_a, joint.component_b]).has(action.component_a) && new Set([joint.component_a, joint.component_b]).has(action.component_b))) throw new Error(`Joint ${action.joint_id} duplicates an existing joint between the same bodies.`);
      touch(action.component_a); touch(action.component_b); joints.add(action.joint_id); jointById.set(action.joint_id, {
        id: action.joint_id, joint_type: action.joint_type, component_a: action.component_a, component_b: action.component_b,
        axis: action.axis, limits: action.limits, ratio: action.ratio || null, stiffness: action.stiffness || null, damping: action.damping || null,
      }); continue;
    }
    if (action.tool === 'remove_joint') {
      assertReference(joints, action.joint_id, 'Remove joint'); touchJoint(action.joint_id);
      const removedMotorIds = new Set([...motorById].filter(([, item]) => item.joint_id === action.joint_id).map(([id]) => id));
      const removedActuatorIds = new Set([...actuatorById].filter(([, item]) => item.joint_id === action.joint_id).map(([id]) => id));
      for (const id of removedMotorIds) { const motor = motorById.get(id)!; touch(motor.component_id); motorById.delete(id); motors.delete(id); }
      for (const id of removedActuatorIds) { const actuator = actuatorById.get(id)!; touch(actuator.component_id); actuatorById.delete(id); actuators.delete(id); }
      for (const [id, control] of controlById) {
        const changed = control.actuator_ids.some((item) => removedActuatorIds.has(item));
        control.actuator_ids = control.actuator_ids.filter((item) => !removedActuatorIds.has(item));
        if (!control.sensor_ids.length && !control.actuator_ids.length) { controlById.delete(id); controls.delete(id); }
        else if (changed) touchControl(id);
      }
      joints.delete(action.joint_id); jointById.delete(action.joint_id); continue;
    }
    if (action.tool === 'add_motor') {
      assertReference(components, action.component_id, `Motor ${action.motor_id}`); assertReference(joints, action.joint_id, `Motor ${action.motor_id}`);
      if (primitiveById.get(action.component_id) !== 'motor') throw new Error(`Motor ${action.motor_id} must target a motor primitive.`);
      requireDrivenJoint(action.joint_id, `Motor ${action.motor_id}`);
      motorById.set(action.motor_id, { component_id: action.component_id, joint_id: action.joint_id }); motors.add(action.motor_id); touchMotor(action.motor_id); continue;
    }
    if (action.tool === 'set_motor_speed') { assertReference(motors, action.motor_id, 'Motor speed edit'); touchMotor(action.motor_id); continue; }
    if (action.tool === 'add_sensor') {
      assertReference(components, action.component_id, `Sensor ${action.sensor_id}`); assertReference(components, action.target_id, `Sensor ${action.sensor_id}`, true); if (!['sensor', 'camera'].includes(primitiveById.get(action.component_id) ?? '')) throw new Error(`Sensor ${action.sensor_id} needs a sensor or camera body.`);
      sensors.add(action.sensor_id); sensorById.set(action.sensor_id, { component_id: action.component_id, target_id: action.target_id }); touchSensor(action.sensor_id); continue;
    }
    if (action.tool === 'set_sensor_range') { assertReference(sensors, action.sensor_id, 'Sensor range edit'); touchSensor(action.sensor_id); continue; }
    if (action.tool === 'add_actuator') {
      assertReference(components, action.component_id, `Actuator ${action.actuator_id}`); assertReference(joints, action.joint_id, `Actuator ${action.actuator_id}`); if (!['motor', 'servo', 'piston'].includes(primitiveById.get(action.component_id) ?? '')) throw new Error(`Actuator ${action.actuator_id} needs a motor, servo, or piston body.`);
      requireDrivenJoint(action.joint_id, `Actuator ${action.actuator_id}`);
      actuators.add(action.actuator_id); actuatorById.set(action.actuator_id, { component_id: action.component_id, joint_id: action.joint_id }); touchActuator(action.actuator_id); continue;
    }
    if (action.tool === 'set_actuator_timing') { assertReference(actuators, action.actuator_id, 'Actuator timing edit'); touchActuator(action.actuator_id); continue; }
    if (action.tool === 'set_control_logic') {
      unique(action.sensor_ids, `Control ${action.control_id} sensor`); unique(action.actuator_ids, `Control ${action.control_id} actuator`);
      action.sensor_ids.forEach((id) => assertReference(sensors, id, `Control ${action.control_id}`)); action.actuator_ids.forEach((id) => assertReference(actuators, id, `Control ${action.control_id}`));
      if (!action.actuator_ids.length) throw new Error(`Control ${action.control_id} needs at least one actuator.`);
      if (action.mode !== 'timed' && !action.sensor_ids.length) throw new Error(`Control ${action.control_id} needs sensor feedback for ${action.mode} mode.`);
      controls.add(action.control_id); controlById.set(action.control_id, { sensor_ids: [...action.sensor_ids], actuator_ids: [...action.actuator_ids] }); touchControl(action.control_id); continue;
    }
    if (action.tool === 'update_control_logic') { assertReference(controls, action.control_id, 'Control edit'); touchControl(action.control_id); continue; }
    const exhaustive: never = action; throw new Error(`Unsupported edit action ${String(exhaustive)}`);
  }
  const projectedCount = components.size; if (projectedCount > context.max_components) throw new Error('The edit exceeds the component budget.');
  if (!projectedCount) throw new Error('A chat edit cannot delete the entire engineered world; use Reset instead.');
  if (![...components].some((id) => bodyTypeById.get(id) === 'fixed')) throw new Error('The edit would leave the machine without a grounded fixed body.');
  const freeTags = new Set(['payload', 'package-red', 'package-blue', 'shipping-carton', 'tomato-ripe', 'tomato-reject', 'metal-can', 'plastic-bottle', 'reject-object']);
  for (const action of edit.actions.filter((item): item is Extract<AgentEditAction, { tool: 'create_component' }> => item.tool === 'create_component')) {
    if (!components.has(action.component_id) || action.semantic_tags.some((tag) => freeTags.has(tag))) continue;
    const hasJoint = [...jointById.values()].some((item) => item.component_a === action.component_id || item.component_b === action.component_id);
    const hasMechanicalEdge = [...connectionById.values()].some((item) => item.connection_type === 'mechanical' && (item.source_id === action.component_id || item.target_id === action.component_id));
    if (!hasJoint && !hasMechanicalEdge) throw new Error(`Created component ${action.component_id} needs a physical connection or joint in the same atomic edit.`);
  }
  const reachable = reachableFromFixed(components, jointById);
  const freeProductForms = new Set(['package-red', 'package-blue', 'shipping-carton', 'tomato', 'metal-can', 'plastic-bottle', 'reject-object']);
  const intentionallyFree = (id: string) => {
    if (createdTagsById.get(id)?.some((tag) => freeTags.has(tag))) return true;
    const parameters = parametersById.get(id) ?? {};
    return parameters.semantic_payload === true || (typeof parameters.product_form === 'string' && freeProductForms.has(parameters.product_form));
  };
  const orphan = [...components].find((id) => bodyTypeById.get(id) !== 'fixed' && !reachable.has(id) && !intentionallyFree(id) && (!existing.components.has(id) || baselineReachable.has(id)));
  if (orphan) throw new Error(`The edit would leave component ${orphan} mechanically disconnected from every grounded body.`);
  edit.target_ids.forEach((id) => assertReference(new Set([...existing.components, ...created.components]), id, 'Resolved target'));
  for (const id of edit.target_ids) if (!touched.has(id)) throw new Error(`Resolved target ${id} is not changed by any proposed action.`);
  if ([...preserved].some((id) => touched.has(id))) throw new Error('target_ids and preserve_ids must be disjoint.');
  return edit;
}

function normalizeOpenAiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeOpenAiSchema);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === '$schema' || key === 'prefixItems' || key === 'oneOf') continue;
    normalized[key] = normalizeOpenAiSchema(child);
  }
  if (Array.isArray(source.oneOf)) normalized.anyOf = normalizeOpenAiSchema(source.oneOf);
  if (Array.isArray(source.prefixItems)) {
    const items = source.prefixItems.map(normalizeOpenAiSchema);
    normalized.items = items.length && items.every((item) => JSON.stringify(item) === JSON.stringify(items[0])) ? items[0] : { anyOf: items };
    normalized.minItems = items.length;
    normalized.maxItems = items.length;
  }
  return normalized;
}

function openAiSchema(schema: z.ZodType) { return normalizeOpenAiSchema(z.toJSONSchema(schema)) as Record<string, unknown>; }
export const AGENT_PLAN_JSON_SCHEMA = openAiSchema(agentPlanSchema);
export const AGENT_INTENT_JSON_SCHEMA = openAiSchema(agentIntentSchema);
export const AGENT_REDESIGN_JSON_SCHEMA = openAiSchema(agentRedesignSchema);
export const AGENT_EDIT_JSON_SCHEMA = openAiSchema(agentEditSchema);
