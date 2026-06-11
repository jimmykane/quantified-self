import { ServiceNames } from '@sports-alliance/sports-lib';

export const ROUTE_SOURCE_TYPES = {
    ManualUpload: 'manual_upload',
    ServiceSync: 'service_sync',
} as const;

export type RouteSourceType = typeof ROUTE_SOURCE_TYPES[keyof typeof ROUTE_SOURCE_TYPES];

export const ROUTE_SOURCE_METADATA_DOC_ID = 'source';
export const ROUTE_DELIVERY_METADATA_DOC_PREFIX = 'delivery_';

export type RouteDeliveryMetadataStatus = 'success' | 'failed' | 'skipped';

export interface RouteSourceSummary {
    sourceType: RouteSourceType;
    sourceServiceName?: ServiceNames | string | null;
    providerRouteId?: string | null;
    providerRouteName?: string | null;
    originalFilename?: string | null;
    importedAt?: number | Date | null;
    modifiedAt?: number | Date | null;
}

export interface RouteSourceMetadata extends RouteSourceSummary {
    updatedAt?: number | Date | null;
}

export interface RouteDeliveryMetadata {
    serviceName: ServiceNames | string;
    status: RouteDeliveryMetadataStatus;
    providerRouteId?: string | null;
    deliveredAt?: number | Date | null;
    lastAttemptAt?: number | Date | null;
    updatedAt?: number | Date | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
}

export function getRouteDeliveryMetadataDocId(serviceName: ServiceNames | string): string {
    return `${ROUTE_DELIVERY_METADATA_DOC_PREFIX}${serviceName}`;
}

