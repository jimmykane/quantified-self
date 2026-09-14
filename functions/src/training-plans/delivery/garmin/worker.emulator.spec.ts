import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { TrainingDeliveryCommandV1 } from '../../../../../shared/training-provider-delivery';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, type DeliveryLedgerV1, type DeliveryOperation, type DeliveryRuntime } from '../contracts';
import { trainingDeliveryCommand } from '../commands';
import { stageTrainingDeliveryDisconnect, stageTrainingDeliveryReconciliation } from '../marker';
import { reconcileTrainingDeliveryPage } from '../store';
import { processTrainingDelivery } from '../worker';
import { DELIVERY_SERVICES, productionDeliveryRuntime } from '../runtime';
import { GarminHttpFixture } from '../test-support/garmin-http-fixture';
import { GarminTrainingTransport } from './transport';
import { GarminTrainingHttpError } from './http';
import { authorizeGarminTrainingRequest } from './authorization';

// Real Firestore authority and worker transactions; shared OAuth refresh is replaced
// with its persisted result, and every provider request stays in the synthetic server.
vi.mock('../../../tokens', () => ({ getTokenData: vi.fn(async snapshot => snapshot.data()) }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Garmin delivery / real Firestore / synthetic HTTP', { timeout: 30_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-training-delivery' });
  const users: string[] = [];
  const service = DELIVERY_SERVICES.garmin;
  let uid: string;
  let runtime: DeliveryRuntime;
  let server: GarminHttpFixture;
  let now: number;
  let pro: boolean;
  const user = () => db.collection('users').doc(uid);
  const credential = () => db.collection(service.tokens).doc(uid).collection('tokens').doc('current');
  const ledger = async () => (await user().collection(DELIVERY_LEDGER).get()).docs[0]?.data() as DeliveryLedgerV1;
  const mark = () => db.runTransaction(async tx => { stageTrainingDeliveryReconciliation(tx, db, uid); });
  const drain = async () => {
    for (let page = 0; page < 20; page++) if (!await reconcileTrainingDeliveryPage(runtime, uid)) return;
    throw new Error('Unbounded fixture scan');
  };
  const command = async (action: TrainingDeliveryCommandV1['action'] = 'send') => {
    const [state, workout, settings] = await Promise.all([
      user().collection('trainingPlanState').doc('current').get(), user().collection('scheduledWorkouts').doc('w').get(),
      user().collection('trainingDeliverySettings').doc('workout_w_garmin').get(),
    ]);
    return trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w',
      provider: 'garmin', action, timeZone: 'Europe/Helsinki', expectedScheduleRevision: state.data()!.revision,
      expectedScopeRevision: workout.data()!.revision, expectedSettingsRevision: settings.data()?.revision ?? 0 }, false);
  };
  const send = async () => { await command(); await drain(); return (await ledger()).id; };
  const retry = async (id: string) => { now = Math.max(now, (await ledger()).retryAtMs + 1); await processTrainingDelivery(runtime, uid, id); };
  const edit = async () => {
    await user().collection('scheduledWorkouts').doc('w').update({ title: 'Revised run', revision: 2, localDate: '2026-09-21' });
    await user().collection('trainingPlanState').doc('current').update({ revision: 2 });
    await mark(); await drain();
  };
  beforeEach(async () => {
    uid = `garmin-delivery-test-${randomUUID()}`; users.push(uid);
    now = Date.parse('2026-09-14T10:00:00Z'); pro = true; server = new GarminHttpFixture();
    const bind = (operation: DeliveryOperation) => new GarminTrainingTransport(async (request, beforeSend) => {
      await authorizeGarminTrainingRequest(db, uid, operation);
      return server.request(request, beforeSend);
    }, () => now);
    const policy = new GarminTrainingTransport(server.request, () => now);
    runtime = { ...productionDeliveryRuntime(db), now: () => now, hasPro: async () => pro,
      transport: provider => provider !== 'garmin' ? null : {
        mappingVersion: policy.mappingVersion, horizonDays: policy.horizonDays,
        assess: (...args) => policy.assess(...args), canRemove: (...args) => policy.canRemove(...args),
        execute: (operation, checkpoint, guard) => bind(operation).execute(operation, checkpoint, guard),
        recover: (operation, checkpoint, guard) => bind(operation).recover(operation, checkpoint, guard),
      } };
    const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'w', planId: null, revision: 1, title: 'Easy run',
      localDate: '2026-09-20', lifecycle: 'planned', createdAtMs: 1, updatedAtMs: 1,
      structure: { version: 1, sport: ActivityTypes.Running,
        nodes: [{ id: 's', kind: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } };
    await user().set({ fixture: true });
    await user().collection('trainingPlanState').doc('current').set({ schemaVersion: 1, revision: 1,
      activePlanId: null, currentWorkoutCount: 1, updatedAtMs: 1 });
    await user().collection('scheduledWorkouts').doc('w').set(workout);
    await user().collection('meta').doc(service.name).set({ connectionState: 'connected', connectionStateGeneration: 'connection-1', providerUserId: 'account-a' });
    await db.collection(service.tokens).doc(uid).set({ activeOAuthCredentialGeneration: 'credential-1' });
    await credential().set({ serviceName: service.name, userID: 'account-a', tokenCredentialGeneration: 'credential-1',
      accessToken: 'synthetic-only', expiresAt: Date.now() + 86_400_000, permissions: ['WORKOUT_IMPORT'] });
  });
  afterAll(async () => {
    for (const id of users) {
      await db.recursiveDelete(db.collection('users').doc(id));
      await db.recursiveDelete(db.collection(service.tokens).doc(id));
      await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      const jobs = await db.collection(DELIVERY_QUEUE).where('uid', '==', id).get();
      for (const job of jobs.docs) await db.recursiveDelete(job.ref);
    }
    await db.terminate();
  }, 120_000);

  it('serializes duplicate workers, updates retained Long IDs, and deletes both artifacts after Stop without Pro', async () => {
    const id = await send();
    await Promise.all([processTrainingDelivery(runtime, uid, id), processTrainingDelivery(runtime, uid, id)]);
    const accepted = await ledger();
    expect(accepted.status).toBe('delivered');
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
    await edit(); await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).actual?.ids).toEqual(accepted.actual?.ids);
    expect(server.workouts.values().next().value?.workoutName).toBe('Revised run');
    expect(server.schedules.values().next().value?.date).toBe('2026-09-21');
    pro = false; await command('stop'); await drain(); await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).status).toBe('removed');
    expect(server.workouts.size + server.schedules.size).toBe(0);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
  }, 30_000);

  it('confirms an empty successful schedule create in one worker attempt, retaining one identity under duplicate dispatch', async () => {
    const request = server.request;
    server.request = async (...args) => {
      const result = await request(...args);
      return args[0].method === 'POST' && args[0].path === '/training-api/schedule/' ? { status: 204, body: null } : result;
    };
    const id = await send();
    await Promise.all([processTrainingDelivery(runtime, uid, id), processTrainingDelivery(runtime, uid, id)]);
    const current = await ledger();
    expect(current.status).toBe('delivered'); expect(current.retries).toBe(0); expect(current.attempt).toBeNull();
    expect(Object.keys(current.actual!.ids).sort()).toEqual(['owner', 'schedule', 'workout']);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
  });

  it.each(['edit', 'stop', 'expiry', 'lease'] as const)('retains an accepted workout when %s wins before schedule creation', async change => {
    const id = await send();
    server.afterHandle = async request => {
      if (request.method !== 'POST' || !request.path.includes('workout')) return;
      server.afterHandle = null;
      if (change === 'edit') await edit();
      if (change === 'stop') { await command('stop'); await drain(); }
      if (change === 'expiry') { pro = false; await mark(); await drain(); }
      if (change === 'lease') now += 180_001;
    };
    await processTrainingDelivery(runtime, uid, id);
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(0);
    expect((await ledger()).actual?.ids.workout).toBe([...server.workouts.keys()][0]);
    await retry(id); await drain();
    if (change === 'expiry') {
      expect(server.schedules.size).toBe(0);
      pro = true; await mark(); await drain();
    }
    await retry(id); await drain(); await retry(id);
    expect((await ledger()).status).toBe(change === 'stop' ? 'stopped' : 'delivered');
    expect(server.workouts.size).toBe(change === 'stop' ? 0 : 1);
    expect(server.schedules.size).toBe(change === 'stop' ? 0 : 1);
    expect(server.calls.filter(request => request.method === 'POST' && request.path.includes('workout'))).toHaveLength(1);
  }, 30_000);

  it.each(['lost-response', 'lost-checkpoint'] as const)('never repeats an ambiguous first POST after %s, even on explicit Retry', async fault => {
    const id = await send(); let persistence: ReturnType<typeof vi.spyOn> | undefined;
    server.afterHandle = async request => {
      if (request.method !== 'POST') return;
      server.afterHandle = null;
      if (fault === 'lost-response') throw new GarminTrainingHttpError('uncertain', false);
      persistence = vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('Synthetic persistence failure'));
    };
    await processTrainingDelivery(runtime, uid, id); persistence?.mockRestore();
    expect((await ledger()).attempt?.progress).toMatchObject({ step: 'workout-create', state: 'started' });
    await retry(id); expect((await ledger()).status).toBe('needs_attention');
    await command('retry'); await drain(); await retry(id);
    expect((await ledger()).status).toBe('needs_attention');
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(1);
  });

  it('recovers a schedule accepted before a lost response through an exact workout/date lookup', async () => {
    const id = await send();
    server.afterHandle = async request => {
      if (request.method === 'POST' && request.path.includes('schedule')) {
        server.afterHandle = null; throw new GarminTrainingHttpError('uncertain', false);
      }
    };
    await processTrainingDelivery(runtime, uid, id); await retry(id);
    expect((await ledger()).status).toBe('delivered');
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
    expect(server.calls.some(request => request.path.includes('schedule?startDate=2026-09-20'))).toBe(true);
  });

  it('reconciles a revert after an intervening edit reached Garmin instead of trusting the old accepted digest', async () => {
    const original = (await user().collection('scheduledWorkouts').doc('w').get()).data()!;
    const id = await send(); await processTrainingDelivery(runtime, uid, id);
    const first = await ledger();
    await edit();
    server.afterHandle = async request => {
      if (request.method !== 'PUT' || !request.path.includes('workout')) return;
      server.afterHandle = null;
      await user().collection('scheduledWorkouts').doc('w').set({ ...original, revision: 3 });
      await user().collection('trainingPlanState').doc('current').update({ revision: 3 });
      await mark(); await drain();
    };
    await processTrainingDelivery(runtime, uid, id);
    expect(server.workouts.values().next().value?.workoutName).toBe('Revised run');
    const projection = await user().collection('trainingDeliveryStatuses').doc(id).get();
    expect(projection.data()?.differsFromQS).toBe(true);
    await retry(id); await drain(); await retry(id);
    expect((await ledger()).status).toBe('delivered');
    expect((await ledger()).actual?.ids).toEqual(first.actual?.ids);
    expect(server.workouts.values().next().value?.workoutName).toBe('Easy run');
    expect(server.schedules.values().next().value?.date).toBe(original.localDate);
    expect(server.calls.filter(request => request.method === 'POST')).toHaveLength(2);
  });

  it.each(['edit', 'retry', 'stop-resume'] as const)('does not bypass a provider Retry-After after %s', async action => {
    const id = await send();
    server.beforeHandle = async () => {
      server.beforeHandle = null; throw new GarminTrainingHttpError('retryable', true, 86_400_000);
    };
    await processTrainingDelivery(runtime, uid, id);
    const dueAt = (await ledger()).retryAtMs;
    const requests = server.calls.length;
    if (action === 'edit') await edit();
    else if (action === 'stop-resume') { await command('stop'); await drain(); await command('resume'); await drain(); }
    else { await command('retry'); await drain(); }
    await processTrainingDelivery(runtime, uid, id);
    expect(server.calls).toHaveLength(requests);
    expect(await ledger()).toMatchObject({ status: 'retrying', retryAtMs: dueAt });
    await retry(id); await drain(); await retry(id);
    expect((await ledger()).status).toBe('delivered');
    expect(server.workouts.size).toBe(1); expect(server.schedules.size).toBe(1);
  });

  it.each(['replacement', 'completed'] as const)('retains late acceptance after a %s lease without permitting another POST', async state => {
    const id = await send();
    server.afterHandle = async request => {
      if (request.method !== 'POST') return;
      server.afterHandle = null;
      await user().collection(DELIVERY_LEDGER).doc(id).update(state === 'completed' ? { lease: null, attempt: null }
        : { lease: { id: 'replacement-worker', expiresAtMs: now + 180_000 },
          'attempt.progress': { version: 1, step: 'schedule-create', state: 'started' } });
    };
    await processTrainingDelivery(runtime, uid, id);
    const current = await ledger();
    expect(current).toMatchObject({ status: 'needs_attention', lease: null,
      actual: { ids: { workout: [...server.workouts.keys()][0] } },
      attempt: { recoveryBlocked: true, progress: { step: state === 'completed' ? 'workout-create' : 'schedule-create', state: 'started' } } });
    const evidence = await user().collection(DELIVERY_LEDGER).doc(id).collection('attempts').doc(current.attempt!.id)
      .collection('lateAcceptances').get();
    expect(evidence.size).toBe(1);
    expect(evidence.docs[0].data().artifact.ids.workout).toBe([...server.workouts.keys()][0]);
    await command('retry'); await drain(); await retry(id);
    expect((await ledger()).status).toBe('needs_attention'); expect(server.calls).toHaveLength(1);
  });

  it('shows permission repair before consent and resumes a rejected request only after same-account reconnect', async () => {
    await credential().update({ permissions: ['ACTIVITY_EXPORT'] });
    const authority = await db.runTransaction(tx => runtime.connection(tx, uid, 'garmin'));
    expect(authority).toMatchObject({ state: 'connection_repair', issues: [expect.stringContaining('Garmin Training permission')] });
    await expect(command()).rejects.toMatchObject({ code: 'failed-precondition' });
    await credential().update({ permissions: ['WORKOUT_IMPORT'] });
    const id = await send();
    server.beforeHandle = async () => { server.beforeHandle = null; throw new GarminTrainingHttpError('permission', true); };
    await processTrainingDelivery(runtime, uid, id);
    expect(await ledger()).toMatchObject({ status: 'connection_repair', issues: [expect.stringContaining('Reconnect')] });
    await command('retry'); await drain(); await retry(id); expect(server.workouts.size).toBe(0);
    await user().collection('meta').doc(service.name).update({ connectionStateGeneration: 'connection-2' });
    await mark(); await drain(); await retry(id);
    expect((await ledger()).status).toBe('delivered');
  });

  it('invalidates old consent after a different account reconnect or explicit disconnect', async () => {
    const id = await send(); await processTrainingDelivery(runtime, uid, id);
    const requests = server.calls.length;
    await credential().update({ userID: 'account-b' });
    await user().collection('meta').doc(service.name).update({ providerUserId: 'account-b', connectionStateGeneration: 'connection-2' });
    await mark(); await drain(); await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).status).toBe('fresh_consent_required');
    await db.runTransaction(async tx => stageTrainingDeliveryDisconnect(tx, db, uid, 'garmin'));
    await drain(); await processTrainingDelivery(runtime, uid, id);
    expect(server.calls).toHaveLength(requests); expect(server.workouts.size).toBe(1);
  });

  it('fences further HTTP and local record recreation after deletion wins during provider acceptance', async () => {
    const id = await send();
    server.afterHandle = async () => {
      server.afterHandle = null;
      await db.collection('userDeletionTombstones').doc(uid).set({ deleting: true });
      await db.recursiveDelete(user());
    };
    await processTrainingDelivery(runtime, uid, id);
    expect(await ledger()).toBeUndefined();
    expect(server.calls).toHaveLength(1); expect(server.schedules.size).toBe(0);
    await processTrainingDelivery(runtime, uid, id);
    expect((await user().listCollections())).toEqual([]);
  });
});
