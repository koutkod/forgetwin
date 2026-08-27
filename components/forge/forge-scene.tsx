'use client';

import { ContactShadows, Grid, Line, OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { MathUtils, Plane, Vector3 } from 'three';
import type { ForgeState, ReplayBox, ReplayFrame } from '../../lib/forge-types';

type Props = {
  state: ForgeState;
  preview?: boolean;
  onSensorMove: (x: number) => void;
  onSelect: (id: string) => void;
};

function Belt({ xray }: { xray: boolean }) {
  return (
    <group position={[-0.45, 0, 0]}>
      <mesh position={[0, 0.36, 0]} castShadow receiveShadow onClick={(event) => event.stopPropagation()}>
        <boxGeometry args={[8.2, 0.28, 1.55]} />
        <meshStandardMaterial color="#172129" metalness={0.72} roughness={0.34} wireframe={xray} />
      </mesh>
      <mesh position={[0, 0.52, 0]} receiveShadow>
        <boxGeometry args={[8, 0.055, 1.34]} />
        <meshStandardMaterial color="#28323a" metalness={0.4} roughness={0.72} />
      </mesh>
      {[-3.8, 3.8].map((x) => <mesh key={x} position={[x, 0.04, 0]}><boxGeometry args={[0.16, 0.7, 1.35]} /><meshStandardMaterial color="#52606b" metalness={0.85} roughness={0.28} /></mesh>)}
      {[-3.6, -2.4, -1.2, 0, 1.2, 2.4, 3.6].map((x) => <mesh key={x} rotation={[Math.PI / 2, 0, 0]} position={[x, 0.55, 0]}><cylinderGeometry args={[0.075, 0.075, 1.28, 20]} /><meshStandardMaterial color="#0b1014" metalness={0.3} roughness={0.8} /></mesh>)}
      {xray && <mesh position={[0, 0.48, 0]}><boxGeometry args={[8.25, 0.32, 1.58]} /><meshBasicMaterial color="#4bddff" wireframe transparent opacity={0.24} /></mesh>}
    </group>
  );
}

function Package({ box, xray }: { box: ReplayBox; xray: boolean }) {
  const color = box.color === 'red' ? '#ed4450' : '#2f7ff0';
  const stripe = box.color === 'red' ? '#ffc5ca' : '#c9e1ff';
  return <group position={box.position} quaternion={box.rotation}>
    <mesh castShadow><boxGeometry args={[0.48, 0.48, 0.48]} /><meshStandardMaterial color={color} roughness={0.42} metalness={0.08} /></mesh>
    <mesh position={[0, 0.246, 0]}><boxGeometry args={[0.18, 0.008, 0.49]} /><meshBasicMaterial color={stripe} /></mesh>
    {xray && <><mesh><boxGeometry args={[0.5, 0.5, 0.5]} /><meshBasicMaterial color={color} wireframe transparent opacity={0.7} /></mesh><Line points={[[0, .32, 0], [box.velocity[0] * .28, .32, box.velocity[2] * .28]]} color="#ffffff" lineWidth={1.2} transparent opacity={0.65} /></>}
  </group>;
}

function Sensor({ x, xray, disabled, humanLocked, onMove, onSelect }: { x: number; xray: boolean; disabled: boolean; humanLocked: boolean; onMove: (x: number) => void; onSelect: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [draftX, setDraftX] = useState(x);
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), -1.05), []);
  const intersection = useMemo(() => new Vector3(), []);
  const displayedX = dragging ? draftX : x;
  const move = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging || disabled) return;
    event.stopPropagation();
    if (event.ray.intersectPlane(plane, intersection)) setDraftX(MathUtils.clamp(Math.round(intersection.x * 20) / 20, -3.1, 0.2));
  };
  const end = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    event.stopPropagation();
    setDragging(false);
    onMove(draftX);
  };
  return <group position={[displayedX, 0, 0]} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    <mesh position={[0, 0.98, -0.91]} castShadow><boxGeometry args={[0.17, 1.04, 0.17]} /><meshStandardMaterial color={humanLocked ? '#f4bd62' : '#8997a2'} metalness={0.82} /></mesh>
    <mesh position={[0, 0.98, 0.91]} castShadow><boxGeometry args={[0.17, 1.04, 0.17]} /><meshStandardMaterial color={humanLocked ? '#f4bd62' : '#8997a2'} metalness={0.82} /></mesh>
    <mesh
      position={[0, 1.46, 0]}
      castShadow
      onPointerDown={(event) => { if (disabled) return; event.stopPropagation(); setDragging(true); setDraftX(x); (event.target as unknown as { setPointerCapture(id: number): void }).setPointerCapture(event.pointerId); }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <boxGeometry args={[0.3, 0.19, 2.02]} />
      <meshStandardMaterial color={humanLocked ? '#f1b853' : '#41dfff'} emissive={humanLocked ? '#714513' : '#14758a'} emissiveIntensity={0.62} metalness={0.68} />
    </mesh>
    <mesh position={[0, 0.93, 0]}><boxGeometry args={[0.018, 1.18, 1.6]} /><meshBasicMaterial color={humanLocked ? '#ffbd58' : '#45eaff'} transparent opacity={xray ? 0.3 : 0.12} /></mesh>
    {xray && <Line points={[[-3.1 - displayedX, 0.58, -1.14], [0.2 - displayedX, 0.58, -1.14]]} color="#4fe4ff" dashed dashScale={2.5} transparent opacity={0.48} />}
  </group>;
}

function Diverter({ angle, xray, onSelect }: { angle: number; xray: boolean; onSelect: () => void }) {
  return <group position={[1.2, 0.8, 0]} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    <group rotation={[0, angle, 0]}>
      <mesh castShadow><boxGeometry args={[1.35, 0.18, 0.16]} /><meshStandardMaterial color="#ffb14d" emissive="#6c3b0b" emissiveIntensity={0.46} metalness={0.7} /></mesh>
      {xray && <mesh><boxGeometry args={[1.4, 0.22, 0.2]} /><meshBasicMaterial color="#ffb14d" wireframe transparent opacity={0.7} /></mesh>}
    </group>
    <mesh position={[0, -0.18, 0]}><cylinderGeometry args={[0.22, 0.27, 0.3, 28]} /><meshStandardMaterial color="#5f6c76" metalness={0.9} roughness={0.2} /></mesh>
    {xray && <><mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.92, 0.017, 8, 72, 1.9]} /><meshBasicMaterial color="#ffb44b" transparent opacity={0.75} /></mesh><Line points={[[0, 0, 0], [0, 1.1, 0]]} color="#ffb44b" lineWidth={1.4} /></>}
  </group>;
}

function Ramp({ color, z, rotationY }: { color: string; z: number; rotationY: number }) {
  return <group position={[2.9, 0.42, z]} rotation={[0, rotationY, 0]}>
    <mesh castShadow receiveShadow><boxGeometry args={[2.1, 0.13, 0.85]} /><meshStandardMaterial color={color} metalness={0.4} roughness={0.48} /></mesh>
    <mesh position={[0, 0.2, Math.sign(z) * 0.4]}><boxGeometry args={[2.08, 0.42, 0.07]} /><meshStandardMaterial color="#52616b" metalness={0.72} /></mesh>
  </group>;
}

function Bin({ color, z, label }: { color: string; z: number; label: string }) {
  return <group position={[4.12, 0.42, z]}>
    <mesh castShadow><boxGeometry args={[1.25, 0.82, 1.28]} /><meshStandardMaterial color={color} metalness={0.26} roughness={0.56} /></mesh>
    <mesh position={[-0.4, 0.43, 0]} rotation={[0, 0, -0.25]}><boxGeometry args={[1.08, 0.07, 1.16]} /><meshStandardMaterial color={label === 'RED' ? '#e84a55' : '#3483ed'} /></mesh>
  </group>;
}

function Machine({ state, preview, frame, onSensorMove, onSelect }: Props & { frame: ReplayFrame | null }) {
  const has = (id: string) => preview || state.components.some((item) => item.id === id);
  const sensor = state.components.find((item) => item.id === 'sensor-color');
  const previewBoxes: ReplayBox[] = [
    { id: 'preview-red', color: 'red', position: [-2.8, .79, -.18], rotation: [0, 0, 0, 1], velocity: [2, 0, 0], state: 'moving' },
    { id: 'preview-blue', color: 'blue', position: [-1.7, .79, .18], rotation: [0, 0, 0, 1], velocity: [2, 0, 0], state: 'moving' },
  ];
  const boxes = frame?.boxes ?? (preview ? previewBoxes : []);
  const angle = frame?.diverterAngle ?? (preview ? -0.42 : 0);
  const humanLocked = Boolean(sensor?.humanLocked);
  return <>
    <ambientLight intensity={0.62} />
    <directionalLight position={[5, 8, 4]} intensity={2.8} color="#d9f7ff" castShadow />
    <pointLight position={[-3, 3, -2]} intensity={25} color="#2bd9ff" distance={9} />
    <pointLight position={[3, 2, 3]} intensity={19} color="#ff9c45" distance={8} />
    {has('conveyor-main') && <Belt xray={state.xray} />}
    {has('sensor-color') && <Sensor x={sensor?.position[0] ?? -0.8} xray={state.xray} disabled={state.phase === 'simulating'} humanLocked={humanLocked} onMove={onSensorMove} onSelect={() => onSelect('sensor-color')} />}
    {has('diverter-servo') && <Diverter angle={angle} xray={state.xray} onSelect={() => onSelect('diverter-servo')} />}
    {has('ramp-red') && <Ramp color="#70252b" z={-1.03} rotationY={-0.16} />}
    {has('ramp-blue') && <Ramp color="#173f78" z={1.03} rotationY={0.16} />}
    {has('bin-red') && <Bin color="#8a262e" z={-1.78} label="RED" />}
    {has('bin-blue') && <Bin color="#1c4c96" z={1.78} label="BLUE" />}
    {boxes.map((box) => <Package key={box.id} box={box} xray={state.xray} />)}
    {frame?.collisionPoints.map((point, index) => <mesh key={`${point.join('-')}-${index}`} position={point}><sphereGeometry args={[0.13, 16, 16]} /><meshBasicMaterial color="#ff4f62" transparent opacity={0.9} /></mesh>)}
    {state.xray && has('sensor-color') && has('diverter-servo') && <Line points={[[sensor?.position[0] ?? -0.8, 1.42, 0], [1.2, .82, 0]]} color="#66e5ff" dashed dashScale={3} transparent opacity={0.48} />}
    <mesh position={[0, -0.16, 0]} receiveShadow><boxGeometry args={[13, 0.2, 8]} /><meshStandardMaterial color="#0a0e12" roughness={0.82} /></mesh>
    <Grid position={[0, -0.05, 0]} args={[15, 10]} cellColor="#21313a" sectionColor="#315363" fadeDistance={14} fadeStrength={1.45} />
    <ContactShadows position={[0, -0.04, 0]} opacity={0.58} scale={13} blur={2.4} far={5} />
    <OrbitControls makeDefault enablePan minDistance={6.4} maxDistance={13} minPolarAngle={0.48} maxPolarAngle={1.42} target={[0.2, 0.52, 0]} />
  </>;
}

function useReplay(state: ForgeState) {
  const run = state.runs.find((item) => item.id === state.replayRunId) ?? null;
  const failureFrame = run?.failures[0]?.replayFrame ?? 0;
  const start = run && state.replayMode === 'failure' ? Math.max(0, failureFrame - 20) : 0;
  const end = run && state.replayMode === 'failure' ? Math.min(run.replay.length - 1, failureFrame + 30) : Math.max(0, (run?.replay.length ?? 1) - 1);
  const [cursor, setCursor] = useState({ runId: '', index: 0 });
  const index = run && cursor.runId === run.id ? Math.max(start, Math.min(end, cursor.index)) : start;
  useEffect(() => {
    if (!run) return;
    const timer = window.setInterval(() => setCursor((current) => {
      const currentIndex = current.runId === run.id ? current.index : start;
      return { runId: run.id, index: currentIndex >= end ? start : Math.min(end, currentIndex + (state.replayMode === 'failure' ? 1 : 4)) };
    }), state.replayMode === 'failure' ? 200 : 50);
    return () => window.clearInterval(timer);
  }, [run, start, end, state.replayMode]);
  return { run, frame: run?.replay[index] ?? null, index };
}

export function ForgeScene(props: Props) {
  const { state } = props;
  const { run, frame, index } = useReplay(state);
  return <div className="canvas-wrap">
    <Canvas aria-label="Interactive 3D color-sorting machine. Drag the cyan color sensor left or right along its rail." role="img" shadows dpr={[1, 1.55]} camera={{ position: [7.4, 5.15, 8.6], fov: 39 }} gl={{ antialias: true }} onPointerMissed={() => props.onSelect('')}>
      <color attach="background" args={['#080c10']} />
      <fog attach="fog" args={['#080c10', 9, 17]} />
      <Suspense fallback={null}><Machine {...props} frame={frame} /></Suspense>
    </Canvas>
    <div className="sr-only" aria-live="polite">{run ? `${run.status} simulation replay at ${frame?.time ?? 0} seconds, frame ${index + 1} of ${run.replay.length}` : 'Machine scene ready'}</div>
  </div>;
}
