import * as admin from 'firebase-admin';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { QueueResult } from '../queue-utils';

// Mock firebase-functions v2 tasks
vi.mock('firebase-functions/v2/tasks', () => ({
    onTaskDispatched: (opts: any, handler: any) => handler,
}));

// Hoisted mocks for admin
const { mockCollection, mockDoc, mockGet } = vi.hoisted(() => {
    const mockGet = vi.fn();
    const mockDoc = {
        get: mockGet,
    };
    const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDoc),
    };
    return {
        mockCollection,
        mockDoc,
        mockGet,
    };
});

vi.mock('firebase-admin', () => ({
    firestore: () => ({
        collection: vi.fn().mockReturnValue(mockCollection),
    }),
}));

// Mock queue dependencies
const { mockParseWorkoutQueueItemForServiceName } = vi.hoisted(() => ({
    mockParseWorkoutQueueItemForServiceName: vi.fn(),
}));

vi.mock('../queue', () => ({
    parseWorkoutQueueItemForServiceName: mockParseWorkoutQueueItemForServiceName,
}));

// Import AFTER mocks
import { processWorkoutTask } from './workout-processor';

describe('processWorkoutTask', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset doc chain
        mockCollection.doc.mockReturnValue(mockDoc);
    });

    it('should process a valid queue item', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;
        const queueData = { processed: false, some: 'data' };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        mockParseWorkoutQueueItemForServiceName.mockResolvedValue(QueueResult.Processed);

        const request = {
            data: { queueItemId, serviceName }
        };

        // Since we mocked onTaskDispatched to return the handler, processWorkoutTask IS the handler
        await (processWorkoutTask as any)(request);

        expect(mockParseWorkoutQueueItemForServiceName).toHaveBeenCalledWith(serviceName, queueData);
    });

    it('should skip if item already processed', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;
        const queueData = { processed: true };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        const request = {
            data: { queueItemId, serviceName }
        };

        await (processWorkoutTask as any)(request);

        expect(mockParseWorkoutQueueItemForServiceName).not.toHaveBeenCalled();
    });

    it('should NOT throw if item exists in failed_jobs (stops Cloud Task retry loop)', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;

        mockGet.mockImplementation(() => {
            // First call (queueDoc.exists)
            return Promise.resolve({ exists: false });
        });

        // Mock the second .doc().get() call for failed_jobs check
        // We need to allow the mock implementation to return a different result for the second call
        // But since we have a chain of mocks, we need to inspect how the mocks are set up in the beforeEach
        // The mockCollection.doc returns mockDoc. mockDoc.get is what we are mocking.

        // Simulating the sequence:
        // 1. queueRef.get() -> returns { exists: false }
        // 2. failedJobRef.get() -> returns { exists: true }
        mockGet
            .mockResolvedValueOnce({ exists: false })
            .mockResolvedValueOnce({ exists: true });

        const request = {
            data: { queueItemId, serviceName }
        };

        // Expect success to stop retry loop
        await expect((processWorkoutTask as any)(request)).resolves.toBeUndefined();
        expect(mockParseWorkoutQueueItemForServiceName).not.toHaveBeenCalled();
    });

    it('should throw if item does not exist AND not in failed_jobs (triggers Cloud Task retry)', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;

        // Simulating the sequence:
        // 1. queueRef.get() -> returns { exists: false }
        // 2. failedJobRef.get() -> returns { exists: false }
        mockGet
            .mockResolvedValueOnce({ exists: false })
            .mockResolvedValueOnce({ exists: false });

        const request = {
            data: { queueItemId, serviceName }
        };

        await expect((processWorkoutTask as any)(request)).rejects.toThrow(
            '[TaskWorker] Queue item test-id not found in garminAPIActivityQueue'
        );
        expect(mockParseWorkoutQueueItemForServiceName).not.toHaveBeenCalled();
    });

    it('should throw if processing fails triggering task retry', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;
        const queueData = { processed: false };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        mockParseWorkoutQueueItemForServiceName.mockRejectedValue(new Error('Fail'));

        const request = {
            data: { queueItemId, serviceName }
        };

        await expect((processWorkoutTask as any)(request)).rejects.toThrow('Fail');
    });

    it('should throw Error if QueueResult.Failed is returned', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;
        const queueData = { processed: false };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        mockParseWorkoutQueueItemForServiceName.mockResolvedValue(QueueResult.Failed);

        const request = {
            data: { queueItemId, serviceName }
        };

        await expect((processWorkoutTask as any)(request)).rejects.toThrow(`Fatal failure updating state for ${serviceName} item: ${queueItemId}`);
    });

    it('should NOT throw if QueueResult.Processed is returned', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;
        const queueData = { processed: false };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        mockParseWorkoutQueueItemForServiceName.mockResolvedValue(QueueResult.Processed);

        const request = {
            data: { queueItemId, serviceName }
        };

        await expect((processWorkoutTask as any)(request)).resolves.toBeUndefined();
    });

    it('should throw if QueueResult.RetryIncremented is returned', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;
        const queueData = { processed: false };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        mockParseWorkoutQueueItemForServiceName.mockResolvedValue(QueueResult.RetryIncremented);

        const request = {
            data: { queueItemId, serviceName }
        };

        await expect((processWorkoutTask as any)(request)).rejects.toThrow(`Item ${queueItemId} failed and was scheduled for retry.`);
    });

    it('should NOT throw if QueueResult.MovedToDLQ is returned', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;
        const queueData = { processed: false };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        mockParseWorkoutQueueItemForServiceName.mockResolvedValue(QueueResult.MovedToDLQ);

        const request = {
            data: { queueItemId, serviceName }
        };

        await expect((processWorkoutTask as any)(request)).resolves.toBeUndefined();
    });

    it('should throw error for unexpected QueueResult', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminAPI;
        const queueData = { processed: false };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        // Use a value that doesn't exist in QueueResult enum
        mockParseWorkoutQueueItemForServiceName.mockResolvedValue('UNKNOWN_RESULT' as any);

        const request = {
            data: { queueItemId, serviceName }
        };

        await expect((processWorkoutTask as any)(request)).rejects.toThrow(`Unexpected result for ${queueItemId}: UNKNOWN_RESULT`);
    });
});

