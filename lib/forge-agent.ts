import { z } from 'zod';
import { SUPPORTED_METRIC_KEYS } from './forge-metrics';

const conciseText = z.string().trim().min(1).max(500);
const supportedMetric = z.enum(SUPPORTED_METRIC_KEYS);

export const agentPlanSchema = z.object({
  normalized_prompt: z.string().trim().min(12).max(500),
  reasoning_summary: z.string().trim().min(12).max(700),
  architecture: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  assumptions: z.array(z.string().trim().min(1).max(180)).max(8),
  verification_focus: z.array(supportedMetric).min(1).max(8),
}).strict();

export const redesignStepSchema = z.object({
  tool: z.enum(['inspect_telemetry', 'inspect_failure', 'measure_constraint', 'optimize_design', 'run_simulation']),
  metric: z.union([supportedMetric, z.literal('')]),
  objective: z.string().trim().max(120),
}).strict();

export const agentRedesignSchema = z.object({
  diagnosis: z.string().trim().min(8).max(700),
  objective: z.string().trim().min(8).max(120),
  tool_sequence: z.array(redesignStepSchema).min(1).max(8),
}).strict();

const editTool = z.enum(['set_dimensions', 'set_material', 'set_mass', 'move_component', 'rotate_component', 'create_component', 'remove_component', 'connect_components', 'create_joint']);
const primitiveKind = z.enum(['beam', 'plate', 'frame', 'wheel', 'shaft', 'gear', 'pulley', 'belt', 'motor', 'servo', 'piston', 'spring', 'sensor', 'camera', 'light', 'conveyor', 'ramp', 'gripper', 'container', 'counterweight', 'support', 'controller', 'cable', 'hook', 'roller']);
const bodyType = z.enum(['fixed', 'dynamic', 'kinematic']);
const materialId = z.enum(['steel', 'aluminum', 'polymer', 'rubber', 'concrete', 'composite']);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const agentEditActionSchema = z.object({
  tool: editTool,
  component_id: z.string().trim().max(64),
  assembly_id: z.string().trim().max(64),
  primitive: primitiveKind,
  role: z.string().trim().max(100),
  position: vec3,
  rotation: vec3,
  dimensions: vec3,
  material_id: materialId,
  body_type: bodyType,
  mass: z.number().finite().min(0).max(1000000),
  source_id: z.string().trim().max(64),
  target_id: z.string().trim().max(64),
  connection_type: z.enum(['mechanical', 'power', 'signal']),
  channel: z.string().trim().max(64),
  joint_id: z.string().trim().max(64),
  joint_type: z.enum(['fixed', 'revolute', 'prismatic', 'spherical']),
  axis: vec3,
  limits: z.tuple([z.number().finite(), z.number().finite()]),
}).strict();

export const agentEditSchema = z.object({
  summary: z.string().trim().min(8).max(500),
  actions: z.array(agentEditActionSchema).min(1).max(12),
}).strict();

const agentStatusSchema = z.object({
  ok: z.literal(true),
  configured: z.boolean(),
  model: z.string().min(1).max(100),
}).strict();

const agentPlanResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.literal('model'),
  model: z.string().min(1).max(100),
  result: agentPlanSchema,
}).strict();

const agentRedesignResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.literal('model'),
  model: z.string().min(1).max(100),
  result: agentRedesignSchema,
}).strict();

const agentEditResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.literal('model'),
  model: z.string().min(1).max(100),
  result: agentEditSchema,
}).strict();

export type AgentPlan = z.infer<typeof agentPlanSchema>;
export type AgentRedesign = z.infer<typeof agentRedesignSchema>;
export type AgentEdit = z.infer<typeof agentEditSchema>;
export type AgentEditAction = z.infer<typeof agentEditActionSchema>;
export type AgentRuntimeMode = 'checking' | 'server-model' | 'session-model' | 'deterministic';

export function normalizeRedesignSequence(decision: AgentRedesign) {
  const evidence = decision.tool_sequence.filter((step) => step.tool !== 'optimize_design' && step.tool !== 'run_simulation').slice(0, 6);
  const selectedOptimization = decision.tool_sequence.find((step) => step.tool === 'optimize_design');
  const optimization = selectedOptimization
    ? { ...selectedOptimization, objective: selectedOptimization.objective || decision.objective }
    : { tool: 'optimize_design' as const, metric: '' as const, objective: decision.objective };
  return [...evidence, optimization, { tool: 'run_simulation' as const, metric: '' as const, objective: '' }];
}

export interface AgentTraceItem {
  id: string;
  kind: 'goal' | 'reasoning' | 'action' | 'observation' | 'complete' | 'fallback' | 'error';
  title: string;
  detail: string;
  at: string;
}

export interface RedesignContext {
  run_id: string;
  machine_name: string;
  summary: string;
  evidence: string;
  failed_metrics: Array<{
    metric: string;
    label: string;
    value: number;
    target: number;
    unit: string;
    operator: 'min' | 'max' | 'exact';
  }>;
  human_locks: Array<{ component_id: string; fields: string[] }>;
}

export interface EditContext {
  machine_name: string;
  goal: string;
  selected_component_id: string;
  assembly_ids: string[];
  components: Array<{
    id: string;
    role: string;
    primitive: string;
    assembly_id: string;
    position: [number, number, number];
    rotation: [number, number, number];
    dimensions: [number, number, number];
    material_id: string;
    body_type: string;
    mass: number;
    human_locked_fields: string[];
  }>;
}

export class AgentRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = 'AgentRequestError';
  }
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null) as { code?: unknown; error?: unknown } | null;
  if (!response.ok) {
    const code = typeof payload?.code === 'string' ? payload.code : 'AGENT_REQUEST_FAILED';
    const message = typeof payload?.error === 'string' ? payload.error : 'The model agent could not complete this request.';
    throw new AgentRequestError(code, message, response.status);
  }
  return payload;
}

function agentHeaders(apiKey?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey?.trim()) headers['x-forgetwin-openai-key'] = apiKey.trim();
  return headers;
}

export async function getAgentStatus(signal?: AbortSignal) {
  const response = await fetch('/api/agent', { method: 'GET', cache: 'no-store', signal });
  return agentStatusSchema.parse(await readJson(response));
}

export async function requestAgentPlan(prompt: string, apiKey?: string, signal?: AbortSignal) {
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: agentHeaders(apiKey),
    body: JSON.stringify({ task: 'plan', prompt: conciseText.parse(prompt) }),
    signal,
  });
  return agentPlanResponseSchema.parse(await readJson(response));
}

export async function requestAgentRedesign(prompt: string, context: RedesignContext, apiKey?: string, signal?: AbortSignal) {
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: agentHeaders(apiKey),
    body: JSON.stringify({ task: 'redesign', prompt: conciseText.parse(prompt), context }),
    signal,
  });
  return agentRedesignResponseSchema.parse(await readJson(response));
}

export async function requestAgentEdit(prompt: string, context: EditContext, apiKey?: string, signal?: AbortSignal) {
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: agentHeaders(apiKey),
    body: JSON.stringify({ task: 'edit', prompt: z.string().trim().min(3).max(300).parse(prompt), context }),
    signal,
  });
  return agentEditResponseSchema.parse(await readJson(response));
}

export const AGENT_PLAN_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    normalized_prompt: { type: 'string', minLength: 12, maxLength: 500 },
    reasoning_summary: { type: 'string', minLength: 12, maxLength: 700 },
    architecture: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 100 } },
    assumptions: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 180 } },
    verification_focus: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', enum: [...SUPPORTED_METRIC_KEYS] } },
  },
  required: ['normalized_prompt', 'reasoning_summary', 'architecture', 'assumptions', 'verification_focus'],
} as const;

export const AGENT_REDESIGN_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    diagnosis: { type: 'string', minLength: 8, maxLength: 700 },
    objective: { type: 'string', minLength: 8, maxLength: 300 },
    tool_sequence: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          tool: { type: 'string', enum: ['inspect_telemetry', 'inspect_failure', 'measure_constraint', 'optimize_design', 'run_simulation'] },
          metric: { type: 'string', enum: ['', ...SUPPORTED_METRIC_KEYS] },
          objective: { type: 'string', maxLength: 120 },
        },
        required: ['tool', 'metric', 'objective'],
      },
    },
  },
  required: ['diagnosis', 'objective', 'tool_sequence'],
} as const;

export const AGENT_EDIT_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 8, maxLength: 500 },
    actions: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          tool: { type: 'string', enum: ['set_dimensions', 'set_material', 'set_mass', 'move_component', 'rotate_component', 'create_component', 'remove_component', 'connect_components', 'create_joint'] },
          component_id: { type: 'string', maxLength: 64 },
          assembly_id: { type: 'string', maxLength: 64 },
          primitive: { type: 'string', enum: ['beam', 'plate', 'frame', 'wheel', 'shaft', 'gear', 'pulley', 'belt', 'motor', 'servo', 'piston', 'spring', 'sensor', 'camera', 'light', 'conveyor', 'ramp', 'gripper', 'container', 'counterweight', 'support', 'controller', 'cable', 'hook', 'roller'] },
          role: { type: 'string', maxLength: 100 },
          position: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          rotation: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          dimensions: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          material_id: { type: 'string', enum: ['steel', 'aluminum', 'polymer', 'rubber', 'concrete', 'composite'] },
          body_type: { type: 'string', enum: ['fixed', 'dynamic', 'kinematic'] },
          mass: { type: 'number', minimum: 0, maximum: 1000000 },
          source_id: { type: 'string', maxLength: 64 },
          target_id: { type: 'string', maxLength: 64 },
          connection_type: { type: 'string', enum: ['mechanical', 'power', 'signal'] },
          channel: { type: 'string', maxLength: 64 },
          joint_id: { type: 'string', maxLength: 64 },
          joint_type: { type: 'string', enum: ['fixed', 'revolute', 'prismatic', 'spherical'] },
          axis: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          limits: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
        },
        required: ['tool', 'component_id', 'assembly_id', 'primitive', 'role', 'position', 'rotation', 'dimensions', 'material_id', 'body_type', 'mass', 'source_id', 'target_id', 'connection_type', 'channel', 'joint_id', 'joint_type', 'axis', 'limits'],
      },
    },
  },
  required: ['summary', 'actions'],
} as const;
