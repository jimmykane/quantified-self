import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { deauthorizeServiceForUser, getServiceConfig } from '../OAuth2';
import { deauthorizeGarminHealthAPIForUser } from '../garmin/auth/wrapper';
import { ServiceNames } from '@sports-alliance/sports-lib';

export const cleanupUserAccounts = functions.region('europe-west2').auth.user().onDelete(async (user) => {
    const uid = user.uid;
    console.log(`[Cleanup] User ${uid} deleted. Starting service deauthorization cleanup.`);

    // Deauthorize Suunto
    try {
        console.log(`[Cleanup] Deauthorizing Suunto for user ${uid}`);
        await deauthorizeServiceForUser(uid, ServiceNames.SuuntoApp);
        const config = getServiceConfig(ServiceNames.SuuntoApp);
        await admin.firestore().collection(config.tokenCollectionName).doc(uid).delete();
        console.log(`[Cleanup] Deleted Suunto parent doc for user ${uid}`);
    } catch (e) {
        console.error(`[Cleanup] Error disconnecting Suunto for ${uid}`, e);
    }

    // Deauthorize COROS
    try {
        console.log(`[Cleanup] Deauthorizing COROS for user ${uid}`);
        await deauthorizeServiceForUser(uid, ServiceNames.COROSAPI);
        const config = getServiceConfig(ServiceNames.COROSAPI);
        await admin.firestore().collection(config.tokenCollectionName).doc(uid).delete();
        console.log(`[Cleanup] Deleted COROS parent doc for user ${uid}`);
    } catch (e) {
        console.error(`[Cleanup] Error disconnecting COROS for ${uid}`, e);
    }

    // Deauthorize Garmin
    try {
        console.log(`[Cleanup] Deauthorizing Garmin for user ${uid}`);
        await deauthorizeGarminHealthAPIForUser(uid);
    } catch (e) {
        console.error(`[Cleanup] Error disconnecting Garmin for ${uid}`, e);
    }

    console.log(`[Cleanup] Service deauthorization clean up completed for user ${uid}`);
});
