import { randomUUID } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { mutateTrainingScheduleForUser } from './persistence';
import { deleteTrainingPlanForUser } from './delete-training-plan';
import { restoreTrainingScheduleRevisionForUser } from './restore';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('400-workout Training mutations in isolated demo Firestore', { timeout: 180_000 }, () => {
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

    it('shifts and converts 400 complex workouts with stable retries and no mixed final state', async () => {
        const uid = `large-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set({
            schemaVersion: 1, activePlanId: 'large-plan', revision: 1,
            currentWorkoutCount: 400, updatedAtMs: nowMs,
        });
        await user.collection('trainingPlans').doc('large-plan').set({
            schemaVersion: 1, id: 'large-plan', name: 'Synthetic 400-workout test', lifecycle: 'active',
            startLocalDate: '2026-10-01', endLocalDate: '2026-10-31', revision: 1,
            lastCheckpointRevision: 1, workoutCount: 400, createdAtMs: nowMs, updatedAtMs: nowMs,
        });
        for (let offset = 0; offset < 400; offset += 100) {
            const batch = db.batch();
            for (let index = offset; index < offset + 100; index += 1) {
                const id = `workout-${`${index}`.padStart(3, '0')}`;
                const structure = {
                    version: 1, sport: ActivityTypes.Running,
                    nodes: Array.from({ length: 100 }, (_, step) => ({
                        kind: 'step', id: `step-${step}`, purpose: 'work',
                        ending: { kind: 'time', seconds: 30 }, targets: [],
                        note: `Synthetic segment ${step} for workout ${index}: ${'x'.repeat(190)}`,
                    })),
                };
                batch.set(user.collection('scheduledWorkouts').doc(id), {
                    schemaVersion: 1, id, planId: 'large-plan', localDate: '2026-10-02', lifecycle: 'planned',
                    title: `Synthetic workout ${index}`, structure, revision: 1,
                    createdAtMs: nowMs, updatedAtMs: nowMs,
                });
            }
            await batch.commit();
        }
        const shift = {
            mutationId: 'large-shift',
            expectedRevisions: [{ scope: 'state' as const, id: 'current', revision: 1 },
                { scope: 'plan' as const, id: 'large-plan', revision: 1 }],
            operation: { kind: 'shift-plan' as const, planId: 'large-plan', days: 1 },
        };
        const firstShift = await mutateTrainingScheduleForUser(uid, shift, { db, nowMs: nowMs + 1 });
        expect((await mutateTrainingScheduleForUser(uid, shift, { db, nowMs: nowMs + 2 })).state.revision)
            .toBe(firstShift.state.revision);
        expect((await user.collection('scheduledWorkouts').doc('workout-399').get()).data())
            .toMatchObject({ planId: 'large-plan', localDate: '2026-10-03', revision: 2 });

        // A later committed date edit makes the shift checkpoint a real restore
        // target while retaining all 100-node prescription bodies.
        for (let offset = 0; offset < 400; offset += 100) {
            const batch = db.batch();
            for (let index = offset; index < offset + 100; index += 1) {
                batch.update(user.collection('scheduledWorkouts').doc(`workout-${`${index}`.padStart(3, '0')}`), {
                    localDate: '2026-10-04', revision: 3, updatedAtMs: nowMs + 3,
                });
            }
            await batch.commit();
        }
        await user.collection('trainingPlans').doc('large-plan').update({
            startLocalDate: '2026-10-03', endLocalDate: '2026-11-02', revision: 3, updatedAtMs: nowMs + 3,
        });
        await user.collection('trainingPlanState').doc('current').update({ revision: 3, updatedAtMs: nowMs + 3 });
        const restored = await restoreTrainingScheduleRevisionForUser(uid, {
            mutationId: 'large-restore', scope: { kind: 'plan', id: 'large-plan' }, targetRevision: 2,
            expectedRevisions: [{ scope: 'state', id: 'current', revision: 3 },
                { scope: 'plan', id: 'large-plan', revision: 3 }],
        }, { db, nowMs: nowMs + 4 });
        expect(restored.mutation.state.revision).toBe(4);
        expect((await user.collection('scheduledWorkouts').doc('workout-399').get()).data())
            .toMatchObject({ localDate: '2026-10-03', revision: 4 });

        const deletion = {
            mutationId: 'large-convert', planId: 'large-plan',
            expectedRevisions: [{ scope: 'state' as const, id: 'current', revision: 4 },
                { scope: 'plan' as const, id: 'large-plan', revision: 4 }],
            workoutDisposition: 'convert-to-standalone' as const,
            confirmPlanDeletion: true as const,
        };
        const converted = await deleteTrainingPlanForUser(uid, deletion, { db, nowMs: nowMs + 5 });
        expect(converted.convertedWorkoutIds).toHaveLength(400);
        expect((await deleteTrainingPlanForUser(uid, deletion, { db, nowMs: nowMs + 6 })).state.revision)
            .toBe(converted.state.revision);
        expect((await user.collection('trainingPlans').doc('large-plan').get()).exists).toBe(false);
        expect((await user.collection('scheduledWorkouts').doc('workout-399').get()).data())
            .toMatchObject({ planId: null, localDate: '2026-10-03', revision: 5 });
        expect((await user.collection('scheduledWorkouts').where('planId', '==', 'large-plan').get()).empty).toBe(true);
    });

    it('restores a deleted standalone workout without retaining its deletion timestamp', async () => {
        const uid = `large-${randomUUID()}`; uids.push(uid);
        const user = db.collection('users').doc(uid);
        await user.set({ test: true });
        await user.collection('trainingPlanState').doc('current').set({
            schemaVersion: 1, activePlanId: null, revision: 2,
            currentWorkoutCount: 0, updatedAtMs: nowMs,
        });
        const workoutRef = user.collection('scheduledWorkouts').doc('recoverable');
        const original = { schemaVersion: 1, id: 'recoverable', planId: null,
            localDate: '2026-10-02', lifecycle: 'planned', title: 'Recoverable run',
            structure: { version: 1, sport: ActivityTypes.Running, nodes: [{
                kind: 'step', id: 'run', purpose: 'work', ending: { kind: 'time', seconds: 300 }, targets: [],
            }] },
            revision: 1, createdAtMs: nowMs, updatedAtMs: nowMs };
        await workoutRef.set({ ...original, lifecycle: 'deleted', deletedAtMs: nowMs + 1, revision: 2 });
        await workoutRef.collection('revisions').doc('0000000001').set({
            schemaVersion: 1, revision: 1, mutationId: 'created', operationKind: 'create-workout',
            createdAtMs: nowMs, snapshot: original,
        });

        const restored = await restoreTrainingScheduleRevisionForUser(uid, {
            mutationId: 'restore-deleted', scope: { kind: 'workout', id: 'recoverable' }, targetRevision: 1,
            expectedRevisions: [{ scope: 'state', id: 'current', revision: 2 },
                { scope: 'workout', id: 'recoverable', revision: 2 }],
        }, { db, nowMs: nowMs + 2 });
        expect(restored.mutation.state.currentWorkoutCount).toBe(1);
        const saved = (await workoutRef.get()).data();
        expect(saved).toMatchObject({ lifecycle: 'planned', revision: 3 });
        expect(saved).not.toHaveProperty('deletedAtMs');
    });
});
