import { DataStartPosition, TileTypes } from '@sports-alliance/sports-lib';
import type { DashboardPreviewInput } from './dashboard-chart-preview.helper';
import type { DashboardChartTileViewModel, DashboardMapTileViewModel, DashboardTileViewModel } from './dashboard-tile-view-model.helper';
import type { DashboardDerivedMetricStatus } from './derived-metric-status.helper';
import { isDerivedMetricPendingStatus } from './derived-metric-status.helper';
import { isRenderableRoutePreview } from './route-preview-map.helper';
import { filterDashboardDerivedWeeklyRange, normalizeDashboardDerivedChartRange } from './dashboard-derived-chart-range.helper';
import { resolveDashboardKpiTrendDelta } from './dashboard-kpi-sparkline.helper';
import * as C from './dashboard-special-chart-types';

export interface DashboardChartAvailability {
  state: 'ready' | 'history' | 'no-data' | 'loading' | 'updating' | 'error';
  label: string;
  reason: string;
  hasData: boolean;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Check the actual plotted fields, not truthy context objects or provider connections. */
export function dashboardChartHasRecordedData(tile: DashboardTileViewModel, input: DashboardPreviewInput): boolean {
  if (!tile) return false;
  if (tile.type === TileTypes.Map) {
    const map = tile as DashboardMapTileViewModel;
    if (map.mapSource === 'routes') return map.routePreviews?.some(route => isRenderableRoutePreview(route.preview)) === true;
    return map.events?.some(event => {
      const point = (event.getStat?.(DataStartPosition.type) as DataStartPosition | undefined)?.getValue();
      return finite(point?.latitudeDegrees) && finite(point?.longitudeDegrees)
        && Math.abs(point.latitudeDegrees) <= 90 && Math.abs(point.longitudeDegrees) <= 180;
    }) === true;
  }
  const chart = tile as DashboardChartTileViewModel;
  const type = `${chart.chartType}`;
  const range = normalizeDashboardDerivedChartRange(chart.displaySettings?.derivedChartRange);
  const intensity = () => filterDashboardDerivedWeeklyRange(chart.intensityDistribution?.weeks || [], range)
    .some(week => [week.easySeconds, week.moderateSeconds, week.hardSeconds].some(value => finite(value) && value > 0));
  switch (type) {
    case C.DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE: {
      const now = new Date();
      return input.events?.some(event => event.startDate?.getFullYear() === now.getFullYear() && event.startDate?.getMonth() === now.getMonth()) === true;
    }
    case C.DASHBOARD_FORM_CHART_TYPE: return chart.data?.some(point => finite(point['ctl']) && finite(point['atl']) && point['trainingStressScore'] > 0) === true;
    case C.DASHBOARD_RECOVERY_NOW_CHART_TYPE: return finite(chart.recoveryNow?.totalSeconds) && chart.recoveryNow.totalSeconds > 0;
    case C.DASHBOARD_ACWR_KPI_CHART_TYPE: return finite(chart.acwr?.ratio);
    case C.DASHBOARD_RAMP_RATE_KPI_CHART_TYPE: return finite(chart.rampRate?.rampRate);
    case C.DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE: return finite(chart.monotonyStrain?.monotony) || finite(chart.monotonyStrain?.strain);
    case C.DASHBOARD_FORM_NOW_KPI_CHART_TYPE:
    case C.DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE: return finite(chart.formNow?.value);
    case C.DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE: return finite(chart.fitnessCtl?.value);
    case C.DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE: return finite(chart.fatigueAtl?.value);
    case C.DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE: return finite(resolveDashboardKpiTrendDelta(chart.fitnessCtl?.trend8Weeks || [], 4));
    case C.DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE: return finite(resolveDashboardKpiTrendDelta(chart.fatigueAtl?.trend8Weeks || [], 4));
    case C.DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE: return finite(chart.formPlus7d?.value);
    case C.DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE: return finite(chart.formNow?.value) && chart.freshnessForecast?.points?.some(point => point.isForecast && finite(point.formSameDay)) === true;
    case C.DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE: return finite(chart.easyPercent?.value);
    case C.DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE: return finite(chart.hardPercent?.value);
    case C.DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE: return intensity() && finite(chart.intensityDistribution?.latestEasyPercent) && finite(chart.intensityDistribution?.latestHardPercent);
    case C.DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE: return intensity();
    case C.DASHBOARD_EFFICIENCY_TREND_CHART_TYPE: return filterDashboardDerivedWeeklyRange(chart.efficiencyTrend?.points || [], range).some(point => finite(point.value) && point.sampleCount > 0);
    case C.DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE: return finite(chart.efficiencyDelta4w?.deltaPct);
    case C.DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE: return finite(chart.aerobicCapacity?.value) && chart.aerobicCapacity.observationCount > 0;
    case C.DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE: return finite(chart.aerobicDurability?.value) && chart.aerobicDurability.sampleCount > 0;
    case C.DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE: return chart.freshnessForecast?.points?.some(point => point.isForecast && finite(point.formSameDay)) === true;
    case C.DASHBOARD_SLEEP_TREND_CHART_TYPE: return chart.sleepTrend?.hasRealPoints === true;
    case C.DASHBOARD_HRV_TREND_CHART_TYPE: return chart.hrvTrend?.charts?.some(item => item.model.series.points.some(point => finite(point.value))) === true;
    case C.DASHBOARD_POWER_CURVE_CHART_TYPE: return chart.powerCurve?.matchedEventCount > 0 && chart.powerCurve.series?.some(series => series.points.some(point => finite(point.power) && point.power > 0)) === true;
    default: return chart.data?.some(row => finite(row[chart.dataValueType])) === true;
  }
}

function needsHistory(chart: DashboardChartTileViewModel): boolean {
  if (C.isDashboardEfficiencyDelta4wKpiChartType(chart.chartType)) return finite(chart.efficiencyDelta4w?.latestValue) && chart.efficiencyDelta4w.baselineWeekCount === 0;
  if (C.isDashboardFitnessTrendKpiChartType(chart.chartType)) return finite(chart.fitnessCtl?.value) && !finite(resolveDashboardKpiTrendDelta(chart.fitnessCtl.trend8Weeks, 4));
  if (C.isDashboardFatigueTrendKpiChartType(chart.chartType)) return finite(chart.fatigueAtl?.value) && !finite(resolveDashboardKpiTrendDelta(chart.fatigueAtl.trend8Weeks, 4));
  return false;
}

export function resolveDashboardChartAvailability(tile: DashboardTileViewModel, input: DashboardPreviewInput,
  sources: readonly ('loading' | 'ready' | 'error' | undefined)[] = [],
  metrics: readonly (DashboardDerivedMetricStatus | undefined)[] = [],
): DashboardChartAvailability {
  const hasData = dashboardChartHasRecordedData(tile, input);
  const result = (state: DashboardChartAvailability['state'], label: string, reason: string): DashboardChartAvailability => ({ state, label, reason, hasData });
  const hrv = tile?.type === TileTypes.Chart && C.isDashboardHrvTrendChartType(tile['chartType']) ? (tile as DashboardChartTileViewModel).hrvTrend : null;
  if (sources.includes('error') || metrics.includes('failed') || hrv?.error) return result('error', 'Could not load your data', hasData ? 'Showing your last available data. Reopen the library to try again.' : 'Reopen the library to try again. The preview shows example data.');
  if (sources.includes('loading') || hrv?.loading) return result(hasData ? 'updating' : 'loading', hasData ? 'Updating your data' : 'Loading your data', '');
  if (metrics.some(isDerivedMetricPendingStatus)) return result('updating', 'Updating chart data', hasData ? 'Showing your last available data while this chart updates.' : 'Your chart data is being prepared. The preview shows example data.');
  if (hasData) return result('ready', 'Ready with your data', '');
  if (tile?.type === TileTypes.Chart && needsHistory(tile as DashboardChartTileViewModel)) return result('history', 'Needs more history', 'Some readings are available. More history is needed for this comparison.');
  if (metrics.includes('missing')) return result('updating', 'Waiting for chart data', 'This chart does not have prepared data yet. The preview shows example data.');
  return result('no-data', 'No data in this period', 'No matching data was found for this preview period. The preview shows example data.');
}
