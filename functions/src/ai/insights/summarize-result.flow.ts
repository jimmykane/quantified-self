import { z } from 'genkit';
import * as logger from 'firebase-functions/logger';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';

import type {
  AiInsightPresentation,
  AiInsightSummaryBucket,
  AiInsightSummary,
  AiInsightsMultiMetricAggregateMetricResult,
  NormalizedInsightAggregateQuery,
  NormalizedInsightEventLookupQuery,
  NormalizedInsightMultiMetricAggregateQuery,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import {
  AI_INSIGHTS_TOP_RESULTS_DEFAULT,
  clampAiInsightsTopResultsLimit,
} from '../../../../shared/ai-insights-ranking.constants';
import { resolveAiInsightsActivityFilterLabel } from '../../../../shared/ai-insights-activity-filter';
import { formatAiInsightsSelectedDateRanges } from '../../../../shared/ai-insights-date-selection';
import type { EventStatAggregationResult } from '../../../../shared/event-stat-aggregation.types';
import { resolveMetricSemantics, resolveMetricSummarySemantics } from '../../../../shared/metric-semantics';
import { formatUnitAwareDataValue } from '../../../../shared/unit-aware-display';
import { aiInsightsGenkit } from './genkit';
import { buildExecutionPromptLogContext } from './execute-query.logging';

interface SummarizeInsightEventLookupFact {
  eventId: string;
  startDate: string;
  aggregateValue: number;
}

interface SummarizeInsightBaseInput {
  status: 'ok' | 'empty';
  prompt: string;
  query: NormalizedInsightQuery;
  presentation: AiInsightPresentation;
  clientLocale?: string;
  unitSettings?: UserUnitSettingsInterface;
}

export interface SummarizeInsightAggregateInput extends SummarizeInsightBaseInput {
  metricLabel: string;
  query: NormalizedInsightAggregateQuery;
  aggregation: EventStatAggregationResult;
  summary: AiInsightSummary;
}

export interface SummarizeInsightEventLookupInput extends SummarizeInsightBaseInput {
  metricLabel: string;
  query: NormalizedInsightEventLookupQuery;
  eventLookup: {
    matchedEventCount: number;
    primaryEvent: SummarizeInsightEventLookupFact | null;
    rankedEvents: SummarizeInsightEventLookupFact[];
  };
}

export interface SummarizeInsightMultiMetricAggregateInput extends SummarizeInsightBaseInput {
  query: NormalizedInsightMultiMetricAggregateQuery;
  metricLabels: string[];
  metricResults: AiInsightsMultiMetricAggregateMetricResult[];
}

export type SummarizeInsightResultInput =
  | SummarizeInsightAggregateInput
  | SummarizeInsightEventLookupInput
  | SummarizeInsightMultiMetricAggregateInput;

export interface SummarizeInsightNarrativeResult {
  narrative: string;
  source: 'genkit' | 'fallback';
  deterministicCompareSummary?: string;
}

export interface SummarizeInsightDependencies {
  generateNarrative: (input: SummarizeInsightResultInput) => Promise<SummarizeInsightNarrativeResult>;
}

export interface SummarizeInsightApi {
  summarizeAiInsightResult: (
    input: SummarizeInsightResultInput,
  ) => Promise<SummarizeInsightNarrativeResult>;
}

const SummarizeInsightResultInputSchema = z.any();

const SummarizeInsightResultOutputSchema = z.object({
  narrative: z.string().min(1),
});

const SummarizeInsightNarrativeResultSchema = z.object({
  narrative: z.string().min(1),
  source: z.enum(['genkit', 'fallback']),
  deterministicCompareSummary: z.string().min(1).optional(),
});

function formatSemanticDate(
  value: string,
  locale: string | undefined,
  timeZone: string,
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale || 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date);
}

function formatLocalizedDateRange(
  query: NormalizedInsightQuery,
  locale: string | undefined,
): string {
  return formatAiInsightsSelectedDateRanges(query, locale);
}

function formatActivityFilter(query: NormalizedInsightQuery): string {
  return resolveAiInsightsActivityFilterLabel(query).toLowerCase();
}

function joinMetricLabels(metricLabels: string[]): string {
  if (metricLabels.length <= 1) {
    return metricLabels[0] ?? '';
  }

  if (metricLabels.length === 2) {
    return `${metricLabels[0]} and ${metricLabels[1]}`;
  }

  return `${metricLabels.slice(0, -1).join(', ')}, and ${metricLabels[metricLabels.length - 1]}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function formatCompareBucketLabel(
  bucket: AiInsightSummaryBucket,
  query: NormalizedInsightAggregateQuery,
  resolvedTimeInterval: TimeIntervals,
  locale: string | undefined,
): string {
  if (Number.isFinite(bucket.time)) {
    const bucketDate = new Date(bucket.time as number);
    if (Number.isFinite(bucketDate.getTime())) {
      switch (resolvedTimeInterval) {
        case TimeIntervals.Yearly:
          return new Intl.DateTimeFormat(locale || 'en-US', {
            year: 'numeric',
            timeZone: query.dateRange.timezone,
          }).format(bucketDate);
        case TimeIntervals.Monthly:
        case TimeIntervals.Quarterly:
        case TimeIntervals.Semesterly:
          return new Intl.DateTimeFormat(locale || 'en-US', {
            month: 'short',
            year: 'numeric',
            timeZone: query.dateRange.timezone,
          }).format(bucketDate);
        case TimeIntervals.Hourly:
          return new Intl.DateTimeFormat(locale || 'en-US', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: query.dateRange.timezone,
          }).format(bucketDate);
        case TimeIntervals.Daily:
        case TimeIntervals.Weekly:
        case TimeIntervals.BiWeekly:
        case TimeIntervals.Auto:
        default:
          return new Intl.DateTimeFormat(locale || 'en-US', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone: query.dateRange.timezone,
          }).format(bucketDate);
      }
    }
  }

  return `${bucket.bucketKey}`;
}

function formatPeriodDeltaDirection(
  dataType: string,
  deltaAggregateValue: number,
  absoluteDisplayValue: string,
): string {
  if (deltaAggregateValue === 0) {
    return 'did not change';
  }

  const semantics = resolveMetricSemantics(dataType);
  if (semantics.direction === 'inverse') {
    return deltaAggregateValue < 0
      ? `improved by ${absoluteDisplayValue}`
      : `slowed by ${absoluteDisplayValue}`;
  }

  return deltaAggregateValue > 0
    ? `increased by ${absoluteDisplayValue}`
    : `decreased by ${absoluteDisplayValue}`;
}

function formatContributorDirection(
  dataType: string,
  deltaAggregateValue: number,
  absoluteDisplayValue: string,
): string {
  const semantics = resolveMetricSemantics(dataType);
  if (semantics.direction === 'inverse') {
    return deltaAggregateValue < 0
      ? `faster by ${absoluteDisplayValue}`
      : `slower by ${absoluteDisplayValue}`;
  }

  return deltaAggregateValue > 0
    ? `up by ${absoluteDisplayValue}`
    : `down by ${absoluteDisplayValue}`;
}

function buildDeterministicCompareDeltaNarrative(
  input: SummarizeInsightResultInput,
): string | null {
  if (
    !('aggregation' in input)
    || !('summary' in input)
    || input.query.resultKind !== 'aggregate'
    || input.query.periodMode !== 'compare'
    || input.query.categoryType !== ChartDataCategoryTypes.DateType
    || input.status !== 'ok'
  ) {
    return null;
  }

  const periodDeltas = input.summary.periodDeltas ?? [];
  if (!periodDeltas.length) {
    return null;
  }

  const periodSentences = periodDeltas.map((periodDelta) => {
    const fromLabel = formatCompareBucketLabel(
      periodDelta.fromBucket,
      input.query,
      input.aggregation.resolvedTimeInterval,
      input.clientLocale,
    );
    const toLabel = formatCompareBucketLabel(
      periodDelta.toBucket,
      input.query,
      input.aggregation.resolvedTimeInterval,
      input.clientLocale,
    );
    const absoluteDeltaDisplayValue = formatInsightAggregateDisplay(
      input.query.dataType,
      Math.abs(periodDelta.deltaAggregateValue),
      input.unitSettings,
    );
    const directionText = formatPeriodDeltaDirection(
      input.query.dataType,
      periodDelta.deltaAggregateValue,
      absoluteDeltaDisplayValue,
    );
    const baseSentence = `From ${fromLabel} to ${toLabel}, ${input.metricLabel} ${directionText}.`;
    if (periodDelta.deltaAggregateValue === 0 || !periodDelta.contributors.length) {
      return baseSentence;
    }

    const contributorSentence = periodDelta.contributors
      .map((contributor) => {
        const absoluteContributorDisplayValue = formatInsightAggregateDisplay(
          input.query.dataType,
          Math.abs(contributor.deltaAggregateValue),
          input.unitSettings,
        );
        const contributorDirection = formatContributorDirection(
          input.query.dataType,
          contributor.deltaAggregateValue,
          absoluteContributorDisplayValue,
        );
        return `${contributor.seriesKey} (${contributorDirection})`;
      })
      .join(', ');

    return `${baseSentence} Likely contributors: ${contributorSentence}.`;
  });

  return periodSentences.length
    ? periodSentences.join(' ')
    : null;
}

function withDeterministicCompareDeltaNarrative(
  input: SummarizeInsightResultInput,
  narrativeResult: SummarizeInsightNarrativeResult,
): SummarizeInsightNarrativeResult {
  const deterministicCompareNarrative = buildDeterministicCompareDeltaNarrative(input);
  if (!deterministicCompareNarrative || narrativeResult.deterministicCompareSummary) {
    return narrativeResult;
  }

  return {
    ...narrativeResult,
    deterministicCompareSummary: deterministicCompareNarrative,
  };
}

export function formatInsightAggregateDisplay(
  dataType: string,
  value: number,
  unitSettings?: UserUnitSettingsInterface,
): string {
  const formattedValue = formatUnitAwareDataValue(dataType, value, unitSettings, {
    stripRepeatedUnit: true,
  });

  return formattedValue ?? formatNumber(value);
}

export function buildInsightSummaryFacts(input: SummarizeInsightResultInput): {
  matchedEventCount: number;
  overallAggregateDisplayValue: string | null;
  highestValueBucket: { label: string; bucketKey: string | number; time?: number; aggregateDisplayValue: string; totalCount: number } | null;
  lowestValueBucket: { label: string; bucketKey: string | number; time?: number; aggregateDisplayValue: string; totalCount: number } | null;
  latestBucket: { label: string; bucketKey: string | number; time?: number; aggregateDisplayValue: string; totalCount: number } | null;
  improvedVerb: string;
  declinedVerb: string;
} {
  if (!('summary' in input)) {
    throw new Error('Summary facts are only available for aggregate insights.');
  }

  const { summary } = input;
  const summarySemantics = resolveMetricSummarySemantics(
    input.query.dataType,
    input.query.categoryType,
  );
  const metricSemantics = resolveMetricSemantics(input.query.dataType);
  const shouldIncludeLatestBucket = input.query.categoryType === ChartDataCategoryTypes.DateType;

  return {
    matchedEventCount: summary.matchedEventCount,
    overallAggregateDisplayValue: summary.overallAggregateValue === null
      ? null
      : formatInsightAggregateDisplay(input.query.dataType, summary.overallAggregateValue, input.unitSettings),
    highestValueBucket: summary.peakBucket
      ? {
        label: summarySemantics.highestLabel,
        bucketKey: summary.peakBucket.bucketKey,
        time: summary.peakBucket.time,
        aggregateDisplayValue: formatInsightAggregateDisplay(input.query.dataType, summary.peakBucket.aggregateValue, input.unitSettings),
        totalCount: summary.peakBucket.totalCount,
      }
      : null,
    lowestValueBucket: summary.lowestBucket
      ? {
        label: summarySemantics.lowestLabel,
        bucketKey: summary.lowestBucket.bucketKey,
        time: summary.lowestBucket.time,
        aggregateDisplayValue: formatInsightAggregateDisplay(input.query.dataType, summary.lowestBucket.aggregateValue, input.unitSettings),
        totalCount: summary.lowestBucket.totalCount,
      }
      : null,
    latestBucket: shouldIncludeLatestBucket && summary.latestBucket
      ? {
        label: summarySemantics.latestLabel,
        bucketKey: summary.latestBucket.bucketKey,
        time: summary.latestBucket.time,
        aggregateDisplayValue: formatInsightAggregateDisplay(input.query.dataType, summary.latestBucket.aggregateValue, input.unitSettings),
        totalCount: summary.latestBucket.totalCount,
      }
      : null,
    improvedVerb: metricSemantics.improvedVerb,
    declinedVerb: metricSemantics.declinedVerb,
  };
}

function buildMultiMetricSummaryFacts(
  input: SummarizeInsightMultiMetricAggregateInput,
): Array<{
  metricKey: string;
  metricLabel: string;
  overallAggregateDisplayValue: string | null;
  matchedEventCount: number;
  latestBucket: ReturnType<typeof buildInsightSummaryFacts>['latestBucket'];
}> {
  return input.metricResults.map((metricResult) => {
    const summaryFacts = buildInsightSummaryFacts({
      status: input.status,
      prompt: input.prompt,
      metricLabel: metricResult.metricLabel,
      query: metricResult.query,
      aggregation: metricResult.aggregation,
      summary: metricResult.summary,
      presentation: metricResult.presentation,
      clientLocale: input.clientLocale,
      unitSettings: input.unitSettings,
    });

    return {
      metricKey: metricResult.metricKey,
      metricLabel: metricResult.metricLabel,
      overallAggregateDisplayValue: summaryFacts.overallAggregateDisplayValue,
      matchedEventCount: summaryFacts.matchedEventCount,
      latestBucket: summaryFacts.latestBucket,
    };
  });
}

function resolveEventLookupDescriptor(
  query: NormalizedInsightEventLookupQuery,
  metricLabel: string,
): string {
  const semantics = resolveMetricSemantics(query.dataType);

  switch (query.valueType) {
    case ChartDataValueTypes.Total:
    case ChartDataValueTypes.Maximum:
      if (metricLabel === 'distance') {
        return 'longest distance';
      }
      if (metricLabel === 'duration') {
        return 'longest duration';
      }
      return `${semantics.highestValueLabel} ${metricLabel}`;
    case ChartDataValueTypes.Minimum:
      if (metricLabel === 'distance') {
        return 'shortest distance';
      }
      if (metricLabel === 'duration') {
        return 'shortest duration';
      }
      return `${semantics.lowestValueLabel} ${metricLabel}`;
    default:
      return metricLabel;
  }
}

function formatEventLookupDate(
  value: string,
  locale: string | undefined,
  query: NormalizedInsightEventLookupQuery,
): string {
  return formatSemanticDate(value, locale, query.dateRange.timezone);
}

function containsNoDataPhrasing(narrative: string): boolean {
  return [
    /\bno matching data\b/i,
    /\bno matching (?:event|events|activity|activities)\b/i,
    /\bno matching .*?\b(?:was|were) found\b/i,
    /\bcould not find matching\b/i,
    /\bno data was found\b/i,
  ].some(pattern => pattern.test(narrative));
}

function hasEffectiveRangeReference(
  input: SummarizeInsightResultInput,
  narrative: string,
): boolean {
  if (input.query.dateRange.kind !== 'bounded') {
    return true;
  }

  const dateRangeText = formatLocalizedDateRange(input.query, input.clientLocale);
  if (narrative.includes(dateRangeText)) {
    return true;
  }

  const startDateText = formatSemanticDate(
    input.query.dateRange.startDate,
    input.clientLocale,
    input.query.dateRange.timezone,
  );
  const endDateText = formatSemanticDate(
    input.query.dateRange.endDate,
    input.clientLocale,
    input.query.dateRange.timezone,
  );

  return narrative.includes(startDateText) && narrative.includes(endDateText);
}

function resolveNarrativeOverrideReason(
  input: SummarizeInsightResultInput,
  narrative: string,
): 'empty_result' | 'contains_no_data_phrasing' | 'missing_effective_range' | null {
  if (input.status === 'empty') {
    return 'empty_result';
  }

  if (input.query.dateRange.kind !== 'bounded' || input.query.dateRange.source !== 'default') {
    return null;
  }

  if (containsNoDataPhrasing(narrative)) {
    return 'contains_no_data_phrasing';
  }

  if (!hasEffectiveRangeReference(input, narrative)) {
    return 'missing_effective_range';
  }

  return null;
}

function buildNarrativeFallback(input: SummarizeInsightResultInput): string {
  const dateRangeText = formatLocalizedDateRange(input.query, input.clientLocale);
  const activityText = formatActivityFilter(input.query);
  const isAllTime = input.query.dateRange.kind === 'all_time';
  const metricLabelText = 'metricResults' in input
    ? joinMetricLabels(input.metricLabels)
    : input.metricLabel;

  if (input.status === 'empty') {
    const defaultRangePrefix = input.query.dateRange.source === 'default' && !isAllTime
      ? `Used the default date range (${dateRangeText}) because no time range was found in your prompt. `
      : '';

    return isAllTime
      ? `${defaultRangePrefix}No matching ${activityText} events with ${metricLabelText} data were found across all recorded history.`
      : `${defaultRangePrefix}No matching ${activityText} events with ${metricLabelText} data were found in ${dateRangeText}.`;
  }

  if ('metricResults' in input) {
    const metricSummaryFacts = buildMultiMetricSummaryFacts(input);
    if (metricSummaryFacts.every((metric) => !metric.overallAggregateDisplayValue)) {
      return isAllTime
        ? `I could not find matching ${activityText} events with ${metricLabelText} data across all recorded history.`
        : `I could not find matching ${activityText} events with ${metricLabelText} data from ${dateRangeText}.`;
    }

    const metricSummaries = metricSummaryFacts
      .filter(metric => metric.overallAggregateDisplayValue)
      .map((metric) => {
        if (input.query.groupingMode === 'date' && metric.latestBucket) {
          return `${metric.metricLabel} ended at ${metric.latestBucket.aggregateDisplayValue}`;
        }
        return `${metric.metricLabel} was ${metric.overallAggregateDisplayValue}`;
      });

    const summarySentence = metricSummaries.join('; ');
    return isAllTime
      ? `Across all recorded history for ${activityText}, ${summarySentence}.`
      : `From ${dateRangeText} for ${activityText}, ${summarySentence}.`;
  }

  if ('eventLookup' in input) {
    const primaryEvent = input.eventLookup.primaryEvent;
    if (!primaryEvent) {
      return `I found matching ${activityText} events for ${input.metricLabel}, but could not determine the winning event.`;
    }

    const descriptor = resolveEventLookupDescriptor(input.query, input.metricLabel);
    const displayValue = formatInsightAggregateDisplay(input.query.dataType, primaryEvent.aggregateValue, input.unitSettings);
    const eventDate = formatEventLookupDate(primaryEvent.startDate, input.clientLocale, input.query);
    const matchedNoun = input.eventLookup.matchedEventCount === 1 ? 'event' : 'events';

    return isAllTime
      ? `Your ${descriptor} event for ${activityText} was ${displayValue} on ${eventDate}. I ranked ${input.eventLookup.matchedEventCount} matching ${matchedNoun}.`
      : `Between ${dateRangeText}, your ${descriptor} event for ${activityText} was ${displayValue} on ${eventDate}. I ranked ${input.eventLookup.matchedEventCount} matching ${matchedNoun}.`;
  }

  const summary = buildInsightSummaryFacts(input);

  if (
    input.query.categoryType === ChartDataCategoryTypes.DateType
    && summary.overallAggregateDisplayValue
    && summary.matchedEventCount > 0
  ) {
    const activityNoun = summary.matchedEventCount === 1 ? 'activity' : 'activities';
    return isAllTime
      ? `Your ${input.metricLabel} for ${activityText} across all recorded history was ${summary.overallAggregateDisplayValue}. This was calculated from ${summary.matchedEventCount} ${activityNoun}.`
      : `Your ${input.metricLabel} for ${activityText} from ${dateRangeText} was ${summary.overallAggregateDisplayValue}. This was calculated from ${summary.matchedEventCount} ${activityNoun}.`;
  }

  if (!summary.highestValueBucket || !summary.latestBucket) {
    return isAllTime
      ? `I found matching ${activityText} events for ${input.metricLabel}, but there was not enough aggregated data to summarize the result across all recorded history.`
      : `I found matching ${activityText} events for ${input.metricLabel} from ${dateRangeText}, but there was not enough aggregated data to summarize the result.`;
  }

  const grouping = input.query.categoryType === ChartDataCategoryTypes.ActivityType
    ? 'activity groups'
    : 'time buckets';

  return isAllTime
    ? `Across all recorded history, I found ${input.aggregation.buckets.length} ${grouping} for ${input.presentation.title}. The ${summary.highestValueBucket.label.toLowerCase()} was ${summary.highestValueBucket.aggregateDisplayValue}, and the ${summary.latestBucket.label.toLowerCase()} was ${summary.latestBucket.aggregateDisplayValue}.`
    : `From ${dateRangeText}, I found ${input.aggregation.buckets.length} ${grouping} for ${input.presentation.title}. The ${summary.highestValueBucket.label.toLowerCase()} was ${summary.highestValueBucket.aggregateDisplayValue}, and the ${summary.latestBucket.label.toLowerCase()} was ${summary.latestBucket.aggregateDisplayValue}.`;
}

export function buildNarrativeFacts(input: SummarizeInsightResultInput): Record<string, unknown> {
  if ('metricResults' in input) {
    const metricSummaryFacts = buildMultiMetricSummaryFacts(input);

    return {
      status: input.status,
      prompt: input.prompt,
      resultKind: 'multi_metric_aggregate',
      groupingMode: input.query.groupingMode,
      title: input.presentation.title,
      chartType: input.presentation.chartType,
      metricLabels: input.metricLabels,
      dateRangeLabel: formatLocalizedDateRange(input.query, input.clientLocale),
      activityFilterLabel: formatActivityFilter(input.query),
      metrics: input.metricResults.map((metricResult, index) => ({
        metricKey: metricResult.metricKey,
        metricLabel: metricResult.metricLabel,
        matchedEventCount: metricSummaryFacts[index]?.matchedEventCount ?? metricResult.summary.matchedEventCount,
        overallAggregateDisplayValue: metricSummaryFacts[index]?.overallAggregateDisplayValue ?? null,
        latestBucket: metricSummaryFacts[index]?.latestBucket
          ? {
            label: metricSummaryFacts[index]?.latestBucket?.label,
            aggregateDisplayValue: metricSummaryFacts[index]?.latestBucket?.aggregateDisplayValue,
          }
          : null,
        bucketCount: metricResult.aggregation.buckets.length,
      })),
    };
  }

  if ('eventLookup' in input) {
    const topResultsLimit = clampAiInsightsTopResultsLimit(
      input.query.topResultsLimit ?? AI_INSIGHTS_TOP_RESULTS_DEFAULT,
    );
    return {
      status: input.status,
      prompt: input.prompt,
      metricLabel: input.metricLabel,
      title: input.presentation.title,
      resultKind: 'event_lookup',
      chartType: input.presentation.chartType,
      dateRangeLabel: formatLocalizedDateRange(input.query, input.clientLocale),
      activityFilterLabel: formatActivityFilter(input.query),
      descriptor: resolveEventLookupDescriptor(input.query, input.metricLabel),
      matchedEventCount: input.eventLookup.matchedEventCount,
      primaryEvent: input.eventLookup.primaryEvent
        ? {
          eventId: input.eventLookup.primaryEvent.eventId,
          startDateLabel: formatEventLookupDate(input.eventLookup.primaryEvent.startDate, input.clientLocale, input.query),
          aggregateDisplayValue: formatInsightAggregateDisplay(
            input.query.dataType,
            input.eventLookup.primaryEvent.aggregateValue,
            input.unitSettings,
          ),
        }
        : null,
      rankedEvents: input.eventLookup.rankedEvents.slice(0, topResultsLimit).map((event) => ({
        eventId: event.eventId,
        startDateLabel: formatEventLookupDate(event.startDate, input.clientLocale, input.query),
        aggregateDisplayValue: formatInsightAggregateDisplay(
          input.query.dataType,
          event.aggregateValue,
          input.unitSettings,
        ),
      })),
    };
  }

  const summary = buildInsightSummaryFacts(input);

  return {
    status: input.status,
      prompt: input.prompt,
      metricLabel: input.metricLabel,
      title: input.presentation.title,
    chartType: input.presentation.chartType,
    categoryType: input.query.categoryType,
    valueType: input.query.valueType,
    activityTypes: input.query.activityTypes,
    dateRange: input.query.dateRange,
    dateRangeLabel: formatLocalizedDateRange(input.query, input.clientLocale),
    bucketCount: input.aggregation.buckets.length,
    summary,
    buckets: input.aggregation.buckets.slice(0, 24).map(bucket => ({
      bucketKey: bucket.bucketKey,
      time: bucket.time,
      aggregateDisplayValue: formatInsightAggregateDisplay(input.query.dataType, bucket.aggregateValue, input.unitSettings),
      totalCount: bucket.totalCount,
    })),
  };
}

const defaultSummarizeInsightDependencies: SummarizeInsightDependencies = {
  generateNarrative: async (input) => {
    const fallback = buildNarrativeFallback(input);
    const { output } = await aiInsightsGenkit.generate({
      system: [
        'You write concise fitness insight summaries.',
        'Use only the supplied facts.',
        'Use the provided formatted display values and labels exactly as supplied.',
        'Do not invent units, dates, metrics, or calculations.',
        'Do not restate raw storage values or infer new numeric calculations.',
        'Always anchor the summary to the supplied effective dateRangeLabel when it is provided.',
        'If status is ok, do not claim that no matching data was found and do not mention any date range other than the supplied effective range.',
        'If the status is empty, clearly say that no matching data was found.',
      ].join(' '),
      prompt: JSON.stringify(buildNarrativeFacts(input)),
      output: { schema: SummarizeInsightResultOutputSchema },
    });

    const narrative = output?.narrative?.trim();
    if (narrative) {
      return {
        narrative,
        source: 'genkit',
      };
    }

    return {
      narrative: fallback,
      source: 'fallback',
    };
  },
};

export function createSummarizeInsight(
  dependencies: Partial<SummarizeInsightDependencies> = {},
): SummarizeInsightApi {
  const resolvedDependencies: SummarizeInsightDependencies = {
    ...defaultSummarizeInsightDependencies,
    ...dependencies,
  };

  return {
    summarizeAiInsightResult: async (
      input: SummarizeInsightResultInput,
    ): Promise<SummarizeInsightNarrativeResult> => {
      try {
        const generatedNarrative = SummarizeInsightNarrativeResultSchema.parse(
          await resolvedDependencies.generateNarrative(input),
        );

        const overrideReason = resolveNarrativeOverrideReason(input, generatedNarrative.narrative);
        if (overrideReason === 'empty_result') {
          return withDeterministicCompareDeltaNarrative(input, {
            ...generatedNarrative,
            narrative: buildNarrativeFallback(input),
          });
        }

        if (overrideReason) {
          logger.debug('[aiInsights] Replaced inconsistent default-range narrative.', {
            ...buildExecutionPromptLogContext(input.prompt),
            resultKind: input.query.resultKind,
            reason: overrideReason,
            dateRangeLabel: formatLocalizedDateRange(input.query, input.clientLocale),
          });
          return withDeterministicCompareDeltaNarrative(input, {
            ...generatedNarrative,
            narrative: buildNarrativeFallback(input),
          });
        }

        return withDeterministicCompareDeltaNarrative(input, generatedNarrative);
      } catch {
        return withDeterministicCompareDeltaNarrative(input, {
          narrative: buildNarrativeFallback(input),
          source: 'fallback',
        });
      }
    },
  };
}

const summarizeInsightRuntime = createSummarizeInsight();

export async function summarizeAiInsightResult(
  input: SummarizeInsightResultInput,
): Promise<SummarizeInsightNarrativeResult> {
  return summarizeInsightRuntime.summarizeAiInsightResult(input);
}

export const summarizeAiInsightResultFlow = aiInsightsGenkit.defineFlow({
  name: 'aiInsightsSummarizeResult',
  inputSchema: SummarizeInsightResultInputSchema,
  outputSchema: SummarizeInsightNarrativeResultSchema,
}, async (input) => summarizeAiInsightResult(input as SummarizeInsightResultInput));
