import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { createMcpServer } from './server';
import { randomUUID } from 'node:crypto';
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMcpDataService, encodeOpaqueValue, decodeOpaqueValue } from './data.service';
import { applyTrainingChanges, previewTrainingCalendarRestDay, getTrainingChangeStatus, previewTrainingChanges, previewTrainingPlanPhases, previewTrainingRestDays, type TrainingWriteDependencies } from './training-plans-write.service';
import { createFirestoreTrainingReads, readTrainingPlans, } from './training-plans.service';
import { TRAINING_WRITE_OUTPUTS, type TrainingReadTool } from './training-plans.schemas';
import { mutateTrainingScheduleForUser } from '../training-plans/persistence';
import { readPlanSnapshotAtRevision } from '../training-plans/history';
import { restoreTrainingScheduleRevisionForUser } from '../training-plans/restore';
import { deleteTrainingPlanForUser } from '../training-plans/delete-training-plan';
import { FakeTrainingTransport } from '../training-plans/delivery/test-support/fake-transport';
import { reconcileTrainingDeliveryPage } from '../training-plans/delivery/store';
import { processTrainingDelivery } from '../training-plans/delivery/worker';
import { createAssistantConversationStore } from '../assistant/conversation-store';
import { runApplyAssistantTrainingProposal } from '../assistant/callable';
import { readDayWorkoutTrainingContext } from '../assistant/day-workout-context';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';

// All writes and cleanup are confined to a generated synthetic owner in a loopback demo emulator.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Training plan phases in isolated Firestore', { timeout: 30_000 }, () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-training-phases' });
  const scopes = ['training-plans:read', 'training-plans:write', 'training-delivery:write'];
  const phases = { version: 1 as const, items: [{ id: 'base', name: 'Base', startLocalDate: '2026-10-24',
    endLocalDate: '2026-10-25', description: 'Authored context only', color: 'blue' as const }] };
  let uid: string; let sequence: number; let deps: TrainingWriteDependencies; let transport: FakeTrainingTransport;
  const user = () => db.collection('users').doc(uid);
  const plan = () => user().collection('trainingPlans').doc('plan');
  const workout = () => user().collection('scheduledWorkouts').doc('run');
  const revisions = (state: number, revision: number) => [{ scope: 'state' as const, id: 'current', revision: state },
    { scope: 'plan' as const, id: 'plan', revision }];
  const reference = (connectionId = 'connection') => encodeOpaqueValue('training_read',
    { kind: 'plan', id: 'plan', createdAtMs: deps.now() }, uid, connectionId);
  const phaseInput = (connectionId = 'connection') => ({ uid, connectionId, scopes, arguments: {
    expectedScheduleRevision: 2, change: { kind: 'set-plan-phases' as const, plan: { ref: reference(connectionId) },
      expectedPlanRevision: 2, phases, startDate: '2026-10-24', endDate: '2026-10-31', confirmPlanRangeExtension: false } } });
  const apply = (proposalRef: string, connectionId = 'connection') => applyTrainingChanges({ uid, connectionId, scopes,
    arguments: { proposalRef, permissionMode: 'schedule' } }, deps);
  const read = (tool: TrainingReadTool) => readTrainingPlans({ uid, connectionId: 'connection', scopes, tool,
    arguments: { planRef: reference() } }, createFirestoreTrainingReads(() => db), {
    encode: (value, owner, connection) => encodeOpaqueValue('training_read', value, owner, connection),
    decode: (value, owner, connection) => decodeOpaqueValue('training_read', value, owner, connection, 'Training reference'),
  }, deps.now());
  const drain = async () => {
    for (let page = 0; page < 10; page++) if (!await reconcileTrainingDeliveryPage(deps.runtime, uid)) return;
    throw new Error('Unbounded fixture scan');
  };
  beforeEach(async () => {
    uid = `phase-${randomUUID()}`; sequence = 0; transport = new FakeTrainingTransport();
    const now = () => Date.parse('2026-10-23T12:00:00Z');
    deps = { db, now, randomId: () => `id-${++sequence}`, runtime: { db, now, hasPro: async () => true,
      connection: async () => ({ state: 'connected', destinationKey: 'fixture-account', generation: 'connection-1', epoch: 0 }),
      transport: provider => provider === 'garmin' ? transport : null } };
    await user().set({ test: true });
    await user().collection('mcpConnections').doc('connection').set({ status: 'active', scopes, grantId: 'grant-1', createdAtMs: 1, revokedAtMs: null });
    await mutateTrainingScheduleForUser(uid, { mutationId: randomUUID(), expectedRevisions: [{ scope: 'state', id: 'current', revision: 0 }],
      operation: { kind: 'create-plan', planId: 'plan', name: 'Autumn', startLocalDate: '2026-10-24', endLocalDate: '2026-10-31', activate: true } }, { db, nowMs: now() });
    await mutateTrainingScheduleForUser(uid, { mutationId: randomUUID(), expectedRevisions: revisions(1, 1), operation: {
      kind: 'create-workout', workoutId: 'run', planId: 'plan', localDate: '2026-10-25', title: 'Easy run', confirmPlanRangeExtension: false,
      structure: { version: 1, sport: ActivityTypes.Running, nodes: [{ id: 'work', kind: 'step', purpose: 'work', ending: { kind: 'time', seconds: 1800 }, targets: [] }] },
    } }, { db, nowMs: now() });
  });
  afterEach(async () => { await db.recursiveDelete(user()); });
  afterAll(async () => { await db.terminate(); });

  const calendarInput = (isRestDay = true, localDate = '2026-11-15', connectionId = 'connection') => ({ uid, connectionId, scopes,
    arguments: { localDate, isRestDay } });

  it('adds a no-plan rest day through the MCP transport, approved Apply and real Firestore read-back', async () => {
    await db.recursiveDelete(plan());
    await user().collection('trainingPlanState').doc('current').update({ activePlanId: null });
    const dataService = { ...createMcpDataService(),
      previewTrainingCalendarRestDay: (input: Parameters<typeof previewTrainingCalendarRestDay>[0]) => previewTrainingCalendarRestDay(input, deps),
      applyTrainingChanges: (input: Parameters<typeof applyTrainingChanges>[0]) => applyTrainingChanges(input, deps),
      readTrainingPlans: (input: Parameters<typeof readTrainingPlans>[0]) => readTrainingPlans(input, createFirestoreTrainingReads(() => db), {
        encode: () => 'unused', decode: () => ({}) }, deps.now()),
    };
    const server = createMcpServer({ uid, connectionId: 'connection', scopes, clientId: 'https://example.test/mcp.json' }, 'https://quantified-self.io', dataService);
    const client = new Client({ name: 'calendar-rest-emulator', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const tools = (await client.listTools()).tools;
      expect(tools.find(tool => tool.name === 'apply_training_changes')?.annotations?.readOnlyHint).toBe(false);
      const previewResult = await client.callTool({ name: 'preview_training_calendar_rest_day', arguments: { localDate: '2026-11-15', isRestDay: true } });
      expect(previewResult.isError).not.toBe(true);
      const preview = TRAINING_WRITE_OUTPUTS.preview_training_calendar_rest_day.parse(previewResult.structuredContent);
      expect((await user().collection('trainingRestDays').get()).empty).toBe(true);
      const approved = await client.callTool({ name: 'apply_training_changes', arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' } });
      expect(approved.isError).not.toBe(true);
      expect(approved.structuredContent).toMatchObject({ status: 'applied', changes: [{ kind: 'set-calendar-rest-day', status: 'applied' }] });
      const readBack = await client.callTool({ name: 'get_training_calendar_rest_days', arguments: { startDate: '2026-11-15', endDate: '2026-11-15' } });
      expect(readBack.isError).not.toBe(true); expect(readBack.structuredContent).toMatchObject({ restDays: ['2026-11-15'], scanComplete: true });
      expect(transport.calls).toEqual([]);
    } finally { await client.close(); await server.close(); }
  });

  it('previews and atomically applies standalone calendar rest with no plan; replay cannot resurrect removed intent', async () => {
    await db.recursiveDelete(plan());
    await user().collection('trainingPlanState').doc('current').update({ activePlanId: null });
    await workout().update({ planId: null });
    const original = (await workout().get()).data(), marker = user().collection('trainingRestDays').doc('2026-11-15');
    const beforeState = (await user().collection('trainingPlanState').doc('current').get()).data();
    const preview = await previewTrainingCalendarRestDay(calendarInput(), deps);
    expect(preview.calendarRestDayReview).toEqual({ localDate: '2026-11-15', before: false, after: true });
    expect((await marker.get()).exists).toBe(false);
    const [first, replay] = await Promise.all([apply(preview.proposalRef), apply(preview.proposalRef)]);
    expect(replay).toEqual(first);
    expect((await marker.get()).data()).toEqual({ schemaVersion: 1, localDate: '2026-11-15', isRestDay: true, revision: 1 });
    const readCalendar = () => readTrainingPlans({ uid, connectionId: 'connection', scopes, tool: 'get_training_calendar_rest_days',
      arguments: { startDate: '2026-11-15', endDate: '2026-11-15' } }, createFirestoreTrainingReads(() => db), {
        encode: () => 'unused', decode: () => ({}) }, deps.now());
    expect(await readCalendar()).toMatchObject({ restDays: ['2026-11-15'] });
    const removal = await previewTrainingCalendarRestDay(calendarInput(false), deps);
    expect(removal.calendarRestDayReview).toMatchObject({ before: true, after: false });
    await apply(removal.proposalRef); expect(await readCalendar()).toMatchObject({ restDays: [] });
    expect(await apply(preview.proposalRef)).toEqual(first);
    expect((await marker.get()).data()).toMatchObject({ isRestDay: false, revision: 2 });
    expect(await getTrainingChangeStatus({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' } }, deps)).toMatchObject({ state: 'applied', result: first });
    expect((await workout().get()).data()).toEqual(original);
    expect((await user().collection('trainingPlanState').doc('current').get()).data()).toEqual(beforeState);
    expect((await user().collection('trainingPlans').get()).empty).toBe(true);
    expect(transport.calls).toEqual([]);
  }, 30_000);

  it('preserves overlapping plan rest and workouts; no-op removals create no marker', async () => {
    const marker = user().collection('trainingRestDays').doc('2026-10-25');
    const before = (await workout().get()).data();
    const noOp = await previewTrainingCalendarRestDay(calendarInput(false, '2026-10-25'), deps);
    expect((await apply(noOp.proposalRef)).changes[0].status).toBe('already_applied'); expect((await marker.get()).exists).toBe(false);
    await plan().update({ restDays: ['2026-10-26'] });
    await apply((await previewTrainingCalendarRestDay(calendarInput(true, '2026-10-26'), deps)).proposalRef);
    await apply((await previewTrainingCalendarRestDay(calendarInput(false, '2026-10-26'), deps)).proposalRef);
    expect((await plan().get()).get('restDays')).toEqual(['2026-10-26']); expect((await workout().get()).data()).toEqual(before);
  });

  it('rejects a stale calendar preview even when the marker was changed back to the same value', async () => {
    const preview = await previewTrainingCalendarRestDay(calendarInput(), deps);
    await user().collection('trainingRestDays').doc('2026-11-15').set({ schemaVersion: 1, localDate: '2026-11-15', isRestDay: false, revision: 2 });
    await expect(apply(preview.proposalRef)).rejects.toThrow('changed');
    expect((await user().collection('trainingRestDays').doc('2026-11-15').get()).get('revision')).toBe(2);
  });

  it.each(['grant', 'revoked', 'deleted', 'expired', 'foreign'])('rejects calendar Apply after lost authority: %s', async reason => {
    const preview = await previewTrainingCalendarRestDay(calendarInput(), deps);
    if (reason === 'grant') await user().collection('mcpConnections').doc('connection').update({ grantId: 'replacement' });
    if (reason === 'revoked') await user().collection('mcpConnections').doc('connection').update({ revokedAtMs: deps.now() });
    if (reason === 'deleted') await db.collection('userDeletionTombstones').doc(uid).set({});
    const scoped = reason === 'expired' ? { ...deps, now: () => deps.now() + 16 * 60_000 } : deps;
    try {
      await expect(applyTrainingChanges({ uid, connectionId: reason === 'foreign' ? 'other' : 'connection', scopes,
        arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' } }, scoped)).rejects.toThrow();
      expect((await user().collection('trainingRestDays').get()).empty).toBe(true);
    } finally { if (reason === 'deleted') await db.collection('userDeletionTombstones').doc(uid).delete(); }
  });

  it('requires independent read and plan-write grants and rejects injected identity', async () => {
    for (const grants of [[], ['training-plans:read'], ['training-plans:write'], ['training-plans:read', 'training-delivery:write']]) {
      await expect(previewTrainingCalendarRestDay({ ...calendarInput(), scopes: grants }, deps)).rejects.toThrow();
    }
    await expect(previewTrainingCalendarRestDay({ ...calendarInput(), arguments: { ...calendarInput().arguments, uid: 'other' } }, deps)).rejects.toThrow();
  });

  it.each([false, true])('keeps Assistant calendar rest behind its complete review and explicit Apply: %s', async confirm => {
    const store = createAssistantConversationStore({ db: () => db, now: () => new Date(deps.now()), createId: () => `chat-${++sequence}` });
    const chat = await store.resetConversation(uid, 'coordinate_free', false, null, true, true, false);
    const begun = await store.beginTurn(uid, chat.conversationId, undefined, undefined, 'coordinate_free', false, true, true, false);
    if (begun.kind !== 'started') throw Error('Expected turn.');
    const preview = await previewTrainingCalendarRestDay(calendarInput(true, '2026-11-15', `first-party-assistant-v1:${chat.conversationId}`), deps);
    const createdAt = new Date(deps.now()).toISOString();
    await store.completeTurn(uid, begun, { id: 'request', role: 'user', createdAt, text: 'Mark November 15 as rest.' },
      { id: 'preview', role: 'assistant', createdAt, text: 'Review calendar rest.' }, preview);
    const result = await runApplyAssistantTrainingProposal({ proposalRef: preview.proposalRef, permissionMode: 'schedule',
      conversationId: chat.conversationId, confirm }, { auth: { uid }, app: { appId: 'synthetic-app' } }, store, input => applyTrainingChanges(input, deps));
    expect(result.status).toBe(confirm ? 'applied' : 'dismissed');
    expect((await user().collection('trainingRestDays').doc('2026-11-15').get()).exists).toBe(confirm);
  });

  const restInput = (restDays = ['2026-10-26'], connectionId = 'connection') => ({ uid, connectionId, scopes, arguments: {
    expectedScheduleRevision: 2, change: { kind: 'set-plan-rest-days' as const, plan: { ref: reference(connectionId) },
      expectedPlanRevision: 2, restDays } } });

  it('previews and applies rest dates idempotently without workouts, load, legacy-wire or delivery changes; restores absence', async () => {
    const beforeWorkout = (await workout().get()).data();
    expect(await read('get_training_plan_rest_days')).toMatchObject({ restDays: [] });
    const preview = await previewTrainingRestDays(restInput(), deps);
    expect(preview.restDayReview).toEqual({ planName: 'Autumn', startDate: '2026-10-24', endDate: '2026-10-31', before: [], after: ['2026-10-26'] });
    expect((await plan().get()).data()).not.toHaveProperty('restDays');
    expect(preview.providerPreviews).toEqual([]);
    const applied = await apply(preview.proposalRef);
    expect(await apply(preview.proposalRef)).toEqual(applied);
    expect((await plan().get()).data()).toMatchObject({ revision: 3, workoutCount: 1, restDays: ['2026-10-26'] });
    expect((await workout().get()).data()).toEqual(beforeWorkout);
    expect((await readPlanSnapshotAtRevision(db, uid, 'plan', 3)).plan.restDays).toEqual(['2026-10-26']);
    const controls = defaultDayWorkoutControls('2026-10-26', 'Europe/Helsinki');
    const activeContext = await readDayWorkoutTrainingContext(uid, controls, new Date(deps.now()), db);
    expect(activeContext.plannedRestDay).toEqual({ localDate: '2026-10-26', planName: 'Autumn' });
    const selectedContext = await readDayWorkoutTrainingContext(uid, { ...controls, destinationPlanId: 'plan' }, new Date(deps.now()), db);
    expect(selectedContext.plannedRestDay).toEqual(activeContext.plannedRestDay);
    await plan().update({ privateProviderId: 'private-rest-canary' });
    const result = await read('get_training_plan_rest_days');
    expect(result).toMatchObject({ restDays: ['2026-10-26'] });
    expect(JSON.stringify(result)).not.toContain('private-rest-canary');
    expect(await read('get_training_plan')).not.toHaveProperty('restDays');
    await plan().update({ privateProviderId: FieldValue.delete() });
    await drain();
    expect(transport.calls).toEqual([]);
    expect((await user().collection('trainingDeliveryLedger').get()).empty).toBe(true);
    const restored = await restoreTrainingScheduleRevisionForUser(uid, { mutationId: randomUUID(), scope: { kind: 'plan', id: 'plan' },
      targetRevision: 2, expectedRevisions: revisions(3, 3) }, { db, nowMs: deps.now() + 1 });
    expect(restored.mutation.plans[0]).not.toHaveProperty('restDays');
    expect((await workout().get()).data()).toMatchObject({ localDate: beforeWorkout!.localDate, lifecycle: beforeWorkout!.lifecycle });
  });

  it('rejects rest-day conflicts, out-of-range dates, foreign references, stale revisions and revoked grants without authoring', async () => {
    await expect(previewTrainingRestDays(restInput(['2026-10-25']), deps)).rejects.toThrow();
    await expect(previewTrainingRestDays(restInput(['2026-11-01']), deps)).rejects.toThrow();
    await expect(previewTrainingRestDays({ ...restInput(), connectionId: 'other' }, deps)).rejects.toThrow();
    await expect(previewTrainingRestDays({ ...restInput(), scopes: ['training-plans:read'] }, deps)).rejects.toThrow();
    const stale = restInput(); stale.arguments.change.expectedPlanRevision = 1;
    await expect(previewTrainingRestDays(stale, deps)).rejects.toThrow();
    const preview = await previewTrainingRestDays(restInput(), deps);
    await user().collection('mcpConnections').doc('connection').update({ grantId: 'grant-2' });
    await expect(apply(preview.proposalRef)).rejects.toThrow();
    expect((await plan().get()).data()).not.toHaveProperty('restDays');
    expect((await workout().get()).get('revision')).toBe(1);
  });

  it.each([false, true])('keeps Assistant rest-day changes behind complete app review and Apply (confirm=%s)', async confirm => {
    const store = createAssistantConversationStore({ db: () => db, now: () => new Date(deps.now()), createId: () => `chat-${++sequence}` });
    const chat = await store.resetConversation(uid, 'coordinate_free', false, null, true, true, false);
    const begun = await store.beginTurn(uid, chat.conversationId, undefined, undefined, 'coordinate_free', false, true, true, false);
    if (begun.kind !== 'started') throw new Error('Expected turn.');
    const connectionId = `first-party-assistant-v1:${chat.conversationId}`;
    const preview = await previewTrainingRestDays(restInput(['2026-10-26'], connectionId), deps);
    const createdAt = new Date(deps.now()).toISOString();
    await store.completeTurn(uid, begun, { id: 'request', role: 'user', createdAt, text: 'Mark Monday as a rest day.' },
      { id: 'preview', role: 'assistant', createdAt, text: 'Review the rest date.' }, preview);
    expect((await plan().get()).data()).not.toHaveProperty('restDays');
    const result = await runApplyAssistantTrainingProposal({ proposalRef: preview.proposalRef, permissionMode: 'schedule',
      conversationId: chat.conversationId, confirm }, { auth: { uid }, app: { appId: 'synthetic-app' } }, store,
      input => applyTrainingChanges(input, deps));
    expect(result.status).toBe(confirm ? 'applied' : 'dismissed');
    expect((await plan().get()).get('restDays') ?? null).toEqual(confirm ? ['2026-10-26'] : null);
  });

  it('previews without authoring, preserves masked legacy reads, replays Apply and reconstructs/restores full phase history', async () => {
    const beforeWorkout = (await workout().get()).data();
    expect(await read('get_training_plan_phases')).toMatchObject({ phases: { version: 1, items: [] } });
    const preview = await previewTrainingPlanPhases(phaseInput(), deps);
    expect(preview.phaseReview).toEqual({ planName: 'Autumn', previousStartDate: '2026-10-24', previousEndDate: '2026-10-31',
      startDate: '2026-10-24', endDate: '2026-10-31', before: { version: 1, items: [] }, after: phases });
    expect((await plan().get()).data()).not.toHaveProperty('phases');
    const applied = await apply(preview.proposalRef);
    expect(await apply(preview.proposalRef)).toEqual(applied);
    expect((await plan().get()).data()).toMatchObject({ revision: 3, phases });
    expect((await workout().get()).data()).toEqual(beforeWorkout);
    expect((await readPlanSnapshotAtRevision(db, uid, 'plan', 3)).plan.phases).toEqual(phases);
    // Neighboring private fields are excluded by the real Firestore field mask, while legacy output stays frozen.
    await plan().update({ privateProviderId: 'private-canary' });
    expect(await read('get_training_plan_phases')).toMatchObject({ planRevision: 3, phases });
    expect(JSON.stringify(await read('get_training_plan_phases'))).not.toContain('private-canary');
    expect(await read('get_training_plan')).not.toHaveProperty('phases');
    await plan().update({ privateProviderId: FieldValue.delete() });
  });

  it('shifts inclusive dates across DST, restores phase metadata and legacy absence, and removes embedded phases with plan deletion', async () => {
    await apply((await previewTrainingPlanPhases(phaseInput(), deps)).proposalRef);
    const shifted = await mutateTrainingScheduleForUser(uid, { mutationId: randomUUID(), expectedRevisions: [
      ...revisions(3, 3), { scope: 'workout', id: 'run', revision: 1 }], operation: { kind: 'shift-plan', planId: 'plan', days: 1 } }, { db, nowMs: deps.now() + 1 });
    expect(shifted.plans[0].phases?.items[0]).toEqual({ ...phases.items[0], startLocalDate: '2026-10-25', endLocalDate: '2026-10-26' });
    expect((await workout().get()).data()).toMatchObject({ id: 'run', localDate: '2026-10-26' });
    const restored = await restoreTrainingScheduleRevisionForUser(uid, { mutationId: randomUUID(), scope: { kind: 'plan', id: 'plan' },
      targetRevision: 3, expectedRevisions: revisions(4, 4) }, { db, nowMs: deps.now() + 2 });
    expect(restored.mutation.plans[0].phases).toEqual(phases);
    const legacy = await restoreTrainingScheduleRevisionForUser(uid, { mutationId: randomUUID(), scope: { kind: 'plan', id: 'plan' },
      targetRevision: 2, expectedRevisions: revisions(5, 5) }, { db, nowMs: deps.now() + 3 });
    expect(legacy.mutation.plans[0]).not.toHaveProperty('phases');
    await mutateTrainingScheduleForUser(uid, { mutationId: randomUUID(), expectedRevisions: revisions(6, 6),
      operation: { kind: 'set-plan-phases', planId: 'plan', phases, startLocalDate: '2026-10-24', endLocalDate: '2026-10-31', confirmPlanRangeExtension: false } }, { db, nowMs: deps.now() + 4 });
    await deleteTrainingPlanForUser(uid, { mutationId: randomUUID(), planId: 'plan', expectedRevisions: revisions(7, 7),
      workoutDisposition: 'convert-to-standalone', confirmPlanDeletion: true }, { db, nowMs: deps.now() + 5 });
    expect((await plan().get()).exists).toBe(false);
    expect((await plan().collection('revisions').get()).empty).toBe(true);
    expect((await workout().get()).data()).toMatchObject({ planId: null });
    expect((await workout().get()).data()).not.toHaveProperty('phases');
  });

  it('rejects stale revisions, foreign references and changed grants before phase writes', async () => {
    await expect(previewTrainingPlanPhases({ ...phaseInput(), connectionId: 'other' }, deps)).rejects.toThrow();
    const stale = phaseInput(); stale.arguments.change.expectedPlanRevision = 1;
    await expect(previewTrainingPlanPhases(stale, deps)).rejects.toThrow();
    await expect(previewTrainingPlanPhases({ ...phaseInput(), scopes: ['training-plans:read'] }, deps)).rejects.toThrow();
    const preview = await previewTrainingPlanPhases(phaseInput(), deps);
    await user().collection('mcpConnections').doc('connection').update({ grantId: 'grant-2' });
    await expect(apply(preview.proposalRef)).rejects.toThrow();
    expect((await plan().get()).data()).not.toHaveProperty('phases');
  });

  it('changes no enabled provider delivery or workout recipe when phases or rest days change', async () => {
    const delivery = await previewTrainingChanges({ uid, connectionId: 'connection', scopes, arguments: {
      expectedScheduleRevision: 2, changes: [{ kind: 'provider-delivery', targetType: 'plan', target: { ref: reference() },
        providers: ['garmin'], action: 'enable', timeZone: 'Europe/Helsinki' }] } }, deps);
    await applyTrainingChanges({ uid, connectionId: 'connection', scopes, arguments: { proposalRef: delivery.proposalRef, permissionMode: 'delivery' } }, deps);
    await drain();
    const ledger = (await user().collection('trainingDeliveryLedger').get()).docs[0];
    await processTrainingDelivery(deps.runtime, uid, ledger.id); await drain();
    expect(transport.calls).toHaveLength(1);
    const setting = (await user().collection('trainingDeliverySettings').get()).docs[0];
    const consent = setting.data(); const before = (await workout().get()).data();
    await apply((await previewTrainingPlanPhases(phaseInput(), deps)).proposalRef);
    await drain(); await processTrainingDelivery(deps.runtime, uid, ledger.id); await drain();
    expect(transport.calls).toHaveLength(1); expect((await setting.ref.get()).data()).toEqual(consent);
    expect((await workout().get()).data()).toEqual(before);
    const rest = restInput(); rest.arguments.expectedScheduleRevision = 3; rest.arguments.change.expectedPlanRevision = 3;
    await apply((await previewTrainingRestDays(rest, deps)).proposalRef);
    await drain(); await processTrainingDelivery(deps.runtime, uid, ledger.id); await drain();
    expect(transport.calls).toHaveLength(1); expect((await setting.ref.get()).data()).toEqual(consent);
    expect((await workout().get()).data()).toEqual(before);
  });

  it.each([false, true])('keeps Assistant phase proposal app-confirmed (confirm=%s)', async confirm => {
    const store = createAssistantConversationStore({ db: () => db, now: () => new Date(deps.now()), createId: () => `chat-${++sequence}` });
    const chat = await store.resetConversation(uid, 'coordinate_free', false, null, true, true, false);
    const begun = await store.beginTurn(uid, chat.conversationId, undefined, undefined, 'coordinate_free', false, true, true, false);
    if (begun.kind !== 'started') throw new Error('Expected turn.');
    const connectionId = `first-party-assistant-v1:${chat.conversationId}`;
    const preview = await previewTrainingPlanPhases(phaseInput(connectionId), deps);
    const createdAt = new Date(deps.now()).toISOString();
    await store.completeTurn(uid, begun, { id: 'request', role: 'user', createdAt, text: 'Add a Base phase.' },
      { id: 'preview', role: 'assistant', createdAt, text: 'Review the phase change.' }, preview);
    expect((await plan().get()).data()).not.toHaveProperty('phases');
    const result = await runApplyAssistantTrainingProposal({ proposalRef: preview.proposalRef, permissionMode: 'schedule',
      conversationId: chat.conversationId, confirm }, { auth: { uid }, app: { appId: 'synthetic-app' } }, store,
      input => applyTrainingChanges(input, deps));
    expect(result.status).toBe(confirm ? 'applied' : 'dismissed');
    expect((await plan().get()).get('phases') ?? null).toEqual(confirm ? phases : null);
  });
});
