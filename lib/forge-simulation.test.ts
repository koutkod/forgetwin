import { describe, expect, it } from 'vitest';
import { commitSimulation } from './forge-engine';
import { engineeringExamples } from './forge-data';
import { compileDesignBrief } from './forge-prompt';
import { simulateDesign } from './forge-simulation';
import { assemblePlan, testCommand } from './forge-test-utils';

const cases = [
  ['crane', 'Build a crane that lifts a 200 kg beam by 3 meters and places it within 10 cm without tipping.'],
  ['rover', 'Build a four-wheel rover that carries 50 kg across rough terrain in under 20 seconds without tipping.'],
  ['gearbox', 'Build a compact 4:1 gearbox that accepts 120 rpm and delivers at least 80 N·m of torque.'],
  ['lift', 'Build a synchronized lift that raises 100 kg by 1 meter while keeping the platform level.'],
  ['arm', 'Build a three-axis robotic arm with a gripper that reaches 2 meters and places a 12 kg part within 2 cm.'],
  ['bridge', 'Build a 6 meter bridge that supports a 2000 kg moving load with less than 8 mm deflection.'],
  ['sorter', 'Build a conveyor system that sorts red and blue boxes into separate bins at 20 boxes per minute.'],
] as const;

function accumulatedAngularTravel(run: Awaited<ReturnType<typeof simulateDesign>>, componentId: string) {
  const samples = run.replay.flatMap((frame) => frame.items.filter((item) => item.id === componentId).map((item) => item.rotation));
  return samples.slice(1).reduce((sum, rotation, index) => {
    const previous = samples[index];
    const dot = Math.abs(rotation[0] * previous[0] + rotation[1] * previous[1] + rotation[2] * previous[2] + rotation[3] * previous[3]);
    return sum + 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
  }, 0);
}

function maximumCenterDrift(run: Awaited<ReturnType<typeof simulateDesign>>, componentId: string, origin: readonly number[]) {
  return Math.max(...run.replay.flatMap((frame) => frame.items.filter((item) => item.id === componentId).map((item) => Math.hypot(
    item.position[0] - origin[0], item.position[1] - origin[1], item.position[2] - origin[2],
  ))));
}

async function failOptimizePass(prompt: string) {
  let state = assemblePlan(compileDesignBrief(prompt));
  const failed = await simulateDesign(state);
  expect(failed.diagnosis.recommendations.length, JSON.stringify({ measures: failed.metrics.measures, coverage: failed.requirementCoverage, collisions: failed.collisions.filter((item) => item.harmful) }, null, 2)).toBeGreaterThan(0);
  state = commitSimulation(state, failed, 'System').state;
  state = testCommand(state, 'optimize_design', { run_id: failed.id, objective: 'satisfy constraints' });
  const passed = await simulateDesign(state);
  return { state, failed, passed };
}

describe('ForgeTwin generic multi-body physics and optimizer', () => {
  it.each(cases)('runs an evidence-driven failure and redesign for %s', async (name, prompt) => {
    const { failed, passed } = await failOptimizePass(prompt);
    expect(failed.physics.engine).toBe('Rapier');
    expect(failed.physics.timestepHz).toBe(60);
    expect(failed.physics.bodies).toBeGreaterThan(1);
    expect(failed.replay.length).toBeGreaterThan(100);
    expect(failed.status).toBe('failed');
    expect(failed.failures[0]?.componentIds.length).toBeGreaterThan(0);
    expect(failed.metrics.measures.find((item) => item.status === 'fail')?.provenance.length).toBeGreaterThan(20);
    expect(passed.status, JSON.stringify({ measures: passed.metrics.measures, coverage: passed.requirementCoverage }, null, 2)).toBe(['sorter', 'rover', 'lift', 'arm'].includes(name) ? 'partial' : 'passed');
    expect(passed.objective).toBeLessThan(failed.objective);
    expect(passed.metrics.measures.every((item) => item.status === 'pass')).toBe(true);
  }, 30_000);

  it('derives gearbox speed and torque from the actual gear relation', async () => {
    const four = await failOptimizePass('Build a 4:1 gearbox with 120 rpm input and at least 80 N·m output torque.');
    const two = await failOptimizePass('Build a 2:1 gearbox with 120 rpm input and at least 40 N·m output torque.');
    expect(four.passed.metrics.measures.find((item) => item.metric === 'output_speed')?.value).toBeCloseTo(30, 0);
    expect(two.passed.metrics.measures.find((item) => item.metric === 'output_speed')?.value).toBeCloseTo(60, 0);
    expect(four.passed.metrics.measures.find((item) => item.metric === 'speed_ratio')?.value).toBe(4);
  }, 30_000);

  it('animates multiple red and blue boxes through the sorter replay', async () => {
    const state = assemblePlan(compileDesignBrief('Build a conveyor system that sorts red and blue boxes into separate bins at 20 boxes per minute.'));
    const run = await simulateDesign(state);
    const middle = run.replay[Math.floor(run.replay.length / 2)];
    const packages = middle.items.filter((item) => item.id.startsWith('sort-package-'));
    expect(packages).toHaveLength(6);
    expect(packages.filter((item) => item.id.includes('-red-'))).toHaveLength(3);
    expect(packages.filter((item) => item.id.includes('-blue-'))).toHaveLength(3);
    expect(new Set(packages.map((item) => item.color))).toEqual(new Set(['#ef4058', '#318dff']));
    const firstRed = run.replay[0].items.find((item) => item.id === 'sort-package-red-1')!;
    expect(packages.find((item) => item.id === firstRed.id)?.position).not.toEqual(firstRed.position);
  }, 30_000);

  it('animates a generated rotating CAD assembly at the requested speed', async () => {
    const state = assemblePlan(compileDesignBrief('Build an aluminum six-blade impeller and animate it at 240 rpm.'));
    const run = await simulateDesign(state);
    const hub = state.components.find((item) => item.parameters.cad_form === 'rotor_hub')!;
    const first = run.replay[0].items.find((item) => item.id === hub.id)!;
    const middle = run.replay[Math.floor(run.replay.length / 2)].items.find((item) => item.id === hub.id)!;
    expect(run.status, JSON.stringify(run.metrics.measures, null, 2)).toBe('passed');
    expect(run.physics.joints).toBeGreaterThanOrEqual(1);
    expect(middle.rotation).not.toEqual(first.rotation);
    expect(run.metrics.measures.find((item) => item.metric === 'output_speed')?.value).toBeGreaterThanOrEqual(240);
  }, 30_000);

  it('keeps aircraft propulsors on their mounted shafts while physics drives every rotor', async () => {
    const airplane = assemblePlan(compileDesignBrief('Build an electric fixed-wing aircraft with a propeller and landing gear.'));
    const airplanePropeller = airplane.components.find((item) => item.parameters.powered_propulsor)!;
    const airplaneRun = await simulateDesign(airplane);
    expect(airplane.joints.find((item) => item.componentB === airplanePropeller.id)?.axis).toEqual([1, 0, 0]);
    expect(accumulatedAngularTravel(airplaneRun, airplanePropeller.id)).toBeGreaterThan(20);
    expect(maximumCenterDrift(airplaneRun, airplanePropeller.id, airplanePropeller.position)).toBeLessThan(.04);
    expect(airplaneRun.collisions.filter((item) => item.harmful && (item.bodyA === airplanePropeller.id || item.bodyB === airplanePropeller.id))).toHaveLength(0);

    const helicopter = assemblePlan(compileDesignBrief('Build a utility helicopter with a main rotor and tail rotor.'));
    const mainRotor = helicopter.components.find((item) => item.parameters.main_rotor)!;
    const tailRotor = helicopter.components.find((item) => item.parameters.tail_rotor)!;
    const helicopterRun = await simulateDesign(helicopter);
    expect(helicopter.joints.find((item) => item.componentB === mainRotor.id)?.axis).toEqual([0, 1, 0]);
    expect(helicopter.joints.find((item) => item.componentB === tailRotor.id)?.axis).toEqual([0, 0, 1]);
    expect(accumulatedAngularTravel(helicopterRun, mainRotor.id)).toBeGreaterThan(20);
    expect(accumulatedAngularTravel(helicopterRun, tailRotor.id)).toBeGreaterThan(20);
    expect(maximumCenterDrift(helicopterRun, mainRotor.id, mainRotor.position)).toBeLessThan(.04);
    expect(maximumCenterDrift(helicopterRun, tailRotor.id, tailRotor.position)).toBeLessThan(.04);
    expect(helicopterRun.collisions.filter((item) => item.harmful && [mainRotor.id, tailRotor.id].some((id) => item.bodyA === id || item.bodyB === id))).toHaveLength(0);
  }, 30_000);

  it('measures centrifugal flow from the driven impeller and complete hydraulic path', async () => {
    const state = assemblePlan(compileDesignBrief('Build a centrifugal water pump that delivers 50 liters per minute with a visible impeller, inlet, and outlet.'));
    const run = await simulateDesign(state);
    const flow = run.metrics.measures.find((item) => item.metric === 'flow_rate')!;
    expect(flow.value).toBeGreaterThanOrEqual(50);
    expect(flow.provenance).toMatch(/centrifugal duty-point affinity law/i);
    const flowSensor = state.sensors.find((item) => item.channel === 'discharge_flow_lpm')!;
    const speedSensor = state.sensors.find((item) => item.channel === 'pump_shaft_speed')!;
    expect(Math.max(...run.replay.map((frame) => frame.sensorValues[flowSensor.id]))).toBeGreaterThanOrEqual(50);
    expect(Math.max(...run.replay.map((frame) => frame.sensorValues[speedSensor.id]))).toBeGreaterThan(20);

    const outlet = state.components.find((item) => item.parameters.pump_outlet)!;
    const withoutOutlet = testCommand(state, 'remove_component', { component_id: outlet.id });
    const brokenRun = await simulateDesign(withoutOutlet);
    expect(brokenRun.metrics.measures.find((item) => item.metric === 'flow_rate')?.value).toBe(0);
    expect(brokenRun.status).toBe('failed');
  }, 30_000);

  it('does not inflate pump flow from an unrelated higher-speed motor in a compound world', async () => {
    let state = assemblePlan(compileDesignBrief('Build a centrifugal water pump that delivers 50 liters per minute with a visible impeller, inlet, and outlet.'));
    const baseline = await simulateDesign(state);
    const pumpFlow = baseline.metrics.measures.find((item) => item.metric === 'flow_rate')!.value;
    const support = state.components.find((item) => item.bodyType === 'fixed')!;
    state = testCommand(state, 'create_component', {
      component_id: 'unrelated-test-motor', primitive: 'motor', assembly_id: support.assemblyId, role: 'unrelated test motor',
      position: [-2, .6, 1.5], rotation: [0, 0, 0], dimensions: [.4, .5, .4], material_id: 'steel', body_type: 'kinematic',
    });
    state = testCommand(state, 'connect_components', {
      connection_id: 'unrelated-test-output', source_id: 'unrelated-test-motor', target_id: support.id,
      connection_type: 'power', channel: 'unrelated_test_output',
    });
    state = testCommand(state, 'add_motor', {
      motor_id: 'unrelated-high-speed-drive', component_id: 'unrelated-test-motor', max_torque: 1, max_rpm: 12000, direction: 1,
    });
    const compound = await simulateDesign(state);
    expect(compound.metrics.measures.find((item) => item.metric === 'flow_rate')?.value).toBe(pumpFlow);
  }, 30_000);

  it('evaluates the hydraulic press and keeps its platen inside the work cell', async () => {
    const state = assemblePlan(compileDesignBrief('Build a hydraulic shop press that applies 50,000 N through a guided ram over a 300 mm stroke.'));
    const run = await simulateDesign(state);
    expect(run.metrics.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'pressing_force', value: 50000, status: 'pass' }),
      expect.objectContaining({ metric: 'stroke', value: .3, status: 'pass' }),
      expect.objectContaining({ metric: 'platen_parallelism', status: 'pass' }),
    ]));
    expect(run.failures.some((item) => item.type === 'physics-health')).toBe(false);
    const platen = state.components.find((item) => item.parameters.press_platen)!;
    const heights = run.replay.flatMap((frame) => frame.items.filter((item) => item.id === platen.id).map((item) => item.position[1]));
    expect(platen.position[1] - Math.min(...heights)).toBeGreaterThan(.25);
    expect(Math.min(...heights)).toBeGreaterThan(-1);
    expect(Math.max(...heights)).toBeLessThan(state.world.bounds[1] + 1);
  }, 30_000);

  it('measures a stable winch without driving its rope joint like a slider', async () => {
    const state = assemblePlan(compileDesignBrief('Build an electric winch that lifts 200 kg by 3 meters at 0.2 m/s.'));
    const run = await simulateDesign(state);
    expect(run.metrics.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'payload_capacity', status: 'pass' }),
      expect.objectContaining({ metric: 'line_speed', value: .2, status: 'pass' }),
      expect.objectContaining({ metric: 'cable_safety_factor', status: 'pass' }),
    ]));
    expect(run.metrics.measures.find((item) => item.metric === 'cable_safety_factor')?.value).toBeGreaterThanOrEqual(5);
    const payload = state.components.find((item) => item.parameters.winch_payload)!;
    const heights = run.replay.flatMap((frame) => frame.items.filter((item) => item.id === payload.id).map((item) => item.position[1]));
    expect(Math.max(...heights) - payload.position[1]).toBeGreaterThan(2.5);
    const hook = state.components.find((item) => item.parameters.winch_hook)!;
    const hookSamples = run.replay.flatMap((frame) => frame.items.filter((item) => item.id === hook.id).map((item) => ({ time: frame.time, y: item.position[1] })));
    const upwardSpeeds = hookSamples.slice(1).map((item, index) => (item.y - hookSamples[index].y) / Math.max(.001, item.time - hookSamples[index].time)).filter((speed) => speed > .01);
    expect(Math.max(...upwardSpeeds)).toBeLessThanOrEqual(.21);
    expect(Math.max(...upwardSpeeds)).toBeGreaterThanOrEqual(.18);
    expect(run.failures.some((item) => item.type === 'physics-health')).toBe(false);
    expect(Math.min(...heights)).toBeGreaterThan(-1);
    expect(Math.max(...heights)).toBeLessThan(state.world.bounds[1] + 1);
  }, 30_000);

  it('isolates press and winch measurements inside a compound world', async () => {
    const state = assemblePlan(compileDesignBrief('Build a hydraulic press that applies 50,000 N over a 300 mm stroke and an electric winch that lifts 200 kg at 0.2 m/s.'));
    const run = await simulateDesign(state);
    expect(run.metrics.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'pressing_force', value: 50000 }),
      expect.objectContaining({ metric: 'stroke', value: .3 }),
      expect.objectContaining({ metric: 'line_speed', value: .2 }),
    ]));
  }, 30_000);

  it('honors a slow winch line-speed request below two drum rpm', async () => {
    const state = assemblePlan(compileDesignBrief('Build an electric winch that lifts 100 kg by 2 meters at 0.05 m/s.'));
    const run = await simulateDesign(state);
    expect(run.metrics.measures.find((item) => item.metric === 'line_speed')).toMatchObject({ value: .05, status: 'pass' });
  }, 30_000);

  it('causally resizes a weak press ram and retunes platen parallelism', async () => {
    let state = assemblePlan(compileDesignBrief('Build a hydraulic shop press that applies 50,000 N through a guided ram over a 300 mm stroke.'));
    const ram = state.components.find((item) => item.parameters.hydraulic_ram)!;
    const actuator = state.actuators.find((item) => item.componentId === ram.id)!;
    const control = state.controls.find((item) => /press/i.test(item.name))!;
    actuator.maxForce = 10_000;
    control.kp = .01;
    state.goal!.constraints.find((item) => item.metric === 'platen_parallelism')!.target = .8;

    const failed = await simulateDesign(state);
    expect(failed.metrics.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'pressing_force', status: 'fail' }),
      expect.objectContaining({ metric: 'platen_parallelism', status: 'fail' }),
    ]));
    expect(failed.diagnosis.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: actuator.id, field: 'maxForce' }),
      expect.objectContaining({ targetId: control.id, field: 'kp' }),
    ]));

    state = commitSimulation(state, failed, 'System').state;
    state = testCommand(state, 'optimize_design', { run_id: failed.id, objective: 'restore press force and platen parallelism' });
    expect(state.actuators.find((item) => item.id === actuator.id)?.maxForce).toBeGreaterThanOrEqual(50_000);
    expect(state.controls.find((item) => item.id === control.id)?.kp).toBeGreaterThan(.01);
    const passed = await simulateDesign(state);
    expect(passed.metrics.measures.find((item) => item.metric === 'pressing_force')?.status).toBe('pass');
    expect(passed.metrics.measures.find((item) => item.metric === 'platen_parallelism')?.status).toBe('pass');
  }, 30_000);

  it.each([
    ['undersized', .1],
    ['oversized', .8],
  ])('redesigns an %s exact press stroke in the correct direction', async (_case, startingStroke) => {
    let state = assemblePlan(compileDesignBrief('Build a hydraulic shop press that applies 50,000 N through a guided ram over a 300 mm stroke.'));
    const ram = state.components.find((item) => item.parameters.hydraulic_ram)!;
    const actuator = state.actuators.find((item) => item.componentId === ram.id)!;
    const guide = state.joints.find((item) => item.id === actuator.jointId)!;
    state.goal!.constraints.find((item) => item.metric === 'stroke')!.operator = 'exact';
    actuator.travel = startingStroke;
    guide.limits = [0, startingStroke];

    const failed = await simulateDesign(state);
    expect(failed.metrics.measures.find((item) => item.metric === 'stroke')).toMatchObject({ value: startingStroke, status: 'fail' });
    state = commitSimulation(state, failed, 'System').state;
    state = testCommand(state, 'optimize_design', { run_id: failed.id, objective: 'match exact press stroke' });
    expect(state.actuators.find((item) => item.id === actuator.id)?.travel).toBe(.3);
    expect(state.joints.find((item) => item.id === guide.id)?.limits?.[1]).toBe(.3);
    const passed = await simulateDesign(state);
    expect(passed.metrics.measures.find((item) => item.metric === 'stroke')).toMatchObject({ value: .3, status: 'pass' });
  }, 30_000);

  it.each([
    ['too slow', .05],
    ['too fast', .5],
  ])('retunes a winch that is %s to the exact requested line speed', async (_case, startingSpeed) => {
    let state = assemblePlan(compileDesignBrief('Build an electric winch that lifts 200 kg by 3 meters at 0.2 m/s.'));
    const drum = state.components.find((item) => item.parameters.winch_drum)!;
    const motorBody = state.components.find((item) => item.parameters.electric_winch_motor)!;
    const motor = state.motors.find((item) => item.componentId === motorBody.id)!;
    const radius = Number(drum.parameters.drum_radius_m);
    motor.maxRpm = startingSpeed / (2 * Math.PI * radius) * 60;

    const failed = await simulateDesign(state);
    expect(failed.metrics.measures.find((item) => item.metric === 'line_speed')).toMatchObject({ value: startingSpeed, status: 'fail' });
    expect(failed.diagnosis.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: motor.id, field: 'maxRpm' }),
    ]));
    state = commitSimulation(state, failed, 'System').state;
    state = testCommand(state, 'optimize_design', { run_id: failed.id, objective: 'match exact cable line speed' });
    const passed = await simulateDesign(state);
    expect(passed.metrics.measures.find((item) => item.metric === 'line_speed')).toMatchObject({ value: .2, status: 'pass' });
  }, 30_000);

  it('selects a stronger winch cable from suspended load and safety factor', async () => {
    let state = assemblePlan(compileDesignBrief('Build an electric winch that lifts 200 kg by 3 meters at 0.2 m/s.'));
    const payload = state.components.find((item) => item.parameters.winch_payload)!;
    const cables = state.components.filter((item) => item.parameters.winch_cable);
    const weakRating = Number(payload.parameters.payload_kg) * 9.81 * 2;
    cables.forEach((item) => { item.parameters.rated_breaking_load_n = weakRating; });

    const failed = await simulateDesign(state);
    expect(failed.metrics.measures.find((item) => item.metric === 'cable_safety_factor')).toMatchObject({ value: 2, status: 'fail' });
    expect(failed.diagnosis.recommendations.filter((item) => item.field === 'rated_breaking_load_n')).toHaveLength(cables.length);
    state = commitSimulation(state, failed, 'System').state;
    state = testCommand(state, 'optimize_design', { run_id: failed.id, objective: 'restore cable design factor' });
    const passed = await simulateDesign(state);
    expect(passed.metrics.measures.find((item) => item.metric === 'cable_safety_factor')).toMatchObject({ status: 'pass' });
    expect(passed.metrics.measures.find((item) => item.metric === 'cable_safety_factor')?.value).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it('credits continuous angular travel only to the motor bound to that revolute joint', async () => {
    const connected = assemblePlan(compileDesignBrief('Build an aluminum six-blade impeller and animate it at 120 rpm.'));
    const shaftJoint = connected.joints.find((item) => item.type === 'revolute')!;
    expect(shaftJoint.limits).toBeUndefined();
    const connectedRun = await simulateDesign(connected);
    const connectedTravel = connectedRun.metrics.measures.find((item) => item.metric === 'angular_travel')!;
    expect(connectedTravel.value).toBeCloseTo(connected.motors[0].maxRpm * 6 * connected.world.duration, 0);

    const disconnected = { ...connected, motors: connected.motors.map((motor) => ({ ...motor, jointId: undefined })) };
    const disconnectedRun = await simulateDesign(disconnected);
    expect(disconnectedRun.metrics.measures.find((item) => item.metric === 'angular_travel')?.value).toBe(0);
  }, 30_000);

  it('keeps the solar e-bike together while animating its centered wheel drive', async () => {
    const prompt = 'build a solar powered electric bycicle';
    let state = assemblePlan(compileDesignBrief(prompt));
    let run = await simulateDesign(state);
    for (let pass = 0; pass < 2 && run.status === 'failed'; pass += 1) {
      expect(run.diagnosis.recommendations.length, JSON.stringify({ measures: run.metrics.measures, coverage: run.requirementCoverage, collisions: run.collisions.filter((item) => item.harmful) }, null, 2)).toBeGreaterThan(0);
      state = commitSimulation(state, run, 'System').state;
      state = testCommand(state, 'optimize_design', { run_id: run.id, objective: 'satisfy the measured electric bicycle constraints' });
      run = await simulateDesign(state);
    }
    const rearWheel = state.components.find((item) => item.role === 'rear bicycle wheel')!;
    const frontWheel = state.components.find((item) => item.role === 'front bicycle wheel')!;
    const first = run.replay[0].items.find((item) => item.id === rearWheel.id)!;
    const firstFront = run.replay[0].items.find((item) => item.id === frontWheel.id)!;
    const middle = run.replay[Math.floor(run.replay.length / 2)].items.find((item) => item.id === rearWheel.id)!;
    const middleFront = run.replay[Math.floor(run.replay.length / 2)].items.find((item) => item.id === frontWheel.id)!;
    expect(run.status, JSON.stringify(run.metrics.measures, null, 2)).not.toBe('failed');
    expect(run.physics.engine).toBe('Rapier');
    expect(run.physics.joints).toBeGreaterThanOrEqual(3);
    expect(middle.rotation).not.toEqual(first.rotation);
    expect(middleFront.rotation).not.toEqual(firstFront.rotation);
    expect(Math.abs(middle.position[0] - rearWheel.position[0])).toBeLessThan(.03);
    expect(Math.abs(middle.position[1] - rearWheel.position[1])).toBeLessThan(.03);
    expect(Math.abs(middle.position[2] - rearWheel.position[2])).toBeLessThan(.03);
    expect(Math.abs(middleFront.position[0] - frontWheel.position[0])).toBeLessThan(.03);
    expect(Math.abs(middleFront.position[1] - frontWheel.position[1])).toBeLessThan(.03);
    expect(Math.abs(middleFront.position[2] - frontWheel.position[2])).toBeLessThan(.03);
    expect(run.metrics.collisions).toBe(0);
  }, 30_000);

  it('keeps the electric go-kart assembled while all four road wheels rotate', async () => {
    const prompt = 'build an electric go kart';
    let state = assemblePlan(compileDesignBrief(prompt));
    // Emulate a go-kart persisted before forward road-wheel direction was
    // corrected. Simulation must safely normalize it without a reset.
    state = { ...state, motors: state.motors.map((motor) => ({ ...motor, direction: 1 })) };
    let run = await simulateDesign(state);
    for (let pass = 0; pass < 3 && run.status === 'failed'; pass += 1) {
      state = commitSimulation(state, run, 'System').state;
      state = testCommand(state, 'optimize_design', { run_id: run.id, objective: 'satisfy the measured electric go-kart constraints without replacing the requested vehicle' });
      run = await simulateDesign(state);
    }
    const wheels = state.components.filter((item) => item.parameters.road_vehicle_wheel);
    expect(wheels).toHaveLength(4);
    expect(run.status, JSON.stringify(run.metrics.measures, null, 2)).toBe('partial');
    expect(run.physics.engine).toBe('Rapier');
    expect(run.physics.joints).toBeGreaterThanOrEqual(4);
    for (const wheel of wheels) {
      const first = run.replay[0].items.find((item) => item.id === wheel.id)!;
      const middle = run.replay[Math.floor(run.replay.length / 2)].items.find((item) => item.id === wheel.id)!;
      expect(middle.rotation).not.toEqual(first.rotation);
      expect(Math.abs(middle.position[0] - wheel.position[0])).toBeLessThan(.03);
      expect(Math.abs(middle.position[1] - wheel.position[1])).toBeLessThan(.03);
      expect(Math.abs(middle.position[2] - wheel.position[2])).toBeLessThan(.03);
    }
    expect(run.metrics.collisions).toBe(0);
  }, 30_000);

  it('keeps every impeller blade rigidly attached to the centered rotor during replay', async () => {
    const state = assemblePlan(compileDesignBrief('Build an aluminum seven-blade axial impeller for a ventilation duct and animate it at 300 rpm.'));
    // Version 15 and earlier stored the shaft at the midpoint and added a hard
    // ±180° stop. The simulator must safely normalize those persisted worlds.
    const legacyShaft = state.joints.find((item) => item.type === 'revolute')!;
    const legacySupport = state.components.find((item) => item.id === legacyShaft.componentA)!;
    const legacyHub = state.components.find((item) => item.id === legacyShaft.componentB)!;
    const shared = legacySupport.position.map((value, index) => (value + legacyHub.position[index]) / 2) as [number, number, number];
    legacyShaft.anchorA = shared.map((value, index) => value - legacySupport.position[index]) as [number, number, number];
    legacyShaft.anchorB = shared.map((value, index) => value - legacyHub.position[index]) as [number, number, number];
    legacyShaft.limits = [-Math.PI, Math.PI];
    const run = await simulateDesign(state);
    const hub = state.components.find((item) => item.parameters.cad_form === 'rotor_hub')!;
    const blades = state.components.filter((item) => item.parameters.cad_form === 'aero_blade');
    const designRadii = new Map(blades.map((blade) => [blade.id, Math.hypot(blade.position[0] - hub.position[0], blade.position[1] - hub.position[1], blade.position[2] - hub.position[2])]));

    for (const frame of [run.replay[0], run.replay[Math.floor(run.replay.length / 2)], run.replay.at(-1)!]) {
      const replayHub = frame.items.find((item) => item.id === hub.id)!;
      expect(Math.abs(replayHub.position[0] - hub.position[0])).toBeLessThan(.02);
      expect(Math.abs(replayHub.position[1] - hub.position[1])).toBeLessThan(.02);
      expect(Math.abs(replayHub.position[2] - hub.position[2])).toBeLessThan(.02);
      for (const blade of blades) {
        const replayBlade = frame.items.find((item) => item.id === blade.id)!;
        const radius = Math.hypot(
          replayBlade.position[0] - replayHub.position[0],
          replayBlade.position[1] - replayHub.position[1],
          replayBlade.position[2] - replayHub.position[2],
        );
        expect(radius).toBeCloseTo(designRadii.get(blade.id)!, 2);
        expect(Math.abs(replayBlade.position[2] - replayHub.position[2])).toBeLessThan(.021);
      }
    }
  }, 30_000);

  it('simulates a bridge without an actuator and improves its structural evidence', async () => {
    const plan = compileDesignBrief('Build an 8 meter bridge that supports 3000 kg with less than 6 mm deflection.');
    expect(plan.actuators).toHaveLength(0);
    const { failed, passed } = await failOptimizePass(plan.brief);
    const before = failed.metrics.measures.find((item) => item.metric === 'deflection')!;
    const after = passed.metrics.measures.find((item) => item.metric === 'deflection')!;
    expect(after.value).toBeLessThan(before.value);
  }, 30_000);

  it('preserves a human transform while recalibrating the surrounding world', async () => {
    const result = await failOptimizePass('Build a crane that lifts 80 kg by 2 meters without tipping.');
    let state = result.state;
    const { passed } = result;
    state = commitSimulation(state, passed, 'System').state;
    const id = state.goal!.editableComponentId; const target = state.components.find((item) => item.id === id)!;
    const moved: [number, number, number] = [target.position[0] + .8, target.position[1], target.position[2]];
    state = testCommand(state, 'move_component', { component_id: id, position: moved }, 'Human');
    const stale = await simulateDesign(state);
    expect(stale.status).toBe('failed');
    state = commitSimulation(state, stale, 'System').state;
    state = testCommand(state, 'optimize_design', { run_id: stale.id, objective: 'retune around human geometry' });
    const retuned = await simulateDesign(state);
    expect(retuned.status).toBe('passed');
    expect(state.components.find((item) => item.id === id)?.position).toEqual(moved);
  }, 30_000);

  it('refuses incomplete worlds instead of forcing them into a template', async () => {
    const state = assemblePlan(compileDesignBrief('Build an automatic rotating hatch with an obstruction sensor.'));
    const jointless = { ...state, joints: [], motors: [], actuators: [] };
    await expect(simulateDesign(jointless)).rejects.toThrow(/no valid driven path/i);
  });

  it('rejects active worlds whose registered drives cannot move their referenced joint', async () => {
    const state = assemblePlan(compileDesignBrief('Build a 4:1 gearbox with 120 rpm input.'));
    const fixedJoint = state.joints.find((item) => item.type === 'fixed')!;
    const motorBody = state.components.find((item) => item.primitive === 'motor')!;
    const inert = {
      ...state,
      motors: [{ id: 'inert-motor', componentId: motorBody.id, jointId: fixedJoint.id, maxTorque: 100, maxRpm: 120, direction: 1 }],
      actuators: [],
    };
    await expect(simulateDesign(inert)).rejects.toThrow(/no valid driven path|movable drive joint/i);
  });

  it('rejects overconstrained joint graphs even when state bypasses the WebMCP command guard', async () => {
    const state = assemblePlan(compileDesignBrief('Build an electric winch that lifts 200 kg by 3 meters at 0.2 m/s.'));
    const existing = state.joints[0];
    const duplicatePair = { ...state, joints: [...state.joints, { ...existing, id: 'injected-duplicate-joint' }] };
    await expect(simulateDesign(duplicatePair)).rejects.toThrow(/duplicates a joint between the same body pair/i);

    const fixedPair = state.components.filter((item) => item.bodyType === 'fixed')
      .flatMap((left, index, fixed) => fixed.slice(index + 1).map((right) => [left, right] as const))
      .find(([left, right]) => !state.joints.some((joint) => new Set([joint.componentA, joint.componentB]).has(left.id) && new Set([joint.componentA, joint.componentB]).has(right.id)));
    expect(fixedPair).toBeDefined();
    const fixedMotion = {
      ...state,
      joints: [...state.joints, {
        id: 'injected-fixed-body-hinge', type: 'revolute' as const,
        componentA: fixedPair![0].id, componentB: fixedPair![1].id,
        anchorA: [0, 0, 0] as [number, number, number], anchorB: [0, 0, 0] as [number, number, number],
        axis: [0, 1, 0] as [number, number, number], limits: [-.5, .5] as [number, number],
      }],
    };
    await expect(simulateDesign(fixedMotion)).rejects.toThrow(/motion joint .* connects two fixed bodies/i);
  });

  it('never changes evidence from the optimization counter alone', async () => {
    const state = assemblePlan(compileDesignBrief('Build a 4:1 gearbox with 120 rpm input and at least 80 N·m output torque.'));
    const baseline = await simulateDesign(state);
    const counterOnly = await simulateDesign({ ...state, optimizationLevel: 99 });
    expect(counterOnly.metrics.measures).toEqual(baseline.metrics.measures);
    expect(counterOnly.status).toBe(baseline.status);
  });

  it('treats terminated cable and belt visuals as flexible interfaces, not disconnected rigid bodies', async () => {
    const state = assemblePlan(compileDesignBrief('Build a bicycle with front and rear disc brakes that carries a 90 kg rider and travels 20 meters.'));
    const frame = state.components.find((item) => ['beam', 'frame', 'tube'].includes(item.primitive))!;
    const rearWheel = state.components.find((item) => item.parameters.bicycle_wheel && /rear/.test(item.role))!;
    const flexibleId = 'test-flexible-chain-visual';
    state.components.push({
      ...frame,
      id: flexibleId,
      primitive: 'belt',
      role: 'terminated chain render proxy',
      bodyType: 'kinematic',
      position: [0, .7, .1],
      dimensions: [1.2, .03, .18],
      mass: .4,
      parameters: {},
    });
    state.connections.push(
      { id: 'test-chain-start', sourceId: frame.id, targetId: flexibleId, type: 'mechanical', channel: 'chain_start' },
      { id: 'test-chain-end', sourceId: flexibleId, targetId: rearWheel.id, type: 'mechanical', channel: 'chain_end' },
    );
    const run = await simulateDesign(state);
    expect(run.metrics.measures.find((item) => item.metric === 'assembly_integrity')).toMatchObject({ value: 100, status: 'pass' });
  }, 30_000);

  it('rejects unsupported measurements and stale failure evidence', async () => {
    const state = assemblePlan(compileDesignBrief('Build a crane that lifts 80 kg by 2 meters.'));
    const unknown = { ...state, goal: { ...state.goal!, constraints: [{ metric: 'magic_score', label: 'Magic', operator: 'min' as const, target: 1, unit: '', source: 'user' as const }] } };
    await expect(simulateDesign(unknown)).rejects.toThrow(/UNSUPPORTED_MEASUREMENT/);
    const run = await simulateDesign(state);
    let committed = commitSimulation(state, run, 'System').state;
    const target = committed.components[0];
    committed = testCommand(committed, 'set_mass', { component_id: target.id, mass: target.mass + 1 });
    expect(() => testCommand(committed, 'optimize_design', { run_id: run.id, objective: 'use stale evidence' })).toThrow(/STALE_RUN/);
  });

  it('recalibrates around a moved sensor without moving it back', async () => {
    let state = assemblePlan(compileDesignBrief('Build a crane that lifts 80 kg by 2 meters and places it within 10 cm without tipping.'));
    let run = await simulateDesign(state);
    state = commitSimulation(state, run, 'System').state;
    if (run.status === 'failed') {
      state = testCommand(state, 'optimize_design', { run_id: run.id, objective: 'baseline redesign' });
      run = await simulateDesign(state);
      state = commitSimulation(state, run, 'System').state;
    }
    const sensor = state.components.find((item) => item.id === state.goal!.editableComponentId)!;
    const moved: [number, number, number] = [sensor.position[0] + .8, sensor.position[1], sensor.position[2]];
    state = testCommand(state, 'move_component', { component_id: sensor.id, position: moved }, 'Human');
    const stale = await simulateDesign(state);
    expect(stale.status).toBe('failed');
    state = commitSimulation(state, stale, 'System').state;
    state = testCommand(state, 'optimize_design', { run_id: stale.id, objective: 'retune around human geometry' });
    expect(state.components.find((item) => item.id === sensor.id)?.position).toEqual(moved);
    expect(state.controls[0].calibrationX).toBe(moved[0]);
  });

  it.each(engineeringExamples.map((example) => [example.id, example.prompt] as const))('finishes the built-in %s prompt within two causal redesigns', async (_id, prompt) => {
    let state = assemblePlan(compileDesignBrief(prompt));
    let run = await simulateDesign(state);
    for (let pass = 0; pass < 2 && run.status === 'failed'; pass += 1) {
      expect(run.diagnosis.recommendations.length, JSON.stringify({ measures: run.metrics.measures, coverage: run.requirementCoverage, collisions: run.collisions.filter((item) => item.harmful) }, null, 2)).toBeGreaterThan(0);
      state = commitSimulation(state, run, 'System').state;
      state = testCommand(state, 'optimize_design', { run_id: run.id, objective: 'gallery verification' });
      run = await simulateDesign(state);
    }
    expect(run.status, JSON.stringify({ measures: run.metrics.measures, coverage: run.requirementCoverage }, null, 2)).not.toBe('failed');
  }, 30_000);
});
