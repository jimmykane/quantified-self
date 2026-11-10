import { describe, expect, it } from 'vitest';
import { TileTypes, type TileSettingsInterface } from '@sports-alliance/sports-lib';
import { DERIVED_METRIC_KINDS as M } from '@shared/derived-metrics';
import * as C from './dashboard-special-chart-types';
import { dashboardTileMetricKinds } from './dashboard-derived-dependencies.helper';
const tile = (chartType: string) => ({ type: TileTypes.Chart, chartType } as TileSettingsInterface);
describe('dashboard snapshot dependencies', () => {
  it.each([
    [C.DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE, [M.FormNow, M.Form, M.RampRate]],
    [C.DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE, [M.Form]],
    [C.DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE, [M.Form]],
    [C.DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE, [M.FormNow, M.FreshnessForecast, M.FormPlus7d]],
    [C.DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE, [M.IntensityDistribution, M.EasyPercent, M.HardPercent]],
    [C.DASHBOARD_CRITICAL_POWER_CHART_TYPE, [M.TrainingPowerSystems]],
    [C.DASHBOARD_DURABILITY_CHART_TYPE, [M.TrainingDurability]],
  ])('requests all inputs for %s without unrelated snapshots', (chartType, expected) => {
    expect(dashboardTileMetricKinds(tile(chartType))).toEqual(expected);
  });
  it('keeps event, Sleep and Health-only charts free of derived snapshots', () => {
    for (const type of ['ColumnsVertical', C.DASHBOARD_SLEEP_TREND_CHART_TYPE, C.DASHBOARD_HEALTH_METRIC_CHART_TYPE])
      expect(dashboardTileMetricKinds(tile(type))).toEqual([]);
  });
  it('does not let callers mutate subsequent dependency resolutions', () => {
    const result = dashboardTileMetricKinds(tile(C.DASHBOARD_FORM_CHART_TYPE));
    result.length = 0;
    expect(dashboardTileMetricKinds(tile(C.DASHBOARD_FORM_CHART_TYPE))).toEqual([M.Form]);
  });
});
