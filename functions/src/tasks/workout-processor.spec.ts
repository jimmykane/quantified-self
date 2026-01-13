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
        const serviceName = ServiceNames.GarminHealthAPI;
        const queueData = { processed: false, some: 'data' };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        const request = {
            data: { queueItemId, serviceName }
        };

        // Since we mocked onTaskDispatched to return the handler, processWorkoutTask IS the handler
        await (processWorkoutTask as any)(request);

        expect(mockParseWorkoutQueueItemForServiceName).toHaveBeenCalledWith(serviceName, queueData);
    });

    it('should skip if item already processed', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminHealthAPI;
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

    it('should skip if item does not exist', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminHealthAPI;

        mockGet.mockResolvedValue({
            exists: false,
        });

        const request = {
            data: { queueItemId, serviceName }
        };

        await (processWorkoutTask as any)(request);

        expect(mockParseWorkoutQueueItemForServiceName).not.toHaveBeenCalled();
    });

    it('should throw if processing fails triggering task retry', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminHealthAPI;
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
        const serviceName = ServiceNames.GarminHealthAPI;
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
        const serviceName = ServiceNames.GarminHealthAPI;
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

    it('should NOT throw if QueueResult.RetryIncremented is returned', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminHealthAPI;
        const queueData = { processed: false };

        mockGet.mockResolvedValue({
            exists: true,
            data: () => queueData,
        });

        mockParseWorkoutQueueItemForServiceName.mockResolvedValue(QueueResult.RetryIncremented);

        const request = {
            data: { queueItemId, serviceName }
        };

        await expect((processWorkoutTask as any)(request)).resolves.toBeUndefined();
    });

    it('should NOT throw if QueueResult.MovedToDLQ is returned', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminHealthAPI;
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

    it('should log warning for unexpected QueueResult but not throw', async () => {
        const queueItemId = 'test-id';
        const serviceName = ServiceNames.GarminHealthAPI;
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

        await expect((processWorkoutTask as any)(request)).resolves.toBeUndefined();
    });
});

