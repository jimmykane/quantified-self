import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
    SCHEDULED_WORKOUTS_COLLECTION_ID,
    TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID,
    TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID,
    TRAINING_PLAN_REVISIONS_COLLECTION_ID,
    TRAINING_PLAN_SCHEMA_VERSION,
    TRAINING_PLANS_COLLECTION_ID,
    parseScheduledWorkoutV1,
    parseTrainingPlanStateV1,
    parseTrainingPlanV1,
    type RestoreTrainingScheduleRevisionRequestV1,
    type RestoreTrainingScheduleRevisionResponseV1,
    type ScheduledWorkoutV1,
    type TrainingPlanStateV1,
    type TrainingPlanV1,
} from '../../../shared/training-plans';
import {
    STRENGTH_DETAILS_COLLECTION_ID,
    STRENGTH_DETAILS_DOCUMENT_ID,
    parseStrengthWorkoutDetailsV1,
    type StrengthWorkoutDetailsV1,
} from '../../../shared/strength-workout';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { invalidateTrainingWorkoutConsent, stageTrainingDeliveryReconciliation } from './delivery/marker';
import { readPlanSnapshotAtRevision } from './history';
import { TrainingScheduleMutationError } from './mutation';
import {
    TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID,
    buildTrainingScheduleRevisionWrites,
    hashTrainingScheduleRequestPayload,
    trainingPlanRevisionChunkDocumentId,
    trainingScheduleRevisionDocumentId,
    type TrainingPlanRevisionDocumentV1,
} from './persistence';
import {
    applyPlanRevisionRestore,
    parseRestoreTrainingScheduleRevisionRequest,
    parseStoredRestoreResponse,
    readCurrentScheduleForRestore,
} from './restore';

export const BULK_RESTORE_LOCK_ID = '_bulk_restore';
export const BULK_RESTORE_AVAILABILITY_COLLECTION_ID = 'availability';
export const BULK_RESTORE_AVAILABILITY_DOCUMENT_ID = 'restore';
export const BULK_RESTORE_LEASE_MS = 7 * 60 * 1000;
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ALIASES = 8;
const STAGE_GROUP_BYTES = 2 * 1024 * 1024;
const APPLY_GROUP_SIZE = 8;
const HASH = /^[a-f0-9]{64}$/;
const INTENT_PREFIX = '_restore_intent_';

interface RestoreAlias { mutationId: string; requestHash: string }
interface RestorePlanRevision { planId: string; value: TrainingPlanRevisionDocumentV1 }

export interface BulkRestoreLockV1 {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    kind: 'restore-plan';
    phase: 'staging' | 'applying';
    request: RestoreTrainingScheduleRevisionRequestV1;
    requestHash: string;
    intentHash: string;
    aliases: RestoreAlias[];
    planId: string;
    stateRevision: number;
    planRevision: number;
    createdAtMs: number;
    nextAttemptAtMs: number;
    attempts: number;
    nextIndex: number;
    changedWorkoutIds?: string[];
    afterState?: TrainingPlanStateV1;
    afterPlans?: TrainingPlanV1[];
    revisions?: RestorePlanRevision[];
    response?: RestoreTrainingScheduleRevisionResponseV1;
}

interface StagedWorkout {
    schemaVersion: typeof TRAINING_PLAN_SCHEMA_VERSION;
    workoutId: string;
    beforeHash: string;
    after: ScheduledWorkoutV1;
    strengthBeforeHash: string | null;
    strengthAfter?: StrengthWorkoutDetailsV1;
    invalidateConsent: boolean;
}

function fail(message: string, code: 'failed-precondition' | 'revision-conflict' = 'failed-precondition'): never {
    throw new TrainingScheduleMutationError(code, message);
}

export function stagedRestoreIntentHash(request: RestoreTrainingScheduleRevisionRequestV1): string {
    return hashTrainingScheduleRequestPayload({
        scope: request.scope,
        targetRevision: request.targetRevision,
        expectedRevisions: [...request.expectedRevisions].sort((a, b) =>
            `${a.scope}:${a.id}`.localeCompare(`${b.scope}:${b.id}`)),
    });
}

export function readBulkRestoreLock(value: unknown): BulkRestoreLockV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bulk restore lock.');
    const lock = value as Partial<BulkRestoreLockV1>;
    if (lock.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION || lock.kind !== 'restore-plan'
        || (lock.phase !== 'staging' && lock.phase !== 'applying')
        || !lock.request || typeof lock.requestHash !== 'string' || !HASH.test(lock.requestHash)
        || typeof lock.intentHash !== 'string' || !HASH.test(lock.intentHash)
        || !Array.isArray(lock.aliases) || lock.aliases.length > MAX_ALIASES
        || lock.aliases.some(alias => !alias || typeof alias.mutationId !== 'string'
            || typeof alias.requestHash !== 'string' || !HASH.test(alias.requestHash))
        || typeof lock.planId !== 'string' || !Number.isSafeInteger(lock.stateRevision)
        || !Number.isSafeInteger(lock.planRevision) || !Number.isSafeInteger(lock.createdAtMs)
        || !Number.isSafeInteger(lock.nextAttemptAtMs) || !Number.isSafeInteger(lock.attempts)
        || !Number.isSafeInteger(lock.nextIndex) || lock.stateRevision! < 0 || lock.planRevision! < 0
        || lock.createdAtMs! < 0 || lock.nextAttemptAtMs! < 0 || lock.attempts! < 0 || lock.nextIndex! < 0) {
        throw new Error('Invalid bulk restore lock.');
    }
    const request = parseRestoreTrainingScheduleRevisionRequest(lock.request);
    if (request.scope.kind !== 'plan' || request.scope.id !== lock.planId
        || hashTrainingScheduleRequestPayload(request) !== lock.requestHash
        || stagedRestoreIntentHash(request) !== lock.intentHash
        || new Set([request.mutationId, ...lock.aliases.map(alias => alias.mutationId)]).size !== lock.aliases.length + 1) {
        throw new Error('Invalid bulk restore lock request.');
    }
    if (lock.phase === 'applying' && (!Array.isArray(lock.changedWorkoutIds)
        || lock.changedWorkoutIds.some(id => typeof id !== 'string')
        || lock.nextIndex! > lock.changedWorkoutIds.length || !lock.afterState
        || !Array.isArray(lock.afterPlans) || !Array.isArray(lock.revisions) || !lock.response)) {
        throw new Error('Incomplete bulk restore lock.');
    }
    return lock as BulkRestoreLockV1;
}

function requireOwnedLock(value: unknown, request: RestoreTrainingScheduleRevisionRequestV1): BulkRestoreLockV1 {
    const lock = readBulkRestoreLock(value);
    const hash = hashTrainingScheduleRequestPayload(request);
    if (lock.intentHash !== stagedRestoreIntentHash(request)
        || !(lock.request.mutationId === request.mutationId && lock.requestHash === hash)
            && !lock.aliases.some(alias => alias.mutationId === request.mutationId && alias.requestHash === hash)) {
        fail('Another Training change is in progress. Retry it before starting a different change.');
    }
    return lock;
}

function groupByBytes<T>(values: T[], maxCount: number): T[][] {
    const groups: T[][] = [];
    let group: T[] = [];
    let size = 0;
    for (const value of values) {
        const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8') + 1024;
        if (bytes > STAGE_GROUP_BYTES) fail('One Training restore record is too large to stage.');
        if (group.length && (group.length >= maxCount || size + bytes > STAGE_GROUP_BYTES)) {
            groups.push(group);
            group = [];
            size = 0;
        }
        group.push(value);
        size += bytes;
    }
    if (group.length) groups.push(group);
    return groups;
}

function receipt(uid: string, db: admin.firestore.Firestore, mutationId: string): admin.firestore.DocumentReference {
    return db.collection('users').doc(uid).collection('trainingPlanState').doc('current')
        .collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(mutationId);
}

async function completedReceipt(
    uid: string, db: admin.firestore.Firestore, request: RestoreTrainingScheduleRevisionRequestV1,
): Promise<RestoreTrainingScheduleRevisionResponseV1 | null> {
    return db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, Date.now())).shouldSkip) return null;
        const snapshot = await transaction.get(receipt(uid, db, request.mutationId));
        if (!snapshot.exists) return null;
        if (snapshot.data()?.requestHash !== hashTrainingScheduleRequestPayload(request)) {
            fail('This mutation ID was already used differently.');
        }
        return parseStoredRestoreResponse(snapshot.data()?.response);
    });
}

/** Staging records are leaves under a missing revision envelope, so history never sees them. */
async function stageRestore(
    uid: string, db: admin.firestore.Firestore, request: RestoreTrainingScheduleRevisionRequestV1,
    lockRef: admin.firestore.DocumentReference, initialLock: BulkRestoreLockV1, nowMs: number,
): Promise<void> {
    const planId = initialLock.planId;
    const userRef = db.collection('users').doc(uid);
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const desired = await readPlanSnapshotAtRevision(db, uid, planId, initialLock.request.targetRevision);
    const prepared = await db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
            fail('This account is being deleted or is no longer available.');
        }
        const currentLock = await transaction.get(lockRef);
        if (!currentLock.exists) fail('The staged Training restore is unavailable.');
        const lock = requireOwnedLock(currentLock.data(), request);
        if (lock.phase === 'applying') return null;
        const snapshot = await readCurrentScheduleForRestore(transaction, userRef, [...desired.workouts.keys()]);
        if (snapshot.state.revision !== lock.stateRevision
            || snapshot.plans.get(planId)?.revision !== lock.planRevision) {
            fail('The Training plan changed while its restore was staged.', 'revision-conflict');
        }
        const restored = applyPlanRevisionRestore(snapshot, desired, lock.request, lock.createdAtMs);
        const revisions = buildTrainingScheduleRevisionWrites(restored.applied, {
            mutationId: lock.request.mutationId, operation: { kind: 'restore-plan-revision' },
        }, lock.createdAtMs, true);
        const workouts: StagedWorkout[] = [...restored.applied.changedWorkoutIds].sort().map(workoutId => {
            const before = restored.applied.before.workouts.get(workoutId)!;
            const after = restored.applied.after.workouts.get(workoutId)!;
            const strengthBefore = restored.applied.before.strengthDetails?.get(workoutId);
            const strengthAfter = restored.applied.after.strengthDetails?.get(workoutId);
            return {
                schemaVersion: TRAINING_PLAN_SCHEMA_VERSION, workoutId,
                beforeHash: hashTrainingScheduleRequestPayload(before), after,
                strengthBeforeHash: strengthBefore ? hashTrainingScheduleRequestPayload(strengthBefore) : null,
                ...(strengthAfter && JSON.stringify(strengthBefore) !== JSON.stringify(strengthAfter)
                    ? { strengthAfter } : {}),
                invalidateConsent: before.planId !== after.planId || after.lifecycle === 'deleted',
            };
        });
        // A full 400-prescription response can exceed a single Firestore
        // document (and callable) limit. The schedule listener supplies the
        // authoritative recipes after the final publish transaction.
        const response: RestoreTrainingScheduleRevisionResponseV1 = {
            ...restored.response,
            mutation: { ...restored.response.mutation, workouts: [], workoutsDeferred: true },
        };
        return { restored, revisions, workouts, response };
    });
    if (!prepared) return;
    const revisionRefs = [...prepared.revisions.planRevisions.entries()].map(([id, value]) => ({
        planId: id, value,
        ref: userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(id)
            .collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID).doc(trainingScheduleRevisionDocumentId(value.revision)),
    }));
    const planRevisionRef = revisionRefs.find(item => item.planId === planId)?.ref;
    if (!planRevisionRef) fail('The staged Training restore has no plan revision.');
    for (const revision of revisionRefs) {
        const chunks = prepared.revisions.planRevisionChunks.get(revision.planId) ?? [];
        for (const group of groupByBytes(chunks, 10)) {
            await db.runTransaction(async transaction => {
                if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
                    fail('This account is being deleted or is no longer available.');
                }
                const currentLock = await transaction.get(lockRef);
                if (!currentLock.exists || requireOwnedLock(currentLock.data(), request).phase !== 'staging') {
                    fail('The staged Training restore changed while staging history.');
                }
                const refs = group.map(chunk => revision.ref.collection(TRAINING_PLAN_REVISION_CHUNKS_COLLECTION_ID)
                    .doc(trainingPlanRevisionChunkDocumentId(chunk.kind, chunk.chunkIndex)));
                const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
                group.forEach((chunk, index) => {
                    if (snapshots[index].exists) {
                        if (hashTrainingScheduleRequestPayload(snapshots[index].data()) !== hashTrainingScheduleRequestPayload(chunk)) {
                            fail('Staged Training history differs from this retry.');
                        }
                    } else transaction.create(refs[index], chunk);
                });
                transaction.update(lockRef, { nextAttemptAtMs: Math.max(Date.now(), nowMs) + BULK_RESTORE_LEASE_MS });
            });
        }
    }
    for (const group of groupByBytes(prepared.workouts, APPLY_GROUP_SIZE)) {
        await db.runTransaction(async transaction => {
            if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
                fail('This account is being deleted or is no longer available.');
            }
            const currentLock = await transaction.get(lockRef);
            if (!currentLock.exists || requireOwnedLock(currentLock.data(), request).phase !== 'staging') {
                fail('The staged Training restore changed while staging workouts.');
            }
            const refs = group.map(item => planRevisionRef.collection('restoreStaging').doc(item.workoutId));
            const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
            group.forEach((item, index) => {
                if (snapshots[index].exists) {
                    if (hashTrainingScheduleRequestPayload(snapshots[index].data()) !== hashTrainingScheduleRequestPayload(item)) {
                        fail('Staged Training workouts differ from this retry.');
                    }
                } else transaction.create(refs[index], item);
            });
            transaction.update(lockRef, { nextAttemptAtMs: Math.max(Date.now(), nowMs) + BULK_RESTORE_LEASE_MS });
        });
    }
    await db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
            fail('This account is being deleted or is no longer available.');
        }
        const [currentLock, state, plan] = await Promise.all([
            transaction.get(lockRef), transaction.get(stateRef),
            transaction.get(userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(planId)),
        ]);
        if (!currentLock.exists) fail('The staged Training restore is unavailable.');
        const lock = requireOwnedLock(currentLock.data(), request);
        if (lock.phase === 'applying') return;
        if (!state.exists || !plan.exists || parseTrainingPlanStateV1(state.data()).revision !== lock.stateRevision
            || parseTrainingPlanV1(plan.data()).revision !== lock.planRevision) {
            fail('The Training plan changed while its restore was staged.', 'revision-conflict');
        }
        transaction.update(lockRef, {
            phase: 'applying', nextIndex: 0,
            changedWorkoutIds: prepared.workouts.map(item => item.workoutId),
            afterState: prepared.restored.applied.after.state,
            afterPlans: prepared.restored.applied.affectedPlanIds.map(id => prepared.restored.applied.after.plans.get(id)!),
            revisions: revisionRefs.map(({ planId: id, value }) => ({ planId: id, value })),
            response: prepared.response,
            nextAttemptAtMs: Math.max(Date.now(), nowMs) + BULK_RESTORE_LEASE_MS,
        });
    });
}

async function applyRestore(
    uid: string, db: admin.firestore.Firestore, request: RestoreTrainingScheduleRevisionRequestV1,
    lockRef: admin.firestore.DocumentReference, nowMs: number,
): Promise<RestoreTrainingScheduleRevisionResponseV1> {
    const userRef = db.collection('users').doc(uid);
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const availabilityRef = stateRef.collection(BULK_RESTORE_AVAILABILITY_COLLECTION_ID)
        .doc(BULK_RESTORE_AVAILABILITY_DOCUMENT_ID);
    const currentPlanRef = userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(request.scope.id);
    for (;;) {
        const progress = await db.runTransaction(async transaction => {
            if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
                fail('This account is being deleted or is no longer available.');
            }
            const currentLock = await transaction.get(lockRef);
            if (!currentLock.exists) fail('The staged Training restore is unavailable.');
            const lock = requireOwnedLock(currentLock.data(), request);
            if (lock.phase !== 'applying') fail('The staged Training restore is not ready to apply.');
            const ids = lock.changedWorkoutIds!.slice(lock.nextIndex, lock.nextIndex + APPLY_GROUP_SIZE);
            if (!ids.length) return false;
            const revisionRef = currentPlanRef.collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
                .doc(trainingScheduleRevisionDocumentId(lock.afterPlans!.find(plan => plan.id === lock.planId)!.revision));
            const stagedRefs = ids.map(id => revisionRef.collection('restoreStaging').doc(id));
            const workoutRefs = ids.map(id => userRef.collection(SCHEDULED_WORKOUTS_COLLECTION_ID).doc(id));
            const [staged, current] = await Promise.all([
                Promise.all(stagedRefs.map(ref => transaction.get(ref))),
                Promise.all(workoutRefs.map(ref => transaction.get(ref))),
            ]);
            const values = staged.map((snapshot, index) => {
                if (!snapshot.exists || !current[index].exists) fail('A staged Training workout is missing.');
                const item = snapshot.data() as StagedWorkout;
                if (item.workoutId !== ids[index] || item.schemaVersion !== TRAINING_PLAN_SCHEMA_VERSION
                    || !HASH.test(item.beforeHash) || hashTrainingScheduleRequestPayload(current[index].data()) !== item.beforeHash
                    || parseScheduledWorkoutV1(item.after).id !== ids[index]) {
                    fail('A Training workout changed while its restore was staged.');
                }
                return item;
            });
            const strengthRefs = values.map(item => workoutRefs[ids.indexOf(item.workoutId)]
                .collection(STRENGTH_DETAILS_COLLECTION_ID).doc(STRENGTH_DETAILS_DOCUMENT_ID));
            const strengths = await Promise.all(strengthRefs.map(ref => transaction.get(ref)));
            values.forEach((item, index) => {
                const actual = strengths[index].exists ? hashTrainingScheduleRequestPayload(strengths[index].data()) : null;
                // A non-strength current workout can retain an older companion
                // from a previous sport change. It is not its current recipe;
                // an incoming strength prescription overwrites it below.
                if (item.strengthBeforeHash !== null && actual !== item.strengthBeforeHash) {
                    fail('Strength details changed while restore was staged.');
                }
            });
            values.forEach((item, index) => {
                transaction.set(workoutRefs[index], item.after);
                if (item.strengthAfter) transaction.set(strengthRefs[index], parseStrengthWorkoutDetailsV1(item.strengthAfter));
                if (item.invalidateConsent) invalidateTrainingWorkoutConsent(transaction, db, uid, item.workoutId);
                // A staging document is a leaf. Its historical parent becomes visible only at final commit.
                transaction.delete(stagedRefs[index]);
            });
            transaction.update(lockRef, {
                nextIndex: lock.nextIndex + ids.length,
                nextAttemptAtMs: Math.max(Date.now(), nowMs) + BULK_RESTORE_LEASE_MS,
            });
            return true;
        });
        if (!progress) break;
    }
    return db.runTransaction(async transaction => {
        if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
            fail('This account is being deleted or is no longer available.');
        }
        const [currentLock, state, plan, existingReceipt] = await Promise.all([
            transaction.get(lockRef), transaction.get(stateRef), transaction.get(currentPlanRef),
            transaction.get(receipt(uid, db, request.mutationId)),
        ]);
        if (existingReceipt.exists) {
            if (existingReceipt.data()?.requestHash !== hashTrainingScheduleRequestPayload(request)) {
                fail('This mutation ID was already used differently.');
            }
            return parseStoredRestoreResponse(existingReceipt.data()?.response);
        }
        if (!currentLock.exists) fail('The staged Training restore is unavailable.');
        const lock = requireOwnedLock(currentLock.data(), request);
        if (lock.phase !== 'applying' || lock.nextIndex !== lock.changedWorkoutIds!.length) {
            fail('The staged Training restore has incomplete workout writes.');
        }
        if (!state.exists || !plan.exists || parseTrainingPlanStateV1(state.data()).revision !== lock.stateRevision
            || parseTrainingPlanV1(plan.data()).revision !== lock.planRevision) {
            fail('The Training plan changed while its restore was staged.', 'revision-conflict');
        }
        transaction.set(stateRef, parseTrainingPlanStateV1(lock.afterState));
        for (const afterPlan of lock.afterPlans!) {
            transaction.set(userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(afterPlan.id), parseTrainingPlanV1(afterPlan));
        }
        for (const revision of lock.revisions!) {
            transaction.create(userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(revision.planId)
                .collection(TRAINING_PLAN_REVISIONS_COLLECTION_ID)
                .doc(trainingScheduleRevisionDocumentId(revision.value.revision)), revision.value);
        }
        const committedAtMs = Math.max(Date.now(), nowMs);
        const response = parseStoredRestoreResponse(lock.response);
        const intentRef = receipt(uid, db, `${INTENT_PREFIX}${lock.intentHash}`);
        transaction.create(intentRef, {
            schemaVersion: TRAINING_PLAN_SCHEMA_VERSION, kind: 'restore-intent', intentHash: lock.intentHash,
            response, createdAtMs: committedAtMs,
            expireAt: Timestamp.fromMillis(committedAtMs + RECEIPT_RETENTION_MS),
        });
        for (const alias of [{ mutationId: lock.request.mutationId, requestHash: lock.requestHash }, ...lock.aliases]) {
            transaction.create(receipt(uid, db, alias.mutationId), {
                schemaVersion: TRAINING_PLAN_SCHEMA_VERSION, requestHash: alias.requestHash,
                response, createdAtMs: committedAtMs,
                expireAt: Timestamp.fromMillis(committedAtMs + RECEIPT_RETENTION_MS),
            });
        }
        stageTrainingDeliveryReconciliation(transaction, db, uid);
        transaction.delete(availabilityRef); // Public availability is a leaf.
        transaction.delete(lockRef); // The lock is a leaf; all staged workout leaves were consumed.
        return response;
    });
}

/** Full-prescription plan restores preserve v1 roots and hide chunked current writes until final commit. */
export async function stageLargeTrainingPlanRestoreForUser(
    uid: string, request: RestoreTrainingScheduleRevisionRequestV1,
    options: { db?: admin.firestore.Firestore; nowMs?: number } = {},
): Promise<RestoreTrainingScheduleRevisionResponseV1> {
    if (request.scope.kind !== 'plan') fail('Only a plan revision can use staged restore.');
    const db = options.db ?? admin.firestore();
    const nowMs = options.nowMs ?? Date.now();
    const userRef = db.collection('users').doc(uid);
    const stateRef = userRef.collection('trainingPlanState').doc('current');
    const lockRef = stateRef.collection(TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID).doc(BULK_RESTORE_LOCK_ID);
    const availabilityRef = stateRef.collection(BULK_RESTORE_AVAILABILITY_COLLECTION_ID)
        .doc(BULK_RESTORE_AVAILABILITY_DOCUMENT_ID);
    const requestHash = hashTrainingScheduleRequestPayload(request);
    const hash = stagedRestoreIntentHash(request);
    try {
        const acquired = await db.runTransaction(async transaction => {
            if ((await getUserDeletionGuardStateInTransaction(db, transaction, uid, nowMs)).shouldSkip) {
                fail('This account is being deleted or is no longer available.');
            }
            const [exact, intent, locks, state, plan] = await Promise.all([
                transaction.get(receipt(uid, db, request.mutationId)),
                transaction.get(receipt(uid, db, `${INTENT_PREFIX}${hash}`)),
                transaction.get(stateRef.collection(TRAINING_PLAN_DELETION_LOCKS_COLLECTION_ID)),
                transaction.get(stateRef),
                transaction.get(userRef.collection(TRAINING_PLANS_COLLECTION_ID).doc(request.scope.id)),
            ]);
            if (exact.exists) {
                if (exact.data()?.requestHash !== requestHash) fail('This mutation ID was already used differently.');
                return { completed: parseStoredRestoreResponse(exact.data()?.response) };
            }
            if (intent.exists) {
                if (intent.data()?.kind !== 'restore-intent' || intent.data()?.intentHash !== hash) {
                    throw new Error('Invalid staged restore intent receipt.');
                }
                const response = parseStoredRestoreResponse(intent.data()?.response);
                const committedAtMs = Math.max(Date.now(), nowMs);
                transaction.create(receipt(uid, db, request.mutationId), {
                    schemaVersion: TRAINING_PLAN_SCHEMA_VERSION, requestHash, response,
                    createdAtMs: committedAtMs,
                    expireAt: Timestamp.fromMillis(committedAtMs + RECEIPT_RETENTION_MS),
                });
                return { completed: response };
            }
            if (locks.docs.some(snapshot => snapshot.id !== BULK_RESTORE_LOCK_ID)) {
                fail('Another Training plan operation is in progress. Retry after it finishes.');
            }
            const existing = locks.docs.find(snapshot => snapshot.id === BULK_RESTORE_LOCK_ID);
            if (existing) {
                const lock = readBulkRestoreLock(existing.data());
                if (lock.intentHash !== hash || lock.planId !== request.scope.id) {
                    fail('Another Training change is in progress. Retry it before starting a different change.');
                }
                if (lock.request.mutationId === request.mutationId && lock.requestHash !== requestHash) {
                    fail('This mutation ID was already used differently.');
                }
                const alias = lock.aliases.find(item => item.mutationId === request.mutationId);
                if (alias && alias.requestHash !== requestHash) fail('This mutation ID was already used differently.');
                if (lock.request.mutationId === request.mutationId || alias) return { lock };
                if (lock.aliases.length >= MAX_ALIASES) fail('This staged restore has too many retry IDs. Retry an earlier request.');
                const updated = { ...lock, aliases: [...lock.aliases, { mutationId: request.mutationId, requestHash }] };
                transaction.update(lockRef, { aliases: updated.aliases });
                return { lock: updated };
            }
            if (!state.exists || !plan.exists) fail('The Training plan is unavailable.');
            const currentState = parseTrainingPlanStateV1(state.data());
            const currentPlan = parseTrainingPlanV1(plan.data());
            if (request.expectedRevisions.find(item => item.scope === 'state' && item.id === 'current')?.revision
                    !== currentState.revision
                || request.expectedRevisions.find(item => item.scope === 'plan' && item.id === currentPlan.id)?.revision
                    !== currentPlan.revision) {
                fail('The Training plan changed before the restore could start.', 'revision-conflict');
            }
            const lock: BulkRestoreLockV1 = {
                schemaVersion: TRAINING_PLAN_SCHEMA_VERSION, kind: 'restore-plan', phase: 'staging', request,
                requestHash, intentHash: hash, aliases: [], planId: currentPlan.id,
                stateRevision: currentState.revision, planRevision: currentPlan.revision,
                createdAtMs: nowMs, nextAttemptAtMs: nowMs + BULK_RESTORE_LEASE_MS,
                attempts: 0, nextIndex: 0,
            };
            transaction.create(lockRef, lock);
            transaction.create(availabilityRef, { schemaVersion: TRAINING_PLAN_SCHEMA_VERSION, status: 'restoring' });
            return { lock };
        });
        if (acquired.completed) return acquired.completed;
        if (!acquired.lock) fail('The staged Training restore is unavailable.');
        if (acquired.lock.phase === 'staging') await stageRestore(uid, db, request, lockRef, acquired.lock, nowMs);
        return await applyRestore(uid, db, request, lockRef, nowMs);
    } catch (error) {
        // A competing retry may commit after this invocation last read the lock.
        try {
            const completed = await completedReceipt(uid, db, request);
            if (completed) return completed;
        } catch {
            // The original error remains the useful failure if receipt lookup also fails.
        }
        throw error;
    }
}
