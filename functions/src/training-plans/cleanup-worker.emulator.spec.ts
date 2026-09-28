import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { trainingCleanupJob, trainingCleanupJobRef } from './cleanup-job-contract';
import { reconcileTrainingCleanupJobs } from './cleanup-worker';
import { buildTrainingScheduleDeletionTombstone, trainingScheduleDeletionTombstoneDocumentId } from './persistence';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Training cleanup in isolated demo Firestore', { timeout: 60_000 }, () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
        throw new Error('A loopback Firestore emulator is required.');
    }
    const db = new Firestore({ projectId: 'demo-training-657' });
    const uids: string[] = [];
    const nowMs = Date.parse('2026-09-28T10:00:00Z');

    afterAll(async () => {
        for (const uid of uids) await db.recursiveDelete(db.collection('users').doc(uid));
        await db.terminate();
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
