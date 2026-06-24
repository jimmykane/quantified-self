import { ServiceNames } from '@sports-alliance/sports-lib';

interface RouteDeliverySourceSummaryRevisionLike {
    providerRouteId?: unknown;
    modifiedAt?: unknown;
    importedAt?: unknown;
}

export interface RouteDeliverySourceRevisionInput {
    providerRouteId: string;
    providerRouteModifiedAt: unknown;
    fallbackUpdatedAt: unknown;
}

export function buildRouteDeliverySourceRevisionKey(parts: {
    sourceServiceName: ServiceNames | string;
    providerRouteId?: string | null;
    providerRouteModifiedAt?: unknown;
    fallbackUpdatedAt?: unknown;
    fallbackRouteID: string;
}): string {
    const modifiedAt = toRevisionPart(parts.providerRouteModifiedAt);
    const fallbackUpdatedAt = toRevisionPart(parts.fallbackUpdatedAt);
    const providerRouteId = `${parts.providerRouteId || ''}`.trim();
    return [
        parts.sourceServiceName,
        providerRouteId || parts.fallbackRouteID,
        modifiedAt || fallbackUpdatedAt || parts.fallbackRouteID,
    ].join(':');
}

export function getRouteDeliverySourceRevisionInput(params: {
    sourceSummary?: RouteDeliverySourceSummaryRevisionLike | null;
    fallbackProviderRouteId?: unknown;
    fallbackProviderRouteModifiedAt?: unknown;
    routeImportedAt?: unknown;
    fallbackRouteID: string;
}): RouteDeliverySourceRevisionInput {
    return {
        providerRouteId: normalizeNonEmptyString(params.sourceSummary?.providerRouteId)
            || normalizeNonEmptyString(params.fallbackProviderRouteId)
            || params.fallbackRouteID,
        providerRouteModifiedAt: params.sourceSummary?.modifiedAt || params.fallbackProviderRouteModifiedAt || null,
        fallbackUpdatedAt: params.sourceSummary?.importedAt || params.routeImportedAt || null,
    };
}

export function buildRouteDeliverySourceRevisionKeyForRouteSource(params: {
    sourceServiceName: ServiceNames | string;
    sourceSummary?: RouteDeliverySourceSummaryRevisionLike | null;
    fallbackProviderRouteId?: unknown;
    fallbackProviderRouteModifiedAt?: unknown;
    routeImportedAt?: unknown;
    fallbackRouteID: string;
}): string {
    const revisionInput = getRouteDeliverySourceRevisionInput(params);
    return buildRouteDeliverySourceRevisionKey({
        sourceServiceName: params.sourceServiceName,
        providerRouteId: revisionInput.providerRouteId,
        providerRouteModifiedAt: revisionInput.providerRouteModifiedAt,
        fallbackUpdatedAt: revisionInput.fallbackUpdatedAt,
        fallbackRouteID: params.fallbackRouteID,
    });
}

function toRevisionPart(value: unknown): string | null {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return `${value.getTime()}`;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${Math.floor(value)}`;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = new Date(value);
        return Number.isFinite(parsed.getTime()) ? `${parsed.getTime()}` : value.trim();
    }
    if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
        const date = (value as { toDate: () => Date }).toDate();
        return Number.isFinite(date.getTime()) ? `${date.getTime()}` : null;
    }
    if (value && typeof value === 'object' && typeof (value as { seconds?: unknown }).seconds === 'number') {
        const seconds = (value as { seconds: number }).seconds;
        return `${seconds * 1000}`;
    }
    return null;
}

function normalizeNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
