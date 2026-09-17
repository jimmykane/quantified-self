import { normalizeSleepProvider } from './sleep';
import {
  buildReadinessEvaluation as buildLegacyReadinessEvaluation,
  calculateReadinessScore as calculateLegacyReadinessScore,
  resolveReadinessConfidence, resolveReadinessSleepPointTime,
  type ReadinessSignalsContext as LegacyReadinessSignalsContext,
  type ReadinessEvaluation as LegacyReadinessEvaluation,
  type ReadinessSleepEvidencePoint, type ReadinessScoreContext,
} from './readiness-legacy';
import {
  calculatePersonalMetricRange, collapsePersonalMetricObservationsByCalendarDate,
  HRV_PERSONAL_RANGE_OPTIONS, type PersonalMetricRangeObservation, type PersonalMetricRangeResult,
} from './personal-metric-range';

export {
  READINESS_TOTAL_SIGNAL_COUNT, READINESS_SLEEP_MAX_AGE_MS, READINESS_SLEEP_BASELINE_NIGHTS,
  combineReadinessOvernightHeartRateRatios, resolveReadinessConfidence, resolveReadinessSleepPointTime,
  type ReadinessLabel, type ReadinessConfidence, type ReadinessRatioEvidence,
  type ReadinessSleepEvidencePoint, type ReadinessScoreContext,
} from './readiness-legacy';

export const READINESS_FORMULA_VERSION = 4 as const;
export const READINESS_EVIDENCE_VERSION = 1 as const;
export const READINESS_SLEEP_LOOKBACK_MS = HRV_PERSONAL_RANGE_OPTIONS.baselineWindowDays * 86400000;
const READINESS_HRV_TREND_MINIMUM_DAYS = 4;
const READINESS_HRV_TREND_MINIMUM_CHANGE_MS = 1;
const READINESS_HRV_TREND_MINIMUM_CHANGE_RATIO = 0.03;

export type ReadinessHrvRecentTrend = 'rising' | 'stable' | 'falling';

/** Identity-free evidence using the same daily observations and range as the HRV charts. */
export type ReadinessHrvPersonalRange = PersonalMetricRangeResult & {
  latestMs: number | null;
  latestAtMs: number | null;
};

export interface ReadinessSignalsContext extends LegacyReadinessSignalsContext {
  /** Seven-day average / sixty-day mean. Never a last-night comparison. */
  hrvRatio: number | null;
  hrvPersonalRange: ReadinessHrvPersonalRange | null;
}

export interface ReadinessEvaluation extends Omit<LegacyReadinessEvaluation, 'signals' | 'hrv'> {
  signals: ReadinessSignalsContext;
}

type ReadinessInput = {
  form?: unknown; rampRate?: unknown;
  sleepPoints?: readonly ReadinessSleepEvidencePoint[] | null;
  nowMs?: number;
};

export function buildReadinessSignals(input: ReadinessInput): ReadinessSignalsContext | null {
  return buildReadinessEvaluation(input)?.signals ?? null;
}

/** Load, Sleep and Overnight HR retain their existing selection and weighting. */
export function buildReadinessEvaluation(input: ReadinessInput): ReadinessEvaluation | null {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs! : Date.now();
  const legacy = buildLegacyReadinessEvaluation({ ...input, nowMs });
  const hrvPersonalRange = buildReadinessHrvPersonalRange(input.sleepPoints ?? [], nowMs);
  const hrvRatio = hrvPersonalRange?.currentAverage !== null && hrvPersonalRange?.baselineAverage
    ? hrvPersonalRange.currentAverage / hrvPersonalRange.baselineAverage : null;
  const drivers = {
    form: legacy?.signals.form ?? null,
    rampRate: legacy?.signals.rampRate ?? null,
    sleepScore: legacy?.signals.sleepScore ?? null,
    overnightHeartRateRatio: legacy?.signals.overnightHeartRateRatio ?? null,
    hrvPersonalRange,
  };
  const score = calculateReadinessScore(drivers);
  if (!score) return null;
  const baselineEvidenceCount = legacy?.signals.baselineEvidenceCount ?? 0;
  const emptyRatio = { latestValue: null, baselineMedian: null, baselineValueCount: 0, ratio: null };
  return {
    latestSleep: legacy?.latestSleep ?? null,
    baselineSleep: legacy?.baselineSleep ?? [],
    averageHeartRate: legacy?.averageHeartRate ?? emptyRatio,
    minimumHeartRate: legacy?.minimumHeartRate ?? emptyRatio,
    signals: {
      ...drivers,
      score: score.score,
      label: score.score >= 75 ? 'Ready' : score.score >= 55 ? 'Mixed' : 'Recover',
      confidence: resolveReadinessConfidence(score.availableWeight, baselineEvidenceCount),
      availableSignalCount: score.availableSignalCount,
      baselineEvidenceCount,
      totalSignalCount: 4,
      latestSleepAtMs: legacy?.signals.latestSleepAtMs ?? null,
      hrvRatio,
      averageHeartRateRatio: legacy?.signals.averageHeartRateRatio ?? null,
      minimumHeartRateRatio: legacy?.signals.minimumHeartRateRatio ?? null,
    },
  };
}

export function buildReadinessHrvPersonalRange(
  points: readonly ReadinessSleepEvidencePoint[], nowMs: number,
): ReadinessHrvPersonalRange | null {
  const observations = readinessHrvObservationSeries(points, nowMs);
  const latest = observations[observations.length - 1];
  if (!latest) return null;
  return {
    ...calculatePersonalMetricRange(observations, nowMs, HRV_PERSONAL_RANGE_OPTIONS),
    latestMs: latest.value,
    latestAtMs: latest.timestampMs,
  };
}

/**
 * Describes the direction of the same source-separated nightly HRV series used
 * by Readiness. This is display context only: it never changes the score or
 * personal-range classification.
 */
export function resolveReadinessHrvRecentTrend(
  points: readonly ReadinessSleepEvidencePoint[], nowMs: number,
): ReadinessHrvRecentTrend | null {
  const currentStartTimeMs = nowMs - HRV_PERSONAL_RANGE_OPTIONS.currentWindowDays * 86400000 + 1;
  const dailyValues = collapsePersonalMetricObservationsByCalendarDate(
    readinessHrvObservationSeries(points, nowMs)
      .filter(observation => observation.timestampMs >= currentStartTimeMs),
  );
  if (dailyValues.length < READINESS_HRV_TREND_MINIMUM_DAYS) return null;

  const firstTimeMs = dailyValues[0].timestampMs;
  const xValues = dailyValues.map(point => (point.timestampMs - firstTimeMs) / 86400000);
  const xAverage = average(xValues);
  const valueAverage = average(dailyValues.map(point => point.value));
  const denominator = xValues.reduce((total, value) => total + (value - xAverage) ** 2, 0);
  if (denominator === 0) return 'stable';
  const slope = dailyValues.reduce((total, point, index) =>
    total + (xValues[index] - xAverage) * (point.value - valueAverage), 0) / denominator;
  const projectedChange = slope * (xValues[xValues.length - 1] - xValues[0]);
  const meaningfulChange = Math.max(
    READINESS_HRV_TREND_MINIMUM_CHANGE_MS,
    valueAverage * READINESS_HRV_TREND_MINIMUM_CHANGE_RATIO,
  );
  return Math.abs(projectedChange) < meaningfulChange
    ? 'stable'
    : projectedChange > 0 ? 'rising' : 'falling';
}

function readinessHrvObservationSeries(
  points: readonly ReadinessSleepEvidencePoint[], nowMs: number,
): PersonalMetricRangeObservation[] {
  const inWindow = (time: number) => time > nowMs - READINESS_SLEEP_LOOKBACK_MS && time <= nowMs;
  const eligible = points.flatMap(point => {
    if (normalizeSleepProvider(point.provider) === null || !/^\d{4}-\d{2}-\d{2}$/.test(point.sleepDate)) return [];
    const observations = readinessHrvObservations(point).filter(observation =>
      Number.isFinite(observation.value) && observation.value > 0 && inWindow(observation.timestampMs));
    const pointTime = resolveReadinessSleepPointTime(point);
    // A grouped night may include a later fragment. Retain original completed HRV
    // observations at historical cutoffs instead of withholding the entire group.
    const selectedAtMs = inWindow(pointTime) ? pointTime : Math.max(-Infinity, ...observations.map(value => value.timestampMs));
    return inWindow(selectedAtMs) ? [{ point, observations, selectedAtMs }] : [];
  }).sort((a, b) => a.selectedAtMs - b.selectedAtMs || a.point.id.localeCompare(b.point.id));
  const latestSleep = eligible[eligible.length - 1];
  if (!latestSleep) return [];
  const observations = eligible.filter(({ point }) => point.provider === latestSleep.point.provider
    && (point.sourceKey ?? null) === (latestSleep.point.sourceKey ?? null))
    .flatMap(entry => entry.observations)
    .sort((a, b) => a.timestampMs - b.timestampMs || (a.sourceKey ?? '').localeCompare(b.sourceKey ?? ''));
  const latest = observations[observations.length - 1];
  return latest
    ? observations.filter(point => (point.sourceKey ?? null) === (latest.sourceKey ?? null))
    : [];
}

/** Keep original per-day readings; averaging fragments first would change the chart's daily median. */
export function readinessHrvObservations(point: Pick<ReadinessSleepEvidencePoint,
  'averageHrvMs' | 'hrvSourceKey' | 'hrvObservations' | 'sleepDate' | 'startTimeMs' | 'endTimeMs'>) {
  return point.hrvObservations ?? (typeof point.averageHrvMs === 'number' && point.averageHrvMs > 0
    ? [{ timestampMs: point.endTimeMs ?? point.startTimeMs ?? 0, calendarDate: point.sleepDate,
      value: point.averageHrvMs, ...(point.hrvSourceKey ? { sourceKey: point.hrvSourceKey } : {}) }] : []);
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * HRV retains its neutral score (50) and 20% weight inside the personal range.
 * Outside either bound, deduct the percentage distance from that bound relative
 * to the baseline mean. Unusually high HRV cannot earn an automatic bonus.
 */
export function resolveReadinessHrvScore(range: ReadinessHrvPersonalRange | null | undefined): number | null {
  if (!range?.normalRange || range.currentAverage === null || !range.baselineAverage) return null;
  const distance = Math.max(0, range.normalRange.min - range.currentAverage,
    range.currentAverage - range.normalRange.max);
  return Math.max(0, 50 - distance / range.baselineAverage * 100);
}

export function calculateReadinessScore(input: {
  form?: unknown; rampRate?: unknown; sleepScore?: unknown;
  hrvPersonalRange?: ReadinessHrvPersonalRange | null;
  overnightHeartRateRatio?: unknown;
}): ReadinessScoreContext | null {
  const hrvScore = resolveReadinessHrvScore(input.hrvPersonalRange);
  // Reuse the exact weighted calculation. Its HRV mapping is linear in this
  // bounded interval, so this inverse supplies the range-based component score.
  return calculateLegacyReadinessScore({ ...input, hrvRatio: hrvScore === null ? null : 1 + (hrvScore - 50) / 100 });
}
