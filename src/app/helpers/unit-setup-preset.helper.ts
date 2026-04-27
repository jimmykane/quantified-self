import {
  DaysOfTheWeek,
  DistanceUnits,
  GradeAdjustedPaceUnits,
  GradeAdjustedSpeedUnits,
  PaceUnits,
  PaceUnitsToGradeAdjustedPaceUnits,
  SpeedUnits,
  SpeedUnitsToGradeAdjustedSpeedUnits,
  SwimPaceUnits,
  UserUnitSettingsInterface,
  VerticalSpeedUnits,
} from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../models/app-user.interface';

export type UnitSetupPreset = 'kilometers' | 'miles';

export interface UnitSetupPresetOption {
  label: string;
  value: UnitSetupPreset;
  preview: string;
}

export const UNIT_SETUP_PRESET_OPTIONS: UnitSetupPresetOption[] = [
  { label: 'Kilometers', value: 'kilometers', preview: '10.00 km · 5:00 min/km' },
  { label: 'Miles', value: 'miles', preview: '6.22 mi · 8:03 min/mi' },
];

const MILE_DISTANCE_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);
const FALLBACK_SUNDAY_WEEK_REGIONS = new Set(['US']);
const SATURDAY_WEEK_START = 6 as DaysOfTheWeek;

export function getRawBrowserLocale(): string | null {
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) {
      return intlLocale;
    }
  } catch {
    // Fall through to navigator.
  }

  const navigatorLocale = globalThis.navigator?.language;
  return navigatorLocale || null;
}

export function resolveLocaleRegion(locale: string | null | undefined): string | null {
  if (!locale || typeof locale !== 'string') {
    return null;
  }

  try {
    const intlLocale = new Intl.Locale(locale).maximize();
    return typeof intlLocale.region === 'string' ? intlLocale.region.toUpperCase() : null;
  } catch {
    const match = locale.match(/[-_]([A-Za-z]{2}|\d{3})(?:[-_]|$)/);
    return match?.[1]?.toUpperCase() || null;
  }
}

export function resolveSuggestedUnitSetupPreset(locale: string | null = getRawBrowserLocale()): UnitSetupPreset {
  const region = resolveLocaleRegion(locale);
  return region && MILE_DISTANCE_REGIONS.has(region) ? 'miles' : 'kilometers';
}

export function resolveStartOfTheWeekForUnitSetup(locale: string | null = getRawBrowserLocale()): DaysOfTheWeek {
  const firstDay = getIntlLocaleFirstDay(locale);
  if (firstDay === 7) {
    return DaysOfTheWeek.Sunday;
  }
  if (firstDay === 1) {
    return DaysOfTheWeek.Monday;
  }
  if (firstDay === 6) {
    return SATURDAY_WEEK_START;
  }

  const region = resolveLocaleRegion(locale);
  return region && FALLBACK_SUNDAY_WEEK_REGIONS.has(region)
    ? DaysOfTheWeek.Sunday
    : DaysOfTheWeek.Monday;
}

export function buildUnitSettingsForUnitSetupPreset(
  preset: UnitSetupPreset,
  locale: string | null = getRawBrowserLocale(),
): UserUnitSettingsInterface {
  const speedUnits = preset === 'miles'
    ? [SpeedUnits.MilesPerHour]
    : [SpeedUnits.KilometersPerHour];
  const paceUnits = preset === 'miles'
    ? [PaceUnits.MinutesPerMile]
    : [PaceUnits.MinutesPerKilometer];

  return {
    speedUnits,
    gradeAdjustedSpeedUnits: resolveGradeAdjustedSpeedUnits(speedUnits),
    paceUnits,
    gradeAdjustedPaceUnits: resolveGradeAdjustedPaceUnits(paceUnits),
    swimPaceUnits: preset === 'miles'
      ? [SwimPaceUnits.MinutesPer100Yard]
      : [SwimPaceUnits.MinutesPer100Meter],
    verticalSpeedUnits: preset === 'miles'
      ? [VerticalSpeedUnits.FeetPerSecond]
      : [VerticalSpeedUnits.MetersPerSecond],
    distanceUnits: preset === 'miles'
      ? DistanceUnits.Miles
      : DistanceUnits.Kilometers,
    startOfTheWeek: resolveStartOfTheWeekForUnitSetup(locale),
  };
}

export function shouldShowUnitSetupPrompt(
  user: AppUserInterface | null | undefined,
  targetUser: AppUserInterface | null | undefined,
): boolean {
  if (!user) {
    return false;
  }

  if (targetUser && targetUser.uid !== user.uid) {
    return false;
  }

  return user.settings?.appSettings?.unitSetupCompleted === false;
}

function getIntlLocaleFirstDay(locale: string | null | undefined): number | null {
  if (!locale) {
    return null;
  }

  try {
    const intlLocale = new Intl.Locale(locale);
    const weekInfo = (intlLocale as unknown as { weekInfo?: { firstDay?: number } }).weekInfo;
    return typeof weekInfo?.firstDay === 'number' ? weekInfo.firstDay : null;
  } catch {
    return null;
  }
}

function resolveGradeAdjustedSpeedUnits(speedUnits: SpeedUnits[]): GradeAdjustedSpeedUnits[] {
  return speedUnits.map(speedUnit => {
    const mappedUnitKey = SpeedUnitsToGradeAdjustedSpeedUnits[
      speedUnit as keyof typeof SpeedUnitsToGradeAdjustedSpeedUnits
    ] as keyof typeof GradeAdjustedSpeedUnits;

    return GradeAdjustedSpeedUnits[mappedUnitKey];
  });
}

function resolveGradeAdjustedPaceUnits(paceUnits: PaceUnits[]): GradeAdjustedPaceUnits[] {
  return paceUnits.map(paceUnit => {
    const mappedUnitKey = PaceUnitsToGradeAdjustedPaceUnits[
      paceUnit as keyof typeof PaceUnitsToGradeAdjustedPaceUnits
    ] as keyof typeof GradeAdjustedPaceUnits;

    return GradeAdjustedPaceUnits[mappedUnitKey];
  });
}
