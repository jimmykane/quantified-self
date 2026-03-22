import { describe, expect, it, vi } from 'vitest';
import {
  DaysOfTheWeek,
  PaceUnits,
  SpeedUnits,
  SwimPaceUnits,
  VerticalSpeedUnits,
} from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

import {
  createLoadUserUnitSettings,
} from './user-unit-settings';

describe('loadUserUnitSettings', () => {
  it('loads unit settings from config/settings data and normalizes them', async () => {
    const { loadUserUnitSettings } = createLoadUserUnitSettings({
      getSettingsData: async () => ({
        unitSettings: {
          speedUnits: [SpeedUnits.MilesPerHour],
          paceUnits: [PaceUnits.MinutesPerMile],
          swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
          verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond],
          startOfTheWeek: DaysOfTheWeek.Monday,
        },
      }),
    });

    await expect(loadUserUnitSettings('user-1')).resolves.toEqual({
      speedUnits: [SpeedUnits.MilesPerHour],
      gradeAdjustedSpeedUnits: ['Grade Adjusted Speed in miles per hour'],
      paceUnits: [PaceUnits.MinutesPerMile],
      gradeAdjustedPaceUnits: ['Grade Adjusted Pace in minutes per mile'],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
      verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond],
      startOfTheWeek: DaysOfTheWeek.Monday,
    });
  });

  it('falls back to defaults when the settings doc is missing or malformed', async () => {
    const { loadUserUnitSettings } = createLoadUserUnitSettings({
      getSettingsData: async () => ({
        unitSettings: {
          speedUnits: ['bad-value'],
        },
      }),
    });

    await expect(loadUserUnitSettings('user-1')).resolves.toEqual({
      speedUnits: [SpeedUnits.KilometersPerHour],
      gradeAdjustedSpeedUnits: ['Grade Adjusted Speed in kilometers per hour'],
      paceUnits: [PaceUnits.MinutesPerKilometer],
      gradeAdjustedPaceUnits: ['Grade Adjusted Pace'],
      swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter],
      verticalSpeedUnits: [VerticalSpeedUnits.MetersPerSecond],
      startOfTheWeek: DaysOfTheWeek.Monday,
    });
  });
});
