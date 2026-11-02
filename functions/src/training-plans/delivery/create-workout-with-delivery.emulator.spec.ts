import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import type { MutateTrainingScheduleRequestV1 } from '../../../../shared/training-plans';
import { deliverySettingsId, TRAINING_DELIVERY_SETTINGS } from '../../../../shared/training-provider-delivery';
import { createWorkoutWithDeliveryForUser } from '../create-workout-with-delivery';
import { mutateTrainingScheduleForUser } from '../persistence';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, DELIVERY_STATE, type DeliveryRuntime, type DeliveryLedgerV1 } from './contracts';
import { reconciliationJobId } from './marker';
import { reconcileTrainingDeliveryPage } from './store';
import { processTrainingDelivery } from './worker';
import { trainingDeliveryCommand } from './commands';
import { GarminHttpFixture } from './test-support/garmin-http-fixture';
import { GarminTrainingTransport } from './garmin/transport';
import { projectStrengthWorkoutToV1 } from '../../../../shared/strength-workout';
import { FakeTrainingTransport } from './test-support/fake-transport';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
describe.skipIf(!host)('Atomic Add & send with the existing delivery queue', () => {
  const db = new Firestore({ projectId: 'demo-training-delivery' }), owners: string[] = [];
  let uid: string, runtime: DeliveryRuntime, garmin: FakeTrainingTransport, suunto: FakeTrainingTransport;
  const now = Date.parse('2026-11-02T08:00:00Z');
  const user = () => db.collection('users').doc(uid);
  const setting = (provider: PlannedWorkoutProviderId = 'garmin') => user().collection(TRAINING_DELIVERY_SETTINGS).doc(deliverySettingsId('workout', 'w', provider));
  const request = (): MutateTrainingScheduleRequestV1 => ({ mutationId: randomUUID(),
    expectedRevisions: [{ scope: 'state', id: 'current', revision: 0 }], operation: {
      kind: 'create-workout', workoutId: 'w', planId: null, localDate: '2026-11-02', title: 'Synthetic daily run', confirmPlanRangeExtension: false,
      structure: { version: 1, sport: ActivityTypes.Running, nodes: [
        { kind: 'step', id: 'steady', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] },
      ] },
    } });
  const approve = (value = request(), providers: ('garmin' | 'suunto')[] = ['garmin']) =>
    createWorkoutWithDeliveryForUser(uid, value, { providers, timeZone: 'Europe/Helsinki' }, runtime);
  const drain = async () => { for (let i = 0; i < 50; i++) if (!await reconcileTrainingDeliveryPage(runtime, uid)) return; throw new Error('Unbounded reconciliation'); };
  const rows = async () => (await user().collection(DELIVERY_LEDGER).get()).docs.map(doc => doc.data() as DeliveryLedgerV1);
  beforeEach(async () => {
    uid = `durable-add-test-${randomUUID()}`; owners.push(uid);
    garmin = new FakeTrainingTransport(); suunto = new FakeTrainingTransport();
    await user().set({});
    await user().collection('config').doc('settings').set({ dailyWorkoutDelivery: { enabled: true, providers: ['garmin', 'suunto'] } });
    runtime = { db, now: () => now, hasPro: async () => true,
      transport: provider => provider === 'garmin' ? garmin : provider === 'suunto' ? suunto : null,
      connection: async (tx, _uid, provider) => {
        const snapshot = await tx.get(user().collection('meta').doc(provider));
        return { state: snapshot.get('state') ?? 'connected', destinationKey: `synthetic-${provider}`,
          generation: 'generation-1', epoch: snapshot.get('epoch') ?? 0 };
      } };
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const owner of owners) {
      await db.recursiveDelete(db.collection('users').doc(owner));
      // Queue rows are synthetic leaves, without descendants.
      const jobs = await db.collection(DELIVERY_QUEUE).where('uid', '==', owner).get();
      for (const job of jobs.docs) await job.ref.delete();
      await db.collection('userDeletionTombstones').doc(owner).delete(); // Synthetic tombstones are leaves.
    }
    await db.terminate();
  });
  it('delivers after the create response is lost, without another browser request', async () => {
    await expect(approve(request(), ['garmin', 'suunto']).then(() => { throw new Error('Browser tab closed before response'); })).rejects.toThrow('tab closed');
    expect((await user().collection('scheduledWorkouts').doc('w').get()).exists).toBe(true);
    expect((await db.collection(DELIVERY_QUEUE).doc(reconciliationJobId(uid)).get()).exists).toBe(true);
    expect((await setting().get()).get('enabled')).toBe(true);
    expect((await setting().get()).get('scopeGeneration'))
      .toBe((await user().collection('trainingDeliveryScopes').doc('w').get()).get('generation'));
    await drain();
    for (const row of await rows()) await processTrainingDelivery(runtime, uid, row.id);
    expect(garmin.calls).toHaveLength(1); expect(suunto.calls).toHaveLength(1);
    expect((await rows()).every(row => row.status === 'delivered')).toBe(true);
    expect((await user().collection('config').doc('settings').get()).get('dailyWorkoutDelivery'))
      .toEqual({ enabled: true, providers: ['garmin', 'suunto'] });
  });
  it.each([false, true])('uses the real Garmin serializer and worker after atomic admission (strength: %s)', async strengthWorkout => {
    const server = new GarminHttpFixture(), transport = new GarminTrainingTransport(server.request, () => now);
    runtime.transport = provider => provider === 'garmin' ? transport : null;
    const value = request();
    if (strengthWorkout && value.operation.kind === 'create-workout') {
      const strength = { version: 1 as const, exercises: [{ id: 'squat', name: 'Barbell back squat', sets: [
        { id: 'one', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 90 },
      ] }] };
      value.operation.strength = strength;
      value.operation.structure = projectStrengthWorkoutToV1({ ...strength, workoutId: 'w', revision: 1 });
    }
    expect((await approve(value)).deliveryOutcomes).toEqual([{ provider: 'garmin', state: 'queued' }]);
    expect(server.calls).toHaveLength(0); // Admission never performs provider HTTP.
    await drain(); for (const row of await rows()) await processTrainingDelivery(runtime, uid, row.id);
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
    expect((await rows())[0].status).toBe('delivered');
  });
  it('rolls back the workout, consent and queue together if the final receipt cannot commit', async () => {
    const run = db.runTransaction.bind(db);
    const spy = vi.spyOn(db, 'runTransaction').mockImplementation((update, options) => run(tx => update(new Proxy(tx, { get(target, property) {
      const value = Reflect.get(target, property);
      if (property === 'create') return (ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) => {
        if (ref.path.includes('/trainingDeliveryState/')) throw Error('Synthetic crash before commit');
        return target.create(ref, data);
      };
      return typeof value === 'function' ? value.bind(target) : value;
    } })), options));
    try { await expect(approve()).rejects.toThrow('crash before commit'); } finally { spy.mockRestore(); }
    expect((await user().collection('scheduledWorkouts').doc('w').get()).exists).toBe(false);
    expect((await setting().get()).exists).toBe(false);
    expect((await db.collection(DELIVERY_QUEUE).doc(reconciliationJobId(uid)).get()).exists).toBe(false);
  });
  it('coalesces concurrent receipt retries into one creation and delivery', async () => {
    const value = request(); const [a, b] = await Promise.all([approve(value), approve(value)]);
    expect(a).toEqual(b); expect((await user().collection('scheduledWorkouts').get()).size).toBe(1);
    await drain(); for (const row of await rows()) await processTrainingDelivery(runtime, uid, row.id);
    expect(garmin.calls).toHaveLength(1);
  }, 30_000);
  it('never re-enables stopped sync when replaying the original approved Add', async () => {
    const value = request(), created = await approve(value), prior = (await setting().get()).data()!;
    await trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w',
      provider: 'garmin', action: 'stop', expectedScheduleRevision: created.state.revision, expectedScopeRevision: 1,
      expectedSettingsRevision: prior.revision }, false);
    const stopped = (await setting().get()).data(), queued = (await db.collection(DELIVERY_QUEUE).doc(reconciliationJobId(uid)).get()).get('generation');
    expect(await approve(value)).toEqual(created);
    expect((await setting().get()).data()).toEqual(stopped); expect(stopped!.enabled).toBe(false);
    expect((await db.collection(DELIVERY_QUEUE).doc(reconciliationJobId(uid)).get()).get('generation')).toBe(queued);
  });
  it('keeps a deleted workout deleted when an old approval is replayed', async () => {
    const value = request(), created = await approve(value);
    await mutateTrainingScheduleForUser(uid, { mutationId: randomUUID(), expectedRevisions: [
      { scope: 'state', id: 'current', revision: created.state.revision }, { scope: 'workout', id: 'w', revision: 1 },
    ], operation: { kind: 'delete-workout', workoutId: 'w', removePastProviderCopies: false } }, { db, nowMs: now + 1 });
    const consent = (await setting().get()).data();
    await approve(value);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('lifecycle')).toBe('deleted');
    expect((await setting().get()).data()).toEqual(consent);
    await drain(); for (const row of await rows()) await processTrainingDelivery(runtime, uid, row.id);
    expect(garmin.calls).toHaveLength(0);
  });
  it('never exposes unexpected fields from a malformed private receipt', async () => {
    const value = request(); await approve(value);
    const receipts = await user().collection(DELIVERY_STATE).doc('current').collection('receipts').get();
    await receipts.docs[0].ref.update({ outcomes: [{ provider: 'garmin', state: 'queued', privateField: 'private-canary' }] });
    await expect(approve(value)).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('binds retries to the originally approved providers and time zone', async () => {
    const value = request(); await approve(value);
    await expect(approve(value, ['suunto'])).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(createWorkoutWithDeliveryForUser(uid, value, { providers: ['garmin'], timeZone: 'UTC' }, runtime))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await setting('suunto').get()).exists).toBe(false);
  });
  it('keeps a skipped plain Add free of delivery consent and cannot upgrade its receipt later', async () => {
    const value = request(); await mutateTrainingScheduleForUser(uid, value, { db, nowMs: now });
    await drain(); expect(await rows()).toEqual([]); expect((await setting().get()).exists).toBe(false);
    await expect(approve(value)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await user().collection('config').doc('settings').get()).get('dailyWorkoutDelivery'))
      .toEqual({ enabled: true, providers: ['garmin', 'suunto'] });
  });
  it.each(['degraded', 'unsupported', 'disconnected', 'no-pro', 'unavailable', 'prior-settings', 'retired-scope'] as const)('saves the workout without granting unsafe consent: %s', async reason => {
      if (reason === 'degraded' || reason === 'unsupported') garmin.level = reason;
      if (reason === 'disconnected') await user().collection('meta').doc('garmin').set({ state: 'reconnect_required' });
      if (reason === 'no-pro') runtime.hasPro = async () => false;
      if (reason === 'unavailable') runtime.transport = () => null;
      if (reason === 'prior-settings') await setting().set({ enabled: false, revision: 1 });
      if (reason === 'retired-scope') await user().collection('trainingDeliveryScopes').doc('w').set({ generation: 1 });
      expect((await approve()).deliveryOutcomes).toEqual([{ provider: 'garmin', state: 'review-required' }]);
      expect((await user().collection('scheduledWorkouts').doc('w').get()).exists).toBe(true);
      expect((await setting().get()).get('enabled')).not.toBe(true);
      await drain(); expect(garmin.calls).toHaveLength(0);
    });
  it('isolates an unsupported service while admitting another selected service', async () => {
    garmin.level = 'unsupported';
    expect((await approve(request(), ['garmin', 'suunto'])).deliveryOutcomes)
      .toEqual([{ provider: 'garmin', state: 'review-required' }, { provider: 'suunto', state: 'queued' }]);
    await drain(); for (const row of await rows()) await processTrainingDelivery(runtime, uid, row.id);
    expect(garmin.calls).toHaveLength(0); expect(suunto.calls).toHaveLength(1);
  });
  it('rechecks disconnect before the queue can send', async () => {
    await approve(); await user().collection('meta').doc('garmin').set({ state: 'reconnect_required', epoch: 1 });
    await drain(); for (const row of await rows()) await processTrainingDelivery(runtime, uid, row.id);
    expect(garmin.calls).toHaveLength(0);
  });
  it('rejects account deletion without saving a workout or delivery settings', async () => {
    await db.collection('userDeletionTombstones').doc(uid).set({});
    await expect(approve()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await user().collection('scheduledWorkouts').doc('w').get()).exists).toBe(false);
    expect((await setting().get()).exists).toBe(false);
  });
});
