import { z } from 'genkit';
import * as logger from 'firebase-functions/logger';
import type {
  AiInsightsRequest,
  AiInsightsUnsupportedReasonCode,
} from '../../../../shared/ai-insights.types';
import { aiInsightsGenkit } from './genkit';
import {
  buildNormalizeQueryPromptContext,
  resolveNormalizedInsightQueryFromIntent,
  type ModelInsightIntent,
  type NormalizeInsightQueryResult,
} from './normalize-query.flow';
import {
  buildNormalizeQueryRouteCatalogPromptText,
  NORMALIZE_QUERY_ROUTE_IDS,
  NORMALIZE_QUERY_ROUTE_RESULT_KINDS,
  resolveNormalizeQueryRouteDefinitionById,
  type NormalizeQueryRoutingMetadata,
} from './normalize-query.result-kind-router';
import { CANONICAL_ACTIVITY_TYPES } from './canonical-activity-types';
import { CANONICAL_ACTIVITY_TYPE_GROUPS } from './canonical-activity-type-groups';
import {
  buildMetricCatalogPromptText,
  findInsightMetricAliasMatches,
  getSuggestedInsightPrompts,
} from './metric-catalog';
import { canonicalizeInsightPrompt } from './prompt-normalization';

type RepairUnsupportedResult = Extract<NormalizeInsightQueryResult, { status: 'unsupported' }>;

interface RepairInsightIntent extends ModelInsightIntent {
  routing: NormalizeQueryRoutingMetadata;
}

export interface RepairInsightQueryResult {
  result: NormalizeInsightQueryResult;
  source: 'genkit' | 'none';
}

export interface RepairInsightQueryDependencies {
  repairIntent: (input: {
    prompt: string;
    canonicalizedPrompt: string;
    clientTimezone: string;
    unsupportedReasonCode: AiInsightsUnsupportedReasonCode;
    promptCategory: string | null;
    promptRequestedTimeInterval: string | null;
    promptDateSelection: string | null;
    metricCandidates: string[];
    activityTypeCandidates: string[];
    activityTypeGroupCandidates: string[];
    supportedRoutes: string[];
    routeCatalog: string;
  }) => Promise<RepairInsightIntent | null>;
}

export interface RepairInsightQueryApi {
  repairUnsupportedInsightQuery: (
    input: AiInsightsRequest,
    deterministicResult: RepairUnsupportedResult,
  ) => Promise<RepairInsightQueryResult>;
}

const RepairInsightIntentSchema = z.object({
  status: z.enum(['supported', 'unsupported']),
  metric: z.string().optional(),
  aggregation: z.enum(['total', 'average', 'minimum', 'maximum']).optional(),
  category: z.enum(['date', 'activity']).optional(),
  requestedTimeInterval: z.enum([
    'auto',
    'hourly',
    'daily',
    'weekly',
    'biweekly',
    'monthly',
    'quarterly',
    'semesterly',
    'yearly',
  ]).optional(),
  activityTypeGroups: z.array(z.string()).optional(),
  activityTypes: z.array(z.string()).optional(),
  dateRange: z.union([
    z.object({
      kind: z.enum(['last_n', 'last']),
      amount: z.number().int().positive().max(3650),
      unit: z.enum(['day', 'week', 'month', 'year']),
    }),
    z.object({
      kind: z.enum(['current_period', 'this']),
      unit: z.enum(['week', 'month', 'year']),
    }),
    z.object({
      kind: z.literal('absolute'),
      startDate: z.string(),
      endDate: z.string(),
    }),
    z.object({
      kind: z.literal('all_time'),
    }),
  ]).optional(),
  unsupportedReasonCode: z.enum([
    'invalid_prompt',
    'unsupported_metric',
    'ambiguous_metric',
    'unsupported_capability',
    'too_many_metrics',
    'unsupported_multi_metric_combination',
  ]).optional(),
  routing: z.object({
    routeId: z.enum([...NORMALIZE_QUERY_ROUTE_IDS] as [typeof NORMALIZE_QUERY_ROUTE_IDS[number], ...Array<typeof NORMALIZE_QUERY_ROUTE_IDS[number]>]),
    resultKind: z.union([
      z.enum([
        ...NORMALIZE_QUERY_ROUTE_RESULT_KINDS,
      ] as [typeof NORMALIZE_QUERY_ROUTE_RESULT_KINDS[number], ...Array<typeof NORMALIZE_QUERY_ROUTE_RESULT_KINDS[number]>]),
      z.null(),
    ]),
    source: z.literal('ai_repair'),
    reason: z.string().trim().min(1),
    fallbackReasonCode: z.enum([
      'invalid_prompt',
      'unsupported_metric',
      'ambiguous_metric',
      'unsupported_capability',
      'too_many_metrics',
      'unsupported_multi_metric_combination',
    ]).optional(),
  }),
});

const defaultRepairInsightQueryDependencies: RepairInsightQueryDependencies = {
  repairIntent: async (input) => {
    const { output } = await aiInsightsGenkit.generate({
      system: [
        'You repair unsupported fitness insight prompts into a strict structured intent.',
        'Always return a routing object with routeId, resultKind, source, and reason.',
        'Set routing.source to ai_repair.',
        'Use only the provided metric catalog, supported aggregations, and supplied activity values.',
        'Use only the provided supportedRoutes route IDs.',
        'If the prompt is still ambiguous or unsupported, return status unsupported.',
        'Do not invent metrics, activities, date ranges, or capabilities.',
        'Prefer leaving fields empty over guessing.',
      ].join(' '),
      prompt: JSON.stringify({
        ...input,
        supportedMetrics: buildMetricCatalogPromptText(),
        supportedActivityTypes: CANONICAL_ACTIVITY_TYPES,
        supportedActivityTypeGroups: CANONICAL_ACTIVITY_TYPE_GROUPS,
      }),
      output: { schema: RepairInsightIntentSchema },
    });

    return output ?? null;
  },
};

function buildUnsupportedResult(
  reasonCode: AiInsightsUnsupportedReasonCode,
  sourceText: string,
  routing?: NormalizeQueryRoutingMetadata,
): RepairUnsupportedResult {
  return {
    status: 'unsupported',
    reasonCode,
    suggestedPrompts: getSuggestedInsightPrompts(3, sourceText),
    ...(routing
      ? {
        routing: {
          ...routing,
          fallbackReasonCode: reasonCode,
        },
      }
      : {}),
  };
}

function isRepairRoutingMetadataValid(
  routing: NormalizeQueryRoutingMetadata,
  status: RepairInsightIntent['status'],
): boolean {
  const routeDefinition = resolveNormalizeQueryRouteDefinitionById(routing.routeId);
  if (!routeDefinition) {
    return false;
  }

  if (routing.resultKind !== routeDefinition.resultKind) {
    return false;
  }

  if (status === 'supported' && routing.routeId === 'unsupported_capability') {
    return false;
  }

  return true;
}

function attachRepairRoutingMetadata(
  result: NormalizeInsightQueryResult,
  routing: NormalizeQueryRoutingMetadata,
): NormalizeInsightQueryResult {
  if (result.status === 'ok') {
    return {
      ...result,
      routing: {
        ...routing,
        source: 'ai_repair',
        resultKind: result.query.resultKind,
      },
    };
  }

  return {
    ...result,
    routing: {
      ...routing,
      source: 'ai_repair',
      fallbackReasonCode: result.reasonCode,
    },
  };
}

export function createRepairInsightQuery(
  dependencies: Partial<RepairInsightQueryDependencies> = {},
): RepairInsightQueryApi {
  const resolvedDependencies: RepairInsightQueryDependencies = {
    ...defaultRepairInsightQueryDependencies,
    ...dependencies,
  };

  return {
    repairUnsupportedInsightQuery: async (
      input: AiInsightsRequest,
      deterministicResult: RepairUnsupportedResult,
    ): Promise<RepairInsightQueryResult> => {
      try {
        const prompt = `${input.prompt || ''}`.trim();
        const promptContext = buildNormalizeQueryPromptContext(prompt);
        const repairedIntent = await resolvedDependencies.repairIntent({
          prompt,
          canonicalizedPrompt: canonicalizeInsightPrompt(prompt),
          clientTimezone: input.clientTimezone,
          unsupportedReasonCode: deterministicResult.reasonCode,
          promptCategory: promptContext.promptCategory ?? null,
          promptRequestedTimeInterval: promptContext.promptRequestedTimeInterval ?? null,
          promptDateSelection: promptContext.promptDateSelection.effectiveDateRangeIntent
            ? JSON.stringify(promptContext.promptDateSelection.effectiveDateRangeIntent)
            : null,
          metricCandidates: findInsightMetricAliasMatches(prompt).map(match => match.metric.key),
          activityTypeCandidates: [],
          activityTypeGroupCandidates: [],
          supportedRoutes: [...NORMALIZE_QUERY_ROUTE_IDS],
          routeCatalog: buildNormalizeQueryRouteCatalogPromptText(),
        });

        if (!repairedIntent) {
          return {
            result: deterministicResult,
            source: 'none',
          };
        }

        if (!isRepairRoutingMetadataValid(repairedIntent.routing, repairedIntent.status)) {
          logger.warn('[aiInsights] Prompt repair returned an invalid route decision; falling back to deterministic unsupported result.', {
            prompt: input.prompt,
            routing: repairedIntent.routing,
          });
          return {
            result: deterministicResult,
            source: 'none',
          };
        }

        if (repairedIntent.status === 'unsupported') {
          return {
            result: buildUnsupportedResult(
              repairedIntent.unsupportedReasonCode || deterministicResult.reasonCode,
              prompt,
              repairedIntent.routing,
            ),
            source: 'genkit',
          };
        }

        return {
          result: attachRepairRoutingMetadata(
            resolveNormalizedInsightQueryFromIntent(input, promptContext, repairedIntent),
            repairedIntent.routing,
          ),
          source: 'genkit',
        };
      } catch (error) {
        logger.warn('[aiInsights] Prompt repair failed; falling back to deterministic unsupported result.', {
          prompt: input.prompt,
          unsupportedReasonCode: deterministicResult.reasonCode,
          error,
        });
        return {
          result: deterministicResult,
          source: 'none',
        };
      }
    },
  };
}

const repairInsightQueryRuntime = createRepairInsightQuery();

export async function repairUnsupportedInsightQuery(
  input: AiInsightsRequest,
  deterministicResult: RepairUnsupportedResult,
): Promise<RepairInsightQueryResult> {
  return repairInsightQueryRuntime.repairUnsupportedInsightQuery(input, deterministicResult);
}
