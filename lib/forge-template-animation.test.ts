import { describe, expect, it } from 'vitest';
import { engineeringExamples } from './forge-data';
import { productOperationPoseAtProgress } from './forge-motion';
import { compileDesignBrief } from './forge-prompt';
import { simulateDesign } from './forge-simulation';
import { assemblePlan } from './forge-test-utils';
import type { Quat, ReplayFrame, ReplayItem, Vec3 } from './forge-types';

const finiteVector = (values: readonly number[]) => values.every(Number.isFinite);

/** Each expression names a distinct visible output that a judge should see
 * move. Keeping this table next to the gallery tests prevents a template from
 * passing merely because an unsupported payload fell under gravity. */
const operationalReplayContracts: Record<string, RegExp[]> = {
  sorter: [/belt roller/i, /sorting diverter/i, /sort-package-red/i, /sort-package-blue/i],
  crane: [/boom head pulley/i, /load hook/i, /suspended beam payload/i],
  rover: [/all-terrain wheel/i, /suspension upright/i],
  'go-kart': [/rear .*drive wheel/i, /front .*steering wheel/i, /front steering rack/i],
  motorcycle: [/rear driven motorcycle wheel/i, /front steering motorcycle wheel/i],
  airplane: [/aircraft propeller/i, /left aileron/i, /right aileron/i, /elevator/i],
  helicopter: [/main lift rotor/i, /tail rotor/i],
  'service-robot': [/left armored upper arm/i, /left armored forearm/i, /right armored upper arm/i, /right armored forearm/i],
  arm: [/arm link 1/i, /arm link 2/i, /arm link 3/i],
  gearbox: [/input gear/i, /output gear/i],
  suspension: [/road wheel/i, /steering upright/i],
  solar: [/array pivot axle/i, /tracked panel/i, /dual light sensor/i],
  lift: [/lifting boom rear segment/i, /lifting boom curved nose/i, /spreader bar/i, /patient sling/i],
  // The static bridge uses the authored Kinematic Preview load-path animation;
  // its structural replay intentionally contains no driven bridge body.
  bridge: [],
  warehouse: [/zone .* geared drive/i, /zone .* pop-up stop/i],
  agriculture: [/singulating roller/i, /quality selector paddle/i],
  recycling: [/trommel drum/i, /air classifier blower/i],
  'hvac-fixture': [/hold-down clamp/i],
  drawbridge: [/hinged span/i, /balance sheave/i],
};

function quaternionDistance(left: Quat, right: Quat) {
  const direct = Math.hypot(...left.map((value, axis) => value - right[axis]));
  const negated = Math.hypot(...left.map((value, axis) => value + right[axis]));
  return Math.min(direct, negated);
}

function itemMotion(replay: ReplayFrame[], id: string) {
  const samples = replay
    .map((frame) => frame.items.find((item) => item.id === id))
    .filter((item): item is ReplayItem => Boolean(item));
  if (samples.length < 2) return 0;
  const first = samples[0];
  return Math.max(...samples.slice(1).map((sample) => Math.max(
    Math.hypot(...sample.position.map((value, axis) => value - first.position[axis]) as Vec3),
    quaternionDistance(sample.rotation, first.rotation),
  )));
}

function assertReplayItemCoherence(replay: ReplayFrame[], item: ReplayItem, worldBounds: Vec3) {
  const samples = replay.map((frame) => frame.items.find((candidate) => candidate.id === item.id));
  expect(samples.every(Boolean), `${item.label} disappears during replay`).toBe(true);
  const present = samples.filter((sample): sample is ReplayItem => Boolean(sample));
  for (const sample of present) {
    expect(finiteVector(sample.position), `${item.label} has a non-finite position`).toBe(true);
    expect(finiteVector(sample.rotation), `${item.label} has a non-finite rotation`).toBe(true);
    expect(finiteVector(sample.velocity), `${item.label} has a non-finite velocity`).toBe(true);
    const quaternionNorm = Math.hypot(...sample.rotation);
    expect(quaternionNorm, `${item.label} quaternion is not normalized`).toBeCloseTo(1, 2);
    expect(Math.abs(sample.position[0]), `${item.label} leaves the world in X`).toBeLessThanOrEqual(worldBounds[0] / 2 + 1);
    expect(sample.position[1], `${item.label} falls below the world`).toBeGreaterThanOrEqual(-1);
    expect(sample.position[1], `${item.label} leaves the world in Y`).toBeLessThanOrEqual(worldBounds[1] + 1);
    expect(Math.abs(sample.position[2]), `${item.label} leaves the world in Z`).toBeLessThanOrEqual(worldBounds[2] / 2 + 1);
  }
}

describe('gallery template animation contracts', () => {
  it.each(engineeringExamples.map((example) => [example.id, example.prompt] as const))(
    '%s produces a finite replay with an observable operational change',
    async (id, prompt) => {
      const state = assemblePlan(compileDesignBrief(prompt));
      const run = await simulateDesign(state);

      expect(run.replay.length).toBeGreaterThan(2);
      for (let frameIndex = 0; frameIndex < run.replay.length; frameIndex += 1) {
        const frame = run.replay[frameIndex];
        expect(Number.isFinite(frame.time)).toBe(true);
        if (frameIndex) expect(frame.time).toBeGreaterThan(run.replay[frameIndex - 1].time);
        for (const item of frame.items) {
          expect(finiteVector(item.position)).toBe(true);
          expect(finiteVector(item.rotation)).toBe(true);
          expect(finiteVector(item.velocity)).toBe(true);
        }
        expect(Object.values(frame.sensorValues).every(Number.isFinite)).toBe(true);
        expect(Object.values(frame.actuatorValues).every(Number.isFinite)).toBe(true);
      }

      for (const expectedOutput of operationalReplayContracts[id]) {
        const matching = run.replay[0].items.filter((item) => expectedOutput.test(item.id) || expectedOutput.test(item.label));
        expect(matching, `${state.goal?.machineName} is missing operational output ${expectedOutput}`).not.toHaveLength(0);
        for (const item of matching) assertReplayItemCoherence(run.replay, item, state.world.bounds);
        expect(matching.some((item) => itemMotion(run.replay, item.id) > .002), `${state.goal?.machineName} output ${expectedOutput} is visually static`).toBe(true);
      }
      if (id === 'bridge') {
        const previewLoad = state.components.find((item) => /moving design load/i.test(item.role));
        expect(previewLoad, 'The bridge Kinematic Preview needs a visible moving design load').toBeDefined();
        expect(previewLoad?.bodyType).toBe('dynamic');
      }
    },
    30_000,
  );

  it.each(engineeringExamples.filter((example) => ['sorter', 'warehouse', 'agriculture', 'recycling'].includes(example.id)).map((example) => [example.id, example.prompt] as const))(
    '%s gives every material-flow product a finite, bounded authored route',
    (id, prompt) => {
      const plan = compileDesignBrief(prompt);
      const state = assemblePlan(plan);
      const products = state.components.filter((item) => item.parameters?.product_form);
      expect(products, `${id} has no authored product bodies to animate`).not.toHaveLength(0);
      for (const component of products) {
        const samples = Array.from({ length: 101 }, (_, index) => productOperationPoseAtProgress(component, index / 100));
        expect(samples.every(Boolean), `${id}: ${component.role} has no operation route`).toBe(true);
        const poses = samples.filter((sample): sample is NonNullable<typeof sample> => Boolean(sample));
        expect(poses.some((pose) => Math.hypot(...pose.position.map((value, axis) => value - poses[0].position[axis]) as Vec3) > .05), `${id}: ${component.role} route is static`).toBe(true);
        for (const pose of poses) {
          expect(finiteVector(pose.position), `${id}: ${component.role} route position is non-finite`).toBe(true);
          expect(finiteVector(pose.rotation), `${id}: ${component.role} route rotation is non-finite`).toBe(true);
          expect(Math.abs(pose.position[0])).toBeLessThanOrEqual(plan.world.bounds[0] / 2 + 1);
          expect(pose.position[1]).toBeGreaterThanOrEqual(-1);
          expect(pose.position[1]).toBeLessThanOrEqual(plan.world.bounds[1] + 1);
          expect(Math.abs(pose.position[2])).toBeLessThanOrEqual(plan.world.bounds[2] / 2 + 1);
        }
      }
    },
  );
});
