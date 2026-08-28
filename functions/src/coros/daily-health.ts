import { createHash } from 'node:crypto';
import {
  HEALTH_COVERAGE_STATUSES,
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
  HEALTH_PROVIDERS,
  HEALTH_QUALITY_STATUSES,
  HEALTH_RECORDING_METHODS,
  HEALTH_SLEEP_REFERENCE_FIELDS,
  HEALTH_SOURCE_RECORD_KINDS,
  HEALTH_UNITS,
  HEALTH_VALUE_ORIGINS,
  HEALTH_VALUE_TYPES,
  HealthMetricEntry,
  HealthMetricId,
  HealthSleepReferenceField,
  HealthUnit,
} from '../../../shared/health';
import { HealthSampleSeriesInput, HealthSourceRecordInput } from '../health/validation';
import { COROSDailyRecord, getCOROSDailyBounds, getCOROSDailySleepStartTimeMs } from './daily';

const DAY_MS = 24 * 60 * 60 * 1000;
const COROS_DAILY_SOURCE_RECORD_TYPE = 'coros_daily';

export interface COROSDailyHealthResult {
    input: HealthSourceRecordInput;
    observedAtMs: number;
}

interface CanonicalValueOptions {
    metricId: HealthMetricId;
    aggregation: string;
    semanticVariant: string;
    nativeMetric: string;
    value: number;
    nativeUnit: string;
    canonicalUnit: HealthUnit;
}

interface SleepReferenceOptions {
    metricId: HealthMetricId;
    aggregation: string;
    semanticVariant: string;
    field: HealthSleepReferenceField;
    documentId: string;
}

function canonicalValue(options: CanonicalValueOptions): HealthMetricEntry {
    return {
        kind: 'value',
        metricId: options.metricId,
        valueType: HEALTH_VALUE_TYPES.Number,
        aggregation: options.aggregation,
        semanticVariant: options.semanticVariant,
        origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
        recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
        quality: { status: HEALTH_QUALITY_STATUSES.Valid },
        coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
        native: {
            metric: options.nativeMetric,
            value: options.value,
            unit: options.nativeUnit,
        },
        canonical: {
            value: options.value,
            unit: options.canonicalUnit,
        },
    };
}

function sleepReference(options: SleepReferenceOptions): HealthMetricEntry {
    return {
        kind: 'sleep_reference',
        metricId: options.metricId,
        valueType: HEALTH_VALUE_TYPES.Number,
        aggregation: options.aggregation,
        semanticVariant: options.semanticVariant,
        origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
        recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
        quality: { status: HEALTH_QUALITY_STATUSES.Valid },
        coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
        reference: {
            domain: 'sleep',
            documentId: options.documentId,
            field: options.field,
        },
    };
}

function nativeEnergyValue(calorie: number): HealthMetricEntry {
    return {
        kind: 'value',
        metricId: HEALTH_METRIC_IDS.TotalEnergy,
        valueType: HEALTH_VALUE_TYPES.Number,
        aggregation: 'total',
        semanticVariant: 'daily_total',
        origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
        recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
        quality: { status: HEALTH_QUALITY_STATUSES.Valid },
        coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
        native: {
            metric: 'calorie',
            value: calorie,
            unit: 'calorie',
        },
    };
}

function recognizedContentToken(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sampleSeries(
    record: COROSDailyRecord,
    recordStartTimeMs: number,
    minimumSampleTimeMs: number,
    maximumSampleTimeMs: number,
): HealthSampleSeriesInput[] {
    const points = record.hrvPoints.filter(point => (
        point.timestampMs >= minimumSampleTimeMs && point.timestampMs < maximumSampleTimeMs
    ));
    const hrvPoints = points.filter(point => point.hrvMs !== null);
    const heartRatePoints = points.filter(point => point.meanHeartRateBpm !== null);
    const result: HealthSampleSeriesInput[] = [];
    if (hrvPoints.length > 0) {
        result.push({
            seriesKey: 'coros-overnight-hrv',
            metricId: HEALTH_METRIC_IDS.HeartRateVariability,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'sample',
            semanticVariant: 'overnight_interval',
            origin: HEALTH_VALUE_ORIGINS.Recorded,
            recordingMethod: HEALTH_RECORDING_METHODS.Device,
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
            nativeMetric: 'hrvList.hrv',
            nativeUnit: 'ms',
            canonicalUnit: HEALTH_UNITS.Millisecond,
            offsetMs: hrvPoints.map(point => point.timestampMs - recordStartTimeMs),
            nativeValues: hrvPoints.map(point => point.hrvMs as number),
            canonicalValues: hrvPoints.map(point => point.hrvMs as number),
            coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
        });
    }
    if (heartRatePoints.length > 0) {
        result.push({
            seriesKey: 'coros-hrv-interval-mean-heart-rate',
            metricId: HEALTH_METRIC_IDS.HeartRate,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'sample',
            semanticVariant: 'hrv_interval_mean',
            origin: HEALTH_VALUE_ORIGINS.Recorded,
            recordingMethod: HEALTH_RECORDING_METHODS.Device,
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
            nativeMetric: 'hrvList.hr',
            nativeUnit: 'bpm',
            canonicalUnit: HEALTH_UNITS.BeatsPerMinute,
            offsetMs: heartRatePoints.map(point => point.timestampMs - recordStartTimeMs),
            nativeValues: heartRatePoints.map(point => point.meanHeartRateBpm as number),
            canonicalValues: heartRatePoints.map(point => point.meanHeartRateBpm as number),
            coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown },
        });
    }
    return result;
}

export function mapCOROSDailyHealth(
    record: COROSDailyRecord,
    providerAccountId: string,
    receivedAtMs: number,
    sleepDocumentId?: string | null,
): COROSDailyHealthResult | null {
    if (!record.happenDay || !record.calendarDate) return null;

    const dailyBounds = getCOROSDailyBounds(record);
    if (!dailyBounds) return null;
    const earliestAllowedSampleTimeMs = dailyBounds.startTimeMs - DAY_MS;
    const samplesInWindow = record.hrvPoints.filter(point => (
        point.timestampMs >= earliestAllowedSampleTimeMs && point.timestampMs < dailyBounds.endTimeMs
    ));
    const sleepStartTimeMs = getCOROSDailySleepStartTimeMs(record);
    const recordStartTimeMs = Math.min(
        dailyBounds.startTimeMs,
        sleepStartTimeMs ?? dailyBounds.startTimeMs,
        ...samplesInWindow.map(point => point.timestampMs),
    );

    const metrics: HealthMetricEntry[] = [];
    if (record.step !== null) {
        metrics.push(canonicalValue({
            metricId: HEALTH_METRIC_IDS.Steps,
            aggregation: 'total',
            semanticVariant: 'daily_total',
            nativeMetric: 'step',
            value: record.step,
            nativeUnit: 'count',
            canonicalUnit: HEALTH_UNITS.Count,
        }));
    }
    if (record.calorie !== null) metrics.push(nativeEnergyValue(record.calorie));

    // Reference only a sleep interval that also passed the bounded daily-window
    // checks, so malformed provider intervals cannot create dangling references.
    const canReferenceSleep = Boolean(sleepDocumentId && sleepStartTimeMs !== null);
    if (canReferenceSleep) {
        metrics.push(sleepReference({
            metricId: HEALTH_METRIC_IDS.SleepDuration,
            aggregation: 'total',
            semanticVariant: 'session_duration',
            field: HEALTH_SLEEP_REFERENCE_FIELDS.DurationSeconds,
            documentId: sleepDocumentId as string,
        }));
    }
    if (record.restingHeartRateBpm !== null) {
        metrics.push(canReferenceSleep
            ? sleepReference({
                metricId: HEALTH_METRIC_IDS.RestingHeartRate,
                aggregation: 'average',
                semanticVariant: 'daily_resting',
                field: HEALTH_SLEEP_REFERENCE_FIELDS.RestingHeartRate,
                documentId: sleepDocumentId as string,
            })
            : canonicalValue({
                metricId: HEALTH_METRIC_IDS.RestingHeartRate,
                aggregation: 'average',
                semanticVariant: 'daily_resting',
                nativeMetric: 'rhr',
                value: record.restingHeartRateBpm,
                nativeUnit: 'bpm',
                canonicalUnit: HEALTH_UNITS.BeatsPerMinute,
            }));
    }
    if (record.overnightHrvMs !== null) {
        metrics.push(canReferenceSleep
            ? sleepReference({
                metricId: HEALTH_METRIC_IDS.HeartRateVariability,
                aggregation: 'average',
                semanticVariant: 'overnight_average',
                field: HEALTH_SLEEP_REFERENCE_FIELDS.OvernightHrv,
                documentId: sleepDocumentId as string,
            })
            : canonicalValue({
                metricId: HEALTH_METRIC_IDS.HeartRateVariability,
                aggregation: 'average',
                semanticVariant: 'overnight_average',
                nativeMetric: 'ppgHrv',
                value: record.overnightHrvMs,
                nativeUnit: 'ms',
                canonicalUnit: HEALTH_UNITS.Millisecond,
            }));
    }
    if (record.averageSleepHeartRateBpm !== null) {
        metrics.push(canReferenceSleep
            ? sleepReference({
                metricId: HEALTH_METRIC_IDS.HeartRate,
                aggregation: 'average',
                semanticVariant: 'sleep_average',
                field: HEALTH_SLEEP_REFERENCE_FIELDS.AverageHeartRate,
                documentId: sleepDocumentId as string,
            })
            : canonicalValue({
                metricId: HEALTH_METRIC_IDS.HeartRate,
                aggregation: 'average',
                semanticVariant: 'sleep_average',
                nativeMetric: 'sleepAvgHr',
                value: record.averageSleepHeartRateBpm,
                nativeUnit: 'bpm',
                canonicalUnit: HEALTH_UNITS.BeatsPerMinute,
            }));
    }

    const series = sampleSeries(
        record,
        recordStartTimeMs,
        earliestAllowedSampleTimeMs,
        dailyBounds.endTimeMs,
    );
    if (metrics.length === 0 && series.length === 0) return null;

    const latestObservedTimeMs = Math.max(
        dailyBounds.endTimeMs - 1,
        sleepStartTimeMs === null ? dailyBounds.startTimeMs : record.sleepEndTimeMs as number,
        ...samplesInWindow.map(point => point.timestampMs),
    );
    const content = {
        kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
        calendarDate: record.calendarDate,
        startTimeMs: recordStartTimeMs,
        endTimeMs: dailyBounds.endTimeMs,
        timezoneOffsetSeconds: record.timezoneOffsetSeconds,
        metrics,
        coverage: { status: HEALTH_COVERAGE_STATUSES.Unknown } as const,
        sampleSeries: series,
    };
    return {
        input: {
            provider: HEALTH_PROVIDERS.COROSAPI,
            providerAccountId,
            sourceRecordType: COROS_DAILY_SOURCE_RECORD_TYPE,
            sourceRecordKey: record.happenDay,
            revision: {
                order: receivedAtMs,
                // Hash only normalized content that reaches the write. Ignored
                // out-of-window samples must not manufacture a new revision.
                token: recognizedContentToken(content),
            },
            receivedAtMs,
            ...content,
        },
        observedAtMs: Math.min(receivedAtMs, latestObservedTimeMs),
    };
}
