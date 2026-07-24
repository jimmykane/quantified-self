import { describe, expect, it } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
  DataThreeDimensionalStrainEvidence,
  type ActivityInterface,
  type ThreeDimensionalStrainEvidenceValue,
} from '@sports-alliance/sports-lib';
import {
  buildPowerSystemStrainWorkoutViewModels,
  hasPowerSystemStrainEvidence,
} from './power-system-strain.helper';

function evidence(
  overrides: Partial<ThreeDimensionalStrainEvidenceValue> = {},
): ThreeDimensionalStrainEvidenceValue {
  return {
    protocolVersion: 2,
    sourceFingerprint: 'three-dimensional-strain-v2:0000000000000001',
    activityType: ActivityTypes.Rowing,
    activityGroup: ActivityTypeGroups.WaterSportsGroup,
    eligibility: { eligible: true, reason: 'eligible' },
    input: {
      powerSampleCount: 3_600,
      validPowerSampleCount: 3_600,
      candidateDurationSeconds: 3_600,
      recordedDurationSeconds: 3_600,
      coverageRatio: 1,
      curvePointCount: 9,
      hasShortDuration: true,
      hasMediumDuration: true,
      hasLongDuration: true,
    },
    fit: {
      criticalPowerWatts: 250,
      wPrimeJoules: 20_000,
      maximumPowerWatts: 1_050,
      sampleCount: 9,
      rmseWatts: 4,
      normalizedRmse: 0.02,
      rSquared: 0.98,
      iterations: 24,
      converged: true,
    },
    evidence: {
      total: 12,
      criticalPower: 7,
      wPrime: 3,
      maximumPower: 2,
      endingWPrimeBalanceJoules: 15_000,
      minimumWPrimeBalanceJoules: 12_000,
    },
    ...overrides,
  } as ThreeDimensionalStrainEvidenceValue;
}

function activity(
  value: ThreeDimensionalStrainEvidenceValue | null,
  id = 'a1',
): ActivityInterface {
  return {
    type: ActivityTypes.Rowing,
    getID: () => id,
    getStat: (type: string) => type === DataThreeDimensionalStrainEvidence.type && value
      ? { getValue: () => value }
      : null,
  } as unknown as ActivityInterface;
}

describe('power-system-strain.helper', () => {
  it('builds a ready view for a supported non-running/cycling workout', () => {
    const result = buildPowerSystemStrainWorkoutViewModels([activity(evidence())]);

    expect(result).toEqual([expect.objectContaining({
      activityId: 'a1',
      activityType: ActivityTypes.Rowing,
      status: 'ready',
      statusText: 'Ready',
      inputText: '3,600/3,600 recorded power samples (100%) · 9 curve points',
      score: [
        { label: 'Total strain', value: '12' },
        { label: 'Sustained power', value: '7' },
        { label: 'Finite capacity', value: '3' },
        { label: 'Maximum power', value: '2' },
      ],
      fit: {
        criticalPower: '250 W',
        wPrime: '20 kJ',
        maximumPower: '1,050 W',
        normalizedRmse: '2% normalized error',
      },
    })]);
    expect(hasPowerSystemStrainEvidence([activity(evidence())])).toBe(true);
  });

  it('keeps ineligible v2 evidence visible without inventing a zero score', () => {
    const unavailable = evidence({
      eligibility: { eligible: false, reason: 'insufficient-coverage' },
      input: {
        ...evidence().input,
        validPowerSampleCount: 2_000,
        recordedDurationSeconds: 2_000,
        coverageRatio: 2_000 / 3_600,
      },
      fit: null,
      evidence: null,
    });

    const [result] = buildPowerSystemStrainWorkoutViewModels([activity(unavailable)]);

    expect(result).toMatchObject({
      status: 'unavailable',
      score: null,
      detailText: 'Recorded power coverage was too incomplete for a reliable score.',
    });
  });

  it.each([
    'missing-power',
    'insufficient-coverage',
    'insufficient-curve-points',
    'insufficient-duration-range',
    'fit-failed',
    'poor-fit',
    'power-exceeds-maximum',
  ] as const)('keeps %s as an explicit unavailable result', (reason) => {
    const requiresFit = reason === 'poor-fit' || reason === 'power-exceeds-maximum';
    const unavailable = evidence({
      eligibility: { eligible: false, reason },
      fit: requiresFit ? evidence().fit : null,
      evidence: null,
    });

    const [result] = buildPowerSystemStrainWorkoutViewModels([activity(unavailable)]);

    expect(result.status).toBe('unavailable');
    expect(result.score).toBeNull();
    expect(result.detailText).not.toContain('0');
  });

  it('marks v1 evidence as legacy and does not expose it as a score', () => {
    const legacy = {
      ...evidence(),
      protocolVersion: 1 as const,
      sourceFingerprint: 'three-dimensional-strain-v1:0000000000000001',
      discipline: 'cycling' as const,
    } as unknown as ThreeDimensionalStrainEvidenceValue;
    delete (legacy as Record<string, unknown>).activityType;
    delete (legacy as Record<string, unknown>).activityGroup;

    const [result] = buildPowerSystemStrainWorkoutViewModels([activity(legacy)]);

    expect(result).toMatchObject({
      status: 'legacy',
      statusText: 'Previous protocol',
      score: null,
      fit: null,
    });
  });

  it('ignores activities without persisted evidence and preserves selected-workout order', () => {
    const results = buildPowerSystemStrainWorkoutViewModels([
      activity(null, 'missing'),
      activity(evidence(), 'first'),
      activity(evidence({ activityType: ActivityTypes.Sailing }), 'second'),
    ]);

    expect(results.map(result => result.activityId)).toEqual(['first', 'second']);
    expect(hasPowerSystemStrainEvidence([activity(null)])).toBe(false);
  });

  it('drops malformed persisted values rather than rendering untrusted data', () => {
    const malformed = {
      type: ActivityTypes.Rowing,
      getID: () => 'malformed',
      getStat: () => ({ getValue: () => ({ protocolVersion: 2, evidence: { total: Infinity } }) }),
    } as unknown as ActivityInterface;

    expect(buildPowerSystemStrainWorkoutViewModels([malformed])).toEqual([]);
    expect(hasPowerSystemStrainEvidence([malformed])).toBe(false);
  });
});
