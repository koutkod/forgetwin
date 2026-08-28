import axe from 'axe-core';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgeTwinApp } from '../app/forgetwin-app';
import { createInitialForgeState } from './forge-data';
import { STORAGE_KEY } from './use-forge';

vi.mock('../components/forge/forge-scene', () => ({
  ForgeScene: () => <div role="img" aria-label="3D general-purpose mechanical engineering world" />,
}));

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('ForgeTwin accessible world editor shell', () => {
  it('has no automated critical accessibility violations on the landing page', async () => {
    const { container, getByRole } = render(<ForgeTwinApp />);
    await waitFor(() => expect(getByRole('heading', { name: /don’t generate it/i })).toBeTruthy());
    const report = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(report.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });

  it('exposes named primary controls and the 3D world alternative', async () => {
    const { getByRole } = render(<ForgeTwinApp />);
    await waitFor(() => expect(getByRole('button', { name: 'Engineer from scratch' })).toBeTruthy());
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
    const { getByRole, findByText } = render(<ForgeTwinApp />);
    await waitFor(() => expect(getByRole('button', { name: 'Engineer from scratch' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Engineer from scratch' }));
    expect(await findByText('Generated + physics verified', {}, { timeout: 20_000 })).toBeTruthy();
    expect(getByRole('button', { name: 'Compare' })).toBeTruthy();
    expect(getByRole('button', { name: 'Select editable body' })).toBeTruthy();
  }, 25_000);
});
