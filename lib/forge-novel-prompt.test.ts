import { describe, expect, it } from 'vitest';
import { compileDesignBrief } from './forge-prompt';
import { simulateDesign } from './forge-simulation';
import { assemblePlan } from './forge-test-utils';

const novelCases = [
  {
    name: 'bench vise',
    prompt: 'Build a bench vise with a screw drive and replaceable jaw plates.',
    module: 'bench-vise',
    machine: 'Screw-driven bench vise',
    requiredRoles: ['cast fixed vise jaw', 'cast moving vise jaw', 'Acme-thread lead screw', 'sliding vise handwheel'],
  },
  {
    name: 'bottle jack',
    prompt: 'Build a 2-ton hydraulic bottle jack that raises its saddle by 300 mm.',
    module: 'bottle-jack',
    machine: 'Hydraulic bottle jack',
    requiredRoles: ['main hydraulic cylinder', 'guided lifting ram', 'serrated lifting saddle', 'removable pump handle'],
  },
  {
    name: 'wind turbine yaw drive',
    prompt: 'Design a wind turbine yaw drive that turns the nacelle toward changing wind direction.',
    module: 'wind-yaw-drive',
    machine: 'Wind-turbine yaw drive',
    requiredRoles: ['slewing yaw bearing ring', 'wind-turbine nacelle housing', 'geared electric yaw drive', 'nacelle wind-direction vane'],
  },
  {
    name: 'drill press',
    prompt: 'Build a bench drill press with 160 mm stroke and a 900 rpm spindle.',
    module: 'drill-press',
    machine: 'Bench drill press',
    requiredRoles: ['rigid drill-press column', 'slotted drill work table', 'precision drill spindle', 'twist drill bit'],
  },
  {
    name: 'rack steering',
    prompt: 'Build a rack-and-pinion steering assembly with two tie rods and electric assist.',
    module: 'rack-steering',
    machine: 'Rack-and-pinion steering assembly',
    requiredRoles: ['toothed steering rack', 'steering pinion gear', 'left steering tie rod', 'right steering tie rod'],
  },
  {
    name: 'bicycle brake',
    prompt: 'Build a bicycle disc brake with opposed pistons and a cable hand lever.',
    module: 'bicycle-brake',
    machine: 'Bicycle disc brake',
    requiredRoles: ['ventilated bicycle brake rotor', 'rigid bicycle brake caliper', 'inboard bicycle brake pad', 'outboard bicycle brake pad'],
  },
  {
    name: 'grain roller mill',
    prompt: 'Build a pedal-powered grain mill with a large flywheel and two grinding rollers.',
    module: 'grain-roller-mill',
    machine: 'Pedal-powered grain roller mill',
    requiredRoles: ['grain feed hopper', 'left fluted grinding roller', 'right fluted grinding roller', 'large pedal drive flywheel', 'non-slip pedal tread'],
  },
] as const;

describe('ForgeTwin novel mechanical prompt stress coverage', () => {
  it.each(novelCases)('routes $name to one recognizable primitive assembly', ({ prompt, module, machine, requiredRoles }) => {
    const plan = compileDesignBrief(prompt);
    const roles = new Set(plan.components.map((component) => component.role));
    expect(plan.goal.machineName).toBe(machine);
    expect(plan.goal.summary).toContain(module);
    expect(plan.goal.summary).not.toContain('constructed-motion');
    expect(plan.goal.summary).not.toContain('parallel-guides');
    expect(plan.goal.summary).not.toContain('tracking-axis');
    expect(plan.goal.summary).not.toContain('parametric-rotor');
    requiredRoles.forEach((role) => expect(roles.has(role), `missing ${role}`).toBe(true));
    expect(plan.components.length).toBeGreaterThanOrEqual(8);
    expect(plan.joints.length).toBeGreaterThanOrEqual(4);
    expect(plan.controls.some((control) => control.sensorIds.length > 0 && control.actuatorIds.length > 0)).toBe(true);
  });

  it('retains dedicated four-bar and piston-pump topology', () => {
    const linkage = compileDesignBrief('Build a four-bar linkage with 75 degree rocker travel.');
    const pump = compileDesignBrief('Build a piston pump with a flywheel that delivers 25 liters per minute.');
    expect(linkage.goal.summary).toContain('closed-linkage');
    expect(linkage.components.filter((component) => /ground link|input crank|coupler link|output rocker/.test(component.role))).toHaveLength(4);
    expect(pump.goal.summary).toContain('reciprocating-linkage');
    expect(pump.components.some((component) => component.role === 'reciprocating plunger')).toBe(true);
    expect(pump.components.filter((component) => /valve plate/.test(component.role))).toHaveLength(2);
  });

  it('parses bottle-jack tonnage and millimeter lift as engineering constraints', () => {
    const plan = compileDesignBrief('Build a 2-ton bottle jack that raises the saddle by 300 mm.');
    expect(plan.goal.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'payload_capacity', target: 2000, source: 'user' }),
      expect.objectContaining({ metric: 'lift_height', target: .3, source: 'user' }),
    ]));
    expect(plan.joints.find((joint) => joint.componentB === plan.components.find((component) => component.parameters?.bottle_jack_ram)?.id)?.limits).toEqual([0, .3]);
  });

  it.each(novelCases)('runs $name in Rapier without exploding or leaving non-finite poses', async ({ prompt }) => {
    const run = await simulateDesign(assemblePlan(compileDesignBrief(prompt)));
    expect(run.physics.engine).toBe('Rapier');
    expect(run.status, JSON.stringify({ measures: run.metrics.measures, coverage: run.requirementCoverage, collisions: run.collisions.filter((item) => item.harmful) }, null, 2)).not.toBe('failed');
    expect(run.physics.bodies).toBeGreaterThanOrEqual(8);
    expect(run.replay.length).toBeGreaterThan(100);
    expect(run.failures.some((failure) => failure.type === 'physics-health')).toBe(false);
    for (const frame of [run.replay[0], run.replay[Math.floor(run.replay.length / 2)], run.replay.at(-1)!]) {
      expect(frame.items.flatMap((item) => [...item.position, ...item.rotation, ...item.velocity]).every(Number.isFinite)).toBe(true);
    }
  }, 30_000);

  it('keeps control loops actionable and small accessories at realistic mass', () => {
    const pump = compileDesignBrief('Build a centrifugal pump for 80 liters per minute at 2900 rpm.');
    const differential = compileDesignBrief('Build a compact 6:1 planetary differential.');
    const press = compileDesignBrief('Build a hydraulic press that applies 50 kN over a 300 mm stroke.');
    const winch = compileDesignBrief('Build an electric winch that lifts 200 kg by 3 meters at 0.2 m/s.');
    const pumpControl = pump.controls.find((control) => control.name === 'centrifugal pump duty point')!;
    const differentialControl = differential.controls.find((control) => control.name === 'differential speed split')!;
    expect(pumpControl.actuatorIds).toHaveLength(1);
    expect(pump.actuators.find((actuator) => actuator.id === pumpControl.actuatorIds[0])).toMatchObject({ type: 'rotary-motor' });
    expect(differentialControl.actuatorIds).toHaveLength(1);
    expect(differential.actuators.find((actuator) => actuator.id === differentialControl.actuatorIds[0])).toMatchObject({ type: 'rotary-motor' });
    expect(press.components.find((component) => component.parameters?.hydraulic_power_unit)?.mass).toBe(45);
    expect(press.components.find((component) => component.parameters?.guarded_press_control)?.mass).toBeLessThan(10);
    expect(winch.components.find((component) => component.parameters?.winch_controller)?.mass).toBeLessThan(10);
    expect(winch.world.duration).toBeCloseTo(15, 6);
    expect(compileDesignBrief('Build an electric winch that lifts 100 kg by 2 meters at 0.05 m/s.').world.duration).toBe(30);
  });

  it('authors press tooling that reaches the workpiece within the commanded stroke', () => {
    const plan = compileDesignBrief('Build a hydraulic press that applies 50 kN over a 300 mm stroke.');
    const die = plan.components.find((component) => component.parameters?.press_tooling === 'upper')!;
    const workpiece = plan.components.find((component) => component.parameters?.press_workpiece)!;
    const stroke = plan.actuators.find((actuator) => plan.components.find((component) => component.id === actuator.componentId)?.parameters?.hydraulic_ram)?.travel ?? 0;
    const initialClearance = die.position[1] - die.dimensions[1] / 2 - (workpiece.position[1] + workpiece.dimensions[1] / 2);
    expect(initialClearance).toBeGreaterThanOrEqual(.01);
    expect(initialClearance).toBeLessThanOrEqual(.04);
    expect(initialClearance).toBeLessThan(stroke);
    expect(die.position[1] - stroke - die.dimensions[1] / 2).toBeLessThan(workpiece.position[1] + workpiece.dimensions[1] / 2);
  });

  it('scales the winch tower so hook and payload stay below the fairlead for the full lift', () => {
    const plan = compileDesignBrief('Build an electric winch that lifts 200 kg by 3 meters at 0.2 m/s.');
    const fairlead = plan.components.find((component) => component.parameters?.winch_fairlead)!;
    const hook = plan.components.find((component) => component.parameters?.winch_hook)!;
    const payload = plan.components.find((component) => component.parameters?.winch_payload)!;
    const mast = plan.components.find((component) => component.parameters?.winch_mast)!;
    const lift = plan.actuators.find((actuator) => actuator.type === 'winch')!.travel;
    const fairleadBottom = fairlead.position[1] - fairlead.dimensions[1] / 2;
    expect(hook.position[1] + lift + hook.dimensions[1] / 2).toBeLessThan(fairleadBottom);
    expect(payload.position[1] + lift + payload.dimensions[1] / 2).toBeLessThan(fairleadBottom);
    expect(mast.position[1] + mast.dimensions[1] / 2).toBeGreaterThanOrEqual(fairlead.position[1]);
    expect(plan.world.duration).toBeGreaterThanOrEqual(lift / .2);
  });

  it('uses suspension uprights to avoid duplicate rover joints on one body pair', () => {
    const plan = compileDesignBrief('Build a four-wheel rover that carries 20 kg across rough uneven terrain.');
    const unorderedPairs = plan.joints.map((joint) => [joint.componentA, joint.componentB].sort().join('::'));
    expect(new Set(unorderedPairs).size).toBe(unorderedPairs.length);
    expect(plan.components.filter((component) => component.parameters?.rover_upright)).toHaveLength(4);
    expect(plan.joints.filter((joint) => joint.type === 'spring')).toHaveLength(4);
    expect(plan.joints.filter((joint) => joint.type === 'revolute' && plan.components.some((component) => component.id === joint.componentB && component.parameters?.rover_wheel))).toHaveLength(4);
  });

  it('honors described primitive counts and integrates fallback parts beside the machine', () => {
    const plan = compileDesignBrief('Build an automatic rotating calibration rig with two grinding rollers and one flywheel.');
    const rollers = plan.components.filter((component) => component.primitive === 'roller');
    const wheels = plan.components.filter((component) => component.primitive === 'wheel');
    const base = plan.components.find((component) => component.role === 'constructed base')!;
    expect(rollers).toHaveLength(2);
    expect(wheels).toHaveLength(1);
    for (const body of [...rollers, ...wheels]) {
      expect(Math.hypot(body.position[0] - base.position[0], body.position[2] - base.position[2])).toBeLessThan(4);
      expect(plan.connections.some((connection) => connection.sourceId === body.id || connection.targetId === body.id)
        || plan.joints.some((joint) => joint.componentA === body.id || joint.componentB === body.id)).toBe(true);
    }
  });
});
