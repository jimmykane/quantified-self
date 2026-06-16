import { ServiceNames } from '@sports-alliance/sports-lib';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { ROUTE_SOURCE_TYPES, RouteDeliverySummary, RouteSourceSummary } from '@shared/route-provenance';
import type { GarminRouteSendContext, GarminRouteSendProviderState } from '../services/app.user.service';
import { getProviderDisplayName, ProviderPresentation } from '@shared/provider-presentation';
import {
    buildDestinationProviderPresentation,
    buildSourceProviderPresentation,
} from './provider-presentation.helper';

export interface RouteProvenanceServiceSummary {
    label: string;
    serviceName: ServiceNames | null;
    presentation: ProviderPresentation | null;
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

function getNormalizedDeliverySummaries(route: FirestoreRouteJSON | null | undefined): RouteDeliverySummary[] {
    if (!Array.isArray(route?.deliverySummaries)) {
        return [];
    }

    return route.deliverySummaries
        .filter((summary): summary is RouteDeliverySummary => !!summary && typeof summary === 'object' && !Array.isArray(summary))
        .filter(summary => normalizeNonEmptyString(summary.serviceName) !== null);
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
    return getProviderDisplayName(serviceName, 'source');
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
            presentation: null,
        };
    }

    if (sourceSummary.sourceType === ROUTE_SOURCE_TYPES.ServiceSync && sourceSummary.sourceServiceName) {
        const serviceName = normalizeRouteServiceName(sourceSummary.sourceServiceName);
        const presentation = buildSourceProviderPresentation(serviceName);
        const displayLabel = presentation?.displayLabel || getRouteServiceDisplayName(sourceSummary.sourceServiceName);
        return {
            label: `Synced from ${displayLabel}`,
            serviceName,
            presentation,
        };
    }

    if (sourceSummary.sourceType === ROUTE_SOURCE_TYPES.ManualUpload) {
        return {
            label: 'Manual upload',
            serviceName: null,
            presentation: null,
        };
    }

    return {
        label: 'Saved route',
        serviceName: null,
        presentation: null,
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
    )).map(serviceName => {
        const normalizedServiceName = normalizeRouteServiceName(serviceName);
        const presentation = buildDestinationProviderPresentation(normalizedServiceName);
        const displayLabel = presentation?.displayLabel || getProviderDisplayName(serviceName, 'destination');
        return {
            label: `Sent to ${displayLabel}`,
            serviceName: normalizedServiceName,
            presentation,
        };
    });
}

export function getRouteDeliverySummaryForService(
    route: FirestoreRouteJSON | null | undefined,
    serviceName: ServiceNames | string,
): RouteDeliverySummary | null {
    return getNormalizedDeliverySummaries(route)
        .find(summary => normalizeNonEmptyString(summary.serviceName) === serviceName)
        || null;
}

export function getRouteLatestDeliveryProviderUserId(
    route: FirestoreRouteJSON | null | undefined,
    serviceName: ServiceNames | string,
): string | null {
    const deliverySummary = getRouteDeliverySummaryForService(route, serviceName);
    const latestProviderUserId = normalizeNonEmptyString(deliverySummary?.latestProviderUserId);
    if (latestProviderUserId) {
        return latestProviderUserId;
    }

    const providerUserIds = Array.isArray(deliverySummary?.providerUserIds)
        ? deliverySummary.providerUserIds
            .map(providerUserId => normalizeNonEmptyString(providerUserId))
            .filter((providerUserId): providerUserId is string => providerUserId !== null)
        : [];

    return providerUserIds[0] || null;
}

function getGarminProviderState(
    context: GarminRouteSendContext,
    providerUserId: string,
): GarminRouteSendProviderState | null {
    return context.providerStates.find(providerState => providerState.providerUserId === providerUserId) || null;
}

export function getGarminRouteSendDisabledReason(
    route: FirestoreRouteJSON | null | undefined,
    context: GarminRouteSendContext,
): string | null {
    const targetProviderUserId = getRouteLatestDeliveryProviderUserId(route, ServiceNames.GarminAPI);
    if (!targetProviderUserId) {
        return null;
    }

    const providerState = getGarminProviderState(context, targetProviderUserId);
    if (!providerState) {
        return 'Reconnect the Garmin account previously used for this route before sending it again.';
    }
    if (!providerState.permissionsLoaded) {
        return 'Checking Garmin permissions for the Garmin account previously used for this route.';
    }
    if (providerState.missingPermissions.includes('COURSE_IMPORT')) {
        return 'Grant Garmin Course Import permission for the Garmin account previously used for this route, then reconnect before sending routes.';
    }

    return null;
}

export function getGarminRouteSendMenuLabel(disabledReason: string | null): string {
    if (!disabledReason) {
        return 'Garmin';
    }
    if (/course import/i.test(disabledReason)) {
        return 'Garmin (Course Import required)';
    }
    if (/checking garmin permissions/i.test(disabledReason)) {
        return 'Garmin (checking permissions)';
    }
    if (/previously used for this route/i.test(disabledReason)) {
        return 'Garmin (reconnect original account)';
    }

    return 'Garmin';
}

export function canSendRouteToConnectedGarminAccount(
    route: FirestoreRouteJSON | null | undefined,
    context: GarminRouteSendContext,
): boolean {
    if (!context.connected || context.reconnectRequired) {
        return false;
    }

    const routeSpecificDisabledReason = getGarminRouteSendDisabledReason(route, context);
    if (routeSpecificDisabledReason) {
        return false;
    }

    return context.missingPermissions.length === 0;
}

export function isRouteFromService(route: FirestoreRouteJSON | null | undefined, serviceName: string): boolean {
    return getNormalizedSourceSummary(route)?.sourceServiceName === serviceName;
}

export function canSendRouteToConnectedSuuntoAccounts(
    route: FirestoreRouteJSON | null | undefined,
    connectedProviderUserIds: readonly string[],
): boolean {
    const sourceSummary = getNormalizedSourceSummary(route);
    if (sourceSummary?.sourceServiceName !== ServiceNames.SuuntoApp) {
        return true;
    }

    const sourceProviderUserId = normalizeNonEmptyString(sourceSummary.providerUserId);
    if (!sourceProviderUserId) {
        return false;
    }

    return connectedProviderUserIds
        .map(providerUserId => normalizeNonEmptyString(providerUserId))
        .some((providerUserId): providerUserId is string => (
            providerUserId !== null && providerUserId !== sourceProviderUserId
        ));
}
