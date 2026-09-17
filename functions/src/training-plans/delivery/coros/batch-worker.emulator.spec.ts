import { createHash, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledWorkoutV1 } from '../../../../../shared/training-plans';
import type { TrainingDeliverySettingsV1 } from '../../../../../shared/training-provider-delivery';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, type DeliveryLedgerV1, type DeliveryRuntime,
  type TrainingDeliveryTransport } from '../contracts';
import { deliveryContentDigest, deliveryIdentity } from '../intent';
import { processTrainingDelivery } from '../worker';
import { CorosTrainingTransport } from './transport';
import { COROS_INTEGER_CLAIMS, corosIntegerCandidate, reserveCorosIntegerIdentities } from './identities';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('COROS Training batch Firestore transactions', { timeout: 60_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-training-delivery' });
  const users: string[] = [];
  const now = Date.parse('2026-09-17T10:00:00Z');
  let uid: string;
  let transport: CorosTrainingTransport;
  let client: ReturnType<typeof vi.fn>;
  let runtime: DeliveryRuntime;

  const workout = (index: number): ScheduledWorkoutV1 => ({ schemaVersion: 1, id: `w${index}`, planId: null,
    revision: 1, title: `Workout ${index}`,
    localDate: new Date(Date.UTC(2026, 8, 18 + index)).toISOString().slice(0, 10), lifecycle: 'planned',
    createdAtMs: now, updatedAtMs: now + index,
    structure: { version: 1, sport: ActivityTypes.Running, nodes: [
      { kind: 'step', id: 'run', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] },
    ] } });

  const seed = async (count: number): Promise<string[]> => {
    const user = db.collection('users').doc(uid);
    const ids: string[] = [];
    const batch = db.batch();
    for (let index = 0; index < count; index++) {
      const current = workout(index);
      const id = deliveryIdentity(uid, 'coros', 'destination', current.id);
      const assessment = transport.assess(current, 'destination', 'Europe/Helsinki');
      const setting: TrainingDeliverySettingsV1 = { schemaVersion: 1, scope: 'workout', scopeId: current.id,
        provider: 'coros', revision: 1, enabled: true, suppressed: false, timeZone: 'Europe/Helsinki',
        destinationKey: 'destination', connectionEpoch: 0, scopeGeneration: 0, associationPlanId: null,
        approvedDigest: assessment.level === 'degraded' ? assessment.digest : null, updatedAtMs: now };
      const ledger: DeliveryLedgerV1 = { schemaVersion: 1, id, workoutId: current.id, planId: null, provider: 'coros',
        destinationKey: 'destination', desiredGeneration: 1, connectionEpoch: 0, settingsRevision: 1,
        desiredDigest: assessment.digest, desired: 'present', status: 'pending', timeZone: 'Europe/Helsinki',
        issues: assessment.issues, approvalDigest: setting.approvedDigest, actual: null, acceptedDigest: null,
        contentDigest: deliveryContentDigest(current, setting.timeZone), acceptedContentDigest: null,
        attempt: null, lease: null, retries: 0, retryAtMs: 0, blockedConnectionGeneration: null,
        lastAttemptAtMs: null, lastAcceptedAtMs: null, updatedAtMs: now };
      batch.set(user.collection('scheduledWorkouts').doc(current.id), current);
      batch.set(user.collection('trainingDeliverySettings').doc(`workout_${current.id}_coros`), setting);
      batch.set(user.collection(DELIVERY_LEDGER).doc(id), ledger);
      batch.set(db.collection(DELIVERY_QUEUE).doc(id), { uid, kind: 'delivery', deliveryId: id, provider: 'coros',
        destinationKey: 'destination', operationKind: 'upsert', dueAtMs: 0, dispatchToken: randomUUID() });
      ids.push(id);
    }
    await batch.commit();
    return ids;
  };

  beforeEach(async () => {
    uid = `coros-training-${randomUUID()}`;
    users.push(uid);
    client = vi.fn(async (request: { data?: string; workoutIds?: string }, beforeSend: () => Promise<void>) => {
      await beforeSend();
      if (request.data) {
        const payload = JSON.parse(request.data);
        return { status: 200, body: { result: '0000', message: 'OK', data: {
          StartDate: payload.StartDate.replaceAll('-', ''), EndDate: payload.EndDate.replaceAll('-', ''),
        } } };
      }
      const workoutIds = JSON.parse(request.workoutIds!);
      return { status: 200, body: { result: '0000', message: 'OK', data: { successIdList: workoutIds, failIdList: [] } } };
    });
    transport = new CorosTrainingTransport(client, () => now, reserveCorosIntegerIdentities);
    runtime = { db, now: () => now, hasPro: async () => true, transport: provider => provider === 'coros' ? transport : null,
      connection: async () => ({ state: 'connected', destinationKey: 'destination', generation: 'connection', epoch: 0 }) };
    await db.collection('users').doc(uid).set({ fixture: true });
  });

  afterAll(async () => {
    for (const id of users) {
      await db.recursiveDelete(db.collection('users').doc(id));
      const jobs = await db.collection(DELIVERY_QUEUE).where('uid', '==', id).get();
      await Promise.all(jobs.docs.map(job => db.recursiveDelete(job.ref)));
      const claims = await db.collection(COROS_INTEGER_CLAIMS).where('uid', '==', id).get();
      await Promise.all(claims.docs.map(claim => claim.ref.delete()));
    }
    await db.terminate();
  }, 120_000);

  it('coalesces 30, leaves the 31st pending, and journals accepted identities atomically', async () => {
    const ids = await seed(31);
    await processTrainingDelivery(runtime, uid, ids[0]);
    expect(client).toHaveBeenCalledTimes(1);
    expect(JSON.parse(client.mock.calls[0][0].data).Workouts).toHaveLength(30);
    const ledgers = await db.collection('users').doc(uid).collection(DELIVERY_LEDGER).get();
    expect(ledgers.docs.filter(doc => doc.data().status === 'delivered')).toHaveLength(30);
    expect(ledgers.docs.filter(doc => doc.data().status === 'pending')).toHaveLength(1);
    expect((await db.collection(DELIVERY_QUEUE).where('uid', '==', uid).where('kind', '==', 'delivery').get()).size).toBe(1);
    const batches = await db.collection('users').doc(uid).collection('trainingDeliveryState').doc('current').collection('batches').get();
    expect(batches.size).toBe(1);
    expect(batches.docs[0].data()).toMatchObject({ state: 'accepted', operationKind: 'upsert' });
    expect(batches.docs[0].data().acceptedDeliveryIds).toHaveLength(30);
    const claims = await db.collection(COROS_INTEGER_CLAIMS).where('uid', '==', uid).get();
    expect(claims.size).toBe(31);
    expect(claims.docs.every(claim => claim.data().uid === uid)).toBe(true);
  });

  it('serializes concurrent workers and sends each workout once', async () => {
    const ids = await seed(2);
    await Promise.all([processTrainingDelivery(runtime, uid, ids[0]), processTrainingDelivery(runtime, uid, ids[1])]);
    expect(client).toHaveBeenCalledTimes(1);
    expect(JSON.parse(client.mock.calls[0][0].data).Workouts).toHaveLength(2);
  });

  it('retains stable workout identities across an authored edit', async () => {
    const [id] = await seed(1);
    await processTrainingDelivery(runtime, uid, id);
    const firstPayload = JSON.parse(client.mock.calls[0][0].data);
    const firstId = firstPayload.Workouts[0].Id;
    const user = db.collection('users').doc(uid);
    await user.collection('scheduledWorkouts').doc('w0').update({ title: 'Edited workout', revision: 2, updatedAtMs: now + 1000 });
    const ledger = (await user.collection(DELIVERY_LEDGER).doc(id).get()).data() as DeliveryLedgerV1;
    await user.collection(DELIVERY_LEDGER).doc(id).update({ acceptedDigest: 'obsolete' });
    await db.collection(DELIVERY_QUEUE).doc(id).set({ uid, kind: 'delivery', deliveryId: id, provider: 'coros',
      destinationKey: 'destination', operationKind: 'upsert', dueAtMs: 0, dispatchToken: randomUUID() });
    await processTrainingDelivery(runtime, uid, id);
    expect(client).toHaveBeenCalledTimes(2);
    expect(JSON.parse(client.mock.calls[1][0].data).Workouts[0]).toMatchObject({ Id: firstId, Title: 'Edited workout' });
    expect((await user.collection(DELIVERY_LEDGER).doc(id).get()).data()).toMatchObject({ status: 'delivered',
      actual: { ids: { workout: String(firstId) } } });
    expect(ledger.actual?.ids.workout).toBe(String(firstId));
  });

  it('allocates the next stable candidate when a partner integer is already claimed', async () => {
    const [id] = await seed(1);
    const bindingDigest = createHash('sha256')
      .update(JSON.stringify(['coros-workout', 'destination', 'w0'])).digest('hex');
    let collided = 0;
    for (let probe = 0; probe < 32; probe++) {
      const candidate = corosIntegerCandidate('workout', bindingDigest, probe);
      if (!(await db.collection(COROS_INTEGER_CLAIMS).doc(String(candidate)).get()).exists) {
        collided = candidate; break;
      }
    }
    expect(collided).toBeGreaterThan(0);
    const blocker = db.collection(COROS_INTEGER_CLAIMS).doc(String(collided));
    await blocker.set({ schemaVersion: 1, provider: 'coros', kind: 'workout', uid: 'another-user',
      bindingDigest: 'b'.repeat(64), integerId: collided });
    try {
      await processTrainingDelivery(runtime, uid, id);
      const deliveredId = JSON.parse(client.mock.calls[0][0].data).Workouts[0].Id;
      expect(deliveredId).not.toBe(collided);
      expect((await db.collection(COROS_INTEGER_CLAIMS).doc(String(deliveredId)).get()).data())
        .toMatchObject({ uid, kind: 'workout', bindingDigest, integerId: deliveredId });
    } finally { await blocker.delete(); }
  });

  it('recovers its own retained partner claim when the user mapping is missing', async () => {
    const [id] = await seed(1);
    const bindingDigest = createHash('sha256')
      .update(JSON.stringify(['coros-workout', 'destination', 'w0'])).digest('hex');
    let retained = 0;
    for (let probe = 0; probe < 32; probe++) {
      const candidate = corosIntegerCandidate('workout', bindingDigest, probe);
      if (!(await db.collection(COROS_INTEGER_CLAIMS).doc(String(candidate)).get()).exists) {
        retained = candidate; break;
      }
    }
    expect(retained).toBeGreaterThan(0);
    await db.collection(COROS_INTEGER_CLAIMS).doc(String(retained)).set({
      schemaVersion: 1, provider: 'coros', kind: 'workout', uid, bindingDigest, integerId: retained,
    });
    await processTrainingDelivery(runtime, uid, id);
    expect(JSON.parse(client.mock.calls[0][0].data).Workouts[0].Id).toBe(retained);
    const mappings = await db.collection('users').doc(uid).collection('trainingDeliveryState').doc('current')
      .collection('corosIntegerIdentities').where('bindingDigest', '==', bindingDigest).get();
    expect(mappings.size).toBe(1);
    expect(mappings.docs[0].data()).toMatchObject({ integerId: retained, workoutId: 'w0' });
  });

  it('recovers an expired prepared attempt that provably never started a request', async () => {
    const [id] = await seed(1);
    const user = db.collection('users').doc(uid);
    const ledger = (await user.collection(DELIVERY_LEDGER).doc(id).get()).data() as DeliveryLedgerV1;
    const attempt = { id: 'prepared-operation', batchId: 'abandoned-batch', kind: 'upsert' as const,
      deliveryId: id, generation: ledger.desiredGeneration, connectionGeneration: 'connection',
      destinationKey: 'destination', timeZone: ledger.timeZone, digest: ledger.desiredDigest,
      contentDigest: ledger.contentDigest, workout: workout(0), artifact: null, progress: null };
    await user.collection(DELIVERY_LEDGER).doc(id).update({ attempt,
      lease: { id: 'expired-lease', expiresAtMs: now - 1 } });
    await user.collection(DELIVERY_LEDGER).doc(id).collection('attempts').doc(attempt.id)
      .set({ schemaVersion: 1, operation: attempt, state: 'prepared', startedAtMs: now - 1000 });
    await processTrainingDelivery(runtime, uid, id);
    expect(client).toHaveBeenCalledTimes(1);
    expect((await user.collection(DELIVERY_LEDGER).doc(id).get()).data()).toMatchObject({ status: 'delivered', attempt: null });
    expect((await user.collection(DELIVERY_LEDGER).doc(id).collection('attempts').doc(attempt.id).get()).data())
      .toMatchObject({ state: 'superseded', reason: 'request_not_started' });
  });

  it('stops uncertain batches in needs_attention without blindly resending', async () => {
    client.mockImplementationOnce(async (_request, beforeSend) => { await beforeSend(); throw new Error('lost response'); });
    const [id] = await seed(1);
    await processTrainingDelivery(runtime, uid, id);
    expect((await db.collection('users').doc(uid).collection(DELIVERY_LEDGER).doc(id).get()).data())
      .toMatchObject({ status: 'needs_attention', attempt: { progress: { state: 'started' } } });
    await processTrainingDelivery(runtime, uid, id);
    expect(client).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['30009', 'provider_unavailable', 'not enabled', false],
    ['5006', 'reconnect_required', 'Reconnect COROS', true],
  ] as const)('projects COROS result %s as %s', async (result, status, issue, blocksConnection) => {
    client.mockImplementationOnce(async (_request, beforeSend) => {
      await beforeSend();
      return { status: 200, body: { result, message: 'redacted' } };
    });
    const [id] = await seed(1);
    await processTrainingDelivery(runtime, uid, id);
    const ledger = (await db.collection('users').doc(uid).collection(DELIVERY_LEDGER).doc(id).get()).data();
    expect(ledger).toMatchObject({ status, issues: [expect.stringContaining(issue)] });
    expect(ledger?.blockedConnectionGeneration !== null).toBe(blocksConnection);
  });

  it('retires a batch safely when Stop sync wins before transport', async () => {
    const [id] = await seed(1);
    const base = transport;
    const racing: TrainingDeliveryTransport = {
      mappingVersion: base.mappingVersion,
      horizonDays: base.horizonDays,
      assess: base.assess.bind(base),
      canRemove: base.canRemove.bind(base),
      execute: base.execute.bind(base),
      recover: base.recover.bind(base),
      batch: { maxSize: 30, execute: async (_operations, beforeSend, guard) => {
        await beforeSend();
        await db.collection('users').doc(uid).collection('trainingDeliverySettings').doc('workout_w0_coros')
          .update({ enabled: false, revision: 2, updatedAtMs: now + 1 });
        await guard(true);
        throw new Error('unreachable');
      }, reserveIdentities: reserveCorosIntegerIdentities },
    };
    runtime.transport = provider => provider === 'coros' ? racing : null;
    await processTrainingDelivery(runtime, uid, id);
    expect((await db.collection('users').doc(uid).collection(DELIVERY_LEDGER).doc(id).get()).data())
      .toMatchObject({ status: 'pending', attempt: null, lease: null, issues: [] });
    expect((await db.collection('users').doc(uid).collection('trainingDeliveryState').doc('current')
      .collection('batches').get()).docs[0].data()).toMatchObject({ state: 'superseded' });
  });

  it('retains a late accepted removal even after lease ownership changes', async () => {
    const [id] = await seed(1);
    await processTrainingDelivery(runtime, uid, id);
    const user = db.collection('users').doc(uid);
    await user.collection('trainingDeliverySettings').doc('workout_w0_coros')
      .update({ enabled: false, revision: 2, updatedAtMs: now + 1 });
    await db.collection(DELIVERY_QUEUE).doc(id).set({ uid, kind: 'delivery', deliveryId: id, provider: 'coros',
      destinationKey: 'destination', operationKind: 'remove', dueAtMs: 0, dispatchToken: randomUUID() });
    const base = transport;
    const racing: TrainingDeliveryTransport = {
      mappingVersion: base.mappingVersion,
      horizonDays: base.horizonDays,
      assess: base.assess.bind(base),
      canRemove: base.canRemove.bind(base),
      execute: base.execute.bind(base),
      recover: base.recover.bind(base),
      batch: { maxSize: 30, execute: async (operations, beforeSend) => {
        await beforeSend();
        await user.collection(DELIVERY_LEDGER).doc(id).update({ 'lease.id': 'replacement-lease' });
        return operations.map(operation => ({ operationId: operation.id, state: 'accepted' as const, artifact: null }));
      }, reserveIdentities: reserveCorosIntegerIdentities },
    };
    runtime.transport = provider => provider === 'coros' ? racing : null;
    await processTrainingDelivery(runtime, uid, id);
    expect((await user.collection(DELIVERY_LEDGER).doc(id).get()).data())
      .toMatchObject({ status: 'needs_attention', actual: null });
  });

  it('does not let an older late response regress a newer operation artifact', async () => {
    const [id] = await seed(1);
    const user = db.collection('users').doc(uid);
    const base = transport;
    const racing: TrainingDeliveryTransport = {
      mappingVersion: base.mappingVersion,
      horizonDays: base.horizonDays,
      assess: base.assess.bind(base),
      canRemove: base.canRemove.bind(base),
      execute: base.execute.bind(base),
      recover: base.recover.bind(base),
      batch: { maxSize: 30, execute: async (operations, beforeSend) => {
        await beforeSend();
        const newerArtifact = { ids: { workout: '987654', athlete: '55' }, localDate: '2026-09-19', completed: false };
        await user.collection(DELIVERY_LEDGER).doc(id).update({
          attempt: { ...operations[0], id: 'newer-operation', artifact: newerArtifact },
          lease: { id: 'newer-lease', expiresAtMs: now + 60_000 },
          actual: newerArtifact,
          acceptedDigest: 'newer-digest',
        });
        return operations.map(operation => ({ operationId: operation.id, state: 'accepted' as const,
          artifact: { ids: { workout: String(operation.providerIdentity!.workoutId), athlete: '55' },
            localDate: operation.workout!.localDate, completed: false } }));
      }, reserveIdentities: reserveCorosIntegerIdentities },
    };
    runtime.transport = provider => provider === 'coros' ? racing : null;
    await processTrainingDelivery(runtime, uid, id);
    expect((await user.collection(DELIVERY_LEDGER).doc(id).get()).data()).toMatchObject({
      status: 'needs_attention',
      actual: { ids: { workout: '987654' } },
      acceptedDigest: 'newer-digest',
      attempt: { id: 'newer-operation' },
    });
    expect((await db.collection(DELIVERY_QUEUE).doc(id).get()).exists).toBe(false);
  });
});
