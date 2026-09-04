import {
    HEALTH_COVERAGE_STATUSES,
    HEALTH_METRIC_CATALOG,
    HEALTH_METRIC_IDS,
    HEALTH_NORMALIZATION_STATUSES,
    HEALTH_QUALITY_STATUSES,
    HEALTH_RECORDING_METHODS,
    HEALTH_VALUE_ORIGINS,
    type HealthMetricId,
    type HealthMetricValue,
} from '@shared/health';
import {
    decodeHealthMetricSportsLibData,
    decodeSleepSessionSportsLibData,
    encodeHealthMetricSportsLibData,
    encodeSleepSessionSportsLibData,
    formatCanonicalHealthMetricSportsLibValue,
    sportsLibClassTypeForHealthMetric,
    sportsLibClassTypeForSleepMetric,
    SportsLibDataValidationError,
} from '@shared/sports-lib-health-data';
import {
    SLEEP_PROVIDERS,
    SLEEP_SPORTS_LIB_METRIC_FIELDS,
    SLEEP_STAGES,
    type SleepSession,
} from '@shared/sleep';
import { SPORTS_LIB_DATA_SCHEMA_VERSION } from '@shared/sports-lib-data';

const HEALTH_METRIC_IDS_IN_ORDER = Object.values(HEALTH_METRIC_IDS) as HealthMetricId[];

function healthMetric(metricId: HealthMetricId): HealthMetricValue {
    const definition = HEALTH_METRIC_CATALOG[metricId];
    const value = definition.valueType === 'category' ? 'rest' : 42;
    return {
        kind: 'value',
        metricId,
        valueType: definition.valueType,
        aggregation: 'average',
        semanticVariant: 'provider_summary',
        origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
        recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
        quality: { status: HEALTH_QUALITY_STATUSES.Valid },
        coverage: { status: HEALTH_COVERAGE_STATUSES.Complete },
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
        native: { metric: metricId, value, unit: definition.canonicalUnit },
        canonical: { value, unit: definition.canonicalUnit },
    };
}

function sleepSession(): SleepSession {
    return {
        id: 'sleep-session',
        userID: 'user',
        source: {
            provider: SLEEP_PROVIDERS.GarminAPI,
            sourceSessionKey: 'provider-session',
            providerUserId: 'provider-user',
        },
        sleepDate: '2026-08-29',
        startTimeMs: 1_777_000_000_000,
        endTimeMs: 1_777_028_800_000,
        durationSeconds: 28_800,
        inBedDurationSeconds: 30_000,
        isNap: false,
        stages: [{
            stage: SLEEP_STAGES.Deep,
            startTimeMs: 1_777_000_000_000,
            endTimeMs: 1_777_003_600_000,
        }],
        stageDurationsSeconds: {
            [SLEEP_STAGES.Deep]: 3_600,
            [SLEEP_STAGES.Light]: 14_400,
            [SLEEP_STAGES.Rem]: 7_200,
            [SLEEP_STAGES.Awake]: 1_800,
            [SLEEP_STAGES.Unmeasurable]: 900,
            [SLEEP_STAGES.Unknown]: 900,
        },
        score: { value: 88, qualifier: 'good', components: { recovery: 90 } },
        vitals: {
            averageHeartRateBpm: 54,
            minimumHeartRateBpm: 45,
            restingHeartRateBpm: 48,
            averageHrvMs: 61,
            overnightHrvMs: 64,
            hrvSampleCount: 120,
            maxSpo2Percent: 99,
            averageRespirationBrpm: 13.2,
        },
        respirationSamples: [{ offsetSeconds: 60, value: 12.9 }],
        spo2Samples: [{ offsetSeconds: 60, value: 98 }],
        hrvSamples: [{ offsetSeconds: 60, value: 60 }],
        providerFields: { garmin: { retainedProviderField: true } },
        createdAtMs: 1_777_030_000_000,
        updatedAtMs: 1_777_030_000_000,
    };
}

describe('Sports Lib Health and sleep storage codec', () => {
    it('uses every canonical Health data class for display values and units', () => {
        for (const metricId of HEALTH_METRIC_IDS_IN_ORDER) {
            const definition = HEALTH_METRIC_CATALOG[metricId];
            const display = formatCanonicalHealthMetricSportsLibValue(
                metricId,
                definition.valueType === 'category' ? 'rest' : 42,
            );

            expect(display?.value).toBeTruthy();
            expect(typeof display?.unit).toBe('string');
        }

        expect(formatCanonicalHealthMetricSportsLibValue(HEALTH_METRIC_IDS.Vo2Max, 52))
            .toEqual({ value: '52.00', unit: 'ml/kg/min' });
        expect(formatCanonicalHealthMetricSportsLibValue(HEALTH_METRIC_IDS.Distance, 1_234))
            .toEqual({ value: '1.23', unit: 'Km' });
        expect(formatCanonicalHealthMetricSportsLibValue(HEALTH_METRIC_IDS.ActiveDuration, 3_600))
            .toEqual({ value: '01h 00m 00s', unit: '' });
    });

    it.each(HEALTH_METRIC_IDS_IN_ORDER)('round-trips Health metric %s through its explicit Sports Lib class', metricId => {
        const legacy = healthMetric(metricId);
        const encoded = encodeHealthMetricSportsLibData(legacy) as HealthMetricValue;
        const metricJson = encoded.sportsLibData?.metrics.value;

        expect(encoded.sportsLibData?.schemaVersion).toBe(SPORTS_LIB_DATA_SCHEMA_VERSION);
        expect(Object.keys(metricJson || {})).toEqual([sportsLibClassTypeForHealthMetric(metricId)]);
        expect(decodeHealthMetricSportsLibData(encoded)).toEqual(legacy);

        const newOnly = {
            ...encoded,
            canonical: undefined,
        };
        expect((decodeHealthMetricSportsLibData(newOnly) as HealthMetricValue).canonical).toEqual(legacy.canonical);
    });

    it('round-trips a Health goal independently from its value', () => {
        const legacy: HealthMetricValue = {
            ...healthMetric(HEALTH_METRIC_IDS.Steps),
            goal: {
                native: { metric: 'goalSteps', value: 10_000, unit: 'count' },
                canonical: { value: 10_000, unit: HEALTH_METRIC_CATALOG.steps.canonicalUnit },
            },
        };
        const encoded = encodeHealthMetricSportsLibData(legacy) as HealthMetricValue;

        expect(encoded.sportsLibData?.metrics.goal).toEqual({ Steps: 10_000 });
        expect(decodeHealthMetricSportsLibData(encoded)).toEqual(legacy);
    });

    it('leaves legacy-only and native-only Health metrics readable', () => {
        const legacy = healthMetric(HEALTH_METRIC_IDS.Steps);
        expect(decodeHealthMetricSportsLibData(legacy)).toBe(legacy);

        const nativeOnly: HealthMetricValue = {
            ...legacy,
            normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
            canonical: null,
        };
        expect(encodeHealthMetricSportsLibData(nativeOnly)).toBe(nativeOnly);
    });

    it.each([
        {
            schemaVersion: SPORTS_LIB_DATA_SCHEMA_VERSION,
            metrics: { value: { steps: 42 } },
        },
        {
            schemaVersion: SPORTS_LIB_DATA_SCHEMA_VERSION,
            metrics: { value: { Steps: 42, Distance: 42 } },
        },
        {
            schemaVersion: SPORTS_LIB_DATA_SCHEMA_VERSION,
            metrics: { value: { Steps: Number.NaN } },
        },
        {
            schemaVersion: SPORTS_LIB_DATA_SCHEMA_VERSION,
            metrics: { value: { Steps: '42' } },
        },
        {
            schemaVersion: SPORTS_LIB_DATA_SCHEMA_VERSION,
            metrics: { unknown: { Steps: 42 } },
        },
        {
            schemaVersion: 2,
            metrics: { value: { Steps: 42 } },
        },
    ])('rejects malformed, ambiguous, unknown, non-finite, and type-mismatched Health JSON %#', sportsLibData => {
        const value = {
            ...healthMetric(HEALTH_METRIC_IDS.Steps),
            sportsLibData,
        } as unknown as HealthMetricValue;
        expect(() => decodeHealthMetricSportsLibData(value)).toThrow(SportsLibDataValidationError);
    });

    it('rejects a conflict between Sports Lib JSON and the rollback-safe legacy scalar', () => {
        const encoded = encodeHealthMetricSportsLibData(healthMetric(HEALTH_METRIC_IDS.Steps)) as HealthMetricValue;
        const conflicting = {
            ...encoded,
            canonical: { ...encoded.canonical!, value: 41 },
        };
        expect(() => decodeHealthMetricSportsLibData(conflicting)).toThrow(/conflicts with its legacy scalar/);
    });

    it('rejects a partial Health envelope that omits an existing canonical goal', () => {
        const legacy: HealthMetricValue = {
            ...healthMetric(HEALTH_METRIC_IDS.Steps),
            goal: { canonical: { value: 10_000, unit: HEALTH_METRIC_CATALOG.steps.canonicalUnit } },
        };
        const encoded = encodeHealthMetricSportsLibData(legacy) as HealthMetricValue;
        delete encoded.sportsLibData?.metrics.goal;

        expect(() => decodeHealthMetricSportsLibData(encoded)).toThrow(/missing its canonical goal/);
    });

    it('round-trips every normalized sleep aggregate without flattening session data', () => {
        const legacy = sleepSession();
        const encoded = encodeSleepSessionSportsLibData(legacy);
        const storedMetricFields = Object.keys(encoded.sportsLibData?.metrics || {}).sort();

        expect(storedMetricFields).toEqual(Object.values(SLEEP_SPORTS_LIB_METRIC_FIELDS).sort());
        for (const field of Object.values(SLEEP_SPORTS_LIB_METRIC_FIELDS)) {
            expect(Object.keys(encoded.sportsLibData?.metrics[field] || {})).toEqual([
                sportsLibClassTypeForSleepMetric(field),
            ]);
        }
        expect(JSON.stringify(encoded.sportsLibData)).not.toContain('provider-session');
        expect(JSON.stringify(encoded.sportsLibData)).not.toContain('retainedProviderField');
        expect(JSON.stringify(encoded.sportsLibData)).not.toContain('startTimeMs');
        expect(decodeSleepSessionSportsLibData(encoded)).toEqual(legacy);
        expect(encoded.stages).toEqual(legacy.stages);
        expect(encoded.hrvSamples).toEqual(legacy.hrvSamples);
        expect(encoded.providerFields).toEqual(legacy.providerFields);
    });

    it('rehydrates new-only sleep aggregates and leaves legacy sessions readable', () => {
        const legacy = sleepSession();
        expect(decodeSleepSessionSportsLibData(legacy)).toBe(legacy);

        const encoded = encodeSleepSessionSportsLibData(legacy);
        const newOnly = {
            ...encoded,
            durationSeconds: undefined,
            inBedDurationSeconds: undefined,
            stageDurationsSeconds: {},
            score: { qualifier: 'good' },
            vitals: null,
        } as unknown as SleepSession;
        const decoded = decodeSleepSessionSportsLibData(newOnly);
        expect(decoded.durationSeconds).toBe(legacy.durationSeconds);
        expect(decoded.inBedDurationSeconds).toBe(legacy.inBedDurationSeconds);
        expect(decoded.stageDurationsSeconds).toEqual(legacy.stageDurationsSeconds);
        expect(decoded.score).toEqual({ qualifier: 'good', value: 88 });
        expect(decoded.vitals).toEqual(legacy.vitals);
        expect(decoded).not.toHaveProperty('sportsLibData');
    });

    it('preserves absent optional sleep aggregates after a storage round trip', () => {
        const legacy: SleepSession = {
            ...sleepSession(),
            inBedDurationSeconds: undefined,
            stageDurationsSeconds: {},
            score: undefined,
            vitals: undefined,
        };

        expect(decodeSleepSessionSportsLibData(encodeSleepSessionSportsLibData(legacy))).toEqual(legacy);
    });

    it('rejects malformed or conflicting sleep aggregate JSON', () => {
        const encoded = encodeSleepSessionSportsLibData(sleepSession());
        const malformed = {
            ...encoded,
            sportsLibData: {
                schemaVersion: SPORTS_LIB_DATA_SCHEMA_VERSION,
                metrics: {
                    ...encoded.sportsLibData.metrics,
                    duration: { 'Sleep Duration': Number.POSITIVE_INFINITY },
                },
            },
        };
        expect(() => decodeSleepSessionSportsLibData(malformed)).toThrow(SportsLibDataValidationError);

        const conflicting = { ...encoded, durationSeconds: encoded.durationSeconds - 1 };
        expect(() => decodeSleepSessionSportsLibData(conflicting)).toThrow(/conflicts with its legacy scalar/);

        const partial = encodeSleepSessionSportsLibData(sleepSession());
        delete partial.sportsLibData?.metrics.averageHrv;
        expect(() => decodeSleepSessionSportsLibData(partial)).toThrow(/averageHrv is missing/);
    });
});
