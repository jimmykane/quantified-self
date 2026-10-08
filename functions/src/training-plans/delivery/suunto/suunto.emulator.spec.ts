import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataWeight, ServiceNames, WeightUnits } from '@sports-alliance/sports-lib';
import { trainingDeliveryCommand } from '../commands';
import { reconcileTrainingDeliveryPage } from '../store';
import { processTrainingDelivery } from '../worker';
import { processTrainingVerification } from '../verification-worker';
import { stageTrainingDeliveryReconciliation } from '../marker';
import { readTrainingDeliveryAuthority } from '../connection';
import { productionDeliveryRuntime } from '../runtime';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, type DeliveryLedgerV1, type DeliveryRuntime, type DeliveryOperation } from '../contracts';
import { SuuntoGuideTransport } from './transport';
import { createSuuntoGuideClient, SuuntoGuideHttpError } from './http';
import { SuuntoHttpFixture } from '../test-support/suunto-http-fixture';
import { buildSuuntoHealthWebhookAccountBinding, getSuuntoHealthWebhookAccountBindingRef } from '../../../suunto/health-webhook-binding';
import { readSuuntoGuideCompletions, retainSuuntoGuideCompletions } from '../../../suunto/guide-completion';
import { suuntoFitFixture, suuntoMultiSessionFitFixture } from '../test-support/suunto-fit-fixture';
import { guideExternalId, assessSuuntoGuideV2ForRecovery, assessSuuntoGuideV3ForRecovery, assessSuuntoGuideV4ForRecovery, assessSuuntoGuideV5ForRecovery, assessSuuntoGuideV6ForRecovery, assessSuuntoGuideV7ForRecovery, assessSuuntoGuideV9ForRecovery, assessSuuntoGuideV10ForRecovery, assessSuuntoGuideV11ForRecovery, guidePayloadForRecovery } from './mapping';
import { deliveryIdentity } from '../intent';
import { retainGarminFITWorkoutReferences } from '../../completion/fit-workout-evidence';
import { standardWorkoutReferenceFitFixture } from '../test-support/suunto-fit-fixture';
import type { TrainingDeliveryCommandV1 } from '../../../../../shared/training-provider-delivery';
import { TRAINING_DELIVERY_VERIFICATIONS } from '../../../../../shared/training-provider-verification';
import { projectStrengthWorkoutToV1 } from '../../../../../shared/strength-workout';
import { parseScheduledWorkoutV1 } from '../../../../../shared/training-plans';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Suunto worker with real Firestore, synthetic provider only', { timeout: 30_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback required');
  const db = new Firestore({ projectId: 'demo-training-suunto' }); const users: string[] = [];
  let uid: string; let runtime: DeliveryRuntime; let server: SuuntoHttpFixture; let now: number; let pro: boolean;
  const user = () => db.collection('users').doc(uid);
  const ledger = async () => (await user().collection(DELIVERY_LEDGER).get()).docs[0].data() as DeliveryLedgerV1;
  const drain = async () => { for (let i = 0; i < 100; i++) if (!await reconcileTrainingDeliveryPage(runtime, uid)) return; throw new Error('scan'); };
  const mark = async () => { await db.runTransaction(async tx => stageTrainingDeliveryReconciliation(tx, db, uid)); await drain(); };
  const command = async (action: TrainingDeliveryCommandV1['action']) => {
    const setting = await user().collection('trainingDeliverySettings').doc('workout_w_suunto').get();
    const scope = await user().collection('scheduledWorkouts').doc('w').get();
    return trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w',
      provider: 'suunto', action, expectedScheduleRevision: 1, expectedScopeRevision: scope.get('revision'), expectedSettingsRevision: setting.data()?.revision ?? 0,
      ...(action === 'send' ? { timeZone: 'Europe/Helsinki' } : {}) }, false);
  };
  const send = async () => { await command('send'); await drain(); const row = await ledger(); await processTrainingDelivery(runtime, uid, row.id); await drain(); return ledger(); };
  const currentRecipes = [
    { sport: ActivityTypes.Running, manual: false, version: 'v7' },
    { sport: ActivityTypes.Running, manual: true, version: 'v12' },
    { sport: ActivityTypes.Walking, manual: true, version: 'v12' },
    { sport: ActivityTypes.Cycling, manual: true, version: 'v12' },
    { sport: ActivityTypes.Swimming, manual: true, version: 'v12' },
    { sport: ActivityTypes.OpenWaterSwimming, manual: true, version: 'v12' },
    { sport: ActivityTypes.Rowing, manual: true, version: 'v11' },
  ] as const;
  const useManualRecipe = async (sport: ActivityTypes) => user().collection('scheduledWorkouts').doc('w').update({
    structure: { version: 1, sport, nodes: [{ kind: 'repeat', id: 'sets', count: 3, steps: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
    ] }] },
  });
  // Simulate a journal and provider archive written by the previous deployed
  // serializer. The fixture, Firestore and all provider HTTP remain local/demo.
  const startedLegacy = async (version: 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v9' | 'v10' | 'v11' = 'v2') => {
    const row = await ledger(); const operation = row.attempt!;
    operation.digest = (version === 'v2' ? assessSuuntoGuideV2ForRecovery : version === 'v3' ? assessSuuntoGuideV3ForRecovery
      : version === 'v4' ? assessSuuntoGuideV4ForRecovery : version === 'v5' ? assessSuuntoGuideV5ForRecovery
        : version === 'v6' ? assessSuuntoGuideV6ForRecovery : version === 'v9' ? assessSuuntoGuideV9ForRecovery
          : version === 'v10' ? assessSuuntoGuideV10ForRecovery : version === 'v11' ? assessSuuntoGuideV11ForRecovery : assessSuuntoGuideV7ForRecovery)(operation.workout!, operation.destinationKey,
      operation.timeZone, 'Quantified Self', operation.strength).digest;
    const payload = guidePayloadForRecovery(operation, 'Quantified Self')!;
    const [id, remote] = [...server.guides.entries()][0];
    server.guides.set(id, { ...remote, guide: payload });
    const ref = user().collection(DELIVERY_LEDGER).doc(row.id);
    await ref.update({ attempt: operation });
    await ref.collection('attempts').doc(operation.id).update({ operation });
    return { row, operation, id, payload };
  };
  // Exercise production policy binding while ensuring all provider I/O stays synthetic.
  const useProductionPolicy = () => {
    vi.stubEnv('SUUNTOAPP_GUIDE_OWNER', 'Quantified Self');
    const policy = productionDeliveryRuntime(db).transport('suunto', uid)!;
    const synthetic = runtime.transport('suunto', uid)!;
    const transport = { ...policy, inspection: synthetic.inspection,
      execute: synthetic.execute.bind(synthetic), recover: synthetic.recover.bind(synthetic) };
    runtime.transport = provider => provider === 'suunto' ? transport : null;
    return transport;
  };
  beforeEach(async () => {
    vi.mocked(logger.info).mockClear(); vi.mocked(logger.warn).mockClear();
    uid = `suunto-test-${randomUUID()}`; users.push(uid); now = Date.parse('2026-09-16T10:00:00Z'); pro = true;
    server = new SuuntoHttpFixture(); const transport = new SuuntoGuideTransport(server.request, 'Quantified Self', () => now);
    runtime = { db, now: () => now, hasPro: async () => pro, transport: provider => provider === 'suunto' ? transport : null,
      connection: async (tx, id, provider) => provider === 'suunto' ? (await readTrainingDeliveryAuthority(db, tx, id, provider)).connection
        : { state: 'reconnect_required', destinationKey: '', generation: '', epoch: 0 } };
    await user().set({ test: true });
    await user().collection('meta').doc(ServiceNames.SuuntoApp).set({ connectionState: 'connected', connectionStateGeneration: 'connection' });
    const root = db.collection('suuntoAppAccessTokens').doc(uid); await root.set({ activeOAuthCredentialGeneration: 'root-newer' });
    await root.collection('tokens').doc('account').set({ userName: 'account', serviceName: ServiceNames.SuuntoApp, tokenCredentialGeneration: 'retained' });
    await getSuuntoHealthWebhookAccountBindingRef(db, 'account', uid).set(buildSuuntoHealthWebhookAccountBinding(uid, 'account', 'retained', 'oauth_callback'));
    await user().collection('trainingPlanState').doc('current').set({ schemaVersion: 1, revision: 1, activePlanId: null, currentWorkoutCount: 1, updatedAtMs: now });
    await user().collection('scheduledWorkouts').doc('w').set({ schemaVersion: 1, id: 'w', planId: null, title: 'Run', localDate: '2026-09-17',
      revision: 1, lifecycle: 'planned', createdAtMs: now, updatedAtMs: now, structure: { version: 1, sport: ActivityTypes.Running,
        nodes: [{ kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  afterAll(async () => {
    for (const id of users) {
      await db.recursiveDelete(db.collection('users').doc(id)); await db.recursiveDelete(db.collection('suuntoAppAccessTokens').doc(id));
      await db.recursiveDelete(db.collection('garminAPITokens').doc(id));
      await db.recursiveDelete(getSuuntoHealthWebhookAccountBindingRef(db, 'account', id));
      await db.recursiveDelete(getSuuntoHealthWebhookAccountBindingRef(db, 'other-account', id));
      await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      for (const doc of (await db.collection(DELIVERY_QUEUE).where('uid', '==', id).get()).docs) await db.recursiveDelete(doc.ref);
    }
    await db.terminate();
  });
  it('delivers once under concurrent workers while keeping visibility checks unavailable', async () => {
    await command('send'); await drain(); const row = await ledger();
    await Promise.all([processTrainingDelivery(runtime, uid, row.id), processTrainingDelivery(runtime, uid, row.id)]);
    await drain(); expect(server.guides.size).toBe(1);
    expect([...server.guides.values()][0].guide.steps[0]).toMatchObject({ notification: { title: 'Work', text: 'For 10m 00s' } });
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'accepted', provider: 'suunto', guideMappingVersion: 'suunto-guides-v7', deliveryPhase: 'execute',
    }));
    expect(await ledger()).toMatchObject({ status: 'delivered', verification: { state: 'unsupported', missing: false } });
    expect((await user().collection(TRAINING_DELIVERY_VERIFICATIONS).doc(row.id).get()).data())
      .toMatchObject({ state: 'unsupported', canCheck: false, missing: false });
    await expect(command('check')).rejects.toMatchObject({ code: 'failed-precondition' });
    const guideReads = server.calls.filter(call => call.method === 'GET').length;
    await db.collection(DELIVERY_QUEUE).doc(row.id).set({ uid, deliveryId: row.id, kind: 'verification', dueAtMs: 0 });
    await processTrainingVerification(runtime, uid, row.id);
    expect((await db.collection(DELIVERY_QUEUE).doc(row.id).get()).exists).toBe(false);
    expect(server.calls.filter(call => call.method === 'GET')).toHaveLength(guideReads);
  });
  it('does not fail delivery when diagnostic classification fails', async () => {
    const transport = runtime.transport('suunto')!;
    const classify = vi.spyOn(transport, 'diagnosticMappingVersion').mockImplementation(() => { throw new Error('private-diagnostic-error'); });
    const row = await send();
    expect(row.status).toBe('delivered'); expect(server.guides.size).toBe(1);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'accepted', guideMappingVersion: 'unknown', deliveryPhase: 'execute',
    }));
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('private');
    expect(logger.warn).not.toHaveBeenCalled();
  });
  it.each([
    [ActivityTypes.Swimming, 21],
    [ActivityTypes.OpenWaterSwimming, 85],
    [ActivityTypes.Walking, 0],
    [ActivityTypes.Hiking, 11],
    [ActivityTypes.Rowing, 15],
    [ActivityTypes.IndoorRowing, 57],
  ] as const)('delivers %s with its distinct Suunto Guide activity', async (sport, activityId) => {
    await user().collection('scheduledWorkouts').doc('w').update({
      title: `${sport} QA`,
      structure: { version: 1, sport, nodes: [{
        kind: 'step', id: 'swim-distance', purpose: 'work',
        ending: { kind: 'distance', meters: sport === ActivityTypes.Swimming ? 25 : 500 },
        targets: [],
      }] },
    });
    expect((await send()).status).toBe('delivered');
    expect([...server.guides.values()][0].guide.activities).toEqual([activityId]);
  });
  it('sends a Gym Guide with normal consent and updates load, reps and date without extra approval', async () => {
    useProductionPolicy();
    const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat', name: 'Back squat', sets: [
      { id: 'set-one', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 },
    ] }] };
    await user().collection('scheduledWorkouts').doc('w').update({ title: 'Strength QA',
      structure: projectStrengthWorkoutToV1(details) });
    await user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current').set(details);
    const preview = await trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(),
      scope: 'workout', scopeId: 'w', provider: 'suunto', action: 'send', expectedScheduleRevision: 1,
      expectedScopeRevision: 1, expectedSettingsRevision: 0, timeZone: 'Europe/Helsinki' }, true);
    expect(preview).toMatchObject({ warningCount: 1, approvalRequiredCount: 0, approvalDigest: null,
      workoutCompatibility: 'degraded' });
    expect((await user().collection('trainingDeliverySettings').get()).empty).toBe(true);
    expect(server.calls).toHaveLength(0);
    await command('send'); await drain();
    expect((await ledger()).status).toBe('pending');
    expect((await ledger()).approvalDigest).toBeNull();
    const row = await ledger();
    await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    const originalExternalId = (await ledger()).actual!.ids.externalId;
    expect(server.guides.size).toBe(1);
    expect([...server.guides.values()][0].guide.activities).toEqual([23]);
    expect(JSON.stringify([...server.guides.values()][0].guide.steps)).toContain('80.0 kg');
    expect([...server.guides.values()][0].guide.steps[1]).toMatchObject({ notification: { title: 'Rest', text: 'Rest for 02m 00s' } });
    const revised = { ...details, revision: 2, exercises: [{ ...details.exercises[0], sets: [
      { ...details.exercises[0].sets[0], externalLoadKg: 85 },
    ] }] };
    const batch = db.batch();
    batch.update(user().collection('scheduledWorkouts').doc('w'), { revision: 2, updatedAtMs: now + 1,
      localDate: '2026-09-18' });
    batch.set(user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current'), revised);
    await batch.commit(); await mark();
    expect((await ledger()).status).toBe('pending');
    expect(JSON.stringify([...server.guides.values()][0].guide.steps)).toContain('80.0 kg');
    await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(server.guides.size).toBe(1);
    expect(JSON.stringify([...server.guides.values()][0].guide.steps)).toContain('85.0 kg');
    expect([...server.guides.values()][0].guide.localDate).toBe('2026-09-18');
    const changedReps = { ...revised, revision: 3, exercises: [{ ...revised.exercises[0], sets: [
      { ...revised.exercises[0].sets[0], ending: { kind: 'repetitions' as const, repetitions: 6 } },
    ] }] };
    const repBatch = db.batch();
    repBatch.update(user().collection('scheduledWorkouts').doc('w'), { revision: 3,
      structure: projectStrengthWorkoutToV1(changedReps), updatedAtMs: now + 2 });
    repBatch.set(user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current'), changedReps);
    await repBatch.commit(); await mark();
    expect((await ledger()).status).toBe('pending');
    await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect((await ledger()).actual!.ids.externalId).toBe(originalExternalId);
    expect(JSON.stringify([...server.guides.values()][0].guide.steps)).toContain('6 reps');
    expect((await user().collection('trainingDeliverySettings').doc('workout_w_suunto').get()).get('approvedDigest')).toBeNull();
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });
  it.each(['unsupported', 'approval_required'])('reassesses a previously %s strength plan using existing sync consent', async status => {
    const transport = useProductionPolicy();
    const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat', name: 'Back squat', sets: [
      { id: 'set-one', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 },
    ] }] };
    await user().collection('scheduledWorkouts').doc('w').update({ planId: 'p', title: 'Strength QA',
      structure: projectStrengthWorkoutToV1(details) });
    await user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current').set(details);
    await user().collection('trainingPlans').doc('p').set({ id: 'p', lifecycle: 'active', revision: 1 });
    await user().collection('trainingPlanState').doc('current').update({ activePlanId: 'p' });
    const assess = transport.assess.bind(transport);
    const legacy = vi.spyOn(transport, 'assess').mockImplementation((workout, destination, zone, strength) =>
      status === 'unsupported' ? assess(workout, destination, zone)
        : { ...assess(workout, destination, zone, strength), requiresApproval: true });
    await trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'plan', scopeId: 'p',
      provider: 'suunto', action: 'configure', expectedScheduleRevision: 1, expectedScopeRevision: 1,
      expectedSettingsRevision: 0, timeZone: 'Europe/Helsinki' }, false);
    await drain();
    const blocked = await ledger();
    expect(blocked).toMatchObject({ status, actual: null, attempt: null });
    const planSettings = user().collection('trainingDeliverySettings').doc('plan_p_suunto');
    const consent = (await planSettings.get()).data();
    legacy.mockRestore();
    await mark();
    const reviewed = await ledger();
    expect(reviewed).toMatchObject({ id: blocked.id, status: 'pending', actual: null, attempt: null, approvalDigest: null });
    expect((await planSettings.get()).data()).toEqual(consent);
    await Promise.all([processTrainingDelivery(runtime, uid, reviewed.id), processTrainingDelivery(runtime, uid, reviewed.id)]);
    await drain();
    expect((await ledger()).status).toBe('delivered');
    expect((await planSettings.get()).data()).toEqual(consent);
    expect((await user().collection('trainingDeliverySettings').doc('workout_w_suunto').get()).exists).toBe(false);
    expect(server.guides.size).toBe(1);
    expect([...server.guides.values()][0].guide.activities).toEqual([23]);
    expect(JSON.stringify([...server.guides.values()][0].guide.steps)).toContain('80.0 kg');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });
  it.each(['standalone', 'plan'] as const)('uses owner weight units for %s strength delivery and unit-only updates', async scope => {
    useProductionPolicy();
    const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat', name: 'Back squat', sets: [
      { id: 'set', ending: { kind: 'repetitions' as const, repetitions: 5 },
        externalLoadKg: DataWeight.fromDisplayValue(100, WeightUnits.Pounds).getValue() },
    ] }] };
    await user().update({ 'settings.unitSettings.weightUnits': WeightUnits.Pounds });
    await user().collection('scheduledWorkouts').doc('w').update({ title: 'Strength',
      structure: projectStrengthWorkoutToV1(details), ...(scope === 'plan' ? { planId: 'p' } : {}) });
    const companion = user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current');
    await companion.set(details);
    if (scope === 'plan') {
      await user().collection('trainingPlans').doc('p').set({ id: 'p', lifecycle: 'active', revision: 1 });
      await user().collection('trainingPlanState').doc('current').update({ activePlanId: 'p' });
    }
    const raw = { schemaVersion: 1, mutationId: randomUUID(), scope: scope === 'plan' ? 'plan' : 'workout',
      scopeId: scope === 'plan' ? 'p' : 'w', provider: 'suunto', action: scope === 'plan' ? 'configure' : 'send',
      expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: 0, timeZone: 'Europe/Helsinki' };
    const preview = await trainingDeliveryCommand(runtime, uid, raw, true);
    expect(preview).toMatchObject({ approvalRequiredCount: 0 });
    expect(server.calls).toHaveLength(0);
    await trainingDeliveryCommand(runtime, uid, raw, false); await drain();
    const queued = await ledger();
    await processTrainingDelivery(runtime, uid, queued.id); await drain();
    const sent = await ledger(); const ids = sent.actual!.ids;
    expect(sent.status).toBe('delivered');
    expect(JSON.stringify(server.guides.get(ids.guide)!.guide)).toContain('100.0 lb');
    const attempts = await user().collection(DELIVERY_LEDGER).doc(sent.id).collection('attempts').get();
    expect(attempts.docs[0].get('operation.suuntoWeightUnits')).toBe(WeightUnits.Pounds);
    expect((await companion.get()).data()).toEqual(details);
    // A units-only settings update is detected by the existing reconciliation scan.
    await user().update({ 'settings.unitSettings.weightUnits': WeightUnits.Kilograms }); await mark();
    const changed = await ledger();
    expect(changed.status).toBe('pending');
    expect(changed.desiredDigest).not.toBe(sent.acceptedDigest);
    await processTrainingDelivery(runtime, uid, changed.id); await drain();
    expect((await ledger()).actual!.ids).toEqual(ids);
    expect(JSON.stringify(server.guides.get(ids.guide)!.guide)).toContain('45.4 kg');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect((await companion.get()).data()).toEqual(details);
    const projection = (await user().collection('trainingDeliveryStatuses').doc(sent.id).get()).data()!;
    expect(projection).not.toHaveProperty('suuntoWeightUnits');
    expect(projection).not.toHaveProperty('attempt');
  });
  it.each([null, 'invalid-unit'])('defaults malformed strength weight preferences (%s) to kg without rewriting settings', async units => {
    const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat', name: 'Back squat', sets: [
      { id: 'set', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80 },
    ] }] };
    await user().update({ 'settings.unitSettings.weightUnits': units });
    await user().collection('scheduledWorkouts').doc('w').update({ structure: projectStrengthWorkoutToV1(details) });
    await user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current').set(details);
    const row = await send();
    expect(row.status).toBe('delivered');
    expect(JSON.stringify([...server.guides.values()][0].guide)).toContain('80.0 kg');
    expect((await user().get()).get('settings.unitSettings.weightUnits')).toBe(units);
    const attempts = await user().collection(DELIVERY_LEDGER).doc(row.id).collection('attempts').get();
    expect(attempts.docs[0].get('operation.suuntoWeightUnits')).toBe(WeightUnits.Kilograms);
  });
  it('suppresses stale strength units when preferences change immediately before the provider write', async () => {
    const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat', name: 'Back squat', sets: [
      { id: 'set', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 45.359237 },
    ] }] };
    await user().update({ 'settings.unitSettings.weightUnits': WeightUnits.Pounds });
    await user().collection('scheduledWorkouts').doc('w').update({ structure: projectStrengthWorkoutToV1(details) });
    await user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current').set(details);
    let changed = false;
    const transport = new SuuntoGuideTransport(async (request, beforeSend) => {
      if (request.method === 'POST' && !changed) {
        changed = true;
        await user().update({ 'settings.unitSettings.weightUnits': WeightUnits.Kilograms });
      }
      return server.request(request, beforeSend);
    }, 'Quantified Self', () => now);
    runtime.transport = provider => provider === 'suunto' ? transport : null;
    await command('send'); await drain(); const queued = await ledger();
    await processTrainingDelivery(runtime, uid, queued.id);
    const stale = await ledger();
    expect(stale.attempt).toMatchObject({ suuntoWeightUnits: WeightUnits.Pounds, progress: { step: 'create', state: 'ready' } });
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(0);
    now = stale.retryAtMs + 1; await mark();
    // Retire the definitely unaccepted old operation before creating a new one.
    await processTrainingDelivery(runtime, uid, queued.id); await drain();
    expect((await ledger()).attempt).toBeNull();
    await processTrainingDelivery(runtime, uid, queued.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(JSON.stringify([...server.guides.values()][0].guide)).toContain('45.4 kg');
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect((await user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current').get()).data()).toEqual(details);
  });
  it.each(['create', 'update'])('recovers a pounds strength %s with its original unit snapshot after owner settings change', async kind => {
    const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat', name: 'Back squat', sets: [
      { id: 'set', ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 45.359237 },
    ] }] };
    await user().update({ 'settings.unitSettings.weightUnits': kind === 'create' ? WeightUnits.Pounds : WeightUnits.Kilograms });
    await user().collection('scheduledWorkouts').doc('w').update({ structure: projectStrengthWorkoutToV1(details) });
    await user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current').set(details);
    await command('send'); await drain();
    const queued = await ledger();
    if (kind === 'update') {
      await processTrainingDelivery(runtime, uid, queued.id); await drain();
      await user().update({ 'settings.unitSettings.weightUnits': WeightUnits.Pounds }); await mark();
    }
    server.afterHandle = async request => {
      if (request.method === (kind === 'create' ? 'POST' : 'PUT')) {
        server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
      }
    };
    await processTrainingDelivery(runtime, uid, queued.id);
    const interrupted = await ledger();
    expect(interrupted.attempt).toMatchObject({ suuntoWeightUnits: WeightUnits.Pounds, progress: { state: 'started' } });
    expect(server.guides.size).toBe(1);
    await user().update({ 'settings.unitSettings.weightUnits': WeightUnits.Kilograms });
    now += 120_000; await mark();
    expect((await ledger()).attempt!.suuntoWeightUnits).toBe(WeightUnits.Pounds);
    await processTrainingDelivery(runtime, uid, queued.id); await drain();
    expect((await ledger()).actual).not.toBeNull();
    await processTrainingDelivery(runtime, uid, queued.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(JSON.stringify([...server.guides.values()][0].guide)).toContain('45.4 kg');
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(kind === 'create' ? 1 : 2);
  });
  it('requires review for strength losses and retains that exact approval across kg/lb updates', async () => {
    useProductionPolicy();
    const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat',
      name: 'Long exercise instructions '.repeat(3), sets: [{ id: 'set-one',
        ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 }] },
      { id: 'short', name: 'Back squat', sets: [{ id: 'short-set',
        ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80 }] }] };
    await user().collection('scheduledWorkouts').doc('w').update({ structure: projectStrengthWorkoutToV1(details) });
    await user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current').set(details);
    await command('send'); await drain();
    const row = await ledger();
    expect(row).toMatchObject({ status: 'approval_required', actual: null });
    expect(row.approvalDigest).toBeTruthy();
    await processTrainingDelivery(runtime, uid, row.id);
    expect(server.calls).toHaveLength(0);
    const setting = await user().collection('trainingDeliverySettings').doc('workout_w_suunto').get();
    await trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w',
      provider: 'suunto', action: 'approve', expectedScheduleRevision: 1, expectedScopeRevision: 1,
      expectedSettingsRevision: setting.get('revision'), approvalDigest: row.approvalDigest }, false);
    await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.guides.size).toBe(1);
    const ids = (await ledger()).actual!.ids;
    for (const units of [WeightUnits.Pounds, WeightUnits.Kilograms, WeightUnits.Pounds]) {
      await user().update({ 'settings.unitSettings.weightUnits': units }); await mark();
      expect((await ledger()).status).toBe('pending');
      await processTrainingDelivery(runtime, uid, row.id); await drain();
      const current = await ledger();
      expect(current).toMatchObject({ status: 'delivered', actual: { ids },
        mappingApprovalProof: { approvedDigest: row.approvalDigest } });
      if (units === WeightUnits.Pounds) {
        expect(current.mappingApprovalProof!.mappingDigest).toBe(current.acceptedDigest);
      } // The original kg digest uses its direct approval, retaining the prior carry proof.
      expect(JSON.stringify(server.guides.get(ids.guide)!.guide)).toContain(units === WeightUnits.Pounds ? '176.4 lb' : '80.0 kg');
    }
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(3);
  });
  it('does not select an account by discarding a malformed retained token', async () => {
    await db.collection('suuntoAppAccessTokens').doc(uid).collection('tokens').doc('second').set({ userName: 'second' });
    await expect(command('send')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(server.calls).toHaveLength(0);
    expect((await user().collection('trainingDeliverySettings').get()).empty).toBe(true);
    await user().collection('meta').doc(ServiceNames.SuuntoApp).update({ providerUserId: 'account' });
    expect((await send()).status).toBe('delivered');
  });
  it('withdraws a moved future Guide outside the window and sends latest content when it enters', async () => {
    const row = await send(); const externalId = row.actual!.ids.externalId;
    await user().collection('scheduledWorkouts').doc('w').update({ localDate: '2026-09-25', title: 'Later' }); await mark();
    expect((await ledger()).desired).toBe('absent'); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(server.guides.size).toBe(0); expect((await ledger()).status).toBe('outside_horizon');
    now = Date.parse('2026-09-19T10:00:00Z'); await mark(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect((await ledger()).actual!.ids.externalId).toBe(externalId); expect([...server.guides.values()][0].guide.name).toBe('Later');
  });
  it('preserves copies on Pro expiry but permits explicit Stop and prevents re-creation', async () => {
    const row = await send(); pro = false;
    await user().collection('scheduledWorkouts').doc('w').update({ title: 'Unsynced edit' }); await mark();
    await processTrainingDelivery(runtime, uid, row.id); expect(server.guides.size).toBe(1); expect((await ledger()).status).toBe('paused_pro');
    await command('stop'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    pro = true; await mark(); await processTrainingDelivery(runtime, uid, row.id);
    expect(server.guides.size).toBe(0);
  });
  it.each(['enabled', 'stopped', 'paused', 'expired'])('reassesses old cosmetic warnings without overriding %s plan consent', async state => {
    const title = 'Sample — interval session';
    await user().collection('scheduledWorkouts').doc('w').update({ title, planId: 'p' });
    await user().collection('trainingPlans').doc('p').set({ id: 'p', lifecycle: 'active', revision: 1 });
    await user().collection('trainingPlanState').doc('current').update({ activePlanId: 'p' });
    const transport = runtime.transport('suunto')!;
    const assess = transport.assess.bind(transport);
    const legacyAssessment = vi.spyOn(transport, 'assess').mockImplementation((workout, destination, zone) => ({
      ...assess(workout, destination, zone), mappingVersion: 'suunto-guides-v1', digest: 'legacy-cosmetic-review',
      level: 'degraded', issues: ['Watch title contains a character outside the minimum character set.'],
    }));
    await trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'plan', scopeId: 'p',
      provider: 'suunto', action: 'configure', expectedScheduleRevision: 1, expectedScopeRevision: 1,
      expectedSettingsRevision: 0, timeZone: 'Europe/Helsinki' }, false);
    await drain(); const blocked = await ledger();
    expect(blocked.status).toBe('approval_required'); expect(server.guides.size).toBe(0);
    const settingsRef = user().collection('trainingDeliverySettings').doc('plan_p_suunto');
    const settings = (await settingsRef.get()).data();
    if (state === 'stopped') await command('stop');
    if (state === 'paused') await user().collection('trainingPlans').doc('p').update({ lifecycle: 'paused' });
    if (state === 'expired') pro = false;
    legacyAssessment.mockRestore();
    await mark();
    if (state === 'stopped' || state === 'paused') {
      expect((await ledger()).desired).toBe('absent');
    }
    await processTrainingDelivery(runtime, uid, blocked.id); await drain();
    const current = await ledger();
    expect(current.id).toBe(blocked.id);
    expect((await settingsRef.get()).data()).toEqual(settings);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).data()?.title).toBe(title);
    if (state === 'enabled') {
      expect(current.status).toBe('delivered'); expect(server.guides.size).toBe(1);
      expect([...server.guides.values()][0].guide.name).toBe('Sample - interval session');
      expect([...server.guides.values()][0].guide.description).toBe(title);
      expect(current.approvalDigest).toBeNull();
    } else {
      expect(current.status).toBe(state === 'expired' ? 'paused_pro' : 'removed');
      expect(server.guides.size).toBe(0);
      expect(server.calls.some(request => request.method === 'POST')).toBe(false);
    }
  });
  it.each(currentRecipes)('recovers $version $sport lost create acceptance on explicit Retry without a duplicate', async ({ sport, manual, version }) => {
    if (manual) await useManualRecipe(sport);
    server.afterHandle = async request => { if (request.method === 'POST') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    const row = await send(); expect(row.status).toBe('retrying');
    expect(row.attempt?.progress).toMatchObject({ step: 'create', state: 'started' });
    const [id, remote] = [...server.guides.entries()][0];
    const prescription = structuredClone(remote.guide);
    if (manual && version === 'v11') expect(remote.guide.steps[0]).toMatchObject({ type: 'repeat', steps: [
      expect.objectContaining({ notification: expect.objectContaining({ text: 'Press Lap to finish this interval.' }) }),
      expect.anything(),
    ] });
    if (version === 'v12') {
      expect(remote.guide.steps[0]).toMatchObject({ type: 'fields', title: 'Work 1/3' });
      expect(remote.guide.steps[1]).toMatchObject({ type: 'fields', title: 'Rest 1/3', fields: [
        { type: 'stepDurationCountdown', title: 'Rest rem', value: 15 },
        { type: 'heartRate', title: 'HR' }, { type: 'text', value: 'Next: Work 2/3' },
        ...([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming].includes(sport)
          ? [{ type: 'distance', title: 'Total', window: 'workout' }] : []),
      ] });
    }
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(await ledger()).toMatchObject({ status: 'delivered', acceptedDigest: row.attempt!.digest,
      attempt: null, actual: { ids: { guide: id } } });
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'recovered_acceptance', guideMappingVersion: `suunto-guides-${version}`, deliveryPhase: 'recover',
    }));
    const consent = (await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data());
    await mark(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(server.guides.size).toBe(1); expect(server.guides.get(id)!.guide).toEqual(prescription);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.some(call => ['PUT', 'DELETE'].includes(call.method))).toBe(false);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('structure')).toEqual(row.attempt!.workout!.structure);
    expect((await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data())).toEqual(consent);
  });
  it.each(currentRecipes)('recovers $version $sport default-enriched edit/reschedule acceptance once and clears retry work without changing consent', async ({ sport, manual, version }) => {
    if (manual) await useManualRecipe(sport);
    const original = await send(); const id = original.actual!.ids.guide;
    server.guides.get(id)!.pinned = true;
    const consent = (await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data());
    await user().collection('scheduledWorkouts').doc('w').update({ title: 'Edited and rescheduled',
      localDate: '2026-09-18', revision: 2, updatedAtMs: now + 1 });
    await mark();
    server.afterHandle = async request => { if (request.method === 'PUT') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    await processTrainingDelivery(runtime, uid, original.id);
    expect(await ledger()).toMatchObject({ status: 'retrying', attempt: { progress: { step: 'update', state: 'started' } } });
    await command('retry'); await drain();
    const retriedConsent = (await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data());
    // Explicit Retry advances the settings revision, never its sending authority.
    expect(retriedConsent).toEqual(consent.map(setting => ({ ...setting, revision: setting.revision + 1 })));
    await Promise.all([processTrainingDelivery(runtime, uid, original.id), processTrainingDelivery(runtime, uid, original.id)]);
    await drain();
    expect(await ledger()).toMatchObject({ status: 'delivered', attempt: null, lease: null,
      actual: { ids: original.actual!.ids, localDate: '2026-09-18' } });
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'recovered_acceptance', guideMappingVersion: `suunto-guides-${version}`, deliveryPhase: 'recover',
    }));
    expect(server.guides.get(id)).toMatchObject({ pinned: true, guide: {
      name: 'Edited and rescheduled', localDate: '2026-09-18' } });
    expect((await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data())).toEqual(retriedConsent);
    const queued = (await db.collection(DELIVERY_QUEUE).where('uid', '==', uid).get()).docs.map(doc => doc.data());
    // Sending is complete; only the existing periodic reconciliation job remains.
    expect(queued).toEqual([expect.objectContaining({ kind: 'reconcile', dueAtMs: now + 30 * 60_000 })]);
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
  });
  it.each([
    { sport: ActivityTypes.Running, version: 'v11' as const },
    { sport: ActivityTypes.Walking, version: 'v11' as const },
    { sport: ActivityTypes.Cycling, version: 'v11' as const },
    { sport: ActivityTypes.Swimming, version: 'v10' as const },
    { sport: ActivityTypes.OpenWaterSwimming, version: 'v10' as const },
  ])('recovers frozen $version $sport acceptance before updating Rest once in place', async ({ sport, version }) => {
    await useManualRecipe(sport);
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send(); expect(original.status).toBe('retrying');
    const legacy = await startedLegacy(version);
    server.guides.get(legacy.id)!.pinned = true;
    const structure = (await user().collection('scheduledWorkouts').doc('w').get()).get('structure');
    await command('retry'); await drain();
    const consent = (await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data());
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).actual?.ids.guide).toBe(legacy.id);
    expect(server.guides.get(legacy.id)!.guide).toEqual(legacy.payload);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'recovered_acceptance', guideMappingVersion: `suunto-guides-${version}`, deliveryPhase: 'recover',
    }));
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect(await ledger()).toMatchObject({ status: 'delivered', actual: { ids: { guide: legacy.id } } });
    expect(server.guides.get(legacy.id)).toMatchObject({ pinned: true, guide: { steps: [
      expect.objectContaining({ title: 'Work 1/3' }),
      expect.objectContaining({ title: 'Rest 1/3' }),
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    ] } });
    await mark(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('structure')).toEqual(structure);
    expect((await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data())).toEqual(consent);
  });
  it.each(['past', 'completed'] as const)('does not republish a %s v12 Rest Guide', async state => {
    await useManualRecipe(ActivityTypes.Walking);
    const original = await send();
    const remote = structuredClone(server.guides.get(original.actual!.ids.guide));
    if (state === 'past') now = Date.parse('2026-09-18T10:00:00Z');
    else await user().collection(DELIVERY_LEDGER).doc(original.id).update({ 'actual.completed': true });
    await user().collection('scheduledWorkouts').doc('w').update({ title: 'Do not resend', revision: 2 });
    for (let pass = 0; pass < 2; pass++) {
      await mark(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    }
    expect(server.guides.get(original.actual!.ids.guide)).toEqual(remote);
    expect(server.calls.filter(call => ['POST', 'PUT', 'DELETE'].includes(call.method))).toHaveLength(1);
  });
  it('upgrades a known v2 Guide in place, preserving pinning, consent, recipe and IDs; unchanged retries do not write', async () => {
    const delivered = await send();
    const workout = parseScheduledWorkoutV1((await user().collection('scheduledWorkouts').doc('w').get()).data());
    const settings = (await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data());
    const digest = assessSuuntoGuideV2ForRecovery(workout, delivered.destinationKey, delivered.timeZone, 'Quantified Self').digest;
    const op = { id: 'legacy', kind: 'upsert' as const, deliveryId: delivered.id, generation: delivered.desiredGeneration,
      connectionGeneration: 'legacy', destinationKey: delivered.destinationKey, timeZone: delivered.timeZone,
      digest, contentDigest: delivered.contentDigest, workout, artifact: delivered.actual };
    const payload = guidePayloadForRecovery(op, 'Quantified Self')!;
    const id = delivered.actual!.ids.guide;
    server.guides.set(id, { guide: payload, pinned: true });
    await user().collection(DELIVERY_LEDGER).doc(delivered.id).update({ desiredDigest: digest, acceptedDigest: digest });
    await mark(); await processTrainingDelivery(runtime, uid, delivered.id); await drain();
    expect((await ledger()).actual!.ids).toEqual(delivered.actual!.ids);
    expect(server.guides.get(id)!.pinned).toBe(true);
    expect(server.guides.get(id)!.guide.steps.at(-1)).toMatchObject({ title: 'Complete', notification: { text: 'Guide complete' } });
    expect(server.guides.get(id)!.guide.steps[0]).toMatchObject({ notification: { title: 'Work', text: 'For 10m 00s' } });
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).data()).toEqual(workout);
    expect((await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data())).toEqual(settings);
    expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, delivered.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.calls.filter(call => ['POST', 'PUT'].includes(call.method))).toHaveLength(2);
  });
  it.each([assessSuuntoGuideV2ForRecovery, assessSuuntoGuideV3ForRecovery, assessSuuntoGuideV4ForRecovery,
    assessSuuntoGuideV5ForRecovery, assessSuuntoGuideV6ForRecovery])(
    'honors exact legacy loss approval through current delivery, but not a newly edited instruction', async assessLegacy => {
    await user().collection('scheduledWorkouts').doc('w').update({ 'structure.nodes': [{
      kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [], note: 'A'.repeat(45),
    }] });
    const transport = runtime.transport('suunto')!;
    const previous = vi.spyOn(transport, 'assess').mockImplementation((workout, destination, zone, strength) =>
      assessLegacy(workout, destination, zone, 'Quantified Self', strength));
    await command('send'); await drain();
    const blocked = await ledger(); expect(blocked.status).toBe('approval_required');
    const setting = user().collection('trainingDeliverySettings').doc('workout_w_suunto');
    await trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w',
      provider: 'suunto', action: 'approve', expectedScheduleRevision: 1, expectedScopeRevision: 1,
      expectedSettingsRevision: (await setting.get()).get('revision'), approvalDigest: blocked.approvalDigest }, false);
    await drain();
    const approved = await ledger();
    const workout = parseScheduledWorkoutV1((await user().collection('scheduledWorkouts').doc('w').get()).data());
    const oldPayload = guidePayloadForRecovery({ id: 'old', kind: 'upsert', deliveryId: approved.id,
      generation: approved.desiredGeneration, connectionGeneration: 'connection', destinationKey: approved.destinationKey,
      timeZone: approved.timeZone, digest: approved.desiredDigest, contentDigest: approved.contentDigest,
      workout, artifact: null }, 'Quantified Self')!;
    const actual = { ids: { guide: 'guide-v2', externalId: oldPayload.externalId, owner: 'Quantified Self' },
      localDate: workout.localDate, completed: false };
    server.guides.set('guide-v2', { guide: oldPayload, pinned: false });
    await user().collection(DELIVERY_LEDGER).doc(approved.id).update({ actual, acceptedDigest: approved.desiredDigest,
      acceptedContentDigest: approved.contentDigest, status: 'delivered' });
    previous.mockRestore(); await mark();
    expect((await ledger()).status).toBe('pending');
    expect((await ledger()).approvalDigest).toBeNull();
    await processTrainingDelivery(runtime, uid, blocked.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect((await setting.get()).get('approvedDigest')).toBe(blocked.approvalDigest);
    await user().collection('scheduledWorkouts').doc('w').update({ 'structure.nodes': [{
      kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [], note: 'A'.repeat(40) + 'BBBBB',
    }] });
    await mark(); await processTrainingDelivery(runtime, uid, blocked.id); await drain();
    expect((await ledger()).status).toBe('approval_required');
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(
      [assessSuuntoGuideV2ForRecovery, assessSuuntoGuideV3ForRecovery].includes(assessLegacy) ? 1 : 0);
  });
  it.each((['v2', 'v3', 'v4'] as const).flatMap(version => ['running', 'cycling', 'swimming', 'strength'].map(sport => [version, sport] as const)))(
    'recovers a %s %s create with a lost ACK then upgrades without another POST', async (version, sport) => {
    if (sport === 'strength') {
      const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat', name: 'Squat', sets: [
        { id: 'one', ending: { kind: 'repetitions' as const, repetitions: 5 }, restAfterSeconds: 30 },
      ] }] };
      await user().collection('scheduledWorkouts').doc('w').update({ structure: projectStrengthWorkoutToV1(details) });
      await user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current').set(details);
    }
    if (sport === 'cycling' || sport === 'swimming') {
      const saved = (await user().collection('scheduledWorkouts').doc('w').get()).data()!;
      await user().collection('scheduledWorkouts').doc('w').update({ structure: { ...saved.structure,
        sport: sport === 'cycling' ? ActivityTypes.Cycling : ActivityTypes.Swimming } });
    }
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send(); expect(original.status).toBe('retrying');
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'failure', guideMappingVersion: sport === 'strength' ? 'suunto-guides-v8' : sport === 'swimming' ? 'suunto-guides-v10' : 'suunto-guides-v7', deliveryPhase: 'execute',
    }));
    const legacy = await startedLegacy(version);
    expect(JSON.stringify(legacy.payload).includes('notification')).toBe(version !== 'v2');
    expect(JSON.stringify(legacy.payload).includes('aggregate')).toBe(version === 'v4' && (sport === 'running' || sport === 'swimming'));
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).actual?.ids.guide).toBe(legacy.id);
    expect((await ledger()).attempt).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'recovered_acceptance', guideMappingVersion: `suunto-guides-${version}`, deliveryPhase: 'recover',
    }));
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    // v3/v4 strength and v4 untargeted running already have the v5 payload.
    // Upgrade those digests without a redundant PUT; changed layouts need one.
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength((version !== 'v2' && sport === 'strength') || (version === 'v4' && sport === 'running') ? 0 : 1);
    expect(server.guides.get(legacy.id)!.guide.steps.at(-1)).toMatchObject({ title: 'Complete' });
    if (sport === 'running') {
      expect(server.guides.get(legacy.id)!.guide.steps[0]).toMatchObject({ notification: { title: 'Work', text: 'For 10m 00s' } });
      expect(server.guides.get(legacy.id)!.guide.steps[0]).toMatchObject({ fields: [
        { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
        { type: 'stepDurationCountdown', value: 600 }, { type: 'heartRate', title: 'HR' },
      ] });
      expect(server.guides.get(legacy.id)!.guide.steps.at(-1)).toMatchObject({ createManualLap: true });
    } else if (sport === 'strength') {
      expect(server.guides.get(legacy.id)!.guide.steps[1]).toMatchObject({ notification: { title: 'Rest', text: 'Rest for 30s' } });
    } else {
      const guide = server.guides.get(legacy.id)!.guide;
      expect(guide.steps[0]).toMatchObject({ fields: sport === 'cycling' ? [
        { type: 'power', title: 'Avg pwr', window: 'manualLap', aggregate: 'average' },
        { type: 'stepDurationCountdown', value: 600 }, { type: 'heartRate' }, { type: 'cadence' }, { type: 'speed' },
      ] : [
        { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
        { type: 'stepDurationCountdown', value: 600 },
        { type: 'strokeRate', title: 'Avg strk', window: 'manualLap', aggregate: 'average' },
        { type: 'swolf', title: 'AvgSWOLF', window: 'manualLap', aggregate: 'average' }, { type: 'heartRate' },
      ] });
      expect(guide.steps.at(-1)).toMatchObject({ createManualLap: true });
    }
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'accepted', guideMappingVersion: sport === 'strength' ? 'suunto-guides-v8' : sport === 'swimming' ? 'suunto-guides-v10' : 'suunto-guides-v7', deliveryPhase: 'execute',
    }));
    const logs = JSON.stringify([...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.warn).mock.calls]);
    for (const value of [uid, legacy.id, legacy.operation.digest, legacy.operation.destinationKey, 'notification', 'Squat']) {
      expect(logs).not.toContain(value);
    }
  });
  it.each((['v2', 'v3', 'v4'] as const).flatMap(version =>
    ['not-started', 'ready-create', 'rejected-create', 'unaccepted-update'].map(state => [version, state] as const)))(
    'retains exact %s loss approval when retiring a %s attempt during upgrade', async (version, state) => {
    await user().collection('scheduledWorkouts').doc('w').update({ 'structure.nodes': [{
      kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [], note: 'A'.repeat(45),
    }] });
    const transport = runtime.transport('suunto')!;
    const previous = vi.spyOn(transport, 'assess').mockImplementation((workout, destination, zone, strength) =>
      (version === 'v2' ? assessSuuntoGuideV2ForRecovery : version === 'v3' ? assessSuuntoGuideV3ForRecovery : assessSuuntoGuideV4ForRecovery)(workout, destination, zone, 'Quantified Self', strength));
    await command('send'); await drain();
    const blocked = await ledger();
    const setting = user().collection('trainingDeliverySettings').doc('workout_w_suunto');
    await trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w',
      provider: 'suunto', action: 'approve', expectedScheduleRevision: 1, expectedScopeRevision: 1,
      expectedSettingsRevision: (await setting.get()).get('revision'), approvalDigest: blocked.approvalDigest }, false);
    await drain();
    const approved = await ledger();
    const operation: DeliveryOperation = { id: 'old-unaccepted', kind: 'upsert', deliveryId: approved.id,
      generation: approved.desiredGeneration, connectionGeneration: 'connection', destinationKey: approved.destinationKey,
      timeZone: approved.timeZone, digest: approved.desiredDigest, contentDigest: approved.contentDigest,
      workout: parseScheduledWorkoutV1((await user().collection('scheduledWorkouts').doc('w').get()).data()),
      artifact: null, progress: null };
    if (state !== 'not-started') operation.progress = { version: 1,
      step: state === 'unaccepted-update' ? 'update' : 'create',
      state: state === 'rejected-create' ? 'rejected' : state === 'unaccepted-update' ? 'started' : 'ready' };
    if (state === 'unaccepted-update') {
      const payload = guidePayloadForRecovery(operation, 'Quantified Self')!;
      // The previous owned copy survives a lost/nonaccepted PUT. Do not mark
      // this newer prescription accepted, but preserve the identity for v5 PUT.
      const prior = structuredClone(payload);
      if (prior.steps[0].type !== 'fields') throw new Error('Expected fields');
      prior.steps[0].fields = prior.steps[0].fields.filter(field => field.type !== 'text');
      server.guides.set('old-copy', { guide: prior, pinned: true });
      operation.artifact = { ids: { guide: 'old-copy', externalId: prior.externalId, owner: 'Quantified Self' },
        localDate: prior.localDate, completed: false };
    }
    const ref = user().collection(DELIVERY_LEDGER).doc(approved.id);
    await ref.update({ attempt: operation, actual: operation.artifact });
    await ref.collection('attempts').doc(operation.id).set({ schemaVersion: 1, operation, state: 'started', startedAtMs: now });
    previous.mockRestore(); await mark();
    expect((await ledger()).status).toBe('pending');
    await processTrainingDelivery(runtime, uid, approved.id); await drain();
    expect((await ledger()).attempt).toBeNull();
    expect((await ledger()).status).toBe('pending');
    expect((await ledger()).acceptedDigest).toBeNull();
    expect((await ledger()).acceptedContentDigest).toBeNull();
    expect(server.calls.every(call => call.method === 'GET')).toBe(true);
    // Temporary Pro expiry must neither send nor erase the exact approval proof.
    const calls = server.calls.length;
    pro = false; await mark(); await processTrainingDelivery(runtime, uid, approved.id);
    expect((await ledger()).status).toBe('paused_pro');
    expect(server.calls).toHaveLength(calls);
    pro = true; await mark();
    await processTrainingDelivery(runtime, uid, approved.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect((await setting.get()).get('approvedDigest')).toBe(blocked.approvalDigest);
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(state === 'unaccepted-update' ? 0 : 1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(state === 'unaccepted-update' ? 1 : 0);
    if (state === 'unaccepted-update') expect(server.guides.get('old-copy')!.pinned).toBe(true);
    const writes = server.calls.filter(call => ['POST', 'PUT'].includes(call.method)).length;
    await user().collection('scheduledWorkouts').doc('w').update({ 'structure.nodes': [{
      kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [], note: 'A'.repeat(40) + 'BBBBB',
    }] });
    await mark(); await processTrainingDelivery(runtime, uid, approved.id); await drain();
    expect((await ledger()).status).toBe('approval_required');
    expect(server.calls.filter(call => ['POST', 'PUT'].includes(call.method))).toHaveLength(writes);
  });
  it.each(['v2', 'v3', 'v4'] as const)('recovers a %s reschedule/update with a lost ACK before applying the new screen layout', async version => {
    const original = await send();
    await user().collection('scheduledWorkouts').doc('w').update({ title: 'Rescheduled', localDate: '2026-09-18', revision: 2 });
    await mark();
    server.afterHandle = async request => { if (request.method === 'PUT') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    await processTrainingDelivery(runtime, uid, original.id);
    const legacy = await startedLegacy(version);
    expect(legacy.operation.progress).toMatchObject({ step: 'update', state: 'started' });
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).actual).toMatchObject({ ids: original.actual!.ids, localDate: '2026-09-18' });
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.guides.get(legacy.id)!.guide).toMatchObject({ name: 'Rescheduled', localDate: '2026-09-18' });
    expect(server.guides.get(legacy.id)!.guide.steps[0]).toMatchObject({ notification: { title: 'Work', text: 'For 10m 00s' } });
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(version === 'v4' ? 1 : 2);
  });
  it.each((['v2', 'v3', 'v4', 'v6', 'v10', 'v11', 'v12'] as const).flatMap(version =>
    ['digest', 'content', 'missing'].map(change => [version, change] as const)))(
    'keeps a %s uncertain create unresolved on %s mismatch, even on Retry', async (version, change) => {
    if (version === 'v6') await user().collection('scheduledWorkouts').doc('w').update({ 'structure.sport': ActivityTypes.Swimming });
    if (version === 'v10') await useManualRecipe(ActivityTypes.Swimming);
    if (version === 'v11' || version === 'v12') await useManualRecipe(ActivityTypes.Running);
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send();
    const id = version === 'v12' ? [...server.guides.keys()][0] : (await startedLegacy(version)).id;
    if (change === 'digest') await user().collection(DELIVERY_LEDGER).doc(original.id).update({ 'attempt.digest': 'unrecognized-version-digest' });
    if (change === 'content') server.guides.get(id)!.guide.name = 'Different prescription';
    if (change === 'missing') server.guides.clear();
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('needs_attention');
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'failure', guideMappingVersion: change === 'digest' ? 'unknown' : `suunto-guides-${version}`, deliveryPhase: 'recover',
    }));
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('needs_attention');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
  });
  it.each(['v2', 'v3', 'v4', 'v6', 'v10', 'v11', 'v12'] as const)('recovers the %s identity after consent withdrawal without upgrading or recreating it', async version => {
    if (version === 'v6') await user().collection('scheduledWorkouts').doc('w').update({ 'structure.sport': ActivityTypes.Swimming });
    if (version === 'v10') await useManualRecipe(ActivityTypes.Swimming);
    if (version === 'v11' || version === 'v12') await useManualRecipe(ActivityTypes.Running);
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send();
    if (version !== 'v12') await startedLegacy(version);
    await command('stop'); await drain(); now = original.retryAtMs + 1;
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('removed');
    expect(server.guides.size).toBe(0);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
  });
  it.each(['past', 'completed'])('does not upgrade a %s Guide when the mapping version changes', async state => {
    const delivered = await send();
    if (state === 'past') now = Date.parse('2026-09-18T10:00:00Z');
    else await user().collection(DELIVERY_LEDGER).doc(delivered.id).update({ 'actual.completed': true });
    await user().collection(DELIVERY_LEDGER).doc(delivered.id).update({ desiredDigest: 'old-mapping', acceptedDigest: 'old-mapping' });
    const before = JSON.stringify([...server.guides.values()]);
    await mark(); await processTrainingDelivery(runtime, uid, delivered.id); await drain();
    expect((await ledger()).desired).toBe('preserve');
    expect(JSON.stringify([...server.guides.values()])).toBe(before);
    expect(server.calls.filter(call => ['POST', 'PUT', 'DELETE'].includes(call.method))).toHaveLength(1);
  });
  it.each([
    [ActivityTypes.Swimming, 'v9', 'past'], [ActivityTypes.Swimming, 'v9', 'completed'],
    [ActivityTypes.OpenWaterSwimming, 'v7', 'past'], [ActivityTypes.OpenWaterSwimming, 'v7', 'completed'],
    [ActivityTypes.Running, 'v7', 'past'], [ActivityTypes.Running, 'v7', 'completed'],
    [ActivityTypes.Cycling, 'v7', 'past'], [ActivityTypes.Cycling, 'v7', 'completed'],
  ] as const)('preserves the exact %s %s archive when it is %s', async (sport, version, state) => {
    await user().collection('scheduledWorkouts').doc('w').update({ 'structure.sport': sport,
      'structure.nodes': [
        { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
        { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
      ] });
    const delivered = await send();
    const workout = parseScheduledWorkoutV1((await user().collection('scheduledWorkouts').doc('w').get()).data());
    const settings = (await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data());
    const assessLegacy = version === 'v9' ? assessSuuntoGuideV9ForRecovery : assessSuuntoGuideV7ForRecovery;
    const digest = assessLegacy(workout, delivered.destinationKey, delivered.timeZone, 'Quantified Self').digest;
    expect(digest).not.toBe(delivered.acceptedDigest);
    const operation: DeliveryOperation = { id: 'legacy-swim', kind: 'upsert', deliveryId: delivered.id,
      generation: delivered.desiredGeneration, connectionGeneration: 'connection', destinationKey: delivered.destinationKey,
      timeZone: delivered.timeZone, digest, contentDigest: delivered.contentDigest, workout, artifact: delivered.actual };
    const payload = guidePayloadForRecovery(operation, 'Quantified Self')!;
    const id = delivered.actual!.ids.guide;
    server.guides.set(id, { guide: payload, pinned: true });
    await user().collection(DELIVERY_LEDGER).doc(delivered.id).update({ desiredDigest: digest, acceptedDigest: digest,
      'actual.completed': state === 'completed' });
    if (state === 'past') now = Date.parse('2026-09-18T10:00:00Z');
    const before = structuredClone(server.guides.get(id));
    for (let pass = 0; pass < 2; pass++) {
      await mark(); await processTrainingDelivery(runtime, uid, delivered.id); await drain();
    }
    expect(await ledger()).toMatchObject({ desired: 'preserve', acceptedDigest: digest,
      actual: { ids: delivered.actual!.ids, completed: state === 'completed' } });
    expect(server.guides.size).toBe(1);
    expect(server.guides.get(id)).toEqual(before);
    expect(server.calls.filter(call => ['POST', 'PUT', 'DELETE'].includes(call.method))).toHaveLength(1);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).data()).toEqual(workout);
    expect((await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data())).toEqual(settings);
  });
  it.each([ActivityTypes.Running, ActivityTypes.Cycling, ActivityTypes.Rowing])(
    'recovers the exact v7 %s manual Guide after a lost ACK, then updates once to the current presentation without new consent', async sport => {
    const structure = { version: 1, sport, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
    ] };
    await user().collection('scheduledWorkouts').doc('w').update({ structure });
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send(); expect(original.status).toBe('retrying');
    const legacy = await startedLegacy('v7');
    expect(legacy.payload.steps[0]).toMatchObject({ notification: { text: 'Press lap when ready' } });
    await command('retry'); await drain();
    const consent = (await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data());
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).actual?.ids.guide).toBe(legacy.id);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'recovered_acceptance', guideMappingVersion: 'suunto-guides-v7', deliveryPhase: 'recover',
    }));
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.guides.get(legacy.id)!.guide.steps[0]).toMatchObject({ notification: { text: 'Press Lap to finish this interval.' } });
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'accepted', guideMappingVersion: sport === ActivityTypes.Rowing ? 'suunto-guides-v11' : 'suunto-guides-v12', deliveryPhase: 'execute',
    }));
    await mark(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect(server.guides.size).toBe(1);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('structure')).toEqual(structure);
    expect((await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data())).toEqual(consent);
  });
  it('retries a corrected Guides application key without reconnecting or replacing consent', async () => {
    let rejectedKey = true;
    const client = createSuuntoGuideClient(async () => ({ accessToken: 'fixture-token', account: 'account' }),
      () => 'fixture-guides-key', async () => new Response(JSON.stringify({ statusCode: 401,
        message: 'Access denied due to invalid subscription key.' }), { status: 401 }));
    const transport = new SuuntoGuideTransport((request, guard) => rejectedKey ? client(request, guard) : server.request(request, guard),
      'Quantified Self', () => now);
    runtime.transport = provider => provider === 'suunto' ? transport : null;
    const row = await send();
    expect(row.status).toBe('failed'); expect(row.blockedConnectionGeneration).toBeNull();
    expect(row.attempt?.progress).toMatchObject({ step: 'create', state: 'rejected' });
    expect(server.guides.size).toBe(0);
    rejectedKey = false;
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect((await ledger()).status).toBe('delivered'); expect(server.guides.size).toBe(1);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'accepted', guideMappingVersion: 'suunto-guides-v7', deliveryPhase: 'execute',
    }));
    expect((await user().collection('trainingDeliverySettings').doc('workout_w_suunto').get()).data()?.enabled).toBe(true);
  });
  it('blocks an unresolved create even after explicit Retry', async () => {
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; server.guides.clear(); throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const row = await send(); now = row.retryAtMs + 1;
    await processTrainingDelivery(runtime, uid, row.id); expect((await ledger()).status).toBe('needs_attention');
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, row.id);
    expect((await ledger()).status).toBe('needs_attention'); expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });
  it.each(['edit', 'stop', 'expiry', 'disconnect'])('retains accepted identity when %s wins during the request', async change => {
    server.afterHandle = async request => {
      if (request.method !== 'POST') return;
      server.afterHandle = null;
      if (change === 'edit') await user().collection('scheduledWorkouts').doc('w').update({ title: 'Latest edit' });
      if (change === 'stop') await command('stop');
      if (change === 'expiry') pro = false;
      if (change === 'disconnect') await user().collection('meta').doc(ServiceNames.SuuntoApp).update({ connectionState: 'disconnected' });
      await mark();
    };
    const row = await send(); expect(row.actual?.ids.guide).toBeTruthy();
    await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    if (change === 'stop') expect(server.guides.size).toBe(0);
    else {
      expect(server.guides.size).toBe(1);
      expect([...server.guides.values()][0].guide.name).toBe(change === 'edit' ? 'Latest edit' : 'Run');
      if (change !== 'edit') expect((await ledger()).status).toBe(change === 'expiry' ? 'paused_pro' : 'reconnect_required');
    }
  });
  it('does not recreate local records when account deletion starts during acceptance', async () => {
    await command('send'); await drain(); const row = await ledger();
    server.afterHandle = async request => { if (request.method === 'POST') {
      await db.collection('userDeletionTombstones').doc(uid).set({}); await db.recursiveDelete(user());
    } };
    await processTrainingDelivery(runtime, uid, row.id);
    expect((await user().get()).exists).toBe(false); expect((await user().collection(DELIVERY_LEDGER).get()).empty).toBe(true);
  });
  it('deduplicates private FIT evidence and fences deleted events/accounts', async () => {
    const bytes = suuntoFitFixture(['qs'], [guideExternalId('account', 'w')]);
    expect(readSuuntoGuideCompletions(bytes, 'qs')).toHaveLength(1);
    const event = user().collection('events').doc('event'); await event.set({ test: true });
    const retain = () => retainSuuntoGuideCompletions(db, uid, 'event', 'account', 'retained', bytes, 'qs');
    await retain(); await retain(); expect((await event.collection('trainingCompletionEvidence').get()).size).toBe(1);
    await db.recursiveDelete(event); await retain(); expect((await event.collection('trainingCompletionEvidence').get()).empty).toBe(true);
    await event.set({ test: true }); await db.collection('userDeletionTombstones').doc(uid).set({}); await retain();
    expect((await event.collection('trainingCompletionEvidence').get()).empty).toBe(true);
  });
  it('retains more than 30 Guide markers through bounded real Firestore queries', async () => {
    const externalIds = Array.from({ length: 31 }, (_, index) => guideExternalId('account', `workout-${index}`));
    const sessions = Array.from({ length: Math.ceil(externalIds.length / 4) }, (_, index) => {
      const page = externalIds.slice(index * 4, (index + 1) * 4);
      return { owners: page.map(() => 'qs'), externalIds: page };
    });
    const event = user().collection('events').doc('many-markers');
    await event.set({ test: true });

    await expect(retainSuuntoGuideCompletions(
      db,
      uid,
      event.id,
      'account',
      'retained',
      suuntoMultiSessionFitFixture(sessions),
      'qs',
    )).resolves.toEqual({ retained: true, linkedWorkoutIds: [] });

    const evidence = (await event.collection('trainingCompletionEvidence').doc('fit').get()).data();
    expect(evidence?.suuntoGuides?.['SuuntoPlus Guide References']?.references).toHaveLength(31);
  });
  it('links an exact Guide marker and protects the delivered artifact in one real transaction', async () => {
    const delivered = await send();
    const externalId = delivered.actual?.ids.externalId;
    expect(externalId).toBeTruthy();
    const event = user().collection('events').doc('completed-event');
    await event.set({ test: true });

    const result = await retainSuuntoGuideCompletions(
      db,
      uid,
      event.id,
      'account',
      'retained',
      suuntoFitFixture(['qs'], [externalId!]),
      'qs',
      [{ id: 'activity', startTimeMs: 631065723000 }],
      now,
    );

    expect(result.linkedWorkoutIds).toEqual(['w']);
    expect((await user().collection('trainingWorkoutCompletions').doc('w').get()).data()).toMatchObject({
      provider: 'suunto', eventId: event.id, activityId: 'activity', matchMethod: 'provider_marker',
    });
    expect(await ledger()).toMatchObject({
      status: 'completed', desired: 'preserve', completionLinkId: expect.any(String),
      actual: { completed: true },
    });
  });
  it('defers an exact Guide link during staged restore and links after publication', async () => {
    const delivered = await send();
    const externalId = delivered.actual?.ids.externalId;
    expect(externalId).toBeTruthy();
    const event = user().collection('events').doc('restored-event');
    await event.set({ test: true });
    const lock = user().collection('trainingPlanState').doc('current')
      .collection('planDeletionLocks').doc('_bulk_restore');
    await lock.set({ test: true });
    const retain = () => retainSuuntoGuideCompletions(db, uid, event.id, 'account', 'retained',
      suuntoFitFixture(['qs'], [externalId!]), 'qs');
    await expect(retain()).rejects.toThrow('plan restore is in progress');
    expect((await user().collection('trainingWorkoutCompletions').doc('w').get()).exists).toBe(false);
    await lock.delete();
    expect((await retain()).linkedWorkoutIds).toEqual(['w']);
  });
  it.each([
    ['rescheduling', { localDate: '2026-09-18', revision: 2 }],
    ['plan transfer', { planId: 'another-plan', revision: 2 }],
  ])('does not link a Guide from a stale delivered occurrence after %s', async (_reason, change) => {
    const delivered = await send();
    const externalId = delivered.actual?.ids.externalId;
    expect(externalId).toBeTruthy();
    await user().collection('scheduledWorkouts').doc('w').update(change);
    const event = user().collection('events').doc('rescheduled-event'); await event.set({ test: true });
    const result = await retainSuuntoGuideCompletions(db, uid, event.id, 'account', 'retained',
      suuntoFitFixture(['qs'], [externalId!]), 'qs', [{ id: 'activity', startTimeMs: 631065723000 }], now);
    expect(result).toEqual({ retained: true, linkedWorkoutIds: [] });
    expect((await user().collection('trainingWorkoutCompletions').get()).empty).toBe(true);
    expect((await ledger()).actual?.completed).toBe(false);
    await user().collection(DELIVERY_LEDGER).doc(delivered.id).update(_reason === 'rescheduling'
      ? { 'actual.localDate': change.localDate } : { planId: change.planId });
    expect((await retainSuuntoGuideCompletions(db, uid, event.id, 'account', 'retained',
      suuntoFitFixture(['qs'], [externalId!]), 'qs', [{ id: 'activity', startTimeMs: 631065723000 }], now)).linkedWorkoutIds)
      .toEqual(['w']);
  });
  it('leaves a missing marker unlinked and keeps the first link when a Guide marker is reused', async () => {
    const delivered = await send();
    const externalId = delivered.actual!.ids.externalId;
    const first = user().collection('events').doc('first-event'); await first.set({ test: true });
    const missing = await retainSuuntoGuideCompletions(db, uid, first.id, 'account', 'retained',
      suuntoFitFixture(['qs'], [guideExternalId('account', 'missing')]), 'qs');
    expect(missing.linkedWorkoutIds).toEqual([]);
    const marker = suuntoFitFixture(['qs'], [externalId]);
    expect((await retainSuuntoGuideCompletions(db, uid, first.id, 'account', 'retained', marker, 'qs')).linkedWorkoutIds)
      .toEqual(['w']);
    const second = user().collection('events').doc('second-event'); await second.set({ test: true });
    expect((await retainSuuntoGuideCompletions(db, uid, second.id, 'account', 'retained', marker, 'qs')).linkedWorkoutIds)
      .toEqual([]);
    expect((await user().collection('trainingWorkoutCompletions').doc('w').get()).data())
      .toMatchObject({ eventId: first.id, provider: 'suunto' });
  });
  it('does not turn a same-event manual completion into an exact Suunto marker link', async () => {
    const delivered = await send();
    const event = user().collection('events').doc('manual-event'); await event.set({ test: true });
    await user().collection('trainingWorkoutCompletions').doc('w').set({
      schemaVersion: 1, workoutId: 'w', planId: null, provider: 'suunto', matchMethod: 'manual_confirmation',
      eventId: event.id, activityId: null, sourceSessionIndex: 0, activityStartAtMs: null,
      scheduledLocalDate: '2026-09-17', workoutRevisionAtLink: 1, timing: 'unknown', linkedAtMs: 1, updatedAtMs: 1,
    });
    expect((await retainSuuntoGuideCompletions(db, uid, event.id, 'account', 'retained',
      suuntoFitFixture(['qs'], [delivered.actual!.ids.externalId]), 'qs')).linkedWorkoutIds).toEqual([]);
    expect((await user().collection('trainingWorkoutCompletions').doc('w').get()).data())
      .toMatchObject({ matchMethod: 'manual_confirmation' });
    expect((await ledger()).actual?.completed).toBe(false);
  });
  it('fences stale reconnect generations and another owner with the same incoming Guide marker', async () => {
    const delivered = await send();
    const externalId = delivered.actual!.ids.externalId;
    const event = user().collection('events').doc('reconnect-event'); await event.set({ test: true });
    const marker = suuntoFitFixture(['qs'], [externalId]);
    await db.collection('suuntoAppAccessTokens').doc(uid).collection('tokens').doc('account')
      .update({ tokenCredentialGeneration: 'new-generation' });
    await getSuuntoHealthWebhookAccountBindingRef(db, 'account', uid)
      .set(buildSuuntoHealthWebhookAccountBinding(uid, 'account', 'new-generation', 'oauth_callback'));
    expect(await retainSuuntoGuideCompletions(db, uid, event.id, 'account', 'retained', marker, 'qs'))
      .toEqual({ retained: false, linkedWorkoutIds: [] });
    expect((await retainSuuntoGuideCompletions(db, uid, event.id, 'account', 'new-generation', marker, 'qs')).linkedWorkoutIds)
      .toEqual(['w']);
    const otherUid = `suunto-test-${randomUUID()}`; users.push(otherUid);
    const other = db.collection('users').doc(otherUid);
    await other.set({ test: true });
    await other.collection('meta').doc(ServiceNames.SuuntoApp).set({ connectionState: 'connected',
      connectionStateGeneration: 'connection', providerUserId: 'other-account' });
    await db.collection('suuntoAppAccessTokens').doc(otherUid).set({ activeOAuthCredentialGeneration: 'new-generation' });
    await db.collection('suuntoAppAccessTokens').doc(otherUid).collection('tokens').doc('other-account').set({
      userName: 'other-account', serviceName: ServiceNames.SuuntoApp, tokenCredentialGeneration: 'new-generation',
    });
    await getSuuntoHealthWebhookAccountBindingRef(db, 'other-account', otherUid)
      .set(buildSuuntoHealthWebhookAccountBinding(otherUid, 'other-account', 'new-generation', 'oauth_callback'));
    await other.collection('events').doc('event').set({ test: true });
    expect(await retainSuuntoGuideCompletions(db, otherUid, 'event', 'other-account', 'new-generation', marker, 'qs'))
      .toEqual({ retained: true, linkedWorkoutIds: [] });
    expect((await other.collection('trainingWorkoutCompletions').get()).empty).toBe(true);
  });
  it.each(['suunto', 'garmin'] as const)('keeps the first exact completion when %s imports before the other provider', async first => {
    const suuntoDelivery = await send();
    const externalId = suuntoDelivery.actual!.ids.externalId;
    const garminAccount = 'garmin-account';
    const garminWorkoutId = String(0xfffffffe);
    const activityStartAtMs = Date.parse('2026-09-17T07:00:00Z');
    await user().collection('meta').doc(ServiceNames.GarminAPI).set({ connectionState: 'connected',
      connectionStateGeneration: 'connection', providerUserId: garminAccount });
    await db.collection('garminAPITokens').doc(uid).set({ activeOAuthCredentialGeneration: 'credential' });
    await db.collection('garminAPITokens').doc(uid).collection('tokens').doc(garminAccount).set({
      serviceName: ServiceNames.GarminAPI, userID: garminAccount, tokenCredentialGeneration: 'credential',
      permissions: ['WORKOUT_IMPORT'],
    });
    await user().collection(DELIVERY_LEDGER).doc('garmin-delivery').set({ ...suuntoDelivery,
      id: 'garmin-delivery', provider: 'garmin', destinationKey: deliveryIdentity(uid, 'garmin', garminAccount, 'account'),
      actual: { ids: { workout: garminWorkoutId, schedule: '17', owner: '23' },
        localDate: '2026-09-17', completed: false },
    } satisfies DeliveryLedgerV1);
    const suuntoEvent = user().collection('events').doc('suunto-event'); await suuntoEvent.set({ test: true });
    const garminEvent = user().collection('events').doc('garmin-event'); await garminEvent.set({ test: true });
    await garminEvent.collection('metaData').doc(ServiceNames.GarminAPI).set({ serviceName: ServiceNames.GarminAPI,
      serviceUserID: garminAccount, serviceActivityFileID: 'garmin-source-file', serviceActivityFileType: 'FIT' });
    await user().collection('activities').doc('garmin-activity').set({
      userID: uid, eventID: garminEvent.id, startDate: activityStartAtMs,
    });
    const linkSuunto = () => retainSuuntoGuideCompletions(db, uid, suuntoEvent.id, 'account', 'retained',
      suuntoFitFixture(['qs'], [externalId]), 'qs', [{ id: 'suunto-activity', startTimeMs: activityStartAtMs }]);
    const linkGarmin = () => retainGarminFITWorkoutReferences(db, uid, garminEvent.id, garminAccount, 'credential',
      { activityFileID: 'garmin-source-file', activityFileType: 'FIT' }, standardWorkoutReferenceFitFixture(),
      [{ id: 'garmin-activity', startTimeMs: activityStartAtMs }]);
    if (first === 'suunto') { await linkSuunto(); await linkGarmin(); }
    else { await linkGarmin(); await linkSuunto(); }
    expect((await user().collection('trainingWorkoutCompletions').doc('w').get()).data())
      .toMatchObject({ provider: first, eventId: `${first}-event` });
    expect((await user().collection(DELIVERY_LEDGER).doc(first === 'suunto' ? suuntoDelivery.id : 'garmin-delivery').get())
      .get('actual.completed')).toBe(true);
    expect((await user().collection(DELIVERY_LEDGER).doc(first === 'suunto' ? 'garmin-delivery' : suuntoDelivery.id).get())
      .get('actual.completed')).toBe(false);
  });
  it('recovers a frozen v5 lost create ACK without replacing or redundantly updating its Guide', async () => {
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send(); expect(original.status).toBe('retrying');
    const legacy = await startedLegacy('v5');
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).actual?.ids.guide).toBe(legacy.id);
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
    expect(server.guides.get(legacy.id)!.guide).toEqual(legacy.payload);
  });

  it.each([
    { sport: ActivityTypes.Swimming, version: 'v7' as const },
    { sport: ActivityTypes.Swimming, version: 'v9' as const },
    { sport: ActivityTypes.OpenWaterSwimming, version: 'v7' as const },
  ])('recovers an uncertain $version $sport send, then updates Rest once without changing consent or recipe', async ({ sport, version }) => {
    const structure = { version: 1, sport, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'manual' }, targets: [] },
      { kind: 'step', id: 'rest', purpose: 'rest', ending: { kind: 'time', seconds: 15 }, targets: [] },
    ] };
    await user().collection('scheduledWorkouts').doc('w').update({ structure });
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send(); expect(original.status).toBe('retrying');
    const legacy = await startedLegacy(version);
    expect(JSON.stringify(legacy.payload)).not.toContain('"window":"workout"');
    await command('retry'); await drain();
    const consent = (await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data());
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).actual?.ids.guide).toBe(legacy.id);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'recovered_acceptance', guideMappingVersion: `suunto-guides-${version}`, deliveryPhase: 'recover',
    }));
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    const steps = server.guides.get(legacy.id)!.guide.steps;
    expect(steps[0]).toMatchObject({ notification: { title: 'Work', text: 'Swim now. Press Lap to finish this interval.' } });
    if (sport === ActivityTypes.Swimming) expect(steps[0]).toMatchObject({ fields: [
      { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
      { type: 'distance', title: 'Swum', window: 'step' }, { type: 'duration', title: 'Elapsed', window: 'step' },
      { type: 'strokeRate' }, { type: 'swolf' },
    ] });
    expect(steps[1]).toMatchObject({ notification: { title: 'Rest', text: 'Rest for 15s' }, fields: [
      { type: 'stepDurationCountdown', value: 15, title: 'Rest rem' }, { type: 'heartRate', title: 'HR' },
      { type: 'distance', title: 'Total', window: 'workout' },
    ] });
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'accepted', guideMappingVersion: 'suunto-guides-v12', deliveryPhase: 'execute',
    }));
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('structure')).toEqual(structure);
    expect((await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data())).toEqual(consent);
    await mark(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect(server.guides.size).toBe(1);
  });

  it('recovers an uncertain v6 pool send, then adds SWOLF once without changing consent or recipe', async () => {
    const structure = { version: 1, sport: ActivityTypes.Swimming, nodes: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 90 }, targets: [], note: 'Aim 30-40 cycles/min' },
      { kind: 'step', id: 'easy', purpose: 'recovery', ending: { kind: 'time', seconds: 30 }, targets: [] },
    ] };
    await user().collection('scheduledWorkouts').doc('w').update({ structure });
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send(); expect(original.status).toBe('retrying');
    const legacy = await startedLegacy('v6');
    expect(JSON.stringify(legacy.payload)).not.toContain('swolf');
    await command('retry'); await drain();
    const consent = (await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data());
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).actual?.ids.guide).toBe(legacy.id);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'recovered_acceptance', guideMappingVersion: 'suunto-guides-v6', deliveryPhase: 'recover',
    }));
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.guides.get(legacy.id)!.guide.steps[0]).toMatchObject({ fields: [
      { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
      { type: 'stepDurationCountdown', value: 90, title: 'Time rem' },
      { type: 'text', value: 'Aim 30-40 cycles/min' },
      { type: 'strokeRate', title: 'Avg strk', window: 'manualLap', aggregate: 'average' },
      { type: 'swolf', title: 'AvgSWOLF', window: 'manualLap', aggregate: 'average' },
    ] });
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('structure')).toEqual(structure);
    expect((await user().collection('trainingDeliverySettings').get()).docs.map(doc => doc.data())).toEqual(consent);
    await mark(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect(server.guides.size).toBe(1);
    await user().collection('scheduledWorkouts').doc('w').update({ revision: 2, localDate: '2026-09-18', updatedAtMs: now + 1 });
    await mark(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).actual?.ids.guide).toBe(legacy.id);
    expect(server.guides.get(legacy.id)!.guide.localDate).toBe('2026-09-18');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(2);
    await command('stop'); await drain(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('removed'); expect(server.guides.size).toBe(0);
  });

  it('delivers and edits early Lap repeat paths on the same Guide identity without changing the canonical recipe', async () => {
    const structure = { version: 1, sport: ActivityTypes.Running, nodes: [{ kind: 'repeat', id: 'repeat', count: 2, steps: [
      { kind: 'step', id: 'work', purpose: 'work', ending: { kind: 'time', seconds: 90.123, allowEarlyLap: true }, targets: [] },
      { kind: 'step', id: 'recovery', purpose: 'recovery', ending: { kind: 'distance', meters: 400.125, allowEarlyLap: false }, targets: [] },
    ] }] };
    await user().collection('scheduledWorkouts').doc('w').update({ structure });
    const sent = await send(); expect(sent.status).toBe('delivered'); const id = sent.actual!.ids.guide;
    expect(JSON.stringify(server.guides.get(id)!.guide.steps)).toContain('"type":"or"');
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('structure')).toEqual(structure);
    await user().collection('scheduledWorkouts').doc('w').update({ revision: 2, localDate: '2026-09-18', updatedAtMs: now + 1 });
    await mark(); await processTrainingDelivery(runtime, uid, sent.id); await drain();
    expect((await ledger()).actual?.ids.guide).toBe(id);
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect((await user().collection('scheduledWorkouts').doc('w').get()).get('structure')).toEqual(structure);
    await mark(); await processTrainingDelivery(runtime, uid, sent.id); await drain();
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  });

});
