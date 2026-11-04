import { describe, expect, it } from 'vitest';
import {
  HOME_SIGNAL_CHARTS_PREVIEW_ANCHOR_MS,
  buildHomeSignalChartsPreviewData,
  buildHomeHeroPreviewData,
  buildHomeHeroSummaryMetrics,
} from './home-signal-charts-preview-data.helper';

describe('buildHomeSignalChartsPreviewData', () => {
  it('uses a stable Monday anchor for prerendered homepage data', () => {
    expect(HOME_SIGNAL_CHARTS_PREVIEW_ANCHOR_MS).toBe(Date.UTC(2026, 7, 31));
    expect(new Date(HOME_SIGNAL_CHARTS_PREVIEW_ANCHOR_MS).getUTCDay()).toBe(1);
  });

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

describe('home hero summary examples', () => {
  it('shows established fitness, build/recovery weeks and rest days in a repeatable current window', () => {
    const anchor = Date.UTC(2026, 10, 4, 18, 30);
    const data = buildHomeHeroPreviewData(anchor);
    expect(data).toEqual(buildHomeHeroPreviewData(anchor));
    expect(data.latestFormPoint?.time).toBe(Date.UTC(2026, 10, 4));
    const visible = data.formTimeline.slice(-84);
    expect(visible[0].ctl).toBeGreaterThan(40);
    expect(visible.some(point => point.trainingStressScore === 0 && point.activityCount === 0)).toBe(true);
    expect(Math.min(...visible.map(point => point.formSameDay))).toBeLessThan(-15);
    expect(Math.max(...visible.map(point => point.formSameDay))).toBeGreaterThan(10);
    expect(visible.every(point => point.formSameDay === point.ctl - point.atl)).toBe(true);
    expect(data.formTimeline.slice(-7).reduce((sum, point) => sum + point.activityCount, 0)).toBe(6);
  });

  it('keeps training volume separate from the imported recovery estimate', () => {
    const cards = buildHomeHeroSummaryMetrics();
    expect(cards.map(card => [card.label, card.valueText, card.detailText])).toEqual([
      ['Training volume', '08h 20m', 'Last 7 days'],
      ['Recovery left', '14h 30m', 'Example post-workout estimate'],
    ]);
  });
});
