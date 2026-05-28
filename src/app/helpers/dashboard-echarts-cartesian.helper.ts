import {
  ActivityTypes,
  ActivityTypesHelper,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import {
  formatDashboardDateByInterval,
  getDashboardChartSortComparator
} from './dashboard-chart-data.helper';

export interface DashboardCartesianPoint {
  index: number;
  label: string;
  value: number | null;
  count: number;
  time: number | null;
  activityType: ActivityTypes | null;
  rawItem: any;
}

export interface BuildDashboardCartesianPointsInput {
  data: any[] | null | undefined;
  chartDataValueType?: ChartDataValueTypes;
  chartDataCategoryType?: ChartDataCategoryTypes;
  chartDataTimeInterval?: TimeIntervals;
}

export interface DashboardRegressionPoint {
  x: number;
  y: number;
}

const HOUR_MS = 60 * 60 * 1000;

function getMissingBucketValue(chartDataValueType: ChartDataValueTypes | undefined): number | null {
  return chartDataValueType === ChartDataValueTypes.Total ? 0 : null;
}

function shouldPadSingleDatePoint(interval: TimeIntervals): boolean {
  return interval === TimeIntervals.Daily;
}

function resolveDayBucketStart(date: Date): Date {
  const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  normalizedDate.setHours(0, 0, 0, 0);
  return normalizedDate;
}

function resolveWeeklyBucketStartDate(date: Date): Date {
  const weekStart = resolveDayBucketStart(date);
  const day = weekStart.getDay() || 7;
  weekStart.setDate(weekStart.getDate() - day + 1);
  return weekStart;
}

function resolveIsoWeekOneStart(year: number): Date {
  return resolveWeeklyBucketStartDate(new Date(year, 0, 4));
}

function resolveUtcCalendarTime(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function resolveBiWeeklyBucketStartDate(date: Date): Date {
  const weekStart = resolveWeeklyBucketStartDate(date);
  const weekReference = new Date(weekStart.getTime());
  weekReference.setDate(weekReference.getDate() + 3);
  const isoWeekYear = weekReference.getFullYear();
  const isoWeekOneStart = resolveIsoWeekOneStart(isoWeekYear);
  const weeksFromIsoWeekOne = Math.floor(
    (resolveUtcCalendarTime(weekStart) - resolveUtcCalendarTime(isoWeekOneStart)) / (7 * 24 * 60 * 60 * 1000),
  );
  if (weeksFromIsoWeekOne % 2 === 0) {
    return weekStart;
  }
  const biWeeklyStart = new Date(weekStart.getTime());
  biWeeklyStart.setDate(biWeeklyStart.getDate() - 7);
  return biWeeklyStart;
}

function resolveQuarterlyBucketStartDate(date: Date): Date {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

function resolveSemesterlyBucketStartDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() < 6 ? 0 : 6, 1);
}

function resolveHourlyBucketStartDate(date: Date): Date {
  const hourStartTime = Math.floor(date.getTime() / HOUR_MS) * HOUR_MS;
  return new Date(hourStartTime);
}

function resolveIntervalBucketStartDate(date: Date, interval: TimeIntervals): Date {
  switch (interval) {
    case TimeIntervals.Yearly:
      return new Date(date.getFullYear(), 0, 1);
    case TimeIntervals.Monthly:
      return new Date(date.getFullYear(), date.getMonth(), 1);
    case TimeIntervals.Weekly:
      return resolveWeeklyBucketStartDate(date);
    case TimeIntervals.BiWeekly:
      return resolveBiWeeklyBucketStartDate(date);
    case TimeIntervals.Quarterly:
      return resolveQuarterlyBucketStartDate(date);
    case TimeIntervals.Semesterly:
      return resolveSemesterlyBucketStartDate(date);
    case TimeIntervals.Hourly:
      return resolveHourlyBucketStartDate(date);
    case TimeIntervals.Daily:
    default:
      return resolveDayBucketStart(date);
  }
}

function formatBucketKeyPart(value: number): string {
  return `${value}`.padStart(2, '0');
}

function resolveIntervalBucketKey(date: Date, interval: TimeIntervals): string {
  switch (interval) {
    case TimeIntervals.Yearly:
      return `Y-${date.getFullYear()}`;
    case TimeIntervals.Monthly:
      return `M-${date.getFullYear()}-${formatBucketKeyPart(date.getMonth() + 1)}`;
    case TimeIntervals.Weekly:
      return `W-${date.getFullYear()}-${formatBucketKeyPart(date.getMonth() + 1)}-${formatBucketKeyPart(date.getDate())}`;
    case TimeIntervals.BiWeekly:
      return `BW-${date.getFullYear()}-${formatBucketKeyPart(date.getMonth() + 1)}-${formatBucketKeyPart(date.getDate())}`;
    case TimeIntervals.Quarterly:
      return `Q-${date.getFullYear()}-${Math.floor(date.getMonth() / 3) + 1}`;
    case TimeIntervals.Semesterly:
      return `S-${date.getFullYear()}-${date.getMonth() < 6 ? 1 : 2}`;
    case TimeIntervals.Hourly:
      return `H-${date.getTime()}`;
    case TimeIntervals.Daily:
    default:
      return `D-${date.getFullYear()}-${formatBucketKeyPart(date.getMonth() + 1)}-${formatBucketKeyPart(date.getDate())}`;
  }
}

function getNextIntervalDate(date: Date, interval: TimeIntervals): Date {
  const next = new Date(date.getTime());
  switch (interval) {
    case TimeIntervals.Yearly:
      next.setFullYear(next.getFullYear() + 1);
      break;
    case TimeIntervals.Monthly:
      next.setMonth(next.getMonth() + 1);
      break;
    case TimeIntervals.Weekly:
      next.setDate(next.getDate() + 7);
      break;
    case TimeIntervals.BiWeekly:
      next.setDate(next.getDate() + 14);
      break;
    case TimeIntervals.Quarterly:
      next.setMonth(next.getMonth() + 3);
      break;
    case TimeIntervals.Semesterly:
      next.setMonth(next.getMonth() + 6);
      break;
    case TimeIntervals.Hourly:
      next.setTime(next.getTime() + HOUR_MS);
      break;
    case TimeIntervals.Daily:
    default:
      next.setDate(next.getDate() + 1);
      break;
  }
  return resolveIntervalBucketStartDate(next, interval);
}

function getPreviousIntervalDate(date: Date, interval: TimeIntervals): Date {
  const previous = new Date(date.getTime());
  switch (interval) {
    case TimeIntervals.Yearly:
      previous.setFullYear(previous.getFullYear() - 1);
      break;
    case TimeIntervals.Monthly:
      previous.setMonth(previous.getMonth() - 1);
      break;
    case TimeIntervals.Weekly:
      previous.setDate(previous.getDate() - 7);
      break;
    case TimeIntervals.BiWeekly:
      previous.setDate(previous.getDate() - 14);
      break;
    case TimeIntervals.Quarterly:
      previous.setMonth(previous.getMonth() - 3);
      break;
    case TimeIntervals.Semesterly:
      previous.setMonth(previous.getMonth() - 6);
      break;
    case TimeIntervals.Hourly:
      previous.setTime(previous.getTime() - HOUR_MS);
      break;
    case TimeIntervals.Daily:
    default:
      previous.setDate(previous.getDate() - 1);
      break;
  }
  return resolveIntervalBucketStartDate(previous, interval);
}

function countInclusiveIntervals(startDate: Date, endDate: Date, interval: TimeIntervals): number | null {
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate.getTime() > endDate.getTime()) {
    return null;
  }

  let count = 0;
  let cursor = resolveIntervalBucketStartDate(startDate, interval);
  const endCursor = resolveIntervalBucketStartDate(endDate, interval);
  while (cursor.getTime() <= endCursor.getTime()) {
    count += 1;
    const nextCursor = getNextIntervalDate(cursor, interval);
    if (nextCursor.getTime() <= cursor.getTime()) {
      return null;
    }
    cursor = nextCursor;
  }

  return count;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function resolveDateValue(item: any): number | null {
  const candidates = [item?.time, item?.type];
  for (const candidate of candidates) {
    const asNumber = toFiniteNumber(candidate);
    if (asNumber !== null) {
      return asNumber;
    }
    if (candidate instanceof Date || typeof candidate === 'string' || typeof candidate === 'number') {
      const asDate = new Date(candidate);
      if (Number.isFinite(asDate.getTime())) {
        return asDate.getTime();
      }
    }
  }
  return null;
}

function resolveActivityTypeAndLabel(rawType: unknown): { activityType: ActivityTypes | null; label: string } {
  if (typeof rawType === 'string') {
    const trimmedType = rawType.trim();
    if (!trimmedType) {
      return { activityType: null, label: 'Unknown' };
    }

    const enumValueFromAlias = ActivityTypesHelper.resolveActivityType(trimmedType);
    if (enumValueFromAlias) {
      return {
        activityType: enumValueFromAlias,
        label: enumValueFromAlias
      };
    }

    if (Object.values(ActivityTypes).includes(trimmedType as ActivityTypes)) {
      return {
        activityType: trimmedType as ActivityTypes,
        label: trimmedType
      };
    }

    return {
      activityType: null,
      label: trimmedType
    };
  }

  if (typeof rawType === 'number') {
    const normalizedType = ActivityTypesHelper.resolveActivityType(rawType);
    if (normalizedType) {
      return {
        activityType: normalizedType,
        label: normalizedType
      };
    }
    return {
      activityType: null,
      label: `${rawType}`
    };
  }

  return { activityType: null, label: 'Unknown' };
}

export function buildDashboardCartesianPoints(
  input: BuildDashboardCartesianPointsInput
): DashboardCartesianPoint[] {
  if (!input.chartDataValueType) {
    return [];
  }

  const safeData = Array.isArray(input.data) ? [...input.data] : [];
  const sortedData = safeData.sort(
    getDashboardChartSortComparator(input.chartDataCategoryType, input.chartDataValueType)
  );
  const chartDataTimeInterval = input.chartDataTimeInterval || TimeIntervals.Daily;

  const points = sortedData.reduce((normalizedPoints: DashboardCartesianPoint[], item) => {
    const value = toFiniteNumber(item?.[input.chartDataValueType as string]);
    if (value === null) {
      return normalizedPoints;
    }

    const count = Math.max(0, toFiniteNumber(item?.count) || 0);
    const pointIndex = normalizedPoints.length;

    if (input.chartDataCategoryType === ChartDataCategoryTypes.DateType) {
      const time = resolveDateValue(item);
      if (time === null) {
        return normalizedPoints;
      }

      normalizedPoints.push({
        index: pointIndex,
        label: formatDashboardDateByInterval(time, chartDataTimeInterval),
        value,
        count,
        time,
        activityType: null,
        rawItem: item
      });
      return normalizedPoints;
    }

    const { activityType, label } = resolveActivityTypeAndLabel(item?.type);
    normalizedPoints.push({
      index: pointIndex,
      label,
      value,
      count,
      time: null,
      activityType,
      rawItem: item
    });
    return normalizedPoints;
  }, []);

  if (input.chartDataCategoryType !== ChartDataCategoryTypes.DateType || points.length === 0) {
    return points;
  }

  const pointsByBucketKey = new Map<string, DashboardCartesianPoint>();
  points.forEach((point) => {
    if (point.time !== null) {
      const pointDate = resolveIntervalBucketStartDate(new Date(point.time), chartDataTimeInterval);
      const bucketKey = resolveIntervalBucketKey(pointDate, chartDataTimeInterval);
      pointsByBucketKey.set(bucketKey, point);
    }
  });

  const startTime = points[0].time;
  const endTime = points[points.length - 1].time;
  if (startTime === null || endTime === null) {
    return points;
  }
  const startDate = resolveIntervalBucketStartDate(new Date(startTime), chartDataTimeInterval);
  const endDate = resolveIntervalBucketStartDate(new Date(endTime), chartDataTimeInterval);

  const expectedPointCount = countInclusiveIntervals(startDate, endDate, chartDataTimeInterval);
  if (!expectedPointCount) {
    return points;
  }

  const contiguousPoints = new Array<DashboardCartesianPoint>(expectedPointCount);
  const missingBucketValue = getMissingBucketValue(input.chartDataValueType);
  let cursor = startDate;
  for (let index = 0; index < expectedPointCount; index += 1) {
    const bucketKey = resolveIntervalBucketKey(cursor, chartDataTimeInterval);
    const existingPoint = pointsByBucketKey.get(bucketKey);
    if (existingPoint) {
      contiguousPoints[index] = {
        ...existingPoint,
        index
      };
    } else {
      contiguousPoints[index] = {
        index,
        label: formatDashboardDateByInterval(cursor.getTime(), chartDataTimeInterval),
        value: missingBucketValue,
        count: 0,
        time: cursor.getTime(),
        activityType: null,
        rawItem: null
      };
    }

    if (index < expectedPointCount - 1) {
      const nextCursor = getNextIntervalDate(cursor, chartDataTimeInterval);
      if (nextCursor.getTime() <= cursor.getTime()) {
        return points;
      }
      cursor = nextCursor;
    }
  }

  if (
    contiguousPoints.length === 1
    && contiguousPoints[0].time !== null
    && shouldPadSingleDatePoint(chartDataTimeInterval)
  ) {
    const anchorTime = contiguousPoints[0].time as number;
    const anchorDate = resolveIntervalBucketStartDate(new Date(anchorTime), chartDataTimeInterval);
    const previousTime = getPreviousIntervalDate(anchorDate, chartDataTimeInterval).getTime();
    const nextTime = getNextIntervalDate(anchorDate, chartDataTimeInterval).getTime();
    const paddingBucketValue = getMissingBucketValue(input.chartDataValueType);

    return [
      {
        index: 0,
        label: formatDashboardDateByInterval(previousTime, chartDataTimeInterval),
        value: paddingBucketValue,
        count: 0,
        time: previousTime,
        activityType: null,
        rawItem: null
      },
      {
        ...contiguousPoints[0],
        index: 1
      },
      {
        index: 2,
        label: formatDashboardDateByInterval(nextTime, chartDataTimeInterval),
        value: paddingBucketValue,
        count: 0,
        time: nextTime,
        activityType: null,
        rawItem: null
      }
    ];
  }

  return contiguousPoints;
}

export function buildLinearRegressionPoints(points: DashboardRegressionPoint[]): DashboardRegressionPoint[] {
  const finitePoints = points
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
    .sort((left, right) => left.x - right.x);

  if (finitePoints.length < 2) {
    return [];
  }

  const totalPoints = finitePoints.length;
  const sumX = finitePoints.reduce((sum, point) => sum + point.x, 0);
  const sumY = finitePoints.reduce((sum, point) => sum + point.y, 0);
  const sumXY = finitePoints.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumXX = finitePoints.reduce((sum, point) => sum + point.x * point.x, 0);
  const denominator = totalPoints * sumXX - sumX * sumX;

  if (Math.abs(denominator) < 1e-9) {
    return [];
  }

  const slope = (totalPoints * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / totalPoints;

  return finitePoints.map((point) => ({
    x: point.x,
    y: slope * point.x + intercept
  }));
}

export function buildDashboardDateRegressionLine(points: DashboardCartesianPoint[]): DashboardRegressionPoint[] {
  const modelSourcePoints = points
    .filter((point) => point.time !== null && point.count > 0 && Number.isFinite(point.value))
    .map((point) => ({
      x: point.time as number,
      y: point.value as number
    }));

  if (modelSourcePoints.length < 2) {
    return [];
  }

  const totalPoints = modelSourcePoints.length;
  const sumX = modelSourcePoints.reduce((sum, point) => sum + point.x, 0);
  const sumY = modelSourcePoints.reduce((sum, point) => sum + point.y, 0);
  const sumXY = modelSourcePoints.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumXX = modelSourcePoints.reduce((sum, point) => sum + point.x * point.x, 0);
  const denominator = totalPoints * sumXX - sumX * sumX;

  if (Math.abs(denominator) < 1e-9) {
    return [];
  }

  const slope = (totalPoints * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / totalPoints;

  return points
    .filter((point) => point.time !== null)
    .map((point) => ({
      x: point.time as number,
      y: slope * (point.time as number) + intercept
    }));
}
