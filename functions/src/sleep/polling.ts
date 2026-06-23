import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS, SleepProvider } from '../../../shared/sleep';
import {
    COROS_DAILY_MAX_WINDOW_DAYS,
    SLEEP_SYNC_RECENT_WINDOW_DAYS,
    SUUNTO_SLEEP_MAX_WINDOW_DAYS,
} from './constants';
import { addSleepSyncQueueItem } from './queue';
import {
    getAllowedSleepSyncUserIds,
    isSleepProviderEnabled,
    isSleepSyncUserAllowed,
    SLEEP_SYNC_DISABLED_PROVIDERS,
} from './provider-flags';
import { isServiceUnavailableForSyncForUser } from '../service-connection-meta';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { isProviderQueueUserDeletedOrDeletingError } from '../queue/provider-queue-errors';

interface PollWindow {
    startMs: number;
    endMs: number;
}

function chunkRecentWindow(nowMs: number, recentWindowDays: number, maxWindowDays: number): PollWindow[] {
    const maxWindowMs = maxWindowDays * 24 * 60 * 60 * 1000;
    const startMs = nowMs - recentWindowDays * 24 * 60 * 60 * 1000;
    const windows: PollWindow[] = [];
    for (let cursor = startMs; cursor < nowMs; cursor += maxWindowMs) {
        windows.push({
            startMs: cursor,
            endMs: Math.min(nowMs, cursor + maxWindowMs),
        });
    }
    return windows;
}

function getTokenRoot(provider: SleepProvider, userID: string): admin.firestore.CollectionReference | null {
    switch (provider) {
        case SLEEP_PROVIDERS.SuuntoApp:
            return admin.firestore().collection('suuntoAppAccessTokens').doc(userID).collection('tokens');
        case SLEEP_PROVIDERS.COROSAPI:
            return admin.firestore().collection('COROSAPIAccessTokens').doc(userID).collection('tokens');
        default:
            return null;
    }
}

async function getProviderTokenSnapshots(provider: SleepProvider, serviceName: ServiceNames): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const allowedUserIDs = getAllowedSleepSyncUserIds();
    if (allowedUserIDs.length > 0) {
        const snapshots = await Promise.all(allowedUserIDs.map(async (userID) => {
            const tokenRoot = getTokenRoot(provider, userID);
            if (!tokenRoot) {
                return [];
            }
            const snapshot = await tokenRoot.where('serviceName', '==', serviceName).get();
            return snapshot.docs;
        }));
        return snapshots.flat();
    }

    const snapshot = await admin.firestore()
        .collectionGroup('tokens')
        .where('serviceName', '==', serviceName)
        .get();
    return snapshot.docs;
}

function getFirebaseUserID(tokenSnapshot: admin.firestore.QueryDocumentSnapshot): string | null {
    return tokenSnapshot.ref.parent.parent?.id || null;
}

function getProviderUserId(provider: SleepProvider, tokenData: admin.firestore.DocumentData): string | null {
    switch (provider) {
        case SLEEP_PROVIDERS.SuuntoApp:
            return typeof tokenData.userName === 'string' ? tokenData.userName : null;
        case SLEEP_PROVIDERS.COROSAPI:
            return typeof tokenData.openId === 'string' ? tokenData.openId : null;
        default:
            return null;
    }
}

function getUnavailableForSyncStateBestEffort(
    provider: SleepProvider,
    userID: string,
    serviceName: ServiceNames,
): Promise<boolean> {
    return isServiceUnavailableForSyncForUser(userID, serviceName).catch((error: unknown) => {
        logger.warn(
            `[SleepSync][${provider}] Failed to read service connection state for user ${userID} and service ${serviceName}; continuing sleep polling.`,
            error,
        );
        return false;
    });
}

function getUserDeletionSkipStateBestEffort(
    provider: SleepProvider,
    userID: string,
): Promise<boolean> {
    return getUserDeletionGuardState(admin.firestore(), userID)
        .then((deletionGuard) => {
            if (deletionGuard.shouldSkip) {
                logger.info(`[SleepSync][${provider}] Skipping user ${userID} because the user is missing or deletion is in progress`);
            }
            return deletionGuard.shouldSkip;
        })
        .catch((error: unknown) => {
            logger.warn(
                `[SleepSync][${provider}] Failed to read deletion guard for user ${userID}; skipping sleep polling for this user.`,
                error,
            );
            return true;
        });
}

async function enqueueProviderPolls(
    provider: SleepProvider,
    serviceName: ServiceNames,
    maxWindowDays: number,
    nowMs = Date.now(),
): Promise<number> {
    if (!isSleepProviderEnabled(provider)) {
        logger.info(`[SleepSync][${provider}] Provider disabled by SLEEP_SYNC_DISABLED_PROVIDERS=${SLEEP_SYNC_DISABLED_PROVIDERS.join(',')}; skipping sleep polling`);
        return 0;
    }

    const windows = chunkRecentWindow(nowMs, SLEEP_SYNC_RECENT_WINDOW_DAYS, maxWindowDays);
    const tokenSnapshots = await getProviderTokenSnapshots(provider, serviceName);
    const deletionGuardCache = new Map<string, Promise<boolean>>();
    const unavailableForSyncCache = new Map<string, Promise<boolean>>();
    let queued = 0;
    for (const tokenSnapshot of tokenSnapshots) {
        const userID = getFirebaseUserID(tokenSnapshot);
        const providerUserId = getProviderUserId(provider, tokenSnapshot.data());
        if (!userID || !providerUserId || !isSleepSyncUserAllowed(userID)) {
            continue;
        }
        let pendingDeletionSkip = deletionGuardCache.get(userID);
        if (!pendingDeletionSkip) {
            pendingDeletionSkip = getUserDeletionSkipStateBestEffort(provider, userID);
            deletionGuardCache.set(userID, pendingDeletionSkip);
        }
        if (await pendingDeletionSkip) {
            continue;
        }
        const cacheKey = `${userID}:${serviceName}`;
        let pendingUnavailableForSync = unavailableForSyncCache.get(cacheKey);
        if (!pendingUnavailableForSync) {
            pendingUnavailableForSync = getUnavailableForSyncStateBestEffort(provider, userID, serviceName);
            unavailableForSyncCache.set(cacheKey, pendingUnavailableForSync);
        }
        if (await pendingUnavailableForSync) {
            logger.info(`[SleepSync][${provider}] Skipping user ${userID} because ${serviceName} is unavailable for sync`);
            continue;
        }
        for (const window of windows) {
            try {
                await addSleepSyncQueueItem({
                    type: provider === SLEEP_PROVIDERS.SuuntoApp ? 'suunto_poll' : 'coros_poll',
                    provider,
                    userID,
                    providerUserId,
                    rangeStartMs: window.startMs,
                    rangeEndMs: window.endMs,
                    dedupeKey: `${userID}:${window.startMs}:${window.endMs}`,
                });
                queued += 1;
            } catch (error) {
                if (isProviderQueueUserDeletedOrDeletingError(error)) {
                    logger.info(`[SleepSync][${provider}] Stopped queueing polls for user ${userID} because deletion started during queue creation.`);
                    break;
                }
                throw error;
            }
        }
    }
    return queued;
}

export const scheduleSuuntoSleepSync = onSchedule({
    region: 'europe-west2',
    schedule: 'every 24 hours',
    timeoutSeconds: 300,
    memory: '256MiB',
}, async () => {
    const queued = await enqueueProviderPolls(
        SLEEP_PROVIDERS.SuuntoApp,
        ServiceNames.SuuntoApp,
        SUUNTO_SLEEP_MAX_WINDOW_DAYS,
    );
    logger.info(`[SleepSync][Suunto] Scheduled ${queued} sleep poll queue items`);
});

export const scheduleCOROSSleepSync = onSchedule({
    region: 'europe-west2',
    schedule: 'every 24 hours',
    timeoutSeconds: 300,
    memory: '256MiB',
}, async () => {
    const queued = await enqueueProviderPolls(
        SLEEP_PROVIDERS.COROSAPI,
        ServiceNames.COROSAPI,
        COROS_DAILY_MAX_WINDOW_DAYS,
    );
    logger.info(`[SleepSync][COROS] Scheduled ${queued} sleep poll queue items`);
});

export const sleepPollingTestInternals = {
    chunkRecentWindow,
    enqueueProviderPolls,
};
