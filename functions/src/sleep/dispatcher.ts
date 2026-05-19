import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS, type SleepProvider } from '../../../shared/sleep';
import { MAX_PENDING_TASKS, QUEUE_SCHEDULE } from '../shared/queue-config';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import { config } from '../config';
import { enqueueSleepSyncTask, getCloudTaskQueueDepthForQueue } from '../utils';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import {
    markQueueItemDispatchedIfUserActive,
    QueueDispatchMarkerResult,
} from '../queue/dispatch-marker';

const MAX_SLEEP_SYNC_QUEUE_SCAN = 500;
const SLEEP_SYNC_REDISPATCH_STALE_MS = 2 * 60 * 60 * 1000;
const SLEEP_SYNC_RECONCILIATION_PAGE_SIZE = 100;

function toDispatchTimestamp(value: unknown): number | null {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function toDateCreatedTimestamp(value: unknown): number {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
}

function toNonEmptyString(value: unknown): string | null {
    const normalized = `${value || ''}`.trim();
    return normalized.length > 0 ? normalized : null;
}

function toSleepProvider(value: unknown): SleepProvider | null {
    const provider = toNonEmptyString(value);
    if (!provider) {
        return null;
    }
    return Object.values(SLEEP_PROVIDERS).includes(provider as SleepProvider)
        ? provider as SleepProvider
        : null;
}

function tokenLookupForProvider(provider: SleepProvider): {
    serviceName: ServiceNames;
    providerUserField: 'userID' | 'userName' | 'openId';
} | null {
    switch (provider) {
        case SLEEP_PROVIDERS.GarminAPI:
            return { serviceName: ServiceNames.GarminAPI, providerUserField: 'userID' };
        case SLEEP_PROVIDERS.SuuntoApp:
            return { serviceName: ServiceNames.SuuntoApp, providerUserField: 'userName' };
        case SLEEP_PROVIDERS.COROSAPI:
            return { serviceName: ServiceNames.COROSAPI, providerUserField: 'openId' };
        default:
            return null;
    }
}

async function resolveFirebaseUserIDForSleepDispatchCandidate(
    provider: SleepProvider,
    providerUserId: string,
): Promise<string | null> {
    const lookup = tokenLookupForProvider(provider);
    if (!lookup) {
        return null;
    }

    const tokenSnapshot = await admin.firestore()
        .collectionGroup('tokens')
        .where('serviceName', '==', lookup.serviceName)
        .where(lookup.providerUserField, '==', providerUserId)
        .limit(1)
        .get();
    return tokenSnapshot.docs[0]?.ref.parent.parent?.id || null;
}

async function deleteSleepSyncCandidateBeforeDispatch(
    doc: admin.firestore.QueryDocumentSnapshot,
    reason: string,
): Promise<void> {
    try {
        await admin.firestore().recursiveDelete(doc.ref);
        logger.info(`[SleepSyncDispatcher] Deleted queue item ${doc.id} instead of dispatching: ${reason}.`);
    } catch (error) {
        logger.error(`[SleepSyncDispatcher] Failed to delete queue item ${doc.id} before dispatch after ${reason}`, error);
    }
}

async function shouldDispatchSleepSyncCandidate(
    doc: admin.firestore.QueryDocumentSnapshot,
    userID: string | null,
    provider: SleepProvider | null,
    providerUserId: string | null,
): Promise<boolean> {
    if (!provider || !providerUserId) {
        await deleteSleepSyncCandidateBeforeDispatch(doc, 'missing provider identity');
        return false;
    }

    let resolvedUserID = userID;
    if (!resolvedUserID) {
        try {
            resolvedUserID = await resolveFirebaseUserIDForSleepDispatchCandidate(provider, providerUserId);
        } catch (error) {
            logger.error(`[SleepSyncDispatcher] Failed to resolve Firebase uid for queue item ${doc.id}; leaving item undispatched for a future run.`, error);
            return false;
        }

        if (!resolvedUserID) {
            await deleteSleepSyncCandidateBeforeDispatch(doc, `provider user ${providerUserId} no longer resolves to a local token`);
            return false;
        }
    }

    try {
        const deletionGuard = await getUserDeletionGuardState(admin.firestore(), resolvedUserID);
        if (!deletionGuard.shouldSkip) {
            return true;
        }

        await deleteSleepSyncCandidateBeforeDispatch(doc, `user ${resolvedUserID} is missing or deletion is in progress`);
        return false;
    } catch (error) {
        logger.error(`[SleepSyncDispatcher] Failed to check deletion guard for queue item ${doc.id} and user ${resolvedUserID}; leaving item undispatched for a future run.`, error);
        return false;
    }
}

export async function reconcileSleepSyncQueueDispatches(nowMs = Date.now()): Promise<{
    inspected: number;
    dispatched: number;
    skippedRecent: number;
}> {
    const cloudTaskQueueId = config.cloudtasks.sleepSyncQueue;
    const pendingCloudTasks = await getCloudTaskQueueDepthForQueue(cloudTaskQueueId, true);
    if (pendingCloudTasks >= MAX_PENDING_TASKS) {
        logger.info(`[SleepSyncDispatcher] Queue busy (${pendingCloudTasks} pending tasks), skipping dispatch reconciliation.`);
        return {
            inspected: 0,
            dispatched: 0,
            skippedRecent: 0,
        };
    }

    const availableSlots = Math.max(0, MAX_PENDING_TASKS - pendingCloudTasks);
    if (availableSlots === 0) {
        return {
            inspected: 0,
            dispatched: 0,
            skippedRecent: 0,
        };
    }

    const scannedDocs: admin.firestore.QueryDocumentSnapshot[] = [];
    const pageSize = Math.min(SLEEP_SYNC_RECONCILIATION_PAGE_SIZE, MAX_SLEEP_SYNC_QUEUE_SCAN, MAX_PENDING_TASKS);
    let pageCursor: admin.firestore.QueryDocumentSnapshot | undefined;

    while (scannedDocs.length < MAX_SLEEP_SYNC_QUEUE_SCAN) {
        const remainingScanCapacity = MAX_SLEEP_SYNC_QUEUE_SCAN - scannedDocs.length;
        const currentPageSize = Math.min(pageSize, remainingScanCapacity);

        let query = admin.firestore()
            .collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME)
            .where('processed', '==', false)
            .orderBy('dateCreated', 'asc')
            .limit(currentPageSize);

        if (pageCursor) {
            query = query.startAfter(pageCursor);
        }

        const pageSnapshot = await query.get();
        if (pageSnapshot.empty) {
            break;
        }

        scannedDocs.push(...pageSnapshot.docs);
        if (pageSnapshot.docs.length < currentPageSize) {
            break;
        }

        pageCursor = pageSnapshot.docs[pageSnapshot.docs.length - 1];
    }

    if (!scannedDocs.length) {
        return {
            inspected: 0,
            dispatched: 0,
            skippedRecent: 0,
        };
    }

    const candidates = scannedDocs
        .map((doc) => {
            const data = doc.data() as Partial<SleepSyncQueueItemInterface>;
            const dispatchedToCloudTask = toDispatchTimestamp(data.dispatchedToCloudTask);
            const isUndispatched = dispatchedToCloudTask === null;
            const isStale = !isUndispatched && (nowMs - dispatchedToCloudTask) >= SLEEP_SYNC_REDISPATCH_STALE_MS;
            return {
                doc,
                isUndispatched,
                isStale,
                dispatchedToCloudTask,
                dateCreated: toDateCreatedTimestamp(data.dateCreated),
                userID: toNonEmptyString(data.userID),
                provider: toSleepProvider(data.provider),
                providerUserId: toNonEmptyString(data.providerUserId),
            };
        })
        .sort((left, right) => {
            const leftPriority = left.isUndispatched ? 0 : (left.isStale ? 1 : 2);
            const rightPriority = right.isUndispatched ? 0 : (right.isStale ? 1 : 2);
            if (leftPriority !== rightPriority) {
                return leftPriority - rightPriority;
            }

            return (left.dispatchedToCloudTask || 0) - (right.dispatchedToCloudTask || 0);
        });

    let dispatched = 0;
    let skippedRecent = 0;
    const dispatchLimit = Math.min(availableSlots, candidates.length);

    for (const candidate of candidates) {
        if (dispatched >= dispatchLimit) {
            break;
        }

        if (!candidate.isUndispatched && !candidate.isStale) {
            skippedRecent += 1;
            continue;
        }

        try {
            if (!(await shouldDispatchSleepSyncCandidate(
                candidate.doc,
                candidate.userID,
                candidate.provider,
                candidate.providerUserId,
            ))) {
                continue;
            }

            const wasTaskEnqueued = await enqueueSleepSyncTask(candidate.doc.id, candidate.dateCreated);
            if (!wasTaskEnqueued) {
                logger.info(`[SleepSyncDispatcher] Task not enqueued for ${candidate.doc.id}; leaving dispatch marker unchanged.`);
                continue;
            }
            const userIDForMarker = candidate.userID || (
                candidate.provider && candidate.providerUserId
                    ? await resolveFirebaseUserIDForSleepDispatchCandidate(candidate.provider, candidate.providerUserId)
                    : null
            );
            if (!userIDForMarker) {
                await deleteSleepSyncCandidateBeforeDispatch(candidate.doc, 'provider user no longer resolves to a local token before dispatch marker');
                continue;
            }
            const markerResult = await markQueueItemDispatchedIfUserActive({
                queueItemDocument: candidate.doc.ref,
                queueItemId: candidate.doc.id,
                userID: userIDForMarker,
                phase: 'sleep_sync_dispatch_marker',
                dispatchedAtMs: nowMs,
                logPrefix: 'SleepSyncDispatcher',
            });
            if (markerResult !== QueueDispatchMarkerResult.Marked) {
                continue;
            }
            dispatched += 1;
        } catch (error) {
            logger.error(`[SleepSyncDispatcher] Failed to dispatch queue item ${candidate.doc.id}`, error);
        }
    }

    return {
        inspected: candidates.length,
        dispatched,
        skippedRecent,
    };
}

export const dispatchSleepSyncQueue = functions.region('europe-west2').runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    maxInstances: 1,
}).pubsub.schedule(QUEUE_SCHEDULE).onRun(async () => {
    const result = await reconcileSleepSyncQueueDispatches();
    logger.info('[SleepSyncDispatcher] Reconciliation completed', result);
});
