import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetCloudTaskQueueDepthCache, resetCloudTasksClient } from './cloud-tasks';

// Mock @google-cloud/tasks
const { mockCloudTasksClient, CloudTasksClientSpy } = vi.hoisted(() => {
    const mockCloudTasksClient = {
        queuePath: vi.fn(),
        getQueue: vi.fn(),
        createTask: vi.fn(),
        close: vi.fn(),
    };
    const CloudTasksClientSpy = vi.fn(() => mockCloudTasksClient);
    return { mockCloudTasksClient, CloudTasksClientSpy };
});

vi.mock('@google-cloud/tasks', () => {
    return {
        v2beta3: {
            CloudTasksClient: CloudTasksClientSpy,
        }
    };
});

// Mock config
vi.mock('../config', () => ({
    config: {
        cloudtasks: {
            projectId: 'test-project',
            location: 'test-location',
            queue: 'test-queue',
            serviceAccountEmail: 'sa@test.com'
        }
    }
}));

// Mock logger
vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
}));

describe('Cloud Tasks Utils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetCloudTaskQueueDepthCache();
        resetCloudTasksClient();
        // Setup default mock behaviors
        mockCloudTasksClient.queuePath.mockReturnValue('projects/p/locations/l/queues/q');
        CloudTasksClientSpy.mockClear();
    });

    describe('getCloudTaskQueueDepth', () => {
        it('should return number of tasks using getQueue stats', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValue([
                {
                    stats: {
                        tasksCount: '42'
                    }
                }
            ]);

            const depth = await getCloudTaskQueueDepth();

            expect(depth).toBe(42);
            expect(mockCloudTasksClient.queuePath).toHaveBeenCalledWith('test-project', 'test-location', 'test-queue');
            expect(mockCloudTasksClient.getQueue).toHaveBeenCalledWith({
                name: 'projects/p/locations/l/queues/q',
                readMask: { paths: ['stats'] }
            });
        });

        it('should use cached value if called multiple times within TTL', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValue([
                { stats: { tasksCount: '10' } }
            ]);

            const depth1 = await getCloudTaskQueueDepth();
            expect(depth1).toBe(10);
            expect(mockCloudTasksClient.getQueue).toHaveBeenCalledTimes(1);

            // Second call should return cached value without hitting API
            const depth2 = await getCloudTaskQueueDepth();
            expect(depth2).toBe(10);
            expect(mockCloudTasksClient.getQueue).toHaveBeenCalledTimes(1);
        });

        it('should bypass cache when forceRefresh is true', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValueOnce([
                { stats: { tasksCount: '10' } }
            ]);

            await getCloudTaskQueueDepth(); // Fill cache
            expect(mockCloudTasksClient.getQueue).toHaveBeenCalledTimes(1);

            mockCloudTasksClient.getQueue.mockResolvedValueOnce([
                { stats: { tasksCount: '20' } }
            ]);

            // Call with forceRefresh = true
            const depth = await getCloudTaskQueueDepth(true);
            expect(depth).toBe(20);
            expect(mockCloudTasksClient.getQueue).toHaveBeenCalledTimes(2);
        });

        it('should return 0 if tasksCount is missing', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValue([
                {
                    stats: {}
                }
            ]);

            const depth = await getCloudTaskQueueDepth();
            expect(depth).toBe(0);
        });

        it('should return 0 if stats is missing', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValue([
                {}
            ]);

            const depth = await getCloudTaskQueueDepth();
            expect(depth).toBe(0);
        });

        it('should throw error if projectId is missing', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');
            const { config } = await import('../config');

            const originalProjectId = config.cloudtasks.projectId;
            (config.cloudtasks as unknown as Record<string, unknown>).projectId = undefined;

            await expect(getCloudTaskQueueDepth()).rejects.toThrow('Project ID is not defined in config');

            (config.cloudtasks as unknown as Record<string, unknown>).projectId = originalProjectId;
        });

        it('should handle large task counts', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValue([
                { stats: { tasksCount: '999999' } }
            ]);

            const depth = await getCloudTaskQueueDepth();
            expect(depth).toBe(999999);
        });

        it('should handle tasksCount as number type', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValue([
                { stats: { tasksCount: 123 } }
            ]);

            const depth = await getCloudTaskQueueDepth();
            expect(depth).toBe(123);
        });

        it('should handle tasksCount as BigInt string', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValue([
                { stats: { tasksCount: '9007199254740991' } } // Max safe integer
            ]);

            const depth = await getCloudTaskQueueDepth();
            expect(depth).toBe(9007199254740991);
        });

        it('should propagate API errors', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            const apiError = new Error('API Error');
            mockCloudTasksClient.getQueue.mockRejectedValue(apiError);

            await expect(getCloudTaskQueueDepth()).rejects.toThrow('API Error');
        });

        it('should update cache after forceRefresh', async () => {
            const { getCloudTaskQueueDepth } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValueOnce([
                { stats: { tasksCount: '10' } }
            ]);
            await getCloudTaskQueueDepth();

            mockCloudTasksClient.getQueue.mockResolvedValueOnce([
                { stats: { tasksCount: '50' } }
            ]);
            await getCloudTaskQueueDepth(true);

            // Third call should use new cached value
            const depth = await getCloudTaskQueueDepth();
            expect(depth).toBe(50);
            expect(mockCloudTasksClient.getQueue).toHaveBeenCalledTimes(2);
        });


    });

    describe('enqueueWorkoutTask', () => {
        it('should enqueue task with correct payload', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

            const dateCreated = 1000;
            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', dateCreated);

            expect(mockCloudTasksClient.createTask).toHaveBeenCalledWith({
                parent: 'projects/p/locations/l/queues/q',
                task: expect.objectContaining({
                    name: 'projects/p/locations/l/queues/q/tasks/garminHealthAPI-item-123-1000',
                    httpRequest: expect.objectContaining({
                        url: expect.stringContaining('test-location-test-project.cloudfunctions.net/test-queue'),
                        httpMethod: 'POST',
                        body: expect.any(String),
                    })
                })
            });
        });

        it('should include scheduleTime if delay is provided', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000, 60);

            expect(mockCloudTasksClient.createTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    task: expect.objectContaining({
                        scheduleTime: expect.objectContaining({
                            seconds: expect.any(Number)
                        })
                    })
                })
            );
        });

        it('should handle ALREADY_EXISTS error gracefully', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            const error = new Error('Already Exists');
            (error as Error & { code: number }).code = 6;
            mockCloudTasksClient.createTask.mockRejectedValue(error);

            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000);

            expect(mockCloudTasksClient.createTask).toHaveBeenCalled();
        });

        it('should rethrow non-6 errors', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            const error = new Error('Some other error');
            mockCloudTasksClient.createTask.mockRejectedValue(error);

            await expect(enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000)).rejects.toThrow('Some other error');
        });

        it('should throw error if projectId is missing', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { config } = await import('../config');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            const originalProjectId = config.cloudtasks.projectId;
            (config.cloudtasks as unknown as Record<string, unknown>).projectId = undefined;

            await expect(enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000))
                .rejects.toThrow('Project ID is not defined in config');

            (config.cloudtasks as unknown as Record<string, unknown>).projectId = originalProjectId;
        });

        it('should sanitize serviceName with special characters', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');

            mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

            // Using a string with special chars (simulating edge case)
            await enqueueWorkoutTask('service.with.dots' as any, 'item-123', 1000);

            expect(mockCloudTasksClient.createTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    task: expect.objectContaining({
                        name: expect.stringContaining('service-with-dots-item-123-1000')
                    })
                })
            );
        });

        it('should include OIDC token for authentication', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

            await enqueueWorkoutTask(ServiceNames.SuuntoApp, 'item-abc', 2000);

            expect(mockCloudTasksClient.createTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    task: expect.objectContaining({
                        httpRequest: expect.objectContaining({
                            oidcToken: {
                                serviceAccountEmail: 'sa@test.com'
                            }
                        })
                    })
                })
            );
        });

        it('should encode payload as base64', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

            await enqueueWorkoutTask(ServiceNames.COROSAPI, 'item-xyz', 3000);

            const call = mockCloudTasksClient.createTask.mock.calls[0][0];
            const body = call.task.httpRequest.body;

            // Verify it's valid base64
            const decoded = JSON.parse(Buffer.from(body, 'base64').toString());
            expect(decoded).toEqual({
                data: {
                    queueItemId: 'item-xyz',
                    serviceName: ServiceNames.COROSAPI
                }
            });
        });

        it('should support zero delay (immediate execution)', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000, 0);

            // With delay of 0, scheduleTime should not be set (falsy check)
            const call = mockCloudTasksClient.createTask.mock.calls[0][0];
            expect(call.task.scheduleTime).toBeUndefined();
        });

        it('should use dateCreated in task name for deduplication', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

            // Same queueItemId but different dateCreated
            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000);
            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 2000);

            const calls = mockCloudTasksClient.createTask.mock.calls;
            const taskName1 = calls[0][0].task.name;
            const taskName2 = calls[1][0].task.name;

            expect(taskName1).toContain('item-123-1000');
            expect(taskName2).toContain('item-123-2000');
            expect(taskName1).not.toBe(taskName2);
        });

        it('should handle very long queueItemId', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

            const longId = 'a'.repeat(200);
            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, longId, 1000);

            expect(mockCloudTasksClient.createTask).toHaveBeenCalled();
        });

        it('should handle PERMISSION_DENIED error (code 7)', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');
            const logger = await import('firebase-functions/logger');

            const error = new Error('Permission denied');
            (error as Error & { code: number }).code = 7;
            mockCloudTasksClient.createTask.mockRejectedValue(error);

            await expect(enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000)).rejects.toThrow('Permission denied');
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to enqueue task'), error);
        });

        it('should handle network timeout errors', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');
            const logger = await import('firebase-functions/logger');

            const error = new Error('DEADLINE_EXCEEDED');
            (error as Error & { code: number }).code = 4;
            mockCloudTasksClient.createTask.mockRejectedValue(error);

            await expect(enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000)).rejects.toThrow('DEADLINE_EXCEEDED');
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to enqueue task'), error);
        });

        it('should retry on UNAVAILABLE (code 14) error and reset client', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            const unavailableError = new Error('Unavailable');
            (unavailableError as any).code = 14;

            mockCloudTasksClient.createTask
                .mockRejectedValueOnce(unavailableError)
                .mockResolvedValueOnce([{ name: 'task-name' }]);

            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-retry', 1000);

            expect(mockCloudTasksClient.createTask).toHaveBeenCalledTimes(2);
            // First call (lazy init) + Second call (re-init after invalidation) = 2 constructor calls
            // Wait, if _cloudTasksClient is null initially -> 1 call.
            // Then invalidation -> _cloudTasksClient = null.
            // Next retry -> new instantiation -> 1 call.
            // Total 2 constructor calls.
            expect(CloudTasksClientSpy).toHaveBeenCalledTimes(2);
        });

        it('should retry on ECONNRESET error and reset client', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            const connResetError = new Error('read ECONNRESET');
            (connResetError as any).code = 14; // Often matches UNAVAILABLE but text matters too

            mockCloudTasksClient.createTask
                .mockRejectedValueOnce(connResetError)
                .mockResolvedValueOnce([{ name: 'task-name' }]);

            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-retry-reset', 1000);

            expect(mockCloudTasksClient.createTask).toHaveBeenCalledTimes(2);
            expect(CloudTasksClientSpy).toHaveBeenCalledTimes(2);
        });
    });

    describe('resetCloudTaskQueueDepthCache', () => {
        it('should clear the cache', async () => {
            const { getCloudTaskQueueDepth, resetCloudTaskQueueDepthCache } = await import('./cloud-tasks');

            mockCloudTasksClient.getQueue.mockResolvedValue([
                { stats: { tasksCount: '100' } }
            ]);

            await getCloudTaskQueueDepth();
            expect(mockCloudTasksClient.getQueue).toHaveBeenCalledTimes(1);

            resetCloudTaskQueueDepthCache();

            mockCloudTasksClient.getQueue.mockResolvedValue([
                { stats: { tasksCount: '200' } }
            ]);

            const depth = await getCloudTaskQueueDepth();
            expect(depth).toBe(200);
            expect(mockCloudTasksClient.getQueue).toHaveBeenCalledTimes(2);
        });

        it('should be safe to call when cache is already empty', () => {
            expect(() => resetCloudTaskQueueDepthCache()).not.toThrow();
        });
    });


});
