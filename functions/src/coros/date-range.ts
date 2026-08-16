const DAY_MS = 24 * 60 * 60 * 1000;
export const COROS_MAX_DATE_RANGE_DAYS = 30;

export interface COROSInclusiveDateWindow {
  startDate: Date;
  endDate: Date;
}

export interface COROSInclusiveTimestampWindow {
  startMs: number;
  endMs: number;
}

function utcDate(year: number, monthIndex: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== monthIndex
    || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

export function parseCOROSCalendarDate(value: unknown): Date | null {
  if (typeof value === 'string') {
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (dateOnlyMatch) {
      return utcDate(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
      );
    }
  }

  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value as string | number);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

export function formatCOROSCalendarDate(value: Date | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid COROS calendar date.');
  }
  return `${date.getUTCFullYear()}${`${date.getUTCMonth() + 1}`.padStart(2, '0')}${`${date.getUTCDate()}`.padStart(2, '0')}`;
}

export function addUTCCalendarDays(value: Date, days: number): Date {
  return new Date(value.getTime() + (days * DAY_MS));
}

export function subtractUTCMonthsClamped(value: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 0) {
    throw new Error('Invalid COROS month range.');
  }
  const targetMonthIndex = value.getUTCMonth() - months;
  const targetYear = value.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonthLastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    normalizedMonthIndex,
    Math.min(value.getUTCDate(), targetMonthLastDay),
  ));
}

export function chunkCOROSInclusiveDateRange(
  startValue: Date | string | number,
  endValue: Date | string | number,
  maximumDays = COROS_MAX_DATE_RANGE_DAYS,
): COROSInclusiveDateWindow[] {
  const startDate = parseCOROSCalendarDate(startValue);
  const endDate = parseCOROSCalendarDate(endValue);
  if (!startDate || !endDate || !Number.isInteger(maximumDays) || maximumDays <= 0) {
    throw new Error('Invalid COROS date range.');
  }
  if (startDate.getTime() > endDate.getTime()) {
    return [];
  }

  const windows: COROSInclusiveDateWindow[] = [];
  let cursor = startDate;
  while (cursor.getTime() <= endDate.getTime()) {
    const maximumEnd = addUTCCalendarDays(cursor, maximumDays - 1);
    const windowEnd = maximumEnd.getTime() < endDate.getTime() ? maximumEnd : endDate;
    windows.push({
      startDate: new Date(cursor.getTime()),
      endDate: new Date(windowEnd.getTime()),
    });
    cursor = addUTCCalendarDays(windowEnd, 1);
  }
  return windows;
}

export function chunkCOROSInclusiveTimestampRange(
  startMs: number,
  endMs: number,
  maximumDays = COROS_MAX_DATE_RANGE_DAYS,
): COROSInclusiveTimestampWindow[] {
  return chunkCOROSInclusiveDateRange(startMs, endMs, maximumDays).map(window => ({
    startMs: window.startDate.getTime(),
    endMs: window.endDate.getTime(),
  }));
}
