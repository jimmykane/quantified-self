import type { EventStatAggregationResult } from '@shared/event-stat-aggregation.types';

export interface AggregatedChartRow {
  time?: number;
  type: string | number;
  count: number;
  [key: string]: string | number | undefined;
}

export function buildAggregatedChartRows(aggregation: EventStatAggregationResult): AggregatedChartRow[] {
  return aggregation.buckets.map((bucket) => {
    const row: AggregatedChartRow = {
      type: bucket.bucketKey,
      count: bucket.totalCount,
      [aggregation.valueType]: bucket.aggregateValue,
    };

    if (bucket.time !== undefined) {
      row.time = bucket.time;
    }

    Object.entries(bucket.seriesValues).forEach(([key, value]) => {
      row[key] = value;
    });
    Object.entries(bucket.seriesCounts).forEach(([key, value]) => {
      row[`${key}-Count`] = value;
    });

    return row;
  });
}
