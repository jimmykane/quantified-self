import { randomUUID } from 'node:crypto';
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeOpaqueValue, decodeOpaqueValue } from './data.service';
import { applyTrainingChanges, previewTrainingChanges, previewTrainingPlanPhases, type TrainingWriteDependencies } from './training-plans-write.service';
import { createFirestoreTrainingReads, readTrainingPlans, } from './training-plans.service';
import type { TrainingReadTool } from './training-plans.schemas';
import { mutateTrainingScheduleForUser } from '../training-plans/persistence';
import { readPlanSnapshotAtRevision } from '../training-plans/history';
import { restoreTrainingScheduleRevisionForUser } from '../training-plans/restore';
import { deleteTrainingPlanForUser } from '../training-plans/delete-training-plan';
import { FakeTrainingTransport } from '../training-plans/delivery/test-support/fake-transport';
import { reconcileTrainingDeliveryPage } from '../training-plans/delivery/store';
import { processTrainingDelivery } from '../training-plans/delivery/worker';
import { createAssistantConversationStore } from '../assistant/conversation-store';
import { runApplyAssistantTrainingProposal } from '../assistant/callable';

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

  it('changes no enabled provider delivery or workout recipe when phases change', async () => {
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
