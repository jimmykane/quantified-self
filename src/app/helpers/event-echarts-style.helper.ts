import {
  DataAbsolutePressure,
  DataAirPower,
  DataAltitude,
  DataAerobicTrainingEffect,
  DataAnaerobicTrainingEffect,
  DataAscent,
  DataCadence,
  DataCadenceAvg,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEPOC,
  DataEffortPaceAvg,
  DataEffortPaceMax,
  DataEffortPaceMin,
  DataEHPE,
  DataEffortPace,
  DataEffortPaceAvgMinutesPerMile,
  DataEffortPaceMaxMinutesPerMile,
  DataEffortPaceMinMinutesPerMile,
  DataEffortPaceMinutesPerMile,
  DataEnergy,
  DataEVPE,
  DataGPSAltitude,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedPaceMax,
  DataGradeAdjustedPaceMin,
  DataGradeAdjustedPace,
  DataGradeAdjustedPaceMinutesPerMile,
  DataGradeAdjustedSpeed,
  DataGradeAdjustedSpeedFeetPerMinute,
  DataGradeAdjustedSpeedFeetPerSecond,
  DataGradeAdjustedSpeedKilometersPerHour,
  DataGradeAdjustedSpeedKnots,
  DataGradeAdjustedSpeedMetersPerMinute,
  DataGradeAdjustedSpeedMilesPerHour,
  DataHeartRateAvg,
  DataLeftBalance,
  DataPace,
  DataPaceAvg,
  DataPaceMax,
  DataPaceMin,
  DataPaceMinutesPerMile,
  DataPowerAvg,
  DataPowerIntensityFactor,
  DataPowerNormalized,
  DataPowerTrainingStressScore,
  DataPowerWork,
  DataPower,
  DataPowerLeft,
  DataPowerRight,
  DataRecoveryTime,
  DataRightBalance,
  DataSeaLevelPressure,
  DataSpeed,
  DataSpeedAvg,
  DataSpeedFeetPerMinute,
  DataSpeedFeetPerSecond,
  DataSpeedKilometersPerHour,
  DataSpeedKnots,
  DataSpeedMetersPerMinute,
  DataSpeedMilesPerHour,
  DataStrydAltitude,
  DataStrydDistance,
  DataStrydSpeed,
  DataSwimPaceAvg,
  DataSwimPaceMax,
  DataSwimPaceMin,
  DataSwimPace,
  DataSwimPaceMaxMinutesPer100Yard,
  DataSwimPaceMinutesPer100Yard,
  DataVO2Max,
  DataAvgVAM,
  DataVerticalSpeed,
  DataVerticalSpeedFeetPerHour,
  DataVerticalSpeedFeetPerMinute,
  DataVerticalSpeedFeetPerSecond,
  DataVerticalSpeedKilometerPerHour,
  DataVerticalSpeedMetersPerHour,
  DataVerticalSpeedMetersPerMinute,
  DataVerticalSpeedMilesPerHour
} from '@sports-alliance/sports-lib';
import { isInverseMetric } from '@shared/metric-semantics';
import { AppColors } from '../services/color/app.colors';
import { AppDataColors } from '../services/color/app.data.colors';

const ALTITUDE_GROUP = new Set<string>([
  DataAltitude.type,
  DataGPSAltitude.type,
  DataStrydAltitude.type,
]);

const POSITIONAL_ERROR_GROUP = new Set<string>([
  DataEHPE.type,
  DataEVPE.type,
]);

const PRESSURE_GROUP = new Set<string>([
  DataAbsolutePressure.type,
  DataSeaLevelPressure.type,
]);

const PACE_GROUP = new Set<string>([
  DataPace.type,
  DataPaceMinutesPerMile.type,
  DataEffortPace.type,
  DataEffortPaceMinutesPerMile.type,
  DataEffortPaceAvg.type,
  DataEffortPaceAvgMinutesPerMile.type,
  DataEffortPaceMin.type,
  DataEffortPaceMinMinutesPerMile.type,
  DataEffortPaceMax.type,
  DataEffortPaceMaxMinutesPerMile.type,
  DataGradeAdjustedPace.type,
  DataGradeAdjustedPaceMinutesPerMile.type,
]);

const SWIM_PACE_GROUP = new Set<string>([
  DataSwimPace.type,
  DataSwimPaceMinutesPer100Yard.type,
  DataSwimPaceMaxMinutesPer100Yard.type,
]);

const SPEED_GROUP = new Set<string>([
  DataSpeed.type,
  DataStrydSpeed.type,
  DataSpeedMetersPerMinute.type,
  DataSpeedFeetPerMinute.type,
  DataSpeedFeetPerSecond.type,
  DataSpeedMilesPerHour.type,
  DataSpeedKilometersPerHour.type,
  DataSpeedKnots.type,
  DataGradeAdjustedSpeed.type,
  DataGradeAdjustedSpeedMetersPerMinute.type,
  DataGradeAdjustedSpeedFeetPerMinute.type,
  DataGradeAdjustedSpeedFeetPerSecond.type,
  DataGradeAdjustedSpeedMilesPerHour.type,
  DataGradeAdjustedSpeedKilometersPerHour.type,
  DataGradeAdjustedSpeedKnots.type,
]);

const VERTICAL_SPEED_GROUP = new Set<string>([
  DataVerticalSpeed.type,
  DataVerticalSpeedFeetPerSecond.type,
  DataVerticalSpeedMetersPerMinute.type,
  DataVerticalSpeedFeetPerMinute.type,
  DataVerticalSpeedMetersPerHour.type,
  DataVerticalSpeedFeetPerHour.type,
  DataVerticalSpeedKilometerPerHour.type,
  DataVerticalSpeedMilesPerHour.type,
]);

const POWER_GROUP = new Set<string>([
  DataPower.type,
  DataAirPower.type,
  DataPowerRight.type,
  DataPowerLeft.type,
]);

const BALANCE_GROUP = new Set<string>([
  DataLeftBalance.type,
  DataRightBalance.type,
]);

const DISTANCE_GROUP = new Set<string>([
  DataDistance.type,
  DataStrydDistance.type,
]);

const CADENCE_GROUP = new Set<string>([
  DataCadence.type,
]);

const FALLBACK_COLORS: string[] = [
  AppColors.Blue,
  AppColors.Orange,
  AppColors.Green,
  AppColors.Red,
  AppColors.Purple,
  AppColors.LightBlue,
  AppColors.Pink,
  AppColors.Yellow,
  AppColors.DeepBlue,
];
const CONTRAST_VARIANT_PALETTE: string[] = [
  AppColors.Blue,
  AppColors.Orange,
  AppColors.StrongRed,
  AppColors.Green,
  AppColors.Purple,
  AppColors.DeepBlue,
  AppColors.Yellow,
  AppColors.Pink,
];
const MIN_COMPARE_COLOR_DISTANCE = 200;

export function resolveEventColorGroupKey(streamType: string): string {
  if (ALTITUDE_GROUP.has(streamType)) {
    return DataAltitude.type;
  }
  if (POSITIONAL_ERROR_GROUP.has(streamType)) {
    return 'Positional Error';
  }
  if (PRESSURE_GROUP.has(streamType)) {
    return 'Pressure';
  }
  if (PACE_GROUP.has(streamType)) {
    return 'Pace';
  }
  if (SWIM_PACE_GROUP.has(streamType)) {
    return 'Swim Pace';
  }
  if (SPEED_GROUP.has(streamType)) {
    return 'Speed';
  }
  if (VERTICAL_SPEED_GROUP.has(streamType)) {
    return 'Vertical Speed';
  }
  if (POWER_GROUP.has(streamType)) {
    return 'Power';
  }
  if (BALANCE_GROUP.has(streamType)) {
    return 'Left/Right Balance';
  }
  if (DISTANCE_GROUP.has(streamType)) {
    return 'Distance';
  }
  if (CADENCE_GROUP.has(streamType)) {
    return DataCadence.type;
  }
  return streamType;
}

const AI_METRIC_COLOR_GROUP_KEYS: Readonly<Record<string, string>> = {
  [DataDistance.type]: 'Distance',
  [DataDuration.type]: 'Duration',
  [DataAscent.type]: DataAltitude.type,
  [DataDescent.type]: DataAltitude.type,
  [DataEnergy.type]: 'Energy',
  [DataCadenceAvg.type]: DataCadence.type,
  [DataPowerAvg.type]: 'Power',
  [DataPowerNormalized.type]: 'Power',
  [DataPowerIntensityFactor.type]: 'Power',
  [DataPowerTrainingStressScore.type]: 'Power',
  [DataPowerWork.type]: 'Power',
  [DataHeartRateAvg.type]: 'Heart Rate',
  [DataSpeedAvg.type]: 'Speed',
  [DataPaceAvg.type]: 'Pace',
  [DataPaceMin.type]: 'Pace',
  [DataPaceMax.type]: 'Pace',
  [DataGradeAdjustedPaceAvg.type]: 'Pace',
  [DataGradeAdjustedPaceMin.type]: 'Pace',
  [DataGradeAdjustedPaceMax.type]: 'Pace',
  [DataEffortPaceAvg.type]: 'Pace',
  [DataEffortPaceMin.type]: 'Pace',
  [DataEffortPaceMax.type]: 'Pace',
  [DataSwimPaceAvg.type]: 'Swim Pace',
  [DataSwimPaceMin.type]: 'Swim Pace',
  [DataSwimPaceMax.type]: 'Swim Pace',
  [DataAvgVAM.type]: 'Vertical Speed',
  [DataVO2Max.type]: 'VO2 Max',
  [DataEPOC.type]: 'EPOC',
  [DataAerobicTrainingEffect.type]: 'Training Effect',
  [DataAnaerobicTrainingEffect.type]: 'Training Effect',
  [DataRecoveryTime.type]: 'Recovery Time',
};

export function resolveMetricColorGroupKey(metricType: string): string {
  return AI_METRIC_COLOR_GROUP_KEYS[metricType] ?? resolveEventColorGroupKey(metricType);
}

export function isEventPaceStreamType(streamType: string): boolean {
  return isInverseMetric(streamType);
}

export function resolveEventSeriesColor(groupKey: string, seriesIndex: number, seriesCount: number): string {
  const colorMap = AppDataColors as unknown as Record<string, string>;
  const normalizedIndex = Number.isFinite(seriesIndex) ? Math.max(0, Math.floor(seriesIndex)) : 0;
  const normalizedCount = Number.isFinite(seriesCount) ? Math.max(1, Math.floor(seriesCount)) : 1;
  const baseColor = colorMap[groupKey] || resolveFallbackColor(groupKey);
  const baseSeriesColor = colorMap[`${groupKey}_0`] || baseColor;

  if (normalizedCount === 2) {
    if (normalizedIndex === 0) {
      return baseSeriesColor;
    }

    const explicitCompareVariant = colorMap[`${groupKey}_1`];
    return resolveCompareSeriesColor(baseSeriesColor, explicitCompareVariant);
  }

  if (normalizedCount > 1) {
    const explicitVariant = colorMap[`${groupKey}_${normalizedIndex}`];
    if (explicitVariant) {
      return explicitVariant;
    }
  }

  if (normalizedCount <= 1) {
    return baseColor;
  }
  if (normalizedIndex === 0) {
    return baseSeriesColor;
  }
  return resolveFallbackVariantColor(groupKey, normalizedIndex, baseSeriesColor);
}

function resolveFallbackColor(groupKey: string): string {
  const hash = hashString(`${groupKey || 'unknown'}`);
  const colorIndex = Math.abs(hash) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[colorIndex];
}

function resolveFallbackVariantColor(groupKey: string, seriesIndex: number, baseColor: string): string {
  const initialIndex = Math.abs(hashString(`${groupKey || 'unknown'}:${seriesIndex}`)) % FALLBACK_COLORS.length;
  for (let offset = 0; offset < FALLBACK_COLORS.length; offset += 1) {
    const candidate = FALLBACK_COLORS[(initialIndex + offset) % FALLBACK_COLORS.length];
    if (!isSameColor(candidate, baseColor)) {
      return candidate;
    }
  }
  return baseColor;
}

function isSameColor(left: string, right: string): boolean {
  return `${left || ''}`.trim().toLowerCase() === `${right || ''}`.trim().toLowerCase();
}

function resolveCompareSeriesColor(baseColor: string, explicitVariant: string | undefined): string {
  if (explicitVariant && computeColorDistance(baseColor, explicitVariant) >= MIN_COMPARE_COLOR_DISTANCE) {
    return explicitVariant;
  }

  let bestCandidate = explicitVariant && !isSameColor(explicitVariant, baseColor)
    ? explicitVariant
    : null;
  let bestDistance = bestCandidate ? computeColorDistance(baseColor, bestCandidate) : -1;

  for (let index = 0; index < CONTRAST_VARIANT_PALETTE.length; index += 1) {
    const candidate = CONTRAST_VARIANT_PALETTE[index];
    if (isSameColor(candidate, baseColor)) {
      continue;
    }

    const candidateDistance = computeColorDistance(baseColor, candidate);
    if (candidateDistance > bestDistance) {
      bestCandidate = candidate;
      bestDistance = candidateDistance;
    }
  }

  return bestCandidate || explicitVariant || baseColor;
}

function computeColorDistance(left: string, right: string): number {
  const leftRgb = parseColor(left);
  const rightRgb = parseColor(right);
  if (!leftRgb || !rightRgb) {
    return isSameColor(left, right) ? 0 : Number.POSITIVE_INFINITY;
  }

  const redDelta = leftRgb.r - rightRgb.r;
  const greenDelta = leftRgb.g - rightRgb.g;
  const blueDelta = leftRgb.b - rightRgb.b;
  return Math.sqrt((redDelta ** 2) + (greenDelta ** 2) + (blueDelta ** 2));
}

function parseColor(value: string): { r: number; g: number; b: number } | null {
  const normalized = `${value || ''}`.trim().toLowerCase();
  const hexMatch = normalized.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  const rgbMatch = normalized.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgbMatch) {
    return {
      r: Number.parseInt(rgbMatch[1], 10),
      g: Number.parseInt(rgbMatch[2], 10),
      b: Number.parseInt(rgbMatch[3], 10),
    };
  }

  return null;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}
