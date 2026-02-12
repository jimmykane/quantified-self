import { ActivityInterface } from '@sports-alliance/sports-lib';

const POWER_CURVE_TYPE = 'PowerCurve';

interface ValueObject {
  getValue?: () => unknown;
}

export interface PowerCurveChartPoint {
  duration: number;
  power: number;
  wattsPerKg?: number;
}

export interface PowerCurveChartSeries {
  activity: ActivityInterface;
  activityId: string;
  label: string;
  points: PowerCurveChartPoint[];
}

export interface BuildPowerCurveSeriesOptions {
  isMerge?: boolean;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  if (value && typeof value === 'object' && typeof (value as ValueObject).getValue === 'function') {
    const numeric = (value as ValueObject).getValue?.();
    return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function getRawPowerCurvePoints(activity: ActivityInterface): unknown[] {
  const stat = activity?.getStat?.(POWER_CURVE_TYPE) as ValueObject | null | undefined;
  const statValue = stat?.getValue?.();
  return Array.isArray(statValue) ? statValue : [];
}

function getActivityTypeLabel(activity: ActivityInterface): string {
  const activityType = `${(activity as { type?: unknown })?.type ?? ''}`.trim();
  if (activityType.length > 0) {
    return activityType;
  }

  return '';
}

function getActivityBaseLabel(activity: ActivityInterface, index: number, isMerge: boolean): string {
  if (isMerge) {
    const creatorName = `${activity?.creator?.name ?? ''}`.trim();
    if (creatorName.length > 0) {
      return creatorName;
    }
  }

  const activityType = getActivityTypeLabel(activity);
  if (activityType.length > 0) {
    return activityType;
  }

  if (!isMerge) {
    const creatorName = `${activity?.creator?.name ?? ''}`.trim();
    if (creatorName.length > 0) {
      return creatorName;
    }
  }

  return `Activity ${index + 1}`;
}

function normalizePowerCurvePoints(rawPoints: unknown[]): PowerCurveChartPoint[] {
  const byDuration = new Map<number, PowerCurveChartPoint>();

  rawPoints.forEach((rawPoint) => {
    if (!rawPoint || typeof rawPoint !== 'object') {
      return;
    }

    const point = rawPoint as { duration?: unknown; power?: unknown; wattsPerKg?: unknown };
    const duration = toFiniteNumber(point.duration);
    const power = toFiniteNumber(point.power);
    const wattsPerKg = toFiniteNumber(point.wattsPerKg);

    if (!duration || duration <= 0 || !power || power <= 0) {
      return;
    }

    const normalizedDuration = Number(duration);
    const normalizedPoint: PowerCurveChartPoint = {
      duration: normalizedDuration,
      power: Number(power),
    };

    if (wattsPerKg && wattsPerKg > 0) {
      normalizedPoint.wattsPerKg = Number(wattsPerKg);
    }

    const existingPoint = byDuration.get(normalizedDuration);
    if (!existingPoint || normalizedPoint.power > existingPoint.power) {
      byDuration.set(normalizedDuration, normalizedPoint);
      return;
    }

    if (
      normalizedPoint.power === existingPoint.power
      && (normalizedPoint.wattsPerKg ?? 0) > (existingPoint.wattsPerKg ?? 0)
    ) {
      byDuration.set(normalizedDuration, normalizedPoint);
    }
  });

  return [...byDuration.values()].sort((left, right) => left.duration - right.duration);
}

export function buildPowerCurveSeries(
  activities: ActivityInterface[],
  options: BuildPowerCurveSeriesOptions = {}
): PowerCurveChartSeries[] {
  if (!Array.isArray(activities) || activities.length === 0) {
    return [];
  }

  const isMerge = options.isMerge === true;

  const candidateSeries = activities.map((activity, index) => {
    const points = normalizePowerCurvePoints(getRawPowerCurvePoints(activity));

    return {
      activity,
      activityId: `${activity?.getID?.() ?? `activity-${index + 1}`}`,
      baseLabel: getActivityBaseLabel(activity, index, isMerge),
      points,
    };
  }).filter((series) => series.points.length > 0);

  const labelCount = new Map<string, number>();

  return candidateSeries.map((series) => {
    const count = (labelCount.get(series.baseLabel) ?? 0) + 1;
    labelCount.set(series.baseLabel, count);

    return {
      activity: series.activity,
      activityId: series.activityId,
      label: count === 1 ? series.baseLabel : `${series.baseLabel} (${count})`,
      points: series.points,
    };
  });
}

export function shouldRenderPowerCurveChart(activities: ActivityInterface[]): boolean {
  return buildPowerCurveSeries(activities, { isMerge: false }).length > 0;
}
