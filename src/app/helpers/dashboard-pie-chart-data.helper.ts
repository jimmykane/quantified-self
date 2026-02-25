import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { formatDashboardDateByInterval } from './dashboard-chart-data.helper';

export interface DashboardPieSlice {
  label: string;
  value: number;
  count: number;
  percent: number;
  isOther?: boolean;
  dateValue?: number | null;
  rawItems: any[];
}

export interface DashboardPieChartData {
  slices: DashboardPieSlice[];
  total: number;
}

export interface BuildDashboardPieChartDataInput {
  data: any[] | null | undefined;
  chartDataValueType?: ChartDataValueTypes;
  chartDataCategoryType?: ChartDataCategoryTypes;
  thresholdPercent?: number;
}

function parseDateValue(item: any): number | null {
  const dateCandidates = [item?.time, item?.type];

  for (const candidate of dateCandidates) {
    const asNumber = Number(candidate);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }

    const asDate = new Date(candidate as any);
    if (Number.isFinite(asDate.getTime())) {
      return asDate.getTime();
    }
  }

  return null;
}

function withPercentages(slices: DashboardPieSlice[]): DashboardPieSlice[] {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) {
    return slices.map(slice => ({ ...slice, percent: 0 }));
  }
  return slices.map(slice => ({
    ...slice,
    percent: (slice.value / total) * 100
  }));
}

export function buildDashboardPieChartData(input: BuildDashboardPieChartDataInput): DashboardPieChartData {
  const safeData = Array.isArray(input.data) ? input.data : [];
  const valueType = input.chartDataValueType;
  const categoryType = input.chartDataCategoryType;
  const thresholdPercent = Number.isFinite(input.thresholdPercent as number)
    ? Number(input.thresholdPercent)
    : 7;

  if (!valueType) {
    return { slices: [], total: 0 };
  }

  const normalized = safeData.reduce((slices: DashboardPieSlice[], item) => {
    const value = Number(item?.[valueType]);
    if (!Number.isFinite(value) || value <= 0) {
      return slices;
    }

    const count = Number(item?.count);
    const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
    const rawLabel = `${item?.type ?? ''}`.trim();
    const label = rawLabel || 'Unknown';
    const dateValue = categoryType === ChartDataCategoryTypes.DateType ? parseDateValue(item) : null;

    slices.push({
      label,
      value,
      count: safeCount,
      percent: 0,
      dateValue,
      rawItems: [item]
    });
    return slices;
  }, []);

  let slices = withPercentages(normalized);

  if (categoryType === ChartDataCategoryTypes.ActivityType && thresholdPercent > 0 && slices.length > 0) {
    const largeSlices = slices.filter(slice => slice.percent >= thresholdPercent);
    const groupedSlices = slices.filter(slice => slice.percent < thresholdPercent);

    if (groupedSlices.length > 0) {
      const otherSlice: DashboardPieSlice = {
        label: 'Other',
        value: groupedSlices.reduce((sum, slice) => sum + slice.value, 0),
        count: groupedSlices.reduce((sum, slice) => sum + slice.count, 0),
        percent: 0,
        isOther: true,
        dateValue: null,
        rawItems: groupedSlices.flatMap(slice => slice.rawItems)
      };
      slices = withPercentages([...largeSlices, otherSlice]);
    }
  }

  return {
    slices,
    total: slices.reduce((sum, slice) => sum + slice.value, 0)
  };
}

export function getDashboardPieSliceDisplayLabel(
  slice: DashboardPieSlice,
  chartDataCategoryType: ChartDataCategoryTypes | undefined,
  chartDataTimeInterval: TimeIntervals | undefined
): string {
  if (chartDataCategoryType === ChartDataCategoryTypes.DateType) {
    if (slice.dateValue === null || slice.dateValue === undefined) {
      return slice.label;
    }
    return formatDashboardDateByInterval(slice.dateValue, chartDataTimeInterval || TimeIntervals.Daily);
  }
  return slice.label;
}
