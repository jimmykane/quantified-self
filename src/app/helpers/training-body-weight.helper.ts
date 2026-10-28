import type {
  DerivedBodyWeightTrendMetricPayload,
  DerivedBodyWeightTrendSeries,
} from '@shared/derived-metrics';
import { isHealthProvider } from '@shared/health';

type UnknownRecord = Record<string, unknown>;

/** Compatibility snapshot parser; the Training workspace no longer requests or renders this kind. */
export function resolveTrainingBodyWeightMetricPayload(
  value: unknown,
): DerivedBodyWeightTrendMetricPayload | null {
  const source = asRecord(value);
  const asOfDayMs = finiteNumber(source?.asOfDayMs);
  const latestWeightKg = nullablePositiveNumber(source?.latestWeightKg);
  const latestWeightDayMs = nullableFiniteNumber(source?.latestWeightDayMs);
  const median7dKg = nullablePositiveNumber(source?.median7dKg);
  const median28dKg = nullablePositiveNumber(source?.median28dKg);
  const change7dKg = nullableFiniteNumber(source?.change7dKg);
  const change7dPercent = nullableFiniteNumber(source?.change7dPercent);
  const change28dKg = nullableFiniteNumber(source?.change28dKg);
  const change28dPercent = nullableFiniteNumber(source?.change28dPercent);
  const recordedDayCount7d = nonNegativeInteger(source?.recordedDayCount7d);
  const recordedDayCount28d = nonNegativeInteger(source?.recordedDayCount28d);
  const points = Array.isArray(source?.points) ? source.points.map(normalizePoint) : [];
  const series = Array.isArray(source?.series)
    ? source.series.map(candidate => normalizeSeries(candidate, asOfDayMs))
    : [];
  const expectedFirstDayMs = asOfDayMs === null ? null : asOfDayMs - (27 * 24 * 60 * 60 * 1000);
  const hasValidPointSeries = expectedFirstDayMs !== null
    && points.length === 28
    && points.every((point, index) => point !== null && point.dayMs === expectedFirstDayMs + (index * 24 * 60 * 60 * 1000));
  const latestValuesArePaired = (latestWeightKg === null) === (latestWeightDayMs === null);
  const deltaPairsAreValid = (change7dKg === null) === (change7dPercent === null)
    && (change28dKg === null) === (change28dPercent === null);
  const hasValidSeries = series.every(candidate => candidate !== null)
    && new Set(series.map(candidate => `${candidate!.provider || ''}:${candidate!.sourceKey}`)).size === series.length
    && !(series.some(candidate => candidate?.sourceKind === 'health-measurement')
      && series.some(candidate => candidate?.sourceKind === 'workout-profile-context'));
  if (
    !source
    || source.dayBoundary !== 'UTC'
    || source.trendDays !== 28
    || source.comparisonWindowDays !== 7
    || source.minimumComparableDayCount !== 3
    || asOfDayMs === null
    || latestWeightKg === undefined
    || latestWeightDayMs === undefined
    || median7dKg === undefined
    || median28dKg === undefined
    || change7dKg === undefined
    || change7dPercent === undefined
    || change28dKg === undefined
    || change28dPercent === undefined
    || recordedDayCount7d === null
    || recordedDayCount28d === null
    || recordedDayCount7d > 7
    || recordedDayCount28d > 28
    || !latestValuesArePaired
    || !deltaPairsAreValid
    || !hasValidPointSeries
    || !hasValidSeries
  ) {
    return null;
  }
  return {
    dayBoundary: 'UTC',
    asOfDayMs,
    trendDays: 28,
    comparisonWindowDays: 7,
    minimumComparableDayCount: 3,
    latestWeightKg,
    latestWeightDayMs,
    median7dKg,
    median28dKg,
    change7dKg,
    change7dPercent,
    change28dKg,
    change28dPercent,
    recordedDayCount7d,
    recordedDayCount28d,
    points: points as DerivedBodyWeightTrendMetricPayload['points'],
    series: series as DerivedBodyWeightTrendSeries[],
  };
}

function normalizePoint(value: unknown): DerivedBodyWeightTrendMetricPayload['points'][number] | null {
  const source = asRecord(value);
  const dayMs = finiteNumber(source?.dayMs);
  const weightKg = nullablePositiveNumber(source?.weightKg);
  return source && dayMs !== null && weightKg !== undefined ? { dayMs, weightKg } : null;
}

function normalizeSeries(
  value: unknown,
  asOfDayMs: number | null,
): DerivedBodyWeightTrendSeries | null {
  const source = asRecord(value);
  const sourceKind = source?.sourceKind;
  const provider = source?.provider === null ? null : (isHealthProvider(source?.provider) ? source.provider : undefined);
  const sourceKey = typeof source?.sourceKey === 'string' && source.sourceKey.length > 0 && source.sourceKey.length <= 240
    ? source.sourceKey
    : null;
  const latestWeightKg = nullablePositiveNumber(source?.latestWeightKg);
  const latestWeightDayMs = nullableFiniteNumber(source?.latestWeightDayMs);
  const median7dKg = nullablePositiveNumber(source?.median7dKg);
  const median28dKg = nullablePositiveNumber(source?.median28dKg);
  const change7dKg = nullableFiniteNumber(source?.change7dKg);
  const change7dPercent = nullableFiniteNumber(source?.change7dPercent);
  const change28dKg = nullableFiniteNumber(source?.change28dKg);
  const change28dPercent = nullableFiniteNumber(source?.change28dPercent);
  const recordedDayCount7d = nonNegativeInteger(source?.recordedDayCount7d);
  const recordedDayCount28d = nonNegativeInteger(source?.recordedDayCount28d);
  const points = Array.isArray(source?.points) ? source.points.map(normalizePoint) : [];
  const expectedFirstDayMs = asOfDayMs === null ? null : asOfDayMs - (27 * 24 * 60 * 60 * 1000);
  const hasValidPointSeries = expectedFirstDayMs !== null
    && points.length === 28
    && points.every((point, index) => (
      point !== null && point.dayMs === expectedFirstDayMs + (index * 24 * 60 * 60 * 1000)
    ));
  if (
    !source
    || (sourceKind !== 'health-measurement' && sourceKind !== 'workout-profile-context')
    || provider === undefined
    || (sourceKind === 'health-measurement' && provider === null)
    || (sourceKind === 'workout-profile-context' && provider !== null)
    || sourceKey === null
    || latestWeightKg === undefined
    || latestWeightDayMs === undefined
    || (latestWeightKg === null) !== (latestWeightDayMs === null)
    || median7dKg === undefined
    || median28dKg === undefined
    || change7dKg === undefined
    || change7dPercent === undefined
    || change28dKg === undefined
    || change28dPercent === undefined
    || (change7dKg === null) !== (change7dPercent === null)
    || (change28dKg === null) !== (change28dPercent === null)
    || recordedDayCount7d === null
    || recordedDayCount7d > 7
    || recordedDayCount28d === null
    || recordedDayCount28d > 28
    || !hasValidPointSeries
  ) {
    return null;
  }
  return {
    sourceKind,
    provider,
    sourceKey,
    latestWeightKg,
    latestWeightDayMs,
    median7dKg,
    median28dKg,
    change7dKg,
    change7dPercent,
    change28dKg,
    change28dPercent,
    recordedDayCount7d,
    recordedDayCount28d,
    points: points as DerivedBodyWeightTrendSeries['points'],
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const numericValue = finiteNumber(value);
  return numericValue !== null && numericValue >= 0 && Number.isInteger(numericValue) ? numericValue : null;
}

function nullableFiniteNumber(value: unknown): number | null | undefined {
  return value === null ? null : finiteNumber(value) ?? undefined;
}

function nullablePositiveNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  const numericValue = finiteNumber(value);
  return numericValue !== null && numericValue > 0 ? numericValue : undefined;
}
