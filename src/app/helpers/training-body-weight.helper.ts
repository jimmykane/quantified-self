import { DataWeight, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { DerivedBodyWeightTrendMetricPayload } from '@shared/derived-metrics';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';

type UnknownRecord = Record<string, unknown>;

export type TrainingBodyWeightViewState = 'preparing' | 'empty' | 'ready' | 'unavailable';

export interface TrainingBodyWeightTrendPointViewModel {
  dayMs: number;
  x: number;
  y: number | null;
  label: string;
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
  chartSegments: string[];
}

const CHART_WIDTH = 360;
const CHART_MIN_X = 10;
const CHART_MAX_X = CHART_WIDTH - 10;
const CHART_MIN_Y = 8;
const CHART_MAX_Y = 76;

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
  const expectedFirstDayMs = asOfDayMs === null ? null : asOfDayMs - (27 * 24 * 60 * 60 * 1000);
  const hasValidPointSeries = expectedFirstDayMs !== null
    && points.length === 28
    && points.every((point, index) => point !== null && point.dayMs === expectedFirstDayMs + (index * 24 * 60 * 60 * 1000));
  const latestValuesArePaired = (latestWeightKg === null) === (latestWeightDayMs === null);
  const deltaPairsAreValid = (change7dKg === null) === (change7dPercent === null)
    && (change28dKg === null) === (change28dPercent === null);
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
  };
}

export function buildTrainingBodyWeightViewModel(
  payload: DerivedBodyWeightTrendMetricPayload | null | undefined,
  status: string | null | undefined,
  unitSettings: UserUnitSettingsInterface | null | undefined,
  locale?: string,
): TrainingBodyWeightViewModel {
  const sourceText = 'This shows recorded body-weight measurements only. Same-day entries are reduced to a median; it does not change Readiness, Form, Training state, or prescribe training.';
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
      chartSegments: [],
    };
  }

  const availablePoints = payload.points.filter(point => point.weightKg !== null);
  const isUpdating = metricStatus !== 'ready';
  const chart = buildChartViewModel(payload, unitSettings, locale);
  if (!availablePoints.length || payload.latestWeightKg === null || payload.latestWeightDayMs === null) {
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
      ...chart,
    };
  }

  return {
    state: 'ready',
    isUpdating,
    latestWeightText: formatWeight(payload.latestWeightKg, unitSettings),
    latestRecordedText: `Latest recorded ${formatUtcDate(payload.latestWeightDayMs, locale)}`,
    median7dText: formatWeight(payload.median7dKg, unitSettings),
    median28dText: formatWeight(payload.median28dKg, unitSettings),
    change7dText: formatChange(payload.change7dKg, payload.change7dPercent, unitSettings, locale),
    change28dText: formatChange(payload.change28dKg, payload.change28dPercent, unitSettings, locale),
    coverageText: `${payload.recordedDayCount28d}/28 days recorded`,
    statusText: isUpdating
      ? 'Updating recorded measurements; the latest complete trend remains visible.'
      : '7-day and 28-day changes compare rolling medians with the preceding equal-length window.',
    sourceText,
    ...chart,
  };
}

function buildChartViewModel(
  payload: DerivedBodyWeightTrendMetricPayload,
  unitSettings: UserUnitSettingsInterface | null | undefined,
  locale?: string,
): Pick<TrainingBodyWeightViewModel, 'chartAriaLabel' | 'chartStartLabel' | 'chartEndLabel' | 'chartPoints' | 'chartSegments'> {
  const values = payload.points.flatMap(point => point.weightKg === null ? [] : [point.weightKg]);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const valueRange = Math.max(1, maximum - minimum);
  const chartPoints = payload.points.map((point, index) => {
    const x = CHART_MIN_X + (index * (CHART_MAX_X - CHART_MIN_X) / Math.max(1, payload.points.length - 1));
    const y = point.weightKg === null
      ? null
      : CHART_MAX_Y - (((point.weightKg - minimum) / valueRange) * (CHART_MAX_Y - CHART_MIN_Y));
    return {
      dayMs: point.dayMs,
      x: roundChartCoordinate(x),
      y: y === null ? null : roundChartCoordinate(y),
      label: point.weightKg === null
        ? `${formatUtcDate(point.dayMs, locale)}: no recorded body-weight measurement.`
        : `${formatUtcDate(point.dayMs, locale)}: ${formatWeight(point.weightKg, unitSettings)}.`,
    };
  });
  return {
    chartAriaLabel: values.length
      ? `Body-weight measurements over 28 UTC days. ${values.length} days have recorded measurements; missing days are gaps.`
      : 'No body-weight measurement was recorded in this 28-day window.',
    chartStartLabel: formatUtcDate(payload.points[0]?.dayMs, locale),
    chartEndLabel: formatUtcDate(payload.points.at(-1)?.dayMs, locale),
    chartPoints,
    chartSegments: buildChartSegments(chartPoints),
  };
}

function buildChartSegments(points: readonly TrainingBodyWeightTrendPointViewModel[]): string[] {
  const segments: string[] = [];
  let currentSegment: string[] = [];
  points.forEach((point) => {
    if (point.y === null) {
      if (currentSegment.length) {
        segments.push(currentSegment.join(' '));
        currentSegment = [];
      }
      return;
    }
    currentSegment.push(`${point.x},${point.y}`);
  });
  if (currentSegment.length) {
    segments.push(currentSegment.join(' '));
  }
  return segments;
}

function normalizePoint(value: unknown): DerivedBodyWeightTrendMetricPayload['points'][number] | null {
  const source = asRecord(value);
  const dayMs = finiteNumber(source?.dayMs);
  const weightKg = nullablePositiveNumber(source?.weightKg);
  return source && dayMs !== null && weightKg !== undefined ? { dayMs, weightKg } : null;
}

function formatWeight(value: number | null, unitSettings: UserUnitSettingsInterface | null | undefined): string {
  if (value === null) {
    return '--';
  }
  return resolveUnitAwareDisplayStat(new DataWeight(value), unitSettings)?.text || `${formatNumber(value, 1)} kg`;
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

function roundChartCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
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
