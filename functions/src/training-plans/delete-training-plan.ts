import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
    SCHEDULED_WORKOUTS_COLLECTION_ID,
    TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID,
    TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID,
    TRAINING_PLAN_REVISIONS_COLLECTION_ID,
    TRAINING_PLAN_SCHEMA_VERSION,
    TRAINING_PLANS_COLLECTION_ID,
    TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID,
    parseScheduledWorkoutV1,
    parseTrainingPlanStateV1,
    parseTrainingPlanV1,
    type DeleteTrainingPlanRequestV1,
    type DeleteTrainingPlanResponseV1,
    type ScheduledWorkoutV1,
} from '../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import {
    TrainingScheduleMutationError,
    cloneTrainingScheduleSnapshot,
    type TrainingScheduleSnapshotV1,
} from './mutation';
import {
    buildTrainingScheduleDeletionTombstone,
    hashTrainingScheduleRequestPayload,
    trainingScheduleDeletionTombstoneDocumentId,
    trainingScheduleRevisionDocumentId,
    type StandaloneWorkoutRevisionDocumentV1,
} from './persistence';

const DELETE_PLAN_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECURSIVE_DELETE_CONCURRENCY = 20;

interface PlanDeletionLockWorkoutV1 {
    id: string;
    revision: number;
}

interface PlanDeletionLockV1 {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    mutationId: string;
    requestHash: string;
    planId: string;
    planRevision: number;
    workoutDisposition: DeleteTrainingPlanRequestV1['workoutDisposition'];
    workouts: PlanDeletionLockWorkoutV1[];
    createdAtMs: number;
}

export interface AppliedTrainingPlanDeletionV1 {
    before: TrainingScheduleSnapshotV1;
    after: TrainingScheduleSnapshotV1;
    convertedWorkouts: Map<string, ScheduledWorkoutV1>;
    response: DeleteTrainingPlanResponseV1;
}

function documentData(snapshot: admin.firestore.DocumentSnapshot): Record<string, unknown> {
    return (snapshot.data() ?? {}) as Record<string, unknown>;
}

function valuesEqual(left: unknown, right: unknown): boolean {
    return hashTrainingScheduleRequestPayload(left) === hashTrainingScheduleRequestPayload(right);
}

function requireExpectedRevision(
    request: DeleteTrainingPlanRequestV1,
    scope: 'state' | 'plan',
    id: string,
    actual: number,
): void {
    const expected = request.expectedRevisions.find(item => item.scope === scope && item.id === id);
    if (!expected || expected.revision !== actual) {
        throw new TrainingScheduleMutationError(
            'revision-conflict',
            `${scope} ${id} changed before the plan could be deleted.`,
        );
    }
}

function currentPlanWorkouts(snapshot: TrainingScheduleSnapshotV1, planId: string): ScheduledWorkoutV1[] {
    return [...snapshot.workouts.values()]
        .filter(workout => workout.planId === planId && workout.lifecycle !== 'deleted')
        .sort((left, right) => left.id.localeCompare(right.id));
}

export function applyTrainingPlanDeletion(
    snapshotInput: TrainingScheduleSnapshotV1,
    request: DeleteTrainingPlanRequestV1,
    nowMs: number,
): AppliedTrainingPlanDeletionV1 {
    const before = cloneTrainingScheduleSnapshot(snapshotInput);
    const after = cloneTrainingScheduleSnapshot(snapshotInput);
    const plan = before.plans.get(request.planId);
    if (!plan) throw new TrainingScheduleMutationError('not-found', 'The training plan was not found.');
    requireExpectedRevision(request, 'state', 'current', before.state.revision);
    requireExpectedRevision(request, 'plan', request.planId, plan.revision);

    const planWorkouts = currentPlanWorkouts(before, request.planId);
    if (plan.workoutCount !== planWorkouts.length) {
        throw new TrainingScheduleMutationError(
            'failed-precondition',
            'The plan workout count is inconsistent. Reload the schedule before deleting this plan.',
        );
    }

    const convertedWorkouts = new Map<string, ScheduledWorkoutV1>();
    const permanentlyDeletedWorkoutIds: string[] = [];
    for (const current of planWorkouts) {
        if (request.workoutDisposition === 'convert-to-standalone') {
            const converted = parseScheduledWorkoutV1({
                ...current,
                planId: null,
                revision: current.revision + 1,
                updatedAtMs: nowMs,
            });
            after.workouts.set(current.id, converted);
            convertedWorkouts.set(current.id, converted);
        } else {
            after.workouts.delete(current.id);
            permanentlyDeletedWorkoutIds.push(current.id);
        }
    }
    after.plans.delete(request.planId);
    after.state = parseTrainingPlanStateV1({
        ...after.state,
        activePlanId: after.state.activePlanId === request.planId ? null : after.state.activePlanId,
        revision: before.state.revision + 1,
        currentWorkoutCount: request.workoutDisposition === 'delete-workouts'
            ? before.state.currentWorkoutCount - planWorkouts.length
            : before.state.currentWorkoutCount,
        updatedAtMs: nowMs,
    });

    const convertedWorkoutIds = [...convertedWorkouts.keys()].sort();
    permanentlyDeletedWorkoutIds.sort();
    return {
        before,
        after,
        convertedWorkouts,
        response: {
            mutationId: request.mutationId,
            state: after.state,
            removedPlanId: request.planId,
            workoutDisposition: request.workoutDisposition,
            convertedWorkoutIds,
            permanentlyDeletedWorkoutIds,
        },
    };
}

function parseStoredDeleteResponse(value: unknown): DeleteTrainingPlanResponseV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plan-deletion receipt.');
    const record = value as Record<string, unknown>;
    if (
        typeof record.mutationId !== 'string'
        || typeof record.removedPlanId !== 'string'
        || (record.workoutDisposition !== 'convert-to-standalone' && record.workoutDisposition !== 'delete-workouts')
        || !Array.isArray(record.convertedWorkoutIds)
        || !Array.isArray(record.permanentlyDeletedWorkoutIds)
    ) throw new Error('Invalid plan-deletion receipt.');
    const convertedWorkoutIds = record.convertedWorkoutIds;
    const permanentlyDeletedWorkoutIds = record.permanentlyDeletedWorkoutIds;
    if (
        convertedWorkoutIds.some(id => typeof id !== 'string')
        || permanentlyDeletedWorkoutIds.some(id => typeof id !== 'string')
    ) throw new Error('Invalid plan-deletion receipt.');
    return {
        mutationId: record.mutationId,
        state: parseTrainingPlanStateV1(record.state),
        removedPlanId: record.removedPlanId,
        workoutDisposition: record.workoutDisposition,
        convertedWorkoutIds: convertedWorkoutIds as string[],
        permanentlyDeletedWorkoutIds: permanentlyDeletedWorkoutIds as string[],
    };
}

function parsePlanDeletionLock(value: unknown): PlanDeletionLockV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plan-deletion lock.');
    const record = value as Record<string, unknown>;
    if (
        record.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION
        || typeof record.mutationId !== 'string'
        || typeof record.requestHash !== 'string'
        || typeof record.planId !== 'string'
        || !Number.isSafeInteger(record.planRevision)
        || (record.workoutDisposition !== 'convert-to-standalone' && record.workoutDisposition !== 'delete-workouts')
        || !Array.isArray(record.workouts)
        || !Number.isSafeInteger(record.createdAtMs)
    ) throw new Error('Invalid plan-deletion lock.');
    const workouts = record.workouts.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plan-deletion lock workout.');
        const workout = value as Record<string, unknown>;
        if (typeof workout.id !== 'string' || !Number.isSafeInteger(workout.revision)) {
            throw new Error('Invalid plan-deletion lock workout.');
        }
        return { id: workout.id, revision: workout.revision as number };
    });
    return {
        schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
        mutationId: record.mutationId,
        requestHash: record.requestHash,
        planId: record.planId,
        planRevision: record.planRevision as number,
        workoutDisposition: record.workoutDisposition,
        workouts,
        createdAtMs: record.createdAtMs as number,
    };
}

function snapshotFromDocuments(
    stateSnapshot: admin.firestore.DocumentSnapshot,
    planSnapshot: admin.firestore.DocumentSnapshot,
    workoutSnapshots: admin.firestore.QueryDocumentSnapshot[],
): TrainingScheduleSnapshotV1 {
    if (!stateSnapshot.exists) {
        throw new TrainingScheduleMutationError('failed-precondition', 'Training schedule state is unavailable.');
    }
    if (!planSnapshot.exists) throw new TrainingScheduleMutationError('not-found', 'The training plan was not found.');
    const plan = parseTrainingPlanV1(documentData(planSnapshot));
    if (plan.id !== planSnapshot.id) throw new Error('Training plan document ID mismatch.');
    const workouts = workoutSnapshots.map((snapshot) => {
        const parsed = parseScheduledWorkoutV1(documentData(snapshot));
        if (parsed.id !== snapshot.id) throw new Error('Scheduled workout document ID mismatch.');
        return parsed;
    });
    return {
        state: parseTrainingPlanStateV1(documentData(stateSnapshot)),
        plans: new Map([[plan.id, plan]]),
        workouts: new Map(workouts.map(workout => [workout.id, workout])),
    };
}

type LockResult =
    | { kind: 'completed'; response: DeleteTrainingPlanResponseV1 }
    | { kind: 'pending'; lock: PlanDeletionLockV1 };

async function ensurePlanDeletionLock(
    db: admin.firestore.Firestore,
    uid: string,
    request: DeleteTrainingPlanRequestV1,
    requestHash: string,
    nowMs: number,
): Promise<LockResult> {
    const userRef = db.collection('users').doc(uid);
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const planRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(request.planId);
    const workoutsQuery = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID)
        .where('planId', '==', request.planId)
        .where('lifecycle', 'in', ['planned', 'skipped']);
    const receiptRef = stateRef.collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(request.mutationId);
    const locksRef = stateRef.collection(TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID);
    const lockRef = locksRef.doc(request.planId);

    return db.runTransaction(async (transaction) => {
        const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (deletionGuard.shouldSkip) {
            throw new TrainingScheduleMutationError('failed-precondition', 'This account is being deleted or is no longer available.');
        }
        const [receiptSnapshot, lockSnapshots, stateSnapshot, planSnapshot, workoutSnapshots] = await Promise.all([
            transaction.get(receiptRef),
            transaction.get(locksRef),
            transaction.get(stateRef),
            transaction.get(planRef),
            transaction.get(workoutsQuery),
        ]);
        if (receiptSnapshot.exists) {
            const receipt = documentData(receiptSnapshot);
            if (receipt.requestHash !== requestHash) {
                throw new TrainingScheduleMutationError('failed-precondition', 'This mutation ID was already used differently.');
            }
            return { kind: 'completed', response: parseStoredDeleteResponse(receipt.response) };
        }
        const lockSnapshot = lockSnapshots.docs.find(snapshot => snapshot.id === request.planId);
        const otherLockExists = lockSnapshots.docs.some(snapshot => snapshot.id !== request.planId);
        if (otherLockExists) {
            throw new TrainingScheduleMutationError(
                'failed-precondition',
                'Another training plan deletion is in progress. Retry this deletion after it finishes.',
            );
        }
        if (lockSnapshot?.exists) {
            const lock = parsePlanDeletionLock(documentData(lockSnapshot));
            if (lock.requestHash !== requestHash || lock.mutationId !== request.mutationId) {
                throw new TrainingScheduleMutationError('failed-precondition', 'This plan already has a deletion in progress.');
            }
            return { kind: 'pending', lock };
        }
        const snapshot = snapshotFromDocuments(stateSnapshot, planSnapshot, workoutSnapshots.docs);
        const applied = applyTrainingPlanDeletion(snapshot, request, nowMs);
        const plan = snapshot.plans.get(request.planId)!;
        const lock: PlanDeletionLockV1 = {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            mutationId: request.mutationId,
            requestHash,
            planId: request.planId,
            planRevision: plan.revision,
            workoutDisposition: request.workoutDisposition,
            workouts: [...applied.convertedWorkouts.size > 0
                ? applied.convertedWorkouts.values()
                : currentPlanWorkouts(snapshot, request.planId)]
                .map(workout => ({
                    id: workout.id,
                    revision: snapshot.workouts.get(workout.id)!.revision,
                }))
                .sort((left, right) => left.id.localeCompare(right.id)),
            createdAtMs: nowMs,
        };
        transaction.create(lockRef, lock);
        return { kind: 'pending', lock };
    });
}

function convertedWorkoutForLock(current: ScheduledWorkoutV1, lock: PlanDeletionLockV1): ScheduledWorkoutV1 {
    return parseScheduledWorkoutV1({
        ...current,
        planId: null,
        revision: current.revision + 1,
        updatedAtMs: lock.createdAtMs,
    });
}

async function prepareStandaloneRevisionSnapshots(
    db: admin.firestore.Firestore,
    uid: string,
    lock: PlanDeletionLockV1,
): Promise<void> {
    if (lock.workoutDisposition !== 'convert-to-standalone' || lock.workouts.length === 0) return;
    const workoutsRef = db.collection('users').doc(uid).collection(SCHEDULED_WORKOUTS_COLLECTION_ID);
    const currentRefs = lock.workouts.map(workout => workoutsRef.doc(workout.id));
    const currentSnapshots = await db.getAll(...currentRefs);
    const converted = currentSnapshots.map((snapshot, index) => {
        if (!snapshot.exists) throw new TrainingScheduleMutationError('failed-precondition', 'A locked plan workout is missing.');
        const current = parseScheduledWorkoutV1(documentData(snapshot));
        const expected = lock.workouts[index];
        if (current.planId !== lock.planId || current.revision !== expected.revision || current.lifecycle === 'deleted') {
            throw new TrainingScheduleMutationError('revision-conflict', 'A locked plan workout changed during deletion.');
        }
        return convertedWorkoutForLock(current, lock);
    });
    const revisionRefs = converted.map(workout => workoutsRef.doc(workout.id)
        .collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
        .doc(trainingScheduleRevisionDocumentId(workout.revision)));
    const revisionSnapshots = await db.getAll(...revisionRefs);
    const missing: Array<{ ref: admin.firestore.DocumentReference; revision: StandaloneWorkoutRevisionDocumentV1 }> = [];
    revisionSnapshots.forEach((snapshot, index) => {
        const workout = converted[index];
        const revision: StandaloneWorkoutRevisionDocumentV1 = {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            revision: workout.revision,
            mutationId: lock.mutationId,
            operationKind: 'delete-plan-convert-workouts',
            createdAtMs: lock.createdAtMs,
            snapshot: workout,
        };
        if (!snapshot.exists) {
            missing.push({ ref: revisionRefs[index], revision });
            return;
        }
        if (!valuesEqual(documentData(snapshot), revision)) {
            throw new TrainingScheduleMutationError('failed-precondition', 'A workout revision conflicts with this plan deletion.');
        }
    });
    if (missing.length === 0) return;
    const batch = db.batch();
    missing.forEach(item => batch.create(item.ref, item.revision));
    await batch.commit();
}

async function preparePlanDeletionTombstones(
    db: admin.firestore.Firestore,
    uid: string,
    lock: PlanDeletionLockV1,
): Promise<void> {
    const stateRef = db.collection('users').doc(uid).collection('trainingPlanState').doc('current');
    const targets: Array<{ kind: 'plan' | 'workout'; id: string }> = [
        { kind: 'plan', id: lock.planId },
        ...(lock.workoutDisposition === 'delete-workouts'
            ? lock.workouts.map(workout => ({ kind: 'workout' as const, id: workout.id }))
            : []),
    ];
    const tombstones = targets.map(target => ({
        ref: stateRef.collection(TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID).doc(
            trainingScheduleDeletionTombstoneDocumentId(target.kind, target.id),
        ),
        value: buildTrainingScheduleDeletionTombstone(
            target.kind,
            target.id,
            lock.mutationId,
            lock.createdAtMs,
        ),
    }));
    const existing = await db.getAll(...tombstones.map(tombstone => tombstone.ref));
    const missing = tombstones.filter((tombstone, index) => {
        if (!existing[index].exists) return true;
        if (!valuesEqual(documentData(existing[index]), tombstone.value)) {
            throw new TrainingScheduleMutationError(
                'failed-precondition',
                'A deletion tombstone conflicts with this plan deletion.',
            );
        }
        return false;
    });
    if (missing.length === 0) return;
    const batch = db.batch();
    missing.forEach(tombstone => batch.create(tombstone.ref, tombstone.value));
    await batch.commit();
}

function validateLockedWorkouts(snapshot: TrainingScheduleSnapshotV1, lock: PlanDeletionLockV1): void {
    const current = currentPlanWorkouts(snapshot, lock.planId);
    if (current.length !== lock.workouts.length) {
        throw new TrainingScheduleMutationError('revision-conflict', 'The locked plan workout set changed during deletion.');
    }
    current.forEach((workout, index) => {
        const expected = lock.workouts[index];
        if (workout.id !== expected.id || workout.revision !== expected.revision) {
            throw new TrainingScheduleMutationError('revision-conflict', 'A locked plan workout changed during deletion.');
        }
    });
}

async function finalizePlanDeletion(
    db: admin.firestore.Firestore,
    uid: string,
    request: DeleteTrainingPlanRequestV1,
    requestHash: string,
    lock: PlanDeletionLockV1,
    nowMs: number,
): Promise<DeleteTrainingPlanResponseV1> {
    const userRef = db.collection('users').doc(uid);
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const planRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(request.planId);
    const workoutsRef = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID);
    const workoutsQuery = workoutsRef.where('planId', '==', request.planId)
        .where('lifecycle', 'in', ['planned', 'skipped']);
    const receiptRef = stateRef.collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(request.mutationId);
    const lockRef = stateRef.collection(TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID).doc(request.planId);

    return db.runTransaction(async (transaction) => {
        const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (deletionGuard.shouldSkip) {
            throw new TrainingScheduleMutationError('failed-precondition', 'This account is being deleted or is no longer available.');
        }
        const [receiptSnapshot, lockSnapshot, stateSnapshot, planSnapshot, workoutSnapshots] = await Promise.all([
            transaction.get(receiptRef),
            transaction.get(lockRef),
            transaction.get(stateRef),
            transaction.get(planRef),
            transaction.get(workoutsQuery),
        ]);
        if (receiptSnapshot.exists) {
            const receipt = documentData(receiptSnapshot);
            if (receipt.requestHash !== requestHash) {
                throw new TrainingScheduleMutationError('failed-precondition', 'This mutation ID was already used differently.');
            }
            return parseStoredDeleteResponse(receipt.response);
        }
        if (!lockSnapshot.exists || !valuesEqual(parsePlanDeletionLock(documentData(lockSnapshot)), lock)) {
            throw new TrainingScheduleMutationError('failed-precondition', 'The plan-deletion lock is unavailable.');
        }
        const snapshot = snapshotFromDocuments(stateSnapshot, planSnapshot, workoutSnapshots.docs);
        const currentPlan = snapshot.plans.get(request.planId)!;
        if (currentPlan.revision !== lock.planRevision) {
            throw new TrainingScheduleMutationError('revision-conflict', 'The locked plan changed during deletion.');
        }
        validateLockedWorkouts(snapshot, lock);
        const finalRequest: DeleteTrainingPlanRequestV1 = {
            ...request,
            expectedRevisions: [
                { scope: 'state', id: 'current', revision: snapshot.state.revision },
                { scope: 'plan', id: request.planId, revision: currentPlan.revision },
            ],
        };
        const applied = applyTrainingPlanDeletion(snapshot, finalRequest, lock.createdAtMs);
        transaction.set(stateRef, applied.after.state);
        if (request.workoutDisposition === 'convert-to-standalone') {
            applied.convertedWorkouts.forEach((workout) => transaction.set(workoutsRef.doc(workout.id), workout));
        } else {
            applied.response.permanentlyDeletedWorkoutIds.forEach(id => transaction.delete(workoutsRef.doc(id)));
        }
        transaction.delete(planRef);
        transaction.create(receiptRef, {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            requestHash,
            response: applied.response,
            createdAtMs: nowMs,
            expireAt: Timestamp.fromMillis(nowMs + DELETE_PLAN_RECEIPT_RETENTION_MS),
        });
        transaction.delete(lockRef);
        return applied.response;
    });
}

async function recursivelyDeleteInChunks(
    db: admin.firestore.Firestore,
    refs: admin.firestore.DocumentReference[],
): Promise<void> {
    for (let index = 0; index < refs.length; index += RECURSIVE_DELETE_CONCURRENCY) {
        await Promise.all(refs.slice(index, index + RECURSIVE_DELETE_CONCURRENCY).map(ref => db.recursiveDelete(ref)));
    }
}

async function cleanupDeletedPlanData(
    db: admin.firestore.Firestore,
    uid: string,
    response: DeleteTrainingPlanResponseV1,
): Promise<void> {
    const userRef = db.collection('users').doc(uid);
    const workoutsRef = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID);
    await db.recursiveDelete(userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(response.removedPlanId));
    await recursivelyDeleteInChunks(
        db,
        response.permanentlyDeletedWorkoutIds.map(id => workoutsRef.doc(id)),
    );
    const residual = await workoutsRef.where('planId', '==', response.removedPlanId).get();
    await recursivelyDeleteInChunks(db, residual.docs.map(snapshot => snapshot.ref));
}

export async function deleteTrainingPlanForUser(
    uid: string,
    request: DeleteTrainingPlanRequestV1,
    options: { db?: admin.firestore.Firestore; nowMs?: number } = {},
): Promise<DeleteTrainingPlanResponseV1> {
    const db = options.db ?? admin.firestore();
    const nowMs = options.nowMs ?? Date.now();
    const requestHash = hashTrainingScheduleRequestPayload(request);
    const lockResult = await ensurePlanDeletionLock(db, uid, request, requestHash, nowMs);
    const response = lockResult.kind === 'completed'
        ? lockResult.response
        : await (async () => {
            await preparePlanDeletionTombstones(db, uid, lockResult.lock);
            await prepareStandaloneRevisionSnapshots(db, uid, lockResult.lock);
            return finalizePlanDeletion(db, uid, request, requestHash, lockResult.lock, nowMs);
        })();
    await cleanupDeletedPlanData(db, uid, response);
    return response;
}
