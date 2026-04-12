import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCloudTasksClient } from './cloud-tasks';

const hoisted = vi.hoisted(() => {
    const mockCloudTasksClient = {
        queuePath: vi.fn(),
        createTask: vi.fn(),
    };
    const CloudTasksClientSpy = vi.fn(() => mockCloudTasksClient);
    return {
        mockCloudTasksClient,
        CloudTasksClientSpy,
    };
});

vi.mock('@google-cloud/tasks', () => ({
    v2beta3: {
        CloudTasksClient: hoisted.CloudTasksClientSpy,
    }
}));

vi.mock('../config', () => ({
    config: {
        cloudtasks: {
            projectId: 'test-project',
            location: 'test-location',
            workoutQueue: 'processWorkoutTask',
            sportsLibReparseQueue: 'processSportsLibReparseTask',
            derivedMetricsQueue: 'processDerivedMetricsTask',
            queue: 'processWorkoutTask',
            serviceAccountEmail: 'sa@test.com',
        }
    }
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

import { enqueueSportsLibReparseTask } from './cloud-tasks';

describe('enqueueSportsLibReparseTask', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetCloudTasksClient();
        hoisted.mockCloudTasksClient.queuePath.mockReturnValue('projects/p/locations/l/queues/q');
        hoisted.mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);
    });

    it('should enqueue reparse task with deterministic name and payload', async () => {
        await expect(enqueueSportsLibReparseTask('job-abc-123')).resolves.toBe(true);

        expect(hoisted.mockCloudTasksClient.queuePath).toHaveBeenCalledWith(
            'test-project',
            'test-location',
            'processSportsLibReparseTask'
        );

        expect(hoisted.mockCloudTasksClient.createTask).toHaveBeenCalledWith({
            parent: 'projects/p/locations/l/queues/q',
            task: expect.objectContaining({
                name: 'projects/p/locations/l/queues/q/tasks/reparse-job-abc-123',
                httpRequest: expect.objectContaining({
                    url: 'https://test-location-test-project.cloudfunctions.net/processSportsLibReparseTask',
                    body: expect.any(String),
                }),
            }),
        });

        const encodedBody = hoisted.mockCloudTasksClient.createTask.mock.calls[0][0].task.httpRequest.body;
        const payload = JSON.parse(Buffer.from(encodedBody, 'base64').toString('utf8'));
        expect(payload).toEqual({ data: { jobId: 'job-abc-123' } });
    });

    it('should swallow ALREADY_EXISTS errors', async () => {
        const err: any = new Error('Already exists');
        err.code = 6;
        hoisted.mockCloudTasksClient.createTask.mockRejectedValue(err);

        await expect(enqueueSportsLibReparseTask('job-abc-123')).resolves.toBe(false);
    });
});
