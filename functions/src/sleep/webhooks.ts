import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as crypto from 'crypto';
import {
    SLEEP_PROVIDERS,
} from '../../../shared/sleep';
import { addSleepSyncQueueItem } from './queue';
import { isSleepProviderEnabled, SLEEP_SYNC_DISABLED_PROVIDERS_ENV } from './provider-flags';

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

function verifySuuntoSignature(rawBody: Buffer | undefined, signature: string | null): boolean {
    const secret = process.env.SUUNTOAPP_NOTIFICATION_SECRET;
    if (!secret || !rawBody || !signature) {
        return false;
    }
    const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const expected = Buffer.from(digest, 'hex');
    const actual = Buffer.from(signature, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export const receiveGarminAPISleepData = functions.region('europe-west2').runWith({
    timeoutSeconds: 60,
    memory: '256MB',
}).https.onRequest(async (req, res) => {
    if (!isSleepProviderEnabled(SLEEP_PROVIDERS.GarminAPI)) {
        logger.info(`[SleepSync][Garmin] Provider disabled by ${SLEEP_SYNC_DISABLED_PROVIDERS_ENV}; ignoring sleep webhook`);
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
        const refs = [];
        for (const sleepValue of sleeps) {
            const sleep = asRecord(sleepValue);
            const providerUserId = asString(sleep.userId) || asString(sleep.userID);
            if (!providerUserId) {
                logger.warn('[SleepSync][Garmin] Skipping sleep payload without userId');
                continue;
            }
            const callbackURL = asString(sleep.callbackURL);
            const isPushSummary = hasNumberField(sleep, 'startTimeInSeconds') || !!asString(sleep.summaryId);
            refs.push(await addSleepSyncQueueItem({
                type: isPushSummary ? 'garmin_push' : 'garmin_ping',
                provider: SLEEP_PROVIDERS.GarminAPI,
                providerUserId,
                payload: isPushSummary ? { sleeps: [sleep] } : undefined,
                callbackURL: callbackURL || undefined,
                dedupeKey: asString(sleep.summaryId) || callbackURL || `${Date.now()}`,
            }));
        }
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
        logger.info(`[SleepSync][Suunto] Provider disabled by ${SLEEP_SYNC_DISABLED_PROVIDERS_ENV}; ignoring sleep webhook`);
        res.status(200).send();
        return;
    }

    const signature = asString(req.get('X-HMAC-SHA256-Signature'));
    if (!verifySuuntoSignature(req.rawBody, signature)) {
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
        await addSleepSyncQueueItem({
            type: 'suunto_webhook',
            provider: SLEEP_PROVIDERS.SuuntoApp,
            providerUserId,
            payload: { samples },
            dedupeKey: buildSuuntoSleepDedupeKey(providerUserId, samples),
        });
        logger.info(`[SleepSync][Suunto] Queued ${samples.length} sleep samples for ${providerUserId}`);
        res.status(200).send();
    } catch (error) {
        logger.error('[SleepSync][Suunto] Failed to queue sleep payload', error);
        res.status(500).send();
    }
});
