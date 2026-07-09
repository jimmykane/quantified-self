import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAscent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRateAvg,
  DataPower,
  DataRecoveryTime,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
} from './dashboard-special-chart-types';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from './dashboard-form.helper';
import {
  DASHBOARD_TILE_SECTION_DEFINITIONS,
  DASHBOARD_TILE_SECTION_ORDER,
  orderDashboardTilesByIntentSections,
  resolveDashboardTileLaneKey,
  resolveDashboardTileSection,
} from './dashboard-tile-section.helper';

describe('dashboard tile section metadata', () => {
  it('keeps the fixed section order aligned with section definitions', () => {
    expect(DASHBOARD_TILE_SECTION_ORDER).toEqual([
      'trainingState',
      'performancePower',
      'activityOverview',
      'routesMaps',
      'custom',
    ]);
    expect(DASHBOARD_TILE_SECTION_DEFINITIONS.map(definition => definition.id)).toEqual(DASHBOARD_TILE_SECTION_ORDER);
  });
});

describe('resolveDashboardTileSection', () => {
  it('maps curated dashboard chart types to intent sections', () => {
    expect(resolveDashboardTileSection(createChartTile(DASHBOARD_FORM_CHART_TYPE))).toBe('trainingState');
    expect(resolveDashboardTileSection(createChartTile(DASHBOARD_POWER_CURVE_CHART_TYPE))).toBe('performancePower');
    expect(resolveDashboardTileSection(createChartTile(DASHBOARD_EFFICIENCY_TREND_CHART_TYPE))).toBe('performancePower');
    expect(resolveDashboardTileSection(createChartTile(DASHBOARD_RECOVERY_NOW_CHART_TYPE))).toBe('trainingState');
    expect(resolveDashboardTileSection(createChartTile(DASHBOARD_SLEEP_TREND_CHART_TYPE))).toBe('trainingState');
    expect(resolveDashboardTileSection(createChartTile(DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE))).toBe('trainingState');
    expect(resolveDashboardTileSection(createChartTile(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE))).toBe('trainingState');
  });

  it('maps map tiles to Routes & Maps', () => {
    expect(resolveDashboardTileSection({
      type: TileTypes.Map,
      order: 0,
      size: { columns: 1, rows: 1 },
    } as TileSettingsInterface)).toBe('routesMaps');
  });

  it('maps activity overview custom chart metrics to Activity Overview', () => {
    [
      DataDistance.type,
      DataDuration.type,
      DataAscent.type,
      DataEnergy.type,
    ].forEach((dataType) => {
      expect(resolveDashboardTileSection(createChartTile(ChartTypes.ColumnsVertical, dataType))).toBe('activityOverview');
    });
    expect(resolveDashboardTileSection(createChartTile(
      ChartTypes.ColumnsHorizontal,
      DataHeartRateAvg.type,
      ChartDataCategoryTypes.ActivityType,
    ))).toBe('activityOverview');
  });

  it('maps power and training load custom charts to their intent sections', () => {
    expect(resolveDashboardTileSection(createChartTile(ChartTypes.LinesVertical, DataPower.type))).toBe('performancePower');
    expect(resolveDashboardTileSection(createChartTile(
      ChartTypes.LinesVertical,
      DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
    ))).toBe('trainingState');
  });

  it('maps legacy recovery metric tiles to Training State', () => {
    expect(resolveDashboardTileSection(createChartTile(ChartTypes.Pie, DataRecoveryTime.type))).toBe('trainingState');
  });

  it('maps unknown custom charts to Custom Charts', () => {
    expect(resolveDashboardTileSection(createChartTile(ChartTypes.Pie, 'DeviceName'))).toBe('custom');
    expect(resolveDashboardTileSection(null)).toBe('custom');
  });

  it('resolves KPI and section lane keys from the same section rules', () => {
    expect(resolveDashboardTileLaneKey(createChartTile(DASHBOARD_ACWR_KPI_CHART_TYPE))).toBe('kpi:load');
    expect(resolveDashboardTileLaneKey(createChartTile(DASHBOARD_FORM_NOW_KPI_CHART_TYPE))).toBe('kpi:readiness');
    expect(resolveDashboardTileLaneKey(createChartTile(DASHBOARD_POWER_CURVE_CHART_TYPE))).toBe('section:performancePower');
    expect(resolveDashboardTileLaneKey({
      type: TileTypes.Map,
      order: 0,
      size: { columns: 1, rows: 1 },
    } as TileSettingsInterface)).toBe('section:routesMaps');
  });

  it('orders tiles as KPI groups first then fixed intent sections while preserving order inside each lane', () => {
    const mapTile = {
      type: TileTypes.Map,
      order: 0,
      name: 'Map',
      size: { columns: 1, rows: 1 },
    } as TileSettingsInterface;
    const secondActivityTile = createChartTile(ChartTypes.ColumnsVertical, DataDuration.type, ChartDataCategoryTypes.DateType, 'Duration');
    const loadKpiTile = createChartTile(DASHBOARD_ACWR_KPI_CHART_TYPE, DataDistance.type, ChartDataCategoryTypes.DateType, 'ACWR');
    const readinessKpiTile = createChartTile(DASHBOARD_FORM_NOW_KPI_CHART_TYPE, DataDistance.type, ChartDataCategoryTypes.DateType, 'Form Now');
    const trendKpiTile = createChartTile(DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE, DataDistance.type, ChartDataCategoryTypes.DateType, 'Fitness Trend');
    const powerTile = createChartTile(DASHBOARD_POWER_CURVE_CHART_TYPE, DataPower.type, ChartDataCategoryTypes.DateType, 'Power');
    const firstActivityTile = createChartTile(ChartTypes.ColumnsVertical, DataDistance.type, ChartDataCategoryTypes.DateType, 'Distance');

    const orderedNames = orderDashboardTilesByIntentSections([
      mapTile,
      secondActivityTile,
      trendKpiTile,
      loadKpiTile,
      powerTile,
      readinessKpiTile,
      firstActivityTile,
    ]).map(tile => (tile as TileSettingsInterface & { name?: string }).name);

    expect(orderedNames).toEqual(['Form Now', 'ACWR', 'Fitness Trend', 'Power', 'Duration', 'Distance', 'Map']);
  });
});

function createChartTile(
  chartType: ChartTypes | string,
  dataType = DataDistance.type,
  dataCategoryType = ChartDataCategoryTypes.DateType,
  name = 'Chart',
): TileSettingsInterface {
  return {
    name,
    type: TileTypes.Chart,
    order: 0,
    chartType: chartType as ChartTypes,
    dataType,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType,
    dataTimeInterval: TimeIntervals.Auto,
    size: { columns: 1, rows: 1 },
  } as TileSettingsInterface;
}
