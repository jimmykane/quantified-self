import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataInterface,
  DynamicDataLoader,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import * as weeknumber from 'weeknumber';
import { SummariesChartDataInterface } from '../components/summaries/summaries.component';
import { getBrowserLocale } from '../shared/adapters/date-locale.config';

type WarnLogger = {
  warn?: (...args: unknown[]) => void;
};

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function toValidDate(value: number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date;
}

export function getDashboardChartDateFormat(timeInterval: TimeIntervals): string {
  switch (timeInterval) {
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
  switch (timeInterval) {
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

export function formatDashboardDateByInterval(value: number | Date, timeInterval: TimeIntervals, locale = getBrowserLocale()): string {
  const date = toValidDate(value);
  if (!date) {
    return '';
  }

  switch (timeInterval) {
    case TimeIntervals.Yearly:
      return `${date.getFullYear()}`;
    case TimeIntervals.Monthly:
      return date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
    case TimeIntervals.Weekly: {
      const week = weeknumber.weekNumber(date);
      const dateLabel = date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
      return `Week ${week} ${dateLabel}`;
    }
    case TimeIntervals.Daily:
      return date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
    case TimeIntervals.Hourly: {
      const timeLabel = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
      const dateLabel = date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
      return `${timeLabel} ${dateLabel}`;
    }
    default:
      throw new Error(`Not implemented for ${timeInterval}`);
  }
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

export function getDashboardChartSortComparator(
  chartDataCategoryType: ChartDataCategoryTypes | undefined,
  chartDataValueType: ChartDataValueTypes | undefined
): (itemA: SummariesChartDataInterface, itemB: SummariesChartDataInterface) => number {
  return (itemA: SummariesChartDataInterface, itemB: SummariesChartDataInterface): number => {
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
