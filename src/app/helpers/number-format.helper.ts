import { getBrowserLocale } from '../shared/adapters/date-locale.config';

const MAX_FORMATTERS = 64;
const formatters = new Map<string, Intl.NumberFormat>();

/** Reuse locale-aware number formatters without retaining user values or account state. */
export function getNumberFormatter(
  locales: string | string[] | undefined = undefined,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  const resolvedLocales = locales ?? getBrowserLocale();
  const key = JSON.stringify([resolvedLocales, Object.entries(options)
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))]);
  const cached = formatters.get(key);
  if (cached) {
    formatters.delete(key);
    formatters.set(key, cached);
    return cached;
  }

  const formatter = new Intl.NumberFormat(resolvedLocales, options);
  formatters.set(key, formatter);
  if (formatters.size > MAX_FORMATTERS) formatters.delete(formatters.keys().next().value!);
  return formatter;
}
