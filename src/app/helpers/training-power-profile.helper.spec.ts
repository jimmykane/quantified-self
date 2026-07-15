import { describe, expect, it } from 'vitest';
import type { DashboardPowerCurveContext } from './dashboard-power-curve.helper';
import { buildTrainingPowerProfileViewModel } from './training-power-profile.helper';

function context(points: Array<{ duration: number; power: number }>, matchedEventCount: number): DashboardPowerCurveContext {
  return {
    matchedEventCount, sourceEventCount: matchedEventCount, latestEventId: null, latestEventStartMs: null,
    latestSeriesLabel: 'Latest', compareMode: 'latest', comparisonSeriesLabel: 'Latest', comparisonEventCount: 1,
    series: [{ seriesKey: 'best', label: 'Best', colorKey: 'best', points }], summaryPoints: [],
  };
}

describe('buildTrainingPowerProfileViewModel', () => {
  it('uses bounded sports-lib interpolation and reports 90-day retention versus one year', () => {
    const view = buildTrainingPowerProfileViewModel(
      context([{ duration: 5, power: 500 }, { duration: 60, power: 300 }, { duration: 240, power: 270 }, { duration: 300, power: 260 }, { duration: 1200, power: 240 }, { duration: 3600, power: 200 }], 8),
      context([{ duration: 5, power: 480 }, { duration: 60, power: 310 }, { duration: 240, power: 280 }, { duration: 300, power: 270 }, { duration: 1200, power: 250 }, { duration: 3600, power: 210 }], 20),
    );
    expect(view.activityCountText).toBe('8 activities in 90 days · 20 activities in 1 year');
    expect(view.strongestText).toContain('5s is strongest retained');
    expect(view.clearestGapText).toContain('clearest gap');
    expect(view.anchors).toEqual(expect.arrayContaining([
      expect.objectContaining({ durationLabel: '5s', retentionText: '104.2%', deltaTone: 'positive' }),
      expect.objectContaining({ durationLabel: '20m', retentionText: '96%', deltaTone: 'negative' }),
    ]));
  });

  it('does not bridge brackets wider than the 1.25 duration ratio', () => {
    const view = buildTrainingPowerProfileViewModel(
      context([{ duration: 240, power: 300 }, { duration: 360, power: 280 }], 2),
      context([{ duration: 240, power: 310 }, { duration: 360, power: 290 }], 4),
    );
    expect(view.anchors).toEqual([]);
    expect(view.strongestText).toBeNull();
    expect(view.activityCountText).toContain('2 activities in 90 days');
  });
});
