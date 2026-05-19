import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { deauthorizeServiceForUser, getServiceConfig } from '../OAuth2';
import { GARMIN_API_TOKENS_COLLECTION_NAME, GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../garmin/constants';

import { ServiceNames } from '@sports-alliance/sports-lib';
import { DERIVED_METRICS_COLLECTION_ID } from '../../../shared/derived-metrics';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../coros/constants';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';

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
async function archiveRemainingTokens(collectionName: string, uid: string, serviceName: ServiceNames, originalError?: Error): Promise<void> {
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
        // Construct a synthesized error to indicate why we are archiving, unless we have the original error
        const errorReason = originalError || new Error('Cleanup: Token remained after deauthorization attempts (likely API unavailable or 500/502).');

        return archiveOrphanedToken(uid, serviceName, tokenId, tokenData, errorReason);
    });

    await Promise.all(archivePromises);
}


// Define cleanup configuration for services
interface ServiceCleanupConfig {
    name: string;
    deauthFn: (uid: string) => Promise<unknown>;
    collectionName: string;
    serviceName: ServiceNames;
}

interface UserProviderIdentifiers {
    suuntoUserNames: Set<string>;
    corosOpenIds: Set<string>;
    garminUserIDs: Set<string>;
}

function asNonEmptyString(value: unknown): string | null {
    const normalized = `${value || ''}`.trim();
    return normalized.length > 0 ? normalized : null;
}

function addProviderIdentifier(
    identifiers: UserProviderIdentifiers,
    serviceName: unknown,
    providerUserID: unknown,
): void {
    const serviceNameValue = asNonEmptyString(serviceName);
    const providerUserIDValue = asNonEmptyString(providerUserID);
    if (!serviceNameValue || !providerUserIDValue) {
        return;
    }

    switch (serviceNameValue) {
        case ServiceNames.SuuntoApp:
            identifiers.suuntoUserNames.add(providerUserIDValue);
            break;
        case ServiceNames.COROSAPI:
            identifiers.corosOpenIds.add(providerUserIDValue);
            break;
        case ServiceNames.GarminAPI:
            identifiers.garminUserIDs.add(providerUserIDValue);
            break;
        default:
            break;
    }
}

function addProviderIdentifiersFromTokenData(
    identifiers: UserProviderIdentifiers,
    serviceName: ServiceNames,
    tokenData: Record<string, unknown>,
): void {
    switch (serviceName) {
        case ServiceNames.SuuntoApp:
            addProviderIdentifier(identifiers, serviceName, tokenData.userName);
            break;
        case ServiceNames.COROSAPI:
            addProviderIdentifier(identifiers, serviceName, tokenData.openId);
            break;
        case ServiceNames.GarminAPI:
            addProviderIdentifier(identifiers, serviceName, tokenData.userID);
            break;
        default:
            break;
    }
}

function serviceNameFromSleepProvider(provider: unknown): ServiceNames | null {
    const providerValue = asNonEmptyString(provider);
    switch (providerValue) {
        case SLEEP_PROVIDERS.SuuntoApp:
        case ServiceNames.SuuntoApp:
            return ServiceNames.SuuntoApp;
        case SLEEP_PROVIDERS.COROSAPI:
        case ServiceNames.COROSAPI:
            return ServiceNames.COROSAPI;
        case SLEEP_PROVIDERS.GarminAPI:
        case ServiceNames.GarminAPI:
            return ServiceNames.GarminAPI;
        default:
            return null;
    }
}

async function collectProviderIdentifiersForUser(uid: string, services: readonly ServiceCleanupConfig[]): Promise<UserProviderIdentifiers> {
    const identifiers: UserProviderIdentifiers = {
        suuntoUserNames: new Set<string>(),
        corosOpenIds: new Set<string>(),
        garminUserIDs: new Set<string>(),
    };
    const db = admin.firestore();

    for (const service of services) {
        try {
            const snapshot = await db.collection(service.collectionName).doc(uid).collection('tokens').get();
            snapshot.docs.forEach((doc) => {
                const tokenData = doc.data() || {};
                addProviderIdentifiersFromTokenData(identifiers, service.serviceName, tokenData);
            });
        } catch (error) {
            logger.error(`[Cleanup] Failed to collect provider identifiers for ${service.name} user ${uid}`, error);
        }
    }

    return identifiers;
}

async function collectArchivedProviderIdentifiersForUser(uid: string, identifiers: UserProviderIdentifiers): Promise<void> {
    try {
        const snapshot = await admin.firestore()
            .collection(ORPHANED_SERVICE_TOKENS_COLLECTION_NAME)
            .where('uid', '==', uid)
            .get();
        getSnapshotDocs(snapshot).forEach((doc) => {
            const data = doc.data() as Record<string, unknown>;
            const serviceName = data.serviceName as ServiceNames;
            const tokenData = data.token && typeof data.token === 'object'
                ? data.token as Record<string, unknown>
                : {};
            addProviderIdentifiersFromTokenData(identifiers, serviceName, tokenData);
        });
    } catch (error) {
        logger.error(`[Cleanup] Failed to collect archived provider identifiers for user ${uid}`, error);
    }
}

/**
 * Orchestrates the cleanup process:
 * 1. Attempt best-effort deauthorization (api call)
 * 2. Mandatory local token deletion (firestore)
 */
async function safeDeauthorizeAndCleanup(uid: string, config: ServiceCleanupConfig): Promise<void> {
    let deauthError: Error | undefined;

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
            deauthError = error;
        }
    }

    // 2. Local Cleanup (Mandatory)
    try {
        // Archive any tokens that survived deauthorization (likely due to 500/502 errors)
        await archiveRemainingTokens(config.collectionName, uid, config.serviceName, deauthError);

        await deleteTokenDocumentWithSubcollections(config.collectionName, uid);
    } catch (e: unknown) {
        logger.error(`[Cleanup] Error deleting ${config.name} tokens for ${uid}`, e as Error);
    }
}

async function cleanupUserScopedGeneratedState(uid: string): Promise<void> {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const cleanupTargets = [
        { label: 'derived metrics', ref: userRef.collection(DERIVED_METRICS_COLLECTION_ID) },
    ];

    for (const target of cleanupTargets) {
        try {
            await db.recursiveDelete(target.ref);
            logger.info(`[Cleanup] Recursively deleted ${target.label} generated state for user ${uid}`);
        } catch (error) {
            logger.error(`[Cleanup] Failed to recursively delete ${target.label} generated state for user ${uid}`, error);
        }
    }
}

function getSnapshotDocs(snapshot: unknown): admin.firestore.QueryDocumentSnapshot[] {
    const docs = (snapshot as { docs?: unknown })?.docs;
    return Array.isArray(docs) ? docs as admin.firestore.QueryDocumentSnapshot[] : [];
}

function getRefDeduplicationKey(ref: admin.firestore.DocumentReference): string {
    return `${ref.path || ref.id || Math.random()}`;
}

async function recursiveDeleteQueryResults(
    db: admin.firestore.Firestore,
    uid: string,
    label: string,
    collectionName: string,
    fieldName: string,
    values: Iterable<string>,
    deletedRefKeys: Set<string>,
): Promise<void> {
    for (const value of new Set([...values].map((candidate) => `${candidate || ''}`.trim()).filter(Boolean))) {
        try {
            const snapshot = await db.collection(collectionName).where(fieldName, '==', value).get();
            const docs = getSnapshotDocs(snapshot);
            for (const doc of docs) {
                const refKey = getRefDeduplicationKey(doc.ref);
                if (deletedRefKeys.has(refKey)) {
                    continue;
                }
                deletedRefKeys.add(refKey);
                await db.recursiveDelete(doc.ref);
            }
            if (docs.length > 0) {
                logger.info(`[Cleanup] Recursively deleted ${docs.length} ${label} docs for user ${uid} from ${collectionName} where ${fieldName} == ${value}`);
            }
        } catch (error) {
            logger.error(`[Cleanup] Failed to recursively delete ${label} docs for user ${uid} from ${collectionName} where ${fieldName} == ${value}`, error);
        }
    }
}

function addProviderIdentifiersFromSleepQueueData(identifiers: UserProviderIdentifiers, data: Record<string, unknown>): void {
    const serviceName = serviceNameFromSleepProvider(data.provider);
    if (!serviceName) {
        return;
    }
    addProviderIdentifier(identifiers, serviceName, data.providerUserId);
}

function looksLikeLegacyGarminWorkoutQueueData(data: Record<string, unknown>): boolean {
    return Boolean(
        asNonEmptyString(data.activityFileID)
        || asNonEmptyString(data.activityFileType)
        || asNonEmptyString(data.callbackURL)
        || asNonEmptyString(data.userAccessToken)
    );
}

function addProviderIdentifiersFromFailedJobData(identifiers: UserProviderIdentifiers, data: Record<string, unknown>): void {
    const originalCollection = asNonEmptyString(data.originalCollection);
    switch (originalCollection) {
        case SLEEP_SYNC_QUEUE_COLLECTION_NAME:
            addProviderIdentifiersFromSleepQueueData(identifiers, data);
            return;
        case SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME:
            addProviderIdentifier(identifiers, ServiceNames.SuuntoApp, data.userName);
            return;
        case COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME:
            addProviderIdentifier(identifiers, ServiceNames.COROSAPI, data.openId);
            return;
        case GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME:
            addProviderIdentifier(identifiers, ServiceNames.GarminAPI, data.userID);
            return;
        default:
            break;
    }

    addProviderIdentifiersFromSleepQueueData(identifiers, data);
    addProviderIdentifier(identifiers, ServiceNames.SuuntoApp, data.userName);
    addProviderIdentifier(identifiers, ServiceNames.COROSAPI, data.openId);
    if (looksLikeLegacyGarminWorkoutQueueData(data)) {
        addProviderIdentifier(identifiers, ServiceNames.GarminAPI, data.userID);
    }
}

async function collectProviderIdentifiersFromQueueQuery(
    db: admin.firestore.Firestore,
    uid: string,
    collectionName: string,
    fieldName: string,
    values: Iterable<string>,
    addIdentifiersFromData: (data: Record<string, unknown>) => void,
): Promise<void> {
    for (const value of new Set([...values].map((candidate) => `${candidate || ''}`.trim()).filter(Boolean))) {
        try {
            const snapshot = await db.collection(collectionName).where(fieldName, '==', value).get();
            getSnapshotDocs(snapshot).forEach((doc) => addIdentifiersFromData(doc.data() as Record<string, unknown>));
        } catch (error) {
            logger.error(`[Cleanup] Failed to collect provider identifiers for user ${uid} from ${collectionName} where ${fieldName} == ${value}`, error);
        }
    }
}

async function collectProviderIdentifiersFromUidKeyedQueueState(
    db: admin.firestore.Firestore,
    uid: string,
    identifiers: UserProviderIdentifiers,
): Promise<void> {
    const firebaseUIDValues = [uid];

    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        SLEEP_SYNC_QUEUE_COLLECTION_NAME,
        'userID',
        firebaseUIDValues,
        (data) => addProviderIdentifiersFromSleepQueueData(identifiers, data),
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        SLEEP_SYNC_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifiersFromSleepQueueData(identifiers, data),
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifier(identifiers, ServiceNames.SuuntoApp, data.userName),
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifier(identifiers, ServiceNames.COROSAPI, data.openId),
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifier(identifiers, ServiceNames.GarminAPI, data.userID),
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        'failed_jobs',
        'userID',
        firebaseUIDValues,
        (data) => addProviderIdentifiersFromFailedJobData(identifiers, data),
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        'failed_jobs',
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifiersFromFailedJobData(identifiers, data),
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        'failed_jobs',
        'uid',
        firebaseUIDValues,
        (data) => addProviderIdentifiersFromFailedJobData(identifiers, data),
    );
}

async function cleanupTopLevelQueueState(uid: string, identifiers: UserProviderIdentifiers): Promise<void> {
    const db = admin.firestore();
    const deletedRefKeys = new Set<string>();
    const firebaseUIDValues = [uid];
    await collectProviderIdentifiersFromUidKeyedQueueState(db, uid, identifiers);
    const suuntoValues = [uid, ...identifiers.suuntoUserNames];
    const corosValues = [uid, ...identifiers.corosOpenIds];
    const garminValues = [uid, ...identifiers.garminUserIDs];
    const providerValues = [...suuntoValues, ...corosValues, ...garminValues];

    await recursiveDeleteQueryResults(db, uid, 'activity sync queue', ACTIVITY_SYNC_QUEUE_COLLECTION_NAME, 'userID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'activity sync queue', ACTIVITY_SYNC_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'sleep sync queue', SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'userID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'sleep sync queue', SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'sleep sync queue', SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'providerUserId', providerValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'Suunto workout queue', SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'Suunto workout queue', SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME, 'userName', suuntoValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'COROS workout queue', COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'COROS workout queue', COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME, 'openId', corosValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'Garmin workout queue', GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'Garmin workout queue', GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME, 'userID', garminValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'userID', [...firebaseUIDValues, ...providerValues], deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'uid', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'providerUserId', providerValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'userName', suuntoValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'openId', corosValues, deletedRefKeys);

    logger.info(`[Cleanup] Completed top-level queue state cleanup for user ${uid}`);
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
    const providerIdentifiers = await collectProviderIdentifiersForUser(uid, services);

    // Run sequantially to avoid race conditions or overwhelming logs, though parallel is also an option.
    // Sequential is safer for clarity.
    for (const service of services) {
        await safeDeauthorizeAndCleanup(uid, service);
    }

    logger.info(`[Cleanup] Service deauthorization clean up completed for user ${uid}`);

    await cleanupUserScopedGeneratedState(uid);

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
        const accountDeletionMailDocId = `account_deleted_confirmation_${uid}`;
        const accountDeletionTemplateName = 'account_deleted_confirmation';

        const addMailDocIfDeletable = (doc: admin.firestore.QueryDocumentSnapshot) => {
            const templateName = doc.data()?.template?.name;
            const isDeletionConfirmationEmail = doc.id === accountDeletionMailDocId || templateName === accountDeletionTemplateName;
            if (isDeletionConfirmationEmail) {
                logger.info(`[Cleanup] Preserving account deletion confirmation email ${doc.id} for user ${uid}`);
                return;
            }
            docsToDelete.set(doc.id, doc.ref);
        };

        uidSnapshot.docs.forEach(addMailDocIfDeletable);
        if (emailSnapshot) {
            emailSnapshot.docs.forEach(addMailDocIfDeletable);
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

    await collectArchivedProviderIdentifiersForUser(uid, providerIdentifiers);
    await cleanupTopLevelQueueState(uid, providerIdentifiers);

});
