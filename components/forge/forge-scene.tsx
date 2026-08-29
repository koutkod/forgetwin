'use client';

import { ContactShadows, Edges, Grid, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { type Group, MathUtils, Plane, Vector3 } from 'three';
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

function StandardMaterial({ color, xray, selected = false, metalness = .62, roughness = .32 }: { color: string; xray: boolean; selected?: boolean; metalness?: number; roughness?: number }) {
  return <meshStandardMaterial color={selected ? '#65e5ff' : color} emissive={selected ? '#123b48' : '#000000'} emissiveIntensity={selected ? .65 : 0} metalness={metalness} roughness={roughness} wireframe={xray} transparent={xray} opacity={xray ? .72 : 1} />;
}

function BoxBody({ size, color, xray, selected, radius = .04, metalness, roughness }: { size: Vec3; color: string; xray: boolean; selected: boolean; radius?: number; metalness?: number; roughness?: number }) {
  const maxRadius = Math.max(.008, Math.min(...size) * .32);
  return <RoundedBox args={size} radius={Math.min(radius, maxRadius)} smoothness={3} castShadow receiveShadow><StandardMaterial color={color} xray={xray} selected={selected} metalness={metalness} roughness={roughness} /><Edges color={selected ? '#8bf0ff' : xray ? '#64e4ff' : '#162028'} opacity={selected ? .92 : xray ? .55 : .18} transparent /></RoundedBox>;
}

function Gear({ component, xray, selected }: { component: MachineComponent; xray: boolean; selected: boolean }) {
  const teeth = Math.max(8, Math.min(30, Math.round(Number(component.parameters.teeth ?? 16) / 2)));
  const radius = component.dimensions[0] / 2;
  return <group rotation={[Math.PI / 2, 0, 0]}><mesh castShadow><cylinderGeometry args={[radius, radius, component.dimensions[1], Math.max(18, teeth * 2)]} /><StandardMaterial color="#c89443" xray={xray} selected={selected} metalness={.72} roughness={.28} /></mesh>{Array.from({ length: teeth }, (_, index) => { const angle = index / teeth * Math.PI * 2; return <mesh key={index} position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]} rotation={[0, -angle, 0]}><boxGeometry args={[radius * .22, component.dimensions[1] * 1.08, radius * .2]} /><StandardMaterial color="#c89443" xray={xray} selected={selected} metalness={.72} roughness={.28} /></mesh>; })}<mesh><cylinderGeometry args={[radius * .28, radius * .28, component.dimensions[1] * 1.35, 28]} /><StandardMaterial color="#73838a" xray={xray} selected={selected} metalness={.88} roughness={.18} /></mesh><mesh><cylinderGeometry args={[radius * .1, radius * .1, component.dimensions[1] * 1.5, 20]} /><StandardMaterial color="#202a30" xray={xray} selected={selected} metalness={.7} roughness={.3} /></mesh></group>;
}

function Spring({ component, xray, selected }: { component: MachineComponent; xray: boolean; selected: boolean }) {
  const turns = 18;
  const points = Array.from({ length: turns * 5 }, (_, index) => {
    const t = index / (turns * 5 - 1); const angle = t * Math.PI * 2 * turns;
    return [Math.cos(angle) * component.dimensions[0], (t - .5) * component.dimensions[1], Math.sin(angle) * component.dimensions[0]] as Vec3;
  });
  return <Line points={points} color={selected ? '#65e5ff' : component.color} lineWidth={xray ? 1 : 2} transparent opacity={xray ? .7 : 1} />;
}

function IndustrialFrame({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const rail = Math.max(.08, Math.min(.22, Math.min(x, z) * .09));
  return <group>
    <BoxBody size={[x, Math.max(.08, y * .55), rail]} color={color} xray={xray} selected={selected} radius={.035} />
    <group position={[0, 0, z / 2 - rail / 2]}><BoxBody size={[x, y, rail]} color={color} xray={xray} selected={selected} radius={.035} /></group>
    <group position={[0, 0, -z / 2 + rail / 2]}><BoxBody size={[x, y, rail]} color={color} xray={xray} selected={selected} radius={.035} /></group>
    <group position={[x / 2 - rail / 2, 0, 0]}><BoxBody size={[rail, y, z]} color={color} xray={xray} selected={selected} radius={.035} /></group>
    <group position={[-x / 2 + rail / 2, 0, 0]}><BoxBody size={[rail, y, z]} color={color} xray={xray} selected={selected} radius={.035} /></group>
  </group>;
}

function BicycleWheel({ component, xray, selected }: { component: MachineComponent; xray: boolean; selected: boolean }) {
  const radius = component.dimensions[0] / 2;
  const width = component.dimensions[1];
  const spokeColor = selected ? '#65e5ff' : '#c9d3d7';
  return <group>
    <mesh castShadow receiveShadow><torusGeometry args={[radius * .88, radius * .095, 14, 64]} /><StandardMaterial color="#151c20" xray={xray} selected={selected} metalness={.08} roughness={.82} /></mesh>
    <mesh><torusGeometry args={[radius * .78, radius * .026, 10, 56]} /><StandardMaterial color="#b5c1c6" xray={xray} selected={selected} metalness={.92} roughness={.14} /></mesh>
    {[-1, 1].flatMap((side) => Array.from({ length: 12 }, (_, index) => {
      const angle = index / 12 * Math.PI * 2;
      return <Line key={`${side}-${index}`} points={[[0, 0, side * width * .43], [Math.cos(angle) * radius * .77, Math.sin(angle) * radius * .77, side * width * .43]]} color={spokeColor} lineWidth={xray ? .7 : 1.1} transparent opacity={xray ? .68 : .92} />;
    }))}
    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[radius * .105, radius * .105, width * 1.35, 24]} /><StandardMaterial color="#53636b" xray={xray} selected={selected} metalness={.9} roughness={.17} /></mesh>
    <mesh><torusGeometry args={[radius * .19, radius * .018, 8, 32]} /><StandardMaterial color="#d0dadc" xray={xray} selected={selected} metalness={.92} roughness={.14} /></mesh>
  </group>;
}

function BicycleTube({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const length = component.dimensions[0];
  const radius = Math.max(.022, Math.max(component.dimensions[1], component.dimensions[2]) / 2);
  return <group rotation={[0, 0, Math.PI / 2]}>
    <mesh castShadow receiveShadow><cylinderGeometry args={[radius, radius, length, 20]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.7} roughness={.24} /></mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[0, side * length * .48, 0]}><torusGeometry args={[radius * .92, radius * .12, 7, 20]} /><StandardMaterial color="#d6dee1" xray={xray} selected={selected} metalness={.9} roughness={.14} /></mesh>)}
  </group>;
}

function BicycleChain({ component, xray, selected }: { component: MachineComponent; xray: boolean; selected: boolean }) {
  const half = component.dimensions[0] / 2;
  const height = Math.max(.1, component.dimensions[2] * .72);
  const points = [
    [-half + height, height, 0], [half - height, height, 0], [half, 0, 0], [half - height, -height, 0],
    [-half + height, -height, 0], [-half, 0, 0], [-half + height, height, 0],
  ] as Vec3[];
  return <group><Line points={points} color={selected ? '#65e5ff' : '#b9c2c5'} lineWidth={xray ? 1 : 2.2} transparent opacity={xray ? .7 : 1} />{!xray && points.slice(0, -1).map((point, index) => <mesh key={index} position={point}><sphereGeometry args={[.025, 8, 8]} /><meshStandardMaterial color="#626e73" metalness={.88} roughness={.2} /></mesh>)}</group>;
}

function BicycleSeat({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group><group rotation={[0, 0, -.08]}><BoxBody size={[x, y, z]} color={color} xray={xray} selected={selected} radius={Math.min(.08, y * .48)} metalness={.08} roughness={.78} /></group><group position={[-x * .2, -y * .62, 0]}><BoxBody size={[x * .48, y * .24, z * .58]} color="#59666c" xray={xray} selected={selected} radius={.02} /></group></group>;
}

function BicycleBattery({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group><BoxBody size={component.dimensions} color="#202c33" xray={xray} selected={selected} radius={.055} metalness={.34} roughness={.38} /><group position={[0, 0, z * .53]}><BoxBody size={[x * .82, y * .68, .025]} color={color} xray={xray} selected={selected} radius={.012} /></group>{!xray && <><mesh position={[x * .32, y * .15, z * .57]}><sphereGeometry args={[.025, 10, 10]} /><meshStandardMaterial color="#5cf19a" emissive="#19462c" /></mesh><Line points={[[x * -.28, y * -.2, z * .57], [x * .23, y * -.2, z * .57]]} color="#72828a" lineWidth={1.2} /></>}</group>;
}

function BicycleHubMotor({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const radius = component.dimensions[0] / 2;
  const width = component.dimensions[1];
  return <group rotation={[Math.PI / 2, 0, 0]}><mesh castShadow><cylinderGeometry args={[radius, radius, width, 36]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.72} roughness={.22} /></mesh>{!xray && Array.from({ length: 10 }, (_, index) => <mesh key={index} rotation={[0, index / 10 * Math.PI * 2, 0]} position={[0, 0, width * .52]}><boxGeometry args={[radius * .08, radius * 1.55, .018]} /><meshStandardMaterial color="#29353b" metalness={.72} roughness={.26} /></mesh>)}<mesh><cylinderGeometry args={[radius * .2, radius * .2, width * 1.28, 22]} /><StandardMaterial color="#d4dde0" xray={xray} selected={selected} metalness={.94} roughness={.12} /></mesh></group>;
}

function Wheel({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const radius = component.dimensions[0] / 2;
  const width = component.dimensions[1];
  return <group rotation={[Math.PI / 2, 0, 0]}>
    <mesh castShadow receiveShadow><cylinderGeometry args={[radius, radius, width, 32]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.12} roughness={.78} /></mesh>
    <mesh><cylinderGeometry args={[radius * .48, radius * .48, width * 1.08, 24]} /><StandardMaterial color="#a9b7be" xray={xray} selected={selected} metalness={.85} roughness={.2} /></mesh>
    <mesh><cylinderGeometry args={[radius * .16, radius * .16, width * 1.18, 18]} /><StandardMaterial color="#26323a" xray={xray} selected={selected} /></mesh>
    {!xray && Array.from({ length: 12 }, (_, index) => <mesh key={index} rotation={[0, index / 12 * Math.PI * 2, 0]} position={[0, 0, width * .51]}><boxGeometry args={[radius * .1, radius * 1.72, .015]} /><meshStandardMaterial color="#10161a" roughness={.9} /></mesh>)}
  </group>;
}

function Pulley({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const radius = component.dimensions[0] / 2;
  const width = component.dimensions[1];
  return <group>
    <mesh castShadow><cylinderGeometry args={[radius, radius, width, 32]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[radius * .82, Math.max(.018, width * .12), 10, 30]} /><StandardMaterial color="#151d22" xray={xray} selected={selected} metalness={.4} roughness={.65} /></mesh>
    <mesh><cylinderGeometry args={[radius * .18, radius * .18, width * 1.25, 20]} /><StandardMaterial color="#c9d4d8" xray={xray} selected={selected} metalness={.9} roughness={.15} /></mesh>
  </group>;
}

function DriveBody({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [diameter, length] = component.dimensions;
  return <group>
    <mesh castShadow><cylinderGeometry args={[diameter / 2, diameter / 2, length, 28]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>
    <mesh position={[0, length * .48, 0]}><cylinderGeometry args={[diameter * .36, diameter * .36, length * .12, 24]} /><StandardMaterial color="#9eabb1" xray={xray} selected={selected} metalness={.88} roughness={.18} /></mesh>
    <mesh position={[0, length * .6, 0]}><cylinderGeometry args={[diameter * .11, diameter * .11, length * .28, 18]} /><StandardMaterial color="#d8e0e3" xray={xray} selected={selected} metalness={.95} roughness={.12} /></mesh>
    {!xray && Array.from({ length: 7 }, (_, index) => <mesh key={index} position={[0, (index / 7 - .43) * length, 0]}><torusGeometry args={[diameter * .51, Math.max(.008, diameter * .025), 7, 24]} /><meshStandardMaterial color="#1b242a" metalness={.65} roughness={.38} /></mesh>)}
  </group>;
}

function StructuralBeam({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const articulated = /link|arm|crank|coupler|rocker|boom|lever/.test(component.role);
  if (articulated) return <group>
    <BoxBody size={[x * .82, y, z]} color={color} xray={xray} selected={selected} radius={Math.min(.1, y * .35)} metalness={.76} roughness={.24} />
    {[-1, 1].map((side) => <group key={side} position={[side * x * .43, 0, 0]} rotation={[Math.PI / 2, 0, 0]}><mesh castShadow><cylinderGeometry args={[Math.max(y, z) * .68, Math.max(y, z) * .68, z * 1.06, 24]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.8} roughness={.22} /></mesh><mesh><cylinderGeometry args={[Math.max(y, z) * .24, Math.max(y, z) * .24, z * 1.12, 20]} /><StandardMaterial color="#1b2429" xray={xray} selected={selected} /></mesh></group>)}
  </group>;
  return <group>
    <BoxBody size={[x, Math.max(.035, y * .22), z]} color={color} xray={xray} selected={selected} radius={.016} metalness={.82} roughness={.25} />
    <group position={[0, y * .39, 0]}><BoxBody size={[x, Math.max(.035, y * .22), z]} color={color} xray={xray} selected={selected} radius={.016} /></group>
    <group position={[0, y * .19, 0]}><BoxBody size={[x, y * .62, Math.max(.035, z * .22)]} color={color} xray={xray} selected={selected} radius={.012} /></group>
  </group>;
}

function LatticeMast({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const rail = Math.max(.055, Math.min(x, z) * .2);
  const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
  return <group>
    {corners.map(([sx, sz]) => <group key={`${sx}-${sz}`} position={[sx * x * .34, 0, sz * z * .34]}><BoxBody size={[rail, y, rail]} color={color} xray={xray} selected={selected} radius={.018} /></group>)}
    {Array.from({ length: 5 }, (_, index) => { const y0 = -y * .42 + index * y * .2; const y1 = y0 + y * .18; return <group key={index}><Line points={[[-x * .34, y0, z * .36], [x * .34, y1, z * .36]]} color={selected ? '#65e5ff' : '#93a5ac'} lineWidth={xray ? 1 : 2} /><Line points={[[x * .34, y0, -z * .36], [-x * .34, y1, -z * .36]]} color={selected ? '#65e5ff' : '#93a5ac'} lineWidth={xray ? 1 : 2} /></group>; })}
    <group position={[0, -y * .51, 0]}><BoxBody size={[x * 1.45, .09, z * 1.45]} color="#39474e" xray={xray} selected={selected} radius={.025} /></group>
  </group>;
}

function WinchBody({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group>
    <group position={[-x * .3, 0, 0]}><BoxBody size={[x * .44, y, z]} color={color} xray={xray} selected={selected} radius={.05} metalness={.72} roughness={.26} /></group>
    <mesh position={[x * .18, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[y * .38, y * .38, z * .82, 30]} /><StandardMaterial color="#44535a" xray={xray} selected={selected} metalness={.82} roughness={.24} /></mesh>
    {!xray && Array.from({ length: 7 }, (_, index) => <mesh key={index} position={[x * .18, 0, -z * .31 + index * z * .1]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[y * .39, .012, 7, 26]} /><meshStandardMaterial color="#c5d0d4" metalness={.82} roughness={.26} /></mesh>)}
    <group position={[x * .18, -y * .52, 0]}><BoxBody size={[x * .72, .08, z * 1.18]} color="#303d43" xray={xray} selected={selected} radius={.022} /></group>
  </group>;
}

function MachinedPlate({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group>
    <BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={Math.min(.06, y * .25)} metalness={.78} roughness={.24} />
    {!xray && [[-.38, -.36], [-.38, .36], [.38, -.36], [.38, .36]].map(([xf, zf], index) => <mesh key={index} position={[x * xf, y * .53, z * zf]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[Math.min(.08, Math.min(x, z) * .07), .012, 8, 20]} /><meshStandardMaterial color="#243038" metalness={.72} roughness={.3} /></mesh>)}
  </group>;
}

function RollerBody({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const radius = component.dimensions[0] / 2, length = component.dimensions[1];
  return <group rotation={[Math.PI / 2, 0, 0]}><mesh castShadow><cylinderGeometry args={[radius, radius, length, 28]} /><StandardMaterial color="#9ba8ae" xray={xray} selected={selected} metalness={.88} roughness={.2} /></mesh>{[-1, 1].map((side) => <mesh key={side} position={[0, side * length * .51, 0]}><cylinderGeometry args={[radius * .42, radius * .42, length * .08, 20]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.82} roughness={.24} /></mesh>)}</group>;
}

function ShaftBody({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const radius = component.dimensions[0] / 2, length = component.dimensions[1];
  return <group><mesh castShadow><cylinderGeometry args={[radius, radius, length * .76, 28]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.9} roughness={.17} /></mesh>{[-1, 1].map((side) => <mesh key={side} position={[0, side * length * .43, 0]}><cylinderGeometry args={[radius * .7, radius * .7, length * .14, 24]} /><StandardMaterial color="#c5d0d4" xray={xray} selected={selected} metalness={.94} roughness={.12} /></mesh>)}<group position={[radius * .58, 0, 0]}><BoxBody size={[radius * .22, length * .42, radius * .18]} color="#273138" xray={xray} selected={selected} radius={.008} /></group></group>;
}

function ServoBody({ component, color, xray, selected, actuatorValue }: { component: MachineComponent; color: string; xray: boolean; selected: boolean; actuatorValue: number }) {
  const [x, y, z] = component.dimensions;
  return <group><BoxBody size={[x, y, z]} color={color} xray={xray} selected={selected} radius={.055} metalness={.7} roughness={.26} /><mesh position={[0, y * .58, 0]}><cylinderGeometry args={[x * .2, x * .2, y * .18, 24]} /><StandardMaterial color="#dbe4e7" xray={xray} selected={selected} metalness={.92} roughness={.14} /></mesh><group position={[0, y * .69, 0]} rotation={[0, actuatorValue * Math.PI * .8, 0]}><BoxBody size={[x * .95, y * .12, z * .16]} color="#e8a246" xray={xray} selected={selected} radius={.018} /></group></group>;
}

function ControlCabinet({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group><BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.035} metalness={.4} roughness={.32} /><group position={[0, 0, z * .52]}><BoxBody size={[x * .84, y * .82, .035]} color="#111a20" xray={xray} selected={selected} radius={.02} /></group>{!xray && [-.22, 0, .22].map((factor, index) => <mesh key={factor} position={[x * factor, y * .25, z * .55]}><sphereGeometry args={[.035, 12, 12]} /><meshStandardMaterial color={['#45df85', '#ffbd45', '#4bd7ff'][index]} emissive={['#173d27', '#3f3013', '#123844'][index]} /></mesh>)}<mesh position={[x * .3, -y * .25, z * .55]}><cylinderGeometry args={[.07, .07, .04, 20]} /><meshStandardMaterial color="#e74856" /></mesh></group>;
}

function ConveyorFrame({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions, rail = Math.max(.09, z * .07), leg = Math.max(.1, z * .085);
  return <group><group position={[0, y * .42, z * .43]}><BoxBody size={[x, rail, rail]} color={color} xray={xray} selected={selected} radius={.02} /></group><group position={[0, y * .42, -z * .43]}><BoxBody size={[x, rail, rail]} color={color} xray={xray} selected={selected} radius={.02} /></group>{[-.42, .42].flatMap((xf) => [-.4, .4].map((zf) => <group key={`${xf}-${zf}`} position={[x * xf, 0, z * zf]}><BoxBody size={[leg, y, leg]} color={color} xray={xray} selected={selected} radius={.025} /><group position={[0, -y * .51, 0]}><BoxBody size={[leg * 2.2, .06, leg * 2.2]} color="#303c42" xray={xray} selected={selected} radius={.018} /></group></group>))}</group>;
}

function IndustrialConveyor({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const moving = useRef<Group>(null);
  useFrame(({ clock }) => { if (moving.current) moving.current.position.x = (clock.elapsedTime * .42) % Math.max(.22, x * .12) - x * .06; });
  return <group><BoxBody size={[x, y * .76, z]} color="#34434a" xray={xray} selected={selected} radius={.06} metalness={.66} roughness={.3} /><group position={[0, y * .46, 0]}><BoxBody size={[x * .98, y * .22, z * .84]} color="#171d21" xray={xray} selected={selected} radius={.04} metalness={.1} roughness={.88} /></group><group ref={moving} position={[0, y * .59, 0]}>{Array.from({ length: 10 }, (_, index) => <mesh key={index} position={[-x * .52 + index * x * .12, 0, 0]}><boxGeometry args={[.028, .012, z * .75]} /><meshStandardMaterial color="#48545a" roughness={.65} /></mesh>)}</group>{[-1, 1].map((side) => <group key={side} position={[0, y * .58, side * z * .47]}><BoxBody size={[x, y * .48, .075]} color={color} xray={xray} selected={selected} radius={.022} metalness={.86} roughness={.2} /></group>)}{[-1, 1].map((side) => <mesh key={side} position={[side * x * .47, y * .38, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[y * .45, y * .45, z * .86, 28]} /><StandardMaterial color="#6d7b82" xray={xray} selected={selected} metalness={.82} roughness={.22} /></mesh>)}</group>;
}

function Crate({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group>
    <BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.035} metalness={component.materialId === 'polymer' ? .12 : .62} roughness={.48} />
    {!xray && <><mesh position={[0, 0, z * .505]}><boxGeometry args={[x * .9, y * .08, .018]} /><meshStandardMaterial color="#11191e" /></mesh><mesh position={[0, 0, -z * .505]}><boxGeometry args={[x * .9, y * .08, .018]} /><meshStandardMaterial color="#11191e" /></mesh>{component.parameters.rigged_load && <><mesh position={[x * .28, 0, 0]}><boxGeometry args={[.045, y * 1.05, z * 1.04]} /><meshStandardMaterial color="#d9a23d" metalness={.45} /></mesh><mesh position={[-x * .28, 0, 0]}><boxGeometry args={[.045, y * 1.05, z * 1.04]} /><meshStandardMaterial color="#d9a23d" metalness={.45} /></mesh></>}</>}
  </group>;
}

function SortingBin({ component, xray, selected }: { component: MachineComponent; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const route = component.parameters.route_color === 'red' ? '#d93f52' : '#2e78df';
  const wall = Math.max(.06, Math.min(x, z) * .07);
  return <group><group position={[0, -y * .44, 0]}><BoxBody size={[x, wall, z]} color={route} xray={xray} selected={selected} radius={.035} metalness={.12} roughness={.55} /></group>{[-1, 1].map((side) => <group key={`x-${side}`} position={[side * (x / 2 - wall / 2), 0, 0]}><BoxBody size={[wall, y, z]} color={route} xray={xray} selected={selected} radius={.035} /></group>)}{[-1, 1].map((side) => <group key={`z-${side}`} position={[0, 0, side * (z / 2 - wall / 2)]}><BoxBody size={[x, y, wall]} color={route} xray={xray} selected={selected} radius={.035} /></group>)}<group position={[0, -y * .12, z * .52]}><BoxBody size={[x * .62, y * .28, .035]} color="#eef4f5" xray={xray} selected={selected} radius={.02} metalness={.05} roughness={.7} /></group></group>;
}

function TransferChute({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const accent = component.parameters.route_color === 'red' ? '#d93f52' : component.parameters.route_color === 'blue' ? '#2e78df' : color;
  return <group><BoxBody size={[x, y, z]} color="#7d8c93" xray={xray} selected={selected} radius={.025} metalness={.8} roughness={.24} />{[-1, 1].map((side) => <group key={side} position={[0, y * .52, side * z * .46]}><BoxBody size={[x, y * 3.2, .075]} color={accent} xray={xray} selected={selected} radius={.02} metalness={.48} roughness={.34} /></group>)}<group position={[x * .43, y * .65, 0]}><BoxBody size={[.12, y * 3.3, z]} color={accent} xray={xray} selected={selected} radius={.018} /></group></group>;
}

function SortingSensor({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const portalWidth = Math.max(1.45, z * 4.1), postHeight = Math.max(.82, y * 2.7);
  return <group><group position={[0, 0, 0]}><BoxBody size={[x * 1.5, y, portalWidth]} color={color} xray={xray} selected={selected} radius={.035} metalness={.36} roughness={.28} /></group>{[-1, 1].map((side) => <group key={side} position={[0, -postHeight * .52, side * portalWidth * .46]}><BoxBody size={[x * .5, postHeight, x * .5]} color="#51636b" xray={xray} selected={selected} radius={.025} /></group>)}<mesh position={[0, -y * .58, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[x * .23, x * .23, x * .28, 22]} /><StandardMaterial color="#54e5ff" xray={xray} selected={selected} metalness={.2} roughness={.18} /></mesh><mesh position={[0, -postHeight * .64, 0]}><boxGeometry args={[.035, postHeight * .66, portalWidth * .82]} /><meshBasicMaterial color="#49dcff" transparent opacity={xray ? .24 : .09} depthWrite={false} /></mesh></group>;
}

function SortingDiverter({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group><group position={[-x * .42, -y * .35, 0]}><mesh><cylinderGeometry args={[z * .72, z * .72, y * 2.4, 24]} /><StandardMaterial color="#d1dade" xray={xray} selected={selected} metalness={.9} roughness={.14} /></mesh><mesh position={[0, y * 1.24, 0]}><cylinderGeometry args={[z * .38, z * .38, y * .18, 20]} /><StandardMaterial color="#f2aa46" xray={xray} selected={selected} /></mesh></group><group position={[x * .05, 0, 0]}><BoxBody size={[x * .9, y, z]} color={color} xray={xray} selected={selected} radius={.05} metalness={.7} roughness={.28} /></group><group position={[x * .42, 0, 0]}><BoxBody size={[.08, y * 1.7, z * 1.45]} color="#f6bd57" xray={xray} selected={selected} radius={.025} /></group></group>;
}

function LinearActuator({ component, color, xray, selected, actuatorValue }: { component: MachineComponent; color: string; xray: boolean; selected: boolean; actuatorValue: number }) {
  const [diameter, length] = component.dimensions;
  return <group><mesh castShadow><cylinderGeometry args={[diameter / 2, diameter / 2, length * .58, 28]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.75} roughness={.24} /></mesh><mesh position={[0, length * (.18 + actuatorValue * .2), 0]}><cylinderGeometry args={[diameter * .24, diameter * .24, length * .72, 22]} /><StandardMaterial color="#d8e1e4" xray={xray} selected={selected} metalness={.95} roughness={.1} /></mesh>{[-1, 1].map((side) => <mesh key={side} position={[0, side * length * .37, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[diameter * .48, diameter * .13, 9, 24]} /><StandardMaterial color="#3c4a51" xray={xray} selected={selected} /></mesh>)}</group>;
}

function BeltBody({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group><BoxBody size={[x, y, z]} color="#171d20" xray={xray} selected={selected} radius={Math.min(.08, z * .28)} metalness={.05} roughness={.88} />{[-1, 1].map((side) => <mesh key={side} position={[side * x * .46, 0, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[z * .42, z * .42, y * 1.7, 24]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.7} roughness={.32} /></mesh>)}{!xray && Array.from({ length: 8 }, (_, index) => <mesh key={index} position={[-x * .42 + index * x * .12, y * .56, 0]}><boxGeometry args={[.022, .012, z * .86]} /><meshStandardMaterial color="#4f5c62" /></mesh>)}</group>;
}

function ReplayPackage({ item, xray }: { item: ReplayFrame['items'][number]; xray: boolean }) {
  const [x, y, z] = item.size;
  return <group position={item.position} quaternion={item.rotation}><BoxBody size={item.size} color={item.state === 'failed' ? '#ff5668' : item.color} xray={xray} selected={false} radius={.055} metalness={.02} roughness={.72} /><group position={[0, y * .51, 0]}><BoxBody size={[x * .18, .022, z * 1.01]} color="#f3d28d" xray={xray} selected={false} radius={.008} metalness={.01} roughness={.8} /></group><group position={[0, 0, z * .51]}><BoxBody size={[x * .58, y * .38, .02]} color="#f5f7f8" xray={xray} selected={false} radius={.012} metalness={.01} roughness={.75} /></group></group>;
}

function ParametricCadPart({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const form = String(component.parameters.cad_form ?? 'machined_part');
  const faceMaterial = (shade = color) => <StandardMaterial color={shade} xray={xray} selected={selected} metalness={.88} roughness={.18} />;
  if (form === 'bearing') {
    const radius = Math.max(x, y) / 2;
    return <group>
      <mesh castShadow><torusGeometry args={[radius * .68, radius * .22, 14, 42]} />{faceMaterial('#aebbc0')}</mesh>
      <mesh><torusGeometry args={[radius * .33, radius * .12, 12, 36]} />{faceMaterial('#d5dde0')}</mesh>
      {!xray && Array.from({ length: 10 }, (_, index) => { const angle = index / 10 * Math.PI * 2; return <mesh key={index} position={[Math.cos(angle) * radius * .5, Math.sin(angle) * radius * .5, z * .2]}><sphereGeometry args={[radius * .085, 12, 12]} /><meshStandardMaterial color="#66757c" metalness={.94} roughness={.12} /></mesh>; })}
    </group>;
  }
  if (form === 'flange') {
    const radius = Math.max(x, y) / 2;
    return <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[radius, radius, z, 40]} />{faceMaterial()}</mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[radius * .38, radius * .38, z * 1.6, 32]} />{faceMaterial('#73838a')}</mesh>
      {!xray && Array.from({ length: 6 }, (_, index) => { const angle = index / 6 * Math.PI * 2; return <mesh key={index} position={[Math.cos(angle) * radius * .7, Math.sin(angle) * radius * .7, z * .55]}><cylinderGeometry args={[radius * .075, radius * .075, z * .12, 16]} /><meshStandardMaterial color="#172126" metalness={.8} roughness={.25} /></mesh>; })}
    </group>;
  }
  if (form === 'coupling') {
    const radius = Math.max(y, z) / 2;
    return <group rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow><cylinderGeometry args={[radius * .72, radius * .72, x, 36]} />{faceMaterial('#84939a')}</mesh>
      {[-1, 1].map((side) => <mesh key={side} position={[0, side * x * .34, 0]}><cylinderGeometry args={[radius, radius, x * .23, 36]} />{faceMaterial(color)}</mesh>)}
      {!xray && Array.from({ length: 6 }, (_, index) => <mesh key={index} rotation={[0, index / 6 * Math.PI * 2, 0]} position={[0, 0, radius * .82]}><boxGeometry args={[x * .08, x * .72, radius * .12]} /><meshStandardMaterial color="#263239" metalness={.72} roughness={.28} /></mesh>)}
    </group>;
  }
  if (form === 'sprocket') return <Gear component={{ ...component, color }} xray={xray} selected={selected} />;
  if (form === 'cam') {
    const radius = Math.max(x, y) / 2;
    return <group>
      <mesh position={[radius * .16, radius * .08, 0]} scale={[1.12, .82, 1]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[radius * .78, radius * .78, z, 42]} />{faceMaterial()}</mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[radius * .16, radius * .16, z * 1.35, 24]} />{faceMaterial('#28343a')}</mesh>
      <mesh position={[radius * .62, radius * .2, z * .58]}><sphereGeometry args={[radius * .08, 16, 16]} /><meshStandardMaterial color="#e7ae4f" metalness={.72} roughness={.22} /></mesh>
    </group>;
  }
  if (form === 'angle_bracket') {
    const wall = Math.max(.06, Number(component.parameters.wall_thickness ?? .08));
    return <group>
      <group position={[0, -y / 2 + wall / 2, 0]}><BoxBody size={[x, wall, z]} color={color} xray={xray} selected={selected} radius={.025} /></group>
      <group position={[-x / 2 + wall / 2, 0, 0]}><BoxBody size={[wall, y, z]} color={color} xray={xray} selected={selected} radius={.025} /></group>
      {!xray && [[-.2, -.28], [.2, -.28], [-.2, .28], [.2, .28]].map(([xf, zf], index) => <mesh key={index} position={[x * xf, -y / 2 - .003, z * zf]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[Math.min(.07, z * .09), .012, 8, 20]} /><meshStandardMaterial color="#263138" metalness={.75} /></mesh>)}
    </group>;
  }
  if (form === 'housing') {
    const wall = Math.max(.07, Number(component.parameters.wall_thickness ?? .08));
    return <group>
      <group position={[0, -y / 2 + wall / 2, 0]}><BoxBody size={[x, wall, z]} color={color} xray={xray} selected={selected} radius={.04} /></group>
      {[-1, 1].map((side) => <group key={`side-${side}`} position={[side * (x / 2 - wall / 2), 0, 0]}><BoxBody size={[wall, y, z]} color={color} xray={xray} selected={selected} radius={.04} /></group>)}
      <group position={[0, 0, -z / 2 + wall / 2]}><BoxBody size={[x, y, wall]} color={color} xray={xray} selected={selected} radius={.04} /></group>
      {!xray && Array.from({ length: 5 }, (_, index) => <group key={index} position={[-x * .36 + index * x * .18, -y * .18, z * .52]}><BoxBody size={[wall, y * .62, wall]} color="#94a2a8" xray={false} selected={selected} radius={.014} /></group>)}
    </group>;
  }
  if (form === 'manifold') {
    const radius = Math.max(y, z) * .28;
    return <group>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[radius, radius, x, 32]} />{faceMaterial(color)}</mesh>
      {[-.3, 0, .3].map((factor) => <group key={factor} position={[x * factor, y * .45, 0]}><mesh><cylinderGeometry args={[radius * .42, radius * .42, y * .85, 24]} />{faceMaterial('#a8b5ba')}</mesh><mesh position={[0, y * .44, 0]}><torusGeometry args={[radius * .43, radius * .09, 9, 24]} />{faceMaterial('#d6dfe2')}</mesh></group>)}
    </group>;
  }
  if (form === 'rotor_hub') {
    const radius = Math.max(x, y) / 2;
    return <group><mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[radius, radius * .82, z, 36]} />{faceMaterial(color)}</mesh><mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[radius * .22, radius * .22, z * 1.55, 24]} />{faceMaterial('#26333a')}</mesh>{!xray && Array.from({ length: 6 }, (_, index) => { const angle = index / 6 * Math.PI * 2; return <mesh key={index} position={[Math.cos(angle) * radius * .62, Math.sin(angle) * radius * .62, z * .57]}><sphereGeometry args={[radius * .07, 12, 12]} /><meshStandardMaterial color="#d4dde0" metalness={.9} /></mesh>; })}</group>;
  }
  if (form === 'rotor_shroud') {
    const radius = Math.max(x, y) / 2;
    return <group>
      <mesh castShadow><torusGeometry args={[radius * .84, radius * .08, 18, 64]} />{faceMaterial('#718087')}</mesh>
      <mesh position={[0, 0, -z * .48]}><torusGeometry args={[radius * .84, radius * .025, 10, 64]} />{faceMaterial('#b7c2c6')}</mesh>
      {!xray && Array.from({ length: 8 }, (_, index) => { const angle = index / 8 * Math.PI * 2; return <mesh key={index} position={[Math.cos(angle) * radius * .84, Math.sin(angle) * radius * .84, z * .46]}><boxGeometry args={[radius * .075, radius * .075, z * .42]} /><meshStandardMaterial color="#344149" metalness={.82} roughness={.22} /></mesh>; })}
    </group>;
  }
  if (form === 'aero_blade') {
    return <group>
      <mesh castShadow scale={[1, 1, .86]} rotation={[0, 0, -.08]}><boxGeometry args={[x, y, z]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.46} roughness={.34} /></mesh>
      <mesh position={[x * .42, y * .1, 0]} scale={[.28, 1.45, 1]}><sphereGeometry args={[Math.max(y, z) * .48, 20, 14]} />{faceMaterial('#829198')}</mesh>
      {!xray && <Line points={[[-x * .45, y * .43, z * .5], [x * .45, y * .22, z * .5]]} color="#d9e2e5" lineWidth={1.2} />}
    </group>;
  }
  return <group><BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.065} metalness={.86} roughness={.2} />{!xray && <group position={[0, y * .52, 0]}><BoxBody size={[x * .64, .025, z * .35]} color="#526168" xray={false} selected={selected} radius={.01} /></group>}</group>;
}

function FixturePlate({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const holes = [-.34, -.17, 0, .17, .34].flatMap((xFactor) => [-.3, 0, .3].map((zFactor) => [x * xFactor, z * zFactor] as const));
  return <group>
    <BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.025} metalness={.84} roughness={.2} />
    {!xray && holes.map(([holeX, holeZ], index) => <group key={index} position={[holeX, y * .54, holeZ]}><mesh><cylinderGeometry args={[.055, .055, .018, 20]} /><meshStandardMaterial color="#172027" metalness={.75} roughness={.25} /></mesh><mesh position={[0, .012, 0]}><torusGeometry args={[.066, .01, 8, 20]} /><meshStandardMaterial color="#d2dde0" metalness={.95} roughness={.12} /></mesh></group>)}
    <group position={[0, y * .68, z * .45]}><BoxBody size={[x * .92, .09, .11]} color="#88979d" xray={xray} selected={selected} radius={.018} /></group>
    <group position={[0, y * .68, -z * .45]}><BoxBody size={[x * .92, .09, .11]} color="#88979d" xray={xray} selected={selected} radius={.018} /></group>
  </group>;
}

function HeatExchangerCore({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const finCount = 18;
  return <group>
    <BoxBody size={[x, y, z * .58]} color={color} xray={xray} selected={selected} radius={.02} metalness={.8} roughness={.24} />
    {!xray && Array.from({ length: finCount }, (_, index) => <mesh key={index} position={[0, -y * .44 + index / (finCount - 1) * y * .88, 0]} castShadow><boxGeometry args={[x * .94, .018, z * 1.2]} /><meshStandardMaterial color={index % 2 ? '#c7d1d4' : '#93a2a9'} metalness={.86} roughness={.22} /></mesh>)}
    {[-1, 1].map((side) => <group key={side} position={[side * x * .48, 0, 0]}><BoxBody size={[.12, y * 1.04, z * .96]} color="#56666e" xray={xray} selected={selected} radius={.018} /></group>)}
    {!xray && [-.28, 0, .28].map((yFactor) => [-.28, .28].map((xFactor) => <mesh key={`${xFactor}-${yFactor}`} position={[x * xFactor, y * yFactor, z * .39]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.075, .018, 8, 20]} /><meshStandardMaterial color="#b96f43" metalness={.72} roughness={.26} /></mesh>))}
  </group>;
}

function BrazedPlateLeaf({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const direction = Number(component.parameters.chevron_direction ?? 1);
  return <group>
    <BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.014} metalness={.9} roughness={.18} />
    {!xray && Array.from({ length: 7 }, (_, index) => {
      const offset = -.36 + index * .12;
      return <Line key={index} points={direction > 0 ? [[-x * .4, y * offset, z * .58], [0, y * (offset + .12), z * .58], [x * .4, y * offset, z * .58]] : [[-x * .4, y * (offset + .12), z * .58], [0, y * offset, z * .58], [x * .4, y * (offset + .12), z * .58]]} color="#b96f43" lineWidth={1.2} />;
    })}
    {!xray && [[-.36, -.34], [-.36, .34], [.36, -.34], [.36, .34]].map(([xFactor, yFactor], index) => <mesh key={index} position={[x * xFactor, y * yFactor, z * .6]}><torusGeometry args={[.14, .022, 8, 24]} /><meshStandardMaterial color="#ca7c4b" metalness={.82} roughness={.2} /></mesh>)}
  </group>;
}

function BrazedEndPlate({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  const front = component.parameters.end_role === 'front';
  return <group>
    <BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.065} metalness={.88} roughness={.2} />
    <group position={[0, 0, z * .62]}><BoxBody size={[x * .78, y * .78, z * .2]} color="#53636a" xray={xray} selected={selected} radius={.05} metalness={.9} roughness={.17} /></group>
    {front && [[-.3, -.225], [-.3, .225], [.3, -.225], [.3, .225]].map(([xFactor, yFactor], index) => <group key={index} position={[x * xFactor, y * yFactor, z * .78]}><mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.23, .23, .08, 28]} /><StandardMaterial color="#75858c" xray={xray} selected={selected} metalness={.92} roughness={.15} /></mesh><mesh><torusGeometry args={[.2, .032, 9, 28]} /><StandardMaterial color="#bd7448" xray={xray} selected={selected} metalness={.82} roughness={.2} /></mesh></group>)}
    {!xray && <><group position={[0, y * .44, z * .7]}><BoxBody size={[x * .9, .07, z * .16]} color="#bd7448" xray={false} selected={selected} radius={.012} /></group><group position={[0, -y * .44, z * .7]}><BoxBody size={[x * .9, .07, z * .16]} color="#bd7448" xray={false} selected={selected} radius={.012} /></group></>}
  </group>;
}

function CopperPipe({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const radius = component.dimensions[0] / 2;
  const length = component.dimensions[1];
  return <group>
    <mesh castShadow><cylinderGeometry args={[radius, radius, length, 28]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.72} roughness={.24} /></mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[0, side * length * .47, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[radius * 1.12, Math.max(.012, radius * .13), 8, 24]} /><StandardMaterial color="#d69162" xray={xray} selected={selected} metalness={.78} roughness={.2} /></mesh>)}
  </group>;
}

function FixtureClamp({ component, color, xray, selected, actuatorValue }: { component: MachineComponent; color: string; xray: boolean; selected: boolean; actuatorValue: number }) {
  const side = Number(component.parameters.clamp_side ?? 1);
  const [diameter, length] = component.dimensions;
  return <group>
    <mesh castShadow><cylinderGeometry args={[diameter / 2, diameter / 2, length * .62, 24]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>
    <mesh position={[0, length * (.22 + actuatorValue * .13), 0]}><cylinderGeometry args={[diameter * .24, diameter * .24, length * .58, 18]} /><StandardMaterial color="#dce5e8" xray={xray} selected={selected} metalness={.94} roughness={.12} /></mesh>
    <group position={[-side * .34, length * .48, 0]}><BoxBody size={[.78, .13, .18]} color="#e3a44a" xray={xray} selected={selected} radius={.025} metalness={.65} roughness={.28} /></group>
    <group position={[-side * .72, length * .38, 0]}><BoxBody size={[.28, .15, .42]} color="#303d44" xray={xray} selected={selected} radius={.025} /></group>
  </group>;
}

function LocatingPin({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group>
    <BoxBody size={[x * 1.55, y * .16, z * 1.55]} color="#46545b" xray={xray} selected={selected} radius={.035} />
    <mesh position={[0, y * .28, 0]} castShadow><cylinderGeometry args={[x * .28, x * .38, y * .55, 24]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.9} roughness={.16} /></mesh>
    <mesh position={[0, y * .59, 0]}><coneGeometry args={[x * .28, y * .18, 24]} /><StandardMaterial color="#d4dee1" xray={xray} selected={selected} metalness={.95} roughness={.1} /></mesh>
  </group>;
}

function LightBody({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [length, height, width] = component.dimensions;
  const vehicleHeadlight = /headlight|bicycle|vehicle|rover/i.test(component.role) || Boolean(component.parameters.headlight);
  const beamRange = Math.max(1.8, Math.min(6, Number(component.parameters.beam_range ?? 3.2)));
  const axisRotation: Vec3 = vehicleHeadlight ? [0, 0, -Math.PI / 2] : [Math.PI / 2, 0, 0];
  const beamRotation: Vec3 = vehicleHeadlight ? [0, 0, Math.PI / 2] : [-Math.PI / 2, 0, 0];
  const lensPosition: Vec3 = vehicleHeadlight ? [length * .48, 0, 0] : [0, 0, width * .48];
  const beamPosition: Vec3 = vehicleHeadlight ? [length * .48 + beamRange / 2, 0, 0] : [0, 0, width * .48 + beamRange / 2];
  return <group>
    <group position={vehicleHeadlight ? [-length * .42, -height * .38, 0] : [0, -height * .62, -width * .3]}>
      <BoxBody size={[length * .34, height * .38, width * .48]} color="#2b373d" xray={xray} selected={selected} radius={.025} metalness={.78} roughness={.24} />
    </group>
    <mesh rotation={axisRotation} castShadow><cylinderGeometry args={[Math.max(height, width) * .48, Math.max(height, width) * .39, length * .82, 32]} /><StandardMaterial color={color} xray={xray} selected={selected} metalness={.82} roughness={.2} /></mesh>
    <mesh position={lensPosition} rotation={axisRotation}><cylinderGeometry args={[Math.max(height, width) * .39, Math.max(height, width) * .39, length * .09, 32]} /><meshStandardMaterial color="#f4fbff" emissive="#dff6ff" emissiveIntensity={xray ? .7 : 3.5} metalness={.05} roughness={.08} transparent opacity={xray ? .68 : .96} /></mesh>
    <mesh position={vehicleHeadlight ? [length * .52, 0, 0] : [0, 0, width * .52]} rotation={vehicleHeadlight ? [0, Math.PI / 2, 0] : [0, 0, 0]}><torusGeometry args={[Math.max(height, width) * .43, Math.max(.012, height * .055), 10, 32]} /><StandardMaterial color="#c9d5da" xray={xray} selected={selected} metalness={.94} roughness={.12} /></mesh>
    <pointLight position={lensPosition} color="#dff7ff" intensity={xray ? .35 : 1.4} distance={3.2} decay={2} />
    <mesh position={beamPosition} rotation={beamRotation}><coneGeometry args={[beamRange * .2, beamRange, 28, 1, true]} /><meshBasicMaterial color="#bcefff" transparent opacity={xray ? .14 : .035} depthWrite={false} side={2} /></mesh>
  </group>;
}

function ComponentShape({ component, xray, selected, actuatorValue }: { component: MachineComponent; xray: boolean; selected: boolean; actuatorValue: number }) {
  const color = component.humanLockedFields.length ? '#f2b85a' : component.color;
  if (component.parameters.bicycle_wheel) return <BicycleWheel component={component} xray={xray} selected={selected} />;
  if (component.parameters.bicycle_tube) return <BicycleTube component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.bicycle_chain) return <BicycleChain component={component} xray={xray} selected={selected} />;
  if (component.parameters.bicycle_seat) return <BicycleSeat component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.bicycle_battery) return <BicycleBattery component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.bicycle_hub_motor) return <BicycleHubMotor component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.cad_form) return <ParametricCadPart component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.bphe_plate) return <BrazedPlateLeaf component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.bphe_end_plate) return <BrazedEndPlate component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.fixture_plate) return <FixturePlate component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.heat_exchanger_core) return <HeatExchangerCore component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.hvac_pipe) return <CopperPipe component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.fixture_clamp) return <FixtureClamp component={component} color={color} xray={xray} selected={selected} actuatorValue={actuatorValue} />;
  if (component.parameters.locating_pin) return <LocatingPin component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.sorting_sensor) return <SortingSensor component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.sorting_diverter) return <SortingDiverter component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.sorting_chute) return <TransferChute component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.sorting_bin) return <SortingBin component={component} xray={xray} selected={selected} />;
  if (component.parameters.conveyor_frame) return <ConveyorFrame component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.crane_winch) return <WinchBody component={component} color={color} xray={xray} selected={selected} />;
  if (/lattice.*mast|tower mast/.test(component.role)) return <LatticeMast component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.panel) return <group><BoxBody size={component.dimensions} color="#16384e" xray={xray} selected={selected} radius={.025} metalness={.35} roughness={.26} />{!xray && [-.3, -.1, .1, .3].map((factor) => <Line key={factor} points={[[component.dimensions[0] * factor, component.dimensions[1] * .52, -component.dimensions[2] * .48], [component.dimensions[0] * factor, component.dimensions[1] * .52, component.dimensions[2] * .48]]} color="#4d89a7" lineWidth={1} />)}</group>;
  if (component.primitive === 'gear') return <Gear component={{ ...component, color }} xray={xray} selected={selected} />;
  if (component.primitive === 'spring') return <Spring component={{ ...component, color }} xray={xray} selected={selected} />;
  if (component.primitive === 'frame') return <IndustrialFrame component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'beam') return <StructuralBeam component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'plate') return <MachinedPlate component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'wheel') return <Wheel component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'roller') return <RollerBody component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'pulley') return <Pulley component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'motor') return <DriveBody component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'servo') return <ServoBody component={component} color={color} xray={xray} selected={selected} actuatorValue={actuatorValue} />;
  if (component.primitive === 'shaft') return <ShaftBody component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'piston') return <LinearActuator component={component} color={color} xray={xray} selected={selected} actuatorValue={actuatorValue} />;
  if (component.primitive === 'belt') return <BeltBody component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'cable') {
    const start = [Number(component.parameters.start_x), Number(component.parameters.start_y), Number(component.parameters.start_z)] as Vec3;
    const end = [Number(component.parameters.end_x), Number(component.parameters.end_y), Number(component.parameters.end_z)] as Vec3;
    const hasPath = [...start, ...end].every(Number.isFinite);
    return hasPath ? <Line points={[start.map((value, index) => value - component.position[index]) as Vec3, end.map((value, index) => value - component.position[index]) as Vec3]} color={selected ? '#65e5ff' : color} lineWidth={Math.max(1.5, component.dimensions[0] * 38)} /> : <mesh><cylinderGeometry args={[Math.max(.015, component.dimensions[0]), Math.max(.015, component.dimensions[0]), component.dimensions[1], 10]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>;
  }
  if (component.primitive === 'sensor' || component.primitive === 'camera') return <group><BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.035} /><mesh position={[0, 0, component.dimensions[2] * .58]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[component.dimensions[0] * .22, component.dimensions[0] * .22, component.dimensions[2] * .18, 22]} /><StandardMaterial color="#5ee8ff" xray={xray} selected={selected} metalness={.22} roughness={.14} /></mesh><mesh position={[0, 0, component.dimensions[2] * 2.2]}><coneGeometry args={[component.dimensions[0] * 1.4, component.dimensions[2] * 3.2, 16, 1, true]} /><meshBasicMaterial color="#57e5ff" transparent opacity={xray ? .19 : .06} depthWrite={false} /></mesh></group>;
  if (component.primitive === 'light') return <LightBody component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'controller') return <ControlCabinet component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'conveyor') return <IndustrialConveyor component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'ramp') return <TransferChute component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'gripper') return <group><BoxBody size={[component.dimensions[0], component.dimensions[1], component.dimensions[2] * .35]} color={color} xray={xray} selected={selected} />{[-1, 1].map((side) => <mesh key={side} position={[component.dimensions[0] * .38, -.2, side * component.dimensions[2] * (.48 - actuatorValue * .18)]}><boxGeometry args={[component.dimensions[0] * .55, component.dimensions[1] * 1.6, component.dimensions[2] * .16]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>)}</group>;
  if (component.primitive === 'hook') return <mesh><torusGeometry args={[component.dimensions[0], component.dimensions[0] * .28, 12, 26, Math.PI * 1.55]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>;
  if (component.primitive === 'container' || component.primitive === 'counterweight') return <Crate component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'support') return <group><BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.055} /><group position={[0, -component.dimensions[1] * .5, 0]}><BoxBody size={[component.dimensions[0] * 1.35, Math.max(.08, component.dimensions[1] * .1), component.dimensions[2] * 1.35]} color="#35434a" xray={xray} selected={selected} /></group></group>;
  return <BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={component.primitive === 'beam' ? .035 : .05} />;
}

function CameraDirector({ center, radius, signature }: { center: Vec3; radius: number; signature: string }) {
  const { camera } = useThree();
  const [centerX, centerY, centerZ] = center;
  useEffect(() => {
    camera.position.set(centerX + radius * 1.15, centerY + radius * .78, centerZ + radius * 1.42);
    camera.lookAt(centerX, centerY, centerZ);
    camera.updateProjectionMatrix();
  }, [camera, centerX, centerY, centerZ, radius, signature]);
  return null;
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
  const lows = components.length ? [0, 1, 2].map((axis) => Math.min(...components.map((item) => item.position[axis] - item.dimensions[axis] / 2))) : [-2, 0, -2];
  const highs = components.length ? [0, 1, 2].map((axis) => Math.max(...components.map((item) => item.position[axis] + item.dimensions[axis] / 2))) : [2, 3, 2];
  const center = lows.map((value, axis) => (value + highs[axis]) / 2) as Vec3;
  const spans = lows.map((value, axis) => highs[axis] - value);
  const cameraRadius = Math.max(3.8, Math.min(13, Math.max(...spans) * 1.02));
  return <>
    <CameraDirector center={center} radius={cameraRadius} signature={`${state.designHash}-${preview ? 'preview' : 'world'}`} />
    <ambientLight intensity={.72} />
    <hemisphereLight color="#dff7ff" groundColor="#10161c" intensity={.7} />
    <directionalLight position={[6, 9, 5]} intensity={3.1} color="#e5faff" castShadow />
    <pointLight position={[-4, 4, -3]} intensity={24} color="#2bd9ff" distance={12} />
    <pointLight position={[4, 3, 4]} intensity={18} color="#ff9c45" distance={11} />
    {components.map((component) => {
      const bicycleMotion = Boolean(component.parameters.bicycle_wheel || component.parameters.bicycle_sprocket);
      const replaySafe = state.replayMode === 'failure' || bicycleMotion || Boolean(component.parameters.cad_form) || (state.goal?.capabilities.includes('transmit') && ['gear', 'shaft'].includes(component.primitive));
      const replay = replaySafe ? frame?.items.find((item) => item.id === component.id) : undefined;
      const targetJoint = joints.find((item) => item.componentB === component.id);
      const actuator = state.actuators.find((item) => item.jointId === targetJoint?.id);
      const actuatorValue = actuator ? frame?.actuatorValues[actuator.id] ?? .55 : .55;
      const selected = state.selectedComponentId === component.id;
      const enabled = !preview && state.phase !== 'simulating' && (selected || component.id === state.goal?.editableComponentId);
      return <EditableBody key={component.id} component={component} xray={state.xray} selected={selected} actuatorValue={actuatorValue} enabled={enabled} replay={replay} onMove={onComponentMove} onSelect={() => onSelect(component.id)} />;
    })}
    {frame?.items.filter((item) => item.id === 'test-payload' || item.id.startsWith('sort-package-')).map((item) => <ReplayPackage key={item.id} item={item} xray={state.xray} />)}
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
    <OrbitControls makeDefault enablePan minDistance={2.5} maxDistance={30} minPolarAngle={.22} maxPolarAngle={1.5} target={center} />
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
  const replayFrame = frame;
  return <div className="canvas-wrap"><Canvas aria-label={props.preview ? undefined : label} aria-hidden={props.preview || undefined} role={props.preview ? undefined : 'img'} tabIndex={-1} shadows="basic" dpr={[1, 1.5]} camera={{ position: [8.4, 6.4, 10.6], fov: 42 }} gl={{ antialias: true }} onPointerMissed={() => props.onSelect('')}><color attach="background" args={['#080c10']} /><fog attach="fog" args={['#080c10', 12, 28]} /><Suspense fallback={null}><Machine {...props} frame={replayFrame} /></Suspense></Canvas>{!props.preview && <div className="sr-only">{run ? `${run.status} multi-body simulation ${props.state.replayMode === 'failure' ? 'failure replay' : 'result'} is active.` : `${props.state.components.length} physical bodies and ${props.state.joints.length} joints are visible.`}</div>}</div>;
}
