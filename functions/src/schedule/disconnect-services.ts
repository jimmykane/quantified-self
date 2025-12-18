import * as functions from 'firebase-functions/v1';
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
export const disconnectServicesForNonPro = functions.region('europe-west2').pubsub.schedule('every 24 hours').onRun(async (context) => {
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
        // 2. Check for ACTIVE pro subscription
        // We check for 'active' or 'trialing' status AND 'pro' role.
        const activeProSub = await admin.firestore().collection(`customers/${uid}/subscriptions`)
            .where('status', 'in', ['active', 'trialing'])
            .where('role', '==', 'pro')
            .limit(1)
            .get();

        if (!activeProSub.empty) {
            // User has pro, skip
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
