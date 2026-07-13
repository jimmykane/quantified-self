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
  DerivedTrainingCapacityMetric,
  DerivedTrainingBuildBenchmarkReference,
  DerivedTrainingBuildComparisonDiscipline,
  DerivedTrainingBuildComparisonMetricPayload,
  DerivedTrainingBuildEventSuggestion,
  DerivedTrainingBuildRaceSuggestion,
  DerivedTrainingBuildWindow,
  DerivedTrainingDisciplineSummary,
  DerivedTrainingSummaryMetricPayload,
  DerivedTrainingSummaryWindow,
} from '@shared/derived-metrics';
import {
  extendDashboardFormPointsWithZeroLoadUntil,
  type DashboardFormPoint,
} from './dashboard-form.helper';

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

export type DashboardTrainingCapacityMetric = DerivedTrainingCapacityMetric;

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

export type DashboardTrainingBuildWindow = DerivedTrainingBuildWindow;
export type DashboardTrainingBuildEventSuggestion = DerivedTrainingBuildEventSuggestion;
export type DashboardTrainingBuildRaceSuggestion = DerivedTrainingBuildRaceSuggestion;
export type DashboardTrainingBuildBenchmarkReference = DerivedTrainingBuildBenchmarkReference;

export interface DashboardTrainingBuildComparisonDiscipline extends Omit<DerivedTrainingBuildComparisonDiscipline, 'current' | 'benchmark' | 'selection' | 'suggestedRaces' | 'suggestedEvents'> {
  current: DashboardTrainingBuildWindow | null;
  benchmark: DashboardTrainingBuildWindow | null;
  selection: DashboardTrainingBuildBenchmarkReference | null;
  suggestedRaces: DashboardTrainingBuildRaceSuggestion[];
  suggestedEvents: DashboardTrainingBuildEventSuggestion[];
}

export interface DashboardTrainingBuildComparisonContext {
  asOfDayMs: number;
  disciplines: DashboardTrainingBuildComparisonDiscipline[];
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
    || windowStartDayMs === null
    || windowEndDayMs === null
    || activityCount === null
    || durationSeconds === null
    || easySeconds === null
    || moderateSeconds === null
    || hardSeconds === null
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

function resolveDashboardTrainingCapacityMetric(value: unknown): DashboardTrainingCapacityMetric | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<DerivedTrainingCapacityMetric>;
  const currentSampleCount = toFiniteNumber(raw.currentSampleCount);
  const baselineSampleCount = toFiniteNumber(raw.baselineSampleCount);
  if (currentSampleCount === null || baselineSampleCount === null) {
    return null;
  }
  const trend = raw.trend === 'improving' || raw.trend === 'stable' || raw.trend === 'declining'
    ? raw.trend
    : null;
  return {
    sourceKey: typeof raw.sourceKey === 'string' && raw.sourceKey.trim().length ? raw.sourceKey : null,
    latestAtMs: toFiniteNumber(raw.latestAtMs),
    latestValue: toFiniteNumber(raw.latestValue),
    currentMedian: toFiniteNumber(raw.currentMedian),
    baselineMedian: toFiniteNumber(raw.baselineMedian),
    currentSampleCount,
    baselineSampleCount,
    deltaPct: toFiniteNumber(raw.deltaPct),
    trend,
  };
}

export function resolveDashboardTrainingSummaryContext(payload: unknown): DashboardTrainingSummaryContext | null {
  const raw = (payload || {}) as Partial<DerivedTrainingSummaryMetricPayload>;
  const asOfDayMs = toFiniteNumber(raw.asOfDayMs);
  const currentWindowDays = toFiniteNumber(raw.currentWindowDays);
  const baselineWindowDays = toFiniteNumber(raw.baselineWindowDays);
  if (asOfDayMs === null || currentWindowDays === null || baselineWindowDays === null || !Array.isArray(raw.disciplines)) {
    return null;
  }
  const disciplines = raw.disciplines
    .map((discipline) => {
      if (!discipline || typeof discipline !== 'object') {
        return null;
      }
      const source = discipline as Partial<DerivedTrainingDisciplineSummary>;
      if (source.discipline !== 'running' && source.discipline !== 'cycling') {
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
        vo2Max: resolveDashboardTrainingCapacityMetric(source.vo2Max),
        ftp: resolveDashboardTrainingCapacityMetric(source.ftp),
        criticalPower: resolveDashboardTrainingCapacityMetric(source.criticalPower),
      };
    })
    .filter((discipline): discipline is DashboardTrainingDisciplineSummary => !!discipline);
  return {
    asOfDayMs,
    currentWindowDays,
    baselineWindowDays,
    disciplines,
  };
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
  const efficiencySampleCount = toFiniteNumber(raw.efficiencySampleCount);
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
    || efficiencySampleCount === null
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
    efficiency: toFiniteNumber(raw.efficiency),
    efficiencySampleCount,
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
    || !selectionKey
  ) {
    return null;
  }
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label : null;
  if (raw.mode === 'race') {
    const raceEventId = typeof raw.raceEventId === 'string' && raw.raceEventId.trim() ? raw.raceEventId : null;
    return raceEventId ? {
      mode: 'race', durationWeeks, raceEventId, selectionKey, windowStartDayMs, windowEndDayMs, label,
    } : null;
  }
  if (raw.mode === 'period') {
    const endDayMs = toFiniteNumber(raw.endDayMs);
    return endDayMs === null ? null : {
      mode: 'period', durationWeeks, endDayMs, selectionKey, windowStartDayMs, windowEndDayMs, label,
    };
  }
  return null;
}

function resolveDashboardTrainingBuildRaceSuggestions(value: unknown): DashboardTrainingBuildRaceSuggestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return [];
    }
    const raw = candidate as Partial<DerivedTrainingBuildRaceSuggestion>;
    const eventId = typeof raw.eventId === 'string' && raw.eventId.trim() ? raw.eventId : null;
    const startDayMs = toFiniteNumber(raw.startDayMs);
    if (!eventId || startDayMs === null) {
      return [];
    }
    return [{
      eventId,
      startDayMs,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : null,
    }];
  });
}

function resolveDashboardTrainingBuildEventSuggestions(value: unknown): DashboardTrainingBuildEventSuggestion[] {
  return resolveDashboardTrainingBuildRaceSuggestions(value);
}

export function resolveDashboardTrainingBuildComparisonContext(payload: unknown): DashboardTrainingBuildComparisonContext | null {
  const raw = (payload || {}) as Partial<DerivedTrainingBuildComparisonMetricPayload>;
  const asOfDayMs = toFiniteNumber(raw.asOfDayMs);
  if (asOfDayMs === null || !Array.isArray(raw.disciplines)) {
    return null;
  }
  const disciplines = raw.disciplines.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return [];
    }
    const source = candidate as Partial<DerivedTrainingBuildComparisonDiscipline>;
    if (
      (source.discipline !== 'running' && source.discipline !== 'cycling')
      || (source.status !== 'not-configured' && source.status !== 'invalid-selection' && source.status !== 'ready')
      || !Array.isArray(source.suggestedEvents)
    ) {
      return [];
    }
    const selection = resolveDashboardTrainingBuildSelection(source.selection);
    const current = source.current === null ? null : resolveDashboardTrainingBuildWindow(source.current);
    const benchmark = source.benchmark === null ? null : resolveDashboardTrainingBuildWindow(source.benchmark);
    if (source.status === 'ready' && (!selection || !current || !benchmark)) {
      return [];
    }
    return [{
      discipline: source.discipline,
      status: source.status,
      selection,
      current,
      benchmark,
      suggestedRaces: resolveDashboardTrainingBuildRaceSuggestions(source.suggestedRaces),
      suggestedEvents: resolveDashboardTrainingBuildEventSuggestions(source.suggestedEvents),
    }];
  });
  if (
    disciplines.length !== 2
    || !disciplines.some(discipline => discipline.discipline === 'running')
    || !disciplines.some(discipline => discipline.discipline === 'cycling')
  ) {
    return null;
  }
  return { asOfDayMs, disciplines };
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
