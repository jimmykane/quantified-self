import { HttpsError, onCallGenkit } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightSummary,
  AiInsightPresentation,
  AiInsightsRequest,
  AiInsightsResponse,
  AiInsightsUnsupportedReasonCode,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, hasProAccess } from '../../utils';
import { aiInsightsGenkit } from './genkit';
import { executeAiInsightsQuery } from './execute-query';
import { getInsightMetricDefinition, getSuggestedInsightPrompts } from './metric-catalog';
import { normalizeInsightQuery } from './normalize-query.flow';
import { AiInsightsRequestSchema, AiInsightsResponseSchema } from './schemas';
import { summarizeAiInsightResult } from './summarize-result.flow';
import { loadUserUnitSettings } from './user-unit-settings';

interface AiInsightsCallableContext {
  auth?: {
    uid?: string;
  };
  app?: unknown;
}

const AI_INSIGHTS_PRO_REQUIRED_MESSAGE = 'AI Insights is a Pro feature. Please upgrade to Pro.';
const DEFAULT_EMPTY_STATE = 'No matching events were found for this insight in the requested range.';

function assertValidTimeZone(timeZone: string): void {
  try {
    // Throws RangeError for invalid IANA timezone names.
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch (_error) {
    throw new HttpsError('invalid-argument', 'clientTimezone must be a valid IANA time zone.');
  }
}

function resolveInsightTitle(query: NormalizedInsightQuery, metricLabel: string): string {
  const activityLabel = query.activityTypes.length === 1
    ? ` for ${query.activityTypes[0]}`
    : '';

  if (query.categoryType === ChartDataCategoryTypes.ActivityType) {
    return `${query.valueType} ${metricLabel} by activity type${activityLabel}`;
  }

  return `${query.valueType} ${metricLabel} over time${activityLabel}`;
}

function resolvePresentationWarnings(query: NormalizedInsightQuery): string[] | undefined {
  if (
    query.categoryType === ChartDataCategoryTypes.ActivityType
    && query.activityTypes.length === 1
  ) {
    return ['This compares a single selected activity type, so the chart will contain one bar.'];
  }
  return undefined;
}

function buildInsightPresentation(
  query: NormalizedInsightQuery,
  metricLabel: string,
): AiInsightPresentation {
  const chartType = query.categoryType === ChartDataCategoryTypes.ActivityType
    ? ChartTypes.ColumnsHorizontal
    : query.valueType === ChartDataValueTypes.Total
      ? ChartTypes.ColumnsVertical
      : ChartTypes.LinesVertical;

  return {
    title: resolveInsightTitle(query, metricLabel),
    chartType,
    warnings: resolvePresentationWarnings(query),
  };
}

function buildUnsupportedNarrative(reasonCode: AiInsightsUnsupportedReasonCode): string {
  switch (reasonCode) {
    case 'unsupported_capability':
      return 'I can only answer questions from persisted event-level stats right now, so streams, splits, laps, routes, and original-file reprocessing are out of scope.';
    case 'ambiguous_metric':
      return 'I could not map that request to one supported metric and aggregation combination with enough confidence.';
    case 'invalid_prompt':
      return 'I could not turn that request into a valid insight query.';
    case 'unsupported_metric':
    default:
      return 'I can only answer a limited set of event-level metrics right now, such as distance, duration, ascent, descent, cadence, power, heart rate, speed, pace, and calories.';
  }
}

function buildUnsupportedResponse(
  reasonCode: AiInsightsUnsupportedReasonCode,
): AiInsightsResponse {
  return {
    status: 'unsupported',
    narrative: buildUnsupportedNarrative(reasonCode),
    reasonCode,
    suggestedPrompts: getSuggestedInsightPrompts(),
  };
}

function resolveOverallAggregateValue(
  query: NormalizedInsightQuery,
  aggregation: {
    buckets: Array<{ aggregateValue: number; totalCount: number }>;
  },
): number | null {
  const buckets = aggregation.buckets.filter((bucket) => Number.isFinite(bucket.aggregateValue));
  if (!buckets.length) {
    return null;
  }

  switch (query.valueType) {
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

function buildInsightSummary(
  query: NormalizedInsightQuery,
  aggregation: {
    buckets: Array<{
      bucketKey: string | number;
      time?: number;
      aggregateValue: number;
      totalCount: number;
    }>;
  },
  matchedEventCount: number,
): AiInsightSummary {
  const peakBucket = [...aggregation.buckets].sort((left, right) => right.aggregateValue - left.aggregateValue)[0] ?? null;
  const lowestBucket = [...aggregation.buckets].sort((left, right) => left.aggregateValue - right.aggregateValue)[0] ?? null;
  const latestBucket = aggregation.buckets[aggregation.buckets.length - 1] ?? null;

  return {
    matchedEventCount,
    overallAggregateValue: resolveOverallAggregateValue(query, aggregation),
    peakBucket: peakBucket
      ? {
        bucketKey: peakBucket.bucketKey,
        time: peakBucket.time,
        aggregateValue: peakBucket.aggregateValue,
        totalCount: peakBucket.totalCount,
      }
      : null,
    lowestBucket: lowestBucket
      ? {
        bucketKey: lowestBucket.bucketKey,
        time: lowestBucket.time,
        aggregateValue: lowestBucket.aggregateValue,
        totalCount: lowestBucket.totalCount,
      }
      : null,
    latestBucket: latestBucket
      ? {
        bucketKey: latestBucket.bucketKey,
        time: latestBucket.time,
        aggregateValue: latestBucket.aggregateValue,
        totalCount: latestBucket.totalCount,
      }
      : null,
  };
}

export async function runAiInsights(
  input: AiInsightsRequest,
  context: AiInsightsCallableContext | undefined,
): Promise<AiInsightsResponse> {
  if (!context?.auth?.uid) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  if (!context.app) {
    throw new HttpsError('failed-precondition', 'App Check verification failed.');
  }

  const prompt = `${input.prompt || ''}`.trim();
  if (!prompt) {
    throw new HttpsError('invalid-argument', 'prompt is required.');
  }

  const clientTimezone = `${input.clientTimezone || ''}`.trim();
  if (!clientTimezone) {
    throw new HttpsError('invalid-argument', 'clientTimezone is required.');
  }
  assertValidTimeZone(clientTimezone);

  if (!(await hasProAccess(context.auth.uid))) {
    throw new HttpsError('permission-denied', AI_INSIGHTS_PRO_REQUIRED_MESSAGE);
  }

  const normalizeResult = await normalizeInsightQuery({
    ...input,
    prompt,
    clientTimezone,
  });

  if (normalizeResult.status === 'unsupported') {
    return buildUnsupportedResponse(normalizeResult.reasonCode);
  }

  const metric = getInsightMetricDefinition(normalizeResult.metricKey);
  if (!metric) {
    return buildUnsupportedResponse('unsupported_metric');
  }

  const unitSettings = await loadUserUnitSettings(context.auth.uid);
  const executionResult = await executeAiInsightsQuery(context.auth.uid, normalizeResult.query, prompt);
  const summary = buildInsightSummary(
    normalizeResult.query,
    executionResult.aggregation,
    executionResult.matchedEventsCount,
  );
  const presentation = buildInsightPresentation(normalizeResult.query, metric.label);
  const isEmpty = executionResult.aggregation.buckets.length === 0;
  const emptyPresentation = {
    ...presentation,
    emptyState: DEFAULT_EMPTY_STATE,
  };

  const narrative = await summarizeAiInsightResult({
    status: isEmpty ? 'empty' : 'ok',
    prompt,
    metricLabel: metric.label,
    query: normalizeResult.query,
    aggregation: executionResult.aggregation,
    summary,
    presentation: isEmpty ? emptyPresentation : presentation,
    clientLocale: input.clientLocale,
    unitSettings,
  });

  if (isEmpty) {
    return {
      status: 'empty',
      narrative,
      query: normalizeResult.query,
      aggregation: executionResult.aggregation,
      summary,
      presentation: emptyPresentation,
    };
  }

  return {
      status: 'ok',
      narrative,
      query: normalizeResult.query,
      aggregation: executionResult.aggregation,
      summary,
      presentation,
    };
  }

export const aiInsightsFlow = aiInsightsGenkit.defineFlow({
  name: 'aiInsightsFlow',
  inputSchema: AiInsightsRequestSchema,
  outputSchema: AiInsightsResponseSchema,
}, async (input) => {
  try {
    const context = aiInsightsGenkit.currentContext() as AiInsightsCallableContext | undefined;
    return await runAiInsights(input, context);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    logger.error('[aiInsights] Failed to generate AI insight', { error });
    throw new HttpsError('internal', 'Could not generate AI insights.');
  }
});

export const aiInsights = onCallGenkit({
  region: FUNCTIONS_MANIFEST.aiInsights.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
  timeoutSeconds: 60,
  maxInstances: 10,
}, aiInsightsFlow);
