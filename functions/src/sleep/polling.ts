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

async function getProviderTokenSnapshots(serviceName: ServiceNames): Promise<admin.firestore.QueryDocumentSnapshot[]> {
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

async function enqueueProviderPolls(
    provider: SleepProvider,
    serviceName: ServiceNames,
    maxWindowDays: number,
    nowMs = Date.now(),
): Promise<number> {
    const windows = chunkRecentWindow(nowMs, SLEEP_SYNC_RECENT_WINDOW_DAYS, maxWindowDays);
    const tokenSnapshots = await getProviderTokenSnapshots(serviceName);
    let queued = 0;
    for (const tokenSnapshot of tokenSnapshots) {
        const userID = getFirebaseUserID(tokenSnapshot);
        const providerUserId = getProviderUserId(provider, tokenSnapshot.data());
        if (!userID || !providerUserId) {
            continue;
        }
        for (const window of windows) {
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
