import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
    SleepMapperResult,
    SleepProvider,
    SLEEP_PROVIDERS,
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
import {
    increaseRetryCountForQueueItem,
    moveToDeadLetterQueue,
    QueueResult,
    updateToProcessed,
} from '../queue-utils';
import { isSleepProviderEnabled, SLEEP_SYNC_DISABLED_PROVIDERS_ENV } from './provider-flags';

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
    const query = admin.firestore().collectionGroup('tokens')
        .where('serviceName', '==', provider)
        .limit(1);
    let snapshot: admin.firestore.QuerySnapshot;
    switch (provider) {
        case SLEEP_PROVIDERS.GarminAPI:
            snapshot = await query.where('userID', '==', providerUserId).get();
            break;
        case SLEEP_PROVIDERS.SuuntoApp:
            snapshot = await query.where('userName', '==', providerUserId).get();
            break;
        case SLEEP_PROVIDERS.COROSAPI:
            snapshot = await query.where('openId', '==', providerUserId).get();
            break;
        default:
            return null;
    }
    return snapshot.docs[0] || null;
}

async function findTokenForQueueItem(queueItem: SleepSyncQueueItemInterface): Promise<TokenSnapshot | null> {
    if (queueItem.userID) {
        const tokenRoot = getTokenRoot(queueItem.provider, queueItem.userID);
        if (tokenRoot) {
            const snapshot = await tokenRoot.limit(1).get();
            if (!snapshot.empty) {
                return snapshot.docs[0];
            }
        }
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
    const tokenData = await getTokenData(tokenSnapshot, ServiceNames.GarminAPI);
    assertGarminSleepPermission(tokenData as unknown as Record<string, unknown>, firebaseUserID);

    if (queueItem.type === 'garmin_ping') {
        if (!queueItem.callbackURL) {
            throw new Error(`Garmin ping queue item ${queueItem.id} is missing callbackURL`);
        }
        const payload = await requestPromise.get({
            headers: {
                Authorization: `Bearer ${tokenData.accessToken}`,
            },
            json: true,
            url: queueItem.callbackURL,
        });
        return normalizePayloadArray(payload, 'sleeps')
            .map((summary) => mapGarminSleepSummary(summary, queueItem.providerUserId, Date.now(), queueItem.callbackURL))
            .filter((result): result is SleepMapperResult => result !== null);
    }

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
                Authorization: tokenData.accessToken,
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': config.suuntoapp.subscription_key,
            },
            json: true,
            url: `https://cloudapi.suunto.com/247samples/sleep?from=${Math.floor(queueItem.rangeStartMs || 0)}&to=${Math.floor(queueItem.rangeEndMs || 0)}`,
        });
        return normalizePayloadArray(payload, 'samples')
            .map((sample) => mapSuuntoSleepSample(sample, queueItem.providerUserId, Date.now()))
            .filter((result): result is SleepMapperResult => result !== null);
    }

    return normalizePayloadArray(queueItem.payload, 'samples')
        .map((sample) => mapSuuntoSleepSample(sample, queueItem.providerUserId, Date.now()))
        .filter((result): result is SleepMapperResult => result !== null);
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

export async function processSleepSyncQueueItem(queueItem: SleepSyncQueueItemInterface): Promise<QueueResult> {
    logger.info(`[SleepSync] Processing queue item ${queueItem.id}`);
    if (!isSleepProviderEnabled(queueItem.provider)) {
        logger.info(`[SleepSync] Provider ${queueItem.provider} disabled by ${SLEEP_SYNC_DISABLED_PROVIDERS_ENV}; marking queue item ${queueItem.id} processed`);
        return updateToProcessed(queueItem, undefined, {
            resultStatus: 'provider_disabled',
            providerDisabled: true,
            sessionsWritten: 0,
            sessionsSkipped: 0,
        });
    }

    try {
        const { tokenSnapshot, firebaseUserID } = await resolveTokenAndUser(queueItem);
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
        await updateSleepSyncState(firebaseUserID, queueItem.provider, {
            status: SLEEP_SYNC_STATUSES.Ready,
            lastSyncedAtMs: Date.now(),
            lastPollAtMs: queueItem.type.endsWith('_poll') ? Date.now() : undefined,
            lastWebhookAtMs: queueItem.type.endsWith('_webhook') || queueItem.type.endsWith('_push') ? Date.now() : undefined,
            lastError: null,
        });
        logger.info(`[SleepSync] Queue item ${queueItem.id} wrote ${result.written} sessions and skipped ${result.skipped}`);
        return updateToProcessed(queueItem, undefined, {
            resultStatus: 'success',
            sessionsWritten: result.written,
            sessionsSkipped: result.skipped,
        });
    } catch (error) {
        if (error instanceof GarminSleepPermissionError) {
            await updateSleepSyncState(error.userID, SLEEP_PROVIDERS.GarminAPI, {
                status: SLEEP_SYNC_STATUSES.PermissionMissing,
                lastError: error.message,
            });
            return moveToDeadLetterQueue(queueItem, error, undefined, 'PERMISSION_MISSING');
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
