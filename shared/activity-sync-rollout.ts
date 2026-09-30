import { ACTIVITY_SYNC_ROUTE_IDS, ActivityDeliveryRouteId, ActivitySyncRouteId, HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS } from './activity-sync-routes';

export const ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS: Record<ActivitySyncRouteId, ReadonlyArray<string>> = {
    // Empty allowlist disables UID-gating for the route (production-wide rollout).
    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: [],
    [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp]: [],
    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI]: [],
    [ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_WahooAPI]: [],
    [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_WahooAPI]: [],
    [ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp]: [],
    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI]: [],
    [ACTIVITY_SYNC_ROUTE_IDS.SuuntoApp_to_COROSAPI]: [],
    [ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_COROSAPI]: [],
};

export function isActivitySyncRouteUIDAllowlisted(routeId: ActivityDeliveryRouteId, uid: string): boolean {
    const normalizedUID = `${uid || ''}`.trim();
    if (!normalizedUID) {
        return false;
    }

    const allowlist = routeId === HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS.SuuntoApp
        || routeId === HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS.WahooAPI
        || routeId === HISTORICAL_MANUAL_ACTIVITY_ROUTE_IDS.COROSAPI
        ? [] : ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS[routeId as ActivitySyncRouteId];
    if (!Array.isArray(allowlist)) {
        return false;
    }

    if (allowlist.length === 0) {
        return true;
    }

    return allowlist.includes(normalizedUID);
}
