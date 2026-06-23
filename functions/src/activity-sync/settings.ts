import * as admin from 'firebase-admin';
import { ACTIVITY_SYNC_ROUTES, ActivitySyncRouteId } from '../../../shared/activity-sync-routes';
import { isServiceUnavailableForSyncForUser } from '../service-connection-meta';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export async function isActivitySyncRouteEnabledForUser(userID: string, routeId: ActivitySyncRouteId): Promise<boolean> {
    const settingsSnapshot = await admin.firestore()
        .collection('users')
        .doc(userID)
        .collection('config')
        .doc('settings')
        .get();

    const settingsData = asRecord(settingsSnapshot.data());
    const serviceSyncSettings = asRecord(settingsData?.serviceSyncSettings);
    const activitySyncRoutes = asRecord(serviceSyncSettings?.activitySyncRoutes);
    const routeSettings = asRecord(activitySyncRoutes?.[routeId]);
    return routeSettings?.enabled === true;
}

export async function isActivitySyncRouteBlockedByReconnectRequiredForUser(
    userID: string,
    routeId: ActivitySyncRouteId,
): Promise<boolean> {
    const route = ACTIVITY_SYNC_ROUTES[routeId];
    if (!route) {
        return false;
    }

    const serviceNames = Array.from(new Set([
        route.sourceServiceName,
        route.destinationServiceName,
    ]));
    const unavailableChecks = await Promise.all(
        serviceNames.map((serviceName) => isServiceUnavailableForSyncForUser(userID, serviceName)),
    );
    return unavailableChecks.some((unavailable) => unavailable);
}
