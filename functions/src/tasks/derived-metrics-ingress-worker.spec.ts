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
    getDefaultDerivedMetricKindsForDashboard: vi.fn(),
    markDerivedMetricsDirtyAndMaybeQueue: vi.fn(),
}));

vi.mock('../derived-metrics/derived-metrics.service', async () => {
    const actual = await vi.importActual<typeof import('../derived-metrics/derived-metrics.service')>(
        '../derived-metrics/derived-metrics.service',
    );
    return {
        ...actual,
        getDefaultDerivedMetricKindsForDashboard: hoisted.getDefaultDerivedMetricKindsForDashboard,
        markDerivedMetricsDirtyAndMaybeQueue: hoisted.markDerivedMetricsDirtyAndMaybeQueue,
    };
});

import { processDerivedMetricsIngressTask } from './derived-metrics-ingress-worker';

describe('processDerivedMetricsIngressTask', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.getDefaultDerivedMetricKindsForDashboard.mockReturnValue([
            DERIVED_METRIC_KINDS.Form,
            DERIVED_METRIC_KINDS.RecoveryNow,
        ]);
        hoisted.markDerivedMetricsDirtyAndMaybeQueue.mockResolvedValue({
            accepted: true,
            queued: true,
            generation: 12,
            metricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
        });
    });

    it('marks derived metrics dirty with event mutation increment', async () => {
        await (processDerivedMetricsIngressTask as any)({
            data: {
                uid: 'user-1',
                bucketStartEpochSec: 1712000010,
            },
        });

        expect(hoisted.markDerivedMetricsDirtyAndMaybeQueue).toHaveBeenCalledWith(
            'user-1',
            [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
            { incrementEventMutationVersion: true },
        );
    });

    it('marks only the requested metric dirty for sleep ingress without changing event mutation version', async () => {
        await (processDerivedMetricsIngressTask as any)({
            data: {
                uid: 'user-1',
                bucketStartEpochSec: 1712000010,
                metricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
                incrementEventMutationVersion: false,
            },
        });

        expect(hoisted.getDefaultDerivedMetricKindsForDashboard).not.toHaveBeenCalled();
        expect(hoisted.markDerivedMetricsDirtyAndMaybeQueue).toHaveBeenCalledWith(
            'user-1',
            [DERIVED_METRIC_KINDS.TrainingBuildComparison],
            { incrementEventMutationVersion: false },
        );
    });

    it('rejects malformed targeted metric kinds instead of rebuilding every metric', async () => {
        await (processDerivedMetricsIngressTask as any)({
            data: {
                uid: 'user-1',
                metricKinds: ['not-a-metric'],
            },
        });

        expect(hoisted.getDefaultDerivedMetricKindsForDashboard).not.toHaveBeenCalled();
        expect(hoisted.markDerivedMetricsDirtyAndMaybeQueue).not.toHaveBeenCalled();
    });

    it('skips payloads missing uid', async () => {
        await (processDerivedMetricsIngressTask as any)({
            data: {
                uid: '',
                bucketStartEpochSec: 1712000010,
            },
        });

        expect(hoisted.markDerivedMetricsDirtyAndMaybeQueue).not.toHaveBeenCalled();
    });

    it('rethrows errors so Cloud Tasks retries can apply', async () => {
        const transientError = new Error('transient_ingress_failure');
        hoisted.markDerivedMetricsDirtyAndMaybeQueue.mockRejectedValueOnce(transientError);

        await expect((processDerivedMetricsIngressTask as any)({
            data: {
                uid: 'user-2',
                bucketStartEpochSec: 1712000010,
            },
        })).rejects.toThrow('transient_ingress_failure');
    });
});
