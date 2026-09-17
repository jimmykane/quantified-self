import type { DashboardFormPoint } from './dashboard-form.helper';
import type { DashboardSleepTrendContext, DashboardSleepTrendPoint } from './dashboard-sleep-chart.helper';

export type DashboardTodayVisualTone = 'positive' | 'negative' | 'neutral';

export interface DashboardTodayHistoryBar {
  key: string;
  heightPercent: number;
  current: boolean;
  tone: DashboardTodayVisualTone;
}

export interface DashboardTodayTrainingStateScale {
  position: number | null;
  total: 6;
  tone: DashboardTodayVisualTone;
}

const MAX_HISTORY_BARS = 7;
const MIN_VISIBLE_BAR_PERCENT = 12;

export function buildDashboardTodayLoadBars(
  points: readonly DashboardFormPoint[] | null | undefined,
  stateLabel: string | null | undefined,
  nowMs = Date.now(),
): DashboardTodayHistoryBar[] {
  const values = [...(points || [])]
    .filter(point => Number.isFinite(point.time)
      && point.time <= nowMs
      && Number.isFinite(point.trainingStressScore)
      && point.trainingStressScore >= 0)
    .sort((left, right) => left.time - right.time)
    .slice(-MAX_HISTORY_BARS)
    .map(point => ({ key: `${point.time}`, value: point.trainingStressScore }));
  return normalizeHistoryBars(values, resolveTrainingStateTone(stateLabel));
}

export function buildDashboardTodayOvernightHeartRateBars(
  sleepTrend: DashboardSleepTrendContext | null | undefined,
  currentTone: DashboardTodayVisualTone,
  nowMs = Date.now(),
): DashboardTodayHistoryBar[] {
  const eligible = (sleepTrend?.points || [])
    .flatMap(point => {
      const value = resolveOvernightHeartRateValue(point);
      const time = resolveSleepPointTime(point);
      return point.isPlaceholder === true || point.isNap === true || value === null || time > nowMs
        ? []
        : [{ point, value, time }];
    })
    .sort((left, right) => left.time - right.time || left.point.id.localeCompare(right.point.id));
  const latest = eligible[eligible.length - 1];
  if (!latest) {
    return [];
  }
  const values = eligible
    .filter(({ point }) => point.provider === latest.point.provider
      && (point.sourceKey ?? null) === (latest.point.sourceKey ?? null))
    .slice(-MAX_HISTORY_BARS)
    .map(({ point, value }) => ({ key: point.id, value }));
  return normalizeHistoryBars(values, currentTone);
}

export function resolveDashboardTodayTrainingStateScale(
  label: string | null | undefined,
): DashboardTodayTrainingStateScale {
  const normalized = `${label || ''}`.trim().toLowerCase();
  const position = ({
    starting: 0,
    detraining: 0,
    fresh: 1,
    balanced: 2,
    building: 3,
    fatigued: 4,
    overload: 5,
  } as Record<string, number>)[normalized];
  return {
    position: Number.isInteger(position) ? position : null,
    total: 6,
    tone: resolveTrainingStateTone(label),
  };
}

function normalizeHistoryBars(
  values: ReadonlyArray<{ key: string; value: number }>,
  currentTone: DashboardTodayVisualTone,
): DashboardTodayHistoryBar[] {
  if (!values.length) {
    return [];
  }
  const maximum = Math.max(...values.map(point => point.value));
  return values.map((point, index) => ({
    key: point.key,
    heightPercent: maximum > 0
      ? Math.max(MIN_VISIBLE_BAR_PERCENT, Math.min(100, point.value / maximum * 100))
      : MIN_VISIBLE_BAR_PERCENT,
    current: index === values.length - 1,
    tone: index === values.length - 1 ? currentTone : 'neutral',
  }));
}

function resolveTrainingStateTone(label: string | null | undefined): DashboardTodayVisualTone {
  const normalized = `${label || ''}`.trim().toLowerCase();
  if (normalized === 'overload' || normalized === 'fatigued') {
    return 'negative';
  }
  if (normalized === 'fresh' || normalized === 'balanced' || normalized === 'building') {
    return 'positive';
  }
  return 'neutral';
}

function resolveOvernightHeartRateValue(point: DashboardSleepTrendPoint): number | null {
  const average = finitePositive(point.averageHeartRateBpm);
  const minimum = finitePositive(point.minimumHeartRateBpm);
  if (average !== null && minimum !== null) {
    return average * 0.7 + minimum * 0.3;
  }
  return average ?? minimum;
}

function resolveSleepPointTime(point: DashboardSleepTrendPoint): number {
  return finitePositive(point.endTimeMs) ?? finitePositive(point.startTimeMs) ?? 0;
}

function finitePositive(value: unknown): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}
