import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { getServiceConfig } from '../OAuth2';
import { GARMIN_API_TOKENS_COLLECTION_NAME, GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../garmin/constants';

import { ServiceNames } from '@sports-alliance/sports-lib';
import { DERIVED_METRICS_COLLECTION_ID } from '../../../shared/derived-metrics';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../coros/constants';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import {
    cleanupServiceConnectionForUser,
    SERVICE_AUTH_CLEANUP_REASONS,
    type ServiceAuthCleanupOutcome,
} from '../service-auth-lifecycle';
import {
    markQueueItemDeletedForUserCleanup,
    QUEUE_CLEANUP_TOMBSTONE_REASONS,
} from '../queue/cleanup-tombstone';
import {
    archiveOrphanedServiceToken,
    ORPHANED_SERVICE_TOKENS_COLLECTION_NAME,
} from '../orphaned-service-tokens';

export { ORPHANED_SERVICE_TOKENS_COLLECTION_NAME } from '../orphaned-service-tokens';

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

        return archiveOrphanedServiceToken(uid, serviceName, tokenId, tokenData, errorReason);
    });

    await Promise.all(archivePromises);
}

async function archiveLifecycleTokens(
    uid: string,
    serviceName: ServiceNames,
    outcome: ServiceAuthCleanupOutcome | void | undefined,
): Promise<void> {
    const tokensToArchive = outcome?.tokensToArchive || [];
    if (tokensToArchive.length === 0) {
        return;
    }

    await Promise.all(tokensToArchive.map((token) => archiveOrphanedServiceToken(
        uid,
        serviceName,
        token.tokenID,
        token.tokenData,
        new Error(token.errorMessage),
    )));
}


// Define cleanup configuration for services
interface ServiceCleanupConfig {
    name: string;
    deauthFn: (uid: string) => Promise<ServiceAuthCleanupOutcome | void>;
    collectionName: string;
    serviceName: ServiceNames;
}

interface UserProviderIdentifiers {
    suuntoUserNames: Set<string>;
    corosOpenIds: Set<string>;
    garminUserIDs: Set<string>;
}

const CLOUD_TASK_SOURCE_QUEUE_COLLECTIONS = new Set([
    ACTIVITY_SYNC_QUEUE_COLLECTION_NAME,
    SLEEP_SYNC_QUEUE_COLLECTION_NAME,
    SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME,
    COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
    GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME,
]);

const LEGACY_PROVIDER_QUEUE_ORPHAN_SWEEP_LIMIT = 500;

type ProviderIdentifierField = 'userName' | 'openId' | 'userID';

interface ProviderQueueLookup {
    serviceName: ServiceNames;
    tokenField: ProviderIdentifierField;
    providerUserID: string;
}

type OperationalDocDeleteFilter = (doc: admin.firestore.QueryDocumentSnapshot) => Promise<boolean>;

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
 * 1. Attempt partner deauthorization (api call)
 * 2. Mandatory local token deletion (firestore)
 */
async function safeDeauthorizeAndCleanup(uid: string, config: ServiceCleanupConfig): Promise<void> {
    let deauthError: Error | undefined;
    let cleanupOutcome: ServiceAuthCleanupOutcome | void = undefined;

    // 1. Attempt partner deauthorization. Provider outages must not block local account deletion.
    try {
        logger.info(`[Cleanup] Deauthorizing ${config.name} for user ${uid}`);
        cleanupOutcome = await config.deauthFn(uid);
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

    // 2. Local cleanup is mandatory. Archival is best-effort and must never block root deletion.
    try {
        // Archive any tokens that survived deauthorization (likely due to 500/502 errors)
        await archiveRemainingTokens(config.collectionName, uid, config.serviceName, deauthError);
    } catch (e: unknown) {
        logger.error(`[Cleanup] Error archiving remaining ${config.name} tokens for ${uid}`, e as Error);
    }

    try {
        // If account-deletion lifecycle refreshed in memory and then partner deauth
        // failed, archive that refreshed token last so it wins over stale local data.
        await archiveLifecycleTokens(uid, config.serviceName, cleanupOutcome);
    } catch (e: unknown) {
        logger.error(`[Cleanup] Error archiving lifecycle ${config.name} tokens for ${uid}`, e as Error);
    }

    try {
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
    shouldDeleteDoc?: OperationalDocDeleteFilter,
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
                if (shouldDeleteDoc && !(await shouldDeleteDoc(doc))) {
                    continue;
                }
                deletedRefKeys.add(refKey);
                await markQueueCleanupTombstoneForDeletedOperationalDoc(collectionName, doc);
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

function sourceQueueCollectionFromFailedJobData(data: Record<string, unknown>): string | null {
    const originalCollection = asNonEmptyString(data.originalCollection);
    if (originalCollection && CLOUD_TASK_SOURCE_QUEUE_COLLECTIONS.has(originalCollection)) {
        return originalCollection;
    }

    if (serviceNameFromSleepProvider(data.provider) && asNonEmptyString(data.providerUserId)) {
        return SLEEP_SYNC_QUEUE_COLLECTION_NAME;
    }
    if (asNonEmptyString(data.userName)) {
        return SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME;
    }
    if (asNonEmptyString(data.openId)) {
        return COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME;
    }
    if (asNonEmptyString(data.userID) && looksLikeLegacyGarminWorkoutQueueData(data)) {
        return GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME;
    }

    return null;
}

async function markQueueCleanupTombstoneForDeletedOperationalDoc(
    collectionName: string,
    doc: admin.firestore.QueryDocumentSnapshot,
): Promise<void> {
    const sourceQueueCollectionName = CLOUD_TASK_SOURCE_QUEUE_COLLECTIONS.has(collectionName)
        ? collectionName
        : collectionName === 'failed_jobs'
            ? sourceQueueCollectionFromFailedJobData(doc.data() as Record<string, unknown>)
            : null;

    if (!sourceQueueCollectionName) {
        return;
    }

    await markQueueItemDeletedForUserCleanup(
        sourceQueueCollectionName,
        doc.id,
        QUEUE_CLEANUP_TOMBSTONE_REASONS.AccountDeletionCleanup,
    );
}

function providerLookupForService(serviceName: ServiceNames, providerUserID: unknown): ProviderQueueLookup | null {
    const providerUserIDValue = asNonEmptyString(providerUserID);
    if (!providerUserIDValue) {
        return null;
    }

    switch (serviceName) {
        case ServiceNames.SuuntoApp:
            return {
                serviceName,
                tokenField: 'userName',
                providerUserID: providerUserIDValue,
            };
        case ServiceNames.COROSAPI:
            return {
                serviceName,
                tokenField: 'openId',
                providerUserID: providerUserIDValue,
            };
        case ServiceNames.GarminAPI:
            return {
                serviceName,
                tokenField: 'userID',
                providerUserID: providerUserIDValue,
            };
        default:
            return null;
    }
}

function providerQueueLookupFromCollectionData(
    collectionName: string,
    data: Record<string, unknown>,
): ProviderQueueLookup | null {
    switch (collectionName) {
        case SLEEP_SYNC_QUEUE_COLLECTION_NAME: {
            const serviceName = serviceNameFromSleepProvider(data.provider);
            return serviceName ? providerLookupForService(serviceName, data.providerUserId) : null;
        }
        case SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME:
            return providerLookupForService(ServiceNames.SuuntoApp, data.userName);
        case COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME:
            return providerLookupForService(ServiceNames.COROSAPI, data.openId);
        case GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME:
            return providerLookupForService(ServiceNames.GarminAPI, data.userID);
        case 'failed_jobs': {
            const originalCollection = asNonEmptyString(data.originalCollection);
            if (originalCollection && originalCollection !== 'failed_jobs') {
                return providerQueueLookupFromCollectionData(originalCollection, data);
            }
            return providerQueueLookupFromLegacyFailedJobData(data);
        }
        default:
            return null;
    }
}

function providerQueueLookupFromLegacyFailedJobData(data: Record<string, unknown>): ProviderQueueLookup | null {
    const sleepServiceName = serviceNameFromSleepProvider(data.provider);
    if (sleepServiceName) {
        return providerLookupForService(sleepServiceName, data.providerUserId);
    }

    return providerLookupForService(ServiceNames.SuuntoApp, data.userName)
        || providerLookupForService(ServiceNames.COROSAPI, data.openId)
        || (looksLikeLegacyGarminWorkoutQueueData(data)
            ? providerLookupForService(ServiceNames.GarminAPI, data.userID)
            : null);
}

function getExplicitFirebaseUidAssociation(collectionName: string, data: Record<string, unknown>): string | null {
    const firebaseUserID = asNonEmptyString(data.firebaseUserID);
    if (firebaseUserID) {
        return firebaseUserID;
    }

    const uid = asNonEmptyString(data.uid);
    if (uid) {
        return uid;
    }

    if (collectionName === ACTIVITY_SYNC_QUEUE_COLLECTION_NAME || collectionName === SLEEP_SYNC_QUEUE_COLLECTION_NAME) {
        return asNonEmptyString(data.userID);
    }

    if (collectionName !== 'failed_jobs') {
        return null;
    }

    const originalCollection = asNonEmptyString(data.originalCollection);
    if (originalCollection === ACTIVITY_SYNC_QUEUE_COLLECTION_NAME || originalCollection === SLEEP_SYNC_QUEUE_COLLECTION_NAME) {
        return asNonEmptyString(data.userID);
    }

    return null;
}

function hasFirebaseUidAssociation(collectionName: string, data: Record<string, unknown>): boolean {
    return getExplicitFirebaseUidAssociation(collectionName, data) !== null;
}

async function hasConnectedTokenForProviderLookup(
    db: admin.firestore.Firestore,
    lookup: ProviderQueueLookup,
    excludedUid?: string,
): Promise<boolean> {
    const snapshot = await db.collectionGroup('tokens')
        .where(lookup.tokenField, '==', lookup.providerUserID)
        .get();
    return getSnapshotDocs(snapshot).some((doc) => {
        if (!tokenSnapshotBelongsToService(doc, lookup.serviceName)) {
            return false;
        }
        const tokenOwnerUid = doc.ref.parent.parent?.id;
        return !excludedUid || tokenOwnerUid !== excludedUid;
    });
}

function serviceTokenCollectionNameForService(serviceName: ServiceNames): string {
    return getServiceConfig(serviceName).tokenCollectionName;
}

function tokenSnapshotBelongsToService(doc: admin.firestore.QueryDocumentSnapshot, serviceName: ServiceNames): boolean {
    const data = doc.data() as Record<string, unknown>;
    const tokenServiceName = asNonEmptyString(data.serviceName);
    if (tokenServiceName) {
        return tokenServiceName === serviceName;
    }

    const tokenRootCollectionName = doc.ref?.parent?.parent?.parent?.id;
    return tokenRootCollectionName === serviceTokenCollectionNameForService(serviceName);
}

function providerLookupBelongsToUserIdentifiers(lookup: ProviderQueueLookup, identifiers: UserProviderIdentifiers): boolean {
    switch (lookup.serviceName) {
        case ServiceNames.SuuntoApp:
            return identifiers.suuntoUserNames.has(lookup.providerUserID);
        case ServiceNames.COROSAPI:
            return identifiers.corosOpenIds.has(lookup.providerUserID);
        case ServiceNames.GarminAPI:
            return identifiers.garminUserIDs.has(lookup.providerUserID);
        default:
            return false;
    }
}

async function shouldDeleteProviderKeyedOperationalDoc(
    db: admin.firestore.Firestore,
    uid: string,
    collectionName: string,
    doc: admin.firestore.QueryDocumentSnapshot,
): Promise<boolean> {
    const data = doc.data() as Record<string, unknown>;
    const explicitUid = getExplicitFirebaseUidAssociation(collectionName, data);
    if (explicitUid) {
        return explicitUid === uid;
    }

    const lookup = providerQueueLookupFromCollectionData(collectionName, data);
    if (!lookup) {
        return false;
    }

    return !(await hasConnectedTokenForProviderLookup(db, lookup, uid));
}

async function cleanupLegacyProviderKeyedQueueOrphans(
    uid: string,
    identifiers: UserProviderIdentifiers,
    deletedRefKeys: Set<string>,
): Promise<void> {
    const db = admin.firestore();
    const collectionNames = [
        SLEEP_SYNC_QUEUE_COLLECTION_NAME,
        SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME,
        COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
        GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME,
        'failed_jobs',
    ];

    for (const collectionName of collectionNames) {
        try {
            const snapshot = await db.collection(collectionName)
                .limit(LEGACY_PROVIDER_QUEUE_ORPHAN_SWEEP_LIMIT)
                .get();
            for (const doc of getSnapshotDocs(snapshot)) {
                const refKey = getRefDeduplicationKey(doc.ref);
                if (deletedRefKeys.has(refKey)) {
                    continue;
                }

                const data = doc.data() as Record<string, unknown>;
                if (hasFirebaseUidAssociation(collectionName, data)) {
                    continue;
                }

                const lookup = providerQueueLookupFromCollectionData(collectionName, data);
                if (
                    !lookup
                    || !providerLookupBelongsToUserIdentifiers(lookup, identifiers)
                    || await hasConnectedTokenForProviderLookup(db, lookup, uid)
                ) {
                    continue;
                }

                deletedRefKeys.add(refKey);
                await markQueueCleanupTombstoneForDeletedOperationalDoc(collectionName, doc);
                await db.recursiveDelete(doc.ref);
                logger.info(
                    `[Cleanup] Recursively deleted legacy provider-keyed orphan doc ${collectionName}/${doc.id} while cleaning user ${uid}.`,
                );
            }
        } catch (error) {
            logger.error(`[Cleanup] Failed legacy provider-keyed orphan sweep for ${collectionName} while cleaning user ${uid}`, error);
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
        (data) => {
            if (getExplicitFirebaseUidAssociation('failed_jobs', data) === uid) {
                addProviderIdentifiersFromFailedJobData(identifiers, data);
            }
        },
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
    const suuntoValues = [...identifiers.suuntoUserNames];
    const corosValues = [...identifiers.corosOpenIds];
    const garminValues = [...identifiers.garminUserIDs];
    const providerValues = [...suuntoValues, ...corosValues, ...garminValues];
    const providerKeyedDeleteFilter = (collectionName: string): OperationalDocDeleteFilter =>
        (doc) => shouldDeleteProviderKeyedOperationalDoc(db, uid, collectionName, doc);
    const failedJobFirebaseUidDeleteFilter: OperationalDocDeleteFilter = async (doc) =>
        getExplicitFirebaseUidAssociation('failed_jobs', doc.data() as Record<string, unknown>) === uid;

    await recursiveDeleteQueryResults(db, uid, 'activity sync queue', ACTIVITY_SYNC_QUEUE_COLLECTION_NAME, 'userID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'activity sync queue', ACTIVITY_SYNC_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'sleep sync queue', SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'userID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'sleep sync queue', SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'sleep sync queue', SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'providerUserId', providerValues, deletedRefKeys, providerKeyedDeleteFilter(SLEEP_SYNC_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'Suunto workout queue', SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'Suunto workout queue', SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME, 'userName', suuntoValues, deletedRefKeys, providerKeyedDeleteFilter(SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'COROS workout queue', COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'COROS workout queue', COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME, 'openId', corosValues, deletedRefKeys, providerKeyedDeleteFilter(COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'Garmin workout queue', GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'Garmin workout queue', GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME, 'userID', garminValues, deletedRefKeys, providerKeyedDeleteFilter(GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'userID', firebaseUIDValues, deletedRefKeys, failedJobFirebaseUidDeleteFilter);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'userID', garminValues, deletedRefKeys, providerKeyedDeleteFilter('failed_jobs'));
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'firebaseUserID', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'uid', firebaseUIDValues, deletedRefKeys);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'providerUserId', providerValues, deletedRefKeys, providerKeyedDeleteFilter('failed_jobs'));
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'userName', suuntoValues, deletedRefKeys, providerKeyedDeleteFilter('failed_jobs'));
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'openId', corosValues, deletedRefKeys, providerKeyedDeleteFilter('failed_jobs'));
    await cleanupLegacyProviderKeyedQueueOrphans(uid, identifiers, deletedRefKeys);

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
            deauthFn: (id) => cleanupServiceConnectionForUser(
                id,
                ServiceNames.SuuntoApp,
                SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
                { missingTokensBehavior: 'ignore' },
            ),
            collectionName: getServiceConfig(ServiceNames.SuuntoApp).tokenCollectionName,
            serviceName: ServiceNames.SuuntoApp
        },
        {
            name: 'COROS',
            deauthFn: (id) => cleanupServiceConnectionForUser(
                id,
                ServiceNames.COROSAPI,
                SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
                { missingTokensBehavior: 'ignore' },
            ),
            collectionName: getServiceConfig(ServiceNames.COROSAPI).tokenCollectionName,
            serviceName: ServiceNames.COROSAPI
        },
        {
            name: 'Garmin',
            deauthFn: (id) => cleanupServiceConnectionForUser(
                id,
                ServiceNames.GarminAPI,
                SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
                { missingTokensBehavior: 'ignore' },
            ),
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
