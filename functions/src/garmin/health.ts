import { createHash } from 'node:crypto';
import {
  HEALTH_COVERAGE_STATUSES,
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
  HEALTH_PROVIDERS,
  HEALTH_QUALITY_STATUSES,
  HEALTH_RECORDING_METHODS,
  HEALTH_SOURCE_RECORD_KINDS,
  HEALTH_UNITS,
  HEALTH_VALUE_ORIGINS,
  HEALTH_VALUE_TYPES,
  HealthCoverage,
  HealthMetricEntry,
  HealthMetricGoal,
  HealthMetricId,
  HealthRecordingMethod,
  HealthUnit,
} from '../../../shared/health';
import { HealthSampleSeriesInput, HealthSourceRecordInput } from '../health/validation';
import { GarminHealthSummaryType } from './health-summary-types';

type ExternalRecord = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_STRING_LENGTH = 512;
const MAX_SUMMARIES_PER_CALLBACK = 10_000;
const MAX_SAMPLES_PER_SUMMARY = 20_000;
const MAX_EVENTS_PER_SUMMARY = 256;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;
const MAX_TIMESTAMP_SECONDS = Math.floor((8_640_000_000_000_000 - DAY_MS) / 1000);
const GARMIN_DEVICE = Object.freeze({
  manufacturer: 'Garmin',
  displayName: 'Garmin',
  model: null,
});

export class GarminHealthValidationError extends Error {
  public readonly name = 'GarminHealthValidationError';
  public readonly code = 'garmin_health_invalid_response';

  constructor(message: string) {
    super(message);
  }
}

export interface GarminHealthResult {
  input: HealthSourceRecordInput;
  observedAtMs: number;
}

interface ParsedInterval {
  summary: ExternalRecord;
  summaryId: string;
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  timezoneOffsetSeconds: number | null;
  calendarDate: string;
}

interface NumericPoint {
  offsetSeconds: number;
  value: number;
}

interface NumberMetricOptions {
  metricId: HealthMetricId;
  aggregation: string;
  semanticVariant: string;
  nativeMetric: string;
  value: number;
  nativeUnit: string;
  canonicalUnit?: HealthUnit;
  canonicalValue?: number;
  recordingMethod?: HealthRecordingMethod;
  qualifiers?: Record<string, string | number | boolean | null>;
  goal?: HealthMetricGoal;
}

interface CanonicalNumberMetricOptions extends NumberMetricOptions {
  canonicalUnit: HealthUnit;
}

function asRecord(value: unknown, field: string): ExternalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GarminHealthValidationError(`${field} must be an object.`);
  }
  return value as ExternalRecord;
}

function boundedString(value: unknown, field: string, maximum = MAX_STRING_LENGTH): string {
  if (typeof value !== 'string') {
    throw new GarminHealthValidationError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new GarminHealthValidationError(`${field} must be a bounded non-empty string.`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maximum = MAX_STRING_LENGTH): string | null {
  if (value === undefined || value === null) return null;
  return boundedString(value, field, maximum);
}

function requiredNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  if (typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
    || (integer && !Number.isSafeInteger(value))) {
    throw new GarminHealthValidationError(`${field} is outside the supported numeric range.`);
  }
  return value;
}

function optionalNumber(
  record: ExternalRecord,
  field: string,
  minimum: number,
  maximum: number,
  integer = false,
): number | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  return requiredNumber(value, field, minimum, maximum, integer);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new GarminHealthValidationError(`${field} must be a boolean.`);
  }
  return value;
}

function validCalendarDate(value: unknown, field: string): string {
  const calendarDate = boundedString(value, field, 10);
  const timestamp = Date.parse(`${calendarDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)
    || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== calendarDate) {
    throw new GarminHealthValidationError(`${field} must be a valid calendar date.`);
  }
  return calendarDate;
}

function optionalTimezoneOffsetSeconds(record: ExternalRecord, field: string): number | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  return requiredNumber(value, field, -86_399, 86_399, true);
}

function timestampMs(value: unknown, field: string): number {
  const milliseconds = Math.round(
    requiredNumber(value, field, 0, MAX_TIMESTAMP_SECONDS) * 1000,
  );
  if (!Number.isSafeInteger(milliseconds)) {
    throw new GarminHealthValidationError(`${field} is outside the supported timestamp range.`);
  }
  return milliseconds;
}

function calendarDateFromTime(startTimeMs: number, timezoneOffsetSeconds: number | null): string {
  return new Date(startTimeMs + ((timezoneOffsetSeconds || 0) * 1000)).toISOString().slice(0, 10);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  const record = value as ExternalRecord;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function contentToken(content: unknown): string {
  return createHash('sha256')
    .update(stableStringify(content))
    .digest('hex');
}

function commonCoverage(
  startTimeMs: number,
  endTimeMs: number,
  durationSeconds: number,
  sampleCount?: number,
): HealthCoverage {
  return {
    status: HEALTH_COVERAGE_STATUSES.Unknown,
    expectedStartTimeMs: startTimeMs,
    expectedEndTimeMs: endTimeMs,
    observedDurationSeconds: durationSeconds,
    expectedDurationSeconds: durationSeconds,
    sampleCount,
  };
}

function dailyCoverage(interval: ParsedInterval, sampleCount: number): HealthCoverage {
  return {
    status: interval.durationSeconds >= 24 * 60 * 60
      ? HEALTH_COVERAGE_STATUSES.Complete
      : HEALTH_COVERAGE_STATUSES.Partial,
    expectedStartTimeMs: interval.startTimeMs,
    expectedEndTimeMs: interval.startTimeMs + DAY_MS,
    observedDurationSeconds: interval.durationSeconds,
    expectedDurationSeconds: 24 * 60 * 60,
    sampleCount,
    expectedSampleCount: 24 * 60 * 4,
    expectedUpdateIntervalMs: 15_000,
  };
}

function parseInterval(
  value: unknown,
  field: string,
  options: { calendarDateRequired?: boolean; offsetField?: string } = {},
): ParsedInterval {
  const summary = asRecord(value, field);
  const summaryId = boundedString(summary.summaryId, `${field}.summaryId`);
  const startTimeMs = timestampMs(summary.startTimeInSeconds, `${field}.startTimeInSeconds`);
  const durationSeconds = requiredNumber(
    summary.durationInSeconds,
    `${field}.durationInSeconds`,
    0,
    MAX_DURATION_SECONDS,
    true,
  );
  const offsetField = options.offsetField || 'startTimeOffsetInSeconds';
  const timezoneOffsetSeconds = optionalTimezoneOffsetSeconds(summary, offsetField);
  const calendarDate = summary.calendarDate === undefined || summary.calendarDate === null
    ? calendarDateFromTime(startTimeMs, timezoneOffsetSeconds)
    : validCalendarDate(summary.calendarDate, `${field}.calendarDate`);
  if (options.calendarDateRequired && !summary.calendarDate) {
    throw new GarminHealthValidationError(`${field}.calendarDate is required.`);
  }
  return {
    summary,
    summaryId,
    startTimeMs,
    endTimeMs: startTimeMs + (durationSeconds * 1000),
    durationSeconds,
    timezoneOffsetSeconds,
    calendarDate,
  };
}

function validateProviderUser(summary: ExternalRecord, providerAccountId: string, field: string): void {
  const supplied = optionalString(summary.userId ?? summary.userID, `${field}.userId`);
  if (supplied && supplied !== providerAccountId) {
    throw new GarminHealthValidationError(`${field}.userId does not match the callback account.`);
  }
}

function numericMap(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): NumericPoint[] {
  if (value === undefined || value === null) return [];
  const record = asRecord(value, field);
  const entries = Object.entries(record);
  if (entries.length > MAX_SAMPLES_PER_SUMMARY) {
    throw new GarminHealthValidationError(`${field} exceeds the bounded sample count.`);
  }
  const points: NumericPoint[] = [];
  for (const [offsetKey, rawValue] of entries) {
    if (!/^(0|[1-9]\d{0,8})$/.test(offsetKey)) {
      throw new GarminHealthValidationError(`${field} contains an invalid sample offset.`);
    }
    const offsetSeconds = Number(offsetKey);
    points.push({
      offsetSeconds,
      value: requiredNumber(rawValue, `${field} sample`, minimum, maximum),
    });
  }
  return points.sort((left, right) => left.offsetSeconds - right.offsetSeconds);
}

function assertPointsWithinInterval(points: readonly NumericPoint[], durationSeconds: number, field: string): void {
  if (points.some(point => point.offsetSeconds > durationSeconds)) {
    throw new GarminHealthValidationError(`${field} contains a sample outside the summary interval.`);
  }
}

function canonicalNumberMetric(options: CanonicalNumberMetricOptions): HealthMetricEntry {
  const canonicalValue = options.canonicalValue ?? options.value;
  return {
    kind: 'value',
    metricId: options.metricId,
    valueType: HEALTH_VALUE_TYPES.Number,
    aggregation: options.aggregation,
    semanticVariant: options.semanticVariant,
    origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
    recordingMethod: options.recordingMethod || HEALTH_RECORDING_METHODS.ProviderCalculated,
    quality: { status: HEALTH_QUALITY_STATUSES.Valid },
    coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
    normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
    native: {
      metric: options.nativeMetric,
      value: options.value,
      unit: options.nativeUnit,
      qualifiers: options.qualifiers,
    },
    canonical: {
      value: canonicalValue,
      unit: options.canonicalUnit,
    },
    goal: options.goal,
  };
}

function nativeNumberMetric(options: NumberMetricOptions): HealthMetricEntry {
  return {
    kind: 'value',
    metricId: options.metricId,
    valueType: HEALTH_VALUE_TYPES.Number,
    aggregation: options.aggregation,
    semanticVariant: options.semanticVariant,
    origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
    recordingMethod: options.recordingMethod || HEALTH_RECORDING_METHODS.ProviderCalculated,
    quality: { status: HEALTH_QUALITY_STATUSES.Valid },
    coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
    normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
    native: {
      metric: options.nativeMetric,
      value: options.value,
      unit: options.nativeUnit,
      qualifiers: options.qualifiers,
    },
  };
}

function categoryMetric(options: {
  metricId: HealthMetricId;
  aggregation: string;
  semanticVariant: string;
  nativeMetric: string;
  nativeValue: string;
  canonicalValue: string;
  qualifiers?: Record<string, string | number | boolean | null>;
}): HealthMetricEntry {
  return {
    kind: 'value',
    metricId: options.metricId,
    valueType: HEALTH_VALUE_TYPES.Category,
    aggregation: options.aggregation,
    semanticVariant: options.semanticVariant,
    origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
    recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
    quality: { status: HEALTH_QUALITY_STATUSES.Valid },
    coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
    normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
    native: {
      metric: options.nativeMetric,
      value: options.nativeValue,
      unit: 'category',
      qualifiers: options.qualifiers,
    },
    canonical: {
      value: options.canonicalValue,
      unit: HEALTH_UNITS.Category,
    },
  };
}

function numericSeries(options: {
  seriesKey: string;
  points: readonly NumericPoint[];
  metricId: HealthMetricId;
  aggregation: string;
  semanticVariant: string;
  nativeMetric: string;
  nativeUnit: string;
  canonicalUnit?: HealthUnit;
  canonicalValue?: (value: number) => number;
  coverage: HealthCoverage;
  normalizationStatus?: 'canonical' | 'native_only';
}): HealthSampleSeriesInput | null {
  if (options.points.length === 0) return null;
  const normalizationStatus = options.normalizationStatus || HEALTH_NORMALIZATION_STATUSES.Canonical;
  return {
    seriesKey: options.seriesKey,
    metricId: options.metricId,
    valueType: HEALTH_VALUE_TYPES.Number,
    aggregation: options.aggregation,
    semanticVariant: options.semanticVariant,
    origin: HEALTH_VALUE_ORIGINS.Recorded,
    recordingMethod: HEALTH_RECORDING_METHODS.Device,
    normalizationStatus,
    nativeMetric: options.nativeMetric,
    nativeUnit: options.nativeUnit,
    canonicalUnit: normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical
      ? options.canonicalUnit
      : undefined,
    offsetMs: options.points.map(point => point.offsetSeconds * 1000),
    nativeValues: options.points.map(point => point.value),
    canonicalValues: normalizationStatus === HEALTH_NORMALIZATION_STATUSES.Canonical
      ? options.points.map(point => options.canonicalValue?.(point.value) ?? point.value)
      : undefined,
    coverage: {
      ...options.coverage,
      sampleCount: options.points.length,
    },
    device: GARMIN_DEVICE,
  };
}

function categorySeries(options: {
  seriesKey: string;
  points: readonly NumericPoint[];
  categories: Readonly<Record<number, string>>;
  metricId: HealthMetricId;
  semanticVariant: string;
  nativeMetric: string;
  coverage: HealthCoverage;
}): HealthSampleSeriesInput | null {
  if (options.points.length === 0) return null;
  return {
    seriesKey: options.seriesKey,
    metricId: options.metricId,
    valueType: HEALTH_VALUE_TYPES.Category,
    aggregation: 'sample',
    semanticVariant: options.semanticVariant,
    origin: HEALTH_VALUE_ORIGINS.Recorded,
    recordingMethod: HEALTH_RECORDING_METHODS.Device,
    normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
    nativeMetric: options.nativeMetric,
    nativeUnit: 'code',
    canonicalUnit: HEALTH_UNITS.Category,
    offsetMs: options.points.map(point => point.offsetSeconds * 1000),
    nativeValues: options.points.map(point => `${point.value}`),
    canonicalValues: options.points.map(point => options.categories[point.value]),
    qualityCodes: options.points.map(point => options.categories[point.value]),
    coverage: {
      ...options.coverage,
      sampleCount: options.points.length,
    },
    device: GARMIN_DEVICE,
  };
}

function finalizeResult(options: {
  providerAccountId: string;
  summaryId: string;
  sourceRecordType: string;
  sourceRecordKey: string;
  revisionOrder: number;
  receivedAtMs: number;
  content: Omit<HealthSourceRecordInput,
    'provider' | 'providerAccountId' | 'sourceRecordType' | 'sourceRecordKey' | 'revision' | 'receivedAtMs'>;
}): GarminHealthResult | null {
  if (options.content.metrics.length === 0 && options.content.sampleSeries.length === 0) return null;
  const input: HealthSourceRecordInput = {
    provider: HEALTH_PROVIDERS.GarminAPI,
    providerAccountId: options.providerAccountId,
    sourceRecordType: options.sourceRecordType,
    sourceRecordKey: options.sourceRecordKey,
    revision: {
      order: options.revisionOrder,
      token: contentToken(options.content),
    },
    receivedAtMs: options.receivedAtMs,
    ...options.content,
  };
  return {
    input,
    observedAtMs: Math.min(options.receivedAtMs, options.content.endTimeMs),
  };
}

function addDailyCanonicalMetric(
  metrics: HealthMetricEntry[],
  summary: ExternalRecord,
  options: {
    field: string;
    metricId: HealthMetricId;
    aggregation: string;
    semanticVariant: string;
    nativeUnit: string;
    canonicalUnit: HealthUnit;
    minimum?: number;
    maximum?: number;
    integer?: boolean;
    goalField?: string;
  },
): void {
  const value = optionalNumber(
    summary,
    options.field,
    options.minimum ?? 0,
    options.maximum ?? 1_000_000_000,
    options.integer,
  );
  if (value === null) return;
  const goalValue = options.goalField
    ? optionalNumber(summary, options.goalField, 0, 1_000_000_000, true)
    : null;
  metrics.push(canonicalNumberMetric({
    metricId: options.metricId,
    aggregation: options.aggregation,
    semanticVariant: options.semanticVariant,
    nativeMetric: options.field,
    value,
    nativeUnit: options.nativeUnit,
    canonicalUnit: options.canonicalUnit,
    goal: goalValue === null || !options.goalField ? undefined : {
      native: { metric: options.goalField, value: goalValue, unit: options.nativeUnit },
      canonical: { value: goalValue, unit: options.canonicalUnit },
    },
  }));
}

function mapDaily(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `dailies[${index}]`;
  const interval = parseInterval(value, field, { calendarDateRequired: true });
  validateProviderUser(interval.summary, providerAccountId, field);
  const metrics: HealthMetricEntry[] = [];
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'steps', metricId: HEALTH_METRIC_IDS.Steps, aggregation: 'total', semanticVariant: 'daily_total',
    nativeUnit: 'count', canonicalUnit: HEALTH_UNITS.Count, integer: true, goalField: 'stepsGoal',
  });
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'pushes', metricId: HEALTH_METRIC_IDS.WheelchairPushes, aggregation: 'total', semanticVariant: 'daily_total',
    nativeUnit: 'count', canonicalUnit: HEALTH_UNITS.Count, integer: true, goalField: 'pushesGoal',
  });
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'distanceInMeters', metricId: HEALTH_METRIC_IDS.Distance, aggregation: 'total', semanticVariant: 'daily_total',
    nativeUnit: 'm', canonicalUnit: HEALTH_UNITS.Meter,
  });
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'pushDistanceInMeters', metricId: HEALTH_METRIC_IDS.WheelchairPushDistance, aggregation: 'total', semanticVariant: 'daily_total',
    nativeUnit: 'm', canonicalUnit: HEALTH_UNITS.Meter,
  });
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'floorsClimbed', metricId: HEALTH_METRIC_IDS.FloorsClimbed, aggregation: 'total', semanticVariant: 'daily_total',
    nativeUnit: 'count', canonicalUnit: HEALTH_UNITS.Count, integer: true, goalField: 'floorsClimbedGoal',
  });
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'activeTimeInSeconds', metricId: HEALTH_METRIC_IDS.ActiveDuration, aggregation: 'total', semanticVariant: 'daily_total',
    nativeUnit: 's', canonicalUnit: HEALTH_UNITS.Second, integer: true, maximum: MAX_DURATION_SECONDS,
  });
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'moderateIntensityDurationInSeconds', metricId: HEALTH_METRIC_IDS.ModerateIntensityDuration,
    aggregation: 'total', semanticVariant: 'daily_total', nativeUnit: 's', canonicalUnit: HEALTH_UNITS.Second,
    integer: true, maximum: MAX_DURATION_SECONDS,
  });
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'vigorousIntensityDurationInSeconds', metricId: HEALTH_METRIC_IDS.VigorousIntensityDuration,
    aggregation: 'total', semanticVariant: 'daily_total', nativeUnit: 's', canonicalUnit: HEALTH_UNITS.Second,
    integer: true, maximum: MAX_DURATION_SECONDS,
  });
  const intensityGoal = optionalNumber(interval.summary, 'intensityDurationGoalInSeconds', 0, MAX_DURATION_SECONDS, true);
  const intensityMetric = metrics.find(metric => metric.metricId === HEALTH_METRIC_IDS.ModerateIntensityDuration
    || metric.metricId === HEALTH_METRIC_IDS.VigorousIntensityDuration);
  if (intensityGoal !== null && intensityMetric?.kind === 'value') {
    intensityMetric.goal = {
      native: {
        metric: 'intensityDurationGoalInSeconds',
        value: intensityGoal,
        unit: 's',
        qualifiers: { scope: 'moderate_or_vigorous' },
      },
    };
  }
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'activeKilocalories', metricId: HEALTH_METRIC_IDS.ActiveEnergy, aggregation: 'total', semanticVariant: 'daily_total',
    nativeUnit: 'kcal', canonicalUnit: HEALTH_UNITS.Kilocalorie, integer: true, maximum: 10_000_000,
  });
  addDailyCanonicalMetric(metrics, interval.summary, {
    field: 'bmrKilocalories', metricId: HEALTH_METRIC_IDS.BasalEnergy, aggregation: 'total', semanticVariant: 'daily_total',
    nativeUnit: 'kcal', canonicalUnit: HEALTH_UNITS.Kilocalorie, integer: true, maximum: 10_000_000,
  });
  for (const heartRate of [
    ['minHeartRateInBeatsPerMinute', 'minimum', 'daily_minimum'],
    ['maxHeartRateInBeatsPerMinute', 'maximum', 'daily_maximum'],
    ['restingHeartRateInBeatsPerMinute', 'average', 'daily_resting'],
    ['averageHeartRateInBeatsPerMinute', 'average', 'rolling_7_day_average'],
  ] as const) {
    const valueBpm = optionalNumber(interval.summary, heartRate[0], 1, 300, true);
    if (valueBpm === null) continue;
    metrics.push(canonicalNumberMetric({
      metricId: heartRate[0] === 'restingHeartRateInBeatsPerMinute'
        ? HEALTH_METRIC_IDS.RestingHeartRate
        : HEALTH_METRIC_IDS.HeartRate,
      aggregation: heartRate[1],
      semanticVariant: heartRate[2],
      nativeMetric: heartRate[0],
      value: valueBpm,
      nativeUnit: 'bpm',
      canonicalUnit: HEALTH_UNITS.BeatsPerMinute,
    }));
  }
  const averageStress = optionalNumber(interval.summary, 'averageStressLevel', -1, 100, true);
  if (averageStress !== null) {
    if (averageStress > 0) {
      metrics.push(canonicalNumberMetric({
        metricId: HEALTH_METRIC_IDS.StressLevel,
        aggregation: 'average',
        semanticVariant: 'daily_average',
        nativeMetric: 'averageStressLevel',
        value: averageStress,
        nativeUnit: 'score',
        canonicalUnit: HEALTH_UNITS.Score,
      }));
    } else {
      metrics.push(categoryMetric({
        metricId: HEALTH_METRIC_IDS.StressState,
        aggregation: 'summary',
        semanticVariant: 'daily_average_availability',
        nativeMetric: 'averageStressLevel',
        nativeValue: `${averageStress}`,
        canonicalValue: 'not_enough_data',
      }));
    }
  }
  const maxStress = optionalNumber(interval.summary, 'maxStressLevel', 1, 100, true);
  if (maxStress !== null) {
    metrics.push(canonicalNumberMetric({
      metricId: HEALTH_METRIC_IDS.StressLevel,
      aggregation: 'maximum',
      semanticVariant: 'daily_maximum',
      nativeMetric: 'maxStressLevel',
      value: maxStress,
      nativeUnit: 'score',
      canonicalUnit: HEALTH_UNITS.Score,
    }));
  }
  for (const stressDuration of [
    ['stressDurationInSeconds', 'stressful'],
    ['restStressDurationInSeconds', 'rest'],
    ['activityStressDurationInSeconds', 'activity'],
    ['lowStressDurationInSeconds', 'low'],
    ['mediumStressDurationInSeconds', 'medium'],
    ['highStressDurationInSeconds', 'high'],
  ] as const) {
    const duration = optionalNumber(interval.summary, stressDuration[0], 0, MAX_DURATION_SECONDS, true);
    if (duration === null) continue;
    metrics.push(canonicalNumberMetric({
      metricId: HEALTH_METRIC_IDS.StressDuration,
      aggregation: 'total',
      semanticVariant: stressDuration[1],
      nativeMetric: stressDuration[0],
      value: duration,
      nativeUnit: 's',
      canonicalUnit: HEALTH_UNITS.Second,
    }));
  }
  const stressQualifier = optionalString(interval.summary.stressQualifier, `${field}.stressQualifier`, 128);
  if (stressQualifier) {
    metrics.push(categoryMetric({
      metricId: HEALTH_METRIC_IDS.StressState,
      aggregation: 'summary',
      semanticVariant: 'daily_qualifier',
      nativeMetric: 'stressQualifier',
      nativeValue: stressQualifier,
      canonicalValue: stressQualifier.toLowerCase(),
    }));
  }
  for (const bodyEnergy of [
    ['bodyBatteryChargedValue', 'daily_charged'],
    ['bodyBatteryDrainedValue', 'daily_drained'],
  ] as const) {
    const score = optionalNumber(interval.summary, bodyEnergy[0], 0, 1_000, true);
    if (score === null) continue;
    metrics.push(nativeNumberMetric({
      metricId: HEALTH_METRIC_IDS.BodyEnergyChange,
      aggregation: 'total',
      semanticVariant: bodyEnergy[1],
      nativeMetric: bodyEnergy[0],
      value: score,
      nativeUnit: 'garmin_body_battery_points',
    }));
  }

  const heartRatePoints = numericMap(
    interval.summary.timeOffsetHeartRateSamples,
    `${field}.timeOffsetHeartRateSamples`,
    1,
    300,
  );
  assertPointsWithinInterval(heartRatePoints, interval.durationSeconds, `${field}.timeOffsetHeartRateSamples`);
  const coverage = dailyCoverage(interval, heartRatePoints.length);
  const series = numericSeries({
    seriesKey: 'heart_rate_15_second_representative',
    points: heartRatePoints,
    metricId: HEALTH_METRIC_IDS.HeartRate,
    aggregation: 'representative_sample',
    semanticVariant: 'daily_15_second',
    nativeMetric: 'timeOffsetHeartRateSamples',
    nativeUnit: 'bpm',
    canonicalUnit: HEALTH_UNITS.BeatsPerMinute,
    coverage,
  });
  return finalizeResult({
    providerAccountId,
    summaryId: interval.summaryId,
    sourceRecordType: 'garmin_daily',
    sourceRecordKey: `${interval.startTimeMs}`,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
      calendarDate: interval.calendarDate,
      startTimeMs: interval.startTimeMs,
      endTimeMs: interval.endTimeMs,
      timezoneOffsetSeconds: interval.timezoneOffsetSeconds,
      metrics,
      coverage,
      device: GARMIN_DEVICE,
      sampleSeries: series ? [series] : [],
    },
  });
}

const STRESS_STATE_CODES: Readonly<Record<number, string>> = Object.freeze({
  [-1]: 'off_wrist',
  [-2]: 'large_motion',
  [-3]: 'not_enough_data',
  [-4]: 'recovering_from_exercise',
  [-5]: 'unidentified',
});

function aliasedValue(record: ExternalRecord, fields: readonly string[], field: string): unknown {
  const present = fields.filter(name => record[name] !== undefined && record[name] !== null);
  if (present.length > 1 && stableStringify(record[present[0]]) !== stableStringify(record[present[1]])) {
    throw new GarminHealthValidationError(`${field} contains conflicting aliases.`);
  }
  return present.length ? record[present[0]] : undefined;
}

function mapStressDetails(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `stressDetails[${index}]`;
  const interval = parseInterval(value, field, { calendarDateRequired: true });
  validateProviderUser(interval.summary, providerAccountId, field);
  const rawStressPoints = numericMap(
    interval.summary.timeOffsetStressLevelValues,
    `${field}.timeOffsetStressLevelValues`,
    -5,
    100,
  );
  assertPointsWithinInterval(rawStressPoints, interval.durationSeconds, `${field}.timeOffsetStressLevelValues`);
  if (rawStressPoints.some(point => point.value === 0 || (point.value < 0 && !STRESS_STATE_CODES[point.value]))) {
    throw new GarminHealthValidationError(`${field}.timeOffsetStressLevelValues contains an unsupported stress code.`);
  }
  const stressPoints = rawStressPoints.filter(point => point.value > 0);
  const statePoints = rawStressPoints.filter(point => point.value < 0);
  const bodyBatteryPoints = numericMap(
    interval.summary.timeOffsetBodyBatteryValues,
    `${field}.timeOffsetBodyBatteryValues`,
    0,
    100,
  );
  assertPointsWithinInterval(bodyBatteryPoints, interval.durationSeconds, `${field}.timeOffsetBodyBatteryValues`);
  const coverage = commonCoverage(
    interval.startTimeMs,
    interval.endTimeMs,
    interval.durationSeconds,
    rawStressPoints.length,
  );
  const sampleSeries = [
    numericSeries({
      seriesKey: 'stress_level_3_minute_average',
      points: stressPoints,
      metricId: HEALTH_METRIC_IDS.StressLevel,
      aggregation: 'average',
      semanticVariant: 'three_minute',
      nativeMetric: 'timeOffsetStressLevelValues',
      nativeUnit: 'score',
      canonicalUnit: HEALTH_UNITS.Score,
      coverage: { ...coverage, expectedUpdateIntervalMs: 180_000 },
    }),
    categorySeries({
      seriesKey: 'stress_measurement_state',
      points: statePoints,
      categories: STRESS_STATE_CODES,
      metricId: HEALTH_METRIC_IDS.StressState,
      semanticVariant: 'measurement_state',
      nativeMetric: 'timeOffsetStressLevelValues',
      coverage: { ...coverage, expectedUpdateIntervalMs: 180_000 },
    }),
    numericSeries({
      seriesKey: 'garmin_body_battery',
      points: bodyBatteryPoints,
      metricId: HEALTH_METRIC_IDS.BodyEnergy,
      aggregation: 'sample',
      semanticVariant: 'garmin_body_battery',
      nativeMetric: 'timeOffsetBodyBatteryValues',
      nativeUnit: 'garmin_body_battery_points',
      coverage,
      normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
    }),
  ].filter((series): series is HealthSampleSeriesInput => series !== null);

  const metrics: HealthMetricEntry[] = [];
  const feedbackValue = interval.summary.bodyBatteryDynamicFeedbackEvent;
  if (feedbackValue !== undefined && feedbackValue !== null) {
    const feedback = asRecord(feedbackValue, `${field}.bodyBatteryDynamicFeedbackEvent`);
    const eventTime = timestampMs(feedback.eventStartTimeInSeconds, `${field}.bodyBatteryDynamicFeedbackEvent.eventStartTimeInSeconds`);
    const level = boundedString(feedback.bodyBatteryLevel, `${field}.bodyBatteryDynamicFeedbackEvent.bodyBatteryLevel`, 64);
    const latestPoint = bodyBatteryPoints[bodyBatteryPoints.length - 1];
    if (latestPoint) {
      metrics.push(nativeNumberMetric({
        metricId: HEALTH_METRIC_IDS.BodyEnergy,
        aggregation: 'latest',
        semanticVariant: 'garmin_body_battery',
        nativeMetric: 'timeOffsetBodyBatteryValues',
        value: latestPoint.value,
        nativeUnit: 'garmin_body_battery_points',
        recordingMethod: HEALTH_RECORDING_METHODS.Device,
        qualifiers: {
          dynamicFeedbackLevel: level,
          dynamicFeedbackEventStartTimeMs: eventTime,
        },
      }));
    }
  }
  const eventsValue = aliasedValue(
    interval.summary,
    ['bodyBatteryActivityEventList', 'bodyBatteryActivityEvents'],
    `${field}.bodyBatteryActivityEvents`,
  );
  if (eventsValue !== undefined) {
    if (!Array.isArray(eventsValue) || eventsValue.length > MAX_EVENTS_PER_SUMMARY) {
      throw new GarminHealthValidationError(`${field}.bodyBatteryActivityEvents must be a bounded array.`);
    }
    eventsValue.forEach((eventValue, eventIndex) => {
      const event = asRecord(eventValue, `${field}.bodyBatteryActivityEvents[${eventIndex}]`);
      const eventType = boundedString(event.eventType, `${field}.bodyBatteryActivityEvents[${eventIndex}].eventType`, 64).toUpperCase();
      if (!['SLEEP', 'RECOVERY', 'NAP', 'ACTIVITY', 'STRESS'].includes(eventType)) {
        throw new GarminHealthValidationError(`${field}.bodyBatteryActivityEvents contains an unsupported event type.`);
      }
      const eventStartTimeMs = timestampMs(event.eventStartTimeInSeconds, `${field}.bodyBatteryActivityEvents[${eventIndex}].eventStartTimeInSeconds`);
      const eventOffset = aliasedValue(
        event,
        ['eventStartTimeOffsetInSeconds', 'eventStartTimeOffsetINSeconds'],
        `${field}.bodyBatteryActivityEvents[${eventIndex}].eventStartTimeOffsetInSeconds`,
      );
      const offsetSeconds = eventOffset === undefined
        ? null
        : requiredNumber(eventOffset, `${field}.bodyBatteryActivityEvents offset`, -86_399, 86_399, true);
      const durationSeconds = requiredNumber(event.duration, `${field}.bodyBatteryActivityEvents[${eventIndex}].duration`, 0, MAX_DURATION_SECONDS, true);
      const impact = requiredNumber(event.bodyBatteryImpact, `${field}.bodyBatteryActivityEvents[${eventIndex}].bodyBatteryImpact`, -1_000, 1_000, true);
      metrics.push(nativeNumberMetric({
        metricId: HEALTH_METRIC_IDS.BodyEnergyChange,
        aggregation: 'event',
        semanticVariant: `garmin_${eventType.toLowerCase()}`,
        nativeMetric: 'bodyBatteryImpact',
        value: impact,
        nativeUnit: 'garmin_body_battery_points',
        recordingMethod: HEALTH_RECORDING_METHODS.Device,
        qualifiers: {
          eventType,
          eventStartTimeMs,
          eventStartTimeOffsetInSeconds: offsetSeconds,
          durationSeconds,
        },
      }));
    });
  }
  return finalizeResult({
    providerAccountId,
    summaryId: interval.summaryId,
    sourceRecordType: 'garmin_stress_details',
    sourceRecordKey: `${interval.startTimeMs}`,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.IntervalSummary,
      calendarDate: interval.calendarDate,
      startTimeMs: interval.startTimeMs,
      endTimeMs: interval.endTimeMs,
      timezoneOffsetSeconds: interval.timezoneOffsetSeconds,
      metrics,
      coverage,
      device: GARMIN_DEVICE,
      sampleSeries,
    },
  });
}

function mapHrv(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `hrv[${index}]`;
  const interval = parseInterval(value, field, { calendarDateRequired: true });
  validateProviderUser(interval.summary, providerAccountId, field);
  const metrics: HealthMetricEntry[] = [];
  for (const metric of [
    ['lastNightAvg', 'average', 'overnight_rmssd'],
    ['lastNight5MinHigh', 'maximum', 'overnight_5_minute_high_rmssd'],
  ] as const) {
    const metricValue = optionalNumber(interval.summary, metric[0], 0, 100_000, true);
    if (metricValue === null) continue;
    metrics.push(canonicalNumberMetric({
      metricId: HEALTH_METRIC_IDS.HeartRateVariability,
      aggregation: metric[1],
      semanticVariant: metric[2],
      nativeMetric: metric[0],
      value: metricValue,
      nativeUnit: 'ms',
      canonicalUnit: HEALTH_UNITS.Millisecond,
    }));
  }
  const points = numericMap(interval.summary.hrvValues, `${field}.hrvValues`, 0, 100_000);
  assertPointsWithinInterval(points, interval.durationSeconds, `${field}.hrvValues`);
  const coverage = commonCoverage(interval.startTimeMs, interval.endTimeMs, interval.durationSeconds, points.length);
  const series = numericSeries({
    seriesKey: 'overnight_rmssd_5_minute',
    points,
    metricId: HEALTH_METRIC_IDS.HeartRateVariability,
    aggregation: 'average',
    semanticVariant: 'overnight_5_minute_rmssd',
    nativeMetric: 'hrvValues',
    nativeUnit: 'ms',
    canonicalUnit: HEALTH_UNITS.Millisecond,
    coverage: { ...coverage, expectedUpdateIntervalMs: 300_000 },
  });
  return finalizeResult({
    providerAccountId,
    summaryId: interval.summaryId,
    sourceRecordType: 'garmin_hrv',
    sourceRecordKey: `${interval.startTimeMs}`,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.IntervalSummary,
      calendarDate: interval.calendarDate,
      startTimeMs: interval.startTimeMs,
      endTimeMs: interval.endTimeMs,
      timezoneOffsetSeconds: interval.timezoneOffsetSeconds,
      metrics,
      coverage,
      device: GARMIN_DEVICE,
      sampleSeries: series ? [series] : [],
    },
  });
}

function mapUserMetrics(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `userMetrics[${index}]`;
  const summary = asRecord(value, field);
  const summaryId = boundedString(summary.summaryId, `${field}.summaryId`);
  validateProviderUser(summary, providerAccountId, field);
  const calendarDate = validCalendarDate(summary.calendarDate, `${field}.calendarDate`);
  const startTimeMs = Date.parse(`${calendarDate}T00:00:00.000Z`);
  const enhanced = summary.enhanced === undefined || summary.enhanced === null
    ? null
    : requiredBoolean(summary.enhanced, `${field}.enhanced`);
  const metrics: HealthMetricEntry[] = [];
  for (const metric of [
    ['vo2Max', 'running'],
    ['vo2MaxCycling', 'cycling'],
  ] as const) {
    const metricValue = optionalNumber(summary, metric[0], 0, 150);
    if (metricValue === null) continue;
    metrics.push(canonicalNumberMetric({
      metricId: HEALTH_METRIC_IDS.Vo2Max,
      aggregation: 'latest',
      semanticVariant: metric[1],
      nativeMetric: metric[0],
      value: metricValue,
      nativeUnit: 'ml/kg/min',
      canonicalUnit: HEALTH_UNITS.MillilitersPerKilogramPerMinute,
      qualifiers: enhanced === null ? undefined : { enhancedAlgorithm: enhanced },
    }));
  }
  const fitnessAge = optionalNumber(summary, 'fitnessAge', 0, 150, true);
  if (fitnessAge !== null) {
    metrics.push(canonicalNumberMetric({
      metricId: HEALTH_METRIC_IDS.FitnessAge,
      aggregation: 'latest',
      semanticVariant: enhanced === null
        ? 'algorithm_unspecified'
        : enhanced
          ? 'enhanced'
          : 'legacy',
      nativeMetric: 'fitnessAge',
      value: fitnessAge,
      nativeUnit: 'years',
      canonicalUnit: HEALTH_UNITS.Years,
      qualifiers: enhanced === null ? undefined : { enhancedAlgorithm: enhanced },
    }));
  }
  return finalizeResult({
    providerAccountId,
    summaryId,
    sourceRecordType: 'garmin_user_metrics',
    sourceRecordKey: calendarDate,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.ProfileSnapshot,
      calendarDate,
      startTimeMs,
      endTimeMs: startTimeMs + DAY_MS,
      timezoneOffsetSeconds: null,
      metrics,
      coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
      device: GARMIN_DEVICE,
      sampleSeries: [],
    },
  });
}

function mapBodyComposition(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `bodyComps[${index}]`;
  const summary = asRecord(value, field);
  const summaryId = boundedString(summary.summaryId, `${field}.summaryId`);
  validateProviderUser(summary, providerAccountId, field);
  const measurementTimeMs = timestampMs(summary.measurementTimeInSeconds, `${field}.measurementTimeInSeconds`);
  const timezoneOffsetSeconds = optionalTimezoneOffsetSeconds(summary, 'measurementTimeOffsetInSeconds');
  const values = {
    muscleMassInGrams: optionalNumber(summary, 'muscleMassInGrams', 0, 1_000_000, true),
    boneMassInGrams: optionalNumber(summary, 'boneMassInGrams', 0, 100_000, true),
    bodyWaterInPercent: optionalNumber(summary, 'bodyWaterInPercent', 0, 100),
    bodyFatInPercent: optionalNumber(summary, 'bodyFatInPercent', 0, 100),
    bodyMassIndex: optionalNumber(summary, 'bodyMassIndex', 0, 200),
    weightInGrams: optionalNumber(summary, 'weightInGrams', 0, 1_000_000, true),
  };
  const compositionPresent = Object.entries(values)
    .some(([key, metricValue]) => key !== 'weightInGrams' && metricValue !== null);
  const recordingMethod = compositionPresent
    ? HEALTH_RECORDING_METHODS.Device
    : HEALTH_RECORDING_METHODS.Manual;
  const metrics: HealthMetricEntry[] = [];
  for (const metric of [
    ['weightInGrams', HEALTH_METRIC_IDS.BodyWeight, HEALTH_UNITS.Kilogram, 'g', 0.001],
    ['muscleMassInGrams', HEALTH_METRIC_IDS.MuscleMass, HEALTH_UNITS.Kilogram, 'g', 0.001],
    ['boneMassInGrams', HEALTH_METRIC_IDS.BoneMass, HEALTH_UNITS.Kilogram, 'g', 0.001],
    ['bodyWaterInPercent', HEALTH_METRIC_IDS.BodyWater, HEALTH_UNITS.Percent, 'percent', 1],
    ['bodyFatInPercent', HEALTH_METRIC_IDS.BodyFat, HEALTH_UNITS.Percent, 'percent', 1],
    ['bodyMassIndex', HEALTH_METRIC_IDS.BodyMassIndex, HEALTH_UNITS.KilogramsPerSquareMeter, 'kg/m2', 1],
  ] as const) {
    const metricValue = values[metric[0]];
    if (metricValue === null) continue;
    metrics.push(canonicalNumberMetric({
      metricId: metric[1],
      aggregation: 'measurement',
      semanticVariant: 'point',
      nativeMetric: metric[0],
      value: metricValue,
      nativeUnit: metric[3],
      canonicalUnit: metric[2],
      canonicalValue: metricValue * metric[4],
      recordingMethod,
    }));
  }
  return finalizeResult({
    providerAccountId,
    summaryId,
    sourceRecordType: 'garmin_body_composition',
    sourceRecordKey: `${measurementTimeMs}`,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.PointMeasurement,
      calendarDate: calendarDateFromTime(measurementTimeMs, timezoneOffsetSeconds),
      startTimeMs: measurementTimeMs,
      endTimeMs: measurementTimeMs,
      timezoneOffsetSeconds,
      metrics,
      coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
      device: GARMIN_DEVICE,
      sampleSeries: [],
    },
  });
}

function mapPulseOx(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `pulseox[${index}]`;
  const interval = parseInterval(value, field, { calendarDateRequired: true });
  validateProviderUser(interval.summary, providerAccountId, field);
  const onDemand = requiredBoolean(interval.summary.onDemand, `${field}.onDemand`);
  if (onDemand && interval.durationSeconds !== 0) {
    throw new GarminHealthValidationError(`${field}.durationInSeconds must be zero for on-demand readings.`);
  }
  const points = numericMap(interval.summary.timeOffsetSpo2Values, `${field}.timeOffsetSpo2Values`, 0, 100);
  const endTimeMs = Math.max(
    interval.endTimeMs,
    interval.startTimeMs + ((points[points.length - 1]?.offsetSeconds || 0) * 1000),
  );
  if (!onDemand) assertPointsWithinInterval(points, interval.durationSeconds, `${field}.timeOffsetSpo2Values`);
  const coverage = commonCoverage(interval.startTimeMs, endTimeMs, interval.durationSeconds, points.length);
  const semanticVariant = onDemand ? 'on_demand_exact' : 'continuous_average';
  const series = numericSeries({
    seriesKey: `spo2_${semanticVariant}`,
    points,
    metricId: HEALTH_METRIC_IDS.BloodOxygenSaturation,
    aggregation: onDemand ? 'exact' : 'average',
    semanticVariant,
    nativeMetric: 'timeOffsetSpo2Values',
    nativeUnit: 'percent',
    canonicalUnit: HEALTH_UNITS.Percent,
    coverage: onDemand ? coverage : { ...coverage, expectedUpdateIntervalMs: 60_000 },
  });
  return finalizeResult({
    providerAccountId,
    summaryId: interval.summaryId,
    sourceRecordType: 'garmin_pulse_ox',
    sourceRecordKey: `${interval.startTimeMs}:${onDemand ? 'on_demand' : 'continuous'}`,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.IntervalSummary,
      calendarDate: interval.calendarDate,
      startTimeMs: interval.startTimeMs,
      endTimeMs,
      timezoneOffsetSeconds: interval.timezoneOffsetSeconds,
      metrics: [],
      coverage,
      device: GARMIN_DEVICE,
      sampleSeries: series ? [series] : [],
    },
  });
}

function mapRespiration(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `allDayRespiration[${index}]`;
  const interval = parseInterval(value, field);
  validateProviderUser(interval.summary, providerAccountId, field);
  const points = numericMap(interval.summary.timeOffsetEpochToBreaths, `${field}.timeOffsetEpochToBreaths`, 0, 100);
  assertPointsWithinInterval(points, interval.durationSeconds, `${field}.timeOffsetEpochToBreaths`);
  const coverage = commonCoverage(interval.startTimeMs, interval.endTimeMs, interval.durationSeconds, points.length);
  const series = numericSeries({
    seriesKey: 'all_day_respiration',
    points,
    metricId: HEALTH_METRIC_IDS.RespirationRate,
    aggregation: 'sample',
    semanticVariant: 'all_day',
    nativeMetric: 'timeOffsetEpochToBreaths',
    nativeUnit: 'brpm',
    canonicalUnit: HEALTH_UNITS.BreathsPerMinute,
    coverage: { ...coverage, expectedUpdateIntervalMs: 60_000 },
  });
  return finalizeResult({
    providerAccountId,
    summaryId: interval.summaryId,
    sourceRecordType: 'garmin_all_day_respiration',
    sourceRecordKey: `${interval.startTimeMs}`,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.IntervalSummary,
      calendarDate: interval.calendarDate,
      startTimeMs: interval.startTimeMs,
      endTimeMs: interval.endTimeMs,
      timezoneOffsetSeconds: interval.timezoneOffsetSeconds,
      metrics: [],
      coverage,
      device: GARMIN_DEVICE,
      sampleSeries: series ? [series] : [],
    },
  });
}

function mapBloodPressure(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `bloodPressures[${index}]`;
  const summary = asRecord(value, field);
  const summaryId = boundedString(summary.summaryId, `${field}.summaryId`);
  validateProviderUser(summary, providerAccountId, field);
  const measurementTimeMs = timestampMs(summary.measurementTimeInSeconds, `${field}.measurementTimeInSeconds`);
  const timezoneOffsetSeconds = optionalTimezoneOffsetSeconds(summary, 'measurementTimeOffsetInSeconds');
  const sourceType = optionalString(summary.sourceType, `${field}.sourceType`, 64)?.toUpperCase() || 'UNKNOWN';
  const recordingMethod = sourceType === 'MANUAL'
    ? HEALTH_RECORDING_METHODS.Manual
    : sourceType === 'DEVICE'
      ? HEALTH_RECORDING_METHODS.Device
      : HEALTH_RECORDING_METHODS.Unknown;
  const metrics: HealthMetricEntry[] = [];
  for (const metric of [
    ['systolic', HEALTH_METRIC_IDS.BloodPressureSystolic, HEALTH_UNITS.MillimetersMercury, 20, 300],
    ['diastolic', HEALTH_METRIC_IDS.BloodPressureDiastolic, HEALTH_UNITS.MillimetersMercury, 20, 250],
    ['pulse', HEALTH_METRIC_IDS.PulseRate, HEALTH_UNITS.BeatsPerMinute, 1, 300],
  ] as const) {
    const metricValue = optionalNumber(summary, metric[0], metric[3], metric[4], true);
    if (metricValue === null) continue;
    metrics.push(canonicalNumberMetric({
      metricId: metric[1],
      aggregation: 'measurement',
      semanticVariant: 'point',
      nativeMetric: metric[0],
      value: metricValue,
      nativeUnit: metric[2] === HEALTH_UNITS.MillimetersMercury ? 'mmHg' : 'bpm',
      canonicalUnit: metric[2],
      recordingMethod,
      qualifiers: recordingMethod === HEALTH_RECORDING_METHODS.Unknown
        ? { sourceType }
        : undefined,
    }));
  }
  return finalizeResult({
    providerAccountId,
    summaryId,
    sourceRecordType: 'garmin_blood_pressure',
    sourceRecordKey: `${measurementTimeMs}`,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.PointMeasurement,
      calendarDate: calendarDateFromTime(measurementTimeMs, timezoneOffsetSeconds),
      startTimeMs: measurementTimeMs,
      endTimeMs: measurementTimeMs,
      timezoneOffsetSeconds,
      metrics,
      coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
      device: GARMIN_DEVICE,
      sampleSeries: [],
    },
  });
}

function mapSkinTemperature(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `skinTemp[${index}]`;
  const interval = parseInterval(value, field, { calendarDateRequired: true });
  validateProviderUser(interval.summary, providerAccountId, field);
  const deviation = requiredNumber(interval.summary.avgDeviationCelsius, `${field}.avgDeviationCelsius`, -100, 100);
  const coverage = commonCoverage(interval.startTimeMs, interval.endTimeMs, interval.durationSeconds);
  return finalizeResult({
    providerAccountId,
    summaryId: interval.summaryId,
    sourceRecordType: 'garmin_skin_temperature',
    sourceRecordKey: `${interval.startTimeMs}`,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.IntervalSummary,
      calendarDate: interval.calendarDate,
      startTimeMs: interval.startTimeMs,
      endTimeMs: interval.endTimeMs,
      timezoneOffsetSeconds: interval.timezoneOffsetSeconds,
      metrics: [canonicalNumberMetric({
        metricId: HEALTH_METRIC_IDS.SkinTemperatureDeviation,
        aggregation: 'average',
        semanticVariant: 'sleep_window_deviation',
        nativeMetric: 'avgDeviationCelsius',
        value: deviation,
        nativeUnit: 'celsius',
        canonicalUnit: HEALTH_UNITS.Celsius,
        recordingMethod: HEALTH_RECORDING_METHODS.Device,
      })],
      coverage,
      device: GARMIN_DEVICE,
      sampleSeries: [],
    },
  });
}

const SNAPSHOT_METRICS = Object.freeze({
  heart_rate: {
    metricId: HEALTH_METRIC_IDS.HeartRate,
    unit: HEALTH_UNITS.BeatsPerMinute,
    nativeUnit: 'bpm',
    maximum: 300,
    semanticVariant: 'health_snapshot',
  },
  respiration: {
    metricId: HEALTH_METRIC_IDS.RespirationRate,
    unit: HEALTH_UNITS.BreathsPerMinute,
    nativeUnit: 'brpm',
    maximum: 100,
    semanticVariant: 'health_snapshot',
  },
  stress: {
    metricId: HEALTH_METRIC_IDS.StressLevel,
    unit: HEALTH_UNITS.Score,
    nativeUnit: 'score',
    maximum: 100,
    semanticVariant: 'health_snapshot',
  },
  spo2: {
    metricId: HEALTH_METRIC_IDS.BloodOxygenSaturation,
    unit: HEALTH_UNITS.Percent,
    nativeUnit: 'percent',
    maximum: 100,
    semanticVariant: 'health_snapshot',
  },
  rmssd_hrv: {
    metricId: HEALTH_METRIC_IDS.HeartRateVariability,
    unit: HEALTH_UNITS.Millisecond,
    nativeUnit: 'ms',
    maximum: 100_000,
    semanticVariant: 'health_snapshot_rmssd',
  },
  sdrr_hrv: {
    metricId: HEALTH_METRIC_IDS.HeartRateVariability,
    unit: HEALTH_UNITS.Millisecond,
    nativeUnit: 'ms',
    maximum: 100_000,
    semanticVariant: 'health_snapshot_sdrr',
  },
});

function mapHealthSnapshot(
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
): GarminHealthResult | null {
  const field = `healthSnapshot[${index}]`;
  const rawSummary = asRecord(value, field);
  if (rawSummary.startTimeOffsetInSeconds !== undefined
    && rawSummary.offsetStartTimeInSeconds !== undefined
    && rawSummary.startTimeOffsetInSeconds !== rawSummary.offsetStartTimeInSeconds) {
    throw new GarminHealthValidationError(`${field} contains conflicting start-time offset aliases.`);
  }
  const normalizedSummary = rawSummary.startTimeOffsetInSeconds === undefined
    && rawSummary.offsetStartTimeInSeconds !== undefined
    ? {
      ...rawSummary,
      startTimeOffsetInSeconds: rawSummary.offsetStartTimeInSeconds,
    }
    : rawSummary;
  const interval = parseInterval(normalizedSummary, field, { calendarDateRequired: true });
  validateProviderUser(interval.summary, providerAccountId, field);
  if (!Array.isArray(interval.summary.summaries)
    || interval.summary.summaries.length > 16) {
    throw new GarminHealthValidationError(`${field}.summaries must be a bounded array.`);
  }
  const metrics: HealthMetricEntry[] = [];
  const sampleSeries: HealthSampleSeriesInput[] = [];
  const seenTypes = new Set<string>();
  interval.summary.summaries.forEach((summaryValue, summaryIndex) => {
    const snapshotSummary = asRecord(summaryValue, `${field}.summaries[${summaryIndex}]`);
    const summaryType = boundedString(snapshotSummary.summaryType, `${field}.summaries[${summaryIndex}].summaryType`, 64).toLowerCase();
    const definition = SNAPSHOT_METRICS[summaryType as keyof typeof SNAPSHOT_METRICS];
    if (!definition) return;
    if (seenTypes.has(summaryType)) {
      throw new GarminHealthValidationError(`${field}.summaries contains duplicate supported summary types.`);
    }
    seenTypes.add(summaryType);
    const values = {
      minimum: optionalNumber(snapshotSummary, 'minValue', 0, definition.maximum),
      maximum: optionalNumber(snapshotSummary, 'maxValue', 0, definition.maximum),
      average: optionalNumber(snapshotSummary, 'avgValue', 0, definition.maximum),
    };
    if (values.minimum !== null && values.maximum !== null && values.minimum > values.maximum) {
      throw new GarminHealthValidationError(`${field}.summaries has a minimum greater than its maximum.`);
    }
    for (const [aggregation, metricValue] of Object.entries(values)) {
      if (metricValue === null) continue;
      metrics.push(canonicalNumberMetric({
        metricId: definition.metricId,
        aggregation,
        semanticVariant: definition.semanticVariant,
        nativeMetric: `${summaryType}.${aggregation}`,
        value: metricValue,
        nativeUnit: definition.nativeUnit,
        canonicalUnit: definition.unit,
        recordingMethod: HEALTH_RECORDING_METHODS.Device,
      }));
    }
    const points = numericMap(
      snapshotSummary.epochSummaries,
      `${field}.summaries[${summaryIndex}].epochSummaries`,
      0,
      definition.maximum,
    );
    assertPointsWithinInterval(points, interval.durationSeconds, `${field}.summaries[${summaryIndex}].epochSummaries`);
    const series = numericSeries({
      seriesKey: `health_snapshot_${summaryType}`,
      points,
      metricId: definition.metricId,
      aggregation: 'sample',
      semanticVariant: definition.semanticVariant,
      nativeMetric: `${summaryType}.epochSummaries`,
      nativeUnit: definition.nativeUnit,
      canonicalUnit: definition.unit,
      coverage: {
        ...commonCoverage(interval.startTimeMs, interval.endTimeMs, interval.durationSeconds, points.length),
        expectedUpdateIntervalMs: 1_000,
      },
    });
    if (series) sampleSeries.push(series);
  });
  const coverage = commonCoverage(
    interval.startTimeMs,
    interval.endTimeMs,
    interval.durationSeconds,
    Math.max(0, ...sampleSeries.map(series => series.offsetMs.length)),
  );
  return finalizeResult({
    providerAccountId,
    summaryId: interval.summaryId,
    sourceRecordType: 'garmin_health_snapshot',
    sourceRecordKey: `${interval.startTimeMs}`,
    revisionOrder,
    receivedAtMs,
    content: {
      kind: HEALTH_SOURCE_RECORD_KINDS.IntervalSummary,
      calendarDate: interval.calendarDate,
      startTimeMs: interval.startTimeMs,
      endTimeMs: interval.endTimeMs,
      timezoneOffsetSeconds: interval.timezoneOffsetSeconds,
      metrics,
      coverage,
      device: GARMIN_DEVICE,
      sampleSeries,
    },
  });
}

const SUMMARY_MAPPERS: Readonly<Record<GarminHealthSummaryType, (
  value: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs: number,
  index: number,
) => GarminHealthResult | null>> = Object.freeze({
  dailies: mapDaily,
  stressDetails: mapStressDetails,
  hrv: mapHrv,
  userMetrics: mapUserMetrics,
  bodyComps: mapBodyComposition,
  pulseox: mapPulseOx,
  allDayRespiration: mapRespiration,
  bloodPressures: mapBloodPressure,
  skinTemp: mapSkinTemperature,
  healthSnapshot: mapHealthSnapshot,
});

export function mapGarminHealthSummaries(
  summaryType: GarminHealthSummaryType,
  payload: unknown,
  providerAccountId: string,
  revisionOrder: number,
  receivedAtMs = Date.now(),
): GarminHealthResult[] {
  if (!Array.isArray(payload)) {
    throw new GarminHealthValidationError(`${summaryType} response must be an array.`);
  }
  if (payload.length > MAX_SUMMARIES_PER_CALLBACK) {
    throw new GarminHealthValidationError(`${summaryType} response exceeds the bounded summary count.`);
  }
  boundedString(providerAccountId, 'providerAccountId');
  requiredNumber(revisionOrder, 'revisionOrder', 0, Number.MAX_SAFE_INTEGER, true);
  requiredNumber(receivedAtMs, 'receivedAtMs', 0, Number.MAX_SAFE_INTEGER, true);
  const byIdentity = new Map<string, GarminHealthResult>();
  payload.forEach((value, index) => {
    const result = SUMMARY_MAPPERS[summaryType](
      value,
      providerAccountId,
      revisionOrder,
      receivedAtMs,
      index,
    );
    if (!result) return;
    const identity = `${result.input.sourceRecordType}:${result.input.sourceRecordKey}`;
    // Garmin's callback response ordering is authoritative for duplicate
    // identities inside the same upload range; only the last row is written.
    byIdentity.set(identity, result);
  });
  return [...byIdentity.values()];
}
