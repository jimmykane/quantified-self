import type {
  DerivedAcwrMetricPayload,
  DerivedEfficiencyTrendMetricPayload,
  DerivedFreshnessForecastMetricPayload,
  DerivedIntensityDistributionMetricPayload,
  DerivedMonotonyStrainMetricPayload,
  DerivedRampRateMetricPayload,
} from '@shared/derived-metrics';

export interface DashboardDerivedTrendPoint {
  time: number;
  value: number | null;
}

export interface DashboardAcwrContext {
  latestDayMs: number | null;
  acuteLoad7: number;
  chronicLoad28: number;
  ratio: number | null;
  trend8Weeks: DashboardDerivedTrendPoint[];
}

export interface DashboardRampRateContext {
  latestDayMs: number | null;
  ctlToday: number | null;
  ctl7DaysAgo: number | null;
  rampRate: number | null;
  trend8Weeks: DashboardDerivedTrendPoint[];
}

export interface DashboardMonotonyStrainContext {
  latestDayMs: number | null;
  weeklyLoad7: number;
  monotony: number | null;
  strain: number | null;
  trend8Weeks: DashboardDerivedTrendPoint[];
}

export interface DashboardFreshnessForecastPoint {
  dayMs: number;
  trainingStressScore: number;
  ctl: number;
  atl: number;
  formSameDay: number;
  formPriorDay: number | null;
  isForecast: boolean;
}

export interface DashboardFreshnessForecastContext {
  generatedAtMs: number;
  points: DashboardFreshnessForecastPoint[];
}

export interface DashboardIntensityDistributionWeek {
  weekStartMs: number;
  easySeconds: number;
  moderateSeconds: number;
  hardSeconds: number;
  source: 'power' | 'heart-rate';
}

export interface DashboardIntensityDistributionContext {
  weeks: DashboardIntensityDistributionWeek[];
  latestWeekStartMs: number | null;
  latestEasyPercent: number | null;
  latestModeratePercent: number | null;
  latestHardPercent: number | null;
}

export interface DashboardEfficiencyTrendPoint {
  weekStartMs: number;
  value: number;
  sampleCount: number;
  totalDurationSeconds: number;
}

export interface DashboardEfficiencyTrendContext {
  points: DashboardEfficiencyTrendPoint[];
  latestWeekStartMs: number | null;
  latestValue: number | null;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeTrendPoints(
  points: unknown,
  timeField: string,
  valueField: string,
): DashboardDerivedTrendPoint[] {
  if (!Array.isArray(points)) {
    return [];
  }
  return points
    .map((point) => {
      const pointObject = point as Record<string, unknown>;
      const time = toFiniteNumber(pointObject?.[timeField]);
      if (time === null) {
        return null;
      }
      const value = toFiniteNumber(pointObject?.[valueField]);
      return {
        time,
        value,
      };
    })
    .filter((point): point is DashboardDerivedTrendPoint => !!point);
}

export function resolveDashboardAcwrContext(payload: unknown): DashboardAcwrContext | null {
  const normalized = (payload || {}) as Partial<DerivedAcwrMetricPayload>;
  const acuteLoad7 = toFiniteNumber(normalized.acuteLoad7);
  const chronicLoad28 = toFiniteNumber(normalized.chronicLoad28);
  if (acuteLoad7 === null || chronicLoad28 === null) {
    return null;
  }
  return {
    latestDayMs: toFiniteNumber(normalized.latestDayMs),
    acuteLoad7,
    chronicLoad28,
    ratio: toFiniteNumber(normalized.ratio),
    trend8Weeks: normalizeTrendPoints(normalized.trend8Weeks, 'weekStartMs', 'ratio'),
  };
}

export function resolveDashboardRampRateContext(payload: unknown): DashboardRampRateContext | null {
  const normalized = (payload || {}) as Partial<DerivedRampRateMetricPayload>;
  const trend8Weeks = normalizeTrendPoints(normalized.trend8Weeks, 'weekStartMs', 'rampRate');
  return {
    latestDayMs: toFiniteNumber(normalized.latestDayMs),
    ctlToday: toFiniteNumber(normalized.ctlToday),
    ctl7DaysAgo: toFiniteNumber(normalized.ctl7DaysAgo),
    rampRate: toFiniteNumber(normalized.rampRate),
    trend8Weeks,
  };
}

export function resolveDashboardMonotonyStrainContext(payload: unknown): DashboardMonotonyStrainContext | null {
  const normalized = (payload || {}) as Partial<DerivedMonotonyStrainMetricPayload>;
  const weeklyLoad7 = toFiniteNumber(normalized.weeklyLoad7);
  if (weeklyLoad7 === null) {
    return null;
  }
  return {
    latestDayMs: toFiniteNumber(normalized.latestDayMs),
    weeklyLoad7,
    monotony: toFiniteNumber(normalized.monotony),
    strain: toFiniteNumber(normalized.strain),
    trend8Weeks: normalizeTrendPoints(normalized.trend8Weeks, 'weekStartMs', 'strain'),
  };
}

export function resolveDashboardFreshnessForecastContext(payload: unknown): DashboardFreshnessForecastContext | null {
  const normalized = (payload || {}) as Partial<DerivedFreshnessForecastMetricPayload>;
  if (!Array.isArray(normalized.points)) {
    return null;
  }

  const points = normalized.points
    .map((point) => {
      const pointObject = point as unknown as Record<string, unknown>;
      const dayMs = toFiniteNumber(pointObject.dayMs);
      const trainingStressScore = toFiniteNumber(pointObject.trainingStressScore);
      const ctl = toFiniteNumber(pointObject.ctl);
      const atl = toFiniteNumber(pointObject.atl);
      const formSameDay = toFiniteNumber(pointObject.formSameDay);
      if (
        dayMs === null
        || trainingStressScore === null
        || ctl === null
        || atl === null
        || formSameDay === null
      ) {
        return null;
      }
      return {
        dayMs,
        trainingStressScore,
        ctl,
        atl,
        formSameDay,
        formPriorDay: toFiniteNumber(pointObject.formPriorDay),
        isForecast: pointObject.isForecast === true,
      };
    })
    .filter((point): point is DashboardFreshnessForecastPoint => !!point);

  return {
    generatedAtMs: toFiniteNumber(normalized.generatedAtMs) || 0,
    points,
  };
}

export function resolveDashboardIntensityDistributionContext(payload: unknown): DashboardIntensityDistributionContext | null {
  const normalized = (payload || {}) as Partial<DerivedIntensityDistributionMetricPayload>;
  if (!Array.isArray(normalized.weeks)) {
    return null;
  }
  const weeks = normalized.weeks
    .map((week) => {
      const weekObject = week as unknown as Record<string, unknown>;
      const weekStartMs = toFiniteNumber(weekObject.weekStartMs);
      const easySeconds = toFiniteNumber(weekObject.easySeconds);
      const moderateSeconds = toFiniteNumber(weekObject.moderateSeconds);
      const hardSeconds = toFiniteNumber(weekObject.hardSeconds);
      if (weekStartMs === null || easySeconds === null || moderateSeconds === null || hardSeconds === null) {
        return null;
      }
      const source = `${weekObject.source || ''}` === 'heart-rate' ? 'heart-rate' : 'power';
      return {
        weekStartMs,
        easySeconds,
        moderateSeconds,
        hardSeconds,
        source,
      };
    })
    .filter((week): week is DashboardIntensityDistributionWeek => !!week);

  return {
    weeks,
    latestWeekStartMs: toFiniteNumber(normalized.latestWeekStartMs),
    latestEasyPercent: toFiniteNumber(normalized.latestEasyPercent),
    latestModeratePercent: toFiniteNumber(normalized.latestModeratePercent),
    latestHardPercent: toFiniteNumber(normalized.latestHardPercent),
  };
}

export function resolveDashboardEfficiencyTrendContext(payload: unknown): DashboardEfficiencyTrendContext | null {
  const normalized = (payload || {}) as Partial<DerivedEfficiencyTrendMetricPayload>;
  if (!Array.isArray(normalized.points)) {
    return null;
  }
  const points = normalized.points
    .map((point) => {
      const pointObject = point as unknown as Record<string, unknown>;
      const weekStartMs = toFiniteNumber(pointObject.weekStartMs);
      const value = toFiniteNumber(pointObject.value);
      const sampleCount = toFiniteNumber(pointObject.sampleCount);
      const totalDurationSeconds = toFiniteNumber(pointObject.totalDurationSeconds);
      if (weekStartMs === null || value === null || sampleCount === null || totalDurationSeconds === null) {
        return null;
      }
      return {
        weekStartMs,
        value,
        sampleCount,
        totalDurationSeconds,
      };
    })
    .filter((point): point is DashboardEfficiencyTrendPoint => !!point);

  return {
    points,
    latestWeekStartMs: toFiniteNumber(normalized.latestWeekStartMs),
    latestValue: toFiniteNumber(normalized.latestValue),
  };
}
