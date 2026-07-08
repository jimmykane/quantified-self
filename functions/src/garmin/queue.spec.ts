
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageLimitExceededError } from '../utils';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type * as admin from 'firebase-admin';

// Mock dependencies using vi.hoisted
const {
    mockSetEvent,
    mockGet,
    mockWhere,
    mockCollection,
    mockCollectionGroup,
    mockRequestGet,
    mockDeferQueueItemForPendingDisconnect,
    mockIncreaseRetryCountForQueueItem,
    mockMarkQueueItemSkipped,
    mockMoveToDeadLetterQueue,
    mockUpdateToProcessed,
    mockGetTokenData,
    mockUploadDebugFile,
    mockCreateParsingOptions,
    mockEnqueueActivitySyncJobsForImportedEvent,
    mockResolveFirebaseUserIDForGarminUserID,
    MockTerminalServiceAuthError,
    MockTokenRefreshSkippedForDeletedUserError,
    mockShouldSkipQueueWorkForDeletedUser,
} = vi.hoisted(() => {
    class MockTerminalServiceAuthError extends Error {
        readonly name = 'TerminalServiceAuthError';
        readonly dlqContext = 'INVALID_GRANT';
        readonly firebaseUserID = 'firebase-user-123';
        readonly providerUserId = 'garmin-user-id';
    }
    class MockTokenRefreshSkippedForDeletedUserError extends Error {
        readonly name = 'TokenRefreshSkippedForDeletedUserError';
    }

    return {
        mockSetEvent: vi.fn(),
        mockGet: vi.fn(),
        mockWhere: vi.fn(),
        mockCollection: vi.fn(),
        mockCollectionGroup: vi.fn(),
        mockRequestGet: vi.fn(),
        mockDeferQueueItemForPendingDisconnect: vi.fn(),
        mockIncreaseRetryCountForQueueItem: vi.fn(),
        mockMarkQueueItemSkipped: vi.fn(),
        mockMoveToDeadLetterQueue: vi.fn(),
        mockUpdateToProcessed: vi.fn(),
        mockGetTokenData: vi.fn(),
        mockUploadDebugFile: vi.fn(),
        mockCreateParsingOptions: vi.fn(() => ({ generateUnitStreams: false, deviceInfoMode: 'changes' })),
        mockEnqueueActivitySyncJobsForImportedEvent: vi.fn().mockResolvedValue({ queued: 1, skippedByReason: {} }),
        mockResolveFirebaseUserIDForGarminUserID: vi.fn(),
        MockTerminalServiceAuthError,
        MockTokenRefreshSkippedForDeletedUserError,
        mockShouldSkipQueueWorkForDeletedUser: vi.fn().mockResolvedValue(false),
    };
});

vi.mock('../tokens', () => ({
    getTokenData: mockGetTokenData,
    TerminalServiceAuthError: MockTerminalServiceAuthError,
    TokenRefreshSkippedForDeletedUserError: MockTokenRefreshSkippedForDeletedUserError,
}));

vi.mock('../queue/user-deletion-skip', () => ({
    shouldSkipQueueWorkForDeletedUser: mockShouldSkipQueueWorkForDeletedUser,
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

vi.mock('../debug-utils', () => ({
    uploadDebugFile: mockUploadDebugFile,
}));

vi.mock('../../../shared/parsing-options', () => ({
    createParsingOptions: mockCreateParsingOptions,
}));

vi.mock('../activity-sync/enqueue-imported-event', () => ({
    enqueueActivitySyncJobsForImportedEvent: mockEnqueueActivitySyncJobsForImportedEvent,
}));

// Mock queue utilities
vi.mock('../queue-utils', () => ({
    deferQueueItemForPendingDisconnect: mockDeferQueueItemForPendingDisconnect,
    increaseRetryCountForQueueItem: mockIncreaseRetryCountForQueueItem,
    markQueueItemSkipped: mockMarkQueueItemSkipped,
    QUEUE_SKIPPED_REASONS: {
        UserDeletedOrDeleting: 'user_deleted_or_deleting',
    },
    updateToProcessed: mockUpdateToProcessed,
    moveToDeadLetterQueue: mockMoveToDeadLetterQueue,
    QueueResult: {
        Processed: 'PROCESSED',
        Skipped: 'SKIPPED',
        Deferred: 'DEFERRED',
        MovedToDLQ: 'MOVED_TO_DLQ',
        RetryIncremented: 'RETRY_INCREMENTED',
        Failed: 'FAILED',
    }
}));

// Mock parent queue functions
vi.mock('../queue', () => ({
    addToQueueForGarmin: vi.fn(),
    resolveFirebaseUserIDForGarminUserID: mockResolveFirebaseUserIDForGarminUserID,
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
import { getTokenData, TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from '../tokens';
import { updateToProcessed } from '../queue-utils';
import { EventWriteSkippedForDeletedUserError } from '../utils';

describe('Garmin Queue', () => { // Grouping for cleaner output

    // Shared Setup Helper
    const setupMocks = () => {
        // Reset call history but keep implementations if needed, OR re-implement
        vi.clearAllMocks();
        mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);

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
        mockResolveFirebaseUserIDForGarminUserID.mockResolvedValue('firebase-user-id');

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
                firebaseUserID: 'firebase-user-id',
            });
            expect(mockResolveFirebaseUserIDForGarminUserID).toHaveBeenCalledWith('garmin-user-id');
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
            expect(addToQueueForGarmin).not.toHaveBeenCalled();
        });

        it('should return 500 if addToQueueForGarmin fails', async () => {
            vi.mocked(addToQueueForGarmin).mockRejectedValue(new Error('Queue failure'));
            await insertGarminAPIActivityFileToQueue(req, res);
            expect(res.status).toHaveBeenCalledWith(500);
        });

        it('should return 500 if queue insertion rejects with a falsey value', async () => {
            vi.mocked(addToQueueForGarmin).mockRejectedValue(undefined);

            await insertGarminAPIActivityFileToQueue(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });

        it.each([
            'ProviderQueueUserNotConnectedError',
            'ProviderQueueUserDeletedOrDeletingError',
        ])('should acknowledge activity file notifications for %s', async (errorName) => {
            vi.mocked(addToQueueForGarmin).mockRejectedValue(Object.assign(new Error('not connected'), {
                name: errorName,
            }));

            await insertGarminAPIActivityFileToQueue(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should resolve Firebase uid once for multiple files from the same Garmin user', async () => {
            req.body.activityFiles = [
                {
                    userId: 'garmin-user-id',
                    userAccessToken: 'garmin-access-token',
                    fileType: 'FIT',
                    callbackURL: 'https://callback?id=123&token=abc',
                    startTimeInSeconds: 1000,
                    manual: false,
                },
                {
                    userId: 'garmin-user-id',
                    userAccessToken: 'garmin-access-token',
                    fileType: 'FIT',
                    callbackURL: 'https://callback?id=456&token=def',
                    startTimeInSeconds: 2000,
                    manual: false,
                },
            ];

            await insertGarminAPIActivityFileToQueue(req, res);

            expect(mockResolveFirebaseUserIDForGarminUserID).toHaveBeenCalledTimes(1);
            expect(mockResolveFirebaseUserIDForGarminUserID).toHaveBeenCalledWith('garmin-user-id');
            expect(addToQueueForGarmin).toHaveBeenCalledTimes(2);
            expect(addToQueueForGarmin).toHaveBeenCalledWith(expect.objectContaining({
                activityFileID: '123',
                firebaseUserID: 'firebase-user-id',
            }));
            expect(addToQueueForGarmin).toHaveBeenCalledWith(expect.objectContaining({
                activityFileID: '456',
                firebaseUserID: 'firebase-user-id',
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should resolve Firebase uid once per distinct Garmin user', async () => {
            req.body.activityFiles = [
                {
                    userId: 'garmin-user-1',
                    userAccessToken: 'garmin-access-token-1',
                    fileType: 'FIT',
                    callbackURL: 'https://callback?id=123&token=abc',
                    startTimeInSeconds: 1000,
                    manual: false,
                },
                {
                    userId: 'garmin-user-2',
                    userAccessToken: 'garmin-access-token-2',
                    fileType: 'FIT',
                    callbackURL: 'https://callback?id=456&token=def',
                    startTimeInSeconds: 2000,
                    manual: false,
                },
                {
                    userId: 'garmin-user-1',
                    userAccessToken: 'garmin-access-token-1',
                    fileType: 'FIT',
                    callbackURL: 'https://callback?id=789&token=ghi',
                    startTimeInSeconds: 3000,
                    manual: false,
                },
            ];
            mockResolveFirebaseUserIDForGarminUserID.mockImplementation(async (garminUserID: string) => `firebase-${garminUserID}`);

            await insertGarminAPIActivityFileToQueue(req, res);

            expect(mockResolveFirebaseUserIDForGarminUserID).toHaveBeenCalledTimes(2);
            expect(addToQueueForGarmin).toHaveBeenCalledTimes(3);
            expect(addToQueueForGarmin).toHaveBeenCalledWith(expect.objectContaining({
                userID: 'garmin-user-1',
                activityFileID: '123',
                firebaseUserID: 'firebase-garmin-user-1',
            }));
            expect(addToQueueForGarmin).toHaveBeenCalledWith(expect.objectContaining({
                userID: 'garmin-user-2',
                activityFileID: '456',
                firebaseUserID: 'firebase-garmin-user-2',
            }));
            expect(addToQueueForGarmin).toHaveBeenCalledWith(expect.objectContaining({
                userID: 'garmin-user-1',
                activityFileID: '789',
                firebaseUserID: 'firebase-garmin-user-1',
            }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should acknowledge and skip files when Garmin user no longer resolves to a Firebase uid', async () => {
            mockResolveFirebaseUserIDForGarminUserID.mockResolvedValue(null);

            await insertGarminAPIActivityFileToQueue(req, res);

            expect(addToQueueForGarmin).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('should return 500 when Firebase uid resolution fails', async () => {
            mockResolveFirebaseUserIDForGarminUserID.mockRejectedValue(new Error('Firestore unavailable'));

            await insertGarminAPIActivityFileToQueue(req, res);

            expect(addToQueueForGarmin).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(500);
        });

        it('should cap concurrent Garmin queue inserts at 10', async () => {
            req.body.activityFiles = Array.from({ length: 25 }, (_, index) => ({
                userId: 'garmin-user-id',
                userAccessToken: 'garmin-access-token',
                fileType: 'FIT',
                callbackURL: `https://callback?id=${index}&token=token-${index}`,
                startTimeInSeconds: 1000 + index,
                manual: false,
            }));
            let active = 0;
            let maxActive = 0;
            vi.mocked(addToQueueForGarmin).mockImplementation(async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 5));
                active -= 1;
                return { id: 'queued-doc' } as admin.firestore.DocumentReference;
            });

            await insertGarminAPIActivityFileToQueue(req, res);

            expect(mockResolveFirebaseUserIDForGarminUserID).toHaveBeenCalledTimes(1);
            expect(addToQueueForGarmin).toHaveBeenCalledTimes(25);
            expect(maxActive).toBeLessThanOrEqual(10);
            expect(res.status).toHaveBeenCalledWith(200);
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

            mockSetEvent.mockResolvedValue({
                eventID: 'saved-event-id',
                savedOriginalFiles: [{ path: 'users/firebase-user-id/events/saved-event-id/original.fit' }],
            });
            mockDeferQueueItemForPendingDisconnect.mockResolvedValue('DEFERRED');
            mockIncreaseRetryCountForQueueItem.mockResolvedValue('RETRY_INCREMENTED');
            mockMarkQueueItemSkipped.mockResolvedValue('PROCESSED');
            mockMoveToDeadLetterQueue.mockResolvedValue('MOVED_TO_DLQ');
            vi.mocked(updateToProcessed).mockResolvedValue('PROCESSED' as any);
        });

        it('should successfully process a FIT file and use the correct Firebase User ID', async () => {
            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('PROCESSED');
            expect(mockCreateParsingOptions).toHaveBeenCalledTimes(1);
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
            expect(mockEnqueueActivitySyncJobsForImportedEvent).toHaveBeenCalledWith(expect.objectContaining({
                userID: firebaseUserID,
                eventID: 'saved-event-id',
                sourceServiceName: ServiceNames.GarminAPI,
                sourceActivityID: queueItem.activityFileID,
            }));
            expect(updateToProcessed).toHaveBeenCalledWith(queueItem, undefined);
        });

        it('defers without marking processed when token use is blocked by pending disconnect', async () => {
            const pendingDisconnectError = new Error('service disconnect is pending');
            pendingDisconnectError.name = 'TokenUseSkippedForPendingDisconnectError';
            vi.mocked(getTokenData).mockRejectedValueOnce(pendingDisconnectError);

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('DEFERRED');
            expect(mockDeferQueueItemForPendingDisconnect).toHaveBeenCalledWith(queueItem, undefined);
            expect(mockMarkQueueItemSkipped).not.toHaveBeenCalledWith(
                queueItem,
                undefined,
                'service_disconnect_pending',
                expect.any(Object),
            );
            expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
            expect(updateToProcessed).not.toHaveBeenCalled();
        });

        it('should not enqueue activity sync when processing with bulkWriter', async () => {
            const bulkWriter = { set: vi.fn(), update: vi.fn(), delete: vi.fn() } as any;

            const result = await processGarminAPIActivityQueueItem(queueItem, bulkWriter);

            expect(result).toBe('PROCESSED');
            expect(mockEnqueueActivitySyncJobsForImportedEvent).not.toHaveBeenCalled();
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
            expect(mockCreateParsingOptions).toHaveBeenCalledTimes(1);
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
            expect(mockCreateParsingOptions).toHaveBeenCalledTimes(2);
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
            expect(mockCreateParsingOptions).toHaveBeenCalledTimes(1);
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

        it('should skip without retrying or writing when token owner is being deleted before token refresh', async () => {
            mockShouldSkipQueueWorkForDeletedUser.mockResolvedValueOnce(true);

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('PROCESSED');
            expect(getTokenData).not.toHaveBeenCalled();
            expect(mockRequestGet).not.toHaveBeenCalled();
            expect(mockSetEvent).not.toHaveBeenCalled();
            expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
            expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
            expect(mockUpdateToProcessed).not.toHaveBeenCalled();
            expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
                queueItem,
                undefined,
                'user_deleted_or_deleting',
                { skippedContext: 'USER_DELETION_GUARD' },
            );
        });

        it('should skip without retrying when token refresh reports account deletion', async () => {
            vi.mocked(getTokenData).mockRejectedValue(new TokenRefreshSkippedForDeletedUserError());

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('PROCESSED');
            expect(mockRequestGet).not.toHaveBeenCalled();
            expect(mockSetEvent).not.toHaveBeenCalled();
            expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
            expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
            expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
                queueItem,
                undefined,
                'user_deleted_or_deleting',
                { skippedContext: 'USER_DELETION_GUARD' },
            );
        });

        it('should skip without retrying when account deletion starts before event write', async () => {
            mockShouldSkipQueueWorkForDeletedUser
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true);

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('PROCESSED');
            expect(getTokenData).toHaveBeenCalled();
            expect(mockRequestGet).toHaveBeenCalled();
            expect(mockSetEvent).not.toHaveBeenCalled();
            expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
            expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
            expect(mockUpdateToProcessed).not.toHaveBeenCalled();
            expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
                queueItem,
                undefined,
                'user_deleted_or_deleting',
                { skippedContext: 'USER_DELETION_GUARD' },
            );
        });

        it('should skip without retrying when setEvent detects account deletion mid-write', async () => {
            mockShouldSkipQueueWorkForDeletedUser
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(false);
            mockSetEvent.mockRejectedValueOnce(
                new EventWriteSkippedForDeletedUserError(firebaseUserID, 'event_writer:users/firebase-user-id/events/event-id'),
            );

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('PROCESSED');
            expect(mockRequestGet).toHaveBeenCalled();
            expect(mockSetEvent).toHaveBeenCalled();
            expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
            expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
            expect(mockUpdateToProcessed).not.toHaveBeenCalled();
            expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
                queueItem,
                undefined,
                'user_deleted_or_deleting',
                { skippedContext: 'USER_DELETION_GUARD' },
            );
        });

        it('should retry when the deletion guard read fails before activity sync enqueue', async () => {
            mockShouldSkipQueueWorkForDeletedUser
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(false)
                .mockRejectedValueOnce(new Error('deletion guard unavailable'));

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockSetEvent).toHaveBeenCalled();
            expect(mockEnqueueActivitySyncJobsForImportedEvent).not.toHaveBeenCalled();
            expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
                queueItem,
                expect.any(Error),
                1,
                undefined,
            );
            expect(mockMarkQueueItemSkipped).not.toHaveBeenCalled();
            expect(mockUpdateToProcessed).not.toHaveBeenCalled();
        });

        it('should move to DLQ without retrying when getTokenData returns terminal auth', async () => {
            vi.mocked(getTokenData).mockRejectedValue(new TerminalServiceAuthError(
                ServiceNames.GarminAPI,
                firebaseUserID,
                'garmin-user-id',
                400,
                'invalid_grant',
                'refresh token revoked',
                new Error('400 invalid_grant'),
            ));

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('MOVED_TO_DLQ');
            expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
                queueItem,
                expect.objectContaining({
                    name: 'TerminalServiceAuthError',
                    dlqContext: 'INVALID_GRANT',
                }),
                undefined,
                'INVALID_GRANT',
            );
            expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
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

        it('should handle 410 Gone error by moving to DLQ', async () => {
            mockRequestGet.mockRejectedValue({ statusCode: 410 });

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('MOVED_TO_DLQ');
            expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
                queueItem,
                expect.any(Object),
                undefined,
                'RESOURCE_GONE'
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

        it('should handle uploadDebugFile failure gracefully and still increment retry count', async () => {
            mockSetEvent.mockRejectedValue(new Error('Parsing error'));
            mockUploadDebugFile.mockRejectedValue(new Error('Upload failed'));

            const result = await processGarminAPIActivityQueueItem(queueItem);

            expect(result).toBe('RETRY_INCREMENTED');
            expect(mockUploadDebugFile).toHaveBeenCalled();
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
