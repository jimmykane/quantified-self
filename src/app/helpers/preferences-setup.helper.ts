import { AppThemes } from '@sports-alliance/sports-lib';
import { DistanceUnits, ElevationUnits, WeightUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib/metrics';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import type { AppAppSettingsInterface, AppUserInterface } from '../models/app-user.interface';
import { isAppThemePreference, SYSTEM_THEME_PREFERENCE, type AppThemePreference } from '../models/app-theme-preference.type';
import { normalizeAppFormatLocalePreference, type AppFormatLocalePreference } from '../shared/adapters/app-locale';
import { buildUnitSettingsForUnitSetupPreset, type UnitSetupPreset } from './unit-setup-preset.helper';

export const PREFERENCE_WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const PREFERENCE_DISTANCE_OPTIONS = [{ value: DistanceUnits.Kilometers, label: 'Kilometers' }, { value: DistanceUnits.Miles, label: 'Miles' }];
export const PREFERENCE_WEIGHT_OPTIONS = [{ value: WeightUnits.Kilograms, label: 'Kilograms (kg)' }, { value: WeightUnits.Pounds, label: 'Pounds (lb)' }];
export const PREFERENCE_ELEVATION_OPTIONS = [{ value: ElevationUnits.Meters, label: 'Metres (m)' }, { value: ElevationUnits.Feet, label: 'Feet (ft)' }];
export const PREFERENCE_THEME_OPTIONS = [{ value: SYSTEM_THEME_PREFERENCE, label: 'System' }, { value: AppThemes.Normal, label: 'Light' }, { value: AppThemes.Dark, label: 'Dark' }];
export const PREFERENCE_WEEK_OPTIONS = PREFERENCE_WEEK_DAYS.map((label, value) => ({ label, value: String(value) }));

export interface PreferencesDraft {
  units: UserUnitSettingsInterface;
  theme: AppThemePreference;
  formatLocale: AppFormatLocalePreference;
}
export interface PreferencesSetupPatch {
  appSettings: Partial<AppAppSettingsInterface>;
  unitSettings?: Partial<UserUnitSettingsInterface>;
}

/** Starting intent never selects preferences. Only completed, owner account setup is eligible. */
export function needsPreferencesSetup(user: AppUserInterface | null | undefined): boolean {
  return !!user?.uid && user.onboardingCompleted === true && user.acceptedTos === true
    && user.acceptedPrivacyPolicy === true && user.acceptedDataPolicy === true
    && user.settings?.appSettings?.unitSetupCompleted === false;
}

/** Only normal account workspaces; exclude public/shared pages, consent, settings and checkout returns. */
export function isPreferencesSetupWorkspace(url: string): boolean {
  const path = url.split(/[?#]/)[0].replace(/;[^/]*/g, '').replace(/\/$/, '');
  if (/^\/training\/plans(\/|$)/.test(path)) return false;
  return /^\/(dashboard|services|activities|calendar|training|health|routes|mytracks)(\/|$)/.test(path)
    || path === '/tools/compare' || path === '/tools/compare/saved';
}

export function createPreferencesDraft(user: AppUserInterface): PreferencesDraft {
  const settings = user.settings?.appSettings;
  return {
    units: normalizeUserUnitSettings(user.settings?.unitSettings),
    theme: isAppThemePreference(settings?.themePreference) ? settings.themePreference
      : isAppThemePreference(settings?.theme) ? settings.theme : SYSTEM_THEME_PREFERENCE,
    formatLocale: normalizeAppFormatLocalePreference(settings?.formatLocale),
  };
}

export function applyPreferencesPreset(draft: PreferencesDraft, preset: UnitSetupPreset): PreferencesDraft {
  return { ...draft, units: { ...buildUnitSettingsForUnitSetupPreset(preset, null),
    weightUnits: draft.units.weightUnits, startOfTheWeek: draft.units.startOfTheWeek } };
}

export function preferencesSummary(units: UserUnitSettingsInterface): string {
  return [PREFERENCE_DISTANCE_OPTIONS.find(option => option.value === units.distanceUnits)?.label,
    PREFERENCE_WEIGHT_OPTIONS.find(option => option.value === units.weightUnits)?.label,
    PREFERENCE_WEEK_DAYS[units.startOfTheWeek]].filter(Boolean).join(' · ');
}

/** Save changed fields only; unrelated settings or changes from another tab must survive. */
export function preferencesSetupPatch(initial: PreferencesDraft, draft: PreferencesDraft): PreferencesSetupPatch {
  const patch: PreferencesSetupPatch = { appSettings: { unitSetupCompleted: true } };
  const units = normalizeUserUnitSettings(draft.units);
  for (const key of Object.keys(units) as Array<keyof UserUnitSettingsInterface>) {
    if (JSON.stringify(units[key]) !== JSON.stringify(initial.units[key])) {
      Object.assign(patch.unitSettings ??= {}, { [key]: units[key] });
    }
  }
  if (draft.theme !== initial.theme) patch.appSettings.themePreference = draft.theme;
  if (draft.formatLocale !== initial.formatLocale) patch.appSettings.formatLocale = draft.formatLocale;
  return patch;
}
