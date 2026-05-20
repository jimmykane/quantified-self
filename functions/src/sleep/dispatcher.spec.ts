import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PENDING_TASKS } from '../shared/queue-config';

const {
    mockLoggerError,
    mockLoggerInfo,
    mockLoggerWarn,
    mockGetCloudTaskQueueDepthForQueue,
    mockEnqueueSleepSyncTask,
    mockQueueCollection,
    mockQueueGet,
    mockQueueLimit,
    mockQueueOrderBy,
    mockQueueStartAfter,
    mockQueueWhere,
    mockFirestore,
    mockRunTransaction,
    mockRecursiveDelete,
    mockGetUserDeletionGuardState,
    mockGetUserDeletionGuardStateInTransaction,
    mockTokenCollectionGroup,
    mockTokenWhere,
    mockTokenLimit,
    mockTokenGet,
    mockMarkQueueItemDeletedForUserCleanup,
} = vi.hoisted(() => {
    const mockLoggerError = vi.fn();
    const mockLoggerInfo = vi.fn();
    const mockLoggerWarn = vi.fn();
    const mockGetCloudTaskQueueDepthForQueue = vi.fn();
    const mockEnqueueSleepSyncTask = vi.fn();
    const mockQueueCollection = vi.fn();
    const mockQueueGet = vi.fn();
    const mockQueueLimit = vi.fn();
    const mockQueueOrderBy = vi.fn();
    const mockQueueStartAfter = vi.fn();
    const mockQueueWhere = vi.fn();
    const mockRecursiveDelete = vi.fn();
    const mockGetUserDeletionGuardState = vi.fn();
    const mockGetUserDeletionGuardStateInTransaction = vi.fn();
    const mockRunTransaction = vi.fn(async (runner: (transaction: { update: (ref: { update?: (data: unknown) => Promise<void> }, data: unknown) => Promise<void> | void }) => unknown) => runner({
        update: (ref, data) => ref.update?.(data),
    }));
    const mockTokenCollectionGroup = vi.fn();
    const mockTokenWhere = vi.fn();
    const mockTokenLimit = vi.fn();
    const mockTokenGet = vi.fn();
    const mockMarkQueueItemDeletedForUserCleanup = vi.fn();
    const mockFirestore = vi.fn(() => ({
        collection: mockQueueCollection,
        collectionGroup: mockTokenCollectionGroup,
        recursiveDelete: mockRecursiveDelete,
        runTransaction: mockRunTransaction,
    }));

    return {
        mockLoggerError,
        mockLoggerInfo,
        mockLoggerWarn,
        mockGetCloudTaskQueueDepthForQueue,
        mockEnqueueSleepSyncTask,
        mockQueueCollection,
        mockQueueGet,
        mockQueueLimit,
        mockQueueOrderBy,
        mockQueueStartAfter,
        mockQueueWhere,
        mockFirestore,
        mockRunTransaction,
        mockRecursiveDelete,
        mockGetUserDeletionGuardState,
        mockGetUserDeletionGuardStateInTransaction,
        mockTokenCollectionGroup,
        mockTokenWhere,
        mockTokenLimit,
        mockTokenGet,
        mockMarkQueueItemDeletedForUserCleanup,
    };
});

vi.mock('firebase-functions/v1', () => ({
    region: vi.fn(() => ({
        runWith: vi.fn(() => ({
            pubsub: {
                schedule: vi.fn(() => ({
                    onRun: vi.fn((handler: (payload: unknown) => unknown) => handler),
                })),
            },
        })),
    })),
}));

vi.mock('firebase-functions/logger', () => ({
    error: mockLoggerError,
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
}));

vi.mock('firebase-admin', () => ({
    firestore: mockFirestore,
}));

vi.mock('../config', () => ({
    config: {
        cloudtasks: {
            sleepSyncQueue: 'processSleepSyncTask',
        },
    },
}));

vi.mock('../utils', () => ({
    enqueueSleepSyncTask: mockEnqueueSleepSyncTask,
    getCloudTaskQueueDepthForQueue: mockGetCloudTaskQueueDepthForQueue,
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: mockGetUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction: mockGetUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
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
    },
}));

vi.mock('../queue/cleanup-tombstone', () => ({
    markQueueItemDeletedForUserCleanup: mockMarkQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS: {
        DispatcherCleanup: 'dispatcher_cleanup',
    },
}));

import { reconcileSleepSyncQueueDispatches } from './dispatcher';

describe('sleep/dispatcher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetCloudTaskQueueDepthForQueue.mockResolvedValue(0);
        mockEnqueueSleepSyncTask.mockResolvedValue(true);
        mockRecursiveDelete.mockResolvedValue(undefined);
        mockMarkQueueItemDeletedForUserCleanup.mockResolvedValue(true);
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

        const queryChain: any = {
            get: mockQueueGet,
            limit: mockQueueLimit,
            orderBy: mockQueueOrderBy,
            startAfter: mockQueueStartAfter,
            where: mockQueueWhere,
        };
        mockQueueCollection.mockReturnValue(queryChain);
        mockQueueWhere.mockReturnValue(queryChain);
        mockQueueOrderBy.mockReturnValue(queryChain);
        mockQueueLimit.mockReturnValue(queryChain);
        mockQueueStartAfter.mockReturnValue(queryChain);
        mockQueueGet.mockResolvedValue({
            empty: true,
            docs: [],
        });

        const tokenQueryChain: any = {
            get: mockTokenGet,
            limit: mockTokenLimit,
            where: mockTokenWhere,
        };
        mockTokenCollectionGroup.mockReturnValue(tokenQueryChain);
        mockTokenWhere.mockReturnValue(tokenQueryChain);
        mockTokenLimit.mockReturnValue(tokenQueryChain);
        mockTokenGet.mockResolvedValue({
            empty: true,
            docs: [],
            size: 0,
        });
    });

    it('skips reconciliation when the Cloud Tasks queue is already at capacity', async () => {
        mockGetCloudTaskQueueDepthForQueue.mockResolvedValue(MAX_PENDING_TASKS);

        const result = await reconcileSleepSyncQueueDispatches(1_700_000_000_000);

        expect(result).toEqual({
            inspected: 0,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockQueueCollection).not.toHaveBeenCalled();
    });

    it('dispatches undispatched and stale queue items while skipping recently dispatched ones', async () => {
        const nowMs = 1_700_000_000_000;
        const updateRecent = vi.fn().mockResolvedValue(undefined);
        const updateStale = vi.fn().mockResolvedValue(undefined);
        const updateUndispatched = vi.fn().mockResolvedValue(undefined);

        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'recent-item',
                    data: () => ({ dispatchedToCloudTask: nowMs - (10 * 60 * 1000), dateCreated: 100, userID: 'recent-user' }),
                    ref: { update: updateRecent },
                },
                {
                    id: 'undispatched-item',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 101,
                        userID: 'undispatched-user',
                        provider: 'SuuntoApp',
                        providerUserId: 'suunto-user-1',
                    }),
                    ref: { update: updateUndispatched },
                },
                {
                    id: 'stale-item',
                    data: () => ({
                        dispatchedToCloudTask: nowMs - (3 * 60 * 60 * 1000),
                        dateCreated: 102,
                        userID: 'stale-user',
                        provider: 'SuuntoApp',
                        providerUserId: 'suunto-user-2',
                    }),
                    ref: { update: updateStale },
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 3,
            dispatched: 2,
            skippedRecent: 1,
        });
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('undispatched-item', 101);
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('stale-item', 102);
        expect(updateUndispatched).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
        expect(updateStale).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
        expect(updateRecent).not.toHaveBeenCalled();
    });

    it('paginates past recently dispatched rows so new queue items still dispatch', async () => {
        const nowMs = 1_700_000_000_000;
        const recentDispatchedAt = nowMs - (10 * 60 * 1000);
        const firstPageRecentDocs = Array.from({ length: 100 }, (_, index) => ({
            id: `recent-item-${index}`,
            data: () => ({ dispatchedToCloudTask: recentDispatchedAt, dateCreated: index, userID: `recent-user-${index}` }),
            ref: { update: vi.fn().mockResolvedValue(undefined) },
        }));
        const updateUndispatched = vi.fn().mockResolvedValue(undefined);
        const undispatchedDoc = {
            id: 'older-undispatched-item',
            data: () => ({
                dispatchedToCloudTask: null,
                dateCreated: 999,
                userID: 'older-undispatched-user',
                provider: 'SuuntoApp',
                providerUserId: 'suunto-user-older',
            }),
            ref: { update: updateUndispatched },
        };

        mockQueueGet
            .mockResolvedValueOnce({
                empty: false,
                docs: firstPageRecentDocs,
            })
            .mockResolvedValueOnce({
                empty: false,
                docs: [undispatchedDoc],
            });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 101,
            dispatched: 1,
            skippedRecent: 100,
        });
        expect(mockQueueOrderBy).toHaveBeenCalledWith('dateCreated', 'asc');
        expect(mockQueueStartAfter).toHaveBeenCalled();
        expect(mockQueueGet).toHaveBeenCalledTimes(2);
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('older-undispatched-item', 999);
        expect(updateUndispatched).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
    });

    it('does not mark queue items as dispatched when Cloud Task enqueue returns false', async () => {
        const nowMs = 1_700_000_000_000;
        const updateUndispatched = vi.fn().mockResolvedValue(undefined);
        mockEnqueueSleepSyncTask.mockResolvedValueOnce(false);
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'undispatched-item',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 301,
                        userID: 'undispatched-user',
                        provider: 'SuuntoApp',
                        providerUserId: 'suunto-user-3',
                    }),
                    ref: { update: updateUndispatched },
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('undispatched-item', 301);
        expect(updateUndispatched).not.toHaveBeenCalled();
        expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('Task not enqueued'));
    });

    it('does not write the dispatch marker when deletion starts after Cloud Task enqueue', async () => {
        const nowMs = 1_700_000_000_000;
        const updateUndispatched = vi.fn().mockResolvedValue(undefined);
        const itemRef = { update: updateUndispatched, path: 'sleepSyncQueue/undispatched-item' };
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
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'undispatched-item',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 301,
                        userID: 'undispatched-user',
                        provider: 'SuuntoApp',
                        providerUserId: 'suunto-user-3',
                    }),
                    ref: itemRef,
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('undispatched-item', 301);
        expect(mockRecursiveDelete).toHaveBeenCalledWith(itemRef);
        expect(updateUndispatched).not.toHaveBeenCalled();
    });

    it('deletes user-owned queue items instead of dispatching when account deletion is active', async () => {
        const nowMs = 1_700_000_000_000;
        const updateDeleted = vi.fn().mockResolvedValue(undefined);
        const deletedRef = { update: updateDeleted, path: 'sleepSyncQueue/deleted-user-item' };
        mockGetUserDeletionGuardState.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'deleted-user-item',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 401,
                        userID: 'deleted-user-id',
                        provider: 'SuuntoApp',
                        providerUserId: 'suunto-deleted-user',
                    }),
                    ref: deletedRef,
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockGetUserDeletionGuardState).toHaveBeenCalledWith(expect.anything(), 'deleted-user-id');
        expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'deleted-user-item',
            'dispatcher_cleanup',
        );
        expect(mockRecursiveDelete).toHaveBeenCalledWith(deletedRef);
        expect(mockEnqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(updateDeleted).not.toHaveBeenCalled();
    });

    it('deletes malformed queue items without user or provider identity instead of dispatching', async () => {
        const nowMs = 1_700_000_000_000;
        const updateMalformed = vi.fn().mockResolvedValue(undefined);
        const malformedRef = { update: updateMalformed, path: 'sleepSyncQueue/malformed-item' };
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'malformed-item',
                    data: () => ({ dispatchedToCloudTask: null, dateCreated: 501 }),
                    ref: malformedRef,
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockGetUserDeletionGuardState).not.toHaveBeenCalled();
        expect(mockTokenCollectionGroup).not.toHaveBeenCalled();
        expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'malformed-item',
            'dispatcher_cleanup',
        );
        expect(mockRecursiveDelete).toHaveBeenCalledWith(malformedRef);
        expect(mockEnqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(updateMalformed).not.toHaveBeenCalled();
    });

    it('deletes malformed user-owned queue items without provider identity instead of dispatching', async () => {
        const nowMs = 1_700_000_000_000;
        const updateMalformed = vi.fn().mockResolvedValue(undefined);
        const malformedRef = { update: updateMalformed, path: 'sleepSyncQueue/malformed-user-item' };
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'malformed-user-item',
                    data: () => ({ dispatchedToCloudTask: null, dateCreated: 551, userID: 'user-with-malformed-sleep-job' }),
                    ref: malformedRef,
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockGetUserDeletionGuardState).not.toHaveBeenCalled();
        expect(mockTokenCollectionGroup).not.toHaveBeenCalled();
        expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'malformed-user-item',
            'dispatcher_cleanup',
        );
        expect(mockRecursiveDelete).toHaveBeenCalledWith(malformedRef);
        expect(mockEnqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(updateMalformed).not.toHaveBeenCalled();
    });

    it('resolves legacy provider-keyed queue items before dispatching', async () => {
        const nowMs = 1_700_000_000_000;
        const updateLegacy = vi.fn().mockResolvedValue(undefined);
        const legacyRef = { update: updateLegacy, path: 'sleepSyncQueue/legacy-provider-item' };
        const tokenLookupResult = {
            empty: false,
            size: 1,
            docs: [
                {
                    id: 'token-1',
                    ref: {
                        parent: {
                            parent: { id: 'resolved-user-id' },
                        },
                    },
                },
            ],
        };
        mockTokenGet
            .mockResolvedValueOnce(tokenLookupResult)
            .mockResolvedValueOnce(tokenLookupResult);
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'legacy-provider-item',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 601,
                        provider: 'GarminAPI',
                        providerUserId: 'garmin-provider-user',
                    }),
                    ref: legacyRef,
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 1,
            skippedRecent: 0,
        });
        expect(mockTokenCollectionGroup).toHaveBeenCalledWith('tokens');
        expect(mockTokenWhere).toHaveBeenCalledWith('serviceName', '==', 'garminAPI');
        expect(mockTokenWhere).toHaveBeenCalledWith('userID', '==', 'garmin-provider-user');
        expect(mockGetUserDeletionGuardState).toHaveBeenCalledWith(expect.anything(), 'resolved-user-id');
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('legacy-provider-item', 601);
        expect(updateLegacy).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
    });

    it('writes a cleanup tombstone when provider identity disappears after Cloud Task enqueue', async () => {
        const nowMs = 1_700_000_000_000;
        const updateLegacy = vi.fn().mockResolvedValue(undefined);
        const legacyRef = { update: updateLegacy, path: 'sleepSyncQueue/provider-disappeared-after-enqueue' };
        mockTokenGet
            .mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [
                    {
                        id: 'token-1',
                        ref: {
                            parent: {
                                parent: { id: 'resolved-user-id' },
                            },
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                empty: true,
                size: 0,
                docs: [],
            });
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'provider-disappeared-after-enqueue',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 651,
                        provider: 'GarminAPI',
                        providerUserId: 'garmin-provider-user',
                    }),
                    ref: legacyRef,
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('provider-disappeared-after-enqueue', 651);
        expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'provider-disappeared-after-enqueue',
            'dispatcher_cleanup',
        );
        expect(mockRecursiveDelete).toHaveBeenCalledWith(legacyRef);
        expect(updateLegacy).not.toHaveBeenCalled();
    });

    it('leaves an item in place when dispatcher cleanup tombstone write fails', async () => {
        const nowMs = 1_700_000_000_000;
        const updateLegacy = vi.fn().mockResolvedValue(undefined);
        const legacyRef = { update: updateLegacy, path: 'sleepSyncQueue/tombstone-write-failed' };
        mockMarkQueueItemDeletedForUserCleanup.mockResolvedValueOnce(false);
        mockTokenGet
            .mockResolvedValueOnce({
                empty: false,
                size: 1,
                docs: [
                    {
                        id: 'token-1',
                        ref: {
                            parent: {
                                parent: { id: 'resolved-user-id' },
                            },
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({
                empty: true,
                size: 0,
                docs: [],
            });
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'tombstone-write-failed',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 652,
                        provider: 'GarminAPI',
                        providerUserId: 'garmin-provider-user',
                    }),
                    ref: legacyRef,
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('tombstone-write-failed', 652);
        expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'tombstone-write-failed',
            'dispatcher_cleanup',
        );
        expect(mockRecursiveDelete).not.toHaveBeenCalled();
        expect(updateLegacy).not.toHaveBeenCalled();
        expect(mockLoggerError).toHaveBeenCalledWith(
            '[SleepSyncDispatcher] Failed to write cleanup tombstone for tombstone-write-failed; leaving queue item in place to avoid missing-doc Cloud Task retries.',
        );
    });

    it('deletes legacy provider-keyed queue items when no local token resolves', async () => {
        const nowMs = 1_700_000_000_000;
        const updateLegacy = vi.fn().mockResolvedValue(undefined);
        const legacyRef = { update: updateLegacy, path: 'sleepSyncQueue/orphan-provider-item' };
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'orphan-provider-item',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 701,
                        provider: 'SuuntoApp',
                        providerUserId: 'orphan-suunto-user',
                    }),
                    ref: legacyRef,
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 1,
            dispatched: 0,
            skippedRecent: 0,
        });
        expect(mockTokenWhere).toHaveBeenCalledWith('serviceName', '==', 'suuntoApp');
        expect(mockTokenWhere).toHaveBeenCalledWith('userName', '==', 'orphan-suunto-user');
        expect(mockGetUserDeletionGuardState).not.toHaveBeenCalled();
        expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
            'sleepSyncQueue',
            'orphan-provider-item',
            'dispatcher_cleanup',
        );
        expect(mockRecursiveDelete).toHaveBeenCalledWith(legacyRef);
        expect(mockEnqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(updateLegacy).not.toHaveBeenCalled();
    });

    it('leaves an item undispatched when deletion guard lookup fails and continues with other candidates', async () => {
        const nowMs = 1_700_000_000_000;
        const updateGuardFailure = vi.fn().mockResolvedValue(undefined);
        const updateHealthy = vi.fn().mockResolvedValue(undefined);
        mockGetUserDeletionGuardState
            .mockRejectedValueOnce(new Error('guard unavailable'))
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: false,
                shouldSkip: false,
            });
        mockQueueGet.mockResolvedValue({
            empty: false,
            docs: [
                {
                    id: 'guard-failure-item',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 801,
                        userID: 'guard-failure-user',
                        provider: 'SuuntoApp',
                        providerUserId: 'suunto-guard-failure',
                    }),
                    ref: { update: updateGuardFailure },
                },
                {
                    id: 'healthy-item',
                    data: () => ({
                        dispatchedToCloudTask: null,
                        dateCreated: 802,
                        userID: 'healthy-user',
                        provider: 'SuuntoApp',
                        providerUserId: 'suunto-healthy',
                    }),
                    ref: { update: updateHealthy },
                },
            ],
        });

        const result = await reconcileSleepSyncQueueDispatches(nowMs);

        expect(result).toEqual({
            inspected: 2,
            dispatched: 1,
            skippedRecent: 0,
        });
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledTimes(1);
        expect(mockEnqueueSleepSyncTask).toHaveBeenCalledWith('healthy-item', 802);
        expect(updateGuardFailure).not.toHaveBeenCalled();
        expect(updateHealthy).toHaveBeenCalledWith({ dispatchedToCloudTask: nowMs });
        expect(mockLoggerError).toHaveBeenCalledWith(
            '[SleepSyncDispatcher] Failed to check deletion guard for queue item guard-failure-item and user guard-failure-user; leaving item undispatched for a future run.',
            expect.any(Error),
        );
    });
});
