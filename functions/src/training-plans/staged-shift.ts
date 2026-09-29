import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
    SCHEDULED_WORKOUTS_COLLECTION_ID,
    TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID,
    TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID,
    TRAINING_PLAN_REVISIONS_COLLECTION_ID,
    TRAINING_PLAN_SCHEMA_VERSION,
    TRAINING_PLANS_COLLECTION_ID,
    parseMutateTrainingScheduleRequestV1,
    parseTrainingPlanStateV1,
    parseTrainingPlanV1,
    type MutateTrainingScheduleRequestV1,
    type MutateTrainingScheduleResponseV1,
} from '../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { stageTrainingDeliveryReconciliation } from './delivery/marker';
import { TrainingScheduleMutationError, applyTrainingScheduleMutation } from './mutation';
import {
    TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID,
    buildTrainingScheduleRevisionWrites,
    hashTrainingScheduleMutationRequest,
    hashTrainingScheduleRequestPayload,
    parseStoredMutationResponse,
    readTrainingScheduleSnapshotInTransaction,
    trainingPlanRevisionChunkDocumentId,
    trainingScheduleRevisionDocumentId,
    type TrainingScheduleMutationOptions,
    type TrainingPlanRevisionChunkDocumentV1,
} from './persistence';

// Existing mutation/restore/plan-deletion paths already check this collection.
// A child of an absent revision envelope stays invisible to history readers.
export const BULK_SHIFT_LOCK_ID = '_bulk_shift';
const SHIFT_INTENT_RECEIPT_PREFIX = '_shift_intent_';
const STAGE_WRITE_BYTES = 2 * 1024 * 1024;
const STAGE_WRITES = 10;
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const BULK_SHIFT_LEASE_MS = 7 * 60 * 1000;
const MAX_REPLACEMENT_IDS = 8;

interface ReceiptAliasV1 {
    mutationId: string;
    requestHash: string;
}

export interface BulkShiftLockV1 {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    kind: 'shift-plan';
    mutationId: string;
    requestHash: string;
    intentHash: string;
    receiptAliases: ReceiptAliasV1[];
    planId: string;
    stateRevision: number;
    planRevision: number;
    createdAtMs: number;
    nextAttemptAtMs: number;
    attempts: number;
    request: MutateTrainingScheduleRequestV1;
}

export function readBulkShiftLock(value: unknown): BulkShiftLockV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bulk shift lock.');
    const lock = value as Partial<BulkShiftLockV1>;
    if (lock.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION || lock.kind !== 'shift-plan'
        || typeof lock.mutationId !== 'string' || typeof lock.requestHash !== 'string'
        || typeof lock.intentHash !== 'string' || !Array.isArray(lock.receiptAliases)
        || lock.receiptAliases.length > MAX_REPLACEMENT_IDS
        || lock.receiptAliases.some(alias => !alias || typeof alias.mutationId !== 'string'
            || typeof alias.requestHash !== 'string')
        || typeof lock.planId !== 'string' || !Number.isSafeInteger(lock.stateRevision)
        || !Number.isSafeInteger(lock.planRevision) || !Number.isSafeInteger(lock.createdAtMs)
        || !Number.isSafeInteger(lock.nextAttemptAtMs) || !Number.isSafeInteger(lock.attempts)
        || lock.stateRevision! < 0 || lock.planRevision! < 0 || lock.createdAtMs! < 0
        || lock.nextAttemptAtMs! < 0 || lock.attempts! < 0
        || new Set([lock.mutationId, ...lock.receiptAliases.map(alias => alias.mutationId)]).size
            !== lock.receiptAliases.length + 1) {
        throw new Error('Invalid bulk shift lock.');
    }
    const request = parseMutateTrainingScheduleRequestV1(lock.request);
    if (request.operation.kind !== 'shift-plan' || request.mutationId !== lock.mutationId
        || request.operation.planId !== lock.planId
        || hashTrainingScheduleMutationRequest(request) !== lock.requestHash
        || shiftIntentHash(request) !== lock.intentHash
        || lock.receiptAliases.some(alias => hashTrainingScheduleMutationRequest({
            ...request, mutationId: alias.mutationId,
        }) !== alias.requestHash)) {
        throw new Error('Invalid bulk shift lock request.');
    }
    return lock as BulkShiftLockV1;
}

function shiftIntentHash(request: MutateTrainingScheduleRequestV1): string {
    return hashTrainingScheduleRequestPayload({
        operation: request.operation,
        expectedRevisions: [...request.expectedRevisions].sort((left, right) =>
            `${left.scope}:${left.id}`.localeCompare(`${right.scope}:${right.id}`)),
    });
}

function requireLock(value: unknown, request: MutateTrainingScheduleRequestV1): BulkShiftLockV1 {
    const lock = readBulkShiftLock(value);
    const requestHash = hashTrainingScheduleMutationRequest(request);
    const ownsReceipt = (lock.mutationId === request.mutationId && lock.requestHash === requestHash)
        || lock.receiptAliases.some(alias => alias.mutationId === request.mutationId && alias.requestHash === requestHash);
    if (request.operation.kind !== 'shift-plan' || !ownsReceipt || lock.intentHash !== shiftIntentHash(request)
        || lock.planId !== request.operation.planId) {
        throw new TrainingScheduleMutationError(
            'failed-precondition',
            'Another Training change is in progress. Retry it before starting a different change.',
        );
    }
    return lock;
}

function stageGroups(chunks: readonly TrainingPlanRevisionChunkDocumentV1[]): TrainingPlanRevisionChunkDocumentV1[][] {
    const groups: TrainingPlanRevisionChunkDocumentV1[][] = [];
    let group: TrainingPlanRevisionChunkDocumentV1[] = [];
    let bytes = 0;
    for (const chunk of chunks) {
        const nextBytes = Buffer.byteLength(JSON.stringify(chunk), 'utf8') + 1024;
        if (nextBytes > STAGE_WRITE_BYTES) throw new TrainingScheduleMutationError('limit-exceeded', 'A Training history chunk is too large to stage.');
        if (group.length > 0 && (group.length >= STAGE_WRITES || bytes + nextBytes > STAGE_WRITE_BYTES)) {
            groups.push(group);
            group = [];
            bytes = 0;
        }
        group.push(chunk);
        bytes += nextBytes;
    }
    if (group.length > 0) groups.push(group);
    return groups;
}

/** Stage only immutable history children; current plan/workout roots change in one final transaction. */
async function stageLargeTrainingPlanShiftInternal(
    uid: string,
    request: MutateTrainingScheduleRequestV1,
    options: TrainingScheduleMutationOptions = {},
): Promise<MutateTrainingScheduleResponseV1> {
    if (request.operation.kind !== 'shift-plan') {
        throw new TrainingScheduleMutationError('failed-precondition', 'Only a plan shift can use staged history.');
    }
    const db = options.db ?? admin.firestore();
    const nowMs = options.nowMs ?? Date.now();
    const userRef = db.collection('users').doc(uid);
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const locksRef = stateRef.collection(TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID);
    const lockRef = locksRef.doc(BULK_SHIFT_LOCK_ID);
    const planRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(request.operation.planId);
    const receiptRef = stateRef.collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(request.mutationId);
    const requestHash = hashTrainingScheduleMutationRequest(request);
    const intentHash = shiftIntentHash(request);
    const intentReceiptRef = stateRef.collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID)
        .doc(`${SHIFT_INTENT_RECEIPT_PREFIX}${intentHash}`);

    const acquired = await db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
            throw new TrainingScheduleMutationError('failed-precondition', 'This account is being deleted or is no longer available.');
        }
        const [receipt, intentReceipt, locks, state, plan] = await Promise.all([
            transaction.get(receiptRef), transaction.get(intentReceiptRef), transaction.get(locksRef),
            transaction.get(stateRef), transaction.get(planRef),
        ]);
        if (receipt.exists) {
            const value = receipt.data();
            if (value?.requestHash !== requestHash) throw new TrainingScheduleMutationError('failed-precondition', 'This mutation ID was already used differently.');
            return { kind: 'completed' as const, response: parseStoredMutationResponse(value.response) };
        }
        if (intentReceipt.exists) {
            const value = intentReceipt.data();
            if (value?.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION || value.kind !== 'shift-intent'
                || value.intentHash !== intentHash) throw new Error('Invalid staged shift intent receipt.');
            const response = parseStoredMutationResponse(value.response);
            const receivedAtMs = Math.max(Date.now(), nowMs);
            transaction.create(receiptRef, {
                schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
                requestHash, response, createdAtMs: receivedAtMs,
                expireAt: Timestamp.fromMillis(receivedAtMs + RECEIPT_RETENTION_MS),
            });
            return { kind: 'completed' as const, response };
        }
        if (locks.docs.some(snapshot => snapshot.id !== BULK_SHIFT_LOCK_ID)) {
            throw new TrainingScheduleMutationError('failed-precondition', 'Another Training plan operation is in progress. Retry after it finishes.');
        }
        const existing = locks.docs.find(snapshot => snapshot.id === BULK_SHIFT_LOCK_ID);
        if (existing) {
            const lock = readBulkShiftLock(existing.data());
            if (request.operation.kind !== 'shift-plan' || lock.intentHash !== shiftIntentHash(request)
                || lock.planId !== request.operation.planId) {
                throw new TrainingScheduleMutationError('failed-precondition', 'Another Training change is in progress. Retry it before starting a different change.');
            }
            if (lock.mutationId === request.mutationId && lock.requestHash !== requestHash) {
                throw new TrainingScheduleMutationError('failed-precondition', 'This mutation ID was already used differently.');
            }
            const alias = lock.receiptAliases.find(item => item.mutationId === request.mutationId);
            if (alias && alias.requestHash !== requestHash) {
                throw new TrainingScheduleMutationError('failed-precondition', 'This mutation ID was already used differently.');
            }
            if (lock.mutationId === request.mutationId || alias) return { kind: 'locked' as const, lock };
            if (lock.receiptAliases.length >= MAX_REPLACEMENT_IDS) {
                throw new TrainingScheduleMutationError('limit-exceeded', 'This staged shift has too many retry IDs. Retry an earlier shift request.');
            }
            const updated: BulkShiftLockV1 = { ...lock,
                receiptAliases: [...lock.receiptAliases, { mutationId: request.mutationId, requestHash }] };
            transaction.update(existing.ref, { receiptAliases: updated.receiptAliases });
            return { kind: 'locked' as const, lock: updated };
        }
        if (!state.exists || !plan.exists) throw new TrainingScheduleMutationError('not-found', 'The Training plan is unavailable.');
        const currentState = parseTrainingPlanStateV1(state.data());
        const currentPlan = parseTrainingPlanV1(plan.data());
        if (request.expectedRevisions.find(item => item.scope === 'state' && item.id === 'current')?.revision !== currentState.revision
            || request.expectedRevisions.find(item => item.scope === 'plan' && item.id === currentPlan.id)?.revision !== currentPlan.revision) {
            throw new TrainingScheduleMutationError('revision-conflict', 'The Training plan changed before the shift could start.');
        }
        const lock: BulkShiftLockV1 = {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            kind: 'shift-plan', mutationId: request.mutationId, requestHash,
            intentHash, receiptAliases: [],
            planId: currentPlan.id, stateRevision: currentState.revision, planRevision: currentPlan.revision,
            createdAtMs: nowMs, nextAttemptAtMs: nowMs + BULK_SHIFT_LEASE_MS, attempts: 0,
            request,
        };
        transaction.create(lockRef, lock);
        return { kind: 'locked' as const, lock };
    });
    if (acquired.kind === 'completed') return acquired.response;
    const lock = acquired.lock;
    const canonicalRequest = { ...request, mutationId: lock.mutationId };

    const prepared = await db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
            throw new TrainingScheduleMutationError('failed-precondition', 'This account is being deleted or is no longer available.');
        }
        const currentLock = await transaction.get(lockRef);
        if (!currentLock.exists) throw new TrainingScheduleMutationError('failed-precondition', 'The staged Training shift is unavailable.');
        requireLock(currentLock.data(), request);
        const snapshot = await readTrainingScheduleSnapshotInTransaction(transaction, userRef, [canonicalRequest]);
        const applied = applyTrainingScheduleMutation(snapshot, canonicalRequest, lock.createdAtMs);
        if (snapshot.state.revision !== lock.stateRevision
            || snapshot.plans.get(lock.planId)?.revision !== lock.planRevision) {
            throw new TrainingScheduleMutationError('revision-conflict', 'The Training plan changed while its shift was being staged.');
        }
        const revisions = buildTrainingScheduleRevisionWrites(applied, canonicalRequest, lock.createdAtMs, true);
        return { applied, revisions };
    });
    const revision = prepared.revisions.planRevisions.get(lock.planId);
    if (!revision || prepared.applied.affectedPlanIds.length !== 1) {
        throw new TrainingScheduleMutationError('failed-precondition', 'The staged Training shift has an invalid revision.');
    }
    const revisionRef = planRef.collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
        .doc(trainingScheduleRevisionDocumentId(revision.revision));
    for (const group of stageGroups(prepared.revisions.planRevisionChunks.get(lock.planId) ?? [])) {
        await db.runTransaction(async transaction => {
            if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
                throw new TrainingScheduleMutationError('failed-precondition', 'This account is being deleted or is no longer available.');
            }
            const currentLock = await transaction.get(lockRef);
            if (!currentLock.exists) throw new TrainingScheduleMutationError('failed-precondition', 'The staged Training shift is unavailable.');
            requireLock(currentLock.data(), request);
            const refs = group.map(chunk => revisionRef.collection(TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID)
                .doc(trainingPlanRevisionChunkDocumentId(chunk.kind, chunk.chunkIndex)));
            const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
            group.forEach((chunk, index) => {
                if (snapshots[index].exists) {
                    if (hashTrainingScheduleRequestPayload(snapshots[index].data()) !== hashTrainingScheduleRequestPayload(chunk)) {
                        throw new TrainingScheduleMutationError('failed-precondition', 'Staged Training history differs from this retry.');
                    }
                } else {
                    transaction.create(refs[index], chunk);
                }
            });
            transaction.update(lockRef, { nextAttemptAtMs: Math.max(Date.now(), nowMs) + BULK_SHIFT_LEASE_MS });
        });
    }

    return db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
            throw new TrainingScheduleMutationError('failed-precondition', 'This account is being deleted or is no longer available.');
        }
        const [currentLock, receipt, state, plan] = await Promise.all([
            transaction.get(lockRef), transaction.get(receiptRef), transaction.get(stateRef), transaction.get(planRef),
        ]);
        if (receipt.exists) {
            const value = receipt.data();
            if (value?.requestHash !== requestHash) throw new TrainingScheduleMutationError('failed-precondition', 'This mutation ID was already used differently.');
            return parseStoredMutationResponse(value.response);
        }
        if (!currentLock.exists) throw new TrainingScheduleMutationError('failed-precondition', 'The staged Training shift is unavailable.');
        const finalLock = requireLock(currentLock.data(), request);
        if (!state.exists || !plan.exists
            || parseTrainingPlanStateV1(state.data()).revision !== lock.stateRevision
            || parseTrainingPlanV1(plan.data()).revision !== lock.planRevision) {
            throw new TrainingScheduleMutationError('revision-conflict', 'The Training plan changed while its shift was staged.');
        }
        const after = prepared.applied.after;
        transaction.set(stateRef, after.state);
        transaction.set(planRef, after.plans.get(lock.planId)!);
        for (const workoutId of prepared.applied.changedWorkoutIds) {
            const workout = after.workouts.get(workoutId)!;
            transaction.update(userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(workoutId), {
                localDate: workout.localDate, revision: workout.revision, updatedAtMs: workout.updatedAtMs,
            });
        }
        transaction.create(revisionRef, revision);
        const committedAtMs = Math.max(Date.now(), nowMs);
        transaction.create(intentReceiptRef, {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
            kind: 'shift-intent', intentHash: finalLock.intentHash,
            response: prepared.applied.response,
            createdAtMs: committedAtMs,
            expireAt: Timestamp.fromMillis(committedAtMs + RECEIPT_RETENTION_MS),
        });
        for (const alias of [{ mutationId: finalLock.mutationId, requestHash: finalLock.requestHash },
            ...finalLock.receiptAliases]) {
            transaction.create(stateRef.collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(alias.mutationId), {
                schemaVersion: TRAINING_PLAN_SCHEMA_VERSION,
                requestHash: alias.requestHash,
                response: prepared.applied.response,
                createdAtMs: committedAtMs,
                expireAt: Timestamp.fromMillis(committedAtMs + RECEIPT_RETENTION_MS),
            });
        }
        stageTrainingDeliveryReconciliation(transaction, db, uid);
        transaction.delete(lockRef); // A lock is a leaf; its staged chunks live under the revision.
        return prepared.applied.response;
    });
}

/** A competing retry may commit after this invocation has read the lock. Resolve that race by its exact receipt. */
export async function stageLargeTrainingPlanShiftForUser(
    uid: string,
    request: MutateTrainingScheduleRequestV1,
    options: TrainingScheduleMutationOptions = {},
): Promise<MutateTrainingScheduleResponseV1> {
    const db = options.db ?? admin.firestore();
    try {
        return await stageLargeTrainingPlanShiftInternal(uid, request, { ...options, db });
    } catch (error) {
        try {
            const receiptRef = db.collection('users').doc(uid).collection('trainingPlanState').doc('current')
                .collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(request.mutationId);
            const response = await db.runTransaction(async transaction => {
                if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, Date.now())).shouldSkip) return null;
                const receipt = await transaction.get(receiptRef);
                if (!receipt.exists || receipt.data()?.requestHash !== hashTrainingScheduleMutationRequest(request)) return null;
                return parseStoredMutationResponse(receipt.data()?.response);
            });
            if (response) return response;
        } catch {
            // Preserve the original failure when the confirmation read is unavailable or malformed.
        }
        throw error;
    }
}
