import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '../../../shared/app-route.interface';
import { ROUTE_DELIVERY_SYNC_ROUTES } from '../../../shared/route-delivery-sync-routes';
import {
    isDisconnectPendingServiceConnection,
    isReconnectRequiredServiceConnection,
} from '../../../shared/service-connection';
import {
    RouteDeliverySyncQueueItemInterface,
} from '../queue/queue-item.interface';
import {
    deferQueueItemForPendingDisconnect,
    deferQueueItemForPendingDisconnectIfCurrentUserActive,
    deferQueueItemForReconnectRequiredIfCurrentUserActive,
    increaseRetryCountIfCurrentUserActive,
    isProviderOperationInFlightLeaseActive,
    markQueueItemSkipped,
    moveToDeadLetterQueueIfCurrentUserActive,
    ProviderOperationStillInFlightError,
    QueueResult,
    QUEUE_SKIPPED_REASONS,
    PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
    type QueueManualReconciliationState,
    updateToProcessed,
} from '../queue-utils';
import { hasProAccess } from '../utils';
import {
    getRouteDeliverySyncRouteAllowlistConfigError,
    isRouteDeliverySyncRouteUserAllowlisted,
} from './allowlist';
import { buildRouteDeliverySourceRevisionKeyForRouteSource } from './revision';
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
import { getServiceConnectionMeta } from '../service-connection-meta';
import { isWahooReconnectRequiredError } from '../wahoo/refresh-recovery';
import {
    isProviderOperationError,
    ProviderOperationError,
    toProviderOperationLogDetails,
} from '../shared/provider-operation-error';
import {
    QueueItemUserGuardedUpdateResult,
    updateQueueItemIfUserActive,
} from '../queue/dispatch-marker';
import { RouteProviderSendResult } from '../routes/provider-acceptance';
import {
    DisabledSyncRouteTransitionResult,
    finalizeDisabledSyncRouteIfCurrent,
} from '../queue/sync-route-eligibility';

interface ErrorLike {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    serviceName?: unknown;
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
    'resource-exhausted',
    'unavailable',
]);

const TRANSIENT_ROUTE_DELIVERY_GRPC_CODES = new Set([
    4,
    8,
    10,
    14,
]);

const TRANSIENT_ROUTE_DELIVERY_STATUS_CODES = new Set([
    408,
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

function isTokenUseSkippedForPendingDisconnectError(error: unknown): boolean {
    return error instanceof Error && error.name === 'TokenUseSkippedForPendingDisconnectError';
}

function getPendingDisconnectServiceFromError(
    error: unknown,
    queueItem: RouteDeliverySyncQueueItemInterface,
): ServiceNames {
    const errorServiceName = normalizeNonEmptyString(asErrorLike(error).serviceName);
    if (errorServiceName === queueItem.sourceServiceName) {
        return queueItem.sourceServiceName;
    }
    if (errorServiceName === queueItem.destinationServiceName) {
        return queueItem.destinationServiceName;
    }

    return queueItem.destinationServiceName;
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

function normalizeProviderDeliveries(
    deliveries: RouteProviderSendResult['deliveries'],
): NonNullable<RouteDeliverySyncQueueItemInterface['destinationDeliveries']> {
    if (!Array.isArray(deliveries)) {
        return [];
    }

    return deliveries.map(delivery => ({
        providerUserId: normalizeNonEmptyString(delivery?.providerUserId) || null,
        providerRouteId: normalizeNonEmptyString(delivery?.providerRouteId) || null,
    }));
}

class RouteProviderAcceptancePersistenceSkippedError extends Error {
    readonly name = 'RouteProviderAcceptancePersistenceSkippedError';
}

class RouteProviderAcceptancePersistenceError extends Error {
    readonly name = 'RouteProviderAcceptancePersistenceError';

    constructor(
        readonly providerResult: RouteProviderSendResult,
        readonly persistenceError: unknown,
    ) {
        super('Could not persist accepted provider route state.');
    }
}

function getPersistedProviderAcceptance(
    queueItem: RouteDeliverySyncQueueItemInterface,
): RouteProviderSendResult | null {
    const acceptedAt = Number(queueItem.destinationDeliveryAcceptedAt);
    if (!Number.isFinite(acceptedAt) || acceptedAt <= 0) {
        return null;
    }

    return {
        providerRouteId: normalizeNonEmptyString(queueItem.destinationProviderRouteId) || undefined,
        // Rows written before the completion marker existed represented a
        // single completed provider result, so absence remains complete.
        complete: queueItem.destinationDeliveryComplete !== false,
        deliveries: normalizeProviderDeliveries(queueItem.destinationDeliveries),
    };
}

function hasUnresolvedDestinationProviderOperation(queueItem: RouteDeliverySyncQueueItemInterface): boolean {
    return queueItem.dispatchedToCloudTask === PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER
        && !getPersistedProviderAcceptance(queueItem);
}

function isSameRouteDeliverySyncQueueItem(
    currentQueueItem: Record<string, unknown>,
    queueItem: RouteDeliverySyncQueueItemInterface,
): boolean {
    return currentQueueItem.dateCreated === queueItem.dateCreated
        && currentQueueItem.userID === queueItem.userID
        && currentQueueItem.savedRouteID === queueItem.savedRouteID
        && currentQueueItem.routeId === queueItem.routeId
        && currentQueueItem.sourceRevisionKey === queueItem.sourceRevisionKey
        && currentQueueItem.sourceServiceName === queueItem.sourceServiceName
        && currentQueueItem.destinationServiceName === queueItem.destinationServiceName;
}

function isSameRouteDeliveryProviderState(
    currentQueueItem: Record<string, unknown>,
    expectedQueueItem: RouteDeliverySyncQueueItemInterface,
): boolean {
    return currentQueueItem.processed !== true
        && currentQueueItem.dispatchedToCloudTask === expectedQueueItem.dispatchedToCloudTask
        && Number(currentQueueItem.providerOperationStartedAt || 0)
            === Number(expectedQueueItem.providerOperationStartedAt || 0)
        && Number(currentQueueItem.destinationDeliveryAcceptedAt || 0)
            === Number(expectedQueueItem.destinationDeliveryAcceptedAt || 0)
        && (currentQueueItem.destinationDeliveryComplete !== false)
            === (expectedQueueItem.destinationDeliveryComplete !== false)
        && normalizeNonEmptyString(currentQueueItem.destinationProviderRouteId)
            === normalizeNonEmptyString(expectedQueueItem.destinationProviderRouteId)
        && JSON.stringify(normalizeProviderDeliveries(
            currentQueueItem.destinationDeliveries as RouteProviderSendResult['deliveries'],
        )) === JSON.stringify(normalizeProviderDeliveries(expectedQueueItem.destinationDeliveries))
        && isSameRouteDeliverySyncQueueItem(currentQueueItem, expectedQueueItem);
}

const ROUTE_DELIVERY_MANUAL_RECONCILIATION_CONTEXTS = new Set([
    'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
    'DESTINATION_PROVIDER_PARTIAL_ACCEPTANCE',
    'GARMIN_ROUTE_CREATE_AMBIGUOUS',
    'ROUTE_DELIVERY_PROVIDER_ACCEPTANCE_PERSIST_FAILED',
    'SUUNTO_ROUTE_CREATE_AMBIGUOUS',
]);

function getRouteDeliveryManualReconciliationState(
    queueItem: RouteDeliverySyncQueueItemInterface,
    context?: string,
): QueueManualReconciliationState | undefined {
    if (
        !queueItem.destinationDeliveryAcceptedAt
        && !ROUTE_DELIVERY_MANUAL_RECONCILIATION_CONTEXTS.has(`${context || ''}`)
    ) {
        return undefined;
    }

    return {
        additionalData: {
            ...(queueItem.destinationDeliveryAcceptedAt
                ? { destinationDeliveryAcceptedAt: queueItem.destinationDeliveryAcceptedAt }
                : {}),
            ...(queueItem.destinationDeliveryComplete !== undefined
                ? { destinationDeliveryComplete: queueItem.destinationDeliveryComplete }
                : {}),
            ...(queueItem.destinationProviderRouteId !== undefined
                ? { destinationProviderRouteId: queueItem.destinationProviderRouteId }
                : {}),
            ...(queueItem.destinationProviderUserId !== undefined
                ? { destinationProviderUserId: queueItem.destinationProviderUserId }
                : {}),
            ...(queueItem.destinationProviderOperation !== undefined
                ? { destinationProviderOperation: queueItem.destinationProviderOperation }
                : {}),
            ...(queueItem.destinationDeliveries !== undefined
                ? { destinationDeliveries: queueItem.destinationDeliveries }
                : {}),
        },
    };
}

function withDestinationProviderOperationDiagnostics(
    queueItem: RouteDeliverySyncQueueItemInterface,
    error: unknown,
    context: string | undefined,
): RouteDeliverySyncQueueItemInterface {
    if (
        !isProviderOperationError(error)
        || !ROUTE_DELIVERY_MANUAL_RECONCILIATION_CONTEXTS.has(`${context || ''}`)
    ) {
        return queueItem;
    }

    const providerUserId = normalizeNonEmptyString(error.providerUserId);
    const providerOperation = normalizeNonEmptyString(error.operation);
    if (!providerUserId && !providerOperation) {
        return queueItem;
    }

    return {
        ...queueItem,
        ...(providerUserId ? { destinationProviderUserId: providerUserId } : {}),
        ...(providerOperation ? { destinationProviderOperation: providerOperation } : {}),
    };
}

function moveRouteDeliverySyncQueueItemToDlqIfCurrent(
    failedQueueItem: RouteDeliverySyncQueueItemInterface,
    error: Error,
    bulkWriter: admin.firestore.BulkWriter | undefined,
    context: string | undefined,
    expectedQueueItem: RouteDeliverySyncQueueItemInterface = failedQueueItem,
): Promise<QueueResult.MovedToDLQ | QueueResult.Processed | QueueResult.Failed> {
    return moveToDeadLetterQueueIfCurrentUserActive({
        queueItem: failedQueueItem,
        error,
        context,
        bulkWriter,
        userID: expectedQueueItem.userID,
        phase: 'route_delivery_sync_dlq_transition',
        logPrefix: 'RouteDeliverySync',
        isCurrent: currentQueueItem => isSameRouteDeliveryProviderState(currentQueueItem, expectedQueueItem),
        manualReconciliation: getRouteDeliveryManualReconciliationState(failedQueueItem, context),
    });
}

function increaseRouteDeliverySyncRetryCountIfCurrent(
    queueItem: RouteDeliverySyncQueueItemInterface,
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
        phase: 'route_delivery_sync_retry_transition',
        logPrefix: 'RouteDeliverySync',
        isCurrent: currentQueueItem => isSameRouteDeliveryProviderState(currentQueueItem, queueItem),
        manualReconciliation: getRouteDeliveryManualReconciliationState(queueItem, maxRetryDlqContext),
    });
}

function buildUnresolvedDestinationProviderOperationError(
    queueItem: RouteDeliverySyncQueueItemInterface,
): ProviderOperationError {
    return new ProviderOperationError({
        serviceName: queueItem.destinationServiceName,
        operation: 'route_upload',
        disposition: 'permanent',
        retryMode: 'none',
        code: 'failed-precondition',
        message: `${queueItem.destinationServiceName} route delivery may already have been accepted, but its provider state was not saved. Reconcile it manually before retrying.`,
        dlqContext: 'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
    });
}

function buildPartialDestinationProviderAcceptanceError(
    queueItem: RouteDeliverySyncQueueItemInterface,
): ProviderOperationError {
    return new ProviderOperationError({
        serviceName: queueItem.destinationServiceName,
        operation: 'route_upload',
        disposition: 'permanent',
        retryMode: 'none',
        code: 'failed-precondition',
        message: `${queueItem.destinationServiceName} accepted only part of a multi-account route delivery before processing stopped. Reconcile the remaining accounts manually before retrying.`,
        providerOperationId: normalizeNonEmptyString(queueItem.destinationProviderRouteId) || undefined,
        dlqContext: 'DESTINATION_PROVIDER_PARTIAL_ACCEPTANCE',
    });
}

async function markDestinationProviderOperationInFlight(
    queueItem: RouteDeliverySyncQueueItemInterface,
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
        phase: 'before_route_delivery_destination_provider_operation',
        updateData: {
            dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
            providerOperationStartedAt,
        },
        logPrefix: 'RouteDeliverySync',
        actionDescription: 'destination provider in-flight marker',
        isCurrent: currentQueueItem => isSameRouteDeliveryProviderState(currentQueueItem, expectedQueueItem),
    });
    if (updateResult !== QueueItemUserGuardedUpdateResult.Updated) {
        return false;
    }
    queueItem.dispatchedToCloudTask = PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER;
    queueItem.providerOperationStartedAt = providerOperationStartedAt;
    return true;
}

async function persistProviderAcceptance(
    queueItem: RouteDeliverySyncQueueItemInterface,
    providerResult: RouteProviderSendResult,
): Promise<boolean> {
    if (!queueItem.ref) {
        throw new Error('Accepted route delivery cannot be persisted without a queue document reference.');
    }

    const destinationDeliveryAcceptedAt = Date.now();
    const destinationDeliveryComplete = providerResult.complete !== false;
    const destinationProviderRouteId = normalizeNonEmptyString(providerResult.providerRouteId) || null;
    const destinationDeliveries = normalizeProviderDeliveries(providerResult.deliveries);
    const expectedQueueItem = { ...queueItem };
    const updateResult = await updateQueueItemIfUserActive({
        queueItemDocument: queueItem.ref,
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        phase: 'before_route_delivery_provider_acceptance_persist',
        updateData: {
            destinationDeliveryAcceptedAt,
            destinationDeliveryComplete,
            destinationProviderRouteId,
            destinationDeliveries,
            dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
        },
        logPrefix: 'RouteDeliverySync',
        actionDescription: 'accepted provider route persistence',
        isCurrent: currentQueueItem => isSameRouteDeliveryProviderState(currentQueueItem, expectedQueueItem),
    });
    if (updateResult !== QueueItemUserGuardedUpdateResult.Updated) {
        return false;
    }

    queueItem.destinationDeliveryAcceptedAt = destinationDeliveryAcceptedAt;
    queueItem.destinationDeliveryComplete = destinationDeliveryComplete;
    queueItem.destinationProviderRouteId = destinationProviderRouteId;
    queueItem.destinationDeliveries = destinationDeliveries;
    queueItem.dispatchedToCloudTask = PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER;
    return true;
}

async function moveProviderAcceptancePersistenceFailureToDlq(
    queueItem: RouteDeliverySyncQueueItemInterface,
    providerResult: RouteProviderSendResult,
    persistenceError: unknown,
    bulkWriter: admin.firestore.BulkWriter | undefined,
): Promise<QueueResult.Processed | QueueResult.MovedToDLQ | QueueResult.Skipped | QueueResult.Failed> {
    const acceptedAt = Date.now();
    const expectedProviderOperationStartedAt = queueItem.providerOperationStartedAt;
    const failedQueueItem: RouteDeliverySyncQueueItemInterface = {
        ...queueItem,
        destinationDeliveryAcceptedAt: acceptedAt,
        destinationDeliveryComplete: providerResult.complete !== false,
        destinationProviderRouteId: normalizeNonEmptyString(providerResult.providerRouteId) || null,
        destinationDeliveries: normalizeProviderDeliveries(providerResult.deliveries),
    };
    const stateError = Object.assign(
        new Error(`Could not persist the accepted ${queueItem.destinationServiceName} route delivery safely.`),
        {
            code: 'internal',
            dlqContext: 'ROUTE_DELIVERY_PROVIDER_ACCEPTANCE_PERSIST_FAILED',
        },
    );
    logger.error('[RouteDeliverySync] Moving an accepted route delivery to DLQ because provider acceptance could not be persisted.', {
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        destinationServiceName: queueItem.destinationServiceName,
        providerRouteId: failedQueueItem.destinationProviderRouteId,
        persistenceError: toError(persistenceError).message,
        dlqContext: stateError.dlqContext,
    });

    const dlqResult = await moveRouteDeliverySyncQueueItemToDlqIfCurrent(
        failedQueueItem,
        stateError,
        bulkWriter,
        stateError.dlqContext,
        queueItem,
    );
    if (dlqResult === QueueResult.Failed && queueItem.ref) {
        try {
            const terminalResult = await updateQueueItemIfUserActive({
                queueItemDocument: queueItem.ref,
                queueItemId: queueItem.id,
                userID: queueItem.userID,
                phase: 'before_route_delivery_manual_reconciliation_persist',
                updateData: {
                    processed: true,
                    processedAt: Date.now(),
                    resultStatus: 'manual_reconciliation_required',
                    manualReconciliationRequiredAt: Date.now(),
                    manualReconciliationContext: stateError.dlqContext,
                    expireAt: FieldValue.delete(),
                    destinationDeliveryAcceptedAt: acceptedAt,
                    destinationDeliveryComplete: failedQueueItem.destinationDeliveryComplete !== false,
                    destinationProviderRouteId: failedQueueItem.destinationProviderRouteId,
                    destinationDeliveries: failedQueueItem.destinationDeliveries || [],
                },
                logPrefix: 'RouteDeliverySync',
                actionDescription: 'accepted route manual-reconciliation marker',
                isCurrent: currentQueueItem => currentQueueItem.processed !== true
                    && currentQueueItem.dispatchedToCloudTask === PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER
                    && Number(currentQueueItem.providerOperationStartedAt || 0)
                        === Number(expectedProviderOperationStartedAt || 0)
                    && isSameRouteDeliverySyncQueueItem(currentQueueItem, queueItem),
            });
            if (terminalResult === QueueItemUserGuardedUpdateResult.SkippedDeletedUser) {
                return QueueResult.Processed;
            }
            if (terminalResult === QueueItemUserGuardedUpdateResult.Updated) {
                logger.error('[RouteDeliverySync] Persisted a terminal manual-reconciliation marker after acceptance-state and DLQ persistence failed.', {
                    queueItemId: queueItem.id,
                    userID: queueItem.userID,
                    destinationServiceName: queueItem.destinationServiceName,
                    providerRouteId: failedQueueItem.destinationProviderRouteId,
                    dlqContext: stateError.dlqContext,
                });
                return QueueResult.Skipped;
            }
        } catch (terminalPersistenceError) {
            logger.error('[RouteDeliverySync] Could not persist a terminal marker for an accepted provider route; failing the task so the durable provider claim can be reconciled without replaying the route send.', {
                queueItemId: queueItem.id,
                userID: queueItem.userID,
                destinationServiceName: queueItem.destinationServiceName,
                providerRouteId: failedQueueItem.destinationProviderRouteId,
                error: toError(terminalPersistenceError).message,
                dlqContext: stateError.dlqContext,
            });
        }
    }
    if (dlqResult === QueueResult.Failed) {
        logger.error('[RouteDeliverySync] Accepted provider work has no durable reconciliation record; leaving the provider claim in place and retrying until it can be moved to DLQ safely.', {
            queueItemId: queueItem.id,
            userID: queueItem.userID,
            destinationServiceName: queueItem.destinationServiceName,
            providerRouteId: failedQueueItem.destinationProviderRouteId,
            dlqContext: stateError.dlqContext,
        });
        return QueueResult.Failed;
    }
    return dlqResult;
}

async function finalizeAcceptedRouteDelivery(
    queueItem: RouteDeliverySyncQueueItemInterface,
    providerResult: RouteProviderSendResult,
): Promise<QueueResult.Processed | QueueResult.Failed> {
    if (providerResult.complete === false) {
        throw buildPartialDestinationProviderAcceptanceError(queueItem);
    }
    await persistRouteDeliveryMetadataAfterSend({
        userID: queueItem.userID,
        routeID: queueItem.savedRouteID,
        destinationServiceName: queueItem.destinationServiceName,
        providerRouteId: providerResult.providerRouteId,
        deliveries: providerResult.deliveries,
        routeSyncRouteId: queueItem.routeId,
        sourceRevisionKey: queueItem.sourceRevisionKey,
        requirePersistence: true,
    });

    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }
    const expectedDispatchMarker = queueItem.dispatchedToCloudTask;
    const expectedAcceptedAt = Number(queueItem.destinationDeliveryAcceptedAt);
    const expectedProviderRouteId = normalizeNonEmptyString(queueItem.destinationProviderRouteId);
    const expectedDeliveries = normalizeProviderDeliveries(queueItem.destinationDeliveries);
    const expectedProviderOperationStartedAt = queueItem.providerOperationStartedAt;
    const updateResult = await updateQueueItemIfUserActive({
        queueItemDocument: queueItem.ref,
        queueItemId: queueItem.id,
        userID: queueItem.userID,
        phase: 'before_route_delivery_success_finalize',
        updateData: {
            processed: true,
            processedAt: Date.now(),
            resultStatus: 'success',
            destinationProviderRouteId: providerResult.providerRouteId || null,
            destinationDeliveries: normalizeProviderDeliveries(providerResult.deliveries),
            destinationDeliveryAcceptedAt: queueItem.destinationDeliveryAcceptedAt || Date.now(),
            destinationDeliveryComplete: true,
            successProcessedAt: Date.now(),
            updatedAt: FieldValue.serverTimestamp(),
        },
        logPrefix: 'RouteDeliverySync',
        actionDescription: 'successful route delivery finalization',
        isCurrent: currentQueueItem => currentQueueItem.processed !== true
            && currentQueueItem.dispatchedToCloudTask === expectedDispatchMarker
            && Number(currentQueueItem.providerOperationStartedAt || 0)
                === Number(expectedProviderOperationStartedAt || 0)
            && Number(currentQueueItem.destinationDeliveryAcceptedAt) === expectedAcceptedAt
            && currentQueueItem.destinationDeliveryComplete !== false
            && normalizeNonEmptyString(currentQueueItem.destinationProviderRouteId) === expectedProviderRouteId
            && JSON.stringify(normalizeProviderDeliveries(
                currentQueueItem.destinationDeliveries as RouteProviderSendResult['deliveries'],
            )) === JSON.stringify(expectedDeliveries)
            && isSameRouteDeliverySyncQueueItem(currentQueueItem, queueItem),
    });
    if (updateResult === QueueItemUserGuardedUpdateResult.NotCurrent) {
        logger.info(`[RouteDeliverySync] Successful queue item ${queueItem.id} was already advanced or replaced; skipping stale finalization.`);
    }
    return QueueResult.Processed;
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
    const currentProviderUserId = normalizeNonEmptyString(sourceSummary?.providerUserId);
    if (expectedProviderUserId && currentProviderUserId && currentProviderUserId !== expectedProviderUserId) {
        return false;
    }

    return true;
}

function getCurrentRouteSourceRevisionKey(
    queueItem: RouteDeliverySyncQueueItemInterface,
    routeDocument: FirestoreRouteJSON,
): string {
    const sourceSummary = getSourceSummary(routeDocument);
    return buildRouteDeliverySourceRevisionKeyForRouteSource({
        sourceServiceName: queueItem.sourceServiceName,
        sourceSummary,
        fallbackProviderRouteId: queueItem.sourceProviderRouteId,
        routeImportedAt: routeDocument.importedAt,
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
    if (isProviderOperationError(error) && error.dlqContext) {
        return error.dlqContext;
    }
    if (isDeliveryMetadataPersistenceError(error)) {
        return 'ROUTE_DELIVERY_METADATA_PERSIST_FAILED';
    }
    if (error instanceof RouteSendItemError) {
        return `ROUTE_DELIVERY_${error.reason}`;
    }
    return 'ROUTE_DELIVERY_SYNC_PERMANENT_FAILURE';
}

function logRouteProviderFailureDecision(
    queueItem: RouteDeliverySyncQueueItemInterface,
    error: ProviderOperationError,
    outcome: 'retry' | 'skip' | 'dlq',
): void {
    const details = {
        queue: 'routeDeliverySyncQueue',
        queueItemId: queueItem.id,
        routeId: queueItem.routeId,
        userID: queueItem.userID,
        destinationServiceName: queueItem.destinationServiceName,
        ...toProviderOperationLogDetails(error),
        retryCount: queueItem.retryCount || 0,
        outcome,
    };
    if (outcome === 'dlq') {
        logger.error('[RouteDeliverySync] Destination provider failure moved to DLQ.', details);
    } else {
        logger.warn('[RouteDeliverySync] Destination provider failure classified.', details);
    }
}

async function getPendingDisconnectServiceForRoute(
    userID: string,
    route: typeof ROUTE_DELIVERY_SYNC_ROUTES[keyof typeof ROUTE_DELIVERY_SYNC_ROUTES],
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

async function isWahooReconnectRequiredForRouteDelivery(
    userID: string,
    destinationServiceName: ServiceNames,
): Promise<boolean> {
    if (destinationServiceName !== ServiceNames.WahooAPI) {
        return false;
    }
    return isReconnectRequiredServiceConnection(
        await getServiceConnectionMeta(userID, destinationServiceName),
    );
}

async function deferRouteDeliverySyncQueueItemForPendingDisconnect(
    queueItem: RouteDeliverySyncQueueItemInterface,
    bulkWriter: admin.firestore.BulkWriter | undefined,
    serviceName: ServiceNames,
    requireCurrentProviderState = false,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
    const additionalData = { deferredServiceName: `${serviceName}` };
    if (!requireCurrentProviderState) {
        return deferQueueItemForPendingDisconnect(queueItem, bulkWriter, additionalData, {
            userID: queueItem.userID,
            serviceName,
        });
    }
    return deferQueueItemForPendingDisconnectIfCurrentUserActive({
        queueItem,
        additionalData,
        bulkWriter,
        userID: queueItem.userID,
        serviceName,
        phase: 'route_delivery_sync_pending_disconnect_transition',
        logPrefix: 'RouteDeliverySync',
        isCurrent: currentQueueItem => isSameRouteDeliveryProviderState(currentQueueItem, queueItem),
    });
}

async function deferRouteDeliverySyncQueueItemForReconnectRequired(
    queueItem: RouteDeliverySyncQueueItemInterface,
    bulkWriter: admin.firestore.BulkWriter | undefined,
    serviceName: ServiceNames = ServiceNames.WahooAPI,
): Promise<QueueResult.Deferred | QueueResult.Processed | QueueResult.Failed> {
    return deferQueueItemForReconnectRequiredIfCurrentUserActive({
        queueItem,
        additionalData: { deferredServiceName: `${serviceName}` },
        bulkWriter,
        userID: queueItem.userID,
        serviceName,
        phase: 'route_delivery_sync_reconnect_required_transition',
        logPrefix: 'RouteDeliverySync',
        isCurrent: currentQueueItem => isSameRouteDeliveryProviderState(currentQueueItem, queueItem),
    });
}

async function markRouteDeliverySyncQueueItemProcessedIfCurrent(
    queueItem: RouteDeliverySyncQueueItemInterface,
    additionalData: Record<string, unknown>,
    phase: string,
    actionDescription: string,
): Promise<QueueResult.Processed | QueueResult.Failed> {
    if (!queueItem.ref) {
        throw new Error(`No document reference supplied for queue item ${queueItem.id}`);
    }
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
            logPrefix: 'RouteDeliverySync',
            actionDescription,
            isCurrent: currentQueueItem => isSameRouteDeliveryProviderState(currentQueueItem, queueItem),
        });
        if (updateResult === QueueItemUserGuardedUpdateResult.NotCurrent) {
            logger.info(`[RouteDeliverySync] Queue item ${queueItem.id} was already advanced or replaced; skipping stale ${actionDescription}.`);
        }
        return QueueResult.Processed;
    } catch (error) {
        logger.error(`[RouteDeliverySync] Could not complete ${actionDescription} for queue item ${queueItem.id}.`, error);
        return QueueResult.Failed;
    }
}

export async function processRouteDeliverySyncQueueItem(
    queueItem: RouteDeliverySyncQueueItemInterface,
    bulkWriter?: admin.firestore.BulkWriter,
): Promise<QueueResult> {
    let providerSendInProgress = false;

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

        const persistedProviderAcceptance = getPersistedProviderAcceptance(queueItem);
        if (persistedProviderAcceptance && persistedProviderAcceptance.complete !== false) {
            const finalResult = await finalizeAcceptedRouteDelivery(queueItem, persistedProviderAcceptance);
            return finalResult;
        }
        if (persistedProviderAcceptance && isProviderOperationInFlightLeaseActive(queueItem)) {
            throw new ProviderOperationStillInFlightError(
                queueItem.id,
                Number(queueItem.providerOperationStartedAt),
            );
        }
        if (persistedProviderAcceptance?.complete === false) {
            const partialAcceptanceError = buildPartialDestinationProviderAcceptanceError(queueItem);
            logRouteProviderFailureDecision(queueItem, partialAcceptanceError, 'dlq');
            await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(queueItem, partialAcceptanceError));
            return moveRouteDeliverySyncQueueItemToDlqIfCurrent(
                queueItem,
                partialAcceptanceError,
                bulkWriter,
                partialAcceptanceError.dlqContext,
            );
        }
        if (hasUnresolvedDestinationProviderOperation(queueItem)) {
            if (isProviderOperationInFlightLeaseActive(queueItem)) {
                throw new ProviderOperationStillInFlightError(
                    queueItem.id,
                    Number(queueItem.providerOperationStartedAt),
                );
            }
            const unresolvedOperationError = buildUnresolvedDestinationProviderOperationError(queueItem);
            logRouteProviderFailureDecision(queueItem, unresolvedOperationError, 'dlq');
            await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(queueItem, unresolvedOperationError));
            return moveRouteDeliverySyncQueueItemToDlqIfCurrent(
                queueItem,
                unresolvedOperationError,
                bulkWriter,
                unresolvedOperationError.dlqContext,
            );
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
        const pendingDisconnectService = await getPendingDisconnectServiceForRoute(queueItem.userID, route);
        if (pendingDisconnectService) {
            return deferRouteDeliverySyncQueueItemForPendingDisconnect(
                queueItem,
                bulkWriter,
                pendingDisconnectService,
            );
        }

        if (await isWahooReconnectRequiredForRouteDelivery(
            queueItem.userID,
            queueItem.destinationServiceName,
        )) {
            return deferRouteDeliverySyncQueueItemForReconnectRequired(queueItem, bulkWriter);
        }

        if (!enabled && queueItem.manual !== true) {
            const routeDisabledResult = await finalizeDisabledSyncRouteIfCurrent({
                queueItem,
                userID: queueItem.userID,
                routeId: queueItem.routeId,
                settingsKind: 'routeDeliverySyncRoutes',
                serviceNames: [route.sourceServiceName, route.destinationServiceName],
                isCurrent: currentQueueItem => isSameRouteDeliveryProviderState(currentQueueItem, queueItem),
            });
            if (routeDisabledResult.result === DisabledSyncRouteTransitionResult.Enabled) {
                // Route restoration won after the earlier settings read.
                // Continue with the now-enabled route.
            } else if (routeDisabledResult.result === DisabledSyncRouteTransitionResult.DeferredForRestore) {
                return QueueResult.Deferred;
            } else if (
                routeDisabledResult.result === DisabledSyncRouteTransitionResult.DisconnectPending
                && routeDisabledResult.serviceName
            ) {
                return deferRouteDeliverySyncQueueItemForPendingDisconnect(
                    queueItem,
                    bulkWriter,
                    routeDisabledResult.serviceName,
                    true,
                );
            } else if (
                routeDisabledResult.result === DisabledSyncRouteTransitionResult.ReconnectRequired
                && routeDisabledResult.serviceName
            ) {
                return deferRouteDeliverySyncQueueItemForReconnectRequired(
                    queueItem,
                    bulkWriter,
                    routeDisabledResult.serviceName,
                );
            } else if (routeDisabledResult.result === DisabledSyncRouteTransitionResult.SkippedDeletedUser) {
                return markQueueItemSkipped(
                    queueItem,
                    bulkWriter,
                    QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
                    { skippedContext: 'USER_DELETION_GUARD' },
                );
            } else if (routeDisabledResult.result === DisabledSyncRouteTransitionResult.NotCurrent) {
                return QueueResult.Processed;
            } else {
                await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'route_disabled', 'Route delivery sync route is disabled in user settings.'));
                return QueueResult.Processed;
            }
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
            // The connection can become reconnect-required after the state
            // precheck above. Preserve the queue item instead of collapsing
            // that named Wahoo outcome into a generic auth skip.
            if (
                queueItem.destinationServiceName === ServiceNames.WahooAPI
                && isWahooReconnectRequiredError(error)
            ) {
                return deferRouteDeliverySyncQueueItemForReconnectRequired(queueItem, bulkWriter);
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

        const operationMarked = await markDestinationProviderOperationInFlight(queueItem);
        if (!operationMarked) {
            return QueueResult.Processed;
        }

        providerSendInProgress = true;
        let acceptancePersistedDuringSend = false;
        let providerResult: RouteProviderSendResult;
        try {
            providerResult = await sendPreparedRouteToDestination(
                queueItem.userID,
                preparedRoute,
                adapter,
                context,
                async (acceptedResult) => {
                    let persisted: boolean;
                    try {
                        persisted = await persistProviderAcceptance(queueItem, acceptedResult);
                    } catch (persistenceError) {
                        throw new RouteProviderAcceptancePersistenceError(acceptedResult, persistenceError);
                    }
                    if (!persisted) {
                        throw new RouteProviderAcceptancePersistenceSkippedError();
                    }
                    acceptancePersistedDuringSend = true;
                },
            );
        } catch (error) {
            if (error instanceof RouteProviderAcceptancePersistenceSkippedError) {
                return QueueResult.Processed;
            }
            if (error instanceof RouteProviderAcceptancePersistenceError) {
                return moveProviderAcceptancePersistenceFailureToDlq(
                    queueItem,
                    error.providerResult,
                    error.persistenceError,
                    bulkWriter,
                );
            }
            throw error;
        }
        providerSendInProgress = false;
        if (!acceptancePersistedDuringSend) {
            let acceptancePersisted: boolean;
            try {
                acceptancePersisted = await persistProviderAcceptance(queueItem, providerResult);
            } catch (persistenceError) {
                return moveProviderAcceptancePersistenceFailureToDlq(
                    queueItem,
                    providerResult,
                    persistenceError,
                    bulkWriter,
                );
            }
            if (!acceptancePersisted) {
                return QueueResult.Processed;
            }
        }

        const finalResult = await finalizeAcceptedRouteDelivery(queueItem, providerResult);
        return finalResult;
    } catch (error) {
        if (error instanceof ProviderOperationStillInFlightError) {
            logger.warn('[RouteDeliverySync] Provider operation claim is still active; retrying without changing queue state.', {
                queueItemId: queueItem.id,
                userID: queueItem.userID,
                providerOperationStartedAt: error.providerOperationStartedAt,
            });
            throw error;
        }

        if (isAccountDeletionSkipError(error)) {
            return markQueueItemSkipped(queueItem, bulkWriter, QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting, {
                skippedContext: 'USER_DELETION_GUARD',
            });
        }

        const partialProviderAcceptance = getPersistedProviderAcceptance(queueItem);
        if (partialProviderAcceptance?.complete === false) {
            const partialAcceptanceError = buildPartialDestinationProviderAcceptanceError(queueItem);
            logRouteProviderFailureDecision(queueItem, partialAcceptanceError, 'dlq');
            await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(queueItem, partialAcceptanceError));
            return moveRouteDeliverySyncQueueItemToDlqIfCurrent(
                queueItem,
                partialAcceptanceError,
                bulkWriter,
                partialAcceptanceError.dlqContext,
            );
        }

        if (isTokenUseSkippedForPendingDisconnectError(error)) {
            return deferRouteDeliverySyncQueueItemForPendingDisconnect(
                queueItem,
                bulkWriter,
                getPendingDisconnectServiceFromError(error, queueItem),
                providerSendInProgress,
            );
        }

        if (
            queueItem.destinationServiceName === ServiceNames.WahooAPI
            && isWahooReconnectRequiredError(error)
        ) {
            return deferRouteDeliverySyncQueueItemForReconnectRequired(queueItem, bulkWriter);
        }

        if (providerSendInProgress && isDestinationAuthRequiredError(error)) {
            if (isProviderOperationError(error)) {
                logRouteProviderFailureDecision(queueItem, error, 'skip');
            }
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'destination_not_connected', toErrorMessage(error)));
            return markRouteDeliverySyncQueueItemProcessedIfCurrent(queueItem, {
                skippedReason: 'destination_not_connected',
                resultStatus: 'skipped',
            }, 'route_delivery_sync_auth_skip_transition', 'provider authentication skip');
        }

        if (providerSendInProgress && isDestinationPermissionRequiredError(error)) {
            if (isProviderOperationError(error)) {
                logRouteProviderFailureDecision(queueItem, error, 'skip');
            }
            await safelyWriteDeliveryMetadata(() => setSkippedDeliveryMetadata(queueItem, 'destination_permission_required', error.message));
            return markRouteDeliverySyncQueueItemProcessedIfCurrent(queueItem, {
                skippedReason: 'destination_permission_required',
                resultStatus: 'skipped',
            }, 'route_delivery_sync_permission_skip_transition', 'provider permission skip');
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
        if (isDeliveryMetadataPersistenceError(error) && getPersistedProviderAcceptance(queueItem)) {
            logger.warn('[RouteDeliverySync] Retrying delivery metadata persistence without repeating the accepted provider send.', {
                queueItemId: queueItem.id,
                userID: queueItem.userID,
                destinationServiceName: queueItem.destinationServiceName,
                providerRouteId: queueItem.destinationProviderRouteId || null,
            });
            return increaseRouteDeliverySyncRetryCountIfCurrent(
                queueItem,
                normalizedError,
                bulkWriter,
                'ROUTE_DELIVERY_METADATA_PERSIST_FAILED',
            );
        }

        if (providerSendInProgress && isProviderOperationError(error) && error.disposition === 'retryable') {
            await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(queueItem, normalizedError));
            const retryResult = await increaseRouteDeliverySyncRetryCountIfCurrent(
                queueItem,
                normalizedError,
                bulkWriter,
                error.dlqContext || 'DESTINATION_PROVIDER_RETRY_EXHAUSTED',
            );
            logRouteProviderFailureDecision(
                queueItem,
                error,
                retryResult === QueueResult.MovedToDLQ ? 'dlq' : 'retry',
            );
            return retryResult;
        }

        if (!isProviderOperationError(error) && isTransientRouteDeliveryError(error)) {
            await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(queueItem, normalizedError));
            return increaseRouteDeliverySyncRetryCountIfCurrent(
                queueItem,
                normalizedError,
                bulkWriter,
            );
        }

        if (isPermanentRouteSendItemError(error)) {
            await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(queueItem, normalizedError));
            return moveRouteDeliverySyncQueueItemToDlqIfCurrent(
                queueItem,
                normalizedError,
                bulkWriter,
                getDeadLetterContext(error),
            );
        }

        if (providerSendInProgress && isProviderOperationError(error)) {
            logRouteProviderFailureDecision(queueItem, error, 'dlq');
        }

        const dlqContext = (normalizedError as Error & { dlqContext?: string }).dlqContext || getDeadLetterContext(error);
        const failedQueueItem = withDestinationProviderOperationDiagnostics(
            queueItem,
            error,
            dlqContext,
        );
        await safelyWriteDeliveryMetadata(() => setFailedDeliveryMetadata(failedQueueItem, normalizedError));
        return moveRouteDeliverySyncQueueItemToDlqIfCurrent(
            failedQueueItem,
            normalizedError,
            bulkWriter,
            dlqContext,
        );
    }
}
