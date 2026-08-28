import type { ForgeState, MaterialSpec, PrimitiveCatalogItem, PrimitiveKind, Vec3, WorldSpec } from './forge-types';

export const materials: MaterialSpec[] = [
  { id: 'steel', name: 'Structural steel', density: 7850, friction: .62, restitution: .04, strength: 250, color: '#6e7d86' },
  { id: 'aluminum', name: '6061 aluminum', density: 2700, friction: .48, restitution: .08, strength: 155, color: '#a8b5bb' },
  { id: 'rubber', name: 'Industrial rubber', density: 1100, friction: 1.05, restitution: .18, strength: 18, color: '#20282d' },
  { id: 'polymer', name: 'Engineering polymer', density: 1180, friction: .38, restitution: .12, strength: 62, color: '#2d7190' },
  { id: 'composite', name: 'Carbon composite', density: 1600, friction: .42, restitution: .06, strength: 410, color: '#37464e' },
  { id: 'concrete', name: 'Reinforced concrete', density: 2400, friction: .82, restitution: .02, strength: 45, color: '#777a78' },
];

function primitive(id: PrimitiveKind, name: string, family: string, description: string, shape: PrimitiveCatalogItem['shape'], dimensions: Vec3, materialId: string, bodyType: PrimitiveCatalogItem['defaultBodyType'], capabilities: string[], color: string): PrimitiveCatalogItem {
  return { id, name, kind: id, family, description, shape, defaultDimensions: dimensions, defaultMaterial: materialId, defaultBodyType: bodyType, capabilities, color };
}

export const primitiveCatalog: PrimitiveCatalogItem[] = [
  primitive('beam', 'Parametric beam', 'Structure', 'Straight structural member sized by the agent.', 'box', [2, .18, .18], 'steel', 'fixed', ['span', 'brace', 'link', 'mast'], '#687982'),
  primitive('plate', 'Parametric plate', 'Structure', 'Flat load-bearing surface, deck, chassis, or panel.', 'box', [2, .16, 1.2], 'aluminum', 'fixed', ['deck', 'chassis', 'platform', 'panel'], '#527184'),
  primitive('frame', 'Frame member', 'Structure', 'Rigid base or housing assembled with other members.', 'box', [3, .22, 1.8], 'steel', 'fixed', ['base', 'housing', 'stability'], '#40545e'),
  primitive('support', 'Ground support', 'Structure', 'Foundation, outrigger, pier, or bearing support.', 'box', [.5, 1, .5], 'steel', 'fixed', ['foundation', 'outrigger', 'pier'], '#596971'),
  primitive('counterweight', 'Counterweight block', 'Structure', 'Explicit balancing mass with editable material and mass.', 'box', [1, .8, .8], 'concrete', 'dynamic', ['balance', 'stability'], '#877867'),
  primitive('wheel', 'Wheel primitive', 'Motion', 'Wheel collider with editable diameter, width, and friction.', 'cylinder', [.7, .28, .7], 'rubber', 'dynamic', ['rolling', 'traction'], '#1c252b'),
  primitive('shaft', 'Shaft primitive', 'Transmission', 'Rotating cylindrical shaft for wheels, gears, and pulleys.', 'cylinder', [.16, 1.2, .16], 'steel', 'dynamic', ['rotation', 'torque'], '#98a8ae'),
  primitive('gear', 'Parametric gear', 'Transmission', 'Pitch-radius and tooth-count driven rotating element.', 'cylinder', [1, .18, 1], 'steel', 'dynamic', ['ratio', 'torque', 'rotation'], '#d19b4f'),
  primitive('pulley', 'Pulley primitive', 'Transmission', 'Grooved rotary guide for cables and belts.', 'cylinder', [.55, .18, .55], 'steel', 'dynamic', ['redirect', 'hoist', 'belt'], '#bf8950'),
  primitive('belt', 'Flexible belt proxy', 'Transmission', 'Kinematic belt or cable-drive span.', 'box', [2.4, .06, .26], 'rubber', 'kinematic', ['transmit', 'transport'], '#2b3439'),
  primitive('cable', 'Cable primitive', 'Transmission', 'Tension-only rope proxy between anchors.', 'cylinder', [.035, 2, .035], 'steel', 'dynamic', ['tension', 'suspend'], '#c0ccd0'),
  primitive('spring', 'Spring-damper', 'Motion', 'Compliant member with editable stiffness and damping.', 'cylinder', [.14, .7, .14], 'steel', 'dynamic', ['suspension', 'compliance', 'return'], '#9aa8ae'),
  primitive('motor', 'Rotary motor', 'Actuation', 'Torque-limited motor attached to a revolute joint.', 'cylinder', [.42, .42, .42], 'steel', 'kinematic', ['drive', 'rotate', 'torque'], '#e6a246'),
  primitive('servo', 'Position servo', 'Actuation', 'Position-controlled rotary actuator.', 'box', [.48, .38, .48], 'aluminum', 'kinematic', ['position', 'joint', 'track'], '#f0a44a'),
  primitive('piston', 'Linear piston', 'Actuation', 'Force-limited linear actuator for lift, clamp, or push.', 'cylinder', [.24, 1.1, .24], 'steel', 'kinematic', ['lift', 'push', 'clamp'], '#efaa55'),
  primitive('sensor', 'Configurable sensor', 'Sensing', 'Distance, angle, force, load, IMU, light, or classification channel.', 'box', [.28, .24, .28], 'polymer', 'fixed', ['measure', 'feedback', 'classify'], '#48dceb'),
  primitive('camera', 'Vision camera', 'Sensing', 'Camera/frustum proxy for pose or class observations.', 'box', [.35, .28, .32], 'polymer', 'fixed', ['vision', 'pose', 'classify'], '#4fc9e5'),
  primitive('controller', 'Control computer', 'Control', 'Runs bounded declarative PID, tracking, timing, or state logic.', 'box', [.55, .34, .45], 'polymer', 'fixed', ['logic', 'feedback', 'interlock'], '#8b6bf5'),
  primitive('conveyor', 'Conveyor surface', 'Transport', 'Powered transport surface constructed with rollers and a motor.', 'box', [4, .18, 1.1], 'steel', 'fixed', ['transport', 'route', 'buffer'], '#2d424d'),
  primitive('roller', 'Conveyor roller', 'Transport', 'Driven or passive roller.', 'cylinder', [.18, 1, .18], 'steel', 'dynamic', ['transport', 'spacing'], '#60727b'),
  primitive('ramp', 'Ramp or guide', 'Transport', 'Inclined transfer, guide, or structural surface.', 'box', [2, .12, 1], 'aluminum', 'fixed', ['transfer', 'guide', 'incline'], '#58717e'),
  primitive('gripper', 'Parallel gripper', 'Manipulation', 'End-effector proxy made from two controlled fingers.', 'box', [.55, .25, .65], 'aluminum', 'kinematic', ['grip', 'release', 'handle'], '#d58f43'),
  primitive('hook', 'Load hook', 'Manipulation', 'Suspended attachment point for a payload.', 'capsule', [.18, .5, .18], 'steel', 'dynamic', ['attach', 'suspend'], '#d1a259'),
  primitive('container', 'Container or payload', 'Payload', 'Bin, package, load, or workpiece with explicit mass.', 'box', [.8, .6, .8], 'polymer', 'dynamic', ['payload', 'collect', 'load'], '#397da0'),
];

export const worldDefaults: WorldSpec = {
  gravity: [0, -9.81, 0],
  timestepHz: 60,
  duration: 8,
  bounds: [16, 10, 12],
  environment: 'bounded industrial lab',
  seed: 424242,
};

export interface EngineeringExample { id: string; sector: string; title: string; prompt: string }

export const engineeringExamples: EngineeringExample[] = [
  { id: 'sorter', sector: 'Logistics', title: 'Package sorter', prompt: 'Build a conveyor system that sorts red and blue boxes into separate bins at 20 boxes per minute.' },
  { id: 'crane', sector: 'Construction', title: 'Stable crane', prompt: 'Build a crane that lifts a 200 kg beam by 3 meters and places it within 10 cm without tipping.' },
  { id: 'rover', sector: 'Robotics', title: 'Payload rover', prompt: 'Build a four-wheel rover that carries 50 kg across rough terrain in under 20 seconds without tipping.' },
  { id: 'arm', sector: 'Automation', title: 'Robotic arm', prompt: 'Build a three-axis robotic arm with a gripper that reaches 2 meters and places a 12 kg part within 2 cm.' },
  { id: 'gearbox', sector: 'Powertrain', title: 'Reduction gearbox', prompt: 'Build a compact 4:1 gearbox that accepts 120 rpm and delivers at least 80 Nm of torque.' },
  { id: 'suspension', sector: 'Mobility', title: 'Rover suspension', prompt: 'Build a rover suspension that keeps a 30 kg payload within 8 degrees of level over uneven terrain.' },
  { id: 'solar', sector: 'Energy', title: 'Solar tracker', prompt: 'Build a single-axis solar tracker that follows a moving light source within 4 degrees using one actuator.' },
  { id: 'lift', sector: 'Medical', title: 'Patient lift', prompt: 'Build a lifting mechanism that raises a 90 kg patient load by 1 meter with acceleration below 0.5 m/s².' },
  { id: 'bridge', sector: 'Structures', title: 'Truss bridge', prompt: 'Build a 6 meter bridge that supports a 2000 kg moving load with less than 8 mm deflection.' },
  { id: 'warehouse', sector: 'Warehouse', title: 'Adaptive buffer', prompt: 'Build a warehouse buffer that prevents collisions while moving 30 packages per minute.' },
  { id: 'agriculture', sector: 'Agriculture', title: 'Gentle grader', prompt: 'Build a machine that sorts tomatoes by size while keeping drop height below 15 cm.' },
  { id: 'recycling', sector: 'Recycling', title: 'Material separator', prompt: 'Build a recycling machine that separates metal, plastic, and rejected objects into three containers.' },
  { id: 'drawbridge', sector: 'Novel composition', title: 'Counterweighted drawbridge', prompt: 'Build a 4 meter drawbridge that raises in under 15 seconds using a motor, pulley, and counterweight.' },
];

export function materialFor(id: string) {
  return materials.find((material) => material.id === id) ?? materials[0];
}

export function catalogFor(kind: PrimitiveKind) {
  const item = primitiveCatalog.find((candidate) => candidate.kind === kind);
  if (!item) throw new Error(`Unknown primitive: ${kind}`);
  return item;
}

export function componentMass(kind: PrimitiveKind, dimensions: Vec3, materialId: string) {
  const material = materialFor(materialId);
  const item = catalogFor(kind);
  const volume = item.shape === 'cylinder'
    ? Math.PI * Math.pow(Math.max(.01, dimensions[0]) / 2, 2) * Math.max(.01, dimensions[1])
    : item.shape === 'sphere'
      ? 4 / 3 * Math.PI * Math.pow(Math.max(.01, dimensions[0]) / 2, 3)
      : dimensions.reduce((product, value) => product * Math.max(.01, value), 1);
  const fill = ['beam', 'frame', 'support', 'ramp', 'conveyor'].includes(kind) ? .12 : ['gear', 'wheel', 'pulley'].includes(kind) ? .42 : .72;
  return Number(Math.max(.05, volume * material.density * fill).toFixed(2));
}

export function createInitialForgeState(screen: ForgeState['screen'] = 'landing'): ForgeState {
  return {
    schemaVersion: 3,
    workspaceId: 'FT-WORLD-01',
    workspaceNonce: crypto.randomUUID(),
    revision: 0,
    designRevision: 0,
    designHash: 'world-empty-00000000',
    phase: 'empty',
    screen,
    world: structuredClone(worldDefaults),
    goal: null,
    assemblies: [],
    components: [],
    connections: [],
    joints: [],
    motors: [],
    sensors: [],
    actuators: [],
    controls: [],
    optimizationLevel: 0,
    runs: [],
    revisions: [],
    humanConstraints: [],
    activity: [],
    activitySeq: 0,
    selectedComponentId: null,
    xray: false,
    replayRunId: null,
    replayMode: 'normal',
    compareOpen: false,
    catalogOpen: false,
  };
}
