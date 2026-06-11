import { ServiceNames } from '@sports-alliance/sports-lib';

export const SEND_ROUTES_TO_SERVICE_MAX_ROUTE_IDS = 25;

export type SendRoutesToServiceStatus = 'success' | 'partial_success' | 'failure';
export type SendRouteToServiceItemStatus = 'success' | 'failure' | 'skipped';
export type SendRouteToServiceFailureReason =
    | 'NO_ORIGINAL_FILES'
    | 'NOT_FOUND'
    | 'PARSE_FAILED'
    | 'SOURCE_FILE_UNAVAILABLE'
    | 'SEND_REQUEST_FAILED'
    | 'PROVIDER_ERROR'
    | 'UNSUPPORTED_DESTINATION';

export interface SendRoutesToServiceRequest {
    routeIds: string[];
    destinationServiceName: ServiceNames;
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
