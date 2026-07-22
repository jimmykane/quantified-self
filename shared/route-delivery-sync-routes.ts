import { ServiceNames } from '@sports-alliance/sports-lib';

export const ROUTE_DELIVERY_SYNC_ROUTE_IDS = {
    SuuntoApp_to_GarminAPI: 'SuuntoApp_to_GarminAPI',
    SuuntoApp_to_WahooAPI: 'SuuntoApp_to_WahooAPI',
} as const;

export type RouteDeliverySyncRouteId = typeof ROUTE_DELIVERY_SYNC_ROUTE_IDS[keyof typeof ROUTE_DELIVERY_SYNC_ROUTE_IDS];

export interface RouteDeliverySyncRoute {
    id: RouteDeliverySyncRouteId;
    sourceServiceName: ServiceNames;
    destinationServiceName: ServiceNames;
    destinationRequiredPermissions: string[];
}

export const ROUTE_DELIVERY_SYNC_ROUTES: Record<RouteDeliverySyncRouteId, RouteDeliverySyncRoute> = {
    [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: {
        id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
        sourceServiceName: ServiceNames.SuuntoApp,
        destinationServiceName: ServiceNames.GarminAPI,
        destinationRequiredPermissions: ['COURSE_IMPORT'],
    },
    [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: {
        id: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI,
        sourceServiceName: ServiceNames.SuuntoApp,
        destinationServiceName: ServiceNames.WahooAPI,
        destinationRequiredPermissions: ['routes_read', 'routes_write'],
    },
};

export function getRouteDeliverySyncRouteId(
    sourceServiceName: ServiceNames,
    destinationServiceName: ServiceNames,
): RouteDeliverySyncRouteId | null {
    for (const route of Object.values(ROUTE_DELIVERY_SYNC_ROUTES)) {
        if (route.sourceServiceName === sourceServiceName && route.destinationServiceName === destinationServiceName) {
            return route.id;
        }
    }

    return null;
}
