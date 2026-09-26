import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DeliveryRuntime } from '../training-plans/delivery/contracts';
import { FakeTrainingTransport } from '../training-plans/delivery/test-support/fake-transport';
import { SuuntoHttpFixture } from '../training-plans/delivery/test-support/suunto-http-fixture';
import { SuuntoGuideTransport } from '../training-plans/delivery/suunto/transport';
import { WahooHttpFixture } from '../training-plans/delivery/test-support/wahoo-http-fixture';
import { WahooTrainingTransport } from '../training-plans/delivery/wahoo/transport';
import { reconcileTrainingDeliveryPage } from '../training-plans/delivery/store';
import { processTrainingDelivery } from '../training-plans/delivery/worker';
import { parseStrengthWorkoutDetailsV1 } from '../../../shared/strength-workout';
import { applyTrainingChanges, previewCreatePlannedWorkout, previewTrainingChanges,
  previewStrengthWorkoutChange, previewPlannedWorkoutV2Change,
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

  it('previews and applies a complete strength prescription without widening the v1 recipe tool', async () => {
    const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Back squat', sets: [{
      id: 'set-one', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80,
      restAfterSeconds: 120,
    }] }] };
    const preview = await previewStrengthWorkoutChange({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, change: { kind: 'create-workout', localKey: 'lift', plan: null,
        localDate: '2026-09-18', title: 'Strength day', strength } } }, deps);
    expect(preview).toMatchObject({ permissionMode: 'schedule', requiresConfirmation: true,
      changes: [{ kind: 'create-workout' }] });
    const applied = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' } }, deps);
    const workout = (await db.collection('users').doc(uid).collection('scheduledWorkouts').get()).docs[0];
    expect(workout.data().structure.sport).toBe(ActivityTypes.StrengthTraining);
    const companion = await workout.ref.collection('strengthDetails').doc('current').get();
    expect(parseStrengthWorkoutDetailsV1(companion.data()).exercises[0].sets[0])
      .toMatchObject({ externalLoadKg: 80, restAfterSeconds: 120 });
    expect(applied.createdReferences).toEqual([expect.objectContaining({ localKey: 'lift', kind: 'workout' })]);
    await expect(applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' } }, deps)).resolves.toEqual(applied);
  });

  it('creates and edits a selected pool length through v2 without a v1 edit silently clearing it', async () => {
    const swim = { version: 1 as const, sport: ActivityTypes.Swimming,
      poolLength: { meters: 25, presentation: 'meters' as const },
      nodes: [{ id: 'length', kind: 'step' as const, purpose: 'work' as const,
        ending: { kind: 'distance' as const, meters: 100 }, targets: [] }] };
    const createdPreview = await previewPlannedWorkoutV2Change({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, change: { kind: 'create-workout', localKey: 'swim', plan: null,
        localDate: '2026-09-18', title: '25 m pool', structure: swim } } }, deps);
    const created = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: createdPreview.proposalRef, permissionMode: 'schedule' } }, deps);
    const workout = (await db.collection('users').doc(uid).collection('scheduledWorkouts').get()).docs[0];
    expect(workout.get('structure.poolLength')).toEqual(swim.poolLength);
    const workoutRef = created.createdReferences[0].reference;
    const { poolLength: selectedPoolLength, ...legacySwim } = swim;
    expect(selectedPoolLength).toEqual({ meters: 25, presentation: 'meters' });
    await expect(previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: created.scheduleRevision, changes: [{ kind: 'update-workout',
        workout: { ref: workoutRef }, plan: null, localDate: '2026-09-18', title: 'Legacy edit',
        structure: legacySwim }] } }, deps)).rejects.toThrow('without silently clearing');
    const updateInput = { uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: created.scheduleRevision, change: { kind: 'update-workout',
        workout: { ref: workoutRef }, plan: null, localDate: '2026-09-19', title: '25 yd pool',
        structure: { ...swim, poolLength: { meters: 22.86, presentation: 'yards' } } } } };
    const updatedPreview = await previewPlannedWorkoutV2Change(updateInput, deps);
    const updated = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: updatedPreview.proposalRef, permissionMode: 'schedule' } }, deps);
    expect((await workout.ref.get()).get('structure.poolLength')).toEqual({ meters: 22.86, presentation: 'yards' });
    await expect(applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: updatedPreview.proposalRef, permissionMode: 'schedule' } }, deps)).resolves.toEqual(updated);
    await expect(previewPlannedWorkoutV2Change(updateInput, deps)).rejects.toThrow('schedule changed');
    await expect(previewPlannedWorkoutV2Change({ ...updateInput,
      scopes: [TRAINING_PLANS_SCOPE] }, deps)).rejects.toThrow('permission');
  });

  it('applies compatible authored changes together while preserving each revision', async () => {
    const preview = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, changes: [
        { kind: 'create-plan', localKey: 'plan', name: 'Batch plan', startDate: '2026-09-18',
          endDate: '2026-09-30', activate: false },
        { kind: 'rename-plan', plan: { localKey: 'plan' }, name: 'Renamed batch plan' },
        { kind: 'create-workout', localKey: 'run', plan: { localKey: 'plan' }, localDate: '2026-09-20',
          title: 'Batch run', structure },
      ] } }, deps);

    const applied = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' } }, deps);

    expect(applied.status).toBe('applied');
    expect(applied.changes).toHaveLength(3);
    const plan = (await db.collection('users').doc(uid).collection('trainingPlans').get()).docs[0];
    expect(plan.data()).toMatchObject({ name: 'Renamed batch plan', revision: 3, workoutCount: 1 });
    const revisions = await plan.ref.collection('revisions').get();
    expect(revisions.docs.map(doc => doc.id)).toEqual(['0000000001', '0000000002', '0000000003']);
    expect((await db.collection('users').doc(uid).collection('trainingPlanState').doc('current').get()).get('revision')).toBe(4);
  });

  it('previews and applies plan deletion only with an explicit workout disposition', async () => {
    const createPreview = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, changes: [
        { kind: 'create-plan', localKey: 'plan', name: 'Temporary plan', startDate: '2026-09-18',
          endDate: '2026-09-30', activate: false },
        { kind: 'create-workout', localKey: 'run', plan: { localKey: 'plan' }, localDate: '2026-09-20',
          title: 'Keep this run', structure },
      ] } }, deps);
    const created = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: createPreview.proposalRef, permissionMode: 'schedule' } }, deps);
    const planRef = created.createdReferences.find(reference => reference.kind === 'plan')!.reference;
    const planId = (await db.collection('users').doc(uid).collection('trainingPlans').get()).docs[0].id;

    await expect(previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: created.scheduleRevision, changes: [
        { kind: 'delete-plan', plan: { ref: planRef }, workoutDisposition: 'convert-to-standalone' },
        { kind: 'create-plan', localKey: 'other', name: 'Not allowed together', startDate: '2026-10-01',
          endDate: '2026-10-02', activate: false },
      ] } }, deps)).rejects.toThrow('only change');

    const deletionPreview = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: created.scheduleRevision, changes: [
        { kind: 'delete-plan', plan: { ref: planRef }, workoutDisposition: 'convert-to-standalone' },
      ] } }, deps);
    expect(deletionPreview.changes[0]).toMatchObject({ kind: 'delete-plan' });
    expect(deletionPreview.changes[0].summary).toContain('revision history');
    expect(deletionPreview.changes[0].summary).toContain('will become standalone');
    expect(deletionPreview.changes[0].summary).toContain('past provider copies remain');

    const deleted = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: deletionPreview.proposalRef, permissionMode: 'schedule' } }, deps);
    expect(deleted).toMatchObject({ status: 'applied', changes: [{ kind: 'delete-plan', status: 'applied' }] });
    expect((await db.collection('users').doc(uid).collection('trainingPlans').get()).empty).toBe(true);
    expect((await db.collection('users').doc(uid).collection('scheduledWorkouts').get()).docs[0].data())
      .toMatchObject({ title: 'Keep this run', planId: null });
    expect((await db.collection('users').doc(uid).collection('trainingDeliveryState').doc('current')
      .collection('pastCleanup').doc(`plan_${planId}`).get()).exists).toBe(false);
  });

  it('keeps MCP workout deletion recoverable without opting into past provider cleanup', async () => {
    const user = db.collection('users').doc(uid);
    const create = await previewCreatePlannedWorkout({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, localDate: '2026-09-18', title: 'MCP deletion check', structure } }, deps);
    const created = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: create.proposalRef, permissionMode: 'schedule' } }, deps);
    const workoutRef = created.createdReferences[0].reference;
    const workoutId = (await user.collection('scheduledWorkouts').get()).docs[0].id;
    const deletion = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: created.scheduleRevision,
        changes: [{ kind: 'delete-workout', workout: { ref: workoutRef } }] } }, deps);
    expect(deletion.changes[0].summary).toContain('recoverable history');
    expect(deletion.changes[0].summary).toContain('past provider copies remain');
    const input = { uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: deletion.proposalRef, permissionMode: 'schedule' as const } };
    const applied = await applyTrainingChanges(input, deps);
    expect(applied.changes).toEqual([expect.objectContaining({ kind: 'delete-workout', status: 'applied' })]);
    expect((await user.collection('scheduledWorkouts').doc(workoutId).get()).data()?.lifecycle).toBe('deleted');
    expect((await user.collection('trainingDeliveryState').doc('current').collection('pastCleanup')
      .doc(`workout_${workoutId}`).get()).data()).toMatchObject({ enabled: false, scope: 'workout', scopeId: workoutId });
    expect(transport?.calls).toHaveLength(0);
    await expect(applyTrainingChanges(input, deps)).resolves.toEqual(applied);
  });

  it('permanently deletes plan workouts and replays the approved deletion idempotently', async () => {
    const user = db.collection('users').doc(uid);
    const createPreview = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, changes: [
        { kind: 'create-plan', localKey: 'plan', name: 'Disposable plan', startDate: '2026-09-18',
          endDate: '2026-09-30', activate: false },
        { kind: 'create-workout', localKey: 'run', plan: { localKey: 'plan' }, localDate: '2026-09-20',
          title: 'Disposable run', structure },
      ] } }, deps);
    const created = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: createPreview.proposalRef, permissionMode: 'schedule' } }, deps);
    const planRef = created.createdReferences.find(reference => reference.kind === 'plan')!.reference;
    const workouts = await user.collection('scheduledWorkouts').get();
    const workoutId = workouts.docs[0].id;
    await user.collection('trainingWorkoutCompletions').doc(workoutId).set({
      schemaVersion: 1,
      workoutId,
      status: 'unmatched',
    });

    const deletionPreview = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: created.scheduleRevision, changes: [
        { kind: 'delete-plan', plan: { ref: planRef }, workoutDisposition: 'delete-workouts' },
      ] } }, deps);
    expect(deletionPreview.changes[0].summary).toContain('permanently deleted');
    expect(deletionPreview.changes[0].summary).toContain('past provider copies remain');
    const deletionInput = { uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: deletionPreview.proposalRef, permissionMode: 'schedule' as const } };
    const deleted = await applyTrainingChanges(deletionInput, deps);

    expect(deleted).toMatchObject({ status: 'applied', changes: [{ kind: 'delete-plan', status: 'applied' }] });
    expect((await user.collection('trainingPlans').get()).empty).toBe(true);
    expect((await user.collection('scheduledWorkouts').get()).empty).toBe(true);
    expect((await user.collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    await expect(applyTrainingChanges(deletionInput, deps)).resolves.toEqual(deleted);
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

  it('discloses a degraded mapping and approves it with the original Send confirmation', async () => {
    transport!.level = 'degraded';
    const preview = await previewCreatePlannedWorkout({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, localDate: '2026-09-18', title: 'Mountain ride',
        structure: { ...structure, sport: ActivityTypes.MountainBiking },
        delivery: { providers: ['garmin'], timeZone: 'Europe/Helsinki' } } }, deps);
    expect(preview.providerPreviews).toEqual([expect.objectContaining({ provider: 'garmin',
      warningCount: 1, summary: expect.stringContaining('Test target mapping warning') })]);
    expect(preview.providerPreviews[0].summary).toContain('Confirming this proposal approves');

    const applied = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps);
    expect(applied.status).toBe('applied');
    expect(applied.providers).toEqual([expect.objectContaining({ provider: 'garmin', status: 'applied',
      message: expect.stringContaining('previewed mapping adjustment were approved') })]);
    const user = db.collection('users').doc(uid);
    const workouts = await user.collection('scheduledWorkouts').get();
    expect(workouts.size).toBe(1);
    const setting = user.collection('trainingDeliverySettings').doc(`workout_${workouts.docs[0].id}_garmin`);
    expect((await setting.get()).data()).toMatchObject({ enabled: true });
    expect((await setting.get()).get('approvedDigest')).toMatch(/^[a-f0-9]{64}$/);
    expect((await user.collection('scheduledWorkouts').get()).size).toBe(1);
  });

  it('previews the actual Suunto text loss once, then delivers through the synthetic Guide transport', async () => {
    const suunto = new SuuntoHttpFixture();
    const guideTransport = new SuuntoGuideTransport(suunto.request, 'Quantified Self', deps.now);
    deps.runtime.transport = provider => provider === 'suunto' ? guideTransport : null;
    const longNote = 'Ride at conversational effort and keep pedaling smoothly across varied terrain.';
    const preview = await previewCreatePlannedWorkout({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, localDate: '2026-09-18', title: 'Endurance ride',
        structure: { ...structure, sport: ActivityTypes.MountainBiking,
          nodes: [{ ...structure.nodes[0], note: longNote }] },
        delivery: { providers: ['suunto'], timeZone: 'Europe/Helsinki' } } }, deps);
    expect(preview.providerPreviews).toEqual([expect.objectContaining({ provider: 'suunto', warningCount: 1,
      summary: expect.stringContaining('Suunto will shorten long step instructions') })]);
    expect(preview.providerPreviews[0].summary).toContain('shortened to 40 characters on the watch');

    const applied = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps);
    expect(applied.providers).toEqual([expect.objectContaining({ provider: 'suunto', status: 'applied',
      message: expect.stringContaining('previewed mapping adjustment were approved') })]);
    const user = db.collection('users').doc(uid);
    const workout = (await user.collection('scheduledWorkouts').get()).docs[0];
    expect(workout.get('structure.nodes')[0].note).toBe(longNote);
    expect((await user.collection('trainingDeliverySettings').doc(`workout_${workout.id}_suunto`).get())
      .get('approvedDigest')).toMatch(/^[a-f0-9]{64}$/);

    for (let page = 0; page < 20 && await reconcileTrainingDeliveryPage(deps.runtime, uid); page += 1) { /* drain */ }
    const ledger = (await user.collection('trainingDeliveryLedger').get()).docs[0];
    expect(ledger).toBeDefined();
    await processTrainingDelivery(deps.runtime, uid, ledger.id);
    const status = await user.collection('trainingDeliveryStatuses').doc(ledger.id).get();
    expect(status.data()).toMatchObject({ provider: 'suunto', status: 'delivered', hasRemoteCopy: true });
    expect(suunto.guides.size).toBe(1);
    expect([...suunto.guides.values()][0].guide.steps[0]).toMatchObject({ fields: expect.arrayContaining([
      expect.objectContaining({ type: 'text', value: longNote.slice(0, 40) }),
    ]) });
    expect(suunto.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });

  it('keeps a concise Suunto step exact and sends it without a mapping approval', async () => {
    const suunto = new SuuntoHttpFixture();
    const guideTransport = new SuuntoGuideTransport(suunto.request, 'Quantified Self', deps.now);
    deps.runtime.transport = provider => provider === 'suunto' ? guideTransport : null;
    const preview = await previewCreatePlannedWorkout({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, localDate: '2026-09-18', title: 'Easy ride',
        structure: { ...structure, sport: ActivityTypes.MountainBiking,
          nodes: [{ ...structure.nodes[0], note: 'Ride easy' }] },
        delivery: { providers: ['suunto'], timeZone: 'Europe/Helsinki' } } }, deps);
    expect(preview.providerPreviews).toEqual([expect.objectContaining({ provider: 'suunto', warningCount: 0 })]);
    const applied = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps);
    const user = db.collection('users').doc(uid);
    const workout = (await user.collection('scheduledWorkouts').get()).docs[0];
    expect((await user.collection('trainingDeliverySettings').doc(`workout_${workout.id}_suunto`).get())
      .get('approvedDigest')).toBeNull();
    for (let page = 0; page < 20 && await reconcileTrainingDeliveryPage(deps.runtime, uid); page += 1) { /* drain */ }
    const ledger = (await user.collection('trainingDeliveryLedger').get()).docs[0];
    await processTrainingDelivery(deps.runtime, uid, ledger.id);
    expect((await user.collection('trainingDeliveryStatuses').doc(ledger.id).get()).get('status')).toBe('delivered');
    expect(applied.providers).toEqual([expect.objectContaining({ provider: 'suunto', status: 'applied' })]);
    expect(suunto.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });

  it('discloses Wahoo target limitations in the first proposal and delivers after one approval', async () => {
    const wahoo = new WahooHttpFixture();
    const wahooTransport = new WahooTrainingTransport(wahoo.request, deps.now);
    deps.runtime.transport = provider => provider === 'wahoo' ? wahooTransport : null;
    const preview = await previewCreatePlannedWorkout({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, localDate: '2026-09-18', title: 'Threshold ride',
        structure: { ...structure, sport: ActivityTypes.Cycling, nodes: [{ ...structure.nodes[0], targets: [{
          kind: 'heart-rate', mode: 'relative', minimumPercent: 90, maximumPercent: 100,
          reference: { kind: 'threshold-heart-rate', bpm: 170 },
        }] }] },
        delivery: { providers: ['wahoo'], timeZone: 'Europe/Helsinki' } } }, deps);
    expect(preview.providerPreviews).toEqual([expect.objectContaining({ provider: 'wahoo', warningCount: 1,
      summary: expect.stringContaining('not ELEMNT computers or RIVAL') })]);
    expect(preview.providerPreviews[0].summary).toContain('Confirming this proposal approves');

    const applied = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps);
    expect(applied.providers).toEqual([expect.objectContaining({ provider: 'wahoo', status: 'applied',
      message: expect.stringContaining('previewed mapping adjustment were approved') })]);
    const user = db.collection('users').doc(uid);
    const workout = (await user.collection('scheduledWorkouts').get()).docs[0];
    expect((await user.collection('trainingDeliverySettings').doc(`workout_${workout.id}_wahoo`).get())
      .get('approvedDigest')).toMatch(/^[a-f0-9]{64}$/);

    for (let page = 0; page < 20 && await reconcileTrainingDeliveryPage(deps.runtime, uid); page += 1) { /* drain */ }
    const ledger = (await user.collection('trainingDeliveryLedger').get()).docs[0];
    await processTrainingDelivery(deps.runtime, uid, ledger.id);
    expect((await user.collection('trainingDeliveryStatuses').doc(ledger.id).get()).get('status')).toBe('delivered');
    expect(wahoo.plans.size).toBe(1);
    expect(wahoo.workouts.size).toBe(1);
    expect(wahoo.calls.filter(call => call.method === 'POST')).toHaveLength(2);
  });

  it('blocks a degraded Send when the mapping changes after its preview', async () => {
    transport!.level = 'degraded';
    const preview = await previewCreateAndSend();
    transport!.mappingVersion = 'changed-after-preview';
    const applied = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'combined' } }, deps);
    expect(applied.status).toBe('partially_applied');
    expect(applied.providers).toEqual([expect.objectContaining({ provider: 'garmin', status: 'blocked',
      message: expect.stringContaining('compatibility preview changed') })]);
    expect((await db.collection('users').doc(uid).collection('trainingDeliverySettings').get()).empty).toBe(true);
  });

  it('does not approve mapping loss that cannot fit in the bounded public preview', async () => {
    transport!.level = 'degraded';
    transport!.assess = () => ({ level: 'degraded',
      mappingVersion: 'test-v1', digest: 'a'.repeat(64),
      issues: Array.from({ length: 20 }, (_, index) => `Distinct provider mapping change ${index + 1}`) });
    await expect(previewCreatePlannedWorkout({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, localDate: '2026-09-18', title: 'Complex ride',
        structure, delivery: { providers: ['garmin'], timeZone: 'Europe/Helsinki' } } }, deps))
      .rejects.toThrow('too extensive for one safe preview');
    expect((await db.collection('users').doc(uid).collection('scheduledWorkouts').get()).empty).toBe(true);
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

  it('previews and applies a different-date plan copy with a fresh planned identity and range extension', async () => {
    const user = db.collection('users').doc(uid);
    const setup = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: 1, changes: [
        { kind: 'create-plan', localKey: 'plan', name: 'September', startDate: '2026-09-18',
          endDate: '2026-09-30', activate: false },
        { kind: 'create-workout', localKey: 'run', plan: { localKey: 'plan' }, localDate: '2026-09-20',
          title: 'Easy run', structure },
        { kind: 'set-workout-lifecycle', workout: { localKey: 'run' }, lifecycle: 'skipped' },
      ] } }, deps);
    const created = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: setup.proposalRef, permissionMode: 'schedule' } }, deps);
    const planRef = created.createdReferences.find(item => item.kind === 'plan')!.reference;
    const workoutRef = created.createdReferences.find(item => item.kind === 'workout')!.reference;
    const original = (await user.collection('scheduledWorkouts').get()).docs[0];
    await user.collection('trainingWorkoutCompletions').doc(original.id).set({
      schemaVersion: 1, workoutId: original.id, status: 'linked',
    });

    const preview = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { expectedScheduleRevision: created.scheduleRevision, changes: [
        { kind: 'copy-workout', sourceWorkout: { ref: workoutRef }, localKey: 'duplicate',
          plan: { ref: planRef }, localDate: '2027-01-02' },
      ] } }, deps);
    expect(preview).toMatchObject({ permissionMode: 'schedule', requiresConfirmation: true,
      changes: [{ kind: 'copy-workout', summary: expect.stringContaining('2027-01-02') }] });
    expect(preview.changes[0].summary).toContain('The destination plan range will extend to 2026-09-18 through 2027-01-02.');
    const input = { uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: preview.proposalRef, permissionMode: 'schedule' as const } };
    const applied = await applyTrainingChanges(input, deps);
    expect(applied.status).toBe('applied');
    expect(applied.createdReferences).toEqual([expect.objectContaining({ localKey: 'duplicate', kind: 'workout' })]);
    const workouts = (await user.collection('scheduledWorkouts').get()).docs;
    expect(workouts).toHaveLength(2);
    const duplicate = workouts.find(doc => doc.id !== original.id)!;
    expect(duplicate.data()).toMatchObject({ title: 'Easy run', localDate: '2027-01-02',
      planId: original.data().planId, lifecycle: 'planned', revision: 1 });
    expect(duplicate.data().structure).toEqual(original.data().structure);
    expect((await user.collection('trainingWorkoutCompletions').doc(duplicate.id).get()).exists).toBe(false);
    expect((await original.ref.get()).data()).toMatchObject({ localDate: '2026-09-20', lifecycle: 'skipped' });
    expect((await user.collection('trainingPlans').doc(original.data().planId).get()).get('endLocalDate'))
      .toBe('2027-01-02');
    await expect(applyTrainingChanges(input, deps)).resolves.toEqual(applied);
    expect((await user.collection('scheduledWorkouts').get()).size).toBe(2);
  });

  it('does not inherit standalone delivery consent and rejects a copy after the source revision changes', async () => {
    const user = db.collection('users').doc(uid);
    const setup = await previewCreateAndSend();
    const created = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: setup.proposalRef, permissionMode: 'combined' } }, deps);
    const workoutRef = created.createdReferences.find(item => item.kind === 'workout')!.reference;
    const original = (await user.collection('scheduledWorkouts').get()).docs[0];
    const copyArguments = { expectedScheduleRevision: created.scheduleRevision, changes: [
      { kind: 'copy-workout', sourceWorkout: { ref: workoutRef }, localKey: 'duplicate',
        plan: null, localDate: '2026-09-19' },
    ] };
    const stale = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: copyArguments }, deps);
    await user.collection('scheduledWorkouts').doc(original.id).update({ revision: 2 });
    const staleResult = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: stale.proposalRef, permissionMode: 'schedule' } }, deps);
    expect(staleResult).toMatchObject({ status: 'partially_applied', changes: [{ status: 'failed' }] });
    expect((await user.collection('scheduledWorkouts').get()).size).toBe(1);

    const fresh = await previewTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: copyArguments }, deps);
    const applied = await applyTrainingChanges({ uid, connectionId: 'connection', scopes,
      arguments: { proposalRef: fresh.proposalRef, permissionMode: 'schedule' } }, deps);
    expect(applied.status).toBe('applied');
    const duplicate = (await user.collection('scheduledWorkouts').get()).docs.find(doc => doc.id !== original.id)!;
    expect(duplicate.data()).toMatchObject({ planId: null, localDate: '2026-09-19', lifecycle: 'planned' });
    expect((await user.collection('trainingDeliverySettings').get()).docs)
      .toHaveLength(1);
    expect((await user.collection('trainingDeliverySettings').get()).docs[0].id)
      .toContain(original.id);
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
