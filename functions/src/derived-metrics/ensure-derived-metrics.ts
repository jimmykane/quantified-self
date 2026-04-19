import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck } from '../utils';
import {
    DERIVED_METRIC_KINDS,
    DERIVED_METRICS_COLLECTION_ID,
    DERIVED_METRICS_COORDINATOR_DOC_ID,
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
    coordinatorUpdatedAtMs: number | null;
    coordinatorEventMutationVersion: number | null;
    formSnapshotStatus: string | null;
    formSnapshotBuiltFromEventMutationVersion: number | null;
    latestEventUpdatedAtMs: number | null;
}

interface DerivedMetricsFreshnessDecision {
    shouldQueue: boolean;
    reason:
    | 'failed_status'
    | 'queued_stuck'
    | 'processing_stuck'
    | 'requested_metric_without_form'
    | 'missing_form_snapshot'
    | 'missing_event_mutation_version'
    | 'missing_snapshot_event_mutation_version'
    | 'missing_completed_at'
    | 'event_mutation_version_behind'
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

export function decideDerivedMetricsFreshness(input: DerivedMetricsFreshnessInput): DerivedMetricsFreshnessDecision {
    if (input.coordinatorStatus === 'failed') {
        return { shouldQueue: true, reason: 'failed_status' };
    }

    if (input.coordinatorStatus === 'queued') {
        const queuedSinceMs = input.coordinatorUpdatedAtMs;
        if (Number.isFinite(queuedSinceMs) && (input.nowMs - (queuedSinceMs as number)) >= DERIVED_METRICS_STUCK_QUEUED_THRESHOLD_MS) {
            return { shouldQueue: true, reason: 'queued_stuck' };
        }
        return { shouldQueue: false, reason: 'fresh' };
    }

    if (input.coordinatorStatus === 'processing') {
        const processingSinceMs = input.coordinatorUpdatedAtMs;
        if (Number.isFinite(processingSinceMs) && (input.nowMs - (processingSinceMs as number)) >= DERIVED_METRICS_STUCK_PROCESSING_THRESHOLD_MS) {
            return { shouldQueue: true, reason: 'processing_stuck' };
        }
        return { shouldQueue: false, reason: 'fresh' };
    }

    const includesForm = input.metricKinds.includes(DERIVED_METRIC_KINDS.Form);
    if (!includesForm) {
        // Non-form request paths are used to recover stale/missing non-form metrics.
        // Queue directly unless an active queued/processing coordinator is already handling work.
        return { shouldQueue: true, reason: 'requested_metric_without_form' };
    }

    if (!Number.isFinite(input.coordinatorEventMutationVersion)) {
        return { shouldQueue: true, reason: 'missing_event_mutation_version' };
    }
    const coordinatorEventMutationVersion = Math.max(0, Math.floor(input.coordinatorEventMutationVersion as number));

    if (input.formSnapshotStatus !== 'ready') {
        return { shouldQueue: true, reason: 'missing_form_snapshot' };
    }
    if (!Number.isFinite(input.coordinatorCompletedAtMs)) {
        return { shouldQueue: true, reason: 'missing_completed_at' };
    }
    if (!Number.isFinite(input.formSnapshotBuiltFromEventMutationVersion)) {
        return { shouldQueue: true, reason: 'missing_snapshot_event_mutation_version' };
    }
    const formSnapshotBuiltFromEventMutationVersion = Math.max(
        0,
        Math.floor(input.formSnapshotBuiltFromEventMutationVersion as number),
    );
    // Freshness is revision-based instead of count-based so snapshot metadata drift
    // (for example duplicate task races) cannot cause perpetual rebuild loops.
    if (formSnapshotBuiltFromEventMutationVersion < coordinatorEventMutationVersion) {
        return { shouldQueue: true, reason: 'event_mutation_version_behind' };
    }
    // Fallback safety net for missed trigger executions:
    // if the most recent event document update is newer than the last successful
    // completion, force a rebuild even when mutation-version metadata did not advance.
    if (Number.isFinite(input.latestEventUpdatedAtMs)
        && Number.isFinite(input.coordinatorCompletedAtMs)
        && (input.latestEventUpdatedAtMs as number) > (input.coordinatorCompletedAtMs as number)) {
        return { shouldQueue: true, reason: 'latest_event_update_after_completion' };
    }

    return { shouldQueue: false, reason: 'fresh' };
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
    const formSnapshotRef = admin
        .firestore()
        .doc(`users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(DERIVED_METRIC_KINDS.Form)}`);
    const eventsCollectionRef = admin
        .firestore()
        .collection('users')
        .doc(uid)
        .collection('events');
    const [
        coordinatorSnapshot,
        formSnapshot,
        latestEventSnapshot,
    ] = await Promise.all([
        coordinatorRef.get(),
        formSnapshotRef.get(),
        eventsCollectionRef.orderBy('startDate', 'desc').limit(1).select('startDate').get(),
    ]);

    const coordinatorData = coordinatorSnapshot.data() || {};
    const coordinatorStatus = parseCoordinatorStatus(coordinatorData.status);
    const coordinatorCompletedAtMs = toFiniteNumber(coordinatorData.completedAtMs);
    const coordinatorUpdatedAtMs = toFiniteNumber(coordinatorData.updatedAtMs);
    const coordinatorGeneration = toFiniteNumber(coordinatorData.generation);
    const coordinatorEventMutationVersion = toFiniteNumber(coordinatorData.eventMutationVersion);

    const formSnapshotData = formSnapshot.data() || {};
    const formSnapshotStatus = toSafeString(formSnapshotData.status) || null;
    const formSnapshotBuiltFromEventMutationVersion = toFiniteNumber(
        formSnapshotData.builtFromEventMutationVersion,
    );
    const latestEventDoc = latestEventSnapshot.docs[0];
    const latestEventUpdatedAtMs = toMillis(latestEventDoc?.updateTime);
    const freshnessDecision = decideDerivedMetricsFreshness({
        metricKinds,
        nowMs: Date.now(),
        coordinatorStatus,
        coordinatorCompletedAtMs,
        coordinatorUpdatedAtMs,
        coordinatorEventMutationVersion,
        formSnapshotStatus,
        formSnapshotBuiltFromEventMutationVersion,
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

    return markDerivedMetricsDirtyAndMaybeQueue(uid, metricKinds);
});
