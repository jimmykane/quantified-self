import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createCOROSActivityFITFixture } from '../../test-utils/coros-activity-fit';
import { runSendCommand } from './commands';
import { stageSendFile } from './upload';
import { admitActivitySend, admitSendRows, projectSendDelivery, cleanupSendSources, cleanupExpiredSends, cleanupDeletedSendAccount } from './lifecycle';
import { Timestamp } from 'firebase-admin/firestore';
import { operationRef, batchRef, guardedBackgroundSendTransaction } from './store';
import { ACTIVITY_SEND_LIMITS } from '../../../shared/activity-send';
import { queueRetiredSendSourceCleanup } from './source-cleanup';
import { SEND_UPLOAD_CLEANUP_COLLECTION, SEND_UPLOAD_RESERVATION_MS, cleanupSendUploadReservations, sendUploadCleanupRef } from './upload-cleanup';

const state = vi.hoisted(() => ({ pro: true, account: 'reviewed-account', enqueue: vi.fn(async () => true), failDeleteOnce: false, failMetadataOnce: false, downloadFailure: undefined as undefined | { path: string; code: number }, downloaded: [] as string[], beforeSave: undefined as undefined | (() => Promise<void>), afterSave: undefined as undefined | (() => Promise<void>), afterDelete: undefined as undefined | (() => Promise<void>), files: new Map<string, { bytes: Buffer; metadata: Record<string, string>; generation?: string }>() }));
const cleanupState = vi.hoisted(() => ({ failPrefixOnce: false }));
vi.mock('../utils', async original => ({ ...await original<typeof import('../utils')>(), hasProAccess: async () => state.pro, enqueueActivitySyncTask: state.enqueue }));
vi.mock('../activity-sync/process-queue-item', () => ({ getDestinationConnectionStatus: async () => 'connected' }));
vi.mock('../coros/account', () => ({ getActiveCOROSTokenSnapshot: async () => ({ id: state.account }) }));
vi.mock('./store', async original => ({ ...await original<typeof import('./store')>(), describeFIT: async () => ({ name: 'Synthetic.fit', sport: 'Running', startDate: 1000, warnings: [] }) }));
vi.mock('firebase-admin', async original => ({ ...await original<typeof import('firebase-admin')>(), apps: [], initializeApp: (await original<typeof import('firebase-admin')>()).default.initializeApp, firestore: (await original<typeof import('firebase-admin')>()).default.firestore, storage: () => ({ bucket: () => ({ file: (path: string, objectOptions?: { generation?: string }) => ({
  save: async (bytes: Buffer, options: { metadata: { metadata: Record<string, string> } }) => { await state.beforeSave?.(); if (state.files.has(path)) throw Object.assign(new Error('exists'), { code: 412 }); state.files.set(path, { bytes, metadata: options.metadata.metadata }); await state.afterSave?.(); },
  getMetadata: async () => { if (state.failMetadataOnce) { state.failMetadataOnce = false; throw Object.assign(new Error('Synthetic metadata failure'), { code: 503 }); } const value = state.files.get(path); if (!value || objectOptions?.generation && objectOptions.generation !== (value.generation || '1')) throw Object.assign(new Error('missing'), { code: 404 }); return [{ size: value.bytes.length, generation: value.generation || '1', metadata: value.metadata }]; },
  download: async () => { state.downloaded.push(path); if (state.downloadFailure?.path === path) { const code = state.downloadFailure.code; state.downloadFailure = undefined; throw Object.assign(new Error('Synthetic download failure'), { code }); } const value = state.files.get(path); if (!value || objectOptions?.generation && objectOptions.generation !== (value.generation || '1')) throw Object.assign(new Error('missing'), { code: 404 }); return [value.bytes]; },
  delete: async () => { if (state.failDeleteOnce) { state.failDeleteOnce = false; throw new Error('Synthetic temporary storage failure'); } const value = state.files.get(path); if (!objectOptions?.generation || objectOptions.generation === (value?.generation || '1')) state.files.delete(path); await state.afterDelete?.(); },
}), deleteFiles: async ({ prefix }: { prefix: string }) => { if (cleanupState.failPrefixOnce) { cleanupState.failPrefixOnce = false; throw new Error('Synthetic prefix cleanup failure'); } for (const path of state.files.keys()) if (path.startsWith(prefix)) state.files.delete(path); } }) }) }));
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
    cleanupState.failPrefixOnce = false;
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await db.recursiveDelete(db.doc(`userDeletionTombstones/${uid}`));
    const queues = await db.collection('activitySyncQueue').get();
    for (const queue of queues.docs) await db.recursiveDelete(queue.ref);
    await db.recursiveDelete(db.collection(SEND_UPLOAD_CLEANUP_COLLECTION));
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
  it('ignores delivery progress events but still admits the original confirmation', async () => {
    const reviewed = await prepare();
    const before = await operationRef(uid, id).get();
    await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision });
    const confirmed = await operationRef(uid, id).get();
    await confirmed.ref.update({ finished: 1, updatedAt: Number(confirmed.data()!.updatedAt) + 1 });
    const progress = await confirmed.ref.get();
    const invoke = (prior: typeof before, after: typeof before) => admitActivitySend.run({
      data: { before: prior, after }, params: { uid, batchId: id },
    } as Parameters<typeof admitActivitySend.run>[0]);
    await invoke(confirmed, progress);
    expect(state.enqueue).not.toHaveBeenCalled();
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
    await confirmed.ref.update({ finished: 0 });
    await invoke(before, confirmed);
    expect(state.enqueue).toHaveBeenCalledOnce();
  });
  it('projects row progress without rewriting batch aggregates and makes duplicate projection a no-op', async () => {
    const queue = await confirm();
    const batch = batchRef(uid, id);
    const operation = operationRef(uid, id);
    const row = batch.collection('rows').doc('row-one');
    const prior = await db.getAll(batch, operation);
    await queue.ref.update({ providerOperationStartedAt: 1 });
    await projectSendDelivery(queue.ref);
    expect((await row.get()).data()).toMatchObject({ status: 'sending', attempts: 1 });
    const sending = await db.getAll(batch, operation);
    sending.forEach((snapshot, index) => expect(snapshot.updateTime!.isEqual(prior[index].updateTime!)).toBe(true));
    await queue.ref.update({ destinationUploadID: 'accepted-canary' });
    await projectSendDelivery(queue.ref);
    expect((await row.get()).data()?.status).toBe('processing');
    const projected = await db.getAll(row, batch, operation);
    await queue.ref.update({ dispatchedToCloudTask: 123 });
    await projectSendDelivery(queue.ref);
    const repeated = await db.getAll(row, batch, operation);
    repeated.forEach((snapshot, index) => expect(snapshot.updateTime!.isEqual(projected[index].updateTime!)).toBe(true));
    await queue.ref.update({ processed: true, resultStatus: 'success' });
    await projectSendDelivery(queue.ref);
    expect((await batch.get()).data()).toMatchObject({ finished: 1, state: 'complete' });
    expect((await operation.get()).data()?.finished).toBe(1);
    const completed = await db.getAll(row, batch, operation);
    await projectSendDelivery(queue.ref);
    (await db.getAll(row, batch, operation)).forEach((snapshot, index) => expect(snapshot.updateTime!.isEqual(completed[index].updateTime!)).toBe(true));
  });
  it('projects ten concurrent nonterminal deliveries without writing their shared batch', async () => {
    const original = await confirm();
    const batch = batchRef(uid, id);
    const operation = operationRef(uid, id);
    const writes = db.batch();
    writes.update(batch, { total: 11 }); writes.update(operation, { total: 11 });
    const queues = Array.from({ length: 10 }, (_, index) => db.collection('activitySyncQueue').doc(`parallel-${index}`));
    for (const queue of queues) {
      writes.set(queue, { ...original.data(), sendRowID: queue.id, providerOperationStartedAt: 1 });
      writes.set(batch.collection('rows').doc(queue.id), { id: queue.id, status: 'queued', recovery: 'none', message: 'Queued for background delivery.', attempts: 0 });
      writes.set(operation.collection('rows').doc(queue.id), { admitted: true, queueId: queue.id });
    }
    await writes.commit();
    const before = await db.getAll(batch, operation);
    await Promise.all(queues.map(queue => projectSendDelivery(queue)));
    (await db.getAll(batch, operation)).forEach((snapshot, index) => expect(snapshot.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
    for (const queue of queues) expect((await batch.collection('rows').doc(queue.id).get()).data()).toMatchObject({ status: 'sending', attempts: 1 });
  });
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
    const count = ACTIVITY_SEND_LIMITS.page + 1;
    for (let index = 0; index < count; index++) writes.set(db.doc(`users/${uid}/events/synthetic-${String(index).padStart(2, '0')}`), { name: 'Excluded synthetic merge', startDate: 1000 + index, isMerge: true });
    await writes.commit();
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const request = { version: 1 as const, action: 'prepare' as const, batchId: id, startDate: new Date(0).toISOString(), endDate: new Date(2000).toISOString() };
    const first = await runSendCommand(uid, request);
    expect(first.nextCursor).toBeTruthy();
    const recovered = await runSendCommand(uid, request);
    expect(recovered.nextCursor).toBe(first.nextCursor);
    expect((await batchRef(uid, id).get()).data()?.total).toBe(ACTIVITY_SEND_LIMITS.page);
    const last = await runSendCommand(uid, { ...request, cursor: recovered.nextCursor! });
    expect(last.nextCursor).toBeNull();
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: count, reviewed: true });
  });
  it.each(['selection', 'date range'])('bounds a saved %s preview and resumes each recording once without sending', async kind => {
    const eventIds = Array.from({ length: 11 }, (_, index) => `bounded-${String(index).padStart(2, '0')}`);
    for (const eventId of eventIds) await savedOriginal(eventId);
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const criteria = kind === 'selection' ? { eventIds: [...eventIds].reverse() } : { startDate: new Date(0).toISOString(), endDate: new Date(2000).toISOString() };
    const request = { version: 1 as const, action: 'prepare' as const, batchId: id, ...criteria, sources: [ServiceNames.GarminAPI] };
    const first = await runSendCommand(uid, request);
    expect(first.nextCursor).toBeTruthy();
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 5, reviewed: false });
    await expect(runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: first.revision })).rejects.toMatchObject({ code: 'failed-precondition' });
    const recovered = await runSendCommand(uid, request);
    expect(recovered.nextCursor).toBe(first.nextCursor);
    expect(state.downloaded).toHaveLength(5);
    const second = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
    expect(second.nextCursor).toBeTruthy(); expect(second.nextCursor).not.toBe(first.nextCursor);
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 10, reviewed: false });
    const last = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
    expect(last.nextCursor).toBeNull();
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 11, finished: 0, reviewed: true });
    expect(state.downloaded).toHaveLength(11); expect(new Set(state.downloaded).size).toBe(11);
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it.each(['selection', 'date range'])('yields a slow %s preview at its last durable recording without skipping the rest', async kind => {
    const eventIds = ['slow-one', 'slow-two'];
    for (const eventId of eventIds) await savedOriginal(eventId);
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const criteria = kind === 'selection' ? { eventIds } : { startDate: new Date(0).toISOString(), endDate: new Date(2000).toISOString() };
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now + (state.downloaded.length ? 25_000 : 0));
    try {
      const first = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, ...criteria, sources: [ServiceNames.GarminAPI] });
      expect(first.nextCursor).toBeTruthy();
      expect((await operationRef(uid, id).get()).data()).toMatchObject({ total: 1, lastEventId: 'slow-one', reviewed: false });
    } finally { clock.mockRestore(); }
    const last = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
    expect(last.nextCursor).toBeNull();
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 2, reviewed: true });
    expect(state.downloaded).toHaveLength(2); expect(new Set(state.downloaded).size).toBe(2);
    expect((await db.collection('activitySyncQueue').get()).empty).toBe(true);
  });
  it('resumes a retained fifty-row date cursor after the preview page size is reduced', async () => {
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const writes = db.batch();
    for (let index = 0; index < 51; index++) {
      const eventId = `legacy-${String(index).padStart(2, '0')}`;
      writes.set(db.doc(`users/${uid}/events/${eventId}`), { name: 'Synthetic excluded merge', startDate: 1000 + index, isMerge: true });
      if (index < 50) {
        writes.set(operationRef(uid, id).collection('rows').doc(eventId), { excluded: true, admitted: false, eventID: eventId, sourceServiceName: 'manualUpload' });
        writes.set(batchRef(uid, id).collection('rows').doc(eventId), { id: eventId, status: 'needs_action' });
      }
    }
    writes.update(operationRef(uid, id), {
      total: 50, finished: 50, revision: 50, nextCursor: 'retained-legacy-cursor', lastEventId: 'legacy-49', lastStartDate: 1049,
      savedSelection: { startDate: new Date(0).toISOString(), endDate: new Date(2000).toISOString(), sources: [ServiceNames.GarminAPI] },
    });
    writes.update(batchRef(uid, id), { total: 50, finished: 50, revision: 50, savedSelectionReady: true });
    await writes.commit();
    const resumed = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
    expect(resumed.nextCursor).toBeNull();
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 51, finished: 51, reviewed: true });
    expect((await operationRef(uid, id).collection('rows').get()).size).toBe(51);
    expect(state.downloaded).toHaveLength(0); expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('denies new sends without Pro before creating any state', async () => {
    state.pro = false;
    await expect(create()).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await operationRef(uid, id).get()).exists).toBe(false);
  });
  it('keeps delayed cleanup after a successful inline delete for an unknown late write', async () => {
    await create();
    state.beforeSave = async () => { await db.recursiveDelete(db.doc(`users/${uid}`)); state.failMetadataOnce = true; };
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toThrow('Synthetic metadata failure');
    const path = `users/${uid}/activitySendSources/${id}/row-one.fit`;
    const reservation = await sendUploadCleanupRef(path).get();
    expect(reservation.exists).toBe(true);
    await cleanupSendUploadReservations(Date.now(), uid);
    expect((await reservation.ref.get()).exists).toBe(true);
    state.files.set(path, { bytes: createCOROSActivityFITFixture(), metadata: { sendDigest: reservation.data()!.digest } });
    await cleanupSendUploadReservations(Date.now() + SEND_UPLOAD_RESERVATION_MS + 1, uid);
    expect(state.files.size).toBe(0);
    expect((await reservation.ref.get()).exists).toBe(false);
    expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
  });
  it('retains a failed active preview and safely retires its reservation after resumption', async () => {
    await create(); state.failMetadataOnce = true;
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toThrow('Synthetic metadata failure');
    const path = `users/${uid}/activitySendSources/${id}/row-one.fit`;
    await cleanupSendUploadReservations(Date.now() + SEND_UPLOAD_RESERVATION_MS + 1);
    expect(state.files.size).toBe(1);
    expect((await sendUploadCleanupRef(path).get()).exists).toBe(true);
    await stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture());
    await cleanupSendUploadReservations(Date.now() + SEND_UPLOAD_RESERVATION_MS + 1);
    expect(state.files.size).toBe(1);
    expect((await sendUploadCleanupRef(path).get()).exists).toBe(false);
  });
  it('continues an interrupted saved preview from private criteria after the browser loses its selection', async () => {
    const writes = db.batch();
    const count = ACTIVITY_SEND_LIMITS.page + 1;
    for (let index = 0; index < count; index++) writes.set(db.doc(`users/${uid}/events/resume-${String(index).padStart(2, '0')}`), { name: 'Synthetic excluded merge', startDate: 1000 + index, isMerge: true });
    await writes.commit();
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const first = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, startDate: new Date(0).toISOString(), endDate: new Date(2000).toISOString(), sources: [ServiceNames.COROSAPI] });
    expect(first.nextCursor).toBeTruthy();
    expect((await batchRef(uid, id).get()).data()).not.toHaveProperty('savedSelection');
    const resumed = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
    expect(resumed.nextCursor).toBeNull();
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: count, finished: count, reviewed: true });
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
    const visible = batchRef(uid, id).collection('rows').doc('row-one');
    await projectSendDelivery(queue.ref); expect((await visible.get()).data()?.attempts).toBe(0);
    await runSendCommand(uid, { version: 1, action: 'retry', batchId: id, rowId: 'row-one' });
    await projectSendDelivery(queue.ref); expect((await visible.get()).data()?.attempts).toBe(0);
    expect((await queue.ref.get()).data()).toMatchObject({ processed: false, skippedReason: null });
    await queue.ref.update({ providerOperationStartedAt: 1 }); await projectSendDelivery(queue.ref);
    expect((await visible.get()).data()?.attempts).toBe(1);
    expect(state.files.size).toBe(1);
  });
  it('can stop an unclaimed Pro-lapsed result and release its reservation', async () => {
    const queue = await confirm(); await queue.ref.update({ processed: true, resultStatus: 'skipped', skippedReason: 'no_pro_access' });
    await projectSendDelivery(queue.ref); await runSendCommand(uid, { version: 1, action: 'stop', batchId: id }); await projectSendDelivery(queue.ref);
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()?.status).toBe('stopped');
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
  });
  it('releases a confirmed-failure source when stopping the remaining batch without erasing its result', async () => {
    await prepare(); await stageSendFile(uid, id, 'row-two', 'Second.fit', createCOROSActivityFITFixture({ sport: 2 }));
    const reviewed = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id });
    await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision }); await admitSendRows(uid, id);
    const first = operationRef(uid, id).collection('rows').doc('row-one');
    const queue = db.collection('activitySyncQueue').doc((await first.get()).data()!.queueId);
    await queue.update({ processed: true, resultStatus: 'skipped', sendConfirmedFailure: true, providerOperationStartedAt: 1, destinationUploadID: 'failed-upload', destinationProviderUserID: 'reviewed-account', destinationWorkoutKey: 'failed-key' });
    await projectSendDelivery(queue);
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ state: 'confirmed', total: 2, finished: 1 });
    expect(state.files.size).toBe(2); // An open confirmed failure keeps its source available for explicit retry.
    state.pro = false; state.enqueue.mockClear();
    await runSendCommand(uid, { version: 1, action: 'stop', batchId: id }); await admitSendRows(uid, id);
    expect((await first.get()).data()?.reservedBytes).toBe(0);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
    expect(state.files.size).toBe(0);
    expect((await queue.get()).data()).toMatchObject({ processed: true, resultStatus: 'skipped', sendConfirmedFailure: true, providerOperationStartedAt: 1, destinationUploadID: 'failed-upload', destinationProviderUserID: 'reviewed-account', destinationWorkoutKey: 'failed-key' });
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()).toMatchObject({ status: 'needs_action', recovery: 'retry_send' });
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 2, finished: 2, stopped: true });
    state.pro = true;
    await expect(runSendCommand(uid, { version: 1, action: 'retry', batchId: id, rowId: 'row-one' })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('retries cleanup of a stopped confirmed failure after Storage fails without losing identifiers or quota', async () => {
    const queue = await confirm();
    await queue.ref.update({ processed: true, resultStatus: 'skipped', sendConfirmedFailure: true, providerOperationStartedAt: 1, destinationUploadID: 'failed-upload' });
    await projectSendDelivery(queue.ref); state.failDeleteOnce = true; state.pro = false;
    await expect(runSendCommand(uid, { version: 1, action: 'stop', batchId: id })).rejects.toThrow('Synthetic temporary storage failure');
    expect((await operationRef(uid, id).get()).data()).not.toHaveProperty('stopCursor');
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBeGreaterThan(0);
    expect(state.files.size).toBe(1);
    await admitSendRows(uid, id); await admitSendRows(uid, id);
    expect((await operationRef(uid, id).get()).data()?.stopComplete).toBe(true);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ total: 1, finished: 1, stopped: true });
    expect((await queue.ref.get()).data()).toMatchObject({ destinationUploadID: 'failed-upload', providerOperationStartedAt: 1, sendConfirmedFailure: true });
    expect(state.files.size).toBe(0);
  });
  it.each([false, true])('releases a later confirmed failure after Stop completes, with cleanup failure %s', async cleanupFails => {
    const queue = await confirm();
    await queue.ref.update({ destinationUploadID: 'accepted-upload', destinationWorkoutKey: 'accepted-key', providerOperationStartedAt: 1 });
    await projectSendDelivery(queue.ref); state.pro = false;
    await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
    expect((await operationRef(uid, id).get()).data()?.stopComplete).toBe(true);
    expect(state.files.size).toBe(1);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBeGreaterThan(0);
    state.enqueue.mockClear();
    await queue.ref.update({ processed: true, resultStatus: 'skipped', sendConfirmedFailure: true });
    if (cleanupFails) {
      state.failDeleteOnce = true;
      await expect(projectSendDelivery(queue.ref)).rejects.toThrow('Synthetic temporary storage failure');
      expect(state.files.size).toBe(1);
      expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBeGreaterThan(0);
    }
    await projectSendDelivery(queue.ref); await projectSendDelivery(queue.ref);
    expect(state.files.size).toBe(0);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ stopped: true, state: 'complete', total: 1, finished: 1 });
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()).toMatchObject({ status: 'needs_action', recovery: 'retry_send' });
    expect((await queue.ref.get()).data()).toMatchObject({ processed: true, resultStatus: 'skipped', sendConfirmedFailure: true, destinationUploadID: 'accepted-upload', destinationWorkoutKey: 'accepted-key', providerOperationStartedAt: 1 });
    state.pro = true;
    await expect(runSendCommand(uid, { version: 1, action: 'retry', batchId: id, rowId: 'row-one' })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it('preserves a saved archive original when its accepted upload fails after Stop completes', async () => {
    const path = await savedOriginal('saved-late-failure');
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const reviewed = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, eventIds: ['saved-late-failure'], sources: [ServiceNames.GarminAPI] });
    await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision }); await admitSendRows(uid, id);
    const queue = (await db.collection('activitySyncQueue').get()).docs[0];
    await queue.ref.update({ destinationUploadID: 'accepted-upload', providerOperationStartedAt: 1 });
    await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
    expect((await operationRef(uid, id).get()).data()?.stopComplete).toBe(true);
    await queue.ref.update({ processed: true, resultStatus: 'skipped', sendConfirmedFailure: true });
    await projectSendDelivery(queue.ref); await projectSendDelivery(queue.ref);
    expect(state.files.has(path)).toBe(true);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).exists).toBe(false);
    expect((await batchRef(uid, id).get()).data()).toMatchObject({ stopped: true, state: 'complete', total: 1, finished: 1 });
    expect((await queue.ref.get()).data()?.destinationUploadID).toBe('accepted-upload');
  });
  it('preserves saved archive originals when stopping a confirmed processing failure', async () => {
    const path = await savedOriginal('saved-failure');
    await runSendCommand(uid, { version: 1, action: 'create', batchId: id, provider: 'coros', source: 'saved' });
    const reviewed = await runSendCommand(uid, { version: 1, action: 'prepare', batchId: id, eventIds: ['saved-failure'], sources: [ServiceNames.GarminAPI] });
    await runSendCommand(uid, { version: 1, action: 'confirm', batchId: id, revision: reviewed.revision }); await admitSendRows(uid, id);
    const queue = (await db.collection('activitySyncQueue').get()).docs[0];
    await queue.ref.update({ processed: true, resultStatus: 'skipped', sendConfirmedFailure: true, providerOperationStartedAt: 1, destinationUploadID: 'failed-upload' });
    await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
    expect(state.files.has(path)).toBe(true);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).exists).toBe(false);
    expect((await queue.ref.get()).data()?.destinationUploadID).toBe('failed-upload');
  });
  it('keeps an uncertain operation and its temporary source when stopping the batch', async () => {
    const queue = await confirm();
    await queue.ref.update({ processed: true, resultStatus: 'manual_reconciliation_required', providerOperationStartedAt: 1, sendConfirmedFailure: false });
    await runSendCommand(uid, { version: 1, action: 'stop', batchId: id });
    expect(state.files.size).toBe(1);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBeGreaterThan(0);
    expect((await batchRef(uid, id).collection('rows').doc('row-one').get()).data()).toMatchObject({ status: 'needs_action', recovery: 'review_provider' });
    expect((await queue.ref.get()).data()).toMatchObject({ resultStatus: 'manual_reconciliation_required', providerOperationStartedAt: 1 });
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
  it('redrives a late account-deletion upload when inline Storage cleanup fails', async () => {
    await create();
    state.beforeSave = async () => {
      await db.recursiveDelete(db.doc(`users/${uid}`));
      // Account prefix cleanup completed before the in-flight upload appeared.
      await cleanupDeletedSendAccount(uid);
      state.failDeleteOnce = true;
    };
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toThrow('Synthetic temporary storage failure');
    expect(state.files.size).toBe(1);
    await cleanupExpiredSends(Date.now() + 86400_000);
    expect(state.files.size).toBe(0);
    expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
    expect((await operationRef(uid, id).get()).exists).toBe(false);
  });
  it('retries failed orphan cleanup without losing its lease or touching archived originals', async () => {
    await prepare();
    const archive = await savedOriginal('retained-archive');
    const path = `users/${uid}/activitySendSources/${id}/row-one.fit`;
    const marker = sendUploadCleanupRef(path);
    await db.recursiveDelete(db.doc(`users/${uid}`));
    state.failDeleteOnce = true;
    const due = Date.now() + SEND_UPLOAD_RESERVATION_MS + 1;
    await expect(cleanupSendUploadReservations(due)).rejects.toThrow('must be retried');
    const failed = (await marker.get()).data()!;
    expect(failed.leaseUntil.toMillis()).toBeGreaterThan(due);
    expect(failed.cleanupAfter.toMillis()).toBeGreaterThan(due);
    expect(state.files.has(path)).toBe(true);
    await cleanupSendUploadReservations(due + 31 * 60_000);
    expect((await marker.get()).exists).toBe(false);
    expect(state.files.has(path)).toBe(false);
    expect(state.files.has(archive)).toBe(true);
    expect((await db.doc(`users/${uid}`).get()).exists).toBe(false);
  });
  it('reconciles account reservations even when the independent prefix cleanup fails', async () => {
    await prepare();
    const archive = await savedOriginal('retained-archive');
    await db.recursiveDelete(db.doc(`users/${uid}`));
    cleanupState.failPrefixOnce = true;
    await expect(cleanupDeletedSendAccount(uid, Date.now() + SEND_UPLOAD_RESERVATION_MS + 1)).rejects.toThrow('must be retried');
    expect((await db.collection(SEND_UPLOAD_CLEANUP_COLLECTION).get()).empty).toBe(true);
    expect(state.files.has(archive)).toBe(true);
    expect(state.files.size).toBe(1);
  });
  it('honors an account tombstone even while committed source documents remain', async () => {
    await prepare();
    await db.doc(`userDeletionTombstones/${uid}`).set({ active: true });
    await cleanupSendUploadReservations(Date.now() + SEND_UPLOAD_RESERVATION_MS + 1, uid);
    expect(state.files.size).toBe(0);
    expect((await db.collection(SEND_UPLOAD_CLEANUP_COLLECTION).get()).empty).toBe(true);
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()?.reservedBytes).toBeGreaterThan(0);
  });
  it('preserves a replacement cleanup claim and newer generation after an older delete finishes', async () => {
    await prepare();
    const path = `users/${uid}/activitySendSources/${id}/row-one.fit`;
    const marker = sendUploadCleanupRef(path);
    const initial = (await marker.get()).data()!;
    await db.recursiveDelete(db.doc(`users/${uid}`));
    state.afterDelete = async () => {
      state.afterDelete = undefined;
      await marker.set({ ...initial, leaseID: 'replacement-cleaner', leaseUntil: Timestamp.fromMillis(Date.now() + 3600_000), cleanupAfter: Timestamp.fromMillis(Date.now() + 3600_000) });
      state.files.set(path, { bytes: createCOROSActivityFITFixture(), metadata: { sendDigest: initial.digest }, generation: '2' });
    };
    await cleanupSendUploadReservations(Date.now() + SEND_UPLOAD_RESERVATION_MS + 1);
    expect((await marker.get()).data()?.leaseID).toBe('replacement-cleaner');
    expect(state.files.get(path)?.generation).toBe('2');
    await cleanupSendUploadReservations(Date.now() + 2 * 3600_000);
    expect((await marker.get()).exists).toBe(false);
    expect(state.files.has(path)).toBe(false);
  });
  it('retains mismatched object identity for investigation instead of deleting different bytes', async () => {
    await prepare();
    const path = `users/${uid}/activitySendSources/${id}/row-one.fit`;
    await db.recursiveDelete(db.doc(`users/${uid}`));
    state.files.get(path)!.metadata.sendDigest = 'different-private-digest';
    await expect(cleanupSendUploadReservations(Date.now() + SEND_UPLOAD_RESERVATION_MS + 1)).rejects.toThrow('must be retried');
    expect(state.files.has(path)).toBe(true);
    expect((await sendUploadCleanupRef(path).get()).exists).toBe(true);
  });
  it('reconciles multiple reservation pages while bounding each run and retaining remaining work', async () => {
    const digest = 'a'.repeat(64);
    let writes = db.batch();
    for (let index = 0; index < 501; index++) {
      const rowID = `orphan-${index}`;
      const path = `users/${uid}/activitySendSources/${id}/${rowID}.fit`;
      writes.set(sendUploadCleanupRef(path), { version: 1, userID: uid, batchID: id, rowID, path, digest, cleanupAfter: Timestamp.fromMillis(0) });
      if (index === 449) { await writes.commit(); writes = db.batch(); }
    }
    await writes.commit();
    await cleanupSendUploadReservations();
    expect((await db.collection(SEND_UPLOAD_CLEANUP_COLLECTION).get()).size).toBe(1);
    await cleanupSendUploadReservations();
    expect((await db.collection(SEND_UPLOAD_CLEANUP_COLLECTION).get()).empty).toBe(true);
    expect((await operationRef(uid, id).get()).exists).toBe(false);
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).exists).toBe(false);
  }, 60_000);
  it('rejects forged cleanup paths without deleting an archive or the temporary source', async () => {
    await prepare();
    const archive = await savedOriginal('retained-archive');
    const path = `users/${uid}/activitySendSources/${id}/row-one.fit`;
    await sendUploadCleanupRef(path).update({ path: archive, cleanupAfter: Timestamp.fromMillis(0) });
    await expect(cleanupSendUploadReservations()).rejects.toThrow('must be retried');
    expect(state.files.has(archive)).toBe(true);
    expect(state.files.has(path)).toBe(true);
    expect((await sendUploadCleanupRef(path).get()).exists).toBe(true);
  });
  it('blocks staging behind an active cleanup claim before uploading or changing quota', async () => {
    await create(); state.failMetadataOnce = true;
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toThrow('Synthetic metadata failure');
    const path = `users/${uid}/activitySendSources/${id}/row-one.fit`;
    const marker = sendUploadCleanupRef(path);
    await marker.update({ leaseID: 'synthetic-cleaner', leaseUntil: Timestamp.fromMillis(Date.now() + SEND_UPLOAD_RESERVATION_MS) });
    const before = (await db.doc(`users/${uid}/activitySendQuota/current`).get()).data();
    state.beforeSave = async () => { throw new Error('No Storage write may begin behind cleanup.'); };
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toMatchObject({ code: 'unavailable' });
    expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()).toEqual(before);
    expect(state.files.size).toBe(1);
  });
  it('rejects late adoption after a cleanup claim supersedes its reservation', async () => {
    await create();
    state.afterSave = async () => {
      await sendUploadCleanupRef(`users/${uid}/activitySendSources/${id}/row-one.fit`).update({ leaseID: 'synthetic-cleaner', leaseUntil: Timestamp.fromMillis(Date.now() + SEND_UPLOAD_RESERVATION_MS) });
    };
    await expect(stageSendFile(uid, id, 'row-one', 'Synthetic.fit', createCOROSActivityFITFixture())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await operationRef(uid, id).collection('rows').doc('row-one').get()).data()).not.toHaveProperty('originalFile');
    expect(state.files.size).toBe(0);
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
  it.each([{ totalRetryCount: 0, retryCount: 0 }, { totalRetryCount: 3, retryCount: 1 }, { retryCount: 2 }, { totalRetryCount: 0, retryCount: 2 }])('keeps completed attempt counts across explicit failure retries: %j', async retries => {
    const queue = await confirm();
    await queue.ref.update({ ...retries, ...(retries.totalRetryCount === undefined ? { totalRetryCount: admin.firestore.FieldValue.delete() } : {}) });
    const priorRetries = retries.totalRetryCount || retries.retryCount || 0;
    const visible = batchRef(uid, id).collection('rows').doc('row-one');
    state.enqueue.mockClear();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await queue.ref.update({ providerOperationStartedAt: attempt, destinationUploadID: `failed-${attempt}`, processed: true, resultStatus: 'skipped', sendConfirmedFailure: true });
      await projectSendDelivery(queue.ref);
      expect((await visible.get()).data()?.attempts).toBe(priorRetries + attempt);
      await runSendCommand(uid, { version: 1, action: 'retry', batchId: id, rowId: 'row-one' });
      await projectSendDelivery(queue.ref); await projectSendDelivery(queue.ref);
      expect((await visible.get()).data()).toMatchObject({ status: 'queued', attempts: priorRetries + attempt });
      expect((await visible.get()).data()).not.toHaveProperty('priorAttempts');
      const retried = (await queue.ref.get()).data()!;
      expect(retried).toMatchObject({ providerOperationStartedAt: null, destinationUploadID: null, retryCount: 0 });
      expect(retried.totalRetryCount).toBe(retries.totalRetryCount);
      await expect(runSendCommand(uid, { version: 1, action: 'retry', batchId: id, rowId: 'row-one' })).rejects.toMatchObject({ code: 'failed-precondition' });
      await projectSendDelivery(queue.ref);
      expect((await visible.get()).data()?.attempts).toBe(priorRetries + attempt);
    }
    expect(state.enqueue).toHaveBeenCalledTimes(2);
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
  it.each(['public', 'private'] as const)('retains the expiry marker after partial %s history pruning and resumes nested cleanup', async target => {
    const queue = await confirm(); await queue.ref.update({ destinationUploadID: 'accepted-canary' });
    const op = operationRef(uid, id); const visible = batchRef(uid, id);
    const createdAt = (await op.get()).data()!.createdAt;
    await cleanupExpiredSends(createdAt + 8 * 86400_000);
    const privateNested = op.collection('rows').doc('row-one').collection('details').doc('nested');
    const extraPrivate = op.collection('retained').doc('entry').collection('details').doc('nested');
    const publicNested = visible.collection('rows').doc('row-one').collection('details').doc('nested');
    const unrelated = db.doc(`users/${uid}/events/retained-archive`);
    await Promise.all([privateNested.set({ synthetic: true }), extraPrivate.set({ synthetic: true }), publicNested.set({ synthetic: true }), unrelated.set({ synthetic: true })]);
    const recursiveDelete = db.recursiveDelete.bind(db);
    let injected = false;
    const pruning = vi.spyOn(db, 'recursiveDelete').mockImplementation(async ref => {
      const selected = target === 'public' ? ref.path === visible.path : ref.path === op.path || ref.path === op.collection('rows').path;
      if (!injected && selected) {
        injected = true;
        // Fault injection models the SDK deleting a target/root while a descendant delete fails.
        // These leaf/root deletes deliberately leave an orphan for the next recursive cleanup.
        if (target === 'public') await visible.delete();
        else if (ref.path === op.path) await op.delete();
        else await op.collection('rows').doc('row-one').delete();
        throw new Error('Synthetic partial history pruning failure');
      }
      return recursiveDelete(ref);
    });
    try {
      await expect(cleanupExpiredSends(createdAt + 31 * 86400_000)).rejects.toThrow('cleanup must be retried');
      expect(injected).toBe(true); expect((await op.get()).exists).toBe(true);
      expect((await (target === 'public' ? publicNested : privateNested).get()).exists).toBe(true);
      await cleanupExpiredSends(createdAt + 31 * 86400_000);
      expect((await op.get()).exists).toBe(false); expect((await visible.get()).exists).toBe(false);
      for (const nested of [privateNested, extraPrivate, publicNested]) expect((await nested.get()).exists).toBe(false);
      expect((await unrelated.get()).exists).toBe(true);
      expect((await queue.ref.get()).data()?.destinationUploadID).toBe('accepted-canary');
      expect((await db.doc(`users/${uid}/activitySendQuota/current`).get()).data()?.bytes).toBe(0);
    } finally { pruning.mockRestore(); }
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
