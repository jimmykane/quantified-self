import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import {
    DERIVED_METRIC_KINDS,
    normalizeTrainingBuildRaceEventId,
    type DerivedTrainingDiscipline,
    type SetTrainingBuildBenchmarkRequest,
    type SetTrainingBuildBenchmarkResponse,
    type TrainingBuildBenchmarkSelection,
} from '../../../shared/derived-metrics';
import { enforceAppCheck } from '../utils';
import { isBenchmarkEventForTrainingMetrics } from '../../../shared/event-classification';
import { sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { applyEventTagChanges, getEventTags } from '../../../shared/event-tags';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
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
        if (request?.markRaceEventId !== undefined) {
            throw new HttpsError('invalid-argument', 'markRaceEventId requires a selected race benchmark.');
        }
        return { discipline, selection: null };
    }
    const selection = normalizeTrainingBuildBenchmarkSelection(request?.selection);
    if (!selection) {
        throw new HttpsError('invalid-argument', 'selection must be a valid 8, 10, or 12 week race or period benchmark.');
    }
    if (request?.markRaceEventId === undefined) {
        return { discipline, selection };
    }
    const markRaceEventId = normalizeTrainingBuildRaceEventId(request.markRaceEventId);
    if (
        !markRaceEventId
        || selection.mode !== 'race'
        || markRaceEventId !== selection.raceEventId
    ) {
        throw new HttpsError('invalid-argument', 'markRaceEventId must match the selected race event.');
    }
    return { discipline, selection, markRaceEventId };
}

function currentWindowStartDayMs(selection: TrainingBuildBenchmarkSelection, nowMs: number): number {
    const asOfDayMs = resolveUtcDayStartMs(nowMs);
    return asOfDayMs - (((selection.durationWeeks * 7) - 1) * DAY_MS);
}

function validateRaceBenchmarkEvent(
    eventData: Record<string, unknown>,
    discipline: DerivedTrainingDiscipline,
    selection: Extract<TrainingBuildBenchmarkSelection, { mode: 'race' }>,
    nowMs: number,
    allowRaceTagCreation: boolean,
): void {
    const startMs = toMillis(eventData.startDate);
    if (
        isBenchmarkEventForTrainingMetrics(eventData)
        || (!allowRaceTagCreation && !isRaceTaggedEvent(eventData))
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

function validateBenchmarkSelection(
    selection: TrainingBuildBenchmarkSelection | null,
    nowMs: number,
): void {
    if (!selection) {
        return;
    }
    if (selection.mode === 'period') {
        validatePeriodBenchmarkSelection(selection, nowMs);
    }
}

export const setTrainingBuildBenchmark = onCall({
    region: FUNCTIONS_MANIFEST.setTrainingBuildBenchmark.region,
}, async (request): Promise<SetTrainingBuildBenchmarkResponse> => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    enforceAppCheck(request);

    const { discipline, selection, markRaceEventId } = parseTrainingBuildBenchmarkRequest(request.data);
    const uid = request.auth.uid;
    const db = admin.firestore();
    const deletionGuard = await getUserDeletionGuardState(db, uid);
    if (deletionGuard.shouldSkip) {
        throw new HttpsError('failed-precondition', 'This account is being deleted or is no longer available.');
    }

    const nowMs = Date.now();
    validateBenchmarkSelection(selection, nowMs);
    try {
        await db.runTransaction(async (transaction) => {
            const writeDeletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
            if (writeDeletionGuard.shouldSkip) {
                throw new HttpsError('failed-precondition', 'This account is being deleted or is no longer available.');
            }

            if (selection?.mode === 'race') {
                const eventRef = db.doc(`users/${uid}/events/${selection.raceEventId}`);
                const eventSnapshot = await transaction.get(eventRef);
                if (!eventSnapshot.exists) {
                    throw new HttpsError('not-found', 'The selected race was not found.');
                }
                const eventData = asRecord(eventSnapshot.data()) || {};
                validateRaceBenchmarkEvent(eventData, discipline, selection, nowMs, !!markRaceEventId);
                if (markRaceEventId) {
                    let tags: string[];
                    try {
                        tags = applyEventTagChanges(getEventTags(eventData), { add: ['Race'], remove: [] });
                    } catch {
                        throw new HttpsError('failed-precondition', 'The selected event already has the maximum number of tags.');
                    }
                    transaction.update(eventRef, sanitizeEventFirestoreWritePayload({
                        tags,
                        benchmarkReviewTags: admin.firestore.FieldValue.delete(),
                    }));
                }
            }

            const settingsRef = db.doc(`users/${uid}/config/settings`);
            transaction.set(settingsRef, {
                trainingSettings: {
                    buildBenchmarks: {
                        [discipline]: selection === null
                            ? admin.firestore.FieldValue.delete()
                            : selection,
                    },
                },
            }, { merge: true });
        });
    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }
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
