import { describe, expect, it } from 'vitest';
import { parseTrainingVerificationV1, type TrainingVerificationV1 } from '../../../../shared/training-provider-verification';
import { parseTrainingDeliveryCommandV1, parseTrainingDeliveryStatusV1 } from '../../../../shared/training-provider-delivery';
describe('safe verification projection and command', () => {
  const row: TrainingVerificationV1 = { schemaVersion: 1, id: 'a'.repeat(64), workoutId: 'w', planId: null,
    provider: 'garmin', state: 'present', canCheck: true, missing: false, lastCheckedAtMs: 1, nextCheckAtMs: 2, updatedAtMs: 1 };
  it('round trips exact JSON without widening the existing status v1 parser', () => {
    expect(parseTrainingVerificationV1(JSON.parse(JSON.stringify(row)))).toEqual(row);
    expect(() => parseTrainingDeliveryStatusV1(row)).toThrow();
  });
  it.each([{ ...row, remoteId: 'secret' }, { ...row, lastCheckedAtMs: NaN }, { ...row, schemaVersion: 2 },
    { ...row, provider: 'fake' }, { ...row, state: 'made-up' }, { ...row, canCheck: undefined }])('rejects unsafe projections', value => {
    expect(() => parseTrainingVerificationV1(value)).toThrow();
  });
  it('accepts check without consent changes and refuses client remote authority or time zone changes', () => {
    const request = { schemaVersion: 1, mutationId: 'm', scope: 'workout', scopeId: 'w', provider: 'garmin', action: 'check',
      expectedScheduleRevision: 1, expectedScopeRevision: 1, expectedSettingsRevision: 1 };
    expect(parseTrainingDeliveryCommandV1(request)).toEqual(request);
    for (const extra of [{ timeZone: 'UTC' }, { remoteId: 'remote' }, { connectionGeneration: 'spoof' }, { approvalDigest: 'a'.repeat(64) }]) {
      expect(() => parseTrainingDeliveryCommandV1({ ...request, ...extra })).toThrow();
    }
  });
});
