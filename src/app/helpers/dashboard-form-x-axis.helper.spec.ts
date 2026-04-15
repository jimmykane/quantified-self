import { describe, expect, it } from 'vitest';
import {
  formatDashboardFormXAxisLabel,
  resolveDashboardFormXAxisLabelConfig,
  resolveDashboardFormXAxisLabelInterval,
  resolveDashboardFormXAxisMinIntervalMs,
  resolveDashboardFormXAxisLabelMode,
  resolveDashboardFormXAxisSplitNumber,
} from './dashboard-form-x-axis.helper';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('dashboard-form-x-axis.helper', () => {
  it('resolves yearly labels for wide visible spans', () => {
    const mode = resolveDashboardFormXAxisLabelMode(2 * 365 * DAY_MS);
    expect(mode).toBe('yearly');
  });

  it('resolves monthly labels for medium visible spans', () => {
    const mode = resolveDashboardFormXAxisLabelMode(300 * DAY_MS);
    expect(mode).toBe('monthly');
  });

  it('resolves daily labels for narrow visible spans', () => {
    const mode = resolveDashboardFormXAxisLabelMode(60 * DAY_MS);
    expect(mode).toBe('daily');
  });

  it('returns compact intervals for each label mode', () => {
    expect(resolveDashboardFormXAxisLabelInterval(80, 'yearly')).toBeGreaterThan(0);
    expect(resolveDashboardFormXAxisLabelInterval(35, 'monthly')).toBeGreaterThan(0);
    expect(resolveDashboardFormXAxisLabelInterval(20, 'daily')).toBeGreaterThan(0);
    expect(resolveDashboardFormXAxisLabelInterval(6, 'daily')).toBe(0);
    expect(resolveDashboardFormXAxisSplitNumber(80, 'yearly')).toBeGreaterThanOrEqual(2);
    expect(resolveDashboardFormXAxisSplitNumber(80, 'yearly')).toBeLessThanOrEqual(9);
    expect(resolveDashboardFormXAxisMinIntervalMs('yearly')).toBe(365 * DAY_MS);
    expect(resolveDashboardFormXAxisMinIntervalMs('monthly')).toBe(28 * DAY_MS);
    expect(resolveDashboardFormXAxisMinIntervalMs('daily')).toBe(7 * DAY_MS);
  });

  it('builds label config from visible range and points', () => {
    const config = resolveDashboardFormXAxisLabelConfig(
      Date.UTC(2024, 0, 1),
      Date.UTC(2027, 0, 1),
      200,
    );

    expect(config.mode).toBe('yearly');
    expect(config.minIntervalMs).toBe(365 * DAY_MS);
    expect(config.splitNumber).toBeGreaterThanOrEqual(2);
  });

  it('formats labels according to selected mode', () => {
    const timeMs = Date.UTC(2026, 2, 15);
    const yearlyLabel = formatDashboardFormXAxisLabel(timeMs, 'yearly');
    const monthlyLabel = formatDashboardFormXAxisLabel(timeMs, 'monthly');
    const dailyLabel = formatDashboardFormXAxisLabel(timeMs, 'daily');

    expect(yearlyLabel).toMatch(/2026/);
    expect(monthlyLabel).toMatch(/[A-Za-z]{3}/);
    expect(dailyLabel).toMatch(/[0-9]{2}/);
  });
});
