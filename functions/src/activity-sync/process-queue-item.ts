import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
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
import { uploadActivityFileToSuunto } from '../suunto/activities';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { getWahooActivityUploadStatus, uploadActivityFileToWahoo } from '../wahoo/activities';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { config } from '../config';
import { hasProAccess } from '../utils';
import { getActivitySyncRouteAllowlistConfigError, isActivitySyncRouteUserAllowlisted } from './allowlist';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';
import {
    QueueItemUserGuardedUpdateResult,
    updateQueueItemIfUserActive,
} from '../queue/dispatch-marker';

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

function isDestinationFeatureEnabled(destinationServiceName: ServiceNames): boolean {
    return destinationServiceName !== ServiceNames.WahooAPI || config.wahooapi.enabled;
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
}

async function uploadToDestination(
    queueItem: ActivitySyncQueueItemInterface,
    fileBuffer: Buffer,
): Promise<UploadActivityFileResult> {
    switch (queueItem.destinationServiceName) {
        case ServiceNames.SuuntoApp:
            return uploadActivityFileToSuunto(queueItem.userID, fileBuffer);
        case ServiceNames.WahooAPI:
            if (queueItem.destinationUploadID) {
                return getWahooActivityUploadStatus(queueItem.userID, queueItem.destinationUploadID);
            }
            return uploadActivityFileToWahoo(queueItem.userID, fileBuffer, {
                filename: queueItem.originalFile.originalFilename || queueItem.originalFile.path.split('/').pop(),
            });
        default:
            throw new Error(`Unsupported destination service ${queueItem.destinationServiceName}`);
    }
}

async function persistWahooPendingUpload(
    queueItem: ActivitySyncQueueItemInterface,
    uploadResult: UploadActivityFileResult,
): Promise<boolean> {
    if (!queueItem.ref || !uploadResult.uploadId) {
        throw new Error('Wahoo pending upload is missing queue persistence data.');
    }
    const destinationUploadID = uploadResult.uploadId;
    const destinationWorkoutKey = uploadResult.workoutKey || queueItem.destinationWorkoutKey;
    const destinationInfoCode = uploadResult.code || queueItem.destinationInfoCode;
    const updateResult = await updateQueueItemIfUserActive({
        queueItemDocument: queueItem.ref,
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        phase: 'before_activity_sync_wahoo_pending_upload_persist',
        updateData: {
            destinationUploadID,
            destinationWorkoutKey: destinationWorkoutKey || null,
            destinationInfoCode: destinationInfoCode || null,
        },
        logPrefix: 'ActivitySync',
        actionDescription: 'Wahoo pending upload token persistence',
    });
    if (updateResult === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
        // The guarded update writes a cleanup tombstone and deletes the queue item.
        // A follow-up queue-state write would target a document that no longer exists.
        return false;
    }
    queueItem.destinationUploadID = destinationUploadID;
    queueItem.destinationWorkoutKey = destinationWorkoutKey;
    queueItem.destinationInfoCode = destinationInfoCode;
    return true;
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
    routeMeta: {
        routeId: ActivitySyncQueueItemInterface['routeId'];
        userID: string;
        eventID: string;
        sourceServiceName: ServiceNames;
        destinationServiceName: ServiceNames;
        manual: boolean;
    },
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
                resultStatus: 'skipped',
            });
        }

        if (!isDestinationFeatureEnabled(queueItem.destinationServiceName)) {
            await setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_unavailable',
                detail: 'The destination integration is not enabled.',
            });
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'destination_unavailable',
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

        const fileBuffer = await downloadOriginalFile(queueItem);
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
            const persisted = await persistWahooPendingUpload(queueItem, uploadResult);
            if (!persisted) {
                return QueueResult.Processed;
            }
            throw Object.assign(new Error('Wahoo is still processing the activity.'), {
                code: 'deadline-exceeded',
            });
        }
        duringDestinationUpload = false;

        await setActivitySyncSuccessMetadata({
            ...routeMeta,
            destinationUploadID: uploadResult.uploadId || undefined,
            workoutKey: uploadResult.workoutKey || undefined,
            infoCode: uploadResult.code || undefined,
        });

        return updateToProcessed(queueItem, bulkWriter, {
            destinationUploadID: uploadResult.uploadId || null,
            destinationWorkoutKey: uploadResult.workoutKey || null,
            destinationInfoCode: uploadResult.code || null,
            resultStatus: 'success',
            successProcessedAt: Date.now(),
        });
    } catch (error) {
        if (duringDestinationUpload && isSkippableAuthenticationError(error)) {
            const errorLike = asErrorLike(error);
            await safelyWriteMetadata(() => setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_auth_failed',
                detail: `${errorLike.message || 'Authentication failed.'}`,
            }));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'destination_auth_failed',
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

        if (isTransientActivitySyncError(error)) {
            await safelyWriteMetadata(() => setActivitySyncRetryingMetadata({
                ...routeMeta,
                error: metadataError,
            }));
            return increaseRetryCountForQueueItem(queueItem, normalizedError, 1, bulkWriter);
        }

        await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
            ...routeMeta,
            error: metadataError,
        }));
        return moveToDeadLetterQueue(queueItem, normalizedError, bulkWriter, getDeadLetterContext(normalizedError));
    }
}
