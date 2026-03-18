import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataDuration,
  DataPaceAvg,
  DataSpeedAvg,
  DaysOfTheWeek,
  PaceUnits,
  SpeedUnits,
  SwimPaceUnits,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  formatDashboardBucketDateByInterval,
  formatDashboardDataDisplay,
  formatDashboardDateByInterval,
  formatDashboardDateRange,
  formatDashboardNumericValue,
  getDashboardChartSortComparator,
  getDashboardSummaryMetaLabel
} from './dashboard-chart-data.helper';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';

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

  it('should format bounded date ranges using the provided locale', () => {
    const start = Date.UTC(2024, 2, 2);
    const end = Date.UTC(2024, 2, 9);

    const british = formatDashboardDateRange(start, end, 'en-GB');
    const american = formatDashboardDateRange(start, end, 'en-US');

    expect(british).toBe('02 Mar 2024 to 09 Mar 2024');
    expect(american).toBe('Mar 02, 2024 to Mar 09, 2024');
  });

  it('should format bounded date ranges using an explicit query timezone when provided', () => {
    const start = '2025-12-19T08:00:00.000Z';
    const end = '2026-03-19T06:59:59.999Z';

    const british = formatDashboardDateRange(start, end, 'en-GB', 'America/Los_Angeles');
    const american = formatDashboardDateRange(start, end, 'en-US', 'America/Los_Angeles');

    expect(british).toBe('19 Dec 2025 to 18 Mar 2026');
    expect(american).toBe('Dec 19, 2025 to Mar 18, 2026');
  });

  it('should format bucket dates by interval using the shared dashboard rules', () => {
    const timestamp = Date.UTC(2024, 2, 2, 15, 4, 0);

    expect(formatDashboardBucketDateByInterval(timestamp, TimeIntervals.BiWeekly, 'en-GB')).toContain('Week');
    expect(formatDashboardBucketDateByInterval(timestamp, TimeIntervals.BiWeekly, 'en-GB')).toContain('02 Mar 2024');
    expect(formatDashboardBucketDateByInterval(timestamp, TimeIntervals.Quarterly, 'en-GB')).toBe('Mar 2024');
  });

  it('should format bucket dates using an explicit query timezone when provided', () => {
    const timestamp = '2026-03-19T06:59:59.999Z';

    expect(
      formatDashboardBucketDateByInterval(timestamp, TimeIntervals.Daily, 'en-GB', 'America/Los_Angeles'),
    ).toBe('18 Mar 2026');
  });

  it('should format long duration aggregates using days once they cross 24 hours', () => {
    const value = formatDashboardDataDisplay(new DataDuration((24 * 60 * 60) + (2 * 60 * 60) + (15 * 60)));

    expect(value).toBe('1d 02h 15m');
  });

  it('should keep shorter duration dashboard values in time format', () => {
    const value = formatDashboardNumericValue(DataDuration.type, (2 * 60 * 60) + (15 * 60) + 30);

    expect(value).toBe('02h 15m 30s');
  });

  it('should format pace values using the provided unit settings', () => {
    const value = formatDashboardNumericValue(
      DataPaceAvg.type,
      300,
      undefined,
      normalizeUserUnitSettings({
        paceUnits: [PaceUnits.MinutesPerMile],
        speedUnits: [SpeedUnits.MilesPerHour],
        swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
        startOfTheWeek: DaysOfTheWeek.Monday,
      }),
    );

    expect(value).toBe('08:02 min/m');
  });

  it('should format speed values using the provided unit settings', () => {
    const value = formatDashboardNumericValue(
      DataSpeedAvg.type,
      10,
      undefined,
      normalizeUserUnitSettings({
        paceUnits: [PaceUnits.MinutesPerMile],
        speedUnits: [SpeedUnits.MilesPerHour],
        swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
        startOfTheWeek: DaysOfTheWeek.Monday,
      }),
    );

    expect(value).toBe('22.37 mph');
  });

  it('should sort activity rows by their selected aggregate value', () => {
    const comparator = getDashboardChartSortComparator(
      ChartDataCategoryTypes.ActivityType,
      ChartDataValueTypes.Total,
    );

    const rows = [
      { type: 'Cycling', count: 1, Total: 30 },
      { type: 'Running', count: 1, Total: 10 },
      { type: 'Swimming', count: 1, Total: 20 },
    ];

    expect([...rows].sort(comparator).map(row => row.type)).toEqual([
      'Running',
      'Swimming',
      'Cycling',
    ]);
  });

  it('should sort date rows in chronological order using time', () => {
    const comparator = getDashboardChartSortComparator(
      ChartDataCategoryTypes.DateType,
      ChartDataValueTypes.Total,
    );

    const rows = [
      { type: 'oldest', count: 1, time: Date.UTC(2024, 0, 1), Total: 10 },
      { type: 'newest', count: 1, time: Date.UTC(2024, 0, 3), Total: 20 },
      { type: 'middle', count: 1, time: Date.UTC(2024, 0, 2), Total: 15 },
    ];

    expect([...rows].sort(comparator).map(row => row.type)).toEqual([
      'oldest',
      'middle',
      'newest',
    ]);
  });

  it('should fall back to a numeric string when no data instance can be created', () => {
    const value = formatDashboardNumericValue(undefined, 1234.567);

    expect(value).toBe('1,234.57');
  });
});
