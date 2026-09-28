import { ServiceNames } from '@sports-alliance/sports-lib';

export const ACTIVITY_SYNC_ROUTE_IDS = {
    GarminAPI_to_SuuntoApp: 'GarminAPI_to_SuuntoApp',
    COROSAPI_to_SuuntoApp: 'COROSAPI_to_SuuntoApp',
    GarminAPI_to_WahooAPI: 'GarminAPI_to_WahooAPI',
    COROSAPI_to_WahooAPI: 'COROSAPI_to_WahooAPI',
    SuuntoApp_to_WahooAPI: 'SuuntoApp_to_WahooAPI',
    WahooAPI_to_SuuntoApp: 'WahooAPI_to_SuuntoApp',
    GarminAPI_to_COROSAPI: 'GarminAPI_to_COROSAPI',
    SuuntoApp_to_COROSAPI: 'SuuntoApp_to_COROSAPI',
    WahooAPI_to_COROSAPI: 'WahooAPI_to_COROSAPI',
} as const;

export type ActivitySyncRouteId = typeof ACTIVITY_SYNC_ROUTE_IDS[keyof typeof ACTIVITY_SYNC_ROUTE_IDS];

/** One-time uploads are delivery routes, never automatic sync settings. */
export const HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS = {
    SuuntoApp: 'ManualUpload_to_SuuntoApp',
    WahooAPI: 'ManualUpload_to_WahooAPI',
    COROSAPI: 'ManualUpload_to_COROSAPI',
} as const;

export type HistoricalManualActivityRouteId = typeof HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS[keyof typeof HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS];
export type ActivityDeliveryRouteId = ActivitySyncRouteId | HistoricalManualActivityRouteId;
export type ActivityDeliverySource = ServiceNames | 'manualUpload';

export interface ActivitySyncRoute {
    id: ActivitySyncRouteId;
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    supportedFileExtensions: string[];
}

export const ACTIVITY_SYNC_ROUTES: Record<ActivitySyncRouteId, ActivitySyncRoute> = {
    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: {
        id: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
        sourceServiceName: ServiceNames.GarminAPI,
        destinationServiceName: ServiceNames.SuuntoApp,
        supportedFileExtensions: ['fit'],
    },
    [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: {
        id: ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp,
        sourceServiceName: ServiceNames.COROSAPI,
        destinationServiceName: ServiceNames.SuuntoApp,
        supportedFileExtensions: ['fit'],
    },
    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI]: {
        id: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
        sourceServiceName: ServiceNames.GarminAPI,
        destinationServiceName: ServiceNames.WahooAPI,
        supportedFileExtensions: ['fit'],
    },
    [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI]: {
        id: ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI,
        sourceServiceName: ServiceNames.COROSAPI,
        destinationServiceName: ServiceNames.WahooAPI,
        supportedFileExtensions: ['fit'],
    },
    [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: {
        id: ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
        sourceServiceName: ServiceNames.SuuntoApp,
        destinationServiceName: ServiceNames.WahooAPI,
        supportedFileExtensions: ['fit'],
    },
    [ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp]: {
        id: ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp,
        sourceServiceName: ServiceNames.WahooAPI,
        destinationServiceName: ServiceNames.SuuntoApp,
        supportedFileExtensions: ['fit'],
    },
    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI]: {
        id: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI,
        sourceServiceName: ServiceNames.GarminAPI,
        destinationServiceName: ServiceNames.COROSAPI,
        supportedFileExtensions: ['fit'],
    },
    [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: {
        id: ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI,
        sourceServiceName: ServiceNames.SuuntoApp,
        destinationServiceName: ServiceNames.COROSAPI,
        supportedFileExtensions: ['fit'],
    },
    [ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_COROSAPI]: {
        id: ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_COROSAPI,
        sourceServiceName: ServiceNames.WahooAPI,
        destinationServiceName: ServiceNames.COROSAPI,
        supportedFileExtensions: ['fit'],
    },
};

export const HISTORICAL_MANUAL_ACTIVITY_ROUTES: Record<HistoricalManualActivityRouteId, {
    id: HistoricalManualActivityRouteId;
    sourceServiceName: 'manualUpload';
    destinationServiceName: ServiceNames;
    supportedFileExtensions: readonly string[];
}> = {
    [HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS.SuuntoApp]: {
        id: HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS.SuuntoApp,
        sourceServiceName: 'manualUpload',
        destinationServiceName: ServiceNames.SuuntoApp,
        supportedFileExtensions: ['fit', 'fit.gz'],
    },
    [HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS.WahooAPI]: {
        id: HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS.WahooAPI,
        sourceServiceName: 'manualUpload',
        destinationServiceName: ServiceNames.WahooAPI,
        supportedFileExtensions: ['fit', 'fit.gz'],
    },
    [HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS.COROSAPI]: {
        id: HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS.COROSAPI,
        sourceServiceName: 'manualUpload',
        destinationServiceName: ServiceNames.COROSAPI,
        supportedFileExtensions: ['fit', 'fit.gz'],
    },
};

export function getActivityDeliveryRoute(routeId: ActivityDeliveryRouteId) {
    return ACTIVITY_SYNC_ROUTES[routeId as ActivitySyncRouteId]
        || HISTORICAL_MANUAL_ACTIVITY_ROUTES[routeId as HistoricalManualActivityRouteId]
        || null;
}

export function getHistoricalActivityRouteId(source: ActivityDeliverySource, destination: ServiceNames): ActivityDeliveryRouteId | null {
    if (source === 'manualUpload') {
        return Object.values(HISTORICAL_MANUAL_ACTIVITY_ROUTES).find(route => route.destinationServiceName === destination)?.id || null;
    }
    return getActivitySyncRouteId(source, destination);
}

export function getActivitySyncRouteId(
    sourceServiceName: ServiceNames,
    destinationServiceName: ServiceNames,
): ActivitySyncRouteId | null {
    for (const route of Object.values(ACTIVITY_SYNC_ROUTES)) {
        if (route.sourceServiceName === sourceServiceName && route.destinationServiceName === destinationServiceName) {
            return route.id;
        }
    }

    return null;
}
