
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageLimitExceededError } from '../utils';

// Mock dependencies using vi.hoisted
const {
    mockSetEvent,
    mockGet,
    mockWhere,
    mockCollection,
    mockCollectionGroup,
    mockRequestGet,
    mockIncreaseRetryCountForQueueItem,
    mockMoveToDeadLetterQueue
} = vi.hoisted(() => {
    return {
        mockSetEvent: vi.fn(),
        mockGet: vi.fn(),
        mockWhere: vi.fn(),
        mockCollection: vi.fn(),
        mockCollectionGroup: vi.fn(),
        mockRequestGet: vi.fn(),
        mockIncreaseRetryCountForQueueItem: vi.fn(),
        mockMoveToDeadLetterQueue: vi.fn(),
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
    GarminAPIAuth: () => ({
        authorize: vi.fn(),
        toHeader: vi.fn().mockReturnValue({}),
    })
}));

// Mock queue utilities
vi.mock('../queue-utils', () => ({
    increaseRetryCountForQueueItem: mockIncreaseRetryCountForQueueItem,
    updateToProcessed: vi.fn(),
    moveToDeadLetterQueue: mockMoveToDeadLetterQueue,
    QueueResult: {
        Processed: 'PROCESSED',
        MovedToDLQ: 'MOVED_TO_DLQ',
        RetryIncremented: 'RETRY_INCREMENTED',
        Failed: 'FAILED',
    }
}));

// Mock parent queue functions
vi.mock('../queue', () => ({
    addToQueueForGarmin: vi.fn(),
    parseQueueItems: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

// Mock firebase-admin
vi.mock('firebase-admin', () => ({
    default: {
        firestore: () => ({
            collection: mockCollection,
            collectionGroup: mockCollectionGroup
        }),
    },
    firestore: () => ({
        collection: mockCollection,
        collectionGroup: mockCollectionGroup
    }),
}));

// Import SUT
import { processGarminAPIActivityQueueItem, insertGarminAPIActivityFileToQueue } from './queue';
import { addToQueueForGarmin } from '../queue';

describe('Garmin Queue', () => { // Grouping for cleaner output

    // Shared Setup Helper
    const setupMocks = () => {
        // Reset call history but keep implementations if needed, OR re-implement
        vi.clearAllMocks();

        // Default: Mock Where returning Get
        mockWhere.mockReturnValue({ get: mockGet, limit: vi.fn().mockReturnValue({ get: mockGet }) });

        // Default: Mock Collection returning Doc -> Collection -> Limit -> Get
        const mockLimit = vi.fn().mockReturnValue({ get: mockGet });
        const mockSubCollection = vi.fn().mockReturnValue({ limit: mockLimit });
        const mockDoc = vi.fn().mockReturnValue({ collection: mockSubCollection });

        mockCollection.mockReturnValue({
            where: mockWhere,
            doc: mockDoc
        });

        // Mock chained collectionGroup query
        // const mockSnapshot = {}; 
        const mockCollectionGroupLimit = vi.fn().mockReturnValue({ get: mockGet }); // Use global mockGet
        // Need to support multiple .where() calls
        const mockWhereReturn = { limit: mockCollectionGroupLimit, where: vi.fn() };
        mockWhereReturn.where.mockReturnValue(mockWhereReturn);

        mockCollectionGroup.mockReturnValue({ where: vi.fn().mockReturnValue(mockWhereReturn) });

        mockRequestGet.mockResolvedValue(new ArrayBuffer(8));

        // Force setEvent to fail
        vi.mocked(mockSetEvent).mockRejectedValue(new UsageLimitExceededError('Limit exceeded'));
    };

    describe('insertGarminAPIActivityFileToQueue', () => {
        let req: any;
        let res: any;

        beforeEach(() => {
            setupMocks();
            req = {
                body: {
                    activityFiles: [{
                        userId: 'garmin-user-id',
                        userAccessToken: 'garmin-access-token',
                        fileType: 'FIT',
                        callbackURL: 'https://callback?id=123&token=abc',
                        startTimeInSeconds: 1000,
                        manual: false,
                    }]
                }
            };
            res = {
                status: vi.fn().mockReturnThis(),
                send: vi.fn().mockReturnThis(),
            };
        });

        it('should correctly extract metadata and call addToQueueForGarmin', async () => {
            await insertGarminAPIActivityFileToQueue(req, res);

            expect(addToQueueForGarmin).toHaveBeenCalledWith({
                userID: 'garmin-user-id',
                startTimeInSeconds: 1000,
                manual: false,
                activityFileID: '123',
                activityFileType: 'FIT',
                token: 'abc',
                userAccessToken: 'garmin-access-token',
                callbackURL: 'https://callback?id=123&token=abc',
            });
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('processGarminAPIActivityQueueItem', () => {
        beforeEach(() => {
            setupMocks();
        });

        it('should abort retries if UsageLimitExceededError is thrown by setEvent', async () => {
            const queueItem = {
                id: 'test-item',
                userID: 'test-user',
                activityFileID: 'file-id',
                activityFileType: 'FIT',
                token: 'token',
                userAccessToken: 'garmin-access-token',
                retryCount: 0,
                manual: false,
                startTimeInSeconds: 12345,
                callbackURL: 'https://test-url'
            };

            // Mock successful token retrieval
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
            mockIncreaseRetryCountForQueueItem.mockResolvedValue('RETRY_INCREMENTED');
            const result = await processGarminAPIActivityQueueItem(queueItem as any);

            // Verify
            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockCollectionGroup).toHaveBeenCalledWith('tokens');
            // Check that the token retrieval path was exercised
            // The chain is: collection -> doc -> collection -> limit -> get
            // We check if get was called (which is the terminal of our mocked chain)
            expect(mockGet).toHaveBeenCalled();
        });

        it('should log a warning if no token is found', async () => {
            const logger = await import('firebase-functions/logger');
            const loggerSpy = vi.spyOn(logger, 'warn');
            const queueItem = {
                id: 'test-item-no-token',
                userID: 'test-user-missing',
                activityFileID: 'file-id',
                activityFileType: 'FIT',
                token: 'token',
                userAccessToken: 'missing-token',
                retryCount: 0,
                manual: false,
                startTimeInSeconds: 12345,
                callbackURL: 'https://test-url'
            };

            // Mock empty token retrieval
            mockGet.mockResolvedValue({
                size: 0,
                docs: []
            });

            // Execute
            mockMoveToDeadLetterQueue.mockResolvedValue('MOVED_TO_DLQ');
            const result = await processGarminAPIActivityQueueItem(queueItem as any);

            // Verify
            expect(result).toBe('MOVED_TO_DLQ');
            expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('No token found'));
            expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                undefined,
                'NO_TOKEN_FOUND'
            );
        });
    });
});
