import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { cleanupMarketingCampaignRecipients } from '../admin/marketing/cleanup';
import { getServiceConfig } from '../OAuth2';
import { GARMIN_API_TOKENS_COLLECTION_NAME, GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../garmin/constants';

import { ServiceNames } from '@sports-alliance/sports-lib';
import { DERIVED_METRICS_COLLECTION_ID } from '../../../shared/derived-metrics';
import {
    SCHEDULED_WORKOUTS_COLLECTION_ID,
    TRAINING_PLANS_COLLECTION_ID,
    TRAINING_PLAN_STATE_COLLECTION_ID,
} from '../../../shared/training-plans';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME } from '../route-delivery-sync/constants';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, DELIVERY_SCOPES, DELIVERY_STATE } from '../training-plans/delivery/contracts';
import { TRAINING_DELIVERY_SETTINGS, TRAINING_DELIVERY_STATUSES } from '../../../shared/training-provider-delivery';
import { TRAINING_DELIVERY_VERIFICATIONS } from '../../../shared/training-provider-verification';
import {
    TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID,
    TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID,
} from '../../../shared/training-workout-completion';
import { TRAINING_PROVIDER_CAPACITY } from '../training-plans/delivery/request-capacity';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from '../routes/route-sync.constants';
import {
    SLEEP_SYNC_QUEUE_COLLECTION_NAME,
    SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME,
} from '../sleep/constants';
import { SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../suunto/constants';
import { SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME } from '../suunto/health-webhook-binding';
import { COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../coros/constants';
import { COROS_INTEGER_CLAIMS } from '../training-plans/delivery/coros/identities';
import {
    WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
    WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME,
} from '../wahoo/constants';
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
import { cleanupMcpOAuthStateForUser } from '../mcp/oauth.service';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { cleanupRejectedRouteOriginalFilesForUser, REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME } from '../routes/rejected-original-cleanup';
import { cleanupServiceDisconnectTasksForUser, SERVICE_DISCONNECT_CLEANUP_COLLECTION } from '../service-disconnect-cleanup';
import {
    ACCOUNT_DELETION_ROOT_COLLECTIONS, beginAccountDataCleanup, checkpointAccountDeletionIdentifiers,
    completeAccountDataCleanup, deleteAccountFirestoreRoot, assertAccountFirestoreRootAbsent,
    deleteAccountStorageFiles, assertAccountStorageAbsent, assertAccountCleanupQueryEmpty,
} from './data-cleanup';

type CleanupFailures = { stage: string; error: unknown }[];
async function runCleanupStage(failures: CleanupFailures, stage: string, action: () => Promise<unknown>): Promise<void> {
    try { await action(); }
    catch (error) {
        failures.push({ stage, error });
        logger.error('[AccountDeletion] Mandatory stage failed.', { stage });
    }
}

export { ORPHANED_SERVICE_TOKENS_COLLECTION_NAME } from '../orphaned-service-tokens';

const SPORTS_LIB_REPARSE_JOBS_COLLECTION = 'sportsLibReparseJobs';
const SPORTS_LIB_ROUTE_REPARSE_JOBS_COLLECTION = 'sportsLibRouteReparseJobs';

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
    wahooUserIDs: Set<string>;
}

const CLOUD_TASK_SOURCE_QUEUE_COLLECTIONS = new Set([
    ACTIVITY_SYNC_QUEUE_COLLECTION_NAME,
    ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME,
    ROUTE_SYNC_QUEUE_COLLECTION_NAME,
    SLEEP_SYNC_QUEUE_COLLECTION_NAME,
    SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME,
    COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
    GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME,
    WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME,
    DELIVERY_QUEUE,
]);

const LEGACY_PROVIDER_QUEUE_ORPHAN_SWEEP_LIMIT = 500;

type ProviderIdentifierField = 'userName' | 'openId' | 'userID' | 'wahooUserID';

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
        case ServiceNames.WahooAPI:
            identifiers.wahooUserIDs.add(providerUserIDValue);
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
        case ServiceNames.WahooAPI:
            addProviderIdentifier(identifiers, serviceName, tokenData.wahooUserID);
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

async function collectProviderIdentifiersForUser(uid: string, services: readonly ServiceCleanupConfig[], failures: CleanupFailures): Promise<UserProviderIdentifiers> {
    const identifiers: UserProviderIdentifiers = {
        suuntoUserNames: new Set<string>(),
        corosOpenIds: new Set<string>(),
        garminUserIDs: new Set<string>(),
        wahooUserIDs: new Set<string>(),
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
            failures.push({ stage: 'provider_identifiers', error });
            logger.error('[AccountDeletion] Provider identity read failed.');
        }
    }

    return identifiers;
}

async function collectArchivedProviderIdentifiersForUser(uid: string, identifiers: UserProviderIdentifiers, failures: CleanupFailures): Promise<void> {
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
        failures.push({ stage: 'archived_identifiers', error });
        logger.error('[AccountDeletion] Archived identity read failed.');
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

    await deleteTokenDocumentWithSubcollections(config.collectionName, uid);
}

async function cleanupUserScopedGeneratedState(uid: string, failures: CleanupFailures): Promise<void> {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const cleanupTargets = [
        { label: 'derived metrics', ref: userRef.collection(DERIVED_METRICS_COLLECTION_ID) },
        { label: 'training plan state', ref: userRef.collection(TRAINING_PLAN_STATE_COLLECTION_ID) },
        { label: 'training plans', ref: userRef.collection(TRAINING_PLANS_COLLECTION_ID) },
        { label: 'workout library', ref: userRef.collection('workoutLibrary') },
        { label: 'scheduled workouts', ref: userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID) },
        { label: 'training workout completions', ref: userRef.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID) },
        { label: 'training activity completion links', ref: userRef.collection(TRAINING_ACTIVITY_COMPLETION_LINKS_COLLECTION_ID) },
        ...[DELIVERY_LEDGER, DELIVERY_STATE, DELIVERY_SCOPES, TRAINING_DELIVERY_SETTINGS, TRAINING_DELIVERY_STATUSES,
            TRAINING_DELIVERY_VERIFICATIONS, TRAINING_PROVIDER_CAPACITY]
            .map(id => ({ label: id, ref: userRef.collection(id) })),
        { label: 'training MCP proposals', ref: userRef.collection('trainingMcpProposals') },
        { label: 'training MCP library proposals', ref: userRef.collection('trainingMcpLibraryProposals') },
    ];

    for (const target of cleanupTargets) {
        try {
            await db.recursiveDelete(target.ref);
            logger.info(`[Cleanup] Recursively deleted ${target.label} generated state for user ${uid}`);
        } catch (error) {
            failures.push({ stage: 'generated_state', error });
            logger.error('[AccountDeletion] Generated-state cleanup failed.');
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
    failures: CleanupFailures,
    shouldDeleteDoc?: OperationalDocDeleteFilter,
): Promise<void> {
    for (const value of new Set([...values].map((candidate) => `${candidate || ''}`.trim()).filter(Boolean))) {
        try {
            const query = db.collection(collectionName).where(fieldName, '==', value);
            const snapshot = await query.get();
            const docs = getSnapshotDocs(snapshot);
            let deletedDocCount = 0;
            for (const doc of docs) {
                const refKey = getRefDeduplicationKey(doc.ref);
                if (deletedRefKeys.has(refKey)) {
                    continue;
                }
                if (shouldDeleteDoc && !(await shouldDeleteDoc(doc))) {
                    continue;
                }
                if (!(await markQueueCleanupTombstoneForDeletedOperationalDoc(collectionName, doc))) {
                    failures.push({ stage: 'queue_tombstone', error: new Error('Queue cleanup tombstone could not be written.') });
                    continue;
                }
                await runCleanupStage(failures, 'operational_document', async () => {
                    await db.recursiveDelete(doc.ref);
                    deletedRefKeys.add(refKey);
                    deletedDocCount += 1;
                });
            }
            await assertAccountCleanupQueryEmpty(query, shouldDeleteDoc);
            if (deletedDocCount > 0) {
                logger.info(`[Cleanup] Recursively deleted ${deletedDocCount} ${label} docs for user ${uid} from ${collectionName} where ${fieldName} == ${value}`);
            }
        } catch (error) {
            failures.push({ stage: 'operational_query', error });
            logger.error('[AccountDeletion] Operational cleanup failed.');
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
    if (asNonEmptyString(data.providerRouteId) && asNonEmptyString(data.sourceServiceName) && asNonEmptyString(data.providerUserId)) {
        return ROUTE_SYNC_QUEUE_COLLECTION_NAME;
    }
    if (asNonEmptyString(data.userName)) {
        return SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME;
    }
    if (asNonEmptyString(data.openId)) {
        return COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME;
    }
    if (asNonEmptyString(data.wahooUserID)) {
        return WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME;
    }
    if (asNonEmptyString(data.userID) && looksLikeLegacyGarminWorkoutQueueData(data)) {
        return GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME;
    }

    return null;
}

async function markQueueCleanupTombstoneForDeletedOperationalDoc(
    collectionName: string,
    doc: admin.firestore.QueryDocumentSnapshot,
): Promise<boolean> {
    const sourceQueueCollectionName = CLOUD_TASK_SOURCE_QUEUE_COLLECTIONS.has(collectionName)
        ? collectionName
        : collectionName === 'failed_jobs'
            ? sourceQueueCollectionFromFailedJobData(doc.data() as Record<string, unknown>)
            : null;

    if (!sourceQueueCollectionName && collectionName !== 'failed_jobs') {
        return true;
    }

    if (!sourceQueueCollectionName) {
        const tombstoneResults = await Promise.all([...CLOUD_TASK_SOURCE_QUEUE_COLLECTIONS].map((sourceCollectionName) =>
            markQueueItemDeletedForUserCleanup(
                sourceCollectionName,
                doc.id,
                QUEUE_CLEANUP_TOMBSTONE_REASONS.AccountDeletionCleanup,
            )
        ));
        return tombstoneResults.every(Boolean);
    }

    return markQueueItemDeletedForUserCleanup(
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
        case ServiceNames.WahooAPI:
            return {
                serviceName,
                tokenField: 'wahooUserID',
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
        case SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME:
            return providerLookupForService(ServiceNames.SuuntoApp, data.providerUserId);
        case ROUTE_SYNC_QUEUE_COLLECTION_NAME: {
            const serviceName = asNonEmptyString(data.sourceServiceName) as ServiceNames | null;
            return serviceName ? providerLookupForService(serviceName, data.providerUserId) : null;
        }
        case SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME:
            return providerLookupForService(ServiceNames.SuuntoApp, data.userName);
        case COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME:
            return providerLookupForService(ServiceNames.COROSAPI, data.openId);
        case GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME:
            return providerLookupForService(ServiceNames.GarminAPI, data.userID);
        case WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME:
            return providerLookupForService(ServiceNames.WahooAPI, data.wahooUserID);
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
            : null)
        || providerLookupForService(ServiceNames.WahooAPI, data.wahooUserID);
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

    if (
        collectionName === ACTIVITY_SYNC_QUEUE_COLLECTION_NAME ||
        collectionName === ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME ||
        collectionName === SLEEP_SYNC_QUEUE_COLLECTION_NAME ||
        collectionName === SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME
    ) {
        return asNonEmptyString(data.userID);
    }

    if (collectionName !== 'failed_jobs') {
        return null;
    }

    const originalCollection = asNonEmptyString(data.originalCollection);
    if (
        originalCollection === ACTIVITY_SYNC_QUEUE_COLLECTION_NAME ||
        originalCollection === ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME ||
        originalCollection === SLEEP_SYNC_QUEUE_COLLECTION_NAME
    ) {
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
        .where('serviceName', '==', lookup.serviceName)
        .get();
    return getSnapshotDocs(snapshot).some((doc) => {
        if (!tokenSnapshotHasServiceName(doc, lookup.serviceName)) {
            return false;
        }
        const tokenOwnerUid = doc.ref.parent.parent?.id;
        return !excludedUid || tokenOwnerUid !== excludedUid;
    });
}

function tokenSnapshotHasServiceName(doc: admin.firestore.QueryDocumentSnapshot, serviceName: ServiceNames): boolean {
    const data = doc.data() as Record<string, unknown>;
    return asNonEmptyString(data.serviceName) === serviceName;
}

function providerLookupBelongsToUserIdentifiers(lookup: ProviderQueueLookup, identifiers: UserProviderIdentifiers): boolean {
    switch (lookup.serviceName) {
        case ServiceNames.SuuntoApp:
            return identifiers.suuntoUserNames.has(lookup.providerUserID);
        case ServiceNames.COROSAPI:
            return identifiers.corosOpenIds.has(lookup.providerUserID);
        case ServiceNames.GarminAPI:
            return identifiers.garminUserIDs.has(lookup.providerUserID);
        case ServiceNames.WahooAPI:
            return identifiers.wahooUserIDs.has(lookup.providerUserID);
        default:
            return false;
    }
}

function hasAnyProviderIdentifier(identifiers: UserProviderIdentifiers): boolean {
    return identifiers.suuntoUserNames.size > 0
        || identifiers.corosOpenIds.size > 0
        || identifiers.garminUserIDs.size > 0
        || identifiers.wahooUserIDs.size > 0;
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
    failures: CleanupFailures,
): Promise<void> {
    if (!hasAnyProviderIdentifier(identifiers)) {
        return;
    }

    const db = admin.firestore();
    const collectionNames = [
        ROUTE_SYNC_QUEUE_COLLECTION_NAME,
        ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME,
        SLEEP_SYNC_QUEUE_COLLECTION_NAME,
        SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME,
        SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME,
        COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
        GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME,
        WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME,
        'failed_jobs',
    ];

    for (const collectionName of collectionNames) {
        try {
            let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
            while (true) {
                let query = db.collection(collectionName).limit(LEGACY_PROVIDER_QUEUE_ORPHAN_SWEEP_LIMIT);
                if (lastDoc) {
                    query = query.startAfter(lastDoc);
                }

                const snapshot = await query.get();
                const docs = getSnapshotDocs(snapshot);
                if (docs.length === 0) {
                    break;
                }

                for (const doc of docs) {
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

                    if (!(await markQueueCleanupTombstoneForDeletedOperationalDoc(collectionName, doc))) {
                        failures.push({ stage: 'queue_tombstone', error: new Error('Queue cleanup tombstone could not be written.') });
                        continue;
                    }
                    await runCleanupStage(failures, 'legacy_operational_document', async () => {
                        await db.recursiveDelete(doc.ref);
                        deletedRefKeys.add(refKey);
                    });
                    logger.info(
                        `[Cleanup] Recursively deleted legacy provider-keyed orphan doc ${collectionName}/${doc.id} while cleaning user ${uid}.`,
                    );
                }

                lastDoc = docs[docs.length - 1];
                if (docs.length < LEGACY_PROVIDER_QUEUE_ORPHAN_SWEEP_LIMIT) {
                    break;
                }
            }
            let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
            while (true) {
                let query = db.collection(collectionName).limit(LEGACY_PROVIDER_QUEUE_ORPHAN_SWEEP_LIMIT);
                if (cursor) query = query.startAfter(cursor);
                const page = await query.get();
                await assertAccountCleanupQueryEmpty(query, async doc => {
                    const data = doc.data() as Record<string, unknown>;
                    const lookup = providerQueueLookupFromCollectionData(collectionName, data);
                    return !hasFirebaseUidAssociation(collectionName, data) && Boolean(lookup
                        && providerLookupBelongsToUserIdentifiers(lookup, identifiers)
                        && !(await hasConnectedTokenForProviderLookup(db, lookup, uid)));
                });
                const docs = getSnapshotDocs(page);
                if (docs.length < LEGACY_PROVIDER_QUEUE_ORPHAN_SWEEP_LIMIT) break;
                cursor = docs[docs.length - 1];
            }
        } catch (error) {
            failures.push({ stage: 'legacy_operational_query', error });
            logger.error('[AccountDeletion] Legacy operational cleanup failed.');
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
        case ROUTE_SYNC_QUEUE_COLLECTION_NAME:
            addProviderIdentifier(identifiers, data.sourceServiceName, data.providerUserId);
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
        case WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME:
            addProviderIdentifier(identifiers, ServiceNames.WahooAPI, data.wahooUserID);
            return;
        default:
            break;
    }

    addProviderIdentifiersFromSleepQueueData(identifiers, data);
    addProviderIdentifier(identifiers, data.sourceServiceName, data.providerUserId);
    addProviderIdentifier(identifiers, ServiceNames.SuuntoApp, data.userName);
    addProviderIdentifier(identifiers, ServiceNames.COROSAPI, data.openId);
    if (looksLikeLegacyGarminWorkoutQueueData(data)) {
        addProviderIdentifier(identifiers, ServiceNames.GarminAPI, data.userID);
    }
    addProviderIdentifier(identifiers, ServiceNames.WahooAPI, data.wahooUserID);
}

async function collectProviderIdentifiersFromQueueQuery(
    db: admin.firestore.Firestore,
    uid: string,
    collectionName: string,
    fieldName: string,
    values: Iterable<string>,
    addIdentifiersFromData: (data: Record<string, unknown>) => void,
    failures: CleanupFailures,
): Promise<void> {
    for (const value of new Set([...values].map((candidate) => `${candidate || ''}`.trim()).filter(Boolean))) {
        try {
            const snapshot = await db.collection(collectionName).where(fieldName, '==', value).get();
            getSnapshotDocs(snapshot).forEach((doc) => addIdentifiersFromData(doc.data() as Record<string, unknown>));
        } catch (error) {
            failures.push({ stage: 'queue_identifiers', error });
            logger.error('[AccountDeletion] Queue identity read failed.');
        }
    }
}

async function collectProviderIdentifiersFromUidKeyedQueueState(
    db: admin.firestore.Firestore,
    uid: string,
    identifiers: UserProviderIdentifiers,
    failures: CleanupFailures,
): Promise<void> {
    const firebaseUIDValues = [uid];

    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        ROUTE_SYNC_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifier(identifiers, data.sourceServiceName, data.providerUserId),
        failures,
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME,
        'userID',
        firebaseUIDValues,
        (data) => addProviderIdentifier(identifiers, ServiceNames.SuuntoApp, data.providerUserId),
        failures,
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        SLEEP_SYNC_QUEUE_COLLECTION_NAME,
        'userID',
        firebaseUIDValues,
        (data) => addProviderIdentifiersFromSleepQueueData(identifiers, data),
        failures,
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        SLEEP_SYNC_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifiersFromSleepQueueData(identifiers, data),
        failures,
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifier(identifiers, ServiceNames.SuuntoApp, data.userName),
        failures,
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifier(identifiers, ServiceNames.COROSAPI, data.openId),
        failures,
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifier(identifiers, ServiceNames.GarminAPI, data.userID),
        failures,
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME,
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifier(identifiers, ServiceNames.WahooAPI, data.wahooUserID),
        failures,
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
        failures,
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        'failed_jobs',
        'firebaseUserID',
        firebaseUIDValues,
        (data) => addProviderIdentifiersFromFailedJobData(identifiers, data),
        failures,
    );
    await collectProviderIdentifiersFromQueueQuery(
        db,
        uid,
        'failed_jobs',
        'uid',
        firebaseUIDValues,
        (data) => addProviderIdentifiersFromFailedJobData(identifiers, data),
        failures,
    );
}

async function cleanupTopLevelQueueState(uid: string, identifiers: UserProviderIdentifiers, failures: CleanupFailures): Promise<void> {
    const startingFailureCount = failures.length;
    const db = admin.firestore();
    const deletedRefKeys = new Set<string>();
    const firebaseUIDValues = [uid];
    const suuntoValues = [...identifiers.suuntoUserNames];
    const corosValues = [...identifiers.corosOpenIds];
    const garminValues = [...identifiers.garminUserIDs];
    const wahooValues = [...identifiers.wahooUserIDs];
    const providerValues = [...suuntoValues, ...corosValues, ...garminValues, ...wahooValues];
    const providerKeyedDeleteFilter = (collectionName: string): OperationalDocDeleteFilter =>
        (doc) => shouldDeleteProviderKeyedOperationalDoc(db, uid, collectionName, doc);
    const failedJobFirebaseUidDeleteFilter: OperationalDocDeleteFilter = async (doc) =>
        getExplicitFirebaseUidAssociation('failed_jobs', doc.data() as Record<string, unknown>) === uid;

    await recursiveDeleteQueryResults(db, uid, 'activity sync queue', ACTIVITY_SYNC_QUEUE_COLLECTION_NAME, 'userID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'training delivery queue', DELIVERY_QUEUE, 'uid', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'COROS Training integer claim', COROS_INTEGER_CLAIMS, 'uid', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'activity sync queue', ACTIVITY_SYNC_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'route delivery sync queue', ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME, 'userID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'route delivery sync queue', ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'route sync queue', ROUTE_SYNC_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'route sync queue', ROUTE_SYNC_QUEUE_COLLECTION_NAME, 'providerUserId', providerValues, deletedRefKeys, failures, providerKeyedDeleteFilter(ROUTE_SYNC_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'sleep sync queue', SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'userID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'sleep sync queue', SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'sleep sync queue', SLEEP_SYNC_QUEUE_COLLECTION_NAME, 'providerUserId', providerValues, deletedRefKeys, failures, providerKeyedDeleteFilter(SLEEP_SYNC_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'Suunto Health webhook ingress', SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME, 'userID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'Suunto Health webhook account binding', SUUNTO_HEALTH_WEBHOOK_ACCOUNT_BINDINGS_COLLECTION_NAME, 'userID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'Suunto Health webhook ingress', SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME, 'providerUserId', suuntoValues, deletedRefKeys, failures, providerKeyedDeleteFilter(SUUNTO_HEALTH_WEBHOOK_INGRESS_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'Suunto workout queue', SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'Suunto workout queue', SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME, 'userName', suuntoValues, deletedRefKeys, failures, providerKeyedDeleteFilter(SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'COROS workout queue', COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'COROS workout queue', COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME, 'openId', corosValues, deletedRefKeys, failures, providerKeyedDeleteFilter(COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'Garmin workout queue', GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'Garmin workout queue', GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME, 'userID', garminValues, deletedRefKeys, failures, providerKeyedDeleteFilter(GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'Wahoo workout queue', WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME, 'firebaseUserID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'Wahoo workout queue', WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME, 'wahooUserID', wahooValues, deletedRefKeys, failures, providerKeyedDeleteFilter(WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME));
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'userID', firebaseUIDValues, deletedRefKeys, failures, failedJobFirebaseUidDeleteFilter);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'userID', garminValues, deletedRefKeys, failures, providerKeyedDeleteFilter('failed_jobs'));
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'firebaseUserID', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'uid', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'providerUserId', providerValues, deletedRefKeys, failures, providerKeyedDeleteFilter('failed_jobs'));
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'userName', suuntoValues, deletedRefKeys, failures, providerKeyedDeleteFilter('failed_jobs'));
    await recursiveDeleteQueryResults(db, uid, 'failed job', 'failed_jobs', 'openId', corosValues, deletedRefKeys, failures, providerKeyedDeleteFilter('failed_jobs'));
    await recursiveDeleteQueryResults(db, uid, 'sports-lib reparse job', SPORTS_LIB_REPARSE_JOBS_COLLECTION, 'uid', firebaseUIDValues, deletedRefKeys, failures);
    await recursiveDeleteQueryResults(db, uid, 'sports-lib route reparse job', SPORTS_LIB_ROUTE_REPARSE_JOBS_COLLECTION, 'uid', firebaseUIDValues, deletedRefKeys, failures);
    await cleanupLegacyProviderKeyedQueueOrphans(uid, identifiers, deletedRefKeys, failures);

    logger.info('[AccountDeletion] Operational pass finished.', {
        outcome: failures.length === startingFailureCount ? 'verified' : 'incomplete',
    });
}

export const ACCOUNT_DELETION_CLEANUP_RUNTIME_OPTIONS = {
    failurePolicy: true,
    timeoutSeconds: 540,
    memory: '512MB',
    secrets: FUNCTION_SECRET_BINDINGS.cleanupUserAccounts,
} as const;

export const cleanupUserAccounts = functions
    .region('europe-west2')
    .runWith(ACCOUNT_DELETION_CLEANUP_RUNTIME_OPTIONS)
    .auth.user().onDelete(async (user) => {
    const uid = user.uid;
    const db = admin.firestore();
    // Fail closed before any destructive stage if the durable fence cannot be established.
    const savedIdentifiers = await beginAccountDataCleanup(db, uid);
    const failures: CleanupFailures = [];
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
        },
        {
            name: 'Wahoo',
            deauthFn: (id) => cleanupServiceConnectionForUser(
                id,
                ServiceNames.WahooAPI,
                SERVICE_AUTH_CLEANUP_REASONS.AccountDeletion,
                { missingTokensBehavior: 'ignore' },
            ),
            collectionName: WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
            serviceName: ServiceNames.WahooAPI
        }
    ];
    const providerIdentifiers = await collectProviderIdentifiersForUser(uid, services, failures);
    for (const key of Object.keys(providerIdentifiers) as (keyof UserProviderIdentifiers)[]) {
        savedIdentifiers[key].forEach(value => providerIdentifiers[key].add(value));
    }
    await collectArchivedProviderIdentifiersForUser(uid, providerIdentifiers, failures);
    await collectProviderIdentifiersFromUidKeyedQueueState(db, uid, providerIdentifiers, failures);
    // Never erase identity sources after a partial read or failed checkpoint.
    await runCleanupStage(failures, 'identity_checkpoint', () => checkpointAccountDeletionIdentifiers(db, uid, {
        suuntoUserNames: [...providerIdentifiers.suuntoUserNames], corosOpenIds: [...providerIdentifiers.corosOpenIds],
        garminUserIDs: [...providerIdentifiers.garminUserIDs], wahooUserIDs: [...providerIdentifiers.wahooUserIDs],
    }));
    const identitySourcesSafeToDelete = failures.length === 0;
    if (identitySourcesSafeToDelete) {
        for (const service of services) {
            await runCleanupStage(failures, 'provider_tokens', () => safeDeauthorizeAndCleanup(uid, service));
        }
    }

    await cleanupUserScopedGeneratedState(uid, failures);
    await runCleanupStage(failures, 'route_originals', () => cleanupRejectedRouteOriginalFilesForUser(uid));
    await runCleanupStage(failures, 'mcp_oauth', () => cleanupMcpOAuthStateForUser(uid));
    await runCleanupStage(failures, 'marketing', () => cleanupMarketingCampaignRecipients(db, uid));

    // Cleanup Emails
    let mailCleanupError: unknown = null;
    try {
        logger.info(`[Cleanup] Deleting emails for user ${uid}`);
        const db = admin.firestore();
        const mailCollection = db.collection('mail');
        let deletionCount = 0;

        // 1. Query by UID (toUids array)
        const uidSnapshot = await mailCollection.where('toUids', 'array-contains', uid).get();

        // Campaign mail uses Auth email plus a UID marker without toUids,
        // avoiding a duplicate recipient in the Trigger Email extension.
        const marketingSnapshot = await mailCollection.where('marketing.uid', '==', uid).get();

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
        marketingSnapshot.docs.forEach(addMailDocIfDeletable);
        if (emailSnapshot) {
            emailSnapshot.docs.forEach(addMailDocIfDeletable);
        }

        // Mail documents are leaf records. A user can have more than 500
        // campaign messages, so commit bounded batches to stay under Firestore's
        // write limit and let the account-deletion trigger retry on failure.
        const mailRefs = Array.from(docsToDelete.values());
        for (let offset = 0; offset < mailRefs.length; offset += 400) {
            const batch = db.batch();
            for (const ref of mailRefs.slice(offset, offset + 400)) batch.delete(ref);
            await batch.commit();
            deletionCount += Math.min(400, mailRefs.length - offset);
        }

        if (deletionCount > 0) {
            logger.info(`[Cleanup] Deleted ${deletionCount} email documents for user ${uid}`);
        } else {
            logger.info(`[Cleanup] No email documents found for user ${uid}`);
        }

    } catch (e) {
        mailCleanupError = e;
        logger.error(`[Cleanup] Error deleting emails for ${uid}`, e);
    }

    if (mailCleanupError) failures.push({ stage: 'mail', error: mailCleanupError });
    if (identitySourcesSafeToDelete) {
        await cleanupTopLevelQueueState(uid, providerIdentifiers, failures);
        // A bounded reconciler may retain a lease/cursor. Its ACK is not completion.
        await runCleanupStage(failures, 'disconnect_tasks', () => cleanupServiceDisconnectTasksForUser(uid));
    }
    for (const collection of ACCOUNT_DELETION_ROOT_COLLECTIONS) {
        await runCleanupStage(failures, 'firestore_root', () => deleteAccountFirestoreRoot(db, uid, collection));
    }
    await runCleanupStage(failures, 'storage', () => deleteAccountStorageFiles(uid));
    for (const collection of ACCOUNT_DELETION_ROOT_COLLECTIONS) {
        await runCleanupStage(failures, 'firestore_verification', () => assertAccountFirestoreRootAbsent(db, uid, collection));
    }
    await runCleanupStage(failures, 'storage_verification', () => assertAccountStorageAbsent(uid));
    for (const collection of [SERVICE_DISCONNECT_CLEANUP_COLLECTION, REJECTED_ROUTE_ORIGINAL_CLEANUP_COLLECTION_NAME]) {
        await runCleanupStage(failures, 'deferred_cleanup_verification', () => assertAccountCleanupQueryEmpty(
            db.collection(collection).where('userID', '==', uid),
        ));
    }
    // Prove provider roots empty too; recursive deletion can race a stale writer.
    for (const service of services) {
        await runCleanupStage(failures, 'token_verification', () => assertAccountCleanupQueryEmpty(
            db.collection(service.collectionName).doc(uid).collection('tokens').limit(1),
        ));
    }
    if (failures.length) {
        logger.error('[AccountDeletion] Cleanup incomplete; retry required.', {
            outcome: 'incomplete', failedStages: [...new Set(failures.map(failure => failure.stage))],
        });
        const error = failures[0].error;
        throw error instanceof Error ? error : new Error('Account cleanup did not complete.');
    }
    await completeAccountDataCleanup(db, uid);
    logger.info('[AccountDeletion] Verified cleanup complete.', { outcome: 'complete' });
});
