import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { Firestore } from 'firebase-admin/firestore';
import { admitConnectionNotification, sendConnectionNotification, type ConnectionPushDependencies } from './connection-service';
import { CONNECTION_PUSH, connectionStatePath, connectionIncidentOwner, reserveTrainingConnectionIncident,
  type ConnectionIncident, type ConnectionService } from './connection-policy';

const now = Date.UTC(2026, 10, 16, 12), publicKey = 'B' + 'A'.repeat(86), origin = 'https://quantified-self.io';
const device = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
function harness() {
  let clock = now, lock = Promise.resolve(), commits = 0, serial = 10;
  const rows = new Map<string, any>([['users/owner', {}], [`users/owner/pushSubscriptions/${device}`, {
    schemaVersion: 1, generation, origin, vapidPublicKey: publicKey, endpoint: 'https://web.push.apple.com/private-canary',
    keys: { p256dh: publicKey, auth: 'A'.repeat(22) },
  }]]);
  const hooks = { afterCommit: (_count: number) => {} };
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const merge = (old: any, next: any): any => Object.fromEntries(Object.entries({ ...old, ...next }).map(([key, value]) => [key,
    value && typeof value === 'object' && !Array.isArray(value) ? merge(old?.[key] ?? {}, value) : value]));
  const db = { doc: (path: string) => ({ path }), collection: (path: string) => ({ doc: (id: string) => ({ path: `${path}/${id}` }),
    where: (_field: string, _op: string, values: string[]) => ({ limit: (limit: number) => ({ query: path, values, limit }) }),
  }), runTransaction: (fn: (tx: any) => Promise<unknown>) => {
    const operation = lock.then(async () => {
      const writes: (() => void)[] = [];
      const tx = { get: async (ref: any) => {
        if (writes.length) throw new Error('Read after write');
        if (ref.query) return { docs: [...rows.keys()].filter(path => path.startsWith(ref.query + '/') && ref.values.includes(rows.get(path).origin)).slice(0, ref.limit).map(snapshot) };
        return snapshot(ref.path);
      }, set: ({ path }: any, value: unknown, options?: { merge?: boolean }) => writes.push(() => rows.set(path,
        options?.merge ? merge(rows.get(path), structuredClone(value)) : structuredClone(value))),
      delete: ({ path }: any) => writes.push(() => rows.delete(path)) };
      const result = await fn(tx); writes.forEach(write => write()); hooks.afterCommit(++commits); return result;
    }); lock = operation.then(() => undefined, () => undefined); return operation;
  } } as unknown as Firestore;
  const deps: ConnectionPushDependencies = { db, now: () => clock, configuration: vi.fn(async () => ({ enabled: true, publicKey })),
    send: vi.fn(async () => ({})), outcome: vi.fn() };
  const seed = (service: ConnectionService = ServiceNames.GarminAPI): ConnectionIncident => {
    const incident = { service, id: `00000000-0000-4000-8000-${String(serial++).padStart(12, '0')}`, observedAt: clock, providerUserId: 'account' };
    rows.set(`users/owner/meta/${service}`, { connectionState: 'reconnect_required', connectionStateGeneration: incident.id,
      providerUserId: 'account', reconnectNotificationId: incident.id, reconnectNotificationStartedAtMs: clock });
    return incident;
  };
  const incident = seed();
  return { rows, hooks, deps, seed, incident, state: () => rows.get(connectionStatePath('owner')),
    advance: (ms = CONNECTION_PUSH.groupMs) => { clock += ms; },
    admit: (value = incident) => admitConnectionNotification('owner', value, deps), send: () => sendConnectionNotification('owner', deps),
    preference: (enabled: boolean, revision: number) => rows.set('users/owner/notificationPreferences/connection_attention', { schemaVersion: 1, enabled, revision }),
    training: (value = incident) => db.runTransaction(async tx => {
      if (await connectionIncidentOwner(db, tx, 'owner', value) !== 'connection') reserveTrainingConnectionIncident(db, tx, 'owner', value);
    }),
  };
}

describe('connection attention notifications', () => {
  it('alerts beta and production using their own destinations and one account-wide attempt', async () => {
    const h = harness(); h.rows.set('users/owner/pushSubscriptions/00000000-0000-4000-8000-000000000003', {
      ...h.rows.get(`users/owner/pushSubscriptions/${device}`), origin: 'https://beta.quantified-self.io', endpoint: 'https://web.push.apple.com/beta',
    });
    await h.admit(); await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); h.advance();
    await Promise.all([h.send(), h.send()]); expect(h.deps.send).toHaveBeenCalledTimes(2); expect(h.state().attempts).toHaveLength(1);
    for (const [registration, body] of vi.mocked(h.deps.send).mock.calls) {
      expect(JSON.parse(body)).toMatchObject({ web_push: 8030, notification: { body: 'Reconnect Garmin to resume syncing.',
        navigate: registration.origin + '/services?serviceName=' + encodeURIComponent(ServiceNames.GarminAPI), renotify: true } });
      expect(body).not.toMatch(/private-canary|account|observedAt|generation/);
    }
  });
  it('groups several broken providers without repeated alerts for their auth retries', async () => {
    const h = harness(); await Promise.all([h.admit(), h.admit(h.seed(ServiceNames.SuuntoApp)), h.admit(h.seed(ServiceNames.COROSAPI))]);
    h.advance(); await h.send(); await h.admit(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(h.deps.send).mock.calls[0][1]).notification.navigate).toBe(origin + '/services');
    expect(Object.keys(h.state().incidents)).toHaveLength(3);
  });
  it('keeps an episode stable through lifecycle generation changes and permits a genuinely new later episode', async () => {
    const h = harness(); await h.admit();
    h.rows.get(`users/owner/meta/${ServiceNames.GarminAPI}`).connectionStateGeneration = 'auth-retry-generation';
    h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledOnce();
    h.advance(CONNECTION_PUSH.cooldownMs); await h.admit(h.seed()); h.advance(); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(2);
  });
  it('shares one incident receipt with Training in either admission order', async () => {
    for (const order of ['training', 'connection']) {
      const h = harness();
      if (order === 'training') { await h.training(); await h.admit(); expect(h.state().pending).toBeUndefined(); }
      else { await h.admit(); await h.training(); expect(h.state().incidents[ServiceNames.GarminAPI].owner).toBe('connection'); }
    }
  });
  it.each(['off', 'disabled', 'no device', 'wrong key', 'deleted account', 'connected', 'account changed', 'episode changed', 'stale'])('does not admit %s', async reason => {
    const h = harness(), meta = h.rows.get(`users/owner/meta/${ServiceNames.GarminAPI}`);
    if (reason === 'off') h.preference(false, 1);
    if (reason === 'disabled') vi.mocked(h.deps.configuration).mockResolvedValue({ enabled: false, publicKey });
    if (reason === 'no device') h.rows.delete(`users/owner/pushSubscriptions/${device}`);
    if (reason === 'wrong key') h.rows.get(`users/owner/pushSubscriptions/${device}`).vapidPublicKey = 'wrong-key';
    if (reason === 'deleted account') h.rows.delete('users/owner');
    if (reason === 'connected') meta.connectionState = 'connected';
    if (reason === 'account changed') meta.providerUserId = 'different';
    if (reason === 'episode changed') meta.reconnectNotificationId = '00000000-0000-4000-8000-000000000099';
    if (reason === 'stale') h.advance(CONNECTION_PUSH.expiryMs + 1);
    await h.admit(); expect(h.state()?.pending).toBeUndefined();
  });
  it.each(['off/on', 'device removed', 'device replaced', 'reconnected', 'disconnect pending', 'new episode', 'disabled', 'expired', 'deleted account'])('cancels pending alerts after %s', async reason => {
    const h = harness(); await h.admit(); h.advance();
    if (reason === 'off/on') h.preference(true, 2);
    if (reason === 'device removed') h.rows.delete(`users/owner/pushSubscriptions/${device}`);
    if (reason === 'device replaced') h.rows.get(`users/owner/pushSubscriptions/${device}`).generation = 'replacement';
    if (reason === 'reconnected') h.rows.get(`users/owner/meta/${ServiceNames.GarminAPI}`).connectionState = 'connected';
    if (reason === 'disconnect pending') h.rows.get(`users/owner/meta/${ServiceNames.GarminAPI}`).connectionState = 'disconnect_pending';
    if (reason === 'new episode') h.seed();
    if (reason === 'disabled') vi.mocked(h.deps.configuration).mockResolvedValue({ enabled: false, publicKey });
    if (reason === 'expired') h.advance(CONNECTION_PUSH.expiryMs + 1);
    if (reason === 'deleted account') h.rows.delete('users/owner');
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled(); expect(h.state()?.pending).toBeUndefined();
  });
  it('rechecks reconnection after claim and never replays ambiguous transport failures', async () => {
    const h = harness(); await h.admit(); h.advance(); h.hooks.afterCommit = count => {
      if (count === 2) h.rows.get(`users/owner/meta/${ServiceNames.GarminAPI}`).connectionState = 'connected';
    };
    await h.send(); expect(h.deps.send).not.toHaveBeenCalled();
    const other = harness(); await other.admit(); other.advance(); vi.mocked(other.deps.send).mockRejectedValue({ statusCode: 503 });
    await other.send(); await other.send(); expect(other.deps.send).toHaveBeenCalledOnce();
  });
  it('retains capped incidents and never turns them into delayed catch-up alerts', async () => {
    const h = harness(); await h.admit(); h.advance(); await h.send(); h.advance(CONNECTION_PUSH.cooldownMs);
    await h.admit(h.seed()); h.advance(); await h.send(); h.advance(CONNECTION_PUSH.cooldownMs);
    const capped = h.seed(); await h.admit(capped); expect(h.state().pending).toBeUndefined();
    h.advance(CONNECTION_PUSH.dayMs); await h.admit(capped); await h.send(); expect(h.deps.send).toHaveBeenCalledTimes(2);
    expect(h.state().incidents[ServiceNames.GarminAPI].id).toBe(capped.id);
  });
  it('cleans expired registrations only for the same generation', async () => {
    const h = harness(); await h.admit(); h.advance(); vi.mocked(h.deps.send).mockRejectedValue({ statusCode: 410 });
    await h.send(); expect(h.rows.has(`users/owner/pushSubscriptions/${device}`)).toBe(false);
  });
});
