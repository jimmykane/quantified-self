import { ActivityTypes, ActivityTypesHelper, ChartDataValueTypes } from '@sports-alliance/sports-lib';
import { DashboardCartesianPoint } from './dashboard-echarts-cartesian.helper';

const UNKNOWN_ACTIVITY_KEY = '__unknown_activity__';
const UNKNOWN_ACTIVITY_LABEL = 'Unknown';
const SEGMENT_ROUNDING_FACTOR = 1_000_000;

export interface DashboardDateActivitySegment {
  activityKey: string;
  activityType: ActivityTypes | null;
  label: string;
  colorKey: string;
  rawValue: number;
  value: number;
  percent: number;
  count: number;
}

export interface DashboardDateActivityBucket {
  index: number;
  label: string;
  time: number | null;
  total: number;
  count: number;
  segments: DashboardDateActivitySegment[];
  rawItem: any;
}

export interface DashboardDateActivitySeriesEntry {
  key: string;
  label: string;
  activityType: ActivityTypes | null;
  colorKey: string;
  totalRawValue: number;
}

export interface BuildDashboardDateActivitySegmentationInput {
  rawData: any[] | null | undefined;
  points: DashboardCartesianPoint[];
  chartDataValueType?: ChartDataValueTypes;
}

export interface DashboardDateActivitySegmentationResult {
  buckets: DashboardDateActivityBucket[];
  series: DashboardDateActivitySeriesEntry[];
}

interface RawContributionAccumulator {
  rawValue: number;
  count: number;
}

interface RawDateBucketAccumulator {
  count: number;
  contributions: Map<string, RawContributionAccumulator>;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function parseDateValue(item: any): number | null {
  const candidates = [item?.time, item?.type];
  for (const candidate of candidates) {
    const numeric = toFiniteNumber(candidate);
    if (numeric !== null) {
      return numeric;
    }
    if (candidate instanceof Date || typeof candidate === 'string' || typeof candidate === 'number') {
      const date = new Date(candidate);
      if (Number.isFinite(date.getTime())) {
        return date.getTime();
      }
    }
  }
  return null;
}

function resolveActivityTypeAndLabel(rawType: unknown): { activityType: ActivityTypes | null; label: string } {
  if (typeof rawType === 'string') {
    const trimmedType = rawType.trim();
    if (!trimmedType) {
      return { activityType: null, label: UNKNOWN_ACTIVITY_LABEL };
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

  return { activityType: null, label: UNKNOWN_ACTIVITY_LABEL };
}

function roundSegmentValue(value: number): number {
  return Math.round(value * SEGMENT_ROUNDING_FACTOR) / SEGMENT_ROUNDING_FACTOR;
}

function isReservedKey(key: string, valueType: ChartDataValueTypes | undefined): boolean {
  if (key === 'time' || key === 'type' || key === 'count') {
    return true;
  }
  if (typeof valueType === 'string' && key === valueType) {
    return true;
  }
  if (key.endsWith('-Count')) {
    return true;
  }
  return false;
}

function buildRawDataByTime(
  rawData: any[] | null | undefined,
  valueType: ChartDataValueTypes | undefined
): Map<number, RawDateBucketAccumulator> {
  const rows = Array.isArray(rawData) ? rawData : [];
  const byTime = new Map<number, RawDateBucketAccumulator>();

  rows.forEach((row) => {
    const time = parseDateValue(row);
    if (time === null) {
      return;
    }

    const existing = byTime.get(time) || {
      count: 0,
      contributions: new Map<string, RawContributionAccumulator>()
    };
    existing.count += Math.max(0, toFiniteNumber(row?.count) || 0);

    Object.keys(row || {}).forEach((key) => {
      if (isReservedKey(key, valueType)) {
        return;
      }
      const rawValue = toFiniteNumber(row?.[key]);
      if (rawValue === null || rawValue <= 0) {
        return;
      }

      const contribution = existing.contributions.get(key) || { rawValue: 0, count: 0 };
      contribution.rawValue += rawValue;
      contribution.count += Math.max(0, toFiniteNumber(row?.[`${key}-Count`]) || 0);
      existing.contributions.set(key, contribution);
    });

    byTime.set(time, existing);
  });

  return byTime;
}

function createUnknownSegment(total: number, count: number): DashboardDateActivitySegment {
  const fallbackRawValue = Math.abs(total) || 1;
  return {
    activityKey: UNKNOWN_ACTIVITY_KEY,
    activityType: null,
    label: UNKNOWN_ACTIVITY_LABEL,
    colorKey: UNKNOWN_ACTIVITY_KEY,
    rawValue: fallbackRawValue,
    value: total,
    percent: 100,
    count
  };
}

function normalizeSegments(
  total: number,
  segments: Array<{
    activityKey: string;
    activityType: ActivityTypes | null;
    label: string;
    colorKey: string;
    rawValue: number;
    count: number;
  }>
): DashboardDateActivitySegment[] {
  if (!segments.length) {
    return [];
  }

  const rawValueTotal = segments.reduce((sum, segment) => sum + segment.rawValue, 0);
  if (rawValueTotal <= 0) {
    return [createUnknownSegment(total, 0)];
  }

  let runningValue = 0;
  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    const ratio = segment.rawValue / rawValueTotal;
    const value = isLast
      ? total - runningValue
      : roundSegmentValue(total * ratio);
    runningValue += isLast ? 0 : value;

    return {
      activityKey: segment.activityKey,
      activityType: segment.activityType,
      label: segment.label,
      colorKey: segment.colorKey,
      rawValue: segment.rawValue,
      value,
      percent: ratio * 100,
      count: segment.count
    };
  });
}

export function buildDashboardDateActivitySegmentation(
  input: BuildDashboardDateActivitySegmentationInput
): DashboardDateActivitySegmentationResult {
  const points = Array.isArray(input.points) ? input.points : [];
  const rawDataByTime = buildRawDataByTime(input.rawData, input.chartDataValueType);

  const buckets = points.map((point) => {
    const total = Number.isFinite(point.value) ? point.value : 0;
    const pointCount = Math.max(0, toFiniteNumber(point.count) || 0);
    const rawBucket = point.time !== null ? rawDataByTime.get(point.time) : undefined;

    if (total === 0) {
      return {
        index: point.index,
        label: point.label,
        time: point.time,
        total,
        count: pointCount,
        segments: [],
        rawItem: point.rawItem
      } as DashboardDateActivityBucket;
    }

    const rawSegments = Array.from(rawBucket?.contributions.entries() || [])
      .map(([activityKey, contribution]) => {
        const { activityType, label } = resolveActivityTypeAndLabel(activityKey);
        return {
          activityKey,
          activityType,
          label,
          colorKey: activityType || activityKey,
          rawValue: contribution.rawValue,
          count: contribution.count
        };
      })
      .filter((segment) => Number.isFinite(segment.rawValue) && segment.rawValue > 0);

    const segments = rawSegments.length
      ? normalizeSegments(total, rawSegments)
      : [createUnknownSegment(total, rawBucket?.count || pointCount)];

    return {
      index: point.index,
      label: point.label,
      time: point.time,
      total,
      count: pointCount,
      segments,
      rawItem: point.rawItem
    } as DashboardDateActivityBucket;
  });

  const seriesAccumulator = new Map<string, DashboardDateActivitySeriesEntry>();
  buckets.forEach((bucket) => {
    bucket.segments.forEach((segment) => {
      const existing = seriesAccumulator.get(segment.activityKey);
      if (existing) {
        existing.totalRawValue += segment.rawValue;
        return;
      }
      seriesAccumulator.set(segment.activityKey, {
        key: segment.activityKey,
        label: segment.label,
        activityType: segment.activityType,
        colorKey: segment.colorKey,
        totalRawValue: segment.rawValue
      });
    });
  });

  const series = Array.from(seriesAccumulator.values())
    .sort((left, right) => right.totalRawValue - left.totalRawValue);

  const seriesOrderMap = new Map<string, number>();
  series.forEach((entry, index) => {
    seriesOrderMap.set(entry.key, index);
  });
  buckets.forEach((bucket) => {
    bucket.segments.sort((left, right) => (
      (seriesOrderMap.get(left.activityKey) ?? Number.MAX_SAFE_INTEGER)
      - (seriesOrderMap.get(right.activityKey) ?? Number.MAX_SAFE_INTEGER)
    ));
  });

  return { buckets, series };
}
