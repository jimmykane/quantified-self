import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import {
    SLEEP_PROVIDERS,
} from '../../../shared/sleep';
import {
    addSleepSyncQueueItem,
    findSleepTokenByProviderUserId,
    firebaseUserIdFromSleepTokenSnapshot,
} from './queue';
import { verifySuuntoWebhookSignature } from '../suunto/webhook-signature';
import {
    getAllowedSleepSyncUserIds,
    isSleepProviderEnabled,
    SLEEP_SYNC_DISABLED_PROVIDERS,
} from './provider-flags';
import { normalizeTrustedGarminCallbackURL } from './garmin-callback-url';

type ExternalRecord = Record<string, unknown>;

function asRecord(value: unknown): ExternalRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as ExternalRecord
        : {};
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asDedupePart(value: unknown): string | null {
    if (typeof value === 'string') {
        return value.trim().length > 0 ? value.trim() : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${value}`;
    }
    return null;
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'undefined';
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }

    const record = value as ExternalRecord;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function samplePayloadDigest(value: unknown): string {
    return crypto
        .createHash('sha256')
        .update(stableStringify(value))
        .digest('hex')
        .slice(0, 32);
}

function suuntoSleepSampleDedupePart(sampleValue: unknown): string {
    const sample = asRecord(sampleValue);
    const entryData = asRecord(sample.entryData);
    const candidates = [
        sample.SleepId,
        sample.sleepId,
        entryData.SleepId,
        entryData.sleepId,
        sample.id,
        entryData.id,
        sample.timestamp,
        sample.DateTime,
        sample.StartTime,
        sample.BedtimeStart,
        entryData.DateTime,
        entryData.StartTime,
        entryData.BedtimeStart,
    ];

    for (const candidate of candidates) {
        const dedupePart = asDedupePart(candidate);
        if (dedupePart) {
            return dedupePart;
        }
    }

    return `sample-${samplePayloadDigest(sampleValue)}`;
}

function buildSuuntoSleepDedupeKey(providerUserId: string, samples: unknown[]): string {
    const sampleKeys = samples
        .map((sample) => suuntoSleepSampleDedupePart(sample))
        .sort();
    return `${providerUserId}:${sampleKeys.join(':')}`;
}

function hasNumberField(record: ExternalRecord, fieldName: string): boolean {
    const value = Number(record[fieldName]);
    return Number.isFinite(value);
}

async function resolveScopedSuuntoWebhookUserID(providerUserId: string): Promise<string | null | undefined> {
    const allowedUserIDs = getAllowedSleepSyncUserIds();
    if (allowedUserIDs.length === 0) {
        const tokenSnapshot = await findSleepTokenByProviderUserId(SLEEP_PROVIDERS.SuuntoApp, providerUserId);
        return tokenSnapshot ? firebaseUserIdFromSleepTokenSnapshot(tokenSnapshot) : null;
    }

    for (const userID of allowedUserIDs) {
        const snapshot = await admin.firestore()
            .collection('suuntoAppAccessTokens')
            .doc(userID)
            .collection('tokens')
            .where('userName', '==', providerUserId)
            .limit(1)
            .get();
        if (!snapshot.empty) {
            return userID;
        }
    }

    return null;
}

export const receiveGarminAPISleepData = functions.region('europe-west2').runWith({
    timeoutSeconds: 60,
    memory: '256MB',
}).https.onRequest(async (req, res) => {
    if (!isSleepProviderEnabled(SLEEP_PROVIDERS.GarminAPI)) {
        logger.info(`[SleepSync][Garmin] Provider disabled by SLEEP_SYNC_DISABLED_PROVIDERS=${SLEEP_SYNC_DISABLED_PROVIDERS.join(',')}; ignoring sleep webhook`);
        res.status(200).send();
        return;
    }

    const sleeps = asArray(asRecord(req.body).sleeps);
    if (!sleeps.length) {
        logger.warn('[SleepSync][Garmin] Received payload without sleeps');
        res.status(200).send();
        return;
    }

    try {
        const queueItems: Parameters<typeof addSleepSyncQueueItem>[0][] = [];
        for (const sleepValue of sleeps) {
            const sleep = asRecord(sleepValue);
            const providerUserId = asString(sleep.userId) || asString(sleep.userID);
            if (!providerUserId) {
                logger.warn('[SleepSync][Garmin] Skipping sleep payload without userId');
                continue;
            }
            const callbackURL = asString(sleep.callbackURL);
            const hasPushSummaryFields = hasNumberField(sleep, 'startTimeInSeconds') || !!asString(sleep.summaryId);
            const trustedCallbackURL = normalizeTrustedGarminCallbackURL(callbackURL);
            if (!trustedCallbackURL) {
                logger.warn(hasPushSummaryFields
                    ? '[SleepSync][Garmin] Rejected unauthenticated push payload'
                    : '[SleepSync][Garmin] Rejected ping payload with untrusted callbackURL');
                res.status(400).send();
                return;
            }

            queueItems.push({
                type: 'garmin_ping',
                provider: SLEEP_PROVIDERS.GarminAPI,
                providerUserId,
                callbackURL: trustedCallbackURL,
                dedupeKey: trustedCallbackURL,
                dispatchImmediately: true,
            });
        }
        const refs = await Promise.all(queueItems.map((queueItem) => addSleepSyncQueueItem(queueItem)));
        logger.info(`[SleepSync][Garmin] Queued ${refs.length} sleep payloads`);
        res.status(200).send();
    } catch (error) {
        logger.error('[SleepSync][Garmin] Failed to queue sleep payload', error);
        res.status(500).send();
    }
});

export const receiveSuuntoAppSleepData = functions.region('europe-west2').runWith({
    timeoutSeconds: 60,
    memory: '256MB',
}).https.onRequest(async (req, res) => {
    if (!isSleepProviderEnabled(SLEEP_PROVIDERS.SuuntoApp)) {
        logger.info(`[SleepSync][Suunto] Provider disabled by SLEEP_SYNC_DISABLED_PROVIDERS=${SLEEP_SYNC_DISABLED_PROVIDERS.join(',')}; ignoring sleep webhook`);
        res.status(200).send();
        return;
    }

    const signature = asString(req.get('X-HMAC-SHA256-Signature'));
    if (!verifySuuntoWebhookSignature(req.rawBody, signature)) {
        logger.warn('[SleepSync][Suunto] Invalid webhook signature');
        res.status(403).send();
        return;
    }

    const body = asRecord(req.body);
    if (body.type !== 'SUUNTO_247_SLEEP_CREATED') {
        res.status(200).send();
        return;
    }

    const providerUserId = asString(body.username);
    const samples = asArray(body.samples);
    if (!providerUserId || !samples.length) {
        logger.warn('[SleepSync][Suunto] Missing username or samples');
        res.status(200).send();
        return;
    }

    try {
        const scopedUserID = await resolveScopedSuuntoWebhookUserID(providerUserId);
        if (scopedUserID === null) {
            logger.info('[SleepSync][Suunto] Ignoring webhook without a connected Suunto token or outside SLEEP_SYNC_ALLOWED_USER_IDS');
            res.status(200).send();
            return;
        }

        await addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: SLEEP_PROVIDERS.SuuntoApp,
            userID: scopedUserID || undefined,
            providerUserId,
            payload: { samples },
            dedupeKey: buildSuuntoSleepDedupeKey(providerUserId, samples),
            dispatchImmediately: true,
        });
        logger.info(`[SleepSync][Suunto] Queued ${samples.length} sleep samples for ${providerUserId}`);
        res.status(200).send();
    } catch (error) {
        logger.error('[SleepSync][Suunto] Failed to queue sleep payload', error);
        res.status(500).send();
    }
});
