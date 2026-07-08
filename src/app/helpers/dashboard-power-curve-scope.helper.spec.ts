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
  buildDashboardPowerCurveAutoTileForScope,
  getDashboardPowerCurveActivityTypes,
  isLegacyDefaultDashboardPowerCurveTile,
  isDashboardPowerCurveTileForScope,
  resolveDashboardPowerCurveTileDisplayScope,
  resolveDashboardPowerCurveTileScope,
} from './dashboard-power-curve-scope.helper';

describe('dashboard-power-curve-scope.helper', () => {
  it('resolves generated Cycling and Running Power Curve tiles from their scoped filters', () => {
    expect(resolveDashboardPowerCurveTileScope(buildDashboardPowerCurveAutoTileForScope('cycling', 0))).toBe('cycling');
    expect(resolveDashboardPowerCurveTileScope(buildDashboardPowerCurveAutoTileForScope('running', 1))).toBe('running');
    expect(buildDashboardPowerCurveAutoTileForScope('cycling', 0).size).toEqual({ columns: 2, rows: 1 });
  });

  it('treats partial activity selections from one sport family as that scope', () => {
    const runningTile = makePowerCurveTile({
      eventFilters: { range: '1y', activityTypes: [ActivityTypes.Running] },
    });
    const cyclingTile = makePowerCurveTile({
      eventFilters: { range: '1y', activityTypes: [ActivityTypes.Cycling, ActivityTypes.MountainBiking] },
    });

    expect(resolveDashboardPowerCurveTileScope(runningTile)).toBe('running');
    expect(resolveDashboardPowerCurveTileScope(cyclingTile)).toBe('cycling');
    expect(isDashboardPowerCurveTileForScope(runningTile, 'running')).toBe(true);
    expect(isDashboardPowerCurveTileForScope(runningTile, 'cycling')).toBe(false);
  });

  it('uses tile names only when activity filters do not identify one scope', () => {
    expect(resolveDashboardPowerCurveTileScope(makePowerCurveTile({
      name: 'Running Power Curve',
      eventFilters: { range: '1y', activityTypes: [] },
    }))).toBe('running');
    expect(resolveDashboardPowerCurveTileScope(makePowerCurveTile({
      name: 'Cycling Power Curve',
      eventFilters: { range: '1y', activityTypes: [] },
    }))).toBe('cycling');
    expect(resolveDashboardPowerCurveTileScope(makePowerCurveTile({
      name: 'Power Curve',
      eventFilters: { range: '1y', activityTypes: [] },
    }))).toBe('cycling');
    expect(resolveDashboardPowerCurveTileScope(makePowerCurveTile({
      name: '',
      eventFilters: { range: '1y', activityTypes: [] },
    }))).toBe('cycling');
  });

  it('does not classify mixed cycling and running activity filters as either scoped tile', () => {
    const mixedTile = makePowerCurveTile({
      name: 'Running Power Curve',
      eventFilters: { range: '1y', activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running] },
    });

    expect(resolveDashboardPowerCurveTileScope(mixedTile)).toBeNull();
    expect(isDashboardPowerCurveTileForScope(mixedTile, 'cycling')).toBe(false);
    expect(isDashboardPowerCurveTileForScope(mixedTile, 'running')).toBe(false);
  });

  it('uses tile names for display scope when strict filter scope is unresolved', () => {
    const mixedCyclingTile = makePowerCurveTile({
      name: 'Cycling Power Curve',
      eventFilters: { range: '1y', activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running] },
    });
    const mixedGenericTile = makePowerCurveTile({
      name: 'Power Curve',
      eventFilters: { range: '1y', activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running] },
    });

    expect(resolveDashboardPowerCurveTileScope(mixedCyclingTile)).toBeNull();
    expect(resolveDashboardPowerCurveTileDisplayScope(mixedCyclingTile)).toBe('cycling');
    expect(resolveDashboardPowerCurveTileScope(mixedGenericTile)).toBeNull();
    expect(resolveDashboardPowerCurveTileDisplayScope(mixedGenericTile)).toBeNull();
  });

  it('keeps generated scope filters stable', () => {
    expect(buildDashboardPowerCurveAutoTileForScope('cycling', 0).eventFilters?.activityTypes)
      .toEqual(getDashboardPowerCurveActivityTypes('cycling'));
    expect(buildDashboardPowerCurveAutoTileForScope('running', 0).eventFilters?.activityTypes)
      .toEqual(getDashboardPowerCurveActivityTypes('running'));
  });

  it('treats blank or generic unfiltered Power Curve tiles as legacy cycling defaults', () => {
    expect(isLegacyDefaultDashboardPowerCurveTile(makePowerCurveTile({
      name: '',
      eventFilters: { range: '1y', activityTypes: [] },
    }))).toBe(true);
    expect(isLegacyDefaultDashboardPowerCurveTile(makePowerCurveTile({
      name: 'Power Curve',
      eventFilters: { range: '1y', activityTypes: [] },
    }))).toBe(true);
    expect(isLegacyDefaultDashboardPowerCurveTile(makePowerCurveTile({
      name: 'Running Power Curve',
      eventFilters: { range: '1y', activityTypes: [] },
    }))).toBe(false);
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
