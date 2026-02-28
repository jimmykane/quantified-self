import {
  DataAbsolutePressure,
  DataAirPower,
  DataAltitude,
  DataCadence,
  DataDistance,
  DataEHPE,
  DataEffortPace,
  DataEffortPaceAvg,
  DataEffortPaceAvgMinutesPerMile,
  DataEffortPaceMax,
  DataEffortPaceMaxMinutesPerMile,
  DataEffortPaceMin,
  DataEffortPaceMinMinutesPerMile,
  DataEffortPaceMinutesPerMile,
  DataEVPE,
  DataGPSAltitude,
  DataGradeAdjustedPace,
  DataGradeAdjustedPaceMinutesPerMile,
  DataGradeAdjustedSpeed,
  DataGradeAdjustedSpeedFeetPerMinute,
  DataGradeAdjustedSpeedFeetPerSecond,
  DataGradeAdjustedSpeedKilometersPerHour,
  DataGradeAdjustedSpeedKnots,
  DataGradeAdjustedSpeedMetersPerMinute,
  DataGradeAdjustedSpeedMilesPerHour,
  DataLeftBalance,
  DataPace,
  DataPaceMinutesPerMile,
  DataPower,
  DataPowerLeft,
  DataPowerRight,
  DataRightBalance,
  DataSeaLevelPressure,
  DataSpeed,
  DataSpeedFeetPerMinute,
  DataSpeedFeetPerSecond,
  DataSpeedKilometersPerHour,
  DataSpeedKnots,
  DataSpeedMetersPerMinute,
  DataSpeedMilesPerHour,
  DataStrydAltitude,
  DataStrydDistance,
  DataStrydSpeed,
  DataSwimPace,
  DataSwimPaceMaxMinutesPer100Yard,
  DataSwimPaceMinutesPer100Yard,
  DataVerticalSpeed,
  DataVerticalSpeedFeetPerHour,
  DataVerticalSpeedFeetPerMinute,
  DataVerticalSpeedFeetPerSecond,
  DataVerticalSpeedKilometerPerHour,
  DataVerticalSpeedMetersPerHour,
  DataVerticalSpeedMetersPerMinute,
  DataVerticalSpeedMilesPerHour
} from '@sports-alliance/sports-lib';
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

export function isEventPaceStreamType(streamType: string): boolean {
  return PACE_GROUP.has(streamType) || SWIM_PACE_GROUP.has(streamType);
}

export function resolveEventSeriesColor(groupKey: string, seriesIndex: number, seriesCount: number): string {
  const colorMap = AppDataColors as unknown as Record<string, string>;
  const normalizedIndex = Number.isFinite(seriesIndex) ? Math.max(0, Math.floor(seriesIndex)) : 0;
  const normalizedCount = Number.isFinite(seriesCount) ? Math.max(1, Math.floor(seriesCount)) : 1;

  if (normalizedCount > 1) {
    const explicitVariant = colorMap[`${groupKey}_${normalizedIndex}`];
    if (explicitVariant) {
      return explicitVariant;
    }
  }

  const baseColor = colorMap[groupKey] || resolveFallbackColor(groupKey);
  if (normalizedCount <= 1) {
    return baseColor;
  }
  if (normalizedIndex === 0) {
    return baseColor;
  }
  return resolveFallbackVariantColor(groupKey, normalizedIndex, baseColor);
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

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}
