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
  HealthMetricId,
  HealthUnit,
} from '../../../shared/health';
import { HealthSampleSeriesInput, HealthSourceRecordInput } from '../health/validation';

type ExternalRecord = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPECTED_UPDATE_INTERVAL_MS = 48 * 60 * 60 * 1000;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_DEVICE_SOURCE_LENGTH = 256;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/;
const SUUNTO_ACTIVITY_SOURCE_RECORD_TYPE = 'suunto_247_activity';
const SUUNTO_DAILY_STATISTICS_SOURCE_RECORD_TYPE = 'suunto_247_daily_activity_statistics';
const SUUNTO_RECOVERY_SOURCE_RECORD_TYPE = 'suunto_247_recovery';

export const SUUNTO_HEALTH_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const SUUNTO_HEALTH_MAX_SAMPLES = 10_000;
export const SUUNTO_HEALTH_MAX_STATISTIC_GROUPS = 16;
export const SUUNTO_HEALTH_MAX_STATISTIC_SOURCES = 64;
export const SUUNTO_HEALTH_MAX_STATISTIC_SAMPLES_PER_SOURCE = 64;
export const SUUNTO_HEALTH_MAX_SERIES_SOURCE_RECORDS = 256;
export const SUUNTO_HEALTH_MAX_DAILY_SOURCE_RECORDS = 256;
export const SUUNTO_HEALTH_MAX_WINDOW_DAYS = 28;
export const SUUNTO_HEALTH_REQUEST_TIMEOUT_MS = 30_000;
export const SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH = 512;
export const SUUNTO_HEALTH_BACKFILL_MAX_ACCOUNTS = 8;
export const SUUNTO_HEALTH_MAX_SUPPORTED_TIMESTAMP_MS = 8_640_000_000_000_000 - DAY_MS;

export class SuuntoHealthValidationError extends Error {
  public readonly name = 'SuuntoHealthValidationError';
  public readonly code = 'suunto_health_invalid_response';

  constructor(message: string) {
    super(message);
  }
}

export interface SuuntoHealthResult {
  input: HealthSourceRecordInput;
  observedAtMs: number;
}

interface ParsedTimestamp {
  timestampMs: number;
  calendarDate: string;
  timezoneOffsetSeconds: number | null;
}

export interface SuuntoActivitySample extends ParsedTimestamp {
  heartRateBpm: number | null;
  minimumHeartRateBpm: number | null;
  maximumHeartRateBpm: number | null;
  heartRateVariabilityMs: number | null;
  bloodOxygenRatio: number | null;
  altitudeMeters: number | null;
  stepCount: number | null;
  energyJoules: number | null;
}

export interface SuuntoRecoverySample extends ParsedTimestamp {
  balanceRatio: number | null;
  stressState: 1 | 2 | 3 | 4 | null;
}

interface SuuntoDailyStatisticValue extends ParsedTimestamp {
  metricName: 'stepcount' | 'energyconsumption';
  aggregation: 'sum' | 'avg';
  sourceName: string;
  value: number;
}

function asRecord(value: unknown, field: string): ExternalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SuuntoHealthValidationError(`${field} must be an object.`);
  }
  return value as ExternalRecord;
}

function boundedString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new SuuntoHealthValidationError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new SuuntoHealthValidationError(`${field} must be a bounded non-empty string.`);
  }
  return normalized;
}

function parseOffsetSeconds(value: string | undefined): number | null {
  if (!value || value === 'Z') return value === 'Z' ? 0 : null;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 18 || minutes > 59 || (hours === 18 && minutes !== 0)) return null;
  const seconds = ((hours * 60) + minutes) * 60;
  return match[1] === '-' ? -seconds : seconds;
}

function parseTimestamp(value: unknown, field: string, requireOffset: boolean): ParsedTimestamp {
  const timestamp = boundedString(value, field, MAX_TIMESTAMP_LENGTH);
  const match = ISO_TIMESTAMP_PATTERN.exec(timestamp);
  if (!match || (requireOffset && !match[8])) {
    throw new SuuntoHealthValidationError(`${field} must be a valid ISO8601 timestamp${requireOffset ? ' with an offset' : ''}.`);
  }
  const [, year, month, day, hour, minute, second, fraction = '', suffix] = match;
  const wallClockMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, '0').slice(0, 3)),
  );
  const wallClock = new Date(wallClockMs);
  if (wallClock.getUTCFullYear() !== Number(year)
    || wallClock.getUTCMonth() !== Number(month) - 1
    || wallClock.getUTCDate() !== Number(day)
    || wallClock.getUTCHours() !== Number(hour)
    || wallClock.getUTCMinutes() !== Number(minute)
    || wallClock.getUTCSeconds() !== Number(second)) {
    throw new SuuntoHealthValidationError(`${field} contains an invalid calendar value.`);
  }
  const timezoneOffsetSeconds = parseOffsetSeconds(suffix);
  if (suffix && timezoneOffsetSeconds === null) {
    throw new SuuntoHealthValidationError(`${field} contains an unsupported timezone offset.`);
  }
  const timestampMs = wallClockMs - ((timezoneOffsetSeconds || 0) * 1000);
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
    throw new SuuntoHealthValidationError(`${field} is outside the supported timestamp range.`);
  }
  return {
    timestampMs,
    calendarDate: `${year}-${month}-${day}`,
    timezoneOffsetSeconds,
  };
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
  if (typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
    || (integer && !Number.isSafeInteger(value))) {
    throw new SuuntoHealthValidationError(`${field} is outside the supported numeric range.`);
  }
  return value;
}

function payloadArray(value: unknown, field: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new SuuntoHealthValidationError(`${field} response must be an array.`);
  }
  if (value.length > maximum) {
    throw new SuuntoHealthValidationError(`${field} response exceeds the bounded item count.`);
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  const record = value as ExternalRecord;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function recognizedContentToken(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function dedupeByTimestamp<T extends ParsedTimestamp>(samples: T[], family: string): T[] {
  const byTimestamp = new Map<string, T>();
  for (const sample of samples) {
    const key = `${sample.timestampMs}:${sample.timezoneOffsetSeconds ?? 'unknown'}`;
    const existing = byTimestamp.get(key);
    if (existing && stableStringify(existing) !== stableStringify(sample)) {
      throw new SuuntoHealthValidationError(`${family} response contains conflicting duplicate timestamps.`);
    }
    byTimestamp.set(key, sample);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestampMs - right.timestampMs);
}

export function parseSuuntoActivitySamples(value: unknown): SuuntoActivitySample[] {
  const samples = payloadArray(value, 'Suunto activity', SUUNTO_HEALTH_MAX_SAMPLES).map((item, index) => {
    const sample = asRecord(item, `activity[${index}]`);
    const timestamp = parseTimestamp(sample.timestamp, `activity[${index}].timestamp`, true);
    const entryData = asRecord(sample.entryData, `activity[${index}].entryData`);
    let minimumHeartRateBpm: number | null = null;
    let maximumHeartRateBpm: number | null = null;
    if (entryData.HRExt !== undefined && entryData.HRExt !== null) {
      const minMax = asRecord(entryData.HRExt, `activity[${index}].entryData.HRExt`);
      minimumHeartRateBpm = optionalNumber(minMax, 'Min', 1, 300);
      maximumHeartRateBpm = optionalNumber(minMax, 'Max', 1, 300);
      if (minimumHeartRateBpm !== null && maximumHeartRateBpm !== null && minimumHeartRateBpm > maximumHeartRateBpm) {
        throw new SuuntoHealthValidationError('Suunto activity HRExt minimum exceeds maximum.');
      }
    }
    return {
      ...timestamp,
      heartRateBpm: optionalNumber(entryData, 'HR', 1, 300),
      minimumHeartRateBpm,
      maximumHeartRateBpm,
      heartRateVariabilityMs: optionalNumber(entryData, 'HRV', 1, 100_000, true),
      bloodOxygenRatio: optionalNumber(entryData, 'SpO2', 0, 1),
      altitudeMeters: optionalNumber(entryData, 'Altitude', -20_000, 100_000),
      stepCount: optionalNumber(entryData, 'StepCount', 0, 10_000_000, true),
      energyJoules: optionalNumber(entryData, 'EnergyConsumption', 0, 1_000_000_000_000),
    };
  });
  return dedupeByTimestamp(samples, 'Suunto activity');
}

export function parseSuuntoRecoverySamples(value: unknown): SuuntoRecoverySample[] {
  const samples = payloadArray(value, 'Suunto recovery', SUUNTO_HEALTH_MAX_SAMPLES).map((item, index) => {
    const sample = asRecord(item, `recovery[${index}]`);
    const timestamp = parseTimestamp(sample.timestamp, `recovery[${index}].timestamp`, true);
    const entryData = asRecord(sample.entryData, `recovery[${index}].entryData`);
    const rawStressState = optionalNumber(entryData, 'StressState', 0, 4, true);
    return {
      ...timestamp,
      balanceRatio: optionalNumber(entryData, 'Balance', 0, 1),
      stressState: rawStressState === 0 || rawStressState === null
        ? null
        : rawStressState as 1 | 2 | 3 | 4,
    };
  });
  return dedupeByTimestamp(samples, 'Suunto recovery');
}

function statisticNumber(value: unknown, metricName: string): number | null {
  if (value === null || value === undefined) return null;
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && (!value.trim() || value.length > 64))) {
    throw new SuuntoHealthValidationError(`${metricName} statistic value must be numeric or null.`);
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 1_000_000_000_000) {
    throw new SuuntoHealthValidationError(`${metricName} statistic value is outside the supported range.`);
  }
  return numberValue;
}

function parseSuuntoDailyStatisticValues(value: unknown): SuuntoDailyStatisticValue[] {
  const groups = payloadArray(value, 'Suunto daily statistics', SUUNTO_HEALTH_MAX_STATISTIC_GROUPS);
  const values = new Map<string, SuuntoDailyStatisticValue | null>();
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = asRecord(groups[groupIndex], `statistics[${groupIndex}]`);
    const rawMetricName = boundedString(group.Name, `statistics[${groupIndex}].Name`, 64).toLowerCase();
    if (rawMetricName !== 'stepcount' && rawMetricName !== 'energyconsumption') continue;
    const aggregation = boundedString(group.Aggregation, `statistics[${groupIndex}].Aggregation`, 16).toLowerCase();
    if (aggregation !== 'sum' && aggregation !== 'avg') {
      throw new SuuntoHealthValidationError('Suunto daily statistics contains an unsupported aggregation.');
    }
    const sources = payloadArray(
      group.Sources,
      `statistics[${groupIndex}].Sources`,
      SUUNTO_HEALTH_MAX_STATISTIC_SOURCES,
    );
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      const source = asRecord(sources[sourceIndex], `statistics[${groupIndex}].Sources[${sourceIndex}]`);
      const sourceName = boundedString(
        source.Name,
        `statistics[${groupIndex}].Sources[${sourceIndex}].Name`,
        MAX_DEVICE_SOURCE_LENGTH,
      );
      const samples = payloadArray(
        source.Samples,
        `statistics[${groupIndex}].Sources[${sourceIndex}].Samples`,
        SUUNTO_HEALTH_MAX_STATISTIC_SAMPLES_PER_SOURCE,
      );
      for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
        const sample = asRecord(
          samples[sampleIndex],
          `statistics[${groupIndex}].Sources[${sourceIndex}].Samples[${sampleIndex}]`,
        );
        const timestamp = parseTimestamp(
          sample.TimeISO8601,
          `statistics[${groupIndex}].Sources[${sourceIndex}].Samples[${sampleIndex}].TimeISO8601`,
          false,
        );
        const parsedValue = statisticNumber(sample.Value, rawMetricName);
        const key = [sourceName, rawMetricName, aggregation, timestamp.calendarDate, timestamp.timezoneOffsetSeconds ?? 'unknown'].join(':');
        if (parsedValue === null) {
          if (!values.has(key)) values.set(key, null);
          continue;
        }
        const next: SuuntoDailyStatisticValue = {
          ...timestamp,
          metricName: rawMetricName,
          aggregation,
          sourceName,
          value: parsedValue,
        };
        const existing = values.get(key);
        if (existing && stableStringify(existing) !== stableStringify(next)) {
          throw new SuuntoHealthValidationError('Suunto daily statistics contains conflicting non-null duplicates.');
        }
        values.set(key, next);
      }
    }
  }
  return [...values.values()]
    .filter((item): item is SuuntoDailyStatisticValue => item !== null)
    .sort((left, right) => left.timestampMs - right.timestampMs
      || left.sourceName.localeCompare(right.sourceName)
      || left.metricName.localeCompare(right.metricName)
      || left.aggregation.localeCompare(right.aggregation));
}

function localDayBounds(calendarDate: string, timezoneOffsetSeconds: number | null): { startTimeMs: number; endTimeMs: number } {
  const startTimeMs = Date.parse(`${calendarDate}T00:00:00.000Z`) - ((timezoneOffsetSeconds || 0) * 1000);
  return { startTimeMs, endTimeMs: startTimeMs + DAY_MS };
}

function coverageForDay(
  calendarDate: string,
  timezoneOffsetSeconds: number | null,
  receivedAtMs: number,
  sampleCount: number,
  bounds = localDayBounds(calendarDate, timezoneOffsetSeconds),
): HealthCoverage {
  const localReceivedDate = new Date(receivedAtMs + ((timezoneOffsetSeconds || 0) * 1000))
    .toISOString()
    .slice(0, 10);
  return {
    status: calendarDate === localReceivedDate
      ? HEALTH_COVERAGE_STATUSES.Partial
      : HEALTH_COVERAGE_STATUSES.Unknown,
    expectedStartTimeMs: bounds.startTimeMs,
    expectedEndTimeMs: bounds.endTimeMs,
    expectedDurationSeconds: DAY_MS / 1000,
    sampleCount,
    expectedUpdateIntervalMs: EXPECTED_UPDATE_INTERVAL_MS,
  };
}

interface SeriesOptions<T> {
  key: string;
  samples: T[];
  value: (sample: T) => number | string | null;
  metricId: HealthMetricId;
  valueType?: 'number' | 'category';
  aggregation: string;
  semanticVariant: string;
  nativeMetric: string;
  nativeUnit?: string;
  canonicalUnit: HealthUnit;
  canonicalValue?: (value: number | string) => number | string;
  qualityCode?: (sample: T) => string | null;
}

function buildSeries<T extends ParsedTimestamp>(
  options: SeriesOptions<T>,
  recordStartTimeMs: number,
  coverage: HealthCoverage,
): HealthSampleSeriesInput | null {
  const points = options.samples
    .map(sample => ({ sample, value: options.value(sample) }))
    .filter((point): point is { sample: T; value: number | string } => point.value !== null);
  if (points.length === 0) return null;
  const canonicalValues = points.map(point => options.canonicalValue
    ? options.canonicalValue(point.value)
    : point.value);
  const qualityCodes = options.qualityCode
    ? points.map(point => options.qualityCode?.(point.sample) || 'unknown')
    : undefined;
  return {
    seriesKey: options.key,
    metricId: options.metricId,
    valueType: options.valueType || HEALTH_VALUE_TYPES.Number,
    aggregation: options.aggregation,
    semanticVariant: options.semanticVariant,
    origin: HEALTH_VALUE_ORIGINS.Recorded,
    recordingMethod: HEALTH_RECORDING_METHODS.Device,
    normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
    nativeMetric: options.nativeMetric,
    nativeUnit: options.nativeUnit,
    canonicalUnit: options.canonicalUnit,
    offsetMs: points.map(point => point.sample.timestampMs - recordStartTimeMs),
    nativeValues: points.map(point => point.value),
    canonicalValues,
    qualityCodes,
    coverage: {
      ...coverage,
      sampleCount: points.length,
    },
  };
}

function groupByLocalDay<T extends ParsedTimestamp>(samples: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const sample of samples) {
    const key = `${sample.calendarDate}:${sample.timezoneOffsetSeconds ?? 'unknown'}`;
    const group = groups.get(key) || [];
    group.push(sample);
    groups.set(key, group);
    if (groups.size > SUUNTO_HEALTH_MAX_SERIES_SOURCE_RECORDS) {
      throw new SuuntoHealthValidationError('Suunto Health samples exceed the bounded source-record count.');
    }
  }
  return groups;
}

export function mapSuuntoActivityHealth(
  samples: SuuntoActivitySample[],
  providerAccountId: string,
  receivedAtMs: number,
): SuuntoHealthResult[] {
  const results: SuuntoHealthResult[] = [];
  for (const group of groupByLocalDay(samples).values()) {
    const first = group[0];
    const bounds = localDayBounds(first.calendarDate, first.timezoneOffsetSeconds);
    const coverage = coverageForDay(first.calendarDate, first.timezoneOffsetSeconds, receivedAtMs, group.length);
    const series = [
      buildSeries({ key: 'suunto-activity-heart-rate-average', samples: group, value: item => item.heartRateBpm, metricId: HEALTH_METRIC_IDS.HeartRate, aggregation: 'average', semanticVariant: 'activity_interval_average', nativeMetric: 'HR', nativeUnit: 'bpm', canonicalUnit: HEALTH_UNITS.BeatsPerMinute }, bounds.startTimeMs, coverage),
      buildSeries({ key: 'suunto-activity-heart-rate-minimum', samples: group, value: item => item.minimumHeartRateBpm, metricId: HEALTH_METRIC_IDS.HeartRate, aggregation: 'minimum', semanticVariant: 'activity_interval_minimum', nativeMetric: 'HRExt.Min', nativeUnit: 'bpm', canonicalUnit: HEALTH_UNITS.BeatsPerMinute }, bounds.startTimeMs, coverage),
      buildSeries({ key: 'suunto-activity-heart-rate-maximum', samples: group, value: item => item.maximumHeartRateBpm, metricId: HEALTH_METRIC_IDS.HeartRate, aggregation: 'maximum', semanticVariant: 'activity_interval_maximum', nativeMetric: 'HRExt.Max', nativeUnit: 'bpm', canonicalUnit: HEALTH_UNITS.BeatsPerMinute }, bounds.startTimeMs, coverage),
      buildSeries({ key: 'suunto-activity-hrv', samples: group, value: item => item.heartRateVariabilityMs, metricId: HEALTH_METRIC_IDS.HeartRateVariability, aggregation: 'sample', semanticVariant: 'activity_interval', nativeMetric: 'HRV', nativeUnit: 'ms', canonicalUnit: HEALTH_UNITS.Millisecond }, bounds.startTimeMs, coverage),
      buildSeries({ key: 'suunto-activity-spo2', samples: group, value: item => item.bloodOxygenRatio, metricId: HEALTH_METRIC_IDS.BloodOxygenSaturation, aggregation: 'sample', semanticVariant: 'activity_interval', nativeMetric: 'SpO2', nativeUnit: 'ratio', canonicalUnit: HEALTH_UNITS.Percent, canonicalValue: value => (value as number) * 100 }, bounds.startTimeMs, coverage),
      buildSeries({ key: 'suunto-activity-altitude', samples: group, value: item => item.altitudeMeters, metricId: HEALTH_METRIC_IDS.Altitude, aggregation: 'sample', semanticVariant: 'activity_interval', nativeMetric: 'Altitude', nativeUnit: 'm', canonicalUnit: HEALTH_UNITS.Meter }, bounds.startTimeMs, coverage),
      buildSeries({ key: 'suunto-activity-steps', samples: group, value: item => item.stepCount, metricId: HEALTH_METRIC_IDS.Steps, aggregation: 'total', semanticVariant: 'activity_interval_accumulated', nativeMetric: 'StepCount', nativeUnit: 'count', canonicalUnit: HEALTH_UNITS.Count }, bounds.startTimeMs, coverage),
      buildSeries({ key: 'suunto-activity-energy', samples: group, value: item => item.energyJoules, metricId: HEALTH_METRIC_IDS.TotalEnergy, aggregation: 'total', semanticVariant: 'activity_interval_consumption', nativeMetric: 'EnergyConsumption', nativeUnit: 'J', canonicalUnit: HEALTH_UNITS.Kilocalorie, canonicalValue: value => (value as number) / 4184 }, bounds.startTimeMs, coverage),
    ].filter((item): item is HealthSampleSeriesInput => item !== null);
    if (series.length === 0) continue;
    const content = {
      kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
      calendarDate: first.calendarDate,
      startTimeMs: bounds.startTimeMs,
      endTimeMs: bounds.endTimeMs,
      timezoneOffsetSeconds: first.timezoneOffsetSeconds,
      metrics: [] as HealthMetricEntry[],
      coverage,
      sampleSeries: series,
    };
    results.push({
      input: {
        provider: HEALTH_PROVIDERS.SuuntoApp,
        providerAccountId,
        sourceRecordType: SUUNTO_ACTIVITY_SOURCE_RECORD_TYPE,
        sourceRecordKey: `${first.calendarDate}:${first.timezoneOffsetSeconds ?? 'unknown'}`,
        revision: { order: receivedAtMs, token: recognizedContentToken(content) },
        receivedAtMs,
        ...content,
      },
      observedAtMs: Math.min(receivedAtMs, Math.max(...group.map(item => item.timestampMs))),
    });
  }
  return results.sort((left, right) => left.input.startTimeMs - right.input.startTimeMs);
}

const STRESS_STATE_LABELS: Readonly<Record<1 | 2 | 3 | 4, string>> = {
  1: 'relaxing',
  2: 'active',
  3: 'passive',
  4: 'stressful',
};

export function mapSuuntoRecoveryHealth(
  samples: SuuntoRecoverySample[],
  providerAccountId: string,
  receivedAtMs: number,
): SuuntoHealthResult[] {
  const results: SuuntoHealthResult[] = [];
  for (const group of groupByLocalDay(samples).values()) {
    const first = group[0];
    const bounds = localDayBounds(first.calendarDate, first.timezoneOffsetSeconds);
    const coverage = coverageForDay(first.calendarDate, first.timezoneOffsetSeconds, receivedAtMs, group.length);
    const series = [
      buildSeries({ key: 'suunto-recovery-balance', samples: group, value: item => item.balanceRatio, metricId: HEALTH_METRIC_IDS.BodyEnergy, aggregation: 'sample', semanticVariant: 'recovery_balance', nativeMetric: 'Balance', nativeUnit: 'ratio', canonicalUnit: HEALTH_UNITS.Percent, canonicalValue: value => (value as number) * 100 }, bounds.startTimeMs, coverage),
      buildSeries({ key: 'suunto-recovery-stress-state', samples: group, value: item => item.stressState === null ? null : STRESS_STATE_LABELS[item.stressState], metricId: HEALTH_METRIC_IDS.StressState, valueType: HEALTH_VALUE_TYPES.Category, aggregation: 'sample', semanticVariant: 'recovery_state', nativeMetric: 'StressState', nativeUnit: 'category', canonicalUnit: HEALTH_UNITS.Category, qualityCode: item => item.stressState === null ? null : `${item.stressState}` }, bounds.startTimeMs, coverage),
    ].filter((item): item is HealthSampleSeriesInput => item !== null);
    if (series.length === 0) continue;
    const content = {
      kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
      calendarDate: first.calendarDate,
      startTimeMs: bounds.startTimeMs,
      endTimeMs: bounds.endTimeMs,
      timezoneOffsetSeconds: first.timezoneOffsetSeconds,
      metrics: [] as HealthMetricEntry[],
      coverage,
      sampleSeries: series,
    };
    results.push({
      input: {
        provider: HEALTH_PROVIDERS.SuuntoApp,
        providerAccountId,
        sourceRecordType: SUUNTO_RECOVERY_SOURCE_RECORD_TYPE,
        sourceRecordKey: `${first.calendarDate}:${first.timezoneOffsetSeconds ?? 'unknown'}`,
        revision: { order: receivedAtMs, token: recognizedContentToken(content) },
        receivedAtMs,
        ...content,
      },
      observedAtMs: Math.min(receivedAtMs, Math.max(...group.map(item => item.timestampMs))),
    });
  }
  return results.sort((left, right) => left.input.startTimeMs - right.input.startTimeMs);
}

function dailyMetric(value: SuuntoDailyStatisticValue): HealthMetricEntry {
  const isSteps = value.metricName === 'stepcount';
  const canonicalValue = isSteps ? value.value : value.value / 4184;
  return {
    kind: 'value',
    metricId: isSteps ? HEALTH_METRIC_IDS.Steps : HEALTH_METRIC_IDS.TotalEnergy,
    valueType: HEALTH_VALUE_TYPES.Number,
    aggregation: value.aggregation === 'sum' ? 'total' : 'average',
    semanticVariant: value.aggregation === 'sum' ? 'provider_daily_total' : 'provider_daily_average',
    origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
    recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
    quality: { status: HEALTH_QUALITY_STATUSES.Valid },
    coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown, expectedUpdateIntervalMs: EXPECTED_UPDATE_INTERVAL_MS },
    normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
    native: {
      metric: value.metricName,
      value: value.value,
      unit: isSteps ? 'count' : 'J',
      qualifiers: { aggregation: value.aggregation },
    },
    canonical: {
      value: canonicalValue,
      unit: isSteps ? HEALTH_UNITS.Count : HEALTH_UNITS.Kilocalorie,
    },
  };
}

function opaqueDeviceKey(providerAccountId: string, sourceName: string): string {
  return createHash('sha256')
    .update(`suunto-health-device-v1\0${providerAccountId}\0${sourceName}`)
    .digest('hex');
}

export function mapSuuntoDailyStatisticsHealth(
  payload: unknown,
  providerAccountId: string,
  receivedAtMs: number,
): SuuntoHealthResult[] {
  const values = parseSuuntoDailyStatisticValues(payload);
  const groups = new Map<string, SuuntoDailyStatisticValue[]>();
  for (const value of values) {
    const key = `${value.sourceName}:${value.calendarDate}:${value.timezoneOffsetSeconds ?? 'unknown'}`;
    const group = groups.get(key) || [];
    group.push(value);
    groups.set(key, group);
    if (groups.size > SUUNTO_HEALTH_MAX_DAILY_SOURCE_RECORDS) {
      throw new SuuntoHealthValidationError('Suunto daily statistics exceeds the bounded source-record count.');
    }
  }
  const results: SuuntoHealthResult[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (group.some(item => item.timestampMs !== first.timestampMs)) {
      throw new SuuntoHealthValidationError('Suunto daily statistics has conflicting day boundaries for one source.');
    }
    const bounds = {
      startTimeMs: first.timestampMs,
      endTimeMs: first.timestampMs + DAY_MS,
    };
    const coverage = coverageForDay(
      first.calendarDate,
      first.timezoneOffsetSeconds,
      receivedAtMs,
      1,
      bounds,
    );
    const metrics = group.map(dailyMetric).sort((left, right) => left.metricId.localeCompare(right.metricId)
      || left.aggregation.localeCompare(right.aggregation)
      || left.semanticVariant.localeCompare(right.semanticVariant));
    const content = {
      kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
      calendarDate: first.calendarDate,
      startTimeMs: bounds.startTimeMs,
      endTimeMs: bounds.endTimeMs,
      timezoneOffsetSeconds: first.timezoneOffsetSeconds,
      metrics,
      coverage,
      device: {
        deviceKey: opaqueDeviceKey(providerAccountId, first.sourceName),
        manufacturer: 'Suunto',
      },
      sampleSeries: [] as HealthSampleSeriesInput[],
    };
    results.push({
      input: {
        provider: HEALTH_PROVIDERS.SuuntoApp,
        providerAccountId,
        sourceRecordType: SUUNTO_DAILY_STATISTICS_SOURCE_RECORD_TYPE,
        sourceRecordKey: `${first.sourceName}:${first.calendarDate}:${first.timezoneOffsetSeconds ?? 'unknown'}`,
        revision: { order: receivedAtMs, token: recognizedContentToken(content) },
        receivedAtMs,
        ...content,
      },
      observedAtMs: Math.min(receivedAtMs, first.timestampMs + DAY_MS - 1),
    });
  }
  return results.sort((left, right) => left.input.startTimeMs - right.input.startTimeMs
    || left.input.sourceRecordKey.localeCompare(right.input.sourceRecordKey));
}

export function assertSuuntoHealthRange(startMs: unknown, endMs: unknown): { startMs: number; endMs: number } {
  if (!Number.isSafeInteger(startMs)
    || !Number.isSafeInteger(endMs)
    || Number(startMs) < 0
    || Number(endMs) <= Number(startMs)
    || Number(endMs) > SUUNTO_HEALTH_MAX_SUPPORTED_TIMESTAMP_MS
    || Number(endMs) - Number(startMs) > SUUNTO_HEALTH_MAX_WINDOW_DAYS * DAY_MS) {
    throw new SuuntoHealthValidationError('Suunto Health range must be a supported positive window of at most 28 days.');
  }
  return { startMs: Number(startMs), endMs: Number(endMs) };
}

export function assertSuuntoHealthSamplesInRange<T extends ParsedTimestamp>(
  samples: readonly T[],
  startMs: number,
  endMs: number,
  family: string,
): void {
  if (samples.some(sample => sample.timestampMs < startMs || sample.timestampMs >= endMs)) {
    throw new SuuntoHealthValidationError(`${family} response contains a timestamp outside the requested range.`);
  }
}

export const suuntoHealthTestInternals = {
  parseSuuntoDailyStatisticValues,
  parseTimestamp,
};
