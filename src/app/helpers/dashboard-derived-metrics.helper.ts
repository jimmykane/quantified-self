import type {
  DerivedAcwrMetricPayload,
  DerivedEasyPercentMetricPayload,
  DerivedEfficiencyDelta4wMetricPayload,
  DerivedEfficiencyTrendMetricPayload,
  DerivedFreshnessForecastMetricPayload,
  DerivedFormNowMetricPayload,
  DerivedFormPlus7dMetricPayload,
  DerivedHardPercentMetricPayload,
  DerivedIntensityDistributionMetricPayload,
  DerivedMonotonyStrainMetricPayload,
  DerivedRampRateMetricPayload,
  DerivedTrainingCapacityDiscipline,
  DerivedTrainingCapacityImportedMetric,
  DerivedTrainingCapacityMetricPayload,
  DerivedTrainingBuildBenchmarkReference,
  DerivedTrainingBuildComparisonDiscipline,
  DerivedTrainingBuildComparisonMetricPayload,
  DerivedTrainingBuildDurabilityComparison,
  DerivedTrainingBuildEventSuggestion,
  DerivedTrainingBuildRaceSuggestion,
  DerivedTrainingBuildWindow,
  DerivedTrainingRecoveryComparison,
  DerivedTrainingRecoveryWindow,
  DerivedTrainingDisciplineSummary,
  DerivedTrainingSummaryMetricPayload,
  DerivedTrainingSummaryWindow,
  DerivedTrainingSwimPerformanceMetricPayload,
  DerivedTrainingSwimWeek,
} from '@shared/derived-metrics';
import { normalizeSleepProvider } from '@shared/sleep';
import {
  DERIVED_TRAINING_RECOVERY_MAX_BEDTIME_VARIATION_MINUTES,
  DERIVED_TRAINING_RECOVERY_MAX_VALID_SLEEP_SECONDS,
  DERIVED_TRAINING_RECOVERY_MIN_HRV_NIGHTS,
  DERIVED_TRAINING_RECOVERY_MIN_REGULARITY_NIGHTS,
  DERIVED_TRAINING_RECOVERY_MIN_SLEEP_NIGHTS,
  DERIVED_TRAINING_RECOVERY_MIN_VALID_SLEEP_SECONDS,
  getDerivedTrainingRecoveryMinimumComparableNights,
  getTrainingBuildBenchmarkSelectionKey,
  normalizeTrainingBuildEventId,
  normalizeTrainingBuildPeriodEndDayMs,
} from '@shared/derived-metrics';
import { isTrainingDiscipline, TRAINING_DISCIPLINES } from '@shared/training-disciplines';
import {
  extendDashboardFormPointsWithZeroLoadUntil,
  resolveDashboardFormLatestPoint,
  type DashboardFormPoint,
} from './dashboard-form.helper';
import {
  resolveTrainingDurabilityContext,
  resolveTrainingDurabilityContextSummary,
  resolveTrainingDurabilityWindowMetrics,
} from './training-derived-metrics.helper';

const DAY_MS = 24 * 60 * 60 * 1000;

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

export interface DashboardFormNowContext {
  latestDayMs: number | null;
  value: number | null;
  trend8Weeks: DashboardDerivedTrendPoint[];
}

interface DashboardFormMetricKpiContext {
  latestDayMs: number | null;
  value: number | null;
  trend8Weeks: DashboardDerivedTrendPoint[];
}

export type DashboardFitnessCtlContext = DashboardFormMetricKpiContext;

export type DashboardFatigueAtlContext = DashboardFormMetricKpiContext;

export interface DashboardFormPlus7dContext {
  latestDayMs: number | null;
  projectedDayMs: number | null;
  value: number | null;
  trend8Weeks: DashboardDerivedTrendPoint[];
}

export interface DashboardEasyPercentContext {
  latestWeekStartMs: number | null;
  value: number | null;
  trend8Weeks: DashboardDerivedTrendPoint[];
}

export interface DashboardHardPercentContext {
  latestWeekStartMs: number | null;
  value: number | null;
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

export interface DashboardEfficiencyDelta4wContext {
  latestWeekStartMs: number | null;
  latestValue: number | null;
  baselineValue: number | null;
  baselineWeekCount: number;
  deltaAbs: number | null;
  deltaPct: number | null;
  trend8Weeks: DashboardDerivedTrendPoint[];
}

export interface DashboardTrainingSummaryWindow {
  periodDays: number;
  windowStartDayMs: number;
  windowEndDayMs: number;
  activityCount: number;
  durationSeconds: number;
  easySeconds: number;
  moderateSeconds: number;
  hardSeconds: number;
}

export interface DashboardTrainingDisciplineSummary extends Omit<DerivedTrainingDisciplineSummary, 'current28d' | 'baseline28d'> {
  current28d: DashboardTrainingSummaryWindow;
  baseline28d: DashboardTrainingSummaryWindow;
}

export interface DashboardTrainingSummaryContext {
  asOfDayMs: number;
  currentWindowDays: number;
  baselineWindowDays: number;
  disciplines: DashboardTrainingDisciplineSummary[];
}

export type DashboardTrainingCapacityImportedMetric = DerivedTrainingCapacityImportedMetric;
export type DashboardTrainingCapacityDiscipline = DerivedTrainingCapacityDiscipline;

export interface DashboardTrainingCapacityContext {
  asOfDayMs: number;
  disciplines: DashboardTrainingCapacityDiscipline[];
}

export type DashboardTrainingBuildWindow = DerivedTrainingBuildWindow;
export type DashboardTrainingBuildDurabilityComparison = DerivedTrainingBuildDurabilityComparison;
export type DashboardTrainingBuildEventSuggestion = DerivedTrainingBuildEventSuggestion;
export type DashboardTrainingBuildRaceSuggestion = DerivedTrainingBuildRaceSuggestion;
export type DashboardTrainingBuildBenchmarkReference = DerivedTrainingBuildBenchmarkReference;
export type DashboardTrainingRecoveryWindow = DerivedTrainingRecoveryWindow;
export type DashboardTrainingRecoveryComparison = DerivedTrainingRecoveryComparison;

export interface DashboardTrainingBuildComparisonDiscipline extends Omit<DerivedTrainingBuildComparisonDiscipline, 'current' | 'benchmark' | 'selection' | 'durabilityComparisons' | 'suggestedRaces' | 'suggestedEvents'> {
  current: DashboardTrainingBuildWindow | null;
  benchmark: DashboardTrainingBuildWindow | null;
  selection: DashboardTrainingBuildBenchmarkReference | null;
  durabilityComparisons: DashboardTrainingBuildDurabilityComparison[];
  suggestedRaces: DashboardTrainingBuildRaceSuggestion[];
  suggestedEvents: DashboardTrainingBuildEventSuggestion[];
}

export interface DashboardTrainingBuildComparisonContext {
  asOfDayMs: number;
  recovery: DashboardTrainingRecoveryComparison;
  disciplines: DashboardTrainingBuildComparisonDiscipline[];
}

export interface DashboardTrainingSwimPerformanceContext {
  asOfDayMs: number;
  swolfContext: DerivedTrainingSwimPerformanceMetricPayload['swolfContext'];
  weeks: DerivedTrainingSwimWeek[];
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

function resolveUtcWeekStartMs(timeMs: number): number {
  const date = new Date(timeMs);
  const dayIndexMondayFirst = (date.getUTCDay() + 6) % 7;
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - dayIndexMondayFirst,
  );
}

function resolveUtcDayStartMs(timeMs: number): number {
  const date = new Date(timeMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function toRoundedMetricValue(value: number | null, precision = 4): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function buildDashboardFormMetricTrend8Weeks(
  points: readonly DashboardFormPoint[],
  valueSelector: (point: DashboardFormPoint) => number | null,
): DashboardDerivedTrendPoint[] {
  const trendByWeek = new Map<number, DashboardDerivedTrendPoint>();
  points.forEach((point) => {
    const time = toFiniteNumber(point.time);
    if (time === null) {
      return;
    }
    const value = toRoundedMetricValue(valueSelector(point));
    const weekStartMs = resolveUtcWeekStartMs(time);
    trendByWeek.set(weekStartMs, {
      time: weekStartMs,
      value,
    });
  });

  return [...trendByWeek.values()]
    .sort((left, right) => left.time - right.time)
    .slice(-8);
}

function resolveDashboardFormMetricKpiContext(
  points: readonly DashboardFormPoint[] | null | undefined,
  valueSelector: (point: DashboardFormPoint) => number | null,
  nowMs = Date.now(),
): DashboardFormMetricKpiContext | null {
  if (!Array.isArray(points)) {
    return null;
  }
  const pointsUntilToday = extendDashboardFormPointsWithZeroLoadUntil(points, nowMs);
  const latestPoint = pointsUntilToday[pointsUntilToday.length - 1] || null;
  return {
    latestDayMs: latestPoint?.time ?? null,
    value: latestPoint ? toRoundedMetricValue(valueSelector(latestPoint)) : null,
    trend8Weeks: buildDashboardFormMetricTrend8Weeks(pointsUntilToday, valueSelector),
  };
}

function buildDashboardFormRampTrend8Weeks(
  points: readonly DashboardFormPoint[],
): DashboardDerivedTrendPoint[] {
  const ctlByDay = new Map(points.map(point => [point.time, toFiniteNumber(point.ctl)]));
  const trendByWeek = new Map<number, DashboardDerivedTrendPoint>();

  points.forEach((point) => {
    const ctlToday = toFiniteNumber(point.ctl);
    const ctlSevenDaysAgo = ctlByDay.get(point.time - (7 * DAY_MS)) ?? null;
    if (ctlToday === null || ctlSevenDaysAgo === null) {
      return;
    }
    const weekStartMs = resolveUtcWeekStartMs(point.time);
    trendByWeek.set(weekStartMs, {
      time: weekStartMs,
      value: toRoundedMetricValue(ctlToday - ctlSevenDaysAgo),
    });
  });

  return [...trendByWeek.values()]
    .sort((left, right) => left.time - right.time)
    .slice(-8);
}

/**
 * Uses the Form series as the single source of truth for the value currently
 * shown to a user. This deliberately includes zero-load days through today so
 * Form Now always agrees with the Form chart and CTL/ATL KPI cards.
 */
export function resolveDashboardFormNowContextFromPoints(
  points: readonly DashboardFormPoint[] | null | undefined,
  nowMs = Date.now(),
): DashboardFormNowContext | null {
  if (!Array.isArray(points) || !points.length) {
    return null;
  }
  const pointsUntilToday = extendDashboardFormPointsWithZeroLoadUntil(points, nowMs);
  const latestPoint = resolveDashboardFormLatestPoint(pointsUntilToday);
  return {
    latestDayMs: latestPoint?.time ?? null,
    value: latestPoint ? toRoundedMetricValue(latestPoint.formSameDay) : null,
    trend8Weeks: buildDashboardFormMetricTrend8Weeks(
      pointsUntilToday,
      point => toFiniteNumber(point.formSameDay),
    ),
  };
}

/**
 * Calculates Ramp Rate from the same current Form series as CTL, ATL, and
 * TSB. A persisted Ramp Rate snapshot remains a fallback only when the Form
 * series does not yet contain a seven-day comparison.
 */
export function resolveDashboardRampRateContextFromPoints(
  points: readonly DashboardFormPoint[] | null | undefined,
  nowMs = Date.now(),
): DashboardRampRateContext | null {
  if (!Array.isArray(points) || !points.length) {
    return null;
  }
  const pointsUntilToday = extendDashboardFormPointsWithZeroLoadUntil(points, nowMs);
  const latestPoint = resolveDashboardFormLatestPoint(pointsUntilToday);
  if (!latestPoint) {
    return null;
  }
  const ctlSevenDaysAgo = pointsUntilToday.find(point => point.time === latestPoint.time - (7 * DAY_MS))?.ctl;
  if (!Number.isFinite(ctlSevenDaysAgo)) {
    return null;
  }
  const ctlToday = toFiniteNumber(latestPoint.ctl);
  const normalizedCtlSevenDaysAgo = toFiniteNumber(ctlSevenDaysAgo);
  if (ctlToday === null || normalizedCtlSevenDaysAgo === null) {
    return null;
  }
  return {
    latestDayMs: latestPoint.time,
    ctlToday: toRoundedMetricValue(ctlToday),
    ctl7DaysAgo: toRoundedMetricValue(normalizedCtlSevenDaysAgo),
    rampRate: toRoundedMetricValue(ctlToday - normalizedCtlSevenDaysAgo),
    trend8Weeks: buildDashboardFormRampTrend8Weeks(pointsUntilToday),
  };
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

function resolveDashboardTrainingSummaryWindow(value: unknown): DashboardTrainingSummaryWindow | null {
  const raw = (value || {}) as Partial<DerivedTrainingSummaryWindow>;
  const periodDays = toFiniteNumber(raw.periodDays);
  const windowStartDayMs = toFiniteNumber(raw.windowStartDayMs);
  const windowEndDayMs = toFiniteNumber(raw.windowEndDayMs);
  const activityCount = toFiniteNumber(raw.activityCount);
  const durationSeconds = toFiniteNumber(raw.durationSeconds);
  const easySeconds = toFiniteNumber(raw.easySeconds);
  const moderateSeconds = toFiniteNumber(raw.moderateSeconds);
  const hardSeconds = toFiniteNumber(raw.hardSeconds);
  if (
    periodDays === null
    || periodDays <= 0
    || !Number.isInteger(periodDays)
    || windowStartDayMs === null
    || windowEndDayMs === null
    || windowEndDayMs < windowStartDayMs
    || activityCount === null
    || activityCount < 0
    || durationSeconds === null
    || durationSeconds < 0
    || easySeconds === null
    || easySeconds < 0
    || moderateSeconds === null
    || moderateSeconds < 0
    || hardSeconds === null
    || hardSeconds < 0
  ) {
    return null;
  }
  return {
    periodDays,
    windowStartDayMs,
    windowEndDayMs,
    activityCount,
    durationSeconds,
    easySeconds,
    moderateSeconds,
    hardSeconds,
  };
}

export function resolveDashboardTrainingSummaryContext(payload: unknown): DashboardTrainingSummaryContext | null {
  const raw = (payload || {}) as Partial<DerivedTrainingSummaryMetricPayload>;
  const asOfDayMs = toFiniteNumber(raw.asOfDayMs);
  const currentWindowDays = toFiniteNumber(raw.currentWindowDays);
  const baselineWindowDays = toFiniteNumber(raw.baselineWindowDays);
  if (
    raw.dayBoundary !== 'UTC'
    || raw.excludesMergedEvents !== true
    || asOfDayMs === null
    || resolveUtcDayStartMs(asOfDayMs) !== asOfDayMs
    || currentWindowDays !== 28
    || baselineWindowDays !== 84
    || !Array.isArray(raw.disciplines)
  ) {
    return null;
  }
  const disciplines = raw.disciplines
    .map((discipline) => {
      if (!discipline || typeof discipline !== 'object') {
        return null;
      }
      const source = discipline as Partial<DerivedTrainingDisciplineSummary>;
      if (!isTrainingDiscipline(source.discipline)) {
        return null;
      }
      const current28d = resolveDashboardTrainingSummaryWindow(source.current28d);
      const baseline28d = resolveDashboardTrainingSummaryWindow(source.baseline28d);
      if (!current28d || !baseline28d) {
        return null;
      }
      return {
        discipline: source.discipline,
        current28d,
        baseline28d,
      };
    })
    .filter((discipline): discipline is DashboardTrainingDisciplineSummary => !!discipline);
  if (
    disciplines.length !== TRAINING_DISCIPLINES.length
    || new Set(disciplines.map(discipline => discipline.discipline)).size !== TRAINING_DISCIPLINES.length
  ) {
    return null;
  }
  return {
    asOfDayMs,
    currentWindowDays,
    baselineWindowDays,
    disciplines,
  };
}

function resolveDashboardTrainingCapacityImportedMetric(
  value: unknown,
  expectedKind: DerivedTrainingCapacityImportedMetric['kind'],
): DashboardTrainingCapacityImportedMetric | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<DerivedTrainingCapacityImportedMetric>;
  const metricValue = toFiniteNumber(raw.value);
  const firstSeenAtMs = toFiniteNumber(raw.firstSeenAtMs);
  const lastSeenAtMs = toFiniteNumber(raw.lastSeenAtMs);
  const observationCount = toFiniteNumber(raw.observationCount);
  const previousValue = toFiniteNumber(raw.previousValue);
  const previousAtMs = toFiniteNumber(raw.previousAtMs);
  const changePct = toFiniteNumber(raw.changePct);
  if (
    raw.kind !== expectedKind
    || raw.provenance !== 'imported-activity-stat'
    || metricValue === null
    || metricValue <= 0
    || firstSeenAtMs === null
    || lastSeenAtMs === null
    || lastSeenAtMs < firstSeenAtMs
    || observationCount === null
    || observationCount < 1
    || !Number.isInteger(observationCount)
    || (previousValue !== null && previousValue <= 0)
    || (previousAtMs !== null && previousAtMs > firstSeenAtMs)
    || ((previousValue === null) !== (previousAtMs === null))
    || (changePct !== null && (previousValue === null || raw.previousSourceKey !== raw.sourceKey))
  ) {
    return null;
  }
  return {
    kind: expectedKind,
    value: metricValue,
    sourceKey: typeof raw.sourceKey === 'string' && raw.sourceKey.trim().length ? raw.sourceKey : null,
    provenance: 'imported-activity-stat',
    firstSeenAtMs,
    lastSeenAtMs,
    observationCount: Math.floor(observationCount),
    previousValue,
    previousAtMs,
    previousSourceKey: typeof raw.previousSourceKey === 'string' && raw.previousSourceKey.trim().length
      ? raw.previousSourceKey
      : null,
    changePct,
  };
}

function resolveDashboardModeledCriticalPower(
  value: unknown,
): DashboardTrainingCapacityDiscipline['modeledCriticalPower'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<DashboardTrainingCapacityDiscipline['modeledCriticalPower']>;
  const valueWatts = toFiniteNumber(raw.valueWatts);
  const valueWattsPerKg = toFiniteNumber(raw.valueWattsPerKg);
  const wPrimeJoules = toFiniteNumber(raw.wPrimeJoules);
  const sourceEventCount = toFiniteNumber(raw.sourceEventCount);
  const anchorPointCount = toFiniteNumber(raw.anchorPointCount);
  const minDurationSeconds = toFiniteNumber(raw.minDurationSeconds);
  const maxDurationSeconds = toFiniteNumber(raw.maxDurationSeconds);
  const rSquared = toFiniteNumber(raw.rSquared);
  const normalizedRmse = toFiniteNumber(raw.normalizedRmse);
  const status = raw.status === 'ready' || raw.status === 'insufficient-evidence' || raw.status === 'poor-fit'
    ? raw.status
    : null;
  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
    ? raw.confidence
    : null;
  if (
    status === null
    || raw.windowDays !== 90
    || sourceEventCount === null
    || sourceEventCount < 0
    || !Number.isInteger(sourceEventCount)
    || anchorPointCount === null
    || anchorPointCount < 0
    || !Number.isInteger(anchorPointCount)
    || (valueWattsPerKg !== null && valueWattsPerKg <= 0)
    || (minDurationSeconds !== null && minDurationSeconds <= 0)
    || (maxDurationSeconds !== null && maxDurationSeconds <= 0)
    || (minDurationSeconds !== null && maxDurationSeconds !== null && minDurationSeconds > maxDurationSeconds)
    || (rSquared !== null && (rSquared < -1 || rSquared > 1))
    || (normalizedRmse !== null && normalizedRmse < 0)
  ) {
    return null;
  }
  if (
    status === 'ready'
    && (
      valueWatts === null
      || valueWatts <= 0
      || wPrimeJoules === null
      || wPrimeJoules <= 0
      || (confidence !== 'high' && confidence !== 'medium')
      || sourceEventCount < (confidence === 'high' ? 3 : 1)
      || anchorPointCount !== 5
      || minDurationSeconds === null
      || minDurationSeconds > 180
      || maxDurationSeconds === null
      || maxDurationSeconds < 1_200
      || rSquared === null
      || rSquared < 0.9
      || normalizedRmse === null
      || normalizedRmse > 0.07
    )
  ) {
    return null;
  }
  if (
    status === 'insufficient-evidence'
    && (
      raw.valueWatts !== null
      || raw.valueWattsPerKg !== null
      || raw.wPrimeJoules !== null
      || raw.confidence !== null
      || anchorPointCount >= 5
    )
  ) {
    return null;
  }
  if (
    status === 'poor-fit'
    && (
      raw.valueWatts !== null
      || raw.valueWattsPerKg !== null
      || raw.wPrimeJoules !== null
      || confidence !== 'low'
      || anchorPointCount !== 5
    )
  ) {
    return null;
  }
  return {
    status,
    valueWatts: status === 'ready' ? valueWatts : null,
    valueWattsPerKg: status === 'ready' && valueWattsPerKg !== null && valueWattsPerKg > 0 ? valueWattsPerKg : null,
    wPrimeJoules: status === 'ready' && wPrimeJoules !== null && wPrimeJoules > 0 ? wPrimeJoules : null,
    confidence,
    windowDays: 90,
    sourceEventCount: Math.floor(sourceEventCount),
    anchorPointCount: Math.floor(anchorPointCount),
    minDurationSeconds,
    maxDurationSeconds,
    rSquared,
    normalizedRmse,
  };
}

export function resolveDashboardTrainingCapacityContext(payload: unknown): DashboardTrainingCapacityContext | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const raw = payload as Partial<DerivedTrainingCapacityMetricPayload>;
  const asOfDayMs = toFiniteNumber(raw.asOfDayMs);
  if (raw.dayBoundary !== 'UTC' || raw.excludesMergedEvents !== true || asOfDayMs === null || !Array.isArray(raw.disciplines)) {
    return null;
  }
  const disciplines = raw.disciplines.flatMap((candidate) => {
    if (!candidate || (candidate.discipline !== 'running' && candidate.discipline !== 'cycling')) {
      return [];
    }
    const ftpSetting = candidate.ftpSetting === null
      ? null
      : resolveDashboardTrainingCapacityImportedMetric(candidate.ftpSetting, 'ftp-setting');
    const importedVo2Max = candidate.importedVo2Max === null
      ? null
      : resolveDashboardTrainingCapacityImportedMetric(candidate.importedVo2Max, 'vo2-max');
    const modeledCriticalPower = resolveDashboardModeledCriticalPower(candidate.modeledCriticalPower);
    if ((candidate.ftpSetting !== null && !ftpSetting) || (candidate.importedVo2Max !== null && !importedVo2Max) || !modeledCriticalPower) {
      return [];
    }
    return [{ discipline: candidate.discipline, ftpSetting, importedVo2Max, modeledCriticalPower }];
  });
  const disciplineKinds = new Set(disciplines.map(discipline => discipline.discipline));
  if (disciplines.length !== 2 || disciplineKinds.size !== 2) {
    return null;
  }
  return { asOfDayMs, disciplines };
}

function resolveDashboardTrainingBuildWindow(value: unknown): DashboardTrainingBuildWindow | null {
  const raw = (value || {}) as Partial<DerivedTrainingBuildWindow>;
  const periodWeeks = toFiniteNumber(raw.periodWeeks);
  const windowStartDayMs = toFiniteNumber(raw.windowStartDayMs);
  const windowEndDayMs = toFiniteNumber(raw.windowEndDayMs);
  const activityCount = toFiniteNumber(raw.activityCount);
  const durationSeconds = toFiniteNumber(raw.durationSeconds);
  const distanceEventCount = toFiniteNumber(raw.distanceEventCount);
  const trainingStressScoreEventCount = toFiniteNumber(raw.trainingStressScoreEventCount);
  const activeWeekCount = toFiniteNumber(raw.activeWeekCount);
  const intensitySourceEventCount = toFiniteNumber(raw.intensitySourceEventCount);
  const durability = raw.durability === null ? null : resolveTrainingDurabilityWindowMetrics(raw.durability);
  const poolPaceActivityCount = toFiniteNumber(raw.poolPaceActivityCount);
  const openWaterPaceActivityCount = toFiniteNumber(raw.openWaterPaceActivityCount);
  if (
    (periodWeeks !== 8 && periodWeeks !== 10 && periodWeeks !== 12)
    || windowStartDayMs === null
    || windowEndDayMs === null
    || activityCount === null
    || durationSeconds === null
    || distanceEventCount === null
    || trainingStressScoreEventCount === null
    || activeWeekCount === null
    || intensitySourceEventCount === null
    || (raw.durability !== null && !durability)
    || poolPaceActivityCount === null
    || openWaterPaceActivityCount === null
  ) {
    return null;
  }
  return {
    periodWeeks,
    windowStartDayMs,
    windowEndDayMs,
    activityCount,
    durationSeconds,
    distanceMeters: toFiniteNumber(raw.distanceMeters),
    distanceEventCount,
    trainingStressScore: toFiniteNumber(raw.trainingStressScore),
    trainingStressScoreEventCount,
    activeWeekCount,
    longestActivityDurationSeconds: toFiniteNumber(raw.longestActivityDurationSeconds),
    easySeconds: toFiniteNumber(raw.easySeconds),
    moderateSeconds: toFiniteNumber(raw.moderateSeconds),
    hardSeconds: toFiniteNumber(raw.hardSeconds),
    intensitySourceEventCount,
    durability,
    poolAveragePaceSecondsPer100m: toFiniteNumber(raw.poolAveragePaceSecondsPer100m),
    poolPaceActivityCount,
    openWaterAveragePaceSecondsPer100m: toFiniteNumber(raw.openWaterAveragePaceSecondsPer100m),
    openWaterPaceActivityCount,
  };
}

function resolveDashboardTrainingBuildSelection(value: unknown): DashboardTrainingBuildBenchmarkReference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<DerivedTrainingBuildBenchmarkReference>;
  const durationWeeks = toFiniteNumber(raw.durationWeeks);
  const windowStartDayMs = toFiniteNumber(raw.windowStartDayMs);
  const windowEndDayMs = toFiniteNumber(raw.windowEndDayMs);
  const selectionKey = typeof raw.selectionKey === 'string' && raw.selectionKey.trim() ? raw.selectionKey : null;
  if (
    (durationWeeks !== 8 && durationWeeks !== 10 && durationWeeks !== 12)
    || windowStartDayMs === null
    || windowEndDayMs === null
    || resolveUtcDayStartMs(windowStartDayMs) !== windowStartDayMs
    || resolveUtcDayStartMs(windowEndDayMs) !== windowEndDayMs
    || windowEndDayMs - windowStartDayMs !== ((durationWeeks * 7) - 1) * DAY_MS
    || !selectionKey
  ) {
    return null;
  }
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null;
  if (raw.mode === 'event') {
    const eventId = normalizeTrainingBuildEventId(raw.eventId);
    const expectedSelectionKey = getTrainingBuildBenchmarkSelectionKey({ mode: 'event', durationWeeks, eventId });
    return eventId && selectionKey === expectedSelectionKey ? {
      mode: 'event', durationWeeks, eventId, selectionKey, windowStartDayMs, windowEndDayMs, label,
    } : null;
  }
  if (raw.mode === 'period') {
    const rawEndDayMs = toFiniteNumber(raw.endDayMs);
    const endDayMs = normalizeTrainingBuildPeriodEndDayMs(rawEndDayMs);
    const expectedSelectionKey = getTrainingBuildBenchmarkSelectionKey({ mode: 'period', durationWeeks, endDayMs });
    return endDayMs === null
      || endDayMs !== rawEndDayMs
      || endDayMs !== windowEndDayMs
      || selectionKey !== expectedSelectionKey ? null : {
      mode: 'period', durationWeeks, endDayMs, selectionKey, windowStartDayMs, windowEndDayMs, label,
    };
  }
  return null;
}

function resolveDashboardTrainingRecoveryWindow(value: unknown): DashboardTrainingRecoveryWindow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<DerivedTrainingRecoveryWindow>;
  const periodDays = toFiniteNumber(raw.periodDays);
  const windowStartDayMs = toFiniteNumber(raw.windowStartDayMs);
  const windowEndDayMs = toFiniteNumber(raw.windowEndDayMs);
  const recordedNightCount = toFiniteNumber(raw.recordedNightCount);
  const expectedNightCount = toFiniteNumber(raw.expectedNightCount);
  const overnightHrvNightCount = toFiniteNumber(raw.overnightHrvNightCount);
  const averageSleepSeconds = raw.averageSleepSeconds === null ? null : toFiniteNumber(raw.averageSleepSeconds);
  const bedtimeVariationMinutes = raw.bedtimeVariationMinutes === null ? null : toFiniteNumber(raw.bedtimeVariationMinutes);
  const medianOvernightHrvMs = raw.medianOvernightHrvMs === null ? null : toFiniteNumber(raw.medianOvernightHrvMs);
  const provider = raw.provider === null ? null : normalizeSleepProvider(raw.provider);
  // Valid provider nights can omit local-time evidence, so regularity is optional even when sleep coverage is high.
  if (
    periodDays === null
    || !Number.isInteger(periodDays)
    || periodDays < 1
    || periodDays > 366
    || windowStartDayMs === null
    || windowEndDayMs === null
    || resolveUtcDayStartMs(windowStartDayMs) !== windowStartDayMs
    || resolveUtcDayStartMs(windowEndDayMs) !== windowEndDayMs
    || windowEndDayMs - windowStartDayMs !== (periodDays - 1) * DAY_MS
    || expectedNightCount !== periodDays
    || recordedNightCount === null
    || !Number.isInteger(recordedNightCount)
    || recordedNightCount < 0
    || recordedNightCount > periodDays
    || overnightHrvNightCount === null
    || !Number.isInteger(overnightHrvNightCount)
    || overnightHrvNightCount < 0
    || overnightHrvNightCount > recordedNightCount
    || (raw.provider !== null && provider === null)
    || (recordedNightCount === 0) !== (provider === null)
    || (raw.averageSleepSeconds !== null && (averageSleepSeconds === null || averageSleepSeconds < DERIVED_TRAINING_RECOVERY_MIN_VALID_SLEEP_SECONDS || averageSleepSeconds > DERIVED_TRAINING_RECOVERY_MAX_VALID_SLEEP_SECONDS))
    || (raw.bedtimeVariationMinutes !== null && (bedtimeVariationMinutes === null || bedtimeVariationMinutes < 0 || bedtimeVariationMinutes > DERIVED_TRAINING_RECOVERY_MAX_BEDTIME_VARIATION_MINUTES))
    || (raw.medianOvernightHrvMs !== null && (medianOvernightHrvMs === null || medianOvernightHrvMs <= 0))
    || (recordedNightCount >= DERIVED_TRAINING_RECOVERY_MIN_SLEEP_NIGHTS) !== (averageSleepSeconds !== null)
    || (
      bedtimeVariationMinutes !== null
      && recordedNightCount < DERIVED_TRAINING_RECOVERY_MIN_REGULARITY_NIGHTS
    )
    || (overnightHrvNightCount >= DERIVED_TRAINING_RECOVERY_MIN_HRV_NIGHTS) !== (medianOvernightHrvMs !== null)
  ) {
    return null;
  }
  const sufficientNightCount = getDerivedTrainingRecoveryMinimumComparableNights(periodDays);
  const expectedCoverage = recordedNightCount === 0
    ? 'none'
    : (recordedNightCount >= sufficientNightCount ? 'sufficient' : 'limited');
  if (raw.coverage !== expectedCoverage) {
    return null;
  }
  return {
    periodDays,
    windowStartDayMs,
    windowEndDayMs,
    provider,
    recordedNightCount,
    expectedNightCount: periodDays,
    coverage: expectedCoverage,
    averageSleepSeconds,
    bedtimeVariationMinutes,
    medianOvernightHrvMs,
    overnightHrvNightCount,
  };
}

function resolveDashboardTrainingRecoveryComparison(value: unknown): DashboardTrainingRecoveryComparison | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<DerivedTrainingRecoveryComparison>;
  const current = resolveDashboardTrainingRecoveryWindow(raw.current);
  const reference = resolveDashboardTrainingRecoveryWindow(raw.reference);
  if (!current || !reference) {
    return null;
  }
  const sameProvider = current.provider !== null && current.provider === reference.provider;
  const isComparable = sameProvider
    && current.coverage === 'sufficient'
    && reference.coverage === 'sufficient';
  if (raw.sameProvider !== sameProvider || raw.isComparable !== isComparable) {
    return null;
  }
  return { current, reference, sameProvider, isComparable };
}

function resolveDashboardTrainingBuildSuggestionMetric(
  value: unknown,
  allowZero = false,
): number | null | undefined {
  if (value === null) {
    return null;
  }
  const numericValue = toFiniteNumber(value);
  return numericValue !== null && (allowZero ? numericValue >= 0 : numericValue > 0)
    ? numericValue
    : undefined;
}

function resolveDashboardTrainingBuildSuggestions(value: unknown): DashboardTrainingBuildEventSuggestion[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const suggestions: DashboardTrainingBuildEventSuggestion[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }
    const raw = candidate as Partial<DerivedTrainingBuildEventSuggestion>;
    const eventId = normalizeTrainingBuildEventId(raw.eventId);
    const startDayMs = toFiniteNumber(raw.startDayMs);
    const distanceMeters = resolveDashboardTrainingBuildSuggestionMetric(raw.distanceMeters, true);
    const durationSeconds = resolveDashboardTrainingBuildSuggestionMetric(raw.durationSeconds);
    const trainingStressScore = resolveDashboardTrainingBuildSuggestionMetric(raw.trainingStressScore, true);
    if (
      !eventId
      || startDayMs === null
      || resolveUtcDayStartMs(startDayMs) !== startDayMs
      || distanceMeters === undefined
      || durationSeconds === undefined
      || trainingStressScore === undefined
    ) {
      return null;
    }
    suggestions.push({
      eventId,
      startDayMs,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null,
      distanceMeters,
      durationSeconds,
      trainingStressScore,
    });
  }
  return suggestions;
}

export function resolveDashboardTrainingBuildComparisonContext(payload: unknown): DashboardTrainingBuildComparisonContext | null {
  const raw = (payload || {}) as Partial<DerivedTrainingBuildComparisonMetricPayload>;
  const asOfDayMs = toFiniteNumber(raw.asOfDayMs);
  const recovery = resolveDashboardTrainingRecoveryComparison(raw.recovery);
  if (
    raw.dayBoundary !== 'UTC'
    || raw.excludesMergedEvents !== true
    || asOfDayMs === null
    || resolveUtcDayStartMs(asOfDayMs) !== asOfDayMs
    || !recovery
    || recovery.current.periodDays !== 28
    || recovery.current.windowEndDayMs !== asOfDayMs
    || recovery.current.windowStartDayMs !== asOfDayMs - (27 * DAY_MS)
    || recovery.reference.periodDays !== 84
    || recovery.reference.windowEndDayMs !== recovery.current.windowStartDayMs - DAY_MS
    || recovery.reference.windowStartDayMs !== recovery.reference.windowEndDayMs - (83 * DAY_MS)
    || !Array.isArray(raw.disciplines)
  ) {
    return null;
  }
  const disciplines = raw.disciplines.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return [];
    }
    const source = candidate as Partial<DerivedTrainingBuildComparisonDiscipline>;
    if (
      !isTrainingDiscipline(source.discipline)
      || (source.status !== 'not-configured' && source.status !== 'invalid-selection' && source.status !== 'ready')
      || !Array.isArray(source.suggestedEvents)
    ) {
      return [];
    }
    const suggestedRaces = resolveDashboardTrainingBuildSuggestions(source.suggestedRaces);
    const suggestedEvents = resolveDashboardTrainingBuildSuggestions(source.suggestedEvents);
    const suggestionIds = [...(suggestedRaces || []), ...(suggestedEvents || [])].map(suggestion => suggestion.eventId);
    if (!suggestedRaces || !suggestedEvents || new Set(suggestionIds).size !== suggestionIds.length) {
      return [];
    }
    const selection = resolveDashboardTrainingBuildSelection(source.selection);
    const current = source.current === null ? null : resolveDashboardTrainingBuildWindow(source.current);
    const benchmark = source.benchmark === null ? null : resolveDashboardTrainingBuildWindow(source.benchmark);
    const disciplineRecovery = source.recovery === null
      ? null
      : resolveDashboardTrainingRecoveryComparison(source.recovery);
    const durabilityComparisons = Array.isArray(source.durabilityComparisons)
      ? source.durabilityComparisons.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') {
          return [];
        }
        const comparison = candidate as Partial<DerivedTrainingBuildDurabilityComparison>;
        const context = resolveTrainingDurabilityContext(comparison.context);
        const currentSummary = comparison.current === null
          ? null
          : resolveTrainingDurabilityContextSummary(comparison.current);
        const benchmarkSummary = comparison.benchmark === null
          ? null
          : resolveTrainingDurabilityContextSummary(comparison.benchmark);
        if (
          !context
          || typeof comparison.isComparable !== 'boolean'
          || (comparison.current !== null && !currentSummary)
          || (comparison.benchmark !== null && !benchmarkSummary)
          || (
            comparison.isComparable
            && (
              !currentSummary
              || !benchmarkSummary
              || currentSummary.sampleCount < 2
              || benchmarkSummary.sampleCount < 2
            )
          )
        ) {
          return [];
        }
        return [{ context, current: currentSummary, benchmark: benchmarkSummary, isComparable: comparison.isComparable }];
      })
      : null;
    if (!durabilityComparisons || durabilityComparisons.length !== source.durabilityComparisons?.length) {
      return [];
    }
    if (source.status === 'ready') {
      if (
        !selection
        || !current
        || !benchmark
        || current.periodWeeks !== selection.durationWeeks
        || current.windowEndDayMs !== asOfDayMs
        || current.windowStartDayMs !== asOfDayMs - (((selection.durationWeeks * 7) - 1) * DAY_MS)
        || benchmark.periodWeeks !== selection.durationWeeks
        || benchmark.windowStartDayMs !== selection.windowStartDayMs
        || benchmark.windowEndDayMs !== selection.windowEndDayMs
        || benchmark.windowEndDayMs >= current.windowStartDayMs
        || !disciplineRecovery
        || disciplineRecovery.current.windowStartDayMs !== current.windowStartDayMs
        || disciplineRecovery.current.windowEndDayMs !== current.windowEndDayMs
        || disciplineRecovery.reference.windowStartDayMs !== benchmark.windowStartDayMs
        || disciplineRecovery.reference.windowEndDayMs !== benchmark.windowEndDayMs
      ) {
        return [];
      }
    } else if (source.selection !== null || source.current !== null || source.benchmark !== null || source.recovery !== null) {
      return [];
    }
    return [{
      discipline: source.discipline,
      status: source.status,
      selection,
      current,
      benchmark,
      recovery: disciplineRecovery,
      durabilityComparisons,
      suggestedRaces,
      suggestedEvents,
    }];
  });
  if (
    disciplines.length !== TRAINING_DISCIPLINES.length
    || new Set(disciplines.map(discipline => discipline.discipline)).size !== TRAINING_DISCIPLINES.length
  ) {
    return null;
  }
  return { asOfDayMs, recovery, disciplines };
}

export function resolveDashboardTrainingSwimPerformanceContext(
  payload: unknown,
): DashboardTrainingSwimPerformanceContext | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const raw = payload as Partial<DerivedTrainingSwimPerformanceMetricPayload>;
  const asOfDayMs = toFiniteNumber(raw.asOfDayMs);
  if (
    raw.dayBoundary !== 'UTC'
    || raw.weekCount !== 12
    || raw.excludesMergedEvents !== true
    || asOfDayMs === null
    || !Array.isArray(raw.weeks)
    || raw.weeks.length !== 24
  ) {
    return null;
  }
  const weeks: DerivedTrainingSwimWeek[] = [];
  for (const candidate of raw.weeks) {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }
    const week = candidate as Partial<DerivedTrainingSwimWeek>;
    const weekStartMs = toFiniteNumber(week.weekStartMs);
    const activityCount = toFiniteNumber(week.activityCount);
    const distanceMeters = toFiniteNumber(week.distanceMeters);
    const paceActivityCount = toFiniteNumber(week.paceActivityCount);
    const swolfLengthCount = toFiniteNumber(week.swolfLengthCount);
    const pace = toFiniteNumber(week.averagePaceSecondsPer100m);
    const swolf = toFiniteNumber(week.swolf);
    if (
      weekStartMs === null
      || (week.environment !== 'pool' && week.environment !== 'open-water')
      || activityCount === null || activityCount < 0 || !Number.isInteger(activityCount)
      || distanceMeters === null || distanceMeters < 0
      || paceActivityCount === null || paceActivityCount < 0 || !Number.isInteger(paceActivityCount)
      || swolfLengthCount === null || swolfLengthCount < 0 || !Number.isInteger(swolfLengthCount)
      || (pace !== null && pace <= 0)
      || (swolf !== null && swolf <= 0)
      || paceActivityCount > activityCount
      || (paceActivityCount === 0 ? pace !== null : pace === null || distanceMeters <= 0)
      || (swolfLengthCount === 0 ? swolf !== null : swolf === null || activityCount === 0)
      || (week.environment === 'open-water' && (swolf !== null || swolfLengthCount !== 0))
    ) {
      return null;
    }
    weeks.push({
      weekStartMs,
      environment: week.environment,
      activityCount,
      distanceMeters,
      averagePaceSecondsPer100m: pace,
      paceActivityCount,
      swolf,
      swolfLengthCount,
    });
  }
  const context = raw.swolfContext;
  const stroke = typeof context?.stroke === 'string' ? context.stroke.trim() : '';
  const poolLengthMeters = toFiniteNumber(context?.poolLengthMeters);
  if (context !== null && (!stroke || poolLengthMeters === null || poolLengthMeters <= 0)) {
    return null;
  }
  const hasSwolfEvidence = weeks.some(week => week.environment === 'pool' && week.swolfLengthCount > 0);
  if ((context !== null) !== hasSwolfEvidence) {
    return null;
  }
  const uniqueWeekEnvironments = new Set(weeks.map(week => `${week.weekStartMs}:${week.environment}`));
  const uniqueWeeks = new Set(weeks.map(week => week.weekStartMs));
  const sortedWeekStarts = [...uniqueWeeks].sort((left, right) => left - right);
  const expectedLastWeekStartMs = resolveUtcWeekStartMs(asOfDayMs);
  const hasExpectedWeekSequence = sortedWeekStarts.every((weekStartMs, index) => (
    weekStartMs === expectedLastWeekStartMs - ((11 - index) * 7 * 24 * 60 * 60 * 1000)
  ));
  const hasCompleteEnvironmentPairs = [...uniqueWeeks].every(weekStartMs => (
    uniqueWeekEnvironments.has(`${weekStartMs}:pool`)
    && uniqueWeekEnvironments.has(`${weekStartMs}:open-water`)
  ));
  if (
    uniqueWeekEnvironments.size !== 24
    || uniqueWeeks.size !== 12
    || !hasExpectedWeekSequence
    || !hasCompleteEnvironmentPairs
  ) {
    return null;
  }
  return {
    asOfDayMs,
    swolfContext: context === null ? null : { stroke, poolLengthMeters: poolLengthMeters as number },
    weeks: weeks.sort((left, right) => left.weekStartMs - right.weekStartMs || left.environment.localeCompare(right.environment)),
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

export function resolveDashboardFormNowContext(payload: unknown): DashboardFormNowContext | null {
  const normalized = (payload || {}) as Partial<DerivedFormNowMetricPayload>;
  return {
    latestDayMs: toFiniteNumber(normalized.latestDayMs),
    value: toFiniteNumber(normalized.value),
    trend8Weeks: normalizeTrendPoints(normalized.trend8Weeks, 'weekStartMs', 'value'),
  };
}

export function resolveDashboardFitnessCtlContext(
  points: readonly DashboardFormPoint[] | null | undefined,
  nowMs = Date.now(),
): DashboardFitnessCtlContext | null {
  return resolveDashboardFormMetricKpiContext(points, point => toFiniteNumber(point.ctl), nowMs);
}

export function resolveDashboardFatigueAtlContext(
  points: readonly DashboardFormPoint[] | null | undefined,
  nowMs = Date.now(),
): DashboardFatigueAtlContext | null {
  return resolveDashboardFormMetricKpiContext(points, point => toFiniteNumber(point.atl), nowMs);
}

export function resolveDashboardFormPlus7dContext(payload: unknown): DashboardFormPlus7dContext | null {
  const normalized = (payload || {}) as Partial<DerivedFormPlus7dMetricPayload>;
  return {
    latestDayMs: toFiniteNumber(normalized.latestDayMs),
    projectedDayMs: toFiniteNumber(normalized.projectedDayMs),
    value: toFiniteNumber(normalized.value),
    trend8Weeks: normalizeTrendPoints(normalized.trend8Weeks, 'weekStartMs', 'value'),
  };
}

export function resolveDashboardEasyPercentContext(payload: unknown): DashboardEasyPercentContext | null {
  const normalized = (payload || {}) as Partial<DerivedEasyPercentMetricPayload>;
  return {
    latestWeekStartMs: toFiniteNumber(normalized.latestWeekStartMs),
    value: toFiniteNumber(normalized.value),
    trend8Weeks: normalizeTrendPoints(normalized.trend8Weeks, 'weekStartMs', 'value'),
  };
}

export function resolveDashboardHardPercentContext(payload: unknown): DashboardHardPercentContext | null {
  const normalized = (payload || {}) as Partial<DerivedHardPercentMetricPayload>;
  return {
    latestWeekStartMs: toFiniteNumber(normalized.latestWeekStartMs),
    value: toFiniteNumber(normalized.value),
    trend8Weeks: normalizeTrendPoints(normalized.trend8Weeks, 'weekStartMs', 'value'),
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

export function resolveDashboardEfficiencyDelta4wContext(payload: unknown): DashboardEfficiencyDelta4wContext | null {
  const normalized = (payload || {}) as Partial<DerivedEfficiencyDelta4wMetricPayload>;
  return {
    latestWeekStartMs: toFiniteNumber(normalized.latestWeekStartMs),
    latestValue: toFiniteNumber(normalized.latestValue),
    baselineValue: toFiniteNumber(normalized.baselineValue),
    baselineWeekCount: toFiniteNumber(normalized.baselineWeekCount) || 0,
    deltaAbs: toFiniteNumber(normalized.deltaAbs),
    deltaPct: toFiniteNumber(normalized.deltaPct),
    trend8Weeks: normalizeTrendPoints(normalized.trend8Weeks, 'weekStartMs', 'value'),
  };
}
