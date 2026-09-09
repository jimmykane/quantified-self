import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
    SCHEDULED_WORKOUTS_COLLECTION_ID,
    TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID,
    TRAINING_PLAN_REVISIONS_COLLECTION_ID,
    TRAINING_PLAN_SCHEMA_VERSION,
    TRAINING_PLANS_COLLECTION_ID,
    TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID,
    parseScheduledWorkoutV1,
    parseTrainingPlanStateV1,
    parseTrainingPlanV1,
    type MutateTrainingScheduleRequestV1,
    type MutateTrainingScheduleResponseV1,
    type ScheduledWorkoutV1,
    type TrainingPlanV1,
} from '../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import {
    TrainingScheduleMutationError,
    applyTrainingScheduleMutation,
    createEmptyTrainingPlanState,
    type AppliedTrainingScheduleMutationV1,
    type TrainingScheduleSnapshotV1,
} from './mutation';
import { assertNoTrainingPlanDeletionInProgress } from './deletion-lock';

const MUTATION_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FIRESTORE_TRANSACTION_WRITE_BUDGET = 490;

export const TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID = 'chunks';
export const TRAINING_PLAN_REVISION_CHUNK_ENCODING = 'gzip-json-base64-v1' as const;
export const TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS = 700_000;
export const TRAINING_PLAN_REVISION_MAX_CHUNKS = 100;

export interface TrainingPlanWorkoutDeltaV1 {
    workoutId: string;
    before: ScheduledWorkoutV1 | null;
    after: ScheduledWorkoutV1 | null;
}

export interface TrainingPlanRevisionDocumentV1 {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    revision: number;
    mutationId: string;
    operationKind: string;
    createdAtMs: number;
    checkpointRevision: number;
    delta: {
        planBefore: TrainingPlanV1 | null;
        planAfter: TrainingPlanV1;
        workoutCount: number;
        workoutChunkCount: number;
        workoutEncoding: typeof TRAINING_PLAN_REVISION_CHUNK_ENCODING;
    };
    checkpoint?: {
        plan: TrainingPlanV1;
        workoutCount: number;
        workoutChunkCount: number;
        workoutEncoding: typeof TRAINING_PLAN_REVISION_CHUNK_ENCODING;
    };
}

export type TrainingPlanRevisionChunkKindV1 = 'delta-workouts' | 'checkpoint-workouts';

export interface TrainingPlanRevisionChunkDocumentV1 {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    revision: number;
    kind: TrainingPlanRevisionChunkKindV1;
    chunkIndex: number;
    chunkCount: number;
    encoding: typeof TRAINING_PLAN_REVISION_CHUNK_ENCODING;
    payloadBase64: string;
}

export interface StandaloneWorkoutRevisionDocumentV1 {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    revision: number;
    mutationId: string;
    operationKind: string;
    createdAtMs: number;
    snapshot: ScheduledWorkoutV1;
}

export type TrainingScheduleDeletionTombstoneKindV1 = 'plan' | 'workout';

export interface TrainingScheduleDeletionTombstoneV1 {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    entityKind: TrainingScheduleDeletionTombstoneKindV1;
    entityIdHash: string;
    mutationId: string;
    createdAtMs: number;
}

export interface TrainingScheduleRevisionWritesV1 {
    planRevisions: Map<string, TrainingPlanRevisionDocumentV1>;
    planRevisionChunks: Map<string, TrainingPlanRevisionChunkDocumentV1[]>;
    standaloneWorkoutRevisions: Map<string, StandaloneWorkoutRevisionDocumentV1>;
}

interface StoredMutationReceiptV1 {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    requestHash: string;
    response: MutateTrainingScheduleResponseV1;
    createdAtMs: number;
    expireAt: Timestamp;
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function hashTrainingScheduleRequestPayload(request: unknown): string {
    return createHash('sha256').update(stableJson(request)).digest('hex');
}

export function hashTrainingScheduleMutationRequest(request: MutateTrainingScheduleRequestV1): string {
    return hashTrainingScheduleRequestPayload(request);
}

export function trainingScheduleDeletionTombstoneDocumentId(
    entityKind: TrainingScheduleDeletionTombstoneKindV1,
    entityId: string,
): string {
    return createHash('sha256').update(`${entityKind}:${entityId}`).digest('hex');
}

export function buildTrainingScheduleDeletionTombstone(
    entityKind: TrainingScheduleDeletionTombstoneKindV1,
    entityId: string,
    mutationId: string,
    createdAtMs: number,
): TrainingScheduleDeletionTombstoneV1 {
    return {
        schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
        entityKind,
        entityIdHash: trainingScheduleDeletionTombstoneDocumentId(entityKind, entityId),
        mutationId,
        createdAtMs,
    };
}

function cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function valuesEqual(left: unknown, right: unknown): boolean {
    return stableJson(left) === stableJson(right);
}

function workoutsForPlan(snapshot: TrainingScheduleSnapshotV1, planId: string): ScheduledWorkoutV1[] {
    return [...snapshot.workouts.values()]
        .filter(workout => workout.planId === planId && workout.lifecycle !== 'deleted')
        .map(cloneValue)
        .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.id.localeCompare(right.id));
}

function encodeRevisionChunks(
    revision: number,
    kind: TrainingPlanRevisionChunkKindV1,
    value: readonly unknown[],
): TrainingPlanRevisionChunkDocumentV1[] {
    if (value.length === 0) return [];
    const payloadBase64 = gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
    const chunkCount = Math.ceil(payloadBase64.length / TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS);
    if (chunkCount > TRAINING_PLAN_REVISION_MAX_CHUNKS) {
        throw new TrainingScheduleMutationError(
            'limit-exceeded',
            'This plan snapshot is too large to store as bounded revision history.',
        );
    }
    return Array.from({ length: chunkCount }, (_, chunkIndex) => ({
        schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
        revision,
        kind,
        chunkIndex,
        chunkCount,
        encoding: TRAINING_PLAN_REVISION_CHUNK_ENCODING,
        payloadBase64: payloadBase64.slice(
            chunkIndex * TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS,
            (chunkIndex + 1) * TRAINING_PLAN_REVISION_CHUNK_MAX_BASE64_CHARACTERS,
        ),
    }));
}

export function trainingPlanRevisionChunkDocumentId(
    kind: TrainingPlanRevisionChunkKindV1,
    chunkIndex: number,
): string {
    return `${kind}-${`${chunkIndex}`.padStart(4, '0')}`;
}

export function buildTrainingScheduleRevisionWrites(
    applied: AppliedTrainingScheduleMutationV1,
    request: { mutationId: string; operation: { kind: string } },
    nowMs: number,
): TrainingScheduleRevisionWritesV1 {
    const planRevisions = new Map<string, TrainingPlanRevisionDocumentV1>();
    const planRevisionChunks = new Map<string, TrainingPlanRevisionChunkDocumentV1[]>();
    const standaloneWorkoutRevisions = new Map<string, StandaloneWorkoutRevisionDocumentV1>();

    for (const planId of applied.affectedPlanIds) {
        const beforePlan = applied.before.plans.get(planId) ?? null;
        const afterPlan = applied.after.plans.get(planId);
        if (!afterPlan) continue;
        const workoutIds = new Set<string>();
        for (const workoutId of applied.changedWorkoutIds) {
            const beforeWorkout = applied.before.workouts.get(workoutId);
            const afterWorkout = applied.after.workouts.get(workoutId);
            if (beforeWorkout?.planId === planId || afterWorkout?.planId === planId) workoutIds.add(workoutId);
        }
        const workoutDeltas = [...workoutIds]
            .map(workoutId => ({
                workoutId,
                before: cloneValue(applied.before.workouts.get(workoutId) ?? null),
                after: cloneValue(applied.after.workouts.get(workoutId) ?? null),
            }))
            .filter(delta => !valuesEqual(delta.before, delta.after))
            .sort((left, right) => left.workoutId.localeCompare(right.workoutId));
        const isCheckpoint = afterPlan.lastCheckpointRevision === afterPlan.revision;
        const deltaChunks = encodeRevisionChunks(afterPlan.revision, 'delta-workouts', workoutDeltas);
        const checkpointWorkouts = isCheckpoint ? workoutsForPlan(applied.after, planId) : [];
        const checkpointChunks = encodeRevisionChunks(
            afterPlan.revision,
            'checkpoint-workouts',
            checkpointWorkouts,
        );
        const revision: TrainingPlanRevisionDocumentV1 = {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            revision: afterPlan.revision,
            mutationId: request.mutationId,
            operationKind: request.operation.kind,
            createdAtMs: nowMs,
            checkpointRevision: afterPlan.lastCheckpointRevision,
            delta: {
                planBefore: cloneValue(beforePlan),
                planAfter: cloneValue(afterPlan),
                workoutCount: workoutDeltas.length,
                workoutChunkCount: deltaChunks.length,
                workoutEncoding: TRAINING_PLAN_REVISION_CHUNK_ENCODING,
            },
        };
        planRevisions.set(planId, isCheckpoint ? {
            ...revision,
            checkpoint: {
                plan: cloneValue(afterPlan),
                workoutCount: checkpointWorkouts.length,
                workoutChunkCount: checkpointChunks.length,
                workoutEncoding: TRAINING_PLAN_REVISION_CHUNK_ENCODING,
            },
        } : revision);
        planRevisionChunks.set(planId, [...deltaChunks, ...checkpointChunks]);
    }

    for (const workoutId of applied.changedWorkoutIds) {
        const beforeWorkout = applied.before.workouts.get(workoutId);
        const afterWorkout = applied.after.workouts.get(workoutId);
        if (!afterWorkout) continue;
        if (beforeWorkout?.planId !== null && afterWorkout.planId !== null) continue;
        standaloneWorkoutRevisions.set(workoutId, {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            revision: afterWorkout.revision,
            mutationId: request.mutationId,
            operationKind: request.operation.kind,
            createdAtMs: nowMs,
            snapshot: cloneValue(afterWorkout),
        });
    }

    const estimatedWriteCount = 2
        + applied.affectedPlanIds.length * 2
        + applied.changedWorkoutIds.length
        + applied.permanentlyDeletedWorkoutIds.length * 2
        + standaloneWorkoutRevisions.size
        + [...planRevisionChunks.values()].reduce((total, chunks) => total + chunks.length, 0);
    if (estimatedWriteCount > FIRESTORE_TRANSACTION_WRITE_BUDGET) {
        throw new TrainingScheduleMutationError(
            'limit-exceeded',
            'This change produces too much revision history for one atomic operation. Split it into smaller changes.',
        );
    }

    return { planRevisions, planRevisionChunks, standaloneWorkoutRevisions };
}

function parseStoredMutationResponse(value: unknown): MutateTrainingScheduleResponseV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mutation receipt response.');
    const record = value as Record<string, unknown>;
    if (typeof record.mutationId !== 'string' || !Array.isArray(record.plans) || !Array.isArray(record.workouts)) {
        throw new Error('Invalid mutation receipt response.');
    }
    if (!Array.isArray(record.removedPlanIds) || !Array.isArray(record.permanentlyDeletedWorkoutIds)) {
        throw new Error('Invalid mutation receipt response.');
    }
    return {
        mutationId: record.mutationId,
        state: parseTrainingPlanStateV1(record.state),
        plans: record.plans.map(parseTrainingPlanV1),
        workouts: record.workouts.map(parseScheduledWorkoutV1),
        removedPlanIds: record.removedPlanIds.map((id) => {
            if (typeof id !== 'string') throw new Error('Invalid removed plan ID.');
            return id;
        }),
        permanentlyDeletedWorkoutIds: record.permanentlyDeletedWorkoutIds.map((id) => {
            if (typeof id !== 'string') throw new Error('Invalid deleted workout ID.');
            return id;
        }),
    };
}

function getOperationWorkoutIds(request: MutateTrainingScheduleRequestV1): string[] {
    switch (request.operation.kind) {
        case 'create-plan':
        case 'rename-plan':
        case 'set-plan-lifecycle':
        case 'shift-plan':
            return [];
        case 'copy-workout':
            return [request.operation.sourceWorkoutId, request.operation.workoutId];
        default:
            return [request.operation.workoutId];
    }
}

function getOperationCreatedEntityIds(
    request: MutateTrainingScheduleRequestV1,
): Array<{ kind: TrainingScheduleDeletionTombstoneKindV1; id: string }> {
    switch (request.operation.kind) {
        case 'create-plan':
            return [{ kind: 'plan', id: request.operation.planId }];
        case 'create-workout':
            return [{ kind: 'workout', id: request.operation.workoutId }];
        case 'copy-workout':
            return [{ kind: 'workout', id: request.operation.workoutId }];
        default:
            return [];
    }
}

function documentData(snapshot: admin.firestore.DocumentSnapshot): Record<string, unknown> {
    return (snapshot.data() ?? {}) as Record<string, unknown>;
}

async function readTrainingScheduleSnapshotInTransaction(
    transaction: admin.firestore.Transaction,
    userRef: admin.firestore.DocumentReference,
    request: MutateTrainingScheduleRequestV1,
): Promise<TrainingScheduleSnapshotV1> {
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const plansRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID);
    const workoutsRef = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID);
    const deletionTombstonesRef = stateRef.collection(
        TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID,
    );
    const currentWorkoutsQuery = workoutsRef.where('lifecycle', 'in', ['planned', 'skipped']);
    const [stateSnapshot, plansSnapshot, currentWorkoutsSnapshot] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(plansRef),
        transaction.get(currentWorkoutsQuery),
    ]);
    const directWorkoutSnapshots = await Promise.all(getOperationWorkoutIds(request).map(workoutId => (
        transaction.get(workoutsRef.doc(workoutId))
    )));
    const createdEntityIds = getOperationCreatedEntityIds(request);
    const deletionTombstoneSnapshots = await Promise.all(createdEntityIds.map(entity => (
        transaction.get(deletionTombstonesRef.doc(
            trainingScheduleDeletionTombstoneDocumentId(entity.kind, entity.id),
        ))
    )));
    const retiredEntityIndex = deletionTombstoneSnapshots.findIndex(snapshot => snapshot.exists);
    if (retiredEntityIndex >= 0) {
        const retired = createdEntityIds[retiredEntityIndex];
        throw new TrainingScheduleMutationError(
            'already-exists',
            `The ${retired.kind} ID ${retired.id} was permanently retired and cannot be reused.`,
        );
    }

    const plans = new Map<string, TrainingPlanV1>();
    plansSnapshot.docs.forEach((planSnapshot) => {
        const plan = parseTrainingPlanV1(documentData(planSnapshot));
        if (plan.id !== planSnapshot.id) throw new Error('Training plan document ID mismatch.');
        plans.set(plan.id, plan);
    });
    const workouts = new Map<string, ScheduledWorkoutV1>();
    [...currentWorkoutsSnapshot.docs, ...directWorkoutSnapshots].forEach((workoutSnapshot) => {
        if (!workoutSnapshot.exists) return;
        const workout = parseScheduledWorkoutV1(documentData(workoutSnapshot));
        if (workout.id !== workoutSnapshot.id) throw new Error('Scheduled workout document ID mismatch.');
        workouts.set(workout.id, workout);
    });

    return {
        state: stateSnapshot.exists
            ? parseTrainingPlanStateV1(documentData(stateSnapshot))
            : createEmptyTrainingPlanState(),
        plans,
        workouts,
    };
}

export function trainingScheduleRevisionDocumentId(revision: number): string {
    return `${revision}`.padStart(10, '0');
}

export async function mutateTrainingScheduleForUser(
    uid: string,
    request: MutateTrainingScheduleRequestV1,
    options: {
        db?: admin.firestore.Firestore;
        nowMs?: number;
    } = {},
): Promise<MutateTrainingScheduleResponseV1> {
    const db = options.db ?? admin.firestore();
    const nowMs = options.nowMs ?? Date.now();
    const requestHash = hashTrainingScheduleMutationRequest(request);
    const userRef = db.collection('users').doc(uid);
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const receiptRef = stateRef.collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(request.mutationId);
    const deletionTombstonesRef = stateRef.collection(
        TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID,
    );

    const response = await db.runTransaction(async (transaction) => {
        const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (deletionGuard.shouldSkip) {
            throw new TrainingScheduleMutationError(
                'failed-precondition',
                'This account is being deleted or is no longer available.',
            );
        }

        const receiptSnapshot = await transaction.get(receiptRef);
        if (receiptSnapshot.exists) {
            const receipt = documentData(receiptSnapshot);
            if (receipt.requestHash !== requestHash) {
                throw new TrainingScheduleMutationError(
                    'failed-precondition',
                    'This mutation ID was already used for a different request.',
                );
            }
            return parseStoredMutationResponse(receipt.response);
        }

        await assertNoTrainingPlanDeletionInProgress(transaction, stateRef);

        const snapshot = await readTrainingScheduleSnapshotInTransaction(transaction, userRef, request);
        const applied = applyTrainingScheduleMutation(snapshot, request, nowMs);
        const revisions = buildTrainingScheduleRevisionWrites(applied, request, nowMs);

        transaction.set(stateRef, cloneValue(applied.after.state));
        for (const planId of applied.affectedPlanIds) {
            const plan = applied.after.plans.get(planId);
            if (!plan) continue;
            const planRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(planId);
            transaction.set(planRef, cloneValue(plan));
            const revision = revisions.planRevisions.get(planId);
            if (revision) {
                const revisionRef = planRef.collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
                    .doc(trainingScheduleRevisionDocumentId(revision.revision));
                transaction.create(revisionRef, cloneValue(revision));
                for (const chunk of revisions.planRevisionChunks.get(planId) ?? []) {
                    transaction.create(
                        revisionRef.collection(TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID)
                            .doc(trainingPlanRevisionChunkDocumentId(chunk.kind, chunk.chunkIndex)),
                        cloneValue(chunk),
                    );
                }
            }
        }
        for (const workoutId of applied.changedWorkoutIds) {
            const workout = applied.after.workouts.get(workoutId);
            if (!workout) continue;
            const workoutRef = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId);
            transaction.set(workoutRef, cloneValue(workout));
            const revision = revisions.standaloneWorkoutRevisions.get(workoutId);
            if (revision) {
                transaction.create(
                    workoutRef.collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID).doc(trainingScheduleRevisionDocumentId(revision.revision)),
                    cloneValue(revision),
                );
            }
        }
        for (const workoutId of applied.permanentlyDeletedWorkoutIds) {
            const tombstone = buildTrainingScheduleDeletionTombstone(
                'workout',
                workoutId,
                request.mutationId,
                nowMs,
            );
            transaction.create(deletionTombstonesRef.doc(tombstone.entityIdHash), tombstone);
            transaction.delete(userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId));
        }

        const receipt: StoredMutationReceiptV1 = {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            requestHash,
            response: cloneValue(applied.response),
            createdAtMs: nowMs,
            expireAt: Timestamp.fromMillis(nowMs + MUTATION_RECEIPT_RETENTION_MS),
        };
        transaction.create(receiptRef, receipt);
        return applied.response;
    });

    for (const workoutId of response.permanentlyDeletedWorkoutIds) {
        await db.recursiveDelete(userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId));
    }
    return response;
}
