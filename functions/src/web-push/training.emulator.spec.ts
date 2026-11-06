import { createHash, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { TRAINING_PUSH, type TrainingCandidate } from './training-policy';
import { observeTrainingNotification, sendTrainingNotification, type TrainingPushDependencies } from './training-service';

const now = Date.UTC(2026, 10, 6, 12), key = 'B' + 'A'.repeat(86), origin = 'https://quantified-self.io';
const device = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('training notification transactions', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required');
  let db: Firestore;
  beforeEach(() => { db = new Firestore({ projectId: `demo-training-push-${randomUUID().slice(0, 8)}` }); });
  afterEach(async () => { vi.restoreAllMocks(); await db.terminate(); });
  async function setup() {
    let clock = now;
    const root = 'users/owner', state = db.doc(`${root}/pushState/trainingSync`);
    const destinationKey = createHash('sha256').update(JSON.stringify(['owner', 'garmin', 'account', 'account'])).digest('hex');
    const setting = { schemaVersion: 1, scope: 'plan', scopeId: 'plan', provider: 'garmin', revision: 1,
      enabled: true, suppressed: false, timeZone: 'UTC', destinationKey, connectionEpoch: 0,
      scopeGeneration: 0, associationPlanId: null, approvedDigest: null, updatedAtMs: now - 1000 };
    const registration = { schemaVersion: 1, generation, origin, vapidPublicKey: key,
      endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: key, auth: 'A'.repeat(22) } };
    const writes = db.batch();
    writes.set(db.doc(root), {}); writes.set(db.doc(`${root}/pushSubscriptions/${device}`), registration);
    writes.set(db.doc(`${root}/meta/${ServiceNames.GarminAPI}`), { connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'account' });
    writes.set(db.doc(`${root}/trainingPlans/plan`), { lifecycle: 'active', updatedAtMs: now - 1000 });
    writes.set(db.doc(`${root}/trainingDeliverySettings/plan_plan_garmin`), setting);
    writes.set(db.doc(`${root}/trainingDeliveryState/current`), { revision: 1 }); await writes.commit();
    const seed = async (name = 'workout', status = 'failed', planId: string | null = 'plan'): Promise<TrainingCandidate> => {
      const id = createHash('sha256').update(name).digest('hex'), batch = db.batch();
      batch.set(db.doc(`${root}/scheduledWorkouts/${name}`), { id: name, planId, localDate: '2026-11-07', lifecycle: 'planned', updatedAtMs: now - 1000 });
      batch.set(db.doc(`${root}/trainingDeliveryStatuses/${id}`), { schemaVersion: 1, id, workoutId: name, planId, provider: 'garmin', status,
        differsFromQS: true, hasRemoteCopy: false, timeZone: 'UTC', approvalDigest: null, issues: ['private-canary'],
        lastAttemptAtMs: now, lastAcceptedAtMs: null, retryCount: 8, nextRetryAtMs: null, updatedAtMs: clock });
      batch.set(db.doc(`${root}/trainingDeliveryLedger/${id}`), { id, workoutId: name, planId, provider: 'garmin', status,
        desiredGeneration: 1, settingsRevision: 1, destinationKey, connectionEpoch: 0, updatedAtMs: clock });
      if (planId === null) batch.set(db.doc(`${root}/trainingDeliverySettings/workout_${name}_garmin`), { ...setting, scope: 'workout', scopeId: name });
      await batch.commit(); return { id, status, observedAt: clock };
    };
    const deps: TrainingPushDependencies = { db, now: () => clock, configuration: vi.fn(async () => ({ enabled: true, publicKey: key })),
      send: vi.fn(async () => ({})), outcome: vi.fn() };
    return { root, state, seed, deps, registration,
      advance: (ms = TRAINING_PUSH.groupMs) => { clock += ms; },
      observe: (candidate: TrainingCandidate) => observeTrainingNotification('owner', candidate, deps),
      send: () => sendTrainingNotification('owner', deps) };
  }
  it('groups twenty workouts and deduplicates competing admissions and claims', async () => {
    const h = await setup(), candidate = await h.seed(); await Promise.all([h.observe(candidate), h.observe(candidate)]);
    for (let i = 1; i < 20; i++) await h.observe(await h.seed(`workout${i}`));
    expect((await h.state.get()).data()?.pending.entries).toHaveLength(20);
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); h.advance();
    await Promise.all([h.send(), h.send()]); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    expect((await h.state.get()).data()?.attempts).toHaveLength(1);
    expect(JSON.parse(vi.mocked(h.deps.send).mock.calls[0][1]).notification.navigate).toBe(origin + '/training/plans?sync=attention');
    expect(vi.mocked(h.deps.send).mock.calls[0][1]).not.toMatch(/private-canary|"workout"|destination/);
  }, 30000);
  it('notifies standalone workouts too', async () => {
    const h = await setup(); await h.observe(await h.seed('standalone', 'failed', null)); h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it('keeps a current sync problem eligible after an unrelated plan title edit', async () => {
    const h = await setup(), candidate = await h.seed(); await h.observe(candidate);
    h.advance(); await db.doc(`${h.root}/trainingPlans/plan`).update({ name: 'Renamed plan', updatedAtMs: h.deps.now() });
    await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it.each(['before admission', 'before claim', 'before transport'])('suppresses another provider’s completed workout %s', async stage => {
    const h = await setup(), candidate = await h.seed();
    const complete = () => db.doc(`${h.root}/trainingWorkoutCompletions/workout`).set({ schemaVersion: 1,
      workoutId: 'workout', planId: 'plan', provider: 'suunto', matchMethod: 'provider_marker',
      eventId: 'private-recording', activityId: null, sourceSessionIndex: null, activityStartAtMs: now,
      scheduledLocalDate: '2026-11-07', workoutRevisionAtLink: 1, timing: 'early', linkedAtMs: now, updatedAtMs: now });
    if (stage === 'before admission') await complete();
    await h.observe(candidate);
    if (stage === 'before claim') await complete();
    if (stage === 'before transport') {
      const original = db.runTransaction.bind(db);
      vi.spyOn(db, 'runTransaction').mockImplementationOnce(async callback => {
        const result = await original(callback); await complete(); return result;
      });
    }
    h.advance(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
    if (stage === 'before admission') expect((await h.state.get()).exists).toBe(false);
  });
  it('treats connection failure across new workouts as one unresolved incident, with surviving alternatives', async () => {
    const h = await setup(); await h.observe(await h.seed('first', 'reconnect_required'));
    await h.observe(await h.seed('second', 'reconnect_required'));
    await db.doc(`${h.root}/scheduledWorkouts/first`).update({ lifecycle: 'skipped' });
    h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    h.advance(TRAINING_PUSH.cooldownMs); await h.observe(await h.seed('new-workout', 'connection_repair'));
    h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    await db.doc(`${h.root}/meta/${ServiceNames.GarminAPI}`).update({ connectionStateGeneration: 'reconnected' });
    await h.observe(await h.seed('new-workout', 'connection_repair')); h.advance(); await h.send();
    expect(h.deps.send).toHaveBeenCalledTimes(2);
  });
  it('keeps one unresolved episode through retries and allows a later confirmed recovery to reset it', async () => {
    const h = await setup(); await h.observe(await h.seed()); h.advance(); await h.send();
    h.advance(TRAINING_PUSH.cooldownMs); await h.observe(await h.seed()); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    const recovered = await h.seed('workout', 'delivered');
    await db.doc(`${h.root}/trainingDeliveryStatuses/${recovered.id}`).update({ hasRemoteCopy: true, differsFromQS: false, lastAcceptedAtMs: h.deps.now() });
    await h.observe(recovered); await h.observe(await h.seed()); h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(2);
  });
  it.each(['retrying', 'pending', 'paused_plan', 'paused_pro', 'outside_horizon', 'past', 'completed', 'unsupported'])('does not notify %s', async status => {
    const h = await setup(); await h.observe(await h.seed('workout', status)); expect((await h.state.get()).exists).toBe(false);
  });
  it.each(['category', 'stop', 'pause', 'edit', 'disconnect', 'reconnect', 'account', 'deletion', 'registration', 'midnight', 'restore'])('cancels queued attention after %s', async reason => {
    const h = await setup(), candidate = await h.seed(); await h.observe(candidate);
    if (reason === 'category') await db.doc(`${h.root}/notificationPreferences/training_sync`).set({ schemaVersion: 1, enabled: true, revision: 2 });
    if (reason === 'stop') await db.doc(`${h.root}/trainingDeliverySettings/plan_plan_garmin`).update({ enabled: false });
    if (reason === 'pause') await db.doc(`${h.root}/trainingPlans/plan`).update({ lifecycle: 'paused' });
    if (reason === 'edit') await db.doc(`${h.root}/scheduledWorkouts/workout`).update({ updatedAtMs: now + 1 });
    if (reason === 'disconnect') await db.doc(`${h.root}/trainingDeliveryState/current`).update({ connectionEpochs: { garmin: 1 } });
    if (reason === 'reconnect') await db.doc(`${h.root}/meta/${ServiceNames.GarminAPI}`).update({ connectionStateGeneration: 'replacement' });
    if (reason === 'account') await db.doc(`${h.root}/meta/${ServiceNames.GarminAPI}`).update({ providerUserId: 'another-account' });
    if (reason === 'deletion') await db.doc('userDeletionTombstones/owner').set({});
    if (reason === 'registration') await db.doc(`${h.root}/pushSubscriptions/${device}`).update({ generation: randomUUID() });
    if (reason === 'midnight') h.advance(2 * TRAINING_PUSH.dayMs);
    if (reason === 'restore') await db.doc(`${h.root}/trainingPlanState/current/planDeletionLocks/_bulk_restore`).set({});
    h.advance(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('delivers to beta and prod and deduplicates aliases with one shared daily budget', async () => {
    const h = await setup(); await db.doc(`${h.root}/pushSubscriptions/${randomUUID()}`).set(h.registration);
    await db.doc(`${h.root}/pushSubscriptions/${randomUUID()}`).set({ ...h.registration, origin: 'https://beta.quantified-self.io', endpoint: 'https://web.push.apple.com/beta' });
    await h.observe(await h.seed()); h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(2);
    expect((await h.state.get()).data()?.attempts).toHaveLength(1);
    for (const [target, payload] of vi.mocked(h.deps.send).mock.calls) expect(JSON.parse(payload).notification.navigate).toBe(target.origin + '/training/plans?sync=attention');
  });
  it('claims before ambiguous transport failure and never replays that attempt', async () => {
    const h = await setup(); vi.mocked(h.deps.send).mockRejectedValue({ statusCode: 503 });
    const candidate = await h.seed(); await h.observe(candidate); h.advance(); await h.send();
    await h.observe(candidate); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce(); expect(h.deps.outcome).toHaveBeenCalledWith('failed');
  });
  it.each(['category', 'stop', 'device', 'deletion'])('rechecks %s after claiming and before transport', async reason => {
    const h = await setup(); await h.observe(await h.seed()); h.advance();
    const original = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementationOnce(async callback => {
      const result = await original(callback);
      if (reason === 'category') await db.doc(`${h.root}/notificationPreferences/training_sync`).set({ schemaVersion: 1, enabled: false, revision: 1 });
      if (reason === 'stop') await db.doc(`${h.root}/trainingDeliverySettings/plan_plan_garmin`).update({ enabled: false });
      if (reason === 'device') await db.doc(`${h.root}/pushSubscriptions/${device}`).update({ generation: randomUUID() });
      if (reason === 'deletion') await db.doc('userDeletionTombstones/owner').set({});
      return result;
    });
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('does not close a newer issue with an out-of-order success event', async () => {
    const h = await setup(); const recovered = await h.seed('workout', 'delivered');
    await h.observe(await h.seed()); h.advance(); await h.observe(recovered); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it('expires only the attempted registration generation', async () => {
    const h = await setup(); await h.observe(await h.seed()); h.advance();
    vi.mocked(h.deps.send).mockImplementation(async () => {
      await db.doc(`${h.root}/pushSubscriptions/${device}`).update({ generation: '00000000-0000-4000-8000-000000000003' });
      throw { statusCode: 410 };
    });
    await h.send(); expect((await db.doc(`${h.root}/pushSubscriptions/${device}`).get()).data()?.generation).toBe('00000000-0000-4000-8000-000000000003');
    expect(h.deps.outcome).toHaveBeenCalledWith('expired');
  });
  it('discards capped issues permanently, including after the daily budget resets', async () => {
    const h = await setup();
    for (let i = 0; i < TRAINING_PUSH.dailyLimit; i++) {
      await h.observe(await h.seed(`workout${i}`)); h.advance(); await h.send(); h.advance(TRAINING_PUSH.cooldownMs);
    }
    const capped = await h.seed('capped'); await h.observe(capped); expect((await h.state.get()).data()).not.toHaveProperty('trainingDueAt');
    h.advance(TRAINING_PUSH.dayMs); await h.observe(await h.seed('capped')); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(2);
  });
  it('does not resurrect deleted users or admit old, malformed, disabled or category-off events', async () => {
    const h = await setup(), candidate = await h.seed();
    await h.observe({ ...candidate, id: '../escape' }); await h.observe({ ...candidate, observedAt: now - 2 * TRAINING_PUSH.dayMs });
    vi.mocked(h.deps.configuration).mockResolvedValueOnce({ enabled: false, publicKey: key }); await h.observe(candidate);
    await db.doc(`${h.root}/notificationPreferences/training_sync`).set({ schemaVersion: 1, enabled: false, revision: 1 }); await h.observe(candidate);
    expect((await h.state.get()).exists).toBe(false);
    await db.doc(h.root).delete(); await h.observe(candidate); expect((await h.state.get()).exists).toBe(false);
  });
});
