import { describe, expect, it } from 'vitest';
import { normalizeDeliveryTimeZone, parseTrainingDeliveryCommandV1, trainingDeliveryLocalDate,
  parseTrainingDeliveryStatusV1 } from '../../../../shared/training-provider-delivery';

const command = { schemaVersion: 1, mutationId: 'test-1', scope: 'workout', scopeId: 'workout-1',
  provider: 'garmin', action: 'send', expectedScheduleRevision: 1, expectedScopeRevision: 1,
  expectedSettingsRevision: 0, timeZone: 'Europe/Helsinki' };

describe('Training delivery contracts', () => {
  it('round trips exact JSON without touching the workout recipe', () => {
    expect(parseTrainingDeliveryCommandV1(JSON.parse(JSON.stringify(command)))).toEqual(command);
  });
  it.each([{ uid: 'other' }, { remoteId: 'secret' }, { schemaVersion: 2 }, { provider: 'fake' },
    { scopeId: '../other' }, { expectedSettingsRevision: NaN }, { expectedScopeRevision: -1 },
    { action: 'approve' }, { timeZone: 'invalid-zone' }, { scope: 'plan' }, { token: 'secret' }])('rejects %j', patch => {
    expect(() => parseTrainingDeliveryCommandV1({ ...command, ...patch })).toThrow();
  });
  it('uses the saved zone across year and DST boundaries', () => {
    expect(trainingDeliveryLocalDate(Date.parse('2026-12-31T23:30:00Z'), 'Europe/Helsinki')).toBe('2027-01-01');
    expect(trainingDeliveryLocalDate(Date.parse('2026-12-31T23:30:00Z'), 'America/Los_Angeles')).toBe('2026-12-31');
    expect(trainingDeliveryLocalDate(Date.parse('2026-03-29T01:30:00Z'), 'Europe/Helsinki')).toBe('2026-03-29');
    expect(normalizeDeliveryTimeZone('UTC')).toBe('UTC');
  });
  it('rejects credential and internal fields in browser projections', () => {
    const status = { schemaVersion: 1, id: 'id', workoutId: 'w', planId: null, provider: 'garmin', status: 'pending',
      differsFromQS: false, hasRemoteCopy: false, timeZone: 'UTC', approvalDigest: null, issues: [], updatedAtMs: 1,
      lastAttemptAtMs: null, lastAcceptedAtMs: null, retryCount: 0, nextRetryAtMs: null };
    expect(parseTrainingDeliveryStatusV1(status)).toEqual(status);
    expect(() => parseTrainingDeliveryStatusV1({ ...status, actual: { token: 'secret' } })).toThrow();
    expect(() => parseTrainingDeliveryStatusV1({ ...status, nextRetryAtMs: Infinity })).toThrow();
    expect(() => normalizeDeliveryTimeZone('+03:00')).toThrow();
  });
});
