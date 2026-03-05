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
  const visibleExtrema = getVisibleExtrema(input.panel, input.visibleRange);
  const hasPaceStream = streamTypes.some((streamType) => isEventPaceStreamType(streamType));

  if (hasPaceStream) {
    return {
      ...buildDefaultAxis(visibleExtrema, false, input.extraMaxForPower, input.extraMaxForPace),
      inverse: true,
    };
  }

  const hasCadenceStream = streamTypes.some((streamType) => CADENCE_STREAM_TYPES.has(streamType));
  if (hasCadenceStream) {
    return buildStepBasedAxis(visibleExtrema, {
      baseStep: 5,
      candidateIntervals: [5, 10, 15, 20],
      targetTickCount: 6,
      minFloor: 0,
    });
  }

  const hasHeartRateStream = streamTypes.some((streamType) => HEART_RATE_STREAM_TYPES.has(streamType));
  if (hasHeartRateStream) {
    return buildStepBasedAxis(visibleExtrema, {
      baseStep: 10,
      candidateIntervals: [10, 15, 20, 25],
      targetTickCount: 5,
      minFloor: 0,
    });
  }

  const hasPowerStream = streamTypes.some((streamType) => POWER_STREAM_TYPES.has(streamType));
  return buildDefaultAxis(visibleExtrema, hasPowerStream, input.extraMaxForPower);
}

interface VisibleExtrema {
  min: number;
  max: number;
}

function getVisibleExtrema(panel: EventChartPanelModel, visibleRange: EventChartRange | null): VisibleExtrema | null {
  const normalizedRange = normalizeEventRange(visibleRange);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let foundValue = false;

  for (let seriesIndex = 0; seriesIndex < panel.series.length; seriesIndex += 1) {
    const points = panel.series[seriesIndex]?.points || [];
    if (!points.length) {
      continue;
    }

    const startIndex = normalizedRange
      ? findFirstPointAtOrAfter(points, normalizedRange.start)
      : 0;
    const endExclusive = normalizedRange
      ? findFirstPointAfter(points, normalizedRange.end)
      : points.length;

    for (let pointIndex = startIndex; pointIndex < endExclusive; pointIndex += 1) {
      const y = points[pointIndex]?.y;
      if (typeof y !== 'number' || !Number.isFinite(y)) {
        continue;
      }
      if (y < min) {
        min = y;
      }
      if (y > max) {
        max = y;
      }
      foundValue = true;
    }
  }

  if (!foundValue) {
    return null;
  }

  return { min, max };
}

function findFirstPointAtOrAfter(points: EventChartPanelModel['series'][number]['points'], xValue: number): number {
  let low = 0;
  let high = points.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].x < xValue) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function findFirstPointAfter(points: EventChartPanelModel['series'][number]['points'], xValue: number): number {
  let low = 0;
  let high = points.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].x <= xValue) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function buildDefaultAxis(
  extrema: VisibleExtrema | null,
  isPower: boolean,
  extraMaxForPower: number,
  extraMaxForNonPowerOverride = DEFAULT_NON_POWER_EXTRA_MAX
): EventPanelYAxisConfig {
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
    : sanitizeExtraMax(extraMaxForNonPowerOverride, DEFAULT_NON_POWER_EXTRA_MAX);
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
  extrema: VisibleExtrema | null,
  options: {
    baseStep: number;
    candidateIntervals: number[];
    targetTickCount: number;
    minFloor?: number;
  }
): EventPanelYAxisConfig {
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
