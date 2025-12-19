import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { deauthorizeServiceForUser } from '../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { deauthorizeGarminHealthAPIForUser } from '../garmin/auth/wrapper';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';

/**
 * Disconnects external services (Garmin, Suunto, COROS) for users who have no active pro subscription.
 * Iterates through all connected tokens to ensure strict enforcement.
 */
export const disconnectServicesForNonPro = onSchedule({
    region: 'europe-west2',
    schedule: 'every 24 hours',
}, async (_event) => {
    // 1. Identify all users with ANY connected service
    const userIDs = new Set<string>();

    // Garmin Tokens
    const garminSnapshot = await admin.firestore().collection(GARMIN_HEALTH_API_TOKENS_COLLECTION_NAME).get();
    garminSnapshot.forEach(doc => userIDs.add(doc.id));

    // Suunto Tokens
    const suuntoSnapshot = await admin.firestore().collection(SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME).get();
    suuntoSnapshot.forEach(doc => userIDs.add(doc.id));

    // COROS Tokens
    const corosSnapshot = await admin.firestore().collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME).get();
    corosSnapshot.forEach(doc => userIDs.add(doc.id));

    console.log(`Found ${userIDs.size} users with connected services.`);

    for (const uid of userIDs) {
        // 2. Check for ACTIVE subscription with VALID role
        // We check for 'active' or 'trialing' status AND 'pro' OR 'basic' role.
        const activeSubSnapshot = await admin.firestore().collection(`customers/${uid}/subscriptions`)
            .where('status', 'in', ['active', 'trialing'])
            .where('firebaseRole', 'in', ['pro', 'basic'])
            .limit(1)
            .get();

        if (!activeSubSnapshot.empty) {
            // User has valid subscription, skip
            continue;
        }

        console.log(`Disconnecting services for user ${uid} (No active pro subscription found).`);

        try {
            await deauthorizeServiceForUser(uid, ServiceNames.SuuntoApp);
        } catch (e) {
            console.error(`Error disconnecting Suunto for ${uid}`, e);
        }

        try {
            await deauthorizeServiceForUser(uid, ServiceNames.COROSAPI);
        } catch (e) {
            console.error(`Error disconnecting COROS for ${uid}`, e);
        }

        try {
            await deauthorizeGarminHealthAPIForUser(uid);
        } catch (e) {
            console.error(`Error disconnecting Garmin for ${uid}`, e);
        }
    }
});
