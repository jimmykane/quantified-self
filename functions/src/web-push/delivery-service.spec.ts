import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import type { Firestore, Transaction, DocumentData } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { DELIVERY_PUSH, type DeliveryCandidate } from './delivery-policy';
import { admitDeliveryNotification, sendDeliveryNotification, type DeliveryPushDependencies } from './delivery-service';

const now = Date.UTC(2026, 10, 4, 12), key = 'B' + 'A'.repeat(86), origin = 'https://quantified-self.io';
const id = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
interface TestRef { path?: string; query?: string; field?: string; values?: unknown; max?: number; }
function harness() {
  let clock = now, commits = 0, lock = Promise.resolve();
  const rows = new Map<string, DocumentData>([['users/owner', {}]]);
  const hooks: { afterCommit(count: number): void; beforeRead(path: string): void } = { afterCommit: () => {}, beforeRead: () => {} };
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const query = (path: string, field: string, values: unknown, max = 100) => ({ query: path, field, values, max,
    limit: (size: number) => query(path, field, values, size), select: () => query(path, field, values, max) });
  const db = { doc: (path: string) => ({ path }), collection: (path: string) => ({
    doc: (id: string) => ({ path: `${path}/${id}` }), where: (field: string, _op: string, values: unknown) => query(path, field, values) }),
    runTransaction: (fn: (tx: Transaction) => Promise<unknown>) => {
      const run = lock.then(async () => {
        const writes: (() => void)[] = [];
        const read = async (ref: TestRef) => {
          if (writes.length) throw new Error('Read after write'); hooks.beforeRead(ref.path || ref.query);
          if (!ref.query) return snapshot(ref.path);
          const docs = [...rows.keys()].filter(path => path.startsWith(ref.query + '/') && path.split('/').length === ref.query.split('/').length + 1
            && (Array.isArray(ref.values) ? ref.values.includes(rows.get(path)[ref.field]) : rows.get(path)[ref.field] === ref.values)).slice(0, ref.max).map(snapshot);
          return { docs, empty: !docs.length };
        };
        const tx = { get: read, getAll: async (ref: TestRef, options: { fieldMask: string[] }) => {
          expect(options).toEqual({ fieldMask: ['startDate'] }); return [await read(ref)];
        }, set: ({ path }: TestRef, value: DocumentData) => writes.push(() => rows.set(path!, structuredClone(value))),
        delete: ({ path }: TestRef) => writes.push(() => rows.delete(path!)) };
        const result = await fn(tx as unknown as Transaction); writes.forEach(write => write()); hooks.afterCommit(++commits); return result;
      }); lock = run.then(() => undefined, () => undefined); return run;
    },
  } as unknown as Firestore;
  const deps: DeliveryPushDependencies = { db, now: () => clock, configuration: vi.fn(async () => ({ enabled: true, publicKey: key })), send: vi.fn(async () => ({})), outcome: vi.fn() };
  const register = (device = id, endpoint = device) => rows.set(`users/owner/pushSubscriptions/${device}`, { schemaVersion: 1, generation, origin, vapidPublicKey: key,
    endpoint: `https://web.push.apple.com/${endpoint}`, keys: { p256dh: key, auth: 'A'.repeat(22) } });
  register();
  const meta = { connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'account' };
  rows.set(`users/owner/meta/${ServiceNames.SuuntoApp}`, meta);
  const seed = (kind: 'manual' | 'automatic' = 'manual', ref = 'batch'): DeliveryCandidate => {
    const candidate = { kind, id: ref, createdAt: now - 3600000, completedAt: clock };
    if (kind === 'manual') {
      rows.set(`users/owner/activitySends/${ref}`, { state: 'complete', provider: 'suunto', source: 'files', createdAt: candidate.createdAt, updatedAt: clock, total: 20, finished: 20, notificationRequested: true });
      rows.set(`users/owner/activitySendOperations/${ref}`, { state: 'confirmed', provider: 'suunto', providerAccount: 'account', createdAt: candidate.createdAt,
        deliveryNotification: { installationId: id, generation, origin, categoryRevision: 0, connectionGeneration: 'connection' } });
    } else {
      rows.set(`failed_jobs/${ref}`, { id: ref, userID: 'owner', manual: false, deliveryMode: 'automatic', originalCollection: 'activitySyncQueue', eventID: ref,
        dateCreated: candidate.createdAt, failedAt: clock, destinationServiceName: ServiceNames.SuuntoApp, destinationProviderUserID: 'account', error: 'private-canary' });
      rows.set(`users/owner/events/${ref}`, { startDate: now - 3600000 });
    }
    return candidate;
  };
  const candidate = seed();
  return { rows, deps, hooks, seed, candidate, register, meta, advance: (ms = DELIVERY_PUSH.groupMs) => { clock += ms; },
    admit: (value = candidate) => admitDeliveryNotification('owner', value, deps), send: () => sendDeliveryNotification('owner', deps),
    state: () => rows.get('users/owner/pushState/activityDelivery'), batch: (ref = 'batch') => rows.get(`users/owner/activitySends/${ref}`),
    operation: () => rows.get('users/owner/activitySendOperations/batch'), preference: (enabled: boolean, revision = 1) => rows.set('users/owner/notificationPreferences/activity_delivery', { schemaVersion: 1, enabled, revision }) };
}

describe('activity delivery notifications', () => {
  it('sends a beta manual result only to the initiating beta device', async () => {
    const h = harness(); const beta = 'https://beta.quantified-self.io';
    h.rows.get(`users/owner/pushSubscriptions/${id}`).origin = beta;
    h.operation().deliveryNotification.origin = beta;
    h.register('00000000-0000-4000-8000-000000000003');
    await h.admit(); h.advance(); await h.send();
    expect(h.deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(h.deps.send).mock.calls[0][1]).notification.navigate).toBe(beta + '/send-activities/suunto?batch=batch&source=files');
  });
  it('sends automatic failures to both sites using one shared attempt', async () => {
    const h = harness(), betaId = '00000000-0000-4000-8000-000000000003'; h.register(betaId);
    h.rows.get(`users/owner/pushSubscriptions/${betaId}`).origin = 'https://beta.quantified-self.io';
    await h.admit(h.seed('automatic')); h.advance(); await h.send();
    expect(h.deps.send).toHaveBeenCalledTimes(2); expect(h.state().attempts).toHaveLength(1);
    for (const [registration, body] of vi.mocked(h.deps.send).mock.calls) {
      expect(JSON.parse(body).notification.navigate).toBe(registration.origin + '/services?serviceName=Suunto%20app');
    }
  });
  it('cancels a manual result when its registration changes site after admission', async () => {
    const h = harness(); await h.admit();
    h.rows.get(`users/owner/pushSubscriptions/${id}`).origin = 'https://beta.quantified-self.io';
    h.advance(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('sends one explicit batch result for twenty files, only to its chosen device', async () => {
    const h = harness(); h.register('00000000-0000-4000-8000-000000000003');
    await Promise.all([h.admit(), h.admit()]); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
    h.advance(); await Promise.all([h.send(), h.send()]); expect(h.deps.send).toHaveBeenCalledOnce();
    const payload = JSON.parse(vi.mocked(h.deps.send).mock.calls[0][1]);
    expect(payload.notification.navigate).toBe(origin + '/send-activities/suunto?batch=batch&source=files');
    expect(payload.notification.body).toContain('has finished'); expect(payload.notification.body).not.toMatch(/delivered|20/);
    expect(h.state().attempts).toHaveLength(1); expect(h.state().deliveryDueAt).toBeUndefined();
  });
  it('looks up the explicitly chosen device even beyond the automatic ten-device limit', async () => {
    const h = harness(); h.rows.delete(`users/owner/pushSubscriptions/${id}`);
    for (let n = 10; n < 22; n++) h.register(`00000000-0000-4000-8000-0000000000${n}`);
    h.register(); await h.admit(); h.advance(); await h.send();
    expect(h.deps.send).toHaveBeenCalledOnce(); expect(vi.mocked(h.deps.send).mock.calls[0][0].endpoint).toContain(id);
  });
  it('isolates device preparation failures and still awaits later device waves', async () => {
    const h = harness(); for (let n = 3; n < 9; n++) h.register(`00000000-0000-4000-8000-00000000000${n}`);
    await h.admit(h.seed('automatic', 'job')); h.advance();
    h.hooks.beforeRead = path => { if (path === `users/owner/pushSubscriptions/${id}`) throw new Error('private-canary'); };
    await expect(h.send()).rejects.toThrow('device processing failed'); expect(h.deps.send).toHaveBeenCalledTimes(6);
    h.hooks.beforeRead = () => {}; await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(6);
  });
  it('reports needs attention truthfully for a terminal batch containing issues', async () => {
    const h = harness(); h.rows.set('users/owner/activitySends/batch/rows/one', { status: 'needs_action' });
    await h.admit(); h.advance(); await h.send(); expect(vi.mocked(h.deps.send).mock.calls[0][1]).toContain('needs attention');
  });
  it('honours manual consent captured after a reconnect while the same-account draft was open', async () => {
    const h = harness(); Object.assign(h.meta, { activityNotificationConnectedAtMs: now - 1000, lastDisconnectedAt: now - 2000 });
    await h.admit(); h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
  });
  it('groups twenty automatic failures and includes no activity, provider error or health data', async () => {
    const h = harness(); await Promise.all(Array.from({ length: 20 }, (_, i) => h.admit(h.seed('automatic', `job${i}`))));
    h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    const payload = vi.mocked(h.deps.send).mock.calls[0][1]; expect(payload).toContain('needs attention');
    expect(payload).not.toMatch(/job\d|private-canary|heart|pace|distance/); expect(JSON.parse(payload).notification.navigate).toBe(origin + '/services');
  });
  it.each(['off', 'disabled', 'unchecked', 'pending', 'stopped', 'wrong category revision', 'wrong device', 'mismatched site', 'wrong connection', 'wrong account', 'deleted', 'old'])('suppresses %s manual results', async reason => {
    const h = harness();
    if (reason === 'off') h.preference(false);
    if (reason === 'disabled') vi.mocked(h.deps.configuration).mockResolvedValue({ enabled: false, publicKey: key });
    if (reason === 'unchecked') delete h.operation().deliveryNotification;
    if (reason === 'pending') h.batch().state = 'confirmed';
    if (reason === 'stopped') h.operation().stopped = true;
    if (reason === 'wrong category revision') h.preference(true, 2);
    if (reason === 'wrong device') h.operation().deliveryNotification.generation = '00000000-0000-4000-8000-000000000099';
    if (reason === 'mismatched site') h.operation().deliveryNotification.origin = 'https://beta.quantified-self.io';
    if (reason === 'wrong connection') h.meta.connectionStateGeneration = 'different';
    if (reason === 'wrong account') h.meta.providerUserId = 'other';
    if (reason === 'deleted') h.rows.set('userDeletionTombstones/owner', {});
    if (reason === 'old') h.advance(DELIVERY_PUSH.dayMs + 1);
    await h.admit(); h.advance(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it.each(['manual', 'historical', 'other queue', 'other owner', 'retried', 'success', 'deleted event', 'changed failure', 'reconnected'])('suppresses %s automatic work', async reason => {
    const h = harness(), c = h.seed('automatic', 'job'), failed = h.rows.get('failed_jobs/job');
    if (reason === 'manual') failed.manual = true;
    if (reason === 'historical') failed.deliveryMode = 'historical';
    if (reason === 'other queue') failed.originalCollection = 'workoutQueue';
    if (reason === 'other owner') failed.userID = 'other';
    if (reason === 'retried') h.rows.set('activitySyncQueue/job', { dateCreated: c.createdAt, processed: false });
    if (reason === 'success') h.rows.set('activitySyncQueue/job', { dateCreated: c.createdAt, processed: true, resultStatus: 'success' });
    if (reason === 'deleted event') h.rows.delete('users/owner/events/job');
    if (reason === 'changed failure') failed.failedAt++;
    if (reason === 'reconnected') Object.assign(h.meta, { activityNotificationConnectedAtMs: now });
    await h.admit(c); h.advance(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it.each(['off/on', 'stop', 'retry', 'replace device', 'delete', 'expire', 'reconnect'])('cancels %s between admission and sending', async reason => {
    const h = harness(); await h.admit();
    if (reason === 'off/on') h.preference(true, 2);
    if (reason === 'stop') h.batch().stopped = true;
    if (reason === 'retry') h.batch().state = 'confirmed';
    if (reason === 'replace device') h.rows.get(`users/owner/pushSubscriptions/${id}`).generation = '00000000-0000-4000-8000-000000000099';
    if (reason === 'delete') h.rows.delete('users/owner');
    if (reason === 'expire') h.advance(DELIVERY_PUSH.batchExpiryMs + 1);
    if (reason === 'reconnect') h.meta.connectionStateGeneration = 'different';
    h.advance(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('enforces the cooldown and four-attempt rolling cap without delayed replay', async () => {
    const h = harness();
    let last!: DeliveryCandidate;
    for (let i = 0; i < 5; i++) { last = h.seed('automatic', `job${i}`); await h.admit(last); h.advance(); await h.send(); h.advance(DELIVERY_PUSH.cooldownMs); }
    expect(h.deps.send).toHaveBeenCalledTimes(4); expect(h.state().attempts).toHaveLength(4);
    h.advance(DELIVERY_PUSH.dayMs); await h.admit(last); h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(4);
  });
  it('prunes expired automatic failure receipts without reviving old failures or manual batches', async () => {
    const h = harness(); const old = h.seed('automatic', 'old'); await h.admit(old); await h.admit(); h.advance(); await h.send();
    h.advance(DELIVERY_PUSH.dayMs); await h.admit(old); await h.admit(h.seed('automatic', 'new'));
    expect(h.state().seen.map((receipt: { id: string }) => receipt.id)).toEqual(['manual:batch', 'automatic:new']);
    h.batch().updatedAt = h.deps.now(); await h.admit({ ...h.candidate, completedAt: h.deps.now() });
    expect(h.state().pending.entries).toHaveLength(1);
  });
  it('never repeats an ambiguous transport failure, including endpoint aliases in later waves', async () => {
    const h = harness();
    for (let n = 3; n < 10; n++) h.register(`00000000-0000-4000-8000-00000000000${n}`, id);
    vi.mocked(h.deps.send).mockRejectedValue(new Error('private-canary'));
    await h.admit(h.seed('automatic', 'job')); h.advance(); await h.send(); await h.send();
    expect(h.deps.send).toHaveBeenCalledOnce(); expect(h.deps.outcome).toHaveBeenCalledWith('failed');
  });
  it('removes only the expired device generation', async () => {
    const h = harness(); vi.mocked(h.deps.send).mockImplementation(async () => {
      h.rows.get(`users/owner/pushSubscriptions/${id}`).generation = '00000000-0000-4000-8000-000000000099'; throw { statusCode: 410 };
    });
    await h.admit(); h.advance(); await h.send(); expect(h.rows.has(`users/owner/pushSubscriptions/${id}`)).toBe(true);
  });
  it('does not leak a manual result to devices registered only for another entry', async () => {
    const h = harness(); h.register('00000000-0000-4000-8000-000000000003');
    await h.admit(); await h.admit(h.seed('automatic', 'job')); h.advance(); await h.send();
    const other = vi.mocked(h.deps.send).mock.calls.find(([registration]) => registration.endpoint.endsWith('0003'))!;
    expect(JSON.parse(other[1]).notification.navigate).toContain('/services?serviceName=');
  });
});
