import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { QueueResult, increaseRetryCountForQueueItem, moveToDeadLetterQueue, updateToProcessed } from '../queue-utils';
import { ACTIVITY_SYNC_ROUTES } from '../../../shared/activity-sync-routes';
import { isActivitySyncRouteEnabledForUser } from './settings';
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
import { hasProAccess } from '../utils';
import { getActivitySyncRouteAllowlistConfigError, isActivitySyncRouteUserAllowlisted } from './allowlist';

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
    statusCode?: unknown;
    message?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
    if (!error || typeof error !== 'object') {
        return {};
    }

    return error as ErrorLike;
}

function isTransientActivitySyncError(error: unknown): boolean {
    const errorLike = asErrorLike(error);
    const httpsCode = `${errorLike.code || ''}`.trim().toLowerCase();
    if (httpsCode === 'unavailable' || httpsCode === 'deadline-exceeded' || httpsCode === 'aborted') {
        return true;
    }

    const statusCode = Number(errorLike.statusCode);
    return statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504;
}

function isSkippableAuthenticationError(error: unknown): boolean {
    const errorLike = asErrorLike(error);
    const httpsCode = `${errorLike.code || ''}`.trim().toLowerCase();
    return httpsCode === 'unauthenticated' || httpsCode === 'permission-denied';
}

async function isDestinationConnected(userID: string, destinationServiceName: ServiceNames): Promise<boolean> {
    switch (destinationServiceName) {
        case ServiceNames.SuuntoApp: {
            const snapshot = await admin.firestore()
                .collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME)
                .doc(userID)
                .collection('tokens')
                .limit(1)
                .get();
            return snapshot.size > 0;
        }
        default:
            return false;
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
}

async function uploadToDestination(
    queueItem: ActivitySyncQueueItemInterface,
    fileBuffer: Buffer,
): Promise<UploadActivityFileResult> {
    switch (queueItem.destinationServiceName) {
        case ServiceNames.SuuntoApp:
            return uploadActivityFileToSuunto(queueItem.userID, fileBuffer);
        default:
            throw new Error(`Unsupported destination service ${queueItem.destinationServiceName}`);
    }
}

export async function processActivitySyncQueueItem(
    queueItem: ActivitySyncQueueItemInterface,
    bulkWriter?: admin.firestore.BulkWriter,
): Promise<QueueResult> {
    const route = ACTIVITY_SYNC_ROUTES[queueItem.routeId];
    const routeMeta = {
        routeId: queueItem.routeId,
        userID: queueItem.userID,
        eventID: queueItem.eventID,
        sourceServiceName: queueItem.sourceServiceName,
        destinationServiceName: queueItem.destinationServiceName,
        manual: queueItem.manual === true,
    };

    if (!route) {
        const error = new Error(`Unknown activity sync route ${queueItem.routeId}`);
        await setActivitySyncFailedMetadata({
            ...routeMeta,
            error: toActivitySyncMetadataError(error),
        });
        return moveToDeadLetterQueue(queueItem, error, bulkWriter, 'UNKNOWN_ACTIVITY_SYNC_ROUTE');
    }

    const allowlistConfigError = getActivitySyncRouteAllowlistConfigError(queueItem.routeId);
    if (allowlistConfigError) {
        await setActivitySyncSkippedMetadata({
            ...routeMeta,
            skippedReason: 'allowlist_misconfigured',
            detail: allowlistConfigError,
        });
        return updateToProcessed(queueItem, bulkWriter, { skippedReason: 'allowlist_misconfigured' });
    }

    if (!isActivitySyncRouteUserAllowlisted(queueItem.routeId, queueItem.userID)) {
        await setActivitySyncSkippedMetadata({
            ...routeMeta,
            skippedReason: 'user_not_allowlisted',
            detail: 'User is not allowlisted for this activity sync route.',
        });
        return updateToProcessed(queueItem, bulkWriter, { skippedReason: 'user_not_allowlisted' });
    }

    await setActivitySyncProcessingMetadata(routeMeta);

    if (!(await hasProAccess(queueItem.userID))) {
        await setActivitySyncSkippedMetadata({
            ...routeMeta,
            skippedReason: 'no_pro_access',
            detail: 'Activity sync is a Pro feature.',
        });
        return updateToProcessed(queueItem, bulkWriter, { skippedReason: 'no_pro_access' });
    }

    const enabled = await isActivitySyncRouteEnabledForUser(queueItem.userID, queueItem.routeId);
    if (!enabled) {
        await setActivitySyncSkippedMetadata({
            ...routeMeta,
            skippedReason: 'route_disabled',
            detail: 'Route is disabled in user settings.',
        });
        return updateToProcessed(queueItem, bulkWriter, { skippedReason: 'route_disabled' });
    }

    const destinationConnected = await isDestinationConnected(queueItem.userID, queueItem.destinationServiceName);
    if (!destinationConnected) {
        await setActivitySyncSkippedMetadata({
            ...routeMeta,
            skippedReason: 'destination_not_connected',
            detail: 'Destination account is not connected.',
        });
        return updateToProcessed(queueItem, bulkWriter, { skippedReason: 'destination_not_connected' });
    }

    const extension = toExtension(queueItem.originalFile?.path, queueItem.originalFile?.extension);
    if (!route.supportedFileExtensions.includes(extension)) {
        await setActivitySyncSkippedMetadata({
            ...routeMeta,
            skippedReason: 'unsupported_original_file',
            detail: `Unsupported original file extension: ${extension || 'unknown'}.`,
        });
        return updateToProcessed(queueItem, bulkWriter, { skippedReason: 'unsupported_original_file' });
    }

    try {
        const fileBuffer = await downloadOriginalFile(queueItem);
        const uploadResult = await uploadToDestination(queueItem, fileBuffer);

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
        });
    } catch (error) {
        if (isSkippableAuthenticationError(error)) {
            const errorLike = asErrorLike(error);
            await setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_auth_failed',
                detail: `${errorLike.message || 'Authentication failed.'}`,
            });
            return updateToProcessed(queueItem, bulkWriter, { skippedReason: 'destination_auth_failed' });
        }

        const metadataError = toActivitySyncMetadataError(error);
        if (isTransientActivitySyncError(error)) {
            await setActivitySyncRetryingMetadata({
                ...routeMeta,
                error: metadataError,
            });
            return increaseRetryCountForQueueItem(queueItem, toError(error), 1, bulkWriter);
        }

        await setActivitySyncFailedMetadata({
            ...routeMeta,
            error: metadataError,
        });
        return moveToDeadLetterQueue(queueItem, toError(error), bulkWriter, 'ACTIVITY_SYNC_PERMANENT_FAILURE');
    }
}
