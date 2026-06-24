import { ServiceNames } from '@sports-alliance/sports-lib';

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
