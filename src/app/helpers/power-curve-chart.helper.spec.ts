import { describe, expect, it } from 'vitest';
import { buildPowerCurveVisibleDurationLabelSet } from './power-curve-chart.helper';

describe('buildPowerCurveVisibleDurationLabelSet', () => {
  it('keeps all labels for non-mobile viewports', () => {
    const durations = [1, 5, 15, 30, 60, 300, 1200, 3600];

    const result = buildPowerCurveVisibleDurationLabelSet(durations, {
      isMobile: false,
      chartWidth: 360,
    });

    expect([...result.values()]).toEqual(durations);
  });

  it('uses duration anchors for mobile non-linear power-curve domains', () => {
    const durations = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      15, 20, 30, 45, 60, 90, 120, 180, 300, 450,
      600, 900, 1200, 1800, 2400, 3600,
    ];

    const result = buildPowerCurveVisibleDurationLabelSet(durations, {
      isMobile: true,
      chartWidth: 360,
    });

    expect([...result.values()]).toEqual([1, 5, 15, 30, 60, 300, 1200, 3600]);
  });
});
