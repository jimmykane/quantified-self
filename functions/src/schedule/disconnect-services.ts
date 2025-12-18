import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { deauthorizeServiceForUser } from '../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { deauthorizeGarminHealthAPIForUser } from '../garmin/auth/wrapper';

/**
 * Disconnects external services (Garmin, Suunto, COROS) for users who have no active premium subscription
 * and whose last premium subscription ended > 10 days ago.
 */
export const disconnectServicesForNonPremium = functions.region('europe-west2').pubsub.schedule('every 24 hours').onRun(async (context) => {
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 10);

    // 1. Identify users with subscriptions that ended more than 10 days ago
    // query "subscriptions" collection group where ...
    const subscriptionsSnapshot = await admin.firestore().collectionGroup('subscriptions')
        .where('status', 'in', ['canceled', 'unpaid', 'past_due'])
        .where('ended_at', '<', admin.firestore.Timestamp.fromDate(expiredDate))
        .get();

    const userIDs = new Set<string>();
    subscriptionsSnapshot.forEach(doc => {
        const uid = doc.ref.parent.parent?.id; // customers/{uid}/subscriptions/{subId}
        if (uid) {
            userIDs.add(uid);
        }
    });

    console.log(`Found ${userIDs.size} potential users for service disconnection (expired subscription > 10 days).`);

    for (const uid of userIDs) {
        // 2. Safety Check: Verify if the user has ANY active premium subscription
        // We check for 'active' or 'trialing' status AND 'premium' role.
        const activePremiumSub = await admin.firestore().collection(`customers/${uid}/subscriptions`)
            .where('status', 'in', ['active', 'trialing'])
            .where('role', '==', 'premium')
            .limit(1)
            .get();

        if (!activePremiumSub.empty) {
            console.log(`User ${uid} has an active premium subscription. Skipping service disconnection.`);
            continue;
        }

        console.log(`Disconnecting services for user ${uid} (No active premium subscription found).`);

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
