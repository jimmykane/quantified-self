import { cleanupSendSourceRow } from './source-cleanup';
import * as admin from 'firebase-admin';
import { onDocumentWritten, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { getHistoricalActivityRouteId } from '../../../shared/activity-sync-routes';
import { ACTIVITY_SEND_PROVIDERS, activitySendTerminal } from '../../../shared/activity-send';
import { enqueueActivitySyncQueueItem } from '../activity-sync/queue';
import { batchRef, guardedBackgroundSendTransaction, operationRef, SendOperation, SendSource } from './store';
import { projectSendQueue } from './policy';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { recordActivitySendCleanup } from '../activity-sync/monitoring';

export async function admitSendRows(uid: string, id: string): Promise<void> {
  const op = operationRef(uid, id);
  const current = (await op.get()).data() as SendOperation | undefined;
  if (!current || current.state !== 'confirmed' || (await getUserDeletionGuardState(admin.firestore(), uid)).shouldSkip) return;
  const rows = await op.collection('rows').where('admitted', '==', false).limit(50).get();
  for (const row of rows.docs) {
    const source = row.data() as SendSource & { excluded?: boolean; removed?: boolean };
    if (current.stopped || source.excluded || source.removed) {
      const stopped = await guardedBackgroundSendTransaction(uid, async tx => {
        const sourceSnapshot = await tx.get(row.ref);
        const parent = await tx.get(batchRef(uid, id));
        const visible = await tx.get(batchRef(uid, id).collection('rows').doc(row.id));
        // Admission can commit a queue link after this page was read. Such work
        // belongs to the queue projection, including any already-claimed upload.
        if (!sourceSnapshot.exists || sourceSnapshot.data()?.admitted) return false;
        tx.update(row.ref, { admitted: true });
        if (!source.excluded && !source.removed && visible.exists && parent.exists) {
          const finished = Number(parent.data()?.finished || 0) + Number(!activitySendTerminal(visible.data()!.status));
          tx.update(visible.ref, { status: 'stopped', recovery: 'none', message: 'Stopped before sending.' });
          tx.update(parent.ref, { finished, state: finished >= Number(parent.data()?.total) ? 'complete' : 'confirmed', updatedAt: Date.now() });
        }
        return true;
      });
      if (stopped && !source.excluded) await cleanupSendSourceRow(row.ref);
      continue;
    }
    const routeId = getHistoricalActivityRouteId(source.sourceServiceName, ACTIVITY_SEND_PROVIDERS[current.provider]);
    if (!routeId) throw new Error('Unsupported activity send route.');
    const result = await enqueueActivitySyncQueueItem({ routeId, userID: uid, eventID: source.eventID, sourceServiceName: source.sourceServiceName, destinationServiceName: ACTIVITY_SEND_PROVIDERS[current.provider], originalFile: source.originalFile, manual: true, deliveryMode: current.source === 'files' ? 'direct' : 'historical', sendBatchID: id, sendRowID: row.id, destinationPinnedProviderUserID: current.providerAccount });
    const duplicateSource = await guardedBackgroundSendTransaction(uid, async tx => {
      const sourceSnapshot = await tx.get(row.ref);
      const queue = await tx.get(admin.firestore().collection('activitySyncQueue').doc(result.queueItemId));
      const parent = await tx.get(batchRef(uid, id));
      const visible = await tx.get(batchRef(uid, id).collection('rows').doc(row.id));
      const liveOperation = await tx.get(op);
      if (!sourceSnapshot.exists || !parent.exists || !visible.exists) return;
      const ownsQueue = queue.data()?.sendBatchID === id && queue.data()?.sendRowID === row.id;
      tx.update(row.ref, { admitted: true, ...(ownsQueue ? { queueId: result.queueItemId } : {}) });
      const projection = ownsQueue ? projectSendQueue(queue.data()!) : Number(liveOperation.data()?.expiresAt) <= Date.now()
        ? { status: 'needs_action' as const, recovery: 'choose_file' as const, message: 'The sending window expired. Review a new draft before sending.' }
        : liveOperation.data()?.stopped
        ? { status: 'stopped' as const, recovery: 'none' as const, message: 'Stopped before sending.' }
        : { status: 'duplicate' as const, recovery: 'none' as const, message: 'Already sent or queued; no additional copy was scheduled.' };
      const finished = Number(parent.data()?.finished || 0) + Number(activitySendTerminal(projection.status)) - Number(activitySendTerminal(visible.data()!.status));
      tx.update(visible.ref, projection);
      tx.update(parent.ref, { finished, updatedAt: Date.now(), state: finished >= Number(parent.data()?.total) ? 'complete' : 'confirmed' });
      return !ownsQueue;
    });
    if (duplicateSource) await cleanupSendSourceRow(row.ref);
  }
  // A bounded page progresses independently of the browser. Retry-enabled writes recover failures.
  if (rows.size) await guardedBackgroundSendTransaction(uid, async tx => {
    const snapshot = await tx.get(op);
    if (snapshot.exists && snapshot.data()?.state === 'confirmed') tx.update(op, { admissionProgressAt: Date.now() });
  });
}
export const admitActivitySend = onDocumentWritten({ document: 'users/{uid}/activitySendOperations/{batchId}', region: 'europe-west2', memory: '512MiB', timeoutSeconds: 300, retry: true }, async event => {
  if (!event.data?.after.exists) return;
  await admitSendRows(event.params.uid, event.params.batchId);
});

export async function projectSendDelivery(queueRef: admin.firestore.DocumentReference): Promise<void> {
  const initial = (await queueRef.get()).data();
  if (!initial?.sendBatchID || !initial.sendRowID || !initial.userID || (await getUserDeletionGuardState(admin.firestore(), initial.userID)).shouldSkip) return;
  await guardedBackgroundSendTransaction(initial.userID, async tx => {
    const snapshot = await tx.get(queueRef); const data = snapshot.data();
    if (!data || data.sendBatchID !== initial.sendBatchID || data.sendRowID !== initial.sendRowID) return;
    const batch = batchRef(data.userID, data.sendBatchID);
    const rowRef = batch.collection('rows').doc(data.sendRowID);
    const operation = operationRef(data.userID, data.sendBatchID);
    const [parent, row, privateParent] = await Promise.all([tx.get(batch), tx.get(rowRef), tx.get(operation)]);
    if (!parent.exists || !row.exists) return;
    const projection = projectSendQueue(data);
    const finished = Number(parent.data()?.finished || 0) + Number(activitySendTerminal(projection.status)) - Number(activitySendTerminal(row.data()!.status));
    tx.update(rowRef, { ...projection, attempts: Number(data.totalRetryCount || data.retryCount || 0) + Number(!!data.providerOperationStartedAt) });
    const state = finished >= Number(parent.data()?.total) ? 'complete' : 'confirmed';
    tx.update(batch, { finished, updatedAt: Date.now(), state });
    if (privateParent.exists) tx.update(operation, { finished, updatedAt: Date.now() });
  });
  const current = (await queueRef.get()).data();
  if (current && ['delivered', 'duplicate', 'stopped'].includes(projectSendQueue(current).status)) {
    await cleanupSendSourceRow(operationRef(initial.userID, initial.sendBatchID).collection('rows').doc(initial.sendRowID));
  }
}
export const projectActivitySendDelivery = onDocumentWritten({ document: 'activitySyncQueue/{queueId}', region: 'europe-west2', memory: '256MiB', timeoutSeconds: 60, retry: true }, async event => {
  if (!event.data?.after.exists) return;
  await projectSendDelivery(event.data.after.ref);
});

export async function cleanupSendSources(op: admin.firestore.DocumentReference): Promise<void> {
  const rows = await op.collection('rows').get();
  for (const row of rows.docs) await cleanupSendSourceRow(row.ref);
}
export async function cleanupExpiredSends(now = Date.now()): Promise<void> {
  const expired = await admin.firestore().collectionGroup('activitySendOperations').where('cleanupAfter', '<=', Timestamp.fromMillis(now)).limit(100).get();
  let failed = 0;
  for (const op of expired.docs) {
    try {
      await cleanupSendSources(op.ref);
      const uid = op.ref.parent.parent!.id;
      if (op.data().sourceExpired || (await getUserDeletionGuardState(admin.firestore(), uid)).shouldSkip) {
        await admin.firestore().recursiveDelete(op.ref);
        await admin.firestore().recursiveDelete(batchRef(uid, op.id));
        continue;
      }
      const rows = await op.ref.collection('rows').get();
      for (const source of rows.docs) {
        if (source.data().queueId) {
          const queue = admin.firestore().collection('activitySyncQueue').doc(source.data().queueId);
          await guardedBackgroundSendTransaction(uid, async tx => {
            const current = (await tx.get(queue)).data();
            if (current?.sendBatchID === op.id && !current.processed && !current.destinationUploadID && !current.providerOperationStartedAt) {
              tx.update(queue, { processed: true, resultStatus: 'skipped', skippedReason: 'send_source_expired' });
            }
          });
        }
      }
      await guardedBackgroundSendTransaction(uid, async tx => {
        const current = await tx.get(op.ref); const visible = await tx.get(batchRef(uid, op.id));
        if (!current.exists) return;
        tx.update(op.ref, { sourceExpired: true, stopped: true, cleanupAfter: Timestamp.fromMillis(Number(current.data()?.createdAt) + 30 * 86400_000) });
        if (visible.exists) tx.update(visible.ref, { stopped: true, reviewed: false, updatedAt: now });
      });
    } catch { failed++; }
  }
  recordActivitySendCleanup(failed ? 'failed' : 'completed');
  if (failed) throw new Error('Temporary activity send cleanup must be retried.');
}
export const cleanupActivitySends = onSchedule({ schedule: 'every 60 minutes', region: 'europe-west2', memory: '256MiB', timeoutSeconds: 300 }, () => cleanupExpiredSends());

export const cleanupActivitySendOnDelete = onDocumentDeleted({ document: 'users/{uid}', region: 'europe-west2', memory: '256MiB', timeoutSeconds: 300, retry: true }, async event => {
  if (!event.data) return;
  // Account cleanup owns this exact feature prefix, including late/orphan staging writes.
  await admin.storage().bucket().deleteFiles({ prefix: `users/${event.params.uid}/activitySendSources/` });
});
