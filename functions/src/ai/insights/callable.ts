import { HttpsError, onCall, onCallGenkit } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { z } from 'genkit';
import type {
  AiInsightsMultiMetricAggregateMetricResult,
  AiInsightsQuotaStatusResponse,
  AiInsightsRequest,
  AiInsightsResponse,
  NormalizedInsightAggregateQuery,
} from '../../../../shared/ai-insights.types';
import { AiInsightsResponseSchema } from '../../../../shared/ai-insights-response.contract';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../../utils';
import { aiInsightsGenkit } from './genkit';
import { getInsightMetricDefinition } from './metric-catalog';
import {
  trimPromptSample,
} from './repaired-prompt-backlog';
import { AiInsightsRequestSchema } from './schemas';
import {
  aiInsightsRuntime,
  AI_INSIGHTS_LIMIT_REACHED_MESSAGE,
  type AiInsightsUserRoleContext,
} from './runtime';
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
import {
  type CallableResultKindContext,
  resolveCallableResultKindHandler,
} from './callable.result-kind-handlers';

interface AiInsightsCallableContext {
  auth?: {
    uid?: string;
    token?: Record<string, unknown>;
  };
  app?: unknown;
}

const AI_INSIGHTS_PAID_REQUIRED_MESSAGE = 'AI Insights is available to Basic and Pro members.';
const DEFAULT_EMPTY_STATE = 'No matching events were found for this insight in the requested range.';
const AI_INSIGHTS_LOG_PROMPT_PREVIEW_MAX_CHARS = 60;

function buildPromptLogContext(
  prompt: string | null | undefined,
  effectivePrompt?: string | null | undefined,
): {
  promptLength: number;
  promptPreview: string | null;
  effectivePromptLength?: number;
  effectivePromptPreview?: string | null;
} {
  const normalizedPrompt = `${prompt || ''}`.trim();
  const normalizedEffectivePrompt = effectivePrompt === undefined
    ? undefined
    : `${effectivePrompt || ''}`.trim();

  return {
    promptLength: normalizedPrompt.length,
    promptPreview: normalizedPrompt
      ? trimPromptSample(normalizedPrompt, AI_INSIGHTS_LOG_PROMPT_PREVIEW_MAX_CHARS)
      : null,
    ...(normalizedEffectivePrompt === undefined
      ? {}
      : {
        effectivePromptLength: normalizedEffectivePrompt.length,
        effectivePromptPreview: normalizedEffectivePrompt
          ? trimPromptSample(normalizedEffectivePrompt, AI_INSIGHTS_LOG_PROMPT_PREVIEW_MAX_CHARS)
          : null,
      }),
  };
}

function shouldUseCallableTokenForQuotaRoleContext(): boolean {
  // Only trust callable JWT role claims while running the Cloud Functions emulator.
  // In hosted environments, claims can be stale and Firestore remains the source of truth.
  // Do not gate this on FIREBASE_AUTH_EMULATOR_HOST alone, because accidental env leakage
  // could otherwise switch production/staging behavior to claim-based quota role resolution.
  return process.env.FUNCTIONS_EMULATOR === 'true';
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
  // In emulator mode, missing/blank stripeRole claims intentionally fall back
  // to Firestore role resolution so free/legacy test users still follow the
  // production source-of-truth path instead of forcing claim-based behavior.
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
    ? await aiInsightsRuntime.getAiInsightsQuotaStatus(userID, quotaRoleContext)
    : await aiInsightsRuntime.getAiInsightsQuotaStatus(userID);
  if (!initialQuotaStatus.isEligible) {
    throw new HttpsError('permission-denied', AI_INSIGHTS_PAID_REQUIRED_MESSAGE);
  }

  if (initialQuotaStatus.remainingCount <= 0) {
    throw new HttpsError('resource-exhausted', AI_INSIGHTS_LIMIT_REACHED_MESSAGE);
  }

  let quotaReservation: Awaited<ReturnType<typeof aiInsightsRuntime.reserveAiInsightsQuotaForRequest>> | null = null;
  let consumedQuotaStatus: AiInsightsQuotaStatusResponse | null = null;

  const ensureQuotaReservation = async (): Promise<void> => {
    if (quotaReservation || consumedQuotaStatus) {
      return;
    }

    quotaReservation = quotaRoleContext
      ? await aiInsightsRuntime.reserveAiInsightsQuotaForRequest(userID, quotaRoleContext)
      : await aiInsightsRuntime.reserveAiInsightsQuotaForRequest(userID);
  };
  await ensureQuotaReservation();

  const releaseReservedQuota = async (): Promise<AiInsightsQuotaStatusResponse> => {
    if (consumedQuotaStatus) {
      return consumedQuotaStatus;
    }

    if (!quotaReservation) {
      return initialQuotaStatus;
    }

    const releasedStatus = await aiInsightsRuntime.releaseAiInsightsQuotaReservation(quotaReservation);
    quotaReservation = null;
    return releasedStatus;
  };

  const resolveQuotaForResponse = async (): Promise<AiInsightsQuotaStatusResponse> => (
    consumedQuotaStatus ?? await releaseReservedQuota()
  );

  const consumeQuotaOnAiAttempt = async (
    stage: 'sanitize' | 'repair' | 'summarize',
  ): Promise<AiInsightsQuotaStatusResponse> => {
    if (consumedQuotaStatus) {
      return consumedQuotaStatus;
    }

    await ensureQuotaReservation();
    consumedQuotaStatus = await aiInsightsRuntime.finalizeAiInsightsQuotaReservation(
      quotaReservation as NonNullable<typeof quotaReservation>,
    );
    quotaReservation = null;
    logger.info('[aiInsights] Consumed prompt quota on AI attempt', {
      userID,
      stage,
      ...buildPromptLogContext(prompt),
    });
    return consumedQuotaStatus;
  };

  try {
  let effectivePrompt = prompt;
  const promptLanguage = aiInsightsRuntime.detectPromptLanguageDeterministic(prompt);
  logger.info('[aiInsights] Prompt language gate result', {
    userID,
    ...buildPromptLogContext(prompt),
    promptLanguage,
  });

  if (promptLanguage !== 'english') {
    logger.info('[aiInsights] Starting AI prompt sanitization', {
      userID,
      ...buildPromptLogContext(prompt),
      promptLanguage,
    });
    await consumeQuotaOnAiAttempt('sanitize');
    const sanitizationResult = await aiInsightsRuntime.sanitizePromptToEnglish(prompt);
    logger.info('[aiInsights] Finished AI prompt sanitization', {
      userID,
      ...buildPromptLogContext(prompt),
      status: sanitizationResult.status,
    });

    if (sanitizationResult.status === 'unsupported') {
      const quota = await resolveQuotaForResponse();
      logger.info('[aiInsights] Terminal result', {
        userID,
        ...buildPromptLogContext(prompt),
        resultCategory: 'unsupported',
        reasonCode: sanitizationResult.reasonCode,
        source: 'sanitize',
      });
      return buildUnsupportedResponse(sanitizationResult.reasonCode, quota, {
        suggestedPrompts: sanitizationResult.suggestedPrompts,
      });
    }

    effectivePrompt = sanitizationResult.prompt;
  }

  let normalizeResult = await aiInsightsRuntime.normalizeInsightQuery({
    ...input,
    prompt: effectivePrompt,
    clientTimezone,
  });

  if (normalizeResult.status === 'unsupported') {
    const shouldAttemptRepair = normalizeResult.reasonCode === 'invalid_prompt'
      || normalizeResult.reasonCode === 'unsupported_metric'
      || normalizeResult.reasonCode === 'ambiguous_metric';

    if (shouldAttemptRepair) {
      const deterministicFailureReasonCode = normalizeResult.reasonCode;
      logger.info('[aiInsights] Starting AI prompt repair', {
        userID,
        ...buildPromptLogContext(prompt, effectivePrompt),
        reasonCode: deterministicFailureReasonCode,
      });
      await consumeQuotaOnAiAttempt('repair');
      const repairedResult = await aiInsightsRuntime.repairUnsupportedInsightQuery({
        ...input,
        prompt: effectivePrompt,
        clientTimezone,
      }, normalizeResult);
      logger.info('[aiInsights] Finished AI prompt repair', {
        userID,
        ...buildPromptLogContext(prompt, effectivePrompt),
        source: repairedResult.source,
        status: repairedResult.result.status,
      });

      normalizeResult = repairedResult.result;
      if (repairedResult.source === 'genkit' && normalizeResult.status === 'ok') {
        let intentDocID: string | null = null;
        try {
          const repairIdentity = aiInsightsRuntime.buildAiInsightsPromptRepairIdentity(
            effectivePrompt,
            normalizeResult.query,
          );
          intentDocID = repairIdentity.intentDocID;
          await aiInsightsRuntime.recordSuccessfulAiInsightRepair({
            rawPrompt: prompt,
            repairInputPrompt: effectivePrompt,
            normalizedQuery: normalizeResult.query,
            deterministicFailureReasonCode,
            metricKey: normalizeResult.metricKey,
          });
          logger.info('[aiInsights] Recorded successful AI prompt repair for deterministic backlog', {
            userID,
            intentDocID,
            deterministicFailureReasonCode,
          });
        } catch (error) {
          logger.warn('[aiInsights] Failed to record successful AI prompt repair backlog entry.', {
            userID,
            intentDocID,
            deterministicFailureReasonCode,
            error,
          });
        }
      }

      if (normalizeResult.status === 'unsupported') {
        const quota = await resolveQuotaForResponse();
        logger.warn('[aiInsights] Unsupported request', {
          userID,
          ...buildPromptLogContext(prompt, effectivePrompt),
          clientTimezone,
          reasonCode: normalizeResult.reasonCode,
          suggestedPromptsCount: normalizeResult.suggestedPrompts.length,
          repairedWithAi: repairedResult.source === 'genkit',
        });
        logger.info('[aiInsights] Terminal result', {
          userID,
          ...buildPromptLogContext(prompt, effectivePrompt),
          resultCategory: 'unsupported',
          reasonCode: normalizeResult.reasonCode,
        });
        return buildUnsupportedResponse(normalizeResult.reasonCode, quota, {
          suggestedPrompts: normalizeResult.suggestedPrompts,
        });
      }
    } else {
      const quota = await resolveQuotaForResponse();
      logger.warn('[aiInsights] Unsupported request', {
        userID,
        ...buildPromptLogContext(prompt, effectivePrompt),
        clientTimezone,
        reasonCode: normalizeResult.reasonCode,
        suggestedPromptsCount: normalizeResult.suggestedPrompts.length,
        repairedWithAi: false,
      });
      logger.info('[aiInsights] Terminal result', {
        userID,
        ...buildPromptLogContext(prompt, effectivePrompt),
        resultCategory: 'unsupported',
        reasonCode: normalizeResult.reasonCode,
      });
      return buildUnsupportedResponse(normalizeResult.reasonCode, quota, {
        suggestedPrompts: normalizeResult.suggestedPrompts,
      });
    }
  }

  const effectiveQuery = normalizeResult.query;
  const aggregateQueryInput = effectiveQuery.resultKind === 'aggregate' ? effectiveQuery : null;
  const eventLookupQueryInput = effectiveQuery.resultKind === 'event_lookup' ? effectiveQuery : null;
  const latestEventQueryInput = effectiveQuery.resultKind === 'latest_event' ? effectiveQuery : null;
  const multiMetricQueryInput = effectiveQuery.resultKind === 'multi_metric_aggregate' ? effectiveQuery : null;
  const metric = normalizeResult.metricKey
    ? getInsightMetricDefinition(normalizeResult.metricKey)
    : null;
  if (
    effectiveQuery.resultKind !== 'multi_metric_aggregate'
    && effectiveQuery.resultKind !== 'latest_event'
    && !metric
  ) {
    logger.warn('[aiInsights] Unsupported metric key after normalization', {
      userID,
      ...buildPromptLogContext(prompt, effectivePrompt),
      clientTimezone,
      metricKey: normalizeResult.metricKey,
    });
    const quota = await resolveQuotaForResponse();
    logger.info('[aiInsights] Terminal result', {
      userID,
      ...buildPromptLogContext(prompt, effectivePrompt),
      resultCategory: 'unsupported',
      reasonCode: 'unsupported_metric',
    });
    return buildUnsupportedResponse('unsupported_metric', quota, {
      sourceText: effectivePrompt,
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
      ...buildPromptLogContext(prompt, effectivePrompt),
      clientTimezone,
      metricKeys: effectiveQuery.metricSelections.map(metricSelection => metricSelection.metricKey),
    });
    const quota = await resolveQuotaForResponse();
    logger.info('[aiInsights] Terminal result', {
      userID,
      ...buildPromptLogContext(prompt, effectivePrompt),
      resultCategory: 'unsupported',
      reasonCode: 'unsupported_multi_metric_combination',
    });
    return buildUnsupportedResponse('unsupported_multi_metric_combination', quota, {
      sourceText: effectivePrompt,
    });
  }
  logger.info('[aiInsights] Query normalization debug', {
    userID,
    ...buildPromptLogContext(prompt, effectivePrompt),
    normalizedQuery: {
      dataType: (
        effectiveQuery.resultKind === 'multi_metric_aggregate'
        || effectiveQuery.resultKind === 'latest_event'
      )
        ? null
        : effectiveQuery.dataType,
      valueType: (
        effectiveQuery.resultKind === 'multi_metric_aggregate'
        || effectiveQuery.resultKind === 'latest_event'
      )
        ? null
        : effectiveQuery.valueType,
      categoryType: effectiveQuery.categoryType,
      requestedTimeInterval: effectiveQuery.requestedTimeInterval,
      chartType: effectiveQuery.chartType,
      activityTypesCount: effectiveQuery.activityTypes.length,
      activityTypeGroupsCount: effectiveQuery.activityTypeGroups.length,
      metricSelectionCount: effectiveQuery.resultKind === 'multi_metric_aggregate'
        ? effectiveQuery.metricSelections.length
        : effectiveQuery.resultKind === 'latest_event'
          ? 0
        : 1,
    },
  });
  const unitSettings = await aiInsightsRuntime.loadUserUnitSettings(userID);
  const executionResult = await aiInsightsRuntime.executeAiInsightsQuery(userID, effectiveQuery, effectivePrompt);
  const presentation = buildInsightPresentation(
    effectiveQuery,
    effectiveQuery.resultKind === 'multi_metric_aggregate'
      ? multiMetricDefinitions.map(entry => entry.metric.label)
      : effectiveQuery.resultKind === 'latest_event'
        ? 'latest event'
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
  const callableResultKindContext: CallableResultKindContext = (() => {
    const contextBase = {
      userID,
      input,
      effectivePrompt,
      presentation,
      emptyPresentation,
      summarizeAiInsightResult: aiInsightsRuntime.summarizeAiInsightResult,
      unitSettings,
    } as const;

    if (executionResult.resultKind === 'aggregate') {
      if (!aggregateQueryInput || !aggregateSummary || !metric) {
        throw new HttpsError('internal', 'Could not summarize AI insights.');
      }

      return {
        ...contextBase,
        resultKind: 'aggregate',
        query: aggregateQueryInput,
        metricLabel: metric.label,
        executionResult,
        aggregateSummary,
      };
    }

    if (executionResult.resultKind === 'event_lookup') {
      if (!eventLookupQueryInput || !metric) {
        throw new HttpsError('internal', 'Could not summarize AI insights.');
      }

      return {
        ...contextBase,
        resultKind: 'event_lookup',
        query: eventLookupQueryInput,
        metricLabel: metric.label,
        executionResult,
      };
    }

    if (executionResult.resultKind === 'latest_event') {
      if (!latestEventQueryInput) {
        throw new HttpsError('internal', 'Could not summarize AI insights.');
      }

      return {
        ...contextBase,
        resultKind: 'latest_event',
        query: latestEventQueryInput,
        executionResult,
      };
    }

    if (executionResult.resultKind === 'multi_metric_aggregate') {
      if (!multiMetricQueryInput) {
        throw new HttpsError('internal', 'Could not summarize AI insights.');
      }

      return {
        ...contextBase,
        resultKind: 'multi_metric_aggregate',
        query: multiMetricQueryInput,
        metricLabels: multiMetricDefinitions.map(entry => entry.metric.label),
        metricResults: multiMetricResultGroups,
        executionResult,
      };
    }

    throw new HttpsError('internal', 'Could not summarize AI insights.');
  })();
  const resultKindHandler = resolveCallableResultKindHandler(callableResultKindContext.resultKind);
  const isEmpty = resultKindHandler.isEmpty(callableResultKindContext);
  logger.info('[aiInsights] Starting AI insight summarization', {
    userID,
    ...buildPromptLogContext(prompt, effectivePrompt),
    resultKind: callableResultKindContext.resultKind,
    isEmpty,
  });
  await consumeQuotaOnAiAttempt('summarize');
  const narrativeResult = await resultKindHandler.summarize(callableResultKindContext, isEmpty);
  logger.info('[aiInsights] Finished AI insight summarization', {
    userID,
    ...buildPromptLogContext(prompt, effectivePrompt),
    source: narrativeResult.source,
  });
  const quota = await resolveQuotaForResponse();

  if (isEmpty) {
    logger.info('[aiInsights] Terminal result', {
      userID,
      ...buildPromptLogContext(prompt, effectivePrompt),
      resultCategory: 'empty',
      resultKind: callableResultKindContext.resultKind,
    });
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
  logger.info('[aiInsights] Terminal result', {
    userID,
    ...buildPromptLogContext(prompt, effectivePrompt),
    resultCategory: 'ok',
    resultKind: callableResultKindContext.resultKind,
  });
  return resultKindHandler.buildOkResponse(callableResultKindContext, narrativeResult, quota);
  } catch (error) {
    if (quotaReservation) {
      const reservationToRelease = quotaReservation as NonNullable<typeof quotaReservation>;
      quotaReservation = null;
      try {
        await aiInsightsRuntime.releaseAiInsightsQuotaReservation(reservationToRelease);
      } catch (releaseError) {
        logger.error('[aiInsights] Failed to release quota reservation after request failure', {
          userID,
          reservationID: (reservationToRelease as { reservationID?: string }).reservationID ?? null,
          ...buildPromptLogContext(prompt),
          ...serializeErrorForLogging(releaseError),
        });
      }
    }

    throw error;
  }
}

export const aiInsightsFlow = aiInsightsGenkit.defineFlow({
  name: 'aiInsightsFlow',
  inputSchema: z.any(),
  outputSchema: z.any(),
}, async (input) => {
  const validatedInput = AiInsightsRequestSchema.parse(input);
  try {
    const context = aiInsightsGenkit.currentContext() as AiInsightsCallableContext | undefined;
    return AiInsightsResponseSchema.parse(await runAiInsights(validatedInput, context));
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    const context = aiInsightsGenkit.currentContext() as AiInsightsCallableContext | undefined;
    logger.error('[aiInsights] Failed to generate AI insight', {
      userID: context?.auth?.uid ?? null,
      ...buildPromptLogContext(validatedInput.prompt),
      clientTimezone: validatedInput.clientTimezone,
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
    return aiInsightsRuntime.getAiInsightsQuotaStatus(request.auth.uid, quotaRoleContext);
  }

  return aiInsightsRuntime.getAiInsightsQuotaStatus(request.auth.uid);
});
