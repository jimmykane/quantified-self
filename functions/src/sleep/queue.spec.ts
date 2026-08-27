import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER, QueueResult } from '../queue-utils';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';

const hoisted = vi.hoisted(() => ({
    docGet: vi.fn(),
    docSet: vi.fn(),
    docUpdate: vi.fn(),
    docIdValues: [] as string[],
    batchSet: vi.fn(),
    batchDelete: vi.fn(),
    batchCommit: vi.fn(),
    disabledProviders: ['GarminAPI', 'COROSAPI'] as string[],
    allowedUserIDs: ['test-user-uid'] as string[],
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
    buildSleepSessionDocumentId: vi.fn(),
    replaceHealthSourceRecord: vi.fn(),
    updateHealthSyncState: vi.fn(),
    enqueueSleepSyncTask: vi.fn(),
    markQueueItemDispatchedIfUserActive: vi.fn(),
    shouldSkipQueueWorkForDeletedUser: vi.fn(),
    getUserDeletionGuardState: vi.fn(),
    getUserDeletionGuardStateInTransaction: vi.fn(),
    markQueueItemDeletedForUserCleanup: vi.fn(),
    transactionUpdate: vi.fn((ref: { update?: (data: unknown) => Promise<void> }, data: unknown) => ref.update?.(data)),
    runTransaction: vi.fn(),
    recursiveDelete: vi.fn(),
    getActiveCOROSTokenSnapshot: vi.fn(),
    getServiceConnectionMeta: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    claimSleepQueueRevision: vi.fn(),
    releaseSleepQueueRevision: vi.fn(),
    captureSuuntoHealthWriteLifecycleGuards: vi.fn(),
    processSuuntoHealthQueueItem: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({
    info: vi.fn(),
    warn: hoisted.loggerWarn,
    error: hoisted.loggerError,
}));

vi.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        delete: vi.fn(() => 'DELETE_SENTINEL'),
    },
    Timestamp: {
        fromDate: (date: Date) => ({ date }),
    },
}));

vi.mock('firebase-admin', () => {
    const tokenRootQuery: Record<string, unknown> = {
        where: hoisted.tokenRootWhere,
        limit: hoisted.tokenRootLimit,
        get: hoisted.tokenRootGet,
        doc: vi.fn((id: string) => ({ id, __mockType: 'nested-document' })),
    };
    hoisted.tokenRootWhere.mockReturnValue(tokenRootQuery);
    hoisted.tokenRootLimit.mockReturnValue(tokenRootQuery);

    const collectionGroupQuery: Record<string, unknown> = {
        where: hoisted.collectionGroupWhere,
        limit: hoisted.collectionGroupLimit,
        get: hoisted.collectionGroupGet,
    };
    hoisted.collectionGroupWhere.mockReturnValue(collectionGroupQuery);
    hoisted.collectionGroupLimit.mockReturnValue(collectionGroupQuery);

    hoisted.runTransaction.mockImplementation(async (runner: (transaction: {
        get: (ref: { get?: () => Promise<unknown> }) => Promise<unknown>;
        set: typeof hoisted.batchSet;
        delete: typeof hoisted.batchDelete;
        update: typeof hoisted.transactionUpdate;
    }) => unknown) => runner({
        get: async (ref) => (
            typeof ref.get === 'function'
                ? ref.get()
                : {
                    exists: true,
                    data: () => ({
                        processed: false,
                        dateCreated: 1_700_000_000_000,
                    }),
                }
        ),
        set: ((ref: { parent?: { id?: string }; set?: (...args: unknown[]) => unknown }, data: unknown, options?: unknown) => {
            if (ref.parent?.id === 'sleepSyncQueue' && typeof ref.set === 'function') {
                return ref.set(data, options);
            }
            return options === undefined
                ? hoisted.batchSet(ref, data)
                : hoisted.batchSet(ref, data, options);
        }) as typeof hoisted.batchSet,
        delete: hoisted.batchDelete,
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
    buildSleepSessionDocumentId: hoisted.buildSleepSessionDocumentId,
    markSleepSyncError: hoisted.markSleepSyncError,
    updateSleepSyncState: hoisted.updateSleepSyncState,
    upsertSleepSessions: hoisted.upsertSleepSessions,
}));

vi.mock('../health/writer', () => ({
    replaceHealthSourceRecord: hoisted.replaceHealthSourceRecord,
    updateHealthSyncState: hoisted.updateHealthSyncState,
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
            public readonly firebaseUserID = 'test-user-uid',
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

vi.mock('../queue/dispatch-marker', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../queue/dispatch-marker')>()),
    markQueueItemDispatchedIfUserActive: hoisted.markQueueItemDispatchedIfUserActive,
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
    getQueueCleanupTombstoneDocumentRef: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
    })),
    QUEUE_CLEANUP_TOMBSTONE_REASONS: {
        UserDeletionGuard: 'user_deletion_guard',
    },
}));

vi.mock('./queue-revision', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./queue-revision')>()),
    claimSleepQueueRevision: hoisted.claimSleepQueueRevision,
    releaseSleepQueueRevision: hoisted.releaseSleepQueueRevision,
}));

vi.mock('../coros/account', () => ({
    getActiveCOROSTokenSnapshot: (...args: unknown[]) => hoisted.getActiveCOROSTokenSnapshot(...args),
}));

vi.mock('../service-connection-meta', () => ({
    getServiceConnectionMeta: (...args: unknown[]) => hoisted.getServiceConnectionMeta(...args),
}));

vi.mock('../suunto/health-sync', () => ({
    captureSuuntoHealthWriteLifecycleGuards: hoisted.captureSuuntoHealthWriteLifecycleGuards,
    processSuuntoHealthQueueItem: hoisted.processSuuntoHealthQueueItem,
    sanitizeSuuntoHealthErrorForTelemetry: vi.fn(() => new Error('Suunto Health processing failed.')),
    suuntoCredentialFromSnapshot: vi.fn(() => ({
        accessToken: 'suunto-access-token',
        refreshToken: 'suunto-refresh-token',
        expiresAt: 2_000,
        dateCreated: 1_000,
        dateRefreshed: 1_000,
        credentialGeneration: 'suunto-credential-generation-1',
    })),
}));

import { addSleepSyncQueueItem, processSleepSyncQueueItem } from './queue';
import { TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from '../tokens';
import { ProviderQueueUserDeletedOrDeletingError, ProviderQueueUserNotConnectedError } from '../queue/provider-queue-errors';

describe('sleep queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.docIdValues.length = 0;
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI', 'COROSAPI');
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length, 'test-user-uid');
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
        hoisted.markSleepSyncError.mockResolvedValue(true);
        hoisted.updateSleepSyncState.mockResolvedValue(undefined);
        hoisted.upsertSleepSessions.mockResolvedValue({ written: 0, skipped: 0 });
        hoisted.buildSleepSessionDocumentId.mockResolvedValue('b'.repeat(64));
        hoisted.replaceHealthSourceRecord.mockResolvedValue({
            status: 'written',
            sourceRecordId: 'health-record-id',
            sourceRecord: null,
            chunksWritten: 0,
            chunksDeleted: 0,
        });
        hoisted.updateHealthSyncState.mockResolvedValue(true);
        hoisted.claimSleepQueueRevision.mockResolvedValue('claimed');
        hoisted.releaseSleepQueueRevision.mockResolvedValue(undefined);
        hoisted.enqueueSleepSyncTask.mockResolvedValue(true);
        hoisted.shouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
        hoisted.getUserDeletionGuardState.mockReset().mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.getUserDeletionGuardStateInTransaction.mockReset().mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.markQueueItemDeletedForUserCleanup.mockReset().mockResolvedValue(true);
        hoisted.markQueueItemDispatchedIfUserActive.mockReset().mockImplementation(async (params: {
            queueItemDocument: { update: (data: unknown) => Promise<void> };
            dispatchedAtMs: number;
        }) => {
            await params.queueItemDocument.update({
                dispatchedToCloudTask: params.dispatchedAtMs,
            });
            return 'marked';
        });
        hoisted.transactionUpdate.mockClear();
        hoisted.getActiveCOROSTokenSnapshot.mockRejectedValue(Object.assign(new Error('No active COROS token'), {
            code: 'unauthenticated',
        }));
        hoisted.getServiceConnectionMeta.mockResolvedValue({
            providerUserId: 'coros-user-1',
            connectionState: 'connected',
            connectionStateGeneration: 'coros-generation-1',
        });
        hoisted.runTransaction.mockClear();
        hoisted.recursiveDelete.mockResolvedValue(undefined);
        hoisted.captureSuuntoHealthWriteLifecycleGuards.mockResolvedValue({
            requiredExistingDocumentRef: { path: 'suunto-token' },
            requiredExistingTokenCredential: { accessToken: 'suunto-access-token' },
            requiredDocumentFieldValues: { expectedFields: { connectionStateGeneration: 'suunto-generation-1' } },
            additionalRequiredDocumentFieldValues: [],
        });
        hoisted.processSuuntoHealthQueueItem.mockResolvedValue({
            healthResults: [],
            lifecycleGuards: {
                requiredExistingDocumentRef: { path: 'suunto-token' },
                requiredExistingTokenCredential: { accessToken: 'suunto-access-token' },
                requiredDocumentFieldValues: { expectedFields: { connectionStateGeneration: 'suunto-generation-1' } },
                additionalRequiredDocumentFieldValues: [],
            },
        });
    });

    it('uses deterministic queue ids for duplicated webhook or poll payloads', async () => {
        const input = {
            type: 'suunto_webhook' as const,
            provider: 'SuuntoApp' as const,
            userID: 'test-user-uid',
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
                userID: 'test-user-uid',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123 }] },
                dedupeKey: 'suunto-user-1:123',
                dispatchImmediately: true,
            });

            expect(hoisted.enqueueSleepSyncTask).toHaveBeenCalledWith(
                hoisted.docIdValues[0],
                Date.now(),
                undefined,
                {
                    queueRevision: expect.any(String),
                    queueDateCreated: Date.now(),
                },
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
                userID: 'test-user-uid',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123 }] },
                processed: true,
                dispatchedToCloudTask: 1_777_000_000_000,
            }),
        });

        await addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
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
                userID: 'test-user-uid',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123 }] },
                processed: false,
                dispatchedToCloudTask: 1_777_000_000_000,
            }),
        });

        await addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
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
                        userID: 'test-user-uid',
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
                userID: 'test-user-uid',
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
                undefined,
                {
                    queueRevision: expect.any(String),
                    queueDateCreated: Date.now(),
                },
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
                    userID: 'test-user-uid',
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
                    userID: 'test-user-uid',
                    providerUserId: 'suunto-user-1',
                    payload: { samples: [{ SleepId: 123, Duration: 2400 }] },
                    processed: true,
                    dispatchedToCloudTask: 1_777_000_010_000,
                }),
            });

        await addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
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

    it('keeps a replacement undispatched while the older revision holds its processing lease', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-06T05:30:00.000Z'));
        try {
            hoisted.docGet.mockResolvedValue({
                exists: true,
                data: () => ({
                    type: 'suunto_webhook',
                    provider: 'SuuntoApp',
                    userID: 'test-user-uid',
                    providerUserId: 'suunto-user-1',
                    payload: { samples: [{ SleepId: 123, Duration: 1200 }] },
                    processed: false,
                    dispatchedToCloudTask: null,
                    queueRevision: 'revision-1',
                    processingOwner: 'worker-r1',
                    processingRevision: 'revision:revision-1',
                    processingLeaseExpiresAt: Date.now() + 60_000,
                }),
            });

            await addSleepSyncQueueItem({
                type: 'suunto_webhook',
                provider: 'SuuntoApp',
                userID: 'test-user-uid',
                providerUserId: 'suunto-user-1',
                payload: { samples: [{ SleepId: 123, Duration: 2400 }] },
                dedupeKey: 'suunto-user-1:123',
                dispatchImmediately: true,
            });

            expect(hoisted.docSet).toHaveBeenCalledWith(expect.objectContaining({
                processed: false,
                dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
                queueRevision: expect.not.stringMatching(/^revision-1$/),
                processingOwner: 'worker-r1',
                processingRevision: 'revision:revision-1',
                processingLeaseExpiresAt: Date.now() + 60_000,
            }), { merge: false });
            expect(hoisted.enqueueSleepSyncTask).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('still rewrites deterministic non-immediate queue items for polling and backfill retries', async () => {
        await addSleepSyncQueueItem({
            type: 'suunto_poll',
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            dedupeKey: 'suunto-user-1:poll',
        });

        expect(hoisted.docGet).toHaveBeenCalledOnce();
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
            userID: 'test-user-uid',
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
            userID: 'test-user-uid',
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
            userID: 'test-user-uid',
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
        hoisted.markQueueItemDispatchedIfUserActive.mockImplementationOnce(async (params: {
            queueItemDocument: unknown;
        }) => {
            await hoisted.recursiveDelete(params.queueItemDocument);
            return 'skipped_deleted_user';
        });

        await expect(addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            payload: { samples: [{ SleepId: 123 }] },
            dedupeKey: 'suunto-user-1:123',
            dispatchImmediately: true,
        })).rejects.toBeInstanceOf(ProviderQueueUserDeletedOrDeletingError);

        expect(hoisted.docSet).toHaveBeenCalled();
        expect(hoisted.enqueueSleepSyncTask).toHaveBeenCalledWith(
            hoisted.docIdValues[0],
            expect.any(Number),
            undefined,
            {
                queueRevision: expect.any(String),
                queueDateCreated: expect.any(Number),
            },
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
            userID: 'test-user-uid',
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
            userID: 'test-user-uid',
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
                id: 'garmin-sleep-disabled',
                parent: { id: 'sleepSyncQueue' },
                update,
            } as unknown as admin.firestore.DocumentReference,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'provider_disabled',
            providerDisabled: true,
            sessionsWritten: 0,
            sessionsSkipped: 0,
        }));
        expect(hoisted.tokenRootGet).not.toHaveBeenCalled();
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
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
                                id: 'test-user-uid',
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
                userID: 'test-user-uid',
                providerUserId: 'garmin-user-1',
                retryCount: 0,
                type: 'garmin_ping',
                callbackURL,
                ref: {
                    update,
                } as unknown as admin.firestore.DocumentReference,
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.requestGet).toHaveBeenCalledWith(expect.objectContaining({
                url: callbackURL,
                headers: {
                    Authorization: 'Bearer garmin-access-token',
                },
                json: true,
            }));
            expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith('test-user-uid', 'GarminAPI', {
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
                            id: 'test-user-uid',
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
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as unknown as admin.firestore.DocumentReference,
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

    it('does not call the provider after a Sleep queue revision is superseded', async () => {
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    serviceName: 'SuuntoApp',
                    userName: 'suunto-user-1',
                }),
                ref: { parent: { parent: { id: 'test-user-uid' } } },
            }],
            empty: false,
        });
        hoisted.claimSleepQueueRevision.mockResolvedValueOnce('superseded');

        await expect(processSleepSyncQueueItem({
            id: 'suunto-superseded-revision',
            dateCreated: 1_700_000_000_000,
            queueRevision: 'revision-1',
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: { parent: { id: 'sleepSyncQueue' } } as unknown as admin.firestore.DocumentReference,
        })).resolves.toBe(QueueResult.Processed);

        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.releaseSleepQueueRevision).not.toHaveBeenCalled();
    });

    it('fails retryably while another worker owns the Sleep queue revision', async () => {
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    serviceName: 'SuuntoApp',
                    userName: 'suunto-user-1',
                }),
                ref: { parent: { parent: { id: 'test-user-uid' } } },
            }],
            empty: false,
        });
        hoisted.claimSleepQueueRevision.mockResolvedValueOnce('busy');

        await expect(processSleepSyncQueueItem({
            id: 'suunto-busy-revision',
            dateCreated: 1_700_000_000_000,
            queueRevision: 'revision-1',
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: { parent: { id: 'sleepSyncQueue' } } as unknown as admin.firestore.DocumentReference,
        })).rejects.toMatchObject({
            name: 'ProviderOperationStillInFlightError',
            code: 'unavailable',
        });

        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.releaseSleepQueueRevision).not.toHaveBeenCalled();
    });

    it('does not inherit another worker lease from the queue snapshot', async () => {
        hoisted.tokenRootGet.mockResolvedValue({
            docs: [{
                id: 'suunto-token-1',
                data: () => ({
                    serviceName: 'SuuntoApp',
                    userName: 'suunto-user-1',
                }),
                ref: { parent: { parent: { id: 'test-user-uid' } } },
            }],
            empty: false,
        });
        hoisted.claimSleepQueueRevision.mockResolvedValueOnce('busy');
        const queueItem = {
            id: 'suunto-busy-persisted-lease',
            dateCreated: 1_700_000_000_000,
            queueRevision: 'revision-1',
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false as const,
            provider: 'SuuntoApp' as const,
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll' as const,
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            processingOwner: 'other-worker',
            processingRevision: 'revision:revision-1',
            processingLeaseExpiresAt: Date.now() + 60_000,
            ref: { parent: { id: 'sleepSyncQueue' } } as unknown as admin.firestore.DocumentReference,
        };

        await expect(processSleepSyncQueueItem(queueItem)).rejects.toMatchObject({
            name: 'ProviderOperationStillInFlightError',
        });

        expect(hoisted.claimSleepQueueRevision).toHaveBeenCalledWith(
            expect.not.objectContaining({
                processingOwner: 'other-worker',
                processingRevision: 'revision:revision-1',
            }),
            'test-user-uid',
            expect.any(String),
        );
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
                            id: 'test-user-uid',
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
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as unknown as admin.firestore.DocumentReference,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.upsertSleepSessions).toHaveBeenCalledWith('test-user-uid', [
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
            ref: queueRef as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
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
            ref: queueRef as unknown as admin.firestore.DocumentReference,
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
            } as unknown as admin.firestore.DocumentReference,
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
            ref: queueRef as unknown as admin.firestore.DocumentReference,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'suunto-sleep-no-token',
        }), expect.objectContaining({
            originalCollection: 'sleepSyncQueue',
            context: 'NO_TOKEN_FOUND',
            error: 'No SuuntoApp token found',
        }));
        expect(hoisted.loggerWarn.mock.calls.flat().join(' ')).not.toContain('unknown-suunto-user');
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
            userID: 'test-user-uid',
            ref: queueRef as unknown as admin.firestore.DocumentReference,
        } as unknown as SleepSyncQueueItemInterface);

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

    it('rejects Suunto Health queue work without a recognized trigger', async () => {
        const queueRef = { parent: { id: 'sleepSyncQueue' } };

        const result = await processSleepSyncQueueItem({
            id: 'malformed-suunto-health-trigger',
            dateCreated: 1_700_000_000_000,
            processed: false,
            provider: 'SuuntoApp',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_health_poll',
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            ref: queueRef as unknown as admin.firestore.DocumentReference,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            context: 'INVALID_SLEEP_QUEUE_ITEM',
            error: expect.stringContaining('invalid trigger'),
        }));
        expect(hoisted.processSuuntoHealthQueueItem).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
    });

    it('rejects malformed Suunto Health ranges before token resolution', async () => {
        const queueRef = { parent: { id: 'sleepSyncQueue' } };

        const result = await processSleepSyncQueueItem({
            id: 'malformed-suunto-health-range',
            dateCreated: 1_700_000_000_000,
            processed: false,
            provider: 'SuuntoApp',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_health_poll',
            healthTrigger: 'poll',
            rangeStartMs: 1_700_000_000_000,
            rangeEndMs: 1_700_000_000_000,
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            ref: queueRef as unknown as admin.firestore.DocumentReference,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            context: 'INVALID_SLEEP_QUEUE_ITEM',
            error: expect.stringContaining('invalid range'),
        }));
        expect(hoisted.processSuuntoHealthQueueItem).not.toHaveBeenCalled();
        expect(hoisted.tokenRootGet).not.toHaveBeenCalled();
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
    });

    it('rejects oversized Suunto Health provider identifiers before token resolution', async () => {
        const queueRef = { parent: { id: 'sleepSyncQueue' } };

        const result = await processSleepSyncQueueItem({
            id: 'malformed-suunto-health-account',
            dateCreated: 1_700_000_000_000,
            processed: false,
            provider: 'SuuntoApp',
            providerUserId: 'a'.repeat(513),
            retryCount: 0,
            type: 'suunto_health_poll',
            healthTrigger: 'poll',
            rangeStartMs: 1_700_000_000_000,
            rangeEndMs: 1_700_086_400_000,
            userID: 'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
            ref: queueRef as unknown as admin.firestore.DocumentReference,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            context: 'INVALID_SLEEP_QUEUE_ITEM',
            error: expect.stringContaining('invalid provider account identifier'),
        }));
        expect(hoisted.processSuuntoHealthQueueItem).not.toHaveBeenCalled();
        expect(hoisted.tokenRootGet).not.toHaveBeenCalled();
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
    });

    it('does not let an unclaimed duplicate move an actively leased Sleep revision to DLQ', async () => {
        hoisted.allowedUserIDs.splice(0, hoisted.allowedUserIDs.length);
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
            get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    dateCreated: 1_700_000_000_000,
                    processed: false,
                    processingOwner: 'active-worker',
                    processingRevision: 'revision:revision-2',
                    processingLeaseExpiresAt: Number.MAX_SAFE_INTEGER,
                }),
            }),
        };

        const result = await processSleepSyncQueueItem({
            id: 'malformed-sleep-active-lease',
            queueRevision: 'revision-2',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: undefined,
            providerUserId: undefined,
            retryCount: 0,
            type: 'suunto_webhook',
            userID: 'test-user-uid',
            processingOwner: 'active-worker',
            processingRevision: 'revision:revision-2',
            processingLeaseExpiresAt: Number.MAX_SAFE_INTEGER,
            ref: queueRef as unknown as admin.firestore.DocumentReference,
        } as unknown as SleepSyncQueueItemInterface);

        expect(result).toBe(QueueResult.Processed);
        expect(queueRef.get).toHaveBeenCalledOnce();
        expect(hoisted.batchSet).not.toHaveBeenCalled();
        expect(hoisted.batchDelete).not.toHaveBeenCalled();
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
            userID: 'test-user-uid',
            ref: {
                update,
            } as unknown as admin.firestore.DocumentReference,
        } as unknown as SleepSyncQueueItemInterface);

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.shouldSkipQueueWorkForDeletedUser).toHaveBeenCalledWith(
            'test-user-uid',
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
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: {
                update,
            } as unknown as admin.firestore.DocumentReference,
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
            } as unknown as admin.firestore.DocumentReference,
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
                            id: 'test-user-uid',
                        },
                    },
                },
            }],
            empty: false,
        });
        hoisted.getTokenData.mockRejectedValueOnce(new TokenRefreshSkippedForDeletedUserError(
            'test-user-uid',
            ServiceNames.SuuntoApp,
            'suunto-token-1',
            'before_refresh',
        ));
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-refresh-deleted-user',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as unknown as admin.firestore.DocumentReference,
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
                            id: 'test-user-uid',
                        },
                    },
                },
            }],
            empty: false,
        });
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => ({
                disconnectState: 'disconnect_pending',
                disconnectGeneration: 'suunto-pending-generation',
            }),
        });
        const pendingDisconnectError = Object.assign(new Error('service disconnect is pending'), {
            name: 'TokenUseSkippedForPendingDisconnectError',
            firebaseUserID: 'test-user-uid',
            serviceName: ServiceNames.SuuntoApp,
        });
        hoisted.getTokenData.mockRejectedValueOnce(pendingDisconnectError);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'suunto-sleep-pending-disconnect',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: {
                update,
            } as unknown as admin.firestore.DocumentReference,
        });

        expect(result).toBe(QueueResult.Deferred);
        expect(hoisted.markSleepSyncError).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'deferred',
            deferredReason: 'service_disconnect_pending',
            dispatchedToCloudTask: expect.any(Number),
            serviceDisconnectPendingDeferredAt: expect.any(Number),
            sessionsWritten: 0,
            sessionsSkipped: 0,
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
            } as unknown as admin.firestore.DocumentReference,
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
                            id: 'test-user-uid',
                        },
                    },
                },
            }],
            empty: false,
        });
        hoisted.getTokenData.mockRejectedValueOnce(new TerminalServiceAuthError(
            ServiceNames.SuuntoApp,
            'test-user-uid',
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
            userID: 'test-user-uid',
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: queueRef as unknown as admin.firestore.DocumentReference,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
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

    it('does not let a COROS terminal queue failure overwrite the authoritative lifecycle state', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({
                openId: 'coros-user-1',
                accessToken: 'coros-access-token',
                tokenCredentialGeneration: 'credential-generation-1',
            }),
            ref: {
                parent: {
                    parent: {
                        id: 'test-user-uid',
                    },
                },
            },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockRejectedValueOnce(new TerminalServiceAuthError(
            ServiceNames.COROSAPI,
            'test-user-uid',
            'coros-user-1',
            401,
            'invalid_grant',
            'private provider detail token=must-not-persist',
            new Error('401 invalid_grant'),
        ));
        const queueRef = {
            parent: { id: 'sleepSyncQueue' },
            update: vi.fn(),
        };

        const result = await processSleepSyncQueueItem({
            id: 'coros-sleep-invalid-grant',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: queueRef as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.updateHealthSyncState).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({
                name: 'COROSDailyReconnectRequiredError',
                message: 'COROS connection requires reconnect.',
            }),
            expect.any(Number),
            expect.objectContaining({
                requiredExistingDocumentRef: activeToken.ref,
                requiredExistingTokenCredential: expect.objectContaining({
                    accessToken: 'coros-access-token',
                }),
                requiredDocumentFieldValues: expect.objectContaining({
                    expectedFields: expect.objectContaining({
                        providerUserId: 'coros-user-1',
                        connectionStateGeneration: 'coros-generation-1',
                    }),
                }),
            }),
        );
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'coros-sleep-invalid-grant',
        }), expect.objectContaining({
            context: 'INVALID_GRANT',
            error: 'COROS connection requires reconnect.',
        }));
        expect(JSON.stringify(hoisted.markSleepSyncError.mock.calls))
            .not.toContain('private provider detail');
        expect(JSON.stringify(hoisted.batchSet.mock.calls))
            .not.toContain('private provider detail');
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
            userID: 'test-user-uid',
            providerUserId: 'other-suunto-user',
            retryCount: 0,
            type: 'suunto_webhook',
            payload: { samples: [{ SleepId: 123 }] },
            ref: queueRef as unknown as admin.firestore.DocumentReference,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.tokenRootWhere).toHaveBeenCalledWith('userName', '==', 'other-suunto-user');
        expect(hoisted.collectionGroupGet).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
            'SuuntoApp',
            expect.objectContaining({
                message: 'No SuuntoApp token found',
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

    it('does not process a COROS sleep queue item for an inactive legacy account', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        hoisted.getActiveCOROSTokenSnapshot.mockRejectedValue(Object.assign(
            new Error('The COROS account changed.'),
            { code: 'unauthenticated' },
        ));
        const queueRef = { parent: { id: 'sleepSyncQueue' } };

        const result = await processSleepSyncQueueItem({
            id: 'coros-inactive-account-sleep',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'old-coros-user',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: queueRef as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.getActiveCOROSTokenSnapshot).toHaveBeenCalledWith(
            'test-user-uid',
            'old-coros-user',
        );
        expect(hoisted.getTokenData).not.toHaveBeenCalled();
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.batchSet).toHaveBeenCalledWith(expect.objectContaining({
            id: 'coros-inactive-account-sleep',
        }), expect.objectContaining({
            context: 'NO_TOKEN_FOUND',
        }));
    });

    it('revalidates the active COROS account and bounds the daily sleep request', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({
                openId: 'coros-user-1',
                accessToken: 'coros-access-token',
                tokenCredentialGeneration: 'credential-generation-1',
            }),
            ref: {
                parent: {
                    parent: {
                        id: 'test-user-uid',
                    },
                },
            },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'coros-access-token',
            tokenCredentialGeneration: 'credential-generation-1',
        });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: { dailyList: [] },
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-bounded-sleep-request',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.getActiveCOROSTokenSnapshot).toHaveBeenNthCalledWith(
            1,
            'test-user-uid',
            'coros-user-1',
        );
        expect(hoisted.getActiveCOROSTokenSnapshot).toHaveBeenNthCalledWith(
            2,
            'test-user-uid',
            'coros-user-1',
        );
        expect(hoisted.getActiveCOROSTokenSnapshot).toHaveBeenNthCalledWith(
            3,
            'test-user-uid',
            'coros-user-1',
        );
        expect(hoisted.requestGet).toHaveBeenCalledWith(expect.objectContaining({
            json: true,
            timeout: 30_000,
            maxResponseBytes: 4 * 1024 * 1024,
            url: expect.stringContaining('openId=coros-user-1'),
        }));
            expect(hoisted.updateHealthSyncState).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({
                status: 'ready',
                lastErrorCode: null,
            }),
            expect.any(Number),
                expect.objectContaining({
                    requiredExistingDocumentRef: activeToken.ref,
                    additionalRequiredDocumentFieldValues: [expect.objectContaining({
                        expectedFields: {
                            activeOAuthCredentialGeneration: 'credential-generation-1',
                        },
                    })],
                    requiredDocumentFieldValues: expect.objectContaining({
                    expectedFields: {
                        providerUserId: 'coros-user-1',
                        connectionState: 'connected',
                        connectionStateGeneration: 'coros-generation-1',
                    },
                }),
            }),
        );
    });

    it('rejects an old COROS credential after a same-account reconnect', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const tokenRef = { parent: { parent: { id: 'test-user-uid' } } };
        const oldToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'old-access-token' }),
            ref: tokenRef,
        };
        const replacementToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'replacement-access-token' }),
            ref: tokenRef,
        };
        hoisted.getActiveCOROSTokenSnapshot
            .mockResolvedValueOnce(oldToken)
            .mockResolvedValueOnce(replacementToken);
        hoisted.getServiceConnectionMeta.mockResolvedValue({
            providerUserId: 'coros-user-1',
            connectionState: 'connected',
            connectionStateGeneration: 'replacement-generation',
        });
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'old-access-token' });
        hoisted.markSleepSyncError.mockResolvedValueOnce(false);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-same-account-reconnect',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({ message: 'COROS account validation failed.' }),
            expect.any(Number),
            expect.objectContaining({
                requiredExistingDocumentRef: tokenRef,
                requiredExistingTokenCredential: expect.objectContaining({
                    accessToken: 'old-access-token',
                }),
                requiredDocumentFieldValues: expect.objectContaining({
                    expectedFields: expect.objectContaining({
                        connectionStateGeneration: 'replacement-generation',
                    }),
                }),
            }),
        );
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'skipped',
            skippedReason: 'user_or_provider_lifecycle_changed',
            skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
        }));
    });

    it('does not let an old queue task adopt a replacement OAuth credential generation', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const tokenRef = { parent: { parent: { id: 'test-user-uid' } } };
        const initialToken = {
            id: 'coros-user-1',
            data: () => ({
                openId: 'coros-user-1',
                accessToken: 'old-access-token',
                tokenCredentialGeneration: 'credential-generation-old',
            }),
            ref: tokenRef,
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(initialToken);
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'replacement-access-token',
            tokenCredentialGeneration: 'credential-generation-new',
        });
        hoisted.markSleepSyncError.mockResolvedValueOnce(false);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-replaced-credential-generation',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.getActiveCOROSTokenSnapshot).toHaveBeenCalledOnce();
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({ message: 'COROS account validation failed.' }),
            expect.any(Number),
            expect.objectContaining({
                requiredExistingTokenCredential: expect.objectContaining({
                    accessToken: 'old-access-token',
                    credentialGeneration: 'credential-generation-old',
                }),
            }),
        );
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'skipped',
            skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
        }));
    });

    it('does not let an old queue task adopt a replacement connection generation', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const tokenRef = { parent: { parent: { id: 'test-user-uid' } } };
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({
                openId: 'coros-user-1',
                accessToken: 'coros-access-token',
                tokenCredentialGeneration: 'credential-generation-1',
            }),
            ref: tokenRef,
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getServiceConnectionMeta
            .mockResolvedValueOnce({
                providerUserId: 'coros-user-1',
                connectionState: 'connected',
                connectionStateGeneration: 'connection-generation-old',
            })
            .mockResolvedValueOnce({
                providerUserId: 'coros-user-1',
                connectionState: 'connected',
                connectionStateGeneration: 'connection-generation-new',
            });
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'coros-access-token',
            tokenCredentialGeneration: 'credential-generation-1',
        });
        hoisted.markSleepSyncError.mockResolvedValueOnce(false);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-replaced-connection-generation',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.getActiveCOROSTokenSnapshot).toHaveBeenCalledOnce();
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({ message: 'COROS account validation failed.' }),
            expect.any(Number),
            expect.objectContaining({
                requiredDocumentFieldValues: expect.objectContaining({
                    expectedFields: expect.objectContaining({
                        connectionStateGeneration: 'connection-generation-old',
                    }),
                }),
            }),
        );
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            processed: true,
            resultStatus: 'skipped',
            skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
        }));
    });

    it('retries when service metadata fails after COROS refresh resolves a new credential fence', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const tokenRef = { parent: { parent: { id: 'test-user-uid' } } };
        const initialToken = {
            id: 'coros-user-1',
            data: () => ({
                openId: 'coros-user-1',
                accessToken: 'coros-access-token',
                expiresAt: 1_000,
                dateRefreshed: 1_000,
                tokenCredentialGeneration: 'credential-generation-1',
            }),
            ref: tokenRef,
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(initialToken);
        hoisted.getServiceConnectionMeta
            .mockResolvedValueOnce({
                providerUserId: 'coros-user-1',
                connectionState: 'connected',
                connectionStateGeneration: 'coros-generation-1',
            })
            .mockRejectedValueOnce(new Error('transient metadata read failure'));
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'coros-access-token',
            expiresAt: 2_000,
            dateRefreshed: 2_000,
            tokenCredentialGeneration: 'credential-generation-1',
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-refreshed-credential-metadata-failure',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({ message: 'COROS account validation failed.' }),
            expect.any(Number),
            expect.objectContaining({
                requiredExistingDocumentRef: tokenRef,
                requiredExistingTokenCredential: expect.objectContaining({
                    accessToken: 'coros-access-token',
                    expiresAt: 2_000,
                    dateRefreshed: 2_000,
                    credentialGeneration: 'credential-generation-1',
                }),
                requiredDocumentFieldValues: expect.objectContaining({
                    expectedFields: expect.objectContaining({
                        providerUserId: 'coros-user-1',
                        connectionStateGeneration: 'coros-generation-1',
                    }),
                }),
            }),
        );
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            retryCount: 1,
            processed: false,
        }));
    });

    it('writes COROS Sleep before normalized daily Health and records both outcomes', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-29T12:00:00.000Z'));
        try {
            hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
            const activeToken = {
                id: 'coros-user-1',
                data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
                ref: { parent: { parent: { id: 'test-user-uid' } } },
            };
            hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
            hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
            hoisted.requestGet.mockResolvedValue({
                result: '0000',
                message: 'OK',
                data: {
                    dailyList: [{
                        happenDay: '20260428',
                        sleepStartTime: '2026-04-27 22:15:00',
                        sleepEndTime: '2026-04-28 06:45:00',
                        step: 9_876,
                        calorie: 955,
                        rhr: 56,
                        ppgHrv: 50,
                        sleepAvgHr: 58,
                        hrvList: [{
                            hrv: 25,
                            hr: 60,
                            timestamp: Date.parse('2026-04-28T03:00:00.000Z') / 1000,
                        }],
                    }],
                },
            });
            hoisted.upsertSleepSessions.mockResolvedValue({ written: 1, skipped: 0 });
            const update = vi.fn().mockResolvedValue(undefined);

            const result = await processSleepSyncQueueItem({
                id: 'coros-daily-health',
                dateCreated: 1_700_000_000_000,
                dispatchedToCloudTask: 1_700_000_000_500,
                processed: false,
                provider: 'COROSAPI',
                userID: 'test-user-uid',
                providerUserId: 'coros-user-1',
                retryCount: 0,
                type: 'coros_poll',
                rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
                rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
                ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.buildSleepSessionDocumentId).toHaveBeenCalledWith(
                'test-user-uid',
                'COROSAPI',
                '20260428:2026-04-27 22:15:00:2026-04-28 06:45:00',
            );
            expect(hoisted.upsertSleepSessions).toHaveBeenCalledBefore(hoisted.replaceHealthSourceRecord);
            expect(hoisted.replaceHealthSourceRecord).toHaveBeenCalledWith(
                'test-user-uid',
                expect.objectContaining({
                    sourceRecordType: 'coros_daily',
                    sourceRecordKey: '20260428',
                    providerAccountId: 'coros-user-1',
                    sampleSeries: expect.arrayContaining([
                        expect.objectContaining({ nativeMetric: 'hrvList.hrv' }),
                        expect.objectContaining({ nativeMetric: 'hrvList.hr' }),
                    ]),
                }),
                expect.any(Number),
                expect.objectContaining({
                    requiredExistingDocumentRef: activeToken.ref,
                    requiredExistingTokenCredential: expect.objectContaining({
                        accessToken: 'coros-access-token',
                    }),
                    requiredDocumentFieldValues: expect.objectContaining({
                        expectedFields: expect.objectContaining({
                            providerUserId: 'coros-user-1',
                            connectionStateGeneration: 'coros-generation-1',
                        }),
                    }),
                }),
            );
            expect(hoisted.updateHealthSyncState).toHaveBeenCalledAfter(hoisted.replaceHealthSourceRecord);
            expect(update).toHaveBeenCalledWith(expect.objectContaining({
                resultStatus: 'success',
                sessionsWritten: 1,
                sessionsSkipped: 0,
                healthRecordsWritten: 1,
                healthRecordsUnchanged: 0,
                healthRecordsStale: 0,
            }));
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a no-sleep COROS day and lets the final duplicate row replace earlier content', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: {
                dailyList: [
                    { happenDay: '20260428', step: 1 },
                    { happenDay: '20260428', step: 2 },
                ],
            },
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-no-sleep-duplicate-day',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.upsertSleepSessions).toHaveBeenCalledWith(
            'test-user-uid',
            [],
            expect.any(Number),
            expect.objectContaining({
                requiredExistingDocumentRef: activeToken.ref,
                requiredDocumentFieldValues: expect.objectContaining({
                    expectedFields: expect.objectContaining({
                        providerUserId: 'coros-user-1',
                        connectionStateGeneration: 'coros-generation-1',
                    }),
                }),
            }),
        );
        expect(hoisted.replaceHealthSourceRecord).toHaveBeenCalledTimes(1);
        expect(hoisted.replaceHealthSourceRecord).toHaveBeenCalledWith(
            'test-user-uid',
            expect.objectContaining({
                sourceRecordKey: '20260428',
                metrics: [expect.objectContaining({
                    metricId: 'steps',
                    canonical: { value: 2, unit: 'count' },
                })],
            }),
            expect.any(Number),
            expect.objectContaining({
                requiredExistingDocumentRef: activeToken.ref,
                requiredDocumentFieldValues: expect.objectContaining({
                    expectedFields: expect.objectContaining({
                        providerUserId: 'coros-user-1',
                        connectionStateGeneration: 'coros-generation-1',
                    }),
                }),
            }),
        );
    });

    it('stops the queue transition when the active COROS token disappears before Health writes', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: { dailyList: [{ happenDay: '20260428', step: 1_000 }] },
        });
        hoisted.replaceHealthSourceRecord.mockResolvedValueOnce({
            status: 'skipped_lifecycle_guard',
            sourceRecordId: 'health-record-id',
            sourceRecord: null,
            chunksWritten: 0,
            chunksDeleted: 0,
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-token-removed-before-health-write',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.updateHealthSyncState).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            resultStatus: 'skipped',
            skippedReason: 'provider_disconnected_during_sync',
            skippedContext: 'PROVIDER_LIFECYCLE_GUARD',
        }));
    });

    it('stops before Health when the COROS token disappears inside the Sleep write transaction', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: {
                dailyList: [{
                    happenDay: '20260428',
                    sleepStartTime: '2026-04-27 22:00:00',
                    sleepEndTime: '2026-04-28 06:00:00',
                    step: 1_000,
                }],
            },
        });
        hoisted.upsertSleepSessions.mockResolvedValueOnce({
            written: 0,
            skipped: 1,
            lifecycleGuardSkipped: true,
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-token-removed-inside-sleep-write',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(hoisted.updateHealthSyncState).not.toHaveBeenCalled();
        expect(hoisted.updateSleepSyncState).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            resultStatus: 'skipped',
            skippedReason: 'provider_disconnected_during_sync',
            skippedContext: 'PROVIDER_LIFECYCLE_GUARD',
            sessionsWritten: 0,
            sessionsSkipped: 1,
        }));
    });

    it('does not mark Sleep ready when the token disappears before the final Health state guard', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: { dailyList: [] },
        });
        hoisted.updateHealthSyncState.mockResolvedValueOnce(false);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-token-removed-before-ready-state',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.updateSleepSyncState).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            resultStatus: 'skipped',
            skippedReason: 'user_or_provider_lifecycle_changed',
            skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
        }));
    });

    it('does not mark a stale COROS queue successful when the final Sleep state lifecycle guard fails', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: { dailyList: [] },
        });
        hoisted.updateSleepSyncState.mockResolvedValueOnce(false);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-generation-changed-before-sleep-ready-state',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.updateHealthSyncState).toHaveBeenCalledOnce();
        expect(hoisted.updateSleepSyncState).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({ status: 'ready' }),
            expect.any(Number),
            expect.objectContaining({
                requiredExistingDocumentRef: activeToken.ref,
                requiredDocumentFieldValues: expect.objectContaining({
                    expectedFields: expect.objectContaining({
                        providerUserId: 'coros-user-1',
                        connectionStateGeneration: 'coros-generation-1',
                    }),
                }),
            }),
        );
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            resultStatus: 'skipped',
            skippedReason: 'user_or_provider_lifecycle_changed',
            skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
        }));
    });

    it('rejects a COROS response beyond the 30-row provider boundary', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: { dailyList: Array.from({ length: 31 }, () => ({})) },
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-too-many-daily-rows',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-01T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-30T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            errors: [expect.objectContaining({
                error: 'COROS daily response exceeds the bounded record count.',
            })],
        }));
    });

    it('rejects malformed COROS response data instead of recording an empty success', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({ result: '0000', message: 'OK', data: {} });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-malformed-daily-shape',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            errors: [expect.objectContaining({
                error: 'COROS daily response must contain a dailyList array.',
            })],
        }));
    });

    it('rejects a COROS daily response without an explicit success result', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({ message: 'OK', data: { dailyList: [] } });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-missing-daily-result',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            errors: [expect.objectContaining({
                error: 'COROS daily data request failed with result unknown.',
            })],
        }));
    });

    it('rejects a COROS daily row outside the requested provider date range', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: { dailyList: [{ happenDay: '20260429', step: 1_000 }] },
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-out-of-range-daily-row',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            errors: [expect.objectContaining({
                error: 'COROS daily response contains a date outside the requested range.',
            })],
        }));
    });

    it('rejects a COROS daily row without a valid provider date', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: {
                dailyList: [{
                    sleepStartTime: '2025-01-01 22:00:00',
                    sleepEndTime: '2025-01-02 06:00:00',
                }],
            },
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-missing-daily-row-date',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            errors: [expect.objectContaining({
                error: 'COROS daily response contains a row without a valid provider date.',
            })],
        }));
    });

    it('rejects a COROS poll range beyond 30 inclusive calendar dates before the request', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-too-wide-daily-range',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-01T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-05-01T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            errors: [expect.objectContaining({
                error: 'COROS daily poll range exceeds the bounded daily range.',
            })],
        }));
    });

    it('retries instead of recording success when COROS daily data returns a failure result', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: {
                parent: {
                    parent: {
                        id: 'test-user-uid',
                    },
                },
            },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValue(activeToken);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({ result: '5006', message: 'Token expired' });
        hoisted.updateHealthSyncState.mockRejectedValueOnce(new Error('Health state unavailable'));
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-failed-daily-response',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            retryCount: 1,
            dispatchedToCloudTask: null,
            errors: [expect.objectContaining({
                error: 'COROS daily data request failed with result 5006.',
            })],
        }));
    });

    it('defers a COROS sleep poll when disconnect starts after token refresh', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: {
                parent: {
                    parent: {
                        id: 'test-user-uid',
                    },
                },
            },
        };
        const pendingDisconnectError = Object.assign(new Error('COROS disconnect is pending.'), {
            name: 'TokenUseSkippedForPendingDisconnectError',
            code: 'failed-precondition',
            firebaseUserID: 'test-user-uid',
            serviceName: ServiceNames.COROSAPI,
        });
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => ({
                disconnectState: 'disconnect_pending',
                disconnectGeneration: 'coros-pending-generation',
            }),
        });
        hoisted.getActiveCOROSTokenSnapshot
            .mockResolvedValueOnce(activeToken)
            .mockRejectedValueOnce(pendingDisconnectError);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-disconnect-race-sleep',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: 1_777_392_000_000,
            rangeEndMs: 1_777_478_400_000,
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Deferred);
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            resultStatus: 'deferred',
            deferredReason: 'service_disconnect_pending',
        }));
    });

    it('defers COROS without persisting when disconnect starts during the daily request', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({ openId: 'coros-user-1', accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        const pendingDisconnectError = Object.assign(new Error('COROS disconnect is pending.'), {
            name: 'TokenUseSkippedForPendingDisconnectError',
            code: 'failed-precondition',
            firebaseUserID: 'test-user-uid',
            serviceName: ServiceNames.COROSAPI,
        });
        hoisted.docGet.mockResolvedValue({
            exists: true,
            data: () => ({
                disconnectState: 'disconnect_pending',
                disconnectGeneration: 'coros-pending-generation',
            }),
        });
        hoisted.getActiveCOROSTokenSnapshot
            .mockResolvedValueOnce(activeToken)
            .mockResolvedValueOnce(activeToken)
            .mockRejectedValueOnce(pendingDisconnectError);
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: { dailyList: [{ happenDay: '20260428', step: 1_000 }] },
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-disconnect-during-request',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Deferred);
        expect(hoisted.requestGet).toHaveBeenCalledOnce();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            resultStatus: 'deferred',
            deferredReason: 'service_disconnect_pending',
        }));
    });

    it('keeps the raw COROS account id out of error telemetry when the account changes during the daily request', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const privateProviderUserId = 'private-coros-account-id';
        const activeToken = {
            id: privateProviderUserId,
            data: () => ({ openId: privateProviderUserId, accessToken: 'coros-access-token' }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot
            .mockResolvedValueOnce(activeToken)
            .mockResolvedValueOnce(activeToken)
            .mockRejectedValueOnce(Object.assign(new Error('The COROS account changed.'), {
                code: 'unauthenticated',
            }));
        hoisted.getServiceConnectionMeta.mockResolvedValue({
            providerUserId: privateProviderUserId,
            connectionState: 'connected',
            connectionStateGeneration: 'private-coros-generation',
        });
        hoisted.getTokenData.mockResolvedValue({ accessToken: 'coros-access-token' });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: { dailyList: [{ happenDay: '20260428', step: 1_000 }] },
        });
        const queueRef = { parent: { id: 'sleepSyncQueue' } };

        const result = await processSleepSyncQueueItem({
            id: 'coros-account-change-during-request',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: privateProviderUserId,
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: queueRef as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.MovedToDLQ);
        expect(hoisted.requestGet).toHaveBeenCalledOnce();
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({ message: 'No COROSAPI token found' }),
            expect.any(Number),
            expect.objectContaining({
                requiredExistingDocumentRef: activeToken.ref,
                requiredDocumentFieldValues: expect.any(Object),
            }),
        );
        const failedItem = hoisted.batchSet.mock.calls[0]?.[1] as Record<string, unknown>;
        expect(failedItem).toMatchObject({
            context: 'NO_TOKEN_FOUND',
            error: 'No COROSAPI token found',
            providerUserId: privateProviderUserId,
        });
        expect(`${failedItem.error}`).not.toContain(privateProviderUserId);
        expect(hoisted.loggerWarn.mock.calls.flat().join(' ')).not.toContain(privateProviderUserId);
    });

    it('does not recreate a failed job when deletion starts during a COROS daily request', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const activeToken = {
            id: 'coros-user-1',
            data: () => ({
                openId: 'coros-user-1',
                accessToken: 'coros-access-token',
                tokenCredentialGeneration: 'credential-generation-1',
            }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot
            .mockResolvedValueOnce(activeToken)
            .mockResolvedValueOnce(activeToken)
            .mockRejectedValueOnce(Object.assign(new Error('Token root deleted'), {
                code: 'unauthenticated',
            }));
        hoisted.getTokenData.mockResolvedValue({
            accessToken: 'coros-access-token',
            tokenCredentialGeneration: 'credential-generation-1',
        });
        hoisted.requestGet.mockResolvedValue({
            result: '0000',
            message: 'OK',
            data: { dailyList: [{ happenDay: '20260428', step: 1_000 }] },
        });
        hoisted.markSleepSyncError.mockResolvedValueOnce(false);
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
            userExists: true,
            deletionInProgress: true,
            shouldSkip: true,
        });
        const queueRef = { parent: { id: 'sleepSyncQueue' } };

        const result = await processSleepSyncQueueItem({
            id: 'coros-deletion-during-request',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: 'coros-user-1',
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: queueRef as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.requestGet).toHaveBeenCalledOnce();
        expect(hoisted.batchSet).not.toHaveBeenCalled();
        expect(hoisted.docSet).not.toHaveBeenCalled();
        expect(hoisted.recursiveDelete).toHaveBeenCalledWith(queueRef);
    });

    it('keeps COROS transport and response details out of durable error telemetry', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const privateProviderUserId = 'private-coros-account-id';
        const privateAccessToken = 'private-coros-access-token';
        const privateResponseDetail = 'private-provider-response-detail';
        const initialToken = {
            id: privateProviderUserId,
            data: () => ({
                openId: privateProviderUserId,
                accessToken: privateAccessToken,
                expiresAt: 1_000,
                dateRefreshed: 1_000,
                tokenCredentialGeneration: 'private-credential-generation',
            }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        const refreshedToken = {
            ...initialToken,
            data: () => ({
                openId: privateProviderUserId,
                accessToken: privateAccessToken,
                expiresAt: 2_000,
                dateRefreshed: 2_000,
                tokenCredentialGeneration: 'private-credential-generation',
            }),
        };
        hoisted.getActiveCOROSTokenSnapshot
            .mockResolvedValueOnce(initialToken)
            .mockResolvedValueOnce(refreshedToken);
        hoisted.getServiceConnectionMeta.mockResolvedValue({
            providerUserId: privateProviderUserId,
            connectionState: 'connected',
            connectionStateGeneration: 'private-coros-generation',
        });
        hoisted.getTokenData.mockResolvedValue({
            accessToken: privateAccessToken,
            expiresAt: 2_000,
            dateRefreshed: 2_000,
            tokenCredentialGeneration: 'private-credential-generation',
        });
        hoisted.requestGet.mockRejectedValue(Object.assign(
            new Error(`Failed URL contains ${privateAccessToken}`),
            { error: { message: privateResponseDetail } },
        ));
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-private-provider-error',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: privateProviderUserId,
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({ message: 'COROS daily data request failed.' }),
            expect.any(Number),
            expect.objectContaining({
                requiredExistingDocumentRef: refreshedToken.ref,
                requiredExistingTokenCredential: expect.objectContaining({
                    expiresAt: 2_000,
                    dateRefreshed: 2_000,
                    credentialGeneration: 'private-credential-generation',
                }),
                requiredDocumentFieldValues: expect.any(Object),
            }),
        );
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            errors: [expect.objectContaining({
                error: 'COROS daily data request failed.',
            })],
        }));
        const errorLog = hoisted.loggerError.mock.calls.flat().join(' ');
        expect(errorLog).not.toContain(privateProviderUserId);
        expect(errorLog).not.toContain(privateAccessToken);
        expect(errorLog).not.toContain(privateResponseDetail);
    });

    it('keeps COROS token-refresh and datastore details out of durable error telemetry', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const privateProviderUserId = 'private-coros-account-id';
        const privateAccessToken = 'private-coros-access-token';
        const privateRefreshDetail = `Refresh failed at COROSAPIAccessTokens/test-user-uid/tokens/${privateProviderUserId} with ${privateAccessToken}`;
        const activeToken = {
            id: privateProviderUserId,
            data: () => ({
                openId: privateProviderUserId,
                accessToken: privateAccessToken,
                refreshToken: 'private-coros-refresh-token',
                expiresAt: 1_000,
                dateRefreshed: 1_000,
                tokenCredentialGeneration: 'private-credential-generation',
            }),
            ref: { parent: { parent: { id: 'test-user-uid' } } },
        };
        hoisted.getActiveCOROSTokenSnapshot.mockResolvedValueOnce(activeToken);
        hoisted.getServiceConnectionMeta.mockResolvedValue({
            providerUserId: privateProviderUserId,
            connectionState: 'connected',
            connectionStateGeneration: 'private-coros-generation',
        });
        hoisted.getTokenData.mockRejectedValueOnce(new Error(privateRefreshDetail));
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-private-token-refresh-error',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: privateProviderUserId,
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).toHaveBeenCalledWith(
            'test-user-uid',
            'COROSAPI',
            expect.objectContaining({ message: 'COROS daily synchronization failed.' }),
            expect.any(Number),
            expect.objectContaining({
                requiredExistingDocumentRef: activeToken.ref,
                requiredDocumentFieldValues: expect.any(Object),
            }),
        );
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            errors: [expect.objectContaining({
                error: 'COROS daily synchronization failed.',
            })],
        }));
        const durableTelemetry = [
            ...hoisted.markSleepSyncError.mock.calls.flat(),
            ...hoisted.loggerError.mock.calls.flat(),
            ...update.mock.calls.flat(),
        ].join(' ');
        expect(durableTelemetry).not.toContain(privateProviderUserId);
        expect(durableTelemetry).not.toContain(privateAccessToken);
        expect(durableTelemetry).not.toContain(privateRefreshDetail);
    });

    it('keeps token-document paths out of retry telemetry when account validation fails', async () => {
        hoisted.disabledProviders.splice(0, hoisted.disabledProviders.length, 'GarminAPI');
        const privateProviderUserId = 'private-coros-account-id';
        hoisted.getActiveCOROSTokenSnapshot.mockRejectedValueOnce(new Error(
            `Firestore read failed at corosAPIAccessTokens/test-user-uid/tokens/${privateProviderUserId}`,
        ));
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: 'coros-private-account-validation-error',
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'COROSAPI',
            userID: 'test-user-uid',
            providerUserId: privateProviderUserId,
            retryCount: 0,
            type: 'coros_poll',
            rangeStartMs: Date.parse('2026-04-28T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-04-28T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.RetryIncremented);
        expect(hoisted.requestGet).not.toHaveBeenCalled();
        expect(hoisted.markSleepSyncError).not.toHaveBeenCalled();
        expect(hoisted.updateHealthSyncState).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            errors: [expect.objectContaining({ error: 'COROS account validation failed.' })],
        }));
        expect(hoisted.loggerError.mock.calls.flat().join(' ')).not.toContain(privateProviderUserId);
    });

    it.each([
        {
            healthTrigger: 'webhook' as const,
            expectedLastPollAtMs: undefined,
            expectedLastWebhookAtMs: expect.any(Number),
        },
        {
            healthTrigger: 'backfill' as const,
            expectedLastPollAtMs: undefined,
            expectedLastWebhookAtMs: undefined,
        },
    ])('writes staged Suunto Health for a $healthTrigger trigger without creating or updating Sleep records', async ({
        healthTrigger,
        expectedLastPollAtMs,
        expectedLastWebhookAtMs,
    }) => {
        const stagedUserID = 'xcsAolLDDTWTgtRN9eYF3lW2YKL2';
        const tokenRef = {
            path: `suuntoAppAccessTokens/${stagedUserID}/tokens/suunto-user-1`,
            parent: { parent: { id: stagedUserID } },
        };
        const tokenSnapshot = {
            id: 'suunto-user-1',
            data: () => ({
                userName: 'suunto-user-1',
                accessToken: 'suunto-access-token',
                refreshToken: 'suunto-refresh-token',
                tokenCredentialGeneration: 'suunto-credential-generation-1',
            }),
            ref: tokenRef,
        };
        hoisted.tokenRootGet.mockResolvedValue({ docs: [tokenSnapshot], empty: false });
        const lifecycleGuards = {
            requiredExistingDocumentRef: tokenRef,
            requiredExistingTokenCredential: { accessToken: 'suunto-access-token' },
            requiredDocumentFieldValues: {
                expectedFields: { connectionStateGeneration: 'suunto-generation-1' },
            },
            additionalRequiredDocumentFieldValues: [],
        };
        hoisted.captureSuuntoHealthWriteLifecycleGuards.mockResolvedValue(lifecycleGuards);
        hoisted.processSuuntoHealthQueueItem.mockResolvedValue({
            healthResults: [{
                input: {
                    provider: 'SuuntoApp',
                    sourceRecordType: 'suunto_247_activity',
                    sourceRecordKey: '2026-08-26:0',
                },
                observedAtMs: Date.parse('2026-08-26T12:00:00.000Z'),
            }],
            lifecycleGuards,
        });
        const update = vi.fn().mockResolvedValue(undefined);

        const result = await processSleepSyncQueueItem({
            id: `suunto-health-${healthTrigger}`,
            dateCreated: 1_700_000_000_000,
            dispatchedToCloudTask: 1_700_000_000_500,
            processed: false,
            provider: 'SuuntoApp',
            userID: stagedUserID,
            providerUserId: 'suunto-user-1',
            retryCount: 0,
            type: 'suunto_health_poll',
            healthTrigger,
            rangeStartMs: Date.parse('2026-08-26T00:00:00.000Z'),
            rangeEndMs: Date.parse('2026-08-27T00:00:00.000Z'),
            ref: { update } as unknown as NonNullable<SleepSyncQueueItemInterface['ref']>,
        });

        expect(result).toBe(QueueResult.Processed);
        expect(hoisted.processSuuntoHealthQueueItem).toHaveBeenCalled();
        expect(hoisted.replaceHealthSourceRecord).toHaveBeenCalledWith(
            stagedUserID,
            expect.objectContaining({ sourceRecordType: 'suunto_247_activity' }),
            expect.any(Number),
            lifecycleGuards,
        );
        expect(hoisted.updateHealthSyncState).toHaveBeenCalledWith(
            stagedUserID,
            'SuuntoApp',
            expect.objectContaining({
                status: 'ready',
                lastPollAtMs: expectedLastPollAtMs,
                lastWebhookAtMs: expectedLastWebhookAtMs,
                lastErrorCode: null,
            }),
            expect.any(Number),
            lifecycleGuards,
        );
        expect(hoisted.upsertSleepSessions).not.toHaveBeenCalled();
        expect(hoisted.updateSleepSyncState).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            resultStatus: 'success',
            sessionsWritten: 0,
            healthRecordsWritten: 1,
        }));
    });
});
