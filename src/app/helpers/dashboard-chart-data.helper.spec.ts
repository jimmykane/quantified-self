import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataDuration,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  formatDashboardDataDisplay,
  formatDashboardDateByInterval,
  formatDashboardNumericValue,
  getDashboardSummaryMetaLabel
} from './dashboard-chart-data.helper';

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

  it('should format long duration aggregates using days once they cross 24 hours', () => {
    const value = formatDashboardDataDisplay(new DataDuration((24 * 60 * 60) + (2 * 60 * 60) + (15 * 60)));

    expect(value).toBe('1d 02h 15m');
  });

  it('should keep shorter duration dashboard values in time format', () => {
    const value = formatDashboardNumericValue(DataDuration.type, (2 * 60 * 60) + (15 * 60) + 30);

    expect(value).toBe('02h 15m 30s');
  });
});
