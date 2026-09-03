import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
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
import { isSuuntoHealthSyncEnabled } from '../suunto/health-flags';
import {
    SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH,
    SUUNTO_HEALTH_MAX_WINDOW_DAYS,
} from '../suunto/health';

interface PollWindow {
    startMs: number;
    endMs: number;
}

const COROS_ACTIVE_ACCOUNT_LOOKUP_CONCURRENCY = 20;
const SUUNTO_SLEEP_POLL_ROOT_PAGE_SIZE = 100;
const SUUNTO_HEALTH_POLL_ROOT_PAGE_SIZE = 25;
const SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT = 8;
const SUUNTO_SLEEP_POLL_MIN_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SUUNTO_SLEEP_POLL_MAX_SWEEP_AGE_MS = 6 * 24 * 60 * 60 * 1000;
const PROVIDER_MAINTENANCE_STATE_COLLECTION = 'providerMaintenanceState';
const SUUNTO_SLEEP_POLL_CURSOR_DOCUMENT = 'suuntoSleepPolling';
const SUUNTO_HEALTH_POLL_CURSOR_DOCUMENT = 'suuntoHealthPolling';
const SUUNTO_HEALTH_POLL_CURSOR_SCOPE = 'global-v1';
interface ProviderTokenSnapshotPage {
    snapshots: PollingTokenSnapshot[];
    commitCursor?: () => Promise<void>;
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

async function getPagedSuuntoTokenSnapshots(
    cursorDocumentID: string,
    rootPageSize: number,
    nowMs = Date.now(),
    minimumSweepIntervalMs = 0,
    allowedUserIDs: readonly string[] = [],
    cursorScope?: string,
): Promise<ProviderTokenSnapshotPage & { commitCursor: () => Promise<void> }> {
    const db = admin.firestore();
    const cursorRef = db.collection(PROVIDER_MAINTENANCE_STATE_COLLECTION)
        .doc(cursorDocumentID);
    const cursorSnapshot = await cursorRef.get();
    const storedCursorData = cursorSnapshot.data() as Record<string, unknown> | undefined;
    const cursorData = cursorScope === undefined || storedCursorData?.cursorScope === cursorScope
        ? storedCursorData
        : undefined;
    const lastCompletedUserID = typeof cursorData?.lastCompletedUserID === 'string'
        && cursorData.lastCompletedUserID.trim()
        ? cursorData.lastCompletedUserID
        : null;
    const currentUserID = typeof cursorData?.currentUserID === 'string'
        && cursorData.currentUserID.trim()
        ? cursorData.currentUserID
        : null;
    const lastProcessedTokenID = currentUserID
        && typeof cursorData?.lastProcessedTokenID === 'string'
        && cursorData.lastProcessedTokenID.trim()
        ? cursorData.lastProcessedTokenID
        : null;
    const lastCompletedSweepAtMs = Number(cursorData?.lastCompletedSweepAtMs);
    const sweepStartedAtMs = Number(cursorData?.sweepStartedAtMs);
    if (!lastCompletedUserID
        && !currentUserID
        && Number.isFinite(lastCompletedSweepAtMs)
        && lastCompletedSweepAtMs > 0
        && nowMs - lastCompletedSweepAtMs < minimumSweepIntervalMs) {
        return {
            snapshots: [],
            commitCursor: async () => undefined,
        };
    }
    if (Number.isFinite(sweepStartedAtMs)
        && sweepStartedAtMs > 0
        && nowMs - sweepStartedAtMs > SUUNTO_SLEEP_POLL_MAX_SWEEP_AGE_MS) {
        logger.warn('[SleepSync][Suunto] Canonical account sweep is approaching the recovery-window limit.', {
            cursorDocumentID,
            sweepAgeMs: nowMs - sweepStartedAtMs,
        });
    }

    let rootPage: Array<{
        userID: string;
        snapshot: admin.firestore.DocumentSnapshot | null;
    }> = [];
    let hasMoreRoots = false;
    if (currentUserID) {
        const currentRootSnapshot = await db.collection('suuntoAppAccessTokens')
            .doc(currentUserID)
            .get();
        rootPage = [{
            userID: currentUserID,
            snapshot: currentRootSnapshot.exists ? currentRootSnapshot : null,
        }];
    } else if (allowedUserIDs.length > 0) {
        const normalizedAllowedUserIDs = [...new Set(allowedUserIDs
            .map(userID => userID.trim())
            .filter(userID => userID.length > 0))].sort();
        const remainingUserIDs = normalizedAllowedUserIDs
            .filter(userID => !lastCompletedUserID || userID > lastCompletedUserID);
        const selectedUserIDs = remainingUserIDs.slice(0, rootPageSize);
        rootPage = await Promise.all(selectedUserIDs.map(async userID => {
            const snapshot = await db.collection('suuntoAppAccessTokens').doc(userID).get();
            return { userID, snapshot: snapshot.exists ? snapshot : null };
        }));
        hasMoreRoots = remainingUserIDs.length > rootPageSize;
    } else {
        let rootQuery: admin.firestore.Query = db.collection('suuntoAppAccessTokens')
            .orderBy(FieldPath.documentId());
        if (lastCompletedUserID) rootQuery = rootQuery.startAfter(lastCompletedUserID);
        const rootSnapshot = await rootQuery.limit(rootPageSize + 1).get();
        rootPage = rootSnapshot.docs.slice(0, rootPageSize).map(snapshot => ({
            userID: snapshot.id,
            snapshot,
        }));
        hasMoreRoots = rootSnapshot.docs.length > rootPageSize;
    }

    const snapshots: PollingTokenSnapshot[] = [];
    // The user may have disconnected or completed deletion between pages;
    // advance past a vanished canonical root instead of pinning the sweep.
    let completedUserID = lastCompletedUserID;
    let partialUserID: string | null = null;
    let partialTokenID: string | null = null;
    for (const rootEntry of rootPage) {
        if (!rootEntry.snapshot) {
            completedUserID = rootEntry.userID;
            continue;
        }
        let tokenQuery: admin.firestore.Query = rootEntry.snapshot.ref.collection('tokens')
            .where('serviceName', '==', ServiceNames.SuuntoApp)
            .orderBy(FieldPath.documentId());
        if (currentUserID === rootEntry.userID && lastProcessedTokenID) {
            tokenQuery = tokenQuery.startAfter(lastProcessedTokenID);
        }
        const tokenSnapshot = await tokenQuery
            .limit(SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT + 1)
            .get();
        const selectedTokens = tokenSnapshot.docs.slice(0, SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT);
        snapshots.push(...selectedTokens);
        if (tokenSnapshot.docs.length > SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT) {
            partialUserID = rootEntry.userID;
            partialTokenID = selectedTokens[selectedTokens.length - 1]?.id || null;
            break;
        }
        completedUserID = rootEntry.userID;
    }
    const resumedRootNeedsAnotherInvocation = !!currentUserID && !partialUserID;
    const hasMoreWork = !!partialUserID || resumedRootNeedsAnotherInvocation || hasMoreRoots;
    const currentSweepStartedAtMs = Number.isFinite(sweepStartedAtMs) && sweepStartedAtMs > 0
        ? sweepStartedAtMs
        : nowMs;
    return {
        snapshots,
        commitCursor: async () => {
            await cursorRef.set({
                ...(cursorScope ? { cursorScope } : {}),
                lastCompletedUserID: hasMoreWork ? completedUserID : null,
                currentUserID: partialUserID,
                // This short-lived keyset stays in a backend-only maintenance
                // document and is cleared as soon as this account page ends.
                lastProcessedTokenID: partialTokenID,
                rootPageSize,
                perRootTokenLimit: SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT,
                sweepStartedAtMs: hasMoreWork ? currentSweepStartedAtMs : null,
                lastCompletedSweepAtMs: hasMoreWork
                    ? (Number.isFinite(lastCompletedSweepAtMs) && lastCompletedSweepAtMs > 0
                        ? lastCompletedSweepAtMs
                        : null)
                    : nowMs,
                updatedAtMs: nowMs,
            }, { merge: false });
        },
    };
}

async function getProviderTokenSnapshots(
    provider: SleepProvider,
    serviceName: ServiceNames,
    nowMs: number,
): Promise<ProviderTokenSnapshotPage> {
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

        return { snapshots: await resolveActiveCOROSTokenSnapshots(candidateUserIDs) };
    }

    if (allowedUserIDs.length > 0) {
        if (provider === SLEEP_PROVIDERS.SuuntoApp) {
            return getPagedSuuntoTokenSnapshots(
                SUUNTO_SLEEP_POLL_CURSOR_DOCUMENT,
                SUUNTO_SLEEP_POLL_ROOT_PAGE_SIZE,
                nowMs,
                SUUNTO_SLEEP_POLL_MIN_SWEEP_INTERVAL_MS,
                allowedUserIDs,
            );
        }
        const snapshots = await Promise.all(allowedUserIDs.map(async (userID) => {
            const tokenRoot = getTokenRoot(provider, userID);
            if (!tokenRoot) {
                return [];
            }
            const snapshot = await tokenRoot.where('serviceName', '==', serviceName).get();
            return snapshot.docs;
        }));
        return { snapshots: snapshots.flat() };
    }

    if (provider === SLEEP_PROVIDERS.SuuntoApp) {
        return getPagedSuuntoTokenSnapshots(
            SUUNTO_SLEEP_POLL_CURSOR_DOCUMENT,
            SUUNTO_SLEEP_POLL_ROOT_PAGE_SIZE,
            nowMs,
            SUUNTO_SLEEP_POLL_MIN_SWEEP_INTERVAL_MS,
        );
    }

    const snapshot = await admin.firestore().collectionGroup('tokens')
        .where('serviceName', '==', serviceName).get();
    return { snapshots: snapshot.docs };
}

function getFirebaseUserID(tokenSnapshot: PollingTokenSnapshot): string | null {
    return tokenSnapshot.ref.parent.parent?.id || null;
}

function getProviderUserId(provider: SleepProvider, tokenSnapshot: PollingTokenSnapshot): string | null {
    const tokenData = tokenSnapshot.data();
    switch (provider) {
        case SLEEP_PROVIDERS.SuuntoApp: {
            const providerUserId = typeof tokenData?.userName === 'string'
                ? tokenData.userName.trim()
                : '';
            return providerUserId
                && providerUserId === tokenData?.userName
                && providerUserId === tokenSnapshot.id
                ? providerUserId
                : null;
        }
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
    const tokenPage = await getProviderTokenSnapshots(provider, serviceName, nowMs);
    const deletionGuardCache = new Map<string, Promise<boolean>>();
    const unavailableForSyncCache = new Map<string, Promise<boolean>>();
    let queued = 0;
    for (const tokenSnapshot of tokenPage.snapshots) {
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
    await tokenPage.commitCursor?.();
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
    const tokenPage = await getPagedSuuntoTokenSnapshots(
        SUUNTO_HEALTH_POLL_CURSOR_DOCUMENT,
        SUUNTO_HEALTH_POLL_ROOT_PAGE_SIZE,
        nowMs,
        SUUNTO_SLEEP_POLL_MIN_SWEEP_INTERVAL_MS,
        [],
        SUUNTO_HEALTH_POLL_CURSOR_SCOPE,
    );
    const deletionGuardCache = new Map<string, Promise<boolean>>();
    const unavailableForSyncCache = new Map<string, Promise<boolean>>();
    let queued = 0;
    for (const tokenSnapshot of tokenPage.snapshots) {
        const userID = getFirebaseUserID(tokenSnapshot);
        const providerUserId = getProviderUserId(SLEEP_PROVIDERS.SuuntoApp, tokenSnapshot);
        if (!userID || !providerUserId) continue;
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
    await tokenPage.commitCursor();
    return queued;
}

export const scheduleSuuntoSleepSync = onSchedule({
    region: 'europe-west2',
    // A keyset page is advanced every invocation until the canonical account
    // sweep completes, then the maintenance cursor pauses for 24 hours.
    schedule: 'every 30 minutes',
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
    // Advance bounded retained-account pages promptly, then pause for 24h
    // once the production-wide Health sweep completes.
    schedule: 'every 30 minutes',
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
    getPagedSuuntoTokenSnapshots,
    resolveActiveCOROSTokenSnapshots,
    COROS_ACTIVE_ACCOUNT_LOOKUP_CONCURRENCY,
    SUUNTO_HEALTH_POLL_ROOT_PAGE_SIZE,
    SUUNTO_SLEEP_POLL_ROOT_PAGE_SIZE,
    SUUNTO_TOKEN_CANDIDATES_PER_ROOT_LIMIT,
};
