import {
  DataAirPower,
  DataCadence,
  DataHeartRate,
  DataPower,
  DataPowerLeft,
  DataPowerRight,
} from '@sports-alliance/sports-lib';
import { EventChartPanelModel } from './event-echarts-data.helper';
import { isEventPaceStreamType } from './event-echarts-style.helper';
import { EventChartRange, normalizeEventRange } from './event-echarts-xaxis.helper';

const DEFAULT_NON_POWER_EXTRA_MAX = 0.1;
const DEFAULT_NON_PACE_TARGET_TICK_COUNT = 6;
const NICE_INTERVAL_FACTORS = [1, 1.5, 2, 2.5, 3, 5, 7.5, 10];
const AXIS_INTERVAL_DIVISIBILITY_EPSILON = 1e-9;

const POWER_STREAM_TYPES = new Set<string>([
  DataPower.type,
  DataAirPower.type,
  DataPowerRight.type,
  DataPowerLeft.type,
]);
const CADENCE_STREAM_TYPES = new Set<string>([
  DataCadence.type,
]);
const HEART_RATE_STREAM_TYPES = new Set<string>([
  DataHeartRate.type,
]);

export interface EventPanelYAxisConfig {
  inverse: boolean;
  min?: number;
  max?: number;
  interval?: number;
}

export interface BuildEventPanelYAxisConfigInput {
  panel: EventChartPanelModel;
  visibleRange: EventChartRange | null;
  extraMaxForPower: number;
  extraMaxForPace: number;
}

export function buildEventPanelYAxisConfig(input: BuildEventPanelYAxisConfigInput): EventPanelYAxisConfig {
  const streamTypes = input.panel.series.map((series) => series.streamType || '');
  const values = getVisibleValues(input.panel, input.visibleRange);
  const hasPaceStream = streamTypes.some((streamType) => isEventPaceStreamType(streamType));

  if (hasPaceStream) {
    return {
      ...buildDefaultAxis(values, false, input.extraMaxForPower),
      inverse: true,
    };
  }

  const hasCadenceStream = streamTypes.some((streamType) => CADENCE_STREAM_TYPES.has(streamType));
  if (hasCadenceStream) {
    return buildStepBasedAxis(values, {
      baseStep: 5,
      candidateIntervals: [5, 10, 15, 20],
      targetTickCount: 6,
      minFloor: 0,
    });
  }

  const hasHeartRateStream = streamTypes.some((streamType) => HEART_RATE_STREAM_TYPES.has(streamType));
  if (hasHeartRateStream) {
    return buildStepBasedAxis(values, {
      baseStep: 5,
      candidateIntervals: [10, 15, 20, 25],
      targetTickCount: 6,
      minFloor: 0,
    });
  }

  const hasPowerStream = streamTypes.some((streamType) => POWER_STREAM_TYPES.has(streamType));
  return buildDefaultAxis(values, hasPowerStream, input.extraMaxForPower);
}

function getVisibleValues(panel: EventChartPanelModel, visibleRange: EventChartRange | null): number[] {
  const normalizedRange = normalizeEventRange(visibleRange);

  return panel.series
    .flatMap((series) => series.points)
    .filter((point) => {
      if (!normalizedRange) {
        return true;
      }
      return point.x >= normalizedRange.start && point.x <= normalizedRange.end;
    })
    .map((point) => typeof point.y === 'number' ? point.y : Number.NaN)
    .filter((value) => Number.isFinite(value));
}

function buildDefaultAxis(values: number[], isPower: boolean, extraMaxForPower: number): EventPanelYAxisConfig {
  if (!values.length) {
    return { inverse: false };
  }

  const extrema = getValueExtrema(values);
  if (!extrema) {
    return { inverse: false };
  }

  const { min, max } = extrema;
  if (max <= min) {
    return buildSingleValueRange(min, false);
  }

  const span = max - min;
  const topPaddingRatio = isPower
    ? sanitizeExtraMax(extraMaxForPower, 0)
    : DEFAULT_NON_POWER_EXTRA_MAX;
  const minPadding = span * 0.02;
  const maxPadding = span * topPaddingRatio;

  const paddedMin = min >= 0 ? Math.max(0, min - minPadding) : min - minPadding;
  const paddedMax = max + maxPadding;
  const safePaddedMax = paddedMax > paddedMin ? paddedMax : (paddedMin + Math.max(1, span * 0.1));
  const snappedRange = buildNiceAxisRange(paddedMin, safePaddedMax, DEFAULT_NON_PACE_TARGET_TICK_COUNT);

  return {
    inverse: false,
    min: snappedRange.min,
    max: snappedRange.max,
    interval: snappedRange.interval,
  };
}

function buildStepBasedAxis(
  values: number[],
  options: {
    baseStep: number;
    candidateIntervals: number[];
    targetTickCount: number;
    minFloor?: number;
  }
): EventPanelYAxisConfig {
  if (!values.length) {
    return { inverse: false };
  }

  const extrema = getValueExtrema(values);
  if (!extrema) {
    return { inverse: false };
  }

  const { min, max } = extrema;
  if (max <= min) {
    return buildSingleValueRange(min, false);
  }

  const baseStep = Math.max(1, options.baseStep);
  const minFloor = Number.isFinite(options.minFloor) ? (options.minFloor as number) : Number.NEGATIVE_INFINITY;
  const snappedMin = Math.max(minFloor, Math.floor(min / baseStep) * baseStep);
  const snappedMax = Math.ceil(max / baseStep) * baseStep;
  const range = Math.max(baseStep, snappedMax - snappedMin);
  const interval = selectPreferredAxisInterval(
    range,
    options.candidateIntervals,
    options.targetTickCount,
    baseStep
  );
  const intervalAlignedMin = Math.max(minFloor, Math.floor(snappedMin / interval) * interval);
  const intervalAlignedMax = Math.max(intervalAlignedMin + interval, Math.ceil(snappedMax / interval) * interval);

  return {
    inverse: false,
    min: sanitizeSnappedAxisNumber(intervalAlignedMin),
    max: sanitizeSnappedAxisNumber(intervalAlignedMax),
    interval: sanitizeSnappedAxisNumber(interval),
  };
}

function buildSingleValueRange(value: number, inverse: boolean): EventPanelYAxisConfig {
  const delta = Math.max(Math.abs(value) * 0.05, 1);
  const min = inverse ? Math.max(0, value - delta) : value - delta;
  return {
    inverse,
    min,
    max: value + delta,
  };
}

function sanitizeExtraMax(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(0.75, value));
}

export function selectPreferredAxisInterval(
  range: number,
  candidateIntervals: number[],
  targetTickCount: number,
  fallbackInterval: number
): number {
  const candidates = candidateIntervals
    .filter((candidate) => {
      if (!Number.isFinite(candidate) || candidate <= 0) {
        return false;
      }

      const remainder = range % candidate;
      return Math.abs(remainder) < AXIS_INTERVAL_DIVISIBILITY_EPSILON
        || Math.abs(remainder - candidate) < AXIS_INTERVAL_DIVISIBILITY_EPSILON;
    });
  if (!candidates.length) {
    return fallbackInterval;
  }

  let best = candidates[0];
  let bestDistance = Math.abs((range / best) - targetTickCount);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const distance = Math.abs((range / candidate) - targetTickCount);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function getValueExtrema(values: number[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { min, max };
}

function buildNiceAxisRange(min: number, max: number, targetTickCount: number): { min: number; max: number; interval: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return {
      min,
      max,
      interval: 1,
    };
  }

  const safeTargetTickCount = Number.isFinite(targetTickCount)
    ? Math.max(2, Math.round(targetTickCount))
    : DEFAULT_NON_PACE_TARGET_TICK_COUNT;
  const rawInterval = (max - min) / safeTargetTickCount;
  const interval = getNiceInterval(rawInterval);
  const snappedMin = Math.floor(min / interval) * interval;
  const snappedMax = Math.ceil(max / interval) * interval;

  return {
    min: sanitizeSnappedAxisNumber(snappedMin),
    max: sanitizeSnappedAxisNumber(Math.max(snappedMin + interval, snappedMax)),
    interval: sanitizeSnappedAxisNumber(interval),
  };
}

function getNiceInterval(rawInterval: number): number {
  if (!Number.isFinite(rawInterval) || rawInterval <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(rawInterval));
  const normalized = rawInterval / magnitude;

  for (let index = 0; index < NICE_INTERVAL_FACTORS.length; index += 1) {
    const factor = NICE_INTERVAL_FACTORS[index];
    if (normalized <= factor) {
      return factor * magnitude;
    }
  }

  return 10 * magnitude;
}

function sanitizeSnappedAxisNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  if (Object.is(value, -0)) {
    return 0;
  }

  return Number(value.toFixed(6));
}
