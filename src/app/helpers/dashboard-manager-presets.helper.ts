import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAscent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRateAvg,
  DataSleepHRVAvg,
  DataRecoveryTime,
  MapThemes,
  TileChartSettingsInterface,
  TileMapSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { MapStyleName } from '../services/map/map-style.types';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
  DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  DASHBOARD_HRV_TREND_CHART_TYPE,
  isDashboardSleepBackedChartType,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
  type DashboardChartCategory,
  type DashboardCuratedChartType,
  type DashboardKpiGroup,
  type DashboardKpiChartType,
} from './dashboard-special-chart-types';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from './dashboard-form.helper';
import { getDefaultDashboardChartTileDisplaySettingsForChartType } from './dashboard-chart-display-settings.helper';
import type {
  AppDashboardChartTileSettingsInterface,
  AppDashboardMapTileSettingsInterface,
  AppDashboardMapTileSource,
} from '../models/app-user.interface';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { buildDashboardPowerCurveAutoTile } from './dashboard-auto-tile.helper';
import { buildDashboardActivityCalendarTile } from './dashboard-activity-calendar.helper';
import type { DashboardPowerCurveScope } from './dashboard-power-curve-scope.helper';

export const DASHBOARD_MANAGER_PRESET_IDS = {
  CURATED_RECOVERY: 'curated-recovery',
  CURATED_ACTIVITY_CALENDAR: 'curated-activity-calendar',
  CURATED_FORM: 'curated-form',
  CURATED_FRESHNESS_FORECAST: 'curated-freshness-forecast',
  CURATED_INTENSITY_DISTRIBUTION: 'curated-intensity-distribution',
  CURATED_EFFICIENCY_TREND: 'curated-efficiency-trend',
  CURATED_SLEEP: 'curated-sleep',
  CURATED_HRV: 'curated-hrv',
  CURATED_POWER_CURVE: 'curated-power-curve',
  CURATED_RUNNING_POWER_CURVE: 'curated-running-power-curve',
  KPI_ACWR: 'kpi-acwr',
  KPI_RAMP_RATE: 'kpi-ramp-rate',
  KPI_MONOTONY_STRAIN: 'kpi-monotony-strain',
  KPI_LOAD_STATUS: 'kpi-load-status',
  KPI_FORM_NOW: 'kpi-form-now',
  KPI_FITNESS_CTL: 'kpi-fitness-ctl',
  KPI_FATIGUE_ATL: 'kpi-fatigue-atl',
  KPI_FITNESS_TREND: 'kpi-fitness-trend',
  KPI_FATIGUE_TREND: 'kpi-fatigue-trend',
  KPI_RECOVERY_DEBT: 'kpi-recovery-debt',
  KPI_FORM_PLUS_7D: 'kpi-form-plus-7d',
  KPI_TRAINING_BALANCE: 'kpi-training-balance',
  KPI_EASY_PERCENT: 'kpi-easy-percent',
  KPI_HARD_PERCENT: 'kpi-hard-percent',
  KPI_EFFICIENCY_DELTA_4W: 'kpi-efficiency-delta-4w',
  KPI_AEROBIC_CAPACITY: 'kpi-aerobic-capacity',
  KPI_AEROBIC_DURABILITY: 'kpi-aerobic-durability',
  MAP_DEFAULT_CLUSTERED: 'map-default-clustered',
  MAP_ROUTES_PREVIEW: 'map-routes-preview',
  CUSTOM_DURATION_PIE: 'custom-duration-pie',
  CUSTOM_DISTANCE_COLUMNS: 'custom-distance-columns',
  CUSTOM_ASCENT_PYRAMIDS: 'custom-ascent-pyramids',
  CUSTOM_ENERGY_TREND: 'custom-energy-trend',
  CUSTOM_HEART_RATE_AVG_BY_ACTIVITY: 'custom-heart-rate-avg-by-activity',
  CUSTOM_WEEKLY_DISTANCE_TREND: 'custom-weekly-distance-trend',
  CUSTOM_WEEKLY_TRAINING_TIME: 'custom-weekly-training-time',
  CUSTOM_ACTIVITY_MIX_DISTANCE_PIE: 'custom-activity-mix-distance-pie',
} as const;

export type DashboardManagerPresetId =
  typeof DASHBOARD_MANAGER_PRESET_IDS[keyof typeof DASHBOARD_MANAGER_PRESET_IDS];

export type DashboardManagerPresetCategory = DashboardChartCategory | 'map';

export interface DashboardManagerPresetTileSize {
  columns: number;
  rows: number;
}

export type DashboardManagerPresetEligibilityKey =
  | 'activity-history'
  | 'sleep'
  | 'cycling-power'
  | 'running-power'
  | 'aerobic-capacity'
  | 'aerobic-durability'
  | 'event-map'
  | 'routes';

export type DashboardManagerPresetEligibility = Record<DashboardManagerPresetEligibilityKey, boolean>;

interface DashboardManagerPresetBaseDefinition {
  id: DashboardManagerPresetId;
  label: string;
  tileName: string;
  description: string;
  icon: string;
  category: DashboardManagerPresetCategory;
  recommended?: boolean;
  eligibility?: DashboardManagerPresetEligibilityKey;
}

export interface DashboardManagerCuratedPresetDefinition extends DashboardManagerPresetBaseDefinition {
  category: 'curated';
  curatedChartType: DashboardCuratedChartType;
  powerCurveScope?: DashboardPowerCurveScope;
}

export interface DashboardManagerKpiPresetDefinition extends DashboardManagerPresetBaseDefinition {
  category: 'kpi';
  kpiChartType: DashboardKpiChartType;
  kpiGroup: DashboardKpiGroup;
}

export interface DashboardManagerCustomPresetDefinition extends DashboardManagerPresetBaseDefinition {
  category: 'custom';
  chartType: ChartTypes;
  dataType: string;
  dataValueType: ChartDataValueTypes;
  dataCategoryType: ChartDataCategoryTypes;
  dataTimeInterval: TimeIntervals;
}

export interface DashboardManagerMapPresetDefinition extends DashboardManagerPresetBaseDefinition {
  category: 'map';
  mapSource: AppDashboardMapTileSource;
  mapStyle: MapStyleName;
  clusterMarkers: boolean;
  showRouteEndpointMarkers?: boolean;
}

export type DashboardManagerPresetDefinition =
  | DashboardManagerCuratedPresetDefinition
  | DashboardManagerKpiPresetDefinition
  | DashboardManagerCustomPresetDefinition
  | DashboardManagerMapPresetDefinition;

export interface BuildDashboardManagerPresetTileInput {
  presetId: DashboardManagerPresetId;
  order: number;
  size: DashboardManagerPresetTileSize;
}

type DashboardManagerPresetMapTileSettings = TileMapSettingsInterface & { mapStyle?: MapStyleName };

const DASHBOARD_MANAGER_PRESET_DEFINITIONS: DashboardManagerPresetDefinition[] = [
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_RECOVERY,
    label: 'Recovery',
    tileName: 'Recovery',
    description: 'Remaining and elapsed time from your recorded recovery estimates.',
    icon: 'health_and_safety',
    category: 'curated',
    curatedChartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_ACTIVITY_CALENDAR,
    label: 'Activity Calendar',
    tileName: 'Activity calendar',
    description: 'Daily activity time by sport group for the displayed month.',
    icon: 'calendar_month',
    category: 'curated',
    curatedChartType: DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_FORM,
    label: 'Form (TSS)',
    tileName: 'Form',
    description: 'Fitness, fatigue, and form calculated from your training load.',
    icon: 'insights',
    category: 'curated',
    curatedChartType: DASHBOARD_FORM_CHART_TYPE,
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_FRESHNESS_FORECAST,
    label: 'Freshness Forecast',
    tileName: 'Freshness Forecast',
    description: 'How your form could change over 7 days without new training load.',
    icon: 'trending_up',
    category: 'curated',
    curatedChartType: DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_INTENSITY_DISTRIBUTION,
    label: 'Intensity Distribution',
    tileName: 'Intensity Distribution',
    description: 'Weekly time spent at easy, moderate, and hard effort.',
    icon: 'bar_chart',
    category: 'curated',
    curatedChartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_EFFICIENCY_TREND,
    label: 'Efficiency Trend',
    tileName: 'Efficiency Trend',
    description: 'Weekly power relative to heart rate, weighted by workout duration.',
    icon: 'show_chart',
    category: 'curated',
    curatedChartType: DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_SLEEP,
    label: 'Sleep',
    tileName: 'Sleep',
    description: 'Sleep duration, stages, and available overnight readings by source.',
    icon: 'hotel',
    category: 'curated',
    curatedChartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
    recommended: true,
    eligibility: 'sleep',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_HRV,
    label: 'HRV',
    tileName: 'HRV',
    description: 'Recorded HRV by source, with a personal range for eligible nightly readings.',
    icon: 'monitor_heart',
    category: 'curated',
    curatedChartType: DASHBOARD_HRV_TREND_CHART_TYPE,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_POWER_CURVE,
    label: 'Cycling Power Curve',
    tileName: 'Cycling Power Curve',
    description: 'Best power across effort durations for cycling and mountain biking.',
    icon: 'speed',
    category: 'curated',
    curatedChartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
    powerCurveScope: 'cycling',
    recommended: true,
    eligibility: 'cycling-power',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_RUNNING_POWER_CURVE,
    label: 'Running Power Curve',
    tileName: 'Running Power Curve',
    description: 'Best power across effort durations for running and trail running.',
    icon: 'directions_run',
    category: 'curated',
    curatedChartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
    powerCurveScope: 'running',
    recommended: true,
    eligibility: 'running-power',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_ACWR,
    label: 'KPI: ACWR',
    tileName: 'ACWR',
    description: 'Your latest week’s training load compared with your usual weekly load.',
    icon: 'monitoring',
    category: 'kpi',
    kpiChartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
    kpiGroup: 'load',
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_RAMP_RATE,
    label: 'KPI: Ramp Rate',
    tileName: 'Ramp Rate',
    description: 'Change in fitness load over the last 7 days.',
    icon: 'speed',
    category: 'kpi',
    kpiChartType: DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
    kpiGroup: 'load',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_MONOTONY_STRAIN,
    label: 'KPI: Monotony / Strain',
    tileName: 'Monotony / Strain',
    description: 'How repetitive and demanding your recent week of training has been.',
    icon: 'stacked_line_chart',
    category: 'kpi',
    kpiChartType: DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
    kpiGroup: 'load',
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_LOAD_STATUS,
    label: 'KPI: Load Status',
    tileName: 'Load Status',
    description: 'Your current training-load balance, based on form, ramp rate, fitness, and fatigue.',
    icon: 'speed',
    category: 'kpi',
    kpiChartType: DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
    kpiGroup: 'readiness',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_FORM_NOW,
    label: 'KPI: Form Now',
    tileName: 'Form Now',
    description: 'Current freshness or fatigue based on the balance of training load.',
    icon: 'self_improvement',
    category: 'kpi',
    kpiChartType: DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
    kpiGroup: 'readiness',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_FITNESS_CTL,
    label: 'KPI: Fitness (CTL)',
    tileName: 'Fitness (CTL)',
    description: 'Longer-term training load, using a 42-day weighted average.',
    icon: 'fitness_center',
    category: 'kpi',
    kpiChartType: DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
    kpiGroup: 'readiness',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_FATIGUE_ATL,
    label: 'KPI: Fatigue (ATL)',
    tileName: 'Fatigue (ATL)',
    description: 'Recent training load, using a 7-day weighted average.',
    icon: 'battery_alert',
    category: 'kpi',
    kpiChartType: DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
    kpiGroup: 'readiness',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_FITNESS_TREND,
    label: 'KPI: Fitness Trend',
    tileName: 'Fitness Trend',
    description: 'Change in fitness load over the last 4 weeks of available history.',
    icon: 'trending_up',
    category: 'kpi',
    kpiChartType: DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
    kpiGroup: 'load',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_FATIGUE_TREND,
    label: 'KPI: Fatigue Trend',
    tileName: 'Fatigue Trend',
    description: 'Change in fatigue load over the last week of available history.',
    icon: 'moving',
    category: 'kpi',
    kpiChartType: DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
    kpiGroup: 'load',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_RECOVERY_DEBT,
    label: 'KPI: Recovery Debt',
    tileName: 'Recovery Debt',
    description: 'Estimated days without training load until your form reaches neutral.',
    icon: 'hourglass_empty',
    category: 'kpi',
    kpiChartType: DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
    kpiGroup: 'readiness',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_FORM_PLUS_7D,
    label: 'KPI: Form +7d',
    tileName: 'Form +7d',
    description: 'Projected form in 7 days, assuming no new training load.',
    icon: 'trending_up',
    category: 'kpi',
    kpiChartType: DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
    kpiGroup: 'readiness',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_TRAINING_BALANCE,
    label: 'KPI: Training Balance',
    tileName: 'Training Balance',
    description: 'How your latest week’s zone time is split between easy, moderate, and hard effort.',
    icon: 'balance',
    category: 'kpi',
    kpiChartType: DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
    kpiGroup: 'execution',
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_EASY_PERCENT,
    label: 'KPI: Easy %',
    tileName: 'Easy %',
    description: 'Percentage of your latest week’s zone time spent at easy effort.',
    icon: 'wb_sunny',
    category: 'kpi',
    kpiChartType: DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
    kpiGroup: 'execution',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_HARD_PERCENT,
    label: 'KPI: Hard %',
    tileName: 'Hard %',
    description: 'Percentage of your latest week’s zone time spent at hard effort.',
    icon: 'flash_on',
    category: 'kpi',
    kpiChartType: DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
    kpiGroup: 'execution',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_EFFICIENCY_DELTA_4W,
    label: 'KPI: Efficiency Δ (4w)',
    tileName: 'Efficiency Δ (4w)',
    description: 'Change in weekly power-to-heart-rate efficiency against up to 4 prior weeks.',
    icon: 'query_stats',
    category: 'kpi',
    kpiChartType: DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
    kpiGroup: 'execution',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_AEROBIC_CAPACITY,
    label: 'KPI: Aerobic Capacity',
    tileName: 'Aerobic Capacity',
    description: 'Your latest recorded VO2 max and its trend from the same source.',
    icon: 'air',
    category: 'kpi',
    kpiChartType: DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
    kpiGroup: 'execution',
    recommended: true,
    eligibility: 'aerobic-capacity',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_AEROBIC_DURABILITY,
    label: 'KPI: Aerobic Durability',
    tileName: 'Aerobic Durability',
    description: 'How steadily you maintain effort or pace during longer workouts.',
    icon: 'timeline',
    category: 'kpi',
    kpiChartType: DASHBOARD_AEROBIC_DURABILITY_KPI_CHART_TYPE,
    kpiGroup: 'execution',
    recommended: true,
    eligibility: 'aerobic-durability',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.MAP_DEFAULT_CLUSTERED,
    label: 'Map (Default)',
    tileName: 'Clustered HeatMap',
    description: 'Your mapped activities, grouped markers, and areas of repeated activity.',
    icon: 'map',
    category: 'map',
    mapSource: 'events',
    mapStyle: 'default',
    clusterMarkers: true,
    recommended: true,
    eligibility: 'event-map',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.MAP_ROUTES_PREVIEW,
    label: 'Routes map',
    tileName: 'Routes',
    description: 'Your recent saved routes shown together on a map.',
    icon: 'route',
    category: 'map',
    mapSource: 'routes',
    mapStyle: 'default',
    clusterMarkers: false,
    showRouteEndpointMarkers: true,
    recommended: true,
    eligibility: 'routes',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_DURATION_PIE,
    label: 'Duration Pie',
    tileName: 'Duration',
    description: 'How your total activity time is divided between activity types.',
    icon: 'pie_chart',
    category: 'custom',
    chartType: ChartTypes.Pie,
    dataType: DataDuration.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.ActivityType,
    dataTimeInterval: TimeIntervals.Auto,
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_DISTANCE_COLUMNS,
    label: 'Distance Columns',
    tileName: 'Distance',
    description: 'Total recorded distance for each activity type.',
    icon: 'bar_chart',
    category: 'custom',
    chartType: ChartTypes.ColumnsHorizontal,
    dataType: DataDistance.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.ActivityType,
    dataTimeInterval: TimeIntervals.Auto,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_ASCENT_PYRAMIDS,
    label: 'Ascent Pyramids',
    tileName: 'Ascent',
    description: 'Total recorded elevation gain over the selected period.',
    icon: 'landscape',
    category: 'custom',
    chartType: ChartTypes.PyramidsVertical,
    dataType: DataAscent.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Auto,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_ENERGY_TREND,
    label: 'Energy Trend',
    tileName: 'Energy',
    description: 'Total recorded activity energy expenditure over the selected period.',
    icon: 'bolt',
    category: 'custom',
    chartType: ChartTypes.LinesVertical,
    dataType: DataEnergy.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Auto,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_HEART_RATE_AVG_BY_ACTIVITY,
    label: 'HR Avg by Activity',
    tileName: 'Avg HR',
    description: 'Average of recorded activity heart-rate averages, grouped by activity type.',
    icon: 'favorite',
    category: 'custom',
    chartType: ChartTypes.ColumnsHorizontal,
    dataType: DataHeartRateAvg.type,
    dataValueType: ChartDataValueTypes.Average,
    dataCategoryType: ChartDataCategoryTypes.ActivityType,
    dataTimeInterval: TimeIntervals.Auto,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_WEEKLY_DISTANCE_TREND,
    label: 'Weekly Distance Trend',
    tileName: 'Weekly Distance',
    description: 'Total recorded distance for each week in the selected period.',
    icon: 'timeline',
    category: 'custom',
    chartType: ChartTypes.LinesVertical,
    dataType: DataDistance.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Weekly,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_WEEKLY_TRAINING_TIME,
    label: 'Weekly Training Time',
    tileName: 'Weekly Training Time',
    description: 'Total recorded activity time for each week in the selected period.',
    icon: 'schedule',
    category: 'custom',
    chartType: ChartTypes.ColumnsVertical,
    dataType: DataDuration.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Weekly,
    recommended: true,
    eligibility: 'activity-history',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_ACTIVITY_MIX_DISTANCE_PIE,
    label: 'Activity Mix (Distance)',
    tileName: 'Activity Mix',
    description: 'How your total recorded distance is divided between activity types.',
    icon: 'donut_large',
    category: 'custom',
    chartType: ChartTypes.Pie,
    dataType: DataDistance.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.ActivityType,
    dataTimeInterval: TimeIntervals.Auto,
  },
];

export function getDashboardManagerPresetDefinitions(): DashboardManagerPresetDefinition[] {
  return [...DASHBOARD_MANAGER_PRESET_DEFINITIONS];
}

export function getDashboardManagerRecommendedPresetDefinitions(
  eligibility: DashboardManagerPresetEligibility,
): DashboardManagerPresetDefinition[] {
  return DASHBOARD_MANAGER_PRESET_DEFINITIONS.filter(definition => (
    definition.recommended === true
    && (!definition.eligibility || eligibility[definition.eligibility] === true)
  ));
}

export function getDashboardManagerPresetDefinition(
  presetId: DashboardManagerPresetId,
): DashboardManagerPresetDefinition | null {
  return DASHBOARD_MANAGER_PRESET_DEFINITIONS.find(definition => definition.id === presetId) || null;
}

export function buildDashboardManagerPresetTile(
  input: BuildDashboardManagerPresetTileInput,
): TileSettingsInterface {
  const definition = getDashboardManagerPresetDefinition(input.presetId);
  if (!definition) {
    throw new Error(`Unknown dashboard manager preset id: ${input.presetId}`);
  }

  if (definition.category === 'map') {
    const mapTile = <DashboardManagerPresetMapTileSettings & AppDashboardMapTileSettingsInterface><unknown>{
      name: definition.tileName,
      type: TileTypes.Map,
      order: input.order,
      size: input.size,
      mapSource: definition.mapSource,
      mapStyle: definition.mapStyle,
      mapTheme: MapThemes.Normal,
      mapType: AppUserUtilities.getDefaultMapType(),
      showHeatMap: definition.mapSource === 'events',
      clusterMarkers: definition.clusterMarkers,
      ...(definition.mapSource === 'routes'
        ? { showRouteEndpointMarkers: definition.showRouteEndpointMarkers !== false }
        : {}),
    };
    if (definition.mapSource === 'events') {
      mapTile.eventFilters = AppUserUtilities.getDefaultDashboardTileEventFilters();
    }
    return mapTile;
  }

  if (definition.category === 'curated') {
    if (definition.curatedChartType === DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE) {
      return buildDashboardActivityCalendarTile(input.order, input.size);
    }
    if (definition.curatedChartType === DASHBOARD_FORM_CHART_TYPE) {
      const formTile: AppDashboardChartTileSettingsInterface = {
        name: definition.tileName,
        type: TileTypes.Chart,
        order: input.order,
        size: input.size,
        chartType: DASHBOARD_FORM_CHART_TYPE as unknown as ChartTypes,
        dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
        displaySettings: getDefaultDashboardChartTileDisplaySettingsForChartType(DASHBOARD_FORM_CHART_TYPE),
      };
      return formTile;
    }

    if (isDashboardSleepBackedChartType(definition.curatedChartType)) {
      const sleepTile: TileChartSettingsInterface = {
        name: definition.tileName,
        type: TileTypes.Chart,
        order: input.order,
        size: input.size,
        chartType: definition.curatedChartType as unknown as ChartTypes,
        dataType: definition.curatedChartType === DASHBOARD_HRV_TREND_CHART_TYPE ? DataSleepHRVAvg.type : 'SleepDuration',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
      };
      return sleepTile;
    }

    if (definition.curatedChartType === DASHBOARD_POWER_CURVE_CHART_TYPE) {
      return buildDashboardPowerCurveAutoTile(
        definition.powerCurveScope || 'cycling',
        input.order,
        input.size,
      );
    }

    const displaySettings = getDefaultDashboardChartTileDisplaySettingsForChartType(definition.curatedChartType);
    const curatedTile: AppDashboardChartTileSettingsInterface = {
      name: definition.tileName,
      type: TileTypes.Chart,
      order: input.order,
      size: input.size,
      chartType: definition.curatedChartType as unknown as ChartTypes,
      dataType: definition.curatedChartType === DASHBOARD_RECOVERY_NOW_CHART_TYPE
        ? DataRecoveryTime.type
        : DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: definition.curatedChartType === DASHBOARD_RECOVERY_NOW_CHART_TYPE
        ? TimeIntervals.Auto
        : TimeIntervals.Weekly,
      ...(displaySettings ? { displaySettings } : {}),
    };
    return curatedTile;
  }

  if (definition.category === 'kpi') {
    const kpiTile: TileChartSettingsInterface = {
      name: definition.tileName,
      type: TileTypes.Chart,
      order: input.order,
      size: input.size,
      chartType: definition.kpiChartType as unknown as ChartTypes,
      dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Weekly,
    };
    return kpiTile;
  }

  const customTile: AppDashboardChartTileSettingsInterface = {
    name: definition.tileName,
    type: TileTypes.Chart,
    order: input.order,
    size: input.size,
    chartType: definition.chartType,
    dataType: definition.dataType,
    dataValueType: definition.dataValueType,
    dataCategoryType: definition.dataCategoryType,
    dataTimeInterval: definition.dataTimeInterval,
    eventFilters: AppUserUtilities.getDefaultDashboardTileEventFilters(),
  };
  return customTile;
}
