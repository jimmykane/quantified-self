import { describe, expect, it } from 'vitest';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { projectHealthRange } from '@shared/health-query';
import { SLEEP_PROVIDERS, type SleepSession } from '@shared/sleep';
import { buildDashboardHrvContext, dashboardHrvWindows } from './dashboard-hrv-context.helper';
import { buildHealthHrvPersonalRangeStatus, buildHealthMetricWorkspaceView } from './health-workspace.helper';
import { buildHealthHrvChartStatusOverlay } from './health-metric-chart.helper';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';

const end = new Date(2026, 8, 10, 12).getTime();
const windows = dashboardHrvWindows('14d', end);
const result = (startDate: string, endDate: string) => projectHealthRange([], [], { startDate, endDate, metricIds: [HEALTH_METRIC_IDS.HeartRateVariability], includeSamples: false });
export const exampleHrvSessions = (days = 74): SleepSession[] => Array.from({ length: days }, (_, i) => {
  const endTimeMs = end - i * 86400000;
  return { id: `example-${i}`, userID: 'example-owner', source: { provider: SLEEP_PROVIDERS.SuuntoApp, providerUserId: 'example', sourceSessionKey: `night-${i}` },
    sleepDate: new Date(endTimeMs).toISOString().slice(0, 10), startTimeMs: endTimeMs - 8 * 3600000, endTimeMs,
    durationSeconds: 8 * 3600, isNap: false, stages: [], stageDurationsSeconds: {}, vitals: { averageHrvMs: 40 + i % 11 }, createdAtMs: endTimeMs, updatedAtMs: endTimeMs };
});

describe('dashboard Health HRV context', () => {
  it.each([null, normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })])('uses exactly Health’s source model, historical range and canonical display (%s)', units => {
    const sessions = exampleHrvSessions();
    const visible = result(windows.visible.startDate, windows.visible.endDate);
    const history = result(windows.history.startDate, windows.history.endDate);
    const context = buildDashboardHrvContext(visible, history, sessions, windows.visible, units);
    const full = buildHealthMetricWorkspaceView(result(windows.history.startDate, windows.visible.endDate), sessions, [], units).series[0];
    const status = buildHealthHrvPersonalRangeStatus(full, windows.visible.endTimeMs, units, context.charts[0].model.series.points.map(p => p.timestampMs), windows.visible.startTimeMs);
    expect(context.charts[0].model.displayedPointCount).toBe(14);
    expect(context.charts[0].status).toEqual(status);
    expect(context.charts[0].statusOverlay).toEqual(buildHealthHrvChartStatusOverlay(status));
    expect(context.charts[0].status?.normalRange).not.toBeNull();
    expect(context.charts[0].latestValueText).toBe('40 ms');
  });
  it('keeps sources separate and excludes naps and missing HRV', () => {
    const sessions = exampleHrvSessions(2);
    sessions.push({ ...sessions[0], id: 'garmin', source: { ...sessions[0].source, provider: SLEEP_PROVIDERS.GarminAPI }, vitals: { averageHrvMs: 100 } });
    sessions.push({ ...sessions[0], id: 'nap', isNap: true, vitals: { averageHrvMs: 200 } });
    sessions.push({ ...sessions[0], id: 'missing', vitals: {} });
    const context = buildDashboardHrvContext(result(windows.visible.startDate, windows.visible.endDate), result(windows.history.startDate, windows.history.endDate), sessions, windows.visible);
    expect(context.charts).toHaveLength(2);
    expect(context.charts.map(c => c.model.series.points.length).sort()).toEqual([1,2]);
    expect(context.charts.every(c => c.status?.label === 'Building personal range')).toBe(true);
  });
  it('keeps the 1-year query bounded and supplies 60 earlier calendar days', () => {
    const value = dashboardHrvWindows('1y', end);
    expect(() => result(value.visible.startDate, value.visible.endDate)).not.toThrow();
    expect((Date.parse(value.visible.startDate) - Date.parse(value.history.startDate)) / 86400000).toBe(60);
  });
});
