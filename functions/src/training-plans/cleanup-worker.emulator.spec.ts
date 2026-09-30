import { randomUUID } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { DELETED_WORKOUT_RECOVERY_MS } from '../../../shared/training-plans';
import { trainingCleanupJob, trainingCleanupJobRef } from './cleanup-job-contract';
import { reconcileExpiredDeletedWorkouts, reconcileTrainingCleanupJobs, runTrainingWorkoutExpiry } from './cleanup-worker';
import { buildTrainingScheduleDeletionTombstone, trainingScheduleDeletionTombstoneDocumentId } from './persistence';
import { createEmptyTrainingPlanState } from './mutation';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Training cleanup in isolated demo Firestore', { timeout: 60_000 }, () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
        throw new Error('A loopback Firestore emulator is required.');
    }
    const db = new Firestore({ projectId: 'demo-training-657' });
    const uids: string[] = [];
    const nowMs = Date.parse('2026-09-28T10:00:00Z');

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
});
