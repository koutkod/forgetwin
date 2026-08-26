import { cleanup, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import TwinPage from '../app/twin/city-of-arbor-creek-energy-report/twin-page';
import { INITIAL_PROJECT_STATE } from './project-state';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('A11yRelay output accessibility', () => {
  it('has no serious or critical axe findings in the published twin', async () => {
    localStorage.setItem('a11yrelay-demo-state-v1', JSON.stringify({
      ...INITIAL_PROJECT_STATE,
      verifiedVersion: 1,
      publishedVersion: 1,
      humanContext: {'chart-alt':'Energy consumption decreased 17% compared with last year.'},
    }));
    render(<TwinPage />);
    await waitFor(() => expect(screen.getByRole('heading',{name:'A healthier city uses less energy.'})).toBeTruthy());
    const result = await axe.run(document.body,{rules:{'color-contrast':{enabled:false}}});
    const severe = result.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
    expect(severe.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
