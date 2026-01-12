import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetCloudTaskQueueDepthCache } from './cloud-tasks';

// Mock @google-cloud/tasks
const mockCloudTasksClient = {
    queuePath: vi.fn(),
    getQueue: vi.fn(),
    createTask: vi.fn(),
    close: vi.fn(),
};

vi.mock('@google-cloud/tasks', () => {
    return {
        v2beta3: {
            CloudTasksClient: vi.fn(() => mockCloudTasksClient),
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

describe('Cloud Tasks Utils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetCloudTaskQueueDepthCache();
        // Setup default mock behaviors
        mockCloudTasksClient.queuePath.mockReturnValue('projects/p/locations/l/queues/q');
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
            (config.cloudtasks as any).projectId = undefined;

            await expect(getCloudTaskQueueDepth()).rejects.toThrow('Project ID is not defined in config');

            (config.cloudtasks as any).projectId = originalProjectId;
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
                    name: 'projects/p/locations/l/queues/q/tasks/garminHealthAPI-item-123-1000', // Deduplication ID (Sanitized + dateCreated)
                    httpRequest: expect.objectContaining({
                        url: expect.stringContaining('test-location-test-project.cloudfunctions.net/test-queue'),
                        httpMethod: 'POST',
                        body: expect.any(String), // Base64 encoded
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
            (error as any).code = 6;
            mockCloudTasksClient.createTask.mockRejectedValue(error);

            // Should not throw
            await enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000);

            // Should verify we tried
            expect(mockCloudTasksClient.createTask).toHaveBeenCalled();
        });

        it('should handle non-6 errors by catching/logging (not throwing)', async () => {
            const { enqueueWorkoutTask } = await import('./cloud-tasks');
            const { ServiceNames } = await import('@sports-alliance/sports-lib');

            const error = new Error('Some other error');
            mockCloudTasksClient.createTask.mockRejectedValue(error);

            // Currently implementation catches generic errors and logs them.
            // It does NOT rethrow.
            await expect(enqueueWorkoutTask(ServiceNames.GarminHealthAPI, 'item-123', 1000)).resolves.not.toThrow();
        });
    });
});
