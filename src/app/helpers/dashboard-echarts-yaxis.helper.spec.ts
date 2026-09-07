import { describe, expect, it } from 'vitest';

import { buildDashboardValueAxisConfig } from './dashboard-echarts-yaxis.helper';

describe('dashboard-echarts-yaxis.helper', () => {
  it('fits a positive trend without changing the default baseline policy', () => {
    const values = [1.82, 1.85, 1.83, 1.88, 1.91, 1.94, 1.92, 1.96];
    const fitted = buildDashboardValueAxisConfig(values, { rangeMode: 'data' });
    expect(fitted.min).toBeGreaterThan(1.7);
    expect(fitted.min).toBeLessThan(1.82);
    expect(fitted.max).toBeGreaterThan(1.96);
    expect(fitted.max).toBeLessThan(2.1);
    expect(fitted.interval).toBeGreaterThan(0);
    expect(buildDashboardValueAxisConfig(values).min).toBe(0);
    expect(values).toEqual([1.82, 1.85, 1.83, 1.88, 1.91, 1.94, 1.92, 1.96]);
  });

  it.each([[1.92], [1.92, 1.92], [0, 0], [-1.92, -1.92], [-2, -1], [-1, 1]])(
    'keeps a valid fitted range for %j', (...values) => {
      const config = buildDashboardValueAxisConfig(values, { rangeMode: 'data' });
      expect(config.min).toBeLessThanOrEqual(Math.min(...values));
      expect(config.max).toBeGreaterThan(Math.max(...values));
      expect(config.max).toBeGreaterThan(config.min);
      expect(config.interval).toBeGreaterThan(0);
    },
  );

  it('handles empty and non-finite trend values', () => {
    expect(buildDashboardValueAxisConfig([NaN, Infinity], { rangeMode: 'data' })).toEqual({ min: 0, max: 1, interval: 1 });
    expect(buildDashboardValueAxisConfig([], { rangeMode: 'data' })).toEqual({ min: 0, max: 1, interval: 1 });
    expect(buildDashboardValueAxisConfig([NaN, 1.82, 1.96, Infinity], { rangeMode: 'data' }))
      .toEqual(buildDashboardValueAxisConfig([1.82, 1.96], { rangeMode: 'data' }));
  });

  it('does not add negative padding to a non-negative fitted series', () => {
    expect(buildDashboardValueAxisConfig([0, 0.02], { rangeMode: 'data' }).min).toBe(0);
  });

  it.each(['default', 'data'] as const)('preserves a positive interval for very small values in %s mode', rangeMode => {
    const config = buildDashboardValueAxisConfig([0.0000001, 0.0000002], { rangeMode });
    expect(config.interval).toBeGreaterThan(0);
    expect(config.min).toBeLessThanOrEqual(0.0000001);
    expect(config.max).toBeGreaterThanOrEqual(0.0000002);
    expect(config.max).toBeGreaterThan(config.min);
  });

  it('does not collapse a closely clustered ratio range during rounding', () => {
    const config = buildDashboardValueAxisConfig([1.8200001, 1.8200002], { rangeMode: 'data' });
    expect(config.min).toBeLessThanOrEqual(1.8200001);
    expect(config.max).toBeGreaterThanOrEqual(1.8200002);
    expect(config.max).toBeGreaterThan(config.min);
    expect(config.interval).toBeGreaterThan(0);
  });

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
