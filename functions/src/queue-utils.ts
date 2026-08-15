import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { QueueItemInterface } from './queue/queue-item.interface';

import { MAX_RETRY_COUNT } from './shared/queue-config';
import { getExpireAtTimestamp, TTL_CONFIG } from './shared/ttl-config';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from './shared/user-deletion-guard';
import {
    cleanupQueueItemAfterUserDeletionGuard,
    QueueItemUserGuardedUpdateResult,
} from './queue/dispatch-marker';
import { clearRevisionProcessingLeaseUpdate } from './queue/revision-processing-lease';
import {
    isCurrentQueueRevision,
    normalizeQueueRevision,
} from './queue/revision-identity';


export enum QueueResult {
    Processed = 'PROCESSED',
    Skipped = 'SKIPPED',
    Deferred = 'DEFERRED',
    MovedToDLQ = 'MOVED_TO_DLQ',
    RetryIncremented = 'RETRY_INCREMENTED',
    Failed = 'FAILED',
}

export const QUEUE_SKIPPED_REASONS = {
    UserDeletedOrDeleting: 'user_deleted_or_deleting',
    WorkerReturnedSkipped: 'worker_returned_skipped',
} as const;

export const QUEUE_DEFERRED_REASONS = {
    ServiceDisconnectPending: 'service_disconnect_pending',
} as const;

export type QueueSkippedReason = typeof QUEUE_SKIPPED_REASONS[keyof typeof QUEUE_SKIPPED_REASONS] | string;
export type QueueDeferredReason = typeof QUEUE_DEFERRED_REASONS[keyof typeof QUEUE_DEFERRED_REASONS] | string;

export const PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER = Number.MAX_SAFE_INTEGER;
export const PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER = Number.MAX_SAFE_INTEGER - 1;
// Provider task workers time out after 9 minutes. A 12-minute claim prevents
// concurrent redelivery while still letting the first 15-minute task retry
// recognize a crashed worker as stale.
export const PROVIDER_OPERATION_IN_FLIGHT_LEASE_MS = 12 * 60 * 1000;

export class ProviderOperationStillInFlightError extends Error {
    readonly name = 'ProviderOperationStillInFlightError';
    readonly code = 'unavailable';
    readonly statusCode = 503;

    constructor(
        readonly queueItemId: string,
        readonly providerOperationStartedAt: number,
    ) {
        super(`Provider operation for queue item ${queueItemId} is still in flight.`);
    }
}

interface QueueRevisionGuard {
    userID: string;
    isCurrent: (queueItem: Record<string, unknown>) => boolean;
}

function getQueueRevisionGuard(queueItem: QueueItemInterface): QueueRevisionGuard | null {
    const queueRevision = normalizeQueueRevision(queueItem.queueRevision);
    const userID = typeof queueItem.firebaseUserID === 'string'
        ? queueItem.firebaseUserID.trim()
        : '';
    if (!userID) return null;
    const legacyCOROSOpenId = typeof (queueItem as QueueItemInterface & { openId?: unknown }).openId === 'string'
        ? `${(queueItem as QueueItemInterface & { openId?: unknown }).openId}`.trim()
        : '';
    const legacyDateCreated = Number(queueItem.dateCreated);
    if (!queueRevision && (!legacyCOROSOpenId || !Number.isFinite(legacyDateCreated))) return null;
    return {
        userID,
        isCurrent: current => isCurrentQueueRevision({
            currentQueueItem: current,
            attemptedQueueItem: queueItem,
            legacyIdentityMatches: current.dateCreated === legacyDateCreated
                && current.openId === legacyCOROSOpenId,
        }),
    };
}

export function isProviderOperationInFlightLeaseActive(
    queueItem: Pick<QueueItemInterface, 'dispatchedToCloudTask' | 'providerOperationStartedAt'>,
    nowMs = Date.now(),
): boolean {
    const startedAt = Number(queueItem.providerOperationStartedAt);
    return queueItem.dispatchedToCloudTask === PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER
        && Number.isFinite(startedAt)
        && startedAt > 0
        && startedAt > nowMs - PROVIDER_OPERATION_IN_FLIGHT_LEASE_MS;
}

export function isPendingDisconnectQueueItemDeferred(queueItem: {
    deferredReason?: unknown;
} | null | undefined): boolean {
    return queueItem?.deferredReason === QUEUE_DEFERRED_REASONS.ServiceDisconnectPending;
}

function buildFailedQueueItem(
    queueItem: QueueItemInterface,
    error: Error,
    context?: string,
): Record<string, unknown> {
    const failedItem = Object.assign({}, queueItem, {
        error: error.message,
        failedAt: Date.now(),
        originalCollection: queueItem.ref?.parent ? queueItem.ref.parent.id : 'unknown',
        context: context || 'MAX_RETRY_REACHED',
        expireAt: getExpireAtTimestamp(TTL_CONFIG.FAILED_JOBS_IN_DAYS),
        ref: undefined,
    }) as unknown as Record<string, unknown>;

    // Signed provider continuation URLs are short-lived credentials. They are
    // needed only while the live queue item can retry the exact same request.
    delete failedItem.destinationUploadContinuation;
    delete failedItem.processingOwner;
    delete failedItem.processingRevision;
    delete failedItem.processingLeaseExpiresAt;
    return failedItem;
}

export async function moveToDeadLetterQueue(queueItem: QueueItemInterface, error: Error, bulkWriter?: admin.firestore.BulkWriter, context?: string): Promise<QueueResult.MovedToDLQ | QueueResult.Processed | QueueResult.Failed> {

    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }

    const revisionGuard = getQueueRevisionGuard(queueItem);
    if (revisionGuard) {
        return moveToDeadLetterQueueIfCurrentUserActive({
            queueItem,
            error,
            context,
            bulkWriter,
            userID: revisionGuard.userID,
            phase: 'workout_queue_revision_dlq',
            logPrefix: 'WorkoutQueueRevision',
            isCurrent: revisionGuard.isCurrent,
        });
    }

    const failedItem = buildFailedQueueItem(queueItem, error, context);

    const failedDocRef = admin.firestore().collection('failed_jobs').doc(queueItem.id);

    try {
        if (bulkWriter) {
            void bulkWriter.set(failedDocRef, failedItem);
            void bulkWriter.delete(queueItem.ref);
        } else {
            const batch = admin.firestore().batch();
            batch.set(failedDocRef, failedItem);
            batch.delete(queueItem.ref);
            await batch.commit();
        }

        logger.info(`Moved item ${queueItem.id} to Dead Letter Queue (failed_jobs)`);
        return QueueResult.MovedToDLQ;
    } catch (e) {
        logger.error(new Error(`Failed to move item ${queueItem.id} to DLQ: ${e}`));
        return QueueResult.Failed;
    }
}

export interface MoveToDeadLetterQueueIfCurrentUserActiveParams {
    queueItem: QueueItemInterface;
    error: Error;
    context?: string;
    /** Guarded provider transitions commit immediately; this writer is not used. */
    bulkWriter?: admin.firestore.BulkWriter;
    userID: string;
    phase: string;
    logPrefix: string;
    isCurrent: (queueItem: Record<string, unknown>) => boolean;
    manualReconciliation?: QueueManualReconciliationState;
}

export interface QueueManualReconciliationState {
    /** Safe provider state that an operator needs to reconcile accepted work. */
    additionalData?: Record<string, unknown>;
}

interface QueueItemTransitionIfCurrentUserActiveParams {
    queueItem: QueueItemInterface;
    userID: string;
    phase: string;
    logPrefix: string;
    actionDescription: string;
    isCurrent: (queueItem: Record<string, unknown>) => boolean;
}

async function runQueueItemTransitionIfCurrentUserActive(
    params: QueueItemTransitionIfCurrentUserActiveParams,
    transition: (
        transaction: admin.firestore.Transaction,
        currentQueueItem: Record<string, unknown>,
    ) => void,
): Promise<QueueItemUserGuardedUpdateResult> {
    const queueItemRef = params.queueItem.ref;
    if (!queueItemRef) {
        throw new Error(`No document reference supplied for queue item ${params.queueItem.id}`);
    }

    const db = admin.firestore();
    const transitionResult = await db.runTransaction(async transaction => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(
                db,
                transaction,
                params.userID,
            );
        } catch (error) {
            throw new UserDeletionGuardReadError(params.userID, params.phase, error);
        }

        if (deletionGuard.shouldSkip) {
            return QueueItemUserGuardedUpdateResult.SkippedDeletedUser;
        }

        const queueItemSnapshot = await transaction.get(queueItemRef);
        const currentQueueItem = queueItemSnapshot.exists
            ? queueItemSnapshot.data() as Record<string, unknown>
            : null;
        if (!currentQueueItem || !params.isCurrent(currentQueueItem)) {
            return QueueItemUserGuardedUpdateResult.NotCurrent;
        }

        transition(transaction, currentQueueItem);
        return QueueItemUserGuardedUpdateResult.Updated;
    });

    if (transitionResult === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
        await cleanupQueueItemAfterUserDeletionGuard({
            queueItemDocument: queueItemRef,
            queueItemId: params.queueItem.id,
            logPrefix: params.logPrefix,
            actionDescription: params.actionDescription,
        });
    }

    return transitionResult;
}

function buildManualReconciliationUpdate(
    context: string | undefined,
    additionalData: Record<string, unknown> | undefined,
): Record<string, unknown> {
    const nowMs = Date.now();
    const safeAdditionalData = Object.fromEntries(
        Object.entries(additionalData || {}).filter(([, value]) => value !== undefined),
    );
    return {
        ...safeAdditionalData,
        processed: true,
        processedAt: nowMs,
        resultStatus: 'manual_reconciliation_required',
        manualReconciliationRequiredAt: nowMs,
        manualReconciliationContext: context || 'PROVIDER_MANUAL_RECONCILIATION_REQUIRED',
        // The DLQ audit copy expires, but this replay blocker must remain until
        // an operator reconciles it or service/account cleanup removes it.
        expireAt: FieldValue.delete(),
    };
}

/**
 * Atomically moves only the expected live queue revision to DLQ. Provider
 * workers use this after an external side effect so a stale delivery cannot
 * delete newer durable resume or acceptance state.
 */
export async function moveToDeadLetterQueueIfCurrentUserActive(
    params: MoveToDeadLetterQueueIfCurrentUserActiveParams,
): Promise<QueueResult.MovedToDLQ | QueueResult.Processed | QueueResult.Failed> {
    const { queueItem } = params;
    const db = admin.firestore();
    const failedDocRef = db.collection('failed_jobs').doc(queueItem.id);
    const failedItem = buildFailedQueueItem(queueItem, params.error, params.context);

    try {
        const transitionResult = await runQueueItemTransitionIfCurrentUserActive({
            ...params,
            actionDescription: 'DLQ move',
        }, transaction => {
            transaction.set(failedDocRef, failedItem);
            if (params.manualReconciliation) {
                transaction.update(
                    queueItem.ref!,
                    buildManualReconciliationUpdate(
                        params.context,
                        params.manualReconciliation.additionalData,
                    ),
                );
            } else {
                transaction.delete(queueItem.ref!);
            }
        });

        if (transitionResult === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
            logger.warn(
                `[${params.logPrefix}] Skipping DLQ move for queue item ${queueItem.id} because user ${params.userID} is missing or deletion is in progress.`,
            );
            return QueueResult.Processed;
        }

        if (transitionResult === QueueItemUserGuardedUpdateResult.NotCurrent) {
            logger.info(
                `[${params.logPrefix}] Skipping stale DLQ move for queue item ${queueItem.id}; its live state has already advanced or been replaced.`,
            );
            return QueueResult.Processed;
        }

        if (params.manualReconciliation) {
            logger.error(`Copied item ${queueItem.id} to Dead Letter Queue and retained a terminal manual-reconciliation marker.`);
        } else {
            logger.info(`Moved item ${queueItem.id} to Dead Letter Queue (failed_jobs)`);
        }
        return QueueResult.MovedToDLQ;
    } catch (error) {
        logger.error(new Error(`Failed to move item ${queueItem.id} to DLQ: ${error}`));
        return QueueResult.Failed;
    }
}

export interface IncreaseRetryCountIfCurrentUserActiveParams {
    queueItem: QueueItemInterface;
    error: Error;
    incrementBy?: number;
    maxRetryDlqContext?: string;
    /** Guarded provider transitions commit immediately; this writer is not used. */
    bulkWriter?: admin.firestore.BulkWriter;
    userID: string;
    phase: string;
    logPrefix: string;
    isCurrent: (queueItem: Record<string, unknown>) => boolean;
    manualReconciliation?: QueueManualReconciliationState;
}

export interface DeferQueueItemForPendingDisconnectIfCurrentUserActiveParams {
    queueItem: QueueItemInterface;
    additionalData?: Record<string, unknown>;
    /** Guarded provider transitions commit immediately; this writer is not used. */
    bulkWriter?: admin.firestore.BulkWriter;
    userID: string;
    phase: string;
    logPrefix: string;
    isCurrent: (queueItem: Record<string, unknown>) => boolean;
}

/**
 * Defers only the expected live queue revision. This prevents a provider
 * response from parking a queue item that another worker already advanced.
 */
export async function deferQueueItemForPendingDisconnectIfCurrentUserActive(
    params: DeferQueueItemForPendingDisconnectIfCurrentUserActiveParams,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
    const nowMs = Date.now();
    try {
        const transitionResult = await runQueueItemTransitionIfCurrentUserActive({
            ...params,
            actionDescription: 'pending-disconnect deferral',
        }, transaction => {
            transaction.update(params.queueItem.ref!, {
                ...params.additionalData,
                processed: true,
                resultStatus: 'deferred',
                deferredReason: QUEUE_DEFERRED_REASONS.ServiceDisconnectPending,
                deferredContext: 'SERVICE_DISCONNECT_PENDING',
                serviceDisconnectPendingDeferredAt: nowMs,
                dispatchedToCloudTask: PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER,
                expireAt: getExpireAtTimestamp(TTL_CONFIG.PENDING_DISCONNECT_QUEUE_ITEM_IN_DAYS),
            });
        });

        if (transitionResult === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
            logger.warn(
                `[${params.logPrefix}] Skipping pending-disconnect deferral for queue item ${params.queueItem.id} because user ${params.userID} is missing or deletion is in progress.`,
            );
            return QueueResult.Processed;
        }
        if (transitionResult === QueueItemUserGuardedUpdateResult.NotCurrent) {
            logger.info(
                `[${params.logPrefix}] Skipping stale pending-disconnect deferral for queue item ${params.queueItem.id}; its live state has already advanced or been replaced.`,
            );
            return QueueResult.Processed;
        }

        logger.info(`Deferred queue item ${params.queueItem.id} because service disconnect is pending.`);
        return QueueResult.Deferred;
    } catch (error) {
        logger.error(new Error(`Could not update guarded deferred state for ${params.queueItem.id}: ${error}`));
        return QueueResult.Failed;
    }
}

export async function increaseRetryCountIfCurrentUserActive(
    params: IncreaseRetryCountIfCurrentUserActiveParams,
): Promise<QueueResult.MovedToDLQ | QueueResult.RetryIncremented | QueueResult.Processed | QueueResult.Failed> {
    const incrementBy = params.incrementBy ?? 1;
    if (!Number.isInteger(incrementBy) || incrementBy <= 0) {
        throw new Error('Retry increment must be a positive integer.');
    }

    const db = admin.firestore();
    const failedDocRef = db.collection('failed_jobs').doc(params.queueItem.id);
    let nextRetryCount = 0;
    let nextTotalRetryCount = 0;
    let movedToDlq = false;
    let nextErrors: QueueItemInterface['errors'] = [];

    try {
        const transitionResult = await runQueueItemTransitionIfCurrentUserActive({
            ...params,
            actionDescription: 'retry-state transition',
        }, (transaction, currentQueueItem) => {
            movedToDlq = false;
            const currentRetryCount = Number.isFinite(Number(currentQueueItem.retryCount))
                ? Math.max(0, Math.floor(Number(currentQueueItem.retryCount)))
                : 0;
            const currentTotalRetryCount = Number.isFinite(Number(currentQueueItem.totalRetryCount))
                ? Math.max(0, Math.floor(Number(currentQueueItem.totalRetryCount)))
                : 0;
            nextRetryCount = currentRetryCount + incrementBy;
            nextTotalRetryCount = currentTotalRetryCount + incrementBy;
            const currentErrors = Array.isArray(currentQueueItem.errors)
                ? currentQueueItem.errors as NonNullable<QueueItemInterface['errors']>
                : [];
            nextErrors = [
                ...currentErrors,
                {
                    error: params.error.message,
                    atRetryCount: nextTotalRetryCount,
                    date: Date.now(),
                },
            ];

            if (nextRetryCount >= MAX_RETRY_COUNT) {
                movedToDlq = true;
                const currentQueueItemForDlq = {
                    ...currentQueueItem,
                    id: params.queueItem.id,
                    ref: params.queueItem.ref,
                    retryCount: nextRetryCount,
                    totalRetryCount: nextTotalRetryCount,
                    errors: nextErrors,
                } as unknown as QueueItemInterface;
                transaction.set(
                    failedDocRef,
                    buildFailedQueueItem(
                        currentQueueItemForDlq,
                        params.error,
                        params.maxRetryDlqContext,
                    ),
                );
                if (params.manualReconciliation) {
                    transaction.update(params.queueItem.ref!, {
                        retryCount: nextRetryCount,
                        totalRetryCount: nextTotalRetryCount,
                        errors: nextErrors,
                        ...buildManualReconciliationUpdate(
                            params.maxRetryDlqContext,
                            params.manualReconciliation.additionalData,
                        ),
                    });
                } else {
                    transaction.delete(params.queueItem.ref!);
                }
                return;
            }

            transaction.update(params.queueItem.ref!, {
                retryCount: nextRetryCount,
                totalRetryCount: nextTotalRetryCount,
                errors: nextErrors,
                dispatchedToCloudTask: null,
                providerOperationStartedAt: null,
                ...clearRevisionProcessingLeaseUpdate(),
            });
        });

        if (transitionResult === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
            logger.warn(
                `[${params.logPrefix}] Skipping retry transition for queue item ${params.queueItem.id} because user ${params.userID} is missing or deletion is in progress.`,
            );
            return QueueResult.Processed;
        }
        if (transitionResult === QueueItemUserGuardedUpdateResult.NotCurrent) {
            logger.info(
                `[${params.logPrefix}] Skipping stale retry transition for queue item ${params.queueItem.id}; its live state has already advanced or been replaced.`,
            );
            return QueueResult.Processed;
        }

        params.queueItem.retryCount = nextRetryCount;
        params.queueItem.totalRetryCount = nextTotalRetryCount;
        params.queueItem.errors = nextErrors;
        if (movedToDlq) {
            if (params.manualReconciliation) {
                logger.error(`Item ${params.queueItem.id} exceeded max retries (${MAX_RETRY_COUNT}). Copied it to DLQ and retained a terminal manual-reconciliation marker.`);
            } else {
                logger.warn(`Item ${params.queueItem.id} exceeded max retries (${MAX_RETRY_COUNT}). Moved it to DLQ.`);
            }
            return QueueResult.MovedToDLQ;
        }

        params.queueItem.dispatchedToCloudTask = null;
        params.queueItem.providerOperationStartedAt = null;
        logger.info(`Updated retry count for ${params.queueItem.id} to ${nextRetryCount}`);
        return QueueResult.RetryIncremented;
    } catch (error) {
        logger.error(new Error(`Could not update guarded retry state on ${params.queueItem.id}: ${error}`));
        return QueueResult.Failed;
    }
}


export async function increaseRetryCountForQueueItem(
    queueItem: QueueItemInterface,
    error: Error,
    incrementBy = 1,
    bulkWriter?: admin.firestore.BulkWriter,
    maxRetryDlqContext?: string,
): Promise<QueueResult.MovedToDLQ | QueueResult.RetryIncremented | QueueResult.Processed | QueueResult.Failed> {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }

    const revisionGuard = getQueueRevisionGuard(queueItem);
    if (revisionGuard) {
        return increaseRetryCountIfCurrentUserActive({
            queueItem,
            error,
            incrementBy,
            maxRetryDlqContext,
            bulkWriter,
            userID: revisionGuard.userID,
            phase: 'workout_queue_revision_retry',
            logPrefix: 'WorkoutQueueRevision',
            isCurrent: revisionGuard.isCurrent,
        });
    }

    // Check if we overlap the max retry count
    if ((queueItem.retryCount || 0) + incrementBy >= MAX_RETRY_COUNT) {
        logger.warn(`Item ${queueItem.id} exceeded max retries (${MAX_RETRY_COUNT}). Moving to DLQ.`);
        return moveToDeadLetterQueue(queueItem, error, bulkWriter, maxRetryDlqContext);
    }

    queueItem.retryCount += incrementBy;
    queueItem.totalRetryCount = queueItem.totalRetryCount || 0;
    queueItem.totalRetryCount += incrementBy;
    queueItem.errors = queueItem.errors || [];
    queueItem.errors.push({
        error: error.message,
        atRetryCount: queueItem.totalRetryCount,
        date: (new Date()).getTime(),
    });

    try {
        const ref = queueItem.ref;
        queueItem.ref = undefined;
        // Reset dispatchedToCloudTask to null so the dispatcher can pick it up again
        const updateData = Object.assign(JSON.parse(JSON.stringify(queueItem)), {
            dispatchedToCloudTask: null
        });
        if (bulkWriter) {
            void bulkWriter.update(ref, updateData);
        } else {
            await ref.update(updateData);
        }

        queueItem.ref = ref;
        logger.info(`Updated retry count for ${queueItem.id} to ${queueItem.retryCount}`);
        return QueueResult.RetryIncremented;
    } catch {
        logger.error(new Error(`Could not update retry count on ${queueItem.id}`));
        return QueueResult.Failed;
    }
}


async function updateToProcessedIfCurrentUserActive(
    queueItem: QueueItemInterface,
    additionalData: Record<string, unknown> | undefined,
    revisionGuard: QueueRevisionGuard,
): Promise<QueueResult.Processed | QueueResult.Failed> {
    const nowMs = Date.now();
    try {
        const transitionResult = await runQueueItemTransitionIfCurrentUserActive({
            queueItem,
            userID: revisionGuard.userID,
            phase: 'workout_queue_revision_completion',
            logPrefix: 'WorkoutQueueRevision',
            actionDescription: 'processed-state transition',
            isCurrent: revisionGuard.isCurrent,
        }, transaction => {
            transaction.update(queueItem.ref!, {
                processed: true,
                processedAt: nowMs,
                ...additionalData,
                ...clearRevisionProcessingLeaseUpdate(),
            });
        });
        if (transitionResult === QueueItemUserGuardedUpdateResult.NotCurrent) {
            logger.info(`Skipping stale processed-state transition for queue item ${queueItem.id}; its revision already advanced.`);
        }
        return QueueResult.Processed;
    } catch (error) {
        logger.error(new Error(`Could not update guarded processed state for ${queueItem.id}: ${error}`));
        return QueueResult.Failed;
    }
}

export async function updateToProcessed(queueItem: QueueItemInterface, bulkWriter?: admin.firestore.BulkWriter, additionalData?: Record<string, unknown>): Promise<QueueResult.Processed | QueueResult.Failed> {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }
    const revisionGuard = getQueueRevisionGuard(queueItem);
    if (revisionGuard) {
        return updateToProcessedIfCurrentUserActive(queueItem, additionalData, revisionGuard);
    }
    try {
        const ref = queueItem.ref;
        queueItem.ref = undefined;
        const updateData = Object.assign({
            'processed': true,
            'processedAt': (new Date()).getTime(),
        }, additionalData);
        if (bulkWriter) {
            void bulkWriter.update(ref, updateData);
        } else {
            await ref.update(updateData);
        }

        logger.info(`Updated to processed  ${queueItem.id}`);
        return QueueResult.Processed;
    } catch {
        logger.error(new Error(`Could not update processed state for ${queueItem.id}`));
        return QueueResult.Failed;
    }
}

export async function markQueueItemSkipped(
    queueItem: QueueItemInterface,
    bulkWriter: admin.firestore.BulkWriter | undefined,
    skippedReason: QueueSkippedReason,
    additionalData: Record<string, unknown> = {},
): Promise<QueueResult.Processed | QueueResult.Failed> {
    return updateToProcessed(queueItem, bulkWriter, {
        ...additionalData,
        resultStatus: 'skipped',
        skippedReason,
    });
}

export async function deferQueueItemForPendingDisconnect(
    queueItem: QueueItemInterface,
    bulkWriter?: admin.firestore.BulkWriter,
    additionalData: Record<string, unknown> = {},
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }

    const revisionGuard = getQueueRevisionGuard(queueItem);
    if (revisionGuard) {
        return deferQueueItemForPendingDisconnectIfCurrentUserActive({
            queueItem,
            additionalData,
            bulkWriter,
            userID: revisionGuard.userID,
            phase: 'workout_queue_revision_pending_disconnect',
            logPrefix: 'WorkoutQueueRevision',
            isCurrent: revisionGuard.isCurrent,
        });
    }

    try {
        const nowMs = Date.now();
        const updateData = {
            ...additionalData,
            processed: true,
            resultStatus: 'deferred',
            deferredReason: QUEUE_DEFERRED_REASONS.ServiceDisconnectPending,
            deferredContext: 'SERVICE_DISCONNECT_PENDING',
            serviceDisconnectPendingDeferredAt: nowMs,
            dispatchedToCloudTask: PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER,
            expireAt: getExpireAtTimestamp(TTL_CONFIG.PENDING_DISCONNECT_QUEUE_ITEM_IN_DAYS),
        };

        if (bulkWriter) {
            void bulkWriter.update(queueItem.ref, updateData);
        } else {
            await queueItem.ref.update(updateData);
        }

        logger.info(`Deferred queue item ${queueItem.id} because service disconnect is pending.`);
        return QueueResult.Deferred;
    } catch {
        logger.error(new Error(`Could not update deferred state for ${queueItem.id}`));
        return QueueResult.Failed;
    }
}
