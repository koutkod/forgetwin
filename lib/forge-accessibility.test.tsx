import axe from 'axe-core';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgeTwinApp } from '../app/forgetwin-app';
import { createInitialForgeState } from './forge-data';

vi.mock('../components/forge/forge-scene', () => ({
  ForgeScene: () => <div role="img" aria-label="Interactive 3D color-sorting machine" />,
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ForgeTwin accessibility shell', () => {
  it('has no automated critical accessibility violations on the landing page', async () => {
    const { container, getByRole } = render(<ForgeTwinApp />);
    await waitFor(() => expect(getByRole('heading', { name: /don’t generate it/i })).toBeTruthy());
    const report = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(report.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
  });

  it('exposes named primary controls and the 3D scene alternative', async () => {
    const { getByRole } = render(<ForgeTwinApp />);
    await waitFor(() => expect(getByRole('button', { name: 'Generate everything' })).toBeTruthy());
    expect(getByRole('button', { name: 'Open workspace' })).toBeTruthy();
    expect(getByRole('button', { name: 'Explore empty lab' })).toBeTruthy();
    expect(getByRole('textbox', { name: 'What should ForgeTwin engineer?' })).toBeTruthy();
    expect(getByRole('img', { name: 'Interactive 3D color-sorting machine' })).toBeTruthy();
  });

  it('moves focus into analysis drawers, closes on Escape, and restores focus', async () => {
    window.localStorage.setItem('forgetwin-workspace-v1', JSON.stringify(createInitialForgeState('lab')));
    const { getByRole, queryByRole } = render(<ForgeTwinApp />);
    const telemetry = await waitFor(() => getByRole('button', { name: 'Telemetry' }));
    telemetry.focus();
    fireEvent.click(telemetry);
    const close = await waitFor(() => getByRole('button', { name: 'Close panel' }));
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(telemetry);
  });
});
