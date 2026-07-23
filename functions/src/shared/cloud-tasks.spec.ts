import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNames } from '@sports-alliance/sports-lib';
import { resetCloudTaskQueueDepthCache, resetCloudTasksClient } from './cloud-tasks';

const hoisted = vi.hoisted(() => {
    const mockCloudTasksClient = {
        queuePath: vi.fn(),
        getQueue: vi.fn(),
        getTask: vi.fn(),
    };
    const CloudTasksClientSpy = vi.fn(() => mockCloudTasksClient);
    const mockTaskQueue = { enqueue: vi.fn() };
    const mockFunctions = { taskQueue: vi.fn(() => mockTaskQueue) };
    return { mockCloudTasksClient, CloudTasksClientSpy, mockTaskQueue, mockFunctions };
});

vi.mock('@google-cloud/tasks', () => ({
    v2beta3: { CloudTasksClient: hoisted.CloudTasksClientSpy },
}));

vi.mock('firebase-admin/functions', () => ({
    getFunctions: () => hoisted.mockFunctions,
}));

vi.mock('../config', () => ({
    config: {
        cloudtasks: {
            projectId: 'test-project',
            location: 'test-location',
            workoutQueue: 'processWorkoutTask',
            activitySyncQueue: 'processActivitySyncTask',
            routeDeliverySyncQueue: 'processRouteDeliverySyncTask',
            routeSyncQueue: 'processRouteSyncTask',
            sleepSyncQueue: 'processSleepSyncTask',
            sportsLibReparseQueue: 'processSportsLibReparseTask',
            sportsLibReparseHeavyQueue: 'processSportsLibReparseHeavyTask',
            sportsLibRouteReparseQueue: 'processSportsLibRouteReparseTask',
            derivedMetricsIngressQueue: 'processDerivedMetricsIngressTask',
            derivedMetricsQueue: 'processDerivedMetricsTask',
            derivedMetricsIngressBucketSeconds: 30,
        },
    },
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
}));

describe('Cloud Tasks Utils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        delete process.env.CLOUD_TASKS_EMULATOR_HOST;
        resetCloudTaskQueueDepthCache();
        resetCloudTasksClient();
        hoisted.mockCloudTasksClient.queuePath.mockReturnValue('projects/p/locations/l/queues/q');
        hoisted.mockTaskQueue.enqueue.mockResolvedValue(undefined);
    });

    afterEach(() => {
        delete process.env.CLOUD_TASKS_EMULATOR_HOST;
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    describe('queue monitoring', () => {
        it('reads and caches production queue state through the Cloud Tasks client', async () => {
            const { getCloudTaskQueueStatsForQueue } = await import('./cloud-tasks');
            hoisted.mockCloudTasksClient.getQueue.mockResolvedValue([
                { stats: { tasksCount: '7' }, state: 2 },
            ]);

            await expect(getCloudTaskQueueStatsForQueue('processWorkoutTask')).resolves.toEqual({
                pending: 7,
                state: 'PAUSED',
                enabled: false,
            });
            await getCloudTaskQueueStatsForQueue('processWorkoutTask');

            expect(hoisted.mockCloudTasksClient.queuePath).toHaveBeenCalledWith(
                'test-project',
                'test-location',
                'processWorkoutTask',
            );
            expect(hoisted.mockCloudTasksClient.getQueue).toHaveBeenCalledTimes(1);
        });

        it('reads local queue depth from the task emulator without touching Cloud Tasks', async () => {
            process.env.CLOUD_TASKS_EMULATOR_HOST = '127.0.0.1:9199';
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    'queue:test-project-test-location-processWorkoutTask': { numberOfTasks: 3 },
                }),
            });
            vi.stubGlobal('fetch', fetchMock);
            const { getCloudTaskQueueStatsForQueue } = await import('./cloud-tasks');

            await expect(getCloudTaskQueueStatsForQueue('processWorkoutTask')).resolves.toEqual({
                pending: 3,
                state: 'RUNNING',
                enabled: true,
            });

            expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9199/queueStats');
            expect(hoisted.mockCloudTasksClient.getQueue).not.toHaveBeenCalled();
        });

        it('clamps invalid negative task-emulator counts to zero', async () => {
            process.env.CLOUD_TASKS_EMULATOR_HOST = '127.0.0.1:9199';
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    'queue:test-project-test-location-processWorkoutTask': { numberOfTasks: -1 },
                }),
            }));
            const { getCloudTaskQueueStatsForQueue } = await import('./cloud-tasks');

            await expect(getCloudTaskQueueStatsForQueue('processWorkoutTask')).resolves.toMatchObject({ pending: 0 });
        });
    });

    describe('task dispatch', () => {
        it('enqueues workout work through the fully-qualified Firebase task queue', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');

            await expect(enqueueWorkoutTask('garminAPI' as ServiceNames, 'item-123', 1000, 60)).resolves.toBe(true);

            expect(hoisted.mockFunctions.taskQueue).toHaveBeenCalledWith(
                'projects/test-project/locations/test-location/functions/processWorkoutTask',
            );
            expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledWith(
                { queueItemId: 'item-123', serviceName: 'garminAPI' },
                { id: 'garminAPI-item-123-1000', scheduleDelaySeconds: 60 },
            );
        });

        it('keeps workout task ids valid when an upstream queue item id is not', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');

            await expect(enqueueWorkoutTask('service.with.dots' as ServiceNames, 'item/with spaces', 7.8)).resolves.toBe(true);

            expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledWith(
                { queueItemId: 'item/with spaces', serviceName: 'service.with.dots' },
                { id: 'service-with-dots-item-with-spaces-7', scheduleDelaySeconds: 1 },
            );
        });

        it('preserves the workout recovery path for a stale production task-name reservation', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const duplicateError = Object.assign(new Error('Already exists'), {
                code: 'functions/task-already-exists',
            });
            const notFoundError = Object.assign(new Error('NOT_FOUND'), { code: 5 });
            hoisted.mockTaskQueue.enqueue
                .mockRejectedValueOnce(duplicateError)
                .mockResolvedValueOnce(undefined);
            hoisted.mockCloudTasksClient.getTask.mockRejectedValueOnce(notFoundError);

            await expect(enqueueWorkoutTask('suuntoApp' as ServiceNames, 'item-123', 1000, undefined, {
                recoveryTaskKey: 7,
            })).resolves.toBe(true);

            expect(hoisted.mockTaskQueue.enqueue).toHaveBeenNthCalledWith(1,
                { queueItemId: 'item-123', serviceName: 'suuntoApp' },
                { id: 'suuntoApp-item-123-1000', scheduleDelaySeconds: 1 },
            );
            expect(hoisted.mockTaskQueue.enqueue).toHaveBeenNthCalledWith(2,
                { queueItemId: 'item-123', serviceName: 'suuntoApp' },
                { id: 'suuntoApp-item-123-1000-dedupe-recovery-7', scheduleDelaySeconds: 1 },
            );
            expect(hoisted.mockCloudTasksClient.getTask).toHaveBeenCalledWith({
                name: 'projects/test-project/locations/test-location/queues/processWorkoutTask/tasks/suuntoApp-item-123-1000',
            });
        });

        it('treats a local duplicate as live without querying the production task API', async () => {
            process.env.CLOUD_TASKS_EMULATOR_HOST = '127.0.0.1:9199';
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            hoisted.mockTaskQueue.enqueue.mockRejectedValue(Object.assign(new Error('Already exists'), {
                code: 'functions/task-already-exists',
            }));

            await expect(enqueueWorkoutTask('garminAPI' as ServiceNames, 'item-123', 1000)).resolves.toBe(true);

            expect(hoisted.mockCloudTasksClient.getTask).not.toHaveBeenCalled();
            expect(hoisted.CloudTasksClientSpy).not.toHaveBeenCalled();
        });

        it('retries Firebase task queue transient errors', async () => {
            vi.useFakeTimers();
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            hoisted.mockTaskQueue.enqueue
                .mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { code: 'functions/unavailable' }))
                .mockResolvedValueOnce(undefined);

            const enqueue = enqueueWorkoutTask('garminAPI' as ServiceNames, 'item-retry', 1000);
            await vi.advanceTimersByTimeAsync(1_000);

            await expect(enqueue).resolves.toBe(true);
            expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledTimes(2);
        });

        it('advances a durable recovery generation before retrying an unavailable workout dispatch', async () => {
            const { enqueueWorkoutTaskWithDispatchRecovery } = await import('./cloud-tasks');
            const enqueueTask = vi.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true);
            const advanceDispatchRecoveryGeneration = vi.fn().mockResolvedValue({
                id: 'item-recovery',
                dateCreated: 1000,
                retryCount: 2,
                dispatchRecoveryGeneration: 1,
            });

            await expect(enqueueWorkoutTaskWithDispatchRecovery({
                serviceName: 'garminAPI' as ServiceNames,
                queueItem: {
                    id: 'item-recovery',
                    dateCreated: 1000,
                    retryCount: 2,
                },
                enqueueTask,
                advanceDispatchRecoveryGeneration,
            })).resolves.toBe(true);

            expect(advanceDispatchRecoveryGeneration).toHaveBeenCalledWith({
                id: 'item-recovery',
                dateCreated: 1000,
                retryCount: 2,
            });
            expect(enqueueTask).toHaveBeenNthCalledWith(1,
                'garminAPI',
                'item-recovery',
                1000,
                undefined,
                { recoveryTaskKey: 2 },
            );
            expect(enqueueTask).toHaveBeenNthCalledWith(2,
                'garminAPI',
                'item-recovery',
                1000,
                undefined,
                { recoveryTaskKey: '2-1' },
            );
        });

        it('retries a transient post-enqueue dispatch marker write', async () => {
            vi.useFakeTimers();
            const { markWorkoutTaskDispatchedWithRetry } = await import('./cloud-tasks');
            const markDispatched = vi.fn()
                .mockRejectedValueOnce(Object.assign(new Error('temporarily unavailable'), { code: 'unavailable' }))
                .mockResolvedValueOnce(true);

            const result = markWorkoutTaskDispatchedWithRetry({
                serviceName: 'suuntoApp' as ServiceNames,
                queueItemId: 'item-marker',
                markDispatched,
            });
            await vi.runAllTimersAsync();

            await expect(result).resolves.toBe(true);
            expect(markDispatched).toHaveBeenCalledTimes(2);
        });

        it.each([
            ['enqueueActivitySyncTask', 'processActivitySyncTask', 'activity-sync-item-123-9'],
            ['enqueueRouteSyncTask', 'processRouteSyncTask', 'route-sync-item-123-9'],
            ['enqueueRouteDeliverySyncTask', 'processRouteDeliverySyncTask', 'route-delivery-sync-item-123-9'],
            ['enqueueSleepSyncTask', 'processSleepSyncTask', 'sleep-sync-item-123-9'],
        ])('uses the matching function queue for %s', async (dispatcher, functionName, taskId) => {
            const tasks = await import('./cloud-tasks');
            const enqueue = tasks[dispatcher as keyof typeof tasks] as unknown as (id: string, date: number) => Promise<boolean>;

            await expect(enqueue('item-123', 9)).resolves.toBe(true);

            expect(hoisted.mockFunctions.taskQueue).toHaveBeenCalledWith(
                `projects/test-project/locations/test-location/functions/${functionName}`,
            );
            expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledWith(
                { queueItemId: 'item-123' },
                { id: taskId, scheduleDelaySeconds: 1 },
            );
        });
    });
});
