import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck } from '../utils';
import {
    DERIVED_METRIC_SCHEMA_VERSION,
    DERIVED_METRICS_COLLECTION_ID,
    DERIVED_METRICS_COORDINATOR_DOC_ID,
    PROJECTION_SENSITIVE_DERIVED_METRIC_KINDS,
    getDerivedMetricDocId,
    normalizeDerivedMetricKinds,
    type EnsureDerivedMetricsRequest,
    type EnsureDerivedMetricsResponse,
    type DerivedMetricKind,
} from '../../../shared/derived-metrics';
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
    | 'schema_version_mismatch'
    | 'missing_event_mutation_version'
    | 'missing_snapshot_event_mutation_version'
    | 'missing_completed_at'
    | 'event_mutation_version_behind'
    | 'projection_day_behind'
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

function isProjectionSensitiveMetricKind(kind: DerivedMetricKind): boolean {
    return PROJECTION_SENSITIVE_DERIVED_METRIC_KINDS.includes(kind);
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

    const projectionStaleKinds: DerivedMetricKind[] = [];
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
        if (!Number.isFinite(snapshot.schemaVersion) || (snapshot.schemaVersion as number) < DERIVED_METRIC_SCHEMA_VERSION) {
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
        if (isProjectionSensitiveMetricKind(metricKind)) {
            const asOfDayMs = toFiniteNumber(snapshot.asOfDayMs);
            if (!Number.isFinite(asOfDayMs) || (asOfDayMs as number) < todayUtcDayMs) {
                projectionStaleKinds.push(metricKind);
            }
        }
    }

    if (hardStaleKinds.length > 0) {
        const hasMissingSnapshot = hardStaleKinds.some((metricKind) => !input.metricSnapshotsByKind[metricKind]?.status);
        return {
            shouldQueue: true,
            metricKindsToQueue: [...input.metricKinds],
            reason: hasMissingSnapshot
                ? 'missing_metric_snapshot'
                : (
                    input.metricKinds.some((kind) => {
                        const snapshot = input.metricSnapshotsByKind[kind];
                        return snapshot?.status !== 'ready';
                    })
                        ? 'metric_snapshot_not_ready'
                        : (
                            input.metricKinds.some((kind) => {
                                const snapshot = input.metricSnapshotsByKind[kind];
                                return !Number.isFinite(snapshot?.schemaVersion) || (snapshot?.schemaVersion as number) < DERIVED_METRIC_SCHEMA_VERSION;
                            })
                                ? 'schema_version_mismatch'
                                : (
                                    input.metricKinds.some((kind) => !Number.isFinite(input.metricSnapshotsByKind[kind]?.builtFromEventMutationVersion))
                                        ? 'missing_snapshot_event_mutation_version'
                                        : 'event_mutation_version_behind'
                                )
                        )
                ),
        };
    }

    if (projectionStaleKinds.length > 0) {
        return {
            shouldQueue: true,
            metricKindsToQueue: projectionStaleKinds,
            reason: 'projection_day_behind',
        };
    }
    // Fallback safety net for missed trigger executions:
    // if the most recent event document update is newer than the last successful
    // completion, force a rebuild even when mutation-version metadata did not advance.
    if (Number.isFinite(input.latestEventUpdatedAtMs)
        && Number.isFinite(input.coordinatorCompletedAtMs)
        && (input.latestEventUpdatedAtMs as number) > (input.coordinatorCompletedAtMs as number)) {
        return {
            shouldQueue: true,
            metricKindsToQueue: [...input.metricKinds],
            reason: 'latest_event_update_after_completion',
        };
    }

    return { shouldQueue: false, metricKindsToQueue: [], reason: 'fresh' };
}

export const ensureDerivedMetrics = onCall({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    cors: true,
    timeoutSeconds: 120,
    maxInstances: 100,
}, async (request): Promise<EnsureDerivedMetricsResponse> => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

    const uid = request.auth.uid;
    const payload = (request.data || {}) as EnsureDerivedMetricsRequest;
    const metricKinds = normalizeDerivedMetricKinds(payload.metricKinds);
    const coordinatorRef = admin
        .firestore()
        .doc(`users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${DERIVED_METRICS_COORDINATOR_DOC_ID}`);
    const metricSnapshotRefs = metricKinds.map((metricKind) => admin
        .firestore()
        .doc(`users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(metricKind)}`));
    const eventsCollectionRef = admin
        .firestore()
        .collection('users')
        .doc(uid)
        .collection('events');
    const [
        coordinatorSnapshot,
        metricSnapshots,
        latestEventSnapshot,
    ] = await Promise.all([
        coordinatorRef.get(),
        Promise.all(metricSnapshotRefs.map((snapshotRef) => snapshotRef.get())),
        eventsCollectionRef.orderBy('startDate', 'desc').limit(1).select('startDate').get(),
    ]);

    const coordinatorData = coordinatorSnapshot.data() || {};
    const coordinatorStatus = parseCoordinatorStatus(coordinatorData.status);
    const coordinatorCompletedAtMs = toFiniteNumber(coordinatorData.completedAtMs);
    const coordinatorRequestedAtMs = toFiniteNumber(coordinatorData.requestedAtMs);
    const coordinatorStartedAtMs = toFiniteNumber(coordinatorData.startedAtMs);
    const coordinatorUpdatedAtMs = toFiniteNumber(coordinatorData.updatedAtMs);
    const coordinatorGeneration = toFiniteNumber(coordinatorData.generation);
    const coordinatorEventMutationVersion = toFiniteNumber(coordinatorData.eventMutationVersion);

    const metricSnapshotsByKind = metricKinds.reduce((result, metricKind, index) => {
        const snapshotData = (metricSnapshots[index]?.data() || {}) as Record<string, unknown>;
        const payload = (snapshotData?.payload && typeof snapshotData.payload === 'object')
            ? snapshotData.payload as Record<string, unknown>
            : {};
        result[metricKind] = {
            status: toSafeString(snapshotData.status) || null,
            schemaVersion: toFiniteNumber(snapshotData.schemaVersion),
            builtFromEventMutationVersion: toFiniteNumber(snapshotData.builtFromEventMutationVersion),
            asOfDayMs: toFiniteNumber(payload.asOfDayMs),
        };
        return result;
    }, {} as Record<DerivedMetricKind, {
        status: string | null;
        schemaVersion: number | null;
        builtFromEventMutationVersion: number | null;
        asOfDayMs: number | null;
    }>);
    const latestEventDoc = latestEventSnapshot.docs[0];
    const latestEventUpdatedAtMs = toMillis(latestEventDoc?.updateTime);
    const freshnessDecision = decideDerivedMetricsFreshness({
        metricKinds,
        nowMs: Date.now(),
        coordinatorStatus,
        coordinatorCompletedAtMs,
        coordinatorRequestedAtMs,
        coordinatorStartedAtMs,
        coordinatorUpdatedAtMs,
        coordinatorEventMutationVersion,
        metricSnapshotsByKind,
        latestEventUpdatedAtMs,
    });
    if (!freshnessDecision.shouldQueue) {
        return {
            accepted: true,
            queued: false,
            generation: Number.isFinite(coordinatorGeneration) ? Math.max(0, Math.floor(coordinatorGeneration as number)) : null,
            metricKinds,
        };
    }

    return markDerivedMetricsDirtyAndMaybeQueue(
        uid,
        freshnessDecision.metricKindsToQueue.length
            ? freshnessDecision.metricKindsToQueue
            : metricKinds,
    );
});
