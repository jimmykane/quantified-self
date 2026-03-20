import type {
  NormalizedInsightBoundedDateRange,
  NormalizedInsightDateRange,
  NormalizedInsightQueryBase,
} from './ai-insights.types';

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
}

function getZonedDateParts(
  isoDate: string,
  timeZone: string,
): ZonedDateParts | null {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  return { year, month, day };
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatLocalizedDate(
  isoDate: string,
  locale: string | undefined,
  timeZone: string,
): string {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) {
    return isoDate;
  }

  return new Intl.DateTimeFormat(locale || 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date);
}

function formatMonthLabel(
  year: number,
  month: number,
  locale: string | undefined,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale || 'en-US', {
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function isCalendarYearRange(
  start: ZonedDateParts,
  end: ZonedDateParts,
): boolean {
  return (
    start.year === end.year
    && start.month === 1
    && start.day === 1
    && end.month === 12
    && end.day === 31
  );
}

function isCalendarMonthRange(
  start: ZonedDateParts,
  end: ZonedDateParts,
): boolean {
  return (
    start.year === end.year
    && start.month === end.month
    && start.day === 1
    && end.day === getDaysInMonth(end.year, end.month)
  );
}

function isQuarterRange(
  start: ZonedDateParts,
  end: ZonedDateParts,
): boolean {
  const quarterStartMonth = ((Math.floor((start.month - 1) / 3) * 3) + 1);
  return (
    start.year === end.year
    && start.month === quarterStartMonth
    && start.day === 1
    && end.month === quarterStartMonth + 2
    && end.day === getDaysInMonth(end.year, end.month)
  );
}

function isHalfYearRange(
  start: ZonedDateParts,
  end: ZonedDateParts,
): boolean {
  const halfStartMonth = start.month <= 6 ? 1 : 7;
  return (
    start.year === end.year
    && start.month === halfStartMonth
    && start.day === 1
    && end.month === halfStartMonth + 5
    && end.day === getDaysInMonth(end.year, end.month)
  );
}

function formatSingleBoundedDateSelection(
  range: NormalizedInsightBoundedDateRange,
  locale?: string,
): string {
  const start = getZonedDateParts(range.startDate, range.timezone);
  const end = getZonedDateParts(range.endDate, range.timezone);
  if (!start || !end) {
    return `${formatLocalizedDate(range.startDate, locale, range.timezone)} to ${formatLocalizedDate(range.endDate, locale, range.timezone)}`;
  }

  if (isCalendarYearRange(start, end)) {
    return `${start.year}`;
  }

  if (isQuarterRange(start, end)) {
    return `Q${Math.floor((start.month - 1) / 3) + 1} ${start.year}`;
  }

  if (isHalfYearRange(start, end)) {
    return `H${start.month <= 6 ? 1 : 2} ${start.year}`;
  }

  if (isCalendarMonthRange(start, end)) {
    return formatMonthLabel(start.year, start.month, locale, range.timezone);
  }

  return `${formatLocalizedDate(range.startDate, locale, range.timezone)} to ${formatLocalizedDate(range.endDate, locale, range.timezone)}`;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? '';
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export function formatAiInsightsDateRange(
  dateRange: NormalizedInsightDateRange,
  locale?: string,
): string {
  if (dateRange.kind === 'all_time') {
    return 'all time';
  }

  return formatSingleBoundedDateSelection(dateRange, locale);
}

export function formatAiInsightsSelectedDateRanges(
  query: Pick<NormalizedInsightQueryBase, 'dateRange' | 'requestedDateRanges'>,
  locale?: string,
): string {
  if (query.requestedDateRanges?.length) {
    return joinLabels(query.requestedDateRanges.map(range => formatSingleBoundedDateSelection(range, locale)));
  }

  return formatAiInsightsDateRange(query.dateRange, locale);
}
