import { describe, expect, it } from 'vitest';
import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_PROVIDERS,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_RECORD_KINDS,
    HEALTH_UNITS,
    HEALTH_VALUE_ORIGINS,
    HEALTH_VALUE_TYPES,
} from '../../../shared/health';
import { HealthWriteValidationError, validateHealthSourceRecordInput } from './validation';

function validInput(): Record<string, unknown> {
    return {
        provider: HEALTH_PROVIDERS.GarminAPI,
        providerAccountId: 'provider-account-1',
        sourceRecordType: 'daily-summary',
        sourceRecordKey: '2026-01-01',
        revision: { order: 1, token: 'revision-1' },
        receivedAtMs: Date.parse('2026-01-02T00:00:00.000Z'),
        kind: HEALTH_RECORD_KINDS.DailySummary,
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
    it('returns a sanitized typed provider record', () => {
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
        ['timezoneOffsetSeconds', 70_000, 'outside the supported range'],
    ])('rejects invalid %s', (field, value, message) => {
        const input = validInput();
        input[field] = value;
        expect(() => validateHealthSourceRecordInput(input)).toThrowError(new RegExp(message));
        expect(() => validateHealthSourceRecordInput(input)).toThrow(HealthWriteValidationError);
    });

    it('rejects a canonical unit that disagrees with the catalog', () => {
        const input = validInput();
        const metrics = input.metrics as Array<Record<string, unknown>>;
        metrics[0].canonical = { value: 1234, unit: HEALTH_UNITS.Meter };

        expect(() => validateHealthSourceRecordInput(input)).toThrow('canonical.unit must match the metric catalog');
    });

    it('rejects non-finite numbers before they can reach Firestore', () => {
        const input = validInput();
        const metrics = input.metrics as Array<Record<string, unknown>>;
        metrics[0].native = { metric: 'steps', value: Number.NaN };

        expect(() => validateHealthSourceRecordInput(input)).toThrow('native.value must be a finite number');
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
    });
});
