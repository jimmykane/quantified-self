import { Injectable } from '@angular/core';
import {
  ActivityInterface,
  DataCadence,
  DataDuration,
  DataPower,
  analyzeActivityDurability,
  type DurabilityDiscipline,
  type DurabilityEligibilityReason,
  type DurabilityEvidenceValue,
  type DurabilityOutputSource,
} from '@sports-alliance/sports-lib';
import {
  filterPowerCurvePointsByMaxDuration,
  normalizePowerCurvePoints,
  POWER_CURVE_STAT_TYPE,
  type PowerCurvePoint as SharedPowerCurvePoint,
} from '@shared/power-curve';

const DEFAULT_EFFORT_WINDOWS = [5, 30, 60, 300, 1200, 3600];
const MIN_VALID_CADENCE = 35;
const MIN_VALID_POWER = 20;

interface ValueObject {
  getValue?: () => unknown;
}

interface ActivityLabelDescriptor {
  activity: ActivityInterface;
  activityId: string;
  label: string;
}

export interface BuildPowerCurveSeriesOptions {
  isMerge?: boolean;
}

export interface BuildPerformanceCurveSeriesOptions {
  isMerge?: boolean;
  maxPointsPerSeries?: number;
  minCadencePowerBinCount?: number;
  minCadenceValueCount?: number;
}

export interface BuildBestEffortMarkersOptions {
  windowDurations?: number[];
  maxMarkersPerWindow?: number;
}

export interface BuildPerformanceAvailabilityOptions {
  isMerge?: boolean;
}

export type PowerCurveChartPoint = SharedPowerCurvePoint;

export interface PowerCurveChartSeries {
  activity: ActivityInterface;
  activityId: string;
  label: string;
  points: PowerCurveChartPoint[];
}

export interface PerformanceCurveDurabilityPoint {
  duration: number;
  efficiency: number;
  output: number;
  outputUnit: 'W' | 'm/s';
  heartRate: number;
  rawOutput: number;
  rawHeartRate: number;
  inComparisonWindow: boolean;
  comparisonHalf: 'first' | 'second' | null;
}

export interface PerformanceCurveDurabilitySeries {
  activity: ActivityInterface;
  activityId: string;
  label: string;
  discipline: DurabilityDiscipline;
  outputSource: DurabilityOutputSource;
  outputUnit: 'W' | 'm/s';
  points: PerformanceCurveDurabilityPoint[];
}

export interface PerformanceCurveDurabilityActivitySummary {
  activity: ActivityInterface;
  activityId: string;
  label: string;
  summary: DurabilityEvidenceValue;
  eligibilityLabel: string;
}

export interface BuildDurabilitySeriesResult {
  renderSeries: PerformanceCurveDurabilitySeries[];
  markerSourceSeries: PerformanceCurveDurabilitySeries[];
  activitySummaries: PerformanceCurveDurabilityActivitySummary[];
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

export interface PerformanceCurveBestEffortMarker {
  activity: ActivityInterface;
  activityId: string;
  activityLabel: string;
  windowSeconds: number;
  windowLabel: string;
  duration: number;
  efficiency: number;
  output: number;
  outputUnit: 'W' | 'm/s';
  startDuration: number;
  endDuration: number;
}

export interface PerformanceCurveAvailability {
  hasPowerCurve: boolean;
  hasDurability: boolean;
  hasCadencePower: boolean;
  hasAny: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PerformanceCurveDataService {
  public getAvailability(
    activities: ActivityInterface[],
    options: BuildPerformanceAvailabilityOptions = {}
  ): PerformanceCurveAvailability {
    if (!Array.isArray(activities) || !activities.length) {
      return {
        hasPowerCurve: false,
        hasDurability: false,
        hasCadencePower: false,
        hasAny: false,
      };
    }

    const buildOptions = { isMerge: options.isMerge === true };
    const hasPowerCurve = this.buildPowerCurveSeries(activities, buildOptions).length > 0;
    const durabilityResult = this.buildDurabilitySeriesWithMarkerSource(activities, {
      ...buildOptions,
      maxPointsPerSeries: 2,
    });
    const hasDurability = durabilityResult.renderSeries.length > 0
      || durabilityResult.activitySummaries.length > 0;
    const hasCadencePower = this.buildCadencePowerSeries(activities, {
      ...buildOptions,
      maxPointsPerSeries: 2,
    }).length > 0;

    return {
      hasPowerCurve,
      hasDurability,
      hasCadencePower,
      hasAny: hasPowerCurve || hasDurability || hasCadencePower,
    };
  }

  public buildPowerCurveSeries(
    activities: ActivityInterface[],
    options: BuildPowerCurveSeriesOptions = {}
  ): PowerCurveChartSeries[] {
    if (!Array.isArray(activities) || activities.length === 0) {
      return [];
    }

    const isMerge = options.isMerge === true;

    const candidateSeries = activities.map((activity, index) => {
      const points = filterPowerCurvePointsByMaxDuration(
        normalizePowerCurvePoints(this.getRawPowerCurveStatValue(activity)).points,
        this.getActivityDurationSeconds(activity),
      );

      return {
        activity,
        activityId: `${activity?.getID?.() ?? `activity-${index + 1}`}`,
        baseLabel: this.getActivityBaseLabel(activity, index, isMerge),
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

  public buildDurabilitySeries(
    activities: ActivityInterface[],
    options: BuildPerformanceCurveSeriesOptions = {}
  ): PerformanceCurveDurabilitySeries[] {
    return this.buildDurabilitySeriesWithMarkerSource(activities, options).renderSeries;
  }

  public buildDurabilitySeriesWithMarkerSource(
    activities: ActivityInterface[],
    options: BuildPerformanceCurveSeriesOptions = {}
  ): BuildDurabilitySeriesResult {
    if (!Array.isArray(activities) || activities.length === 0) {
      return {
        renderSeries: [],
        markerSourceSeries: [],
        activitySummaries: [],
      };
    }

    const activityDescriptors = this.buildActivityLabels(activities, options.isMerge === true);

    const renderSeries: PerformanceCurveDurabilitySeries[] = [];
    const markerSourceSeries: PerformanceCurveDurabilitySeries[] = [];
    const activitySummaries: PerformanceCurveDurabilityActivitySummary[] = [];

    activityDescriptors.forEach((descriptor) => {
      const analysis = analyzeActivityDurability(descriptor.activity, { includeTimeline: true });
      const summary = analysis.summary;
      if (!summary) {
        return;
      }
      activitySummaries.push({
        activity: descriptor.activity,
        activityId: descriptor.activityId,
        label: descriptor.label,
        summary,
        eligibilityLabel: this.formatDurabilityEligibility(
          summary.eligibility.reason,
          summary.eligibility.comparisonSegments,
        ),
      });

      const points: PerformanceCurveDurabilityPoint[] = analysis.timeline.map(point => ({
        duration: point.elapsedSeconds,
        efficiency: point.aerobicEfficiency,
        output: point.output,
        outputUnit: summary.outputUnit,
        heartRate: point.heartRateBpm,
        rawOutput: point.rawOutput,
        rawHeartRate: point.rawHeartRateBpm,
        inComparisonWindow: point.inComparisonWindow,
        comparisonHalf: point.comparisonHalf,
      })).filter((point) => Number.isFinite(point.efficiency) && point.efficiency > 0);

      if (points.length < 2) {
        return;
      }

      const markerSeriesEntry: PerformanceCurveDurabilitySeries = {
        activity: descriptor.activity,
        activityId: descriptor.activityId,
        label: descriptor.label,
        discipline: summary.discipline,
        outputSource: summary.outputSource,
        outputUnit: summary.outputUnit,
        points,
      };
      markerSourceSeries.push(markerSeriesEntry);

      const downsampledPoints = this.downsamplePoints(points, options.maxPointsPerSeries);
      if (downsampledPoints.length < 2) {
        return;
      }

      renderSeries.push({
        activity: descriptor.activity,
        activityId: descriptor.activityId,
        label: descriptor.label,
        discipline: summary.discipline,
        outputSource: summary.outputSource,
        outputUnit: summary.outputUnit,
        points: downsampledPoints,
      });
    });

    return {
      renderSeries,
      markerSourceSeries,
      activitySummaries,
    };
  }

  public buildCadencePowerSeries(
    activities: ActivityInterface[],
    options: BuildPerformanceCurveSeriesOptions = {}
  ): PerformanceCurveCadencePowerSeries[] {
    if (!Array.isArray(activities) || activities.length === 0) {
      return [];
    }

    const activityDescriptors = this.buildActivityLabels(activities, options.isMerge === true);

    return activityDescriptors.map((descriptor) => {
      const powerData = this.getStreamData(descriptor.activity, DataPower.type);
      const cadenceData = this.getStreamData(descriptor.activity, DataCadence.type);
      const length = Math.min(powerData.length, cadenceData.length);

      if (length < 3) {
        return null;
      }

      const pointsRaw: Array<{ duration: number; cadence: number; power: number }> = [];

      for (let index = 0; index < length; index += 1) {
        const power = this.toFiniteNumber(powerData[index]);
        const cadence = this.toFiniteNumber(cadenceData[index]);
        if (!power || !cadence || power < MIN_VALID_POWER || cadence < MIN_VALID_CADENCE) {
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
      const cadenceValueCounts = new Map<number, number>();
      pointsRaw.forEach((point) => {
        const cadenceBin = Math.floor(point.cadence / 5);
        const powerBin = Math.floor(point.power / 10);
        const key = `${cadenceBin}:${powerBin}`;
        binCounts.set(key, (binCounts.get(key) ?? 0) + 1);

        const cadenceBucket = Math.round(point.cadence);
        cadenceValueCounts.set(cadenceBucket, (cadenceValueCounts.get(cadenceBucket) ?? 0) + 1);
      });

      // In dense datasets, discard isolated singleton bins to reduce no-data-like visual noise.
      const inferredMinBinCount = pointsRaw.length > 900
        ? 4
        : pointsRaw.length > 500
          ? 3
          : pointsRaw.length > 300
            ? 2
            : 1;
      const minBinCount = Number.isFinite(options.minCadencePowerBinCount)
        ? Math.max(1, options.minCadencePowerBinCount as number)
        : inferredMinBinCount;
      const inferredMinCadenceCount = pointsRaw.length > 1500
        ? 10
        : pointsRaw.length > 900
          ? 7
          : pointsRaw.length > 500
            ? 5
            : pointsRaw.length > 300
              ? 3
              : 1;
      const minCadenceCount = Number.isFinite(options.minCadenceValueCount)
        ? Math.max(1, options.minCadenceValueCount as number)
        : inferredMinCadenceCount;

      const maxBinCount = Math.max(1, ...binCounts.values());

      const points: PerformanceCurveCadencePowerPoint[] = pointsRaw
        .map((point) => {
          const cadenceBin = Math.floor(point.cadence / 5);
          const powerBin = Math.floor(point.power / 10);
          const key = `${cadenceBin}:${powerBin}`;
          const binCount = binCounts.get(key) ?? 1;
          if (binCount < minBinCount) {
            return null;
          }
          const cadenceCount = cadenceValueCounts.get(Math.round(point.cadence)) ?? 1;
          if (cadenceCount < minCadenceCount) {
            return null;
          }

          const density = binCount / maxBinCount;

          return {
            duration: point.duration,
            cadence: point.cadence,
            power: point.power,
            density,
          };
        })
        .filter((point): point is PerformanceCurveCadencePowerPoint => !!point);

      const downsampledPoints = this.downsamplePoints(points, options.maxPointsPerSeries);
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

  public buildBestEffortMarkers(
    durabilitySeries: PerformanceCurveDurabilitySeries[],
    options: BuildBestEffortMarkersOptions = {}
  ): PerformanceCurveBestEffortMarker[] {
    if (!Array.isArray(durabilitySeries) || !durabilitySeries.length) {
      return [];
    }

    const windows = (options.windowDurations ?? DEFAULT_EFFORT_WINDOWS)
      .filter((window) => Number.isFinite(window) && window > 0)
      .sort((left, right) => left - right);

    if (!windows.length) {
      return [];
    }

    const markers: PerformanceCurveBestEffortMarker[] = [];

    durabilitySeries.forEach((series) => {
      if (series.points.length < 2) {
        return;
      }

      const durations = series.points.map((point) => point.duration);
      const outputs = series.points.map((point) => point.rawOutput);
      const totalDurationSpan = durations[durations.length - 1] - durations[0];
      const sampleInterval = this.getMedianDurationStep(durations);
      const powerPrefix = [0];

      outputs.forEach((output, index) => {
        powerPrefix[index + 1] = powerPrefix[index] + output;
      });

      windows.forEach((windowSeconds) => {
        if (totalDurationSpan < windowSeconds) {
          return;
        }

        let bestPower = -1;
        let bestStart = 0;
        let bestEnd = 0;
        let start = 0;

        for (let end = 0; end < series.points.length; end += 1) {
          while (start < end && (durations[end] - durations[start]) > windowSeconds) {
            start += 1;
          }

          const span = durations[end] - durations[start];
          // Keep labels semantically correct: "2h" should represent an actual ~2h span.
          const minimumRequiredSpan = windowSeconds - Math.max(1, Math.round(sampleInterval * 1.5));
          if (span < minimumRequiredSpan) {
            continue;
          }

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

        const endPoint = series.points[bestEnd];
        if (!endPoint) {
          return;
        }

        markers.push({
          activity: series.activity,
          activityId: series.activityId,
          activityLabel: series.label,
          windowSeconds,
          windowLabel: this.formatEffortWindow(windowSeconds),
          duration: endPoint.duration,
          efficiency: endPoint.efficiency,
          output: bestPower,
          outputUnit: series.outputUnit,
          startDuration: series.points[bestStart]?.duration ?? endPoint.duration,
          endDuration: endPoint.duration,
        });
      });
    });

    if (!Number.isFinite(options.maxMarkersPerWindow) || (options.maxMarkersPerWindow ?? 0) <= 0) {
      return markers.sort((left, right) => left.windowSeconds - right.windowSeconds || right.output - left.output);
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
        .sort((left, right) => right.output - left.output)
        .slice(0, options.maxMarkersPerWindow)
      );
  }

  private getRawPowerCurveStatValue(activity: ActivityInterface): unknown {
    const stat = activity?.getStat?.(POWER_CURVE_STAT_TYPE) as ValueObject | null | undefined;
    const statValue = stat?.getValue?.();
    return statValue;
  }

  private getActivityDurationSeconds(activity: ActivityInterface): number | null {
    const durationStat = (
      activity?.getDuration?.()
      || activity?.getStat?.(DataDuration.type)
    ) as ValueObject | null | undefined;
    return this.toFiniteNumber(durationStat?.getValue?.());
  }

  private buildActivityLabels(activities: ActivityInterface[], isMerge: boolean): ActivityLabelDescriptor[] {
    const candidates = activities.map((activity, index) => {
      const activityId = `${activity?.getID?.() ?? `activity-${index + 1}`}`;
      return {
        activity,
        activityId,
        baseLabel: this.getActivityBaseLabel(activity, index, isMerge),
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

  private getActivityBaseLabel(activity: ActivityInterface, index: number, isMerge: boolean): string {
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

  private getStreamData(activity: ActivityInterface, type: string): (number | null)[] {
    try {
      const stream = activity?.getStream?.(type) as { getData?: (onlyNumeric?: boolean, filterInfinity?: boolean) => unknown } | null;
      const data = stream?.getData?.(false, true);
      return Array.isArray(data) ? (data as (number | null)[]) : [];
    } catch {
      return [];
    }
  }

  private downsamplePoints<T>(points: T[], maxPoints?: number): T[] {
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

  private getMedianDurationStep(durations: number[]): number {
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

  private formatEffortWindow(seconds: number): string {
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

  private formatDurabilityEligibility(
    reason: DurabilityEligibilityReason,
    comparisonSegments: DurabilityEvidenceValue['eligibility']['comparisonSegments'],
  ): string {
    const labels: Record<DurabilityEligibilityReason, string> = {
      eligible: comparisonSegments === 'outer-thirds'
        ? 'Comparable early and late thirds'
        : 'Comparable first and second halves',
      'unsupported-activity': 'This activity type is not supported',
      'missing-output': 'Missing supported output data',
      'missing-heart-rate': 'Missing heart-rate data',
      'insufficient-duration': 'Too short for the durability protocol',
      'insufficient-coverage': 'Not enough paired output and heart-rate coverage',
      'too-variable': 'Output varied too much for a steady comparison',
      'too-intense': 'Too much time was recorded in hard zones',
      'insufficient-halves': 'Not enough comparable early and late evidence',
      'unsupported-context': 'The activity context is not supported',
    };
    return labels[reason];
  }

  private toFiniteNumber(value: unknown): number | null {
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
}
