export type ActivityDateRangePreset = 'week' | 'month' | 'quarter' | 'calendar-week' | 'calendar-month' | 'year' | 'custom' | 'all';
export interface ActivityDateRangeDates { startDate: string; endDate: string }
export interface ActivityDateRangeWindow { start: Date; end: Date }
export interface ActivityDateRangeNavigation { preset: ActivityDateRangePreset; anchor: string | null; customDates?: ActivityDateRangeDates }

const presets = new Set<ActivityDateRangePreset>(['week', 'month', 'quarter', 'calendar-week', 'calendar-month', 'year', 'custom', 'all']);
const daysByPreset: Partial<Record<ActivityDateRangePreset, number>> = { week: 7, month: 30, quarter: 90 };

export function parseActivityRangeDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day); date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function formatActivityRangeDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function normalizeActivityRangeDates(start: unknown, end: unknown): ActivityDateRangeDates | null {
  const first = parseActivityRangeDate(start), last = parseActivityRangeDate(end);
  return first && last && first <= last ? { startDate: start as string, endDate: end as string } : null;
}

export function normalizeActivityRangeNavigation(value: unknown): ActivityDateRangeNavigation | null {
  if (!value || typeof value !== 'object') return null;
  const { preset, anchor, customDates } = value as Partial<ActivityDateRangeNavigation>;
  if (!presets.has(preset) || (anchor != null && !parseActivityRangeDate(anchor))) return null;
  const dates = preset === 'custom' ? normalizeActivityRangeDates(customDates?.startDate, customDates?.endDate) : null;
  return { preset, anchor: preset === 'all' || preset === 'custom' ? null : anchor || null, ...(dates ? { customDates: dates } : {}) };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  // Midnight may not exist on the source day. Resolve the destination's own
  // start of day rather than carrying the source's normalized 01:00 forward.
  result.setHours(0, 0, 0, 0);
  return result;
}

/** Calendar-day ordinal: use the local date fields, never elapsed hours across DST. */
function dayNumber(date: Date): number {
  const ordinal = new Date(0);
  ordinal.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  ordinal.setUTCHours(0, 0, 0, 0);
  return +ordinal / 86_400_000;
}

export function activityRangeDates(range: ActivityDateRangeWindow): ActivityDateRangeDates {
  return { startDate: formatActivityRangeDate(range.start), endDate: formatActivityRangeDate(addDays(range.end, -1)) };
}

export function resolveActivityDateRange(
  preset: ActivityDateRangePreset, now: Date, customDates?: ActivityDateRangeDates | null,
  startOfWeek = 1, anchor?: string | null,
): ActivityDateRangeWindow | null | undefined {
  if (preset === 'all') return null;
  if (preset === 'custom') {
    const dates = normalizeActivityRangeDates(customDates?.startDate, customDates?.endDate);
    return dates ? { start: parseActivityRangeDate(dates.startDate)!, end: addDays(parseActivityRangeDate(dates.endDate)!, 1) } : undefined;
  }
  const date = anchor ? parseActivityRangeDate(anchor) : new Date(now);
  if (!date || !Number.isFinite(+date)) return undefined;
  date.setHours(0, 0, 0, 0);
  if (daysByPreset[preset]) return { start: addDays(date, 1 - daysByPreset[preset]), end: addDays(date, 1) };
  if (preset === 'calendar-week') {
    const firstDay = Number.isInteger(startOfWeek) && startOfWeek >= 0 && startOfWeek <= 6 ? startOfWeek : 1;
    const start = addDays(date, -((date.getDay() - firstDay + 7) % 7));
    return { start, end: addDays(start, 7) };
  }
  if (preset === 'calendar-month') {
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setMonth(end.getMonth() + 1); end.setHours(0, 0, 0, 0);
    return { start: date, end };
  }
  if (preset === 'year') {
    date.setMonth(0, 1);
    date.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setFullYear(end.getFullYear() + 1); end.setHours(0, 0, 0, 0);
    return { start: date, end };
  }
  return undefined;
}

/** An optional latest window caps forward navigation without shortening its calendar-day length. */
export function shiftActivityDateRange(preset: ActivityDateRangePreset, range: ActivityDateRangeWindow, direction: -1 | 1, latestRange?: ActivityDateRangeWindow | null): ActivityDateRangeWindow | undefined {
  if (preset === 'all' || !Number.isFinite(+range.start) || !Number.isFinite(+range.end) || range.end <= range.start) return undefined;
  if (direction === 1 && latestRange && range.end >= latestRange.end) return undefined;
  let start: Date, end: Date;
  if (preset === 'year' || preset === 'calendar-month') {
    start = new Date(range.start); end = new Date(range.end);
    if (preset === 'year') { start.setFullYear(start.getFullYear() + direction); end.setFullYear(end.getFullYear() + direction); }
    else { start.setMonth(start.getMonth() + direction); end = new Date(start); end.setMonth(end.getMonth() + 1); }
  } else {
    const days = dayNumber(range.end) - dayNumber(range.start);
    start = addDays(range.start, direction * days); end = addDays(range.end, direction * days);
  }
  start.setHours(0, 0, 0, 0); end.setHours(0, 0, 0, 0);
  if (direction === 1 && latestRange && end > latestRange.end) return latestRange;
  return Number.isFinite(+start) && Number.isFinite(+end) && start.getFullYear() >= 0 && end.getFullYear() <= 10000 ? { start, end } : undefined;
}

export function currentActivityDateRange(preset: ActivityDateRangePreset, now: Date, range: ActivityDateRangeWindow | null | undefined, startOfWeek = 1): ActivityDateRangeWindow | null | undefined {
  if (preset !== 'custom') return resolveActivityDateRange(preset, now, null, startOfWeek);
  if (!range) return undefined;
  const end = addDays(now, 1);
  return { start: addDays(end, -(dayNumber(range.end) - dayNumber(range.start))), end };
}

export function sameActivityDateRange(left: ActivityDateRangeWindow | null | undefined, right: ActivityDateRangeWindow | null | undefined): boolean {
  return left === right || (!!left && !!right && +left.start === +right.start && +left.end === +right.end);
}

export function activityDateRangeAnchor(preset: ActivityDateRangePreset, range: ActivityDateRangeWindow): string {
  return formatActivityRangeDate(daysByPreset[preset] ? addDays(range.end, -1) : range.start);
}
