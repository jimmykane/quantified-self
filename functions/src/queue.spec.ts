import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { getExpireAtTimestamp, TTL_CONFIG } from './shared/ttl-config';
import { MAX_PENDING_TASKS, DISPATCH_SPREAD_SECONDS } from './shared/queue-config';
import { ServiceNames, ActivityParsingOptions, EventImporterFIT, COROSAPIEventMetaData, SuuntoAppEventMetaData } from '@sports-alliance/sports-lib';

// Mock firebase-functions first (needed by auth modules at load time)
vi.mock('firebase-functions', () => ({
    config: () => ({
        suuntoapp: {
            client_id: 'test-suunto-client-id',
            client_secret: 'test-suunto-client-secret',
            subscription_key: 'test-suunto-subscription-key',
        },
        corosapi: {
            client_id: 'test-coros-client-id',
            client_secret: 'test-coros-client-secret',
        },
        garminhealth: {
            consumer_key: 'test-garmin-consumer-key',
            consumer_secret: 'test-garmin-consumer-secret',
        },
    }),
    region: () => ({
        https: { onRequest: () => { } },
        runWith: () => ({
            https: { onRequest: () => { } },
            pubsub: { schedule: () => ({ onRun: () => { } }) },
        }),
    }),
}));

const { mockDocRef, mockBatch, mockDocSnapshot, mockCollection, mockRecursiveDelete, mockShouldSkipQueueWorkForDeletedUser, mockGetUserDeletionGuardState, mockGetUserDeletionGuardStateInTransaction, mockRunTransaction, mockMarkQueueItemDeletedForUserCleanup } = vi.hoisted(() => {
    const docRef = {
        update: vi.fn(() => Promise.resolve()),
        set: vi.fn(() => Promise.resolve()),
        create: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
        id: 'mock-doc-id',
        get: vi.fn(() => Promise.resolve({
            exists: true,
            data: () => ({
                id: 'user1-work1',
                dateCreated: 123456,
                processed: false,
                retryCount: 0,
                dispatchedToCloudTask: null,
            }),
        })),
        parent: {
            id: 'tokens',
            parent: { id: 'mock-user-id' }
        }
    };

    const docSnapshot = {
        id: 'mock-doc-id',
        ref: docRef,
        data: vi.fn(() => ({})),
    };

    const batch = {
        set: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined)
    };

    const collection: any = {
        doc: vi.fn(() => docRef),
        get: vi.fn(() => Promise.resolve({
            docs: [docSnapshot],
            size: 1,
        })),
        where: vi.fn().mockImplementation(function (this: any) { return this; }),
        limit: vi.fn().mockImplementation(function (this: any) { return this; }),
        orderBy: vi.fn().mockImplementation(function (this: any) { return this; }),
    };

    return {
        mockDocRef: docRef,
        mockBatch: batch,
        mockDocSnapshot: docSnapshot,
        mockCollection: collection,
        mockRecursiveDelete: vi.fn().mockResolvedValue(undefined),
        mockShouldSkipQueueWorkForDeletedUser: vi.fn().mockResolvedValue(false),
        mockGetUserDeletionGuardState: vi.fn().mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        }),
        mockGetUserDeletionGuardStateInTransaction: vi.fn().mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        }),
        mockRunTransaction: vi.fn(async (runner: (transaction: { update: (ref: { update?: (data: unknown) => Promise<void> }, data: unknown) => Promise<void> | void }) => unknown) => runner({
            update: (ref, data) => ref.update?.(data),
        })),
        mockMarkQueueItemDeletedForUserCleanup: vi.fn().mockResolvedValue(true),
    };
});

// Mock firebase-admin before importing modules that use it
vi.mock('firebase-admin', () => {
    const mockFirestore = {
        collection: vi.fn(() => mockCollection),
        collectionGroup: vi.fn(() => mockCollection),
        batch: vi.fn(() => mockBatch),
        runTransaction: mockRunTransaction,
        recursiveDelete: mockRecursiveDelete,
        bulkWriter: vi.fn(() => ({
            update: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            close: vi.fn().mockResolvedValue(undefined),
        })),
    };

    const mockFirestoreFn: any = vi.fn(() => mockFirestore);
    mockFirestoreFn.Timestamp = {
        fromDate: vi.fn((date) => date),
    };

    return {
        default: {
            firestore: mockFirestoreFn,
            initializeApp: vi.fn(),
            credential: { cert: vi.fn() },
        },
        firestore: mockFirestoreFn,
    };
});

// Mock the request-helper module (used by getWorkoutForService)
vi.mock('./request-helper', () => {
    const mock: any = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.get = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.post = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.put = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.delete = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    return mock;
});

// Mock the history module
vi.mock('./history', () => ({
    getServiceWorkoutQueueName: vi.fn((serviceName: ServiceNames, fromHistory = false) => {
        const baseName = `${serviceName}WorkoutQueue`;
        return fromHistory ? `${baseName}History` : baseName;
    }),
}));

// Mock request-helper (used by queue.ts)
vi.mock('./request-helper', () => {
    const mock: any = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.get = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.post = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.put = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    mock.delete = vi.fn().mockResolvedValue(Buffer.from('test-fit-data'));
    return {
        __esModule: true,
        default: mock,
        ...mock
    };
});

// Mock utils
vi.mock('./utils', () => ({
    generateIDFromParts: vi.fn((parts) => parts.join('-')),
    setEvent: vi.fn(),
    UsageLimitExceededError: class extends Error { },
    EventWriteSkippedForDeletedUserError: class EventWriteSkippedForDeletedUserError extends Error {
        readonly name = 'EventWriteSkippedForDeletedUserError';

        constructor(
            public readonly userID = 'mock-user-id',
            public readonly phase = 'event_write_start',
        ) {
            super(`Skipping event write for user ${userID}`);
        }
    },
    UserNotFoundError: class extends Error { },
    enqueueWorkoutTask: vi.fn(),
    getCloudTaskQueueDepth: vi.fn().mockResolvedValue(0),
    generateEventID: vi.fn().mockResolvedValue('standardized-event-id'),
}));

import * as utils from './utils';
import requestHelper from './request-helper';

vi.mock('./tokens', () => {
    class MockTerminalServiceAuthError extends Error {
        readonly name = 'TerminalServiceAuthError';
        readonly dlqContext: 'INVALID_GRANT' | 'AUTH_RECONNECT_REQUIRED';

        constructor(
            public readonly serviceName: ServiceNames,
            public readonly firebaseUserID: string | null,
            public readonly providerUserId: string,
            public readonly statusCode: number | null,
            public readonly providerErrorCode: string | null,
            public readonly providerErrorMessage: string | null,
            public readonly originalError: unknown,
        ) {
            super(`${serviceName} connection requires reconnect`);
            const errorHint = `${providerErrorCode || ''} ${providerErrorMessage || ''}`.toLowerCase();
            this.dlqContext = errorHint.includes('invalid_grant')
                ? 'INVALID_GRANT'
                : 'AUTH_RECONNECT_REQUIRED';
        }
    }

    return {
        getTokenData: vi.fn().mockResolvedValue({
            accessToken: 'mock-access-token',
            userName: 'mock-user',
            openId: 'mock-openid'
        }),
        TerminalServiceAuthError: MockTerminalServiceAuthError,
        TokenRefreshSkippedForDeletedUserError: class TokenRefreshSkippedForDeletedUserError extends Error {
            readonly name = 'TokenRefreshSkippedForDeletedUserError';
        },
    };
});

vi.mock('./queue/user-deletion-skip', () => ({
    shouldSkipQueueWorkForDeletedUser: mockShouldSkipQueueWorkForDeletedUser,
}));

vi.mock('./shared/user-deletion-guard', () => {
    class MockUserDeletionGuardReadError extends Error {
        readonly name = 'UserDeletionGuardReadError';
        readonly code = 'unavailable';
        readonly statusCode = 503;

        constructor(
            public readonly uid: string,
            public readonly phase: string,
            public readonly originalError: unknown,
        ) {
            super(`Could not read deletion guard for user ${uid} during ${phase}.`);
        }
    }

    return {
        getUserDeletionGuardState: mockGetUserDeletionGuardState,
        getUserDeletionGuardStateInTransaction: mockGetUserDeletionGuardStateInTransaction,
        UserDeletionGuardReadError: MockUserDeletionGuardReadError,
    };
});

vi.mock('./queue/cleanup-tombstone', () => ({
    markQueueItemDeletedForUserCleanup: mockMarkQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS: {
        AccountDeletionCleanup: 'account_deletion_cleanup',
        ServiceDisconnectCleanup: 'service_disconnect_cleanup',
        DispatcherCleanup: 'dispatcher_cleanup',
        UserDeletionGuard: 'user_deletion_guard',
    },
}));

vi.mock('./garmin/queue', () => ({
    processGarminAPIActivityQueueItem: vi.fn().mockResolvedValue('PROCESSED'),
}));

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => {
    const original: any = await importOriginal();
    return {
        ...original,
        EventImporterFIT: {
            getFromArrayBuffer: vi.fn().mockResolvedValue({
                setID: vi.fn(),
                getID: () => 'mock-fit-event-id',
                startDate: new Date('2026-01-14T10:00:00.000Z'),
            }),
        },
        COROSAPIEventMetaData: class {
            constructor() { }
            toJSON() { return {}; }
        },
        SuuntoAppEventMetaData: class {
            constructor() { }
            toJSON() { return {}; }
        },
        ActivityParsingOptions: class {
            constructor() { }
        },
    };
});

// Import after mocks are set up
import {
    addToQueueForSuunto,
    addToQueueForGarmin,
    addToQueueForCOROS,
    parseWorkoutQueueItemForServiceName,
    ProviderQueueUserDeletedOrDeletingError,
    ProviderQueueUserNotConnectedError,
} from './queue';
import { QueueItemInterface, SuuntoAppWorkoutQueueItemInterface, COROSAPIWorkoutQueueItemInterface } from './queue/queue-item.interface';
import { getTokenData, TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from './tokens';
import { processGarminAPIActivityQueueItem } from './garmin/queue';
import { QUEUE_SKIPPED_REASONS, QueueResult, increaseRetryCountForQueueItem, updateToProcessed, moveToDeadLetterQueue } from './queue-utils';

describe('queue', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        mockDocRef.update.mockResolvedValue(undefined);
        mockDocRef.set.mockResolvedValue(undefined);
        mockDocRef.create.mockResolvedValue(undefined);
        mockDocRef.delete.mockResolvedValue(undefined);
        mockDocRef.get.mockResolvedValue({
            exists: true,
            data: () => ({
                id: 'user1-work1',
                dateCreated: 123456,
                processed: false,
                retryCount: 0,
                dispatchedToCloudTask: null,
            }),
        });
        vi.mocked(utils.enqueueWorkoutTask).mockResolvedValue(true);
        mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
        mockGetUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        mockMarkQueueItemDeletedForUserCleanup.mockResolvedValue(true);
        mockRunTransaction.mockImplementation(async (runner: (transaction: { update: (ref: { update?: (data: unknown) => Promise<void> }, data: unknown) => Promise<void> | void }) => unknown) => runner({
            update: (ref, data) => ref.update?.(data),
        }));
        mockRecursiveDelete.mockResolvedValue(undefined);
        const admin = await import('firebase-admin');
        const mockCollection = admin.firestore().collectionGroup('tokens') as any;
        mockCollection.get.mockResolvedValue({
            docs: [
                {
                    id: 'mock-doc-id',
                    ref: {
                        id: 'mock-doc-id',
                        parent: {
                            id: 'tokens',
                            parent: { id: 'mock-user-id' }
                        }
                    },
                    data: vi.fn(() => ({})),
                }
            ],
            size: 1,
        });
    });

    describe('increaseRetryCountForQueueItem', () => {
        it('should increment retryCount by 1 by default', async () => {
            const mockRef = {
                update: vi.fn(() => Promise.resolve()),
            };

            const queueItem: QueueItemInterface = {
                id: 'test-item-1',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Test error'));

            expect(queueItem.retryCount).toBe(1);
            expect(queueItem.totalRetryCount).toBe(1);
            expect(queueItem.errors).toHaveLength(1);
            expect(queueItem.errors![0].error).toBe('Test error');
        });

        it('should move to DLQ if max retries reached', async () => {
            const admin = await import('firebase-admin');
            const firestore = admin.firestore();
            const batch = firestore.batch();

            const mockRef = {
                update: vi.fn(() => Promise.resolve()),
                delete: vi.fn(() => Promise.resolve()),
                parent: { id: 'original-col' }
            };

            const queueItem: QueueItemInterface = {
                id: 'test-item-2',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            // 10 is max retry count
            await increaseRetryCountForQueueItem(queueItem, new Error('Big error'), 10);

            // Should NOT verify update on original ref
            expect(mockRef.update).not.toHaveBeenCalled();

            // Should verify batch delete and set (DLQ logic)
            expect(batch.delete).toHaveBeenCalledWith(mockRef);
            expect(batch.set).toHaveBeenCalled();
            expect(batch.commit).toHaveBeenCalled();
        });

        it('should accumulate errors', async () => {
            const mockRef = {
                update: vi.fn(() => Promise.resolve()),
            };

            const queueItem: QueueItemInterface = {
                id: 'test-item-3',
                ref: mockRef as any,
                retryCount: 1,
                totalRetryCount: 1,
                errors: [{ error: 'Previous error', atRetryCount: 1, date: Date.now() - 1000 }],
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('New error'));

            expect(queueItem.errors).toHaveLength(2);
            expect(queueItem.errors![1].error).toBe('New error');
        });

        it('should throw if no ref is provided', async () => {
            const queueItem: QueueItemInterface = {
                id: 'test-item-4',
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            await expect(
                increaseRetryCountForQueueItem(queueItem, new Error('Test'))
            ).rejects.toThrow('No document reference supplied');
        });

        it('should call ref.update with serialized queue item', async () => {
            const mockUpdate = vi.fn(() => Promise.resolve());
            const mockRef = { update: mockUpdate };

            const queueItem: QueueItemInterface = {
                id: 'test-item-5',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Test'));

            expect(mockUpdate).toHaveBeenCalled();
            const updateArg = (mockUpdate.mock.calls[0] as any[])[0];
            expect(updateArg.retryCount).toBe(1);
            expect(updateArg.dispatchedToCloudTask).toBeNull();
            expect(updateArg.ref).toBeUndefined(); // ref should be stripped
        });
    });

    describe('updateToProcessed', () => {
        it('should set processed to true', async () => {
            const mockUpdate = vi.fn(() => Promise.resolve());
            const mockRef = { update: mockUpdate };

            const queueItem: QueueItemInterface = {
                id: 'test-item-1',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            await updateToProcessed(queueItem);

            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    processed: true,
                    processedAt: expect.any(Number),
                })
            );
        });

        it('should throw if no ref is provided', async () => {
            const queueItem: QueueItemInterface = {
                id: 'test-item-2',
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            await expect(
                updateToProcessed(queueItem)
            ).rejects.toThrow('No document reference supplied');
        });
    });

    describe('moveToDeadLetterQueue', () => {
        it('should move queue item to failed_jobs collection', async () => {
            const admin = await import('firebase-admin');
            const firestore = admin.firestore();
            const batch = firestore.batch();

            const mockRef = {
                parent: { id: 'original-col' },
                update: vi.fn(),
                delete: vi.fn(),
                id: 'ref-id'
            };

            const queueItem: QueueItemInterface = {
                id: 'test-item-dlq',
                ref: mockRef as any,
                retryCount: 9,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            await moveToDeadLetterQueue(queueItem, new Error('Fatal error'));



            // Verify explicit expiration date calculation
            const calledArg = (batch.set as any).mock.calls[0][1];
            // Allow small delta for execution time difference if not mocking system time
            const expectedExpiry = Date.now() + TTL_CONFIG.QUEUE_ITEM_IN_DAYS * 24 * 60 * 60 * 1000;
            // The mock Timestamp implementation returns the date object directly in toDate or we can check logic
            // Since we mocked firestore.Timestamp.fromDate to return the date, we can check basic validity
            // But here we just want to ensure it IS the timestamp we expect.
            // Let's refine the expectation to be strictly about the call structure we refactored to.
            expect(batch.set).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({
                    expireAt: expect.anything() // We trust getExpireAtTimestamp unit test for the value
                })
            );
            expect(batch.delete).toHaveBeenCalledWith(mockRef);
            expect(batch.commit).toHaveBeenCalled();
        });
    });

    describe('dispatchQueueItemTasks', () => {
        it('should skip dispatch if queue is full', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(MAX_PENDING_TASKS); // Max pending
            const { dispatchQueueItemTasks } = await import('./queue');

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);

            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('should dispatch available slots when queue is partially full', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(MAX_PENDING_TASKS - 2); // 2 slots available
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            // Mock query results
            const mockDoc1 = { id: 'doc1', ref: { update: vi.fn(), parent: { id: 'col' }, id: 'doc1' }, data: () => ({ dateCreated: Date.now(), firebaseUserID: 'firebase-doc1', userID: 'garmin-doc1' }) };
            const mockDoc2 = { id: 'doc2', ref: { update: vi.fn(), parent: { id: 'col' }, id: 'doc2' }, data: () => ({ dateCreated: Date.now(), firebaseUserID: 'firebase-doc2', userID: 'garmin-doc2' }) };

            const firestore = admin.firestore();
            const collection = firestore.collection('any');
            // We need to spy on the chain: collection -> where -> where -> where -> limit -> get
            // The global mock implementation of `limit` returns `mockCollection`, and `get` returns docs.
            // We can override the return value of `get`
            vi.mocked(collection.get).mockResolvedValue({
                docs: [mockDoc1, mockDoc2] as any,
                size: 2,
                empty: false,
                query: {} as any,
                forEach: vi.fn(),
                docChanges: vi.fn(),
                readTime: {} as any,
                isEqual: vi.fn(),
            });

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);

            expect(utils.getCloudTaskQueueDepth).toHaveBeenCalledWith(true);
            // Verify limit was called with batch size
            expect(collection.limit).toHaveBeenCalledWith(2);

            // Verify enqueue called for both
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledTimes(2);
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.GarminAPI, 'doc1', expect.any(Number), expect.any(Number), { recoveryTaskKey: 0 });
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.GarminAPI, 'doc2', expect.any(Number), expect.any(Number), { recoveryTaskKey: 0 });

            // Verify dispatchedToCloudTask update
            expect(mockDoc1.ref.update).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
            expect(mockDoc2.ref.update).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('should apply staggered delay to dispatched tasks', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            const mockDocs = [
                { id: '1', ref: { update: vi.fn() }, data: () => ({ dateCreated: Date.now(), firebaseUserID: 'firebase-1', userID: 'garmin-1' }) },
                { id: '2', ref: { update: vi.fn() }, data: () => ({ dateCreated: Date.now(), firebaseUserID: 'firebase-2', userID: 'garmin-2' }) },
                { id: '3', ref: { update: vi.fn() }, data: () => ({ dateCreated: Date.now(), firebaseUserID: 'firebase-3', userID: 'garmin-3' }) }
            ];

            const firestore = admin.firestore();
            const delayPerItem = Math.floor(DISPATCH_SPREAD_SECONDS / mockDocs.length);

            vi.mocked(firestore.collection('any').get).mockResolvedValue({
                docs: mockDocs as any,
                size: 3,
                empty: false,
                isEqual: vi.fn(), // Fix TS error
            } as any);

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);

            expect(utils.getCloudTaskQueueDepth).toHaveBeenCalledWith(true);
            // Expected spread: Total 1800s. Size 3. Delay per item = 600s.
            // Items: 0, 600, 1200
            expect(utils.enqueueWorkoutTask).toHaveBeenNthCalledWith(1, ServiceNames.GarminAPI, '1', expect.any(Number), 0, { recoveryTaskKey: 0 });
            expect(utils.enqueueWorkoutTask).toHaveBeenNthCalledWith(2, ServiceNames.GarminAPI, '2', expect.any(Number), delayPerItem, { recoveryTaskKey: 0 });
            expect(utils.enqueueWorkoutTask).toHaveBeenNthCalledWith(3, ServiceNames.GarminAPI, '3', expect.any(Number), delayPerItem * 2, { recoveryTaskKey: 0 });
        });

        it('should delete user-owned queue docs instead of dispatching when account deletion is active', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            mockGetUserDeletionGuardState.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            const updateDeleted = vi.fn().mockResolvedValue(undefined);
            const deletedRef = { update: updateDeleted, path: 'suuntoAppWorkoutQueue/deleted-doc' };
            const mockDoc = {
                id: 'deleted-doc',
                ref: deletedRef,
                data: () => ({
                    dateCreated: Date.now(),
                    firebaseUserID: 'deleted-user-id',
                    userName: 'suunto-provider-user',
                    dispatchedToCloudTask: null,
                }),
            };

            vi.mocked(admin.firestore().collection('any').get).mockResolvedValue({
                docs: [mockDoc] as any,
                size: 1,
                empty: false,
                isEqual: vi.fn(),
            } as any);

            await dispatchQueueItemTasks(ServiceNames.SuuntoApp);

            expect(mockGetUserDeletionGuardState).toHaveBeenCalledWith(expect.anything(), 'deleted-user-id');
            expect(mockRecursiveDelete).toHaveBeenCalledWith(deletedRef);
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
            expect(updateDeleted).not.toHaveBeenCalled();
        });

        it('should delete malformed queue docs without Firebase or provider user ids before dispatch', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            const updateMalformed = vi.fn().mockResolvedValue(undefined);
            const malformedRef = { update: updateMalformed, path: 'suuntoAppWorkoutQueue/malformed-doc' };
            const mockDoc = {
                id: 'malformed-doc',
                ref: malformedRef,
                data: () => ({
                    dateCreated: Date.now(),
                    dispatchedToCloudTask: null,
                }),
            };

            vi.mocked(admin.firestore().collection('any').get).mockResolvedValue({
                docs: [mockDoc] as any,
                size: 1,
                empty: false,
                isEqual: vi.fn(),
            } as any);

            await dispatchQueueItemTasks(ServiceNames.SuuntoApp);

            expect(mockGetUserDeletionGuardState).not.toHaveBeenCalled();
            expect(mockRecursiveDelete).toHaveBeenCalledWith(malformedRef);
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
            expect(updateMalformed).not.toHaveBeenCalled();
        });

        it('should resolve legacy provider-keyed queue docs before dispatch and delete them when the resolved user is deleting', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            mockGetUserDeletionGuardState.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });
            const { dispatchQueueItemTasks } = await import('./queue');

            const updateDeleted = vi.fn().mockResolvedValue(undefined);
            const legacyRef = { update: updateDeleted, path: 'suuntoAppWorkoutQueue/legacy-provider-doc' };
            const legacyDoc = {
                id: 'legacy-provider-doc',
                ref: legacyRef,
                data: () => ({
                    dateCreated: Date.now(),
                    userName: 'legacy-suunto-provider-user',
                    dispatchedToCloudTask: null,
                }),
            };
            const resolvedTokenDoc = {
                id: 'token-1',
                ref: {
                    parent: {
                        parent: { id: 'resolved-deleting-user-id' },
                    },
                },
            };
            mockCollection.get
                .mockResolvedValueOnce({
                    docs: [legacyDoc] as any,
                    size: 1,
                    empty: false,
                    isEqual: vi.fn(),
                } as any)
                .mockResolvedValueOnce({
                    docs: [resolvedTokenDoc] as any,
                    size: 1,
                    empty: false,
                    isEqual: vi.fn(),
                } as any);

            await dispatchQueueItemTasks(ServiceNames.SuuntoApp);

            expect(mockGetUserDeletionGuardState).toHaveBeenCalledWith(expect.anything(), 'resolved-deleting-user-id');
            expect(mockRecursiveDelete).toHaveBeenCalledWith(legacyRef);
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
            expect(updateDeleted).not.toHaveBeenCalled();
        });

        it('should delete legacy provider-keyed queue docs instead of dispatching when no local token resolves', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            const { dispatchQueueItemTasks } = await import('./queue');

            const updateOrphan = vi.fn().mockResolvedValue(undefined);
            const orphanRef = { update: updateOrphan, path: 'suuntoAppWorkoutQueue/orphan-provider-doc' };
            const orphanDoc = {
                id: 'orphan-provider-doc',
                ref: orphanRef,
                data: () => ({
                    dateCreated: Date.now(),
                    userName: 'orphan-suunto-provider-user',
                    dispatchedToCloudTask: null,
                }),
            };
            mockCollection.get
                .mockResolvedValueOnce({
                    docs: [orphanDoc] as any,
                    size: 1,
                    empty: false,
                    isEqual: vi.fn(),
                } as any)
                .mockResolvedValueOnce({
                    docs: [],
                    size: 0,
                    empty: true,
                    isEqual: vi.fn(),
                } as any);

            await dispatchQueueItemTasks(ServiceNames.SuuntoApp);

            expect(mockGetUserDeletionGuardState).not.toHaveBeenCalled();
            expect(mockRecursiveDelete).toHaveBeenCalledWith(orphanRef);
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
            expect(updateOrphan).not.toHaveBeenCalled();
        });

        it('should leave dispatch marker untouched when deletion guard lookup fails and continue other queue docs', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            mockGetUserDeletionGuardState
                .mockRejectedValueOnce(new Error('guard unavailable'))
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                });
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            const updateGuardFailure = vi.fn().mockResolvedValue(undefined);
            const updateHealthy = vi.fn().mockResolvedValue(undefined);
            const mockDocs = [
                {
                    id: 'guard-failure-doc',
                    ref: { update: updateGuardFailure, path: 'suuntoAppWorkoutQueue/guard-failure-doc' },
                    data: () => ({
                        dateCreated: Date.now(),
                        firebaseUserID: 'guard-failure-user',
                        userName: 'suunto-provider-user-1',
                    }),
                },
                {
                    id: 'healthy-doc',
                    ref: { update: updateHealthy, path: 'suuntoAppWorkoutQueue/healthy-doc' },
                    data: () => ({
                        dateCreated: Date.now(),
                        firebaseUserID: 'healthy-user',
                        userName: 'suunto-provider-user-2',
                    }),
                },
            ];

            vi.mocked(admin.firestore().collection('any').get).mockResolvedValue({
                docs: mockDocs as any,
                size: 2,
                empty: false,
                isEqual: vi.fn(),
            } as any);

            await dispatchQueueItemTasks(ServiceNames.SuuntoApp);

            expect(utils.enqueueWorkoutTask).toHaveBeenCalledTimes(1);
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.SuuntoApp, 'healthy-doc', expect.any(Number), expect.any(Number), { recoveryTaskKey: 0 });
            expect(updateGuardFailure).not.toHaveBeenCalled();
            expect(updateHealthy).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('should not write the dispatch marker when deletion starts after Cloud Task enqueue', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                });
            mockGetUserDeletionGuardStateInTransaction
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            const updateRaced = vi.fn().mockResolvedValue(undefined);
            const racedRef = { update: updateRaced, path: 'suuntoAppWorkoutQueue/raced-doc', parent: { id: 'suuntoAppWorkoutQueue' } };
            vi.mocked(admin.firestore().collection('any').get).mockResolvedValue({
                docs: [{
                    id: 'raced-doc',
                    ref: racedRef,
                    data: () => ({
                        dateCreated: Date.now(),
                        firebaseUserID: 'raced-user',
                        userName: 'suunto-provider-user-raced',
                    }),
                }] as any,
                size: 1,
                empty: false,
                isEqual: vi.fn(),
            } as any);

            await dispatchQueueItemTasks(ServiceNames.SuuntoApp);

            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.SuuntoApp, 'raced-doc', expect.any(Number), 0, { recoveryTaskKey: 0 });
            expect(mockRecursiveDelete).toHaveBeenCalledWith(racedRef);
            expect(updateRaced).not.toHaveBeenCalled();
        });

        it('should treat missing dispatch marker docs as success when scheduled dispatch races with DLQ move', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            const notFoundError: any = new Error('No document to update');
            notFoundError.code = 5;
            const mockDoc = {
                id: 'doc-moved-to-dlq',
                ref: { update: vi.fn().mockRejectedValueOnce(notFoundError) },
                data: () => ({ dateCreated: Date.now(), firebaseUserID: 'firebase-dlq', userName: 'suunto-provider-dlq' }),
            };

            const firestore = admin.firestore();
            vi.mocked(firestore.collection('any').get).mockResolvedValue({
                docs: [mockDoc] as any,
                size: 1,
                empty: false,
                isEqual: vi.fn(),
            } as any);
            mockDocRef.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    originalCollection: 'suuntoAppWorkoutQueue',
                }),
            });

            await dispatchQueueItemTasks(ServiceNames.SuuntoApp);

            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.SuuntoApp, 'doc-moved-to-dlq', expect.any(Number), 0, { recoveryTaskKey: 0 });
            expect(mockDoc.ref.update).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
            expect(mockDocRef.get).toHaveBeenCalled();
        });

        it('should do nothing if no items found', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            const firestore = admin.firestore();
            vi.mocked(firestore.collection('any').get).mockResolvedValue({
                docs: [],
                size: 0,
                empty: true,
                isEqual: vi.fn(), // Fix TS error
            } as any);

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);

            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('leaves the item undispatched when Cloud Tasks reports ALREADY_EXISTS so a later scheduler pass can retry', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.getCloudTaskQueueDepth).mockResolvedValue(0);
            vi.mocked(utils.enqueueWorkoutTask).mockResolvedValue(false);
            const { dispatchQueueItemTasks } = await import('./queue');
            const admin = await import('firebase-admin');

            let persistedDispatchedAt: number | null = null;

            const mockDoc = {
                id: 'stuck-doc',
                ref: {
                    update: vi.fn(async ({ dispatchedToCloudTask }: { dispatchedToCloudTask: number }) => {
                        persistedDispatchedAt = dispatchedToCloudTask;
                    }),
                    parent: { id: 'col' },
                    id: 'stuck-doc',
                },
                data: () => ({ dateCreated: Date.now(), dispatchedToCloudTask: persistedDispatchedAt, firebaseUserID: 'firebase-stuck', userID: 'garmin-stuck' }),
            };

            const firestore = admin.firestore();
            vi.mocked(firestore.collection('any').get).mockImplementation(async () => {
                return {
                    docs: [mockDoc] as any,
                    size: 1,
                    empty: false,
                    isEqual: vi.fn(),
                } as any;
            });

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledTimes(1);
            expect(mockDoc.ref.update).not.toHaveBeenCalled();
            expect(persistedDispatchedAt).toBeNull();

            await dispatchQueueItemTasks(ServiceNames.GarminAPI);
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledTimes(2);
        });
    });

    describe('addToQueue deferred dispatch', () => {
        it('should defer dispatch for manual/bulk items', async () => {
            const utils = await import('./utils');
            // Reset mocks
            vi.mocked(utils.enqueueWorkoutTask).mockClear();

            const { addToQueueForGarmin } = await import('./queue');

            await addToQueueForGarmin({
                userID: 'u1',
                startTimeInSeconds: 123,
                manual: true, // DEFER
                activityFileID: 'f1',
                activityFileType: 'FIT',
                token: 't1',
                userAccessToken: 'at1',
                callbackURL: 'cb1'
            });

            // Should NOT call enqueue
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('should delete deferred queue docs when deletion starts after write', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.enqueueWorkoutTask).mockClear();
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            const { addToQueueForGarmin } = await import('./queue');

            await expect(addToQueueForGarmin({
                userID: 'u1',
                startTimeInSeconds: 123,
                manual: true,
                activityFileID: 'f1',
                activityFileType: 'FIT',
                token: 't1',
                userAccessToken: 'at1',
                callbackURL: 'cb1'
            })).rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

            expect(mockDocRef.set).toHaveBeenCalled();
            expect(mockRecursiveDelete).toHaveBeenCalledWith(mockDocRef);
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
            expect(mockDocRef.update).not.toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('should immediate dispatch for normal items', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.enqueueWorkoutTask).mockClear();

            const { addToQueueForGarmin } = await import('./queue');

            await addToQueueForGarmin({
                userID: 'u1',
                startTimeInSeconds: 123,
                manual: false, // IMMEDIATE
                activityFileID: 'f1',
                activityFileType: 'FIT',
                token: 't1',
                userAccessToken: 'at1',
                callbackURL: 'cb1'
            });

            // Should call enqueue
            expect(utils.enqueueWorkoutTask).toHaveBeenCalled();
        });

        it('should not write the immediate dispatch marker when Cloud Tasks reports ALREADY_EXISTS', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.enqueueWorkoutTask).mockResolvedValueOnce(false);

            const { addToQueueForGarmin } = await import('./queue');

            await addToQueueForGarmin({
                userID: 'u1',
                startTimeInSeconds: 123,
                manual: false,
                activityFileID: 'f1',
                activityFileType: 'FIT',
                token: 't1',
                userAccessToken: 'at1',
                callbackURL: 'cb1'
            });

            expect(utils.enqueueWorkoutTask).toHaveBeenCalled();
            expect(mockDocRef.update).not.toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('should not write the dispatch marker when deletion starts after immediate Cloud Task enqueue', async () => {
            const utils = await import('./utils');
            vi.mocked(utils.enqueueWorkoutTask).mockClear();
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                });
            mockGetUserDeletionGuardStateInTransaction
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            const { addToQueueForGarmin } = await import('./queue');

            await expect(addToQueueForGarmin({
                userID: 'u1',
                startTimeInSeconds: 123,
                manual: false,
                activityFileID: 'f1',
                activityFileType: 'FIT',
                token: 't1',
                userAccessToken: 'at1',
                callbackURL: 'cb1'
            })).rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

            expect(utils.enqueueWorkoutTask).toHaveBeenCalled();
            expect(mockRecursiveDelete).toHaveBeenCalledWith(mockDocRef);
            expect(mockDocRef.update).not.toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });
    });

    describe('increaseRetryCountForQueueItem - dispatchedToCloudTask reset', () => {
        it('should reset dispatchedToCloudTask to null when item had a timestamp', async () => {
            const mockUpdate = vi.fn(() => Promise.resolve());
            const mockRef = { update: mockUpdate };

            const queueItem: QueueItemInterface = {
                id: 'test-dispatch-reset',
                ref: mockRef as any,
                retryCount: 1,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: 1704067200000, // A timestamp value
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Transient failure'));

            expect(mockUpdate).toHaveBeenCalled();
            const updateArg = (mockUpdate.mock.calls[0] as any[])[0];

            // Critical: dispatchedToCloudTask must be null so dispatcher picks it up again
            expect(updateArg.dispatchedToCloudTask).toBeNull();
            expect(updateArg.retryCount).toBe(2);
        });

        it('should keep dispatchedToCloudTask as null if it was already null', async () => {
            const mockUpdate = vi.fn(() => Promise.resolve());
            const mockRef = { update: mockUpdate };

            const queueItem: QueueItemInterface = {
                id: 'test-dispatch-was-null',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            await increaseRetryCountForQueueItem(queueItem, new Error('Some error'));

            const updateArg = (mockUpdate.mock.calls[0] as any[])[0];
            expect(updateArg.dispatchedToCloudTask).toBeNull();
        });
    });

    describe('EVENT_EMPTY_ERROR handling', () => {
        it('should move to DLQ immediately when FIT file has no activities', async () => {
            // This test verifies the fix for empty FIT files going to DLQ immediately
            // instead of retrying 10 times

            const admin = await import('firebase-admin');
            const firestore = admin.firestore();
            const batch = firestore.batch();

            const mockRef = {
                parent: { id: 'suuntoAppWorkoutQueue' },
                update: vi.fn(),
                delete: vi.fn(),
                id: 'empty-fit-item'
            };

            const queueItem: QueueItemInterface = {
                id: 'empty-fit-item',
                ref: mockRef as any,
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            // Create an error with the EVENT_EMPTY_ERROR code
            const emptyEventError: any = new Error('No activities found');
            emptyEventError.code = 'EVENT_EMPTY_ERROR';

            // Call moveToDeadLetterQueue directly since parseWorkoutQueueItemForServiceName
            // requires complex token mocking
            const result = await moveToDeadLetterQueue(queueItem, emptyEventError, undefined, 'EVENT_EMPTY_ERROR');

            // Should have moved to DLQ
            expect(result).toBe('MOVED_TO_DLQ');
            expect(batch.set).toHaveBeenCalled();
            expect(batch.delete).toHaveBeenCalledWith(mockRef);

            // Verify the context is preserved
            const setCallArgs = (batch.set as any).mock.calls[0][1];
            expect(setCallArgs.context).toBe('EVENT_EMPTY_ERROR');
        });
    });

    describe('addToQueue functions', () => {
        it('addToQueueForSuunto should insert item with correct ID', async () => {
            const result = await addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' });
            expect(result.id).toBe('mock-doc-id');
            const admin = await import('firebase-admin');
            const doc = admin.firestore().collection('suuntoAppWorkoutQueue').doc('user1-work1');
            expect(doc.create).toHaveBeenCalledWith(expect.objectContaining({
                id: 'user1-work1',
                userName: 'user1',
                workoutID: 'work1',
                firebaseUserID: 'mock-user-id',
                dispatchedToCloudTask: null
            }));
            expect(doc.set).not.toHaveBeenCalled();
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.SuuntoApp, 'user1-work1', expect.any(Number), undefined, { recoveryTaskKey: 0 });
            expect(doc.update).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('addToQueueForSuunto should not create provider-only queue docs when no local token resolves', async () => {
            mockCollection.get.mockResolvedValueOnce({
                docs: [],
                size: 0,
            });

            await expect(addToQueueForSuunto({ userName: 'orphan-provider-user', workoutID: 'work1' }))
                .rejects.toBeInstanceOf(ProviderQueueUserNotConnectedError);

            expect(mockDocRef.create).not.toHaveBeenCalled();
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('addToQueueForSuunto should not create queue docs when the resolved Firebase user is being deleted', async () => {
            mockGetUserDeletionGuardState.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });

            await expect(addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' }))
                .rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

            expect(mockGetUserDeletionGuardState).toHaveBeenCalledWith(expect.anything(), 'mock-user-id');
            expect(mockDocRef.create).not.toHaveBeenCalled();
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('addToQueueForSuunto should delete the queue doc and skip dispatch when deletion starts after create', async () => {
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });

            await expect(addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' }))
                .rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

            expect(mockDocRef.create).toHaveBeenCalled();
            expect(mockRecursiveDelete).toHaveBeenCalledWith(mockDocRef);
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
            expect(mockDocRef.update).not.toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('addToQueueForSuunto should preserve the queue doc when deletion starts after create but tombstone write fails', async () => {
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: true,
                    shouldSkip: true,
                });
            mockMarkQueueItemDeletedForUserCleanup.mockResolvedValueOnce(false);

            await expect(addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' }))
                .rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

            expect(mockDocRef.create).toHaveBeenCalled();
            expect(mockRecursiveDelete).not.toHaveBeenCalledWith(mockDocRef);
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
            expect(mockDocRef.update).not.toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('addToQueueForSuunto should fail retryably without dispatch when the post-create deletion guard cannot be read', async () => {
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockRejectedValueOnce(new Error('guard unavailable after create'));

            await expect(addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' }))
                .rejects.toMatchObject({
                    name: 'UserDeletionGuardReadError',
                    code: 'unavailable',
                    statusCode: 503,
                });

            expect(mockDocRef.create).toHaveBeenCalled();
            expect(mockRecursiveDelete).not.toHaveBeenCalled();
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('addToQueueForSuunto should fail retryably when the provider enqueue deletion guard cannot be read', async () => {
            mockGetUserDeletionGuardState.mockRejectedValueOnce(new Error('guard unavailable'));

            await expect(addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' }))
                .rejects.toMatchObject({
                    name: 'UserDeletionGuardReadError',
                    code: 'unavailable',
                    statusCode: 503,
                });

            expect(mockDocRef.create).not.toHaveBeenCalled();
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('addToQueueForSuunto should treat missing dispatch marker doc as success when the worker already moved it to failed_jobs', async () => {
            const notFoundError: any = new Error('No document to update');
            notFoundError.code = 5;
            mockDocRef.update.mockRejectedValueOnce(notFoundError);
            mockDocRef.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    originalCollection: 'suuntoAppWorkoutQueue',
                }),
            });

            const result = await addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' });

            expect(result.id).toBe('mock-doc-id');
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.SuuntoApp, 'user1-work1', expect.any(Number), undefined, { recoveryTaskKey: 0 });
            expect(mockDocRef.get).toHaveBeenCalled();
        });

        it('addToQueueForSuunto should treat duplicate uid backfill not-found as success when the item already moved to failed_jobs', async () => {
            const alreadyExistsError: any = new Error('ALREADY_EXISTS');
            alreadyExistsError.code = 6;
            const notFoundError: any = new Error('No document to update');
            notFoundError.code = 5;
            mockDocRef.create.mockRejectedValueOnce(alreadyExistsError);
            mockDocRef.get
                .mockResolvedValueOnce({
                    exists: true,
                    data: () => ({
                        id: 'user1-work1',
                        dateCreated: 123456,
                        processed: false,
                        retryCount: 0,
                        dispatchedToCloudTask: Date.now(),
                    }),
                })
                .mockResolvedValueOnce({
                    exists: true,
                    data: () => ({
                        originalCollection: 'suuntoAppWorkoutQueue',
                    }),
                });
            mockDocRef.update.mockRejectedValueOnce(notFoundError);

            const result = await addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' });

            expect(result.id).toBe('mock-doc-id');
            expect(mockDocRef.update).toHaveBeenCalledWith({ firebaseUserID: 'mock-user-id' });
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('addToQueueForSuunto should rethrow missing dispatch marker doc errors when failed_jobs does not contain the item', async () => {
            const notFoundError: any = new Error('No document to update');
            notFoundError.code = 5;
            mockDocRef.update.mockRejectedValueOnce(notFoundError);
            mockDocRef.get.mockResolvedValueOnce({
                exists: false,
                data: () => undefined,
            });

            await expect(addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' })).rejects.toThrow('No document to update');
        });

        it('addToQueueForSuunto should re-dispatch duplicate unprocessed queue items', async () => {
            const alreadyExistsError: any = new Error('ALREADY_EXISTS');
            alreadyExistsError.code = 6;
            mockDocRef.create.mockRejectedValueOnce(alreadyExistsError);
            mockDocRef.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    id: 'user1-work1',
                    dateCreated: 123456,
                    processed: false,
                    retryCount: 0,
                    dispatchedToCloudTask: Date.now(),
                }),
            });

            const result = await addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' });

            expect(result.id).toBe('mock-doc-id');
            expect(mockDocRef.create).toHaveBeenCalledWith(expect.objectContaining({
                id: 'user1-work1',
                userName: 'user1',
                workoutID: 'work1'
            }));
            expect(mockDocRef.set).not.toHaveBeenCalled();
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.SuuntoApp, 'user1-work1', 123456, undefined, { recoveryTaskKey: 0 });
            expect(mockDocRef.update).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('addToQueueForSuunto should not mark duplicate unprocessed queue items dispatched when Cloud Tasks reports ALREADY_EXISTS', async () => {
            const alreadyExistsError: any = new Error('ALREADY_EXISTS');
            alreadyExistsError.code = 6;
            mockDocRef.create.mockRejectedValueOnce(alreadyExistsError);
            mockDocRef.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    id: 'user1-work1',
                    dateCreated: 123456,
                    processed: false,
                    retryCount: 0,
                    dispatchedToCloudTask: null,
                }),
            });
            vi.mocked(utils.enqueueWorkoutTask).mockResolvedValueOnce(false);

            const result = await addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' });

            expect(result.id).toBe('mock-doc-id');
            expect(utils.enqueueWorkoutTask).toHaveBeenCalledWith(ServiceNames.SuuntoApp, 'user1-work1', 123456, undefined, { recoveryTaskKey: 0 });
            expect(mockDocRef.update).not.toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
        });

        it('addToQueueForSuunto should delete duplicate queue docs and skip redispatch when deletion starts after duplicate lookup', async () => {
            const alreadyExistsError: any = new Error('ALREADY_EXISTS');
            alreadyExistsError.code = 6;
            mockDocRef.create.mockRejectedValueOnce(alreadyExistsError);
            mockDocRef.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    id: 'user1-work1',
                    dateCreated: 123456,
                    processed: false,
                    retryCount: 0,
                    dispatchedToCloudTask: Date.now(),
                    firebaseUserID: 'mock-user-id',
                }),
            });
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: false,
                    deletionInProgress: false,
                    shouldSkip: true,
                });

            await expect(addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' }))
                .rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

            expect(mockRecursiveDelete).toHaveBeenCalledWith(mockDocRef);
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('addToQueueForSuunto should not backfill duplicate uid when deletion starts before duplicate redispatch', async () => {
            const alreadyExistsError: any = new Error('ALREADY_EXISTS');
            alreadyExistsError.code = 6;
            mockDocRef.create.mockRejectedValueOnce(alreadyExistsError);
            mockDocRef.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    id: 'user1-work1',
                    dateCreated: 123456,
                    processed: false,
                    retryCount: 0,
                    dispatchedToCloudTask: Date.now(),
                }),
            });
            mockGetUserDeletionGuardState
                .mockResolvedValueOnce({
                    userExists: true,
                    deletionInProgress: false,
                    shouldSkip: false,
                })
                .mockResolvedValueOnce({
                    userExists: false,
                    deletionInProgress: false,
                    shouldSkip: true,
                });

            await expect(addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' }))
                .rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

            expect(mockRecursiveDelete).toHaveBeenCalledWith(mockDocRef);
            expect(mockDocRef.update).not.toHaveBeenCalledWith({ firebaseUserID: 'mock-user-id' });
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('addToQueueForSuunto should not backfill duplicate uid when deletion starts inside the backfill transaction', async () => {
            const alreadyExistsError: any = new Error('ALREADY_EXISTS');
            alreadyExistsError.code = 6;
            mockDocRef.create.mockRejectedValueOnce(alreadyExistsError);
            mockDocRef.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    id: 'user1-work1',
                    dateCreated: 123456,
                    processed: false,
                    retryCount: 0,
                    dispatchedToCloudTask: Date.now(),
                }),
            });
            mockGetUserDeletionGuardState.mockResolvedValue({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            });
            mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
                userExists: false,
                deletionInProgress: false,
                shouldSkip: true,
            });

            await expect(addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' }))
                .rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

            expect(mockRecursiveDelete).toHaveBeenCalledWith(mockDocRef);
            expect(mockDocRef.update).not.toHaveBeenCalledWith({ firebaseUserID: 'mock-user-id' });
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('addToQueueForSuunto should skip duplicate queue items that are already processed', async () => {
            const alreadyExistsError: any = new Error('ALREADY_EXISTS');
            alreadyExistsError.code = 6;
            mockDocRef.create.mockRejectedValueOnce(alreadyExistsError);
            mockDocRef.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    id: 'user1-work1',
                    dateCreated: 123456,
                    processed: true,
                    retryCount: 0,
                    dispatchedToCloudTask: Date.now(),
                }),
            });

            const result = await addToQueueForSuunto({ userName: 'user1', workoutID: 'work1' });

            expect(result.id).toBe('mock-doc-id');
            expect(mockDocRef.create).toHaveBeenCalled();
            expect(mockDocRef.set).not.toHaveBeenCalled();
            expect(utils.enqueueWorkoutTask).not.toHaveBeenCalled();
        });

        it('addToQueueForCOROS should insert item', async () => {
            const queueItem: any = { id: 'coros1', openId: 'oid1', workoutID: 'wid1' };
            const result = await addToQueueForCOROS(queueItem);
            expect(result.id).toBe('mock-doc-id');
            const admin = await import('firebase-admin');
            const doc = admin.firestore().collection('COROSAPIWorkoutQueue').doc('coros1');
            expect(doc.set).toHaveBeenCalledWith(expect.objectContaining({
                id: 'coros1',
                openId: 'oid1',
                firebaseUserID: 'mock-user-id',
            }));
        });

        it('addToQueueForGarmin should insert item with activityFileID based ID', async () => {
            const queueItem = {
                userID: 'u1',
                startTimeInSeconds: 123,
                manual: false,
                activityFileID: 'file123',
                activityFileType: 'FIT' as const,
                token: 't1',
                userAccessToken: 'ut1',
                callbackURL: 'cb1',
            };
            const result = await addToQueueForGarmin(queueItem);
            expect(result.id).toBe('mock-doc-id');
            const admin = await import('firebase-admin');
            const doc = admin.firestore().collection('garminAPIActivityQueue').doc('u1-file123');
            expect(doc.set).toHaveBeenCalledWith(expect.objectContaining({
                id: 'u1-file123',
                activityFileID: 'file123',
                firebaseUserID: 'mock-user-id',
            }));
        });
    });

    describe('parseWorkoutQueueItemForServiceName', () => {
        let mockRef: any;
        let suuntoQueueItem: SuuntoAppWorkoutQueueItemInterface;

        beforeEach(() => {
            mockRef = {
                parent: { id: 'suuntoAppWorkoutQueue' },
                update: vi.fn(),
                delete: vi.fn(),
                id: 'test-suunto-item'
            };

            suuntoQueueItem = {
                id: 'test-suunto-item',
                ref: mockRef,
                userName: 'suuntoUser',
                workoutID: 'sw1',
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            vi.mocked(getTokenData).mockResolvedValue({
                accessToken: 'fresh-token',
                userName: 'suuntoUser'
            } as any);

            vi.mocked(requestHelper.get).mockResolvedValue(new ArrayBuffer(8));
        });

        it('should call garmin processor for GarminAPI service', async () => {
            const garminItem: any = { id: 'garmin1' };
            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.GarminAPI, garminItem);
            expect(processGarminAPIActivityQueueItem).toHaveBeenCalled();
            expect(result).toBe('PROCESSED');
        });

        it('should process SuuntoApp item successfully', async () => {
            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);
            expect(result).toBe(QueueResult.Processed);
            expect(vi.mocked(utils.setEvent)).toHaveBeenCalledWith(
                'mock-user-id', // Corrected from mock-doc-id based on hierarchy fix
                'standardized-event-id',
                expect.any(Object),
                expect.any(Object),
                expect.any(Object),
                undefined,
                undefined,
                undefined
            );
        });

        it('should mark processed as skipped without retrying or writing user data when token owner is being deleted before token refresh', async () => {
            mockShouldSkipQueueWorkForDeletedUser.mockResolvedValueOnce(true);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.Processed);
            expect(getTokenData).not.toHaveBeenCalled();
            expect(vi.mocked(utils.setEvent)).not.toHaveBeenCalled();
            expect(mockRef.update).toHaveBeenCalledWith(expect.objectContaining({
                processed: true,
                resultStatus: 'skipped',
                skippedReason: QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
                skippedContext: 'USER_DELETION_GUARD',
            }));
            expect(mockBatch.set).not.toHaveBeenCalled();
            expect(mockBatch.delete).not.toHaveBeenCalledWith(mockRef);
        });

        it('should mark processed as skipped without retrying when token refresh reports account deletion', async () => {
            vi.mocked(getTokenData).mockRejectedValueOnce(new TokenRefreshSkippedForDeletedUserError());

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.Processed);
            expect(vi.mocked(utils.setEvent)).not.toHaveBeenCalled();
            expect(mockRef.update).toHaveBeenCalledWith(expect.objectContaining({
                processed: true,
                resultStatus: 'skipped',
                skippedReason: QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
            }));
            expect(mockBatch.set).not.toHaveBeenCalled();
        });

        it('should mark processed as skipped without retrying when account deletion starts before event write', async () => {
            mockShouldSkipQueueWorkForDeletedUser
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.Processed);
            expect(getTokenData).toHaveBeenCalled();
            expect(vi.mocked(utils.setEvent)).not.toHaveBeenCalled();
            expect(mockRef.update).toHaveBeenCalledWith(expect.objectContaining({
                processed: true,
                resultStatus: 'skipped',
                skippedReason: QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
            }));
            expect(mockBatch.set).not.toHaveBeenCalled();
        });

        it('should mark processed as skipped when setEvent detects account deletion mid-write', async () => {
            mockShouldSkipQueueWorkForDeletedUser
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(false);
            vi.mocked(utils.setEvent).mockRejectedValueOnce(
                new utils.EventWriteSkippedForDeletedUserError('mock-user-id', 'event_writer:users/mock-user-id/events/standardized-event-id'),
            );

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.Processed);
            expect(vi.mocked(utils.setEvent)).toHaveBeenCalled();
            expect(mockRef.update).toHaveBeenCalledWith(expect.objectContaining({
                processed: true,
                resultStatus: 'skipped',
                skippedReason: QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
            }));
            expect(mockBatch.set).not.toHaveBeenCalled();
        });

        it('should retry when the deletion guard read fails before activity sync enqueue', async () => {
            mockShouldSkipQueueWorkForDeletedUser
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(false)
                .mockRejectedValueOnce(new Error('deletion guard unavailable'));
            vi.mocked(utils.setEvent).mockResolvedValueOnce({
                eventID: 'standardized-event-id',
                savedOriginalFiles: [],
            } as any);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.RetryIncremented);
            expect(vi.mocked(utils.setEvent)).toHaveBeenCalled();
            expect(mockRef.update).toHaveBeenCalledWith(expect.objectContaining({
                retryCount: 1,
                dispatchedToCloudTask: null,
            }));
            expect(mockRef.update).not.toHaveBeenCalledWith(expect.objectContaining({
                processed: true,
                resultStatus: 'skipped',
            }));
        });

        it('should move to DLQ if no token found', async () => {
            const admin = await import('firebase-admin');
            vi.spyOn(admin.firestore().collectionGroup('tokens'), 'get').mockResolvedValueOnce({
                size: 0,
                docs: [],
                empty: true
            } as any);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);
            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(mockBatch.delete).toHaveBeenCalledWith(mockRef);
        });

        it('service-scopes Suunto token lookups before processing', async () => {
            const admin = await import('firebase-admin');
            const tokenCollection = admin.firestore().collectionGroup('tokens') as any;
            tokenCollection.where.mockClear();
            tokenCollection.get.mockResolvedValueOnce({
                size: 0,
                docs: [],
                empty: true,
            } as any);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(tokenCollection.where).toHaveBeenCalledWith('userName', '==', 'suuntoUser');
            expect(tokenCollection.where).toHaveBeenCalledWith('serviceName', '==', ServiceNames.SuuntoApp);
        });

        it('service-scopes COROS token lookups when using the token cache', async () => {
            const admin = await import('firebase-admin');
            const tokenCollection = admin.firestore().collectionGroup('tokens') as any;
            tokenCollection.where.mockClear();
            tokenCollection.get.mockResolvedValueOnce({
                size: 0,
                docs: [],
                empty: true,
            } as any);

            const corosItem: COROSAPIWorkoutQueueItemInterface = {
                id: 'test-coros-item',
                ref: {
                    parent: { id: 'COROSAPIWorkoutQueue' },
                    update: vi.fn(),
                    delete: vi.fn(),
                    id: 'test-coros-item',
                } as any,
                openId: 'corosOpenId',
                workoutID: 'cw1',
                FITFileURI: 'https://coros.com/fit',
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.COROSAPI, corosItem, undefined, new Map());

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(tokenCollection.where).toHaveBeenCalledWith('openId', '==', 'corosOpenId');
            expect(tokenCollection.where).toHaveBeenCalledWith('serviceName', '==', ServiceNames.COROSAPI);
        });

        it('should move to DLQ immediately when token refresh returns terminal invalid_grant', async () => {
            vi.mocked(getTokenData).mockRejectedValueOnce(new TerminalServiceAuthError(
                ServiceNames.SuuntoApp,
                'mock-user-id',
                'suuntoUser',
                400,
                'invalid_grant',
                'User no longer active/connected with the partner',
                new Error('400 invalid_grant'),
            ));

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(mockBatch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                context: 'INVALID_GRANT',
                originalCollection: 'suuntoAppWorkoutQueue',
            }));
            expect(mockBatch.delete).toHaveBeenCalledWith(mockRef);
            expect(mockRef.update).not.toHaveBeenCalledWith(expect.objectContaining({
                retryCount: expect.any(Number),
            }));
        });

        it('should prefer INVALID_GRANT when multiple terminal auth failures disagree on DLQ context', async () => {
            const admin = await import('firebase-admin');
            vi.spyOn(admin.firestore().collectionGroup('tokens'), 'get').mockResolvedValueOnce({
                size: 2,
                docs: [{
                    id: 'generic-terminal-token',
                    ref: {
                        id: 'generic-terminal-token',
                        parent: {
                            id: 'tokens',
                            parent: { id: 'generic-user-id' },
                        },
                    },
                    data: vi.fn(() => ({})),
                }, {
                    id: 'invalid-grant-token',
                    ref: {
                        id: 'invalid-grant-token',
                        parent: {
                            id: 'tokens',
                            parent: { id: 'invalid-grant-user-id' },
                        },
                    },
                    data: vi.fn(() => ({})),
                }],
                empty: false,
            } as any);
            vi.mocked(getTokenData)
                .mockRejectedValueOnce(new TerminalServiceAuthError(
                    ServiceNames.SuuntoApp,
                    'generic-user-id',
                    'suuntoUser',
                    401,
                    null,
                    'Unauthorized',
                    new Error('401 unauthorized'),
                ))
                .mockRejectedValueOnce(new TerminalServiceAuthError(
                    ServiceNames.SuuntoApp,
                    'invalid-grant-user-id',
                    'suuntoUser',
                    400,
                    'invalid_grant',
                    'User no longer active/connected with the partner',
                    new Error('400 invalid_grant'),
                ));

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(mockBatch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                context: 'INVALID_GRANT',
                originalCollection: 'suuntoAppWorkoutQueue',
            }));
        });

        it('should retry when a terminal auth failure is mixed with retryable token failures', async () => {
            const admin = await import('firebase-admin');
            vi.spyOn(admin.firestore().collectionGroup('tokens'), 'get').mockResolvedValueOnce({
                size: 2,
                docs: [{
                    id: 'retryable-token',
                    ref: {
                        id: 'retryable-token',
                        parent: {
                            id: 'tokens',
                            parent: { id: 'retryable-user-id' },
                        },
                    },
                    data: vi.fn(() => ({})),
                }, {
                    id: 'invalid-grant-token',
                    ref: {
                        id: 'invalid-grant-token',
                        parent: {
                            id: 'tokens',
                            parent: { id: 'invalid-grant-user-id' },
                        },
                    },
                    data: vi.fn(() => ({})),
                }],
                empty: false,
            } as any);
            vi.mocked(getTokenData)
                .mockRejectedValueOnce(Object.assign(new Error('temporary provider failure'), { statusCode: 500 }))
                .mockRejectedValueOnce(new TerminalServiceAuthError(
                    ServiceNames.SuuntoApp,
                    'invalid-grant-user-id',
                    'suuntoUser',
                    400,
                    'invalid_grant',
                    'User no longer active/connected with the partner',
                    new Error('400 invalid_grant'),
                ));

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.RetryIncremented);
            expect(mockBatch.set).not.toHaveBeenCalled();
            expect(mockBatch.delete).not.toHaveBeenCalledWith(mockRef);
            expect(mockRef.update).toHaveBeenCalledWith(expect.objectContaining({
                retryCount: 1,
                errors: expect.arrayContaining([
                    expect.objectContaining({ error: 'temporary provider failure' }),
                ]),
            }));
        });

        it('should continue to later matching tokens when an earlier token hits terminal invalid_grant', async () => {
            const admin = await import('firebase-admin');
            vi.spyOn(admin.firestore().collectionGroup('tokens'), 'get').mockResolvedValueOnce({
                size: 2,
                docs: [{
                    id: 'stale-token-doc',
                    ref: {
                        id: 'stale-token-doc',
                        parent: {
                            id: 'tokens',
                            parent: { id: 'stale-user-id' },
                        },
                    },
                    data: vi.fn(() => ({})),
                }, {
                    id: 'healthy-token-doc',
                    ref: {
                        id: 'healthy-token-doc',
                        parent: {
                            id: 'tokens',
                            parent: { id: 'healthy-user-id' },
                        },
                    },
                    data: vi.fn(() => ({})),
                }],
                empty: false,
            } as any);
            vi.mocked(getTokenData)
                .mockRejectedValueOnce(new TerminalServiceAuthError(
                    ServiceNames.SuuntoApp,
                    'stale-user-id',
                    'suuntoUser',
                    400,
                    'invalid_grant',
                    'User no longer active/connected with the partner',
                    new Error('400 invalid_grant'),
                ))
                .mockResolvedValueOnce({
                    accessToken: 'healthy-token',
                    userName: 'suuntoUser',
                } as any);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.Processed);
            expect(vi.mocked(utils.setEvent)).toHaveBeenCalledWith(
                'healthy-user-id',
                'standardized-event-id',
                expect.any(Object),
                expect.any(Object),
                expect.any(Object),
                undefined,
                undefined,
                undefined
            );
            expect(mockBatch.set).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                context: 'INVALID_GRANT',
            }));
        });

        it('should handle COROSAPI item successfully', async () => {
            const corosItem: COROSAPIWorkoutQueueItemInterface = {
                id: 'test-coros-item',
                ref: mockRef,
                openId: 'corosOpenId',
                workoutID: 'cw1',
                FITFileURI: 'https://coros.com/fit',
                retryCount: 0,
                processed: false,
                dateCreated: Date.now(),
                dispatchedToCloudTask: null,
            };
            mockRef.parent.id = 'COROSAPIWorkoutQueue';

            vi.mocked(getTokenData).mockResolvedValue({
                accessToken: 'fresh-token',
                openId: 'corosOpenId'
            } as any);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.COROSAPI, corosItem);
            expect(result).toBe(QueueResult.Processed);
            expect(vi.mocked(utils.setEvent)).toHaveBeenCalledWith(
                'mock-user-id',
                'standardized-event-id',
                expect.any(Object),
                expect.any(Object),
                expect.any(Object),
                undefined,
                undefined,
                undefined
            );
        });

        it('should handle 401 Unauthorized with token refresh and retry', async () => {
            vi.mocked(requestHelper.get)
                .mockRejectedValueOnce({ statusCode: 401 })
                .mockResolvedValueOnce(new ArrayBuffer(8));

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.Processed);
            expect(getTokenData).toHaveBeenCalledTimes(2); // Initial + Force Refresh
        });

        it('should move to DLQ when forced refresh after download 401 returns terminal invalid_grant', async () => {
            vi.mocked(requestHelper.get).mockRejectedValueOnce({ statusCode: 401 });
            vi.mocked(getTokenData)
                .mockResolvedValueOnce({
                    accessToken: 'stale-token',
                    userName: 'suuntoUser',
                } as any)
                .mockRejectedValueOnce(new TerminalServiceAuthError(
                    ServiceNames.SuuntoApp,
                    'mock-user-id',
                    'suuntoUser',
                    400,
                    'invalid_grant',
                    'User no longer active/connected with the partner',
                    new Error('400 invalid_grant'),
                ));

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(getTokenData).toHaveBeenCalledTimes(2);
            expect(mockBatch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                context: 'INVALID_GRANT',
                originalCollection: 'suuntoAppWorkoutQueue',
            }));
            expect(mockBatch.delete).toHaveBeenCalledWith(mockRef);
        });

        it('should handle 403 Forbidden by increasing retry count significantly', async () => {
            vi.mocked(requestHelper.get).mockRejectedValue({ statusCode: 403 });

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);
            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(mockBatch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                context: 'MAX_RETRY_REACHED'
            }));
        });

        it('should handle 500 Internal Server Error by retrying instead of immediate DLQ', async () => {
            vi.mocked(requestHelper.get).mockRejectedValue({ statusCode: 500 });

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);

            expect(result).toBe(QueueResult.RetryIncremented);
            expect(mockRef.update).toHaveBeenCalledWith(expect.objectContaining({
                retryCount: 1,
            }));
            expect(mockBatch.set).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                context: 'MAX_RETRY_REACHED'
            }));
        });

        it('should unwrap multipart FIT payload before parsing', async () => {
            const fitPayload = Buffer.alloc(14 + 3 + 2); // header + data + crc
            fitPayload.writeUInt8(14, 0);
            fitPayload.writeUInt32LE(3, 4);
            fitPayload.write('.FIT', 8, 'ascii');
            fitPayload.writeUInt8(0x01, 14);
            fitPayload.writeUInt8(0x02, 15);
            fitPayload.writeUInt8(0x03, 16);

            const boundary = '------WebKitFormBoundaryQueueSpec';
            const multipart = Buffer.concat([
                Buffer.from(
                    `${boundary}\r\n` +
                    'Content-Disposition: form-data; name="file"; filename="example.fit"\r\n' +
                    'Content-Type: application/octet-stream\r\n\r\n',
                    'latin1'
                ),
                fitPayload,
                Buffer.from(`\r\n${boundary}--\r\n`, 'latin1'),
            ]);

            vi.mocked(requestHelper.get).mockResolvedValue(multipart);

            const result = await parseWorkoutQueueItemForServiceName(ServiceNames.SuuntoApp, suuntoQueueItem);
            expect(result).toBe(QueueResult.Processed);

            const importerCalls = vi.mocked(EventImporterFIT.getFromArrayBuffer).mock.calls;
            expect(importerCalls.length).toBeGreaterThan(0);
            const parsedPayload = importerCalls[0][0] as ArrayBuffer;
            const parsedPayloadBuffer = Buffer.from(parsedPayload);

            expect(parsedPayload).toBeInstanceOf(ArrayBuffer);
            expect(parsedPayloadBuffer.readUInt8(0)).toBe(14);
            expect(parsedPayloadBuffer.subarray(8, 12).toString('ascii')).toBe('.FIT');
        });
    });
});
