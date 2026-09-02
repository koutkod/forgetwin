import { describe, expect, it } from 'vitest';
import type { AgentIntent, AgentPlan } from './forge-agent';
import { agentPlanFromCompiled, compileAgentPlan, localAnchorAt } from './forge-model-plan';
import { compileDesignBrief } from './forge-prompt';

function twoBodyPlan(machineName: string, subject: Partial<AgentPlan['components'][number]>): AgentPlan {
  return {
    normalized_prompt: `Build a concept model of ${machineName} from connected physical bodies.`,
    machine_name: machineName, domain: 'Mechanical design', reasoning_summary: 'Connect one recognizable subject body to a grounded inspection base.',
    architecture: ['inspection base', 'subject body'], assumptions: [], capabilities: ['structure'],
    requirements: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 4, unit: '', source: 'inferred' }],
    assemblies: [{ id: 'main', name: 'Main assembly', purpose: 'Connected concept model', parent_id: '' }],
    components: [
      { id: 'base', primitive: 'support', assembly_id: 'main', role: 'grounded inspection base', position: [0, .1, 0], rotation: [0, 0, 0], dimensions: [3, .2, 2], material_id: 'steel', body_type: 'fixed', mass: 20, color: '#475569', semantic_tags: [] },
      { id: 'subject', primitive: 'plate', assembly_id: 'main', role: 'subject body', position: [1.5, 1, 0], rotation: [0, 0, 0], dimensions: [1, .3, .8], material_id: 'aluminum', body_type: 'fixed', mass: 3, color: '#94a3b8', semantic_tags: [], ...subject },
    ],
    connections: [{ id: 'subject-mount', source_id: 'base', target_id: 'subject', connection_type: 'mechanical', channel: 'fixture_mount' }],
    joints: [{ id: 'subject-joint', joint_type: 'fixed', component_a: 'base', component_b: 'subject', axis: [0, 1, 0], limits: null, ratio: 0, stiffness: 0, damping: 0 }],
    motors: [], sensors: [], actuators: [], controls: [], editable_component_id: 'subject',
  };
}

describe('model-authored world compilation', () => {
  it('expands a compact model intent into a validated recognizable graph', () => {
    const prompt = 'Build a compact two-wheel bicycle with a frame, steering, pedals, chain drive, seat, and brakes.';
    const intent: AgentIntent = {
      normalized_prompt: prompt,
      design_brief: 'Build a bicycle with a diamond frame, two wheels, steering fork, handlebar, seat, pedals, chain drive, battery-free manual motion, and brakes.',
      machine_name: 'Compact two-wheel bicycle', domain: 'Personal mobility',
      reasoning_summary: 'Use a recognizable bicycle silhouette with a manual steering chain and pedal-driven rear wheel.',
      architecture: ['diamond frame', 'two-wheel running gear', 'steering fork', 'pedal and chain transmission'],
      assumptions: ['Concept-scale inspection stand'], capabilities: ['structure', 'mobile', 'transmit'],
      requirements: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 30, unit: '', source: 'inferred' }],
    };
    const result = agentPlanFromCompiled(prompt, intent, compileDesignBrief(intent.design_brief));
    expect(result.machine_name).toBe('Compact two-wheel bicycle');
    expect(result.components.filter((item) => item.primitive === 'wheel')).toHaveLength(2);
    expect(result.joints.some((item) => item.joint_type === 'revolute')).toBe(true);
  });

  it('keeps model planning connected for detailed vehicles above the legacy forty-body boundary', () => {
    const prompt = 'Build an electric go-kart with headlights and brake lights.';
    const compiled = compileDesignBrief(prompt);
    const intent: AgentIntent = {
      normalized_prompt: prompt,
      design_brief: prompt,
      machine_name: compiled.goal.machineName,
      domain: compiled.goal.domain,
      reasoning_summary: 'Use a low tubular chassis, independent steering knuckles, Ackermann linkage, powered rear wheels, driver controls, and correctly oriented lights.',
      architecture: ['tubular chassis', 'four-wheel running gear', 'Ackermann steering', 'rear traction drive', 'driver controls and lighting'],
      assumptions: ['Concept-scale rigid-body validation'],
      capabilities: compiled.goal.capabilities,
      requirements: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 64, unit: '', source: 'inferred' }],
    };

    const result = agentPlanFromCompiled(prompt, intent, compiled);

    expect(result.components.length).toBeGreaterThan(40);
    expect(result.components.length).toBeLessThanOrEqual(80);
    expect(result.joints).toHaveLength(17);
    const roundTrip = compileAgentPlan(prompt, result);
    expect(roundTrip.components.filter((item) => item.parameters?.road_vehicle_kingpin)).toHaveLength(2);
    expect(roundTrip.components.filter((item) => item.parameters?.road_vehicle_wheel_hub)).toHaveLength(4);
    expect(roundTrip.components.filter((item) => item.parameters?.road_vehicle_steering_tie_rod)).toHaveLength(2);
    expect(roundTrip.components.filter((item) => item.parameters?.headlight).every((item) => item.parameters?.facing_axis === '+X')).toBe(true);
    expect(roundTrip.components.filter((item) => item.parameters?.brake_light).every((item) => item.parameters?.facing_axis === '-X')).toBe(true);
  });

  it('preserves the recognizable passenger-car shell and glazing through hosted-AI plan conversion', () => {
    const prompt = 'Build a road car with a clear windshield, headlights, and tail lights.';
    const compiled = compileDesignBrief(prompt);
    const intent: AgentIntent = {
      normalized_prompt: prompt, design_brief: prompt, machine_name: compiled.goal.machineName,
      domain: compiled.goal.domain, reasoning_summary: 'Compose a proportioned four-door passenger car around a long wheelbase, enclosed cabin, seating, glazing, steering, road wheels, and lights.',
      architecture: ['reinforced chassis', 'four-wheel running gear', 'enclosed passenger cabin', 'steering and lighting'],
      assumptions: ['Concept-scale rigid-body validation'], capabilities: compiled.goal.capabilities,
      requirements: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 64, unit: '', source: 'inferred' }],
    };

    const roundTrip = compileAgentPlan(prompt, agentPlanFromCompiled(prompt, intent, compiled));
    const body = roundTrip.components.find((item) => item.parameters?.passenger_car_body)!;
    expect(body).toBeDefined();
    expect(body.parameters).toMatchObject({ automotive_body: true, road_vehicle_body: true, body_style: 'four-door-sedan', front_axis: '+X' });
    expect(Number(body.parameters?.wheelbase_m)).toBeGreaterThan(2.4);
    expect(roundTrip.components.find((item) => item.parameters?.driver_seat)).toBeDefined();
    expect(roundTrip.components.find((item) => item.parameters?.passenger_seat)).toBeDefined();
    expect(roundTrip.components.find((item) => item.parameters?.rear_bench_seat)).toBeDefined();
    expect(roundTrip.components.find((item) => item.parameters?.cockpit_windshield)?.parameters).toMatchObject({ transparent_glazing: true, facing_axis: '+X' });
    expect(roundTrip.components.find((item) => item.parameters?.rear_windshield)?.parameters).toMatchObject({ transparent_glazing: true, facing_axis: '-X' });
    expect(roundTrip.components.filter((item) => item.parameters?.side_window)).toHaveLength(2);
  });

  it('preserves humanoid and industrial-arm visual semantics through hosted-AI conversion', () => {
    for (const prompt of ['Build a humanoid service robot with two hands and stereo vision.', 'Build a three-axis robotic arm with a gripper that reaches 2 meters.']) {
      const compiled = compileDesignBrief(prompt);
      const intent: AgentIntent = {
        normalized_prompt: prompt, design_brief: prompt, machine_name: compiled.goal.machineName, domain: compiled.goal.domain,
        reasoning_summary: 'Compose a recognizable articulated machine from proportioned body shells, structural links, real joint housings, sensors, actuators, and an end effector.',
        architecture: compiled.goal.summary.split(' + ').slice(0, 5), assumptions: ['Concept-scale rigid-body validation'], capabilities: compiled.goal.capabilities,
        requirements: [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 64, unit: '', source: 'inferred' }],
      };
      const roundTrip = compileAgentPlan(prompt, agentPlanFromCompiled(prompt, intent, compiled));
      if (/humanoid/.test(prompt)) {
        expect(roundTrip.components.find((item) => item.parameters?.robot_head)?.parameters).toMatchObject({ robot_face: true });
        expect(roundTrip.components.filter((item) => item.parameters?.robot_limb)).toHaveLength(8);
        expect(roundTrip.components.filter((item) => item.parameters?.robot_hand)).toHaveLength(2);
      } else {
        expect(roundTrip.components.filter((item) => item.parameters?.robot_arm_link)).toHaveLength(3);
        expect(roundTrip.components.filter((item) => item.parameters?.robot_arm_joint)).toHaveLength(3);
        expect(roundTrip.components.some((item) => item.parameters?.robot_arm_camera)).toBe(true);
        expect(roundTrip.components.some((item) => item.parameters?.robot_arm_gripper)).toBe(true);
      }
    }
  });

  it('keeps explicit user targets authoritative when the model marks one as inferred', () => {
    const prompt = 'Build a conveyor that sorts red and blue boxes into separate bins at 20 boxes per minute.';
    const intent: AgentIntent = {
      normalized_prompt: prompt,
      design_brief: 'Build a conveyor sorting system at 20 boxes per minute with a frame, powered belt, red and blue boxes, color sensor, servo diverter, and two bins.',
      machine_name: 'Red and blue box sorter', domain: 'Logistics automation',
      reasoning_summary: 'Use color sensing and a servo diverter to route boxes from one powered conveyor into two destinations.',
      architecture: ['powered conveyor', 'color sensing', 'servo diverter', 'two output bins'], assumptions: [],
      capabilities: ['structure', 'transport', 'classify', 'measure'],
      requirements: [{ metric: 'throughput', label: 'Throughput', operator: 'min', target: 20, unit: '/min', source: 'inferred' }],
    };
    const compiled = compileDesignBrief(intent.design_brief);
    const explicit = compileDesignBrief(prompt).goal.constraints.filter((item) => item.source === 'user');
    const result = agentPlanFromCompiled(prompt, intent, compiled, explicit);
    expect(result.requirements).toContainEqual(expect.objectContaining({ metric: 'throughput', target: 20, unit: '/min', source: 'user' }));
  });

  it('does not reinterpret requested subparts as aggregate simulator metrics', () => {
    const prompt = 'Build an airplane with two wings, a propeller and navigation lights.';
    const compiled = compileDesignBrief(prompt);
    const intent: AgentIntent = {
      normalized_prompt: prompt,
      design_brief: 'Airplane with two wings, a propeller, landing gear and navigation lights.',
      machine_name: 'Fixed-wing aircraft', domain: 'Aircraft engineering',
      reasoning_summary: 'A light aircraft needs two wings and a driven propeller.',
      architecture: ['fuselage', 'two main wings', 'propeller drive', 'landing gear'],
      assumptions: ['Concept scale'], capabilities: ['structure', 'rotate', 'mobile'],
      requirements: [
        { metric: 'component_count', label: 'Main wing count', operator: 'exact', target: 2, unit: 'wings', source: 'user' },
        { metric: 'actuator_count', label: 'Propeller motor count', operator: 'exact', target: 1, unit: 'motor', source: 'inferred' },
      ],
    };

    const result = agentPlanFromCompiled(prompt, intent, compiled, compiled.goal.constraints.filter((item) => item.source === 'user'));

    expect(result.requirements.some((item) => item.label === 'Main wing count')).toBe(false);
    expect(result.requirements.some((item) => item.label === 'Propeller motor count')).toBe(false);
    expect(result.components.filter((item) => /main wing/.test(item.role))).toHaveLength(2);
    expect(result.assemblies.map((item) => item.name)).not.toContain('parallel linear guides');
    expect(result.assemblies.map((item) => item.name)).not.toContain('requested primitive extension');
    const roundTrip = compileAgentPlan(prompt, result);
    const navigationLights = roundTrip.components.filter((item) => item.parameters?.aircraft_navigation_light);
    expect(navigationLights.map((item) => [item.parameters?.navigation_side, item.parameters?.facing_axis, item.color])).toEqual(expect.arrayContaining([
      ['left', '-Z', '#ff3344'], ['right', '+Z', '#32e875'], ['tail', '-X', '#f3f8ff'],
    ]));
    expect(roundTrip.components.find((item) => item.parameters?.cockpit_windshield)?.parameters?.transparent_glazing).toBe(true);
  });

  it('uses bounded semantic tags instead of accidental machine-name substrings', () => {
    const cargo = compileAgentPlan('Build a cargo carrier.', twoBodyPlan('Cargo carrier', { primitive: 'wheel', role: 'stationary idler wheel', body_type: 'dynamic' }));
    expect(cargo.components.find((item) => item.id === 'subject')?.parameters?.road_vehicle_wheel).toBeUndefined();

    const solar = compileAgentPlan('Build a tracked panel test rig.', twoBodyPlan('Tracked solar test rig', { role: 'fixed solar panel', semantic_tags: ['solar-panel'] }));
    expect(solar.components.find((item) => item.id === 'subject')?.parameters).toMatchObject({ panel: true });
    expect(solar.components.find((item) => item.id === 'subject')?.parameters?.solar_moving).toBeUndefined();
  });

  it('maps explicit steering semantics into the animation contract', () => {
    const plan = twoBodyPlan('Electric go-kart', { primitive: 'wheel', role: 'front left road wheel', body_type: 'dynamic', semantic_tags: ['road-wheel', 'front-steering'] });
    const component = compileAgentPlan('Build a steering wheel display rig.', plan).components.find((item) => item.id === 'subject')!;
    expect(component.parameters).toMatchObject({ road_vehicle_wheel: true, road_vehicle_front_steering: true, steering_side: 'left' });
  });

  it('does not animate or weigh unrelated role substrings as payloads or rotors', () => {
    const deck = compileAgentPlan('Build a load-bearing deck frame.', twoBodyPlan('Load-bearing deck frame', { primitive: 'frame', role: 'load-bearing deck frame' })).components[1];
    expect(deck.parameters?.payload_kg).toBeUndefined();
    const shaft = compileAgentPlan('Build a stationary support shaft.', twoBodyPlan('Stationary support shaft', { primitive: 'shaft', role: 'stationary support shaft', body_type: 'dynamic' })).components[1];
    expect(shaft.parameters?.operation_spin).toBeUndefined();
  });

  it('derives joint anchors from body transforms instead of overlapping both local origins', () => {
    const plan = twoBodyPlan('Pivoting inspection arm', { primitive: 'beam', role: 'pivoting arm', position: [2, 1.2, 0], body_type: 'dynamic' });
    plan.joints = [{ id: 'pivot', joint_type: 'revolute', component_a: 'base', component_b: 'subject', axis: [0, 0, 1], limits: [-1, 1], ratio: 0, stiffness: 0, damping: 0 }];
    const joint = compileAgentPlan('Build a pivoting inspection arm.', plan).joints[0];
    expect(joint.anchorA).not.toEqual([0, 0, 0]);
    expect(joint.anchorB).not.toEqual([0, 0, 0]);
  });

  it('inverse-rotates shared world anchors into each body local frame', () => {
    const anchor = localAnchorAt({ position: [1, 2, 0], rotation: [0, 0, Math.PI / 2] }, [2, 2, 0]);
    expect(anchor[0]).toBeCloseTo(0, 3);
    expect(anchor[1]).toBeCloseTo(-1, 3);
    expect(anchor[2]).toBeCloseTo(0, 3);
  });

  it('preserves continuous revolute joints without manufacturing finite limits', () => {
    const plan = twoBodyPlan('Continuous test rotor', { primitive: 'shaft', role: 'continuous rotor shaft', body_type: 'dynamic', semantic_tags: ['rotor'] });
    plan.joints = [{ id: 'rotor-bearing', joint_type: 'revolute', component_a: 'base', component_b: 'subject', axis: [1, 0, 0], limits: null, ratio: 0, stiffness: 0, damping: 0 }];
    expect(compileAgentPlan('Build a continuous test rotor.', plan).joints[0].limits).toBeUndefined();
  });

  it('preserves a user-authored component cap instead of inflating the compiled budget', () => {
    const plan = twoBodyPlan('Concept carrier', { role: 'carrier subject body' });
    plan.requirements = [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 3, unit: '', source: 'user' }];
    expect(compileAgentPlan('Build a concept carrier with no more than 3 components.', plan).goal.maxComponents).toBe(3);

    plan.requirements = [{ ...plan.requirements[0], target: 1 }];
    expect(() => compileAgentPlan('Build a concept carrier with no more than 1 component.', plan)).toThrow(/explicit component-count limit of 1/i);
  });
});
