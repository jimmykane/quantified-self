import { describe, expect, it } from 'vitest';
import { buildDashboardFormValueAxes, type DashboardFormAxisPoint } from './dashboard-form-y-axis.helper';

describe('Form chart visible value axes', () => {
  const points: DashboardFormAxisPoint[] = [
    { time: 0, ctl: 900, atl: 1400, form: -500 },
    { time: 1, ctl: 90, atl: 100, form: -10 },
    { time: 2, ctl: 80, atl: 55, form: 25 },
    { time: 3, ctl: 76, atl: 51, form: 25 },
    { time: 4, ctl: 1200, atl: 700, form: 500 },
  ];

  it('ignores extremes before and after the displayed window without mutating history', () => {
    const original = structuredClone(points);
    const axes = buildDashboardFormValueAxes(points, 1, 3);
    expect(axes.load.min).toBe(0);
    expect(axes.load.max).toBeGreaterThanOrEqual(100);
    expect(axes.load.max).toBeLessThan(150);
    expect(axes.form.min).toBeLessThanOrEqual(-10);
    expect(axes.form.min).toBeGreaterThan(-30);
    expect(axes.form.max).toBeGreaterThanOrEqual(25);
    expect(axes.form.max).toBeLessThan(50);
    expect(points).toEqual(original);
    const full = buildDashboardFormValueAxes(points, 0, 4);
    expect(full.load.max).toBeGreaterThanOrEqual(1400);
    expect(full.form.min).toBeLessThanOrEqual(-500);
    expect(full.form.max).toBeGreaterThanOrEqual(500);
  });

  it('includes the visible part of a segment crossing each boundary, not its offscreen endpoints', () => {
    const axes = buildDashboardFormValueAxes([
      { time: 0, ctl: 1000, atl: 500, form: -500 },
      { time: 10, ctl: 0, atl: 0, form: 0 },
    ], 4, 6);
    expect(axes.load.max).toBeGreaterThanOrEqual(600);
    expect(axes.load.max).toBeLessThan(1000);
    expect(axes.form.min).toBeLessThanOrEqual(-300);
    expect(axes.form.min).toBeGreaterThan(-500);
  });

  it.each([25, -25, 0])('keeps the Form zero baseline for a single visible value %s', form => {
    const axes = buildDashboardFormValueAxes([{ time: 1, ctl: 76, atl: 51, form }], 1, 1);
    expect(axes.form.min).toBeLessThanOrEqual(Math.min(0, form));
    expect(axes.form.max).toBeGreaterThanOrEqual(Math.max(0, form));
    expect(axes.form.interval).toBeGreaterThan(0);
  });

  it('does not interpolate Form across a recorded gap', () => {
    const axes = buildDashboardFormValueAxes([
      { time: 0, ctl: 100, atl: 80, form: -500 },
      { time: 10, ctl: 90, atl: 75, form: null },
    ], 4, 6);
    expect(axes.form.min).toBe(0);
    expect(axes.form.max).toBeLessThanOrEqual(1);
  });

  it.each([[NaN, 3], [1, Infinity], [3, 1], [10, 20]])('keeps safe axes for an invalid or empty window %j', (min, max) => {
    const axes = buildDashboardFormValueAxes(points, min, max);
    for (const axis of [axes.load, axes.form]) {
      expect(Number.isFinite(axis.min)).toBe(true);
      expect(Number.isFinite(axis.max)).toBe(true);
      expect(axis.max).toBeGreaterThan(axis.min);
      expect(axis.interval).toBeGreaterThan(0);
    }
  });
});
