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
