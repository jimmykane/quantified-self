import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    ActivitySyncQueueItemInterface,
    ActivitySyncUploadContinuation,
} from '../queue/queue-item.interface';
import {
    QueueResult,
    QUEUE_SKIPPED_REASONS,
    ProviderOperationStillInFlightError,
    PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
    deferQueueItemForPendingDisconnect,
    deferQueueItemForPendingDisconnectIfCurrentUserActive,
    increaseRetryCountIfCurrentUserActive,
    isProviderOperationInFlightLeaseActive,
    markQueueItemSkipped,
    moveToDeadLetterQueueIfCurrentUserActive,
    type QueueManualReconciliationState,
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
    SuuntoActivityUploadStatePersistenceError,
    SuuntoActivityUploadStatePersistenceSkippedError,
    uploadActivityFileToSuunto,
} from '../suunto/activities';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { getWahooActivityUploadStatus, uploadActivityFileToWahoo } from '../wahoo/activities';
import {
    getWahooWorkoutTypeById,
    resolveCanonicalActivityTypes,
    resolveWahooWorkoutType,
} from '../../../shared/wahoo-activity-types';
import { WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME } from '../wahoo/constants';
import { getCOROSActivityUploadStatus, uploadActivityFileToCOROS } from '../coros/activities';
import { getActiveCOROSTokenSnapshot } from '../coros/account';
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
    toProviderOperationLogDetails,
} from '../shared/provider-operation-error';
import { recordActivitySyncOutboundFingerprint } from './outbound-fingerprint';

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
    details?: unknown;
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
  8, // RESOURCE_EXHAUSTED
  10, // ABORTED
  14, // UNAVAILABLE
]);

const TRANSIENT_ACTIVITY_SYNC_STATUS_CODES = new Set([
    408,
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
            || error.name === 'COROSActivityUploadSkippedForDeletedUserError'
            || error.name === 'ActivitySyncOutboundFingerprintSkippedForDeletedUserError'
        );
}

function destinationRequiresProviderUserId(destinationServiceName: ServiceNames): boolean {
    return destinationServiceName === ServiceNames.SuuntoApp
        || destinationServiceName === ServiceNames.COROSAPI;
}

function destinationUploadStatePersistPhase(destinationServiceName: ServiceNames): string {
    switch (destinationServiceName) {
        case ServiceNames.WahooAPI:
            return 'before_activity_sync_wahoo_upload_state_persist';
        case ServiceNames.COROSAPI:
            return 'before_activity_sync_coros_upload_state_persist';
        default:
            return 'before_activity_sync_suunto_upload_state_persist';
    }
}

function getWahooProviderConfirmedRestartError(
    queueItem: ActivitySyncQueueItemInterface,
    error: unknown,
): ProviderOperationError | null {
    if (
        queueItem.destinationServiceName !== ServiceNames.WahooAPI
        || !queueItem.destinationUploadID
        || isProviderOperationError(error)
    ) {
        return null;
    }

    const details = asErrorLike(error).details;
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
        return null;
    }

    const retryMode = `${(details as { retryMode?: unknown }).retryMode || ''}`.trim();
    const providerOperation = `${(details as { providerOperation?: unknown }).providerOperation || ''}`.trim();
    if (retryMode !== 'restart' || providerOperation !== 'activity_upload_status') {
        return null;
    }

    return new ProviderOperationError({
        serviceName: ServiceNames.WahooAPI,
        operation: 'activity_upload_status',
        disposition: 'retryable',
        retryMode: 'restart',
        code: 'failed-precondition',
        message: toError(error).message,
        providerOperationId: queueItem.destinationUploadID,
        dlqContext: 'WAHOO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    });
}

function isTokenUseSkippedForPendingDisconnectError(error: unknown): boolean {
    return error instanceof Error && error.name === 'TokenUseSkippedForPendingDisconnectError';
}

function getAcceptedUploadIdFromPendingDisconnectError(error: unknown): string | null {
    if (!isTokenUseSkippedForPendingDisconnectError(error)) {
        return null;
    }
    const providerOperationId = `${(error as { providerOperationId?: unknown }).providerOperationId || ''}`.trim();
    return providerOperationId || null;
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
        case ServiceNames.COROSAPI: {
            const meta = await getServiceConnectionMeta(userID, destinationServiceName);
            if (isDisconnectPendingServiceConnection(meta)) {
                return 'disconnect_pending';
            }
            if (isServiceUnavailableForSyncConnection(meta)) {
                return 'not_connected';
            }
            try {
                await getActiveCOROSTokenSnapshot(userID);
                return 'connected';
            } catch (error) {
                if (isTokenUseSkippedForPendingDisconnectError(error)) {
                    return 'disconnect_pending';
                }
                const code = `${(error as { code?: unknown } | null)?.code || ''}`.replace(/^functions\//, '');
                if (code === 'unauthenticated' || code === 'failed-precondition') {
                    return 'not_connected';
                }
                throw error;
            }
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
    expectedWahooWorkoutTypeId?: number,
): Promise<UploadActivityFileResult> {
    switch (queueItem.destinationServiceName) {
        case ServiceNames.SuuntoApp:
            if (queueItem.destinationUploadID && queueItem.destinationProviderUserID) {
                const continuation = getSuuntoBlobContinuation(queueItem);
                if (continuation) {
                    return resumeSuuntoActivityBlobUpload(queueItem.userID, fileBuffer || (() => downloadOriginalFile(queueItem)), {
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
                return getWahooActivityUploadStatus(
                    queueItem.userID,
                    queueItem.destinationUploadID,
                    expectedWahooWorkoutTypeId,
                );
            }
            if (!fileBuffer) {
                throw new Error('Wahoo activity upload is missing its source file.');
            }
            return uploadActivityFileToWahoo(queueItem.userID, fileBuffer, {
                filename: queueItem.originalFile.originalFilename || queueItem.originalFile.path.split('/').pop(),
                expectedWorkoutTypeId: expectedWahooWorkoutTypeId,
            });
        case ServiceNames.COROSAPI:
            if (queueItem.destinationUploadID && queueItem.destinationProviderUserID) {
                return getCOROSActivityUploadStatus(
                    queueItem.userID,
                    queueItem.destinationUploadID,
                    queueItem.destinationProviderUserID,
                    { queueItemRef: queueItem.ref },
                );
            }
            if (!fileBuffer) {
                throw new Error('COROS activity upload is missing its source file.');
            }
            return uploadActivityFileToCOROS(queueItem.userID, fileBuffer);
        default:
            throw new Error(`Unsupported destination service ${queueItem.destinationServiceName}`);
    }
}

interface ExpectedWahooWorkoutTypeResolution {
    workoutTypeId?: number;
    persistedWorkoutTypeId?: number | null;
}

async function ensureExpectedWahooWorkoutTypeBeforeProviderUpload(
    queueItem: ActivitySyncQueueItemInterface,
): Promise<ExpectedWahooWorkoutTypeResolution> {
    if (queueItem.destinationServiceName !== ServiceNames.WahooAPI) {
        return {};
    }
    if (queueItem.destinationExpectedWorkoutTypeID !== undefined) {
        if (queueItem.destinationExpectedWorkoutTypeID === null) {
            return { persistedWorkoutTypeId: null };
        }
        const workoutType = getWahooWorkoutTypeById(queueItem.destinationExpectedWorkoutTypeID);
        if (!workoutType) {
            throw new ProviderOperationError({
                serviceName: ServiceNames.WahooAPI,
                operation: 'activity_upload_init',
                disposition: 'permanent',
                retryMode: 'none',
                code: 'failed-precondition',
                message: 'Activity sync contains an invalid persisted Wahoo workout type.',
                dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_INVALID_TYPE',
            });
        }
        return {
            workoutTypeId: workoutType.id,
            persistedWorkoutTypeId: workoutType.id,
        };
    }

    const eventSnapshot = await admin.firestore()
        .collection('users')
        .doc(queueItem.userID)
        .collection('events')
        .doc(queueItem.eventID)
        .get();
    const rawActivityTypes = eventSnapshot.data()?.stats?.['Activity Types'];
    const canonicalActivityTypes = resolveCanonicalActivityTypes(rawActivityTypes);
    const expectedWorkoutType = resolveWahooWorkoutType(canonicalActivityTypes);
    if (!expectedWorkoutType) {
        logger.info('[ActivitySync] Keeping Wahoo inferred workout type because the QS event type is unmapped.', {
            queueItemId: queueItem.id,
            userID: queueItem.userID,
            eventID: queueItem.eventID,
            canonicalActivityTypes,
        });
    }
    const destinationExpectedWorkoutTypeID = expectedWorkoutType?.id ?? null;
    return {
        workoutTypeId: expectedWorkoutType?.id,
        persistedWorkoutTypeId: destinationExpectedWorkoutTypeID,
    };
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
    return !hasPersistedDestinationUpload(queueItem) || !queueItem.outboundFingerprintID;
}

function hasPersistedDestinationUpload(queueItem: ActivitySyncQueueItemInterface): boolean {
    if (destinationRequiresProviderUserId(queueItem.destinationServiceName)) {
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
            !destinationRequiresProviderUserId(queueItem.destinationServiceName)
            || queueItem.destinationProviderUserID === providerUserId
        );
}

function hasIncompleteDestinationUpload(queueItem: ActivitySyncQueueItemInterface): boolean {
    return destinationRequiresProviderUserId(queueItem.destinationServiceName)
        && !!queueItem.destinationUploadID !== !!queueItem.destinationProviderUserID;
}

function hasUnresolvedDestinationProviderOperation(queueItem: ActivitySyncQueueItemInterface): boolean {
    return queueItem.dispatchedToCloudTask === PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER
        && !hasPersistedDestinationUpload(queueItem);
}

function isSameActivitySyncQueueItem(
    currentQueueItem: Record<string, unknown>,
    queueItem: ActivitySyncQueueItemInterface,
): boolean {
    return currentQueueItem.dateCreated === queueItem.dateCreated
        && currentQueueItem.userID === queueItem.userID
        && currentQueueItem.eventID === queueItem.eventID
        && currentQueueItem.routeId === queueItem.routeId
        && currentQueueItem.sourceServiceName === queueItem.sourceServiceName
        && currentQueueItem.destinationServiceName === queueItem.destinationServiceName;
}

function areEquivalentOptionalStrings(left: unknown, right: unknown): boolean {
    return `${left || ''}` === `${right || ''}`;
}

function areEquivalentOptionalNumbers(left: unknown, right: unknown): boolean {
    return Number(left || 0) === Number(right || 0);
}

function isSameUploadContinuation(
    current: unknown,
    expected: ActivitySyncUploadContinuation | null | undefined,
): boolean {
    if (!expected) {
        return current === null || current === undefined;
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return false;
    }

    const currentContinuation = current as Partial<ActivitySyncUploadContinuation>;
    if (
        currentContinuation.type !== expected.type
        || currentContinuation.uploadUrl !== expected.uploadUrl
    ) {
        return false;
    }

    const currentHeaders = currentContinuation.uploadHeaders;
    if (!currentHeaders || typeof currentHeaders !== 'object' || Array.isArray(currentHeaders)) {
        return false;
    }
    const expectedHeaderEntries = Object.entries(expected.uploadHeaders);
    return Object.keys(currentHeaders).length === expectedHeaderEntries.length
        && expectedHeaderEntries.every(([key, value]) => currentHeaders[key] === value);
}

function isSameActivitySyncProviderState(
    currentQueueItem: Record<string, unknown>,
    expectedQueueItem: ActivitySyncQueueItemInterface,
): boolean {
    return currentQueueItem.processed !== true
        && currentQueueItem.dispatchedToCloudTask === expectedQueueItem.dispatchedToCloudTask
        && areEquivalentOptionalNumbers(
            currentQueueItem.providerOperationStartedAt,
            expectedQueueItem.providerOperationStartedAt,
        )
        && areEquivalentOptionalStrings(currentQueueItem.destinationUploadID, expectedQueueItem.destinationUploadID)
        && areEquivalentOptionalStrings(currentQueueItem.destinationProviderUserID, expectedQueueItem.destinationProviderUserID)
        && areEquivalentOptionalStrings(currentQueueItem.destinationWorkoutKey, expectedQueueItem.destinationWorkoutKey)
        && areEquivalentOptionalStrings(currentQueueItem.destinationInfoCode, expectedQueueItem.destinationInfoCode)
        && currentQueueItem.destinationExpectedWorkoutTypeID === expectedQueueItem.destinationExpectedWorkoutTypeID
        && areEquivalentOptionalStrings(currentQueueItem.outboundFingerprintID, expectedQueueItem.outboundFingerprintID)
        && isSameUploadContinuation(
            currentQueueItem.destinationUploadContinuation,
            expectedQueueItem.destinationUploadContinuation,
        )
        && isSameActivitySyncQueueItem(currentQueueItem, expectedQueueItem);
}

async function ensureOutboundFingerprintBeforeProviderUpload(
    queueItem: ActivitySyncQueueItemInterface,
    fileBuffer: Buffer | undefined,
): Promise<boolean> {
    if (queueItem.outboundFingerprintID) {
        return true;
    }
    if (!fileBuffer) {
        throw new Error('Activity sync outbound fingerprint is missing its source file.');
    }
    if (!queueItem.ref) {
        throw new Error('Activity sync outbound fingerprint cannot be persisted without a queue document reference.');
    }

    const fingerprints = await recordActivitySyncOutboundFingerprint({
        userID: queueItem.userID,
        destinationServiceName: queueItem.destinationServiceName,
        fileBuffer,
    });
    const expectedQueueItem = { ...queueItem };
    const updateResult = await updateQueueItemIfUserActive({
        queueItemDocument: queueItem.ref,
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        phase: 'before_activity_sync_outbound_fingerprint_marker',
        updateData: {
            outboundFingerprintID: fingerprints.exactFingerprintId,
        },
        logPrefix: 'ActivitySync',
        actionDescription: 'outbound provider-echo fingerprint marker',
        isCurrent: currentQueueItem => isSameActivitySyncProviderState(currentQueueItem, expectedQueueItem),
    });
    if (updateResult !== QueueItemUserGuardedUpdateResult.Updated) {
        return false;
    }
    queueItem.outboundFingerprintID = fingerprints.exactFingerprintId;
    return true;
}

const ACTIVITY_SYNC_MANUAL_RECONCILIATION_CONTEXTS = new Set([
    'DESTINATION_PROVIDER_INVALID_RESUME_STATE',
    'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
    'DESTINATION_PROVIDER_RESUME_STATE_PERSIST_FAILED',
    'SUUNTO_ACTIVITY_UPLOAD_CONTINUATION_REJECTED',
    'SUUNTO_ACTIVITY_UPLOAD_INVALID_CONTINUATION',
    'SUUNTO_ACTIVITY_UPLOAD_INVALID_RESPONSE',
    'WAHOO_ACTIVITY_UPLOAD_AMBIGUOUS',
    'WAHOO_ACTIVITY_UPLOAD_INVALID_RESPONSE',
]);

function getActivitySyncManualReconciliationState(
    queueItem: ActivitySyncQueueItemInterface,
    context?: string,
): QueueManualReconciliationState | undefined {
    if (
        !queueItem.destinationUploadID
        && !ACTIVITY_SYNC_MANUAL_RECONCILIATION_CONTEXTS.has(`${context || ''}`)
    ) {
        return undefined;
    }

    return {
        additionalData: {
            ...(queueItem.destinationUploadID
                ? { destinationUploadID: queueItem.destinationUploadID }
                : {}),
            ...(queueItem.destinationProviderUserID
                ? { destinationProviderUserID: queueItem.destinationProviderUserID }
                : {}),
            ...(queueItem.destinationWorkoutKey
                ? { destinationWorkoutKey: queueItem.destinationWorkoutKey }
                : {}),
            ...(queueItem.destinationInfoCode
                ? { destinationInfoCode: queueItem.destinationInfoCode }
                : {}),
            destinationUploadContinuation: null,
        },
    };
}

async function moveAcceptedDestinationUploadConnectionFailureToDlq(
    queueItem: ActivitySyncQueueItemInterface,
    error: Error,
    bulkWriter: admin.firestore.BulkWriter | undefined,
    routeMeta: ActivitySyncRouteMeta,
    fallbackContext: string,
): Promise<QueueResult.MovedToDLQ | QueueResult.Processed | QueueResult.Failed | null> {
    const providerError = isProviderOperationError(error) ? error : null;
    const destinationUploadID = queueItem.destinationUploadID
        || providerError?.providerOperationId
        || null;
    if (!destinationUploadID) {
        return null;
    }

    const acceptedQueueItem: ActivitySyncQueueItemInterface = {
        ...queueItem,
        destinationUploadID,
        destinationProviderUserID: queueItem.destinationProviderUserID
            || providerError?.providerUserId
            || null,
    };
    if (providerError) {
        logProviderFailureDecision(queueItem, providerError, 'dlq');
    }
    await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
        ...routeMeta,
        error: toActivitySyncMetadataError(error),
    }));
    return moveActivitySyncQueueItemToDlqIfCurrent(
        acceptedQueueItem,
        error,
        bulkWriter,
        providerError?.dlqContext || fallbackContext,
        queueItem,
    );
}

function moveActivitySyncQueueItemToDlqIfCurrent(
    failedQueueItem: ActivitySyncQueueItemInterface,
    error: Error,
    bulkWriter: admin.firestore.BulkWriter | undefined,
    context: string | undefined,
    expectedQueueItem: ActivitySyncQueueItemInterface = failedQueueItem,
): Promise<QueueResult.MovedToDLQ | QueueResult.Processed | QueueResult.Failed> {
    return moveToDeadLetterQueueIfCurrentUserActive({
        queueItem: failedQueueItem,
        error,
        context,
        bulkWriter,
        userID: expectedQueueItem.userID,
        phase: 'activity_sync_dlq_transition',
        logPrefix: 'ActivitySync',
        isCurrent: currentQueueItem => isSameActivitySyncProviderState(currentQueueItem, expectedQueueItem),
        manualReconciliation: getActivitySyncManualReconciliationState(failedQueueItem, context),
    });
}

function increaseActivitySyncRetryCountIfCurrent(
    queueItem: ActivitySyncQueueItemInterface,
    error: Error,
    bulkWriter: admin.firestore.BulkWriter | undefined,
    maxRetryDlqContext?: string,
): Promise<QueueResult.MovedToDLQ | QueueResult.RetryIncremented | QueueResult.Processed | QueueResult.Failed> {
    return increaseRetryCountIfCurrentUserActive({
        queueItem,
        error,
        incrementBy: 1,
        maxRetryDlqContext,
        bulkWriter,
        userID: queueItem.userID,
        phase: 'activity_sync_retry_transition',
        logPrefix: 'ActivitySync',
        isCurrent: currentQueueItem => isSameActivitySyncProviderState(currentQueueItem, queueItem),
        manualReconciliation: getActivitySyncManualReconciliationState(queueItem, maxRetryDlqContext),
    });
}

function buildUnresolvedDestinationProviderOperationError(
    queueItem: ActivitySyncQueueItemInterface,
): ProviderOperationError {
    return new ProviderOperationError({
        serviceName: queueItem.destinationServiceName,
        operation: 'activity_upload_init',
        disposition: 'permanent',
        retryMode: 'none',
        code: 'failed-precondition',
        message: `${queueItem.destinationServiceName} upload may already have started, but its provider state was not saved. Reconcile it manually before retrying.`,
        dlqContext: 'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
    });
}

async function markDestinationProviderOperationInFlight(
    queueItem: ActivitySyncQueueItemInterface,
    expectedWahooWorkoutType: ExpectedWahooWorkoutTypeResolution,
): Promise<boolean> {
    if (!queueItem.ref) {
        throw new Error('Destination provider operation cannot start without a queue document reference.');
    }
    const expectedQueueItem = { ...queueItem };
    const providerOperationStartedAt = Date.now();
    const updateResult = await updateQueueItemIfUserActive({
        queueItemDocument: queueItem.ref,
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        phase: 'before_activity_sync_destination_provider_operation',
        updateData: {
            dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
            providerOperationStartedAt,
            ...(expectedWahooWorkoutType.persistedWorkoutTypeId !== undefined
                ? { destinationExpectedWorkoutTypeID: expectedWahooWorkoutType.persistedWorkoutTypeId }
                : {}),
        },
        logPrefix: 'ActivitySync',
        actionDescription: 'destination provider in-flight marker',
        isCurrent: currentQueueItem => isSameActivitySyncProviderState(currentQueueItem, expectedQueueItem),
    });
    if (updateResult !== QueueItemUserGuardedUpdateResult.Updated) {
        return false;
    }
    queueItem.dispatchedToCloudTask = PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER;
    queueItem.providerOperationStartedAt = providerOperationStartedAt;
    if (expectedWahooWorkoutType.persistedWorkoutTypeId !== undefined) {
        queueItem.destinationExpectedWorkoutTypeID = expectedWahooWorkoutType.persistedWorkoutTypeId;
    }
    return true;
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
    if (destinationRequiresProviderUserId(queueItem.destinationServiceName) && !destinationProviderUserID) {
        throw new Error(`${queueItem.destinationServiceName} upload is missing its provider user identity.`);
    }
    const destinationWorkoutKey = uploadResult.workoutKey || queueItem.destinationWorkoutKey;
    const destinationInfoCode = uploadResult.code || queueItem.destinationInfoCode;
    const expectedQueueItem = { ...queueItem };
    const destinationUploadContinuation = queueItem.destinationServiceName === ServiceNames.SuuntoApp
        ? uploadResult.blobContinuation
            ? {
                type: 'suunto_blob_put_v1' as const,
                uploadUrl: uploadResult.blobContinuation.uploadUrl,
                uploadHeaders: uploadResult.blobContinuation.uploadHeaders,
            }
            : queueItem.destinationUploadContinuation || null
        : null;
    const updateResult = await updateQueueItemIfUserActive({
        queueItemDocument: queueItem.ref,
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        phase: destinationUploadStatePersistPhase(queueItem.destinationServiceName),
        updateData: {
            destinationUploadID,
            destinationProviderUserID: destinationProviderUserID || null,
            destinationWorkoutKey: destinationWorkoutKey || null,
            destinationInfoCode: destinationInfoCode || null,
            destinationUploadContinuation,
            dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
        },
        logPrefix: 'ActivitySync',
        actionDescription: `${queueItem.destinationServiceName} upload state persistence`,
        isCurrent: currentQueueItem => isSameActivitySyncProviderState(currentQueueItem, expectedQueueItem),
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
    queueItem.dispatchedToCloudTask = PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER;
    return true;
}

async function finalizeActivitySyncQueueItemIfCurrent(
    queueItem: ActivitySyncQueueItemInterface,
    additionalData: Record<string, unknown>,
    phase = 'before_activity_sync_success_finalize',
    actionDescription = 'successful activity sync finalization',
): Promise<QueueResult.Processed | QueueResult.Failed> {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }

    const expectedDispatchMarker = queueItem.dispatchedToCloudTask;
    const expectedUploadID = queueItem.destinationUploadID;
    const expectedProviderUserID = queueItem.destinationProviderUserID;
    const expectedWorkoutKey = queueItem.destinationWorkoutKey;
    const expectedInfoCode = queueItem.destinationInfoCode;
    const expectedContinuation = queueItem.destinationUploadContinuation;
    const expectedProviderOperationStartedAt = queueItem.providerOperationStartedAt;
    try {
        const updateResult = await updateQueueItemIfUserActive({
            queueItemDocument: queueItem.ref,
            queueItemId: queueItem.id,
            userID: queueItem.userID,
            phase,
            updateData: {
                processed: true,
                processedAt: Date.now(),
                ...additionalData,
            },
            logPrefix: 'ActivitySync',
            actionDescription,
            isCurrent: currentQueueItem => currentQueueItem.processed !== true
                && currentQueueItem.dispatchedToCloudTask === expectedDispatchMarker
                && areEquivalentOptionalNumbers(
                    currentQueueItem.providerOperationStartedAt,
                    expectedProviderOperationStartedAt,
                )
                && areEquivalentOptionalStrings(currentQueueItem.destinationUploadID, expectedUploadID)
                && areEquivalentOptionalStrings(currentQueueItem.destinationProviderUserID, expectedProviderUserID)
                && areEquivalentOptionalStrings(currentQueueItem.destinationWorkoutKey, expectedWorkoutKey)
                && areEquivalentOptionalStrings(currentQueueItem.destinationInfoCode, expectedInfoCode)
                && isSameUploadContinuation(currentQueueItem.destinationUploadContinuation, expectedContinuation)
                && isSameActivitySyncQueueItem(currentQueueItem, queueItem),
        });
        if (updateResult === QueueItemUserGuardedUpdateResult.NotCurrent) {
            logger.info(`[ActivitySync] Queue item ${queueItem.id} was already advanced or replaced; skipping stale ${actionDescription}.`);
        }
        return QueueResult.Processed;
    } catch (error) {
        logger.error(`[ActivitySync] Could not complete ${actionDescription} for queue item ${queueItem.id}.`, error);
        return QueueResult.Failed;
    }
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

    const expectedDispatchMarker = queueItem.dispatchedToCloudTask;
    const expectedUploadID = queueItem.destinationUploadID;
    const expectedProviderUserID = queueItem.destinationProviderUserID;
    const expectedWorkoutKey = queueItem.destinationWorkoutKey;
    const expectedInfoCode = queueItem.destinationInfoCode;
    const expectedContinuation = queueItem.destinationUploadContinuation;
    const expectedProviderOperationStartedAt = queueItem.providerOperationStartedAt;

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
            dispatchedToCloudTask: null,
            providerOperationStartedAt: null,
        },
        logPrefix: 'ActivitySync',
        actionDescription: 'pending destination upload restart',
        isCurrent: currentQueueItem => currentQueueItem.processed !== true
            && currentQueueItem.dispatchedToCloudTask === expectedDispatchMarker
            && areEquivalentOptionalNumbers(
                currentQueueItem.providerOperationStartedAt,
                expectedProviderOperationStartedAt,
            )
            && areEquivalentOptionalStrings(currentQueueItem.destinationUploadID, expectedUploadID)
            && areEquivalentOptionalStrings(currentQueueItem.destinationProviderUserID, expectedProviderUserID)
            && areEquivalentOptionalStrings(currentQueueItem.destinationWorkoutKey, expectedWorkoutKey)
            && areEquivalentOptionalStrings(currentQueueItem.destinationInfoCode, expectedInfoCode)
            && isSameUploadContinuation(currentQueueItem.destinationUploadContinuation, expectedContinuation)
            && isSameActivitySyncQueueItem(currentQueueItem, queueItem),
    });
    if (updateResult !== QueueItemUserGuardedUpdateResult.Updated) {
        return false;
    }

    queueItem.destinationUploadID = null;
    queueItem.destinationProviderUserID = null;
    queueItem.destinationWorkoutKey = undefined;
    queueItem.destinationInfoCode = undefined;
    queueItem.destinationUploadContinuation = null;
    queueItem.dispatchedToCloudTask = null;
    queueItem.providerOperationStartedAt = null;
    return true;
}

function buildPendingDestinationUploadError(
    queueItem: ActivitySyncQueueItemInterface,
    uploadResult: UploadActivityFileResult,
): Error {
    if (destinationRequiresProviderUserId(queueItem.destinationServiceName)) {
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
            serviceName: queueItem.destinationServiceName,
            operation: 'activity_upload_status',
            disposition: 'retryable',
            retryMode: 'resume',
            code: 'deadline-exceeded',
            message: uploadResult.message || `${queueItem.destinationServiceName} is still processing the activity.`,
            providerUserId,
            providerOperationId,
            dlqContext: queueItem.destinationServiceName === ServiceNames.SuuntoApp
                ? 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED'
                : 'COROS_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
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
): Promise<QueueResult.Processed | QueueResult.MovedToDLQ | QueueResult.Skipped | QueueResult.Failed> {
    const destinationUploadID = uploadResult.uploadId || queueItem.destinationUploadID || undefined;
    const destinationProviderUserID = uploadResult.providerUserId || queueItem.destinationProviderUserID || undefined;
    const expectedProviderOperationStartedAt = queueItem.providerOperationStartedAt;
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
    const dlqResult = await moveActivitySyncQueueItemToDlqIfCurrent(
        failedQueueItem,
        stateError,
        bulkWriter,
        stateError.dlqContext,
        queueItem,
    );
    if (dlqResult === QueueResult.Failed && destinationUploadID && queueItem.ref) {
        try {
            const terminalResult = await updateQueueItemIfUserActive({
                queueItemDocument: queueItem.ref,
                queueItemId: queueItem.id,
                userID: queueItem.userID,
                phase: 'before_activity_sync_manual_reconciliation_persist',
                updateData: {
                    processed: true,
                    processedAt: Date.now(),
                    resultStatus: 'manual_reconciliation_required',
                    manualReconciliationRequiredAt: Date.now(),
                    manualReconciliationContext: stateError.dlqContext,
                    expireAt: FieldValue.delete(),
                    destinationUploadID,
                    destinationProviderUserID: destinationProviderUserID || null,
                    destinationWorkoutKey: uploadResult.workoutKey || queueItem.destinationWorkoutKey || null,
                    destinationInfoCode: uploadResult.code || queueItem.destinationInfoCode || null,
                    destinationUploadContinuation: null,
                },
                logPrefix: 'ActivitySync',
                actionDescription: 'accepted upload manual-reconciliation marker',
                isCurrent: currentQueueItem => currentQueueItem.processed !== true
                    && currentQueueItem.dispatchedToCloudTask === PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER
                    && areEquivalentOptionalNumbers(
                        currentQueueItem.providerOperationStartedAt,
                        expectedProviderOperationStartedAt,
                    )
                    && isSameActivitySyncQueueItem(currentQueueItem, queueItem),
            });
            if (terminalResult === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
                return QueueResult.Processed;
            }
            if (terminalResult === QueueItemUserGuardedUpdateResult.Updated) {
                logger.error('[ActivitySync] Persisted a terminal manual-reconciliation marker after resume-state and DLQ persistence failed.', {
                    queueItemId: queueItem.id,
                    userID: queueItem.userID,
                    destinationServiceName: queueItem.destinationServiceName,
                    dlqContext: stateError.dlqContext,
                });
                return QueueResult.Skipped;
            }
        } catch (terminalPersistenceError) {
            logger.error('[ActivitySync] Could not persist a terminal marker for accepted provider work; failing the task so the durable provider claim can be reconciled without replaying the upload.', {
                queueItemId: queueItem.id,
                userID: queueItem.userID,
                destinationServiceName: queueItem.destinationServiceName,
                error: toError(terminalPersistenceError).message,
                dlqContext: stateError.dlqContext,
            });
        }
    }
    if (dlqResult === QueueResult.Failed) {
        logger.error('[ActivitySync] Accepted provider work has no durable reconciliation record; leaving the provider claim in place and retrying until it can be moved to DLQ safely.', {
            queueItemId: queueItem.id,
            userID: queueItem.userID,
            destinationServiceName: queueItem.destinationServiceName,
            providerOperationId: destinationUploadID || null,
            dlqContext: stateError.dlqContext,
        });
        return QueueResult.Failed;
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
        ...toProviderOperationLogDetails(error),
        retryCount: queueItem.retryCount || 0,
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
    requireCurrentProviderState = false,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
    const error = new Error(`${serviceName} disconnect is pending.`);
    await safelyWriteMetadata(() => setActivitySyncRetryingMetadata({
        ...routeMeta,
        error: toActivitySyncMetadataError(error),
    }));
    const additionalData = { deferredServiceName: `${serviceName}` };
    if (!requireCurrentProviderState) {
        return deferQueueItemForPendingDisconnect(queueItem, bulkWriter, additionalData);
    }
    return deferQueueItemForPendingDisconnectIfCurrentUserActive({
        queueItem,
        additionalData,
        bulkWriter,
        userID: queueItem.userID,
        phase: 'activity_sync_pending_disconnect_transition',
        logPrefix: 'ActivitySync',
        isCurrent: currentQueueItem => isSameActivitySyncProviderState(currentQueueItem, queueItem),
    });
}

function markActivitySyncQueueItemSkippedForDeletedUser(
    queueItem: ActivitySyncQueueItemInterface,
    bulkWriter?: admin.firestore.BulkWriter,
): Promise<QueueResult.Processed | QueueResult.Failed> {
    return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
        skippedContext: 'USER_DELETION_GUARD',
        destinationUploadContinuation: null,
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
            return markActivitySyncQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
        }

        if (hasUnresolvedDestinationProviderOperation(queueItem)) {
            if (isProviderOperationInFlightLeaseActive(queueItem)) {
                throw new ProviderOperationStillInFlightError(
                    queueItem.id,
                    Number(queueItem.providerOperationStartedAt),
                );
            }
            const unresolvedOperationError = buildUnresolvedDestinationProviderOperationError(queueItem);
            logProviderFailureDecision(queueItem, unresolvedOperationError, 'dlq');
            await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
                ...routeMeta,
                error: toActivitySyncMetadataError(unresolvedOperationError),
            }));
            return moveActivitySyncQueueItemToDlqIfCurrent(
                queueItem,
                unresolvedOperationError,
                bulkWriter,
                unresolvedOperationError.dlqContext,
            );
        }
        if (hasPersistedDestinationUpload(queueItem) && isProviderOperationInFlightLeaseActive(queueItem)) {
            throw new ProviderOperationStillInFlightError(
                queueItem.id,
                Number(queueItem.providerOperationStartedAt),
            );
        }
        // A provider upload ID is an accepted external side effect. Its status
        // must be resolved before ordinary sync eligibility can skip the item,
        // otherwise the provider may finish while QS records a false skip.
        const shouldResumePersistedDestinationUpload = hasPersistedDestinationUpload(queueItem);

        const route = ACTIVITY_SYNC_ROUTES[queueItem.routeId];
        if (!route) {
            const error = new Error(`Unknown activity sync route ${queueItem.routeId}`) as Error & { dlqContext?: string };
            error.dlqContext = 'UNKNOWN_ACTIVITY_SYNC_ROUTE';
            throw error;
        }

        if (!shouldResumePersistedDestinationUpload) {
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
        }

        await setActivitySyncProcessingMetadata(routeMeta);

        if (!shouldResumePersistedDestinationUpload && !(await hasProAccess(queueItem.userID))) {
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

        if (!shouldResumePersistedDestinationUpload) {
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
        }

        if (await shouldSkipQueueWorkForDeletedUser(
            queueItem.userID,
            queueItem.destinationServiceName,
            queueItem.id,
            'before_activity_sync_upload',
        )) {
            return markActivitySyncQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
        }

        if (hasIncompleteDestinationUpload(queueItem)) {
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
            return markActivitySyncQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
        }

        if (!(await ensureOutboundFingerprintBeforeProviderUpload(queueItem, fileBuffer))) {
            return QueueResult.Processed;
        }

        const expectedWahooWorkoutType = await ensureExpectedWahooWorkoutTypeBeforeProviderUpload(queueItem);

        const operationMarked = await markDestinationProviderOperationInFlight(
            queueItem,
            expectedWahooWorkoutType,
        );
        if (!operationMarked) {
            return QueueResult.Processed;
        }

        duringDestinationUpload = true;
        const uploadResult = await uploadToDestination(
            queueItem,
            fileBuffer,
            expectedWahooWorkoutType.workoutTypeId,
        );
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
        const providerConfirmedDuplicateWithoutResumeID = !destinationUploadID
            && (uploadResult.status === 'duplicate' || uploadResult.code === 'ALREADY_EXISTS');

        if (destinationRequiresProviderUserId(queueItem.destinationServiceName) && (
            (!destinationUploadID && !providerConfirmedDuplicateWithoutResumeID)
            || !destinationProviderUserID
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
            return moveActivitySyncQueueItemToDlqIfCurrent(
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
                destinationRequiresProviderUserId(queueItem.destinationServiceName)
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

        try {
            await setActivitySyncSuccessMetadata({
                ...routeMeta,
                destinationUploadID,
                workoutKey: destinationWorkoutKey,
                infoCode: uploadResult.code || undefined,
            });
        } catch (metadataError) {
            if (!providerConfirmedDuplicateWithoutResumeID) {
                throw metadataError;
            }

            // Some Wahoo duplicate responses contain no upload token. Retrying
            // the queue item after this local write failure would repeat the
            // provider POST, so the queue result remains the durable outcome.
            logger.error('[ActivitySync] Could not persist success metadata for an identifier-less provider-confirmed duplicate; completing without replaying the provider request.', {
                queueItemId: queueItem.id,
                userID: queueItem.userID,
                destinationServiceName: queueItem.destinationServiceName,
                error: toError(metadataError).message,
            });
        }

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

        return finalizeActivitySyncQueueItemIfCurrent(queueItem, {
            destinationUploadID: destinationUploadID || null,
            destinationProviderUserID: destinationProviderUserID || null,
            destinationWorkoutKey: destinationWorkoutKey || null,
            destinationInfoCode: uploadResult.code || null,
            destinationUploadContinuation: null,
            resultStatus: 'success',
            successProcessedAt: Date.now(),
        });
    } catch (error) {
        if (error instanceof ProviderOperationStillInFlightError) {
            logger.warn('[ActivitySync] Provider operation claim is still active; retrying without changing queue state.', {
                queueItemId: queueItem.id,
                userID: queueItem.userID,
                providerOperationStartedAt: error.providerOperationStartedAt,
            });
            throw error;
        }

        if (error instanceof SuuntoActivityUploadStatePersistenceSkippedError) {
            // The guarded persistence path already tombstoned and removed the
            // queue item when deletion started. No provider blob was sent.
            return QueueResult.Processed;
        }

        if (error instanceof SuuntoActivityUploadStatePersistenceError) {
            return moveUploadStatePersistenceFailureToDlq(
                queueItem,
                {
                    status: 'pending',
                    message: error.message,
                    uploadId: error.uploadId,
                    providerUserId: error.providerUserId,
                },
                error.originalError,
                bulkWriter,
                routeMeta,
            );
        }

        if (
            duringDestinationUpload
            && queueItem.destinationServiceName === ServiceNames.WahooAPI
            && isProviderOperationError(error)
            && error.serviceName === ServiceNames.WahooAPI
            && error.providerOperationId
            && !hasMatchingPersistedDestinationUpload(
                queueItem,
                error.providerOperationId,
                error.providerUserId,
            )
        ) {
            const acceptedUploadState = {
                status: 'pending',
                message: error.message,
                uploadId: error.providerOperationId,
                providerUserId: error.providerUserId,
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

        if (duringDestinationUpload && isProviderOperationError(error) && error.disposition === 'auth_required') {
            const acceptedUploadResult = await moveAcceptedDestinationUploadConnectionFailureToDlq(
                queueItem,
                error,
                bulkWriter,
                routeMeta,
                'DESTINATION_PROVIDER_AUTH_RECONCILIATION_REQUIRED',
            );
            if (acceptedUploadResult) {
                return acceptedUploadResult;
            }
            logProviderFailureDecision(queueItem, error, 'skip');
            await safelyWriteMetadata(() => setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_auth_failed',
                detail: error.message,
            }));
            return finalizeActivitySyncQueueItemIfCurrent(queueItem, {
                skippedReason: 'destination_auth_failed',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            }, 'activity_sync_auth_skip_transition', 'provider authentication skip');
        }

        if (duringDestinationUpload && isProviderOperationError(error) && error.disposition === 'permission_required') {
            const acceptedUploadResult = await moveAcceptedDestinationUploadConnectionFailureToDlq(
                queueItem,
                error,
                bulkWriter,
                routeMeta,
                'DESTINATION_PROVIDER_PERMISSION_RECONCILIATION_REQUIRED',
            );
            if (acceptedUploadResult) {
                return acceptedUploadResult;
            }
            logProviderFailureDecision(queueItem, error, 'skip');
            await safelyWriteMetadata(() => setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_permission_required',
                detail: error.message,
            }));
            return finalizeActivitySyncQueueItemIfCurrent(queueItem, {
                skippedReason: 'destination_permission_required',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            }, 'activity_sync_permission_skip_transition', 'provider permission skip');
        }

        if (duringDestinationUpload && isSkippableAuthenticationError(error)) {
            const normalizedAuthError = toError(error);
            const acceptedUploadResult = await moveAcceptedDestinationUploadConnectionFailureToDlq(
                queueItem,
                normalizedAuthError,
                bulkWriter,
                routeMeta,
                'DESTINATION_PROVIDER_AUTH_RECONCILIATION_REQUIRED',
            );
            if (acceptedUploadResult) {
                return acceptedUploadResult;
            }
            const errorLike = asErrorLike(error);
            await safelyWriteMetadata(() => setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_auth_failed',
                detail: `${errorLike.message || 'Authentication failed.'}`,
            }));
            return finalizeActivitySyncQueueItemIfCurrent(queueItem, {
                skippedReason: 'destination_auth_failed',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            }, 'activity_sync_auth_skip_transition', 'provider authentication skip');
        }

        if (duringDestinationUpload && isWahooWriteScopeError(error)) {
            const normalizedScopeError = toError(error);
            const acceptedUploadResult = await moveAcceptedDestinationUploadConnectionFailureToDlq(
                queueItem,
                normalizedScopeError,
                bulkWriter,
                routeMeta,
                'DESTINATION_PROVIDER_PERMISSION_RECONCILIATION_REQUIRED',
            );
            if (acceptedUploadResult) {
                return acceptedUploadResult;
            }
            const errorLike = asErrorLike(error);
            await safelyWriteMetadata(() => setActivitySyncSkippedMetadata({
                ...routeMeta,
                skippedReason: 'destination_write_scope_missing',
                detail: `${errorLike.message || 'Reconnect Wahoo and allow workout access.'}`,
            }));
            return finalizeActivitySyncQueueItemIfCurrent(queueItem, {
                skippedReason: 'destination_write_scope_missing',
                destinationUploadContinuation: null,
                resultStatus: 'skipped',
            }, 'activity_sync_permission_skip_transition', 'provider write-scope skip');
        }

        if (isAccountDeletionSkipError(error)) {
            return markActivitySyncQueueItemSkippedForDeletedUser(queueItem, bulkWriter);
        }

        if (isTokenUseSkippedForPendingDisconnectError(error)) {
            const acceptedUploadId = duringDestinationUpload
                ? getAcceptedUploadIdFromPendingDisconnectError(error)
                : null;
            if (acceptedUploadId && queueItem.destinationUploadID !== acceptedUploadId) {
                const acceptedUploadState = {
                    status: 'pending',
                    message: toError(error).message,
                    uploadId: acceptedUploadId,
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
            return deferActivitySyncQueueItemForPendingDisconnect(
                queueItem,
                bulkWriter,
                routeMeta,
                queueItem.destinationServiceName,
                duringDestinationUpload,
            );
        }

        // Wahoo's public callable exposes a definitive failed-status result as
        // an HttpsError with restart details. For a queue item with a durable
        // upload ID, that is safe to convert to the canonical restart policy.
        const providerOperationError = getWahooProviderConfirmedRestartError(queueItem, error);
        const actionableError = providerOperationError || error;
        const normalizedError = toError(actionableError);
        const metadataError = toActivitySyncMetadataError(normalizedError);

        if (duringDestinationUpload && isProviderOperationError(actionableError) && actionableError.disposition === 'retryable') {
            if (actionableError.retryMode === 'resume') {
                const persistedResumeState = hasPersistedDestinationUpload(queueItem);
                const providerOperationId = actionableError.providerOperationId
                    || (persistedResumeState ? queueItem.destinationUploadID || undefined : undefined);
                const providerUserId = actionableError.providerUserId
                    || (persistedResumeState ? queueItem.destinationProviderUserID || undefined : undefined);
                if (!providerOperationId || (
                    destinationRequiresProviderUserId(queueItem.destinationServiceName) && !providerUserId
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
                    return moveActivitySyncQueueItemToDlqIfCurrent(
                        queueItem,
                        invalidResumeStateError,
                        bulkWriter,
                        invalidResumeStateError.dlqContext,
                    );
                }
                const pendingUploadState = {
                    status: 'pending',
                    message: actionableError.message,
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
            } else if (actionableError.retryMode === 'restart') {
                const cleared = await clearPendingDestinationUploadForRestart(queueItem);
                if (!cleared) {
                    return QueueResult.Processed;
                }
            }
            await safelyWriteMetadata(() => setActivitySyncRetryingMetadata({
                ...routeMeta,
                error: metadataError,
            }));
            const retryResult = await increaseActivitySyncRetryCountIfCurrent(
                queueItem,
                normalizedError,
                bulkWriter,
                actionableError.dlqContext || 'DESTINATION_PROVIDER_RETRY_EXHAUSTED',
            );
            if (retryResult === QueueResult.MovedToDLQ) {
                await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
                    ...routeMeta,
                    error: metadataError,
                }));
                logProviderFailureDecision(queueItem, actionableError, 'dlq');
            } else {
                logProviderFailureDecision(queueItem, actionableError, 'retry');
            }
            return retryResult;
        }

        if ((!isProviderOperationError(actionableError) && isTransientActivitySyncError(actionableError)) || (
            duringDestinationUpload && isLegacyRetryableSuuntoActivitySyncError(queueItem, actionableError)
        )) {
            await safelyWriteMetadata(() => setActivitySyncRetryingMetadata({
                ...routeMeta,
                error: metadataError,
            }));
            return increaseActivitySyncRetryCountIfCurrent(
                queueItem,
                normalizedError,
                bulkWriter,
            );
        }

        if (duringDestinationUpload && isProviderOperationError(actionableError)) {
            logProviderFailureDecision(queueItem, actionableError, 'dlq');
        }

        await safelyWriteMetadata(() => setActivitySyncFailedMetadata({
            ...routeMeta,
            error: metadataError,
        }));
        const failedQueueItem = duringDestinationUpload
            && isProviderOperationError(actionableError)
            && actionableError.serviceName === ServiceNames.WahooAPI
            && actionableError.providerOperationId
            ? {
                ...queueItem,
                destinationUploadID: actionableError.providerOperationId,
                destinationProviderUserID: actionableError.providerUserId
                    || queueItem.destinationProviderUserID
                    || null,
            }
            : queueItem;
        return moveActivitySyncQueueItemToDlqIfCurrent(
            failedQueueItem,
            normalizedError,
            bulkWriter,
            isProviderOperationError(actionableError) && actionableError.dlqContext
                ? actionableError.dlqContext
                : getDeadLetterContext(normalizedError),
            queueItem,
        );
    }
}
