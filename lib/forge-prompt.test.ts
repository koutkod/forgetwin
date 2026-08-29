import { describe, expect, it } from 'vitest';
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

  it('recognizes HVAC brazing language and composes a readable precision fixture', () => {
    const short = compileDesignBrief('Build a braze plate for a good HVAC unit.');
    const detailed = compileDesignBrief('Build a brazing fixture plate that positions a heat exchanger and two copper pipes within 2 mm before brazing.');
    for (const plan of [short, detailed]) {
      expect(plan.goal.machineName).toBe('Precision HVAC brazing fixture');
      expect(plan.goal.domain).toBe('HVAC manufacturing');
      expect(plan.components.some((item) => item.parameters?.fixture_plate)).toBe(true);
      expect(plan.components.some((item) => item.parameters?.heat_exchanger_core)).toBe(true);
      expect(plan.components.filter((item) => item.parameters?.hvac_pipe).length).toBeGreaterThanOrEqual(4);
      expect(plan.components.filter((item) => item.parameters?.fixture_clamp)).toHaveLength(2);
      expect(plan.components.filter((item) => item.parameters?.locating_pin)).toHaveLength(4);
      expect(plan.components.some((item) => item.role === 'constructed base')).toBe(false);
      expect(plan.components.some((item) => item.role.startsWith('serial link'))).toBe(false);
      expect(plan.goal.constraints.map((item) => item.metric)).toEqual(expect.arrayContaining(['alignment_error', 'clamp_force', 'assembly_integrity']));
    }
    expect(detailed.goal.constraints.find((item) => item.metric === 'alignment_error')?.target).toBe(2);
  });
});
