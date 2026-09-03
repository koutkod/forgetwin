import { catalogFor, engineeringExamples, worldDefaults } from './forge-data';
import type {
  ActuatorBlueprint, AssemblyBlueprint, BodyType, Capability, CompiledWorldPlan,
  ComponentBlueprint, ConnectionBlueprint, ControlBlueprint, GoalConstraint,
  JointBlueprint, JointType, MotorBlueprint, PrimitiveKind, SensorBlueprint, Vec3,
} from './forge-types';
import { finalizeCompiledWorldPlan } from './forge-design-validator';
import { FORGE_COORDINATE_CONVENTION, normalizeEngineeringIntent } from './forge-intent';
import { worldPointToLocal } from './forge-motion';

export const DEFAULT_DESIGN_PROMPT = engineeringExamples[1].prompt;
export const CHALLENGE_EXAMPLES = engineeringExamples;

const normalize = (value: string) => value.normalize('NFKC').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
const isBicycleBrakeGoal = (text: string) => /\b(?:bicycle|bike)\s+(?:disc\s+)?(?:brake|caliper)\b|\b(?:disc\s+)?(?:brake|caliper)\s+(?:assembly\s+)?(?:for|of)\s+(?:a\s+)?(?:bicycle|bike)\b/.test(text);
const isBicycleGoal = (text: string) => /\bbicycle\b/.test(text) && !isBicycleBrakeGoal(text);
const isRoadVehicleGoal = (text: string) => !/\bcar\s+(?:jack|lift|hoist)\b/.test(text) && /\b(?:go-kart|kart|buggy|automobile|car|atv|all-terrain vehicle)\b/.test(text);
const isMotorcycleGoal = (text: string) => /\b(?:motorcycle|motorbike|dirt bike|scooter)\b/.test(text);
const isHelicopterGoal = (text: string) => /\b(?:helicopter|rotorcraft|quad(?:copter|rotor)|drone)\b/.test(text);
const isFixedWingAircraftGoal = (text: string) => !isHelicopterGoal(text) && /\b(?:airplane|fixed[- ]wing aircraft|light aircraft|electric aircraft)\b/.test(text);
const isGeneralRobotGoal = (text: string) => /\b(?:humanoid|service|walking|quadruped|tracked)\s+robot\b|\brobot\b/.test(text) && !/\b(?:robotic arm|robot arm|mobile robot|rover)\b/.test(text);
const isCentrifugalPumpGoal = (text: string) => /\bcentrifugal(?:\s+(?:water|process|fluid|coolant))?\s+pump\b/.test(text);
const isHydraulicPressGoal = (text: string) => /\b(?:hydraulic|shop|workshop|h-frame|c-frame)\s+press\b|\bpress\s+(?:machine|frame)\b/.test(text);
const isBenchViseGoal = (text: string) => /\b(?:bench|machine|engineer'?s?)\s+vi[cs]e\b|\bvi[cs]e\s+(?:with|using|driven|assembly)\b/.test(text);
const isBottleJackGoal = (text: string) => /\b(?:hydraulic\s+)?bottle\s+jack\b/.test(text);
const isWindYawGoal = (text: string) => /\b(?:wind\s+)?turbine\b[^.!?]{0,55}\b(?:yaw|wind direction|nacelle orient)|\b(?:yaw|wind direction|nacelle orient)[^.!?]{0,55}\b(?:wind\s+)?turbine\b/.test(text);
const isDrillPressGoal = (text: string) => /\b(?:bench(?:top)?\s+|floor\s+|radial\s+|magnetic\s+)?drill\s+press\b/.test(text);
const isRackSteeringGoal = (text: string) => /\brack(?:[- ]and[- ])pinion\s+steering\b|\bsteering\s+rack(?:\s+and\s+pinion)?\b/.test(text);
const isGrainMillGoal = (text: string) => /\b(?:grain|corn|wheat|cereal)\s+(?:roller\s+)?mill\b|\b(?:pedal|hand|manual)[- ]powered\s+(?:grain|corn|wheat|cereal)\s+mill\b/.test(text);
const isStandaloneWinchGoal = (text: string) => /\bwinch\b/.test(text) && !/\b(?:crane|hoist)\b/.test(text);
const isPlanetaryDifferentialGoal = (text: string) => /\bplanetary(?:\s+gear)?\s+differential\b|\bdifferential\s+planetary\s+gear(?:set|train)?\b/.test(text);
const isScissorLiftGoal = (text: string) => /\bscissor(?:[- ]?type)?[- ]?(?:lift|table|platform)\b/.test(text);
const pumpPart = '(?:bracket|housing|casing|impeller|shaft|seal|cover|flange|manifold|bearing)';
const pumpName = 'centrifugal(?:\\s+(?:water|process|fluid|coolant))?\\s+pump';
const isCentrifugalPumpPartGoal = (text: string) => new RegExp(
  `\\b(?:${pumpName}\\s+(?:mounting\\s+)?${pumpPart}|${pumpPart}(?:\\s*(?:,|/|and)\\s*${pumpPart})*\\s+(?:for|of)\\s+(?:a\\s+)?${pumpName})\\b`,
).test(text);
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'part';
const numeric = (value: string | undefined, fallback: number) => value ? Number(value.replaceAll(',', '')) : fallback;
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};

function countBefore(text: string, noun: string, fallback: number, minimum: number, maximum: number) {
  const words = Object.keys(NUMBER_WORDS).join('|');
  const match = text.match(new RegExp(`\\b(${words}|\\d+)\\s*[- ]?\\s*${noun}s?\\b`, 'i'));
  const parsed = match ? NUMBER_WORDS[match[1].toLowerCase()] ?? Number(match[1]) : fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

interface ParsedValues {
  payloadKg: number;
  liftM: number;
  spanM: number;
  reachM: number;
  durationS: number;
  throughput: number;
  flowRateLpm: number;
  ratio: number;
  rpm: number;
  torqueNm: number;
  placementCm: number;
  tiltDeg: number;
  deflectionMm: number;
  acceleration: number;
  angleDeg: number;
  strokeM: number;
  forceN: number;
  linearSpeedMps: number;
  maxComponents?: number;
  supplied: Set<string>;
}

interface ModuleContext {
  builder: WorldBuilder;
  text: string;
  capabilities: Capability[];
  values: ParsedValues;
  rootAssemblyId: string;
}

interface ModuleResult {
  id: string;
  mountId: string;
  editableId: string;
  handles: Capability[];
  inputId?: string;
  outputId?: string;
  driveId?: string;
}

interface ModuleRule {
  id: string;
  matches: (context: Omit<ModuleContext, 'builder' | 'rootAssemblyId'>) => boolean;
  compose: (context: ModuleContext) => ModuleResult;
}

function capture(text: string, regex: RegExp) {
  return text.match(regex)?.slice(1).find((value) => value !== undefined);
}

function parseValues(text: string): ParsedValues {
  const supplied = new Set<string>();
  const read = (key: string, regex: RegExp, fallback: number) => {
    const match = capture(text, regex);
    if (match) supplied.add(key);
    return numeric(match, fallback);
  };
  const liftCm = capture(text, /(?:lift|raise|raises|raising|travel|height)[^.!?]{0,45}?(\d+(?:\.\d+)?)\s*cm\b/i);
  if (liftCm) supplied.add('liftM');
  const liftMm = liftCm ? undefined : capture(text, /(?:lift|raise|raises|raising|travel|height)[^.!?]{0,45}?(\d+(?:\.\d+)?)\s*mm\b/i);
  if (liftMm) supplied.add('liftM');
  const payloadTons = capture(text, /(\d+(?:\.\d+)?)[-\s]*(?:metric\s+)?(?:tonnes?|tons?)\b/i);
  if (payloadTons) supplied.add('payloadKg');
  const strokeCm = capture(text, /(?:stroke|opens?|travel)[^.!?]{0,30}?(\d+(?:\.\d+)?)\s*cm\b/i);
  if (strokeCm) supplied.add('strokeM');
  const strokeMm = capture(text, /(?:(?:stroke|opens?|travel)[^.!?]{0,30}?(\d+(?:\.\d+)?)\s*mm\b|(\d+(?:\.\d+)?)\s*mm\b[^.!?]{0,18}?(?:linear\s+)?stroke\b)/i);
  if (strokeMm) supplied.add('strokeM');
  const strokeMeters = capture(text, /(?:(?:stroke|opens?|travel)[^.!?]{0,30}?(\d+(?:\.\d+)?)\s*(?:m|meters?)\b|(\d+(?:\.\d+)?)\s*(?:m|meters?)\b[^.!?]{0,18}?(?:linear\s+)?stroke\b)/i);
  if (strokeMeters) supplied.add('strokeM');
  const forceKn = capture(text, /(\d+(?:,\d{3})*(?:\.\d+)?)\s*k\s*n\b/i);
  const forceNewtons = forceKn ? undefined : capture(text, /(?:press(?:ing)?\s+force|appl(?:y|ies|ying))[^.!?]{0,24}?(\d+(?:,\d{3})*(?:\.\d+)?)\s*n\b/i);
  if (forceKn || forceNewtons) supplied.add('forceN');
  const maxComponents = capture(text, /(?:no more than|at most|maximum(?: of)?|using)\s+(\d+)\s+(?:components?|parts?)/i);
  if (maxComponents) supplied.add('maxComponents');
  return {
    payloadKg: payloadTons ? numeric(payloadTons, 1) * 1000 : read('payloadKg', /(\d+(?:,\d{3})*(?:\.\d+)?)\s*kg\b/i, 25),
    liftM: liftMm ? numeric(liftMm, 1000) / 1000 : liftCm ? numeric(liftCm, 100) / 100 : read('liftM', /(?:lift|raise|raises|raising|travel|height)[^.!?]{0,45}?(\d+(?:\.\d+)?)\s*(?:m|meters?)\b/i, 1),
    spanM: read('spanM', /(?:(\d+(?:\.\d+)?)\s*(?:m|meters?)\s+(?:bridge|span|drawbridge)|(?:bridge|span|drawbridge)[^.!?]{0,24}?(\d+(?:\.\d+)?)\s*(?:m|meters?))/i, 4),
    reachM: read('reachM', /(?:reach|reaches|radius)[^.!?]{0,20}?(\d+(?:\.\d+)?)\s*(?:m|meters?)\b/i, 1.5),
    durationS: read('durationS', /(?:under|within|less than|in)\s+(\d+(?:\.\d+)?)\s*(?:s|seconds?)\b/i, 20),
    throughput: read('throughput', /(\d+(?:\.\d+)?)\s*(?:boxes?|packages?|parts?|items?|objects?)?\s*(?:per\s+minute|\/\s*min)/i, 20),
    flowRateLpm: read('flowRateLpm', /(\d+(?:\.\d+)?)\s*(?:liters?|litres?|l)\s*(?:per\s+minute|\/\s*min)/i, 20),
    ratio: read('ratio', /(\d+(?:\.\d+)?)\s*:\s*1\b/i, 4),
    rpm: read('rpm', /(\d+(?:\.\d+)?)\s*rpm\b/i, 120),
    torqueNm: read('torqueNm', /(\d+(?:\.\d+)?)\s*n\s*[-·]?\s*m\b/i, 60),
    placementCm: read('placementCm', /(?:within|accuracy|error)[^.!?]{0,18}?(\d+(?:\.\d+)?)\s*cm\b/i, 5),
    tiltDeg: read('tiltDeg', /(?:tilt|level)[^.!?]{0,28}?(\d+(?:\.\d+)?)\s*(?:°|degrees?)/i, 8),
    deflectionMm: read('deflectionMm', /(?:(?:deflection|deflect)[^.!?]{0,20}?(\d+(?:\.\d+)?)\s*mm\b|(\d+(?:\.\d+)?)\s*mm\s*(?:of\s+)?deflection)/i, 10),
    acceleration: read('acceleration', /(?:acceleration|accelerating)[^.!?]{0,26}?(\d+(?:\.\d+)?)\s*m\/s(?:²|2)/i, .8),
    angleDeg: read('angleDeg', /(?:rotate|rotation|open|sweep|travel)[^.!?]{0,28}?(\d+(?:\.\d+)?)\s*(?:°|degrees?)/i, 75),
    strokeM: strokeMm ? numeric(strokeMm, 1000) / 1000 : strokeCm ? numeric(strokeCm, 100) / 100 : strokeMeters ? numeric(strokeMeters, 1) : 1,
    forceN: forceKn ? numeric(forceKn, 20) * 1000 : numeric(forceNewtons, 20000),
    linearSpeedMps: read('linearSpeedMps', /(\d+(?:\.\d+)?)\s*m\s*\/\s*s(?!\s*(?:²|\^?2))/i, .25),
    maxComponents: maxComponents ? Number(maxComponents) : undefined,
    supplied,
  };
}

function inferCapabilities(text: string): Capability[] {
  const capabilities = new Set<Capability>(['structure']);
  const transmissionText = text.replace(/\blanding gear\b/g, '');
  // "Four-door car" describes a body style, not a request for a hinged-door
  // test rig. Keep that adjective from manufacturing an unrelated motion stage.
  const motionText = text.replace(/\b(?:two|three|four|five)[- ]door\b/g, '');
  if (/\b(?:conveyors?|packages?|boxes?|sort(?:er|ing|ed|s)?|warehouse|factory line|buffers?|singulat(?:e|ion)|feed(?:er|ing)?|recycl(?:e|ing)|graders?|routing)\b/.test(text)) capabilities.add('transport');
  if (/\b(?:sort(?:er|ing|ed|s)?|separat(?:e|ion)|rout(?:e|ing)|classif(?:y|ication)|inspect(?:ion)?|reject|color|size|material|graders?|recycl(?:e|ing))\b/.test(text)) { capabilities.add('classify'); capabilities.add('measure'); }
  if (/lift|raise|elevator|crane|hoist|drawbridge|jack|patient|\bwinch\b/.test(text)) capabilities.add('lift');
  if (/crane|hoist|suspend|cable|pulley|counterweight|drawbridge|\bwinch\b/.test(text)) capabilities.add('suspend');
  if (/\b(?:rover|vehicle|mobile robot|bicycle|go-kart|kart|buggy|automobile|car|atv|forklift|agv|truck|tractor|motorcycle|motorbike|airplane|aircraft|helicopter|rotorcraft|drone)\b/.test(text) && !isBicycleBrakeGoal(text) && !/\bcar\s+(?:jack|lift|hoist)\b/.test(text)) capabilities.add('mobile');
  if (/robotic arm|robot arm|manipulat|gripper|pick\s*(?:and|&)\s*place|end effector/.test(text) || isGeneralRobotGoal(text)) capabilities.add('manipulate');
  if (/gearbox|gear train|transmission|reduction|output torque|\bgears?\b/.test(transmissionText)) capabilities.add('transmit');
  if (isPlanetaryDifferentialGoal(text)) { capabilities.add('rotate'); capabilities.add('transmit'); }
  if (/suspension|spring|rough|uneven|tipping|stability|stabiliz|level/.test(text)) capabilities.add('stabilize');
  const activeTracking = /(?:solar|sun|light source)[^.!?]{0,32}(?:track|follow|aim|orient)|(?:track|follow|aim|orient)[^.!?]{0,32}(?:solar|sun|light source)|blade pitch|turbine yaw/.test(text);
  if (activeTracking) capabilities.add('track');
  if (/buffer|queue|spacing|irregular|singulat/.test(text)) capabilities.add('buffer');
  if (/\b(?:bins?|containers?|collect(?:or|ion)?|recycling|reject|tanks?|reservoirs?)\b/.test(text)) capabilities.add('contain');
  if (/rotat|hinge|pivot|door|hatch|drawbridge|crank|flywheel|four[- ]bar|linkage|reciprocat|piston pump|plunger pump/.test(motionText) || (isCentrifugalPumpGoal(text) && !isCentrifugalPumpPartGoal(text))) capabilities.add('rotate');
  if (isBenchViseGoal(text) || isWindYawGoal(text) || isDrillPressGoal(text) || isRackSteeringGoal(text) || isBicycleBrakeGoal(text) || isGrainMillGoal(text)) capabilities.add('rotate');
  if (isGrainMillGoal(text)) capabilities.add('contain');
  if (isBottleJackGoal(text)) capabilities.add('stabilize');
  if (/bearing|flange|coupling|sprocket|cam\b|impeller|propeller|fan\b|turbine|rotor/.test(text)) capabilities.add('rotate');
  if (isMotorcycleGoal(text) || isFixedWingAircraftGoal(text) || isHelicopterGoal(text)) capabilities.add('rotate');
  if (isFixedWingAircraftGoal(text) || isHelicopterGoal(text) || isGeneralRobotGoal(text)) capabilities.add('stabilize');
  if (/sensor|camera|measure|automatic|control|encoder|imu|switch/.test(text) || isBenchViseGoal(text) || isWindYawGoal(text) || isDrillPressGoal(text) || isRackSteeringGoal(text) || isBicycleBrakeGoal(text) || isGrainMillGoal(text)) capabilities.add('measure');
  if (/hvac|heat exchanger|braz(?:e|ing)|fixture|jig/.test(text)) capabilities.add('measure');
  return [...capabilities];
}

function identity(text: string, capabilities: Capability[]) {
  if (isBenchViseGoal(text)) return { name: 'Screw-driven bench vise', domain: 'Machine-shop tooling' };
  if (isBottleJackGoal(text)) return { name: 'Hydraulic bottle jack', domain: 'Hydraulic lifting equipment' };
  if (isWindYawGoal(text)) return { name: 'Wind-turbine yaw drive', domain: 'Wind energy' };
  if (isDrillPressGoal(text)) return { name: 'Bench drill press', domain: 'Machine-shop tooling' };
  if (isRackSteeringGoal(text)) return { name: 'Rack-and-pinion steering assembly', domain: 'Automotive steering' };
  if (isBicycleBrakeGoal(text)) return { name: 'Bicycle disc brake', domain: 'Bicycle braking systems' };
  if (isGrainMillGoal(text)) return { name: 'Pedal-powered grain roller mill', domain: 'Agricultural processing equipment' };
  if (isCentrifugalPumpGoal(text) && !isCentrifugalPumpPartGoal(text)) return { name: 'Centrifugal process pump', domain: 'Fluid machinery' };
  if (isHydraulicPressGoal(text)) return { name: /\bshop\s+press\b/.test(text) ? 'Hydraulic shop press' : 'Hydraulic press', domain: 'Industrial forming equipment' };
  if (isStandaloneWinchGoal(text)) return { name: /\belectric\b/.test(text) ? 'Electric cable winch' : 'Cable drum winch', domain: 'Material handling' };
  if (isPlanetaryDifferentialGoal(text)) return { name: 'Compact planetary differential', domain: 'Power transmission' };
  if (isMotorcycleGoal(text)) return { name: /electric/.test(text) ? 'Electric motorcycle' : 'Motorcycle', domain: 'Personal mobility' };
  if (isHelicopterGoal(text)) return { name: /drone|quadcopter|quadrotor/.test(text) ? 'Multi-rotor aircraft' : 'Utility helicopter', domain: 'Rotorcraft engineering' };
  if (isFixedWingAircraftGoal(text)) return { name: /electric/.test(text) ? 'Electric fixed-wing aircraft' : 'Fixed-wing aircraft', domain: 'Aircraft engineering' };
  if (isGeneralRobotGoal(text)) return { name: /quadruped/.test(text) ? 'Articulated quadruped robot' : 'Articulated service robot', domain: 'Robotics' };
  if (isBicycleGoal(text)) return {
    name: /solar/.test(text) ? 'Solar electric bicycle' : /\belectric\b|\be-?bike\b|pedal assist|hub motor|mid-drive/.test(text) ? 'Electric bicycle' : 'Parametric bicycle',
    domain: /solar|\belectric\b|\be-?bike\b|pedal assist|hub motor|mid-drive/.test(text) ? 'Personal electric mobility' : 'Personal mobility',
  };
  if (isRoadVehicleGoal(text)) return {
    name: /\bgo-kart\b|\bkart\b/.test(text) ? (/electric/.test(text) ? 'Electric go-kart' : 'Go-kart') : (/electric/.test(text) ? 'Electric road vehicle' : 'Road vehicle'),
    domain: /electric/.test(text) && /\bgo-kart\b|\bkart\b/.test(text) ? 'Personal electric mobility' : 'Vehicle engineering',
  };
  const candidates: Array<[RegExp, string, string]> = [
    [/(?:fixture|jig).*(?:hvac|heat exchanger|braz)|(?:hvac|heat exchanger|braz).*(?:fixture|jig)/, 'Precision HVAC brazing fixture', 'HVAC manufacturing'],
    [/braz(?:ed|e)\s+plate|plate\s+heat exchanger|\bbphe\b/, 'Brazed plate heat exchanger', 'HVAC thermal systems'],
    [/impeller|propeller|fan\b|turbine|rotor/, 'Parametric rotating assembly', 'Rotating machinery'],
    [/bearing|flange|coupling|sprocket|cam\b|bracket|housing|enclosure|casing|manifold/, 'Parametric mechanical part', 'Mechanical design'],
    [/reciprocat|piston pump|plunger pump/, 'Reciprocating pump mechanism', 'Fluid power'],
    [/four[- ]bar|linkage/, 'Parametric linkage mechanism', 'Mechanism design'],
    [/drawbridge|folding bridge/, 'Actuated folding span', 'Civil mechanisms'],
    [/bridge|truss/, 'Parametric load-bearing span', 'Structural engineering'],
    [/gearbox|transmission|gear train/, 'Parametric power transmission', 'Power transmission'],
    [/robotic arm|robot arm|manipulat/, 'Articulated robotic mechanism', 'Robotics'],
    [/crane|hoist/, 'Counterbalanced lifting system', 'Lifting systems'],
    [/patient/, 'Smooth patient lifting mechanism', 'Medical equipment'],
    [/scissor(?:[- ]?type)?[- ]?(?:lift|table|platform)/, 'Scissor lift', 'Lifting systems'],
    [/elevator|lift|raising/, 'Synchronized lifting mechanism', 'Lifting systems'],
    [/\bbuggy\b|\batv\b|all-terrain vehicle/, /electric/.test(text) ? 'Electric off-road buggy' : 'Off-road buggy', 'Vehicle engineering'],
    [/suspension/, 'Independent car suspension test rig', 'Automotive engineering'],
    [/rover|vehicle|mobile robot/, 'Terrain-capable mobile platform', 'Mobile robotics'],
    [/solar|light source/, 'Single-axis tracking mechanism', 'Renewable energy'],
    [/tomato|\bproduce\s+(?:grader|sorting|line)\b|fruit.*grad|grader.*fruit/, 'Gentle tomato grading system', 'Agricultural automation'],
    [/warehouse|accumulation|buffer/, 'Zoned warehouse accumulation system', 'Warehouse automation'],
    [/recycl/, 'Material separation mechanism', 'Recycling'],
    [/red.*blue|blue.*red|package sort|box sort/, 'Two-color package sorting system', 'Logistics automation'],
    [/sort|conveyor|packages?/, 'Adaptive material-flow mechanism', 'Industrial automation'],
  ];
  const found = candidates.find(([pattern]) => pattern.test(text));
  if (found) return { name: found[1], domain: found[2] };
  const lead = text.replace(/^(build|design|create|engineer)\s+(?:an?|the)?\s*/i, '').split(/\b(?:that|which|while|using|with)\b/i)[0].trim();
  return { name: `${lead.slice(0, 45) || capabilities.join(' ')} mechanism`, domain: 'General mechanical engineering' };
}

const symbol = (operator: GoalConstraint['operator']) => operator === 'min' ? '≥' : operator === 'max' ? '≤' : '=';

function constraintsFor(text: string, capabilities: Capability[], values: ParsedValues): GoalConstraint[] {
  const result: GoalConstraint[] = [];
  const add = (metric: string, label: string, operator: GoalConstraint['operator'], target: number, unit: string, key?: keyof ParsedValues) => {
    if (!result.some((item) => item.metric === metric)) result.push({ metric, label, operator, target, unit, source: key && values.supplied.has(String(key)) ? 'user' : 'inferred' });
  };
  const spanSystem = /bridge|truss|structural span/.test(text);
  const reciprocating = /reciprocat|piston pump|plunger pump/.test(text);
  const centrifugal = isCentrifugalPumpGoal(text) && !isCentrifugalPumpPartGoal(text);
  const linkage = /four[- ]bar|linkage/.test(text);
  const parametricRotor = /impeller|propeller|fan\b|turbine|rotor/.test(text) || centrifugal;
  const brazedPlateExchanger = /braz(?:ed|e)\s+plate|plate\s+heat exchanger|\bbphe\b/.test(text);
  const brazingFixture = !brazedPlateExchanger && /(?:fixture|jig)/.test(text) && /hvac|heat exchanger|braz/.test(text);
  const bicycle = isBicycleGoal(text);
  const roadVehicle = isRoadVehicleGoal(text);
  const aviation = isFixedWingAircraftGoal(text) || isHelicopterGoal(text);
  const hydraulicPress = isHydraulicPressGoal(text);
  const drumWinch = isStandaloneWinchGoal(text);
  const bottleJack = isBottleJackGoal(text);
  const grainMill = isGrainMillGoal(text);

  if (brazedPlateExchanger) {
    add('plate_count', 'Corrugated transfer plates', 'min', 12, 'plates');
    add('port_count', 'Fluid circuit connections', 'exact', 4, 'ports');
    add('assembly_integrity', 'Brazed pack connectivity', 'min', 100, '%');
    add('component_count', 'Physical bodies', 'max', 24, '');
  }

  if (brazingFixture) {
    const toleranceMm = numeric(capture(text, /(\d+(?:\.\d+)?)\s*mm\b/i), 2);
    add('alignment_error', 'Tube alignment error', 'max', toleranceMm, 'mm');
    add('clamp_force', 'Available clamp force', 'min', 1200, 'N');
    add('assembly_integrity', 'Fixture connectivity', 'min', 95, '%');
    add('component_count', 'Physical bodies', 'max', 24, '');
  }

  if (hydraulicPress) {
    add('pressing_force', 'Available pressing force', 'min', values.forceN, 'N', 'forceN');
    add('stroke', 'Ram stroke', 'min', values.strokeM, 'm', 'strokeM');
    add('platen_parallelism', 'Platen parallelism error', 'max', 1, 'mm');
    add('safety_factor', 'Press-frame safety factor', 'min', 1.5, '');
  }

  if (drumWinch) {
    add('line_speed', 'Cable line speed', 'exact', values.linearSpeedMps, 'm/s', 'linearSpeedMps');
    add('cable_safety_factor', 'Cable safety factor', 'min', 5, 'x');
  }

  if (spanSystem) {
    add('span', 'Clear span', 'min', values.spanM, 'm', 'spanM');
    add('load_capacity', 'Load capacity', 'min', values.payloadKg === 25 ? 2000 : values.payloadKg, 'kg', 'payloadKg');
    add('deflection', 'Midspan deflection', 'max', values.deflectionMm, 'mm', 'deflectionMm');
    add('safety_factor', 'Structural safety factor', 'min', 1.5, '');
    if (/drawbridge|fold|hing|open|raise/.test(text)) add('response_time', 'Span motion time', 'max', values.durationS, 's', 'durationS');
  }
  if (capabilities.includes('transmit')) {
    add('speed_ratio', 'Reduction ratio', 'exact', values.ratio, ':1', 'ratio');
    add('output_torque', 'Output torque', 'min', values.torqueNm, 'N·m', 'torqueNm');
    add('output_speed', 'Output speed', 'max', values.rpm / values.ratio * 1.05, 'rpm', 'rpm');
    add('transmission_efficiency', 'Transmission efficiency', 'min', 88, '%');
  }
  if (capabilities.includes('manipulate')) {
    add('payload_capacity', 'Payload capacity', 'min', values.payloadKg, 'kg', 'payloadKg');
    add('reach', 'Tool reach', 'min', values.reachM, 'm', 'reachM');
    add('placement_error', 'Placement error', 'max', values.placementCm, 'cm', 'placementCm');
    add('joint_margin', 'Joint torque margin', 'min', 1.15, 'x');
  }
  if (capabilities.includes('mobile') && !aviation) {
    add('payload_capacity', 'Payload capacity', 'min', values.payloadKg, 'kg', 'payloadKg');
    add('course_time', 'Course time', 'max', values.durationS, 's', 'durationS');
    if (!bicycle) add('platform_tilt', 'Platform tilt', 'max', values.tiltDeg, '°', 'tiltDeg');
    add('traction_margin', 'Traction margin', 'min', 1.1, 'x');
    if (bicycle) {
      add('assembly_integrity', 'Connected bicycle assembly', 'min', 95, '%');
      add('component_count', 'Physical bodies', 'max', values.maxComponents ?? (/solar/.test(text) ? 48 : 40), '');
    } else if (roadVehicle) {
      add('assembly_integrity', 'Connected road-vehicle assembly', 'min', 95, '%');
      add('component_count', 'Physical bodies', 'max', 64, '');
    }
  }
  if (capabilities.includes('track')) {
    add('tracking_error', 'Tracking error', 'max', values.tiltDeg === 8 ? 4 : values.tiltDeg, '°', 'tiltDeg');
    add('actuator_count', 'Actuator count', 'max', /one actuator|single actuator/.test(text) ? 1 : 2, '');
    add('response_time', 'Response time', 'max', 2.5, 's');
  }
  if (capabilities.includes('lift') && !hydraulicPress && !(spanSystem && capabilities.includes('rotate'))) {
    add('payload_capacity', 'Payload capacity', 'min', values.payloadKg, 'kg', 'payloadKg');
    add('lift_height', 'Lift height', 'min', bottleJack && !values.supplied.has('liftM') ? .3 : values.liftM, 'm', 'liftM');
    add('stability_margin', 'Stability margin', 'min', capabilities.includes('suspend') ? .2 : .12, 'm');
    if (/level|synchron/.test(text)) add('platform_tilt', 'Platform tilt', 'max', values.tiltDeg, '°', 'tiltDeg');
    if (/placement|places?/.test(text)) add('placement_error', 'Placement error', 'max', values.placementCm, 'cm', 'placementCm');
    if (/acceleration/.test(text)) add('peak_acceleration', 'Peak acceleration', 'max', values.acceleration, 'm/s²', 'acceleration');
  }
  if (capabilities.includes('transport')) {
    add('throughput', 'Throughput', 'min', values.throughput, '/min', 'throughput');
    if (capabilities.includes('classify')) add('sorting_accuracy', 'Sorting accuracy', 'min', 96, '%');
    add('collisions', 'Harmful collisions', 'max', 0, '');
    if (/drop/.test(text)) add('drop_height', 'Drop height', 'max', numeric(capture(text, /(\d+(?:\.\d+)?)\s*cm/i), 15), 'cm');
  }
  if (reciprocating || centrifugal) {
    add('flow_rate', 'Volumetric flow', 'min', values.flowRateLpm, 'L/min', 'flowRateLpm');
    if (reciprocating) add('control_error', 'Stroke control error', 'max', 5, '%');
  }
  if (parametricRotor) {
    add('angular_travel', 'Continuous shaft rotation', 'min', 360, '°');
    add('output_speed', 'Rotor speed', 'min', centrifugal && !values.supplied.has('rpm') ? 1800 : values.rpm, 'rpm', 'rpm');
    add('assembly_integrity', 'Rotor assembly connectivity', 'min', 95, '%');
    add('component_count', 'Physical bodies', 'max', 24, '');
  } else if (linkage || (capabilities.includes('rotate') && !capabilities.includes('transmit') && !capabilities.includes('track') && !spanSystem)) {
    add('angular_travel', 'Angular travel', 'min', values.angleDeg, '°', 'angleDeg');
    if (linkage && values.supplied.has('strokeM')) add('lift_height', 'Linear output stroke', 'min', values.strokeM, 'm', 'strokeM');
    add('control_error', 'Position control error', 'max', 5, '%');
  }
  if (grainMill) {
    add('assembly_integrity', 'Connected mill drivetrain', 'min', 95, '%');
    add('component_count', 'Physical bodies', 'max', 24, '');
  }
  if (!result.length) {
    add('safety_factor', 'Mechanical safety factor', 'min', 1.35, '');
    add('control_error', 'Control error', 'max', 5, '%');
    add('assembly_integrity', 'Connected assembly', 'min', 95, '%');
  }
  return result.slice(0, 12);
}

class WorldBuilder {
  assemblies: AssemblyBlueprint[] = [];
  components: ComponentBlueprint[] = [];
  connections: ConnectionBlueprint[] = [];
  joints: JointBlueprint[] = [];
  motors: MotorBlueprint[] = [];
  sensors: SensorBlueprint[] = [];
  actuators: ActuatorBlueprint[] = [];
  controls: ControlBlueprint[] = [];
  private ids = new Map<string, number>();
  private origin: Vec3 = [0, 0, 0];
  private rootAssemblyId?: string;

  next(prefix: string) {
    const key = slug(prefix);
    const count = (this.ids.get(key) ?? 0) + 1;
    this.ids.set(key, count);
    return count === 1 ? key : `${key}-${count}`;
  }

  assembly(name: string, purpose: string, parentId?: string) {
    const value = { id: this.next(name), name, purpose, parentId: parentId ?? this.rootAssemblyId };
    this.assemblies.push(value);
    return value.id;
  }

  setRoot(id: string) { this.rootAssemblyId = id; }

  at<T>(origin: Vec3, compose: () => T) {
    const previous = this.origin;
    this.origin = origin;
    try { return compose(); } finally { this.origin = previous; }
  }

  component(primitive: PrimitiveKind, role: string, assemblyId: string, position: Vec3, dimensions?: Vec3, materialId?: string, bodyType?: BodyType, parameters: Record<string, number | string | boolean> = {}, mass?: number) {
    const item = catalogFor(primitive);
    const placed = position.map((value, index) => value + this.origin[index]) as Vec3;
    const size = dimensions ?? [...item.defaultDimensions] as Vec3;
    const value: ComponentBlueprint = {
      id: this.next(role), primitive, role, assemblyId, position: placed, rotation: [0, 0, 0], dimensions: size,
      materialId: materialId ?? item.defaultMaterial, bodyType: bodyType ?? item.defaultBodyType,
      parameters: { nominal_x: placed[0], nominal_y: placed[1], nominal_z: placed[2], nominal_dx: size[0], nominal_dy: size[1], nominal_dz: size[2], ...parameters }, mass,
    };
    this.components.push(value);
    return value.id;
  }

  rotate(componentId: string, rotation: Vec3) {
    const target = this.components.find((item) => item.id === componentId);
    if (!target) throw new Error('Planner attempted to rotate a missing primitive.');
    target.rotation = rotation;
    target.parameters = { ...target.parameters, nominal_rx: rotation[0], nominal_ry: rotation[1], nominal_rz: rotation[2] };
    return componentId;
  }

  member(primitive: 'beam' | 'tube' | 'linkage' | 'cable', role: string, assemblyId: string, start: Vec3, end: Vec3, section: number, materialId = 'steel', bodyType: BodyType = 'fixed', parameters: Record<string, number | string | boolean> = {}) {
    const delta = end.map((value, index) => value - start[index]) as Vec3;
    const length = Math.max(.05, Math.hypot(...delta));
    const center = start.map((value, index) => (value + end[index]) / 2) as Vec3;
    if (primitive === 'cable') return this.component('cable', role, assemblyId, center, [section, length, section], materialId, bodyType, { ...parameters, start_x: start[0] + this.origin[0], start_y: start[1] + this.origin[1], start_z: start[2] + this.origin[2], end_x: end[0] + this.origin[0], end_y: end[1] + this.origin[1], end_z: end[2] + this.origin[2] });
    const horizontal = Math.hypot(delta[0], delta[2]);
    const rotation: Vec3 = [0, -Math.atan2(delta[2], Math.max(.0001, horizontal)), Math.atan2(delta[1], Math.max(.0001, horizontal))];
    const id = this.component(primitive, role, assemblyId, center, [length, section, section], materialId, bodyType, { ...parameters, member_length: length });
    return this.rotate(id, rotation);
  }

  connect(sourceId: string, targetId: string, type: ConnectionBlueprint['type'], channel: string) {
    const existing = this.connections.find((item) => item.sourceId === sourceId && item.targetId === targetId && item.type === type);
    if (existing) return existing.id;
    const value = { id: this.next(`${channel}-connection`), sourceId, targetId, type, channel: slug(channel).replaceAll('-', '_') };
    this.connections.push(value);
    return value.id;
  }

  joint(type: JointType, a: string, b: string, axis: Vec3 = [0, 1, 0], options: Partial<Omit<JointBlueprint, 'id' | 'type' | 'componentA' | 'componentB' | 'axis'>> = {}) {
    const bodyA = this.components.find((item) => item.id === a);
    const bodyB = this.components.find((item) => item.id === b);
    if (!bodyA || !bodyB) throw new Error('Planner attempted to join a missing primitive.');
    const shared = bodyA.position.map((value, index) => (value + bodyB.position[index]) / 2) as Vec3;
    const anchorA = worldPointToLocal(bodyA.position, bodyA.rotation, shared);
    const anchorB = worldPointToLocal(bodyB.position, bodyB.rotation, shared);
    const value: JointBlueprint = { id: this.next(`${type}-joint`), type, componentA: a, componentB: b, anchorA, anchorB, axis, ...options };
    this.joints.push(value);
    return value.id;
  }

  jointAt(type: JointType, a: string, b: string, worldPoint: Vec3, axis: Vec3 = [0, 1, 0], options: Partial<Omit<JointBlueprint, 'id' | 'type' | 'componentA' | 'componentB' | 'axis'>> = {}) {
    const bodyA = this.components.find((item) => item.id === a);
    const bodyB = this.components.find((item) => item.id === b);
    if (!bodyA || !bodyB) throw new Error('Planner attempted to join a missing primitive.');
    const placedPoint = worldPoint.map((value, index) => value + this.origin[index]) as Vec3;
    const value: JointBlueprint = {
      id: this.next(`${type}-joint`), type, componentA: a, componentB: b,
      anchorA: worldPointToLocal(bodyA.position, bodyA.rotation, placedPoint),
      anchorB: worldPointToLocal(bodyB.position, bodyB.rotation, placedPoint),
      axis, ...options,
    };
    this.joints.push(value);
    return value.id;
  }

  motor(componentId: string, jointId: string | undefined, maxTorque: number, maxRpm: number, direction = 1) {
    const value = { id: this.next('motor-drive'), componentId, jointId, maxTorque, maxRpm, direction };
    this.motors.push(value);
    return value.id;
  }

  sensor(componentId: string, type: SensorBlueprint['type'], channel: string, targetId?: string, range = 4) {
    const value = { id: this.next(`${channel}-sensor`), componentId, type, channel, targetId, range };
    this.sensors.push(value);
    return value.id;
  }

  actuator(componentId: string, jointId: string, type: ActuatorBlueprint['type'], maxForce: number, maxSpeed: number, travel: number) {
    const value = { id: this.next(`${type}-actuator`), componentId, jointId, type, maxForce, maxSpeed, travel };
    this.actuators.push(value);
    return value.id;
  }

  control(name: string, mode: ControlBlueprint['mode'], sensorIds: string[], actuatorIds: string[], expression: string, setpoint: number, motorIds?: string[]) {
    const firstSensor = this.sensors.find((item) => item.id === sensorIds[0]);
    const sensorBody = firstSensor ? this.components.find((item) => item.id === firstSensor.componentId) : undefined;
    const commandedMotors = motorIds ?? (actuatorIds.length ? [] : this.motors.map((item) => item.id));
    // A sensor-only monitor is useful, but it is not a controller. Do not put a
    // powerless item in the controller graph and later claim a closed loop.
    if (!sensorIds.length || (!actuatorIds.length && !commandedMotors.length)) return;
    this.controls.push({ id: this.next(`${name}-control`), name, mode, sensorIds, actuatorIds, motorIds: commandedMotors, expression, setpoint, kp: .55, ki: .02, kd: .08, calibrationX: sensorBody?.position[0] ?? 0 });
  }
}

function addDrawbridgeSpan(context: ModuleContext, assembly: string): ModuleResult {
  const { builder, text, values } = context;
  const twoLeaves = /(?:two|2)[ -]+(?:hinged[ -]+)?spans?/.test(text);
  const leafCount = twoLeaves ? 2 : 1;
  const leafLength = values.spanM / leafCount;
  const deckY = 1.18;
  const loadMass = values.payloadKg === 25 ? 2000 : values.payloadKg;
  const motionLimit = Math.max(55, Math.min(78, values.angleDeg)) * Math.PI / 180;
  const counterbalanced = /pulley|cable|counterweight/.test(text);
  const hydraulic = /hydraulic|piston/.test(text);

  builder.component('plate', 'water channel beneath movable span', assembly, [0, .08, 0], [values.spanM * 1.18, .08, 3.8], 'composite', 'fixed', { water_surface: true, canal_gap: true }, 18);
  const left = builder.component('support', 'left concrete bridge abutment', assembly, [-values.spanM / 2 - .48, .54, 0], [1.2, 1.08, 3.15], 'concrete', 'fixed', { bridge_abutment: true, bank_side: 'left', ground_contact: true }, 820);
  const right = builder.component('support', 'right concrete bridge abutment', assembly, [values.spanM / 2 + .48, .54, 0], [1.2, 1.08, 3.15], 'concrete', 'fixed', { bridge_abutment: true, bank_side: 'right', ground_contact: true }, 820);
  builder.component('plate', 'left asphalt approach', assembly, [-values.spanM / 2 - 1.42, 1.12, 0], [1.9, .18, 2.38], 'steel', 'fixed', { drawbridge_approach: true, road_surface: true }, 180);
  builder.component('plate', 'right asphalt approach', assembly, [values.spanM / 2 + 1.42, 1.12, 0], [1.9, .18, 2.38], 'steel', 'fixed', { drawbridge_approach: true, road_surface: true }, 180);

  const decks: string[] = [];
  const actuators: string[] = [];
  let driveId = '';
  let gaugeId = '';
  let sensorId = '';
  for (let index = 0; index < leafCount; index += 1) {
    const direction = index === 0 ? 1 : -1;
    const pivotX = index === 0 ? -values.spanM / 2 : values.spanM / 2;
    const centerX = pivotX + direction * leafLength / 2;
    const supportId = index === 0 ? left : right;
    const supportBody = builder.components.find((item) => item.id === supportId)!;
    const motion = { drawbridge_moving: true, drawbridge_leaf: index + 1, drawbridge_pivot_x: pivotX, drawbridge_pivot_y: deckY, drawbridge_direction: direction };
    const deck = builder.component('plate', `hinged span ${index + 1}`, assembly, [centerX, deckY, 0], [leafLength, .2, 2.34], 'steel', 'dynamic', { ...motion, drawbridge_deck: true, road_surface: true, span_m: leafLength, payload_kg: loadMass / leafCount }, 260 + loadMass / leafCount);
    decks.push(deck);
    const hinge = builder.joint('revolute', supportId, deck, [0, 0, 1], {
      limits: direction > 0 ? [0, motionLimit] : [-motionLimit, 0],
      anchorA: [pivotX - supportBody.position[0], deckY - supportBody.position[1], 0],
      anchorB: [pivotX - centerX, 0, 0],
    });
    const hingePin = builder.component('shaft', `visible leaf ${index + 1} hinge pin`, assembly, [pivotX, deckY, 0], [.26, 2.72, .26], 'steel', 'fixed', { drawbridge_hinge: true, drawbridge_leaf: index + 1 }, 18);
    builder.rotate(hingePin, [Math.PI / 2, 0, 0]);
    builder.connect(hingePin, deck, 'mechanical', 'bascule_hinge_pin');

    for (const side of [-1, 1]) {
      const sideName = side < 0 ? 'left' : 'right';
      const chord = builder.component('beam', `leaf ${index + 1} ${sideName} upper truss chord`, assembly, [centerX, 1.82, side * 1.05], [leafLength * .96, .12, .12], 'steel', 'fixed', { ...motion, drawbridge_truss: true });
      builder.connect(deck, chord, 'mechanical', 'moving_leaf_truss');
      const endPostX = centerX + direction * leafLength * .43;
      const endPost = builder.component('beam', `leaf ${index + 1} ${sideName} end post`, assembly, [endPostX, 1.5, side * 1.05], [.14, .7, .14], 'steel', 'fixed', { ...motion, drawbridge_truss: true });
      builder.connect(deck, endPost, 'mechanical', 'moving_leaf_end_post');
      for (let brace = 0; brace < 3; brace += 1) {
        const x0 = centerX - leafLength / 2 + brace * leafLength / 3;
        const x1 = centerX - leafLength / 2 + (brace + 1) * leafLength / 3;
        const start: Vec3 = [brace % 2 ? x0 : x1, 1.3, side * 1.05];
        const end: Vec3 = [brace % 2 ? x1 : x0, 1.82, side * 1.05];
        const diagonal = builder.member('beam', `leaf ${index + 1} ${sideName} diagonal brace ${brace + 1}`, assembly, start, end, .085, 'steel', 'fixed', { ...motion, drawbridge_truss: true, span_brace: true });
        builder.connect(deck, diagonal, 'mechanical', 'moving_leaf_diagonal');
      }
    }

    const drive = builder.component(hydraulic ? 'piston' : 'motor', hydraulic ? `leaf ${index + 1} hydraulic cylinder` : `leaf ${index + 1} bridge drive motor`, assembly, [pivotX - direction * .2, .78, -1.38], hydraulic ? [.34, 1.12, .34] : [.52, .66, .52], 'steel', 'kinematic', { drawbridge_drive: true, drawbridge_leaf: index + 1 });
    if (hydraulic) builder.rotate(drive, [0, 0, direction * -.56]);
    if (!driveId) driveId = drive;
    actuators.push(builder.actuator(drive, hinge, hydraulic ? 'piston' : 'servo', Math.max(3600, loadMass * 9.81 * .72), .58, motionLimit));
    if (!hydraulic) builder.motor(drive, hinge, Math.max(420, loadMass * leafLength * 1.8), 14, direction);

    if (counterbalanced) {
      const towerX = pivotX - direction * .52;
      const towerLegs = [-1.08, 1.08].map((z, legIndex) => builder.component('beam', `leaf ${index + 1} lifting tower leg ${legIndex + 1}`, assembly, [towerX, 2.02, z], [.24, 2.18, .24], 'steel', 'fixed', { bridge_tower: true, tower_leaf: index + 1 }));
      const crosshead = builder.component('beam', `leaf ${index + 1} lifting tower crosshead`, assembly, [towerX, 3.08, 0], [.3, .22, 2.48], 'steel', 'fixed', { bridge_tower: true, tower_leaf: index + 1 });
      towerLegs.forEach((leg) => builder.connect(leg, crosshead, 'mechanical', 'tower_crosshead'));
      const pulley = builder.component('pulley', `leaf ${index + 1} balance sheave`, assembly, [towerX, 2.82, 0], [.62, .2, .62], 'steel', 'dynamic', { drawbridge_pulley: true, tower_leaf: index + 1 });
      builder.rotate(pulley, [Math.PI / 2, 0, 0]);
      builder.joint('revolute', crosshead, pulley, [0, 0, 1]);
      const counter = builder.component('counterweight', `leaf ${index + 1} hanging counterweight`, assembly, [towerX, 1.62, 0], [.76, .92, .76], 'concrete', 'kinematic', { drawbridge_counterweight: true, drawbridge_leaf: index + 1, payload_kg: loadMass * .38 / leafCount }, loadMass * .38 / leafCount);
      builder.connect(crosshead, counter, 'mechanical', 'guided_counterweight');
      const deckAttach: Vec3 = [pivotX + direction * leafLength * .77, deckY + .24, 0];
      const deckCable = builder.member('cable', `leaf ${index + 1} lifting cable`, assembly, [towerX, 2.82, 0], deckAttach, .028, 'steel', 'kinematic', { drawbridge_cable: 'deck', drawbridge_pivot_x: pivotX, drawbridge_pivot_y: deckY, drawbridge_direction: direction });
      const counterCable = builder.member('cable', `leaf ${index + 1} counterweight cable`, assembly, [towerX, 2.82, 0], [towerX, 2.08, 0], .028, 'steel', 'kinematic', { drawbridge_cable: 'counterweight', drawbridge_leaf: index + 1 });
      builder.connect(deckCable, pulley, 'mechanical', 'lifting_cable_over_sheave');
      builder.connect(counterCable, pulley, 'mechanical', 'counterweight_cable_over_sheave');
      builder.connect(counterCable, counter, 'mechanical', 'counterweight_termination');
    }

    if (index === 0) {
      gaugeId = builder.component('sensor', 'bascule hinge angle encoder', assembly, [pivotX, 1.46, -1.25], [.24, .2, .24], 'polymer', 'fixed', { drawbridge_gauge: true });
      sensorId = builder.sensor(gaugeId, 'angle', 'span_angle', deck, values.spanM);
    }
  }

  if (leafCount === 1) builder.connect(decks[0], right, 'mechanical', 'far_bank_closing_seat');
  else builder.connect(decks[0], decks[1], 'mechanical', 'center_closing_joint');
  builder.control('bascule span motion', 'tracking', [sensorId], actuators, 'open the bridge only after both road approaches are clear, then track the commanded leaf angle inside hinge and cable limits', values.angleDeg);
  return { id: 'span-members', mountId: left, editableId: gaugeId, handles: ['structure', 'rotate', 'lift'], driveId, outputId: decks[0] };
}

function addSpanMembers(context: ModuleContext): ModuleResult {
  const { builder, text, values, rootAssemblyId } = context;
  const assembly = builder.assembly('span members', 'Supports, deck plates, braces, bearings, and optional hinge drive', rootAssemblyId);
  const folding = /drawbridge|fold|hing|open|raise/.test(text);
  if (folding) return addDrawbridgeSpan(context, assembly);
  const spanCount = folding && /(?:two|2)[ -]+(?:hinged[ -]+)?spans?/.test(text) ? 2 : 1;
  const left = builder.component('support', 'left bearing support', assembly, [-values.spanM / 2, .55, 0], [.55, 1.25, 1.35], 'concrete', 'fixed');
  const right = builder.component('support', 'right bearing support', assembly, [values.spanM / 2, .55, 0], [.55, 1.25, 1.35], 'concrete', 'fixed');
  const decks: string[] = [];
  let previous = left;
  for (let index = 0; index < spanCount; index += 1) {
    const length = values.spanM / spanCount;
    const x = -values.spanM / 2 + length * (index + .5);
    const deck = builder.component('plate', folding ? `hinged span ${index + 1}` : 'span deck', assembly, [x, 1.25, 0], [length, .085, 1.5], 'steel', folding ? 'dynamic' : 'fixed', { span_m: length });
    builder.joint(folding ? 'revolute' : 'fixed', previous, deck, [0, 0, 1], { limits: folding ? [0, values.angleDeg * Math.PI / 180] : undefined });
    decks.push(deck); previous = deck;
    const braceCount = Math.max(3, Math.min(6, Math.ceil(length / 1.25)));
    for (const side of [-1, 1]) {
      const chord = builder.component('beam', `upper chord ${index + 1}-${side < 0 ? 'left' : 'right'}`, assembly, [x, 1.88, side * .66], [length, .11, .11], 'steel', 'fixed');
      builder.joint('fixed', deck, chord, [1, 0, 0]);
      for (let brace = 0; brace < braceCount; brace += 1) {
        const x0 = x - length / 2 + brace * length / braceCount;
        const x1 = x - length / 2 + (brace + 1) * length / braceCount;
        const start: Vec3 = [brace % 2 ? x0 : x1, 1.3, side * .66];
        const end: Vec3 = [brace % 2 ? x1 : x0, 1.88, side * .66];
        const diagonal = builder.member('beam', `${side < 0 ? 'span brace' : 'diagonal truss'} ${index + 1}-${brace + 1}`, assembly, start, end, .1, 'steel', 'fixed');
        builder.joint('fixed', deck, diagonal, [1, 0, 0]);
      }
    }
  }
  if (!folding) builder.joint('fixed', previous, right);
  else builder.connect(previous, right, 'mechanical', 'closing_bearing');

  const loadMass = values.payloadKg === 25 ? 2000 : values.payloadKg;
  const load = builder.component('container', 'moving design load', assembly, [0, 1.8, 0], [1, .7, .8], 'steel', 'dynamic', { payload_kg: loadMass }, loadMass);
  builder.connect(decks[0], load, 'mechanical', 'load_contact');
  const gauge = builder.component('sensor', folding ? 'hinge angle gauge' : 'midspan load gauge', assembly, [0, 1.52, -.62], undefined, undefined, 'fixed');
  const sensor = builder.sensor(gauge, folding ? 'angle' : 'load', folding ? 'span_angle' : 'midspan_load', decks[0], values.spanM);
  builder.joint('fixed', decks[0], gauge);

  if (folding) {
    const hinge = builder.joints.find((item) => item.componentB === decks[0] && item.type === 'revolute')!;
    const hydraulic = /hydraulic|piston/.test(text);
    const drive = builder.component(hydraulic ? 'piston' : 'motor', hydraulic ? 'span hydraulic actuator' : 'span drive motor', assembly, [-values.spanM / 2 + .7, .75, -.58], undefined, undefined, 'kinematic');
    const actuator = builder.actuator(drive, hinge.id, hydraulic ? 'piston' : 'servo', Math.max(1800, loadMass * 9.81 * .55), .65, values.angleDeg * Math.PI / 180);
    if (!hydraulic) builder.motor(drive, hinge.id, Math.max(160, loadMass * values.spanM * 1.4), 18);
    const counter = builder.component('counterweight', 'span counterweight', assembly, [-values.spanM / 2 - .65, .85, 0], [.9, .8, .8], 'concrete', 'dynamic', { payload_kg: loadMass * .55 }, loadMass * .55);
    builder.joint('fixed', left, counter);
    if (/pulley|cable|counterweight/.test(text)) {
      const pulley = builder.component('pulley', 'span balance pulley', assembly, [-values.spanM / 2 + .18, 2.05, -.5], [.55, .18, .55], 'steel', 'dynamic');
      builder.joint('revolute', left, pulley, [0, 0, 1]);
      const cable = builder.component('cable', 'span balance cable', assembly, [-values.spanM / 2 - .2, 1.45, -.5], [.04, 1.45, .04], 'steel', 'dynamic');
      builder.connect(cable, pulley, 'mechanical', 'balance_cable_path');
      builder.connect(cable, counter, 'mechanical', 'counterweight_termination');
    }
    builder.control('span motion', 'tracking', [sensor], [actuator], 'track commanded span angle inside hinge and load limits', values.angleDeg);
    return { id: 'span-members', mountId: left, editableId: gauge, handles: ['structure', 'rotate', 'lift'], driveId: drive, outputId: decks[0] };
  }
  return { id: 'span-members', mountId: left, editableId: gauge, handles: ['structure', 'rotate', 'lift'] };
}

function addRollingSupport(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('rolling support', 'Chassis plate, wheel joints, drive shafts, and optional compliant support', rootAssemblyId);
  const length = Math.max(2.1, Math.min(3.6, 2.1 + values.payloadKg / 120));
  const width = Math.max(1.25, Math.min(2.1, 1.3 + values.payloadKg / 180));
  // The gallery run is a fixed-base suspension/traction test. Ground the
  // chassis so wheel and spring behavior is measured without the whole rover
  // being launched by simplified tire contacts.
  const chassis = builder.component('plate', 'mobile rover chassis', assembly, [0, .9, 0], [length, .24, width], 'aluminum', 'fixed', { payload_kg: values.payloadKg, rover_chassis: true, grounded_test_rig: true });
  const wheelPositions: Vec3[] = [[-length * .35, .52, -width * .52], [-length * .35, .52, width * .52], [length * .35, .52, -width * .52], [length * .35, .52, width * .52]];
  wheelPositions.forEach((position, index) => {
    const wheel = builder.component('wheel', `all-terrain wheel ${index + 1}`, assembly, position, [.7 + values.payloadKg / 500, .24, .7 + values.payloadKg / 500], 'rubber', 'dynamic', { friction: 1.05, rover_wheel: true, road_vehicle_wheel: true, road_vehicle_front_steering: false, axle_axis: 'Z', operation_index: index, operation_speed_mps: 1.35 });
    let axleParent = chassis;
    if (context.capabilities.includes('stabilize')) {
      const stiffness = Math.max(15000, values.payloadKg * 680);
      const side = position[2] < 0 ? 'left' : 'right';
      const end = position[0] < 0 ? 'rear' : 'front';
      const carrier = builder.component('support', `${end} ${side} suspension upright`, assembly, [position[0], .68, position[2] * .9], [.2, .48, .18], 'steel', 'dynamic', { rover_upright: true, operation_index: index }, 3.8);
      builder.joint('spring', chassis, carrier, [0, 1, 0], { stiffness, damping: 2100, limits: [0, .55] });
      const spring = builder.component('spring', `suspension element ${index + 1}`, assembly, [position[0], .82, position[2] * .78], [.12, .55, .12], 'steel', 'dynamic', { stiffness, damping: 2100, rover_suspension_spring: true, operation_index: index });
      builder.connect(spring, chassis, 'mechanical', 'upper_spring_mount');
      builder.connect(spring, carrier, 'mechanical', 'lower_spring_mount');
      axleParent = carrier;
    }
    const axle = builder.joint('revolute', axleParent, wheel, [0, 0, 1]);
    if (index >= 2) {
      const motor = builder.component('motor', `traction motor ${index - 1}`, assembly, [position[0], .66, position[2] * .72], undefined, undefined, 'kinematic');
      builder.motor(motor, axle, Math.max(38, values.payloadKg * 1.85), 150);
      builder.connect(motor, wheel, 'power', 'traction_power');
    }
  });
  const frontBumper = builder.component('beam', 'front rover bumper', assembly, [length * .58, .76, 0], [.16, .2, width * .92], 'steel', 'fixed', { rover_bumper: true }, 2.5);
  builder.joint('fixed', chassis, frontBumper);
  const rearRack = builder.component('frame', 'payload safety cage', assembly, [-.25, 1.45, 0], [1.45, .82, width * .72], 'aluminum', 'fixed', { rover_rack: true }, 5.5);
  builder.joint('fixed', chassis, rearRack);
  const payload = builder.component('container', 'mobile payload', assembly, [-.25, 1.35, 0], [1.05, .52, .78], 'polymer', 'fixed', { payload_kg: values.payloadKg, rover_payload: true }, values.payloadKg);
  builder.joint('fixed', chassis, payload);
  const imu = builder.component('sensor', 'chassis imu', assembly, [-.4, 1.28, 0], undefined, undefined, 'fixed');
  const controller = builder.component('controller', 'traction controller', assembly, [.4, 1.25, 0], undefined, undefined, 'fixed');
  const sensor = builder.sensor(imu, 'imu', 'platform_tilt', chassis, 5);
  builder.control('traction stability', 'pid', [sensor], [], 'limit wheel torque when tilt or slip rises', values.tiltDeg);
  builder.joint('fixed', imu, chassis); builder.joint('fixed', controller, chassis);
  return { id: 'rolling-support', mountId: chassis, editableId: imu, handles: ['mobile', 'stabilize'] };
}

function addAutomotiveSuspension(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('independent car suspension', 'Recognizable passenger-car body, rigid chassis, four independently sprung wheels, double control arms, coil-over dampers, road bumps, and body-level sensing', rootAssemblyId);
  const track = 1.65;
  const wheelbase = 2.45;
  const wheelY = .53;
  const chassis = builder.component('frame', 'car suspension chassis', assembly, [0, .86, 0], [3.35, .24, 1.35], 'steel', 'fixed', { automotive_suspension_frame: true }, 52);
  const body = builder.component('plate', 'recognizable passenger car body', assembly, [0, 1.23, 0], [3.5, .72, 1.58], 'aluminum', 'fixed', {
    automotive_body: true,
    passenger_car_body: true,
    body_style: 'four-door-sedan',
    design_language: 'low-wide-aerodynamic',
    front_axis: '+X',
    wheelbase_m: 2.62,
    wheel_diameter_m: .84,
    wheel_center_y_local: -.61,
    payload_kg: values.payloadKg,
  }, Math.max(70, values.payloadKg));
  builder.joint('fixed', chassis, body);

  const wheelPositions: Vec3[] = [
    [-wheelbase / 2, wheelY, -track / 2], [-wheelbase / 2, wheelY, track / 2],
    [wheelbase / 2, wheelY, -track / 2], [wheelbase / 2, wheelY, track / 2],
  ];
  wheelPositions.forEach((position, index) => {
    const corner = `${index < 2 ? 'rear' : 'front'} ${index % 2 ? 'right' : 'left'}`;
    const upright = builder.component('support', `${corner} steering upright`, assembly, [position[0], .68, position[2] * .86], [.2, .5, .16], 'steel', 'dynamic', { suspension_upright: true, operation_index: index }, 2.8);
    const wheel = builder.component('wheel', `${corner} road wheel`, assembly, position, [.84, .24, .84], 'rubber', 'dynamic', { road_vehicle_wheel: true, suspension_wheel: true, operation_index: index }, 7.2);
    const axle = builder.joint('revolute', upright, wheel, [0, 0, 1]);
    const axleJoint = builder.joints.find((item) => item.id === axle)!;
    axleJoint.anchorA = wheelPositions[index].map((value, axis) => value - builder.components.find((item) => item.id === upright)!.position[axis]) as Vec3;
    axleJoint.anchorB = [0, 0, 0];
    if (index === 0) {
      const dyno = builder.component('motor', 'wheel-speed test dynamometer', assembly, [position[0] + .28, .62, position[2] * .72], [.36, .42, .36], 'steel', 'kinematic', { suspension_dyno: true });
      builder.motor(dyno, axle, 185, 140);
      builder.connect(dyno, wheel, 'power', 'wheel_excitation');
    }
    const inboardZ = position[2] * .45;
    const upper = builder.member('beam', `${corner} upper control arm`, assembly, [position[0], .92, inboardZ], [position[0], .72, position[2] * .83], .075, 'steel', 'fixed', { suspension_arm: true, operation_index: index });
    const lower = builder.member('beam', `${corner} lower control arm`, assembly, [position[0], .58, inboardZ], [position[0], .55, position[2] * .83], .085, 'steel', 'fixed', { suspension_arm: true, operation_index: index });
    builder.connect(chassis, upper, 'mechanical', 'upper_wishbone_mount');
    builder.connect(chassis, lower, 'mechanical', 'lower_wishbone_mount');
    builder.connect(upper, upright, 'mechanical', 'upper_ball_joint');
    builder.connect(lower, upright, 'mechanical', 'lower_ball_joint');
    const spring = builder.component('spring', `${corner} coil-over spring damper`, assembly, [position[0], .9, position[2] * .61], [.11, .66, .11], 'steel', 'dynamic', { stiffness: 24500, damping: 2600, suspension_corner: corner, operation_index: index });
    builder.joint('spring', chassis, upright, [0, 1, 0], { stiffness: 24500, damping: 2600, limits: [0, .22] });
    builder.connect(spring, chassis, 'mechanical', 'upper_damper_mount');
    builder.connect(spring, lower, 'mechanical', 'lower_damper_mount');
  });

  const road = builder.component('plate', 'uneven-road test surface', assembly, [0, .08, 0], [4.7, .12, 2.45], 'concrete', 'fixed', { road_test_surface: true }, 180);
  const bumpFront = builder.component('ramp', 'front-left moving road bump', assembly, [1.22, .19, -.83], [.72, .22, .64], 'rubber', 'dynamic', { road_bump: true, route_color: 'orange', operation_index: 2 }, 8);
  const bumpRear = builder.component('ramp', 'rear-right moving road bump', assembly, [-1.22, .16, .83], [.62, .16, .64], 'rubber', 'dynamic', { road_bump: true, route_color: 'blue', operation_index: 1 }, 6);
  const frontBumpJoint = builder.joint('prismatic', road, bumpFront, [0, 1, 0], { limits: [0, .22] });
  const rearBumpJoint = builder.joint('prismatic', road, bumpRear, [0, 1, 0], { limits: [0, .18] });
  const frontShaker = builder.component('piston', 'front suspension road shaker', assembly, [1.22, .18, -.83], [.16, .42, .16], 'steel', 'kinematic', { suspension_shaker: true });
  const rearShaker = builder.component('piston', 'rear suspension road shaker', assembly, [-1.22, .18, .83], [.16, .42, .16], 'steel', 'kinematic', { suspension_shaker: true });
  const frontActuator = builder.actuator(frontShaker, frontBumpJoint, 'piston', 2200, .28, .22);
  const rearActuator = builder.actuator(rearShaker, rearBumpJoint, 'piston', 2200, .24, .18);
  const imuBody = builder.component('sensor', 'vehicle body level sensor', assembly, [0, 1.62, 0], [.24, .16, .24], 'polymer', 'fixed', { suspension_imu: true });
  const imu = builder.sensor(imuBody, 'imu', 'vehicle_body_tilt', body, 5);
  builder.connect(imuBody, body, 'mechanical', 'roof_sensor_mount');
  builder.control('independent suspension validation', 'synchronized', [imu], [frontActuator, rearActuator], 'phase the two road shakers while measuring body pitch and roll as each wheel follows a different road height', values.tiltDeg);
  return { id: 'automotive-suspension', mountId: chassis, editableId: imuBody, handles: ['mobile', 'stabilize', 'measure'], outputId: body };
}

function addLowProfileRoadVehicle(context: ModuleContext): ModuleResult {
  const { builder, text, values, rootAssemblyId } = context;
  const kart = /\b(?:go-kart|kart)\b/.test(text);
  const assembly = builder.assembly(kart ? 'go-kart assembly' : 'road vehicle assembly', 'Tubular chassis, four-wheel running gear, steering, cockpit, powertrain, brakes, sensors, bodywork, and lights built from reusable parts', rootAssemblyId);
  const electric = /electric|battery|ev\b/.test(text);
  const offRoad = /buggy|atv|all-terrain|off[- ]road/.test(text);
  const roadCar = !kart && !offRoad;
  const length = offRoad ? 2.75 : roadCar ? 4.15 : 2.45;
  const track = offRoad ? 1.55 : roadCar ? 1.68 : 1.38;
  const wheelbase = offRoad ? 1.82 : roadCar ? 2.58 : 1.7;
  const wheelDiameter = offRoad ? .72 : roadCar ? .68 : .58;
  const wheelWidth = offRoad ? .28 : roadCar ? .24 : .22;
  const rearX = -wheelbase / 2;
  const frontX = wheelbase / 2;
  const wheelY = wheelDiameter / 2 + .08;
  const railY = .59;
  const railZ = track * .31;
  const frameBodies: string[] = [];
  const addTube = (role: string, start: Vec3, end: Vec3, section = .065) => {
    const id = builder.member('tube', role, assembly, start, end, section, 'steel', 'fixed', { round_tube: true, road_vehicle_frame: true });
    frameBodies.push(id);
    return id;
  };

  for (const side of [-1, 1]) {
    const z = side * railZ;
    addTube(`${side < 0 ? 'left' : 'right'} chassis rail`, [-length / 2, railY, z], [length / 2, railY, z], .07);
    addTube(`${side < 0 ? 'left' : 'right'} cockpit side rail`, [-.55, .72, z], [.62, .72, z], .055);
    addTube(`${side < 0 ? 'left' : 'right'} rear motor guard`, [-length / 2, .61, z], [rearX - .1, .91, z], .05);
  }
  for (const [role, x] of [['rear bumper crossmember', -length / 2], ['rear chassis crossmember', rearX], ['seat crossmember', -.2], ['front chassis crossmember', frontX], ['front bumper crossmember', length / 2]] as const) {
    addTube(role, [x, role.includes('bumper') ? .53 : railY, -railZ], [x, role.includes('bumper') ? .53 : railY, railZ], role.includes('bumper') ? .075 : .06);
  }
  const floor = builder.component('plate', kart ? 'go-kart floor pan' : 'reinforced passenger-car floor pan', assembly, [.02, .62, 0], [roadCar ? length * .76 : 1.55, roadCar ? .075 : .055, roadCar ? track * .76 : railZ * 1.62], 'aluminum', 'fixed', { road_vehicle_floor: true, passenger_car_floor: roadCar }, roadCar ? 12.5 : 4.2);
  frameBodies.forEach((body, index) => builder.connect(index ? frameBodies[index - 1] : floor, body, 'mechanical', 'welded_tubular_frame'));
  builder.connect(floor, frameBodies[0], 'mechanical', 'floor_pan_fasteners');
  if (kart) {
    for (const side of [-1, 1]) {
      const pod = builder.component('body-shell', `${side < 0 ? 'left' : 'right'} impact side pod`, assembly, [.02, .68, side * railZ], [1.42, .3, .18], 'composite', 'fixed', { kart_side_pod: true, protective_bodywork: true }, 2.1);
      builder.components.find((item) => item.id === pod)!.color = '#5466d9';
      builder.connect(pod, floor, 'mechanical', 'side_pod_bracket');
    }
    const nose = builder.component('body-shell', 'aerodynamic front nose fairing', assembly, [length * .43, .67, 0], [.72, .31, railZ * 1.38], 'composite', 'fixed', { kart_nose: true, protective_bodywork: true }, 2.8);
    builder.components.find((item) => item.id === nose)!.color = '#596be2';
    const bumper = builder.component('tube', 'wraparound front bumper', assembly, [length * .55, .51, 0], [track * .88, .1, .1], 'steel', 'fixed', { kart_front_bumper: true, round_tube: true }, 2.2);
    builder.rotate(bumper, [0, Math.PI / 2, 0]);
    builder.connect(nose, floor, 'mechanical', 'nose_mount');
    builder.connect(bumper, frameBodies.at(-1)!, 'mechanical', 'bumper_mount');
  }

  const centeredRevolute = (supportId: string, rotaryId: string) => {
    const support = builder.components.find((item) => item.id === supportId)!;
    const rotary = builder.components.find((item) => item.id === rotaryId)!;
    const id = builder.joint('revolute', supportId, rotaryId, [0, 0, 1]);
    const joint = builder.joints.find((item) => item.id === id)!;
    joint.anchorA = rotary.position.map((value, index) => value - support.position[index]) as Vec3;
    joint.anchorB = [0, 0, 0];
    joint.limits = undefined;
    return id;
  };

  const wheelSpecs = [
    { role: 'rear left drive wheel', position: [rearX, wheelY, -track / 2] as Vec3, driven: true, side: 'left' },
    { role: 'rear right drive wheel', position: [rearX, wheelY, track / 2] as Vec3, driven: true, side: 'right' },
    { role: 'front left steering wheel', position: [frontX, wheelY, -track / 2] as Vec3, driven: false, side: 'left' },
    { role: 'front right steering wheel', position: [frontX, wheelY, track / 2] as Vec3, driven: false, side: 'right' },
  ];
  const wheels: string[] = [];
  const driveMotors: string[] = [];
  const frontKnuckles = new Map<'left' | 'right', string>();
  for (const spec of wheelSpecs) {
    const sideSign = spec.side === 'left' ? -1 : 1;
    let spinSupport: string;
    let spinBody: string;
    if (spec.driven) {
      const carrier = builder.component('support', `${spec.side} rear axle carrier`, assembly, [spec.position[0], wheelY, sideSign * (track / 2 - wheelWidth * .56)], [.2, .32, .16], 'steel', 'fixed', { road_vehicle_axle_support: true, steering_side: spec.side }, 1.4);
      const spindle = builder.component('shaft', `${spec.side} rear axle spindle`, assembly, spec.position, [.1, wheelWidth * 1.72, .1], 'steel', 'fixed', { road_vehicle_spindle: true, axle_axis: 'Z', steering_side: spec.side }, 1.1);
      builder.rotate(spindle, [Math.PI / 2, 0, 0]);
      const hub = builder.component('bearing', `${spec.side} rear wheel hub and bearing`, assembly, spec.position, [.24, wheelWidth * .82, .24], 'steel', 'dynamic', { road_vehicle_wheel_hub: true, axle_axis: 'Z', steering_side: spec.side }, 1.25);
      builder.rotate(hub, [Math.PI / 2, 0, 0]);
      builder.connect(carrier, floor, 'mechanical', 'rear_axle_carrier_mount');
      builder.joint('fixed', carrier, spindle);
      spinSupport = spindle;
      spinBody = hub;
    } else {
      const kingpin = builder.component('shaft', `${spec.side} front near-vertical kingpin`, assembly, [frontX, wheelY + .1, sideSign * (track / 2 - wheelWidth * .66)], [.07, .38, .07], 'steel', 'fixed', { road_vehicle_kingpin: true, steering_side: spec.side, kingpin_axis: 'Y' }, .82);
      const knuckle = builder.component('support', `${spec.side} front steering knuckle`, assembly, [frontX, wheelY + .08, sideSign * (track / 2 - wheelWidth * .52)], [.22, .34, .16], 'steel', 'dynamic', { road_vehicle_steering_knuckle: true, road_vehicle_front_steering: true, steering_side: spec.side, ackermann_wheelbase_m: wheelbase, ackermann_track_m: track }, 1.65);
      const kingpinJoint = builder.joint('revolute', kingpin, knuckle, [0, 1, 0], { limits: [-.48, .48] });
      const kingpinBody = builder.components.find((item) => item.id === kingpin)!;
      const knuckleBody = builder.components.find((item) => item.id === knuckle)!;
      const kingpinHinge = builder.joints.find((item) => item.id === kingpinJoint)!;
      kingpinHinge.anchorA = knuckleBody.position.map((value, index) => value - kingpinBody.position[index]) as Vec3;
      kingpinHinge.anchorB = [0, 0, 0];
      builder.connect(kingpin, floor, 'mechanical', 'front_crossmember_kingpin_support');

      const spindle = builder.component('shaft', `${spec.side} front horizontal wheel spindle`, assembly, spec.position, [.1, wheelWidth * 1.75, .1], 'steel', 'dynamic', { road_vehicle_spindle: true, road_vehicle_front_steering: true, steering_side: spec.side, axle_axis: 'Z' }, 1.05);
      builder.rotate(spindle, [Math.PI / 2, 0, 0]);
      builder.joint('fixed', knuckle, spindle);
      const hub = builder.component('bearing', `${spec.side} front wheel hub and bearing`, assembly, spec.position, [.24, wheelWidth * .84, .24], 'steel', 'dynamic', { road_vehicle_wheel_hub: true, road_vehicle_front_steering: true, steering_side: spec.side, axle_axis: 'Z' }, 1.2);
      builder.rotate(hub, [Math.PI / 2, 0, 0]);
      spinSupport = spindle;
      spinBody = hub;
      frontKnuckles.set(spec.side as 'left' | 'right', knuckle);
    }

    const wheel = builder.component('wheel', spec.role, assembly, spec.position, [wheelDiameter, wheelWidth, wheelDiameter], 'rubber', 'dynamic', { road_vehicle_wheel: true, road_vehicle_front_steering: !spec.driven, steering_side: spec.side, axle_axis: 'Z', ackermann_wheelbase_m: wheelbase, ackermann_track_m: track, friction: offRoad ? 1.18 : 1.05 }, offRoad ? 5.8 : 4.1);
    const hubJoint = centeredRevolute(spinSupport, spinBody);
    builder.joint('fixed', spinBody, wheel);
    wheels.push(wheel);
    if (spec.driven) {
      const motor = builder.component('motor', `${spec.role.includes('left') ? 'left' : 'right'} ${electric ? 'electric traction motor' : 'engine output drive'}`, assembly, [spec.position[0] + .17, wheelY + .09, spec.position[2] * .69], [.32, .25, .32], 'aluminum', 'kinematic', { road_vehicle_motor: true }, 4.8);
      builder.motor(motor, hubJoint, Math.max(62, values.payloadKg * 2.6), offRoad ? 190 : 225, -1);
      builder.connect(motor, spinBody, 'power', 'rear_hub_torque');
      builder.connect(motor, floor, 'mechanical', 'motor_mount');
      driveMotors.push(motor);
    }
    if (!spec.driven) {
      const disc = builder.component('gear', `${spec.role.includes('left') ? 'left' : 'right'} front brake disc`, assembly, [spec.position[0], wheelY, spec.position[2] * .84], [.25, .025, .25], 'steel', 'dynamic', { road_vehicle_brake: true, road_vehicle_front_steering: true, steering_side: spec.side, axle_axis: 'Z', teeth: 24 }, .42);
      builder.joint('fixed', spinBody, disc);
    }
  }

  const driverZ = roadCar ? -track * .22 : 0;
  const seat = builder.component('seat', roadCar ? 'left-side driver seat' : 'single high-back bucket seat', assembly, [roadCar ? -.22 : -.3, roadCar ? .94 : 1.02, driverZ], [.62, roadCar ? .54 : .72, .58], 'polymer', 'fixed', { road_vehicle_seat: true, driver_seat: roadCar, seat_form: 'bucket' }, 5.2);
  if (kart) builder.components.find((item) => item.id === seat)!.color = '#2ab164';
  builder.connect(seat, floor, 'mechanical', 'seat_rails');
  if (roadCar) {
    const passengerSeat = builder.component('seat', 'front passenger seat', assembly, [-.22, .94, track * .22], [.62, .54, .58], 'polymer', 'fixed', { road_vehicle_seat: true, passenger_seat: true, seat_form: 'bucket' }, 5.1);
    const rearBench = builder.component('seat', 'rear passenger bench seat', assembly, [-.88, .92, 0], [.58, .48, track * .62], 'polymer', 'fixed', { road_vehicle_seat: true, rear_bench_seat: true, seat_form: 'bench' }, 8.4);
    builder.connect(passengerSeat, floor, 'mechanical', 'passenger_seat_rails');
    builder.connect(rearBench, floor, 'mechanical', 'rear_bench_mounts');
  }
  const column = addTube('steering column', [.45, .69, driverZ], [.64, roadCar ? 1.11 : 1.21, driverZ], .045);
  const steeringWheel = builder.component('steering', 'steering wheel', assembly, [.66, roadCar ? 1.15 : 1.25, driverZ], [.38, .065, .38], 'polymer', 'fixed', { road_vehicle_steering_wheel: true, driver_side: roadCar ? 'left' : 'center', control_form: 'wheel' }, .68);
  if (kart) builder.components.find((item) => item.id === steeringWheel)!.color = '#c94740';
  builder.rotate(steeringWheel, [0, 0, -.36]);
  builder.connect(column, steeringWheel, 'mechanical', 'steering_hub');
  const rackHousing = builder.component('support', 'steering rack housing and frame brackets', assembly, [frontX - .12, .59, 0], [.22, .22, track * .52], 'steel', 'fixed', { road_vehicle_steering_rack_support: true, grounded_structure: true }, 2.4);
  builder.connect(rackHousing, floor, 'mechanical', 'steering_rack_frame_brackets');
  const rack = builder.component('shaft', 'front steering rack', assembly, [frontX - .08, .59, 0], [.07, track * .72, .07], 'steel', 'kinematic', { road_vehicle_steering_rack: true, steering_rack_moving: true, rack_travel_m: .16, rack_axis: 'Z', ackermann_wheelbase_m: wheelbase, ackermann_track_m: track }, 2.1);
  builder.rotate(rack, [Math.PI / 2, 0, 0]);
  const rackJoint = builder.joint('prismatic', rackHousing, rack, [0, 0, 1], { limits: [-.08, .08] });
  const pinion = builder.component('gear', 'steering-column pinion gear', assembly, [frontX - .18, .7, 0], [.2, .08, .2], 'steel', 'fixed', { road_vehicle_steering_pinion: true, teeth: 14 }, .55);
  builder.rotate(pinion, [Math.PI / 2, 0, 0]);
  builder.connect(column, pinion, 'mechanical', 'steering_column_pinion_shaft');
  builder.connect(pinion, rack, 'mechanical', 'rack_and_pinion_mesh');
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'left' : 'right';
    const knuckle = frontKnuckles.get(sideName)!;
    const rackEnd: Vec3 = [frontX - .08, .59, side * track * .26];
    const steeringArm: Vec3 = [frontX - .11, wheelY + .06, side * (track / 2 - wheelWidth * .48)];
    const tieRod = builder.member('tube', `${sideName} adjustable steering tie rod`, assembly, rackEnd, steeringArm, .03, 'steel', 'kinematic', { road_vehicle_steering_tie_rod: true, steering_tie_rod: true, steering_side: sideName, steering_rack_travel_m: .16, ackermann_wheelbase_m: wheelbase, ackermann_track_m: track });
    builder.connect(rack, tieRod, 'mechanical', 'inner_tie_rod_ball_joint');
    builder.connect(tieRod, knuckle, 'mechanical', 'outer_tie_rod_steering_arm');
  }
  const steeringServo = builder.component('servo', 'steering rack electric test actuator', assembly, [frontX - .3, .48, .38], [.26, .18, .22], 'aluminum', 'fixed', { road_vehicle_steering_actuator: true }, .8);
  builder.connect(steeringServo, rackHousing, 'mechanical', 'steering_actuator_bracket');
  const rackActuator = builder.actuator(steeringServo, rackJoint, 'servo', 950, .36, .16);
  const anglePickup = builder.component('sensor', 'front wheel steering-angle sensor', assembly, [frontX - .18, .78, -.32], [.13, .1, .11], 'polymer', 'fixed', { road_vehicle_steering_sensor: true }, .09);
  const steeringSensor = builder.sensor(anglePickup, 'angle', 'road_wheel_steering_angle', frontKnuckles.get('left'), 2);
  builder.connect(anglePickup, rackHousing, 'mechanical', 'steering_sensor_bracket');
  builder.control('Ackermann steering linkage', 'tracking', [steeringSensor], [rackActuator], 'translate wheel input through rack and tie rods; pivot on vertical kingpins, spin on horizontal spindles, and steer the inside tire farther', .34);

  if (!kart) {
    const bodyLength = roadCar ? length * .92 : 2.36;
    const bodyWidth = roadCar ? track * .93 : 1.34;
    const bodyHeight = roadCar ? .9 : .72;
    const body = builder.component('body-shell', roadCar ? 'futuristic passenger sports car body shell' : 'recognizable off-road vehicle body shell', assembly, [-.03, roadCar ? .94 : 1.0, 0], [bodyLength, bodyHeight, bodyWidth], 'aluminum', 'fixed', { automotive_body: true, road_vehicle_body: true, passenger_car_body: roadCar, body_style: roadCar ? 'four-door-sedan' : 'off-road', design_language: roadCar ? 'low-wide-aerodynamic' : 'off-road', front_axis: '+X', wheelbase_m: wheelbase, wheel_diameter_m: wheelDiameter, wheel_center_y_local: wheelY - (roadCar ? .94 : 1) }, roadCar ? 44 : 32);
    builder.components.find((item) => item.id === body)!.color = roadCar ? '#d7dde0' : '#4276a1';
    builder.connect(body, floor, 'mechanical', 'body_to_frame_mounts');
    const windshield = builder.component('plate', 'transparent centered front windshield', assembly, [roadCar ? .56 : .42, roadCar ? 1.27 : 1.46, 0], [.045, roadCar ? .46 : .58, roadCar ? track * .68 : 1.02], 'polymer', 'fixed', { cockpit_windshield: true, transparent_glazing: true, windshield_angle_deg: roadCar ? 30 : 16, facing_axis: '+X', attached_to_cockpit: true }, roadCar ? 2.6 : 2.2);
    builder.rotate(windshield, [0, 0, roadCar ? -.52 : -.28]);
    builder.connect(windshield, body, 'mechanical', 'windshield_frame_bond');
    if (roadCar) {
      const rearWindow = builder.component('plate', 'transparent rear windshield', assembly, [-.65, 1.27, 0], [.045, .4, track * .63], 'polymer', 'fixed', { rear_windshield: true, transparent_glazing: true, facing_axis: '-X', attached_to_cockpit: true }, 2.3);
      builder.rotate(rearWindow, [0, 0, .5]);
      builder.connect(rearWindow, body, 'mechanical', 'rear_window_frame_bond');
      for (const side of [-1, 1]) {
        const sideWindow = builder.component('plate', `${side < 0 ? 'left' : 'right'} swept transparent side windows`, assembly, [-.05, 1.26, side * track * .39], [1.18, .3, .025], 'polymer', 'fixed', { side_window: true, transparent_glazing: true, glazing_side: side < 0 ? 'left' : 'right', attached_to_cockpit: true }, 1.6);
        builder.connect(sideWindow, body, 'mechanical', 'side_window_frame_bond');
      }
    }
  }

  const battery = builder.component('battery', electric ? 'high-voltage traction battery' : 'starter battery', assembly, [rearX + .12, .82, 0], [.62, .3, .5], 'polymer', 'fixed', { road_vehicle_battery: true }, electric ? 18 : 7);
  const controller = builder.component('controller', electric ? 'dual-motor inverter controller' : 'powertrain controller', assembly, [-.03, .79, railZ * .75], [.38, .24, .26], 'polymer', 'fixed', { road_vehicle_controller: true }, 1.7);
  // The driver faces +X: negative Z is the left foot and positive Z the right.
  // Each pedal component is anchored at its floor pivot; the scene composes a
  // visible lever and upright foot pad from this low-level plate primitive.
  const pedal = builder.component('pedal', 'accelerator pedal', assembly, [.38, .65, driverZ + .11], [.038, .18, .095], 'aluminum', 'fixed', { road_vehicle_pedal: true, pedal_kind: 'accelerator', driver_side: roadCar ? 'left' : 'center' }, .22);
  const brakePedal = builder.component('pedal', 'brake pedal', assembly, [.38, .65, driverZ - .11], [.042, .19, .135], 'steel', 'fixed', { road_vehicle_pedal: true, pedal_kind: 'brake', driver_side: roadCar ? 'left' : 'center' }, .28);
  for (const item of [battery, controller, pedal, brakePedal]) builder.connect(item, floor, 'mechanical', 'cockpit_mount');
  builder.connect(battery, controller, 'power', 'dc_traction_bus');
  driveMotors.forEach((motor) => builder.connect(controller, motor, 'signal', 'motor_torque_command'));

  const speedPickup = builder.component('sensor', 'rear axle speed sensor', assembly, [rearX + .12, .72, railZ * .72], [.14, .12, .11], 'polymer', 'fixed', { road_vehicle_sensor: true }, .11);
  const speed = builder.sensor(speedPickup, 'speed', 'vehicle_speed', wheels[0], 5);
  builder.connect(speedPickup, controller, 'signal', 'wheel_speed_feedback');
  builder.connect(speedPickup, floor, 'mechanical', 'sensor_bracket');
  builder.control(electric ? 'electric road-vehicle drive' : 'road-vehicle powertrain', 'pid', [speed], [], 'blend accelerator demand across both rear drive hubs while limiting wheel slip and overspeed', offRoad ? 25 : 35);

  if (/headlights?|head lamps?|front lights?|night/.test(text)) {
    for (const side of [-1, 1]) {
      const light = builder.component('light', `${side < 0 ? 'left' : 'right'} LED headlight`, assembly, [length / 2 + .05, .72, side * railZ * .62], [.27, .18, .18], 'aluminum', 'fixed', { headlight: true, vehicle_light: true, light_direction: 'front', facing_x: 1, facing_axis: '+X', beam_range: 4.2 }, .25);
      builder.connect(battery, light, 'power', 'lighting_bus');
      builder.connect(light, frameBodies.at(-1)!, 'mechanical', 'headlight_bracket');
    }
  }

  if (/\b(?:brake|rear|tail) lights?\b/.test(text)) {
    for (const side of [-1, 1]) {
      const light = builder.component('light', `${side < 0 ? 'left' : 'right'} rear brake light`, assembly, [-length / 2 - .02, .7, side * railZ * .62], [.22, .16, .16], 'polymer', 'fixed', { brake_light: true, vehicle_light: true, light_direction: 'rear', facing_x: -1, facing_axis: '-X', beam_range: 2.1 }, .18);
      builder.components.find((item) => item.id === light)!.color = '#ff313d';
      builder.connect(battery, light, 'power', 'brake_light_bus');
      builder.connect(light, frameBodies[0], 'mechanical', 'rear_light_bracket');
    }
  }

  return { id: 'low-profile-road-vehicle', mountId: floor, editableId: steeringWheel, handles: ['mobile', 'measure'] };
}

function addMotorcycle(context: ModuleContext): ModuleResult {
  const { builder, text, values, rootAssemblyId } = context;
  const assembly = builder.assembly('motorcycle assembly', 'Two-wheel powered vehicle assembled from a tubular frame, steering fork, saddle, wheels, brakes, power unit, controls, suspension, and lighting', rootAssemblyId);
  const electric = /electric|battery/.test(text);
  const rear: Vec3 = [-1.12, .62, 0];
  const front: Vec3 = [1.18, .62, 0];
  const steeringPivot: Vec3 = [.72, 1.55, 0];
  // A motorcycle does not steer around world-up. Its fork, crown, handlebar,
  // front hub, wheel, fender, and headlight all pivot about the same steering-
  // head line, raked rearward as it rises from the front axle. Store the unit
  // axis explicitly on every moving member so renderers and WebMCP clients can
  // reproduce one rigid front assembly without guessing from part names.
  const steeringAxisLength = Math.hypot(steeringPivot[0] - front[0], steeringPivot[1] - front[1]);
  const steeringAxis: Vec3 = [
    (steeringPivot[0] - front[0]) / steeringAxisLength,
    (steeringPivot[1] - front[1]) / steeringAxisLength,
    0,
  ];
  const steeringMotion = {
    motorcycle_steering_pivot_x: steeringPivot[0],
    motorcycle_steering_pivot_y: steeringPivot[1],
    motorcycle_steering_pivot_z: steeringPivot[2],
    motorcycle_steering_axis_x: steeringAxis[0],
    motorcycle_steering_axis_y: steeringAxis[1],
    motorcycle_steering_axis_z: steeringAxis[2],
    motorcycle_steering_axis: 'raked-up-rearward',
    motorcycle_steering_rake_deg: Math.atan2(Math.abs(steeringAxis[0]), steeringAxis[1]) * 180 / Math.PI,
  };
  const wheelDiameter = /dirt|off[- ]road/.test(text) ? 1.12 : 1.02;
  const frameIds: string[] = [];
  const tube = (role: string, start: Vec3, end: Vec3, section = .065) => {
    const isFork = /fork/.test(role);
    const id = builder.member('tube', role, assembly, start, end, section, 'aluminum', 'fixed', {
      motorcycle_frame: !isFork,
      motorcycle_fork: isFork,
      motorcycle_steering_member: isFork,
      ...(isFork ? steeringMotion : {}),
      round_tube: true,
    });
    const body = builder.components.find((item) => item.id === id);
    if (body) body.color = isFork ? '#c8d2d6' : '#53656f';
    frameIds.push(id);
    return id;
  };
  const rearDropout = builder.component('bearing', 'rear wheel bearing and swingarm pivot', assembly, rear, [.25, .2, .25], 'steel', 'fixed', { motorcycle_bearing: true, motorcycle_rear_hub: true }, .9);
  const frontDropout = builder.component('bearing', 'front steering axle bearing', assembly, front, [.25, .2, .25], 'steel', 'fixed', { motorcycle_bearing: true, motorcycle_front_hub: true, motorcycle_steering_member: true, ...steeringMotion }, .9);
  tube('lower cradle tube', [-.85, .78, 0], [.65, .8, 0], .08);
  tube('upper backbone tube', [-.62, 1.32, 0], [.58, 1.46, 0], .09);
  tube('rear frame stay', rear, [-.62, 1.32, 0], .065);
  tube('front down tube', [.58, 1.46, 0], [.65, .8, 0], .075);
  for (const side of [-1, 1]) {
    tube(`${side < 0 ? 'left' : 'right'} rear swingarm`, rear.map((value, index) => index === 2 ? side * .11 : value) as Vec3, [-.42, .82, side * .11], .065);
    tube(`${side < 0 ? 'left' : 'right'} telescopic fork`, [front[0], front[1], side * .11], [.72, 1.58, side * .11], .07);
  }
  const forkCrown = builder.component('support', 'motorcycle fork crown and steering head', assembly, steeringPivot, [.22, .16, .42], 'steel', 'fixed', { motorcycle_fork_crown: true, motorcycle_steering_member: true, ...steeringMotion }, 1.6);
  const rearShock = builder.component('spring', 'rear monoshock suspension', assembly, [-.58, 1.02, 0], [.095, .5, .095], 'steel', 'fixed', { motorcycle_rear_shock: true, stiffness: 28000, damping: 2200 }, 2.2);
  builder.rotate(rearShock, [0, 0, -.42]);
  frameIds.forEach((id, index) => builder.connect(index ? frameIds[index - 1] : rearDropout, id, 'mechanical', 'welded_motorcycle_frame'));
  builder.connect(frameIds.at(-1)!, frontDropout, 'mechanical', 'front_fork_axle');
  builder.connect(forkCrown, frameIds[1], 'mechanical', 'steering_head_bearing');
  builder.connect(rearShock, frameIds[4], 'mechanical', 'rear_suspension_mount');

  const centeredWheel = (support: string, role: string, position: Vec3, frontSteering: boolean) => {
    const wheel = builder.component('wheel', role, assembly, position, [wheelDiameter, .18, wheelDiameter], 'rubber', 'dynamic', { road_vehicle_wheel: true, road_vehicle_front_steering: frontSteering, steering_side: 'center', motorcycle_wheel: true, motorcycle_front_wheel: frontSteering, axle_axis: 'Z', friction: 1.08, operation_speed_mps: 1.35, ...(frontSteering ? steeringMotion : {}) }, 4.8);
    const joint = builder.joint('revolute', support, wheel, [0, 0, 1]);
    const supportBody = builder.components.find((item) => item.id === support)!;
    const hinge = builder.joints.find((item) => item.id === joint)!;
    hinge.anchorA = position.map((value, index) => value - supportBody.position[index]) as Vec3;
    hinge.anchorB = [0, 0, 0];
    hinge.limits = undefined;
    return { wheel, joint };
  };
  const rearWheel = centeredWheel(rearDropout, 'rear driven motorcycle wheel', rear, false);
  centeredWheel(frontDropout, 'front steering motorcycle wheel', front, true);
  const seat = builder.component('seat', 'stepped rider and pillion saddle', assembly, [-.38, 1.49, 0], [.92, .18, .42], 'polymer', 'fixed', { seat_form: 'saddle', motorcycle_seat: true }, 1.8);
  const steering = builder.component('steering', 'motorcycle handlebar control', assembly, [.72, 1.78, 0], [.28, .12, .92], 'steel', 'fixed', { control_form: 'handlebar', motorcycle_handlebar: true, motorcycle_steering_member: true, ...steeringMotion }, 1.3);
  const power = builder.component(electric ? 'battery' : 'body-shell', electric ? 'traction battery and controller pack' : 'compact engine and fuel system', assembly, [-.1, 1.04, 0], [.72, .56, .48], electric ? 'polymer' : 'aluminum', 'fixed', { motorcycle_power_unit: true, motorcycle_battery: electric }, electric ? 12 : 18);
  const tank = builder.component('body-shell', electric ? 'sculpted upper battery cover and tank fairing' : 'sculpted fuel tank', assembly, [.28, 1.42, 0], [.92, .54, .56], 'composite', 'fixed', { motorcycle_bodywork: true, motorcycle_tank: true }, 4.2);
  const motor = builder.component('motor', electric ? 'electric motorcycle drive motor' : 'motorcycle engine output drive', assembly, [-.45, .85, .12], [.42, .24, .42], 'aluminum', 'kinematic', { motorcycle_motor: true }, 6.5);
  const chain = builder.component('belt', 'rear wheel chain drive', assembly, [-.77, .73, .12], [.95, .035, .25], 'steel', 'kinematic', { bicycle_chain: true, motorcycle_chain: true }, .9);
  const frontFender = builder.component('body-shell', 'front wheel mudguard', assembly, [1.18, 1.01, 0], [.7, .11, .3], 'composite', 'fixed', { motorcycle_fender: true, motorcycle_front_fender: true, motorcycle_steering_member: true, ...steeringMotion }, .8);
  const rearFender = builder.component('body-shell', 'rear wheel mudguard and tail cowl', assembly, [-1.02, 1.03, 0], [.72, .12, .34], 'composite', 'fixed', { motorcycle_fender: true, motorcycle_rear_fender: true }, .9);
  const footPegs = builder.component('shaft', 'rider foot pegs', assembly, [-.1, .78, 0], [.08, .64, .08], 'steel', 'fixed', { motorcycle_foot_pegs: true }, .8);
  builder.rotate(footPegs, [Math.PI / 2, 0, 0]);
  const drive = builder.motor(motor, rearWheel.joint, Math.max(95, values.torqueNm * 1.5), 520, -1);
  builder.joint('belt', motor, rearWheel.wheel, [0, 0, 1], { ratio: 3.1 });
  for (const id of [seat, steering, power, tank, motor, chain, frontFender, rearFender, footPegs]) builder.connect(id, frameIds[0], 'mechanical', 'motorcycle_mount');
  const headlight = builder.component('light', 'round LED motorcycle headlight', assembly, [.93, 1.5, 0], [.3, .24, .3], 'aluminum', 'fixed', { headlight: true, vehicle_light: true, motorcycle_headlight: true, motorcycle_steering_member: true, ...steeringMotion, light_direction: 'front', facing_x: 1, facing_axis: '+X', beam_range: 5 }, .48);
  const imuBody = builder.component('sensor', 'lean and wheel-speed sensor', assembly, [-.05, 1.36, .18], [.14, .11, .1], 'polymer', 'fixed', { motorcycle_imu: true }, .08);
  const imu = builder.sensor(imuBody, 'imu', 'motorcycle_lean', frameIds[0], 4);
  builder.connect(headlight, power, 'power', 'lighting_bus');
  builder.connect(imuBody, frameIds[0], 'mechanical', 'sensor_mount');
  builder.control('motorcycle stability and drive', 'pid', [imu], [], 'coordinate throttle with measured lean and wheel speed while preserving rider steering input', 0);
  return { id: 'motorcycle', mountId: frameIds[0], editableId: steering, handles: ['mobile', 'rotate', 'stabilize', 'measure'], driveId: drive };
}

function addFixedWingAircraft(context: ModuleContext): ModuleResult {
  const { builder, text, values, rootAssemblyId } = context;
  const assembly = builder.assembly('fixed-wing aircraft assembly', 'Recognizable light aircraft assembled from fuselage, wings, tail surfaces, propeller, landing gear, power, flight controls, and sensors', rootAssemblyId);
  const fuselage = builder.component('fuselage', 'streamlined aircraft fuselage', assembly, [0, 1.3, 0], [4.2, .86, .82], 'aluminum', 'fixed', { aircraft_fuselage: true }, 86);
  const canopy = builder.component('body-shell', 'transparent cockpit canopy and windshield', assembly, [.42, 1.72, 0], [1.05, .5, .68], 'polymer', 'fixed', { cockpit_canopy: true, cockpit_windshield: true, transparent_glazing: true, aircraft_cockpit: true, facing_axis: '+X', windshield_angle_deg: 14, attached_to_cockpit: true }, 8);
  builder.rotate(canopy, [0, 0, -.12]);
  const leftWing = builder.component('aerofoil', 'left main wing', assembly, [-.05, 1.32, -1.28], [1.35, .13, 2.55], 'composite', 'fixed', { aircraft_wing: true, aerofoil_role: 'main', aircraft_side: 'left' }, 14);
  const rightWing = builder.component('aerofoil', 'right main wing', assembly, [-.05, 1.32, 1.28], [1.35, .13, 2.55], 'composite', 'fixed', { aircraft_wing: true, aerofoil_role: 'main', aircraft_side: 'right' }, 14);
  const tailplane = builder.component('aerofoil', 'horizontal tail stabilizer', assembly, [-1.72, 1.48, 0], [.82, .09, 1.85], 'composite', 'fixed', { aircraft_wing: true, aerofoil_role: 'tail' }, 5.5);
  const fin = builder.component('aerofoil', 'vertical tail fin and rudder', assembly, [-1.75, 1.88, 0], [.78, .08, .88], 'composite', 'fixed', { aircraft_fin: true }, 4.2);
  builder.rotate(fin, [Math.PI / 2, 0, 0]);
  for (const id of [canopy, leftWing, rightWing, tailplane, fin]) builder.connect(id, fuselage, 'mechanical', 'airframe_structure');
  for (const [side, wing] of [['left', leftWing], ['right', rightWing]] as const) {
    const z = side === 'left' ? -1.58 : 1.58;
    const aileron = builder.component('aerofoil', `${side} aileron control surface`, assembly, [-.56, 1.31, z], [.34, .075, 1.55], 'composite', 'dynamic', { aircraft_control_surface: true, control_axis: 'roll', aircraft_side: side, motion_pivot_x: -.39, motion_pivot_y: 1.31, motion_pivot_z: z }, 2.1);
    const hingeJoint = builder.joint('revolute', wing, aileron, [0, 0, 1], { limits: [-.35, .35] });
    const servo = builder.component('servo', `${side} aileron servo`, assembly, [-.25, 1.24, z], [.2, .12, .18], 'aluminum', 'fixed', { aircraft_servo: true, control_axis: 'roll' }, .55);
    builder.connect(servo, wing, 'mechanical', 'aileron_servo_mount');
    builder.actuator(servo, hingeJoint, 'servo', 180, 1.4, .7);
  }
  const elevator = builder.component('aerofoil', 'elevator pitch control surface', assembly, [-1.93, 1.48, 0], [.3, .07, 1.55], 'composite', 'dynamic', { aircraft_control_surface: true, control_axis: 'pitch', motion_pivot_x: -1.78, motion_pivot_y: 1.48, motion_pivot_z: 0 }, 1.8);
  const elevatorJoint = builder.joint('revolute', tailplane, elevator, [0, 0, 1], { limits: [-.3, .3] });
  const elevatorServo = builder.component('servo', 'elevator servo', assembly, [-1.63, 1.4, 0], [.2, .12, .18], 'aluminum', 'fixed', { aircraft_servo: true, control_axis: 'pitch' }, .5);
  builder.connect(elevatorServo, tailplane, 'mechanical', 'elevator_servo_mount');
  builder.actuator(elevatorServo, elevatorJoint, 'servo', 180, 1.2, .6);
  const motor = builder.component('motor', 'nose-mounted propulsion motor', assembly, [1.95, 1.3, 0], [.42, .52, .52], 'aluminum', 'fixed', { aircraft_motor: true }, 18);
  const propeller = builder.component('propeller', 'three-blade aircraft propeller', assembly, [2.28, 1.3, 0], [1.52, .16, 1.52], 'composite', 'dynamic', { blade_count: 3, rotor_axis: 'forward', operation_spin: true, powered_propulsor: true }, 3.6);
  builder.rotate(propeller, [0, Math.PI / 2, 0]);
  const propJoint = builder.joint('revolute', motor, propeller, [1, 0, 0]);
  const propBody = builder.components.find((item) => item.id === propeller)!;
  const motorBody = builder.components.find((item) => item.id === motor)!;
  const hinge = builder.joints.find((item) => item.id === propJoint)!;
  hinge.anchorA = propBody.position.map((value, index) => value - motorBody.position[index]) as Vec3;
  hinge.anchorB = [0, 0, 0];
  hinge.limits = undefined;
  const drive = builder.motor(motor, propJoint, Math.max(140, values.torqueNm * 2), 2200);
  builder.connect(motor, fuselage, 'mechanical', 'firewall_motor_mount');
  for (const [role, position] of [
    ['left main landing gear', [-.38, .72, -.78] as Vec3], ['right main landing gear', [-.38, .72, .78] as Vec3], ['nose landing gear', [1.35, .7, 0] as Vec3],
  ] as const) {
    const gear = builder.component('landing-gear', role, assembly, position, [.38, .72, .24], 'steel', 'fixed', { aircraft_landing_gear: true }, 7);
    builder.connect(gear, fuselage, 'mechanical', 'landing_gear_mount');
  }
  const battery = builder.component('battery', 'aircraft propulsion battery', assembly, [.3, 1.2, 0], [.78, .3, .48], 'polymer', 'fixed', { aircraft_battery: true }, 24);
  const controller = builder.component('controller', 'flight controller and motor inverter', assembly, [-.35, 1.22, 0], [.38, .23, .34], 'polymer', 'fixed', { aircraft_controller: true }, 2.2);
  const camera = builder.component('camera', 'forward navigation camera', assembly, [1.35, 1.48, 0], [.18, .14, .16], 'polymer', 'fixed', { aircraft_camera: true }, .18);
  const imu = builder.sensor(camera, 'imu', 'aircraft_attitude', fuselage, 12);
  builder.connect(battery, controller, 'power', 'flight_power_bus'); builder.connect(controller, motor, 'signal', 'propulsion_command');
  if (/\b(?:navigation|nav|position) lights?\b/.test(text)) {
    const lights = [
      { role: 'left red wingtip navigation light', support: leftWing, position: [-.05, 1.36, -2.53] as Vec3, color: '#ff3344', side: 'left', facingAxis: '-Z', direction: 'left' },
      { role: 'right green wingtip navigation light', support: rightWing, position: [-.05, 1.36, 2.53] as Vec3, color: '#32e875', side: 'right', facingAxis: '+Z', direction: 'right' },
      { role: 'white rearward tail navigation light', support: tailplane, position: [-2.12, 1.52, 0] as Vec3, color: '#f3f8ff', side: 'tail', facingAxis: '-X', direction: 'rear' },
    ];
    for (const item of lights) {
      const light = builder.component('light', item.role, assembly, item.position, [.14, .12, .12], 'polymer', 'fixed', { aircraft_navigation_light: true, marker_light: true, navigation_side: item.side, light_direction: item.direction, facing_axis: item.facingAxis, facing_x: item.facingAxis === '-X' ? -1 : item.facingAxis === '+X' ? 1 : 0, beam_range: 1.8 }, .08);
      builder.components.find((component) => component.id === light)!.color = item.color;
      builder.connect(light, item.support, 'mechanical', 'navigation_light_mount');
      builder.connect(battery, light, 'power', 'navigation_light_bus');
    }
  }
  if (/\b(?:landing lights?|headlights?|forward lights?)\b/.test(text)) {
    for (const [side, support, z] of [['left', leftWing, -.72], ['right', rightWing, .72]] as const) {
      const light = builder.component('light', `${side} forward-facing landing light`, assembly, [1.02, 1.28, z], [.22, .14, .14], 'aluminum', 'fixed', { landing_light: true, headlight: true, vehicle_light: true, light_direction: 'front', facing_axis: '+X', facing_x: 1, beam_range: 7.5 }, .18);
      builder.components.find((component) => component.id === light)!.color = '#f8fbff';
      builder.connect(light, support, 'mechanical', 'landing_light_wing_mount');
      builder.connect(battery, light, 'power', 'landing_light_bus');
    }
  }
  builder.control('aircraft attitude and propulsion', 'pid', [imu], [], 'stabilize pitch and roll, animate the propeller, and preserve pilot control-surface commands', 0);
  return { id: 'fixed-wing-aircraft', mountId: fuselage, editableId: leftWing, handles: ['mobile', 'rotate', 'stabilize', 'measure'], outputId: propeller, driveId: drive };
}

function addHelicopter(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('helicopter assembly', 'Rotorcraft assembled from a cabin, tail boom, powered main rotor, anti-torque tail rotor, skids, controls, battery, and flight sensors', rootAssemblyId);
  const fuselage = builder.component('fuselage', 'helicopter cabin fuselage', assembly, [.25, 1.42, 0], [2.05, 1.1, 1.25], 'aluminum', 'fixed', { helicopter_fuselage: true }, 105);
  const canopy = builder.component('body-shell', 'wraparound cockpit canopy', assembly, [.85, 1.56, 0], [.88, .72, 1.05], 'composite', 'fixed', { cockpit_canopy: true, helicopter_canopy: true }, 10);
  const tailBoom = builder.member('tube', 'tapered tail boom', assembly, [-.45, 1.52, 0], [-2.45, 1.62, 0], .2, 'aluminum', 'fixed', { helicopter_tail_boom: true, round_tube: true });
  builder.connect(canopy, fuselage, 'mechanical', 'cabin_shell'); builder.connect(tailBoom, fuselage, 'mechanical', 'tail_boom_mount');
  const mast = builder.component('shaft', 'main rotor mast', assembly, [.05, 2.2, 0], [.16, .82, .16], 'steel', 'fixed', { helicopter_mast: true }, 8);
  const rotor = builder.component('rotor', 'four-blade main lift rotor', assembly, [.05, 2.64, 0], [5.0, .12, 5.0], 'composite', 'dynamic', { blade_count: 4, rotor_axis: 'vertical', operation_spin: true, main_rotor: true }, 14);
  const mainJoint = builder.joint('revolute', mast, rotor, [0, 1, 0]);
  const mastBody = builder.components.find((item) => item.id === mast)!;
  const rotorBody = builder.components.find((item) => item.id === rotor)!;
  const mainHinge = builder.joints.find((item) => item.id === mainJoint)!;
  mainHinge.anchorA = rotorBody.position.map((value, index) => value - mastBody.position[index]) as Vec3; mainHinge.anchorB = [0, 0, 0]; mainHinge.limits = undefined;
  const mainMotor = builder.component('motor', 'main rotor electric motor', assembly, [.05, 2.03, 0], [.44, .38, .44], 'aluminum', 'fixed', { helicopter_motor: true }, 28);
  const mainDrive = builder.motor(mainMotor, mainJoint, Math.max(260, values.torqueNm * 3.5), 520);
  const tailMotor = builder.component('motor', 'tail rotor motor', assembly, [-2.42, 1.62, 0], [.25, .28, .25], 'aluminum', 'fixed', { helicopter_tail_motor: true }, 5);
  const tailBearing = builder.component('bearing', 'tail rotor outboard support bearing', assembly, [-2.42, 1.62, .125], [.2, .09, .2], 'steel', 'fixed', { helicopter_tail_bearing: true, tail_rotor_axis: 'Z' }, .7);
  // The shaft bridges the visible motor-to-hub gap without penetrating the
  // rotor's compact physics hub (its +Z tip stops just inboard of that hub).
  const tailShaft = builder.component('shaft', 'short tail rotor drive shaft', assembly, [-2.42, 1.62, .19], [.055, .12, .055], 'steel', 'fixed', { helicopter_tail_shaft: true, tail_rotor_axis: 'Z', operation_spin: 8.6 }, .55);
  builder.rotate(tailShaft, [Math.PI / 2, 0, 0]);
  // +X is forward and +Z is the aircraft's right side. Mount the anti-torque
  // rotor outboard of the tail boom, with its shaft on world Z. Keeping its
  // authored rotation at identity also keeps PropulsorBody's XY blade disc in
  // the correct vertical plane instead of turning it into a forward propeller.
  const tailRotor = builder.component('propeller', 'right-side anti-torque tail rotor', assembly, [-2.42, 1.62, .3], [1.02, .1, 1.02], 'composite', 'dynamic', { blade_count: 3, rotor_axis: 'tail', operation_spin: true, tail_rotor: true, tail_rotor_side: 'right' }, 2.1);
  const tailJoint = builder.joint('revolute', tailBearing, tailRotor, [0, 0, 1]);
  builder.joint('fixed', tailMotor, tailBearing);
  builder.joint('fixed', tailMotor, tailShaft);
  const tailBearingBody = builder.components.find((item) => item.id === tailBearing)!;
  const tailRotorBody = builder.components.find((item) => item.id === tailRotor)!;
  const tailHinge = builder.joints.find((item) => item.id === tailJoint)!;
  tailHinge.anchorA = tailRotorBody.position.map((value, index) => value - tailBearingBody.position[index]) as Vec3; tailHinge.anchorB = [0, 0, 0]; tailHinge.limits = undefined;
  builder.motor(tailMotor, tailJoint, 55, 1600);
  builder.connect(mast, fuselage, 'mechanical', 'rotor_transmission_mount'); builder.connect(mainMotor, mast, 'power', 'main_rotor_drive'); builder.connect(tailMotor, tailBoom, 'mechanical', 'tail_motor_mount'); builder.connect(tailMotor, tailBearing, 'mechanical', 'tail_bearing_mount'); builder.connect(tailShaft, tailRotor, 'power', 'tail_rotor_drive');
  for (const side of [-1, 1]) {
    const skid = builder.member('tube', `${side < 0 ? 'left' : 'right'} landing skid`, assembly, [-.78, .5, side * .62], [1.05, .5, side * .62], .08, 'steel', 'fixed', { helicopter_skid: true, grounded_structure: true });
    const frontStrut = builder.member('tube', `${side < 0 ? 'left' : 'right'} front skid strut`, assembly, [.65, .52, side * .62], [.55, 1.08, side * .45], .055, 'steel', 'fixed');
    const rearStrut = builder.member('tube', `${side < 0 ? 'left' : 'right'} rear skid strut`, assembly, [-.48, .52, side * .62], [-.35, 1.02, side * .45], .055, 'steel', 'fixed');
    builder.connect(skid, frontStrut, 'mechanical', 'skid_weld'); builder.connect(frontStrut, fuselage, 'mechanical', 'landing_gear_mount'); builder.connect(rearStrut, fuselage, 'mechanical', 'landing_gear_mount');
  }
  const battery = builder.component('battery', 'rotorcraft battery pack', assembly, [.1, 1.16, 0], [.72, .28, .62], 'polymer', 'fixed', { helicopter_battery: true }, 34);
  const flightComputer = builder.component('controller', 'rotorcraft flight computer', assembly, [-.25, 1.46, .38], [.3, .2, .2], 'polymer', 'fixed', { helicopter_controller: true }, 1.4);
  const imuBody = builder.component('sensor', 'six-axis rotorcraft IMU', assembly, [.05, 1.78, 0], [.16, .12, .14], 'polymer', 'fixed', { helicopter_imu: true }, .1);
  const imu = builder.sensor(imuBody, 'imu', 'rotorcraft_attitude', fuselage, 8);
  builder.connect(battery, flightComputer, 'power', 'flight_bus'); builder.connect(flightComputer, mainMotor, 'signal', 'collective_speed'); builder.connect(flightComputer, tailMotor, 'signal', 'yaw_command');
  builder.control('rotorcraft stabilization', 'pid', [imu], [], 'coordinate main-rotor lift and tail-rotor anti-torque while maintaining level attitude', 0);
  // Every airframe member shares the same hover displacement; only the blade
  // groups spin locally. This prevents skids, tail boom, and rotors from
  // separating during the kinematic preview.
  for (const component of builder.components.filter((item) => item.assemblyId === assembly)) component.parameters = { ...(component.parameters ?? {}), rotorcraft_hover_member: true };
  return { id: 'helicopter', mountId: fuselage, editableId: rotor, handles: ['mobile', 'rotate', 'stabilize', 'measure'], outputId: tailRotor, driveId: mainDrive };
}

function addGeneralRobot(context: ModuleContext): ModuleResult {
  const { builder, rootAssemblyId } = context;
  const assembly = builder.assembly('articulated service robot', 'Human-proportioned humanoid with grounded feet, armored limbs, powered joints, torso, expressive vision head, hands, battery, and controller', rootAssemblyId);
  const leftFoot = builder.component('support', 'left humanoid foot and ankle', assembly, [.08, .13, -.27], [.52, .18, .25], 'composite', 'fixed', { robot_foot: true, grounded_structure: true }, 8);
  const rightFoot = builder.component('support', 'right humanoid foot and ankle', assembly, [.08, .13, .27], [.52, .18, .25], 'composite', 'fixed', { robot_foot: true, grounded_structure: true }, 8);
  const pelvis = builder.component('body-shell', 'humanoid pelvis and waist housing', assembly, [-.02, 1.14, 0], [.62, .4, .58], 'composite', 'fixed', { robot_body: true, robot_pelvis: true }, 12);
  for (const [side, foot] of [[-1, leftFoot], [1, rightFoot]] as const) {
    const ankle: Vec3 = [.02, .28, side * .27];
    const knee: Vec3 = [.03, .7, side * .27];
    const hip: Vec3 = [-.02, 1.14, side * .23];
    const lower = builder.member('linkage', `${side < 0 ? 'left' : 'right'} armored shin`, assembly, ankle, knee, .15, 'aluminum', 'kinematic', { robot_limb: true, robot_leg: true, limb_segment: 'shin' });
    const upper = builder.member('linkage', `${side < 0 ? 'left' : 'right'} armored thigh`, assembly, knee, hip, .17, 'aluminum', 'kinematic', { robot_limb: true, robot_leg: true, limb_segment: 'thigh' });
    builder.jointAt('revolute', foot, lower, ankle, [0, 0, 1], { limits: [-.2, .2] });
    builder.jointAt('revolute', lower, upper, knee, [0, 0, 1], { limits: [-.62, .08] });
    builder.jointAt('revolute', upper, pelvis, hip, [0, 0, 1], { limits: [-.25, .25] });
    const kneePod = builder.component('servo', `${side < 0 ? 'left' : 'right'} knee joint pod`, assembly, knee, [.22, .18, .22], 'steel', 'kinematic', { robot_joint: true, robot_knee: true }, 1.4);
    builder.jointAt('fixed', lower, kneePod, knee);
  }
  const torso = builder.component('body-shell', 'tapered humanoid chest and torso shell', assembly, [0, 1.7, 0], [.78, .82, .66], 'composite', 'fixed', { robot_body: true, robot_torso: true }, 18);
  builder.jointAt('fixed', pelvis, torso, [0, 1.34, 0]);
  const neck = builder.component('shaft', 'humanoid articulated neck', assembly, [.02, 2.16, 0], [.14, .2, .14], 'steel', 'fixed', { robot_neck: true }, 1.1);
  builder.rotate(neck, [0, 0, Math.PI / 2]);
  builder.jointAt('fixed', torso, neck, [.02, 2.1, 0]);
  const head = builder.component('camera', 'expressive humanoid vision head and face', assembly, [.05, 2.38, 0], [.42, .4, .38], 'polymer', 'fixed', { robot_head: true, robot_face: true }, 3);
  builder.jointAt('fixed', neck, head, [.04, 2.25, 0]);
  const vision = builder.sensor(head, 'camera', 'robot_vision', torso, 8);
  const actuators: string[] = [];
  for (const side of [-1, 1]) {
    const shoulderPoint: Vec3 = [0, 1.96, side * .48];
    const elbowPoint: Vec3 = [.04, 1.52, side * .62];
    const wristPoint: Vec3 = [.16, 1.16, side * .66];
    const shoulder = builder.component('servo', `${side < 0 ? 'left' : 'right'} shoulder joint pod`, assembly, shoulderPoint, [.26, .24, .26], 'aluminum', 'fixed', { robot_joint: true, robot_shoulder: true }, 2.6);
    const upper = builder.member('linkage', `${side < 0 ? 'left' : 'right'} armored upper arm`, assembly, shoulderPoint, elbowPoint, .15, 'aluminum', 'kinematic', { robot_limb: true, robot_arm_limb: true, limb_segment: 'upper-arm' });
    const forearm = builder.member('linkage', `${side < 0 ? 'left' : 'right'} armored forearm`, assembly, elbowPoint, wristPoint, .135, 'aluminum', 'kinematic', { robot_limb: true, robot_arm_limb: true, limb_segment: 'forearm' });
    const gripper = builder.component('gripper', `${side < 0 ? 'left' : 'right'} five-finger humanoid hand`, assembly, [.18, 1.05, side * .66], [.28, .25, .2], 'aluminum', 'kinematic', { robot_hand: true }, 1.2);
    const shoulderJoint = builder.jointAt('revolute', torso, upper, shoulderPoint, [1, 0, 0], { limits: [-.32, .42] });
    const elbowJoint = builder.jointAt('revolute', upper, forearm, elbowPoint, [0, 0, 1], { limits: [-.78, 0] });
    builder.jointAt('fixed', forearm, gripper, wristPoint);
    builder.connect(shoulder, torso, 'mechanical', 'shoulder_mount');
    actuators.push(builder.actuator(shoulder, shoulderJoint, 'servo', 420, .72, .74));
    const elbowServo = builder.component('servo', `${side < 0 ? 'left' : 'right'} elbow joint pod`, assembly, elbowPoint, [.22, .2, .22], 'aluminum', 'fixed', { robot_joint: true, robot_elbow: true }, 1.8);
    builder.jointAt('fixed', upper, elbowServo, elbowPoint);
    actuators.push(builder.actuator(elbowServo, elbowJoint, 'servo', 260, .82, .78));
  }
  const battery = builder.component('battery', 'removable humanoid back battery', assembly, [-.36, 1.7, 0], [.2, .5, .4], 'polymer', 'fixed', { robot_battery: true }, 9);
  const controller = builder.component('controller', 'humanoid whole-body motion controller', assembly, [-.3, 1.7, .28], [.18, .24, .14], 'polymer', 'fixed', { robot_controller: true }, 1.2);
  builder.connect(battery, controller, 'power', 'robot_power_bus');
  builder.control('whole-body robot motion', 'synchronized', [vision], actuators, 'coordinate both arms and leg joints while maintaining a stable support polygon and preserving human edits', 0);
  return { id: 'articulated-service-robot', mountId: pelvis, editableId: head, handles: ['manipulate', 'stabilize', 'measure'] };
}

function addSingleTrackVehicle(context: ModuleContext): ModuleResult {
  const { builder, text, rootAssemblyId } = context;
  const electric = /\b(?:electric|e-bike|pedal assist|mid-drive|hub motor|solar(?: powered)?)\b/.test(text);
  const wantsSolar = /\bsolar\b/.test(text);
  const wantsHeadlight = /\b(headlights?|head lamps?|front lights?|bike lights?|front and rear lights?)\b/.test(text);
  const wantsRearLight = /\b(?:(?:brake|rear|tail) lights?|front and rear lights?)\b/.test(text);
  const assembly = builder.assembly(
    'bicycle assembly',
    electric
      ? 'A coherent electric bicycle with a tubular frame, two wheels, steering fork, pedal drivetrain, supported traction system, and requested accessories'
      : 'A coherent human-powered bicycle with a tubular frame, two wheels, steering fork, pedals, chain drive, and only requested accessories',
    rootAssemblyId,
  );
  const rear: Vec3 = [-1.18, .68, 0];
  const front: Vec3 = [1.18, .68, 0];
  const bottomBracket: Vec3 = [-.12, .82, 0];
  const seatCluster: Vec3 = [-.46, 1.54, 0];
  const headLower: Vec3 = [.63, 1.12, 0];
  const headUpper: Vec3 = [.77, 1.56, 0];
  const frameBodies: string[] = [];
  const addTube = (role: string, start: Vec3, end: Vec3, section = .075) => {
    const id = builder.member('beam', role, assembly, start, end, section, 'aluminum', 'fixed', { bicycle_tube: true });
    frameBodies.push(id);
    return id;
  };

  // A recognizable diamond frame is constructed from individual round tubes;
  // no bicycle or vehicle mesh is hidden behind a whole-machine primitive.
  for (const side of [-1, 1]) {
    const z = side * .1;
    addTube(`chain stay ${side < 0 ? 'left' : 'right'}`, [rear[0], rear[1], z], [bottomBracket[0], bottomBracket[1], z], .055);
    addTube(`seat stay ${side < 0 ? 'left' : 'right'}`, [rear[0], rear[1], z], [seatCluster[0], seatCluster[1], z], .055);
    addTube(`down tube ${side < 0 ? 'left' : 'right'}`, [bottomBracket[0], bottomBracket[1], z], [headLower[0], headLower[1], z], .075);
    addTube(`top tube ${side < 0 ? 'left' : 'right'}`, [seatCluster[0], seatCluster[1], z], [headUpper[0], headUpper[1], z], .065);
  }
  addTube('seat tube', bottomBracket, seatCluster, .08);
  const headTube = addTube('steering head tube', headLower, headUpper, .09);

  // The fork is a real nested steering assembly: the steerer pivots inside
  // the fixed head tube around an inclined steering axis, while the front
  // wheel still spins independently around its horizontal axle.
  const steeringCenter: Vec3 = [(headLower[0] + headUpper[0]) / 2, (headLower[1] + headUpper[1]) / 2, 0];
  const steeringAxis: Vec3 = [.303, .953, 0];
  const steerer = builder.component('shaft', 'bicycle fork steerer tube', assembly, steeringCenter, [.105, .55, .105], 'steel', 'dynamic', { bicycle_steerer: true, steering_axis: 'inclined-Y' }, .68);
  builder.rotate(steerer, [0, 0, -.308]);
  builder.jointAt('revolute', headTube, steerer, steeringCenter, steeringAxis, { limits: [-.62, .62] });
  const forkCrown = builder.component('support', 'front fork crown', assembly, [.68, 1.12, 0], [.24, .18, .38], 'aluminum', 'dynamic', { bicycle_fork_crown: true, bicycle_steering_assembly: true }, .72);
  builder.jointAt('fixed', steerer, forkCrown, [.68, 1.18, 0]);
  const forkBlades = [-1, 1].map((side) => {
    const blade = builder.member('tube', `front fork blade ${side < 0 ? 'left' : 'right'}`, assembly, [.67, 1.11, side * .12], [front[0], front[1], side * .12], .06, 'aluminum', 'dynamic', { bicycle_fork_blade: true, bicycle_steering_assembly: true });
    builder.jointAt('fixed', forkCrown, blade, [.67, 1.11, side * .12]);
    return blade;
  });
  const stem = builder.member('tube', 'handlebar stem', assembly, headUpper, [.87, 1.75, 0], .055, 'aluminum', 'dynamic', { bicycle_stem: true, bicycle_steering_assembly: true });
  const handlebar = builder.member('tube', 'handlebar', assembly, [.87, 1.75, -.43], [.87, 1.75, .43], .045, 'aluminum', 'dynamic', { bicycle_handlebar: true, bicycle_steering_assembly: true });
  builder.jointAt('fixed', steerer, stem, headUpper);
  builder.jointAt('fixed', stem, handlebar, [.87, 1.75, 0]);

  const rearDropout = builder.component('plate', 'rear axle dropout', assembly, rear, [.18, .3, .26], 'steel', 'fixed', { bicycle_dropout: true }, .42);
  const frontDropout = builder.component('bearing', 'front steering axle hub support', assembly, front, [.2, .34, .3], 'steel', 'dynamic', { bicycle_dropout: true, bicycle_steering_assembly: true, axle_axis: 'Z' }, .52);
  forkBlades.forEach((blade) => builder.jointAt('fixed', blade, frontDropout, front));
  const bottomShell = builder.component('shaft', 'bottom bracket shell', assembly, bottomBracket, [.16, .3, .16], 'steel', 'fixed', { bicycle_hub: true }, .52);
  frameBodies.forEach((body, index) => builder.connect(index ? frameBodies[index - 1] : rearDropout, body, 'mechanical', 'welded_tube_node'));
  builder.connect(headTube, steerer, 'mechanical', 'steering_head_bearing');
  builder.connect(forkCrown, frontDropout, 'mechanical', 'front_fork_dropout');
  builder.connect(bottomShell, frameBodies.find((id) => builder.components.find((item) => item.id === id)?.role === 'seat tube')!, 'mechanical', 'bottom_bracket_shell');
  builder.connect(stem, handlebar, 'mechanical', 'cockpit_clamp');

  const rearWheel = builder.component('wheel', 'rear bicycle wheel', assembly, rear, [1.36, .12, 1.36], 'rubber', 'dynamic', { bicycle_wheel: true, friction: 1.05 }, 2.9);
  const frontWheel = builder.component('wheel', 'front bicycle wheel', assembly, front, [1.36, .12, 1.36], 'rubber', 'dynamic', { bicycle_wheel: true, friction: 1.05 }, 2.6);
  const centeredRevolute = (supportId: string, rotaryId: string) => {
    const support = builder.components.find((item) => item.id === supportId)!;
    const rotary = builder.components.find((item) => item.id === rotaryId)!;
    const id = builder.joint('revolute', supportId, rotaryId, [0, 0, 1]);
    const joint = builder.joints.find((item) => item.id === id)!;
    joint.anchorA = rotary.position.map((value, index) => value - support.position[index]) as Vec3;
    joint.anchorB = [0, 0, 0];
    joint.limits = undefined;
    return id;
  };
  const rearAxleJoint = centeredRevolute(rearDropout, rearWheel);
  const frontAxleJoint = centeredRevolute(frontDropout, frontWheel);

  const seatPost = addTube('seat post', seatCluster, [-.52, 1.72, 0], .05);
  const seat = builder.component('plate', 'rider saddle', assembly, [-.58, 1.78, 0], [.48, .11, .26], 'polymer', 'fixed', { bicycle_seat: true }, .48);
  builder.connect(seatPost, frameBodies.find((id) => builder.components.find((item) => item.id === id)?.role === 'seat tube')!, 'mechanical', 'seat_post_clamp');
  builder.connect(seatPost, seat, 'mechanical', 'saddle_clamp');

  const crank = builder.component('gear', 'pedal crank sprocket', assembly, bottomBracket, [.4, .075, .4], 'steel', 'dynamic', { teeth: 42, mesh_efficiency: .94, bicycle_sprocket: true, human_power_input: !electric }, .72);
  const crankJoint = centeredRevolute(bottomShell, crank);
  for (const side of [-1, 1]) {
    const pedal = builder.component('pedal', `${side < 0 ? 'left' : 'right'} bicycle pedal`, assembly, [bottomBracket[0], bottomBracket[1], side * .25], [.34, .055, .1], 'aluminum', 'dynamic', { bicycle_pedal: true, pedal_side: side < 0 ? 'left' : 'right' }, .24);
    builder.jointAt('fixed', crank, pedal, [bottomBracket[0], bottomBracket[1], side * .2]);
    builder.connect(pedal, crank, 'mechanical', 'pedal_crank_arm');
  }
  const chainCenter: Vec3 = [(rear[0] + bottomBracket[0]) / 2, (rear[1] + bottomBracket[1]) / 2, .12];
  const chain = builder.component('belt', 'bicycle drive chain', assembly, chainCenter, [Math.abs(bottomBracket[0] - rear[0]) + .4, .035, .22], 'steel', 'kinematic', { bicycle_chain: true }, .55);
  builder.joint('belt', crank, rearWheel, [0, 0, 1], { ratio: 2.65 });
  builder.connect(chain, crank, 'mechanical', 'chainring_engagement');
  builder.connect(chain, rearWheel, 'mechanical', 'rear_sprocket_engagement');

  // Dual mechanical disc brakes remain visually separate from the tire and
  // are controlled from hand levers through explicit cables. The brake
  // actuators damp the same axle revolute joints used by the physics run.
  const frontRotor = builder.component('gear', 'front bicycle disc brake rotor', assembly, [front[0], front[1], -.11], [.44, .025, .44], 'steel', 'dynamic', { teeth: 30, bicycle_brake_rotor: true, axle_axis: 'Z' }, .28);
  const rearRotor = builder.component('gear', 'rear bicycle disc brake rotor', assembly, [rear[0], rear[1], -.11], [.4, .025, .4], 'steel', 'dynamic', { teeth: 28, bicycle_brake_rotor: true, axle_axis: 'Z' }, .25);
  builder.jointAt('fixed', frontWheel, frontRotor, front);
  builder.jointAt('fixed', rearWheel, rearRotor, rear);
  const frontCaliper = builder.component('servo', 'front bicycle brake caliper', assembly, [1.02, .88, -.16], [.2, .28, .16], 'aluminum', 'dynamic', { bicycle_brake_caliper: true, brake_axle: 'front' }, .48);
  const rearCaliper = builder.component('servo', 'rear bicycle brake caliper', assembly, [-1.01, .86, -.16], [.2, .28, .16], 'aluminum', 'fixed', { bicycle_brake_caliper: true, brake_axle: 'rear' }, .5);
  builder.jointAt('fixed', frontDropout, frontCaliper, [1.02, .86, -.14]);
  builder.connect(rearDropout, rearCaliper, 'mechanical', 'rear_caliper_mount');
  const frontBrakeActuator = builder.actuator(frontCaliper, frontAxleJoint, 'brake', 1250, 8, .012);
  const rearBrakeActuator = builder.actuator(rearCaliper, rearAxleJoint, 'brake', 1150, 8, .012);
  const leftLever = builder.component('linkage', 'left front-brake hand lever', assembly, [.84, 1.71, -.34], [.24, .035, .08], 'aluminum', 'dynamic', { bicycle_brake_lever: true, brake_axle: 'front' }, .09);
  const rightLever = builder.component('linkage', 'right rear-brake hand lever', assembly, [.84, 1.71, .34], [.24, .035, .08], 'aluminum', 'dynamic', { bicycle_brake_lever: true, brake_axle: 'rear' }, .09);
  builder.jointAt('revolute', handlebar, leftLever, [.87, 1.75, -.34], [0, 0, 1], { limits: [-.3, .05] });
  builder.jointAt('revolute', handlebar, rightLever, [.87, 1.75, .34], [0, 0, 1], { limits: [-.3, .05] });
  const frontCable = builder.member('cable', 'front brake control cable', assembly, [.84, 1.71, -.34], [1.02, .88, -.16], .025, 'steel', 'kinematic', { bicycle_brake_cable: true, brake_axle: 'front' });
  const rearCable = builder.member('cable', 'rear brake control cable', assembly, [.84, 1.71, .34], [-1.01, .86, -.16], .025, 'steel', 'kinematic', { bicycle_brake_cable: true, brake_axle: 'rear' });
  builder.connect(leftLever, frontCable, 'mechanical', 'front_brake_cable_pull');
  builder.connect(frontCable, frontCaliper, 'mechanical', 'front_caliper_command');
  builder.connect(rightLever, rearCable, 'mechanical', 'rear_brake_cable_pull');
  builder.connect(rearCable, rearCaliper, 'mechanical', 'rear_caliper_command');
  const brakeSensor = builder.sensor(rightLever, 'force', 'brake_lever_force', rightLever, 1);
  builder.control('bicycle service brake', 'threshold', [brakeSensor], [frontBrakeActuator, rearBrakeActuator], 'clamp both disc rotors when either hand lever is pulled and release below threshold', 18);

  const speedSensorBody = builder.component('sensor', 'wheel speed pickup', assembly, [1.04, .88, .13], [.12, .12, .1], 'polymer', 'dynamic', { bicycle_sensor: true }, .08);
  const speedSensor = builder.sensor(speedSensorBody, 'speed', 'wheel_speed', frontWheel, 3);
  builder.connect(speedSensorBody, forkCrown, 'mechanical', 'sensor_bracket');
  builder.jointAt('fixed', forkCrown, speedSensorBody, [1.04, .88, .13]);
  let driveMotor: string | undefined;
  let powerSource: string | undefined;
  if (electric) {
    driveMotor = builder.component('motor', 'mid-drive electric motor', assembly, [-.06, .87, .16], [.36, .18, .36], 'aluminum', 'kinematic', { bicycle_hub_motor: true }, 3.8);
    builder.motor(driveMotor, crankJoint, 150, 145);
    builder.connect(driveMotor, bottomShell, 'mechanical', 'motor_mount');
    builder.connect(driveMotor, crank, 'power', 'pedal_assist_torque');
    powerSource = builder.component('battery', 'removable traction battery', assembly, [.17, 1.16, 0], [.62, .24, .18], 'polymer', 'fixed', { bicycle_battery: true }, 4.6);
    builder.rotate(powerSource, [0, 0, .5]);
    const controller = builder.component('controller', 'electric drive controller', assembly, [-.65, 1.23, 0], [.34, .18, .16], 'polymer', 'fixed', { bicycle_controller: true }, .38);
    builder.control('electric pedal assist', 'pid', [speedSensor], [], 'blend rider cadence and motor torque while limiting wheel speed', 25);
    builder.connect(powerSource, controller, 'power', 'dc_bus');
    builder.connect(controller, driveMotor, 'signal', 'motor_command');
    builder.connect(speedSensorBody, controller, 'signal', 'wheel_speed_feedback');
    builder.connect(powerSource, frameBodies[0], 'mechanical', 'battery_mount');
    builder.connect(controller, frameBodies[0], 'mechanical', 'controller_mount');
  } else {
    // Rider torque is an explicit physical drive on the crank joint. This is
    // not an electric system or an added machine component; it represents the
    // human input needed to run the multi-body bicycle simulation.
    builder.motor(crank, crankJoint, 55, 70, -1);
    builder.control('bicycle cadence monitor', 'threshold', [speedSensor], [], 'measure wheel speed while preserving direct human pedal and steering input', 25);
  }

  if (!powerSource && (wantsHeadlight || wantsRearLight)) {
    powerSource = builder.component('battery', 'compact bicycle lighting battery', assembly, [-.62, 1.57, 0], [.22, .14, .12], 'polymer', 'fixed', { bicycle_lighting_battery: true }, .32);
    builder.connect(powerSource, seatPost, 'mechanical', 'lighting_battery_bracket');
  }

  if (wantsSolar) {
    const rackLeft = addTube('solar rack left stay', [rear[0], rear[1] + .12, -.22], [-1.02, 1.55, -.22], .04);
    const rackRight = addTube('solar rack right stay', [rear[0], rear[1] + .12, .22], [-1.02, 1.55, .22], .04);
    const panel = builder.component('plate', 'fixed solar charging panel', assembly, [-1.13, 1.62, 0], [1.2, .065, .58], 'composite', 'fixed', { panel: true, bicycle_solar_panel: true }, 2.3);
    builder.rotate(panel, [0, 0, -.08]);
    builder.connect(rearDropout, rackLeft, 'mechanical', 'solar_rack_stay');
    builder.connect(rearDropout, rackRight, 'mechanical', 'solar_rack_stay');
    builder.connect(rackLeft, panel, 'mechanical', 'solar_rack_mount');
    builder.connect(rackRight, panel, 'mechanical', 'solar_rack_mount');
    if (powerSource) builder.connect(panel, powerSource, 'power', 'solar_charge_bus');
  }

  if (wantsHeadlight) {
    const headlight = builder.component('light', 'front LED bicycle headlight', assembly, [.98, 1.51, 0], [.3, .22, .22], 'aluminum', 'fixed', { headlight: true, vehicle_light: true, light_direction: 'front', facing_x: 1, facing_axis: '+X', beam_range: 5 }, .24);
    builder.connect(headlight, stem, 'mechanical', 'headlight_bracket');
    if (powerSource) builder.connect(powerSource, headlight, 'power', 'lighting_bus');
  }

  if (wantsRearLight) {
    const brakeLight = builder.component('light', 'rear LED bicycle brake light', assembly, [-.74, 1.7, 0], [.22, .15, .16], 'polymer', 'fixed', { brake_light: true, vehicle_light: true, light_direction: 'rear', facing_x: -1, facing_axis: '-X', beam_range: 2.1 }, .16);
    builder.components.find((item) => item.id === brakeLight)!.color = '#ff313d';
    builder.connect(brakeLight, seatPost, 'mechanical', 'seat_post_light_bracket');
    if (powerSource) builder.connect(powerSource, brakeLight, 'power', 'brake_light_bus');
  }

  return { id: 'single-track-vehicle', mountId: frameBodies[0], editableId: speedSensorBody, handles: ['structure', 'mobile', 'measure', 'rotate'], driveId: driveMotor, outputId: rearWheel };
}

function addPlanetaryDifferential(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('planetary differential gearset', 'Open cutaway differential with coaxial sun and ring outputs, three orbiting planets, a driven carrier, and explicit input/output shafts', rootAssemblyId);
  const base = builder.component('frame', 'compact differential bench housing', assembly, [0, .16, 0], [3.4, .26, 2.8], 'aluminum', 'fixed', { planetary_housing: true }, 18);
  const bearingSupport = builder.component('support', 'coaxial differential bearing pedestal', assembly, [0, .8, -.34], [.58, 1.34, .58], 'steel', 'fixed', { planetary_bearing: true }, 9);
  const housingRing = builder.component('frame', 'open differential housing ring', assembly, [0, 1.55, -.12], [2.35, 2.35, .2], 'aluminum', 'fixed', { cad_form: 'rotor_shroud', planetary_housing_ring: true }, 12);
  builder.connect(base, bearingSupport, 'mechanical', 'bearing_pedestal_mount');
  builder.connect(base, housingRing, 'mechanical', 'housing_ring_mount');

  const carrier = builder.component('frame', 'three-pin planet carrier', assembly, [0, 1.55, -.16], [.82, .82, .12], 'steel', 'dynamic', { cad_form: 'rotor_shroud', planetary_carrier: true }, 5.5);
  const carrierJoint = builder.joint('revolute', bearingSupport, carrier, [0, 0, 1], { anchorA: [0, .75, .18], anchorB: [0, 0, 0] });
  const sun = builder.component('gear', 'central sun output gear', assembly, [0, 1.55, .05], [.48, .15, .48], 'steel', 'dynamic', { teeth: 18, planetary_sun: true, mesh_efficiency: .93 }, 2.1);
  builder.joint('revolute', bearingSupport, sun, [0, 0, 1], { anchorA: [0, .75, .39], anchorB: [0, 0, 0] });
  const ring = builder.component('gear', 'internal ring output gear', assembly, [0, 1.55, .05], [1.82, 1.82, .2], 'steel', 'dynamic', { cad_form: 'rotor_shroud', teeth: 54, planetary_ring: true, internal_teeth: true, mesh_efficiency: .93 }, 7.8);
  builder.joint('revolute', bearingSupport, ring, [0, 0, 1], { anchorA: [0, .75, .39], anchorB: [0, 0, 0] });

  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2;
    const x = Math.cos(angle) * .47;
    const y = 1.55 + Math.sin(angle) * .47;
    const orbit = { planetary_orbit_radius: .47, planetary_center_x: 0, planetary_center_y: 1.55, planetary_orbit_angle: angle };
    const pad = builder.component('plate', `carrier planet pad ${index + 1}`, assembly, [x, y, -.18], [.3, .3, .06], 'steel', 'dynamic', { planetary_carrier_pad: true, planet_index: index + 1, ...orbit }, .45);
    const planet = builder.component('gear', `planet gear ${index + 1}`, assembly, [x, y, .05], [.38, .13, .38], 'steel', 'dynamic', { teeth: 18, planetary_planet: true, planet_index: index + 1, mesh_efficiency: .93, ...orbit }, 1.1);
    builder.joint('fixed', carrier, pad);
    builder.joint('fixed', pad, planet);
  }
  const differentialStageRatio = Math.sqrt(Math.max(1, values.ratio));
  builder.joint('gear', carrier, sun, [0, 0, 1], { ratio: differentialStageRatio });
  builder.joint('belt', carrier, ring, [0, 0, 1], { ratio: differentialStageRatio });

  const inputShaft = builder.component('shaft', 'carrier input shaft', assembly, [0, 1.55, -1.25], [.16, .9, .16], 'steel', 'kinematic', { planetary_input_shaft: true, operation_spin: 2.7 }, 2.4);
  const leftOutput = builder.component('shaft', 'left sun-gear output shaft', assembly, [0, 1.55, .72], [.2, 1.05, .2], 'steel', 'kinematic', { planetary_output_shaft: true, output_side: 'left', operation_spin: -1.8 }, 2.8);
  const rightOutput = builder.component('shaft', 'right ring-gear output shaft', assembly, [0, 1.55, -.68], [.28, .66, .28], 'steel', 'kinematic', { planetary_output_shaft: true, output_side: 'right', operation_spin: 1.8 }, 3.2);
  [inputShaft, leftOutput, rightOutput].forEach((id) => builder.rotate(id, [Math.PI / 2, 0, 0]));
  builder.connect(inputShaft, carrier, 'mechanical', 'input_to_carrier_coupling');
  builder.connect(sun, leftOutput, 'mechanical', 'sun_to_left_output_coupling');
  builder.connect(ring, rightOutput, 'mechanical', 'ring_to_right_output_coupling');

  const motor = builder.component('motor', 'differential input drive motor', assembly, [0, 1.55, -1.82], [.5, .62, .5], 'steel', 'kinematic', { planetary_drive: true }, 8.5);
  builder.rotate(motor, [Math.PI / 2, 0, 0]);
  builder.motor(motor, carrierJoint, Math.max(28, values.torqueNm), Math.max(90, values.rpm));
  const carrierActuator = builder.actuator(motor, carrierJoint, 'rotary-motor', Math.max(28, values.torqueNm), Math.max(90, values.rpm) * Math.PI / 30, Math.PI * 2);
  builder.connect(base, motor, 'mechanical', 'motor_mount');
  builder.connect(motor, inputShaft, 'power', 'carrier_input_torque');
  const leftEncoder = builder.component('sensor', 'left output speed encoder', assembly, [-.45, 1.92, .42], [.2, .18, .2], 'polymer', 'fixed', { planetary_encoder: true, output_side: 'left' }, .25);
  const rightEncoder = builder.component('sensor', 'right output speed encoder', assembly, [.45, 1.92, -.38], [.2, .18, .2], 'polymer', 'fixed', { planetary_encoder: true, output_side: 'right' }, .25);
  const leftSensor = builder.sensor(leftEncoder, 'speed', 'left_output_rpm', sun, 2);
  const rightSensor = builder.sensor(rightEncoder, 'speed', 'right_output_rpm', ring, 2);
  builder.connect(housingRing, leftEncoder, 'mechanical', 'left_encoder_mount');
  builder.connect(housingRing, rightEncoder, 'mechanical', 'right_encoder_mount');
  builder.control('differential speed split', 'synchronized', [leftSensor, rightSensor], [carrierActuator], 'regulate carrier input while observing how the planetary set distributes speed to both outputs', values.rpm / Math.max(1, values.ratio));
  return { id: 'planetary-differential', mountId: base, editableId: leftEncoder, handles: ['structure', 'transmit', 'rotate', 'measure'], inputId: inputShaft, outputId: leftOutput, driveId: motor };
}

function addRotaryTransmission(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const scale = .125;
  const scaled = (value: Vec3) => value.map((dimension) => dimension * scale) as Vec3;
  const assembly = builder.assembly('enclosed reduction gearbox', 'Supported input and output shafts, meshing gears, bearings, motor, and removable safety housing', rootAssemblyId);
  const base = builder.component('frame', 'open gearbox housing', assembly, scaled([0, .45, 0]), scaled([3.6, .32, 2.2]), 'aluminum', 'fixed', { gearbox_housing: true });
  const backPlate = builder.component('plate', 'gearbox rear housing plate', assembly, scaled([0, 1.45, -.72]), scaled([3.35, 2.15, .16]), 'aluminum', 'fixed', { gearbox_backplate: true });
  builder.joint('fixed', base, backPlate);
  for (const x of [-.85, .85]) {
    const bearing = builder.component('support', `${x < 0 ? 'input' : 'output'} shaft bearing block`, assembly, scaled([x, 1.45, .56]), scaled([.62, .72, .28]), 'steel', 'fixed', { gearbox_bearing: true });
    builder.joint('fixed', backPlate, bearing);
  }
  const inputShaft = builder.component('shaft', 'input shaft', assembly, scaled([-.85, 1.45, 0]), scaled([.16, 1.5, .16]), 'steel', 'dynamic', { rpm: values.rpm, operation_spin: 2.25 });
  const outputShaft = builder.component('shaft', 'output shaft', assembly, scaled([.85, 1.45, 0]), scaled([.22, 1.5, .22]), 'steel', 'dynamic', { operation_spin: -2.25 / Math.max(1, values.ratio) });
  builder.rotate(inputShaft, [Math.PI / 2, 0, 0]); builder.rotate(outputShaft, [Math.PI / 2, 0, 0]);
  const inputRadius = .32 * scale;
  const outputRadius = Math.min(1.45 * scale, inputRadius * values.ratio);
  const inputGear = builder.component('gear', 'input gear', assembly, scaled([-.85, 1.45, 0]), [inputRadius * 2, .18 * scale, inputRadius * 2], 'steel', 'dynamic', { teeth: 18, pitch_radius: inputRadius, mesh_efficiency: .85 });
  const outputGear = builder.component('gear', 'output gear', assembly, scaled([.85, 1.45, 0]), [outputRadius * 2, .22 * scale, outputRadius * 2], 'steel', 'dynamic', { teeth: Math.round(18 * values.ratio), pitch_radius: outputRadius, mesh_efficiency: .85 });
  const inputJoint = builder.jointAt('revolute', base, inputShaft, scaled([-.85, 1.45, 0]), [0, 0, 1]);
  builder.joint('fixed', inputShaft, inputGear);
  builder.jointAt('revolute', base, outputShaft, scaled([.85, 1.45, 0]), [0, 0, 1]);
  builder.joint('fixed', outputShaft, outputGear);
  builder.joint('gear', inputGear, outputGear, [0, 0, 1], { ratio: values.ratio });
  const motor = builder.component('motor', 'input drive motor', assembly, scaled([-.85, 1.45, -1.02]), scaled([.46, .64, .46]), 'steel', 'kinematic');
  builder.rotate(motor, [Math.PI / 2, 0, 0]);
  builder.motor(motor, inputJoint, Math.max(15, values.torqueNm / values.ratio * .72), values.rpm);
  builder.connect(motor, inputShaft, 'power', 'input_torque');
  const inputEncoder = builder.component('sensor', 'input shaft encoder', assembly, scaled([-.85, 1.78, .42]), scaled([.28, .24, .28]), 'polymer', 'fixed');
  const outputEncoder = builder.component('sensor', 'output shaft encoder', assembly, scaled([.85, 1.78, .42]), scaled([.28, .24, .28]), 'polymer', 'fixed');
  const inputSensor = builder.sensor(inputEncoder, 'speed', 'input_rpm', inputShaft, 2);
  const outputSensor = builder.sensor(outputEncoder, 'speed', 'output_rpm', outputShaft, 2);
  builder.control('speed governor', 'pid', [inputSensor, outputSensor], [], 'hold the measured output speed at the measured input speed divided by the gear ratio', values.rpm / values.ratio);
  builder.joint('fixed', inputEncoder, base);
  builder.joint('fixed', outputEncoder, base);
  return { id: 'rotary-transmission', mountId: base, editableId: outputEncoder, handles: ['transmit', 'rotate'], inputId: inputShaft, outputId: outputShaft };
}

function addSerialLinkage(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('serial linkage', 'Industrial robot base, shoulder and elbow housings, tapered structural arm links, wrist, vision sensor, and parallel end effector', rootAssemblyId);
  const base = builder.component('plate', 'industrial robot anchored base', assembly, [0, .16, 0], [1.55, .25, 1.45], 'steel', 'fixed', { industrial_base: true, robot_arm_base: true });
  const pedestal = builder.component('support', 'industrial robot rotating pedestal', assembly, [0, .88, 0], [.64, 1.28, .64], 'steel', 'dynamic', { joint_housing: true, robot_arm_pedestal: true });
  builder.jointAt('revolute', base, pedestal, [0, .28, 0], [0, 1, 0], { limits: [-1.2, 1.2] });
  let parent = pedestal;
  const linkLength = values.reachM / 3;
  const actuators: string[] = [];
  let jointPoint: Vec3 = [0, 1.48, 0];
  const linkAngles = [58, 20, -28].map((angle) => angle * Math.PI / 180);
  const linkLimits: [number, number][] = [[-.34, .42], [-.62, .18], [-.38, .42]];
  for (let index = 0; index < 3; index += 1) {
    const angle = linkAngles[index];
    const nextPoint: Vec3 = [jointPoint[0] + Math.cos(angle) * linkLength, jointPoint[1] + Math.sin(angle) * linkLength, 0];
    const link = builder.member('beam', `industrial robot arm link ${index + 1}`, assembly, jointPoint, nextPoint, .28 - index * .035, 'aluminum', 'dynamic', { link_length: linkLength, hollow_section: true, robot_arm_link: true, robot_arm_link_index: index + 1 });
    const joint = builder.jointAt('revolute', parent, link, jointPoint, [0, 0, 1], { limits: linkLimits[index] });
    const servo = builder.component('servo', `industrial robot joint ${index + 1}`, assembly, [jointPoint[0], jointPoint[1], 0], [.46 - index * .045, .34, .46 - index * .045], 'steel', 'fixed', { joint_housing: true, robot_arm_joint: true, robot_arm_joint_index: index + 1 });
    builder.rotate(servo, [Math.PI / 2, 0, 0]);
    builder.jointAt('fixed', parent, servo, jointPoint);
    actuators.push(builder.actuator(servo, joint, 'servo', Math.max(110, values.payloadKg * 9.81 * values.reachM * .62), .72 + index * .08, linkLimits[index][1] - linkLimits[index][0]));
    builder.connect(servo, link, 'power', 'joint_drive');
    parent = link; jointPoint = nextPoint;
  }
  const gripper = builder.component('gripper', 'industrial robot parallel gripper', assembly, [jointPoint[0] + .24, jointPoint[1], 0], [.58, .32, .72], 'steel', 'kinematic', { payload_kg: values.payloadKg, robot_arm_gripper: true });
  builder.jointAt('fixed', parent, gripper, jointPoint);
  const camera = builder.component('camera', 'industrial robot wrist camera', assembly, [jointPoint[0] + .08, jointPoint[1] + .24, 0], [.24, .18, .24], 'polymer', 'kinematic', { robot_arm_camera: true });
  builder.jointAt('fixed', gripper, camera, [jointPoint[0] + .08, jointPoint[1] + .16, 0]);
  const vision = builder.sensor(camera, 'camera', 'target_pose', gripper, 4);
  builder.control('cartesian placement', 'pid', [vision], actuators, 'solve link setpoints from target pose and payload', values.placementCm / 100);
  builder.connect(camera, gripper, 'signal', 'target_pose');
  return { id: 'serial-linkage', mountId: base, editableId: camera, handles: ['manipulate', 'rotate'], driveId: actuators[0], outputId: gripper };
}

function addCableSuspension(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('cable suspension', 'Support frame, pulley path, winch, hook, payload, and balance mass', rootAssemblyId);
  const baseWidth = Math.max(4.2, 3.6 + values.payloadKg / 220);
  const base = builder.component('frame', 'crane carrier base', assembly, [-.45, .18, 0], [baseWidth, .34, 2.85], 'steel', 'fixed', { industrial_base: true });
  const mast = builder.component('beam', 'lattice crane mast', assembly, [-1.35, 2.35, 0], [.42, 4.35, .42], 'steel', 'fixed');
  const boomLength = Math.max(3.7, Math.min(5.8, values.liftM + 3.1));
  const boomStart: Vec3 = [-1.35, 4.18, 0];
  const boomEnd: Vec3 = [boomStart[0] + boomLength * .92, boomStart[1] + boomLength * .28, 0];
  const boom = builder.member('beam', 'angled lifting boom', assembly, boomStart, boomEnd, .34, 'steel', 'fixed', { hollow_section: true });
  builder.joint('fixed', base, mast); builder.joint('fixed', mast, boom);
  const rearStay = builder.member('beam', 'rear mast brace', assembly, [-2.05, .38, 0], [-1.35, 3.65, 0], .22, 'steel', 'fixed');
  builder.joint('fixed', base, rearStay);
  for (const side of [-1, 1]) {
    const outrigger = builder.component('beam', `${side < 0 ? 'left' : 'right'} stabilizing outrigger`, assembly, [-.8, .34, side * 1.65], [2.4, .2, .2], 'steel', 'fixed', { outrigger: true });
    builder.rotate(outrigger, [0, Math.PI / 2, 0]);
    builder.joint('fixed', base, outrigger);
  }
  const pulley = builder.component('pulley', 'boom head pulley', assembly, boomEnd, [.7, .22, .7], 'steel', 'dynamic');
  builder.rotate(pulley, [Math.PI / 2, 0, 0]);
  const pulleyJoint = builder.jointAt('revolute', boom, pulley, boomEnd, [0, 0, 1]);
  // Reserve real headroom above the lifted load. Without this margin a full
  // requested stroke can pull the beam through the boom or head sheave.
  const hookY = Math.max(.95, boomEnd[1] - Math.max(2.1, values.liftM + 1.15));
  const cable = builder.member('cable', 'load cable', assembly, boomEnd, [boomEnd[0], hookY + .28, 0], .035, 'steel', 'kinematic', { rigging: true, reduced_order_cable: true, winch_travel_m: values.liftM });
  const hook = builder.component('hook', 'forged load hook', assembly, [boomEnd[0], hookY, 0], [.24, .42, .1], 'steel', 'kinematic', { winch_hook: true, winch_travel_m: values.liftM });
  // Anchor the tension limit to the fixed boom. The visible sheave remains a
  // separately driven rotor while the winch command changes hook elevation.
  const ropeJoint = builder.joint('rope', boom, hook, [0, 1, 0], { limits: [0, Math.max(1.5, values.liftM + 1.2)], anchorA: [boomLength * .46, boomLength * .14, 0], anchorB: [0, .21, 0] });
  builder.connect(boom, cable, 'mechanical', 'cable_head_support');
  builder.connect(cable, hook, 'mechanical', 'cable_termination');
  const payload = builder.component('beam', 'suspended beam payload', assembly, [boomEnd[0], hookY - .55, 0], [2.2, .34, .46], 'steel', 'kinematic', { payload_kg: values.payloadKg, rigged_load: true, winch_travel_m: values.liftM }, values.payloadKg);
  builder.joint('fixed', hook, payload);
  const counterMass = Math.max(70, values.payloadKg * .62);
  const counterweight = builder.component('counterweight', 'rear balance counterweight', assembly, [-2.35, .82, 0], [1.2, 1.05, 1.25], 'concrete', 'dynamic', { payload_kg: counterMass, safety_stripes: true }, counterMass);
  builder.joint('fixed', base, counterweight);
  const motor = builder.component('motor', 'boom winch motor', assembly, [-1.35, 1.05, -.72], [.72, .58, .62], 'steel', 'kinematic', { crane_winch: true });
  const actuator = builder.actuator(motor, ropeJoint, 'winch', Math.max(900, values.payloadKg * 9.81 * .72), .8, values.liftM);
  builder.motor(motor, pulleyJoint, Math.max(105, values.payloadKg * 4.4), 42);
  const loadSensor = builder.component('sensor', 'load and swing sensor', assembly, [-1.55, 4.45, 0], [.23, .18, .23], 'polymer', 'fixed');
  const sensor = builder.sensor(loadSensor, 'load', 'suspended_load', hook, boomLength);
  const controller = builder.component('controller', 'crane control cabinet', assembly, [-.55, .72, -1.02], [.72, 1.05, .4], 'steel', 'fixed');
  builder.control('suspension stability', 'pid', [sensor], [actuator], 'limit swing while following lift height', values.liftM);
  builder.joint('fixed', controller, base); builder.joint('fixed', loadSensor, boom);
  return { id: 'cable-suspension', mountId: base, editableId: loadSensor, handles: ['lift', 'suspend', 'stabilize'], driveId: motor, outputId: hook };
}

function addHydraulicPress(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly(
    'hydraulic press frame',
    'Rigid H-frame, work bed, moving platen, hydraulic ram, matched tooling, pressure sensing, and guarded power unit',
    rootAssemblyId,
  );
  const base = builder.component('frame', 'hydraulic press base', assembly, [0, .18, 0], [3.8, .32, 2.35], 'steel', 'fixed', { press_base: true, safety_stripes: true }, 210);
  const leftColumn = builder.component('beam', 'left press column', assembly, [-1.42, 2.12, 0], [.4, 3.85, .5], 'steel', 'fixed', { press_column: true }, 145);
  const rightColumn = builder.component('beam', 'right press column', assembly, [1.42, 2.12, 0], [.4, 3.85, .5], 'steel', 'fixed', { press_column: true }, 145);
  const crown = builder.component('beam', 'reinforced press crown', assembly, [0, 4.02, 0], [3.35, .5, 1.5], 'steel', 'fixed', { press_crown: true }, 190);
  const bed = builder.component('beam', 'adjustable press bed', assembly, [0, 1.18, 0], [2.75, .38, 1.52], 'steel', 'fixed', { press_bed: true }, 165);
  builder.joint('fixed', base, leftColumn);
  builder.joint('fixed', base, rightColumn);
  builder.joint('fixed', leftColumn, crown);
  builder.joint('fixed', rightColumn, crown);
  builder.joint('fixed', base, bed);

  const platen = builder.component('plate', 'moving press platen', assembly, [0, 2.78, 0], [2.48, .3, 1.34], 'steel', 'kinematic', { press_platen: true, operation_travel: values.strokeM }, 115);
  const pressJoint = builder.joint('prismatic', crown, platen, [0, -1, 0], { limits: [0, values.strokeM] });
  const cylinderBarrel = builder.component('piston', 'hydraulic cylinder barrel', assembly, [0, 3.62, 0], [.68, 1.08, .68], 'steel', 'fixed', { hydraulic_barrel: true, rated_force_n: values.forceN }, 72);
  builder.joint('fixed', crown, cylinderBarrel);
  const ram = builder.component('piston', 'hydraulic press ram', assembly, [0, 3.25, 0], [.3, 1.02, .3], 'steel', 'dynamic', { hydraulic_ram: true, stroke_m: values.strokeM, operation_travel: values.strokeM }, 34);
  builder.joint('fixed', platen, ram);

  const lowerDie = builder.component('plate', 'lower press tooling plate', assembly, [0, 1.43, 0], [1.55, .16, 1.02], 'steel', 'fixed', { press_tooling: 'lower' }, 42);
  const workpieceY = 1.62;
  const workpieceHeight = .2;
  const upperDieHeight = .16;
  // Author the open tooling with a visible but reachable clearance. The upper
  // die's lower face must cross the workpiece's upper face during the requested
  // stroke; otherwise the animation would be a press that never presses.
  const toolingClearance = Math.min(.04, Math.max(.01, values.strokeM * .1));
  const upperDieY = workpieceY + workpieceHeight / 2 + toolingClearance + upperDieHeight / 2;
  const upperDie = builder.component('plate', 'upper press tooling plate', assembly, [0, upperDieY, 0], [1.55, upperDieHeight, 1.02], 'steel', 'dynamic', { press_tooling: 'upper', tooling_clearance_m: toolingClearance, operation_travel: values.strokeM }, 42);
  const workpiece = builder.component('plate', 'workpiece between press dies', assembly, [0, workpieceY, 0], [1.12, workpieceHeight, .76], 'aluminum', 'fixed', { press_workpiece: true }, 8);
  builder.joint('fixed', bed, lowerDie);
  builder.joint('fixed', platen, upperDie);
  builder.joint('fixed', lowerDie, workpiece);

  const loadCell = builder.component('sensor', 'platen force and position transducer', assembly, [.82, 2.78, 0], [.25, .2, .25], 'steel', 'dynamic', { press_load_cell: true, operation_travel: values.strokeM }, 1.4);
  builder.joint('fixed', platen, loadCell);
  const forceSensor = builder.sensor(loadCell, 'force', 'pressing_force', upperDie, Math.max(1, values.strokeM + .5));
  const powerUnit = builder.component('motor', 'hydraulic pump power unit', assembly, [-1.05, .7, -.72], [.7, .65, .62], 'steel', 'fixed', { hydraulic_power_unit: true }, 45);
  const controller = builder.component('controller', 'two-hand press safety controller', assembly, [1.05, .72, -.78], [.65, .62, .38], 'steel', 'fixed', { guarded_press_control: true }, 4.5);
  builder.joint('fixed', base, powerUnit);
  builder.joint('fixed', base, controller);
  const actuator = builder.actuator(ram, pressJoint, 'piston', Math.max(20000, values.forceN), Math.max(.025, Math.min(.18, values.strokeM / 3)), values.strokeM);
  builder.control('press force and stroke control', 'pid', [forceSensor], [actuator], 'advance the ram through the requested stroke while limiting force and maintaining platen alignment', values.forceN);
  builder.connect(powerUnit, ram, 'power', 'hydraulic_pressure_supply');
  builder.connect(loadCell, controller, 'signal', 'press_force_feedback');
  return { id: 'hydraulic-press', mountId: base, editableId: loadCell, handles: ['structure', 'measure'], driveId: ram, outputId: platen };
}

function addDrumWinch(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly(
    'electric cable drum winch',
    'Rigid skid, supported winding drum, electric gearmotor, overhead fairlead, load cable, hook, payload, and closed-loop load control',
    rootAssemblyId,
  );
  const base = builder.component('frame', 'winch skid base', assembly, [0, .18, 0], [4.1, .32, 2.45], 'steel', 'fixed', { winch_base: true, safety_stripes: true }, 155);
  const leftPedestal = builder.component('support', 'left drum bearing pedestal', assembly, [-.72, 1.08, -.78], [.42, 1.72, .4], 'steel', 'fixed', { winch_bearing: true }, 38);
  const rightPedestal = builder.component('support', 'right drum bearing pedestal', assembly, [-.72, 1.08, .78], [.42, 1.72, .4], 'steel', 'fixed', { winch_bearing: true }, 38);
  builder.joint('fixed', base, leftPedestal);
  builder.joint('fixed', base, rightPedestal);
  const shaft = builder.component('shaft', 'winch drum shaft', assembly, [-.72, 1.38, 0], [.2, 1.82, .2], 'steel', 'dynamic', { winch_shaft: true }, 18);
  builder.rotate(shaft, [Math.PI / 2, 0, 0]);
  const shaftJoint = builder.joint('revolute', leftPedestal, shaft, [0, 0, 1], { anchorA: [0, .3, .78], anchorB: [0, 0, 0] });
  builder.connect(rightPedestal, shaft, 'mechanical', 'outboard_bearing_support');
  const drum = builder.component('pulley', 'grooved cable winding drum', assembly, [-.72, 1.38, 0], [1.02, 1.12, 1.02], 'steel', 'dynamic', { winch_drum: true, drum_radius_m: .51, design_line_speed_mps: values.linearSpeedMps }, 62);
  builder.rotate(drum, [Math.PI / 2, 0, 0]);
  builder.joint('fixed', shaft, drum);
  for (const side of [-1, 1]) {
    const flange = builder.component('wheel', `${side < 0 ? 'left' : 'right'} cable drum flange`, assembly, [-.72, 1.38, side * .61], [1.34, .11, 1.34], 'steel', 'dynamic', { winch_drum_flange: true }, 12);
    builder.rotate(flange, [Math.PI / 2, 0, 0]);
    builder.joint('fixed', drum, flange);
  }
  const motor = builder.component('motor', 'electric winch gearmotor', assembly, [-.72, 1.38, -1.12], [.68, .62, .68], 'steel', 'kinematic', { electric_winch_motor: true });
  const drumRpm = values.linearSpeedMps / (2 * Math.PI * .51) * 60;
  builder.motor(motor, shaftJoint, Math.max(55, values.payloadKg * 9.81 * .51 * 1.3), Math.max(.2, drumRpm));
  builder.connect(motor, shaft, 'power', 'winch_drum_torque');

  const hookY = .95;
  const fairleadY = Math.max(3.72, hookY + values.liftM + .68);
  const mastBottomY = .13;
  const mast = builder.component('beam', 'winch lifting mast', assembly, [1.18, (fairleadY + mastBottomY) / 2, 0], [.4, fairleadY - mastBottomY, .48], 'steel', 'fixed', { winch_mast: true, fairlead_height_m: fairleadY }, 112);
  const boom = builder.member('beam', 'overhead fairlead beam', assembly, [1.18, fairleadY, 0], [2.58, fairleadY, 0], .34, 'steel', 'fixed', { winch_fairlead_support: true, fairlead_height_m: fairleadY });
  builder.joint('fixed', base, mast);
  builder.joint('fixed', mast, boom);
  const fairlead = builder.component('pulley', 'overhead cable fairlead pulley', assembly, [2.52, fairleadY, 0], [.72, .24, .72], 'steel', 'dynamic', { winch_fairlead: true, fairlead_height_m: fairleadY }, 11);
  builder.rotate(fairlead, [Math.PI / 2, 0, 0]);
  builder.joint('revolute', boom, fairlead, [0, 0, 1], { anchorA: [.64, 0, 0], anchorB: [0, 0, 0] });
  const hook = builder.component('hook', 'forged winch lifting hook', assembly, [2.52, hookY, 0], [.28, .48, .14], 'steel', 'kinematic', { winch_hook: true, winch_travel_m: values.liftM }, 8);
  // Anchor the reduced-order tension constraint to the fixed fairlead beam.
  // The visible pulley remains free to rotate, but it does not receive the
  // entire suspended load through a second under-constrained dynamic body.
  const ropeJoint = builder.joint('rope', boom, hook, [0, 1, 0], {
    limits: [0, Math.max(.2, fairleadY - hookY - .19)],
    anchorA: [.64, 0, 0],
    anchorB: [0, .24, 0],
  });
  const payload = builder.component('container', 'winch test payload', assembly, [2.52, hookY - .58, 0], [1.18, .55, .78], 'steel', 'dynamic', { payload_kg: values.payloadKg, winch_payload: true, winch_travel_m: values.liftM }, values.payloadKg);
  builder.joint('fixed', hook, payload);
  const ratedBreakingLoad = Math.max(12000, values.payloadKg * 9.81 * 6);
  const drumLead = builder.member('cable', 'drum-to-fairlead cable', assembly, [-.2, 1.76, 0], [2.52, fairleadY, 0], .035, 'steel', 'kinematic', { winch_cable: true, cable_segment: 'lead', rated_breaking_load_n: ratedBreakingLoad });
  const loadLine = builder.member('cable', 'vertical winch load line', assembly, [2.52, fairleadY, 0], [2.52, hookY + .2, 0], .035, 'steel', 'kinematic', { winch_cable: true, cable_segment: 'load', rated_breaking_load_n: ratedBreakingLoad, winch_travel_m: values.liftM });
  builder.connect(drum, drumLead, 'mechanical', 'cable_winding');
  builder.connect(drumLead, fairlead, 'mechanical', 'fairlead_entry');
  builder.connect(fairlead, loadLine, 'mechanical', 'fairlead_exit');
  builder.connect(loadLine, hook, 'mechanical', 'cable_termination');

  const loadCell = builder.component('sensor', 'winch cable load cell', assembly, [2.18, fairleadY, -.28], [.24, .2, .24], 'steel', 'fixed', { winch_load_cell: true, fairlead_height_m: fairleadY }, 1.2);
  builder.joint('fixed', boom, loadCell);
  const loadSensor = builder.sensor(loadCell, 'load', 'winch_line_load', hook, Math.max(2, values.liftM + 1));
  const controller = builder.component('controller', 'winch speed and overload controller', assembly, [.18, .7, -.82], [.7, .72, .4], 'steel', 'fixed', { winch_controller: true }, 5.5);
  builder.joint('fixed', base, controller);
  const actuator = builder.actuator(motor, ropeJoint, 'winch', Math.max(1200, values.payloadKg * 9.81 * 2.1), values.linearSpeedMps, values.liftM);
  builder.control('winch lift control', 'pid', [loadSensor], [actuator], 'wind the drum at the requested line speed while limiting cable load and hook travel', values.linearSpeedMps);
  builder.connect(loadCell, controller, 'signal', 'winch_load_feedback');
  return { id: 'drum-winch', mountId: base, editableId: loadCell, handles: ['lift', 'suspend', 'rotate', 'measure'], driveId: motor, outputId: hook };
}

function addParallelGuides(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('parallel linear guides', 'Load platform, parallel slides, pistons, and cross-level feedback', rootAssemblyId);
  const base = builder.component('frame', 'guide base', assembly, [0, .16, 0], [3.4, .28, 2.4], 'steel', 'fixed');
  const left = builder.component('beam', 'left linear guide', assembly, [-1.25, 1.8, 0], [.24, 3.5, .24], 'steel', 'fixed');
  const right = builder.component('beam', 'right linear guide', assembly, [1.25, 1.8, 0], [.24, 3.5, .24], 'steel', 'fixed');
  const platform = builder.component('plate', 'guided load platform', assembly, [0, .72, 0], [2.8, .22, 1.9], 'aluminum', 'kinematic', { payload_kg: values.payloadKg, parallel_lift_platform: true });
  builder.joint('fixed', base, left); builder.joint('fixed', base, right);
  // One centered physical slide defines the platform degree of freedom. Two
  // parallel prismatic constraints on the same body form an over-constrained
  // loop in a rigid-body solver and previously made this lift tear itself
  // apart. The paired cylinders both command this one measured axis, matching
  // a real cross-level manifold without inventing a second degree of freedom.
  const liftJoint = builder.jointAt('prismatic', base, platform, [0, .72, 0], [0, 1, 0], { limits: [0, values.liftM] });
  const actuators: string[] = [];
  [left, right].forEach((_guide, index) => {
    const piston = builder.component('piston', `linear drive ${index + 1}`, assembly, [index ? .9 : -.9, .75, 0], [.26, Math.max(1.2, values.liftM), .26], 'steel', 'fixed', { parallel_lift_cylinder: true });
    builder.joint('fixed', base, piston);
    actuators.push(builder.actuator(piston, liftJoint, 'piston', Math.max(450, values.payloadKg * 9.81 * .23), .35, values.liftM));
  });
  const payload = builder.component('container', 'platform payload', assembly, [0, 1.08, 0], [1.15, .55, .85], 'polymer', 'kinematic', { payload_kg: values.payloadKg, parallel_lift_payload: true }, values.payloadKg);
  builder.joint('fixed', platform, payload);
  const imu = builder.component('sensor', 'platform level sensor', assembly, [-.35, 1, 0], undefined, undefined, 'fixed');
  const sensor = builder.sensor(imu, 'imu', 'platform_level', platform, 4);
  builder.control('cross level', 'synchronized', [sensor], actuators, 'synchronize slide travel and limit acceleration', values.acceleration);
  builder.joint('fixed', imu, platform);
  return { id: 'parallel-guides', mountId: base, editableId: imu, handles: ['lift', 'stabilize'] };
}

function addScissorLift(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly(
    'hydraulic scissor lift',
    'Grounded rectangular base, two visible crossed-link pairs, a level load platform, hydraulic cylinder, safety feedback, and a rated payload',
    rootAssemblyId,
  );
  const base = builder.component(
    'frame',
    'grounded scissor lift base',
    assembly,
    [0, .18, 0],
    [3.55, .3, 2.15],
    'steel',
    'fixed',
    { scissor_base: true, safety_stripes: true },
    260,
  );
  const baseDeck = builder.component(
    'plate',
    'scissor lift base deck',
    assembly,
    [0, .35, 0],
    [3.2, .1, 1.82],
    'steel',
    'fixed',
    { scissor_base_deck: true },
    115,
  );
  builder.joint('fixed', base, baseDeck);

  const platform = builder.component(
    'plate',
    'level scissor lift platform',
    assembly,
    [0, 1.52, 0],
    [3.3, .2, 2.02],
    'aluminum',
    'kinematic',
    { scissor_platform: true, scissor_travel_m: values.liftM, rated_payload_kg: values.payloadKg },
    110,
  );
  // A single centered guide is the reduced-order constraint that keeps the
  // platform level without over-constraining Rapier with a closed linkage.
  // The crossed arms remain an explicit, readable load path in the design
  // graph while this prismatic joint supplies stable animated travel.
  // The positive-Y guide is shared by both the deterministic motion graph and
  // Rapier's actuator velocity, so the visible deck and physical deck travel
  // upward together instead of disagreeing about the lift direction.
  const liftJoint = builder.joint('prismatic', base, platform, [0, 1, 0], { limits: [0, values.liftM] });

  const lowerY = .44;
  // Keep a small reduced-order roller clearance below the moving deck so the
  // visual X members do not become solid collision stops in the physics run.
  const upperY = 1.24;
  const halfSpan = 1.28;
  const centerY = (lowerY + upperY) / 2;
  const armAngle = Math.atan2(upperY - lowerY, halfSpan * 2);
  const arms: string[] = [];
  [-.72, .72].forEach((z, pairIndex) => {
    const side = z < 0 ? 'left' : 'right';
    const rising = builder.member(
      'beam',
      `${side} scissor arm rising right`,
      assembly,
      [-halfSpan, lowerY, z],
      [halfSpan, upperY, z],
      .17,
      'steel',
      'fixed',
      { scissor_arm: true, scissor_pair: pairIndex + 1, scissor_direction: 'rising-right', scissor_lower_y: lowerY, scissor_initial_height: upperY - lowerY, scissor_travel_m: values.liftM },
    );
    const falling = builder.member(
      'beam',
      `${side} scissor arm rising left`,
      assembly,
      [halfSpan, lowerY, z],
      [-halfSpan, upperY, z],
      .17,
      'steel',
      'fixed',
      { scissor_arm: true, scissor_pair: pairIndex + 1, scissor_direction: 'rising-left', scissor_lower_y: lowerY, scissor_initial_height: upperY - lowerY, scissor_travel_m: values.liftM },
    );
    builder.rotate(falling, [0, 0, -armAngle]);
    arms.push(rising, falling);
    // The crossed arms are reduced-order fixed visual load paths; their center
    // pin is represented as a mechanical connection instead of an impossible
    // revolute constraint between two fixed Rapier bodies.
    builder.connect(rising, falling, 'mechanical', 'scissor_center_hinge');
    builder.connect(baseDeck, rising, 'mechanical', 'lower_scissor_pin');
    builder.connect(baseDeck, falling, 'mechanical', 'lower_scissor_pin');
    builder.connect(rising, platform, 'mechanical', 'upper_scissor_roller');
    builder.connect(falling, platform, 'mechanical', 'upper_scissor_roller');
    const pivotPin = builder.component(
      'shaft',
      `${side} scissor center pivot pin`,
      assembly,
      [0, centerY, z],
      [.16, .28, .16],
      'steel',
      'fixed',
      { scissor_pivot: true, scissor_pair: pairIndex + 1, scissor_travel_m: values.liftM },
      1.2,
    );
    builder.rotate(pivotPin, [Math.PI / 2, 0, 0]);
    builder.connect(pivotPin, rising, 'mechanical', 'center_pivot_pin');
    builder.connect(pivotPin, falling, 'mechanical', 'center_pivot_pin');
  });

  const cylinder = builder.component(
    'piston',
    'hydraulic scissor lift cylinder',
    assembly,
    [-.62, .77, 0],
    [.3, 1.2, .3],
    'steel',
    'kinematic',
    { scissor_actuator: true, bore_m: .12, stroke_m: values.liftM },
    18,
  );
  builder.rotate(cylinder, [0, 0, -.48]);
  builder.connect(baseDeck, cylinder, 'mechanical', 'hydraulic_lower_clevis');
  builder.connect(cylinder, arms[0], 'mechanical', 'hydraulic_upper_clevis');
  const actuator = builder.actuator(
    cylinder,
    liftJoint,
    'piston',
    Math.max(6000, values.payloadKg * 9.81 * 2.1),
    .3,
    values.liftM,
  );

  const payload = builder.component(
    'container',
    'rated platform load',
    assembly,
    [0, 1.95, 0],
    [1.25, .62, 1.05],
    'steel',
    'dynamic',
    { payload_kg: values.payloadKg, scissor_payload: true, scissor_travel_m: values.liftM },
    values.payloadKg,
  );
  // The payload is rigidly carried by the deck in the reduced-order physics
  // model. A visual-only contact left the 300 kg test mass behind while the
  // actuator telemetry claimed a successful lift.
  builder.joint('fixed', platform, payload);
  builder.connect(platform, payload, 'mechanical', 'rated_load_contact');
  const levelSensorBody = builder.component(
    'sensor',
    'platform level and overload sensor',
    assembly,
    [-1.25, 1.7, -.75],
    [.24, .18, .24],
    'polymer',
    'dynamic',
    { scissor_level_sensor: true, scissor_travel_m: values.liftM },
    .35,
  );
  builder.joint('fixed', platform, levelSensorBody);
  const levelSensor = builder.sensor(levelSensorBody, 'imu', 'scissor_platform_level', platform, 4);
  const controller = builder.component(
    'controller',
    'scissor lift hydraulic controller',
    assembly,
    [-1.35, .62, -.78],
    [.52, .62, .32],
    'polymer',
    'fixed',
    { scissor_controller: true },
  );
  builder.joint('fixed', base, controller);
  builder.connect(controller, cylinder, 'signal', 'hold_to_run_lift_command');
  builder.control(
    'level hydraulic lift',
    'pid',
    [levelSensor],
    [actuator],
    'raise the platform through the scissor linkage while holding zero roll and stopping on overload',
    values.liftM,
  );
  const levelControl = builder.controls.at(-1);
  if (levelControl) { levelControl.kp = .92; levelControl.kd = .16; }

  return {
    id: 'scissor-linkage-lift',
    mountId: base,
    editableId: levelSensorBody,
    handles: ['lift', 'stabilize', 'measure'],
    driveId: cylinder,
    outputId: platform,
  };
}

function addPatientLift(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('mobile patient transfer lift', 'Wide rolling base, upright mast, lifting boom, linear actuator, spreader bar, and supportive sling', rootAssemblyId);
  const leftLeg = builder.member('beam', 'left splayed base leg', assembly, [-1.2, .18, -.42], [1.45, .18, -.78], .16, 'steel', 'fixed', { medical_frame: true, round_tube: true });
  const rightLeg = builder.member('beam', 'right splayed base leg', assembly, [-1.2, .18, .42], [1.45, .18, .78], .16, 'steel', 'fixed', { medical_frame: true, round_tube: true });
  const baseCross = builder.component('beam', 'rear base crossmember', assembly, [-1.08, .18, 0], [.24, .24, 1.55], 'steel', 'fixed', { medical_frame: true });
  const mastPlate = builder.component('plate', 'patient lift mast mounting plate', assembly, [-1, .31, 0], [.72, .12, .82], 'steel', 'fixed', { medical_frame: true }, 5.8);
  builder.connect(leftLeg, baseCross, 'mechanical', 'welded_base');
  builder.connect(rightLeg, baseCross, 'mechanical', 'welded_base');
  builder.joint('fixed', baseCross, mastPlate);
  for (const [index, position] of ([[-1.12, .14, -.52], [-1.12, .14, .52], [1.4, .14, -.82], [1.4, .14, .82]] as Vec3[]).entries()) {
    const caster = builder.component('wheel', `medical caster ${index + 1}`, assembly, position, [.26, .11, .26], 'rubber', 'fixed', { medical_caster: true });
    builder.rotate(caster, [Math.PI / 2, 0, 0]);
    builder.connect(caster, index < 2 ? baseCross : index === 2 ? leftLeg : rightLeg, 'mechanical', 'swivel_caster_mount');
  }
  const mast = builder.member('beam', 'slightly inclined patient lift mast', assembly, [-1.02, .35, 0], [-.72, 2.7, 0], .28, 'steel', 'fixed', { medical_frame: true, round_tube: true });
  builder.connect(mast, baseCross, 'mechanical', 'mast_mount');
  const boomStart: Vec3 = [-.72, 2.65, 0];
  const boomMid: Vec3 = [.18, 2.98, 0];
  const boomEnd: Vec3 = [1.18, 2.9, 0];
  const boom = builder.member('beam', 'lifting boom rear segment', assembly, boomStart, boomMid, .22, 'aluminum', 'dynamic', { medical_boom: true, round_tube: true });
  const boomNose = builder.member('beam', 'lifting boom curved nose', assembly, boomMid, boomEnd, .2, 'aluminum', 'dynamic', { medical_boom: true, round_tube: true });
  const boomJoint = builder.joint('revolute', mast, boom, [0, 0, 1], { limits: [-.12, .48], anchorA: [1.135, 0, 0], anchorB: [-.48, 0, 0] });
  builder.joint('fixed', boom, boomNose);
  const piston = builder.component('piston', 'quiet electric lift actuator', assembly, [-.4, 1.9, 0], [.22, 1.97, .22], 'steel', 'kinematic', { medical_actuator: true });
  builder.rotate(piston, [0, 0, -.532]);
  const lowerClevis = builder.component('support', 'mast actuator clevis', assembly, [-.9, 1.05, 0], [.24, .24, .3], 'steel', 'fixed', { medical_actuator_mount: true }, 1.2);
  const upperClevis = builder.component('support', 'boom actuator clevis', assembly, [.1, 2.75, 0], [.24, .24, .3], 'steel', 'dynamic', { medical_actuator_mount: true }, 1.2);
  builder.connect(lowerClevis, mast, 'mechanical', 'lower_actuator_pin');
  builder.connect(upperClevis, boom, 'mechanical', 'upper_actuator_pin');
  builder.connect(piston, lowerClevis, 'mechanical', 'actuator_lower_eye');
  builder.connect(piston, upperClevis, 'mechanical', 'actuator_upper_eye');
  const actuator = builder.actuator(piston, boomJoint, 'piston', Math.max(1400, values.payloadKg * 9.81 * 1.8), .28, Math.max(.55, values.liftM));
  const hanger = builder.component('hook', 'short sling hanger', assembly, [1.18, 2.66, 0], [.13, .24, .09], 'steel', 'dynamic', { patient_hanger: true });
  builder.joint('spherical', boomNose, hanger, [0, 1, 0], { anchorA: [.5, -.04, 0], anchorB: [0, .12, 0] });
  const spreader = builder.component('beam', 'four-point sling spreader bar', assembly, [1.18, 2.48, 0], [.22, .18, 1.18], 'aluminum', 'dynamic', { patient_spreader: true });
  builder.joint('fixed', hanger, spreader);
  const sling = builder.component('container', 'supportive patient sling', assembly, [1.18, 1.72, 0], [.9, .82, .98], 'polymer', 'dynamic', { patient_sling: true, payload_kg: values.payloadKg }, values.payloadKg);
  for (const [index, z] of [-.48, -.25, .25, .48].entries()) {
    const strap = builder.member('cable', `sling support strap ${index + 1}`, assembly, [1.18, 2.44, z], [1.18 + (index < 2 ? -.18 : .18), 2.02, z * .68], .022, 'steel', 'dynamic', { sling_strap: true });
    builder.connect(strap, sling, 'mechanical', `sling_attachment_${index + 1}`);
  }
  builder.joint('fixed', spreader, sling);
  const sensorBody = builder.component('sensor', 'spreader load and acceleration sensor', assembly, [1.05, 2.48, 0], [.24, .2, .24], 'polymer', 'fixed', { medical_sensor: true });
  const sensor = builder.sensor(sensorBody, 'load', 'patient_load_acceleration', sling, Math.min(100, values.payloadKg * 1.05));
  const controller = builder.component('controller', 'handset safety controller', assembly, [-.95, 1.55, -.34], [.24, .48, .18], 'polymer', 'fixed', { medical_controller: true });
  const battery = builder.component('controller', 'removable lift battery pack', assembly, [-1.03, 1.02, .28], [.38, .62, .26], 'polymer', 'fixed', { medical_battery: true }, 4.6);
  const pushLeft = builder.member('beam', 'left caregiver push handle', assembly, [-.9, 1.85, -.22], [-1.35, 1.95, -.42], .055, 'steel', 'fixed', { round_tube: true, medical_frame: true });
  const pushRight = builder.member('beam', 'right caregiver push handle', assembly, [-.9, 1.85, .22], [-1.35, 1.95, .42], .055, 'steel', 'fixed', { round_tube: true, medical_frame: true });
  builder.control('smooth patient transfer', 'pid', [sensor], [actuator], 'raise the sling while limiting acceleration and stopping on overload', values.acceleration);
  builder.connect(controller, piston, 'signal', 'hold_to_run_lift_command');
  builder.connect(battery, piston, 'power', 'lift_power'); builder.connect(battery, mast, 'mechanical', 'battery_mount');
  builder.connect(pushLeft, mast, 'mechanical', 'push_handle_mount'); builder.connect(pushRight, mast, 'mechanical', 'push_handle_mount');
  return { id: 'patient-lift', mountId: baseCross, editableId: sensorBody, handles: ['lift', 'stabilize', 'measure'], driveId: piston, outputId: sling };
}

function addWarehouseBuffer(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('zero-pressure roller accumulator', 'One continuous four-zone roller conveyor advances cartons one zone at a time using photoeyes and low pop-up stops', rootAssemblyId);
  const controller = builder.component('controller', 'zero-pressure zone controller', assembly, [0, .62, -1.42], [.7, .9, .42], 'steel', 'fixed', { control_cabinet: true });
  const sensors: string[] = [];
  const actuators: string[] = [];
  let firstConveyor = '';
  for (let index = 0; index < 4; index += 1) {
    const x = -3.15 + index * 2.1;
    const frame = builder.component('frame', `accumulation zone ${index + 1} support`, assembly, [x, .47, 0], [2.08, .8, 1.62], 'steel', 'fixed', { conveyor_frame: true, buffer_zone: index + 1 });
    const conveyor = builder.component('conveyor', `powered roller zone ${index + 1}`, assembly, [x, .92, 0], [2.06, .26, 1.28], 'steel', 'fixed', { accumulation_zone: true, buffer_zone: index + 1, zone_color: index < 3 ? 'blue' : 'green', target_throughput: values.throughput });
    if (!firstConveyor) firstConveyor = conveyor;
    builder.joint('fixed', frame, conveyor);
    const motor = builder.component('motor', `zone ${index + 1} geared drive`, assembly, [x - .82, .62, -.92], [.42, .54, .42], 'steel', 'kinematic', { geared_motor: true });
    builder.motor(motor, undefined, Math.max(20, values.throughput * .8), Math.max(65, values.throughput * 2.7));
    builder.connect(controller, motor, 'signal', `zone_${index + 1}_speed_command`);
    builder.connect(motor, conveyor, 'power', `zone_${index + 1}_drive`);
    const sensorBody = builder.component('sensor', `zone ${index + 1} photoeye`, assembly, [x + .72, 1.28, -.72], [.24, .28, .24], 'polymer', 'fixed', { buffer_photoeye: true });
    sensors.push(builder.sensor(sensorBody, 'presence', `zone_${index + 1}_occupied`, conveyor, 1.3));
    builder.connect(sensorBody, controller, 'signal', `zone_${index + 1}_occupancy`);
    const beacon = builder.component('light', `zone ${index + 1} occupancy beacon`, assembly, [x + .72, 1.58, .74], [.18, .18, .18], 'aluminum', 'fixed', { buffer_beacon: true, headlight: false }, .18);
    builder.connect(sensorBody, beacon, 'signal', `zone_${index + 1}_status`);
    if (index < 3) {
      const gate = builder.component('beam', `zone ${index + 1} low pop-up stop`, assembly, [x + .98, 1.08, 0], [.12, .18, 1.08], 'aluminum', 'dynamic', { buffer_gate: true, operation_index: index });
      const gateJoint = builder.joint('prismatic', frame, gate, [0, 1, 0], { limits: [0, .24] });
      const servo = builder.component('servo', `zone ${index + 1} stop actuator`, assembly, [x + .98, .72, -.78], [.34, .32, .34], 'aluminum', 'kinematic');
      actuators.push(builder.actuator(servo, gateJoint, 'linear', 180, .35, .24));
      builder.connect(controller, servo, 'signal', `zone_${index + 1}_release`);
    }
  }
  [-3.65, -2.05, -.15, 1.75, 3.4].forEach((x, index) => {
    builder.component('container', `queued shipping carton ${index + 1}`, assembly, [x, 1.28, 0], [.58 + index * .05, .52, .68], 'polymer', 'dynamic', { product_form: 'shipping-carton', queue_index: index + 1 }, 3.5 + index);
  });
  builder.control('zero-pressure accumulation', 'state-machine', sensors, actuators, 'release one occupied zone only when the next zone is clear', values.throughput);
  return { id: 'warehouse-buffer', mountId: firstConveyor, editableId: builder.components.find((item) => item.role === 'zone 2 photoeye')!.id, handles: ['transport', 'buffer', 'measure'] };
}

function addTomatoGrader(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('tomato quality grader', 'Soft singulating feed, illuminated color inspection, gentle selector, and two padded low-drop bins for ripe versus green or damaged fruit', rootAssemblyId);
  const frame = builder.component('frame', 'food-grade grader frame', assembly, [0, .47, 0], [6.2, .82, 2], 'aluminum', 'fixed', { conveyor_frame: true, food_grade: true });
  const feed = builder.component('conveyor', 'soft feed belt', assembly, [-2.2, .94, 0], [2.2, .2, 1.32], 'aluminum', 'fixed', { industrial_conveyor: true, food_grade: true, target_throughput: values.throughput });
  builder.joint('fixed', frame, feed);
  const motor = builder.component('motor', 'washdown grader motor', assembly, [-3.1, .66, -.98], [.46, .58, .46], 'steel', 'kinematic', { geared_motor: true });
  builder.motor(motor, undefined, 24, 65);
  builder.connect(motor, feed, 'power', 'gentle_feed_drive');
  for (let index = 0; index < 6; index += 1) {
    const roller = builder.component('roller', `soft singulating roller ${index + 1}`, assembly, [-.72 + index * .5, .95, 0], [.16, 1.22, .16], 'polymer', 'dynamic', { grading_roller: true, food_grade: true, gap_mm: 28 });
    builder.rotate(roller, [Math.PI / 2, 0, 0]);
    const rollerBody = builder.components.find((item) => item.id === roller)!;
    const frameBody = builder.components.find((item) => item.id === frame)!;
    builder.joint('revolute', frame, roller, [0, 0, 1], { anchorA: rollerBody.position.map((value, axis) => value - frameBody.position[axis]) as Vec3, anchorB: [0, 0, 0] });
  }
  const sensorBody = builder.component('camera', 'illuminated tomato quality camera', assembly, [-.55, 1.72, 0], [.34, .3, .34], 'polymer', 'fixed', { sorting_sensor: true, produce_sensor: true });
  const sensor = builder.sensor(sensorBody, 'camera', 'tomato_color_and_surface', feed, 2.5);
  const chutes: string[] = [];
  const bins: string[] = [];
  for (const [index, route] of ['ripe red', 'green or damaged'].entries()) {
    const side = index ? 1 : -1;
    const routeHue = index ? 'green' : 'red';
    const chute = builder.component('ramp', `${route} tomato padded chute`, assembly, [2.18, .72, side * .82], [1.65, .12, .72], 'polymer', 'fixed', { sorting_chute: true, route_color: routeHue, padded: true });
    builder.rotate(chute, [0, side * -.36, -.1]);
    const bin = builder.component('container', `${route} tomato padded bin`, assembly, [3.18, .48, side * 1.45], [1.15, .78, 1.05], 'polymer', 'fixed', { sorting_bin: true, route_color: routeHue, padded: true, bin_label: route }, 12);
    builder.connect(chute, bin, 'mechanical', `${route}_produce_path`);
    chutes.push(chute); bins.push(bin);
  }
  const diverter = builder.component('beam', 'soft quality selector paddle', assembly, [1.35, 1.05, 0], [1.05, .14, .2], 'polymer', 'dynamic', { sorting_diverter: true, food_grade: true });
  const diverterJoint = builder.joint('revolute', feed, diverter, [0, 1, 0], { limits: [-.6, .6], anchorA: [3.55, .11, 0], anchorB: [0, 0, 0] });
  const servo = builder.component('servo', 'sealed selector servo', assembly, [1.12, .72, -.78], [.36, .32, .36], 'aluminum', 'kinematic');
  const actuator = builder.actuator(servo, diverterJoint, 'servo', 120, 1.25, 1.2);
  const controller = builder.component('controller', 'grader control enclosure', assembly, [.15, .56, -1.18], [.62, .72, .38], 'polymer', 'fixed');
  builder.control('gentle quality grading', 'state-machine', [sensor], [actuator], 'send ripe red tomatoes to the good bin and green or damaged fruit to reject while limiting drop height', .15);
  builder.connect(sensorBody, controller, 'signal', 'quality_measurement');
  builder.connect(controller, servo, 'signal', 'selector_command');
  const tomatoes = [
    { x: -2.85, z: -.18, size: .4, grade: 'ripe' },
    { x: -2.25, z: .14, size: .36, grade: 'unripe' },
    { x: -1.65, z: -.12, size: .43, grade: 'ripe' },
    { x: -1.05, z: .17, size: .38, grade: 'damaged' },
    { x: -.45, z: -.15, size: .41, grade: 'unripe' },
    { x: .1, z: .12, size: .39, grade: 'ripe' },
  ];
  tomatoes.forEach((item, index) => builder.component('container', `${item.grade} tomato ${index + 1}`, assembly, [item.x, 1.23, item.z], [item.size, item.size, item.size], 'polymer', 'dynamic', { product_form: 'tomato', grade: item.grade, operation_index: index }, .11 + index * .015));
  return { id: 'tomato-grader', mountId: frame, editableId: sensorBody, handles: ['transport', 'classify', 'contain', 'measure'] };
}

function addRecyclingSeparator(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('rotary material recovery line', 'Open feed hopper, perforated trommel, magnetic can recovery, air-assisted bottle recovery, reject chute, and three independent containers', rootAssemblyId);
  const frame = builder.component('frame', 'trommel support skid', assembly, [-.25, .42, 0], [5.8, .72, 2.25], 'steel', 'fixed', { industrial_base: true }, 115);
  const hopper = builder.component('container', 'open mixed-material feed hopper', assembly, [-2.65, 1.42, 0], [1.35, 1.45, 1.6], 'steel', 'fixed', { route_color: 'orange', recycling_hopper: true }, 38);
  const feedChute = builder.component('ramp', 'inclined hopper feed chute', assembly, [-1.78, 1.12, 0], [1.5, .16, 1.18], 'steel', 'fixed', { sorting_chute: true, route_color: 'orange' }, 16);
  builder.rotate(feedChute, [0, 0, -.16]); builder.connect(hopper, feedChute, 'mechanical', 'gravity_feed');

  const drum = builder.component('roller', 'perforated rotating trommel drum', assembly, [-.15, 1.48, 0], [1.52, 2.85, 1.52], 'steel', 'dynamic', { recycling_drum: true, screen_aperture_mm: 80 }, 58);
  const drumJoint = builder.joint('revolute', frame, drum, [1, 0, 0], { limits: [-Math.PI, Math.PI], anchorA: [.1, 1.06, 0], anchorB: [0, 0, 0] });
  const drumMotor = builder.component('motor', 'trommel chain drive motor', assembly, [-1.1, .74, -1.08], [.52, .66, .52], 'steel', 'kinematic', { geared_motor: true });
  builder.motor(drumMotor, drumJoint, 180, 24); builder.connect(drumMotor, drum, 'power', 'trommel_rotation');

  const magnet = builder.component('support', 'overhead can recovery magnet', assembly, [1.55, 2.42, -.32], [1.25, .8, .62], 'steel', 'fixed', { recycling_magnet: true }, 34);
  const magneticBelt = builder.component('belt', 'magnetic can takeaway belt', assembly, [2.05, 1.88, -.72], [2.55, .18, .58], 'polymer', 'fixed', { magnetic_belt: true }, 9);
  builder.rotate(magneticBelt, [0, -.22, -.08]); builder.connect(magnet, magneticBelt, 'mechanical', 'magnetic_can_pickup');
  const blower = builder.component('motor', 'air classifier blower', assembly, [1.2, .82, .92], [.58, .68, .58], 'steel', 'kinematic', { classifier_blower: true });
  builder.motor(blower, undefined, 42, 1450);
  const nozzle = builder.component('shaft', 'plastic bottle air nozzle', assembly, [1.65, 1.3, .82], [.18, .9, .18], 'aluminum', 'fixed', { air_nozzle: true });
  builder.rotate(nozzle, [0, 0, Math.PI / 2]); builder.connect(blower, nozzle, 'power', 'classification_air');

  const controller = builder.component('controller', 'material recovery controller', assembly, [-.15, .68, -1.3], [.68, .86, .42], 'steel', 'fixed', { control_cabinet: true });
  const metalSensorBody = builder.component('sensor', 'inductive can detector', assembly, [.9, 1.86, -.28], [.28, .22, .28], 'polymer', 'fixed', { material_sensor: true });
  const opticalSensorBody = builder.component('camera', 'bottle and reject optical sensor', assembly, [.9, 1.95, .34], [.3, .24, .3], 'polymer', 'fixed', { material_sensor: true });
  const metalSensor = builder.sensor(metalSensorBody, 'presence', 'ferrous_or_aluminum_can', drum, 2.5);
  const opticalSensor = builder.sensor(opticalSensorBody, 'camera', 'bottle_shape', drum, 2.5);
  builder.connect(metalSensorBody, controller, 'signal', 'can_detection'); builder.connect(opticalSensorBody, controller, 'signal', 'bottle_detection');
  builder.connect(controller, drumMotor, 'signal', 'drum_speed'); builder.connect(controller, blower, 'signal', 'air_classifier_command');

  const routes = [
    { route: 'metal', label: 'recovered cans', x: 3.45, z: -1.65 },
    { route: 'plastic', label: 'recovered bottles', x: 3.45, z: 0 },
    { route: 'reject', label: 'reject fines', x: 2.05, z: 1.65 },
  ];
  routes.forEach(({ route, label, x, z }) => {
    const chute = builder.component('ramp', `${route} recovery chute`, assembly, [x - .65, .78, z * .72], [1.45, .14, .72], 'aluminum', 'fixed', { sorting_chute: true, route_color: route });
    builder.rotate(chute, [0, z * -.12, -.12]);
    const bin = builder.component('container', `${label} container`, assembly, [x, .48, z], [1.2, .92, 1.08], 'polymer', 'fixed', { sorting_bin: true, route_color: route, bin_label: label }, 15);
    builder.connect(chute, bin, 'mechanical', `${route}_recovery_path`);
  });
  const objects = [
    { role: 'aluminum beverage can', form: 'metal-can', dimensions: [.46, .66, .46] as Vec3, material: 'aluminum', mass: .18 },
    { role: 'clear plastic bottle', form: 'plastic-bottle', dimensions: [.4, .72, .4] as Vec3, material: 'polymer', mass: .08 },
    { role: 'unrecoverable mixed object', form: 'reject-object', dimensions: [.5, .52, .5] as Vec3, material: 'polymer', mass: .22 },
    { role: 'second aluminum can', form: 'metal-can', dimensions: [.44, .64, .44] as Vec3, material: 'aluminum', mass: .16 },
    { role: 'second plastic bottle', form: 'plastic-bottle', dimensions: [.38, .68, .38] as Vec3, material: 'polymer', mass: .07 },
  ];
  objects.forEach((item, index) => builder.component('container', item.role, assembly, [-2.82 + index * .32, 1.74 + (index % 2) * .18, (index % 3 - 1) * .24], item.dimensions, item.material, 'dynamic', { product_form: item.form, operation_index: index }, item.mass));
  builder.control('rotary three-stream material recovery', 'state-machine', [metalSensor, opticalSensor], [], 'rotate the trommel continuously, lift cans magnetically, air-classify bottles, and let rejects fall to the third container', values.throughput);
  return { id: 'recycling-separator', mountId: frame, editableId: opticalSensorBody, handles: ['transport', 'classify', 'contain', 'measure'], driveId: drumMotor, outputId: drum };
}

function addMaterialFlow(context: ModuleContext): ModuleResult {
  const { builder, values, capabilities, rootAssemblyId } = context;
  const assembly = builder.assembly('two-color package sorter', 'Powered belt, red and blue cartons, vision portal, servo diverter, two chutes, and two labeled bins', rootAssemblyId);
  const minimal = values.maxComponents !== undefined && values.maxComponents <= 7;
  const classify = capabilities.includes('classify');
  const contain = capabilities.includes('contain');
  const frame = minimal ? null : builder.component('frame', 'four-leg conveyor support', assembly, [-.7, .48, 0], [5.9, .82, 1.7], 'steel', 'fixed', { conveyor_frame: true });
  const conveyor = builder.component('conveyor', 'powered rubber belt conveyor', assembly, [-.7, .92, 0], [5.5, .24, 1.32], 'steel', 'fixed', { target_throughput: values.throughput, industrial_conveyor: true });
  if (frame) builder.joint('fixed', frame, conveyor);
  let driveJoint: string | undefined;
  if (!minimal) {
    for (let index = 0; index < 3; index += 1) {
      const roller = builder.component('roller', `belt roller ${index + 1}`, assembly, [-2.65 + index * 1.85, .91, 0], [.2, 1.2, .2], 'steel', 'dynamic', { conveyor_roller: true });
      driveJoint = builder.joint('revolute', frame!, roller, [0, 0, 1]);
    }
  }
  const motor = builder.component('motor', 'geared conveyor drive motor', assembly, [-3.15, .62, -.95], [.48, .62, .48], 'steel', 'kinematic', { geared_motor: true });
  builder.motor(motor, driveJoint, Math.max(22, values.throughput), Math.max(72, values.throughput * 3.25));
  builder.connect(motor, conveyor, 'power', 'transport_power');
  const sensorBody = builder.component(classify ? 'camera' : 'sensor', classify ? 'red-blue vision portal' : 'occupancy sensor', assembly, [-1.35, 1.65, 0], [.38, .34, .38], 'polymer', 'fixed', { sorting_sensor: classify });
  const sensor = builder.sensor(sensorBody, classify ? 'camera' : 'presence', classify ? 'item_class' : 'queue_presence', conveyor, 3);
  builder.connect(sensorBody, conveyor, 'signal', 'flow_observation');
  const actuatorIds: string[] = [];
  if (classify) {
    const router = builder.component('beam', 'servo sorting diverter', assembly, [1.15, 1.1, 0], [1.25, .16, .22], 'aluminum', 'dynamic', { sorting_diverter: true });
    const routerJoint = builder.joint('revolute', conveyor, router, [0, 1, 0], { limits: [-.75, .75] });
    const diverterServo = builder.component('servo', 'sorting gate servo', assembly, [1.05, .68, -.78], [.36, .34, .36], 'aluminum', 'kinematic');
    actuatorIds.push(builder.actuator(diverterServo, routerJoint, 'servo', 330, 2.2, 1.5));
    const rampA = builder.component('ramp', 'red output chute', assembly, [2.45, .72, -.9], [2.25, .14, .86], 'aluminum', 'fixed', { sorting_chute: true, route_color: 'red' });
    builder.rotate(rampA, [0, .48, -.08]);
    builder.connect(conveyor, rampA, 'mechanical', 'output_path');
    let rampB = conveyor;
    if (!minimal) {
      rampB = builder.component('ramp', 'blue output chute', assembly, [2.45, .72, .9], [2.25, .14, .86], 'aluminum', 'fixed', { sorting_chute: true, route_color: 'blue' });
      builder.rotate(rampB, [0, -.48, -.08]);
      builder.connect(conveyor, rampB, 'mechanical', 'alternate_path');
    }
    if (contain) {
      const binA = builder.component('container', 'red collection bin', assembly, [3.65, .5, -1.85], [1.25, .95, 1.15], 'polymer', 'fixed', { sorting_bin: true, route_color: 'red' }, 18);
      const binB = builder.component('container', 'blue collection bin', assembly, [3.65, .5, 1.85], [1.25, .95, 1.15], 'polymer', 'fixed', { sorting_bin: true, route_color: 'blue' }, 18);
      builder.connect(rampA, binA, 'mechanical', 'collection_path');
      builder.connect(rampB, binB, 'mechanical', 'collection_path');
    }
    builder.component('container', 'red shipping carton', assembly, [-2.25, 1.3, -.18], [.68, .56, .62], 'polymer', 'dynamic', { product_form: 'package-red' }, 4.2);
    builder.component('container', 'blue shipping carton', assembly, [-.55, 1.3, .16], [.68, .56, .62], 'polymer', 'dynamic', { product_form: 'package-blue' }, 4.2);
  }
  if (!minimal) {
    const controller = builder.component('controller', 'sorter control cabinet', assembly, [.2, .62, -1.15], [.62, .76, .42], 'polymer', 'fixed', { control_cabinet: true });
    builder.connect(controller, motor, 'signal', 'drive_command');
  }
  builder.control('flow routing', classify ? 'state-machine' : 'threshold', [sensor], actuatorIds, classify ? 'classify then route without stopping transport' : 'meter flow when occupancy rises', values.throughput);
  return { id: 'material-flow', mountId: frame ?? conveyor, editableId: sensorBody, handles: ['transport', 'classify', 'buffer', 'contain'] };
}

function addTrackingAxis(context: ModuleContext): ModuleResult {
  const { builder, rootAssemblyId } = context;
  const assembly = builder.assembly('ground-mounted solar tracker', 'Concrete foundation, bolted pedestal, bearing yoke, visible pivot axle, framed photovoltaic array, single geared actuator, and panel-mounted light sensing', rootAssemblyId);
  const foundation = builder.component('support', 'cast concrete tracker footing', assembly, [0, .2, 0], [2.75, .4, 2.15], 'concrete', 'fixed', { tracker_foundation: true, ground_contact: true }, 360);
  const basePlate = builder.component('plate', 'four-bolt steel pedestal plate', assembly, [0, .46, 0], [1.38, .12, 1.12], 'steel', 'fixed', { fixture_plate: true, anchored_base: true }, 28);
  const mast = builder.component('beam', 'grounded tracker pedestal', assembly, [0, 1.5, 0], [.46, 1.98, .46], 'steel', 'fixed', { hollow_section: true, grounded_structure: true });
  builder.joint('fixed', foundation, basePlate); builder.joint('fixed', basePlate, mast);
  const braceEndpoints: Array<[Vec3, Vec3]> = [
    [[-.52, .52, -.42], [-.16, 1.03, -.16]], [[-.52, .52, .42], [-.16, 1.03, .16]],
    [[.52, .52, -.42], [.16, 1.03, -.16]], [[.52, .52, .42], [.16, 1.03, .16]],
  ];
  braceEndpoints.forEach(([start, end], index) => {
    const brace = builder.member('beam', `pedestal foundation brace ${index + 1}`, assembly, start, end, .075, 'steel', 'fixed', { tracker_brace: true, grounded_structure: true });
    builder.connect(basePlate, brace, 'mechanical', 'foundation_brace'); builder.connect(brace, mast, 'mechanical', 'mast_stiffener');
  });
  const yokeBridge = builder.component('beam', 'pedestal bearing crosshead', assembly, [0, 2.34, 0], [.34, .24, 1.68], 'steel', 'fixed', { tracker_crosshead: true });
  builder.joint('fixed', mast, yokeBridge);
  const leftYoke = builder.component('beam', 'left bearing yoke', assembly, [0, 2.5, -.72], [.28, .48, .28], 'steel', 'fixed', { tracker_yoke: true });
  const rightYoke = builder.component('beam', 'right bearing yoke', assembly, [0, 2.5, .72], [.28, .48, .28], 'steel', 'fixed', { tracker_yoke: true });
  builder.joint('fixed', yokeBridge, leftYoke); builder.joint('fixed', yokeBridge, rightYoke);
  const axle = builder.component('shaft', 'solar array pivot axle', assembly, [0, 2.6, 0], [.2, 1.78, .2], 'steel', 'dynamic', { solar_pivot_axle: true, solar_moving: true }, 9.2);
  builder.rotate(axle, [Math.PI / 2, 0, 0]);
  const hinge = builder.joint('revolute', yokeBridge, axle, [0, 0, 1], { limits: [-1.05, 1.05], anchorA: [0, .26, 0], anchorB: [0, 0, 0] });
  const crossRail = builder.component('beam', 'solar array cross rail', assembly, [0, 2.6, 0], [3.3, .18, .2], 'aluminum', 'dynamic', { solar_rail: true, solar_moving: true });
  const panel = builder.component('plate', 'tracked panel', assembly, [0, 2.69, 0], [3.55, .13, 2.15], 'composite', 'dynamic', { panel: true, solar_array: true, solar_moving: true });
  builder.joint('fixed', axle, crossRail); builder.joint('fixed', crossRail, panel);
  const servo = builder.component('servo', 'single geared tracking actuator', assembly, [-.48, 2.13, -.48], [.46, .42, .46], 'steel', 'kinematic', { tracker_drive: true });
  const actuator = builder.actuator(servo, hinge, 'servo', 700, .7, 2.5);
  const driveLink = builder.member('beam', 'actuator torque link', assembly, [-.44, 2.25, -.38], [-.74, 2.6, -.38], .09, 'steel', 'fixed', { tracker_drive_link: true });
  builder.connect(servo, driveLink, 'mechanical', 'actuator_crank'); builder.connect(driveLink, crossRail, 'mechanical', 'array_torque_link');
  const sensorBody = builder.component('sensor', 'panel-mounted dual light sensor', assembly, [-1.25, 2.8, 0], [.24, .18, .24], 'polymer', 'dynamic', { solar_moving: true, dual_light_sensor: true });
  builder.joint('fixed', panel, sensorBody);
  const sensor = builder.sensor(sensorBody, 'light', 'light_error', panel, 10);
  const lightTarget = builder.component('light', 'simulated moving sun', assembly, [4.2, 5.2, -2.2], [.52, .38, .38], 'aluminum', 'fixed', { solar_source: true, beam_range: 7 }, .4);
  builder.control('light tracking', 'tracking', [sensor], [actuator], 'drive light error toward zero inside hinge limits', 0);
  builder.connect(sensorBody, servo, 'signal', 'tracking_error');
  builder.connect(lightTarget, sensorBody, 'signal', 'incident_light_direction');
  return { id: 'tracking-axis', mountId: foundation, editableId: sensorBody, handles: ['track', 'rotate', 'measure'], driveId: servo, outputId: panel };
}

function addReciprocatingLinkage(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('reciprocating linkage', 'Crank, connecting link, slider, chamber, and constructed check valves', rootAssemblyId);
  const base = builder.component('frame', 'reciprocating base', assembly, [0, .18, 0], [4.6, .26, 2.2], 'steel', 'fixed');
  const shaft = builder.component('shaft', 'crank shaft', assembly, [-1.25, 1.25, 0], [.18, 1.2, .18], 'steel', 'dynamic');
  const shaftJoint = builder.joint('revolute', base, shaft, [0, 0, 1]);
  const flywheel = builder.component('wheel', 'flywheel', assembly, [-1.25, 1.25, 0], [1.15, .22, 1.15], 'steel', 'dynamic', { crank_radius: values.strokeM / 2 });
  builder.joint('fixed', shaft, flywheel);
  const slider = builder.component('piston', 'reciprocating plunger', assembly, [.65, 1.25, 0], [.45, Math.max(.6, values.strokeM), .45], 'steel', 'dynamic', { bore_m: .45, stroke_m: values.strokeM });
  const slideJoint = builder.joint('prismatic', base, slider, [1, 0, 0], { limits: [0, values.strokeM] });
  const rod = builder.component('beam', 'connecting rod', assembly, [-.2, 1.25, 0], [1.7, .16, .16], 'steel', 'dynamic');
  builder.joint('spherical', flywheel, rod, [0, 0, 1]); builder.joint('spherical', rod, slider, [0, 0, 1]);
  const chamber = builder.component('container', 'pump chamber', assembly, [1.25, 1.25, 0], [1.25, .85, 1], 'aluminum', 'fixed', { chamber_l: 18 });
  builder.connect(slider, chamber, 'mechanical', 'displacement_chamber');
  for (const side of [-1, 1]) {
    const valve = builder.component('plate', side < 0 ? 'inlet valve plate' : 'outlet valve plate', assembly, [1.25, 1.25, side * .68], [.38, .08, .38], 'polymer', 'dynamic');
    const spring = builder.component('spring', side < 0 ? 'inlet valve spring' : 'outlet valve spring', assembly, [1.25, 1.48, side * .68], [.08, .34, .08], 'steel', 'dynamic', { stiffness: 3200, damping: 260 });
    builder.joint('prismatic', chamber, valve, [0, 0, side], { limits: [0, .08] });
    builder.connect(spring, valve, 'mechanical', 'check_valve_return');
  }
  const motor = builder.component('motor', 'crank drive motor', assembly, [-2, 1.25, 0], undefined, undefined, 'kinematic');
  builder.motor(motor, shaftJoint, Math.max(30, values.flowRateLpm * 1.8), Math.max(45, values.rpm * .62));
  const actuator = builder.actuator(slider, slideJoint, 'piston', Math.max(900, values.flowRateLpm * 42), Math.max(.25, values.strokeM), values.strokeM);
  const sensorBody = builder.component('sensor', 'stroke position sensor', assembly, [.65, 1.75, 0], undefined, undefined, 'fixed');
  const sensor = builder.sensor(sensorBody, 'position', 'plunger_position', slider, values.strokeM + .5);
  builder.control('stroke timing', 'pid', [sensor], [actuator], 'phase the plunger with crank angle and valve state', values.strokeM);
  builder.connect(motor, shaft, 'power', 'crank_torque'); builder.connect(sensorBody, motor, 'signal', 'stroke_feedback');
  return { id: 'reciprocating-linkage', mountId: base, editableId: sensorBody, handles: ['rotate', 'contain', 'measure'] };
}

function addFourBar(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('closed linkage', 'Four rigid links and revolute pairs built from lower-level members', rootAssemblyId);
  const base = builder.component('beam', 'ground link', assembly, [0, .35, 0], [2.8, .22, .28], 'steel', 'fixed');
  const input = builder.component('beam', 'input crank', assembly, [-1.1, 1.05, 0], [1.4, .18, .22], 'aluminum', 'dynamic');
  const coupler = builder.component('beam', 'coupler link', assembly, [0, 1.7, 0], [2.2, .18, .22], 'aluminum', 'dynamic');
  const output = builder.component('beam', 'output rocker', assembly, [1.1, 1.05, 0], [1.4, .18, .22], 'aluminum', 'dynamic');
  const inputJoint = builder.joint('revolute', base, input, [0, 0, 1], { limits: [-Math.PI, Math.PI] });
  builder.joint('revolute', input, coupler, [0, 0, 1]); builder.joint('revolute', coupler, output, [0, 0, 1]); builder.joint('revolute', output, base, [0, 0, 1], { limits: [-values.angleDeg * Math.PI / 180, values.angleDeg * Math.PI / 180] });
  if (values.supplied.has('strokeM')) {
    const follower = builder.component('piston', 'linear output follower', assembly, [1.9, 1.05, 0], [.24, Math.max(.5, values.strokeM), .24], 'steel', 'dynamic', { stroke_m: values.strokeM });
    builder.joint('prismatic', base, follower, [1, 0, 0], { limits: [0, values.strokeM] });
    builder.connect(output, follower, 'mechanical', 'rocker_to_slider');
  }
  const motor = builder.component('motor', 'linkage drive motor', assembly, [-1.4, .65, -.35], undefined, undefined, 'kinematic');
  builder.motor(motor, inputJoint, Math.max(35, values.torqueNm * .55), Math.max(40, values.rpm * .65));
  const sensorBody = builder.component('sensor', 'rocker angle encoder', assembly, [1.35, 1.55, 0], undefined, undefined, 'fixed');
  const sensor = builder.sensor(sensorBody, 'angle', 'rocker_angle', output, 3);
  builder.control('linkage position', 'pid', [sensor], [], 'hold the output rocker inside the requested angular envelope', values.angleDeg);
  builder.connect(sensorBody, motor, 'signal', 'angle_feedback');
  return { id: 'closed-linkage', mountId: base, editableId: sensorBody, handles: ['rotate'] };
}

function addBenchVise(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('screw-driven bench vise', 'Bolted swivel base, cast fixed and sliding jaws, replaceable serrated jaw plates, lead screw, thrust collar, and handwheel', rootAssemblyId);
  const travel = values.supplied.has('strokeM') ? Math.min(.45, Math.max(.04, values.strokeM)) : .18;
  const base = builder.component('frame', 'bolted vise swivel base', assembly, [0, .2, 0], [3.4, .34, 2.2], 'steel', 'fixed', { vise_base: true }, 24);
  const fixedJaw = builder.component('support', 'cast fixed vise jaw', assembly, [-.92, 1.03, 0], [.58, 1.35, 1.7], 'steel', 'fixed', { vise_fixed_jaw: true }, 18);
  const fixedPlate = builder.component('plate', 'replaceable fixed serrated jaw plate', assembly, [-.6, 1.34, 0], [.08, .48, 1.5], 'steel', 'fixed', { vise_jaw_plate: true, jaw_side: 'fixed' }, 1.1);
  builder.joint('fixed', base, fixedJaw); builder.joint('fixed', fixedJaw, fixedPlate);

  const slide = builder.component('beam', 'rectangular vise slide', assembly, [.32, .63, 0], [1.95, .32, .68], 'steel', 'kinematic', { vise_moving: true, vise_travel_m: travel }, 11);
  const movingJaw = builder.component('support', 'cast moving vise jaw', assembly, [.38, 1.03, 0], [.62, 1.35, 1.7], 'steel', 'kinematic', { vise_moving: true, vise_moving_jaw: true, vise_travel_m: travel }, 17);
  const movingPlate = builder.component('plate', 'replaceable moving serrated jaw plate', assembly, [.04, 1.34, 0], [.08, .48, 1.5], 'steel', 'kinematic', { vise_moving: true, vise_jaw_plate: true, jaw_side: 'moving', vise_travel_m: travel }, 1.1);
  const slideJoint = builder.joint('prismatic', base, slide, [1, 0, 0], { limits: [0, travel] });
  builder.joint('fixed', slide, movingJaw); builder.joint('fixed', movingJaw, movingPlate);

  const leadScrew = builder.component('shaft', 'Acme-thread lead screw', assembly, [.42, .66, 0], [.15, 2.55, .15], 'steel', 'dynamic', { cad_form: 'shaft', vise_screw: true, operation_spin: 2.4 }, 4.2);
  builder.rotate(leadScrew, [0, 0, Math.PI / 2]);
  const screwJoint = builder.joint('revolute', base, leadScrew, [1, 0, 0]);
  const thrustCollar = builder.component('gear', 'lead-screw thrust collar', assembly, [1.4, .66, 0], [.42, .16, .42], 'steel', 'dynamic', { teeth: 18, vise_screw: true }, 1.4);
  builder.joint('fixed', leadScrew, thrustCollar);
  const handwheel = builder.component('wheel', 'sliding vise handwheel', assembly, [1.72, .66, 0], [.8, .14, .8], 'steel', 'dynamic', { vise_screw: true }, 2.1);
  builder.rotate(handwheel, [0, 0, Math.PI / 2]); builder.joint('fixed', leadScrew, handwheel);
  const handle = builder.component('beam', 'handwheel tommy bar', assembly, [1.72, .66, 0], [.12, 1.18, .12], 'steel', 'dynamic', { vise_screw: true }, .8);
  builder.joint('fixed', handwheel, handle);
  builder.connect(leadScrew, slide, 'mechanical', 'acme_thread_drive');
  const torqueDriver = builder.component('motor', 'removable lead-screw torque driver', assembly, [1.42, .66, -.42], [.34, .42, .34], 'steel', 'kinematic', { vise_test_drive: true }, 3.2);
  const actuator = builder.actuator(torqueDriver, slideJoint, 'linear', Math.max(9000, values.forceN * .45), .08, travel);
  const positionBody = builder.component('sensor', 'vise jaw opening scale', assembly, [-.1, .48, -.62], [.28, .16, .18], 'polymer', 'fixed', { vise_scale: true }, .18);
  const positionSensor = builder.sensor(positionBody, 'position', 'jaw_opening', movingJaw, travel + .3);
  builder.control('vise jaw position', 'pid', [positionSensor], [actuator], 'convert handwheel rotation into lead-screw jaw travel without exceeding the slide limit', travel);
  const jawControl = builder.controls.at(-1);
  if (jawControl) { jawControl.kp = .9; jawControl.kd = .12; }
  builder.connect(positionBody, leadScrew, 'signal', 'jaw_position_feedback');
  // A small removable torque driver makes the manual screw testable in the
  // deterministic physics lab without replacing the visible handwheel.
  builder.motor(torqueDriver, screwJoint, 65, 24); builder.connect(torqueDriver, leadScrew, 'power', 'lead_screw_test_torque');
  return { id: 'bench-vise', mountId: base, editableId: movingPlate, handles: ['structure', 'rotate', 'measure'], driveId: handwheel, outputId: movingJaw };
}

function addBottleJack(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('hydraulic bottle jack', 'Wide load-rated base, oil reservoir, pump cylinder and handle, guided ram, threaded extension, lifting saddle, release valve, and pressure sensing', rootAssemblyId);
  const travel = values.supplied.has('liftM') ? Math.min(.65, Math.max(.12, values.liftM)) : .3;
  const base = builder.component('plate', 'wide bottle-jack base', assembly, [0, .12, 0], [2.1, .22, 1.65], 'steel', 'fixed', { bottle_jack_base: true }, 12);
  const reservoir = builder.component('frame', 'hydraulic oil reservoir body', assembly, [0, .72, 0], [1.18, 1.2, 1.18], 'steel', 'fixed', { cad_form: 'housing', bottle_jack_body: true }, 14);
  const cylinder = builder.component('piston', 'main hydraulic cylinder', assembly, [0, 1.25, 0], [.72, 1.7, .72], 'steel', 'fixed', { bottle_jack_cylinder: true, rated_load_kg: values.payloadKg }, 18);
  builder.joint('fixed', base, reservoir); builder.joint('fixed', reservoir, cylinder);
  const ram = builder.component('piston', 'guided lifting ram', assembly, [0, 1.86, 0], [.42, 1.26, .42], 'steel', 'kinematic', { bottle_jack_ram: true, bottle_jack_moving: true, operation_travel: travel, payload_kg: values.payloadKg }, 8.5);
  const ramJoint = builder.joint('prismatic', cylinder, ram, [0, 1, 0], { limits: [0, travel] });
  const extension = builder.component('shaft', 'threaded saddle extension', assembly, [0, 2.42, 0], [.25, .62, .25], 'steel', 'kinematic', { cad_form: 'shaft', bottle_jack_moving: true, operation_travel: travel }, 2.4);
  const saddle = builder.component('plate', 'serrated lifting saddle', assembly, [0, 2.78, 0], [.86, .16, .86], 'steel', 'kinematic', { bottle_jack_moving: true, bottle_jack_saddle: true, operation_travel: travel, payload_kg: values.payloadKg }, 4.5);
  builder.joint('fixed', ram, extension); builder.joint('fixed', extension, saddle);

  const pumpCylinder = builder.component('piston', 'side hydraulic pump cylinder', assembly, [.72, .68, 0], [.28, .74, .28], 'steel', 'fixed', { bottle_jack_pump: true }, 2.8);
  builder.joint('fixed', base, pumpCylinder);
  const handle = builder.component('beam', 'removable pump handle', assembly, [1.28, 1.2, 0], [1.85, .16, .16], 'steel', 'dynamic', { bottle_jack_handle: true }, 1.6);
  builder.rotate(handle, [0, 0, .62]);
  const handleJoint = builder.joint('revolute', pumpCylinder, handle, [0, 0, 1], { limits: [-.72, .18] });
  const handleDrive = builder.component('servo', 'manual pump stroke driver', assembly, [.68, .78, -.25], [.3, .28, .3], 'steel', 'kinematic', { bottle_jack_handle_drive: true }, 1.5);
  builder.actuator(handleDrive, handleJoint, 'servo', 620, .8, .09);
  const ramActuator = builder.actuator(pumpCylinder, ramJoint, 'piston', Math.max(18000, values.payloadKg * 9.81 * 1.85), .12, travel);
  const releaseValve = builder.component('wheel', 'hydraulic release valve knob', assembly, [-.62, .55, .42], [.32, .1, .32], 'steel', 'fixed', { bottle_jack_release: true }, .45);
  builder.connect(releaseValve, reservoir, 'mechanical', 'return_valve');
  const pressureBody = builder.component('sensor', 'jack pressure and overload sensor', assembly, [-.5, .82, -.45], [.24, .18, .24], 'polymer', 'fixed', { bottle_jack_pressure_sensor: true }, .2);
  const pressureSensor = builder.sensor(pressureBody, 'load', 'jack_load', saddle, 3);
  builder.control('hydraulic lift control', 'threshold', [pressureSensor], [ramActuator], 'extend the guided ram only while measured load remains below the jack rating', values.payloadKg);
  const liftControl = builder.controls.at(-1);
  if (liftControl) { liftControl.kp = .76; liftControl.kd = .12; }
  builder.connect(pressureBody, pumpCylinder, 'signal', 'hydraulic_pressure_feedback');
  return { id: 'bottle-jack', mountId: base, editableId: saddle, handles: ['lift', 'stabilize', 'measure'], driveId: pumpCylinder, outputId: saddle };
}

function addWindYawDrive(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('wind-turbine yaw system', 'Grounded tower, slewing yaw bearing, nacelle, geared yaw actuator, wind vane feedback, drivetrain shaft, hub, and three aerodynamic blades', rootAssemblyId);
  const foundation = builder.component('support', 'reinforced turbine foundation', assembly, [0, .16, 0], [2.6, .32, 2.6], 'concrete', 'fixed', { wind_turbine_foundation: true }, 420);
  const tower = builder.component('beam', 'tapered wind-turbine tower', assembly, [0, 2.15, 0], [.7, 4.05, .7], 'steel', 'fixed', { wind_turbine_tower: true }, 185);
  builder.joint('fixed', foundation, tower);
  const yawRing = builder.component('gear', 'slewing yaw bearing ring', assembly, [0, 4.24, 0], [1.45, .22, 1.45], 'steel', 'kinematic', { teeth: 72, wind_yaw_moving: true, wind_yaw_bearing: true, wind_yaw_local_x: 0, wind_yaw_local_z: 0 }, 38);
  const yawJoint = builder.joint('revolute', tower, yawRing, [0, 1, 0], { limits: [-Math.PI, Math.PI] });
  const nacelle = builder.component('frame', 'wind-turbine nacelle housing', assembly, [0, 4.58, .22], [2.45, .72, 1.22], 'aluminum', 'kinematic', { cad_form: 'housing', wind_yaw_moving: true, wind_nacelle: true, wind_yaw_local_x: 0, wind_yaw_local_z: .22 }, 92);
  builder.joint('fixed', yawRing, nacelle);
  const yawServo = builder.component('servo', 'geared electric yaw drive', assembly, [-.66, 4.15, -.48], [.46, .5, .46], 'steel', 'kinematic', { wind_yaw_moving: true, wind_yaw_drive: true, wind_yaw_local_x: -.66, wind_yaw_local_z: -.48 }, 14);
  const yawActuator = builder.actuator(yawServo, yawJoint, 'servo', 18000, .32, Math.PI * 2);
  builder.joint('fixed', yawRing, yawServo);
  builder.connect(yawServo, yawRing, 'power', 'yaw_ring_torque');

  const rotorShaft = builder.component('shaft', 'main rotor shaft', assembly, [0, 4.58, 1.05], [.22, 1.48, .22], 'steel', 'dynamic', { wind_yaw_moving: true, wind_rotor_shaft: true, wind_yaw_local_x: 0, wind_yaw_local_z: 1.05 }, 18);
  builder.rotate(rotorShaft, [Math.PI / 2, 0, 0]);
  const rotorJoint = builder.joint('revolute', nacelle, rotorShaft, [0, 0, 1]);
  const hub = builder.component('wheel', 'three-blade rotor hub', assembly, [0, 4.58, 1.7], [.82, .28, .82], 'steel', 'dynamic', { cad_form: 'rotor_hub', wind_yaw_moving: true, wind_rotor_hub: true, wind_yaw_local_x: 0, wind_yaw_local_z: 1.7 }, 21);
  builder.joint('fixed', rotorShaft, hub);
  for (let index = 0; index < 3; index += 1) {
    const angle = index / 3 * Math.PI * 2 + Math.PI / 2;
    const radius = 1.18;
    const blade = builder.component('beam', `aerodynamic turbine blade ${index + 1}`, assembly, [Math.cos(angle) * radius, 4.58 + Math.sin(angle) * radius, 1.72], [1.95, .2, .34], 'composite', 'dynamic', { cad_form: 'aero_blade', wind_yaw_moving: true, wind_rotor_blade: true, wind_rotor_angle: angle, wind_rotor_radius: radius, wind_yaw_local_x: Math.cos(angle) * radius, wind_yaw_local_z: 1.72, blade_index: index, blade_count: 3 }, 8.5);
    builder.rotate(blade, [0, 0, angle]); builder.joint('fixed', hub, blade);
  }
  const generator = builder.component('motor', 'nacelle generator', assembly, [0, 4.58, -.52], [.62, .86, .62], 'steel', 'kinematic', { wind_yaw_moving: true, wind_generator: true, wind_yaw_local_x: 0, wind_yaw_local_z: -.52 }, 44);
  builder.rotate(generator, [Math.PI / 2, 0, 0]); builder.motor(generator, rotorJoint, Math.max(120, values.torqueNm * 2.4), Math.max(18, values.rpm));
  builder.joint('fixed', nacelle, generator);
  builder.connect(rotorShaft, generator, 'power', 'generator_drive');
  const vaneBody = builder.component('sensor', 'nacelle wind-direction vane', assembly, [0, 5.15, -.45], [.3, .22, .3], 'polymer', 'kinematic', { wind_yaw_moving: true, wind_vane: true, wind_yaw_local_x: 0, wind_yaw_local_z: -.45 }, .5);
  builder.joint('fixed', nacelle, vaneBody);
  const windSensor = builder.sensor(vaneBody, 'angle', 'wind_direction_error', nacelle, 12);
  builder.control('wind alignment yaw control', 'tracking', [windSensor], [yawActuator], 'rotate the nacelle until rotor heading aligns with the measured wind direction', 0);
  const yawControl = builder.controls.at(-1);
  if (yawControl) { yawControl.kp = 1.05; yawControl.kd = .12; }
  builder.connect(vaneBody, yawServo, 'signal', 'yaw_error');
  return { id: 'wind-yaw-drive', mountId: foundation, editableId: vaneBody, handles: ['track', 'rotate', 'measure'], driveId: yawServo, outputId: hub };
}

function addDrillPress(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('bench drill press', 'Bolted base, rigid column, adjustable work table, cast head, sliding quill, motor-driven spindle, chuck, drill bit, feed handle, and depth stop', rootAssemblyId);
  const stroke = values.supplied.has('strokeM') ? Math.min(.32, Math.max(.04, values.strokeM)) : .16;
  const base = builder.component('plate', 'cast drill-press base', assembly, [0, .14, 0], [3.15, .28, 2.35], 'steel', 'fixed', { drill_press_base: true }, 34);
  const column = builder.component('shaft', 'rigid drill-press column', assembly, [-.78, 1.86, 0], [.34, 3.35, .34], 'steel', 'fixed', { drill_press_column: true }, 27);
  builder.joint('fixed', base, column);
  const tableArm = builder.component('beam', 'height-adjustable table arm', assembly, [-.18, 1.5, 0], [1.32, .22, .26], 'steel', 'fixed', { drill_press_table_arm: true }, 7);
  const table = builder.component('plate', 'slotted drill work table', assembly, [.55, 1.48, 0], [1.75, .18, 1.55], 'steel', 'fixed', { fixture_plate: true, drill_press_table: true }, 17);
  builder.joint('fixed', column, tableArm); builder.joint('fixed', tableArm, table);
  const head = builder.component('frame', 'cast drill-press head', assembly, [-.12, 3.36, 0], [2.15, .78, 1.18], 'steel', 'fixed', { cad_form: 'housing', drill_press_head: true }, 42);
  builder.joint('fixed', column, head);
  const quill = builder.component('frame', 'sliding spindle quill', assembly, [.66, 2.95, 0], [.5, .82, .5], 'steel', 'kinematic', { drill_press_quill: true, drill_press_moving: true, operation_travel: stroke }, 8);
  const quillJoint = builder.joint('prismatic', head, quill, [0, -1, 0], { limits: [0, stroke] });
  const spindle = builder.component('shaft', 'precision drill spindle', assembly, [.66, 2.73, 0], [.17, 1.18, .17], 'steel', 'dynamic', { drill_press_spindle: true, drill_press_moving: true, operation_travel: stroke }, 3.8);
  const spindleJoint = builder.joint('revolute', quill, spindle, [0, 1, 0]);
  const chuck = builder.component('gear', 'three-jaw drill chuck', assembly, [.66, 2.22, 0], [.48, .38, .48], 'steel', 'dynamic', { teeth: 18, drill_press_chuck: true, drill_press_moving: true, operation_travel: stroke }, 2.2);
  const bit = builder.component('shaft', 'twist drill bit', assembly, [.66, 1.82, 0], [.1, .78, .1], 'steel', 'dynamic', { cad_form: 'shaft', drill_press_bit: true, drill_press_moving: true, operation_travel: stroke }, .45);
  builder.joint('fixed', spindle, chuck); builder.joint('fixed', chuck, bit);
  const driveMotor = builder.component('motor', 'belt-driven drill motor', assembly, [-.65, 3.52, 0], [.68, .9, .68], 'steel', 'kinematic', { drill_press_motor: true }, 18);
  builder.motor(driveMotor, spindleJoint, Math.max(38, values.torqueNm), Math.max(240, values.rpm)); builder.connect(driveMotor, spindle, 'power', 'spindle_drive');
  const feedHandle = builder.component('beam', 'three-spoke quill feed handle', assembly, [1.12, 3.0, -.46], [1.15, .12, .12], 'steel', 'dynamic', { drill_press_feed_handle: true }, 1.2);
  const feedJoint = builder.joint('revolute', head, feedHandle, [0, 0, 1], { limits: [-.8, .35] });
  const feedServo = builder.component('servo', 'controlled quill feed', assembly, [1.02, 3.0, -.24], [.34, .3, .34], 'steel', 'kinematic', { drill_press_feed_drive: true }, 1.4);
  builder.actuator(feedServo, feedJoint, 'servo', 240, .9, 1.15);
  const quillActuator = builder.actuator(feedServo, quillJoint, 'linear', 1800, .12, stroke);
  const workpiece = builder.component('plate', 'clamped drill workpiece', assembly, [.66, 1.67, 0], [1.0, .18, .82], 'aluminum', 'fixed', { drill_press_workpiece: true }, 3.2);
  builder.joint('fixed', table, workpiece);
  const depthBody = builder.component('sensor', 'adjustable drilling depth stop', assembly, [.92, 2.7, -.32], [.18, .34, .18], 'steel', 'fixed', { drill_press_depth_stop: true }, .4);
  const depthSensor = builder.sensor(depthBody, 'position', 'quill_depth', quill, stroke + .5);
  builder.control('spindle feed and depth control', 'pid', [depthSensor], [quillActuator], 'feed the rotating drill to the requested depth and retract before the quill limit', stroke);
  const feedControl = builder.controls.at(-1);
  if (feedControl) { feedControl.kp = .9; feedControl.kd = .12; }
  builder.connect(depthBody, feedServo, 'signal', 'depth_feedback');
  return { id: 'drill-press', mountId: base, editableId: table, handles: ['structure', 'rotate', 'measure'], driveId: driveMotor, outputId: bit };
}

function addRackSteering(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('rack-and-pinion steering rig', 'Steering wheel and column, pinion, guided toothed rack, power-assist drive, two tie rods, steering knuckles, hubs, wheels, and rack-position feedback', rootAssemblyId);
  const base = builder.component('frame', 'steering geometry test frame', assembly, [0, .2, 0], [3.7, .36, 3.1], 'steel', 'fixed', { steering_test_frame: true }, 72);
  const housing = builder.component('frame', 'steering rack housing', assembly, [.28, .8, 0], [2.25, .48, .68], 'aluminum', 'fixed', { cad_form: 'housing', steering_rack_housing: true }, 11);
  builder.joint('fixed', base, housing);
  const rack = builder.component('shaft', 'toothed steering rack', assembly, [.28, .83, 0], [.16, 2.75, .16], 'steel', 'kinematic', { cad_form: 'shaft', steering_rack: true, steering_rack_moving: true }, 5.8);
  builder.rotate(rack, [Math.PI / 2, 0, 0]);
  const rackJoint = builder.joint('prismatic', housing, rack, [0, 0, 1], { limits: [-.18, .18] });
  const pinion = builder.component('gear', 'steering pinion gear', assembly, [.28, 1.14, 0], [.48, .18, .48], 'steel', 'dynamic', { teeth: 18, steering_pinion: true }, 1.4);
  const pinionJoint = builder.joint('revolute', housing, pinion, [1, 0, 0]);
  builder.connect(pinion, rack, 'mechanical', 'rack_and_pinion_mesh');
  const column = builder.component('shaft', 'collapsible steering column', assembly, [-.48, 1.75, 0], [.15, 1.65, .15], 'steel', 'dynamic', { steering_column: true }, 3.2);
  builder.rotate(column, [0, 0, -.55]); builder.joint('fixed', pinion, column);
  const wheel = builder.component('wheel', 'driver steering wheel', assembly, [-.92, 2.33, 0], [.78, .1, .78], 'polymer', 'dynamic', { steering_input_wheel: true }, 1.1);
  builder.rotate(wheel, [0, 0, -.55]); builder.joint('fixed', column, wheel);
  const assist = builder.component('motor', 'electric power-steering assist motor', assembly, [.56, 1.18, -.38], [.42, .46, .42], 'steel', 'kinematic', { steering_assist: true }, 6.2);
  builder.motor(assist, pinionJoint, Math.max(45, values.torqueNm), 36);
  const rackActuator = builder.actuator(assist, rackJoint, 'linear', 5200, .28, .36);
  builder.connect(assist, pinion, 'power', 'pinion_assist_torque');
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'left' : 'right';
    const tie = builder.member('beam', `${sideName} steering tie rod`, assembly, [.28, .83, side * .9], [1.12, .72, side * 1.25], .11, 'steel', 'fixed', { steering_tie_rod: true, steering_side: sideName });
    const knuckle = builder.component('support', `${sideName} steering knuckle`, assembly, [1.25, .72, side * 1.32], [.28, .62, .28], 'steel', 'fixed', { steering_knuckle: true, steering_side: sideName }, 4.8);
    const roadWheel = builder.component('wheel', `${sideName} steered road wheel`, assembly, [1.35, .62, side * 1.5], [.9, .24, .9], 'rubber', 'dynamic', { steering_road_wheel: true, steering_side: sideName }, 7.5);
    builder.joint('fixed', base, tie); builder.joint('fixed', base, knuckle); builder.joint('revolute', knuckle, roadWheel, [0, 0, 1]);
    builder.connect(rack, tie, 'mechanical', `${sideName}_rack_ball_joint`); builder.connect(tie, knuckle, 'mechanical', `${sideName}_outer_ball_joint`);
  }
  const positionBody = builder.component('sensor', 'steering rack position sensor', assembly, [.28, .44, -.44], [.24, .18, .24], 'polymer', 'fixed', { steering_rack_sensor: true }, .2);
  const positionSensor = builder.sensor(positionBody, 'position', 'rack_travel', rack, 2);
  builder.control('steering position assist', 'pid', [positionSensor], [rackActuator], 'translate steering-wheel angle into bounded rack travel and coordinated left-right road-wheel angles', 0);
  const steeringControl = builder.controls.at(-1);
  if (steeringControl) { steeringControl.kp = .9; steeringControl.kd = .12; }
  builder.connect(positionBody, assist, 'signal', 'rack_position_feedback');
  return { id: 'rack-steering', mountId: base, editableId: wheel, handles: ['structure', 'rotate', 'measure'], driveId: assist, outputId: rack };
}

function addBicycleBrake(context: ModuleContext): ModuleResult {
  const { builder, rootAssemblyId } = context;
  const assembly = builder.assembly('bicycle disc brake', 'Fork test stand, rotating wheel and rotor, rigid caliper bridge, opposed pistons and pads, cable lever, force sensing, and closed-loop clamp control', rootAssemblyId);
  const stand = builder.component('frame', 'bicycle brake fork test stand', assembly, [0, .28, 0], [2.55, .42, 2.25], 'steel', 'fixed', { bicycle_brake_stand: true }, 32);
  const leftFork = builder.component('beam', 'left bicycle fork leg', assembly, [-.52, 1.48, -.42], [.22, 2.35, .22], 'aluminum', 'fixed', { bicycle_brake_fork: true }, 3.2);
  const rightFork = builder.component('beam', 'right bicycle fork leg', assembly, [-.52, 1.48, .42], [.22, 2.35, .22], 'aluminum', 'fixed', { bicycle_brake_fork: true }, 3.2);
  builder.joint('fixed', stand, leftFork); builder.joint('fixed', stand, rightFork);
  const axle = builder.component('shaft', 'bicycle wheel axle', assembly, [-.52, 1.18, 0], [.16, 1.22, .16], 'steel', 'dynamic', { bicycle_brake_axle: true }, 1.1);
  builder.rotate(axle, [Math.PI / 2, 0, 0]);
  const axleJoint = builder.joint('revolute', stand, axle, [0, 0, 1]);
  const rim = builder.component('wheel', 'spoked bicycle test wheel', assembly, [-.52, 1.18, 0], [1.8, .12, 1.8], 'rubber', 'dynamic', { bicycle_brake_wheel: true }, 2.8);
  const rotor = builder.component('gear', 'ventilated bicycle brake rotor', assembly, [-.52, 1.18, -.12], [.72, .035, .72], 'steel', 'dynamic', { teeth: 28, bicycle_brake_rotor: true, road_vehicle_brake: true }, .32);
  builder.joint('fixed', axle, rim); builder.joint('fixed', axle, rotor);
  const spinMotor = builder.component('motor', 'wheel spin test motor', assembly, [-.52, .58, .62], [.38, .48, .38], 'steel', 'kinematic', { bicycle_brake_test_motor: true }, 4.2);
  builder.motor(spinMotor, axleJoint, 28, 90); builder.connect(spinMotor, axle, 'power', 'wheel_test_drive');
  const caliper = builder.component('frame', 'rigid bicycle brake caliper', assembly, [.02, 1.3, -.12], [.72, .68, .42], 'aluminum', 'fixed', { cad_form: 'housing', bicycle_brake_caliper: true }, 1.4);
  builder.joint('fixed', leftFork, caliper);
  const actuators: string[] = [];
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? 'inboard' : 'outboard';
    const pad = builder.component('plate', `${sideName} bicycle brake pad`, assembly, [.02, 1.3, -.12 + side * .075], [.34, .38, .045], 'composite', 'kinematic', { bicycle_brake_pad: true, brake_pad_side: sideName }, .08);
    const padJoint = builder.joint('prismatic', caliper, pad, [0, 0, -side], { limits: [0, .045] });
    const piston = builder.component('piston', `${sideName} caliper piston`, assembly, [.02, 1.3, -.12 + side * .17], [.18, .28, .18], 'steel', 'kinematic', { bicycle_brake_piston: true, brake_pad_side: sideName }, .12);
    builder.rotate(piston, [Math.PI / 2, 0, 0]);
    actuators.push(builder.actuator(piston, padJoint, 'piston', 1200, .12, .045));
    builder.connect(piston, pad, 'mechanical', `${sideName}_pad_clamp`);
  }
  const leverMount = builder.component('support', 'handlebar lever mount', assembly, [1.1, 2.2, 0], [.36, .52, .36], 'aluminum', 'fixed', { bicycle_brake_lever_mount: true }, .6);
  builder.joint('fixed', stand, leverMount);
  const lever = builder.component('beam', 'bicycle brake hand lever', assembly, [1.45, 2.2, 0], [.82, .12, .16], 'aluminum', 'dynamic', { bicycle_brake_lever: true }, .22);
  builder.joint('revolute', leverMount, lever, [0, 0, 1], { limits: [-.48, .08] });
  const cable = builder.member('cable', 'bicycle brake control cable', assembly, [1.45, 2.2, 0], [.22, 1.62, -.12], .025, 'steel', 'kinematic', { bicycle_brake_cable: true });
  builder.connect(lever, cable, 'mechanical', 'lever_cable_pull'); builder.connect(cable, caliper, 'mechanical', 'caliper_input');
  const forceBody = builder.component('sensor', 'caliper clamp-force sensor', assembly, [.2, 1.58, -.32], [.2, .16, .2], 'polymer', 'fixed', { bicycle_brake_force_sensor: true }, .12);
  const forceSensor = builder.sensor(forceBody, 'force', 'brake_clamp_force', rotor, 2);
  builder.control('bicycle brake clamp control', 'threshold', [forceSensor], actuators, 'move both pads equally toward the rotor when the hand lever pulls the cable', 850);
  const brakeControl = builder.controls.at(-1);
  if (brakeControl) { brakeControl.kp = .9; brakeControl.kd = .12; }
  builder.connect(forceBody, lever, 'signal', 'brake_force_feedback');
  return { id: 'bicycle-brake', mountId: stand, editableId: lever, handles: ['structure', 'rotate', 'measure'], driveId: spinMotor, outputId: rotor };
}

function addGrainRollerMill(context: ModuleContext): ModuleResult {
  const { builder, rootAssemblyId } = context;
  const assembly = builder.assembly(
    'pedal-powered grain roller mill',
    'A rigid food-processing stand with a feed hopper, paired counter-rotating grinding rollers, pedal crank and flywheel, guards, bearings, and a collection chute',
    rootAssemblyId,
  );
  const base = builder.component('frame', 'grain mill floor stand', assembly, [0, .22, 0], [3.7, .36, 2.75], 'steel', 'fixed', { grain_mill_frame: true }, 76);
  const leftPedestal = builder.component('support', 'left roller bearing pedestal', assembly, [-.58, 1.18, 0], [.48, 1.72, 1.76], 'steel', 'fixed', { grain_mill_bearing: true }, 18);
  const rightPedestal = builder.component('support', 'right roller bearing pedestal', assembly, [.58, 1.18, 0], [.48, 1.72, 1.76], 'steel', 'fixed', { grain_mill_bearing: true }, 18);
  builder.joint('fixed', base, leftPedestal); builder.joint('fixed', base, rightPedestal);

  const leftRoller = builder.component('roller', 'left fluted grinding roller', assembly, [-.28, 1.48, 0], [.52, 1.44, .52], 'steel', 'dynamic', { grain_mill_roller: true, roller_side: 'left', operation_spin: 2.6 }, 11.5);
  const rightRoller = builder.component('roller', 'right fluted grinding roller', assembly, [.28, 1.48, 0], [.52, 1.44, .52], 'steel', 'dynamic', { grain_mill_roller: true, roller_side: 'right', operation_spin: -2.6 }, 11.5);
  builder.joint('revolute', leftPedestal, leftRoller, [0, 0, 1]);
  builder.joint('revolute', rightPedestal, rightRoller, [0, 0, 1]);
  builder.joint('gear', leftRoller, rightRoller, [0, 0, 1], { ratio: 1 });

  const hopper = builder.component('container', 'grain feed hopper', assembly, [0, 2.42, 0], [1.52, 1.15, 1.5], 'aluminum', 'fixed', { recycling_hopper: true, grain_hopper: true }, 16);
  builder.joint('fixed', leftPedestal, hopper);
  const nipGuard = builder.component('frame', 'transparent roller nip guard', assembly, [0, 1.55, .92], [1.55, .72, .12], 'polymer', 'fixed', { cad_form: 'housing', grain_roller_guard: true }, 3.2);
  builder.joint('fixed', rightPedestal, nipGuard);
  const outlet = builder.component('ramp', 'ground grain collection chute', assembly, [.12, .78, .08], [1.45, .18, 1.28], 'aluminum', 'fixed', { grain_outlet: true, route_color: 'orange' }, 7.5);
  builder.rotate(outlet, [0, 0, -.22]); builder.joint('fixed', base, outlet);

  const flywheelSupport = builder.component('support', 'flywheel outboard bearing bracket', assembly, [-1.22, 1.22, -.84], [.34, 1.5, .34], 'steel', 'fixed', { grain_flywheel_support: true }, 9.5);
  builder.joint('fixed', base, flywheelSupport);
  const flywheel = builder.component('wheel', 'large pedal drive flywheel', assembly, [-1.22, 1.52, -1.02], [1.34, .18, 1.34], 'steel', 'dynamic', { grain_mill_flywheel: true, operation_spin: -2.2 }, 24);
  const flywheelJoint = builder.joint('revolute', flywheelSupport, flywheel, [0, 0, 1]);
  builder.joint('belt', flywheel, leftRoller, [0, 0, 1], { ratio: 1.8 });
  const crank = builder.component('beam', 'pedal crank arm', assembly, [-1.22, 1.22, -1.18], [.82, .1, .12], 'steel', 'dynamic', { grain_pedal_crank: true }, 1.8);
  builder.joint('fixed', flywheel, crank);
  const pedal = builder.component('plate', 'non-slip pedal tread', assembly, [-.82, 1.22, -1.18], [.46, .12, .22], 'rubber', 'dynamic', { grain_pedal: true }, .8);
  builder.joint('fixed', crank, pedal);

  const inputDriver = builder.component('servo', 'instrumented pedal input driver', assembly, [-1.58, .62, -.72], [.42, .52, .42], 'steel', 'kinematic', { grain_pedal_driver: true }, 4.8);
  builder.joint('fixed', base, inputDriver);
  builder.connect(inputDriver, flywheel, 'power', 'pedal_torque_input');
  const drive = builder.actuator(inputDriver, flywheelJoint, 'rotary-motor', 520, 2.2, Math.PI * 2);
  // A second motor registration is unnecessary: the guarded rotary actuator
  // is the test-lab equivalent of a person pedaling and avoids two competing
  // velocity commands on the same physical joint.
  const speedBody = builder.component('sensor', 'grinding roller speed guard', assembly, [.82, 1.82, .7], [.22, .18, .22], 'polymer', 'fixed', { grain_speed_sensor: true }, .24);
  builder.joint('fixed', rightPedestal, speedBody);
  const speedSensor = builder.sensor(speedBody, 'speed', 'grinding_roller_rpm', leftRoller, 3);
  builder.control('grain mill roller interlock', 'threshold', [speedSensor], [drive], 'counter-rotate both guarded rollers only while the hopper and nip guard are in place', 60);
  const control = builder.controls.at(-1);
  if (control) { control.kp = .92; control.kd = .12; }

  return { id: 'grain-roller-mill', mountId: base, editableId: hopper, handles: ['structure', 'rotate', 'contain', 'measure'], driveId: inputDriver, outputId: outlet };
}

function addGenericMotion(context: ModuleContext): ModuleResult {
  const { builder, capabilities, values, rootAssemblyId } = context;
  const assembly = builder.assembly('constructed motion stage', 'Foundation, support, moving link, actuator, sensor, and controller assembled from primitives', rootAssemblyId);
  const base = builder.component('frame', 'constructed base', assembly, [0, .15, 0], [3.2, .25, 2.1], 'steel', 'fixed');
  const support = builder.component('beam', 'primary support', assembly, [-.8, 1.2, 0], [.3, 2.2, .3], 'steel', 'fixed');
  const link = builder.component('beam', capabilities.includes('rotate') ? 'rotating output link' : 'sliding output link', assembly, [.45, 2.1, 0], [2.4, .24, .24], 'aluminum', 'dynamic');
  builder.joint('fixed', base, support);
  const rotary = capabilities.includes('rotate');
  const motionJoint = builder.joint(rotary ? 'revolute' : 'prismatic', support, link, rotary ? [0, 0, 1] : [1, 0, 0], { limits: rotary ? [0, values.angleDeg * Math.PI / 180] : [0, values.strokeM] });
  const actuatorBody = builder.component(rotary ? 'servo' : 'piston', 'primary motion actuator', assembly, [-.4, 1.7, -.45], undefined, undefined, 'kinematic');
  const actuator = builder.actuator(actuatorBody, motionJoint, rotary ? 'servo' : 'linear', 1050, .8, rotary ? values.angleDeg * Math.PI / 180 : values.strokeM);
  const sensorBody = builder.component('sensor', 'output feedback sensor', assembly, [.2, 2.45, 0], undefined, undefined, 'fixed');
  const sensor = builder.sensor(sensorBody, rotary ? 'angle' : 'position', rotary ? 'output_angle' : 'output_position', link, 4);
  const controller = builder.component('controller', 'motion controller', assembly, [-.1, .55, -.7], undefined, undefined, 'fixed');
  builder.control('constructed motion', 'pid', [sensor], [actuator], 'drive measured output toward the requested motion envelope', rotary ? values.angleDeg : values.strokeM);
  builder.joint('fixed', sensorBody, support); builder.joint('fixed', controller, base); builder.connect(controller, actuatorBody, 'signal', 'actuator_command');
  return { id: 'constructed-motion', mountId: base, editableId: sensorBody, handles: rotary ? ['rotate', 'measure'] : ['measure'] };
}

function addCentrifugalPump(context: ModuleContext): ModuleResult {
  const { builder, text, values, rootAssemblyId } = context;
  const assembly = builder.assembly(
    'centrifugal process pump',
    'Skid-mounted volute casing with a visible motor-driven impeller, axial suction, tangential discharge, supported shaft, and duty-point instrumentation',
    rootAssemblyId,
  );
  const scale = Math.min(1.3, Math.max(.82, Math.pow(Math.max(5, values.flowRateLpm) / 50, .2)));
  const pumpRpm = values.supplied.has('rpm') ? Math.max(300, values.rpm) : 1800;
  const sx = (value: number) => Number((value * scale).toFixed(4));

  const base = builder.component('frame', 'pump and motor skid base', assembly, [0, .16, 0], [sx(4.2), .26, sx(3.8)], 'steel', 'fixed', { pump_skid: true, design_flow_lpm: values.flowRateLpm }, 44 * scale);
  const rearBearing = builder.component('support', 'rear shaft bearing pedestal', assembly, [0, sx(.92), sx(-.88)], [sx(.58), sx(1.5), sx(.66)], 'steel', 'fixed', { pump_bearing_support: true }, 11 * scale);
  builder.connect(base, rearBearing, 'mechanical', 'bearing_pedestal_mount');

  const casingBackplate = builder.component('plate', 'circular pump casing backplate', assembly, [0, sx(1.68), sx(-.22)], [sx(2.42), sx(2.42), .16], 'steel', 'fixed', { cad_form: 'flange', pump_casing: true, feature_holes: 8 }, 19 * scale);
  const volute = builder.component('frame', 'spiral volute pump casing', assembly, [0, sx(1.68), sx(.03)], [sx(2.72), sx(2.72), .34], 'steel', 'fixed', { cad_form: 'rotor_shroud', pump_volute: true, pump_casing: true, design_flow_lpm: values.flowRateLpm }, 26 * scale);
  const frontBearing = builder.component('frame', 'casing-side shaft bearing ring', assembly, [0, sx(1.68), sx(-.1)], [sx(.66), sx(.66), .14], 'steel', 'fixed', { cad_form: 'rotor_shroud', pump_bearing_support: true }, 2.4 * scale);
  builder.connect(base, casingBackplate, 'mechanical', 'casing_foot_mount');
  builder.connect(casingBackplate, volute, 'mechanical', 'volute_casing_joint');
  builder.connect(casingBackplate, frontBearing, 'mechanical', 'front_bearing_mount');

  const outletNeck = builder.component('frame', 'volute tangential discharge neck', assembly, [sx(.88), sx(2.56), sx(.03)], [sx(.62), sx(.76), sx(.54)], 'steel', 'fixed', { pump_volute_transition: true }, 7.5 * scale);
  const inlet = builder.component('shaft', 'axial suction inlet pipe', assembly, [0, sx(1.68), sx(.8)], [sx(.52), sx(.96), sx(.52)], 'steel', 'fixed', { pump_flow_path: 'suction', pump_inlet: true }, 5.2 * scale);
  builder.rotate(inlet, [Math.PI / 2, 0, 0]);
  const inletFlange = builder.component('plate', 'suction inlet flange', assembly, [0, sx(1.68), sx(1.3)], [sx(.9), sx(.9), .16], 'steel', 'fixed', { cad_form: 'flange', pump_inlet: true, feature_holes: 6 }, 3.4 * scale);
  const outlet = builder.component('shaft', 'tangential discharge outlet pipe', assembly, [sx(1.02), sx(3.02), sx(.03)], [sx(.5), sx(1.12), sx(.5)], 'steel', 'fixed', { pump_flow_path: 'discharge', pump_outlet: true }, 5.4 * scale);
  const outletFlange = builder.component('plate', 'discharge outlet flange', assembly, [sx(1.02), sx(3.61), sx(.03)], [sx(.84), sx(.84), .16], 'steel', 'fixed', { cad_form: 'flange', pump_outlet: true, feature_holes: 6 }, 3.1 * scale);
  builder.rotate(outletFlange, [Math.PI / 2, 0, 0]);
  builder.connect(volute, outletNeck, 'mechanical', 'volute_discharge_transition');
  builder.connect(volute, inlet, 'mechanical', 'axial_suction_path');
  builder.connect(inlet, inletFlange, 'mechanical', 'suction_flange_joint');
  builder.connect(outletNeck, outlet, 'mechanical', 'tangential_discharge_path');
  builder.connect(outlet, outletFlange, 'mechanical', 'discharge_flange_joint');

  const shaft = builder.component('shaft', 'bearing-supported centrifugal pump impeller shaft', assembly, [0, sx(1.68), sx(-.52)], [sx(.17), sx(1.8), sx(.17)], 'steel', 'kinematic', { pump_shaft: true, operation_spin: 3.2 }, 3.8 * scale);
  builder.rotate(shaft, [Math.PI / 2, 0, 0]);
  const hub = builder.component('wheel', 'multi-vane centrifugal pump impeller hub', assembly, [0, sx(1.68), sx(.16)], [sx(.58), sx(.58), .24], 'aluminum', 'dynamic', { cad_form: 'rotor_hub', pump_impeller: true, design_flow_lpm: values.flowRateLpm }, 2.6 * scale);
  // The revolute constraint is placed directly at the impeller center. The
  // long shaft remains a kinematic concentric visual/drive member so its
  // catalog-axis rotation cannot introduce an off-axis Rapier bearing frame.
  const shaftJoint = builder.joint('revolute', rearBearing, hub, [0, 0, 1], { anchorA: [0, sx(.76), sx(1.04)], anchorB: [0, 0, 0] });
  builder.connect(shaft, hub, 'mechanical', 'keyed_impeller_shaft');
  const bladeCount = countBefore(text, 'vane', countBefore(text, 'blade', 6, 4, 10), 4, 10);
  for (let index = 0; index < bladeCount; index += 1) {
    const angle = index / bladeCount * Math.PI * 2;
    const vane = builder.component('beam', `centrifugal impeller vane ${index + 1}`, assembly, [Math.cos(angle) * sx(.54), sx(1.68) + Math.sin(angle) * sx(.54), sx(.16)], [sx(1.02), sx(.16), .18], 'aluminum', 'dynamic', { cad_form: 'aero_blade', pump_impeller_vane: true, blade_index: index, blade_count: bladeCount }, .34 * scale);
    const vaneRotation = ((angle + Math.PI / 2 + Math.PI) % (Math.PI * 2)) - Math.PI;
    builder.rotate(vane, [0, 0, vaneRotation]);
    builder.joint('fixed', hub, vane);
  }

  const motor = builder.component('motor', 'close-coupled electric pump motor', assembly, [0, sx(1.68), sx(-1.58)], [sx(.78), sx(.94), sx(.78)], 'steel', 'kinematic', { pump_motor: true, rated_rpm: pumpRpm }, 24 * scale);
  builder.rotate(motor, [Math.PI / 2, 0, 0]);
  builder.motor(motor, shaftJoint, Math.max(120, values.flowRateLpm * 3), pumpRpm);
  const speedActuator = builder.actuator(motor, shaftJoint, 'rotary-motor', Math.max(120, values.flowRateLpm * 3), pumpRpm * Math.PI / 30, Math.PI * 2);
  builder.connect(base, motor, 'mechanical', 'motor_skid_mount');
  builder.connect(motor, shaft, 'power', 'close_coupled_impeller_drive');

  const speedSensorBody = builder.component('sensor', 'pump shaft speed encoder', assembly, [sx(.42), sx(1.68), sx(-.7)], [.22, .2, .22], 'polymer', 'fixed', { pump_speed_sensor: true }, .32);
  const flowSensorBody = builder.component('sensor', 'discharge flow sensor', assembly, [sx(1.38), sx(3.02), sx(.34)], [.26, .22, .26], 'polymer', 'fixed', { pump_flow_sensor: true, design_flow_lpm: values.flowRateLpm }, .38);
  const speedSensor = builder.sensor(speedSensorBody, 'speed', 'pump_shaft_speed', hub, 3);
  const flowSensor = builder.sensor(flowSensorBody, 'speed', 'discharge_flow_lpm', outlet, Math.max(4, values.flowRateLpm / 10));
  const controller = builder.component('controller', 'pump duty-point controller', assembly, [sx(-1.42), sx(.62), sx(-.72)], [.58, .64, .38], 'polymer', 'fixed', { pump_controller: true }, 2.4);
  builder.connect(volute, speedSensorBody, 'mechanical', 'encoder_bracket');
  builder.connect(outlet, flowSensorBody, 'mechanical', 'flow_sensor_mount');
  builder.connect(base, controller, 'mechanical', 'controller_skid_mount');
  builder.connect(speedSensorBody, controller, 'signal', 'shaft_speed_feedback');
  builder.connect(flowSensorBody, controller, 'signal', 'discharge_flow_feedback');
  builder.connect(controller, motor, 'signal', 'variable_speed_command');
  builder.control('centrifugal pump duty point', 'pid', [flowSensor, speedSensor], [speedActuator], 'trim impeller speed to maintain requested discharge flow while observing shaft speed', values.flowRateLpm);
  const dutyControl = builder.controls.at(-1);
  if (dutyControl) { dutyControl.kp = .72; dutyControl.ki = .05; dutyControl.kd = .11; }

  return {
    id: 'centrifugal-pump',
    mountId: base,
    editableId: flowSensorBody,
    handles: ['structure', 'rotate', 'measure', 'contain'],
    inputId: inlet,
    outputId: outlet,
    driveId: motor,
  };
}

function addParametricCadPart(context: ModuleContext): ModuleResult {
  const { builder, text, values, rootAssemblyId } = context;
  const assembly = builder.assembly('parametric cad part', 'Feature-driven part recipe composed from revolved, extruded, swept, and patterned primitive bodies', rootAssemblyId);
  const rotatingBlade = /impeller|propeller|fan\b|turbine|rotor/.test(text);
  if (rotatingBlade) {
    const base = builder.component('frame', 'rotor inspection stand', assembly, [0, .18, 0], [3.2, .3, 2.4], 'steel', 'fixed');
    const support = builder.component('beam', 'rotor bearing pedestal', assembly, [0, 1.35, -.42], [.36, 2.25, .36], 'steel', 'fixed');
    builder.joint('fixed', base, support);
    if (/\bduct\b/.test(text)) {
      const shroud = builder.component('frame', 'ventilation duct shroud', assembly, [0, 2.1, -.1], [3.25, 3.25, .22], 'steel', 'fixed', { cad_form: 'rotor_shroud' });
      builder.joint('fixed', support, shroud);
    }
    const hub = builder.component('wheel', 'machined rotor hub', assembly, [0, 2.1, 0], [1, .34, 1], 'aluminum', 'dynamic', { cad_form: 'rotor_hub' });
    // The bearing axis passes through the hub center. A midpoint anchor makes the
    // complete rotor orbit the pedestal instead of spinning concentrically.
    const shaftJoint = builder.joint('revolute', support, hub, [0, 0, 1], { anchorA: [0, .75, .42], anchorB: [0, 0, 0] });
    const bladeCount = countBefore(text, 'blade', 6, 2, 12);
    const bladeMaterial = /\baluminum\b/.test(text) ? 'aluminum' : /\bsteel\b/.test(text) ? 'steel' : 'composite';
    for (let index = 0; index < bladeCount; index += 1) {
      const angle = index / bladeCount * Math.PI * 2;
      const blade = builder.component('beam', `aerodynamic blade ${index + 1}`, assembly, [Math.cos(angle) * .92, 2.1 + Math.sin(angle) * .92, 0], [1.45, .18, .36], bladeMaterial, 'dynamic', { cad_form: 'aero_blade', blade_index: index, blade_count: bladeCount });
      const bladeRotation = ((angle + Math.PI / 2 + Math.PI) % (Math.PI * 2)) - Math.PI;
      builder.rotate(blade, [0, 0, bladeRotation]);
      builder.joint('fixed', hub, blade);
    }
    const motor = builder.component('motor', 'variable-speed rotor motor', assembly, [0, 1.45, -.7], [.48, .56, .48], 'steel', 'kinematic');
    builder.motor(motor, shaftJoint, Math.max(45, values.torqueNm), Math.max(90, values.rpm));
    const sensorBody = builder.component('sensor', 'rotor speed encoder', assembly, [.48, 2.1, -.26], [.24, .2, .24], 'polymer', 'fixed');
    builder.sensor(sensorBody, 'speed', 'rotor_speed', hub, 3);
    builder.connect(support, motor, 'mechanical', 'motor_mount');
    builder.connect(support, sensorBody, 'mechanical', 'encoder_mount');
    builder.connect(motor, hub, 'power', 'rotor_drive');
    return { id: 'parametric-rotor', mountId: base, editableId: sensorBody, handles: ['rotate', 'measure'], outputId: hub };
  }

  const base = builder.component('frame', 'cad inspection base', assembly, [0, .16, 0], [2.8, .25, 2.1], 'steel', 'fixed');
  const form = /bearing/.test(text) ? 'bearing' : /\bseal\b/.test(text) ? 'seal' : /flange/.test(text) ? 'flange' : /\bshaft\b/.test(text) ? 'shaft' : /\bcover\b/.test(text) ? 'cover' : /coupling/.test(text) ? 'coupling' : /sprocket/.test(text) ? 'sprocket' : /cam\b/.test(text) ? 'cam' : /bracket/.test(text) ? 'angle_bracket' : /housing|enclosure|casing/.test(text) ? 'housing' : /manifold|duct|pipe/.test(text) ? 'manifold' : 'machined_part';
  const primitive: PrimitiveKind = ['bearing', 'seal', 'flange'].includes(form) ? 'wheel' : ['shaft', 'coupling', 'manifold'].includes(form) ? 'shaft' : ['sprocket', 'cam'].includes(form) ? 'gear' : form === 'housing' ? 'frame' : 'plate';
  const dimensions: Vec3 = form === 'housing' ? [2.1, 1.5, 1.65] : form === 'angle_bracket' ? [1.65, 1.25, 1.25] : form === 'manifold' ? [.72, 1.8, .72] : form === 'shaft' ? [.34, 1.9, .34] : form === 'cover' ? [1.8, .18, 1.8] : form === 'seal' ? [1.35, .22, 1.35] : ['bearing', 'flange', 'sprocket', 'cam'].includes(form) ? [1.6, .32, 1.6] : [.82, 1.35, .82];
  const rotatingForms = ['bearing', 'seal', 'flange', 'shaft', 'coupling', 'sprocket', 'cam'];
  const part = builder.component(primitive, form.replaceAll('_', ' '), assembly, [0, 1.28, 0], dimensions, form === 'angle_bracket' ? 'aluminum' : 'steel', rotatingForms.includes(form) ? 'dynamic' : 'fixed', { cad_form: form, feature_holes: 6, wall_thickness: .08 });
  builder.connect(base, part, 'mechanical', 'inspection_fixture');
  if (rotatingForms.includes(form)) {
    const joint = builder.joint('revolute', base, part, [0, 1, 0], { limits: [-Math.PI, Math.PI] });
    const motor = builder.component('motor', 'inspection turntable motor', assembly, [0, .52, 0], [.42, .48, .42], 'steel', 'kinematic');
    builder.motor(motor, joint, Math.max(22, values.torqueNm * .4), Math.max(30, values.rpm * .35));
    builder.connect(motor, part, 'power', 'inspection_rotation');
  }
  const gauge = builder.component('sensor', 'dimensional inspection probe', assembly, [.95, 1.55, .7], [.24, .2, .24], 'polymer', 'fixed');
  builder.sensor(gauge, 'position', 'feature_dimension', part, 3);
  return { id: `parametric-${form}`, mountId: base, editableId: gauge, handles: ['structure', 'rotate', 'measure'], outputId: part };
}

function addBrazingFixture(context: ModuleContext): ModuleResult {
  const { builder, rootAssemblyId } = context;
  const assembly = builder.assembly('hvac brazing fixture', 'Machined fixture plate, finned heat exchanger workpiece, copper tube locators, clamps, and metrology', rootAssemblyId);
  const subframe = builder.component('frame', 'welded fixture support frame', assembly, [0, .18, 0], [4.5, .28, 3], 'steel', 'fixed', { fixture_base: true }, 86);
  const plate = builder.component('plate', 'machined brazing fixture plate', assembly, [0, .43, 0], [4.15, .18, 2.7], 'aluminum', 'fixed', { fixture_plate: true, locating_grid: true }, 64);
  builder.joint('fixed', subframe, plate);

  const core = builder.component('plate', 'finned heat exchanger core', assembly, [0, 1.3, 0], [2.45, 1.22, .34], 'aluminum', 'dynamic', { heat_exchanger_core: true, payload_kg: 18 }, 18);
  builder.joint('fixed', plate, core);

  const leftHeader = builder.component('shaft', 'left copper header pipe', assembly, [-1.34, 1.3, 0], [.18, 1.42, .18], 'copper', 'dynamic', { hvac_pipe: true, pipe_role: 'header' }, 3.2);
  const rightHeader = builder.component('shaft', 'right copper header pipe', assembly, [1.34, 1.3, 0], [.18, 1.42, .18], 'copper', 'dynamic', { hvac_pipe: true, pipe_role: 'header' }, 3.2);
  builder.joint('fixed', core, leftHeader); builder.joint('fixed', core, rightHeader);
  const inlet = builder.component('shaft', 'copper inlet tube', assembly, [-1.88, 1.68, 0], [.15, 1.05, .15], 'copper', 'dynamic', { hvac_pipe: true, pipe_role: 'inlet' }, 1.3);
  const outlet = builder.component('shaft', 'copper outlet tube', assembly, [1.88, .98, 0], [.15, 1.05, .15], 'copper', 'dynamic', { hvac_pipe: true, pipe_role: 'outlet' }, 1.3);
  builder.rotate(inlet, [0, 0, Math.PI / 2]); builder.rotate(outlet, [0, 0, Math.PI / 2]);
  builder.joint('fixed', leftHeader, inlet); builder.joint('fixed', rightHeader, outlet);

  for (const [index, position] of ([[-1.62, .73, -.72], [-1.62, .73, .72], [1.62, .73, -.72], [1.62, .73, .72]] as Vec3[]).entries()) {
    const locator = builder.component('support', `precision locating pin ${index + 1}`, assembly, position, [.28, .52, .28], 'steel', 'fixed', { locating_pin: true }, 1.5);
    builder.joint('fixed', plate, locator);
  }

  const actuatorIds: string[] = [];
  for (const [index, side] of [-1, 1].entries()) {
    const clamp = builder.component('piston', `${side < 0 ? 'left' : 'right'} pneumatic hold-down clamp`, assembly, [side * 1.72, 1.55, -.88], [.3, .92, .3], 'steel', 'kinematic', { fixture_clamp: true, clamp_side: side }, 5.5);
    const clampJoint = builder.joint('prismatic', plate, clamp, [0, 1, 0], { limits: [-.22, 0] });
    actuatorIds.push(builder.actuator(clamp, clampJoint, 'piston', 450, .22, .22));
    builder.connect(clamp, core, 'mechanical', `hold_down_${index + 1}`);
  }

  const visionBody = builder.component('camera', 'overhead alignment camera', assembly, [0, 2.55, 1.28], [.38, .3, .38], 'polymer', 'fixed', { fixture_camera: true }, 1.2);
  builder.rotate(visionBody, [-Math.PI / 2, 0, 0]);
  const forceBody = builder.component('sensor', 'clamp force transducer', assembly, [0, .68, -.95], [.32, .16, .32], 'polymer', 'fixed', { force_transducer: true }, .4);
  const vision = builder.sensor(visionBody, 'camera', 'tube_alignment', core, 4);
  const force = builder.sensor(forceBody, 'force', 'clamp_force', core, 2);
  const controller = builder.component('controller', 'brazing fixture interlock', assembly, [1.55, .78, 1.08], [.58, .42, .48], 'polymer', 'fixed', { fixture_controller: true }, 3);
  builder.joint('fixed', visionBody, plate); builder.joint('fixed', forceBody, plate); builder.joint('fixed', controller, plate);
  builder.connect(visionBody, controller, 'signal', 'alignment_feedback'); builder.connect(forceBody, controller, 'signal', 'clamp_feedback');
  builder.control('fixture clamp and alignment', 'synchronized', [vision, force], actuatorIds, 'close both clamps only after the heat exchanger and copper tubes are inside the brazing alignment envelope', 2);
  return { id: 'hvac-brazing-fixture', mountId: plate, editableId: visionBody, handles: ['structure', 'measure'], outputId: core };
}

function addBrazedPlateHeatExchanger(context: ModuleContext): ModuleResult {
  const { builder, rootAssemblyId } = context;
  const assembly = builder.assembly('brazed plate heat exchanger', 'Corrugated stainless heat-transfer plates, copper-brazed seams, four isolated fluid ports, and temperature instrumentation', rootAssemblyId);
  const rear = builder.component('plate', 'rear pressure plate', assembly, [0, 1.65, -.48], [2.4, 2.9, .12], 'steel', 'fixed', { bphe_end_plate: true, end_role: 'rear' }, 5.2);
  let previous = rear;
  const plateCount = 12;
  for (let index = 0; index < plateCount; index += 1) {
    const z = -.37 + index * (.74 / (plateCount - 1));
    const plate = builder.component('plate', `corrugated heat-transfer plate ${index + 1}`, assembly, [0, 1.65, z], [2.12, 2.56, .045], 'steel', 'fixed', { bphe_plate: true, channel: index % 2 ? 'cold' : 'hot', chevron_direction: index % 2 ? -1 : 1 }, .82);
    builder.joint('fixed', previous, plate);
    previous = plate;
  }
  const front = builder.component('plate', 'front pressure plate', assembly, [0, 1.65, .48], [2.4, 2.9, .12], 'steel', 'fixed', { bphe_end_plate: true, end_role: 'front' }, 5.2);
  builder.joint('fixed', previous, front);

  const portPositions: Array<[string, Vec3, string]> = [
    ['hot inlet', [-.72, 2.3, .82], 'hot'], ['hot outlet', [-.72, 1, .82], 'hot'],
    ['cold inlet', [.72, 1, .82], 'cold'], ['cold outlet', [.72, 2.3, .82], 'cold'],
  ];
  const ports: string[] = [];
  for (const [role, position, circuit] of portPositions) {
    const port = builder.component('shaft', `${role} connection`, assembly, position, [.3, .62, .3], 'copper', 'fixed', { hvac_pipe: true, bphe_port: true, circuit }, .9);
    builder.rotate(port, [Math.PI / 2, 0, 0]);
    builder.joint('fixed', front, port);
    ports.push(port);
  }
  const hotProbe = builder.component('sensor', 'hot-side temperature probe', assembly, [-.72, 2.55, .82], [.16, .2, .16], 'polymer', 'fixed', { bphe_probe: true }, .18);
  const coldProbe = builder.component('sensor', 'cold-side temperature probe', assembly, [.72, .75, .82], [.16, .2, .16], 'polymer', 'fixed', { bphe_probe: true }, .18);
  builder.joint('fixed', ports[0], hotProbe); builder.joint('fixed', ports[2], coldProbe);
  builder.sensor(hotProbe, 'position', 'hot_side_temperature', ports[0], 2);
  builder.sensor(coldProbe, 'position', 'cold_side_temperature', ports[2], 2);
  return { id: 'brazed-plate-heat-exchanger', mountId: rear, editableId: hotProbe, handles: ['structure', 'contain', 'measure'], outputId: front };
}

const requestedPrimitivePatterns: Array<[PrimitiveKind, RegExp]> = [
  ['beam', /\bbeams?\b/], ['plate', /\bplates?\b/], ['frame', /\bframes?\b/], ['wheel', /\b(?:fly[- ]?wheels?|wheels?)\b/],
  ['tube', /\b(?:tubes?|tubular members?)\b/], ['bearing', /\bbearings?\b/], ['linkage', /\b(?:linkages?|links?)\b/],
  ['seat', /\b(?:seats?|saddles?)\b/], ['steering', /\b(?:steering wheels?|handlebars?|control yokes?)\b/], ['pedal', /\bpedals?\b/], ['battery', /\bbatter(?:y|ies)\b/],
  ['body-shell', /\b(?:body shells?|fairings?|cowling|canop(?:y|ies))\b/], ['aerofoil', /\b(?:aerofoils?|airfoils?|wings?)\b/], ['fuselage', /\bfuselages?\b/],
  ['propeller', /\bpropellers?\b/], ['rotor', /\brotors?\b/], ['landing-gear', /\blanding gear\b/], ['track', /\b(?:continuous )?tracks?\b/],
  ['shaft', /\bshafts?\b/], ['gear', /\bgears?\b/], ['pulley', /\bpulleys?\b/], ['belt', /\bbelts?\b/],
  ['motor', /\bmotors?\b/], ['servo', /\bservos?\b/], ['piston', /\bpistons?\b/], ['spring', /\bsprings?\b/],
  ['sensor', /\bsensors?\b/], ['camera', /\bcameras?\b/], ['conveyor', /\bconveyors?\b/], ['ramp', /\bramps?\b/],
  ['light', /\b(?:lights?|headlights?|lamps?)\b/],
  ['gripper', /\bgrippers?\b/], ['container', /\bcontainers?\b/], ['counterweight', /\bcounterweights?\b/],
  ['cable', /\bcables?\b/], ['hook', /\bhooks?\b/], ['roller', /\brollers?\b/],
];

function requestedPrimitiveCounts(text: string) {
  const result = new Map<PrimitiveKind, number>();
  const wordPattern = Object.keys(NUMBER_WORDS).join('|');
  // A number followed by an engineering unit describes a dimension, load, or
  // target—not a quantity of primitives. Without this guard, “200 kg beam”
  // was misread as twelve requested beams because “kg” looked like an
  // adjective between the count and noun.
  const quantitySafeText = text.replace(new RegExp(`\\b(?:\\d+(?:\\.\\d+)?|${wordPattern})\\s*(?:kg|kilograms?|g|grams?|mm|millimeters?|cm|centimeters?|m|meters?|metres?|in|inches?|ft|feet|n|newtons?|nm|rpm|hz|kw|w|watts?|mph|km\\/?h|m\\/?s|degrees?|deg|seconds?|minutes?)\\b`, 'g'), ' ');
  for (const [kind, noun] of requestedPrimitivePatterns) {
    const searchable = kind === 'gear' ? quantitySafeText.replace(/\blanding gear\b/g, '') : quantitySafeText;
    const source = noun.source.replace(/^\\b|\\b$/g, '');
    const match = searchable.match(new RegExp(`(?:(${wordPattern}|\\d+)\\s+(?:[a-z-]+\\s+){0,2})?${source}\\b`));
    if (!match) continue;
    result.set(kind, match[1] ? Math.min(12, NUMBER_WORDS[match[1]] ?? Number(match[1])) : 1);
  }
  return result;
}

function addRequestedPrimitiveBodies(context: ModuleContext, missing: Array<[PrimitiveKind, number]>, mountId: string): ModuleResult {
  const { builder, rootAssemblyId } = context;
  const assembly = builder.assembly('requested primitive extension', 'Explicitly requested bodies integrated into the composed mechanism', rootAssemblyId);
  const created: string[] = [];
  const actuators: string[] = [];
  const sensors: string[] = [];
  const mount = builder.components.find((item) => item.id === mountId);
  const mountPosition = mount?.position ?? [0, 0, 0];
  let offset = 0;
  for (const [kind, count] of missing) for (let index = 0; index < count; index += 1) {
    offset += 1;
    const dynamic = ['gear', 'wheel', 'pulley', 'piston', 'servo', 'gripper', 'hook', 'spring', 'propeller', 'rotor', 'linkage'].includes(kind);
    const body = builder.component(kind, `requested ${kind} ${index + 1}`, assembly, [
      mountPosition[0] + .55 + offset * .48,
      Math.max(.9, mountPosition[1] + .75 + (offset % 2) * .42),
      mountPosition[2] + (offset % 3 - 1) * .48,
    ], undefined, undefined, dynamic ? 'dynamic' : undefined);
    created.push(body);
    if (kind === 'gear' || kind === 'wheel' || kind === 'pulley') builder.joint('revolute', mountId, body, [0, 1, 0]);
    else if (kind === 'piston') {
      const motion = builder.joint('prismatic', mountId, body, [1, 0, 0], { limits: [0, context.values.strokeM] });
      actuators.push(builder.actuator(body, motion, 'piston', 1050, .6, context.values.strokeM));
    } else builder.connect(mountId, body, kind === 'camera' || kind === 'sensor' ? 'signal' : 'mechanical', 'explicit_primitive_interface');
    if (kind === 'camera' || kind === 'sensor') sensors.push(builder.sensor(body, kind === 'camera' ? 'camera' : 'position', 'explicit_observation', created.find((id) => id !== body) ?? mountId, 4));
    if (kind === 'motor') builder.motor(body, undefined, Math.max(30, context.values.torqueNm), context.values.rpm);
  }
  const gears = created.filter((id) => builder.components.find((item) => item.id === id)?.primitive === 'gear');
  for (let index = 1; index < gears.length; index += 1) builder.joint('gear', gears[index - 1], gears[index], [0, 1, 0], { ratio: context.values.ratio });
  if (sensors.length && actuators.length) builder.control('explicit mechanism', 'pid', sensors, actuators, 'coordinate the explicitly requested sensing and actuation primitives', context.values.strokeM);
  return { id: 'requested-primitives', mountId: created[0], editableId: created.find((id) => ['sensor', 'camera'].includes(builder.components.find((item) => item.id === id)?.primitive ?? '')) ?? created[0], handles: ['measure'] };
}

const moduleRules: ModuleRule[] = [
  { id: 'hvac-brazing-fixture', matches: ({ text }) => /(?:fixture|jig).*(?:hvac|heat exchanger|braz)|(?:hvac|heat exchanger|braz).*(?:fixture|jig)/.test(text), compose: addBrazingFixture },
  { id: 'brazed-plate-heat-exchanger', matches: ({ text }) => /braz(?:ed|e)\s+plate|plate\s+heat exchanger|\bbphe\b/.test(text), compose: addBrazedPlateHeatExchanger },
  { id: 'bench-vise', matches: ({ text }) => isBenchViseGoal(text), compose: addBenchVise },
  { id: 'bottle-jack', matches: ({ text }) => isBottleJackGoal(text), compose: addBottleJack },
  { id: 'grain-roller-mill', matches: ({ text }) => isGrainMillGoal(text), compose: addGrainRollerMill },
  { id: 'wind-yaw-drive', matches: ({ text }) => isWindYawGoal(text), compose: addWindYawDrive },
  { id: 'drill-press', matches: ({ text }) => isDrillPressGoal(text), compose: addDrillPress },
  { id: 'rack-steering', matches: ({ text }) => isRackSteeringGoal(text), compose: addRackSteering },
  { id: 'bicycle-brake', matches: ({ text }) => isBicycleBrakeGoal(text), compose: addBicycleBrake },
  { id: 'hydraulic-press', matches: ({ text }) => isHydraulicPressGoal(text), compose: addHydraulicPress },
  { id: 'drum-winch', matches: ({ text }) => isStandaloneWinchGoal(text), compose: addDrumWinch },
  { id: 'span-members', matches: ({ text }) => /bridge|truss|structural span/.test(text), compose: addSpanMembers },
  { id: 'motorcycle', matches: ({ text }) => isMotorcycleGoal(text), compose: addMotorcycle },
  { id: 'fixed-wing-aircraft', matches: ({ text }) => isFixedWingAircraftGoal(text), compose: addFixedWingAircraft },
  { id: 'helicopter', matches: ({ text }) => isHelicopterGoal(text), compose: addHelicopter },
  { id: 'general-robot', matches: ({ text }) => isGeneralRobotGoal(text), compose: addGeneralRobot },
  { id: 'single-track-vehicle', matches: ({ text }) => isBicycleGoal(text), compose: addSingleTrackVehicle },
  { id: 'automotive-suspension', matches: ({ text }) => /suspension|coil[- ]?over|wishbone/.test(text), compose: addAutomotiveSuspension },
  { id: 'low-profile-road-vehicle', matches: ({ text }) => isRoadVehicleGoal(text) && !/suspension|coil[- ]?over|wishbone/.test(text), compose: addLowProfileRoadVehicle },
  { id: 'rolling-support', matches: ({ text, capabilities }) => capabilities.includes('mobile') && !isBicycleGoal(text) && !isRoadVehicleGoal(text) && !isMotorcycleGoal(text) && !isFixedWingAircraftGoal(text) && !isHelicopterGoal(text) && !isGeneralRobotGoal(text) && !/suspension|coil[- ]?over|wishbone/.test(text), compose: addRollingSupport },
  { id: 'planetary-differential', matches: ({ text }) => isPlanetaryDifferentialGoal(text), compose: addPlanetaryDifferential },
  { id: 'rotary-transmission', matches: ({ text, capabilities }) => capabilities.includes('transmit') && !isPlanetaryDifferentialGoal(text), compose: addRotaryTransmission },
  { id: 'serial-linkage', matches: ({ text, capabilities }) => capabilities.includes('manipulate') && !isGeneralRobotGoal(text), compose: addSerialLinkage },
  { id: 'cable-suspension', matches: ({ text, capabilities }) => capabilities.includes('lift') && capabilities.includes('suspend') && !isStandaloneWinchGoal(text) && !/bridge|truss/.test(text), compose: addCableSuspension },
  { id: 'patient-lift', matches: ({ text }) => /patient/.test(text), compose: addPatientLift },
  { id: 'scissor-linkage-lift', matches: ({ text }) => isScissorLiftGoal(text), compose: addScissorLift },
  { id: 'parallel-guides', matches: ({ text, capabilities }) => capabilities.includes('lift') && !capabilities.includes('suspend') && !isBottleJackGoal(text) && !isHydraulicPressGoal(text) && !isStandaloneWinchGoal(text) && !/bridge|truss|patient|scissor/.test(text), compose: addParallelGuides },
  { id: 'warehouse-buffer', matches: ({ text }) => /warehouse|accumulation|buffer/.test(text), compose: addWarehouseBuffer },
  { id: 'tomato-grader', matches: ({ text }) => /tomato|\bproduce\s+(?:grader|sorting|line)\b|fruit.*grad|grader.*fruit/.test(text), compose: addTomatoGrader },
  { id: 'recycling-separator', matches: ({ text }) => /recycl|metal cans?|plastic bottles?/.test(text), compose: addRecyclingSeparator },
  { id: 'material-flow', matches: ({ capabilities, text }) => capabilities.includes('transport') && !/warehouse|accumulation|buffer|tomato|\bproduce\s+(?:grader|sorting|line)\b|fruit|recycl|metal cans?|plastic bottles?/.test(text), compose: addMaterialFlow },
  { id: 'tracking-axis', matches: ({ text, capabilities }) => capabilities.includes('track') && !isWindYawGoal(text), compose: addTrackingAxis },
  { id: 'centrifugal-pump', matches: ({ text }) => isCentrifugalPumpGoal(text) && !isCentrifugalPumpPartGoal(text), compose: addCentrifugalPump },
  { id: 'reciprocating-linkage', matches: ({ text }) => /reciprocat|piston pump|plunger pump/.test(text), compose: addReciprocatingLinkage },
  { id: 'closed-linkage', matches: ({ text }) => /four[- ]bar|linkage/.test(text), compose: addFourBar },
  { id: 'parametric-cad-part', matches: ({ text }) => /\b(?:bearing|seal|flange|shaft|cover|coupling|sprocket|cam|impeller|propeller|fan|turbine|rotor|bracket|housing|enclosure|casing|manifold|duct|pipe)\b/.test(text) && !isWindYawGoal(text) && !isPlanetaryDifferentialGoal(text) && !isMotorcycleGoal(text) && !isFixedWingAircraftGoal(text) && !isHelicopterGoal(text) && !isGeneralRobotGoal(text) && (!isCentrifugalPumpGoal(text) || isCentrifugalPumpPartGoal(text)) && !/heat exchanger|braz/.test(text), compose: addParametricCadPart },
];

export function compileDesignBrief(raw: string): CompiledWorldPlan {
  const brief = normalize(raw);
  if (brief.length < 12) throw new Error('VAGUE_GOAL: Describe the physical system, what it should do, and a measurable outcome.');
  if (brief.length > 500) throw new Error('OUT_OF_RANGE: Keep the engineering brief under 500 characters.');
  if (/\b(?:do not|don['’]?t|never)\s+(?:build|design|create|engineer)\b/i.test(brief)) throw new Error('NEGATED_GOAL: The brief explicitly says not to engineer the system.');

  // The original brief remains visible and auditable. A small synonym layer is
  // used only for topology selection so spelling mistakes cannot silently turn
  // the requested object into a different machine family.
  const intent = normalizeEngineeringIntent(brief);
  const text = intent.normalizedRequest.toLowerCase();
  const capabilities = inferCapabilities(text);
  const values = parseValues(text);
  const constraints = constraintsFor(text, capabilities, values);
  const builder = new WorldBuilder();
  const rootAssemblyId = builder.assembly('engineered world', 'Root assembly for independently composable mechanism modules');
  builder.setRoot(rootAssemblyId);
  const selectionContext = { text, capabilities, values };
  const subpartOnly = /\b(?:gearbox|pump|bicycle|bike|car|vehicle)\s+(?:mounting\s+)?(?:bracket|housing|bearing|fork)\b|\b(?:bracket|housing|bearing|fork)\s+(?:for|of)\s+(?:a\s+)?(?:gearbox|pump|bicycle|bike|car|vehicle)\b/.test(text);
  const matchingRules = moduleRules.filter((rule) => rule.matches(selectionContext));
  const selectedRules = subpartOnly ? matchingRules.filter((rule) => rule.id === 'parametric-cad-part') : matchingRules;
  const requested = requestedPrimitiveCounts(text);
  const explicitGenericMechanism = /hatch|door|gate|latch|lever|crank|flywheel|hinge|pivot|slider|stroke|actuat|\bmotor\b|\bservo\b|\bpiston\b|\bspring\b|\bsensor\b|\bcamera\b/.test(text);
  // Merely mentioning a low-level part (for example, “jaw plates” in a bench
  // vise request) is not enough evidence for a faithful machine topology. A
  // recognized module or explicit motion/actuation description must anchor the
  // fallback; otherwise fail honestly instead of surrounding the named part
  // with an unrelated generic motion stage.
  if (!selectedRules.length && !explicitGenericMechanism) {
    const object = identity(text, capabilities).name.replace(/ mechanism$/, '');
    throw new Error(`UNSUPPORTED_TOPOLOGY: ForgeTwin could not identify a faithful primitive architecture for “${object}”. Name its main structure, moving parts, drive, and required motion instead of receiving an unrelated machine.`);
  }
  const rules: ModuleRule[] = selectedRules.length ? selectedRules : [{ id: 'constructed-motion', matches: () => true, compose: addGenericMotion }];
  const spacing = rules.length > 1 ? Math.min(4.8, 10 / Math.max(1, rules.length - 1)) : 0;
  const modules = rules.map((rule, index) => builder.at([(index - (rules.length - 1) / 2) * spacing, 0, 0], () => rule.compose({ builder, text, capabilities, values, rootAssemblyId })));

  const handled = new Set(modules.flatMap((module) => module.handles));
  if (capabilities.includes('rotate') && !handled.has('rotate')) {
    modules.push(builder.at([modules.length ? Math.max(4.8, spacing) * modules.length / 2 : 0, 0, 0], () => addGenericMotion({ builder, text, capabilities, values, rootAssemblyId })));
  }
  // Bicycle prompts naturally name semantic assemblies such as the welded
  // frame, saddle, steering, pedals, and battery. The bicycle module already
  // constructs each of those from lower-level bodies, sometimes with a more
  // appropriate primitive (for example, beams for the frame and a plate for
  // the saddle). Do not append a second set of generic standalone objects.
  const semanticallySatisfied = isBicycleGoal(text)
    ? new Set<PrimitiveKind>(['frame', 'seat', 'steering', 'pedal', 'battery'])
    : isRoadVehicleGoal(text)
      // One rear-bench primitive represents multiple real seating positions;
      // do not bolt a generic fourth seat outside the finished passenger cell.
      ? new Set<PrimitiveKind>(['frame', 'wheel', 'shaft', 'bearing', 'tube', 'seat', 'steering', 'pedal', 'battery', 'body-shell', 'light'])
      : new Set<PrimitiveKind>();
  const missing = [...requested.entries()]
    .map(([kind, count]) => [kind, Math.max(0, count - builder.components.filter((item) => item.primitive === kind).length)] as [PrimitiveKind, number])
    .filter(([kind, count]) => count > 0 && !semanticallySatisfied.has(kind));
  if (missing.length) modules.push(addRequestedPrimitiveBodies({ builder, text, capabilities, values, rootAssemblyId }, missing, modules[0].mountId));
  for (let index = 1; index < modules.length; index += 1) builder.connect(modules[0].mountId, modules[index].mountId, 'mechanical', 'module_interface');
  const transmission = modules.find((module) => module.id === 'rotary-transmission');
  const drivenModule = modules.find((module) => ['cable-suspension', 'span-members'].includes(module.id) && module.driveId);
  if (transmission?.outputId && drivenModule?.driveId) builder.connect(transmission.outputId, drivenModule.driveId, 'power', 'compound_drive_output');

  const explicitBudget = values.maxComponents;
  if (explicitBudget !== undefined && explicitBudget < builder.components.length) throw new Error(`INFEASIBLE_GOAL: The composed primitive graph needs at least ${builder.components.length} physical bodies; increase the component budget.`);
  const maxComponents = explicitBudget ?? Math.min(80, Math.max(builder.components.length + 8, 24));
  const assumptions = constraints.filter((constraint) => constraint.source === 'inferred').map((constraint) => `Inferred target: ${constraint.label} ${symbol(constraint.operator)} ${constraint.target}${constraint.unit}`);
  assumptions.push('Deterministic concept model; the agent may revise any unlocked primitive, joint, material, device, or controller.');
  const { name, domain } = identity(text, capabilities);
  const editable = modules.find((module) => module.editableId)?.editableId ?? builder.components[0]?.id ?? '';
  const goal = {
    machineName: name,
    domain,
    brief,
    summary: `Compose ${modules.map((module) => module.id).join(' + ')} from ${builder.components.length} low-level bodies, ${builder.joints.length} joints, and ${builder.controls.length} control loops.`,
    capabilities,
    constraints,
    maxComponents,
    assumptions,
    disclaimer: 'Concept-level rigid-body model. Reduced-order structural, flow, transmission, and control measurements require domain validation before fabrication.',
    simulationModel: 'Composable multi-body Rapier world with graph-derived engineering measurements',
    editableComponentId: editable,
    editableLabel: builder.components.find((component) => component.id === editable)?.role ?? 'selected primitive',
    orientation: structuredClone(FORGE_COORDINATE_CONVENTION),
  };
  const simulationDuration = isStandaloneWinchGoal(text)
    ? Math.min(30, Math.max(6, values.liftM / Math.max(.01, values.linearSpeedMps), values.supplied.has('durationS') ? values.durationS : 0))
    : Math.min(12, Math.max(6, Math.min(values.durationS, 12)));

  const compiled: CompiledWorldPlan = {
    brief,
    goal,
    world: { ...worldDefaults, duration: simulationDuration, bounds: modules.length > 1 ? [22, 10, 14] : [...worldDefaults.bounds] },
    assemblies: builder.assemblies,
    components: builder.components,
    connections: builder.connections,
    joints: builder.joints,
    motors: builder.motors,
    sensors: builder.sensors,
    actuators: builder.actuators,
    controls: builder.controls,
    assumptions,
  };
  return finalizeCompiledWorldPlan(compiled, brief).plan;
}
