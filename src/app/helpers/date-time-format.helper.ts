import { getAppLocale } from '../shared/adapters/app-locale';

const MAX_FORMATTERS = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();
const LOCAL_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
};

/** Reuse date formatters, not formatted values. No readings or account state enter this cache. */
export function getDateTimeFormatter(
  locales: string | string[] | undefined = undefined,
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormat {
  const resolvedLocales = locales ?? getAppLocale();

  // A formatter captures the system timezone when constructed. Leave local-time formatting
  // uncached so changing the device timezone cannot retain the old zone until a page reload.
  if (!options.timeZone) return new Intl.DateTimeFormat(resolvedLocales, options);

  const key = JSON.stringify([resolvedLocales, Object.entries(options)
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))]);
  const cached = formatters.get(key);
  if (cached) {
    formatters.delete(key);
    formatters.set(key, cached);
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(resolvedLocales, options);
  formatters.set(key, formatter);
  if (formatters.size > MAX_FORMATTERS) formatters.delete(formatters.keys().next().value!);
  return formatter;
}

/** Locale-aware equivalent of Date#toLocaleString that preserves second-level precision. */
export function getLocalDateTimeFormatter(
  locales: string | string[] | undefined = undefined,
): Intl.DateTimeFormat {
  return getDateTimeFormatter(locales, LOCAL_DATE_TIME_OPTIONS);
}
