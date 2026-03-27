import { z } from 'zod';
import type { AiInsightsUnsupportedReasonCode } from '../../../../shared/ai-insights.types';

export type NormalizeQueryRouteDecisionSource = 'deterministic' | 'ai_repair';

export interface ResultKindRouteDefinition<
  TRouteId extends string,
  TResultKind extends string,
  TContext,
> {
  id: TRouteId;
  priority: number;
  resultKind: TResultKind | null;
  intentHints: readonly string[];
  constraints: readonly string[];
  examples: readonly string[];
  reason: string;
  match: (context: TContext) => boolean;
}

export interface ResultKindRouteDecision<
  TRouteId extends string,
  TResultKind extends string,
> {
  status: 'matched' | 'unmatched';
  routeId: TRouteId | null;
  resultKind: TResultKind | null;
  source: NormalizeQueryRouteDecisionSource;
  reason: string;
  fallbackReasonCode?: AiInsightsUnsupportedReasonCode;
}

export function resolveResultKindRouteDecision<
  TRouteId extends string,
  TResultKind extends string,
  TContext,
>(
  routeDefinitions: readonly ResultKindRouteDefinition<TRouteId, TResultKind, TContext>[],
  context: TContext,
  options: {
    source?: NormalizeQueryRouteDecisionSource;
    unmatchedReason?: string;
  } = {},
): ResultKindRouteDecision<TRouteId, TResultKind> {
  const source = options.source ?? 'deterministic';
  const orderedRouteDefinitions = [...routeDefinitions]
    .sort((left, right) => right.priority - left.priority);

  const matchedRoute = orderedRouteDefinitions.find(routeDefinition => routeDefinition.match(context));
  if (!matchedRoute) {
    return {
      status: 'unmatched',
      routeId: null,
      resultKind: null,
      source,
      reason: options.unmatchedReason ?? 'No configured result-kind route matched the prompt context.',
    };
  }

  return {
    status: 'matched',
    routeId: matchedRoute.id,
    resultKind: matchedRoute.resultKind,
    source,
    reason: matchedRoute.reason,
  };
}

export const NORMALIZE_QUERY_ROUTE_IDS = [
  'unsupported_capability',
  'power_curve',
  'digest',
  'multi_metric',
  'latest_event',
  'single_metric',
] as const;

export type NormalizeQueryRouteId = (typeof NORMALIZE_QUERY_ROUTE_IDS)[number];

export const NORMALIZE_QUERY_ROUTE_RESULT_KINDS = [
  'aggregate',
  'event_lookup',
  'latest_event',
  'multi_metric_aggregate',
  'power_curve',
] as const;

export type NormalizeQueryRouteResultKind = (typeof NORMALIZE_QUERY_ROUTE_RESULT_KINDS)[number];

export interface NormalizeQueryRouteMatchContext {
  hasUnsupportedCapability: boolean;
  hasPowerCurveIntent: boolean;
  hasDigestIntent: boolean;
  hasMultiMetricIntent: boolean;
  hasLatestEventIntent: boolean;
}

export interface NormalizeQueryRoutingMetadata {
  routeId: NormalizeQueryRouteId;
  resultKind: NormalizeQueryRouteResultKind | null;
  source: NormalizeQueryRouteDecisionSource;
  reason: string;
  fallbackReasonCode?: AiInsightsUnsupportedReasonCode;
}

export const NormalizeQueryRoutingMetadataSchema = z.object({
  routeId: z.enum(NORMALIZE_QUERY_ROUTE_IDS),
  resultKind: z.union([z.enum(NORMALIZE_QUERY_ROUTE_RESULT_KINDS), z.null()]),
  source: z.enum(['deterministic', 'ai_repair']),
  reason: z.string().min(1),
  fallbackReasonCode: z.string().optional(),
});

export const DEFAULT_NORMALIZE_QUERY_ROUTE_DEFINITIONS: ReadonlyArray<
  ResultKindRouteDefinition<
    NormalizeQueryRouteId,
    NormalizeQueryRouteResultKind,
    NormalizeQueryRouteMatchContext
  >
> = [
  {
    id: 'unsupported_capability',
    priority: 100,
    resultKind: null,
    intentHints: [
      'unsupported capability keyword',
      'prompt asks for unsupported data shape',
    ],
    constraints: [
      'must not execute model intent generation',
      'must return unsupported_capability reason code',
    ],
    examples: [
      'show cadence per kilometer splits',
      'show route geometry for my longest ride',
    ],
    reason: 'Prompt matched unsupported capability guardrails.',
    match: (context) => context.hasUnsupportedCapability,
  },
  {
    id: 'power_curve',
    priority: 90,
    resultKind: 'power_curve',
    intentHints: [
      'power curve',
      'best power envelope',
      'compare power curve over time',
    ],
    constraints: [
      'activity defaults can be applied',
      'must preserve explicit activity/date overrides',
    ],
    examples: [
      'What is my best power curve?',
      'Compare my power curve over the last 3 months.',
    ],
    reason: 'Prompt indicates power-curve result mode.',
    match: (context) => context.hasPowerCurveIntent,
  },
  {
    id: 'digest',
    priority: 80,
    resultKind: 'multi_metric_aggregate',
    intentHints: [
      'digest',
      'recap',
      'weekly/monthly/yearly summary with period granularity',
    ],
    constraints: [
      'must resolve digest period granularity',
      'must use deterministic digest metric set',
    ],
    examples: [
      'Give me a weekly digest for cycling this year.',
      'Give me a yearly recap for all activities.',
    ],
    reason: 'Prompt indicates digest multi-metric mode.',
    match: (context) => context.hasDigestIntent,
  },
  {
    id: 'multi_metric',
    priority: 70,
    resultKind: 'multi_metric_aggregate',
    intentHints: [
      'multiple metric aliases in one prompt',
      'compare several metrics together',
    ],
    constraints: [
      'must enforce multi-metric compatibility checks',
      'must reject unsupported combinations safely',
    ],
    examples: [
      'Show my cadence and power over the last 3 months.',
      'Compare my weight with duration over time this year.',
    ],
    reason: 'Prompt indicates multi-metric result mode.',
    match: (context) => context.hasMultiMetricIntent,
  },
  {
    id: 'latest_event',
    priority: 60,
    resultKind: 'latest_event',
    intentHints: [
      'last/latest/most recent event wording',
      'single latest event lookup',
    ],
    constraints: [
      'must not override explicit metric-bearing prompts',
    ],
    examples: [
      'When was my last run?',
      'Show my latest swim.',
    ],
    reason: 'Prompt indicates latest-event lookup mode.',
    match: (context) => context.hasLatestEventIntent,
  },
  {
    id: 'single_metric',
    priority: 10,
    resultKind: null,
    intentHints: [
      'default route for single-metric parsing',
      'aggregate vs event lookup resolved downstream',
    ],
    constraints: [
      'must preserve deterministic metric/date/activity normalization',
    ],
    examples: [
      'Tell me my average cadence for cycling over the last 3 months.',
      'Show me my top 5 longest rides this year.',
    ],
    reason: 'Default single-metric route selected.',
    match: () => true,
  },
];

export function resolveNormalizeQueryRouteDefinitionById(
  routeId: NormalizeQueryRouteId,
  routeDefinitions: ReadonlyArray<
    ResultKindRouteDefinition<
      NormalizeQueryRouteId,
      NormalizeQueryRouteResultKind,
      NormalizeQueryRouteMatchContext
    >
  > = DEFAULT_NORMALIZE_QUERY_ROUTE_DEFINITIONS,
): ResultKindRouteDefinition<
  NormalizeQueryRouteId,
  NormalizeQueryRouteResultKind,
  NormalizeQueryRouteMatchContext
> | null {
  return routeDefinitions.find(routeDefinition => routeDefinition.id === routeId) || null;
}

export function resolveNormalizeQueryRouteDecision(
  context: NormalizeQueryRouteMatchContext,
  routeDefinitions: ReadonlyArray<
    ResultKindRouteDefinition<
      NormalizeQueryRouteId,
      NormalizeQueryRouteResultKind,
      NormalizeQueryRouteMatchContext
    >
  > = DEFAULT_NORMALIZE_QUERY_ROUTE_DEFINITIONS,
): NormalizeQueryRoutingMetadata {
  const decision = resolveResultKindRouteDecision(routeDefinitions, context);
  if (decision.status === 'matched' && decision.routeId) {
    return {
      routeId: decision.routeId,
      resultKind: decision.resultKind,
      source: decision.source,
      reason: decision.reason,
      ...(decision.fallbackReasonCode ? { fallbackReasonCode: decision.fallbackReasonCode } : {}),
    };
  }

  return {
    routeId: 'single_metric',
    resultKind: null,
    source: decision.source,
    reason: decision.reason,
    fallbackReasonCode: 'invalid_prompt',
  };
}

export function buildNormalizeQueryRouteCatalogPromptText(
  routeDefinitions: ReadonlyArray<
    ResultKindRouteDefinition<
      NormalizeQueryRouteId,
      NormalizeQueryRouteResultKind,
      NormalizeQueryRouteMatchContext
    >
  > = DEFAULT_NORMALIZE_QUERY_ROUTE_DEFINITIONS,
): string {
  return [...routeDefinitions]
    .sort((left, right) => right.priority - left.priority)
    .map(routeDefinition => JSON.stringify({
      routeId: routeDefinition.id,
      priority: routeDefinition.priority,
      resultKind: routeDefinition.resultKind,
      intentHints: routeDefinition.intentHints,
      constraints: routeDefinition.constraints,
      examples: routeDefinition.examples,
    }))
    .join('\n');
}
