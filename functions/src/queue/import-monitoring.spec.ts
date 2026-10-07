import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { observeImportQueue, recordImportAttempt, recordImportCommit, recordImportCompletion, recordImportDispatch } from './import-monitoring';

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
    expect(logger.info).not.toHaveBeenCalled();
  });
  it('logger failures cannot undo a committed import', () => {
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('unavailable'); });
    expect(() => recordImportCommit('garminAPIActivityQueue', 'imported')).not.toThrow();
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
});
