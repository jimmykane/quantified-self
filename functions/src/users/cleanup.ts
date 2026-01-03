import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { deauthorizeServiceForUser, getServiceConfig } from '../OAuth2';
import { deauthorizeGarminHealthAPIForUser } from '../garmin/auth/wrapper';
import { ServiceNames } from '@sports-alliance/sports-lib';

/**
 * Helper to delete a token document and its subcollections.
 * Firestore doesn't automatically delete subcollections when you delete a parent document,
 * so we must manually delete the 'tokens' subcollection first.
 */
async function deleteTokenDocumentWithSubcollections(collectionName: string, uid: string): Promise<void> {
    const db = admin.firestore();
    const userDocRef = db.collection(collectionName).doc(uid);

    // First, delete all documents in the 'tokens' subcollection
    const tokensSnapshot = await userDocRef.collection('tokens').get();
    if (!tokensSnapshot.empty) {
        const batch = db.batch();
        tokensSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        logger.info(`[Cleanup] Deleted ${tokensSnapshot.size} token(s) from ${collectionName}/${uid}/tokens`);
    }

    // Then delete the parent document
    await userDocRef.delete();
    logger.info(`[Cleanup] Deleted parent doc ${collectionName}/${uid}`);
}

export const cleanupUserAccounts = functions.region('europe-west2').auth.user().onDelete(async (user) => {
    const uid = user.uid;
    logger.info(`[Cleanup] User ${uid} deleted. Starting service deauthorization cleanup.`);

    // Deauthorize Suunto
    try {
        logger.info(`[Cleanup] Deauthorizing Suunto for user ${uid}`);
        await deauthorizeServiceForUser(uid, ServiceNames.SuuntoApp);
    } catch (e) {
        logger.error(`[Cleanup] Error deauthorizing Suunto for ${uid}`, e);
    }
    // Always ensure local cleanup happens, even if deauthorization failed or threw
    try {
        const config = getServiceConfig(ServiceNames.SuuntoApp);
        await deleteTokenDocumentWithSubcollections(config.tokenCollectionName, uid);
    } catch (e) {
        logger.error(`[Cleanup] Error deleting Suunto tokens for ${uid}`, e);
    }

    // Deauthorize COROS
    try {
        logger.info(`[Cleanup] Deauthorizing COROS for user ${uid}`);
        await deauthorizeServiceForUser(uid, ServiceNames.COROSAPI);
    } catch (e) {
        logger.error(`[Cleanup] Error deauthorizing COROS for ${uid}`, e);
    }
    // Always ensure local cleanup happens, even if deauthorization failed or threw
    try {
        const config = getServiceConfig(ServiceNames.COROSAPI);
        await deleteTokenDocumentWithSubcollections(config.tokenCollectionName, uid);
    } catch (e) {
        logger.error(`[Cleanup] Error deleting COROS tokens for ${uid}`, e);
    }

    // Deauthorize Garmin
    try {
        logger.info(`[Cleanup] Deauthorizing Garmin for user ${uid}`);
        await deauthorizeGarminHealthAPIForUser(uid);
    } catch (e) {
        logger.error(`[Cleanup] Error disconnecting Garmin for ${uid}`, e);
    }

    logger.info(`[Cleanup] Service deauthorization clean up completed for user ${uid}`);

    // Cleanup Emails
    try {
        logger.info(`[Cleanup] Deleting emails for user ${uid}`);
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
            logger.info(`[Cleanup] Deleted ${deletionCount} email documents for user ${uid}`);
        } else {
            logger.info(`[Cleanup] No email documents found for user ${uid}`);
        }

    } catch (e) {
        logger.error(`[Cleanup] Error deleting emails for ${uid}`, e);
    }

});
