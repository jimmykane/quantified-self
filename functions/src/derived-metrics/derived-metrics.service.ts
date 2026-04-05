import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { DataDuration, DataRecoveryTime } from '@sports-alliance/sports-lib';
import {
    DERIVED_METRIC_KINDS,
    DERIVED_METRICS_COLLECTION_ID,
    DERIVED_METRICS_COORDINATOR_DOC_ID,
    DERIVED_METRICS_ENTRY_TYPES,
    DEFAULT_DERIVED_METRIC_KINDS,
    type DerivedFormMetricPayload,
    type DerivedMetricKind,
    type DerivedMetricsCoordinator,
    type DerivedRecoveryNowMetricPayload,
    getDerivedMetricDocId,
    normalizeDerivedMetricKinds,
    normalizeDerivedMetricKindsStrict,
    type EnsureDerivedMetricsResponse,
} from '../../../shared/derived-metrics';
import { enqueueDerivedMetricsTask } from '../shared/cloud-tasks';
import { getDerivedMetricsUidAllowlist, isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';

const FORM_STAT_TYPE = 'Training Stress Score';
const LEGACY_FORM_STAT_TYPE = 'Power Training Stress Score';
const DERIVED_METRIC_SCHEMA_VERSION = 1;

type FirestoreQueryDocumentSnapshot = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

interface DerivedMetricBuildResult<TPayload> {
    sourceEventCount: number;
    payload: TPayload;
}

export interface StartDerivedMetricsProcessingResult {
    dirtyMetricKinds: DerivedMetricKind[];
    startedAtMs: number;
}

export interface CompleteDerivedMetricsProcessingResult {
    requeued: boolean;
    nextGeneration: number | null;
    dirtyMetricKinds: DerivedMetricKind[];
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

function toFinitePositiveNumber(value: unknown): number | null {
    const numericValue = toFiniteNumber(value);
    if (numericValue === null || numericValue <= 0) {
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
        return toMillis(date);
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
        const parsedDate = new Date(value);
        const parsedTime = parsedDate.getTime();
        return Number.isFinite(parsedTime) ? parsedTime : null;
    }
    return null;
}

function resolveUtcDayStartMs(timeMs: number): number {
    const date = new Date(timeMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseCoordinator(data: unknown): DerivedMetricsCoordinator {
    const normalizedData = (data && typeof data === 'object') ? data as Record<string, unknown> : {};
    const status = toSafeString(normalizedData.status) as DerivedMetricsCoordinator['status'];
    const generationRaw = toFiniteNumber(normalizedData.generation);
    const requestedAtMs = toFiniteNumber(normalizedData.requestedAtMs);
    const startedAtMs = toFiniteNumber(normalizedData.startedAtMs);
    const completedAtMs = toFiniteNumber(normalizedData.completedAtMs);
    const updatedAtMs = toFiniteNumber(normalizedData.updatedAtMs);
    const dirtyMetricKinds = normalizeDerivedMetricKindsStrict(normalizedData.dirtyMetricKinds as unknown[]);

    return {
        entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
        status: status === 'queued' || status === 'processing' || status === 'failed' ? status : 'idle',
        generation: generationRaw === null ? 0 : Math.max(0, Math.floor(generationRaw)),
        dirtyMetricKinds,
        requestedAtMs,
        startedAtMs,
        completedAtMs,
        updatedAtMs: updatedAtMs === null ? 0 : Math.max(0, Math.floor(updatedAtMs)),
        lastError: toSafeString(normalizedData.lastError) || null,
    };
}

function mergeDerivedMetricKinds(
    existingMetricKinds: readonly DerivedMetricKind[],
    metricKindsToMerge: readonly DerivedMetricKind[],
): DerivedMetricKind[] {
    return Array.from(new Set([...existingMetricKinds, ...metricKindsToMerge]));
}

function hasSameDerivedMetricKinds(
    leftMetricKinds: readonly DerivedMetricKind[],
    rightMetricKinds: readonly DerivedMetricKind[],
): boolean {
    if (leftMetricKinds.length !== rightMetricKinds.length) {
        return false;
    }

    const leftSet = new Set(leftMetricKinds);
    if (leftSet.size !== rightMetricKinds.length) {
        return false;
    }

    return rightMetricKinds.every((metricKind) => leftSet.has(metricKind));
}

function isMergedEvent(eventData: Record<string, unknown>): boolean {
    if (eventData.isMerge === true) {
        return true;
    }

    const mergeType = toSafeString(eventData.mergeType).trim();
    if (mergeType.length > 0) {
        return true;
    }

    const originalFiles = eventData.originalFiles;
    if (Array.isArray(originalFiles) && originalFiles.length > 1) {
        return true;
    }

    return false;
}

function resolveRawStats(eventData: Record<string, unknown>): Record<string, unknown> {
    const stats = eventData.stats;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
        return {};
    }
    return stats as Record<string, unknown>;
}

function resolveRawStatNumericValue(
    eventData: Record<string, unknown>,
    statType: string,
): number | null {
    const stats = resolveRawStats(eventData);
    if (!Object.prototype.hasOwnProperty.call(stats, statType)) {
        return null;
    }

    const rawStat = stats[statType];
    const directValue = toFiniteNumber(rawStat);
    if (directValue !== null) {
        return directValue;
    }

    if (!rawStat || typeof rawStat !== 'object' || Array.isArray(rawStat)) {
        return null;
    }

    const statObject = rawStat as Record<string, unknown>;
    return toFiniteNumber(statObject.value)
        ?? toFiniteNumber(statObject.rawValue)
        ?? toFiniteNumber(statObject._value)
        ?? null;
}

function resolveTrainingStressScore(eventData: Record<string, unknown>): number | null {
    const preferred = resolveRawStatNumericValue(eventData, FORM_STAT_TYPE);
    if (preferred !== null && preferred >= 0) {
        return preferred;
    }

    const legacy = resolveRawStatNumericValue(eventData, LEGACY_FORM_STAT_TYPE);
    if (legacy !== null && legacy >= 0) {
        return legacy;
    }

    return null;
}

function resolveRecoveryEventEndTimeMs(eventData: Record<string, unknown>): number | null {
    const endTimeMs = toMillis(eventData.endDate);
    if (endTimeMs !== null) {
        return endTimeMs;
    }

    const startTimeMs = toMillis(eventData.startDate);
    if (startTimeMs === null) {
        return null;
    }

    const durationSeconds = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataDuration.type));
    if (durationSeconds === null) {
        return null;
    }

    return startTimeMs + (durationSeconds * 1000);
}

function buildFormMetricPayload(
    docs: readonly FirestoreQueryDocumentSnapshot[],
): DerivedMetricBuildResult<DerivedFormMetricPayload> {
    const dailyLoadsByUtcDay = new Map<number, number>();
    let sourceEventCount = 0;

    docs.forEach((doc) => {
        const eventData = (doc.data() || {}) as Record<string, unknown>;
        if (isMergedEvent(eventData)) {
            return;
        }

        const startTimeMs = toMillis(eventData.startDate);
        if (startTimeMs === null) {
            return;
        }

        const stressScore = resolveTrainingStressScore(eventData);
        if (stressScore === null || stressScore < 0) {
            return;
        }

        const dayMs = resolveUtcDayStartMs(startTimeMs);
        dailyLoadsByUtcDay.set(dayMs, (dailyLoadsByUtcDay.get(dayMs) || 0) + stressScore);
        sourceEventCount += 1;
    });

    const sortedDailyLoads = [...dailyLoadsByUtcDay.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([dayMs, load]) => [dayMs, load] as [number, number]);

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            rangeStartDayMs: sortedDailyLoads.length ? sortedDailyLoads[0][0] : null,
            rangeEndDayMs: sortedDailyLoads.length ? sortedDailyLoads[sortedDailyLoads.length - 1][0] : null,
            dailyLoads: sortedDailyLoads,
            excludesMergedEvents: true,
        },
    };
}

function buildRecoveryNowMetricPayload(
    docs: readonly FirestoreQueryDocumentSnapshot[],
): DerivedMetricBuildResult<DerivedRecoveryNowMetricPayload> {
    const segments: Array<{ totalSeconds: number; endTimeMs: number }> = [];
    let totalSeconds = 0;
    let latestEndTimeMs = Number.NEGATIVE_INFINITY;

    docs.forEach((doc) => {
        const eventData = (doc.data() || {}) as Record<string, unknown>;
        if (isMergedEvent(eventData)) {
            return;
        }

        const recoverySeconds = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataRecoveryTime.type));
        if (recoverySeconds === null) {
            return;
        }

        const endTimeMs = resolveRecoveryEventEndTimeMs(eventData);
        if (endTimeMs === null) {
            return;
        }

        totalSeconds += recoverySeconds;
        latestEndTimeMs = Math.max(latestEndTimeMs, endTimeMs);
        segments.push({
            totalSeconds: recoverySeconds,
            endTimeMs,
        });
    });

    return {
        sourceEventCount: segments.length,
        payload: {
            totalSeconds,
            endTimeMs: Number.isFinite(latestEndTimeMs) ? latestEndTimeMs : 0,
            segments,
            excludesMergedEvents: true,
        },
    };
}

function getCoordinatorDocRef(uid: string): FirebaseFirestore.DocumentReference {
    return admin.firestore().doc(`users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${DERIVED_METRICS_COORDINATOR_DOC_ID}`);
}

function getMetricDocRef(uid: string, metricKind: DerivedMetricKind): FirebaseFirestore.DocumentReference {
    return admin.firestore().doc(`users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(metricKind)}`);
}

async function queueDerivedMetricsTask(uid: string, generation: number): Promise<boolean> {
    const queued = await enqueueDerivedMetricsTask(uid, generation);
    return queued;
}

export async function fetchDerivedMetricsEventDocs(uid: string): Promise<FirestoreQueryDocumentSnapshot[]> {
    const snapshot = await admin.firestore()
        .collection('users')
        .doc(uid)
        .collection('events')
        .select('startDate', 'endDate', 'stats', 'isMerge', 'mergeType', 'originalFiles')
        .get();
    return snapshot.docs;
}

export async function markDerivedMetricsDirtyAndMaybeQueue(
    uid: string,
    requestedMetricKinds: readonly unknown[] | null | undefined,
): Promise<EnsureDerivedMetricsResponse> {
    const metricKinds = normalizeDerivedMetricKinds(requestedMetricKinds);
    if (!isDerivedMetricsUidAllowed(uid)) {
        logger.info('[derived-metrics] Skipping dirty-mark enqueue due to UID allowlist gate.', {
            uid,
            allowlistSize: getDerivedMetricsUidAllowlist().size,
        });
        return {
            accepted: false,
            queued: false,
            generation: null,
            metricKinds,
        };
    }

    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();

    let shouldEnqueue = false;
    let generationToQueue: number | null = null;

    await admin.firestore().runTransaction(async (transaction) => {
        const coordinatorSnapshot = await transaction.get(coordinatorRef);
        const coordinator = parseCoordinator(coordinatorSnapshot.data());
        const nextDirtyMetricKinds = mergeDerivedMetricKinds(coordinator.dirtyMetricKinds, metricKinds);
        const isAlreadyQueuedOrProcessing = coordinator.status === 'queued' || coordinator.status === 'processing';
        const dirtyMetricKindsChanged = !hasSameDerivedMetricKinds(coordinator.dirtyMetricKinds, nextDirtyMetricKinds);

        // Coalesce repeated writes during bulk updates:
        // if a user is already queued/processing and the dirty set did not change,
        // avoid writing the coordinator doc again.
        if (isAlreadyQueuedOrProcessing && !dirtyMetricKindsChanged) {
            shouldEnqueue = false;
            generationToQueue = coordinator.generation;
            return;
        }

        const nextGeneration = isAlreadyQueuedOrProcessing ? coordinator.generation : coordinator.generation + 1;

        shouldEnqueue = !isAlreadyQueuedOrProcessing;
        generationToQueue = nextGeneration;

        transaction.set(coordinatorRef, {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
            status: isAlreadyQueuedOrProcessing ? coordinator.status : 'queued',
            generation: nextGeneration,
            dirtyMetricKinds: nextDirtyMetricKinds,
            requestedAtMs: nowMs,
            updatedAtMs: nowMs,
            ...(isAlreadyQueuedOrProcessing ? {} : {
                startedAtMs: null,
                completedAtMs: null,
                lastError: null,
            }),
        }, { merge: true });
    });

    if (shouldEnqueue && generationToQueue !== null) {
        try {
            await queueDerivedMetricsTask(uid, generationToQueue);
        } catch (error) {
            logger.error('[derived-metrics] Failed to enqueue derived metrics task', {
                uid,
                generation: generationToQueue,
                error,
            });
            await coordinatorRef.set({
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'failed',
                lastError: toSafeString((error as { message?: unknown } | null)?.message) || 'enqueue_failed',
                updatedAtMs: Date.now(),
            }, { merge: true });

            return {
                accepted: false,
                queued: false,
                generation: generationToQueue,
                metricKinds,
            };
        }
    }

    return {
        accepted: true,
        queued: shouldEnqueue,
        generation: generationToQueue,
        metricKinds,
    };
}

export async function startDerivedMetricsProcessing(
    uid: string,
    generation: number,
): Promise<StartDerivedMetricsProcessingResult | null> {
    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();
    let startedResult: StartDerivedMetricsProcessingResult | null = null;

    await admin.firestore().runTransaction(async (transaction) => {
        const coordinatorSnapshot = await transaction.get(coordinatorRef);
        if (!coordinatorSnapshot.exists) {
            startedResult = null;
            return;
        }

        const coordinator = parseCoordinator(coordinatorSnapshot.data());
        if (coordinator.generation !== generation) {
            startedResult = null;
            return;
        }

        // A generation can only be claimed from the queued state.
        // Duplicate deliveries while already processing should be a no-op.
        if (coordinator.status !== 'queued') {
            startedResult = null;
            return;
        }

        const dirtyMetricKinds = normalizeDerivedMetricKindsStrict(coordinator.dirtyMetricKinds);
        if (!dirtyMetricKinds.length) {
            transaction.set(coordinatorRef, {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'idle',
                updatedAtMs: nowMs,
                completedAtMs: nowMs,
                lastError: null,
            }, { merge: true });
            startedResult = null;
            return;
        }

        transaction.set(coordinatorRef, {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
            status: 'processing',
            dirtyMetricKinds: [],
            startedAtMs: nowMs,
            updatedAtMs: nowMs,
            lastError: null,
        }, { merge: true });

        startedResult = {
            dirtyMetricKinds,
            startedAtMs: nowMs,
        };
    });

    return startedResult;
}

export async function completeDerivedMetricsProcessing(
    uid: string,
    generation: number,
): Promise<CompleteDerivedMetricsProcessingResult> {
    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();
    let completion: CompleteDerivedMetricsProcessingResult = {
        requeued: false,
        nextGeneration: null,
        dirtyMetricKinds: [],
    };

    await admin.firestore().runTransaction(async (transaction) => {
        const coordinatorSnapshot = await transaction.get(coordinatorRef);
        if (!coordinatorSnapshot.exists) {
            return;
        }

        const coordinator = parseCoordinator(coordinatorSnapshot.data());
        if (coordinator.generation !== generation) {
            return;
        }

        const pendingDirtyMetricKinds = normalizeDerivedMetricKindsStrict(coordinator.dirtyMetricKinds);
        if (pendingDirtyMetricKinds.length) {
            const nextGeneration = coordinator.generation + 1;
            transaction.set(coordinatorRef, {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'queued',
                generation: nextGeneration,
                dirtyMetricKinds: pendingDirtyMetricKinds,
                requestedAtMs: nowMs,
                updatedAtMs: nowMs,
                completedAtMs: null,
            }, { merge: true });
            completion = {
                requeued: true,
                nextGeneration,
                dirtyMetricKinds: pendingDirtyMetricKinds,
            };
            return;
        }

        transaction.set(coordinatorRef, {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
            status: 'idle',
            dirtyMetricKinds: [],
            updatedAtMs: nowMs,
            completedAtMs: nowMs,
            lastError: null,
        }, { merge: true });
        completion = {
            requeued: false,
            nextGeneration: null,
            dirtyMetricKinds: [],
        };
    });

    if (completion.requeued && completion.nextGeneration !== null) {
        try {
            await queueDerivedMetricsTask(uid, completion.nextGeneration);
        } catch (error) {
            logger.error('[derived-metrics] Failed to enqueue follow-up derived metrics task', {
                uid,
                generation,
                nextGeneration: completion.nextGeneration,
                error,
            });
            await coordinatorRef.set({
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'failed',
                lastError: toSafeString((error as { message?: unknown } | null)?.message) || 'enqueue_follow_up_failed',
                updatedAtMs: Date.now(),
            }, { merge: true });
        }
    }

    return completion;
}

export async function failDerivedMetricsProcessing(
    uid: string,
    generation: number,
    error: unknown,
    processedMetricKinds: readonly DerivedMetricKind[],
): Promise<void> {
    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();
    const errorMessage = toSafeString((error as { message?: unknown } | null)?.message) || toSafeString(error) || 'unknown_error';

    await admin.firestore().runTransaction(async (transaction) => {
        const coordinatorSnapshot = await transaction.get(coordinatorRef);
        if (!coordinatorSnapshot.exists) {
            return;
        }

        const coordinator = parseCoordinator(coordinatorSnapshot.data());
        if (coordinator.generation !== generation) {
            return;
        }

        const retainedDirtyMetricKinds = mergeDerivedMetricKinds(
            normalizeDerivedMetricKindsStrict(coordinator.dirtyMetricKinds),
            normalizeDerivedMetricKindsStrict(processedMetricKinds),
        );
        transaction.set(coordinatorRef, {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
            status: 'failed',
            dirtyMetricKinds: retainedDirtyMetricKinds,
            lastError: errorMessage,
            updatedAtMs: nowMs,
        }, { merge: true });
    });
}

export async function markDerivedMetricSnapshotsBuilding(
    uid: string,
    metricKinds: readonly DerivedMetricKind[],
): Promise<void> {
    const nowMs = Date.now();
    const batch = admin.firestore().batch();
    metricKinds.forEach((metricKind) => {
        batch.set(getMetricDocRef(uid, metricKind), {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
            metricKind,
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            status: 'building',
            updatedAtMs: nowMs,
            lastError: null,
        }, { merge: true });
    });
    await batch.commit();
}

export async function markDerivedMetricSnapshotsFailed(
    uid: string,
    metricKinds: readonly DerivedMetricKind[],
    error: unknown,
): Promise<void> {
    const nowMs = Date.now();
    const errorMessage = toSafeString((error as { message?: unknown } | null)?.message) || toSafeString(error) || 'unknown_error';
    const batch = admin.firestore().batch();
    metricKinds.forEach((metricKind) => {
        batch.set(getMetricDocRef(uid, metricKind), {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
            metricKind,
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            status: 'failed',
            updatedAtMs: nowMs,
            lastError: errorMessage,
        }, { merge: true });
    });
    await batch.commit();
}

export async function writeDerivedMetricSnapshotsReady(
    uid: string,
    metricKinds: readonly DerivedMetricKind[],
    docs: readonly FirestoreQueryDocumentSnapshot[],
): Promise<void> {
    const nowMs = Date.now();
    const batch = admin.firestore().batch();

    metricKinds.forEach((metricKind) => {
        if (metricKind === DERIVED_METRIC_KINDS.Form) {
            const buildResult = buildFormMetricPayload(docs);
            batch.set(getMetricDocRef(uid, metricKind), {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
                metricKind,
                schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
                status: 'ready',
                updatedAtMs: nowMs,
                sourceEventCount: buildResult.sourceEventCount,
                payload: buildResult.payload,
                lastError: null,
            }, { merge: true });
            return;
        }

        if (metricKind === DERIVED_METRIC_KINDS.RecoveryNow) {
            const buildResult = buildRecoveryNowMetricPayload(docs);
            batch.set(getMetricDocRef(uid, metricKind), {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
                metricKind,
                schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
                status: 'ready',
                updatedAtMs: nowMs,
                sourceEventCount: buildResult.sourceEventCount,
                payload: buildResult.payload,
                lastError: null,
            }, { merge: true });
        }
    });

    await batch.commit();
}

export function getDefaultDerivedMetricKindsForDashboard(): DerivedMetricKind[] {
    return [...DEFAULT_DERIVED_METRIC_KINDS];
}
