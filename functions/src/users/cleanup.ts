import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { deauthorizeServiceForUser, getServiceConfig } from '../OAuth2';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';

import { ServiceNames } from '@sports-alliance/sports-lib';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';

export const ORPHANED_SERVICE_TOKENS_COLLECTION_NAME = 'orphaned_service_tokens';

/**
 * Helper to delete a token document and its subcollections.
 * Firestore doesn't automatically delete subcollections when you delete a parent document,
 * so we must manually delete the 'tokens' subcollection first.
 */
async function deleteTokenDocumentWithSubcollections(collectionName: string, uid: string): Promise<void> {
    const db = admin.firestore();
    const userDocRef = db.collection(collectionName).doc(uid);

    // Using recursiveDelete to delete the parent document and all its subcollections (e.g. 'tokens')
    await admin.firestore().recursiveDelete(userDocRef);
    logger.info(`[Cleanup] Recursively deleted parent doc and all subcollections for ${collectionName}/${uid}`);
}

/**
 * Archives a token that couldn't be cleanly deauthorized due to service unavailability.
 * This allows the local user deletion to proceed while keeping a record for later retry.
 */
async function archiveOrphanedToken(
    uid: string,
    serviceName: ServiceNames,
    originalTokenId: string,
    tokenData: any,
    error: any
): Promise<void> {
    const db = admin.firestore();
    // Composite ID to prevent duplicates
    const docId = `${serviceName}_${uid}_${originalTokenId}`;

    const now = admin.firestore.Timestamp.now();
    const errorString = error?.message || error?.toString() || 'Unknown Error';

    const archiveData = {
        serviceName,
        uid,
        originalTokenId,
        token: tokenData || {}, // Ensure we save something even if tokenData is partial
        archivedAt: now,
        expireAt: getExpireAtTimestamp(TTL_CONFIG.ORPHANED_TOKEN_IN_DAYS),
        lastError: errorString
    };

    try {
        await db.collection(ORPHANED_SERVICE_TOKENS_COLLECTION_NAME).doc(docId).set(archiveData);
        logger.info(`[Cleanup] Archived orphaned token ${originalTokenId} for ${serviceName} user ${uid} due to error: ${errorString}`);
    } catch (archiveError) {
        logger.error(`[Cleanup] Failed to archive orphaned token ${originalTokenId} for ${uid}`, archiveError);
    }
}

/**
 * Checks for any remaining tokens in the collection. If found, it implies deauthorization failed
 * (or was skipped), so we archive them to 'orphaned_service_tokens' before they get deleted.
 */
async function archiveRemainingTokens(collectionName: string, uid: string, serviceName: ServiceNames): Promise<void> {
    const db = admin.firestore();
    const userDocRef = db.collection(collectionName).doc(uid);
    const tokensSnapshot = await userDocRef.collection('tokens').get();

    if (tokensSnapshot.empty) {
        return;
    }

    logger.warn(`[Cleanup] Found ${tokensSnapshot.size} remaining tokens for ${serviceName} user ${uid} during cleanup. Archiving before deletion.`);

    const archivePromises = tokensSnapshot.docs.map(async (doc) => {
        const tokenData = doc.data();
        const tokenId = doc.id;
        // Construct a synthesized error to indicate why we are archiving
        const errorReason = new Error('Cleanup: Token remained after deauthorization attempts (likely API unavailable or 500/502).');

        return archiveOrphanedToken(uid, serviceName, tokenId, tokenData, errorReason);
    });

    await Promise.all(archivePromises);
}


// Define cleanup configuration for services
interface ServiceCleanupConfig {
    name: string;
    deauthFn: (uid: string) => Promise<void>;
    collectionName: string;
    serviceName: ServiceNames;
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
    } catch (e: unknown) {
        const error = e as Error;
        if (error.name === 'TokenNotFoundError') {
            logger.info(`[Cleanup] No ${config.name} token found for ${uid}, skipping deauthorization.`);
        } else {
            // Log error but continue to forced cleanup
            logger.error(`[Cleanup] Error deauthorizing ${config.name} for ${uid}`, error);
        }
    }

    // 2. Local Cleanup (Mandatory)
    try {
        // Archive any tokens that survived deauthorization (likely due to 500/502 errors)
        await archiveRemainingTokens(config.collectionName, uid, config.serviceName);

        await deleteTokenDocumentWithSubcollections(config.collectionName, uid);
    } catch (e: unknown) {
        logger.error(`[Cleanup] Error deleting ${config.name} tokens for ${uid}`, e as Error);
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
            collectionName: getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName,
            serviceName: ServiceNames.SuuntoApp
        },
        {
            name: 'COROS',
            deauthFn: (id) => deauthorizeServiceForUser(id, ServiceNames.COROSAPI),
            collectionName: getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName,
            serviceName: ServiceNames.COROSAPI
        },
        {
            name: 'Garmin',
            deauthFn: (id) => deauthorizeServiceForUser(id, ServiceNames.GarminAPI),
            collectionName: GARMIN_API_TOKENS_COLLECTION_NAME,
            serviceName: ServiceNames.GarminAPI
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
