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
} from './dashboard-manager-presets.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
} from './dashboard-special-chart-types';

describe('dashboard-manager-presets.helper', () => {
  it('exposes the expanded preset catalog with 16 unique definitions', () => {
    const definitions = getDashboardManagerPresetDefinitions();

    expect(definitions).toHaveLength(16);
    expect(new Set(definitions.map(definition => definition.id)).size).toBe(16);
    expect(definitions.filter(definition => definition.category === 'curated')).toHaveLength(5);
    expect(definitions.filter(definition => definition.category === 'kpi')).toHaveLength(3);
    expect(definitions.filter(definition => definition.category === 'custom')).toHaveLength(7);
    expect(definitions.filter(definition => definition.category === 'map')).toHaveLength(1);
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
      size: { columns: 2, rows: 2 },
    });

    expect(durationPie).toMatchObject({
      type: TileTypes.Chart,
      chartType: ChartTypes.Pie,
      dataType: DataDuration.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.ActivityType,
    });
    expect(weeklyDistance).toMatchObject({
      type: TileTypes.Chart,
      chartType: ChartTypes.LinesVertical,
      dataType: DataDistance.type,
      dataTimeInterval: TimeIntervals.Weekly,
    });
    expect(defaultMap).toMatchObject({
      type: TileTypes.Map,
      mapStyle: 'default',
      clusterMarkers: true,
      order: 4,
      size: { columns: 2, rows: 2 },
    });
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

  it('throws for unknown preset ids when building tiles', () => {
    expect(() => buildDashboardManagerPresetTile({
      presetId: 'missing-preset-id' as any,
      order: 0,
      size: { columns: 1, rows: 1 },
    })).toThrow('Unknown dashboard manager preset id: missing-preset-id');
  });
});
