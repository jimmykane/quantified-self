import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ db: null as unknown as Firestore }));
vi.mock('firebase-admin', () => ({ firestore: () => mocks.db }));
vi.mock('../token-refresh-coordinator', () => ({ ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD: 'activeOAuthCredentialGeneration' }));
import { ServiceNames } from '@sports-alliance/sports-lib';
import { startManualActivityHistory } from './manual-activity';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('manual history admission transactions', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required');
  beforeEach(() => { mocks.db = new Firestore({ projectId: `demo-manual-history-${randomUUID().slice(0, 8)}` }); });
  afterEach(async () => { vi.restoreAllMocks(); await mocks.db.terminate(); });
  const start = new Date('2026-10-01T00:00:00Z'), end = new Date('2026-10-02T23:59:59.999Z');
  async function seed(service: ServiceNames) {
    const root = `${service === ServiceNames.SuuntoApp ? 'suuntoAppAccessTokens' : 'COROSAPIAccessTokens'}/owner`;
    const meta = mocks.db.doc(`users/owner/meta/${service}`);
    const batch = mocks.db.batch();
    batch.set(mocks.db.doc('users/owner'), { uid: 'owner' });
    batch.set(mocks.db.doc(root), { activeOAuthCredentialGeneration: 'credential' });
    batch.set(mocks.db.doc(`${root}/tokens/account`), { tokenCredentialGeneration: 'credential' });
    batch.set(meta, { connectionState: 'connected', connectionStateGeneration: 'connection', providerUserId: 'account' });
    await batch.commit(); return meta;
  }
  it.each([ServiceNames.SuuntoApp, ServiceNames.COROSAPI])('admits only one of two concurrent %s requests with its matching reservation and projection', async service => {
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
  });
  it('does not leave a run or reservation after an aborted admission transaction', async () => {
    const meta = await seed(ServiceNames.SuuntoApp);
    const original = mocks.db.runTransaction.bind(mocks.db);
    vi.spyOn(mocks.db, 'runTransaction').mockImplementationOnce(operation => original(async tx => {
      await operation(tx); throw new Error('Rejected commit');
    }));
    await expect(startManualActivityHistory('owner', ServiceNames.SuuntoApp, start, end)).rejects.toThrow('Rejected commit');
    expect((await mocks.db.collection('connectionHistoryImports').get()).empty).toBe(true);
    expect((await meta.get()).data()).not.toHaveProperty('connectionHistoryImport');
    expect((await meta.get()).data()).not.toHaveProperty('connectionHistoryReservation');
  });
  it('checks real deletion tombstones before admission', async () => {
    await seed(ServiceNames.COROSAPI);
    await mocks.db.doc('userDeletionTombstones/owner').set({});
    await expect(startManualActivityHistory('owner', ServiceNames.COROSAPI, start, end)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await mocks.db.collection('connectionHistoryImports').get()).empty).toBe(true);
  });
});
