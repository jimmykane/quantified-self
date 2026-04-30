import type { AppDashboardSleepTrendRange } from '../models/app-user.interface';

export const DASHBOARD_SLEEP_TREND_DEFAULT_RANGE: AppDashboardSleepTrendRange = '14d';

export const DASHBOARD_SLEEP_TREND_RANGE_OPTIONS: ReadonlyArray<{
  range: AppDashboardSleepTrendRange;
  label: string;
  days: number | null;
}> = [
  { range: '14d', label: '14d', days: 14 },
  { range: '30d', label: '30d', days: 30 },
  { range: '90d', label: '90d', days: 90 },
  { range: 'all', label: 'All', days: null },
];

export type DashboardSleepTrendNavigationDirection = 'older' | 'newer';

export function normalizeDashboardSleepTrendRange(value: unknown): AppDashboardSleepTrendRange {
  const stringValue = `${value || ''}`;
  return DASHBOARD_SLEEP_TREND_RANGE_OPTIONS.some(option => option.range === stringValue)
    ? stringValue as AppDashboardSleepTrendRange
    : DASHBOARD_SLEEP_TREND_DEFAULT_RANGE;
}

export function dashboardSleepTrendRangeDays(range: AppDashboardSleepTrendRange): number | null {
  return DASHBOARD_SLEEP_TREND_RANGE_OPTIONS.find(option => option.range === range)?.days ?? null;
}
