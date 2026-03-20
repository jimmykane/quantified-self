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
import { CANONICAL_ACTIVITY_TYPES } from './canonical-activity-types';
import { CANONICAL_ACTIVITY_TYPE_GROUPS } from './canonical-activity-type-groups';
import {
  buildMetricCatalogPromptText,
  findInsightMetricAliasMatches,
  getSuggestedInsightPrompts,
} from './metric-catalog';
import { canonicalizeInsightPrompt } from './prompt-normalization';

type RepairUnsupportedResult = Extract<NormalizeInsightQueryResult, { status: 'unsupported' }>;

export interface RepairInsightQueryResult {
  result: NormalizeInsightQueryResult;
  source: 'genkit' | 'none';
}

interface RepairInsightQueryDependencies {
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
  }) => Promise<ModelInsightIntent | null>;
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
});

const defaultRepairInsightQueryDependencies: RepairInsightQueryDependencies = {
  repairIntent: async (input) => {
    const { output } = await aiInsightsGenkit.generate({
      system: [
        'You repair unsupported fitness insight prompts into a strict structured intent.',
        'Use only the provided metric catalog, supported aggregations, and supplied activity values.',
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

let repairInsightQueryDependencies: RepairInsightQueryDependencies = defaultRepairInsightQueryDependencies;

function buildUnsupportedResult(
  reasonCode: AiInsightsUnsupportedReasonCode,
  sourceText: string,
): RepairUnsupportedResult {
  return {
    status: 'unsupported',
    reasonCode,
    suggestedPrompts: getSuggestedInsightPrompts(3, sourceText),
  };
}

export function setRepairInsightQueryDependenciesForTesting(
  dependencies?: Partial<RepairInsightQueryDependencies>,
): void {
  repairInsightQueryDependencies = dependencies
    ? { ...defaultRepairInsightQueryDependencies, ...dependencies }
    : defaultRepairInsightQueryDependencies;
}

export async function repairUnsupportedInsightQuery(
  input: AiInsightsRequest,
  deterministicResult: RepairUnsupportedResult,
): Promise<RepairInsightQueryResult> {
  try {
    const prompt = `${input.prompt || ''}`.trim();
    const promptContext = buildNormalizeQueryPromptContext(prompt);
    const repairedIntent = await repairInsightQueryDependencies.repairIntent({
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
    });

    if (!repairedIntent) {
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
        ),
        source: 'genkit',
      };
    }

    return {
      result: resolveNormalizedInsightQueryFromIntent(input, promptContext, repairedIntent),
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
}
