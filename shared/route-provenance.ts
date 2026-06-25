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
    providerUserId?: string | null;
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
    providerUserId?: string | null;
    status: RouteDeliveryMetadataStatus;
    routeSyncRouteId?: string | null;
    sourceRevisionKey?: string | null;
    providerRouteId?: string | null;
    deliveredAt?: number | Date | null;
    lastAttemptAt?: number | Date | null;
    updatedAt?: number | Date | null;
    skippedReason?: string | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
}

export interface RouteDeliverySummary {
    serviceName: ServiceNames | string;
    providerUserIds?: string[];
    latestProviderUserId?: string | null;
    updatedAt?: number | Date | null;
}

function normalizeRouteProviderUserId(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function getRouteDeliveryMetadataDocId(
    serviceName: ServiceNames | string,
    providerUserId?: string | null,
): string {
    const normalizedProviderUserId = normalizeRouteProviderUserId(providerUserId);
    if (!normalizedProviderUserId) {
        return `${ROUTE_DELIVERY_METADATA_DOC_PREFIX}${serviceName}`;
    }

    return `${ROUTE_DELIVERY_METADATA_DOC_PREFIX}${serviceName}_${encodeURIComponent(normalizedProviderUserId)}`;
}
