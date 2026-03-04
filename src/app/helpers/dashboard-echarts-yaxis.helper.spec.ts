import { describe, expect, it } from 'vitest';

import { buildDashboardValueAxisConfig } from './dashboard-echarts-yaxis.helper';

describe('dashboard-echarts-yaxis.helper', () => {
  it('snaps padded positive ranges to logical grid lines', () => {
    const config = buildDashboardValueAxisConfig([30, 60, 90, 100]);

    expect(config.min).toBe(0);
    expect(config.max).toBe(120);
    expect(config.interval).toBe(20);
  });

  it('keeps negative values while snapping to clean intervals', () => {
    const config = buildDashboardValueAxisConfig([-20, 10, 40]);

    expect(config.min).toBeLessThanOrEqual(-20);
    expect(config.max).toBeGreaterThanOrEqual(40);
    expect(config.interval).toBeGreaterThan(0);
  });

  it('builds a safe range for single-value series', () => {
    const config = buildDashboardValueAxisConfig([42]);

    expect(config.min).toBeLessThan(42);
    expect(config.max).toBeGreaterThan(42);
    expect(config.interval).toBeGreaterThan(0);
  });
});
