import { ChartDataCategoryTypes, ChartDataValueTypes, TimeIntervals } from '@sports-alliance/sports-lib';
import type {
  AiInsightSummaryBucket,
  AiInsightSummaryDeltaDirection,
  AiInsightSummaryPeriodDeltaContributor,
  AiInsightSummary,
  AiInsightSummaryActivityMix,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import { buildBucketCoverage } from './insight-bucket-coverage';

const PERIOD_DELTA_TOP_CONTRIBUTORS_MAX = 2;

interface SummaryAggregationBucket {
  bucketKey: string | number;
  time?: number;
  aggregateValue: number;
  totalCount: number;
  seriesValues?: Record<string, number>;
}

interface SummaryAggregationInput {
  valueType?: ChartDataValueTypes;
  resolvedTimeInterval: TimeIntervals;
  buckets: SummaryAggregationBucket[];
}

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

function toSummaryBucket(bucket: SummaryAggregationBucket): AiInsightSummaryBucket {
  return {
    bucketKey: bucket.bucketKey,
    time: bucket.time,
    aggregateValue: bucket.aggregateValue,
    totalCount: bucket.totalCount,
  };
}

function resolveDeltaDirection(deltaAggregateValue: number): AiInsightSummaryDeltaDirection {
  if (deltaAggregateValue > 0) {
    return 'increase';
  }
  if (deltaAggregateValue < 0) {
    return 'decrease';
  }
  return 'no_change';
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildPeriodDeltaContributors(
  fromBucket: SummaryAggregationBucket,
  toBucket: SummaryAggregationBucket,
): AiInsightSummaryPeriodDeltaContributor[] {
  const fromSeriesValues = fromBucket.seriesValues ?? {};
  const toSeriesValues = toBucket.seriesValues ?? {};
  const seriesKeys = Array.from(new Set([
    ...Object.keys(fromSeriesValues),
    ...Object.keys(toSeriesValues),
  ]));

  return seriesKeys
    .map((seriesKey) => {
      const fromValue = toFiniteNumber(fromSeriesValues[seriesKey]);
      const toValue = toFiniteNumber(toSeriesValues[seriesKey]);
      if (fromValue === null || toValue === null) {
        return null;
      }

      const deltaAggregateValue = toValue - fromValue;
      if (!Number.isFinite(deltaAggregateValue) || deltaAggregateValue === 0) {
        return null;
      }

      return {
        seriesKey,
        deltaAggregateValue,
        direction: resolveDeltaDirection(deltaAggregateValue),
      } satisfies AiInsightSummaryPeriodDeltaContributor;
    })
    .filter((contributor): contributor is AiInsightSummaryPeriodDeltaContributor => contributor !== null)
    .sort((left, right) => (
      Math.abs(right.deltaAggregateValue) - Math.abs(left.deltaAggregateValue)
      || left.seriesKey.localeCompare(right.seriesKey)
    ))
    .slice(0, PERIOD_DELTA_TOP_CONTRIBUTORS_MAX);
}

function buildPeriodDeltas(
  query: NormalizedInsightQuery,
  aggregation: SummaryAggregationInput,
): AiInsightSummary['periodDeltas'] {
  if (
    query.resultKind !== 'aggregate'
    || query.categoryType !== ChartDataCategoryTypes.DateType
    || query.periodMode !== 'compare'
    || aggregation.buckets.length < 2
  ) {
    return null;
  }

  const periodDeltas = aggregation.buckets.slice(1).map((bucket, index) => {
    const previousBucket = aggregation.buckets[index];
    const deltaAggregateValue = bucket.aggregateValue - previousBucket.aggregateValue;

    return {
      fromBucket: toSummaryBucket(previousBucket),
      toBucket: toSummaryBucket(bucket),
      deltaAggregateValue,
      direction: resolveDeltaDirection(deltaAggregateValue),
      contributors: buildPeriodDeltaContributors(previousBucket, bucket),
    };
  });

  return periodDeltas.length ? periodDeltas : null;
}

function buildTrend(
  query: NormalizedInsightQuery,
  aggregation: SummaryAggregationInput,
): AiInsightSummary['trend'] {
  if (
    query.categoryType !== ChartDataCategoryTypes.DateType
    || (query.resultKind === 'multi_metric_aggregate' && query.groupingMode === 'overall')
    || aggregation.buckets.length < 2
  ) {
    return null;
  }

  const previousBucket = aggregation.buckets[aggregation.buckets.length - 2] ?? null;
  const latestBucket = aggregation.buckets[aggregation.buckets.length - 1] ?? null;
  if (!previousBucket || !latestBucket) {
    return null;
  }

  return {
    previousBucket: toSummaryBucket(previousBucket),
    deltaAggregateValue: latestBucket.aggregateValue - previousBucket.aggregateValue,
  };
}

function resolveOverallAggregateValue(
  valueType: ChartDataValueTypes,
  aggregation: SummaryAggregationInput,
): number | null {
  const buckets = aggregation.buckets.filter((bucket) => Number.isFinite(bucket.aggregateValue));
  if (!buckets.length) {
    return null;
  }

  switch (valueType) {
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

function resolveSummaryValueType(
  query: NormalizedInsightQuery,
  aggregationValueType: ChartDataValueTypes | undefined,
): ChartDataValueTypes | null {
  if (
    query.resultKind === 'multi_metric_aggregate'
    || query.resultKind === 'latest_event'
    || query.resultKind === 'power_curve'
  ) {
    return aggregationValueType ?? null;
  }

  return query.valueType ?? aggregationValueType ?? null;
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
    periodDeltas: null,
  };
}

export function buildInsightSummary(
  query: NormalizedInsightQuery,
  aggregation: SummaryAggregationInput,
  matchedEventCount: number,
  matchedActivityTypeCounts: Array<{ activityType: string; eventCount: number }>,
): AiInsightSummary {
  const resolvedValueType = resolveSummaryValueType(query, aggregation.valueType);
  const isOverallMultiMetric = query.resultKind === 'multi_metric_aggregate' && query.groupingMode === 'overall';
  const peakBucket = isOverallMultiMetric
    ? null
    : ([...aggregation.buckets].sort((left, right) => right.aggregateValue - left.aggregateValue)[0] ?? null);
  const lowestBucket = isOverallMultiMetric
    ? null
    : ([...aggregation.buckets].sort((left, right) => left.aggregateValue - right.aggregateValue)[0] ?? null);
  const latestBucket = query.categoryType === ChartDataCategoryTypes.DateType && !isOverallMultiMetric
    ? (aggregation.buckets[aggregation.buckets.length - 1] ?? null)
    : null;

  return {
    matchedEventCount,
    overallAggregateValue: resolvedValueType ? resolveOverallAggregateValue(resolvedValueType, aggregation) : null,
    peakBucket: peakBucket ? toSummaryBucket(peakBucket) : null,
    lowestBucket: lowestBucket ? toSummaryBucket(lowestBucket) : null,
    latestBucket: latestBucket ? toSummaryBucket(latestBucket) : null,
    activityMix: buildActivityMix(matchedActivityTypeCounts),
    bucketCoverage: isOverallMultiMetric ? null : buildBucketCoverage(query, aggregation),
    trend: isOverallMultiMetric ? null : buildTrend(query, aggregation),
    periodDeltas: isOverallMultiMetric ? null : buildPeriodDeltas(query, aggregation),
  };
}
