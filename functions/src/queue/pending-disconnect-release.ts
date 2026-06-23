import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS, type SleepProvider } from '../../../shared/sleep';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME } from '../routes/route-sync.constants';
import {
    isPendingDisconnectQueueItemDeferred,
} from '../queue-utils';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { getServiceTokenCollectionRef } from '../service-token-store';

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
    const deleteField = admin.firestore.FieldValue.delete();
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
        serviceDisconnectPendingNextDispatchAt: deleteField,
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
    query: admin.firestore.Query,
    matchesService: (data: QueueDocData) => boolean,
    logContext: Record<string, unknown>,
    releasedQueueItemPaths: Set<string>,
): Promise<number> {
    const snapshot = await query.get();
    if (snapshot.empty) {
        return 0;
    }

    const updateData = buildDeferredQueueReleaseUpdate();
    const results = await Promise.all(snapshot.docs.map(async (doc) => {
        const data = doc.data() as QueueDocData;
        if (!isPendingDisconnectQueueItemDeferred(data) || !matchesService(data)) {
            return false;
        }

        if (releasedQueueItemPaths.has(doc.ref.path)) {
            return false;
        }

        try {
            await doc.ref.update(updateData);
            releasedQueueItemPaths.add(doc.ref.path);
            return true;
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
    specs: ReleaseQuerySpec[],
    releasedQueueItemPaths: Set<string>,
): Promise<number> {
    let releasedCount = 0;
    for (const spec of specs) {
        releasedCount += await releaseDeferredDocsForQuery(
            spec.query,
            spec.matchesService,
            spec.logContext,
            releasedQueueItemPaths,
        );
    }
    return releasedCount;
}

export async function releaseQueueItemsDeferredForPendingDisconnect(
    userID: string,
    serviceName: ServiceNames,
): Promise<number> {
    const db = admin.firestore();
    const sleepProvider = getSleepProviderForService(serviceName);
    const workoutQueue = db.collection(getServiceWorkoutQueueName(serviceName));
    const sleepQueue = db.collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME);
    const routeSyncQueue = db.collection(ROUTE_SYNC_QUEUE_COLLECTION_NAME);
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

    const [workoutCount, activitySyncCount, sleepSyncCount, routeSyncCount] = await Promise.all([
        releaseDeferredDocsForQueries(workoutQueries, releasedQueueItemPaths),
        releaseDeferredDocsForQuery(
            db.collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).where('userID', '==', userID),
            (data) => isActivitySyncDeferredForService(data, serviceName),
            { userID, serviceName, queueType: 'activity_sync' },
            releasedQueueItemPaths,
        ),
        releaseDeferredDocsForQueries(sleepQueries, releasedQueueItemPaths),
        releaseDeferredDocsForQueries(routeSyncQueries, releasedQueueItemPaths),
    ]);

    const releasedCount = workoutCount + activitySyncCount + sleepSyncCount + routeSyncCount;
    if (releasedCount > 0) {
        logger.info('[PendingDisconnectQueueRelease] Released deferred queue items after pending disconnect cleared.', {
            userID,
            serviceName,
            workoutCount,
            activitySyncCount,
            sleepSyncCount,
            routeSyncCount,
            releasedCount,
        });
    }

    return releasedCount;
}
