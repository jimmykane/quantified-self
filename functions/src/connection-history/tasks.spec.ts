import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({
  rows: new Map<string, any>(), pro: vi.fn(), depth: vi.fn(), enqueue: vi.fn(), execute: vi.fn(), appCheck: vi.fn(),
}));
vi.mock('firebase-functions/v2/tasks', () => ({ onTaskDispatched: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/https', async original => ({ ...await original<any>(), onCall: (_: unknown, handler: unknown) => handler }));
vi.mock('../utils', () => ({ hasProAccess: mocks.pro, enforceAppCheck: mocks.appCheck, ALLOWED_CORS_ORIGINS: [] }));
vi.mock('../config', () => ({ config: { cloudtasks: { workoutQueue: 'workout', sleepSyncQueue: 'sleep', garminHealthBackfillQueue: 'health', connectionHistoryQueue: 'history' } } }));
vi.mock('../secrets', () => ({ FUNCTION_SECRET_BINDINGS: { processConnectionHistoryTask: [] } }));
vi.mock('../shared/cloud-tasks', () => ({ enqueueConnectionHistoryTask: mocks.enqueue, getCloudTaskQueueDepthForQueue: mocks.depth }));
vi.mock('./adapters', () => ({ executeHistoryOperation: mocks.execute, historySleepProvider: () => 'garmin', historyCooldownUntil: (_: unknown, meta: any) => Number(meta?.testCooldownUntil || 0), isHistoryWindowTooLarge: () => false,
  HistorySkippedError: class HistorySkippedError extends Error {} }));
vi.mock('firebase-admin', () => {
  const doc = (path: string): any => ({ path, id: path.split('/').at(-1), parent: { id: path.split('/').at(-2) },
    collection: (name: string) => collection(`${path}/${name}`), get: async () => snapshot(path) });
  const snapshot = (path: string) => ({ exists: mocks.rows.has(path), data: () => structuredClone(mocks.rows.get(path)), ref: doc(path), id: path.split('/').at(-1) });
  const collection = (path: string) => ({ doc: (id: string) => doc(`${path}/${id}`), where: () => ({ count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }) }) });
  const db = { doc, collection, getAll: async (...refs: any[]) => refs.map(ref => snapshot(ref.path)),
    runTransaction: async (work: any) => {
      const writes: (() => void)[] = [];
      const set = (ref: any, data: any, options?: any) => writes.push(() => mocks.rows.set(ref.path, options?.merge ? { ...mocks.rows.get(ref.path), ...structuredClone(data) } : structuredClone(data)));
      const result = await work({ get: async (ref: any) => { if (writes.length) throw new Error('Read after write'); return snapshot(ref.path); }, set,
        update: (ref: any, data: any) => set(ref, data, { merge: true }), delete: (ref: any) => writes.push(() => { mocks.rows.delete(ref.path); }) });
      writes.forEach(write => write()); return result;
    } };
  return { firestore: () => db };
});
import { ServiceNames } from '@sports-alliance/sports-lib';
import { CONNECTION_HISTORY_COLLECTION, createHistoryRun, type ConnectionHistoryRun } from './model';
import { processConnectionHistoryRun, observeHistoryChildren, dispatchConnectionHistoryRun, retryConnectionHistoryImport, classifyHistoryFailure } from './tasks';
import { historyExecution } from './execution';
import { currentHistoryExecution, withHistoryExecution } from './context';
const now = Date.parse('2026-09-14T12:00:00Z');
let run: ConnectionHistoryRun;
const path = () => `${CONNECTION_HISTORY_COLLECTION}/${run.id}`;
const saved = () => mocks.rows.get(path()) as ConnectionHistoryRun;
beforeEach(() => {
  vi.restoreAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now); mocks.rows.clear();
  mocks.pro.mockReset().mockResolvedValue(true); mocks.depth.mockReset().mockResolvedValue(0); mocks.enqueue.mockReset().mockResolvedValue(true); mocks.appCheck.mockReset();
  run = createHistoryRun('owner', ServiceNames.WahooAPI, { requested: true, flowGeneration: 'flow', tokenPath: 'wahooAPIAccessTokens/owner/tokens/account', rootPath: 'wahooAPIAccessTokens/owner', providerUserId: 'account', credentialGeneration: 'credential' }, 'connection', now);
  mocks.rows.set(path(), run); mocks.rows.set('users/owner', { uid: 'owner' });
  mocks.rows.set(run.rootPath, { activeOAuthCredentialGeneration: 'credential' }); mocks.rows.set(run.tokenPath, { tokenCredentialGeneration: 'credential' });
  mocks.rows.set(`users/owner/meta/${run.serviceName}`, { connectionState: 'connected', connectionStateGeneration: 'connection' });
  mocks.execute.mockReset().mockResolvedValue({ count: 0, nextStartMs: now + 1000, nextPage: 1 });
});
describe('durable history coordinator', () => {
  it('finishes an empty import and projects only safe progress', async () => {
    await processConnectionHistoryRun(run.id, '0'); expect(saved().processed).toBe(true);
    const meta = mocks.rows.get(`users/owner/meta/${run.serviceName}`);
    expect(meta.connectionHistoryImport.steps[0].status).toBe('processed'); expect(JSON.stringify(meta)).not.toContain('credential');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it('ignores duplicate task revisions and active leases', async () => {
    await processConnectionHistoryRun(run.id, 'old'); expect(mocks.execute).not.toHaveBeenCalled();
    run.leaseOwner = 'other'; run.leaseExpiresAt = now + 60000;
    await processConnectionHistoryRun(run.id, '0'); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('defers full downstream queues without spending retries', async () => {
    mocks.depth.mockResolvedValue(500); await processConnectionHistoryRun(run.id, '0');
    expect(saved().steps[0].retryCount).toBe(0); expect(saved().nextAttemptAt).toBe(now + 60000); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('recovers a completed operation receipt without calling the provider again', async () => {
    run.lastOperation = { key: JSON.stringify(['activities', 1, run.startMs, 30, 1]), result: { count: 4, nextStartMs: now + 1000, nextPage: 1, childPaths: [] } };
    await processConnectionHistoryRun(run.id, '0'); expect(mocks.execute).not.toHaveBeenCalled(); expect(saved().steps[0].count).toBe(4);
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
  it('recognizes only the current run’s matching authorization failure without exposing DLQ details', async () => {
    mocks.rows.set('failed_jobs/missing', { connectionHistoryRunId: run.id, originalCollection: 'queue', context: 'PERMISSION_MISSING', error: 'private provider details' });
    expect(await observeHistoryChildren(['queue/missing'], run.id)).toBe('authorization');
    expect(await observeHistoryChildren(['queue/missing'], 'different-run')).toBe('failed');
    expect(await observeHistoryChildren(['otherQueue/missing'], run.id)).toBe('failed');
  });
  it('keeps invocation contexts isolated and checks replacement credentials inside writes', async () => {
    const execution = historyExecution(run, []); expect(currentHistoryExecution()).toBeUndefined();
    await withHistoryExecution(execution, async () => {
      expect(currentHistoryExecution()).toBe(execution); mocks.rows.get(run.tokenPath).tokenCredentialGeneration = 'new';
      await expect(execution.beforeRequest()).rejects.toThrow('earlier connection');
    }); expect(currentHistoryExecution()).toBeUndefined();
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
    mocks.rows.set('failed_jobs/failed', { connectionHistoryRunId: run.id, originalCollection: 'workoutQueue', queueRevision: 'old', error: 'failed' });
    const retry = retryConnectionHistoryImport as unknown as (request: any) => Promise<unknown>;
    await retry({ auth: { uid: 'owner' }, data: { runId: run.id } });
    expect(mocks.rows.get('workoutQueue/failed')).toMatchObject({ processed: false, retryCount: 0 });
    expect(mocks.rows.get('workoutQueue/failed').queueRevision).not.toBe('old');
    expect(mocks.rows.has('failed_jobs/failed')).toBe(false);
    expect(mocks.rows.get(`users/owner/meta/${run.serviceName}`).testCooldownUntil).toBe(now + 60000);
  });

});
