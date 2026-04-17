import { ACTIVITY_SYNC_ROUTE_IDS, ActivitySyncRouteId } from './activity-sync-routes';

export const ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS: Record<ActivitySyncRouteId, ReadonlyArray<string>> = {
    [ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp]: [
        'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
    ],
};

export function isActivitySyncRouteUIDAllowlisted(routeId: ActivitySyncRouteId, uid: string): boolean {
    const normalizedUID = `${uid || ''}`.trim();
    if (!normalizedUID) {
        return false;
    }

    const allowlist = ACTIVITY_SYNC_ROUTE_ALLOWED_UIDS[routeId];
    return Array.isArray(allowlist) && allowlist.includes(normalizedUID);
}

