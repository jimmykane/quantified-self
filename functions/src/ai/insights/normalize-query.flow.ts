import { z } from 'zod';
import {
  type ActivityTypeGroup,
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

import type {
  AiInsightsRequest,
  AiInsightsMultiMetricGroupingMode,
  AiInsightsUnsupportedReasonCode,
  NormalizedInsightBoundedDateRange,
  NormalizedInsightDateRange,
  NormalizedInsightMetricSelection,
  NormalizedInsightPeriodMode,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import { clampAiInsightsTopResultsLimit } from '../../../../shared/ai-insights-ranking.constants';
import {
  getActivityTypeGroupMetadata,
  getActivityTypesForGroup,
  isIndoorActivityType,
  isAmbiguousActivityTypeGroup,
} from '../../../../shared/activity-type-group.metadata';
import { CANONICAL_ACTIVITY_TYPES, resolveCanonicalActivityType } from './canonical-activity-types';
import {
  CANONICAL_ACTIVITY_TYPE_GROUPS,
  resolveCanonicalActivityTypeGroup,
} from './canonical-activity-type-groups';
import {
  findInsightMetricAliasMatch,
  findInsightMetricAliasMatches,
  getSuggestedInsightPrompts,
  isAggregationAllowedForMetric,
  resolveInsightMetric,
  type InsightMetricKey,
} from './metric-catalog';
import { canonicalizeInsightPrompt, normalizePromptSearchText } from './prompt-normalization';
import {
  buildAggregateInsightQuery,
  buildEventLookupInsightQuery,
  buildLatestEventInsightQuery,
  buildMultiMetricInsightQuery,
} from './normalize-query.result-kind-query-builders';
import { AiInsightsRequestSchema, NormalizedInsightQuerySchema } from './schemas';

type ModelAggregationCode = 'total' | 'average' | 'minimum' | 'maximum';
type ModelCategoryCode = 'date' | 'activity';
type ModelTimeIntervalCode =
  | 'auto'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'semesterly'
  | 'yearly';
type ModelDateRangeUnit = 'day' | 'week' | 'month' | 'year';

interface NormalizeInsightQuerySupportedResult {
  status: 'ok';
  metricKey?: InsightMetricKey;
  query: NormalizedInsightQuery;
}

interface NormalizeInsightQueryUnsupportedResult {
  status: 'unsupported';
  reasonCode: AiInsightsUnsupportedReasonCode;
  suggestedPrompts: string[];
}

export type NormalizeInsightQueryResult =
  | NormalizeInsightQuerySupportedResult
  | NormalizeInsightQueryUnsupportedResult;

type RelativeDateRangeIntent = {
  kind: 'last_n' | 'last';
  amount: number;
  unit: ModelDateRangeUnit;
};

type CurrentPeriodDateRangeIntent = {
  kind: 'current_period' | 'this';
  unit: 'week' | 'month' | 'year';
};

type AbsoluteDateRangeIntent = {
  kind: 'absolute';
  startDate: string;
  endDate: string;
};

type AllTimeDateRangeIntent = {
  kind: 'all_time';
};

type DateRangeIntent =
  | RelativeDateRangeIntent
  | CurrentPeriodDateRangeIntent
  | AbsoluteDateRangeIntent
  | AllTimeDateRangeIntent;

export interface ModelInsightIntent {
  status: 'supported' | 'unsupported';
  metric?: string;
  aggregation?: ModelAggregationCode;
  category?: ModelCategoryCode;
  requestedTimeInterval?: ModelTimeIntervalCode;
  activityTypeGroups?: string[];
  activityTypes?: string[];
  dateRange?: DateRangeIntent;
  unsupportedReasonCode?: AiInsightsUnsupportedReasonCode;
}

interface MultiMetricIntent {
  valueType: ChartDataValueTypes;
  metricSelections: NormalizedInsightMetricSelection[];
  groupingMode: AiInsightsMultiMetricGroupingMode;
}

interface PromptDateSelectionIntent {
  effectiveDateRangeIntent?: DateRangeIntent;
  requestedDateRangeIntents?: AbsoluteDateRangeIntent[];
  periodMode?: NormalizedInsightPeriodMode;
  compareRequestedTimeInterval?: ModelTimeIntervalCode;
}

const INVERSE_SUPERLATIVE_METRIC_KEYS = new Set<InsightMetricKey>([
  'pace',
  'grade_adjusted_pace',
  'effort_pace',
  'swim_pace',
]);

export interface NormalizeQueryPromptContext {
  prompt: string;
  promptAggregation: ModelAggregationCode | undefined;
  promptCategory: ModelCategoryCode | undefined;
  promptDateSelection: PromptDateSelectionIntent;
  promptRequestedTimeInterval: ModelTimeIntervalCode | undefined;
  promptChartPreference: 'columns' | 'lines' | undefined;
}

export interface NormalizeQueryDependencies {
  now: () => Date;
  generateIntent: (input: AiInsightsRequest) => Promise<ModelInsightIntent>;
}

export interface NormalizeQueryApi {
  normalizeInsightQuery: (input: AiInsightsRequest) => Promise<NormalizeInsightQueryResult>;
  normalizeInsightQueryFlow: (input: AiInsightsRequest) => Promise<NormalizeInsightQueryResult>;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
}

const ABSOLUTE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORTED_ACTIVITY_TYPE_GROUPS = [...CANONICAL_ACTIVITY_TYPE_GROUPS];
const MAX_MULTI_METRICS = 3;
const YEAR_PATTERN = /(?:19|20)\d{2}/;
const MONTH_NAME_TO_NUMBER: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const UNSUPPORTED_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsplits?\b/i,
  /\blaps?\b/i,
  /\bstreams?\b/i,
  /\broute\b/i,
  /\bgeometry\b/i,
  /\boriginal files?\b/i,
  /\breparse\b/i,
];

const EXPLICIT_ALL_TIME_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\ball[\s-]*time\b/i,
  /\bentire history\b/i,
  /\bfull history\b/i,
  /\bwhole history\b/i,
  /\ball recorded\b/i,
  /\bever\b/i,
];

const DATE_ACTIVITY_STACKED_CORE_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bstack(?:ed|ing)?\b/i,
  /\b(activity types?|activities|sports?)\b/i,
];
const DATE_ACTIVITY_STACKED_TIME_AXIS_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(over time|by date|by day|by week|by month|timeline)\b/i,
  /\b(last|past|this|all time|ever|entire history|full history|whole history)\b/i,
  /\b(day|days|week|weeks|month|months|year|years|daily|weekly|monthly|quarterly|yearly)\b/i,
];
const EVENT_LOOKUP_SUBJECT_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(when did i have|when i had|when was|which event|what workout|which workout|which session)\b/i,
  /\bwhich\s+(ride|rides|run|runs|swim|swims|workout|workouts|session|sessions|activity|activities|event|events)\s+had\b/i,
  /\bwhich\s+(ride|rides|run|runs|swim|swims|workout|workouts|session|sessions|activity|activities|event|events)\s+(was|were)\b/i,
  /\bi want to know when i had\b/i,
];
const LATEST_EVENT_SUBJECT_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(when was my last|when did i last|my last)\b/i,
  /\b(last|latest|most recent)\s+(ride|rides|run|runs|swim|swims|workout|workouts|session|sessions|activity|activities|event|events)\b/i,
];
const EVENT_LOOKUP_RANKING_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(longest|shortest|highest|lowest|fastest|slowest|biggest|farthest|furthest)\b/i,
  /\b(max|maximum|min|minimum|peak)\b/i,
];
const AGGREGATE_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(over time|by month|by week|by day|by year|timeline|trend|chart)\b/i,
  /\b(by activity types?|activity type comparison|by sports?|by sport)\b/i,
  /\bstack(?:ed|ing)?\b/i,
];
const PROMPT_ACTIVITY_TYPE_ALIAS_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  activityTypes: ActivityTypes[];
}> = [
  {
    pattern: /\b(ride|rides|cycling ride|bike ride|bike rides)\b/i,
    activityTypes: [ActivityTypes.Cycling],
  },
  {
    // Keep singular "run" as an activity alias only in noun contexts
    // so command-verb phrasing like "run a comparison" is not misclassified.
    pattern: /\b(runs|(?:last|latest|most recent|my|a|an|the|which|what)\s+run)\b/i,
    activityTypes: [ActivityTypes.Running],
  },
  {
    pattern: /\b(swim|swims)\b/i,
    activityTypes: [ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming],
  },
];

const ModelDateRangeSchema = z.union([
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
]);

const UNSUPPORTED_REASON_CODE_VALUES = [
  'invalid_prompt',
  'unsupported_metric',
  'ambiguous_metric',
  'unsupported_capability',
  'too_many_metrics',
  'unsupported_multi_metric_combination',
] as const;

const UNSUPPORTED_REASON_CODE_COVERAGE: Record<AiInsightsUnsupportedReasonCode, true> = {
  invalid_prompt: true,
  unsupported_metric: true,
  ambiguous_metric: true,
  unsupported_capability: true,
  too_many_metrics: true,
  unsupported_multi_metric_combination: true,
};
void UNSUPPORTED_REASON_CODE_COVERAGE;

const UnsupportedReasonCodeSchema = z.enum(UNSUPPORTED_REASON_CODE_VALUES);

const ModelInsightIntentSchema = z.object({
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
  dateRange: ModelDateRangeSchema.optional(),
  unsupportedReasonCode: UnsupportedReasonCodeSchema.optional(),
});

const UnsupportedNormalizeInsightQueryResultSchema = z.object({
  status: z.literal('unsupported'),
  reasonCode: UnsupportedReasonCodeSchema,
  suggestedPrompts: z.array(z.string()),
});

const AGGREGATION_MAP: Record<ModelAggregationCode, ChartDataValueTypes> = {
  total: ChartDataValueTypes.Total,
  average: ChartDataValueTypes.Average,
  minimum: ChartDataValueTypes.Minimum,
  maximum: ChartDataValueTypes.Maximum,
};

const CATEGORY_MAP: Record<ModelCategoryCode, ChartDataCategoryTypes> = {
  date: ChartDataCategoryTypes.DateType,
  activity: ChartDataCategoryTypes.ActivityType,
};

const TIME_INTERVAL_MAP: Record<ModelTimeIntervalCode, TimeIntervals> = {
  auto: TimeIntervals.Auto,
  hourly: TimeIntervals.Hourly,
  daily: TimeIntervals.Daily,
  weekly: TimeIntervals.Weekly,
  biweekly: TimeIntervals.BiWeekly,
  monthly: TimeIntervals.Monthly,
  quarterly: TimeIntervals.Quarterly,
  semesterly: TimeIntervals.Semesterly,
  yearly: TimeIntervals.Yearly,
};

const AUTO_INTERVAL_DAILY_MAX_DAYS = 31;
const AUTO_INTERVAL_WEEKLY_MAX_DAYS = 120;

const defaultNormalizeQueryDependencies: NormalizeQueryDependencies = {
  now: () => new Date(),
  generateIntent: async (input) => buildDeterministicIntent(input.prompt),
};

function buildUnsupportedResult(
  reasonCode: AiInsightsUnsupportedReasonCode,
  prompt: string,
): NormalizeInsightQueryUnsupportedResult {
  return {
    status: 'unsupported',
    reasonCode,
    suggestedPrompts: getSuggestedInsightPrompts(3, prompt),
  };
}

function parseGmtOffsetToMilliseconds(offsetLabel: string): number {
  const normalized = offsetLabel.trim().toUpperCase();
  if (normalized === 'GMT' || normalized === 'UTC') {
    return 0;
  }

  const match = normalized.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    throw new Error(`Unsupported timezone offset label: ${offsetLabel}`);
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || '0');
  return sign * ((hours * 60) + minutes) * 60 * 1000;
}

function getTimeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
  });
  const offsetLabel = formatter.formatToParts(date)
    .find(part => part.type === 'timeZoneName')
    ?.value;

  if (!offsetLabel) {
    return 0;
  }

  return parseGmtOffsetToMilliseconds(offsetLabel);
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);

  return {
    year: Number(parts.find(part => part.type === 'year')?.value || '0'),
    month: Number(parts.find(part => part.type === 'month')?.value || '0'),
    day: Number(parts.find(part => part.type === 'day')?.value || '0'),
  };
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(parts: ZonedDateParts, deltaDays: number): ZonedDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addMonths(parts: ZonedDateParts, deltaMonths: number): ZonedDateParts {
  const monthIndex = ((parts.year * 12) + (parts.month - 1)) + deltaMonths;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12 + 12) % 12 + 1;
  const day = Math.min(parts.day, getDaysInMonth(year, month));
  return { year, month, day };
}

function addYears(parts: ZonedDateParts, deltaYears: number): ZonedDateParts {
  const year = parts.year + deltaYears;
  const day = Math.min(parts.day, getDaysInMonth(year, parts.month));
  return {
    year,
    month: parts.month,
    day,
  };
}

function getWeekday(parts: ZonedDateParts): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function zonedDateTimeToUtcDate(
  parts: ZonedDateParts,
  timeZone: string,
  hours: number,
  minutes: number,
  seconds: number,
  milliseconds: number,
): Date {
  const approximateUtc = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hours,
    minutes,
    seconds,
    milliseconds,
  ));
  const offsetMilliseconds = getTimeZoneOffsetMilliseconds(approximateUtc, timeZone);
  return new Date(approximateUtc.getTime() - offsetMilliseconds);
}

function parseAbsoluteDateString(value: string): ZonedDateParts | null {
  if (!ABSOLUTE_DATE_PATTERN.test(value)) {
    return null;
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12) {
    return null;
  }
  if (day < 1 || day > getDaysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
}

function formatAbsoluteDate(year: number, month: number, day: number): string {
  return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

function buildNormalizedAbsoluteRange(
  start: ZonedDateParts,
  end: ZonedDateParts,
): AbsoluteDateRangeIntent {
  const startMillis = Date.UTC(start.year, start.month - 1, start.day);
  const endMillis = Date.UTC(end.year, end.month - 1, end.day);
  const normalizedStart = startMillis <= endMillis ? start : end;
  const normalizedEnd = startMillis <= endMillis ? end : start;

  return {
    kind: 'absolute',
    startDate: formatAbsoluteDate(normalizedStart.year, normalizedStart.month, normalizedStart.day),
    endDate: formatAbsoluteDate(normalizedEnd.year, normalizedEnd.month, normalizedEnd.day),
  };
}

function resolveCalendarYearAbsoluteRange(year: number): AbsoluteDateRangeIntent {
  return buildNormalizedAbsoluteRange(
    { year, month: 1, day: 1 },
    { year, month: 12, day: 31 },
  );
}

function resolveCalendarMonthAbsoluteRange(
  month: number,
  year: number,
): AbsoluteDateRangeIntent {
  return buildNormalizedAbsoluteRange(
    { year, month, day: 1 },
    { year, month, day: getDaysInMonth(year, month) },
  );
}

function resolveQuarterAbsoluteRange(
  quarter: number,
  year: number,
): AbsoluteDateRangeIntent {
  const normalizedQuarter = Math.max(1, Math.min(4, quarter));
  const startMonth = ((normalizedQuarter - 1) * 3) + 1;
  const endMonth = startMonth + 2;

  return buildNormalizedAbsoluteRange(
    { year, month: startMonth, day: 1 },
    { year, month: endMonth, day: getDaysInMonth(year, endMonth) },
  );
}

function resolveHalfYearAbsoluteRange(
  half: number,
  year: number,
): AbsoluteDateRangeIntent {
  const normalizedHalf = half <= 1 ? 1 : 2;
  const startMonth = normalizedHalf === 1 ? 1 : 7;
  const endMonth = normalizedHalf === 1 ? 6 : 12;

  return buildNormalizedAbsoluteRange(
    { year, month: startMonth, day: 1 },
    { year, month: endMonth, day: getDaysInMonth(year, endMonth) },
  );
}

function resolveMonthNameToNumber(value: string): number | null {
  const normalized = normalizePromptSearchText(value);
  return MONTH_NAME_TO_NUMBER[normalized] ?? null;
}

function resolveMultiPeriodMode(
  prompt: string,
  category: ModelCategoryCode | undefined,
  aggregation: ModelAggregationCode | undefined,
): NormalizedInsightPeriodMode {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (category === 'activity') {
    return 'combined';
  }

  if (/\b(compare|vs|versus|by year|per year|separately)\b/.test(normalizedPrompt)) {
    return 'compare';
  }

  if (/\b(total|sum|combined)\b/.test(normalizedPrompt) || aggregation === 'total') {
    return 'combined';
  }

  return 'combined';
}

interface ResolvePromptDateSelectionOptions {
  timeZone: string;
  now: Date;
}

function resolvePromptRelativeYearComparisonDateSelection(
  prompt: string,
  category: ModelCategoryCode | undefined,
  aggregation: ModelAggregationCode | undefined,
  options: ResolvePromptDateSelectionOptions,
): PromptDateSelectionIntent | null {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return null;
  }

  if (!/\b(compare|vs|versus)\b/.test(normalizedPrompt)) {
    return null;
  }

  if (!/\bthis year\b/.test(normalizedPrompt) || !/\blast year\b/.test(normalizedPrompt)) {
    return null;
  }

  const today = getZonedDateParts(options.now, options.timeZone);
  const currentYear = today.year;
  const previousYear = currentYear - 1;
  const periodMode = resolveMultiPeriodMode(prompt, category, aggregation);

  return {
    effectiveDateRangeIntent: buildNormalizedAbsoluteRange(
      { year: previousYear, month: 1, day: 1 },
      { year: currentYear, month: 12, day: 31 },
    ),
    requestedDateRangeIntents: [
      resolveCalendarYearAbsoluteRange(previousYear),
      resolveCalendarYearAbsoluteRange(currentYear),
    ],
    periodMode,
    compareRequestedTimeInterval: category === 'activity' || periodMode !== 'compare'
      ? undefined
      : 'yearly',
  };
}

function resolvePromptYearListDateSelection(
  prompt: string,
  category: ModelCategoryCode | undefined,
  aggregation: ModelAggregationCode | undefined,
): PromptDateSelectionIntent | null {
  const normalizedPrompt = canonicalizeInsightPrompt(prompt);
  if (!normalizedPrompt) {
    return null;
  }

  const explicitListMatch = normalizedPrompt.match(
    /\b(?:in|for|during)\s+(?:the\s+)?(?:years?\s+)?((?:19|20)\d{2}(?:\s*(?:,|and|vs|versus)\s*(?:19|20)\d{2})+)\b/,
  );
  const bareListMatch = explicitListMatch
    ? null
    : normalizedPrompt.match(/\b((?:19|20)\d{2}(?:\s*(?:,|and|vs|versus)\s*(?:19|20)\d{2})+)\b/);
  const yearListSource = explicitListMatch?.[1] ?? bareListMatch?.[1] ?? null;
  if (!yearListSource) {
    return null;
  }

  const years = Array.from(new Set(
    [...yearListSource.matchAll(new RegExp(`\\b(${YEAR_PATTERN.source})\\b`, 'g'))]
      .map(match => Number(match[1]))
      .filter(year => Number.isInteger(year)),
  )).sort((left, right) => left - right);
  if (years.length < 2) {
    return null;
  }

  const requestedDateRangeIntents: AbsoluteDateRangeIntent[] = [];
  let rangeStartYear = years[0];
  let previousYear = years[0];

  for (let index = 1; index < years.length; index += 1) {
    const year = years[index];
    if (year === previousYear + 1) {
      previousYear = year;
      continue;
    }

    requestedDateRangeIntents.push(buildNormalizedAbsoluteRange(
      { year: rangeStartYear, month: 1, day: 1 },
      { year: previousYear, month: 12, day: 31 },
    ));
    rangeStartYear = year;
    previousYear = year;
  }

  requestedDateRangeIntents.push(buildNormalizedAbsoluteRange(
    { year: rangeStartYear, month: 1, day: 1 },
    { year: previousYear, month: 12, day: 31 },
  ));

  const periodMode = resolveMultiPeriodMode(prompt, category, aggregation);

  return {
    effectiveDateRangeIntent: buildNormalizedAbsoluteRange(
      { year: years[0], month: 1, day: 1 },
      { year: years[years.length - 1], month: 12, day: 31 },
    ),
    requestedDateRangeIntents,
    periodMode,
    compareRequestedTimeInterval: category === 'activity' || periodMode !== 'compare'
      ? undefined
      : 'yearly',
  };
}

function resolvePromptDateSelection(
  prompt: string,
  category: ModelCategoryCode | undefined,
  aggregation: ModelAggregationCode | undefined,
  options: ResolvePromptDateSelectionOptions = {
    timeZone: 'UTC',
    now: new Date(),
  },
): PromptDateSelectionIntent {
  const relativeYearComparisonSelection = resolvePromptRelativeYearComparisonDateSelection(
    prompt,
    category,
    aggregation,
    options,
  );
  if (relativeYearComparisonSelection) {
    return relativeYearComparisonSelection;
  }

  const multiYearSelection = resolvePromptYearListDateSelection(prompt, category, aggregation);
  if (multiYearSelection) {
    return multiYearSelection;
  }

  return {
    effectiveDateRangeIntent: resolvePromptDateRangeIntent(prompt),
  };
}

function resolveDateRange(
  dateRangeIntent: DateRangeIntent | undefined,
  timeZone: string,
  now: Date,
): NormalizedInsightDateRange {
  const today = getZonedDateParts(now, timeZone);
  let start = { year: today.year, month: 1, day: 1 };
  const end = today;
  let source: 'prompt' | 'default' = 'default';

  if (dateRangeIntent?.kind === 'last_n' || dateRangeIntent?.kind === 'last') {
    source = 'prompt';
    switch (dateRangeIntent.unit) {
      case 'day':
        start = addDays(today, -(dateRangeIntent.amount - 1));
        break;
      case 'week':
        start = addDays(today, -((dateRangeIntent.amount * 7) - 1));
        break;
      case 'month':
        start = addMonths(today, -dateRangeIntent.amount);
        break;
      case 'year':
        start = addYears(today, -dateRangeIntent.amount);
        break;
      default:
        break;
    }
  } else if (dateRangeIntent?.kind === 'current_period' || dateRangeIntent?.kind === 'this') {
    source = 'prompt';
    switch (dateRangeIntent.unit) {
      case 'week': {
        const weekday = getWeekday(today);
        const mondayOffset = weekday === 0 ? 6 : weekday - 1;
        start = addDays(today, -mondayOffset);
        break;
      }
      case 'month':
        start = { year: today.year, month: today.month, day: 1 };
        break;
      case 'year':
        start = { year: today.year, month: 1, day: 1 };
        break;
      default:
        break;
    }
  } else if (dateRangeIntent?.kind === 'all_time') {
    return {
      kind: 'all_time',
      timezone: timeZone,
      source: 'prompt',
    };
  } else if (dateRangeIntent?.kind === 'absolute') {
    source = 'prompt';
    const parsedStart = parseAbsoluteDateString(dateRangeIntent.startDate);
    const parsedEnd = parseAbsoluteDateString(dateRangeIntent.endDate);
    if (!parsedStart || !parsedEnd) {
      return resolveDateRange(undefined, timeZone, now);
    }
    const startDate = zonedDateTimeToUtcDate(parsedStart, timeZone, 0, 0, 0, 0);
    const endDate = zonedDateTimeToUtcDate(parsedEnd, timeZone, 23, 59, 59, 999);
    if (startDate.getTime() > endDate.getTime()) {
      return resolveDateRange(undefined, timeZone, now);
    }

    return {
      kind: 'bounded',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      timezone: timeZone,
      source,
    };
  }

  return {
    kind: 'bounded',
    startDate: zonedDateTimeToUtcDate(start, timeZone, 0, 0, 0, 0).toISOString(),
    endDate: zonedDateTimeToUtcDate(end, timeZone, 23, 59, 59, 999).toISOString(),
    timezone: timeZone,
    source,
  };
}

function resolveRequestedDateRanges(
  dateRangeIntents: AbsoluteDateRangeIntent[] | undefined,
  timeZone: string,
  now: Date,
): NormalizedInsightBoundedDateRange[] | undefined {
  if (!dateRangeIntents?.length) {
    return undefined;
  }

  const resolvedRanges = dateRangeIntents
    .map(dateRangeIntent => resolveDateRange(dateRangeIntent, timeZone, now))
    .filter((dateRange): dateRange is NormalizedInsightBoundedDateRange => dateRange.kind === 'bounded');

  return resolvedRanges.length ? resolvedRanges : undefined;
}

function resolveChartType(
  categoryType: ChartDataCategoryTypes,
  valueType: ChartDataValueTypes,
  forceDateColumns: boolean,
  promptChartPreference: NormalizeQueryPromptContext['promptChartPreference'],
): ChartTypes {
  if (promptChartPreference === 'columns') {
    return categoryType === ChartDataCategoryTypes.ActivityType
      ? ChartTypes.ColumnsHorizontal
      : ChartTypes.ColumnsVertical;
  }

  if (promptChartPreference === 'lines') {
    return categoryType === ChartDataCategoryTypes.ActivityType
      ? ChartTypes.LinesHorizontal
      : ChartTypes.LinesVertical;
  }

  if (categoryType === ChartDataCategoryTypes.ActivityType) {
    return ChartTypes.ColumnsHorizontal;
  }

  if (forceDateColumns || valueType === ChartDataValueTypes.Total) {
    return ChartTypes.ColumnsVertical;
  }

  return ChartTypes.LinesVertical;
}

function resolvePromptChartPreference(
  prompt: string,
): NormalizeQueryPromptContext['promptChartPreference'] {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  if (/\b(columns?|bars?)\b/.test(normalizedPrompt)) {
    return 'columns';
  }

  if (/\b(lines?|line chart)\b/.test(normalizedPrompt)) {
    return 'lines';
  }

  return undefined;
}

function normalizeActivityTypes(activityTypes: string[] | undefined): ActivityTypes[] | null {
  if (!activityTypes?.length) {
    return [];
  }

  const resolved: ActivityTypes[] = [];
  for (const rawValue of activityTypes) {
    const activityType = resolveCanonicalActivityType(rawValue);
    if (!activityType) {
      return null;
    }
    if (!resolved.includes(activityType)) {
      resolved.push(activityType);
    }
  }

  return resolved;
}

function normalizeActivityTypeGroups(activityTypeGroups: string[] | undefined): ActivityTypeGroup[] | null {
  if (!activityTypeGroups?.length) {
    return [];
  }

  const resolved: ActivityTypeGroup[] = [];
  for (const rawValue of activityTypeGroups) {
    const activityTypeGroup = resolveCanonicalActivityTypeGroup(rawValue);
    if (!activityTypeGroup) {
      return null;
    }
    if (!resolved.includes(activityTypeGroup)) {
      resolved.push(activityTypeGroup);
    }
  }

  return resolved;
}

function extractPromptActivityExclusionClauses(prompt: string): string[] {
  const clauses: string[] = [];
  const pattern = /\b(?:excluding|exclude|except(?: for)?|without)\b\s+([^,.;]+)/gi;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(prompt)) !== null) {
    const clause = `${match[1] || ''}`.trim();
    if (clause) {
      clauses.push(clause);
    }
  }

  return clauses;
}

function stripPromptActivityExclusionClauses(prompt: string): string {
  return prompt.replace(/\b(?:excluding|exclude|except(?: for)?|without)\b\s+[^,.;]+/gi, ' ');
}

function resolvePromptActivityTypeGroups(prompt: string): ActivityTypeGroup[] {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return [];
  }

  return SUPPORTED_ACTIVITY_TYPE_GROUPS.filter((activityTypeGroup) => {
    const metadata = getActivityTypeGroupMetadata(activityTypeGroup);
    const searchTerms = [metadata.label, ...metadata.aliases]
      .map(alias => normalizePromptSearchText(alias))
      .filter(Boolean);

    if (isAmbiguousActivityTypeGroup(activityTypeGroup)) {
      return searchTerms.some((term) => [
        `${term} group`,
        `${term} family`,
        `${term} activities`,
        `all ${term} activities`,
        `all ${term} activity types`,
        `all ${term}`,
      ].some(trigger => normalizedPrompt.includes(trigger)));
    }

    return searchTerms.some(term => normalizedPrompt.includes(term));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isGenericTrainingMetricPhrase(
  normalizedPrompt: string,
  matchEndIndex: number,
): boolean {
  const suffix = normalizedPrompt.slice(matchEndIndex).trimStart();
  return /^(duration|time|stress|effect|score|load)\b/.test(suffix);
}

function resolveActivityGroupSearchTerms(activityTypeGroup: ActivityTypeGroup): string[] {
  const metadata = getActivityTypeGroupMetadata(activityTypeGroup);
  return [metadata.label, ...metadata.aliases]
    .map(alias => normalizePromptSearchText(alias))
    .filter(Boolean);
}

function resolvePromptActivityTypes(
  prompt: string,
  promptActivityTypeGroups: ActivityTypeGroup[],
): ActivityTypes[] {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return [];
  }

  const explicitGroupTerms = new Set<string>();
  for (const activityTypeGroup of promptActivityTypeGroups) {
    for (const searchTerm of resolveActivityGroupSearchTerms(activityTypeGroup)) {
      explicitGroupTerms.add(searchTerm);
    }
  }

  const exactMatches = CANONICAL_ACTIVITY_TYPES
    .map(activityType => ({
      activityType,
      normalizedLabel: normalizePromptSearchText(activityType),
    }))
    .filter(({ normalizedLabel }) => Boolean(normalizedLabel))
    .sort((left, right) => right.normalizedLabel.length - left.normalizedLabel.length);

  const occupiedRanges: Array<{ start: number; end: number }> = [];
  const resolved: ActivityTypes[] = [];

  for (const { activityType, normalizedLabel } of exactMatches) {
    const searchPattern = new RegExp(`\\b${escapeRegExp(normalizedLabel)}\\b`, 'g');
    let match: RegExpExecArray | null = null;
    while ((match = searchPattern.exec(normalizedPrompt)) !== null) {
      const start = match.index;
      const end = start + normalizedLabel.length;
      if (
        activityType === ActivityTypes.Training
        && isGenericTrainingMetricPhrase(normalizedPrompt, end)
      ) {
        continue;
      }
      const overlapsExisting = occupiedRanges.some(range => !(end <= range.start || start >= range.end));
      if (overlapsExisting || explicitGroupTerms.has(normalizedLabel)) {
        continue;
      }

      occupiedRanges.push({ start, end });
      resolved.push(activityType);
      break;
    }
  }

  for (const activityAliasPattern of PROMPT_ACTIVITY_TYPE_ALIAS_PATTERNS) {
    if (!activityAliasPattern.pattern.test(normalizedPrompt)) {
      continue;
    }
    for (const activityType of activityAliasPattern.activityTypes) {
      if (!resolved.includes(activityType)) {
        resolved.push(activityType);
      }
    }
  }

  return resolved;
}

function expandActivityTypeGroups(activityTypeGroups: ActivityTypeGroup[]): ActivityTypes[] {
  const expanded: ActivityTypes[] = [];
  for (const activityTypeGroup of activityTypeGroups) {
    for (const activityType of getActivityTypesForGroup(activityTypeGroup)) {
      if (!expanded.includes(activityType)) {
        expanded.push(activityType);
      }
    }
  }

  return expanded;
}

function excludeActivityTypes(
  activityTypes: ActivityTypes[],
  excludedActivityTypes: ReadonlySet<ActivityTypes>,
): ActivityTypes[] {
  if (!excludedActivityTypes.size) {
    return activityTypes;
  }

  return activityTypes.filter(activityType => !excludedActivityTypes.has(activityType));
}

function resolveKeywordActivityTypeExclusions(promptClause: string): ActivityTypes[] {
  const normalizedClause = normalizePromptSearchText(promptClause);
  if (!normalizedClause) {
    return [];
  }

  const resolved: ActivityTypes[] = [];

  if (/\bindoor\b/.test(normalizedClause)) {
    resolved.push(
      ...CANONICAL_ACTIVITY_TYPES.filter(activityType => isIndoorActivityType(activityType)),
    );
  }

  return Array.from(new Set(resolved));
}

function toCategoryType(category: ModelCategoryCode | undefined): ChartDataCategoryTypes {
  return CATEGORY_MAP[category || 'date'];
}

function toValueType(
  aggregation: ModelAggregationCode | undefined,
  fallback: ChartDataValueTypes,
): ChartDataValueTypes {
  return aggregation ? AGGREGATION_MAP[aggregation] : fallback;
}

function toRequestedTimeInterval(
  categoryType: ChartDataCategoryTypes,
  interval: ModelTimeIntervalCode | undefined,
  dateRangeIntent: DateRangeIntent | undefined,
): TimeIntervals | undefined {
  if (categoryType === ChartDataCategoryTypes.ActivityType) {
    return undefined;
  }

  if (interval && interval !== 'auto') {
    return TIME_INTERVAL_MAP[interval];
  }

  if (dateRangeIntent?.kind === 'last_n' || dateRangeIntent?.kind === 'last') {
    switch (dateRangeIntent.unit) {
      case 'day':
        if (dateRangeIntent.amount <= AUTO_INTERVAL_DAILY_MAX_DAYS) {
          return TimeIntervals.Daily;
        }
        if (dateRangeIntent.amount <= AUTO_INTERVAL_WEEKLY_MAX_DAYS) {
          return TimeIntervals.Weekly;
        }
        return TimeIntervals.Monthly;
      case 'week':
        return dateRangeIntent.amount > 1 ? TimeIntervals.Weekly : TimeIntervals.Daily;
      case 'month':
        return dateRangeIntent.amount > 1 ? TimeIntervals.Monthly : TimeIntervals.Daily;
      case 'year':
        return dateRangeIntent.amount > 1 ? TimeIntervals.Yearly : TimeIntervals.Monthly;
      default:
        break;
    }
  }

  if (dateRangeIntent?.kind === 'current_period' || dateRangeIntent?.kind === 'this') {
    switch (dateRangeIntent.unit) {
      case 'week':
      case 'month':
        return TimeIntervals.Daily;
      case 'year':
        return TimeIntervals.Monthly;
      default:
        break;
    }
  }

  return TIME_INTERVAL_MAP.auto;
}

function resolvePromptRequestedTimeInterval(prompt: string): ModelTimeIntervalCode | undefined {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  if (/\b(hourly|by hour|per hour)\b/.test(normalizedPrompt)) {
    return 'hourly';
  }
  if (/\b(daily|by day|per day)\b/.test(normalizedPrompt)) {
    return 'daily';
  }
  if (/\b(weekly|by week|per week)\b/.test(normalizedPrompt)) {
    return 'weekly';
  }
  if (/\b(biweekly|bi weekly|every two weeks)\b/.test(normalizedPrompt)) {
    return 'biweekly';
  }
  if (/\b(monthly|by month|per month)\b/.test(normalizedPrompt)) {
    return 'monthly';
  }
  if (/\b(quarterly|by quarter|per quarter)\b/.test(normalizedPrompt)) {
    return 'quarterly';
  }
  if (/\b(yearly|annually|by year|per year)\b/.test(normalizedPrompt)) {
    return 'yearly';
  }

  return undefined;
}

function resolveStackedDateDefaultInterval(dateRangeIntent: DateRangeIntent | undefined): TimeIntervals {
  if (dateRangeIntent?.kind === 'last_n' || dateRangeIntent?.kind === 'last') {
    if (dateRangeIntent.unit === 'day') {
      return dateRangeIntent.amount <= 14 ? TimeIntervals.Daily : TimeIntervals.Weekly;
    }
    if (dateRangeIntent.unit === 'week') {
      return TimeIntervals.Weekly;
    }
    if (dateRangeIntent.unit === 'month') {
      return dateRangeIntent.amount <= 2 ? TimeIntervals.Weekly : TimeIntervals.Monthly;
    }
    if (dateRangeIntent.unit === 'year') {
      return dateRangeIntent.amount <= 1 ? TimeIntervals.Monthly : TimeIntervals.Quarterly;
    }
  }

  if (dateRangeIntent?.kind === 'current_period' || dateRangeIntent?.kind === 'this') {
    if (dateRangeIntent.unit === 'week') {
      return TimeIntervals.Daily;
    }
    if (dateRangeIntent.unit === 'month') {
      return TimeIntervals.Weekly;
    }
    if (dateRangeIntent.unit === 'year') {
      return TimeIntervals.Monthly;
    }
  }

  return TimeIntervals.Weekly;
}

function detectUnsupportedCapability(prompt: string): boolean {
  return UNSUPPORTED_PROMPT_PATTERNS.some(pattern => pattern.test(prompt));
}

function promptImpliesAllTime(prompt: string): boolean {
  return EXPLICIT_ALL_TIME_PROMPT_PATTERNS.some(pattern => pattern.test(prompt));
}

function promptImpliesDateActivityStackedColumns(
  prompt: string,
  options?: {
    hasDateRangeIntent?: boolean;
    hasRequestedTimeInterval?: boolean;
  },
): boolean {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return false;
  }

  const matchesCore = DATE_ACTIVITY_STACKED_CORE_PROMPT_PATTERNS.every(pattern => pattern.test(normalizedPrompt));
  if (!matchesCore) {
    return false;
  }

  const matchesExplicitTimeAxis = DATE_ACTIVITY_STACKED_TIME_AXIS_PROMPT_PATTERNS
    .some(pattern => pattern.test(normalizedPrompt));
  if (matchesExplicitTimeAxis) {
    return true;
  }

  return options?.hasDateRangeIntent === true || options?.hasRequestedTimeInterval === true;
}

function promptImpliesEventLookup(prompt: string): boolean {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return false;
  }

  if (AGGREGATE_PROMPT_PATTERNS.some(pattern => pattern.test(normalizedPrompt))) {
    return false;
  }

  const hasExplicitTopResultsIntent = resolvePromptTopResultsLimit(prompt) !== undefined;
  const hasRankingIntent = EVENT_LOOKUP_RANKING_PROMPT_PATTERNS.some(pattern => pattern.test(normalizedPrompt));
  if (!hasRankingIntent && !hasExplicitTopResultsIntent) {
    return false;
  }

  // "top N" phrasing is an explicit ranked-event lookup intent.
  if (hasExplicitTopResultsIntent) {
    return true;
  }

  if (EVENT_LOOKUP_SUBJECT_PROMPT_PATTERNS.some(pattern => pattern.test(normalizedPrompt))) {
    return true;
  }

  if (/\b(jump|hang time|air time)\b/.test(normalizedPrompt)) {
    return true;
  }

  return /\bwhen\b/.test(normalizedPrompt);
}

function promptImpliesLatestEventLookup(prompt: string): boolean {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return false;
  }

  // Metric-bearing prompts should continue through metric normalization
  // instead of being short-circuited to latest-event lookups.
  if (findInsightMetricAliasMatch(canonicalizeInsightPrompt(prompt))) {
    return false;
  }

  if (AGGREGATE_PROMPT_PATTERNS.some(pattern => pattern.test(normalizedPrompt))) {
    return false;
  }

  if (EVENT_LOOKUP_RANKING_PROMPT_PATTERNS.some(pattern => pattern.test(normalizedPrompt))) {
    return false;
  }

  if (!/\b(last|latest|most recent)\b/.test(normalizedPrompt)) {
    return false;
  }

  return LATEST_EVENT_SUBJECT_PROMPT_PATTERNS.some(pattern => pattern.test(normalizedPrompt));
}

function resolvePromptAggregation(prompt: string): ModelAggregationCode | undefined {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  if (/\b(total|sum|combined)\b/.test(normalizedPrompt)) {
    return 'total';
  }
  if (/\b(avg|average|mean)\b/.test(normalizedPrompt)) {
    return 'average';
  }
  if (/\b(min|minimum|lowest|shortest)\b/.test(normalizedPrompt)) {
    return 'minimum';
  }
  if (/\b(max|maximum|highest|peak|longest|furthest|farthest|biggest)\b/.test(normalizedPrompt)) {
    return 'maximum';
  }

  return undefined;
}

function resolveImplicitEventLookupMetricAlias(prompt: string): string | null {
  if (!promptImpliesEventLookup(prompt)) {
    return null;
  }

  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return null;
  }

  const hasActivitySubject = /\b(ride|rides|run|runs|swim|swims|workout|workouts|session|sessions|activity|activities|event|events)\b/.test(normalizedPrompt);
  const hasDistanceSuperlative = /\b(longest|shortest|farthest|furthest)\b/.test(normalizedPrompt);
  if (!hasActivitySubject || !hasDistanceSuperlative) {
    return null;
  }

  return 'distance';
}

function resolvePromptAggregationCodes(prompt: string): ModelAggregationCode[] {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return [];
  }

  const aggregationCodes = new Set<ModelAggregationCode>();
  if (/\b(total|sum|combined)\b/.test(normalizedPrompt)) {
    aggregationCodes.add('total');
  }
  if (/\b(avg|average|mean)\b/.test(normalizedPrompt)) {
    aggregationCodes.add('average');
  }
  if (/\b(min|minimum|lowest|shortest)\b/.test(normalizedPrompt)) {
    aggregationCodes.add('minimum');
  }
  if (/\b(max|maximum|highest|peak|longest|furthest|farthest|biggest)\b/.test(normalizedPrompt)) {
    aggregationCodes.add('maximum');
  }

  return [...aggregationCodes];
}

function resolvePromptTopResultsLimit(prompt: string): number | undefined {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  const limitPatterns: readonly RegExp[] = [
    /\btop\s+((?:\d{1,3}(?:\s\d{3})+)|\d+)\b/,
    /\b((?:\d{1,3}(?:\s\d{3})+)|\d+)\s+top\b/,
    /\bbest\s+((?:\d{1,3}(?:\s\d{3})+)|\d+)\b/,
  ];

  const matchedLimitToken = limitPatterns
    .map((pattern) => normalizedPrompt.match(pattern)?.[1] ?? null)
    .find((value) => typeof value === 'string' && value.length > 0);
  if (!matchedLimitToken) {
    return undefined;
  }

  const parsedLimit = Number.parseInt(matchedLimitToken.replace(/\s+/g, ''), 10);
  if (!Number.isFinite(parsedLimit)) {
    return undefined;
  }

  return clampAiInsightsTopResultsLimit(parsedLimit);
}

function resolvePromptAggregationForMetric(
  prompt: string,
  metricKey: InsightMetricKey,
  fallback: ModelAggregationCode | undefined,
): ModelAggregationCode | undefined {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return fallback;
  }

  const hasFastest = /\bfastest\b/.test(normalizedPrompt);
  const hasSlowest = /\bslowest\b/.test(normalizedPrompt);
  if (!hasFastest && !hasSlowest) {
    return fallback;
  }

  // Keep explicit aggregation bounds authoritative when present.
  if (/\b(min|minimum|max|maximum|lowest|highest|peak|shortest|longest|furthest|farthest|biggest)\b/.test(normalizedPrompt)) {
    return fallback;
  }

  const isInverseMetric = INVERSE_SUPERLATIVE_METRIC_KEYS.has(metricKey);
  if (hasFastest) {
    return isInverseMetric ? 'minimum' : 'maximum';
  }
  if (hasSlowest) {
    return isInverseMetric ? 'maximum' : 'minimum';
  }

  return fallback;
}

function resolveMultiMetricGroupingMode(
  prompt: string,
  dateRangeIntent: DateRangeIntent | undefined,
  requestedTimeInterval: ModelTimeIntervalCode | undefined,
): AiInsightsMultiMetricGroupingMode {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (
    /\b(over time|timeline|trend)\b/.test(normalizedPrompt)
    || dateRangeIntent !== undefined
    || requestedTimeInterval !== undefined
  ) {
    return 'date';
  }

  return 'overall';
}

function resolveMultiMetricIntent(
  prompt: string,
  promptContext: NormalizeQueryPromptContext | null = null,
): MultiMetricIntent | NormalizeInsightQueryUnsupportedResult | null {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  const metricMatches = findInsightMetricAliasMatches(canonicalizeInsightPrompt(prompt));
  if (metricMatches.length <= 1) {
    return null;
  }

  if (metricMatches.length > MAX_MULTI_METRICS) {
    return buildUnsupportedResult('too_many_metrics', prompt);
  }

  if (promptImpliesEventLookup(prompt)) {
    return buildUnsupportedResult('unsupported_multi_metric_combination', prompt);
  }

  const category = promptContext?.promptCategory ?? resolvePromptCategory(prompt);
  const aggregation = promptContext?.promptAggregation ?? resolvePromptAggregation(prompt);
  const promptDateSelection = promptContext?.promptDateSelection
    ?? resolvePromptDateSelection(prompt, category, aggregation);
  const requestedTimeInterval = promptContext?.promptRequestedTimeInterval
    ?? resolvePromptRequestedTimeInterval(prompt)
    ?? promptDateSelection.compareRequestedTimeInterval;
  const dateRangeIntent = promptDateSelection.effectiveDateRangeIntent;
  if (
    category === 'activity'
    || promptImpliesDateActivityStackedColumns(prompt, {
      hasDateRangeIntent: dateRangeIntent !== undefined,
      hasRequestedTimeInterval: requestedTimeInterval !== undefined,
    })
  ) {
    return buildUnsupportedResult('unsupported_multi_metric_combination', prompt);
  }

  const aggregationCodes = resolvePromptAggregationCodes(prompt);
  if (aggregationCodes.length > 1) {
    return buildUnsupportedResult('unsupported_multi_metric_combination', prompt);
  }

  const prefersSharedAverageFallback = /\b(compare|vs|versus|over time|timeline|trend)\b/.test(normalizedPrompt);
  const sharedValueType = aggregationCodes.length === 1
    ? AGGREGATION_MAP[aggregationCodes[0]]
    : (() => {
      const defaultValueTypes = Array.from(new Set(metricMatches.map(match => match.metric.defaultValueType)));
      if (defaultValueTypes.length === 1) {
        return defaultValueTypes[0];
      }

      if (!prefersSharedAverageFallback) {
        return null;
      }

      const allMetricsSupportAverage = metricMatches.every((match) => (
        isAggregationAllowedForMetric(match.metric.key, ChartDataValueTypes.Average)
      ));
      return allMetricsSupportAverage ? ChartDataValueTypes.Average : null;
    })();
  if (!sharedValueType) {
    return buildUnsupportedResult('unsupported_multi_metric_combination', prompt);
  }

  const metricSelections = metricMatches.map((match) => {
    const metric = resolveInsightMetric(match.alias, sharedValueType)
      || resolveInsightMetric(match.metric.key, sharedValueType)
      || match.metric;

    if (!isAggregationAllowedForMetric(metric.key, sharedValueType)) {
      return null;
    }

    return {
      metricKey: metric.key,
      dataType: metric.dataType,
      valueType: sharedValueType,
    } satisfies NormalizedInsightMetricSelection;
  });

  if (metricSelections.some(selection => selection === null)) {
    return buildUnsupportedResult('unsupported_multi_metric_combination', prompt);
  }

  return {
    valueType: sharedValueType,
    metricSelections: metricSelections as NormalizedInsightMetricSelection[],
    groupingMode: resolveMultiMetricGroupingMode(prompt, dateRangeIntent, requestedTimeInterval),
  };
}

function resolvePromptCategory(prompt: string): ModelCategoryCode | undefined {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  if (
    /\b((?:by|per)\s+(?:activity type|sports?|sport)|activity type comparison)\b/.test(normalizedPrompt)
    || /\b(?:what|which)\s+(?:activities|activity types|sports?|sport)\s+had\b/.test(normalizedPrompt)
  ) {
    return 'activity';
  }

  return 'date';
}

function resolvePromptDateRangeIntent(prompt: string): DateRangeIntent | undefined {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  if (promptImpliesAllTime(normalizedPrompt)) {
    return { kind: 'all_time' };
  }

  const absoluteRangeMatch = normalizedPrompt.match(/\b(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and)\s+(\d{4}-\d{2}-\d{2})\b/);
  if (absoluteRangeMatch) {
    return {
      kind: 'absolute',
      startDate: absoluteRangeMatch[1],
      endDate: absoluteRangeMatch[2],
    };
  }

  const standaloneAbsoluteMatch = normalizedPrompt.match(/\b(\d{4}-\d{2}-\d{2})\s+(?:to|through|until|-)\s+(\d{4}-\d{2}-\d{2})\b/);
  if (standaloneAbsoluteMatch) {
    return {
      kind: 'absolute',
      startDate: standaloneAbsoluteMatch[1],
      endDate: standaloneAbsoluteMatch[2],
    };
  }

  const monthNamePattern = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const monthYearRangeMatch = normalizedPrompt.match(
    new RegExp(`\\b(?:from|between)\\s+${monthNamePattern}\\s+(${YEAR_PATTERN.source})\\s+(?:to|through|and|-)\\s+${monthNamePattern}\\s+(${YEAR_PATTERN.source})\\b`),
  );
  if (monthYearRangeMatch) {
    const startMonth = resolveMonthNameToNumber(monthYearRangeMatch[1] || '');
    const startYear = Number(monthYearRangeMatch[2]);
    const endMonth = resolveMonthNameToNumber(monthYearRangeMatch[3] || '');
    const endYear = Number(monthYearRangeMatch[4]);
    if (startMonth && endMonth && Number.isInteger(startYear) && Number.isInteger(endYear)) {
      return buildNormalizedAbsoluteRange(
        { year: startYear, month: startMonth, day: 1 },
        { year: endYear, month: endMonth, day: getDaysInMonth(endYear, endMonth) },
      );
    }
  }

  const explicitMonthYearMatch = normalizedPrompt.match(
    new RegExp(`\\b(?:in|for|during)\\s+${monthNamePattern}\\s+(${YEAR_PATTERN.source})\\b`),
  );
  if (explicitMonthYearMatch) {
    const month = resolveMonthNameToNumber(explicitMonthYearMatch[1] || '');
    const year = Number(explicitMonthYearMatch[2]);
    if (month && Number.isInteger(year)) {
      return resolveCalendarMonthAbsoluteRange(month, year);
    }
  }

  const explicitYearMonthMatch = normalizedPrompt.match(
    new RegExp(`\\b(?:in|for|during)\\s+(${YEAR_PATTERN.source})\\s+${monthNamePattern}\\b`),
  );
  if (explicitYearMonthMatch) {
    const year = Number(explicitYearMonthMatch[1]);
    const month = resolveMonthNameToNumber(explicitYearMonthMatch[2] || '');
    if (month && Number.isInteger(year)) {
      return resolveCalendarMonthAbsoluteRange(month, year);
    }
  }

  const calendarYearRangeMatch = normalizedPrompt.match(/\b(?:from|between)\s+((?:19|20)\d{2})\s+(?:to|through|and|-)\s+((?:19|20)\d{2})\b/);
  if (calendarYearRangeMatch) {
    const startYear = Number(calendarYearRangeMatch[1]);
    const endYear = Number(calendarYearRangeMatch[2]);
    if (Number.isInteger(startYear) && Number.isInteger(endYear)) {
      return buildNormalizedAbsoluteRange(
        { year: startYear, month: 1, day: 1 },
        { year: endYear, month: 12, day: 31 },
      );
    }
  }

  const standaloneCalendarYearRangeMatch = normalizedPrompt.match(/\b((?:19|20)\d{2})\s*(?:to|through|until|-)\s*((?:19|20)\d{2})\b/);
  if (standaloneCalendarYearRangeMatch) {
    const startYear = Number(standaloneCalendarYearRangeMatch[1]);
    const endYear = Number(standaloneCalendarYearRangeMatch[2]);
    if (Number.isInteger(startYear) && Number.isInteger(endYear)) {
      return buildNormalizedAbsoluteRange(
        { year: startYear, month: 1, day: 1 },
        { year: endYear, month: 12, day: 31 },
      );
    }
  }

  const explicitQuarterMatch = normalizedPrompt.match(/\b(?:in|for|during)\s+q([1-4])\s+((?:19|20)\d{2})\b/);
  if (explicitQuarterMatch) {
    const quarter = Number(explicitQuarterMatch[1]);
    const year = Number(explicitQuarterMatch[2]);
    if (Number.isInteger(quarter) && Number.isInteger(year)) {
      return resolveQuarterAbsoluteRange(quarter, year);
    }
  }

  const textualQuarterMatch = normalizedPrompt.match(/\b(?:in|for|during)\s+(first|1st|second|2nd|third|3rd|fourth|4th)\s+quarter(?:\s+of)?\s+((?:19|20)\d{2})\b/);
  if (textualQuarterMatch) {
    const quarter = (() => {
      switch (textualQuarterMatch[1]) {
        case 'first':
        case '1st':
          return 1;
        case 'second':
        case '2nd':
          return 2;
        case 'third':
        case '3rd':
          return 3;
        case 'fourth':
        case '4th':
          return 4;
        default:
          return null;
      }
    })();
    const year = Number(textualQuarterMatch[2]);
    if (quarter && Number.isInteger(year)) {
      return resolveQuarterAbsoluteRange(quarter, year);
    }
  }

  const explicitHalfYearMatch = normalizedPrompt.match(/\b(?:in|for|during)\s+h([12])\s+((?:19|20)\d{2})\b/);
  if (explicitHalfYearMatch) {
    const half = Number(explicitHalfYearMatch[1]);
    const year = Number(explicitHalfYearMatch[2]);
    if (Number.isInteger(half) && Number.isInteger(year)) {
      return resolveHalfYearAbsoluteRange(half, year);
    }
  }

  const textualHalfYearMatch = normalizedPrompt.match(/\b(?:in|for|during)\s+(first|1st|second|2nd)\s+half(?:\s+of)?\s+((?:19|20)\d{2})\b/);
  if (textualHalfYearMatch) {
    const half = textualHalfYearMatch[1] === 'first' || textualHalfYearMatch[1] === '1st' ? 1 : 2;
    const year = Number(textualHalfYearMatch[2]);
    if (Number.isInteger(year)) {
      return resolveHalfYearAbsoluteRange(half, year);
    }
  }

  const calendarYearMatch = normalizedPrompt.match(/\b(?:in|for|during)\s+(?:the\s+)?(?:year\s+)?((?:19|20)\d{2})\b/);
  if (calendarYearMatch) {
    const year = Number(calendarYearMatch[1]);
    if (Number.isInteger(year)) {
      return resolveCalendarYearAbsoluteRange(year);
    }
  }

  const bareYearMatches = [...normalizedPrompt.matchAll(new RegExp(`\\b(${YEAR_PATTERN.source})\\b`, 'g'))]
    .map((match) => Number(match[1]))
    .filter(year => Number.isInteger(year));
  if (bareYearMatches.length === 1) {
    return resolveCalendarYearAbsoluteRange(bareYearMatches[0]);
  }

  const relativeMatch = normalizedPrompt.match(/\b(?:last|past)\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b/);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const rawUnit = relativeMatch[2];
    const unit = rawUnit.endsWith('s') ? rawUnit.slice(0, -1) : rawUnit;
    if (amount > 0 && (unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year')) {
      return {
        kind: 'last_n',
        amount,
        unit,
      };
    }
  }

  if (/\blast week\b/.test(normalizedPrompt)) {
    return { kind: 'last_n', amount: 1, unit: 'week' };
  }

  if (/\blast month\b/.test(normalizedPrompt)) {
    return { kind: 'last_n', amount: 1, unit: 'month' };
  }

  if (/\blast year\b/.test(normalizedPrompt)) {
    return { kind: 'last_n', amount: 1, unit: 'year' };
  }

  if (/\bthis week\b/.test(normalizedPrompt)) {
    return { kind: 'current_period', unit: 'week' };
  }

  if (/\bthis month\b/.test(normalizedPrompt)) {
    return { kind: 'current_period', unit: 'month' };
  }

  if (/\bthis year\b/.test(normalizedPrompt)) {
    return { kind: 'current_period', unit: 'year' };
  }

  return undefined;
}

function buildDeterministicIntent(prompt: string): ModelInsightIntent {
  const canonicalPrompt = canonicalizeInsightPrompt(prompt);
  const metricMatch = findInsightMetricAliasMatch(canonicalPrompt);
  const fallbackMetricAlias = metricMatch ? null : resolveImplicitEventLookupMetricAlias(prompt);
  const resolvedMetric = metricMatch?.metric || (fallbackMetricAlias ? resolveInsightMetric(fallbackMetricAlias) : null);
  const resolvedMetricAlias = metricMatch?.alias || fallbackMetricAlias;

  if (!resolvedMetric || !resolvedMetricAlias) {
    return {
      status: 'unsupported',
      unsupportedReasonCode: 'unsupported_metric',
    };
  }

  const activityTypeGroups = resolvePromptActivityTypeGroups(prompt);
  const activityTypes = resolvePromptActivityTypes(prompt, activityTypeGroups);

  const promptAggregation = resolvePromptAggregationForMetric(
    prompt,
    resolvedMetric.key,
    resolvePromptAggregation(prompt),
  );

  return ModelInsightIntentSchema.parse({
    status: 'supported',
    metric: resolvedMetricAlias,
    aggregation: promptAggregation,
    category: resolvePromptCategory(prompt),
    requestedTimeInterval: resolvePromptRequestedTimeInterval(prompt),
    activityTypeGroups: activityTypeGroups.map(activityTypeGroup => `${activityTypeGroup}`),
    activityTypes: activityTypes.map(activityType => `${activityType}`),
    dateRange: resolvePromptDateRangeIntent(prompt),
  });
}

export function resolveNormalizedInsightQueryFromIntent(
  input: AiInsightsRequest,
  promptContext: NormalizeQueryPromptContext,
  intent: ModelInsightIntent,
  dependencies: NormalizeQueryDependencies = defaultNormalizeQueryDependencies,
): NormalizeInsightQueryResult {
  const {
    prompt,
    promptCategory,
    promptDateSelection,
    promptRequestedTimeInterval,
    promptChartPreference,
  } = promptContext;
  const modelReturnedUnsupported = intent.status === 'unsupported';
  const latestEventRequested = promptImpliesLatestEventLookup(prompt);

  if (latestEventRequested) {
    const resolvedDateRangeIntent = promptDateSelection.effectiveDateRangeIntent
      ?? (modelReturnedUnsupported ? undefined : intent.dateRange);
    const activityTypes = normalizeActivityTypes(modelReturnedUnsupported ? undefined : intent.activityTypes);
    const activityTypeGroups = normalizeActivityTypeGroups(modelReturnedUnsupported ? undefined : intent.activityTypeGroups);
    if (!activityTypes || !activityTypeGroups) {
      return buildUnsupportedResult('invalid_prompt', prompt);
    }

    const promptWithoutActivityExclusions = stripPromptActivityExclusionClauses(prompt);
    const promptExcludedActivityTypeGroups = extractPromptActivityExclusionClauses(prompt)
      .flatMap((clause) => resolvePromptActivityTypeGroups(clause));
    const promptExcludedActivityTypes = extractPromptActivityExclusionClauses(prompt)
      .flatMap((clause) => {
        const clauseGroups = resolvePromptActivityTypeGroups(clause);
        return [
          ...resolvePromptActivityTypes(clause, clauseGroups),
          ...resolveKeywordActivityTypeExclusions(clause),
        ];
      });
    const excludedActivityTypeSet = new Set<ActivityTypes>([
      ...promptExcludedActivityTypes,
      ...expandActivityTypeGroups(promptExcludedActivityTypeGroups),
    ]);
    const promptActivityTypeGroups = resolvePromptActivityTypeGroups(promptWithoutActivityExclusions);
    const promptActivityTypes = resolvePromptActivityTypes(promptWithoutActivityExclusions, promptActivityTypeGroups);
    const resolvedActivityTypeGroups = activityTypeGroups.length > 0
      ? activityTypeGroups
      : promptActivityTypeGroups;
    const resolvedActivityTypes = activityTypes.length > 0
      ? activityTypes
      : promptActivityTypes;
    const filteredResolvedActivityTypes = excludeActivityTypes(
      resolvedActivityTypes,
      excludedActivityTypeSet,
    );
    const filteredResolvedActivityTypeGroups = resolvedActivityTypeGroups
      .filter(activityTypeGroup => !promptExcludedActivityTypeGroups.includes(activityTypeGroup));
    const finalActivityTypeGroups = filteredResolvedActivityTypes.length > 0 ? [] : filteredResolvedActivityTypeGroups;
    const expandedActivityTypes = finalActivityTypeGroups.length > 0
      ? excludeActivityTypes(expandActivityTypeGroups(finalActivityTypeGroups), excludedActivityTypeSet)
      : [];
    const finalActivityTypes = filteredResolvedActivityTypes.length > 0
      ? filteredResolvedActivityTypes
      : expandedActivityTypes.length > 0
        ? expandedActivityTypes
        : excludedActivityTypeSet.size > 0
          ? excludeActivityTypes(CANONICAL_ACTIVITY_TYPES, excludedActivityTypeSet)
          : [];

    const dateRange = resolveDateRange(resolvedDateRangeIntent, input.clientTimezone, dependencies.now());
    const requestedDateRanges = resolveRequestedDateRanges(
      promptDateSelection.requestedDateRangeIntents,
      input.clientTimezone,
      dependencies.now(),
    );

    return {
      status: 'ok',
      query: buildLatestEventInsightQuery({
        activityTypeGroups: finalActivityTypeGroups,
        activityTypes: finalActivityTypes,
        dateRange,
        requestedDateRanges,
        periodMode: promptDateSelection.periodMode,
        chartType: ChartTypes.LinesVertical,
      }),
    };
  }

  const promptMetricMatch = findInsightMetricAliasMatch(canonicalizeInsightPrompt(prompt));
  const baseMetric = promptMetricMatch?.metric || resolveInsightMetric(intent.metric || '');
  if (!baseMetric) {
    return buildUnsupportedResult(
      modelReturnedUnsupported
        ? (intent.unsupportedReasonCode || 'unsupported_metric')
        : 'unsupported_metric',
      prompt,
    );
  }

  const resolvedAggregation = resolvePromptAggregationForMetric(
    prompt,
    baseMetric.key,
    modelReturnedUnsupported
      ? resolvePromptAggregation(prompt)
      : intent.aggregation,
  );

  const valueType = toValueType(
    resolvedAggregation,
    baseMetric.defaultValueType,
  );
  const promptTopResultsLimit = resolvePromptTopResultsLimit(prompt);
  const metric = (promptMetricMatch
    ? resolveInsightMetric(promptMetricMatch.alias, valueType)
    : null)
    || resolveInsightMetric(intent.metric || '', valueType)
    || baseMetric;

  if (!isAggregationAllowedForMetric(metric.key, valueType)) {
    return buildUnsupportedResult('ambiguous_metric', prompt);
  }

  const resolvedDateRangeIntent = promptDateSelection.effectiveDateRangeIntent
    ?? (modelReturnedUnsupported ? undefined : intent.dateRange);
  const resultKind = promptImpliesEventLookup(prompt) ? 'event_lookup' : 'aggregate';
  const stackedDateByActivityRequested = promptImpliesDateActivityStackedColumns(prompt, {
    hasDateRangeIntent: resolvedDateRangeIntent !== undefined,
    hasRequestedTimeInterval: promptRequestedTimeInterval !== undefined,
  });
  const categoryType = resultKind === 'event_lookup'
    ? ChartDataCategoryTypes.DateType
    : stackedDateByActivityRequested
      ? ChartDataCategoryTypes.DateType
      : toCategoryType(promptCategory ?? (modelReturnedUnsupported ? undefined : intent.category));
  const activityTypes = normalizeActivityTypes(modelReturnedUnsupported ? undefined : intent.activityTypes);
  const activityTypeGroups = normalizeActivityTypeGroups(modelReturnedUnsupported ? undefined : intent.activityTypeGroups);
  if (!activityTypes || !activityTypeGroups) {
    return buildUnsupportedResult('invalid_prompt', prompt);
  }

  const promptWithoutActivityExclusions = stripPromptActivityExclusionClauses(prompt);
  const promptExcludedActivityTypeGroups = extractPromptActivityExclusionClauses(prompt)
    .flatMap((clause) => resolvePromptActivityTypeGroups(clause));
  const promptExcludedActivityTypes = extractPromptActivityExclusionClauses(prompt)
    .flatMap((clause) => {
      const clauseGroups = resolvePromptActivityTypeGroups(clause);
      return [
        ...resolvePromptActivityTypes(clause, clauseGroups),
        ...resolveKeywordActivityTypeExclusions(clause),
      ];
    });
  const excludedActivityTypeSet = new Set<ActivityTypes>([
    ...promptExcludedActivityTypes,
    ...expandActivityTypeGroups(promptExcludedActivityTypeGroups),
  ]);
  const promptActivityTypeGroups = resolvePromptActivityTypeGroups(promptWithoutActivityExclusions);
  const promptActivityTypes = resolvePromptActivityTypes(promptWithoutActivityExclusions, promptActivityTypeGroups);
  const resolvedActivityTypeGroups = activityTypeGroups.length > 0
    ? activityTypeGroups
    : promptActivityTypeGroups;
  const resolvedActivityTypes = activityTypes.length > 0
    ? activityTypes
    : promptActivityTypes;
  const filteredResolvedActivityTypes = excludeActivityTypes(
    resolvedActivityTypes,
    excludedActivityTypeSet,
  );
  const filteredResolvedActivityTypeGroups = resolvedActivityTypeGroups
    .filter(activityTypeGroup => !promptExcludedActivityTypeGroups.includes(activityTypeGroup));
  const finalActivityTypeGroups = filteredResolvedActivityTypes.length > 0 ? [] : filteredResolvedActivityTypeGroups;
  const expandedActivityTypes = finalActivityTypeGroups.length > 0
    ? excludeActivityTypes(expandActivityTypeGroups(finalActivityTypeGroups), excludedActivityTypeSet)
    : [];
  const finalActivityTypes = filteredResolvedActivityTypes.length > 0
    ? filteredResolvedActivityTypes
    : expandedActivityTypes.length > 0
      ? expandedActivityTypes
      : excludedActivityTypeSet.size > 0
        ? excludeActivityTypes(CANONICAL_ACTIVITY_TYPES, excludedActivityTypeSet)
        : [];

  const resolvedRequestedTimeInterval = promptRequestedTimeInterval
    ?? (modelReturnedUnsupported ? undefined : intent.requestedTimeInterval);
  const requestedTimeInterval = toRequestedTimeInterval(
    categoryType,
    resolvedRequestedTimeInterval,
    resolvedDateRangeIntent,
  );
  const finalRequestedTimeInterval = stackedDateByActivityRequested
    && categoryType === ChartDataCategoryTypes.DateType
    && (resolvedRequestedTimeInterval === undefined || resolvedRequestedTimeInterval === 'auto')
    ? resolveStackedDateDefaultInterval(resolvedDateRangeIntent)
    : requestedTimeInterval;
  const dateRange = resolveDateRange(resolvedDateRangeIntent, input.clientTimezone, dependencies.now());
  const requestedDateRanges = resolveRequestedDateRanges(
    promptDateSelection.requestedDateRangeIntents,
    input.clientTimezone,
    dependencies.now(),
  );

  if (resultKind === 'event_lookup') {
    return {
      status: 'ok',
      metricKey: metric.key,
      query: buildEventLookupInsightQuery({
        dataType: metric.dataType,
        valueType,
        requestedTimeInterval: finalRequestedTimeInterval,
        topResultsLimit: promptTopResultsLimit,
        activityTypeGroups: finalActivityTypeGroups,
        activityTypes: finalActivityTypes,
        dateRange,
        requestedDateRanges,
        periodMode: promptDateSelection.periodMode,
        chartType: resolveChartType(
          ChartDataCategoryTypes.DateType,
          valueType,
          stackedDateByActivityRequested,
          promptChartPreference,
        ),
      }),
    };
  }

  return {
    status: 'ok',
    metricKey: metric.key,
    query: buildAggregateInsightQuery({
      dataType: metric.dataType,
      valueType,
      topResultsLimit: (
        valueType === ChartDataValueTypes.Minimum
        || valueType === ChartDataValueTypes.Maximum
      )
        ? promptTopResultsLimit
        : undefined,
      categoryType,
      requestedTimeInterval: finalRequestedTimeInterval,
      activityTypeGroups: finalActivityTypeGroups,
      activityTypes: finalActivityTypes,
      dateRange,
      requestedDateRanges,
      periodMode: promptDateSelection.periodMode,
      chartType: resolveChartType(
        categoryType,
        valueType,
        stackedDateByActivityRequested,
        promptChartPreference,
      ),
    }),
  };
}

export async function withNormalizeQueryDependenciesForTesting<T>(
  dependencies: Partial<NormalizeQueryDependencies>,
  run: (api: NormalizeQueryApi) => Promise<T> | T,
): Promise<T> {
  return run(createNormalizeQuery(dependencies));
}

export function buildNormalizeQueryPromptContext(
  prompt: string,
  options: Partial<ResolvePromptDateSelectionOptions> = {},
): NormalizeQueryPromptContext {
  const promptAggregation = resolvePromptAggregation(prompt);
  const promptCategory = resolvePromptCategory(prompt);
  const promptDateSelection = resolvePromptDateSelection(
    prompt,
    promptCategory,
    promptAggregation,
    {
      timeZone: options.timeZone ?? 'UTC',
      now: options.now ?? new Date(),
    },
  );
  const promptRequestedTimeInterval = resolvePromptRequestedTimeInterval(prompt)
    ?? promptDateSelection.compareRequestedTimeInterval;
  const promptChartPreference = resolvePromptChartPreference(prompt);

  return {
    prompt,
    promptAggregation,
    promptCategory,
    promptDateSelection,
    promptRequestedTimeInterval,
    promptChartPreference,
  };
}

export function createNormalizeQuery(
  dependencies: Partial<NormalizeQueryDependencies> = {},
): NormalizeQueryApi {
  const resolvedDependencies: NormalizeQueryDependencies = {
    ...defaultNormalizeQueryDependencies,
    ...dependencies,
  };

  const normalizeInsightQuery = async (
    input: AiInsightsRequest,
  ): Promise<NormalizeInsightQueryResult> => {
    const prompt = `${input.prompt || ''}`.trim();
    if (!prompt) {
      return buildUnsupportedResult('invalid_prompt', prompt);
    }

    if (detectUnsupportedCapability(prompt)) {
      return buildUnsupportedResult('unsupported_capability', prompt);
    }

    const promptContext = buildNormalizeQueryPromptContext(prompt, {
      timeZone: input.clientTimezone,
      now: resolvedDependencies.now(),
    });
    const {
      promptDateSelection,
      promptRequestedTimeInterval,
    } = promptContext;
    const promptDateRangeIntent = promptDateSelection.effectiveDateRangeIntent;
    const multiMetricIntent = resolveMultiMetricIntent(prompt, promptContext);
    if (multiMetricIntent && 'status' in multiMetricIntent) {
      return multiMetricIntent;
    }

    if (multiMetricIntent) {
      const activityTypes = normalizeActivityTypes(undefined);
      const activityTypeGroups = normalizeActivityTypeGroups(undefined);
      if (!activityTypes || !activityTypeGroups) {
        return buildUnsupportedResult('invalid_prompt', prompt);
      }

      const promptWithoutActivityExclusions = stripPromptActivityExclusionClauses(prompt);
      const promptExcludedActivityTypeGroups = extractPromptActivityExclusionClauses(prompt)
        .flatMap((clause) => resolvePromptActivityTypeGroups(clause));
      const promptExcludedActivityTypes = extractPromptActivityExclusionClauses(prompt)
        .flatMap((clause) => {
          const clauseGroups = resolvePromptActivityTypeGroups(clause);
          return [
            ...resolvePromptActivityTypes(clause, clauseGroups),
            ...resolveKeywordActivityTypeExclusions(clause),
          ];
        });
      const excludedActivityTypeSet = new Set<ActivityTypes>([
        ...promptExcludedActivityTypes,
        ...expandActivityTypeGroups(promptExcludedActivityTypeGroups),
      ]);
      const promptActivityTypeGroups = resolvePromptActivityTypeGroups(promptWithoutActivityExclusions);
      const promptActivityTypes = resolvePromptActivityTypes(promptWithoutActivityExclusions, promptActivityTypeGroups);
      const resolvedActivityTypeGroups = activityTypeGroups.length > 0
        ? activityTypeGroups
        : promptActivityTypeGroups;
      const resolvedActivityTypes = activityTypes.length > 0
        ? activityTypes
        : promptActivityTypes;
      const filteredResolvedActivityTypes = excludeActivityTypes(
        resolvedActivityTypes,
        excludedActivityTypeSet,
      );
      const filteredResolvedActivityTypeGroups = resolvedActivityTypeGroups
        .filter(activityTypeGroup => !promptExcludedActivityTypeGroups.includes(activityTypeGroup));
      const finalActivityTypeGroups = filteredResolvedActivityTypes.length > 0 ? [] : filteredResolvedActivityTypeGroups;
      const expandedActivityTypes = finalActivityTypeGroups.length > 0
        ? excludeActivityTypes(expandActivityTypeGroups(finalActivityTypeGroups), excludedActivityTypeSet)
        : [];
      const finalActivityTypes = filteredResolvedActivityTypes.length > 0
        ? filteredResolvedActivityTypes
        : expandedActivityTypes.length > 0
          ? expandedActivityTypes
          : excludedActivityTypeSet.size > 0
            ? excludeActivityTypes(CANONICAL_ACTIVITY_TYPES, excludedActivityTypeSet)
            : [];

      const finalRequestedTimeInterval = multiMetricIntent.groupingMode === 'date'
        ? toRequestedTimeInterval(
          ChartDataCategoryTypes.DateType,
          promptRequestedTimeInterval,
          promptDateRangeIntent,
        )
        : undefined;
      const dateRange = resolveDateRange(promptDateRangeIntent, input.clientTimezone, resolvedDependencies.now());
      const requestedDateRanges = resolveRequestedDateRanges(
        promptDateSelection.requestedDateRangeIntents,
        input.clientTimezone,
        resolvedDependencies.now(),
      );

      return {
        status: 'ok',
        query: buildMultiMetricInsightQuery({
          groupingMode: multiMetricIntent.groupingMode,
          requestedTimeInterval: finalRequestedTimeInterval,
          activityTypeGroups: finalActivityTypeGroups,
          activityTypes: finalActivityTypes,
          dateRange,
          requestedDateRanges,
          periodMode: promptDateSelection.periodMode,
          chartType: ChartTypes.LinesVertical,
          metricSelections: multiMetricIntent.metricSelections,
        }),
      };
    }

    const intent = await resolvedDependencies.generateIntent({
      ...input,
      prompt,
    });
    return resolveNormalizedInsightQueryFromIntent(input, promptContext, intent, resolvedDependencies);
  };

  const normalizeInsightQueryFlow = async (
    input: AiInsightsRequest,
  ): Promise<NormalizeInsightQueryResult> => {
    const parsedInput = AiInsightsRequestSchema.parse(input);
    const result = await normalizeInsightQuery(parsedInput);
    if (result.status === 'ok') {
      return {
        status: 'ok',
        ...(result.metricKey ? { metricKey: result.metricKey } : {}),
        query: NormalizedInsightQuerySchema.parse(result.query),
      };
    }

    return UnsupportedNormalizeInsightQueryResultSchema.parse(result) as NormalizeInsightQueryResult;
  };

  return {
    normalizeInsightQuery,
    normalizeInsightQueryFlow,
  };
}

const normalizeQueryRuntime = createNormalizeQuery();

export async function normalizeInsightQuery(
  input: AiInsightsRequest,
): Promise<NormalizeInsightQueryResult> {
  return normalizeQueryRuntime.normalizeInsightQuery(input);
}

export async function normalizeInsightQueryFlow(
  input: AiInsightsRequest,
): Promise<NormalizeInsightQueryResult> {
  return normalizeQueryRuntime.normalizeInsightQueryFlow(input);
}
