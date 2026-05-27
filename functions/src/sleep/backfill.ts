import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    SLEEP_PROVIDERS,
    SLEEP_SYNC_STATE_COLLECTION_ID,
    SLEEP_SYNC_STATUSES,
    SleepSyncState,
    SleepProvider,
} from '../../../shared/sleep';
import {
    GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS,
    getSleepBackfillCooldownMs,
    getSleepBackfillWindowDays,
    SLEEP_BACKFILL_START_DATE_ISO,
    SleepBackfillQueueResponse,
} from '../../../shared/sleep-backfill';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE } from '../utils';
import { getTokenData } from '../tokens';
import { isSleepProviderEnabled, isSleepSyncUserAllowed } from './provider-flags';
import { addSleepSyncQueueItem } from './queue';
import { updateSleepSyncState } from './writer';
import * as requestPromise from '../request-helper';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';

const GARMIN_SLEEP_BACKFILL_URI = 'https://apis.garmin.com/wellness-api/rest/backfill/sleeps';

interface SleepBackfillWindow {
    startMs: number;
    endMs: number;
}

interface SuuntoSleepBackfillToken {
    providerUserId: string;
}

interface GarminSleepBackfillToken {
    accessToken: string;
    providerUserId: string;
}

function sleepSyncStateRef(userID: string, provider: SleepProvider): admin.firestore.DocumentReference {
    return admin.firestore()
        .collection('users')
        .doc(userID)
        .collection(SLEEP_SYNC_STATE_COLLECTION_ID)
        .doc(provider);
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

async function getGarminSleepBackfillToken(userID: string): Promise<GarminSleepBackfillToken> {
    const tokenSnapshot = await admin.firestore()
        .collection(GARMIN_API_TOKENS_COLLECTION_NAME)
        .doc(userID)
        .collection('tokens')
        .limit(1)
        .get();

    if (tokenSnapshot.empty) {
        throw new HttpsError('failed-precondition', 'Connected Garmin token is required for sleep backfill.');
    }

    try {
        const tokenData = await getTokenData(tokenSnapshot.docs[0], ServiceNames.GarminAPI) as {
            accessToken?: unknown;
            userID?: unknown;
            permissions?: unknown;
        };
        await assertGarminSleepBackfillPermissions(tokenData, userID);
        const accessToken = `${tokenData.accessToken || ''}`.trim();
        const providerUserId = `${tokenData.userID || tokenSnapshot.docs[0].id || ''}`.trim();
        if (!accessToken || !providerUserId) {
            throw new HttpsError('failed-precondition', 'Connected Garmin token is incomplete for sleep backfill.');
        }
        return {
            accessToken,
            providerUserId,
        };
    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }
        logger.error(`[SleepBackfill] Failed to use Garmin token for ${userID}`, error);
        throw new HttpsError('failed-precondition', 'Connected Garmin token is required for sleep backfill.');
    }
}

async function assertGarminSleepBackfillPermissions(
    tokenData: { permissions?: unknown },
    userID: string,
): Promise<void> {
    const permissions = Array.isArray(tokenData.permissions) ? tokenData.permissions : [];
    const missingPermissions = GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS
        .filter(permission => !permissions.includes(permission));
    if (!missingPermissions.length) {
        return;
    }

    try {
        await updateSleepSyncState(userID, SLEEP_PROVIDERS.GarminAPI, {
            status: SLEEP_SYNC_STATUSES.PermissionMissing,
            lastError: `Missing required Garmin permissions: ${missingPermissions.join(', ')}`,
        });
    } catch (error) {
        logger.warn(`[SleepBackfill] Failed to mark Garmin sleep permissions missing for ${userID}`, error);
    }
    throw new HttpsError(
        'failed-precondition',
        'Missing required Garmin permissions (Historical Data Export, Health Export). Please reconnect Garmin and grant health permissions.',
    );
}

async function assertSleepBackfillCooldownAllows(userID: string, provider: SleepProvider, nowMs: number): Promise<void> {
    const stateSnapshot = await sleepSyncStateRef(userID, provider).get();
    const state = stateSnapshot.exists ? stateSnapshot.data() as SleepSyncState : null;
    const nextAllowedAtMs = Number(state?.nextBackfillAllowedAtMs);
    if (Number.isFinite(nextAllowedAtMs) && nextAllowedAtMs > nowMs) {
        throw new HttpsError('resource-exhausted', `Sleep backfill is not allowed until ${new Date(nextAllowedAtMs).toISOString()}`);
    }
}

async function claimSleepBackfillCooldown(
    userID: string,
    provider: SleepProvider,
    startMs: number,
    endMs: number,
    nextAllowedAtMs: number,
): Promise<void> {
    const stateRef = sleepSyncStateRef(userID, provider);
    await admin.firestore().runTransaction(async (transaction) => {
        const stateSnapshot = await transaction.get(stateRef);
        const state = stateSnapshot.exists ? stateSnapshot.data() as SleepSyncState : null;
        const existingNextAllowedAtMs = Number(state?.nextBackfillAllowedAtMs);
        if (Number.isFinite(existingNextAllowedAtMs) && existingNextAllowedAtMs > endMs) {
            throw new HttpsError('resource-exhausted', `Sleep backfill is not allowed until ${new Date(existingNextAllowedAtMs).toISOString()}`);
        }

        transaction.set(stateRef, {
            provider,
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

function getSharedSleepBackfillStartMs(): number {
    const startMs = new Date(SLEEP_BACKFILL_START_DATE_ISO).getTime();
    if (!Number.isFinite(startMs)) {
        throw new HttpsError('internal', 'Invalid sleep backfill start date.');
    }
    return startMs;
}

function getConfiguredSleepBackfillWindowDays(provider: SleepProvider, providerLabel: string): number {
    const windowDays = getSleepBackfillWindowDays(provider);
    if (!windowDays) {
        throw new HttpsError('internal', `${providerLabel} sleep backfill window is not configured.`);
    }
    return windowDays;
}

function getConfiguredSleepBackfillCooldownMs(provider: SleepProvider, providerLabel: string): number {
    const cooldownMs = getSleepBackfillCooldownMs(provider);
    if (!cooldownMs) {
        throw new HttpsError('internal', `${providerLabel} sleep backfill cooldown is not configured.`);
    }
    return cooldownMs;
}

async function requestGarminSleepBackfillWindow(
    token: GarminSleepBackfillToken,
    window: SleepBackfillWindow,
): Promise<boolean> {
    try {
        await requestPromise.get({
            headers: {
                Authorization: `Bearer ${token.accessToken}`,
            },
            url: `${GARMIN_SLEEP_BACKFILL_URI}?summaryStartTimeInSeconds=${Math.floor(window.startMs / 1000)}&summaryEndTimeInSeconds=${Math.floor(window.endMs / 1000)}`,
        });
        return true;
    } catch (error: any) {
        if (error?.statusCode === 400 && `${error?.error?.error?.errorMessage || ''}`.includes('before min start time')) {
            logger.warn(`[SleepBackfill] Skipping Garmin sleep backfill window before min start time: ${error.error.error.errorMessage}`);
            return false;
        }
        if (error?.statusCode === 409) {
            logger.warn(`[SleepBackfill] Garmin sleep backfill window was already requested: ${new Date(window.startMs).toISOString()} - ${new Date(window.endMs).toISOString()}`);
            return false;
        }
        throw error;
    }
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
    await assertSleepBackfillCooldownAllows(userID, SLEEP_PROVIDERS.SuuntoApp, nowMs);

    const token = await getSuuntoSleepBackfillToken(userID);
    const startMs = getSharedSleepBackfillStartMs();
    const windowDays = getConfiguredSleepBackfillWindowDays(SLEEP_PROVIDERS.SuuntoApp, 'Suunto');

    const windows = chunkSleepBackfillRange(startMs, nowMs, windowDays);
    const nextAllowedAtMs = nowMs + getConfiguredSleepBackfillCooldownMs(SLEEP_PROVIDERS.SuuntoApp, 'Suunto');
    await claimSleepBackfillCooldown(userID, SLEEP_PROVIDERS.SuuntoApp, startMs, nowMs, nextAllowedAtMs);

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
            nextBackfillAllowedAtMs: null,
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

export const backfillGarminAPISleep = onCall({
    region: FUNCTIONS_MANIFEST.backfillGarminAPISleep.region,
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
        logger.warn(`[SleepBackfill] Blocking Garmin sleep backfill for non-pro user ${userID}`);
        throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
    }

    if (!isSleepProviderEnabled(SLEEP_PROVIDERS.GarminAPI)) {
        throw new HttpsError('failed-precondition', 'Garmin sleep sync is disabled.');
    }

    if (!isSleepSyncUserAllowed(userID)) {
        throw new HttpsError('permission-denied', 'Sleep sync is not enabled for this user.');
    }

    const nowMs = Date.now();
    await assertSleepBackfillCooldownAllows(userID, SLEEP_PROVIDERS.GarminAPI, nowMs);

    const token = await getGarminSleepBackfillToken(userID);
    const startMs = getSharedSleepBackfillStartMs();
    const windowDays = getConfiguredSleepBackfillWindowDays(SLEEP_PROVIDERS.GarminAPI, 'Garmin');
    const windows = chunkSleepBackfillRange(startMs, nowMs, windowDays);
    const nextAllowedAtMs = nowMs + getConfiguredSleepBackfillCooldownMs(SLEEP_PROVIDERS.GarminAPI, 'Garmin');
    await claimSleepBackfillCooldown(userID, SLEEP_PROVIDERS.GarminAPI, startMs, nowMs, nextAllowedAtMs);

    let requested = 0;
    try {
        for (const window of windows) {
            if (await requestGarminSleepBackfillWindow(token, window)) {
                requested += 1;
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : `${error}`;
        logger.error(`[SleepBackfill] Failed after requesting ${requested} Garmin sleep windows for ${userID}`, error);
        await updateSleepSyncState(userID, SLEEP_PROVIDERS.GarminAPI, {
            status: SLEEP_SYNC_STATUSES.Failed,
            lastBackfillQueueItems: requested,
            nextBackfillAllowedAtMs: null,
            lastError: message,
        }, Date.now());
        throw new HttpsError('internal', 'Could not request Garmin sleep backfill.');
    }

    await updateSleepSyncState(userID, SLEEP_PROVIDERS.GarminAPI, {
        status: SLEEP_SYNC_STATUSES.Ready,
        lastBackfillQueuedAtMs: nowMs,
        lastBackfillStartMs: startMs,
        lastBackfillEndMs: nowMs,
        lastBackfillQueueItems: requested,
        nextBackfillAllowedAtMs: nextAllowedAtMs,
        lastError: null,
    }, nowMs);

    logger.info(`[SleepBackfill] Requested ${requested} Garmin sleep windows for ${userID}`, {
        providerUserId: token.providerUserId,
    });

    return {
        queued: requested,
        startDate: new Date(startMs).toISOString(),
        endDate: new Date(nowMs).toISOString(),
        nextAllowedAtMs,
    };
});
