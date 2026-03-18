import { z } from 'genkit';
import {
  ChartDataCategoryTypes,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';

import type { AiInsightPresentation, AiInsightSummary, NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import type { EventStatAggregationResult } from '../../../../shared/event-stat-aggregation.types';
import { formatUnitAwareDataValue } from '../../../../shared/unit-aware-display';
import { aiInsightsGenkit } from './genkit';
import {
  AiInsightPresentationSchema,
  AiInsightSummarySchema,
  EventStatAggregationResultSchema,
  NormalizedInsightQuerySchema,
} from './schemas';

export interface SummarizeInsightResultInput {
  status: 'ok' | 'empty';
  prompt: string;
  metricLabel: string;
  query: NormalizedInsightQuery;
  aggregation: EventStatAggregationResult;
  summary: AiInsightSummary;
  presentation: AiInsightPresentation;
  clientLocale?: string;
  unitSettings?: UserUnitSettingsInterface;
}

interface SummarizeInsightDependencies {
  generateNarrative: (input: SummarizeInsightResultInput) => Promise<string>;
}

const SummarizeInsightResultInputSchema = z.object({
  status: z.enum(['ok', 'empty']),
  prompt: z.string().min(1),
  metricLabel: z.string().min(1),
  query: NormalizedInsightQuerySchema,
  aggregation: EventStatAggregationResultSchema,
  summary: AiInsightSummarySchema,
  presentation: AiInsightPresentationSchema,
  clientLocale: z.string().optional(),
  unitSettings: z.any().optional(),
});

const SummarizeInsightResultOutputSchema = z.object({
  narrative: z.string().min(1),
});

function formatRangeForFallback(query: NormalizedInsightQuery): string {
  return `${query.dateRange.startDate.slice(0, 10)} to ${query.dateRange.endDate.slice(0, 10)}`;
}

function formatActivityFilter(query: NormalizedInsightQuery): string {
  if (query.activityTypes.length === 0) {
    return 'all activities';
  }
  if (query.activityTypes.length === 1) {
    return query.activityTypes[0];
  }
  return `${query.activityTypes.length} activity types`;
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
  peakBucket: { bucketKey: string | number; time?: number; aggregateDisplayValue: string; totalCount: number } | null;
  latestBucket: { bucketKey: string | number; time?: number; aggregateDisplayValue: string; totalCount: number } | null;
} {
  const { summary } = input;

  return {
    matchedEventCount: summary.matchedEventCount,
    overallAggregateDisplayValue: summary.overallAggregateValue === null
      ? null
      : formatInsightAggregateDisplay(input.query.dataType, summary.overallAggregateValue, input.unitSettings),
    peakBucket: summary.peakBucket
      ? {
        bucketKey: summary.peakBucket.bucketKey,
        time: summary.peakBucket.time,
        aggregateDisplayValue: formatInsightAggregateDisplay(input.query.dataType, summary.peakBucket.aggregateValue, input.unitSettings),
        totalCount: summary.peakBucket.totalCount,
      }
      : null,
    latestBucket: summary.latestBucket
      ? {
        bucketKey: summary.latestBucket.bucketKey,
        time: summary.latestBucket.time,
        aggregateDisplayValue: formatInsightAggregateDisplay(input.query.dataType, summary.latestBucket.aggregateValue, input.unitSettings),
        totalCount: summary.latestBucket.totalCount,
      }
      : null,
  };
}

function buildNarrativeFallback(input: SummarizeInsightResultInput): string {
  const dateRangeText = formatRangeForFallback(input.query);
  const activityText = formatActivityFilter(input.query);
  const summary = buildInsightSummaryFacts(input);

  if (input.status === 'empty') {
    return `I could not find matching ${activityText} events with ${input.metricLabel} data between ${dateRangeText}.`;
  }

  if (
    input.query.categoryType === ChartDataCategoryTypes.DateType
    && summary.overallAggregateDisplayValue
    && summary.matchedEventCount > 0
  ) {
    const activityNoun = summary.matchedEventCount === 1 ? 'activity' : 'activities';
    return `Your ${input.metricLabel} for ${activityText} between ${dateRangeText} was ${summary.overallAggregateDisplayValue}. This was calculated from ${summary.matchedEventCount} ${activityNoun}.`;
  }

  if (!summary.peakBucket || !summary.latestBucket) {
    return `I found matching ${activityText} events for ${input.metricLabel}, but there was not enough aggregated data to summarize the result.`;
  }

  const grouping = input.query.categoryType === ChartDataCategoryTypes.ActivityType
    ? 'activity groups'
    : 'time buckets';

  return `I found ${input.aggregation.buckets.length} ${grouping} for ${input.presentation.title}. The peak value was ${summary.peakBucket.aggregateDisplayValue}, and the latest value was ${summary.latestBucket.aggregateDisplayValue}.`;
}

export function buildNarrativeFacts(input: SummarizeInsightResultInput): Record<string, unknown> {
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
        'Use the provided formatted display values exactly as supplied.',
        'Do not invent units, dates, metrics, or calculations.',
        'Do not restate raw storage values or infer new numeric calculations.',
        'If the status is empty, clearly say that no matching data was found.',
      ].join(' '),
      prompt: JSON.stringify(buildNarrativeFacts(input)),
      output: { schema: SummarizeInsightResultOutputSchema },
    });

    return output?.narrative?.trim() || fallback;
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
): Promise<string> {
  try {
    return await summarizeInsightDependencies.generateNarrative(input);
  } catch (_error) {
    return buildNarrativeFallback(input);
  }
}

export const summarizeAiInsightResultFlow = aiInsightsGenkit.defineFlow({
  name: 'aiInsightsSummarizeResult',
  inputSchema: SummarizeInsightResultInputSchema,
  outputSchema: SummarizeInsightResultOutputSchema,
}, async (input) => ({
  narrative: await summarizeAiInsightResult(input),
}));
