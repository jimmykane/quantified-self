import * as admin from 'firebase-admin';
import { retireTrainingPlanDeliverySettings, stagePastPlanCleanup, stageTrainingDeliveryReconciliation } from './delivery/marker';
import { TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID } from '../../../shared/training-workout-completion';
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
import { finishTrainingCleanupJob, trainingCleanupJob, trainingCleanupJobRef } from './cleanup-job-contract';

const DELETE_PLAN_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECURSIVE_DELETE_CONCURRENCY = 20;
const TOMBSTONE_BATCH_SIZE = 200;
const RESIDUAL_WORKOUT_CLEANUP_PAGE_SIZE = 100;
// Leave ample room below Firestore's 10 MiB request ceiling for document names,
// protocol overhead, and index updates. A revision is staged before the
// canonical plan deletion, so multiple transactions do not expose mixed state.
const PREPARE_REVISION_TRANSACTION_BYTES = 2 * 1024 * 1024;
const PREPARE_REVISION_TRANSACTION_WRITES = 100;

interface PlanDeletionLockWorkoutV1 {
    id: string;
    revision: number;
}

interface PlanDeletionLockV1 {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    mutationId: string;
    requestHash: string;
    planId: string;
    stateRevision: number;
    planRevision: number;
    workoutDisposition: DeleteTrainingPlanRequestV1['workoutDisposition'];
    removePastProviderCopies?: boolean;
    workouts: PlanDeletionLockWorkoutV1[];
    createdAtMs: number;
}

export interface AppliedTrainingPlanDeletionV1 {
    before: TrainingScheduleSnapshotV1;
    after: TrainingScheduleSnapshotV1;
    convertedWorkouts: Map<string, ScheduledWorkoutV1>;
    response: DeleteTrainingPlanResponseV1;
}

export class TrainingPlanDeletionResumeRequiredError extends Error {
    constructor(readonly originalError: unknown) {
        super(originalError instanceof Error ? originalError.message : 'The plan deletion was interrupted.');
        this.name = 'TrainingPlanDeletionResumeRequiredError';
    }
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
        if (current.structure.sport === ActivityTypes.StrengthTraining) {
            const details = before.strengthDetails?.get(current.id);
            if (!details || details.workoutId !== current.id || !strengthProjectionMatchesDetails(current.structure, details)) {
                throw new TrainingScheduleMutationError('failed-precondition', `Strength details are missing or mismatched for ${current.id}.`);
            }
        }
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

async function readStrengthDetailsForPlanWorkouts(
    transaction: admin.firestore.Transaction,
    workoutsRef: admin.firestore.CollectionReference,
    workouts: Map<string, ScheduledWorkoutV1>,
): Promise<Map<string, StrengthWorkoutDetailsV1>> {
    const strengthWorkouts = [...workouts.values()].filter(workout => workout.structure.sport === ActivityTypes.StrengthTraining);
    const snapshots = await Promise.all(strengthWorkouts.map(workout => transaction.get(
        workoutsRef.doc(workout.id).collection(STRENGTH_DETAILS_COLLECTION_ID).doc(STRENGTH_DETAILS_DOCUMENT_ID),
    )));
    const details = new Map<string, StrengthWorkoutDetailsV1>();
    snapshots.forEach((snapshot, index) => {
        const workout = strengthWorkouts[index];
        if (!snapshot.exists) throw new TrainingScheduleMutationError('failed-precondition', `Strength details are missing for ${workout.id}.`);
        const parsed = parseStrengthWorkoutDetailsV1(documentData(snapshot));
        if (parsed.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, parsed)) {
            throw new TrainingScheduleMutationError('failed-precondition', `Strength details are mismatched for ${workout.id}.`);
        }
        details.set(workout.id, parsed);
    });
    return details;
}

export function parseStoredDeleteResponse(value: unknown): DeleteTrainingPlanResponseV1 {
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
        || !Number.isSafeInteger(record.stateRevision)
        || !Number.isSafeInteger(record.planRevision)
        || (record.workoutDisposition !== 'convert-to-standalone' && record.workoutDisposition !== 'delete-workouts')
        || (record.removePastProviderCopies !== undefined && typeof record.removePastProviderCopies !== 'boolean')
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
        stateRevision: record.stateRevision as number,
        planRevision: record.planRevision as number,
        workoutDisposition: record.workoutDisposition,
        ...(record.removePastProviderCopies === true ? { removePastProviderCopies: true } : {}),
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

type PlanDeletionTransactionPrecondition = (
    transaction: admin.firestore.Transaction,
) => Promise<void>;

async function ensurePlanDeletionLock(
    db: admin.firestore.Firestore,
    uid: string,
    request: DeleteTrainingPlanRequestV1,
    requestHash: string,
    nowMs: number,
    transactionPrecondition?: PlanDeletionTransactionPrecondition,
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
        await transactionPrecondition?.(transaction);
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
            if (lock.workoutDisposition !== request.workoutDisposition
                || !!lock.removePastProviderCopies !== !!request.removePastProviderCopies) {
                throw new TrainingScheduleMutationError(
                    'failed-precondition',
                    'This plan already has a deletion in progress with a different workout choice.',
                );
            }
            requireExpectedRevision(request, 'state', 'current', lock.stateRevision);
            requireExpectedRevision(request, 'plan', request.planId, lock.planRevision);
            const canonicalReceiptSnapshot = await transaction.get(
                stateRef.collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(lock.mutationId),
            );
            if (canonicalReceiptSnapshot.exists) {
                const canonicalReceipt = documentData(canonicalReceiptSnapshot);
                if (canonicalReceipt.requestHash !== lock.requestHash) {
                    throw new TrainingScheduleMutationError(
                        'failed-precondition',
                        'The completed plan deletion does not match its cleanup lock.',
                    );
                }
                return {
                    kind: 'completed',
                    response: parseStoredDeleteResponse(canonicalReceipt.response),
                };
            }
            return { kind: 'pending', lock };
        }
        const snapshot = snapshotFromDocuments(stateSnapshot, planSnapshot, workoutSnapshots.docs);
        snapshot.strengthDetails = await readStrengthDetailsForPlanWorkouts(
            transaction, userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID), snapshot.workouts,
        );
        const applied = applyTrainingPlanDeletion(snapshot, request, nowMs);
        const plan = snapshot.plans.get(request.planId)!;
        const lock: PlanDeletionLockV1 = {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            mutationId: request.mutationId,
            requestHash,
            planId: request.planId,
            stateRevision: snapshot.state.revision,
            planRevision: plan.revision,
            workoutDisposition: request.workoutDisposition,
            ...(request.removePastProviderCopies === true ? { removePastProviderCopies: true } : {}),
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
    nowMs: number,
    transactionPrecondition?: PlanDeletionTransactionPrecondition,
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
    const strengthRefs = converted
        .filter(workout => workout.structure.sport === ActivityTypes.StrengthTraining)
        .map(workout => workoutsRef.doc(workout.id).collection(STRENGTH_DETAILS_COLLECTION_ID).doc(STRENGTH_DETAILS_DOCUMENT_ID));
    const strengthSnapshots = strengthRefs.length > 0 ? await db.getAll(...strengthRefs) : [];
    const strengthById = new Map<string, StrengthWorkoutDetailsV1>();
    strengthSnapshots.forEach((snapshot) => {
        if (!snapshot.exists) throw new TrainingScheduleMutationError('failed-precondition', 'A locked strength prescription is missing.');
        const details = parseStrengthWorkoutDetailsV1(documentData(snapshot));
        strengthById.set(details.workoutId, details);
    });
    converted.forEach(workout => {
        if (workout.structure.sport !== ActivityTypes.StrengthTraining) return;
        const details = strengthById.get(workout.id);
        if (!details || !strengthProjectionMatchesDetails(workout.structure, details)) {
            throw new TrainingScheduleMutationError('failed-precondition', `Strength details are mismatched for ${workout.id}.`);
        }
    });
    const revisions = converted.map(workout => ({
        ref: workoutsRef.doc(workout.id)
            .collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
            .doc(trainingScheduleRevisionDocumentId(workout.revision)),
        value: {
                schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
                revision: workout.revision,
                mutationId: lock.mutationId,
                operationKind: 'delete-plan-convert-workouts',
                createdAtMs: lock.createdAtMs,
                snapshot: workout,
                ...(strengthById.has(workout.id) ? { strength: strengthById.get(workout.id)! } : {}),
        } satisfies StandaloneWorkoutRevisionDocumentV1,
    }));
    let offset = 0;
    while (offset < revisions.length) {
        let end = offset;
        let bytes = 0;
        while (end < revisions.length && end - offset < PREPARE_REVISION_TRANSACTION_WRITES) {
            const nextBytes = Buffer.byteLength(JSON.stringify(revisions[end].value), 'utf8') + 1024;
            if (nextBytes > PREPARE_REVISION_TRANSACTION_BYTES) {
                throw new TrainingScheduleMutationError(
                    'limit-exceeded',
                    'A workout history snapshot is too large to stage safely. Reduce that workout before deleting the plan.',
                );
            }
            if (end > offset && bytes + nextBytes > PREPARE_REVISION_TRANSACTION_BYTES) break;
            bytes += nextBytes;
            end += 1;
        }
        const chunk = revisions.slice(offset, end);
        await db.runTransaction(async (transaction) => {
            const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
            if (deletionGuard.shouldSkip) {
                throw new TrainingScheduleMutationError(
                    'failed-precondition',
                    'This account is being deleted or is no longer available.',
                );
            }
            await transactionPrecondition?.(transaction);
            const snapshots = await Promise.all(chunk.map(item => transaction.get(item.ref)));
            snapshots.forEach((snapshot, index) => {
                const item = chunk[index];
                if (!snapshot.exists) {
                    transaction.create(item.ref, item.value);
                } else if (!valuesEqual(documentData(snapshot), item.value)) {
                    throw new TrainingScheduleMutationError(
                        'failed-precondition',
                        'A workout revision conflicts with this plan deletion.',
                    );
                }
            });
        });
        offset = end;
    }
}

async function preparePlanDeletionTombstones(
    db: admin.firestore.Firestore,
    uid: string,
    lock: PlanDeletionLockV1,
    nowMs: number,
    transactionPrecondition?: PlanDeletionTransactionPrecondition,
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
    await db.runTransaction(async (transaction) => {
        const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (deletionGuard.shouldSkip) {
            throw new TrainingScheduleMutationError(
                'failed-precondition',
                'This account is being deleted or is no longer available.',
            );
        }
        await transactionPrecondition?.(transaction);
        const existing = await Promise.all(tombstones.map(tombstone => transaction.get(tombstone.ref)));
        tombstones.forEach((tombstone, index) => {
            if (!existing[index].exists) {
                transaction.create(tombstone.ref, tombstone.value);
                return;
            }
            if (!valuesEqual(documentData(existing[index]), tombstone.value)) {
                throw new TrainingScheduleMutationError(
                    'failed-precondition',
                    'A deletion tombstone conflicts with this plan deletion.',
                );
            }
        });
    });
}

async function prepareResidualWorkoutCleanupJobs(
    db: admin.firestore.Firestore,
    uid: string,
    planId: string,
    workoutIds: string[],
    mutationId: string,
    createdAtMs: number,
    nowMs: number,
): Promise<void> {
    const stateRef = db.collection('users').doc(uid).collection('trainingPlanState').doc('current');
    const tombstonesRef = stateRef.collection(TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID);
    const planJobRef = trainingCleanupJobRef(db, uid, 'plan', planId);
    for (let index = 0; index < workoutIds.length; index += TOMBSTONE_BATCH_SIZE) {
        const values = workoutIds.slice(index, index + TOMBSTONE_BATCH_SIZE).map(workoutId => ({
            ref: tombstonesRef.doc(trainingScheduleDeletionTombstoneDocumentId('workout', workoutId)),
            value: buildTrainingScheduleDeletionTombstone('workout', workoutId, mutationId, createdAtMs),
            jobRef: trainingCleanupJobRef(db, uid, 'workout', workoutId),
            job: trainingCleanupJob('workout', workoutId, mutationId, createdAtMs),
        }));
        const shouldContinue = await db.runTransaction(async (transaction) => {
            const deletionGuard = await getUserDeletionGuardStateInTransaction(
                db,
                transaction,
                uid,
                nowMs,
            );
            if (deletionGuard.shouldSkip) return false;
            const planJob = await transaction.get(planJobRef);
            if (!planJob.exists) return false;
            const [existing, jobs] = await Promise.all([
                Promise.all(values.map(value => transaction.get(value.ref))),
                Promise.all(values.map(value => transaction.get(value.jobRef))),
            ]);
            values.forEach((value, valueIndex) => {
                if (existing[valueIndex].exists) {
                    if (!valuesEqual(documentData(existing[valueIndex]), value.value)) {
                        throw new TrainingScheduleMutationError(
                            'failed-precondition',
                            'A deletion tombstone conflicts with this plan cleanup.',
                        );
                    }
                } else {
                    transaction.create(value.ref, value.value);
                }
                if (jobs[valueIndex].exists) {
                    const stored = documentData(jobs[valueIndex]);
                    if (stored.kind !== 'workout' || stored.entityId !== value.job.entityId
                        || stored.mutationId !== mutationId) {
                        throw new TrainingScheduleMutationError('failed-precondition', 'A workout cleanup job conflicts with this plan deletion.');
                    }
                } else {
                    transaction.create(value.jobRef, value.job);
                }
            });
            return true;
        });
        if (!shouldContinue) return;
    }
}

async function persistPlanDeletionResumeReceipt(
    db: admin.firestore.Firestore,
    uid: string,
    request: DeleteTrainingPlanRequestV1,
    requestHash: string,
    response: DeleteTrainingPlanResponseV1,
    nowMs: number,
): Promise<void> {
    if (request.mutationId === response.mutationId) return;
    const receiptRef = db.collection('users').doc(uid)
        .collection('trainingPlanState').doc('current')
        .collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(request.mutationId);
    await db.runTransaction(async (transaction) => {
        const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (deletionGuard.shouldSkip) {
            throw new TrainingScheduleMutationError(
                'failed-precondition',
                'This account is being deleted or is no longer available.',
            );
        }
        const snapshot = await transaction.get(receiptRef);
        if (snapshot.exists) {
            const receipt = documentData(snapshot);
            if (receipt.requestHash !== requestHash || !valuesEqual(receipt.response, response)) {
                throw new TrainingScheduleMutationError(
                    'failed-precondition',
                    'This mutation ID was already used differently.',
                );
            }
            return;
        }
        transaction.create(receiptRef, {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            requestHash,
            response,
            createdAtMs: nowMs,
            expireAt: Timestamp.fromMillis(nowMs + DELETE_PLAN_RECEIPT_RETENTION_MS),
        });
    });
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
    transactionPrecondition?: PlanDeletionTransactionPrecondition,
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
        await transactionPrecondition?.(transaction);
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
        snapshot.strengthDetails = await readStrengthDetailsForPlanWorkouts(transaction, workoutsRef, snapshot.workouts);
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
        stageTrainingDeliveryReconciliation(transaction, db, uid);
        if (lock.removePastProviderCopies) {
            stagePastPlanCleanup(transaction, db, uid, request.planId,
                lock.workouts.map(workout => workout.id), lock.mutationId, lock.createdAtMs);
        }
        retireTrainingPlanDeliverySettings(transaction, db, uid, request.planId);
        transaction.set(stateRef, applied.after.state);
        if (request.workoutDisposition === 'convert-to-standalone') {
            applied.convertedWorkouts.forEach((workout) => transaction.update(workoutsRef.doc(workout.id), {
                planId: null,
                revision: workout.revision,
                updatedAtMs: workout.updatedAtMs,
            }));
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
        transaction.create(trainingCleanupJobRef(db, uid, 'plan', request.planId), trainingCleanupJob(
            'plan', request.planId, lock.mutationId, lock.createdAtMs, applied.response,
        ));
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

export async function cleanupDeletedPlanData(
    db: admin.firestore.Firestore,
    uid: string,
    response: DeleteTrainingPlanResponseV1,
    nowMs: number,
): Promise<void> {
    const shouldSkip = await db.runTransaction(async transaction => (
        await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)
    )).then(guard => guard.shouldSkip);
    if (shouldSkip) return;
    const userRef = db.collection('users').doc(uid);
    const workoutsRef = userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID);
    await db.recursiveDelete(userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(response.removedPlanId));
    const cleanupWorkoutPage = async (workoutIds: string[]): Promise<void> => {
        if (workoutIds.length === 0) return;
        await prepareResidualWorkoutCleanupJobs(
            db, uid, response.removedPlanId, workoutIds, response.mutationId,
            response.state.updatedAtMs, nowMs,
        );
        // Stage durable child jobs before removing roots. Once a root disappears,
        // a later planId query cannot rediscover its revision subcollections.
        await recursivelyDeleteInChunks(db, workoutIds.map(id => (
            userRef.collection(TRAINING_WORKOUT_COMPLETIONS_COLLECTION_ID).doc(id)
        )));
        await recursivelyDeleteInChunks(db, workoutIds.map(id => workoutsRef.doc(id)));
    };
    await cleanupWorkoutPage(response.permanentlyDeletedWorkoutIds);
    // Deleted history is not subject to the 400-current-workout ceiling. Consume
    // and remove the first bounded page repeatedly instead of retaining an
    // unbounded planId query result or relying on a moving deletion cursor.
    while (true) {
        const residual = await workoutsRef.where('planId', '==', response.removedPlanId)
            .limit(RESIDUAL_WORKOUT_CLEANUP_PAGE_SIZE).get();
        if (residual.empty) break;
        await cleanupWorkoutPage(residual.docs.map(snapshot => snapshot.id));
    }

    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const lockRef = stateRef.collection(TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID).doc(response.removedPlanId);
    await db.runTransaction(async (transaction) => {
        const deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs);
        if (deletionGuard.shouldSkip) return;
        const lockSnapshot = await transaction.get(lockRef);
        if (!lockSnapshot.exists) return;
        const lock = parsePlanDeletionLock(documentData(lockSnapshot));
        if (lock.mutationId !== response.mutationId) {
            throw new TrainingScheduleMutationError(
                'failed-precondition',
                'A different plan deletion owns the cleanup lock.',
            );
        }
        transaction.delete(lockRef);
    });
}

export async function deleteTrainingPlanForUser(
    uid: string,
    request: DeleteTrainingPlanRequestV1,
    options: {
        db?: admin.firestore.Firestore;
        nowMs?: number;
        transactionPrecondition?: PlanDeletionTransactionPrecondition;
    } = {},
): Promise<DeleteTrainingPlanResponseV1> {
    const db = options.db ?? admin.firestore();
    const nowMs = options.nowMs ?? Date.now();
    const requestHash = hashTrainingScheduleRequestPayload(request);
    const lockResult = await ensurePlanDeletionLock(
        db,
        uid,
        request,
        requestHash,
        nowMs,
        options.transactionPrecondition,
    );
    try {
        const response = lockResult.kind === 'completed'
            ? lockResult.response
            : await (async () => {
                await preparePlanDeletionTombstones(
                    db,
                    uid,
                    lockResult.lock,
                    nowMs,
                    options.transactionPrecondition,
                );
                await prepareStandaloneRevisionSnapshots(
                    db,
                    uid,
                    lockResult.lock,
                    nowMs,
                    options.transactionPrecondition,
                );
                const lockedRequest: DeleteTrainingPlanRequestV1 = {
                    ...request,
                    mutationId: lockResult.lock.mutationId,
                    workoutDisposition: lockResult.lock.workoutDisposition,
                    ...(lockResult.lock.removePastProviderCopies ? { removePastProviderCopies: true } : {}),
                };
                return finalizePlanDeletion(
                    db,
                    uid,
                    lockedRequest,
                    lockResult.lock.requestHash,
                    lockResult.lock,
                    nowMs,
                    options.transactionPrecondition,
                );
            })();
        await persistPlanDeletionResumeReceipt(db, uid, request, requestHash, response, nowMs);
        await cleanupDeletedPlanData(db, uid, response, nowMs);
        await finishTrainingCleanupJob(db, uid, 'plan', response.removedPlanId, response.mutationId, nowMs);
        return response;
    } catch (error) {
        // Once the lock lookup succeeds, either a resumable lock or the
        // canonical completion receipt exists. The caller must retain a retry
        // path instead of recording a terminal failure while cleanup remains.
        if (error instanceof TrainingPlanDeletionResumeRequiredError) throw error;
        throw new TrainingPlanDeletionResumeRequiredError(error);
    }
}
