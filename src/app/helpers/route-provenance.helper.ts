import { ServiceNames } from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { ROUTE_SOURCE_TYPES, RouteSourceSummary } from '@shared/route-provenance';

export interface RouteProvenanceServiceSummary {
    label: string;
    serviceName: ServiceNames | null;
}

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

function normalizeRouteServiceName(serviceName: string | null | undefined): ServiceNames | null {
    switch (serviceName) {
        case ServiceNames.SuuntoApp:
        case ServiceNames.GarminAPI:
        case ServiceNames.COROSAPI:
            return serviceName;
        default:
            return null;
    }
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
    return getRouteSourceSummary(route).label;
}

export function getRouteSourceSummary(route: FirestoreRouteJSON | null | undefined): RouteProvenanceServiceSummary {
    const sourceSummary = getNormalizedSourceSummary(route);
    if (!sourceSummary) {
        return {
            label: 'Saved route',
            serviceName: null,
        };
    }

    if (sourceSummary.sourceType === ROUTE_SOURCE_TYPES.ServiceSync && sourceSummary.sourceServiceName) {
        return {
            label: `Synced from ${getRouteServiceDisplayName(sourceSummary.sourceServiceName)}`,
            serviceName: normalizeRouteServiceName(sourceSummary.sourceServiceName),
        };
    }

    if (sourceSummary.sourceType === ROUTE_SOURCE_TYPES.ManualUpload) {
        return {
            label: 'Manual upload',
            serviceName: null,
        };
    }

    return {
        label: 'Saved route',
        serviceName: null,
    };
}

export function getRouteSyncedDestinationLabels(route: FirestoreRouteJSON | null | undefined): string[] {
    return getRouteSyncedDestinationSummaries(route).map(summary => summary.label);
}

export function getRouteSyncedDestinationSummaries(route: FirestoreRouteJSON | null | undefined): RouteProvenanceServiceSummary[] {
    if (!Array.isArray(route?.syncedDestinationServiceNames)) {
        return [];
    }

    return Array.from(new Set(
        route.syncedDestinationServiceNames
            .map(serviceName => normalizeNonEmptyString(serviceName))
            .filter((serviceName): serviceName is string => serviceName !== null),
    )).map(serviceName => ({
        label: `Sent to ${getRouteServiceDisplayName(serviceName)}`,
        serviceName: normalizeRouteServiceName(serviceName),
    }));
}

export function isRouteFromService(route: FirestoreRouteJSON | null | undefined, serviceName: string): boolean {
    return getNormalizedSourceSummary(route)?.sourceServiceName === serviceName;
}
