import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import type { Firestore } from 'firebase-admin/firestore';
import { SLEEP_PROVIDERS, SLEEP_SESSIONS_COLLECTION_ID, SLEEP_SYNC_STATE_COLLECTION_ID, type SleepSession } from '../../../shared/sleep';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { admitSleepNotification, sendSleepNotification, type SleepPushDependencies } from './sleep-service';
import { liveSleepQueue, sleepPushCandidate, SLEEP_PUSH, SLEEP_SERVICE_NAMES, type SleepPushCandidate } from './sleep-policy';

const now = Date.UTC(2026, 10, 16, 8), publicKey = 'B' + 'A'.repeat(86), origin = 'https://quantified-self.io';
const id = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
function harness() {
  let clock = now, commits = 0, lock = Promise.resolve();
  const reads: string[] = [];
  const rows = new Map<string, any>([['users/owner', {}], [`users/owner/pushSubscriptions/${id}`, {
    schemaVersion: 1, generation, origin, vapidPublicKey: publicKey, endpoint: 'https://web.push.apple.com/private-canary',
    keys: { p256dh: publicKey, auth: 'A'.repeat(22) },
  }]]);
  const hooks = { afterCommit: (_count: number) => {} };
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const db = { doc: (path: string) => ({ path }), collection: (path: string) => ({
    doc: (id: string) => ({ path: `${path}/${id}` }),
    where: (_field: string, _op: string, values: string[]) => ({ limit: (limit: number) => ({ query: path, values, limit }) }),
  }), runTransaction: (fn: (tx: any) => Promise<unknown>) => {
    const operation = lock.then(async () => {
      const writes: (() => void)[] = [];
      const tx = {
        get: async (ref: any) => {
          if (writes.length) throw new Error('Read after write');
          reads.push(ref.path ?? ref.query);
          if (ref.query) return { docs: [...rows.keys()].filter(path => path.startsWith(ref.query + '/') && ref.values.includes(rows.get(path).origin))
            .slice(0, ref.limit).map(snapshot) };
          return snapshot(ref.path);
        },
        getAll: async (...args: any[]) => {
          if (writes.length) throw new Error('Read after write');
          const options = args.pop();
          expect(options.fieldMask).toEqual(['startTimeMs', 'endTimeMs', 'isNap', 'createdAtMs', 'source.provider', 'source.providerUserId', 'lastBackfillEndMs']);
          args.forEach(ref => reads.push(ref.path));
          return args.map(ref => snapshot(ref.path));
        },
        set: ({ path }: any, value: unknown) => writes.push(() => rows.set(path, structuredClone(value))),
        delete: ({ path }: any) => writes.push(() => rows.delete(path)),
      };
      const result = await fn(tx); writes.forEach(write => write()); hooks.afterCommit(++commits); return result;
    }); lock = operation.then(() => undefined, () => undefined); return operation;
  } } as unknown as Firestore;
  const deps: SleepPushDependencies = { db, now: () => clock, configuration: vi.fn(async () => ({ enabled: true, publicKey })),
    send: vi.fn(async () => ({})), outcome: vi.fn() };
  const seed = (provider = SLEEP_PROVIDERS.GarminAPI as SleepSession['source']['provider']) => {
    const candidate: SleepPushCandidate = { sessionId: provider, provider, providerUserId: 'account',
      sleepDate: new Date(clock).toISOString().slice(0, 10), startMs: clock - 8 * 3600000, endMs: clock - 60000, createdAtMs: clock };
    const queue = { id: provider, type: provider === SLEEP_PROVIDERS.GarminAPI ? 'garmin_push' : provider === SLEEP_PROVIDERS.SuuntoApp ? 'suunto_poll' : 'coros_poll',
      provider, providerUserId: 'account', userID: 'owner', dateCreated: clock, sleepNotificationOrigin: 'live' } as SleepSyncQueueItemInterface;
    rows.set(`sleepSyncQueue/${queue.id}`, structuredClone(queue));
    rows.set(`users/owner/${SLEEP_SESSIONS_COLLECTION_ID}/${candidate.sessionId}`, { startTimeMs: candidate.startMs, endTimeMs: candidate.endMs,
      createdAtMs: candidate.createdAtMs, isNap: false, source: { provider, providerUserId: 'account' } });
    rows.set(`users/owner/meta/${SLEEP_SERVICE_NAMES[provider]}`, { connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'account',
      activityNotificationConnectedAtMs: clock - 48 * 3600000 });
    return { candidate, queue };
  };
  const seedValue = seed();
  return { rows, reads, hooks, deps, seed, ...seedValue, advance: (ms = 86400000) => { clock += ms; },
    admit: (value = seedValue) => admitSleepNotification('owner', value.candidate, value.queue, deps),
    send: () => sendSleepNotification('owner', deps), state: () => rows.get('users/owner/pushState/sleepReady'),
    meta: () => rows.get(`users/owner/meta/${SLEEP_SERVICE_NAMES[seedValue.candidate.provider]}`),
    preference: (enabled: boolean, revision: number) => rows.set('users/owner/notificationPreferences/sleep_sync', { schemaVersion: 1, enabled, revision }),
  };
}

describe('sleep-ready notifications', () => {
  it('notifies beta and production devices once and contains no health metrics', async () => {
    const h = harness();
    h.rows.set('users/owner/pushSubscriptions/00000000-0000-4000-8000-000000000003', {
      ...h.rows.get(`users/owner/pushSubscriptions/${id}`), origin: 'https://beta.quantified-self.io', endpoint: 'https://web.push.apple.com/beta',
    });
    await h.admit(); await Promise.all([h.send(), h.send(), h.send()]);
    expect(h.deps.send).toHaveBeenCalledTimes(2);
    for (const [registration, body] of vi.mocked(h.deps.send).mock.calls) {
      expect(JSON.parse(body)).toMatchObject({ web_push: 8030, notification: { navigate: registration.origin + '/health?metric=sleep',
        tag: 'qs-sleep-sync', renotify: true, body: 'Your latest sleep is available. Open Quantified Self to view it.' } });
      expect(body).not.toMatch(/private-canary|account|Garmin|score|duration|2026/);
    }
    expect(h.state().pending).toBeUndefined(); expect(h.state().dueAt).toBeUndefined();
    await h.admit(); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(2);
  });
  it('deduplicates a night across providers, concurrent saves, recreated sessions and retrying queues', async () => {
    const h = harness(); const suunto = h.seed(SLEEP_PROVIDERS.SuuntoApp), coros = h.seed(SLEEP_PROVIDERS.COROSAPI);
    await Promise.all([h.admit(), h.admit(suunto), h.admit(coros)]); await h.send();
    h.advance(SLEEP_PUSH.cooldownMs); await h.admit(suunto); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it('only claims the sleep admitted by this import', async () => {
    const h = harness();
    const admittedId = await h.admit();
    expect(admittedId).toBeTruthy();
    await sendSleepNotification('owner', h.deps, 'superseded');
    expect(h.deps.send).not.toHaveBeenCalled();
    await sendSleepNotification('owner', h.deps, admittedId);
    expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it('allows the following night while suppressing a second night admitted too soon', async () => {
    const h = harness(); await h.admit(); await h.send(); h.advance(18 * 3600000);
    await h.admit(h.seed()); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    h.advance(6 * 3600000); await h.admit(h.seed()); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(2);
  });
  it('suppresses a late overlapping provider report even after cooldown and with a different calendar date', async () => {
    const h = harness(); await h.admit(); await h.send(); h.advance(21 * 3600000);
    const late = h.seed(SLEEP_PROVIDERS.SuuntoApp);
    late.candidate.startMs = h.candidate.startMs + 5 * 60000;
    late.candidate.endMs = h.candidate.endMs + 5 * 60000;
    h.rows.get(`users/owner/${SLEEP_SESSIONS_COLLECTION_ID}/${late.candidate.sessionId}`).startTimeMs = late.candidate.startMs;
    h.rows.get(`users/owner/${SLEEP_SESSIONS_COLLECTION_ID}/${late.candidate.sessionId}`).endTimeMs = late.candidate.endMs;
    await h.admit(late); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it('suppresses live webhook callbacks inside a directly requested Garmin sleep backfill range', async () => {
    const h = harness(); h.rows.set(`users/owner/${SLEEP_SYNC_STATE_COLLECTION_ID}/GarminAPI`, {
      lastBackfillStartMs: now - 30 * 86400000, lastBackfillEndMs: now,
    });
    await h.admit(); expect(h.state()).toBeUndefined();
  });
  it('allows the next main sleep that starts after the stored backfill cutoff', async () => {
    const h = harness(); h.rows.set(`users/owner/${SLEEP_SYNC_STATE_COLLECTION_ID}/GarminAPI`, {
      lastBackfillEndMs: h.candidate.startMs - 1,
    });
    await h.admit(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it('cancels a pending alert if a direct sleep backfill is requested before delivery', async () => {
    const h = harness(); await h.admit();
    h.rows.set(`users/owner/${SLEEP_SYNC_STATE_COLLECTION_ID}/GarminAPI`, { lastBackfillEndMs: now });
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); expect(h.state().pending).toBeUndefined();
  });
  it.each(['off', 'duplicate'])('skips device and session reads when admission is already suppressed: %s', async kind => {
    const h = harness();
    if (kind === 'off') h.preference(false, 1);
    else await h.admit();
    h.reads.length = 0;
    await h.admit();
    expect(h.reads).not.toContain('users/owner/pushSubscriptions');
    expect(h.reads).not.toContain(`users/owner/${SLEEP_SESSIONS_COLLECTION_ID}/${h.candidate.sessionId}`);
    expect(h.reads).not.toContain(`users/owner/meta/${SLEEP_SERVICE_NAMES[h.candidate.provider]}`);
  });
  it.each(['history', 'legacy', 'active history', 'initial backfill', 'reconnect', 'wrong queue', 'wrong account', 'wrong owner',
    'missing sleep', 'nap', 'missing generation', 'deleted user', 'off', 'malformed preference', 'no devices', 'disabled', 'stale preparation'])('rejects %s', async reason => {
    const h = harness(); const queue = h.rows.get(`sleepSyncQueue/${h.queue.id}`), meta = h.meta();
    if (reason === 'history') queue.connectionHistoryRunId = 'history';
    if (reason === 'legacy') delete h.queue.sleepNotificationOrigin;
    if (reason === 'active history') meta.connectionHistoryImport = { active: true };
    if (reason === 'initial backfill' || reason === 'reconnect') meta.activityNotificationConnectedAtMs = now;
    if (reason === 'wrong queue') queue.queueRevision = 'replacement';
    if (reason === 'wrong account') meta.providerUserId = 'different';
    if (reason === 'wrong owner') queue.userID = 'different';
    if (reason === 'missing sleep') h.rows.delete(`users/owner/${SLEEP_SESSIONS_COLLECTION_ID}/${h.candidate.sessionId}`);
    if (reason === 'nap') h.rows.get(`users/owner/${SLEEP_SESSIONS_COLLECTION_ID}/${h.candidate.sessionId}`).isNap = true;
    if (reason === 'missing generation') delete meta.connectionStateGeneration;
    if (reason === 'deleted user') h.rows.delete('users/owner');
    if (reason === 'off') h.preference(false, 1);
    if (reason === 'malformed preference') h.rows.set('users/owner/notificationPreferences/sleep_sync', {});
    if (reason === 'no devices') h.rows.delete(`users/owner/pushSubscriptions/${id}`);
    if (reason === 'disabled') vi.mocked(h.deps.configuration).mockResolvedValue({ enabled: false, publicKey });
    if (reason === 'stale preparation') h.advance(SLEEP_PUSH.expiryMs + 1);
    await h.admit(); expect(h.state()).toBeUndefined();
  });
  it.each(['off and on', 'removed device', 'replaced device', 'deleted sleep', 'updated end', 'disconnected', 'connection changed',
    'import started', 'deleted account', 'disabled', 'expired batch'])('cancels pending alerts after %s', async reason => {
    const h = harness(); await h.admit();
    if (reason === 'off and on') h.preference(true, 2);
    if (reason === 'removed device') h.rows.delete(`users/owner/pushSubscriptions/${id}`);
    if (reason === 'replaced device') h.rows.get(`users/owner/pushSubscriptions/${id}`).generation = '00000000-0000-4000-8000-000000000004';
    if (reason === 'deleted sleep') h.rows.delete(`users/owner/${SLEEP_SESSIONS_COLLECTION_ID}/${h.candidate.sessionId}`);
    if (reason === 'updated end') h.rows.get(`users/owner/${SLEEP_SESSIONS_COLLECTION_ID}/${h.candidate.sessionId}`).endTimeMs++;
    if (reason === 'disconnected') h.meta().connectionState = 'reconnect_required';
    if (reason === 'connection changed') h.meta().connectionStateGeneration = 'new';
    if (reason === 'import started') h.meta().connectionHistoryImport = { active: true };
    if (reason === 'deleted account') h.rows.delete('users/owner');
    if (reason === 'disabled') vi.mocked(h.deps.configuration).mockResolvedValue({ enabled: false, publicKey });
    if (reason === 'expired batch') h.advance(SLEEP_PUSH.expiryMs + 1);
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); expect(h.state()?.pending).toBeUndefined();
  });
  it('rechecks consent after claiming, before sending', async () => {
    const h = harness(); await h.admit(); h.hooks.afterCommit = count => { if (count === 2) h.preference(false, 1); };
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('rechecks direct backfills after claiming, before sending', async () => {
    const h = harness(); await h.admit(); h.hooks.afterCommit = count => {
      if (count === 2) h.rows.set(`users/owner/${SLEEP_SYNC_STATE_COLLECTION_ID}/GarminAPI`, { lastBackfillEndMs: now });
    };
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('never replays an ambiguous send and expires only the matching device generation', async () => {
    const h = harness(); await h.admit(); vi.mocked(h.deps.send).mockRejectedValue({ statusCode: 410 });
    await h.send(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    expect(h.rows.has(`users/owner/pushSubscriptions/${id}`)).toBe(false); expect(h.deps.outcome).toHaveBeenCalledWith('expired');
  });
  it('deduplicates endpoint aliases and continues after one device fails', async () => {
    const h = harness(), duplicate = '00000000-0000-4000-8000-000000000003', other = '00000000-0000-4000-8000-000000000004';
    h.rows.set(`users/owner/pushSubscriptions/${duplicate}`, { ...h.rows.get(`users/owner/pushSubscriptions/${id}`) });
    h.rows.set(`users/owner/pushSubscriptions/${other}`, { ...h.rows.get(`users/owner/pushSubscriptions/${id}`), endpoint: 'https://web.push.apple.com/other' });
    vi.mocked(h.deps.send).mockImplementation(async registration => { if (registration.endpoint.endsWith('private-canary')) throw new Error('transport'); });
    await h.admit(); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(2);
    expect(h.deps.outcome).toHaveBeenCalledWith('failed'); expect(h.deps.outcome).toHaveBeenCalledWith('accepted');
  });
});

describe('sleep eligibility', () => {
  it.each(['garmin_health_backfill', 'suunto_health_poll'])('never treats %s as a live sleep queue', type => {
    expect(liveSleepQueue({ type } as SleepSyncQueueItemInterface)).toBe(false);
  });
  it('rejects naps, future sleeps, old sleeps and malformed dates', () => {
    const session = { id: 'sleep', source: { provider: SLEEP_PROVIDERS.GarminAPI, providerUserId: 'account' }, sleepDate: '2026-11-16',
      startTimeMs: now - 8 * 3600000, endTimeMs: now - 60000, createdAtMs: now, durationSeconds: 28000, isNap: false } as SleepSession;
    expect(sleepPushCandidate(session, now)).not.toBeNull();
    for (const patch of [{ isNap: true }, { sleepDate: '2026-02-30' }, { sleepDate: '2099-01-01' }, { endTimeMs: now + 1 }, { durationSeconds: 0 },
      { startTimeMs: now - 2 * SLEEP_PUSH.recentMs, endTimeMs: now - SLEEP_PUSH.recentMs - 1 }]) {
      expect(sleepPushCandidate({ ...session, ...patch }, now)).toBeNull();
    }
  });
});
