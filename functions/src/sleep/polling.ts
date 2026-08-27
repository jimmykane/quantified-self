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
import { getActiveCOROSTokenSnapshot } from '../coros/account';
import {
    SUUNTO_HEALTH_SYNC_ALLOWED_USER_IDS,
    isSuuntoHealthSyncUserAllowed,
} from '../suunto/health-rollout';
import { isSuuntoHealthSyncEnabled } from '../suunto/health-flags';
import {
    SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH,
    SUUNTO_HEALTH_MAX_WINDOW_DAYS,
} from '../suunto/health';
import { ensureSuuntoHealthWebhookAccountBindingForActiveToken } from '../suunto/health-webhook-binding-lifecycle';

interface PollWindow {
    startMs: number;
    endMs: number;
}

const COROS_ACTIVE_ACCOUNT_LOOKUP_CONCURRENCY = 20;

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

type PollingTokenSnapshot = admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;

async function resolveActiveCOROSTokenSnapshots(candidateUserIDs: readonly string[]): Promise<PollingTokenSnapshot[]> {
    const activeTokens: Array<PollingTokenSnapshot | null> = [];
    for (let index = 0; index < candidateUserIDs.length; index += COROS_ACTIVE_ACCOUNT_LOOKUP_CONCURRENCY) {
        const userIDChunk = candidateUserIDs.slice(index, index + COROS_ACTIVE_ACCOUNT_LOOKUP_CONCURRENCY);
        activeTokens.push(...await Promise.all(userIDChunk.map(async userID => {
            try {
                return await getActiveCOROSTokenSnapshot(userID);
            } catch (error) {
                logger.warn(`[SleepSync][${SLEEP_PROVIDERS.COROSAPI}] Could not resolve the active COROS account for user ${userID}; skipping polling.`, error);
                return null;
            }
        })));
    }
    return activeTokens.filter((token): token is PollingTokenSnapshot => token !== null);
}

async function getProviderTokenSnapshots(provider: SleepProvider, serviceName: ServiceNames): Promise<PollingTokenSnapshot[]> {
    const allowedUserIDs = getAllowedSleepSyncUserIds();
    if (provider === SLEEP_PROVIDERS.COROSAPI) {
        let candidateUserIDs = allowedUserIDs;
        if (candidateUserIDs.length === 0) {
            const snapshot = await admin.firestore()
                .collectionGroup('tokens')
                .where('serviceName', '==', serviceName)
                .get();
            candidateUserIDs = Array.from(new Set(snapshot.docs
                .map(token => getFirebaseUserID(token))
                .filter((userID): userID is string => !!userID)));
        }

        return resolveActiveCOROSTokenSnapshots(candidateUserIDs);
    }

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

function getFirebaseUserID(tokenSnapshot: PollingTokenSnapshot): string | null {
    return tokenSnapshot.ref.parent.parent?.id || null;
}

function getProviderUserId(provider: SleepProvider, tokenSnapshot: PollingTokenSnapshot): string | null {
    const tokenData = tokenSnapshot.data();
    switch (provider) {
        case SLEEP_PROVIDERS.SuuntoApp:
            return typeof tokenData?.userName === 'string' ? tokenData.userName : null;
        case SLEEP_PROVIDERS.COROSAPI:
            return typeof tokenData?.openId === 'string' && tokenData.openId.trim()
                ? tokenData.openId.trim()
                : tokenSnapshot.id;
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
            { errorName: error instanceof Error ? error.name : 'UnknownError' },
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
                { errorName: error instanceof Error ? error.name : 'UnknownError' },
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
        const providerUserId = getProviderUserId(provider, tokenSnapshot);
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

async function enqueueSuuntoHealthPolls(nowMs = Date.now()): Promise<number> {
    if (!isSuuntoHealthSyncEnabled()) {
        logger.info('[HealthSync][Suunto] Health ingestion is disabled; skipping polling');
        return 0;
    }

    const windows = chunkRecentWindow(
        nowMs,
        SLEEP_SYNC_RECENT_WINDOW_DAYS,
        SUUNTO_HEALTH_MAX_WINDOW_DAYS,
    );
    const tokenSnapshots = (await Promise.all(SUUNTO_HEALTH_SYNC_ALLOWED_USER_IDS.map(async userID => {
        const snapshot = await admin.firestore()
            .collection('suuntoAppAccessTokens')
            .doc(userID)
            .collection('tokens')
            .where('serviceName', '==', ServiceNames.SuuntoApp)
            .get();
        return snapshot.docs;
    }))).flat();
    const deletionGuardCache = new Map<string, Promise<boolean>>();
    const unavailableForSyncCache = new Map<string, Promise<boolean>>();
    let queued = 0;
    for (const tokenSnapshot of tokenSnapshots) {
        const userID = getFirebaseUserID(tokenSnapshot);
        const providerUserId = getProviderUserId(SLEEP_PROVIDERS.SuuntoApp, tokenSnapshot);
        if (!userID || !providerUserId || !isSuuntoHealthSyncUserAllowed(userID)) continue;
        if (providerUserId.length > SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH) {
            logger.warn('[HealthSync][Suunto] Skipping token with an invalid provider account identifier.', {
                userID,
            });
            continue;
        }

        let pendingDeletionSkip = deletionGuardCache.get(userID);
        if (!pendingDeletionSkip) {
            pendingDeletionSkip = getUserDeletionSkipStateBestEffort(SLEEP_PROVIDERS.SuuntoApp, userID);
            deletionGuardCache.set(userID, pendingDeletionSkip);
        }
        if (await pendingDeletionSkip) continue;

        let pendingUnavailableForSync = unavailableForSyncCache.get(userID);
        if (!pendingUnavailableForSync) {
            pendingUnavailableForSync = getUnavailableForSyncStateBestEffort(
                SLEEP_PROVIDERS.SuuntoApp,
                userID,
                ServiceNames.SuuntoApp,
            );
            unavailableForSyncCache.set(userID, pendingUnavailableForSync);
        }
        if (await pendingUnavailableForSync) continue;

        const bindingStatus = await ensureSuuntoHealthWebhookAccountBindingForActiveToken(
            admin.firestore(),
            userID,
            providerUserId,
            nowMs,
        );
        if (bindingStatus === 'conflict' || bindingStatus === 'inactive') {
            logger.warn('[HealthSync][Suunto] Skipping Health polling because the webhook account binding is not active.', {
                userID,
                bindingStatus,
            });
            continue;
        }

        for (const window of windows) {
            try {
                await addSleepSyncQueueItem({
                    type: 'suunto_health_poll',
                    provider: SLEEP_PROVIDERS.SuuntoApp,
                    userID,
                    providerUserId,
                    rangeStartMs: window.startMs,
                    rangeEndMs: window.endMs,
                    healthTrigger: 'poll',
                    dedupeKey: `suunto-health-poll:${userID}:${providerUserId}:${window.startMs}:${window.endMs}`,
                });
                queued += 1;
            } catch (error) {
                if (isProviderQueueUserDeletedOrDeletingError(error)) break;
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
    memory: '512MiB',
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

export const scheduleSuuntoHealthSync = onSchedule({
    region: 'europe-west2',
    schedule: 'every 24 hours',
    timeoutSeconds: 300,
    memory: '512MiB',
}, async () => {
    const queued = await enqueueSuuntoHealthPolls();
    logger.info('[HealthSync][Suunto] Scheduled Health poll queue items', { queued });
});

export const sleepPollingTestInternals = {
    chunkRecentWindow,
    enqueueProviderPolls,
    enqueueSuuntoHealthPolls,
    resolveActiveCOROSTokenSnapshots,
    COROS_ACTIVE_ACCOUNT_LOOKUP_CONCURRENCY,
};
