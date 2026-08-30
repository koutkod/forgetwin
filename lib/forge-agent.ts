import { z } from 'zod';
import { SUPPORTED_METRIC_KEYS } from './forge-metrics';

const conciseText = z.string().trim().min(1).max(500);
const identifier = z.string().trim().regex(/^[a-z][a-z0-9-]{0,63}$/);
const channelKey = z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const supportedMetric = z.enum(SUPPORTED_METRIC_KEYS);
const capability = z.enum(['structure', 'transport', 'classify', 'lift', 'suspend', 'mobile', 'manipulate', 'transmit', 'stabilize', 'track', 'buffer', 'contain', 'rotate', 'measure']);
const primitiveKind = z.enum(['beam', 'plate', 'frame', 'wheel', 'shaft', 'gear', 'pulley', 'belt', 'motor', 'servo', 'piston', 'spring', 'sensor', 'camera', 'light', 'conveyor', 'ramp', 'gripper', 'container', 'counterweight', 'support', 'controller', 'cable', 'hook', 'roller']);
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
  target_ids: z.array(identifier).max(12),
  preserve_ids: z.array(identifier).max(40),
  requested_invariants: z.array(z.string().trim().min(1).max(140)).max(12),
  actions: z.array(editActionSchema).max(16),
  verification: z.array(z.string().trim().min(1).max(140)).max(8),
}).strict();

const agentStatusSchema = z.object({ ok: z.literal(true), configured: z.boolean(), model: z.string().min(1).max(100) }).strict();
const agentConnectionSchema = z.object({ ok: z.literal(true), configured: z.literal(true), model: z.string().min(1).max(100) }).strict();
const agentPlanResponseSchema = z.object({ ok: z.literal(true), mode: z.literal('model'), model: z.string().min(1).max(100), result: agentPlanSchema }).strict();
const agentRedesignResponseSchema = z.object({ ok: z.literal(true), mode: z.literal('model'), model: z.string().min(1).max(100), result: agentRedesignSchema }).strict();
const agentEditResponseSchema = z.object({ ok: z.literal(true), mode: z.literal('model'), model: z.string().min(1).max(100), result: agentEditSchema }).strict();

export type AgentPlan = z.infer<typeof agentPlanSchema>;
export type AgentRedesign = z.infer<typeof agentRedesignSchema>;
export type AgentEdit = z.infer<typeof agentEditSchema>;
export type AgentEditAction = z.infer<typeof agentEditActionSchema>;
export type AgentRuntimeMode = 'session-model' | 'deterministic';

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
async function readJson(response: Response) { const payload = await response.json().catch(() => null) as { code?: unknown; error?: unknown } | null; if (!response.ok) { const code = typeof payload?.code === 'string' ? payload.code : 'AGENT_REQUEST_FAILED'; const message = typeof payload?.error === 'string' ? payload.error : 'The model agent could not complete this request.'; throw new AgentRequestError(code, message, response.status); } return payload; }
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
  { requested: /\b(?:bearing)\b/, designed: /\bbearing\b/ },
  { requested: /\b(?:duct|air duct)\b/, designed: /\bduct\b/ },
  { requested: /\b(?:brazed plate|plate heat exchanger|heat exchanger|bphe)\b/, designed: /\b(?:heat exchanger|brazed plate|transfer plate|bphe)\b/ },
  { requested: /\b(?:fixture|jig)\b/, designed: /\b(?:fixture|jig)\b/ },
  { requested: /\b(?:bench vise|vise)\b/, designed: /\bvise\b/ },
  { requested: /\b(?:bicycle|bike)\s+(?:suspension\s+)?fork\b/, designed: /\b(?:bicycle|bike|suspension)\s+fork\b|\bfork\b/ },
  { requested: /\b(?:car jack|patient lift|lift|elevator|hoist)\b/, designed: /\b(?:jack|lift|elevator|hoist)\b/ },
  { requested: /\b(?:crane)\b/, designed: /\b(?:crane|boom|hoist)\b/ },
  { requested: /\b(?:go-kart|gokart|go cart|kart)\b/, designed: /\b(?:go-kart|gokart|kart)\b/ },
  { requested: /\b(?:bicycle|bike)\b/, designed: /\b(?:bicycle|bike)\b/ },
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
  const hasDrive = plan.motors.length > 0 || plan.actuators.length > 0;
  const requireSignature = (condition: boolean, description: string) => { if (!condition) throw new Error(`The design graph lacks the physical signature of the requested object: ${description}.`); };

  const bicycleFork = /\b(?:bicycle|bike)\s+(?:suspension\s+)?fork\b/.test(requested);
  const vehicleSuspension = /\b(?:car|automotive|vehicle|rover)\s+suspension\b|\bsuspension\b[^.]{0,28}\b(?:for|of)\s+(?:an?\s+)?(?:car|vehicle|rover)\b/.test(requested);
  const vehicleChassis = /\b(?:car|automotive|vehicle|rover|go-kart|gokart|kart)\s+(?:chassis|frame)\b/.test(requested);
  const vehicleWheel = /\b(?:car|automotive|vehicle|rover|go-kart|gokart|kart)\s+(?:road\s+)?wheel\b/.test(requested);
  const vehicleAxle = /\b(?:car|automotive|vehicle|rover|go-kart|gokart|kart)\s+(?:drive\s+)?axle\b/.test(requested);
  const cranePart = requested.match(/\bcrane\s+(hook|boom|jib|pulley|counterweight)\b/)?.[1];
  const pumpHousing = /\b(?:centrifugal\s+|reciprocating\s+|piston\s+)?pump\s+(?:housing|casing|enclosure)\b/.test(requested);
  const transmissionHousing = /\b(?:gearbox|transmission)\s+(?:housing|casing|enclosure)\b/.test(requested);

  if (cranePart === 'hook') requireSignature(count('hook') >= 1, 'a recognizable load hook');
  if (cranePart === 'boom' || cranePart === 'jib') requireSignature(count('beam') + count('frame') >= 1 && /boom|jib/.test(roles), 'a structural crane boom or jib');
  if (cranePart === 'pulley') requireSignature(count('pulley') >= 1, 'a grooved crane pulley');
  if (cranePart === 'counterweight') requireSignature(count('counterweight') >= 1, 'a crane counterweight body');
  if (pumpHousing || transmissionHousing) requireSignature(count('plate') + count('frame') + count('support') >= 1 && /housing|casing|enclosure|shell/.test(roles), 'a dimensioned housing or casing body');
  if (vehicleChassis) requireSignature(count('frame') + count('beam') + count('plate') >= 2 && /chassis|frame|rail/.test(roles), 'a load-bearing chassis frame');
  if (vehicleWheel) requireSignature(count('wheel') >= 1, 'a road wheel and hub body');
  if (vehicleAxle) requireSignature(count('shaft') >= 1, 'a supported axle shaft');
  if (bicycleFork) requireSignature(count('beam') + count('frame') >= 2 && /fork|stanchion|steerer/.test(roles), 'paired fork members and a steerer or crown');
  if (vehicleSuspension) requireSignature(count('spring') >= 1 && count('beam') + count('frame') + count('wheel') >= 1, 'a compliant suspension member connected to an arm, frame, or wheel');

  if (/\bcrane\b/.test(requested) && !cranePart) {
    requireSignature(count('beam') + count('frame') + count('support') >= 2, 'a supported mast or boom structure');
    requireSignature(count('hook') + count('cable') + count('pulley') >= 1, 'a hook, cable, or pulley load path');
    requireSignature(hasDrive, 'a driven hoist or boom actuator');
  }
  if (/\b(?:bench vise|vise)\b/.test(requested)) {
    requireSignature(count('plate') + count('beam') + count('support') >= 2 && (count('shaft') + count('piston') + count('servo') >= 1), 'opposed jaws and a screw or linear clamp drive');
  }
  if (/\b(?:go-kart|gokart|go cart|kart|car|automobile|buggy|rover|agv|vehicle)\b/.test(requested) && !/\bcar\s+(?:jack|lift|hoist)\b/.test(requested) && !vehicleSuspension && !vehicleChassis && !vehicleWheel && !vehicleAxle) {
    requireSignature(count('wheel') >= 3, 'a multi-wheel rolling chassis');
    requireSignature(count('frame') + count('plate') + count('beam') >= 1, 'a load-bearing chassis');
    requireSignature(hasDrive, 'a wheel or axle drive');
  }
  if (/\b(?:bicycle|bike)\b/.test(requested) && !bicycleFork) {
    requireSignature(count('wheel') >= 2 && count('beam') + count('frame') >= 2, 'two wheels and a recognizable frame');
    requireSignature(hasDrive, 'a crank, chain, or wheel drive');
  }
  if (/\b(?:gearbox|gear train|transmission)\b/.test(requested) && !transmissionHousing) {
    requireSignature(count('gear') >= 2 && count('shaft') >= 1, 'at least two meshing gears on supported shafts');
    requireSignature(hasDrive, 'a driven input shaft');
  }
  if (/\b(?:robotic arm|robot arm|manipulator)\b/.test(requested)) {
    requireSignature(count('beam') >= 2 && count('gripper') >= 1, 'an articulated link chain and end effector');
    requireSignature(plan.actuators.length >= 2, 'multiple actuated joints');
  }
  if (/\bsuspension\b/.test(requested) && !bicycleFork && !vehicleSuspension) requireSignature(count('spring') >= 1 && count('beam') + count('frame') + count('wheel') >= 1, 'a compliant member connected into a supported mechanism');
  if (/\b(?:solar tracker|track(?:ing)? (?:the )?sun)\b/.test(requested)) {
    requireSignature(count('plate') + count('frame') >= 1 && /solar|panel|array/.test(roles), 'a framed solar panel or array');
    requireSignature(hasDrive && count('sensor') + count('camera') >= 1, 'a tracking drive and light feedback');
  }
  if (/\bdrawbridge\b/.test(requested)) {
    requireSignature(count('beam') + count('plate') >= 2 && plan.joints.some((item) => item.joint_type === 'revolute'), 'a hinged structural span');
    requireSignature(count('counterweight') + count('pulley') + count('cable') >= 1 && hasDrive, 'a counterbalanced or cable drive');
  } else if (/\b(?:bridge|truss)\b/.test(requested)) {
    requireSignature(count('beam') + count('plate') >= 3 && count('support') >= 1, 'a supported structural deck or truss');
  }
  if (/\b(?:centrifugal pump|reciprocating pump|piston pump|pump)\b/.test(requested) && !pumpHousing) {
    requireSignature(count('piston') + count('shaft') + count('gear') >= 1 && hasDrive, 'a driven impeller, shaft, or reciprocating pumping element');
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
  }
}

function validateExplicitRequirements(plan: AgentPlan, requested: string) {
  const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };
  const numberToken = '(\\d[\\d,]*(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)';
  const valueOf = (value: string) => numberWords[value.toLowerCase()] ?? Number(value.replaceAll(',', ''));
  const unitOf = (value: string) => {
    const unit = value.toLowerCase().replaceAll(' ', '').replaceAll('²', '2').replace(/[·⋅*.-]/g, '');
    if (unit === 'kg' || unit.startsWith('kilogram')) return 'kg';
    if (unit === 'm' || unit.startsWith('meter') || unit.startsWith('metre')) return 'm';
    if (unit === 'cm' || unit.startsWith('centimeter') || unit.startsWith('centimetre')) return 'cm';
    if (unit === 'nm' || unit.startsWith('newtonmeter') || unit.startsWith('newtonmetre')) return 'nm';
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
  if (reach) expectTarget(valueOf(reach[1]), ['reach', 'span'], 'reach or span', 'min', ['m']);

  const actionLoad = requested.match(new RegExp(`\\b(?:lift|raise|carry|carries|carrying|support|supports|hoist)\\b[^,.]{0,75}?${numberToken}\\s*(kg|kilograms?)\\b`));
  const labelledLoad = requested.match(new RegExp(`${numberToken}\\s*(kg|kilograms?)\\s+(?:(?:rated|moving|patient|payload|design)\\s+){0,2}(?:payload|load|patient|beam)\\b`));
  const load = actionLoad ?? labelledLoad;
  if (load) expectTarget(valueOf(load[1]), ['payload_capacity', 'load_capacity'], 'load target', 'min', ['kg']);

  const throughput = requested.match(new RegExp(`${numberToken}\\s*\\+?\\s*(?:boxes?|packages?|parts?|items?|objects?)?\\s*(?:per\\s+minute|/\\s*min)\\b`));
  if (throughput) expectTarget(valueOf(throughput[1]), ['throughput'], 'throughput', 'min', ['/min']);

  const componentLimit = requested.match(new RegExp(`(?:no more than|at most|maximum|max(?:imum)? of)\\s+${numberToken}\\s+(?:physical\\s+)?components?\\b`));
  if (componentLimit) expectTarget(valueOf(componentLimit[1]), ['component_count'], 'component-count limit', 'max', ['']);

  const accuracy = requested.match(new RegExp(`${numberToken}\\s*(%|percent)\\s+(?:sorting\\s+accuracy|accuracy|successful\\s+(?:sorting|separation))\\b`));
  if (accuracy) expectTarget(valueOf(accuracy[1]), ['sorting_accuracy'], 'sorting-accuracy', 'min', ['%']);

  const tilt = requested.match(new RegExp(`(?:tilt|tilting)[^.]{0,35}?(?:below|under|less than|no more than|at most)\\s*${numberToken}\\s*(°|degrees?)\\b`));
  if (tilt) expectTarget(valueOf(tilt[1]), ['platform_tilt'], 'tilt limit', 'max', ['deg']);

  const drop = requested.match(new RegExp(`(?:drop|dropping|dropped)[^.]{0,45}?(?:below|under|less than|no more than|at most)\\s*${numberToken}\\s*(m|meters?|metres?|cm|centimeters?|centimetres?)\\b`));
  if (drop) {
    const distance = valueOf(drop[1]); const unit = unitOf(drop[2]);
    expectTarget(unit === 'm' ? distance * 100 : distance, ['drop_height'], 'drop-height limit', 'max', ['cm']);
  }
}

function validatePromptFidelity(plan: AgentPlan, originalPrompt: string) {
  const requested = originalPrompt.toLowerCase();
  const designed = [plan.machine_name, ...plan.architecture, ...plan.assemblies.flatMap((item) => [item.name, item.purpose]), ...plan.components.map((item) => item.role)].join(' ').toLowerCase();
  const identity = identityChecks.find((item) => item.requested.test(requested));
  if (identity && !identity.designed.test(designed)) throw new Error('The design graph does not preserve the user’s requested mechanical object identity.');
  if (!identity) {
    const head = requested.replace(/^(?:please\s+)?(?:build|design|create|engineer|make)\s+(?:an?|the)?\s*/, '').split(/\b(?:that|which|while|using|with|to)\b/)[0];
    const ignored = new Set(['machine', 'mechanism', 'system', 'device', 'tool', 'part', 'mechanical', 'physical', 'automatic', 'powered', 'good']);
    const tokens = head.match(/[a-z][a-z-]{3,}/g)?.filter((token) => !ignored.has(token)) ?? [];
    if (tokens.length && !tokens.some((token) => designed.includes(token) || (token.endsWith('s') && designed.includes(token.slice(0, -1))))) throw new Error('The design graph does not preserve the main object named in the user goal.');
  }
  const primitiveNames: Record<string, string> = { wheel: 'wheel', wheels: 'wheel', gear: 'gear', gears: 'gear', sensor: 'sensor', sensors: 'sensor', motor: 'motor', motors: 'motor', servo: 'servo', servos: 'servo', piston: 'piston', pistons: 'piston', spring: 'spring', springs: 'spring', bin: 'container', bins: 'container', container: 'container', containers: 'container', ramp: 'ramp', ramps: 'ramp', pulley: 'pulley', pulleys: 'pulley', headlight: 'light', headlights: 'light' };
  const countWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  const quantityPattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+)\s+(wheels?|gears?|sensors?|motors?|servos?|pistons?|springs?|bins?|containers?|ramps?|pulleys?|headlights?)\b/g;
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
  unique(plan.connections.map((item) => `${item.connection_type}|${[item.source_id, item.target_id].sort().join('|')}|${item.channel}`), 'Connection edge');
  for (const item of plan.connections) { assertReference(componentIds, item.source_id, `Connection ${item.id}`); assertReference(componentIds, item.target_id, `Connection ${item.id}`); if (item.source_id === item.target_id) throw new Error(`Connection ${item.id} cannot target itself.`); }
  for (const item of plan.joints) { assertReference(componentIds, item.component_a, `Joint ${item.id}`); assertReference(componentIds, item.component_b, `Joint ${item.id}`); if (item.component_a === item.component_b) throw new Error(`Joint ${item.id} needs two bodies.`); if (Math.hypot(...item.axis) < .5) throw new Error(`Joint ${item.id} needs a non-zero axis.`); if (item.limits && item.limits[0] > item.limits[1]) throw new Error(`Joint ${item.id} has reversed limits.`); if (['prismatic', 'spring', 'rope'].includes(item.joint_type) && !item.limits) throw new Error(`Joint ${item.id} needs finite travel limits.`); if (['gear', 'belt'].includes(item.joint_type) && item.ratio <= 0) throw new Error(`Joint ${item.id} needs a positive ratio.`); }
  for (const item of plan.motors) { assertReference(componentIds, item.component_id, `Motor ${item.id}`); assertReference(jointIds, item.joint_id, `Motor ${item.id}`, true); if (plan.components.find((part) => part.id === item.component_id)?.primitive !== 'motor') throw new Error(`Motor ${item.id} must target a motor primitive.`); }
  for (const item of plan.sensors) { assertReference(componentIds, item.component_id, `Sensor ${item.id}`); assertReference(componentIds, item.target_id, `Sensor ${item.id}`, true); if (!['sensor', 'camera'].includes(plan.components.find((part) => part.id === item.component_id)?.primitive ?? '')) throw new Error(`Sensor ${item.id} must target a sensor or camera primitive.`); }
  for (const item of plan.actuators) { assertReference(componentIds, item.component_id, `Actuator ${item.id}`); assertReference(jointIds, item.joint_id, `Actuator ${item.id}`); if (!['motor', 'servo', 'piston'].includes(plan.components.find((part) => part.id === item.component_id)?.primitive ?? '')) throw new Error(`Actuator ${item.id} needs a motor, servo, or piston body.`); }
  for (const item of plan.controls) { item.sensor_ids.forEach((id) => assertReference(sensorIds, id, `Control ${item.id}`)); item.actuator_ids.forEach((id) => assertReference(actuatorIds, id, `Control ${item.id}`)); }
  assertReference(componentIds, plan.editable_component_id, 'Editable component');
  if (!plan.components.some((item) => item.body_type === 'fixed')) throw new Error('The design needs at least one grounded fixed body.');
  if (plan.components.length > 2 && !plan.connections.length && !plan.joints.length) throw new Error('The design is an unconnected parts pile.');
  const adjacency = new Map(plan.components.map((item) => [item.id, new Set<string>()]));
  for (const joint of plan.joints) { adjacency.get(joint.component_a)!.add(joint.component_b); adjacency.get(joint.component_b)!.add(joint.component_a); }
  const reachable = new Set(plan.components.filter((item) => item.body_type === 'fixed').map((item) => item.id));
  const queue = [...reachable];
  while (queue.length) for (const neighbor of adjacency.get(queue.shift()!) ?? []) if (!reachable.has(neighbor)) { reachable.add(neighbor); queue.push(neighbor); }
  const intentionallyFree = new Set(['payload', 'package-red', 'package-blue', 'shipping-carton', 'tomato-ripe', 'tomato-reject', 'metal-can', 'plastic-bottle', 'reject-object']);
  const orphan = plan.components.find((item) => !reachable.has(item.id) && !item.semantic_tags.some((tag) => intentionallyFree.has(tag)));
  if (orphan) throw new Error(`Component ${orphan.id} is not mechanically reachable from a grounded body.`);
  const active = plan.capabilities.some((item) => ['transport', 'lift', 'mobile', 'manipulate', 'transmit', 'track', 'rotate'].includes(item));
  const bodyById = new Map(plan.components.map((item) => [item.id, item]));
  const motionJointIds = new Set(plan.joints.filter((joint) => joint.joint_type !== 'fixed'
    && [bodyById.get(joint.component_a), bodyById.get(joint.component_b)].some((body) => body?.body_type !== 'fixed')).map((joint) => joint.id));
  const hasDrivenPath = plan.actuators.some((actuator) => motionJointIds.has(actuator.joint_id))
    || plan.motors.some((motor) => motionJointIds.has(motor.joint_id));
  if (active && !hasDrivenPath) throw new Error('An active machine needs a motor or actuator connected to the mechanism it drives.');
  if (originalPrompt) validatePromptFidelity(plan, originalPrompt);
  return plan;
}

export function validateAgentEditSemantics(edit: AgentEdit, context: EditContext) {
  if (edit.needs_clarification) {
    if (!edit.clarification_question || edit.actions.length) throw new Error('A clarification response needs one question and zero actions.');
    return edit;
  }
  if (!edit.actions.length) throw new Error('A resolved edit needs at least one guarded action.');

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
  const motorComponentById = new Map(context.motors.map((item) => [item.id, item.component_id]));
  const sensorComponentById = new Map(context.sensors.map((item) => [item.id, item.component_id]));
  const actuatorComponentById = new Map(context.actuators.map((item) => [item.id, item.component_id]));
  const locked = new Map(context.components.map((item) => [item.id, new Set(item.human_locked_fields)]));
  const preserved = new Set(edit.preserve_ids); const declaredTargets = new Set(edit.target_ids); const touched = new Set<string>();
  edit.preserve_ids.forEach((id) => assertReference(existing.components, id, 'Preserved component'));
  const touch = (id: string) => { touched.add(id); if (!declaredTargets.has(id)) throw new Error(`Touched component ${id} must be declared in target_ids.`); if (preserved.has(id)) throw new Error(`Edit cannot change preserved component ${id}.`); };
  const mutableField = (id: string, field: string) => { assertReference(components, id, `Edit ${field}`); touch(id); if (locked.get(id)?.has(field)) throw new Error(`Edit would overwrite human-locked ${field} on ${id}.`); };

  for (const action of edit.actions) {
    if (action.tool === 'create_assembly') { if (action.parent_id) assertReference(assemblies, action.parent_id, `Assembly ${action.assembly_id}`); assemblies.add(action.assembly_id); continue; }
    if (action.tool === 'create_component') {
      assertReference(assemblies, action.assembly_id, `Component ${action.component_id}`); touch(action.component_id);
      if (action.position.some((value, index) => Math.abs(value) > context.world.bounds[index] / 2)) throw new Error(`Component ${action.component_id} is outside the current world bounds.`);
      if (action.rotation.some((value) => Math.abs(value) > Math.PI * 2)) throw new Error(`Component ${action.component_id} rotation must stay within ±2π radians.`);
      components.add(action.component_id); primitiveById.set(action.component_id, action.primitive); continue;
    }
    if (action.tool === 'set_dimensions') { mutableField(action.component_id, 'dimensions'); continue; }
    if (action.tool === 'set_material') { mutableField(action.component_id, 'material'); continue; }
    if (action.tool === 'set_mass') { mutableField(action.component_id, 'mass'); continue; }
    if (action.tool === 'move_component') {
      mutableField(action.component_id, 'position');
      context.joints.filter((item) => item.component_a === action.component_id || item.component_b === action.component_id).forEach((item) => touch(item.component_a === action.component_id ? item.component_b : item.component_a));
      if (action.position.some((value, index) => Math.abs(value) > context.world.bounds[index] / 2)) throw new Error(`${action.component_id} would leave the current world bounds.`); continue;
    }
    if (action.tool === 'rotate_component') {
      mutableField(action.component_id, 'rotation');
      context.joints.filter((item) => item.component_a === action.component_id || item.component_b === action.component_id).forEach((item) => touch(item.component_a === action.component_id ? item.component_b : item.component_a));
      if (action.rotation.some((value) => Math.abs(value) > Math.PI * 2)) throw new Error(`${action.component_id} rotation must stay within ±2π radians.`); continue;
    }
    if (action.tool === 'remove_component') {
      mutableField(action.component_id, 'remove');
      const attachedJoints = context.joints.filter((item) => item.component_a === action.component_id || item.component_b === action.component_id);
      const attachedJointIds = new Set(attachedJoints.map((item) => item.id));
      for (const joint of attachedJoints) touch(joint.component_a === action.component_id ? joint.component_b : joint.component_a);
      for (const edge of context.connections.filter((item) => item.source_id === action.component_id || item.target_id === action.component_id)) touch(edge.source_id === action.component_id ? edge.target_id : edge.source_id);
      for (const sensor of context.sensors.filter((item) => item.target_id === action.component_id && item.component_id !== action.component_id)) touch(sensor.component_id);
      for (const motor of context.motors.filter((item) => item.component_id !== action.component_id && Boolean(item.joint_id) && attachedJointIds.has(item.joint_id))) touch(motor.component_id);
      for (const actuator of context.actuators.filter((item) => item.component_id !== action.component_id && attachedJointIds.has(item.joint_id))) touch(actuator.component_id);
      components.delete(action.component_id); primitiveById.delete(action.component_id); attachedJoints.forEach((item) => joints.delete(item.id)); continue;
    }
    if (action.tool === 'connect_components') { assertReference(components, action.source_id, `Connection ${action.connection_id}`); assertReference(components, action.target_id, `Connection ${action.connection_id}`); if (action.source_id === action.target_id) throw new Error(`Connection ${action.connection_id} cannot target itself.`); touch(action.source_id); touch(action.target_id); connections.add(action.connection_id); continue; }
    if (action.tool === 'create_joint') {
      assertReference(components, action.component_a, `Joint ${action.joint_id}`); assertReference(components, action.component_b, `Joint ${action.joint_id}`); if (action.component_a === action.component_b) throw new Error(`Joint ${action.joint_id} needs two bodies.`);
      if (Math.hypot(...action.axis) < .5 || (action.limits && action.limits[0] > action.limits[1])) throw new Error(`Joint ${action.joint_id} has an invalid axis or limits.`); if (['prismatic', 'spring', 'rope'].includes(action.joint_type) && !action.limits) throw new Error(`Joint ${action.joint_id} needs finite travel limits.`); if (['gear', 'belt'].includes(action.joint_type) && action.ratio <= 0) throw new Error(`Joint ${action.joint_id} needs a positive ratio.`);
      touch(action.component_a); touch(action.component_b); joints.add(action.joint_id); continue;
    }
    if (action.tool === 'remove_joint') { assertReference(joints, action.joint_id, 'Remove joint'); const joint = context.joints.find((item) => item.id === action.joint_id); if (joint) { touch(joint.component_a); touch(joint.component_b); } joints.delete(action.joint_id); continue; }
    if (action.tool === 'add_motor') { assertReference(components, action.component_id, `Motor ${action.motor_id}`); assertReference(joints, action.joint_id, `Motor ${action.motor_id}`, true); if (primitiveById.get(action.component_id) !== 'motor') throw new Error(`Motor ${action.motor_id} must target a motor primitive.`); touch(action.component_id); motors.add(action.motor_id); motorComponentById.set(action.motor_id, action.component_id); continue; }
    if (action.tool === 'set_motor_speed') { assertReference(motors, action.motor_id, 'Motor speed edit'); touch(motorComponentById.get(action.motor_id)!); continue; }
    if (action.tool === 'add_sensor') { assertReference(components, action.component_id, `Sensor ${action.sensor_id}`); assertReference(components, action.target_id, `Sensor ${action.sensor_id}`, true); if (!['sensor', 'camera'].includes(primitiveById.get(action.component_id) ?? '')) throw new Error(`Sensor ${action.sensor_id} needs a sensor or camera body.`); touch(action.component_id); sensors.add(action.sensor_id); sensorComponentById.set(action.sensor_id, action.component_id); continue; }
    if (action.tool === 'set_sensor_range') { assertReference(sensors, action.sensor_id, 'Sensor range edit'); touch(sensorComponentById.get(action.sensor_id)!); continue; }
    if (action.tool === 'add_actuator') { assertReference(components, action.component_id, `Actuator ${action.actuator_id}`); assertReference(joints, action.joint_id, `Actuator ${action.actuator_id}`); if (!['motor', 'servo', 'piston'].includes(primitiveById.get(action.component_id) ?? '')) throw new Error(`Actuator ${action.actuator_id} needs a motor, servo, or piston body.`); touch(action.component_id); actuators.add(action.actuator_id); actuatorComponentById.set(action.actuator_id, action.component_id); continue; }
    if (action.tool === 'set_actuator_timing') { assertReference(actuators, action.actuator_id, 'Actuator timing edit'); touch(actuatorComponentById.get(action.actuator_id)!); continue; }
    if (action.tool === 'set_control_logic') { action.sensor_ids.forEach((id) => assertReference(sensors, id, `Control ${action.control_id}`)); action.actuator_ids.forEach((id) => assertReference(actuators, id, `Control ${action.control_id}`)); controls.add(action.control_id); continue; }
    if (action.tool === 'update_control_logic') { assertReference(controls, action.control_id, 'Control edit'); continue; }
    const exhaustive: never = action; throw new Error(`Unsupported edit action ${String(exhaustive)}`);
  }
  const projectedCount = components.size; if (projectedCount > context.max_components) throw new Error('The edit exceeds the component budget.');
  const newlyLinked = new Set(edit.actions.flatMap((action) => action.tool === 'connect_components'
    ? [action.source_id, action.target_id]
    : action.tool === 'create_joint' ? [action.component_a, action.component_b] : []));
  const freeTags = new Set(['payload', 'package-red', 'package-blue', 'shipping-carton', 'tomato-ripe', 'tomato-reject', 'metal-can', 'plastic-bottle', 'reject-object']);
  for (const action of edit.actions.filter((item): item is Extract<AgentEditAction, { tool: 'create_component' }> => item.tool === 'create_component')) {
    if (!action.semantic_tags.some((tag) => freeTags.has(tag)) && !newlyLinked.has(action.component_id)) throw new Error(`Created component ${action.component_id} needs a physical connection or joint in the same atomic edit.`);
  }
  edit.target_ids.forEach((id) => assertReference(new Set([...existing.components, ...created.components]), id, 'Resolved target'));
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
export const AGENT_REDESIGN_JSON_SCHEMA = openAiSchema(agentRedesignSchema);
export const AGENT_EDIT_JSON_SCHEMA = openAiSchema(agentEditSchema);
