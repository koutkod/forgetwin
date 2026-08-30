import { describe, expect, it } from 'vitest';
import type { AgentPlan } from './forge-agent';
import { compileAgentPlan, localAnchorAt } from './forge-model-plan';

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
