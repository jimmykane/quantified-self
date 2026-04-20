import { ACTIVITY_SYNC_ROUTE_IDS, ActivitySyncRouteId } from './activity-sync-routes';

export const ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS: Record<ActivitySyncRouteId, ReadonlyArray<string>> = {
    // Empty allowlist disables UID-gating for the route (production-wide rollout).
    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: [],
    [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: [],
};

export function isActivitySyncRouteUIDAllowlisted(routeId: ActivitySyncRouteId, uid: string): boolean {
    const normalizedUID = `${uid || ''}`.trim();
    if (!normalizedUID) {
        return false;
    }

    const allowlist = ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS[routeId];
    if (!Array.isArray(allowlist)) {
        return false;
    }

    if (allowlist.length === 0) {
        return true;
    }

    return allowlist.includes(normalizedUID);
}
