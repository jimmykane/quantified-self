import { describe, it, expect, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import webpush from 'web-push';
import { parseVapidKeyPair } from './index';
import { sendPushTest, type PushServiceDependencies } from './service';
import { buildPushTestPayload, isPushEndpoint, isAutomaticPushOrigin, type PushRegistration } from '../../../shared/web-push';

const id = '00000000-0000-4000-8000-000000000001';
const generation = '00000000-0000-4000-8000-000000000002';
const publicKey = 'B' + 'A'.repeat(86);
function harness(origin = 'https://quantified-self.io') {
  const registration: PushRegistration = { schemaVersion: 1, origin, generation, vapidPublicKey: publicKey,
    endpoint: 'https://web.push.apple.com/test', keys: { p256dh: publicKey, auth: 'A'.repeat(22) } };
  const records = new Map<string, Record<string, unknown>>([
    ['users/owner', {}], [`users/owner/pushSubscriptions/${id}`, { ...registration }],
  ]);
  const snapshot = (path: string) => ({ exists: records.has(path), data: () => records.get(path), get: (key: string) => records.get(path)?.[key] });
  let lock = Promise.resolve();
  const db = { doc: (path: string) => ({ path }), collection: (name: string) => ({ doc: (uid: string) => ({ path: `${name}/${uid}` }) }),
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const job = lock.then(() => fn({ get: async (ref: { path: string }) => snapshot(ref.path),
        set: (ref: { path: string }, value: Record<string, unknown>) => records.set(ref.path, value),
        delete: (ref: { path: string }) => records.delete(ref.path) }));
      lock = job.then(() => undefined, () => undefined); return job;
    } } as unknown as Firestore;
  const deps: PushServiceDependencies = { db, emulator: false, now: () => Date.UTC(2026, 10, 3, 12),
    configuration: vi.fn(async () => ({ enabled: true, publicKey })), send: vi.fn(async () => ({})), outcome: vi.fn() };
  const input = { uid: 'owner', origin, data: { installationId: id } };
  return { records, registration, deps, input };
}
describe('Web Push test sender', () => {
  it.each(['https://quantified-self.io', 'https://beta.quantified-self.io'])('sends one fixed compatible notification to its own origin %s', async origin => {
    const h = harness(origin);
    expect(await sendPushTest(h.input, h.deps)).toEqual({ status: 'accepted' });
    expect(h.deps.send).toHaveBeenCalledWith(h.registration, JSON.stringify(buildPushTestPayload(origin)));
    const payload = buildPushTestPayload(origin);
    expect(payload.web_push).toBe(8030);
    expect(payload.notification.navigate).toBe(origin + '/settings?section=notifications');
    expect(payload.notification.data.onActionClick.default.url).toBe('/settings?section=notifications');
    expect(isAutomaticPushOrigin(origin)).toBe(origin === 'https://quantified-self.io');
  });
  it.each([{ uid: undefined }, { impersonatedBy: 'admin' }, { origin: 'https://evil.example' },
    { data: { installationId: id, title: 'injected' } }, { data: { installationId: '../other' } }])('rejects admission %j', async override => {
    const h = harness(); await expect(sendPushTest({ ...h.input, ...override }, h.deps)).rejects.toBeDefined();
    expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('isolates accounts and origins', async () => {
    const h = harness();
    await expect(sendPushTest({ ...h.input, uid: 'other' }, h.deps)).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(sendPushTest({ ...h.input, origin: 'https://beta.quantified-self.io' }, h.deps)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(h.deps.send).not.toHaveBeenCalled();
  });
  it.each(['missing', 'deleted'])('rejects %s accounts', async state => {
    const h = harness(); if (state === 'missing') h.records.delete('users/owner'); else h.records.set('userDeletionTombstones/owner', {});
    await expect(sendPushTest(h.input, h.deps)).rejects.toMatchObject({ code: 'failed-precondition' }); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('serializes concurrent admission and enforces the minute limit', async () => {
    const h = harness(); const outcomes = await Promise.allSettled([sendPushTest(h.input, h.deps), sendPushTest(h.input, h.deps)]);
    expect(outcomes.map(v => v.status).sort()).toEqual(['fulfilled', 'rejected']); expect(h.deps.send).toHaveBeenCalledTimes(1);
  });
  it('enforces daily limits and resets on the next UTC day', async () => {
    const h = harness(); h.records.set('users/owner/pushState/testRateLimit', { day: '2026-11-03', count: 10, lastAttemptAt: 0 });
    await expect(sendPushTest(h.input, h.deps)).rejects.toMatchObject({ code: 'resource-exhausted' });
    h.deps.now = () => Date.UTC(2026, 10, 4, 12); await expect(sendPushTest(h.input, h.deps)).resolves.toEqual({ status: 'accepted' });
  });
  it.each([{ enabled: false, publicKey }, { enabled: true, publicKey: 'different' }])('fails closed for disabled/mismatched configuration', async config => {
    const h = harness(); h.deps.configuration = async () => config;
    await expect(sendPushTest(h.input, h.deps)).rejects.toMatchObject({ code: 'failed-precondition' }); expect(h.deps.send).not.toHaveBeenCalled();
  });
  it('rechecks deletion and registration changes after configuration loading', async () => {
    for (const change of ['delete-account', 'delete-registration', 'rotate']) {
      const h = harness(); h.deps.configuration = async () => {
        if (change === 'delete-account') h.records.set('userDeletionTombstones/owner', {});
        else if (change === 'delete-registration') h.records.delete(`users/owner/pushSubscriptions/${id}`);
        else h.records.set(`users/owner/pushSubscriptions/${id}`, { ...h.registration, generation: id });
        return { enabled: true, publicKey };
      };
      await expect(sendPushTest(h.input, h.deps)).rejects.toMatchObject({ code: 'failed-precondition' }); expect(h.deps.send).not.toHaveBeenCalled();
    }
  });
  it.each([404, 410])('removes expired leaf registrations on %s', async statusCode => {
    const h = harness(); h.deps.send = vi.fn().mockRejectedValue({ statusCode, body: 'private-canary' });
    expect(await sendPushTest(h.input, h.deps)).toEqual({ status: 'subscription_expired' });
    expect(h.records.has(`users/owner/pushSubscriptions/${id}`)).toBe(false);
    expect(h.deps.outcome).toHaveBeenCalledWith('expired');
  });
  it('does not delete a replacement registration after an old request expires', async () => {
    const h = harness(); h.deps.send = async () => { h.records.set(`users/owner/pushSubscriptions/${id}`, { ...h.registration, generation: id }); throw { statusCode: 410 }; };
    await sendPushTest(h.input, h.deps); expect(h.records.get(`users/owner/pushSubscriptions/${id}`)?.generation).toBe(id);
  });
  it.each([429, 500, 302, undefined])('redacts temporary errors and does not retry %s', async statusCode => {
    const h = harness(); h.deps.send = vi.fn().mockRejectedValue({ statusCode, body: 'private-canary' });
    await expect(sendPushTest(h.input, h.deps)).rejects.toMatchObject({ code: 'unavailable', message: 'The test could not be sent. Please try again later.' });
    expect(h.deps.send).toHaveBeenCalledTimes(1); expect(h.records.has(`users/owner/pushSubscriptions/${id}`)).toBe(true);
  });
});
describe('Push credentials and destinations', () => {
  it('validates an ephemeral matching key pair and redacts invalid input', () => {
    const pair = webpush.generateVAPIDKeys(); expect(parseVapidKeyPair(JSON.stringify(pair))).toEqual(pair);
    expect(() => parseVapidKeyPair(JSON.stringify({ ...pair, publicKey }))).toThrow('Notification signing configuration is unavailable.');
    expect(() => parseVapidKeyPair('private-canary')).toThrow('Notification signing configuration is unavailable.');
  });
  it.each(['http://web.push.apple.com/a', 'https://web.push.apple.com:443/a', 'https://web.push.apple.com.evil.example/a',
    'https://user@web.push.apple.com/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://web.push.apple.com/a#fragment',
    'https://wns2-test.notify.windows.com.evil.example/w/?token=test', 'https://evil.example/notify.windows.com/w/?token=test',
    'https://nested.wns2-test.notify.windows.com/w/?token=test', 'https://wns2-test.notify.windows.com:443/w/?token=test',
    'https://user@wns2-test.notify.windows.com/w/?token=test'])('rejects destination %s', url => expect(isPushEndpoint(url)).toBe(false));
  it.each(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-test.notify.windows.com'])('accepts supported service %s', host => expect(isPushEndpoint(`https://${host}/w/?token=synthetic%2Btoken`)).toBe(true));
});
