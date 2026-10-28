import { describe, expect, it } from 'vitest';
import { parseTrainingVerificationV1, type TrainingVerificationV1 } from '../../../../shared/training-provider-verification';
import { parseTrainingDeliveryCommandV1, parseTrainingDeliveryStatusV1 } from '../../../../shared/training-provider-delivery';
import { canExecuteDeliveryRepair, canRepairMissingArtifacts } from './verification-contracts';
import { GARMIN_INSPECTION_POLICY } from './garmin/inspection';
describe('safe verification projection and command', () => {
  const row: TrainingVerificationV1 = { schemaVersion: 1, id: 'a'.repeat(64), workoutId: 'w', planId: null,
    provider: 'garmin', state: 'present', canCheck: true, missing: false, lastCheckedAtMs: 1, nextCheckAtMs: 2, updatedAtMs: 1 };
  it('round trips exact JSON without widening the existing status v1 parser', () => {
    expect(parseTrainingVerificationV1(JSON.parse(JSON.stringify(row)))).toEqual(row);
    expect(() => parseTrainingDeliveryStatusV1(row)).toThrow();
  });
  it('keeps manual replacement distinct from automatic repair authority', () => {
    const repair = { policyVersion: GARMIN_INSPECTION_POLICY.version, binding: 'private', missing: ['workout', 'schedule'],
      original: { ids: { workout: '1', schedule: '2', owner: '3' }, localDate: '2026-10-04', completed: false } };
    expect(canRepairMissingArtifacts(GARMIN_INSPECTION_POLICY, repair.missing)).toBe(false);
    expect(canExecuteDeliveryRepair(GARMIN_INSPECTION_POLICY, repair)).toBe(false);
    expect(canExecuteDeliveryRepair(GARMIN_INSPECTION_POLICY, { ...repair, manualReplacement: true })).toBe(true);
    for (const patch of [{ policyVersion: 'other' }, { missing: ['workout'] }, { missing: ['schedule'] }, { missing: ['workout', 'workout'] }, { missing: ['workout', 'foreign'] }]) {
      expect(canExecuteDeliveryRepair(GARMIN_INSPECTION_POLICY, { ...repair, manualReplacement: true, ...patch })).toBe(false);
    }
    expect(canExecuteDeliveryRepair({ ...GARMIN_INSPECTION_POLICY, mode: 'unavailable' }, { ...repair, manualReplacement: true })).toBe(false);
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
