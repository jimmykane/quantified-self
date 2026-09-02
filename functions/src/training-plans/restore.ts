import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
    SCHEDULED_WORKOUTS_COLLECTION_ID,
    TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID,
    TRAINING_PLAN_REVISIONS_COLLECTION_ID,
    TRAINING_PLAN_SCHEMA_VERSION,
    TRAINING_PLAN_MAX_CURRENT_WORKOUTS,
    TRAINING_PLANS_COLLECTION_ID,
    TrainingPlanContractError,
    normalizeTrainingScheduleMutationId,
    parseScheduledWorkoutV1,
    parseTrainingPlanStateV1,
    parseTrainingPlanV1,
    type ExpectedTrainingScheduleRevision,
    type MutateTrainingScheduleResponseV1,
    type RestoreTrainingScheduleRevisionRequestV1,
    type RestoreTrainingScheduleRevisionResponseV1,
    type ScheduledWorkoutV1,
    type TrainingPlanV1,
} from '../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import {
    parsePreviewTrainingScheduleRestoreRequest,
    readPlanSnapshotAtRevision,
    readStandaloneWorkoutAtRevision,
    type ReconstructedTrainingPlanRevisionV1,
} from './history';
import {
    TrainingScheduleMutationError,
    cloneTrainingScheduleSnapshot,
    type AppliedTrainingScheduleMutationV1,
    type TrainingScheduleSnapshotV1,
} from './mutation';
import {
    TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID,
    buildTrainingScheduleRevisionWrites,
    hashTrainingScheduleRequestPayload,
    trainingPlanRevisionChunkDocumentId,
    trainingScheduleRevisionDocumentId,
} from './persistence';
import { assertNoTrainingPlanDeletionInProgress } from './deletion-lock';

const RESTORE_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface AppliedTrainingScheduleRestoreV1 {
    applied: AppliedTrainingScheduleMutationV1;
    response: RestoreTrainingScheduleRevisionResponseV1;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TrainingPlanContractError(path, 'Expected an object.');
    }
    return value as Record<string, unknown>;
}

function parseExpectedRevisions(value: unknown): ExpectedTrainingScheduleRevision[] {
    if (!Array.isArray(value) || value.length > 4) {
        throw new TrainingPlanContractError('$.expectedRevisions', 'Expected at most four revision checks.');
    }
    const seen = new Set<string>();
    return value.map((entry, index) => {
        const record = asRecord(entry, `$.expectedRevisions[${index}]`);
        const unknown = Object.keys(record).find(field => !['scope', 'id', 'revision'].includes(field));
        if (unknown) {
            throw new TrainingPlanContractError(`$.expectedRevisions[${index}].${unknown}`, 'Unknown field.');
        }
        const scope = record.scope;
        if (scope !== 'state' && scope !== 'plan' && scope !== 'workout') {
            throw new TrainingPlanContractError(`$.expectedRevisions[${index}].scope`, 'Invalid revision scope.');
        }
        const id = record.id;
        if (typeof id !== 'string' || (scope === 'state' ? id !== 'current' : !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))) {
            throw new TrainingPlanContractError(`$.expectedRevisions[${index}].id`, 'Invalid revision ID.');
        }
        if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0) {
            throw new TrainingPlanContractError(`$.expectedRevisions[${index}].revision`, 'Invalid revision.');
        }
        const key = `${scope}:${id}`;
        if (seen.has(key)) throw new TrainingPlanContractError(`$.expectedRevisions[${index}]`, 'Duplicate revision check.');
        seen.add(key);
        return { scope, id, revision: record.revision as number };
    });
}

export function parseRestoreTrainingScheduleRevisionRequest(
    value: unknown,
): RestoreTrainingScheduleRevisionRequestV1 {
    const record = asRecord(value, '$');
    const unknown = Object.keys(record).find(field => ![
        'mutationId', 'expectedRevisions', 'scope', 'targetRevision',
    ].includes(field));
    if (unknown) throw new TrainingPlanContractError(`$.${unknown}`, 'Unknown field.');
    const preview = parsePreviewTrainingScheduleRestoreRequest({
        scope: record.scope,
        targetRevision: record.targetRevision,
    });
    return {
        ...preview,
        mutationId: normalizeTrainingScheduleMutationId(record.mutationId),
        expectedRevisions: parseExpectedRevisions(record.expectedRevisions),
    };
}

function expectedMap(expected: ExpectedTrainingScheduleRevision[]): Map<string, number> {
    return new Map(expected.map(item => [`${item.scope}:${item.id}`, item.revision]));
}

function requireRevision(
    expected: Map<string, number>,
    scope: ExpectedTrainingScheduleRevision['scope'],
    id: string,
    actual: number,
): void {
    const key = `${scope}:${id}`;
    if (!expected.has(key) || expected.get(key) !== actual) {
        throw new TrainingScheduleMutationError('revision-conflict', `${scope} ${id} changed before the restore could be applied.`);
    }
}

function logicalWorkoutValue(workout: ScheduledWorkoutV1 | null | undefined): unknown {
    if (!workout) return null;
    return {
        planId: workout.planId,
        localDate: workout.localDate,
        lifecycle: workout.lifecycle,
        title: workout.title,
        structure: workout.structure,
    };
}

function logicalValuesEqual(left: ScheduledWorkoutV1 | null | undefined, right: ScheduledWorkoutV1 | null | undefined): boolean {
    return JSON.stringify(logicalWorkoutValue(left)) === JSON.stringify(logicalWorkoutValue(right));
}

function currentWorkoutCount(workouts: Map<string, ScheduledWorkoutV1>): number {
    return [...workouts.values()].filter(workout => workout.lifecycle !== 'deleted').length;
}

function planWorkoutCount(workouts: Map<string, ScheduledWorkoutV1>, planId: string): number {
    return [...workouts.values()].filter(workout => workout.planId === planId && workout.lifecycle !== 'deleted').length;
}

function responseForApplied(
    request: RestoreTrainingScheduleRevisionRequestV1,
    after: TrainingScheduleSnapshotV1,
    affectedPlanIds: string[],
    changedWorkoutIds: string[],
    includeWorkoutSnapshots: boolean,
): MutateTrainingScheduleResponseV1 {
    return {
        mutationId: request.mutationId,
        state: after.state,
        plans: affectedPlanIds.map(planId => after.plans.get(planId)!).filter(Boolean),
        workouts: includeWorkoutSnapshots
            ? changedWorkoutIds.map(workoutId => after.workouts.get(workoutId)!).filter(Boolean)
            : [],
        removedPlanIds: [],
        permanentlyDeletedWorkoutIds: [],
    };
}

export function applyPlanRevisionRestore(
    snapshot: TrainingScheduleSnapshotV1,
    desired: ReconstructedTrainingPlanRevisionV1,
    request: RestoreTrainingScheduleRevisionRequestV1,
    nowMs: number,
): AppliedTrainingScheduleRestoreV1 {
    if (request.scope.kind !== 'plan' || desired.plan.id !== request.scope.id) {
        throw new TrainingScheduleMutationError('failed-precondition', 'The requested plan revision does not match its scope.');
    }
    const before = cloneTrainingScheduleSnapshot(snapshot);
    const after = cloneTrainingScheduleSnapshot(snapshot);
    const expected = expectedMap(request.expectedRevisions);
    const currentPlan = after.plans.get(request.scope.id);
    if (!currentPlan) throw new TrainingScheduleMutationError('not-found', 'The current training plan was not found.');
    requireRevision(expected, 'state', 'current', before.state.revision);
    requireRevision(expected, 'plan', currentPlan.id, currentPlan.revision);

    const affectedPlanIds = new Set<string>([currentPlan.id]);
    const changedWorkoutIds = new Set<string>();
    const skippedWorkoutIds = new Set<string>();
    const desiredLifecycle = desired.plan.lifecycle;
    if (desiredLifecycle === 'active') {
        const previousActiveId = after.state.activePlanId;
        if (previousActiveId && previousActiveId !== currentPlan.id) {
            const previousActive = after.plans.get(previousActiveId);
            if (!previousActive) throw new TrainingScheduleMutationError('failed-precondition', 'The active plan is unavailable.');
            requireRevision(expected, 'plan', previousActiveId, previousActive.revision);
            previousActive.lifecycle = 'paused';
            previousActive.revision += 1;
            previousActive.lastCheckpointRevision = previousActive.revision;
            previousActive.updatedAtMs = nowMs;
            affectedPlanIds.add(previousActiveId);
        }
        after.state.activePlanId = currentPlan.id;
    } else if (after.state.activePlanId === currentPlan.id) {
        after.state.activePlanId = null;
    }

    desired.workouts.forEach((desiredWorkout, workoutId) => {
        const current = after.workouts.get(workoutId);
        // A recoverably deleted workout still has a current document and can
        // be restored. A missing document has been permanently deleted, so an
        // older plan checkpoint must never recreate it.
        if (!current) {
            skippedWorkoutIds.add(workoutId);
            return;
        }
        if (current && current.planId !== currentPlan.id) {
            skippedWorkoutIds.add(workoutId);
            return;
        }
        const restored: ScheduledWorkoutV1 = parseScheduledWorkoutV1({
            ...desiredWorkout,
            planId: currentPlan.id,
            revision: current.revision + 1,
            createdAtMs: current.createdAtMs,
            updatedAtMs: nowMs,
        });
        if (!logicalValuesEqual(current, restored)) {
            after.workouts.set(workoutId, restored);
            changedWorkoutIds.add(workoutId);
        }
    });

    for (const current of [...after.workouts.values()]) {
        if (
            current.planId !== currentPlan.id
            || current.lifecycle === 'deleted'
            || desired.workouts.has(current.id)
        ) continue;
        after.workouts.set(current.id, parseScheduledWorkoutV1({
            ...current,
            lifecycle: 'deleted',
            revision: current.revision + 1,
            updatedAtMs: nowMs,
            deletedAtMs: nowMs,
        }));
        changedWorkoutIds.add(current.id);
    }

    after.plans.set(currentPlan.id, parseTrainingPlanV1({
        ...desired.plan,
        id: currentPlan.id,
        revision: currentPlan.revision + 1,
        lastCheckpointRevision: currentPlan.revision + 1,
        workoutCount: planWorkoutCount(after.workouts, currentPlan.id),
        createdAtMs: currentPlan.createdAtMs,
        updatedAtMs: nowMs,
    }));
    const restoredCurrentWorkoutCount = currentWorkoutCount(after.workouts);
    if (restoredCurrentWorkoutCount > TRAINING_PLAN_MAX_CURRENT_WORKOUTS) {
        throw new TrainingScheduleMutationError(
            'limit-exceeded',
            `A restore may not exceed ${TRAINING_PLAN_MAX_CURRENT_WORKOUTS} current workouts.`,
        );
    }
    after.state = parseTrainingPlanStateV1({
        ...after.state,
        revision: before.state.revision + 1,
        currentWorkoutCount: restoredCurrentWorkoutCount,
        updatedAtMs: nowMs,
    });

    const affected = [...affectedPlanIds];
    const changed = [...changedWorkoutIds];
    const mutation = responseForApplied(request, after, affected, changed, false);
    const applied: AppliedTrainingScheduleMutationV1 = {
        response: mutation,
        before,
        after,
        affectedPlanIds: affected,
        changedWorkoutIds: changed,
        permanentlyDeletedWorkoutIds: [],
        bulkOperation: true,
    };
    return {
        applied,
        response: { mutation, skippedWorkoutIds: [...skippedWorkoutIds].sort() },
    };
}

export function applyStandaloneRevisionRestore(
    snapshot: TrainingScheduleSnapshotV1,
    desired: ScheduledWorkoutV1,
    request: RestoreTrainingScheduleRevisionRequestV1,
    nowMs: number,
): AppliedTrainingScheduleRestoreV1 {
    if (request.scope.kind !== 'workout' || desired.id !== request.scope.id || desired.planId !== null) {
        throw new TrainingScheduleMutationError('failed-precondition', 'The requested revision is not a standalone workout state.');
    }
    const before = cloneTrainingScheduleSnapshot(snapshot);
    const after = cloneTrainingScheduleSnapshot(snapshot);
    const expected = expectedMap(request.expectedRevisions);
    const current = after.workouts.get(request.scope.id);
    if (!current) throw new TrainingScheduleMutationError('not-found', 'The current scheduled workout was not found.');
    requireRevision(expected, 'state', 'current', before.state.revision);
    requireRevision(expected, 'workout', current.id, current.revision);
    if (current.planId !== null) {
        throw new TrainingScheduleMutationError(
            'failed-precondition',
            'This workout now belongs to a plan and cannot be reclaimed automatically.',
        );
    }
    const restored = parseScheduledWorkoutV1({
        ...desired,
        planId: null,
        revision: current.revision + 1,
        createdAtMs: current.createdAtMs,
        updatedAtMs: nowMs,
    });
    after.workouts.set(current.id, restored);
    const restoredCurrentWorkoutCount = currentWorkoutCount(after.workouts);
    if (restoredCurrentWorkoutCount > TRAINING_PLAN_MAX_CURRENT_WORKOUTS) {
        throw new TrainingScheduleMutationError(
            'limit-exceeded',
            `A restore may not exceed ${TRAINING_PLAN_MAX_CURRENT_WORKOUTS} current workouts.`,
        );
    }
    after.state = parseTrainingPlanStateV1({
        ...after.state,
        revision: before.state.revision + 1,
        currentWorkoutCount: restoredCurrentWorkoutCount,
        updatedAtMs: nowMs,
    });
    const mutation = responseForApplied(request, after, [], [current.id], true);
    const applied: AppliedTrainingScheduleMutationV1 = {
        response: mutation,
        before,
        after,
        affectedPlanIds: [],
        changedWorkoutIds: [current.id],
        permanentlyDeletedWorkoutIds: [],
        bulkOperation: false,
    };
    return { applied, response: { mutation, skippedWorkoutIds: [] } };
}

function documentData(snapshot: admin.firestore.DocumentSnapshot): Record<string, unknown> {
    return (snapshot.data() ?? {}) as Record<string, unknown>;
}

async function readCurrentScheduleForRestore(
    transaction: admin.firestore.Transaction,
    userRef: admin.firestore.DocumentReference,
    desiredWorkoutIds: string[],
): Promise<TrainingScheduleSnapshotV1> {
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const plansRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID);
    const workoutsRef = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID);
    const [stateSnapshot, plansSnapshot, workoutsSnapshot] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(plansRef),
        transaction.get(workoutsRef.where('lifecycle', 'in', ['planned', 'skipped'])),
    ]);
    if (!stateSnapshot.exists) throw new TrainingScheduleMutationError('failed-precondition', 'Training schedule state is unavailable.');
    const directSnapshots = await Promise.all(desiredWorkoutIds.map(id => transaction.get(workoutsRef.doc(id))));
    const plans = new Map<string, TrainingPlanV1>();
    plansSnapshot.docs.forEach((snapshot) => {
        const parsed = parseTrainingPlanV1(documentData(snapshot));
        plans.set(parsed.id, parsed);
    });
    const workouts = new Map<string, ScheduledWorkoutV1>();
    [...workoutsSnapshot.docs, ...directSnapshots].forEach((snapshot) => {
        if (!snapshot.exists) return;
        const parsed = parseScheduledWorkoutV1(documentData(snapshot));
        workouts.set(parsed.id, parsed);
    });
    return { state: parseTrainingPlanStateV1(documentData(stateSnapshot)), plans, workouts };
}

function parseStoredRestoreResponse(value: unknown): RestoreTrainingScheduleRevisionResponseV1 {
    const record = asRecord(value, '$receipt.response');
    const mutation = asRecord(record.mutation, '$receipt.response.mutation');
    if (
        !Array.isArray(record.skippedWorkoutIds)
        || typeof mutation.mutationId !== 'string'
        || !Array.isArray(mutation.plans)
        || !Array.isArray(mutation.workouts)
    ) {
        throw new Error('Invalid restore receipt.');
    }
    const readStringArray = (candidate: unknown, path: string): string[] => {
        if (!Array.isArray(candidate) || candidate.some(item => typeof item !== 'string')) {
            throw new Error(`Invalid restore receipt field ${path}.`);
        }
        return candidate as string[];
    };
    return {
        mutation: {
            mutationId: mutation.mutationId,
            state: parseTrainingPlanStateV1(mutation.state),
            plans: mutation.plans.map(parseTrainingPlanV1),
            workouts: mutation.workouts.map(parseScheduledWorkoutV1),
            removedPlanIds: readStringArray(mutation.removedPlanIds, 'mutation.removedPlanIds'),
            permanentlyDeletedWorkoutIds: readStringArray(
                mutation.permanentlyDeletedWorkoutIds,
                'mutation.permanentlyDeletedWorkoutIds',
            ),
        },
        skippedWorkoutIds: readStringArray(record.skippedWorkoutIds, 'skippedWorkoutIds'),
    };
}

async function readCompletedRestoreReceiptBeforeHistory(
    db: admin.firestore.Firestore,
    uid: string,
    receiptRef: admin.firestore.DocumentReference,
    requestHash: string,
    nowMs: number,
): Promise<RestoreTrainingScheduleRevisionResponseV1 | null> {
    return db.runTransaction(async (transaction) => {
        const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (guard.shouldSkip) {
            throw new TrainingScheduleMutationError(
                'failed-precondition',
                'This account is being deleted or is no longer available.',
            );
        }
        const receiptSnapshot = await transaction.get(receiptRef);
        if (!receiptSnapshot.exists) return null;
        const receipt = documentData(receiptSnapshot);
        if (receipt.requestHash !== requestHash) {
            throw new TrainingScheduleMutationError(
                'failed-precondition',
                'This mutation ID was already used differently.',
            );
        }
        return parseStoredRestoreResponse(receipt.response);
    });
}

export async function restoreTrainingScheduleRevisionForUser(
    uid: string,
    request: RestoreTrainingScheduleRevisionRequestV1,
    options: { db?: admin.firestore.Firestore; nowMs?: number } = {},
): Promise<RestoreTrainingScheduleRevisionResponseV1> {
    const db = options.db ?? admin.firestore();
    const nowMs = options.nowMs ?? Date.now();
    const requestHash = hashTrainingScheduleRequestPayload(request);
    const userRef = db.collection('users').doc(uid);
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const receiptRef = stateRef.collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(request.mutationId);
    const completed = await readCompletedRestoreReceiptBeforeHistory(
        db,
        uid,
        receiptRef,
        requestHash,
        nowMs,
    );
    if (completed) return completed;

    const desiredPlan = request.scope.kind === 'plan'
        ? await readPlanSnapshotAtRevision(db, uid, request.scope.id, request.targetRevision)
        : null;
    const desiredWorkout = request.scope.kind === 'workout'
        ? await readStandaloneWorkoutAtRevision(db, uid, request.scope.id, request.targetRevision)
        : null;
    const desiredWorkoutIds = desiredPlan ? [...desiredPlan.workouts.keys()] : [request.scope.id];

    return db.runTransaction(async (transaction) => {
        const guard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (guard.shouldSkip) {
            throw new TrainingScheduleMutationError('failed-precondition', 'This account is being deleted or is no longer available.');
        }
        const receiptSnapshot = await transaction.get(receiptRef);
        if (receiptSnapshot.exists) {
            const receipt = documentData(receiptSnapshot);
            if (receipt.requestHash !== requestHash) {
                throw new TrainingScheduleMutationError('failed-precondition', 'This mutation ID was already used differently.');
            }
            return parseStoredRestoreResponse(receipt.response);
        }
        await assertNoTrainingPlanDeletionInProgress(transaction, stateRef);
        const snapshot = await readCurrentScheduleForRestore(transaction, userRef, desiredWorkoutIds);
        const restored = desiredPlan
            ? applyPlanRevisionRestore(snapshot, desiredPlan, request, nowMs)
            : applyStandaloneRevisionRestore(snapshot, desiredWorkout!, request, nowMs);
        const revisionRequest = {
            mutationId: request.mutationId,
            operation: { kind: request.scope.kind === 'plan' ? 'restore-plan-revision' : 'restore-workout-revision' },
        };
        const revisions = buildTrainingScheduleRevisionWrites(restored.applied, revisionRequest, nowMs);
        transaction.set(stateRef, restored.applied.after.state);
        restored.applied.affectedPlanIds.forEach((planId) => {
            const planRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(planId);
            const plan = restored.applied.after.plans.get(planId)!;
            transaction.set(planRef, plan);
            const revision = revisions.planRevisions.get(planId);
            if (revision) {
                const revisionRef = planRef.collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
                    .doc(trainingScheduleRevisionDocumentId(revision.revision));
                transaction.create(revisionRef, revision);
                for (const chunk of revisions.planRevisionChunks.get(planId) ?? []) {
                    transaction.create(
                        revisionRef.collection(TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID)
                            .doc(trainingPlanRevisionChunkDocumentId(chunk.kind, chunk.chunkIndex)),
                        chunk,
                    );
                }
            }
        });
        restored.applied.changedWorkoutIds.forEach((workoutId) => {
            const workoutRef = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId);
            const workout = restored.applied.after.workouts.get(workoutId)!;
            transaction.set(workoutRef, workout);
            const revision = revisions.standaloneWorkoutRevisions.get(workoutId);
            if (revision) transaction.create(
                workoutRef.collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
                    .doc(trainingScheduleRevisionDocumentId(revision.revision)),
                revision,
            );
        });
        transaction.create(receiptRef, {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            requestHash,
            response: restored.response,
            createdAtMs: nowMs,
            expireAt: Timestamp.fromMillis(nowMs + RESTORE_RECEIPT_RETENTION_MS),
        });
        return restored.response;
    });
}
