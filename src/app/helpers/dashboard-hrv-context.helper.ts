import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { HEALTH_METRIC_IDS, type HealthRangeResult } from '@shared/health';
import type { SleepSession } from '@shared/sleep';
import type { AppDashboardSleepTrendRange } from '../models/app-user.interface';
import {
  buildHealthHrvPersonalRangeStatus, buildHealthMetricWorkspaceView, formatHealthValue,
  localCalendarDate, resolveHealthWorkspaceWindow, type HealthWorkspaceSeries,
} from './health-workspace.helper';
import {
  buildHealthChartModels, buildHealthHrvChartStatusOverlay, healthHrvChartStatusDescription,
} from './health-metric-chart.helper';

const DAY_MS = 86_400_000;

/** Match Health's calendar windows, with a separate 60-day baseline query so 1y stays within read limits. */
export function dashboardHrvWindows(range: AppDashboardSleepTrendRange = '14d', endMs = Date.now()) {
  const visible = resolveHealthWorkspaceWindow({ metric: HEALTH_METRIC_IDS.HeartRateVariability, range, endDate: localCalendarDate(endMs) });
  const startDayMs = Date.parse(visible.startDate);
  const history = {
    startDate: new Date(startDayMs - 60 * DAY_MS).toISOString().slice(0, 10),
    endDate: new Date(startDayMs - DAY_MS).toISOString().slice(0, 10),
  };
  const historyStartMs = resolveHealthWorkspaceWindow({ metric: HEALTH_METRIC_IDS.HeartRateVariability, range: 'today', endDate: history.startDate }).startTimeMs;
  return { visible, history, historyStartMs };
}

/** Use the same normalized sources, personal-range calculation and chart models as Health. */
export function buildDashboardHrvContext(
  visibleResult: HealthRangeResult,
  historyResult: HealthRangeResult,
  sessions: readonly SleepSession[],
  window: ReturnType<typeof dashboardHrvWindows>['visible'],
  unitSettings: UserUnitSettingsInterface | null = null,
) {
  const visibleSeries = buildHealthMetricWorkspaceView(visibleResult, sessions, [], unitSettings).series;
  const historySeries = buildHealthMetricWorkspaceView(historyResult, sessions, [], unitSettings).series;
  const historyById = new Map(historySeries.map(series => [series.id, series]));
  const charts = buildHealthChartModels(visibleSeries, window.startTimeMs, window.endTimeMs, unitSettings).map(model => {
    const history = historyById.get(model.series.id);
    const points = new Map<string, HealthWorkspaceSeries['points'][number]>();
    for (const point of [...(history?.points || []), ...model.series.points]) points.set(`${point.timestampMs}:${point.calendarDate}`, point);
    const fullSeries = { ...model.series, points: [...points.values()].sort((a, b) => a.timestampMs - b.timestampMs) };
    const status = buildHealthHrvPersonalRangeStatus(fullSeries, window.endTimeMs, unitSettings,
      model.series.points.map(point => point.timestampMs), window.startTimeMs);
    const latest = model.series.points.at(-1);
    return {
      model, status, key: model.series.sourceSelectionKey || model.series.id,
      latestValueText: latest ? formatHealthValue(model.series.metricId, latest.value, model.series.unit, model.series.nativeOnly, unitSettings) : '—',
      statusOverlay: buildHealthHrvChartStatusOverlay(status),
      statusDescription: healthHrvChartStatusDescription(status),
    };
  });
  return { charts, window, loading: false, error: false };
}

export type DashboardHrvContext = ReturnType<typeof buildDashboardHrvContext>;
