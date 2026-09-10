import { ChartTypes, DataStartPosition, TileTypes } from '@sports-alliance/sports-lib';
import type { EChartsOption, LineSeriesOption, SeriesOption } from 'echarts';
import type { DashboardChartPreview } from './dashboard-chart-preview.helper';
import type { DashboardChartTileViewModel, DashboardMapTileViewModel } from './dashboard-tile-view-model.helper';
import type { DashboardFormPoint } from './dashboard-form.helper';
import type { DashboardDerivedTrendPoint } from './dashboard-derived-metrics.helper';
import { buildDashboardCartesianPoints } from './dashboard-echarts-cartesian.helper';
import { buildOfficialEChartsThemeTokens } from './echarts-theme.helper';
import { buildRoutePreviewMapTracks } from './route-preview-map.helper';
import { resolveActiveRecoveryTotalSeconds, resolveRemainingRecoverySeconds } from './dashboard-recovery-now.helper';
import { AppColors } from '../services/color/app.colors';
import * as C from './dashboard-special-chart-types';

type Point = [number, number | null];
const MAX_POINTS = 48;
const PALETTE = [AppColors.Blue, AppColors.Green, AppColors.Orange, AppColors.Purple, AppColors.Pink];

function sample<T>(points: readonly T[]): T[] {
  if (points.length <= MAX_POINTS) return [...points];
  return Array.from({ length: MAX_POINTS }, (_, index) => points[Math.round(index * (points.length - 1) / (MAX_POINTS - 1))]);
}

function line(points: Point[], color: string, area = false, dashed = false): LineSeriesOption {
  return {
    type: 'line', data: sample(points), showSymbol: points.length === 1, symbolSize: 3,
    silent: true, animation: false, connectNulls: false, emphasis: { disabled: true },
    lineStyle: { width: 1.3, color, type: dashed ? 'dashed' : 'solid' }, itemStyle: { color },
    ...(area ? { areaStyle: { color, opacity: .1 } } : {}),
  };
}

/** Decorative chart shapes only: no axes, numeric labels, tooltips, data reads or interactions.
 * Values and units remain in the full preview's existing canonical chart renderers. */
export function buildDashboardChartThumbnailOption(preview: DashboardChartPreview, darkTheme: boolean): EChartsOption {
  const theme = buildOfficialEChartsThemeTokens(darkTheme);
  const base: EChartsOption = {
    animation: false, backgroundColor: 'transparent', color: PALETTE, aria: { enabled: false },
    tooltip: { show: false, triggerOn: 'none' }, legend: { show: false },
    grid: { left: 2, right: 2, top: 3, bottom: 3, containLabel: false },
    xAxis: { type: 'value', show: false, min: 'dataMin', max: 'dataMax' },
    yAxis: { type: 'value', show: false, scale: true },
  };
  const cartesian = (series: SeriesOption[]): EChartsOption => ({ ...base, series });
  const bars = (values: (number | null)[][], colors: string[] = PALETTE, stacked = false): EChartsOption => ({
    ...base, xAxis: { type: 'category', show: false, data: values[0]?.map((_, index) => index) || [] },
    yAxis: { type: 'value', show: false, min: 0 },
    series: values.map((data, index) => ({ type: 'bar', data, barMaxWidth: 8, stack: stacked ? 'total' : undefined,
      silent: true, animation: false, itemStyle: { color: colors[index % colors.length] }, emphasis: { disabled: true } })),
  });
  const pie = (values: number[]): EChartsOption => ({ ...base, series: [{ type: 'pie', radius: ['38%', '90%'],
    data: values.map(value => ({ value })), label: { show: false }, labelLine: { show: false },
    silent: true, animation: false, emphasis: { disabled: true } }] });

  if (preview.tile.type === TileTypes.Map) {
    const map = preview.tile as DashboardMapTileViewModel;
    if (map.mapSource === 'routes') {
      return cartesian(buildRoutePreviewMapTracks(map.routePreviews.slice(0, 1)).slice(0, 3)
        .map(track => line(track.positions.map(point => [point.longitudeDegrees, point.latitudeDegrees]), track.strokeColor)));
    }
    const points = sample(map.events).flatMap(event => {
      const stat = event.getStat(DataStartPosition.type);
      const position = (stat ? stat.getValue() : undefined) as { longitudeDegrees?: number; latitudeDegrees?: number } | undefined;
      return Number.isFinite(position?.longitudeDegrees) && Number.isFinite(position?.latitudeDegrees)
        ? [[position!.longitudeDegrees, position!.latitudeDegrees]] : [];
    });
    return cartesian([{ type: 'scatter', data: points, symbolSize: 5, silent: true,
      itemStyle: { color: AppColors.Blue, opacity: .75 }, emphasis: { disabled: true } }]);
  }

  const tile = preview.tile as DashboardChartTileViewModel;
  const type = `${tile.chartType}`;
  if (type === C.DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE) {
    const anchor = new Date(preview.anchorMs);
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const activeDays = new Set(preview.calendarEvents.filter(event => event.startDate.getFullYear() === first.getFullYear()
      && event.startDate.getMonth() === first.getMonth()).map(event => event.startDate.getDate()));
    const days = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    return { ...base, xAxis: { type: 'value', show: false, min: -.5, max: 6.5 },
      yAxis: { type: 'value', show: false, min: -.5, max: 5.5, inverse: true },
      series: [{ type: 'scatter', symbol: 'rect', symbolSize: [5, 4], silent: true, emphasis: { disabled: true },
        data: Array.from({ length: days }, (_, index) => ({ value: [(offset + index) % 7, Math.floor((offset + index) / 7)],
          itemStyle: { color: activeDays.has(index + 1) ? AppColors.Blue : theme.splitLineColor } })) }] };
  }
  if (type === C.DASHBOARD_RECOVERY_NOW_CHART_TYPE) {
    const total = resolveActiveRecoveryTotalSeconds(tile.recoveryNow) ?? 0;
    const left = resolveRemainingRecoverySeconds(tile.recoveryNow) ?? 0;
    return pie([left, Math.max(0, total - left)]);
  }
  if (type === C.DASHBOARD_FORM_CHART_TYPE) {
    const points = tile.data as DashboardFormPoint[];
    return cartesian([line(points.map(point => [point.time, point.ctl]), theme.trendLineColor),
      line(points.map(point => [point.time, point.atl]), '#e91e63'),
      line(points.map(point => [point.time, point.formSameDay]), '#4caf50')]);
  }
  if (type === C.DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE) {
    const points = tile.freshnessForecast?.points || [];
    return cartesian([line(points.map(point => [point.dayMs, point.ctl]), theme.trendLineColor),
      line(points.map(point => [point.dayMs, point.atl]), '#e91e63'),
      line(points.map(point => [point.dayMs, point.formSameDay]), '#4caf50', false, true)]);
  }
  if (type === C.DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE || type === C.DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE) {
    const weeks = (tile.intensityDistribution?.weeks || []).slice(-12);
    return bars([weeks.map(week => week.easySeconds), weeks.map(week => week.moderateSeconds), weeks.map(week => week.hardSeconds)],
      ['#43a047', '#fb8c00', '#e53935'], true);
  }
  if (type === C.DASHBOARD_POWER_CURVE_CHART_TYPE) {
    return { ...cartesian((tile.powerCurve?.series || []).slice(0, 3).map((series, index) =>
      line(series.points.map(point => [point.duration, point.power]), index ? AppColors.Blue : theme.trendLineColor))),
      xAxis: { type: 'log', show: false, min: 'dataMin', max: 'dataMax' } };
  }
  if (type === C.DASHBOARD_EFFICIENCY_TREND_CHART_TYPE) {
    return cartesian([line((tile.efficiencyTrend?.points || []).map(point => [point.weekStartMs, point.value]), theme.trendLineColor)]);
  }
  if (type === C.DASHBOARD_SLEEP_TREND_CHART_TYPE) {
    const points = sample(tile.sleepTrend?.points || []);
    return bars([points.map(point => point.deepSeconds), points.map(point => point.lightSeconds), points.map(point => point.remSeconds)],
      [AppColors.DeepBlue, AppColors.Blue, AppColors.Purple], true);
  }
  if (C.isDashboardKpiChartType(type)) {
    const trends: Record<string, DashboardDerivedTrendPoint[] | undefined> = {
      [C.DASHBOARD_ACWR_KPI_CHART_TYPE]: tile.acwr?.trend8Weeks,
      [C.DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: tile.rampRate?.trend8Weeks,
      [C.DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: tile.monotonyStrain?.trend8Weeks,
      [C.DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE]: tile.formNow?.trend8Weeks,
      [C.DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: tile.formNow?.trend8Weeks,
      [C.DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE]: tile.formNow?.trend8Weeks,
      [C.DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE]: tile.fitnessCtl?.trend8Weeks,
      [C.DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE]: tile.fitnessCtl?.trend8Weeks,
      [C.DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE]: tile.fatigueAtl?.trend8Weeks,
      [C.DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE]: tile.fatigueAtl?.trend8Weeks,
      [C.DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: tile.formPlus7d?.trend8Weeks,
      [C.DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: tile.easyPercent?.trend8Weeks,
      [C.DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: tile.hardPercent?.trend8Weeks,
      [C.DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: tile.efficiencyDelta4w?.trend8Weeks,
      [C.DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE]: tile.aerobicCapacity?.trend,
      [C.DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE]: tile.aerobicDurability?.trend,
    };
    return cartesian([line((trends[type] || []).map(point => [point.time, point.value]), AppColors.Blue, true)]);
  }

  const points = sample(buildDashboardCartesianPoints({ data: tile.data, chartDataValueType: tile.dataValueType,
    chartDataCategoryType: tile.dataCategoryType, chartDataTimeInterval: tile.timeInterval }));
  if (tile.chartType === ChartTypes.Pie) return pie(points.map(point => point.value ?? 0));
  if (tile.chartType === ChartTypes.LinesVertical || tile.chartType === ChartTypes.LinesHorizontal) {
    return cartesian([line(points.map((point, index) => [point.time ?? index, point.value]), AppColors.Blue)]);
  }
  const option = bars([points.map(point => point.value)]);
  if (tile.chartType === ChartTypes.ColumnsHorizontal) {
    option.xAxis = { type: 'value', show: false, min: 0 };
    option.yAxis = { type: 'category', show: false, data: points.map((_, index) => index) };
  }
  if (tile.chartType === ChartTypes.PyramidsVertical) {
    option.series = [{ type: 'pictorialBar', symbol: 'triangle', data: points.map(point => point.value),
      silent: true, animation: false, itemStyle: { color: AppColors.Blue }, emphasis: { disabled: true } }];
  }
  return option;
}
