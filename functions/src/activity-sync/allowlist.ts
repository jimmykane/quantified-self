import { ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS, isActivitySyncRouteUIDAllowlisted } from '../../../shared/activity-sync-rollout';

export function getActivitySyncRouteAllowlistConfigError(routeId: ActivitySyncRouteId): string | null {
    const routeAllowlist = ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS[routeId];
    if (!Array.isArray(routeAllowlist)) {
        return `Activity sync allowlist for route ${routeId} is not configured.`;
    }

    return null;
}

export function isActivitySyncRouteUserAllowlisted(routeId: ActivitySyncRouteId, userID: string): boolean {
    return isActivitySyncRouteUIDAllowlisted(routeId, userID);
}
