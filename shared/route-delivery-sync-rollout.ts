import { ROUTE_DELIVERY_SYNC_ROUTE_IDS, RouteDeliverySyncRouteId } from './route-delivery-sync-routes';

export const ROUTE_DELIVERY_SYNC_ROUTE_ALLOWED_UIDS: Record<RouteDeliverySyncRouteId, ReadonlyArray<string>> = {
    [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: ['xcsAolLDDTWTgtRN9eYF3lW2YKL2'],
};

export function isRouteDeliverySyncRouteUIDAllowlisted(routeId: RouteDeliverySyncRouteId, uid: string): boolean {
    const normalizedUID = `${uid || ''}`.trim();
    if (!normalizedUID) {
        return false;
    }

    const allowlist = ROUTE_DELIVERY_SYNC_ROUTE_ALLOWED_UIDS[routeId];
    if (!Array.isArray(allowlist) || allowlist.length === 0) {
        return false;
    }

    return allowlist.includes(normalizedUID);
}
