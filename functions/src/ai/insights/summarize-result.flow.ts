import { z } from 'genkit';
import {
  ChartDataCategoryTypes,
} from '@sports-alliance/sports-lib';

import type { AiInsightPresentation, NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import type { EventStatAggregationResult } from '../../../../shared/event-stat-aggregation.types';
import { aiInsightsGenkit } from './genkit';
import {
  AiInsightPresentationSchema,
  EventStatAggregationResultSchema,
  NormalizedInsightQuerySchema,
} from './schemas';

export interface SummarizeInsightResultInput {
  status: 'ok' | 'empty';
  prompt: string;
  metricLabel: string;
  query: NormalizedInsightQuery;
  aggregation: EventStatAggregationResult;
  presentation: AiInsightPresentation;
  clientLocale?: string;
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
  presentation: AiInsightPresentationSchema,
  clientLocale: z.string().optional(),
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

function buildNarrativeFallback(input: SummarizeInsightResultInput): string {
  const dateRangeText = formatRangeForFallback(input.query);
  const activityText = formatActivityFilter(input.query);

  if (input.status === 'empty') {
    return `I could not find matching ${activityText} events with ${input.metricLabel} data between ${dateRangeText}.`;
  }

  const buckets = input.aggregation.buckets;
  const peakBucket = [...buckets].sort((left, right) => right.aggregateValue - left.aggregateValue)[0];
  const latestBucket = buckets[buckets.length - 1];

  if (!peakBucket || !latestBucket) {
    return `I found matching ${activityText} events for ${input.metricLabel}, but there was not enough aggregated data to summarize the result.`;
  }

  const grouping = input.query.categoryType === ChartDataCategoryTypes.ActivityType
    ? 'activity groups'
    : 'time buckets';

  return `I found ${buckets.length} ${grouping} for ${input.presentation.title}. The peak value was ${formatNumber(peakBucket.aggregateValue)}, and the latest value was ${formatNumber(latestBucket.aggregateValue)}.`;
}

function buildNarrativeFacts(input: SummarizeInsightResultInput): Record<string, unknown> {
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
    buckets: input.aggregation.buckets.slice(0, 24).map(bucket => ({
      bucketKey: bucket.bucketKey,
      time: bucket.time,
      aggregateValue: bucket.aggregateValue,
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
        'Do not invent units, dates, metrics, or calculations.',
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
