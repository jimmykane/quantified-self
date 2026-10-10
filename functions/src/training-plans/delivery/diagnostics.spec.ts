import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { deliveryDiagnosticLabels, deliveryDiagnosticMapping, observeDeliveryCheckpoint } from './diagnostics';
import type { DeliveryDiagnosticPhase } from './diagnostics';
import type { DeliveryOperation, DeliveryTransportProgress, TrainingDeliveryTransport } from './contracts';

describe('Private Suunto mapping diagnostics', () => {
  const operation = { kind: 'upsert', digest: 'private-digest', workout: { title: 'private-workout' } } as DeliveryOperation;
  const transport = (value: string | null) => ({ diagnosticMappingVersion: vi.fn(() => value) }) as unknown as TrainingDeliveryTransport;
  it.each(['suunto-guides-v2', 'suunto-guides-v3', 'suunto-guides-v4', 'suunto-guides-v5', 'suunto-guides-v6', 'suunto-guides-v7', 'suunto-guides-v8', 'suunto-guides-v9', 'suunto-guides-v10', 'suunto-guides-v11', 'suunto-guides-v12', 'suunto-guides-v13'] as const)('uses the verified operation version %s', version => {
    const adapter = transport(version);
    const mapping = deliveryDiagnosticMapping('suunto', adapter, operation);
    expect(deliveryDiagnosticLabels(mapping, 'recover')).toEqual({ guideMappingVersion: version, deliveryPhase: 'recover' });
    expect(adapter.diagnosticMappingVersion).toHaveBeenCalledExactlyOnceWith(operation);
  });
  it.each(['private-workout-token', null])('drops unrecognized classification %s', value => {
    expect(deliveryDiagnosticLabels(deliveryDiagnosticMapping('suunto', transport(value), operation), 'execute'))
      .toEqual({ guideMappingVersion: 'unknown', deliveryPhase: 'execute' });
  });
  it('does not disrupt delivery when classification throws or is absent', () => {
    const adapter = transport(null);
    vi.mocked(adapter.diagnosticMappingVersion!).mockImplementation(() => { throw new Error('private-workout-token'); });
    expect(deliveryDiagnosticMapping('suunto', adapter, operation)).toBe('unknown');
    expect(deliveryDiagnosticMapping('suunto', {} as TrainingDeliveryTransport, operation)).toBe('unknown');
  });
  it('does not guess a recipe version for removal', () => {
    const adapter = transport('private');
    expect(deliveryDiagnosticMapping('suunto', adapter, { ...operation, kind: 'remove' })).toBe('not_applicable');
    expect(adapter.diagnosticMappingVersion).not.toHaveBeenCalled();
  });
  it.each(['garmin', 'wahoo', 'coros'] as const)('leaves %s diagnostics unchanged', provider => {
    const adapter = transport('suunto-guides-v3');
    expect(deliveryDiagnosticLabels(deliveryDiagnosticMapping(provider, adapter, operation), 'execute')).toEqual({});
    expect(adapter.diagnosticMappingVersion).not.toHaveBeenCalled();
  });
  it('allowlists malformed runtime values again at the log boundary', () => {
    expect(deliveryDiagnosticLabels('private-token' as 'unknown', 'private-phase' as DeliveryDiagnosticPhase))
      .toEqual({ guideMappingVersion: 'unknown', deliveryPhase: 'unknown' });
  });
});

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
  it('includes bounded mapping/phase labels on persistence failure and rethrows the same error', async () => {
    const failure = new Error('private-token-workout');
    await expect(observeDeliveryCheckpoint('suunto', true, { version: 1, step: 'private-id', state: 'accepted' },
      async () => { throw failure; }, { mapping: 'suunto-guides-v2', phase: 'recover' })).rejects.toBe(failure);
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', { event: 'checkpoint_failed', provider: 'suunto',
      complete: true, checkpointState: 'accepted', persistenceCode: 'unknown', guideMappingVersion: 'suunto-guides-v2', deliveryPhase: 'recover' });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('private');
  });
});
