import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { enqueueTrainingDeliveryTask, getCloudTaskQueueDepthForQueue } from '../../shared/cloud-tasks';
import { CLOUD_TASK_RETRY_CONFIG, MAX_PENDING_TASKS } from '../../shared/queue-config';
import { config } from '../../config';
import { FUNCTION_SECRET_BINDINGS } from '../../secrets';
import { DELIVERY_QUEUE, type DeliveryRuntime } from './contracts';
import { productionDeliveryRuntime } from './runtime';
import { reconcileTrainingDeliveryPage } from './store';
import { processTrainingDelivery } from './worker';
import { processTrainingVerification } from './verification-worker';

const region = FUNCTIONS_MANIFEST.processTrainingDeliveryTask.region;

export async function dispatchTrainingDeliveryJob(runtime: DeliveryRuntime, id: string,
  enqueue = enqueueTrainingDeliveryTask): Promise<boolean> {
  const ref = runtime.db.collection(DELIVERY_QUEUE).doc(id);
  const reservation = randomUUID();
  const claimed = await runtime.db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    const job = snapshot.data()!;
    if (typeof job.uid !== 'string' || job.dueAtMs > runtime.now()) return false;
    if ((await getUserDeletionGuardStateInTransaction(runtime.db, tx, job.uid)).shouldSkip) {
      // Jobs never have descendants. Deleting this leaf cannot recreate any user state.
      tx.delete(ref);
      return false;
    }
    tx.set(ref, { dispatchReservation: reservation, dueAtMs: runtime.now() + 60_000 }, { merge: true });
    return true;
  });
  if (!claimed) return false;
  // Reservation first: crashes before/after enqueue are both recovered by the due scan.
  await enqueue(id, reservation);
  return true;
}

export const processTrainingDeliveryTask = onTaskDispatched({ region, timeoutSeconds: 120, memory: '512MiB',
  secrets: FUNCTION_SECRET_BINDINGS.processTrainingDeliveryTask,
  retryConfig: CLOUD_TASK_RETRY_CONFIG, rateLimits: { maxConcurrentDispatches: 10, maxDispatchesPerSecond: 10 } }, async request => {
  const id = request.data?.queueItemId;
  if (typeof id !== 'string' || !/^(reconcile_)?[a-f0-9]{64}$/.test(id)) return;
  const runtime = productionDeliveryRuntime();
  const doc = await runtime.db.collection(DELIVERY_QUEUE).doc(id).get();
  // Queue rows are leaves. A deleted row is a completed/cancelled task, never a reason to recreate it.
  if (!doc.exists) return;
  const job = doc.data()!;
  if (job.kind === 'reconcile') await reconcileTrainingDeliveryPage(runtime, job.uid);
  else if (job.kind === 'delivery') await processTrainingDelivery(runtime, job.uid, job.deliveryId);
  else if (job.kind === 'verification') await processTrainingVerification(runtime, job.uid, job.deliveryId);
});

export const onTrainingDeliveryQueued = onDocumentWritten({
  document: `${DELIVERY_QUEUE}/{jobId}`, region, memory: '512MiB', retry: true,
}, async event => {
  if (!event.data?.after.exists || event.data.after.data()?.dueAtMs > Date.now()) return;
  // Verification is dispatched by the prioritized recovery scan, never ahead of writes.
  if (event.data.after.data()?.kind === 'verification') return;
  // COROS delivery leaves are coalesced by the existing minute dispatcher so
  // one task can lease and send up to 30 compatible workouts.
  if (event.data.after.data()?.kind === 'delivery' && event.data.after.data()?.provider === 'coros') return;
  await dispatchTrainingDeliveryJob(productionDeliveryRuntime(), event.params.jobId);
});

export const dispatchTrainingDelivery = onSchedule({ schedule: '* * * * *', region, timeoutSeconds: 120 }, async () => {
  const runtime = productionDeliveryRuntime();
  const pending = await getCloudTaskQueueDepthForQueue(config.cloudtasks.trainingDeliveryQueue, true);
  if (pending >= MAX_PENDING_TASKS) return;
  const capacity = Math.min(25, MAX_PENDING_TASKS - pending);
  const queries = [
    runtime.db.collection(DELIVERY_QUEUE).where('kind', 'in', ['delivery', 'reconcile']),
    runtime.db.collection(DELIVERY_QUEUE).where('kind', '==', 'verification').where('priority', '==', 'manual'),
    runtime.db.collection(DELIVERY_QUEUE).where('kind', '==', 'verification').where('priority', '==', 'ordinary'),
  ];
  let dispatched = 0;
  let inspected = 0;
  const corosGroups = new Set<string>();
  for (const query of queries) {
    if (inspected >= capacity) break;
    const page = await query.where('dueAtMs', '<=', runtime.now()).orderBy('dueAtMs').limit(capacity - inspected).get();
    inspected += page.size;
    for (const job of page.docs) {
      const data = typeof job.data === 'function' ? job.data() : {};
      if (data.kind === 'delivery' && data.provider === 'coros') {
        const group = JSON.stringify([data.uid, data.destinationKey, data.operationKind]);
        if (corosGroups.has(group)) continue;
        corosGroups.add(group);
      }
      try { if (await dispatchTrainingDeliveryJob(runtime, job.id)) dispatched++; }
      catch { logger.warn('[TrainingDelivery]', { event: 'dispatch_failure' }); }
    }
  }
  logger.info('[TrainingDelivery]', { event: 'recovery_dispatch', inspected, dispatched });
});
