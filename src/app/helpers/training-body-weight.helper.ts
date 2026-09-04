import { DataWeight, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type {
  DerivedBodyWeightTrendMetricPayload,
  DerivedBodyWeightTrendSeries,
  DerivedBodyWeightSourceKind,
} from '@shared/derived-metrics';
import { HEALTH_PROVIDERS, type HealthProvider, isHealthProvider } from '@shared/health';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';

type UnknownRecord = Record<string, unknown>;

export type TrainingBodyWeightViewState = 'preparing' | 'empty' | 'ready' | 'unavailable';

export interface TrainingBodyWeightTrendPointViewModel {
  dayMs: number;
  weightKg: number | null;
}

export interface TrainingBodyWeightViewModel {
  state: TrainingBodyWeightViewState;
  isUpdating: boolean;
  latestWeightText: string;
  latestRecordedText: string;
  median7dText: string;
  median28dText: string;
  change7dText: string;
  change28dText: string;
  coverageText: string;
  statusText: string;
  sourceText: string;
  chartAriaLabel: string;
  chartStartLabel: string;
  chartEndLabel: string;
  chartPoints: TrainingBodyWeightTrendPointViewModel[];
  series: TrainingBodyWeightSeriesViewModel[];
}

export interface TrainingBodyWeightSeriesViewModel {
  sourceKind: DerivedBodyWeightSourceKind;
  sourceLabel: string;
  latestWeightText: string;
  latestRecordedText: string;
  median7dText: string;
  median28dText: string;
  change7dText: string;
  change28dText: string;
  coverageText: string;
  sourceText: string;
  chartAriaLabel: string;
  chartStartLabel: string;
  chartEndLabel: string;
  chartPoints: TrainingBodyWeightTrendPointViewModel[];
}

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

export function buildTrainingBodyWeightViewModel(
  payload: DerivedBodyWeightTrendMetricPayload | null | undefined,
  status: string | null | undefined,
  unitSettings: UserUnitSettingsInterface | null | undefined,
  locale?: string,
): TrainingBodyWeightViewModel {
  const sourceText = 'Each source stays separate. Health measurements are preferred; workout profile Weight appears only when no recorded Health measurement exists. Weight does not change Readiness, Form, or Training state.';
  const metricStatus = `${status || ''}`;
  if (!payload) {
    const unavailable = metricStatus === 'failed';
    return {
      state: unavailable ? 'unavailable' : 'preparing',
      isUpdating: !unavailable,
      latestWeightText: '--',
      latestRecordedText: unavailable ? 'Snapshot unavailable' : 'Preparing recorded measurements',
      median7dText: '--',
      median28dText: '--',
      change7dText: '--',
      change28dText: '--',
      coverageText: '0/28 days recorded',
      statusText: unavailable
        ? 'Body-weight trend is unavailable right now. Refresh to request another snapshot.'
        : 'Preparing the recorded body-weight trend.',
      sourceText,
      chartAriaLabel: 'No body-weight trend is available.',
      chartStartLabel: '',
      chartEndLabel: '',
      chartPoints: [],
      series: [],
    };
  }

  const isUpdating = metricStatus !== 'ready';
  const series = payload.series.map((candidate, index, candidates) => buildSeriesViewModel(
    candidate,
    buildSourceLabel(candidate, index, candidates),
    unitSettings,
    locale,
  ));
  const firstSeries = series[0];
  if (!series.some(candidate => candidate.chartPoints.some(point => point.weightKg !== null))) {
    return {
      state: 'empty',
      isUpdating,
      latestWeightText: '--',
      latestRecordedText: 'No recorded measurement in this snapshot',
      median7dText: '--',
      median28dText: '--',
      change7dText: '--',
      change28dText: '--',
      coverageText: '0/28 days recorded',
      statusText: isUpdating
        ? 'Updating recorded measurements; no current 28-day entry is available yet.'
        : 'No body-weight measurement was recorded in the last 28 days.',
      sourceText,
      chartAriaLabel: 'No body-weight measurement was recorded in this 28-day window.',
      chartStartLabel: formatUtcDate(payload.points[0]?.dayMs, locale),
      chartEndLabel: formatUtcDate(payload.points.at(-1)?.dayMs, locale),
      chartPoints: [],
      series,
    };
  }

  return {
    state: 'ready',
    isUpdating,
    latestWeightText: firstSeries?.latestWeightText || '--',
    latestRecordedText: firstSeries?.latestRecordedText || 'No recorded measurement in this snapshot',
    median7dText: firstSeries?.median7dText || '--',
    median28dText: firstSeries?.median28dText || '--',
    change7dText: firstSeries?.change7dText || '--',
    change28dText: firstSeries?.change28dText || '--',
    coverageText: firstSeries?.coverageText || '0/28 days recorded',
    statusText: isUpdating
      ? 'Updating recorded measurements; the latest complete trend remains visible.'
      : '7-day and 28-day changes compare rolling medians with the preceding equal-length window.',
    sourceText,
    chartAriaLabel: firstSeries?.chartAriaLabel || 'No body-weight trend is available.',
    chartStartLabel: firstSeries?.chartStartLabel || '',
    chartEndLabel: firstSeries?.chartEndLabel || '',
    chartPoints: firstSeries?.chartPoints || [],
    series,
  };
}

function buildSeriesViewModel(
  payload: DerivedBodyWeightTrendSeries,
  sourceLabel: string,
  unitSettings: UserUnitSettingsInterface | null | undefined,
  locale?: string,
): TrainingBodyWeightSeriesViewModel {
  const values = payload.points.flatMap(point => point.weightKg === null ? [] : [point.weightKg]);
  return {
    sourceKind: payload.sourceKind,
    sourceLabel,
    latestWeightText: formatWeight(payload.latestWeightKg, unitSettings),
    latestRecordedText: payload.latestWeightDayMs === null
      ? 'No recorded measurement in this snapshot'
      : `Latest recorded ${formatUtcDate(payload.latestWeightDayMs, locale)}`,
    median7dText: formatWeight(payload.median7dKg, unitSettings),
    median28dText: formatWeight(payload.median28dKg, unitSettings),
    change7dText: formatChange(payload.change7dKg, payload.change7dPercent, unitSettings, locale),
    change28dText: formatChange(payload.change28dKg, payload.change28dPercent, unitSettings, locale),
    coverageText: `${payload.recordedDayCount28d}/28 days recorded`,
    sourceText: payload.sourceKind === 'health-measurement'
      ? 'Recorded Health measurements; same-day readings are reduced to a median.'
      : 'Workout profile context fallback; this is not a weigh-in.',
    chartAriaLabel: values.length
      ? `${sourceLabel} body-weight measurements over 28 UTC days. ${values.length} days have recorded measurements; missing days are gaps.`
      : `${sourceLabel} has no body-weight measurement in this 28-day window.`,
    chartStartLabel: formatUtcDate(payload.points[0]?.dayMs, locale),
    chartEndLabel: formatUtcDate(payload.points.at(-1)?.dayMs, locale),
    chartPoints: values.length
      ? payload.points.map(point => ({ dayMs: point.dayMs, weightKg: point.weightKg }))
      : [],
  };
}

function buildSourceLabel(
  source: DerivedBodyWeightTrendSeries,
  index: number,
  sources: readonly DerivedBodyWeightTrendSeries[],
): string {
  if (source.sourceKind === 'workout-profile-context') {
    const workoutIndex = sources.slice(0, index + 1)
      .filter(candidate => candidate.sourceKind === 'workout-profile-context').length;
    const workoutCount = sources.filter(candidate => candidate.sourceKind === 'workout-profile-context').length;
    return workoutCount > 1 ? `Workout profile context ${workoutIndex}` : 'Workout profile context';
  }
  const provider = source.provider;
  const providerName = provider ? formatProvider(provider) : 'Health measurement';
  const providerSources = sources.filter(candidate => (
    candidate.sourceKind === 'health-measurement' && candidate.provider === provider
  ));
  const providerIndex = sources.slice(0, index + 1).filter(candidate => (
    candidate.sourceKind === 'health-measurement' && candidate.provider === provider
  )).length;
  return providerSources.length > 1 ? `${providerName} account ${providerIndex}` : providerName;
}

function formatProvider(provider: HealthProvider): string {
  switch (provider) {
    case HEALTH_PROVIDERS.GarminAPI: return 'Garmin';
    case HEALTH_PROVIDERS.SuuntoApp: return 'Suunto';
    case HEALTH_PROVIDERS.COROSAPI: return 'COROS';
    case HEALTH_PROVIDERS.WahooAPI: return 'Wahoo';
    case HEALTH_PROVIDERS.QuantifiedSelf: return 'Manual';
  }
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

function formatWeight(value: number | null, unitSettings: UserUnitSettingsInterface | null | undefined): string {
  if (value === null) {
    return '--';
  }
  const data = new DataWeight(value);
  return resolveUnitAwareDisplayStat(data, unitSettings)?.text
    || `${data.getDisplayValue()} ${data.getDisplayUnit()}`;
}

function formatChange(
  changeKg: number | null,
  changePercent: number | null,
  unitSettings: UserUnitSettingsInterface | null | undefined,
  locale?: string,
): string {
  if (changeKg === null || changePercent === null) {
    return 'Not enough comparison data';
  }
  const sign = changeKg > 0 ? '+' : changeKg < 0 ? '−' : '';
  const weightText = formatWeight(Math.abs(changeKg), unitSettings);
  const percentageSign = changePercent > 0 ? '+' : changePercent < 0 ? '−' : '';
  return `${sign}${weightText} (${percentageSign}${formatNumber(Math.abs(changePercent), 1, locale)}%)`;
}

function formatUtcDate(value: number | null | undefined, locale?: string): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value as number));
}

function formatNumber(value: number, fractionDigits: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: fractionDigits, minimumFractionDigits: 0 }).format(value);
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
