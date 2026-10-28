import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { observeImportQueue, recordImportAttempt, recordImportCommit, recordImportCompletion, recordImportDispatch, recordImportQueueUnavailable } from './import-monitoring';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));

describe('privacy-safe recorded import telemetry', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    [ServiceNames.GarminAPI, 'garmin', 'garminAPIActivityQueue'],
    [ServiceNames.SuuntoApp, 'suunto', 'suuntoAppWorkoutQueue'],
    [ServiceNames.COROSAPI, 'coros', 'COROSAPIWorkoutQueue'],
    [ServiceNames.WahooAPI, 'wahoo', 'wahooAPIWorkoutQueue'],
  ])('uses fixed provider labels for %s', (service, provider, collection) => {
    recordImportAttempt(service, 'token_refresh_deferred', 10);
    recordImportCompletion(collection, { resultStatus: 'skipped', uid: 'PRIVATE', error: 'PRIVATE' });
    recordImportCommit(collection, 'dead_lettered');
    recordImportDispatch(service, 'failed');
    expect(logger.info).toHaveBeenCalledWith('[ActivityImport]', { telemetryVersion: 1, provider, event: 'committed', outcome: 'skipped' });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
  });
  it('ignores unrelated queues and arbitrary service labels', () => {
    recordImportCommit('sleepSyncQueue', 'imported');
    recordImportAttempt('PRIVATE', 'failed', 10);
    recordImportCompletion('garminAPIActivityQueue', { resultStatus: 'deferred' });
    recordImportQueueUnavailable('PRIVATE');
    expect(logger.info).not.toHaveBeenCalled();
  });
  it('logger failures cannot undo a committed import', () => {
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('unavailable'); });
    expect(() => recordImportCommit('garminAPIActivityQueue', 'imported')).not.toThrow();
  });
  it('reports only a fixed provider for an unexpected observation failure, even if logging fails', () => {
    recordImportQueueUnavailable(ServiceNames.WahooAPI);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith('[ActivityImport]', { telemetryVersion: 1, provider: 'wahoo', event: 'queue_sample_unavailable' });
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('PRIVATE_LOG_FAILURE'); });
    expect(() => recordImportQueueUnavailable(ServiceNames.WahooAPI)).not.toThrow();
  });
  it('read failure is unavailable, never zero or a private exception', async () => {
    const chain = { where: vi.fn(), select: vi.fn(), limit: vi.fn(), get: vi.fn().mockRejectedValue(new Error('PRIVATE')) };
    chain.where.mockReturnValue(chain); chain.select.mockReturnValue(chain); chain.limit.mockReturnValue(chain);
    await observeImportQueue({ collection: () => chain } as unknown as FirebaseFirestore.Firestore, ServiceNames.GarminAPI);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith('[ActivityImport]', { telemetryVersion: 1, provider: 'garmin', event: 'queue_sample_unavailable' });
    expect(chain.limit).toHaveBeenCalledWith(21);
    expect(chain.select).not.toHaveBeenCalledWith(expect.arrayContaining(['callbackURL', 'FITFileURI', 'errors']));
  });
  it('a late empty read cannot turn a timed-out observation into zero backlog', async () => {
    vi.useFakeTimers();
    try {
      let release!: (value: { docs: []; size: number }) => void;
      const pendingRead = new Promise<{ docs: []; size: number }>(resolve => { release = resolve; });
      const chain = { where: vi.fn(), select: vi.fn(), limit: vi.fn(), get: vi.fn().mockReturnValue(pendingRead) };
      chain.where.mockReturnValue(chain); chain.select.mockReturnValue(chain); chain.limit.mockReturnValue(chain);
      const observing = observeImportQueue({ collection: () => chain } as unknown as FirebaseFirestore.Firestore, ServiceNames.GarminAPI);
      await vi.advanceTimersByTimeAsync(5_000);
      await observing;
      release({ docs: [], size: 0 });
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith('[ActivityImport]', { telemetryVersion: 1, provider: 'garmin', event: 'queue_sample_unavailable' });
    } finally { vi.useRealTimers(); }
  });
  it('stops token lookups and later candidates when a read-only snapshot finishes after the deadline', async () => {
    vi.useFakeTimers();
    try {
      let release!: (snapshots: unknown[]) => void;
      const pendingSnapshot = new Promise<unknown[]>(resolve => { release = resolve; });
      const reference = { collection: vi.fn().mockReturnThis(), doc: vi.fn().mockReturnThis() };
      const updateTime = { isEqual: () => true, toMillis: () => 1 };
      const data = { firebaseUserID: 'qa', userID: 'account', dateCreated: 1, retryCount: 0, processed: false, dispatchedToCloudTask: null };
      const candidate = { ref: reference, updateTime, data: () => data };
      const chain = { where: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: [candidate, candidate], size: 2 }) };
      const transaction = { getAll: vi.fn().mockReturnValue(pendingSnapshot), get: vi.fn() };
      const db = { collection: (name: string) => name === 'garminAPIActivityQueue' ? chain : reference,
        runTransaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) };
      const observing = observeImportQueue(db as unknown as FirebaseFirestore.Firestore, ServiceNames.GarminAPI, 10);
      await vi.advanceTimersByTimeAsync(5_000);
      await observing;
      release([{ exists: true, updateTime, data: () => data }, { exists: true }, { exists: false },
        { get: () => undefined }, { exists: true, get: () => undefined }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(transaction.getAll).toHaveBeenCalledTimes(1);
      expect(transaction.get).not.toHaveBeenCalled();
      expect(reference.collection).not.toHaveBeenCalledWith('tokens');
      expect(db.runTransaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { readOnly: true });
      expect(logger.info).toHaveBeenCalledExactlyOnceWith('[ActivityImport]', { telemetryVersion: 1, provider: 'garmin', event: 'queue_sample_unavailable' });
    } finally { vi.useRealTimers(); }
  });
});
