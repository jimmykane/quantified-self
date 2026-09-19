import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DeliveryRuntime } from '../training-plans/delivery/contracts';
import { FakeTrainingTransport } from '../training-plans/delivery/test-support/fake-transport';
import { applyTrainingChanges, previewCreatePlannedWorkout, previewTrainingChanges,
  type TrainingWriteDependencies } from './training-plans-write.service';
import { TRAINING_DELIVERY_WRITE_SCOPE, TRAINING_PLANS_SCOPE, TRAINING_PLANS_WRITE_SCOPE } from './training-plans.schemas';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Training MCP write proposals with real Firestore transactions', { timeout: 30_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-mcp-training-writes' });
  const users: string[] = [];
  const scopes = [TRAINING_PLANS_SCOPE, TRAINING_PLANS_WRITE_SCOPE, TRAINING_DELIVERY_WRITE_SCOPE];
  const structure = { version: 1 as const, sport: ActivityTypes.Running, nodes: [{ id: 'work', kind: 'step' as const,
    purpose: 'work' as const, ending: { kind: 'time' as const, seconds: 1800 }, targets: [] }] };
  let uid: string;
  let sequence: number;
  let transport: FakeTrainingTransport | null;
  let deps: TrainingWriteDependencies;

  beforeEach(async () => {
    uid = `mcp-training-write-${randomUUID()}`;
    users.push(uid);
    sequence = 0;
    transport = new FakeTrainingTransport();
    const runtime: DeliveryRuntime = {
      db,
      now: () => Date.parse('2026-09-17T12:00:00Z'),
      hasPro: async () => true,
      connection: async () => ({ state: 'connected', destinationKey: 'fixture-account', generation: 'connection-1', epoch: 0 }),
      transport: provider => provider === 'garmin' ? transport : null,
    };
    deps = { db, runtime, now: runtime.now, randomId: () => `id-${++sequence}` };
    const user = db.collection('users').doc(uid);
    await user.set({ test: true });
    await user.collection('trainingPlanState').doc('current').set({ schemaVersion: 1, revision: 1,
      activePlanId: null, currentWorkoutCount: 0, updatedAtMs: 1 });
    await user.collection('mcpConnections').doc('connection').set({ status: 'active', scopes,
      grantId: 'grant-1', createdAtMs: 1, revokedAtMs: null });
  });

  afterAll(async () => {
    for (const id of users) await db.recursiveDelete(db.collection('users').doc(id));
    await db.terminate();
  });

  const previewCreateAndSend = () => previewTrainingChanges({ uid, connectionId: 'connection', scopes,
    arguments: { expectedScheduleRevision: 1, changes: [
      { kind: 'create-workout', localKey: 'run', plan: null, localDate: '2026-09-18', title: 'Easy run', structure },
      { kind: 'provider-delivery', targetType: 'workout', target: { localKey: 'run' },
        providers: 'all_connected', action: 'send', timeZone: 'Europe/Helsinki' },
    ] } }, deps);

  it('creates a focused standalone-workout proposal without a client operation kind or local key', async () => {
    const preview = await previewCreatePlannedWorkout({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, localDate: '2026-09-18', title: 'Focused easy run', structure } }, deps);
    expect(preview).toMatchObject({
      permissionMode: 'schedule',
      requiresConfirmation: true,
      changes: [{ index: 0, kind: 'create-workout' }],
      providerPreviews: [],
    });
    const applied = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' } }, deps);
    expect(applied.createdReferences).toEqual([
      expect.objectContaining({ localKey: 'created_workout', kind: 'workout' }),
    ]);
    const workouts = await db.collection('users').doc(uid).collection('scheduledWorkouts').get();
    expect(workouts.docs.map(doc => doc.data())).toEqual([
      expect.objectContaining({ title: 'Focused easy run', planId: null, lifecycle: 'planned' }),
    ]);
  });

  it('previews focused standalone creation and provider delivery atomically', async () => {
    const preview = await previewCreatePlannedWorkout({
      uid,
      connectionId: 'connection',
      scopes,
      arguments: {
        expectedScheduleRevision: 1,
        localDate: '2026-09-18',
        title: 'Focused delivered run',
        structure,
        delivery: { providers: ['garmin'], timeZone: 'Europe/Helsinki' },
      },
    }, deps);
    expect(preview).toMatchObject({
      permissionMode: 'combined',
      requiresConfirmation: true,
      changes: [
        { index: 0, kind: 'create-workout' },
        { index: 1, kind: 'provider-delivery' },
      ],
      providerPreviews: [{ index: 1, provider: 'garmin', availability: 'ready' }],
    });
    const applied = await applyTrainingChanges({
      uid,
      connectionId: 'connection',
      scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' },
    }, deps);
    expect(applied.createdReferences).toEqual([
      expect.objectContaining({ localKey: 'created_workout', kind: 'workout' }),
    ]);
    expect(applied.providers).toEqual([
      expect.objectContaining({ provider: 'garmin', status: 'applied' }),
    ]);
  });

  it('creates a standalone workout, fans out only to ready providers and applies idempotently', async () => {
    const preview = await previewCreateAndSend();
    expect(preview.providerPreviews.map(item => [item.provider, item.availability])).toEqual([
      ['garmin', 'ready'], ['coros', 'unavailable'], ['wahoo', 'unavailable'], ['suunto', 'unavailable'],
    ]);
    const input = { uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } };
    const applied = await applyTrainingChanges(input, deps);
    expect(applied.status).toBe('applied');
    expect(applied.providers).toEqual([expect.objectContaining({ provider: 'garmin', status: 'applied' })]);
    expect(applied.createdReferences).toEqual([expect.objectContaining({ localKey: 'run', kind: 'workout' })]);
    const user = db.collection('users').doc(uid);
    const workouts = await user.collection('scheduledWorkouts').get();
    expect(workouts.size).toBe(1);
    expect(workouts.docs[0].data()).toMatchObject({ title: 'Easy run', planId: null, lifecycle: 'planned' });
    expect((await user.collection('trainingDeliverySettings').get()).docs.map(doc => doc.data()))
      .toEqual([expect.objectContaining({ provider: 'garmin', enabled: true, scope: 'workout' })]);
    await expect(applyTrainingChanges(input, deps)).resolves.toEqual(applied);
    expect((await user.collection('scheduledWorkouts').get()).size).toBe(1);
  });

  it('keeps an authored workout when an explicitly selected provider is unavailable', async () => {
    transport = null;
    const preview = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, changes: [
        { kind: 'create-workout', localKey: 'run', plan: null, localDate: '2026-09-18', title: 'Offline run', structure },
        { kind: 'provider-delivery', targetType: 'workout', target: { localKey: 'run' },
          providers: ['garmin'], action: 'send', timeZone: 'Europe/Helsinki' },
      ] } }, deps);
    expect(preview.providerPreviews[0].availability).toBe('unavailable');
    const result = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps);
    expect(result.status).toBe('partially_applied');
    expect(result.changes).toEqual([expect.objectContaining({ status: 'applied' })]);
    expect(result.providers).toEqual([expect.objectContaining({ status: 'blocked' })]);
    expect((await db.collection('users').doc(uid).collection('scheduledWorkouts').get()).size).toBe(1);
  });

  it('does not expose unexpected provider errors in previews or apply results', async () => {
    const secret = 'private-provider-account-token';
    deps.runtime.hasPro = async () => { throw new Error(secret); };
    await expect(previewCreateAndSend()).rejects.toThrow('cannot be previewed safely');
    await expect(previewCreateAndSend()).rejects.not.toThrow(secret);

    deps.runtime.hasPro = async () => true;
    const preview = await previewCreateAndSend();
    deps.runtime.hasPro = async () => { throw new Error(secret); };
    const result = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps);
    expect(result.status).toBe('partially_applied');
    expect(result.providers).toEqual([expect.objectContaining({
      status: 'blocked', message: 'Provider delivery is currently unavailable. Review its connection and try again.',
    })]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('rejects misleading provider ordering and missing or invalid initial time zones', async () => {
    const base = { expectedScheduleRevision: 1, changes: [
      { kind: 'provider-delivery', targetType: 'workout', target: { localKey: 'run' },
        providers: ['garmin'], action: 'send', timeZone: 'Europe/Helsinki' },
      { kind: 'create-workout', localKey: 'run', plan: null, localDate: '2026-09-18', title: 'Late definition', structure },
    ] };
    await expect(previewTrainingChanges({ uid, connectionId: 'connection', scopes, arguments: base }, deps))
      .rejects.toThrow('must follow all plan and workout changes');
    for (const timeZone of [undefined, 'Mars/Olympus_Mons']) {
      await expect(previewTrainingChanges({ uid, connectionId: 'connection', scopes,
        arguments: { expectedScheduleRevision: 1, changes: [
          { kind: 'create-workout', localKey: 'run', plan: null, localDate: '2026-09-18', title: 'Time zone run', structure },
          { kind: 'provider-delivery', targetType: 'workout', target: { localKey: 'run' },
            providers: ['garmin'], action: 'send', ...(timeZone ? { timeZone } : {}) },
        ] } }, deps)).rejects.toThrow(timeZone ? 'valid IANA time zone' : 'requires an IANA time zone');
    }
  });

  it('blocks provider delivery when its confirmed settings revision changes after preview', async () => {
    const preview = await previewCreateAndSend();
    const proposals = await db.collection('users').doc(uid).collection('trainingMcpProposals').get();
    const operation = proposals.docs[0].data().providerOperations[0] as { targetId: string };
    await db.collection('users').doc(uid).collection('trainingDeliverySettings')
      .doc(`workout_${operation.targetId}_garmin`).set({ revision: 1 });

    const result = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps);

    expect(result.status).toBe('partially_applied');
    expect(result.changes).toEqual([expect.objectContaining({ status: 'applied' })]);
    expect(result.providers).toEqual([expect.objectContaining({ provider: 'garmin', status: 'blocked' })]);
  });

  it('binds compatibility approval to the exact mapping digest shown in the preview', async () => {
    const initialPreview = await previewCreateAndSend();
    const initial = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: initialPreview.proposalRef, permissionMode: 'combined' } }, deps);
    const workoutRef = initial.createdReferences.find(item => item.kind === 'workout')!.reference;
    transport!.level = 'degraded';
    const approvalPreview = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: initial.scheduleRevision, changes: [
        { kind: 'provider-delivery', targetType: 'workout', target: { ref: workoutRef },
          providers: ['garmin'], action: 'approve' },
      ] } }, deps);
    expect(approvalPreview.providerPreviews).toEqual([
      expect.objectContaining({ provider: 'garmin', availability: 'ready', warningCount: 1 }),
    ]);

    transport!.mappingVersion = 'test-v2';
    const result = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: approvalPreview.proposalRef, permissionMode: 'delivery' } }, deps);

    expect(result.status).toBe('partially_applied');
    expect(result.providers).toEqual([expect.objectContaining({
      provider: 'garmin', status: 'blocked', message: expect.stringContaining('compatibility preview changed'),
    })]);
  });

  it('rejects stale schedule state and connection-bound proposal replay', async () => {
    const preview = await previewCreateAndSend();
    const user = db.collection('users').doc(uid);
    await user.collection('mcpConnections').doc('other').set({ status: 'active', scopes,
      grantId: 'grant-2', createdAtMs: 2, revokedAtMs: null });
    await expect(applyTrainingChanges({ uid, connectionId: 'other', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps)).rejects.toThrow('invalid');
    await user.collection('trainingPlanState').doc('current').update({ revision: 2 });
    const result = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps);
    expect(result.status).toBe('partially_applied');
    expect(result.changes).toEqual([expect.objectContaining({ status: 'failed' })]);
    expect((await user.collection('scheduledWorkouts').get()).empty).toBe(true);
  });

  it('invalidates first-party proposals when the Assistant conversation generation changes', async () => {
    const user = db.collection('users').doc(uid);
    await user.collection('assistantConversations').doc('active').set({ conversationId: 'chat-1',
      trainingPlansEnabled: true, trainingPlanChangesEnabled: true, trainingDeliveryEnabled: false });
    const assistantScopes = [TRAINING_PLANS_SCOPE, TRAINING_PLANS_WRITE_SCOPE];
    const preview = await previewTrainingChanges({ uid, connectionId: 'first-party-assistant-v1:chat-1', scopes: assistantScopes,
      arguments: { expectedScheduleRevision: 1, changes: [
        { kind: 'create-workout', localKey: 'run', plan: null, localDate: '2026-09-18', title: 'Assistant run', structure },
      ] } }, deps);
    await user.collection('assistantConversations').doc('active').update({ conversationId: 'chat-2', trainingPlanChangesEnabled: false });
    await expect(applyTrainingChanges({ uid, connectionId: 'first-party-assistant-v1:chat-1', scopes: assistantScopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' } }, deps)).rejects.toThrow('permissions changed');
  });

  it('binds Assistant writes to the exact proposal currently awaiting confirmation', async () => {
    const user = db.collection('users').doc(uid);
    await user.collection('assistantConversations').doc('active').set({ conversationId: 'chat-1',
      trainingPlansEnabled: true, trainingPlanChangesEnabled: true, trainingDeliveryEnabled: false });
    const assistantScopes = [TRAINING_PLANS_SCOPE, TRAINING_PLANS_WRITE_SCOPE];
    const preview = await previewTrainingChanges({ uid, connectionId: 'first-party-assistant-v1:chat-1', scopes: assistantScopes,
      arguments: { expectedScheduleRevision: 1, changes: [
        { kind: 'create-workout', localKey: 'run', plan: null, localDate: '2026-09-18', title: 'Assistant run', structure },
      ] } }, deps);
    const input = { uid, connectionId: 'first-party-assistant-v1:chat-1', scopes: assistantScopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' as const } };

    await user.collection('assistantConversations').doc('active').update({
      pendingTrainingProposal: { ...preview, proposalRef: 'newer-proposal' },
    });
    await expect(applyTrainingChanges(input, deps)).rejects.toThrow('no longer current');
    expect((await user.collection('scheduledWorkouts').get()).empty).toBe(true);

    await user.collection('assistantConversations').doc('active').update({ pendingTrainingProposal: preview });
    await expect(applyTrainingChanges(input, deps)).resolves.toMatchObject({ status: 'applied' });
    expect((await user.collection('scheduledWorkouts').get()).size).toBe(1);
  });
});
