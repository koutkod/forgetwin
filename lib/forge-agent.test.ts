import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/agent/route';
import {
  agentEditSchema, agentPlanSchema, agentRedesignSchema, getAgentStatus, normalizeRedesignSequence, requestAgentPlan,
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

  it('normalizes model redesigns to one mutation followed by one fresh simulation', () => {
    const decision = agentRedesignSchema.parse({
      diagnosis: 'Platform tilt and assembly integrity are outside the measured envelope.',
      objective: 'Improve stability and connectivity while preserving human locks.',
      tool_sequence: [
        { tool: 'inspect_telemetry', metric: '', objective: '' },
        { tool: 'measure_constraint', metric: 'platform_tilt', objective: '' },
        { tool: 'optimize_design', metric: '', objective: 'Increase control authority.' },
        { tool: 'optimize_design', metric: '', objective: 'Reconnect every component.' },
        { tool: 'run_simulation', metric: '', objective: '' },
        { tool: 'run_simulation', metric: '', objective: '' },
      ],
    });
    const sequence = normalizeRedesignSequence(decision);
    expect(sequence.filter((step) => step.tool === 'optimize_design')).toHaveLength(1);
    expect(sequence.filter((step) => step.tool === 'run_simulation')).toHaveLength(1);
    expect(sequence.at(-1)?.tool).toBe('run_simulation');
    expect(sequence.map((step) => step.tool)).toEqual(['inspect_telemetry', 'measure_constraint', 'optimize_design', 'run_simulation']);
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
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/api/agent');
    expect((init.headers as Record<string, string>)['x-forgetwin-openai-key']).toBe('sk-test-temporary-key-123456789');
    expect(String(init.body)).not.toContain('sk-test-temporary-key-123456789');
    expect(init.redirect).toBe('error');
  });

  it('reports BYOK-only model status without exposing a key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, configured: false, model: 'gpt-5.6-sol' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(getAgentStatus()).resolves.toEqual({ ok: true, configured: false, model: 'gpt-5.6-sol' });
  });

  it('never falls back to a shared server key', async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-owner-key-that-must-never-be-used';
    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const response = await POST(new Request('http://localhost/api/agent', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
        body: JSON.stringify({ task: 'plan', prompt: 'Build a small rover that carries five kilograms.' }),
      }));
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
    }
  });

  it('forwards a visitor key only as upstream authorization and blocks foreign origins', async () => {
    const visitorKey = 'sk-test-visitor-key-for-current-tab-only';
    const output = {
      normalized_prompt: 'Build a small rover that carries five kilograms over rough terrain.',
      reasoning_summary: 'Use a low frame, four supported wheels, and a centered payload deck.',
      architecture: ['low frame', 'four wheel modules', 'payload deck'],
      assumptions: ['Concept-level indoor terrain'],
      verification_focus: ['course_time', 'traction_margin', 'platform_tilt'],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const response = await POST(new Request('http://localhost/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-forgetwin-openai-key': visitorKey },
      body: JSON.stringify({ task: 'plan', prompt: 'Build a small rover that carries five kilograms over rough terrain.' }),
    }));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${visitorKey}`);
    expect(String(init.body)).not.toContain(visitorKey);
    expect(JSON.stringify(await response.json())).not.toContain(visitorKey);

    const rejected = await POST(new Request('http://localhost/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://foreign.example', 'x-forgetwin-openai-key': visitorKey },
      body: JSON.stringify({ task: 'plan', prompt: 'Build a small rover that carries five kilograms over rough terrain.' }),
    }));
    expect(rejected.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts the configured public origin behind a trusted deployment proxy', async () => {
    const previous = process.env.NEXT_PUBLIC_SITE_ORIGIN;
    process.env.NEXT_PUBLIC_SITE_ORIGIN = 'https://forgetwin.netlify.app';
    try {
      const response = await POST(new Request('http://internal-function-host/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://forgetwin.netlify.app' },
        body: JSON.stringify({ task: 'plan', prompt: 'Build a small rover that carries five kilograms.' }),
      }));
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_ORIGIN; else process.env.NEXT_PUBLIC_SITE_ORIGIN = previous;
    }
  });


  it('defaults to the flagship GPT-5.6 Sol model', async () => {
    const previousModel = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL;
    try {
      const response = await GET();
      await expect(response.json()).resolves.toMatchObject({ configured: false, model: 'gpt-5.6-sol' });
    } finally {
      if (previousModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = previousModel;
    }
  });
});
