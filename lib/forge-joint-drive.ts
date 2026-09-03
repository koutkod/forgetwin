import type { ComponentBlueprint, JointBlueprint } from './forge-types';

export type JointDriveComponent = Pick<ComponentBlueprint, 'id' | 'primitive' | 'bodyType' | 'parameters'>;
export type JointDriveEndpoint = 'A' | 'B';

export type ResolvedJointDrive<T extends JointDriveComponent = JointDriveComponent> = {
  driven: T;
  support: T;
  drivenEndpoint: JointDriveEndpoint;
  supportEndpoint: JointDriveEndpoint;
};

const isPropulsor = (component: JointDriveComponent) => component.primitive === 'propeller' || component.primitive === 'rotor';

/**
 * Resolve the moving/output side of a joint without relying on authoring order.
 *
 * WebMCP and model-authored plans may express the same shaft as support -> rotor
 * or rotor -> support. Propulsors are explicit moving outputs, otherwise the
 * non-fixed body is preferred. A motor housing is treated as support when both
 * bodies are movable. Component B remains the deterministic legacy fallback for
 * joints whose two endpoints are otherwise indistinguishable.
 */
export function resolveDrivenJointEndpoint<T extends JointDriveComponent>(
  joint: Pick<JointBlueprint, 'componentA' | 'componentB'>,
  components: readonly T[],
): ResolvedJointDrive<T> | null {
  const componentA = components.find((component) => component.id === joint.componentA);
  const componentB = components.find((component) => component.id === joint.componentB);
  if (!componentA || !componentB) return null;

  const aPropulsor = isPropulsor(componentA);
  const bPropulsor = isPropulsor(componentB);
  if (aPropulsor !== bPropulsor) {
    return aPropulsor
      ? { driven: componentA, support: componentB, drivenEndpoint: 'A', supportEndpoint: 'B' }
      : { driven: componentB, support: componentA, drivenEndpoint: 'B', supportEndpoint: 'A' };
  }

  const aMovable = componentA.bodyType !== 'fixed';
  const bMovable = componentB.bodyType !== 'fixed';
  if (aMovable !== bMovable) {
    return aMovable
      ? { driven: componentA, support: componentB, drivenEndpoint: 'A', supportEndpoint: 'B' }
      : { driven: componentB, support: componentA, drivenEndpoint: 'B', supportEndpoint: 'A' };
  }

  const aMotor = componentA.primitive === 'motor';
  const bMotor = componentB.primitive === 'motor';
  if (aMotor !== bMotor) {
    return aMotor
      ? { driven: componentB, support: componentA, drivenEndpoint: 'B', supportEndpoint: 'A' }
      : { driven: componentA, support: componentB, drivenEndpoint: 'A', supportEndpoint: 'B' };
  }

  return { driven: componentB, support: componentA, drivenEndpoint: 'B', supportEndpoint: 'A' };
}
