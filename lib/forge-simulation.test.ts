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

async function failOptimizePass(prompt: string) {
  let state = assemblePlan(compileDesignBrief(prompt));
  const failed = await simulateDesign(state);
  state = commitSimulation(state, failed, 'System').state;
  state = testCommand(state, 'optimize_design', { run_id: failed.id, objective: 'satisfy constraints' });
  const passed = await simulateDesign(state);
  return { state, failed, passed };
}

describe('ForgeTwin generic multi-body physics and optimizer', () => {
  it.each(cases)('runs an evidence-driven failure and redesign for %s', async (_name, prompt) => {
    const { failed, passed } = await failOptimizePass(prompt);
    expect(failed.physics.engine).toBe('Rapier');
    expect(failed.physics.timestepHz).toBe(60);
    expect(failed.physics.bodies).toBeGreaterThan(1);
    expect(failed.replay.length).toBeGreaterThan(100);
    expect(failed.status).toBe('failed');
    expect(failed.failures[0]?.componentIds.length).toBeGreaterThan(0);
    expect(failed.metrics.measures.find((item) => item.status === 'fail')?.provenance.length).toBeGreaterThan(20);
    expect(passed.status, JSON.stringify(passed.metrics.measures, null, 2)).toBe('passed');
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
    expect(run.physics.joints).toBe(1);
    expect(middle.rotation).not.toEqual(first.rotation);
    expect(run.metrics.measures.find((item) => item.metric === 'output_speed')?.value).toBeGreaterThanOrEqual(240);
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
    expect(run.status, JSON.stringify(run.metrics.measures, null, 2)).toBe('passed');
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
    expect(run.status, JSON.stringify(run.metrics.measures, null, 2)).toBe('passed');
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
    await expect(simulateDesign(jointless)).rejects.toThrow(/no motor or actuator/i);
  });

  it('never changes evidence from the optimization counter alone', async () => {
    const state = assemblePlan(compileDesignBrief('Build a 4:1 gearbox with 120 rpm input and at least 80 N·m output torque.'));
    const baseline = await simulateDesign(state);
    const counterOnly = await simulateDesign({ ...state, optimizationLevel: 99 });
    expect(counterOnly.metrics.measures).toEqual(baseline.metrics.measures);
    expect(counterOnly.status).toBe(baseline.status);
  });

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
      state = commitSimulation(state, run, 'System').state;
      state = testCommand(state, 'optimize_design', { run_id: run.id, objective: 'gallery verification' });
      run = await simulateDesign(state);
    }
    expect(run.status, JSON.stringify(run.metrics.measures, null, 2)).toBe('passed');
  }, 30_000);
});
