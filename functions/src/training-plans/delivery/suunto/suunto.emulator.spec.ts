import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes, ServiceNames } from '@sports-alliance/sports-lib';
import { trainingDeliveryCommand } from '../commands';
import { reconcileTrainingDeliveryPage } from '../store';
import { processTrainingDelivery } from '../worker';
import { processTrainingVerification } from '../verification-worker';
import { stageTrainingDeliveryReconciliation } from '../marker';
import { readTrainingDeliveryAuthority } from '../connection';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, type DeliveryLedgerV1, type DeliveryRuntime } from '../contracts';
import { SuuntoGuideTransport } from './transport';
import { createSuuntoGuideClient, SuuntoGuideHttpError } from './http';
import { SuuntoHttpFixture } from '../test-support/suunto-http-fixture';
import { buildSuuntoHealthWebhookAccountBinding, getSuuntoHealthWebhookAccountBindingRef } from '../../../suunto/health-webhook-binding';
import { readSuuntoGuideCompletions, retainSuuntoGuideCompletions } from '../../../suunto/guide-completion';
import { suuntoFitFixture } from '../test-support/suunto-fit-fixture';
import { guideExternalId } from './mapping';
import type { TrainingDeliveryCommandV1 } from '../../../../../shared/training-provider-delivery';

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
    return trainingDeliveryCommand(runtime, uid, { schemaVersion: 1, mutationId: randomUUID(), scope: 'workout', scopeId: 'w',
      provider: 'suunto', action, expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: setting.data()?.revision ?? 0,
      ...(action === 'send' ? { timeZone: 'Europe/Helsinki' } : {}) }, false);
  };
  const send = async () => { await command('send'); await drain(); const row = await ledger(); await processTrainingDelivery(runtime, uid, row.id); await drain(); return ledger(); };
  beforeEach(async () => {
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
  afterAll(async () => {
    for (const id of users) {
      await db.recursiveDelete(db.collection('users').doc(id)); await db.recursiveDelete(db.collection('suuntoAppAccessTokens').doc(id));
      await db.recursiveDelete(getSuuntoHealthWebhookAccountBindingRef(db, 'account', id));
      await db.recursiveDelete(db.collection('userDeletionTombstones').doc(id));
      for (const doc of (await db.collection(DELIVERY_QUEUE).where('uid', '==', id).get()).docs) await db.recursiveDelete(doc.ref);
    }
    await db.terminate();
  });
  it('delivers once under concurrent workers and checks cloud presence using retained account authority', async () => {
    await command('send'); await drain(); const row = await ledger();
    await Promise.all([processTrainingDelivery(runtime, uid, row.id), processTrainingDelivery(runtime, uid, row.id)]);
    await drain(); expect(server.guides.size).toBe(1); expect((await ledger()).status).toBe('delivered');
    await processTrainingVerification(runtime, uid, row.id);
    expect((await ledger()).verification?.state).toBe('present');
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
});
