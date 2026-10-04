import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes, ServiceNames } from '@sports-alliance/sports-lib';
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
import { guideExternalId, assessSuuntoGuideV2ForRecovery, assessSuuntoGuideV3ForRecovery, guidePayloadForRecovery } from './mapping';
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
  // Simulate a journal and provider archive written by the previous deployed
  // serializer. The fixture, Firestore and all provider HTTP remain local/demo.
  const startedLegacy = async (version: 'v2' | 'v3' = 'v2') => {
    const row = await ledger(); const operation = row.attempt!;
    operation.digest = (version === 'v2' ? assessSuuntoGuideV2ForRecovery : assessSuuntoGuideV3ForRecovery)(operation.workout!, operation.destinationKey,
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
      event: 'accepted', provider: 'suunto', guideMappingVersion: 'suunto-guides-v4', deliveryPhase: 'execute',
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
    expect(JSON.stringify([...server.guides.values()][0].guide.steps)).toContain('80 kg');
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
    expect(JSON.stringify([...server.guides.values()][0].guide.steps)).toContain('80 kg');
    await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect(server.guides.size).toBe(1);
    expect(JSON.stringify([...server.guides.values()][0].guide.steps)).toContain('85 kg');
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
    expect(JSON.stringify([...server.guides.values()][0].guide.steps)).toContain('80 kg');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });
  it('still requires current mapping approval when strength instructions lose text', async () => {
    useProductionPolicy();
    const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat',
      name: 'Long exercise instructions '.repeat(3), sets: [{ id: 'set-one',
        ending: { kind: 'repetitions' as const, repetitions: 5 }, externalLoadKg: 80, restAfterSeconds: 120 }] }] };
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
  it('recovers lost create acceptance on explicit Retry without a duplicate', async () => {
    server.afterHandle = async request => { if (request.method === 'POST') { server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false); } };
    const row = await send(); expect(row.status).toBe('retrying');
    expect(row.attempt?.progress).toMatchObject({ step: 'create', state: 'started' });
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, row.id); await drain();
    expect((await ledger()).status).toBe('delivered'); expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
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
  it.each([assessSuuntoGuideV2ForRecovery, assessSuuntoGuideV3ForRecovery])(
    'honors exact legacy loss approval through v4 delivery, but not a newly edited instruction', async assessLegacy => {
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
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  });
  it.each((['v2', 'v3'] as const).flatMap(version => ['running', 'strength'].map(sport => [version, sport] as const)))(
    'recovers a %s %s create with a lost ACK then upgrades without another POST', async (version, sport) => {
    if (sport === 'strength') {
      const details = { version: 1 as const, workoutId: 'w', revision: 1, exercises: [{ id: 'squat', name: 'Squat', sets: [
        { id: 'one', ending: { kind: 'repetitions' as const, repetitions: 5 }, restAfterSeconds: 30 },
      ] }] };
      await user().collection('scheduledWorkouts').doc('w').update({ structure: projectStrengthWorkoutToV1(details) });
      await user().collection('scheduledWorkouts').doc('w').collection('strengthDetails').doc('current').set(details);
    }
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send(); expect(original.status).toBe('retrying');
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'failure', guideMappingVersion: 'suunto-guides-v4', deliveryPhase: 'execute',
    }));
    const legacy = await startedLegacy(version);
    expect(JSON.stringify(legacy.payload).includes('notification')).toBe(version === 'v3');
    expect(JSON.stringify(legacy.payload)).not.toContain('aggregate');
    await command('retry'); await drain(); await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).actual?.ids.guide).toBe(legacy.id);
    expect((await ledger()).attempt).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'recovered_acceptance', guideMappingVersion: `suunto-guides-${version}`, deliveryPhase: 'recover',
    }));
    await processTrainingDelivery(runtime, uid, original.id); await drain();
    expect((await ledger()).status).toBe('delivered');
    expect(server.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    // v3 strength already has the exact HR-only v4 payload. Upgrade the digest
    // without a redundant PUT; all other historical screen layouts need one.
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(version === 'v3' && sport === 'strength' ? 0 : 1);
    expect(server.guides.get(legacy.id)!.guide.steps.at(-1)).toMatchObject({ title: 'Complete' });
    if (sport === 'running') {
      expect(server.guides.get(legacy.id)!.guide.steps[0]).toMatchObject({ notification: { title: 'Work', text: 'For 10m 00s' } });
      expect(server.guides.get(legacy.id)!.guide.steps[0]).toMatchObject({ fields: [
        { type: 'pace', title: 'Avg pace', window: 'manualLap', aggregate: 'average' },
        { type: 'stepDurationCountdown', value: 600 }, { type: 'heartRate', title: 'HR' },
      ] });
      expect(server.guides.get(legacy.id)!.guide.steps.at(-1)).toMatchObject({ createManualLap: true });
    } else {
      expect(server.guides.get(legacy.id)!.guide.steps[1]).toMatchObject({ notification: { title: 'Rest', text: 'Rest for 30s' } });
    }
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      event: 'accepted', guideMappingVersion: 'suunto-guides-v4', deliveryPhase: 'execute',
    }));
    const logs = JSON.stringify([...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.warn).mock.calls]);
    for (const value of [uid, legacy.id, legacy.operation.digest, legacy.operation.destinationKey, 'notification', 'Squat']) {
      expect(logs).not.toContain(value);
    }
  });
  it.each((['v2', 'v3'] as const).flatMap(version =>
    ['not-started', 'ready-create', 'rejected-create', 'unaccepted-update'].map(state => [version, state] as const)))(
    'retains exact %s loss approval when retiring a %s attempt during upgrade', async (version, state) => {
    await user().collection('scheduledWorkouts').doc('w').update({ 'structure.nodes': [{
      kind: 'step', id: 'step', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [], note: 'A'.repeat(45),
    }] });
    const transport = runtime.transport('suunto')!;
    const previous = vi.spyOn(transport, 'assess').mockImplementation((workout, destination, zone, strength) =>
      (version === 'v2' ? assessSuuntoGuideV2ForRecovery : assessSuuntoGuideV3ForRecovery)(workout, destination, zone, 'Quantified Self', strength));
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
      // this newer prescription accepted, but preserve the identity for v4 PUT.
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
  it.each(['v2', 'v3'] as const)('recovers a %s reschedule/update with a lost ACK before applying the new screen layout', async version => {
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
    expect(server.calls.filter(call => call.method === 'PUT')).toHaveLength(2);
  });
  it.each((['v2', 'v3'] as const).flatMap(version =>
    ['digest', 'content', 'missing'].map(change => [version, change] as const)))(
    'keeps a %s uncertain create unresolved on %s mismatch, even on Retry', async (version, change) => {
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send(); const legacy = await startedLegacy(version);
    if (change === 'digest') await user().collection(DELIVERY_LEDGER).doc(original.id).update({ 'attempt.digest': 'unrecognized-version-digest' });
    if (change === 'content') server.guides.get(legacy.id)!.guide.name = 'Different prescription';
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
  it.each(['v2', 'v3'] as const)('recovers the %s identity after consent withdrawal without upgrading or recreating it', async version => {
    server.afterHandle = async request => { if (request.method === 'POST') {
      server.afterHandle = null; throw new SuuntoGuideHttpError('uncertain', false);
    } };
    const original = await send(); await startedLegacy(version);
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
      event: 'accepted', guideMappingVersion: 'suunto-guides-v4', deliveryPhase: 'execute',
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
});
