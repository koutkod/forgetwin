import { describe, expect, it } from 'vitest';
import {
  agentPlanSchema,
  validateAgentPlanSemantics,
  type AgentPlan,
} from './forge-agent';

type Part = {
  id: string;
  primitive: AgentPlan['components'][number]['primitive'];
  role: string;
  bodyType?: AgentPlan['components'][number]['body_type'];
  position?: [number, number, number];
  dimensions?: [number, number, number];
  tags?: string[];
};

type Joint = AgentPlan['joints'][number];

const fixed = (id: string, componentA: string, componentB: string): Joint => ({
  id, joint_type: 'fixed', component_a: componentA, component_b: componentB,
  axis: [0, 1, 0], limits: null, ratio: 0, stiffness: 0, damping: 0,
});

const revolute = (id: string, componentA: string, componentB: string, axis: [number, number, number] = [0, 0, 1], limits: [number, number] | null = null): Joint => ({
  id, joint_type: 'revolute', component_a: componentA, component_b: componentB,
  axis, limits, ratio: 0, stiffness: 0, damping: 0,
});

const prismatic = (id: string, componentA: string, componentB: string, axis: [number, number, number], limits: [number, number]): Joint => ({
  id, joint_type: 'prismatic', component_a: componentA, component_b: componentB,
  axis, limits, ratio: 0, stiffness: 0, damping: 0,
});

function corpusPlan(input: {
  prompt: string;
  name: string;
  domain: string;
  capabilities: AgentPlan['capabilities'];
  parts: Part[];
  joints?: Joint[];
  requirements?: AgentPlan['requirements'];
  motors?: AgentPlan['motors'];
  sensors?: AgentPlan['sensors'];
  actuators?: AgentPlan['actuators'];
  controls?: AgentPlan['controls'];
  editable?: string;
}): AgentPlan {
  const components: AgentPlan['components'] = [
    {
      id: 'ground-base', primitive: 'support', assembly_id: 'machine', role: 'grounded safety base and test fixture',
      position: [0, .1, 0], rotation: [0, 0, 0], dimensions: [4, .2, 2.4], material_id: 'steel',
      body_type: 'fixed', mass: 80, color: '#475569', semantic_tags: [],
    },
    ...input.parts.map((part, index) => ({
      id: part.id, primitive: part.primitive, assembly_id: 'machine', role: part.role,
      position: part.position ?? [((index % 5) - 2) * .65, .55 + Math.floor(index / 5) * .55, index % 2 ? .55 : -.55] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number], dimensions: part.dimensions ?? [.6, .3, .4] as [number, number, number],
      material_id: part.primitive === 'wheel' || part.primitive === 'belt' ? 'rubber' as const : 'steel' as const,
      body_type: part.bodyType ?? 'fixed', mass: part.bodyType === 'dynamic' ? 4 : 8,
      color: part.primitive === 'motor' || part.primitive === 'servo' ? '#0ea5e9' : '#94a3b8', semantic_tags: part.tags ?? [],
    })),
  ];

  const joints = [...(input.joints ?? [])];
  const intentionallyFree = new Set(['payload', 'package-red', 'package-blue', 'shipping-carton', 'tomato-ripe', 'tomato-reject', 'metal-can', 'plastic-bottle', 'reject-object']);
  const reachable = new Set(['ground-base']);
  let changed = true;
  while (changed) {
    changed = false;
    for (const joint of joints) {
      if (reachable.has(joint.component_a) && !reachable.has(joint.component_b)) { reachable.add(joint.component_b); changed = true; }
      if (reachable.has(joint.component_b) && !reachable.has(joint.component_a)) { reachable.add(joint.component_a); changed = true; }
    }
  }
  for (const part of input.parts) {
    if (reachable.has(part.id) || part.tags?.some((tag) => intentionallyFree.has(tag))) continue;
    joints.push(fixed(`mount-${part.id}`, 'ground-base', part.id));
    reachable.add(part.id);
  }

  return agentPlanSchema.parse({
    normalized_prompt: input.prompt,
    machine_name: input.name,
    domain: input.domain,
    reasoning_summary: `Build the ${input.name} as one grounded, connected and recognizable mechanism with an explicit load path, motion path, and drive path.`,
    architecture: [`recognizable ${input.name}`, 'grounded structural load path', 'joint-coupled operating mechanism'],
    assumptions: ['Concept-level guarded physics model'],
    capabilities: input.capabilities,
    requirements: input.requirements ?? [{ metric: 'component_count', label: 'Physical bodies', operator: 'max', target: 40, unit: '', source: 'inferred' }],
    assemblies: [{ id: 'machine', name: input.name, purpose: `Complete ${input.name} concept assembly`, parent_id: '' }],
    components,
    connections: [], joints,
    motors: input.motors ?? [], sensors: input.sensors ?? [], actuators: input.actuators ?? [], controls: input.controls ?? [],
    editable_component_id: input.editable ?? input.parts[0].id,
  });
}

const corpus = [
  {
    label: 'crane', prompt: 'Build a compact crane that lifts a 100 kg payload.',
    plan: corpusPlan({
      prompt: 'Build a compact crane that lifts a 100 kg payload.', name: 'Compact crane', domain: 'Lifting equipment', capabilities: ['structure', 'lift', 'suspend'],
      requirements: [{ metric: 'payload_capacity', label: 'Rated payload', operator: 'min', target: 100, unit: 'kg', source: 'user' }],
      parts: [
        { id: 'mast', primitive: 'beam', role: 'vertical crane mast' },
        { id: 'boom', primitive: 'beam', role: 'pivoting crane boom', bodyType: 'dynamic' },
        { id: 'cable', primitive: 'cable', role: 'hoist cable', bodyType: 'dynamic' },
        { id: 'hook', primitive: 'hook', role: '100 kg load hook', bodyType: 'dynamic', tags: ['payload'] },
        { id: 'hoist-motor', primitive: 'motor', role: 'joint-coupled hoist motor' },
      ],
      joints: [fixed('mast-mount', 'ground-base', 'mast'), revolute('boom-pivot', 'mast', 'boom', [0, 0, 1], [-.2, .9]), fixed('cable-boom', 'boom', 'cable'), { id: 'hook-rope', joint_type: 'rope', component_a: 'cable', component_b: 'hook', axis: [0, 1, 0], limits: [0, 1.5], ratio: 0, stiffness: 5000, damping: 200 }],
      motors: [{ id: 'hoist-drive', component_id: 'hoist-motor', joint_id: 'boom-pivot', max_torque: 1800, max_rpm: 24, direction: 1 }], editable: 'boom',
    }),
  },
  {
    label: 'rover', prompt: 'Build a four-wheel rover that carries a 5 kg payload over rough terrain.',
    plan: corpusPlan({
      prompt: 'Build a four-wheel rover that carries a 5 kg payload over rough terrain.', name: 'Four-wheel payload rover', domain: 'Mobile robotics', capabilities: ['structure', 'mobile', 'stabilize'],
      requirements: [{ metric: 'payload_capacity', label: 'Payload capacity', operator: 'min', target: 5, unit: 'kg', source: 'user' }],
      parts: [
        { id: 'chassis', primitive: 'frame', role: 'load-bearing rover chassis' },
        ...['front-left', 'front-right', 'rear-left', 'rear-right'].map((corner) => ({ id: `${corner}-wheel`, primitive: 'wheel' as const, role: `${corner} rover road wheel`, bodyType: 'dynamic' as const, tags: ['road-wheel'] })),
        { id: 'traction-motor', primitive: 'motor', role: 'electric rover traction motor' },
        { id: 'payload-deck', primitive: 'plate', role: '5 kg payload deck', tags: ['payload'] },
      ],
      joints: [
        fixed('chassis-mount', 'ground-base', 'chassis'),
        ...['front-left', 'front-right', 'rear-left', 'rear-right'].map((corner) => revolute(`${corner}-bearing`, 'chassis', `${corner}-wheel`)),
      ],
      motors: [{ id: 'traction-drive', component_id: 'traction-motor', joint_id: 'rear-left-bearing', max_torque: 90, max_rpm: 240, direction: 1 }], editable: 'chassis',
    }),
  },
  {
    label: 'go-kart', prompt: 'Build an electric go-kart with four wheels, steering, accelerator, and brake pedals.',
    plan: corpusPlan({
      prompt: 'Build an electric go-kart with four wheels, steering, accelerator, and brake pedals.', name: 'Electric go-kart', domain: 'Light electric vehicle', capabilities: ['structure', 'mobile', 'stabilize'],
      parts: [
        { id: 'kart-frame', primitive: 'frame', role: 'low tubular go-kart chassis frame' },
        ...['front-left', 'front-right', 'rear-left', 'rear-right'].map((corner) => ({ id: `${corner}-wheel`, primitive: 'wheel' as const, role: `${corner} go-kart road wheel`, bodyType: 'dynamic' as const, tags: ['road-wheel', ...(corner.startsWith('front') ? ['front-steering'] : [])] })),
        { id: 'steering-rack', primitive: 'shaft', role: 'steering rack and tie-rod mechanism', bodyType: 'dynamic' },
        { id: 'steering-servo', primitive: 'servo', role: 'steering servo actuator' },
        { id: 'drive-motor', primitive: 'motor', role: 'rear axle traction motor' },
        { id: 'accelerator-pedal', primitive: 'plate', role: 'right accelerator pedal' },
        { id: 'brake-pedal', primitive: 'plate', role: 'left brake pedal' },
        { id: 'seat', primitive: 'plate', role: 'bucket seat pan' },
      ],
      joints: [
        fixed('frame-mount', 'ground-base', 'kart-frame'),
        ...['front-left', 'front-right', 'rear-left', 'rear-right'].map((corner) => revolute(`${corner}-bearing`, 'kart-frame', `${corner}-wheel`)),
        prismatic('rack-travel', 'kart-frame', 'steering-rack', [0, 0, 1], [-.2, .2]),
      ],
      motors: [{ id: 'rear-drive', component_id: 'drive-motor', joint_id: 'rear-left-bearing', max_torque: 120, max_rpm: 480, direction: 1 }],
      actuators: [{ id: 'steering-drive', component_id: 'steering-servo', joint_id: 'rack-travel', actuator_type: 'servo', max_force: 800, max_speed: .7, travel: .4 }], editable: 'kart-frame',
    }),
  },
  {
    label: 'bicycle', prompt: 'Build an electric bicycle with a diamond frame, two wheels, handlebars, pedals, and chain drive.',
    plan: corpusPlan({
      prompt: 'Build an electric bicycle with a diamond frame, two wheels, handlebars, pedals, and chain drive.', name: 'Electric bicycle', domain: 'Personal mobility', capabilities: ['structure', 'mobile', 'transmit'],
      parts: [
        { id: 'down-tube', primitive: 'beam', role: 'bicycle diamond frame down tube' }, { id: 'top-tube', primitive: 'beam', role: 'bicycle diamond frame top tube' },
        { id: 'front-wheel', primitive: 'wheel', role: 'front bicycle steering wheel', bodyType: 'dynamic', tags: ['bicycle-wheel', 'front-steering'] },
        { id: 'rear-wheel', primitive: 'wheel', role: 'rear bicycle drive wheel', bodyType: 'dynamic', tags: ['bicycle-wheel'] },
        { id: 'handlebar', primitive: 'shaft', role: 'handlebar and steering stem' }, { id: 'crank', primitive: 'gear', role: 'pedal crank chainring', bodyType: 'dynamic' },
        { id: 'chain', primitive: 'belt', role: 'bicycle roller chain drive' }, { id: 'hub-motor', primitive: 'motor', role: 'electric pedal-assist hub motor' },
      ],
      joints: [fixed('frame-joint', 'ground-base', 'down-tube'), fixed('top-joint', 'down-tube', 'top-tube'), revolute('front-bearing', 'top-tube', 'front-wheel'), revolute('rear-bearing', 'down-tube', 'rear-wheel'), revolute('crank-bearing', 'down-tube', 'crank'), fixed('chain-mount', 'crank', 'chain')],
      motors: [{ id: 'assist-drive', component_id: 'hub-motor', joint_id: 'rear-bearing', max_torque: 55, max_rpm: 260, direction: 1 }], editable: 'down-tube',
    }),
  },
  {
    label: 'scissor lift', prompt: 'Build a scissor lift that raises a 120 kg load by 1 meter.',
    plan: corpusPlan({
      prompt: 'Build a scissor lift that raises a 120 kg load by 1 meter.', name: 'Hydraulic scissor lift', domain: 'Material handling', capabilities: ['structure', 'lift', 'stabilize'],
      requirements: [
        { metric: 'payload_capacity', label: 'Rated load', operator: 'min', target: 120, unit: 'kg', source: 'user' },
        { metric: 'lift_height', label: 'Vertical travel', operator: 'min', target: 1, unit: 'm', source: 'user' },
      ],
      parts: [
        ...['left-lower', 'left-upper', 'right-lower', 'right-upper'].map((side) => ({ id: `${side}-arm`, primitive: 'beam' as const, role: `${side} crossed scissor lift link`, bodyType: 'dynamic' as const })),
        { id: 'lift-platform', primitive: 'plate', role: '120 kg lifting platform', bodyType: 'dynamic', tags: ['payload'] },
        { id: 'lift-cylinder', primitive: 'piston', role: 'hydraulic lift cylinder' },
      ],
      joints: [
        revolute('left-lower-pivot', 'ground-base', 'left-lower-arm', [0, 0, 1], [0, 1.2]), revolute('left-cross', 'left-lower-arm', 'left-upper-arm', [0, 0, 1], [0, 1.5]),
        revolute('right-lower-pivot', 'ground-base', 'right-lower-arm', [0, 0, 1], [0, 1.2]), revolute('right-cross', 'right-lower-arm', 'right-upper-arm', [0, 0, 1], [0, 1.5]),
        revolute('left-platform-pivot', 'left-upper-arm', 'lift-platform', [0, 0, 1], [-.25, .25]),
        revolute('right-platform-pivot', 'right-upper-arm', 'lift-platform', [0, 0, 1], [-.25, .25]),
        prismatic('platform-travel', 'ground-base', 'lift-platform', [0, 1, 0], [0, 1]),
      ],
      actuators: [{ id: 'hydraulic-drive', component_id: 'lift-cylinder', joint_id: 'platform-travel', actuator_type: 'piston', max_force: 35000, max_speed: .18, travel: 1 }], editable: 'lift-platform',
    }),
  },
  {
    label: 'pump', prompt: 'Build a centrifugal water pump that delivers 50 liters per minute.',
    plan: corpusPlan({
      prompt: 'Build a centrifugal water pump that delivers 50 liters per minute.', name: 'Centrifugal water pump', domain: 'Fluid machinery', capabilities: ['structure', 'rotate'],
      requirements: [{ metric: 'flow_rate', label: 'Water flow', operator: 'min', target: 50, unit: 'L/min', source: 'user' }],
      parts: [
        { id: 'volute', primitive: 'frame', role: 'centrifugal pump volute casing' }, { id: 'inlet-port', primitive: 'container', role: 'axial water inlet suction port' },
        { id: 'outlet-port', primitive: 'container', role: 'tangential water discharge outlet port' }, { id: 'pump-shaft', primitive: 'shaft', role: 'supported impeller shaft', bodyType: 'dynamic', tags: ['rotor'] },
        { id: 'impeller', primitive: 'gear', role: 'multi-vane centrifugal pump impeller', bodyType: 'dynamic', tags: ['rotor'] }, { id: 'pump-motor', primitive: 'motor', role: 'electric pump motor' },
      ],
      joints: [revolute('shaft-bearing', 'ground-base', 'pump-shaft', [1, 0, 0]), fixed('impeller-key', 'pump-shaft', 'impeller')],
      motors: [{ id: 'impeller-drive', component_id: 'pump-motor', joint_id: 'shaft-bearing', max_torque: 18, max_rpm: 2800, direction: 1 }], editable: 'volute',
    }),
  },
  {
    label: 'press', prompt: 'Build a hydraulic shop press that applies 20 kN through a guided ram.',
    plan: corpusPlan({
      prompt: 'Build a hydraulic shop press that applies 20 kN through a guided ram.', name: 'Hydraulic shop press', domain: 'Forming equipment', capabilities: ['structure', 'manipulate'],
      requirements: [{ metric: 'clamp_force', label: 'Press force', operator: 'min', target: 20000, unit: 'N', source: 'user' }],
      parts: [
        { id: 'left-upright', primitive: 'beam', role: 'left press frame upright' }, { id: 'right-upright', primitive: 'beam', role: 'right press frame upright' },
        { id: 'crown', primitive: 'beam', role: 'upper press crown crossmember' }, { id: 'bed', primitive: 'plate', role: 'lower work support bed platen' },
        { id: 'ram', primitive: 'plate', role: 'guided moving press ram platen', bodyType: 'dynamic' }, { id: 'press-cylinder', primitive: 'piston', role: '20 kN hydraulic press cylinder' },
      ],
      joints: [prismatic('ram-guide', 'crown', 'ram', [0, 1, 0], [-.8, 0])],
      actuators: [{ id: 'ram-drive', component_id: 'press-cylinder', joint_id: 'ram-guide', actuator_type: 'piston', max_force: 20000, max_speed: .08, travel: .8 }], editable: 'ram',
    }),
  },
  {
    label: 'gearbox', prompt: 'Build a 4:1 reduction gearbox that produces at least 80 N-m of output torque.',
    plan: corpusPlan({
      prompt: 'Build a 4:1 reduction gearbox that produces at least 80 N-m of output torque.', name: '4 to 1 reduction gearbox', domain: 'Power transmission', capabilities: ['structure', 'transmit', 'rotate'],
      requirements: [
        { metric: 'speed_ratio', label: 'Reduction ratio', operator: 'exact', target: 4, unit: '', source: 'user' },
        { metric: 'output_torque', label: 'Output torque', operator: 'min', target: 80, unit: 'N-m', source: 'user' },
      ],
      parts: [
        { id: 'input-shaft', primitive: 'shaft', role: 'high-speed input shaft', bodyType: 'dynamic', tags: ['rotor'] }, { id: 'input-gear', primitive: 'gear', role: '20 tooth input pinion', bodyType: 'dynamic' },
        { id: 'output-shaft', primitive: 'shaft', role: 'low-speed output shaft', bodyType: 'dynamic', tags: ['rotor'] }, { id: 'output-gear', primitive: 'gear', role: '80 tooth output gear', bodyType: 'dynamic' },
        { id: 'gearbox-motor', primitive: 'motor', role: 'gearbox input drive motor' }, { id: 'housing', primitive: 'frame', role: 'bearing-supported gearbox housing' },
      ],
      joints: [revolute('input-bearing', 'ground-base', 'input-shaft', [1, 0, 0]), fixed('input-key', 'input-shaft', 'input-gear'), revolute('output-bearing', 'ground-base', 'output-shaft', [1, 0, 0]), fixed('output-key', 'output-shaft', 'output-gear'), { id: 'gear-mesh', joint_type: 'gear', component_a: 'input-gear', component_b: 'output-gear', axis: [1, 0, 0], limits: null, ratio: 4, stiffness: 0, damping: 0 }],
      motors: [{ id: 'input-drive', component_id: 'gearbox-motor', joint_id: 'input-bearing', max_torque: 24, max_rpm: 1200, direction: 1 }], editable: 'housing',
    }),
  },
  {
    label: 'solar tracker', prompt: 'Build a solar tracker that keeps a panel within 5 degrees of a moving light source.',
    plan: corpusPlan({
      prompt: 'Build a solar tracker that keeps a panel within 5 degrees of a moving light source.', name: 'Single-axis solar tracker', domain: 'Renewable energy', capabilities: ['structure', 'track', 'rotate'],
      requirements: [{ metric: 'tracking_error', label: 'Sun tracking error', operator: 'max', target: 5, unit: 'deg', source: 'user' }],
      parts: [
        { id: 'tracker-mast', primitive: 'beam', role: 'ground-mounted tracker mast' }, { id: 'panel-frame', primitive: 'frame', role: 'rotating solar panel support frame', bodyType: 'dynamic', tags: ['solar-panel', 'solar-moving'] },
        { id: 'solar-panel', primitive: 'plate', role: 'photovoltaic solar panel array', tags: ['solar-panel'] }, { id: 'slew-motor', primitive: 'motor', role: 'single-axis tracking slew motor' },
        { id: 'light-sensor', primitive: 'sensor', role: 'dual light tracking sensor' },
      ],
      joints: [fixed('mast-foundation', 'ground-base', 'tracker-mast'), revolute('tracking-axis', 'tracker-mast', 'panel-frame', [0, 0, 1], [-1.2, 1.2]), fixed('panel-mount', 'panel-frame', 'solar-panel')],
      motors: [{ id: 'tracking-drive', component_id: 'slew-motor', joint_id: 'tracking-axis', max_torque: 240, max_rpm: 4, direction: 1 }],
      sensors: [{ id: 'sun-feedback', component_id: 'light-sensor', sensor_type: 'light', channel: 'light-angle', target_id: 'solar-panel', range: 20 }], editable: 'panel-frame',
    }),
  },
  {
    label: 'suspension', prompt: 'Build an independent car suspension with a wheel, control arms, coil spring, and damper.',
    plan: corpusPlan({
      prompt: 'Build an independent car suspension with a wheel, control arms, coil spring, and damper.', name: 'Independent car suspension', domain: 'Automotive chassis', capabilities: ['structure', 'suspend', 'stabilize'],
      parts: [
        { id: 'subframe', primitive: 'frame', role: 'vehicle suspension subframe' }, { id: 'upper-arm', primitive: 'beam', role: 'upper suspension control arm', bodyType: 'dynamic', tags: ['suspension-arm'] },
        { id: 'lower-arm', primitive: 'beam', role: 'lower suspension control arm', bodyType: 'dynamic', tags: ['suspension-arm'] }, { id: 'hub-wheel', primitive: 'wheel', role: 'suspension upright and road wheel', bodyType: 'dynamic', tags: ['suspension-wheel'] },
        { id: 'coil-spring', primitive: 'spring', role: 'coil suspension spring', bodyType: 'dynamic', tags: ['suspension-spring'] }, { id: 'damper', primitive: 'piston', role: 'hydraulic shock damper' },
      ],
      joints: [fixed('subframe-mount', 'ground-base', 'subframe'), revolute('upper-pivot', 'subframe', 'upper-arm', [0, 0, 1], [-.4, .4]), revolute('lower-pivot', 'subframe', 'lower-arm', [0, 0, 1], [-.4, .4]), revolute('wheel-bearing', 'lower-arm', 'hub-wheel'), { id: 'spring-travel', joint_type: 'spring', component_a: 'subframe', component_b: 'coil-spring', axis: [0, 1, 0], limits: [-.18, .18], ratio: 0, stiffness: 18000, damping: 1200 }], editable: 'coil-spring',
    }),
  },
  {
    label: 'bridge', prompt: 'Build a truss bridge that spans 12 meters and supports a 1000 kg load.',
    plan: corpusPlan({
      prompt: 'Build a truss bridge that spans 12 meters and supports a 1000 kg load.', name: '12 meter truss bridge', domain: 'Structural engineering', capabilities: ['structure'],
      requirements: [
        { metric: 'span', label: 'Clear span', operator: 'min', target: 12, unit: 'm', source: 'user' },
        { metric: 'load_capacity', label: 'Supported load', operator: 'min', target: 1000, unit: 'kg', source: 'user' },
      ],
      parts: [
        { id: 'left-abutment', primitive: 'support', role: 'left concrete bridge abutment' }, { id: 'right-abutment', primitive: 'support', role: 'right concrete bridge abutment' },
        { id: 'deck', primitive: 'plate', role: '12 meter bridge deck', dimensions: [12, .25, 2.4] },
        ...['left-bottom', 'right-bottom', 'left-top', 'right-top', 'diagonal-one', 'diagonal-two'].map((id) => ({ id, primitive: 'beam' as const, role: `${id} truss bridge member` })),
      ],
      joints: [
        fixed('left-seat', 'left-abutment', 'left-bottom'), fixed('left-post', 'left-bottom', 'left-top'),
        fixed('first-diagonal', 'left-top', 'diagonal-one'), fixed('first-panel', 'diagonal-one', 'right-bottom'),
        fixed('right-post', 'right-bottom', 'right-top'), fixed('second-diagonal', 'right-top', 'diagonal-two'),
        fixed('right-seat', 'diagonal-two', 'right-abutment'), fixed('left-deck-joint', 'left-bottom', 'deck'),
        fixed('right-deck-joint', 'deck', 'right-bottom'),
      ], editable: 'deck',
    }),
  },
  {
    label: 'conveyor', prompt: 'Build a powered conveyor that moves 20 boxes per minute.',
    plan: corpusPlan({
      prompt: 'Build a powered conveyor that moves 20 boxes per minute.', name: 'Powered box conveyor', domain: 'Material handling', capabilities: ['structure', 'transport'],
      requirements: [{ metric: 'throughput', label: 'Box throughput', operator: 'min', target: 20, unit: '/min', source: 'user' }],
      parts: [
        { id: 'belt-bed', primitive: 'conveyor', role: 'powered box transport conveyor belt', bodyType: 'dynamic', tags: ['conveyor'] },
        { id: 'drive-roller', primitive: 'roller', role: 'conveyor drive roller', bodyType: 'dynamic' }, { id: 'tail-roller', primitive: 'roller', role: 'conveyor tail roller', bodyType: 'dynamic' },
        { id: 'belt-motor', primitive: 'motor', role: 'conveyor gear motor' }, { id: 'shipping-box', primitive: 'container', role: 'shipping box workpiece', bodyType: 'dynamic', tags: ['shipping-carton'] },
      ],
      joints: [revolute('belt-drive-axis', 'ground-base', 'belt-bed'), revolute('drive-bearing', 'ground-base', 'drive-roller'), revolute('tail-bearing', 'ground-base', 'tail-roller')],
      motors: [{ id: 'conveyor-drive', component_id: 'belt-motor', joint_id: 'belt-drive-axis', max_torque: 45, max_rpm: 90, direction: 1 }], editable: 'belt-bed',
    }),
  },
  {
    label: 'agricultural sorter', prompt: 'Build a tomato grader that sorts red and green tomatoes into separate bins at 15 items per minute while keeping drops under 15 cm.',
    plan: corpusPlan({
      prompt: 'Build a tomato grader that sorts red and green tomatoes into separate bins at 15 items per minute while keeping drops under 15 cm.', name: 'Gentle tomato grader', domain: 'Agricultural automation', capabilities: ['structure', 'transport', 'classify', 'contain'],
      requirements: [
        { metric: 'throughput', label: 'Tomato throughput', operator: 'min', target: 15, unit: '/min', source: 'user' },
        { metric: 'drop_height', label: 'Maximum tomato drop', operator: 'max', target: 15, unit: 'cm', source: 'user' },
      ],
      parts: [
        { id: 'grading-belt', primitive: 'conveyor', role: 'gentle tomato inspection conveyor', bodyType: 'dynamic', tags: ['conveyor'] },
        { id: 'vision-camera', primitive: 'camera', role: 'red and green tomato color camera' }, { id: 'good-bin', primitive: 'container', role: 'red ripe tomato output bin' },
        { id: 'green-bin', primitive: 'container', role: 'green tomato reject output bin' }, { id: 'diverter', primitive: 'ramp', role: 'low-drop tomato sorting diverter', bodyType: 'dynamic' },
        { id: 'diverter-servo', primitive: 'servo', role: 'tomato diverter servo' }, { id: 'belt-motor', primitive: 'motor', role: 'grader conveyor motor' },
        { id: 'red-tomato', primitive: 'container', role: 'individual red tomato', bodyType: 'dynamic', tags: ['tomato-ripe'] },
        { id: 'green-tomato', primitive: 'container', role: 'individual green tomato', bodyType: 'dynamic', tags: ['tomato-reject'] },
      ],
      joints: [revolute('grader-drive-axis', 'ground-base', 'grading-belt'), revolute('diverter-hinge', 'ground-base', 'diverter', [0, 1, 0], [-.55, .55])],
      motors: [{ id: 'grader-drive', component_id: 'belt-motor', joint_id: 'grader-drive-axis', max_torque: 30, max_rpm: 50, direction: 1 }],
      sensors: [{ id: 'color-inspection', component_id: 'vision-camera', sensor_type: 'color', channel: 'tomato-color', target_id: 'grading-belt', range: 2 }],
      actuators: [{ id: 'diverter-drive', component_id: 'diverter-servo', joint_id: 'diverter-hinge', actuator_type: 'servo', max_force: 250, max_speed: 1.2, travel: 1.1 }], editable: 'diverter',
    }),
  },
  {
    label: 'robotic arm', prompt: 'Build a robotic arm that reaches 1.2 meters and lifts a 5 kg payload with a gripper.',
    plan: corpusPlan({
      prompt: 'Build a robotic arm that reaches 1.2 meters and lifts a 5 kg payload with a gripper.', name: 'Articulated robotic arm', domain: 'Industrial robotics', capabilities: ['structure', 'manipulate', 'lift'],
      requirements: [
        { metric: 'reach', label: 'Arm reach', operator: 'min', target: 1.2, unit: 'm', source: 'user' },
        { metric: 'payload_capacity', label: 'Payload capacity', operator: 'min', target: 5, unit: 'kg', source: 'user' },
      ],
      parts: [
        { id: 'upper-arm', primitive: 'beam', role: 'robot shoulder upper arm link', bodyType: 'dynamic' }, { id: 'forearm', primitive: 'beam', role: 'robot elbow forearm link', bodyType: 'dynamic' },
        { id: 'wrist', primitive: 'shaft', role: 'robot wrist roll link', bodyType: 'dynamic' }, { id: 'gripper', primitive: 'gripper', role: '5 kg two-jaw robot gripper' },
        { id: 'shoulder-servo', primitive: 'servo', role: 'shoulder joint servo' }, { id: 'elbow-servo', primitive: 'servo', role: 'elbow joint servo' }, { id: 'wrist-servo', primitive: 'servo', role: 'wrist joint servo' },
      ],
      joints: [revolute('shoulder-joint', 'ground-base', 'upper-arm', [0, 1, 0], [-2, 2]), revolute('elbow-joint', 'upper-arm', 'forearm', [0, 0, 1], [-2.2, 2.2]), revolute('wrist-joint', 'forearm', 'wrist', [1, 0, 0], [-2.8, 2.8]), fixed('gripper-mount', 'wrist', 'gripper')],
      actuators: [
        { id: 'shoulder-drive', component_id: 'shoulder-servo', joint_id: 'shoulder-joint', actuator_type: 'servo', max_force: 1800, max_speed: 1.2, travel: 4 },
        { id: 'elbow-drive', component_id: 'elbow-servo', joint_id: 'elbow-joint', actuator_type: 'servo', max_force: 1200, max_speed: 1.4, travel: 4.4 },
        { id: 'wrist-drive', component_id: 'wrist-servo', joint_id: 'wrist-joint', actuator_type: 'servo', max_force: 400, max_speed: 2, travel: 5.6 },
      ], editable: 'gripper',
    }),
  },
] as const;

describe('diverse mechanical prompt-fidelity corpus', () => {
  it.each(corpus)('accepts a recognizable, connected $label design', ({ prompt, plan }) => {
    expect(() => validateAgentPlanSemantics(plan, prompt)).not.toThrow();
  });

  it.each(corpus)('rejects an unrelated driven two-beam rig for a $label request', ({ prompt, plan }) => {
    const impostor = corpusPlan({
      prompt,
      name: plan.machine_name,
      domain: plan.domain,
      capabilities: plan.capabilities,
      requirements: plan.requirements,
      parts: [
        { id: 'generic-frame', primitive: 'beam', role: `${plan.machine_name} generic frame` },
        { id: 'generic-link', primitive: 'beam', role: `${plan.machine_name} generic moving link`, bodyType: 'dynamic' },
        { id: 'generic-motor', primitive: 'motor', role: `${plan.machine_name} generic motor` },
      ],
      joints: [revolute('generic-pivot', 'generic-frame', 'generic-link', [0, 0, 1], [-.5, .5])],
      motors: [{ id: 'generic-drive', component_id: 'generic-motor', joint_id: 'generic-pivot', max_torque: 20, max_rpm: 30, direction: 1 }],
      editable: 'generic-link',
    });
    expect(() => validateAgentPlanSemantics(impostor, prompt)).toThrow(/physical signature|drops the explicit request/i);
  });

  it.each([
    ['pump flow', corpus.find((item) => item.label === 'pump')!, 'flow_rate'],
    ['press force', corpus.find((item) => item.label === 'press')!, 'clamp_force'],
    ['solar tracking tolerance', corpus.find((item) => item.label === 'solar tracker')!, 'tracking_error'],
  ])('does not silently drop an explicit %s constraint', (_label, item, metric) => {
    const withoutTarget = { ...item.plan, requirements: item.plan.requirements.filter((requirement) => requirement.metric !== metric) };
    expect(() => validateAgentPlanSemantics(withoutTarget, item.prompt)).toThrow(/drops or misstates/i);
  });
});
