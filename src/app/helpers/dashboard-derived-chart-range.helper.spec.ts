import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_DERIVED_CHART_DEFAULT_RANGE,
  DASHBOARD_DERIVED_CHART_RANGE_OPTIONS,
  dashboardDerivedChartRangeWeeks,
  filterDashboardDerivedWeeklyRange,
  normalizeDashboardDerivedChartRange,
} from './dashboard-derived-chart-range.helper';

describe('dashboard-derived-chart-range.helper', () => {
  it('normalizes unknown ranges to the default derived chart range', () => {
    expect(normalizeDashboardDerivedChartRange('8w')).toBe('8w');
    expect(normalizeDashboardDerivedChartRange('all')).toBe('all');
    expect(normalizeDashboardDerivedChartRange('legacy')).toBe(DASHBOARD_DERIVED_CHART_DEFAULT_RANGE);
  });

  it('resolves compact weekly range lengths', () => {
    expect(dashboardDerivedChartRangeWeeks('8w')).toBe(8);
    expect(dashboardDerivedChartRangeWeeks('12w')).toBe(12);
    expect(dashboardDerivedChartRangeWeeks('6m')).toBe(26);
    expect(dashboardDerivedChartRangeWeeks('1y')).toBe(52);
    expect(dashboardDerivedChartRangeWeeks('all')).toBeNull();
  });

  it('keeps compact button labels separate from full menu labels', () => {
    expect(DASHBOARD_DERIVED_CHART_RANGE_OPTIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ range: '8w', label: '8w', shortLabel: '8w', menuLabel: '8 weeks' }),
      expect.objectContaining({ range: '1y', label: '1y', shortLabel: '1y', menuLabel: '1 year' }),
    ]));
  });

  it('filters weekly points to the latest selected range', () => {
    const baseWeekMs = Date.UTC(2026, 0, 5);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const points = Array.from({ length: 12 }, (_, index) => ({
      weekStartMs: baseWeekMs + (index * weekMs),
      value: index,
    }));

    const filtered = filterDashboardDerivedWeeklyRange(points, '8w');

    expect(filtered).toHaveLength(8);
    expect(filtered.map(point => point.value)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('keeps all finite weekly points sorted for the all range', () => {
    const points = [
      { weekStartMs: Date.UTC(2026, 0, 19), value: 2 },
      { weekStartMs: Number.NaN, value: 99 },
      { weekStartMs: Date.UTC(2026, 0, 5), value: 0 },
      { weekStartMs: Date.UTC(2026, 0, 12), value: 1 },
    ];

    const filtered = filterDashboardDerivedWeeklyRange(points, 'all');

    expect(filtered.map(point => point.value)).toEqual([0, 1, 2]);
  });
});
