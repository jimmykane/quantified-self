export type DashboardDerivedChartRange = '8w' | '12w' | '6m' | '1y' | 'all';

export interface DashboardDerivedChartRangeOption {
  range: DashboardDerivedChartRange;
  label: string;
  shortLabel: string;
  menuLabel: string;
  weeks: number | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const DASHBOARD_DERIVED_CHART_DEFAULT_RANGE: DashboardDerivedChartRange = '1y';

export const DASHBOARD_DERIVED_CHART_RANGE_OPTIONS: ReadonlyArray<DashboardDerivedChartRangeOption> = [
  { range: '8w', label: '8w', shortLabel: '8w', menuLabel: '8 weeks', weeks: 8 },
  { range: '12w', label: '12w', shortLabel: '12w', menuLabel: '12 weeks', weeks: 12 },
  { range: '6m', label: '6m', shortLabel: '6m', menuLabel: '6 months', weeks: 26 },
  { range: '1y', label: '1y', shortLabel: '1y', menuLabel: '1 year', weeks: 52 },
  { range: 'all', label: 'All', shortLabel: 'All', menuLabel: 'All', weeks: null },
];

const VALID_DERIVED_CHART_RANGES = new Set<DashboardDerivedChartRange>(
  DASHBOARD_DERIVED_CHART_RANGE_OPTIONS.map(option => option.range),
);

export function normalizeDashboardDerivedChartRange(value: unknown): DashboardDerivedChartRange {
  const stringValue = `${value || ''}`;
  return VALID_DERIVED_CHART_RANGES.has(stringValue as DashboardDerivedChartRange)
    ? stringValue as DashboardDerivedChartRange
    : DASHBOARD_DERIVED_CHART_DEFAULT_RANGE;
}

export function dashboardDerivedChartRangeWeeks(range: DashboardDerivedChartRange): number | null {
  return DASHBOARD_DERIVED_CHART_RANGE_OPTIONS.find(option => option.range === range)?.weeks ?? null;
}

export function filterDashboardDerivedWeeklyRange<T extends { weekStartMs: number }>(
  items: readonly T[],
  range: DashboardDerivedChartRange,
): T[] {
  const sortedItems = [...(items || [])]
    .filter(item => Number.isFinite(item?.weekStartMs))
    .sort((left, right) => left.weekStartMs - right.weekStartMs);
  const normalizedRange = normalizeDashboardDerivedChartRange(range);
  const weeks = dashboardDerivedChartRangeWeeks(normalizedRange);
  if (weeks === null || sortedItems.length === 0) {
    return sortedItems;
  }

  const latestWeekStartMs = sortedItems[sortedItems.length - 1].weekStartMs;
  const earliestWeekStartMs = latestWeekStartMs - ((weeks - 1) * WEEK_MS);
  return sortedItems.filter(item => item.weekStartMs >= earliestWeekStartMs && item.weekStartMs <= latestWeekStartMs);
}
