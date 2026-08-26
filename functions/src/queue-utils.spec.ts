import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { deferQueueItemForPendingDisconnect, deferQueueItemForPendingDisconnectIfCurrentUserActive, deferQueueItemForReconnectRequiredIfCurrentUserActive, moveToDeadLetterQueue, moveToDeadLetterQueueIfCurrentUserActive, increaseRetryCountForQueueItem, increaseRetryCountIfCurrentUserActive, isCurrentSleepQueueTransition, isProviderOperationInFlightLeaseActive, markQueueItemSkipped, PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER, PROVIDER_OPERATION_IN_FLIGHT_LEASE_MS, PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER, QUEUE_DEFERRED_REASONS, QUEUE_SKIPPED_REASONS, updateToProcessed, QueueResult } from './queue-utils';
import { TTL_CONFIG } from './shared/ttl-config';

// Hoisted Firestore mocks
const hoisted = vi.hoisted(() => {
    const batch = {
        set: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn(),
    };
    const bulkWriter = {
        set: vi.fn(),
        delete: vi.fn(),
    };
    const transaction = {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
    };
    const runTransaction = vi.fn(async (runner: (transactionValue: typeof transaction) => unknown) => runner(transaction));
    const getUserDeletionGuardStateInTransaction = vi.fn();
    const cleanupQueueItemAfterUserDeletionGuard = vi.fn();
    const pendingDisconnectRootRef = { id: 'pending-root', path: 'tokens/user-1' };
    const createCollection = (id: string) => ({
        id,
        doc: vi.fn((documentId: string) => ({
            id: documentId,
            parent: { id },
            collection: vi.fn((subcollectionId: string) => createCollection(subcollectionId)),
        })),
    });
    const collection = vi.fn((id: string) => createCollection(id));
    const firestore = () => ({
        batch: vi.fn(() => batch),
        collection,
        runTransaction,
    });
    const timestampFromDate = vi.fn((date) => date);
    const fieldValueDelete = Symbol('FIELD_VALUE_DELETE');
    return {
        batch,
        bulkWriter,
        cleanupQueueItemAfterUserDeletionGuard,
        pendingDisconnectRootRef,
        collection,
        firestore,
        fieldValueDelete,
        getUserDeletionGuardStateInTransaction,
        runTransaction,
        timestampFromDate,
        transaction,
    };
});

vi.mock('firebase-admin', () => ({
    default: {
        firestore: hoisted.firestore,
    },
    firestore: hoisted.firestore,
}));

vi.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        delete: vi.fn(() => hoisted.fieldValueDelete),
    },
    Timestamp: {
        fromDate: hoisted.timestampFromDate,
    },
}));

vi.mock('./shared/user-deletion-guard', () => ({
    getUserDeletionGuardStateInTransaction: hoisted.getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
        constructor(
            public readonly uid: string,
            public readonly phase: string,
            public readonly originalError: unknown,
        ) {
            super(`Could not read deletion guard for user ${uid} during ${phase}.`);
        }
    },
}));

vi.mock('./queue/dispatch-marker', () => ({
    cleanupQueueItemAfterUserDeletionGuard: hoisted.cleanupQueueItemAfterUserDeletionGuard,
    QueueItemUserGuardedUpdateResult: {
        Updated: 'updated',
        SkippedDeletedUser: 'skipped_deleted_user',
        NotCurrent: 'not_current',
    },
}));

vi.mock('./service-token-store', () => ({
    getServiceTokenRootDocumentRef: vi.fn(() => hoisted.pendingDisconnectRootRef),
}));

describe('queue-utils', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.batch.set.mockReset();
        hoisted.batch.delete.mockReset();
        hoisted.batch.commit.mockReset();
        hoisted.bulkWriter.set.mockReset();
        hoisted.bulkWriter.delete.mockReset();
        hoisted.transaction.get.mockReset();
        hoisted.transaction.set.mockReset();
        hoisted.transaction.delete.mockReset();
        hoisted.transaction.update.mockReset();
        hoisted.runTransaction.mockClear();
        hoisted.getUserDeletionGuardStateInTransaction.mockReset();
        hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValue({
            userExists: true,
            deletionInProgress: false,
            shouldSkip: false,
        });
        hoisted.cleanupQueueItemAfterUserDeletionGuard.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('provider operation claim lease', () => {
        it('treats only a recent in-flight marker as active', () => {
            const nowMs = 1_800_000_000_000;
            expect(isProviderOperationInFlightLeaseActive({
                dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
                providerOperationStartedAt: nowMs - PROVIDER_OPERATION_IN_FLIGHT_LEASE_MS + 1,
            }, nowMs)).toBe(true);
            expect(isProviderOperationInFlightLeaseActive({
                dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
                providerOperationStartedAt: nowMs - PROVIDER_OPERATION_IN_FLIGHT_LEASE_MS,
            }, nowMs)).toBe(false);
            expect(isProviderOperationInFlightLeaseActive({
                dispatchedToCloudTask: null,
                providerOperationStartedAt: nowMs,
            }, nowMs)).toBe(false);
        });
    });

    describe('Sleep queue transition identity', () => {
        const currentRevision = {
            queueRevision: 'revision-2',
            dateCreated: 200,
            processed: false,
            processingOwner: 'active-worker',
            processingRevision: 'revision:revision-2',
            processingLeaseExpiresAt: Number.MAX_SAFE_INTEGER,
        };

        it('rejects an unclaimed transition while the matching revision has an active lease', () => {
            expect(isCurrentSleepQueueTransition(currentRevision, {
                queueRevision: 'revision-2',
                dateCreated: 200,
            } as any)).toBe(false);
        });

        it('allows the matching lease owner to transition the matching revision', () => {
            expect(isCurrentSleepQueueTransition(currentRevision, {
                queueRevision: 'revision-2',
                dateCreated: 200,
                processingOwner: 'active-worker',
                processingRevision: 'revision:revision-2',
            } as any)).toBe(true);
        });

        it('allows recovery after the matching revision lease expires', () => {
            expect(isCurrentSleepQueueTransition({
                ...currentRevision,
                processingLeaseExpiresAt: Date.now() - 1,
            }, {
                queueRevision: 'revision-2',
                dateCreated: 200,
            } as any)).toBe(true);
        });
    });

    describe('moveToDeadLetterQueue', () => {
        it('uses bulkWriter when provided', async () => {
            const queueItem: any = {
                id: 'q1',
                ref: { parent: { id: 'orig' }, id: 'doc1' },
                retryCount: 0,
            };
            const result = await moveToDeadLetterQueue(queueItem, new Error('boom'), hoisted.bulkWriter as any, 'CTX');

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(hoisted.bulkWriter.set).toHaveBeenCalled();
            expect(hoisted.bulkWriter.delete).toHaveBeenCalledWith(queueItem.ref);
        });

        it('returns Failed when batch commit throws', async () => {
            hoisted.batch.commit.mockRejectedValue(new Error('db down'));
            const queueItem: any = {
                id: 'q2',
                ref: { parent: { id: 'orig' }, id: 'doc2' },
            };

            const result = await moveToDeadLetterQueue(queueItem, new Error('fail'));

            expect(hoisted.batch.commit).toHaveBeenCalled();
            expect(result).toBe(QueueResult.Failed);
        });

        it('throws when ref is missing', async () => {
            await expect(moveToDeadLetterQueue({ id: 'x' } as any, new Error('no ref'))).rejects.toThrow(/No document reference supplied/);
        });
    });

    describe('moveToDeadLetterQueueIfCurrentUserActive', () => {
        it('atomically moves the expected live revision and strips signed continuation state', async () => {
            const queueItem: any = {
                id: 'guarded-q1',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-q1' },
                dateCreated: 1,
                retryCount: 0,
                destinationUploadContinuation: {
                    type: 'suunto_blob_put_v1',
                    uploadUrl: 'https://blob.example/signed',
                    uploadHeaders: { Authorization: 'secret' },
                },
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({ revision: 'expected' }),
            });

            const result = await moveToDeadLetterQueueIfCurrentUserActive({
                queueItem,
                error: new Error('terminal'),
                context: 'PROVIDER_TERMINAL',
                userID: 'user-1',
                phase: 'provider_dlq',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(hoisted.transaction.set).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'guarded-q1' }),
                expect.not.objectContaining({ destinationUploadContinuation: expect.anything() }),
            );
            expect(hoisted.transaction.delete).toHaveBeenCalledWith(queueItem.ref);
            expect(hoisted.batch.commit).not.toHaveBeenCalled();
        });

        it('copies fail-closed work to DLQ and retains a terminal live reconciliation marker', async () => {
            const queueItem: any = {
                id: 'guarded-q-manual',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-q-manual' },
                destinationUploadID: 'upload-1',
                destinationUploadContinuation: {
                    uploadUrl: 'https://blob.example/signed',
                },
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({ revision: 'expected' }),
            });

            const result = await moveToDeadLetterQueueIfCurrentUserActive({
                queueItem,
                error: new Error('provider outcome unknown'),
                context: 'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
                userID: 'user-1',
                phase: 'provider_dlq',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
                manualReconciliation: {
                    additionalData: {
                        destinationUploadID: 'upload-1',
                        destinationUploadContinuation: null,
                    },
                },
            });

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(hoisted.transaction.set).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'guarded-q-manual' }),
                expect.not.objectContaining({ destinationUploadContinuation: expect.anything() }),
            );
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: true,
                resultStatus: 'manual_reconciliation_required',
                manualReconciliationContext: 'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
                destinationUploadID: 'upload-1',
                destinationUploadContinuation: null,
                expireAt: hoisted.fieldValueDelete,
            }));
            expect(hoisted.transaction.delete).not.toHaveBeenCalled();
        });

        it('does not delete or overwrite a queue item whose provider state advanced', async () => {
            const queueItem: any = {
                id: 'guarded-q2',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-q2' },
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({ revision: 'newer' }),
            });

            const result = await moveToDeadLetterQueueIfCurrentUserActive({
                queueItem,
                error: new Error('stale failure'),
                userID: 'user-1',
                phase: 'provider_dlq',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.transaction.set).not.toHaveBeenCalled();
            expect(hoisted.transaction.delete).not.toHaveBeenCalled();
        });

        it('runs deletion-safe cleanup instead of creating a failed job for a deleting user', async () => {
            const queueItem: any = {
                id: 'guarded-q3',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-q3' },
            };
            hoisted.getUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
                userExists: true,
                deletionInProgress: true,
                shouldSkip: true,
            });

            const result = await moveToDeadLetterQueueIfCurrentUserActive({
                queueItem,
                error: new Error('terminal'),
                userID: 'user-1',
                phase: 'provider_dlq',
                logPrefix: 'ProviderQueue',
                isCurrent: () => true,
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.transaction.set).not.toHaveBeenCalled();
            expect(hoisted.transaction.delete).not.toHaveBeenCalled();
            expect(hoisted.cleanupQueueItemAfterUserDeletionGuard).toHaveBeenCalledWith({
                queueItemDocument: queueItem.ref,
                queueItemId: queueItem.id,
                logPrefix: 'ProviderQueue',
                actionDescription: 'DLQ move',
            });
        });
    });

    describe('increaseRetryCountIfCurrentUserActive', () => {
        it('increments retry state from the current transaction snapshot', async () => {
            const queueItem: any = {
                id: 'guarded-retry-1',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-retry-1' },
                retryCount: 1,
                totalRetryCount: 2,
                errors: [],
                dispatchedToCloudTask: 123,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    revision: 'expected',
                    retryCount: 3,
                    totalRetryCount: 5,
                    errors: [{ error: 'old', atRetryCount: 5, date: 1 }],
                }),
            });

            const result = await increaseRetryCountIfCurrentUserActive({
                queueItem,
                error: new Error('retry me'),
                userID: 'user-1',
                phase: 'provider_retry',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.RetryIncremented);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                retryCount: 4,
                totalRetryCount: 6,
                dispatchedToCloudTask: null,
                errors: [
                    { error: 'old', atRetryCount: 5, date: 1 },
                    expect.objectContaining({ error: 'retry me', atRetryCount: 6 }),
                ],
            }));
            expect(queueItem).toEqual(expect.objectContaining({
                retryCount: 4,
                totalRetryCount: 6,
                dispatchedToCloudTask: null,
            }));
        });

        it('atomically moves the current item to DLQ when the guarded retry budget is exhausted', async () => {
            const queueItem: any = {
                id: 'guarded-retry-2',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-retry-2' },
                retryCount: 0,
                dispatchedToCloudTask: 123,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    revision: 'expected',
                    retryCount: 9,
                    totalRetryCount: 9,
                    destinationUploadContinuation: {
                        uploadUrl: 'https://blob.example/signed',
                    },
                }),
            });

            const result = await increaseRetryCountIfCurrentUserActive({
                queueItem,
                error: new Error('last retry'),
                maxRetryDlqContext: 'PROVIDER_RETRY_EXHAUSTED',
                userID: 'user-1',
                phase: 'provider_retry',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(hoisted.transaction.set).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'guarded-retry-2' }),
                expect.objectContaining({
                    retryCount: 10,
                    totalRetryCount: 10,
                    context: 'PROVIDER_RETRY_EXHAUSTED',
                }),
            );
            const failedPayload = hoisted.transaction.set.mock.calls[0][1];
            expect(failedPayload).not.toHaveProperty('destinationUploadContinuation');
            expect(hoisted.transaction.delete).toHaveBeenCalledWith(queueItem.ref);
            expect(hoisted.transaction.update).not.toHaveBeenCalled();
        });

        it('retains a manual-reconciliation blocker when a resumable provider upload exhausts retries', async () => {
            const queueItem: any = {
                id: 'guarded-retry-manual',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-retry-manual' },
                retryCount: 9,
                totalRetryCount: 9,
                dispatchedToCloudTask: 123,
                destinationUploadID: 'upload-1',
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    revision: 'expected',
                    retryCount: 9,
                    totalRetryCount: 9,
                    destinationUploadID: 'upload-1',
                }),
            });

            const result = await increaseRetryCountIfCurrentUserActive({
                queueItem,
                error: new Error('last status retry'),
                maxRetryDlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
                userID: 'user-1',
                phase: 'provider_retry',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
                manualReconciliation: {
                    additionalData: {
                        destinationUploadID: 'upload-1',
                        destinationUploadContinuation: null,
                    },
                },
            });

            expect(result).toBe(QueueResult.MovedToDLQ);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                retryCount: 10,
                totalRetryCount: 10,
                processed: true,
                resultStatus: 'manual_reconciliation_required',
                manualReconciliationContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
                destinationUploadID: 'upload-1',
                destinationUploadContinuation: null,
                expireAt: hoisted.fieldValueDelete,
            }));
            expect(hoisted.transaction.delete).not.toHaveBeenCalled();
        });

        it('does not reset dispatch state when a stale retry loses the current-state check', async () => {
            const queueItem: any = {
                id: 'guarded-retry-3',
                ref: { parent: { id: 'routeDeliverySyncQueue' }, id: 'guarded-retry-3' },
                retryCount: 2,
                dispatchedToCloudTask: 123,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({ revision: 'newer', processed: true }),
            });

            const result = await increaseRetryCountIfCurrentUserActive({
                queueItem,
                error: new Error('stale retry'),
                userID: 'user-1',
                phase: 'provider_retry',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).not.toHaveBeenCalled();
            expect(hoisted.transaction.set).not.toHaveBeenCalled();
            expect(hoisted.transaction.delete).not.toHaveBeenCalled();
            expect(queueItem.dispatchedToCloudTask).toBe(123);
        });
    });

    describe('increaseRetryCountForQueueItem', () => {
        it('does not let an older Sleep queue revision reset retry state on its replacement', async () => {
            const queueItem: any = {
                id: 'sleep-retry',
                ref: { parent: { id: 'sleepSyncQueue' }, id: 'sleep-retry' },
                userID: 'user-1',
                queueRevision: 'revision-1',
                dateCreated: 100,
                retryCount: 2,
                dispatchedToCloudTask: 123,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    dateCreated: 200,
                    processed: false,
                    retryCount: 0,
                    dispatchedToCloudTask: null,
                }),
            });

            await expect(increaseRetryCountForQueueItem(queueItem, new Error('stale failure')))
                .resolves.toBe(QueueResult.Processed);

            expect(hoisted.transaction.update).not.toHaveBeenCalled();
            expect(hoisted.transaction.set).not.toHaveBeenCalled();
            expect(hoisted.transaction.delete).not.toHaveBeenCalled();
        });

        it('does not let a legacy Sleep task reset a revisioned replacement with the same date', async () => {
            const queueItem: any = {
                id: 'legacy-sleep-retry',
                ref: { parent: { id: 'sleepSyncQueue' }, id: 'legacy-sleep-retry' },
                userID: 'user-1',
                dateCreated: 100,
                retryCount: 2,
                dispatchedToCloudTask: 123,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    dateCreated: 100,
                    processed: false,
                    retryCount: 0,
                }),
            });

            await expect(increaseRetryCountForQueueItem(queueItem, new Error('legacy stale failure')))
                .resolves.toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).not.toHaveBeenCalled();
        });

        it('does not let a legacy COROS task reset a newly revisioned replacement', async () => {
            const queueItem: any = {
                id: 'legacy-coros-retry',
                ref: { parent: { id: 'corosAPIWorkoutQueue' }, id: 'legacy-coros-retry' },
                firebaseUserID: 'user-1',
                openId: 'open-id',
                dateCreated: 100,
                retryCount: 2,
                dispatchedToCloudTask: 123,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    openId: 'open-id',
                    dateCreated: 200,
                    processed: false,
                    retryCount: 0,
                    dispatchedToCloudTask: null,
                }),
            });

            await expect(increaseRetryCountForQueueItem(queueItem, new Error('stale failure')))
                .resolves.toBe(QueueResult.Processed);

            expect(hoisted.transaction.update).not.toHaveBeenCalled();
            expect(hoisted.transaction.set).not.toHaveBeenCalled();
            expect(hoisted.transaction.delete).not.toHaveBeenCalled();
        });

        it('does not let an older queue revision reset retry state on its replacement', async () => {
            const queueItem: any = {
                id: 'revisioned-retry',
                ref: { parent: { id: 'corosAPIWorkoutQueue' }, id: 'revisioned-retry' },
                firebaseUserID: 'user-1',
                queueRevision: 'revision-1',
                retryCount: 2,
                dispatchedToCloudTask: 123,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    processed: false,
                    retryCount: 0,
                    dispatchedToCloudTask: null,
                }),
            });

            await expect(increaseRetryCountForQueueItem(queueItem, new Error('stale failure')))
                .resolves.toBe(QueueResult.Processed);

            expect(hoisted.transaction.update).not.toHaveBeenCalled();
            expect(hoisted.transaction.set).not.toHaveBeenCalled();
            expect(hoisted.transaction.delete).not.toHaveBeenCalled();
            expect(queueItem.dispatchedToCloudTask).toBe(123);
        });

        it('uses bulkWriter and resets dispatchedToCloudTask', async () => {
            const queueItem: any = {
                id: 'q3',
                ref: { update: vi.fn() },
                retryCount: 1,
                totalRetryCount: 1,
                errors: [],
                dispatchedToCloudTask: 123,
            };

            const res = await increaseRetryCountForQueueItem(queueItem, new Error('err'), 1, {
                update: vi.fn(),
            } as any);

            expect(res).toBe(QueueResult.RetryIncremented);
            expect(queueItem.retryCount).toBe(2);
        });
    });

    describe('updateToProcessed', () => {
        it('does not let an older Sleep queue revision mark its replacement processed', async () => {
            const queueItem: any = {
                id: 'sleep-completion',
                ref: { parent: { id: 'sleepSyncQueue' }, id: 'sleep-completion' },
                userID: 'user-1',
                queueRevision: 'revision-1',
                dateCreated: 100,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    dateCreated: 200,
                    processed: false,
                }),
            });

            await expect(updateToProcessed(queueItem)).resolves.toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).not.toHaveBeenCalled();
        });

        it('marks only the matching unprocessed Sleep queue revision complete', async () => {
            const queueItem: any = {
                id: 'sleep-completion',
                ref: { parent: { id: 'sleepSyncQueue' }, id: 'sleep-completion' },
                userID: 'user-1',
                queueRevision: 'revision-2',
                dateCreated: 200,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    dateCreated: 200,
                    processed: false,
                }),
            });

            await expect(updateToProcessed(queueItem, undefined, { resultStatus: 'success' }))
                .resolves.toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: true,
                resultStatus: 'success',
            }));
        });

        it('uses the authoritative Sleep userID for deletion guards when generic metadata conflicts', async () => {
            const queueItem: any = {
                id: 'sleep-owner-guard',
                ref: { parent: { id: 'sleepSyncQueue' }, id: 'sleep-owner-guard' },
                userID: 'sleep-owner',
                firebaseUserID: 'unrelated-generic-owner',
                queueRevision: 'revision-2',
                dateCreated: 200,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    dateCreated: 200,
                    processed: false,
                }),
            });

            await expect(updateToProcessed(queueItem)).resolves.toBe(QueueResult.Processed);

            expect(hoisted.getUserDeletionGuardStateInTransaction).toHaveBeenCalledWith(
                expect.anything(),
                hoisted.transaction,
                'sleep-owner',
            );
            expect(hoisted.getUserDeletionGuardStateInTransaction).not.toHaveBeenCalledWith(
                expect.anything(),
                hoisted.transaction,
                'unrelated-generic-owner',
            );
        });

        it('does not let an unclaimed Sleep task complete a revision with an active lease', async () => {
            const queueItem: any = {
                id: 'sleep-completion',
                ref: { parent: { id: 'sleepSyncQueue' }, id: 'sleep-completion' },
                userID: 'user-1',
                queueRevision: 'revision-2',
                dateCreated: 200,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    dateCreated: 200,
                    processed: false,
                    processingOwner: 'active-worker',
                    processingRevision: 'revision:revision-2',
                    processingLeaseExpiresAt: Date.now() + 60_000,
                }),
            });

            await expect(updateToProcessed(queueItem)).resolves.toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).not.toHaveBeenCalled();
        });

        it('lets the claimed Sleep lease owner complete its matching revision', async () => {
            const queueItem: any = {
                id: 'sleep-completion',
                ref: { parent: { id: 'sleepSyncQueue' }, id: 'sleep-completion' },
                userID: 'user-1',
                queueRevision: 'revision-2',
                dateCreated: 200,
                processingOwner: 'active-worker',
                processingRevision: 'revision:revision-2',
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    dateCreated: 200,
                    processed: false,
                    processingOwner: 'active-worker',
                    processingRevision: 'revision:revision-2',
                    processingLeaseExpiresAt: Date.now() + 60_000,
                }),
            });

            await expect(updateToProcessed(queueItem)).resolves.toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: true,
            }));
        });

        it('guards a uid-less legacy Sleep completion with identity and cleanup tombstone reads', async () => {
            const queueItem: any = {
                id: 'legacy-sleep-completion',
                ref: { parent: { id: 'sleepSyncQueue' }, id: 'legacy-sleep-completion' },
                dateCreated: 200,
            };
            hoisted.transaction.get
                .mockResolvedValueOnce({
                    exists: true,
                    data: () => ({
                        dateCreated: 200,
                        processed: false,
                    }),
                })
                .mockResolvedValueOnce({ exists: false, data: () => undefined });

            await expect(updateToProcessed(queueItem, undefined, { resultStatus: 'provider_disabled' }))
                .resolves.toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: true,
                resultStatus: 'provider_disabled',
            }));
        });

        it('does not let a legacy COROS task complete a newly revisioned replacement', async () => {
            const queueItem: any = {
                id: 'legacy-coros-completion',
                ref: { parent: { id: 'corosAPIWorkoutQueue' }, id: 'legacy-coros-completion' },
                firebaseUserID: 'user-1',
                openId: 'open-id',
                dateCreated: 100,
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    openId: 'open-id',
                    dateCreated: 200,
                    processed: false,
                }),
            });

            await expect(updateToProcessed(queueItem)).resolves.toBe(QueueResult.Processed);

            expect(hoisted.transaction.update).not.toHaveBeenCalled();
        });

        it('does not let an older queue revision mark its replacement processed', async () => {
            const queueItem: any = {
                id: 'revisioned-completion',
                ref: { parent: { id: 'corosAPIWorkoutQueue' }, id: 'revisioned-completion' },
                firebaseUserID: 'user-1',
                queueRevision: 'revision-1',
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    processed: false,
                }),
            });

            await expect(updateToProcessed(queueItem)).resolves.toBe(QueueResult.Processed);

            expect(hoisted.transaction.update).not.toHaveBeenCalled();
        });

        it('marks only the matching unprocessed queue revision complete', async () => {
            const queueItem: any = {
                id: 'revisioned-completion',
                ref: { parent: { id: 'corosAPIWorkoutQueue' }, id: 'revisioned-completion' },
                firebaseUserID: 'user-1',
                queueRevision: 'revision-2',
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({
                    queueRevision: 'revision-2',
                    processed: false,
                }),
            });

            await expect(updateToProcessed(queueItem, undefined, { resultStatus: 'success' }))
                .resolves.toBe(QueueResult.Processed);

            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: true,
                processedAt: expect.any(Number),
                resultStatus: 'success',
            }));
        });

        it('updates via bulkWriter when supplied', async () => {
            const queueItem: any = {
                id: 'q4',
                ref: { id: 'ref' },
            };

            const bulkWriter = { update: vi.fn() };
            const res = await updateToProcessed(queueItem, bulkWriter as any, { extra: true });

            expect(res).toBe(QueueResult.Processed);
            expect(bulkWriter.update).toHaveBeenCalledWith(
                { id: 'ref' },
                expect.objectContaining({ processed: true, extra: true })
            );
        });

        it('throws when ref missing', async () => {
            await expect(updateToProcessed({ id: 'no-ref' } as any)).rejects.toThrow(/No document reference supplied/);
        });
    });

    describe('markQueueItemSkipped', () => {
        it('marks queue item processed with a skipped result status and reason', async () => {
            const queueItem: any = {
                id: 'q5',
                ref: { id: 'ref' },
            };

            const bulkWriter = { update: vi.fn() };
            const res = await markQueueItemSkipped(
                queueItem,
                bulkWriter as any,
                QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
                { skippedContext: 'USER_DELETION_GUARD' },
            );

            expect(res).toBe(QueueResult.Processed);
            expect(bulkWriter.update).toHaveBeenCalledWith(
                { id: 'ref' },
                expect.objectContaining({
                    processed: true,
                    resultStatus: 'skipped',
                    skippedReason: QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
                    skippedContext: 'USER_DELETION_GUARD',
                }),
            );
        });
    });

    describe('deferQueueItemForPendingDisconnect', () => {
        it('parks queue item as deferred until pending disconnect clears without incrementing retry count', async () => {
            const nowMs = 1_782_126_100_000;
            vi.spyOn(Date, 'now').mockReturnValue(nowMs);
            const queueItem: any = {
                id: 'q6',
                ref: { id: 'q6' },
                retryCount: 3,
                dispatchedToCloudTask: 123,
            };
            hoisted.transaction.get.mockImplementation(async (ref: unknown) => (
                ref === hoisted.pendingDisconnectRootRef
                    ? {
                        exists: true,
                        data: () => ({
                            disconnectState: 'disconnect_pending',
                            disconnectGeneration: 'pending-generation-1',
                        }),
                    }
                    : { exists: true, data: () => ({ processed: false }) }
            ));

            const res = await deferQueueItemForPendingDisconnect(queueItem, undefined, {
                extra: true,
            }, {
                userID: 'user-1',
                serviceName: ServiceNames.WahooAPI,
            });

            expect(res).toBe(QueueResult.Deferred);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: true,
                resultStatus: 'deferred',
                deferredReason: QUEUE_DEFERRED_REASONS.ServiceDisconnectPending,
                deferredContext: 'SERVICE_DISCONNECT_PENDING',
                dispatchedToCloudTask: PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER,
                serviceDisconnectPendingDeferredAt: nowMs,
                serviceDisconnectPendingGeneration: 'pending-generation-1',
                expireAt: new Date(nowMs + TTL_CONFIG.PENDING_DISCONNECT_QUEUE_ITEM_IN_DAYS * 24 * 60 * 60 * 1000),
                extra: true,
            }));
            expect(hoisted.transaction.update).not.toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                retryCount: expect.any(Number),
            }));
        });
    });

    describe('deferQueueItemForPendingDisconnectIfCurrentUserActive', () => {
        it('atomically defers the expected live provider revision', async () => {
            const nowMs = 1_782_126_100_000;
            vi.spyOn(Date, 'now').mockReturnValue(nowMs);
            const queueItem: any = {
                id: 'guarded-defer-1',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-defer-1' },
            };
            hoisted.transaction.get.mockImplementation(async (ref: unknown) => (
                ref === hoisted.pendingDisconnectRootRef
                    ? {
                        exists: true,
                        data: () => ({
                            disconnectState: 'disconnect_pending',
                            disconnectGeneration: 'pending-generation-1',
                        }),
                    }
                    : { exists: true, data: () => ({ revision: 'expected' }) }
            ));

            const result = await deferQueueItemForPendingDisconnectIfCurrentUserActive({
                queueItem,
                additionalData: { deferredServiceName: 'Wahoo API' },
                userID: 'user-1',
                serviceName: ServiceNames.WahooAPI,
                phase: 'provider_defer',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.Deferred);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: true,
                resultStatus: 'deferred',
                deferredReason: QUEUE_DEFERRED_REASONS.ServiceDisconnectPending,
                dispatchedToCloudTask: PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER,
                serviceDisconnectPendingDeferredAt: nowMs,
                serviceDisconnectPendingGeneration: 'pending-generation-1',
                deferredServiceName: 'Wahoo API',
            }));
        });

        it('does not defer a queue item whose provider state already advanced', async () => {
            const queueItem: any = {
                id: 'guarded-defer-2',
                ref: { parent: { id: 'routeDeliverySyncQueue' }, id: 'guarded-defer-2' },
            };
            hoisted.transaction.get.mockResolvedValue({
                exists: true,
                data: () => ({ revision: 'newer' }),
            });

            const result = await deferQueueItemForPendingDisconnectIfCurrentUserActive({
                queueItem,
                userID: 'user-1',
                serviceName: ServiceNames.WahooAPI,
                phase: 'provider_defer',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).not.toHaveBeenCalled();
        });

        it('re-opens current work when pending disconnect cleared before parking', async () => {
            const queueItem: any = {
                id: 'guarded-defer-cleared',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-defer-cleared' },
            };
            hoisted.transaction.get.mockImplementation(async (ref: unknown) => (
                ref === hoisted.pendingDisconnectRootRef
                    ? { exists: true, data: () => ({ disconnectState: null }) }
                    : { exists: true, data: () => ({ revision: 'expected', processed: false }) }
            ));

            const result = await deferQueueItemForPendingDisconnectIfCurrentUserActive({
                queueItem,
                userID: 'user-1',
                serviceName: ServiceNames.WahooAPI,
                phase: 'provider_defer',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: false,
                dispatchedToCloudTask: null,
                deferredReason: hoisted.fieldValueDelete,
                serviceDisconnectPendingGeneration: hoisted.fieldValueDelete,
            }));
        });
    });

    describe('deferQueueItemForReconnectRequiredIfCurrentUserActive', () => {
        it('parks the expected live revision only while the Wahoo meta state still requires reconnect', async () => {
            const queueItem: any = {
                id: 'guarded-reconnect-1',
                ref: { parent: { id: 'activitySyncQueue' }, id: 'guarded-reconnect-1' },
            };
            hoisted.transaction.get.mockImplementation(async (ref: { id: string }) => {
                if (ref.id === queueItem.id) {
                    return { exists: true, data: () => ({ revision: 'expected' }) };
                }
                return { exists: true, data: () => ({ connectionState: 'reconnect_required' }) };
            });

            const result = await deferQueueItemForReconnectRequiredIfCurrentUserActive({
                queueItem,
                additionalData: { deferredServiceName: ServiceNames.WahooAPI },
                userID: 'user-1',
                serviceName: ServiceNames.WahooAPI,
                phase: 'provider_reconnect_defer',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.Deferred);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: true,
                deferredReason: QUEUE_DEFERRED_REASONS.ServiceReconnectRequired,
                dispatchedToCloudTask: PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER,
            }));
        });

        it('re-opens the item when OAuth resolved reconnect before the guarded transition', async () => {
            const queueItem: any = {
                id: 'guarded-reconnect-2',
                ref: { parent: { id: 'routeDeliverySyncQueue' }, id: 'guarded-reconnect-2' },
            };
            hoisted.transaction.get.mockImplementation(async (ref: { id: string }) => {
                if (ref.id === queueItem.id) {
                    return { exists: true, data: () => ({ revision: 'expected' }) };
                }
                return { exists: true, data: () => ({ connectionState: 'connected' }) };
            });

            const result = await deferQueueItemForReconnectRequiredIfCurrentUserActive({
                queueItem,
                additionalData: { deferredServiceName: ServiceNames.WahooAPI },
                userID: 'user-1',
                serviceName: ServiceNames.WahooAPI,
                phase: 'provider_reconnect_defer',
                logPrefix: 'ProviderQueue',
                isCurrent: current => current.revision === 'expected',
            });

            expect(result).toBe(QueueResult.Processed);
            expect(hoisted.transaction.update).toHaveBeenCalledWith(queueItem.ref, expect.objectContaining({
                processed: false,
                dispatchedToCloudTask: null,
                deferredReason: hoisted.fieldValueDelete,
                deferredServiceName: hoisted.fieldValueDelete,
            }));
        });
    });
});
