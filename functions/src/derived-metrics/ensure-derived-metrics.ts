import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck } from '../utils';
import {
    DERIVED_METRIC_SCHEMA_VERSION,
    DERIVED_METRIC_KINDS,
    DERIVED_TRAINING_BUILD_COMPARISON_RECOVERY_VERSION,
    DERIVED_METRICS_COLLECTION_ID,
    DERIVED_METRICS_COORDINATOR_DOC_ID,
    CALENDAR_SENSITIVE_DERIVED_METRIC_KINDS,
    getDerivedMetricDocId,
    normalizeDerivedMetricKinds,
    normalizeDerivedMetricKindsStrict,
    type EnsureDerivedMetricsRequest,
    type EnsureDerivedMetricsResponse,
    type DerivedMetricKind,
} from '../../../shared/derived-metrics';
import { normalizeDerivedTrainingReadinessMetricPayload } from '../../../shared/training-readiness-metric';
import { isMcpTrainingMetricPayloadReadable } from '../mcp/data.service';
import { markDerivedMetricsDirtyAndMaybeQueue } from './derived-metrics.service';

const DERIVED_METRICS_STUCK_QUEUED_THRESHOLD_MS = 10 * 60 * 1000;
const DERIVED_METRICS_STUCK_PROCESSING_THRESHOLD_MS = 15 * 60 * 1000;

type DerivedMetricsCoordinatorStatus = 'idle' | 'queued' | 'processing' | 'failed';

interface DerivedMetricsFreshnessInput {
    metricKinds: readonly DerivedMetricKind[];
    nowMs: number;
    coordinatorStatus: DerivedMetricsCoordinatorStatus;
    coordinatorCompletedAtMs: number | null;
    coordinatorRequestedAtMs: number | null;
    coordinatorStartedAtMs: number | null;
    coordinatorUpdatedAtMs: number | null;
    coordinatorEventMutationVersion: number | null;
    metricSnapshotsByKind: Record<DerivedMetricKind, {
        status: string | null;
        schemaVersion: number | null;
        builtFromEventMutationVersion: number | null;
        asOfDayMs: number | null;
        payloadValid: boolean;
    }>;
    latestEventUpdatedAtMs: number | null;
}

interface DerivedMetricsFreshnessDecision {
    shouldQueue: boolean;
    metricKindsToQueue: DerivedMetricKind[];
    reason:
    | 'failed_status'
    | 'queued_stuck'
    | 'processing_stuck'
    | 'missing_metric_snapshot'
    | 'metric_snapshot_not_ready'
    | 'invalid_metric_payload'
    | 'schema_version_mismatch'
    | 'missing_event_mutation_version'
    | 'missing_snapshot_event_mutation_version'
    | 'missing_completed_at'
    | 'event_mutation_version_behind'
    | 'calendar_day_behind'
    | 'latest_event_update_after_completion'
    | 'fresh';
}

function toSafeString(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    return `${value}`;
}

function toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
        return null;
    }
    return numericValue;
}

function toMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }
    if (typeof (value as { toMillis?: unknown } | null | undefined)?.toMillis === 'function') {
        const time = Number((value as { toMillis: () => unknown }).toMillis());
        return Number.isFinite(time) ? time : null;
    }
    if (typeof (value as { toDate?: unknown } | null | undefined)?.toDate === 'function') {
        const date = (value as { toDate: () => Date }).toDate();
        return Number.isFinite(date.getTime()) ? date.getTime() : null;
    }
    if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
        const seconds = Number((value as Record<string, unknown>).seconds);
        const nanos = Number((value as Record<string, unknown>).nanoseconds || 0);
        if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
            return null;
        }
        return Math.floor((seconds * 1000) + (nanos / 1_000_000));
    }
    return null;
}

function parseCoordinatorStatus(value: unknown): DerivedMetricsCoordinatorStatus {
    const normalized = `${value || ''}`.trim();
    if (normalized === 'queued' || normalized === 'processing' || normalized === 'failed') {
        return normalized;
    }
    return 'idle';
}

function resolveUtcDayStartMs(timeMs: number): number {
    const date = new Date(timeMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isCalendarSensitiveMetricKind(kind: DerivedMetricKind): boolean {
    return CALENDAR_SENSITIVE_DERIVED_METRIC_KINDS.includes(kind);
}

export function decideDerivedMetricsFreshness(input: DerivedMetricsFreshnessInput): DerivedMetricsFreshnessDecision {
    if (input.coordinatorStatus === 'failed') {
        return {
            shouldQueue: true,
            metricKindsToQueue: [...input.metricKinds],
            reason: 'failed_status',
        };
    }

    if (input.coordinatorStatus === 'queued') {
        const queuedSinceMs = input.coordinatorRequestedAtMs ?? input.coordinatorUpdatedAtMs;
        if (Number.isFinite(queuedSinceMs) && (input.nowMs - (queuedSinceMs as number)) >= DERIVED_METRICS_STUCK_QUEUED_THRESHOLD_MS) {
            return {
                shouldQueue: true,
                metricKindsToQueue: [...input.metricKinds],
                reason: 'queued_stuck',
            };
        }
        return { shouldQueue: false, metricKindsToQueue: [], reason: 'fresh' };
    }

    if (input.coordinatorStatus === 'processing') {
        const processingSinceMs = input.coordinatorStartedAtMs ?? input.coordinatorUpdatedAtMs;
        if (Number.isFinite(processingSinceMs) && (input.nowMs - (processingSinceMs as number)) >= DERIVED_METRICS_STUCK_PROCESSING_THRESHOLD_MS) {
            return {
                shouldQueue: true,
                metricKindsToQueue: [...input.metricKinds],
                reason: 'processing_stuck',
            };
        }
        return { shouldQueue: false, metricKindsToQueue: [], reason: 'fresh' };
    }

    if (!Number.isFinite(input.coordinatorEventMutationVersion)) {
        return {
            shouldQueue: true,
            metricKindsToQueue: [...input.metricKinds],
            reason: 'missing_event_mutation_version',
        };
    }
    const coordinatorEventMutationVersion = Math.max(0, Math.floor(input.coordinatorEventMutationVersion as number));

    if (!Number.isFinite(input.coordinatorCompletedAtMs)) {
        return {
            shouldQueue: true,
            metricKindsToQueue: [...input.metricKinds],
            reason: 'missing_completed_at',
        };
    }

    const calendarStaleKinds: DerivedMetricKind[] = [];
    const hardStaleKinds: DerivedMetricKind[] = [];
    const todayUtcDayMs = resolveUtcDayStartMs(input.nowMs);

    for (const metricKind of input.metricKinds) {
        const snapshot = input.metricSnapshotsByKind[metricKind];
        if (!snapshot) {
            hardStaleKinds.push(metricKind);
            continue;
        }
        if (!snapshot.status) {
            hardStaleKinds.push(metricKind);
            continue;
        }
        if (snapshot.status !== 'ready') {
            hardStaleKinds.push(metricKind);
            continue;
        }
        if (!snapshot.payloadValid) {
            hardStaleKinds.push(metricKind);
            continue;
        }
        if (snapshot.schemaVersion !== DERIVED_METRIC_SCHEMA_VERSION) {
            hardStaleKinds.push(metricKind);
            continue;
        }
        if (!Number.isFinite(snapshot.builtFromEventMutationVersion)) {
            hardStaleKinds.push(metricKind);
            continue;
        }
        const builtFromEventMutationVersion = Math.max(0, Math.floor(snapshot.builtFromEventMutationVersion as number));
        if (builtFromEventMutationVersion < coordinatorEventMutationVersion) {
            hardStaleKinds.push(metricKind);
            continue;
        }
        if (isCalendarSensitiveMetricKind(metricKind)) {
            const asOfDayMs = toFiniteNumber(snapshot.asOfDayMs);
            if (!Number.isFinite(asOfDayMs) || (asOfDayMs as number) < todayUtcDayMs) {
                calendarStaleKinds.push(metricKind);
            }
        }
    }

    const latestEventUpdateAfterCompletion = Number.isFinite(input.latestEventUpdatedAtMs)
        && Number.isFinite(input.coordinatorCompletedAtMs)
        && (input.latestEventUpdatedAtMs as number) > (input.coordinatorCompletedAtMs as number);
    const staleKindsToQueue = new Set<DerivedMetricKind>([
        ...hardStaleKinds,
        ...calendarStaleKinds,
    ]);
    // A missed event trigger can leave every requested snapshot stale, even if a
    // separate snapshot-level failure also exists in this same probe.
    if (latestEventUpdateAfterCompletion) {
        for (const metricKind of input.metricKinds) {
            staleKindsToQueue.add(metricKind);
        }
    }

    if (hardStaleKinds.length > 0) {
        const hasMissingSnapshot = hardStaleKinds.some((metricKind) => !input.metricSnapshotsByKind[metricKind]?.status);
        const hasNotReadySnapshot = hardStaleKinds.some((kind) => {
            const snapshot = input.metricSnapshotsByKind[kind];
            return snapshot?.status !== 'ready';
        });
        const hasInvalidPayload = hardStaleKinds.some(
            kind => input.metricSnapshotsByKind[kind]?.payloadValid === false,
        );
        const hasSchemaVersionMismatch = hardStaleKinds.some((kind) => {
            const snapshot = input.metricSnapshotsByKind[kind];
            return snapshot?.schemaVersion !== DERIVED_METRIC_SCHEMA_VERSION;
        });
        const hasMissingSnapshotMutationVersion = hardStaleKinds.some(
            kind => !Number.isFinite(input.metricSnapshotsByKind[kind]?.builtFromEventMutationVersion),
        );
        const reason: DerivedMetricsFreshnessDecision['reason'] = hasMissingSnapshot
            ? 'missing_metric_snapshot'
            : hasNotReadySnapshot
                ? 'metric_snapshot_not_ready'
                : hasInvalidPayload
                    ? 'invalid_metric_payload'
                    : hasSchemaVersionMismatch
                        ? 'schema_version_mismatch'
                        : hasMissingSnapshotMutationVersion
                            ? 'missing_snapshot_event_mutation_version'
                            : 'event_mutation_version_behind';
        return {
            shouldQueue: true,
            metricKindsToQueue: input.metricKinds.filter(metricKind => staleKindsToQueue.has(metricKind)),
            reason,
        };
    }

    if (calendarStaleKinds.length > 0) {
        return {
            shouldQueue: true,
            metricKindsToQueue: input.metricKinds.filter(metricKind => staleKindsToQueue.has(metricKind)),
            reason: 'calendar_day_behind',
        };
    }
    // Fallback safety net for missed trigger executions:
    // if the most recent event document update is newer than the last successful
    // completion, force a rebuild even when mutation-version metadata did not advance.
    if (latestEventUpdateAfterCompletion) {
        return {
            shouldQueue: true,
            metricKindsToQueue: [...input.metricKinds],
            reason: 'latest_event_update_after_completion',
        };
    }

    return { shouldQueue: false, metricKindsToQueue: [], reason: 'fresh' };
}

export interface DerivedMetricsProbe {
    input: DerivedMetricsFreshnessInput;
    generation: number | null;
    scheduledMetricKinds: DerivedMetricKind[];
}

async function readDerivedMetricsProbe(uid: string, metricKinds: DerivedMetricKind[]): Promise<DerivedMetricsProbe> {
    const coordinatorRef = admin.firestore().doc(
        `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${DERIVED_METRICS_COORDINATOR_DOC_ID}`,
    );
    const metricSnapshotRefs = metricKinds.map(metricKind => admin.firestore().doc(
        `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(metricKind)}`,
    ));
    const eventsCollectionRef = admin.firestore().collection('users').doc(uid).collection('events');
    const [coordinatorSnapshot, metricSnapshots, latestEventSnapshot] = await Promise.all([
        coordinatorRef.get(),
        Promise.all(metricSnapshotRefs.map(snapshotRef => snapshotRef.get())),
        eventsCollectionRef.orderBy('startDate', 'desc').limit(1).select('startDate').get(),
    ]);
    const coordinatorData = coordinatorSnapshot.data() || {};
    const metricSnapshotsByKind = metricKinds.reduce((result, metricKind, index) => {
        const snapshotData = (metricSnapshots[index]?.data() || {}) as Record<string, unknown>;
        const payload = snapshotData.payload && typeof snapshotData.payload === 'object'
            ? snapshotData.payload as Record<string, unknown>
            : {};
        result[metricKind] = {
            status: toSafeString(snapshotData.status) || null,
            schemaVersion: toFiniteNumber(snapshotData.schemaVersion),
            builtFromEventMutationVersion: toFiniteNumber(snapshotData.builtFromEventMutationVersion),
            asOfDayMs: toFiniteNumber(payload.asOfDayMs),
            payloadValid: isDerivedMetricSnapshotReadableByMcp(metricKind, snapshotData.payload),
        };
        return result;
    }, {} as DerivedMetricsFreshnessInput['metricSnapshotsByKind']);
    return {
        generation: toFiniteNumber(coordinatorData.generation),
        scheduledMetricKinds: normalizeDerivedMetricKindsStrict([
            ...(Array.isArray(coordinatorData.dirtyMetricKinds) ? coordinatorData.dirtyMetricKinds : []),
            ...(Array.isArray(coordinatorData.processingMetricKinds) ? coordinatorData.processingMetricKinds : []),
        ]),
        input: {
            metricKinds,
            nowMs: Date.now(),
            coordinatorStatus: parseCoordinatorStatus(coordinatorData.status),
            coordinatorCompletedAtMs: toFiniteNumber(coordinatorData.completedAtMs),
            coordinatorRequestedAtMs: toFiniteNumber(coordinatorData.requestedAtMs),
            coordinatorStartedAtMs: toFiniteNumber(coordinatorData.startedAtMs),
            coordinatorUpdatedAtMs: toFiniteNumber(coordinatorData.updatedAtMs),
            coordinatorEventMutationVersion: toFiniteNumber(coordinatorData.eventMutationVersion),
            metricSnapshotsByKind,
            latestEventUpdatedAtMs: toMillis(latestEventSnapshot.docs[0]?.updateTime),
        },
    };
}

export function resolveDerivedMetricKindsToQueue(probe: DerivedMetricsProbe): DerivedMetricKind[] {
    const decision = decideDerivedMetricsFreshness(probe.input);
    if (decision.shouldQueue) {
        return decision.metricKindsToQueue.length ? decision.metricKindsToQueue : [...probe.input.metricKinds];
    }
    if (probe.input.coordinatorStatus !== 'queued' && probe.input.coordinatorStatus !== 'processing') {
        return [];
    }
    const scheduled = new Set(probe.scheduledMetricKinds);
    return probe.input.metricKinds.filter(metricKind => !scheduled.has(metricKind)
        && decideDerivedMetricsFreshness({
            ...probe.input,
            coordinatorStatus: 'idle',
            metricKinds: [metricKind],
        }).shouldQueue);
}

export async function ensureDerivedMetricsForUser(
    uid: string,
    metricKinds: DerivedMetricKind[],
): Promise<EnsureDerivedMetricsResponse> {
    const probe = await readDerivedMetricsProbe(uid, metricKinds);
    const metricKindsToQueue = resolveDerivedMetricKindsToQueue(probe);
    if (!metricKindsToQueue.length) {
        return {
            accepted: true,
            queued: false,
            generation: Number.isFinite(probe.generation)
                ? Math.max(0, Math.floor(probe.generation as number)) : null,
            metricKinds,
        };
    }
    return markDerivedMetricsDirtyAndMaybeQueue(
        uid,
        metricKindsToQueue,
    );
}

export interface PrepareDerivedMetricsResult {
    status: 'ready' | 'preparing' | 'unavailable';
    metricKinds: DerivedMetricKind[];
    readyMetricKinds: DerivedMetricKind[];
    retryAfterSeconds: number | null;
}

export function resolveReadyDerivedMetricKinds(input: DerivedMetricsFreshnessInput): DerivedMetricKind[] {
    return input.metricKinds.filter(metricKind =>
        !decideDerivedMetricsFreshness({ ...input, metricKinds: [metricKind] }).shouldQueue
        && input.coordinatorStatus === 'idle'
        && input.metricSnapshotsByKind[metricKind]?.status === 'ready',
    );
}

export async function prepareDerivedMetricsForUser(
    uid: string,
    metricKinds: DerivedMetricKind[],
    waitMs = 5_000,
    dependencies: {
        ensure: typeof ensureDerivedMetricsForUser;
        readProbe: typeof readDerivedMetricsProbe;
        now: () => number;
        sleep: (ms: number) => Promise<void>;
    } = {
        ensure: ensureDerivedMetricsForUser,
        readProbe: readDerivedMetricsProbe,
        now: Date.now,
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    },
): Promise<PrepareDerivedMetricsResult> {
    const initial = await dependencies.ensure(uid, metricKinds);
    if (!initial.accepted) {
        return { status: 'unavailable', metricKinds, readyMetricKinds: [], retryAfterSeconds: null };
    }
    const deadline = dependencies.now() + Math.max(0, Math.min(waitMs, 5_000));
    while (true) {
        const probe = await dependencies.readProbe(uid, metricKinds);
        const readyMetricKinds = resolveReadyDerivedMetricKinds(probe.input);
        if (readyMetricKinds.length === metricKinds.length) {
            return { status: 'ready', metricKinds, readyMetricKinds, retryAfterSeconds: null };
        }
        if (probe.input.coordinatorStatus === 'failed') {
            return { status: 'unavailable', metricKinds, readyMetricKinds, retryAfterSeconds: null };
        }
        if (dependencies.now() >= deadline) {
            return { status: 'preparing', metricKinds, readyMetricKinds, retryAfterSeconds: 5 };
        }
        await dependencies.sleep(Math.min(1_000, Math.max(0, deadline - dependencies.now())));
    }
}

export const ensureDerivedMetrics = onCall({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    cors: true,
    timeoutSeconds: 120,
    memory: '512MiB',
    maxInstances: 100,
}, async (request): Promise<EnsureDerivedMetricsResponse> => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

    const uid = request.auth.uid;
    const payload = (request.data || {}) as EnsureDerivedMetricsRequest;
    const metricKinds = normalizeDerivedMetricKinds(payload.metricKinds);
    return ensureDerivedMetricsForUser(uid, metricKinds);
});

export function resolveDerivedMetricSnapshotPayloadValidity(
    metricKind: DerivedMetricKind,
    payload: unknown,
): boolean {
    if (payload === null || payload === undefined) {
        return false;
    }
    if (metricKind === DERIVED_METRIC_KINDS.TrainingDurability) {
        return hasTrainingDurabilitySupportingEventStartTimes(payload);
    }
    if (metricKind === DERIVED_METRIC_KINDS.TrainingReadiness) {
        return normalizeDerivedTrainingReadinessMetricPayload(payload) !== null;
    }
    if (metricKind === DERIVED_METRIC_KINDS.TrainingBuildComparison) {
        const source = payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : null;
        return source?.recoveryVersion === DERIVED_TRAINING_BUILD_COMPARISON_RECOVERY_VERSION;
    }
    return true;
}

export function isDerivedMetricSnapshotReadableByMcp(metricKind: DerivedMetricKind, payload: unknown): boolean {
    return resolveDerivedMetricSnapshotPayloadValidity(metricKind, payload)
        && isMcpTrainingMetricPayloadReadable(metricKind, payload);
}

function hasTrainingDurabilitySupportingEventStartTimes(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false;
    }
    const scopes = (payload as Record<string, unknown>).scopes;
    if (!Array.isArray(scopes)) {
        return false;
    }
    return scopes.every((scope) => {
        if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
            return false;
        }
        const recentSupportingEvents = (scope as Record<string, unknown>).recentSupportingEvents;
        return Array.isArray(recentSupportingEvents) && recentSupportingEvents.every((event) => (
            !!event
            && typeof event === 'object'
            && !Array.isArray(event)
            && typeof (event as Record<string, unknown>).startMs === 'number'
            && Number.isFinite((event as Record<string, unknown>).startMs)
        ));
    });
}
