import { z } from 'genkit';
import {
  ActivityTypes,
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
import { aiInsightsGenkit } from './genkit';
import { CANONICAL_ACTIVITY_TYPES, resolveCanonicalActivityType } from './canonical-activity-types';
import {
  buildMetricCatalogPromptText,
  getSuggestedInsightPrompts,
  isAggregationAllowedForMetric,
  resolveMetricVariantAlias,
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

type DateRangeIntent =
  | RelativeDateRangeIntent
  | CurrentPeriodDateRangeIntent
  | AbsoluteDateRangeIntent;

interface ModelInsightIntent {
  status: 'supported' | 'unsupported';
  metric?: string;
  aggregation?: ModelAggregationCode;
  category?: ModelCategoryCode;
  requestedTimeInterval?: ModelTimeIntervalCode;
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
const SUPPORTED_ACTIVITY_TYPES = [...CANONICAL_ACTIVITY_TYPES];

const UNSUPPORTED_PROMPT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsplits?\b/i,
  /\blaps?\b/i,
  /\bstreams?\b/i,
  /\broute\b/i,
  /\bgeometry\b/i,
  /\boriginal files?\b/i,
  /\breparse\b/i,
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
  generateIntent: async (input) => {
    const today = formatZonedDateParts(getZonedDateParts(new Date(), input.clientTimezone));
    const { output } = await aiInsightsGenkit.generate({
      system: [
        'You normalize fitness insight prompts into a strict JSON query schema.',
        'Supported capabilities are persisted event-level stats only.',
        'Unsupported capabilities include streams, laps, splits, route geometry, original file reparse, and multi-turn chat.',
        'Never invent metrics, activity types, Firestore fields, or query operators.',
        'If the prompt is unsupported or ambiguous, set status to "unsupported" and provide the most specific unsupportedReasonCode.',
        'If the user does not explicitly ask for a grouping by activity type or sport, default category to "date".',
        'If the user does not explicitly ask for a time interval granularity, use requestedTimeInterval "auto".',
        'If the user omits a date range, omit dateRange. The application will apply a last-90-days default.',
        'For relative date ranges, use dateRange.kind "last_n" rather than "last".',
        'For current periods like this week, this month, or this year, use dateRange.kind "current_period" rather than "this".',
        'Use canonical activity labels when possible.',
      ].join(' '),
      prompt: [
        `User prompt: ${input.prompt}`,
        `Client timezone: ${input.clientTimezone}`,
        `Current local date in the client timezone: ${today}`,
        `Supported canonical activity types: ${SUPPORTED_ACTIVITY_TYPES.join(', ')}`,
        'Supported metrics:',
        buildMetricCatalogPromptText(),
      ].join('\n'),
      output: { schema: ModelInsightIntentSchema },
    });

    if (!output) {
      throw new Error('The model did not return a normalized query intent.');
    }

    return output;
  },
};

let normalizeQueryDependencies: NormalizeQueryDependencies = defaultNormalizeQueryDependencies;

function buildUnsupportedResult(
  reasonCode: AiInsightsUnsupportedReasonCode,
): NormalizeInsightQueryUnsupportedResult {
  return {
    status: 'unsupported',
    reasonCode,
    suggestedPrompts: getSuggestedInsightPrompts(),
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

function formatZonedDateParts(parts: ZonedDateParts): string {
  const month = `${parts.month}`.padStart(2, '0');
  const day = `${parts.day}`.padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
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
  let start = addDays(today, -89);
  const end = today;

  if (dateRangeIntent?.kind === 'last_n' || dateRangeIntent?.kind === 'last') {
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
  } else if (dateRangeIntent?.kind === 'absolute') {
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
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      timezone: timeZone,
    };
  }

  return {
    startDate: zonedDateTimeToUtcDate(start, timeZone, 0, 0, 0, 0).toISOString(),
    endDate: zonedDateTimeToUtcDate(end, timeZone, 23, 59, 59, 999).toISOString(),
    timezone: timeZone,
  };
}

function resolveChartType(
  categoryType: ChartDataCategoryTypes,
  valueType: ChartDataValueTypes,
): ChartTypes {
  if (categoryType === ChartDataCategoryTypes.ActivityType) {
    return ChartTypes.ColumnsHorizontal;
  }

  if (valueType === ChartDataValueTypes.Total) {
    return ChartTypes.ColumnsVertical;
  }

  return ChartTypes.LinesVertical;
}

function normalizeActivityTypes(activityTypes: string[] | undefined): ActivityTypes[] | null {
  if (!activityTypes?.length) {
    return [...SUPPORTED_ACTIVITY_TYPES];
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

  return resolved.length > 0 ? resolved : [...SUPPORTED_ACTIVITY_TYPES];
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

function detectUnsupportedCapability(prompt: string): boolean {
  return UNSUPPORTED_PROMPT_PATTERNS.some(pattern => pattern.test(prompt));
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
    return buildUnsupportedResult('invalid_prompt');
  }

  if (detectUnsupportedCapability(prompt)) {
    return buildUnsupportedResult('unsupported_capability');
  }

  const dependencies = normalizeQueryDependencies;
  const intent = await dependencies.generateIntent({
    ...input,
    prompt,
  });

  if (intent.status === 'unsupported') {
    return buildUnsupportedResult(intent.unsupportedReasonCode || 'unsupported_metric');
  }

  const baseMetric = resolveInsightMetric(intent.metric || '');
  if (!baseMetric) {
    return buildUnsupportedResult('unsupported_metric');
  }

  const valueType = toValueType(intent.aggregation, baseMetric.defaultValueType);
  const promptMetricAlias = resolveMetricVariantAlias(baseMetric, prompt);
  const metric = resolveInsightMetric(promptMetricAlias || intent.metric || '', valueType)
    || resolveInsightMetric(intent.metric || '', valueType)
    || baseMetric;

  if (!isAggregationAllowedForMetric(metric.key, valueType)) {
    return buildUnsupportedResult('ambiguous_metric');
  }

  const categoryType = toCategoryType(intent.category);
  const activityTypes = normalizeActivityTypes(intent.activityTypes);
  if (!activityTypes) {
    return buildUnsupportedResult('invalid_prompt');
  }

  const requestedTimeInterval = toRequestedTimeInterval(categoryType, intent.requestedTimeInterval, intent.dateRange);
  const dateRange = resolveDateRange(intent.dateRange, input.clientTimezone, dependencies.now());

  return {
    status: 'ok',
    metricKey: metric.key,
    query: {
      dataType: metric.dataType,
      valueType,
      categoryType,
      requestedTimeInterval,
      activityTypes,
      dateRange,
      chartType: resolveChartType(categoryType, valueType),
    },
  };
}

export const normalizeInsightQueryFlow = aiInsightsGenkit.defineFlow({
  name: 'aiInsightsNormalizeQuery',
  inputSchema: AiInsightsRequestSchema,
  outputSchema: NormalizeInsightQueryResultSchema,
}, async (input) => normalizeInsightQuery(input));
