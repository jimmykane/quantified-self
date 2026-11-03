import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { ACTIVITY_PUSH, activityNotificationPayload, liveActivitySource, type ActivityPushCandidate } from './activity-policy';
import { admitActivityNotification, sendActivityNotification, type ActivityPushDependencies } from './activity-service';

const now = Date.UTC(2026, 10, 3, 12), publicKey = 'B' + 'A'.repeat(86), origin = 'https://quantified-self.io';
const id = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
function harness() {
  let clock = now;
  const rows = new Map<string, any>([['users/owner', {}], [`users/owner/pushSubscriptions/${id}`, {
    schemaVersion: 1, generation, origin, vapidPublicKey: publicKey, endpoint: 'https://web.push.apple.com/private-canary',
    keys: { p256dh: publicKey, auth: 'A'.repeat(22) },
  }]]);
  let lock = Promise.resolve(); let commits = 0;
  const hooks: { afterCommit(count: number): void; beforeRead(path: string): void } = { afterCommit: () => {}, beforeRead: () => {} };
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const collection = (path: string) => ({ path, doc: (uid: string) => ({ path: `${path}/${uid}` }),
    where: (_field: string, _op: string, value: string) => ({ limit: (limit: number) => ({ query: path, value, limit }) }) });
  const db = { doc: (path: string) => ({ path }), collection,
    runTransaction: (fn: (tx: any) => Promise<unknown>) => {
      const operation = lock.then(async () => {
        const writes: (() => void)[] = [];
        const tx = {
          get: async (ref: any) => {
            if (writes.length) throw new Error('Read after write');
            hooks.beforeRead(ref.path ?? ref.query);
            if (ref.query) return { docs: [...rows.keys()].filter(path => path.startsWith(ref.query + '/') && rows.get(path).origin === ref.value)
              .slice(0, ref.limit).map(snapshot) };
            return snapshot(ref.path);
          },
          getAll: async (ref: any, options: any) => {
            expect(options).toEqual({ fieldMask: ['startDate', 'endDate'] });
            if (writes.length) throw new Error('Read after write'); return [snapshot(ref.path)];
          },
          set: ({ path }: any, value: unknown) => writes.push(() => rows.set(path, structuredClone(value))),
          delete: ({ path }: any) => writes.push(() => rows.delete(path)),
        };
        const result = await fn(tx); writes.forEach(write => write()); hooks.afterCommit(++commits); return result;
      }); lock = operation.then(() => undefined, () => undefined); return operation;
    },
  } as unknown as Firestore;
  const deps: ActivityPushDependencies = { db, now: () => clock, configuration: vi.fn(async () => ({ enabled: true, publicKey })),
    send: vi.fn(async () => ({})), outcome: vi.fn() };
  const seed = (eventID = 'event', service = ServiceNames.SuuntoApp): ActivityPushCandidate => {
    const candidate = { eventID, service, queueId: eventID, queueCreatedAt: clock, queueRevision: null,
      startMs: clock - 3600000, endMs: clock - 60000, connectedAtMs: now - ACTIVITY_PUSH.recentMs };
    const providerField = { [ServiceNames.SuuntoApp]: 'userName', [ServiceNames.COROSAPI]: 'openId',
      [ServiceNames.WahooAPI]: 'wahooUserID', [ServiceNames.GarminAPI]: 'userID' }[service];
    rows.set(`${getServiceWorkoutQueueName(service)}/${eventID}`, { activityNotificationOrigin: 'live', dateCreated: clock, [providerField]: 'account', firebaseUserID: 'owner' });
    rows.set(`users/owner/events/${eventID}`, { startDate: candidate.startMs, endDate: candidate.endMs });
    rows.set(`users/owner/meta/${service}`, { connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'account' });
    return candidate;
  };
  const candidate = seed();
  return { rows, deps, hooks, seed, candidate, advance: (ms = ACTIVITY_PUSH.groupMs) => { clock += ms; },
    admit: (value = candidate) => admitActivityNotification('owner', value, deps), send: () => sendActivityNotification('owner', deps),
    state: () => rows.get('users/owner/pushState/activitySync'),
    queue: (value = candidate) => rows.get(`${getServiceWorkoutQueueName(value.service)}/${value.queueId}`),
    meta: (value = candidate) => rows.get(`users/owner/meta/${value.service}`),
    preference: (enabled: boolean, revision: number) => rows.set('users/owner/notificationPreferences/activity_sync', { schemaVersion: 1, enabled, revision }),
  };
}

describe('new activity notifications', () => {
  it('batches twenty new activities across providers into one generic declarative/worker-compatible alert', async () => {
    const h = harness();
    const services = [ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.GarminAPI, ServiceNames.WahooAPI];
    await Promise.all(Array.from({ length: 20 }, (_, i) => h.admit(h.seed(`event${i}`, services[i % 4]))));
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); h.advance();
    await Promise.all([h.send(), h.send(), h.send()]); expect(h.deps.send).toHaveBeenCalledOnce();
    const payload = JSON.parse(vi.mocked(h.deps.send).mock.calls[0][1]);
    expect(payload).toMatchObject({ web_push: 8030, notification: { body: expect.stringContaining('20 new activities'),
      tag: 'qs-activity-sync', renotify: false, navigate: origin + '/activities', icon: origin + '/assets/favicons/android-chrome-192x192.png' } });
    expect(payload.notification.data.onActionClick.default.url).toBe('/activities');
    expect(JSON.stringify(payload)).not.toMatch(/private-canary|account|event1|distance|pace|Suunto/);
    expect(h.state().pending).toBeUndefined(); expect(h.state().attempts).toHaveLength(1);
  });
  it('opens the private details of a single canonical activity', async () => {
    const h = harness(); await h.admit(); h.advance(); await h.send();
    expect(JSON.parse(vi.mocked(h.deps.send).mock.calls[0][1]).notification.navigate).toBe(origin + '/user/owner/event/event');
  });
  it('deduplicates concurrent admissions and retains suppression after a deleted workout is recreated', async () => {
    const h = harness(); await Promise.all([h.admit(), h.admit(), h.admit()]);
    expect(h.state().pending.entries).toHaveLength(1); h.advance(); await h.send(); h.advance(ACTIVITY_PUSH.cooldownMs);
    await h.admit(h.seed()); h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it.each(['unknown source', 'manual history', 'OAuth history', 'old backlog', 'future workout', 'future queue', 'invalid time',
    'before connection', 'missing connection time', 'reconnect backlog', 'manual provider upload', 'provider edit',
    'wrong owner', 'wrong provider account', 'wrong queue revision', 'wrong queue date', 'missing event', 'changed event',
    'disconnected', 'missing generation', 'deleted account', 'missing account', 'off', 'malformed preference', 'no devices', 'only beta', 'wrong key', 'disabled'])('rejects %s at admission', async reason => {
    const h = harness(); const q = h.queue(), m = h.meta(), c = h.candidate;
    if (reason === 'unknown source') delete q.activityNotificationOrigin;
    if (reason === 'manual history') q.fromHistory = true;
    if (reason === 'OAuth history') q.connectionHistoryRunId = 'history';
    if (reason === 'old backlog') c.endMs = now - ACTIVITY_PUSH.recentMs - 1;
    if (reason === 'future workout') c.endMs = now + 1;
    if (reason === 'future queue') q.dateCreated = c.queueCreatedAt = now + 1;
    if (reason === 'invalid time') c.startMs = NaN;
    if (reason === 'before connection') c.connectedAtMs = c.startMs;
    if (reason === 'missing connection time') c.connectedAtMs = NaN;
    if (reason === 'reconnect backlog') m.activityNotificationConnectedAtMs = now;
    if (reason === 'manual provider upload') q.manual = true;
    if (reason === 'provider edit') q.edited = true;
    if (reason === 'wrong owner') q.firebaseUserID = 'other';
    if (reason === 'wrong provider account') m.providerUserId = 'other';
    if (reason === 'wrong queue revision') q.queueRevision = 'newer';
    if (reason === 'wrong queue date') q.dateCreated++;
    if (reason === 'missing event') h.rows.delete('users/owner/events/event');
    if (reason === 'changed event') h.rows.set('users/owner/events/event', { startDate: c.startMs, endDate: c.endMs + 1 });
    if (reason === 'disconnected') m.connectionState = 'reconnect_required';
    if (reason === 'missing generation') delete m.connectionStateGeneration;
    if (reason === 'deleted account') h.rows.set('userDeletionTombstones/owner', {});
    if (reason === 'missing account') h.rows.delete('users/owner');
    if (reason === 'off') h.preference(false, 1);
    if (reason === 'malformed preference') h.rows.set('users/owner/notificationPreferences/activity_sync', {});
    if (reason === 'no devices') h.rows.delete(`users/owner/pushSubscriptions/${id}`);
    if (reason === 'only beta') h.rows.get(`users/owner/pushSubscriptions/${id}`).origin = 'https://beta.quantified-self.io';
    if (reason === 'wrong key') h.rows.get(`users/owner/pushSubscriptions/${id}`).vapidPublicKey = 'B' + 'Z'.repeat(86);
    if (reason === 'disabled') vi.mocked(h.deps.configuration).mockResolvedValue({ enabled: false, publicKey });
    await h.admit(); expect(h.state()).toBeUndefined();
  });
  it.each(['fromHistory', 'suppressAutomaticActivitySync', 'activitySyncCutoffMs', 'activityNotificationHistoryEndMs', 'connectionHistoryImport'])('rejects Garmin history using %s even when the file is recent', async field => {
    const h = harness(); const c = h.seed('garmin', ServiceNames.GarminAPI);
    if (field === 'fromHistory' || field === 'suppressAutomaticActivitySync') h.queue(c)[field] = true;
    else h.meta(c)[field] = field === 'connectionHistoryImport' ? { endMs: now + 86400000 } : now + 86400000;
    await h.admit(c); expect(h.state()).toBeUndefined();
  });
  it.each(['off then on', 'registration rotated', 'registration removed', 'reconnected', 'disconnected', 'queue correction', 'history reclassified', 'event removed', 'account deleted', 'disabled', 'stale batch'])('cancels pending work after %s', async reason => {
    const h = harness(); await h.admit(); h.advance();
    if (reason === 'off then on') h.preference(true, 2);
    if (reason === 'registration rotated') h.rows.get(`users/owner/pushSubscriptions/${id}`).generation = id;
    if (reason === 'registration removed') h.rows.delete(`users/owner/pushSubscriptions/${id}`);
    if (reason === 'reconnected') h.meta().connectionStateGeneration = 'replacement';
    if (reason === 'disconnected') h.meta().connectionState = 'disconnect_pending';
    if (reason === 'queue correction') h.queue().queueRevision = 'replacement';
    if (reason === 'history reclassified') h.queue().fromHistory = true;
    if (reason === 'event removed') h.rows.delete('users/owner/events/event');
    if (reason === 'account deleted') h.rows.set('userDeletionTombstones/owner', {});
    if (reason === 'disabled') vi.mocked(h.deps.configuration).mockResolvedValue({ enabled: false, publicKey });
    if (reason === 'stale batch') h.advance(ACTIVITY_PUSH.batchExpiryMs + 1);
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('off/on discards the previous pending batch when new work arrives', async () => {
    const h = harness(); await h.admit(); h.preference(true, 2); await h.admit(h.seed('new'));
    expect(h.state().pending.entries.map((e: any) => e.eventID)).toEqual(['new']); h.advance(); await h.send();
    expect(vi.mocked(h.deps.send).mock.calls[0][1]).not.toContain('/event/event');
  });
  it('rechecks consent after claim commit and never replays the cancelled batch', async () => {
    const h = harness(); await h.admit(); h.advance();
    h.hooks.afterCommit = count => { if (count === 2) h.preference(false, 1); };
    await h.send(); h.preference(true, 2); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('does not replay a claim whose commit acknowledgement is lost', async () => {
    const h = harness(); await h.admit(); h.advance(); h.hooks.afterCommit = count => { if (count === 2) throw new Error('Lost acknowledgement'); };
    await expect(h.send()).rejects.toThrow(); h.hooks.afterCommit = () => {}; await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('drops cooldown arrivals without delaying them into a later alert and caps all providers at four attempts per rolling day', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) {
      await h.admit(h.seed(`eligible${i}`, i % 2 ? ServiceNames.GarminAPI : ServiceNames.WahooAPI)); h.advance(); await h.send();
      await h.admit(h.seed(`cooldown${i}`)); expect(h.state().pending).toBeUndefined(); h.advance(ACTIVITY_PUSH.cooldownMs);
    }
    expect(h.deps.send).toHaveBeenCalledTimes(4); expect(h.state().attempts).toHaveLength(4);
    h.advance(ACTIVITY_PUSH.dayMs); await h.admit(h.seed('next-day')); h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(5);
  });
  it('bounds batches, duplicate receipts and device fan-out', async () => {
    const h = harness();
    for (let i = 0; i < 260; i++) await h.admit(h.seed(`event${i}`));
    expect(h.state().pending.entries).toHaveLength(50); expect(h.state().seen).toHaveLength(256);
    h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it.each([410, 500])('never retries an external transport failure (%s), pruning only an expired matching registration', async statusCode => {
    const h = harness(); vi.mocked(h.deps.send).mockRejectedValue({ statusCode }); await h.admit(); h.advance(); await h.send(); await h.send();
    expect(h.deps.send).toHaveBeenCalledOnce(); expect(h.rows.has(`users/owner/pushSubscriptions/${id}`)).toBe(statusCode !== 410);
    expect(h.deps.outcome).toHaveBeenCalledWith(statusCode === 410 ? 'expired' : 'failed');
  });
  it('does not prune a registration replaced during an expired send', async () => {
    const h = harness(); vi.mocked(h.deps.send).mockImplementation(async () => { h.rows.get(`users/owner/pushSubscriptions/${id}`).generation = id; throw { statusCode: 410 }; });
    await h.admit(); h.advance(); await h.send(); expect(h.rows.get(`users/owner/pushSubscriptions/${id}`).generation).toBe(id);
  });
  it.each([true, false])('isolates either device transport failure during fan-out (first=%s)', async firstFails => {
    const h = harness(); const second = '00000000-0000-4000-8000-000000000003';
    h.rows.set(`users/owner/pushSubscriptions/${second}`, { ...h.rows.get(`users/owner/pushSubscriptions/${id}`), endpoint: 'https://web.push.apple.com/secondary' });
    vi.mocked(h.deps.send).mockImplementation(async registration => {
      if (registration.endpoint.endsWith('secondary') !== firstFails) throw { statusCode: 500 };
      return {};
    });
    await h.admit(); h.advance(); await h.send(); await h.send();
    expect(new Set(vi.mocked(h.deps.send).mock.calls.map(([registration]) => registration.endpoint)))
      .toEqual(new Set(['https://web.push.apple.com/private-canary', 'https://web.push.apple.com/secondary']));
    expect(h.deps.outcome).toHaveBeenCalledWith('accepted'); expect(h.deps.outcome).toHaveBeenCalledWith('failed');
    expect(h.deps.send).toHaveBeenCalledTimes(2); expect(h.state().attempts).toHaveLength(1);
  });
  it('snapshots at most ten production devices and never transfers an old batch to a later installation', async () => {
    const h = harness(); const registration = h.rows.get(`users/owner/pushSubscriptions/${id}`);
    for (let n = 3; n < 15; n++) h.rows.set(`users/owner/pushSubscriptions/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      { ...registration, endpoint: `https://web.push.apple.com/device${n}` });
    await h.admit(); expect(h.state().pending.targets).toHaveLength(10);
    h.rows.set('users/owner/pushSubscriptions/00000000-0000-4000-8000-000000000099', { ...registration, endpoint: 'https://web.push.apple.com/later' });
    h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(10);
    expect(vi.mocked(h.deps.send).mock.calls.some(([target]) => target.endpoint.endsWith('/later'))).toBe(false);
  });
  it.each([
    { phase: 'preparation', failedDevice: id },
    { phase: 'preparation', failedDevice: '00000000-0000-4000-8000-000000000006' },
    { phase: 'cleanup', failedDevice: id },
    { phase: 'cleanup', failedDevice: '00000000-0000-4000-8000-000000000006' },
  ])('finishes every device wave despite $phase failure for $failedDevice, without replay', async ({ phase, failedDevice }) => {
    const h = harness(); const registration = h.rows.get(`users/owner/pushSubscriptions/${id}`);
    const devices = [id, ...Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 3).padStart(12, '0')}`)];
    for (const device of devices) h.rows.set(`users/owner/pushSubscriptions/${device}`,
      { ...registration, endpoint: `https://web.push.apple.com/${device}` });
    let expired = false;
    const completed = new Set<string>();
    vi.mocked(h.deps.send).mockImplementation(async target => {
      const device = target.endpoint.split('/').at(-1)!;
      if (phase === 'cleanup' && device === failedDevice) { expired = true; throw { statusCode: 410 }; }
      await new Promise(resolve => setTimeout(resolve, 0));
      completed.add(device); return {};
    });
    await h.admit(); h.advance();
    h.hooks.beforeRead = path => {
      if (path === `users/owner/pushSubscriptions/${failedDevice}` && (phase === 'preparation' || expired)) {
        throw new Error('private-canary database failure');
      }
    };
    await expect(h.send()).rejects.toThrow('Activity notification device processing failed.');
    expect(completed).toEqual(new Set(devices.filter(device => device !== failedDevice)));
    expect(new Set(vi.mocked(h.deps.send).mock.calls.map(([target]) => target.endpoint.split('/').at(-1))))
      .toEqual(new Set(devices.filter(device => phase === 'cleanup' || device !== failedDevice)));
    const attempts = vi.mocked(h.deps.send).mock.calls.length;
    h.hooks.beforeRead = () => {}; await h.send();
    expect(h.deps.send).toHaveBeenCalledTimes(attempts);
    expect(h.state().pending).toBeUndefined(); expect(h.state().attempts).toHaveLength(1);
  });
  it('accepts exactly 48-hour-old completed workouts and rejects beta payloads', () => {
    const h = harness(); h.candidate.startMs = now - ACTIVITY_PUSH.recentMs - 1000; h.candidate.endMs = now - ACTIVITY_PUSH.recentMs;
    h.candidate.connectedAtMs = now - ACTIVITY_PUSH.recentMs - 10000;
    expect(liveActivitySource('owner', h.candidate, h.queue(), h.meta(), now)).toBe(true);
    expect(() => activityNotificationPayload('https://beta.quantified-self.io', 'owner', [{ ...h.candidate, connectionGeneration: 'connection' }])).toThrow();
  });
});
