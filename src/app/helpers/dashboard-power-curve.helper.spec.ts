import { describe, expect, it } from 'vitest';
import type { DerivedPowerCurveMetricPayload, DerivedPowerCurveRangeSnapshot } from '@shared/derived-metrics';
import {
  buildDashboardPowerCurveContextFromSnapshot,
  resolveDashboardPowerCurveMetricPayload,
} from './dashboard-power-curve.helper';

const emptyRange = (): DerivedPowerCurveRangeSnapshot => ({
  sourceEventCount: 0,
  matchedEventCount: 0,
  latestActivity: null,
  bestPoints: [],
  best30dPoints: [],
  best30dEventCount: 0,
  best90dPoints: [],
  best90dEventCount: 0,
});

function createPayload(): DerivedPowerCurveMetricPayload {
  const activeRange: DerivedPowerCurveRangeSnapshot = {
    sourceEventCount: 3,
    matchedEventCount: 2,
    latestActivity: {
      eventId: 'latest',
      startMs: Date.UTC(2026, 0, 30, 10, 0, 0),
      points: [60, 400, 5.1, 300, 330, 4.2],
    },
    bestPoints: [60, 520, 0, 300, 430, 0],
    best30dPoints: [60, 410, 0, 300, 360, 0],
    best30dEventCount: 2,
    best90dPoints: [60, 450, 0, 300, 390, 0],
    best90dEventCount: 2,
  };
  const ranges = {
    thisMonth: activeRange,
    '14d': activeRange,
    '30d': activeRange,
    '90d': activeRange,
    '1y': activeRange,
    '2y': activeRange,
    '3y': activeRange,
    '4y': activeRange,
    all: activeRange,
  };
  const scope = { ranges, thisWeekByStartDay: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [`${day}`, activeRange])) };
  return {
    asOfDayMs: Date.UTC(2026, 0, 31),
    excludesMergedEvents: true,
    pointSamplingVersion: 1,
    scopes: { cycling: scope, running: scope },
  };
}

describe('dashboard-power-curve.helper', () => {
  it('builds the chart context directly from the prepared snapshot', () => {
    const context = buildDashboardPowerCurveContextFromSnapshot(createPayload(), {
      scope: 'cycling',
      range: 'all',
      latestSeriesLabel: 'Latest cycling activity',
    });

    expect(context).toMatchObject({
      matchedEventCount: 2,
      sourceEventCount: 3,
      latestEventId: 'latest',
      latestSeriesLabel: 'Latest cycling activity',
      compareMode: 'latest',
      comparisonEventCount: 1,
    });
    expect(context?.series.map(series => series.seriesKey)).toEqual(['best', 'latest']);
    expect(context?.summaryPoints).toEqual([{ duration: 60, power: 520 }, { duration: 300, power: 430 }]);
  });

  it('selects the prepared recent-best comparison without inspecting events', () => {
    const context = buildDashboardPowerCurveContextFromSnapshot(createPayload(), {
      scope: 'running',
      range: '30d',
      compareMode: 'best30d',
      latestSeriesLabel: 'Latest running activity',
    });

    expect(context?.comparisonSeriesLabel).toBe('Best last 30d');
    expect(context?.comparisonEventCount).toBe(2);
    expect(context?.series[1]?.points).toEqual([{ duration: 60, power: 410 }, { duration: 300, power: 360 }]);
  });

  it('selects the user week-start variant from the snapshot', () => {
    const payload = createPayload();
    payload.scopes.cycling.thisWeekByStartDay['1'] = emptyRange();

    const context = buildDashboardPowerCurveContextFromSnapshot(payload, {
      scope: 'cycling',
      range: 'thisWeek',
      startOfWeek: 1,
    });

    expect(context?.matchedEventCount).toBe(0);
    expect(context?.series).toEqual([]);
  });

  it('rejects malformed snapshot payloads instead of treating them as chart data', () => {
    expect(resolveDashboardPowerCurveMetricPayload({ scopes: {} })).toBeNull();
    expect(resolveDashboardPowerCurveMetricPayload({
      ...createPayload(),
      pointSamplingVersion: 2,
    })).toBeNull();
  });
});
