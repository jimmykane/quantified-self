import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataDuration,
  DataInterface,
  DynamicDataLoader,
  UserUnitSettingsInterface,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import * as weeknumber from 'weeknumber';
import type { AggregatedChartRow } from './aggregated-chart-row.helper';
import { getBrowserLocale } from '../shared/adapters/date-locale.config';
import { resolveUnitAwareDisplayStat, resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';

type WarnLogger = {
  warn?: (...args: unknown[]) => void;
};

const SECONDS_PER_DAY = 24 * 60 * 60;

type DashboardDateFormatOptions = {
  locale: string;
  timeZone?: string;
};

function resolveDashboardDisplayInterval(timeInterval: TimeIntervals): TimeIntervals {
  switch (timeInterval) {
    case TimeIntervals.BiWeekly:
      return TimeIntervals.Weekly;
    case TimeIntervals.Quarterly:
    case TimeIntervals.Semesterly:
      return TimeIntervals.Monthly;
    default:
      return timeInterval;
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toValidDate(value: number | Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date;
}

function withOptionalTimeZone<T extends Intl.DateTimeFormatOptions>(
  options: T,
  timeZone?: string,
): T & Intl.DateTimeFormatOptions {
  return timeZone ? { ...options, timeZone } : options;
}

function getZonedCalendarDate(date: Date, timeZone?: string): Date {
  if (!timeZone) {
    return date;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return date;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function formatDashboardDateByIntervalWithOptions(
  value: number | Date,
  timeInterval: TimeIntervals,
  options: DashboardDateFormatOptions,
): string {
  const date = toValidDate(value);
  if (!date) {
    return '';
  }

  switch (resolveDashboardDisplayInterval(timeInterval)) {
    case TimeIntervals.Yearly:
      return date.toLocaleDateString(options.locale, withOptionalTimeZone({ year: 'numeric' }, options.timeZone));
    case TimeIntervals.Monthly:
      return date.toLocaleDateString(options.locale, withOptionalTimeZone({ month: 'short', year: 'numeric' }, options.timeZone));
    case TimeIntervals.Weekly: {
      const week = weeknumber.weekNumber(getZonedCalendarDate(date, options.timeZone));
      const dateLabel = date.toLocaleDateString(
        options.locale,
        withOptionalTimeZone({ day: '2-digit', month: 'short', year: 'numeric' }, options.timeZone),
      );
      return `Week ${week} ${dateLabel}`;
    }
    case TimeIntervals.Daily:
      return date.toLocaleDateString(
        options.locale,
        withOptionalTimeZone({ day: '2-digit', month: 'short', year: 'numeric' }, options.timeZone),
      );
    case TimeIntervals.Hourly: {
      const timeLabel = date.toLocaleTimeString(
        options.locale,
        withOptionalTimeZone({ hour: '2-digit', minute: '2-digit', hour12: false }, options.timeZone),
      );
      const dateLabel = date.toLocaleDateString(
        options.locale,
        withOptionalTimeZone({ day: '2-digit', month: 'short', year: 'numeric' }, options.timeZone),
      );
      return `${timeLabel} ${dateLabel}`;
    }
    default:
      throw new Error(`Not implemented for ${timeInterval}`);
  }
}

export function getDashboardChartDateFormat(timeInterval: TimeIntervals): string {
  switch (resolveDashboardDisplayInterval(timeInterval)) {
    case TimeIntervals.Yearly:
      return 'yyyy';
    case TimeIntervals.Monthly:
      return 'MMM yyyy';
    case TimeIntervals.Weekly:
      return `'Week' ww dd MMM yyyy`;
    case TimeIntervals.Daily:
      return 'dd MMM yyyy';
    case TimeIntervals.Hourly:
      return 'HH:mm dd MMM yyyy';
    default:
      throw new Error('Not implemented');
  }
}

export function getDashboardAxisDateFormat(timeInterval: TimeIntervals): string {
  switch (resolveDashboardDisplayInterval(timeInterval)) {
    case TimeIntervals.Yearly:
      return 'yyyy';
    case TimeIntervals.Monthly:
      return 'MMM';
    case TimeIntervals.Weekly:
      return 'ww';
    case TimeIntervals.Daily:
      return 'dd';
    case TimeIntervals.Hourly:
      return 'HH:mm';
    default:
      throw new Error('Not implemented');
  }
}

export function formatDashboardDateByInterval(
  value: number | Date,
  timeInterval: TimeIntervals,
  locale = getBrowserLocale(),
  timeZone?: string,
): string {
  return formatDashboardDateByIntervalWithOptions(value, timeInterval, {
    locale,
    timeZone,
  });
}

export function formatDashboardDateRange(
  startValue: number | Date | string,
  endValue: number | Date | string,
  locale = getBrowserLocale(),
  timeZone?: string,
): string {
  const startDate = toValidDate(startValue);
  const endDate = toValidDate(endValue);
  if (!startDate || !endDate) {
    return '';
  }

  return `${formatDashboardDateByInterval(startDate, TimeIntervals.Daily, locale, timeZone)} to ${formatDashboardDateByInterval(endDate, TimeIntervals.Daily, locale, timeZone)}`;
}

export function formatDashboardBucketDateByInterval(
  value: number | Date,
  timeInterval: TimeIntervals,
  locale = getBrowserLocale(),
  timeZone?: string,
): string {
  return formatDashboardDateByInterval(value, resolveDashboardDisplayInterval(timeInterval), locale, timeZone);
}

export function getDashboardDataInstanceOrNull(
  chartDataType: string | undefined,
  value: unknown,
  logger?: WarnLogger
): DataInterface | null {
  if (!chartDataType) {
    return null;
  }

  const numericValue = toFiniteNumber(value);
  if (numericValue === null) {
    return null;
  }

  try {
    return DynamicDataLoader.getDataInstanceFromDataType(chartDataType, numericValue) || null;
  } catch (error) {
    logger?.warn?.('[DashboardChartDataHelper] Failed to create chart data instance', {
      chartDataType,
      numericValue,
      error
    });
    return null;
  }
}

export function getDashboardAggregateData(
  data: any[],
  chartDataValueType: ChartDataValueTypes | undefined,
  chartDataType: string | undefined,
  logger?: WarnLogger
): DataInterface | null {
  if (!Array.isArray(data) || !data.length || !chartDataValueType) {
    return null;
  }

  const numericValues = data
    .map(dataItem => toFiniteNumber(dataItem?.[chartDataValueType]))
    .filter((value): value is number => value !== null);

  if (!numericValues.length) {
    return null;
  }

  switch (chartDataValueType) {
    case ChartDataValueTypes.Average:
      return getDashboardDataInstanceOrNull(
        chartDataType,
        numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length,
        logger
      );
    case ChartDataValueTypes.Maximum:
      return getDashboardDataInstanceOrNull(chartDataType, Math.max(...numericValues), logger);
    case ChartDataValueTypes.Minimum:
      return getDashboardDataInstanceOrNull(chartDataType, Math.min(...numericValues), logger);
    case ChartDataValueTypes.Total:
      return getDashboardDataInstanceOrNull(
        chartDataType,
        numericValues.reduce((sum, value) => sum + value, 0),
        logger
      );
    default:
      return null;
  }
}

export function formatDashboardDataDisplay(
  data: DataInterface | null | undefined,
  unitSettings?: UserUnitSettingsInterface | null,
): string {
  if (!data) {
    return '--';
  }

  const rawValue = toFiniteNumber(typeof data.getValue === 'function' ? data.getValue() : null);
  if (data instanceof DataDuration && rawValue !== null && rawValue >= SECONDS_PER_DAY) {
    return data.getDisplayValue(true, false).trim();
  }

  return resolveUnitAwareDisplayStat(data, unitSettings, { stripRepeatedUnit: true })?.text
    ?? `${data.getDisplayValue()}${data.getDisplayUnit()}`.trim();
}

export function formatDashboardNumericValue(
  chartDataType: string | undefined,
  value: unknown,
  logger?: WarnLogger,
  unitSettings?: UserUnitSettingsInterface | null,
): string {
  const numericValue = toFiniteNumber(value);
  if (numericValue === null) {
    return '--';
  }

  const display = resolveUnitAwareDisplayFromValue(chartDataType, numericValue, unitSettings, {
    stripRepeatedUnit: true,
  });
  if (display) {
    return display.text;
  }

  const data = getDashboardDataInstanceOrNull(chartDataType, numericValue, logger);
  if (!data) {
    return Number(numericValue).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return formatDashboardDataDisplay(data, unitSettings);
}

export function getDashboardChartSortComparator(
  chartDataCategoryType: ChartDataCategoryTypes | undefined,
  chartDataValueType: ChartDataValueTypes | undefined
): (itemA: AggregatedChartRow, itemB: AggregatedChartRow) => number {
  return (itemA: AggregatedChartRow, itemB: AggregatedChartRow): number => {
    if (chartDataCategoryType === ChartDataCategoryTypes.ActivityType) {
      if (!chartDataValueType) {
        return 0;
      }
      return Number(itemA?.[chartDataValueType] || 0) - Number(itemB?.[chartDataValueType] || 0);
    }

    return -(Number(itemB?.time || 0) - Number(itemA?.time || 0));
  };
}

function getDashboardTimeIntervalScopeLabel(timeInterval: TimeIntervals): string {
  switch (timeInterval) {
    case TimeIntervals.Yearly:
      return 'year';
    case TimeIntervals.Monthly:
      return 'month';
    case TimeIntervals.Weekly:
      return 'week';
    case TimeIntervals.BiWeekly:
      return '2 weeks';
    case TimeIntervals.Quarterly:
      return 'quarter';
    case TimeIntervals.Semesterly:
      return 'semester';
    case TimeIntervals.Daily:
      return 'day';
    case TimeIntervals.Hourly:
      return 'hour';
    default:
      return 'period';
  }
}

export function getDashboardSummaryMetaLabel(
  chartDataCategoryType: ChartDataCategoryTypes | undefined,
  chartDataValueType: ChartDataValueTypes | undefined,
  chartDataTimeInterval: TimeIntervals | undefined
): string {
  const valueLabel = chartDataValueType || 'Value';

  if (chartDataCategoryType === ChartDataCategoryTypes.ActivityType) {
    return `${valueLabel} per activity type`;
  }

  if (chartDataCategoryType === ChartDataCategoryTypes.DateType) {
    return `${valueLabel} per ${getDashboardTimeIntervalScopeLabel(chartDataTimeInterval || TimeIntervals.Daily)}`;
  }

  return valueLabel;
}
