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
    getCorosSleepBackfillStartMs,
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
import {
    getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { isServiceUnavailableForSyncForUser } from '../service-connection-meta';

const GARMIN_SLEEP_BACKFILL_URI = 'https://apis.garmin.com/wellness-api/rest/backfill/sleeps';
const GARMIN_BACKFILL_SECOND_MS = 1000;

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

interface CorosSleepBackfillToken {
    providerUserId: string;
}

type GarminSleepBackfillRequestResult = 'requested' | 'skipped' | 'aborted';

interface GarminSleepBackfillRequestContext {
    providerUserId: string;
    providerMinStartMs: number | null;
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
        .get();

    if (tokenSnapshot.empty) {
        throw new HttpsError('failed-precondition', 'Connected Garmin token is required for sleep backfill.');
    }

    let bestMissingPermissions: string[] | null = null;
    let foundIncompletePermittedToken = false;
    let lastTokenReadError: unknown = null;
    for (const tokenDoc of tokenSnapshot.docs) {
        try {
            const tokenData = await getTokenData(tokenDoc, ServiceNames.GarminAPI) as {
                accessToken?: unknown;
                userID?: unknown;
                permissions?: unknown;
            };
            const missingPermissions = getMissingGarminSleepBackfillPermissions(tokenData);
            if (missingPermissions.length) {
                if (!bestMissingPermissions || missingPermissions.length < bestMissingPermissions.length) {
                    bestMissingPermissions = missingPermissions;
                }
                continue;
            }

            const accessToken = `${tokenData.accessToken || ''}`.trim();
            const providerUserId = `${tokenData.userID || tokenDoc.id || ''}`.trim();
            if (!accessToken || !providerUserId) {
                foundIncompletePermittedToken = true;
                logger.warn(`[SleepBackfill] Skipping incomplete Garmin token ${tokenDoc.id} for ${userID}`);
                continue;
            }
            return {
                accessToken,
                providerUserId,
            };
        } catch (error) {
            lastTokenReadError = error;
            logger.warn(`[SleepBackfill] Could not use Garmin token ${tokenDoc.id} for ${userID}`, error);
        }
    }

    if (foundIncompletePermittedToken) {
        throw new HttpsError('failed-precondition', 'Connected Garmin token is incomplete for sleep backfill.');
    }
    if (lastTokenReadError) {
        throw new HttpsError('internal', 'Could not read connected Garmin token for sleep backfill.');
    }
    if (bestMissingPermissions) {
        await markGarminSleepBackfillPermissionsMissing(userID, bestMissingPermissions);
    }
    throw new HttpsError('failed-precondition', 'Connected Garmin token is required for sleep backfill.');
}

async function getCorosSleepBackfillToken(userID: string): Promise<CorosSleepBackfillToken> {
    const tokenSnapshot = await admin.firestore()
        .collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME)
        .doc(userID)
        .collection('tokens')
        .get();

    for (const tokenDoc of tokenSnapshot.docs) {
        try {
            const tokenData = await getTokenData(tokenDoc, ServiceNames.COROSAPI) as { openId?: unknown };
            const providerUserId = typeof tokenData.openId === 'string' ? tokenData.openId.trim() : '';
            if (providerUserId) {
                return { providerUserId };
            }
        } catch (error) {
            logger.warn(`[SleepBackfill] Could not use COROS token ${tokenDoc.id} for ${userID}`, error);
        }
    }

    throw new HttpsError('failed-precondition', 'Connected COROS token is required for sleep backfill.');
}

function getMissingGarminSleepBackfillPermissions(tokenData: { permissions?: unknown }): string[] {
    const permissions = Array.isArray(tokenData.permissions) ? tokenData.permissions : [];
    return GARMIN_SLEEP_BACKFILL_REQUIRED_PERMISSIONS
        .filter(permission => !permissions.includes(permission));
}

async function markGarminSleepBackfillPermissionsMissing(userID: string, missingPermissions: readonly string[]): Promise<never> {
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

async function shouldAbortGarminSleepBackfillRequests(userID: string): Promise<boolean> {
    let deletionGuard;
    try {
        deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
    } catch (error) {
        throw new UserDeletionGuardReadError(userID, 'garmin_sleep_backfill_before_provider_request', error);
    }
    if (!deletionGuard.shouldSkip) {
        return false;
    }
    logger.warn(`[SleepBackfill] Aborting Garmin sleep backfill requests for ${userID} because the user is missing or deletion is in progress.`);
    return true;
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
): Promise<boolean> {
    const db = admin.firestore();
    const stateRef = db.collection('users')
        .doc(userID)
        .collection(SLEEP_SYNC_STATE_COLLECTION_ID)
        .doc(provider);
    return db.runTransaction(async (transaction) => {
        let deletionGuard;
        try {
            deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
        } catch (error) {
            throw new UserDeletionGuardReadError(userID, 'sleep_backfill_cooldown_claim', error);
        }
        if (deletionGuard.shouldSkip) {
            logger.warn(`[SleepBackfill] Skipping ${provider} sleep backfill cooldown claim for ${userID} because the user is missing or deletion is in progress.`);
            return false;
        }

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
        return true;
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

function ceilToGarminBackfillSecondMs(timestampMs: number): number {
    return Math.ceil(timestampMs / GARMIN_BACKFILL_SECOND_MS) * GARMIN_BACKFILL_SECOND_MS;
}

async function getStoredGarminProviderMinBackfillStartMs(userID: string, providerUserId: string): Promise<number | null> {
    const stateSnapshot = await sleepSyncStateRef(userID, SLEEP_PROVIDERS.GarminAPI).get();
    const state = stateSnapshot.exists ? stateSnapshot.data() as SleepSyncState : null;
    if (state?.providerMinBackfillStartProviderUserId !== providerUserId) {
        return null;
    }
    const providerMinBackfillStartMs = Number(state?.providerMinBackfillStartMs);
    return Number.isFinite(providerMinBackfillStartMs) && providerMinBackfillStartMs > 0
        ? ceilToGarminBackfillSecondMs(providerMinBackfillStartMs)
        : null;
}

async function rememberGarminProviderMinBackfillStartMs(
    userID: string,
    context: GarminSleepBackfillRequestContext,
    rawMinStartMs: number,
): Promise<number> {
    const providerMinStartMs = ceilToGarminBackfillSecondMs(rawMinStartMs);
    if (!Number.isFinite(providerMinStartMs) || providerMinStartMs <= 0) {
        return providerMinStartMs;
    }

    if (!context.providerMinStartMs || providerMinStartMs > context.providerMinStartMs) {
        context.providerMinStartMs = providerMinStartMs;
        await updateSleepSyncState(userID, SLEEP_PROVIDERS.GarminAPI, {
            providerMinBackfillStartMs: providerMinStartMs,
            providerMinBackfillStartProviderUserId: context.providerUserId,
        });
    }

    return context.providerMinStartMs;
}

function valueToEpochMs(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 10_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
    }

    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        const numericValue = Number(trimmed);
        return numericValue > 10_000_000_000 ? numericValue : numericValue * 1000;
    }

    const parsedMs = Date.parse(trimmed);
    return Number.isFinite(parsedMs) ? parsedMs : null;
}

function findNestedValue(
    record: unknown,
    fieldNames: readonly string[],
    visited = new Set<object>(),
    depth = 0,
): unknown {
    if (!record || typeof record !== 'object' || depth > 8) {
        return undefined;
    }
    if (visited.has(record)) {
        return undefined;
    }
    visited.add(record);

    const objectRecord = record as Record<string, unknown>;
    for (const fieldName of fieldNames) {
        if (objectRecord[fieldName] !== undefined) {
            return objectRecord[fieldName];
        }
    }

    for (const value of Object.values(objectRecord)) {
        const nestedValue = findNestedValue(value, fieldNames, visited, depth + 1);
        if (nestedValue !== undefined) {
            return nestedValue;
        }
    }

    return undefined;
}

function extractGarminMinStartTimeMs(error: unknown): number | null {
    const structuredValue = findNestedValue(error, [
        'minStartTimeInSeconds',
        'minimumStartTimeInSeconds',
        'earliestStartTimeInSeconds',
        'minStartTime',
        'minimumStartTime',
        'earliestStartTime',
    ]);
    const structuredMs = valueToEpochMs(structuredValue);
    if (structuredMs !== null) {
        return structuredMs;
    }

    const message = getGarminBackfillErrorText(error);
    const numericMatch = message.match(/(?:min(?:imum)? start time|earliest start time)[^\d]*(\d{10,13}(?:\.\d+)?)/i);
    const numericMs = valueToEpochMs(numericMatch?.[1]);
    if (numericMs !== null) {
        return numericMs;
    }

    const isoMatch = message.match(/(?:min(?:imum)? start time|earliest start time)\D*(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[-+]\d{2}:?\d{2})?)?)/i);
    return valueToEpochMs(isoMatch?.[1]);
}

function getGarminBackfillErrorText(error: unknown): string {
    let serializedError = '';
    try {
        serializedError = JSON.stringify(error) || '';
    } catch {
        serializedError = '';
    }

    return [
        error instanceof Error ? error.message : '',
        `${(error as { error?: { error?: { errorMessage?: unknown } } } | null)?.error?.error?.errorMessage || ''}`,
        serializedError,
    ].filter(Boolean).join(' ');
}

function isGarminSleepBackfillMinStartError(error: unknown): boolean {
    if ((error as { statusCode?: unknown } | null)?.statusCode !== 400) {
        return false;
    }
    return /(?:before|earlier than)[^.!?]*(?:min(?:imum)?|earliest) start time/i.test(getGarminBackfillErrorText(error))
        || extractGarminMinStartTimeMs(error) !== null;
}

async function requestGarminSleepBackfillWindow(
    userID: string,
    token: GarminSleepBackfillToken,
    window: SleepBackfillWindow,
    context: GarminSleepBackfillRequestContext,
): Promise<GarminSleepBackfillRequestResult> {
    const requestStartMs = context.providerMinStartMs
        ? Math.max(window.startMs, context.providerMinStartMs)
        : window.startMs;
    if (requestStartMs >= window.endMs) {
        return 'skipped';
    }
    return requestGarminSleepBackfillRangeWithRecoveries(userID, token, requestStartMs, window.endMs, context);
}

async function requestGarminSleepBackfillRangeWithRecoveries(
    userID: string,
    token: GarminSleepBackfillToken,
    startMs: number,
    endMs: number,
    context: GarminSleepBackfillRequestContext,
): Promise<GarminSleepBackfillRequestResult> {
    let requestStartMs = startMs;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await requestGarminSleepBackfillRangeIfUserActive(userID, token, requestStartMs, endMs);
        } catch (error) {
            if (isGarminSleepBackfillAlreadyRequestedError(error)) {
                logger.warn(`[SleepBackfill] Garmin sleep backfill window was already requested: ${new Date(requestStartMs).toISOString()} - ${new Date(endMs).toISOString()}`);
                return 'skipped';
            }

            if (!isGarminSleepBackfillMinStartError(error)) {
                throw error;
            }

            const errorText = getGarminBackfillErrorText(error);
            const minStartMs = extractGarminMinStartTimeMs(error);
            if (minStartMs === null) {
                logger.warn(`[SleepBackfill] Skipping Garmin sleep backfill window before min start time: ${errorText}`);
                return 'skipped';
            }
            if (await shouldAbortGarminSleepBackfillRequests(userID)) {
                return 'aborted';
            }

            const safeMinStartMs = minStartMs <= requestStartMs
                ? requestStartMs + GARMIN_BACKFILL_SECOND_MS
                : minStartMs;
            const providerMinStartMs = await rememberGarminProviderMinBackfillStartMs(userID, context, safeMinStartMs);
            if (!Number.isFinite(providerMinStartMs) || providerMinStartMs >= endMs) {
                logger.warn(`[SleepBackfill] Skipping Garmin sleep backfill window before min start time: ${errorText}`);
                return 'skipped';
            }

            requestStartMs = providerMinStartMs;
            logger.warn(`[SleepBackfill] Retrying Garmin sleep backfill window from provider min start time ${new Date(requestStartMs).toISOString()}: ${errorText}`);
        }
    }

    throw new Error(`Could not find a valid Garmin sleep backfill start for ${new Date(startMs).toISOString()} - ${new Date(endMs).toISOString()}`);
}

async function requestGarminSleepBackfillRangeIfUserActive(
    userID: string,
    token: GarminSleepBackfillToken,
    startMs: number,
    endMs: number,
): Promise<GarminSleepBackfillRequestResult> {
    if (await shouldAbortGarminSleepBackfillRequests(userID)) {
        return 'aborted';
    }
    await requestGarminSleepBackfillRange(token, startMs, endMs);
    return 'requested';
}

async function requestGarminSleepBackfillRange(
    token: GarminSleepBackfillToken,
    startMs: number,
    endMs: number,
): Promise<void> {
    await requestPromise.get({
        headers: {
            Authorization: `Bearer ${token.accessToken}`,
        },
        url: `${GARMIN_SLEEP_BACKFILL_URI}?summaryStartTimeInSeconds=${Math.floor(startMs / 1000)}&summaryEndTimeInSeconds=${Math.floor(endMs / 1000)}`,
    });
}

function isGarminSleepBackfillAlreadyRequestedError(error: unknown): boolean {
    return (error as { statusCode?: unknown } | null)?.statusCode === 409;
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
    const cooldownClaimed = await claimSleepBackfillCooldown(userID, SLEEP_PROVIDERS.SuuntoApp, startMs, nowMs, nextAllowedAtMs);
    if (!cooldownClaimed) {
        throw new HttpsError('failed-precondition', 'Sleep backfill is not available while account deletion is in progress.');
    }

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
            lastBackfillQueuedAtMs: null,
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

export const backfillCorosAPISleep = onCall({
    region: FUNCTIONS_MANIFEST.backfillCorosAPISleep.region,
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
        logger.warn(`[SleepBackfill] Blocking COROS sleep backfill for non-pro user ${userID}`);
        throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
    }

    if (!isSleepProviderEnabled(SLEEP_PROVIDERS.COROSAPI)) {
        throw new HttpsError('failed-precondition', 'COROS sleep sync is disabled.');
    }

    if (!isSleepSyncUserAllowed(userID)) {
        throw new HttpsError('permission-denied', 'Sleep sync is not enabled for this user.');
    }

    if (await isServiceUnavailableForSyncForUser(userID, ServiceNames.COROSAPI)) {
        throw new HttpsError('failed-precondition', 'COROS is unavailable for sleep sync. Reconnect COROS and try again.');
    }

    const nowMs = Date.now();
    await assertSleepBackfillCooldownAllows(userID, SLEEP_PROVIDERS.COROSAPI, nowMs);

    const token = await getCorosSleepBackfillToken(userID);
    const startMs = getCorosSleepBackfillStartMs(nowMs);
    const windowDays = getConfiguredSleepBackfillWindowDays(SLEEP_PROVIDERS.COROSAPI, 'COROS');
    const windows = chunkSleepBackfillRange(startMs, nowMs, windowDays);
    const nextAllowedAtMs = nowMs + getConfiguredSleepBackfillCooldownMs(SLEEP_PROVIDERS.COROSAPI, 'COROS');
    const cooldownClaimed = await claimSleepBackfillCooldown(userID, SLEEP_PROVIDERS.COROSAPI, startMs, nowMs, nextAllowedAtMs);
    if (!cooldownClaimed) {
        throw new HttpsError('failed-precondition', 'Sleep backfill is not available while account deletion is in progress.');
    }

    let queued = 0;
    try {
        for (const window of windows) {
            await addSleepSyncQueueItem({
                type: 'coros_poll',
                provider: SLEEP_PROVIDERS.COROSAPI,
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
        logger.error(`[SleepBackfill] Failed after queueing ${queued} COROS sleep windows for ${userID}`, error);
        await updateSleepSyncState(userID, SLEEP_PROVIDERS.COROSAPI, {
            status: SLEEP_SYNC_STATUSES.Failed,
            lastBackfillQueuedAtMs: null,
            lastBackfillQueueItems: queued,
            nextBackfillAllowedAtMs: null,
            lastError: message,
        }, Date.now());
        throw new HttpsError('internal', 'Could not queue COROS sleep backfill.');
    }

    await updateSleepSyncState(userID, SLEEP_PROVIDERS.COROSAPI, {
        status: SLEEP_SYNC_STATUSES.Ready,
        lastBackfillQueuedAtMs: nowMs,
        lastBackfillStartMs: startMs,
        lastBackfillEndMs: nowMs,
        lastBackfillQueueItems: queued,
        nextBackfillAllowedAtMs: nextAllowedAtMs,
        lastError: null,
    }, nowMs);

    logger.info(`[SleepBackfill] Queued ${queued} COROS sleep windows for ${userID}`);

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
    const sharedStartMs = getSharedSleepBackfillStartMs();
    const storedProviderMinStartMs = await getStoredGarminProviderMinBackfillStartMs(userID, token.providerUserId);
    const startMs = Math.max(sharedStartMs, storedProviderMinStartMs || sharedStartMs);
    const windowDays = getConfiguredSleepBackfillWindowDays(SLEEP_PROVIDERS.GarminAPI, 'Garmin');
    const windows = chunkSleepBackfillRange(startMs, nowMs, windowDays);
    const nextAllowedAtMs = nowMs + getConfiguredSleepBackfillCooldownMs(SLEEP_PROVIDERS.GarminAPI, 'Garmin');
    const cooldownClaimed = await claimSleepBackfillCooldown(userID, SLEEP_PROVIDERS.GarminAPI, startMs, nowMs, nextAllowedAtMs);
    if (!cooldownClaimed) {
        throw new HttpsError('failed-precondition', 'Sleep backfill is not available while account deletion is in progress.');
    }

    let requested = 0;
    let abortedForDeletion = false;
    const requestContext: GarminSleepBackfillRequestContext = {
        providerUserId: token.providerUserId,
        providerMinStartMs: storedProviderMinStartMs,
    };
    try {
        for (const window of windows) {
            const requestResult = await requestGarminSleepBackfillWindow(userID, token, window, requestContext);
            if (requestResult === 'aborted') {
                abortedForDeletion = true;
                break;
            }
            if (requestResult === 'requested') {
                requested += 1;
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : `${error}`;
        logger.error(`[SleepBackfill] Failed after requesting ${requested} Garmin sleep windows for ${userID}`, error);
        await updateSleepSyncState(userID, SLEEP_PROVIDERS.GarminAPI, {
            status: SLEEP_SYNC_STATUSES.Failed,
            lastBackfillQueuedAtMs: null,
            lastBackfillQueueItems: requested,
            nextBackfillAllowedAtMs: null,
            lastError: message,
        }, Date.now());
        throw new HttpsError('internal', 'Could not request Garmin sleep backfill.');
    }

    if (abortedForDeletion) {
        return {
            queued: requested,
            startDate: new Date(startMs).toISOString(),
            endDate: new Date(nowMs).toISOString(),
            nextAllowedAtMs,
        };
    }

    const completedStartMs = Math.max(startMs, requestContext.providerMinStartMs || startMs);
    const finalStateUpdate: Parameters<typeof updateSleepSyncState>[2] = {
        status: SLEEP_SYNC_STATUSES.Ready,
        lastBackfillQueuedAtMs: nowMs,
        lastBackfillStartMs: completedStartMs,
        lastBackfillEndMs: nowMs,
        lastBackfillQueueItems: requested,
        nextBackfillAllowedAtMs: nextAllowedAtMs,
        lastError: null,
    };
    if (requestContext.providerMinStartMs) {
        finalStateUpdate.providerMinBackfillStartMs = requestContext.providerMinStartMs;
        finalStateUpdate.providerMinBackfillStartProviderUserId = requestContext.providerUserId;
    }
    await updateSleepSyncState(userID, SLEEP_PROVIDERS.GarminAPI, finalStateUpdate, nowMs);

    logger.info(`[SleepBackfill] Requested ${requested} Garmin sleep windows for ${userID}`, {
        providerUserId: token.providerUserId,
    });

    return {
        queued: requested,
        startDate: new Date(completedStartMs).toISOString(),
        endDate: new Date(nowMs).toISOString(),
        nextAllowedAtMs,
    };
});
