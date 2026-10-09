import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({
  replayFinalCommit: false, rejectFinalCommit: false, rows: new Map<string, any>(), pro: vi.fn(), depth: vi.fn(), enqueue: vi.fn(), execute: vi.fn(), appCheck: vi.fn(), skip: vi.fn(), probe: vi.fn(), probeUnavailable: vi.fn(),
}));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('./monitoring-probe', () => ({ historyProbeDue: (time: string) => time.endsWith(':00:00Z'), observeConnectionHistory: mocks.probe, recordHistoryProbeUnavailable: mocks.probeUnavailable }));
vi.mock('firebase-functions/v2/tasks', () => ({ onTaskDispatched: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/https', async original => ({ ...await original<any>(), onCall: (_: unknown, handler: unknown) => handler }));
vi.mock('../utils', () => ({ hasProAccess: mocks.pro, enforceAppCheck: mocks.appCheck, ALLOWED_CORS_ORIGINS: [] }));
vi.mock('../config', () => ({ config: { cloudtasks: { workoutQueue: 'workout', sleepSyncQueue: 'sleep', garminHealthBackfillQueue: 'health', connectionHistoryQueue: 'history' } } }));
vi.mock('../secrets', () => ({ FUNCTION_SECRET_BINDINGS: { processConnectionHistoryTask: [] } }));
vi.mock('../shared/cloud-tasks', () => ({ enqueueConnectionHistoryTask: mocks.enqueue, getCloudTaskQueueDepthForQueue: mocks.depth }));
vi.mock('../queue-utils', () => ({ markQueueItemSkipped: mocks.skip }));
vi.mock('./adapters', () => ({ executeHistoryOperation: mocks.execute, historyAdmissionQueue: () => ({ taskQueue: 'workout', collection: 'workoutQueue' }), historySleepProvider: () => 'garmin', historyCooldownUntil: (_: unknown, meta: any) => Number(meta?.testCooldownUntil || 0), isHistoryWindowTooLarge: () => false,
  HistorySkippedError: class HistorySkippedError extends Error {} }));
vi.mock('firebase-admin', () => {
  const doc = (path: string): any => ({ path, id: path.split('/').at(-1), parent: { id: path.split('/').at(-2) },
    collection: (name: string) => collection(`${path}/${name}`), get: async () => snapshot(path) });
  const snapshot = (path: string) => ({ exists: mocks.rows.has(path), data: () => structuredClone(mocks.rows.get(path)), ref: doc(path), id: path.split('/').at(-1) });
  const collection = (path: string): any => {
    const query: any = { doc: (id: string) => doc(`${path}/${id}`), where: () => query, orderBy: () => query, limit: () => query,
      count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
      get: async () => ({ docs: [...mocks.rows.keys()].filter(key => key.startsWith(`${path}/`) && !mocks.rows.get(key).processed).map(snapshot) }) };
    return query;
  };
  const db = { doc, collection, getAll: async (...refs: any[]) => refs.map(ref => snapshot(ref.path)),
    runTransaction: async (work: any) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const writes: (() => void)[] = []; let finalCommit = false;
        const set = (ref: any, data: any, options?: any) => {
          if (ref.path.startsWith('connectionHistoryImports/') && data.revision === 1 && data.processed === true) finalCommit = true;
          writes.push(() => mocks.rows.set(ref.path, options?.merge ? { ...mocks.rows.get(ref.path), ...structuredClone(data) } : structuredClone(data)));
        };
        const result = await work({ get: async (ref: any) => { if (writes.length) throw new Error('Read after write'); return snapshot(ref.path); }, set,
          update: (ref: any, data: any) => set(ref, data, { merge: true }), delete: (ref: any) => writes.push(() => { mocks.rows.delete(ref.path); }) });
        if (mocks.replayFinalCommit && finalCommit) { mocks.replayFinalCommit = false; continue; }
        if (mocks.rejectFinalCommit && finalCommit) throw new Error('PRIVATE_COMMIT_FAILURE');
        writes.forEach(write => write()); return result;
      }
      throw new Error('Unexpected transaction attempts');
    } };
  return { firestore: () => db };
});
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import { CONNECTION_HISTORY_COLLECTION, createHistoryRun, type ConnectionHistoryRun } from './model';
import { processConnectionHistoryRun, observeHistoryChildren, dispatchConnectionHistoryRun, retryConnectionHistoryImport, classifyHistoryFailure, processConnectionHistoryTask, recoverConnectionHistoryImports, onConnectionHistoryImportWritten } from './tasks';
import { historyExecution, HistoryLifecycleChangedError, withHistoryQueueExecution } from './execution';
import type { QueueItemInterface } from '../queue/queue-item.interface';
import type { QueueResult } from '../queue-utils';
import { currentHistoryExecution, withHistoryExecution } from './context';
const now = Date.parse('2026-09-14T12:00:00Z');
const runId = '11111111-1111-4111-8111-111111111111';
let run: ConnectionHistoryRun;
const path = () => `${CONNECTION_HISTORY_COLLECTION}/${run.id}`;
const saved = () => mocks.rows.get(path()) as ConnectionHistoryRun;
beforeEach(() => {
  mocks.replayFinalCommit = false; mocks.rejectFinalCommit = false; vi.restoreAllMocks(); vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now); mocks.rows.clear();
  mocks.probe.mockReset().mockResolvedValue(undefined); mocks.probeUnavailable.mockReset();
  mocks.pro.mockReset().mockResolvedValue(true); mocks.depth.mockReset().mockResolvedValue(0); mocks.enqueue.mockReset().mockResolvedValue(true); mocks.appCheck.mockReset();
  mocks.skip.mockReset().mockResolvedValue('PROCESSED');
  run = createHistoryRun('owner', ServiceNames.WahooAPI, { requested: true, rangePreset: '30_days', runId, tokenPath: 'wahooAPIAccessTokens/owner/tokens/account', rootPath: 'wahooAPIAccessTokens/owner', providerUserId: 'account', credentialGeneration: 'credential' }, 'connection', now);
  mocks.rows.set(path(), run); mocks.rows.set('users/owner', { uid: 'owner' });
  mocks.rows.set(run.rootPath, { activeOAuthCredentialGeneration: 'credential' }); mocks.rows.set(run.tokenPath, { tokenCredentialGeneration: 'credential' });
  mocks.rows.set(`users/owner/meta/${run.serviceName}`, { connectionState: 'connected', connectionStateGeneration: 'connection' });
  mocks.execute.mockReset().mockResolvedValue({ count: 0, nextStartMs: now + 1000, nextPage: 1 });
});
const signals = () => [...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.warn).mock.calls]
  .filter(([, fields]) => fields?.telemetryVersion === 1).map(([, fields]) => fields);
describe('durable history coordinator', () => {
  it('finishes an empty import and projects only safe progress', async () => {
    await processConnectionHistoryRun(run.id, '0'); expect(saved().processed).toBe(true);
    const meta = mocks.rows.get(`users/owner/meta/${run.serviceName}`);
    expect(meta.connectionHistoryImport.steps[0].status).toBe('processed'); expect(JSON.stringify(meta)).not.toContain('credential');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it('saves the same checkpoint when Firestore retries the completion transaction', async () => {
    mocks.replayFinalCommit = true;
    await processConnectionHistoryRun(run.id, '0');
    expect(saved()).toMatchObject({ processed: true, revision: 1 });
    expect(saved().leaseOwner).toBeUndefined();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(signals().filter(fields => fields.event === 'checkpoint')).toHaveLength(1);
  });
  it('ignores duplicate task revisions and active leases', async () => {
    await processConnectionHistoryRun(run.id, 'old'); expect(mocks.execute).not.toHaveBeenCalled();
    run.leaseOwner = 'other'; run.leaseExpiresAt = now + 60000;
    await processConnectionHistoryRun(run.id, '0'); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('defers full downstream queues without spending retries', async () => {
    mocks.depth.mockResolvedValue(500); await processConnectionHistoryRun(run.id, '0');
    expect(saved().steps[0].retryCount).toBe(0); expect(saved().nextAttemptAt).toBe(now + 60000); expect(mocks.execute).not.toHaveBeenCalled();
    expect(signals()).toEqual([{ telemetryVersion: 1, event: 'checkpoint', provider: 'wahoo', outcome: 'active' }]);
  });
  it('recovers a completed operation receipt even at capacity without calling the provider again', async () => {
    run.lastOperation = { key: JSON.stringify(['activities', 1, run.startMs, 30, 1]), result: { count: 4, nextStartMs: now + 1000, nextPage: 1, childPaths: [] } };
    mocks.depth.mockResolvedValue(500);
    await processConnectionHistoryRun(run.id, '0'); expect(mocks.execute).not.toHaveBeenCalled(); expect(saved().steps[0].count).toBe(4);
    expect(mocks.depth).not.toHaveBeenCalled(); expect(saved().processed).toBe(true);
    expect(signals()).toEqual([{ telemetryVersion: 1, event: 'checkpoint', provider: 'wahoo', outcome: 'processed' }]);
  });
  it.each(['root', 'token', 'meta', 'disconnect', 'deleted', 'pro'])('stops before provider work after %s lifecycle changes', async kind => {
    if (kind === 'root') mocks.rows.set(run.rootPath, { activeOAuthCredentialGeneration: 'replacement' });
    if (kind === 'token') mocks.rows.set(run.tokenPath, { tokenCredentialGeneration: 'replacement' });
    if (kind === 'meta') mocks.rows.set(`users/owner/meta/${run.serviceName}`, { connectionState: 'connected', connectionStateGeneration: 'replacement' });
    if (kind === 'disconnect') mocks.rows.get(run.rootPath).disconnectOperationGeneration = 'disconnect';
    if (kind === 'deleted') mocks.rows.set('userDeletionTombstones/owner', { expireAt: now + 60000 });
    if (kind === 'pro') mocks.pro.mockResolvedValue(false);
    await processConnectionHistoryRun(run.id, '0'); expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.rows.get(`users/owner/meta/${run.serviceName}`).connectionState).toBe('connected');
  });
  it('does not overwrite replacement status after the provider responds', async () => {
    mocks.execute.mockImplementation(async () => { mocks.rows.set(run.rootPath, { activeOAuthCredentialGeneration: 'new' });
      mocks.rows.set(`users/owner/meta/${run.serviceName}`, { connectionState: 'connected', connectionStateGeneration: 'new', connectionHistoryImport: { runId: 'new' } });
      return { count: 1, nextStartMs: now + 1000, nextPage: 1 }; });
    await processConnectionHistoryRun(run.id, '0'); expect(mocks.rows.get(`users/owner/meta/${run.serviceName}`).connectionHistoryImport).toEqual({ runId: 'new' });
  });
  it('dispatches durable identity and rejects unaccepted startup', async () => {
    await dispatchConnectionHistoryRun(run); expect(mocks.enqueue).toHaveBeenCalledWith(run.id, now, 1, expect.objectContaining({ queueRevision: '0' }));
    mocks.enqueue.mockResolvedValue(false); await expect(dispatchConnectionHistoryRun(run)).rejects.toThrow('not accepted');
  });
  it('never treats a missing, pending or skipped child as successful ingestion', async () => {
    expect(await observeHistoryChildren(['queue/missing'])).toBe('failed');
    mocks.rows.set('queue/item', { processed: false }); expect(await observeHistoryChildren(['queue/item'])).toBe('pending');
    mocks.rows.set('queue/item', { processed: true, skippedReason: 'disconnected' }); expect(await observeHistoryChildren(['queue/item'])).toBe('skipped');
  });
  it.each(['user_not_allowed', 'provider_disabled', 'deferred', 'manual_reconciliation_required'])('does not claim delivery for terminal %s worker outcomes', async resultStatus => {
    mocks.rows.set('queue/item', { processed: true, resultStatus });
    expect(await observeHistoryChildren(['queue/item'])).toBe('skipped');
  });
  it.each(['PERMISSION_MISSING', 'GARMIN_HEALTH_BACKFILL_PERMISSION_MISSING', 'GARMIN_HEALTH_BACKFILL_AUTH_REQUIRED'])('recognizes only the current run’s matching %s failure without exposing DLQ details', async context => {
    mocks.rows.set('failed_jobs/missing', { connectionHistoryRunId: run.id, originalCollection: 'queue', context, error: 'private provider details' });
    expect(await observeHistoryChildren(['queue/missing'], run.id)).toBe('authorization');
    expect(await observeHistoryChildren(['queue/missing'], 'different-run')).toBe('failed');
    expect(await observeHistoryChildren(['otherQueue/missing'], run.id)).toBe('failed');
  });
  it('keeps mixed authorization and recoverable child failures retryable', async () => {
    mocks.rows.set('failed_jobs/auth', { connectionHistoryRunId: run.id, originalCollection: 'queue', context: 'PERMISSION_MISSING' });
    mocks.rows.set('failed_jobs/retry', { connectionHistoryRunId: run.id, originalCollection: 'queue', context: 'MAX_RETRY_REACHED' });
    expect(await observeHistoryChildren(['queue/auth', 'queue/retry'], run.id)).toBe('mixed');
    mocks.rows.set('queue/retry', { processed: true, resultStatus: 'failed' });
    expect(await observeHistoryChildren(['queue/auth', 'queue/retry'], run.id)).toBe('mixed');
  });
  it('waits for live children before reporting another child authorization failure', async () => {
    mocks.rows.set('failed_jobs/auth', { connectionHistoryRunId: run.id, originalCollection: 'queue', context: 'PERMISSION_MISSING' });
    mocks.rows.set('queue/pending', { processed: false });
    expect(await observeHistoryChildren(['queue/auth', 'queue/pending'], run.id)).toBe('pending');
  });
  it('keeps invocation contexts isolated and checks replacement credentials inside writes', async () => {
    const execution = historyExecution(run, []); expect(currentHistoryExecution()).toBeUndefined();
    await withHistoryExecution(execution, async () => {
      expect(currentHistoryExecution()).toBe(execution); mocks.rows.get(run.tokenPath).tokenCredentialGeneration = 'new';
      await expect(execution.beforeRequest()).rejects.toThrow('earlier connection');
    }); expect(currentHistoryExecution()).toBeUndefined();
  });
  it.each(['connection', 'missing-run', 'pro'])('acknowledges a queued history child after %s changes without provider work or task retries', async change => {
    const item: QueueItemInterface = { id: 'child', dateCreated: now, processed: false, retryCount: 0, dispatchedToCloudTask: null,
      connectionHistoryRunId: run.id, firebaseUserID: 'owner', queueRevision: 'child-revision' };
    if (change === 'connection') mocks.rows.get(`users/owner/meta/${run.serviceName}`).connectionStateGeneration = 'replacement';
    if (change === 'missing-run') mocks.rows.delete(path());
    if (change === 'pro') mocks.pro.mockResolvedValue(false);
    const operation = vi.fn(async () => 'PROCESSED' as QueueResult);
    await expect(withHistoryQueueExecution(item, operation)).resolves.toBe('PROCESSED');
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.skip).toHaveBeenCalledWith(item, undefined, 'connection_history_superseded', { skippedContext: 'CONNECTION_HISTORY_LIFECYCLE_GUARD' });
  });
  it('keeps transient guard reads retryable and handles a lifecycle change during authorized work', async () => {
    const item: QueueItemInterface = { id: 'child', dateCreated: now, processed: false, retryCount: 0, dispatchedToCloudTask: null,
      connectionHistoryRunId: run.id, firebaseUserID: 'owner', queueRevision: 'child-revision' };
    mocks.pro.mockRejectedValueOnce(new Error('Transient read failure'));
    const operation = vi.fn(async () => 'PROCESSED' as QueueResult);
    await expect(withHistoryQueueExecution(item, operation)).rejects.toThrow('Transient read failure');
    expect(mocks.skip).not.toHaveBeenCalled();
    operation.mockRejectedValueOnce(new HistoryLifecycleChangedError());
    await expect(withHistoryQueueExecution(item, operation)).resolves.toBe('PROCESSED');
    expect(mocks.skip).toHaveBeenCalledOnce();
    expect(currentHistoryExecution()).toBeUndefined();
  });
  it('does not reuse a persisted Sleep lease as authority for an early lifecycle skip', async () => {
    const item = { id: 'child', dateCreated: now, processed: false, retryCount: 0, dispatchedToCloudTask: null,
      connectionHistoryRunId: run.id, userID: 'owner', queueRevision: 'child-revision',
      processingOwner: 'another-worker', processingRevision: 'child-revision', processingLeaseExpiresAt: now + 60000,
      ref: { parent: { id: 'sleepSyncQueue' } },
    } as unknown as QueueItemInterface;
    mocks.rows.delete(path());
    await withHistoryQueueExecution(item, vi.fn());
    const transitionItem = mocks.skip.mock.calls[0][0];
    expect(transitionItem.processingOwner).toBeUndefined();
    expect(transitionItem.processingRevision).toBeUndefined();
    expect(transitionItem.processingLeaseExpiresAt).toBeUndefined();
    expect(item.processingOwner).toBe('another-worker');
  });
  it('requires authentication, owner identity and App Check for retries', async () => {
    const retry = retryConnectionHistoryImport as unknown as (request: any) => Promise<unknown>;
    await expect(retry({ data: { runId: run.id } })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(retry({ auth: { uid: 'other' }, data: { runId: run.id } })).rejects.toMatchObject({ code: 'not-found' });
    expect(mocks.appCheck).toHaveBeenCalledTimes(2);
  });
  it('honors a provider refresh retry timestamp longer than its HTTP retry hint', () => {
    expect(classifyHistoryFailure({ retryAt: now + 300000, details: { retryAfterSeconds: 60 } })).toMatchObject({ kind: 'retry', retryAt: now + 300000 });
  });
  it('retries failed work only, keeping its range and completed steps', async () => {
    run.processed = true; run.steps[0].status = 'failed'; run.steps[0].done = true; run.steps[0].retryCount = 10;
    const retry = retryConnectionHistoryImport as unknown as (request: any) => Promise<unknown>;
    await retry({ auth: { uid: 'owner' }, data: { runId: run.id } });
    expect(saved().startMs).toBe(run.startMs); expect(saved().steps[0].status).toBe('queued'); expect(saved().processed).toBe(false);
  });
  it.each(['lease', 'cooldown'])('does not restore failed queue work while a manual %s applies', async kind => {
    run.processed = true; run.steps[0].status = 'failed'; run.steps[0].done = true;
    run.steps[0].childPaths = ['workoutQueue/failed'];
    const meta = mocks.rows.get(`users/owner/meta/${run.serviceName}`);
    if (kind === 'lease') meta.historyImportLeaseExpiresAt = now + 60000;
    if (kind === 'cooldown') meta.testCooldownUntil = now + 60000;
    mocks.rows.set('failed_jobs/failed', { connectionHistoryRunId: run.id, originalCollection: 'workoutQueue' });
    const retry = retryConnectionHistoryImport as unknown as (request: any) => Promise<unknown>;
    await expect(retry({ auth: { uid: 'owner' }, data: { runId: run.id } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mocks.rows.has('workoutQueue/failed')).toBe(false); expect(saved().processed).toBe(true);
  });
  it('restores its own failed child with a new revision without resetting its original cooldown', async () => {
    run.processed = true; run.steps[0].status = 'failed'; run.steps[0].done = true;
    run.steps[0].childPaths = ['workoutQueue/failed'];
    const meta = mocks.rows.get(`users/owner/meta/${run.serviceName}`);
    meta.connectionHistoryReservation = run.id; meta.testCooldownUntil = now + 60000;
    mocks.rows.set('failed_jobs/failed', { connectionHistoryRunId: run.id, originalCollection: 'workoutQueue', queueRevision: 'old', error: 'failed', expireAt: { seconds: 1 } });
    const retry = retryConnectionHistoryImport as unknown as (request: any) => Promise<unknown>;
    await retry({ auth: { uid: 'owner' }, data: { runId: run.id } });
    expect(mocks.rows.get('workoutQueue/failed')).toMatchObject({ processed: false, retryCount: 0 });
    expect(mocks.rows.get('workoutQueue/failed').queueRevision).not.toBe('old');
    expect(mocks.rows.get('workoutQueue/failed').expireAt).toMatchObject({ _seconds: Math.floor(now / 1000) + 7 * 86400 });
    expect(mocks.rows.has('failed_jobs/failed')).toBe(false);
    expect(mocks.rows.get(`users/owner/meta/${run.serviceName}`).testCooldownUntil).toBe(now + 60000);
  });
  it('only reports committed real retries / new terminal failures, never raw provider errors', async () => {
    mocks.execute.mockRejectedValue(new Error('PRIVATE_PROVIDER_FAILURE'));
    await processConnectionHistoryRun(run.id, '0');
    expect(signals()).toContainEqual({ telemetryVersion: 1, event: 'operation_retry', provider: 'wahoo' });
    expect(signals()).not.toContainEqual(expect.objectContaining({ outcome: 'failed' }));
    const row = saved(); row.steps[0].retryCount = 9; row.nextAttemptAt = now; mocks.rows.set(path(), row);
    await processConnectionHistoryRun(run.id, String(row.revision));
    expect(signals()).toContainEqual({ telemetryVersion: 1, event: 'checkpoint', provider: 'wahoo', outcome: 'failed' });
    expect(JSON.stringify(signals())).not.toContain('PRIVATE');
  });
  it('emits no checkpoint or retry on rejected persistence', async () => {
    mocks.rejectFinalCommit = true;
    await expect(processConnectionHistoryRun(run.id, '0')).rejects.toThrow('PRIVATE_COMMIT_FAILURE');
    expect(signals()).toEqual([]);
  });
  it('does not page for credential lease contention or alter its existing retry semantics', async () => {
    const error = new Error('PRIVATE_LEASE'); error.name = 'TokenRefreshInProgressError';
    mocks.execute.mockRejectedValue(error);
    await processConnectionHistoryRun(run.id, '0');
    expect(saved().steps[0].retryCount).toBe(1);
    expect(signals().some(fields => fields.event === 'operation_retry' || fields.outcome === 'failed')).toBe(false);
  });
  it('reports unexpected whole-worker failures but acknowledges stale revisions without failure', async () => {
    const worker = processConnectionHistoryTask as unknown as (request: any) => Promise<void>;
    await worker({ data: { queueItemId: run.id, queueRevision: 'stale' } });
    expect(signals()).toEqual([{ telemetryVersion: 1, event: 'worker_attempt', provider: 'unknown', outcome: 'acknowledged', durationMs: 0 }]);
    mocks.pro.mockRejectedValueOnce(new Error('PRIVATE_READ'));
    await expect(worker({ data: { queueItemId: run.id, queueRevision: '0' } })).rejects.toThrow('PRIVATE_READ');
    expect(signals().at(-1)?.outcome).toBe('failed');
  });
  it('keeps startup errors retryable, while already processed trigger revisions stay silent', async () => {
    const trigger = onConnectionHistoryImportWritten as unknown as (event: any) => Promise<void>;
    const event = { data: { after: { data: () => run }, before: { exists: false } } };
    mocks.enqueue.mockResolvedValue(false);
    await expect(trigger(event)).rejects.toThrow('not accepted');
    expect(signals().at(-1)).toMatchObject({ event: 'dispatch_attempt', outcome: 'failed', provider: 'wahoo' });
    run.processed = true; await trigger(event); expect(signals()).toHaveLength(1);
  });
  it('a failed or saturated recovery still probes on its scheduled tick without masking the original result', async () => {
    const recovery = recoverConnectionHistoryImports as unknown as (event: any) => Promise<void>;
    mocks.depth.mockRejectedValueOnce(new Error('PRIVATE_DEPTH'));
    mocks.probe.mockRejectedValueOnce(new Error('PRIVATE_PROBE'));
    await expect(recovery({ scheduleTime: '2026-10-09T12:00:00Z' })).rejects.toThrow('PRIVATE_DEPTH');
    expect(signals()).toContainEqual({ telemetryVersion: 1, event: 'recovery_run', provider: 'unknown', outcome: 'failed' });
    expect(mocks.probeUnavailable).toHaveBeenCalledOnce();
    mocks.depth.mockResolvedValue(1000);
    await recovery({ scheduleTime: '2026-10-09T12:00:00Z' });
    expect(mocks.probe).toHaveBeenCalledTimes(2);
    await recovery({ scheduleTime: '2026-10-09T12:01:00Z' });
    expect(mocks.probe).toHaveBeenCalledTimes(2);
  });

});
