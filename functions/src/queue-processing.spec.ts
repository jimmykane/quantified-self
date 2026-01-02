import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { UsageLimitExceededError } from './utils';

// Mock dependencies using vi.hoisted
const {
    mockSetEvent,
    mockGetTokenData,
    mockGetWorkoutForService,
    mockGet,
    mockWhere,
    mockCollectionGroup,
    mockCollection,
    mockBatch,
    mockTimestamp,
    mockFirestore,
    mockIncreaseRetryCountForQueueItem
} = vi.hoisted(() => {
    const mockIncreaseRetryCountForQueueItem = vi.fn(async (queueItem: any, error: any, incrementBy = 1) => {
        queueItem.retryCount = (queueItem.retryCount || 0) + incrementBy;
        if (queueItem.ref && queueItem.ref.update) {
            await queueItem.ref.update({ retryCount: queueItem.retryCount });
        }
    });
    const mockCollectionGroup = vi.fn();
    const mockCollection = vi.fn(() => ({
        doc: vi.fn(() => ({
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            update: vi.fn(),
        })),
        where: vi.fn().mockReturnThis(),
        get: vi.fn(),
    }));
    const mockBatch = vi.fn(() => ({
        set: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
    }));
    const mockFirestore = {
        collectionGroup: mockCollectionGroup,
        collection: mockCollection,
        batch: mockBatch,
    };
    return {
        mockSetEvent: vi.fn(),
        mockGetTokenData: vi.fn(),
        mockGetWorkoutForService: vi.fn(),
        mockGet: vi.fn(),
        mockWhere: vi.fn(),
        mockCollectionGroup,
        mockTimestamp: {
            fromDate: vi.fn((date) => ({ toDate: () => date })),
            now: vi.fn(() => ({ toDate: () => new Date() })),
        },
        mockFirestore,
        mockCollection,
        mockBatch,
        mockIncreaseRetryCountForQueueItem,
    };
});

// Mock @sports-alliance/sports-lib components before importing the SUT
vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        EventImporterFIT: {
            getFromArrayBuffer: vi.fn().mockResolvedValue({
                getID: () => 'event-id',
                name: 'test-event',
                startDate: new Date(),
                // Mock setID to return itself for chaining
                setID: function () { return this; },
                toJSON: () => ({}),
                getActivities: () => [],
                clearActivities: () => { },
                addActivities: () => { },
            }),
        },
    };
});

// Import after hoisting but before other mocks that depend on imports
import { parseWorkoutQueueItemForServiceName } from './queue';

vi.mock('./queue', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        getWorkoutForService: mockGetWorkoutForService,
    };
});

vi.mock('./utils', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        setEvent: mockSetEvent,
    };
});

vi.mock('./tokens', () => ({
    getTokenData: mockGetTokenData,
}));

vi.mock('./queue-utils', () => ({
    increaseRetryCountForQueueItem: mockIncreaseRetryCountForQueueItem,
    updateToProcessed: vi.fn(),
    moveToDeadLetterQueue: vi.fn(),
    QueueResult: {
        Processed: 'PROCESSED',
        MovedToDLQ: 'MOVED_TO_DLQ',
        RetryIncremented: 'RETRY_INCREMENTED',
        Failed: 'FAILED',
    }
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin', () => {
    const firestoreFunc = vi.fn(() => mockFirestore);
    (firestoreFunc as any).collectionGroup = mockCollectionGroup;
    (firestoreFunc as any).collection = mockCollection;
    (firestoreFunc as any).Timestamp = mockTimestamp;

    return {
        default: {
            firestore: firestoreFunc
        },
        firestore: firestoreFunc
    };
});


describe('parseWorkoutQueueItemForServiceName', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset default mock implementations if needed
        mockWhere.mockReturnValue({ get: mockGet });
        mockCollectionGroup.mockReturnValue({ where: mockWhere });
    });

    it('should abort retries if UsageLimitExceededError is thrown by setEvent', async () => {
        const updateMock = vi.fn().mockResolvedValue(undefined);

        // Setup queue item with ref to satisfy interfaces
        const queueItem = {
            id: 'test-item',
            userName: 'test-user',
            workoutID: 'test-workout',
            retryCount: 0,
            totalRetryCount: 0,
            ref: {
                update: updateMock,
                parent: { id: 'suuntoAppWorkoutQueue' }
            }
        };

        // Setup token query result
        mockGet.mockResolvedValue({
            size: 1,
            docs: [{
                id: 'token-doc-id',
                data: () => ({ accessToken: 'token' }),
                ref: { parent: { parent: { id: 'user-id' } } }
            }]
        });

        // Mock successful token retrieval
        mockGetTokenData.mockResolvedValue({ accessToken: 'token' });

        // Mock successful download
        const arrayBuffer = new ArrayBuffer(8);
        mockGetWorkoutForService.mockResolvedValue(arrayBuffer);

        // Mock UsageLimitExceededError from setEvent
        mockSetEvent.mockRejectedValue(new UsageLimitExceededError('Limit reached'));

        // Execute
        await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, queueItem as any);

        // Verify
        expect(mockSetEvent).toHaveBeenCalled();

        // Verify side effects of increaseRetryCountForQueueItem
        // The retry count should have been incremented by 20 (0 + 20)
        // The real function mutates the queueItem object in place?
        // Based on queue.ts: result = JSON.parse(JSON.stringify(queueItem)); await ref.update(result);
        // It also does queueItem.retryCount += incrementBy;

        expect(queueItem.retryCount).toBeGreaterThanOrEqual(20);

        // Verify Firestore update was called with the updated retry count
        expect(updateMock).toHaveBeenCalled();
        const updateCallArgs = updateMock.mock.calls[0][0];
        // Check that the update contained the high retry count
        expect(updateCallArgs.retryCount).toBeGreaterThanOrEqual(20);
    });

    it('should move to Dead Letter Queue (fail fast) if no token is found', async () => {
        const loggerFunctions = await import('firebase-functions/logger');
        const loggerSpy = vi.spyOn(loggerFunctions, 'warn');
        const { moveToDeadLetterQueue } = await import('./queue-utils');
        const updateMock = vi.fn().mockResolvedValue(undefined);

        const queueItem = {
            id: 'test-item-missing',
            userName: 'test-user',
            workoutID: 'test-workout',
            retryCount: 0,
            totalRetryCount: 0,
            ref: {
                update: updateMock,
                parent: { id: 'suuntoAppWorkoutQueue' }
            }
        };

        // Mock empty token retrieval
        mockGet.mockResolvedValue({
            size: 0,
            docs: []
        });

        // Execute
        await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, queueItem as any);

        // Verify
        expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('No token found'));

        // Verify move to DLQ was called
        expect(moveToDeadLetterQueue).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'test-item-missing' }),
            expect.any(Error),
            undefined,
            'NO_TOKEN_FOUND'
        );

        // Verify retry count NOT increased
        expect(queueItem.retryCount).toBe(0);
    });
});
