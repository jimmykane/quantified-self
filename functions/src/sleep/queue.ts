import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    SleepMapperResult,
    SleepProvider,
    SLEEP_PROVIDERS,
    SLEEP_STAGES,
    SLEEP_SYNC_STATUSES,
} from '../../../shared/sleep';
import {
    SleepSyncQueueItemInterface,
    SleepSyncQueueItemType,
} from '../queue/queue-item.interface';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { generateIDFromParts } from '../utils';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import {
    mapCorosDailySleep,
    mapGarminSleepSummary,
    mapSuuntoSleepSample,
} from './provider-mappers';
import { markSleepSyncError, updateSleepSyncState, upsertSleepSessions } from './writer';
import { getTokenData } from '../tokens';
import * as requestPromise from '../request-helper';
import { config } from '../config';
import { toSuuntoAuthorizationHeader } from '../suunto/authorization-header';
import {
    increaseRetryCountForQueueItem,
    moveToDeadLetterQueue,
    QueueResult,
    updateToProcessed,
} from '../queue-utils';
import { isSleepProviderEnabled, isSleepSyncUserAllowed, SLEEP_SYNC_DISABLED_PROVIDERS } from './provider-flags';
import { assertTrustedGarminCallbackURL, InvalidGarminCallbackUrlError } from './garmin-callback-url';

type TokenSnapshot = admin.firestore.QueryDocumentSnapshot;

interface AddSleepSyncQueueItemInput {
    type: SleepSyncQueueItemType;
    provider: SleepProvider;
    providerUserId: string;
    userID?: string;
    payload?: unknown;
    callbackURL?: string;
    rangeStartMs?: number;
    rangeEndMs?: number;
    dedupeKey?: string;
}

function queueCollection(): admin.firestore.CollectionReference {
    return admin.firestore().collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME);
}

function providerUserIdTokenField(provider: SleepProvider): string | null {
    switch (provider) {
        case SLEEP_PROVIDERS.GarminAPI:
            return 'userID';
        case SLEEP_PROVIDERS.SuuntoApp:
            return 'userName';
        case SLEEP_PROVIDERS.COROSAPI:
            return 'openId';
        default:
            return null;
    }
}

function compactQueuePayload(input: AddSleepSyncQueueItemInput): Partial<SleepSyncQueueItemInterface> {
    const payload: Partial<SleepSyncQueueItemInterface> = {
        type: input.type,
        provider: input.provider,
        providerUserId: input.providerUserId,
        userID: input.userID,
        payload: input.payload,
        callbackURL: input.callbackURL,
        rangeStartMs: input.rangeStartMs,
        rangeEndMs: input.rangeEndMs,
    };
    return JSON.parse(JSON.stringify(payload)) as Partial<SleepSyncQueueItemInterface>;
}

export async function addSleepSyncQueueItem(input: AddSleepSyncQueueItemInput): Promise<admin.firestore.DocumentReference> {
    const nowMs = Date.now();
    const queueId = await generateIDFromParts([
        input.provider,
        input.type,
        input.providerUserId,
        input.dedupeKey || input.callbackURL || `${input.rangeStartMs || ''}:${input.rangeEndMs || ''}:${nowMs}`,
    ]);
    const docRef = queueCollection().doc(queueId);
    await docRef.set({
        id: queueId,
        dateCreated: nowMs,
        retryCount: 0,
        processed: false,
        dispatchedToCloudTask: null,
        expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
        ...compactQueuePayload(input),
    }, { merge: false });
    return docRef;
}

async function findTokenByProviderUserId(provider: SleepProvider, providerUserId: string): Promise<TokenSnapshot | null> {
    const tokenField = providerUserIdTokenField(provider);
    if (!tokenField) {
        return null;
    }
    const snapshot = await admin.firestore().collectionGroup('tokens')
        .where('serviceName', '==', provider)
        .where(tokenField, '==', providerUserId)
        .limit(1)
        .get();
    return snapshot.docs[0] || null;
}

async function findTokenForQueueItem(queueItem: SleepSyncQueueItemInterface): Promise<TokenSnapshot | null> {
    if (queueItem.userID) {
        const tokenRoot = getTokenRoot(queueItem.provider, queueItem.userID);
        const tokenField = providerUserIdTokenField(queueItem.provider);
        if (!tokenRoot || !tokenField) {
            return null;
        }
        const snapshot = await tokenRoot
            .where(tokenField, '==', queueItem.providerUserId)
            .limit(1)
            .get();
        return snapshot.docs[0] || null;
    }
    return findTokenByProviderUserId(queueItem.provider, queueItem.providerUserId);
}

function getTokenRoot(provider: SleepProvider, userID: string): admin.firestore.CollectionReference | null {
    switch (provider) {
        case SLEEP_PROVIDERS.GarminAPI:
            return admin.firestore().collection('garminAPITokens').doc(userID).collection('tokens');
        case SLEEP_PROVIDERS.SuuntoApp:
            return admin.firestore().collection('suuntoAppAccessTokens').doc(userID).collection('tokens');
        case SLEEP_PROVIDERS.COROSAPI:
            return admin.firestore().collection('COROSAPIAccessTokens').doc(userID).collection('tokens');
        default:
            return null;
    }
}

function firebaseUserIdFromTokenSnapshot(tokenSnapshot: TokenSnapshot): string {
    const userRef = tokenSnapshot.ref.parent.parent;
    if (!userRef) {
        throw new Error(`Token ${tokenSnapshot.id} has no user parent`);
    }
    return userRef.id;
}

function serviceNameForProvider(provider: SleepProvider): ServiceNames {
    switch (provider) {
        case SLEEP_PROVIDERS.GarminAPI:
            return ServiceNames.GarminAPI;
        case SLEEP_PROVIDERS.SuuntoApp:
            return ServiceNames.SuuntoApp;
        case SLEEP_PROVIDERS.COROSAPI:
            return ServiceNames.COROSAPI;
        default:
            throw new Error(`Unsupported sleep provider ${provider}`);
    }
}

function normalizePayloadArray(payload: unknown, key?: string): unknown[] {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (key && payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        return Array.isArray(record[key]) ? record[key] as unknown[] : [];
    }
    return [];
}

function mapperResultStageSeconds(result: SleepMapperResult, stages: readonly string[]): number {
    const stageDurations = result.session.stageDurationsSeconds || {};
    return stages.reduce((total, stage) => total + Math.max(0, Number(stageDurations[stage as keyof typeof stageDurations]) || 0), 0);
}

function compareMapperResultCompleteness(left: SleepMapperResult, right: SleepMapperResult): number {
    const leftSleepStageSeconds = mapperResultStageSeconds(left, [SLEEP_STAGES.Deep, SLEEP_STAGES.Light, SLEEP_STAGES.Rem]);
    const rightSleepStageSeconds = mapperResultStageSeconds(right, [SLEEP_STAGES.Deep, SLEEP_STAGES.Light, SLEEP_STAGES.Rem]);
    if (leftSleepStageSeconds !== rightSleepStageSeconds) {
        return leftSleepStageSeconds - rightSleepStageSeconds;
    }

    const leftKnownStageSeconds = mapperResultStageSeconds(left, [SLEEP_STAGES.Deep, SLEEP_STAGES.Light, SLEEP_STAGES.Rem, SLEEP_STAGES.Awake]);
    const rightKnownStageSeconds = mapperResultStageSeconds(right, [SLEEP_STAGES.Deep, SLEEP_STAGES.Light, SLEEP_STAGES.Rem, SLEEP_STAGES.Awake]);
    if (leftKnownStageSeconds !== rightKnownStageSeconds) {
        return leftKnownStageSeconds - rightKnownStageSeconds;
    }

    const leftNonNapScore = left.session.isNap ? 0 : 1;
    const rightNonNapScore = right.session.isNap ? 0 : 1;
    if (leftNonNapScore !== rightNonNapScore) {
        return leftNonNapScore - rightNonNapScore;
    }

    const leftScorePresent = Number.isFinite(Number(left.session.score?.value)) ? 1 : 0;
    const rightScorePresent = Number.isFinite(Number(right.session.score?.value)) ? 1 : 0;
    if (leftScorePresent !== rightScorePresent) {
        return leftScorePresent - rightScorePresent;
    }

    return Math.max(0, Number(left.session.durationSeconds) || 0) - Math.max(0, Number(right.session.durationSeconds) || 0);
}

function keepBestMapperResultPerSourceSession(mapperResults: readonly SleepMapperResult[]): SleepMapperResult[] {
    const bestResults = new Map<string, SleepMapperResult>();
    for (const mapperResult of mapperResults) {
        const current = bestResults.get(mapperResult.sourceSessionKey);
        if (!current || compareMapperResultCompleteness(current, mapperResult) < 0) {
            bestResults.set(mapperResult.sourceSessionKey, mapperResult);
        }
    }
    return [...bestResults.values()];
}

function assertGarminSleepPermission(tokenData: Record<string, unknown>, userID: string): void {
    const permissions = tokenData.permissions;
    if (!Array.isArray(permissions) || permissions.length === 0) {
        return;
    }
    if (!permissions.includes('HEALTH_EXPORT')) {
        throw new GarminSleepPermissionError(userID);
    }
}

class GarminSleepPermissionError extends Error {
    constructor(public readonly userID: string) {
        super('Missing Garmin health export permission for sleep sync');
    }
}

class UnsupportedGarminPushPayloadError extends Error {
    constructor() {
        super('Garmin push sleep payloads are not accepted without authenticated delivery');
    }
}

async function resolveTokenAndUser(queueItem: SleepSyncQueueItemInterface): Promise<{
    tokenSnapshot: TokenSnapshot;
    firebaseUserID: string;
}> {
    const tokenSnapshot = await findTokenForQueueItem(queueItem);
    if (!tokenSnapshot) {
        throw new Error(`No ${queueItem.provider} token found for ${queueItem.providerUserId}`);
    }
    return {
        tokenSnapshot,
        firebaseUserID: firebaseUserIdFromTokenSnapshot(tokenSnapshot),
    };
}

async function processGarminQueueItem(queueItem: SleepSyncQueueItemInterface, tokenSnapshot: TokenSnapshot, firebaseUserID: string): Promise<SleepMapperResult[]> {
    if (queueItem.type === 'garmin_ping') {
        const callbackURL = assertTrustedGarminCallbackURL(queueItem.callbackURL);
        const tokenData = await getTokenData(tokenSnapshot, ServiceNames.GarminAPI);
        assertGarminSleepPermission(tokenData as unknown as Record<string, unknown>, firebaseUserID);
        const payload = await requestPromise.get({
            headers: {
                Authorization: `Bearer ${tokenData.accessToken}`,
            },
            json: true,
            url: callbackURL,
        });
        return normalizePayloadArray(payload, 'sleeps')
            .map((summary) => mapGarminSleepSummary(summary, queueItem.providerUserId, Date.now(), callbackURL))
            .filter((result): result is SleepMapperResult => result !== null);
    }

    const tokenData = await getTokenData(tokenSnapshot, ServiceNames.GarminAPI);
    assertGarminSleepPermission(tokenData as unknown as Record<string, unknown>, firebaseUserID);
    return normalizePayloadArray(queueItem.payload, 'sleeps')
        .map((summary) => mapGarminSleepSummary(summary, queueItem.providerUserId, Date.now(), queueItem.callbackURL))
        .filter((result): result is SleepMapperResult => result !== null);
}

async function processSuuntoQueueItem(queueItem: SleepSyncQueueItemInterface, tokenSnapshot: TokenSnapshot): Promise<SleepMapperResult[]> {
    if (queueItem.type === 'suunto_poll') {
        if (!Number.isFinite(queueItem.rangeStartMs) || !Number.isFinite(queueItem.rangeEndMs)) {
            throw new Error(`Suunto poll queue item ${queueItem.id} has invalid range`);
        }
        const tokenData = await getTokenData(tokenSnapshot, ServiceNames.SuuntoApp);
        const payload = await requestPromise.get({
            headers: {
                Authorization: toSuuntoAuthorizationHeader(tokenData.accessToken),
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
            },
            json: true,
            url: `https://cloudapi.suunto.com/247samples/sleep?from=${Math.floor(queueItem.rangeStartMs || 0)}&to=${Math.floor(queueItem.rangeEndMs || 0)}`,
        });
        return keepBestMapperResultPerSourceSession(normalizePayloadArray(payload, 'samples')
            .map((sample) => mapSuuntoSleepSample(sample, queueItem.providerUserId, Date.now()))
            .filter((result): result is SleepMapperResult => result !== null));
    }

    return keepBestMapperResultPerSourceSession(normalizePayloadArray(queueItem.payload, 'samples')
        .map((sample) => mapSuuntoSleepSample(sample, queueItem.providerUserId, Date.now()))
        .filter((result): result is SleepMapperResult => result !== null));
}

async function processCorosQueueItem(queueItem: SleepSyncQueueItemInterface, tokenSnapshot: TokenSnapshot): Promise<SleepMapperResult[]> {
    if (!Number.isFinite(queueItem.rangeStartMs) || !Number.isFinite(queueItem.rangeEndMs)) {
        throw new Error(`COROS poll queue item ${queueItem.id} has invalid range`);
    }
    const tokenData = await getTokenData(tokenSnapshot, ServiceNames.COROSAPI);
    const startDate = formatCorosDate(queueItem.rangeStartMs || 0);
    const endDate = formatCorosDate(queueItem.rangeEndMs || 0);
    const payload = await requestPromise.get({
        url: `https://open.coros.com/coros/daily/query?token=${encodeURIComponent(tokenData.accessToken)}&openId=${encodeURIComponent(queueItem.providerUserId)}&startDate=${startDate}&endDate=${endDate}`,
        json: true,
    });
    const dailyList = normalizePayloadArray((payload as { data?: { dailyList?: unknown[] } })?.data?.dailyList);
    return dailyList
        .map((daily) => mapCorosDailySleep(daily, queueItem.providerUserId, Date.now()))
        .filter((result): result is SleepMapperResult => result !== null);
}

function formatCorosDate(timestampMs: number): string {
    const date = new Date(timestampMs);
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');
    return `${year}${month}${day}`;
}

function assertNeverQueueItemType(type: never): never {
    throw new Error(`Unsupported sleep queue item type ${type}`);
}

function isPollQueueItemType(type: SleepSyncQueueItemType): boolean {
    switch (type) {
        case 'suunto_poll':
        case 'coros_poll':
            return true;
        case 'garmin_ping':
        case 'garmin_push':
        case 'suunto_webhook':
            return false;
        default:
            return assertNeverQueueItemType(type);
    }
}

function isWebhookQueueItemType(type: SleepSyncQueueItemType): boolean {
    switch (type) {
        case 'garmin_ping':
        case 'garmin_push':
        case 'suunto_webhook':
            return true;
        case 'suunto_poll':
        case 'coros_poll':
            return false;
        default:
            return assertNeverQueueItemType(type);
    }
}

export async function processSleepSyncQueueItem(queueItem: SleepSyncQueueItemInterface): Promise<QueueResult> {
    logger.info(`[SleepSync] Processing queue item ${queueItem.id}`);
    if (!isSleepProviderEnabled(queueItem.provider)) {
        logger.info(`[SleepSync] Provider ${queueItem.provider} disabled by SLEEP_SYNC_DISABLED_PROVIDERS=${SLEEP_SYNC_DISABLED_PROVIDERS.join(',')}; marking queue item ${queueItem.id} processed`);
        return updateToProcessed(queueItem, undefined, {
            resultStatus: 'provider_disabled',
            providerDisabled: true,
            sessionsWritten: 0,
            sessionsSkipped: 0,
        });
    }

    try {
        if (queueItem.userID && !isSleepSyncUserAllowed(queueItem.userID)) {
            logger.info(`[SleepSync] User ${queueItem.userID} outside SLEEP_SYNC_ALLOWED_USER_IDS; marking queue item ${queueItem.id} processed`);
            return updateToProcessed(queueItem, undefined, {
                resultStatus: 'user_not_allowed',
                userAllowed: false,
                sessionsWritten: 0,
                sessionsSkipped: 0,
            });
        }

        if (queueItem.provider === SLEEP_PROVIDERS.GarminAPI && queueItem.type === 'garmin_ping') {
            assertTrustedGarminCallbackURL(queueItem.callbackURL);
        }
        if (queueItem.provider === SLEEP_PROVIDERS.GarminAPI && queueItem.type === 'garmin_push') {
            throw new UnsupportedGarminPushPayloadError();
        }

        const { tokenSnapshot, firebaseUserID } = await resolveTokenAndUser(queueItem);
        if (!isSleepSyncUserAllowed(firebaseUserID)) {
            logger.info(`[SleepSync] Resolved user ${firebaseUserID} outside SLEEP_SYNC_ALLOWED_USER_IDS; marking queue item ${queueItem.id} processed`);
            return updateToProcessed(queueItem, undefined, {
                resultStatus: 'user_not_allowed',
                userAllowed: false,
                sessionsWritten: 0,
                sessionsSkipped: 0,
            });
        }

        let mapperResults: SleepMapperResult[] = [];
        switch (queueItem.provider) {
            case SLEEP_PROVIDERS.GarminAPI:
                mapperResults = await processGarminQueueItem(queueItem, tokenSnapshot, firebaseUserID);
                break;
            case SLEEP_PROVIDERS.SuuntoApp:
                mapperResults = await processSuuntoQueueItem(queueItem, tokenSnapshot);
                break;
            case SLEEP_PROVIDERS.COROSAPI:
                mapperResults = await processCorosQueueItem(queueItem, tokenSnapshot);
                break;
            default:
                throw new Error(`Unsupported sleep provider ${queueItem.provider}`);
        }

        const result = await upsertSleepSessions(firebaseUserID, mapperResults);
        const stateUpdateMs = Date.now();
        await updateSleepSyncState(firebaseUserID, queueItem.provider, {
            status: SLEEP_SYNC_STATUSES.Ready,
            lastSyncedAtMs: stateUpdateMs,
            lastPollAtMs: isPollQueueItemType(queueItem.type) ? stateUpdateMs : undefined,
            lastWebhookAtMs: isWebhookQueueItemType(queueItem.type) ? stateUpdateMs : undefined,
            lastError: null,
        });
        logger.info(`[SleepSync] Queue item ${queueItem.id} wrote ${result.written} sessions and skipped ${result.skipped}`);
        return updateToProcessed(queueItem, undefined, {
            resultStatus: 'success',
            sessionsWritten: result.written,
            sessionsSkipped: result.skipped,
        });
    } catch (error) {
        if (error instanceof InvalidGarminCallbackUrlError) {
            logger.warn(`[SleepSync] Queue item ${queueItem.id} has untrusted Garmin callback URL; moving to DLQ`);
            return moveToDeadLetterQueue(queueItem, error, undefined, 'INVALID_GARMIN_CALLBACK_URL');
        }
        if (error instanceof GarminSleepPermissionError) {
            await updateSleepSyncState(error.userID, SLEEP_PROVIDERS.GarminAPI, {
                status: SLEEP_SYNC_STATUSES.PermissionMissing,
                lastError: error.message,
            });
            return moveToDeadLetterQueue(queueItem, error, undefined, 'PERMISSION_MISSING');
        }
        if (error instanceof UnsupportedGarminPushPayloadError) {
            logger.warn(`[SleepSync] Queue item ${queueItem.id} has unsupported Garmin push payload; moving to DLQ`);
            return moveToDeadLetterQueue(queueItem, error, undefined, 'UNSUPPORTED_GARMIN_PUSH_PAYLOAD');
        }
        if (queueItem.userID) {
            await markSleepSyncError(queueItem.userID, queueItem.provider, error);
        }
        logger.error(`[SleepSync] Queue item ${queueItem.id} failed`, error);
        return increaseRetryCountForQueueItem(queueItem, error instanceof Error ? error : new Error(`${error}`));
    }
}

export function getSleepSyncServiceName(provider: SleepProvider): ServiceNames {
    return serviceNameForProvider(provider);
}
