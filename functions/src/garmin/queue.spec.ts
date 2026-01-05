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
    mockIncreaseRetryCountForQueueItem,
    mockMoveToDeadLetterQueue
} = vi.hoisted(() => {
    return {
        mockSetEvent: vi.fn(),
        mockGet: vi.fn(),
        mockWhere: vi.fn(),
        mockCollection: vi.fn(),
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
    GarminHealthAPIAuth: () => ({
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
import { processGarminHealthAPIActivityQueueItem, insertGarminHealthAPIActivityFileToQueue } from './queue';
import { addToQueueForGarmin } from '../queue';

describe('insertGarminHealthAPIActivityFileToQueue', () => {
    let req: any;
    let res: any;

    beforeEach(() => {
        vi.clearAllMocks();
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
        await insertGarminHealthAPIActivityFileToQueue(req, res);

        expect(addToQueueForGarmin).toHaveBeenCalledWith({
            userID: 'garmin-user-id',
            startTimeInSeconds: 1000,
            manual: false,
            activityFileID: '123',
            activityFileType: 'FIT',
            token: 'abc',
            userAccessToken: 'garmin-access-token',
        });
        expect(res.status).toHaveBeenCalledWith(200);
    });
});

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
            userAccessToken: 'garmin-access-token',
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
        mockIncreaseRetryCountForQueueItem.mockResolvedValue('RETRY_INCREMENTED');
        const result = await processGarminHealthAPIActivityQueueItem(queueItem as any);

        // Verify
        expect(result).toBe('RETRY_INCREMENTED');

        // Verify correct query was made
        expect(mockCollection).toHaveBeenCalledWith('garminHealthAPITokens');
        expect(mockWhere).toHaveBeenCalledWith('accessToken', '==', 'garmin-access-token');
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
            startTimeInSeconds: 12345
        };

        // Mock empty token retrieval
        mockGet.mockResolvedValue({
            size: 0,
            docs: []
        });

        // Execute
        mockMoveToDeadLetterQueue.mockResolvedValue('MOVED_TO_DLQ');
        const result = await processGarminHealthAPIActivityQueueItem(queueItem as any);

        // Verify
        expect(result).toBe('MOVED_TO_DLQ');

        // Verify
        expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('No token found'));
        expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
            queueItem,
            expect.any(Error),
            undefined,
            'NO_TOKEN_FOUND'
        );
    });
});
