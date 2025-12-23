import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { UsageLimitExceededError } from '../utils';

// Mock dependencies using vi.hoisted
const {
    mockSetEvent,
    mockGet,
    mockWhere,
    mockCollection,
    mockRequestGet,
    mockIncreaseRetryCountForQueueItem
} = vi.hoisted(() => {
    return {
        mockSetEvent: vi.fn(),
        mockGet: vi.fn(),
        mockWhere: vi.fn(),
        mockCollection: vi.fn(),
        mockRequestGet: vi.fn(),
        mockIncreaseRetryCountForQueueItem: vi.fn()
    };
});

// Mock @sports-alliance/sports-lib components
vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        EventImporterFIT: {
            getFromArrayBuffer: vi.fn().mockResolvedValue({
                getID: () => 'event-id',
                name: 'test-event',
                startDate: new Date(),
                setID: function () { return this; },
                toJSON: () => ({}),
                getActivities: () => [],
                clearActivities: () => { },
                addActivities: () => { },
            }),
        },
        EventImporterGPX: {
            getFromString: vi.fn(),
        },
        EventImporterTCX: {
            getFromXML: vi.fn(),
        }
    };
});

vi.mock('../utils', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        setEvent: mockSetEvent,
    };
});

vi.mock('../request-helper', () => ({
    get: mockRequestGet,
}));

vi.mock('./auth/auth', () => ({
    GarminHealthAPIAuth: () => ({
        authorize: vi.fn(),
        toHeader: vi.fn().mockReturnValue({}),
    })
}));

// Mock parent queue functions
// We can mock increaseRetryCountForQueueItem here because it is IMPORTED in garmin/queue.ts
// unlike the previous case where it was in the same file.
vi.mock('../queue', () => ({
    increaseRetryCountForQueueItem: mockIncreaseRetryCountForQueueItem,
    addToQueueForGarmin: vi.fn(),
    parseQueueItems: vi.fn(),
    updateToProcessed: vi.fn(),
}));

// Mock firebase-admin
mockWhere.mockReturnValue({ get: mockGet });
mockCollection.mockReturnValue({ where: mockWhere });
const mockFirestore = {
    collection: mockCollection,
};

vi.mock('firebase-admin', () => ({
    default: {
        firestore: () => mockFirestore,
    },
    firestore: () => mockFirestore,
}));

// Import SUT
import { processGarminHealthAPIActivityQueueItem } from './queue';

describe('processGarminHealthAPIActivityQueueItem', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockWhere.mockReturnValue({ get: mockGet });
        mockCollection.mockReturnValue({ where: mockWhere });
        mockRequestGet.mockResolvedValue(new ArrayBuffer(8));
    });

    it('should abort retries if UsageLimitExceededError is thrown by setEvent', async () => {
        const queueItem = {
            id: 'test-item',
            userID: 'test-user',
            activityFileID: 'file-id',
            activityFileType: 'FIT',
            token: 'token',
            retryCount: 0,
            manual: false,
            startTimeInSeconds: 12345
        };

        // Mock token retrieval
        mockGet.mockResolvedValue({
            size: 1,
            docs: [{
                id: 'token-doc-id',
                data: () => ({ accessToken: 'token', accessTokenSecret: 'secret', userID: 'test-user' }),
            }]
        });

        // Mock UsageLimitExceededError from setEvent
        mockSetEvent.mockRejectedValue(new UsageLimitExceededError('Limit reached'));

        // Execute
        await processGarminHealthAPIActivityQueueItem(queueItem as any);

        // Verify
        expect(mockSetEvent).toHaveBeenCalled();
        expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
            queueItem,
            ServiceNames.GarminHealthAPI,
            expect.any(UsageLimitExceededError),
            20 // Should abort retries
        );
    });

    it('should log a warning if no token is found', async () => {
        const consoleSpy = vi.spyOn(console, 'warn');
        const queueItem = {
            id: 'test-item-no-token',
            userID: 'test-user-missing',
            activityFileID: 'file-id',
            activityFileType: 'FIT',
            token: 'token',
            retryCount: 0,
            manual: false,
            startTimeInSeconds: 12345
        };

        // Mock empty token retrieval
        mockGet.mockResolvedValue({
            size: 0,
            docs: []
        });

        // Execute
        await processGarminHealthAPIActivityQueueItem(queueItem as any);

        // Verify
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No token found'));
        expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
            queueItem,
            ServiceNames.GarminHealthAPI,
            expect.any(Error),
            20
        );
    });
});
