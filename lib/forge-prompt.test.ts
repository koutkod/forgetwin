import { describe, expect, it } from 'vitest';
import { componentMass, engineeringExamples } from './forge-data';
import { localPointToWorld } from './forge-motion';
import { compileDesignBrief } from './forge-prompt';
import { simulateDesign } from './forge-simulation';
import { assemblePlan } from './forge-test-utils';

const briefs = {
  crane: 'Build a crane that lifts a 200 kg beam by 3 meters and places it within 10 cm without tipping.',
  rover: 'Build a four-wheel rover that carries 50 kg across rough terrain in under 20 seconds without tipping.',
  gearbox: 'Build a compact 4:1 gearbox that accepts 120 rpm and delivers at least 80 N·m of torque.',
  lift: 'Build a synchronized lift that raises 100 kg by 1 meter while keeping the platform level.',
  arm: 'Build a three-axis robotic arm with a gripper that reaches 2 meters and places a 12 kg part within 2 cm.',
  bridge: 'Build a 6 meter bridge that supports a 2000 kg moving load with less than 8 mm deflection.',
  sorter: 'Build a conveyor system that sorts red and blue boxes into separate bins at 20 boxes per minute.',
};

function signature(prompt: string) {
  const plan = compileDesignBrief(prompt);
  const kinds = Object.entries(Object.groupBy(plan.components, (item) => item.primitive)).map(([kind, items]) => `${kind}:${items?.length ?? 0}`).sort();
  const joints = Object.entries(Object.groupBy(plan.joints, (item) => item.type)).map(([kind, items]) => `${kind}:${items?.length ?? 0}`).sort();
  return `${kinds.join(',')}|${joints.join(',')}|m${plan.motors.length}|s${plan.sensors.length}|a${plan.actuators.length}`;
}

describe('ForgeTwin world-first brief compiler', () => {
  it('synthesizes meaningfully different primitive graphs for seven machine classes', () => {
    const plans = Object.fromEntries(Object.entries(briefs).map(([name, prompt]) => [name, compileDesignBrief(prompt)]));
    const signatures = Object.fromEntries(Object.entries(briefs).map(([name, prompt]) => [name, signature(prompt)]));
    expect(new Set(Object.values(signatures)), JSON.stringify(signatures, null, 2)).toHaveLength(7);
    expect(plans.crane.components.some((item) => item.primitive === 'pulley')).toBe(true);
    expect(plans.crane.components.some((item) => item.primitive === 'counterweight')).toBe(true);
    expect(plans.rover.components.filter((item) => item.primitive === 'wheel')).toHaveLength(4);
    expect(plans.rover.components.filter((item) => item.primitive === 'spring')).toHaveLength(4);
    expect(plans.gearbox.components.filter((item) => item.primitive === 'gear').length).toBeGreaterThanOrEqual(2);
    expect(plans.gearbox.joints.some((item) => item.type === 'gear' && item.ratio === 4)).toBe(true);
    expect(plans.lift.joints.filter((item) => item.type === 'prismatic')).toHaveLength(1);
    expect(plans.lift.actuators.filter((item) => item.type === 'piston')).toHaveLength(2);
    expect(plans.arm.joints.filter((item) => item.type === 'revolute').length).toBeGreaterThanOrEqual(3);
    expect(plans.arm.components.some((item) => item.primitive === 'gripper')).toBe(true);
    expect(plans.bridge.components.filter((item) => item.primitive === 'beam').length).toBeGreaterThanOrEqual(3);
    expect(plans.bridge.actuators).toHaveLength(0);
    expect(plans.sorter.components.some((item) => item.primitive === 'conveyor')).toBe(true);
    for (const [name, plan] of Object.entries(plans)) if (name !== 'sorter') expect(plan.components.some((item) => item.primitive === 'conveyor')).toBe(false);
  });

  it('contains no whole-machine primitive IDs', () => {
    const forbidden = new Set(['crane', 'rover', 'gearbox', 'lift', 'robotic-arm', 'bridge']);
    for (const prompt of Object.values(briefs)) expect(compileDesignBrief(prompt).components.some((item) => forbidden.has(item.primitive))).toBe(false);
  });

  it('builds a recognizable, controlled scissor lift instead of a generic guided elevator', () => {
    const plan = compileDesignBrief('Build a scissor lift that raises a 300 kg load by 1.5 meters and keeps the platform level.');
    expect(plan.goal.machineName).toBe('Scissor lift');
    expect(plan.goal.summary).toContain('scissor-linkage-lift');
    expect(plan.goal.summary).not.toContain('parallel-guides');
    expect(plan.assemblies.some((item) => item.name === 'hydraulic scissor lift')).toBe(true);
    expect(plan.components.find((item) => item.parameters?.scissor_base)?.mass).toBeLessThan(500);
    expect(plan.components.find((item) => item.parameters?.scissor_base_deck)?.mass).toBeLessThan(200);
    expect(plan.components.some((item) => item.parameters?.scissor_platform)).toBe(true);
    const arms = plan.components.filter((item) => item.parameters?.scissor_arm);
    expect(arms).toHaveLength(4);
    expect(new Set(arms.map((item) => item.parameters?.scissor_pair))).toEqual(new Set([1, 2]));
    expect(arms.some((item) => item.rotation[2] > 0)).toBe(true);
    expect(arms.some((item) => item.rotation[2] < 0)).toBe(true);
    expect(plan.components.filter((item) => item.parameters?.scissor_pivot)).toHaveLength(2);
    expect(plan.joints.filter((item) => item.type !== 'fixed' && plan.components.find((body) => body.id === item.componentA)?.bodyType === 'fixed' && plan.components.find((body) => body.id === item.componentB)?.bodyType === 'fixed')).toHaveLength(0);
    expect(plan.connections.filter((item) => item.channel === 'scissor_center_hinge')).toHaveLength(2);

    const platform = plan.components.find((item) => item.parameters?.scissor_platform)!;
    const liftJoint = plan.joints.find((item) => item.type === 'prismatic' && item.componentB === platform.id)!;
    expect(liftJoint.axis).toEqual([0, 1, 0]);
    expect(liftJoint.limits).toEqual([0, 1.5]);
    const cylinder = plan.components.find((item) => item.parameters?.scissor_actuator)!;
    const actuator = plan.actuators.find((item) => item.componentId === cylinder.id)!;
    expect(actuator).toMatchObject({ jointId: liftJoint.id, type: 'piston', travel: 1.5 });
    expect(actuator.maxForce).toBeGreaterThan(300 * 9.81);
    const payload = plan.components.find((item) => item.parameters?.scissor_payload)!;
    expect(payload.mass).toBe(300);
    expect(plan.controls.some((item) => item.actuatorIds.includes(actuator.id) && item.sensorIds.length === 1 && /level/i.test(item.name))).toBe(true);
    expect(plan.goal.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'payload_capacity', target: 300, source: 'user' }),
      expect.objectContaining({ metric: 'lift_height', target: 1.5, source: 'user' }),
      expect.objectContaining({ metric: 'platform_tilt', operator: 'max' }),
    ]));
    expect(plan.components.some((item) => /linear guide/.test(item.role))).toBe(false);
  });

  it('animates the scissor-lift actuator without unstable platform motion', async () => {
    const state = assemblePlan(compileDesignBrief('Build a scissor lift that raises a 300 kg load by 1.5 meters and keeps the platform level.'));
    const run = await simulateDesign(state);
    const platform = state.components.find((item) => item.parameters.scissor_platform)!;
    const payload = state.components.find((item) => item.parameters.scissor_payload)!;
    const actuator = state.actuators.find((item) => state.components.find((component) => component.id === item.componentId)?.parameters.scissor_actuator)!;
    const platformFrames = run.replay.map((frame) => frame.items.find((item) => item.id === platform.id)).filter((item) => item !== undefined);
    const heights = platformFrames.map((item) => item.position[1]);
    const payloadFrames = run.replay.map((frame) => frame.items.find((item) => item.id === payload.id)).filter((item) => item !== undefined);
    const payloadHeights = payloadFrames.map((item) => item.position[1]);
    const actuatorTravel = run.replay.map((frame) => frame.actuatorValues[actuator.id]);
    expect(run.physics).toMatchObject({ engine: 'Rapier', timestepHz: 60 });
    expect(run.failures.some((item) => item.type === 'physics-health')).toBe(false);
    expect(Math.max(...actuatorTravel) - Math.min(...actuatorTravel)).toBeGreaterThan(.8);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(1.4);
    expect(Math.max(...payloadHeights) - Math.min(...payloadHeights)).toBeGreaterThan(1.4);
    expect(platformFrames.every((item, index) => Math.abs((payloadFrames[index]?.position[1] ?? 0) - item.position[1] - .43) < .06)).toBe(true);
    expect(platformFrames.every((item) => Math.abs(item.rotation[0]) < .05 && Math.abs(item.rotation[2]) < .05)).toBe(true);
  }, 30_000);

  it('builds the exact red-blue sorter as a readable two-route industrial line', () => {
    const plan = compileDesignBrief('Build a conveyor system that sorts red and blue boxes into separate bins at 20 boxes per minute.');
    expect(plan.components.some((item) => item.parameters?.industrial_conveyor)).toBe(true);
    expect(plan.components.some((item) => item.parameters?.conveyor_frame)).toBe(true);
    expect(plan.components.some((item) => item.parameters?.sorting_sensor)).toBe(true);
    expect(plan.components.some((item) => item.parameters?.sorting_diverter)).toBe(true);
    expect(plan.components.filter((item) => item.parameters?.sorting_chute)).toHaveLength(2);
    expect(plan.components.filter((item) => item.parameters?.sorting_bin)).toHaveLength(2);
    expect(plan.components.filter((item) => item.parameters?.route_color === 'red')).toHaveLength(2);
    expect(plan.components.filter((item) => item.parameters?.route_color === 'blue')).toHaveLength(2);
    expect(plan.goal.constraints.find((item) => item.metric === 'throughput')?.target).toBe(20);
  });

  it('keeps every editable gallery prompt recognizable and physically distinct', () => {
    const checks: Record<string, (plan: ReturnType<typeof compileDesignBrief>) => boolean> = {
      sorter: (plan) => ['package-red', 'package-blue'].every((form) => plan.components.some((item) => item.parameters?.product_form === form)) && plan.components.filter((item) => item.parameters?.sorting_bin).length === 2,
      crane: (plan) => plan.components.some((item) => item.parameters?.crane_winch) && plan.components.some((item) => item.primitive === 'hook') && plan.components.some((item) => item.primitive === 'counterweight'),
      rover: (plan) => plan.components.some((item) => item.parameters?.rover_chassis) && plan.components.filter((item) => item.parameters?.rover_wheel).length === 4,
      'go-kart': (plan) => plan.components.filter((item) => item.parameters?.road_vehicle_wheel).length === 4 && plan.components.filter((item) => item.primitive === 'body-shell').length === 3 && plan.components.some((item) => item.primitive === 'steering'),
      motorcycle: (plan) => plan.components.filter((item) => item.parameters?.motorcycle_wheel).length === 2
        && plan.components.some((item) => item.parameters?.motorcycle_seat)
        && plan.components.some((item) => item.parameters?.motorcycle_motor)
        && plan.components.some((item) => item.parameters?.motorcycle_bodywork)
        && plan.components.some((item) => item.parameters?.motorcycle_fork_crown)
        && plan.components.some((item) => item.parameters?.motorcycle_rear_shock)
        && plan.components.some((item) => item.parameters?.motorcycle_headlight && item.parameters?.facing_axis === '+X'),
      airplane: (plan) => plan.components.some((item) => item.primitive === 'fuselage') && plan.components.some((item) => item.role === 'left main wing') && plan.components.some((item) => item.role === 'right main wing') && plan.components.filter((item) => item.primitive === 'aerofoil').length >= 5 && plan.components.filter((item) => item.primitive === 'landing-gear').length === 3,
      helicopter: (plan) => plan.components.some((item) => item.primitive === 'rotor') && plan.components.some((item) => item.primitive === 'propeller') && plan.components.filter((item) => item.parameters?.helicopter_skid).length === 2,
      'service-robot': (plan) => plan.components.filter((item) => item.parameters?.robot_limb).length >= 8 && plan.components.filter((item) => item.parameters?.robot_hand).length === 2 && plan.components.filter((item) => item.parameters?.robot_joint).length >= 6 && plan.components.some((item) => item.parameters?.robot_head && item.parameters?.robot_face),
      arm: (plan) => plan.components.some((item) => item.parameters?.robot_arm_gripper) && plan.components.filter((item) => item.parameters?.robot_arm_link).length === 3 && plan.components.filter((item) => item.parameters?.robot_arm_joint).length === 3,
      gearbox: (plan) => plan.components.some((item) => item.parameters?.gearbox_housing) && plan.components.filter((item) => item.primitive === 'gear').length === 2 && plan.components.filter((item) => item.parameters?.gearbox_bearing).length === 2,
      suspension: (plan) => plan.components.filter((item) => item.primitive === 'spring').length === 4 && plan.components.filter((item) => item.parameters?.suspension_wheel).length === 4 && plan.components.some((item) => item.parameters?.automotive_body && item.parameters?.passenger_car_body) && plan.components.filter((item) => item.parameters?.suspension_arm).length === 8 && !plan.components.some((item) => item.parameters?.rover_chassis || item.role === 'mobile payload'),
      solar: (plan) => plan.components.some((item) => item.parameters?.solar_array) && plan.components.some((item) => item.parameters?.solar_source) && plan.components.some((item) => item.parameters?.tracker_foundation && item.parameters?.ground_contact && item.position[1] - item.dimensions[1] / 2 === 0) && plan.components.filter((item) => item.parameters?.tracker_brace).length === 4 && plan.components.some((item) => item.parameters?.tracker_crosshead) && plan.components.filter((item) => item.parameters?.tracker_yoke).length === 2 && plan.joints.some((item) => item.type === 'revolute'),
      lift: (plan) => plan.components.some((item) => item.parameters?.patient_sling) && plan.components.filter((item) => item.parameters?.medical_caster).length === 4 && plan.components.filter((item) => item.parameters?.sling_strap).length === 4 && plan.components.some((item) => item.parameters?.medical_boom) && plan.components.filter((item) => item.parameters?.medical_actuator_mount).length === 2,
      bridge: (plan) => plan.components.some((item) => item.role === 'span deck') && plan.components.some((item) => item.role.includes('diagonal truss')),
      warehouse: (plan) => plan.components.filter((item) => item.parameters?.buffer_zone && item.primitive === 'conveyor').length === 4 && plan.components.filter((item) => item.parameters?.buffer_gate).length === 3 && plan.controls.some((item) => item.mode === 'state-machine' && /next zone is clear/i.test(item.expression)),
      agriculture: (plan) => plan.components.filter((item) => item.parameters?.product_form === 'tomato').length === 6 && ['ripe', 'unripe', 'damaged'].every((grade) => plan.components.some((item) => item.parameters?.grade === grade)) && plan.components.filter((item) => item.parameters?.grading_roller).length === 6,
      recycling: (plan) => ['metal-can', 'plastic-bottle', 'reject-object'].every((form) => plan.components.some((item) => item.parameters?.product_form === form)) && plan.components.some((item) => item.parameters?.recycling_drum) && plan.components.some((item) => item.parameters?.recycling_magnet) && plan.components.filter((item) => item.parameters?.sorting_bin).length === 3 && !plan.components.some((item) => item.parameters?.sorting_diverter || item.parameters?.industrial_conveyor),
      'hvac-fixture': (plan) => plan.components.some((item) => item.parameters?.fixture_plate) && plan.components.some((item) => item.parameters?.heat_exchanger_core) && plan.components.filter((item) => item.parameters?.hvac_pipe).length >= 2,
      drawbridge: (plan) => plan.components.some((item) => item.parameters?.drawbridge_deck && item.dimensions[2] > 2) && plan.components.some((item) => item.parameters?.water_surface) && plan.components.filter((item) => item.parameters?.bridge_abutment).length === 2 && plan.components.some((item) => item.parameters?.bridge_tower) && plan.components.some((item) => item.parameters?.drawbridge_pulley) && plan.components.some((item) => item.parameters?.drawbridge_counterweight),
    };
    for (const example of engineeringExamples) {
      const plan = compileDesignBrief(example.prompt);
      expect(checks[example.id]?.(plan), `${example.title} should compile to its own recognizable physical signature`).toBe(true);
    }
  });

  it('gives every vehicle and aircraft template a coherent animation contract', () => {
    const rover = compileDesignBrief(engineeringExamples.find((item) => item.id === 'rover')!.prompt);
    const roverWheels = rover.components.filter((item) => item.parameters?.rover_wheel);
    expect(roverWheels).toHaveLength(4);
    expect(roverWheels.every((item) => item.parameters?.road_vehicle_wheel && item.parameters?.axle_axis === 'Z')).toBe(true);
    expect(new Set(roverWheels.map((item) => item.parameters?.operation_index)).size).toBe(4);

    const kart = compileDesignBrief(engineeringExamples.find((item) => item.id === 'go-kart')!.prompt);
    for (const wheel of kart.components.filter((item) => item.parameters?.road_vehicle_wheel)) {
      expect(wheel.parameters?.axle_axis).toBe('Z');
      expect(kart.joints.some((joint) => joint.type === 'fixed' && joint.componentB === wheel.id)).toBe(true);
    }

    const motorcycle = compileDesignBrief(engineeringExamples.find((item) => item.id === 'motorcycle')!.prompt);
    const steeringMembers = motorcycle.components.filter((item) => item.parameters?.motorcycle_steering_member || item.parameters?.motorcycle_front_wheel);
    expect(steeringMembers.length).toBeGreaterThanOrEqual(7);
    expect(steeringMembers.every((item) => item.parameters?.motorcycle_steering_pivot_x === .72 && item.parameters?.motorcycle_steering_pivot_y === 1.55)).toBe(true);

    const airplane = compileDesignBrief(engineeringExamples.find((item) => item.id === 'airplane')!.prompt);
    const propeller = airplane.components.find((item) => item.primitive === 'propeller')!;
    const propellerJoint = airplane.joints.find((item) => item.type === 'revolute' && item.componentB === propeller.id)!;
    expect(propeller.parameters).toMatchObject({ rotor_axis: 'forward', powered_propulsor: true });
    expect(propellerJoint.axis).toEqual([1, 0, 0]);
    expect(airplane.motors.some((motor) => motor.jointId === propellerJoint.id)).toBe(true);
    expect(airplane.components.filter((item) => item.parameters?.aircraft_control_surface).every((item) => Number.isFinite(item.parameters?.motion_pivot_x))).toBe(true);

    const helicopter = compileDesignBrief(engineeringExamples.find((item) => item.id === 'helicopter')!.prompt);
    const mainRotor = helicopter.components.find((item) => item.parameters?.main_rotor)!;
    const tailRotor = helicopter.components.find((item) => item.parameters?.tail_rotor)!;
    expect(helicopter.components.filter((item) => item.assemblyId === mainRotor.assemblyId).every((item) => item.parameters?.rotorcraft_hover_member)).toBe(true);
    expect(helicopter.joints.find((item) => item.componentB === mainRotor.id)?.axis).toEqual([0, 1, 0]);
    expect(helicopter.joints.find((item) => item.componentB === tailRotor.id)?.axis).toEqual([1, 0, 0]);
  });

  it('does not confuse engineering measurements with primitive quantities', () => {
    const crane = compileDesignBrief('Build a crane that lifts a 200 kg beam by 3 meters and places it within 10 cm without tipping.');
    expect(crane.assemblies.some((item) => item.name === 'requested primitive extension')).toBe(false);
    expect(crane.components.filter((item) => item.role === 'suspended beam payload')).toHaveLength(1);

    const fourWheelRover = compileDesignBrief('Build a rover with 4 wheels that carries a 5 kg payload over uneven ground.');
    expect(fourWheelRover.components.filter((item) => item.parameters?.rover_wheel)).toHaveLength(4);
  });

  it('constructs recognizable CAD-style parts and rotating assemblies from primitives', () => {
    const bearing = compileDesignBrief('Build a sealed bearing for a 30 mm shaft.');
    expect(bearing.components.some((item) => item.parameters?.cad_form === 'bearing')).toBe(true);
    expect(bearing.components.some((item) => item.primitive === 'conveyor')).toBe(false);

    const impeller = compileDesignBrief('Build an aluminum six-blade impeller and animate it at 240 rpm.');
    expect(impeller.components.some((item) => item.parameters?.cad_form === 'rotor_hub')).toBe(true);
    expect(impeller.components.filter((item) => item.parameters?.cad_form === 'aero_blade')).toHaveLength(6);
    expect(impeller.joints.some((item) => item.type === 'revolute')).toBe(true);
    const rotorHub = impeller.components.find((item) => item.parameters?.cad_form === 'rotor_hub')!;
    const bearingJoint = impeller.joints.find((item) => item.type === 'revolute' && item.componentB === rotorHub.id)!;
    expect(bearingJoint.anchorB).toEqual([0, 0, 0]);
    expect(bearingJoint.limits).toBeUndefined();
    expect(impeller.motors.length).toBeGreaterThan(0);
    expect(impeller.components.every((item) => item.rotation.every((value) => value >= -Math.PI && value <= Math.PI))).toBe(true);
    expect(impeller.components.some((item) => item.primitive === 'conveyor')).toBe(false);
    expect(impeller.goal.constraints.map((item) => item.metric)).toEqual(expect.arrayContaining(['angular_travel', 'output_speed', 'assembly_integrity']));
    expect(impeller.goal.constraints.some((item) => item.metric === 'control_error')).toBe(false);

    const sevenBlade = compileDesignBrief('Build an aluminum seven-blade axial impeller for a ventilation duct and animate it at 300 rpm.');
    expect(sevenBlade.components.filter((item) => item.parameters?.cad_form === 'aero_blade')).toHaveLength(7);
    expect(sevenBlade.components.filter((item) => item.parameters?.cad_form === 'aero_blade').every((item) => item.materialId === 'aluminum')).toBe(true);
    expect(sevenBlade.components.some((item) => item.parameters?.cad_form === 'rotor_shroud' && item.role === 'ventilation duct shroud')).toBe(true);
  });

  it('builds a recognizable instrumented centrifugal pump instead of a generic rotor stand', () => {
    const plan = compileDesignBrief('Build a centrifugal water pump that delivers 50 liters per minute with a visible impeller, inlet, and outlet.');
    expect(plan.goal).toMatchObject({ machineName: 'Centrifugal process pump', domain: 'Fluid machinery' });
    expect(plan.goal.summary).toContain('centrifugal-pump');
    expect(plan.goal.summary).not.toContain('parametric-rotor');
    expect(plan.assemblies.some((item) => item.name === 'centrifugal process pump')).toBe(true);

    const volute = plan.components.find((item) => item.parameters?.pump_volute);
    const inlet = plan.components.find((item) => item.parameters?.pump_inlet && /pipe/.test(item.role));
    const outlet = plan.components.find((item) => item.parameters?.pump_outlet && /pipe/.test(item.role));
    const shaft = plan.components.find((item) => item.parameters?.pump_shaft);
    const hub = plan.components.find((item) => item.parameters?.pump_impeller);
    expect(volute).toMatchObject({ primitive: 'frame', role: 'spiral volute pump casing' });
    expect(inlet).toMatchObject({ primitive: 'shaft', role: 'axial suction inlet pipe', rotation: [Math.PI / 2, 0, 0] });
    expect(outlet).toMatchObject({ primitive: 'shaft', role: 'tangential discharge outlet pipe' });
    expect(inlet?.id).not.toBe(outlet?.id);
    expect(outlet!.position[0]).not.toBe(inlet!.position[0]);
    expect(outlet!.position[1]).toBeGreaterThan(inlet!.position[1]);
    expect(plan.components.filter((item) => item.parameters?.pump_bearing_support)).toHaveLength(2);
    expect(shaft).toMatchObject({ primitive: 'shaft', bodyType: 'kinematic' });
    expect(hub).toMatchObject({ primitive: 'wheel', bodyType: 'dynamic' });
    expect(plan.components.filter((item) => item.parameters?.pump_impeller_vane)).toHaveLength(6);

    const shaftJoint = plan.joints.find((item) => item.type === 'revolute' && item.componentB === hub?.id);
    expect(shaftJoint?.limits).toBeUndefined();
    expect(plan.motors).toHaveLength(1);
    expect(plan.motors[0]).toMatchObject({ jointId: shaftJoint?.id, maxRpm: 1800 });
    expect(plan.components.some((item) => item.parameters?.pump_motor)).toBe(true);
    expect(plan.sensors.map((item) => item.channel)).toEqual(expect.arrayContaining(['pump_shaft_speed', 'discharge_flow_lpm']));
    expect(plan.controls.some((item) => item.name === 'centrifugal pump duty point')).toBe(true);
    expect(plan.goal.constraints.find((item) => item.metric === 'flow_rate')).toMatchObject({ target: 50, unit: 'L/min', source: 'user' });
    expect(plan.goal.constraints.find((item) => item.metric === 'output_speed')).toMatchObject({ target: 1800, unit: 'rpm' });
    expect(plan.components.some((item) => item.role === 'rotor inspection stand')).toBe(false);
    expect(plan.components.some((item) => item.primitive === 'conveyor')).toBe(false);

    const impellerPart = compileDesignBrief('Build a centrifugal pump impeller with six blades.');
    expect(impellerPart.goal.summary).toContain('parametric-rotor');
    expect(impellerPart.goal.summary).not.toContain('centrifugal-pump');
  });

  it('keeps the centrifugal-pump shaft centered while the physics replay rotates its impeller', async () => {
    const state = assemblePlan(compileDesignBrief('Build a centrifugal water pump that delivers 50 liters per minute with a visible impeller, inlet, and outlet.'));
    const run = await simulateDesign(state);
    const impeller = state.components.find((item) => item.parameters.pump_impeller)!;
    const frames = run.replay.map((frame) => frame.items.find((item) => item.id === impeller.id)).filter((item) => item !== undefined);
    const displacement = Math.max(...frames.map((item) => Math.hypot(item.position[0] - impeller.position[0], item.position[1] - impeller.position[1], item.position[2] - impeller.position[2])));
    const orientations = new Set(frames.map((item) => item.rotation.map((value) => value.toFixed(2)).join(',')));
    expect(run.failures.some((item) => item.type === 'physics-health')).toBe(false);
    expect(displacement).toBeLessThan(.08);
    expect(orientations.size).toBeGreaterThan(3);
  }, 30_000);

  it('keeps a compact high-ratio gearbox at a credible bench-scale mass and size', () => {
    const gearbox = compileDesignBrief('Build a compact 12:1 reduction gearbox with two supported shafts, meshing gears, a motor, and an output speed sensor.');
    const housing = gearbox.components.find((item) => item.role === 'open gearbox housing')!;
    const outputGear = gearbox.components.find((item) => item.role === 'output gear')!;
    expect(housing.dimensions[0]).toBeLessThan(.6);
    expect(outputGear.dimensions[0]).toBeLessThan(.5);
    expect(gearbox.components.reduce((total, item) => total + (item.mass ?? componentMass(item.primitive, item.dimensions, item.materialId)), 0)).toBeLessThan(25);
  });

  it('builds a compact planetary differential instead of an ordinary two-gear reduction', () => {
    const plan = compileDesignBrief('Build a compact planetary differential with a sun gear, ring gear, three planet gears, carrier, input shaft, and two output shafts.');
    expect(plan.goal).toMatchObject({ machineName: 'Compact planetary differential', domain: 'Power transmission' });
    expect(plan.goal.summary).toContain('planetary-differential');
    expect(plan.goal.summary).not.toContain('rotary-transmission');
    expect(plan.goal.summary).not.toContain('requested-primitives');
    expect(plan.assemblies.some((item) => item.name === 'planetary differential gearset')).toBe(true);
    expect(plan.components.filter((item) => item.primitive === 'gear')).toHaveLength(5);
    expect(plan.components.filter((item) => item.parameters?.planetary_sun)).toHaveLength(1);
    expect(plan.components.filter((item) => item.parameters?.planetary_ring)).toHaveLength(1);
    expect(plan.components.filter((item) => item.parameters?.planetary_planet)).toHaveLength(3);
    const carrier = plan.components.find((item) => item.parameters?.planetary_carrier)!;
    expect(carrier.bodyType).toBe('dynamic');
    expect(plan.components.filter((item) => item.parameters?.planetary_input_shaft)).toHaveLength(1);
    expect(plan.components.filter((item) => item.parameters?.planetary_output_shaft)).toHaveLength(2);
    expect(plan.components.filter((item) => item.primitive === 'shaft')).toHaveLength(3);
    expect(new Set(plan.components.filter((item) => item.parameters?.planetary_output_shaft).map((item) => item.parameters?.output_side))).toEqual(new Set(['left', 'right']));
    expect(plan.joints.filter((item) => item.type === 'fixed' && plan.components.some((gear) => gear.parameters?.planetary_planet && gear.id === item.componentB))).toHaveLength(3);
    expect(plan.joints.some((item) => item.type === 'gear' && item.componentA === carrier.id)).toBe(true);
    expect(plan.joints.some((item) => item.type === 'belt' && item.componentA === carrier.id)).toBe(true);
    const carrierJoint = plan.joints.find((item) => item.type === 'revolute' && item.componentB === carrier.id)!;
    expect(carrierJoint.limits).toBeUndefined();
    expect(plan.motors).toHaveLength(1);
    expect(plan.motors[0].jointId).toBe(carrierJoint.id);
    expect(plan.sensors.map((item) => item.channel)).toEqual(expect.arrayContaining(['left_output_rpm', 'right_output_rpm']));
    expect(plan.components.some((item) => item.role === 'input gear' || item.role === 'output gear')).toBe(false);
  });

  it('preserves an arbitrary planetary ratio instead of accidentally squaring it', () => {
    const plan = compileDesignBrief('Build a compact 6:1 planetary differential with a sun gear, ring gear, three planet gears, and two outputs at 120 rpm.');
    const couplings = plan.joints.filter((item) => item.type === 'gear' || item.type === 'belt');
    expect(plan.goal.capabilities).toContain('transmit');
    expect(couplings).toHaveLength(2);
    expect(couplings.reduce((product, item) => product * (item.ratio ?? 1), 1)).toBeCloseTo(6, 6);
    expect(plan.goal.constraints).toEqual(expect.arrayContaining([expect.objectContaining({ metric: 'speed_ratio', target: 6, source: 'user' })]));
  });

  it('recognizes common scissor-lift wording and comma-formatted press force', () => {
    expect(compileDesignBrief('Build a scissor-type lift that raises 250 kg by 1 meter.').goal.summary).toContain('scissor-linkage-lift');
    const press = compileDesignBrief('Build a hydraulic shop press that applies 50,000 N through a guided ram over a 300 mm stroke.');
    expect(press.goal.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'pressing_force', target: 50000, source: 'user' }),
      expect.objectContaining({ metric: 'stroke', target: .3, source: 'user' }),
    ]));
  });

  it('keeps centrifugal-pump subparts in the CAD-part path', () => {
    const prompts = [
      'Build a centrifugal pump housing with a removable cover.',
      'Build an impeller and housing for a centrifugal pump.',
      'Build a centrifugal pump shaft.',
      'Build a centrifugal pump seal.',
      'Build a centrifugal pump cover.',
    ];
    for (const prompt of prompts) {
      const plan = compileDesignBrief(prompt);
      expect(plan.goal.summary).toContain('parametric-');
      expect(plan.goal.summary).not.toContain('centrifugal-pump');
    }
  });

  it('changes physical sizing when numeric requirements change', () => {
    const lightCrane = compileDesignBrief('Build a crane that lifts 20 kg by 2 meters without tipping.');
    const heavyCrane = compileDesignBrief('Build a crane that lifts 200 kg by 2 meters without tipping.');
    expect(heavyCrane.components.find((item) => item.primitive === 'counterweight')?.mass).toBeGreaterThan(lightCrane.components.find((item) => item.primitive === 'counterweight')?.mass ?? 0);

    const four = compileDesignBrief('Build a compact 4:1 gearbox with 120 rpm input and 40 N·m output torque.');
    const ten = compileDesignBrief('Build a compact 10:1 gearbox with 120 rpm input and 40 N·m output torque.');
    expect(ten.joints.find((item) => item.type === 'gear')?.ratio).toBe(10);
    expect(ten.components.find((item) => item.role === 'output gear')?.dimensions[0]).toBeGreaterThan(four.components.find((item) => item.role === 'output gear')?.dimensions[0] ?? 0);

    const short = compileDesignBrief('Build a 2 meter bridge that supports 500 kg with less than 10 mm deflection.');
    const long = compileDesignBrief('Build a 8 meter bridge that supports 500 kg with less than 10 mm deflection.');
    expect(long.components.find((item) => item.role === 'span deck')?.dimensions[0]).toBeGreaterThan(short.components.find((item) => item.role === 'span deck')?.dimensions[0] ?? 0);
  });

  it('constructs novel mechanisms from lower-level primitives instead of rejecting them', () => {
    const drawbridge = compileDesignBrief('Build a 4 meter drawbridge that raises in under 15 seconds using a motor, pulley, and counterweight.');
    expect(drawbridge.components.some((item) => item.role.startsWith('hinged span'))).toBe(true);
    expect(drawbridge.components.some((item) => item.primitive === 'pulley')).toBe(true);
    expect(drawbridge.components.some((item) => item.primitive === 'counterweight')).toBe(true);
    expect(drawbridge.joints.some((item) => item.type === 'revolute')).toBe(true);
    expect(drawbridge.components.some((item) => item.parameters?.water_surface)).toBe(true);
    expect(drawbridge.components.filter((item) => item.parameters?.bridge_abutment)).toHaveLength(2);
    expect(drawbridge.components.some((item) => item.parameters?.drawbridge_hinge)).toBe(true);
    expect(drawbridge.components.some((item) => item.role === 'moving design load')).toBe(false);

    const unknown = compileDesignBrief('Build an automatic rotating hatch that opens one meter and senses obstructions.');
    expect(unknown.components.length).toBeGreaterThan(3);
    expect(unknown.components.some((item) => item.primitive === 'conveyor')).toBe(false);
  });

  it('fails honestly when no faithful topology can be inferred instead of showing a random machine', () => {
    expect(() => compileDesignBrief('Build a completely novel quantum coffee machine.')).toThrow(/could not identify a faithful primitive architecture/i);
    expect(() => compileDesignBrief('Build a completely novel quantum coffee machine.')).toThrow(/structure, moving parts, drive, and required motion/i);
  });

  it('composes compound systems without keyword false positives', () => {
    const crane = compileDesignBrief('Build a gearbox-driven crane with a 4:1 reduction that lifts 80 kg by 2 meters.');
    expect(crane.components.some((item) => item.primitive === 'gear')).toBe(true);
    expect(crane.components.some((item) => item.primitive === 'pulley')).toBe(true);
    expect(crane.components.some((item) => /suspended.*payload/.test(item.role))).toBe(true);
    expect(crane.components.some((item) => item.role.startsWith('road wheel'))).toBe(false);
    expect(crane.connections.some((item) => item.channel === 'compound_drive_output')).toBe(true);
    expect(crane.goal.constraints.map((item) => item.metric)).toEqual(expect.arrayContaining(['speed_ratio', 'payload_capacity', 'lift_height']));

    const mountedArm = compileDesignBrief('Build a rover-mounted robotic arm that carries 8 kg and reaches 1.5 meters.');
    expect(mountedArm.components.filter((item) => item.primitive === 'wheel')).toHaveLength(4);
    expect(mountedArm.components.some((item) => item.primitive === 'gripper')).toBe(true);

    const trackedRover = compileDesignBrief('Build a tracked rover that carries 20 kg across rough terrain.');
    expect(trackedRover.components.some((item) => item.role === 'tracked panel')).toBe(false);
    expect(trackedRover.components.some((item) => item.role === 'dual light sensor')).toBe(false);
  });

  it('treats power sources as modifiers and assembles a misspelled solar e-bike as one machine', () => {
    const plan = compileDesignBrief('build a solar powered electric bycicle');
    expect(plan.goal.machineName).toBe('Solar electric bicycle');
    expect(plan.goal.domain).toBe('Personal electric mobility');
    expect(plan.assemblies.map((item) => item.name)).toEqual(['engineered world', 'bicycle assembly']);
    expect(plan.components.filter((item) => item.parameters?.bicycle_wheel)).toHaveLength(2);
    expect(plan.components.filter((item) => item.parameters?.bicycle_tube).length).toBeGreaterThanOrEqual(12);
    expect(plan.components.some((item) => item.role === 'rider saddle')).toBe(true);
    expect(plan.components.some((item) => item.role === 'handlebar')).toBe(true);
    expect(plan.components.some((item) => item.parameters?.bicycle_chain)).toBe(true);
    expect(plan.components.some((item) => item.role === 'mid-drive electric motor')).toBe(true);
    expect(plan.components.some((item) => item.parameters?.bicycle_battery)).toBe(true);
    expect(plan.components.some((item) => item.parameters?.bicycle_solar_panel)).toBe(true);
    expect(plan.components.some((item) => item.role === 'tracked panel')).toBe(false);
    expect(plan.components.some((item) => item.role === 'mobile chassis deck')).toBe(false);
    expect(plan.components.some((item) => item.role.startsWith('road wheel'))).toBe(false);
    expect(plan.goal.capabilities).not.toContain('track');
    expect(plan.goal.summary).toContain('single-track-vehicle');

    const illuminated = compileDesignBrief('Build a solar powered electric bicycle with a front headlight.');
    const light = illuminated.components.find((item) => item.primitive === 'light');
    expect(light).toMatchObject({ role: 'front LED bicycle headlight', mass: .24 });
    expect(illuminated.connections.some((item) => item.targetId === light?.id && item.channel === 'lighting_bus')).toBe(true);

    const complete = compileDesignBrief('Build an electric bicycle with two wheels, welded frame, fork, handlebar, saddle, pedals, chain drive, battery, motor, headlight, and wheel-speed sensor.');
    expect(complete.assemblies.map((item) => item.name)).toEqual(['engineered world', 'bicycle assembly']);
    expect(complete.components.some((item) => item.role.startsWith('requested '))).toBe(false);
    const bodyBudget = complete.goal.constraints.find((item) => item.metric === 'component_count');
    expect(bodyBudget?.target).toBe(40);
    expect(complete.components.length).toBeLessThanOrEqual(bodyBudget!.target);
  });

  it('builds a recognizable electric go-kart instead of a rover or arbitrary payload cart', () => {
    const plan = compileDesignBrief('build an electric go kart');
    expect(plan.goal.machineName).toBe('Electric go-kart');
    expect(plan.goal.domain).toBe('Personal electric mobility');
    expect(plan.assemblies.map((item) => item.name)).toEqual(['engineered world', 'go-kart assembly']);
    expect(plan.goal.summary).toContain('low-profile-road-vehicle');
    expect(plan.components.filter((item) => item.parameters?.road_vehicle_wheel)).toHaveLength(4);
    expect(plan.components.filter((item) => item.parameters?.road_vehicle_frame).length).toBeGreaterThanOrEqual(9);
    expect(plan.components.some((item) => item.role === 'single high-back bucket seat' && item.primitive === 'seat')).toBe(true);
    expect(plan.components.some((item) => item.role === 'steering wheel')).toBe(true);
    expect(plan.components.some((item) => item.role === 'front steering rack')).toBe(true);
    expect(plan.components.some((item) => item.role === 'high-voltage traction battery')).toBe(true);
    expect(plan.components.some((item) => item.role === 'dual-motor inverter controller')).toBe(true);
    expect(plan.components.filter((item) => /electric traction motor/.test(item.role))).toHaveLength(2);
    expect(plan.components.filter((item) => /front brake disc/.test(item.role))).toHaveLength(2);
    expect(plan.components.filter((item) => /steering tie rod/.test(item.role))).toHaveLength(2);
    expect(plan.components.filter((item) => item.parameters?.road_vehicle_kingpin)).toHaveLength(2);
    expect(plan.components.filter((item) => item.parameters?.road_vehicle_steering_knuckle)).toHaveLength(2);
    expect(plan.components.filter((item) => item.parameters?.road_vehicle_spindle)).toHaveLength(4);
    expect(plan.components.filter((item) => item.parameters?.road_vehicle_wheel_hub)).toHaveLength(4);
    const frontWheels = plan.components.filter((item) => item.parameters?.road_vehicle_front_steering && item.parameters?.road_vehicle_wheel);
    expect(frontWheels).toHaveLength(2);
    expect(frontWheels.map((item) => item.parameters?.steering_side).sort()).toEqual(['left', 'right']);
    const accelerator = plan.components.find((item) => item.role === 'accelerator pedal')!;
    const brake = plan.components.find((item) => item.role === 'brake pedal')!;
    expect(accelerator.parameters?.pedal_kind).toBe('accelerator');
    expect(brake.parameters?.pedal_kind).toBe('brake');
    expect(accelerator.position[2]).toBeGreaterThan(0);
    expect(brake.position[2]).toBeLessThan(0);
    expect(accelerator.dimensions[1]).toBeGreaterThan(accelerator.dimensions[0] * 4);
    expect(brake.dimensions[2]).toBeGreaterThan(accelerator.dimensions[2]);
    const tractionMotors = plan.motors.filter((item) => /traction/i.test(plan.components.find((component) => component.id === item.componentId)?.role ?? ''));
    expect(tractionMotors).toHaveLength(2);
    expect(tractionMotors.every((item) => item.direction < 0)).toBe(true);
    expect(plan.components.some((item) => item.role === 'mobile payload')).toBe(false);
    expect(plan.components.some((item) => item.role === 'mobile chassis deck')).toBe(false);
    expect(plan.components.some((item) => item.primitive === 'conveyor')).toBe(false);
    expect(plan.components.filter((item) => item.primitive === 'body-shell')).toHaveLength(3);
    expect(plan.components.some((item) => item.role === 'wraparound front bumper' && item.primitive === 'tube')).toBe(true);
    expect(plan.goal.constraints.map((item) => item.metric)).toEqual(expect.arrayContaining(['course_time', 'traction_margin', 'assembly_integrity', 'component_count']));

    const illuminated = compileDesignBrief('Build an electric go-cart with two LED headlights for night driving.');
    expect(illuminated.goal.machineName).toBe('Electric go-kart');
    expect(illuminated.components.filter((item) => item.primitive === 'light')).toHaveLength(2);
    expect(illuminated.connections.filter((item) => item.channel === 'lighting_bus')).toHaveLength(2);
  });

  it('builds a proportioned passenger car with a readable cabin and driver layout', () => {
    const car = compileDesignBrief('Build a realistic four-door road car with a clear windshield, headlights, tail lights, and four seats.');
    const body = car.components.find((item) => item.parameters?.passenger_car_body)!;
    const windshield = car.components.find((item) => item.parameters?.cockpit_windshield)!;
    const rearWindow = car.components.find((item) => item.parameters?.rear_windshield)!;
    const sideWindows = car.components.filter((item) => item.parameters?.side_window);
    const steeringWheel = car.components.find((item) => item.parameters?.road_vehicle_steering_wheel)!;
    const driverSeat = car.components.find((item) => item.parameters?.driver_seat)!;
    const accelerator = car.components.find((item) => item.parameters?.pedal_kind === 'accelerator')!;
    const brake = car.components.find((item) => item.parameters?.pedal_kind === 'brake')!;

    expect(body.dimensions[0]).toBeGreaterThan(3.5);
    expect(body.dimensions[2]).toBeGreaterThan(1.5);
    expect(Number(body.parameters?.wheelbase_m)).toBeGreaterThan(2.4);
    expect(car.components.filter((item) => item.parameters?.road_vehicle_wheel)).toHaveLength(4);
    expect(car.components.some((item) => item.parameters?.passenger_seat)).toBe(true);
    expect(car.components.some((item) => item.parameters?.rear_bench_seat)).toBe(true);
    expect(windshield.parameters).toMatchObject({ transparent_glazing: true, facing_axis: '+X', attached_to_cockpit: true });
    expect(windshield.position[0]).toBeGreaterThan(0);
    expect(rearWindow.parameters).toMatchObject({ transparent_glazing: true, facing_axis: '-X' });
    expect(sideWindows).toHaveLength(2);
    expect(steeringWheel.position[2]).toBeLessThan(0);
    expect(driverSeat.position[2]).toBeLessThan(0);
    expect(accelerator.position[2]).toBeLessThan(0);
    expect(brake.position[2]).toBeLessThan(accelerator.position[2]);
    expect(car.assemblies.map((item) => item.name)).not.toContain('constructed motion stage');
    expect(car.assemblies.map((item) => item.name)).not.toContain('requested primitive extension');
    expect(car.components.length).toBeLessThanOrEqual(64);
  });

  it('builds a human-proportioned humanoid with a visible face and connected articulated limbs', () => {
    const robot = compileDesignBrief('Build a humanoid service robot with two hands and stereo vision.');
    expect(robot.components.filter((item) => item.parameters?.robot_foot)).toHaveLength(2);
    expect(robot.components.filter((item) => item.parameters?.robot_limb)).toHaveLength(8);
    expect(robot.components.filter((item) => item.parameters?.robot_hand)).toHaveLength(2);
    expect(robot.components.filter((item) => item.parameters?.robot_joint).length).toBeGreaterThanOrEqual(6);
    expect(robot.components.find((item) => item.parameters?.robot_head)?.parameters).toMatchObject({ robot_face: true });
    expect(robot.components.some((item) => item.parameters?.robot_torso)).toBe(true);
    expect(robot.components.some((item) => item.parameters?.robot_pelvis)).toBe(true);
    for (const joint of robot.joints) {
      const a = robot.components.find((item) => item.id === joint.componentA)!;
      const b = robot.components.find((item) => item.id === joint.componentB)!;
      const worldA = localPointToWorld(a.position, a.rotation, joint.anchorA);
      const worldB = localPointToWorld(b.position, b.rotation, joint.anchorB);
      expect(Math.hypot(...worldA.map((value, axis) => value - worldB[axis]))).toBeLessThan(.001);
    }
  });

  it('anchors an industrial robot arm at real link endpoints and uses stable motion limits', () => {
    const arm = compileDesignBrief('Build a three-axis robotic arm with a gripper that reaches 2 meters.');
    const links = arm.components.filter((item) => item.parameters?.robot_arm_link);
    const housings = arm.components.filter((item) => item.parameters?.robot_arm_joint);
    expect(links).toHaveLength(3);
    expect(housings).toHaveLength(3);
    expect(arm.components.some((item) => item.parameters?.robot_arm_base)).toBe(true);
    expect(arm.components.some((item) => item.parameters?.robot_arm_pedestal)).toBe(true);
    expect(arm.components.some((item) => item.parameters?.robot_arm_camera)).toBe(true);
    expect(arm.components.some((item) => item.parameters?.robot_arm_gripper)).toBe(true);
    for (const link of links) {
      const joint = arm.joints.find((item) => item.componentB === link.id && item.type === 'revolute')!;
      expect(joint.limits && joint.limits[1] - joint.limits[0]).toBeLessThanOrEqual(.8);
      const parent = arm.components.find((item) => item.id === joint.componentA)!;
      const worldA = localPointToWorld(parent.position, parent.rotation, joint.anchorA);
      const worldB = localPointToWorld(link.position, link.rotation, joint.anchorB);
      expect(Math.hypot(...worldA.map((value, axis) => value - worldB[axis]))).toBeLessThan(.001);
      expect(Math.abs(joint.anchorB[0])).toBeCloseTo(link.dimensions[0] / 2, 3);
    }
  });

  it('keeps a regular bicycle human-powered unless electrification is requested', () => {
    const bicycle = compileDesignBrief('Build a bicycle with pedals, a chain, and front and rear lights.');
    expect(bicycle.components.filter((item) => item.parameters?.bicycle_pedal)).toHaveLength(2);
    expect(bicycle.components.some((item) => item.parameters?.bicycle_hub_motor)).toBe(false);
    expect(bicycle.components.some((item) => item.parameters?.bicycle_battery)).toBe(false);
    expect(bicycle.components.some((item) => item.parameters?.bicycle_controller)).toBe(false);
    expect(bicycle.components.find((item) => item.parameters?.headlight)?.parameters?.facing_axis).toBe('+X');
    expect(bicycle.components.find((item) => item.parameters?.brake_light)?.parameters?.facing_axis).toBe('-X');
  });

  it('uses the universal frame for aircraft glazing and navigation lights', () => {
    const aircraft = compileDesignBrief('Build an airplane with navigation lights and landing lights.');
    expect(aircraft.goal.orientation).toMatchObject({ front: '+X', rear: '-X', left: '-Z', right: '+Z', up: '+Y', down: '-Y' });
    expect(aircraft.components.find((item) => item.parameters?.cockpit_windshield)?.parameters).toMatchObject({ transparent_glazing: true, facing_axis: '+X', attached_to_cockpit: true });
    expect(aircraft.components.find((item) => item.parameters?.navigation_side === 'left')).toMatchObject({ color: '#ff3344', parameters: expect.objectContaining({ facing_axis: '-Z' }) });
    expect(aircraft.components.find((item) => item.parameters?.navigation_side === 'right')).toMatchObject({ color: '#32e875', parameters: expect.objectContaining({ facing_axis: '+Z' }) });
    expect(aircraft.components.find((item) => item.parameters?.navigation_side === 'tail')).toMatchObject({ color: '#f3f8ff', parameters: expect.objectContaining({ facing_axis: '-X' }) });
    expect(aircraft.components.filter((item) => item.parameters?.landing_light).every((item) => item.parameters?.facing_axis === '+X')).toBe(true);
  });

  it.each([
    ['electric motorcycle', 'Build an electric motorcycle with a headlight.', 'Electric motorcycle', ['wheel', 'tube', 'seat', 'steering', 'motor', 'battery']],
    ['fixed-wing aircraft', 'Build an electric fixed-wing aircraft with a propeller and landing gear.', 'Electric fixed-wing aircraft', ['fuselage', 'aerofoil', 'propeller', 'landing-gear', 'motor']],
    ['helicopter', 'Build a utility helicopter with a main rotor and tail rotor.', 'Utility helicopter', ['fuselage', 'rotor', 'propeller', 'tube', 'motor']],
    ['service robot', 'Build a humanoid service robot with two grippers and vision.', 'Articulated service robot', ['body-shell', 'linkage', 'servo', 'gripper', 'camera', 'battery']],
  ])('builds a distinct recognizable %s from reusable component families', (_label, prompt, machineName, required) => {
    const plan = compileDesignBrief(prompt);
    expect(plan.goal.machineName).toBe(machineName);
    for (const kind of required) expect(plan.components.some((item) => item.primitive === kind), `missing ${kind}`).toBe(true);
    expect(plan.components.some((item) => item.primitive === 'conveyor')).toBe(false);
    expect(plan.connections.length + plan.joints.length).toBeGreaterThan(4);
  });

  it.each([
    ['road vehicle', 'Design an electric buggy for rough trails.', 'low-profile-road-vehicle'],
    ['single-track vehicle', 'Build a pedal bicycle with an electric assist motor.', 'single-track-vehicle'],
    ['mobile robot', 'Build a four-wheel rover for an obstacle course.', 'rolling-support'],
    ['lifting system', 'Build a crane that lifts a 100 kg beam.', 'cable-suspension'],
    ['parallel lift', 'Design a synchronized cargo elevator for 100 kg.', 'parallel-guides'],
    ['robot mechanism', 'Create a three-axis robotic arm with a gripper.', 'serial-linkage'],
    ['transmission', 'Build a compact 5:1 reduction gearbox.', 'rotary-transmission'],
    ['material handling', 'Build a warehouse conveyor that sorts three package sizes.', 'warehouse-buffer'],
    ['recycling line', 'Build a recycling machine that separates cans and bottles.', 'recycling-separator'],
    ['agricultural grader', 'Build a tomato sorting line with gentle ramps.', 'tomato-grader'],
    ['structural system', 'Build a truss bridge spanning 8 meters.', 'span-members'],
    ['renewable mechanism', 'Build a solar panel tracker that follows the sun.', 'tracking-axis'],
    ['fluid mechanism', 'Build a reciprocating water pump with a flywheel.', 'reciprocating-linkage'],
    ['closed linkage', 'Build a four-bar linkage that rotates 80 degrees.', 'closed-linkage'],
    ['machined part', 'Build a sealed bearing for a 30 mm shaft.', 'parametric-bearing'],
    ['rotating part', 'Build a six-blade ventilation impeller.', 'parametric-rotor'],
    ['thermal assembly', 'Build a brazed plate heat exchanger for an HVAC unit.', 'brazed-plate-heat-exchanger'],
    ['manufacturing fixture', 'Build an HVAC brazing fixture for two copper pipes.', 'hvac-brazing-fixture'],
  ])('routes the %s prompt to its requested physical architecture', (_family, prompt, moduleId) => {
    const plan = compileDesignBrief(prompt);
    expect(plan.goal.summary).toContain(moduleId);
    expect(plan.components.length).toBeGreaterThan(1);
    expect(plan.components.some((item) => item.role === 'mobile payload')).toBe(moduleId === 'rolling-support');
    if (!['material-flow', 'warehouse-buffer', 'recycling-separator', 'tomato-grader'].includes(moduleId)) expect(plan.components.some((item) => item.primitive === 'conveyor')).toBe(false);
  });

  it('still builds an active solar tracker only when the prompt asks it to track', () => {
    const tracker = compileDesignBrief('Build a solar tracker that follows the sun using one actuator.');
    expect(tracker.components.some((item) => item.role === 'tracked panel')).toBe(true);
    expect(tracker.goal.capabilities).toContain('track');
  });

  it('constructs explicit novel mechanisms and parses paraphrased geometry', () => {
    const pump = compileDesignBrief('Build a reciprocating pump with a flywheel that delivers 20 liters per minute.');
    expect(pump.components.some((item) => item.role === 'reciprocating plunger')).toBe(true);
    expect(pump.components.some((item) => item.role === 'pump chamber')).toBe(true);
    expect(pump.components.filter((item) => /valve plate/.test(item.role))).toHaveLength(2);
    expect(pump.components.some((item) => item.role.startsWith('road wheel'))).toBe(false);
    expect(pump.goal.constraints.find((item) => item.metric === 'flow_rate')?.target).toBe(20);

    const explicit = compileDesignBrief('Build two gears, a piston, and a camera to cycle a latch through 0.5 meter stroke.');
    expect(explicit.components.filter((item) => item.primitive === 'gear').length).toBeGreaterThanOrEqual(2);
    expect(explicit.components.some((item) => item.primitive === 'piston')).toBe(true);
    expect(explicit.components.some((item) => item.primitive === 'camera')).toBe(true);

    const paraphrased = compileDesignBrief('Build a bridge spanning 8 meters that supports 500 kg.');
    expect(paraphrased.goal.constraints.find((item) => item.metric === 'span')?.target).toBe(8);
    expect(paraphrased.components.filter((item) => /span deck|hinged span/.test(item.role)).reduce((sum, item) => sum + item.dimensions[0], 0)).toBeCloseTo(8, 3);
  });

  it('builds folding and closed-linkage topology from low-level members', () => {
    const folding = compileDesignBrief('Build a two-span hydraulic folding bridge spanning 6 meters.');
    expect(folding.components.filter((item) => item.role.startsWith('hinged span'))).toHaveLength(2);
    expect(folding.joints.filter((item) => item.type === 'revolute' && folding.components.some((body) => body.id === item.componentB && body.role.startsWith('hinged span')))).toHaveLength(2);
    expect(folding.actuators.some((item) => item.type === 'piston')).toBe(true);

    const linkage = compileDesignBrief('Build a four-bar linkage with 0.5 meter linear stroke and 75 degree travel.');
    expect(linkage.components.filter((item) => ['ground link', 'input crank', 'coupler link', 'output rocker'].includes(item.role))).toHaveLength(4);
    expect(linkage.joints.filter((item) => item.type === 'revolute')).toHaveLength(4);
    expect(linkage.joints.some((item) => item.type === 'prismatic' && item.limits?.[1] === .5)).toBe(true);
  });

  it('distinguishes a brazed-plate heat exchanger from an HVAC brazing fixture', () => {
    const exchanger = compileDesignBrief('Build a braze plate for a good HVAC unit.');
    const detailed = compileDesignBrief('Build a brazing fixture plate that positions a heat exchanger and two copper pipes within 2 mm before brazing.');
    expect(exchanger.goal.machineName).toBe('Brazed plate heat exchanger');
    expect(exchanger.goal.domain).toBe('HVAC thermal systems');
    expect(exchanger.components.filter((item) => item.parameters?.bphe_plate)).toHaveLength(12);
    expect(exchanger.components.filter((item) => item.parameters?.bphe_port)).toHaveLength(4);
    expect(exchanger.components.filter((item) => item.parameters?.bphe_end_plate)).toHaveLength(2);
    expect(exchanger.goal.constraints.map((item) => item.metric)).toEqual(expect.arrayContaining(['plate_count', 'port_count', 'assembly_integrity']));

    expect(detailed.goal.machineName).toBe('Precision HVAC brazing fixture');
    expect(detailed.goal.domain).toBe('HVAC manufacturing');
    expect(detailed.components.some((item) => item.parameters?.fixture_plate)).toBe(true);
    expect(detailed.components.some((item) => item.parameters?.heat_exchanger_core)).toBe(true);
    expect(detailed.components.filter((item) => item.parameters?.hvac_pipe).length).toBeGreaterThanOrEqual(4);
    expect(detailed.components.filter((item) => item.parameters?.fixture_clamp)).toHaveLength(2);
    expect(detailed.components.filter((item) => item.parameters?.locating_pin)).toHaveLength(4);
    expect(detailed.components.some((item) => item.parameters?.cad_form)).toBe(false);
    expect(detailed.goal.constraints.map((item) => item.metric)).toEqual(expect.arrayContaining(['alignment_error', 'clamp_force', 'assembly_integrity']));
    for (const plan of [exchanger, detailed]) {
      expect(plan.components.some((item) => item.role === 'constructed base')).toBe(false);
      expect(plan.components.some((item) => item.role.startsWith('serial link'))).toBe(false);
    }
    expect(detailed.goal.constraints.find((item) => item.metric === 'alignment_error')?.target).toBe(2);
  });

  it('does not let incidental substrings or parent-machine words select unrelated templates', () => {
    const feedback = compileDesignBrief('Build a feedback-controlled four-bar linkage with 60 degree travel.');
    expect(feedback.goal.summary).toContain('closed-linkage');
    expect(feedback.components.some((item) => item.primitive === 'conveyor')).toBe(false);

    const buffer = compileDesignBrief('Build a buffer where Machine A produces a part every 2 seconds and Machine B pauses.');
    expect(buffer.goal.summary).toContain('warehouse-buffer');
    expect(buffer.goal.summary).not.toContain('tomato-grader');

    const gearbox = compileDesignBrief('Build a compact 12:1 reduction gearbox.');
    expect(gearbox.goal.summary).toContain('rotary-transmission');
    expect(gearbox.goal.summary).not.toContain('parametric-manifold');

    const products = compileDesignBrief('Build an inspection conveyor for consumer products.');
    expect(products.goal.summary).toContain('material-flow');
    expect(products.goal.summary).not.toContain('parametric-manifold');

    const turbine = compileDesignBrief('Build a fixed-pitch wind turbine rotor.');
    expect(turbine.goal.summary).toContain('parametric-rotor');
    expect(turbine.goal.summary).not.toContain('tracking-axis');

    const centrifugal = compileDesignBrief('Build a centrifugal pump for 20 liters per minute.');
    expect(centrifugal.goal.summary).toContain('centrifugal-pump');
    expect(centrifugal.goal.summary).not.toContain('parametric-rotor');
    expect(centrifugal.goal.summary).not.toContain('reciprocating-linkage');

    const housing = compileDesignBrief('Build a sealed pump housing.');
    expect(housing.goal.summary).toContain('parametric-housing');
    expect(housing.goal.summary).not.toContain('reciprocating-linkage');

    const duct = compileDesignBrief('Build an HVAC rectangular air duct.');
    expect(duct.goal.summary).toContain('parametric-manifold');

    const jack = compileDesignBrief('Build a car jack raising 1500 kg.');
    expect(jack.goal.summary).toContain('parallel-guides');
    expect(jack.components.some((item) => item.parameters?.road_vehicle_wheel)).toBe(false);

    const vise = compileDesignBrief('Build a bench vise with a screw drive and replaceable jaw plates.');
    expect(vise.goal.summary).toContain('bench-vise');
    expect(vise.components.some((item) => item.role === 'Acme-thread lead screw')).toBe(true);
    expect(vise.components.filter((item) => item.parameters?.vise_jaw_plate)).toHaveLength(2);
    expect(vise.goal.summary).not.toContain('constructed-motion');
    expect(() => compileDesignBrief('Build an assorted tool tray.')).toThrow(/could not identify a faithful/i);
  });

  it('builds a force-rated hydraulic press with a millimeter-scale driven ram', () => {
    const plan = compileDesignBrief('Design a hydraulic press that applies 50 kN over a 300 mm stroke.');
    expect(plan.goal.machineName).toBe('Hydraulic press');
    expect(plan.goal.summary).toContain('hydraulic-press');
    expect(plan.goal.summary).not.toContain('constructed-motion');
    expect(plan.components.filter((item) => item.parameters?.press_column)).toHaveLength(2);
    expect(plan.components.some((item) => item.parameters?.press_bed)).toBe(true);
    const platen = plan.components.find((item) => item.parameters?.press_platen)!;
    const ram = plan.components.find((item) => item.parameters?.hydraulic_ram)!;
    const motion = plan.joints.find((item) => item.type === 'prismatic' && item.componentB === platen.id)!;
    expect(motion.axis).toEqual([0, -1, 0]);
    expect(motion.limits).toEqual([0, .3]);
    expect(plan.actuators.find((item) => item.componentId === ram.id)).toMatchObject({ jointId: motion.id, type: 'piston', travel: .3, maxForce: 50000 });
    expect(plan.goal.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'pressing_force', target: 50000, source: 'user' }),
      expect.objectContaining({ metric: 'stroke', target: .3, source: 'user' }),
    ]));
  });

  it('builds an electric drum winch whose drum spins while the cable lifts the hook', () => {
    const plan = compileDesignBrief('Build an electric winch that lifts 200 kg by 3 meters at 0.2 m/s.');
    expect(plan.goal.machineName).toBe('Electric cable winch');
    expect(plan.goal.summary).toContain('drum-winch');
    expect(plan.goal.summary).not.toContain('parallel-guides');
    expect(plan.goal.summary).not.toContain('cable-suspension');
    expect(plan.components.some((item) => item.parameters?.winch_drum)).toBe(true);
    expect(plan.components.filter((item) => item.parameters?.winch_cable)).toHaveLength(2);
    expect(plan.components.some((item) => item.parameters?.winch_hook)).toBe(true);
    const shaft = plan.components.find((item) => item.parameters?.winch_shaft)!;
    const hook = plan.components.find((item) => item.parameters?.winch_hook)!;
    const shaftJoint = plan.joints.find((item) => item.type === 'revolute' && item.componentB === shaft.id)!;
    const ropeJoint = plan.joints.find((item) => item.type === 'rope' && item.componentB === hook.id)!;
    expect(plan.motors.some((item) => item.jointId === shaftJoint.id)).toBe(true);
    expect(plan.actuators.find((item) => item.jointId === ropeJoint.id)).toMatchObject({ type: 'winch', travel: 3, maxSpeed: .2 });
    expect(plan.goal.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'payload_capacity', target: 200, source: 'user' }),
      expect.objectContaining({ metric: 'lift_height', target: 3, source: 'user' }),
      expect.objectContaining({ metric: 'line_speed', target: .2, source: 'user' }),
    ]));
  });
});
