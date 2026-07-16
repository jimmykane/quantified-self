import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DERIVED_METRIC_KINDS, DERIVED_METRIC_SCHEMA_VERSION } from '../../../shared/derived-metrics';

const taskDispatchRegistration = vi.hoisted(() => ({
    options: [] as unknown[],
}));

vi.mock('firebase-functions/v2/tasks', () => ({
    onTaskDispatched: vi.fn((_opts: unknown, handler: any) => {
        taskDispatchRegistration.options.push(_opts);
        return handler;
    }),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('../shared/queue-config', () => ({
    CLOUD_TASK_RETRY_CONFIG: {},
}));

vi.mock('../../../shared/functions-manifest', () => ({
    FUNCTIONS_MANIFEST: {
        ensureDerivedMetrics: {
            region: 'europe-west2',
        },
    },
}));

const hoisted = vi.hoisted(() => ({
    abandonDerivedMetricsProcessingAfterWriteBlock: vi.fn(),
    fetchDerivedFormSnapshotSeed: vi.fn(),
    completeDerivedMetricsProcessing: vi.fn(),
    failDerivedMetricsProcessing: vi.fn(),
    fetchDerivedMetricsActivityDocs: vi.fn(),
    fetchDerivedMetricsEventDocs: vi.fn(),
    fetchRecoveryLookbackEventDocs: vi.fn(),
    fetchTrainingBuildBenchmarkSettings: vi.fn(),
    fetchTrainingBuildSleepDocs: vi.fn(),
    getDerivedRecoveryLookbackWindowSeconds: vi.fn(() => 0),
    isDerivedMetricsUserWriteBlocked: vi.fn(),
    joinTrainingActivitySources: vi.fn(),
    markDerivedMetricSnapshotsBuilding: vi.fn(),
    markDerivedMetricSnapshotsFailed: vi.fn(),
    startDerivedMetricsProcessing: vi.fn(),
    writeDerivedMetricSnapshotsReady: vi.fn(),
}));

vi.mock('../derived-metrics/derived-metrics.service', async () => {
    const actual = await vi.importActual<typeof import('../derived-metrics/derived-metrics.service')>(
        '../derived-metrics/derived-metrics.service',
    );
    return {
        ...actual,
        abandonDerivedMetricsProcessingAfterWriteBlock: hoisted.abandonDerivedMetricsProcessingAfterWriteBlock,
        fetchDerivedFormSnapshotSeed: hoisted.fetchDerivedFormSnapshotSeed,
        completeDerivedMetricsProcessing: hoisted.completeDerivedMetricsProcessing,
        failDerivedMetricsProcessing: hoisted.failDerivedMetricsProcessing,
        fetchDerivedMetricsActivityDocs: hoisted.fetchDerivedMetricsActivityDocs,
        fetchDerivedMetricsEventDocs: hoisted.fetchDerivedMetricsEventDocs,
        fetchRecoveryLookbackEventDocs: hoisted.fetchRecoveryLookbackEventDocs,
        fetchTrainingBuildBenchmarkSettings: hoisted.fetchTrainingBuildBenchmarkSettings,
        fetchTrainingBuildSleepDocs: hoisted.fetchTrainingBuildSleepDocs,
        getDerivedRecoveryLookbackWindowSeconds: hoisted.getDerivedRecoveryLookbackWindowSeconds,
        isDerivedMetricsUserWriteBlocked: hoisted.isDerivedMetricsUserWriteBlocked,
        joinTrainingActivitySources: hoisted.joinTrainingActivitySources,
        markDerivedMetricSnapshotsBuilding: hoisted.markDerivedMetricSnapshotsBuilding,
        markDerivedMetricSnapshotsFailed: hoisted.markDerivedMetricSnapshotsFailed,
        startDerivedMetricsProcessing: hoisted.startDerivedMetricsProcessing,
        writeDerivedMetricSnapshotsReady: hoisted.writeDerivedMetricSnapshotsReady,
    };
});

import { processDerivedMetricsTask } from './derived-metrics-worker';

describe('processDerivedMetricsTask', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.fetchDerivedFormSnapshotSeed.mockResolvedValue(null);
        hoisted.abandonDerivedMetricsProcessingAfterWriteBlock.mockResolvedValue({
            cleaned: true,
            requeued: false,
            nextGeneration: null,
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
        });
        hoisted.startDerivedMetricsProcessing.mockResolvedValue({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            startedAtMs: Date.now(),
            eventMutationVersion: 11,
        });
        hoisted.isDerivedMetricsUserWriteBlocked.mockResolvedValue(false);
        hoisted.markDerivedMetricSnapshotsBuilding.mockResolvedValue(undefined);
        hoisted.fetchDerivedMetricsEventDocs.mockResolvedValue([{ id: 'form-doc' }] as any);
        hoisted.fetchDerivedMetricsActivityDocs.mockResolvedValue([{ id: 'activity-doc' }] as any);
        hoisted.fetchRecoveryLookbackEventDocs.mockResolvedValue([{ id: 'recovery-doc' }] as any);
        hoisted.fetchTrainingBuildBenchmarkSettings.mockResolvedValue({ trainingSettings: {} });
        hoisted.fetchTrainingBuildSleepDocs.mockResolvedValue([{ id: 'sleep-doc' }] as any);
        hoisted.joinTrainingActivitySources.mockReturnValue([{ activityId: 'joined-activity' }]);
        hoisted.writeDerivedMetricSnapshotsReady.mockResolvedValue(undefined);
        hoisted.completeDerivedMetricsProcessing.mockResolvedValue({
            requeued: false,
            nextGeneration: null,
        });
    });

    it('isolates full-history Training builds while retaining memory headroom', () => {
        expect(taskDispatchRegistration.options).toContainEqual(expect.objectContaining({
            concurrency: 1,
            memory: '2GiB',
            timeoutSeconds: 540,
        }));
    });

    it('queries recovery docs from lookback even when form docs are also requested', async () => {
        await (processDerivedMetricsTask as any)({
            data: {
                uid: 'user-1',
                generation: 12,
            },
        });

        expect(hoisted.fetchDerivedMetricsEventDocs).toHaveBeenCalledWith('user-1');
        expect(hoisted.fetchRecoveryLookbackEventDocs).toHaveBeenCalledWith('user-1');
        expect(hoisted.writeDerivedMetricSnapshotsReady).toHaveBeenCalledWith('user-1', [
            DERIVED_METRIC_KINDS.Form,
            DERIVED_METRIC_KINDS.RecoveryNow,
        ], {
            formDocs: [{ id: 'form-doc' }],
            recoveryNowDocs: [{ id: 'recovery-doc' }],
            trainingActivityDocs: [],
        }, {
            buildAtMs: expect.any(Number),
            builtFromEventMutationVersion: 11,
            formDailyLoads: [],
            formSourceEventCount: null,
            formSourceDocCount: null,
        });
    });

    it('queries full event docs for non-form tss-derived kinds', async () => {
        hoisted.startDerivedMetricsProcessing.mockResolvedValueOnce({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Acwr],
            startedAtMs: Date.now(),
            eventMutationVersion: 12,
        });
        hoisted.fetchDerivedMetricsEventDocs.mockResolvedValueOnce([{ id: 'tss-doc' }] as any);
        hoisted.fetchRecoveryLookbackEventDocs.mockResolvedValueOnce([] as any);

        await (processDerivedMetricsTask as any)({
            data: {
                uid: 'user-2',
                generation: 13,
            },
        });

        expect(hoisted.fetchDerivedMetricsEventDocs).toHaveBeenCalledWith('user-2');
        expect(hoisted.fetchRecoveryLookbackEventDocs).not.toHaveBeenCalled();
        expect(hoisted.writeDerivedMetricSnapshotsReady).toHaveBeenCalledWith('user-2', [
            DERIVED_METRIC_KINDS.Acwr,
        ], {
            formDocs: [{ id: 'tss-doc' }],
            recoveryNowDocs: [],
            trainingActivityDocs: [],
        }, {
            buildAtMs: expect.any(Number),
            builtFromEventMutationVersion: 12,
            formDailyLoads: [],
            formSourceEventCount: null,
            formSourceDocCount: null,
        });
    });

    it('uses projection form snapshot seed for projection-only kinds without full event scan', async () => {
        hoisted.startDerivedMetricsProcessing.mockResolvedValueOnce({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Acwr, DERIVED_METRIC_KINDS.FormNow],
            startedAtMs: Date.now(),
            eventMutationVersion: 12,
        });
        hoisted.fetchDerivedFormSnapshotSeed.mockResolvedValueOnce({
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            builtFromEventMutationVersion: 12,
            sourceEventCount: 5,
            sourceDocCount: 7,
            dailyLoads: [
                { dayMs: Date.UTC(2026, 0, 1), load: 10 },
                { dayMs: Date.UTC(2026, 0, 2), load: 20 },
            ],
        });

        await (processDerivedMetricsTask as any)({
            data: {
                uid: 'user-seed',
                generation: 90,
            },
        });

        expect(hoisted.fetchDerivedMetricsEventDocs).not.toHaveBeenCalled();
        expect(hoisted.writeDerivedMetricSnapshotsReady).toHaveBeenCalledWith('user-seed', [
            DERIVED_METRIC_KINDS.Acwr,
            DERIVED_METRIC_KINDS.FormNow,
        ], {
            formDocs: [],
            recoveryNowDocs: [],
            trainingActivityDocs: [],
        }, {
            buildAtMs: expect.any(Number),
            builtFromEventMutationVersion: 12,
            formDailyLoads: [
                { dayMs: Date.UTC(2026, 0, 1), load: 10 },
                { dayMs: Date.UTC(2026, 0, 2), load: 20 },
            ],
            formSourceEventCount: 5,
            formSourceDocCount: 7,
        });
    });

    it('reads parent events and activities for activity-backed metrics instead of using a Form projection seed', async () => {
        hoisted.startDerivedMetricsProcessing.mockResolvedValueOnce({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.TrainingSummary],
            startedAtMs: Date.now(),
            eventMutationVersion: 12,
        });
        hoisted.fetchDerivedFormSnapshotSeed.mockResolvedValueOnce({
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            builtFromEventMutationVersion: 12,
            sourceEventCount: 5,
            sourceDocCount: 7,
            dailyLoads: [{ dayMs: Date.UTC(2026, 0, 1), load: 10 }],
        });
        hoisted.fetchDerivedMetricsEventDocs.mockResolvedValueOnce([{ id: 'power-doc' }] as any);

        await (processDerivedMetricsTask as any)({
            data: { uid: 'user-power', generation: 91 },
        });

        expect(hoisted.fetchDerivedFormSnapshotSeed).not.toHaveBeenCalled();
        expect(hoisted.fetchDerivedMetricsEventDocs).toHaveBeenCalledWith('user-power');
        expect(hoisted.fetchDerivedMetricsActivityDocs).toHaveBeenCalledWith('user-power', {
            includeSwimLengths: false,
        });
    });

    it('includes swim lengths only when swimming performance is requested', async () => {
        hoisted.startDerivedMetricsProcessing.mockResolvedValueOnce({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.TrainingSwimPerformance],
            startedAtMs: Date.now(),
            eventMutationVersion: 12,
        });

        await (processDerivedMetricsTask as any)({
            data: { uid: 'user-swim', generation: 92 },
        });

        expect(hoisted.fetchDerivedMetricsActivityDocs).toHaveBeenCalledWith('user-swim', {
            includeSwimLengths: true,
        });
        expect(hoisted.fetchTrainingBuildBenchmarkSettings).not.toHaveBeenCalled();
    });

    it('fetches benchmark settings only for the training build comparison and passes them to its builder', async () => {
        hoisted.startDerivedMetricsProcessing.mockResolvedValueOnce({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
            startedAtMs: Date.now(),
            eventMutationVersion: 13,
        });
        hoisted.fetchDerivedMetricsEventDocs.mockResolvedValueOnce([{ id: 'training-doc' }] as any);
        const settings = { trainingSettings: { buildBenchmarks: { running: { mode: 'period', durationWeeks: 12 } } } };
        hoisted.fetchTrainingBuildBenchmarkSettings.mockResolvedValueOnce(settings);

        await (processDerivedMetricsTask as any)({
            data: { uid: 'user-training-build', generation: 92 },
        });

        expect(hoisted.fetchDerivedFormSnapshotSeed).not.toHaveBeenCalled();
        expect(hoisted.fetchDerivedMetricsEventDocs).toHaveBeenCalledWith('user-training-build');
        expect(hoisted.fetchTrainingBuildBenchmarkSettings).toHaveBeenCalledWith('user-training-build');
        expect(hoisted.joinTrainingActivitySources).toHaveBeenCalledOnce();
        expect(hoisted.joinTrainingActivitySources).toHaveBeenCalledWith(
            [{ id: 'activity-doc' }],
            [{ id: 'training-doc' }],
            { includeUnclassified: false },
        );
        expect(hoisted.fetchTrainingBuildSleepDocs).toHaveBeenCalledWith(
            'user-training-build',
            [{ activityId: 'joined-activity' }],
            settings,
            expect.any(Number),
        );
        expect(hoisted.writeDerivedMetricSnapshotsReady).toHaveBeenCalledWith('user-training-build', [
            DERIVED_METRIC_KINDS.TrainingBuildComparison,
        ], {
            formDocs: [{ id: 'training-doc' }],
            recoveryNowDocs: [],
            trainingActivityDocs: [{ id: 'activity-doc' }],
            trainingActivities: [{ activityId: 'joined-activity' }],
            trainingBuildBenchmarkSettings: settings,
            trainingBuildSleepDocs: [{ id: 'sleep-doc' }],
        }, expect.objectContaining({ builtFromEventMutationVersion: 13 }));
        expect(hoisted.fetchTrainingBuildSleepDocs.mock.calls[0][1]).toBe(
            hoisted.writeDerivedMetricSnapshotsReady.mock.calls[0][2].trainingActivities,
        );
    });

    it('retains unclassified activities only when Training Explanation needs them', async () => {
        hoisted.startDerivedMetricsProcessing.mockResolvedValueOnce({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.TrainingExplanation],
            startedAtMs: Date.now(),
            eventMutationVersion: 13,
        });
        hoisted.fetchDerivedMetricsEventDocs.mockResolvedValueOnce([{ id: 'training-doc' }]);

        await (processDerivedMetricsTask as unknown as (
            request: { data: { uid: string; generation: number } },
        ) => Promise<void>)({
            data: { uid: 'user-training-explanation', generation: 93 },
        });

        expect(hoisted.joinTrainingActivitySources).toHaveBeenCalledOnce();
        expect(hoisted.joinTrainingActivitySources).toHaveBeenCalledWith(
            [{ id: 'activity-doc' }],
            [{ id: 'training-doc' }],
            { includeUnclassified: true },
        );
    });

    it('exits before snapshot writes when user deletion becomes active after claiming work', async () => {
        hoisted.isDerivedMetricsUserWriteBlocked.mockResolvedValueOnce(true);

        await (processDerivedMetricsTask as any)({
            data: {
                uid: 'deleted-user',
                generation: 12,
            },
        });

        expect(hoisted.startDerivedMetricsProcessing).toHaveBeenCalledWith('deleted-user', 12);
        expect(hoisted.markDerivedMetricSnapshotsBuilding).not.toHaveBeenCalled();
        expect(hoisted.writeDerivedMetricSnapshotsReady).not.toHaveBeenCalled();
        expect(hoisted.completeDerivedMetricsProcessing).not.toHaveBeenCalled();
        expect(hoisted.abandonDerivedMetricsProcessingAfterWriteBlock).toHaveBeenCalledWith(
            'deleted-user',
            12,
            [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            'task before snapshot building',
        );
    });

    it('finalizes claimed work when deletion becomes active before ready snapshot writes', async () => {
        hoisted.isDerivedMetricsUserWriteBlocked
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        await (processDerivedMetricsTask as any)({
            data: {
                uid: 'deleted-before-ready',
                generation: 16,
            },
        });

        expect(hoisted.markDerivedMetricSnapshotsBuilding).toHaveBeenCalled();
        expect(hoisted.writeDerivedMetricSnapshotsReady).not.toHaveBeenCalled();
        expect(hoisted.completeDerivedMetricsProcessing).not.toHaveBeenCalled();
        expect(hoisted.abandonDerivedMetricsProcessingAfterWriteBlock).toHaveBeenCalledWith(
            'deleted-before-ready',
            16,
            [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            'task before snapshot ready write',
        );
    });

    it('finalizes claimed work when deletion becomes active before coordinator completion', async () => {
        hoisted.isDerivedMetricsUserWriteBlocked
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        await (processDerivedMetricsTask as any)({
            data: {
                uid: 'deleted-before-complete',
                generation: 17,
            },
        });

        expect(hoisted.writeDerivedMetricSnapshotsReady).toHaveBeenCalled();
        expect(hoisted.completeDerivedMetricsProcessing).not.toHaveBeenCalled();
        expect(hoisted.abandonDerivedMetricsProcessingAfterWriteBlock).toHaveBeenCalledWith(
            'deleted-before-complete',
            17,
            [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            'task before processing completion',
        );
    });

    it('queries full event docs for new KPI derived kinds', async () => {
        hoisted.startDerivedMetricsProcessing.mockResolvedValueOnce({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.EasyPercent],
            startedAtMs: Date.now(),
            eventMutationVersion: 13,
        });
        hoisted.fetchDerivedMetricsEventDocs.mockResolvedValueOnce([{ id: 'kpi-doc' }] as any);

        await (processDerivedMetricsTask as any)({
            data: {
                uid: 'user-3',
                generation: 14,
            },
        });

        expect(hoisted.fetchDerivedMetricsEventDocs).toHaveBeenCalledWith('user-3');
        expect(hoisted.writeDerivedMetricSnapshotsReady).toHaveBeenCalledWith('user-3', [
            DERIVED_METRIC_KINDS.FormNow,
            DERIVED_METRIC_KINDS.EasyPercent,
        ], {
            formDocs: [{ id: 'kpi-doc' }],
            recoveryNowDocs: [],
            trainingActivityDocs: [],
        }, {
            buildAtMs: expect.any(Number),
            builtFromEventMutationVersion: 13,
            formDailyLoads: [],
            formSourceEventCount: null,
            formSourceDocCount: null,
        });
    });

    it('rethrows processing errors so Cloud Tasks retry policy can apply', async () => {
        const transientError = new Error('transient_processing_failure');
        hoisted.writeDerivedMetricSnapshotsReady.mockRejectedValueOnce(transientError);

        await expect((processDerivedMetricsTask as any)({
            data: {
                uid: 'user-4',
                generation: 15,
            },
        })).rejects.toThrow('transient_processing_failure');

        expect(hoisted.markDerivedMetricSnapshotsFailed).toHaveBeenCalledWith(
            'user-4',
            [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            transientError,
        );
        expect(hoisted.failDerivedMetricsProcessing).toHaveBeenCalledWith(
            'user-4',
            15,
            transientError,
            [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
        );
    });

    it('finalizes claimed work without failed snapshot writes when deletion becomes active after processing error', async () => {
        const transientError = new Error('transient_processing_failure');
        hoisted.writeDerivedMetricSnapshotsReady.mockRejectedValueOnce(transientError);
        hoisted.isDerivedMetricsUserWriteBlocked
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        await expect((processDerivedMetricsTask as any)({
            data: {
                uid: 'deleted-during-error',
                generation: 15,
            },
        })).rejects.toThrow('transient_processing_failure');

        expect(hoisted.markDerivedMetricSnapshotsFailed).not.toHaveBeenCalled();
        expect(hoisted.failDerivedMetricsProcessing).not.toHaveBeenCalled();
        expect(hoisted.abandonDerivedMetricsProcessingAfterWriteBlock).toHaveBeenCalledWith(
            'deleted-during-error',
            15,
            [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            'task before failure writes',
        );
    });
});
