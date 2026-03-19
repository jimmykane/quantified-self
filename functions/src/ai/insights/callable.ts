import { HttpsError, onCall, onCallGenkit } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import type {
  AiInsightEventLookup,
  AiInsightSummary,
  AiInsightsAggregateOkResponse,
  AiInsightsEventLookupOkResponse,
  AiInsightsQuotaStatusResponse,
  AiInsightsRequest,
  AiInsightsResponse,
} from '../../../../shared/ai-insights.types';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../../utils';
import { aiInsightsGenkit } from './genkit';
import { executeAiInsightsQuery } from './execute-query';
import { getInsightMetricDefinition } from './metric-catalog';
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
import { serializeErrorForLogging } from './error-logging';
import {
  assertValidTimeZone,
  buildEmptyAggregation,
  buildInsightPresentation,
  buildUnsupportedResponse,
} from './insight-presentation';
import {
  buildInsightSummary,
  buildNonAggregateEmptySummary,
} from './insight-summary';

interface AiInsightsCallableContext {
  auth?: {
    uid?: string;
  };
  app?: unknown;
}

const AI_INSIGHTS_PAID_REQUIRED_MESSAGE = 'AI Insights is available to Basic and Pro members.';
const DEFAULT_EMPTY_STATE = 'No matching events were found for this insight in the requested range.';

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
    return buildUnsupportedResponse(normalizeResult.reasonCode, initialQuotaStatus, {
      suggestedPrompts: normalizeResult.suggestedPrompts,
    });
  }

  const metric = getInsightMetricDefinition(normalizeResult.metricKey);
  if (!metric) {
    logger.warn('[aiInsights] Unsupported metric key after normalization', {
      userID: context.auth.uid,
      prompt,
      clientTimezone,
      metricKey: normalizeResult.metricKey,
    });
    return buildUnsupportedResponse('unsupported_metric', initialQuotaStatus, {
      sourceText: prompt,
    });
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
  const presentation = buildInsightPresentation(effectiveQuery, metric.label);
  const emptyPresentation = {
    ...presentation,
    emptyState: DEFAULT_EMPTY_STATE,
  };

  const aggregateSummary = executionResult.resultKind === 'aggregate'
    ? buildInsightSummary(
      effectiveQuery,
      executionResult.aggregation,
      executionResult.matchedEventsCount,
      executionResult.matchedActivityTypeCounts,
    )
    : null;
  const eventLookupResult = executionResult.resultKind === 'event_lookup'
    ? executionResult.eventLookup
    : null;
  const isEmpty = executionResult.resultKind === 'aggregate'
    ? executionResult.aggregation.buckets.length === 0
    : !eventLookupResult?.primaryEventId;

  const quotaReservation = await reserveAiInsightsQuotaForGenkit(context.auth.uid);
  let narrativeResult: Awaited<ReturnType<typeof summarizeAiInsightResult>>;
  try {
    narrativeResult = await summarizeAiInsightResult({
      status: isEmpty ? 'empty' : 'ok',
      prompt,
      metricLabel: metric.label,
      query: effectiveQuery,
      presentation: isEmpty ? emptyPresentation : presentation,
      clientLocale: input.clientLocale,
      unitSettings,
      ...(executionResult.resultKind === 'aggregate'
        ? {
          aggregation: executionResult.aggregation,
          summary: aggregateSummary as AiInsightSummary,
        }
        : {
          eventLookup: {
            matchedEventCount: executionResult.matchedEventsCount,
            primaryEvent: eventLookupResult?.rankedEvents[0] ?? null,
            rankedEvents: eventLookupResult?.rankedEvents.slice(0, 10) ?? [],
          },
        }),
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
      aggregation: executionResult.resultKind === 'aggregate'
        ? executionResult.aggregation
        : buildEmptyAggregation(effectiveQuery),
      summary: aggregateSummary ?? buildNonAggregateEmptySummary(),
      presentation: emptyPresentation,
    };
  }

  if (executionResult.resultKind === 'event_lookup') {
    const eventLookupQuery = {
      ...effectiveQuery,
      resultKind: 'event_lookup' as const,
    };
    return {
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: narrativeResult.narrative,
      quota,
      query: eventLookupQuery,
      eventLookup: {
        primaryEventId: eventLookupResult?.primaryEventId as string,
        topEventIds: eventLookupResult?.topEventIds ?? [],
        matchedEventCount: executionResult.matchedEventsCount,
      } satisfies AiInsightEventLookup,
      presentation,
    } satisfies AiInsightsEventLookupOkResponse;
  }

  const aggregateQuery = {
    ...effectiveQuery,
    resultKind: 'aggregate' as const,
  };
  return {
    status: 'ok',
    resultKind: 'aggregate',
    narrative: narrativeResult.narrative,
    quota,
    query: aggregateQuery,
    aggregation: executionResult.aggregation,
    summary: aggregateSummary as AiInsightSummary,
    presentation,
  } satisfies AiInsightsAggregateOkResponse;
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
