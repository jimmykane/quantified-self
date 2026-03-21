import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  EventInterface,
  TimeIntervals,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightSummaryBucket,
  AiInsightsAggregateOkResponse,
  AiInsightsEmptyResponse,
  AiInsightsEventLookupOkResponse,
  AiInsightsLatestEventOkResponse,
  AiInsightsMultiMetricAggregateMetricResult,
  AiInsightsOkResponse,
  AiInsightsQuotaStatus,
  NormalizedInsightDateRange,
} from '@shared/ai-insights.types';
import { formatAiInsightsSelectedDateRanges } from '@shared/ai-insights-date-selection';
import { resolveMetricSemantics, resolveMetricSummarySemantics } from '@shared/metric-semantics';
import { formatUnitAwareDataValue } from '@shared/unit-aware-display';
import { formatDashboardBucketDateByInterval } from '../../helpers/dashboard-chart-data.helper';

export type AggregateSummarySource =
  | AiInsightsAggregateOkResponse
  | AiInsightsMultiMetricAggregateMetricResult;

export type AggregateRankedEventResponse = AiInsightsAggregateOkResponse & {
  eventRanking: NonNullable<AiInsightsAggregateOkResponse['eventRanking']>;
};

export type RankedEventResponse =
  | AiInsightsEventLookupOkResponse
  | AiInsightsLatestEventOkResponse
  | AggregateRankedEventResponse;

export interface InsightSummaryCard {
  label: string;
  value?: string;
  meta?: string;
  detailRows?: Array<{
    label: string;
    value: string;
  }>;
  metaFooter?: string;
  helpText?: string;
}

export interface ResultNote {
  icon: 'info' | 'history';
  message: string;
}

export interface MultiMetricSection {
  metricKey: string;
  title: string;
  summaryCards: InsightSummaryCard[];
  isEmpty: boolean;
  emptyState: string;
}

export interface EventLookupResolvedEvent {
  eventId: string;
  event: EventInterface | null;
}

export interface EventLookupDisplayItem {
  eventId: string;
  value: string;
  date: string;
  activityLabel: string | null;
  isAvailable: boolean;
}

export function resolveAggregationLabel(valueType: ChartDataValueTypes): string {
  switch (valueType) {
    case ChartDataValueTypes.Average:
      return 'Average';
    case ChartDataValueTypes.Maximum:
      return 'Maximum';
    case ChartDataValueTypes.Minimum:
      return 'Minimum';
    case ChartDataValueTypes.Total:
      return 'Total';
    default:
      return 'Aggregation';
  }
}

function resolveSummaryCardLabel(
  semanticsLabel: string,
  valueType: ChartDataValueTypes,
  labelKind: 'highest' | 'lowest' | 'latest',
): string {
  const normalizedSemanticsLabel = semanticsLabel.toLowerCase();
  if (normalizedSemanticsLabel.includes('fastest') || normalizedSemanticsLabel.includes('slowest')) {
    return semanticsLabel;
  }

  const suffix = (() => {
    switch (valueType) {
      case ChartDataValueTypes.Average:
        return 'average';
      case ChartDataValueTypes.Maximum:
        return 'max';
      case ChartDataValueTypes.Minimum:
        return 'min';
      case ChartDataValueTypes.Total:
        return 'total';
      default:
        return 'value';
    }
  })();

  if (labelKind === 'highest') {
    return `Highest ${suffix}`;
  }

  if (labelKind === 'lowest') {
    return `Lowest ${suffix}`;
  }

  return `Latest ${suffix}`;
}

export function resolveShortMetricLabel(
  metricLabel: string,
  valueType: ChartDataValueTypes,
): string {
  const trimmedLabel = metricLabel.trim();
  if (!trimmedLabel) {
    return '';
  }

  const prefixCandidates = (() => {
    switch (valueType) {
      case ChartDataValueTypes.Average:
        return ['Average ', 'Avg '];
      case ChartDataValueTypes.Maximum:
        return ['Maximum ', 'Max '];
      case ChartDataValueTypes.Minimum:
        return ['Minimum ', 'Min '];
      case ChartDataValueTypes.Total:
        return ['Total '];
      default:
        return [];
    }
  })();

  const normalizedLabel = trimmedLabel.toLowerCase();
  for (const prefix of prefixCandidates) {
    const normalizedPrefix = prefix.toLowerCase();
    if (normalizedLabel.startsWith(normalizedPrefix) && trimmedLabel.length > prefix.length) {
      const stripped = trimmedLabel.slice(prefix.length).trim();
      return stripped
        ? `${stripped.slice(0, 1).toUpperCase()}${stripped.slice(1)}`
        : '';
    }
  }

  return `${trimmedLabel.slice(0, 1).toUpperCase()}${trimmedLabel.slice(1)}`;
}

export function getClientTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function formatDateRangeNote(dateRange: NormalizedInsightDateRange): string | null {
  if (dateRange.kind !== 'bounded' || dateRange.source !== 'default') {
    return null;
  }

  return 'Used the current year to date because no time range was found in your prompt.';
}

export function formatDateSelectionSummary(
  response: AiInsightsOkResponse | AiInsightsEmptyResponse,
  locale: string,
): string {
  const label = formatAiInsightsSelectedDateRanges(response.query, locale);
  return label
    ? `${label.slice(0, 1).toUpperCase()}${label.slice(1)}`
    : label;
}

export function formatSavedInsightDate(
  value: string | null,
  locale: string,
): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatQuotaStatusText(
  quotaStatus: AiInsightsQuotaStatus,
  locale: string,
): string {
  const numberFormatter = new Intl.NumberFormat(locale || undefined);
  const remainingCount = numberFormatter.format(quotaStatus.remainingCount);
  const limit = numberFormatter.format(quotaStatus.limit);

  if (!quotaStatus.isEligible) {
    return `${remainingCount} of ${limit} left • Basic or Pro required`;
  }

  if (quotaStatus.resetMode === 'date' && quotaStatus.periodEnd) {
    const resetDate = formatSavedInsightDate(quotaStatus.periodEnd, locale);
    if (resetDate) {
      return `${remainingCount} of ${limit} left • resets ${resetDate}`;
    }
  }

  return `${remainingCount} of ${limit} left • resets after next successful payment`;
}

export function resolveQuotaBlockedMessage(quotaStatus: AiInsightsQuotaStatus): string {
  if (!quotaStatus.isEligible) {
    return 'AI Insights is available to Basic and Pro members.';
  }

  return 'AI Insights limit reached for this billing period.';
}

function formatBucketMeta(
  response: AggregateSummarySource,
  bucket: AiInsightSummaryBucket,
  locale?: string,
): string | null {
  if (
    response.query.categoryType === ChartDataCategoryTypes.DateType
    && Number.isFinite(bucket.time)
  ) {
    return formatDashboardBucketDateByInterval(
      bucket.time as number,
      response.aggregation.resolvedTimeInterval,
      locale,
      response.query.dateRange.timezone,
    );
  }

  return `${bucket.bucketKey}`;
}

function formatSummaryValue(
  dataType: string,
  value: number | null,
  unitSettings: UserUnitSettingsInterface,
): string | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  return formatUnitAwareDataValue(dataType, value, unitSettings, {
    stripRepeatedUnit: true,
  });
}

function buildActivityMixDetails(
  response: AggregateSummarySource,
  locale: string | undefined,
): Pick<InsightSummaryCard, 'detailRows' | 'metaFooter'> {
  const activityMix = response.summary.activityMix;
  if (!activityMix?.topActivityTypes.length) {
    return {};
  }

  const shouldShowMix = response.query.activityTypeGroups.length > 0
    || response.query.activityTypes.length !== 1
    || activityMix.topActivityTypes.length > 1;
  if (!shouldShowMix) {
    return {};
  }

  const numberFormat = new Intl.NumberFormat(locale || undefined);
  return {
    detailRows: activityMix.topActivityTypes.map(entry => ({
      label: entry.activityType,
      value: numberFormat.format(entry.eventCount),
    })),
    metaFooter: activityMix.remainingActivityTypeCount > 0
      ? `+${numberFormat.format(activityMix.remainingActivityTypeCount)} more`
      : undefined,
  };
}

function resolveCoveragePeriodLabel(timeInterval: TimeIntervals, count: number): string {
  const singularLabel = (() => {
    switch (timeInterval) {
      case TimeIntervals.Hourly:
        return 'hour';
      case TimeIntervals.Daily:
        return 'day';
      case TimeIntervals.Weekly:
      case TimeIntervals.BiWeekly:
        return 'week';
      case TimeIntervals.Monthly:
        return 'month';
      case TimeIntervals.Quarterly:
        return 'quarter';
      case TimeIntervals.Semesterly:
        return 'semester';
      case TimeIntervals.Yearly:
        return 'year';
      default:
        return 'period';
    }
  })();

  return count === 1 ? singularLabel : `${singularLabel}s`;
}

function formatCoverageValue(response: AggregateSummarySource): string | null {
  const coverage = response.summary.bucketCoverage;
  if (!coverage) {
    return null;
  }

  const periodLabel = resolveCoveragePeriodLabel(
    response.aggregation.resolvedTimeInterval,
    coverage.totalBucketCount,
  );
  return `${coverage.nonEmptyBucketCount} of ${coverage.totalBucketCount} ${periodLabel}`;
}

function resolveMostActivitiesBucket(
  response: AggregateSummarySource,
): {
  bucketKey: string | number;
  totalCount: number;
} | null {
  if (
    response.query.categoryType === ChartDataCategoryTypes.DateType
    || response.aggregation.buckets.length < 2
  ) {
    return null;
  }

  const bucket = [...response.aggregation.buckets]
    .filter((entry) => Number.isFinite(entry.totalCount) && entry.totalCount > 0)
    .sort((left, right) => (
      right.totalCount - left.totalCount
      || `${left.bucketKey}`.localeCompare(`${right.bucketKey}`)
    ))[0] ?? null;

  if (!bucket) {
    return null;
  }

  return {
    bucketKey: bucket.bucketKey,
    totalCount: bucket.totalCount,
  };
}

function formatTrendValue(
  response: AggregateSummarySource,
  unitSettings: UserUnitSettingsInterface,
): string | null {
  const trend = response.summary.trend;
  if (!trend || !Number.isFinite(trend.deltaAggregateValue)) {
    return null;
  }

  if (trend.deltaAggregateValue === 0) {
    return 'No change';
  }

  const absoluteDisplayValue = formatSummaryValue(
    response.query.dataType,
    Math.abs(trend.deltaAggregateValue),
    unitSettings,
  );
  if (!absoluteDisplayValue) {
    return null;
  }

  const semantics = resolveMetricSemantics(response.query.dataType);
  if (semantics.direction === 'inverse') {
    return `${absoluteDisplayValue} ${trend.deltaAggregateValue < 0 ? 'faster' : 'slower'}`;
  }

  return `${trend.deltaAggregateValue > 0 ? '+' : '-'}${absoluteDisplayValue}`;
}

export function buildAggregateSummaryCards(
  response: AggregateSummarySource,
  unitSettings: UserUnitSettingsInterface,
  locale: string,
): InsightSummaryCard[] {
  const summarySemantics = resolveMetricSummarySemantics(
    response.query.dataType,
    response.query.categoryType,
  );
  const cards: InsightSummaryCard[] = [
    {
      label: 'Activities',
      value: new Intl.NumberFormat(locale || undefined).format(response.summary.matchedEventCount),
      ...buildActivityMixDetails(response, locale),
    },
  ];

  const overallValue = formatSummaryValue(
    response.query.dataType,
    response.summary.overallAggregateValue,
    unitSettings,
  );
  if (overallValue) {
    cards.unshift({
      label: 'Overall',
      value: overallValue,
    });
  }

  if (response.summary.peakBucket) {
    const peakValue = formatSummaryValue(
      response.query.dataType,
      response.summary.peakBucket.aggregateValue,
      unitSettings,
    );
    if (peakValue) {
      cards.push({
        label: resolveSummaryCardLabel(summarySemantics.highestLabel, response.query.valueType, 'highest'),
        value: peakValue,
        meta: formatBucketMeta(response, response.summary.peakBucket, locale) || undefined,
        helpText: summarySemantics.highestHelpText,
      });
    }
  }

  if (response.summary.lowestBucket) {
    const lowestValue = formatSummaryValue(
      response.query.dataType,
      response.summary.lowestBucket.aggregateValue,
      unitSettings,
    );
    if (lowestValue) {
      cards.push({
        label: resolveSummaryCardLabel(summarySemantics.lowestLabel, response.query.valueType, 'lowest'),
        value: lowestValue,
        meta: formatBucketMeta(response, response.summary.lowestBucket, locale) || undefined,
        helpText: summarySemantics.lowestHelpText,
      });
    }
  }

  if (
    response.query.categoryType === ChartDataCategoryTypes.DateType
    && response.summary.latestBucket
  ) {
    const latestValue = formatSummaryValue(
      response.query.dataType,
      response.summary.latestBucket.aggregateValue,
      unitSettings,
    );
    if (latestValue) {
      cards.push({
        label: resolveSummaryCardLabel(summarySemantics.latestLabel, response.query.valueType, 'latest'),
        value: latestValue,
        meta: formatBucketMeta(response, response.summary.latestBucket, locale) || undefined,
        helpText: summarySemantics.latestHelpText,
      });
    }
  }

  const mostActivitiesBucket = resolveMostActivitiesBucket(response);
  if (mostActivitiesBucket) {
    cards.push({
      label: 'Most activities',
      value: new Intl.NumberFormat(locale || undefined).format(mostActivitiesBucket.totalCount),
      meta: `${mostActivitiesBucket.bucketKey}`,
      helpText: 'The group with the largest number of matching activities in this result.',
    });
  }

  const coverageValue = formatCoverageValue(response);
  if (coverageValue) {
    cards.push({
      label: 'Coverage',
      value: coverageValue,
      helpText: 'How many chart periods in the requested range contained matching data.',
    });
  }

  const trendValue = formatTrendValue(response, unitSettings);
  if (trendValue && response.summary.trend) {
    cards.push({
      label: 'Trend',
      value: trendValue,
      meta: formatBucketMeta(response, response.summary.trend.previousBucket, locale)
        ? `vs ${formatBucketMeta(response, response.summary.trend.previousBucket, locale)}`
        : undefined,
      helpText: 'Difference between the latest period with data and the previous period with data.',
    });
  }

  return cards;
}

export function resolveEventLookupStatValue(
  event: EventInterface | null,
  dataType: string,
): number | null {
  const stat = event?.getStat?.(dataType);
  const rawValue = stat && 'getValue' in stat && typeof stat.getValue === 'function'
    ? stat.getValue()
    : null;
  return typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;
}

export function formatEventLookupEventDate(
  event: EventInterface | null,
  locale: string,
  timeZone: string,
): string | null {
  const startDate = event?.startDate;
  if (!(startDate instanceof Date) || !Number.isFinite(startDate.getTime())) {
    return null;
  }

  return startDate.toLocaleDateString(locale || undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  });
}

export function formatEventLookupActivityLabel(event: EventInterface | null): string | null {
  const activityTypes = Array.isArray(event?.getActivityTypesAsArray?.())
    ? Array.from(new Set(event.getActivityTypesAsArray().filter((value): value is string => (
      typeof value === 'string' && value.trim().length > 0
    ))))
    : [];

  if (!activityTypes.length) {
    return null;
  }

  if (activityTypes.length <= 2) {
    return activityTypes.join(' • ');
  }

  return `${activityTypes.slice(0, 2).join(' • ')} • +${activityTypes.length - 2} more`;
}

export function buildMergedMultiMetricSummaryCards(
  sections: MultiMetricSection[],
): InsightSummaryCard[] {
  const orderedLabels: string[] = [];
  const cardsByLabel = new Map<string, InsightSummaryCard>();

  for (const section of sections) {
    if (section.isEmpty) {
      continue;
    }

    for (const summaryCard of section.summaryCards) {
      const primaryValue = summaryCard.value?.trim() ?? '';
      const metaValue = summaryCard.meta?.trim() ?? '';
      const mergedValue = primaryValue && metaValue
        ? `${primaryValue} • ${metaValue}`
        : (primaryValue || metaValue);
      if (!mergedValue) {
        continue;
      }

      let mergedCard = cardsByLabel.get(summaryCard.label);
      if (!mergedCard) {
        mergedCard = {
          label: summaryCard.label,
          helpText: summaryCard.helpText,
          detailRows: [],
        };
        cardsByLabel.set(summaryCard.label, mergedCard);
        orderedLabels.push(summaryCard.label);
      }

      if (!mergedCard.helpText && summaryCard.helpText) {
        mergedCard.helpText = summaryCard.helpText;
      }

      mergedCard.detailRows = [
        ...(mergedCard.detailRows ?? []),
        {
          label: section.title,
          value: mergedValue,
        },
      ];
    }
  }

  return orderedLabels
    .map((label) => cardsByLabel.get(label))
    .filter((card): card is InsightSummaryCard => !!card && !!card.detailRows?.length);
}

export function resolveRankedEventIds(response: RankedEventResponse): string[] {
  return response.resultKind === 'event_lookup'
    ? response.eventLookup.topEventIds.slice(0, 10)
    : response.resultKind === 'latest_event'
      ? [response.latestEvent.eventId]
    : response.eventRanking.topEventIds.slice(0, 10);
}

export function resolveRankedEventMatchedCount(response: RankedEventResponse): number {
  return response.resultKind === 'event_lookup'
    ? response.eventLookup.matchedEventCount
    : response.resultKind === 'latest_event'
      ? response.latestEvent.matchedEventCount
    : response.eventRanking.matchedEventCount;
}

export function hasAggregateEventRanking(
  response: AiInsightsAggregateOkResponse | null,
): response is AggregateRankedEventResponse {
  return !!response?.eventRanking?.primaryEventId
    && Array.isArray(response.eventRanking.topEventIds)
    && response.eventRanking.topEventIds.length > 0;
}
