import { describe, expect, it } from 'vitest';
import { buildTrainingRecoveryEstimateViewModel } from './training-recovery-estimate.helper';

describe('buildTrainingRecoveryEstimateViewModel', () => {
  it('shows the live remaining estimate and preserves an updating signal', () => {
    expect(buildTrainingRecoveryEstimateViewModel({
      totalSeconds: 7_200,
      endTimeMs: Date.UTC(2026, 6, 14, 8),
    }, 'stale', Date.UTC(2026, 6, 14, 9))).toEqual({
      valueText: '1h 00m',
      detailText: 'Imported post-workout estimate; it is not readiness and does not change your Training state',
      isUpdating: true,
    });
  });

  it('omits an elapsed estimate and missing evidence', () => {
    expect(buildTrainingRecoveryEstimateViewModel({
      totalSeconds: 3_600,
      endTimeMs: Date.UTC(2026, 6, 14, 8),
    }, 'ready', Date.UTC(2026, 6, 14, 10))).toBeNull();

    expect(buildTrainingRecoveryEstimateViewModel(null, 'ready')).toBeNull();
  });

  it('omits loading and failed snapshots without a current estimate', () => {
    expect(buildTrainingRecoveryEstimateViewModel(null, 'building')).toBeNull();
    expect(buildTrainingRecoveryEstimateViewModel(null, 'failed')).toBeNull();
  });
});
