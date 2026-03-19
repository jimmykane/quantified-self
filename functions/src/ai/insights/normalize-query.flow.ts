import { z } from 'genkit';
import {
  type ActivityTypeGroup,
  ActivityTypes,
  ActivityTypesHelper,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

import type {
  AiInsightsRequest,
  AiInsightsUnsupportedReasonCode,
  NormalizedInsightDateRange,
  NormalizedInsightQuery,
} from '../../../../shared/ai-insights.types';
import {
  getActivityTypeGroupMetadata,
  isAmbiguousActivityTypeGroup,
} from '../../../../shared/activity-type-group.metadata';
import { CANONICAL_ACTIVITY_TYPES, resolveCanonicalActivityType } from './canonical-activity-types';
import {
  CANONICAL_ACTIVITY_TYPE_GROUPS,
  resolveCanonicalActivityTypeGroup,
} from './canonical-activity-type-groups';
import {
  findInsightMetricAliasMatch,
  getSuggestedInsightPrompts,
  isAggregationAllowedForMetric,
  resolveInsightMetric,
  type InsightMetricKey,
} from './metric-catalog';
import { AiInsightsRequestSchema, AiInsightsUnsupportedReasonCodeSchema, NormalizedInsightQuerySchema } from './schemas';

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
  metricKey: InsightMetricKey;
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

interface ModelInsightIntent {
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

interface NormalizeQueryDependencies {
  now: () => Date;
  generateIntent: (input: AiInsightsRequest) => Promise<ModelInsightIntent>;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
}

const ABSOLUTE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORTED_ACTIVITY_TYPE_GROUPS = [...CANONICAL_ACTIVITY_TYPE_GROUPS];

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
  /\bi want to know when i had\b/i,
];
const EVENT_LOOKUP_RANKING_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(longest|shortest|highest|lowest|fastest|slowest)\b/i,
  /\b(max|maximum|min|minimum)\b/i,
];
const AGGREGATE_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(over time|by month|by week|by day|by year|timeline|trend|chart)\b/i,
  /\b(by activity types?|activity type comparison|by sports?|by sport)\b/i,
  /\bstack(?:ed|ing)?\b/i,
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
  unsupportedReasonCode: AiInsightsUnsupportedReasonCodeSchema.optional(),
});

const NormalizeInsightQueryResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    metricKey: z.string(),
    query: NormalizedInsightQuerySchema,
  }),
  z.object({
    status: z.literal('unsupported'),
    reasonCode: AiInsightsUnsupportedReasonCodeSchema,
    suggestedPrompts: z.array(z.string()),
  }),
]);

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

const defaultNormalizeQueryDependencies: NormalizeQueryDependencies = {
  now: () => new Date(),
  generateIntent: async (input) => buildDeterministicIntent(input.prompt),
};

let normalizeQueryDependencies: NormalizeQueryDependencies = defaultNormalizeQueryDependencies;

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

function resolveChartType(
  categoryType: ChartDataCategoryTypes,
  valueType: ChartDataValueTypes,
  forceDateColumns: boolean,
): ChartTypes {
  if (categoryType === ChartDataCategoryTypes.ActivityType) {
    return ChartTypes.ColumnsHorizontal;
  }

  if (forceDateColumns || valueType === ChartDataValueTypes.Total) {
    return ChartTypes.ColumnsVertical;
  }

  return ChartTypes.LinesVertical;
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

function normalizePromptSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s]+/g, ' ')
    .replace(/\s+/g, ' ');
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
      const overlapsExisting = occupiedRanges.some(range => !(end <= range.start || start >= range.end));
      if (overlapsExisting || explicitGroupTerms.has(normalizedLabel)) {
        continue;
      }

      occupiedRanges.push({ start, end });
      resolved.push(activityType);
      break;
    }
  }

  return resolved;
}

function expandActivityTypeGroups(activityTypeGroups: ActivityTypeGroup[]): ActivityTypes[] {
  const expanded: ActivityTypes[] = [];
  for (const activityTypeGroup of activityTypeGroups) {
    for (const activityType of ActivityTypesHelper.getActivityTypesForActivityGroup(activityTypeGroup)) {
      if (!expanded.includes(activityType)) {
        expanded.push(activityType);
      }
    }
  }

  return expanded;
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
        return TimeIntervals.Daily;
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

  const hasRankingIntent = EVENT_LOOKUP_RANKING_PROMPT_PATTERNS.some(pattern => pattern.test(normalizedPrompt));
  if (!hasRankingIntent) {
    return false;
  }

  if (EVENT_LOOKUP_SUBJECT_PROMPT_PATTERNS.some(pattern => pattern.test(normalizedPrompt))) {
    return true;
  }

  return /\bwhen\b/.test(normalizedPrompt);
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
  if (/\b(min|minimum|lowest|fastest|shortest)\b/.test(normalizedPrompt)) {
    return 'minimum';
  }
  if (/\b(max|maximum|highest|peak|slowest|longest|furthest)\b/.test(normalizedPrompt)) {
    return 'maximum';
  }

  return undefined;
}

function resolvePromptCategory(prompt: string): ModelCategoryCode | undefined {
  const normalizedPrompt = normalizePromptSearchText(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  if (/\b(by activity types?|activity type comparison|by sports?|by sport)\b/.test(normalizedPrompt)) {
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
  const metricMatch = findInsightMetricAliasMatch(prompt);
  if (!metricMatch) {
    return {
      status: 'unsupported',
      unsupportedReasonCode: 'unsupported_metric',
    };
  }

  const activityTypeGroups = resolvePromptActivityTypeGroups(prompt);
  const activityTypes = resolvePromptActivityTypes(prompt, activityTypeGroups);

  return ModelInsightIntentSchema.parse({
    status: 'supported',
    metric: metricMatch.alias,
    aggregation: resolvePromptAggregation(prompt),
    category: resolvePromptCategory(prompt),
    requestedTimeInterval: resolvePromptRequestedTimeInterval(prompt),
    activityTypeGroups: activityTypeGroups.map(activityTypeGroup => `${activityTypeGroup}`),
    activityTypes: activityTypes.map(activityType => `${activityType}`),
    dateRange: resolvePromptDateRangeIntent(prompt),
  });
}

export function setNormalizeQueryDependenciesForTesting(
  dependencies?: Partial<NormalizeQueryDependencies>,
): void {
  normalizeQueryDependencies = dependencies
    ? { ...defaultNormalizeQueryDependencies, ...dependencies }
    : defaultNormalizeQueryDependencies;
}

export async function normalizeInsightQuery(
  input: AiInsightsRequest,
): Promise<NormalizeInsightQueryResult> {
  const prompt = `${input.prompt || ''}`.trim();
  if (!prompt) {
    return buildUnsupportedResult('invalid_prompt', prompt);
  }

  if (detectUnsupportedCapability(prompt)) {
    return buildUnsupportedResult('unsupported_capability', prompt);
  }

  const dependencies = normalizeQueryDependencies;
  const intent = await dependencies.generateIntent({
    ...input,
    prompt,
  });
  const modelReturnedUnsupported = intent.status === 'unsupported';

  const promptMetricMatch = findInsightMetricAliasMatch(prompt);
  const baseMetric = promptMetricMatch?.metric || resolveInsightMetric(intent.metric || '');
  if (!baseMetric) {
    return buildUnsupportedResult(
      modelReturnedUnsupported
        ? (intent.unsupportedReasonCode || 'unsupported_metric')
        : 'unsupported_metric',
      prompt,
    );
  }

  const valueType = toValueType(
    modelReturnedUnsupported
      ? resolvePromptAggregation(prompt)
      : intent.aggregation,
    baseMetric.defaultValueType,
  );
  const metric = (promptMetricMatch
    ? resolveInsightMetric(promptMetricMatch.alias, valueType)
    : null)
    || resolveInsightMetric(intent.metric || '', valueType)
    || baseMetric;

  if (!isAggregationAllowedForMetric(metric.key, valueType)) {
    return buildUnsupportedResult('ambiguous_metric', prompt);
  }

  const resolvedDateRangeIntent = (
    (modelReturnedUnsupported ? undefined : intent.dateRange)
    ?? resolvePromptDateRangeIntent(prompt)
  );
  const promptRequestedTimeInterval = resolvePromptRequestedTimeInterval(prompt);
  const resultKind = promptImpliesEventLookup(prompt) ? 'event_lookup' : 'aggregate';
  const stackedDateByActivityRequested = promptImpliesDateActivityStackedColumns(prompt, {
    hasDateRangeIntent: resolvedDateRangeIntent !== undefined,
    hasRequestedTimeInterval: promptRequestedTimeInterval !== undefined,
  });
  const categoryType = resultKind === 'event_lookup'
    ? ChartDataCategoryTypes.DateType
    : stackedDateByActivityRequested
    ? ChartDataCategoryTypes.DateType
    : toCategoryType(modelReturnedUnsupported ? undefined : intent.category);
  const activityTypes = normalizeActivityTypes(modelReturnedUnsupported ? undefined : intent.activityTypes);
  const activityTypeGroups = normalizeActivityTypeGroups(modelReturnedUnsupported ? undefined : intent.activityTypeGroups);
  if (!activityTypes || !activityTypeGroups) {
    return buildUnsupportedResult('invalid_prompt', prompt);
  }

  const promptActivityTypeGroups = resolvePromptActivityTypeGroups(prompt);
  const promptActivityTypes = resolvePromptActivityTypes(prompt, promptActivityTypeGroups);
  const resolvedActivityTypeGroups = activityTypeGroups.length > 0
    ? activityTypeGroups
    : promptActivityTypeGroups;
  const resolvedActivityTypes = activityTypes.length > 0
    ? activityTypes
    : promptActivityTypes;
  const finalActivityTypeGroups = resolvedActivityTypes.length > 0 ? [] : resolvedActivityTypeGroups;
  const expandedActivityTypes = finalActivityTypeGroups.length > 0
    ? expandActivityTypeGroups(finalActivityTypeGroups)
    : [];
  const finalActivityTypes = resolvedActivityTypes.length > 0
    ? resolvedActivityTypes
    : expandedActivityTypes.length > 0
      ? expandedActivityTypes
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

  return {
    status: 'ok',
    metricKey: metric.key,
    query: {
      resultKind,
      dataType: metric.dataType,
      valueType,
      categoryType,
      requestedTimeInterval: finalRequestedTimeInterval,
      activityTypeGroups: finalActivityTypeGroups,
      activityTypes: finalActivityTypes,
      dateRange,
      chartType: resolveChartType(categoryType, valueType, stackedDateByActivityRequested),
    },
  };
}

export async function normalizeInsightQueryFlow(
  input: AiInsightsRequest,
): Promise<NormalizeInsightQueryResult> {
  const parsedInput = AiInsightsRequestSchema.parse(input);
  const result = await normalizeInsightQuery(parsedInput);
  return NormalizeInsightQueryResultSchema.parse(result) as NormalizeInsightQueryResult;
}
