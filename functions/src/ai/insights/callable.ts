import { HttpsError, onCall, onCallGenkit } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import type {
  AiInsightEventLookup,
  AiInsightSummary,
  AiInsightsAggregateOkResponse,
  AiInsightsEventLookupOkResponse,
  AiInsightsMultiMetricAggregateMetricResult,
  AiInsightsMultiMetricAggregateOkResponse,
  AiInsightsQuotaStatusResponse,
  AiInsightsRequest,
  AiInsightsResponse,
  NormalizedInsightAggregateQuery,
  NormalizedInsightEventLookupQuery,
  NormalizedInsightMultiMetricAggregateQuery,
} from '../../../../shared/ai-insights.types';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../../utils';
import { aiInsightsGenkit } from './genkit';
import { executeAiInsightsQuery } from './execute-query';
import { getInsightMetricDefinition } from './metric-catalog';
import { normalizeInsightQuery } from './normalize-query.flow';
import { repairUnsupportedInsightQuery } from './normalize-query.repair';
import { AiInsightsRequestSchema, AiInsightsResponseSchema } from './schemas';
import {
  getAiInsightsQuotaStatus as getAiInsightsQuotaStatusForUser,
  releaseAiInsightsQuotaReservation,
  reserveAiInsightsQuotaForRequest,
  finalizeAiInsightsQuotaReservation,
  AI_INSIGHTS_LIMIT_REACHED_MESSAGE,
  type AiInsightsUserRoleContext,
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
    token?: Record<string, unknown>;
  };
  app?: unknown;
}

const AI_INSIGHTS_PAID_REQUIRED_MESSAGE = 'AI Insights is available to Basic and Pro members.';
const DEFAULT_EMPTY_STATE = 'No matching events were found for this insight in the requested range.';

function shouldUseCallableTokenForQuotaRoleContext(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true'
    || Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

function parseGracePeriodUntilClaim(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
  }

  return undefined;
}

function buildQuotaRoleContextFromCallableAuth(
  auth: { token?: Record<string, unknown> } | undefined,
): AiInsightsUserRoleContext | null {
  const role = auth?.token?.stripeRole;
  if (typeof role !== 'string' || !role.trim()) {
    return null;
  }

  const gracePeriodUntil = parseGracePeriodUntilClaim(auth?.token?.gracePeriodUntil);
  if (gracePeriodUntil === undefined) {
    return { role };
  }

  return {
    role,
    gracePeriodUntil,
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

  const userID = context.auth.uid;
  const quotaRoleContext = shouldUseCallableTokenForQuotaRoleContext()
    ? buildQuotaRoleContextFromCallableAuth(context.auth)
    : null;

  const clientTimezone = `${input.clientTimezone || ''}`.trim();
  if (!clientTimezone) {
    throw new HttpsError('invalid-argument', 'clientTimezone is required.');
  }
  assertValidTimeZone(clientTimezone);

  const initialQuotaStatus = quotaRoleContext
    ? await getAiInsightsQuotaStatusForUser(userID, quotaRoleContext)
    : await getAiInsightsQuotaStatusForUser(userID);
  if (!initialQuotaStatus.isEligible) {
    throw new HttpsError('permission-denied', AI_INSIGHTS_PAID_REQUIRED_MESSAGE);
  }

  if (initialQuotaStatus.remainingCount <= 0) {
    throw new HttpsError('resource-exhausted', AI_INSIGHTS_LIMIT_REACHED_MESSAGE);
  }

  let quotaReservation: Awaited<ReturnType<typeof reserveAiInsightsQuotaForRequest>> | null = null;
  let consumedQuotaStatus: AiInsightsQuotaStatusResponse | null = null;

  const ensureQuotaReservation = async (): Promise<void> => {
    if (quotaReservation || consumedQuotaStatus) {
      return;
    }

    quotaReservation = quotaRoleContext
      ? await reserveAiInsightsQuotaForRequest(userID, quotaRoleContext)
      : await reserveAiInsightsQuotaForRequest(userID);
  };

  const finalizeReservedQuota = async (): Promise<AiInsightsQuotaStatusResponse> => {
    if (consumedQuotaStatus) {
      return consumedQuotaStatus;
    }

    if (!quotaReservation) {
      return initialQuotaStatus;
    }

    consumedQuotaStatus = await finalizeAiInsightsQuotaReservation(quotaReservation);
    quotaReservation = null;
    return consumedQuotaStatus;
  };

  const releaseReservedQuota = async (): Promise<AiInsightsQuotaStatusResponse> => {
    if (consumedQuotaStatus) {
      return consumedQuotaStatus;
    }

    if (!quotaReservation) {
      return initialQuotaStatus;
    }

    const releasedStatus = await releaseAiInsightsQuotaReservation(quotaReservation);
    quotaReservation = null;
    return releasedStatus;
  };

  let normalizeResult = await normalizeInsightQuery({
    ...input,
    prompt,
    clientTimezone,
  });

  if (normalizeResult.status === 'unsupported') {
    const shouldAttemptRepair = normalizeResult.reasonCode === 'invalid_prompt'
      || normalizeResult.reasonCode === 'unsupported_metric'
      || normalizeResult.reasonCode === 'ambiguous_metric';

    if (shouldAttemptRepair) {
      await ensureQuotaReservation();
      const repairedResult = await repairUnsupportedInsightQuery({
        ...input,
        prompt,
        clientTimezone,
      }, normalizeResult);
      if (repairedResult.source === 'genkit') {
        await finalizeReservedQuota();
      }

      normalizeResult = repairedResult.result;
      if (normalizeResult.status === 'unsupported') {
        const quota = repairedResult.source === 'genkit'
          ? (consumedQuotaStatus ?? await finalizeReservedQuota())
          : await releaseReservedQuota();
        logger.warn('[aiInsights] Unsupported request', {
          userID,
          prompt,
          clientTimezone,
          reasonCode: normalizeResult.reasonCode,
          suggestedPromptsCount: normalizeResult.suggestedPrompts.length,
          repairedWithAi: repairedResult.source === 'genkit',
        });
        return buildUnsupportedResponse(normalizeResult.reasonCode, quota, {
          suggestedPrompts: normalizeResult.suggestedPrompts,
        });
      }
    } else {
      const quota = await releaseReservedQuota();
      logger.warn('[aiInsights] Unsupported request', {
        userID,
        prompt,
        clientTimezone,
        reasonCode: normalizeResult.reasonCode,
        suggestedPromptsCount: normalizeResult.suggestedPrompts.length,
        repairedWithAi: false,
      });
      return buildUnsupportedResponse(normalizeResult.reasonCode, quota, {
        suggestedPrompts: normalizeResult.suggestedPrompts,
      });
    }
  }

  const effectiveQuery = normalizeResult.query;
  const aggregateQueryInput = effectiveQuery.resultKind === 'aggregate' ? effectiveQuery : null;
  const eventLookupQueryInput = effectiveQuery.resultKind === 'event_lookup' ? effectiveQuery : null;
  const multiMetricQueryInput = effectiveQuery.resultKind === 'multi_metric_aggregate' ? effectiveQuery : null;
  const metric = normalizeResult.metricKey
    ? getInsightMetricDefinition(normalizeResult.metricKey)
    : null;
  if (effectiveQuery.resultKind !== 'multi_metric_aggregate' && !metric) {
    logger.warn('[aiInsights] Unsupported metric key after normalization', {
      userID,
      prompt,
      clientTimezone,
      metricKey: normalizeResult.metricKey,
    });
    return buildUnsupportedResponse('unsupported_metric', initialQuotaStatus, {
      sourceText: prompt,
    });
  }
  const multiMetricDefinitions = effectiveQuery.resultKind === 'multi_metric_aggregate'
    ? effectiveQuery.metricSelections
      .map((metricSelection) => ({
        metricSelection,
        metric: getInsightMetricDefinition(metricSelection.metricKey),
      }))
      .filter((entry): entry is { metricSelection: typeof effectiveQuery.metricSelections[number]; metric: NonNullable<ReturnType<typeof getInsightMetricDefinition>> } => Boolean(entry.metric))
    : [];
  if (
    effectiveQuery.resultKind === 'multi_metric_aggregate'
    && multiMetricDefinitions.length !== effectiveQuery.metricSelections.length
  ) {
      logger.warn('[aiInsights] Unsupported multi metric selection after normalization', {
      userID,
      prompt,
      clientTimezone,
      metricKeys: effectiveQuery.metricSelections.map(metricSelection => metricSelection.metricKey),
    });
    return buildUnsupportedResponse('unsupported_multi_metric_combination', initialQuotaStatus, {
      sourceText: prompt,
    });
  }
  logger.info('[aiInsights] Query normalization debug', {
    prompt,
    userID,
    normalizedQuery: {
      dataType: effectiveQuery.resultKind === 'multi_metric_aggregate'
        ? null
        : effectiveQuery.dataType,
      valueType: effectiveQuery.resultKind === 'multi_metric_aggregate'
        ? null
        : effectiveQuery.valueType,
      categoryType: effectiveQuery.categoryType,
      requestedTimeInterval: effectiveQuery.requestedTimeInterval,
      chartType: effectiveQuery.chartType,
      activityTypesCount: effectiveQuery.activityTypes.length,
      activityTypeGroupsCount: effectiveQuery.activityTypeGroups.length,
      metricSelectionCount: effectiveQuery.resultKind === 'multi_metric_aggregate'
        ? effectiveQuery.metricSelections.length
        : 1,
    },
  });
  const unitSettings = await loadUserUnitSettings(userID);
  const executionResult = await executeAiInsightsQuery(userID, effectiveQuery, prompt);
  const presentation = buildInsightPresentation(
    effectiveQuery,
    effectiveQuery.resultKind === 'multi_metric_aggregate'
      ? multiMetricDefinitions.map(entry => entry.metric.label)
      : (metric as NonNullable<typeof metric>).label,
  );
  const emptyPresentation = {
    ...presentation,
    emptyState: DEFAULT_EMPTY_STATE,
  };

  const aggregateSummary = executionResult.resultKind === 'aggregate'
    && aggregateQueryInput
    ? buildInsightSummary(
      aggregateQueryInput,
      executionResult.aggregation,
      executionResult.matchedEventsCount,
      executionResult.matchedActivityTypeCounts,
    )
    : null;
  const eventLookupResult = executionResult.resultKind === 'event_lookup'
    ? executionResult.eventLookup
    : null;
  const multiMetricResultGroups = executionResult.resultKind === 'multi_metric_aggregate'
    && multiMetricQueryInput
    ? executionResult.metricResults.map((metricResult) => {
      const metricDefinition = multiMetricDefinitions.find(entry => entry.metricSelection.metricKey === metricResult.metricKey)?.metric;
      const metricQuery: NormalizedInsightAggregateQuery = {
        resultKind: 'aggregate' as const,
        dataType: metricResult.aggregation.dataType,
        valueType: metricResult.aggregation.valueType,
        categoryType: metricResult.aggregation.categoryType as NormalizedInsightAggregateQuery['categoryType'],
        requestedTimeInterval: multiMetricQueryInput.requestedTimeInterval,
        activityTypeGroups: multiMetricQueryInput.activityTypeGroups,
        activityTypes: multiMetricQueryInput.activityTypes,
        dateRange: multiMetricQueryInput.dateRange,
        chartType: multiMetricQueryInput.chartType,
      };

      return {
        metricKey: metricResult.metricKey,
        metricLabel: metricDefinition?.label ?? metricResult.metricKey,
        query: metricQuery,
        aggregation: metricResult.aggregation,
        summary: buildInsightSummary(
          multiMetricQueryInput.groupingMode === 'date'
            ? metricQuery
            : multiMetricQueryInput,
          metricResult.aggregation,
          metricResult.matchedEventsCount,
          metricResult.matchedActivityTypeCounts,
        ),
        presentation: buildInsightPresentation(metricQuery, metricDefinition?.label ?? metricResult.metricKey),
      } satisfies AiInsightsMultiMetricAggregateMetricResult;
    })
    : [];
  const isEmpty = executionResult.resultKind === 'aggregate'
    ? executionResult.aggregation.buckets.length === 0
    : executionResult.resultKind === 'event_lookup'
      ? !eventLookupResult?.primaryEventId
      : multiMetricResultGroups.every(metricResult => metricResult.aggregation.buckets.length === 0);

  let narrativeResult: Awaited<ReturnType<typeof summarizeAiInsightResult>>;
  try {
    await ensureQuotaReservation();
    if (executionResult.resultKind === 'aggregate' && aggregateQueryInput) {
      narrativeResult = await summarizeAiInsightResult({
        status: isEmpty ? 'empty' : 'ok',
        prompt,
        metricLabel: (metric as NonNullable<typeof metric>).label,
        query: aggregateQueryInput,
        aggregation: executionResult.aggregation,
        summary: aggregateSummary as AiInsightSummary,
        presentation: isEmpty ? emptyPresentation : presentation,
        clientLocale: input.clientLocale,
        unitSettings,
      });
    } else if (executionResult.resultKind === 'event_lookup' && eventLookupQueryInput) {
      narrativeResult = await summarizeAiInsightResult({
        status: isEmpty ? 'empty' : 'ok',
        prompt,
        metricLabel: (metric as NonNullable<typeof metric>).label,
        query: eventLookupQueryInput,
        eventLookup: {
          matchedEventCount: executionResult.matchedEventsCount,
          primaryEvent: eventLookupResult?.rankedEvents[0] ?? null,
          rankedEvents: eventLookupResult?.rankedEvents.slice(0, 10) ?? [],
        },
        presentation: isEmpty ? emptyPresentation : presentation,
        clientLocale: input.clientLocale,
        unitSettings,
      });
    } else if (executionResult.resultKind === 'multi_metric_aggregate' && multiMetricQueryInput) {
      narrativeResult = await summarizeAiInsightResult({
        status: isEmpty ? 'empty' : 'ok',
        prompt,
        query: multiMetricQueryInput,
        metricLabels: multiMetricDefinitions.map(entry => entry.metric.label),
        metricResults: multiMetricResultGroups,
        presentation: isEmpty ? emptyPresentation : presentation,
        clientLocale: input.clientLocale,
        unitSettings,
      });
    } else {
      throw new HttpsError('internal', 'Could not summarize AI insights.');
    }
  } catch (error) {
    try {
      await releaseReservedQuota();
    } catch (releaseError) {
        logger.error('[aiInsights] Failed to release quota reservation after summarize-result failure', {
        userID,
        prompt,
        releaseError,
      });
    }
    throw error;
  }
  const quota = consumedQuotaStatus
    ?? (
      narrativeResult.source === 'genkit'
        ? await finalizeReservedQuota()
        : await releaseReservedQuota()
    );

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
    return {
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: narrativeResult.narrative,
      quota,
      query: eventLookupQueryInput as NormalizedInsightEventLookupQuery,
      eventLookup: {
        primaryEventId: eventLookupResult?.primaryEventId as string,
        topEventIds: eventLookupResult?.topEventIds ?? [],
        matchedEventCount: executionResult.matchedEventsCount,
      } satisfies AiInsightEventLookup,
      presentation,
    } satisfies AiInsightsEventLookupOkResponse;
  }

  if (executionResult.resultKind === 'multi_metric_aggregate') {
    return {
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      narrative: narrativeResult.narrative,
      quota,
      query: multiMetricQueryInput as NormalizedInsightMultiMetricAggregateQuery,
      metricResults: multiMetricResultGroups,
      presentation,
    } satisfies AiInsightsMultiMetricAggregateOkResponse;
  }

  return {
    status: 'ok',
    resultKind: 'aggregate',
    narrative: narrativeResult.narrative,
    quota,
    query: aggregateQueryInput as NormalizedInsightAggregateQuery,
    aggregation: executionResult.aggregation,
    summary: aggregateSummary as AiInsightSummary,
    ...(executionResult.eventRanking
      ? {
        eventRanking: {
          primaryEventId: executionResult.eventRanking.primaryEventId as string,
          topEventIds: executionResult.eventRanking.topEventIds,
          matchedEventCount: executionResult.eventRanking.matchedEventCount,
        } satisfies AiInsightEventLookup,
      }
      : {}),
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
  const quotaRoleContext = shouldUseCallableTokenForQuotaRoleContext()
    ? buildQuotaRoleContextFromCallableAuth(request.auth)
    : null;

  if (quotaRoleContext) {
    return getAiInsightsQuotaStatusForUser(request.auth.uid, quotaRoleContext);
  }

  return getAiInsightsQuotaStatusForUser(request.auth.uid);
});
