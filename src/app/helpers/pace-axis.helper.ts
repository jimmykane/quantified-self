import { XAxisTypes } from '@sports-alliance/sports-lib';
import { getCanonicalEventXAxisInterval } from './event-echarts-xaxis.helper';

const PACE_OUTLIER_MIN_SAMPLE_COUNT = 10;
const PACE_OUTLIER_LOWER_QUANTILE = 0.02;
const PACE_OUTLIER_UPPER_QUANTILE = 0.98;
const PACE_OUTLIER_TRIGGER_RATIO = 1.25;

export interface PaceAxisScalingResult {
  min: number | undefined;
  max: number | undefined;
  strictMinMax: boolean;
  extraMax: number;
}

/** Authored pace bounds are complete instructions, so none are treated as recorded-stream outliers. */
export function buildPaceAxisConfig(values: readonly number[]): {
  inverse: true; min: number; max: number; interval: number; tickValues: number[];
} {
  const finiteValues = values.filter(value => Number.isFinite(value) && value > 0);
  if (!finiteValues.length) return { inverse: true, min: 60, max: 120, interval: 15, tickValues: [60, 75, 90, 105, 120] };
  const minimum = Math.min(...finiteValues);
  const maximum = Math.max(...finiteValues);
  const span = maximum - minimum;
  const padding = span > 0 ? span * .02 : Math.max(1, minimum * .05);
  const lower = Math.max(minimum * .5, minimum - padding);
  const upper = maximum + padding;
  // Reuse Event Details' seconds/minutes intervals rather than decimal-number ticks such as 1,000 seconds.
  const canonicalInterval = getCanonicalEventXAxisInterval(XAxisTypes.Duration, { start: lower, end: upper }) ?? 1;
  const interval = canonicalInterval * Math.max(1, Math.ceil((upper - lower) / canonicalInterval / 8));
  const snappedMinimum = Math.floor(lower / interval) * interval;
  // A very broad authored range can snap below zero. Keep a positive, minute/second-aligned lower bound.
  const lowerInterval = Math.min(interval, 60);
  const positiveMinimum = Math.floor(lower / lowerInterval) * lowerInterval;
  const min = snappedMinimum > 0 ? snappedMinimum : positiveMinimum > 0 ? positiveMinimum : lower;
  const max = Math.ceil(upper / interval) * interval;
  // ECharts anchors an explicit interval at min. Use shared tick/label positions so a positive lower bound
  // does not offset every interior minute mark (e.g. 3, 13, 23 minutes instead of 3, 10, 20).
  const tickValues = [min];
  for (let tick = (Math.floor(min / interval) + 1) * interval; tick <= max; tick += interval) tickValues.push(tick);
  return { inverse: true, min, max, interval, tickValues };
}

export function computePaceAxisScaling(values: number[], extraMaxForPace: number): PaceAxisScalingResult {
  const resetAutoRange = (): PaceAxisScalingResult => ({
    min: undefined,
    max: undefined,
    strictMinMax: false,
    extraMax: extraMaxForPace
  });

  if (values.length < PACE_OUTLIER_MIN_SAMPLE_COUNT) {
    return resetAutoRange();
  }

  const sortedValues = values.slice().sort((left, right) => left - right);
  const rawMin = sortedValues[0];
  const rawMax = sortedValues[sortedValues.length - 1];
  const clippedMin = getQuantile(sortedValues, PACE_OUTLIER_LOWER_QUANTILE);
  const clippedMax = getQuantile(sortedValues, PACE_OUTLIER_UPPER_QUANTILE);

  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || !Number.isFinite(clippedMin) || !Number.isFinite(clippedMax)) {
    return resetAutoRange();
  }

  const rawSpan = rawMax - rawMin;
  const clippedSpan = clippedMax - clippedMin;
  if (rawSpan <= 0 || clippedSpan <= 0 || (rawSpan / clippedSpan) < PACE_OUTLIER_TRIGGER_RATIO) {
    return resetAutoRange();
  }

  const extraMaxRatio = Number.isFinite(extraMaxForPace) ? Math.max(0, Math.min(0.5, extraMaxForPace)) : 0;
  const paddedMin = Math.max(1, clippedMin - (clippedSpan * 0.05));
  const paddedMax = clippedMax + (clippedSpan * extraMaxRatio);
  if (paddedMax <= paddedMin) {
    return resetAutoRange();
  }

  return {
    min: paddedMin,
    max: paddedMax,
    strictMinMax: true,
    extraMax: 0
  };
}

function getQuantile(sortedValues: number[], quantile: number): number {
  if (!sortedValues.length) {
    return NaN;
  }
  const boundedQuantile = Math.min(1, Math.max(0, quantile));
  const position = (sortedValues.length - 1) * boundedQuantile;
  const baseIndex = Math.floor(position);
  const remainder = position - baseIndex;
  if (baseIndex >= sortedValues.length - 1) {
    return sortedValues[sortedValues.length - 1];
  }
  return sortedValues[baseIndex] + (sortedValues[baseIndex + 1] - sortedValues[baseIndex]) * remainder;
}
