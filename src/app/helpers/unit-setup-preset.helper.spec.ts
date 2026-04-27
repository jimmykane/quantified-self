import { describe, expect, it } from 'vitest';
import {
  buildUnitSettingsForUnitSetupPreset,
  resolveStartOfTheWeekForUnitSetup,
  resolveSuggestedUnitSetupPreset,
  shouldShowUnitSetupPrompt,
} from './unit-setup-preset.helper';
import {
  DaysOfTheWeek,
  DistanceUnits,
  GradeAdjustedPaceUnits,
  GradeAdjustedSpeedUnits,
  PaceUnits,
  SpeedUnits,
  SwimPaceUnits,
  VerticalSpeedUnits,
} from '@sports-alliance/sports-lib';

describe('unit setup preset helper', () => {
  it('suggests miles for mile-distance locales', () => {
    expect(resolveSuggestedUnitSetupPreset('en-US')).toBe('miles');
    expect(resolveSuggestedUnitSetupPreset('en-GB')).toBe('miles');
    expect(resolveSuggestedUnitSetupPreset('en-LR')).toBe('miles');
    expect(resolveSuggestedUnitSetupPreset('my-MM')).toBe('miles');
  });

  it('suggests kilometers for other locales and malformed values', () => {
    expect(resolveSuggestedUnitSetupPreset('fi-FI')).toBe('kilometers');
    expect(resolveSuggestedUnitSetupPreset('fr-FR')).toBe('kilometers');
    expect(resolveSuggestedUnitSetupPreset('not a locale')).toBe('kilometers');
    expect(resolveSuggestedUnitSetupPreset(null)).toBe('kilometers');
  });

  it('resolves week start from locale when available', () => {
    expect(resolveStartOfTheWeekForUnitSetup('en-US')).toBe(DaysOfTheWeek.Sunday);
    expect(resolveStartOfTheWeekForUnitSetup('en-GB')).toBe(DaysOfTheWeek.Monday);
    expect(resolveStartOfTheWeekForUnitSetup('fa-AF')).toBe(6);
  });

  it('falls back to Sunday for US-like locales and Monday otherwise', () => {
    expect(resolveStartOfTheWeekForUnitSetup('bad-US')).toBe(DaysOfTheWeek.Sunday);
    expect(resolveStartOfTheWeekForUnitSetup('bad-FI')).toBe(DaysOfTheWeek.Monday);
    expect(resolveStartOfTheWeekForUnitSetup(null)).toBe(DaysOfTheWeek.Monday);
  });

  it('builds the kilometers preset', () => {
    expect(buildUnitSettingsForUnitSetupPreset('kilometers', 'fi-FI')).toEqual({
      speedUnits: [SpeedUnits.KilometersPerHour],
      gradeAdjustedSpeedUnits: [GradeAdjustedSpeedUnits.KilometersPerHour],
      paceUnits: [PaceUnits.MinutesPerKilometer],
      gradeAdjustedPaceUnits: [GradeAdjustedPaceUnits.MinutesPerKilometer],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
      verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond],
      distanceUnits: DistanceUnits.Kilometers,
      startOfTheWeek: DaysOfTheWeek.Monday,
    });
  });

  it('builds the miles preset', () => {
    expect(buildUnitSettingsForUnitSetupPreset('miles', 'en-US')).toEqual({
      speedUnits: [SpeedUnits.MilesPerHour],
      gradeAdjustedSpeedUnits: [GradeAdjustedSpeedUnits.MilesPerHour],
      paceUnits: [PaceUnits.MinutesPerMile],
      gradeAdjustedPaceUnits: [GradeAdjustedPaceUnits.MinutesPerMile],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
      verticalSpeedUnits: [VerticalSpeedUnits.FeetPerSecond],
      distanceUnits: DistanceUnits.Miles,
      startOfTheWeek: DaysOfTheWeek.Sunday,
    });
  });

  it('shows the prompt only for owner dashboards with explicit incomplete setup', () => {
    const user = {
      uid: 'user-1',
      settings: {
        appSettings: {
          unitSetupCompleted: false,
        },
      },
    } as any;

    expect(shouldShowUnitSetupPrompt(user, null)).toBe(true);
    expect(shouldShowUnitSetupPrompt(user, { uid: 'user-1' } as any)).toBe(true);
    expect(shouldShowUnitSetupPrompt(user, { uid: 'user-2' } as any)).toBe(false);
  });

  it('does not prompt legacy users missing the marker', () => {
    expect(shouldShowUnitSetupPrompt({ uid: 'legacy', settings: { appSettings: {} } } as any, null)).toBe(false);
    expect(shouldShowUnitSetupPrompt({ uid: 'legacy', settings: {} } as any, null)).toBe(false);
  });
});
