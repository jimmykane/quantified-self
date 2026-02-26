import {
  DataAirPower,
  DataGradeAdjustedPace,
  DataGradeAdjustedPaceMinutesPerMile,
  DataPace,
  DataPaceMinutesPerMile,
  DataPower,
  DataPowerLeft,
  DataPowerRight,
  DataSwimPace,
  DataSwimPaceMaxMinutesPer100Yard,
  DataSwimPaceMinutesPer100Yard,
} from '@sports-alliance/sports-lib';
import { EventChartPanelModel } from './event-echarts-data.helper';
import { EventChartRange, normalizeEventRange } from './event-echarts-xaxis.helper';
import { computePaceAxisScaling } from './pace-axis.helper';

const DEFAULT_NON_POWER_EXTRA_MAX = 0.1;

const PACE_STREAM_TYPES = new Set<string>([
  DataPace.type,
  DataPaceMinutesPerMile.type,
  DataGradeAdjustedPace.type,
  DataGradeAdjustedPaceMinutesPerMile.type,
  DataSwimPace.type,
  DataSwimPaceMinutesPer100Yard.type,
  DataSwimPaceMaxMinutesPer100Yard.type,
]);

const POWER_STREAM_TYPES = new Set<string>([
  DataPower.type,
  DataAirPower.type,
  DataPowerRight.type,
  DataPowerLeft.type,
]);

export interface EventPanelYAxisConfig {
  inverse: boolean;
  min?: number;
  max?: number;
}

export interface BuildEventPanelYAxisConfigInput {
  panel: EventChartPanelModel;
  visibleRange: EventChartRange | null;
  extraMaxForPower: number;
  extraMaxForPace: number;
}

export function buildEventPanelYAxisConfig(input: BuildEventPanelYAxisConfigInput): EventPanelYAxisConfig {
  const streamTypes = input.panel.series.map((series) => series.streamType || '');
  const hasPaceStream = streamTypes.some((streamType) => PACE_STREAM_TYPES.has(streamType));
  const values = getVisibleValues(input.panel, input.visibleRange);

  if (hasPaceStream) {
    return buildPaceAxis(values, input.extraMaxForPace);
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
    .map((point) => Number(point.y))
    .filter((value) => Number.isFinite(value));
}

function buildPaceAxis(values: number[], extraMaxForPace: number): EventPanelYAxisConfig {
  const positiveValues = values.filter((value) => value > 0);
  if (!positiveValues.length) {
    return { inverse: true };
  }

  if (positiveValues.length === 1) {
    return buildSingleValueRange(positiveValues[0], true);
  }

  const paceScaling = computePaceAxisScaling(positiveValues, extraMaxForPace);
  if (Number.isFinite(paceScaling.min) && Number.isFinite(paceScaling.max) && (paceScaling.max as number) > (paceScaling.min as number)) {
    return {
      inverse: true,
      min: paceScaling.min,
      max: paceScaling.max,
    };
  }

  const min = Math.min(...positiveValues);
  const max = Math.max(...positiveValues);
  if (max <= min) {
    return buildSingleValueRange(min, true);
  }

  return {
    inverse: true,
    min,
    max,
  };
}

function buildDefaultAxis(values: number[], isPower: boolean, extraMaxForPower: number): EventPanelYAxisConfig {
  if (!values.length) {
    return { inverse: false };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
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

  return {
    inverse: false,
    min: paddedMin,
    max: paddedMax > paddedMin ? paddedMax : (paddedMin + Math.max(1, span * 0.1)),
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
