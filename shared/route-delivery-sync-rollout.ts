import { ROUTE_DELIVERY_SYNC_ROUTE_IDS, RouteDeliverySyncRouteId } from './route-delivery-sync-routes';

export const ROUTE_DELIVERY_SYNC_ROUTE_ALLOWED_UIDS: Record<RouteDeliverySyncRouteId, ReadonlyArray<string>> = {
    // Empty allowlist disables UID-gating for the route (production-wide rollout).
    [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI]: [],
    [ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: [],
};

export function isRouteDeliverySyncRouteUIDAllowlisted(routeId: RouteDeliverySyncRouteId, uid: string): boolean {
    const normalizedUID = `${uid || ''}`.trim();
    if (!normalizedUID) {
        return false;
    }

    const allowlist = ROUTE_DELIVERY_SYNC_ROUTE_ALLOWED_UIDS[routeId];
    if (!Array.isArray(allowlist)) {
        return false;
    }

    if (allowlist.length === 0) {
        return true;
    }

    return allowlist.includes(normalizedUID);
}
