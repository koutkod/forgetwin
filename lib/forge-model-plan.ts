import { catalogFor, worldDefaults } from './forge-data';
import { agentPlanSchema, repairAgentPlanGraph, validateAgentPlanSemantics, type AgentIntent, type AgentPlan } from './forge-agent';
import { Euler, Quaternion, Vector3 } from 'three';
import type {
  AssemblyBlueprint, CompiledWorldPlan, ComponentBlueprint, ConnectionBlueprint,
  JointBlueprint, PrimitiveKind, Vec3,
} from './forge-types';
import { finalizeCompiledWorldPlan } from './forge-design-validator';

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function boundedGoalSummary(architecture: string[], componentCount: number) {
  const suffix = ` from ${componentCount} guarded physical bodies.`;
  const prefix = 'AI-composed ';
  const available = Math.max(24, 240 - prefix.length - suffix.length);
  const joined = architecture.join(' + ');
  const compact = joined.length <= available ? joined : `${joined.slice(0, Math.max(1, available - 1)).trimEnd()}…`;
  return `${prefix}${compact}${suffix}`;
}

function orderedAssemblies(plan: AgentPlan): AssemblyBlueprint[] {
  const pending = new Map(plan.assemblies.map((item) => [item.id, item]));
  const ordered: AssemblyBlueprint[] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((item) => !item.parent_id || ordered.some((parent) => parent.id === item.parent_id));
    if (!ready.length) throw new Error('The generated assembly hierarchy contains a cycle.');
    for (const item of ready) {
      ordered.push({ id: item.id, name: item.name, purpose: item.purpose, ...(item.parent_id ? { parentId: item.parent_id } : {}) });
      pending.delete(item.id);
    }
  }
  return ordered;
}

type SemanticComponent = Pick<AgentPlan['components'][number], 'primitive' | 'role' | 'position' | 'rotation' | 'dimensions' | 'body_type' | 'mass' | 'semantic_tags'>;

function semanticParameters(component: SemanticComponent, machineName: string) {
  const tags = new Set(component.semantic_tags);
  const role = component.role.toLowerCase();
  const machine = machineName.toLowerCase();
  const parameters: Record<string, number | string | boolean> = {
    nominal_x: component.position[0], nominal_y: component.position[1], nominal_z: component.position[2],
    nominal_dx: component.dimensions[0], nominal_dy: component.dimensions[1], nominal_dz: component.dimensions[2],
    nominal_rx: component.rotation[0], nominal_ry: component.rotation[1], nominal_rz: component.rotation[2],
  };
  for (const tag of tags) parameters[`semantic_${tag.replaceAll('-', '_')}`] = true;

  const vehicle = /\b(?:car|go-kart|kart|buggy|automobile|road vehicle)\b/.test(machine);
  const bicycle = /\b(?:bicycle|bike)\b/.test(machine);
  if (component.primitive === 'wheel' && bicycle) parameters.bicycle_wheel = true;
  if (component.primitive === 'wheel' && vehicle && !/steering wheel/.test(role)) parameters.road_vehicle_wheel = true;
  if (tags.has('road-wheel')) parameters.road_vehicle_wheel = true;
  if (tags.has('bicycle-wheel')) parameters.bicycle_wheel = true;
  if (tags.has('front-steering') || /front (?:left|right).*wheel|(?:left|right) front.*wheel/.test(role)) {
    parameters.road_vehicle_front_steering = true;
    parameters.steering_side = /left/.test(role) ? 'left' : 'right';
  }
  if (tags.has('steering-wheel') || /steering wheel/.test(role)) parameters.road_vehicle_steering_wheel = true;
  if (tags.has('steering-rack') || /steering rack/.test(role)) parameters.road_vehicle_steering_rack = true;
  if (tags.has('headlight') || /headlight|head lamp|work light/.test(role)) { parameters.headlight = true; parameters.beam_range = 5; }
  if (tags.has('brake-light') || /brake light|tail light|taillight|rear lamp/.test(role)) {
    parameters.brake_light = true; parameters.vehicle_light = true; parameters.light_direction = 'rear'; parameters.facing_x = -1; parameters.beam_range = 2.2;
  } else if (parameters.headlight === true) {
    parameters.vehicle_light = true; parameters.light_direction = 'front'; parameters.facing_x = 1;
  }
  if (tags.has('solar-panel') || /solar (?:array|panel)|tracked panel/.test(role)) parameters.panel = true;
  if (tags.has('solar-moving')) parameters.solar_moving = true;
  if (tags.has('solar-source') || /moving sun|light source/.test(role)) parameters.solar_source = true;
  if (tags.has('sorting-diverter') || /sort(?:ing|er).*diverter|selector paddle/.test(role)) parameters.sorting_diverter = true;
  if (tags.has('conveyor') || component.primitive === 'conveyor') parameters.industrial_conveyor = true;
  if (tags.has('package-red')) parameters.product_form = 'package-red';
  if (tags.has('package-blue')) parameters.product_form = 'package-blue';
  if (tags.has('shipping-carton')) parameters.product_form = 'shipping-carton';
  if (tags.has('tomato-ripe')) { parameters.product_form = 'tomato'; parameters.grade = 'ripe'; }
  if (tags.has('tomato-reject')) { parameters.product_form = 'tomato'; parameters.grade = 'reject'; }
  if (tags.has('metal-can')) parameters.product_form = 'metal-can';
  if (tags.has('plastic-bottle')) parameters.product_form = 'plastic-bottle';
  if (tags.has('reject-object')) parameters.product_form = 'reject-object';
  if (tags.has('recycling-drum')) parameters.recycling_drum = true;
  if (tags.has('suspension-wheel')) parameters.suspension_wheel = true;
  if (tags.has('suspension-arm')) parameters.suspension_arm = true;
  if (tags.has('suspension-spring')) parameters.suspension_corner = role.slice(0, 24);
  if (tags.has('payload') || /\b(?:payload|counterweight|suspended load|moving load)\b/.test(role)) parameters.payload_kg = component.mass || 1;
  if (tags.has('rotor') || tags.has('operation-spin')) parameters.operation_spin = 1.85;
  if (component.primitive === 'gear') parameters.teeth = Math.max(12, Math.round(component.dimensions[0] * 18));
  return parameters;
}

function componentsFrom(plan: AgentPlan): ComponentBlueprint[] {
  return plan.components.map((item) => ({
    id: item.id,
    primitive: item.primitive as PrimitiveKind,
    assemblyId: item.assembly_id,
    role: item.role,
    position: [...item.position] as Vec3,
    rotation: [...item.rotation] as Vec3,
    dimensions: [...item.dimensions] as Vec3,
    materialId: item.material_id,
    bodyType: item.body_type,
    ...(item.mass > 0 ? { mass: item.mass } : {}),
    ...(item.color ? { color: item.color } : {}),
    parameters: semanticParameters(item, plan.machine_name),
  }));
}

export function localAnchorAt(component: Pick<ComponentBlueprint, 'position' | 'rotation'>, worldPoint: Vec3): Vec3 {
  const offset = new Vector3(worldPoint[0] - component.position[0], worldPoint[1] - component.position[1], worldPoint[2] - component.position[2]);
  const inverseRotation = new Quaternion().setFromEuler(new Euler(component.rotation[0], component.rotation[1], component.rotation[2], 'XYZ')).invert();
  offset.applyQuaternion(inverseRotation);
  return [Number(offset.x.toFixed(4)), Number(offset.y.toFixed(4)), Number(offset.z.toFixed(4))];
}

function jointsFrom(plan: AgentPlan, components: ComponentBlueprint[]): JointBlueprint[] {
  const byId = new Map(components.map((item) => [item.id, item]));
  return plan.joints.map((item) => {
    const a = byId.get(item.component_a)!;
    const b = byId.get(item.component_b)!;
    const shared = a.position.map((value, index) => (value + b.position[index]) / 2) as Vec3;
    const anchorA = localAnchorAt(a, shared);
    const anchorB = localAnchorAt(b, shared);
    return {
      id: item.id, type: item.joint_type, componentA: item.component_a, componentB: item.component_b,
      anchorA, anchorB, axis: [...item.axis] as Vec3, ...(item.limits ? { limits: [...item.limits] as [number, number] } : {}),
      ...(item.ratio > 0 ? { ratio: item.ratio } : {}),
      ...(item.stiffness > 0 ? { stiffness: item.stiffness } : {}),
      ...(item.damping > 0 ? { damping: item.damping } : {}),
    };
  });
}

function connectionsFrom(plan: AgentPlan): ConnectionBlueprint[] {
  const result: ConnectionBlueprint[] = plan.connections.map((item) => ({ id: item.id, sourceId: item.source_id, targetId: item.target_id, type: item.connection_type, channel: item.channel }));
  const connectedPairs = new Set(result.filter((item) => item.type === 'mechanical').map((item) => [item.sourceId, item.targetId].sort().join('|')));
  for (const joint of plan.joints) {
    const pair = [joint.component_a, joint.component_b].sort().join('|');
    if (connectedPairs.has(pair)) continue;
    let id = `edge-${joint.id}`.slice(0, 64);
    let suffix = 2;
    while (result.some((item) => item.id === id)) { id = `edge-${joint.id}-${suffix}`.slice(0, 64); suffix += 1; }
    result.push({ id, sourceId: joint.component_a, targetId: joint.component_b, type: 'mechanical', channel: joint.joint_type });
    connectedPairs.add(pair);
  }
  return result;
}

function worldBounds(components: ComponentBlueprint[]): Vec3 {
  const extent = (axis: number) => Math.max(...components.map((item) => Math.abs(item.position[axis]) + item.dimensions[axis] / 2));
  return [clamp(extent(0) * 2 + 4, 12, 60), clamp(extent(1) + 4, 8, 30), clamp(extent(2) * 2 + 4, 10, 60)];
}

export function compileAgentPlan(requestedPrompt: string, rawPlan: AgentPlan): CompiledWorldPlan {
  const plan = validateAgentPlanSemantics(rawPlan, requestedPrompt);
  const components = componentsFrom(plan);
  const joints = jointsFrom(plan, components);
  const explicitComponentLimit = plan.requirements.find((item) => item.metric === 'component_count' && item.operator === 'max' && item.source === 'user');
  const sensorById = new Map(plan.sensors.map((item) => [item.id, item]));
  const editable = components.find((item) => item.id === plan.editable_component_id)!;
  const assumptions = [...plan.assumptions, 'AI-composed concept model; all bodies and references passed ForgeTwin semantic validation.'];
  const compiled: CompiledWorldPlan = {
    brief: requestedPrompt,
    goal: {
      machineName: plan.machine_name,
      domain: plan.domain,
      brief: requestedPrompt,
      summary: boundedGoalSummary(plan.architecture, components.length),
      capabilities: [...plan.capabilities],
      constraints: plan.requirements.map((item) => ({ ...item })),
      maxComponents: explicitComponentLimit?.target ?? Math.min(80, Math.max(24, components.length + 8)),
      assumptions,
      disclaimer: 'Concept-level rigid-body model. Validate loads, materials, controls, manufacturability, and safety before fabrication or real-world use.',
      simulationModel: 'GPT-5.6 design graph executed through guarded WebMCP-style tools in a Rapier multi-body world',
      editableComponentId: editable.id,
      editableLabel: editable.role,
    },
    world: { ...worldDefaults, bounds: worldBounds(components), duration: 8 },
    assemblies: orderedAssemblies(plan),
    components,
    connections: connectionsFrom(plan),
    joints,
    motors: plan.motors.map((item) => ({ id: item.id, componentId: item.component_id, ...(item.joint_id ? { jointId: item.joint_id } : {}), maxTorque: item.max_torque, maxRpm: item.max_rpm, direction: item.direction || 1 })),
    sensors: plan.sensors.map((item) => ({ id: item.id, componentId: item.component_id, type: item.sensor_type, channel: item.channel, ...(item.target_id ? { targetId: item.target_id } : {}), range: item.range })),
    actuators: plan.actuators.map((item) => ({ id: item.id, componentId: item.component_id, jointId: item.joint_id, type: item.actuator_type, maxForce: item.max_force, maxSpeed: item.max_speed, travel: item.travel })),
    controls: plan.controls.map((item) => {
      const sensor = sensorById.get(item.sensor_ids[0] ?? '');
      const sensorBody = sensor ? components.find((component) => component.id === sensor.component_id) : undefined;
      return { id: item.id, name: item.name, mode: item.mode, sensorIds: [...item.sensor_ids], actuatorIds: [...item.actuator_ids], expression: item.expression, setpoint: item.setpoint, kp: item.kp, ki: item.ki, kd: item.kd, calibrationX: sensorBody?.position[0] ?? 0 };
    }),
    assumptions,
  };
  return finalizeCompiledWorldPlan(compiled, requestedPrompt).plan;
}

function tagsFromParameters(component: ComponentBlueprint) {
  const tags = new Set<string>();
  const parameters = component.parameters ?? {};
  for (const [key, value] of Object.entries(parameters)) {
    if (value === true && key.startsWith('semantic_')) tags.add(key.slice('semantic_'.length).replaceAll('_', '-'));
  }
  const product = parameters.product_form;
  if (typeof product === 'string') {
    const productTag: Record<string, string> = {
      'package-red': 'package-red', 'package-blue': 'package-blue', 'shipping-carton': 'shipping-carton',
      tomato: parameters.grade === 'reject' ? 'tomato-reject' : 'tomato-ripe',
      'metal-can': 'metal-can', 'plastic-bottle': 'plastic-bottle', 'reject-object': 'reject-object',
    };
    if (productTag[product]) tags.add(productTag[product]);
  }
  if (parameters.payload_kg !== undefined) tags.add('payload');
  if (parameters.road_vehicle_wheel === true) tags.add('road-wheel');
  if (parameters.bicycle_wheel === true) tags.add('bicycle-wheel');
  if (parameters.headlight === true) tags.add('headlight');
  if (parameters.brake_light === true) tags.add('brake-light');
  if (parameters.panel === true) tags.add('solar-panel');
  if (parameters.solar_moving === true) tags.add('solar-moving');
  if (parameters.solar_source === true) tags.add('solar-source');
  if (parameters.industrial_conveyor === true) tags.add('conveyor');
  return [...tags].slice(0, 8);
}

/** Expand a compact model-authored intent through the deterministic physical
 * compiler, then convert it back into the same guarded graph contract consumed
 * by the browser. The model chooses what to build; ForgeTwin guarantees that
 * all references and grounded kinematic paths are executable. */
export function agentPlanFromCompiled(originalPrompt: string, intent: AgentIntent, compiled: CompiledWorldPlan, explicitRequirements: CompiledWorldPlan['goal']['constraints'] = []): AgentPlan {
  const inferredRequirements = compiled.goal.constraints.map((item) => ({ ...item, source: item.source ?? 'inferred' as const }));
  const requirements: AgentPlan['requirements'] = [];
  // Numeric requirements that ForgeTwin can parse directly from the original
  // user text are authoritative. This prevents a model from accidentally
  // downgrading a stated throughput/load/limit to an inferred requirement.
  for (const candidate of [...explicitRequirements.filter((item) => item.source === 'user'), ...intent.requirements, ...inferredRequirements]) {
    const parsed = agentPlanSchema.shape.requirements.element.safeParse(candidate);
    if (!parsed.success) continue;
    const requirement = parsed.data;
    if (!requirements.some((item) => item.metric === requirement.metric)) requirements.push(requirement);
    if (requirements.length === 8) break;
  }
  const raw = {
    normalized_prompt: intent.normalized_prompt,
    machine_name: intent.machine_name,
    domain: intent.domain,
    reasoning_summary: intent.reasoning_summary,
    architecture: intent.architecture,
    assumptions: [...intent.assumptions, 'ForgeTwin deterministically expanded and validated the model-authored engineering intent.'].slice(0, 8),
    capabilities: intent.capabilities,
    requirements,
    assemblies: compiled.assemblies.map((item) => ({ id: item.id, name: item.name, purpose: item.purpose, parent_id: item.parentId ?? '' })),
    components: compiled.components.map((item) => ({
      id: item.id, primitive: item.primitive, assembly_id: item.assemblyId, role: item.role,
      position: [...item.position], rotation: [...item.rotation], dimensions: [...item.dimensions],
      material_id: item.materialId, body_type: item.bodyType, mass: item.mass ?? 1,
      color: item.color ?? '', semantic_tags: tagsFromParameters(item),
    })),
    connections: compiled.connections.map((item) => ({ id: item.id, source_id: item.sourceId, target_id: item.targetId, connection_type: item.type, channel: item.channel || 'mechanical' })),
    joints: compiled.joints.map((item) => ({
      id: item.id, joint_type: item.type, component_a: item.componentA, component_b: item.componentB,
      axis: [...item.axis], limits: item.limits ? [...item.limits] : null,
      ratio: item.ratio ?? 0, stiffness: item.stiffness ?? 0, damping: item.damping ?? 0,
    })),
    motors: compiled.motors.map((item) => ({ id: item.id, component_id: item.componentId, joint_id: item.jointId ?? '', max_torque: item.maxTorque, max_rpm: item.maxRpm, direction: item.direction ?? 1 })),
    sensors: compiled.sensors.map((item) => ({ id: item.id, component_id: item.componentId, sensor_type: item.type, channel: item.channel, target_id: item.targetId ?? '', range: item.range })),
    actuators: compiled.actuators.map((item) => ({ id: item.id, component_id: item.componentId, joint_id: item.jointId, actuator_type: item.type, max_force: item.maxForce, max_speed: item.maxSpeed, travel: item.travel })),
    controls: compiled.controls.map((item) => ({ id: item.id, name: item.name, mode: item.mode, sensor_ids: [...item.sensorIds], actuator_ids: [...item.actuatorIds], expression: item.expression, setpoint: item.setpoint, kp: item.kp, ki: item.ki, kd: item.kd })),
    editable_component_id: compiled.goal.editableComponentId,
  };
  const parsed = agentPlanSchema.parse(raw);
  return validateAgentPlanSemantics(repairAgentPlanGraph(parsed), originalPrompt);
}

export function semanticParametersForEdit(action: Extract<import('./forge-agent').AgentEditAction, { tool: 'create_component' }>, machineName: string) {
  return semanticParameters({
    primitive: action.primitive, role: action.role, position: action.position, rotation: action.rotation,
    dimensions: action.dimensions, body_type: action.body_type, mass: action.mass, semantic_tags: action.semantic_tags,
  }, machineName);
}

export function defaultColorFor(primitive: PrimitiveKind) {
  return catalogFor(primitive).color;
}
