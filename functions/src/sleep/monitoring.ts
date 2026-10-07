import * as logger from 'firebase-functions/logger';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../garmin/constants';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { isUserDeletionTombstoneActive } from '../shared/user-deletion-guard';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from './constants';
import { isSleepProviderEnabled, isSleepSyncUserAllowed } from './provider-flags';
import { isGarminHealthSyncEnabled } from '../garmin/health-flags';
import { isSuuntoHealthSyncEnabled } from '../suunto/health-flags';

const SOURCES = [
    { provider: SLEEP_PROVIDERS.GarminAPI, root: GARMIN_API_TOKENS_COLLECTION_NAME, identity: 'userID', types: ['garmin_push', 'garmin_ping', 'garmin_ping_batch', 'garmin_health_backfill'] },
    { provider: SLEEP_PROVIDERS.SuuntoApp, root: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME, identity: 'userName', types: ['suunto_webhook', 'suunto_poll', 'suunto_health_poll'] },
    { provider: SLEEP_PROVIDERS.COROSAPI, root: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME, identity: 'openId', types: ['coros_poll'] },
] as const;
export const HEALTH_SLEEP_PROBE_LIMIT = 20;
const TIMEOUT_MS = 5_000;
const QUEUE_FIELDS = ['provider', 'type', 'userID', 'providerUserId', 'processed', 'retryCount', 'dateCreated', 'dispatchedToCloudTask', 'dispatchAfterMs', 'processingLeaseExpiresAt', 'resultStatus', 'rangeStartMs', 'garminSummaryType'];
type Workload = 'sleep_sync' | 'garmin_health_backfill';
const GROUPS = [
    ...SOURCES.map(source => ({ provider: source.provider, workload: 'sleep_sync' as Workload })),
    { provider: SLEEP_PROVIDERS.GarminAPI, workload: 'garmin_health_backfill' as Workload },
];

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function healthSleepWorkloadFields(value: unknown) {
    const item = record(value);
    const source = SOURCES.find(source => source.provider === item.provider);
    return {
        provider: source?.provider || 'unknown',
        workload: item.type === 'garmin_health_backfill' && source?.provider === SLEEP_PROVIDERS.GarminAPI
            ? 'garmin_health_backfill' : 'sleep_sync',
    };
}

function emit(value: unknown, event: string, fields: Record<string, string | number | boolean> = {}): void {
    try { logger.info('[HealthSleep]', { telemetryVersion: 1, ...healthSleepWorkloadFields(value), event, ...fields }); } catch { /* Never alter processing or retry behavior. */ }
}

/** Emit only after the exact guarded transition commits, never in a transaction callback. */
export function recordHealthSleepCommit(item: unknown, outcome: 'completed' | 'skipped' | 'dead_lettered'): void {
    const row = record(item);
    if (record(record(row.ref).parent).id !== SLEEP_SYNC_QUEUE_COLLECTION_NAME) return;
    emit(item, 'committed', { outcome });
}

export function recordHealthSleepCompletion(item: unknown, additionalData?: Record<string, unknown>): void {
    if (additionalData?.resultStatus === 'success') recordHealthSleepCommit(item, 'completed');
    else if (['skipped', 'provider_disabled', 'user_not_allowed'].includes(String(additionalData?.resultStatus))) recordHealthSleepCommit(item, 'skipped');
}

export function healthSleepFailureOutcome(error: unknown): 'error' | 'expected_contention' {
    return error instanceof Error && ['ProviderOperationStillInFlightError', 'TokenRefreshInProgressError', 'TokenRefreshSupersededError'].includes(error.name)
        ? 'expected_contention' : 'error';
}

export function recordHealthSleepRetry(item: unknown, error: unknown): void {
    if (record(record(record(item).ref).parent).id !== SLEEP_SYNC_QUEUE_COLLECTION_NAME) return;
    emit(item, 'retry_transition', { outcome: healthSleepFailureOutcome(error) === 'expected_contention' ? 'expected_contention' : 'retry' });
}

export function recordHealthSleepDispatch(item: unknown, outcome: 'completed' | 'failed'): void {
    emit(item, 'dispatch_run', { outcome });
}

export function recordHealthSleepUnavailable(): void {
    for (const group of GROUPS) emit({ ...group, type: group.workload }, 'queue_sample_unavailable');
}

/** One field-masked shared sample; it neither enumerates history nor reads provider payloads/credentials. */
export async function observeHealthSleepQueue(db: FirebaseFirestore.Firestore, backfillTaskDepth: number | undefined, now = Date.now()): Promise<void> {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sample = async () => {
        const candidates = await db.collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME).where('processed', '==', false)
            .orderBy('dateCreated', 'asc').select(...QUEUE_FIELDS).limit(HEALTH_SLEEP_PROBE_LIMIT + 1).get();
        if (stopped) return;
        const groups = GROUPS.map(group => ({ ...group, sampled: 0, excludedSample: 0, unknownSample: 0, dueSample: 0, ageLowerBoundMs: 0 }));
        for (const doc of candidates.docs.slice(0, HEALTH_SLEEP_PROBE_LIMIT)) {
            if (stopped) return;
            const row = doc.data();
            const source = SOURCES.find(source => source.provider === row.provider);
            const fields = healthSleepWorkloadFields(row);
            const group = groups.find(group => group.provider === fields.provider && group.workload === fields.workload);
            if (!source || !group) { groups.forEach(group => group.unknownSample++); continue; }
            group.sampled++;
            const uid = row.userID;
            const identity = row.providerUserId;
            if (!source.types.includes(row.type as never) || typeof uid !== 'string' || !uid.trim() || uid.includes('/')
                || typeof identity !== 'string' || !identity.trim() || identity.includes('/')
                || !Number.isSafeInteger(row.dateCreated) || row.dateCreated < 0
                || !Number.isSafeInteger(row.retryCount) || row.retryCount < 0
                || ['dispatchedToCloudTask', 'dispatchAfterMs', 'rangeStartMs', 'processingLeaseExpiresAt'].some(field =>
                    row[field] != null && !Number.isSafeInteger(row[field]))) { group.unknownSample++; continue; }
            // Backfill's intentional single-task queue is not a live-ingestion incident.
            if (group.workload === 'garmin_health_backfill') {
                if (backfillTaskDepth === undefined || !Number.isSafeInteger(backfillTaskDepth) || backfillTaskDepth < 0) { group.unknownSample++; continue; }
                if (backfillTaskDepth > 0) { group.excludedSample++; continue; }
            }
            const state = await db.runTransaction(async tx => {
                const user = db.collection('users').doc(uid);
                const root = db.collection(source.root).doc(uid);
                const [current, owner, tombstone, meta, connection] = await tx.getAll(
                    doc.ref, user, db.collection('userDeletionTombstones').doc(uid), user.collection('meta').doc(source.provider), root,
                    { fieldMask: [...QUEUE_FIELDS, 'expireAt', 'connectionState', 'disconnectState', 'disconnectOperationGeneration'] },
                );
                if (stopped) return 'excluded';
                if (!current.exists || !current.updateTime?.isEqual(doc.updateTime!)) return 'excluded';
                if (!owner.exists || isUserDeletionTombstoneActive(tombstone.exists ? tombstone.data() : null, now)) return 'excluded';
                const data = current.data()!;
                if (data.processed !== false || (Number(data.dispatchedToCloudTask) !== 0 && data.dispatchedToCloudTask != null) || data.retryCount > 0
                    || Number(data.dispatchAfterMs) > now || Number(data.rangeStartMs) > now || Number(data.dateCreated) > now
                    || Number(data.processingLeaseExpiresAt) > now || data.resultStatus === 'deferred'
                    || data.resultStatus === 'manual_reconciliation_required') return 'excluded';
                if (['disconnect_pending', 'reconnect_required'].includes(meta.get('connectionState'))
                    || connection.get('disconnectState') === 'disconnect_pending' || connection.get('disconnectOperationGeneration') || !connection.exists) return 'excluded';
                if (source.provider === SLEEP_PROVIDERS.COROSAPI && meta.get('providerUserId') && meta.get('providerUserId') !== identity) return 'excluded';
                const health = data.type === 'suunto_health_poll'
                    || data.type === 'garmin_health_backfill'
                    || source.provider === SLEEP_PROVIDERS.GarminAPI && data.garminSummaryType && data.garminSummaryType !== 'sleeps';
                const enabled = health
                    ? source.provider === SLEEP_PROVIDERS.SuuntoApp ? isSuuntoHealthSyncEnabled() : isGarminHealthSyncEnabled()
                    : isSleepProviderEnabled(source.provider) && isSleepSyncUserAllowed(uid);
                if (!enabled) return 'excluded';
                const tokens = await tx.get(root.collection('tokens').where(source.identity, '==', identity).select('serviceName').limit(1));
                if (stopped) return 'excluded';
                if (tokens.empty) return 'excluded';
                const updated = current.updateTime?.toMillis();
                if (!Number.isSafeInteger(updated) || updated! < 0 || updated! > now + TIMEOUT_MS) return 'unknown';
                return Math.max(0, now - updated!);
            }, { readOnly: true });
            if (stopped) return;
            if (state === 'excluded') group.excludedSample++;
            else if (state === 'unknown') group.unknownSample++;
            else { group.dueSample++; group.ageLowerBoundMs = Math.max(group.ageLowerBoundMs, state); }
        }
        if (stopped) return;
        for (const group of groups) emit({ ...group, type: group.workload }, 'queue_sample', {
            sampled: group.sampled, excludedSample: group.excludedSample, unknownSample: group.unknownSample,
            truncated: candidates.size > HEALTH_SLEEP_PROBE_LIMIT,
            ...(group.dueSample > 0 || group.unknownSample === 0 ? { dueSample: group.dueSample, ageLowerBoundMs: group.ageLowerBoundMs } : {}),
        });
    };
    try {
        await Promise.race([sample(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { stopped = true; reject(new Error('Observation deadline')); }, TIMEOUT_MS);
        })]);
    } catch { recordHealthSleepUnavailable(); }
    finally { stopped = true; if (timer) clearTimeout(timer); }
}
