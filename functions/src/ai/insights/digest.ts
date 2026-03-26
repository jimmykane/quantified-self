import { TimeIntervals } from '@sports-alliance/sports-lib';
import type {
  AiInsightsDigest,
  AiInsightsDigestGranularity,
  AiInsightsMultiMetricAggregateMetricResult,
  NormalizedInsightDateRange,
} from '../../../../shared/ai-insights.types';

interface DigestBuildInput {
  digestMode: AiInsightsDigestGranularity;
  dateRange: NormalizedInsightDateRange;
  metricResults: AiInsightsMultiMetricAggregateMetricResult[];
}

interface DigestRangeBounds {
  startTime: number;
  endTime: number;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfWeek(date: Date): Date {
  const weekStart = startOfDay(date);
  const day = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - day + 1);
  return weekStart;
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function alignDateToDigestPeriodStart(date: Date, digestMode: AiInsightsDigestGranularity): Date {
  switch (digestMode) {
    case 'weekly':
      return startOfWeek(date);
    case 'yearly':
      return startOfYear(date);
    case 'monthly':
    default:
      return startOfMonth(date);
  }
}

function addDigestPeriod(date: Date, digestMode: AiInsightsDigestGranularity): Date {
  switch (digestMode) {
    case 'weekly':
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 7));
    case 'yearly':
      return new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
    case 'monthly':
    default:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }
}

function resolveDigestBucketStartTime(
  bucket: AiInsightsMultiMetricAggregateMetricResult['aggregation']['buckets'][number],
): number | null {
  if (typeof bucket.time === 'number' && Number.isFinite(bucket.time)) {
    return bucket.time;
  }
  if (typeof bucket.bucketKey === 'number' && Number.isFinite(bucket.bucketKey)) {
    return bucket.bucketKey;
  }
  return null;
}

function resolveDigestRangeBounds(
  dateRange: NormalizedInsightDateRange,
  expectedTimeInterval: TimeIntervals,
  metricResults: AiInsightsMultiMetricAggregateMetricResult[],
): DigestRangeBounds | null {
  if (dateRange.kind === 'bounded') {
    const startDate = new Date(dateRange.startDate);
    const endDate = new Date(dateRange.endDate);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate.getTime() > endDate.getTime()) {
      return null;
    }

    return {
      startTime: startDate.getTime(),
      endTime: endDate.getTime(),
    };
  }

  if (dateRange.kind !== 'all_time') {
    return null;
  }

  const bucketTimes = metricResults
    .filter(metricResult => metricResult.aggregation.resolvedTimeInterval === expectedTimeInterval)
    .flatMap(metricResult => metricResult.aggregation.buckets)
    .map(resolveDigestBucketStartTime)
    .filter((time): time is number => time !== null);
  if (!bucketTimes.length) {
    return null;
  }

  const startTime = Math.min(...bucketTimes);
  const endTime = Math.max(...bucketTimes);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
    return null;
  }

  return {
    startTime,
    endTime,
  };
}

function resolveDigestPeriodStarts(
  rangeBounds: DigestRangeBounds,
  digestMode: AiInsightsDigestGranularity,
): number[] {
  const periodStarts: number[] = [];
  let cursor = alignDateToDigestPeriodStart(new Date(rangeBounds.startTime), digestMode);
  while (cursor.getTime() <= rangeBounds.endTime) {
    periodStarts.push(cursor.getTime());
    const nextCursor = addDigestPeriod(cursor, digestMode);
    if (nextCursor.getTime() <= cursor.getTime()) {
      break;
    }
    cursor = nextCursor;
  }

  return periodStarts;
}

function resolveTimeIntervalForDigestMode(
  digestMode: AiInsightsDigestGranularity,
): TimeIntervals {
  switch (digestMode) {
    case 'weekly':
      return TimeIntervals.Weekly;
    case 'yearly':
      return TimeIntervals.Yearly;
    case 'monthly':
    default:
      return TimeIntervals.Monthly;
  }
}

export function buildAiInsightsDigest(
  input: DigestBuildInput,
): AiInsightsDigest {
  const expectedTimeInterval = resolveTimeIntervalForDigestMode(input.digestMode);
  const rangeBounds = resolveDigestRangeBounds(
    input.dateRange,
    expectedTimeInterval,
    input.metricResults,
  );
  const periodStarts = rangeBounds
    ? resolveDigestPeriodStarts(rangeBounds, input.digestMode)
    : [];

  const metricBucketsByTime = input.metricResults.map((metricResult) => {
    const bucketLookup = new Map<number, typeof metricResult.aggregation.buckets[number]>();
    if (metricResult.aggregation.resolvedTimeInterval === expectedTimeInterval) {
      metricResult.aggregation.buckets.forEach((bucket) => {
        if (typeof bucket.time === 'number' && Number.isFinite(bucket.time)) {
          bucketLookup.set(bucket.time, bucket);
          return;
        }
        if (typeof bucket.bucketKey === 'number' && Number.isFinite(bucket.bucketKey)) {
          bucketLookup.set(bucket.bucketKey, bucket);
        }
      });
    }
    return bucketLookup;
  });

  const periods = periodStarts.map((periodStart) => {
    const metrics = input.metricResults.map((metricResult, metricIndex) => {
      const metricBucket = metricBucketsByTime[metricIndex]?.get(periodStart);
      return {
        metricKey: metricResult.metricKey,
        metricLabel: metricResult.metricLabel,
        dataType: metricResult.query.dataType,
        valueType: metricResult.query.valueType,
        aggregateValue: metricBucket?.aggregateValue ?? null,
        totalCount: metricBucket?.totalCount ?? 0,
      };
    });
    const hasData = metrics.some(metric => metric.totalCount > 0);
    const matchingBucket = metricBucketsByTime
      .map(lookup => lookup.get(periodStart))
      .find(bucket => bucket !== undefined);

    return {
      bucketKey: matchingBucket?.bucketKey ?? periodStart,
      time: periodStart,
      hasData,
      metrics,
    };
  });

  return {
    granularity: input.digestMode,
    periodCount: periods.length,
    nonEmptyPeriodCount: periods.filter(period => period.hasData).length,
    periods,
  };
}
