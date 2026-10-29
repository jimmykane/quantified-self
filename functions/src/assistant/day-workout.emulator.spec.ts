import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls, type GenerateDayWorkoutResponse } from '../../../shared/day-workout';
import { projectStrengthWorkoutToV1 } from '../../../shared/strength-workout';
import { createDayWorkoutStore } from './day-workout-store';
import { readDayWorkoutTrainingContext } from './day-workout-context';
import { validateDayWorkoutSuggestion } from './day-workout-validation';
import { createFirestoreTrainingReads, readTrainingPlans } from '../mcp/training-plans.service';
import { TRAINING_READ_OUTPUTS, type TrainingReadTool } from '../mcp/training-plans.schemas';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Calendar generation private state and existing MCP read-back', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error('Loopback emulator required');
  const db = new Firestore({ projectId: 'demo-day-workout' });
  afterAll(() => db.terminate());
  const controls = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki');
  const response = (requestId: string): GenerateDayWorkoutResponse => ({ requestId, observedAt: '2026-10-28T12:00:00Z',
    kind: 'rest', rationale: 'Rest suggestion.', draft: null, usedContext: [], missingContext: [], previousLoads: [] });
  it('serializes concurrent generation, replays once, retains tombstones after response eviction, and fences deletion', async () => {
    const uid = `day-generation-${randomUUID()}`; await db.doc(`users/${uid}`).set({});
    let now = Date.parse('2026-10-28T12:00Z'); const store = createDayWorkoutStore(() => db, () => now);
    const request = { requestId: 'first-request', controls };
    const attempts = await Promise.allSettled([store.begin(uid, request), store.begin(uid, request)]);
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const started = attempts.find(item => item.status === 'fulfilled')!;
    if (started.status !== 'fulfilled' || !('token' in started.value)) throw Error('Missing generation lease');
    await store.finish(uid, request.requestId, started.value.token, response(request.requestId));
    expect(await store.begin(uid, request)).toEqual({ response: response(request.requestId) });
    await expect(store.begin(uid, { ...request, controls: { ...controls, minutes: 60 } })).rejects.toMatchObject({ code: 'invalid-argument' });
    for (let index = 0; index < 4; index++) {
      const next = { ...request, requestId: `next-request-${index}` }; const begin = await store.begin(uid, next);
      if (!('token' in begin)) throw Error('Missing generation lease');
      await store.finish(uid, next.requestId, begin.token, response(next.requestId));
    }
    await expect(store.begin(uid, request)).rejects.toMatchObject({ code: 'failed-precondition' });
    const state = (await db.doc(`users/${uid}/assistantConversations/day-workout`).get()).data()!;
    expect(state.messages).toHaveLength(4); expect(state.replayReceipts).toHaveLength(5);
    expect(state.expireAt.toMillis()).toBe(now + 7 * 86_400_000);
    const expired = await store.begin(uid, { ...request, requestId: 'expired-request' });
    if (!('token' in expired)) throw Error('Missing lease');
    now += 4 * 60_000;
    await expect(store.finish(uid, 'expired-request', expired.token, response('expired-request'))).rejects.toMatchObject({ code: 'aborted' });
    await expect(store.begin(uid, { ...request, requestId: 'expired-request' })).rejects.toMatchObject({ code: 'failed-precondition' });
    await db.doc(`userDeletionTombstones/${uid}`).set({ createdAtMs: now });
    await expect(store.begin(uid, { ...request, requestId: 'blocked-request' })).rejects.toMatchObject({ code: 'permission-denied' });
  }, 30_000);
  it('reads at most five matching full strength prescriptions and preserves generated recipes through unchanged MCP tools', async () => {
    const uid = `day-context-${randomUUID()}`, user = db.doc(`users/${uid}`);
    await user.set({}); await user.collection('trainingPlanState').doc('current').set({ revision: 1, activePlanId: null });
    await user.collection('mcpConnections').doc('connection').set({ status: 'active', scopes: ['training-plans:read'] });
    const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Dumbbell squat', sets: [
      { id: 'one', ending: { kind: 'repetitions' as const, repetitions: 8 }, restAfterSeconds: 90, externalLoadKg: 0 },
      { id: 'two', ending: { kind: 'repetitions' as const, repetitions: 8 }, restAfterSeconds: 90, externalLoadKg: 12.5 },
    ] }] };
    for (let index = 0; index < 7; index++) {
      const id = `prior-${index}`, details = { ...strength, workoutId: id, revision: 1 };
      await user.collection('scheduledWorkouts').doc(id).set({ schemaVersion: 1, planId: null, localDate: `2026-10-${21 + index}`,
        title: 'Prior planned strength', lifecycle: 'planned', revision: 1, createdAtMs: 1, updatedAtMs: 1,
        structure: projectStrengthWorkoutToV1(details) });
      await user.collection('scheduledWorkouts').doc(id).collection('strengthDetails').doc('current').set(details);
    }
    const selected = { ...controls, sport: ActivityTypes.StrengthTraining, target: 'none' as const, trainingContext: true, equipment: ['dumbbells' as const] };
    const context = await readDayWorkoutTrainingContext(uid, selected, new Date('2026-10-28T12:00Z'), db);
    expect(context.previousStrength.map(item => item.localDate)).toEqual(['2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23']);
    const generatedStrength = validateDayWorkoutSuggestion({ kind: 'workout', title: 'Generated strength', rationale: 'Familiar prescription.', strength }, selected, context.previousStrength);
    expect(generatedStrength.draft!.strength!.exercises[0].sets.map(set => set.externalLoadKg)).toEqual([0, 12.5]);
    expect(generatedStrength.previousLoads).toEqual([{ exerciseId: 'squat', localDate: '2026-10-27' }]);
    const generatedRun = validateDayWorkoutSuggestion({ kind: 'workout', title: 'Generated run', rationale: 'Easy session.', structure: {
      version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'repeat', id: 'intervals', count: 3, steps: [
        { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 120 }, targets: [], note: 'Comfortable effort' },
        { kind: 'step', id: 'recovery', purpose: 'recovery', ending: { kind: 'time', seconds: 60 }, targets: [] },
      ] }],
    } }, { ...controls, timing: 'strict' });
    const reads = createFirestoreTrainingReads(() => db);
    const run = (tool: TrainingReadTool, args: unknown) => readTrainingPlans({ tool, arguments: args, uid,
      connectionId: 'connection', scopes: ['training-plans:read'] }, reads, { encode: JSON.stringify, decode: JSON.parse });
    for (const [id, suggestion] of [['generated-strength', generatedStrength], ['generated-run', generatedRun]] as const) {
      const draft = suggestion.draft!;
      await user.collection('scheduledWorkouts').doc(id).set({ schemaVersion: 1, planId: null, localDate: '2026-10-28', title: draft.title,
        lifecycle: 'planned', revision: 1, createdAtMs: 1, updatedAtMs: 1, structure: draft.structure, privateCanary: 'PRIVATE' });
      if (draft.strength) await user.collection('scheduledWorkouts').doc(id).collection('strengthDetails').doc('current')
        .set({ ...draft.strength, workoutId: id, revision: 1 });
      const workoutRef = JSON.stringify({ kind: 'workout', id, createdAtMs: 1 });
      const detail = TRAINING_READ_OUTPUTS.get_planned_workout_v3.parse(await run('get_planned_workout_v3', { workoutRef }));
      expect(detail.workout.structure).toEqual(draft.structure);
      expect(JSON.stringify(detail)).not.toContain('PRIVATE');
      if (draft.strength) {
        const companion = TRAINING_READ_OUTPUTS.get_strength_workout_details.parse(await run('get_strength_workout_details', { workoutRef }));
        expect(companion.details.exercises).toEqual(draft.strength.exercises);
      }
    }
    await user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').doc('plan').set({});
    await expect(readDayWorkoutTrainingContext(uid, selected, new Date('2026-10-28T12:00Z'), db)).rejects.toThrow();
  }, 30_000);
  it('retains the latest large UTF-8 response by evicting older replies while preserving replay receipts', async () => {
    const uid = `day-large-${randomUUID()}`; await db.doc(`users/${uid}`).set({});
    const store = createDayWorkoutStore(() => db);
    const suggestion = validateDayWorkoutSuggestion({ kind: 'workout', title: 'Detailed intervals', rationale: 'Review each effort.',
      structure: { version: 1, sport: ActivityTypes.Running, nodes: Array.from({ length: 100 }, (_, index) => ({
        kind: 'step', id: `step-${index}`, purpose: 'work', ending: { kind: 'time', seconds: 10 }, targets: [], note: '漢'.repeat(400),
      })) } }, controls);
    let latest!: GenerateDayWorkoutResponse;
    for (let index = 0; index < 4; index++) {
      const requestId = `large-request-${index}`;
      const begun = await store.begin(uid, { requestId, controls });
      if (!('token' in begun)) throw Error('Missing generation lease');
      latest = { ...response(requestId), ...suggestion };
      await store.finish(uid, requestId, begun.token, latest);
    }
    const persisted = (await db.doc(`users/${uid}/assistantConversations/day-workout`).get()).data()!;
    expect(Buffer.byteLength(JSON.stringify(persisted), 'utf8')).toBeLessThanOrEqual(400_000);
    expect(persisted.replayReceipts).toHaveLength(4);
    expect(persisted.messages.length).toBeLessThan(4);
    expect(await store.begin(uid, { requestId: latest.requestId, controls })).toEqual({ response: latest });
    await expect(store.begin(uid, { requestId: 'large-request-0', controls })).rejects.toMatchObject({ code: 'failed-precondition' });
  }, 30_000);
});
