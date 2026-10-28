import { performance } from 'node:perf_hooks';
import * as logger from 'firebase-functions/logger';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import type { SleepSyncQueueItemType } from '../queue/queue-item.interface';

// Temporary diagnostics for #759. Removal is tracked in #825.
export const GARMIN_DISPATCH_IGNORED_SAMPLE_RATE = 0.05;
const TELEMETRY_VERSION = 1;
const QUEUE_TYPES = new Set<SleepSyncQueueItemType>([
    'garmin_push', 'garmin_ping', 'garmin_ping_batch', 'garmin_health_backfill',
    'suunto_webhook', 'suunto_poll', 'suunto_health_poll', 'coros_poll',
]);

export type GarminDispatchOutcome =
    | 'deleted_write' | 'missing_data' | 'other_provider_or_type'
    | 'already_processed' | 'already_dispatched' | 'same_revision' | 'invalid_revision'
    | 'dispatched' | 'stale' | 'leased' | 'deleted' | 'deferred' | 'error';
export type QueueWriteKind = 'create' | 'update' | 'delete' | 'unknown';

const IGNORED_OUTCOMES = new Set<GarminDispatchOutcome>([
    'deleted_write', 'missing_data', 'other_provider_or_type',
    'already_processed', 'already_dispatched', 'same_revision', 'invalid_revision',
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object'
        ? value as Record<string, unknown>
        : undefined;
}

function safeWorkloadFields(queueItem: unknown) {
    const item = asRecord(queueItem);
    const provider = item?.provider === SLEEP_PROVIDERS.GarminAPI
        || item?.provider === SLEEP_PROVIDERS.SuuntoApp
        || item?.provider === SLEEP_PROVIDERS.COROSAPI
        ? item.provider
        : 'unknown';
    const queueType: SleepSyncQueueItemType | 'unknown' = QUEUE_TYPES.has(item?.type as SleepSyncQueueItemType)
        ? item?.type as SleepSyncQueueItemType
        : 'unknown';
    return { provider, queueType };
}

function queueAgeMs(queueItem: unknown, nowMs: number): number | null {
    const created = asRecord(queueItem)?.dateCreated;
    return typeof created === 'number' && Number.isSafeInteger(created)
        && created >= 0 && created <= nowMs
        ? nowMs - created
        : null;
}

export function logGarminDispatchSummary(params: {
    queueItem: () => unknown;
    outcome: GarminDispatchOutcome;
    writeKind: QueueWriteKind;
    enqueueConfirmed: boolean;
    durationMs: number;
}): void {
    try {
        const sampleRate = IGNORED_OUTCOMES.has(params.outcome)
            ? GARMIN_DISPATCH_IGNORED_SAMPLE_RATE
            : 1;
        if (sampleRate < 1 && Math.random() >= sampleRate) return;
        const queueItem = params.queueItem();
        logger.info('[GarminPingBatchDispatcher] Invocation summary', {
            telemetryVersion: TELEMETRY_VERSION,
            dispatchSource: 'firestore',
            ...safeWorkloadFields(queueItem),
            writeKind: params.writeKind,
            outcome: params.outcome,
            enqueueConfirmed: params.enqueueConfirmed,
            sampleRate,
            sampleWeight: 1 / sampleRate,
            durationMs: Math.max(0, params.durationMs),
            queueAgeMs: queueAgeMs(queueItem, Date.now()),
        });
    } catch {
        // Diagnostic failures must not change event acknowledgement or retries.
    }
}

export interface SleepDispatchTotals {
    inspected: number;
    dispatched: number;
    skippedRecent: number;
}

interface WorkloadCounts {
    provider: string;
    queueType: SleepSyncQueueItemType | 'unknown';
    inspected: number;
    considered: number;
    enqueueConfirmed: number;
    markedDispatched: number;
    markedUndispatched: number;
    markedStaleRecovery: number;
    markedLeaseRecovery: number;
    skippedRecent: number;
    skippedCapacity: number;
    skippedInvalidDate: number;
    skippedGuard: number;
    unconfirmed: number;
    notMarked: number;
    errors: number;
    oldestQueueAgeMs: number | null;
}

/** One bounded aggregate per reconciliation run; no per-document logs or extra I/O. */
export class SleepDispatchReconciliationTelemetry {
    private readonly startedAtMs = performance.now();
    private readonly workloads = new Map<string, WorkloadCounts>();
    private scannedTaskClasses = { sleepSync: false, garminHealthBackfill: false };

    setScannedTaskClasses(scanned: { sleepSync: boolean; garminHealthBackfill: boolean }): void {
        this.scannedTaskClasses = { ...scanned };
    }

    inspect(queueItem: unknown, nowMs: number): WorkloadCounts {
        const fields = safeWorkloadFields(queueItem);
        const key = `${fields.provider}:${fields.queueType}`;
        let counts = this.workloads.get(key);
        if (!counts) {
            counts = {
                ...fields,
                inspected: 0, considered: 0, enqueueConfirmed: 0, markedDispatched: 0,
                markedUndispatched: 0, markedStaleRecovery: 0, markedLeaseRecovery: 0,
                skippedRecent: 0, skippedCapacity: 0, skippedInvalidDate: 0, skippedGuard: 0,
                unconfirmed: 0, notMarked: 0, errors: 0, oldestQueueAgeMs: null,
            };
            this.workloads.set(key, counts);
        }
        counts.inspected += 1;
        const age = queueAgeMs(queueItem, nowMs);
        if (age !== null) counts.oldestQueueAgeMs = Math.max(counts.oldestQueueAgeMs ?? 0, age);
        return counts;
    }

    complete<T extends SleepDispatchTotals>(totals: T): T {
        try {
            logger.info('[SleepSyncDispatcher] Reconciliation completed', {
                ...totals,
                telemetryVersion: TELEMETRY_VERSION,
                dispatchSource: 'scheduled',
                durationMs: Math.max(0, performance.now() - this.startedAtMs),
                scannedTaskClasses: this.scannedTaskClasses,
                workloads: [...this.workloads.values()],
            });
        } catch {
            // Diagnostic failures must not cause reconciliation to be retried.
        }
        return totals;
    }
}
