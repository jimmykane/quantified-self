import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS, type SleepProvider } from '../../../shared/sleep';
import { ACTIVITY_SYNC_QUEUE_COLLECTION_NAME } from '../activity-sync/constants';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import {
    isPendingDisconnectQueueItemDeferred,
} from '../queue-utils';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';

type QueueDocData = Record<string, unknown>;

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

function isActivitySyncDeferredForService(data: QueueDocData, serviceName: ServiceNames): boolean {
    const deferredServiceName = `${data.deferredServiceName || ''}`.trim();
    if (deferredServiceName) {
        return deferredServiceName === serviceName;
    }

    return data.sourceServiceName === serviceName || data.destinationServiceName === serviceName;
}

async function releaseDeferredDocsForQuery(
    query: admin.firestore.Query,
    matchesService: (data: QueueDocData) => boolean,
    logContext: Record<string, unknown>,
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

        try {
            await doc.ref.update(updateData);
            return true;
        } catch (error) {
            logger.error('[PendingDisconnectQueueRelease] Failed to release deferred queue item.', {
                ...logContext,
                queueItemPath: doc.ref.path,
                error: error instanceof Error ? error.message : `${error}`,
            });
            return false;
        }
    }));

    return results.filter(Boolean).length;
}

export async function releaseQueueItemsDeferredForPendingDisconnect(
    userID: string,
    serviceName: ServiceNames,
): Promise<number> {
    const db = admin.firestore();
    const sleepProvider = getSleepProviderForService(serviceName);

    const [workoutCount, activitySyncCount, sleepSyncCount] = await Promise.all([
        releaseDeferredDocsForQuery(
            db.collection(getServiceWorkoutQueueName(serviceName)).where('firebaseUserID', '==', userID),
            () => true,
            { userID, serviceName, queueType: 'workout' },
        ),
        releaseDeferredDocsForQuery(
            db.collection(ACTIVITY_SYNC_QUEUE_COLLECTION_NAME).where('userID', '==', userID),
            (data) => isActivitySyncDeferredForService(data, serviceName),
            { userID, serviceName, queueType: 'activity_sync' },
        ),
        sleepProvider
            ? releaseDeferredDocsForQuery(
                db.collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME).where('userID', '==', userID),
                (data) => data.provider === sleepProvider,
                { userID, serviceName, queueType: 'sleep_sync' },
            )
            : Promise.resolve(0),
    ]);

    const releasedCount = workoutCount + activitySyncCount + sleepSyncCount;
    if (releasedCount > 0) {
        logger.info('[PendingDisconnectQueueRelease] Released deferred queue items after pending disconnect cleared.', {
            userID,
            serviceName,
            workoutCount,
            activitySyncCount,
            sleepSyncCount,
            releasedCount,
        });
    }

    return releasedCount;
}
