'use client';

import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { ForgeState, MachineComponent } from './forge-types';

export type ForgeExportFormat = 'png' | 'jpg' | 'pdf' | 'stl' | 'json';

const safeName = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64) || 'forgetwin-design';

const fileBase = (state: ForgeState) => `${safeName(state.goal?.machineName ?? 'forgetwin-design')}-rev-${state.revision}`;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function sceneCanvas() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-forgetwin-scene] canvas');
  if (!canvas || canvas.width < 2 || canvas.height < 2) throw new Error('The 3D viewport is not ready to export yet.');
  return canvas;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

/** Creates a clean, judge-ready 3:2 image while preserving the live camera view. */
export function renderSceneImage(state: ForgeState) {
  const source = sceneCanvas();
  const output = document.createElement('canvas');
  output.width = 1800;
  output.height = 1200;
  const context = output.getContext('2d');
  if (!context) throw new Error('This browser cannot create an export canvas.');

  context.fillStyle = '#070b0f';
  context.fillRect(0, 0, output.width, output.height);
  const sourceRatio = source.width / source.height;
  const targetRatio = output.width / output.height;
  let sx = 0, sy = 0, sw = source.width, sh = source.height;
  if (sourceRatio > targetRatio) { sw = source.height * targetRatio; sx = (source.width - sw) / 2; }
  else { sh = source.width / targetRatio; sy = (source.height - sh) / 2; }
  context.drawImage(source, sx, sy, sw, sh, 0, 0, output.width, output.height);

  const top = context.createLinearGradient(0, 0, 0, 280);
  top.addColorStop(0, 'rgba(3,7,10,.93)'); top.addColorStop(1, 'rgba(3,7,10,0)');
  context.fillStyle = top; context.fillRect(0, 0, output.width, 300);
  const bottom = context.createLinearGradient(0, 850, 0, 1200);
  bottom.addColorStop(0, 'rgba(3,7,10,0)'); bottom.addColorStop(1, 'rgba(3,7,10,.94)');
  context.fillStyle = bottom; context.fillRect(0, 830, output.width, 370);

  context.fillStyle = '#52ddfa';
  context.font = '700 24px Arial, sans-serif';
  context.fillText('FORGETWIN  /  ENGINEERED WORLD', 72, 74);
  context.fillStyle = '#f2f7f8';
  context.font = '700 54px Arial, sans-serif';
  context.fillText(state.goal?.machineName ?? 'Untitled mechanism', 72, 142, 1320);
  context.fillStyle = '#9ba9b0';
  context.font = '400 23px Arial, sans-serif';
  context.fillText(`${state.goal?.domain ?? 'Mechanical engineering'}  ·  Revision ${state.revision}`, 74, 188);

  const latest = state.runs.at(-1);
  const cards = [
    ['PHYSICS', latest ? `${latest.physics.engine} · ${latest.physics.timestepHz} Hz` : 'Not run'],
    ['WORLD', `${state.components.length} bodies · ${state.joints.length} joints`],
    ['MASS', `${latest?.metrics.totalMass ?? state.components.reduce((sum, item) => sum + item.mass, 0).toFixed(1)} kg`],
    ['CONSTRAINTS', latest ? `${latest.metrics.score}% · ${latest.status.toUpperCase()}` : state.phase.toUpperCase()],
  ];
  cards.forEach(([label, value], index) => {
    const x = 72 + index * 414;
    context.fillStyle = 'rgba(8,15,20,.84)'; roundedRect(context, x, 1035, 385, 104, 14);
    context.fillStyle = '#6e7d85'; context.font = '700 17px Arial, sans-serif'; context.fillText(label, x + 22, 1071);
    context.fillStyle = '#e7eef0'; context.font = '600 23px Arial, sans-serif'; context.fillText(value, x + 22, 1112, 342);
  });
  return output;
}

function canvasBlob(canvas: HTMLCanvasElement, mime: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode the image.')),
    mime,
    quality,
  ));
}

function geometryFor(component: MachineComponent): BufferGeometry {
  const [x, y, z] = component.dimensions.map((value) => Math.max(.01, value));
  if (component.shape === 'sphere') {
    const geometry = new SphereGeometry(.5, 28, 18);
    geometry.scale(x, y, z);
    return geometry;
  }
  if (component.shape === 'capsule') {
    const radius = Math.max(.01, Math.min(x, z) / 2);
    const geometry = new CapsuleGeometry(radius, Math.max(.01, y - radius * 2), 8, 18);
    geometry.scale(x / (radius * 2), 1, z / (radius * 2));
    return geometry;
  }
  if (component.shape === 'cylinder' || ['wheel', 'gear', 'pulley', 'roller', 'shaft', 'motor'].includes(component.primitive)) {
    const radius = Math.max(.01, Math.max(x, z) / 2);
    const geometry = new CylinderGeometry(radius, radius, y, 36);
    if (['wheel', 'gear', 'pulley', 'roller'].includes(component.primitive)) geometry.applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2));
    return geometry;
  }
  return new BoxGeometry(x, y, z, 1, 1, 1);
}

/** A standards-compliant ASCII STL mesh that mainstream mechanical CAD tools can import. */
export function buildAsciiStl(state: ForgeState) {
  if (!state.components.length) throw new Error('Add at least one physical body before exporting CAD geometry.');
  const group = new Group();
  for (const component of state.components) {
    const mesh = new Mesh(geometryFor(component), new MeshStandardMaterial());
    mesh.name = component.id;
    mesh.position.set(...component.position);
    mesh.rotation.copy(new Euler(...component.rotation, 'XYZ'));
    mesh.updateMatrixWorld(true);
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  const result = new STLExporter().parse(group, { binary: false });
  group.traverse((object) => {
    if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshStandardMaterial).dispose(); }
  });
  return result;
}

async function exportPdf(state: ForgeState) {
  const { jsPDF } = await import('jspdf');
  const image = renderSceneImage(state).toDataURL('image/jpeg', .94);
  const document = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const latest = state.runs.at(-1);
  const dark = [7, 11, 15] as const;
  const cyan = [75, 219, 247] as const;

  document.setFillColor(...dark); document.rect(0, 0, 297, 210, 'F');
  document.setTextColor(...cyan); document.setFont('helvetica', 'bold'); document.setFontSize(8); document.text('FORGETWIN  /  ENGINEERING REPORT', 14, 13);
  document.setTextColor(242, 247, 248); document.setFontSize(22); document.text(state.goal?.machineName ?? 'Untitled mechanism', 14, 26, { maxWidth: 250 });
  document.setTextColor(139, 154, 162); document.setFont('helvetica', 'normal'); document.setFontSize(8); document.text(`${state.goal?.domain ?? 'Mechanical engineering'}  |  Revision ${state.revision}  |  ${new Date().toLocaleString()}`, 14, 33);
  document.addImage(image, 'JPEG', 14, 40, 176, 117, undefined, 'FAST');

  document.setFillColor(13, 20, 26); document.roundedRect(198, 40, 85, 117, 2, 2, 'F');
  document.setTextColor(...cyan); document.setFont('helvetica', 'bold'); document.setFontSize(8); document.text('DESIGN EVIDENCE', 205, 51);
  const evidence = [
    ['Bodies', String(state.components.length)], ['Joints', String(state.joints.length)],
    ['Total mass', `${latest?.metrics.totalMass ?? state.components.reduce((sum, item) => sum + item.mass, 0).toFixed(1)} kg`],
    ['Physics', latest ? `${latest.physics.engine} at ${latest.physics.timestepHz} Hz` : 'Not run'],
    ['Constraint score', latest ? `${latest.metrics.score}%` : 'Not measured'],
    ['Status', (latest?.status ?? state.phase).toUpperCase()],
  ];
  evidence.forEach(([label, value], index) => {
    const y = 62 + index * 14;
    document.setTextColor(112, 127, 136); document.setFontSize(7); document.text(label.toUpperCase(), 205, y);
    document.setTextColor(230, 238, 241); document.setFontSize(10); document.text(value, 205, y + 5);
  });
  document.setTextColor(107, 121, 129); document.setFontSize(7); document.text('GOAL', 14, 169);
  document.setTextColor(214, 224, 228); document.setFontSize(9); document.text(state.goal?.brief ?? 'No design goal recorded.', 14, 176, { maxWidth: 269 });
  document.setTextColor(79, 93, 101); document.setFontSize(6.5); document.text('Concept-level digital twin. Validate geometry, tolerances, materials, loads, and safety factors before fabrication.', 14, 200);
  document.text('Page 1 / Engineering summary', 246, 200);

  const components = state.components;
  const pageSize = 21;
  for (let offset = 0; offset < components.length; offset += pageSize) {
    document.addPage('a4', 'landscape');
    document.setFillColor(248, 250, 251); document.rect(0, 0, 297, 210, 'F');
    document.setTextColor(16, 25, 31); document.setFont('helvetica', 'bold'); document.setFontSize(16); document.text('Bill of materials and geometry', 14, 18);
    document.setTextColor(100, 113, 121); document.setFontSize(7); document.text(`${state.goal?.machineName ?? 'Untitled mechanism'}  |  dimensions in meters`, 14, 25);
    const headers = ['BODY / ROLE', 'PRIMITIVE', 'DIMENSIONS', 'MATERIAL', 'MASS', 'MODE'];
    const columns = [14, 113, 147, 199, 237, 261];
    document.setFillColor(20, 31, 38); document.rect(12, 32, 273, 9, 'F');
    document.setTextColor(211, 223, 228); document.setFontSize(6.5); headers.forEach((header, index) => document.text(header, columns[index], 38));
    components.slice(offset, offset + pageSize).forEach((component, index) => {
      const y = 48 + index * 7.1;
      if (index % 2) { document.setFillColor(238, 243, 245); document.rect(12, y - 4.6, 273, 7, 'F'); }
      document.setTextColor(31, 45, 52); document.setFont('helvetica', 'normal'); document.setFontSize(6.2);
      document.text(component.role, columns[0], y, { maxWidth: 94 });
      document.text(component.primitive, columns[1], y);
      document.text(component.dimensions.map((value) => value.toFixed(3)).join(' x '), columns[2], y);
      document.text(component.materialId, columns[3], y);
      document.text(`${component.mass.toFixed(2)} kg`, columns[4], y);
      document.text(component.bodyType, columns[5], y);
    });
    document.setTextColor(120, 132, 139); document.setFontSize(6.5); document.text(`Revision ${state.revision}  |  ${offset + 1}-${Math.min(offset + pageSize, components.length)} of ${components.length} bodies`, 14, 200);
    document.text(`Page ${document.getNumberOfPages()} / Bill of materials`, 247, 200);
  }
  document.save(`${fileBase(state)}-engineering-report.pdf`);
}

export async function exportForgeDesign(state: ForgeState, format: ForgeExportFormat) {
  const base = fileBase(state);
  if (format === 'png' || format === 'jpg') {
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    download(await canvasBlob(renderSceneImage(state), mime, format === 'jpg' ? .94 : undefined), `${base}.${format}`);
    return;
  }
  if (format === 'pdf') { await exportPdf(state); return; }
  if (format === 'stl') {
    download(new Blob([buildAsciiStl(state)], { type: 'model/stl' }), `${base}-cad-assembly.stl`);
    return;
  }
  const payload = {
    format: 'ForgeTwin Mechanical World', version: 1, exportedAt: new Date().toISOString(),
    goal: state.goal, world: state.world, assemblies: state.assemblies, components: state.components,
    joints: state.joints, connections: state.connections, motors: state.motors, sensors: state.sensors,
    actuators: state.actuators, controls: state.controls, latestRun: state.runs.at(-1) ?? null,
  };
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${base}-engineering-data.json`);
}
