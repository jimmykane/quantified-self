import { describe, expect, it } from 'vitest';
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
} from '../../../shared/health';
import {
    HealthWriteSizeError,
    HealthWriteValidationError,
    validateHealthSourceRecordInput,
} from './validation';

function validInput(): Record<string, unknown> {
    return {
        provider: HEALTH_PROVIDERS.GarminAPI,
        providerAccountId: 'provider-account-1',
        sourceRecordType: 'daily-summary',
        sourceRecordKey: '2026-01-01',
        revision: { order: 1, token: 'revision-1' },
        receivedAtMs: Date.parse('2026-01-02T00:00:00.000Z'),
        kind: HEALTH_SOURCE_RECORD_KINDS.DailySummary,
        calendarDate: '2026-01-01',
        startTimeMs: Date.parse('2026-01-01T00:00:00.000Z'),
        endTimeMs: Date.parse('2026-01-01T23:59:59.999Z'),
        timezoneOffsetSeconds: 0,
        metrics: [{
            kind: 'value',
            metricId: HEALTH_METRIC_IDS.Steps,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'total',
            semanticVariant: 'provider_daily_summary',
            origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
            recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
            quality: { status: HEALTH_QUALITY_STATUSES.Valid },
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
            native: { metric: 'steps', value: 1234, unit: 'count' },
            canonical: { value: 1234, unit: HEALTH_UNITS.Count },
            goal: {
                native: { metric: 'stepGoal', value: 10_000, unit: 'count' },
                canonical: { value: 10_000, unit: HEALTH_UNITS.Count },
            },
        }],
        coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
        sampleSeries: [{
            seriesKey: 'heart-rate',
            metricId: HEALTH_METRIC_IDS.HeartRate,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'sample',
            semanticVariant: 'device_sample',
            origin: HEALTH_VALUE_ORIGINS.Recorded,
            recordingMethod: HEALTH_RECORDING_METHODS.Device,
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
            nativeMetric: 'heartRate',
            nativeUnit: 'bpm',
            canonicalUnit: HEALTH_UNITS.BeatsPerMinute,
            offsetMs: [0, 60_000],
            nativeValues: [60, 61],
            canonicalValues: [60, 61],
            qualityCodes: ['valid', 'valid'],
            coverage: { status: HEALTH_COVERAGE_STATUSES.Complete, sampleCount: 2 },
        }],
    };
}

describe('health write validation', () => {
    it('uses a write-wide error code shared by source-record and sync-state validation', () => {
        expect(new HealthWriteValidationError('invalid').code).toBe('invalid_health_write');
    });

    it('returns a sanitized typed health source record', () => {
        const result = validateHealthSourceRecordInput(validInput());

        expect(result).toMatchObject({
            provider: HEALTH_PROVIDERS.GarminAPI,
            providerAccountId: 'provider-account-1',
            revision: { order: 1, token: 'revision-1' },
        });
        expect(result.metrics[0]).toMatchObject({
            metricId: HEALTH_METRIC_IDS.Steps,
            canonical: { value: 1234, unit: HEALTH_UNITS.Count },
            goal: { canonical: { value: 10_000, unit: HEALTH_UNITS.Count } },
        });
        expect(result.sampleSeries[0].offsetMs).toEqual([0, 60_000]);
    });

    it.each([
        ['providerAccountId', '   ', 'providerAccountId'],
        ['calendarDate', '2026-02-30', 'valid YYYY-MM-DD'],
        ['timezoneOffsetSeconds', 86_400, 'outside the supported range'],
    ])('rejects invalid %s', (field, value, message) => {
        const input = validInput();
        input[field] = value;
        expect(() => validateHealthSourceRecordInput(input)).toThrowError(new RegExp(message));
        expect(() => validateHealthSourceRecordInput(input)).toThrow(HealthWriteValidationError);
    });

    it('accepts a non-standard device display offset within 24 hours of UTC', () => {
        const input = validInput();
        input.timezoneOffsetSeconds = 70_000;

        expect(validateHealthSourceRecordInput(input).timezoneOffsetSeconds).toBe(70_000);
    });

    it('rejects a canonical unit that disagrees with the catalog', () => {
        const input = validInput();
        const metrics = input.metrics as Array<Record<string, unknown>>;
        metrics[0].canonical = { value: 1234, unit: HEALTH_UNITS.Meter };

        expect(() => validateHealthSourceRecordInput(input)).toThrow('canonical.unit must match the metric catalog');
    });

    it('preserves provider source identity for writer-side opaque hashing', () => {
        const input = validInput();
        input.sourceRecordKey = 'provider-account-1:daily:2026-01-01';

        expect(validateHealthSourceRecordInput(input).sourceRecordKey).toBe(
            'provider-account-1:daily:2026-01-01',
        );
    });

    it('rejects non-finite numbers before they can reach Firestore', () => {
        const input = validInput();
        const metrics = input.metrics as Array<Record<string, unknown>>;
        metrics[0].native = { metric: 'steps', value: Number.NaN };

        expect(() => validateHealthSourceRecordInput(input)).toThrow('native.value must be a finite number');
    });

    it('requires ordered integer coverage boundaries and counts', () => {
        const reversed = validInput();
        reversed.coverage = {
            status: HEALTH_COVERAGE_STATUSES.Partial,
            expectedStartTimeMs: 2_000,
            expectedEndTimeMs: 1_000,
        };
        expect(() => validateHealthSourceRecordInput(reversed)).toThrow('expectedEndTimeMs must be on or after');

        const fractionalCount = validInput();
        fractionalCount.coverage = {
            status: HEALTH_COVERAGE_STATUSES.Partial,
            sampleCount: 1.5,
        };
        expect(() => validateHealthSourceRecordInput(fractionalCount)).toThrow('sampleCount must be a safe integer');
    });

    it('requires aligned, strictly increasing sample arrays', () => {
        const input = validInput();
        const sampleSeries = input.sampleSeries as Array<Record<string, unknown>>;
        sampleSeries[0].offsetMs = [0, 60_000, 60_000];
        sampleSeries[0].nativeValues = [60, 61, 62];
        sampleSeries[0].canonicalValues = [60, 61, 62];
        sampleSeries[0].qualityCodes = ['valid', 'valid', 'valid'];

        expect(() => validateHealthSourceRecordInput(input)).toThrow('offsetMs must be strictly increasing');
    });

    it('derives and validates series-level sample coverage counts', () => {
        const derived = validInput();
        const derivedSeries = derived.sampleSeries as Array<Record<string, unknown>>;
        derivedSeries[0].coverage = { status: HEALTH_COVERAGE_STATUSES.Complete };
        expect(validateHealthSourceRecordInput(derived).sampleSeries[0].coverage.sampleCount).toBe(2);

        const mismatched = validInput();
        const mismatchedSeries = mismatched.sampleSeries as Array<Record<string, unknown>>;
        mismatchedSeries[0].coverage = { status: HEALTH_COVERAGE_STATUSES.Complete, sampleCount: 1 };
        expect(() => validateHealthSourceRecordInput(mismatched)).toThrow(
            'coverage.sampleCount must match the aligned sample arrays',
        );
    });

    it('rejects sparse adapter arrays instead of letting holes reach Firestore', () => {
        const sparseMetrics = validInput();
        sparseMetrics.metrics = new Array(1);
        expect(() => validateHealthSourceRecordInput(sparseMetrics)).toThrow('metrics[0] must be an object');

        const sparseOffsets = validInput();
        const sampleSeries = sparseOffsets.sampleSeries as Array<Record<string, unknown>>;
        sampleSeries[0].offsetMs = new Array(2);
        expect(() => validateHealthSourceRecordInput(sparseOffsets)).toThrow('offsetMs[0] must be a finite number');
    });

    it('rejects empty sample quality codes', () => {
        const input = validInput();
        const sampleSeries = input.sampleSeries as Array<Record<string, unknown>>;
        sampleSeries[0].qualityCodes = ['valid', '   '];

        expect(() => validateHealthSourceRecordInput(input)).toThrow('qualityCodes[1] must be a bounded non-empty string');
    });

    it('never accepts canonical sample values without the catalog unit', () => {
        const input = validInput();
        const sampleSeries = input.sampleSeries as Array<Record<string, unknown>>;
        delete sampleSeries[0].canonicalUnit;

        expect(() => validateHealthSourceRecordInput(input)).toThrow('canonicalUnit must match the metric catalog');
    });

    it('rejects a goal whose canonical unit disagrees with the metric catalog', () => {
        const input = validInput();
        const metrics = input.metrics as Array<Record<string, unknown>>;
        metrics[0].goal = { canonical: { value: 10_000, unit: HEALTH_UNITS.Meter } };

        expect(() => validateHealthSourceRecordInput(input)).toThrow('goal.canonical.unit must match the metric catalog');
    });

    it('rejects reserved or duplicate normalized qualifier keys', () => {
        const reserved = validInput();
        const reservedMetric = (reserved.metrics as Array<Record<string, unknown>>)[0];
        const reservedNative = reservedMetric.native as Record<string, unknown>;
        reservedNative.qualifiers = JSON.parse('{"__proto__":"unsafe"}');
        expect(() => validateHealthSourceRecordInput(reserved)).toThrow('reserved qualifier key');

        const duplicate = validInput();
        const duplicateMetric = (duplicate.metrics as Array<Record<string, unknown>>)[0];
        const duplicateNative = duplicateMetric.native as Record<string, unknown>;
        duplicateNative.qualifiers = { ' source ': 'one', source: 'two' };
        expect(() => validateHealthSourceRecordInput(duplicate)).toThrow('duplicate normalized qualifier keys');
    });

    it('rejects an unbounded number of sample series before walking their points', () => {
        const input = validInput();
        const sample = (input.sampleSeries as unknown[])[0];
        input.sampleSeries = Array.from({ length: 201 }, () => sample);

        expect(() => validateHealthSourceRecordInput(input)).toThrow('cannot contain more than 200 series');
    });

    it('stops cloning category samples when their cumulative JSON UTF-8 budget is exhausted', () => {
        const input = validInput();
        const pointCount = 3_000;
        const offsets = Array.from({ length: pointCount }, (_, index) => index * 1_000);
        const largeMultibyteValue = '💣'.repeat(256);
        const firstSeries = {
            ...(input.sampleSeries as Array<Record<string, unknown>>)[0],
            seriesKey: 'stress-state-primary',
            metricId: HEALTH_METRIC_IDS.StressState,
            valueType: HEALTH_VALUE_TYPES.Category,
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
            nativeMetric: 'stressState',
            nativeUnit: null,
            canonicalUnit: null,
            offsetMs: offsets,
            nativeValues: Array(pointCount).fill(largeMultibyteValue),
            canonicalValues: null,
            qualityCodes: null,
            coverage: { status: HEALTH_COVERAGE_STATUSES.Complete, sampleCount: pointCount },
        };
        const secondValues = new Proxy(Array(pointCount).fill(largeMultibyteValue), {
            get(target, property, receiver) {
                if (typeof property === 'string' && /^\d+$/.test(property) && Number(property) >= 2_000) {
                    throw new Error('validator read beyond the cumulative UTF-8 budget');
                }
                return Reflect.get(target, property, receiver);
            },
        });
        input.sampleSeries = [firstSeries, {
            ...firstSeries,
            seriesKey: 'stress-state-secondary',
            nativeValues: secondValues,
        }];

        expect(() => validateHealthSourceRecordInput(input)).toThrow(HealthWriteSizeError);
        expect(() => validateHealthSourceRecordInput(input)).toThrow('cumulative JSON UTF-8 budget');
    });

    it('counts multibyte quality codes in the same cumulative JSON UTF-8 budget', () => {
        const input = validInput();
        const pointCount = 12_500;
        const sampleSeries = input.sampleSeries as Array<Record<string, unknown>>;
        sampleSeries[0].offsetMs = Array.from({ length: pointCount }, (_, index) => index * 1_000);
        sampleSeries[0].nativeValues = Array(pointCount).fill(60);
        sampleSeries[0].canonicalValues = Array(pointCount).fill(60);
        sampleSeries[0].qualityCodes = new Proxy(Array(pointCount).fill('✓'.repeat(128)), {
            get(target, property, receiver) {
                if (typeof property === 'string' && /^\d+$/.test(property) && Number(property) >= 11_500) {
                    throw new Error('validator read beyond the cumulative UTF-8 budget');
                }
                return Reflect.get(target, property, receiver);
            },
        });
        sampleSeries[0].coverage = { status: HEALTH_COVERAGE_STATUSES.Complete, sampleCount: pointCount };

        expect(() => validateHealthSourceRecordInput(input)).toThrow(HealthWriteSizeError);
        expect(() => validateHealthSourceRecordInput(input)).toThrow('cumulative JSON UTF-8 budget');
    });

    it('rejects an oversized raw string before trimming it into a small accepted value', () => {
        const input = validInput();
        const sampleSeries = input.sampleSeries as Array<Record<string, unknown>>;
        sampleSeries[0].metricId = HEALTH_METRIC_IDS.StressState;
        sampleSeries[0].valueType = HEALTH_VALUE_TYPES.Category;
        sampleSeries[0].normalizationStatus = HEALTH_NORMALIZATION_STATUSES.NativeOnly;
        sampleSeries[0].nativeMetric = 'stressState';
        sampleSeries[0].nativeUnit = null;
        sampleSeries[0].canonicalUnit = null;
        sampleSeries[0].offsetMs = [0];
        sampleSeries[0].nativeValues = [`${' '.repeat(5 * 1024 * 1024)}ok`];
        sampleSeries[0].canonicalValues = null;
        sampleSeries[0].qualityCodes = null;
        sampleSeries[0].coverage = { status: HEALTH_COVERAGE_STATUSES.Complete, sampleCount: 1 };

        expect(() => validateHealthSourceRecordInput(input)).toThrow(
            'nativeValues[0] must be a bounded non-empty string',
        );
    });

    it('counts bounded raw string padding before normalized sample values are retained', () => {
        const input = validInput();
        const pointCount = 10_000;
        const paddedValue = `${' '.repeat(510)}x`;
        const sampleSeries = input.sampleSeries as Array<Record<string, unknown>>;
        sampleSeries[0].metricId = HEALTH_METRIC_IDS.StressState;
        sampleSeries[0].valueType = HEALTH_VALUE_TYPES.Category;
        sampleSeries[0].normalizationStatus = HEALTH_NORMALIZATION_STATUSES.NativeOnly;
        sampleSeries[0].nativeMetric = 'stressState';
        sampleSeries[0].nativeUnit = null;
        sampleSeries[0].canonicalUnit = null;
        sampleSeries[0].offsetMs = Array.from({ length: pointCount }, (_, index) => index * 1_000);
        sampleSeries[0].nativeValues = new Proxy(Array(pointCount).fill(paddedValue), {
            get(target, property, receiver) {
                if (typeof property === 'string' && /^\d+$/.test(property) && Number(property) >= 9_000) {
                    throw new Error('validator read beyond the raw UTF-8 budget');
                }
                return Reflect.get(target, property, receiver);
            },
        });
        sampleSeries[0].canonicalValues = null;
        sampleSeries[0].qualityCodes = null;
        sampleSeries[0].coverage = { status: HEALTH_COVERAGE_STATUSES.Complete, sampleCount: pointCount };

        expect(() => validateHealthSourceRecordInput(input)).toThrow(HealthWriteSizeError);
        expect(() => validateHealthSourceRecordInput(input)).toThrow('cumulative JSON UTF-8 budget');
    });

    it('accepts sleep references only to the existing allowlisted sleep model', () => {
        const input = validInput();
        input.sampleSeries = [];
        input.metrics = [{
            kind: 'sleep_reference',
            metricId: HEALTH_METRIC_IDS.HeartRate,
            valueType: HEALTH_VALUE_TYPES.Number,
            aggregation: 'average',
            semanticVariant: 'sleep_session',
            origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
            recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
            quality: { status: HEALTH_QUALITY_STATUSES.Valid },
            reference: {
                domain: 'sleep',
                documentId: 'sleep-session-1',
                field: 'vitals.averageHeartRateBpm',
            },
        }];

        expect(validateHealthSourceRecordInput(input).metrics[0]).toMatchObject({
            kind: 'sleep_reference',
            reference: { documentId: 'sleep-session-1', field: 'vitals.averageHeartRateBpm' },
        });

        const metrics = input.metrics as Array<Record<string, unknown>>;
        metrics[0].reference = { domain: 'sleep', documentId: 'sleep-session-1', field: 'providerFields.raw' };
        expect(() => validateHealthSourceRecordInput(input)).toThrow('reference.field is not supported');

        metrics[0].reference = { domain: 'sleep', documentId: 'sleep-session-1', field: 'durationSeconds' };
        expect(() => validateHealthSourceRecordInput(input)).toThrow('metricId does not match the referenced sleep field');

        metrics[0].metricId = HEALTH_METRIC_IDS.SleepDuration;
        metrics[0].reference = { domain: 'sleep', documentId: 'nested/sleep-session', field: 'durationSeconds' };
        expect(() => validateHealthSourceRecordInput(input)).toThrow('safe bounded document ID');
    });
});
