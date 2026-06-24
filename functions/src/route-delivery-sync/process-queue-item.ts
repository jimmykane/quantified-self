import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreRouteJSON } from '../../../shared/app-route.interface';
import { ROUTE_DELIVERY_SYNC_ROUTES } from '../../../shared/route-delivery-sync-routes';
import {
    RouteDeliverySyncQueueItemInterface,
} from '../queue/queue-item.interface';
import {
    increaseRetryCountForQueueItem,
    markQueueItemSkipped,
    moveToDeadLetterQueue,
    QueueResult,
    QUEUE_SKIPPED_REASONS,
    updateToProcessed,
} from '../queue-utils';
import { hasProAccess } from '../utils';
import {
    getRouteDeliverySyncRouteAllowlistConfigError,
    isRouteDeliverySyncRouteUserAllowlisted,
} from './allowlist';
import { buildRouteDeliverySourceRevisionKey } from './revision';
import { isRouteDeliverySyncRouteEnabledForUser } from './settings';
import {
    assertRouteSendUserActive,
    getRouteSendAdapter,
    isAccountDeletionSkipError,
    isDeliveryMetadataPersistenceError,
    isDestinationAuthRequiredError,
    isDestinationPermissionRequiredError,
    persistRouteDeliveryMetadataAfterSend,
    prepareSavedRouteForSending,
    RouteSendItemError,
    sendPreparedRouteToDestination,
} from '../routes/route-send-core';
import { setRouteDeliveryMetadata } from '../routes/route-persistence';
import { shouldSkipQueueWorkForDeletedUser } from '../queue/user-deletion-skip';

interface ErrorLike {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
    return error && typeof error === 'object' ? error as ErrorLike : {};
}

function toNormalizedErrorCode(value: unknown): string {
    return `${value || ''}`.trim().toLowerCase().replace(/_/g, '-');
}

function toFiniteNumber(value: unknown): number | null {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

const TRANSIENT_ROUTE_DELIVERY_ERROR_CODES = new Set([
    'aborted',
    'deadline-exceeded',
    'unavailable',
]);

const TRANSIENT_ROUTE_DELIVERY_GRPC_CODES = new Set([
    4,
    10,
    14,
]);

const TRANSIENT_ROUTE_DELIVERY_STATUS_CODES = new Set([
    429,
    500,
    502,
    503,
    504,
]);

function isTransientRouteDeliveryError(error: unknown): boolean {
    const errorLike = asErrorLike(error);
    const normalizedCode = toNormalizedErrorCode(errorLike.code);
    const normalizedStatus = toNormalizedErrorCode(errorLike.status);
    if (TRANSIENT_ROUTE_DELIVERY_ERROR_CODES.has(normalizedCode) || TRANSIENT_ROUTE_DELIVERY_ERROR_CODES.has(normalizedStatus)) {
        return true;
    }

    const grpcCode = toFiniteNumber(errorLike.code);
    const grpcStatus = toFiniteNumber(errorLike.status);
    if (
        (grpcCode !== null && TRANSIENT_ROUTE_DELIVERY_GRPC_CODES.has(grpcCode)) ||
        (grpcStatus !== null && TRANSIENT_ROUTE_DELIVERY_GRPC_CODES.has(grpcStatus))
    ) {
        return true;
    }

    const statusCode = toFiniteNumber(errorLike.statusCode);
    return statusCode !== null && TRANSIENT_ROUTE_DELIVERY_STATUS_CODES.has(statusCode);
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(`${error}`);
}

function toErrorCode(error: unknown): string {
    const errorLike = asErrorLike(error);
    return `${errorLike.code || errorLike.statusCode || (error instanceof Error ? error.name : '') || 'unknown'}`;
}

function toErrorMessage(error: unknown): string {
    const errorLike = asErrorLike(error);
    return `${errorLike.message || error || 'Unknown error'}`.slice(0, 500);
}

async function safelyWriteDeliveryMetadata(writeOperation: () => Promise<void>): Promise<void> {
    try {
        await writeOperation();
    } catch {
        // Queue state is the source of truth; metadata write failures should not block retries/DLQ.
    }
}

async function setSkippedDeliveryMetadata(
    queueItem: RouteDeliverySyncQueueItemInterface,
    skippedReason: string,
    detail?: string,
): Promise<void> {
    await setRouteDeliveryMetadata({
        userID: queueItem.userID,
        routeID: queueItem.savedRouteID,
        deliveryMetadata: {
            serviceName: queueItem.destinationServiceName,
            status: 'skipped',
            routeSyncRouteId: queueItem.routeId,
            sourceRevisionKey: queueItem.sourceRevisionKey,
            skippedReason,
            lastAttemptAt: new Date(),
            lastErrorCode: skippedReason,
            lastErrorMessage: detail || null,
        },
    });
}

async function setFailedDeliveryMetadata(
    queueItem: RouteDeliverySyncQueueItemInterface,
    error: unknown,
): Promise<void> {
    await setRouteDeliveryMetadata({
        userID: queueItem.userID,
        routeID: queueItem.savedRouteID,
        deliveryMetadata: {
            serviceName: queueItem.destinationServiceName,
            status: 'failed',
            routeSyncRouteId: queueItem.routeId,
            sourceRevisionKey: queueItem.sourceRevisionKey,
            lastAttemptAt: new Date(),
            lastErrorCode: toErrorCode(error),
            lastErrorMessage: toErrorMessage(error),
        },
    });
}

function getSourceSummary(routeDocument: FirestoreRouteJSON | null | undefined): Record<string, unknown> | null {
    return routeDocument?.sourceSummary && typeof routeDocument.sourceSummary === 'object' && !Array.isArray(routeDocument.sourceSummary)
        ? routeDocument.sourceSummary as unknown as Record<string, unknown>
        : null;
}

function normalizeNonEmptyString(value: unknown): string | null {
    const normalized = `${value || ''}`.trim();
    return normalized.length > 0 ? normalized : null;
}

function hasMatchingSourceProvenance(
    queueItem: RouteDeliverySyncQueueItemInterface,
    routeDocument: FirestoreRouteJSON,
): boolean {
    const sourceSummary = getSourceSummary(routeDocument);
    if (normalizeNonEmptyString(sourceSummary?.sourceServiceName) !== queueItem.sourceServiceName) {
        return false;
    }

    const expectedProviderRouteId = normalizeNonEmptyString(queueItem.sourceProviderRouteId);
    if (expectedProviderRouteId && normalizeNonEmptyString(sourceSummary?.providerRouteId) !== expectedProviderRouteId) {
        return false;
    }

    const expectedProviderUserId = normalizeNonEmptyString(queueItem.sourceProviderUserId);
    if (expectedProviderUserId && normalizeNonEmptyString(sourceSummary?.providerUserId) !== expectedProviderUserId) {
        return false;
    }

    return true;
}

function getCurrentRouteSourceRevisionKey(
    queueItem: RouteDeliverySyncQueueItemInterface,
    routeDocument: FirestoreRouteJSON,
): string {
    const sourceSummary = getSourceSummary(routeDocument);
    return buildRouteDeliverySourceRevisionKey({
        sourceServiceName: queueItem.sourceServiceName,
        providerRouteId: normalizeNonEmptyString(sourceSummary?.providerRouteId)
            || normalizeNonEmptyString(queueItem.sourceProviderRouteId)
            || queueItem.savedRouteID,
        providerRouteModifiedAt: sourceSummary?.modifiedAt || null,
        fallbackUpdatedAt: routeDocument.updatedAt || sourceSummary?.importedAt || routeDocument.importedAt || queueItem.savedRouteID,
        fallbackRouteID: queueItem.savedRouteID,
    });
}

function isPermanentRouteSendItemError(error: unknown): boolean {
    return error instanceof RouteSendItemError
        && (
            error.reason === 'NO_ORIGINAL_FILES' ||
            error.reason === 'NOT_FOUND' ||
            error.reason === 'PARSE_FAILED' ||
            error.reason === 'SOURCE_SERVICE_BLOCKED' ||
            error.reason === 'DELIVERY_METADATA_PERSIST_FAILED'
        );
}

function getDeadLetterContext(error: unknown): string {
    if (isDeliveryMetadataPersistenceError(error)) {
        return 'ROUTE_DELIVERY_METADATA_PERSIST_FAILED';
    }
    if (error instanceof RouteSendItemError) {
        return `ROUTE_DELIVERY_${error.reason}`;
    }
    return 'ROUTE_DELIVERY_SYNC_PERMANENT_FAILURE';
}

export async function processRouteDeliverySyncQueueItem(
    queueItem: RouteDeliverySyncQueueItemInterface,
    bulkWriter?: admin.firestore.BulkWriter,
): Promise<QueueResult> {
    try {
        if (await shouldSkipQueueWorkForDeletedUser(
            queueItem.userID,
            queueItem.destinationServiceName,
            queueItem.id,
            'before_route_delivery_sync_processing',
        )) {
            return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
            });
        }

        const route = ROUTE_DELIVERY_SYNC_ROUTES[queueItem.routeId];
        if (!route) {
            throw Object.assign(new Error(`Unknown route delivery sync route ${queueItem.routeId}`), {
                dlqContext: 'UNKNOWN_ROUTE_DELIVERY_SYNC_ROUTE',
            });
        }

        const allowlistConfigError = getRouteDeliverySyncRouteAllowlistConfigError(queueItem.routeId);
        if (allowlistConfigError) {
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'allowlist_misconfigured', allowlistConfigError));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'allowlist_misconfigured',
                resultStatus: 'skipped',
            });
        }

        if (!isRouteDeliverySyncRouteUserAllowlisted(queueItem.routeId, queueItem.userID)) {
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'user_not_allowlisted', 'User is not allowlisted for this route delivery sync route.'));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'user_not_allowlisted',
                resultStatus: 'skipped',
            });
        }

        if (!(await hasProAccess(queueItem.userID))) {
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'no_pro_access', 'Route delivery sync is a Pro feature.'));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'no_pro_access',
                resultStatus: 'skipped',
            });
        }

        const enabled = await isRouteDeliverySyncRouteEnabledForUser(queueItem.userID, queueItem.routeId);
        if (!enabled && queueItem.manual !== true) {
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'route_disabled', 'Route delivery sync route is disabled in user settings.'));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'route_disabled',
                resultStatus: 'skipped',
            });
        }

        const adapter = getRouteSendAdapter(queueItem.destinationServiceName);
        if (!adapter) {
            throw Object.assign(new Error(`Unsupported route delivery destination ${queueItem.destinationServiceName}`), {
                dlqContext: 'UNSUPPORTED_ROUTE_DELIVERY_DESTINATION',
            });
        }

        if (await shouldSkipQueueWorkForDeletedUser(
            queueItem.userID,
            queueItem.destinationServiceName,
            queueItem.id,
            'before_route_delivery_sync_prepare',
        )) {
            return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
            });
        }

        const preparedRoute = await prepareSavedRouteForSending(queueItem.userID, queueItem.savedRouteID);
        if (!hasMatchingSourceProvenance(queueItem, preparedRoute.routeDocument)) {
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'source_route_mismatch', 'Saved route source metadata no longer matches this route delivery queue item.'));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'source_route_mismatch',
                resultStatus: 'skipped',
            });
        }

        const currentSourceRevisionKey = getCurrentRouteSourceRevisionKey(queueItem, preparedRoute.routeDocument);
        if (currentSourceRevisionKey !== queueItem.sourceRevisionKey) {
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'stale_source_revision', 'Saved route has a newer source revision than this route delivery queue item.'));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'stale_source_revision',
                resultStatus: 'skipped',
            });
        }

        await assertRouteSendUserActive(queueItem.userID, 'route_delivery_before_context');
        let context: unknown;
        try {
            context = await adapter.createContext(queueItem.userID);
        } catch (error) {
            if (isDestinationAuthRequiredError(error)) {
                await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'destination_not_connected', toErrorMessage(error)));
                return updateToProcessed(queueItem, bulkWriter, {
                    skippedReason: 'destination_not_connected',
                    resultStatus: 'skipped',
                });
            }
            if (isDestinationPermissionRequiredError(error)) {
                await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'destination_permission_required', toErrorMessage(error)));
                return updateToProcessed(queueItem, bulkWriter, {
                    skippedReason: 'destination_permission_required',
                    resultStatus: 'skipped',
                });
            }
            throw error;
        }

        if (await shouldSkipQueueWorkForDeletedUser(
            queueItem.userID,
            queueItem.destinationServiceName,
            queueItem.id,
            'before_route_delivery_sync_destination_upload',
        )) {
            return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
            });
        }

        const providerResult = await sendPreparedRouteToDestination(queueItem.userID, preparedRoute, adapter, context);
        await persistRouteDeliveryMetadataAfterSend({
            userID: queueItem.userID,
            routeID: queueItem.savedRouteID,
            destinationServiceName: queueItem.destinationServiceName,
            providerRouteId: providerResult.providerRouteId,
            deliveries: providerResult.deliveries,
            routeSyncRouteId: queueItem.routeId,
            sourceRevisionKey: queueItem.sourceRevisionKey,
        });

        return updateToProcessed(queueItem, bulkWriter, {
            resultStatus: 'success',
            destinationProviderRouteId: providerResult.providerRouteId || null,
            successProcessedAt: Date.now(),
            updatedAt: FieldValue.serverTimestamp(),
        });
    } catch (error) {
        if (isAccountDeletionSkipError(error)) {
            return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
            });
        }

        if (isDestinationAuthRequiredError(error)) {
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'destination_not_connected', toErrorMessage(error)));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'destination_not_connected',
                resultStatus: 'skipped',
            });
        }

        if (isDestinationPermissionRequiredError(error)) {
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'destination_permission_required', toErrorMessage(error)));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: 'destination_permission_required',
                resultStatus: 'skipped',
            });
        }

        if (error instanceof RouteSendItemError && (
            error.reason === 'NO_ORIGINAL_FILES' ||
            error.reason === 'SOURCE_FILE_UNAVAILABLE' ||
            error.reason === 'SOURCE_SERVICE_BLOCKED'
        )) {
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, error.reason.toLowerCase(), error.message));
            return updateToProcessed(queueItem, bulkWriter, {
                skippedReason: error.reason.toLowerCase(),
                resultStatus: 'skipped',
            });
        }

        const normalizedError = toError(error);
        if (isTransientRouteDeliveryError(error)) {
            await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(queueItem, normalizedError));
            return increaseRetryCountForQueueItem(queueItem, normalizedError, 1, bulkWriter);
        }

        if (isPermanentRouteSendItemError(error)) {
            await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(queueItem, normalizedError));
            return moveToDeadLetterQueue(queueItem, normalizedError, bulkWriter, getDeadLetterContext(error));
        }

        await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(queueItem, normalizedError));
        return moveToDeadLetterQueue(queueItem, normalizedError, bulkWriter, (normalizedError as Error & { dlqContext?: string }).dlqContext || getDeadLetterContext(error));
    }
}
