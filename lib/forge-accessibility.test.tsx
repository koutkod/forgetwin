import axe from 'axe-core';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgeTwinApp } from '../app/forgetwin-app';

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
    await waitFor(() => expect(getByRole('button', { name: 'Watch the AI engineer' })).toBeTruthy());
    expect(getByRole('button', { name: 'Open workspace' })).toBeTruthy();
    expect(getByRole('button', { name: 'Explore the lab' })).toBeTruthy();
    expect(getByRole('img', { name: 'Interactive 3D color-sorting machine' })).toBeTruthy();
  });
});
