import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { formatDashboardDateByInterval, getDashboardSummaryMetaLabel } from './dashboard-chart-data.helper';

describe('dashboard-chart-data.helper', () => {
  it('should return per interval labels for date categories', () => {
    const label = getDashboardSummaryMetaLabel(
      ChartDataCategoryTypes.DateType,
      ChartDataValueTypes.Total,
      TimeIntervals.Monthly
    );

    expect(label).toBe('Total per month');
  });

  it('should return per activity type labels for activity categories', () => {
    const label = getDashboardSummaryMetaLabel(
      ChartDataCategoryTypes.ActivityType,
      ChartDataValueTypes.Average,
      TimeIntervals.Weekly
    );

    expect(label).toBe('Average per activity type');
  });

  it('should default to value label when category is not provided', () => {
    const label = getDashboardSummaryMetaLabel(undefined, ChartDataValueTypes.Minimum, undefined);

    expect(label).toBe('Minimum');
  });

  it('should format dashboard dates using the provided locale', () => {
    const timestamp = Date.UTC(2024, 2, 2, 15, 4, 0);

    const british = formatDashboardDateByInterval(timestamp, TimeIntervals.Hourly, 'en-GB');
    const american = formatDashboardDateByInterval(timestamp, TimeIntervals.Hourly, 'en-US');

    expect(british).not.toBe(american);
    expect(british).toContain('02 Mar 2024');
    expect(american).toContain('Mar 02, 2024');
  });
});
