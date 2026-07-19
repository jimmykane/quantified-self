import { ServiceNames } from '@sports-alliance/sports-lib';

export const ACTIVITY_SYNC_ROUTE_IDS = {
    GarminAPI_to_SuuntoApp: 'GarminAPI_to_SuuntoApp',
    COROSAPI_to_SuuntoApp: 'COROSAPI_to_SuuntoApp',
    GarminAPI_to_WahooAPI: 'GarminAPI_to_WahooAPI',
    COROSAPI_to_WahooAPI: 'COROSAPI_to_WahooAPI',
    SuuntoApp_to_WahooAPI: 'SuuntoApp_to_WahooAPI',
} as const;

export type ActivitySyncRouteId = typeof ACTIVITY_SYNC_ROUTE_IDS[keyof typeof ACTIVITY_SYNC_ROUTE_IDS];

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
};

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
