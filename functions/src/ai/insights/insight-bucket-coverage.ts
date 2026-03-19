import { ChartDataCategoryTypes, TimeIntervals } from '@sports-alliance/sports-lib';
import type { AiInsightSummary, NormalizedInsightQuery } from '../../../../shared/ai-insights.types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfWeek(date: Date): Date {
  const weekStart = startOfDay(date);
  const day = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - day + 1);
  return weekStart;
}

function startOfIsoWeekOne(year: number): Date {
  return startOfWeek(new Date(Date.UTC(year, 0, 4)));
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfQuarter(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
}

function startOfSemester(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() < 6 ? 0 : 6, 1));
}

function startOfYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function utcCalendarTime(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfBiWeek(date: Date): Date {
  const weekStart = startOfWeek(date);
  const weekReference = new Date(weekStart.getTime());
  weekReference.setUTCDate(weekReference.getUTCDate() + 3);
  const isoWeekYear = weekReference.getUTCFullYear();
  const isoWeekOneStart = startOfIsoWeekOne(isoWeekYear);
  const weeksFromIsoWeekOne = Math.floor(
    (utcCalendarTime(weekStart) - utcCalendarTime(isoWeekOneStart)) / WEEK_MS,
  );

  if (weeksFromIsoWeekOne % 2 === 0) {
    return weekStart;
  }

  return new Date(Date.UTC(
    weekStart.getUTCFullYear(),
    weekStart.getUTCMonth(),
    weekStart.getUTCDate() - 7,
  ));
}

function alignDateToBucketStart(date: Date, timeInterval: TimeIntervals): Date {
  switch (timeInterval) {
    case TimeIntervals.Hourly:
      return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        0,
        0,
        0,
      ));
    case TimeIntervals.Daily:
      return startOfDay(date);
    case TimeIntervals.Weekly:
      return startOfWeek(date);
    case TimeIntervals.BiWeekly:
      return startOfBiWeek(date);
    case TimeIntervals.Monthly:
      return startOfMonth(date);
    case TimeIntervals.Quarterly:
      return startOfQuarter(date);
    case TimeIntervals.Semesterly:
      return startOfSemester(date);
    case TimeIntervals.Yearly:
      return startOfYear(date);
    default:
      return new Date(date.getTime());
  }
}

function addBucketInterval(date: Date, timeInterval: TimeIntervals): Date {
  switch (timeInterval) {
    case TimeIntervals.Hourly:
      return new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours() + 1,
        0,
        0,
        0,
      ));
    case TimeIntervals.Daily:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
    case TimeIntervals.Weekly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 7));
    case TimeIntervals.BiWeekly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 14));
    case TimeIntervals.Monthly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    case TimeIntervals.Quarterly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1));
    case TimeIntervals.Semesterly:
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 6, 1));
    case TimeIntervals.Yearly:
      return new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
    default:
      return new Date(date.getTime());
  }
}

export function resolveTotalBucketCount(
  dateRange: NormalizedInsightQuery['dateRange'],
  timeInterval: TimeIntervals,
): number {
  if (dateRange.kind !== 'bounded') {
    return 0;
  }

  const startDate = new Date(dateRange.startDate);
  const endDate = new Date(dateRange.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate.getTime() > endDate.getTime()) {
    return 0;
  }

  let cursor = alignDateToBucketStart(startDate, timeInterval);
  let totalBucketCount = 0;
  while (cursor.getTime() <= endDate.getTime()) {
    totalBucketCount += 1;
    const nextCursor = addBucketInterval(cursor, timeInterval);
    if (nextCursor.getTime() <= cursor.getTime()) {
      break;
    }
    cursor = nextCursor;
  }

  return totalBucketCount;
}

export function buildBucketCoverage(
  query: NormalizedInsightQuery,
  aggregation: {
    resolvedTimeInterval: TimeIntervals;
    buckets: Array<unknown>;
  },
): AiInsightSummary['bucketCoverage'] {
  if (query.categoryType !== ChartDataCategoryTypes.DateType || query.dateRange.kind !== 'bounded') {
    return null;
  }

  const totalBucketCount = resolveTotalBucketCount(query.dateRange, aggregation.resolvedTimeInterval);
  if (totalBucketCount <= 0) {
    return null;
  }

  return {
    nonEmptyBucketCount: aggregation.buckets.length,
    totalBucketCount,
  };
}
