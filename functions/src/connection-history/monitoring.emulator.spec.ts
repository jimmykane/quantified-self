import { randomUUID } from 'node:crypto';
import { Firestore, Query, Transaction, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('./adapters', () => ({
  getHistoryAdapter: (_run: any, step: any) => { if (step.capability.version !== 1) throw new Error('Unsupported'); return {}; },
  historyCooldownUntil: (_service: unknown, meta: any) => Number(meta?.testCooldownUntil || 0),
  historySleepProvider: () => 'suunto', historyAdmissionQueue: () => ({ taskQueue: 'workout', collection: 'workoutQueue' }),
}));
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHistoryRun, historyOperationKey } from './model';
import { observeConnectionHistory, HISTORY_PROBE_LIMIT } from './monitoring-probe';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('connection history bounded read-only observations', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required');
  let db: Firestore;
  beforeEach(() => { vi.clearAllMocks(); db = new Firestore({ projectId: `demo-history-monitor-${randomUUID().slice(0, 8)}` }); });
  afterEach(async () => { vi.restoreAllMocks(); await db.terminate(); });
  const logs = () => [...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.warn).mock.calls];
  const sample = (provider = 'wahoo') => logs().find(([, fields]) => fields.provider === provider && fields.event === 'queue_sample')?.[1];
  async function seed(service = ServiceNames.WahooAPI) {
    const roots = { [ServiceNames.WahooAPI]: 'wahooAPIAccessTokens', [ServiceNames.SuuntoApp]: 'suuntoAppAccessTokens', [ServiceNames.GarminAPI]: 'garminAPITokens', [ServiceNames.COROSAPI]: 'COROSAPIAccessTokens' };
    const run = createHistoryRun('PRIVATE_OWNER', service, { requested: true, rangePreset: '30_days', runId: randomUUID(),
      rootPath: `${roots[service]}/PRIVATE_OWNER`, tokenPath: `${roots[service]}/PRIVATE_OWNER/tokens/PRIVATE_ACCOUNT`,
      providerUserId: 'PRIVATE_ACCOUNT', credentialGeneration: 'PRIVATE_CREDENTIAL' }, 'PRIVATE_CONNECTION', Date.now() - 3600000);
    run.nextAttemptAt = Date.now() - 1800000;
    await db.doc('users/PRIVATE_OWNER').set({ private: 'PRIVATE' });
    await db.doc(run.rootPath).set({ activeOAuthCredentialGeneration: run.credentialGeneration });
    await db.doc(run.tokenPath).set({ tokenCredentialGeneration: run.credentialGeneration, accessToken: 'PRIVATE_SECRET', permissions: ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT', 'HEALTH_EXPORT'] });
    await db.doc(`users/PRIVATE_OWNER/meta/${service}`).set({ connectionState: 'connected', connectionStateGeneration: run.connectionGeneration });
    const ref = db.doc(`connectionHistoryImports/${run.id}`); await ref.set(run);
    return { run, ref };
  }
  const observe = (access: (uid: string) => Promise<boolean> = async () => true, depth = async () => 0) => observeConnectionHistory(db, access, depth);
  it('emits all four real idle heartbeat groups', async () => {
    await observe();
    expect(logs()).toHaveLength(4);
    for (const provider of ['garmin', 'suunto', 'coros', 'wahoo']) expect(sample(provider)).toMatchObject({ dueSample: 0, ageLowerBoundMs: 0, unknownSample: 0, truncated: false });
  });
  it.each([ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI])('observes %s with field masks, no private logs or writes', async service => {
    const { ref } = await seed(service); const before = await ref.get();
    const select = vi.spyOn(Query.prototype, 'select'); const getAll = vi.spyOn(Transaction.prototype, 'getAll'); const transaction = vi.spyOn(db, 'runTransaction');
    await observe();
    expect(logs().filter(([, fields]) => fields.dueSample === 1)).toHaveLength(1);
    expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
    expect(transaction.mock.calls.every(([, options]) => options?.readOnly)).toBe(true);
    expect(select).toHaveBeenCalled(); expect(getAll).toHaveBeenCalled();
    expect(select.mock.calls[0]).toContain('lastOperation.key');
    for (const call of getAll.mock.calls) {
      const fields = (call.at(-1) as { fieldMask: string[] }).fieldMask;
      expect(fields).not.toContain('accessToken'); expect(fields).not.toContain('refreshToken'); expect(fields).not.toContain('lastOperation');
      expect(fields).not.toContain('lastOperation.result');
    }
    expect(JSON.stringify(logs())).not.toContain('PRIVATE');
  });
  it.each(['disconnect', 'replacement', 'deleted', 'missing', 'lease', 'retry', 'capacity', 'permission', 'cooldown', 'child', 'pro'])('excludes expected %s without a failure signal', async reason => {
    const { ref, run } = await seed(reason === 'permission' ? ServiceNames.GarminAPI : ServiceNames.WahooAPI);
    if (reason === 'disconnect') await db.doc(run.rootPath).update({ disconnectOperationGeneration: 'PRIVATE_NEW' });
    if (reason === 'replacement') await db.doc(run.tokenPath).update({ tokenCredentialGeneration: 'PRIVATE_NEW' });
    if (reason === 'deleted') await db.doc('userDeletionTombstones/PRIVATE_OWNER').set({ expireAt: Timestamp.fromMillis(Date.now() + 60000) });
    if (reason === 'missing') await db.doc('users/PRIVATE_OWNER').delete(); // Synthetic leaf only.
    if (reason === 'lease') await ref.update({ leaseExpiresAt: Date.now() + 60000 });
    if (reason === 'retry') { run.steps[0].status = 'retrying'; await ref.update({ steps: run.steps, nextAttemptAt: Date.now() + 60000 }); }
    if (reason === 'permission') await db.doc(run.tokenPath).update({ permissions: [] });
    if (reason === 'cooldown') await db.doc(`users/PRIVATE_OWNER/meta/${run.serviceName}`).update({ connectionHistoryReservation: 'OTHER', connectionHistoryReservationExpiresAt: Date.now() + 60000 });
    if (reason === 'child') { run.steps[0].childPaths = ['workoutQueue/PRIVATE']; await ref.update({ steps: run.steps }); await db.doc('workoutQueue/PRIVATE').set({ processed: false }); }
    await observe(async () => reason !== 'pro', async () => reason === 'capacity' ? 500 : 0);
    expect(logs().some(([, fields]) => fields.dueSample > 0)).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });
  it('counts due coordinator finalization after children finish without claiming ingestion', async () => {
    const { ref, run } = await seed(); run.steps[0].childPaths = ['workoutQueue/PRIVATE']; await ref.update({ steps: run.steps });
    await db.doc('workoutQueue/PRIVATE').set({ processed: true });
    await observe(); expect(sample()).toMatchObject({ dueSample: 1 });
    expect(logs().every(([, fields]) => fields.event === 'queue_sample')).toBe(true);
  });
  it('excludes a saturated next-page admission after successful children finish', async () => {
    const { ref, run } = await seed(); run.steps[0].childPaths = ['workoutQueue/PRIVATE']; await ref.update({ steps: run.steps });
    await db.doc('workoutQueue/PRIVATE').set({ processed: true, resultStatus: 'success' });
    await observe(async () => true, async () => 500);
    expect(sample()).toMatchObject({ dueSample: 0, unknownSample: 0 });
  });
  it.each(['finished', 'failed', 'missing'])('observes %s finalization even when admission capacity is full', async reason => {
    const { ref, run } = await seed();
    if (reason === 'finished') run.steps[0].nextStartMs = run.endMs + 1000;
    else run.steps[0].childPaths = ['workoutQueue/PRIVATE'];
    await ref.update({ steps: run.steps });
    if (reason === 'failed') await db.doc('workoutQueue/PRIVATE').set({ processed: true, resultStatus: 'failed' });
    const depth = vi.fn(async () => 500); await observe(async () => true, depth);
    expect(sample()).toMatchObject({ dueSample: 1 }); expect(depth).not.toHaveBeenCalled();
  });
  it.each(['capacity', 'permission', 'cooldown', 'adapter'])('observes committed receipt recovery despite %s admission blocking', async reason => {
    const { ref, run } = await seed(ServiceNames.GarminAPI);
    if (reason === 'permission') await db.doc(run.tokenPath).update({ permissions: [] });
    if (reason === 'cooldown') await db.doc(`users/PRIVATE_OWNER/meta/${run.serviceName}`).update({ connectionHistoryReservation: 'OTHER', connectionHistoryReservationExpiresAt: Date.now() + 60000 });
    if (reason === 'adapter') run.steps[0].capability.version = 2;
    await ref.update({ steps: run.steps, lastOperation: { key: historyOperationKey(run.steps[0]),
      result: { count: 1, nextStartMs: run.endMs + 1000, nextPage: 1, childPaths: ['workoutQueue/PRIVATE_RECEIPT'] } } });
    const before = await ref.get(); const getAll = vi.spyOn(Transaction.prototype, 'getAll');
    const depth = vi.fn(async () => 500); await observe(async () => true, depth);
    expect(sample('garmin')).toMatchObject({ dueSample: 1, unknownSample: 0 });
    expect(depth).not.toHaveBeenCalled();
    expect(getAll.mock.calls).toHaveLength(1); // Receipt payload/children are not inspected.
    expect((await ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
    expect(JSON.stringify(logs())).not.toContain('PRIVATE');
  });
  it.each(['cursor', 'page', 'window', 'capability', 'step'])('does not reuse a receipt from another %s', async changed => {
    const { ref, run } = await seed(); const step = run.steps[0];
    const stale = { ...step, capability: { ...step.capability } };
    if (changed === 'cursor') stale.nextStartMs++;
    if (changed === 'page') stale.page++;
    if (changed === 'window') stale.windowDays = 15;
    if (changed === 'capability') stale.capability.version++;
    if (changed === 'step') stale.id = 'another';
    await ref.update({ lastOperation: { key: historyOperationKey(stale), result: 'PRIVATE_RESULT' } });
    const depth = vi.fn(async () => 500); await observe(async () => true, depth);
    expect(sample()).toMatchObject({ dueSample: 0, unknownSample: 0 }); expect(depth).toHaveBeenCalledOnce();
  });
  it.each(['disconnect', 'pro', 'child'])('committed receipts still respect %s lifecycle and waiting work', async reason => {
    const { ref, run } = await seed();
    if (reason === 'disconnect') await db.doc(run.rootPath).update({ disconnectOperationGeneration: 'PRIVATE_NEW' });
    if (reason === 'child') {
      run.steps[0].childPaths = ['workoutQueue/PRIVATE_CHILD']; await db.doc('workoutQueue/PRIVATE_CHILD').set({ processed: false });
    }
    await ref.update({ steps: run.steps, lastOperation: { key: historyOperationKey(run.steps[0]), result: 'PRIVATE_RESULT' } });
    const depth = vi.fn(async () => 500); await observe(async () => reason !== 'pro', depth);
    expect(sample()).toMatchObject({ dueSample: 0, unknownSample: 0 }); expect(depth).not.toHaveBeenCalled();
  });
  it('treats an ambiguous child state as unknown, not eligible or healthy zero', async () => {
    const { ref, run } = await seed(); run.steps[0].childPaths = ['workoutQueue/PRIVATE']; await ref.update({ steps: run.steps });
    await db.doc('workoutQueue/PRIVATE').set({ resultStatus: 'PRIVATE_INVALID' });
    await observe(); expect(sample()).toMatchObject({ unknownSample: 1 }); expect(sample()).not.toHaveProperty('dueSample');
    expect(JSON.stringify(logs())).not.toContain('PRIVATE');
  });
  it('a same-revision document edit between query and transaction is unknown, not healthy zero', async () => {
    const { ref } = await seed(); const original = db.runTransaction.bind(db);
    vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (callback: any, options: any) => {
      await ref.update({ connectionGeneration: 'PRIVATE_NEW' }); return original(callback, options);
    });
    await observe(); expect(sample()).toMatchObject({ unknownSample: 1 }); expect(sample()).not.toHaveProperty('dueSample');
  });
  it('bounds saturated prefixes and never claims healthy zero for unseen users', async () => {
    const { run } = await seed(); const batch = db.batch();
    for (let index = 0; index <= HISTORY_PROBE_LIMIT; index++) batch.set(db.doc(`connectionHistoryImports/extra-${index}`), { ...run, leaseExpiresAt: Date.now() + 60000 });
    await batch.commit(); await observe();
    expect(sample()).toMatchObject({ truncated: true });
    expect(sample('garmin')).not.toHaveProperty('dueSample');
  });
  it('query or capacity failures produce four unavailable heartbeats without raw errors', async () => {
    await seed(); await observe(async () => true, async () => { throw new Error('PRIVATE_ERROR'); });
    expect(logger.warn).toHaveBeenCalledTimes(4); expect(logger.info).not.toHaveBeenCalled();
    expect(JSON.stringify(logs())).not.toContain('PRIVATE');
  });
});
