import { describe, it, expect } from 'vitest';
import { defaultDashboardTodaySettings, normalizeDashboardTodaySettings, dashboardTodayDependencies, dashboardTodaySignalVisible } from './dashboard-today-settings.helper';

describe('Today configuration', () => {
  it('keeps legacy accounts intact while new-account defaults contain only the two large summaries and Load', () => {
    expect(normalizeDashboardTodaySettings(undefined)).toEqual({ version: 1, trainingState: true, readiness: true,
      recovery: true, suggestion: true, metrics: ['load', 'sleep', 'hrv', 'overnight-hr'] });
    expect(defaultDashboardTodaySettings()).toEqual({ version: 1, trainingState: true, readiness: true,
      recovery: false, suggestion: false, metrics: ['load'] });
  });
  it('preserves explicit empty selections, order and false flags, without duplicates or unknown IDs', () => {
    const settings = { ...defaultDashboardTodaySettings(), trainingState: false, readiness: false, metrics: ['weight', 'tss', 'weight', 'unknown'] };
    expect(normalizeDashboardTodaySettings(settings)).toMatchObject({ trainingState: false, readiness: false, metrics: ['weight', 'tss'] });
    expect(normalizeDashboardTodaySettings({ ...settings, metrics: [] }).metrics).toEqual([]);
    expect(settings.metrics).toHaveLength(4);
  });
  it('loads evidence for visible readiness despite hidden drivers, and skips it for measurement-only layouts', () => {
    expect(dashboardTodayDependencies(defaultDashboardTodaySettings())).toMatchObject({ load: true, sleep: true, recovery: false, activities: false });
    expect(dashboardTodayDependencies({ version: 1, trainingState: false, readiness: false, recovery: false, suggestion: false, metrics: ['weight', 'steps'] }))
      .toEqual({ load: false, sleep: false, recovery: false, activities: false, weight: true, steps: true });
    expect(dashboardTodayDependencies({ ...defaultDashboardTodaySettings(), metrics: ['tss', 'ascent'] }).activities).toBe(true);
  });
  it('keeps hidden drivers out of the greeting, independently of their calculation dependencies', () => {
    const settings = defaultDashboardTodaySettings();
    expect(dashboardTodaySignalVisible('readiness', settings)).toBe(true);
    expect(dashboardTodaySignalVisible('training-load', settings)).toBe(true);
    expect(dashboardTodaySignalVisible('hrv', settings)).toBe(false);
  });
});
