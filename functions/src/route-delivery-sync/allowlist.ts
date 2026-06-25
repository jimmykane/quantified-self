import { RouteDeliverySyncRouteId } from '../../../shared/route-delivery-sync-routes';
import { ROUTE_DELIVERY_SYNC_ROUTE_ALLOWED_UIDS, isRouteDeliverySyncRouteUIDAllowlisted } from '../../../shared/route-delivery-sync-rollout';

export function getRouteDeliverySyncRouteAllowlistConfigError(routeId: RouteDeliverySyncRouteId): string | null {
    const allowlist = ROUTE_DELIVERY_SYNC_ROUTE_ALLOWED_UIDS[routeId];
    if (!Array.isArray(allowlist)) {
        return `Route delivery sync route ${routeId} is missing an allowlist configuration.`;
    }

    return null;
}

export function isRouteDeliverySyncRouteUserAllowlisted(routeId: RouteDeliverySyncRouteId, uid: string): boolean {
    return isRouteDeliverySyncRouteUIDAllowlisted(routeId, uid);
}
