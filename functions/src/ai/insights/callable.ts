import { HttpsError, onCall, onCallGenkit } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightSummaryActivityMix,
  AiInsightSummary,
  AiInsightPresentation,
  AiInsightsQuotaStatusResponse,
  AiInsightsRequest,
  AiInsightsResponse,
  AiInsightsUnsupportedReasonCode,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import { resolveAiInsightsActivityFilterLabel } from '../../../../shared/ai-insights-activity-filter';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../../utils';
import { aiInsightsGenkit } from './genkit';
import { executeAiInsightsQuery } from './execute-query';
import { getInsightMetricDefinition, getSuggestedInsightPrompts } from './metric-catalog';
import { normalizeInsightQuery } from './normalize-query.flow';
import { AiInsightsRequestSchema, AiInsightsResponseSchema } from './schemas';
import {
  getAiInsightsQuotaStatus as getAiInsightsQuotaStatusForUser,
  releaseAiInsightsQuotaReservation,
  reserveAiInsightsQuotaForGenkit,
  finalizeAiInsightsQuotaReservation,
  AI_INSIGHTS_LIMIT_REACHED_MESSAGE,
} from './quota';
import { summarizeAiInsightResult } from './summarize-result.flow';
import { loadUserUnitSettings } from './user-unit-settings';

interface AiInsightsCallableContext {
  auth?: {
    uid?: string;
  };
  app?: unknown;
}

const AI_INSIGHTS_PAID_REQUIRED_MESSAGE = 'AI Insights is available to Basic and Pro members.';
const DEFAULT_EMPTY_STATE = 'No matching events were found for this insight in the requested range.';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function assertValidTimeZone(timeZone: string): void {
  try {
    // Throws RangeError for invalid IANA timezone names.
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch (_error) {
    throw new HttpsError('invalid-argument', 'clientTimezone must be a valid IANA time zone.');
  }
}

function resolveInsightTitle(query: NormalizedInsightQuery, metricLabel: string): string {
  const activityFilterLabel = resolveAiInsightsActivityFilterLabel(query);
  const activityLabel = activityFilterLabel === 'All activities'
    ? ''
    : ` for ${activityFilterLabel}`;

  if (query.categoryType === ChartDataCategoryTypes.ActivityType) {
    return `${query.valueType} ${metricLabel} by activity type${activityLabel}`;
  }

  return `${query.valueType} ${metricLabel} over time${activityLabel}`;
}

function resolvePresentationWarnings(query: NormalizedInsightQuery): string[] | undefined {
  if (
    query.categoryType === ChartDataCategoryTypes.ActivityType
    && query.activityTypeGroups.length === 0
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
  return {
    title: resolveInsightTitle(query, metricLabel),
    chartType: query.chartType,
    warnings: resolvePresentationWarnings(query),
  };
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfWeek(date: Date): Date {
  const weekStart = startOfDay(date);
  const day = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - day + 1);
  return weekStart;
}

function startOfIsoWeekOne(year: number): Date {
  return startOfWeek(new Date(Date.UTC(year, 0, 4)));
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfQuarter(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
}

function startOfSemester(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() < 6 ? 0 : 6, 1));
}

function startOfYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function utcCalendarTime(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfBiWeek(date: Date): Date {
  const weekStart = startOfWeek(date);
  const weekReference = new Date(weekStart.getTime());
  weekReference.setUTCDate(weekReference.getUTCDate() + 3);
  const isoWeekYear = weekReference.getUTCFullYear();
  const isoWeekOneStart = startOfIsoWeekOne(isoWeekYear);
  const weeksFromIsoWeekOne = Math.floor(
    (utcCalendarTime(weekStart) - utcCalendarTime(isoWeekOneStart)) / WEEK_MS,
  );

  if (weeksFromIsoWeekOne % 2 === 0) {
    return weekStart;
  }

  return new Date(Date.UTC(
    weekStart.getUTCFullYear(),
    weekStart.getUTCMonth(),
    weekStart.getUTCDate() - 7,
  ));
}

function alignDateToBucketStart(date: Date, timeInterval: TimeIntervals): Date {
  switch (timeInterval) {
    case TimeIntervals.Hourly:
      return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        0,
        0,
        0,
      ));
    case TimeIntervals.Daily:
      return startOfDay(date);
    case TimeIntervals.Weekly:
      return startOfWeek(date);
    case TimeIntervals.BiWeekly:
      return startOfBiWeek(date);
    case TimeIntervals.Monthly:
      return startOfMonth(date);
    case TimeIntervals.Quarterly:
      return startOfQuarter(date);
    case TimeIntervals.Semesterly:
      return startOfSemester(date);
    case TimeIntervals.Yearly:
      return startOfYear(date);
    default:
      return new Date(date.getTime());
  }
}

function addBucketInterval(date: Date, timeInterval: TimeIntervals): Date {
  switch (timeInterval) {
    case TimeIntervals.Hourly:
      return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours() + 1,
        0,
        0,
        0,
      ));
    case TimeIntervals.Daily:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
    case TimeIntervals.Weekly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 7));
    case TimeIntervals.BiWeekly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 14));
    case TimeIntervals.Monthly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    case TimeIntervals.Quarterly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1));
    case TimeIntervals.Semesterly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 6, 1));
    case TimeIntervals.Yearly:
      return new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
    default:
      return new Date(date.getTime());
  }
}

function resolveTotalBucketCount(
  dateRange: NormalizedInsightQuery['dateRange'],
  timeInterval: TimeIntervals,
): number {
  if (dateRange.kind !== 'bounded') {
    return 0;
  }

  const startDate = new Date(dateRange.startDate);
  const endDate = new Date(dateRange.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate.getTime() > endDate.getTime()) {
    return 0;
  }

  let cursor = alignDateToBucketStart(startDate, timeInterval);
  let totalBucketCount = 0;
  while (cursor.getTime() <= endDate.getTime()) {
    totalBucketCount += 1;
    const nextCursor = addBucketInterval(cursor, timeInterval);
    if (nextCursor.getTime() <= cursor.getTime()) {
      break;
    }
    cursor = nextCursor;
  }

  return totalBucketCount;
}

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

function buildBucketCoverage(
  query: NormalizedInsightQuery,
  aggregation: {
    resolvedTimeInterval: TimeIntervals;
    buckets: Array<unknown>;
  },
): AiInsightSummary['bucketCoverage'] {
  if (query.categoryType !== ChartDataCategoryTypes.DateType || query.dateRange.kind !== 'bounded') {
    return null;
  }

  const totalBucketCount = resolveTotalBucketCount(query.dateRange, aggregation.resolvedTimeInterval);
  if (totalBucketCount <= 0) {
    return null;
  }

  return {
    nonEmptyBucketCount: aggregation.buckets.length,
    totalBucketCount,
  };
}

function buildTrend(
  query: NormalizedInsightQuery,
  aggregation: {
    buckets: Array<{
      bucketKey: string | number;
      time?: number;
      aggregateValue: number;
      totalCount: number;
    }>;
  },
): AiInsightSummary['trend'] {
  if (query.categoryType !== ChartDataCategoryTypes.DateType || aggregation.buckets.length < 2) {
    return null;
  }

  const previousBucket = aggregation.buckets[aggregation.buckets.length - 2] ?? null;
  const latestBucket = aggregation.buckets[aggregation.buckets.length - 1] ?? null;
  if (!previousBucket || !latestBucket) {
    return null;
  }

  return {
    previousBucket: {
      bucketKey: previousBucket.bucketKey,
      time: previousBucket.time,
      aggregateValue: previousBucket.aggregateValue,
      totalCount: previousBucket.totalCount,
    },
    deltaAggregateValue: latestBucket.aggregateValue - previousBucket.aggregateValue,
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
      return 'I can answer a curated set of event-level metrics right now, such as distance, duration, ascent, descent, cadence, power, heart rate, speed, pace, calories, and selected performance metrics like TSS, normalized power, intensity factor, VO2 max, EPOC, training effect, and recovery time.';
  }
}

function buildUnsupportedResponse(
  reasonCode: AiInsightsUnsupportedReasonCode,
  quota?: AiInsightsQuotaStatusResponse,
): AiInsightsResponse {
  return {
    status: 'unsupported',
    narrative: buildUnsupportedNarrative(reasonCode),
    ...(quota ? { quota } : {}),
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
    resolvedTimeInterval: TimeIntervals;
    buckets: Array<{
      bucketKey: string | number;
      time?: number;
      aggregateValue: number;
      totalCount: number;
    }>;
  },
  matchedEventCount: number,
  matchedActivityTypeCounts: Array<{ activityType: string; eventCount: number }>,
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
    activityMix: buildActivityMix(matchedActivityTypeCounts),
    bucketCoverage: buildBucketCoverage(query, aggregation),
    trend: buildTrend(query, aggregation),
  };
}

function serializeErrorForLogging(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithMetadata = error as Error & {
      code?: unknown;
      details?: unknown;
      cause?: unknown;
    };

    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(typeof error.stack === 'string' ? { errorStack: error.stack } : {}),
      ...(errorWithMetadata.code !== undefined ? { errorCode: errorWithMetadata.code } : {}),
      ...(errorWithMetadata.details !== undefined ? { errorDetails: errorWithMetadata.details } : {}),
      ...(errorWithMetadata.cause !== undefined ? { errorCause: `${errorWithMetadata.cause}` } : {}),
    };
  }

  if (typeof error === 'object' && error !== null) {
    const errorRecord = error as Record<string, unknown>;
    return {
      ...(typeof errorRecord.name === 'string' ? { errorName: errorRecord.name } : {}),
      ...(typeof errorRecord.message === 'string' ? { errorMessage: errorRecord.message } : {}),
      ...(typeof errorRecord.stack === 'string' ? { errorStack: errorRecord.stack } : {}),
      ...(errorRecord.code !== undefined ? { errorCode: errorRecord.code } : {}),
      ...(errorRecord.details !== undefined ? { errorDetails: errorRecord.details } : {}),
      ...(errorRecord.cause !== undefined ? { errorCause: `${errorRecord.cause}` } : {}),
      errorType: 'object',
    };
  }

  return {
    errorMessage: `${error}`,
    errorType: typeof error,
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

  const initialQuotaStatus = await getAiInsightsQuotaStatusForUser(context.auth.uid);
  if (!initialQuotaStatus.isEligible) {
    throw new HttpsError('permission-denied', AI_INSIGHTS_PAID_REQUIRED_MESSAGE);
  }

  if (initialQuotaStatus.remainingCount <= 0) {
    throw new HttpsError('resource-exhausted', AI_INSIGHTS_LIMIT_REACHED_MESSAGE);
  }

  const normalizeResult = await normalizeInsightQuery({
    ...input,
    prompt,
    clientTimezone,
  });

  if (normalizeResult.status === 'unsupported') {
    logger.warn('[aiInsights] Unsupported request', {
      userID: context.auth.uid,
      prompt,
      clientTimezone,
      reasonCode: normalizeResult.reasonCode,
      suggestedPromptsCount: normalizeResult.suggestedPrompts.length,
    });
    return buildUnsupportedResponse(normalizeResult.reasonCode, initialQuotaStatus);
  }

  const metric = getInsightMetricDefinition(normalizeResult.metricKey);
  if (!metric) {
    logger.warn('[aiInsights] Unsupported metric key after normalization', {
      userID: context.auth.uid,
      prompt,
      clientTimezone,
      metricKey: normalizeResult.metricKey,
    });
    return buildUnsupportedResponse('unsupported_metric', initialQuotaStatus);
  }

  const effectiveQuery = normalizeResult.query;
  logger.info('[aiInsights] Query normalization debug', {
    prompt,
    userID: context.auth.uid,
    normalizedQuery: {
      dataType: effectiveQuery.dataType,
      valueType: effectiveQuery.valueType,
      categoryType: effectiveQuery.categoryType,
      requestedTimeInterval: effectiveQuery.requestedTimeInterval,
      chartType: effectiveQuery.chartType,
      activityTypesCount: effectiveQuery.activityTypes.length,
      activityTypeGroupsCount: effectiveQuery.activityTypeGroups.length,
    },
  });
  const unitSettings = await loadUserUnitSettings(context.auth.uid);
  const executionResult = await executeAiInsightsQuery(context.auth.uid, effectiveQuery, prompt);
  const summary = buildInsightSummary(
    effectiveQuery,
    executionResult.aggregation,
    executionResult.matchedEventsCount,
    executionResult.matchedActivityTypeCounts,
  );
  const presentation = buildInsightPresentation(effectiveQuery, metric.label);
  const isEmpty = executionResult.aggregation.buckets.length === 0;
  const emptyPresentation = {
    ...presentation,
    emptyState: DEFAULT_EMPTY_STATE,
  };

  const quotaReservation = await reserveAiInsightsQuotaForGenkit(context.auth.uid);
  let narrativeResult: Awaited<ReturnType<typeof summarizeAiInsightResult>>;
  try {
    narrativeResult = await summarizeAiInsightResult({
      status: isEmpty ? 'empty' : 'ok',
      prompt,
      metricLabel: metric.label,
      query: effectiveQuery,
      aggregation: executionResult.aggregation,
      summary,
      presentation: isEmpty ? emptyPresentation : presentation,
      clientLocale: input.clientLocale,
      unitSettings,
    });
  } catch (error) {
    try {
      await releaseAiInsightsQuotaReservation(quotaReservation);
    } catch (releaseError) {
      logger.error('[aiInsights] Failed to release quota reservation after summarize-result failure', {
        userID: context.auth.uid,
        prompt,
        releaseError,
      });
    }
    throw error;
  }
  const quota = narrativeResult.source === 'genkit'
    ? await finalizeAiInsightsQuotaReservation(quotaReservation)
    : await releaseAiInsightsQuotaReservation(quotaReservation);

  if (isEmpty) {
    return {
      status: 'empty',
      narrative: narrativeResult.narrative,
      quota,
      query: effectiveQuery,
      aggregation: executionResult.aggregation,
      summary,
      presentation: emptyPresentation,
    };
  }

  return {
      status: 'ok',
      narrative: narrativeResult.narrative,
      quota,
      query: effectiveQuery,
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

    const context = aiInsightsGenkit.currentContext() as AiInsightsCallableContext | undefined;
    logger.error('[aiInsights] Failed to generate AI insight', {
      userID: context?.auth?.uid ?? null,
      prompt: typeof input?.prompt === 'string' ? input.prompt : null,
      clientTimezone: typeof input?.clientTimezone === 'string' ? input.clientTimezone : null,
      ...serializeErrorForLogging(error),
    });
    throw new HttpsError('internal', 'Could not generate AI insights.');
  }
});

export const aiInsights = onCallGenkit({
  region: FUNCTIONS_MANIFEST.aiInsights.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
  memory: '2GiB',
  timeoutSeconds: 180,
  maxInstances: 10,
}, aiInsightsFlow);

export const getAiInsightsQuotaStatus = onCall({
  region: FUNCTIONS_MANIFEST.getAiInsightsQuotaStatus.region,
  cors: ALLOWED_CORS_ORIGINS,
  enforceAppCheck: true,
}, async (request): Promise<AiInsightsQuotaStatusResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  enforceAppCheck(request);
  return getAiInsightsQuotaStatusForUser(request.auth.uid);
});
