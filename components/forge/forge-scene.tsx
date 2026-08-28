'use client';

import { ContactShadows, Edges, Grid, Line, OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { MathUtils, Plane, Vector3 } from 'three';
import { catalogFor, componentMass } from '../../lib/forge-data';
import { compileDesignBrief, DEFAULT_DESIGN_PROMPT } from '../../lib/forge-prompt';
import type { ForgeState, Joint, MachineComponent, ReplayFrame, Vec3 } from '../../lib/forge-types';

type Props = { state: ForgeState; preview?: boolean; onComponentMove: (componentId: string, x: number) => void; onSelect: (id: string) => void };

function previewWorld() {
  const plan = compileDesignBrief(DEFAULT_DESIGN_PROMPT);
  const components: MachineComponent[] = plan.components.map((blueprint) => {
    const item = catalogFor(blueprint.primitive);
    return { id: blueprint.id, primitive: blueprint.primitive, name: item.name, assemblyId: blueprint.assemblyId, role: blueprint.role, shape: item.shape, position: blueprint.position, rotation: blueprint.rotation, dimensions: blueprint.dimensions, materialId: blueprint.materialId, mass: blueprint.mass ?? componentMass(blueprint.primitive, blueprint.dimensions, blueprint.materialId), bodyType: blueprint.bodyType, color: blueprint.color ?? item.color, parameters: blueprint.parameters ?? {}, lastModifiedBy: 'System', humanLockedFields: [] };
  });
  return { components, joints: plan.joints };
}

function StandardMaterial({ color, xray, selected = false }: { color: string; xray: boolean; selected?: boolean }) {
  return <meshStandardMaterial color={selected ? '#65e5ff' : color} emissive={selected ? '#123b48' : '#000000'} emissiveIntensity={selected ? .65 : 0} metalness={.58} roughness={.38} wireframe={xray} transparent={xray} opacity={xray ? .72 : 1} />;
}

function BoxBody({ size, color, xray, selected }: { size: Vec3; color: string; xray: boolean; selected: boolean }) {
  return <mesh castShadow receiveShadow><boxGeometry args={size} /><StandardMaterial color={color} xray={xray} selected={selected} /><Edges color={selected ? '#8bf0ff' : xray ? '#64e4ff' : '#10161b'} opacity={selected ? .92 : xray ? .55 : .24} transparent /></mesh>;
}

function Gear({ component, xray, selected }: { component: MachineComponent; xray: boolean; selected: boolean }) {
  const teeth = Math.max(8, Math.min(30, Math.round(Number(component.parameters.teeth ?? 16) / 2)));
  const radius = component.dimensions[0] / 2;
  return <group rotation={[Math.PI / 2, 0, 0]}><mesh castShadow><cylinderGeometry args={[radius, radius, component.dimensions[1], Math.max(18, teeth * 2)]} /><StandardMaterial color={component.color} xray={xray} selected={selected} /></mesh>{Array.from({ length: teeth }, (_, index) => { const angle = index / teeth * Math.PI * 2; return <mesh key={index} position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]} rotation={[0, -angle, 0]}><boxGeometry args={[radius * .22, component.dimensions[1] * 1.08, radius * .2]} /><StandardMaterial color={component.color} xray={xray} selected={selected} /></mesh>; })}</group>;
}

function Spring({ component, xray, selected }: { component: MachineComponent; xray: boolean; selected: boolean }) {
  const turns = 18;
  const points = Array.from({ length: turns * 5 }, (_, index) => {
    const t = index / (turns * 5 - 1); const angle = t * Math.PI * 2 * turns;
    return [Math.cos(angle) * component.dimensions[0], (t - .5) * component.dimensions[1], Math.sin(angle) * component.dimensions[0]] as Vec3;
  });
  return <Line points={points} color={selected ? '#65e5ff' : component.color} lineWidth={xray ? 1 : 2} transparent opacity={xray ? .7 : 1} />;
}

function ComponentShape({ component, xray, selected, actuatorValue }: { component: MachineComponent; xray: boolean; selected: boolean; actuatorValue: number }) {
  const color = component.humanLockedFields.length ? '#f2b85a' : component.color;
  if (component.primitive === 'gear') return <Gear component={{ ...component, color }} xray={xray} selected={selected} />;
  if (component.primitive === 'spring') return <Spring component={{ ...component, color }} xray={xray} selected={selected} />;
  if (['wheel', 'shaft', 'pulley', 'roller', 'motor'].includes(component.primitive)) return <mesh castShadow rotation={component.primitive === 'wheel' || component.primitive === 'roller' ? [Math.PI / 2, 0, 0] : undefined}><cylinderGeometry args={[component.dimensions[0] / 2, component.dimensions[0] / 2, component.dimensions[1], 24]} /><StandardMaterial color={color} xray={xray} selected={selected} /><Edges color={selected ? '#8bf0ff' : '#152029'} opacity={.42} transparent /></mesh>;
  if (component.primitive === 'piston') return <group><mesh><cylinderGeometry args={[component.dimensions[0] / 2, component.dimensions[0] / 2, component.dimensions[1], 22]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh><mesh position={[0, component.dimensions[1] * .45 * actuatorValue, 0]}><cylinderGeometry args={[component.dimensions[0] * .25, component.dimensions[0] * .25, component.dimensions[1] * .75, 18]} /><meshStandardMaterial color="#dce6ea" metalness={.86} wireframe={xray} /></mesh></group>;
  if (component.primitive === 'cable') return <mesh><cylinderGeometry args={[Math.max(.015, component.dimensions[0]), Math.max(.015, component.dimensions[0]), component.dimensions[1], 10]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>;
  if (component.primitive === 'sensor' || component.primitive === 'camera') return <group><BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} /><mesh position={[0, 0, component.dimensions[2] * 2.2]}><coneGeometry args={[component.dimensions[0] * 1.4, component.dimensions[2] * 3.2, 16, 1, true]} /><meshBasicMaterial color="#57e5ff" transparent opacity={xray ? .19 : .06} depthWrite={false} /></mesh></group>;
  if (component.primitive === 'conveyor') return <group><BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} />{[-.36, -.18, 0, .18, .36].map((factor) => <mesh key={factor} position={[component.dimensions[0] * factor, component.dimensions[1] * .7, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.05, .05, component.dimensions[2] * .9, 14]} /><meshStandardMaterial color="#121a20" metalness={.7} /></mesh>)}</group>;
  if (component.primitive === 'gripper') return <group><BoxBody size={[component.dimensions[0], component.dimensions[1], component.dimensions[2] * .35]} color={color} xray={xray} selected={selected} />{[-1, 1].map((side) => <mesh key={side} position={[component.dimensions[0] * .38, -.2, side * component.dimensions[2] * (.48 - actuatorValue * .18)]}><boxGeometry args={[component.dimensions[0] * .55, component.dimensions[1] * 1.6, component.dimensions[2] * .16]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>)}</group>;
  if (component.primitive === 'hook') return <mesh><torusGeometry args={[component.dimensions[0], component.dimensions[0] * .28, 12, 26, Math.PI * 1.55]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>;
  return <BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} />;
}

function EditableBody({ component, xray, selected, actuatorValue, enabled, replay, onMove, onSelect }: { component: MachineComponent; xray: boolean; selected: boolean; actuatorValue: number; enabled: boolean; replay?: ReplayFrame['items'][number]; onMove: (componentId: string, x: number) => void; onSelect: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [draftX, setDraftX] = useState(component.position[0]);
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), -component.position[1]), [component.position]);
  const intersection = useMemo(() => new Vector3(), []);
  const x = dragging ? draftX : replay?.position[0] ?? component.position[0];
  const move = (event: ThreeEvent<PointerEvent>) => { if (!dragging || !enabled) return; event.stopPropagation(); if (event.ray.intersectPlane(plane, intersection)) setDraftX(MathUtils.clamp(Math.round(intersection.x * 20) / 20, -12, 12)); };
  const end = (event: ThreeEvent<PointerEvent>) => { if (!dragging) return; event.stopPropagation(); setDragging(false); onMove(component.id, draftX); };
  const speed = replay ? Math.hypot(...replay.velocity) : 0;
  const vectorScale = speed > 0 ? Math.min(.45, 1.5 / speed) : 0;
  return <group position={[x, replay?.position[1] ?? component.position[1], replay?.position[2] ?? component.position[2]]} rotation={replay ? undefined : component.rotation} quaternion={replay?.rotation} onClick={(event) => { event.stopPropagation(); onSelect(); }} onPointerDown={(event) => { if (!enabled) return; event.stopPropagation(); setDraftX(component.position[0]); setDragging(true); (event.target as unknown as { setPointerCapture(id: number): void }).setPointerCapture(event.pointerId); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    <ComponentShape component={component} xray={xray} selected={selected} actuatorValue={actuatorValue} />
    {enabled && xray && <Line points={[[-2.5, component.dimensions[1], 0], [2.5, component.dimensions[1], 0]]} color="#55e4ff" dashed dashScale={3} transparent opacity={.55} />}
    {xray && replay && speed > .01 && <Line points={[[0, component.dimensions[1], 0], [replay.velocity[0] * vectorScale, component.dimensions[1] + replay.velocity[1] * vectorScale, replay.velocity[2] * vectorScale]]} color="#ffffff" transparent opacity={.76} />}
  </group>;
}

function Machine({ state, preview, frame, onComponentMove, onSelect }: Props & { frame: ReplayFrame | null }) {
  const previewData = useMemo(() => previewWorld(), []);
  const components = state.components.length ? state.components : preview ? previewData.components : [];
  const joints: Joint[] = state.components.length ? state.joints : preview ? previewData.joints : [];
  const byId = new Map(components.map((component) => [component.id, component]));
  const center = components.length ? components.reduce((acc, item) => [acc[0] + item.position[0] / components.length, acc[1] + item.position[1] / components.length, acc[2] + item.position[2] / components.length] as Vec3, [0, 0, 0] as Vec3) : [0, .7, 0] as Vec3;
  return <>
    <ambientLight intensity={.62} />
    <directionalLight position={[6, 9, 5]} intensity={2.8} color="#d9f7ff" castShadow />
    <pointLight position={[-4, 4, -3]} intensity={24} color="#2bd9ff" distance={12} />
    <pointLight position={[4, 3, 4]} intensity={18} color="#ff9c45" distance={11} />
    {components.map((component) => {
      const replay = frame?.items.find((item) => item.id === component.id);
      const targetJoint = joints.find((item) => item.componentB === component.id);
      const actuator = state.actuators.find((item) => item.jointId === targetJoint?.id);
      const actuatorValue = actuator ? frame?.actuatorValues[actuator.id] ?? .55 : .55;
      const selected = state.selectedComponentId === component.id;
      const enabled = !preview && state.phase !== 'simulating' && (selected || component.id === state.goal?.editableComponentId);
      return <EditableBody key={component.id} component={component} xray={state.xray} selected={selected} actuatorValue={actuatorValue} enabled={enabled} replay={replay} onMove={onComponentMove} onSelect={() => onSelect(component.id)} />;
    })}
    {frame?.items.filter((item) => item.id === 'test-payload').map((item) => <group key={item.id} position={item.position} quaternion={item.rotation}><mesh castShadow><boxGeometry args={item.size} /><meshStandardMaterial color={item.state === 'failed' ? '#ff5668' : item.color} roughness={.45} wireframe={state.xray} /></mesh>{state.xray && <Line points={[[0, item.size[1], 0], [item.velocity[0] * .08, item.size[1] + item.velocity[1] * .08, item.velocity[2] * .08]]} color="#ffffff" transparent opacity={.72} />}</group>)}
    {frame?.collisionPoints.map((point, index) => <mesh key={`${point.join('-')}-${index}`} position={point}><sphereGeometry args={[.16, 16, 16]} /><meshBasicMaterial color="#ff4f62" transparent opacity={.92} /></mesh>)}
    {state.xray && joints.map((joint) => {
      const a = byId.get(joint.componentA), b = byId.get(joint.componentB); if (!a || !b) return null;
      const positionA = frame?.items.find((item) => item.id === a.id)?.position ?? a.position;
      const positionB = frame?.items.find((item) => item.id === b.id)?.position ?? b.position;
      const midpoint: Vec3 = [(positionA[0] + positionB[0]) / 2, (positionA[1] + positionB[1]) / 2, (positionA[2] + positionB[2]) / 2];
      const color = joint.type === 'gear' || joint.type === 'belt' ? '#ffad52' : joint.type === 'spring' ? '#a993ff' : '#66e5ff';
      return <group key={joint.id}><Line points={[positionA, positionB]} color={color} dashed dashScale={3} transparent opacity={.56} /><Line points={[midpoint, [midpoint[0] + joint.axis[0] * .7, midpoint[1] + joint.axis[1] * .7, midpoint[2] + joint.axis[2] * .7]]} color="#ffffff" transparent opacity={.72} /></group>;
    })}
    {state.xray && state.connections.map((connection) => { const a = byId.get(connection.sourceId), b = byId.get(connection.targetId); return a && b ? <Line key={connection.id} points={[a.position, b.position]} color={connection.type === 'signal' ? '#69f2ff' : connection.type === 'power' ? '#ffbf5b' : '#96a8b1'} dashed dashScale={4} transparent opacity={.38} /> : null; })}
    <mesh position={[0, -.16, 0]} receiveShadow><boxGeometry args={[state.world.bounds[0], .2, state.world.bounds[2]]} /><meshStandardMaterial color="#0a0e12" roughness={.82} /></mesh>
    <Grid position={[0, -.05, 0]} args={[state.world.bounds[0], state.world.bounds[2]]} cellColor="#21313a" sectionColor="#315363" fadeDistance={Math.max(state.world.bounds[0], state.world.bounds[2])} fadeStrength={1.45} />
    <ContactShadows position={[0, -.04, 0]} opacity={.58} scale={Math.max(state.world.bounds[0], state.world.bounds[2])} blur={2.4} far={7} />
    <OrbitControls makeDefault enablePan minDistance={4} maxDistance={24} minPolarAngle={.25} maxPolarAngle={1.5} target={center} />
  </>;
}

function useReplay(state: ForgeState) {
  const run = state.runs.find((item) => item.id === state.replayRunId) ?? null;
  const failureFrame = run?.failures[0]?.replayFrame ?? 0;
  const start = run && state.replayMode === 'failure' ? Math.max(0, failureFrame - 34) : 0;
  const end = run && state.replayMode === 'failure' ? Math.min(run.replay.length - 1, failureFrame + 34) : Math.max(0, (run?.replay.length ?? 1) - 1);
  const [cursor, setCursor] = useState({ runId: '', index: 0 });
  const [reducedMotion, setReducedMotion] = useState(false);
  const index = run && cursor.runId === run.id ? Math.max(start, Math.min(end, cursor.index)) : start;
  useEffect(() => { const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReducedMotion(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => {
    if (!run || reducedMotion) return;
    const timer = window.setInterval(() => setCursor((current) => { const currentIndex = current.runId === run.id ? current.index : start; return { runId: run.id, index: currentIndex >= end ? start : Math.min(end, currentIndex + (state.replayMode === 'failure' ? 1 : 3)) }; }), state.replayMode === 'failure' ? 200 : 60);
    return () => window.clearInterval(timer);
  }, [run, start, end, state.replayMode, reducedMotion]);
  return { run, frame: run?.replay[index] ?? null };
}

export function ForgeScene(props: Props) {
  const { run, frame } = useReplay(props.state);
  const label = props.state.goal ? `3D physical world for ${props.state.goal.machineName}. The adjacent world hierarchy and component inspector provide an accessible editing alternative.` : '3D general-purpose mechanical engineering world.';
  return <div className="canvas-wrap"><Canvas aria-label={props.preview ? undefined : label} aria-hidden={props.preview || undefined} role={props.preview ? undefined : 'img'} tabIndex={-1} shadows="basic" dpr={[1, 1.5]} camera={{ position: [8.4, 6.4, 10.6], fov: 42 }} gl={{ antialias: true }} onPointerMissed={() => props.onSelect('')}><color attach="background" args={['#080c10']} /><fog attach="fog" args={['#080c10', 12, 28]} /><Suspense fallback={null}><Machine {...props} frame={frame} /></Suspense></Canvas>{!props.preview && <div className="sr-only">{run ? `${run.status} multi-body simulation replay is active.` : `${props.state.components.length} physical bodies and ${props.state.joints.length} joints are visible.`}</div>}</div>;
}
