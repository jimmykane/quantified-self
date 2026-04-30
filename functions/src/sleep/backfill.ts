import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    SLEEP_PROVIDERS,
    SLEEP_SYNC_STATE_COLLECTION_ID,
    SLEEP_SYNC_STATUSES,
    SleepSyncState,
} from '../../../shared/sleep';
import {
    getSleepBackfillWindowDays,
    SLEEP_BACKFILL_COOLDOWN_MS,
    SLEEP_BACKFILL_START_DATE_ISO,
    SleepBackfillQueueResponse,
} from '../../../shared/sleep-backfill';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { getTokenData } from '../tokens';
import { isSleepProviderEnabled, isSleepSyncUserAllowed } from './provider-flags';
import { addSleepSyncQueueItem } from './queue';
import { updateSleepSyncState } from './writer';

interface SleepBackfillWindow {
    startMs: number;
    endMs: number;
}

interface SuuntoSleepBackfillToken {
    providerUserId: string;
}

function sleepSyncStateRef(userID: string): admin.firestore.DocumentReference {
    return admin.firestore()
        .collection('users')
        .doc(userID)
        .collection(SLEEP_SYNC_STATE_COLLECTION_ID)
        .doc(SLEEP_PROVIDERS.SuuntoApp);
}

export function chunkSleepBackfillRange(startMs: number, endMs: number, windowDays: number): SleepBackfillWindow[] {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(windowDays) || windowDays <= 0) {
        throw new Error('Invalid sleep backfill range');
    }
    if (endMs <= startMs) {
        return [];
    }

    const windowMs = Math.floor(windowDays * 24 * 60 * 60 * 1000);
    const windows: SleepBackfillWindow[] = [];
    let cursorMs = startMs;
    while (cursorMs < endMs) {
        const rangeEndMs = Math.min(endMs, cursorMs + windowMs);
        if (rangeEndMs <= cursorMs) {
            break;
        }
        windows.push({
            startMs: cursorMs,
            endMs: rangeEndMs,
        });
        cursorMs = rangeEndMs;
    }
    return windows;
}

async function getSuuntoSleepBackfillToken(userID: string): Promise<SuuntoSleepBackfillToken> {
    const tokenSnapshot = await admin.firestore()
        .collection('suuntoAppAccessTokens')
        .doc(userID)
        .collection('tokens')
        .get();

    for (const tokenDoc of tokenSnapshot.docs) {
        const tokenDocData = tokenDoc.data() as Record<string, unknown>;
        const storedServiceName = tokenDocData.serviceName;
        if (storedServiceName && storedServiceName !== ServiceNames.SuuntoApp) {
            continue;
        }

        try {
            const tokenData = await getTokenData(tokenDoc, ServiceNames.SuuntoApp, false) as { userName?: unknown };
            const providerUserId = `${tokenData.userName || ''}`.trim();
            if (providerUserId) {
                return {
                    providerUserId,
                };
            }
        } catch (error) {
            logger.warn(`[SleepBackfill] Could not use Suunto token ${tokenDoc.id} for ${userID}`, error);
        }
    }

    throw new HttpsError('failed-precondition', 'Connected Suunto token is required for sleep backfill.');
}

async function assertSleepBackfillCooldownAllows(userID: string, nowMs: number): Promise<void> {
    const stateSnapshot = await sleepSyncStateRef(userID).get();
    const state = stateSnapshot.exists ? stateSnapshot.data() as SleepSyncState : null;
    const nextAllowedAtMs = Number(state?.nextBackfillAllowedAtMs);
    if (Number.isFinite(nextAllowedAtMs) && nextAllowedAtMs > nowMs) {
        throw new HttpsError('resource-exhausted', `Sleep backfill is not allowed until ${new Date(nextAllowedAtMs).toISOString()}`);
    }
}

async function claimSleepBackfillCooldown(
    userID: string,
    startMs: number,
    endMs: number,
    nextAllowedAtMs: number,
): Promise<void> {
    const stateRef = sleepSyncStateRef(userID);
    await admin.firestore().runTransaction(async (transaction) => {
        const stateSnapshot = await transaction.get(stateRef);
        const state = stateSnapshot.exists ? stateSnapshot.data() as SleepSyncState : null;
        const existingNextAllowedAtMs = Number(state?.nextBackfillAllowedAtMs);
        if (Number.isFinite(existingNextAllowedAtMs) && existingNextAllowedAtMs > endMs) {
            throw new HttpsError('resource-exhausted', `Sleep backfill is not allowed until ${new Date(existingNextAllowedAtMs).toISOString()}`);
        }

        transaction.set(stateRef, {
            provider: SLEEP_PROVIDERS.SuuntoApp,
            status: SLEEP_SYNC_STATUSES.Ready,
            lastBackfillQueuedAtMs: endMs,
            lastBackfillStartMs: startMs,
            lastBackfillEndMs: endMs,
            lastBackfillQueueItems: 0,
            nextBackfillAllowedAtMs: nextAllowedAtMs,
            lastError: null,
            updatedAtMs: endMs,
        }, { merge: true });
    });
}

export const backfillSuuntoAppSleep = onCall({
    region: FUNCTIONS_MANIFEST.backfillSuuntoAppSleep.region,
    cors: ALLOWED_CORS_ORIGINS,
    memory: '512MiB',
    timeoutSeconds: 540,
    maxInstances: 5,
}, async (request): Promise<SleepBackfillQueueResponse> => {
    enforceAppCheck(request);

    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const userID = request.auth.uid;
    if (!(await hasProAccess(userID))) {
        logger.warn(`[SleepBackfill] Blocking Suunto sleep backfill for non-pro user ${userID}`);
        throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
    }

    if (!isSleepProviderEnabled(SLEEP_PROVIDERS.SuuntoApp)) {
        throw new HttpsError('failed-precondition', 'Suunto sleep sync is disabled.');
    }

    if (!isSleepSyncUserAllowed(userID)) {
        throw new HttpsError('permission-denied', 'Sleep sync is not enabled for this user.');
    }

    const nowMs = Date.now();
    await assertSleepBackfillCooldownAllows(userID, nowMs);

    const token = await getSuuntoSleepBackfillToken(userID);
    const startMs = new Date(SLEEP_BACKFILL_START_DATE_ISO).getTime();
    if (!Number.isFinite(startMs)) {
        throw new HttpsError('internal', 'Invalid sleep backfill start date.');
    }

    const windowDays = getSleepBackfillWindowDays(SLEEP_PROVIDERS.SuuntoApp);
    if (!windowDays) {
        throw new HttpsError('internal', 'Suunto sleep backfill window is not configured.');
    }

    const windows = chunkSleepBackfillRange(startMs, nowMs, windowDays);
    const nextAllowedAtMs = nowMs + SLEEP_BACKFILL_COOLDOWN_MS;
    await claimSleepBackfillCooldown(userID, startMs, nowMs, nextAllowedAtMs);

    let queued = 0;
    try {
        for (const window of windows) {
            await addSleepSyncQueueItem({
                type: 'suunto_poll',
                provider: SLEEP_PROVIDERS.SuuntoApp,
                userID,
                providerUserId: token.providerUserId,
                rangeStartMs: window.startMs,
                rangeEndMs: window.endMs,
                dedupeKey: `sleep-backfill:${userID}:${window.startMs}:${window.endMs}`,
            });
            queued += 1;
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : `${error}`;
        logger.error(`[SleepBackfill] Failed after queueing ${queued} Suunto sleep windows for ${userID}`, error);
        await updateSleepSyncState(userID, SLEEP_PROVIDERS.SuuntoApp, {
            status: SLEEP_SYNC_STATUSES.Failed,
            lastBackfillQueueItems: queued,
            lastError: message,
        }, Date.now());
        throw new HttpsError('internal', 'Could not queue Suunto sleep backfill.');
    }

    await updateSleepSyncState(userID, SLEEP_PROVIDERS.SuuntoApp, {
        status: SLEEP_SYNC_STATUSES.Ready,
        lastBackfillQueuedAtMs: nowMs,
        lastBackfillStartMs: startMs,
        lastBackfillEndMs: nowMs,
        lastBackfillQueueItems: queued,
        nextBackfillAllowedAtMs: nextAllowedAtMs,
        lastError: null,
    }, nowMs);

    logger.info(`[SleepBackfill] Queued ${queued} Suunto sleep windows for ${userID}`);

    return {
        queued,
        startDate: new Date(startMs).toISOString(),
        endDate: new Date(nowMs).toISOString(),
        nextAllowedAtMs,
    };
});
