const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;
const MONTH_MIN_INTERVAL_MS = 28 * DAY_MS;
const WEEK_MIN_INTERVAL_MS = 7 * DAY_MS;

export type DashboardFormXAxisLabelMode = 'yearly' | 'monthly' | 'daily';

export interface DashboardFormXAxisLabelConfig {
  mode: DashboardFormXAxisLabelMode;
  minIntervalMs: number;
  splitNumber: number;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function resolveDashboardFormXAxisLabelMode(visibleSpanMs: number): DashboardFormXAxisLabelMode {
  const normalizedSpanMs = toFiniteNumber(visibleSpanMs);
  if (normalizedSpanMs === null || normalizedSpanMs < 0) {
    return 'daily';
  }

  if (normalizedSpanMs >= (2 * YEAR_MS)) {
    return 'yearly';
  }

  if (normalizedSpanMs >= (180 * DAY_MS)) {
    return 'monthly';
  }

  return 'daily';
}

export function resolveDashboardFormXAxisLabelInterval(
  visiblePointCount: number,
  mode: DashboardFormXAxisLabelMode,
): number {
  const normalizedPointCount = Math.max(0, Math.floor(toFiniteNumber(visiblePointCount) || 0));
  if (normalizedPointCount <= 8) {
    return 0;
  }

  const targetVisibleLabels = mode === 'yearly'
    ? 6
    : mode === 'monthly'
      ? 6
      : 5;
  return Math.max(0, Math.ceil(normalizedPointCount / targetVisibleLabels) - 1);
}

export function resolveDashboardFormXAxisMinIntervalMs(mode: DashboardFormXAxisLabelMode): number {
  if (mode === 'yearly') {
    return YEAR_MS;
  }
  if (mode === 'monthly') {
    return MONTH_MIN_INTERVAL_MS;
  }
  return WEEK_MIN_INTERVAL_MS;
}

export function resolveDashboardFormXAxisSplitNumber(
  visiblePointCount: number,
  mode: DashboardFormXAxisLabelMode,
): number {
  const rawInterval = resolveDashboardFormXAxisLabelInterval(visiblePointCount, mode);
  // Keep at least 2 labels visible on time axis and cap dense cases.
  return Math.max(2, Math.min(7, rawInterval + 2));
}

export function resolveDashboardFormXAxisLabelConfig(
  visibleStartTimeMs: number,
  visibleEndTimeMs: number,
  visiblePointCount: number,
): DashboardFormXAxisLabelConfig {
  const visibleSpanMs = Math.max(0, visibleEndTimeMs - visibleStartTimeMs);
  const mode = resolveDashboardFormXAxisLabelMode(visibleSpanMs);
  const minIntervalMs = resolveDashboardFormXAxisMinIntervalMs(mode);
  const splitNumber = resolveDashboardFormXAxisSplitNumber(visiblePointCount, mode);
  return {
    mode,
    minIntervalMs,
    splitNumber,
  };
}

export function formatDashboardFormXAxisLabel(
  value: number,
  mode: DashboardFormXAxisLabelMode,
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  if (mode === 'yearly') {
    return date.toLocaleDateString(undefined, { year: 'numeric' });
  }

  if (mode === 'monthly') {
    return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }

  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}
