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
