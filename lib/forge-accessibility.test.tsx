import axe from 'axe-core';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgeTwinApp } from '../app/forgetwin-app';
import { createInitialForgeState } from './forge-data';
import { STORAGE_KEY } from './use-forge';

vi.mock('../components/forge/forge-scene', () => ({
  ForgeScene: () => <div role="img" aria-label="3D general-purpose mechanical engineering world" />,
}));

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

describe('ForgeTwin accessible world editor shell', () => {
  it('has no automated critical accessibility violations on the landing page', async () => {
    const { container, getByRole } = render(<ForgeTwinApp />);
    await waitFor(() => expect(getByRole('heading', { name: /don’t generate it/i })).toBeTruthy());
    const report = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(report.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });

  it('exposes named primary controls and the 3D world alternative', async () => {
    const { getByRole } = render(<ForgeTwinApp />);
    await waitFor(() => expect(getByRole('button', { name: 'Engineer locally' })).toBeTruthy());
    expect(getByRole('button', { name: 'Open sandbox' })).toBeTruthy();
    expect(getByRole('button', { name: 'Explore empty world' })).toBeTruthy();
    expect(getByRole('textbox', { name: 'What should ForgeTwin engineer?' })).toBeTruthy();
    expect(getByRole('img', { name: '3D general-purpose mechanical engineering world' })).toBeTruthy();
  });

  it('moves focus into analysis drawers, closes on Escape, and restores focus', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(createInitialForgeState('lab')));
    const { getByRole, queryByRole } = render(<ForgeTwinApp />);
    const telemetry = await waitFor(() => getByRole('button', { name: 'Telemetry' }));
    telemetry.focus(); fireEvent.click(telemetry);
    const close = await waitFor(() => getByRole('button', { name: 'Close panel' }));
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(telemetry);
  });

  it('runs the complete prompt-to-world-to-optimized-machine UI flow', async () => {
    const { getByRole, findByRole, findByText } = render(<ForgeTwinApp />);
    await waitFor(() => expect(getByRole('button', { name: 'Engineer locally' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Engineer locally' }));
    expect(await findByRole('dialog', { name: /reading the engineering intent|architecture resolved|materializing the machine/i })).toBeTruthy();
    expect(await findByText('Generated + physics verified', {}, { timeout: 20_000 })).toBeTruthy();
    expect(getByRole('button', { name: 'Compare runs' })).toBeTruthy();
    expect(getByRole('button', { name: 'Select editable body' })).toBeTruthy();
  }, 25_000);

  it('routes a connected model decision into the guarded in-app agent loop', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (!init || init.method === 'GET') return new Response(JSON.stringify({ ok: true, configured: true, model: 'gpt-5.4-mini' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(String(init.body)) as { task: 'plan' | 'redesign' };
      if (body.task === 'plan') return new Response(JSON.stringify({ ok: true, mode: 'model', model: 'gpt-5.4-mini', result: {
        normalized_prompt: 'Build a crane that lifts a 200 kg beam by 3 meters and places it within 10 cm without tipping.',
        reasoning_summary: 'Use a wide supported base, mast, boom, hoist, counterweight, and position feedback.',
        architecture: ['supported base', 'boom and hoist', 'counterweight', 'feedback control'], assumptions: ['Concept-level indoor trial'],
        verification_focus: ['payload_capacity', 'lift_height', 'stability_margin', 'placement_error'],
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true, mode: 'model', model: 'gpt-5.4-mini', result: {
        diagnosis: 'The measured trial misses one or more force, stability, or placement constraints.',
        objective: 'Change only evidence-linked unlocked fields and rerun the same world.',
        tool_sequence: [
          { tool: 'inspect_telemetry', metric: '', objective: '' },
          { tool: 'inspect_failure', metric: '', objective: '' },
          { tool: 'measure_constraint', metric: '', objective: '' },
          { tool: 'optimize_design', metric: '', objective: 'Satisfy the measured constraints while preserving human locks.' },
          { tool: 'run_simulation', metric: '', objective: '' },
        ],
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const { getByRole, findByText, findAllByText } = render(<ForgeTwinApp />);
    await waitFor(() => expect(getByRole('button', { name: 'Engineer with AI' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Engineer with AI' }));
    expect(await findByText('Engineering mission complete', {}, { timeout: 20_000 })).toBeTruthy();
    expect((await findAllByText(/Model agent · gpt-5.4-mini/i)).length).toBeGreaterThan(0);
  }, 25_000);
});
