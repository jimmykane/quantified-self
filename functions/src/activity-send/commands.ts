import { FieldValue } from 'firebase-admin/firestore';
import { reconcileStoppedSend } from './lifecycle';
import * as admin from 'firebase-admin';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ActivitySendCommand, ACTIVITY_SEND_PROVIDERS, ACTIVITY_SEND_LIMITS, ActivitySendRow, isActivitySendProvider } from '../../../shared/activity-send';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE, enqueueActivitySyncTask } from '../utils';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { eligibleOriginal } from '../activity-sync/historical-send';
import { buildActivitySyncQueueItemId } from '../activity-sync/queue';
import { getHistoricalActivityRouteId } from '../../../shared/activity-sync-routes';
import { getActivitySyncMetadataDocId } from '../activity-sync/metadata';
import { describeSavedFIT, operationRef, batchRef, guardedSendTransaction, providerAccount, publicBatch, requireDraft, SendOperation, SendSource } from './store';
import { sendIdentifier, projectSendQueue } from './policy';

const SOURCES = [ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI, 'manualUpload'] as const;
export async function runSendCommand(uid: string, request: ActivitySendCommand) {
  if (!request || request.version !== 1) throw new HttpsError('invalid-argument', 'Unsupported send version.');
  const id = sendIdentifier(request.batchId);
  const ref = operationRef(uid, id);
  if (!['check', 'stop', 'remove'].includes(request.action) && !(await hasProAccess(uid))) throw new HttpsError('permission-denied', PRO_REQUIRED_MESSAGE);
  if (request.action === 'create') {
    if (!isActivitySendProvider(request.provider) || !['files', 'saved'].includes(request.source)) throw new HttpsError('invalid-argument', 'Choose a supported destination and source.');
    const account = await providerAccount(uid, request.provider);
    await guardedSendTransaction(uid, async tx => {
      const prior = await tx.get(ref);
      if (prior.exists) {
        const data = prior.data()!;
        if (data.provider !== request.provider || data.source !== request.source) throw new HttpsError('already-exists', 'This reference belongs to another send.');
        return;
      }
      const now = Date.now();
      const data: SendOperation = { id, provider: request.provider, source: request.source, providerAccount: account, accountLabel: `Connected ${request.provider === 'coros' ? 'COROS' : request.provider === 'suunto' ? 'Suunto' : 'Wahoo'} account`, state: 'draft', revision: 0, reviewed: false, createdAt: now, updatedAt: now, expiresAt: now + 86400_000, cleanupAfter: Timestamp.fromMillis(now + 86400_000), total: 0, finished: 0 };
      tx.set(ref, data); tx.set(batchRef(uid, id), publicBatch(data));
    });
    return { batchId: id, revision: 0 };
  }
  if (request.action === 'prepare') {
    const draft = await requireDraft(uid, id);
    if (await providerAccount(uid, draft.provider) !== draft.providerAccount) throw new HttpsError('failed-precondition', 'Destination account changed. Create a new draft.');
    if (draft.source === 'saved') await prepareSaved(uid, draft, request);
    return guardedSendTransaction(uid, async tx => {
      const current = (await tx.get(ref)).data() as SendOperation;
      if (current.state !== 'draft' || current.stopped || current.expiresAt <= Date.now()) throw new HttpsError('failed-precondition', 'Draft changed.');
      const rows = await tx.get(ref.collection('rows'));
      if (!rows.size && !(current.source === 'saved' && current.savedSelection && !current.nextCursor) || rows.docs.some(row => !row.data().originalFile && !row.data().excluded && !row.data().removed)) throw new HttpsError('failed-precondition', 'Finish selecting and validating activities first.');
      current.reviewed = !current.nextCursor; current.updatedAt = Date.now();
      tx.set(ref, current); tx.set(batchRef(uid, id), publicBatch(current));
      return { batchId: id, revision: current.revision, nextCursor: current.nextCursor || null };
    });
  }
  if (request.action === 'confirm') {
    const snapshot = (await ref.get()).data() as SendOperation | undefined;
    if (!snapshot) throw new HttpsError('not-found', 'Send was not found.');
    if (await providerAccount(uid, snapshot.provider) !== snapshot.providerAccount) throw new HttpsError('failed-precondition', 'Destination account changed. Review a new draft.');
    return guardedSendTransaction(uid, async tx => {
      const current = (await tx.get(ref)).data() as SendOperation;
      if (current.state !== 'draft') return { batchId: id, revision: current.revision };
      if (!current.reviewed || current.stopped || current.revision !== request.revision || current.total <= current.finished || current.expiresAt <= Date.now()) throw new HttpsError('failed-precondition', 'Review the current selection before sending.');
      current.state = 'confirmed'; current.updatedAt = Date.now(); current.expiresAt = Date.now() + 7 * 86400_000; current.cleanupAfter = Timestamp.fromMillis(current.expiresAt);
      tx.set(ref, current); tx.set(batchRef(uid, id), publicBatch(current));
      return { batchId: id, revision: current.revision };
    });
  }
  if (request.action === 'remove') {
    await requireDraft(uid, id, true);
    const rowId = sendIdentifier(request.rowId);
    await guardedSendTransaction(uid, async tx => {
      const current = (await tx.get(ref)).data() as SendOperation;
      const rowRef = ref.collection('rows').doc(rowId);
      const row = await tx.get(rowRef);
      if (current.state !== 'draft' || !row.exists || row.data()?.removed) return;
      // Commit cleanup intent with the removal; the retry-enabled operation trigger owns completion.
      tx.update(rowRef, { removed: true, cleanupPending: true, cleanupRevision: Number(row.data()?.cleanupRevision || 0) + 1 });
      // Display rows are leaves by contract and Rules; no nested data can exist.
      tx.delete(batchRef(uid, id).collection('rows').doc(rowId));
      current.revision++; current.reviewed = false; current.total--; if (row.data()?.excluded) current.finished--; current.updatedAt = Date.now();
      tx.set(ref, current); tx.set(batchRef(uid, id), publicBatch(current));
    });
    return { batchId: id, revision: (await ref.get()).data()?.revision || 0 };
  }
  if (request.action === 'stop') {
    await guardedSendTransaction(uid, async tx => {
      const snapshot = await tx.get(ref);
      const visible = await tx.get(batchRef(uid, id));
      if (!snapshot.exists) throw new HttpsError('not-found', 'Send was not found.');
      tx.update(ref, { stopped: true, updatedAt: Date.now() });
      if (visible.exists) tx.update(visible.ref, { stopped: true, updatedAt: Date.now() });
    });
    await reconcileStoppedSend(uid, id);
    return { batchId: id, revision: 0 };
  }
  if (request.action === 'check' || request.action === 'retry') {
    const rowId = sendIdentifier(request.rowId);
    const source = (await ref.collection('rows').doc(rowId).get()).data() as SendSource | undefined;
    if (!source?.queueId) throw new HttpsError('failed-precondition', 'No provider operation is available.');
    if (request.action === 'retry') {
      const operation = (await ref.get()).data() as SendOperation;
      if (await providerAccount(uid, operation.provider) !== operation.providerAccount) throw new HttpsError('failed-precondition', 'Destination account changed. Review a new draft.');
    }
    const queueRef = admin.firestore().collection('activitySyncQueue').doc(source.queueId);
    const dispatch = await guardedSendTransaction(uid, async tx => {
      const snapshot = await tx.get(queueRef); const queue = snapshot.data();
      if (!queue || queue.userID !== uid || queue.sendBatchID !== id || queue.sendRowID !== rowId) throw new HttpsError('not-found', 'Delivery was not found.');
      const operation = (await tx.get(ref)).data();
      if (request.action === 'retry' && (!operation || operation.expiresAt <= Date.now() || operation.stopped)) throw new HttpsError('failed-precondition', 'The retry window expired or this batch was stopped. Create a new draft after reviewing the provider.');
      const recovery = projectSendQueue(queue).recovery;
      const safeResume = ['upgrade', 'reconnect'].includes(recovery) && !queue.providerOperationStartedAt && !queue.destinationUploadID;
      if (request.action === 'retry' && recovery !== 'retry_send' && !safeResume) throw new HttpsError('failed-precondition', 'An uncertain or accepted upload cannot be resent.');
      if (request.action === 'check' && queue.processed && recovery !== 'check_status') throw new HttpsError('failed-precondition', 'This delivery has a final result; there is no pending status to check.');
      if (request.action === 'check' && !queue.destinationUploadID) throw new HttpsError('failed-precondition', 'Check the provider directly; no safe operation identifier is available.');
      if (request.action === 'check' && !queue.processed) return null;
      const dateCreated = Math.max(Date.now(), Number(queue.dateCreated) + 1);
      tx.update(queueRef, { dateCreated, processed: false, resultStatus: null, skippedReason: null, deferredReason: null, dispatchedToCloudTask: null, ...(request.action === 'retry' ? { destinationUploadID: null, destinationProviderUserID: null, destinationWorkoutKey: null, destinationInfoCode: null, providerOperationStartedAt: null, destinationUploadContinuation: null, destinationExpectedWorkoutTypeID: FieldValue.delete(), retryCount: 0, sendConfirmedFailure: false } : {}) });
      return dateCreated;
    });
    if (dispatch !== null) await enqueueActivitySyncTask(source.queueId, dispatch);
    return { batchId: id, revision: 0 };
  }
  throw new HttpsError('invalid-argument', 'Unsupported send action.');
}

async function prepareSaved(uid: string, draft: SendOperation, request: Extract<ActivitySendCommand, { action: 'prepare' }>) {
  const hasSelection = request.eventIds !== undefined || request.startDate !== undefined || request.endDate !== undefined || request.sources !== undefined;
  if (!hasSelection) {
    if (!draft.savedSelection) throw new HttpsError('failed-precondition', 'Preview a saved selection before continuing.');
    request = { ...request, ...draft.savedSelection, ...(request.cursor ? { cursor: request.cursor } : { cursor: draft.nextCursor || undefined }) };
  }
  if (request.sources !== undefined && !Array.isArray(request.sources) || request.eventIds !== undefined && !Array.isArray(request.eventIds)) throw new HttpsError('invalid-argument', 'Choose valid activity sources.');
  if (request.sources && (request.sources.length > SOURCES.length || request.sources.some(source => !SOURCES.includes(source as typeof SOURCES[number])))) throw new HttpsError('invalid-argument', 'Choose only the supported activity sources.');
  const sources = [...new Set(request.sources || [...SOURCES])].sort();
  if (!sources.length) throw new HttpsError('invalid-argument', 'Choose activity sources.');
  if (request.eventIds !== undefined) {
    if (!request.eventIds.length || request.eventIds.length > ACTIVITY_SEND_LIMITS.files) throw new HttpsError('invalid-argument', 'Select up to 50 activities at a time.');
    request = { ...request, eventIds: [...new Set(request.eventIds.map(sendIdentifier))].sort() };
  } else {
    const from = Date.parse(request.startDate || ''); const to = Date.parse(request.endDate || '');
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to > Date.now() + 86400_000) throw new HttpsError('invalid-argument', 'Choose a valid date range.');
    request = { ...request, startDate: new Date(from).toISOString(), endDate: new Date(to).toISOString() };
  }
  const savedSelection: SendOperation['savedSelection'] = { sources, ...(request.eventIds ? { eventIds: request.eventIds } : { startDate: request.startDate!, endDate: request.endDate! }) };
  const signature = createHash('sha256').update(JSON.stringify(savedSelection)).digest('hex');
  if (draft.selectionKey && draft.selectionKey !== signature) throw new HttpsError('failed-precondition', 'Selection changed. Create a new draft.');
  if ((request.cursor || null) !== (draft.nextCursor || null)) {
    if (draft.selectionKey === signature && (request.cursor || null) === draft.previousCursor) return; // Recover a lost page reply without repeating its work.
    throw new HttpsError('failed-precondition', 'Preview cursor is no longer current.');
  }
  await guardedSendTransaction(uid, async tx => {
    const ref = operationRef(uid, draft.id); const current = (await tx.get(ref)).data() as SendOperation;
    const visible = await tx.get(batchRef(uid, draft.id));
    if (current.state !== 'draft' || current.stopped || current.expiresAt <= Date.now() || current.selectionKey && current.selectionKey !== signature || (current.nextCursor || null) !== (request.cursor || null)) throw new HttpsError('failed-precondition', 'The selection changed. Review a new draft.');
    tx.update(ref, { selectionKey: signature, savedSelection });
    if (visible.exists) tx.update(visible.ref, { savedSelectionReady: true });
  });
  const events = admin.firestore().collection('users').doc(uid).collection('events');
  let snapshots: admin.firestore.DocumentSnapshot[];
  let nextCursor: string | null = null;
  if (request.eventIds) {
    snapshots = await admin.firestore().getAll(...[...new Set(request.eventIds)].map(eventId => events.doc(sendIdentifier(eventId))));
  } else {
    const from = Date.parse(request.startDate || ''); const to = Date.parse(request.endDate || '');
    let query = events.where('startDate', '>=', from).where('startDate', '<=', to).orderBy('startDate').orderBy(FieldPath.documentId()).limit(ACTIVITY_SEND_LIMITS.page);
    if (draft.lastEventId) query = query.startAfter(draft.lastStartDate, draft.lastEventId);
    snapshots = (await query.get()).docs;
    if (snapshots.length === ACTIVITY_SEND_LIMITS.page) nextCursor = createHash('sha256').update(`${draft.id}:${snapshots[snapshots.length - 1].id}`).digest('hex');
  }
  for (const event of snapshots) {
    let added = false;
    if ((await operationRef(uid, draft.id).collection('rows').doc(event.id).get()).exists) continue; // Resume an interrupted page without downloading already reviewed originals.
    for (const source of event.exists ? sources : []) {
      const route = getHistoricalActivityRouteId(source as typeof SOURCES[number], ACTIVITY_SEND_PROVIDERS[draft.provider]);
      if (!route) continue;
      const inspected = await eligibleOriginal({ userID: uid, eventID: event.id, event: event.data()!, source: source as typeof SOURCES[number], eventRef: event.ref, action: 'send', readDocument: ref => ref.get() });
      if (!inspected.original) continue;
      const queueId = await buildActivitySyncQueueItemId(route, uid, event.id);
      const [queue, metadata] = await Promise.all([admin.firestore().collection('activitySyncQueue').doc(queueId).get(), event.ref.collection('metaData').doc(getActivitySyncMetadataDocId(route)).get()]);
      const existing = queue.data();
      const blocked = metadata.data()?.status === 'success' || (existing && (!existing.processed || ['success', 'manual_reconciliation_required'].includes(existing.resultStatus)));
      const rowId = sendIdentifier(event.id);
      const original = { ...inspected.original, generation: inspected.original.generation!, extension: inspected.original.path.endsWith('.gz') ? 'fit.gz' : 'fit' };
      let summary;
      try { summary = await describeSavedFIT(original, `${event.data()?.name || original.originalFilename || 'Saved activity'}`, draft.provider); }
      catch { continue; }
      await guardedSendTransaction(uid, async tx => {
        const current = (await tx.get(operationRef(uid, draft.id))).data() as SendOperation;
        const prior = await tx.get(operationRef(uid, draft.id).collection('rows').doc(rowId));
        if (current.state !== 'draft' || current.stopped || current.expiresAt <= Date.now()) throw new HttpsError('failed-precondition', 'Draft changed.');
        if (prior.exists) return;
        const row: ActivitySendRow = { id: rowId, ...summary, status: blocked ? 'duplicate' : 'ready', recovery: 'none', message: blocked ? 'Already delivered or queued; will not be sent again.' : 'Ready to review.', attempts: 0 };
        tx.set(operationRef(uid, draft.id).collection('rows').doc(rowId), { sourceServiceName: source, eventID: event.id, originalFile: original, excluded: !!blocked, admitted: false });
        tx.set(batchRef(uid, draft.id).collection('rows').doc(rowId), row);
        current.total++; if (blocked) current.finished++; current.revision++; current.reviewed = false;
        tx.set(operationRef(uid, draft.id), current); tx.set(batchRef(uid, draft.id), publicBatch(current));
      });
      added = true; break;
    }
    if (!added) await guardedSendTransaction(uid, async tx => {
      const ref = operationRef(uid, draft.id); const current = (await tx.get(ref)).data() as SendOperation;
      const rowRef = ref.collection('rows').doc(sendIdentifier(event.id)); const prior = await tx.get(rowRef);
      if (current.state !== 'draft' || current.stopped || current.expiresAt <= Date.now()) throw new HttpsError('failed-precondition', 'Draft changed.');
      if (prior.exists) return;
      tx.set(rowRef, { excluded: true, admitted: false, eventID: event.id, sourceServiceName: 'manualUpload' });
      tx.set(batchRef(uid, draft.id).collection('rows').doc(event.id), { id: event.id, name: `${event.data()?.name || 'Unavailable saved activity'}`.slice(0, 256), sport: null, startDate: Number(event.data()?.startDate) || null, size: 0, warnings: [], status: 'needs_action', recovery: 'choose_file', message: event.exists ? 'Excluded: no eligible, readable FIT original for these sources and destination (20 MiB limit). Merged or derived activities cannot be sent.' : 'Excluded: this saved activity is no longer available. It may have been deleted.', attempts: 0 });
      current.total++; current.finished++; current.revision++; current.reviewed = false;
      tx.set(ref, current); tx.set(batchRef(uid, draft.id), publicBatch(current));
    });
  }
  await guardedSendTransaction(uid, async tx => {
    const ref = operationRef(uid, draft.id); const current = (await tx.get(ref)).data() as SendOperation;
    if (current.state !== 'draft' || current.stopped || current.expiresAt <= Date.now()) throw new HttpsError('failed-precondition', 'Draft changed.');
    if ((current.nextCursor || null) !== (request.cursor || null)) return; // Another copy of this page already advanced.
    current.selectionKey = signature; current.previousCursor = request.cursor || null; current.nextCursor = nextCursor;
    if (!request.eventIds && snapshots.length) { current.lastEventId = snapshots[snapshots.length - 1].id; current.lastStartDate = Number(snapshots[snapshots.length - 1].data()?.startDate); }
    tx.set(ref, current);
  });
}

export const activitySendCommand = onCall({ region: 'europe-west2', cors: ALLOWED_CORS_ORIGINS, memory: '512MiB', timeoutSeconds: 120, maxInstances: 10 }, async request => {
  enforceAppCheck(request);
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to send activities.');
  return runSendCommand(request.auth.uid, request.data as ActivitySendCommand);
});
