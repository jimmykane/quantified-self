import * as admin from 'firebase-admin';
import { RouteDeliverySyncRouteId } from '../../../shared/route-delivery-sync-routes';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export async function isRouteDeliverySyncRouteEnabledForUser(
    userID: string,
    routeId: RouteDeliverySyncRouteId,
): Promise<boolean> {
    const settingsSnapshot = await admin.firestore()
        .collection('users')
        .doc(userID)
        .collection('config')
        .doc('settings')
        .get();

    const settingsData = asRecord(settingsSnapshot.data());
    const serviceSyncSettings = asRecord(settingsData?.serviceSyncSettings);
    const routeDeliverySyncRoutes = asRecord(serviceSyncSettings?.routeDeliverySyncRoutes);
    const routeSettings = asRecord(routeDeliverySyncRoutes?.[routeId]);
    return routeSettings?.enabled === true;
}
