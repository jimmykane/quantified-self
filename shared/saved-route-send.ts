import { ServiceNames } from '@sports-alliance/sports-lib';

export const SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS = 25;
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

export interface SendRoutesToServiceRequest {
    routeIds: string[];
    destinationServiceName: ServiceNames;
    /** User confirmed that an already delivered Suunto route should be copied again. */
    forceCopy?: boolean;
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
