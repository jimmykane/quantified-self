import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectStrengthWorkoutToV1, type StrengthWorkoutDraftV1 } from '../../../../../shared/strength-workout';
import type { TrainingDeliveryCommandV1 } from '../../../../../shared/training-provider-delivery';
import { mutateTrainingScheduleForUser } from '../../persistence';
import { trainingDeliveryCommand } from '../commands';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, type DeliveryLedgerV1, type DeliveryOperation, type DeliveryRuntime } from '../contracts';
import { DELIVERY_SERVICES, productionDeliveryRuntime } from '../runtime';
import { stageTrainingDeliveryReconciliation } from '../marker';
import { reconcileTrainingDeliveryPage } from '../store';
import { processTrainingDelivery } from '../worker';
import { COROS_INTEGER_CLAIMS } from './identities';
import { authorizeCorosTrainingRequest } from './authorization';
import { createCorosTrainingClient } from './http';
import { CorosTrainingTransport } from './transport';
import type { CorosTrainingWorkoutV1 } from '../../providers/coros-training-plan.serializer';

// Refresh is replaced with its persisted synthetic result. Authority, HTTP encoding,
// journals, mutations and worker transactions are real; no request can reach COROS.
vi.mock('../../../tokens', () => ({ getTokenData: vi.fn(async snapshot => snapshot.data()) }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('COROS strength / production policy / demo Firestore / synthetic HTTP', { timeout: 30_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-training-delivery' });
  const users: string[] = [];
  const service = DELIVERY_SERVICES.coros;
  let uid: string, now: number, pro: boolean;
  let runtime: DeliveryRuntime;
  let remote: Map<number, CorosTrainingWorkoutV1>;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let beforeRequest: (() => Promise<void>) | null;
  let afterAcceptance: (() => Promise<void>) | null;
  const user = () => db.collection('users').doc(uid);
  const root = () => db.collection(service.tokens).doc(uid);
  const credential = () => root().collection('tokens').doc('account-a');
  const ledger = async () => (await user().collection(DELIVERY_LEDGER).get()).docs[0]?.data() as DeliveryLedgerV1;
  const mark = () => db.runTransaction(async tx => { stageTrainingDeliveryReconciliation(tx, db, uid); });
  const drain = async () => {
    for (let page = 0; page < 20; page++) if (!await reconcileTrainingDeliveryPage(runtime, uid)) return;
    throw new Error('Unbounded fixture scan');
  };
  const draft = (load = 80.25): StrengthWorkoutDraftV1 => ({ version: 1, exercises: [{ id: 'squat', name: 'スクワット 🏋️',
    sets: [{ id: 'set-one', ending: { kind: 'repetitions', repetitions: 5 }, externalLoadKg: load, restAfterSeconds: 60 },
      { id: 'set-two', ending: { kind: 'repetitions', repetitions: 8 }, externalLoadKg: 0 }] },
    { id: 'plank', name: 'Plank', sets: [{ id: 'hold', ending: { kind: 'time', seconds: 30 }, restAfterSeconds: 20 }] }] });
  const mutate = async (operation: Parameters<typeof mutateTrainingScheduleForUser>[1]['operation']) => {
    const [state, workout, plan] = await Promise.all([user().collection('trainingPlanState').doc('current').get(),
      user().collection('scheduledWorkouts').doc('w').get(), user().collection('trainingPlans').doc('p').get()]);
    await mutateTrainingScheduleForUser(uid, { mutationId: randomUUID(), expectedRevisions: [
      { scope: 'state', id: 'current', revision: state.get('revision') },
      { scope: 'workout', id: 'w', revision: workout.exists ? workout.get('revision') : 0 },
      ...(plan.exists ? [{ scope: 'plan' as const, id: 'p', revision: plan.get('revision') }] : []),
    ], operation }, { db, nowMs: now });
  };
  const save = async (load = 80.25, planId: string | null = null) => {
    const exists = (await user().collection('scheduledWorkouts').doc('w').get()).exists;
    const strength = draft(load);
    await mutate({ kind: exists ? 'update-workout' : 'create-workout', workoutId: 'w', planId,
      localDate: '2026-09-20', title: 'Synthetic COROS strength', strength,
      structure: projectStrengthWorkoutToV1({ ...strength, workoutId: 'w', revision: 1 }), confirmPlanRangeExtension: false });
  };
  const command = async (action: TrainingDeliveryCommandV1['action'] = 'send', scope: 'workout' | 'plan' = 'workout') => {
    const scopeId = scope === 'workout' ? 'w' : 'p';
    const [state, document, settings] = await Promise.all([user().collection('trainingPlanState').doc('current').get(),
      user().collection(scope === 'workout' ? 'scheduledWorkouts' : 'trainingPlans').doc(scopeId).get(),
      user().collection('trainingDeliverySettings').doc(`${scope}_${scopeId}_coros`).get()]);
    return trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope, scopeId, provider: 'coros',
      action, timeZone: 'Europe/Helsinki', expectedScheduleRevision: state.get('revision'),
      expectedScopeRevision: document.get('revision'), expectedSettingsRevision: settings.get('revision') ?? 0 }, false);
  };
  const send = async () => { await command(); await drain(); return (await ledger()).id; };

  beforeEach(async () => {
    uid = `coros-strength-${randomUUID()}`; users.push(uid); now = Date.parse('2026-09-17T10:00:00Z'); pro = true;
    remote = new Map(); beforeRequest = null; afterAcceptance = null;
    fetcher = vi.fn(async (_url, init) => {
      const form = new URLSearchParams(String(init!.body));
      expect(form.get('openId')).toBe('account-a'); expect(form.get('token')).toBe('synthetic-only');
      let data: object;
      if (form.has('data')) {
        const payload = JSON.parse(form.get('data')!);
        for (const workout of payload.Workouts) remote.set(workout.Id, workout);
        data = { StartDate: payload.StartDate, EndDate: payload.EndDate };
      } else {
        const ids: number[] = JSON.parse(form.get('workoutIds')!);
        ids.forEach(id => remote.delete(id)); data = { successIdList: ids, failIdList: [] };
      }
      const callback = afterAcceptance; afterAcceptance = null; if (callback) await callback();
      return new Response(JSON.stringify({ result: '0000', data }), { status: 200 });
    });
    const policy = productionDeliveryRuntime(db).transport('coros', uid)!;
    const bind = (operation: Pick<DeliveryOperation, 'destinationKey' | 'connectionGeneration'>) => new CorosTrainingTransport(
      createCorosTrainingClient(async () => {
        const authority = await authorizeCorosTrainingRequest(db, uid, operation);
        const callback = beforeRequest; beforeRequest = null; if (callback) await callback();
        return authority;
      }, fetcher, () => now), () => now);
    runtime = { ...productionDeliveryRuntime(db), now: () => now, hasPro: async () => pro,
      transport: provider => provider !== 'coros' ? null : { ...policy,
        batch: { ...policy.batch!, execute: (operations, beforeSend, guard) => bind(operations[0]).batch.execute(operations, beforeSend, guard) } } };
    await user().set({ fixture: true });
    await user().collection('trainingPlanState').doc('current').set({ schemaVersion: 1, revision: 1, activePlanId: null,
      currentWorkoutCount: 0, updatedAtMs: now });
    await user().collection('meta').doc(service.name).set({ connectionState: 'connected', connectionStateGeneration: 'connection-1', providerUserId: 'account-a' });
    await root().set({ activeOAuthCredentialGeneration: 'credential-1' });
    await credential().set({ serviceName: service.name, openId: 'account-a', tokenCredentialGeneration: 'credential-1',
      accessToken: 'synthetic-only', expiresAt: Date.now() + 86_400_000 });
    await save();
  });
  afterAll(async () => {
    for (const id of users) {
      await db.recursiveDelete(db.collection('users').doc(id)); await db.recursiveDelete(db.collection(service.tokens).doc(id));
      await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      for (const collection of [DELIVERY_QUEUE, COROS_INTEGER_CLAIMS]) {
        const records = await db.collection(collection).where('uid', '==', id).get();
        for (const record of records.docs) await db.recursiveDelete(record.ref);
      }
    }
    await db.terminate();
  }, 120_000);

  it.each(['standalone', 'plan'] as const)('delivers %s with full sets, stable IDs, duplicate dispatch, load-only update, reschedule and Stop', async scope => {
    if (scope === 'plan') {
      await mutate({ kind: 'create-plan', planId: 'p', name: 'Synthetic strength plan', startLocalDate: '2026-09-20',
        endLocalDate: '2026-09-27', activate: true });
      await mutate({ kind: 'move-workout', workoutId: 'w', planId: 'p', localDate: '2026-09-20', confirmPlanRangeExtension: false });
      await command('configure', 'plan');
    } else await command();
    await drain(); const id = (await ledger()).id;
    await Promise.all([processTrainingDelivery(runtime, uid, id), processTrainingDelivery(runtime, uid, id)]);
    expect((await ledger()).status).toBe('delivered'); expect(remote.size).toBe(1); expect(fetcher).toHaveBeenCalledTimes(1);
    const original = (await ledger()).actual!;
    expect(remote.get(Number(original.ids.workout))).toMatchObject({ WorkoutType: 'strength', Structure: [
      { Name: 'スクワット 🏋️', Length: { Unit: 'Reps', Value: 5 }, IntensityTarget: { Unit: 'ValueOfEquipmentWeight', Value: 80.25 }, Rest: { Unit: 'Second', Value: 60 } },
      { IntensityTarget: { Unit: 'ValueOfEquipmentWeight', Value: 0 } }, { Name: 'Plank', Length: { Unit: 'Second', Value: 30 }, Rest: { Unit: 'Second', Value: 20 } },
    ] });
    const before = (await ledger()).desiredDigest;
    await save(82.5, scope === 'plan' ? 'p' : null); await drain(); await processTrainingDelivery(runtime, uid, id);
    expect((await ledger()).desiredDigest).not.toBe(before); expect((await ledger()).actual!.ids).toEqual(original.ids);
    expect(remote.get(Number(original.ids.workout))!.Structure[0]).toMatchObject({ IntensityTarget: { Value: 82.5 } });
    await mutate({ kind: 'move-workout', workoutId: 'w', planId: scope === 'plan' ? 'p' : null, localDate: '2026-09-21', confirmPlanRangeExtension: false });
    await drain(); await processTrainingDelivery(runtime, uid, id);
    expect(remote.get(Number(original.ids.workout))!.WorkoutDay).toBe('2026-09-21'); expect(remote.size).toBe(1);
    if (scope === 'plan') await command('stop', 'plan'); else await command('stop');
    await drain(); pro = false; await processTrainingDelivery(runtime, uid, id); expect(remote.size).toBe(0);
  });

  it.each(['missing', 'foreign', 'mismatch', 'invalid'] as const)('rejects %s companion before consent or HTTP', async failure => {
    const companion = user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current');
    if (failure === 'missing') await db.recursiveDelete(companion);
    if (failure === 'foreign') await companion.update({ workoutId: 'foreign' });
    if (failure === 'mismatch') await companion.update({ exercises: [{ ...draft().exercises[0], name: 'Changed' }] });
    if (failure === 'invalid') await companion.update({ exercises: [{ ...draft().exercises[0], sets: [{ ...draft().exercises[0].sets[0], externalLoadKg: -1 }] }] });
    await expect(command()).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
    expect((await user().collection('trainingDeliverySettings').get()).empty).toBe(true);
  });

  it('keeps local strength compatibility exact when delivery is unavailable without granting consent', async () => {
    runtime.transport = () => null;
    const state = await user().collection('trainingPlanState').doc('current').get();
    const workout = await user().collection('scheduledWorkouts').doc('w').get();
    const request = { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w', provider: 'coros',
      action: 'send', timeZone: 'Europe/Helsinki', expectedScheduleRevision: state.get('revision'),
      expectedScopeRevision: workout.get('revision'), expectedSettingsRevision: 0 };
    await expect(trainingDeliveryCommand(runtime, uid, request, true)).resolves.toMatchObject({
      available: false, workoutCompatibility: 'exact', warningCount: 0, approvalRequiredCount: 0,
    });
    await expect(trainingDeliveryCommand(runtime, uid, request, false)).rejects.toThrow('not yet available');
    expect((await user().collection('trainingDeliverySettings').get()).empty).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['edit', 'stop'] as const)('fences a %s committed after payload construction but before HTTP', async change => {
    const id = await send();
    beforeRequest = async () => { if (change === 'edit') await save(82.5); else await command('stop'); };
    await processTrainingDelivery(runtime, uid, id);
    expect(fetcher).not.toHaveBeenCalled(); expect(remote.size).toBe(0);
    expect((await ledger()).attempt).toBeNull();
    await drain(); await processTrainingDelivery(runtime, uid, id);
    if (change === 'stop') {
      expect(fetcher).not.toHaveBeenCalled();
      expect(await ledger()).toMatchObject({ status: 'removed', desired: 'absent', actual: null, attempt: null });
    } else {
      expect(fetcher).toHaveBeenCalledTimes(1); expect((await ledger()).status).toBe('delivered');
      expect([...remote.values()][0].Structure[0]).toMatchObject({ IntensityTarget: { Value: 82.5 } });
    }
  });

  it.each(['edit', 'stop'] as const)('retains one accepted identity and reconciles a concurrent %s without replaying stale strength', async change => {
    const id = await send();
    afterAcceptance = async () => {
      if (change === 'edit') await save(82.5); else await command('stop');
      await drain();
    };
    await processTrainingDelivery(runtime, uid, id);
    const original = (await ledger()).actual!;
    expect((await ledger()).status).toBe('pending'); expect(remote.size).toBe(1);
    await drain(); await processTrainingDelivery(runtime, uid, id);
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (change === 'stop') {
      expect(remote.size).toBe(0); expect((await ledger()).status).toBe('removed');
    } else {
      expect(remote.size).toBe(1); expect((await ledger()).status).toBe('delivered');
      expect((await ledger()).actual!.ids).toEqual(original.ids);
      expect(remote.get(Number(original.ids.workout))!.Structure[0]).toMatchObject({ IntensityTarget: { Value: 82.5 } });
    }
  });

  it('removes a future retained strength copy after permanent local deletion without recreating the companion', async () => {
    const id = await send(); await processTrainingDelivery(runtime, uid, id);
    const original = (await ledger()).actual!;
    await mutate({ kind: 'delete-workout', workoutId: 'w' });
    await mutate({ kind: 'permanently-delete-workout', workoutId: 'w', confirmPermanentDeletion: true });
    const workout = user().collection('scheduledWorkouts').doc('w');
    expect((await workout.get()).exists).toBe(false);
    expect((await workout.collection('strengthDetails').get()).empty).toBe(true);
    await drain(); pro = false; await processTrainingDelivery(runtime, uid, id);
    expect(remote.size).toBe(0); expect((await ledger()).status).toBe('removed');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const deletion = new URLSearchParams(String(fetcher.mock.calls[1][1]!.body));
    expect(JSON.parse(deletion.get('workoutIds')!)).toEqual([Number(original.ids.workout)]);
    expect((await workout.get()).exists).toBe(false);
    expect((await workout.collection('strengthDetails').get()).empty).toBe(true);
  });

  it('retains uncertain accepted strength without blindly repeating the push, even after Retry', async () => {
    const id = await send(); afterAcceptance = async () => { throw new Error('synthetic lost response'); };
    await processTrainingDelivery(runtime, uid, id); expect(remote.size).toBe(1);
    expect((await ledger()).status).toBe('needs_attention'); await command('retry'); await drain();
    await processTrainingDelivery(runtime, uid, id); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries known rejections after same-account reconnect without duplicating identity', async () => {
    const id = await send(); fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ result: '5006', message: 'synthetic rejection' }), { status: 200 }));
    await processTrainingDelivery(runtime, uid, id); expect((await ledger()).status).toBe('reconnect_required');
    await user().collection('meta').doc(service.name).update({ connectionStateGeneration: 'connection-2' });
    await root().update({ activeOAuthCredentialGeneration: 'credential-2' }); await credential().update({ tokenCredentialGeneration: 'credential-2' });
    await mark(); await drain(); now = Math.max(now, (await ledger()).retryAtMs + 1);
    await processTrainingDelivery(runtime, uid, id); expect((await ledger()).status).toBe('delivered'); expect(remote.size).toBe(1);
  });

  it('does not reuse consent on another account or another owner', async () => {
    const id = await send(); await processTrainingDelivery(runtime, 'foreign-owner', id); expect(fetcher).not.toHaveBeenCalled();
    await user().collection('meta').doc(service.name).update({ providerUserId: 'account-b' });
    await root().collection('tokens').doc('account-b').set({ ...(await credential().get()).data(), openId: 'account-b' });
    await mark(); await drain(); await processTrainingDelivery(runtime, uid, id); expect(fetcher).not.toHaveBeenCalled();
  });

  it('fences local recreation when account deletion wins during provider acceptance', async () => {
    const id = await send(); afterAcceptance = async () => {
      await db.collection('userDeletionTombstones').doc(uid).set({ expireAt: new Date(now + 86_400_000) });
      await db.recursiveDelete(user());
    };
    await processTrainingDelivery(runtime, uid, id); expect(fetcher).toHaveBeenCalledTimes(1); expect(remote.size).toBe(1);
    expect((await user().get()).exists).toBe(false); expect((await user().collection(DELIVERY_LEDGER).get()).empty).toBe(true);
    await processTrainingDelivery(runtime, uid, id); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
