import { describe, expect, it } from 'vitest';
import {
  DataDuration,
  DataHeartRateMax,
  DataPaceAvg,
  DataSpeedAvg,
  DaysOfTheWeek,
  PaceUnits,
  SpeedUnits,
  SwimPaceUnits,
  VerticalSpeedUnits,
} from '@sports-alliance/sports-lib';
import {
  formatUnitAwareDataValue,
  getDefaultUserUnitSettings,
  normalizeUserUnitSettings,
  resolveUnitAwareDisplayFromValue,
} from '@shared/unit-aware-display';

describe('unit-aware-display', () => {
  it('should provide the current default user unit settings', () => {
    expect(getDefaultUserUnitSettings()).toEqual({
      speedUnits: [SpeedUnits.KilometersPerHour],
      gradeAdjustedSpeedUnits: ['Grade Adjusted Speed in kilometers per hour'],
      paceUnits: [PaceUnits.MinutesPerKilometer],
      gradeAdjustedPaceUnits: ['Grade Adjusted Pace'],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
      verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond],
      startOfTheWeek: DaysOfTheWeek.Monday,
    });
  });

  it('should normalize missing and malformed unit settings with defaults and derived grade-adjusted units', () => {
    expect(normalizeUserUnitSettings({
      speedUnits: ['not-a-real-unit'],
      paceUnits: [PaceUnits.MinutesPerMile],
      gradeAdjustedPaceUnits: ['bad-value'],
      swimPaceUnits: [],
      verticalSpeedUnits: ['still-bad'],
      startOfTheWeek: 999,
    })).toEqual({
      speedUnits: [SpeedUnits.KilometersPerHour],
      gradeAdjustedSpeedUnits: ['Grade Adjusted Speed in kilometers per hour'],
      paceUnits: [PaceUnits.MinutesPerMile],
      gradeAdjustedPaceUnits: ['Grade Adjusted Pace in minutes per mile'],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
      verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond],
      startOfTheWeek: DaysOfTheWeek.Monday,
    });
  });

  it('should format pace values using the preferred pace units', () => {
    const unitSettings = normalizeUserUnitSettings({
      paceUnits: [PaceUnits.MinutesPerMile],
      speedUnits: [SpeedUnits.MilesPerHour],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
      verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond],
      startOfTheWeek: DaysOfTheWeek.Monday,
    });

    expect(resolveUnitAwareDisplayFromValue(DataPaceAvg.type, 300, unitSettings, {
      stripRepeatedUnit: true,
    })).toEqual({
      type: 'Average pace in minutes per mile',
      value: '08:02',
      unit: 'min/m',
      text: '08:02 min/m',
    });
  });

  it('should format speed values using the preferred speed units', () => {
    const unitSettings = normalizeUserUnitSettings({
      paceUnits: [PaceUnits.MinutesPerMile],
      speedUnits: [SpeedUnits.MilesPerHour],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
      verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond],
      startOfTheWeek: DaysOfTheWeek.Monday,
    });

    expect(formatUnitAwareDataValue(DataSpeedAvg.type, 10, unitSettings, {
      stripRepeatedUnit: true,
    })).toBe('22.37 mph');
  });

  it('should keep stable-unit metrics readable', () => {
    const unitSettings = getDefaultUserUnitSettings();

    expect(formatUnitAwareDataValue(DataHeartRateMax.type, 182, unitSettings, {
      stripRepeatedUnit: true,
    })).toBe('182 bpm');
  });

  it('should keep long durations in day-based display format', () => {
    const unitSettings = getDefaultUserUnitSettings();

    expect(formatUnitAwareDataValue(DataDuration.type, (24 * 60 * 60) + (2 * 60 * 60) + (15 * 60), unitSettings, {
      stripRepeatedUnit: true,
    })).toBe('1d 02h 15m');
  });
});
