import {
  DataAbsolutePressure,
  DataAirPower,
  DataAltitude,
  DataDistance,
  DataEHPE,
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
  return streamType;
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

  const spread = (normalizedIndex / Math.max(1, normalizedCount - 1)) - 0.5;
  return tintHexColor(baseColor, spread * 0.34);
}

function resolveFallbackColor(groupKey: string): string {
  const key = `${groupKey || 'unknown'}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(index);
    hash |= 0;
  }
  const colorIndex = Math.abs(hash) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[colorIndex];
}

function tintHexColor(color: string, factor: number): string {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return color;
  }

  const boundedFactor = Math.max(-1, Math.min(1, factor));
  const target = boundedFactor >= 0 ? 255 : 0;
  const amount = Math.abs(boundedFactor);

  const tinted = rgb.map((channel) => Math.round(channel + ((target - channel) * amount)));
  return toHexColor(tinted[0], tinted[1], tinted[2]);
}

function parseHexColor(color: string): [number, number, number] | null {
  const normalized = `${color || ''}`.trim();
  if (!normalized.startsWith('#')) {
    return null;
  }

  const hex = normalized.slice(1);
  const expanded = hex.length === 3
    ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return null;
  }

  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function toHexColor(red: number, green: number, blue: number): string {
  const channels = [red, green, blue]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))))
    .map((channel) => channel.toString(16).padStart(2, '0'));
  return `#${channels.join('')}`;
}
