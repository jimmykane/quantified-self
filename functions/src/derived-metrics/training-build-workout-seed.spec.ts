import { describe, expect, it } from 'vitest';
import { DERIVED_METRIC_KINDS, DERIVED_METRIC_SCHEMA_VERSION, type DerivedTrainingBuildComparisonMetricPayload } from '../../../shared/derived-metrics';
import { TRAINING_DISCIPLINES } from '../../../shared/training-disciplines';
import { createTrainingBuildWorkoutSeedMetadata, resolveTrainingBuildWorkoutSeed, trainingBuildSettingsKey } from './training-build-workout-seed';

const nowMs = Date.parse('2026-09-14T10:00:00Z');
const context = { nowMs, sourceVersion: 3, eventMutationVersion: 7, settingsKey: trainingBuildSettingsKey({}) };
function fixture(futureStart?: number) {
    const payload = { dayBoundary: 'UTC', asOfDayMs: Date.parse('2026-09-14'), excludesMergedEvents: true,
        recoveryVersion: 4, recovery: {}, disciplines: TRAINING_DISCIPLINES.map(discipline => ({
            discipline, status: 'not-configured', selection: null, current: null, benchmark: null, recovery: null,
            durabilityComparisons: [], suggestedEvents: [], suggestedRaces: [],
        })) } as DerivedTrainingBuildComparisonMetricPayload;
    return { entryType: 'snapshot', metricKind: DERIVED_METRIC_KINDS.TrainingBuildComparison,
        status: 'ready', schemaVersion: DERIVED_METRIC_SCHEMA_VERSION, builtFromEventMutationVersion: 7,
        sourceEventCount: 200, payload,
        workoutInputsReuse: createTrainingBuildWorkoutSeedMetadata(payload, context, futureStart ? [futureStart] : [], 100, 200),
    };
}
describe('workout snapshot reuse', () => {
    it('reuses the completed projection and retains source counts', () => {
        expect(resolveTrainingBuildWorkoutSeed(fixture(), context)).toMatchObject({ sourceEventCount: 200,
            metadata: { formSourceDocCount: 100, activitySourceDocCount: 200 } });
    });
    it.each(['building', 'failed', 'stale'])('rejects %s snapshots', status => {
        expect(resolveTrainingBuildWorkoutSeed({ ...fixture(), status }, context)).toBeNull();
    });
    it('rejects old schemas, missing metadata and corrupted workout payloads', () => {
        expect(resolveTrainingBuildWorkoutSeed({ ...fixture(), schemaVersion: DERIVED_METRIC_SCHEMA_VERSION - 1 }, context)).toBeNull();
        expect(resolveTrainingBuildWorkoutSeed({ ...fixture(), workoutInputsReuse: null }, context)).toBeNull();
        const snapshot = fixture(); snapshot.payload.disciplines[0].suggestedEvents = [{ eventId: 'corrupt' }] as any;
        expect(resolveTrainingBuildWorkoutSeed(snapshot, context)).toBeNull();
    });
    it('expires on source invalidation, benchmark changes, midnight and clock rollback', () => {
        for (const patch of [{ sourceVersion: 4 }, { eventMutationVersion: 8 }, { settingsKey: 'changed' },
            { nowMs: Date.parse('2026-09-15') }, { nowMs: nowMs - 1 }]) {
            expect(resolveTrainingBuildWorkoutSeed(fixture(), { ...context, ...patch })).toBeNull();
        }
    });
    it('expires exactly when a stored future workout becomes eligible', () => {
        const snapshot = fixture(nowMs + 1000);
        expect(resolveTrainingBuildWorkoutSeed(snapshot, { ...context, nowMs: nowMs + 999 })).not.toBeNull();
        expect(resolveTrainingBuildWorkoutSeed(snapshot, { ...context, nowMs: nowMs + 1000 })).toBeNull();
    });
    it('does not extend the reuse lifetime after repeated sleep refreshes', () => {
        const snapshot = fixture(nowMs + 1000);
        const seed = resolveTrainingBuildWorkoutSeed(snapshot, { ...context, nowMs: nowMs + 500 });
        expect(seed?.metadata.validUntilMs).toBe(nowMs + 1000);
    });
    it('allows recovery recomputation without trusting or caching old recovery fields', () => {
        const snapshot = fixture(); snapshot.payload.recoveryVersion = -1;
        expect(resolveTrainingBuildWorkoutSeed(snapshot, context)).not.toBeNull();
    });
    it('compares normalized settings independently of Firestore map order', () => {
        expect(trainingBuildSettingsKey({ a: 1, b: 2 })).toBe(trainingBuildSettingsKey({ b: 2, a: 1 }));
    });
});
