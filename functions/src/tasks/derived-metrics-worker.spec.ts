import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';

vi.mock('firebase-functions/v2/tasks', () => ({
    onTaskDispatched: (_opts: unknown, handler: any) => handler,
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
    fetchDerivedFormSnapshotSeed: vi.fn(),
    completeDerivedMetricsProcessing: vi.fn(),
    failDerivedMetricsProcessing: vi.fn(),
    fetchDerivedMetricsEventDocs: vi.fn(),
    fetchRecoveryLookbackEventDocs: vi.fn(),
    getDerivedRecoveryLookbackWindowSeconds: vi.fn(() => 0),
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
        fetchDerivedFormSnapshotSeed: hoisted.fetchDerivedFormSnapshotSeed,
        completeDerivedMetricsProcessing: hoisted.completeDerivedMetricsProcessing,
        failDerivedMetricsProcessing: hoisted.failDerivedMetricsProcessing,
        fetchDerivedMetricsEventDocs: hoisted.fetchDerivedMetricsEventDocs,
        fetchRecoveryLookbackEventDocs: hoisted.fetchRecoveryLookbackEventDocs,
        getDerivedRecoveryLookbackWindowSeconds: hoisted.getDerivedRecoveryLookbackWindowSeconds,
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
        hoisted.startDerivedMetricsProcessing.mockResolvedValue({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            startedAtMs: Date.now(),
            eventMutationVersion: 11,
        });
        hoisted.markDerivedMetricSnapshotsBuilding.mockResolvedValue(undefined);
        hoisted.fetchDerivedMetricsEventDocs.mockResolvedValue([{ id: 'form-doc' }] as any);
        hoisted.fetchRecoveryLookbackEventDocs.mockResolvedValue([{ id: 'recovery-doc' }] as any);
        hoisted.writeDerivedMetricSnapshotsReady.mockResolvedValue(undefined);
        hoisted.completeDerivedMetricsProcessing.mockResolvedValue({
            requeued: false,
            nextGeneration: null,
        });
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
        }, {
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
        }, {
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
            schemaVersion: 7,
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
        }, {
            builtFromEventMutationVersion: 12,
            formDailyLoads: [
                { dayMs: Date.UTC(2026, 0, 1), load: 10 },
                { dayMs: Date.UTC(2026, 0, 2), load: 20 },
            ],
            formSourceEventCount: 5,
            formSourceDocCount: 7,
        });
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
        }, {
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
});
