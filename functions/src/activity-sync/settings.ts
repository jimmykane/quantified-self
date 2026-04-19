import * as admin from 'firebase-admin';
import { ActivitySyncRouteId } from '../../../shared/activity-sync-routes';

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
