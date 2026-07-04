import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from './dashboard-form.helper';
import { DASHBOARD_POWER_CURVE_CHART_TYPE } from './dashboard-special-chart-types';
import {
  DASHBOARD_AUTO_TILE_POWER_CURVE_ID,
  DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
  DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_ID,
  DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_SOURCE,
  getDashboardAutoTileDescriptorForTile,
} from './dashboard-auto-tile.helper';

describe('dashboard-auto-tile.helper', () => {
  it('describes scoped Power Curve tiles by resolved sport scope', () => {
    expect(getDashboardAutoTileDescriptorForTile(makePowerCurveTile({
      eventFilters: { range: '1y', activityTypes: [ActivityTypes.Cycling] },
    }))).toEqual({
      id: DASHBOARD_AUTO_TILE_POWER_CURVE_ID,
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
    expect(getDashboardAutoTileDescriptorForTile(makePowerCurveTile({
      eventFilters: { range: '1y', activityTypes: [ActivityTypes.Running] },
    }))).toEqual({
      id: DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_ID,
      source: DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_SOURCE,
    });
  });

  it('keeps legacy unfiltered Power Curve tiles mapped to cycling and leaves mixed filters unclassified', () => {
    expect(getDashboardAutoTileDescriptorForTile(makePowerCurveTile({
      name: 'Power Curve',
      eventFilters: { range: '1y', activityTypes: [] },
    }))).toEqual({
      id: DASHBOARD_AUTO_TILE_POWER_CURVE_ID,
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
    expect(getDashboardAutoTileDescriptorForTile(makePowerCurveTile({
      eventFilters: { range: '1y', activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running] },
    }))).toBeNull();
  });
});

function makePowerCurveTile(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'Power Curve',
    type: TileTypes.Chart,
    order: 0,
    size: { columns: 1, rows: 1 },
    chartType: DASHBOARD_POWER_CURVE_CHART_TYPE as unknown as ChartTypes,
    dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Weekly,
    ...overrides,
  };
}
