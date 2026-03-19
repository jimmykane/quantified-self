import type { EventInterface } from '@sports-alliance/sports-lib';
import {
  ActivityTypes,
  ActivityTypesHelper,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataActivityTypes,
  DataAscent,
  DataDescent,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type {
  EventStatAggregationBucket,
  EventStatAggregationEventInput,
  EventStatAggregationLogger,
  EventStatAggregationPreferences,
  EventStatAggregationRequest,
  EventStatAggregationResult,
} from './event-stat-aggregation.types';

const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
const UNKNOWN_ACTIVITY_KEY = '??';

type ActivityTypeStatLike = {
  getValue?: () => unknown;
  getDisplayValue?: () => unknown;
};

interface EventStatAggregationAccumulator {
  bucketKey: string | number;
  time?: number;
  totalCount: number;
  sum: number;
  min: number | null;
  max: number | null;
  seriesAccumulators: Map<string, {
    sum: number;
    count: number;
    min: number | null;
    max: number | null;
  }>;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function resolveEventStatNumber(event: EventInterface, dataType: string): number | null {
  const stat = event?.getStat?.(dataType) as { getValue?: () => unknown } | null | undefined;
  return toFiniteNumber(stat?.getValue?.());
}

function sortEventsChronologically(events: EventStatAggregationEventInput): EventInterface[] {
  return [...(events || [])].sort((left, right) => {
    const leftTime = left?.startDate instanceof Date ? left.startDate.getTime() : Number.NEGATIVE_INFINITY;
    const rightTime = right?.startDate instanceof Date ? right.startDate.getTime() : Number.NEGATIVE_INFINITY;
    return leftTime - rightTime;
  });
}

function resolveEventActivityTypes(event: EventInterface): ActivityTypes[] {
  return Array.isArray(event?.getActivityTypesAsArray?.())
    ? (event.getActivityTypesAsArray() as ActivityTypes[])
    : [];
}

function shouldExcludeAscent(activityTypes: ActivityTypes[]): boolean {
  return activityTypes.every(type => ActivityTypesHelper.shouldExcludeAscent(type));
}

function shouldExcludeDescent(activityTypes: ActivityTypes[]): boolean {
  return activityTypes.every(type => ActivityTypesHelper.shouldExcludeDescent(type));
}

function shouldExcludeEventForMetric(
  event: EventInterface,
  dataType: string,
  preferences?: EventStatAggregationPreferences,
): boolean {
  const activityTypes = resolveEventActivityTypes(event);

  if (dataType === DataAscent.type) {
    const isAutoExcluded = shouldExcludeAscent(activityTypes);
    const isManuallyExcluded = preferences?.removeAscentForEventTypes?.some(type => activityTypes.includes(type)) === true;
    return isAutoExcluded || isManuallyExcluded;
  }

  if (dataType === DataDescent.type) {
    const isAutoExcluded = shouldExcludeDescent(activityTypes);
    const isManuallyExcluded = preferences?.removeDescentForEventTypes?.some(type => activityTypes.includes(type)) === true;
    return isAutoExcluded || isManuallyExcluded;
  }

  return false;
}

function resolveActivityTypeStat(event: EventInterface): ActivityTypeStatLike | null {
  const stat = event?.getStat?.(DataActivityTypes.type) as ActivityTypeStatLike | null | undefined;
  return stat || null;
}

function resolveActivityKey(event: EventInterface, logger?: EventStatAggregationLogger): string {
  const activityTypeStat = resolveActivityTypeStat(event);
  const activityTypes = resolveEventActivityTypes(event);
  const rawValue = activityTypeStat?.getValue?.();
  const statLength = Array.isArray(rawValue) ? rawValue.length : activityTypes.length;

  if (statLength > 1 || activityTypes.length > 1) {
    return ActivityTypes.Multisport;
  }

  const displayValueRaw = activityTypeStat?.getDisplayValue?.();
  const displayValue = typeof displayValueRaw === 'string'
    ? displayValueRaw.trim()
    : `${displayValueRaw ?? activityTypes[0] ?? ''}`.trim();

  if (!displayValue) {
    logger?.error?.('[event-stat-aggregation] Missing activity type display value', {
      eventID: event?.getID?.() || null,
    });
    return UNKNOWN_ACTIVITY_KEY;
  }

  const resolvedByAlias = ActivityTypesHelper.resolveActivityType(displayValue);
  if (resolvedByAlias) {
    return resolvedByAlias;
  }

  if (Object.values(ActivityTypes).includes(displayValue as ActivityTypes)) {
    return displayValue;
  }

  logger?.error?.('[event-stat-aggregation] Unknown activity type display value', {
    eventID: event?.getID?.() || null,
    displayValue,
  });
  return UNKNOWN_ACTIVITY_KEY;
}

function resolveWeeklyBucketStart(date: Date): number {
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  weekStart.setHours(0, 0, 0, 0);
  const day = weekStart.getDay() || 7;
  weekStart.setDate(weekStart.getDate() - day + 1);
  return weekStart.getTime();
}

function resolveDateBucketKey(date: Date, timeInterval: TimeIntervals): number {
  switch (timeInterval) {
    case TimeIntervals.Yearly:
      return new Date(date.getFullYear(), 0).getTime();
    case TimeIntervals.Monthly:
      return new Date(date.getFullYear(), date.getMonth()).getTime();
    case TimeIntervals.Weekly:
      return resolveWeeklyBucketStart(date);
    case TimeIntervals.Daily:
      return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    case TimeIntervals.Hourly:
      return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
      ).getTime();
    default:
      return date.getTime();
  }
}

function resolveAggregateValue(
  accumulator: EventStatAggregationAccumulator,
  valueType: ChartDataValueTypes,
): number | null {
  switch (valueType) {
    case ChartDataValueTypes.Total:
      return accumulator.sum;
    case ChartDataValueTypes.Average:
      if (accumulator.totalCount <= 0) {
        return null;
      }
      return accumulator.sum / accumulator.totalCount;
    case ChartDataValueTypes.Minimum:
      return accumulator.min;
    case ChartDataValueTypes.Maximum:
      return accumulator.max;
    default:
      return null;
  }
}

function resolveSeriesAggregateValue(
  accumulator: {
    sum: number;
    count: number;
    min: number | null;
    max: number | null;
  },
  valueType: ChartDataValueTypes,
): number | null {
  switch (valueType) {
    case ChartDataValueTypes.Total:
      return accumulator.sum;
    case ChartDataValueTypes.Average:
      if (accumulator.count <= 0) {
        return null;
      }
      return accumulator.sum / accumulator.count;
    case ChartDataValueTypes.Minimum:
      return accumulator.min;
    case ChartDataValueTypes.Maximum:
      return accumulator.max;
    default:
      return null;
  }
}

function normalizeAccumulatorMaps(
  accumulator: EventStatAggregationAccumulator,
  valueType: ChartDataValueTypes,
): Pick<EventStatAggregationBucket, 'seriesValues' | 'seriesCounts'> {
  const seriesValues = new Map<string, number>();
  const seriesCounts = new Map<string, number>();
  accumulator.seriesAccumulators.forEach((seriesAccumulator, seriesKey) => {
    const aggregatedValue = resolveSeriesAggregateValue(seriesAccumulator, valueType);
    if (aggregatedValue !== null && Number.isFinite(aggregatedValue)) {
      seriesValues.set(seriesKey, aggregatedValue);
    }
    seriesCounts.set(seriesKey, seriesAccumulator.count);
  });

  return {
    seriesValues: Object.fromEntries(seriesValues.entries()),
    seriesCounts: Object.fromEntries(seriesCounts.entries()),
  };
}

export function filterEventStatsForAggregation(
  events: EventStatAggregationEventInput,
  dataType: string,
  preferences?: EventStatAggregationPreferences,
): EventInterface[] {
  return sortEventsChronologically(events).filter(event => !shouldExcludeEventForMetric(event, dataType, preferences));
}

export function resolveAutoAggregationTimeInterval(events: EventStatAggregationEventInput): TimeIntervals {
  const normalizedEvents = sortEventsChronologically(events);
  if (!normalizedEvents.length) {
    return TimeIntervals.Daily;
  }

  const startDate = normalizedEvents[0]?.startDate;
  const endDate = normalizedEvents[normalizedEvents.length - 1]?.startDate;
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
    return TimeIntervals.Daily;
  }

  if (endDate.getFullYear() !== startDate.getFullYear()) {
    return TimeIntervals.Yearly;
  }

  if (endDate.getMonth() !== startDate.getMonth()) {
    if (endDate.getTime() <= startDate.getTime() + THIRTY_ONE_DAYS_MS) {
      return TimeIntervals.Daily;
    }
    return TimeIntervals.Monthly;
  }

  if (endDate.getDate() !== startDate.getDate()) {
    return TimeIntervals.Daily;
  }

  return TimeIntervals.Hourly;
}

export function resolveAggregationCategoryKey(
  event: EventInterface,
  categoryType: ChartDataCategoryTypes,
  resolvedTimeInterval: TimeIntervals,
  logger?: EventStatAggregationLogger,
): string | number {
  if (categoryType === ChartDataCategoryTypes.ActivityType) {
    return resolveActivityKey(event, logger);
  }

  if (!(event?.startDate instanceof Date)) {
    logger?.warn?.('[event-stat-aggregation] Event is missing a valid startDate', {
      eventID: event?.getID?.() || null,
    });
    return NaN;
  }

  return resolveDateBucketKey(event.startDate, resolvedTimeInterval);
}

export function buildEventStatAggregation(
  events: EventStatAggregationEventInput,
  request: EventStatAggregationRequest,
  logger?: EventStatAggregationLogger,
): EventStatAggregationResult {
  const filteredEvents = filterEventStatsForAggregation(events, request.dataType, request.preferences);
  const resolvedTimeInterval = request.requestedTimeInterval === undefined || request.requestedTimeInterval === TimeIntervals.Auto
    ? resolveAutoAggregationTimeInterval(filteredEvents)
    : request.requestedTimeInterval;

  const accumulators = filteredEvents.reduce((bucketMap, event) => {
    const statValue = resolveEventStatNumber(event, request.dataType);
    if (statValue === null) {
      return bucketMap;
    }

    const bucketKey = resolveAggregationCategoryKey(event, request.categoryType, resolvedTimeInterval, logger);
    if (typeof bucketKey === 'number' && !Number.isFinite(bucketKey)) {
      return bucketMap;
    }

    const seriesKey = resolveActivityKey(event, logger);
    const existing = bucketMap.get(bucketKey) || {
      bucketKey,
      time: request.categoryType === ChartDataCategoryTypes.DateType && typeof bucketKey === 'number' ? bucketKey : undefined,
      totalCount: 0,
      sum: 0,
      min: null,
      max: null,
      seriesAccumulators: new Map<string, {
        sum: number;
        count: number;
        min: number | null;
        max: number | null;
      }>(),
    };

    existing.totalCount += 1;
    existing.sum += statValue;
    existing.min = existing.min === null ? statValue : Math.min(existing.min, statValue);
    existing.max = existing.max === null ? statValue : Math.max(existing.max, statValue);
    const seriesAccumulator = existing.seriesAccumulators.get(seriesKey) || {
      sum: 0,
      count: 0,
      min: null,
      max: null,
    };
    seriesAccumulator.sum += statValue;
    seriesAccumulator.count += 1;
    seriesAccumulator.min = seriesAccumulator.min === null ? statValue : Math.min(seriesAccumulator.min, statValue);
    seriesAccumulator.max = seriesAccumulator.max === null ? statValue : Math.max(seriesAccumulator.max, statValue);
    existing.seriesAccumulators.set(seriesKey, seriesAccumulator);
    bucketMap.set(bucketKey, existing);
    return bucketMap;
  }, new Map<string | number, EventStatAggregationAccumulator>());

  const buckets = Array.from(accumulators.values())
    .map((accumulator) => {
      const aggregateValue = resolveAggregateValue(accumulator, request.valueType);
      if (aggregateValue === null || !Number.isFinite(aggregateValue)) {
        return null;
      }

      if (request.valueType === ChartDataValueTypes.Total && aggregateValue === 0) {
        return null;
      }

      return {
        bucketKey: accumulator.bucketKey,
        ...(accumulator.time !== undefined ? { time: accumulator.time } : {}),
        totalCount: accumulator.totalCount,
        aggregateValue,
        ...normalizeAccumulatorMaps(accumulator, request.valueType),
      } satisfies EventStatAggregationBucket;
    })
    .filter((bucket): bucket is EventStatAggregationBucket => bucket !== null)
    .sort((left, right) => {
      if (request.categoryType === ChartDataCategoryTypes.DateType) {
        return Number(left.time ?? 0) - Number(right.time ?? 0);
      }

      return `${left.bucketKey}`.localeCompare(`${right.bucketKey}`);
    });

  return {
    dataType: request.dataType,
    valueType: request.valueType,
    categoryType: request.categoryType,
    resolvedTimeInterval,
    buckets,
  };
}
