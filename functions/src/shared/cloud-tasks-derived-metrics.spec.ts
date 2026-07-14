import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueDerivedMetricsIngressTask, enqueueDerivedMetricsTask } from './cloud-tasks';
import { DERIVED_METRIC_KINDS } from '../../../shared/derived-metrics';

const hoisted = vi.hoisted(() => {
    const mockTaskQueue = { enqueue: vi.fn() };
    return {
        mockTaskQueue,
        mockFunctions: { taskQueue: vi.fn(() => mockTaskQueue) },
    };
});

vi.mock('firebase-admin/functions', () => ({ getFunctions: () => hoisted.mockFunctions }));
vi.mock('../config', () => ({
    config: {
        cloudtasks: {
            projectId: 'test-project',
            location: 'test-location',
            derivedMetricsQueue: 'processDerivedMetricsTask',
            derivedMetricsIngressBucketSeconds: 30,
        },
    },
}));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

describe('derived metrics task dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.mockTaskQueue.enqueue.mockResolvedValue(undefined);
    });

    it('uses the derived metrics worker queue with the direct worker payload', async () => {
        await expect(enqueueDerivedMetricsTask('user/with spaces', 7.8)).resolves.toBe(true);

        expect(hoisted.mockFunctions.taskQueue).toHaveBeenCalledWith(
            'projects/test-project/locations/test-location/functions/processDerivedMetricsTask',
        );
        expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledWith(
            { uid: 'user/with spaces', generation: 7 },
            { id: 'derived-metrics-user-with-spaces-7', scheduleDelaySeconds: 1 },
        );
    });

    it('maps Firebase duplicate errors to a skipped deterministic enqueue', async () => {
        hoisted.mockTaskQueue.enqueue.mockRejectedValue(Object.assign(new Error('Already exists'), {
            code: 'functions/task-already-exists',
        }));

        await expect(enqueueDerivedMetricsTask('user-1', 1)).resolves.toBe(false);
    });

    it('uses the ingress worker queue and an absolute delivery time for each debounce bucket', async () => {
        await expect(enqueueDerivedMetricsIngressTask('user/with spaces', undefined, 1_712_000_015_000)).resolves.toBe(true);

        expect(hoisted.mockFunctions.taskQueue).toHaveBeenCalledWith(
            'projects/test-project/locations/test-location/functions/processDerivedMetricsIngressTask',
        );
        expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledWith(
            { uid: 'user/with spaces', bucketStartEpochSec: 1_712_000_010 },
            { id: 'derived-metrics-ingress-user-with-spaces-1712000010', scheduleTime: new Date(1_712_000_042_000) },
        );
    });

    it('keeps different debounce buckets separate', async () => {
        await enqueueDerivedMetricsIngressTask('user-1', undefined, 1_712_000_015_000);
        await enqueueDerivedMetricsIngressTask('user-1', undefined, 1_712_000_055_000);

        expect(hoisted.mockTaskQueue.enqueue.mock.calls[0][1]).toMatchObject({
            id: 'derived-metrics-ingress-user-1-1712000010',
        });
        expect(hoisted.mockTaskQueue.enqueue.mock.calls[1][1]).toMatchObject({
            id: 'derived-metrics-ingress-user-1-1712000040',
        });
    });

    it('keeps targeted sleep ingress separate from event ingress in the same bucket', async () => {
        await enqueueDerivedMetricsIngressTask('user-1', undefined, 1_712_000_015_000, {
            taskScope: 'sleep',
            metricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
            incrementEventMutationVersion: false,
        });

        expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledWith(
            {
                uid: 'user-1',
                bucketStartEpochSec: 1_712_000_010,
                metricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
                incrementEventMutationVersion: false,
            },
            {
                id: 'derived-metrics-ingress-user-1-1712000010-sleep',
                scheduleTime: new Date(1_712_000_042_000),
            },
        );
    });

    it('rejects invalid ingress scopes and empty targeted metric lists before dispatch', async () => {
        await expect(enqueueDerivedMetricsIngressTask('user-1', undefined, 1_712_000_015_000, {
            taskScope: 'sleep/other',
            metricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
        })).rejects.toThrow('task scope is invalid');
        await expect(enqueueDerivedMetricsIngressTask('user-1', undefined, 1_712_000_015_000, {
            taskScope: 'sleep',
            metricKinds: [],
        })).rejects.toThrow('metric kinds are invalid');
        await expect(enqueueDerivedMetricsIngressTask('user-1', undefined, 1_712_000_015_000, {
            metricKinds: [DERIVED_METRIC_KINDS.TrainingBuildComparison],
        })).rejects.toThrow('requires a task scope');

        expect(hoisted.mockTaskQueue.enqueue).not.toHaveBeenCalled();
    });

    it('honors an explicit ingress delay override', async () => {
        await expect(enqueueDerivedMetricsIngressTask('user-1', 9, 1_712_000_015_000)).resolves.toBe(true);

        expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledWith(
            { uid: 'user-1', bucketStartEpochSec: 1_712_000_010 },
            { id: 'derived-metrics-ingress-user-1-1712000010', scheduleTime: new Date(1_712_000_024_000) },
        );
    });
});
