import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { observeDeliveryCheckpoint } from './diagnostics';
import type { DeliveryTransportProgress } from './contracts';

describe('Training checkpoint diagnostics', () => {
  beforeEach(() => vi.mocked(logger.warn).mockClear());
  it.each([['ready', false], ['started', false], ['accepted', false], ['accepted', true]] as const)(
    'reports %s persistence failure (complete=%s) without altering the original error', async (state, complete) => {
      const failure = Object.assign(new Error('private-workout-and-token'), { code: 14, details: 'private-provider-body' });
      await expect(observeDeliveryCheckpoint('garmin', complete, { version: 1, step: 'private-id', state }, async () => { throw failure; }))
        .rejects.toBe(failure);
      expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', { event: 'checkpoint_failed', provider: 'garmin',
        complete, checkpointState: state, persistenceCode: 'unavailable' });
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
    });
  it('drops unrecognized error codes and progress text', async () => {
    await expect(observeDeliveryCheckpoint('suunto', false, { state: 'private-state' } as unknown as DeliveryTransportProgress,
      async () => { throw { code: 'private-code', message: 'private-error' }; })).rejects.toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({ checkpointState: 'artifact', persistenceCode: 'unknown' }));
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
  });
  it('passes through successful or superseded transactions without a false persistence failure', async () => {
    for (const value of [true, false]) expect(await observeDeliveryCheckpoint('garmin', false, null, async () => value)).toBe(value);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
