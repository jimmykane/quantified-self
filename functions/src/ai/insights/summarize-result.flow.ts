import { z } from 'genkit';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';

import type { AiInsightPresentation, AiInsightSummary, NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import { resolveAiInsightsActivityFilterLabel } from '../../../../shared/ai-insights-activity-filter';
import type { EventStatAggregationResult } from '../../../../shared/event-stat-aggregation.types';
import { resolveMetricSemantics, resolveMetricSummarySemantics } from '../../../../shared/metric-semantics';
import { formatUnitAwareDataValue } from '../../../../shared/unit-aware-display';
import { aiInsightsGenkit } from './genkit';
import {
  AiInsightPresentationSchema,
  AiInsightSummarySchema,
  EventStatAggregationResultSchema,
  NormalizedInsightQuerySchema,
} from './schemas';

interface SummarizeInsightEventLookupFact {
  eventId: string;
  startDate: string;
  aggregateValue: number;
}

interface SummarizeInsightBaseInput {
  status: 'ok' | 'empty';
  prompt: string;
  metricLabel: string;
  query: NormalizedInsightQuery;
  presentation: AiInsightPresentation;
  clientLocale?: string;
  unitSettings?: UserUnitSettingsInterface;
}

export interface SummarizeInsightAggregateInput extends SummarizeInsightBaseInput {
  aggregation: EventStatAggregationResult;
  summary: AiInsightSummary;
}

export interface SummarizeInsightEventLookupInput extends SummarizeInsightBaseInput {
  eventLookup: {
    matchedEventCount: number;
    primaryEvent: SummarizeInsightEventLookupFact | null;
    rankedEvents: SummarizeInsightEventLookupFact[];
  };
}

export type SummarizeInsightResultInput =
  | SummarizeInsightAggregateInput
  | SummarizeInsightEventLookupInput;

export interface SummarizeInsightNarrativeResult {
  narrative: string;
  source: 'genkit' | 'fallback';
}

interface SummarizeInsightDependencies {
  generateNarrative: (input: SummarizeInsightResultInput) => Promise<SummarizeInsightNarrativeResult>;
}

const SummarizeInsightEventLookupFactSchema = z.object({
  eventId: z.string().min(1),
  startDate: z.string().datetime(),
  aggregateValue: z.number(),
});

const SummarizeInsightBaseInputSchema = z.object({
  status: z.enum(['ok', 'empty']),
  prompt: z.string().min(1),
  metricLabel: z.string().min(1),
  query: NormalizedInsightQuerySchema,
  presentation: AiInsightPresentationSchema,
  clientLocale: z.string().optional(),
  unitSettings: z.any().optional(),
});

const SummarizeInsightResultInputSchema = z.union([
  SummarizeInsightBaseInputSchema.extend({
    aggregation: EventStatAggregationResultSchema,
    summary: AiInsightSummarySchema,
  }),
  SummarizeInsightBaseInputSchema.extend({
    eventLookup: z.object({
      matchedEventCount: z.number().int().nonnegative(),
      primaryEvent: SummarizeInsightEventLookupFactSchema.nullable(),
      rankedEvents: z.array(SummarizeInsightEventLookupFactSchema).max(10),
    }),
  }),
]);

const SummarizeInsightResultOutputSchema = z.object({
  narrative: z.string().min(1),
});

const SummarizeInsightNarrativeResultSchema = z.object({
  narrative: z.string().min(1),
  source: z.enum(['genkit', 'fallback']),
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
  if (query.dateRange.kind === 'all_time') {
    return 'all time';
  }

  return `${formatSemanticDate(query.dateRange.startDate, locale, query.dateRange.timezone)} to ${formatSemanticDate(query.dateRange.endDate, locale, query.dateRange.timezone)}`;
}

function formatActivityFilter(query: NormalizedInsightQuery): string {
  return resolveAiInsightsActivityFilterLabel(query).toLowerCase();
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

function resolveEventLookupDescriptor(
  query: NormalizedInsightQuery,
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
  query: NormalizedInsightQuery,
): string {
  return formatSemanticDate(value, locale, query.dateRange.timezone);
}

function buildNarrativeFallback(input: SummarizeInsightResultInput): string {
  const dateRangeText = formatLocalizedDateRange(input.query, input.clientLocale);
  const activityText = formatActivityFilter(input.query);
  const isAllTime = input.query.dateRange.kind === 'all_time';

  if (input.status === 'empty') {
    return isAllTime
      ? `I could not find matching ${activityText} events with ${input.metricLabel} data across all recorded history.`
      : `I could not find matching ${activityText} events with ${input.metricLabel} data from ${dateRangeText}.`;
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
    return `I found matching ${activityText} events for ${input.metricLabel}, but there was not enough aggregated data to summarize the result.`;
  }

  const grouping = input.query.categoryType === ChartDataCategoryTypes.ActivityType
    ? 'activity groups'
    : 'time buckets';

  return `I found ${input.aggregation.buckets.length} ${grouping} for ${input.presentation.title}. The ${summary.highestValueBucket.label.toLowerCase()} was ${summary.highestValueBucket.aggregateDisplayValue}, and the ${summary.latestBucket.label.toLowerCase()} was ${summary.latestBucket.aggregateDisplayValue}.`;
}

export function buildNarrativeFacts(input: SummarizeInsightResultInput): Record<string, unknown> {
  if ('eventLookup' in input) {
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
      rankedEvents: input.eventLookup.rankedEvents.slice(0, 10).map((event) => ({
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

let summarizeInsightDependencies: SummarizeInsightDependencies = defaultSummarizeInsightDependencies;

export function setSummarizeInsightDependenciesForTesting(
  dependencies?: Partial<SummarizeInsightDependencies>,
): void {
  summarizeInsightDependencies = dependencies
    ? { ...defaultSummarizeInsightDependencies, ...dependencies }
    : defaultSummarizeInsightDependencies;
}

export async function summarizeAiInsightResult(
  input: SummarizeInsightResultInput,
): Promise<SummarizeInsightNarrativeResult> {
  try {
    return SummarizeInsightNarrativeResultSchema.parse(
      await summarizeInsightDependencies.generateNarrative(input),
    );
  } catch (_error) {
    return {
      narrative: buildNarrativeFallback(input),
      source: 'fallback',
    };
  }
}

export const summarizeAiInsightResultFlow = aiInsightsGenkit.defineFlow({
  name: 'aiInsightsSummarizeResult',
  inputSchema: SummarizeInsightResultInputSchema,
  outputSchema: SummarizeInsightNarrativeResultSchema,
}, async (input) => summarizeAiInsightResult(input));
