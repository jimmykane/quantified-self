import { ServiceNames } from '@sports-alliance/sports-lib';
import { isPushId } from './web-push';

export const SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS = 25;
export const ROUTE_SEND_NOTIFICATION_MAX_ROUTES = 10000;
export interface RouteSendNotificationRequest {
    requestId: string;
    createdAtMs: number;
    totalRoutes: number;
    chunkIndex: number;
}
/** Notification metadata never grants provider consent or reports client-calculated success. */
export function isRouteSendNotificationRequest(value: unknown, chunkSize: number,
    batchChunkSize = SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS): value is RouteSendNotificationRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const row = value as RouteSendNotificationRequest;
    return Object.keys(row).length === 4 && isPushId(row.requestId)
        && Number.isSafeInteger(row.createdAtMs) && row.createdAtMs > 0
        && Number.isSafeInteger(row.totalRoutes) && row.totalRoutes > 0 && row.totalRoutes <= ROUTE_SEND_NOTIFICATION_MAX_ROUTES
        && Number.isSafeInteger(row.chunkIndex) && row.chunkIndex >= 0
        && row.chunkIndex < Math.ceil(row.totalRoutes / batchChunkSize)
        && chunkSize === Math.min(batchChunkSize, row.totalRoutes - row.chunkIndex * batchChunkSize);
}
export function createRouteSendNotificationRequest(totalRoutes: number): Omit<RouteSendNotificationRequest, 'chunkIndex'> | undefined {
    if (!Number.isSafeInteger(totalRoutes) || totalRoutes < 1 || totalRoutes > ROUTE_SEND_NOTIFICATION_MAX_ROUTES) return;
    try {
        const requestId = globalThis.crypto?.randomUUID?.();
        if (requestId) return { requestId, createdAtMs: Date.now(), totalRoutes };
    } catch { /* Notification support must not prevent a route send. */ }
    return;
}
export const GARMIN_DELIVERY_METADATA_PERSIST_FAILURE_MESSAGE = 'Route was sent to Garmin Connect, but Quantified Self could not save the resend state. Check Garmin Connect before retrying this route.';
export const GARMIN_DELIVERY_METADATA_ABORT_MESSAGE = 'Sending stopped before this route because Quantified Self could not save the Garmin resend state for an earlier route. Retry the remaining routes.';

function getRouteDeliveryDestinationLabel(destinationServiceName: ServiceNames): string {
    switch (destinationServiceName) {
        case ServiceNames.GarminAPI:
            return 'Garmin Connect';
        case ServiceNames.SuuntoApp:
            return 'Suunto';
        case ServiceNames.WahooAPI:
            return 'Wahoo';
        case ServiceNames.COROSAPI:
            return 'COROS';
        default:
            return `${destinationServiceName}`;
    }
}

export function getRouteDeliveryMetadataPersistenceFailureMessage(
    destinationServiceName: ServiceNames,
): string {
    if (destinationServiceName === ServiceNames.GarminAPI) {
        return GARMIN_DELIVERY_METADATA_PERSIST_FAILURE_MESSAGE;
    }
    const destinationLabel = getRouteDeliveryDestinationLabel(destinationServiceName);
    return `Route was sent to ${destinationLabel}, but Quantified Self could not save its delivery state. Check ${destinationLabel} before retrying this route.`;
}

export function getRouteDeliveryMetadataAbortMessage(destinationServiceName: ServiceNames): string {
    if (destinationServiceName === ServiceNames.GarminAPI) {
        return GARMIN_DELIVERY_METADATA_ABORT_MESSAGE;
    }
    const destinationLabel = getRouteDeliveryDestinationLabel(destinationServiceName);
    return `Sending stopped before this route because Quantified Self could not save the ${destinationLabel} delivery state for an earlier route. Retry the remaining routes.`;
}

export type SendRoutesToServiceStatus = 'success' | 'partial_success' | 'failure';
export type SendRouteToServiceItemStatus = 'success' | 'failure' | 'skipped';
export type SendRouteToServiceFailureReason =
    | 'NO_ORIGINAL_FILES'
    | 'NOT_FOUND'
    | 'PARSE_FAILED'
    | 'SOURCE_FILE_UNAVAILABLE'
    | 'SOURCE_SERVICE_BLOCKED'
    | 'ACCOUNT_DELETION_IN_PROGRESS'
    | 'ACCOUNT_STATE_UNAVAILABLE'
    | 'DESTINATION_AUTH_REQUIRED'
    | 'DESTINATION_PERMISSION_REQUIRED'
    | 'DELIVERY_METADATA_PERSIST_FAILED'
    | 'SEND_REQUEST_FAILED'
    | 'PROVIDER_ERROR'
    | 'UNSUPPORTED_DESTINATION';

export const TERMINAL_IN_BAND_ROUTE_SEND_REASONS: readonly SendRouteToServiceFailureReason[] = [
    'ACCOUNT_DELETION_IN_PROGRESS', 'ACCOUNT_STATE_UNAVAILABLE', 'DESTINATION_AUTH_REQUIRED',
    'DESTINATION_PERMISSION_REQUIRED', 'DELIVERY_METADATA_PERSIST_FAILED',
];

export interface SendRoutesToServiceRequest {
    routeIds: string[];
    destinationServiceName: ServiceNames;
    /** User confirmed that an already delivered Suunto route should be copied again. */
    forceCopy?: boolean;
    notification?: RouteSendNotificationRequest;
}

export interface SendRouteToServiceItemResult {
    routeId: string;
    destinationServiceName: ServiceNames;
    status: SendRouteToServiceItemStatus;
    reason?: SendRouteToServiceFailureReason;
    message?: string;
    providerRouteId?: string;
}

export interface SendRoutesToServiceResponse {
    destinationServiceName: ServiceNames;
    status: SendRoutesToServiceStatus;
    routeCount: number;
    successCount: number;
    failureCount: number;
    skippedCount: number;
    results: SendRouteToServiceItemResult[];
}
