import { AppThemes } from '@sports-alliance/sports-lib';

export const SYSTEM_THEME_PREFERENCE = 'System' as const;

export type AppThemePreference = AppThemes | typeof SYSTEM_THEME_PREFERENCE;

export function isAppThemePreference(value: unknown): value is AppThemePreference {
  return value === AppThemes.Normal
    || value === AppThemes.Dark
    || value === SYSTEM_THEME_PREFERENCE;
}
