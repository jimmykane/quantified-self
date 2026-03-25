import { ChartDataCategoryTypes } from '@sports-alliance/sports-lib';
import type {
  AiInsightAnomalyKind,
  AiInsightConfidenceTier,
  AiInsightSummaryAnomalyCallout,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import {
  AI_INSIGHTS_ANOMALY_MAX_CALLOUTS,
  AI_INSIGHTS_ANOMALY_MIN_BUCKET_COUNT,
  AI_INSIGHTS_ANOMALY_MIN_BUCKET_EVENTS,
  AI_INSIGHTS_ANOMALY_MIN_MATCHED_EVENTS,
  AI_INSIGHTS_ANOMALY_MIX_SHIFT_HIGH_TVD,
  AI_INSIGHTS_ANOMALY_MIX_SHIFT_MAX_SERIES_EVIDENCE,
  AI_INSIGHTS_ANOMALY_MIX_SHIFT_MEDIUM_TVD,
  AI_INSIGHTS_ANOMALY_SPIKE_DROP_HIGH_Z_SCORE,
  AI_INSIGHTS_ANOMALY_SPIKE_DROP_MEDIUM_Z_SCORE,
  AI_INSIGHTS_ANOMALY_SPIKE_DROP_MIN_RELATIVE_DELTA,
} from '../../../../shared/ai-insights-anomaly.constants';

interface SummaryAggregationBucketInput {
  bucketKey: string | number;
  time?: number;
  aggregateValue: number;
  totalCount: number;
  seriesCounts?: Record<string, number>;
}

interface BuildSummaryAnomalyCalloutsInput {
  query: NormalizedInsightQuery;
  matchedEventCount: number;
  buckets: SummaryAggregationBucketInput[];
}

interface DistributionDelta {
  seriesKey: string;
  deltaShare: number;
}

function compareBucketOrder(
  left: SummaryAggregationBucketInput,
  right: SummaryAggregationBucketInput,
): number {
  if (typeof left.time === 'number' && typeof right.time === 'number') {
    return left.time - right.time;
  }

  return `${left.bucketKey}`.localeCompare(`${right.bucketKey}`);
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function quartile(values: number[], quantile: number): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, quantile));
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return sorted[lowerIndex] + ((sorted[upperIndex] - sorted[lowerIndex]) * weight);
}

function resolveScaleFromDistribution(values: number[], distributionMedian: number): number {
  const absoluteDeviations = values.map(value => Math.abs(value - distributionMedian));
  const mad = median(absoluteDeviations);
  if (mad > 0) {
    return 1.4826 * mad;
  }

  const iqr = quartile(values, 0.75) - quartile(values, 0.25);
  if (iqr > 0) {
    return iqr / 1.349;
  }

  return 0;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 1000) {
    return value.toFixed(0);
  }
  if (absoluteValue >= 100) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}

function resolveConfidenceTier(score: number, highThreshold: number): AiInsightConfidenceTier {
  return score >= highThreshold ? 'high' : 'medium';
}

function resolveMetricLabel(query: NormalizedInsightQuery): string {
  if (query.resultKind === 'aggregate') {
    return query.dataType;
  }

  if (query.resultKind === 'multi_metric_aggregate') {
    return 'selected metric';
  }

  return 'metric';
}

function resolveMetricSlug(query: NormalizedInsightQuery): string {
  if (query.resultKind !== 'aggregate') {
    return 'metric';
  }

  const normalized = query.dataType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'metric';
}

function buildSpikeDropCallouts(
  query: NormalizedInsightQuery,
  buckets: SummaryAggregationBucketInput[],
): AiInsightSummaryAnomalyCallout[] {
  const candidateBuckets = buckets.filter(bucket => (
    bucket.totalCount >= AI_INSIGHTS_ANOMALY_MIN_BUCKET_EVENTS
    && Number.isFinite(bucket.aggregateValue)
  ));
  const values = candidateBuckets.map(bucket => bucket.aggregateValue);
  if (values.length < AI_INSIGHTS_ANOMALY_MIN_BUCKET_COUNT) {
    return [];
  }

  const distributionMedian = median(values);
  const distributionScale = resolveScaleFromDistribution(values, distributionMedian);
  if (!Number.isFinite(distributionScale) || distributionScale <= 0) {
    return [];
  }

  const denominator = Math.max(Math.abs(distributionMedian), 1e-9);
  const metricLabel = resolveMetricLabel(query);
  const metricSlug = resolveMetricSlug(query);

  const callouts: AiInsightSummaryAnomalyCallout[] = [];
  candidateBuckets.forEach((bucket) => {
    const deltaFromMedian = bucket.aggregateValue - distributionMedian;
    const robustZScore = Math.abs(deltaFromMedian / distributionScale);
    const relativeDelta = Math.abs(deltaFromMedian) / denominator;
    if (
      robustZScore < AI_INSIGHTS_ANOMALY_SPIKE_DROP_MEDIUM_Z_SCORE
      || relativeDelta < AI_INSIGHTS_ANOMALY_SPIKE_DROP_MIN_RELATIVE_DELTA
    ) {
      return;
    }

    const kind: AiInsightAnomalyKind = deltaFromMedian >= 0 ? 'spike' : 'drop';
    const statementId = `anomaly:${kind}:${metricSlug}:${bucket.bucketKey}`;
    callouts.push({
      id: `callout:${kind}:${metricSlug}:${bucket.bucketKey}`,
      statementId,
      kind,
      snippet: `Unusual ${kind} at ${bucket.bucketKey}: ${metricLabel} was ${formatNumber(bucket.aggregateValue)} (baseline ${formatNumber(distributionMedian)}).`,
      confidenceTier: resolveConfidenceTier(robustZScore, AI_INSIGHTS_ANOMALY_SPIKE_DROP_HIGH_Z_SCORE),
      score: Number((robustZScore * (1 + relativeDelta)).toFixed(6)),
      evidenceRefs: [
        {
          kind: 'bucket',
          label: `Bucket ${bucket.bucketKey}`,
          bucketKey: bucket.bucketKey,
        },
      ],
    });
  });

  return callouts;
}

function resolveDistribution(
  seriesCounts: Record<string, number>,
): Record<string, number> {
  const total = Object.values(seriesCounts)
    .reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  if (total <= 0) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(seriesCounts)
      .map(([seriesKey, count]) => [
        seriesKey,
        Number.isFinite(count) ? count / total : 0,
      ]),
  );
}

function buildDistributionDeltas(
  previousDistribution: Record<string, number>,
  currentDistribution: Record<string, number>,
): DistributionDelta[] {
  const keys = Array.from(new Set([
    ...Object.keys(previousDistribution),
    ...Object.keys(currentDistribution),
  ]));

  return keys
    .map((seriesKey) => ({
      seriesKey,
      deltaShare: (currentDistribution[seriesKey] ?? 0) - (previousDistribution[seriesKey] ?? 0),
    }))
    .filter((entry) => entry.deltaShare !== 0)
    .sort((left, right) => Math.abs(right.deltaShare) - Math.abs(left.deltaShare));
}

function buildActivityMixShiftCallouts(
  query: NormalizedInsightQuery,
  buckets: SummaryAggregationBucketInput[],
): AiInsightSummaryAnomalyCallout[] {
  const metricSlug = resolveMetricSlug(query);
  const sortedBuckets = [...buckets].sort(compareBucketOrder);
  const candidateBuckets = sortedBuckets.filter(bucket => (
    bucket.totalCount >= AI_INSIGHTS_ANOMALY_MIN_BUCKET_EVENTS
    && !!bucket.seriesCounts
    && Object.keys(bucket.seriesCounts).length > 0
  ));
  if (candidateBuckets.length < AI_INSIGHTS_ANOMALY_MIN_BUCKET_COUNT) {
    return [];
  }

  const callouts: AiInsightSummaryAnomalyCallout[] = [];
  for (let index = 1; index < candidateBuckets.length; index += 1) {
    const previousBucket = candidateBuckets[index - 1];
    const currentBucket = candidateBuckets[index];
    if (!previousBucket?.seriesCounts || !currentBucket?.seriesCounts) {
      continue;
    }

    const previousDistribution = resolveDistribution(previousBucket.seriesCounts);
    const currentDistribution = resolveDistribution(currentBucket.seriesCounts);
    const deltas = buildDistributionDeltas(previousDistribution, currentDistribution);
    if (!deltas.length) {
      continue;
    }

    const totalVariationDistance = 0.5 * deltas
      .reduce((sum, entry) => sum + Math.abs(entry.deltaShare), 0);
    if (totalVariationDistance < AI_INSIGHTS_ANOMALY_MIX_SHIFT_MEDIUM_TVD) {
      continue;
    }

    const evidenceRefs = [
      {
        kind: 'bucket' as const,
        label: `From ${previousBucket.bucketKey}`,
        bucketKey: previousBucket.bucketKey,
      },
      {
        kind: 'bucket' as const,
        label: `To ${currentBucket.bucketKey}`,
        bucketKey: currentBucket.bucketKey,
      },
      ...deltas.slice(0, AI_INSIGHTS_ANOMALY_MIX_SHIFT_MAX_SERIES_EVIDENCE).map((entry) => ({
        kind: 'series' as const,
        label: `${entry.seriesKey} (${entry.deltaShare > 0 ? '+' : ''}${(entry.deltaShare * 100).toFixed(1)}pp)`,
        seriesKey: entry.seriesKey,
      })),
    ];

    callouts.push({
      id: `callout:activity_mix_shift:${metricSlug}:${previousBucket.bucketKey}:${currentBucket.bucketKey}`,
      statementId: `anomaly:activity_mix_shift:${metricSlug}:${previousBucket.bucketKey}:${currentBucket.bucketKey}`,
      kind: 'activity_mix_shift',
      snippet: `Activity mix shifted from ${previousBucket.bucketKey} to ${currentBucket.bucketKey} (${(totalVariationDistance * 100).toFixed(1)}% distribution change).`,
      confidenceTier: resolveConfidenceTier(totalVariationDistance, AI_INSIGHTS_ANOMALY_MIX_SHIFT_HIGH_TVD),
      score: Number((totalVariationDistance * 10).toFixed(6)),
      evidenceRefs,
    });
  }

  return callouts;
}

function supportsAnomalyDetection(query: NormalizedInsightQuery): boolean {
  if (query.categoryType !== ChartDataCategoryTypes.DateType) {
    return false;
  }

  if (query.resultKind === 'aggregate') {
    return true;
  }

  return query.resultKind === 'multi_metric_aggregate' && query.groupingMode === 'date';
}

export function buildSummaryAnomalyCallouts(
  input: BuildSummaryAnomalyCalloutsInput,
): AiInsightSummaryAnomalyCallout[] | null {
  if (!supportsAnomalyDetection(input.query)) {
    return null;
  }

  if (input.matchedEventCount < AI_INSIGHTS_ANOMALY_MIN_MATCHED_EVENTS) {
    return null;
  }

  const eligibleBuckets = input.buckets.filter(bucket => Number.isFinite(bucket.aggregateValue));
  if (eligibleBuckets.length < AI_INSIGHTS_ANOMALY_MIN_BUCKET_COUNT) {
    return null;
  }

  const callouts = [
    ...buildSpikeDropCallouts(input.query, eligibleBuckets),
    ...buildActivityMixShiftCallouts(input.query, eligibleBuckets),
  ].sort((left, right) => (
    right.score - left.score
    || left.id.localeCompare(right.id)
  ));

  if (!callouts.length) {
    return null;
  }

  return callouts.slice(0, AI_INSIGHTS_ANOMALY_MAX_CALLOUTS);
}
