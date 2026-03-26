import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  EventInterface,
  TimeIntervals,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightsDigest,
  AiInsightAnomalyKind,
  AiInsightConfidenceTier,
  AiInsightEvidenceRef,
  AiInsightStatementChip,
  AiInsightSummaryAnomalyCallout,
  AiInsightSummaryBucket,
  AiInsightsAggregateOkResponse,
  AiInsightsEmptyResponse,
  AiInsightsEventLookupOkResponse,
  AiInsightsLatestEventOkResponse,
  AiInsightsMultiMetricAggregateOkResponse,
  AiInsightsMultiMetricAggregateMetricResult,
  AiInsightsOkResponse,
  AiInsightsQuotaStatus,
  NormalizedInsightDateRange,
} from '@shared/ai-insights.types';
import { formatAiInsightsSelectedDateRanges } from '@shared/ai-insights-date-selection';
import { AI_INSIGHTS_COMPARE_EVENT_CONTRIBUTORS_MAX } from '@shared/ai-insights-compare.constants';
import { AI_INSIGHTS_TOP_RESULTS_MAX } from '@shared/ai-insights-ranking.constants';
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

export interface AggregateCompareEvidenceItem {
  eventId: string;
  dateLabel: string;
  activityLabel: string;
  contributionLabel: string;
  contributionShareLabel: string | null;
  direction: 'upward' | 'downward';
}

export interface AggregateCompareEvidenceGroup {
  heading: string;
  fromLabel: string;
  toLabel: string;
  impactSummary: string | null;
  downwardContributors: AggregateCompareEvidenceItem[];
  upwardContributors: AggregateCompareEvidenceItem[];
}

export interface StatementChipDisplay {
  statementId: string;
  chipKind: 'confidence' | 'evidence' | 'kind';
  label: string;
  confidenceTier?: AiInsightConfidenceTier;
}

export interface AnomalyCalloutDisplay {
  id: string;
  snippet: string;
  chips: StatementChipDisplay[];
  evidenceSummary: string | null;
}

export interface MultiMetricAnomalyCalloutSection {
  metricKey: string;
  metricTitle: string;
  callouts: AnomalyCalloutDisplay[];
}

export interface DigestMetricDisplay {
  label: string;
  value: string | null;
}

export interface DigestPeriodDisplay {
  label: string;
  hasData: boolean;
  metrics: DigestMetricDisplay[];
}

function resolveAnomalyKindLabel(kind: AiInsightAnomalyKind): string {
  switch (kind) {
    case 'spike':
      return 'Spike';
    case 'drop':
      return 'Drop';
    case 'activity_mix_shift':
      return 'Activity mix shift';
    default:
      return 'Anomaly';
  }
}

function formatEvidenceSummary(
  evidenceRefs: AiInsightEvidenceRef[] | null | undefined,
): string | null {
  if (!evidenceRefs?.length) {
    return null;
  }

  return evidenceRefs
    .slice(0, 3)
    .map(evidenceRef => evidenceRef.label)
    .join(' • ');
}

function toStatementChipDisplay(chip: AiInsightStatementChip): StatementChipDisplay {
  return {
    statementId: chip.statementId,
    chipKind: chip.chipType === 'confidence' ? 'confidence' : 'evidence',
    label: chip.label,
    ...(chip.chipType === 'confidence'
      ? { confidenceTier: chip.confidenceTier }
      : {}),
  };
}

function buildAnomalyCalloutDisplays(
  anomalyCallouts: AiInsightSummaryAnomalyCallout[] | null | undefined,
  statementChips: AiInsightStatementChip[] | null | undefined,
): AnomalyCalloutDisplay[] {
  if (!anomalyCallouts?.length) {
    return [];
  }

  const chips = statementChips ?? [];

  return anomalyCallouts.map((callout) => {
    const linkedChips = chips
      .filter(chip => chip.statementId === callout.statementId)
      .map(toStatementChipDisplay);
    const hasConfidenceChip = linkedChips.some(chip => chip.chipKind === 'confidence');
    const hasEvidenceChip = linkedChips.some(chip => chip.chipKind === 'evidence');

    const calloutChips: StatementChipDisplay[] = [
      {
        statementId: callout.statementId,
        chipKind: 'kind',
        label: resolveAnomalyKindLabel(callout.kind),
      },
      ...(hasConfidenceChip
        ? []
        : [{
          statementId: callout.statementId,
          chipKind: 'confidence' as const,
          label: `${callout.confidenceTier[0]?.toUpperCase() || ''}${callout.confidenceTier.slice(1)} confidence`,
          confidenceTier: callout.confidenceTier,
        }]),
      ...(hasEvidenceChip
        ? []
        : [{
          statementId: callout.statementId,
          chipKind: 'evidence' as const,
          label: 'Evidence linked',
        }]),
      ...linkedChips,
    ];

    return {
      id: callout.id,
      snippet: callout.snippet,
      chips: calloutChips,
      evidenceSummary: formatEvidenceSummary(callout.evidenceRefs),
    };
  });
}

export function buildStatementChipDisplays(
  response: AiInsightsOkResponse | null | undefined,
): StatementChipDisplay[] {
  if (!response?.statementChips?.length) {
    return [];
  }

  const narrativeStatementId = (() => {
    if (response.resultKind === 'aggregate') {
      return 'aggregate:narrative';
    }
    if (response.resultKind === 'event_lookup') {
      return 'event_lookup:narrative';
    }
    if (response.resultKind === 'latest_event') {
      return 'latest_event:narrative';
    }
    if (response.resultKind === 'multi_metric_aggregate') {
      return 'multi_metric:narrative';
    }
    return 'power_curve:narrative';
  })();

  const seenDisplayKeys = new Set<string>();
  return response.statementChips
    .filter(chip => chip.statementId === narrativeStatementId)
    .map(toStatementChipDisplay)
    .filter((displayChip) => {
      const displayKey = `${displayChip.chipKind}:${displayChip.label}:${displayChip.confidenceTier ?? ''}`;
      if (seenDisplayKeys.has(displayKey)) {
        return false;
      }
      seenDisplayKeys.add(displayKey);
      return true;
    });
}

export function buildAggregateAnomalyCallouts(
  response: AiInsightsAggregateOkResponse | null | undefined,
): AnomalyCalloutDisplay[] {
  return buildAnomalyCalloutDisplays(
    response?.summary.anomalyCallouts,
    response?.statementChips,
  );
}

export function buildMultiMetricAnomalyCalloutSections(
  response: AiInsightsMultiMetricAggregateOkResponse | null | undefined,
): MultiMetricAnomalyCalloutSection[] {
  if (!response) {
    return [];
  }

  return response.metricResults
    .map((metricResult) => ({
      metricKey: metricResult.metricKey,
      metricTitle: resolveShortMetricLabel(metricResult.metricLabel, metricResult.query.valueType) || metricResult.metricLabel,
      callouts: buildAnomalyCalloutDisplays(
        metricResult.summary.anomalyCallouts,
        response.statementChips,
      ),
    }))
    .filter(section => section.callouts.length > 0);
}

export function formatAiInsightsNarrativeForDisplay(
  narrative: string | null | undefined,
): string {
  return `${narrative ?? ''}`.trim();
}

export function formatDeterministicCompareSummaryForDisplay(
  summary: string | null | undefined,
): string {
  return `${summary ?? ''}`
    .replace(/\s*Event evidence is linked below\.?\s*$/i, '')
    .trim();
}

function formatCompareEvidenceEventDate(
  startDate: string,
  locale: string,
  timeZone: string,
): string {
  const date = new Date(startDate);
  if (!Number.isFinite(date.getTime())) {
    return startDate;
  }

  return date.toLocaleDateString(locale || undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  });
}

function formatDeltaContributionLabel(
  response: AiInsightsAggregateOkResponse,
  deltaContributionValue: number,
  unitSettings?: UserUnitSettingsInterface,
): string {
  const absoluteValue = Math.abs(deltaContributionValue);
  const formattedValue = formatUnitAwareDataValue(
    response.query.dataType,
    absoluteValue,
    unitSettings,
    { stripRepeatedUnit: true },
  ) ?? absoluteValue.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

  return `${deltaContributionValue >= 0 ? '+' : '-'}${formattedValue}`;
}

export function buildAggregateCompareEvidenceGroups(
  response: AiInsightsAggregateOkResponse | null | undefined,
  unitSettings?: UserUnitSettingsInterface,
  locale = 'en-US',
): AggregateCompareEvidenceGroup[] {
  if (!response || response.query.periodMode !== 'compare') {
    return [];
  }

  const percentFormatter = new Intl.NumberFormat(locale || undefined, {
    maximumFractionDigits: 1,
  });

  return (response.summary.periodDeltas ?? [])
    .map((periodDelta) => {
      const fromLabel = formatBucketMeta(response, periodDelta.fromBucket, locale)
        ?? `${periodDelta.fromBucket.bucketKey}`;
      const toLabel = formatBucketMeta(response, periodDelta.toBucket, locale)
        ?? `${periodDelta.toBucket.bucketKey}`;
      const totalDeltaMagnitude = Math.abs(periodDelta.deltaAggregateValue);

      const contributorsWithMagnitude = (periodDelta.eventContributors ?? [])
        .slice(0, AI_INSIGHTS_COMPARE_EVENT_CONTRIBUTORS_MAX)
        .map((eventContributor) => {
          const dateLabel = formatCompareEvidenceEventDate(
            eventContributor.startDate,
            locale,
            response.query.dateRange.timezone,
          );
          const contributionLabel = formatDeltaContributionLabel(
            response,
            eventContributor.deltaContributionValue,
            unitSettings,
          );
          const contributionShareLabel = totalDeltaMagnitude > 0
            ? `${percentFormatter.format((Math.abs(eventContributor.deltaContributionValue) / totalDeltaMagnitude) * 100)}% of net delta`
            : null;
          const direction: AggregateCompareEvidenceItem['direction'] = eventContributor.deltaContributionValue >= 0
            ? 'upward'
            : 'downward';

          return {
            item: {
              eventId: eventContributor.eventId,
              dateLabel,
              activityLabel: eventContributor.activityType,
              contributionLabel,
              contributionShareLabel,
              direction,
            } satisfies AggregateCompareEvidenceItem,
            absContribution: Math.abs(eventContributor.deltaContributionValue),
          };
        });
      const contributors = contributorsWithMagnitude.map(contributor => contributor.item);

      const downwardContributors = contributors.filter(contributor => contributor.direction === 'downward');
      const upwardContributors = contributors.filter(contributor => contributor.direction === 'upward');
      const explainedMagnitude = contributorsWithMagnitude
        .reduce((sum, contributor) => sum + contributor.absContribution, 0);
      const directionLabel = periodDelta.deltaAggregateValue > 0
        ? 'increase'
        : periodDelta.deltaAggregateValue < 0
          ? 'decrease'
          : 'change';
      const impactSummary = totalDeltaMagnitude <= 0
        ? 'No net change; these are offsetting event-level examples.'
        : `Shown events account for ${percentFormatter.format((explainedMagnitude / totalDeltaMagnitude) * 100)}% of the net ${directionLabel}.`;

      return {
        heading: `From ${fromLabel} to ${toLabel}`,
        fromLabel,
        toLabel,
        impactSummary,
        downwardContributors,
        upwardContributors,
      };
    })
    .filter(group => group.downwardContributors.length > 0 || group.upwardContributors.length > 0);
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

function formatDigestPeriodLabel(
  digest: AiInsightsDigest,
  period: AiInsightsDigest['periods'][number],
  locale: string,
  timezone: string,
): string {
  const date = new Date(period.time);
  if (!Number.isFinite(date.getTime())) {
    return `${period.bucketKey}`;
  }

  switch (digest.granularity) {
    case 'weekly':
      return new Intl.DateTimeFormat(locale || undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: timezone,
      }).format(date);
    case 'yearly':
      return new Intl.DateTimeFormat(locale || undefined, {
        year: 'numeric',
        timeZone: timezone,
      }).format(date);
    case 'monthly':
    default:
      return new Intl.DateTimeFormat(locale || undefined, {
        month: 'short',
        year: 'numeric',
        timeZone: timezone,
      }).format(date);
  }
}

export function buildDigestPeriodDisplays(
  digest: AiInsightsDigest | null | undefined,
  timezone: string,
  unitSettings: UserUnitSettingsInterface,
  locale: string,
): DigestPeriodDisplay[] {
  if (!digest?.periods.length) {
    return [];
  }

  return digest.periods.map((period) => ({
    label: formatDigestPeriodLabel(digest, period, locale, timezone),
    hasData: period.hasData,
    metrics: period.metrics.map(metric => ({
      label: metric.metricLabel,
      value: formatSummaryValue(metric.dataType, metric.aggregateValue, unitSettings),
    })),
  }));
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
  return RANKED_EVENT_IDS_BY_RESULT_KIND[response.resultKind](response as never);
}

export function resolveRankedEventMatchedCount(response: RankedEventResponse): number {
  return RANKED_EVENT_MATCHED_COUNT_BY_RESULT_KIND[response.resultKind](response as never);
}

type RankedEventResultKind = RankedEventResponse['resultKind'];

const RANKED_EVENT_IDS_BY_RESULT_KIND: {
  [K in RankedEventResultKind]: (response: Extract<RankedEventResponse, { resultKind: K }>) => string[];
} = {
  aggregate: response => response.eventRanking.topEventIds.slice(0, AI_INSIGHTS_TOP_RESULTS_MAX),
  event_lookup: response => response.eventLookup.topEventIds.slice(0, AI_INSIGHTS_TOP_RESULTS_MAX),
  latest_event: response => [response.latestEvent.eventId],
};

const RANKED_EVENT_MATCHED_COUNT_BY_RESULT_KIND: {
  [K in RankedEventResultKind]: (response: Extract<RankedEventResponse, { resultKind: K }>) => number;
} = {
  aggregate: response => response.eventRanking.matchedEventCount,
  event_lookup: response => response.eventLookup.matchedEventCount,
  latest_event: response => response.latestEvent.matchedEventCount,
};

const RANKED_EVENT_PRIMARY_LABEL_BY_RESULT_KIND: {
  [K in RankedEventResultKind]: (response: Extract<RankedEventResponse, { resultKind: K }>) => string;
} = {
  aggregate: (response) => {
    const isGroupedAcrossSports = response.query.categoryType === ChartDataCategoryTypes.ActivityType;
    if (response.query.valueType === ChartDataValueTypes.Minimum) {
      return isGroupedAcrossSports
        ? 'Overall lowest event across all matched sports'
        : 'Lowest event';
    }

    return isGroupedAcrossSports
      ? 'Overall best event across all matched sports'
      : 'Top event';
  },
  event_lookup: () => 'Winning event',
  latest_event: () => 'Latest event',
};

const RANKED_EVENT_SECTION_TITLE_BY_RESULT_KIND: {
  [K in RankedEventResultKind]: (response: Extract<RankedEventResponse, { resultKind: K }>) => string | null;
} = {
  aggregate: response => (
    response.query.categoryType === ChartDataCategoryTypes.ActivityType
      ? 'Top events across all matched sports'
      : 'Top events'
  ),
  event_lookup: () => 'Top events',
  latest_event: () => null,
};

const RANKED_EVENT_RANKING_COPY_BY_RESULT_KIND: {
  [K in RankedEventResultKind]: (
    response: Extract<RankedEventResponse, { resultKind: K }>,
    shownCount: number,
    matchedCount: number,
  ) => string | null;
} = {
  aggregate: (response, shownCount, matchedCount) => {
    const acrossAllMatchedSports = response.query.categoryType === ChartDataCategoryTypes.ActivityType;
    if (matchedCount <= shownCount) {
      return acrossAllMatchedSports
        ? `${matchedCount} matching ${matchedCount === 1 ? 'event' : 'events'} ranked across all matched sports.`
        : `${matchedCount} matching ${matchedCount === 1 ? 'event' : 'events'} ranked.`;
    }

    return acrossAllMatchedSports
      ? `Showing top ${shownCount} of ${matchedCount} matching events across all matched sports.`
      : `Showing top ${shownCount} of ${matchedCount} matching events.`;
  },
  event_lookup: (_response, shownCount, matchedCount) => {
    if (matchedCount <= shownCount) {
      return `${matchedCount} matching ${matchedCount === 1 ? 'event' : 'events'} ranked.`;
    }

    return `Showing top ${shownCount} of ${matchedCount} matching events.`;
  },
  latest_event: () => null,
};

const RESULT_CARD_SUBTITLE_BY_RESULT_KIND: {
  [K in AiInsightsOkResponse['resultKind']]: (
    response: Extract<AiInsightsOkResponse, { resultKind: K }>,
  ) => string;
} = {
  aggregate: () => 'Insight summary and chart for this prompt.',
  event_lookup: () => 'Winning event and top matches for this prompt.',
  latest_event: () => 'Most recent matching event for this prompt.',
  power_curve: (response) => (
    response.query.mode === 'compare_over_time'
      ? 'Power-curve envelopes compared over time for this prompt.'
      : 'Best power-curve envelope for this prompt.'
  ),
  multi_metric_aggregate: (response) => (
    response.query.groupingMode === 'date'
      ? 'Combined chart and merged metric summaries for this prompt.'
      : 'Merged metric summaries for this prompt.'
  ),
};

export function resolveResultCardSubtitle(
  response: AiInsightsOkResponse | AiInsightsEmptyResponse | null,
): string {
  if (!response) {
    return 'Insight result for this prompt.';
  }

  if (response.status === 'empty') {
    return 'Insight summary for this prompt.';
  }

  return RESULT_CARD_SUBTITLE_BY_RESULT_KIND[response.resultKind](response as never);
}

export function resolveRankedEventPrimaryLabel(response: RankedEventResponse): string {
  return RANKED_EVENT_PRIMARY_LABEL_BY_RESULT_KIND[response.resultKind](response as never);
}

export function resolveRankedEventSectionTitle(response: RankedEventResponse): string | null {
  return RANKED_EVENT_SECTION_TITLE_BY_RESULT_KIND[response.resultKind](response as never);
}

export function resolveRankedEventRankingCopy(
  response: RankedEventResponse,
  shownCount: number,
  matchedCount: number,
): string | null {
  return RANKED_EVENT_RANKING_COPY_BY_RESULT_KIND[response.resultKind](
    response as never,
    shownCount,
    matchedCount,
  );
}

export function hasAggregateEventRanking(
  response: AiInsightsAggregateOkResponse | null,
): response is AggregateRankedEventResponse {
  return !!response?.eventRanking?.primaryEventId
    && Array.isArray(response.eventRanking.topEventIds)
    && response.eventRanking.topEventIds.length > 0;
}
