import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataDistance,
  DataDuration,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildDashboardManagerPresetTile,
  DASHBOARD_MANAGER_PRESET_IDS,
  getDashboardManagerPresetDefinition,
  getDashboardManagerPresetDefinitions,
  getDashboardManagerRecommendedPresetDefinitions,
} from './dashboard-manager-presets.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
} from './dashboard-special-chart-types';
import { getDashboardPowerCurveActivityTypes } from './dashboard-power-curve-scope.helper';

describe('dashboard-manager-presets.helper', () => {
  it('exposes the expanded preset catalog with 35 unique definitions', () => {
    const definitions = getDashboardManagerPresetDefinitions();

    expect(definitions).toHaveLength(35);
    expect(new Set(definitions.map(definition => definition.id)).size).toBe(35);
    expect(definitions.filter(definition => definition.category === 'curated')).toHaveLength(8);
    expect(definitions.filter(definition => definition.category === 'kpi')).toHaveLength(17);
    expect(definitions.filter(definition => definition.category === 'custom')).toHaveLength(8);
    expect(definitions.filter(definition => definition.category === 'map')).toHaveLength(2);
    expect(definitions.map(definition => definition.id)).toContain(DASHBOARD_MANAGER_PRESET_IDS.CURATED_SLEEP);
    expect(definitions.map(definition => definition.id)).toContain(DASHBOARD_MANAGER_PRESET_IDS.CURATED_POWER_CURVE);
    expect(definitions.map(definition => definition.id)).toContain(DASHBOARD_MANAGER_PRESET_IDS.CURATED_RUNNING_POWER_CURVE);
  });

  it('returns only recommended presets with evidence in their default data windows', () => {
    const recommended = getDashboardManagerRecommendedPresetDefinitions({
      'activity-history': true,
      sleep: false,
      'cycling-power': true,
      'running-power': false,
      'aerobic-capacity': true,
      'aerobic-durability': false,
      'event-map': true,
      routes: false,
    });
    const ids = recommended.map(definition => definition.id);

    expect(ids).toContain(DASHBOARD_MANAGER_PRESET_IDS.KPI_ACWR);
    expect(ids).toContain(DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_WEEKLY_TRAINING_TIME);
    expect(ids).toContain(DASHBOARD_MANAGER_PRESET_IDS.CURATED_POWER_CURVE);
    expect(ids).toContain(DASHBOARD_MANAGER_PRESET_IDS.KPI_AEROBIC_CAPACITY);
    expect(ids).toContain(DASHBOARD_MANAGER_PRESET_IDS.MAP_DEFAULT_CLUSTERED);
    expect(ids).not.toContain(DASHBOARD_MANAGER_PRESET_IDS.CURATED_SLEEP);
    expect(ids).not.toContain(DASHBOARD_MANAGER_PRESET_IDS.CURATED_RUNNING_POWER_CURVE);
    expect(ids).not.toContain(DASHBOARD_MANAGER_PRESET_IDS.KPI_AEROBIC_DURABILITY);
    expect(ids).not.toContain(DASHBOARD_MANAGER_PRESET_IDS.MAP_ROUTES_PREVIEW);
    expect(ids).not.toContain(DASHBOARD_MANAGER_PRESET_IDS.KPI_FORM_NOW);
  });

  it('does not recommend empty presets when no eligibility evidence is available', () => {
    const recommended = getDashboardManagerRecommendedPresetDefinitions({
      'activity-history': false,
      sleep: false,
      'cycling-power': false,
      'running-power': false,
      'aerobic-capacity': false,
      'aerobic-durability': false,
      'event-map': false,
      routes: false,
    });

    expect(recommended).toEqual([]);
  });

  it('returns null for unknown preset ids', () => {
    const definition = getDashboardManagerPresetDefinition('missing-preset-id' as any);

    expect(definition).toBeNull();
  });

  it('builds deterministic curated preset tiles', () => {
    const recoveryTile = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.CURATED_RECOVERY,
      order: 3,
      size: { columns: 2, rows: 1 },
    });
    const formTile = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.CURATED_FORM,
      order: 5,
      size: { columns: 1, rows: 2 },
    });

    expect(recoveryTile).toMatchObject({
      type: TileTypes.Chart,
      order: 3,
      size: { columns: 2, rows: 1 },
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
    });
    expect(formTile).toMatchObject({
      type: TileTypes.Chart,
      order: 5,
      size: { columns: 1, rows: 2 },
      chartType: DASHBOARD_FORM_CHART_TYPE,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Daily,
    });
  });

  it('builds the Sleep preset as a curated dashboard manager tile', () => {
    expect(getDashboardManagerPresetDefinition(DASHBOARD_MANAGER_PRESET_IDS.CURATED_SLEEP)).toMatchObject({
      label: 'Sleep',
      category: 'curated',
      curatedChartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
    });
    expect(buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.CURATED_SLEEP,
      order: 6,
      size: { columns: 2, rows: 1 },
    })).toMatchObject({
      name: 'Sleep',
      type: TileTypes.Chart,
      order: 6,
      size: { columns: 2, rows: 1 },
      chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
      dataType: 'SleepDuration',
      dataTimeInterval: TimeIntervals.Daily,
    });
  });

  it('builds scoped Power Curve presets as curated dashboard manager tiles', () => {
    expect(getDashboardManagerPresetDefinition(DASHBOARD_MANAGER_PRESET_IDS.CURATED_POWER_CURVE)).toMatchObject({
      label: 'Cycling Power Curve',
      category: 'curated',
      curatedChartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      powerCurveScope: 'cycling',
    });
    expect(getDashboardManagerPresetDefinition(DASHBOARD_MANAGER_PRESET_IDS.CURATED_RUNNING_POWER_CURVE)).toMatchObject({
      label: 'Running Power Curve',
      category: 'curated',
      curatedChartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      powerCurveScope: 'running',
    });

    expect(buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.CURATED_POWER_CURVE,
      order: 7,
      size: { columns: 2, rows: 1 },
    })).toMatchObject({
      name: 'Cycling Power Curve',
      type: TileTypes.Chart,
      order: 7,
      size: { columns: 2, rows: 1 },
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      eventFilters: { range: '1y', activityTypes: getDashboardPowerCurveActivityTypes('cycling') },
    });
    expect(buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.CURATED_RUNNING_POWER_CURVE,
      order: 8,
      size: { columns: 1, rows: 1 },
    })).toMatchObject({
      name: 'Running Power Curve',
      type: TileTypes.Chart,
      order: 8,
      size: { columns: 1, rows: 1 },
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      eventFilters: { range: '1y', activityTypes: getDashboardPowerCurveActivityTypes('running') },
    });
  });

  it('builds deterministic custom and map preset tiles', () => {
    const durationPie = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_DURATION_PIE,
      order: 1,
      size: { columns: 1, rows: 1 },
    });
    const weeklyDistance = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_WEEKLY_DISTANCE_TREND,
      order: 2,
      size: { columns: 1, rows: 1 },
    });
    const defaultMap = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.MAP_DEFAULT_CLUSTERED,
      order: 4,
      size: { columns: 1, rows: 1 },
    });
    const routesMap = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.MAP_ROUTES_PREVIEW,
      order: 5,
      size: { columns: 2, rows: 1 },
    });

    expect(durationPie).toMatchObject({
      type: TileTypes.Chart,
      chartType: ChartTypes.Pie,
      dataType: DataDuration.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.ActivityType,
      eventFilters: { range: '90d', activityTypes: [] },
    });
    expect(weeklyDistance).toMatchObject({
      type: TileTypes.Chart,
      chartType: ChartTypes.LinesVertical,
      dataType: DataDistance.type,
      dataTimeInterval: TimeIntervals.Weekly,
      eventFilters: { range: '90d', activityTypes: [] },
    });
    expect(defaultMap).toMatchObject({
      type: TileTypes.Map,
      mapSource: 'events',
      mapStyle: 'default',
      clusterMarkers: true,
      order: 4,
      size: { columns: 1, rows: 1 },
      eventFilters: { range: '90d', activityTypes: [] },
    });
    expect(routesMap).toMatchObject({
      type: TileTypes.Map,
      name: 'Routes',
      mapSource: 'routes',
      mapStyle: 'default',
      clusterMarkers: false,
      showRouteEndpointMarkers: true,
      order: 5,
      size: { columns: 2, rows: 1 },
    });
    expect(routesMap).not.toHaveProperty('eventFilters');
  });

  it('builds deterministic KPI preset tiles', () => {
    const kpiTile = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.KPI_ACWR,
      order: 2,
      size: { columns: 1, rows: 1 },
    });

    expect(kpiTile).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
    });
  });

  it('builds readiness KPI preset tiles', () => {
    const formNowTile = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.KPI_FORM_NOW,
      order: 2,
      size: { columns: 1, rows: 1 },
    });

    expect(formNowTile).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
    });

    const fitnessTile = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.KPI_FITNESS_CTL,
      order: 3,
      size: { columns: 1, rows: 1 },
    });
    expect(fitnessTile).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
    });

    const loadStatusTile = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.KPI_LOAD_STATUS,
      order: 4,
      size: { columns: 1, rows: 1 },
    });
    expect(loadStatusTile).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
    });

    const fitnessTrendTile = buildDashboardManagerPresetTile({
      presetId: DASHBOARD_MANAGER_PRESET_IDS.KPI_FITNESS_TREND,
      order: 5,
      size: { columns: 1, rows: 1 },
    });
    expect(fitnessTrendTile).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
    });
  });

  it('throws for unknown preset ids when building tiles', () => {
    expect(() => buildDashboardManagerPresetTile({
      presetId: 'missing-preset-id' as any,
      order: 0,
      size: { columns: 1, rows: 1 },
    })).toThrow('Unknown dashboard manager preset id: missing-preset-id');
  });
});
