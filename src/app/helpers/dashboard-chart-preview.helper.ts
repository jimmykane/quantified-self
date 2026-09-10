import { normalizeDashboardTileEventFilters } from './dashboard-tile-event-filters.helper';
import { getDashboardPowerCurveScopeDefinition, resolveDashboardPowerCurveTileDisplayScope } from './dashboard-power-curve-scope.helper';
import { ActivityTypes, DataActivityTypes, DataAscent, DataDistance, DataDuration, DataEnergy, DataHeartRateAvg, DataStartPosition, EventInterface, FileType, Privacy, SportsLib, TileChartSettingsInterface, TileSettingsInterface, TileTypes, encodeRoutePolyline5 } from '@sports-alliance/sports-lib';
import type { FirestoreRouteJSON } from '@shared/app-route.interface';
import { DERIVED_METRIC_KINDS as M, DerivedMetricKind } from '@shared/derived-metrics';
import * as C from './dashboard-special-chart-types';
import { buildDashboardTileViewModels, DashboardChartTileViewModel, DashboardTileViewModel } from './dashboard-tile-view-model.helper';
import { buildHomeSignalChartsPreviewData, HOME_SIGNAL_CHARTS_PREVIEW_ANCHOR_MS as ANCHOR } from './dashboard-chart-example-signals.helper';
import { buildDashboardHrvTrendModel } from './dashboard-hrv-chart.helper';
import { SLEEP_PROVIDERS } from '@shared/sleep';
import type { DashboardSleepTrendPoint } from './dashboard-sleep-chart.helper';

export type DashboardPreviewInput = Parameters<typeof buildDashboardTileViewModels>[0] & { tileEventAnchorsByOrder?: Record<number, number | null> };
/** Reuse only a current window; saved orders cannot be used for candidate previews. */
export function buildDashboardPreviewSeed(tile: TileSettingsInterface, seed: DashboardPreviewInput, now = Date.now()): DashboardPreviewInput {
  const range = normalizeDashboardTileEventFilters(tile['eventFilters']).range;
  const saved = seed.tiles.find(candidate => !seed.tileEventAnchorsByOrder?.[candidate.order]
    && normalizeDashboardTileEventFilters(candidate['eventFilters']).range === range
    && seed.tileEventsByOrder?.[candidate.order]);
  const input: DashboardPreviewInput = { ...seed, tiles: [tile], events: saved ? seed.tileEventsByOrder?.[saved.order] || [] : [], tileEventsByOrder: null };
  const window = seed.sleepTrendWindow;
  if (!window || Math.abs(now - window.endMs) > 86400000 || Math.abs(window.endMs - window.startMs - 14*86400000) > 86400000) input.sleepSessions = [];
  return input;
}

export interface DashboardChartPreview {
  tile: DashboardTileViewModel;
  source: 'user' | 'example';
  loading: boolean;
  note: string;
  calendarEvents: EventInterface[];
  anchorMs: number;
}

/** List previews use current, already-loaded data only. Missing sources stay explicit examples. */
export function buildDashboardThumbnailPreview(tile: TileSettingsInterface, seed: DashboardPreviewInput): DashboardChartPreview {
  const input = buildDashboardPreviewSeed(tile, seed);
  const existing = buildDashboardTileViewModels(input)[0];
  const type = `${tile['chartType'] || ''}`;
  if (C.isDashboardKpiChartType(type) && type !== C.DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE) {
    const context = existing[contexts[type]] as { trend8Weeks?: { value: number | null }[]; trend?: { value: number | null }[] } | undefined;
    // A headline alone cannot draw a sparkline. Keep its illustrative fallback labelled as example data.
    if (!(context?.trend8Weeks || context?.trend)?.some(point => Number.isFinite(point.value))) return buildDashboardExamplePreview(tile);
  }
  return dashboardPreviewHasData(existing, input)
    ? { tile: existing, source: 'user', loading: false, note: '', calendarEvents: input.events || [], anchorMs: Date.now() }
    : buildDashboardExamplePreview(tile);
}

const DAY = 86400000;
const K = C;
const contexts: Record<string, keyof DashboardChartTileViewModel> = {
  [K.DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'recoveryNow', [K.DASHBOARD_FORM_CHART_TYPE]: 'absoluteLatestFormPoint',
  [K.DASHBOARD_ACWR_KPI_CHART_TYPE]: 'acwr', [K.DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: 'rampRate',
  [K.DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'monotonyStrain', [K.DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'formNow',
  [K.DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE]: 'formNow', [K.DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE]: 'fitnessCtl',
  [K.DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE]: 'fitnessCtl', [K.DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE]: 'fatigueAtl',
  [K.DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE]: 'fatigueAtl', [K.DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE]: 'formNow',
  [K.DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'formPlus7d', [K.DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: 'easyPercent',
  [K.DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: 'hardPercent', [K.DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE]: 'intensityDistribution',
  [K.DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: 'efficiencyDelta4w', [K.DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: 'freshnessForecast',
  [K.DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'intensityDistribution', [K.DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'efficiencyTrend',
  [K.DASHBOARD_SLEEP_TREND_CHART_TYPE]: 'sleepTrend', [K.DASHBOARD_HRV_TREND_CHART_TYPE]: 'sleepTrend', [K.DASHBOARD_POWER_CURVE_CHART_TYPE]: 'powerCurve',
  [K.DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE]: 'aerobicCapacity', [K.DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE]: 'aerobicDurability',
};
const metricKinds: Partial<Record<keyof DashboardChartTileViewModel, DerivedMetricKind[]>> = {
  recoveryNow: [M.RecoveryNow], absoluteLatestFormPoint: [M.Form], acwr: [M.Acwr], rampRate: [M.RampRate],
  monotonyStrain: [M.MonotonyStrain], formNow: [M.FormNow, M.Form, M.RampRate], fitnessCtl: [M.Form], fatigueAtl: [M.Form],
  formPlus7d: [M.FormPlus7d], easyPercent: [M.EasyPercent], hardPercent: [M.HardPercent], efficiencyDelta4w: [M.EfficiencyDelta4w],
  freshnessForecast: [M.FreshnessForecast], intensityDistribution: [M.IntensityDistribution], efficiencyTrend: [M.EfficiencyTrend],
  powerCurve: [M.PowerCurve], aerobicCapacity: [M.TrainingCapacity], aerobicDurability: [M.TrainingDurability],
};
export function dashboardPreviewMetricKinds(tile: TileSettingsInterface): DerivedMetricKind[] {
  return metricKinds[contexts[(tile as TileChartSettingsInterface).chartType]] || [];
}
export function dashboardPreviewHasData(tile: DashboardTileViewModel, input: DashboardPreviewInput): boolean {
  if (tile.type === TileTypes.Map) return tile['mapSource'] === 'routes' ? !!tile['routePreviews']?.length : !!tile['events']?.length;
  const chart = tile as DashboardChartTileViewModel;
  if (`${chart.chartType}` === K.DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE) return !!input.events?.length;
  const context = contexts[chart.chartType];
  if (C.isDashboardHrvTrendChartType(chart.chartType)) return buildDashboardHrvTrendModel(chart.sleepTrend).hasData;
  if (context === 'sleepTrend') return chart.sleepTrend?.hasRealPoints === true;
  if (context === 'powerCurve') return !!chart.powerCurve?.series?.length;
  return context ? !!chart[context] : !!chart.data?.length;
}

export function buildDashboardExampleEvents(anchorMs = ANCHOR): EventInterface[] {
  return Array.from({ length: 18 }, (_, index) => {
    const start = new Date(anchorMs - index * DAY * 2);
    const seconds = 2400 + index * 180;
    const end = new Date(+start + seconds * 1000);
    const stats = { [DataActivityTypes.type]: [index % 2 ? ActivityTypes.Running : ActivityTypes.Cycling], [DataDuration.type]: seconds, [DataDistance.type]: 5000 + index * 1700, [DataAscent.type]: 80 + index * 20,
      [DataEnergy.type]: 350 + index * 30, [DataHeartRateAvg.type]: 135 + index % 15,
      [DataStartPosition.type]: { latitudeDegrees: 60.17 + index % 4 * .002, longitudeDegrees: 24.94 + index % 5 * .003 } };
    return SportsLib.importFromJSON({ id: `example-${index}`, name: 'Example activity', startDate: +start, endDate: +end,
      srcFileType: 'json' as FileType, privacy: Privacy.Private, description: null, isMerge: false, stats,
      activities: [{ id: `example-activity-${index}`, name: 'Example activity', startDate: +start, endDate: +end,
        type: index % 2 ? ActivityTypes.Running : ActivityTypes.Cycling, powerMeter: false, trainer: false, stats,
        streams: [], laps: [], intensityZones: [], events: [], creator: { name: 'Example', devices: [] } }] }).setID(`example-${index}`);
  });
}
export function buildDashboardExampleRoutes(): FirestoreRouteJSON[] {
  const points = [[60.170,24.940],[60.173,24.942],[60.175,24.947],[60.171,24.953],[60.168,24.947],[60.170,24.940]];
  return [{ id: 'example-route', userID: '', name: 'Example route', srcFileType: 'gpx', createdAt: null,
    routes: [], routeCount: 1, waypointCount: 0, pointCount: points.length, activityTypes: [ActivityTypes.Running], streamTypes: [],
    preview: { version: 1, encoding: 'polyline5', precision: 5, sourcePointCount: points.length, pointCount: points.length,
      segments: [{ id: 'example-segment', name: 'Example route', sourcePointCount: points.length, pointCount: points.length,
        encodedPolyline: encodeRoutePolyline5(points.map(([latitudeDegrees,longitudeDegrees]) => ({latitudeDegrees,longitudeDegrees}))) }] } }];
}

export function buildDashboardExamplePreview(tile: TileSettingsInterface): DashboardChartPreview {
  const examples = buildHomeSignalChartsPreviewData(ANCHOR);
  const events = buildDashboardExampleEvents();
  const input: DashboardPreviewInput = { tiles: [tile], events, routePreviews: buildDashboardExampleRoutes(), derivedMetrics: { formPoints: examples.formTimeline } };
  const vm = buildDashboardTileViewModels(input)[0];
  const trend = (value: number) => Array.from({ length: 8 }, (_, i) => ({ time: ANCHOR - (7-i)*7*DAY, value: value * (.8+i*.03) }));
  const current = (value: number) => ({ value, latestDayMs: ANCHOR, trend8Weeks: trend(value) });
  if (vm.type === TileTypes.Chart) Object.assign(vm, {
    acwr: { ratio: 1.12, acuteLoad7: 430, chronicLoad28: 384, latestDayMs: ANCHOR, trend8Weeks: trend(1.12) },
    rampRate: { ctlToday: 62, ctl7DaysAgo: 58, rampRate: 4, latestDayMs: ANCHOR, trend8Weeks: trend(4) },
    monotonyStrain: { weeklyLoad7: 430, monotony: 1.3, strain: 559, latestDayMs: ANCHOR, trend8Weeks: trend(559) },
    formNow: current(8), fitnessCtl: current(62), fatigueAtl: current(54),
    formPlus7d: { ...current(21), projectedDayMs: ANCHOR + 7*DAY },
    easyPercent: { ...current(72), latestWeekStartMs: ANCHOR }, hardPercent: { ...current(12), latestWeekStartMs: ANCHOR },
    efficiencyDelta4w: { latestWeekStartMs: ANCHOR, latestValue: 1.6, baselineValue: 1.5, baselineWeekCount: 4, deltaAbs: .1, deltaPct: 6.7, trend8Weeks: trend(1.6) },
    freshnessForecast: examples.freshnessForecast, intensityDistribution: examples.intensityDistribution, efficiencyTrend: examples.efficiencyTrend,
    powerCurve: examples.powerCurve,
    aerobicCapacity: { value: 52, discipline: 'running', sourceKey: null, sourceLabel: 'Example source', observationCount: 8, changePct: 4, lastSeenAtMs: ANCHOR, trend: trend(52) },
    aerobicDurability: { value: 3.2, metric: 'decoupling', scopeLabel: 'Cycling', contextLabel: 'Example long rides', sampleCount: 8, eligibilityRatio: .8, trend: trend(3.2) },
    // Recovery renderer uses wall-clock decay: keep this isolated synthetic context relative to now.
    recoveryNow: { totalSeconds: 86400, endTimeMs: Date.now() + 36000000, latestWorkoutSeconds: 86400, latestWorkoutEndTimeMs: Date.now() + 36000000 },
  } satisfies Partial<DashboardChartTileViewModel>);
  if (vm.type === TileTypes.Chart && `${(vm as DashboardChartTileViewModel).chartType}` === K.DASHBOARD_POWER_CURVE_CHART_TYPE) {
    const label = getDashboardPowerCurveScopeDefinition(resolveDashboardPowerCurveTileDisplayScope(tile)).latestSeriesLabel;
    (vm as DashboardChartTileViewModel).powerCurve = { ...examples.powerCurve, latestSeriesLabel: label, comparisonSeriesLabel: label,
      series: examples.powerCurve.series.map(series => series.seriesKey === 'latest' ? { ...series, label } : series) };
  }
  if (vm.type === TileTypes.Chart && C.isDashboardSleepBackedChartType((vm as DashboardChartTileViewModel).chartType)) {
    const points: DashboardSleepTrendPoint[] = Array.from({ length: 14 }, (_, i) => ({
      id: `example-sleep-${i}`, sleepDate: new Date(ANCHOR-(13-i)*DAY).toISOString().slice(0,10), provider: SLEEP_PROVIDERS.GarminAPI, providerLabel: 'Example source', categoryLabel: '',
      startTimeMs: ANCHOR-(13-i)*DAY-28000000, endTimeMs: ANCHOR-(13-i)*DAY, totalSeconds: 26000+i%3*1200,
      deepSeconds: 5400, lightSeconds: 14000+i%3*1200, remSeconds: 6600, awakeSeconds: 900, unknownSeconds: 0,
      score: null, averageHeartRateBpm: null, minimumHeartRateBpm: null, averageHrvMs: C.isDashboardHrvTrendChartType(tile['chartType']) ? [48, 51, 47, 54, 50, 56, 53, 58, 55, 60, 54, 59, 62, 57][i] : null, maxSpo2Percent: null,
      isNap: false, napSeconds: 0, napCount: 0, napAverageHrvMs: null, napAverageHeartRateBpm: null, napStartTimeMs: null, napEndTimeMs: null,
    }));
    (vm as DashboardChartTileViewModel).sleepTrend = { points, latestPoint: points.at(-1)!, hasRealPoints: true };
  }
  return { tile: vm, source: 'example', loading: false, note: 'Your data is not available for this chart yet.', calendarEvents: events, anchorMs: ANCHOR };
}
