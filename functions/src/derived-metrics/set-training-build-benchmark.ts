import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
    DERIVED_METRIC_KINDS,
    type DerivedTrainingDiscipline,
    type SetTrainingBuildBenchmarkRequest,
    type SetTrainingBuildBenchmarkResponse,
    type TrainingBuildBenchmarkSelection,
} from '../../../shared/derived-metrics';
import { enforceAppCheck } from '../utils';
import { isBenchmarkEventForTrainingMetrics } from '../../../shared/event-classification';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import {
    isRaceTaggedEvent,
    normalizeTrainingBuildBenchmarkSelection,
    resolveTrainingDiscipline,
    markDerivedMetricsDirtyAndMaybeQueue,
} from './derived-metrics.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function resolveUtcDayStartMs(timeMs: number): number {
    const date = new Date(timeMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function toMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.getTime() : null;
    }
    if (typeof (value as { toMillis?: unknown } | null | undefined)?.toMillis === 'function') {
        const result = Number((value as { toMillis: () => unknown }).toMillis());
        return Number.isFinite(result) ? result : null;
    }
    if (typeof (value as { toDate?: unknown } | null | undefined)?.toDate === 'function') {
        return toMillis((value as { toDate: () => unknown }).toDate());
    }
    if (value && typeof value === 'object' && 'seconds' in (value as Record<string, unknown>)) {
        const record = value as Record<string, unknown>;
        const seconds = Number(record.seconds);
        const nanoseconds = Number(record.nanoseconds || 0);
        return Number.isFinite(seconds) && Number.isFinite(nanoseconds)
            ? Math.floor((seconds * 1000) + (nanoseconds / 1_000_000))
            : null;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsedTimeMs = new Date(value).getTime();
        return Number.isFinite(parsedTimeMs) ? parsedTimeMs : null;
    }
    return null;
}

function requireDiscipline(value: unknown): DerivedTrainingDiscipline {
    if (value === 'running' || value === 'cycling') {
        return value;
    }
    throw new HttpsError('invalid-argument', 'discipline must be running or cycling.');
}

export function parseTrainingBuildBenchmarkRequest(value: unknown): SetTrainingBuildBenchmarkRequest {
    const request = asRecord(value);
    const discipline = requireDiscipline(request?.discipline);
    if (request?.selection === null) {
        return { discipline, selection: null };
    }
    const selection = normalizeTrainingBuildBenchmarkSelection(request?.selection);
    if (!selection) {
        throw new HttpsError('invalid-argument', 'selection must be a valid 8, 10, or 12 week race or period benchmark.');
    }
    return { discipline, selection };
}

function currentWindowStartDayMs(selection: TrainingBuildBenchmarkSelection, nowMs: number): number {
    const asOfDayMs = resolveUtcDayStartMs(nowMs);
    return asOfDayMs - (((selection.durationWeeks * 7) - 1) * DAY_MS);
}

async function validateRaceBenchmarkSelection(
    uid: string,
    discipline: DerivedTrainingDiscipline,
    selection: Extract<TrainingBuildBenchmarkSelection, { mode: 'race' }>,
    nowMs: number,
): Promise<void> {
    const eventRef = admin.firestore().doc(`users/${uid}/events/${selection.raceEventId}`);
    const eventSnapshot = await eventRef.get();
    if (!eventSnapshot.exists) {
        throw new HttpsError('not-found', 'The selected race was not found.');
    }
    const eventData = asRecord(eventSnapshot.data()) || {};
    const startMs = toMillis(eventData.startDate);
    if (
        isBenchmarkEventForTrainingMetrics(eventData)
        || !isRaceTaggedEvent(eventData)
        || resolveTrainingDiscipline(eventData) !== discipline
        || startMs === null
    ) {
        throw new HttpsError('failed-precondition', 'The selected event is not an eligible tagged race for this sport.');
    }

    const benchmarkEndDayMs = resolveUtcDayStartMs(startMs) - DAY_MS;
    if (benchmarkEndDayMs >= currentWindowStartDayMs(selection, nowMs)) {
        throw new HttpsError('failed-precondition', 'The selected benchmark must end before the current comparison window.');
    }
}

function validatePeriodBenchmarkSelection(
    selection: Extract<TrainingBuildBenchmarkSelection, { mode: 'period' }>,
    nowMs: number,
): void {
    if (selection.endDayMs >= currentWindowStartDayMs(selection, nowMs)) {
        throw new HttpsError('failed-precondition', 'The selected benchmark must end before the current comparison window.');
    }
}

async function validateBenchmarkSelection(
    uid: string,
    discipline: DerivedTrainingDiscipline,
    selection: TrainingBuildBenchmarkSelection | null,
    nowMs: number,
): Promise<void> {
    if (!selection) {
        return;
    }
    if (selection.mode === 'race') {
        await validateRaceBenchmarkSelection(uid, discipline, selection, nowMs);
        return;
    }
    validatePeriodBenchmarkSelection(selection, nowMs);
}

export const setTrainingBuildBenchmark = onCall({
    region: FUNCTIONS_MANIFEST.setTrainingBuildBenchmark.region,
}, async (request): Promise<SetTrainingBuildBenchmarkResponse> => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    enforceAppCheck(request);

    const { discipline, selection } = parseTrainingBuildBenchmarkRequest(request.data);
    const uid = request.auth.uid;
    const deletionGuard = await getUserDeletionGuardState(admin.firestore(), uid);
    if (deletionGuard.shouldSkip) {
        throw new HttpsError('failed-precondition', 'This account is being deleted or is no longer available.');
    }

    await validateBenchmarkSelection(uid, discipline, selection, Date.now());
    const writeDeletionGuard = await getUserDeletionGuardState(admin.firestore(), uid);
    if (writeDeletionGuard.shouldSkip) {
        throw new HttpsError('failed-precondition', 'This account is being deleted or is no longer available.');
    }
    const settingsRef = admin.firestore().doc(`users/${uid}/config/settings`);
    try {
        await settingsRef.set({
            trainingSettings: {
                buildBenchmarks: {
                    [discipline]: selection === null
                        ? admin.firestore.FieldValue.delete()
                        : selection,
                },
            },
        }, { merge: true });
    } catch (error) {
        throw new HttpsError('internal', 'Could not save this training benchmark.');
    }

    const queueResult = await markDerivedMetricsDirtyAndMaybeQueue(
        uid,
        [DERIVED_METRIC_KINDS.TrainingBuildComparison],
        { incrementEventMutationVersion: false },
    );
    return {
        accepted: queueResult.accepted,
        queued: queueResult.queued,
        generation: queueResult.generation,
    };
});
