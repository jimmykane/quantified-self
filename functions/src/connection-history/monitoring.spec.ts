import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { emitHistoryMonitoring, historyMonitoringProvider } from './monitoring';
beforeEach(() => vi.clearAllMocks());
describe('history telemetry privacy boundary', () => {
  it('maps only fixed provider categories', () => {
    expect([ServiceNames.GarminAPI, ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.WahooAPI, 'private'].map(historyMonitoringProvider))
      .toEqual(['garmin', 'suunto', 'coros', 'wahoo', 'unknown']);
  });
  it('strips private fields and bounds numbers without inventing unknown zeroes', () => {
    emitHistoryMonitoring({ event: 'queue_sample', provider: 'private', dueSample: 1000, ageLowerBoundMs: Infinity,
      unknownSample: -1, durationMs: 3.9, truncated: true, userID: 'private', token: 'secret', error: 'raw' } as any);
    expect(logger.info).toHaveBeenCalledWith('[ConnectionHistory]', { telemetryVersion: 1, event: 'queue_sample', provider: 'unknown', dueSample: 100, durationMs: 3, truncated: true });
  });
  it('does not change processing when logging fails or accept unknown discriminants', () => {
    vi.mocked(logger.warn).mockImplementationOnce(() => { throw new Error('logging'); });
    expect(() => emitHistoryMonitoring({ event: 'worker_attempt', outcome: 'failed' })).not.toThrow();
    emitHistoryMonitoring({ event: 'private' } as any);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
