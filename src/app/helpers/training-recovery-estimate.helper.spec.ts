import { describe, expect, it } from 'vitest';
import { buildTrainingRecoveryEstimateViewModel } from './training-recovery-estimate.helper';

describe('buildTrainingRecoveryEstimateViewModel', () => {
  it('shows the live remaining estimate and preserves an updating signal', () => {
    const finishTimeMs = Date.UTC(2026, 6, 14, 10);
    const finishDate = new Date(finishTimeMs);
    const finishText = `${finishDate.toLocaleDateString('en-US', {
      weekday: 'short', day: 'numeric', month: 'short',
    })} at ${finishDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    expect(buildTrainingRecoveryEstimateViewModel({
      totalSeconds: 7_200,
      endTimeMs: Date.UTC(2026, 6, 14, 8),
    }, 'stale', Date.UTC(2026, 6, 14, 9), { locale: 'en-US' })).toEqual({
      valueText: '01h 00m',
      finishTimeMs,
      finishText,
      detailText: 'Imported post-workout estimate. It is separate from Readiness and Freshness.',
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
