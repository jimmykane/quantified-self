import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueSportsLibReparseHeavyTask, enqueueSportsLibReparseTask, enqueueSportsLibRouteReparseTask } from './cloud-tasks';

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
            sportsLibReparseQueue: 'processSportsLibReparseTask',
            sportsLibReparseHeavyQueue: 'processSportsLibReparseHeavyTask',
            sportsLibRouteReparseQueue: 'processSportsLibRouteReparseTask',
        },
    },
}));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

describe('sports-lib reparse task dispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.mockTaskQueue.enqueue.mockResolvedValue(undefined);
    });

    it.each([
        [enqueueSportsLibReparseTask, 'processSportsLibReparseTask', 'reparse-job-abc-123'],
        [enqueueSportsLibRouteReparseTask, 'processSportsLibRouteReparseTask', 'route-reparse-job-abc-123'],
    ])('uses direct worker payloads and dispatch deadlines', async (enqueue, functionName, taskId) => {
        await expect(enqueue('job-abc-123')).resolves.toBe(true);

        expect(hoisted.mockFunctions.taskQueue).toHaveBeenCalledWith(
            `projects/test-project/locations/test-location/functions/${functionName}`,
        );
        expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledWith(
            { jobId: 'job-abc-123' },
            { id: taskId, dispatchDeadlineSeconds: 1800, scheduleDelaySeconds: 1 },
        );
    });

    it('uses a unique deterministic id for a manual heavy retry', async () => {
        await expect(enqueueSportsLibReparseHeavyTask('job-abc-123', {
            taskNameSuffix: 'manual-1700000000000-abc',
        })).resolves.toBe(true);

        expect(hoisted.mockFunctions.taskQueue).toHaveBeenCalledWith(
            'projects/test-project/locations/test-location/functions/processSportsLibReparseHeavyTask',
        );
        expect(hoisted.mockTaskQueue.enqueue).toHaveBeenCalledWith(
            { jobId: 'job-abc-123' },
            {
                id: 'reparse-heavy-job-abc-123-manual-1700000000000-abc',
                dispatchDeadlineSeconds: 1800,
                scheduleDelaySeconds: 1,
            },
        );
    });
});
