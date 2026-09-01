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
  const brakeLights = plan.components.filter((component) => component.primitive === 'light' && /brake|rear light|tail light|taillight/.test(textFor(component)));
  if (wantsBrakeLight && !brakeLights.length) issues.push({ code: 'BRAKE_LIGHT_MISSING', severity: 'error', message: 'The requested rear brake light was not created.', componentIds: [] });
  for (const light of brakeLights) {
    if (Number(light.parameters?.facing_x ?? 0) !== -1 || light.parameters?.light_direction !== 'rear') issues.push({ code: 'BRAKE_LIGHT_DIRECTION', severity: 'repair', message: `${light.role} must face rearward (-X).`, componentIds: [light.id] });
    const supports = plan.connections.filter((edge) => edge.type === 'mechanical' && (edge.sourceId === light.id || edge.targetId === light.id))
      .map((edge) => edge.sourceId === light.id ? edge.targetId : edge.sourceId);
    const invalid = !supports.length || supports.every((id) => {
      const support = plan.components.find((component) => component.id === id);
      return !support || support.primitive === 'wheel' || support.bodyType === 'dynamic';
    });
    if (invalid) issues.push({ code: 'BRAKE_LIGHT_SUPPORT', severity: 'error', message: `${light.role} must mount to a stationary frame, rack, seat-post, or body support—not a tire.`, componentIds: [light.id, ...supports] });
  }
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
    light.parameters = { ...(light.parameters ?? {}), brake_light: true, vehicle_light: true, light_direction: 'rear', facing_x: -1, beam_range: Math.min(2.4, Number(light.parameters?.beam_range ?? 2.2)) };
    light.color = '#ff313d';
    repaired.push(`oriented ${light.role} toward -X`);
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
  return issues;
}

/** Apply only deterministic, low-risk repairs. Missing machine subsystems are
 * never hallucinated here; they remain validation errors for the planner. */
export function finalizeCompiledWorldPlan(input: CompiledWorldPlan, prompt = input.brief) {
  const plan = structuredClone(input);
  const firstPass = validateCompiledWorldPlan(plan, prompt);
  const repairs = [...repairLighting(plan, firstPass), ...repairWorldBounds(plan, firstPass)];
  const issues = validateCompiledWorldPlan(plan, prompt).filter((issue) => issue.severity !== 'repair');
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(`DESIGN_VALIDATION_FAILED: ${errors.map((issue) => issue.message).join(' ')}`);
  const intent = normalizeEngineeringIntent(prompt);
  plan.engineeringPlan = buildEngineeringPlan(intent, plan, plan.goal.capabilities);
  plan.engineeringPlan.constraints = plan.goal.constraints.map((constraint) => `${constraint.label} ${constraint.operator} ${constraint.target}${constraint.unit}`);
  plan.engineeringPlan.validation = { status: 'ready', issueCount: issues.length, repairs };
  plan.engineeringPlan.simulationReadiness = {
    grounded: plan.components.some((component) => component.bodyType === 'fixed'),
    connected: plan.components.length <= 1 || plan.connections.some((edge) => edge.type === 'mechanical') || plan.joints.length > 0,
    driven: !plan.goal.capabilities.some((capability) => ['mobile', 'lift', 'transport', 'manipulate', 'rotate'].includes(capability)) || plan.motors.length + plan.actuators.length > 0,
  };
  if (intent.corrections.length) plan.assumptions = [...plan.assumptions, `Intent normalization: ${intent.corrections.map((item) => `${item.from} → ${item.to}`).join(', ')}`];
  if (repairs.length) plan.assumptions = [...plan.assumptions, `Validator repair: ${repairs.join('; ')}`];
  return { plan, issues, repairs };
}
