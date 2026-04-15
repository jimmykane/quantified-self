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
    formSnapshotStatus: string | null;
    formSnapshotSourceDocCount: number | null;
    formRangeEndDayMs: number | null;
    latestEventStartDayMs: number | null;
    latestEventUpdatedAtMs: number | null;
    latestEventCount: number | null;
}

interface DerivedMetricsFreshnessDecision {
    shouldQueue: boolean;
    reason:
    | 'failed_status'
    | 'queued_stuck'
    | 'processing_stuck'
    | 'requested_metric_without_form'
    | 'no_form_freshness_signal'
    | 'missing_event_count'
    | 'missing_form_snapshot'
    | 'missing_source_doc_count'
    | 'missing_completed_at'
    | 'event_count_mismatch'
    | 'latest_event_beyond_form_range'
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
        const dateMs = value.getTime();
        return Number.isFinite(dateMs) ? dateMs : null;
    }
    if (typeof (value as { toMillis?: unknown } | null | undefined)?.toMillis === 'function') {
        const millis = Number((value as { toMillis: () => unknown }).toMillis());
        return Number.isFinite(millis) ? millis : null;
    }
    if (typeof (value as { toDate?: unknown } | null | undefined)?.toDate === 'function') {
        return toMillis((value as { toDate: () => Date }).toDate());
    }
    if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
        const seconds = Number((value as Record<string, unknown>).seconds);
        const nanos = Number((value as Record<string, unknown>).nanoseconds || 0);
        if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
            return null;
        }
        return Math.floor((seconds * 1000) + (nanos / 1_000_000));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function toUtcDayStartMs(value: number): number {
    const date = new Date(value);
    return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
    );
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

    if (!Number.isFinite(input.latestEventCount)) {
        return { shouldQueue: true, reason: 'missing_event_count' };
    }
    const latestEventCount = Math.max(0, Math.floor(input.latestEventCount as number));

    if (latestEventCount <= 0) {
        if (input.formSnapshotStatus !== 'ready') {
            return { shouldQueue: true, reason: 'missing_form_snapshot' };
        }
        if (!Number.isFinite(input.formSnapshotSourceDocCount)) {
            return { shouldQueue: true, reason: 'missing_source_doc_count' };
        }
        if ((input.formSnapshotSourceDocCount ?? -1) !== 0) {
            return { shouldQueue: true, reason: 'event_count_mismatch' };
        }
        if (!Number.isFinite(input.coordinatorCompletedAtMs)) {
            return { shouldQueue: true, reason: 'missing_completed_at' };
        }
        return { shouldQueue: false, reason: 'fresh' };
    }

    if (input.formSnapshotStatus !== 'ready') {
        return { shouldQueue: true, reason: 'missing_form_snapshot' };
    }
    if (!Number.isFinite(input.coordinatorCompletedAtMs)) {
        return { shouldQueue: true, reason: 'missing_completed_at' };
    }
    if (!Number.isFinite(input.formSnapshotSourceDocCount)) {
        return { shouldQueue: true, reason: 'missing_source_doc_count' };
    }
    if ((input.formSnapshotSourceDocCount ?? -1) !== latestEventCount) {
        return { shouldQueue: true, reason: 'event_count_mismatch' };
    }
    if (Number.isFinite(input.latestEventStartDayMs) && Number.isFinite(input.formRangeEndDayMs)
        && (input.latestEventStartDayMs as number) > (input.formRangeEndDayMs as number)) {
        return { shouldQueue: true, reason: 'latest_event_beyond_form_range' };
    }
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
        eventCountSnapshot,
        latestEventSnapshot,
    ] = await Promise.all([
        coordinatorRef.get(),
        formSnapshotRef.get(),
        eventsCollectionRef.count().get(),
        eventsCollectionRef.orderBy('startDate', 'desc').limit(1).select('startDate').get(),
    ]);

    const coordinatorData = coordinatorSnapshot.data() || {};
    const coordinatorStatus = parseCoordinatorStatus(coordinatorData.status);
    const coordinatorCompletedAtMs = toFiniteNumber(coordinatorData.completedAtMs);
    const coordinatorUpdatedAtMs = toFiniteNumber(coordinatorData.updatedAtMs);
    const coordinatorGeneration = toFiniteNumber(coordinatorData.generation);

    const formSnapshotData = formSnapshot.data() || {};
    const formSnapshotStatus = toSafeString(formSnapshotData.status) || null;
    const formSnapshotSourceDocCount = toFiniteNumber(formSnapshotData.sourceDocCount);
    const formRangeEndDayMs = toFiniteNumber(
        ((formSnapshotData.payload as Record<string, unknown> | undefined)?.rangeEndDayMs) || null,
    );

    const latestEventDoc = latestEventSnapshot.docs[0];
    const latestEventData = latestEventDoc?.data() || {};
    const latestEventStartDateMs = toMillis(latestEventData.startDate);
    const latestEventStartDayMs = Number.isFinite(latestEventStartDateMs)
        ? toUtcDayStartMs(latestEventStartDateMs as number)
        : null;
    const latestEventUpdatedAtMs = toMillis(latestEventDoc?.updateTime);
    const latestEventCount = toFiniteNumber(eventCountSnapshot.data().count);
    const freshnessDecision = decideDerivedMetricsFreshness({
        metricKinds,
        nowMs: Date.now(),
        coordinatorStatus,
        coordinatorCompletedAtMs,
        coordinatorUpdatedAtMs,
        formSnapshotStatus,
        formSnapshotSourceDocCount,
        formRangeEndDayMs,
        latestEventStartDayMs,
        latestEventUpdatedAtMs,
        latestEventCount,
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
