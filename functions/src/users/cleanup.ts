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

    // Cleanup Emails
    try {
        console.log(`[Cleanup] Deleting emails for user ${uid}`);
        const db = admin.firestore();
        const mailCollection = db.collection('mail');
        const batch = db.batch();
        let deletionCount = 0;

        // 1. Query by UID (toUids array)
        const uidSnapshot = await mailCollection.where('toUids', 'array-contains', uid).get();

        // 2. Query by Email (to field) - if email exists
        let emailSnapshot: admin.firestore.QuerySnapshot | null = null;
        if (user.email) {
            emailSnapshot = await mailCollection.where('to', '==', user.email).get();
        }

        const docsToDelete = new Map<string, admin.firestore.DocumentReference>();

        uidSnapshot.docs.forEach(doc => docsToDelete.set(doc.id, doc.ref));
        if (emailSnapshot) {
            emailSnapshot.docs.forEach(doc => docsToDelete.set(doc.id, doc.ref));
        }

        docsToDelete.forEach((ref) => {
            batch.delete(ref);
            deletionCount++;
        });

        if (deletionCount > 0) {
            await batch.commit();
            console.log(`[Cleanup] Deleted ${deletionCount} email documents for user ${uid}`);
        } else {
            console.log(`[Cleanup] No email documents found for user ${uid}`);
        }

    } catch (e) {
        console.error(`[Cleanup] Error deleting emails for ${uid}`, e);
    }

});
