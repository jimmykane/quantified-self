import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls, type GenerateDayWorkoutResponse } from '../../../shared/day-workout';
import { projectStrengthWorkoutToV1 } from '../../../shared/strength-workout';
import { createDailyWorkoutSuggestionStore, readDailyWorkoutHistoryImportActive } from './daily-workout-suggestion-store';
import { createDayWorkoutStore } from './day-workout-store';
import { readDayWorkoutTrainingContext } from './day-workout-context';
import { validateDayWorkoutSuggestion } from './day-workout-validation';
import { createFirestoreTrainingReads, readTrainingPlans } from '../mcp/training-plans.service';
import { TRAINING_READ_OUTPUTS, type TrainingReadTool } from '../mcp/training-plans.schemas';
import { collectDailyWorkoutSuggestionCoverage, runDailyWorkoutSuggestion, type DailyWorkoutSuggestionDependencies } from './daily-workout-suggestion';
import type { AssistantMcpSession } from './mcp-session';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Calendar generation private state and existing MCP read-back', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error('Loopback emulator required');
  const db = new Firestore({ projectId: 'demo-day-workout' });
  afterAll(() => db.terminate());
  const controls = defaultDayWorkoutControls('2026-10-28', 'Europe/Helsinki');
  const response = (requestId: string): GenerateDayWorkoutResponse => ({ requestId, observedAt: '2026-10-28T12:00:00Z',
    kind: 'rest', rationale: 'Rest suggestion.', draft: null, usedContext: [], missingContext: [], previousLoads: [] });
  it('honors standalone calendar rest without a plan and restores the same charged daily result after removal', async () => {
    const uid = `calendar-rest-${randomUUID()}`, user = db.collection('users').doc(uid);
    const now = new Date('2026-10-28T08:00Z');
    const selected = { ...defaultDayWorkoutControls('2026-10-28', 'UTC'), sleepContext: false };
    await user.set({});
    await user.collection('config').doc('settings').set({ appSettings: { dailyWorkoutSuggestion: { enabled: true, followRoutine: false, controls: selected } } });
    await user.collection('mcpConnections').doc('calendar-reader').set({ scopes: ['training-plans:read'], status: 'active', grantId: 'grant', createdAtMs: 1 });
    const marker = user.collection('trainingRestDays').doc(selected.localDate);
    const reads = createFirestoreTrainingReads(() => db);
    const read = (tool: TrainingReadTool, args: Record<string, unknown>) => readTrainingPlans({ uid, connectionId: 'calendar-reader',
      scopes: ['training-plans:read'], tool, arguments: args }, reads, { encode: () => 'unused-ref', decode: () => ({}) }, now.getTime());
    const callTool: Pick<AssistantMcpSession, 'callTool'>['callTool'] = async (name, args = {}) => ({ structuredContent: name === 'query_activities'
      ? { scanComplete: true, activities: [] } : await read(name as TrainingReadTool, args) });
    const generate = vi.fn(async () => ({ kind: 'rest' as const, rationale: 'A recovery day.' }));
    const deps: DailyWorkoutSuggestionDependencies = { store: createDailyWorkoutSuggestionStore(() => db, () => now), now: () => now,
      importActive: id => readDailyWorkoutHistoryImportActive(id, db), legal: async () => undefined, pro: async () => true, selectSport: async () => selected,
      coverage: async () => collectDailyWorkoutSuggestionCoverage(selected, { callTool }),
      context: async () => ({ evidence: { daily: { activitiesToday: { scanComplete: true, activities: [] },
        plannedWorkouts: { scanComplete: true, completionChecked: true, workouts: [], restDayContext: { status: 'none' } } } },
      usedContext: [], missingContext: [], previousStrength: [], references: [] }), generate, log: () => undefined };
    const input = { mode: 'daily-suggestion', action: 'prepare' }, identity = { auth: { uid }, app: {} };
    try {
      await marker.set({ schemaVersion: 1, localDate: selected.localDate, isRestDay: true, revision: 1, privateCanary: 'DO-NOT-EXPOSE' });
      expect(await read('get_training_calendar_rest_days', { startDate: selected.localDate, endDate: selected.localDate }))
        .toEqual({ startDate: selected.localDate, endDate: selected.localDate, scanComplete: true, restDays: [selected.localDate] });
      expect((await runDailyWorkoutSuggestion(input, identity, deps)).state).toBe('rest-day'); expect(generate).not.toHaveBeenCalled();
      await marker.update({ isRestDay: false, revision: 2 });
      const ready = await runDailyWorkoutSuggestion(input, identity, deps); expect(ready.state).toBe('ready'); expect(generate).toHaveBeenCalledOnce();
      await marker.update({ isRestDay: true, revision: 3 });
      expect((await runDailyWorkoutSuggestion(input, identity, deps)).state).toBe('rest-day');
      await marker.update({ isRestDay: false, revision: 4 });
      expect(await runDailyWorkoutSuggestion(input, identity, deps)).toEqual(ready); expect(generate).toHaveBeenCalledOnce();
      expect((await deps.store.read(uid)).status).toEqual(ready);
      await user.collection('mcpConnections').doc('calendar-reader').update({ status: 'revoked' });
      await expect(read('get_training_calendar_rest_days', { startDate: selected.localDate, endDate: selected.localDate })).rejects.toThrow();
    } finally { await db.recursiveDelete(user); }
  });
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
  it('fences goal edits before charging and keeps charged event guidance after later edits', async () => {
    const uid = `daily-goals-${randomUUID()}`, now = new Date('2026-11-03T09:00Z');
    const user = db.doc(`users/${uid}`); await user.set({});
    const saved = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-11-03', 'Europe/Athens') };
    await user.collection('config').doc('settings').set({ appSettings: { dailyWorkoutSuggestion: saved } });
    const state = user.collection('trainingGoalState').doc('current'); await state.set({ revision: 1 });
    const store = createDailyWorkoutSuggestionStore(() => db, () => now);
    const token = (await store.begin(uid, saved))!;
    await state.update({ revision: 2 });
    await expect(store.charge(uid, '2026-11-03', token, false, 1)).rejects.toMatchObject({ code: 'aborted' });
    expect((await user.collection('assistantConversations').doc('daily-workout-suggestion').get()).get('messages.2026-11-03.charged')).toBe(false);
    await store.finish(uid, '2026-11-03', token, 'failed');
    const current = (await store.begin(uid, saved))!;
    await store.charge(uid, '2026-11-03', current, false, 2);
    const advice = { version: 1 as const, kind: 'event-advice' as const, requestId: 'daily-suggestion:2026-11-03', observedAt: now.toISOString(),
      rationale: 'Follow the event plan.', events: [{ name: 'Race', localDate: '2026-11-03' }], usedContext: [], missingContext: [], draft: null, previousLoads: [] as [] };
    await state.update({ revision: 3 });
    await store.finish(uid, '2026-11-03', current, 'ready', saved.controls, advice);
    expect((await store.read(uid)).status.result).toEqual(advice);
    expect(await store.begin(uid, saved)).toBeNull();
  }, 30000);
  it('claims one included daily result after noon across devices, preserves preferences and never touches Assistant quota', async () => {
    const uid = `daily-suggestion-${randomUUID()}`;
    let now = new Date('2026-10-30T13:00Z');
    const saved = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki') };
    const user = db.doc(`users/${uid}`); await user.set({});
    await user.collection('config').doc('settings').set({ appSettings: { dailyWorkoutSuggestion: saved } });
    const store = createDailyWorkoutSuggestionStore(() => db, () => now);
    const first = await store.read(uid); expect(first.status.state).toBe('waiting');
    const concurrent = await Promise.all([store.begin(uid, first.preferences!), store.begin(uid, first.preferences!)]);
    const token = concurrent.find(value => value !== null)!;
    expect(concurrent.filter(value => value !== null)).toHaveLength(1);
    await store.charge(uid, '2026-10-30', token);
    const result = response('daily-suggestion:2026-10-30');
    await store.finish(uid, '2026-10-30', token, 'ready', saved.controls, result);
    expect((await store.read(uid)).status).toMatchObject({ state: 'ready', result, controls: saved.controls });
    await user.collection('config').doc('settings').set({ appSettings: { dailyWorkoutSuggestion: { ...saved,
      controls: { ...saved.controls, minutes: 60 } } } });
    expect((await store.read(uid)).status.controls?.minutes).toBe(30);
    expect(await store.begin(uid, (await store.read(uid)).preferences!)).toBeNull();
    expect((await user.collection('assistantUsage').get()).empty).toBe(true);
    const state = (await user.collection('assistantConversations').doc('daily-workout-suggestion').get()).data()!;
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
  it.each([false, true])('retains import deferral, fences a late import and preserves one charged result (explicit override: %s)', async useAvailableData => {
    const uid = `daily-import-${randomUUID()}`, user = db.doc(`users/${uid}`), now = new Date('2026-11-02T08:00Z');
    const selected = { ...defaultDayWorkoutControls('2026-11-02', 'UTC'), sleepContext: false };
    await user.set({});
    await user.collection('config').doc('settings').set({ appSettings: { dailyWorkoutSuggestion: { enabled: true, followRoutine: false, controls: selected } } });
    const meta = user.collection('meta').doc('Garmin API');
    await meta.set({ connectionHistoryImport: { active: true, steps: [{ status: 'requesting', resources: ['activities'] }] } });
    const generate = vi.fn(async () => ({ kind: 'rest' as const, rationale: 'Recovery day.' }));
    const context = vi.fn(async () => ({ evidence: { daily: { activitiesToday: { scanComplete: true, activities: [] },
      plannedWorkouts: { scanComplete: true, completionChecked: true, workouts: [], restDayContext: { status: 'none' } } } },
      usedContext: [], missingContext: [], previousStrength: [], references: [] }));
    const deps: DailyWorkoutSuggestionDependencies = { store: createDailyWorkoutSuggestionStore(() => db, () => now), now: () => now,
      legal: async () => undefined, pro: async () => true, selectSport: async () => selected, coverage: async () => null,
      importActive: id => readDailyWorkoutHistoryImportActive(id, db), context, generate, log: () => undefined };
    const input = { mode: 'daily-suggestion', action: 'prepare' }, identity = { auth: { uid }, app: {} };
    try {
      expect((await runDailyWorkoutSuggestion(input, identity, deps)).state).toBe('waiting-import');
      expect(context).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
      expect((await user.collection('assistantConversations').doc('daily-workout-suggestion').get()).get('messages.2026-11-02.charged')).toBe(false);
      await meta.set({ connectionHistoryImport: { active: false, steps: [{ status: 'requested', resources: ['activities'] }] } });
      const charge = deps.store.charge;
      let startImportAtCharge = true;
      deps.store.charge = async (...args) => {
        if (startImportAtCharge) {
          startImportAtCharge = false;
          await meta.set({ connectionHistoryImport: { active: true, steps: [{ status: 'requesting', resources: ['activities'] }] } });
        }
        return charge(...args);
      };
      // The preflight saw no import, but one begins immediately before the allowance transaction.
      expect((await runDailyWorkoutSuggestion(input, identity, deps)).state).toBe('waiting-import');
      expect(generate).not.toHaveBeenCalled();
      expect((await user.collection('assistantConversations').doc('daily-workout-suggestion').get()).get('messages.2026-11-02.charged')).toBe(false);
      // Disconnect can retain the old active projection; it must not keep blocking this user.
      if (!useAvailableData) await meta.set({ connectionState: null, connectionHistoryImport: { active: true, steps: [{ status: 'requesting', resources: ['activities'] }] } });
      const ready = await runDailyWorkoutSuggestion(useAvailableData
        ? { mode: 'daily-suggestion', action: 'use-available-data', localDate: selected.localDate } : input, identity, deps);
      expect(ready.state).toBe('ready');
      if (useAvailableData) expect(ready.result?.missingContext.join(' ')).toContain('History may still be importing');
      await meta.set({ connectionHistoryImport: { active: true, steps: [{ status: 'retrying', resources: ['activities'] }] } });
      expect(await runDailyWorkoutSuggestion(input, identity, deps)).toEqual(ready);
      expect(generate).toHaveBeenCalledOnce();
    } finally { await db.recursiveDelete(user); }
  });
  it('reads provider choices from the existing settings snapshot without changing a charged day or cached recipe', async () => {
    const uid = `provider-aware-daily-${randomUUID()}`; let now = new Date('2026-11-02T07:00Z');
    const user = db.doc(`users/${uid}`); await user.set({});
    const saved = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-11-02', 'Europe/Helsinki') };
    const settings = user.collection('config').doc('settings');
    await settings.set({ appSettings: { dailyWorkoutSuggestion: saved, dailyWorkoutDelivery: { enabled: true, providers: ['garmin'] } } });
    const store = createDailyWorkoutSuggestionStore(() => db, () => now), initial = await store.read(uid);
    expect(initial.deliveryPreferences).toEqual({ enabled: true, providers: ['garmin'] });
    const token = await store.begin(uid, initial.preferences!); expect(token).toBeTruthy();
    await store.charge(uid, '2026-11-02', token!);
    await settings.update({ 'appSettings.dailyWorkoutDelivery': { enabled: true, providers: ['wahoo'] } });
    await store.assertActive(uid, '2026-11-02', token!);
    const result = { ...response('daily-suggestion:2026-11-02'), usedContext: ['Garmin local workout formats'] };
    await store.finish(uid, '2026-11-02', token!, 'ready', initial.preferences!.controls, result);
    const updated = await store.read(uid);
    expect(updated.deliveryPreferences).toEqual({ enabled: true, providers: ['wahoo'] });
    expect(updated.status.result).toEqual(result); expect(updated.status).not.toHaveProperty('deliveryPreferences');
    expect(await store.begin(uid, updated.preferences!)).toBeNull();
    now = new Date('2026-11-03T07:00Z');
    const tomorrow = await store.read(uid); expect(tomorrow.status.state).toBe('waiting');
    expect(tomorrow.deliveryPreferences).toEqual({ enabled: true, providers: ['wahoo'] });
    expect(await store.begin(uid, tomorrow.preferences!)).toBeTruthy();
    await settings.update({ 'appSettings.dailyWorkoutDelivery': { enabled: true, providers: ['garmin'], injectedToken: 'private-canary' } });
    expect((await store.read(uid)).deliveryPreferences).toEqual({ enabled: false, providers: [] });
  });
  it('releases uncharged context failures, fences opt-outs and never reclaims an expired model lease', async () => {
    const uid = `daily-suggestion-fences-${randomUUID()}`;
    let now = new Date('2026-10-30T07:00Z');
    const user = db.doc(`users/${uid}`); await user.set({});
    const preferences = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki') };
    const settings = user.collection('config').doc('settings'); await settings.set({ appSettings: { dailyWorkoutSuggestion: preferences } });
    const store = createDailyWorkoutSuggestionStore(() => db, () => now);
    const first = await store.begin(uid, preferences);
    await store.finish(uid, '2026-10-30', first!, 'failed');
    const second = await store.begin(uid, preferences); expect(second).not.toBe(first);
    await settings.update({ 'appSettings.dailyWorkoutSuggestion.controls.timelineContext': false });
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
    await expect(store.finish(uid, '2026-10-30', third!, 'ready', next.controls, response('daily-suggestion:2026-10-30'))).rejects.toMatchObject({ code: 'aborted' });
    await settings.update({ 'appSettings.dailyWorkoutSuggestion.enabled': false });
    expect((await store.read(uid)).status).toEqual({ localDate: '', state: 'off' });
  }, 30_000);

  it('reclaims unused skip receipts but never guesses that missing allowance metadata means uncharged', async () => {
    const uid = `daily-suggestion-proof-${randomUUID()}`; let now = new Date('2026-10-30T07:00Z');
    const user = db.doc(`users/${uid}`); await user.set({});
    const preferences = { enabled: true, followRoutine: true, controls: defaultDayWorkoutControls('2026-10-30', 'Europe/Helsinki') };
    await user.collection('config').doc('settings').set({ appSettings: { dailyWorkoutSuggestion: preferences } });
    const store = createDailyWorkoutSuggestionStore(() => db, () => now);
    const first = await store.begin(uid, preferences);
    await store.finish(uid, '2026-10-30', first!, 'planned');
    const deferred = await store.begin(uid, preferences); expect(deferred).toBeTruthy(); expect(deferred).not.toBe(first);
    await store.finish(uid, '2026-10-30', deferred!, 'waiting-sleep');
    expect((await store.read(uid)).status).toEqual({ localDate: '2026-10-30', state: 'waiting-sleep' });
    // Temporary day coverage must not erase an earlier unspent sleep deferral.
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
    const ref = user.collection('assistantConversations').doc('daily-workout-suggestion');
    const state = (await ref.get()).data()!; delete state.messages['2026-10-30'].charged; await ref.set(state);
    now = new Date(now.getTime() + 4 * 60_000);
    expect((await store.read(uid)).status.state).toBe('failed');
    expect(await store.begin(uid, preferences)).toBeNull();
    await expect(store.finish(uid, '2026-10-30', second!, 'failed')).rejects.toMatchObject({ code: 'aborted' });
  }, 30_000);

});
