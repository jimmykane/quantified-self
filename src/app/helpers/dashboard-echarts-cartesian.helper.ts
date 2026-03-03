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
  value: number;
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

function getNextIntervalTime(time: number, interval: TimeIntervals): number {
  const next = new Date(time);
  switch (interval) {
    case TimeIntervals.Yearly:
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    case TimeIntervals.Monthly:
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case TimeIntervals.Weekly:
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case TimeIntervals.Hourly:
      next.setUTCHours(next.getUTCHours() + 1);
      break;
    case TimeIntervals.Daily:
    default:
      next.setUTCDate(next.getUTCDate() + 1);
      break;
  }
  return next.getTime();
}

function getPreviousIntervalTime(time: number, interval: TimeIntervals): number {
  const previous = new Date(time);
  switch (interval) {
    case TimeIntervals.Yearly:
      previous.setUTCFullYear(previous.getUTCFullYear() - 1);
      break;
    case TimeIntervals.Monthly:
      previous.setUTCMonth(previous.getUTCMonth() - 1);
      break;
    case TimeIntervals.Weekly:
      previous.setUTCDate(previous.getUTCDate() - 7);
      break;
    case TimeIntervals.Hourly:
      previous.setUTCHours(previous.getUTCHours() - 1);
      break;
    case TimeIntervals.Daily:
    default:
      previous.setUTCDate(previous.getUTCDate() - 1);
      break;
  }
  return previous.getTime();
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

  const pointsByTime = new Map<number, DashboardCartesianPoint>();
  points.forEach((point) => {
    if (point.time !== null) {
      pointsByTime.set(point.time, point);
    }
  });

  const startTime = points[0].time;
  const endTime = points[points.length - 1].time;
  if (startTime === null || endTime === null) {
    return points;
  }

  const contiguousPoints: DashboardCartesianPoint[] = [];
  let cursor = startTime;
  let guard = 0;
  while (cursor <= endTime && guard < 10000) {
    const existingPoint = pointsByTime.get(cursor);
    if (existingPoint) {
      contiguousPoints.push({
        ...existingPoint,
        index: contiguousPoints.length
      });
    } else {
      contiguousPoints.push({
        index: contiguousPoints.length,
        label: formatDashboardDateByInterval(cursor, chartDataTimeInterval),
        value: 0,
        count: 0,
        time: cursor,
        activityType: null,
        rawItem: null
      });
    }

    const nextCursor = getNextIntervalTime(cursor, chartDataTimeInterval);
    if (nextCursor <= cursor) {
      break;
    }
    cursor = nextCursor;
    guard += 1;
  }

  if (contiguousPoints.length === 1 && contiguousPoints[0].time !== null) {
    const anchorTime = contiguousPoints[0].time as number;
    const previousTime = getPreviousIntervalTime(anchorTime, chartDataTimeInterval);
    const nextTime = getNextIntervalTime(anchorTime, chartDataTimeInterval);

    return [
      {
        index: 0,
        label: formatDashboardDateByInterval(previousTime, chartDataTimeInterval),
        value: 0,
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
        value: 0,
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
    .filter((point) => point.time !== null && point.count > 0)
    .map((point) => ({
      x: point.time as number,
      y: point.value
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
