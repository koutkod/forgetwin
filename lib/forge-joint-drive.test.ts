import { describe, expect, it } from 'vitest';
import { engineeringExamples } from './forge-data';
import { validateCompiledWorldPlan } from './forge-design-validator';
import { resolveDrivenJointEndpoint } from './forge-joint-drive';
import { compileDesignBrief } from './forge-prompt';
import { simulateDesign } from './forge-simulation';
import { assemblePlan } from './forge-test-utils';
import type { ComponentBlueprint, JointBlueprint, Quat } from './forge-types';

const component = (id: string, primitive: ComponentBlueprint['primitive'], bodyType: ComponentBlueprint['bodyType']): ComponentBlueprint => ({
  id, primitive, bodyType, assemblyId: 'assembly', role: id, position: [0, 0, 0], rotation: [0, 0, 0], dimensions: [1, 1, 1], materialId: 'steel', parameters: {},
});

const joint = (componentA: string, componentB: string): Pick<JointBlueprint, 'componentA' | 'componentB'> => ({ componentA, componentB });

const quaternionDistance = (left: Quat, right: Quat) => Math.min(
  Math.hypot(...left.map((value, index) => value - right[index])),
  Math.hypot(...left.map((value, index) => value + right[index])),
);

describe('endpoint-independent joint drives', () => {
  it('selects a propulsor regardless of whether it is component A or B', () => {
    const motor = component('motor', 'motor', 'fixed');
    const propeller = component('propeller', 'propeller', 'dynamic');
    expect(resolveDrivenJointEndpoint(joint(motor.id, propeller.id), [motor, propeller])).toMatchObject({ driven: { id: propeller.id }, drivenEndpoint: 'B' });
    expect(resolveDrivenJointEndpoint(joint(propeller.id, motor.id), [motor, propeller])).toMatchObject({ driven: { id: propeller.id }, drivenEndpoint: 'A' });
  });

  it('prefers the non-fixed endpoint, then preserves component B as the legacy fallback', () => {
    const support = component('support', 'support', 'fixed');
    const shaft = component('shaft', 'shaft', 'dynamic');
    const other = component('other', 'gear', 'dynamic');
    expect(resolveDrivenJointEndpoint(joint(shaft.id, support.id), [support, shaft])).toMatchObject({ driven: { id: shaft.id }, drivenEndpoint: 'A' });
    expect(resolveDrivenJointEndpoint(joint(shaft.id, other.id), [shaft, other])).toMatchObject({ driven: { id: other.id }, drivenEndpoint: 'B' });
    expect(resolveDrivenJointEndpoint(joint('missing', shaft.id), [shaft])).toBeNull();
  });

  it.each([
    ['airplane', /aircraft propeller/i],
    ['helicopter', /main lift rotor|tail rotor/i],
  ] as const)('keeps swapped-endpoint %s propulsors powered in validation and replay', async (exampleId, rolePattern) => {
    const example = engineeringExamples.find((item) => item.id === exampleId)!;
    const plan = compileDesignBrief(example.prompt);
    const state = assemblePlan(plan);
    const propulsors = plan.components.filter((item) => (item.primitive === 'propeller' || item.primitive === 'rotor') && rolePattern.test(item.role));
    expect(propulsors.length).toBeGreaterThan(0);

    for (const propulsor of propulsors) {
      const driveJoint = plan.joints.find((item) => item.type === 'revolute' && (item.componentA === propulsor.id || item.componentB === propulsor.id))!;
      [driveJoint.componentA, driveJoint.componentB] = [driveJoint.componentB, driveJoint.componentA];
      [driveJoint.anchorA, driveJoint.anchorB] = [driveJoint.anchorB, driveJoint.anchorA];
      const stateJoint = state.joints.find((item) => item.id === driveJoint.id)!;
      [stateJoint.componentA, stateJoint.componentB] = [stateJoint.componentB, stateJoint.componentA];
      [stateJoint.anchorA, stateJoint.anchorB] = [stateJoint.anchorB, stateJoint.anchorA];
      expect(resolveDrivenJointEndpoint(driveJoint, plan.components)?.driven.id).toBe(propulsor.id);
    }

    expect(validateCompiledWorldPlan(plan, example.prompt).filter((issue) => issue.code.startsWith('ANIMATION_PROPULSOR'))).toEqual([]);
    const run = await simulateDesign(state);
    for (const propulsor of propulsors) {
      const samples = run.replay.flatMap((frame) => frame.items.filter((item) => item.id === propulsor.id));
      expect(samples.length).toBeGreaterThan(2);
      expect(Math.max(...samples.slice(1).map((item) => quaternionDistance(samples[0].rotation, item.rotation)))).toBeGreaterThan(.05);
    }
  }, 30_000);

  it('validates the rendered propulsor axis rather than metadata alone', () => {
    const example = engineeringExamples.find((item) => item.id === 'airplane')!;
    const plan = compileDesignBrief(example.prompt);
    const propeller = plan.components.find((item) => item.primitive === 'propeller')!;
    propeller.rotation = [0, 0, 0];
    expect(validateCompiledWorldPlan(plan, example.prompt)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ANIMATION_PROPULSOR_AXIS', componentIds: expect.arrayContaining([propeller.id]) }),
    ]));
  });
});
