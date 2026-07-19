import { normalizeSleepProvider, type SleepProvider } from './sleep';

export type ReadinessLabel = 'Ready' | 'Mixed' | 'Recover';
export type ReadinessConfidence = 'high' | 'medium' | 'low';

export interface ReadinessSleepEvidencePoint {
  id: string;
  sleepDate: string;
  provider: SleepProvider | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  totalSeconds: number | null;
  score: number | null;
  averageHrvMs: number | null;
  averageHeartRateBpm: number | null;
  minimumHeartRateBpm: number | null;
}

export interface ReadinessSignalsContext {
  score: number;
  label: ReadinessLabel;
  confidence: ReadinessConfidence;
  availableSignalCount: number;
  baselineEvidenceCount: number;
  totalSignalCount: 4;
  form: number | null;
  rampRate: number | null;
  sleepScore: number | null;
  latestSleepAtMs: number | null;
  hrvRatio: number | null;
  averageHeartRateRatio: number | null;
  minimumHeartRateRatio: number | null;
  overnightHeartRateRatio: number | null;
}

export interface ReadinessScoreContext {
  score: number;
  availableSignalCount: number;
  availableWeight: number;
}

interface WeightedReadinessSignal {
  score: number;
  weight: number;
}

export const READINESS_TOTAL_SIGNAL_COUNT = 4 as const;
// Version 3 adds the average sleep-HR source field to historical readiness builds.
// It intentionally invalidates only the persisted readiness series, not all derived metrics.
export const READINESS_FORMULA_VERSION = 3 as const;
export const READINESS_SLEEP_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const READINESS_SLEEP_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const READINESS_SLEEP_BASELINE_NIGHTS = 14;
const READINESS_OVERNIGHT_HEART_RATE_AVERAGE_WEIGHT = 0.7;
const READINESS_OVERNIGHT_HEART_RATE_MINIMUM_WEIGHT = 0.3;
const READINESS_OVERNIGHT_HEART_RATE_MINIMUM_RATIO = 0.8;
const READINESS_OVERNIGHT_HEART_RATE_MAXIMUM_RATIO = 1.2;

/** Canonical readiness calculation shared by live views and derived history. */
export function buildReadinessSignals(input: {
  form?: unknown;
  rampRate?: unknown;
  sleepPoints?: readonly ReadinessSleepEvidencePoint[] | null;
  nowMs?: number;
}): ReadinessSignalsContext | null {
  const nowMs = toFiniteNumber(input.nowMs) ?? Date.now();
  const sleepPoints = (input.sleepPoints || [])
    .filter((point) => {
      const pointTime = resolveReadinessSleepPointTime(point);
      return pointTime > 0
        && pointTime <= nowMs
        && pointTime >= nowMs - READINESS_SLEEP_LOOKBACK_MS
        && normalizeSleepProvider(point.provider) !== null
        && isValidSleepDate(point.sleepDate);
    })
    .sort(compareReadinessSleepEvidence);
  const latestSleepCandidate = sleepPoints[sleepPoints.length - 1] || null;
  const latestSleepAgeMs = latestSleepCandidate
    ? nowMs - resolveReadinessSleepPointTime(latestSleepCandidate)
    : Number.POSITIVE_INFINITY;
  const latestSleep = latestSleepCandidate
    && latestSleepAgeMs >= 0
    && latestSleepAgeMs <= READINESS_SLEEP_MAX_AGE_MS
    ? latestSleepCandidate
    : null;
  const baselineSleep = latestSleep
    ? sleepPoints.filter(point => (
      point.id !== latestSleep.id
      && point.sleepDate !== latestSleep.sleepDate
      && point.provider === latestSleep.provider
    )).slice(-READINESS_SLEEP_BASELINE_NIGHTS)
    : [];

  const form = toFiniteNumber(input.form);
  const rampRate = toFiniteNumber(input.rampRate);
  const sleepScore = resolveSleepScore(latestSleep);
  const hrvRatio = resolveRatioToMedian(
    latestSleep?.averageHrvMs,
    baselineSleep.map(point => point.averageHrvMs),
  );
  const averageHeartRateRatio = resolveRatioToMedian(
    latestSleep?.averageHeartRateBpm,
    baselineSleep.map(point => point.averageHeartRateBpm),
  );
  const minimumHeartRateRatio = resolveRatioToMedian(
    latestSleep?.minimumHeartRateBpm,
    baselineSleep.map(point => point.minimumHeartRateBpm),
  );
  const overnightHeartRateRatio = combineReadinessOvernightHeartRateRatios(
    averageHeartRateRatio,
    minimumHeartRateRatio,
  );
  const scoreContext = calculateReadinessScore({
    form,
    rampRate,
    sleepScore,
    hrvRatio,
    overnightHeartRateRatio,
  });
  if (!scoreContext) {
    return null;
  }
  const baselineEvidenceCount = baselineSleep.filter(point => (
    toPositiveFiniteNumber(point.averageHrvMs) !== null
    || toPositiveFiniteNumber(point.averageHeartRateBpm) !== null
    || toPositiveFiniteNumber(point.minimumHeartRateBpm) !== null
  )).length;

  return {
    score: scoreContext.score,
    label: scoreContext.score >= 75 ? 'Ready' : scoreContext.score >= 55 ? 'Mixed' : 'Recover',
    confidence: resolveReadinessConfidence(scoreContext.availableWeight, baselineEvidenceCount),
    availableSignalCount: scoreContext.availableSignalCount,
    baselineEvidenceCount,
    totalSignalCount: READINESS_TOTAL_SIGNAL_COUNT,
    form,
    rampRate,
    sleepScore,
    latestSleepAtMs: latestSleep ? resolveReadinessSleepPointTime(latestSleep) : null,
    hrvRatio,
    averageHeartRateRatio,
    minimumHeartRateRatio,
    overnightHeartRateRatio,
  };
}

/** Recomputes the canonical weighted score from already-derived readiness drivers. */
export function calculateReadinessScore(input: {
  form?: unknown;
  rampRate?: unknown;
  sleepScore?: unknown;
  hrvRatio?: unknown;
  overnightHeartRateRatio?: unknown;
}): ReadinessScoreContext | null {
  const form = toFiniteNumber(input.form);
  const rampRate = toFiniteNumber(input.rampRate);
  const sleepScore = toFiniteNumber(input.sleepScore);
  const hrvRatio = toPositiveFiniteNumber(input.hrvRatio);
  const overnightHeartRateRatio = toPositiveFiniteNumber(input.overnightHeartRateRatio);
  const signals: WeightedReadinessSignal[] = [];
  const loadScore = resolveLoadReadinessScore(form, rampRate);
  if (loadScore !== null) {
    signals.push({ score: loadScore, weight: 40 });
  }
  if (sleepScore !== null) {
    signals.push({ score: clamp(sleepScore, 0, 100), weight: 25 });
  }
  if (hrvRatio !== null) {
    signals.push({ score: clamp(50 + ((hrvRatio - 1) * 100), 0, 100), weight: 20 });
  }
  if (overnightHeartRateRatio !== null) {
    signals.push({ score: clamp(50 + ((1 - overnightHeartRateRatio) * 100), 0, 100), weight: 15 });
  }
  if (!signals.length) {
    return null;
  }

  const availableWeight = signals.reduce((total, signal) => total + signal.weight, 0);
  const score = Math.round(
    signals.reduce((total, signal) => total + (signal.score * signal.weight), 0) / availableWeight,
  );
  return {
    score,
    availableSignalCount: signals.length,
    availableWeight,
  };
}

/** Combines average and minimum sleep-HR evidence into the single score driver. */
export function combineReadinessOvernightHeartRateRatios(
  averageHeartRateRatio: number | null,
  minimumHeartRateRatio: number | null,
): number | null {
  const boundedAverageRatio = averageHeartRateRatio === null
    ? null
    : clamp(
      averageHeartRateRatio,
      READINESS_OVERNIGHT_HEART_RATE_MINIMUM_RATIO,
      READINESS_OVERNIGHT_HEART_RATE_MAXIMUM_RATIO,
    );
  const boundedMinimumRatio = minimumHeartRateRatio === null
    ? null
    : clamp(
      minimumHeartRateRatio,
      READINESS_OVERNIGHT_HEART_RATE_MINIMUM_RATIO,
      READINESS_OVERNIGHT_HEART_RATE_MAXIMUM_RATIO,
    );
  if (boundedAverageRatio !== null && boundedMinimumRatio !== null) {
    return (boundedAverageRatio * READINESS_OVERNIGHT_HEART_RATE_AVERAGE_WEIGHT)
      + (boundedMinimumRatio * READINESS_OVERNIGHT_HEART_RATE_MINIMUM_WEIGHT);
  }
  return boundedAverageRatio ?? boundedMinimumRatio;
}

export function resolveReadinessSleepPointTime(point: ReadinessSleepEvidencePoint): number {
  return toFiniteNumber(point.endTimeMs) ?? toFiniteNumber(point.startTimeMs) ?? 0;
}

function compareReadinessSleepEvidence(
  left: ReadinessSleepEvidencePoint,
  right: ReadinessSleepEvidencePoint,
): number {
  return resolveReadinessSleepPointTime(left) - resolveReadinessSleepPointTime(right)
    || `${left.provider || ''}`.localeCompare(`${right.provider || ''}`)
    || left.sleepDate.localeCompare(right.sleepDate)
    || left.id.localeCompare(right.id);
}

function resolveLoadReadinessScore(form: number | null, rampRate: number | null): number | null {
  if (form === null && rampRate === null) {
    return null;
  }
  let score = form === null
    ? 65
    : form <= -30 ? 10
      : form <= -20 ? 25
        : form <= -10 ? 45
          : form < 8 ? 65
            : form <= 20 ? 90
              : 75;
  if (rampRate !== null && rampRate >= 5) {
    score -= 15;
  } else if (rampRate !== null && rampRate >= 2) {
    score -= 7;
  }
  return clamp(score, 0, 100);
}

function resolveSleepScore(point: ReadinessSleepEvidencePoint | null): number | null {
  const recordedScore = toFiniteNumber(point?.score);
  if (recordedScore !== null) {
    return clamp(recordedScore, 0, 100);
  }
  const totalSeconds = toFiniteNumber(point?.totalSeconds);
  if (totalSeconds === null || totalSeconds <= 0) {
    return null;
  }
  const hours = totalSeconds / 3600;
  return clamp(100 - (Math.abs(hours - 8) * 20), 0, 100);
}

function resolveRatioToMedian(value: unknown, baselineValues: readonly unknown[]): number | null {
  const current = toFiniteNumber(value);
  const baseline = baselineValues
    .map(toFiniteNumber)
    .filter((candidate): candidate is number => candidate !== null && candidate > 0)
    .sort((left, right) => left - right);
  if (current === null || current <= 0 || baseline.length < 3) {
    return null;
  }
  const middle = Math.floor(baseline.length / 2);
  const median = baseline.length % 2
    ? baseline[middle]
    : (baseline[middle - 1] + baseline[middle]) / 2;
  return median > 0 ? current / median : null;
}

export function resolveReadinessConfidence(
  availableWeight: number,
  baselineEvidenceCount: number,
): ReadinessConfidence {
  if (availableWeight >= 85 && baselineEvidenceCount >= 5) {
    return 'high';
  }
  if (availableWeight >= 60) {
    return 'medium';
  }
  return 'low';
}

function isValidSleepDate(value: unknown): boolean {
  const sleepDate = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sleepDate)) {
    return false;
  }
  const dayMs = Date.parse(`${sleepDate}T00:00:00.000Z`);
  return Number.isFinite(dayMs) && new Date(dayMs).toISOString().slice(0, 10) === sleepDate;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toPositiveFiniteNumber(value: unknown): number | null {
  const numericValue = toFiniteNumber(value);
  return numericValue !== null && numericValue > 0 ? numericValue : null;
}
