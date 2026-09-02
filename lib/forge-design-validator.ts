import { buildEngineeringPlan, normalizeEngineeringIntent } from './forge-intent';
import type { CompiledWorldPlan, ComponentBlueprint } from './forge-types';

export type DesignIssueSeverity = 'error' | 'warning' | 'repair';
export interface DesignIssue {
  code: string;
  severity: DesignIssueSeverity;
  message: string;
  componentIds: string[];
}

const textFor = (component: ComponentBlueprint) => `${component.role} ${Object.keys(component.parameters ?? {}).join(' ')}`.toLowerCase();

function hasMechanicalSupport(plan: CompiledWorldPlan, componentId: string) {
  return plan.joints.some((joint) => joint.componentA === componentId || joint.componentB === componentId)
    || plan.connections.some((connection) => connection.type === 'mechanical' && (connection.sourceId === componentId || connection.targetId === componentId));
}

function validateCompleteness(plan: CompiledWorldPlan, prompt: string, issues: DesignIssue[]) {
  const intent = normalizeEngineeringIntent(prompt);
  const components = plan.components;
  const count = (primitive: string) => components.filter((component) => component.primitive === primitive).length;
  const roles = components.map(textFor).join(' ');
  const requireSubsystem = (ok: boolean, code: string, message: string) => { if (!ok) issues.push({ code, severity: 'error', message, componentIds: [] }); };
  if (intent.machineType === 'bicycle') {
    requireSubsystem(count('wheel') >= 2, 'BICYCLE_WHEELS_MISSING', 'A bicycle needs separate front and rear wheels.');
    requireSubsystem(/handlebar|steering/.test(roles), 'BICYCLE_STEERING_MISSING', 'A bicycle needs a recognizable steering control.');
    requireSubsystem(/saddle|seat/.test(roles), 'BICYCLE_SEAT_MISSING', 'A bicycle needs a supported saddle.');
    requireSubsystem(/chain|crank|drive/.test(roles), 'BICYCLE_DRIVE_MISSING', 'A bicycle needs a recognizable drivetrain.');
  }
  if (intent.machineType === 'fixed-wing-aircraft') {
    requireSubsystem(count('fuselage') >= 1, 'AIRCRAFT_FUSELAGE_MISSING', 'A fixed-wing aircraft needs a fuselage.');
    requireSubsystem(components.some((item) => /left main wing/.test(item.role.toLowerCase())) && components.some((item) => /right main wing/.test(item.role.toLowerCase())), 'AIRCRAFT_WINGS_INCOMPLETE', 'A fixed-wing aircraft needs distinct left and right main wings.');
    requireSubsystem(count('landing-gear') >= 2, 'AIRCRAFT_LANDING_GEAR_MISSING', 'The aircraft needs supported landing gear.');
    requireSubsystem(count('propeller') + count('rotor') >= 1, 'AIRCRAFT_PROPULSION_MISSING', 'The aircraft needs a visible propulsor.');
  }
  if (intent.machineType === 'go-kart') {
    requireSubsystem(count('wheel') >= 4, 'KART_WHEELS_MISSING', 'A go-kart needs four separately represented road wheels.');
    requireSubsystem(/steering wheel/.test(roles), 'KART_STEERING_MISSING', 'A go-kart needs a steering wheel and steering path.');
    requireSubsystem(/seat/.test(roles), 'KART_SEAT_MISSING', 'A go-kart needs a supported driver seat.');
  }
}

function validateLighting(plan: CompiledWorldPlan, prompt: string, issues: DesignIssue[]) {
  const normalized = normalizeEngineeringIntent(prompt).normalizedRequest.toLowerCase();
  const wantsBrakeLight = /\b(?:brake|rear) lights?\b/.test(normalized);
  const wantsForwardLight = /\b(?:headlights?|head lamps?|landing lights?|front lights?)\b/.test(normalized);
  const brakeLights = plan.components.filter((component) => component.primitive === 'light' && /brake|rear light|tail light|taillight/.test(textFor(component)));
  const forwardLights = plan.components.filter((component) => component.primitive === 'light' && /headlight|head lamp|landing light|front light/.test(textFor(component)));
  if (wantsBrakeLight && !brakeLights.length) issues.push({ code: 'BRAKE_LIGHT_MISSING', severity: 'error', message: 'The requested rear brake light was not created.', componentIds: [] });
  if (wantsForwardLight && !forwardLights.length) issues.push({ code: 'FORWARD_LIGHT_MISSING', severity: 'error', message: 'The requested forward-facing light was not created.', componentIds: [] });
  for (const light of brakeLights) {
    if (Number(light.parameters?.facing_x ?? 0) !== -1 || light.parameters?.light_direction !== 'rear' || light.parameters?.facing_axis !== '-X') issues.push({ code: 'BRAKE_LIGHT_DIRECTION', severity: 'repair', message: `${light.role} must face rearward (-X).`, componentIds: [light.id] });
    const supports = plan.connections.filter((edge) => edge.type === 'mechanical' && (edge.sourceId === light.id || edge.targetId === light.id))
      .map((edge) => edge.sourceId === light.id ? edge.targetId : edge.sourceId);
    const invalid = !supports.length || supports.every((id) => {
      const support = plan.components.find((component) => component.id === id);
      return !support || support.primitive === 'wheel' || support.bodyType === 'dynamic';
    });
    if (invalid) issues.push({ code: 'BRAKE_LIGHT_SUPPORT', severity: 'error', message: `${light.role} must mount to a stationary frame, rack, seat-post, or body support—not a tire.`, componentIds: [light.id, ...supports] });
  }
  for (const light of forwardLights) if (Number(light.parameters?.facing_x ?? 0) !== 1 || light.parameters?.light_direction !== 'front' || light.parameters?.facing_axis !== '+X') {
    issues.push({ code: 'FORWARD_LIGHT_DIRECTION', severity: 'repair', message: `${light.role} must face forward (+X).`, componentIds: [light.id] });
  }
  for (const light of plan.components.filter((component) => component.parameters?.aircraft_navigation_light)) {
    const side = String(light.parameters?.navigation_side ?? '');
    const expected = side === 'left' ? { axis: '-Z', color: '#ff3344' } : side === 'right' ? { axis: '+Z', color: '#32e875' } : { axis: '-X', color: '#f3f8ff' };
    if (light.parameters?.facing_axis !== expected.axis || light.color?.toLowerCase() !== expected.color) issues.push({ code: 'AIRCRAFT_NAV_LIGHT', severity: 'repair', message: `${light.role} has the wrong navigation-light color or orientation.`, componentIds: [light.id] });
  }
}

function validateVehicleGeometry(plan: CompiledWorldPlan, prompt: string, issues: DesignIssue[]) {
  const intent = normalizeEngineeringIntent(prompt);
  if (intent.machineType !== 'go-kart') return;
  const items = (key: string) => plan.components.filter((component) => component.parameters?.[key]);
  const required: Array<[string, number, string]> = [
    ['road_vehicle_kingpin', 2, 'near-vertical kingpins'], ['road_vehicle_steering_knuckle', 2, 'steering knuckles'],
    ['road_vehicle_spindle', 4, 'horizontal wheel spindles'], ['road_vehicle_wheel_hub', 4, 'wheel hubs and bearings'],
    ['road_vehicle_steering_tie_rod', 2, 'tie rods'], ['road_vehicle_steering_rack', 1, 'steering rack'],
  ];
  for (const [key, minimum, label] of required) if (items(key).length < minimum) issues.push({ code: `KART_${key.toUpperCase()}_MISSING`, severity: 'error', message: `The go-kart requires ${label}.`, componentIds: items(key).map((item) => item.id) });
  for (const joint of plan.joints) {
    const a = plan.components.find((component) => component.id === joint.componentA);
    const b = plan.components.find((component) => component.id === joint.componentB);
    if (joint.type === 'revolute' && (a?.parameters?.road_vehicle_kingpin || b?.parameters?.road_vehicle_steering_knuckle) && Math.abs(joint.axis[1]) < .95) issues.push({ code: 'KART_KINGPIN_AXIS', severity: 'repair', message: `${joint.id} must pivot around the near-vertical Y kingpin axis.`, componentIds: [joint.componentA, joint.componentB] });
    if (joint.type === 'revolute' && (a?.parameters?.road_vehicle_spindle || b?.parameters?.road_vehicle_wheel_hub) && Math.abs(joint.axis[2]) < .95) issues.push({ code: 'KART_SPINDLE_AXIS', severity: 'repair', message: `${joint.id} must spin around the horizontal Z axle axis.`, componentIds: [joint.componentA, joint.componentB] });
  }
}

function validateWindshields(plan: CompiledWorldPlan, issues: DesignIssue[]) {
  const windshields = plan.components.filter((component) => component.parameters?.cockpit_windshield || /windshield|windscreen/.test(component.role.toLowerCase()));
  for (const windshield of windshields) {
    if (!windshield.parameters?.transparent_glazing || windshield.parameters?.facing_axis !== '+X') issues.push({ code: 'WINDSHIELD_PROPERTIES', severity: 'repair', message: `${windshield.role} must be transparent and face +X.`, componentIds: [windshield.id] });
    if (Math.abs(windshield.position[2]) > Math.max(.12, windshield.dimensions[2] * .18) || windshield.dimensions[1] < .3 || windshield.dimensions[2] < .5) issues.push({ code: 'WINDSHIELD_PROPORTION', severity: 'repair', message: `${windshield.role} must be centered and large enough for the driver sightline.`, componentIds: [windshield.id] });
    if (!hasMechanicalSupport(plan, windshield.id)) issues.push({ code: 'WINDSHIELD_SUPPORT', severity: 'error', message: `${windshield.role} must attach to the cockpit or body frame.`, componentIds: [windshield.id] });
  }
}

function validateUnexpectedSystems(plan: CompiledWorldPlan, prompt: string, issues: DesignIssue[]) {
  const normalized = normalizeEngineeringIntent(prompt).normalizedRequest.toLowerCase();
  if (!/\b(?:bicycle|bike)\b/.test(normalized) || /\b(?:electric|e-bike|pedal assist|motor|solar)\b/.test(normalized)) return;
  const unexpected = plan.components.filter((component) => component.parameters?.bicycle_hub_motor || component.parameters?.bicycle_battery || component.parameters?.bicycle_controller || /traction battery|electric drive controller|electric motor/.test(component.role.toLowerCase()));
  if (unexpected.length) issues.push({ code: 'UNREQUESTED_BICYCLE_ELECTRIC_SYSTEM', severity: 'repair', message: 'A regular bicycle must not gain an unrequested electric drivetrain.', componentIds: unexpected.map((component) => component.id) });
}

function validateReferencesAndBounds(plan: CompiledWorldPlan, issues: DesignIssue[]) {
  const ids = new Set(plan.components.map((component) => component.id));
  for (const joint of plan.joints) if (!ids.has(joint.componentA) || !ids.has(joint.componentB)) issues.push({ code: 'JOINT_REFERENCE', severity: 'error', message: `${joint.id} references a missing body.`, componentIds: [joint.componentA, joint.componentB] });
  for (const edge of plan.connections) if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) issues.push({ code: 'CONNECTION_REFERENCE', severity: 'error', message: `${edge.id} references a missing body.`, componentIds: [edge.sourceId, edge.targetId] });
  for (const component of plan.components) {
    if (component.dimensions.some((value) => !Number.isFinite(value) || value < .01)) issues.push({ code: 'INVALID_DIMENSIONS', severity: 'error', message: `${component.role} has invalid physical dimensions.`, componentIds: [component.id] });
    if (!hasMechanicalSupport(plan, component.id) && component.bodyType !== 'fixed' && component.parameters?.semantic_payload !== true && !component.parameters?.product_form) issues.push({ code: 'UNSUPPORTED_COMPONENT', severity: 'warning', message: `${component.role} is not connected to a supported assembly.`, componentIds: [component.id] });
    const outside = component.position.some((value, axis) => Math.abs(value) + component.dimensions[axis] / 2 > plan.world.bounds[axis] / 2 + .01);
    if (outside) issues.push({ code: 'WORLD_BOUNDS', severity: 'repair', message: `${component.role} extends outside the declared physical world.`, componentIds: [component.id] });
    if (component.primitive === 'wheel') {
      const diameter = Math.max(component.dimensions[0], component.dimensions[2]);
      const width = Math.min(component.dimensions[0], component.dimensions[1], component.dimensions[2]);
      if (width > diameter * .72) issues.push({ code: 'WHEEL_PROPORTION', severity: 'warning', message: `${component.role} is unusually wide relative to its diameter.`, componentIds: [component.id] });
    }
  }
  const physicallyLinked = new Set([
    ...plan.joints.map((joint) => [joint.componentA, joint.componentB].sort().join('|')),
    ...plan.connections.filter((edge) => edge.type === 'mechanical').map((edge) => [edge.sourceId, edge.targetId].sort().join('|')),
  ]);
  for (let leftIndex = 0; leftIndex < plan.components.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < plan.components.length; rightIndex += 1) {
    const left = plan.components[leftIndex], right = plan.components[rightIndex];
    if (physicallyLinked.has([left.id, right.id].sort().join('|')) || left.parameters?.product_form || right.parameters?.product_form) continue;
    const overlap = [0, 1, 2].map((axis) => Math.max(0, Math.min(left.position[axis] + left.dimensions[axis] / 2, right.position[axis] + right.dimensions[axis] / 2)
      - Math.max(left.position[axis] - left.dimensions[axis] / 2, right.position[axis] - right.dimensions[axis] / 2)));
    const intersection = overlap[0] * overlap[1] * overlap[2];
    const smaller = Math.min(left.dimensions[0] * left.dimensions[1] * left.dimensions[2], right.dimensions[0] * right.dimensions[1] * right.dimensions[2]);
    if (smaller > 0 && intersection / smaller > .82) issues.push({ code: 'SEVERE_OVERLAP', severity: 'warning', message: `${left.role} and ${right.role} occupy nearly the same volume.`, componentIds: [left.id, right.id] });
  }
}

function repairLighting(plan: CompiledWorldPlan, issues: DesignIssue[]) {
  const repaired: string[] = [];
  for (const issue of issues.filter((item) => item.code === 'BRAKE_LIGHT_DIRECTION')) {
    const light = plan.components.find((component) => component.id === issue.componentIds[0]);
    if (!light) continue;
    light.parameters = { ...(light.parameters ?? {}), brake_light: true, vehicle_light: true, light_direction: 'rear', facing_axis: '-X', facing_x: -1, beam_range: Math.min(2.4, Number(light.parameters?.beam_range ?? 2.2)) };
    light.color = '#ff313d';
    repaired.push(`oriented ${light.role} toward -X`);
  }
  for (const issue of issues.filter((item) => item.code === 'FORWARD_LIGHT_DIRECTION')) {
    const light = plan.components.find((component) => component.id === issue.componentIds[0]); if (!light) continue;
    light.parameters = { ...(light.parameters ?? {}), vehicle_light: true, light_direction: 'front', facing_axis: '+X', facing_x: 1 };
    repaired.push(`oriented ${light.role} toward +X`);
  }
  for (const issue of issues.filter((item) => item.code === 'AIRCRAFT_NAV_LIGHT')) {
    const light = plan.components.find((component) => component.id === issue.componentIds[0]); if (!light) continue;
    const side = String(light.parameters?.navigation_side ?? 'tail');
    const axis = side === 'left' ? '-Z' : side === 'right' ? '+Z' : '-X';
    light.parameters = { ...(light.parameters ?? {}), facing_axis: axis, light_direction: side === 'tail' ? 'rear' : side, facing_x: side === 'tail' ? -1 : 0 };
    light.color = side === 'left' ? '#ff3344' : side === 'right' ? '#32e875' : '#f3f8ff';
    repaired.push(`corrected ${side} aircraft navigation light`);
  }
  return repaired;
}

function repairVehicleGeometry(plan: CompiledWorldPlan, issues: DesignIssue[]) {
  const repaired: string[] = [];
  for (const issue of issues) {
    if (issue.code !== 'KART_KINGPIN_AXIS' && issue.code !== 'KART_SPINDLE_AXIS') continue;
    const joint = plan.joints.find((candidate) => candidate.componentA === issue.componentIds[0] && candidate.componentB === issue.componentIds[1]);
    if (!joint) continue;
    joint.axis = issue.code === 'KART_KINGPIN_AXIS' ? [0, 1, 0] : [0, 0, 1];
    repaired.push(`corrected ${joint.id} ${issue.code === 'KART_KINGPIN_AXIS' ? 'kingpin' : 'spindle'} axis`);
  }
  return repaired;
}

function repairWindshields(plan: CompiledWorldPlan, issues: DesignIssue[]) {
  const repaired: string[] = [];
  for (const issue of issues.filter((item) => item.code === 'WINDSHIELD_PROPERTIES' || item.code === 'WINDSHIELD_PROPORTION')) {
    const item = plan.components.find((component) => component.id === issue.componentIds[0]); if (!item) continue;
    item.parameters = { ...(item.parameters ?? {}), cockpit_windshield: true, transparent_glazing: true, facing_axis: '+X', windshield_angle_deg: Number(item.parameters?.windshield_angle_deg ?? 16), attached_to_cockpit: true };
    item.position[2] = 0;
    item.dimensions = [Math.min(.14, Math.max(.04, item.dimensions[0])), Math.min(1, Math.max(.42, item.dimensions[1])), Math.min(1.55, Math.max(.68, item.dimensions[2]))];
    if (Math.abs(item.rotation[2]) < .08) item.rotation[2] = -.24;
    item.materialId = 'polymer'; item.color = '#68c6e8';
    repaired.push(`centered, angled, and cleared ${item.role}`);
  }
  return [...new Set(repaired)];
}

function removeUnexpectedSystems(plan: CompiledWorldPlan, issues: DesignIssue[]) {
  const ids = new Set(issues.filter((item) => item.code === 'UNREQUESTED_BICYCLE_ELECTRIC_SYSTEM').flatMap((item) => item.componentIds));
  if (!ids.size) return [];
  plan.components = plan.components.filter((component) => !ids.has(component.id));
  plan.joints = plan.joints.filter((joint) => !ids.has(joint.componentA) && !ids.has(joint.componentB));
  plan.connections = plan.connections.filter((edge) => !ids.has(edge.sourceId) && !ids.has(edge.targetId));
  plan.motors = plan.motors.filter((motor) => !ids.has(motor.componentId) && (!motor.jointId || plan.joints.some((joint) => joint.id === motor.jointId)));
  plan.sensors = plan.sensors.filter((sensor) => !ids.has(sensor.componentId) && (!sensor.targetId || !ids.has(sensor.targetId)));
  plan.actuators = plan.actuators.filter((actuator) => !ids.has(actuator.componentId) && plan.joints.some((joint) => joint.id === actuator.jointId));
  const sensorIds = new Set(plan.sensors.map((sensor) => sensor.id)), actuatorIds = new Set(plan.actuators.map((actuator) => actuator.id));
  plan.controls = plan.controls.filter((control) => control.sensorIds.every((id) => sensorIds.has(id)) && control.actuatorIds.every((id) => actuatorIds.has(id)));
  return [`removed ${ids.size} unrequested electric-bicycle components`];
}

function repairUnsupportedComponents(plan: CompiledWorldPlan, issues: DesignIssue[]) {
  const repaired: string[] = [];
  for (const issue of issues.filter((item) => item.code === 'UNSUPPORTED_COMPONENT')) {
    const item = plan.components.find((component) => component.id === issue.componentIds[0]);
    if (!item || hasMechanicalSupport(plan, item.id)) continue;
    const support = plan.components.filter((component) => component.id !== item.id && component.bodyType === 'fixed' && component.assemblyId === item.assemblyId)
      .sort((a, b) => Math.hypot(...a.position.map((value, axis) => value - item.position[axis])) - Math.hypot(...b.position.map((value, axis) => value - item.position[axis])))[0];
    if (!support) continue;
    plan.connections.push({ id: `validator-support-${item.id}`.slice(0, 64), sourceId: item.id, targetId: support.id, type: 'mechanical', channel: 'validator_attachment' });
    repaired.push(`attached floating ${item.role} to ${support.role}`);
  }
  return repaired;
}

function repairWorldBounds(plan: CompiledWorldPlan, issues: DesignIssue[]) {
  if (!issues.some((issue) => issue.code === 'WORLD_BOUNDS') || !plan.components.length) return [];
  const required = [0, 1, 2].map((axis) => Math.min(60, Math.max(plan.world.bounds[axis], Math.max(...plan.components.map((component) => Math.abs(component.position[axis]) + component.dimensions[axis] / 2)) * 2 + 2))) as [number, number, number];
  if (required.every((value, axis) => value === plan.world.bounds[axis])) return [];
  plan.world.bounds = required;
  return [`expanded world bounds to ${required.map((value) => value.toFixed(1)).join(' × ')} m`];
}

export function validateCompiledWorldPlan(plan: CompiledWorldPlan, prompt = plan.brief) {
  const issues: DesignIssue[] = [];
  validateReferencesAndBounds(plan, issues);
  validateCompleteness(plan, prompt, issues);
  validateLighting(plan, prompt, issues);
  validateVehicleGeometry(plan, prompt, issues);
  validateWindshields(plan, issues);
  validateUnexpectedSystems(plan, prompt, issues);
  return issues;
}

/** Apply only deterministic, low-risk repairs. Missing machine subsystems are
 * never hallucinated here; they remain validation errors for the planner. */
export function finalizeCompiledWorldPlan(input: CompiledWorldPlan, prompt = input.brief) {
  const plan = structuredClone(input);
  const firstPass = validateCompiledWorldPlan(plan, prompt);
  const repairs = [
    ...repairLighting(plan, firstPass), ...repairVehicleGeometry(plan, firstPass), ...repairWindshields(plan, firstPass),
    ...removeUnexpectedSystems(plan, firstPass), ...repairUnsupportedComponents(plan, firstPass), ...repairWorldBounds(plan, firstPass),
  ];
  const issues = validateCompiledWorldPlan(plan, prompt).filter((issue) => issue.severity !== 'repair');
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(`DESIGN_VALIDATION_FAILED: ${errors.map((issue) => issue.message).join(' ')}`);
  const intent = normalizeEngineeringIntent(prompt);
  const engineeringPlan = buildEngineeringPlan(intent, plan, plan.goal.capabilities);
  engineeringPlan.constraints = plan.goal.constraints.map((constraint) => `${constraint.label} ${constraint.operator} ${constraint.target}${constraint.unit}`);
  engineeringPlan.validation = { status: 'ready', issueCount: issues.length, repairs };
  engineeringPlan.simulationReadiness = {
    grounded: plan.components.some((component) => component.bodyType === 'fixed'),
    connected: plan.components.length <= 1 || plan.connections.some((edge) => edge.type === 'mechanical') || plan.joints.length > 0,
    driven: !plan.goal.capabilities.some((capability) => ['mobile', 'lift', 'transport', 'manipulate', 'rotate'].includes(capability)) || plan.motors.length + plan.actuators.length > 0,
  };
  plan.engineeringPlan = engineeringPlan;
  if (intent.corrections.length) plan.assumptions = [...plan.assumptions, `Intent normalization: ${intent.corrections.map((item) => `${item.from} → ${item.to}`).join(', ')}`];
  if (repairs.length) plan.assumptions = [...plan.assumptions, `Validator repair: ${repairs.join('; ')}`];
  return { plan, issues, repairs };
}
