import {
  DataAirPower,
  DataCadence,
  DataGradeAdjustedPace,
  DataGradeAdjustedPaceMinutesPerMile,
  DataGradeAdjustedSpeed,
  DataGradeAdjustedSpeedFeetPerMinute,
  DataGradeAdjustedSpeedFeetPerSecond,
  DataGradeAdjustedSpeedKilometersPerHour,
  DataGradeAdjustedSpeedKnots,
  DataGradeAdjustedSpeedMetersPerMinute,
  DataGradeAdjustedSpeedMilesPerHour,
  DataHeartRate,
  DataPace,
  DataPaceMinutesPerMile,
  DataPower,
  DataPowerLeft,
  DataPowerRight,
  DataSpeed,
  DataSpeedFeetPerMinute,
  DataSpeedFeetPerSecond,
  DataSpeedKilometersPerHour,
  DataSpeedKnots,
  DataSpeedMetersPerMinute,
  DataSpeedMilesPerHour,
  DataStrydSpeed,
  DataSwimPace,
  DataSwimPaceMaxMinutesPer100Yard,
  DataSwimPaceMinutesPer100Yard,
} from '@sports-alliance/sports-lib';

const HEART_RATE_GROUP = new Set<string>([
  DataHeartRate.type,
]);

const PRIMARY_PACE_GROUP = new Set<string>([
  DataPace.type,
  DataPaceMinutesPerMile.type,
]);

const GRADE_ADJUSTED_PACE_GROUP = new Set<string>([
  DataGradeAdjustedPace.type,
  DataGradeAdjustedPaceMinutesPerMile.type,
]);

const SWIM_PACE_GROUP = new Set<string>([
  DataSwimPace.type,
  DataSwimPaceMinutesPer100Yard.type,
  DataSwimPaceMaxMinutesPer100Yard.type,
]);

const PRIMARY_SPEED_GROUP = new Set<string>([
  DataSpeed.type,
  DataStrydSpeed.type,
  DataSpeedMetersPerMinute.type,
  DataSpeedFeetPerMinute.type,
  DataSpeedFeetPerSecond.type,
  DataSpeedMilesPerHour.type,
  DataSpeedKilometersPerHour.type,
  DataSpeedKnots.type,
]);

const GRADE_ADJUSTED_SPEED_GROUP = new Set<string>([
  DataGradeAdjustedSpeed.type,
  DataGradeAdjustedSpeedMetersPerMinute.type,
  DataGradeAdjustedSpeedFeetPerMinute.type,
  DataGradeAdjustedSpeedFeetPerSecond.type,
  DataGradeAdjustedSpeedMilesPerHour.type,
  DataGradeAdjustedSpeedKilometersPerHour.type,
  DataGradeAdjustedSpeedKnots.type,
]);

const POWER_GROUP = new Set<string>([
  DataPower.type,
  DataAirPower.type,
  DataPowerRight.type,
  DataPowerLeft.type,
]);

const CADENCE_GROUP = new Set<string>([
  DataCadence.type,
]);

const PRIORITY_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  HEART_RATE_GROUP,
  PRIMARY_PACE_GROUP,
  GRADE_ADJUSTED_PACE_GROUP,
  SWIM_PACE_GROUP,
  PRIMARY_SPEED_GROUP,
  GRADE_ADJUSTED_SPEED_GROUP,
  POWER_GROUP,
  CADENCE_GROUP,
];

export function applyEventChartCanonicalOrderOverride(dataTypes: string[]): string[] {
  const orderedDataTypes = Array.isArray(dataTypes)
    ? dataTypes.filter((dataType): dataType is string => typeof dataType === 'string' && dataType.length > 0)
    : [];

  if (orderedDataTypes.length <= 1) {
    return orderedDataTypes;
  }

  const remaining = orderedDataTypes.slice();
  const prioritized: string[] = [];

  PRIORITY_GROUPS.forEach((group) => {
    for (let index = 0; index < remaining.length; index += 1) {
      const dataType = remaining[index];
      if (!group.has(dataType)) {
        continue;
      }
      prioritized.push(dataType);
      remaining.splice(index, 1);
      index -= 1;
    }
  });

  return prioritized.concat(remaining);
}
