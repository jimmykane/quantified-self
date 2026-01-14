
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
    mockMoveToDeadLetterQueue,
    mockUpdateToProcessed,
    mockGetTokenData,
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
        mockUpdateToProcessed: vi.fn(),
        mockGetTokenData: vi.fn(),
    };
});

vi.mock('../tokens', () => ({
    getTokenData: mockGetTokenData,
}));

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
    updateToProcessed: mockUpdateToProcessed,
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
import { getTokenData } from '../tokens';
import { updateToProcessed } from '../queue-utils';

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

        it('should handle missing token in callbackURL and use "No token" default', async () => {
            req.body.activityFiles[0].callbackURL = 'https://callback?id=123'; // No token
            await insertGarminAPIActivityFileToQueue(req, res);
            expect(addToQueueForGarmin).toHaveBeenCalledWith(expect.objectContaining({
                token: 'No token'
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should return 500 if activityFileID is missing in the callbackURL', async () => {
            req.body.activityFiles[0].callbackURL = 'https://callback?token=abc'; // No id
            await insertGarminAPIActivityFileToQueue(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });

        it('should return 500 if addToQueueForGarmin fails', async () => {
            vi.mocked(addToQueueForGarmin).mockRejectedValue(new Error('Queue failure'));
            await insertGarminAPIActivityFileToQueue(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('processGarminAPIActivityQueueItem', () => {
        let queueItem: any;
        const firebaseUserID = 'firebase-user-id';

        beforeEach(() => {
            setupMocks();
            queueItem = {
                id: 'test-item',
                userID: 'garmin-user-id',
                activityFileID: 'file-id',
                activityFileType: 'FIT',
                token: 'token',
                userAccessToken: 'garmin-access-token',
                retryCount: 0,
                manual: false,
                startTimeInSeconds: 12345,
                callbackURL: 'https://test-url'
            };

            // Mock successful token retrieval with proper parent path for Firebase User ID extraction
            mockGet.mockResolvedValue({
                size: 1,
                docs: [{
                    id: 'garmin-user-id',
                    ref: {
                        parent: {
                            parent: { id: firebaseUserID }
                        }
                    },
                    data: () => ({
                        accessToken: 'token',
                        userID: 'garmin-user-id',
                        serviceName: 'GarminAPI'
                    }),
                }]
            });

            // Mock getTokenData success
            vi.mocked(getTokenData).mockResolvedValue({
                accessToken: 'fresh-token',
                userID: 'garmin-user-id',
            } as any);

            mockSetEvent.mockResolvedValue(undefined);
            mockIncreaseRetryCountForQueueItem.mockResolvedValue('RETRY_INCREMENTED');
            mockMoveToDeadLetterQueue.mockResolvedValue('MOVED_TO_DLQ');
            vi.mocked(updateToProcessed).mockResolvedValue('PROCESSED' as any);
        });

        it('should successfully process a FIT file and use the correct Firebase User ID', async () => {
            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('PROCESSED');
            expect(mockRequestGet).toHaveBeenCalledWith(expect.objectContaining({
                headers: { 'Authorization': 'Bearer fresh-token' },
                url: queueItem.callbackURL
            }));
            expect(mockSetEvent).toHaveBeenCalledWith(
                firebaseUserID,
                expect.any(String),
                expect.any(Object),
                expect.any(Object),
                expect.any(Object),
                undefined,
                undefined,
                undefined
            );
            expect(updateToProcessed).toHaveBeenCalledWith(queueItem, undefined);
        });

        it('should successfully process a GPX file', async () => {
            queueItem.activityFileType = 'GPX';
            const { EventImporterGPX } = await import('@sports-alliance/sports-lib');
            vi.mocked(EventImporterGPX.getFromString).mockResolvedValue({
                getID: () => 'event-id',
                startDate: new Date(),
                setID: function () { return this; },
            } as any);

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('PROCESSED');
            expect(EventImporterGPX.getFromString).toHaveBeenCalled();
        });

        it('should fallback to FIT if GPX parsing fails', async () => {
            queueItem.activityFileType = 'GPX';
            const { EventImporterGPX, EventImporterFIT } = await import('@sports-alliance/sports-lib');
            vi.mocked(EventImporterGPX.getFromString).mockRejectedValue(new Error('GPX parse error'));

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('PROCESSED');
            expect(EventImporterFIT.getFromArrayBuffer).toHaveBeenCalled();
            // Second download attempt
            expect(mockRequestGet).toHaveBeenCalledTimes(2);
        });

        it('should successfully process a TCX file', async () => {
            queueItem.activityFileType = 'TCX';
            const { EventImporterTCX } = await import('@sports-alliance/sports-lib');
            vi.mocked(EventImporterTCX.getFromXML).mockResolvedValue({
                getID: () => 'event-id',
                startDate: new Date(),
                setID: function () { return this; },
            } as any);

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('PROCESSED');
            expect(EventImporterTCX.getFromXML).toHaveBeenCalled();
        });

        it('should move to DLQ if no token is found', async () => {
            mockGet.mockResolvedValue({ size: 0, docs: [] });

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('MOVED_TO_DLQ');
            expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                undefined,
                'NO_TOKEN_FOUND'
            );
        });

        it('should retry if getTokenData fails', async () => {
            vi.mocked(getTokenData).mockRejectedValue(new Error('Refresh failed'));

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                1,
                undefined
            );
        });

        it('should handle 400 download error by increasing retry count by 20', async () => {
            mockRequestGet.mockRejectedValue({ statusCode: 400 });

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Object),
                20,
                undefined
            );
        });

        it('should handle 500 download error by increasing retry count by 20', async () => {
            mockRequestGet.mockRejectedValue({ statusCode: 500 });

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Object),
                20,
                undefined
            );
        });

        it('should handle 401 download error by increasing retry count by 1', async () => {
            mockRequestGet.mockRejectedValue({ statusCode: 401 });

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Object),
                1,
                undefined
            );
        });

        it('should abort retries (move to DLQ) if UserNotFoundError is thrown by setEvent', async () => {
            const { UserNotFoundError } = await import('../utils');
            mockSetEvent.mockRejectedValue(new UserNotFoundError('User not found'));

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('MOVED_TO_DLQ');
            expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                undefined,
                'USER_NOT_FOUND'
            );
        });

        it('should increment retry count by 20 if UsageLimitExceededError is thrown by setEvent', async () => {
            mockSetEvent.mockRejectedValue(new UsageLimitExceededError('Limit exceeded'));

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                20,
                undefined
            );
        });

        it('should catch generic errors in saving event and increment retry count by 1', async () => {
            mockSetEvent.mockRejectedValue(new Error('Database error'));

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                1,
                undefined
            );
        });

        it('should increment retry count by 1 for generic download errors', async () => {
            mockRequestGet.mockRejectedValue({ statusCode: 503, message: 'Service Unavailable' });

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Object),
                1,
                undefined
            );
        });

        it('should use tokenCache if provided', async () => {
            const tokenCache = new Map();
            const tokenPromise = Promise.resolve({
                size: 1,
                docs: [{
                    id: 'cached-user',
                    ref: { parent: { parent: { id: firebaseUserID } } },
                    data: () => ({ accessToken: 'cached-token', userID: 'garmin-user-id', serviceName: 'GarminAPI' }),
                }]
            });
            tokenCache.set(`GarminAPI:${queueItem.userID}`, tokenPromise);

            const result = await processGarminAPIActivityQueueItem(queueItem, undefined, tokenCache as any);

            expect(result).toBe('PROCESSED');
            expect(await tokenPromise).toBeDefined();
        });

        it('should populate tokenCache if entry is missing', async () => {
            const tokenCache = new Map();
            // mockGet is already setup to return a doc in setupMocks, or we can override here
            mockGet.mockResolvedValue({
                size: 1,
                docs: [{
                    id: 'new-cached-user',
                    ref: { parent: { parent: { id: firebaseUserID } } },
                    data: () => ({ accessToken: 'new-token', userID: 'garmin-user-id', serviceName: 'GarminAPI' }),
                }]
            });

            const result = await processGarminAPIActivityQueueItem(queueItem, undefined, tokenCache as any);

            expect(result).toBe('PROCESSED');
            expect(tokenCache.has(`GarminAPI:${queueItem.userID}`)).toBe(true);
            const cachedPromise = tokenCache.get(`GarminAPI:${queueItem.userID}`);
            expect(await cachedPromise).toBeDefined();
            expect(mockCollectionGroup).toHaveBeenCalledWith('tokens');
        });

        it('should handle tokenCache lookup failure', async () => {
            const tokenCache = new Map();
            const tokenPromise = Promise.reject(new Error('Cache error'));
            tokenCache.set(`GarminAPI:${queueItem.userID}`, tokenPromise);

            const result = await processGarminAPIActivityQueueItem(queueItem, undefined, tokenCache as any);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                1,
                undefined
            );
        });

        it('should handle unsupported file types and increment retry count', async () => {
            queueItem.activityFileType = 'UNSUPPORTED';

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                1,
                undefined
            );
        });

        it('should use default values for manual and startTimeInSeconds if missing', async () => {
            delete queueItem.manual;
            delete queueItem.startTimeInSeconds;
            // mockSetEvent is already mocked to succeed
            const result = await processGarminAPIActivityQueueItem(queueItem);
            expect(result).toBe('PROCESSED');
            expect(mockSetEvent).toHaveBeenCalled();
        });

        it('should handle non-Error objects being thrown and convert them to Error', async () => {
            mockSetEvent.mockRejectedValue('String error');

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                1,
                undefined
            );
        });
    });
});
