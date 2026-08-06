import {
  ActivityTypesHelper,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { resolveDateAggregationBucketStart } from '../../../shared/event-stat-aggregation';
import { resolveMcpMeasurementDefinition } from '../mcp/measurement-catalog';
import {
  getSportsLibNumericMetricCatalog,
  resolveSportsLibNumericMetric,
} from '../mcp/metric-catalog';
import type { AssistantMcpToolName } from './mcp-session';

const ASSISTANT_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ASSISTANT_DAY_MS = 24 * 60 * 60 * 1_000;
const ASSISTANT_TIME_ZONE_DEFAULT_TOOL_NAMES = new Set<AssistantMcpToolName>([
  'query_measurements',
  'query_metric',
  'query_metrics',
  'get_sleep_trend',
  'get_today_readiness',
  'get_daily_report',
]);

export function assistantToolUsesDefaultTimeZone(
  toolName: AssistantMcpToolName,
): boolean {
  return ASSISTANT_TIME_ZONE_DEFAULT_TOOL_NAMES.has(toolName);
}

function normalizeAssistantCatalogTerm(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function resolveAssistantMetricType(value: string): string | null {
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

function resolveAssistantActivityGroup(value: string): string | null {
  const normalized = normalizeAssistantCatalogTerm(value)
    .replace(/ group$/u, '');
  return ActivityTypesHelper.getActivityTypeGroupsAsUniqueArray().find(group => (
    normalizeAssistantCatalogTerm(String(group)).replace(/ group$/u, '') === normalized
  )) || null;
}

function formatAssistantLocalDate(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resolveAssistantLocalDateStart(
  localDate: string,
  timeZone: string,
): number | null {
  const match = ASSISTANT_DATE_ONLY_PATTERN.exec(localDate);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day, 12));
  if (calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day) {
    return null;
  }
  try {
    for (const probeOffsetMs of [-ASSISTANT_DAY_MS, 0, ASSISTANT_DAY_MS]) {
      const startTimeMs = resolveDateAggregationBucketStart(
        new Date(calendarDate.getTime() + probeOffsetMs),
        TimeIntervals.Daily,
        timeZone,
      );
      if (formatAssistantLocalDate(new Date(startTimeMs), timeZone) === localDate) {
        return startTimeMs;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeAssistantDateBoundary(
  value: unknown,
  timeZone: string,
  boundary: 'start' | 'end',
): unknown {
  if (typeof value !== 'string' || !ASSISTANT_DATE_ONLY_PATTERN.test(value)) {
    return value;
  }
  const startTimeMs = resolveAssistantLocalDateStart(value, timeZone);
  if (startTimeMs === null) {
    return value;
  }
  if (boundary === 'start') {
    return new Date(startTimeMs).toISOString();
  }
  const match = ASSISTANT_DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    return value;
  }
  const nextCalendarDate = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + 1,
    12,
  ));
  const nextLocalDate = [
    nextCalendarDate.getUTCFullYear(),
    `${nextCalendarDate.getUTCMonth() + 1}`.padStart(2, '0'),
    `${nextCalendarDate.getUTCDate()}`.padStart(2, '0'),
  ].join('-');
  const nextStartTimeMs = resolveAssistantLocalDateStart(nextLocalDate, timeZone);
  return nextStartTimeMs === null
    ? value
    : new Date(nextStartTimeMs - 1).toISOString();
}

export function applyAssistantToolDefaults(
  toolName: AssistantMcpToolName,
  toolInput: Record<string, unknown>,
  timeZone: string,
): Record<string, unknown> {
  const defaultedInput = assistantToolUsesDefaultTimeZone(toolName)
    && toolInput.timeZone === undefined
    ? { ...toolInput, timeZone }
    : toolInput;
  if (toolName === 'rank_activities_by_metric') {
    const metric = typeof defaultedInput.metric === 'string'
      ? resolveAssistantMetricType(defaultedInput.metric)
      : null;
    const activityGroup = typeof defaultedInput.activityGroup === 'string'
      ? resolveAssistantActivityGroup(defaultedInput.activityGroup)
      : null;
    return {
      ...defaultedInput,
      ...(metric ? { metric } : {}),
      ...(activityGroup ? { activityGroup } : {}),
    };
  }
  if (toolName !== 'query_measurements') {
    return defaultedInput;
  }
  const measurementDefinition = typeof defaultedInput.measurementType === 'string'
    ? resolveMcpMeasurementDefinition(defaultedInput.measurementType)
    : null;
  const resolvedTimeZone = typeof defaultedInput.timeZone === 'string'
    ? defaultedInput.timeZone
    : timeZone;
  return {
    ...defaultedInput,
    ...(measurementDefinition
      ? { measurementType: measurementDefinition.id }
      : {}),
    start: normalizeAssistantDateBoundary(
      defaultedInput.start,
      resolvedTimeZone,
      'start',
    ),
    end: normalizeAssistantDateBoundary(
      defaultedInput.end,
      resolvedTimeZone,
      'end',
    ),
  };
}
