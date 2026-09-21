import { getServiceWorkoutQueueName } from '../shared/queue-names';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { historySleepProvider, historyCooldownUntil } from './adapters';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { config } from '../config';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess } from '../utils';
import { CLOUD_TASK_RETRY_CONFIG, MAX_PENDING_TASKS } from '../shared/queue-config';
import { enqueueConnectionHistoryTask, getCloudTaskQueueDepthForQueue } from '../shared/cloud-tasks';
import { CONNECTION_HISTORY_COLLECTION, historyProjection, type ConnectionHistoryRun } from './model';
import { assertHistoryConnectionCurrent, assertHistoryReservation, historyExecution, HistoryLifecycleChangedError } from './execution';
import { executeHistoryOperation, HistorySkippedError, isHistoryWindowTooLarge } from './adapters';
import { advanceHistoryRun } from './advance';
import { withHistoryExecution } from './context';

const region = FUNCTIONS_MANIFEST.processConnectionHistoryTask.region;
const refFor = (id: string) => admin.firestore().collection(CONNECTION_HISTORY_COLLECTION).doc(id);
const validID = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);

export async function dispatchConnectionHistoryRun(run: ConnectionHistoryRun): Promise<void> {
  if (run.processed) return;
  const accepted = await enqueueConnectionHistoryTask(run.id, run.dateCreated,
    Math.max(1, Math.ceil((run.nextAttemptAt - Date.now()) / 1000)), {
      queueRevision: String(run.revision), queueDateCreated: run.dateCreated,
      recoveryTaskKey: String(Math.floor(Date.now() / 60_000)),
    });
  if (!accepted) throw new Error('History dispatch was not accepted.');
}

/** Missing rows never prove delivery. Failed rows are retried only through explicit owner action. */
export async function observeHistoryChildren(paths: string[], runId?: string): Promise<'pending' | 'processed' | 'failed' | 'skipped' | 'authorization'> {
  if (!paths.length) return 'processed';
  const db = admin.firestore();
  const rows = await db.getAll(...paths.map(path => db.doc(path)));
  const missing = rows.filter(row => !row.exists);
  if (missing.length) {
    if (runId) {
      const dead = await db.getAll(...missing.map(row => db.collection('failed_jobs').doc(row.ref.id)));
      const authorizationContexts = new Set(['PERMISSION_MISSING', 'GARMIN_HEALTH_PERMISSION_MISSING', 'INVALID_GRANT', 'AUTH_RECONNECT_REQUIRED', 'NO_TOKEN_FOUND']);
      if (dead.some((row, index) => row.data()?.connectionHistoryRunId === runId
        && row.data()?.originalCollection === missing[index].ref.parent.id && authorizationContexts.has(row.data()?.context))) return 'authorization';
    }
    return 'failed';
  }
  if (rows.some(row => !row.data()?.processed)) return 'pending';
  if (rows.some(row => row.data()?.resultStatus === 'failed')) return 'failed';
  if (rows.some(row => row.data()?.skippedReason || (row.data()?.resultStatus && row.data()?.resultStatus !== 'success'))) return 'skipped';
  return 'processed';
}

class HistoryCapacityWaitError extends Error {}
export function classifyHistoryFailure(error: unknown) {
  if (error instanceof HistoryCapacityWaitError) return { kind: 'wait' as const, message: 'Waiting for capacity. Your history will continue automatically.' };
  if (isHistoryWindowTooLarge(error)) return { kind: 'split' as const, message: 'This history window is too large. Trying a smaller range.' };
  if (error instanceof HistorySkippedError) return { kind: 'skip' as const, message: error.message, nextAllowedAtMs: error.nextAllowedAtMs };
  if (error instanceof HistoryLifecycleChangedError) return { kind: 'skip' as const, message: 'This connection changed. Connect again to import recent history.' };
  const detail = error as { code?: string; statusCode?: number; retryAt?: number; details?: { retryAfterSeconds?: number; retryAt?: number }; response?: { headers?: Record<string, string> } };
  if ((error instanceof Error && /missing required .*permissions|connected .* token is required/i.test(error.message)) || ['permission-denied', 'unauthenticated'].includes(detail?.code || '') || [401, 403].includes(detail?.statusCode || 0)) {
    return { kind: 'skip' as const, message: 'Permission is missing or authorization expired. Reconnect to enable this history.' };
  }
  const retryHeader = detail?.response?.headers?.['retry-after'];
  const seconds = Number(detail?.details?.retryAfterSeconds ?? retryHeader);
  const headerRetryAt = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : Date.parse(retryHeader || '');
  const retryAt = Math.max(Number(detail?.retryAt || 0), Number(detail?.details?.retryAt || 0), Number.isFinite(headerRetryAt) ? headerRetryAt : 0);
  return { kind: 'retry' as const, message: 'History could not finish. We will retry automatically; your service remains connected.',
    ...(Number.isFinite(retryAt) ? { retryAt } : {}) };
}

async function saveRun(run: ConnectionHistoryRun, owner: string): Promise<void> {
  const db = admin.firestore();
  await db.runTransaction(async tx => {
    const ref = refFor(run.id); const current = await tx.get(ref);
    if (!current.exists || current.data()?.leaseOwner !== owner || current.data()?.revision !== run.revision) return;
    if ((await getUserDeletionGuardStateInTransaction(db, tx, run.userID)).shouldSkip) return;
    let currentConnection = true;
    try { await assertHistoryConnectionCurrent(run, tx); }
    catch (error) { if (!(error instanceof HistoryLifecycleChangedError)) throw error; currentConnection = false; }
    if (!currentConnection) {
      for (const step of run.steps.filter(step => !step.done)) {
        step.done = true; step.status = 'skipped'; step.message = 'This import was superseded by a connection change.';
      }
      run.processed = true;
    }
    const sleepRef = run.serviceName === ServiceNames.WahooAPI ? null : db.doc(`users/${run.userID}/sleepSyncState/${historySleepProvider(run.serviceName)}`);
    const sleep = currentConnection && run.processed && sleepRef ? await tx.get(sleepRef) : null;
    run.failed = run.steps.some(step => step.status === 'failed');
    run.revision++; run.updatedAtMs = Date.now(); delete run.leaseOwner; delete run.leaseExpiresAt;
    tx.set(ref, run);
    if (sleepRef && sleep?.data()?.connectionHistoryReservation === run.id) tx.set(sleepRef, { connectionHistoryReservationExpiresAt: 0 }, { merge: true });
    if (currentConnection) tx.set(db.doc(`users/${run.userID}/meta/${run.serviceName}`), {
      connectionHistoryImport: historyProjection(run),
      ...(run.processed ? { connectionHistoryReservationExpiresAt: 0 } : {}),
    }, { merge: true });
  });
}

export async function processConnectionHistoryRun(id: string, revision: string): Promise<void> {
  const db = admin.firestore(); const owner = randomUUID(); const now = Date.now();
  const run = await db.runTransaction(async tx => {
    const ref = refFor(id); const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data() as ConnectionHistoryRun;
    if (data.processed || String(data.revision) !== revision || (data.leaseExpiresAt || 0) > now || data.nextAttemptAt > now + 1000) return null;
    if ((await getUserDeletionGuardStateInTransaction(db, tx, data.userID)).shouldSkip) return null;
    tx.update(ref, { leaseOwner: owner, leaseExpiresAt: now + 360_000 });
    return data;
  });
  if (!run) return;
  try {
    await historyExecution(run, []).beforeRequest();
    if (!(await hasProAccess(run.userID))) throw new HistoryLifecycleChangedError();
      await advanceHistoryRun(run, {
        observe: paths => observeHistoryChildren(paths, run.id), classify: classifyHistoryFailure,
        execute: async step => {
          const key = JSON.stringify([step.id, step.capability.version, step.nextStartMs, step.windowDays || 30, step.page]);
          if (run.lastOperation?.key === key) return run.lastOperation.result;
          const paths: string[] = [];
          const downstreamQueue = step.id === 'activities' ? config.cloudtasks.workoutQueue
            : run.serviceName === ServiceNames.GarminAPI && step.id === 'health' ? config.cloudtasks.garminHealthBackfillQueue : config.cloudtasks.sleepSyncQueue;
          const queueCollection = step.id === 'activities' ? getServiceWorkoutQueueName(run.serviceName) : SLEEP_SYNC_QUEUE_COLLECTION_NAME;
          const [depth, backlog] = await Promise.all([getCloudTaskQueueDepthForQueue(downstreamQueue, true),
            db.collection(queueCollection).where('processed', '==', false).count().get()]);
          if (Math.max(depth, backlog.data().count) >= MAX_PENDING_TASKS / 2) {
            logger.info('[ConnectionHistory]', { event: 'capacity_wait', service: run.serviceName });
            throw new HistoryCapacityWaitError();
          }
          const execution = historyExecution(run, paths, { owner, revision: run.revision });
          const result = await withHistoryExecution(execution, () => executeHistoryOperation(run, step, execution));
          if (paths.length > 100) throw new Error('History admission bound exceeded.');
          const receipt = { key, result: { ...result, childPaths: paths } };
          await db.runTransaction(async tx => {
            const ref = refFor(run.id); const snapshot = await tx.get(ref);
            await execution.inTransaction(tx);
            if (snapshot.data()?.leaseOwner !== owner || snapshot.data()?.revision !== run.revision) throw new HistoryLifecycleChangedError();
            tx.update(ref, { lastOperation: receipt });
          });
          run.lastOperation = receipt;
          return receipt.result;
        },
      }, now);
  } catch (error) {
    if (!(error instanceof HistoryLifecycleChangedError)) throw error;
    for (const step of run.steps.filter(step => !step.done)) {
      step.done = true; step.status = 'skipped'; step.message = 'The connection or Pro access changed. Reconnect to import recent history.';
    }
    run.processed = true;
  }
  await saveRun(run, owner);
  logger.info('[ConnectionHistory]', { event: run.processed ? 'finished' : 'checkpoint', service: run.serviceName,
    ageMs: Date.now() - run.dateCreated, outcomes: run.steps.map(step => step.status) });
}

export const processConnectionHistoryTask = onTaskDispatched({ region, timeoutSeconds: 300, memory: '512MiB',
  secrets: FUNCTION_SECRET_BINDINGS.processConnectionHistoryTask, retryConfig: CLOUD_TASK_RETRY_CONFIG,
  rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 1 } }, async request => {
  if (!validID(request.data?.queueItemId) || typeof request.data?.queueRevision !== 'string') return;
  await processConnectionHistoryRun(request.data.queueItemId, request.data.queueRevision);
});
export const onConnectionHistoryImportWritten = onDocumentWritten({ region, document: `${CONNECTION_HISTORY_COLLECTION}/{runId}`, retry: true }, async event => {
  const run = event.data?.after.data() as ConnectionHistoryRun | undefined;
  if (!run || run.processed || (event.data?.before.exists && event.data.before.data()?.revision === run.revision)) return;
  try { await dispatchConnectionHistoryRun(run); }
  catch (error) { logger.warn('[ConnectionHistory]', { event: 'startup_failure' }); throw error; }
});
export const recoverConnectionHistoryImports = onSchedule({ region, schedule: '* * * * *', timeoutSeconds: 120 }, async () => {
  if (await getCloudTaskQueueDepthForQueue(config.cloudtasks.connectionHistoryQueue, true) >= MAX_PENDING_TASKS) return;
  const rows = await admin.firestore().collection(CONNECTION_HISTORY_COLLECTION).where('processed', '==', false)
    .where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(100).get();
  for (const row of rows.docs) {
    const run = row.data() as ConnectionHistoryRun;
    if ((run.leaseExpiresAt || 0) > Date.now()) continue;
    await dispatchConnectionHistoryRun(run);
  }
});

export const retryConnectionHistoryImport = onCall({ region, cors: ALLOWED_CORS_ORIGINS }, async request => {
  enforceAppCheck(request);
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to retry history.');
  if (!validID(request.data?.runId)) throw new HttpsError('invalid-argument', 'Invalid history import.');
  if (!(await hasProAccess(request.auth.uid))) throw new HttpsError('permission-denied', 'History import requires Pro.');
  const db = admin.firestore();
  await db.runTransaction(async tx => {
    const ref = refFor(request.data.runId); const snapshot = await tx.get(ref);
    const run = snapshot.data() as ConnectionHistoryRun | undefined;
    if (!run || run.userID !== request.auth!.uid) throw new HttpsError('not-found', 'History import not found.');
    try { await assertHistoryConnectionCurrent(run, tx); }
    catch { throw new HttpsError('failed-precondition', 'Reconnect before importing history.'); }
    if (!run.processed) return;
    const failed = run.steps.filter(step => step.status === 'failed');
    if (!failed.length) return;
    // Reacquire only the groups being retried. A manual import may have claimed
    // their cooldown after this run finished, so validate before restoring children.
    const metaRef = db.doc(`users/${run.userID}/meta/${run.serviceName}`);
    const meta = (await tx.get(metaRef)).data();
    const retriesActivities = failed.some(step => step.capability.cooldownGroup === 'activities');
    const sleepRef = failed.some(step => step.capability.cooldownGroup === 'sleep')
      ? db.doc(`users/${run.userID}/sleepSyncState/${historySleepProvider(run.serviceName)}`) : null;
    const sleep = sleepRef ? (await tx.get(sleepRef)).data() : undefined;
    if (retriesActivities) {
      assertHistoryReservation(meta, run.id);
      if (Number(meta?.historyImportLeaseExpiresAt) > Date.now()
        || (meta?.connectionHistoryReservation !== run.id && historyCooldownUntil(run.serviceName, meta) > Date.now())) {
        throw new HttpsError('failed-precondition', 'Another history import is running or in cooldown. Retry after it becomes available.');
      }
    }
    if (sleepRef) {
      assertHistoryReservation(sleep, run.id);
      if (sleep?.connectionHistoryReservation !== run.id && Number(sleep?.nextBackfillAllowedAtMs) > Date.now()) {
        throw new HttpsError('failed-precondition', 'Sleep and Health history are in cooldown. Retry after they become available.');
      }
    }
    // Read every candidate before staging writes. Never overwrite a replacement queue revision.
    const children = await Promise.all(failed.flatMap(step => step.childPaths).map(async path => {
      const ref = db.doc(path); const [live, dead] = await Promise.all([tx.get(ref), tx.get(db.collection('failed_jobs').doc(ref.id))]);
      return { ref, live, dead };
    }));
    if (retriesActivities) tx.set(metaRef, { connectionHistoryReservation: run.id, connectionHistoryReservationExpiresAt: Date.now() + 7 * 86400000 }, { merge: true });
    if (sleepRef) tx.set(sleepRef, { connectionHistoryReservation: run.id, connectionHistoryReservationExpiresAt: Date.now() + 35 * 86400000 }, { merge: true });
    for (const child of children) {
      if (child.live.exists) continue;
      const data = child.dead.data();
      if (!data || data.connectionHistoryRunId !== run.id || data.originalCollection !== child.ref.parent.id) {
        throw new HttpsError('failed-precondition', 'Some history is no longer available to retry. Use History Import or reconnect.');
      }
      const restored = { ...data, retryCount: 0, processed: false, dispatchedToCloudTask: false, queueRevision: randomUUID(), dateCreated: Date.now() };
      for (const field of ['error', 'failedAt', 'context', 'originalCollection', 'processingOwner', 'processingRevision', 'processingLeaseExpiresAt']) delete restored[field as keyof typeof restored];
      // Queue and DLQ rows are leaves by contract; there are no descendants to restore.
      tx.set(child.ref, restored); tx.delete(child.dead.ref);
    }
    for (const step of failed) { step.done = false; step.status = 'queued'; step.retryCount = 0; delete step.message; }
    run.processed = false; run.failed = false; run.revision++; run.nextAttemptAt = Date.now(); run.updatedAtMs = Date.now();
    delete run.leaseOwner; delete run.leaseExpiresAt;
    tx.set(ref, run); tx.set(db.doc(`users/${run.userID}/meta/${run.serviceName}`), { connectionHistoryImport: historyProjection(run) }, { merge: true });
  });
  return { accepted: true };
});
