import type {
  DerivedTrainingReadinessHistoryPoint,
  DerivedTrainingReadinessMetricPayload,
} from './derived-metrics';
import {
  calculateReadinessScore,
  READINESS_SLEEP_MAX_AGE_MS,
  resolveReadinessConfidence,
} from './readiness';

type UnknownRecord = Record<string, unknown>;

const READINESS_LABELS = ['Ready', 'Mixed', 'Recover'] as const;
const READINESS_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Canonical runtime validator for persisted Training readiness history.
 *
 * Both Functions freshness checks and the frontend use this boundary so a
 * ready document with an obsolete or malformed payload is rebuilt instead of
 * remaining permanently stuck in a client-side preparing state.
 */
export function normalizeDerivedTrainingReadinessMetricPayload(
  value: unknown,
): DerivedTrainingReadinessMetricPayload | null {
  const source = asRecord(value);
  const asOfDayMs = finiteNumber(source?.asOfDayMs);
  const generatedAtMs = finiteNumber(source?.generatedAtMs);
  const points = Array.isArray(source?.points)
    ? source.points.map(normalizeTrainingReadinessHistoryPoint)
    : [];
  if (
    !source
    || source.dayBoundary !== 'UTC'
    || source.historyDays !== 14
    || asOfDayMs === null
    || generatedAtMs === null
    || points.length !== 14
    || points.some(point => point === null)
  ) {
    return null;
  }
  const normalizedPoints = points as DerivedTrainingReadinessHistoryPoint[];
  const firstDayMs = asOfDayMs - (13 * DAY_MS);
  if (
    !Number.isInteger(asOfDayMs)
    || asOfDayMs < 0
    || asOfDayMs % DAY_MS !== 0
    || !Number.isInteger(generatedAtMs)
    || generatedAtMs < asOfDayMs
    || generatedAtMs >= asOfDayMs + DAY_MS
    || normalizedPoints.some((point, index) => (
      point.dayMs !== firstDayMs + (index * DAY_MS)
      || !isValidTrainingReadinessHistoryPoint(
        point,
        point.dayMs === asOfDayMs ? generatedAtMs : point.dayMs + DAY_MS - 1,
      )
    ))
  ) {
    return null;
  }
  return {
    dayBoundary: 'UTC',
    asOfDayMs,
    generatedAtMs,
    historyDays: 14,
    points: normalizedPoints,
  };
}

function normalizeTrainingReadinessHistoryPoint(value: unknown): DerivedTrainingReadinessHistoryPoint | null {
  const source = asRecord(value);
  const dayMs = finiteNumber(source?.dayMs);
  const score = nullablePercentage(source?.score);
  const label = source?.label === null
    ? null
    : READINESS_LABELS.includes(source?.label as typeof READINESS_LABELS[number])
      ? source?.label as typeof READINESS_LABELS[number]
      : undefined;
  const confidence = source?.confidence === null
    ? null
    : READINESS_CONFIDENCE_LEVELS.includes(source?.confidence as typeof READINESS_CONFIDENCE_LEVELS[number])
      ? source?.confidence as typeof READINESS_CONFIDENCE_LEVELS[number]
      : undefined;
  const availableSignalCount = nonNegativeInteger(source?.availableSignalCount);
  const baselineEvidenceCount = nonNegativeInteger(source?.baselineEvidenceCount);
  const form = nullableFiniteNumber(source?.form);
  const rampRate = nullableFiniteNumber(source?.rampRate);
  const sleepScore = nullablePercentage(source?.sleepScore);
  const latestSleepAtMs = nullableNonNegativeNumber(source?.latestSleepAtMs);
  const hrvRatio = nullableNonNegativeNumber(source?.hrvRatio);
  const minimumHeartRateRatio = nullableNonNegativeNumber(source?.minimumHeartRateRatio);
  if (
    !source
    || dayMs === null
    || score === undefined
    || label === undefined
    || confidence === undefined
    || availableSignalCount === null
    || availableSignalCount > 4
    || baselineEvidenceCount === null
    || baselineEvidenceCount > 14
    || source.totalSignalCount !== 4
    || form === undefined
    || rampRate === undefined
    || sleepScore === undefined
    || latestSleepAtMs === undefined
    || hrvRatio === undefined
    || minimumHeartRateRatio === undefined
    || !Number.isInteger(dayMs)
    || (score !== null && !Number.isInteger(score))
    || (latestSleepAtMs !== null && !Number.isInteger(latestSleepAtMs))
    || (hrvRatio !== null && hrvRatio <= 0)
    || (minimumHeartRateRatio !== null && minimumHeartRateRatio <= 0)
    || (score === null && (
      label !== null
      || confidence !== null
      || availableSignalCount !== 0
      || baselineEvidenceCount !== 0
    ))
    || (score !== null && (label === null || confidence === null || availableSignalCount < 1))
  ) {
    return null;
  }
  return {
    dayMs,
    score,
    label,
    confidence,
    availableSignalCount,
    baselineEvidenceCount,
    totalSignalCount: 4,
    form,
    rampRate,
    sleepScore,
    latestSleepAtMs,
    hrvRatio,
    minimumHeartRateRatio,
  };
}

function isValidTrainingReadinessHistoryPoint(
  point: DerivedTrainingReadinessHistoryPoint,
  evaluatedAtMs: number,
): boolean {
  const scoreContext = calculateReadinessScore(point);
  const hasSleepSignal = point.sleepScore !== null
    || point.hrvRatio !== null
    || point.minimumHeartRateRatio !== null;
  if (point.score === null) {
    return scoreContext === null
      && point.availableSignalCount === 0
      && point.latestSleepAtMs === null;
  }
  if (
    !scoreContext
    || point.score !== scoreContext.score
    || point.availableSignalCount !== scoreContext.availableSignalCount
    || (point.latestSleepAtMs === null && point.baselineEvidenceCount !== 0)
  ) {
    return false;
  }
  const expectedLabel = point.score >= 75 ? 'Ready' : point.score >= 55 ? 'Mixed' : 'Recover';
  if (point.label !== expectedLabel) {
    return false;
  }
  if (hasSleepSignal && point.latestSleepAtMs === null) {
    return false;
  }
  if (point.confidence !== resolveReadinessConfidence(
    scoreContext.availableWeight,
    point.baselineEvidenceCount,
  )) {
    return false;
  }
  return point.latestSleepAtMs === null || (
    point.latestSleepAtMs <= evaluatedAtMs
    && point.latestSleepAtMs >= evaluatedAtMs - READINESS_SLEEP_MAX_AGE_MS
  );
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const numericValue = finiteNumber(value);
  return numericValue !== null && numericValue >= 0 ? numericValue : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const numericValue = nonNegativeNumber(value);
  return numericValue !== null && Number.isInteger(numericValue) ? numericValue : null;
}

function percentage(value: unknown): number | null {
  const numericValue = finiteNumber(value);
  return numericValue !== null && numericValue >= 0 && numericValue <= 100 ? numericValue : null;
}

function nullableFiniteNumber(value: unknown): number | null | undefined {
  return value === null ? null : finiteNumber(value) ?? undefined;
}

function nullableNonNegativeNumber(value: unknown): number | null | undefined {
  return value === null ? null : nonNegativeNumber(value) ?? undefined;
}

function nullablePercentage(value: unknown): number | null | undefined {
  return value === null ? null : percentage(value) ?? undefined;
}
