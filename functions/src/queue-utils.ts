import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
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
import {
    clearRevisionProcessingLeaseUpdate,
    getActiveRevisionProcessingLease,
} from './queue/revision-processing-lease';
import {
    isCurrentQueueRevision,
    normalizeQueueRevision,
} from './queue/revision-identity';
import { isReconnectRequiredServiceConnection } from '../../shared/service-connection';
import { getServiceTokenRootDocumentRef } from './service-token-store';
import { isServiceDisconnectPendingData } from './service-disconnect-pending-state';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from './sleep/constants';
import { getQueueCleanupTombstoneDocumentRef } from './queue/cleanup-tombstone';


export enum QueueResult {
    Processed = 'PROCESSED',
    Skipped = 'SKIPPED',
    Deferred = 'DEFERRED',
    ProviderStatusPending = 'PROVIDER_STATUS_PENDING',
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
  ServiceReconnectRequired: 'service_reconnect_required',
  RouteRestorePending: 'route_restore_pending',
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
    phasePrefix: string;
    logPrefix: string;
    isCurrent: (queueItem: Record<string, unknown>) => boolean;
}

function canTransitionSleepQueueProcessingLease(
    currentQueueItem: Record<string, unknown>,
    attemptedQueueItem: QueueItemInterface,
    nowMs = Date.now(),
): boolean {
    const activeLease = getActiveRevisionProcessingLease(currentQueueItem, nowMs);
    if (!activeLease) return true;

    // A queue snapshot can contain somebody else's lease. The Sleep worker
    // strips persisted lease fields before processing and adds its own owner
    // only after a successful claim, so these values are proof of ownership
    // within the current invocation rather than untrusted snapshot state.
    const attemptedOwner = typeof attemptedQueueItem.processingOwner === 'string'
        ? attemptedQueueItem.processingOwner.trim()
        : '';
    const attemptedRevision = typeof attemptedQueueItem.processingRevision === 'string'
        ? attemptedQueueItem.processingRevision.trim()
        : '';
    return attemptedOwner === activeLease.processingOwner
        && attemptedRevision === activeLease.processingRevision;
}

export function isCurrentSleepQueueTransition(
    currentQueueItem: Record<string, unknown>,
    attemptedQueueItem: QueueItemInterface,
): boolean {
    const queueRevision = normalizeQueueRevision(attemptedQueueItem.queueRevision);
    const legacyDateCreated = Number(attemptedQueueItem.dateCreated);
    return isCurrentQueueRevision({
        currentQueueItem,
        attemptedQueueItem,
        legacyIdentityMatches: !queueRevision
            && Number.isFinite(legacyDateCreated)
            && currentQueueItem.dateCreated === legacyDateCreated,
    }) && canTransitionSleepQueueProcessingLease(currentQueueItem, attemptedQueueItem);
}

function getQueueRevisionGuard(queueItem: QueueItemInterface): QueueRevisionGuard | null {
    const queueRevision = normalizeQueueRevision(queueItem.queueRevision);
    const isSleepQueueItem = queueItem.ref?.parent?.id === SLEEP_SYNC_QUEUE_COLLECTION_NAME;
    const firebaseUserID = typeof queueItem.firebaseUserID === 'string'
        ? queueItem.firebaseUserID.trim()
        : '';
    const sleepUserID = isSleepQueueItem
        && typeof (queueItem as QueueItemInterface & { userID?: unknown }).userID === 'string'
        ? `${(queueItem as QueueItemInterface & { userID?: unknown }).userID}`.trim()
        : '';
    // Sleep rows are owned exclusively by their durable `userID`. Generic
    // queue metadata must never redirect a Sleep transition's deletion guard
    // to another account. Legacy provider-only Sleep rows intentionally fall
    // through to the revision+tombstone path until token resolution supplies
    // their authoritative userID in memory.
    const userID = isSleepQueueItem ? sleepUserID : firebaseUserID;
    if (!userID) return null;
    const legacyDateCreated = Number(queueItem.dateCreated);
    if (isSleepQueueItem) {
        if (!queueRevision && !Number.isFinite(legacyDateCreated)) return null;
        return {
            userID,
            phasePrefix: 'sleep_queue_revision',
            logPrefix: 'SleepQueueRevision',
            isCurrent: current => isCurrentSleepQueueTransition(current, queueItem),
        };
    }
    const legacyCOROSOpenId = typeof (queueItem as QueueItemInterface & { openId?: unknown }).openId === 'string'
        ? `${(queueItem as QueueItemInterface & { openId?: unknown }).openId}`.trim()
        : '';
    if (!queueRevision && (!legacyCOROSOpenId || !Number.isFinite(legacyDateCreated))) return null;
    return {
        userID,
        phasePrefix: 'workout_queue_revision',
        logPrefix: 'WorkoutQueueRevision',
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
    return isQueueItemDeferredForReason(queueItem, QUEUE_DEFERRED_REASONS.ServiceDisconnectPending);
}

export function isQueueItemDeferredForReason(queueItem: {
    deferredReason?: unknown;
} | null | undefined, deferredReason: QueueDeferredReason): boolean {
    return queueItem?.deferredReason === deferredReason;
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
    // Garmin Ping/Pull callback URLs contain a short-lived pull token. Keep
    // them only on a retryable live queue row, never in the longer-lived DLQ.
    delete failedItem.callbackURL;
    delete failedItem.garminCallbackURLs;
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
            phase: `${revisionGuard.phasePrefix}_dlq`,
            logPrefix: revisionGuard.logPrefix,
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

export interface MoveToDeadLetterQueueIfCurrentAndNotCleanupTombstonedParams {
    queueItem: QueueItemInterface;
    error: Error;
    context?: string;
    collectionName: string;
    logPrefix: string;
    isCurrent: (queueItem: Record<string, unknown>) => boolean;
}

/**
 * Legacy provider-only queue rows have no Firebase uid for the normal user
 * deletion guard. Bind their DLQ transition to both the exact live revision
 * and the cleanup tombstone so a paused worker cannot recreate user data
 * after an account-cleanup sweep has completed.
 */
export async function moveToDeadLetterQueueIfCurrentAndNotCleanupTombstoned(
    params: MoveToDeadLetterQueueIfCurrentAndNotCleanupTombstonedParams,
): Promise<QueueResult.MovedToDLQ | QueueResult.Processed | QueueResult.Failed> {
    const queueItemRef = params.queueItem.ref;
    if (!queueItemRef) {
        throw new Error(`No document reference supplied for queue item ${params.queueItem.id}`);
    }

    const db = admin.firestore();
    const failedDocRef = db.collection('failed_jobs').doc(params.queueItem.id);
    const tombstoneRef = getQueueCleanupTombstoneDocumentRef(
        db,
        params.collectionName,
        params.queueItem.id,
    );
    try {
        const moved = await db.runTransaction(async transaction => {
            const [queueSnapshot, tombstoneSnapshot] = await Promise.all([
                transaction.get(queueItemRef),
                transaction.get(tombstoneRef),
            ]);
            if (tombstoneSnapshot.exists || !queueSnapshot.exists) return false;
            const currentQueueItem = queueSnapshot.data() as Record<string, unknown>;
            if (!params.isCurrent(currentQueueItem)
                || !canTransitionSleepQueueProcessingLease(currentQueueItem, params.queueItem)) return false;

            const currentQueueItemForDLQ = {
                ...currentQueueItem,
                id: params.queueItem.id,
                ref: queueItemRef,
            } as unknown as QueueItemInterface;
            transaction.set(
                failedDocRef,
                buildFailedQueueItem(currentQueueItemForDLQ, params.error, params.context),
            );
            transaction.delete(queueItemRef);
            return true;
        });
        if (!moved) {
            logger.info(`[${params.logPrefix}] Skipped stale or cleanup-tombstoned DLQ transition for ${params.queueItem.id}.`);
            return QueueResult.Processed;
        }
        logger.info(`[${params.logPrefix}] Moved queue item ${params.queueItem.id} to failed_jobs.`);
        return QueueResult.MovedToDLQ;
    } catch (error) {
        logger.error(`[${params.logPrefix}] Failed guarded DLQ transition for ${params.queueItem.id}.`, {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
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
    ) => void | Promise<void>,
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

        await transition(transaction, currentQueueItem);
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
    /** Adds provider-owned state to the same transaction as retry-exhausted DLQ movement. */
    onRetryExhaustedInTransaction?: (
        transaction: admin.firestore.Transaction,
        currentQueueItem: Record<string, unknown>,
    ) => void | Promise<void>;
    /**
     * An acknowledged delayed retry can retain its planned dispatch time as
     * the queue marker. This prevents the reconciliation scheduler from
     * starting a duplicate before that delayed task is overdue.
     */
    retryDispatchMarkerAtMs?: (nextRetryCount: number) => number | null;
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
    /** The authoritative token root whose pending generation authorizes parking. */
    serviceName: ServiceNames;
}

export interface DeferQueueItemForReconnectRequiredIfCurrentUserActiveParams
    extends DeferQueueItemForPendingDisconnectIfCurrentUserActiveParams {
    /** The meta document whose reconnect-required state authorizes parking. */
    serviceName: ServiceNames;
}

const RECONNECT_REQUIRED_ALREADY_RESOLVED = 'reconnect_required_already_resolved';
const PENDING_DISCONNECT_ALREADY_RESOLVED = 'pending_disconnect_already_resolved';

/**
 * Defers only the expected live queue revision. This prevents a provider
 * response from parking a queue item that another worker already advanced.
 */
export async function deferQueueItemForPendingDisconnectIfCurrentUserActive(
    params: DeferQueueItemForPendingDisconnectIfCurrentUserActiveParams,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
    return deferQueueItemForServiceStateIfCurrentUserActive(params);
}

/**
 * Keeps queued work durable while an account needs a new authorization. The
 * caller must provide the same current-revision predicate used for ordinary
 * provider transitions so an older worker cannot park newer work.
 */
export async function deferQueueItemForReconnectRequiredIfCurrentUserActive(
    params: DeferQueueItemForReconnectRequiredIfCurrentUserActiveParams,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
    const nowMs = Date.now();
    const queueItemRef = params.queueItem.ref;
    if (!queueItemRef) {
        throw new Error(`No document reference supplied for queue item ${params.queueItem.id}`);
    }

    const db = admin.firestore();
    const connectionMetaRef = db
        .collection('users')
        .doc(params.userID)
        .collection('meta')
        .doc(params.serviceName);

    try {
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

            const [queueItemSnapshot, connectionMetaSnapshot] = await Promise.all([
                transaction.get(queueItemRef),
                transaction.get(connectionMetaRef),
            ]);
            const currentQueueItem = queueItemSnapshot.exists
                ? queueItemSnapshot.data() as Record<string, unknown>
                : null;
            if (!currentQueueItem || !params.isCurrent(currentQueueItem)) {
                return QueueItemUserGuardedUpdateResult.NotCurrent;
            }

            if (!isReconnectRequiredServiceConnection(connectionMetaSnapshot.data())) {
                // OAuth completed after this worker observed the old failure.
                // Re-open the unchanged revision for the scheduler instead of
                // stranding it behind a reconnect state that is now resolved.
                transaction.update(queueItemRef, {
                    processed: false,
                    processedAt: FieldValue.delete(),
                    resultStatus: FieldValue.delete(),
                    deferredReason: FieldValue.delete(),
                    deferredContext: FieldValue.delete(),
                    serviceReconnectRequiredDeferredAt: FieldValue.delete(),
                    deferredServiceName: FieldValue.delete(),
                    dispatchedToCloudTask: null,
                    providerOperationStartedAt: null,
                    expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
                    ...clearRevisionProcessingLeaseUpdate(),
                });
                return RECONNECT_REQUIRED_ALREADY_RESOLVED;
            }

            transaction.update(queueItemRef, {
                ...params.additionalData,
                processed: true,
                resultStatus: 'deferred',
                deferredReason: QUEUE_DEFERRED_REASONS.ServiceReconnectRequired,
                deferredContext: 'SERVICE_RECONNECT_REQUIRED',
                serviceReconnectRequiredDeferredAt: nowMs,
                dispatchedToCloudTask: PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER,
                providerOperationStartedAt: null,
                expireAt: getExpireAtTimestamp(TTL_CONFIG.PENDING_DISCONNECT_QUEUE_ITEM_IN_DAYS),
                ...clearRevisionProcessingLeaseUpdate(),
            });
            return QueueItemUserGuardedUpdateResult.Updated;
        });

        if (transitionResult === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
            await cleanupQueueItemAfterUserDeletionGuard({
                queueItemDocument: queueItemRef,
                queueItemId: params.queueItem.id,
                logPrefix: params.logPrefix,
                actionDescription: 'reconnect-required deferral',
            });
            return QueueResult.Processed;
        }
        if (transitionResult === QueueItemUserGuardedUpdateResult.NotCurrent) {
            logger.info(
                `[${params.logPrefix}] Skipping stale reconnect-required deferral for queue item ${params.queueItem.id}; its live state has already advanced or been replaced.`,
            );
            return QueueResult.Processed;
        }
        if (transitionResult === RECONNECT_REQUIRED_ALREADY_RESOLVED) {
            logger.info(
                `[${params.logPrefix}] Re-opened queue item ${params.queueItem.id} because ${params.serviceName} reconnected before it could be parked.`,
            );
            return QueueResult.Processed;
        }

        logger.info(`Deferred queue item ${params.queueItem.id} because service state is service_reconnect_required.`);
        return QueueResult.Deferred;
    } catch (error) {
        logger.error(new Error(`Could not update guarded reconnect-required state for ${params.queueItem.id}: ${error}`));
        return QueueResult.Failed;
    }
}

async function deferQueueItemForServiceStateIfCurrentUserActive(
    params: DeferQueueItemForPendingDisconnectIfCurrentUserActiveParams,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
    const nowMs = Date.now();
    const proposedGeneration = crypto.randomUUID();
    const queueItemRef = params.queueItem.ref;
    if (!queueItemRef) {
        throw new Error(`No document reference supplied for queue item ${params.queueItem.id}`);
    }
    const db = admin.firestore();
    const tokenRootRef = getServiceTokenRootDocumentRef(params.userID, params.serviceName);
    try {
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

            const [queueItemSnapshot, pendingRootSnapshot] = await Promise.all([
                transaction.get(queueItemRef),
                transaction.get(tokenRootRef),
            ]);
            const currentQueueItem = queueItemSnapshot.exists
                ? queueItemSnapshot.data() as Record<string, unknown>
                : null;
            if (!currentQueueItem || !params.isCurrent(currentQueueItem)) {
                return QueueItemUserGuardedUpdateResult.NotCurrent;
            }

            const pendingRootData = pendingRootSnapshot.data() as Record<string, unknown> | undefined;
            if (!isServiceDisconnectPendingData(pendingRootData)) {
                transaction.update(queueItemRef, {
                    processed: false,
                    processedAt: FieldValue.delete(),
                    resultStatus: FieldValue.delete(),
                    deferredReason: FieldValue.delete(),
                    deferredContext: FieldValue.delete(),
                    deferredServiceName: FieldValue.delete(),
                    serviceDisconnectPendingDeferredAt: FieldValue.delete(),
                    serviceDisconnectPendingGeneration: FieldValue.delete(),
                    dispatchedToCloudTask: null,
                    providerOperationStartedAt: null,
                    expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
                    ...clearRevisionProcessingLeaseUpdate(),
                });
                return PENDING_DISCONNECT_ALREADY_RESOLVED;
            }

            const generation = typeof pendingRootData?.disconnectGeneration === 'string'
                && pendingRootData.disconnectGeneration.trim()
                ? pendingRootData.disconnectGeneration.trim()
                : proposedGeneration;
            if (generation === proposedGeneration) {
                transaction.set(tokenRootRef, { disconnectGeneration: generation }, { merge: true });
            }
            transaction.update(queueItemRef, {
                ...params.additionalData,
                processed: true,
                resultStatus: 'deferred',
                deferredReason: QUEUE_DEFERRED_REASONS.ServiceDisconnectPending,
                deferredContext: 'SERVICE_DISCONNECT_PENDING',
                serviceDisconnectPendingDeferredAt: nowMs,
                serviceDisconnectPendingGeneration: generation,
                dispatchedToCloudTask: PENDING_DISCONNECT_QUEUE_DISPATCH_MARKER,
                providerOperationStartedAt: null,
                expireAt: getExpireAtTimestamp(TTL_CONFIG.PENDING_DISCONNECT_QUEUE_ITEM_IN_DAYS),
                ...clearRevisionProcessingLeaseUpdate(),
            });
            return QueueItemUserGuardedUpdateResult.Updated;
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
        if (transitionResult === PENDING_DISCONNECT_ALREADY_RESOLVED) {
            logger.info(
                `[${params.logPrefix}] Re-opened queue item ${params.queueItem.id} because ${params.serviceName} pending disconnect cleared before it could be parked.`,
            );
            return QueueResult.Processed;
        }

        logger.info(`Deferred queue item ${params.queueItem.id} because service state is service_disconnect_pending.`);
        return QueueResult.Deferred;
    } catch (error) {
        logger.error(new Error(`Could not update guarded pending-disconnect state for ${params.queueItem.id}: ${error}`));
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
    let nextDispatchMarker: number | null = null;
    let movedToDlq = false;
    let nextErrors: QueueItemInterface['errors'] = [];

    try {
        const transitionResult = await runQueueItemTransitionIfCurrentUserActive({
            ...params,
            actionDescription: 'retry-state transition',
        }, async (transaction, currentQueueItem) => {
            movedToDlq = false;
            const currentRetryCount = Number.isFinite(Number(currentQueueItem.retryCount))
                ? Math.max(0, Math.floor(Number(currentQueueItem.retryCount)))
                : 0;
            const currentTotalRetryCount = Number.isFinite(Number(currentQueueItem.totalRetryCount))
                ? Math.max(0, Math.floor(Number(currentQueueItem.totalRetryCount)))
                : 0;
            nextRetryCount = currentRetryCount + incrementBy;
            nextTotalRetryCount = currentTotalRetryCount + incrementBy;
            const requestedDispatchMarker = params.retryDispatchMarkerAtMs?.(nextRetryCount);
            nextDispatchMarker = Number.isFinite(requestedDispatchMarker)
                && Number(requestedDispatchMarker) > 0
                ? Math.floor(Number(requestedDispatchMarker))
                : null;
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
                await params.onRetryExhaustedInTransaction?.(
                    transaction,
                    currentQueueItem,
                );
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
                        dispatchedToCloudTask: null,
                        providerOperationStartedAt: null,
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
                dispatchedToCloudTask: nextDispatchMarker,
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

        params.queueItem.dispatchedToCloudTask = nextDispatchMarker;
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
    onRetryExhaustedInTransaction?: IncreaseRetryCountIfCurrentUserActiveParams[
        'onRetryExhaustedInTransaction'
    ],
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
            onRetryExhaustedInTransaction,
            userID: revisionGuard.userID,
            phase: `${revisionGuard.phasePrefix}_retry`,
            logPrefix: revisionGuard.logPrefix,
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
            phase: `${revisionGuard.phasePrefix}_completion`,
            logPrefix: revisionGuard.logPrefix,
            actionDescription: 'processed-state transition',
            isCurrent: revisionGuard.isCurrent,
        }, transaction => {
            transaction.update(queueItem.ref!, {
                processed: true,
                processedAt: nowMs,
                ...additionalData,
                ...clearTerminalProviderCredentialUpdate(queueItem),
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

async function updateLegacySleepQueueToProcessedIfCurrentAndNotCleanupTombstoned(
    queueItem: QueueItemInterface,
    additionalData: Record<string, unknown> | undefined,
): Promise<QueueResult.Processed | QueueResult.Failed> {
    const queueItemRef = queueItem.ref!;
    const db = admin.firestore();
    const tombstoneRef = getQueueCleanupTombstoneDocumentRef(
        db,
        SLEEP_SYNC_QUEUE_COLLECTION_NAME,
        queueItem.id,
    );
    const nowMs = Date.now();
    try {
        const updated = await db.runTransaction(async transaction => {
            const [queueSnapshot, tombstoneSnapshot] = await Promise.all([
                transaction.get(queueItemRef),
                transaction.get(tombstoneRef),
            ]);
            if (tombstoneSnapshot.exists || !queueSnapshot.exists) return false;
            const currentQueueItem = queueSnapshot.data() as Record<string, unknown>;
            if (!isCurrentSleepQueueTransition(currentQueueItem, queueItem)) return false;

            transaction.update(queueItemRef, {
                processed: true,
                processedAt: nowMs,
                ...additionalData,
                ...clearTerminalProviderCredentialUpdate(queueItem),
                ...clearRevisionProcessingLeaseUpdate(),
            });
            return true;
        });
        if (!updated) {
            logger.info(`Skipping stale, leased, or cleanup-tombstoned legacy Sleep completion for queue item ${queueItem.id}.`);
        }
        return QueueResult.Processed;
    } catch (error) {
        logger.error(`Could not update guarded legacy Sleep processed state for ${queueItem.id}.`, {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
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
    if (queueItem.ref.parent?.id === SLEEP_SYNC_QUEUE_COLLECTION_NAME) {
        return updateLegacySleepQueueToProcessedIfCurrentAndNotCleanupTombstoned(
            queueItem,
            additionalData,
        );
    }
    try {
        const ref = queueItem.ref;
        queueItem.ref = undefined;
        const updateData = Object.assign({
            'processed': true,
            'processedAt': (new Date()).getTime(),
        }, additionalData, clearTerminalProviderCredentialUpdate(queueItem));
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

function clearTerminalProviderCredentialUpdate(
    queueItem: QueueItemInterface,
): Record<string, unknown> {
    // Garmin callback URLs embed a short-lived pull token. Preserve that
    // credential only while the live row can retry; every terminal outcome
    // (success, skip, or provider-disabled) must remove it.
    const credentialFields: Record<string, unknown> = {};
    const providerQueueItem = queueItem as QueueItemInterface & {
        callbackURL?: unknown;
        garminCallbackURLs?: unknown;
    };
    if (typeof providerQueueItem.callbackURL === 'string') {
        credentialFields.callbackURL = FieldValue.delete();
    }
    if (Array.isArray(providerQueueItem.garminCallbackURLs)) {
        credentialFields.garminCallbackURLs = FieldValue.delete();
    }
    return credentialFields;
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
    context?: { userID: string; serviceName: ServiceNames },
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }

    const revisionGuard = getQueueRevisionGuard(queueItem);
    const resolvedContext = context && context.userID.trim()
        ? context
        : null;
    if (!resolvedContext) {
        throw new Error(`No pending-disconnect service context supplied for queue item ${queueItem.id}`);
    }
    const expectedDateCreated = Number(queueItem.dateCreated);
    return deferQueueItemForPendingDisconnectIfCurrentUserActive({
        queueItem,
        additionalData,
        bulkWriter,
        userID: resolvedContext.userID,
        serviceName: resolvedContext.serviceName,
        phase: revisionGuard
            ? `${revisionGuard.phasePrefix}_pending_disconnect`
            : 'queue_pending_disconnect',
        logPrefix: revisionGuard ? revisionGuard.logPrefix : 'QueuePendingDisconnect',
        isCurrent: revisionGuard?.isCurrent || ((currentQueueItem) => (
            currentQueueItem.processed !== true
            && (!Number.isFinite(expectedDateCreated) || currentQueueItem.dateCreated === expectedDateCreated)
        )),
    });
}
