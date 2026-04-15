import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAscent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRateAvg,
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
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  type DashboardChartCategory,
  type DashboardCuratedChartType,
  type DashboardKpiGroup,
  type DashboardKpiChartType,
} from './dashboard-special-chart-types';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from './dashboard-form.helper';

export const DASHBOARD_MANAGER_PRESET_IDS = {
  CURATED_RECOVERY: 'curated-recovery',
  CURATED_FORM: 'curated-form',
  CURATED_FRESHNESS_FORECAST: 'curated-freshness-forecast',
  CURATED_INTENSITY_DISTRIBUTION: 'curated-intensity-distribution',
  CURATED_EFFICIENCY_TREND: 'curated-efficiency-trend',
  KPI_ACWR: 'kpi-acwr',
  KPI_RAMP_RATE: 'kpi-ramp-rate',
  KPI_MONOTONY_STRAIN: 'kpi-monotony-strain',
  KPI_FORM_NOW: 'kpi-form-now',
  KPI_FORM_PLUS_7D: 'kpi-form-plus-7d',
  KPI_EASY_PERCENT: 'kpi-easy-percent',
  KPI_HARD_PERCENT: 'kpi-hard-percent',
  KPI_EFFICIENCY_DELTA_4W: 'kpi-efficiency-delta-4w',
  MAP_DEFAULT_CLUSTERED: 'map-default-clustered',
  CUSTOM_DURATION_PIE: 'custom-duration-pie',
  CUSTOM_DISTANCE_COLUMNS: 'custom-distance-columns',
  CUSTOM_ASCENT_PYRAMIDS: 'custom-ascent-pyramids',
  CUSTOM_ENERGY_TREND: 'custom-energy-trend',
  CUSTOM_HEART_RATE_AVG_BY_ACTIVITY: 'custom-heart-rate-avg-by-activity',
  CUSTOM_WEEKLY_DISTANCE_TREND: 'custom-weekly-distance-trend',
  CUSTOM_ACTIVITY_MIX_DISTANCE_PIE: 'custom-activity-mix-distance-pie',
} as const;

export type DashboardManagerPresetId =
  typeof DASHBOARD_MANAGER_PRESET_IDS[keyof typeof DASHBOARD_MANAGER_PRESET_IDS];

export type DashboardManagerPresetCategory = DashboardChartCategory | 'map';

export interface DashboardManagerPresetTileSize {
  columns: number;
  rows: number;
}

interface DashboardManagerPresetBaseDefinition {
  id: DashboardManagerPresetId;
  label: string;
  tileName: string;
  description: string;
  icon: string;
  category: DashboardManagerPresetCategory;
}

export interface DashboardManagerCuratedPresetDefinition extends DashboardManagerPresetBaseDefinition {
  category: 'curated';
  curatedChartType: DashboardCuratedChartType;
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
  mapStyle: MapStyleName;
  clusterMarkers: boolean;
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
    description: 'Recovery left now vs elapsed recovery.',
    icon: 'health_and_safety',
    category: 'curated',
    curatedChartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_FORM,
    label: 'Form (TSS)',
    tileName: 'Form',
    description: 'Fitness/fatigue/form trend from derived training stress.',
    icon: 'insights',
    category: 'curated',
    curatedChartType: DASHBOARD_FORM_CHART_TYPE,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_FRESHNESS_FORECAST,
    label: 'Freshness Forecast',
    tileName: 'Freshness Forecast',
    description: '7-day zero-load form forecast from derived history.',
    icon: 'trending_up',
    category: 'curated',
    curatedChartType: DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_INTENSITY_DISTRIBUTION,
    label: 'Intensity Distribution',
    tileName: 'Intensity Distribution',
    description: 'Weekly easy/moderate/hard training mix.',
    icon: 'bar_chart',
    category: 'curated',
    curatedChartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CURATED_EFFICIENCY_TREND,
    label: 'Efficiency Trend',
    tileName: 'Efficiency Trend',
    description: 'Weekly duration-weighted power/heart-rate trend.',
    icon: 'show_chart',
    category: 'curated',
    curatedChartType: DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_ACWR,
    label: 'KPI: ACWR',
    tileName: 'ACWR',
    description: 'Acute vs chronic load ratio with mini trend.',
    icon: 'monitoring',
    category: 'kpi',
    kpiChartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
    kpiGroup: 'load',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_RAMP_RATE,
    label: 'KPI: Ramp Rate',
    tileName: 'Ramp Rate',
    description: 'CTL change over 7 days with mini trend.',
    icon: 'speed',
    category: 'kpi',
    kpiChartType: DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
    kpiGroup: 'load',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_MONOTONY_STRAIN,
    label: 'KPI: Monotony / Strain',
    tileName: 'Monotony / Strain',
    description: 'Weekly strain and monotony KPI with mini trend.',
    icon: 'stacked_line_chart',
    category: 'kpi',
    kpiChartType: DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
    kpiGroup: 'load',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_FORM_NOW,
    label: 'KPI: Form Now',
    tileName: 'Form Now',
    description: 'Prior-day TSB readiness KPI with mini trend.',
    icon: 'self_improvement',
    category: 'kpi',
    kpiChartType: DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
    kpiGroup: 'readiness',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_FORM_PLUS_7D,
    label: 'KPI: Form +7d',
    tileName: 'Form +7d',
    description: 'Zero-load readiness projection at +7d.',
    icon: 'trending_up',
    category: 'kpi',
    kpiChartType: DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
    kpiGroup: 'readiness',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_EASY_PERCENT,
    label: 'KPI: Easy %',
    tileName: 'Easy %',
    description: 'Latest weekly Easy intensity percentage.',
    icon: 'wb_sunny',
    category: 'kpi',
    kpiChartType: DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
    kpiGroup: 'execution',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_HARD_PERCENT,
    label: 'KPI: Hard %',
    tileName: 'Hard %',
    description: 'Latest weekly Hard intensity percentage.',
    icon: 'flash_on',
    category: 'kpi',
    kpiChartType: DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
    kpiGroup: 'execution',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.KPI_EFFICIENCY_DELTA_4W,
    label: 'KPI: Efficiency Δ (4w)',
    tileName: 'Efficiency Δ (4w)',
    description: 'Current efficiency versus prior 4-week baseline.',
    icon: 'query_stats',
    category: 'kpi',
    kpiChartType: DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
    kpiGroup: 'execution',
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.MAP_DEFAULT_CLUSTERED,
    label: 'Map (Default)',
    tileName: 'Clustered HeatMap',
    description: 'Default map with clustered markers and heatmap.',
    icon: 'map',
    category: 'map',
    mapStyle: 'default',
    clusterMarkers: true,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_DURATION_PIE,
    label: 'Duration Pie',
    tileName: 'Duration',
    description: 'Duration split by activity type.',
    icon: 'pie_chart',
    category: 'custom',
    chartType: ChartTypes.Pie,
    dataType: DataDuration.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.ActivityType,
    dataTimeInterval: TimeIntervals.Auto,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_DISTANCE_COLUMNS,
    label: 'Distance Columns',
    tileName: 'Distance',
    description: 'Distance totals by activity type.',
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
    description: 'Ascent totals over time.',
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
    description: 'Energy trend over time.',
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
    description: 'Average heart rate by activity type.',
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
    description: 'Distance totals aggregated weekly.',
    icon: 'timeline',
    category: 'custom',
    chartType: ChartTypes.LinesVertical,
    dataType: DataDistance.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Weekly,
  },
  {
    id: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_ACTIVITY_MIX_DISTANCE_PIE,
    label: 'Activity Mix (Distance)',
    tileName: 'Activity Mix',
    description: 'Distance composition by activity type.',
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
    const mapTile = <DashboardManagerPresetMapTileSettings><unknown>{
      name: definition.tileName,
      type: TileTypes.Map,
      order: input.order,
      size: input.size,
      mapStyle: definition.mapStyle,
      mapTheme: MapThemes.Normal,
      showHeatMap: true,
      clusterMarkers: definition.clusterMarkers,
    };
    return mapTile;
  }

  if (definition.category === 'curated') {
    if (definition.curatedChartType === DASHBOARD_FORM_CHART_TYPE) {
      const formTile: TileChartSettingsInterface = {
        name: definition.tileName,
        type: TileTypes.Chart,
        order: input.order,
        size: input.size,
        chartType: DASHBOARD_FORM_CHART_TYPE as unknown as ChartTypes,
        dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
      };
      return formTile;
    }

    const curatedTile: TileChartSettingsInterface = {
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

  const customTile: TileChartSettingsInterface = {
    name: definition.tileName,
    type: TileTypes.Chart,
    order: input.order,
    size: input.size,
    chartType: definition.chartType,
    dataType: definition.dataType,
    dataValueType: definition.dataValueType,
    dataCategoryType: definition.dataCategoryType,
    dataTimeInterval: definition.dataTimeInterval,
  };
  return customTile;
}
