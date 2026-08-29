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
  objective: z.string().trim().max(240),
}).strict();

export const agentRedesignSchema = z.object({
  diagnosis: z.string().trim().min(8).max(700),
  objective: z.string().trim().min(8).max(300),
  tool_sequence: z.array(redesignStepSchema).min(1).max(8),
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

export type AgentPlan = z.infer<typeof agentPlanSchema>;
export type AgentRedesign = z.infer<typeof agentRedesignSchema>;
export type AgentRuntimeMode = 'checking' | 'server-model' | 'session-model' | 'deterministic';

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
          objective: { type: 'string', maxLength: 240 },
        },
        required: ['tool', 'metric', 'objective'],
      },
    },
  },
  required: ['diagnosis', 'objective', 'tool_sequence'],
} as const;
