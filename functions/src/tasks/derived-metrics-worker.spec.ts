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
        hoisted.startDerivedMetricsProcessing.mockResolvedValue({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            startedAtMs: Date.now(),
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
        });
    });

    it('queries full event docs for non-form tss-derived kinds', async () => {
        hoisted.startDerivedMetricsProcessing.mockResolvedValueOnce({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.Acwr],
            startedAtMs: Date.now(),
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
        });
    });

    it('queries full event docs for new KPI derived kinds', async () => {
        hoisted.startDerivedMetricsProcessing.mockResolvedValueOnce({
            dirtyMetricKinds: [DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.EasyPercent],
            startedAtMs: Date.now(),
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
        });
    });
});
