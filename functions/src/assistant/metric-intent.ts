import { ActivityTypesHelper } from '@sports-alliance/sports-lib';
import type { AssistantPromptWorkflow } from '../../../shared/assistant.prompts';
import {
  getSportsLibNumericMetricCatalog,
  resolveSportsLibNumericMetric,
} from '../mcp/metric-catalog';

type AssistantMetricAggregation = 'average' | 'minimum' | 'maximum';

const SUMMARY_PREFIX_BY_AGGREGATION: Record<
  AssistantMetricAggregation,
  'Average' | 'Minimum' | 'Maximum'
> = {
  average: 'Average',
  minimum: 'Minimum',
  maximum: 'Maximum',
};
const SUMMARY_AGGREGATIONS = Object.keys(
  SUMMARY_PREFIX_BY_AGGREGATION,
) as AssistantMetricAggregation[];
const SUMMARY_METRIC_PATTERN = /^(Average|Minimum|Maximum) (.+)$/u;
const SUMMARY_AGGREGATION_PATTERNS: Record<AssistantMetricAggregation, RegExp> = {
  average: /\b(?:average|avg|mean)\b/u,
  minimum: /\b(?:minimum|min|lowest)\b/u,
  maximum: /\b(?:maximum|max|highest)\b/u,
};
const ALL_HISTORY_PATTERN = /\b(?:all years|every year|all time|all available history|full history|entire history)\b/u;
const YEAR_RANGE_PATTERN = /\b((?:19|20)\d{2})\s*(?:to|through|until|[-\u2013\u2014])\s*((?:19|20)\d{2})\b/u;
const YEARLY_PATTERN = /\b(?:per year|by year|each year|every year|yearly|annual|annually|all years)\b/u;
const TREND_PATTERN = /\b(?:trend|history|over time|changed|change|compare|comparison|plot|chart|graph|visualize|visualise|visualization|visualisation)\b/u;
const CHART_PATTERN = /\b(?:plot|chart|graph|visualize|visualise|visualization|visualisation)\b/u;
const ALL_HISTORY_START = '2000-01-01T00:00:00.000Z';

interface AssistantSummaryMetricFamily {
  baseType: string;
  selectors: Partial<Record<AssistantMetricAggregation, string>>;
}

export interface AssistantMetricTrendIntent {
  workflow: AssistantPromptWorkflow;
  toolInput: {
    metrics: Array<{
      metric: string;
      aggregation: AssistantMetricAggregation;
    }>;
    start: string;
    end: string;
    groupBy: 'date';
    interval: 'yearly';
    timeZone: string;
    activityTypes?: string[];
  };
}

export function assistantPromptRequestsChart(prompt: string): boolean {
  return CHART_PATTERN.test(normalizeAssistantCatalogTerm(prompt));
}

export function normalizeAssistantCatalogTerm(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function resolveAssistantMetricType(value: string): string | null {
  const exact = resolveSportsLibNumericMetric(value);
  if (exact) {
    return exact.type;
  }
  const normalized = normalizeAssistantCatalogTerm(value);
  const matches = getSportsLibNumericMetricCatalog().filter(metric => (
    normalizeAssistantCatalogTerm(metric.type) === normalized
    || normalizeAssistantCatalogTerm(metric.displayType) === normalized
  ));
  return matches.length === 1 ? matches[0].type : null;
}

function buildSummaryMetricFamilies(): AssistantSummaryMetricFamily[] {
  const byBaseType = new Map<string, AssistantSummaryMetricFamily>();
  for (const metric of getSportsLibNumericMetricCatalog()) {
    const match = SUMMARY_METRIC_PATTERN.exec(metric.type);
    if (!match) {
      continue;
    }
    const aggregation = SUMMARY_AGGREGATIONS.find(candidate => (
      SUMMARY_PREFIX_BY_AGGREGATION[candidate] === match[1]
    ));
    if (!aggregation) {
      continue;
    }
    const baseType = match[2];
    const family = byBaseType.get(baseType) || { baseType, selectors: {} };
    family.selectors[aggregation] = metric.type;
    byBaseType.set(baseType, family);
  }
  return [...byBaseType.values()].filter(family => (
    Object.keys(family.selectors).length >= 2
  ));
}

const SUMMARY_METRIC_FAMILIES = buildSummaryMetricFamilies();
const SUMMARY_METRIC_FAMILY_BY_BASE_TYPE = new Map(
  SUMMARY_METRIC_FAMILIES.map(family => [family.baseType, family]),
);

function resolveMetricFamily(canonicalType: string): AssistantSummaryMetricFamily | null {
  const summaryMatch = SUMMARY_METRIC_PATTERN.exec(canonicalType);
  return SUMMARY_METRIC_FAMILY_BY_BASE_TYPE.get(
    summaryMatch?.[2] ?? canonicalType,
  ) || null;
}

export function resolveAssistantSummaryMetricType(
  value: unknown,
  aggregation: unknown,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const canonicalType = resolveAssistantMetricType(value) || value;
  if (SUMMARY_METRIC_PATTERN.test(canonicalType)) {
    return canonicalType;
  }
  const normalizedAggregation = typeof aggregation === 'string'
    && SUMMARY_AGGREGATIONS.includes(aggregation as AssistantMetricAggregation)
    ? aggregation as AssistantMetricAggregation
    : 'average';
  const family = resolveMetricFamily(canonicalType);
  return family?.selectors[normalizedAggregation] || canonicalType;
}

export function expandAssistantSummaryMetricTypes(
  values: readonly unknown[],
): unknown[] {
  const expanded = values.flatMap((value) => {
    if (typeof value !== 'string') {
      return [value];
    }
    const canonicalType = resolveAssistantMetricType(value) || value;
    if (SUMMARY_METRIC_PATTERN.test(canonicalType)) {
      return [canonicalType];
    }
    const family = resolveMetricFamily(canonicalType);
    return family
      ? SUMMARY_AGGREGATIONS.flatMap(aggregation => (
          family.selectors[aggregation] ? [family.selectors[aggregation]] : []
        ))
      : [canonicalType];
  });
  const unique = [...new Map(expanded.map(value => [
    `${typeof value}:${String(value)}`,
    value,
  ])).values()];
  // Preserve a valid public MCP request if a model asks for many raw metric
  // families at once. Normal Assistant detail requests stay well below this.
  return unique.length <= 25
    ? unique
    : values.map(value => (
        typeof value === 'string' ? resolveAssistantMetricType(value) || value : value
      ));
}

function containsCatalogPhrase(normalizedPrompt: string, phrase: string): boolean {
  return ` ${normalizedPrompt} `.includes(` ${phrase} `);
}

function resolvePromptMetricFamily(
  normalizedPrompt: string,
): AssistantSummaryMetricFamily | null {
  const matches = SUMMARY_METRIC_FAMILIES.filter((family) => {
    const normalizedBase = normalizeAssistantCatalogTerm(family.baseType);
    return containsCatalogPhrase(normalizedPrompt, normalizedBase)
      || containsCatalogPhrase(normalizedPrompt, `${normalizedBase}s`);
  }).filter((family, _index, families) => !families.some(other => (
    other !== family
    && normalizeAssistantCatalogTerm(other.baseType).includes(
      normalizeAssistantCatalogTerm(family.baseType),
    )
  )));
  return matches.length === 1 ? matches[0] : null;
}

function resolveRequestedAggregations(
  normalizedPrompt: string,
): AssistantMetricAggregation[] {
  return SUMMARY_AGGREGATIONS.filter(aggregation => (
    SUMMARY_AGGREGATION_PATTERNS[aggregation].test(normalizedPrompt)
  ));
}

function resolveActivityTypes(normalizedPrompt: string): string[] {
  const activityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();
  const aliases = activityTypes.flatMap(type => {
    const normalizedType = normalizeAssistantCatalogTerm(String(type));
    return [{ type: String(type), phrase: normalizedType }, ...(
      normalizedType === 'open water swimming'
        ? [{ type: String(type), phrase: 'open water' }]
        : []
    )];
  });
  const matched = aliases.filter(candidate => (
    containsCatalogPhrase(normalizedPrompt, candidate.phrase)
  ));
  return [...new Set(matched.filter(candidate => !matched.some(other => (
    other.type !== candidate.type
    && other.phrase.length > candidate.phrase.length
    && other.phrase.includes(candidate.phrase)
  ))).map(candidate => candidate.type))];
}

function resolveTrendRange(
  prompt: string,
  normalizedPrompt: string,
  currentTime: Date,
): { start: string; end: string } | null {
  const yearRange = YEAR_RANGE_PATTERN.exec(prompt.toLowerCase());
  if (yearRange) {
    const firstYear = Number(yearRange[1]);
    const secondYear = Number(yearRange[2]);
    if (firstYear > secondYear) {
      return null;
    }
    const currentYear = currentTime.getUTCFullYear();
    if (firstYear > currentYear) {
      return null;
    }
    const end = secondYear >= currentYear
      ? currentTime.toISOString()
      : new Date(Date.UTC(secondYear + 1, 0, 1) - 1).toISOString();
    return {
      start: new Date(Date.UTC(firstYear, 0, 1)).toISOString(),
      end,
    };
  }
  return ALL_HISTORY_PATTERN.test(normalizedPrompt)
    ? { start: ALL_HISTORY_START, end: currentTime.toISOString() }
    : null;
}

/**
 * Recognizes only an unambiguous summary-metric history request. The result is
 * a server-owned execution policy: user text selects a supported intent but
 * never supplies arbitrary tool names, metric identifiers, or query fields.
 */
export function findAssistantMetricTrendIntent(input: {
  prompt: string;
  currentTime: Date;
  timeZone: string;
}): AssistantMetricTrendIntent | null {
  const normalizedPrompt = normalizeAssistantCatalogTerm(input.prompt);
  if (!TREND_PATTERN.test(normalizedPrompt)
    || !YEARLY_PATTERN.test(normalizedPrompt)) {
    return null;
  }
  const range = resolveTrendRange(input.prompt, normalizedPrompt, input.currentTime);
  const family = resolvePromptMetricFamily(normalizedPrompt);
  const aggregations = resolveRequestedAggregations(normalizedPrompt);
  if (!range || !family || aggregations.length === 0) {
    return null;
  }
  const metrics = aggregations.flatMap(aggregation => (
    family.selectors[aggregation]
      ? [{ metric: family.selectors[aggregation]!, aggregation }]
      : []
  ));
  if (metrics.length !== aggregations.length) {
    return null;
  }
  const activityTypes = resolveActivityTypes(normalizedPrompt);
  return {
    workflow: {
      id: 'activity-summary-metric-history',
      toolWorkflow: ['query_metrics'],
      routingHint: `Use one query_metrics request for the server-selected ${family.baseType} summary metrics, complete historical range, yearly buckets, and activity filters. Treat unmatched yearly buckets as missing recorded data, not zero.`,
    },
    toolInput: {
      metrics,
      ...range,
      groupBy: 'date',
      interval: 'yearly',
      timeZone: input.timeZone,
      ...(activityTypes.length > 0 ? { activityTypes } : {}),
    },
  };
}
