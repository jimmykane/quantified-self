import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { QueueResult } from '../queue-utils';

const hoisted = vi.hoisted(() => ({
    docGet: vi.fn(),
    docSet: vi.fn(),
    docUpdate: vi.fn(),
    docIdValues: [] as string[],
    batchSet: vi.fn(),
    batchDelete: vi.fn(),
    batchCommit: vi.fn(),
    disabledProviders: ['GarminAPI', 'COROSAPI'] as string[],
    allowedUserIDs: ['xcsAolLDDTWTgtRN9eYF3lW2YKL2'] as string[],
    tokenRootWhere: vi.fn(),
    tokenRootLimit: vi.fn(),
    tokenRootGet: vi.fn(),
    collectionGroupWhere: vi.fn(),
    collectionGroupLimit: vi.fn(),
    collectionGroupGet: vi.fn(),
    getTokenData: vi.fn(),
    requestGet: vi.fn(),
    markSleepSyncError: vi.fn(),
    updateSleepSyncState: vi.fn(),
    upsertSleepSessions: vi.fn(),
    enqueueSleepSyncTask: vi.fn(),
    shouldSkipQueueWorkForDeletedUser: vi.fn(),
    getUserDeletionGuardState: vi.fn(),
    getUserDeletionGuardStateInTransaction: vi.fn(),
    markQueueItemDeletedForUserCleanup: vi.fn(),
    transactionUpdate: vi.fn((ref: { update?: (data: unknown) => Promise<void> }, data: unknown) => ref.update?.(data)),
    runTransaction: vi.fn(),
    recursiveDelete: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
    Timestamp: {
        fromDate: (date: Date) => ({ date }),
    },
}));

vi.mock('firebase-admin', () => {
    const tokenRootQuery: any = {
        where: hoisted.tokenRootWhere,
        limit: hoisted.tokenRootLimit,
        get: hoisted.tokenRootGet,
    };
    hoisted.tokenRootWhere.mockReturnValue(tokenRootQuery);
    hoisted.tokenRootLimit.mockReturnValue(tokenRootQuery);

    const collectionGroupQuery: any = {
        where: hoisted.collectionGroupWhere,
        limit: hoisted.collectionGroupLimit,
        get: hoisted.collectionGroupGet,
    };
    hoisted.collectionGroupWhere.mockReturnValue(collectionGroupQuery);
    hoisted.collectionGroupLimit.mockReturnValue(collectionGroupQuery);

    hoisted.runTransaction.mockImplementation(async (runner: (transaction: {
        update: typeof hoisted.transactionUpdate;
    }) => unknown) => runner({
        update: hoisted.transactionUpdate,
    }));

    const firestoreFn = vi.fn(() => ({
        collection: vi.fn((name: string) => ({
            id: name,
            doc: vi.fn((id: string) => {
                hoisted.docIdValues.push(id);
                return {
                    id,
                    parent: { id: name },
                    get: hoisted.docGet,
                    set: hoisted.docSet,
                    update: hoisted.docUpdate,
                    collection: vi.fn(() => tokenRootQuery),
                };
            }),
        })),
        collectionGroup: vi.fn(() => collectionGroupQuery),
        batch: vi.fn(() => ({
            set: hoisted.batchSet,
            delete: hoisted.batchDelete,
            commit: hoisted.batchCommit,
        })),
        runTransaction: hoisted.runTransaction,
        recursiveDelete: hoisted.recursiveDelete,
    }));
    Object.assign(firestoreFn, {
        Timestamp: {
            fromDate: (date: Date) => ({ date }),
        },
    });
    return {
        firestore: firestoreFn,
    };
});

vi.mock('./provider-flags', () => ({
    SLEEP_SYNC_DISABLED_PROVIDERS: hoisted.disabledProviders,
    SLEEP_SYNC_ALLOWED_USER_IDS: hoisted.allowedUserIDs,
    isSleepProviderEnabled: vi.fn((provider: string) => !hoisted.disabledProviders.includes(provider)),
    isSleepSyncUserAllowed: vi.fn((userID: string | null | undefined) => (
        hoisted.allowedUserIDs.length === 0
        || (typeof userID === 'string' && hoisted.allowedUserIDs.includes(userID))
    )),
}));

vi.mock('./writer', () => ({
    markSleepSyncError: hoisted.markSleepSyncError,
    updateSleepSyncState: hoisted.updateSleepSyncState,
    upsertSleepSessions: hoisted.upsertSleepSessions,
}));

vi.mock('../tokens', () => {
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

    class MockTokenRefreshSkippedForDeletedUserError extends Error {
        readonly name = 'TokenRefreshSkippedForDeletedUserError';

        constructor(
            public readonly firebaseUserID = 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            public readonly serviceName = ServiceNames.SuuntoApp,
            public readonly tokenDocumentID = 'token-1',
            public readonly phase = 'before_refresh',
        ) {
            super(`Skipping ${serviceName} token refresh for ${tokenDocumentID}`);
        }
    }

    return {
        getTokenData: hoisted.getTokenData,
        TerminalServiceAuthError: MockTerminalServiceAuthError,
        TokenRefreshSkippedForDeletedUserError: MockTokenRefreshSkippedForDeletedUserError,
    };
});

vi.mock('../request-helper', () => ({
    get: hoisted.requestGet,
}));

vi.mock('../utils', async () => {
    const actual = await vi.importActual<typeof import('../utils')>('../utils');
    return {
        ...actual,
        enqueueSleepSyncTask: hoisted.enqueueSleepSyncTask,
    };
});

vi.mock('../queue/user-deletion-skip', () => ({
    shouldSkipQueueWorkForDeletedUser: hoisted.shouldSkipQueueWorkForDeletedUser,
}));

vi.mock('../shared/user-deletion-guard', () => ({
    getUserDeletionGuardState: hoisted.getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
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
    markQueueItemDeletedForUserCleanup: hoisted.markQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS: {
        UserDeletionGuard: 'user_deletion_guard',
    },
}));

import { addSleepSyncQueueItem, processSleepSyncQueueItem } from './queue';
import { TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from '../tokens';
import { ProviderQueueUserDeletedOrDeletingError, ProviderQueueUserNotConnectedError } from '../queue/provider-queue-errors';

describe('sleep queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.docIdValues.length = 0;
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI', 'COROSAPI');
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length, 'xcsAolLDDTWTgtRN9eYF3lW2YKL2');
        hoisted.docGet.mockResolvedValue({ exists: false, data: () => undefined });
        hoisted.docSet.mockResolvedValue(undefined);
        hoisted.batchCommit.mockResolvedValue(undefined);
        hoisted.tokenRootGet.mockResolvedValue({ docs: [], empty: true });
        hoisted.collectionGroupGet.mockResolvedValue({ docs: [], empty: true });
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'garmin-access-token',
            permissions: ['HEALTH_EXPORT'],
        });
        hoisted.requestGet.mockResolvedValue({ sleeps: [] });
        hoisted.markSleepSyncError.mockResolvedValue(undefined);
        hoisted.updateSleepSyncState.mockResolvedValue(undefined);
        hoisted.upsertSleepSessions.mockResolvedValue({ written: 0, skipped: 0 });
        hoisted.enqueueSleepSyncTask.mockResolvedValue(true);
        hoisted.shouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
        hoisted.getUserDeletionGuardState.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.markQueueItemDeletedForUserCleanup.mockResolvedValue(true);
        hoisted.transactionUpdate.mockClear();
        hoisted.runTransaction.mockClear();
        hoisted.recursiveDelete.mockResolvedValue(undefined);
    });

    it('uses deterministic queue ids for duplicated webhook or poll payloads', async () => {
        const input = {
            type: 'suunto_webhook' as const,
            provider: 'SuuntoApp' as const,
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
        };

        await addSleepSyncQueueItem(input);
        await addSleepSyncQueueItem(input);

        expect(hoisted.docIdValues).toHaveLength(2);
        expect(hoisted.docIdValues[0]).toBe(hoisted.docIdValues[1]);
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.objectContaining({
            id: hoisted.docIdValues[0],
            processed: false,
            retryCount: 0,
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
        }), { merge: false });
    });

    it('can dispatch webhook queue items immediately after writing the queue document', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-06T05:30:00.000Z'));
        try {
            await addSleepSyncQueueItem({
                type: 'suunto_webhook',
                provider: 'SuuntoApp',
                userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123 }] },
                dedupeKey: 'suunto-user-1:123',
                dispatchImmediately: true,
            });

            expect(hoisted.enqueueSleepSyncTask).toHaveBeenCalledWith(
                hoisted.docIdValues[0],
                Date.now(),
            );
            expect(hoisted.docUpdate).toHaveBeenCalledWith({
                dispatchedToCloudTask: Date.now(),
            });
            expect(hoisted.docSet.mock.invocationCallOrder[0])
                .toBeLessThan(hoisted.enqueueSleepSyncTask.mock.invocationCallOrder[0]);
            expect(hoisted.enqueueSleepSyncTask.mock.invocationCallOrder[0])
                .toBeLessThan(hoisted.docUpdate.mock.invocationCallOrder[0]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not reset an already processed immediate queue item for a duplicate webhook', async () => {
        hoisted.docGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                type: 'suunto_webhook',
                provider: 'SuuntoApp',
                userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123 }] },
                processed: true,
                dispatchedToCloudTask: 1_777_000_000_000,
            }),
        });

        await addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
            dispatchImmediately: true,
        });

        expect(hoisted.docSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('does not reset an in-flight immediate queue item for a duplicate webhook', async () => {
        hoisted.docGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                type: 'suunto_webhook',
                provider: 'SuuntoApp',
                userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123 }] },
                processed: false,
                dispatchedToCloudTask: 1_777_000_000_000,
            }),
        });

        await addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
            dispatchImmediately: true,
        });

        expect(hoisted.docSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('queues a deterministic immediate revision when a processed webhook payload changes under the same provider key', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-06T05:30:00.000Z'));
        try {
            hoisted.docGet
                .mockResolvedValueOnce({
                    exists: true,
                    data: () => ({
                        type: 'suunto_webhook',
                        provider: 'SuuntoApp',
                        userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                        providerUserId: 'suunto-user-1',
                        payload: { samples: [{ SleepId: 123, Duration: 1200 }] },
                        processed: true,
                        dispatchedToCloudTask: 1_777_000_000_000,
                    }),
                })
                .mockResolvedValueOnce({ exists: false, data: () => undefined });

            await addSleepSyncQueueItem({
                type: 'suunto_webhook',
                provider: 'SuuntoApp',
                userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123, Duration: 2400 }] },
                dedupeKey: 'suunto-user-1:123',
                dispatchImmediately: true,
            });

            expect(hoisted.docIdValues).toHaveLength(2);
            expect(hoisted.docIdValues[1]).not.toBe(hoisted.docIdValues[0]);
            expect(hoisted.docSet).toHaveBeenCalledWith(expect.objectContaining({
                id: hoisted.docIdValues[1],
                processed: false,
                dispatchedToCloudTask: null,
                type: 'suunto_webhook',
                provider: 'SuuntoApp',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123, Duration: 2400 }] },
            }), { merge: false });
            expect(hoisted.enqueueSleepSyncTask).toHaveBeenCalledWith(
                hoisted.docIdValues[1],
                Date.now(),
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('reuses a processed immediate revision for an exact duplicate provider update payload', async () => {
        hoisted.docGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    type: 'suunto_webhook',
                    provider: 'SuuntoApp',
                    userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                    providerUserId: 'suunto-user-1',
                    payload: { samples: [{ SleepId: 123, Duration: 1200 }] },
                    processed: true,
                    dispatchedToCloudTask: 1_777_000_000_000,
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    type: 'suunto_webhook',
                    provider: 'SuuntoApp',
                    userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                    providerUserId: 'suunto-user-1',
                    payload: { samples: [{ SleepId: 123, Duration: 2400 }] },
                    processed: true,
                    dispatchedToCloudTask: 1_777_000_010_000,
                }),
            });

        await addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123, Duration: 2400 }] },
            dedupeKey: 'suunto-user-1:123',
            dispatchImmediately: true,
        });

        expect(hoisted.docIdValues).toHaveLength(2);
        expect(hoisted.docSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('still rewrites deterministic non-immediate queue items for polling and backfill retries', async () => {
        await addSleepSyncQueueItem({
            type: 'suunto_poll',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            dedupeKey: 'suunto-user-1:poll',
        });

        expect(hoisted.docGet).not.toHaveBeenCalled();
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.objectContaining({
            type: 'suunto_poll',
            provider: 'SuuntoApp',
            providerUserId: 'suunto-user-1',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
        }), { merge: false });
    });

    it('rejects provider-only enqueue without creating a queue doc when no local token resolves', async () => {
        hoisted.collectionGroupGet.mockResolvedValueOnce({
            docs: [],
            empty: true,
        });

        await expect(addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            providerUserId: 'unknown-suunto-user',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'unknown-suunto-user:123',
            dispatchImmediately: true,
        })).rejects.toBeInstanceOf(ProviderQueueUserNotConnectedError);

        expect(hoisted.docSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
    });

    it.each([
        {
            provider: 'GarminAPI' as const,
            serviceName: ServiceNames.GarminAPI,
            tokenField: 'userID',
            type: 'garmin_ping' as const,
            extraInput: { callbackURL: 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1777424400' },
        },
        {
            provider: 'COROSAPI' as const,
            serviceName: ServiceNames.COROSAPI,
            tokenField: 'openId',
            type: 'coros_poll' as const,
            extraInput: { rangeStartMs: 1_777_392_000_000, rangeEndMs: 1_777_478_400_000 },
        },
    ])('resolves provider-only $provider queue items using canonical serviceName token docs', async ({ provider, serviceName, tokenField, type, extraInput }) => {
        hoisted.collectionGroupGet.mockResolvedValueOnce({
            docs: [{
                id: 'provider-token-1',
                ref: {
                    parent: {
                        parent: {
                            id: 'resolved-firebase-user',
                        },
                    },
                },
                data: () => ({
                    serviceName,
                    [tokenField]: 'provider-user-1',
                }),
            }],
            empty: false,
        });

        await addSleepSyncQueueItem({
            type,
            provider,
            providerUserId: 'provider-user-1',
            dedupeKey: `${provider}:provider-user-1`,
            ...extraInput,
        });

        expect(hoisted.collectionGroupWhere).toHaveBeenCalledWith('serviceName', '==', serviceName);
        expect(hoisted.collectionGroupWhere).toHaveBeenCalledWith(tokenField, '==', 'provider-user-1');
        expect(hoisted.docSet).toHaveBeenCalledWith(expect.objectContaining({
            provider,
            providerUserId: 'provider-user-1',
            userID: 'resolved-firebase-user',
        }), { merge: false });
    });

    it('rejects enqueue without creating a queue doc when deletion is active before write', async () => {
        hoisted.getUserDeletionGuardState.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });

        await expect(addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
            dispatchImmediately: true,
        })).rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

        expect(hoisted.docSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
    });

    it('deletes a written queue doc and skips dispatch when deletion starts after write', async () => {
        hoisted.getUserDeletionGuardState
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

        await expect(addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
            dispatchImmediately: true,
        })).rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

        expect(hoisted.docSet).toHaveBeenCalled();
        expect(hoisted.recursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
            id: hoisted.docIdValues[0],
        }));
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('preserves a written queue doc when deletion starts after write but tombstone write fails', async () => {
        hoisted.getUserDeletionGuardState
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
        hoisted.markQueueItemDeletedForUserCleanup.mockResolvedValueOnce(false);

        await expect(addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
            dispatchImmediately: true,
        })).rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

        expect(hoisted.docSet).toHaveBeenCalled();
        expect(hoisted.recursiveDelete).not.toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('does not write the dispatch marker when deletion starts after Cloud Task enqueue', async () => {
        hoisted.getUserDeletionGuardState
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
        hoisted.getUserDeletionGuardStateInTransaction
            .mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });

        await expect(addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
            dispatchImmediately: true,
        })).rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

        expect(hoisted.docSet).toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).toHaveBeenCalledWith(
            hoisted.docIdValues[0],
            expect.any(Number),
        );
        expect(hoisted.recursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
            id: hoisted.docIdValues[0],
        }));
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('deletes a non-dispatched queue doc when deletion starts after write', async () => {
        hoisted.getUserDeletionGuardState
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

        await expect(addSleepSyncQueueItem({
            type: 'suunto_poll',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            dedupeKey: 'suunto-user-1:poll',
        })).rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

        expect(hoisted.docSet).toHaveBeenCalled();
        expect(hoisted.recursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
            id: hoisted.docIdValues[0],
        }));
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('fails retryably without queue write when the enqueue deletion guard cannot be read', async () => {
        hoisted.getUserDeletionGuardState.mockRejectedValueOnce(new Error('guard unavailable'));

        await expect(addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
            dispatchImmediately: true,
        })).rejects.toMatchObject({
            name: 'UserDeletionGuardReadError',
            code: 'unavailable',
        });

        expect(hoisted.docSet).not.toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
    });

    it('marks disabled provider queue items processed without resolving tokens', async () => {
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'garmin-sleep-disabled',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'GarminAPI',
            providerUserId: 'garmin-user-1',
            retryCount: 0,
            type: 'garmin_push',
            payload: { sleeps: [{ summaryId: 'summary-1' }] },
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'provider_disabled',
            providerDisabled: true,
            sessionsWritten: 0,
            sessionsSkipped: 0,
        }));
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('records Garmin ping queue successes as webhook sync activity', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-29T06:00:00.000Z'));
        try {
            hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'COROSAPI');
            hoisted.upsertSleepSessions.mockResolvedValue({ written: 1, skipped: 0 });
            hoisted.requestGet.mockResolvedValue({
                sleeps: [{
                    summaryId: 'summary-1',
                    calendarDate: '2026-04-29',
                    startTimeInSeconds: 1_777_424_400,
                    durationInSeconds: 28_800,
                }],
            });
            hoisted.tokenRootGet.mockResolvedValue({
                docs: [{
                    id: 'garmin-token-1',
                    data: () => ({
                        serviceName: 'GarminAPI',
                        userID: 'garmin-user-1',
                    }),
                    ref: {
                        parent: {
                            parent: {
                                id: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                            },
                        },
                    },
                }],
                empty: false,
            });
            const update = vi.fn().mockResolvedValue(undefined);
            const callbackURL = 'https://apis.garmin.com/wellness-api/rest/sleeps?uploadStartTimeInSeconds=1777424400';

            const result = await processSleepSyncQueueItem({
                id: 'garmin-sleep-ping',
                dateCreated: 1_700_000_000_000,
                dispatchedToCloudTask: 1_700_000_000_500,
                processed: false,
                provider: 'GarminAPI',
                userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                providerUserId: 'garmin-user-1',
                retryCount: 0,
                type: 'garmin_ping',
                callbackURL,
                ref: {
                    update,
                } as any,
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.requestGet).toHaveBeenCalledWith(expect.objectContaining({
                url: callbackURL,
                headers: {
                    Authorization: 'Bearer garmin-access-token',
                },
                json: true,
            }));
            expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('xcsAolLDDTWTgtRN9eYF3lW2YKL2', 'GarminAPI', {
                status: 'ready',
                lastSyncedAtMs: Date.now(),
                lastPollAtMs: undefined,
                lastWebhookAtMs: Date.now(),
                lastError: null,
            });
            expect(update).toHaveBeenCalledWith(expect.objectContaining({
                processed: true,
                resultStatus: 'success',
                sessionsWritten: 1,
                sessionsSkipped: 0,
            }));
        } finally {
            vi.useRealTimers();
        }
    });

    it('prefixes Suunto sleep poll access tokens with Bearer', async () => {
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'raw-suunto-access-token',
        });
        hoisted.requestGet.mockResolvedValue({ samples: [] });
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    serviceName: 'SuuntoApp',
                    userName: 'suunto-user-1',
                }),
                ref: {
                    parent: {
                        parent: {
                            id: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                        },
                    },
                },
            }],
            empty: false,
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-poll',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.requestGet).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://cloudapi.suunto.com/247samples/sleep?from=1777392000000&to=1777478400000',
            headers: expect.objectContaining({
                Authorization: 'Bearer raw-suunto-access-token',
            }),
            json: true,
        }));
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'success',
        }));
    });

    it('keeps the fullest Suunto sample when a poll returns interim and final records for the same sleep id', async () => {
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'raw-suunto-access-token',
        });
        hoisted.requestGet.mockResolvedValue([
            {
                timestamp: '2026-04-28T21:51:00.000+03:00',
                entryData: {
                    SleepId: 1777402260,
                    DateTime: '2026-04-28T21:51:00.000+03:00',
                    IsNap: true,
                    Duration: 2040,
                    DeepSleepDuration: 0,
                    LightSleepDuration: 0,
                    REMSleepDuration: 0,
                    WakeAfterSleepOnsetDuration: 0,
                },
            },
            {
                timestamp: '2026-04-28T21:51:00.000+03:00',
                entryData: {
                    SleepId: 1777402260,
                    DateTime: '2026-04-28T21:51:00.000+03:00',
                    IsNap: false,
                    Duration: 34260,
                    DeepSleepDuration: 6210,
                    LightSleepDuration: 20070,
                    REMSleepDuration: 7020,
                    WakeAfterSleepOnsetDuration: 960,
                    SleepQualityScore: 67,
                },
            },
        ]);
        hoisted.upsertSleepSessions.mockResolvedValue({ written: 1, skipped: 0 });
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    serviceName: 'SuuntoApp',
                    userName: 'suunto-user-1',
                }),
                ref: {
                    parent: {
                        parent: {
                            id: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                        },
                    },
                },
            }],
            empty: false,
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-poll-with-duplicates',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.upsertSleepSessions).toHaveBeenCalledWith('xcsAolLDDTWTgtRN9eYF3lW2YKL2', [
            expect.objectContaining({
                sourceSessionKey: '1777402260',
                session: expect.objectContaining({
                    isNap: false,
                    durationSeconds: 33300,
                    inBedDurationSeconds: 34260,
                    stageDurationsSeconds: expect.objectContaining({
                        deep: 6210,
                        light: 20070,
                        rem: 7020,
                        awake: 960,
                    }),
                    score: expect.objectContaining({
                        value: 67,
                    }),
                }),
            }),
        ]);
    });

    it('moves Garmin ping queue items with untrusted callback URLs to DLQ without resolving tokens', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'COROSAPI');
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
        };

        const result = await processSleepSyncQueueItem({
            id: 'garmin-sleep-bad-callback',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'GarminAPI',
            providerUserId: 'garmin-user-1',
            retryCount: 0,
            type: 'garmin_ping',
            callbackURL: 'https://attacker.example/wellness-api/rest/sleeps?token=garmin-token',
            ref: queueRef as any,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'garmin-sleep-bad-callback',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'INVALID_GARMIN_CALLBACK_URL',
            error: expect.stringContaining('Untrusted Garmin callback URL'),
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('moves Garmin push queue items to DLQ without persisting payload data', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'COROSAPI');
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
        };

        const result = await processSleepSyncQueueItem({
            id: 'garmin-sleep-push',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'GarminAPI',
            providerUserId: 'garmin-user-1',
            retryCount: 0,
            type: 'garmin_push',
            payload: { sleeps: [{ summaryId: 'summary-1', startTimeInSeconds: 1760000000 }] },
            ref: queueRef as any,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'garmin-sleep-push',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'UNSUPPORTED_GARMIN_PUSH_PAYLOAD',
            error: expect.stringContaining('Garmin push sleep payloads are not accepted'),
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
    });

    it('marks out-of-scope user queue items processed without resolving tokens', async () => {
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-other-user',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'other-user',
            providerUserId: 'suunto-user-2',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'user_not_allowed',
            userAllowed: false,
            sessionsWritten: 0,
            sessionsSkipped: 0,
        }));
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('moves queue items with unresolved provider users to DLQ instead of retrying Cloud Tasks', async () => {
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length);
        hoisted.collectionGroupGet.mockResolvedValue({
            docs: [],
            empty: true,
        });
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
        };

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-no-token',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            providerUserId: 'unknown-suunto-user',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: queueRef as any,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'suunto-sleep-no-token',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'NO_TOKEN_FOUND',
            error: 'No SuuntoApp token found for unknown-suunto-user',
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
        expect(hoisted.docUpdate).not.toHaveBeenCalled();
    });

    it('moves malformed queue items to DLQ without writing sleep state', async () => {
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length);
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
        };

        const result = await processSleepSyncQueueItem({
            id: 'malformed-sleep-item',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: undefined,
            providerUserId: undefined,
            retryCount: 0,
            type: 'suunto_webhook',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            ref: queueRef as any,
        } as any);

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'malformed-sleep-item',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'INVALID_SLEEP_QUEUE_ITEM',
            error: 'Malformed sleep sync queue item malformed-sleep-item: invalid provider missing',
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
        expect(hoisted.shouldSkipQueueWorkForDeletedUser).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).not.toHaveBeenCalled();
        expect(hoisted.updateSleepSyncState).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
    });

    it('skips malformed user-scoped queue items before DLQ when account deletion is active', async () => {
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length);
        hoisted.shouldSkipQueueWorkForDeletedUser.mockResolvedValue(true);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'malformed-sleep-deleted-user',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'not_a_sleep_type',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            ref: {
                update,
            } as any,
        } as any);

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.shouldSkipQueueWorkForDeletedUser).toHaveBeenCalledWith(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            'suuntoApp',
            'malformed-sleep-deleted-user',
            'before_sleep_token_resolution',
        );
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'skipped',
            skippedReason: 'user_deleted_or_deleting',
        }));
        expect(hoisted.batchSet).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).not.toHaveBeenCalled();
        expect(hoisted.updateSleepSyncState).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
    });

    it('skips user-scoped queue items before token resolution when account deletion is active', async () => {
        hoisted.shouldSkipQueueWorkForDeletedUser.mockResolvedValue(true);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-deleted-user',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'skipped',
            skippedReason: 'user_deleted_or_deleting',
            sessionsWritten: 0,
            sessionsSkipped: 0,
        }));
        expect(hoisted.tokenRootGet).not.toHaveBeenCalled();
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
        expect(hoisted.getTokenData).not.toHaveBeenCalled();
        expect(hoisted.requestGet).not.toHaveBeenCalled();
    });

    it('skips all-user queue items after token resolution but before provider sync when account deletion is active', async () => {
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length);
        hoisted.shouldSkipQueueWorkForDeletedUser.mockResolvedValue(true);
        hoisted.collectionGroupGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    userName: 'suunto-user-1',
                    serviceName: 'SuuntoApp',
                }),
                ref: {
                    parent: {
                        parent: {
                            id: 'deleted-user-id',
                        },
                    },
                },
            }],
            empty: false,
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-deleted-user-all',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.collectionGroupGet).toHaveBeenCalled();
        expect(hoisted.getTokenData).not.toHaveBeenCalled();
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            resultStatus: 'skipped',
            skippedReason: 'user_deleted_or_deleting',
        }));
    });

    it('marks TokenRefreshSkippedForDeletedUserError as skipped instead of retrying', async () => {
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    userName: 'suunto-user-1',
                    serviceName: 'SuuntoApp',
                }),
                ref: {
                    parent: {
                        parent: {
                            id: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                        },
                    },
                },
            }],
            empty: false,
        });
        hoisted.getTokenData.mockRejectedValueOnce(new TokenRefreshSkippedForDeletedUserError(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            ServiceNames.SuuntoApp,
            'suunto-token-1',
            'before_refresh' as any,
        ));
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-refresh-deleted-user',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.markSleepSyncError).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            resultStatus: 'skipped',
            skippedReason: 'user_deleted_or_deleting',
        }));
    });

    it('defers pending-disconnect token use without marking processed or incrementing retries', async () => {
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    userName: 'suunto-user-1',
                    serviceName: 'SuuntoApp',
                }),
                ref: {
                    parent: {
                        parent: {
                            id: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                        },
                    },
                },
            }],
            empty: false,
        });
        const pendingDisconnectError = new Error('service disconnect is pending');
        pendingDisconnectError.name = 'TokenUseSkippedForPendingDisconnectError';
        hoisted.getTokenData.mockRejectedValueOnce(pendingDisconnectError);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-pending-disconnect',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Deferred);
        expect(hoisted.markSleepSyncError).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: false,
            resultStatus: 'deferred',
            deferredReason: 'service_disconnect_pending',
            dispatchedToCloudTask: null,
            sessionsWritten: 0,
            sessionsSkipped: 0,
        }));
        expect(update).not.toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
        }));
        expect(update).not.toHaveBeenCalledWith(expect.objectContaining({
            retryCount: expect.any(Number),
        }));
    });

    it('resolves all-user Suunto queue items with an indexed userName and serviceName token query', async () => {
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length);
        hoisted.collectionGroupGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    userName: 'suunto-user-1',
                    serviceName: 'Suunto app',
                }),
                ref: {
                    parent: {
                        parent: {
                            id: 'user-id',
                            parent: {
                                id: 'suuntoAppAccessTokens',
                            },
                        },
                    },
                },
            }],
            empty: false,
        });
        hoisted.upsertSleepSessions.mockResolvedValue({ written: 1, skipped: 0 });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-token',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: {
                samples: [{
                    entryData: {
                        SleepId: 123,
                        DateTime: '2026-04-28T21:51:00.000+03:00',
                        Duration: 28_800,
                    },
                }],
            },
            ref: {
                update,
            } as any,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.collectionGroupWhere).toHaveBeenCalledWith('userName', '==', 'suunto-user-1');
        expect(hoisted.collectionGroupWhere).toHaveBeenCalledWith('serviceName', '==', ServiceNames.SuuntoApp);
        expect(hoisted.collectionGroupLimit).toHaveBeenCalledWith(1);
        expect(hoisted.upsertSleepSessions).toHaveBeenCalledWith('user-id', expect.any(Array));
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'success',
            sessionsWritten: 1,
        }));
        expect(hoisted.batchSet).not.toHaveBeenCalled();
    });

    it('moves Suunto queue items to DLQ immediately on terminal invalid_grant without retrying', async () => {
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    userName: 'suunto-user-1',
                    serviceName: 'SuuntoApp',
                }),
                ref: {
                    parent: {
                        parent: {
                            id: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
                        },
                    },
                },
            }],
            empty: false,
        });
        hoisted.getTokenData.mockRejectedValueOnce(new TerminalServiceAuthError(
            ServiceNames.SuuntoApp,
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            'suunto-user-1',
            400,
            'invalid_grant',
            'User no longer active/connected with the partner',
            new Error('400 invalid_grant'),
        ));
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
            update: vi.fn(),
        };

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-invalid-grant',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: queueRef as any,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            'SuuntoApp',
            expect.objectContaining({
                dlqContext: 'INVALID_GRANT',
            }),
        );
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'suunto-sleep-invalid-grant',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'INVALID_GRANT',
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
        expect(queueRef.update).not.toHaveBeenCalled();
    });

    it('does not resolve another users token when an allowed queue item has mismatched provider user id', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI', 'COROSAPI');
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
        };

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-provider-mismatch',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            providerUserId: 'other-suunto-user',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: queueRef as any,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.tokenRootWhere).toHaveBeenCalledWith('userName', '==', 'other-suunto-user');
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            'SuuntoApp',
            expect.objectContaining({
                message: 'No SuuntoApp token found for other-suunto-user',
            }),
        );
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'suunto-sleep-provider-mismatch',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'NO_TOKEN_FOUND',
        }));
        expect(hoisted.batchDelete).toHaveBeenCalledWith(queueRef);
    });
});
