import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST, PUT } from '../app/api/agent/route';
import {
  AGENT_EDIT_JSON_SCHEMA, AGENT_PLAN_JSON_SCHEMA, AGENT_REDESIGN_JSON_SCHEMA,
  agentEditSchema, agentPlanSchema, agentRedesignSchema, getAgentStatus, normalizeRedesignSequence, requestAgentPlan, validateAgentKey,
  validateAgentEditSemantics, validateAgentPlanSemantics, type AgentPlan, type EditContext,
} from './forge-agent';

afterEach(() => { vi.restoreAllMocks(); });

function validPlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    normalized_prompt: 'Build a four-wheel rover that carries 5 kg over a 10 meter course.',
    machine_name: 'Four-wheel payload rover', domain: 'Mobile robotics',
    reasoning_summary: 'Use a grounded test track, a compact chassis, four road wheels, and a joint-coupled traction motor.',
    architecture: ['grounded test track', 'payload chassis', 'four-wheel running gear', 'joint-coupled traction drive'], assumptions: ['Concept-scale test stand'],
    capabilities: ['structure', 'mobile'],
    requirements: [
      { metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 8, unit: '', source: 'inferred' },
      { metric: 'payload_capacity', label: 'Payload capacity', operator: 'min', target: 5, unit: 'kg', source: 'user' },
    ],
    assemblies: [{ id: 'rover', name: 'Rover', purpose: 'Grounded rover concept test assembly', parent_id: '' }],
    components: [
      { id: 'test-rail', primitive: 'support', assembly_id: 'rover', role: 'grounded test rail', position: [0, .1, 0], rotation: [0, 0, 0], dimensions: [4, .2, 2], material_id: 'steel', body_type: 'fixed', mass: 20, color: '#64748b', semantic_tags: [] },
      { id: 'payload-chassis', primitive: 'frame', assembly_id: 'rover', role: 'load-bearing payload chassis', position: [0, .65, 0], rotation: [0, 0, 0], dimensions: [2.1, .25, 1.25], material_id: 'aluminum', body_type: 'dynamic', mass: 12, color: '#94a3b8', semantic_tags: ['payload'] },
      { id: 'drive-wheel', primitive: 'wheel', assembly_id: 'rover', role: 'front left driven road wheel', position: [.7, .5, .72], rotation: [Math.PI / 2, 0, 0], dimensions: [.58, .18, .58], material_id: 'rubber', body_type: 'dynamic', mass: 2, color: '#1f2937', semantic_tags: ['road-wheel'] },
      { id: 'front-right-wheel', primitive: 'wheel', assembly_id: 'rover', role: 'front right road wheel', position: [.7, .5, -.72], rotation: [Math.PI / 2, 0, 0], dimensions: [.58, .18, .58], material_id: 'rubber', body_type: 'dynamic', mass: 2, color: '#1f2937', semantic_tags: ['road-wheel'] },
      { id: 'rear-left-wheel', primitive: 'wheel', assembly_id: 'rover', role: 'rear left road wheel', position: [-.7, .5, .72], rotation: [Math.PI / 2, 0, 0], dimensions: [.58, .18, .58], material_id: 'rubber', body_type: 'dynamic', mass: 2, color: '#1f2937', semantic_tags: ['road-wheel'] },
      { id: 'rear-right-wheel', primitive: 'wheel', assembly_id: 'rover', role: 'rear right road wheel', position: [-.7, .5, -.72], rotation: [Math.PI / 2, 0, 0], dimensions: [.58, .18, .58], material_id: 'rubber', body_type: 'dynamic', mass: 2, color: '#1f2937', semantic_tags: ['road-wheel'] },
      { id: 'drive-motor', primitive: 'motor', assembly_id: 'rover', role: 'traction motor', position: [.42, .65, 0], rotation: [0, 0, 0], dimensions: [.35, .28, .28], material_id: 'steel', body_type: 'fixed', mass: 3, color: '#0ea5e9', semantic_tags: [] },
    ],
    connections: [
      { id: 'rail-motor-edge', source_id: 'payload-chassis', target_id: 'drive-motor', connection_type: 'mechanical', channel: 'motor_mount' },
      { id: 'motor-power-edge', source_id: 'drive-motor', target_id: 'drive-wheel', connection_type: 'power', channel: 'traction_power' },
    ],
    joints: [
      { id: 'chassis-test-mount', joint_type: 'fixed', component_a: 'test-rail', component_b: 'payload-chassis', axis: [0, 1, 0], limits: null, ratio: 0, stiffness: 0, damping: 0 },
      { id: 'wheel-joint', joint_type: 'revolute', component_a: 'payload-chassis', component_b: 'drive-wheel', axis: [0, 0, 1], limits: null, ratio: 0, stiffness: 0, damping: 0 },
      { id: 'front-right-joint', joint_type: 'revolute', component_a: 'payload-chassis', component_b: 'front-right-wheel', axis: [0, 0, 1], limits: null, ratio: 0, stiffness: 0, damping: 0 },
      { id: 'rear-left-joint', joint_type: 'revolute', component_a: 'payload-chassis', component_b: 'rear-left-wheel', axis: [0, 0, 1], limits: null, ratio: 0, stiffness: 0, damping: 0 },
      { id: 'rear-right-joint', joint_type: 'revolute', component_a: 'payload-chassis', component_b: 'rear-right-wheel', axis: [0, 0, 1], limits: null, ratio: 0, stiffness: 0, damping: 0 },
    ],
    motors: [{ id: 'traction-drive', component_id: 'drive-motor', joint_id: 'wheel-joint', max_torque: 80, max_rpm: 240, direction: 1 }],
    sensors: [], actuators: [], controls: [], editable_component_id: 'drive-wheel',
    ...overrides,
  };
}

function validCranePlan(): AgentPlan {
  return {
    normalized_prompt: 'Build a compact crane that lifts a 100 kg load.', machine_name: 'Compact lifting crane', domain: 'Lifting equipment',
    reasoning_summary: 'Ground a wide base, pivot a structural boom, and drive a cable-supported hook through a joint-coupled hoist.',
    architecture: ['grounded crane base', 'pivoting lifting boom', 'cable and hook load path', 'driven hoist'], assumptions: ['Concept-scale guarded test'],
    capabilities: ['structure', 'lift', 'suspend'],
    requirements: [
      { metric: 'payload_capacity', label: 'Rated payload', operator: 'min', target: 100, unit: 'kg', source: 'user' },
      { metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 8, unit: '', source: 'inferred' },
    ],
    assemblies: [{ id: 'crane', name: 'Crane', purpose: 'Grounded lifting mechanism', parent_id: '' }],
    components: [
      { id: 'crane-base', primitive: 'support', assembly_id: 'crane', role: 'grounded wide crane base', position: [0, .2, 0], rotation: [0, 0, 0], dimensions: [2.4, .4, 1.8], material_id: 'steel', body_type: 'fixed', mass: 80, color: '#334155', semantic_tags: [] },
      { id: 'crane-mast', primitive: 'beam', assembly_id: 'crane', role: 'vertical crane mast', position: [-.6, 1.55, 0], rotation: [0, 0, Math.PI / 2], dimensions: [2.7, .25, .25], material_id: 'steel', body_type: 'fixed', mass: 35, color: '#f59e0b', semantic_tags: [] },
      { id: 'crane-boom', primitive: 'beam', assembly_id: 'crane', role: 'pivoting lifting boom', position: [.65, 2.6, 0], rotation: [0, 0, .2], dimensions: [2.8, .22, .22], material_id: 'steel', body_type: 'dynamic', mass: 26, color: '#fbbf24', semantic_tags: [] },
      { id: 'hoist-cable', primitive: 'cable', assembly_id: 'crane', role: 'vertical hoist cable', position: [1.95, 1.55, 0], rotation: [0, 0, 0], dimensions: [.04, 2, .04], material_id: 'steel', body_type: 'dynamic', mass: 2, color: '#94a3b8', semantic_tags: [] },
      { id: 'load-hook', primitive: 'hook', assembly_id: 'crane', role: '100 kg rated load hook', position: [1.95, .55, 0], rotation: [0, 0, 0], dimensions: [.3, .45, .18], material_id: 'steel', body_type: 'dynamic', mass: 5, color: '#ef4444', semantic_tags: ['payload'] },
      { id: 'hoist-motor', primitive: 'motor', assembly_id: 'crane', role: 'joint-coupled hoist motor', position: [-.6, 2.25, .32], rotation: [Math.PI / 2, 0, 0], dimensions: [.42, .36, .36], material_id: 'steel', body_type: 'fixed', mass: 9, color: '#0ea5e9', semantic_tags: [] },
    ],
    connections: [
      { id: 'hoist-power', source_id: 'hoist-motor', target_id: 'hoist-cable', connection_type: 'power', channel: 'hoist_power' },
    ],
    joints: [
      { id: 'boom-pivot', joint_type: 'revolute', component_a: 'crane-mast', component_b: 'crane-boom', axis: [0, 0, 1], limits: [-.15, .85], ratio: 0, stiffness: 0, damping: 0 },
      { id: 'cable-boom', joint_type: 'fixed', component_a: 'crane-boom', component_b: 'hoist-cable', axis: [0, 1, 0], limits: null, ratio: 0, stiffness: 0, damping: 0 },
      { id: 'hook-line', joint_type: 'rope', component_a: 'hoist-cable', component_b: 'load-hook', axis: [0, 1, 0], limits: [0, 1.2], ratio: 0, stiffness: 6000, damping: 220 },
    ],
    motors: [{ id: 'hoist-drive', component_id: 'hoist-motor', joint_id: 'boom-pivot', max_torque: 1800, max_rpm: 24, direction: 1 }],
    sensors: [], actuators: [], controls: [], editable_component_id: 'crane-boom',
  };
}

function fixedPartPlan(machineName: string, parts: Array<{ primitive: AgentPlan['components'][number]['primitive']; role: string }>): AgentPlan {
  return {
    normalized_prompt: `Build a concept ${machineName} from recognizable physical primitives.`, machine_name: machineName, domain: 'Mechanical component design',
    reasoning_summary: `Compose the requested ${machineName} as a grounded, dimensioned concept part.`, architecture: [machineName], assumptions: [], capabilities: ['structure'],
    requirements: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: Math.max(2, parts.length), unit: '', source: 'inferred' }],
    assemblies: [{ id: 'part', name: machineName, purpose: 'Requested standalone part or subassembly', parent_id: '' }],
    components: parts.map((part, index) => ({
      id: `part-${index + 1}`, primitive: part.primitive, assembly_id: 'part', role: part.role,
      position: [index * .45, .4, 0], rotation: [0, 0, 0], dimensions: [.7, .3, .4], material_id: 'steel', body_type: 'fixed', mass: 2, color: '#64748b', semantic_tags: [],
    })),
    connections: [], joints: [], motors: [], sensors: [], actuators: [], controls: [], editable_component_id: 'part-1',
  };
}

function editContextFor(plan: AgentPlan): EditContext {
  return {
    revision: 12, design_hash: 'world-test1234', machine_name: plan.machine_name, goal: plan.normalized_prompt, max_components: 40, selected_component_id: plan.editable_component_id,
    world: { gravity: [0, -9.81, 0], bounds: [20, 12, 20], environment: 'test lab' },
    goal_constraints: plan.requirements.map((item) => ({ metric: item.metric, label: item.label, operator: item.operator, target: item.target, unit: item.unit })),
    assemblies: plan.assemblies.map((item) => ({ id: item.id, name: item.name, purpose: item.purpose, parent_id: item.parent_id })),
    components: plan.components.map((item) => ({ id: item.id, role: item.role, primitive: item.primitive, assembly_id: item.assembly_id, position: item.position, rotation: item.rotation, dimensions: item.dimensions, material_id: item.material_id, body_type: item.body_type, mass: item.mass, color: item.color, parameters: {}, human_locked_fields: [] })),
    connections: plan.connections.map((item) => ({ id: item.id, source_id: item.source_id, target_id: item.target_id, connection_type: item.connection_type, channel: item.channel })),
    joints: plan.joints.map((item) => ({ id: item.id, joint_type: item.joint_type, component_a: item.component_a, component_b: item.component_b, axis: item.axis, limits: item.limits, ratio: item.ratio || null, stiffness: item.stiffness || null, damping: item.damping || null })),
    motors: plan.motors.map((item) => ({ id: item.id, component_id: item.component_id, joint_id: item.joint_id, max_torque: item.max_torque, max_rpm: item.max_rpm, direction: item.direction })),
    sensors: plan.sensors.map((item) => ({ id: item.id, component_id: item.component_id, sensor_type: item.sensor_type, channel: item.channel, target_id: item.target_id, range: item.range })),
    actuators: plan.actuators.map((item) => ({ id: item.id, component_id: item.component_id, joint_id: item.joint_id, actuator_type: item.actuator_type, max_force: item.max_force, max_speed: item.max_speed, travel: item.travel })),
    controls: plan.controls.map((item) => ({ id: item.id, name: item.name, mode: item.mode, sensor_ids: item.sensor_ids, actuator_ids: item.actuator_ids, expression: item.expression, setpoint: item.setpoint, kp: item.kp, ki: item.ki, kd: item.kd })),
    latest_run: null, conversation: [],
  };
}

describe('ForgeTwin model-agent boundary', () => {
  it('accepts only supported verification metrics and bounded redesign tools', () => {
    expect(agentPlanSchema.parse(validPlan()).requirements[0].metric).toBe('component_count');
    expect(() => agentPlanSchema.parse(validPlan({ requirements: [{ metric: 'invented_metric' as 'component_count', label: 'Invented', operator: 'max', target: 1, unit: '', source: 'user' }] }))).toThrow();
    expect(() => agentRedesignSchema.parse({ diagnosis: 'The payload is unstable.', objective: 'Increase stability.', tool_sequence: [{ tool: 'delete_everything', metric: '', objective: '' }] })).toThrow();
    expect(() => agentRedesignSchema.parse({ diagnosis: 'The payload is unstable.', objective: 'Increase stability.', tool_sequence: [{ tool: 'optimize_design', metric: '', objective: 'x'.repeat(121) }] })).toThrow();
  });

  it('rejects active plans whose drive is not connected to the mechanism', () => {
    const disconnected = validPlan({
      connections: [{ id: 'rail-motor-edge', source_id: 'test-rail', target_id: 'drive-motor', connection_type: 'mechanical', channel: 'motor_mount' }],
      motors: [{ id: 'traction-drive', component_id: 'drive-motor', joint_id: '', max_torque: 80, max_rpm: 240, direction: 1 }],
    });
    expect(() => validateAgentPlanSemantics(disconnected, disconnected.normalized_prompt)).toThrow(/connected to the mechanism it drives/i);
  });

  it('rejects a drive coupled only to an unrelated fixed joint', () => {
    const inert = validPlan({ motors: [{ id: 'traction-drive', component_id: 'drive-motor', joint_id: 'chassis-test-mount', max_torque: 80, max_rpm: 240, direction: 1 }] });
    expect(() => validateAgentPlanSemantics(inert, inert.normalized_prompt)).toThrow(/connected to the mechanism it drives/i);
  });

  it('preserves explicit values, direction, units, and user provenance', () => {
    expect(() => validateAgentPlanSemantics(validPlan(), 'Build a rover that carries five kilograms over rough terrain.')).not.toThrow();
    const inverted = validPlan({ requirements: [
      { metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 8, unit: '', source: 'inferred' },
      { metric: 'payload_capacity', label: 'Payload capacity', operator: 'max', target: 5, unit: 'lb', source: 'inferred' },
    ] });
    expect(() => validateAgentPlanSemantics(inverted, 'Build a rover that carries 5 kg over rough terrain.')).toThrow(/misstates.*load target/i);

    const crane = validCranePlan();
    crane.requirements = crane.requirements.map((item) => item.metric === 'payload_capacity' ? { ...item, target: 50 } : item);
    expect(() => validateAgentPlanSemantics(crane, 'Build a 200 kg crane that lifts 50 kg.')).not.toThrow();
  });

  it.each([
    ['Build a car suspension.', fixedPartPlan('car suspension', [{ primitive: 'spring', role: 'coil spring suspension member' }, { primitive: 'beam', role: 'lower suspension control arm' }])],
    ['Build a vehicle chassis.', fixedPartPlan('vehicle chassis', [{ primitive: 'frame', role: 'vehicle chassis perimeter frame' }, { primitive: 'beam', role: 'chassis crossmember rail' }])],
    ['Build a pump housing.', fixedPartPlan('pump housing', [{ primitive: 'frame', role: 'volute pump housing shell' }, { primitive: 'plate', role: 'pump housing cover plate' }])],
    ['Build a crane hook.', fixedPartPlan('crane hook', [{ primitive: 'hook', role: 'forged crane load hook' }, { primitive: 'support', role: 'hook inspection fixture' }])],
    ['Build a bicycle fork.', fixedPartPlan('bicycle fork', [{ primitive: 'beam', role: 'left fork stanchion' }, { primitive: 'beam', role: 'right fork stanchion and steerer crown' }])],
  ])('recognizes a requested subassembly without demanding the entire parent machine: %s', (prompt, plan) => {
    expect(() => validateAgentPlanSemantics(plan, prompt)).not.toThrow();
  });

  it('validates every machine family in a compound goal', () => {
    expect(() => validateAgentPlanSemantics(validCranePlan(), 'Build a crane mounted on a rover.')).toThrow(/multi-wheel rolling chassis/i);
  });

  it('accepts guarded in-place chat edits and rejects arbitrary tools', () => {
    const envelope = { understanding: 'Widen the existing crane base while preserving the rest of the machine.', needs_clarification: false, clarification_question: '', target_ids: ['crane-base'], preserve_ids: [], requested_invariants: ['Keep the boom placement unchanged'], verification: ['Crane base width increases'] };
    expect(agentEditSchema.parse({ ...envelope, actions: [{ tool: 'set_dimensions', component_id: 'crane-base', dimensions: [5, .3, 3] }] }).actions[0].tool).toBe('set_dimensions');
    const headlight = agentEditSchema.parse({ ...envelope, target_ids: ['front-headlight'], understanding: 'Mount a purpose-built LED headlight on the existing front structure.', actions: [{ tool: 'create_component', component_id: 'front-headlight', primitive: 'light', assembly_id: 'vehicle', role: 'front LED headlight', position: [1, 1, 0], rotation: [0, 0, 0], dimensions: [.32, .22, .22], material_id: 'polymer', body_type: 'fixed', mass: .24, color: '#e9f5ff', semantic_tags: ['headlight'] }] });
    expect(headlight.actions[0]).toMatchObject({ tool: 'create_component', primitive: 'light' });
    expect(() => agentEditSchema.parse({ ...envelope, actions: [{ tool: 'run_shell' }] })).toThrow();
  });

  it('requires chat edits to account for changed mounts and attach new functional parts', () => {
    const context = editContextFor(validPlan());
    const move = agentEditSchema.parse({
      understanding: 'Move only the front left drive wheel laterally.', needs_clarification: false, clarification_question: '',
      target_ids: ['drive-wheel'], preserve_ids: [], requested_invariants: ['Keep the rolling chassis connected'], verification: ['Wheel mount remains coincident'],
      actions: [{ tool: 'move_component', component_id: 'drive-wheel', position: [.7, .5, .52] }],
    });
    expect(() => validateAgentEditSemantics(move, context)).toThrow(/payload-chassis.*target_ids/i);
    expect(() => validateAgentEditSemantics({ ...move, target_ids: ['drive-wheel', 'payload-chassis'] }, context)).not.toThrow();

    const floating = agentEditSchema.parse({
      understanding: 'Add a headlight body to the rover.', needs_clarification: false, clarification_question: '', target_ids: ['front-headlight'], preserve_ids: [], requested_invariants: ['Keep the chassis'], verification: ['Headlight is mounted'],
      actions: [{ tool: 'create_component', component_id: 'front-headlight', primitive: 'light', assembly_id: 'rover', role: 'front LED headlight', position: [1.1, .8, 0], rotation: [0, 0, 0], dimensions: [.24, .16, .16], material_id: 'polymer', body_type: 'fixed', mass: .2, color: '#e9f5ff', semantic_tags: ['headlight'] }],
    });
    expect(() => validateAgentEditSemantics(floating, context)).toThrow(/physical connection or joint/i);
  });

  it('exports strict OpenAI-compatible schemas without unsupported tuple or union keywords', () => {
    const serialized = JSON.stringify([AGENT_PLAN_JSON_SCHEMA, AGENT_EDIT_JSON_SCHEMA, AGENT_REDESIGN_JSON_SCHEMA]);
    expect(serialized).not.toMatch(/"(?:\$schema|oneOf|prefixItems|allOf|not|if|then|else)"/);
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      const object = node as Record<string, unknown>;
      if (object.type === 'object') { expect(object.additionalProperties).toBe(false); expect(new Set(object.required as string[])).toEqual(new Set(Object.keys(object.properties as object))); }
      Object.values(object).forEach(walk);
    };
    [AGENT_PLAN_JSON_SCHEMA, AGENT_EDIT_JSON_SCHEMA, AGENT_REDESIGN_JSON_SCHEMA].forEach(walk);
    expect(serialized).toContain('"type":"null"');
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
      ok: true, mode: 'model', model: 'gpt-5.4-mini', result: validPlan({ normalized_prompt: 'Build a gearbox with a 4 to 1 speed ratio and at least 80 percent efficiency.' }),
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

  it('validates a tab-owned key before reporting the model as connected', async () => {
    const visitorKey = 'sk-test-tab-validation-key-123456789';
    const clientFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, configured: true, model: 'gpt-5.6-sol' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(validateAgentKey(visitorKey)).resolves.toEqual({ ok: true, configured: true, model: 'gpt-5.6-sol' });
    const [url, init] = clientFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('/api/agent');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['x-forgetwin-openai-key']).toBe(visitorKey);
    expect(init.body).toBeUndefined();
  });

  it('checks model access without echoing or placing the visitor key in a body', async () => {
    const visitorKey = 'sk-test-validation-route-key-123456789';
    const providerFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'gpt-5.6-sol', object: 'model' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const response = await PUT(new Request('http://localhost/api/agent', {
      method: 'PUT', headers: { origin: 'http://localhost', 'x-forgetwin-openai-key': visitorKey },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, configured: true, model: 'gpt-5.6-sol' });
    const [url, init] = providerFetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/models/gpt-5.6-sol');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${visitorKey}`);
    expect(init.body).toBeUndefined();
  });

  it('returns a sanitized actionable error when OpenAI rejects a key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-secret-never-echo' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const response = await PUT(new Request('http://localhost/api/agent', {
      method: 'PUT', headers: { origin: 'http://localhost', 'x-forgetwin-openai-key': 'sk-test-rejected-key-1234567890123' },
    }));
    expect(response.status).toBe(401);
    const payload = await response.json() as { code: string; error: string };
    expect(payload.code).toBe('MODEL_KEY_REJECTED');
    expect(payload.error).toMatch(/rejected this API key/i);
    expect(JSON.stringify(payload)).not.toContain('sk-secret-never-echo');
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
    const output = validPlan({ normalized_prompt: 'Build a small rover that carries five kilograms over rough terrain.' });
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

  it('repairs one schema-valid but semantically unrelated model graph before accepting it', async () => {
    const unrelated = validPlan({ machine_name: 'Package conveyor', architecture: ['powered conveyor', 'sorting chute'] });
    const repaired = validCranePlan();
    const providerFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify(unrelated) }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify(repaired) }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const response = await POST(new Request('http://localhost/api/agent', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-forgetwin-openai-key': 'sk-test-repair-key-123456789012345' },
      body: JSON.stringify({ task: 'plan', prompt: 'Build a compact crane that lifts a 100 kg load.' }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: { machine_name: 'Compact lifting crane' } });
    expect(providerFetch).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String((providerFetch.mock.calls[1][1] as RequestInit).body)) as { input: Array<{ content: Array<{ text: string }> }> };
    expect(retryBody.input[0].content[0].text).toContain('validation_feedback');
    expect(retryBody.input[0].content[0].text).toContain('repair_required');
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
