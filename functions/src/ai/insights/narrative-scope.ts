import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { NormalizedInsightQuery } from '../../../../shared/ai-insights.types';
import { resolveAiInsightsActivityFilterLabel } from '../../../../shared/ai-insights-activity-filter';
import { getActivityTypeGroupMetadataList } from '../../../../shared/activity-type-group.metadata';
import { normalizePromptSearchText } from './prompt-normalization';

const MONTH_AND_DAY_TOKENS = new Set([
  'jan',
  'january',
  'feb',
  'february',
  'mar',
  'march',
  'apr',
  'april',
  'may',
  'jun',
  'june',
  'jul',
  'july',
  'aug',
  'august',
  'sep',
  'sept',
  'september',
  'oct',
  'october',
  'nov',
  'november',
  'dec',
  'december',
  'monday',
  'mon',
  'tuesday',
  'tue',
  'wednesday',
  'wed',
  'thursday',
  'thu',
  'friday',
  'fri',
  'saturday',
  'sat',
  'sunday',
  'sun',
]);

const GENERIC_LOCATION_SCOPE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bwithin\s+\d+(?:\.\d+)?\s+km\s+of\s+[a-z][a-z0-9 ]{2,}\b/i,
  /\b(?:near|around|inside)\s+[a-z][a-z0-9 ]{2,}\b/i,
];

const GENERIC_IN_LOCATION_SCOPE_PATTERN =
  /\bin\s+([a-z][a-z0-9 ]{2,}?)(?=\s+(?:and|but|with|where|because|from|over|across|by|while|that|which|on|at|during|before|after)\b|[,.!?;]|$)/gi;

function normalizeNarrativeScopeText(
  value: string | null | undefined,
): string {
  return normalizePromptSearchText(`${value || ''}`);
}

function uniqueNormalizedTokens(
  values: Array<string | null | undefined>,
): string[] {
  return [...new Set(values
    .map(normalizeNarrativeScopeText)
    .filter(Boolean))];
}

function escapeRegExp(
  value: string,
): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatLocationScopeLabel(
  query: NormalizedInsightQuery,
): string | null {
  if (!query.locationFilter) {
    return null;
  }

  const resolvedLabel = `${query.locationFilter.resolvedLabel || ''}`.trim().toLowerCase();
  if (!resolvedLabel) {
    return null;
  }

  if (query.locationFilter.mode === 'bbox') {
    return `in ${resolvedLabel}`;
  }

  return `within ${query.locationFilter.radiusKm} km of ${resolvedLabel}`;
}

function buildKnownActivityScopePattern(): RegExp {
  const knownActivityScopeTokens = uniqueNormalizedTokens([
    'all activities',
    ...Object.values(ActivityTypes).map(activityType => `${activityType}`),
    ...getActivityTypeGroupMetadataList()
      .filter(metadata => metadata.ambiguous)
      .flatMap(metadata => [metadata.label, ...metadata.aliases]),
  ]);

  if (!knownActivityScopeTokens.length) {
    return /$^/;
  }

  return new RegExp(
    `\\b(?:${knownActivityScopeTokens
      .sort((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join('|')})\\b`,
    'i',
  );
}

const KNOWN_ACTIVITY_SCOPE_PATTERN = buildKnownActivityScopePattern();

function isIgnoredLocationScopeCandidate(
  value: string,
): boolean {
  const normalized = normalizeNarrativeScopeText(value).replace(/^the\s+/, '');
  if (!normalized) {
    return true;
  }

  const [firstToken = ''] = normalized.split(' ');
  if (MONTH_AND_DAY_TOKENS.has(normalized) || MONTH_AND_DAY_TOKENS.has(firstToken)) {
    return true;
  }

  return /\b(?:day|days|week|weeks|month|months|year|years|quarter|quarters|season|seasons|period|periods|activity|activities|event|events|bucket|buckets|history|range|total|average|latest|highest|lowest)\b/i
    .test(normalized);
}

function capitalizeNarrativeScopeLabel(
  value: string,
): string {
  if (!value) {
    return value;
  }

  return `${value[0]?.toUpperCase() || ''}${value.slice(1)}`;
}

export interface ResolvedNarrativeScope {
  activityFilterLabel: string;
  locationScopeLabel: string | null;
  scopeLabel: string;
  validationTokens: {
    activity: string[];
    location: string[];
    scope: string[];
  };
}

export function resolveNarrativeScope(
  query: NormalizedInsightQuery,
): ResolvedNarrativeScope {
  const activityFilterLabel = resolveAiInsightsActivityFilterLabel(query).toLowerCase();
  const locationScopeLabel = formatLocationScopeLabel(query);
  const scopeLabel = activityFilterLabel === 'all activities'
    ? (locationScopeLabel ? `across all activities ${locationScopeLabel}` : 'across all activities')
    : (locationScopeLabel ? `for ${activityFilterLabel} ${locationScopeLabel}` : `for ${activityFilterLabel}`);

  return {
    activityFilterLabel,
    locationScopeLabel,
    scopeLabel,
    validationTokens: {
      activity: uniqueNormalizedTokens([
        activityFilterLabel,
      ]),
      location: uniqueNormalizedTokens([
        locationScopeLabel,
        query.locationFilter?.resolvedLabel,
      ]),
      scope: uniqueNormalizedTokens([
        scopeLabel,
      ]),
    },
  };
}

export function buildDeterministicNarrativeLead(
  query: NormalizedInsightQuery,
  dateRangeLabel: string,
): string {
  const scope = resolveNarrativeScope(query);
  const scopeLead = capitalizeNarrativeScopeLabel(scope.scopeLabel);

  if (query.dateRange.kind === 'all_time') {
    return `${scopeLead}, this answer covers all recorded history.`;
  }

  return `${scopeLead}, this answer covers ${dateRangeLabel}.`;
}

export function normalizeNarrativeScopeToken(
  value: string,
): string {
  return normalizeNarrativeScopeText(value);
}

export function containsUnexpectedScopeSuffix(
  suffix: string,
): boolean {
  const normalizedSuffix = normalizeNarrativeScopeText(suffix)
    .replace(/^[\s,;:.!-]+/, '');
  if (!normalizedSuffix) {
    return false;
  }

  return /^(?:and|or|plus|including|as well as)\s+[a-z]/i.test(normalizedSuffix);
}

export function containsUnexpectedNarrativeScopeReference(
  narrative: string,
  resolvedScope: ResolvedNarrativeScope,
): boolean {
  const normalizedNarrative = normalizeNarrativeScopeText(narrative);
  if (!normalizedNarrative) {
    return false;
  }

  const exactScopeTokens = [
    ...resolvedScope.validationTokens.activity,
    ...resolvedScope.validationTokens.location,
    ...resolvedScope.validationTokens.scope,
  ];
  if (exactScopeTokens.some(token => token && normalizedNarrative.includes(token))) {
    return true;
  }

  if (KNOWN_ACTIVITY_SCOPE_PATTERN.test(normalizedNarrative)) {
    return true;
  }

  if (GENERIC_LOCATION_SCOPE_PATTERNS.some(pattern => pattern.test(normalizedNarrative))) {
    return true;
  }

  for (const match of normalizedNarrative.matchAll(GENERIC_IN_LOCATION_SCOPE_PATTERN)) {
    const candidate = `${match[1] || ''}`.trim();
    if (!candidate || isIgnoredLocationScopeCandidate(candidate)) {
      continue;
    }

    return true;
  }

  return false;
}
