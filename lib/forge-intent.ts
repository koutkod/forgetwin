import type { Capability, CompiledWorldPlan, MachineOrientation, PrimitiveKind, Vec3 } from './forge-types';

export const FORGE_COORDINATE_CONVENTION: MachineOrientation = {
  front: '+X',
  up: '+Y',
  down: '-Y',
  forward: '+X',
  rear: '-X',
  left: '-Z',
  right: '+Z',
  vectors: { front: [1, 0, 0], rear: [-1, 0, 0], left: [0, 0, -1], right: [0, 0, 1], up: [0, 1, 0], down: [0, -1, 0] },
  description: 'Universal ForgeTwin frame: front/forward +X, rear -X, left -Z, right +Z, up +Y, and down -Y.',
};

export interface IntentCorrection { from: string; to: string; reason: string }

export interface NormalizedEngineeringIntent {
  rawRequest: string;
  normalizedRequest: string;
  corrections: IntentCorrection[];
  machineType: string;
  scope: 'part' | 'subassembly' | 'machine' | 'production-cell' | 'compound-system';
  functions: string[];
  requiredSubsystems: string[];
  directions: typeof FORGE_COORDINATE_CONVENTION;
}

const TERM_CORRECTIONS: Array<{ pattern: RegExp; replacement: string; reason: string }> = [
  { pattern: /\b(?:dirt bike|motocycle|motor cycle|motor-bike)\b/gi, replacement: 'motorcycle', reason: 'canonical vehicle term' },
  { pattern: /\b(?:e[- ]?bike|electric bike)\b/gi, replacement: 'electric bicycle', reason: 'canonical vehicle term' },
  { pattern: /\b(?:bycicle|byclicle|bicicle|bicycel|bicyclee|biek|biike|bike)\b/gi, replacement: 'bicycle', reason: 'common bicycle term or misspelling' },
  { pattern: /\b(?:go\s*cart|go-cart|gokart)\b/gi, replacement: 'go-kart', reason: 'canonical vehicle term' },
  { pattern: /\b(?:airplnae|airplance|airpane|aeroplane|air plane)\b/gi, replacement: 'airplane', reason: 'common airplane misspelling' },
];

function replaceWithAudit(value: string, corrections: IntentCorrection[], pattern: RegExp, replacement: string, reason: string) {
  return value.replace(pattern, (match) => {
    if (match.toLowerCase() !== replacement.toLowerCase()) corrections.push({ from: match, to: replacement, reason });
    return replacement;
  });
}

function classifyMachine(text: string) {
  const mechanismText = text.replace(/\b(?:brake|tail|rear) lights?\b/g, 'vehicle-light');
  if (/\b(?:bicycle|bike)\b[^.]{0,40}\b(?:brake|caliper)\b|\b(?:brake|caliper)\b[^.]{0,40}\b(?:bicycle|bike)\b/.test(mechanismText)) return { machineType: 'bicycle-brake-assembly', requiredSubsystems: ['rotor or rim interface', 'caliper', 'pads', 'actuation input'] };
  if (/\bbicycle\b/.test(text)) return { machineType: 'bicycle', requiredSubsystems: ['frame', 'two wheels', 'steering', 'seat', 'drivetrain'] };
  if (/\b(?:motorcycle|motorbike|scooter)\b/.test(text)) return { machineType: 'motorcycle', requiredSubsystems: ['tubular frame', 'two wheels', 'steering fork', 'front and rear suspension', 'seat', 'powertrain', 'front and rear brakes', 'lighting'] };
  if (/\b(?:airplane|fixed-wing aircraft)\b/.test(text)) return { machineType: 'fixed-wing-aircraft', requiredSubsystems: ['fuselage', 'left wing', 'right wing', 'tail surfaces', 'propulsion', 'landing gear'] };
  if (/\b(?:go-kart|kart)\b/.test(text)) return { machineType: 'go-kart', requiredSubsystems: ['chassis', 'four wheels', 'steering', 'seat', 'powertrain', 'brakes'] };
  if (/\b(?:helicopter|rotorcraft)\b/.test(text)) return { machineType: 'helicopter', requiredSubsystems: ['fuselage', 'main rotor', 'tail rotor', 'landing support', 'powertrain'] };
  if (/\b(?:conveyor|sorting line|production line)\b/.test(text)) return { machineType: 'material-flow-system', requiredSubsystems: ['grounded frame', 'transport surface', 'drive', 'sensing or controls'] };
  if (/\b(?:crane|lift|hoist)\b/.test(text)) return { machineType: 'lifting-system', requiredSubsystems: ['grounded base', 'load path', 'lifting member', 'drive', 'load interface'] };
  if (/\b(?:rover|vehicle|car|buggy)\b/.test(text)) return { machineType: 'mobile-vehicle', requiredSubsystems: ['chassis', 'running gear', 'steering', 'powertrain'] };
  return { machineType: 'general-mechanical-system', requiredSubsystems: ['primary structure', 'requested functional elements'] };
}

/** Normalizes only engineering vocabulary. The user's original request remains
 * visible in the workspace, while the corrected text is used for planning. */
export function normalizeEngineeringIntent(rawRequest: string, context = ''): NormalizedEngineeringIntent {
  const corrections: IntentCorrection[] = [];
  let normalizedRequest = rawRequest.normalize('NFKC').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
  for (const correction of TERM_CORRECTIONS) normalizedRequest = replaceWithAudit(normalizedRequest, corrections, correction.pattern, correction.replacement, correction.reason);

  const lowerBeforeBrake = normalizedRequest.toLowerCase();
  const vehicleContext = /\b(?:bicycle|go-kart|kart|car|vehicle|motorcycle|truck|rover|airplane)\b/.test(`${context} ${lowerBeforeBrake}`.toLowerCase());
  if (vehicleContext) normalizedRequest = replaceWithAudit(normalizedRequest, corrections, /\bbreak\s+lights?\b/gi, (lowerBeforeBrake.match(/\bbreak\s+lights?\b/i)?.[0] ?? '').toLowerCase().endsWith('s') ? 'brake lights' : 'brake light', 'vehicle lighting context');

  const text = normalizedRequest.toLowerCase();
  const classification = classifyMachine(text);
  const standalonePart = /\b(?:bracket|bearing|shaft|gear|wheel|housing|casing|plate|light|propeller|fork)\b/.test(text)
    && !/\b(?:system|machine|vehicle|bicycle|airplane|go-kart|conveyor|crane|robot)\b/.test(text.replace(/\b(?:bicycle|airplane|go-kart)\s+(?:brake light|headlight|fork|wheel)\b/g, ''));
  const scope: NormalizedEngineeringIntent['scope'] = /\b(?:line|station|cell)\b/.test(text) ? 'production-cell'
    : /\b(?:mounted on|combined with|carrying a)\b/.test(text) ? 'compound-system'
      : standalonePart ? 'part' : /\b(?:assembly|subassembly|mechanism)\b/.test(text) ? 'subassembly' : 'machine';
  const functions: string[] = [];
  if (/\b(?:move|drive|powered|propel|transport)\b/.test(text)) functions.push('motion');
  if (/\b(?:steer|turn)\b/.test(text)) functions.push('steering');
  if (/\b(?:brake|stop)\b/.test(text)) functions.push('braking');
  if (/\b(?:light|lamp)\b/.test(text)) functions.push('lighting');
  if (/\b(?:sort|separate|classify)\b/.test(text)) functions.push('classification');
  if (/\b(?:lift|raise|hoist)\b/.test(text)) functions.push('lifting');
  return { rawRequest, normalizedRequest, corrections, machineType: classification.machineType, scope, functions, requiredSubsystems: classification.requiredSubsystems, directions: FORGE_COORDINATE_CONVENTION };
}

export function buildEngineeringPlan(
  intent: NormalizedEngineeringIntent,
  plan: Pick<CompiledWorldPlan, 'assemblies' | 'components' | 'connections' | 'joints' | 'motors' | 'sensors' | 'actuators' | 'controls'>,
  capabilities: Capability[],
) {
  const componentById = new Map(plan.components.map((component) => [component.id, component]));
  return {
    userRequest: intent.rawRequest,
    normalizedRequest: intent.normalizedRequest,
    corrections: intent.corrections,
    machineType: intent.machineType,
    scope: intent.scope,
    functions: [...new Set([...intent.functions, ...capabilities])],
    constraints: [] as string[],
    coordinateConvention: intent.directions,
    assemblies: plan.assemblies.map((assembly) => ({ id: assembly.id, purpose: assembly.purpose })),
    components: plan.components.map((component) => ({
      id: component.id, primitive: component.primitive as PrimitiveKind, role: component.role,
      dimensions: component.dimensions, material: component.materialId, mass: component.mass ?? null,
      rationale: `Provides ${component.role.toLowerCase()} using a reusable ${component.primitive} body.`,
    })),
    connections: plan.connections.map((connection) => ({ ...connection })),
    joints: plan.joints.map((joint) => ({ id: joint.id, type: joint.type, parent: joint.componentA, child: joint.componentB, axis: joint.axis as Vec3 })),
    actuators: plan.actuators.map((actuator) => ({ ...actuator })),
    motors: plan.motors.map((motor) => ({ ...motor })),
    sensors: plan.sensors.map((sensor) => ({ ...sensor })),
    controlLogic: plan.controls.map((control) => ({ id: control.id, mode: control.mode, expression: control.expression })),
    supportMap: plan.components.map((component) => ({
      componentId: component.id,
      supportedBy: plan.joints.filter((joint) => joint.componentB === component.id).map((joint) => joint.componentA)
        .concat(plan.connections.filter((edge) => edge.type === 'mechanical' && edge.sourceId === component.id).map((edge) => edge.targetId))
        .filter((id) => componentById.has(id)),
    })),
    validation: { status: 'pending' as 'pending' | 'ready', issueCount: 0, repairs: [] as string[] },
    simulationReadiness: { grounded: false, connected: false, driven: false },
  };
}
