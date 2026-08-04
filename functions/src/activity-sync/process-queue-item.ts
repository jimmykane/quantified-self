import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    ActivitySyncQueueItemInterface,
    ActivitySyncUploadContinuation,
} from '../queue/queue-item.interface';
import {
    QueueResult,
    QUEUE_SKIPPED_REASONS,
    deferQueueItemForPendingDisconnect,
    increaseRetryCountForQueueItem,
    markQueueItemSkipped,
    moveToDeadLetterQueue,
    updateToProcessed,
} from '../queue-utils';
import { ACTIVITY_SYNC_ROUTES } from '../../../shared/activity-sync-routes';
import { isActivitySyncRouteEnabledForUser } from './settings';
import { getServiceConnectionMeta } from '../service-connection-meta';
import {
    isDisconnectPendingServiceConnection,
    isServiceUnavailableForSyncConnection,
} from '../../../shared/service-connection';
import {
    setActivitySyncFailedMetadata,
    setActivitySyncProcessingMetadata,
    setActivitySyncRetryingMetadata,
    setActivitySyncSkippedMetadata,
    setActivitySyncSuccessMetadata,
    toActivitySyncMetadataError,
} from './metadata';
import {
    getSuuntoActivityUploadStatus,
    recordSuccessfulSuuntoActivityUploadForQueueItem,
    resumeSuuntoActivityBlobUpload,
    SuuntoActivityBlobContinuation,
    SuuntoActivityUploadStatePersistenceSkippedError,
    uploadActivityFileToSuunto,
} from '../suunto/activities';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { getWahooActivityUploadStatus, uploadActivityFileToWahoo } from '../wahoo/activities';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { hasProAccess } from '../utils';
import { getActivitySyncRouteAllowlistConfigError, isActivitySyncRouteUserAllowlisted } from './allowlist';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
import {
    QueueItemUserGuardedUpdateResult,
    updateQueueItemIfUserActive,
} from '../queue/dispatch-marker';
import {
    isProviderOperationError,
    ProviderOperationError,
} from '../shared/provider-operation-error';

function toExtension(path?: string, extension?: string): string {
    if (extension && typeof extension === 'string' && extension.trim().length > 0) {
        return extension.trim().toLowerCase();
    }

    if (!path || typeof path !== 'string') {
        return '';
    }

    const dotIndex = path.lastIndexOf('.');
    if (dotIndex < 0 || dotIndex === path.length - 1) {
        return '';
    }

    return path.slice(dotIndex + 1).toLowerCase();
}

function toError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    return new Error(`${error}`);
}

interface ErrorLike {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
    if (!error || typeof error !== 'object') {
        return {};
    }

    return error as ErrorLike;
}

const TRANSIENT_ACTIVITY_SYNC_ERROR_CODES = new Set([
    'aborted',
    'deadline-exceeded',
    'unavailable',
    'resource-exhausted',
]);

const TRANSIENT_ACTIVITY_SYNC_GRPC_CODES = new Set([
    4, // DEADLINE_EXCEEDED
    10, // ABORTED
    14, // UNAVAILABLE
]);

const TRANSIENT_ACTIVITY_SYNC_STATUS_CODES = new Set([
    429,
    500,
    502,
    503,
    504,
]);

function toNormalizedErrorCode(value: unknown): string {
    return `${value || ''}`.trim().toLowerCase().replace(/_/g, '-');
}

function toFiniteNumber(value: unknown): number | null {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return null;
    }

    return numericValue;
}

function isTransientActivitySyncError(error: unknown): boolean {
    const errorLike = asErrorLike(error);

    const normalizedCode = toNormalizedErrorCode(errorLike.code);
    const normalizedStatus = toNormalizedErrorCode(errorLike.status);
    if (TRANSIENT_ACTIVITY_SYNC_ERROR_CODES.has(normalizedCode) || TRANSIENT_ACTIVITY_SYNC_ERROR_CODES.has(normalizedStatus)) {
        return true;
    }

    const grpcCode = toFiniteNumber(errorLike.code);
    const grpcStatus = toFiniteNumber(errorLike.status);
    if (
        (grpcCode !== null && TRANSIENT_ACTIVITY_SYNC_GRPC_CODES.has(grpcCode)) ||
        (grpcStatus !== null && TRANSIENT_ACTIVITY_SYNC_GRPC_CODES.has(grpcStatus))
    ) {
        return true;
    }

    const statusCode = toFiniteNumber(errorLike.statusCode);
    return statusCode !== null && TRANSIENT_ACTIVITY_SYNC_STATUS_CODES.has(statusCode);
}

function isLegacyRetryableSuuntoActivitySyncError(queueItem: ActivitySyncQueueItemInterface, error: unknown): boolean {
    if (queueItem.destinationServiceName !== ServiceNames.SuuntoApp) {
        return false;
    }

    const errorLike = asErrorLike(error);
    const message = `${errorLike.message || (error instanceof Error ? error.message : '')}`
        .trim()
        .toLowerCase();

    // Compatibility for workers deployed with the July 2026 Suunto outage
    // mitigation before provider failures became typed at the API boundary.
    return message === 'suunto processing failed: internal error';
}

function isSkippableAuthenticationError(error: unknown): boolean {
    const errorLike = asErrorLike(error);
    const httpsCode = `${errorLike.code || ''}`.trim().toLowerCase();
    return httpsCode === 'unauthenticated' || httpsCode === 'permission-denied';
}

function isWahooWriteScopeError(error: unknown): boolean {
    return error instanceof Error && error.name === 'WahooWorkoutWriteScopeRequiredError';
}

function isAccountDeletionSkipError(error: unknown): boolean {
    return error instanceof Error
        && (
            error.name === 'TokenRefreshSkippedForDeletedUserError'
            || error.name === 'SuuntoActivityUploadSkippedForDeletedUserError'
            || error.name === 'WahooActivityUploadSkippedForDeletedUserError'
        );
}

function isTokenUseSkippedForPendingDisconnectError(error: unknown): boolean {
    return error instanceof Error && error.name === 'TokenUseSkippedForPendingDisconnectError';
}

async function getPendingDisconnectServiceForRoute(
    userID: string,
    route: typeof ACTIVITY_SYNC_ROUTES[keyof typeof ACTIVITY_SYNC_ROUTES],
): Promise<ServiceNames | null> {
    const [sourceMeta, destinationMeta] = await Promise.all([
        getServiceConnectionMeta(userID, route.sourceServiceName),
        getServiceConnectionMeta(userID, route.destinationServiceName),
    ]);

    if (isDisconnectPendingServiceConnection(sourceMeta)) {
        return route.sourceServiceName;
    }
    if (isDisconnectPendingServiceConnection(destinationMeta)) {
        return route.destinationServiceName;
    }

    return null;
}

type DestinationConnectionStatus = 'connected' | 'not_connected' | 'disconnect_pending';

async function getDestinationConnectionStatus(userID: string, destinationServiceName: ServiceNames): Promise<DestinationConnectionStatus> {
    switch (destinationServiceName) {
        case ServiceNames.SuuntoApp: {
            const meta = await getServiceConnectionMeta(userID, destinationServiceName);
            if (isDisconnectPendingServiceConnection(meta)) {
                return 'disconnect_pending';
            }
            if (isServiceUnavailableForSyncConnection(meta)) {
                return 'not_connected';
            }
            const snapshot = await admin.firestore()
                .collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME)
                .doc(userID)
                .collection('tokens')
                .limit(1)
                .get();
            return snapshot.size > 0 ? 'connected' : 'not_connected';
        }
        case ServiceNames.WahooAPI: {
            const meta = await getServiceConnectionMeta(userID, destinationServiceName);
            if (isDisconnectPendingServiceConnection(meta)) {
                return 'disconnect_pending';
            }
            if (isServiceUnavailableForSyncConnection(meta)) {
                return 'not_connected';
            }
            const snapshot = await admin.firestore()
                .collection(WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME)
                .doc(userID)
                .collection('tokens')
                .limit(1)
                .get();
            return snapshot.size > 0 ? 'connected' : 'not_connected';
        }
        default:
            return 'not_connected';
    }
}

async function downloadOriginalFile(queueItem: ActivitySyncQueueItemInterface): Promise<Buffer> {
    const originalPath = `${queueItem.originalFile?.path || ''}`.trim();
    if (!originalPath) {
        throw new Error('Missing original file path on activity sync queue item.');
    }

    const bucketName = `${queueItem.originalFile?.bucket || ''}`.trim();
    const bucket = bucketName.length > 0 ? admin.storage().bucket(bucketName) : admin.storage().bucket();
    const [buffer] = await bucket.file(originalPath).download();
    return buffer;
}

interface UploadActivityFileResult {
    status?: string;
    code?: string;
    message?: string;
    workoutKey?: string;
    uploadId?: string;
    providerUserId?: string;
    blobContinuation?: SuuntoActivityBlobContinuation;
}

interface ActivitySyncRouteMeta {
    routeId: ActivitySyncQueueItemInterface['routeId'];
    userID: string;
    eventID: string;
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    manual: boolean;
}

async function uploadToDestination(
    queueItem: ActivitySyncQueueItemInterface,
    fileBuffer?: Buffer,
): Promise<UploadActivityFileResult> {
    switch (queueItem.destinationServiceName) {
        case ServiceNames.SuuntoApp:
            if (queueItem.destinationUploadID && queueItem.destinationProviderUserID) {
                const continuation = getSuuntoBlobContinuation(queueItem);
                if (continuation) {
                    if (!fileBuffer) {
                        throw new Error('Suunto activity blob continuation is missing its source file.');
                    }
                    return resumeSuuntoActivityBlobUpload(queueItem.userID, fileBuffer, {
                        uploadId: queueItem.destinationUploadID,
                        providerUserId: queueItem.destinationProviderUserID,
                        blobContinuation: {
                            uploadUrl: continuation.uploadUrl,
                            uploadHeaders: continuation.uploadHeaders,
                        },
                    });
                }
                return getSuuntoActivityUploadStatus(
                    queueItem.userID,
                    queueItem.destinationUploadID,
                    queueItem.destinationProviderUserID,
                );
            }
            if (!fileBuffer) {
                throw new Error('Suunto activity upload is missing its source file.');
            }
            return uploadActivityFileToSuunto(queueItem.userID, fileBuffer, {
                persistUploadStateBeforeBlob: state => persistDestinationUploadState(queueItem, {
                    status: 'pending',
                    message: 'Suunto activity upload initialized.',
                    uploadId: state.uploadId,
                    providerUserId: state.providerUserId,
                    blobContinuation: state.blobContinuation,
                }),
            });
        case ServiceNames.WahooAPI:
            if (queueItem.destinationUploadID) {
                return getWahooActivityUploadStatus(queueItem.userID, queueItem.destinationUploadID);
            }
            if (!fileBuffer) {
                throw new Error('Wahoo activity upload is missing its source file.');
            }
            return uploadActivityFileToWahoo(queueItem.userID, fileBuffer, {
                filename: queueItem.originalFile.originalFilename || queueItem.originalFile.path.split('/').pop(),
            });
        default:
            throw new Error(`Unsupported destination service ${queueItem.destinationServiceName}`);
    }
}

function getSuuntoBlobContinuation(
    queueItem: ActivitySyncQueueItemInterface,
): ActivitySyncUploadContinuation | null {
    const continuation = queueItem.destinationUploadContinuation as unknown;
    if (continuation === undefined || continuation === null) {
        return null;
    }
    if (
        typeof continuation !== 'object'
        || Array.isArray(continuation)
        || (continuation as { type?: unknown }).type !== 'suunto_blob_put_v1'
    ) {
        throw new ProviderOperationError({
            serviceName: ServiceNames.SuuntoApp,
            operation: 'activity_upload_blob',
            disposition: 'permanent',
            retryMode: 'none',
            code: 'failed-precondition',
            message: 'Suunto upload continuation has an unsupported format.',
            providerOperationId: queueItem.destinationUploadID || undefined,
            providerUserId: queueItem.destinationProviderUserID || undefined,
            dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_INVALID_CONTINUATION',
        });
    }
    return continuation as ActivitySyncUploadContinuation;
}

function shouldDownloadOriginalFileForDestination(queueItem: ActivitySyncQueueItemInterface): boolean {
    return !hasPersistedDestinationUpload(queueItem)
        || (
            queueItem.destinationServiceName === ServiceNames.SuuntoApp
            && queueItem.destinationUploadContinuation !== undefined
            && queueItem.destinationUploadContinuation !== null
        );
}

function hasPersistedDestinationUpload(queueItem: ActivitySyncQueueItemInterface): boolean {
    if (queueItem.destinationServiceName === ServiceNames.SuuntoApp) {
        return !!queueItem.destinationUploadID && !!queueItem.destinationProviderUserID;
    }
    return !!queueItem.destinationUploadID;
}

function hasMatchingPersistedDestinationUpload(
    queueItem: ActivitySyncQueueItemInterface,
    uploadId: string,
    providerUserId?: string,
): boolean {
    return queueItem.destinationUploadID === uploadId
        && (
            queueItem.destinationServiceName !== ServiceNames.SuuntoApp
            || queueItem.destinationProviderUserID === providerUserId
        );
}

function hasIncompleteSuuntoDestinationUpload(queueItem: ActivitySyncQueueItemInterface): boolean {
    return queueItem.destinationServiceName === ServiceNames.SuuntoApp
        && !!queueItem.destinationUploadID !== !!queueItem.destinationProviderUserID;
}

async function persistDestinationUploadState(
    queueItem: ActivitySyncQueueItemInterface,
    uploadResult: UploadActivityFileResult,
): Promise<boolean> {
    if (!queueItem.ref || !uploadResult.uploadId) {
        throw new Error('Destination upload is missing queue persistence data.');
    }
    const destinationUploadID = uploadResult.uploadId;
    const destinationProviderUserID = uploadResult.providerUserId || queueItem.destinationProviderUserID;
    if (queueItem.destinationServiceName === ServiceNames.SuuntoApp && !destinationProviderUserID) {
        throw new Error('Suunto upload is missing its provider user identity.');
    }
    const destinationWorkoutKey = uploadResult.workoutKey || queueItem.destinationWorkoutKey;
    const destinationInfoCode = uploadResult.code || queueItem.destinationInfoCode;
    const destinationUploadContinuation = uploadResult.blobContinuation
        ? {
            type: 'suunto_blob_put_v1' as const,
            uploadUrl: uploadResult.blobContinuation.uploadUrl,
            uploadHeaders: uploadResult.blobContinuation.uploadHeaders,
        }
        : queueItem.destinationUploadContinuation || null;
    const updateResult = await updateQueueItemIfUserActive({
        queueItemDocument: queueItem.ref,
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        phase: queueItem.destinationServiceName === ServiceNames.WahooAPI
            ? 'before_activity_sync_wahoo_upload_state_persist'
            : 'before_activity_sync_suunto_upload_state_persist',
        updateData: {
            destinationUploadID,
            destinationProviderUserID: destinationProviderUserID || null,
            destinationWorkoutKey: destinationWorkoutKey || null,
            destinationInfoCode: destinationInfoCode || null,
            destinationUploadContinuation,
        },
        logPrefix: 'ActivitySync',
        actionDescription: `${queueItem.destinationServiceName} upload state persistence`,
    });
    if (updateResult !== QueueItemUserGuardedUpdateResult.Updated) {
        // The guarded update writes a cleanup tombstone and deletes the queue item.
        // A follow-up queue-state write would target a document that no longer exists.
        return false;
    }
    queueItem.destinationUploadID = destinationUploadID;
    queueItem.destinationProviderUserID = destinationProviderUserID || null;
    queueItem.destinationWorkoutKey = destinationWorkoutKey;
    queueItem.destinationInfoCode = destinationInfoCode;
    queueItem.destinationUploadContinuation = destinationUploadContinuation;
    return true;
}

async function clearPendingDestinationUploadForRestart(
    queueItem: ActivitySyncQueueItemInterface,
): Promise<boolean> {
    if (
        !queueItem.destinationUploadID
        && !queueItem.destinationProviderUserID
        && !queueItem.destinationWorkoutKey
        && !queueItem.destinationInfoCode
        && !queueItem.destinationUploadContinuation
    ) {
        return true;
    }
    if (!queueItem.ref) {
        throw new Error('Pending destination upload cannot be cleared without a queue document reference.');
    }

    const updateResult = await updateQueueItemIfUserActive({
        queueItemDocument: queueItem.ref,
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        phase: 'before_activity_sync_pending_upload_restart',
        updateData: {
            destinationUploadID: null,
            destinationProviderUserID: null,
            destinationWorkoutKey: null,
            destinationInfoCode: null,
            destinationUploadContinuation: null,
        },
        logPrefix: 'ActivitySync',
        actionDescription: 'pending destination upload restart',
    });
    if (updateResult !== QueueItemUserGuardedUpdateResult.Updated) {
        return false;
    }

    queueItem.destinationUploadID = null;
    queueItem.destinationProviderUserID = null;
    queueItem.destinationWorkoutKey = undefined;
    queueItem.destinationInfoCode = undefined;
    queueItem.destinationUploadContinuation = null;
    return true;
}

function buildPendingDestinationUploadError(
    queueItem: ActivitySyncQueueItemInterface,
    uploadResult: UploadActivityFileResult,
): Error {
    if (queueItem.destinationServiceName === ServiceNames.SuuntoApp) {
        const persistedResumeState = hasPersistedDestinationUpload(queueItem);
        const providerOperationId = uploadResult.uploadId
            || (persistedResumeState ? queueItem.destinationUploadID || undefined : undefined);
        const providerUserId = uploadResult.providerUserId
            || (persistedResumeState ? queueItem.destinationProviderUserID || undefined : undefined);
        if (!providerOperationId || !providerUserId) {
            return buildInvalidProviderResumeStateError(
                queueItem,
                providerOperationId,
                providerUserId,
            );
        }
        return new ProviderOperationError({
            serviceName: ServiceNames.SuuntoApp,
            operation: 'activity_upload_status',
            disposition: 'retryable',
            retryMode: 'resume',
            code: 'deadline-exceeded',
            message: uploadResult.message || 'Suunto is still processing the activity.',
            providerUserId,
            providerOperationId,
            dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
        });
    }

    return Object.assign(new Error('Wahoo is still processing the activity.'), {
        code: 'deadline-exceeded',
    });
}

function buildInvalidProviderResumeStateError(
    queueItem: ActivitySyncQueueItemInterface,
    providerOperationId?: string,
    providerUserId?: string,
): ProviderOperationError {
    return new ProviderOperationError({
        serviceName: queueItem.destinationServiceName,
        operation: 'activity_upload_status',
        disposition: 'permanent',
        retryMode: 'none',
        code: 'failed-precondition',
        message: `${queueItem.destinationServiceName} returned an asynchronous upload state without the identifiers required to resume it safely.`,
        providerOperationId,
        providerUserId,
        dlqContext: 'DESTINATION_PROVIDER_INVALID_RESUME_STATE',
    });
}

async function moveUploadStatePersistenceFailureToDlq(
    queueItem: ActivitySyncQueueItemInterface,
    uploadResult: UploadActivityFileResult,
    persistenceError: unknown,
    bulkWriter: admin.firestore.BulkWriter | undefined,
    routeMeta: ActivitySyncRouteMeta,
): Promise<QueueResult.MovedToDLQ | QueueResult.Skipped | QueueResult.Failed> {
    const destinationUploadID = uploadResult.uploadId || queueItem.destinationUploadID || undefined;
    const destinationProviderUserID = uploadResult.providerUserId || queueItem.destinationProviderUserID || undefined;
    const stateError = Object.assign(
        new Error(`Could not persist ${queueItem.destinationServiceName} asynchronous upload state safely.`),
        {
            code: 'internal',
            dlqContext: 'DESTINATION_PROVIDER_RESUME_STATE_PERSIST_FAILED',
        },
    );
    logger.error('[ActivitySync] Moving accepted asynchronous upload to DLQ because resume state could not be persisted.', {
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        destinationServiceName: queueItem.destinationServiceName,
        providerOperationId: destinationUploadID,
        providerUserId: destinationProviderUserID,
        persistenceError: toError(persistenceError).message,
        dlqContext: stateError.dlqContext,
    });
    await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
        ...routeMeta,
        error: toActivitySyncMetadataError(stateError),
    }));

    const failedQueueItem: ActivitySyncQueueItemInterface = {
        ...queueItem,
        destinationUploadID: destinationUploadID || null,
        destinationProviderUserID: destinationProviderUserID || null,
        ...(uploadResult.workoutKey ? { destinationWorkoutKey: uploadResult.workoutKey } : {}),
        ...(uploadResult.code ? { destinationInfoCode: uploadResult.code } : {}),
    };
    const dlqResult = await moveToDeadLetterQueue(
        failedQueueItem,
        stateError,
        bulkWriter,
        stateError.dlqContext,
    );
    if (dlqResult === QueueResult.Failed && destinationUploadID) {
        // Retrying would repeat a provider POST whose acceptance is already
        // known. Leave the original queue row for manual reconciliation and
        // acknowledge the Cloud Task instead of creating a duplicate upload.
        logger.error('[ActivitySync] Acknowledging an accepted provider upload after both resume-state and DLQ persistence failed; manual reconciliation is required.', {
            queueItemId: queueItem.id,
            userID: queueItem.userID,
            destinationServiceName: queueItem.destinationServiceName,
            dlqContext: stateError.dlqContext,
        });
        return QueueResult.Skipped;
    }
    return dlqResult;
}

function logProviderFailureDecision(
    queueItem: ActivitySyncQueueItemInterface,
    error: ProviderOperationError,
    outcome: 'retry' | 'skip' | 'dlq',
): void {
    const details = {
        queue: 'activitySyncQueue',
        queueItemId: queueItem.id,
        routeId: queueItem.routeId,
        userID: queueItem.userID,
        destinationServiceName: queueItem.destinationServiceName,
        operation: error.operation,
        disposition: error.disposition,
        retryMode: error.retryMode,
        providerCode: error.providerCode,
        statusCode: error.statusCode,
        providerUserId: error.providerUserId,
        providerOperationId: error.providerOperationId,
        message: error.message,
        retryCount: queueItem.retryCount || 0,
        dlqContext: error.dlqContext,
        outcome,
    };
    if (outcome === 'dlq') {
        logger.error('[ActivitySync] Destination provider failure moved to DLQ.', details);
    } else {
        logger.warn('[ActivitySync] Destination provider failure classified.', details);
    }
}

async function safelyWriteMetadata(writeOperation: () => Promise<void>): Promise<void> {
    try {
        await writeOperation();
    } catch {
        // Queue state transitions (retry/DLQ/processed) are the source of truth.
        // Metadata write failures should not prevent those transitions.
    }
}

function getDeadLetterContext(error: unknown): string {
    const errorLike = asErrorLike(error) as ErrorLike & { dlqContext?: unknown };
    const context = `${errorLike.dlqContext || ''}`.trim();
    return context.length > 0 ? context : 'ACTIVITY_SYNC_PERMANENT_FAILURE';
}

async function deferActivitySyncQueueItemForPendingDisconnect(
    queueItem: ActivitySyncQueueItemInterface,
    bulkWriter: admin.firestore.BulkWriter | undefined,
    routeMeta: ActivitySyncRouteMeta,
    serviceName: ServiceNames,
): Promise<QueueResult.Deferred | QueueResult.Failed> {
    const error = new Error(`${serviceName} disconnect is pending.`);
    await safelyWriteMetadata(() => setActivitySyncRetryingMetadata({
        ...routeMeta,
        error: toActivitySyncMetadataError(error),
    }));
    return deferQueueItemForPendingDisconnect(queueItem, bulkWriter, {
        deferredServiceName: `${serviceName}`,
    });
}

export async function processActivitySyncQueueItem(
    queueItem: ActivitySyncQueueItemInterface,
    bulkWriter?: admin.firestore.BulkWriter,
): Promise<QueueResult> {
    const routeMeta = {
        routeId: queueItem.routeId,
        userID: queueItem.userID,
        eventID: queueItem.eventID,
        sourceServiceName: queueItem.sourceServiceName,
        destinationServiceName: queueItem.destinationServiceName,
        manual: queueItem.manual === true,
    };

    let duringDestinationUpload = false;

    try {
        if (await shouldSkipQueueWorkForDeletedUser(
            queueItem.userID,
            queueItem.destinationServiceName,
            queueItem.id,
            'before_activity_sync_processing',
        )) {
            return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
            });
        }

        const route = ACTIVITY_SYNC_ROUTES[queueItem.routeId];
        if (!route) {
            const error = new Error(`Unknown activity sync route ${queueItem.routeId}`) as Error & { dlqContext?: string };
            error.dlqContext = 'UNKNOWN_ACTIVITY_SYNC_ROUTE';
            throw error;
        }

        const allowlistConfigError = getActivitySyncRouteAllowlistConfigError(queueItem.routeId);
        if (allowlistConfigError) {
            await setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'allowlist_misconfigured',
                detail: allowlistConfigError,
            });
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'allowlist_misconfigured',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        if (!isActivitySyncRouteUserAllowlisted(queueItem.routeId, queueItem.userID)) {
            await setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'user_not_allowlisted',
                detail: 'User is not allowlisted for this activity sync route.',
            });
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'user_not_allowlisted',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        await setActivitySyncProcessingMetadata(routeMeta);

        if (!(await hasProAccess(queueItem.userID))) {
            await setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'no_pro_access',
                detail: 'Activity sync is a Pro feature.',
            });
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'no_pro_access',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        const enabled = await isActivitySyncRouteEnabledForUser(queueItem.userID, queueItem.routeId);
        const isManualRun = queueItem.manual === true;
        const pendingDisconnectService = await getPendingDisconnectServiceForRoute(queueItem.userID, route);
        if (pendingDisconnectService) {
            return deferActivitySyncQueueItemForPendingDisconnect(
                queueItem,
                bulkWriter,
                routeMeta,
                pendingDisconnectService,
            );
        }

        if (!enabled && !isManualRun) {
            await setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'route_disabled',
                detail: 'Route is disabled in user settings.',
            });
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'route_disabled',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        const destinationConnectionStatus = await getDestinationConnectionStatus(queueItem.userID, queueItem.destinationServiceName);
        if (destinationConnectionStatus === 'disconnect_pending') {
            return deferActivitySyncQueueItemForPendingDisconnect(
                queueItem,
                bulkWriter,
                routeMeta,
                queueItem.destinationServiceName,
            );
        }
        if (destinationConnectionStatus === 'not_connected') {
            await setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_not_connected',
                detail: 'Destination account is not connected.',
            });
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'destination_not_connected',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        const extension = toExtension(queueItem.originalFile?.path, queueItem.originalFile?.extension);
        if (!route.supportedFileExtensions.includes(extension)) {
            await setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'unsupported_original_file',
                detail: `Unsupported original file extension: ${extension || 'unknown'}.`,
            });
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'unsupported_original_file',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        if (await shouldSkipQueueWorkForDeletedUser(
            queueItem.userID,
            queueItem.destinationServiceName,
            queueItem.id,
            'before_activity_sync_upload',
        )) {
            return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
            });
        }

        if (hasIncompleteSuuntoDestinationUpload(queueItem)) {
            throw buildInvalidProviderResumeStateError(
                queueItem,
                queueItem.destinationUploadID || undefined,
                queueItem.destinationProviderUserID || undefined,
            );
        }

        const fileBuffer = shouldDownloadOriginalFileForDestination(queueItem)
            ? await downloadOriginalFile(queueItem)
            : undefined;
        if (await shouldSkipQueueWorkForDeletedUser(
            queueItem.userID,
            queueItem.destinationServiceName,
            queueItem.id,
            'before_activity_sync_destination_upload',
        )) {
            return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
            });
        }

        duringDestinationUpload = true;
        const uploadResult = await uploadToDestination(queueItem, fileBuffer);
        if (uploadResult.status === 'pending') {
            const pendingError = buildPendingDestinationUploadError(queueItem, uploadResult);
            if (isProviderOperationError(pendingError)) {
                throw pendingError;
            }
            let persisted: boolean;
            try {
                persisted = await persistDestinationUploadState(queueItem, uploadResult);
            } catch (persistenceError) {
                return moveUploadStatePersistenceFailureToDlq(
                    queueItem,
                    uploadResult,
                    persistenceError,
                    bulkWriter,
                    routeMeta,
                );
            }
            if (!persisted) {
                return QueueResult.Processed;
            }
            throw pendingError;
        }
        duringDestinationUpload = false;

        const hadPersistedDestinationUpload = hasPersistedDestinationUpload(queueItem);
        const destinationUploadID = uploadResult.uploadId
            || (hadPersistedDestinationUpload ? queueItem.destinationUploadID || undefined : undefined);
        const destinationProviderUserID = uploadResult.providerUserId
            || (hadPersistedDestinationUpload ? queueItem.destinationProviderUserID || undefined : undefined);
        const destinationWorkoutKey = uploadResult.workoutKey
            || (hadPersistedDestinationUpload ? queueItem.destinationWorkoutKey || undefined : undefined);

        if (queueItem.destinationServiceName === ServiceNames.SuuntoApp && (
            !destinationUploadID || !destinationProviderUserID
        )) {
            const invalidResumeStateError = buildInvalidProviderResumeStateError(
                queueItem,
                destinationUploadID,
                destinationProviderUserID,
            );
            logProviderFailureDecision(queueItem, invalidResumeStateError, 'dlq');
            await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
                ...routeMeta,
                error: toActivitySyncMetadataError(invalidResumeStateError),
            }));
            return moveToDeadLetterQueue(
                queueItem,
                invalidResumeStateError,
                bulkWriter,
                invalidResumeStateError.dlqContext,
            );
        }

        const shouldPersistDestinationUpload = !!destinationUploadID && (
            !hadPersistedDestinationUpload
            || queueItem.destinationUploadID !== destinationUploadID
            || (
                queueItem.destinationServiceName === ServiceNames.SuuntoApp
                && queueItem.destinationProviderUserID !== destinationProviderUserID
            )
        );
        if (shouldPersistDestinationUpload) {
            const acceptedUploadState = {
                ...uploadResult,
                uploadId: destinationUploadID,
                providerUserId: destinationProviderUserID,
            } satisfies UploadActivityFileResult;
            let persisted: boolean;
            try {
                persisted = await persistDestinationUploadState(queueItem, acceptedUploadState);
            } catch (persistenceError) {
                return moveUploadStatePersistenceFailureToDlq(
                    queueItem,
                    acceptedUploadState,
                    persistenceError,
                    bulkWriter,
                    routeMeta,
                );
            }
            if (!persisted) {
                return QueueResult.Processed;
            }
        }

        await setActivitySyncSuccessMetadata({
            ...routeMeta,
            destinationUploadID,
            workoutKey: destinationWorkoutKey,
            infoCode: uploadResult.code || undefined,
        });

        if (
            queueItem.destinationServiceName === ServiceNames.SuuntoApp
            && uploadResult.status === 'success'
            && destinationUploadID
            && queueItem.ref
        ) {
            await recordSuccessfulSuuntoActivityUploadForQueueItem(
                queueItem.userID,
                queueItem.ref,
                destinationUploadID,
            );
        }

        return updateToProcessed(queueItem, bulkWriter, {
            destinationUploadID: destinationUploadID || null,
            destinationProviderUserID: destinationProviderUserID || null,
            destinationWorkoutKey: destinationWorkoutKey || null,
            destinationInfoCode: uploadResult.code || null,
            destinationUploadContinuation: null,
            resultStatus: 'success',
            successProcessedAt: Date.now(),
        });
    } catch (error) {
        if (error instanceof SuuntoActivityUploadStatePersistenceSkippedError) {
            // The guarded persistence path already tombstoned and removed the
            // queue item when deletion started. No provider blob was sent.
            return QueueResult.Processed;
        }

        if (duringDestinationUpload && isProviderOperationError(error) && error.disposition === 'auth_required') {
            logProviderFailureDecision(queueItem, error, 'skip');
            await safelyWriteMetadata(() => setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_auth_failed',
                detail: error.message,
            }));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'destination_auth_failed',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        if (duringDestinationUpload && isProviderOperationError(error) && error.disposition === 'permission_required') {
            logProviderFailureDecision(queueItem, error, 'skip');
            await safelyWriteMetadata(() => setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_permission_required',
                detail: error.message,
            }));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'destination_permission_required',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        if (duringDestinationUpload && isSkippableAuthenticationError(error)) {
            const errorLike = asErrorLike(error);
            await safelyWriteMetadata(() => setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_auth_failed',
                detail: `${errorLike.message || 'Authentication failed.'}`,
            }));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'destination_auth_failed',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        if (duringDestinationUpload && isWahooWriteScopeError(error)) {
            const errorLike = asErrorLike(error);
            await safelyWriteMetadata(() => setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_write_scope_missing',
                detail: `${errorLike.message || 'Reconnect Wahoo and allow workout access.'}`,
            }));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'destination_write_scope_missing',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            });
        }

        if (isAccountDeletionSkipError(error)) {
            return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
            });
        }

        if (isTokenUseSkippedForPendingDisconnectError(error)) {
            return deferActivitySyncQueueItemForPendingDisconnect(
                queueItem,
                bulkWriter,
                routeMeta,
                queueItem.destinationServiceName,
            );
        }

        const normalizedError = toError(error);
        const metadataError = toActivitySyncMetadataError(normalizedError);

        if (duringDestinationUpload && isProviderOperationError(error) && error.disposition === 'retryable') {
            if (error.retryMode === 'resume') {
                const persistedResumeState = hasPersistedDestinationUpload(queueItem);
                const providerOperationId = error.providerOperationId
                    || (persistedResumeState ? queueItem.destinationUploadID || undefined : undefined);
                const providerUserId = error.providerUserId
                    || (persistedResumeState ? queueItem.destinationProviderUserID || undefined : undefined);
                if (!providerOperationId || (
                    queueItem.destinationServiceName === ServiceNames.SuuntoApp && !providerUserId
                )) {
                    const invalidResumeStateError = buildInvalidProviderResumeStateError(
                        queueItem,
                        providerOperationId,
                        providerUserId,
                    );
                    const invalidResumeMetadataError = toActivitySyncMetadataError(invalidResumeStateError);
                    logProviderFailureDecision(queueItem, invalidResumeStateError, 'dlq');
                    await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
                        ...routeMeta,
                        error: invalidResumeMetadataError,
                    }));
                    return moveToDeadLetterQueue(
                        queueItem,
                        invalidResumeStateError,
                        bulkWriter,
                        invalidResumeStateError.dlqContext,
                    );
                }
                const pendingUploadState = {
                    status: 'pending',
                    message: error.message,
                    uploadId: providerOperationId,
                    providerUserId,
                } satisfies UploadActivityFileResult;
                if (!hasMatchingPersistedDestinationUpload(queueItem, providerOperationId, providerUserId)) {
                    let persisted: boolean;
                    try {
                        persisted = await persistDestinationUploadState(queueItem, pendingUploadState);
                    } catch (persistenceError) {
                        return moveUploadStatePersistenceFailureToDlq(
                            queueItem,
                            pendingUploadState,
                            persistenceError,
                            bulkWriter,
                            routeMeta,
                        );
                    }
                    if (!persisted) {
                        return QueueResult.Processed;
                    }
                }
            } else if (error.retryMode === 'restart') {
                const cleared = await clearPendingDestinationUploadForRestart(queueItem);
                if (!cleared) {
                    return QueueResult.Processed;
                }
            }
            await safelyWriteMetadata(() => setActivitySyncRetryingMetadata({
                ...routeMeta,
                error: metadataError,
            }));
            const retryResult = await increaseRetryCountForQueueItem(
                queueItem,
                normalizedError,
                1,
                bulkWriter,
                error.dlqContext || 'DESTINATION_PROVIDER_RETRY_EXHAUSTED',
            );
            if (retryResult === QueueResult.MovedToDLQ) {
                await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
                    ...routeMeta,
                    error: metadataError,
                }));
                logProviderFailureDecision(queueItem, error, 'dlq');
            } else {
                logProviderFailureDecision(queueItem, error, 'retry');
            }
            return retryResult;
        }

        if (isTransientActivitySyncError(error) || (
            duringDestinationUpload && isLegacyRetryableSuuntoActivitySyncError(queueItem, error)
        )) {
            await safelyWriteMetadata(() => setActivitySyncRetryingMetadata({
                ...routeMeta,
                error: metadataError,
            }));
            return increaseRetryCountForQueueItem(queueItem, normalizedError, 1, bulkWriter);
        }

        if (duringDestinationUpload && isProviderOperationError(error)) {
            logProviderFailureDecision(queueItem, error, 'dlq');
        }

        await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
            ...routeMeta,
            error: metadataError,
        }));
        return moveToDeadLetterQueue(
            queueItem,
            normalizedError,
            bulkWriter,
            isProviderOperationError(error) && error.dlqContext
                ? error.dlqContext
                : getDeadLetterContext(normalizedError),
        );
    }
}
