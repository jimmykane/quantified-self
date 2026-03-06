import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildDashboardPieChartData,
  getDashboardPieSliceDisplayLabel
} from './dashboard-pie-chart-data.helper';
import { formatDashboardDateByInterval } from './dashboard-chart-data.helper';

describe('dashboard-pie-chart-data.helper', () => {
  it('should group activity slices under threshold into "Other"', () => {
    const result = buildDashboardPieChartData({
      data: [
        { type: 'Running', [ChartDataValueTypes.Total]: 90, count: 5 },
        { type: 'Cycling', [ChartDataValueTypes.Total]: 5, count: 1 },
        { type: 'Swimming', [ChartDataValueTypes.Total]: 5, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.ActivityType,
      thresholdPercent: 7
    });

    expect(result.total).toBe(100);
    expect(result.slices).toHaveLength(2);
    expect(result.slices[0].label).toBe('Running');
    expect(result.slices[1].label).toBe('Other');
    expect(result.slices[1].value).toBe(10);
    expect(result.slices[1].count).toBe(2);
    expect(result.slices[1].isOther).toBe(true);
  });

  it('should keep date-type slices ungrouped even under threshold', () => {
    const result = buildDashboardPieChartData({
      data: [
        { type: 1704067200000, time: 1704067200000, [ChartDataValueTypes.Total]: 90, count: 5 },
        { type: 1704153600000, time: 1704153600000, [ChartDataValueTypes.Total]: 5, count: 1 },
        { type: 1704240000000, time: 1704240000000, [ChartDataValueTypes.Total]: 5, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
      thresholdPercent: 7
    });

    expect(result.slices).toHaveLength(3);
    expect(result.slices.map(slice => slice.label)).not.toContain('Other');
  });

  it('should ignore invalid and non-positive values', () => {
    const result = buildDashboardPieChartData({
      data: [
        { type: 'Running', [ChartDataValueTypes.Total]: 'NaN', count: 2 },
        { type: 'Cycling', [ChartDataValueTypes.Total]: 0, count: 2 },
        { type: 'Swimming', [ChartDataValueTypes.Total]: -1, count: 2 },
        { type: 'Hiking', [ChartDataValueTypes.Total]: 12, count: 3 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.ActivityType,
    });

    expect(result.total).toBe(12);
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].label).toBe('Hiking');
  });

  it('should format date labels based on interval', () => {
    const data = buildDashboardPieChartData({
      data: [
        { type: 1704067200000, time: 1704067200000, [ChartDataValueTypes.Total]: 10, count: 1 },
      ],
      chartDataValueType: ChartDataValueTypes.Total,
      chartDataCategoryType: ChartDataCategoryTypes.DateType,
    });

    const label = getDashboardPieSliceDisplayLabel(
      data.slices[0],
      ChartDataCategoryTypes.DateType,
      TimeIntervals.Daily
    );

    expect(label).toBe(formatDashboardDateByInterval(1704067200000, TimeIntervals.Daily));
  });
});
