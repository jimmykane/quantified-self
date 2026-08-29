import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import {
    SLEEP_PROVIDERS,
} from '../../../shared/sleep';
import {
    addSleepSyncQueueItem,
    GARMIN_PING_BATCH_MAX_CALLBACK_BYTES,
    GARMIN_PING_BATCH_MAX_CALLBACKS,
    resolveGarminPingFirebaseUserIDs,
} from './queue';
import { verifySuuntoWebhookSignature } from '../suunto/webhook-signature';
import {
    getAllowedSleepSyncUserIds,
    isSleepProviderEnabled,
    SLEEP_SYNC_DISABLED_PROVIDERS,
} from './provider-flags';
import { normalizeTrustedGarminCallbackURL } from './garmin-callback-url';
import {
    GARMIN_SUPPORTED_SUMMARY_TYPES,
    isGarminHealthSummaryType,
    type GarminSupportedSummaryType,
} from '../garmin/health-summary-types';
import { isGarminHealthSyncEnabled } from '../garmin/health-rollout';
import { isProviderQueueSkippedWithoutRetryError } from '../queue/provider-queue-errors';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import {
    persistSuuntoHealthWebhookIngress,
    SUUNTO_HEALTH_WEBHOOK_MAX_WINDOWS,
} from '../suunto/health-webhook-ingress';
import type {
    SuuntoHealthWebhookNotificationType,
    SuuntoHealthWebhookWindow,
} from '../suunto/health-webhook-ingress';
import { isSuuntoHealthSyncEnabled } from '../suunto/health-flags';
import {
    SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH,
    SUUNTO_HEALTH_MAX_SAMPLES,
    SUUNTO_HEALTH_MAX_WINDOW_DAYS,
} from '../suunto/health';
import { resolveActiveSuuntoWebhookUserIDs } from '../suunto/health-webhook-binding-lifecycle';

type ExternalRecord = Record<string, unknown>;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUUNTO_HEALTH_WEBHOOK_MAX_BYTES = 1024 * 1024;
const GARMIN_HEALTH_WEBHOOK_MAX_BYTES = 10 * 1024 * 1024;
const GARMIN_HEALTH_WEBHOOK_MAX_DESCRIPTORS = 10_000;
// Garmin requires asynchronous acknowledgement within 30 seconds. Admission
// remains bounded, but parallel guarded writes keep large valid Ping batches
// inside that response budget without following callbacks in the HTTP path.
const GARMIN_HEALTH_WEBHOOK_QUEUE_CONCURRENCY = 64;
const GARMIN_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH = 512;
const SUUNTO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/;

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

async function resolveScopedSuuntoWebhookUserIDs(providerUserId: string): Promise<string[]> {
    return resolveActiveSuuntoWebhookUserIDs(
        admin.firestore(),
        providerUserId,
        getAllowedSleepSyncUserIds(),
    );
}

function parseSuuntoWebhookLocalDayBounds(value: unknown): SuuntoHealthWebhookWindow {
    const timestamp = asString(value);
    const match = timestamp && timestamp.length <= 64 ? SUUNTO_TIMESTAMP_PATTERN.exec(timestamp) : null;
    if (!match) throw new Error('Invalid Suunto Health webhook timestamp.');
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (hour > 23 || minute > 59 || second > 59) {
        throw new Error('Invalid Suunto Health webhook time.');
    }
    const timezoneLabel = match[7];
    let timezoneOffsetSeconds = 0;
    if (timezoneLabel !== 'Z') {
        const offsetMatch = /^([+-])(\d{2}):?(\d{2})$/.exec(timezoneLabel);
        if (!offsetMatch) throw new Error('Invalid Suunto Health webhook timezone.');
        const hours = Number(offsetMatch[2]);
        const minutes = Number(offsetMatch[3]);
        if (hours > 18 || minutes > 59 || (hours === 18 && minutes !== 0)) {
            throw new Error('Invalid Suunto Health webhook timezone.');
        }
        timezoneOffsetSeconds = ((hours * 60) + minutes) * 60;
        if (offsetMatch[1] === '-') timezoneOffsetSeconds *= -1;
    }
    const calendarDate = `${match[1]}-${match[2]}-${match[3]}`;
    const utcMidnightMs = Date.parse(`${calendarDate}T00:00:00.000Z`);
    const date = new Date(utcMidnightMs);
    if (!Number.isSafeInteger(utcMidnightMs)
        || date.toISOString().slice(0, 10) !== calendarDate) {
        throw new Error('Invalid Suunto Health webhook calendar date.');
    }
    const startMs = utcMidnightMs - (timezoneOffsetSeconds * 1000);
    return { startMs, endMs: startMs + DAY_MS };
}

function buildSuuntoHealthWebhookWindows(samples: unknown[]): SuuntoHealthWebhookWindow[] {
    if (samples.length === 0 || samples.length > SUUNTO_HEALTH_MAX_SAMPLES) {
        throw new Error('Invalid Suunto Health webhook sample count.');
    }
    const dayWindows = samples.map((value, index) => {
        const sample = asRecord(value);
        if (Object.keys(sample).length === 0) {
            throw new Error(`Invalid Suunto Health webhook sample at index ${index}.`);
        }
        return parseSuuntoWebhookLocalDayBounds(sample.timestamp);
    });
    const uniqueDayWindows = [...new Map(dayWindows.map(window => [
        `${window.startMs}:${window.endMs}`,
        window,
    ])).values()].sort((left, right) => left.startMs - right.startMs);
    const contiguousRanges: SuuntoHealthWebhookWindow[] = [];
    for (const dayWindow of uniqueDayWindows) {
        const previous = contiguousRanges[contiguousRanges.length - 1];
        if (previous && dayWindow.startMs <= previous.endMs) {
            previous.endMs = Math.max(previous.endMs, dayWindow.endMs);
        } else {
            contiguousRanges.push({ ...dayWindow });
        }
    }

    const maxWindowMs = SUUNTO_HEALTH_MAX_WINDOW_DAYS * DAY_MS;
    const windows: SuuntoHealthWebhookWindow[] = [];
    for (const range of contiguousRanges) {
        for (let cursorMs = range.startMs; cursorMs < range.endMs; cursorMs += maxWindowMs) {
            windows.push({ startMs: cursorMs, endMs: Math.min(range.endMs, cursorMs + maxWindowMs) });
            if (windows.length > SUUNTO_HEALTH_WEBHOOK_MAX_WINDOWS) {
                throw new Error('Suunto Health webhook spans too many request windows.');
            }
        }
    }
    return windows;
}

async function runWithConcurrency<T>(
    values: readonly T[],
    concurrency: number,
    worker: (value: T) => Promise<void>,
): Promise<void> {
    let nextIndex = 0;
    await Promise.all(Array.from(
        { length: Math.min(concurrency, values.length) },
        async () => {
            while (nextIndex < values.length) {
                const value = values[nextIndex];
                nextIndex += 1;
                await worker(value);
            }
        },
    ));
}

async function handleGarminAPIHealthData(
    req: functions.https.Request,
    res: functions.Response,
): Promise<void> {
    if (req.method && req.method !== 'POST') {
        res.status(405).send();
        return;
    }
    if (req.rawBody && req.rawBody.length > GARMIN_HEALTH_WEBHOOK_MAX_BYTES) {
        logger.warn('[HealthSync][Garmin] Dropped oversized webhook payload');
        res.status(200).send();
        return;
    }

    const sleepEnabled = isSleepProviderEnabled(SLEEP_PROVIDERS.GarminAPI);
    const healthEnabled = isGarminHealthSyncEnabled();
    if (!sleepEnabled && !healthEnabled) {
        logger.info('[HealthSync][Garmin] Sleep and Health ingestion are disabled; ignoring webhook');
        res.status(200).send();
        return;
    }

    const body = asRecord(req.body);
    const pingDescriptors: Array<{
        summaryType: GarminSupportedSummaryType;
        providerUserId: string;
        callbackURL: string;
    }> = [];
    const descriptorKeys = new Set<string>();
    let descriptorCount = 0;
    let malformedCount = 0;
    let disabledCount = 0;
    for (const summaryType of GARMIN_SUPPORTED_SUMMARY_TYPES) {
        const isHealthSummary = isGarminHealthSummaryType(summaryType);
        if ((isHealthSummary && !healthEnabled) || (!isHealthSummary && !sleepEnabled)) {
            disabledCount += asArray(body[summaryType]).length;
            continue;
        }
        for (const pingValue of asArray(body[summaryType])) {
            descriptorCount += 1;
            if (descriptorCount > GARMIN_HEALTH_WEBHOOK_MAX_DESCRIPTORS) {
                logger.warn('[HealthSync][Garmin] Dropped webhook with excessive descriptor count');
                res.status(200).send();
                return;
            }
            const ping = asRecord(pingValue);
            const providerUserId = asString(ping.userId) || asString(ping.userID);
            const trustedCallbackURL = normalizeTrustedGarminCallbackURL(
                asString(ping.callbackURL),
                summaryType,
            );
            if (!providerUserId
                || providerUserId.length > GARMIN_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH
                || !trustedCallbackURL) {
                malformedCount += 1;
                continue;
            }
            const descriptorKey = JSON.stringify([
                summaryType,
                providerUserId,
                trustedCallbackURL,
            ]);
            if (descriptorKeys.has(descriptorKey)) continue;
            descriptorKeys.add(descriptorKey);
            pingDescriptors.push({
                summaryType: summaryType as GarminSupportedSummaryType,
                providerUserId,
                callbackURL: trustedCallbackURL,
            });
        }
    }

    let queuedCount = 0;
    let skippedCount = 0;
    try {
        const firebaseUserIDs = await resolveGarminPingFirebaseUserIDs(
            pingDescriptors.map(descriptor => descriptor.providerUserId),
        );
        const groupedCallbacks = new Map<string, {
            firebaseUserID: string;
            providerUserId: string;
            summaryType: GarminSupportedSummaryType;
            callbackURLs: string[];
        }>();
        for (const descriptor of pingDescriptors) {
            const firebaseUserID = firebaseUserIDs.get(descriptor.providerUserId);
            if (!firebaseUserID) {
                skippedCount += 1;
                continue;
            }
            const groupKey = JSON.stringify([
                firebaseUserID,
                descriptor.providerUserId,
                descriptor.summaryType,
            ]);
            const group = groupedCallbacks.get(groupKey) || {
                firebaseUserID,
                providerUserId: descriptor.providerUserId,
                summaryType: descriptor.summaryType,
                callbackURLs: [],
            };
            group.callbackURLs.push(descriptor.callbackURL);
            groupedCallbacks.set(groupKey, group);
        }

        const queueBatches: Array<{
            input: Parameters<typeof addSleepSyncQueueItem>[0];
            callbackCount: number;
        }> = [];
        for (const group of groupedCallbacks.values()) {
            let callbacks: string[] = [];
            let serializedBytes = 2;
            const flush = () => {
                if (callbacks.length === 0) return;
                const serializedCallbacks = JSON.stringify(callbacks);
                queueBatches.push({
                    input: {
                        type: 'garmin_ping_batch',
                        provider: SLEEP_PROVIDERS.GarminAPI,
                        providerUserId: group.providerUserId,
                        userID: group.firebaseUserID,
                        garminCallbackURLs: callbacks,
                        garminSummaryType: group.summaryType,
                        dedupeKey: crypto.createHash('sha256')
                            .update(`${group.summaryType}:${serializedCallbacks}`)
                            .digest('hex'),
                        // This compact row is the durable acknowledgement
                        // boundary. Cloud Tasks expands it immediately, while
                        // the scheduled dispatcher remains the recovery path.
                        dispatchImmediately: true,
                    },
                    callbackCount: callbacks.length,
                });
                callbacks = [];
                serializedBytes = 2;
            };
            for (const callbackURL of group.callbackURLs) {
                const callbackBytes = Buffer.byteLength(JSON.stringify(callbackURL), 'utf8');
                const delimiterBytes = callbacks.length === 0 ? 0 : 1;
                if (callbacks.length > 0
                    && (callbacks.length >= GARMIN_PING_BATCH_MAX_CALLBACKS
                        || serializedBytes + delimiterBytes + callbackBytes
                            > GARMIN_PING_BATCH_MAX_CALLBACK_BYTES)) {
                    flush();
                }
                callbacks.push(callbackURL);
                serializedBytes += (callbacks.length === 1 ? 0 : 1) + callbackBytes;
            }
            flush();
        }

        await runWithConcurrency(
            queueBatches,
            GARMIN_HEALTH_WEBHOOK_QUEUE_CONCURRENCY,
            async queueBatch => {
                try {
                    await addSleepSyncQueueItem(queueBatch.input);
                    queuedCount += queueBatch.callbackCount;
                } catch (error) {
                    if (isProviderQueueSkippedWithoutRetryError(error)) {
                        skippedCount += queueBatch.callbackCount;
                        return;
                    }
                    throw error;
                }
            },
        );
        logger.info('[HealthSync][Garmin] Webhook accepted', {
            queuedCount,
            skippedCount,
            malformedCount,
            disabledCount,
        });
        res.status(200).send();
    } catch (error) {
        logger.error('[HealthSync][Garmin] Failed to durably queue webhook payload', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        res.status(500).send();
    }
}

export const receiveGarminAPIHealthData = functions.region('europe-west2').runWith({
    timeoutSeconds: 60,
    memory: '1GB',
}).https.onRequest(handleGarminAPIHealthData);

/** Temporary compatibility alias while Garmin is moved to the canonical URL. */
export const receiveGarminAPISleepData = functions.region('europe-west2').runWith({
    timeoutSeconds: 60,
    memory: '1GB',
}).https.onRequest(handleGarminAPIHealthData);

async function handleSuunto247DataWebhook(
    req: functions.https.Request,
    res: functions.Response,
): Promise<void> {
    const signature = asString(req.get('X-HMAC-SHA256-Signature'));
    if (!verifySuuntoWebhookSignature(req.rawBody, signature)) {
        logger.warn('[SleepSync][Suunto] Invalid webhook signature');
        res.status(403).send();
        return;
    }

    const body = asRecord(req.body);
    const notificationType = asString(body.type);
    const isHealthNotification = notificationType === 'SUUNTO_247_ACTIVITY_CREATED'
        || notificationType === 'SUUNTO_247_RECOVERY_CREATED';
    if (notificationType !== 'SUUNTO_247_SLEEP_CREATED' && !isHealthNotification) {
        res.status(200).send();
        return;
    }
    if (isHealthNotification && req.rawBody.length > SUUNTO_HEALTH_WEBHOOK_MAX_BYTES) {
        logger.warn('[HealthSync][Suunto] Dropped oversized signed webhook payload');
        res.status(200).send();
        return;
    }
    if (!isHealthNotification && !isSleepProviderEnabled(SLEEP_PROVIDERS.SuuntoApp)) {
        logger.info(`[SleepSync][Suunto] Provider disabled by SLEEP_SYNC_DISABLED_PROVIDERS=${SLEEP_SYNC_DISABLED_PROVIDERS.join(',')}; ignoring sleep webhook`);
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
    if (providerUserId.length > SUUNTO_HEALTH_MAX_PROVIDER_ACCOUNT_ID_LENGTH) {
        logger.warn(isHealthNotification
            ? '[HealthSync][Suunto] Dropped signed webhook with invalid provider account identifier'
            : '[SleepSync][Suunto] Dropped signed webhook with invalid provider account identifier');
        res.status(200).send();
        return;
    }

    try {
        if (isHealthNotification) {
            if (!isSuuntoHealthSyncEnabled()) {
                res.status(200).send();
                return;
            }
            let windows: SuuntoHealthWebhookWindow[];
            try {
                windows = buildSuuntoHealthWebhookWindows(samples);
            } catch {
                logger.warn('[HealthSync][Suunto] Dropped signed webhook with malformed Health range');
                res.status(200).send();
                return;
            }
            // The authenticated raw bytes provide an exact-retry identity
            // without recursively walking provider-controlled nested values.
            const notificationDigest = crypto.createHash('sha256')
                .update(req.rawBody)
                .digest('hex');
            const ingressResult = await persistSuuntoHealthWebhookIngress({
                notificationDigest,
                notificationType: notificationType as SuuntoHealthWebhookNotificationType,
                providerUserId,
                windows,
            });
            if (ingressResult === 'permanent_skip') {
                logger.info('[HealthSync][Suunto] Dropped signed webhook without an active binding.');
            } else {
                logger.info('[HealthSync][Suunto] Durably accepted webhook ingress', {
                    ingressResult,
                    windows: windows.length,
                });
            }
            res.status(200).send();
            return;
        }

        const scopedUserIDs = await resolveScopedSuuntoWebhookUserIDs(providerUserId);
        if (scopedUserIDs.length === 0) {
            logger.info('[SleepSync][Suunto] Ignoring webhook without a connected Suunto token or outside SLEEP_SYNC_ALLOWED_USER_IDS');
            res.status(200).send();
            return;
        }

        const sleepDedupeKey = buildSuuntoSleepDedupeKey(providerUserId, samples);
        const queueResults = await Promise.allSettled(scopedUserIDs.map(async userID => {
            try {
                await addSleepSyncQueueItem({
                    type: 'suunto_webhook',
                    provider: SLEEP_PROVIDERS.SuuntoApp,
                    userID,
                    providerUserId,
                    payload: { samples },
                    dedupeKey: `${userID}:${sleepDedupeKey}`,
                    dispatchImmediately: true,
                });
                return 'queued' as const;
            } catch (error) {
                if (isProviderQueueSkippedWithoutRetryError(error)) {
                    return 'skipped' as const;
                }
                throw error;
            }
        }));
        const failedResult = queueResults.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (failedResult) throw failedResult.reason;
        const queuedConnectionCount = queueResults.filter(
            result => result.status === 'fulfilled' && result.value === 'queued',
        ).length;
        const skippedConnectionCount = queueResults.length - queuedConnectionCount;
        logger.info('[SleepSync][Suunto] Queued signed Sleep webhook fan-out', {
            samples: samples.length,
            queuedConnectionCount,
            skippedConnectionCount,
        });
        res.status(200).send();
    } catch (error) {
        if (isProviderQueueSkippedWithoutRetryError(error)) {
            logger.info(isHealthNotification
                ? '[HealthSync][Suunto] Ignoring Health notification because the provider user is not connected or is being deleted'
                : '[SleepSync][Suunto] Ignoring sleep payload because the provider user is not connected or is being deleted');
            res.status(200).send();
            return;
        }
        if (isHealthNotification) {
            logger.error('[HealthSync][Suunto] Failed to persist Health webhook ingress', {
                errorName: error instanceof Error ? error.name : 'UnknownError',
            });
        } else {
            logger.error('[SleepSync][Suunto] Failed to queue sleep payload', error);
        }
        res.status(500).send();
    }
}

function createSuunto247DataWebhook(
    secrets: typeof FUNCTION_SECRET_BINDINGS.receiveSuunto247Data,
) {
    return functions.region('europe-west2').runWith({
        timeoutSeconds: 60,
        memory: '256MB',
        secrets,
    }).https.onRequest(handleSuunto247DataWebhook);
}

/** Canonical Suunto 24/7 Sleep, Activity, and Recovery webhook endpoint. */
export const receiveSuunto247Data = createSuunto247DataWebhook(
    FUNCTION_SECRET_BINDINGS.receiveSuunto247Data,
);

export const suuntoWebhookTestInternals = {
    buildSuuntoHealthWebhookWindows,
    parseSuuntoWebhookLocalDayBounds,
    SUUNTO_HEALTH_WEBHOOK_MAX_BYTES,
};
