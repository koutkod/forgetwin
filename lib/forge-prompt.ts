import { catalogFor, engineeringExamples, worldDefaults } from './forge-data';
import type {
  ActuatorBlueprint, AssemblyBlueprint, BodyType, Capability, CompiledWorldPlan,
  ComponentBlueprint, ConnectionBlueprint, ControlBlueprint, GoalConstraint,
  JointBlueprint, JointType, MotorBlueprint, PrimitiveKind, SensorBlueprint, Vec3,
} from './forge-types';

export const DEFAULT_DESIGN_PROMPT = engineeringExamples[1].prompt;
export const CHALLENGE_EXAMPLES = engineeringExamples;

const normalize = (value: string) => value.normalize('NFKC').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'part';
const numeric = (value: string | undefined, fallback: number) => value ? Number(value.replaceAll(',', '')) : fallback;

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
  const strokeCm = capture(text, /(?:stroke|opens?|travel)[^.!?]{0,30}?(\d+(?:\.\d+)?)\s*cm\b/i);
  if (strokeCm) supplied.add('strokeM');
  const strokeMeters = capture(text, /(?:(?:stroke|opens?|travel)[^.!?]{0,30}?(\d+(?:\.\d+)?)\s*(?:m|meters?)\b|(\d+(?:\.\d+)?)\s*(?:m|meters?)[^.!?]{0,18}?(?:linear\s+)?stroke\b)/i);
  if (strokeMeters) supplied.add('strokeM');
  const maxComponents = capture(text, /(?:no more than|at most|maximum(?: of)?|using)\s+(\d+)\s+(?:components?|parts?)/i);
  if (maxComponents) supplied.add('maxComponents');
  return {
    payloadKg: read('payloadKg', /(\d+(?:,\d{3})*(?:\.\d+)?)\s*kg\b/i, 25),
    liftM: liftCm ? numeric(liftCm, 100) / 100 : read('liftM', /(?:lift|raise|raises|raising|travel|height)[^.!?]{0,45}?(\d+(?:\.\d+)?)\s*(?:m|meters?)\b/i, 1),
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
    strokeM: strokeCm ? numeric(strokeCm, 100) / 100 : strokeMeters ? numeric(strokeMeters, 1) : 1,
    maxComponents: maxComponents ? Number(maxComponents) : undefined,
    supplied,
  };
}

function inferCapabilities(text: string): Capability[] {
  const capabilities = new Set<Capability>(['structure']);
  if (/conveyor|packages?|boxes|sort|warehouse|factory line|buffer|singulat|feed|recycl|grader|routing/.test(text)) capabilities.add('transport');
  if (/sort|separat|route|classif|inspect|reject|color|size|material|grader|recycl/.test(text)) { capabilities.add('classify'); capabilities.add('measure'); }
  if (/lift|raise|elevator|crane|hoist|drawbridge|jack|patient/.test(text)) capabilities.add('lift');
  if (/crane|hoist|suspend|cable|pulley|counterweight|drawbridge/.test(text)) capabilities.add('suspend');
  if (/rover|vehicle|mobile robot|corridor|obstacle|\bwheels?\b|\bdrive\b/.test(text)) capabilities.add('mobile');
  if (/robotic arm|robot arm|manipulat|gripper|pick\s*(?:and|&)\s*place|end effector/.test(text)) capabilities.add('manipulate');
  if (/gearbox|gear train|transmission|reduction|output torque|\bgears?\b/.test(text)) capabilities.add('transmit');
  if (/suspension|spring|rough|uneven|tipping|stability|stabiliz|level/.test(text)) capabilities.add('stabilize');
  if (/solar|light source|\btrack(?:ing|er)?\b|turbine|blade pitch/.test(text)) capabilities.add('track');
  if (/buffer|queue|spacing|irregular|singulat/.test(text)) capabilities.add('buffer');
  if (/bin|container|collect|recycling|reject|tank|reservoir/.test(text)) capabilities.add('contain');
  if (/rotat|hinge|pivot|door|hatch|drawbridge|crank|flywheel|four[- ]bar|linkage|pump/.test(text)) capabilities.add('rotate');
  if (/bearing|flange|coupling|sprocket|cam\b|impeller|propeller|fan\b|turbine|rotor/.test(text)) capabilities.add('rotate');
  if (/sensor|camera|measure|automatic|control|encoder|imu|switch/.test(text)) capabilities.add('measure');
  if (/hvac|heat exchanger|braz(?:e|ing)|fixture|jig/.test(text)) capabilities.add('measure');
  return [...capabilities];
}

function identity(text: string, capabilities: Capability[]) {
  const candidates: Array<[RegExp, string, string]> = [
    [/(?:fixture|jig).*(?:hvac|heat exchanger|braz)|(?:hvac|heat exchanger|braz).*(?:fixture|jig)/, 'Precision HVAC brazing fixture', 'HVAC manufacturing'],
    [/braz(?:ed|e)\s+plate|plate\s+heat exchanger|\bbphe\b/, 'Brazed plate heat exchanger', 'HVAC thermal systems'],
    [/impeller|propeller|fan\b|turbine|rotor/, 'Parametric rotating assembly', 'Rotating machinery'],
    [/bearing|flange|coupling|sprocket|cam\b|bracket|housing|enclosure|casing|manifold/, 'Parametric mechanical part', 'Mechanical design'],
    [/pump|reciprocat/, 'Reciprocating pump mechanism', 'Fluid power'],
    [/four[- ]bar|linkage/, 'Parametric linkage mechanism', 'Mechanism design'],
    [/drawbridge|folding bridge/, 'Actuated folding span', 'Civil mechanisms'],
    [/bridge|truss/, 'Parametric load-bearing span', 'Structural engineering'],
    [/gearbox|transmission|gear train/, 'Parametric power transmission', 'Power transmission'],
    [/robotic arm|robot arm|manipulat/, 'Articulated robotic mechanism', 'Robotics'],
    [/crane|hoist/, 'Counterbalanced lifting system', 'Lifting systems'],
    [/patient/, 'Smooth patient lifting mechanism', 'Medical equipment'],
    [/elevator|lift|raising/, 'Synchronized lifting mechanism', 'Lifting systems'],
    [/rover|vehicle|mobile robot/, 'Terrain-capable mobile platform', 'Mobile robotics'],
    [/solar|light source/, 'Single-axis tracking mechanism', 'Renewable energy'],
    [/suspension/, 'Compliant suspension mechanism', 'Vehicle dynamics'],
    [/recycl/, 'Material separation mechanism', 'Recycling'],
    [/sort|conveyor|warehouse|packages?/, 'Adaptive material-flow mechanism', 'Industrial automation'],
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
  const reciprocating = /pump|reciprocat/.test(text);
  const linkage = /four[- ]bar|linkage/.test(text);
  const parametricRotor = /impeller|propeller|fan\b|turbine|rotor/.test(text);
  const brazedPlateExchanger = /braz(?:ed|e)\s+plate|plate\s+heat exchanger|\bbphe\b/.test(text);
  const brazingFixture = !brazedPlateExchanger && /(?:fixture|jig)/.test(text) && /hvac|heat exchanger|braz/.test(text);

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
  if (capabilities.includes('mobile')) {
    add('payload_capacity', 'Payload capacity', 'min', values.payloadKg, 'kg', 'payloadKg');
    add('course_time', 'Course time', 'max', values.durationS, 's', 'durationS');
    add('platform_tilt', 'Platform tilt', 'max', values.tiltDeg, '°', 'tiltDeg');
    add('traction_margin', 'Traction margin', 'min', 1.1, 'x');
  }
  if (capabilities.includes('track')) {
    add('tracking_error', 'Tracking error', 'max', values.tiltDeg === 8 ? 4 : values.tiltDeg, '°', 'tiltDeg');
    add('actuator_count', 'Actuator count', 'max', /one actuator|single actuator/.test(text) ? 1 : 2, '');
    add('response_time', 'Response time', 'max', 2.5, 's');
  }
  if (capabilities.includes('lift') && !(spanSystem && capabilities.includes('rotate'))) {
    add('payload_capacity', 'Payload capacity', 'min', values.payloadKg, 'kg', 'payloadKg');
    add('lift_height', 'Lift height', 'min', values.liftM, 'm', 'liftM');
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
  if (reciprocating) {
    add('flow_rate', 'Volumetric flow', 'min', values.flowRateLpm, 'L/min', 'flowRateLpm');
    add('control_error', 'Stroke control error', 'max', 5, '%');
  }
  if (parametricRotor) {
    add('angular_travel', 'Continuous shaft rotation', 'min', 360, '°');
    add('output_speed', 'Rotor speed', 'min', values.rpm, 'rpm', 'rpm');
    add('assembly_integrity', 'Rotor assembly connectivity', 'min', 95, '%');
    add('component_count', 'Physical bodies', 'max', 24, '');
  } else if (linkage || (capabilities.includes('rotate') && !capabilities.includes('transmit') && !capabilities.includes('track') && !spanSystem)) {
    add('angular_travel', 'Angular travel', 'min', values.angleDeg, '°', 'angleDeg');
    if (linkage && values.supplied.has('strokeM')) add('lift_height', 'Linear output stroke', 'min', values.strokeM, 'm', 'strokeM');
    add('control_error', 'Position control error', 'max', 5, '%');
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

  member(primitive: 'beam' | 'cable', role: string, assemblyId: string, start: Vec3, end: Vec3, section: number, materialId = 'steel', bodyType: BodyType = 'fixed', parameters: Record<string, number | string | boolean> = {}) {
    const delta = end.map((value, index) => value - start[index]) as Vec3;
    const length = Math.max(.05, Math.hypot(...delta));
    const center = start.map((value, index) => (value + end[index]) / 2) as Vec3;
    if (primitive === 'cable') return this.component('cable', role, assemblyId, center, [section, length, section], materialId, bodyType, { ...parameters, start_x: start[0] + this.origin[0], start_y: start[1] + this.origin[1], start_z: start[2] + this.origin[2], end_x: end[0] + this.origin[0], end_y: end[1] + this.origin[1], end_z: end[2] + this.origin[2] });
    const horizontal = Math.hypot(delta[0], delta[2]);
    const rotation: Vec3 = [0, -Math.atan2(delta[2], Math.max(.0001, horizontal)), Math.atan2(delta[1], Math.max(.0001, horizontal))];
    const id = this.component('beam', role, assemblyId, center, [length, section, section], materialId, bodyType, { ...parameters, member_length: length });
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
    const anchorA = shared.map((value, index) => value - bodyA.position[index]) as Vec3;
    const anchorB = shared.map((value, index) => value - bodyB.position[index]) as Vec3;
    const value: JointBlueprint = { id: this.next(`${type}-joint`), type, componentA: a, componentB: b, anchorA, anchorB, axis, ...options };
    this.joints.push(value);
    return value.id;
  }

  motor(componentId: string, jointId: string | undefined, maxTorque: number, maxRpm: number) {
    const value = { id: this.next('motor-drive'), componentId, jointId, maxTorque, maxRpm, direction: 1 };
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

  control(name: string, mode: ControlBlueprint['mode'], sensorIds: string[], actuatorIds: string[], expression: string, setpoint: number) {
    const firstSensor = this.sensors.find((item) => item.id === sensorIds[0]);
    const sensorBody = firstSensor ? this.components.find((item) => item.id === firstSensor.componentId) : undefined;
    this.controls.push({ id: this.next(`${name}-control`), name, mode, sensorIds, actuatorIds, expression, setpoint, kp: .55, ki: .02, kd: .08, calibrationX: sensorBody?.position[0] ?? 0 });
  }
}

function addSpanMembers(context: ModuleContext): ModuleResult {
  const { builder, text, values, rootAssemblyId } = context;
  const assembly = builder.assembly('span members', 'Supports, deck plates, braces, bearings, and optional hinge drive', rootAssemblyId);
  const folding = /drawbridge|fold|hing|open|raise/.test(text);
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
  const chassis = builder.component('plate', 'mobile chassis deck', assembly, [0, .9, 0], [length, .24, width], 'aluminum', 'dynamic', { payload_kg: values.payloadKg });
  const wheelPositions: Vec3[] = [[-length * .35, .52, -width * .52], [-length * .35, .52, width * .52], [length * .35, .52, -width * .52], [length * .35, .52, width * .52]];
  wheelPositions.forEach((position, index) => {
    const wheel = builder.component('wheel', `road wheel ${index + 1}`, assembly, position, [.7 + values.payloadKg / 500, .24, .7 + values.payloadKg / 500], 'rubber', 'dynamic', { friction: 1.05 });
    const axle = builder.joint('revolute', chassis, wheel, [0, 0, 1]);
    if (index >= 2) {
      const motor = builder.component('motor', `traction motor ${index - 1}`, assembly, [position[0], .66, position[2] * .72], undefined, undefined, 'kinematic');
      builder.motor(motor, axle, Math.max(38, values.payloadKg * 1.85), 150);
      builder.connect(motor, wheel, 'power', 'traction_power');
    }
    if (context.capabilities.includes('stabilize')) {
      const stiffness = Math.max(15000, values.payloadKg * 680);
      const spring = builder.component('spring', `suspension element ${index + 1}`, assembly, [position[0], .82, position[2] * .78], [.12, .55, .12], 'steel', 'dynamic', { stiffness, damping: 2100 });
      builder.joint('spring', chassis, wheel, [0, 1, 0], { stiffness, damping: 2100, limits: [0, .55] });
      builder.connect(spring, chassis, 'mechanical', 'spring_mount');
    }
  });
  const payload = builder.component('container', 'mobile payload', assembly, [0, 1.32, 0], [1.1, .58, .85], 'polymer', 'dynamic', { payload_kg: values.payloadKg }, values.payloadKg);
  builder.joint('fixed', chassis, payload);
  const imu = builder.component('sensor', 'chassis imu', assembly, [-.4, 1.28, 0], undefined, undefined, 'fixed');
  const controller = builder.component('controller', 'traction controller', assembly, [.4, 1.25, 0], undefined, undefined, 'fixed');
  const sensor = builder.sensor(imu, 'imu', 'platform_tilt', chassis, 5);
  builder.control('traction stability', 'pid', [sensor], [], 'limit wheel torque when tilt or slip rises', values.tiltDeg);
  builder.joint('fixed', imu, chassis); builder.joint('fixed', controller, chassis);
  return { id: 'rolling-support', mountId: chassis, editableId: imu, handles: ['mobile', 'stabilize'] };
}

function addRotaryTransmission(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('rotary transmission', 'Shafts and a parameterized gear mesh', rootAssemblyId);
  const base = builder.component('frame', 'open gearbox housing', assembly, [0, .45, 0], [3.6, .22, 2.2], 'aluminum', 'fixed', { gearbox_housing: true });
  const inputShaft = builder.component('shaft', 'input shaft', assembly, [-.85, 1.45, 0], [.16, 1.5, .16], 'steel', 'dynamic', { rpm: values.rpm });
  const outputShaft = builder.component('shaft', 'output shaft', assembly, [.85, 1.45, 0], [.22, 1.5, .22], 'steel', 'dynamic');
  builder.rotate(inputShaft, [Math.PI / 2, 0, 0]); builder.rotate(outputShaft, [Math.PI / 2, 0, 0]);
  const inputRadius = .32;
  const outputRadius = Math.min(1.45, inputRadius * values.ratio);
  const inputGear = builder.component('gear', 'input gear', assembly, [-.85, 1.45, 0], [inputRadius * 2, .18, inputRadius * 2], 'steel', 'dynamic', { teeth: 18, pitch_radius: inputRadius, mesh_efficiency: .85 });
  const outputGear = builder.component('gear', 'output gear', assembly, [.85, 1.45, 0], [outputRadius * 2, .22, outputRadius * 2], 'steel', 'dynamic', { teeth: Math.round(18 * values.ratio), pitch_radius: outputRadius, mesh_efficiency: .85 });
  const inputJoint = builder.joint('revolute', base, inputShaft, [0, 0, 1]);
  builder.joint('fixed', inputShaft, inputGear);
  builder.joint('revolute', base, outputShaft, [0, 0, 1]);
  builder.joint('fixed', outputShaft, outputGear);
  builder.joint('gear', inputGear, outputGear, [0, 0, 1], { ratio: values.ratio });
  const motor = builder.component('motor', 'input drive motor', assembly, [-.85, 1.45, -1.02], [.46, .64, .46], 'steel', 'kinematic');
  builder.rotate(motor, [Math.PI / 2, 0, 0]);
  builder.motor(motor, inputJoint, Math.max(15, values.torqueNm / values.ratio * .72), values.rpm);
  builder.connect(motor, inputShaft, 'power', 'input_torque');
  const encoder = builder.component('sensor', 'output encoder', assembly, [.85, 1.78, .42], undefined, undefined, 'fixed');
  const sensor = builder.sensor(encoder, 'speed', 'output_rpm', outputShaft, 2);
  builder.control('speed governor', 'pid', [sensor], [], 'hold output speed at input rpm divided by gear ratio', values.rpm / values.ratio);
  builder.joint('fixed', encoder, base);
  return { id: 'rotary-transmission', mountId: base, editableId: encoder, handles: ['transmit', 'rotate'], inputId: inputShaft, outputId: outputShaft };
}

function addSerialLinkage(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('serial linkage', 'Rotary links, joint drives, and a constructed end-effector chain', rootAssemblyId);
  const base = builder.component('plate', 'linkage base', assembly, [0, .16, 0], [1.8, .25, 1.65], 'steel', 'fixed', { industrial_base: true });
  const pedestal = builder.component('support', 'rotating pedestal', assembly, [0, .92, 0], [.62, 1.45, .62], 'steel', 'dynamic', { joint_housing: true });
  builder.joint('revolute', base, pedestal, [0, 1, 0], { limits: [-Math.PI, Math.PI] });
  let parent = pedestal;
  const linkLength = values.reachM / 3;
  const actuators: string[] = [];
  let jointPoint: Vec3 = [0, 1.55, 0];
  const linkAngles = [35, 18, -22].map((angle) => angle * Math.PI / 180);
  for (let index = 0; index < 3; index += 1) {
    const angle = linkAngles[index];
    const nextPoint: Vec3 = [jointPoint[0] + Math.cos(angle) * linkLength, jointPoint[1] + Math.sin(angle) * linkLength, 0];
    const link = builder.member('beam', `serial link ${index + 1}`, assembly, jointPoint, nextPoint, .26 - index * .025, 'aluminum', 'dynamic', { link_length: linkLength, hollow_section: true });
    const joint = builder.joint('revolute', parent, link, [0, 0, 1], { limits: [-1.8, 1.8] });
    const servo = builder.component('servo', `link servo ${index + 1}`, assembly, [jointPoint[0], jointPoint[1], -.2], [.42 - index * .04, .32, .42 - index * .04], 'steel', 'kinematic', { joint_housing: true });
    builder.rotate(servo, [Math.PI / 2, 0, 0]);
    actuators.push(builder.actuator(servo, joint, 'servo', Math.max(110, values.payloadKg * 9.81 * values.reachM * .62), 1.8, 3.6));
    builder.connect(servo, link, 'power', 'joint_drive');
    parent = link; jointPoint = nextPoint;
  }
  const gripper = builder.component('gripper', 'constructed parallel gripper', assembly, [jointPoint[0] + .24, jointPoint[1], 0], [.58, .32, .72], 'steel', 'kinematic', { payload_kg: values.payloadKg });
  builder.joint('fixed', parent, gripper);
  const camera = builder.component('camera', 'tool pose camera', assembly, [jointPoint[0] - .05, jointPoint[1] + .3, 0], [.24, .18, .24], 'polymer', 'fixed');
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
  const pulleyJoint = builder.joint('revolute', boom, pulley, [0, 0, 1]);
  const hookY = Math.max(1.15, boomEnd[1] - Math.max(2.1, values.liftM));
  const cable = builder.member('cable', 'load cable', assembly, boomEnd, [boomEnd[0], hookY + .28, 0], .035, 'steel', 'dynamic', { rigging: true });
  const hook = builder.component('hook', 'forged load hook', assembly, [boomEnd[0], hookY, 0], [.24, .42, .1], 'steel', 'dynamic');
  const ropeJoint = builder.joint('rope', pulley, hook, [0, 1, 0], { limits: [0, Math.max(1.5, values.liftM)] });
  builder.connect(cable, hook, 'mechanical', 'cable_termination');
  const payload = builder.component('container', 'suspended payload', assembly, [boomEnd[0], hookY - .55, 0], [1.25, .48, .62], 'steel', 'dynamic', { payload_kg: values.payloadKg, rigged_load: true }, values.payloadKg);
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

function addParallelGuides(context: ModuleContext): ModuleResult {
  const { builder, values, rootAssemblyId } = context;
  const assembly = builder.assembly('parallel linear guides', 'Load platform, parallel slides, pistons, and cross-level feedback', rootAssemblyId);
  const base = builder.component('frame', 'guide base', assembly, [0, .16, 0], [3.4, .28, 2.4], 'steel', 'fixed');
  const left = builder.component('beam', 'left linear guide', assembly, [-1.25, 1.8, 0], [.24, 3.5, .24], 'steel', 'fixed');
  const right = builder.component('beam', 'right linear guide', assembly, [1.25, 1.8, 0], [.24, 3.5, .24], 'steel', 'fixed');
  const platform = builder.component('plate', 'guided load platform', assembly, [0, .72, 0], [2.8, .22, 1.9], 'aluminum', 'dynamic', { payload_kg: values.payloadKg });
  builder.joint('fixed', base, left); builder.joint('fixed', base, right);
  const actuators: string[] = [];
  [left, right].forEach((guide, index) => {
    const joint = builder.joint('prismatic', guide, platform, [0, 1, 0], { limits: [0, values.liftM] });
    const piston = builder.component('piston', `linear drive ${index + 1}`, assembly, [index ? .9 : -.9, .75, 0], [.26, Math.max(1.2, values.liftM), .26], 'steel', 'kinematic');
    actuators.push(builder.actuator(piston, joint, 'piston', Math.max(850, values.payloadKg * 9.81 * .38), .35, values.liftM));
  });
  const payload = builder.component('container', 'platform payload', assembly, [0, 1.08, 0], [1.15, .55, .85], 'polymer', 'dynamic', { payload_kg: values.payloadKg }, values.payloadKg);
  builder.joint('fixed', platform, payload);
  const imu = builder.component('sensor', 'platform level sensor', assembly, [-.35, 1, 0], undefined, undefined, 'fixed');
  const sensor = builder.sensor(imu, 'imu', 'platform_level', platform, 4);
  builder.control('cross level', 'synchronized', [sensor], actuators, 'synchronize slide travel and limit acceleration', values.acceleration);
  builder.joint('fixed', imu, platform);
  return { id: 'parallel-guides', mountId: base, editableId: imu, handles: ['lift', 'stabilize'] };
}

function addMaterialFlow(context: ModuleContext): ModuleResult {
  const { builder, values, capabilities, rootAssemblyId } = context;
  const assembly = builder.assembly('material flow path', 'Powered surface, sensing, routing, and collection primitives', rootAssemblyId);
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
    actuatorIds.push(builder.actuator(motor, routerJoint, 'servo', 330, 2.2, 1.5));
    const rampA = builder.component('ramp', 'red output chute', assembly, [2.45, .72, -.9], [2.25, .14, .86], 'aluminum', 'fixed', { sorting_chute: true, route_color: 'red' });
    builder.rotate(rampA, [0, .48, -.08]);
    builder.connect(conveyor, rampA, 'mechanical', 'output_path');
    if (!minimal) {
      const rampB = builder.component('ramp', 'blue output chute', assembly, [2.45, .72, .9], [2.25, .14, .86], 'aluminum', 'fixed', { sorting_chute: true, route_color: 'blue' });
      builder.rotate(rampB, [0, -.48, -.08]);
      builder.connect(conveyor, rampB, 'mechanical', 'alternate_path');
    }
    if (contain) {
      const binA = builder.component('container', 'red collection bin', assembly, [3.65, .5, -1.85], [1.25, .95, 1.15], 'polymer', 'fixed', { sorting_bin: true, route_color: 'red' }, 18);
      const binB = builder.component('container', 'blue collection bin', assembly, [3.65, .5, 1.85], [1.25, .95, 1.15], 'polymer', 'fixed', { sorting_bin: true, route_color: 'blue' }, 18);
      builder.connect(rampA, binA, 'mechanical', 'collection_path');
      builder.connect(conveyor, binB, 'mechanical', 'collection_path');
    }
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
  const assembly = builder.assembly('tracking axis', 'Support, pivoting panel, one actuator, and independent sensing', rootAssemblyId);
  const base = builder.component('frame', 'tracking base', assembly, [0, .15, 0], [2.8, .26, 2.1], 'steel', 'fixed');
  const mast = builder.component('beam', 'tracking mast', assembly, [0, 1.3, 0], [.3, 2.5, .3], 'steel', 'fixed');
  const panel = builder.component('plate', 'tracked panel', assembly, [0, 2.55, 0], [3.4, .14, 2.1], 'composite', 'dynamic', { panel: true });
  builder.joint('fixed', base, mast);
  const hinge = builder.joint('revolute', mast, panel, [0, 0, 1], { limits: [-1.25, 1.25] });
  const servo = builder.component('servo', 'tracking servo', assembly, [0, 2.22, -.42], undefined, undefined, 'kinematic');
  const actuator = builder.actuator(servo, hinge, 'servo', 700, .7, 2.5);
  const sensorBody = builder.component('sensor', 'dual light sensor', assembly, [-1.2, 2.72, 0], undefined, undefined, 'fixed');
  const sensor = builder.sensor(sensorBody, 'light', 'light_error', panel, 10);
  builder.control('light tracking', 'tracking', [sensor], [actuator], 'drive light error toward zero inside hinge limits', 0);
  builder.connect(sensorBody, servo, 'signal', 'tracking_error');
  return { id: 'tracking-axis', mountId: base, editableId: sensorBody, handles: ['track', 'rotate', 'measure'] };
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

function addParametricCadPart(context: ModuleContext): ModuleResult {
  const { builder, text, values, rootAssemblyId } = context;
  const assembly = builder.assembly('parametric cad part', 'Feature-driven part recipe composed from revolved, extruded, swept, and patterned primitive bodies', rootAssemblyId);
  const rotatingBlade = /impeller|propeller|fan\b|turbine|rotor/.test(text);
  if (rotatingBlade) {
    const base = builder.component('frame', 'rotor inspection stand', assembly, [0, .18, 0], [3.2, .3, 2.4], 'steel', 'fixed');
    const support = builder.component('beam', 'rotor bearing pedestal', assembly, [0, 1.35, -.42], [.36, 2.25, .36], 'steel', 'fixed');
    builder.joint('fixed', base, support);
    const hub = builder.component('wheel', 'machined rotor hub', assembly, [0, 2.1, 0], [1, .34, 1], 'aluminum', 'dynamic', { cad_form: 'rotor_hub' });
    const shaftJoint = builder.joint('revolute', support, hub, [0, 0, 1], { limits: [-Math.PI, Math.PI] });
    const bladeCount = 6;
    for (let index = 0; index < bladeCount; index += 1) {
      const angle = index / bladeCount * Math.PI * 2;
      const blade = builder.component('beam', `aerodynamic blade ${index + 1}`, assembly, [Math.cos(angle) * .92, 2.1 + Math.sin(angle) * .92, 0], [1.45, .18, .36], 'composite', 'dynamic', { cad_form: 'aero_blade', blade_index: index, blade_count: bladeCount });
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
  const form = /bearing/.test(text) ? 'bearing' : /flange/.test(text) ? 'flange' : /coupling/.test(text) ? 'coupling' : /sprocket/.test(text) ? 'sprocket' : /cam\b/.test(text) ? 'cam' : /bracket/.test(text) ? 'angle_bracket' : /housing|enclosure|casing/.test(text) ? 'housing' : /manifold|duct|pipe/.test(text) ? 'manifold' : 'machined_part';
  const primitive: PrimitiveKind = ['bearing', 'flange'].includes(form) ? 'wheel' : form === 'coupling' || form === 'manifold' ? 'shaft' : ['sprocket', 'cam'].includes(form) ? 'gear' : form === 'housing' ? 'frame' : 'plate';
  const dimensions: Vec3 = form === 'housing' ? [2.1, 1.5, 1.65] : form === 'angle_bracket' ? [1.65, 1.25, 1.25] : form === 'manifold' ? [.72, 1.8, .72] : ['bearing', 'flange', 'sprocket', 'cam'].includes(form) ? [1.6, .32, 1.6] : [.82, 1.35, .82];
  const part = builder.component(primitive, form.replaceAll('_', ' '), assembly, [0, 1.28, 0], dimensions, form === 'angle_bracket' ? 'aluminum' : 'steel', ['bearing', 'flange', 'coupling', 'sprocket', 'cam'].includes(form) ? 'dynamic' : 'fixed', { cad_form: form, feature_holes: 6, wall_thickness: .08 });
  builder.connect(base, part, 'mechanical', 'inspection_fixture');
  if (['bearing', 'flange', 'coupling', 'sprocket', 'cam'].includes(form)) {
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
  ['beam', /\bbeams?\b/], ['plate', /\bplates?\b/], ['frame', /\bframes?\b/], ['wheel', /\bwheels?\b/],
  ['shaft', /\bshafts?\b/], ['gear', /\bgears?\b/], ['pulley', /\bpulleys?\b/], ['belt', /\bbelts?\b/],
  ['motor', /\bmotors?\b/], ['servo', /\bservos?\b/], ['piston', /\bpistons?\b/], ['spring', /\bsprings?\b/],
  ['sensor', /\bsensors?\b/], ['camera', /\bcameras?\b/], ['conveyor', /\bconveyors?\b/], ['ramp', /\bramps?\b/],
  ['gripper', /\bgrippers?\b/], ['container', /\bcontainers?\b/], ['counterweight', /\bcounterweights?\b/],
  ['cable', /\bcables?\b/], ['hook', /\bhooks?\b/], ['roller', /\brollers?\b/],
];

function requestedPrimitiveCounts(text: string) {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const result = new Map<PrimitiveKind, number>();
  for (const [kind, noun] of requestedPrimitivePatterns) {
    const source = noun.source.replace(/^\\b|\\b$/g, '');
    const match = text.match(new RegExp(`(?:(one|two|three|four|five|six|seven|eight|\\d+)\\s*[- ]?\\s*)?${source}\\b`));
    if (!match) continue;
    result.set(kind, match[1] ? words[match[1]] ?? Number(match[1]) : 1);
  }
  return result;
}

function addRequestedPrimitiveBodies(context: ModuleContext, missing: Array<[PrimitiveKind, number]>, mountId: string): ModuleResult {
  const { builder, rootAssemblyId } = context;
  const assembly = builder.assembly('requested primitive extension', 'Explicitly requested bodies integrated into the composed mechanism', rootAssemblyId);
  const created: string[] = [];
  const actuators: string[] = [];
  const sensors: string[] = [];
  let offset = 0;
  for (const [kind, count] of missing) for (let index = 0; index < count; index += 1) {
    offset += 1;
    const dynamic = ['gear', 'wheel', 'pulley', 'piston', 'servo', 'gripper', 'hook', 'spring'].includes(kind);
    const body = builder.component(kind, `requested ${kind} ${index + 1}`, assembly, [1.2 + offset * .62, 1.05 + (offset % 2) * .5, (offset % 3 - 1) * .55], undefined, undefined, dynamic ? 'dynamic' : undefined);
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
  { id: 'span-members', matches: ({ text }) => /bridge|truss|structural span/.test(text), compose: addSpanMembers },
  { id: 'rolling-support', matches: ({ capabilities }) => capabilities.includes('mobile'), compose: addRollingSupport },
  { id: 'rotary-transmission', matches: ({ capabilities }) => capabilities.includes('transmit'), compose: addRotaryTransmission },
  { id: 'serial-linkage', matches: ({ capabilities }) => capabilities.includes('manipulate'), compose: addSerialLinkage },
  { id: 'cable-suspension', matches: ({ text, capabilities }) => capabilities.includes('lift') && capabilities.includes('suspend') && !/bridge|truss/.test(text), compose: addCableSuspension },
  { id: 'parallel-guides', matches: ({ text, capabilities }) => capabilities.includes('lift') && !capabilities.includes('suspend') && !/bridge|truss/.test(text), compose: addParallelGuides },
  { id: 'material-flow', matches: ({ capabilities }) => capabilities.includes('transport'), compose: addMaterialFlow },
  { id: 'tracking-axis', matches: ({ capabilities }) => capabilities.includes('track'), compose: addTrackingAxis },
  { id: 'reciprocating-linkage', matches: ({ text }) => /pump|reciprocat/.test(text), compose: addReciprocatingLinkage },
  { id: 'closed-linkage', matches: ({ text }) => /four[- ]bar|linkage/.test(text), compose: addFourBar },
  { id: 'parametric-cad-part', matches: ({ text }) => /bearing|flange|coupling|sprocket|cam\b|impeller|propeller|fan\b|turbine|rotor|bracket|housing|enclosure|casing|manifold|duct|pipe/.test(text) && !/hvac|heat exchanger|braz/.test(text), compose: addParametricCadPart },
];

export function compileDesignBrief(raw: string): CompiledWorldPlan {
  const brief = normalize(raw);
  if (brief.length < 12) throw new Error('VAGUE_GOAL: Describe the physical system, what it should do, and a measurable outcome.');
  if (brief.length > 500) throw new Error('OUT_OF_RANGE: Keep the engineering brief under 500 characters.');
  if (/\b(?:do not|don['’]?t|never)\s+(?:build|design|create|engineer)\b/i.test(brief)) throw new Error('NEGATED_GOAL: The brief explicitly says not to engineer the system.');

  const text = brief.toLowerCase();
  const capabilities = inferCapabilities(text);
  const values = parseValues(text);
  const constraints = constraintsFor(text, capabilities, values);
  const builder = new WorldBuilder();
  const rootAssemblyId = builder.assembly('engineered world', 'Root assembly for independently composable mechanism modules');
  builder.setRoot(rootAssemblyId);
  const selectionContext = { text, capabilities, values };
  const selectedRules = moduleRules.filter((rule) => rule.matches(selectionContext));
  const rules: ModuleRule[] = selectedRules.length ? selectedRules : [{ id: 'constructed-motion', matches: () => true, compose: addGenericMotion }];
  const spacing = rules.length > 1 ? Math.min(4.8, 10 / Math.max(1, rules.length - 1)) : 0;
  const modules = rules.map((rule, index) => builder.at([(index - (rules.length - 1) / 2) * spacing, 0, 0], () => rule.compose({ builder, text, capabilities, values, rootAssemblyId })));

  const handled = new Set(modules.flatMap((module) => module.handles));
  if (capabilities.includes('rotate') && !handled.has('rotate')) {
    modules.push(builder.at([modules.length ? Math.max(4.8, spacing) * modules.length / 2 : 0, 0, 0], () => addGenericMotion({ builder, text, capabilities, values, rootAssemblyId })));
  }
  const requested = requestedPrimitiveCounts(text);
  const missing = [...requested.entries()].map(([kind, count]) => [kind, Math.max(0, count - builder.components.filter((item) => item.primitive === kind).length)] as [PrimitiveKind, number]).filter(([, count]) => count > 0);
  if (missing.length) modules.push(builder.at([Math.max(4.8, spacing || 4.8) * modules.length / 2, 0, 0], () => addRequestedPrimitiveBodies({ builder, text, capabilities, values, rootAssemblyId }, missing, modules[0].mountId)));
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
  };

  return {
    brief,
    goal,
    world: { ...worldDefaults, duration: Math.min(12, Math.max(6, Math.min(values.durationS, 12))), bounds: modules.length > 1 ? [22, 10, 14] : [...worldDefaults.bounds] },
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
}
