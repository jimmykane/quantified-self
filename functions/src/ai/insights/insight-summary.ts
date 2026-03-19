import { ChartDataCategoryTypes, ChartDataValueTypes, TimeIntervals } from '@sports-alliance/sports-lib';
import type {
  AiInsightSummary,
  AiInsightSummaryActivityMix,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import { buildBucketCoverage } from './insight-bucket-coverage';

function buildActivityMix(
  matchedActivityTypeCounts: Array<{ activityType: string; eventCount: number }>,
): AiInsightSummaryActivityMix | null {
  if (!matchedActivityTypeCounts.length) {
    return null;
  }

  return {
    topActivityTypes: matchedActivityTypeCounts.slice(0, 3),
    remainingActivityTypeCount: Math.max(0, matchedActivityTypeCounts.length - 3),
  };
}

function buildTrend(
  query: NormalizedInsightQuery,
  aggregation: {
    buckets: Array<{
      bucketKey: string | number;
      time?: number;
      aggregateValue: number;
      totalCount: number;
    }>;
  },
): AiInsightSummary['trend'] {
  if (query.categoryType !== ChartDataCategoryTypes.DateType || aggregation.buckets.length < 2) {
    return null;
  }

  const previousBucket = aggregation.buckets[aggregation.buckets.length - 2] ?? null;
  const latestBucket = aggregation.buckets[aggregation.buckets.length - 1] ?? null;
  if (!previousBucket || !latestBucket) {
    return null;
  }

  return {
    previousBucket: {
      bucketKey: previousBucket.bucketKey,
      time: previousBucket.time,
      aggregateValue: previousBucket.aggregateValue,
      totalCount: previousBucket.totalCount,
    },
    deltaAggregateValue: latestBucket.aggregateValue - previousBucket.aggregateValue,
  };
}

function resolveOverallAggregateValue(
  query: NormalizedInsightQuery,
  aggregation: {
    buckets: Array<{ aggregateValue: number; totalCount: number }>;
  },
): number | null {
  const buckets = aggregation.buckets.filter((bucket) => Number.isFinite(bucket.aggregateValue));
  if (!buckets.length) {
    return null;
  }

  switch (query.valueType) {
    case ChartDataValueTypes.Total:
      return buckets.reduce((sum, bucket) => sum + bucket.aggregateValue, 0);
    case ChartDataValueTypes.Maximum:
      return Math.max(...buckets.map((bucket) => bucket.aggregateValue));
    case ChartDataValueTypes.Minimum:
      return Math.min(...buckets.map((bucket) => bucket.aggregateValue));
    case ChartDataValueTypes.Average: {
      const weighted = buckets.reduce((acc, bucket) => ({
        totalValue: acc.totalValue + (bucket.aggregateValue * bucket.totalCount),
        totalCount: acc.totalCount + bucket.totalCount,
      }), { totalValue: 0, totalCount: 0 });

      if (weighted.totalCount > 0) {
        return weighted.totalValue / weighted.totalCount;
      }

      return buckets.reduce((sum, bucket) => sum + bucket.aggregateValue, 0) / buckets.length;
    }
    default:
      return null;
  }
}

export function buildNonAggregateEmptySummary(): AiInsightSummary {
  return {
    matchedEventCount: 0,
    overallAggregateValue: null,
    peakBucket: null,
    lowestBucket: null,
    latestBucket: null,
    activityMix: null,
    bucketCoverage: null,
    trend: null,
  };
}

export function buildInsightSummary(
  query: NormalizedInsightQuery,
  aggregation: {
    resolvedTimeInterval: TimeIntervals;
    buckets: Array<{
      bucketKey: string | number;
      time?: number;
      aggregateValue: number;
      totalCount: number;
    }>;
  },
  matchedEventCount: number,
  matchedActivityTypeCounts: Array<{ activityType: string; eventCount: number }>,
): AiInsightSummary {
  const peakBucket = [...aggregation.buckets].sort((left, right) => right.aggregateValue - left.aggregateValue)[0] ?? null;
  const lowestBucket = [...aggregation.buckets].sort((left, right) => left.aggregateValue - right.aggregateValue)[0] ?? null;
  const latestBucket = query.categoryType === ChartDataCategoryTypes.DateType
    ? (aggregation.buckets[aggregation.buckets.length - 1] ?? null)
    : null;

  return {
    matchedEventCount,
    overallAggregateValue: resolveOverallAggregateValue(query, aggregation),
    peakBucket: peakBucket
      ? {
        bucketKey: peakBucket.bucketKey,
        time: peakBucket.time,
        aggregateValue: peakBucket.aggregateValue,
        totalCount: peakBucket.totalCount,
      }
      : null,
    lowestBucket: lowestBucket
      ? {
        bucketKey: lowestBucket.bucketKey,
        time: lowestBucket.time,
        aggregateValue: lowestBucket.aggregateValue,
        totalCount: lowestBucket.totalCount,
      }
      : null,
    latestBucket: latestBucket
      ? {
        bucketKey: latestBucket.bucketKey,
        time: latestBucket.time,
        aggregateValue: latestBucket.aggregateValue,
        totalCount: latestBucket.totalCount,
      }
      : null,
    activityMix: buildActivityMix(matchedActivityTypeCounts),
    bucketCoverage: buildBucketCoverage(query, aggregation),
    trend: buildTrend(query, aggregation),
  };
}
