import { randomUUID } from 'node:crypto';
import { FieldValue, Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ db: null as unknown as Firestore }));
vi.mock('firebase-admin', () => ({ firestore: () => mocks.db }));
vi.mock('../token-refresh-coordinator', () => ({ ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD: 'activeOAuthCredentialGeneration' }));
import { ServiceNames } from '@sports-alliance/sports-lib';
import { startManualActivityHistory } from './manual-activity';
import { historyProjection, type ConnectionHistoryRun } from './model';
import { sendHistoryCompletion, type HistoryPushDependencies } from '../web-push/history-service';
const pushMock = vi.hoisted(() => ({ template: vi.fn() }));
vi.mock('firebase-admin/remote-config', () => ({ getRemoteConfig: () => ({ getTemplate: pushMock.template }) }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('manual history admission transactions', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required');
  beforeEach(() => { mocks.db = new Firestore({ projectId: `demo-manual-history-${randomUUID().slice(0, 8)}` }); });
  afterEach(async () => { vi.restoreAllMocks(); await mocks.db.terminate(); });
  const start = new Date('2026-10-01T00:00:00Z'), end = new Date('2026-10-02T23:59:59.999Z');
  async function seed(service: ServiceNames, missingProviderId = false) {
    const roots = { [ServiceNames.GarminAPI]: 'garminAPITokens', [ServiceNames.SuuntoApp]: 'suuntoAppAccessTokens', [ServiceNames.COROSAPI]: 'COROSAPIAccessTokens', [ServiceNames.WahooAPI]: 'wahooAPIAccessTokens' };
    const root = `${roots[service as keyof typeof roots]}/owner`;
    const meta = mocks.db.doc(`users/owner/meta/${service}`);
    const batch = mocks.db.batch();
    batch.set(mocks.db.doc('users/owner'), { uid: 'owner' });
    batch.set(mocks.db.doc(root), { activeOAuthCredentialGeneration: 'credential' });
    const fields = { [ServiceNames.GarminAPI]: 'userID', [ServiceNames.SuuntoApp]: 'userName',
      [ServiceNames.COROSAPI]: 'openId', [ServiceNames.WahooAPI]: 'wahooUserID' };
    batch.set(mocks.db.doc(`${root}/tokens/account`), { tokenCredentialGeneration: 'credential',
      [fields[service as keyof typeof fields]]: 'account' });
    batch.set(meta, { connectionState: 'connected', connectionStateGeneration: 'connection',
      ...(!missingProviderId ? { providerUserId: 'account' } : {}) });
    await batch.commit(); return meta;
  }
  // Real contention can trigger Firestore SDK backoff beyond the five-second unit-test default.
  it.each([ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI])('admits only one of two concurrent %s requests with its matching reservation and projection', async service => {
    const meta = await seed(service);
    const results = await Promise.allSettled([
      startManualActivityHistory('owner', service, start, end), startManualActivityHistory('owner', service, start, end),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.code).toBe('already-exists');
    const runs = await mocks.db.collection('connectionHistoryImports').get();
    expect(runs.size).toBe(1);
    expect((await meta.get()).data()).toMatchObject({ connectionHistoryReservation: runs.docs[0].id,
      connectionHistoryImport: { runId: runs.docs[0].id, active: true, startMs: start.getTime(), endMs: end.getTime() } });
    expect(runs.docs[0].data().steps).toMatchObject([{ id: 'activities', childPaths: [], done: false }]);
  }, 30_000);
  it.each([ServiceNames.GarminAPI, ServiceNames.SuuntoApp])('does not leave a %s run or reservation after an aborted admission transaction', async service => {
    const meta = await seed(service);
    const original = mocks.db.runTransaction.bind(mocks.db);
    vi.spyOn(mocks.db, 'runTransaction').mockImplementationOnce(operation => original(async tx => {
      await operation(tx); throw new Error('Rejected commit');
    }));
    await expect(startManualActivityHistory('owner', service, start, end)).rejects.toThrow('Rejected commit');
    expect((await mocks.db.collection('connectionHistoryImports').get()).empty).toBe(true);
    expect((await meta.get()).data()).not.toHaveProperty('connectionHistoryImport');
    expect((await meta.get()).data()).not.toHaveProperty('connectionHistoryReservation');
  });
  it.each([ServiceNames.GarminAPI, ServiceNames.COROSAPI])('checks real deletion tombstones before %s admission', async service => {
    await seed(service);
    await mocks.db.doc('userDeletionTombstones/owner').set({});
    await expect(startManualActivityHistory('owner', service, start, end)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await mocks.db.collection('connectionHistoryImports').get()).empty).toBe(true);
  });
  it.each([ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI])(
    'atomically recovers the %s account during competing imports', async service => {
      const meta = await seed(service, true);
      const results = await Promise.allSettled([
        startManualActivityHistory('owner', service, start, end), startManualActivityHistory('owner', service, start, end),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason.code).toBe('already-exists');
      const runs = await mocks.db.collection('connectionHistoryImports').get();
      expect(runs.size).toBe(1);
      expect(runs.docs[0].data()).toMatchObject({ providerUserId: 'account', credentialGeneration: 'credential', connectionGeneration: 'connection' });
      expect((await meta.get()).data()).toMatchObject({ providerUserId: 'account', connectionStateGeneration: 'connection',
        connectionHistoryReservation: runs.docs[0].id, connectionHistoryImport: { runId: runs.docs[0].id, active: true } });
    }, 30_000);
  it('does not persist a recovered identifier when the transaction aborts', async () => {
    const meta = await seed(ServiceNames.SuuntoApp, true);
    const original = mocks.db.runTransaction.bind(mocks.db);
    vi.spyOn(mocks.db, 'runTransaction').mockImplementationOnce(operation => original(async tx => {
      await operation(tx); throw new Error('Rejected migration commit');
    }));
    await expect(startManualActivityHistory('owner', ServiceNames.SuuntoApp, start, end)).rejects.toThrow('Rejected migration commit');
    expect((await meta.get()).data()).not.toHaveProperty('providerUserId');
    expect((await meta.get()).data()).not.toHaveProperty('connectionHistoryImport');
    expect((await mocks.db.collection('connectionHistoryImports').get()).empty).toBe(true);
  });
  it.each(['second current token', 'stale token', 'deleted token', 'mismatched identity', 'disconnect', 'deletion'])(
    'rejects unsafe recovery with %s in Firestore', async reason => {
      const meta = await seed(ServiceNames.SuuntoApp, true);
      const root = mocks.db.doc('suuntoAppAccessTokens/owner');
      const token = root.collection('tokens').doc('account');
      if (reason === 'second current token') await root.collection('tokens').doc('other').set({ tokenCredentialGeneration: 'credential', userName: 'other' });
      if (reason === 'stale token') await token.update({ tokenCredentialGeneration: 'old' });
      if (reason === 'deleted token') await token.delete(); // A synthetic token fixture has no descendants.
      if (reason === 'mismatched identity') await token.update({ userName: 'other' });
      if (reason === 'disconnect') await meta.update({ connectionState: FieldValue.delete() });
      if (reason === 'deletion') await mocks.db.doc('userDeletionTombstones/owner').set({});
      await expect(startManualActivityHistory('owner', ServiceNames.SuuntoApp, start, end)).rejects.toMatchObject({ code: 'failed-precondition' });
      expect((await meta.get()).data()).not.toHaveProperty('providerUserId');
      expect((await mocks.db.collection('connectionHistoryImports').get()).empty).toBe(true);
    });
  async function completedNotificationRun(service = ServiceNames.SuuntoApp) {
    const meta = await seed(service);
    const publicKey = 'B' + 'A'.repeat(86);
    const notification = { installationId: randomUUID(), generation: randomUUID(), origin: 'https://quantified-self.io' };
    await mocks.db.doc(`users/owner/pushSubscriptions/${notification.installationId}`).set({ schemaVersion: 1, ...notification,
      vapidPublicKey: publicKey, endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: publicKey, auth: 'A'.repeat(22) } });
    pushMock.template.mockResolvedValue({ parameters: { web_push_enabled: { defaultValue: { value: 'true' } },
      web_push_history_import_enabled: { defaultValue: { value: 'true' } }, web_push_vapid_public_key: { defaultValue: { value: publicKey } } } });
    const result = await startManualActivityHistory('owner', service, start, end, notification);
    expect(result).not.toHaveProperty('notification');
    const ref = mocks.db.doc(`connectionHistoryImports/${result.runId}`);
    const run = (await ref.get()).data() as ConnectionHistoryRun;
    Object.assign(run, { processed: true, revision: 1, updatedAtMs: Date.now() });
    Object.assign(run.steps[0], { status: 'processed', done: true, count: 2000, nextStartMs: run.endMs + 1 });
    await ref.set(run); await meta.set({ connectionHistoryImport: historyProjection(run) }, { merge: true });
    const deps: HistoryPushDependencies = { db: mocks.db, now: Date.now, configuration: async () => ({ enabled: true, publicKey }),
      send: vi.fn(async () => ({})), outcome: vi.fn() };
    return { run, deps };
  }
  it('uses real transactions to prevent two concurrent completion deliveries from sending twice', async () => {
    const { run, deps } = await completedNotificationRun();
    await Promise.all([sendHistoryCompletion(run.id, run, deps), sendHistoryCompletion(run.id, run, deps)]);
    expect(deps.send).toHaveBeenCalledTimes(1);
    const state = (await mocks.db.doc('users/owner/pushState/historyCompletion').get()).data();
    expect(state?.providers[run.serviceName]).toMatchObject({ runId: run.id, outcome: 'accepted' });
    expect(state?.attempts).toHaveLength(1);
    await sendHistoryCompletion(run.id, { ...run, revision: run.revision + 1 }, deps);
    expect(deps.send).toHaveBeenCalledTimes(1);
  }, 30_000);
  it('enforces the two-alert rolling cap across concurrent providers in Firestore', async () => {
    const batches = [];
    for (const service of [ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI]) batches.push(await completedNotificationRun(service));
    await Promise.all(batches.map(({ run, deps }) => sendHistoryCompletion(run.id, run, deps)));
    expect(batches.reduce((count, { deps }) => count + vi.mocked(deps.send).mock.calls.length, 0)).toBe(2);
    const state = (await mocks.db.doc('users/owner/pushState/historyCompletion').get()).data();
    expect(state?.attempts).toHaveLength(2); expect(Object.keys(state?.providers)).toHaveLength(3);
  }, 30_000);
  it('does not send or leave a claim after an aborted claim transaction', async () => {
    const { run, deps } = await completedNotificationRun();
    const original = mocks.db.runTransaction.bind(mocks.db);
    const spy = vi.spyOn(mocks.db, 'runTransaction').mockImplementationOnce(operation => original(async tx => {
      await operation(tx); throw new Error('Rejected notification claim');
    }));
    await expect(sendHistoryCompletion(run.id, run, deps)).rejects.toThrow('Rejected notification claim');
    expect(deps.send).not.toHaveBeenCalled();
    expect((await mocks.db.doc('users/owner/pushState/historyCompletion').get()).exists).toBe(false);
    spy.mockRestore(); await sendHistoryCompletion(run.id, run, deps); expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it('does not recreate private notification state during account deletion', async () => {
    const { run, deps } = await completedNotificationRun();
    await mocks.db.doc('userDeletionTombstones/owner').set({});
    await sendHistoryCompletion(run.id, run, deps);
    expect(deps.send).not.toHaveBeenCalled();
    expect((await mocks.db.doc('users/owner/pushState/historyCompletion').get()).exists).toBe(false);
  });

});
