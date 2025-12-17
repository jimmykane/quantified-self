import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { deauthorizeServiceForUser } from '../OAuth2';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { deauthorizeGarminHealthAPIForUser } from '../garmin/auth/wrapper';

export const disconnectExpiredServices = functions.region('europe-west2').pubsub.schedule('every 24 hours').onRun(async (context) => {
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 10);

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

    console.log(`Found ${userIDs.size} users with expired subscriptions > 10 days.`);

    for (const uid of userIDs) {
        console.log(`Disconnecting services for user ${uid}`);
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
