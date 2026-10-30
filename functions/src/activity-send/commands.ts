import { FieldValue } from 'firebase-admin/firestore';
import { reconcileStoppedSend } from './lifecycle';
import * as admin from 'firebase-admin';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { ActivitySendCommand, ACTIVITY_SEND_PROVIDERS, ACTIVITY_SEND_LIMITS, ActivitySendRow, isActivitySendProvider } from '../../../shared/activity-send';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, PRO_REQUIRED_MESSAGE, enqueueActivitySyncTask } from '../utils';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { eligibleOriginal } from '../activity-sync/historical-send';
import { isStorageObjectMissing } from '../activity-sync/historical-manual-original';
import { buildActivitySyncQueueItemId } from '../activity-sync/queue';
import { getHistoricalActivityRouteId } from '../../../shared/activity-sync-routes';
import { getActivitySyncMetadataDocId } from '../activity-sync/metadata';
import { describeSavedFIT, operationRef, batchRef, guardedSendTransaction, providerAccount, publicBatch, requireDraft, SendOperation, SendSource } from './store';
import { sendIdentifier, projectSendQueue } from './policy';

const SOURCES = [ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI, 'manualUpload'] as const;
const SAVED_PREVIEW_PAGE_BUDGET_MS = 20_000;
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
    const sourceRef = ref.collection('rows').doc(rowId);
    const source = (await sourceRef.get()).data() as SendSource | undefined;
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
      if (request.action === 'retry') {
        const currentSource = await tx.get(sourceRef);
        if (!currentSource.exists || currentSource.data()?.queueId !== source.queueId) throw new HttpsError('not-found', 'Delivery source was not found.');
        // Retire the previous claim and any legacy retry fallback before clearing them.
        // Worker retry budgets and cumulative worker retries retain their existing meaning.
        const priorAttempts = Number(currentSource.data()?.priorAttempts || 0) + Number(!!queue.providerOperationStartedAt)
          + (queue.totalRetryCount ? 0 : Number(queue.retryCount || 0));
        tx.update(sourceRef, { priorAttempts });
      }
      tx.update(queueRef, { dateCreated, processed: false, resultStatus: null, skippedReason: null, deferredReason: null, dispatchedToCloudTask: null, ...(request.action === 'retry' ? { destinationUploadID: null, destinationProviderUserID: null, destinationWorkoutKey: null, destinationInfoCode: null, providerOperationStartedAt: null, destinationUploadContinuation: null, destinationExpectedWorkoutTypeID: FieldValue.delete(), retryCount: 0, sendConfirmedFailure: false } : {}) });
      return dateCreated;
    });
    if (dispatch !== null) await enqueueActivitySyncTask(source.queueId, dispatch);
    return { batchId: id, revision: 0 };
  }
  throw new HttpsError('invalid-argument', 'Unsupported send action.');
}

async function prepareSaved(uid: string, draft: SendOperation, request: Extract<ActivitySendCommand, { action: 'prepare' }>) {
  const startedAt = Date.now();
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
  let hasMore = false;
  if (request.eventIds) {
    const remaining = request.eventIds.filter(eventId => !draft.lastEventId || eventId > draft.lastEventId);
    const page = remaining.slice(0, ACTIVITY_SEND_LIMITS.page);
    snapshots = page.length ? await admin.firestore().getAll(...page.map(eventId => events.doc(eventId))) : [];
    hasMore = remaining.length > page.length;
  } else {
    const from = Date.parse(request.startDate || ''); const to = Date.parse(request.endDate || '');
    let query = events.where('startDate', '>=', from).where('startDate', '<=', to).orderBy('startDate').orderBy(FieldPath.documentId()).limit(ACTIVITY_SEND_LIMITS.page);
    if (draft.lastEventId) query = query.startAfter(draft.lastStartDate, draft.lastEventId);
    snapshots = (await query.get()).docs;
    hasMore = snapshots.length === ACTIVITY_SEND_LIMITS.page;
  }
  try { logger.info('[ActivitySend] Saved preview page started.', { provider: draft.provider, sourceCount: sources.length, pageCount: snapshots.length }); } catch { /* Diagnostics cannot change preparation. */ }
  let checked = 0;
  let lastChecked: admin.firestore.DocumentSnapshot | undefined;
  for (const event of snapshots) {
    // Yield between recordings, never abandon a Storage read or transaction in flight.
    // The cursor moves only after the checked rows are durable, including exclusions.
    if (checked && Date.now() - startedAt >= SAVED_PREVIEW_PAGE_BUDGET_MS) break;
    checked++; lastChecked = event;
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
      catch (error) {
        if (isStorageObjectMissing(error) || error instanceof HttpsError && ['invalid-argument', 'failed-precondition'].includes(error.code)) continue;
        // An unavailable read is not evidence of an ineligible recording. Keep the cursor and
        // already reviewed rows so continuation can retry this original without sending anything.
        throw new HttpsError('unavailable', 'Saved activity checking is temporarily unavailable. Reopen this draft and choose Continue saved-activity preview.');
      }
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
  hasMore = hasMore || checked < snapshots.length;
  const nextCursor = hasMore && lastChecked ? createHash('sha256').update(`${draft.id}:${lastChecked.id}`).digest('hex') : null;
  await guardedSendTransaction(uid, async tx => {
    const ref = operationRef(uid, draft.id); const current = (await tx.get(ref)).data() as SendOperation;
    if (current.state !== 'draft' || current.stopped || current.expiresAt <= Date.now()) throw new HttpsError('failed-precondition', 'Draft changed.');
    if ((current.nextCursor || null) !== (request.cursor || null)) return; // Another copy of this page already advanced.
    current.selectionKey = signature; current.previousCursor = request.cursor || null; current.nextCursor = nextCursor;
    if (lastChecked) {
      current.lastEventId = lastChecked.id;
      if (!request.eventIds) current.lastStartDate = Number(lastChecked.data()?.startDate);
    }
    tx.set(ref, current);
  });
  try { logger.info('[ActivitySend] Saved preview page checked.', { provider: draft.provider, sourceCount: sources.length, checkedCount: checked, hasNextPage: !!nextCursor, elapsedMs: Math.max(0, Date.now() - startedAt) }); } catch { /* Diagnostics cannot change preparation. */ }
}

const COMMAND_ACTIONS = new Set(['create', 'prepare', 'confirm', 'remove', 'stop', 'check', 'retry']);
const COMMAND_ERROR_CODES = new Set([
  'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found', 'already-exists',
  'permission-denied', 'resource-exhausted', 'failed-precondition', 'aborted', 'out-of-range',
  'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated',
]);
// Match only authored messages, never copy arbitrary exception text or details into diagnostics.
const COMMAND_REJECTION_REASONS = new Map([
  ['Unsupported send version.', 'unsupported_version'],
  ['Invalid send reference.', 'invalid_reference'],
  [PRO_REQUIRED_MESSAGE, 'pro_required'],
  ['Choose a supported destination and source.', 'unsupported_destination_or_source'],
  ['This reference belongs to another send.', 'reference_already_used'],
  ['Destination account changed. Create a new draft.', 'destination_account_changed'],
  ['Destination account changed. Review a new draft.', 'destination_account_changed'],
  ['Draft changed.', 'draft_changed'],
  ['Finish selecting and validating activities first.', 'selection_not_ready'],
  ['Send was not found.', 'send_not_found'],
  ['Review the current selection before sending.', 'selection_not_reviewed_or_stale'],
  ['No provider operation is available.', 'provider_operation_missing'],
  ['Delivery was not found.', 'delivery_not_found'],
  ['The retry window expired or this batch was stopped. Create a new draft after reviewing the provider.', 'retry_window_closed'],
  ['An uncertain or accepted upload cannot be resent.', 'resend_not_safe'],
  ['This delivery has a final result; there is no pending status to check.', 'delivery_already_final'],
  ['Check the provider directly; no safe operation identifier is available.', 'provider_operation_id_missing'],
  ['Delivery source was not found.', 'delivery_source_not_found'],
  ['Unsupported send action.', 'unsupported_action'],
  ['Preview a saved selection before continuing.', 'saved_selection_missing'],
  ['Choose valid activity sources.', 'invalid_selection_shape'],
  ['Choose only the supported activity sources.', 'unsupported_activity_sources'],
  ['Choose activity sources.', 'activity_sources_empty'],
  ['Select up to 50 activities at a time.', 'selection_size_invalid'],
  ['Choose a valid date range.', 'invalid_date_range'],
  ['Selection changed. Create a new draft.', 'selection_changed'],
  ['Preview cursor is no longer current.', 'preview_cursor_stale'],
  ['The selection changed. Review a new draft.', 'selection_changed'],
  ['Saved activity checking is temporarily unavailable. Reopen this draft and choose Continue saved-activity preview.', 'saved_preview_unavailable'],
  ['Account is unavailable.', 'account_unavailable'],
  ['Connect or reconnect the destination in Connections.', 'destination_reconnect_required'],
  ['Connect exactly one Suunto account before sending.', 'suunto_account_ambiguous'],
  ['Create a new send draft.', 'draft_closed'],
]);

export const activitySendCommand = onCall({ region: 'europe-west2', cors: ALLOWED_CORS_ORIGINS, memory: '512MiB', timeoutSeconds: 120, maxInstances: 10 }, async request => {
  let stage: 'app_check' | 'authentication' | 'command' = 'app_check';
  try {
    enforceAppCheck(request);
    stage = 'authentication';
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to send activities.');
    stage = 'command';
    return await runSendCommand(request.auth.uid, request.data as ActivitySendCommand);
  } catch (error) {
    try {
      const known = error instanceof HttpsError;
      const httpStatus = known ? error.httpErrorCode.status : 500;
      const log = httpStatus >= 500 ? logger.error : logger.warn;
      log('[ActivitySendCommand] Request rejected.', {
        stage,
        action: COMMAND_ACTIONS.has(request.data?.action) ? request.data.action : 'unknown',
        errorCode: known && COMMAND_ERROR_CODES.has(error.code) ? error.code : 'unknown',
        httpStatus,
        reason: stage === 'app_check' ? 'app_check_rejected' : stage === 'authentication' ? 'sign_in_required'
          : known ? COMMAND_REJECTION_REASONS.get(error.message) || 'unclassified' : 'unexpected_error',
      });
    } catch { /* Diagnostics must not change the original rejection or retry behavior. */ }
    throw error;
  }
});
