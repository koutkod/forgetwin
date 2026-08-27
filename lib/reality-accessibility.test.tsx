// @vitest-environment jsdom
import axe from 'axe-core';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RealityApp } from '../app/reality-app';

describe('RealityOS application shell accessibility', () => {
  it('has no serious or critical axe violations', async () => {
    const { container } = render(<RealityApp />);
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    const serious = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
    expect(serious).toEqual([]);
  });
});
