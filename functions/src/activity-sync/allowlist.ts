import { ActivityDeliveryRouteId, ActivitySyncRouteId, HISTORICAL_MANUAL_ACTIVITY_ROUTES } from '../../../shared/activity-sync-routes';
import { ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS, isActivitySyncRouteUIDAllowlisted } from '../../../shared/activity-sync-rollout';

export function getActivitySyncRouteAllowlistConfigError(routeId: ActivityDeliveryRouteId): string | null {
    if (routeId in HISTORICAL_MANUAL_ACTIVITY_ROUTES) return null;
    const routeAllowlist = ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS[routeId as ActivitySyncRouteId];
    if (!Array.isArray(routeAllowlist)) {
        return `Activity sync allowlist for route ${routeId} is not configured.`;
    }

    return null;
}

export function isActivitySyncRouteUserAllowlisted(routeId: ActivityDeliveryRouteId, userID: string): boolean {
    return isActivitySyncRouteUIDAllowlisted(routeId, userID);
}
