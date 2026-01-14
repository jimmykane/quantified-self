import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { deauthorizeServiceForUser, getServiceConfig } from '../OAuth2';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';

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

// Define cleanup configuration for services
interface ServiceCleanupConfig {
    name: string;
    deauthFn: (uid: string) => Promise<void>;
    collectionName: string;
}

/**
 * Orchestrates the cleanup process:
 * 1. Attempt best-effort deauthorization (api call)
 * 2. Mandatory local token deletion (firestore)
 */
async function safeDeauthorizeAndCleanup(uid: string, config: ServiceCleanupConfig): Promise<void> {
    // 1. Deauthorize (Best Effort)
    try {
        logger.info(`[Cleanup] Deauthorizing ${config.name} for user ${uid}`);
        await config.deauthFn(uid);
    } catch (e: any) {
        if (e.name === 'TokenNotFoundError') {
            logger.info(`[Cleanup] No ${config.name} token found for ${uid}, skipping deauthorization.`);
        } else {
            // Log error but continue to forced cleanup
            logger.error(`[Cleanup] Error deauthorizing ${config.name} for ${uid}`, e);
        }
    }

    // 2. Local Cleanup (Mandatory)
    try {
        await deleteTokenDocumentWithSubcollections(config.collectionName, uid);
    } catch (e: any) {
        logger.error(`[Cleanup] Error deleting ${config.name} tokens for ${uid}`, e);
    }
}

export const cleanupUserAccounts = functions.region('europe-west2').auth.user().onDelete(async (user) => {
    const uid = user.uid;
    logger.info(`[Cleanup] User ${uid} deleted. Starting service deauthorization cleanup.`);

    // Import constants locally to avoid top-level side effects if helpful, 
    // though for these it's fine. Using hardcoded string or importing constant is fine.
    // For Garmin, collection name is 'garminAPITokens' (from constants)
    // For Suunto, getServiceConfig returns it.
    // For COROS, getServiceConfig returns it.

    const services: ServiceCleanupConfig[] = [
        {
            name: 'Suunto',
            deauthFn: (id) => deauthorizeServiceForUser(id, ServiceNames.SuuntoApp),
            collectionName: getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName
        },
        {
            name: 'COROS',
            deauthFn: (id) => deauthorizeServiceForUser(id, ServiceNames.COROSAPI),
            collectionName: getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName
        },
        {
            name: 'Garmin',
            deauthFn: (id) => deauthorizeServiceForUser(id, ServiceNames.GarminAPI),
            collectionName: GARMIN_API_TOKENS_COLLECTION_NAME
        }
    ];

    // Run sequantially to avoid race conditions or overwhelming logs, though parallel is also an option.
    // Sequential is safer for clarity.
    for (const service of services) {
        await safeDeauthorizeAndCleanup(uid, service);
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
