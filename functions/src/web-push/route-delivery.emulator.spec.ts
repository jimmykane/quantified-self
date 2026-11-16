import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import type { RouteSendNotificationRequest, SendRoutesToServiceResponse } from '../../../shared/saved-route-send';
import type { ActivityPushDependencies } from './activity-service';
import { beginRouteDeliveryNotification, completeRouteDeliveryNotification, sendRouteDeliveryNotification } from './route-delivery-service';
import { ROUTE_PUSH, ROUTE_PUSH_SERVICES, routeSendStatePath, type RouteSendTicket } from './route-delivery-policy';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('manual route delivery notification transactions', { timeout: 30000 }, () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-route-push' }), users: string[] = [];
  const origin = 'https://beta.quantified-self.io', key = 'B' + 'A'.repeat(86);
  const device = '00000000-0000-4000-8000-000000000001', generation = '00000000-0000-4000-8000-000000000002';
  let uid: string, root: string, now: number, deps: ActivityPushDependencies, notification: RouteSendNotificationRequest;
  const state = () => db.doc(routeSendStatePath(uid));
  const start = (total = 1, index = 0, service = ServiceNames.GarminAPI, file = false) => {
    const ids = Array.from({ length: file ? 1 : Math.min(25, total - index * 25) }, (_, i) => `private-route-${index}-${i}`);
    return beginRouteDeliveryNotification(uid, service, { ...notification, totalRoutes: total, chunkIndex: index }, ids, false, deps);
  };
  const response = (count: number, sent = count, service = ServiceNames.GarminAPI, reason?: 'DESTINATION_AUTH_REQUIRED'): SendRoutesToServiceResponse => ({
    destinationServiceName: service, status: sent === count ? 'success' : sent ? 'partial_success' : 'failure',
    routeCount: count, successCount: sent, failureCount: count - sent, skippedCount: 0,
    results: Array.from({ length: count }, (_, i) => ({ routeId: `private-route-${i}`, destinationServiceName: service,
      status: i < sent ? 'success' : 'failure', ...(reason && i >= sent ? { reason } : {}), message: 'private-error-canary' })),
  });
  const finish = (ticket: RouteSendTicket | undefined, count = 1, sent = count, service = ServiceNames.GarminAPI,
    reason?: 'DESTINATION_AUTH_REQUIRED', newlySent = sent) => {
    expect(ticket).toBeDefined(); return completeRouteDeliveryNotification(ticket!, response(count, sent, service, reason), newlySent, deps);
  };
  const flush = () => sendRouteDeliveryNotification(uid, deps);
  beforeEach(async () => {
    uid = `route-push-${randomUUID()}`; root = `users/${uid}`; users.push(uid); now = Date.UTC(2026, 10, 16, 12);
    notification = { requestId: randomUUID(), createdAtMs: now, totalRoutes: 1, chunkIndex: 0 };
    deps = { db, now: () => now, configuration: vi.fn(async () => ({ enabled: true, publicKey: key })),
      send: vi.fn(async () => ({})), outcome: vi.fn() };
    const batch = db.batch(); batch.set(db.doc(root), {});
    batch.set(db.doc(`${root}/pushSubscriptions/${device}`), { schemaVersion: 1, generation, origin, vapidPublicKey: key,
      endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: key, auth: 'A'.repeat(22) } });
    for (const service of Object.keys(ROUTE_PUSH_SERVICES)) batch.set(db.doc(`${root}/meta/${service}`), {
      connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'account', activityNotificationConnectedAtMs: now - 1000,
    });
    await batch.commit();
  });
  afterAll(async () => { for (const user of users) await db.recursiveDelete(db.doc(`users/${user}`)); await db.terminate(); });
  it.each(Object.keys(ROUTE_PUSH_SERVICES))('sends one standard/declarative result for a 20-route send to %s', async service => {
    const ticket = await start(20, 0, service as ServiceNames); await finish(ticket, 20, 20, service as ServiceNames);
    await Promise.all([flush(), flush()]); await flush(); expect(deps.send).toHaveBeenCalledOnce();
    const payload = JSON.parse(vi.mocked(deps.send).mock.calls[0][1]);
    expect(payload.web_push).toBe(8030); expect(payload.notification.body).toContain('20 routes sent');
    expect(payload.notification.navigate).toBe(origin + '/routes');
    expect(payload.notification.data.onActionClick.default).toEqual({ operation: 'openWindow', url: '/routes' });
    expect(JSON.stringify(payload)).not.toMatch(/private-|account|providerUserId/);
  });
  it('correlates multiple 25-route chunks and deduplicates receipt replays', async () => {
    const one = await start(50); await finish(one, 25); await flush(); expect(deps.send).not.toHaveBeenCalled();
    expect(await start(50)).toBeUndefined();
    const two = await start(50, 1); await finish(two, 25, 20); await finish(two, 25, 20);
    await flush(); expect(deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(deps.send).mock.calls[0][1]).notification.body).toBe('45 routes sent to Garmin. 5 need attention.');
    expect(await start(50)).toBeUndefined();
  });
  it('collapses a 20-file upload selection into one result', async () => {
    for (let i = 0; i < 20; i++) { await finish(await start(20, i, ServiceNames.GarminAPI, true)); await flush(); }
    expect(deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(deps.send).mock.calls[0][1]).notification.body).toBe('20 routes sent to Garmin.');
  });
  it('combines a rejected first file and later accepted files into one partial result', async () => {
    await finish(await start(2, 0, ServiceNames.GarminAPI, true), 1, 0);
    await flush(); expect(deps.send).not.toHaveBeenCalled();
    await finish(await start(2, 1, ServiceNames.GarminAPI, true));
    await flush(); await flush(); expect(deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(deps.send).mock.calls[0][1]).notification.body).toBe('1 route sent to Garmin. 1 needs attention.');
  });
  it('cannot reserve more routes than the declared action across overlapping upload/send chunks', async () => {
    const first = await start(26); const last = await start(26, 1, ServiceNames.GarminAPI, true);
    expect(await start(26, 2, ServiceNames.GarminAPI, true)).toBeUndefined();
    await finish(first, 25); await finish(last); await flush();
    expect(JSON.parse(vi.mocked(deps.send).mock.calls[0][1]).notification.body).toBe('26 routes sent to Garmin.');
  });
  it('closes the whole selection after a terminal auth failure, counting unattempted routes as needing attention', async () => {
    await finish(await start(60), 25, 0, ServiceNames.GarminAPI, 'DESTINATION_AUTH_REQUIRED');
    await db.doc(`${root}/meta/${ServiceNames.GarminAPI}`).update({ connectionState: 'reconnect_required', connectionStateGeneration: randomUUID(),
      reconnectNotificationId: randomUUID(), reconnectNotificationStartedAtMs: now });
    await flush(); expect(deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(deps.send).mock.calls[0][1]).notification.body).toContain('needs attention');
    expect(await start(60, 1)).toBeUndefined();
  });
  it('waits past the callable timeout for an abandoned chunk and reports uncertainty once', async () => {
    await finish(await start(50), 25); now += ROUTE_PUSH.idleMs - 1; await flush(); expect(deps.send).not.toHaveBeenCalled();
    now++; await flush(); await flush(); expect(deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(deps.send).mock.calls[0][1]).notification.body).toBe('25 routes sent to Garmin. 25 need attention.');
  });
  it('keeps separate explicit actions as separate results without overwriting pending requests', async () => {
    await finish(await start()); notification = { ...notification, requestId: randomUUID() }; await finish(await start());
    await Promise.all([flush(), flush()]); expect(deps.send).toHaveBeenCalledTimes(2);
    const tags = vi.mocked(deps.send).mock.calls.map(([, value]) => JSON.parse(value).notification.tag);
    expect(new Set(tags).size).toBe(2);
  });
  it('bounds outstanding actions without replacing existing results, then admits more after a claim', async () => {
    const tickets: RouteSendTicket[] = [];
    for (let i = 0; i < ROUTE_PUSH.pendingLimit; i++) {
      notification = { ...notification, requestId: randomUUID() }; tickets.push((await start())!);
    }
    notification = { ...notification, requestId: randomUUID() };
    expect(await start()).toBeUndefined(); expect((await state().get()).get('pending')).toHaveLength(ROUTE_PUSH.pendingLimit);
    await finish(tickets[0]); await flush(); expect(await start()).toBeDefined();
    expect((await state().get()).get('pending')).toHaveLength(ROUTE_PUSH.pendingLimit);
  });
  it('frees cancelled consent slots for new actions without reviving old chunks or completions', async () => {
    const old: { metadata: RouteSendNotificationRequest; ticket: RouteSendTicket }[] = [];
    for (let i = 0; i < ROUTE_PUSH.pendingLimit; i++) {
      notification = { ...notification, requestId: randomUUID() };
      old.push({ metadata: { ...notification }, ticket: (await start())! });
    }
    await db.doc(`${root}/notificationPreferences/route_delivery`).set({ schemaVersion: 1, enabled: true, revision: 2 });
    notification = { ...notification, requestId: randomUUID() };
    const fresh = await start(); expect(fresh).toBeDefined();
    expect((await state().get()).get('pending')).toHaveLength(1);
    expect((await state().get()).get('seen')).toHaveLength(ROUTE_PUSH.pendingLimit);
    for (const entry of old) {
      notification = entry.metadata;
      expect(await start()).toBeUndefined();
      await finish(entry.ticket);
    }
    await finish(fresh); await flush(); await flush();
    expect(deps.send).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(deps.send).mock.calls[0][1]).notification.body).toBe('1 route sent to Garmin.');
  });
  it.each(['result', 'action'])('frees expired %s slots before admitting a fresh action', async expiry => {
    for (let i = 0; i < ROUTE_PUSH.pendingLimit; i++) {
      notification = { ...notification, requestId: randomUUID() };
      const ticket = await start();
      if (expiry === 'result') await finish(ticket);
    }
    now += (expiry === 'result' ? ROUTE_PUSH.expiryMs : ROUTE_PUSH.lifetimeMs) + 1;
    notification = { ...notification, requestId: randomUUID(), createdAtMs: now };
    const fresh = await start(); expect(fresh).toBeDefined();
    expect((await state().get()).get('pending')).toHaveLength(1);
    await finish(fresh); await flush(); expect(deps.send).toHaveBeenCalledOnce();
  });
  it('persists retirement even when a new action cannot capture any device', async () => {
    const ticket = await start();
    await db.doc(`${root}/notificationPreferences/route_delivery`).set({ schemaVersion: 1, enabled: true, revision: 2 });
    await db.doc(`${root}/pushSubscriptions/${device}`).delete();
    notification = { ...notification, requestId: randomUUID() };
    expect(await start()).toBeUndefined();
    const snapshot = await state().get();
    expect(snapshot.get('pending')).toEqual([]);
    expect(snapshot.get('seen')).toEqual([{ id: ticket!.id, expiresAt: now + ROUTE_PUSH.lifetimeMs }]);
    expect(snapshot.get('dueAt')).toBeUndefined();
    await finish(ticket); await flush(); expect(deps.send).not.toHaveBeenCalled();
  });
  it('does not depend on the Activity delivery or Training categories', async () => {
    for (const category of ['activity_delivery', 'training_sync', 'training_send']) {
      await db.doc(`${root}/notificationPreferences/${category}`).set({ schemaVersion: 1, enabled: false, revision: 1 });
    }
    await finish(await start()); await flush(); expect(deps.send).toHaveBeenCalledOnce();
  });
  it('stays silent for an already-accepted no-op send', async () => {
    await finish(await start(), 1, 1, ServiceNames.GarminAPI, undefined, 0); await flush(); expect(deps.send).not.toHaveBeenCalled();
  });
  it.each([false, true])('supports legacy provider metadata while fencing an explicit disconnect: %s', async disconnect => {
    await db.doc(`${root}/meta/${ServiceNames.GarminAPI}`).delete();
    await finish(await start());
    if (disconnect) await db.doc(`${root}/trainingDeliveryState/current`).set({ connectionEpochs: { garmin: 1 } });
    await flush(); expect(deps.send).toHaveBeenCalledTimes(disconnect ? 0 : 1);
  });
  it.each(['category', 'malformed category', 'flag', 'device', 'old key', 'old request', 'not first chunk'])('does not capture %s', async reason => {
    if (reason === 'category') await db.doc(`${root}/notificationPreferences/route_delivery`).set({ schemaVersion: 1, enabled: false, revision: 1 });
    if (reason === 'malformed category') await db.doc(`${root}/notificationPreferences/route_delivery`).set({ enabled: true });
    if (reason === 'flag') deps.configuration = async () => ({ enabled: false, publicKey: key });
    if (reason === 'device') await db.doc(`${root}/pushSubscriptions/${device}`).delete();
    if (reason === 'old key') await db.doc(`${root}/pushSubscriptions/${device}`).update({ vapidPublicKey: 'C' + 'A'.repeat(86) });
    if (reason === 'old request') notification.createdAtMs -= ROUTE_PUSH.clockSkewMs + 1;
    expect(await start(reason === 'not first chunk' ? 50 : 1, reason === 'not first chunk' ? 1 : 0)).toBeUndefined();
  });
  it.each(['category off/on', 'flag', 'device', 'generation', 'key', 'reconnect', 'disconnect', 'account', 'deleted user', 'expired'])('cancels ready results after %s', async reason => {
    await finish(await start());
    if (reason === 'category off/on') await db.doc(`${root}/notificationPreferences/route_delivery`).set({ schemaVersion: 1, enabled: true, revision: 2 });
    if (reason === 'flag') deps.configuration = async () => ({ enabled: false, publicKey: key });
    if (reason === 'device') await db.doc(`${root}/pushSubscriptions/${device}`).delete();
    if (reason === 'generation') await db.doc(`${root}/pushSubscriptions/${device}`).update({ generation: randomUUID() });
    if (reason === 'key') deps.configuration = async () => ({ enabled: true, publicKey: 'C' + 'A'.repeat(86) });
    if (reason === 'reconnect') await db.doc(`${root}/meta/${ServiceNames.GarminAPI}`).update({ connectionStateGeneration: randomUUID(), activityNotificationConnectedAtMs: now + 1 });
    if (reason === 'disconnect') await db.doc(`${root}/meta/${ServiceNames.GarminAPI}`).update({ connectionState: 'disconnect_pending' });
    if (reason === 'account') await db.doc(`${root}/meta/${ServiceNames.GarminAPI}`).update({ providerUserId: 'another-account' });
    if (reason === 'deleted user') await db.doc(root).delete();
    if (reason === 'expired') now += ROUTE_PUSH.expiryMs + 1;
    await flush(); await flush(); expect(deps.send).not.toHaveBeenCalled();
  });
  it('fences device replacement during expired-subscription cleanup and never replays ambiguous sends', async () => {
    await finish(await start()); const next = randomUUID();
    vi.mocked(deps.send).mockImplementation(async () => {
      await db.doc(`${root}/pushSubscriptions/${device}`).update({ generation: next }); throw { statusCode: 410 };
    });
    await flush(); await flush(); expect(deps.send).toHaveBeenCalledOnce();
    expect((await db.doc(`${root}/pushSubscriptions/${device}`).get()).get('generation')).toBe(next);
  });
  it('fans out to beta and production while deduplicating endpoint aliases', async () => {
    const registration = (await db.doc(`${root}/pushSubscriptions/${device}`).get()).data()!;
    await db.doc(`${root}/pushSubscriptions/00000000-0000-4000-8000-000000000003`).set({ ...registration,
      origin: 'https://quantified-self.io', endpoint: 'https://web.push.apple.com/prod' });
    await db.doc(`${root}/pushSubscriptions/00000000-0000-4000-8000-000000000004`).set(registration);
    await finish(await start()); await flush(); expect(deps.send).toHaveBeenCalledTimes(2);
    for (const [target, payload] of vi.mocked(deps.send).mock.calls) expect(JSON.parse(payload).notification.navigate).toBe(target.origin + '/routes');
  });
});
