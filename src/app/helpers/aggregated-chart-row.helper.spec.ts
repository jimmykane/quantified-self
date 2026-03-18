import { describe, expect, it } from 'vitest';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataDistance,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { buildAggregatedChartRows } from './aggregated-chart-row.helper';
import type { EventStatAggregationResult } from '@shared/event-stat-aggregation.types';

describe('aggregated-chart-row.helper', () => {
  it('should build rows with aggregate, count, time, and dynamic series keys', () => {
    const aggregation: EventStatAggregationResult = {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Daily,
      buckets: [{
        bucketKey: Date.UTC(2024, 0, 1),
        time: Date.UTC(2024, 0, 1),
        totalCount: 2,
        aggregateValue: 42,
        seriesValues: { Running: 10, Cycling: 32 },
        seriesCounts: { Running: 1, Cycling: 1 },
      }],
    };

    expect(buildAggregatedChartRows(aggregation)).toEqual([{
      type: Date.UTC(2024, 0, 1),
      time: Date.UTC(2024, 0, 1),
      count: 2,
      Total: 42,
      Running: 10,
      Cycling: 32,
      'Running-Count': 1,
      'Cycling-Count': 1,
    }]);
  });

  it('should omit time for non-date buckets and keep the selected aggregate key', () => {
    const aggregation: EventStatAggregationResult = {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.ActivityType,
      resolvedTimeInterval: TimeIntervals.Daily,
      buckets: [{
        bucketKey: 'Running',
        totalCount: 3,
        aggregateValue: 14,
        seriesValues: { Running: 42 },
        seriesCounts: { Running: 3 },
      }],
    };

    const rows = buildAggregatedChartRows(aggregation);

    expect(rows).toHaveLength(1);
    expect(rows[0].time).toBeUndefined();
    expect(rows[0].Average).toBe(14);
    expect(rows[0].count).toBe(3);
  });
});
