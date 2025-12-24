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
    mockCollectionGroup
} = vi.hoisted(() => {
    return {
        mockSetEvent: vi.fn(),
        mockGetTokenData: vi.fn(),
        mockGetWorkoutForService: vi.fn(),
        mockGet: vi.fn(),
        mockWhere: vi.fn(),
        mockCollectionGroup: vi.fn()
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
        // We DON'T mock increaseRetryCountForQueueItem here because it's used internally
        // and we want to verify its side effects (updating the ref).
        // If we mocked it, the internal call would still use the real implementation 
        // (because it's in the same file), but our spy wouldn't catch it unless we spy on the module exports...
        // which is tricky with circular dependencies / same-file calls.
        // Instead, we just let it run and check the side effects on the queueItem object.
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

// Mock firebase-admin
mockWhere.mockReturnValue({ get: mockGet });
mockCollectionGroup.mockReturnValue({ where: mockWhere });
const mockFirestore = {
    collectionGroup: mockCollectionGroup,
};

vi.mock('firebase-admin', () => ({
    default: {
        firestore: () => mockFirestore,
    },
    firestore: () => mockFirestore,
}));

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
                update: updateMock
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

    it('should log a warning if no token is found', async () => {
        const consoleSpy = vi.spyOn(console, 'warn');
        const updateMock = vi.fn().mockResolvedValue(undefined);

        const queueItem = {
            id: 'test-item-missing',
            userName: 'test-user',
            workoutID: 'test-workout',
            retryCount: 0,
            totalRetryCount: 0, // Explicitly init with 0 to avoid undefined + 20 = NaN if code relies on +=
            // queue.ts: queueItem.totalRetryCount = queueItem.totalRetryCount || 0;
            ref: {
                update: updateMock
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
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No token found'));

        // Verify retry count increase (grace period)
        expect(queueItem.retryCount).toBe(1);
        expect(updateMock).toHaveBeenCalled();
    });
});
