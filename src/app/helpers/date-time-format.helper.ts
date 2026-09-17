const MAX_FORMATTERS = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Reuse date formatters, not formatted values. No readings or account state enter this cache. */
export function getDateTimeFormatter(
  locales: string | string[] | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  // A formatter captures the system timezone when constructed. Leave local-time formatting
  // uncached so changing the device timezone cannot retain the old zone until a page reload.
  if (!options.timeZone) return new Intl.DateTimeFormat(locales, options);

  const key = JSON.stringify([locales, Object.entries(options)
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))]);
  const cached = formatters.get(key);
  if (cached) {
    formatters.delete(key);
    formatters.set(key, cached);
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locales, options);
  formatters.set(key, formatter);
  if (formatters.size > MAX_FORMATTERS) formatters.delete(formatters.keys().next().value!);
  return formatter;
}
