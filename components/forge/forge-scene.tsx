'use client';

import { ContactShadows, Edges, Grid, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber';
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

function Crate({ component, color, xray, selected }: { component: MachineComponent; color: string; xray: boolean; selected: boolean }) {
  const [x, y, z] = component.dimensions;
  return <group>
    <BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.035} metalness={component.materialId === 'polymer' ? .12 : .62} roughness={.48} />
    {!xray && <><mesh position={[0, 0, z * .505]}><boxGeometry args={[x * .9, y * .08, .018]} /><meshStandardMaterial color="#11191e" /></mesh><mesh position={[0, 0, -z * .505]}><boxGeometry args={[x * .9, y * .08, .018]} /><meshStandardMaterial color="#11191e" /></mesh>{component.parameters.rigged_load && <><mesh position={[x * .28, 0, 0]}><boxGeometry args={[.045, y * 1.05, z * 1.04]} /><meshStandardMaterial color="#d9a23d" metalness={.45} /></mesh><mesh position={[-x * .28, 0, 0]}><boxGeometry args={[.045, y * 1.05, z * 1.04]} /><meshStandardMaterial color="#d9a23d" metalness={.45} /></mesh></>}</>}
  </group>;
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

function ComponentShape({ component, xray, selected, actuatorValue }: { component: MachineComponent; xray: boolean; selected: boolean; actuatorValue: number }) {
  const color = component.humanLockedFields.length ? '#f2b85a' : component.color;
  if (component.parameters.bphe_plate) return <BrazedPlateLeaf component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.bphe_end_plate) return <BrazedEndPlate component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.fixture_plate) return <FixturePlate component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.heat_exchanger_core) return <HeatExchangerCore component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.hvac_pipe) return <CopperPipe component={component} color={color} xray={xray} selected={selected} />;
  if (component.parameters.fixture_clamp) return <FixtureClamp component={component} color={color} xray={xray} selected={selected} actuatorValue={actuatorValue} />;
  if (component.parameters.locating_pin) return <LocatingPin component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'gear') return <Gear component={{ ...component, color }} xray={xray} selected={selected} />;
  if (component.primitive === 'spring') return <Spring component={{ ...component, color }} xray={xray} selected={selected} />;
  if (component.primitive === 'frame') return <IndustrialFrame component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'wheel' || component.primitive === 'roller') return <Wheel component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'pulley') return <Pulley component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'motor' || component.primitive === 'servo') return <DriveBody component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'shaft') return <mesh castShadow><cylinderGeometry args={[component.dimensions[0] / 2, component.dimensions[0] / 2, component.dimensions[1], 24]} /><StandardMaterial color={color} xray={xray} selected={selected} /><Edges color={selected ? '#8bf0ff' : '#152029'} opacity={.32} transparent /></mesh>;
  if (component.primitive === 'piston') return <group><mesh><cylinderGeometry args={[component.dimensions[0] / 2, component.dimensions[0] / 2, component.dimensions[1], 22]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh><mesh position={[0, component.dimensions[1] * .45 * actuatorValue, 0]}><cylinderGeometry args={[component.dimensions[0] * .25, component.dimensions[0] * .25, component.dimensions[1] * .75, 18]} /><meshStandardMaterial color="#dce6ea" metalness={.86} wireframe={xray} /></mesh></group>;
  if (component.primitive === 'cable') {
    const start = [Number(component.parameters.start_x), Number(component.parameters.start_y), Number(component.parameters.start_z)] as Vec3;
    const end = [Number(component.parameters.end_x), Number(component.parameters.end_y), Number(component.parameters.end_z)] as Vec3;
    const hasPath = [...start, ...end].every(Number.isFinite);
    return hasPath ? <Line points={[start.map((value, index) => value - component.position[index]) as Vec3, end.map((value, index) => value - component.position[index]) as Vec3]} color={selected ? '#65e5ff' : color} lineWidth={Math.max(1.5, component.dimensions[0] * 38)} /> : <mesh><cylinderGeometry args={[Math.max(.015, component.dimensions[0]), Math.max(.015, component.dimensions[0]), component.dimensions[1], 10]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>;
  }
  if (component.primitive === 'sensor' || component.primitive === 'camera') return <group><BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} /><mesh position={[0, 0, component.dimensions[2] * 2.2]}><coneGeometry args={[component.dimensions[0] * 1.4, component.dimensions[2] * 3.2, 16, 1, true]} /><meshBasicMaterial color="#57e5ff" transparent opacity={xray ? .19 : .06} depthWrite={false} /></mesh></group>;
  if (component.primitive === 'conveyor') return <group><BoxBody size={component.dimensions} color="#26333a" xray={xray} selected={selected} radius={.03} />{[-.42, -.28, -.14, 0, .14, .28, .42].map((factor) => <mesh key={factor} position={[component.dimensions[0] * factor, component.dimensions[1] * .7, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.055, .055, component.dimensions[2] * .94, 16]} /><meshStandardMaterial color="#0d1418" metalness={.72} roughness={.32} /></mesh>)}<mesh position={[0, component.dimensions[1] * .72, component.dimensions[2] * .47]}><boxGeometry args={[component.dimensions[0], .07, .06]} /><meshStandardMaterial color="#7a8990" metalness={.75} /></mesh><mesh position={[0, component.dimensions[1] * .72, -component.dimensions[2] * .47]}><boxGeometry args={[component.dimensions[0], .07, .06]} /><meshStandardMaterial color="#7a8990" metalness={.75} /></mesh></group>;
  if (component.primitive === 'gripper') return <group><BoxBody size={[component.dimensions[0], component.dimensions[1], component.dimensions[2] * .35]} color={color} xray={xray} selected={selected} />{[-1, 1].map((side) => <mesh key={side} position={[component.dimensions[0] * .38, -.2, side * component.dimensions[2] * (.48 - actuatorValue * .18)]}><boxGeometry args={[component.dimensions[0] * .55, component.dimensions[1] * 1.6, component.dimensions[2] * .16]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>)}</group>;
  if (component.primitive === 'hook') return <mesh><torusGeometry args={[component.dimensions[0], component.dimensions[0] * .28, 12, 26, Math.PI * 1.55]} /><StandardMaterial color={color} xray={xray} selected={selected} /></mesh>;
  if (component.primitive === 'container' || component.primitive === 'counterweight') return <Crate component={component} color={color} xray={xray} selected={selected} />;
  if (component.primitive === 'support') return <group><BoxBody size={component.dimensions} color={color} xray={xray} selected={selected} radius={.055} /><group position={[0, -component.dimensions[1] * .5, 0]}><BoxBody size={[component.dimensions[0] * 1.35, Math.max(.08, component.dimensions[1] * .1), component.dimensions[2] * 1.35]} color="#35434a" xray={xray} selected={selected} /></group></group>;
  if (component.parameters.panel) return <group><BoxBody size={component.dimensions} color="#16384e" xray={xray} selected={selected} radius={.025} metalness={.35} roughness={.26} />{!xray && [-.3, -.1, .1, .3].map((factor) => <Line key={factor} points={[[component.dimensions[0] * factor, component.dimensions[1] * .52, -component.dimensions[2] * .48], [component.dimensions[0] * factor, component.dimensions[1] * .52, component.dimensions[2] * .48]]} color="#4d89a7" lineWidth={1} />)}</group>;
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
  const replayFrame = props.state.replayMode === 'failure' ? frame : null;
  return <div className="canvas-wrap"><Canvas aria-label={props.preview ? undefined : label} aria-hidden={props.preview || undefined} role={props.preview ? undefined : 'img'} tabIndex={-1} shadows="basic" dpr={[1, 1.5]} camera={{ position: [8.4, 6.4, 10.6], fov: 42 }} gl={{ antialias: true }} onPointerMissed={() => props.onSelect('')}><color attach="background" args={['#080c10']} /><fog attach="fog" args={['#080c10', 12, 28]} /><Suspense fallback={null}><Machine {...props} frame={replayFrame} /></Suspense></Canvas>{!props.preview && <div className="sr-only">{run ? `${run.status} multi-body simulation ${props.state.replayMode === 'failure' ? 'failure replay' : 'result'} is active.` : `${props.state.components.length} physical bodies and ${props.state.joints.length} joints are visible.`}</div>}</div>;
}
