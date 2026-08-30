import { describe, expect, it } from 'vitest';
import { componentMass, engineeringExamples } from './forge-data';
import { compileDesignBrief } from './forge-prompt';

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
    expect(plans.lift.joints.filter((item) => item.type === 'prismatic').length).toBeGreaterThanOrEqual(2);
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
      arm: (plan) => plan.components.some((item) => item.primitive === 'gripper') && plan.components.filter((item) => item.role.startsWith('link servo')).length === 3,
      gearbox: (plan) => plan.components.some((item) => item.parameters?.gearbox_housing) && plan.components.filter((item) => item.primitive === 'gear').length === 2 && plan.components.filter((item) => item.parameters?.gearbox_bearing).length === 2,
      suspension: (plan) => plan.components.filter((item) => item.primitive === 'spring').length === 4 && plan.components.filter((item) => item.parameters?.suspension_wheel).length === 4 && plan.components.some((item) => item.parameters?.automotive_body) && plan.components.filter((item) => item.parameters?.suspension_arm).length === 8 && !plan.components.some((item) => item.parameters?.rover_chassis || item.role === 'mobile payload'),
      solar: (plan) => plan.components.some((item) => item.parameters?.solar_array) && plan.components.some((item) => item.parameters?.solar_source) && plan.components.some((item) => item.parameters?.tracker_foundation && item.position[1] - item.dimensions[1] / 2 === 0) && plan.components.filter((item) => item.parameters?.tracker_yoke).length === 2 && plan.joints.some((item) => item.type === 'revolute'),
      lift: (plan) => plan.components.some((item) => item.parameters?.patient_sling) && plan.components.filter((item) => item.parameters?.medical_caster).length === 4 && plan.components.filter((item) => item.parameters?.sling_strap).length === 4 && plan.components.some((item) => item.parameters?.medical_boom) && plan.components.filter((item) => item.parameters?.medical_actuator_mount).length === 2,
      bridge: (plan) => plan.components.some((item) => item.role === 'span deck') && plan.components.some((item) => item.role.includes('diagonal truss')),
      warehouse: (plan) => plan.components.filter((item) => item.parameters?.buffer_zone && item.primitive === 'conveyor').length === 4 && plan.components.filter((item) => item.parameters?.buffer_gate).length === 3,
      agriculture: (plan) => plan.components.filter((item) => item.parameters?.product_form === 'tomato').length === 6 && ['ripe', 'unripe', 'damaged'].every((grade) => plan.components.some((item) => item.parameters?.grade === grade)) && plan.components.filter((item) => item.parameters?.grading_roller).length === 6,
      recycling: (plan) => ['metal-can', 'plastic-bottle', 'reject-object'].every((form) => plan.components.some((item) => item.parameters?.product_form === form)) && plan.components.some((item) => item.parameters?.recycling_drum) && plan.components.some((item) => item.parameters?.recycling_magnet) && plan.components.filter((item) => item.parameters?.sorting_bin).length === 3 && !plan.components.some((item) => item.parameters?.sorting_diverter || item.parameters?.industrial_conveyor),
      'hvac-fixture': (plan) => plan.components.some((item) => item.parameters?.fixture_plate) && plan.components.some((item) => item.parameters?.heat_exchanger_core) && plan.components.filter((item) => item.parameters?.hvac_pipe).length >= 2,
      drawbridge: (plan) => plan.components.some((item) => item.role.startsWith('hinged span')) && plan.components.some((item) => item.primitive === 'pulley') && plan.components.some((item) => item.primitive === 'counterweight'),
    };
    for (const example of engineeringExamples) {
      const plan = compileDesignBrief(example.prompt);
      expect(checks[example.id]?.(plan), `${example.title} should compile to its own recognizable physical signature`).toBe(true);
    }
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

  it('keeps a compact high-ratio gearbox at a credible bench-scale mass and size', () => {
    const gearbox = compileDesignBrief('Build a compact 12:1 reduction gearbox with two supported shafts, meshing gears, a motor, and an output speed sensor.');
    const housing = gearbox.components.find((item) => item.role === 'open gearbox housing')!;
    const outputGear = gearbox.components.find((item) => item.role === 'output gear')!;
    expect(housing.dimensions[0]).toBeLessThan(.6);
    expect(outputGear.dimensions[0]).toBeLessThan(.5);
    expect(gearbox.components.reduce((total, item) => total + (item.mass ?? componentMass(item.primitive, item.dimensions, item.materialId)), 0)).toBeLessThan(25);
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
    expect(crane.components.some((item) => item.role === 'suspended payload')).toBe(true);
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
  });

  it('builds a recognizable electric go-kart instead of a rover or arbitrary payload cart', () => {
    const plan = compileDesignBrief('build an electric go kart');
    expect(plan.goal.machineName).toBe('Electric go-kart');
    expect(plan.goal.domain).toBe('Personal electric mobility');
    expect(plan.assemblies.map((item) => item.name)).toEqual(['engineered world', 'road vehicle assembly']);
    expect(plan.goal.summary).toContain('low-profile-road-vehicle');
    expect(plan.components.filter((item) => item.parameters?.road_vehicle_wheel)).toHaveLength(4);
    expect(plan.components.filter((item) => item.parameters?.road_vehicle_frame).length).toBeGreaterThanOrEqual(9);
    expect(plan.components.some((item) => item.role === 'single bucket seat')).toBe(true);
    expect(plan.components.some((item) => item.role === 'steering wheel')).toBe(true);
    expect(plan.components.some((item) => item.role === 'front steering rack')).toBe(true);
    expect(plan.components.some((item) => item.role === 'high-voltage traction battery')).toBe(true);
    expect(plan.components.some((item) => item.role === 'dual-motor inverter controller')).toBe(true);
    expect(plan.components.filter((item) => /electric traction motor/.test(item.role))).toHaveLength(2);
    expect(plan.components.filter((item) => /front brake disc/.test(item.role))).toHaveLength(2);
    expect(plan.components.filter((item) => /steering tie rod/.test(item.role))).toHaveLength(2);
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
    expect(plan.goal.constraints.map((item) => item.metric)).toEqual(expect.arrayContaining(['course_time', 'traction_margin', 'assembly_integrity', 'component_count']));

    const illuminated = compileDesignBrief('Build an electric go-cart with two LED headlights for night driving.');
    expect(illuminated.goal.machineName).toBe('Electric go-kart');
    expect(illuminated.components.filter((item) => item.primitive === 'light')).toHaveLength(2);
    expect(illuminated.connections.filter((item) => item.channel === 'lighting_bus')).toHaveLength(2);
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
    expect(centrifugal.goal.summary).toContain('parametric-rotor');
    expect(centrifugal.goal.summary).not.toContain('reciprocating-linkage');

    const housing = compileDesignBrief('Build a sealed pump housing.');
    expect(housing.goal.summary).toContain('parametric-housing');
    expect(housing.goal.summary).not.toContain('reciprocating-linkage');

    const duct = compileDesignBrief('Build an HVAC rectangular air duct.');
    expect(duct.goal.summary).toContain('parametric-manifold');

    const jack = compileDesignBrief('Build a car jack raising 1500 kg.');
    expect(jack.goal.summary).toContain('parallel-guides');
    expect(jack.components.some((item) => item.parameters?.road_vehicle_wheel)).toBe(false);

    expect(() => compileDesignBrief('Build a bench vise with a screw drive.')).toThrow(/could not identify a faithful/i);
    expect(() => compileDesignBrief('Build a bench vise with a screw drive and replaceable jaw plates.')).toThrow(/could not identify a faithful/i);
    expect(() => compileDesignBrief('Build an assorted tool tray.')).toThrow(/could not identify a faithful/i);
  });
});
