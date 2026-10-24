import { randomUUID } from 'node:crypto';
import { FieldValue, Firestore, Timestamp } from 'firebase-admin/firestore';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';

vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({
  db: null as unknown as Firestore,
  providerGet: vi.fn(),
  tokenData: vi.fn(),
  hasProAccess: vi.fn(),
}));
vi.mock('firebase-admin', () => ({ firestore: Object.assign(() => mocks.db, { Timestamp, FieldValue }) }));
vi.mock('firebase-functions/v1', async () => {
  const { HttpsError } = await import('firebase-functions/v2/https');
  return { https: { HttpsError }, runWith: () => ({ region: () => ({ https: { onCall: (handler: unknown) => handler } }) }) };
});
vi.mock('../request-helper', () => ({ get: mocks.providerGet }));
vi.mock('../tokens', () => ({ getTokenData: mocks.tokenData }));
vi.mock('../utils', () => ({ hasProAccess: mocks.hasProAccess, PRO_REQUIRED_MESSAGE: 'Pro required.' }));
vi.mock('../OAuth2', () => ({ getServiceConfig: () => ({ tokenCollectionName: 'COROSAPIAccessTokens' }) }));
vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: async (uid: string, service: string) => (await mocks.db.doc(`users/${uid}/meta/${service}`).get()).data(),
  isServiceUnavailableForSyncForUser: async (uid: string, service: string) => {
    const meta = (await mocks.db.doc(`users/${uid}/meta/${service}`).get()).data();
    return ['disconnect_pending', 'reconnect_required'].includes(meta?.connectionState);
  },
}));
// Keep provider decoding/identity tests in queue.spec.ts. This suite uses the
// real callable, account guards, deletion guards and Firestore transactions.
vi.mock('./queue', () => ({
  convertCOROSWorkoutsToQueueItems: async (items: Array<{ labelId: string }>, openId: string) => items.map(item => ({
    id: `${openId}-${item.labelId}`, workoutID: item.labelId, openId,
    queueRevision: randomUUID(), dateCreated: Date.now(), processed: false, retryCount: 0,
  })),
}));

import { ServiceNames } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import { addCOROSAPIHistoryToQueue } from './history-to-queue';
import { withActivityHistoryImportReservation } from '../history';
import { HistoryLifecycleChangedError } from '../connection-history/execution';
import { getServiceWorkoutQueueName } from '../shared/queue-names';

const service = ServiceNames.COROSAPI;
const queueName = getServiceWorkoutQueueName(service);
type Range = { startDate: string; endDate: string };
type Reply = { stats: { successCount: number; failureCount: number } };
const handler = addCOROSAPIHistoryToQueue as unknown as (data: Range, context: unknown) => Promise<Reply>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(count = 1, prefix = 'item') {
  return JSON.stringify({ result: '0000', data: Array.from({ length: count }, (_, index) => ({ labelId: `${prefix}-${index}` })) });
}
function range(days = 7): Range {
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  return { startDate: new Date(end.getTime() - days * 86_400_000).toISOString(), endDate: end.toISOString() };
}
function call(uid = 'owner', dates = range()) {
  return handler(dates, { app: { appId: 'demo-app' }, auth: { uid } });
}
function meta(uid = 'owner') { return mocks.db.doc(`users/${uid}/meta/${service}`); }
function root(uid = 'owner') { return mocks.db.doc(`COROSAPIAccessTokens/${uid}`); }
function queue() { return mocks.db.collection(queueName); }
async function seed(uid = 'owner') {
  const batch = mocks.db.batch();
  batch.set(mocks.db.doc(`users/${uid}`), { uid });
  batch.set(root(uid), { activeOAuthCredentialGeneration: 'credential' });
  batch.set(root(uid).collection('tokens').doc(`account-${uid}`), {
    tokenCredentialGeneration: 'credential', openId: `account-${uid}`, accessToken: 'synthetic-token',
  });
  batch.set(meta(uid), { connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: `account-${uid}` });
  await batch.commit();
}
function pauseProvider() {
  const entered = deferred<void>(), result = deferred<string>();
  mocks.providerGet.mockImplementationOnce(() => { entered.resolve(); return result.promise; });
  return { entered: entered.promise, ...result };
}
function rejectQueueCommits(workoutID?: string, error = new Error('Synthetic queue commit failure')) {
  const original = mocks.db.runTransaction.bind(mocks.db);
  vi.spyOn(mocks.db, 'runTransaction').mockImplementation(update => original(async tx => {
    const writes = vi.spyOn(tx, 'set');
    const result = await update(tx);
    if (writes.mock.calls.some(([ref, data]) => ref.parent.id === queueName && (!workoutID || data.workoutID === workoutID))) {
      throw error;
    }
    return result;
  }));
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('COROS manual history leases in Firestore', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required.');
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.providerGet.mockReset().mockResolvedValue(response());
    mocks.tokenData.mockReset().mockImplementation(async (snapshot: DocumentSnapshot) => snapshot.data());
    mocks.hasProAccess.mockReset().mockResolvedValue(true);
    mocks.db = new Firestore({ projectId: `demo-coros-lease-${randomUUID().slice(0, 8)}` });
    await seed();
  });
  afterEach(async () => { vi.restoreAllMocks(); await mocks.db.terminate(); });

  it.each(['missing-root', 'disconnect', 'missing-token', 'deletion', 'missing-user'] as const)(
    'keeps %s admission refusal callable-safe without queue/history changes', async reason => {
      const before = (await meta().get()).data();
      if (reason === 'missing-root') await mocks.db.recursiveDelete(root());
      if (reason === 'disconnect') await root().update({ disconnectOperationGeneration: 'disconnect' });
      // Token documents are leaves with no descendants.
      if (reason === 'missing-token') await root().collection('tokens').doc('account-owner').delete();
      if (reason === 'deletion') await mocks.db.doc('userDeletionTombstones/owner').set({});
      if (reason === 'missing-user') await mocks.db.recursiveDelete(mocks.db.doc('users/owner'));
      const error = await call().catch(failure => failure);
      expect(error).toBeInstanceOf(HttpsError);
      expect(error.code).toBe(['missing-root', 'missing-token'].includes(reason) ? 'unauthenticated' : 'failed-precondition');
      expect(mocks.providerGet).not.toHaveBeenCalled();
      expect((await queue().get()).empty).toBe(true);
      expect((await meta().get()).data()).toEqual(reason === 'missing-user' ? undefined : before);
    },
  );

  it('preserves an existing legacy connection with matching absent generations', async () => {
    const batch = mocks.db.batch();
    batch.update(meta(), { connectionStateGeneration: FieldValue.delete() });
    batch.update(root(), { activeOAuthCredentialGeneration: FieldValue.delete() });
    batch.update(root().collection('tokens').doc('account-owner'), { tokenCredentialGeneration: FieldValue.delete() });
    await batch.commit();
    expect((await call()).stats.successCount).toBe(1);
    expect((await queue().get()).size).toBe(1);
    expect((await meta().get()).data()).not.toHaveProperty('historyImportLeaseOwner');
  });

  it('permits ordinary token refresh within the same credential generation', async () => {
    const provider = pauseProvider();
    const result = call();
    try {
      await provider.entered;
      await root().collection('tokens').doc('account-owner').update({ accessToken: 'rotated-synthetic-token', dateRefreshed: Date.now() });
    } finally { provider.resolve(response()); }
    expect((await result).stats.successCount).toBe(1);
    expect((await queue().get()).size).toBe(1);
  });

  it('reports a generic already-exists transaction failure instead of treating it as normal contention', async () => {
    rejectQueueCommits(undefined, Object.assign(new Error('Synthetic database failure'), { code: 'already-exists' }));
    await expect(call()).rejects.toMatchObject({ code: 'internal' });
    expect(logger.error).toHaveBeenCalled();
    expect((await queue().get()).empty).toBe(true);
    expect((await meta().get()).data()).not.toHaveProperty('didLastHistoryImport');
    expect((await meta().get()).data()).not.toHaveProperty('historyImportLeaseOwner');
  });

  it.each([false, true])('admits one overlapping call and rejects its competitor before provider work (different ranges: %s)', async different => {
    const entered = deferred<void>(), release = deferred<string>();
    mocks.providerGet.mockImplementation(() => { entered.resolve(); return release.promise; });
    const attempts = [call(), call('owner', range(different ? 14 : 7))];
    const settled = Promise.allSettled(attempts);
    const loser = Promise.any(attempts.map(attempt => attempt.then(() => { throw new Error('Unexpected early success'); }, error => error)));
    try {
      await entered.promise;
      expect(await loser).toMatchObject({ code: 'already-exists' });
      expect(mocks.providerGet).toHaveBeenCalledTimes(1);
      const running = (await meta().get()).data()!;
      expect(running.historyImportLeaseOwner).toEqual(expect.any(String));
      expect(Number.isFinite(running.historyImportLeaseExpiresAt)).toBe(true);
      expect(running.historyImportLeaseExpiresAt - Date.now()).toBeGreaterThan(300_000);
      expect(running.didLastHistoryImport).toBeUndefined();
      expect((await queue().get()).empty).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    } finally { release.resolve(response()); }
    const outcomes = await settled;
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await queue().get()).size).toBe(1);
    expect((await meta().get()).data()).not.toHaveProperty('historyImportLeaseOwner');
  }, 30_000);

  it('admits independent users while both provider requests are in flight', async () => {
    await seed('second');
    const entered = deferred<void>(), release = deferred<string>();
    mocks.providerGet.mockImplementation(() => {
      if (mocks.providerGet.mock.calls.length === 2) entered.resolve();
      return release.promise;
    });
    const attempts = Promise.all([call(), call('second')]);
    try { await entered.promise; expect(mocks.providerGet).toHaveBeenCalledTimes(2); }
    finally { release.resolve(response()); }
    await attempts;
    expect((await queue().get()).size).toBe(2);
    for (const uid of ['owner', 'second']) expect((await meta(uid).get()).data()).toMatchObject({ processedActivitiesFromLastHistoryImportCount: 1 });
  }, 30_000);

  it.each([false, true])('checks cooldown and the active lease atomically (active lease: %s)', async active => {
    const last = Date.now();
    await meta().update({ didLastHistoryImport: last, processedActivitiesFromLastHistoryImportCount: 500,
      historyImportLeaseOwner: 'earlier', historyImportLeaseExpiresAt: last + (active ? 60_000 : -1) });
    const before = (await meta().get()).data();
    await expect(call()).rejects.toMatchObject(active ? { code: 'already-exists' }
      : { code: 'permission-denied', message: `History import is not allowed until ${new Date(last + 86_400_000).toISOString()}` });
    expect((await meta().get()).data()).toEqual(before);
    expect(mocks.providerGet).not.toHaveBeenCalled();
    expect((await queue().get()).empty).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('recovers an expired lease and cleans up its own completed claim', async () => {
    await meta().update({ historyImportLeaseOwner: 'expired', historyImportLeaseExpiresAt: Date.now() - 1 });
    expect((await call()).stats.successCount).toBe(1);
    expect((await meta().get()).data()).not.toHaveProperty('historyImportLeaseOwner');
    expect((await meta().get()).data()).not.toHaveProperty('historyImportLeaseExpiresAt');
  });

  it.each(['success', 'failure'] as const)('fences the expired owner and preserves the replacement lease after old-provider %s', async oldOutcome => {
    const oldProvider = pauseProvider();
    const old = call().then(value => ({ value }), error => ({ error }));
    await oldProvider.entered;
    const previous = (await meta().get()).data()!;
    await meta().update({ historyImportLeaseExpiresAt: Date.now() - 1 });
    const newProvider = pauseProvider();
    const replacement = call('owner', range(14));
    try {
      await newProvider.entered;
      const next = (await meta().get()).data()!;
      expect(next.historyImportLeaseOwner).not.toBe(previous.historyImportLeaseOwner);
      if (oldOutcome === 'success') oldProvider.resolve(response(1, 'stale'));
      else oldProvider.reject(new Error('Synthetic provider failure'));
      expect(await old).toMatchObject({ error: { code: oldOutcome === 'success' ? 'failed-precondition' : 'internal' } });
      expect((await meta().get()).data()).toEqual(next);
      expect((await queue().get()).empty).toBe(true);
      if (oldOutcome === 'success') expect(logger.error).not.toHaveBeenCalled();
    } finally { oldProvider.resolve(response()); newProvider.resolve(response(1, 'current')); }
    await replacement;
    expect((await queue().get()).docs.map(doc => doc.data().workoutID)).toEqual(['current-0']);
    expect((await meta().get()).data()).not.toHaveProperty('historyImportLeaseOwner');
  }, 30_000);

  it('checks ownership again after token resolution and before the provider request', async () => {
    mocks.tokenData.mockImplementationOnce(async (snapshot: DocumentSnapshot) => {
      await meta().update({ historyImportLeaseOwner: 'replacement' });
      return snapshot.data();
    });
    await expect(call()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mocks.providerGet).not.toHaveBeenCalled();
    expect((await meta().get()).data()).toMatchObject({ historyImportLeaseOwner: 'replacement' });
  });

  it('rejects stale finalization without removing a replacement owner', async () => {
    await expect(withActivityHistoryImportReservation('owner', service, async () => {
      await meta().update({ historyImportLeaseOwner: 'replacement' });
      return 'completed';
    })).rejects.toBeInstanceOf(HistoryLifecycleChangedError);
    expect((await meta().get()).data()).toMatchObject({ historyImportLeaseOwner: 'replacement' });
  });

  it.each(['expiry', 'disconnect', 'account', 'connection', 'credential', 'token', 'deletion', 'missing-user'] as const)(
    'rejects %s during provider work without persisting stale queue/history data', async change => {
      const provider = pauseProvider();
      const result = call().then(value => ({ value }), error => ({ error }));
      try {
        await provider.entered;
        if (change === 'expiry') await meta().update({ historyImportLeaseExpiresAt: Date.now() - 1 });
        if (change === 'disconnect') await root().update({ disconnectOperationGeneration: 'disconnect' });
        if (change === 'account') await meta().update({ providerUserId: 'another-account' });
        if (change === 'connection') await meta().update({ connectionStateGeneration: 'reconnected' });
        if (change === 'credential') {
          const batch = mocks.db.batch();
          batch.update(root(), { activeOAuthCredentialGeneration: 'replacement' });
          batch.update(root().collection('tokens').doc('account-owner'), { tokenCredentialGeneration: 'replacement' });
          await batch.commit();
        }
        // A credential is a leaf; it has no child collections by design.
        if (change === 'token') await root().collection('tokens').doc('account-owner').delete();
        if (change === 'deletion') await mocks.db.doc('userDeletionTombstones/owner').set({});
        // Deliberately retain descendants to reproduce the account-deletion race.
        if (change === 'missing-user') await mocks.db.doc('users/owner').delete();
      } finally { provider.resolve(response()); }
      const outcome = await result;
      expect(outcome).toMatchObject({ error: expect.any(HttpsError) });
      expect((await queue().get()).empty).toBe(true);
      expect((await meta().get()).data()).not.toHaveProperty('didLastHistoryImport');
    },
  );

  it.each(['provider', 'queue'] as const)('releases its lease after a %s failure while preserving earlier committed metadata', async failure => {
    const prior = { didLastHistoryImport: Date.now() - 4 * 86_400_000, processedActivitiesFromLastHistoryImportCount: 7,
      lastHistoryImportStartDate: 1, lastHistoryImportEndDate: 2 };
    await meta().update(prior);
    if (failure === 'provider') mocks.providerGet.mockRejectedValueOnce(new Error('Synthetic provider failure'));
    else rejectQueueCommits();
    await expect(call()).rejects.toMatchObject({ code: 'internal' });
    expect((await meta().get()).data()).toMatchObject(prior);
    expect((await meta().get()).data()).not.toHaveProperty('historyImportLeaseOwner');
    expect((await queue().get()).empty).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it('retains a committed earlier window and its cooldown when a later provider window fails', async () => {
    mocks.providerGet.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('Synthetic later-window failure'));
    const dates = range(45);
    await expect(call('owner', dates)).rejects.toMatchObject({ code: 'internal' });
    const data = (await meta().get()).data()!;
    expect(data).toMatchObject({ processedActivitiesFromLastHistoryImportCount: 1, lastHistoryImportStartDate: Date.parse(dates.startDate) });
    expect(data.lastHistoryImportEndDate).toBeLessThan(Date.parse(dates.endDate));
    expect(data).not.toHaveProperty('historyImportLeaseOwner');
    expect((await queue().get()).size).toBe(1);
    await expect(call()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.providerGet).toHaveBeenCalledTimes(2);
  });

  it('counts only committed queue batches after a partial queue failure', async () => {
    mocks.providerGet.mockResolvedValueOnce(response(451));
    rejectQueueCommits('item-450');
    expect((await call()).stats).toMatchObject({ successCount: 450, failureCount: 1 });
    expect((await queue().get()).size).toBe(450);
    expect((await meta().get()).data()).toMatchObject({ processedActivitiesFromLastHistoryImportCount: 450 });
    expect((await meta().get()).data()).not.toHaveProperty('historyImportLeaseOwner');
  });

  it.each([false, true])('preserves cumulative counts across an empty last window (earlier committed work: %s)', async prior => {
    mocks.providerGet.mockResolvedValueOnce(response(prior ? 1 : 0)).mockResolvedValueOnce(response(0));
    const dates = range(45);
    expect((await call('owner', dates)).stats.successCount).toBe(prior ? 1 : 0);
    expect((await meta().get()).data()).toMatchObject({ processedActivitiesFromLastHistoryImportCount: prior ? 1 : 0,
      lastHistoryImportStartDate: Date.parse(dates.startDate), lastHistoryImportEndDate: Date.parse(dates.endDate) });
    expect((await meta().get()).data()).not.toHaveProperty('historyImportLeaseOwner');
    expect((await queue().get()).size).toBe(prior ? 1 : 0);
    if (!prior) expect((await call()).stats.successCount).toBe(1);
  });
});
