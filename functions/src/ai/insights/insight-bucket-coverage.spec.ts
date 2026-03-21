import { describe, expect, it, vi } from 'vitest';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { buildBucketCoverage, resolveTotalBucketCount } from './insight-bucket-coverage';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

const baseQuery = {
  resultKind: 'aggregate' as const,
  dataType: 'Distance',
  valueType: ChartDataValueTypes.Total,
  categoryType: ChartDataCategoryTypes.DateType,
  requestedTimeInterval: TimeIntervals.Monthly,
  activityTypeGroups: [],
  activityTypes: [],
  dateRange: {
    kind: 'bounded' as const,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-03-31T23:59:59.999Z',
    timezone: 'UTC',
    source: 'prompt' as const,
  },
  chartType: ChartTypes.ColumnsVertical,
};

describe('insight-bucket-coverage', () => {
  it('counts bounded date buckets for monthly ranges', () => {
    expect(resolveTotalBucketCount(baseQuery.dateRange, TimeIntervals.Monthly)).toBe(3);
  });

  it('counts paired biweekly buckets that intersect the requested range', () => {
    expect(resolveTotalBucketCount({
      kind: 'bounded',
      startDate: '2024-01-08T00:00:00.000Z',
      endDate: '2024-01-21T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    }, TimeIntervals.BiWeekly)).toBe(2);
  });

  it('builds coverage only for bounded date queries', () => {
    expect(buildBucketCoverage(baseQuery, {
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [1, 2],
    })).toEqual({
      nonEmptyBucketCount: 2,
      totalBucketCount: 3,
    });

    expect(buildBucketCoverage({
      ...baseQuery,
      categoryType: ChartDataCategoryTypes.ActivityType,
    }, {
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [1, 2],
    })).toBeNull();
  });
});
