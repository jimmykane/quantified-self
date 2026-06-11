import { ServiceNames } from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { ROUTE_SOURCE_TYPES, RouteSourceSummary } from '@shared/route-provenance';

function normalizeNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNormalizedSourceSummary(route: FirestoreRouteJSON | null | undefined): RouteSourceSummary | null {
    if (!route?.sourceSummary || typeof route.sourceSummary !== 'object' || Array.isArray(route.sourceSummary)) {
        return null;
    }

    const sourceSummary = route.sourceSummary as RouteSourceSummary;
    return normalizeNonEmptyString(sourceSummary.sourceType) ? sourceSummary : null;
}

export function getRouteServiceDisplayName(serviceName: string | null | undefined): string {
    switch (serviceName) {
        case ServiceNames.SuuntoApp:
            return 'Suunto';
        case ServiceNames.GarminAPI:
            return 'Garmin';
        case ServiceNames.COROSAPI:
            return 'COROS';
        default: {
            const normalized = normalizeNonEmptyString(serviceName);
            if (!normalized) {
                return 'service';
            }
            return normalized
                .replace(/\bAPI\b/gi, '')
                .replace(/\bApp\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
        }
    }
}

export function getRouteSourceSummaryLabel(route: FirestoreRouteJSON | null | undefined): string {
    const sourceSummary = getNormalizedSourceSummary(route);
    if (!sourceSummary) {
        return 'Saved route';
    }

    if (sourceSummary.sourceType === ROUTE_SOURCE_TYPES.ServiceSync && sourceSummary.sourceServiceName) {
        return `Synced from ${getRouteServiceDisplayName(sourceSummary.sourceServiceName)}`;
    }

    if (sourceSummary.sourceType === ROUTE_SOURCE_TYPES.ManualUpload) {
        return 'Manual upload';
    }

    return 'Saved route';
}

export function getRouteSyncedDestinationLabels(route: FirestoreRouteJSON | null | undefined): string[] {
    if (!Array.isArray(route?.syncedDestinationServiceNames)) {
        return [];
    }

    return Array.from(new Set(
        route.syncedDestinationServiceNames
            .map(serviceName => normalizeNonEmptyString(serviceName))
            .filter((serviceName): serviceName is string => serviceName !== null),
    )).map(serviceName => `Sent to ${getRouteServiceDisplayName(serviceName)}`);
}

export function isRouteFromService(route: FirestoreRouteJSON | null | undefined, serviceName: string): boolean {
    return getNormalizedSourceSummary(route)?.sourceServiceName === serviceName;
}
