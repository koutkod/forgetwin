import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/agent/route';
import {
  agentEditSchema, agentPlanSchema, agentRedesignSchema, getAgentStatus, requestAgentPlan,
} from './forge-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('ForgeTwin model-agent boundary', () => {
  it('accepts only supported verification metrics and bounded redesign tools', () => {
    expect(agentPlanSchema.parse({
      normalized_prompt: 'Build a four-wheel rover that carries 5 kg over a 10 meter course.',
      reasoning_summary: 'Use a low frame, four driven wheels, suspension, and an IMU.',
      architecture: ['low frame', 'four wheel modules', 'payload deck'],
      assumptions: ['Dry indoor surface'],
      verification_focus: ['course_time', 'traction_margin', 'platform_tilt'],
    }).verification_focus).toContain('course_time');
    expect(() => agentPlanSchema.parse({ normalized_prompt: 'Build a useful machine from reusable primitives.', reasoning_summary: 'This is long enough to parse safely.', architecture: ['frame'], assumptions: [], verification_focus: ['invented_metric'] })).toThrow();
    expect(() => agentRedesignSchema.parse({ diagnosis: 'The payload is unstable.', objective: 'Increase stability.', tool_sequence: [{ tool: 'delete_everything', metric: '', objective: '' }] })).toThrow();
    expect(() => agentRedesignSchema.parse({ diagnosis: 'The payload is unstable.', objective: 'Increase stability.', tool_sequence: [{ tool: 'optimize_design', metric: '', objective: 'x'.repeat(121) }] })).toThrow();
  });

  it('accepts guarded in-place chat edits and rejects arbitrary tools', () => {
    const action = {
      tool: 'set_dimensions', component_id: 'crane-base', assembly_id: 'crane', primitive: 'frame', role: 'crane base',
      position: [0, .2, 0], rotation: [0, 0, 0], dimensions: [5, .3, 3], material_id: 'steel', body_type: 'fixed', mass: 0,
      source_id: '', target_id: '', connection_type: 'mechanical', channel: '', joint_id: '', joint_type: 'fixed', axis: [0, 1, 0], limits: [0, 0],
    } as const;
    expect(agentEditSchema.parse({ summary: 'Widen the existing crane base while preserving every other component.', actions: [action] }).actions[0].tool).toBe('set_dimensions');
    expect(agentEditSchema.parse({ summary: 'Mount a purpose-built LED headlight on the existing front structure.', actions: [{ ...action, tool: 'create_component', component_id: 'front-headlight', primitive: 'light', role: 'front LED headlight', dimensions: [.32, .22, .22], mass: .24 }] }).actions[0].primitive).toBe('light');
    expect(() => agentEditSchema.parse({ summary: 'Delete all files outside the engineering world.', actions: [{ ...action, tool: 'run_shell' }] })).toThrow();
  });

  it('keeps a temporary key in the request header and validates the model plan', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true, mode: 'model', model: 'gpt-5.4-mini', result: {
        normalized_prompt: 'Build a gearbox with a 4 to 1 speed ratio and at least 80 percent efficiency.',
        reasoning_summary: 'Use two shafts, a supported gear pair, and a torque-limited motor.',
        architecture: ['input shaft', 'gear mesh', 'output shaft'], assumptions: [],
        verification_focus: ['speed_ratio', 'transmission_efficiency'],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await requestAgentPlan('Build a 4:1 gearbox with at least 80% efficiency.', 'sk-test-temporary-key-123456789');
    expect(result.mode).toBe('model');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-forgetwin-openai-key']).toBe('sk-test-temporary-key-123456789');
  });

  it('reports server model status without exposing a key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, configured: true, model: 'gpt-5.4-mini' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(getAgentStatus()).resolves.toEqual({ ok: true, configured: true, model: 'gpt-5.4-mini' });
  });

  it('returns an explicit fallback response when no server model key exists', async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const response = await POST(new Request('http://localhost/api/agent', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
        body: JSON.stringify({ task: 'plan', prompt: 'Build a small rover that carries five kilograms.' }),
      }));
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
    }
  });


  it('defaults to the flagship GPT-5.6 Sol model', async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    const previousModel = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_MODEL;
    try {
      const response = await (await import('../app/api/agent/route')).GET();
      await expect(response.json()).resolves.toMatchObject({ configured: false, model: 'gpt-5.6-sol' });
    } finally {
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
      if (previousModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = previousModel;
    }
  });
});
