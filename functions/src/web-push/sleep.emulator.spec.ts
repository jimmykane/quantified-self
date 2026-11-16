import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { SLEEP_PROVIDERS, SLEEP_SESSIONS_COLLECTION_ID, SLEEP_SYNC_STATE_COLLECTION_ID } from '../../../shared/sleep';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { admitSleepNotification, sendSleepNotification, type SleepPushDependencies } from './sleep-service';
import { SLEEP_SERVICE_NAMES, type SleepPushCandidate } from './sleep-policy';

const now = Date.UTC(2026, 10, 16, 8), publicKey = 'B' + 'A'.repeat(86), origin = 'https://quantified-self.io';
const id = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('sleep notification Firestore transactions', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required');
  let db: Firestore;
  beforeEach(() => { db = new Firestore({ projectId: `demo-sleep-push-${randomUUID().slice(0, 8)}` }); });
  afterEach(async () => { await db.terminate(); });
  async function seed() {
    const batch = db.batch(); batch.set(db.doc('users/owner'), {});
    batch.set(db.doc(`users/owner/pushSubscriptions/${id}`), { schemaVersion: 1, generation, origin, vapidPublicKey: publicKey,
      endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: publicKey, auth: 'A'.repeat(22) } });
    const entries = [SLEEP_PROVIDERS.GarminAPI, SLEEP_PROVIDERS.SuuntoApp, SLEEP_PROVIDERS.COROSAPI].map(provider => {
      const candidate: SleepPushCandidate = { sessionId: provider, provider, providerUserId: 'account', sleepDate: '2026-11-16',
        startMs: now - 8 * 3600000, endMs: now - 60000, createdAtMs: now };
      const queue = { id: provider, type: provider === SLEEP_PROVIDERS.GarminAPI ? 'garmin_push' : provider === SLEEP_PROVIDERS.SuuntoApp ? 'suunto_poll' : 'coros_poll',
        provider, providerUserId: 'account', userID: 'owner', dateCreated: now, sleepNotificationOrigin: 'live' } as SleepSyncQueueItemInterface;
      batch.set(db.doc(`sleepSyncQueue/${queue.id}`), queue);
      batch.set(db.doc(`users/owner/meta/${SLEEP_SERVICE_NAMES[provider]}`), { connectionState: 'connected', connectionStateGeneration: 'connection',
        providerUserId: 'account', activityNotificationConnectedAtMs: now - 48 * 3600000 });
      batch.set(db.doc(`users/owner/${SLEEP_SESSIONS_COLLECTION_ID}/${candidate.sessionId}`), {
        startTimeMs: candidate.startMs, endTimeMs: candidate.endMs, createdAtMs: candidate.createdAtMs, isNap: false,
        source: { provider, providerUserId: 'account' }, sleepDate: '2026-11-16',
        sportsLibData: { schemaVersion: 1, metrics: { privateValue: 'must-not-be-read' } },
      });
      return { candidate, queue };
    });
    await batch.commit();
    const deps: SleepPushDependencies = { db, now: () => now, configuration: async () => ({ enabled: true, publicKey }),
      send: vi.fn(async () => ({})), outcome: vi.fn() };
    return { entries, deps, state: db.doc('users/owner/pushState/sleepReady'),
      admit: () => Promise.all(entries.map(({ candidate, queue }) => admitSleepNotification('owner', candidate, queue, deps))),
      send: () => sendSleepNotification('owner', deps) };
  }
  it('admits one cross-provider night under contention and shares the existing dueAt index', async () => {
    const h = await seed(); await h.admit();
    const due = await db.collectionGroup('pushState').where('dueAt', '<=', now).orderBy('dueAt').limit(25).select('dueAt').get();
    expect(due.docs.map(doc => doc.ref.path)).toEqual([h.state.path]);
    await Promise.all([h.send(), h.send()]); expect(h.deps.send).toHaveBeenCalledOnce();
    expect((await h.state.get()).data()).not.toHaveProperty('dueAt');
    await h.admit(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  }, 30000);
  it('cancels queued sleep after an off/on category revision and retains the deduplication receipt', async () => {
    const h = await seed(); await h.admit();
    await db.doc('users/owner/notificationPreferences/sleep_sync').set({ schemaVersion: 1, enabled: true, revision: 2 });
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
    expect((await h.state.get()).data()).toMatchObject({ sleepDate: '2026-11-16' });
    expect((await h.state.get()).data()).not.toHaveProperty('pending');
  });
  it('does not admit initial connection or active history-import sleeps', async () => {
    const h = await seed();
    for (const { candidate } of h.entries) await db.doc(`users/owner/meta/${SLEEP_SERVICE_NAMES[candidate.provider]}`).update({
      activityNotificationConnectedAtMs: now, connectionHistoryImport: { active: true },
    });
    await h.admit(); expect((await h.state.get()).exists).toBe(false);
  });
  it('requires the lifecycle authority under the service name, not the Sleep provider identifier', async () => {
    const h = await seed(), { candidate, queue } = h.entries[0];
    await db.doc(`users/owner/meta/${ServiceNames.GarminAPI}`).delete();
    await db.doc(`users/owner/meta/${SLEEP_PROVIDERS.GarminAPI}`).set({ connectionState: 'connected',
      connectionStateGeneration: 'connection', providerUserId: 'account' });
    await admitSleepNotification('owner', candidate, queue, h.deps);
    expect((await h.state.get()).exists).toBe(false);
  });
  it.each(['before admission', 'before claim'])('fences normal Garmin callbacks when a direct backfill starts %s', async when => {
    const h = await seed(), { candidate, queue } = h.entries[0];
    if (when === 'before claim') await admitSleepNotification('owner', candidate, queue, h.deps);
    await db.doc(`users/owner/${SLEEP_SYNC_STATE_COLLECTION_ID}/${candidate.provider}`).set({ lastBackfillEndMs: now });
    if (when === 'before admission') {
      await admitSleepNotification('owner', candidate, queue, h.deps);
      expect((await h.state.get()).exists).toBe(false);
    } else {
      await h.send(); expect((await h.state.get()).data()).not.toHaveProperty('pending');
    }
    expect(h.deps.send).not.toHaveBeenCalled();
  });
});
