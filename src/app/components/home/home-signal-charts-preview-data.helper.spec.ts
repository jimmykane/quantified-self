import { describe, expect, it } from 'vitest';
import { buildHomeSignalChartsPreviewData } from './home-signal-charts-preview-data.helper';

describe('buildHomeSignalChartsPreviewData', () => {
  it('builds complete contexts for the production chart components', () => {
    const data = buildHomeSignalChartsPreviewData(Date.UTC(2026, 7, 31, 18, 42));

    expect(data.freshnessForecast.points).toHaveLength(14);
    expect(data.intensityDistribution.weeks).toHaveLength(8);
    expect(data.efficiencyTrend.points).toHaveLength(8);
    expect(data.powerCurve.series).toHaveLength(2);
    expect(data.powerCurve.summaryPoints.map(point => point.duration)).toEqual([60, 300, 1200]);
    expect(data.formTimeline).toHaveLength(16 * 7);
    expect(data.latestFormPoint?.trainingStressScore).toBeGreaterThan(0);
  });

  it('anchors weekly series to Monday regardless of the current weekday', () => {
    const data = buildHomeSignalChartsPreviewData(Date.UTC(2026, 8, 3, 12));
    const intensityWeekMs = data.intensityDistribution.latestWeekStartMs;
    const efficiencyWeekMs = data.efficiencyTrend.latestWeekStartMs;

    expect(intensityWeekMs).toBe(Date.UTC(2026, 7, 31));
    expect(efficiencyWeekMs).toBe(intensityWeekMs);
    expect(new Date(intensityWeekMs!).getUTCDay()).toBe(1);
  });

  it('keeps best power above the latest activity across the full curve', () => {
    const data = buildHomeSignalChartsPreviewData(Date.UTC(2026, 7, 31));
    const bestPoints = data.powerCurve.series[0].points;
    const latestPoints = data.powerCurve.series[1].points;

    expect(bestPoints.map(point => point.duration)).toEqual(latestPoints.map(point => point.duration));
    expect(bestPoints.every((point, index) => point.power > latestPoints[index].power)).toBe(true);
    expect(bestPoints.every((point, index) => index === 0 || point.power < bestPoints[index - 1].power)).toBe(true);
  });
});
