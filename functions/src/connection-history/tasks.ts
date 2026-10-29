import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { historySleepProvider, historyCooldownUntil, historyAdmissionQueue } from './adapters';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { config } from '../config';
import { enqueueRouteSyncQueueItem } from '../routes/route-sync-queue';
import type { HistoryExecution } from './execution';
import { ROUTE_SYNC_QUEUE_COLLECTION_NAME, isRouteHistoryDispatchDue } from '../routes/route-sync.constants';
import { SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME } from '../suunto/constants';
import { COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME } from '../coros/constants';
import { GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../garmin/constants';
import { WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME } from '../wahoo/constants';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck, hasProAccess, getUserRoleAndGracePeriod, isGracePeriodActive } from '../utils';
import { PROVIDER_CLOUD_TASK_RETRY_CONFIG, MAX_PENDING_TASKS } from '../shared/queue-config';
import { enqueueConnectionHistoryTask, getCloudTaskQueueDepthForQueue } from '../shared/cloud-tasks';
import { CONNECTION_HISTORY_COLLECTION, historyOperationKey, historyProjection, isConnectionHistoryRunId, type ConnectionHistoryRun } from './model';
import { assertHistoryConnectionCurrent, assertHistoryReservation, historyExecution, HistoryLifecycleChangedError, HistoryUnavailableError } from './execution';
import { executeHistoryOperation, HistorySkippedError, isHistoryWindowTooLarge } from './adapters';
import { advanceHistoryRun, type HistoryChildObservation } from './advance';
import { withHistoryExecution } from './context';
import { emitHistoryMonitoring, historyMonitoringProvider, historyExpectedContention } from './monitoring';
import { historyProbeDue, observeConnectionHistory, recordHistoryProbeUnavailable } from './monitoring-probe';

const region = FUNCTIONS_MANIFEST.processConnectionHistoryTask.region;
const refFor = (id: string) => admin.firestore().collection(CONNECTION_HISTORY_COLLECTION).doc(id);

export async function dispatchConnectionHistoryRun(run: ConnectionHistoryRun): Promise<void> {
  if (run.processed) return;
  const provider = historyMonitoringProvider(run.serviceName);
  try {
    const accepted = await enqueueConnectionHistoryTask(run.id, run.dateCreated,
      Math.max(1, Math.ceil((run.nextAttemptAt - Date.now()) / 1000)), {
        queueRevision: String(run.revision), queueDateCreated: run.dateCreated,
        recoveryTaskKey: String(Math.floor(Date.now() / 60_000)),
      });
    if (!accepted) throw new Error('History dispatch was not accepted.');
    emitHistoryMonitoring({ event: 'dispatch_attempt', provider, outcome: 'accepted' });
  } catch (error) {
    emitHistoryMonitoring({ event: 'dispatch_attempt', provider, outcome: 'failed' });
    throw error;
  }
}

/** Missing rows never prove delivery. Failed rows are retried only through explicit owner action. */
export async function observeHistoryChildren(paths: string[], runId?: string, execution?: HistoryExecution): Promise<HistoryChildObservation> {
  if (!paths.length) return 'processed';
  const db = admin.firestore();
  const rows = await db.getAll(...paths.map(path => db.doc(path)));
  const missing = rows.filter(row => !row.exists);
  const live = rows.filter(row => row.exists);
  if (live.some(row => !row.data()?.processed)) {
    if (execution) {
      for (const row of live.filter(row => row.ref.parent.id === ROUTE_SYNC_QUEUE_COLLECTION_NAME
        && isRouteHistoryDispatchDue(row.data()!))) {
        const data = row.data()!;
        if (data.connectionHistoryRunId !== runId || data.sourceServiceName !== ServiceNames.SuuntoApp
          || typeof data.providerRouteId !== 'string') throw new HistoryLifecycleChangedError();
        await withHistoryExecution(execution, () => enqueueRouteSyncQueueItem({ sourceServiceName: ServiceNames.SuuntoApp,
          firebaseUserID: data.firebaseUserID, providerUserId: data.providerUserId, providerRouteId: data.providerRouteId,
          providerRouteName: data.providerRouteName, providerRouteCreatedAt: data.providerRouteCreatedAt,
          providerRouteModifiedAt: data.providerRouteModifiedAt, manual: true }));
      }
    }
    return 'pending';
  }
  const authorizationContexts = new Set(['PERMISSION_MISSING', 'GARMIN_HEALTH_PERMISSION_MISSING', 'GARMIN_HEALTH_BACKFILL_PERMISSION_MISSING', 'GARMIN_HEALTH_BACKFILL_AUTH_REQUIRED', 'INVALID_GRANT', 'AUTH_RECONNECT_REQUIRED', 'NO_TOKEN_FOUND']);
  const liveFailures = live.filter(row => row.data()?.resultStatus === 'failed');
  const liveFailure = liveFailures.length > 0;
  const liveAuthorization = live.filter(row => row.ref.parent.id === ROUTE_SYNC_QUEUE_COLLECTION_NAME
    && row.data()?.skippedReason === 'provider_auth_required'
    || row.data()?.resultStatus === 'failed' && authorizationContexts.has(row.data()?.context));
  if (liveAuthorization.length) return missing.length || liveFailures.some(row => !liveAuthorization.includes(row)) ? 'mixed' : 'authorization';
  let verifiedFailures = liveFailures.every(row => row.data()?.connectionHistoryRunId === runId) && !!runId;
  if (missing.length) {
    verifiedFailures = false;
    if (runId) {
      const dead = await db.getAll(...missing.map(row => db.collection('failed_jobs').doc(row.ref.id)));
      const authorizationFailures = dead.filter((row, index) => row.data()?.connectionHistoryRunId === runId
        && row.data()?.originalCollection === missing[index].ref.parent.id && authorizationContexts.has(row.data()?.context)).length;
      if (authorizationFailures > 0) {
        if (authorizationFailures < missing.length || liveFailure) return 'mixed';
        return 'authorization';
      }
      verifiedFailures = dead.every((row, index) => row.data()?.connectionHistoryRunId === runId
        && row.data()?.originalCollection === missing[index].ref.parent.id)
        && liveFailures.every(row => row.data()?.connectionHistoryRunId === runId);
    }
    if (!verifiedFailures) return 'failed';
  }
  if (liveFailure && !verifiedFailures) return 'failed';
  if (live.some(row => {
    const data = row.data();
    // A verified cross-provider copy already satisfies this workout import. Other skips
    // still stop the scope when authorization or its connection changed.
    if ([SUUNTOAPP_WORKOUT_QUEUE_COLLECTION_NAME, COROSAPI_WORKOUT_QUEUE_COLLECTION_NAME,
      GARMIN_API_WORKOUT_QUEUE_COLLECTION_NAME, WAHOO_API_WORKOUT_QUEUE_COLLECTION_NAME].includes(row.ref.parent.id)
      && data?.resultStatus === 'skipped' && data.skippedReason === 'cross_provider_duplicate') return false;
    if (row.ref.parent.id === ROUTE_SYNC_QUEUE_COLLECTION_NAME
      && data?.resultStatus === 'skipped'
      && ['provider_route_up_to_date', 'provider_route_content_unchanged', 'provider_route_not_found'].includes(data.skippedReason)) return false;
    if (data?.resultStatus === 'failed') return false;
    return data?.skippedReason || (data?.resultStatus && data.resultStatus !== 'success');
  })) return missing.length || liveFailure ? 'failed' : 'skipped';
  if (missing.length || liveFailure) return {
    failedPaths: [...missing, ...liveFailures].map(row => row.ref.path),
    hadUnavailableRoutes: live.some(row => row.ref.parent.id === ROUTE_SYNC_QUEUE_COLLECTION_NAME
      && row.data()?.skippedReason === 'provider_route_not_found'),
  };
  // A route removed since listing must not abandon the rest of the library.
  return live.some(row => row.ref.parent.id === ROUTE_SYNC_QUEUE_COLLECTION_NAME
    && row.data()?.resultStatus === 'skipped' && row.data()?.skippedReason === 'provider_route_not_found')
    ? 'unavailable' : 'processed';
}

class HistoryCapacityWaitError extends Error {}
export function classifyHistoryFailure(error: unknown) {
  if (error instanceof HistoryCapacityWaitError) return { kind: 'wait' as const, message: 'Waiting for capacity. Your history will continue automatically.' };
  if (isHistoryWindowTooLarge(error)) return { kind: 'split' as const, message: 'This history window is too large. Trying a smaller range.' };
  if (error instanceof HistoryUnavailableError) return { kind: 'skip' as const, message: error.message };
  if (error instanceof HistorySkippedError) return { kind: 'skip' as const, message: error.message, nextAllowedAtMs: error.nextAllowedAtMs };
  if (error instanceof HistoryLifecycleChangedError) return { kind: 'skip' as const, message: 'This connection changed. Connect again to import the selected history.' };
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

async function saveRun(run: ConnectionHistoryRun, owner: string): Promise<{ run: ConnectionHistoryRun; currentConnection: boolean } | null> {
  const db = admin.firestore();
  return db.runTransaction(async tx => {
    const ref = refFor(run.id); const current = await tx.get(ref);
    if (!current.exists || current.data()?.leaseOwner !== owner || current.data()?.revision !== run.revision) return null;
    if ((await getUserDeletionGuardStateInTransaction(db, tx, run.userID)).shouldSkip) return null;
    // Firestore can replay this callback; keep the input revision and checkpoint immutable.
    const checkpoint = structuredClone(run);
    let currentConnection = true;
    try { await assertHistoryConnectionCurrent(checkpoint, tx); }
    catch (error) { if (!(error instanceof HistoryLifecycleChangedError)) throw error; currentConnection = false; }
    if (!currentConnection) {
      for (const step of checkpoint.steps.filter(step => !step.done)) {
        step.done = true; step.status = 'skipped'; step.message = 'This import was superseded by a connection change.';
      }
      checkpoint.processed = true;
    }
    const sleepRef = checkpoint.serviceName === ServiceNames.WahooAPI ? null : db.doc(`users/${checkpoint.userID}/sleepSyncState/${historySleepProvider(checkpoint.serviceName)}`);
    const sleep = currentConnection && checkpoint.processed && sleepRef ? await tx.get(sleepRef) : null;
    checkpoint.failed = checkpoint.steps.some(step => step.status === 'failed');
    checkpoint.revision++; checkpoint.updatedAtMs = Date.now(); delete checkpoint.leaseOwner; delete checkpoint.leaseExpiresAt;
    tx.set(ref, checkpoint);
    if (sleepRef && sleep?.data()?.connectionHistoryReservation === checkpoint.id) tx.set(sleepRef, { connectionHistoryReservationExpiresAt: 0 }, { merge: true });
    if (currentConnection) tx.set(db.doc(`users/${checkpoint.userID}/meta/${checkpoint.serviceName}`), {
      connectionHistoryImport: historyProjection(checkpoint),
      ...(checkpoint.processed ? { connectionHistoryReservationExpiresAt: 0 } : {}),
    }, { merge: true });
    return { run: checkpoint, currentConnection };
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
  const retryCount = run.steps.reduce((count, step) => count + step.retryCount, 0);
  let lifecycleSkip = false;
  let expectedContention = false;
  try {
    await historyExecution(run, []).beforeRequest();
    if (!(await hasProAccess(run.userID))) throw new HistoryLifecycleChangedError();
      await advanceHistoryRun(run, {
        observe: paths => observeHistoryChildren(paths, run.id, historyExecution(run, [], { owner, revision: run.revision })), classify: error => {
          expectedContention = historyExpectedContention(error);
          return classifyHistoryFailure(error);
        },
        execute: async step => {
          const key = historyOperationKey(step);
          if (run.lastOperation?.key === key) return run.lastOperation.result;
          const paths: string[] = [];
          const downstream = historyAdmissionQueue(run, step);
          const [depth, backlog] = await Promise.all([getCloudTaskQueueDepthForQueue(downstream.taskQueue, true),
            db.collection(downstream.collection).where('processed', '==', false).count().get()]);
          if (Math.max(depth, backlog.data().count) >= MAX_PENDING_TASKS / 2) {
            logger.info('[ConnectionHistory]', { event: 'capacity_wait', service: run.serviceName });
            throw new HistoryCapacityWaitError();
          }
          const execution = historyExecution(run, paths, { owner, revision: run.revision });
          let result: Awaited<ReturnType<typeof executeHistoryOperation>>;
          try { result = await withHistoryExecution(execution, () => executeHistoryOperation(run, step, execution)); }
          catch (error) {
            // A queue write can succeed before immediate dispatch fails. Keep
            // route children reachable so the next parent attempt can dispatch
            // them without requiring another provider read or new queue row.
            if (step.resources.includes('routes') && paths.length > 0 && paths.length <= 100) step.childPaths = paths;
            throw error;
          }
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
    lifecycleSkip = true;
    for (const step of run.steps.filter(step => !step.done)) {
      step.done = true; step.status = 'skipped'; step.message = 'The connection or Pro access changed. Reconnect to import the selected history.';
    }
    run.processed = true;
  }
  const saved = await saveRun(run, owner);
  if (saved) {
    const checkpoint = saved.run;
    const provider = historyMonitoringProvider(checkpoint.serviceName);
    const outcome = !saved.currentConnection || lifecycleSkip ? 'skipped' : !checkpoint.processed ? 'active'
      : expectedContention ? 'expected_contention' : checkpoint.failed ? 'failed' : checkpoint.steps.some(step => step.status === 'requested') ? 'requested'
      : checkpoint.steps.some(step => step.status === 'processed') ? 'processed' : 'skipped';
    emitHistoryMonitoring({ event: 'checkpoint', provider, outcome });
    if (saved.currentConnection && !lifecycleSkip && !expectedContention && checkpoint.steps.reduce((count, step) => count + step.retryCount, 0) > retryCount) {
      emitHistoryMonitoring({ event: 'operation_retry', provider });
    }
  }
}

export const processConnectionHistoryTask = onTaskDispatched({ region, timeoutSeconds: 300, memory: '512MiB',
  secrets: FUNCTION_SECRET_BINDINGS.processConnectionHistoryTask, retryConfig: PROVIDER_CLOUD_TASK_RETRY_CONFIG,
  rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 1 } }, async request => {
  const startedAt = Date.now();
  let outcome: 'acknowledged' | 'failed' | 'expected_contention' = 'acknowledged';
  try {
    if (!isConnectionHistoryRunId(request.data?.queueItemId) || typeof request.data?.queueRevision !== 'string') return;
    await processConnectionHistoryRun(request.data.queueItemId, request.data.queueRevision);
  } catch (error) { outcome = historyExpectedContention(error) ? 'expected_contention' : 'failed'; throw error; }
  finally { emitHistoryMonitoring({ event: 'worker_attempt', outcome, durationMs: Date.now() - startedAt }); }
});
export const onConnectionHistoryImportWritten = onDocumentWritten({ region, document: `${CONNECTION_HISTORY_COLLECTION}/{runId}`, retry: true }, async event => {
  const run = event.data?.after.data() as ConnectionHistoryRun | undefined;
  if (!run) return;
  if (run.processed) {
    const before = event.data?.before;
    const previous = before?.exists ? before.data() as ConnectionHistoryRun : undefined;
    const receipt = run.derivedMetricsFlush;
    const receiptCommitted = previous?.processed === true && !!receipt && receipt.revision === run.revision
      && Number.isSafeInteger(receipt.generation) && Number(receipt.generation) > 0
      && (previous.derivedMetricsFlush?.revision !== receipt.revision
        || previous.derivedMetricsFlush?.generation !== receipt.generation);
    const firstTerminal = previous?.processed === false;
    if ((firstTerminal || receiptCommitted) && previous?.userID === run.userID
      && run.id === event.params.runId && isConnectionHistoryRunId(run.id)) {
      const { flushPendingDerivedMetricsAfterHistory } = await import('../derived-metrics/derived-metrics.service');
      // The receipt's own event retries only its exact committed enqueue.
      // That repair never writes another receipt, so it cannot retrigger itself.
      if (receiptCommitted) await flushPendingDerivedMetricsAfterHistory(run.userID, run.id, run.revision, { repairOnly: true });
      else await flushPendingDerivedMetricsAfterHistory(run.userID, run.id, run.revision);
    }
    return;
  }
  if (event.data?.before.exists && event.data.before.data()?.revision === run.revision) return;
  await dispatchConnectionHistoryRun(run);
});
export const recoverConnectionHistoryImports = onSchedule({ region, schedule: '* * * * *', timeoutSeconds: 120 }, async event => {
  let outcome: 'completed' | 'failed' = 'completed';
  try {
    if (await getCloudTaskQueueDepthForQueue(config.cloudtasks.connectionHistoryQueue, true) >= MAX_PENDING_TASKS) return;
    const rows = await admin.firestore().collection(CONNECTION_HISTORY_COLLECTION).where('processed', '==', false)
      .where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(100).get();
    for (const row of rows.docs) {
      const run = row.data() as ConnectionHistoryRun;
      if ((run.leaseExpiresAt || 0) > Date.now()) continue;
      await dispatchConnectionHistoryRun(run);
    }
  } catch (error) { outcome = 'failed'; throw error; }
  finally {
    emitHistoryMonitoring({ event: 'recovery_run', outcome });
    if (historyProbeDue(event.scheduleTime)) {
      try {
        await observeConnectionHistory(admin.firestore(), async uid => {
          const { role, gracePeriodUntil } = await getUserRoleAndGracePeriod(uid);
          return role === 'pro' || isGracePeriodActive(gracePeriodUntil);
        }, queue => getCloudTaskQueueDepthForQueue(queue, true));
      } catch { recordHistoryProbeUnavailable(); }
    }
  }
});

export const retryConnectionHistoryImport = onCall({ region, cors: ALLOWED_CORS_ORIGINS }, async request => {
  enforceAppCheck(request);
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to retry history.');
  if (!isConnectionHistoryRunId(request.data?.runId)) throw new HttpsError('invalid-argument', 'Invalid history import.');
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
    if (meta?.connectionHistoryImport?.active && meta.connectionHistoryImport.runId !== run.id) {
      throw new HttpsError('already-exists', 'Another history import is running. Wait for it to finish before retrying.');
    }
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
    const retainedPaths = new Set(failed.flatMap(step => step.failedChildPaths ?? []));
    const retryPaths = [...new Set(failed.flatMap(step => [...step.childPaths, ...(step.failedChildPaths ?? [])]))];
    const children = await Promise.all(retryPaths.map(async path => {
      const ref = db.doc(path); const [live, dead] = await Promise.all([tx.get(ref), tx.get(db.collection('failed_jobs').doc(ref.id))]);
      return { ref, live, dead };
    }));
    if (retriesActivities) tx.set(metaRef, { connectionHistoryReservation: run.id, connectionHistoryReservationExpiresAt: Date.now() + 7 * 86400000 }, { merge: true });
    if (sleepRef) tx.set(sleepRef, { connectionHistoryReservation: run.id, connectionHistoryReservationExpiresAt: Date.now() + 35 * 86400000 }, { merge: true });
    for (const child of children) {
      const live = child.live.data();
      if (child.live.exists) {
        if (retainedPaths.has(child.ref.path) && live?.connectionHistoryRunId !== run.id) {
          throw new HttpsError('failed-precondition', 'Some history now belongs to another import. Reconnect or use History Import.');
        }
        if (live?.connectionHistoryRunId !== run.id || !live.processed || live.resultStatus !== 'failed') continue;
      }
      const data = child.live.exists ? live : child.dead.data();
      if (!data || data.connectionHistoryRunId !== run.id || (!child.live.exists && data.originalCollection !== child.ref.parent.id)) {
        throw new HttpsError('failed-precondition', 'Some history is no longer available to retry. Use History Import or reconnect.');
      }
      // Every canonical history queue uses null for an unissued task; false
      // would leave restored activity rows outside the dispatcher's query.
      const restored = { ...data, retryCount: 0, processed: false, dispatchedToCloudTask: null, queueRevision: randomUUID(), dateCreated: Date.now(), expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS) };
      for (const field of ['error', 'failedAt', 'context', 'originalCollection', 'processingOwner', 'processingRevision', 'processingLeaseExpiresAt']) delete restored[field as keyof typeof restored];
      for (const field of ['resultStatus', 'skippedReason', 'processedAt']) delete restored[field as keyof typeof restored];
      // Queue and DLQ rows are leaves by contract; there are no descendants to restore.
      tx.set(child.ref, restored);
      if (!child.live.exists) tx.delete(child.dead.ref);
    }
    for (const step of failed) {
      step.childPaths = [...new Set([...step.childPaths, ...(step.failedChildPaths ?? [])])];
      delete step.failedChildPaths;
      step.done = false; step.status = 'queued'; step.retryCount = 0; delete step.message;
    }
    run.processed = false; run.failed = false; run.revision++; run.nextAttemptAt = Date.now(); run.updatedAtMs = Date.now();
    delete run.leaseOwner; delete run.leaseExpiresAt;
    tx.set(ref, run); tx.set(db.doc(`users/${run.userID}/meta/${run.serviceName}`), { connectionHistoryImport: historyProjection(run) }, { merge: true });
  });
  return { accepted: true };
});
