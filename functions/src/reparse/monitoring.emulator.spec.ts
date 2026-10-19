import { randomUUID } from 'node:crypto';
import { Firestore, Query, Timestamp, Transaction } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeReparseQueue, REPARSE_PROBE_LIMIT, type ReparseProbeProfile } from './monitoring-probe';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('reparse monitoring / real bounded read-only observation', { timeout: 30_000 }, () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required');
  let db: Firestore;
  const now = Date.now(); const hour = 3_600_000;
  const owner = 'PRIVATE_OWNER';
  const ts = (n: number) => Timestamp.fromMillis(n);
  const profile: ReparseProbeProfile = { collection: 'sportsLibReparseJobs', target: '99.0.0',
    terminal: message => message === 'PRIVATE_TERMINAL', hasSource: data => !!data.originalFile?.path };
  const observations = () => vi.mocked(logger.info).mock.calls.filter(([message]) => message === '[Reparse]').map(([, data]) => data);
  const sample = (tier = 'normal') => observations().find(data => data.tier === tier);
  beforeEach(async () => {
    vi.clearAllMocks();
    db = new Firestore({ projectId: `demo-reparse-${randomUUID().slice(0, 8)}` });
    await db.doc(`users/${owner}`).set({ private: 'PRIVATE_PROFILE' });
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.terminate(); });
  async function seed(id: string, patch: Record<string, unknown> = {}, route = false) {
    const parent = `users/${owner}/${route ? 'routes' : 'events'}/${id}`;
    await db.doc(parent).set({ originalFile: { path: 'PRIVATE_SOURCE' }, athleteData: 'PRIVATE_PAYLOAD' });
    const ref = db.doc(`${route ? 'sportsLibRouteReparseJobs' : 'sportsLibReparseJobs'}/${id}`);
    await ref.set({ uid: owner, ...(route ? { routeId: id, routePath: parent } : { eventId: id, eventPath: parent, processingTier: 'normal' }),
      targetSportsLibVersion: profile.target, status: 'pending', attemptCount: 0,
      enqueuedAt: ts(now - 8 * hour), updatedAt: ts(now - 8 * hour), lastError: 'PRIVATE_ERROR', payload: 'PRIVATE_PAYLOAD', ...patch });
    return ref;
  }
  it('emits genuine idle samples in all three tiers without an inactive-batch stall', async () => {
    await observeReparseQueue(db, profile, now);
    await observeReparseQueue(db, { ...profile, collection: 'sportsLibRouteReparseJobs' }, now);
    expect(observations()).toHaveLength(3);
    for (const tier of ['normal', 'heavy', 'route']) expect(sample(tier)).toMatchObject({ pendingSample: 0, unknownSample: 0, truncated: false, stalled: false });
  });
  it('separates serialized heavy progress from normal progress and recovers when that tier completes', async () => {
    const pending = await seed('normal-pending'); await seed('heavy-pending', { processingTier: 'heavy' });
    await seed('normal-done', { status: 'completed', updatedAt: ts(now - 1_000) });
    const complete = await seed('heavy-done', { processingTier: 'heavy', status: 'completed', updatedAt: ts(now - 7 * hour) });
    await seed('unrelated-target', { processingTier: 'heavy', status: 'completed', targetSportsLibVersion: '98.0.0', updatedAt: ts(now) });
    const before = await pending.get();
    const reads = vi.spyOn(Transaction.prototype, 'getAll'); const writes = vi.spyOn(Transaction.prototype, 'set');
    await observeReparseQueue(db, profile, now);
    expect(sample()).toMatchObject({ pendingSample: 1, stalled: false });
    expect(sample('heavy')).toMatchObject({ pendingSample: 1, stalled: true });
    expect(writes).not.toHaveBeenCalled();
    expect((await pending.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
    expect(reads.mock.calls.every(call => (call.at(-1) as { fieldMask: string[] }).fieldMask.includes('originalFile'))).toBe(true);
    expect(JSON.stringify(observations())).not.toContain('PRIVATE');
    await complete.update({ updatedAt: ts(now) }); vi.clearAllMocks();
    await observeReparseQueue(db, profile, now);
    expect(sample('heavy')).toMatchObject({ pendingSample: 1, stalled: false });
  });
  it.each(['normal', 'heavy', 'route'])('applies %s timing without changing parsers or task limits', async tier => {
    const route = tier === 'route'; const p = route ? { ...profile, collection: 'sportsLibRouteReparseJobs' as const } : profile;
    const ref = await seed('candidate', { ...(route ? {} : { processingTier: tier }), updatedAt: ts(now - 2 * hour), enqueuedAt: ts(now - 2 * hour) }, route);
    await observeReparseQueue(db, p, now);
    expect(sample(tier)).toMatchObject({ pendingSample: 1, stalled: tier !== 'heavy' });
    await ref.update({ status: 'failed', updatedAt: ts(now - hour) }); vi.clearAllMocks();
    await observeReparseQueue(db, p, now);
    expect(sample(tier)).toMatchObject({ pendingSample: 0, stalled: false });
  });
  it('excludes source deletion, missing originals, manual-heavy approval, future retries and superseded targets', async () => {
    await seed('manual-heavy', { processingTier: 'heavy', status: 'failed', failureReason: 'TOO_HEAVY_FOR_AUTO_REPARSE' });
    await seed('terminal', { status: 'failed', lastError: 'PRIVATE_TERMINAL' });
    await seed('future', { enqueuedAt: ts(now + hour) });
    await seed('old-target', { targetSportsLibVersion: '98.0.0' });
    await seed('backoff', { status: 'failed', updatedAt: ts(now - hour) });
    await seed('missing-parent'); await db.doc(`users/${owner}/events/missing-parent`).delete();
    await seed('no-original'); await db.doc(`users/${owner}/events/no-original`).set({ private: true });
    await observeReparseQueue(db, profile, now);
    expect(sample()).toMatchObject({ pendingSample: 0, unknownSample: 0, stalled: false });
    expect(sample('heavy')).toMatchObject({ pendingSample: 0, unknownSample: 0, stalled: false });
  });
  it.each(['normal', 'heavy', 'route'])('keeps unresolved %s failures visible after a new task inherits prior job attempts', async tier => {
    const route = tier === 'route';
    const p = route ? { ...profile, collection: 'sportsLibRouteReparseJobs' as const } : profile;
    const ref = await seed('retried-job', { ...(route ? {} : { processingTier: tier }), status: 'failed', attemptCount: 15 }, route);
    const before = await ref.get();
    await observeReparseQueue(db, p, now);
    expect(sample(tier)).toMatchObject({ pendingSample: 1, stalled: true });
    expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
    await ref.update({ updatedAt: ts(now - hour) }); vi.clearAllMocks();
    await observeReparseQueue(db, p, now);
    expect(sample(tier)).toMatchObject({ pendingSample: 0, stalled: false });
    await ref.update({ updatedAt: ts(now - 8 * hour), terminalFailure: true }); vi.clearAllMocks();
    await observeReparseQueue(db, p, now);
    expect(sample(tier)).toMatchObject({ pendingSample: 0, stalled: false });
  });
  it('fences missing/deleting owners, malformed cross-user paths and concurrent job replacement', async () => {
    const ref = await seed('candidate');
    await db.doc(`userDeletionTombstones/${owner}`).set({ expireAt: ts(now + hour) });
    await observeReparseQueue(db, profile, now); expect(sample()).toMatchObject({ pendingSample: 0 });
    await db.doc(`userDeletionTombstones/${owner}`).set({ expireAt: ts(now - 1) });
    const get = Query.prototype.get;
    vi.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query) {
      const snapshot = await get.call(this);
      if (snapshot.docs.some(doc => doc.ref.path === ref.path)) await ref.update({ status: 'completed' });
      return snapshot;
    });
    vi.clearAllMocks(); await observeReparseQueue(db, profile, now);
    expect(sample()).toMatchObject({ unknownSample: 1, stalled: false });
    vi.restoreAllMocks(); await ref.update({ status: 'pending', eventPath: 'users/OTHER_OWNER/events/candidate' });
    vi.clearAllMocks(); await observeReparseQueue(db, profile, now);
    expect(sample()).toMatchObject({ unknownSample: 1, stalled: false });
    await ref.update({ eventPath: `users/${owner}/events/candidate` }); await db.doc(`users/${owner}`).delete();
    vi.clearAllMocks(); await observeReparseQueue(db, profile, now);
    expect(sample()).toMatchObject({ pendingSample: 0, stalled: false });
  });
  it('keeps capped prefixes explicitly incomplete instead of inventing an idle heavy or normal queue', async () => {
    for (let i = 0; i < REPARSE_PROBE_LIMIT + 1; i++) await seed(`terminal-${i}`, { terminalFailure: true });
    const query = vi.spyOn(Query.prototype, 'limitToLast');
    await observeReparseQueue(db, profile, now);
    expect(query).toHaveBeenCalledExactlyOnceWith(REPARSE_PROBE_LIMIT + 1);
    for (const tier of ['normal', 'heavy']) {
      expect(sample(tier)).toMatchObject({ truncated: true, stalled: false });
      expect(sample(tier)).not.toHaveProperty('pendingSample');
    }
  });
  it('withholds no-progress conclusions when completion metadata is in the future or malformed', async () => {
    await seed('candidate');
    const complete = await seed('future-completion', { status: 'completed', updatedAt: ts(now + hour) });
    await observeReparseQueue(db, profile, now);
    expect(sample()).toMatchObject({ pendingSample: 1, unknownSample: 1, stalled: false });
    await complete.update({ updatedAt: ts(now + 1_000) }); vi.clearAllMocks();
    await observeReparseQueue(db, profile, now);
    expect(sample()).toMatchObject({ pendingSample: 1, unknownSample: 0, stalled: false });
    await complete.update({ updatedAt: 'PRIVATE_BAD_TIMESTAMP' }); vi.clearAllMocks();
    await observeReparseQueue(db, profile, now);
    expect(sample()).toMatchObject({ pendingSample: 1, unknownSample: 1, stalled: false });
  });
});
