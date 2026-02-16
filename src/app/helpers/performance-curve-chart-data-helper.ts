import { ActivityInterface, DataCadence, DataHeartRate, DataPower } from '@sports-alliance/sports-lib';

import {
  buildPowerCurveSeries,
  BuildPowerCurveSeriesOptions,
  PowerCurveChartPoint,
  PowerCurveChartSeries,
} from './power-curve-chart-data-helper';

const DEFAULT_ROLLING_WINDOW_SECONDS = 180;
const DEFAULT_EFFORT_WINDOWS = [5, 30, 60, 300, 1200, 3600];

interface ValueObject {
  getValue?: () => unknown;
}

export interface BuildPerformanceCurveSeriesOptions {
  isMerge?: boolean;
  maxPointsPerSeries?: number;
  rollingWindowSeconds?: number;
}

export interface PerformanceCurveDecouplingPoint {
  duration: number;
  efficiency: number;
  power: number;
  heartRate: number;
  rawPower: number;
  rawHeartRate: number;
}

export interface PerformanceCurveDecouplingSeries {
  activity: ActivityInterface;
  activityId: string;
  label: string;
  points: PerformanceCurveDecouplingPoint[];
}

export interface PerformanceCurveCadencePowerPoint {
  duration: number;
  cadence: number;
  power: number;
  density: number;
}

export interface PerformanceCurveCadencePowerSeries {
  activity: ActivityInterface;
  activityId: string;
  label: string;
  points: PerformanceCurveCadencePowerPoint[];
}

export interface BuildBestEffortMarkersOptions {
  windowDurations?: number[];
  maxMarkersPerWindow?: number;
}

export interface PerformanceCurveBestEffortMarker {
  activity: ActivityInterface;
  activityId: string;
  activityLabel: string;
  windowSeconds: number;
  windowLabel: string;
  duration: number;
  efficiency: number;
  power: number;
  startDuration: number;
  endDuration: number;
}

interface ActivityLabelDescriptor {
  activity: ActivityInterface;
  activityId: string;
  label: string;
}

export function buildPowerCurvePaneSeries(
  activities: ActivityInterface[],
  options: BuildPowerCurveSeriesOptions = {}
): PowerCurveChartSeries[] {
  return buildPowerCurveSeries(activities, options);
}

export function buildDecouplingPaneSeries(
  activities: ActivityInterface[],
  options: BuildPerformanceCurveSeriesOptions = {}
): PerformanceCurveDecouplingSeries[] {
  if (!Array.isArray(activities) || activities.length === 0) {
    return [];
  }

  const rollingWindowSeconds = options.rollingWindowSeconds ?? DEFAULT_ROLLING_WINDOW_SECONDS;
  const activityDescriptors = buildActivityLabels(activities, options.isMerge === true);

  return activityDescriptors.map((descriptor) => {
    const powerData = getStreamData(descriptor.activity, DataPower.type);
    const heartRateData = getStreamData(descriptor.activity, DataHeartRate.type);
    const length = Math.min(powerData.length, heartRateData.length);

    if (length < 3) {
      return null;
    }

    const rawSamples: Array<{ duration: number; power: number; heartRate: number }> = [];

    for (let index = 0; index < length; index += 1) {
      const power = toFiniteNumber(powerData[index]);
      const heartRate = toFiniteNumber(heartRateData[index]);
      if (!power || !heartRate || power <= 0 || heartRate <= 0) {
        continue;
      }

      rawSamples.push({
        duration: index + 1,
        power,
        heartRate,
      });
    }

    if (rawSamples.length < 3) {
      return null;
    }

    const sampleInterval = getMedianDurationStep(rawSamples.map((sample) => sample.duration));
    const windowSamples = Math.max(1, Math.round(rollingWindowSeconds / sampleInterval));

    const powerPrefix = [0];
    const heartRatePrefix = [0];
    rawSamples.forEach((sample, index) => {
      powerPrefix[index + 1] = powerPrefix[index] + sample.power;
      heartRatePrefix[index + 1] = heartRatePrefix[index] + sample.heartRate;
    });

    const points: PerformanceCurveDecouplingPoint[] = rawSamples.map((sample, index) => {
      const start = Math.max(0, index - windowSamples + 1);
      const count = index - start + 1;
      const avgPower = (powerPrefix[index + 1] - powerPrefix[start]) / count;
      const avgHeartRate = (heartRatePrefix[index + 1] - heartRatePrefix[start]) / count;
      const efficiency = avgHeartRate > 0 ? avgPower / avgHeartRate : 0;

      return {
        duration: sample.duration,
        efficiency,
        power: avgPower,
        heartRate: avgHeartRate,
        rawPower: sample.power,
        rawHeartRate: sample.heartRate,
      };
    }).filter((point) => Number.isFinite(point.efficiency) && point.efficiency > 0);

    const downsampledPoints = downsamplePoints(points, options.maxPointsPerSeries);
    if (downsampledPoints.length < 2) {
      return null;
    }

    return {
      activity: descriptor.activity,
      activityId: descriptor.activityId,
      label: descriptor.label,
      points: downsampledPoints,
    };
  }).filter((series): series is PerformanceCurveDecouplingSeries => !!series);
}

export function buildCadencePowerPaneSeries(
  activities: ActivityInterface[],
  options: BuildPerformanceCurveSeriesOptions = {}
): PerformanceCurveCadencePowerSeries[] {
  if (!Array.isArray(activities) || activities.length === 0) {
    return [];
  }

  const activityDescriptors = buildActivityLabels(activities, options.isMerge === true);

  return activityDescriptors.map((descriptor) => {
    const powerData = getStreamData(descriptor.activity, DataPower.type);
    const cadenceData = getStreamData(descriptor.activity, DataCadence.type);
    const length = Math.min(powerData.length, cadenceData.length);

    if (length < 3) {
      return null;
    }

    const pointsRaw: Array<{ duration: number; cadence: number; power: number }> = [];

    for (let index = 0; index < length; index += 1) {
      const power = toFiniteNumber(powerData[index]);
      const cadence = toFiniteNumber(cadenceData[index]);
      if (!power || !cadence || power <= 0 || cadence <= 0) {
        continue;
      }

      pointsRaw.push({
        duration: index + 1,
        cadence,
        power,
      });
    }

    if (!pointsRaw.length) {
      return null;
    }

    const binCounts = new Map<string, number>();
    pointsRaw.forEach((point) => {
      const cadenceBin = Math.floor(point.cadence / 5);
      const powerBin = Math.floor(point.power / 10);
      const key = `${cadenceBin}:${powerBin}`;
      binCounts.set(key, (binCounts.get(key) ?? 0) + 1);
    });

    const maxBinCount = Math.max(1, ...binCounts.values());

    const points: PerformanceCurveCadencePowerPoint[] = pointsRaw.map((point) => {
      const cadenceBin = Math.floor(point.cadence / 5);
      const powerBin = Math.floor(point.power / 10);
      const key = `${cadenceBin}:${powerBin}`;
      const density = (binCounts.get(key) ?? 1) / maxBinCount;

      return {
        duration: point.duration,
        cadence: point.cadence,
        power: point.power,
        density,
      };
    });

    const downsampledPoints = downsamplePoints(points, options.maxPointsPerSeries);
    if (!downsampledPoints.length) {
      return null;
    }

    return {
      activity: descriptor.activity,
      activityId: descriptor.activityId,
      label: descriptor.label,
      points: downsampledPoints,
    };
  }).filter((series): series is PerformanceCurveCadencePowerSeries => !!series);
}

export function buildBestEffortMarkers(
  decouplingSeries: PerformanceCurveDecouplingSeries[],
  options: BuildBestEffortMarkersOptions = {}
): PerformanceCurveBestEffortMarker[] {
  if (!Array.isArray(decouplingSeries) || !decouplingSeries.length) {
    return [];
  }

  const windows = (options.windowDurations ?? DEFAULT_EFFORT_WINDOWS)
    .filter((window) => Number.isFinite(window) && window > 0)
    .sort((left, right) => left - right);

  if (!windows.length) {
    return [];
  }

  const markers: PerformanceCurveBestEffortMarker[] = [];

  decouplingSeries.forEach((series) => {
    if (series.points.length < 2) {
      return;
    }

    const durations = series.points.map((point) => point.duration);
    const powers = series.points.map((point) => point.rawPower);
    const sampleInterval = getMedianDurationStep(durations);
    const powerPrefix = [0];

    powers.forEach((power, index) => {
      powerPrefix[index + 1] = powerPrefix[index] + power;
    });

    windows.forEach((windowSeconds) => {
      const windowSamples = Math.max(1, Math.round(windowSeconds / sampleInterval));
      if (series.points.length < windowSamples) {
        return;
      }

      let bestPower = -1;
      let bestStart = 0;
      let bestEnd = windowSamples - 1;

      for (let end = windowSamples - 1; end < series.points.length; end += 1) {
        const start = end - windowSamples + 1;
        const count = end - start + 1;
        const avgPower = (powerPrefix[end + 1] - powerPrefix[start]) / count;
        if (avgPower > bestPower) {
          bestPower = avgPower;
          bestStart = start;
          bestEnd = end;
        }
      }

      if (!Number.isFinite(bestPower) || bestPower <= 0) {
        return;
      }

      const midpoint = Math.floor((bestStart + bestEnd) / 2);
      const midpointPoint = series.points[midpoint];
      if (!midpointPoint) {
        return;
      }

      markers.push({
        activity: series.activity,
        activityId: series.activityId,
        activityLabel: series.label,
        windowSeconds,
        windowLabel: formatEffortWindow(windowSeconds),
        duration: midpointPoint.duration,
        efficiency: midpointPoint.efficiency,
        power: bestPower,
        startDuration: series.points[bestStart]?.duration ?? midpointPoint.duration,
        endDuration: series.points[bestEnd]?.duration ?? midpointPoint.duration,
      });
    });
  });

  if (!Number.isFinite(options.maxMarkersPerWindow) || (options.maxMarkersPerWindow ?? 0) <= 0) {
    return markers.sort((left, right) => left.windowSeconds - right.windowSeconds || right.power - left.power);
  }

  const grouped = new Map<number, PerformanceCurveBestEffortMarker[]>();
  markers.forEach((marker) => {
    const collection = grouped.get(marker.windowSeconds) ?? [];
    collection.push(marker);
    grouped.set(marker.windowSeconds, collection);
  });

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .flatMap(([, markerCollection]) => markerCollection
      .sort((left, right) => right.power - left.power)
      .slice(0, options.maxMarkersPerWindow)
    );
}

export function shouldRenderPerformanceCurveChart(activities: ActivityInterface[]): boolean {
  if (!Array.isArray(activities) || !activities.length) {
    return false;
  }

  if (buildPowerCurvePaneSeries(activities, { isMerge: false }).length > 0) {
    return true;
  }

  if (buildDecouplingPaneSeries(activities, { isMerge: false, maxPointsPerSeries: 2 }).length > 0) {
    return true;
  }

  return buildCadencePowerPaneSeries(activities, { isMerge: false, maxPointsPerSeries: 2 }).length > 0;
}

function buildActivityLabels(activities: ActivityInterface[], isMerge: boolean): ActivityLabelDescriptor[] {
  const candidates = activities.map((activity, index) => {
    const activityId = `${activity?.getID?.() ?? `activity-${index + 1}`}`;
    return {
      activity,
      activityId,
      baseLabel: getActivityBaseLabel(activity, index, isMerge),
    };
  });

  const baseLabelCount = new Map<string, number>();

  return candidates.map((entry) => {
    const count = (baseLabelCount.get(entry.baseLabel) ?? 0) + 1;
    baseLabelCount.set(entry.baseLabel, count);

    return {
      activity: entry.activity,
      activityId: entry.activityId,
      label: count === 1 ? entry.baseLabel : `${entry.baseLabel} (${count})`,
    };
  });
}

function getActivityBaseLabel(activity: ActivityInterface, index: number, isMerge: boolean): string {
  if (isMerge) {
    const creatorName = `${activity?.creator?.name ?? ''}`.trim();
    if (creatorName.length > 0) {
      return creatorName;
    }
  }

  const activityType = `${(activity as { type?: unknown })?.type ?? ''}`.trim();
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

function getStreamData(activity: ActivityInterface, type: string): (number | null)[] {
  try {
    const stream = activity?.getStream?.(type) as { getData?: (onlyNumeric?: boolean, filterInfinity?: boolean) => unknown } | null;
    const data = stream?.getData?.(false, true);
    return Array.isArray(data) ? (data as (number | null)[]) : [];
  } catch {
    return [];
  }
}

function downsamplePoints<T>(points: T[], maxPoints?: number): T[] {
  if (!Number.isFinite(maxPoints) || (maxPoints ?? 0) <= 0 || points.length <= (maxPoints as number)) {
    return points;
  }

  const step = Math.ceil(points.length / (maxPoints as number));
  const downsampled = points.filter((_, index) => index % step === 0);
  const lastPoint = points[points.length - 1];
  if (downsampled[downsampled.length - 1] !== lastPoint) {
    downsampled.push(lastPoint);
  }

  return downsampled;
}

function getMedianDurationStep(durations: number[]): number {
  if (durations.length < 2) {
    return 1;
  }

  const deltas: number[] = [];
  for (let index = 1; index < durations.length; index += 1) {
    const delta = durations[index] - durations[index - 1];
    if (Number.isFinite(delta) && delta > 0) {
      deltas.push(delta);
    }
  }

  if (!deltas.length) {
    return 1;
  }

  deltas.sort((left, right) => left - right);
  const mid = Math.floor(deltas.length / 2);
  return deltas.length % 2 === 0
    ? (deltas[mid - 1] + deltas[mid]) / 2
    : deltas[mid];
}

function formatEffortWindow(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes}m`;
  }

  const hours = seconds / 3600;
  if (Number.isInteger(hours)) {
    return `${hours}h`;
  }

  return `${hours.toFixed(1)}h`;
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

export type {
  BuildPowerCurveSeriesOptions,
  PowerCurveChartPoint,
  PowerCurveChartSeries,
};
