import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import {
    STRENGTH_DETAILS_COLLECTION_ID,
    STRENGTH_DETAILS_DOCUMENT_ID,
    parseStrengthWorkoutDetailsV1,
    strengthProjectionMatchesDetails,
    type StrengthWorkoutDetailsV1,
} from '../../../shared/strength-workout';
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
import { invalidateTrainingWorkoutConsent, stagePastWorkoutCleanup, stageTrainingDeliveryReconciliation } from './delivery/marker';
import { TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID } from '../../../shared/training-workout-completion';

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
    strengthBefore?: StrengthWorkoutDetailsV1 | null;
    strengthAfter?: StrengthWorkoutDetailsV1 | null;
}

export interface TrainingPlanWorkoutCheckpointV1 {
    workout: ScheduledWorkoutV1;
    strength: StrengthWorkoutDetailsV1;
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
    strength?: StrengthWorkoutDetailsV1;
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

function requireStrengthDetails(snapshot: TrainingScheduleSnapshotV1, workout: ScheduledWorkoutV1): StrengthWorkoutDetailsV1 {
    const details = snapshot.strengthDetails?.get(workout.id);
    if (!details || !strengthProjectionMatchesDetails(workout.structure, details)) {
        throw new TrainingScheduleMutationError('failed-precondition', `Strength details are missing or mismatched for ${workout.id}.`);
    }
    return details;
}

function workoutsForPlan(snapshot: TrainingScheduleSnapshotV1, planId: string): Array<ScheduledWorkoutV1 | TrainingPlanWorkoutCheckpointV1> {
    return [...snapshot.workouts.values()]
        .filter(workout => workout.planId === planId && workout.lifecycle !== 'deleted')
        .sort((left, right) => left.localDate.localeCompare(right.localDate) || left.id.localeCompare(right.id))
        .map(workout => workout.structure.sport === ActivityTypes.StrengthTraining
            ? { workout: cloneValue(workout), strength: cloneValue(requireStrengthDetails(snapshot, workout)) }
            : cloneValue(workout));
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
                ...(applied.before.strengthDetails?.has(workoutId) || applied.after.strengthDetails?.has(workoutId)
                    ? {
                        strengthBefore: cloneValue(applied.before.strengthDetails?.get(workoutId) ?? null),
                        strengthAfter: cloneValue(applied.after.strengthDetails?.get(workoutId) ?? null),
                    }
                    : {}),
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
            ...(applied.after.strengthDetails?.has(workoutId)
                ? { strength: cloneValue(applied.after.strengthDetails.get(workoutId)!) }
                : {}),
        });
    }

    const estimatedWriteCount = 3
        + applied.affectedPlanIds.length * 2
        + applied.changedWorkoutIds.length
        + applied.changedWorkoutIds.filter(id => !valuesEqual(applied.before.strengthDetails?.get(id), applied.after.strengthDetails?.get(id))).length
        + applied.changedWorkoutIds.filter(id => applied.before.workouts.get(id)?.planId !== applied.after.workouts.get(id)?.planId
            || applied.after.workouts.get(id)?.lifecycle === 'deleted').length
        // Tombstone, workout root, and owner-visible completion projection.
        + applied.permanentlyDeletedWorkoutIds.length * 3
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
        case 'set-plan-color':
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
    requests: readonly MutateTrainingScheduleRequestV1[],
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
    const workoutIds = [...new Set(requests.flatMap(getOperationWorkoutIds))];
    const directWorkoutSnapshots = await Promise.all(workoutIds.map(workoutId => (
        transaction.get(workoutsRef.doc(workoutId))
    )));
    const createdEntityIds = requests.flatMap(getOperationCreatedEntityIds)
        .filter((entity, index, all) => all.findIndex(candidate => (
            candidate.kind === entity.kind && candidate.id === entity.id
        )) === index);
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

    const strengthWorkouts = [...workouts.values()].filter(workout => workout.structure.sport === ActivityTypes.StrengthTraining);
    const strengthSnapshots = await Promise.all(strengthWorkouts.map(workout => transaction.get(
        workoutsRef.doc(workout.id).collection(STRENGTH_DETAILS_COLLECTION_ID).doc(STRENGTH_DETAILS_DOCUMENT_ID),
    )));
    const strengthDetails = new Map<string, StrengthWorkoutDetailsV1>();
    strengthSnapshots.forEach((strengthSnapshot, index) => {
        const workout = strengthWorkouts[index];
        if (!strengthSnapshot.exists) throw new TrainingScheduleMutationError('failed-precondition', `Strength details are missing for ${workout.id}.`);
        const details = parseStrengthWorkoutDetailsV1(documentData(strengthSnapshot));
        if (details.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, details)) {
            throw new TrainingScheduleMutationError('failed-precondition', `Strength details are mismatched for ${workout.id}.`);
        }
        strengthDetails.set(workout.id, details);
    });

    return {
        state: stateSnapshot.exists
            ? parseTrainingPlanStateV1(documentData(stateSnapshot))
            : createEmptyTrainingPlanState(),
        plans,
        workouts,
        strengthDetails,
    };
}

export function trainingScheduleRevisionDocumentId(revision: number): string {
    return `${revision}`.padStart(10, '0');
}

export interface TrainingScheduleMutationOptions {
    db?: admin.firestore.Firestore;
    nowMs?: number;
    transactionPrecondition?: (transaction: admin.firestore.Transaction) => Promise<void>;
    transactionPostcondition?: (
        transaction: admin.firestore.Transaction,
        responses: readonly MutateTrainingScheduleResponseV1[],
    ) => Promise<void> | void;
    additionalWriteBudget?: number;
}

export class TrainingScheduleBatchWriteLimitError extends TrainingScheduleMutationError {
    constructor() {
        super(
            'limit-exceeded',
            'These changes produce too much revision history for one atomic batch. Apply them in smaller batches.',
        );
        this.name = 'TrainingScheduleBatchWriteLimitError';
    }
}

interface AppliedBatchItem {
    request: MutateTrainingScheduleRequestV1;
    applied: AppliedTrainingScheduleMutationV1;
    revisions: TrainingScheduleRevisionWritesV1;
    nowMs: number;
}

function uniqueDocumentCount(values: readonly string[]): number {
    return new Set(values).size;
}

function estimateBatchWriteCount(
    items: readonly AppliedBatchItem[],
    additionalWriteBudget: number,
): number {
    const final = items.length > 0 ? items[items.length - 1].applied.after : undefined;
    if (!final) return additionalWriteBudget;
    const affectedPlans = items.flatMap(item => item.applied.affectedPlanIds);
    const changedWorkouts = items.flatMap(item => item.applied.changedWorkoutIds);
    const permanentlyDeletedWorkouts = items.flatMap(item => item.applied.permanentlyDeletedWorkoutIds);
    const invalidatedWorkouts = items.flatMap(item => (
        [...item.applied.changedWorkoutIds, ...item.applied.permanentlyDeletedWorkoutIds].filter(id => (
            item.applied.before.workouts.get(id)?.planId !== item.applied.after.workouts.get(id)?.planId
            || item.applied.after.workouts.get(id)?.lifecycle === 'deleted'
            || !item.applied.after.workouts.has(id)
        ))
    ));
    const pastCleanupWorkouts = items.flatMap(item => {
        const operation = item.request.operation;
        return (operation.kind === 'delete-workout' || operation.kind === 'permanently-delete-workout')
            ? [operation.workoutId] : [];
    });
    const historyWrites = items.reduce((total, item) => total
        + item.revisions.planRevisions.size
        + [...item.revisions.planRevisionChunks.values()].reduce((sum, chunks) => sum + chunks.length, 0)
        + item.revisions.standaloneWorkoutRevisions.size, 0);
    return 2 // Final state plus one reconciliation marker.
        + uniqueDocumentCount(affectedPlans.filter(id => final.plans.has(id)))
        + uniqueDocumentCount(changedWorkouts.filter(id => final.workouts.has(id)))
        + uniqueDocumentCount(changedWorkouts.filter(id => items.some(item => !valuesEqual(
            item.applied.before.strengthDetails?.get(id), item.applied.after.strengthDetails?.get(id),
        )) && final.strengthDetails?.has(id)))
        + historyWrites
        + uniqueDocumentCount(invalidatedWorkouts)
        + uniqueDocumentCount(pastCleanupWorkouts)
        + uniqueDocumentCount(permanentlyDeletedWorkouts) * 3
        + items.length // One idempotency receipt per newly applied request.
        + additionalWriteBudget;
}

export async function mutateTrainingScheduleBatchForUser(
    uid: string,
    requests: readonly MutateTrainingScheduleRequestV1[],
    options: TrainingScheduleMutationOptions = {},
): Promise<MutateTrainingScheduleResponseV1[]> {
    if (requests.length < 1 || requests.length > 25) {
        throw new TrainingScheduleMutationError('limit-exceeded', 'Apply between 1 and 25 Training changes at once.');
    }
    if (new Set(requests.map(request => request.mutationId)).size !== requests.length) {
        throw new TrainingScheduleMutationError('failed-precondition', 'Training mutation IDs must be unique within a batch.');
    }
    const additionalWriteBudget = options.additionalWriteBudget ?? 0;
    if (!Number.isInteger(additionalWriteBudget) || additionalWriteBudget < 0) {
        throw new TrainingScheduleMutationError('failed-precondition', 'The additional write budget must be a non-negative integer.');
    }
    const db = options.db ?? admin.firestore();
    const nowMs = options.nowMs ?? Date.now();
    const userRef = db.collection('users').doc(uid);
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const receiptRefs = requests.map(request => (
        stateRef.collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(request.mutationId)
    ));
    const requestHashes = requests.map(hashTrainingScheduleMutationRequest);
    const deletionTombstonesRef = stateRef.collection(
        TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID,
    );

    const responses = await db.runTransaction(async (transaction) => {
        const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (deletionGuard.shouldSkip) {
            throw new TrainingScheduleMutationError(
                'failed-precondition',
                'This account is being deleted or is no longer available.',
            );
        }

        // Callers with additional server-owned authority (for example an MCP
        // grant) must verify it in the same transaction as the authored write.
        // A separate preflight check would leave a revocation race.
        await options.transactionPrecondition?.(transaction);

        const receiptSnapshots = await Promise.all(receiptRefs.map(ref => transaction.get(ref)));
        const storedResponses: MutateTrainingScheduleResponseV1[] = [];
        let pendingStart = requests.length;
        for (let index = 0; index < receiptSnapshots.length; index += 1) {
            const receiptSnapshot = receiptSnapshots[index];
            if (!receiptSnapshot.exists) {
                pendingStart = Math.min(pendingStart, index);
                continue;
            }
            if (pendingStart !== requests.length) {
                throw new TrainingScheduleMutationError(
                    'failed-precondition',
                    'This Training batch has a non-contiguous receipt history and cannot be resumed safely.',
                );
            }
            const receipt = documentData(receiptSnapshot);
            if (receipt.requestHash !== requestHashes[index]) {
                throw new TrainingScheduleMutationError(
                    'failed-precondition',
                    'This mutation ID was already used for a different request.',
                );
            }
            storedResponses.push(parseStoredMutationResponse(receipt.response));
        }
        if (pendingStart === requests.length) {
            await options.transactionPostcondition?.(transaction, storedResponses);
            return storedResponses;
        }

        await assertNoTrainingPlanDeletionInProgress(transaction, stateRef);

        const pendingRequests = requests.slice(pendingStart);
        let snapshot = await readTrainingScheduleSnapshotInTransaction(transaction, userRef, pendingRequests);
        const items: AppliedBatchItem[] = [];
        pendingRequests.forEach((request, offset) => {
            const operationNowMs = nowMs + pendingStart + offset;
            const applied = applyTrainingScheduleMutation(snapshot, request, operationNowMs);
            const revisions = buildTrainingScheduleRevisionWrites(applied, request, operationNowMs);
            items.push({ request, applied, revisions, nowMs: operationNowMs });
            snapshot = applied.after;
        });
        if (estimateBatchWriteCount(items, additionalWriteBudget) > FIRESTORE_TRANSACTION_WRITE_BUDGET) {
            throw new TrainingScheduleBatchWriteLimitError();
        }

        stageTrainingDeliveryReconciliation(transaction, db, uid);
        const invalidatedWorkoutIds = new Set<string>();
        for (const item of items) {
            for (const id of [...item.applied.changedWorkoutIds, ...item.applied.permanentlyDeletedWorkoutIds]) {
                if (item.applied.before.workouts.get(id)?.planId !== item.applied.after.workouts.get(id)?.planId
                    || item.applied.after.workouts.get(id)?.lifecycle === 'deleted'
                    || !item.applied.after.workouts.has(id)) {
                    invalidatedWorkoutIds.add(id);
                }
            }
        }
        invalidatedWorkoutIds.forEach(id => invalidateTrainingWorkoutConsent(transaction, db, uid, id));
        const pastCleanupRequests = new Map<string, { mutationId: string; requestedAtMs: number; enabled: boolean; deletedAtMs?: number }>();
        for (const item of items) {
            const operation = item.request.operation;
            if (operation.kind !== 'delete-workout' && operation.kind !== 'permanently-delete-workout') continue;
            const deletedAtMs = operation.kind === 'delete-workout'
                ? item.applied.after.workouts.get(operation.workoutId)?.deletedAtMs : undefined;
            pastCleanupRequests.set(operation.workoutId, {
                mutationId: item.request.mutationId, requestedAtMs: item.nowMs,
                enabled: operation.removePastProviderCopies === true,
                ...(deletedAtMs === undefined ? {} : { deletedAtMs }),
            });
        }
        for (const [workoutId, authorization] of pastCleanupRequests) {
            stagePastWorkoutCleanup(transaction, db, uid, workoutId, authorization.mutationId,
                authorization.requestedAtMs, authorization.enabled, authorization.deletedAtMs);
        }

        const finalSnapshot = items[items.length - 1].applied.after;
        transaction.set(stateRef, cloneValue(finalSnapshot.state));
        const affectedPlanIds = new Set(items.flatMap(item => item.applied.affectedPlanIds));
        for (const planId of affectedPlanIds) {
            const plan = finalSnapshot.plans.get(planId);
            if (!plan) continue;
            const planRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(planId);
            transaction.set(planRef, cloneValue(plan));
        }
        const changedWorkoutIds = new Set(items.flatMap(item => item.applied.changedWorkoutIds));
        for (const workoutId of changedWorkoutIds) {
            const workout = finalSnapshot.workouts.get(workoutId);
            if (!workout) continue;
            const workoutRef = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId);
            transaction.set(workoutRef, cloneValue(workout));
            const strength = finalSnapshot.strengthDetails?.get(workoutId);
            if (strength && items.some(item => !valuesEqual(
                item.applied.before.strengthDetails?.get(workoutId), item.applied.after.strengthDetails?.get(workoutId),
            ))) transaction.set(
                workoutRef.collection(STRENGTH_DETAILS_COLLECTION_ID).doc(STRENGTH_DETAILS_DOCUMENT_ID),
                cloneValue(strength),
            );
        }
        for (const item of items) {
            for (const [planId, revision] of item.revisions.planRevisions) {
                const planRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(planId);
                const revisionRef = planRef.collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
                    .doc(trainingScheduleRevisionDocumentId(revision.revision));
                transaction.create(revisionRef, cloneValue(revision));
                for (const chunk of item.revisions.planRevisionChunks.get(planId) ?? []) {
                    transaction.create(
                        revisionRef.collection(TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID)
                            .doc(trainingPlanRevisionChunkDocumentId(chunk.kind, chunk.chunkIndex)),
                        cloneValue(chunk),
                    );
                }
            }
            for (const [workoutId, revision] of item.revisions.standaloneWorkoutRevisions) {
                const workoutRef = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId);
                transaction.create(
                    workoutRef.collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID).doc(trainingScheduleRevisionDocumentId(revision.revision)),
                    cloneValue(revision),
                );
            }
        }
        const permanentlyDeletedWorkoutIds = new Set(items.flatMap(item => item.applied.permanentlyDeletedWorkoutIds));
        for (const workoutId of permanentlyDeletedWorkoutIds) {
            const deletingItem = items.find(item => item.applied.permanentlyDeletedWorkoutIds.includes(workoutId))!;
            const tombstone = buildTrainingScheduleDeletionTombstone(
                'workout',
                workoutId,
                deletingItem.request.mutationId,
                deletingItem.nowMs,
            );
            transaction.create(deletionTombstonesRef.doc(tombstone.entityIdHash), tombstone);
            transaction.delete(userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId));
            transaction.delete(userRef.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(workoutId));
        }

        for (let offset = 0; offset < items.length; offset += 1) {
            const item = items[offset];
            const requestIndex = pendingStart + offset;
            const receipt: StoredMutationReceiptV1 = {
                schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
                requestHash: requestHashes[requestIndex],
                response: cloneValue(item.applied.response),
                createdAtMs: item.nowMs,
                expireAt: Timestamp.fromMillis(item.nowMs + MUTATION_RECEIPT_RETENTION_MS),
            };
            transaction.create(receiptRefs[requestIndex], receipt);
        }
        const nextResponses = [...storedResponses, ...items.map(item => item.applied.response)];
        await options.transactionPostcondition?.(transaction, nextResponses);
        return nextResponses;
    });

    const permanentlyDeletedWorkoutIds = new Set(responses.flatMap(response => response.permanentlyDeletedWorkoutIds));
    for (const workoutId of permanentlyDeletedWorkoutIds) {
        await db.recursiveDelete(userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId));
    }
    return responses;
}

export async function mutateTrainingScheduleForUser(
    uid: string,
    request: MutateTrainingScheduleRequestV1,
    options: TrainingScheduleMutationOptions = {},
): Promise<MutateTrainingScheduleResponseV1> {
    const responses = await mutateTrainingScheduleBatchForUser(uid, [request], options);
    return responses[0];
}
