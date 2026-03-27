import { z } from 'genkit';
import * as logger from 'firebase-functions/logger';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';

import type {
  AiInsightsDigest,
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
  digest?: AiInsightsDigest;
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

function resolveDigestPeriodNoun(
  digestGranularity: NonNullable<SummarizeInsightMultiMetricAggregateInput['digest']>['granularity'],
): string {
  switch (digestGranularity) {
    case 'weekly':
      return 'week';
    case 'yearly':
      return 'year';
    case 'monthly':
    default:
      return 'month';
  }
}

function formatDigestPeriodLabel(
  digestGranularity: NonNullable<SummarizeInsightMultiMetricAggregateInput['digest']>['granularity'],
  periodTime: number,
  locale: string | undefined,
  timeZone: string,
): string {
  const periodDate = new Date(periodTime);
  if (!Number.isFinite(periodDate.getTime())) {
    return `${periodTime}`;
  }

  switch (digestGranularity) {
    case 'weekly':
      return new Intl.DateTimeFormat(locale || 'en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone,
      }).format(periodDate);
    case 'yearly':
      return new Intl.DateTimeFormat(locale || 'en-US', {
        year: 'numeric',
        timeZone,
      }).format(periodDate);
    case 'monthly':
    default:
      return new Intl.DateTimeFormat(locale || 'en-US', {
        month: 'short',
        year: 'numeric',
        timeZone,
      }).format(periodDate);
  }
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

function formatSignedDeltaDisplayValue(
  dataType: string,
  deltaAggregateValue: number,
  unitSettings?: UserUnitSettingsInterface,
): string {
  if (deltaAggregateValue === 0) {
    return 'no change';
  }

  const absoluteDisplayValue = formatInsightAggregateDisplay(
    dataType,
    Math.abs(deltaAggregateValue),
    unitSettings,
  );

  return `${deltaAggregateValue > 0 ? '+' : '-'}${absoluteDisplayValue}`;
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
  const firstPeriod = periodDeltas[0];
  const lastPeriod = periodDeltas[periodDeltas.length - 1];
  if (!firstPeriod || !lastPeriod) {
    return null;
  }

  const rangeStartLabel = formatCompareBucketLabel(
    firstPeriod.fromBucket,
    input.query,
    input.aggregation.resolvedTimeInterval,
    input.clientLocale,
  );
  const rangeEndLabel = formatCompareBucketLabel(
    lastPeriod.toBucket,
    input.query,
    input.aggregation.resolvedTimeInterval,
    input.clientLocale,
  );
  const netDeltaAggregateValue = periodDeltas.reduce(
    (sum, periodDelta) => sum + periodDelta.deltaAggregateValue,
    0,
  );
  const absoluteNetDeltaDisplayValue = formatInsightAggregateDisplay(
    input.query.dataType,
    Math.abs(netDeltaAggregateValue),
    input.unitSettings,
  );
  const netDirectionText = formatPeriodDeltaDirection(
    input.query.dataType,
    netDeltaAggregateValue,
    absoluteNetDeltaDisplayValue,
  );

  const increasePeriod = periodDeltas.reduce<typeof periodDeltas[number] | null>((current, periodDelta) => {
    if (periodDelta.deltaAggregateValue <= 0) {
      return current;
    }
    if (!current || periodDelta.deltaAggregateValue > current.deltaAggregateValue) {
      return periodDelta;
    }
    return current;
  }, null);
  const decreasePeriod = periodDeltas.reduce<typeof periodDeltas[number] | null>((current, periodDelta) => {
    if (periodDelta.deltaAggregateValue >= 0) {
      return current;
    }
    if (!current || periodDelta.deltaAggregateValue < current.deltaAggregateValue) {
      return periodDelta;
    }
    return current;
  }, null);

  const formatPeriodSpan = (periodDelta: typeof periodDeltas[number]): string => {
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

    return `${fromLabel} to ${toLabel}`;
  };

  const periodDeltaSegments = periodDeltas.map((periodDelta) => {
    const span = formatPeriodSpan(periodDelta);
    const signedDeltaValue = formatSignedDeltaDisplayValue(
      input.query.dataType,
      periodDelta.deltaAggregateValue,
      input.unitSettings,
    );
    const contributorSegments = periodDelta.contributors
      .map((contributor) => (
        `${contributor.seriesKey} (${formatSignedDeltaDisplayValue(
          input.query.dataType,
          contributor.deltaAggregateValue,
          input.unitSettings,
        )})`
      ));
    const contributorClause = (() => {
      if (periodDelta.deltaAggregateValue === 0) {
        return contributorSegments.length
          ? `Likely contributors offset each other: ${contributorSegments.join(', ')}`
          : 'No major contributor shifts detected';
      }

      return contributorSegments.length
        ? `Likely contributors: ${contributorSegments.join(', ')}`
        : 'No major contributor shifts detected';
    })();

    return `${span} (${signedDeltaValue}). ${contributorClause}`;
  });

  const narrativeParts: string[] = [
    `From ${rangeStartLabel} to ${rangeEndLabel}, ${input.metricLabel} ${netDirectionText}.`,
  ];
  if (increasePeriod) {
    narrativeParts.push(
      `Largest increase: ${formatPeriodSpan(increasePeriod)} (${formatSignedDeltaDisplayValue(
        input.query.dataType,
        increasePeriod.deltaAggregateValue,
        input.unitSettings,
      )}).`,
    );
  }
  if (decreasePeriod) {
    narrativeParts.push(
      `Largest decrease: ${formatPeriodSpan(decreasePeriod)} (${formatSignedDeltaDisplayValue(
        input.query.dataType,
        decreasePeriod.deltaAggregateValue,
        input.unitSettings,
      )}).`,
    );
  }
  narrativeParts.push(`Period deltas: ${periodDeltaSegments.join('; ')}.`);

  return narrativeParts.join(' ');
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

function buildDigestNarrativeFallback(
  input: SummarizeInsightMultiMetricAggregateInput,
): string {
  if (!input.digest) {
    return '';
  }

  const dateRangeText = formatLocalizedDateRange(input.query, input.clientLocale);
  const activityText = formatActivityFilter(input.query);
  if (input.digest.periodCount <= 0) {
    return `Digest summary for ${activityText} in ${dateRangeText}: no matching data was found for this range.`;
  }

  const periodNoun = resolveDigestPeriodNoun(input.digest.granularity);
  const periodNounPlural = input.digest.periodCount === 1 ? periodNoun : `${periodNoun}s`;
  const nonEmptyPeriods = input.digest.periods.filter(period => period.hasData);
  const noDataPeriodCount = Math.max(0, input.digest.periodCount - input.digest.nonEmptyPeriodCount);

  if (input.status === 'empty' || nonEmptyPeriods.length === 0) {
    return `Digest summary for ${activityText} in ${dateRangeText}: no matching data in all ${input.digest.periodCount} ${periodNounPlural}.`;
  }

  const latestPeriodWithData = nonEmptyPeriods[nonEmptyPeriods.length - 1];
  const latestMetricWithData = latestPeriodWithData?.metrics.find(metric => metric.aggregateValue !== null) ?? null;
  const latestMetricSummary = latestMetricWithData
    ? `${latestMetricWithData.metricLabel} ${formatInsightAggregateDisplay(
      latestMetricWithData.dataType,
      latestMetricWithData.aggregateValue as number,
      input.unitSettings,
    )}`
    : null;
  const latestPeriodLabel = latestPeriodWithData
    ? formatDigestPeriodLabel(
      input.digest.granularity,
      latestPeriodWithData.time,
      input.clientLocale,
      input.query.dateRange.timezone,
    )
    : null;

  const noDataSuffix = noDataPeriodCount > 0
    ? ` No data in ${noDataPeriodCount} ${noDataPeriodCount === 1 ? periodNoun : `${periodNoun}s`}.`
    : '';

  return `Digest summary for ${activityText} in ${dateRangeText}: data in ${input.digest.nonEmptyPeriodCount} of ${input.digest.periodCount} ${periodNounPlural}.${latestPeriodLabel && latestMetricSummary ? ` Latest ${periodNoun} with data: ${latestPeriodLabel} (${latestMetricSummary}).` : ''}${noDataSuffix}`;
}

function buildNarrativeFallback(input: SummarizeInsightResultInput): string {
  const dateRangeText = formatLocalizedDateRange(input.query, input.clientLocale);
  const activityText = formatActivityFilter(input.query);
  const isAllTime = input.query.dateRange.kind === 'all_time';
  const metricLabelText = 'metricResults' in input
    ? joinMetricLabels(input.metricLabels)
    : input.metricLabel;

  if ('metricResults' in input && input.digest) {
    return buildDigestNarrativeFallback(input);
  }

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
    const digest = input.digest;
    const digestFacts = digest
      ? {
        granularity: digest.granularity,
        periodCount: digest.periodCount,
        nonEmptyPeriodCount: digest.nonEmptyPeriodCount,
        periods: digest.periods.map(period => ({
          bucketKey: period.bucketKey,
          time: period.time,
          label: formatDigestPeriodLabel(
            digest.granularity,
            period.time,
            input.clientLocale,
            input.query.dateRange.timezone,
          ),
          hasData: period.hasData,
          metrics: period.metrics.map(metric => ({
            metricKey: metric.metricKey,
            metricLabel: metric.metricLabel,
            aggregateDisplayValue: metric.aggregateValue === null
              ? null
              : formatInsightAggregateDisplay(metric.dataType, metric.aggregateValue, input.unitSettings),
            totalCount: metric.totalCount,
          })),
        })),
      }
      : null;

    return {
      status: input.status,
      prompt: input.prompt,
      resultKind: 'multi_metric_aggregate',
      ...(digest ? { narrativeMode: 'digest' as const } : {}),
      groupingMode: input.query.groupingMode,
      title: input.presentation.title,
      chartType: input.presentation.chartType,
      metricLabels: input.metricLabels,
      dateRangeLabel: formatLocalizedDateRange(input.query, input.clientLocale),
      activityFilterLabel: formatActivityFilter(input.query),
      ...(digestFacts ? { digest: digestFacts } : {}),
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
