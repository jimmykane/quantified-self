import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightSummaryBucket,
  AiInsightSummaryDeltaDirection,
  AiInsightSummaryPeriodDeltaContributor,
  AiInsightSummaryPeriodDeltaEventContributor,
  AiInsightSummary,
  AiInsightSummaryActivityMix,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import { AI_INSIGHTS_COMPARE_EVENT_CONTRIBUTORS_MAX } from '../../../../shared/ai-insights-compare.constants';
import { resolveAggregationCategoryKey } from '../../../../shared/event-stat-aggregation';
import { buildSummaryAnomalyCallouts } from './anomaly-callouts';
import { buildBucketCoverage } from './insight-bucket-coverage';

const PERIOD_DELTA_TOP_CONTRIBUTORS_MAX = 2;

interface SummaryAggregationBucket {
  bucketKey: string | number;
  time?: number;
  aggregateValue: number;
  totalCount: number;
  seriesValues?: Record<string, number>;
  seriesCounts?: Record<string, number>;
}

interface SummaryAggregationInput {
  valueType?: ChartDataValueTypes;
  resolvedTimeInterval: TimeIntervals;
  buckets: SummaryAggregationBucket[];
}

interface SummaryEventMetricInput {
  eventId: string;
  startDate: string;
  activityType: string;
  eventStatValue: number;
}

const ISO_DATE_SEGMENT_LENGTH = 10;
const ISO_HOUR_SEGMENT_LENGTH = 13;

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

function resolveEventStatValue(event: EventInterface, dataType: string): number | null {
  const stat = event.getStat?.(dataType) as { getValue?: () => unknown } | null | undefined;
  const rawValue = stat?.getValue?.();
  return typeof rawValue === 'number' && Number.isFinite(rawValue)
    ? rawValue
    : null;
}

function resolveEventActivityTypeLabel(event: EventInterface): string {
  const activityTypeKey = resolveAggregationCategoryKey(
    event,
    ChartDataCategoryTypes.ActivityType,
    TimeIntervals.Daily,
  );
  if (typeof activityTypeKey === 'string' && activityTypeKey.trim()) {
    return activityTypeKey;
  }

  return 'Unknown activity';
}

function resolveSummaryEventMetricInput(
  event: EventInterface,
  dataType: string,
): SummaryEventMetricInput | null {
  const eventId = event.getID?.();
  const eventStartDate = event.startDate instanceof Date
    ? event.startDate
    : null;
  const eventStatValue = resolveEventStatValue(event, dataType);
  if (!eventId || !eventStartDate || !Number.isFinite(eventStartDate.getTime()) || eventStatValue === null) {
    return null;
  }

  return {
    eventId,
    startDate: eventStartDate.toISOString(),
    activityType: resolveEventActivityTypeLabel(event),
    eventStatValue,
  };
}

function padNumber(value: number): string {
  return `${value}`.padStart(2, '0');
}

function buildDateBucketLabel(date: Date, resolvedTimeInterval: TimeIntervals): string | null {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();

  switch (resolvedTimeInterval) {
    case TimeIntervals.Yearly:
      return `${year}`;
    case TimeIntervals.Monthly:
      return `${year}-${padNumber(month)}`;
    case TimeIntervals.Daily:
      return `${year}-${padNumber(month)}-${padNumber(day)}`;
    case TimeIntervals.Hourly:
      return `${year}-${padNumber(month)}-${padNumber(day)}T${padNumber(hours)}`;
    case TimeIntervals.Quarterly:
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    case TimeIntervals.Semesterly:
      return `${year}-S${month <= 6 ? 1 : 2}`;
    default:
      return null;
  }
}

function parseDateBucketLabelToTimestamp(
  bucketKey: string,
  resolvedTimeInterval: TimeIntervals,
): number | null {
  const normalizedBucketKey = bucketKey.trim();
  if (!normalizedBucketKey) {
    return null;
  }

  if (resolvedTimeInterval === TimeIntervals.Yearly) {
    const yearlyMatch = normalizedBucketKey.match(/^(\d{4})$/);
    if (!yearlyMatch) {
      return null;
    }
    return new Date(Number(yearlyMatch[1]), 0, 1).getTime();
  }

  if (resolvedTimeInterval === TimeIntervals.Monthly) {
    const monthlyMatch = normalizedBucketKey.match(/^(\d{4})-(\d{1,2})$/);
    if (!monthlyMatch) {
      return null;
    }
    const month = Number(monthlyMatch[2]);
    if (month < 1 || month > 12) {
      return null;
    }
    return new Date(Number(monthlyMatch[1]), month - 1, 1).getTime();
  }

  if (resolvedTimeInterval === TimeIntervals.Daily) {
    const dailyMatch = normalizedBucketKey.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!dailyMatch) {
      return null;
    }
    const month = Number(dailyMatch[2]);
    const day = Number(dailyMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    return new Date(Number(dailyMatch[1]), month - 1, day).getTime();
  }

  if (resolvedTimeInterval === TimeIntervals.Hourly) {
    const hourlyMatch = normalizedBucketKey.match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2})$/);
    if (!hourlyMatch) {
      return null;
    }
    const month = Number(hourlyMatch[2]);
    const day = Number(hourlyMatch[3]);
    const hour = Number(hourlyMatch[4]);
    if (
      month < 1
      || month > 12
      || day < 1
      || day > 31
      || hour < 0
      || hour > 23
    ) {
      return null;
    }
    return new Date(Number(hourlyMatch[1]), month - 1, day, hour, 0, 0, 0).getTime();
  }

  return null;
}

function resolveEventBucketLookupKeys(
  event: EventInterface,
  categoryType: ChartDataCategoryTypes,
  resolvedTimeInterval: TimeIntervals,
): string[] {
  const resolvedBucketKey = resolveAggregationCategoryKey(event, categoryType, resolvedTimeInterval);
  const keyCandidates = new Set<string>([`${resolvedBucketKey}`]);

  if (categoryType !== ChartDataCategoryTypes.DateType || !(event.startDate instanceof Date)) {
    return Array.from(keyCandidates);
  }

  const dateBucketLabel = buildDateBucketLabel(event.startDate, resolvedTimeInterval);
  if (dateBucketLabel) {
    keyCandidates.add(dateBucketLabel);
  }

  const isoDate = event.startDate.toISOString();
  keyCandidates.add(isoDate.slice(0, ISO_DATE_SEGMENT_LENGTH));
  keyCandidates.add(isoDate.slice(0, ISO_HOUR_SEGMENT_LENGTH));

  return Array.from(keyCandidates);
}

function buildSummaryEventsByBucket(
  query: Extract<NormalizedInsightQuery, { resultKind: 'aggregate' }>,
  aggregation: SummaryAggregationInput,
  matchedEventsWithRequestedStat: readonly EventInterface[],
): Map<string, SummaryEventMetricInput[]> {
  const bucketLookup = aggregation.buckets.reduce((lookup, bucket) => {
    const canonicalBucketKey = `${bucket.bucketKey}`;
    lookup.set(canonicalBucketKey, canonicalBucketKey);
    if (typeof bucket.time === 'number' && Number.isFinite(bucket.time)) {
      lookup.set(`${bucket.time}`, canonicalBucketKey);
    }
    if (query.categoryType === ChartDataCategoryTypes.DateType) {
      const parsedBucketTimestamp = typeof bucket.bucketKey === 'string'
        ? parseDateBucketLabelToTimestamp(bucket.bucketKey, aggregation.resolvedTimeInterval)
        : null;
      if (typeof parsedBucketTimestamp === 'number' && Number.isFinite(parsedBucketTimestamp)) {
        lookup.set(`${parsedBucketTimestamp}`, canonicalBucketKey);
      }
    }
    return lookup;
  }, new Map<string, string>());

  return matchedEventsWithRequestedStat.reduce((bucketMap, event) => {
    const eventMetricInput = resolveSummaryEventMetricInput(event, query.dataType);
    if (!eventMetricInput) {
      return bucketMap;
    }

    const normalizedBucketKey = resolveEventBucketLookupKeys(
      event,
      query.categoryType,
      aggregation.resolvedTimeInterval,
    ).reduce<string | null>((resolvedCanonicalKey, candidateKey) => {
      if (resolvedCanonicalKey) {
        return resolvedCanonicalKey;
      }
      return bucketLookup.get(candidateKey) ?? null;
    }, null);
    if (!normalizedBucketKey) {
      return bucketMap;
    }

    const bucketEvents = bucketMap.get(normalizedBucketKey) ?? [];
    bucketEvents.push(eventMetricInput);
    bucketMap.set(normalizedBucketKey, bucketEvents);
    return bucketMap;
  }, new Map<string, SummaryEventMetricInput[]>());
}

function compareSummaryEventContributors(
  left: AiInsightSummaryPeriodDeltaEventContributor,
  right: AiInsightSummaryPeriodDeltaEventContributor,
): number {
  const byMagnitude = Math.abs(right.deltaContributionValue) - Math.abs(left.deltaContributionValue);
  if (byMagnitude !== 0) {
    return byMagnitude;
  }

  const byDate = new Date(right.startDate).getTime() - new Date(left.startDate).getTime();
  if (byDate !== 0) {
    return byDate;
  }

  return left.eventId.localeCompare(right.eventId);
}

function pickExtremumEvent(
  events: readonly SummaryEventMetricInput[],
  valueType: ChartDataValueTypes.Minimum | ChartDataValueTypes.Maximum,
): SummaryEventMetricInput | null {
  if (!events.length) {
    return null;
  }

  return [...events].sort((left, right) => {
    const valueDelta = valueType === ChartDataValueTypes.Maximum
      ? right.eventStatValue - left.eventStatValue
      : left.eventStatValue - right.eventStatValue;
    if (valueDelta !== 0) {
      return valueDelta;
    }

    const byDate = new Date(right.startDate).getTime() - new Date(left.startDate).getTime();
    if (byDate !== 0) {
      return byDate;
    }

    return left.eventId.localeCompare(right.eventId);
  })[0] ?? null;
}

function toPeriodDeltaEventContributor(
  event: SummaryEventMetricInput,
  deltaContributionValue: number,
): AiInsightSummaryPeriodDeltaEventContributor | null {
  if (!Number.isFinite(deltaContributionValue) || deltaContributionValue === 0) {
    return null;
  }

  return {
    eventId: event.eventId,
    startDate: event.startDate,
    activityType: event.activityType,
    eventStatValue: event.eventStatValue,
    deltaContributionValue,
    direction: resolveDeltaDirection(deltaContributionValue),
  };
}

function buildPeriodDeltaEventContributors(
  valueType: ChartDataValueTypes,
  fromEvents: readonly SummaryEventMetricInput[],
  toEvents: readonly SummaryEventMetricInput[],
): AiInsightSummaryPeriodDeltaEventContributor[] {
  const appendContributors = (
    target: AiInsightSummaryPeriodDeltaEventContributor[],
    events: readonly SummaryEventMetricInput[],
    multiplier: number,
  ): void => {
    events.forEach((event) => {
      const contributor = toPeriodDeltaEventContributor(event, event.eventStatValue * multiplier);
      if (contributor) {
        target.push(contributor);
      }
    });
  };

  const eventContributors: AiInsightSummaryPeriodDeltaEventContributor[] = [];
  switch (valueType) {
    case ChartDataValueTypes.Total:
      appendContributors(eventContributors, fromEvents, -1);
      appendContributors(eventContributors, toEvents, 1);
      break;
    case ChartDataValueTypes.Average: {
      const fromWeight = fromEvents.length > 0 ? (-1 / fromEvents.length) : 0;
      const toWeight = toEvents.length > 0 ? (1 / toEvents.length) : 0;
      if (fromWeight !== 0) {
        appendContributors(eventContributors, fromEvents, fromWeight);
      }
      if (toWeight !== 0) {
        appendContributors(eventContributors, toEvents, toWeight);
      }
      break;
    }
    case ChartDataValueTypes.Maximum:
    case ChartDataValueTypes.Minimum: {
      const fromExtremumEvent = pickExtremumEvent(fromEvents, valueType);
      const toExtremumEvent = pickExtremumEvent(toEvents, valueType);
      if (fromExtremumEvent) {
        const contributor = toPeriodDeltaEventContributor(fromExtremumEvent, -fromExtremumEvent.eventStatValue);
        if (contributor) {
          eventContributors.push(contributor);
        }
      }
      if (toExtremumEvent) {
        const contributor = toPeriodDeltaEventContributor(toExtremumEvent, toExtremumEvent.eventStatValue);
        if (contributor) {
          eventContributors.push(contributor);
        }
      }
      break;
    }
    default:
      return [];
  }

  return eventContributors
    .sort(compareSummaryEventContributors)
    .slice(0, AI_INSIGHTS_COMPARE_EVENT_CONTRIBUTORS_MAX);
}

function buildPeriodDeltas(
  query: NormalizedInsightQuery,
  aggregation: SummaryAggregationInput,
  matchedEventsWithRequestedStat: readonly EventInterface[],
): AiInsightSummary['periodDeltas'] {
  if (
    query.resultKind !== 'aggregate'
    || query.categoryType !== ChartDataCategoryTypes.DateType
    || query.periodMode !== 'compare'
    || aggregation.buckets.length < 2
  ) {
    return null;
  }

  const eventsByBucket = buildSummaryEventsByBucket(
    query,
    aggregation,
    matchedEventsWithRequestedStat,
  );

  const periodDeltas = aggregation.buckets.slice(1).map((bucket, index) => {
    const previousBucket = aggregation.buckets[index];
    const deltaAggregateValue = bucket.aggregateValue - previousBucket.aggregateValue;
    const fromEvents = eventsByBucket.get(`${previousBucket.bucketKey}`) ?? [];
    const toEvents = eventsByBucket.get(`${bucket.bucketKey}`) ?? [];
    const eventContributors = buildPeriodDeltaEventContributors(
      query.valueType,
      fromEvents,
      toEvents,
    );

    return {
      fromBucket: toSummaryBucket(previousBucket),
      toBucket: toSummaryBucket(bucket),
      deltaAggregateValue,
      direction: resolveDeltaDirection(deltaAggregateValue),
      contributors: buildPeriodDeltaContributors(previousBucket, bucket),
      ...(eventContributors.length ? { eventContributors } : {}),
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
    anomalyCallouts: null,
  };
}

export function buildInsightSummary(
  query: NormalizedInsightQuery,
  aggregation: SummaryAggregationInput,
  matchedEventCount: number,
  matchedActivityTypeCounts: Array<{ activityType: string; eventCount: number }>,
  matchedEventsWithRequestedStat: readonly EventInterface[] = [],
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
    periodDeltas: isOverallMultiMetric ? null : buildPeriodDeltas(query, aggregation, matchedEventsWithRequestedStat),
    anomalyCallouts: isOverallMultiMetric
      ? null
      : buildSummaryAnomalyCallouts({
        query,
        matchedEventCount,
        buckets: aggregation.buckets,
      }),
  };
}
