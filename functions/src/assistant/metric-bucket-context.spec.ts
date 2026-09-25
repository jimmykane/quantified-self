import { describe, expect, it } from 'vitest';
import { ChartDataCategoryTypes, TimeIntervals } from '@sports-alliance/sports-lib';
import { addAssistantMetricBucketCalendarContext } from './metric-bucket-context';

describe('Assistant metric bucket calendar context', () => {
  it('labels a zoned daily bucket by its local date and weekday across a DST boundary', () => {
    const bucketKey = Date.parse('2026-03-28T22:00:00.000Z');
    const original = { aggregation: { categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Daily,
      buckets: [{ bucketKey, aggregateValue: 1800 }] } };
    const projected = addAssistantMetricBucketCalendarContext('query_metric', original, 'Europe/Helsinki');
    expect(projected).toMatchObject({ aggregation: { buckets: [{ bucketKey,
      aggregateValue: 1800, localDate: '2026-03-29', weekday: 'Sunday' }] } });
    expect(original.aggregation.buckets[0]).not.toHaveProperty('localDate');
  });

  it('labels every result of a multi-metric query without inventing dates for invalid buckets', () => {
    const original = { results: [{ aggregation: { categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Daily,
      buckets: [{ bucketKey: Date.parse('2026-12-31T23:00:00Z') },
      { bucketKey: 'Cycling' }, { bucketKey: Number.MAX_SAFE_INTEGER }] } }] };
    expect(addAssistantMetricBucketCalendarContext('query_metrics', original, 'Europe/Helsinki'))
      .toMatchObject({ results: [{ aggregation: { buckets: [
        { localDate: '2027-01-01', weekday: 'Friday' }, { bucketKey: 'Cycling' },
        { bucketKey: Number.MAX_SAFE_INTEGER },
      ] } }] });
    expect(addAssistantMetricBucketCalendarContext('get_daily_report', original, 'Europe/Helsinki'))
      .toBe(original);
    expect(addAssistantMetricBucketCalendarContext('query_metrics', original, 'Invalid/Zone'))
      .toBe(original);
    expect(addAssistantMetricBucketCalendarContext('query_metric', {
      aggregation: { categoryType: ChartDataCategoryTypes.ActivityType,
        buckets: [{ bucketKey: 42 }] },
    }, 'Europe/Helsinki')).toEqual({ aggregation: {
      categoryType: ChartDataCategoryTypes.ActivityType, buckets: [{ bucketKey: 42 }],
    } });
  });

  it('does not label a weekly bucket start as a recorded workout day', () => {
    const original = { aggregation: { categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Weekly,
      buckets: [{ bucketKey: Date.parse('2026-09-21T00:00:00.000Z'), aggregateValue: 9000 }] } };
    expect(addAssistantMetricBucketCalendarContext('query_metric', original, 'Europe/Helsinki'))
      .toEqual(original);
  });
});
