import { randomUUID } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DELETED_WORKOUT_RECOVERY_MS,
    TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID,
} from '../../../shared/training-plans';
import { trainingCleanupJob, trainingCleanupJobRef } from './cleanup-job-contract';
import { reconcileExpiredDeletedWorkouts, reconcileTrainingCleanupJobs, runTrainingWorkoutExpiry } from './cleanup-worker';
import { buildTrainingScheduleDeletionTombstone, trainingScheduleDeletionTombstoneDocumentId } from './persistence';
import { createEmptyTrainingPlanState } from './mutation';
import {
    claimWorkoutExpiryCheckpoint, saveWorkoutExpiryCheckpoint, WORKOUT_EXPIRY_CHECKPOINT_PATH,
} from './workout-expiry-checkpoint';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const demoProjectId = 'demo-training-657';
describe.skipIf(!emulatorHost)('Training cleanup in isolated demo Firestore', { timeout: 360_000 }, () => {
    if (emulatorHost && (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)
        || process.env.TRAINING_TEST_DEMO_PROJECT_ID !== demoProjectId)) {
        throw new Error('A loopback Firestore emulator with the exact demo-training-657 project is required.');
    }
    const db = new Firestore({ projectId: demoProjectId });
    const uids: string[] = [];
    const nowMs = Date.parse('2026-09-28T10:00:00Z');

    beforeEach(async () => {
        await db.doc(WORKOUT_EXPIRY_CHECKPOINT_PATH).set({
            schemaVersion: 1, cursor: null, leaseId: null, leaseUntilMs: 0,
        });
    });

    function deletedWorkout(id: string, deletedAtMs: number) {
        return {
            schemaVersion: 1, id, planId: null, localDate: '2026-09-27', lifecycle: 'deleted',
            title: 'Expiry QA', structure: { version: 1, sport: ActivityTypes.Running, nodes: [{
                kind: 'step', id: 'steady', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [],
            }] }, revision: 2, createdAtMs: 1, updatedAtMs: deletedAtMs, deletedAtMs,
        };
    }

    afterAll(async () => {
        for (const uid of uids) await db.recursiveDelete(db.collection('users').doc(uid));
        await db.recursiveDelete(db.doc(WORKOUT_EXPIRY_CHECKPOINT_PATH));
        await db.terminate();
    });

    it('expires legacy deleted roots at 90 days, removes descendants and reverse links, and is idempotent', async () => {
        const uid = `expiry-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set(createEmptyTrainingPlanState(nowMs));
        const expired = user.collection('scheduledWorkouts').doc('expired');
        const eligible = user.collection('scheduledWorkouts').doc('eligible');
        await expired.set(deletedWorkout('expired', nowMs - DELETED_WORKOUT_RECOVERY_MS));
        await expired.collection('revisions').doc('0000000001').set({ privateHistory: true });
        await expired.collection('strengthDetails').doc('current').set({ privateCompanion: true });
        await eligible.set(deletedWorkout('eligible', nowMs - DELETED_WORKOUT_RECOVERY_MS + 1));
        await user.collection('trainingActivityCompletionLinks').doc('old-link').set({ workoutId: 'expired' });
        await runTrainingWorkoutExpiry(db, nowMs);
        expect((await expired.get()).exists).toBe(false);
        expect((await expired.collection('revisions').doc('0000000001').get()).exists).toBe(false);
        expect((await expired.collection('strengthDetails').doc('current').get()).exists).toBe(false);
        expect((await user.collection('trainingActivityCompletionLinks').doc('old-link').get()).exists).toBe(false);
        expect((await eligible.get()).exists).toBe(true);
        expect((await reconcileExpiredDeletedWorkouts(db, nowMs)).deleted).toBe(0);
    });

    it('serializes concurrent plan-bound expiry and preserves prior past-copy consent', async () => {
        const uid = `expiry-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set({
            ...createEmptyTrainingPlanState(nowMs), revision: 1,
        });
        await user.collection('trainingPlans').doc('plan').set({
            schemaVersion: 1, id: 'plan', name: 'Old plan', lifecycle: 'paused',
            startLocalDate: '2026-09-01', endLocalDate: '2026-09-30', revision: 1,
            lastCheckpointRevision: 1, workoutCount: 0, createdAtMs: 1, updatedAtMs: 1,
        });
        const deletedAtMs = nowMs - DELETED_WORKOUT_RECOVERY_MS - 1;
        await user.collection('scheduledWorkouts').doc('plan-old').set({
            ...deletedWorkout('plan-old', deletedAtMs), planId: 'plan',
        });
        const pastCleanup = user.collection('trainingDeliveryState').doc('current')
            .collection('pastCleanup').doc('workout_plan-old');
        await pastCleanup.set({ schemaVersion: 1, scope: 'workout', scopeId: 'plan-old',
            enabled: true, deletedAtMs, mutationId: 'original-delete', requestedAtMs: deletedAtMs });
        const ledger = user.collection('trainingDeliveryLedger').doc('delivery-1');
        await ledger.set({ workoutId: 'plan-old', privateRemoteCopy: true });
        const results = await Promise.all([
            reconcileExpiredDeletedWorkouts(db, nowMs), reconcileExpiredDeletedWorkouts(db, nowMs),
        ]);
        expect(results.reduce((total, result) => total + result.deleted, 0)).toBe(1);
        expect(results.every(result => result.failed === 0)).toBe(true);
        expect((await user.collection('scheduledWorkouts').doc('plan-old').get()).exists).toBe(false);
        expect((await user.collection('trainingPlans').doc('plan').get()).get('revision')).toBe(2);
        expect((await pastCleanup.get()).get('enabled')).toBe(true);
        expect((await ledger.get()).exists).toBe(true); // Reconciliation, not expiry, owns remote state.
    });

    it('counts a committed deletion when post-commit subtree cleanup fails, then retries its durable job', async () => {
        const uid = `expiry-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set(createEmptyTrainingPlanState(nowMs));
        const workout = user.collection('scheduledWorkouts').doc('cleanup-interrupted');
        await workout.set(deletedWorkout(workout.id, nowMs - DELETED_WORKOUT_RECOVERY_MS));
        const history = workout.collection('revisions').doc('0000000001');
        await history.set({ privateHistory: true });

        const recursiveDelete = db.recursiveDelete.bind(db);
        const interrupted = vi.spyOn(db, 'recursiveDelete').mockImplementation(async ref => {
            if (ref.path === workout.path) throw new Error('simulated recursive cleanup interruption');
            return recursiveDelete(ref);
        });
        let result;
        try {
            result = await runTrainingWorkoutExpiry(db, nowMs);
        } finally {
            interrupted.mockRestore();
        }
        expect(result).toMatchObject({ scanned: 1, deleted: 1, failed: 1, moreDue: false });
        expect((await workout.get()).exists).toBe(false);
        expect((await history.get()).exists).toBe(true);
        const job = trainingCleanupJobRef(db, uid, 'workout', workout.id);
        expect((await job.get()).exists).toBe(true);

        expect((await reconcileTrainingCleanupJobs(db, nowMs)).completed).toBe(1);
        expect((await history.get()).exists).toBe(false);
        expect((await job.get()).exists).toBe(false);
    });

    it('stops before another deletion when a committed outcome cannot be verified', async () => {
        const uid = `expiry-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set(createEmptyTrainingPlanState(nowMs));
        const first = user.collection('scheduledWorkouts').doc('first');
        const second = user.collection('scheduledWorkouts').doc('second');
        await first.set(deletedWorkout(first.id, nowMs - DELETED_WORKOUT_RECOVERY_MS - 1));
        await second.set(deletedWorkout(second.id, nowMs - DELETED_WORKOUT_RECOVERY_MS));

        const tombstonePath = user.collection('trainingPlanState').doc('current')
            .collection(TRAINING_SCHEDULE_DELETION_TOMBSTONES_COLLECTION_ID)
            .doc(trainingScheduleDeletionTombstoneDocumentId('workout', first.id)).path;
        const tombstonePrototype = Object.getPrototypeOf(user);
        const getDocument = user.get;
        const getSpy = vi.spyOn(tombstonePrototype, 'get').mockImplementation(function (this: typeof user) {
            if (this.path === tombstonePath) throw new Error('simulated tombstone read interruption');
            return getDocument.call(this);
        });
        const recursiveDelete = db.recursiveDelete.bind(db);
        const deleteSpy = vi.spyOn(db, 'recursiveDelete').mockImplementation(async ref => {
            if (ref.path === first.path) throw new Error('simulated recursive cleanup interruption');
            return recursiveDelete(ref);
        });
        try {
            await expect(runTrainingWorkoutExpiry(db, nowMs))
                .rejects.toThrow('simulated recursive cleanup interruption');
        } finally {
            deleteSpy.mockRestore();
            getSpy.mockRestore();
        }
        expect((await first.get()).exists).toBe(false);
        expect((await second.get()).exists).toBe(true);
        expect((await trainingCleanupJobRef(db, uid, 'workout', first.id).get()).exists).toBe(true);
        expect((await reconcileTrainingCleanupJobs(db, nowMs)).completed).toBe(1);
        expect((await runTrainingWorkoutExpiry(db, nowMs)).deleted).toBe(1);
        expect((await second.get()).exists).toBe(false);
    });

    it('does not expire a workout during account deletion', async () => {
        const uid = `expiry-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set(createEmptyTrainingPlanState(nowMs));
        const workout = user.collection('scheduledWorkouts').doc('account-deleting');
        await workout.set(deletedWorkout('account-deleting', nowMs - DELETED_WORKOUT_RECOVERY_MS));
        const tombstone = db.collection('userDeletionTombstones').doc(uid);
        await tombstone.set({ deletionStartedAtMs: nowMs });
        try {
            const result = await reconcileExpiredDeletedWorkouts(db, nowMs);
            expect(result).toMatchObject({ deleted: 0, failed: 0 });
            expect((await workout.get()).exists).toBe(true);
        } finally {
            await db.recursiveDelete(tombstone);
        }
    });

    it('pages past a blocked first expiry page to reach a later valid workout', async () => {
        const uid = `expiry-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set(createEmptyTrainingPlanState(nowMs));
        const malformedDeletedAtMs = nowMs - DELETED_WORKOUT_RECOVERY_MS - 1_000;
        await Promise.all(Array.from({ length: 30 }, (_, index) => {
            const id = `invalid-${String(index).padStart(2, '0')}`;
            return user.collection('scheduledWorkouts').doc(id).set({
                ...deletedWorkout(id, malformedDeletedAtMs), title: '',
            });
        }));
        const valid = user.collection('scheduledWorkouts').doc('valid-after-blocked-page');
        await valid.set(deletedWorkout(valid.id, nowMs - DELETED_WORKOUT_RECOVERY_MS));

        const result = await reconcileExpiredDeletedWorkouts(db, nowMs);
        expect(result.scanned).toBeGreaterThan(30);
        expect(result.failed).toBeGreaterThanOrEqual(30);
        expect((await valid.get()).exists).toBe(false);
    });

    it('sweeps 10-at-a-time across owners without skipping a fetched-page tail or exceeding 100 daily deletes', async () => {
        // This eligibility window is earlier than the malformed fixtures in
        // the preceding test, so the stress assertions count only these roots.
        const stressNowMs = nowMs - 30 * 24 * 60 * 60 * 1_000;
        const owners = Array.from({ length: 2 }, () => `expiry-stress-${randomUUID()}`);
        uids.push(...owners);
        const batch = db.batch();
        for (const uid of owners) {
            const user = db.collection('users').doc(uid);
            batch.set(user, { test: true });
            batch.set(user.collection('trainingPlanState').doc('current'), createEmptyTrainingPlanState(stressNowMs));
        }
        const roots = Array.from({ length: 125 }, (_, index) => {
            const id = `stress-${String(index).padStart(3, '0')}`;
            const root = db.collection('users').doc(owners[index < 80 ? 0 : 1])
                .collection('scheduledWorkouts').doc(id);
            // Shared timestamps cross both query pages and 10-delete batch
            // boundaries, exercising Firestore's implicit document-ID tie-break.
            batch.set(root, deletedWorkout(id, stressNowMs - DELETED_WORKOUT_RECOVERY_MS - 125
                + Math.floor(index / 17)));
            return root;
        });
        const recent = db.collection('users').doc(owners[1]).collection('scheduledWorkouts').doc('recent');
        const active = db.collection('users').doc(owners[1]).collection('scheduledWorkouts').doc('active');
        batch.set(recent, deletedWorkout(recent.id, stressNowMs - DELETED_WORKOUT_RECOVERY_MS + 1));
        const activeRecord: Record<string, unknown> = {
            ...deletedWorkout(active.id, stressNowMs - DELETED_WORKOUT_RECOVERY_MS - 1), lifecycle: 'planned',
        };
        delete activeRecord.deletedAtMs;
        batch.set(active, activeRecord);
        await batch.commit();
        for (const index of [0, 99, 124]) {
            await roots[index].collection('revisions').doc('0000000001').set({ privateHistory: true });
        }

        const first = await runTrainingWorkoutExpiry(db, stressNowMs);
        expect(first).toMatchObject({ deleted: 100, failed: 0, moreDue: true, stopReason: 'deletion-limit' });
        expect(first.batches).toBeGreaterThanOrEqual(10);
        expect(first.scanned).toBe(100);
        expect((await roots[99].get()).exists).toBe(false);
        expect((await roots[100].get()).exists).toBe(true);
        expect((await roots[99].collection('revisions').doc('0000000001').get()).exists).toBe(false);

        const second = await runTrainingWorkoutExpiry(db, stressNowMs);
        expect(second).toMatchObject({ deleted: 25, failed: 0, moreDue: false, stopReason: 'drained' });
        expect((await roots[124].get()).exists).toBe(false);
        expect((await roots[124].collection('revisions').doc('0000000001').get()).exists).toBe(false);
        expect((await recent.get()).exists).toBe(true);
        expect((await active.get()).exists).toBe(true);
    });

    it('keeps the 100-delete cap when every committed mutation needs cleanup retry', async () => {
        const stressNowMs = nowMs - 60 * 24 * 60 * 60 * 1_000;
        const uid = `expiry-interrupted-stress-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        const batch = db.batch();
        batch.set(user, { test: true });
        batch.set(user.collection('trainingPlanState').doc('current'), createEmptyTrainingPlanState(stressNowMs));
        const roots = Array.from({ length: 105 }, (_, index) => {
            const id = `interrupted-${String(index).padStart(3, '0')}`;
            const ref = user.collection('scheduledWorkouts').doc(id);
            batch.set(ref, deletedWorkout(id, stressNowMs - DELETED_WORKOUT_RECOVERY_MS - 1));
            return ref;
        });
        await batch.commit();

        const recursiveDelete = db.recursiveDelete.bind(db);
        const interrupted = vi.spyOn(db, 'recursiveDelete').mockImplementation(async ref => {
            if (ref.path.startsWith(`${user.path}/scheduledWorkouts/`)) {
                throw new Error('simulated recursive cleanup interruption');
            }
            return recursiveDelete(ref);
        });
        let result;
        try {
            result = await runTrainingWorkoutExpiry(db, stressNowMs);
        } finally {
            interrupted.mockRestore();
        }
        expect(result).toMatchObject({ scanned: 100, deleted: 100, failed: 100,
            moreDue: true, stopReason: 'deletion-limit' });
        expect((await roots[99].get()).exists).toBe(false);
        expect((await roots[100].get()).exists).toBe(true);
        const lastJob = trainingCleanupJobRef(db, uid, 'workout', roots[99].id);
        expect((await lastJob.get()).exists).toBe(true);
        expect((await reconcileTrainingCleanupJobs(db, stressNowMs)).completed).toBe(100);
        expect((await lastJob.get()).exists).toBe(false);
    });

    it('reconciles a committed workout receipt and recursively removes orphaned history', async () => {
        const uid = `cleanup-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        const root = user.collection('scheduledWorkouts').doc('retired');
        await root.collection('revisions').doc('0000000001').set({ privateHistory: true });
        const state = user.collection('trainingPlanState').doc('current');
        await state.collection('deletionTombstones').doc(trainingScheduleDeletionTombstoneDocumentId('workout', 'retired'))
            .set(buildTrainingScheduleDeletionTombstone('workout', 'retired', 'permanent-delete', nowMs));
        const job = trainingCleanupJobRef(db, uid, 'workout', 'retired');
        await job.set(trainingCleanupJob('workout', 'retired', 'permanent-delete', nowMs));

        const result = await reconcileTrainingCleanupJobs(db, nowMs);
        expect(result.completed).toBeGreaterThanOrEqual(1);
        expect((await root.collection('revisions').doc('0000000001').get()).exists).toBe(false);
        expect((await job.get()).exists).toBe(false);
    });

    it('reconciles plan subtree cleanup without touching converted standalone workouts', async () => {
        const uid = `cleanup-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        const plan = user.collection('trainingPlans').doc('retired-plan');
        await plan.collection('revisions').doc('0000000001').set({ privateHistory: true });
        const standalone = user.collection('scheduledWorkouts').doc('converted');
        await standalone.set({ planId: null, lifecycle: 'planned' });
        const state = user.collection('trainingPlanState').doc('current');
        await state.collection('deletionTombstones').doc(trainingScheduleDeletionTombstoneDocumentId('plan', 'retired-plan'))
            .set(buildTrainingScheduleDeletionTombstone('plan', 'retired-plan', 'delete-plan', nowMs));
        const job = trainingCleanupJobRef(db, uid, 'plan', 'retired-plan');
        await job.set(trainingCleanupJob('plan', 'retired-plan', 'delete-plan', nowMs, {
            mutationId: 'delete-plan',
            state: { schemaVersion: 1, activePlanId: null, revision: 2, currentWorkoutCount: 1, updatedAtMs: nowMs },
            removedPlanId: 'retired-plan',
            workoutDisposition: 'convert-to-standalone',
            convertedWorkoutIds: ['converted'],
            permanentlyDeletedWorkoutIds: [],
        }));

        const result = await reconcileTrainingCleanupJobs(db, nowMs);
        expect(result.completed).toBeGreaterThanOrEqual(1);
        expect((await plan.collection('revisions').doc('0000000001').get()).exists).toBe(false);
        expect((await standalone.get()).exists).toBe(true);
        expect((await job.get()).exists).toBe(false);
    });

    it('defers an unclaimable job without preventing a later valid job from completing', async () => {
        const uid = `cleanup-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        const invalid = trainingCleanupJobRef(db, uid, 'workout', 'invalid');
        await invalid.set({ ...trainingCleanupJob('workout', 'invalid', 'bad', nowMs), entityId: 'bad/id' });
        const valid = trainingCleanupJobRef(db, uid, 'workout', 'valid');
        await user.collection('trainingPlanState').doc('current').collection('deletionTombstones')
            .doc(trainingScheduleDeletionTombstoneDocumentId('workout', 'valid'))
            .set(buildTrainingScheduleDeletionTombstone('workout', 'valid', 'good', nowMs));
        await user.collection('scheduledWorkouts').doc('valid').collection('revisions')
            .doc('0000000001').set({ privateHistory: true });
        await valid.set(trainingCleanupJob('workout', 'valid', 'good', nowMs));

        const result = await reconcileTrainingCleanupJobs(db, nowMs);
        expect(result.failed).toBeGreaterThanOrEqual(1);
        expect(result.completed).toBeGreaterThanOrEqual(1);
        expect((await invalid.get()).get('nextAttemptAtMs')).toBe(nowMs + 60 * 60 * 1000);
        expect((await valid.get()).exists).toBe(false);
        expect((await user.collection('scheduledWorkouts').doc('valid').collection('revisions')
            .doc('0000000001').get()).exists).toBe(false);
    });

    it('resumes beyond 1,000 blocked roots across runs, survives a deleted cursor, then revisits earlier roots', async () => {
        const sweepNowMs = nowMs - 90 * 24 * 60 * 60 * 1_000;
        const deletedAtMs = sweepNowMs - DELETED_WORKOUT_RECOVERY_MS - 1;
        const owners = Array.from({ length: 2 }, () => `expiry-cursor-${randomUUID()}`).sort();
        uids.push(...owners);
        for (const uid of owners) {
            const user = db.collection('users').doc(uid);
            await user.set({ test: true });
            await user.collection('trainingPlanState').doc('current').set(createEmptyTrainingPlanState(sweepNowMs));
        }
        const roots = Array.from({ length: 1_005 }, (_, index) => db.collection('users')
            .doc(owners[index < 600 ? 0 : 1]).collection('scheduledWorkouts').doc(`blocked-${index}`));
        for (let offset = 0; offset < roots.length; offset += 400) {
            const writes = db.batch();
            for (const root of roots.slice(offset, offset + 400)) {
                writes.set(root, root.parent.parent!.id === owners[0]
                    ? { ...deletedWorkout(root.id, deletedAtMs), title: '' }
                    : { ...deletedWorkout(root.id, deletedAtMs), planId: 'missing-plan' });
            }
            await writes.commit();
        }
        const valid = db.collection('users').doc(owners[1]).collection('scheduledWorkouts').doc('valid-after-prefix');
        await valid.set(deletedWorkout(valid.id, deletedAtMs + 1));
        const checkpoint = db.doc(WORKOUT_EXPIRY_CHECKPOINT_PATH);

        expect(await runTrainingWorkoutExpiry(db, sweepNowMs)).toMatchObject({
            scanned: 1_000, deleted: 0, failed: 600, deferred: 400, stopReason: 'scan-limit', moreDue: true,
        });
        const cursor = (await checkpoint.get()).get('cursor');
        expect(cursor.deletedAtMs).toBe(deletedAtMs);
        expect((await valid.get()).exists).toBe(true);
        await db.recursiveDelete(db.doc(cursor.documentPath));
        expect(await runTrainingWorkoutExpiry(db, sweepNowMs)).toMatchObject({
            scanned: 6, deleted: 1, failed: 0, deferred: 5, stopReason: 'drained', moreDue: true,
        });
        expect((await valid.get()).exists).toBe(false);
        expect((await checkpoint.get()).get('cursor')).toBeNull();
        const earliest = [...roots].sort((a, b) => a.path.localeCompare(b.path))[0];
        await earliest.set(deletedWorkout(earliest.id, deletedAtMs));
        expect((await runTrainingWorkoutExpiry(db, sweepNowMs)).deleted).toBe(1);
        expect((await earliest.get()).exists).toBe(false);
    });

    it('allows one concurrent checkpoint claim and rejects a replaced lease', async () => {
        const claims = await Promise.all([claimWorkoutExpiryCheckpoint(db), claimWorkoutExpiryCheckpoint(db)]);
        expect(claims.filter(Boolean)).toHaveLength(1);
        const oldLease = claims.find(Boolean)!;
        const checkpoint = db.doc(WORKOUT_EXPIRY_CHECKPOINT_PATH);
        await checkpoint.update({ leaseUntilMs: 0 });
        const newLease = (await claimWorkoutExpiryCheckpoint(db))!;
        await expect(saveWorkoutExpiryCheckpoint(db, oldLease.leaseId, null, true)).rejects.toThrow('lease lost');
        expect((await checkpoint.get()).get('leaseId')).toBe(newLease.leaseId);
        await saveWorkoutExpiryCheckpoint(db, newLease.leaseId, null, true);
    });
});
