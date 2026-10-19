import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { cleanupAge, cleanupHeartbeat, cleanupObservation, cleanupPage, cleanupProvider, observeAccountCleanup, observeCleanupSchedule, observeRemoteCleanup } from './cleanup-monitoring';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));
describe('cleanup monitoring is non-authorizing and private-data-free', () => {
  beforeEach(() => vi.mocked(logger.info).mockReset());
  afterEach(() => vi.mocked(logger.info).mockReset());
  it('maps only the four fixed providers', () => {
    expect(['Garmin API', 'Suunto app', 'COROS API', 'Wahoo API', 'PRIVATE'].map(cleanupProvider))
      .toEqual(['GarminAPI', 'SuuntoApp', 'COROSAPI', 'WahooAPI', 'all']);
    expect(['garminAPI', 'suuntoApp', 'corosAPI', 'wahooAPI'].map(cleanupProvider))
      .toEqual(['GarminAPI', 'SuuntoApp', 'COROSAPI', 'WahooAPI']);
  });
  it('validates timestamp ages without treating missing, future or malformed state as zero', () => {
    for (const value of [null, undefined, {}, NaN, -1, 0, 200]) expect(cleanupAge(value, 100)).toBeUndefined();
    expect(cleanupAge(50, 100)).toBe(50);
    expect(cleanupAge({ toMillis: () => 25 }, 100)).toBe(75);
    expect(cleanupAge({ toMillis: () => { throw Error('private'); } }, 100)).toBeUndefined();
  });
  it('separates account handler ACK from full deletion, preserves errors and emits no event identity', async () => {
    const result = { sentinel: 'PRIVATE_DATA' };
    expect(await observeAccountCleanup('2026-01-01T00:00:00Z', async () => result)).toBe(result);
    const failure = Error('PRIVATE_DATA');
    await expect(observeAccountCleanup(undefined, async () => { throw failure; })).rejects.toBe(failure);
    const fields = vi.mocked(logger.info).mock.calls.map(call => call[1]);
    expect(fields.map(f => f?.outcome)).toEqual(['started', 'acknowledged', 'started', 'failed']);
    expect(JSON.stringify(fields)).not.toContain('PRIVATE_DATA');
    expect(fields.every(f => Object.keys(f as object).every(key => ['telemetryVersion', 'event', 'flow', 'provider', 'outcome', 'lane', 'ageMs'].includes(key)))).toBe(true);
  });
  it('does not call revoked/failed remote deauthorization successful remote deletion', () => {
    observeRemoteCleanup('Garmin API', { partnerDeauthorizeFailed: 1, localCleanupStatus: 'completed' }, 'disconnect');
    expect(vi.mocked(logger.info).mock.calls.map(call => call[1]?.outcome)).toEqual(['remote_unconfirmed', 'completed']);
    observeRemoteCleanup('Garmin API', { skippedByCondition: true, partnerDeauthorizeFailed: 0, localCleanupStatus: 'completed' }, 'disconnect');
    expect(logger.info).toHaveBeenCalledTimes(2);
  });
  it('keeps terminal access loss before deauthorization unconfirmed; explicit token ACK is not finalization', () => {
    observeRemoteCleanup('Wahoo API', { tokenCount: 1, partnerDeauthorizeAttempted: 0,
      partnerDeauthorizeFailed: 0, localCleanupStatus: 'completed' }, 'disconnect', 'explicit');
    expect(vi.mocked(logger.info).mock.calls.map(call => call[1]?.outcome)).toEqual(['remote_unconfirmed', 'acknowledged']);
  });
  it('does not convert an unrecognized local outcome into completed cleanup', () => {
    observeRemoteCleanup('Wahoo API', { partnerDeauthorizeFailed: 0, localCleanupStatus: 'PRIVATE_UNKNOWN' }, 'disconnect');
    expect(logger.info).not.toHaveBeenCalled();
  });
  it('does not page normal pending token use or call retained credentials completed cleanup', () => {
    observeRemoteCleanup('Suunto app', { partnerDeauthorizeFailed: 0, localCleanupStatus: 'completed',
      preservedTokenCount: 1, tokenCount: 1, partnerDeauthorizeAttempted: 0 }, 'disconnect', 'subscription');
    expect(vi.mocked(logger.info).mock.calls.map(call => call[1]?.outcome)).toEqual(['deferred']);
  });
  it('logger failure cannot change returns, original exception, or recovery', async () => {
    vi.mocked(logger.info).mockImplementation(() => { throw Error('logger failed'); });
    expect(() => cleanupHeartbeat('failed')).not.toThrow();
    expect(() => cleanupObservation('operational', 'all', 'retry', 'operational', Infinity)).not.toThrow();
    expect(await observeAccountCleanup(undefined, async () => 42)).toBe(42);
    const original = Error('original');
    await expect(observeAccountCleanup(undefined, async () => { throw original; })).rejects.toBe(original);
  });
  it('emits idle/capped page coverage without claiming remaining backlog, and preserves scheduler failures', async () => {
    cleanupPage('explicit', 'SuuntoApp', 0, 1);
    cleanupPage('operational', 'all', 10, 10);
    const failed = Error('PRIVATE_FAILURE');
    await observeCleanupSchedule(async () => undefined);
    await expect(observeCleanupSchedule(async () => { throw failed; })).rejects.toBe(failed);
    expect(vi.mocked(logger.info).mock.calls.map(call => call[1])).toEqual([
      expect.objectContaining({ event: 'page', examined: 0, capped: false }),
      expect.objectContaining({ event: 'page', examined: 10, capped: true }),
      expect.objectContaining({ event: 'heartbeat', outcome: 'acknowledged' }),
      expect.objectContaining({ event: 'heartbeat', outcome: 'failed' }),
    ]);
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE_FAILURE');
  });
});
