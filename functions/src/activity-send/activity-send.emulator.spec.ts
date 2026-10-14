import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createCOROSActivityFITFixture } from '../../test-utils/coros-activity-fit';
import { runSendCommand } from './commands';
import { stageSendFile } from './upload';
import { admitSendRows, projectSendDelivery, cleanupSendSources, cleanupExpiredSends } from './lifecycle';
import { operationRef, batchRef, guardedBackgroundSendTransaction } from './store';
import { ACTIVITY_SEND_LIMITS } from '../../../shared/activity-send';
import { queueRetiredSendSourceCleanup } from './source-cleanup';

const state = vi.hoisted(() => ({ pro: true, account: 'reviewed-account', enqueue: vi.fn(async () => true), failDeleteOnce: false, failMetadataOnce: false, downloadFailure: undefined as undefined | { path: string; code: number }, downloaded: [] as string[], beforeSave: undefined as undefined | (() => Promise<void>), afterSave: undefined as undefined | (() => Promise<void>), afterDelete: undefined as undefined | (() => Promise<void>), files: new Map<string, { bytes: Buffer; metadata: Record<string, string>; generation?: string }>() }));
vi.mock('../utils', async original => ({ ...await original<typeof import('../utils')>(), hasProAccess: async () => state.pro, enqueueActivitySyncTask: state.enqueue }));
vi.mock('../activity-sync/process-queue-item', () => ({ getDestinationConnectionStatus: async () => 'connected' }));
vi.mock('../coros/account', () => ({ getActiveCOROSTokenSnapshot: async () => ({ id: state.account }) }));
vi.mock('./store', async original => ({ ...await original<typeof import('./store')>(), describeFIT: async () => ({ name: 'Synthetic.fit', sport: 'Running', startDate: 1000, warnings: [] }) }));
vi.mock('firebase-admin', async original => ({ ...await original<typeof import('firebase-admin')>(), apps: [], initializeApp: (await original<typeof import('firebase-admin')>()).default.initializeApp, firestore: (await original<typeof import('firebase-admin')>()).default.firestore, storage: () => ({ bucket: () => ({ file: (path: string, objectOptions?: { generation?: string }) => ({
  save: async (bytes: Buffer, options: { metadata: { metadata: Record<string, string> } }) => { await state.beforeSave?.(); if (state.files.has(path)) throw Object.assign(new Error('exists'), { code: 412 }); state.files.set(path, { bytes, metadata: options.metadata.metadata }); await state.afterSave?.(); },
  getMetadata: async () => { if (state.failMetadataOnce) { state.failMetadataOnce = false; throw Object.assign(new Error('Synthetic metadata failure'), { code: 503 }); } const value = state.files.get(path); if (!value || objectOptions?.generation && objectOptions.generation !== (value.generation || '1')) throw Object.assign(new Error('missing'), { code: 404 }); return [{ size: value.bytes.length, generation: value.generation || '1', metadata: value.metadata }]; },
  download: async () => { state.downloaded.push(path); if (state.downloadFailure?.path === path) { const code = state.downloadFailure.code; state.downloadFailure = undefined; throw Object.assign(new Error('Synthetic download failure'), { code }); } const value = state.files.get(path); if (!value || objectOptions?.generation && objectOptions.generation !== (value.generation || '1')) throw Object.assign(new Error('missing'), { code: 404 }); return [value.bytes]; },
  delete: async () => { if (state.failDeleteOnce) { state.failDeleteOnce = false; throw new Error('Synthetic temporary storage failure'); } const value = state.files.get(path); if (!objectOptions?.generation || objectOptions.generation === (value?.generation || '1')) state.files.delete(path); await state.afterDelete?.(); },
}) }) }) }));
vi.unmock('@sports-alliance/sports-lib');

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('durable activity sends in isolated Firestore', () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback Firestore emulator is required.');
  const uid = 'activity-send-owner';
  const id = 'send-batch';
  let db: admin.firestore.Firestore;
  beforeAll(() => { if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-activity-send' }); db = admin.firestore(); });
  beforeEach(async () => {
    state.pro = true; state.account = 'reviewed-account'; state.enqueue.mockClear(); state.files.clear(); state.afterSave = undefined; state.beforeSave = undefined; state.afterDelete = undefined; state.failDeleteOnce = false; state.failMetadataOnce = false;
    state.downloadFailure = undefined; state.downloaded = [];
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await db.recursiveDelete(db.doc(`userDeletionTombstones/${uid}`));
    const queues = await db.collection('activitySyncQueue').get();
    for (const queue of queues.docs) await db.recursiveDelete(queue.ref);
    await db.doc(`users/${uid}`).set({ stripeRole: 'pro' });
  });
  afterAll(async () => { if (db) await db.terminate(); });
  async function create() { await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'files' }); }
  async function prepare() {
    await create(); await stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture());
    return runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
  }
  async function confirm() {
    const reviewed = await prepare(); await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision });
    await admitSendRows(uid, id);
    return (await db.collection('activitySyncQueue').get()).docs[0];
  }
  async function savedOriginal(eventId: string, bytes = createCOROSActivityFITFixture()) {
    const path = `users/${uid}/events/${eventId}/original.fit`;
    state.files.set(path, { bytes, metadata: {} });
    await db.doc(`users/${uid}/events/${eventId}`).set({ name: 'Synthetic saved recording', startDate: 1000, originalFiles: [{ path, generation: '1' }] });
    await db.doc(`users/${uid}/events/${eventId}/metaData/${ServiceNames.GarminAPI}`).set({ summaryId: eventId });
    return path;
  }
  it.each(['selection', 'date range'])('continues a saved %s preview after temporary download failure without excluding or re-reading recordings', async kind => {
    const first = await savedOriginal('saved-one');
    const second = await savedOriginal('saved-two');
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    state.downloadFailure = { path: second, code: 503 };
    const criteria = kind === 'selection' ? { eventIds: ['saved-one', 'saved-two'] } : { startDate: new Date(0).toISOString(), endDate: new Date(2000).toISOString() };
    await expect(runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, ...criteria, sources: [ServiceNames.GarminAPI] })).rejects.toMatchObject({ code: 'unavailable' });
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 1, finished: 0, reviewed: false, savedSelectionReady: true });
    expect((await operationRef(uid, id).collection('rows').doc('saved-two').get()).exists).toBe(false);
    expect((await operationRef(uid, id).get()).data()).not.toHaveProperty('lastEventId');
    await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 2, finished: 0, reviewed: true });
    expect((await batchRef(uid, id).collection('rows').doc('saved-two').get()).data()?.status).toBe('ready');
    expect(state.downloaded.filter(path => path === first)).toHaveLength(1);
    expect(state.downloaded.filter(path => path === second)).toHaveLength(2);
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it.each(['missing', 'invalid'])('still excludes a permanently %s saved original', async kind => {
    const path = await savedOriginal('saved-invalid', kind === 'invalid' ? Buffer.from('Synthetic invalid FIT') : undefined);
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    if (kind === 'missing') state.downloadFailure = { path, code: 404 };
    await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, eventIds: ['saved-invalid'], sources: [ServiceNames.GarminAPI] });
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 1, finished: 1, reviewed: true });
    expect((await batchRef(uid, id).collection('rows').doc('saved-invalid').get()).data()?.status).toBe('needs_action');
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('explains excluded saved originals without creating any provider work', async () => {
    await db.doc(`users/${uid}/events/merged-event`).set({ name: 'Synthetic merged recording', startDate: 1000, isMerge: true });
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, eventIds: ['merged-event'] });
    expect((await batchRef(uid, id).collection('rows').doc('merged-event').get()).data()).toMatchObject({ status: 'needs_action', recovery: 'choose_file' });
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 1, finished: 1 });
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('recovers a lost date-range preview reply and resumes at the server cursor', async () => {
    const writes = db.batch();
    for (let index = 0; index < 51; index++) writes.set(db.doc(`users/${uid}/events/synthetic-${String(index).padStart(2, '0')}`), { name: 'Excluded synthetic merge', startDate: 1000 + index, isMerge: true });
    await writes.commit();
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const request = { version: 1 as const, action: 'prepare' as const, batchId: id, startDate: new Date(0).toISOString(), endDate: new Date(2000).toISOString() };
    const first = await runSendCommand(uid, request);
    expect(first.nextCursor).toBeTruthy();
    const recovered = await runSendCommand(uid, request);
    expect(recovered.nextCursor).toBe(first.nextCursor);
    expect((await batchRef(uid, id).get()).data()?.total).toBe(50);
    const last = await runSendCommand(uid, { ...request, cursor: recovered.nextCursor! });
    expect(last.nextCursor).toBeNull();
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 51, reviewed: true });
  });
  it('denies new sends without Pro before creating any state', async () => {
    state.pro = false;
    await expect(create()).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await operationRef(uid, id).get()).exists).toBe(false);
  });
  it('continues an interrupted saved preview from private criteria after the browser loses its selection', async () => {
    const writes = db.batch();
    for (let index = 0; index < 51; index++) writes.set(db.doc(`users/${uid}/events/resume-${String(index).padStart(2, '0')}`), { name: 'Synthetic excluded merge', startDate: 1000 + index, isMerge: true });
    await writes.commit();
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const first = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, startDate: new Date(0).toISOString(), endDate: new Date(2000).toISOString(), sources: [ServiceNames.COROSAPI] });
    expect(first.nextCursor).toBeTruthy();
    expect((await batchRef(uid, id).get()).data()).not.toHaveProperty('savedSelection');
    const resumed = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
    expect(resumed.nextCursor).toBeNull();
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 51, finished: 51, reviewed: true });
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('rejects invalid preview criteria before freezing the draft and explains deleted selections', async () => {
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    await expect(runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, startDate: 'invalid', endDate: new Date(2000).toISOString() })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await operationRef(uid, id).get()).data()).not.toHaveProperty('selectionKey');
    await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, eventIds: ['deleted-event'] });
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 1, finished: 1, reviewed: true });
    expect((await batchRef(uid, id).collection('rows').doc('deleted-event').get()).data()?.message).toContain('no longer available');
    await expect(runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, eventIds: ['another-event'] })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('canonicalizes equivalent explicit selections for safe continuation', async () => {
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    expect((await batchRef(uid, id).get()).data()?.savedSelectionReady).toBe(false);
    await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, eventIds: ['missing-two', 'missing-one', 'missing-one'], sources: [ServiceNames.COROSAPI, 'manualUpload'] });
    await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, eventIds: ['missing-one', 'missing-two'], sources: ['manualUpload', ServiceNames.COROSAPI] });
    await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 2, reviewed: true, savedSelectionReady: true });
  });
  it('finishes an empty saved date-range preview without creating provider work', async () => {
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const reviewed = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, startDate: new Date(0).toISOString(), endDate: new Date(2000).toISOString() });
    expect(reviewed.nextCursor).toBeNull();
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 0, finished: 0, reviewed: true, savedSelectionReady: true });
    await expect(runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('rejects late file adoption when Stop wins during storage staging', async () => {
    await create();
    state.afterSave = () => runSendCommand(uid, { version: 1, action: 'stop', batchId: id }).then(() => undefined);
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(state.files.size).toBe(0);
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()).not.toHaveProperty('originalFile');
  });
  it('stages privately without creating archive events or provider tasks', async () => {
    await prepare();
    expect((await db.collection(`users/${uid}/events`).get()).empty).toBe(true);
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
    const visible = (await batchRef(uid, id).get()).data()!;
    expect(Object.keys(visible)).not.toContain('providerAccount');
    expect(JSON.stringify(visible)).not.toContain('reviewed-account');
    expect(state.files.size).toBe(1);
  });
  it('rejects stale review and a changed destination account', async () => {
    const reviewed = await prepare();
    await expect(runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision - 1 })).rejects.toMatchObject({ code: 'failed-precondition' });
    state.account = 'replacement-account';
    await expect(runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('confirmation and repeat admission create exactly one account-pinned queue item', async () => {
    const queue = await confirm();
    await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: 2 }); await admitSendRows(uid, id);
    expect((await db.collection('activitySyncQueue').get()).size).toBe(1);
    expect(queue.data()).toMatchObject({ deliveryMode: 'direct', sourceServiceName: 'manualUpload', destinationServiceName: ServiceNames.COROSAPI, destinationPinnedProviderUserID: 'reviewed-account', sendBatchID: id });
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()?.queueId).toBe(queue.id);
    expect(queue.data().expireAt.toMillis() - Date.now()).toBeGreaterThan(29 * 86400_000);
  });
  it('keeps the same staging reservation across a lost upload reply', async () => {
    await prepare(); await stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture());
    expect((await batchRef(uid, id).get()).data()?.total).toBe(1);
    expect(state.files.size).toBe(1);
  });
  it('enforces the aggregate staging quota transactionally', async () => {
    await create(); await db.doc(`users/${uid}/activitySendQuota/current`).set({ bytes: ACTIVITY_SEND_LIMITS.userBytes });
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(state.files.size).toBe(0);
  });
  it('stops unclaimed work but preserves provider-accepted work', async () => {
    const queue = await confirm();
    await queue.ref.update({ destinationUploadID: 'accepted-canary', providerOperationStartedAt: Date.now() });
    await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
    expect((await queue.ref.get()).data()?.processed).toBe(false);
    expect((await queue.ref.get()).data()?.destinationUploadID).toBe('accepted-canary');
  });
  it('stops queued work before any provider claim and projects that committed outcome', async () => {
    const queue = await confirm(); await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
    await projectSendDelivery(queue.ref);
    expect((await queue.ref.get()).data()?.processed).toBe(true);
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()).toMatchObject({ status: 'stopped', recovery: 'none' });
  });
  it('links queue ownership atomically so Stop can act before admission returns from dispatch', async () => {
    const reviewed = await prepare(); await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision });
    state.enqueue.mockImplementationOnce(async () => {
      const source = (await operationRef(uid, id).collection('rows').doc('row-one').get()).data()!;
      expect(source).toMatchObject({ admitted: true, queueId: expect.any(String) });
      await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
      return true;
    });
    await admitSendRows(uid, id);
    const queue = (await db.collection('activitySyncQueue').get()).docs[0];
    expect(queue.data()).toMatchObject({ processed: true, skippedReason: 'send_stopped' });
    await projectSendDelivery(queue.ref);
    expect(state.files.size).toBe(0);
  });
  it('preserves a claim and its source when Stop races admission dispatch', async () => {
    const reviewed = await prepare(); await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision });
    state.enqueue.mockImplementationOnce(async () => {
      const queue = (await db.collection('activitySyncQueue').get()).docs[0];
      await queue.ref.update({ providerOperationStartedAt: Date.now(), destinationUploadID: 'accepted-canary' });
      await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
      await admitSendRows(uid, id);
      return true;
    });
    await admitSendRows(uid, id);
    const queue = (await db.collection('activitySyncQueue').get()).docs[0];
    expect(queue.data()).toMatchObject({ processed: false, destinationUploadID: 'accepted-canary' });
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()?.status).toBe('processing');
    expect(state.files.size).toBe(1);
  });
  it('resumes an unclaimed skipped send after Pro returns without reserving another copy', async () => {
    const queue = await confirm(); await queue.ref.update({ processed: true, resultStatus: 'skipped', skippedReason: 'no_pro_access' });
    await runSendCommand(uid, { version: 1, action: 'retry', batchId: id, rowId: 'row-one' });
    expect((await queue.ref.get()).data()).toMatchObject({ processed: false, skippedReason: null });
    expect(state.files.size).toBe(1);
  });
  it('can stop an unclaimed Pro-lapsed result and release its reservation', async () => {
    const queue = await confirm(); await queue.ref.update({ processed: true, resultStatus: 'skipped', skippedReason: 'no_pro_access' });
    await projectSendDelivery(queue.ref); await runSendCommand(uid, { version: 1, action: 'stop', batchId: id }); await projectSendDelivery(queue.ref);
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()?.status).toBe('stopped');
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
  });
  it('reconciles admitted work and quota when the stop callable is interrupted after committing its intent', async () => {
    const queue = await confirm(); await queue.ref.update({ processed: true, resultStatus: 'skipped', skippedReason: 'no_pro_access' });
    await projectSendDelivery(queue.ref);
    await operationRef(uid, id).update({ stopped: true });
    await admitSendRows(uid, id); await admitSendRows(uid, id);
    expect((await queue.ref.get()).data()?.skippedReason).toBe('send_stopped');
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()?.status).toBe('stopped');
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
    expect((await operationRef(uid, id).get()).data()?.stopComplete).toBe(true);
  });
  it('continues stopping a saved batch across bounded pages after an interrupted reply', async () => {
    const op = operationRef(uid, id); const pub = batchRef(uid, id);
    await op.set({ id, provider: 'coros', source: 'saved', state: 'confirmed', stopped: true });
    await pub.set({ id, total: 51, finished: 0, state: 'confirmed', stopped: true });
    const writes = db.batch();
    for (let index = 0; index < 51; index++) {
      const rowId = `stop-${String(index).padStart(2, '0')}`;
      writes.set(op.collection('rows').doc(rowId), { admitted: true, sourceServiceName: 'manualUpload', eventID: rowId });
      writes.set(pub.collection('rows').doc(rowId), { id: rowId, status: 'ready' });
    }
    await writes.commit();
    await admitSendRows(uid, id); expect((await op.get()).data()?.stopComplete).toBe(false);
    await admitSendRows(uid, id); await admitSendRows(uid, id);
    expect((await pub.get()).data()).toMatchObject({ finished: 51, state: 'complete' });
    expect((await op.get()).data()?.stopComplete).toBe(true);
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('retries failed Stop cleanup without advancing the cursor or inflating finished counts', async () => {
    await confirm(); state.failDeleteOnce = true;
    await expect(runSendCommand(uid, { version: 1, action: 'stop', batchId: id })).rejects.toThrow('Synthetic temporary storage failure');
    expect((await operationRef(uid, id).get()).data()).not.toHaveProperty('stopCursor');
    expect((await operationRef(uid, id).get()).data()?.stopComplete).not.toBe(true);
    expect(state.files.size).toBe(1);
    await admitSendRows(uid, id); await admitSendRows(uid, id);
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ finished: 1, total: 1, stopped: true });
    expect((await operationRef(uid, id).get()).data()?.stopComplete).toBe(true);
    expect(state.files.size).toBe(0);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
  });
  it('acknowledges removal and recovers draft quota after background cleanup fails', async () => {
    await prepare(); state.failDeleteOnce = true; state.pro = false;
    await expect(runSendCommand(uid, { version: 1, action: 'remove', batchId: id, rowId: 'row-one' })).resolves.toMatchObject({ batchId: id });
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).exists).toBe(false);
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ state: 'draft', total: 0 });
    await expect(admitSendRows(uid, id)).rejects.toThrow('Synthetic temporary storage failure');
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()?.cleanupPending).toBe(true);
    await admitSendRows(uid, id); await admitSendRows(uid, id);
    expect(state.files.size).toBe(0);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()?.cleanupPending).toBe(false);
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('drains removed saved rows in bounded pages without deleting archived originals', async () => {
    await operationRef(uid, id).set({ id, source: 'saved', state: 'draft' });
    state.files.set('archive/original.fit', { bytes: Buffer.from('Synthetic archive'), metadata: {} });
    const writes = db.batch();
    for (let index = 0; index < 51; index++) writes.set(operationRef(uid, id).collection('rows').doc(`removed-${index}`), { removed: true, cleanupPending: true, originalFile: { path: 'archive/original.fit', generation: '1' } });
    await writes.commit();
    await admitSendRows(uid, id);
    expect((await operationRef(uid, id).collection('rows').where('cleanupPending', '==', true).get()).size).toBe(1);
    await admitSendRows(uid, id); await admitSendRows(uid, id);
    expect((await operationRef(uid, id).collection('rows').where('cleanupPending', '==', true).get()).empty).toBe(true);
    expect(state.files.has('archive/original.fit')).toBe(true);
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('does not recreate removed-row cleanup state when account deletion wins', async () => {
    await prepare(); await runSendCommand(uid, { version: 1, action: 'remove', batchId: id, rowId: 'row-one' });
    await db.doc(`userDeletionTombstones/${uid}`).set({ active: true });
    await admitSendRows(uid, id);
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()?.cleanupPending).toBe(true);
    expect(state.files.size).toBe(1);
  });
  it('fences late staging after removal and subsequently releases its reservation', async () => {
    await create(); state.afterSave = () => runSendCommand(uid, { version: 1, action: 'remove', batchId: id, rowId: 'row-one' }).then(() => undefined);
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toMatchObject({ code: 'failed-precondition' });
    await admitSendRows(uid, id);
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()).toMatchObject({ removed: true, reservedBytes: 0, cleanupPending: false });
    expect(state.files.size).toBe(0);
  });
  it('cleans a late staging write when removal already released quota and metadata reading fails', async () => {
    await create();
    state.beforeSave = async () => { await runSendCommand(uid, { version: 1, action: 'remove', batchId: id, rowId: 'row-one' }); await admitSendRows(uid, id); state.failMetadataOnce = true; };
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toThrow('Synthetic metadata failure');
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()?.cleanupPending).toBe(true);
    await admitSendRows(uid, id);
    expect(state.files.size).toBe(0);
  });
  it('retains an active reservation after a metadata failure so the same file can resume', async () => {
    await create(); state.failMetadataOnce = true;
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toThrow('Synthetic metadata failure');
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()?.cleanupPending).not.toBe(true);
    expect(state.files.size).toBe(1);
    await stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture());
    expect((await batchRef(uid, id).get()).data()?.total).toBe(1);
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()?.status).toBe('ready');
    expect(state.files.size).toBe(1);
  });
  it('cleans a newer late generation on retired rows without releasing quota twice', async () => {
    await prepare(); await runSendCommand(uid, { version: 1, action: 'remove', batchId: id, rowId: 'row-one' }); await admitSendRows(uid, id);
    const path = `users/${uid}/activitySendSources/${id}/row-one.fit`;
    state.files.set(path, { bytes: createCOROSActivityFITFixture(), metadata: {}, generation: '2' });
    state.files.set('archive/unrelated.fit', { bytes: Buffer.from('Synthetic archive'), metadata: {}, generation: '2' });
    await cleanupSendSources(operationRef(uid, id)); await cleanupSendSources(operationRef(uid, id));
    expect(state.files.has(path)).toBe(false); expect(state.files.has('archive/unrelated.fit')).toBe(true);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
  });
  it('cleans a late unknown-generation write after account deletion without recreating documents', async () => {
    await create();
    state.beforeSave = async () => { await db.recursiveDelete(db.doc(`users/${uid}`)); state.failMetadataOnce = true; };
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toThrow('Synthetic metadata failure');
    expect(state.files.size).toBe(0); expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
    expect((await operationRef(uid, id).collection('rows').get()).empty).toBe(true);
  });
  it('preserves a newer cleanup request arriving during an older generation deletion', async () => {
    await prepare(); await runSendCommand(uid, { version: 1, action: 'remove', batchId: id, rowId: 'row-one' });
    const rowRef = operationRef(uid, id).collection('rows').doc('row-one');
    state.afterDelete = async () => {
      state.afterDelete = undefined;
      state.files.set(`users/${uid}/activitySendSources/${id}/row-one.fit`, { bytes: createCOROSActivityFITFixture(), metadata: {}, generation: '2' });
      await queueRetiredSendSourceCleanup(rowRef, (await rowRef.get()).data()!.digest);
    };
    await admitSendRows(uid, id);
    expect((await rowRef.get()).data()).toMatchObject({ cleanupPending: true, reservedBytes: 0 });
    expect(state.files.size).toBe(1);
    await admitSendRows(uid, id); await admitSendRows(uid, id);
    expect((await rowRef.get()).data()?.cleanupPending).toBe(false); expect(state.files.size).toBe(0);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
  });
  it('cannot resend uncertain acceptance, even with Pro', async () => {
    const queue = await confirm(); await queue.ref.update({ processed: true, resultStatus: 'manual_reconciliation_required', providerOperationStartedAt: 1 });
    await expect(runSendCommand(uid, { version: 1, action: 'retry', batchId: id, rowId: 'row-one' })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('clears every previous provider result before an explicit confirmed-failure retry', async () => {
    const queue = await confirm();
    await queue.ref.update({ processed: true, sendConfirmedFailure: true, resultStatus: 'skipped', destinationUploadID: 'failed-upload', destinationProviderUserID: 'reviewed-account', destinationWorkoutKey: 'failed-workout', destinationInfoCode: 'old-result', providerOperationStartedAt: 1, destinationUploadContinuation: { type: 'suunto_blob_put_v1', uploadUrl: 'https://example.invalid/old-upload', uploadHeaders: {} }, destinationExpectedWorkoutTypeID: 2, retryCount: 4 });
    state.enqueue.mockClear();
    await runSendCommand(uid, { version: 1, action: 'retry', batchId: id, rowId: 'row-one' });
    const retried = (await queue.ref.get()).data()!;
    expect(retried).toMatchObject({ processed: false, destinationUploadID: null, destinationProviderUserID: null, destinationWorkoutKey: null, destinationInfoCode: null, providerOperationStartedAt: null, destinationUploadContinuation: null, retryCount: 0, sendConfirmedFailure: false, destinationPinnedProviderUserID: 'reviewed-account' });
    expect(retried).not.toHaveProperty('destinationExpectedWorkoutTypeID');
    expect(state.enqueue).toHaveBeenCalledOnce();
  });
  it('publishes a stopped sending window and refuses to confirm a stopped draft', async () => {
    const reviewed = await prepare();
    const before = (await batchRef(uid, id).get()).data()!;
    expect(before.expiresAt).toBeGreaterThan(Date.now());
    expect(before.stopped).toBe(false);
    await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
    expect((await batchRef(uid, id).get()).data()?.stopped).toBe(true);
    await expect(runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('keeps accepted status checks available after a batch is stopped and its sending window expires', async () => {
    const queue = await confirm(); await queue.ref.update({ processed: true, destinationUploadID: 'accepted-canary', destinationWorkoutKey: 'accepted-key', providerOperationStartedAt: 1 });
    await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
    await operationRef(uid, id).update({ expiresAt: 1 });
    await runSendCommand(uid, { version: 1, action: 'check', batchId: id, rowId: 'row-one' });
    expect((await queue.ref.get()).data()).toMatchObject({ processed: false, destinationUploadID: 'accepted-canary', destinationWorkoutKey: 'accepted-key', providerOperationStartedAt: 1 });
  });
  it('allows a lapsed user to check an accepted operation without changing its ID', async () => {
    const queue = await confirm(); await queue.ref.update({ processed: true, destinationUploadID: 'accepted-canary' }); state.pro = false;
    await runSendCommand(uid, { version: 1, action: 'check', batchId: id, rowId: 'row-one' });
    expect((await queue.ref.get()).data()?.destinationUploadID).toBe('accepted-canary');
  });
  it('projects live state and completion without leaking provider identifiers', async () => {
    const queue = await confirm(); await queue.ref.update({ destinationUploadID: 'accepted-canary' }); await projectSendDelivery(queue.ref);
    const publicRow = batchRef(uid, id).collection('rows').doc('row-one');
    expect((await publicRow.get()).data()?.status).toBe('processing');
    await queue.ref.update({ processed: true, resultStatus: 'success' }); await projectSendDelivery(queue.ref); await projectSendDelivery(queue.ref);
    expect((await batchRef(uid, id).get()).data()?.finished).toBe(1);
    expect(JSON.stringify((await publicRow.get()).data())).not.toContain('accepted-canary');
  });
  it('deletion tombstones prevent staging and confirmation', async () => {
    const reviewed = await prepare(); await db.doc(`userDeletionTombstones/${uid}`).set({ active: true });
    await expect(runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('stops before admission and finishes the public batch without provider work', async () => {
    const reviewed = await prepare();
    await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision });
    await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
    await admitSendRows(uid, id);
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ state: 'complete', finished: 1 });
    expect(state.files.size).toBe(0);
  });
  it('removes an incomplete or ready file and releases quota even without Pro', async () => {
    await prepare(); state.pro = false;
    await runSendCommand(uid, { version: 1, action: 'remove', batchId: id, rowId: 'row-one' });
    expect((await batchRef(uid, id).get()).data()?.total).toBe(0);
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).exists).toBe(false);
    await admitSendRows(uid, id);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
    expect(state.files.size).toBe(0);
  });
  it('reselection of the same file resumes its original reference', async () => {
    await prepare(); await stageSendFile(uid, id, 'another-row', 'Synthetic.fit', createCOROSActivityFITFixture());
    expect((await batchRef(uid, id).get()).data()?.total).toBe(1);
  });
  it('releases a duplicate batch reservation immediately while preserving the claimed source', async () => {
    const queue = await confirm(); await queue.ref.update({ providerOperationStartedAt: Date.now() });
    const bytes = createCOROSActivityFITFixture(); const other = 'duplicate-batch';
    await runSendCommand(uid, { version: 1, action: 'create', batchId: other, provider: 'coros', source: 'files' });
    await stageSendFile(uid, other, 'duplicate-row', 'Synthetic.fit', bytes);
    const reviewed = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: other });
    await runSendCommand(uid, { version: 1, action: 'confirm', batchId: other, revision: reviewed.revision });
    await admitSendRows(uid, other);
    expect((await db.collection('activitySyncQueue').get()).size).toBe(1);
    expect((await batchRef(uid, other).collection('rows').doc('duplicate-row').get()).data()?.status).toBe('duplicate');
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(bytes.length);
    expect(state.files.size).toBe(1);
    expect(state.files.has(`users/${uid}/activitySendSources/${id}/row-one.fit`)).toBe(true);
  });
  it.each([{ stopped: true }, { expiresAt: 1 }])('lets owners remove closed draft sources without Pro: %j', async window => {
    await prepare(); state.pro = false; await operationRef(uid, id).update(window);
    await runSendCommand(uid, { version: 1, action: 'remove', batchId: id, rowId: 'row-one' });
    await admitSendRows(uid, id);
    expect(state.files.size).toBe(0);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
  });
  it('no-ops a background transaction when account deletion wins, without recreating data', async () => {
    await db.doc(`userDeletionTombstones/${uid}`).set({ active: true });
    const action = vi.fn(async (tx: admin.firestore.Transaction) => { tx.set(batchRef(uid, id), { unsafe: true }); });
    await expect(guardedBackgroundSendTransaction(uid, action)).resolves.toBeUndefined();
    expect(action).not.toHaveBeenCalled(); expect((await batchRef(uid, id).get()).exists).toBe(false);
  });
  it('does not dispatch duplicate checks while an accepted operation is already running', async () => {
    const queue = await confirm(); await queue.ref.update({ destinationUploadID: 'accepted-canary' }); state.enqueue.mockClear();
    await runSendCommand(uid, { version: 1, action: 'check', batchId: id, rowId: 'row-one' });
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('expires sources without resetting accepted provider operations and prunes descendants at 30 days', async () => {
    const queue = await confirm(); await queue.ref.update({ destinationUploadID: 'accepted-canary' });
    const createdAt = (await operationRef(uid, id).get()).data()!.createdAt;
    await cleanupExpiredSends(createdAt + 8 * 86400_000);
    expect(state.files.size).toBe(0);
    expect((await queue.ref.get()).data()).toMatchObject({ destinationUploadID: 'accepted-canary', processed: false });
    await cleanupExpiredSends(createdAt + 31 * 86400_000);
    expect((await operationRef(uid, id).collection('rows').get()).empty).toBe(true);
    expect((await batchRef(uid, id).collection('rows').get()).empty).toBe(true);
  });
  it('excludes expired work before admission even if scheduled cleanup has not run', async () => {
    const reviewed = await prepare(); await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision });
    await operationRef(uid, id).update({ expiresAt: 1 });
    await admitSendRows(uid, id);
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ state: 'complete', finished: 1 });
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()).toMatchObject({ status: 'needs_action', recovery: 'choose_file' });
    expect(state.files.size).toBe(0);
  });
  it('cleans only the feature source and releases quota once', async () => {
    await prepare(); state.files.set('unrelated/original.fit', { bytes: Buffer.from('fixture'), metadata: {} });
    await cleanupSendSources(operationRef(uid, id)); await cleanupSendSources(operationRef(uid, id));
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
    expect(state.files.has('unrelated/original.fit')).toBe(true);
  });
});
