import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls, type GenerateDayWorkoutResponse } from '../../../shared/day-workout';
import { projectStrengthWorkoutToV1 } from '../../../shared/strength-workout';
import { createMorningWorkoutStore } from './morning-workout-store';
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
  it('claims one included morning result across devices, preserves preferences and never touches Assistant quota', async () => {
    const uid = `morning-${randomUUID()}`;
    let now = new Date('2026-10-30T07:00Z');
    const saved = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki') };
    const user = db.doc(`users/${uid}`); await user.set({});
    await user.collection('config').doc('settings').set({ appSettings: { morningWorkout: saved } });
    const store = createMorningWorkoutStore(() => db, () => now);
    const first = await store.read(uid); expect(first.status.state).toBe('waiting');
    const concurrent = await Promise.all([store.begin(uid, first.preferences!), store.begin(uid, first.preferences!)]);
    const token = concurrent.find(value => value !== null)!;
    expect(concurrent.filter(value => value !== null)).toHaveLength(1);
    await store.charge(uid, '2026-10-30', token);
    const result = response('morning:2026-10-30');
    await store.finish(uid, '2026-10-30', token, 'ready', saved.controls, result);
    expect((await store.read(uid)).status).toMatchObject({ state: 'ready', result, controls: saved.controls });
    await user.collection('config').doc('settings').set({ appSettings: { morningWorkout: { ...saved,
      controls: { ...saved.controls, minutes: 60 } } } });
    expect((await store.read(uid)).status.controls?.minutes).toBe(30);
    expect(await store.begin(uid, (await store.read(uid)).preferences!)).toBeNull();
    expect((await user.collection('assistantUsage').get()).empty).toBe(true);
    const state = (await user.collection('assistantConversations').doc('morning-workout').get()).data()!;
    expect(state.expireAt.toMillis()).toBe(now.getTime() + 7 * 86_400_000);
    expect(Object.keys(state).sort()).toEqual(['expireAt', 'messages', 'version']);
    expect(state.messages['2026-10-30'].result).toEqual(result);
    expect((await user.collection('scheduledWorkouts').get()).empty).toBe(true);
    await store.dismiss(uid, '2026-10-30'); expect((await store.read(uid)).status.state).toBe('dismissed');
    now = new Date('2026-10-31T07:00Z');
    await expect(store.dismiss(uid, '2026-10-30')).rejects.toMatchObject({ code: 'aborted' });
    const tomorrow = (await store.read(uid)).preferences!;
    const nextToken = await store.begin(uid, tomorrow); expect(nextToken).toBeTruthy();
    await store.charge(uid, '2026-10-31', nextToken!);
    await store.finish(uid, '2026-10-31', nextToken!, 'failed');
    expect(await store.begin(uid, tomorrow)).toBeNull();
    await db.doc(`userDeletionTombstones/${uid}`).set({ createdAtMs: now.getTime() });
    await expect(store.read(uid)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(store.dismiss(uid, '2026-10-30')).rejects.toMatchObject({ code: 'permission-denied' });
  }, 30_000);
  it('releases uncharged context failures, fences opt-outs and never reclaims an expired model lease', async () => {
    const uid = `morning-fences-${randomUUID()}`;
    let now = new Date('2026-10-30T07:00Z');
    const user = db.doc(`users/${uid}`); await user.set({});
    const preferences = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki') };
    const settings = user.collection('config').doc('settings'); await settings.set({ appSettings: { morningWorkout: preferences } });
    const store = createMorningWorkoutStore(() => db, () => now);
    const first = await store.begin(uid, preferences);
    await store.finish(uid, '2026-10-30', first!, 'failed');
    const second = await store.begin(uid, preferences); expect(second).not.toBe(first);
    await settings.update({ 'appSettings.morningWorkout.controls.timelineContext': false });
    await expect(store.charge(uid, '2026-10-30', second!)).rejects.toMatchObject({ code: 'aborted' });
    await store.finish(uid, '2026-10-30', second!, 'failed');
    const next = (await store.read(uid)).preferences!;
    const uncharged = await store.begin(uid, next);
    now = new Date(now.getTime() + 4 * 60_000);
    expect((await store.read(uid)).status.state).toBe('waiting');
    const third = await store.begin(uid, next); expect(third).not.toBe(uncharged);
    await expect(store.charge(uid, '2026-10-30', uncharged!)).rejects.toMatchObject({ code: 'aborted' });
    await store.charge(uid, '2026-10-30', third!);
    now = new Date(now.getTime() + 4 * 60_000);
    expect((await store.read(uid)).status.state).toBe('failed');
    expect(await store.begin(uid, next)).toBeNull();
    await expect(store.finish(uid, '2026-10-30', third!, 'ready', next.controls, response('morning:2026-10-30'))).rejects.toMatchObject({ code: 'aborted' });
    await settings.update({ 'appSettings.morningWorkout.enabled': false });
    expect((await store.read(uid)).status).toEqual({ localDate: '', state: 'off' });
  }, 30_000);

  it('reclaims unused skip receipts but never guesses that missing allowance metadata means uncharged', async () => {
    const uid = `morning-proof-${randomUUID()}`; let now = new Date('2026-10-30T07:00Z');
    const user = db.doc(`users/${uid}`); await user.set({});
    const preferences = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki') };
    await user.collection('config').doc('settings').set({ appSettings: { morningWorkout: preferences } });
    const store = createMorningWorkoutStore(() => db, () => now);
    const first = await store.begin(uid, preferences);
    await store.finish(uid, '2026-10-30', first!, 'planned');
    const deferred = await store.begin(uid, preferences); expect(deferred).toBeTruthy(); expect(deferred).not.toBe(first);
    await store.finish(uid, '2026-10-30', deferred!, 'waiting-sleep');
    expect((await store.read(uid)).status).toEqual({ localDate: '2026-10-30', state: 'waiting-sleep' });
    // Temporary day coverage must not erase an earlier unspent morning deferral.
    for (const covered of ['planned', 'completed', 'rest-day'] as const) {
      const paused = await store.begin(uid, preferences);
      await store.finish(uid, '2026-10-30', paused!, covered);
      expect((await store.read(uid)).status).toEqual({ localDate: '2026-10-30', state: 'waiting-sleep' });
    }
    const retry = await store.begin(uid, preferences);
    await store.finish(uid, '2026-10-30', retry!, 'failed');
    expect((await store.read(uid)).status.state).toBe('waiting-sleep');
    await store.begin(uid, preferences);
    now = new Date(now.getTime() + 4 * 60_000);
    expect((await store.read(uid)).status.state).toBe('waiting-sleep');
    const contenders = await Promise.all([store.begin(uid, preferences), store.begin(uid, preferences)]);
    const winners = contenders.filter((value): value is string => value !== null);
    expect(winners).toHaveLength(1); const second = winners[0]; expect(second).not.toBe(deferred);
    const ref = user.collection('assistantConversations').doc('morning-workout');
    const state = (await ref.get()).data()!; delete state.messages['2026-10-30'].charged; await ref.set(state);
    now = new Date(now.getTime() + 4 * 60_000);
    expect((await store.read(uid)).status.state).toBe('failed');
    expect(await store.begin(uid, preferences)).toBeNull();
    await expect(store.finish(uid, '2026-10-30', second!, 'failed')).rejects.toMatchObject({ code: 'aborted' });
  }, 30_000);

});
