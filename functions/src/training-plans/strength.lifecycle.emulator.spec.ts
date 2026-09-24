import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { projectStrengthWorkoutToV1, parseStrengthWorkoutDetailsV1 } from '../../../shared/strength-workout';
import { mutateTrainingScheduleForUser } from './persistence';
import { restoreTrainingScheduleRevisionForUser } from './restore';
import { deleteTrainingPlanForUser } from './delete-training-plan';
import type { MutateTrainingScheduleRequestV1 } from '../../../shared/training-plans';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('strength lifecycle in isolated demo Firestore', { timeout: 30_000 }, () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
    throw new Error('A loopback Firestore emulator is required.');
  }
  const db = new Firestore({ projectId: 'demo-training-strength' });
  const uids: string[] = [];
  const nowMs = Date.parse('2026-09-24T08:00:00Z');
  const draft = { version: 1 as const, exercises: [{ id: 'squat', name: 'Back squat', sets: [
    { id: 'set-one', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 },
  ] }] };
  const workoutRef = (uid: string, id: string) => db.collection('users').doc(uid).collection('scheduledWorkouts').doc(id);
  const detailsRef = (uid: string, id: string) => workoutRef(uid, id).collection('strengthDetails').doc('current');
  const apply = async (uid: string, stateRevision: number, operation: MutateTrainingScheduleRequestV1['operation'],
    extra: MutateTrainingScheduleRequestV1['expectedRevisions'] = []) => mutateTrainingScheduleForUser(uid, {
      mutationId: randomUUID(), expectedRevisions: [{ scope: 'state', id: 'current', revision: stateRevision }, ...extra], operation,
    }, { db, nowMs: nowMs + stateRevision });
  afterAll(async () => {
    for (const uid of uids) await db.recursiveDelete(db.collection('users').doc(uid));
    await db.terminate();
  });

  it('atomically retains details through create, edit, copy, plan transfer and standalone restore', async () => {
    const uid = `strength-${randomUUID()}`; uids.push(uid);
    await db.collection('users').doc(uid).set({ test: true });
    const structure = projectStrengthWorkoutToV1({ ...draft, workoutId: 'lift', revision: 1 });
    await apply(uid, 0, { kind: 'create-workout', workoutId: 'lift', planId: null,
      localDate: '2026-10-01', title: 'Strength day', structure, strength: draft, confirmPlanRangeExtension: false });
    expect(parseStrengthWorkoutDetailsV1((await detailsRef(uid, 'lift').get()).data()).exercises[0].sets[0].externalLoadKg).toBe(80);
    const revised = { ...draft, exercises: [{ ...draft.exercises[0], sets: [
      { ...draft.exercises[0].sets[0], externalLoadKg: 85 },
    ] }] };
    await apply(uid, 1, { kind: 'update-workout', workoutId: 'lift', planId: null,
      localDate: '2026-10-01', title: 'Strength day',
      structure: projectStrengthWorkoutToV1({ ...revised, workoutId: 'lift', revision: 2 }),
      strength: revised, confirmPlanRangeExtension: false }, [{ scope: 'workout', id: 'lift', revision: 1 }]);
    expect((await detailsRef(uid, 'lift').get()).data()?.revision).toBe(2);
    await apply(uid, 2, { kind: 'copy-workout', sourceWorkoutId: 'lift', workoutId: 'lift-copy',
      planId: null, localDate: '2026-10-02', confirmPlanRangeExtension: false },
    [{ scope: 'workout', id: 'lift', revision: 2 }]);
    expect((await detailsRef(uid, 'lift-copy').get()).data()).toMatchObject({ workoutId: 'lift-copy', revision: 1,
      exercises: [{ sets: [{ externalLoadKg: 85 }] }] });
    await apply(uid, 3, { kind: 'create-plan', planId: 'plan', name: 'Strength block',
      startLocalDate: '2026-10-01', endLocalDate: '2026-10-31', activate: true });
    await apply(uid, 4, { kind: 'move-workout', workoutId: 'lift-copy', planId: 'plan',
      localDate: '2026-10-03', confirmPlanRangeExtension: false }, [
      { scope: 'workout', id: 'lift-copy', revision: 1 }, { scope: 'plan', id: 'plan', revision: 1 },
    ]);
    expect((await detailsRef(uid, 'lift-copy').get()).data()?.revision).toBe(1);
    const restored = await restoreTrainingScheduleRevisionForUser(uid, { mutationId: randomUUID(),
      scope: { kind: 'workout', id: 'lift' }, targetRevision: 1,
      expectedRevisions: [{ scope: 'state', id: 'current', revision: 5 },
        { scope: 'workout', id: 'lift', revision: 2 }],
    }, { db, nowMs: nowMs + 100 });
    expect(restored.mutation.workouts[0].revision).toBe(3);
    expect((await detailsRef(uid, 'lift').get()).data()).toMatchObject({ revision: 3,
      exercises: [{ sets: [{ externalLoadKg: 80 }] }] });
    expect((await detailsRef(uid, 'lift-copy').get()).data()?.exercises[0].sets[0].externalLoadKg).toBe(85);
  });

  it('converts plan workouts without losing strength details', async () => {
    const uid = `strength-${randomUUID()}`; uids.push(uid);
    await db.collection('users').doc(uid).set({ test: true });
    await apply(uid, 0, { kind: 'create-plan', planId: 'plan', name: 'Strength block',
      startLocalDate: '2026-10-01', endLocalDate: '2026-10-31', activate: true });
    const structure = projectStrengthWorkoutToV1({ ...draft, workoutId: 'lift', revision: 1 });
    await apply(uid, 1, { kind: 'create-workout', workoutId: 'lift', planId: 'plan',
      localDate: '2026-10-01', title: 'Strength day', structure, strength: draft, confirmPlanRangeExtension: false },
    [{ scope: 'plan', id: 'plan', revision: 1 }]);
    await deleteTrainingPlanForUser(uid, { mutationId: randomUUID(), planId: 'plan',
      expectedRevisions: [{ scope: 'state', id: 'current', revision: 2 }, { scope: 'plan', id: 'plan', revision: 2 }],
      workoutDisposition: 'convert-to-standalone', confirmPlanDeletion: true }, { db, nowMs: nowMs + 10 });
    expect((await workoutRef(uid, 'lift').get()).data()).toMatchObject({ planId: null, revision: 2 });
    expect((await detailsRef(uid, 'lift').get()).data()).toMatchObject({ revision: 1,
      exercises: [{ sets: [{ externalLoadKg: 80, restAfterSeconds: 120 }] }] });
    expect((await workoutRef(uid, 'lift').collection('revisions').doc('0000000002').get()).data()?.strength)
      .toMatchObject({ workoutId: 'lift', revision: 1 });
  });

  it('fails closed when a strength workout has no companion record', async () => {
    const uid = `strength-${randomUUID()}`; uids.push(uid);
    await db.collection('users').doc(uid).set({ test: true });
    await db.collection('users').doc(uid).collection('trainingPlanState').doc('current').set({
      schemaVersion: 1, activePlanId: null, revision: 1, currentWorkoutCount: 1, updatedAtMs: nowMs,
    });
    await workoutRef(uid, 'orphan').set({ schemaVersion: 1, id: 'orphan', planId: null,
      localDate: '2026-10-01', lifecycle: 'planned', title: 'Orphan',
      structure: projectStrengthWorkoutToV1({ ...draft, workoutId: 'orphan', revision: 1 }),
      revision: 1, createdAtMs: nowMs, updatedAtMs: nowMs });
    await expect(apply(uid, 1, { kind: 'set-workout-lifecycle', workoutId: 'orphan', lifecycle: 'skipped' }, [
      { scope: 'workout', id: 'orphan', revision: 1 },
    ])).rejects.toThrow('Strength details are missing');
    expect((await workoutRef(uid, 'orphan').get()).data()?.lifecycle).toBe('planned');
  });
});
