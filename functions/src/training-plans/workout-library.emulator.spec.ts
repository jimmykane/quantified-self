import { randomUUID } from 'node:crypto';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { projectStrengthWorkoutToV1 } from '../../../shared/strength-workout';
import { mutateTrainingScheduleForUser } from './persistence';
import { mutateWorkoutLibraryForUser, placeWorkoutLibraryForUser } from './workout-library';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('workout library Firestore transactions', { timeout: 120_000 }, () => {
    if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
        throw new Error('A loopback Firestore emulator is required.');
    }
    const db = new Firestore({ projectId: 'demo-training-library' });
    const uids: string[] = [];
    const nowMs = Date.parse('2026-09-30T10:00:00Z');
    const structure = { version: 1 as const, sport: ActivityTypes.Running, nodes: [{ kind: 'step' as const,
        id: 'step-1', purpose: 'work' as const, ending: { kind: 'time' as const, seconds: 1800 }, targets: [] }] };

    async function user() {
        const uid = `library-${randomUUID()}`; uids.push(uid);
        const ref = db.collection('users').doc(uid);
        await ref.set({ test: true });
        return { uid, ref };
    }

    afterAll(async () => {
        for (const uid of uids) await db.recursiveDelete(db.collection('users').doc(uid));
        await db.terminate();
    });

    it('saves a prescription, places it on multiple dates once, and keeps copies independent', async () => {
        const { uid, ref } = await user();
        const create = { mutationId: 'create-1', operation: { kind: 'create' as const,
            itemId: 'template-1', title: 'Easy run', structure } };
        const created = await mutateWorkoutLibraryForUser(uid, create, { db, nowMs });
        expect(created.item?.revision).toBe(1);
        expect(await mutateWorkoutLibraryForUser(uid, create, { db, nowMs: nowMs + 1 })).toEqual(created);
        const copied = await mutateWorkoutLibraryForUser(uid, { mutationId: 'copy-1', operation: {
            kind: 'copy', itemId: 'template-copy', sourceItemId: 'template-1', expectedSourceRevision: 1,
        } }, { db, nowMs: nowMs + 1 });
        expect(copied.item).toMatchObject({ title: 'Easy run copy', revision: 1, status: 'active' });
        const place = { mutationId: 'place-1', itemId: 'template-1', expectedTemplateRevision: 1,
            expectedStateRevision: 0, planId: null, expectedPlanRevision: null,
            dates: ['2026-10-01', '2026-10-08', '2026-10-15'], confirmPlanRangeExtension: false };
        const placed = await placeWorkoutLibraryForUser(uid, place, { db, nowMs: nowMs + 2 });
        expect(placed.workoutIds).toHaveLength(3);
        expect(placed.stateRevision).toBe(1);
        expect(await placeWorkoutLibraryForUser(uid, place, { db, nowMs: nowMs + 3 })).toEqual(placed);
        const first = (await ref.collection('scheduledWorkouts').doc(placed.workoutIds[0]).get()).data()!;
        expect(first).toMatchObject({ title: 'Easy run', planId: null, localDate: '2026-10-01', lifecycle: 'planned' });
        expect(first).not.toHaveProperty('templateId');
        expect(first).not.toHaveProperty('completion');
        expect((await ref.collection('scheduledWorkouts').get()).size).toBe(3);
        expect((await ref.collection('scheduledWorkouts').doc(placed.workoutIds[0])
            .collection('revisions').get()).empty).toBe(false);
        await mutateWorkoutLibraryForUser(uid, { mutationId: 'update-1', operation: { kind: 'update',
            itemId: 'template-1', expectedRevision: 1, title: 'Easy run v2', structure } }, { db, nowMs: nowMs + 4 });
        expect((await ref.collection('scheduledWorkouts').doc(placed.workoutIds[0]).get()).data()?.title).toBe('Easy run');
        await expect(placeWorkoutLibraryForUser(uid, { ...place, mutationId: 'stale-1', expectedStateRevision: 1 }, { db }))
            .rejects.toThrow('changed');
    });

    it('refuses stale edits, mismatched receipts and placements from archived templates', async () => {
        const { uid } = await user();
        await mutateWorkoutLibraryForUser(uid, { mutationId: 'create-1', operation: { kind: 'create',
            itemId: 'template-1', title: 'Easy run', structure } }, { db, nowMs });
        await expect(mutateWorkoutLibraryForUser(uid, { mutationId: 'create-1', operation: { kind: 'create',
            itemId: 'template-2', title: 'Easy run', structure } }, { db, nowMs })).rejects.toThrow('different request');
        await expect(mutateWorkoutLibraryForUser(uid, { mutationId: 'stale', operation: { kind: 'update',
            itemId: 'template-1', expectedRevision: 2, title: 'Wrong', structure } }, { db, nowMs }))
            .rejects.toThrow('changed');
        await mutateWorkoutLibraryForUser(uid, { mutationId: 'archive-1', operation: {
            kind: 'set-status', itemId: 'template-1', expectedRevision: 1, status: 'archived',
        } }, { db, nowMs });
        await expect(placeWorkoutLibraryForUser(uid, { mutationId: 'place-archived', itemId: 'template-1',
            expectedTemplateRevision: 2, expectedStateRevision: 0, planId: null, expectedPlanRevision: null,
            dates: ['2026-10-01'], confirmPlanRangeExtension: false }, { db })).rejects.toThrow('changed');
    });

    it('places into a plan only with explicit range extension and leaves delivery consent unset', async () => {
        const { uid, ref } = await user();
        await mutateTrainingScheduleForUser(uid, { mutationId: 'plan-create', expectedRevisions: [
            { scope: 'state', id: 'current', revision: 0 },
        ], operation: { kind: 'create-plan', planId: 'plan-1', name: 'Autumn',
            startLocalDate: '2026-10-01', endLocalDate: '2026-10-07', activate: true } }, { db, nowMs });
        await mutateWorkoutLibraryForUser(uid, { mutationId: 'template-create', operation: {
            kind: 'create', itemId: 'template-1', title: 'Easy run', structure,
        } }, { db, nowMs });
        const request = { mutationId: 'plan-place', itemId: 'template-1', expectedTemplateRevision: 1,
            expectedStateRevision: 1, planId: 'plan-1', expectedPlanRevision: 1,
            dates: ['2026-10-02', '2026-10-09'], confirmPlanRangeExtension: false };
        await expect(placeWorkoutLibraryForUser(uid, request, { db, nowMs: nowMs + 1 }))
            .rejects.toThrow('requires extending');
        expect((await ref.collection('scheduledWorkouts').get()).empty).toBe(true);
        const placed = await placeWorkoutLibraryForUser(uid, {
            ...request, confirmPlanRangeExtension: true,
        }, { db, nowMs: nowMs + 2 });
        expect(placed.planRevision).toBe(2);
        expect((await ref.collection('trainingPlans').doc('plan-1').get()).get('endLocalDate')).toBe('2026-10-09');
        expect((await ref.collection('trainingPlans').doc('plan-1').collection('revisions').get()).size).toBe(2);
        const first = (await ref.collection('scheduledWorkouts').doc(placed.workoutIds[0]).get()).data()!;
        expect(first).toMatchObject({ planId: 'plan-1', templateOrigin: { itemId: 'template-1', revision: 1 } });
        expect(first).not.toHaveProperty('deliverySettings');
        expect((await ref.collection('trainingDeliverySettings').get()).empty).toBe(true);
    });

    it('places full strength prescriptions without losing exercises or sharing workout identity', async () => {
        const { uid, ref } = await user();
        const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Squat', sets: [
            { id: 'set-1', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80 },
        ] }] };
        const strengthStructure = projectStrengthWorkoutToV1({ ...strength, workoutId: 'template', revision: 1 });
        await mutateWorkoutLibraryForUser(uid, { mutationId: 'strength-create', operation: {
            kind: 'create', itemId: 'strength-template', title: 'Strength A', structure: strengthStructure, strength,
        } }, { db, nowMs });
        const placed = await placeWorkoutLibraryForUser(uid, {
            mutationId: 'strength-place', itemId: 'strength-template', expectedTemplateRevision: 1,
            expectedStateRevision: 0, planId: null, expectedPlanRevision: null,
            dates: ['2026-10-01', '2026-10-08'], confirmPlanRangeExtension: false,
        }, { db, nowMs: nowMs + 1 });
        expect(new Set(placed.workoutIds).size).toBe(2);
        for (const workoutId of placed.workoutIds) {
            const snapshot = await ref.collection('scheduledWorkouts').doc(workoutId).get();
            expect(snapshot.get('structure')).toEqual(strengthStructure);
            const details = await snapshot.ref.collection('strengthDetails').doc('current').get();
            expect(details.get('exercises')).toEqual(strength.exercises);
            expect(details.get('workoutId')).toBe(workoutId);
        }
    });

    it('handles the 100-date placement bound in one resumable schedule mutation', async () => {
        const { uid, ref } = await user();
        await mutateWorkoutLibraryForUser(uid, { mutationId: 'hundred-create', operation: {
            kind: 'create', itemId: 'template-100', title: 'Base run', structure,
        } }, { db, nowMs });
        const dates = Array.from({ length: 100 }, (_, index) => {
            const date = new Date(Date.UTC(2026, 9, 1 + index));
            return date.toISOString().slice(0, 10);
        });
        const placed = await placeWorkoutLibraryForUser(uid, {
            mutationId: 'hundred-place', itemId: 'template-100', expectedTemplateRevision: 1,
            expectedStateRevision: 0, planId: null, expectedPlanRevision: null,
            dates, confirmPlanRangeExtension: false,
        }, { db, nowMs: nowMs + 1 });
        expect(placed.workoutIds).toHaveLength(100);
        expect((await ref.collection('scheduledWorkouts').get()).size).toBe(100);
        expect((await ref.collection('trainingPlanState').doc('current').get()).get('currentWorkoutCount')).toBe(100);
    });
});
