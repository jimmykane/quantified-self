import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SERVICE_CONNECTION_STATES } from '../../../shared/service-connection';
import { SLEEP_PROVIDERS, type SleepProvider } from '../../../shared/sleep';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME } from '../route-delivery-sync/constants';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from '../routes/route-sync.constants';
import {
    isQueueItemDeferredForReason,
    QUEUE_DEFERRED_REASONS,
    type QueueDeferredReason,
} from '../queue-utils';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { getServiceTokenCollectionRef, getServiceTokenRootDocumentRef } from '../service-token-store';
import { isServiceDisconnectPendingData } from '../service-disconnect-pending-state';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

type QueueDocData = Record<string, unknown>;
type ProviderIdentifierField = 'userName' | 'openId' | 'userID';

interface ProviderQueueLookup {
    fieldName: ProviderIdentifierField;
    providerUserID: string;
}

interface ReleaseQuerySpec {
    query: admin.firestore.Query;
    matchesService: (data: QueueDocData) => boolean;
    logContext: Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
}

function buildDeferredQueueReleaseUpdate(): Record<string, unknown> {
    const deleteField = FieldValue.delete();
    return {
        processed: false,
        processedAt: deleteField,
        dispatchedToCloudTask: null,
        expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
        resultStatus: deleteField,
        deferredReason: deleteField,
        deferredContext: deleteField,
        deferredServiceName: deleteField,
        serviceDisconnectPendingDeferredAt: deleteField,
        serviceDisconnectPendingGeneration: deleteField,
        serviceDisconnectPendingNextDispatchAt: deleteField,
        serviceReconnectRequiredDeferredAt: deleteField,
    };
}

function getSleepProviderForService(serviceName: ServiceNames): SleepProvider | null {
    switch (serviceName) {
        case ServiceNames.GarminAPI:
            return SLEEP_PROVIDERS.GarminAPI;
        case ServiceNames.SuuntoApp:
            return SLEEP_PROVIDERS.SuuntoApp;
        case ServiceNames.COROSAPI:
            return SLEEP_PROVIDERS.COROSAPI;
        default:
            return null;
    }
}

function getProviderIdentifierFieldForService(serviceName: ServiceNames): ProviderIdentifierField | null {
    switch (serviceName) {
        case ServiceNames.GarminAPI:
            return 'userID';
        case ServiceNames.SuuntoApp:
            return 'userName';
        case ServiceNames.COROSAPI:
            return 'openId';
        default:
            return null;
    }
}

function isActivitySyncDeferredForService(data: QueueDocData, serviceName: ServiceNames): boolean {
    const deferredServiceName = `${data.deferredServiceName || ''}`.trim();
    if (deferredServiceName) {
        return deferredServiceName === serviceName;
    }

    return data.sourceServiceName === serviceName || data.destinationServiceName === serviceName;
}

function isRouteDeliverySyncDeferredForService(data: QueueDocData, serviceName: ServiceNames): boolean {
    const deferredServiceName = `${data.deferredServiceName || ''}`.trim();
    if (deferredServiceName) {
        return deferredServiceName === serviceName;
    }

    return data.sourceServiceName === serviceName || data.destinationServiceName === serviceName;
}

function isRouteSyncDeferredForService(data: QueueDocData, serviceName: ServiceNames): boolean {
    const deferredServiceName = `${data.deferredServiceName || ''}`.trim();
    if (deferredServiceName) {
        return deferredServiceName === serviceName;
    }

    return data.sourceServiceName === serviceName;
}

function isMissingOrMatchingLocalUser(data: QueueDocData, fieldName: 'firebaseUserID' | 'userID', userID: string): boolean {
    const localUserID = asNonEmptyString(data[fieldName]);
    return !localUserID || localUserID === userID;
}

async function collectProviderQueueLookupsForUser(
    userID: string,
    serviceName: ServiceNames,
): Promise<ProviderQueueLookup[]> {
    const fieldName = getProviderIdentifierFieldForService(serviceName);
    if (!fieldName) {
        return [];
    }

    try {
        const snapshot = await getServiceTokenCollectionRef(userID, serviceName).get();
        const seenProviderIDs = new Set<string>();
        const lookups: ProviderQueueLookup[] = [];
        snapshot.docs.forEach((doc) => {
            const providerUserID = asNonEmptyString((doc.data() as QueueDocData)[fieldName]);
            if (!providerUserID || seenProviderIDs.has(providerUserID)) {
                return;
            }
            seenProviderIDs.add(providerUserID);
            lookups.push({ fieldName, providerUserID });
        });
        return lookups;
    } catch (error) {
        const message = error instanceof Error ? error.message : `${error}`;
        logger.error('[PendingDisconnectQueueRelease] Failed to read provider identifiers for deferred queue release.', {
            userID,
            serviceName,
            error: message,
        });
        throw new Error(`Failed to read provider identifiers for ${serviceName} pending disconnect queue release: ${message}`);
    }
}

async function releaseDeferredDocsForQuery(
    userID: string,
    serviceName: ServiceNames,
    query: admin.firestore.Query,
    matchesService: (data: QueueDocData) => boolean,
    logContext: Record<string, unknown>,
    releasedQueueItemPaths: Set<string>,
    deferredReason: QueueDeferredReason,
    expectedGeneration?: string,
): Promise<number> {
    const snapshot = await query.get();
    if (snapshot.empty) {
        return 0;
    }

    const updateData = buildDeferredQueueReleaseUpdate();
    const results = await Promise.all(snapshot.docs.map(async (doc) => {
        const data = doc.data() as QueueDocData;
        if (!isQueueItemDeferredForReason(data, deferredReason) || !matchesService(data)) {
            return false;
        }

        if (releasedQueueItemPaths.has(doc.ref.path)) {
            return false;
        }

        try {
            // The broad query is necessarily non-transactional. Re-check the
            // live row before reopening it: concurrent OAuth callbacks can
            // otherwise apply a stale release after the scheduler has already
            // dispatched the first released row to a provider worker.
            const db = admin.firestore();
            const released = await db.runTransaction(async transaction => {
                let deletionGuard;
                try {
                    deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
                } catch (error) {
                    throw new UserDeletionGuardReadError(
                        userID,
                        `queue_release:${deferredReason}`,
                        error,
                    );
                }
                if (deletionGuard.shouldSkip) {
                    return false;
                }

                if (deferredReason === QUEUE_DEFERRED_REASONS.ServiceReconnectRequired) {
                    const serviceMetaSnapshot = await transaction.get(
                        db.collection('users').doc(userID).collection('meta').doc(serviceName),
                    );
                    if (
                        serviceMetaSnapshot.data()?.connectionState !== SERVICE_CONNECTION_STATES.Connected
                        || (expectedGeneration
                            && serviceMetaSnapshot.data()?.connectionStateGeneration !== expectedGeneration)
                    ) {
                        return false;
                    }
                } else {
                    const pendingRootSnapshot = await transaction.get(
                        getServiceTokenRootDocumentRef(userID, serviceName),
                    );
                    if (isServiceDisconnectPendingData(pendingRootSnapshot.data())) return false;
                }

                const currentSnapshot = await transaction.get(doc.ref);
                if (!currentSnapshot.exists) {
                    return false;
                }
                const currentData = currentSnapshot.data() as QueueDocData;
                if (!isQueueItemDeferredForReason(currentData, deferredReason) || !matchesService(currentData)) {
                    return false;
                }
                transaction.update(doc.ref, updateData);
                return true;
            });
            if (released) {
                releasedQueueItemPaths.add(doc.ref.path);
            }
            return released;
        } catch (error) {
            logger.error('[PendingDisconnectQueueRelease] Failed to release deferred queue item.', {
                ...logContext,
                queueItemPath: doc.ref.path,
                error: error instanceof Error ? error.message : `${error}`,
            });
            return 'failed' as const;
        }
    }));

    const failedCount = results.filter(result => result === 'failed').length;
    if (failedCount > 0) {
        throw new Error(`Failed to release ${failedCount} deferred queue item(s) for pending disconnect.`);
    }

    return results.filter(result => result === true).length;
}

async function releaseDeferredDocsForQueries(
    userID: string,
    serviceName: ServiceNames,
    specs: ReleaseQuerySpec[],
    releasedQueueItemPaths: Set<string>,
    deferredReason: QueueDeferredReason,
    expectedGeneration?: string,
): Promise<number> {
    let releasedCount = 0;
    for (const spec of specs) {
        releasedCount += await releaseDeferredDocsForQuery(
            userID,
            serviceName,
            spec.query,
            spec.matchesService,
            spec.logContext,
            releasedQueueItemPaths,
            deferredReason,
            expectedGeneration,
        );
    }
    return releasedCount;
}

export async function releaseQueueItemsDeferredForPendingDisconnect(
    userID: string,
    serviceName: ServiceNames,
    pendingDisconnectGeneration?: string,
): Promise<number> {
    return releaseQueueItemsDeferredForServiceState(
        userID,
        serviceName,
        QUEUE_DEFERRED_REASONS.ServiceDisconnectPending,
        pendingDisconnectGeneration,
    );
}

/** Releases work parked while a service was waiting for the user to reconnect it. */
export async function releaseQueueItemsDeferredForReconnectRequired(
    userID: string,
    serviceName: ServiceNames,
    connectionStateGeneration?: string,
): Promise<number> {
    return releaseQueueItemsDeferredForServiceState(
        userID,
        serviceName,
        QUEUE_DEFERRED_REASONS.ServiceReconnectRequired,
        connectionStateGeneration,
    );
}

async function releaseQueueItemsDeferredForServiceState(
    userID: string,
    serviceName: ServiceNames,
    deferredReason: QueueDeferredReason,
    expectedGeneration?: string,
): Promise<number> {
    const db = admin.firestore();
    const sleepProvider = getSleepProviderForService(serviceName);
    const workoutQueue = db.collection(getServiceWorkoutQueueName(serviceName));
    const sleepQueue = db.collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME);
    const routeSyncQueue = db.collection(ROUTE_SYNC_QUEUE_COLLECTION_NAME);
    const routeDeliverySyncQueue = db.collection(ROUTE_DELIVERY_SYNC_QUEUE_COLLECTION_NAME);
    const providerLookups = await collectProviderQueueLookupsForUser(userID, serviceName);
    const releasedQueueItemPaths = new Set<string>();

    const workoutQueries: ReleaseQuerySpec[] = [
        {
            query: workoutQueue.where('firebaseUserID', '==', userID),
            matchesService: () => true,
            logContext: { userID, serviceName, queueType: 'workout', lookupType: 'firebaseUserID' },
        },
        ...providerLookups.map((lookup) => ({
            query: workoutQueue.where(lookup.fieldName, '==', lookup.providerUserID),
            matchesService: (data: QueueDocData) => isMissingOrMatchingLocalUser(data, 'firebaseUserID', userID),
            logContext: {
                userID,
                serviceName,
                queueType: 'workout',
                lookupType: 'providerIdentifier',
                lookupField: lookup.fieldName,
            },
        })),
    ];

    const sleepQueries: ReleaseQuerySpec[] = sleepProvider ? [
        {
            query: sleepQueue.where('userID', '==', userID),
            matchesService: (data) => data.provider === sleepProvider,
            logContext: { userID, serviceName, queueType: 'sleep_sync', lookupType: 'userID' },
        },
        ...providerLookups.map((lookup) => ({
            query: sleepQueue.where('providerUserId', '==', lookup.providerUserID),
            matchesService: (data: QueueDocData) => (
                data.provider === sleepProvider
                && isMissingOrMatchingLocalUser(data, 'userID', userID)
            ),
            logContext: {
                userID,
                serviceName,
                queueType: 'sleep_sync',
                lookupType: 'providerIdentifier',
                lookupField: lookup.fieldName,
            },
        })),
    ] : [];

    const routeSyncQueries: ReleaseQuerySpec[] = [
        {
            query: routeSyncQueue.where('firebaseUserID', '==', userID),
            matchesService: (data) => isRouteSyncDeferredForService(data, serviceName),
            logContext: { userID, serviceName, queueType: 'route_sync', lookupType: 'firebaseUserID' },
        },
        ...providerLookups.map((lookup) => ({
            query: routeSyncQueue.where('providerUserId', '==', lookup.providerUserID),
            matchesService: (data: QueueDocData) => (
                isRouteSyncDeferredForService(data, serviceName)
                && isMissingOrMatchingLocalUser(data, 'firebaseUserID', userID)
            ),
            logContext: {
                userID,
                serviceName,
                queueType: 'route_sync',
                lookupType: 'providerIdentifier',
                lookupField: 'providerUserId',
                tokenLookupField: lookup.fieldName,
            },
        })),
    ];

    const [workoutCount, activitySyncCount, routeDeliverySyncCount, sleepSyncCount, routeSyncCount] = await Promise.all([
        releaseDeferredDocsForQueries(userID, serviceName, workoutQueries, releasedQueueItemPaths, deferredReason, expectedGeneration),
        releaseDeferredDocsForQuery(
            userID,
            serviceName,
            db.collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).where('userID', '==', userID),
            (data) => isActivitySyncDeferredForService(data, serviceName),
            { userID, serviceName, queueType: 'activity_sync' },
            releasedQueueItemPaths,
            deferredReason,
            expectedGeneration,
        ),
        releaseDeferredDocsForQuery(
            userID,
            serviceName,
            routeDeliverySyncQueue.where('userID', '==', userID),
            (data) => isRouteDeliverySyncDeferredForService(data, serviceName),
            { userID, serviceName, queueType: 'route_delivery_sync' },
            releasedQueueItemPaths,
            deferredReason,
            expectedGeneration,
        ),
        releaseDeferredDocsForQueries(userID, serviceName, sleepQueries, releasedQueueItemPaths, deferredReason, expectedGeneration),
        releaseDeferredDocsForQueries(userID, serviceName, routeSyncQueries, releasedQueueItemPaths, deferredReason, expectedGeneration),
    ]);

    const releasedCount = workoutCount + activitySyncCount + routeDeliverySyncCount + sleepSyncCount + routeSyncCount;
    if (releasedCount > 0) {
        logger.info('[PendingDisconnectQueueRelease] Released deferred queue items after pending disconnect cleared.', {
            userID,
            serviceName,
            workoutCount,
            activitySyncCount,
            routeDeliverySyncCount,
            sleepSyncCount,
            routeSyncCount,
            releasedCount,
        });
    }

    return releasedCount;
}
