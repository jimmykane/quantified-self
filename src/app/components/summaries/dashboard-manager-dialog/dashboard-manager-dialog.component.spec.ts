import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { BehaviorSubject, of } from 'rxjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  ActivityTypes,
  AppThemes,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataHeartRateAvg,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from '../../../helpers/dashboard-form.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
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
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
} from '../../../helpers/dashboard-special-chart-types';
import {
  buildDashboardManagerPresetTile,
  DASHBOARD_MANAGER_PRESET_IDS,
  type DashboardManagerPresetDefinition,
  getDashboardManagerPresetDefinitions,
} from '../../../helpers/dashboard-manager-presets.helper';
import {
  cloneDashboardTileDefaultSize,
  DASHBOARD_DEFAULT_TILE_SIZE,
  getDefaultDashboardChartTileSizeForChartType,
  getDefaultDashboardMapTileSizeForSource,
} from '../../../helpers/dashboard-tile-default-size.helper';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import { AppUserService } from '../../../services/app.user.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppSleepService } from '../../../services/app.sleep.service';
import {
  DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_SOURCE,
  DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
  DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_SOURCE,
} from '../../../helpers/dashboard-auto-tile.helper';
import { getDashboardPowerCurveActivityTypes } from '../../../helpers/dashboard-power-curve-scope.helper';
import { DashboardManagerDialogComponent } from './dashboard-manager-dialog.component';

function createUser(tiles: any[] = []): any {
  return {
    uid: 'user-1',
    settings: {
      appSettings: {
        theme: AppThemes.Dark,
        themePreference: AppThemes.Dark,
      },
      unitSettings: {
        speedUnits: [],
      },
      dashboardSettings: {
        tiles,
      },
    },
  };
}

function dashboardTileSignature(tile: any): Record<string, unknown> {
  return tile?.type === TileTypes.Map
    ? {
      type: tile.type,
      mapSource: tile.mapSource,
      mapStyle: tile.mapStyle,
      clusterMarkers: tile.clusterMarkers,
      size: tile.size,
    }
    : {
      type: tile.type,
      chartType: `${tile.chartType}`,
      dataType: tile.dataType,
      dataValueType: tile.dataValueType,
      dataCategoryType: tile.dataCategoryType,
      dataTimeInterval: tile.dataTimeInterval,
      size: tile.size,
    };
}

function getExpectedPresetDefaultSize(definition: DashboardManagerPresetDefinition): { columns: number; rows: number } {
  if (definition.category === 'map') {
    return getDefaultDashboardMapTileSizeForSource(definition.mapSource);
  }

  if (definition.category === 'curated') {
    return getDefaultDashboardChartTileSizeForChartType(definition.curatedChartType);
  }

  return cloneDashboardTileDefaultSize(DASHBOARD_DEFAULT_TILE_SIZE);
}

function expectDashboardSettingsOnlyWrite(
  userServiceMock: { updateUserProperties: ReturnType<typeof vi.fn> },
  dialogData: { user: any },
  callIndex = 0,
): void {
  const dashboardSettings = dialogData.user.settings.dashboardSettings;
  const dashboardSettingsPatch: Record<string, unknown> = {
    tiles: dashboardSettings.tiles || [],
  };
  if (dashboardSettings.autoTiles !== undefined) {
    dashboardSettingsPatch.autoTiles = dashboardSettings.autoTiles;
  }
  if (dashboardSettings.dismissedCuratedRecoveryNowTile !== undefined) {
    dashboardSettingsPatch.dismissedCuratedRecoveryNowTile = dashboardSettings.dismissedCuratedRecoveryNowTile;
  }
  expect(userServiceMock.updateUserProperties.mock.calls[callIndex]).toEqual([
    dialogData.user,
    {
      settings: {
        dashboardSettings: dashboardSettingsPatch,
      },
    },
  ]);
  expect(userServiceMock.updateUserProperties.mock.calls[callIndex][1].settings.appSettings).toBeUndefined();
  expect(userServiceMock.updateUserProperties.mock.calls[callIndex][1].settings.unitSettings).toBeUndefined();
  expect(userServiceMock.updateUserProperties.mock.calls[callIndex][1].settings.dashboardSettings.eventTableFilters).toBeUndefined();
}

function createDeferred<T = unknown>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('DashboardManagerDialogComponent', () => {
  let component: DashboardManagerDialogComponent;
  let fixture: ComponentFixture<DashboardManagerDialogComponent>;
  let userServiceMock: { updateUserProperties: ReturnType<typeof vi.fn> };
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let dialogMock: { open: ReturnType<typeof vi.fn> };
  let sleepEligibilitySubject: BehaviorSubject<boolean>;
  let sleepServiceMock: { watchHasAnySleepSession: ReturnType<typeof vi.fn> };
  let hapticsMock: {
    selection: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let dialogData: { user: any; initialMode?: 'add' | 'edit'; initialEditTileOrder?: number | null };

  beforeEach(async () => {
    dialogData = {
      user: createUser([
        {
          type: TileTypes.Chart,
          order: 0,
          name: 'Distance',
          chartType: ChartTypes.ColumnsVertical,
          dataType: DataDistance.type,
          dataValueType: ChartDataValueTypes.Total,
          dataCategoryType: ChartDataCategoryTypes.DateType,
          dataTimeInterval: TimeIntervals.Auto,
          size: { columns: 1, rows: 1 },
        },
      ]),
    };
    userServiceMock = {
      updateUserProperties: vi.fn().mockResolvedValue(true),
    };
    dialogRefMock = {
      close: vi.fn(),
    };
    dialogMock = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of(false),
      }),
    };
    sleepEligibilitySubject = new BehaviorSubject<boolean>(false);
    sleepServiceMock = {
      watchHasAnySleepSession: vi.fn().mockReturnValue(sleepEligibilitySubject.asObservable()),
    };
    hapticsMock = {
      selection: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [DashboardManagerDialogComponent],
      providers: [
        { provide: AppUserService, useValue: userServiceMock },
        { provide: AppHapticsService, useValue: hapticsMock },
        { provide: AppSleepService, useValue: sleepServiceMock },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardManagerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.curatedChartDefinitions.map(definition => definition.chartType)).toEqual([
      DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      DASHBOARD_FORM_CHART_TYPE,
      DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
      DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
      DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
      DASHBOARD_SLEEP_TREND_CHART_TYPE,
      DASHBOARD_POWER_CURVE_CHART_TYPE,
    ]);
    expect(component.presetDefinitions.map(definition => definition.id)).toContain(DASHBOARD_MANAGER_PRESET_IDS.CURATED_SLEEP);
    expect(component.kpiChartDefinitions.map(definition => definition.chartType)).toEqual([
      DASHBOARD_ACWR_KPI_CHART_TYPE,
      DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
      DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
      DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
      DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
      DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
      DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
      DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
      DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
      DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
      DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
      DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
      DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
      DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
      DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
    ]);
  });

  it('adds a custom chart and persists dashboard settings', async () => {
    component.mode = 'add';
    component.category = 'custom';
    component.customChartType = ChartTypes.Pie;
    component.customDataType = DataDistance.type;
    component.customDataCategoryType = ChartDataCategoryTypes.ActivityType;
    component.customDataValueType = ChartDataValueTypes.Maximum;
    component.customTimeInterval = TimeIntervals.Monthly;
    component.customEventRange = '30d';
    component.customEventActivityTypes = [ActivityTypes.Running];

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1].chartType).toBe(ChartTypes.Pie);
    expect(tiles[1].dataType).toBe(DataDistance.type);
    expect(tiles[1].dataValueType).toBe(ChartDataValueTypes.Total);
    expect(tiles[1].eventFilters).toEqual({
      range: '30d',
      activityTypes: [ActivityTypes.Running],
    });
    expectDashboardSettingsOnlyWrite(userServiceMock, dialogData);
    expect(hapticsMock.success).toHaveBeenCalledTimes(1);
    expect(dialogRefMock.close).toHaveBeenCalledWith({ saved: true });
  });

  it('adds a map tile and persists map settings', async () => {
    component.mode = 'add';
    component.category = 'map' as any;
    component.mapStyle = 'satellite';
    component.mapClusterMarkers = false;
    component.mapEventRange = '1y';
    component.mapEventActivityTypes = [ActivityTypes.Cycling];

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1].type).toBe(TileTypes.Map);
    expect(tiles[1].mapSource).toBe('events');
    expect(tiles[1].mapStyle).toBe('satellite');
    expect(tiles[1].clusterMarkers).toBe(false);
    expect(tiles[1].eventFilters).toEqual({
      range: '1y',
      activityTypes: [ActivityTypes.Cycling],
    });
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
  });

  it('adds a routes map tile without event filters', async () => {
    component.mode = 'add';
    component.category = 'map' as any;
    component.mapSource = 'routes';
    component.mapStyle = 'default';
    component.mapClusterMarkers = true;
    component.mapShowRouteEndpointMarkers = false;
    component.mapEventRange = '1y';
    component.mapEventActivityTypes = [ActivityTypes.Cycling];

    await component.save();

    const tile = dialogData.user.settings.dashboardSettings.tiles[1];
    expect(tile).toMatchObject({
      name: 'Routes',
      type: TileTypes.Map,
      mapSource: 'routes',
      mapStyle: 'default',
      size: { columns: 2, rows: 1 },
      clusterMarkers: false,
      showHeatMap: false,
      showRouteEndpointMarkers: false,
    });
    expect(tile.eventFilters).toBeUndefined();
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
  });

  it('adds a KPI tile with fixed derived settings', async () => {
    dialogData.user.settings.dashboardSettings.autoTiles = {
      kpiRampRate: {
        state: 'dismissed',
        dismissedAt: 1_777_000_000_000,
        source: 'default-kpi',
      },
    };
    component.mode = 'add';
    component.category = 'kpi' as any;
    component.kpiChartType = DASHBOARD_RAMP_RATE_KPI_CHART_TYPE as any;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.kpiRampRate).toMatchObject({
      state: 'added',
      source: 'default-kpi',
    });
  });

  it('adds freshness forecast curated tile with one-column default size', async () => {
    component.mode = 'add';
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE as any;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
      size: { columns: 1, rows: 1 },
    });
  });

  it('adds regular curated charts with one-column default size', async () => {
    component.mode = 'add';
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE as any;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      size: { columns: 1, rows: 1 },
    });
  });

  it('marks regular curated auto-tile state added when manually adding a dismissed curated chart', async () => {
    dialogData.user.settings.dashboardSettings.autoTiles = {
      curatedIntensityDistribution: {
        state: 'dismissed',
        dismissedAt: 1_777_000_000_000,
        source: 'default-curated',
      },
    };
    component.mode = 'add';
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE as any;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
      size: { columns: 1, rows: 1 },
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.curatedIntensityDistribution).toMatchObject({
      state: 'added',
      source: 'default-curated',
    });
  });

  it('adds Cycling Power Curve with its event-backed curated defaults', async () => {
    dialogData.user.settings.dashboardSettings.autoTiles = {
      powerCurve: {
        state: 'dismissed',
        dismissedAt: 1_777_000_000_000,
        source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
      },
    };
    component.mode = 'add';
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_POWER_CURVE_CHART_TYPE as any;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      name: 'Cycling Power Curve',
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      size: { columns: 2, rows: 1 },
      eventFilters: { range: '1y', activityTypes: getDashboardPowerCurveActivityTypes('cycling') },
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.powerCurve).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
  });

  it('adds curated Form with a wide one-row default size', async () => {
    component.mode = 'add';
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_FORM_CHART_TYPE as any;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      name: 'Form',
      chartType: DASHBOARD_FORM_CHART_TYPE,
      size: { columns: 2, rows: 1 },
    });
  });

  it('marks Sleep Trend auto-tile state added when manually adding Sleep Trend', async () => {
    dialogData.user.settings.dashboardSettings.autoTiles = {
      sleepTrend: {
        state: 'dismissed',
        dismissedAt: 1_777_000_000_000,
        source: 'sleep-sync',
      },
    };
    component.mode = 'add';
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_SLEEP_TREND_CHART_TYPE as any;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
      size: { columns: 1, rows: 1 },
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.sleepTrend).toMatchObject({
      state: 'added',
      source: 'sleep-sync',
    });
  });

  it('marks Sleep Trend auto-tile state dismissed when replacing it with another tile', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Chart,
      order: 0,
      name: 'Sleep',
      chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
      dataType: 'SleepDuration',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }];
    dialogData.user.settings.dashboardSettings.autoTiles = {
      sleepTrend: {
        state: 'added',
        addedAt: 1_777_000_000_000,
        source: 'sleep-sync',
      },
    };
    component.ngOnInit();
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_FORM_CHART_TYPE as any;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(1);
    expect(tiles[0].chartType).toBe(DASHBOARD_FORM_CHART_TYPE);
    expect(dialogData.user.settings.dashboardSettings.autoTiles.sleepTrend).toMatchObject({
      state: 'dismissed',
      source: 'sleep-sync',
    });
  });

  it('marks KPI auto-tile state dismissed when replacing it with another tile', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Chart,
      order: 0,
      name: 'ACWR',
      chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
      dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
    }];
    dialogData.user.settings.dashboardSettings.autoTiles = {
      kpiAcwr: {
        state: 'added',
        addedAt: 1_777_000_000_000,
        source: 'default-kpi',
      },
    };
    component.ngOnInit();
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'custom';
    component.customChartType = ChartTypes.ColumnsVertical;
    component.customDataType = DataDistance.type;
    component.customDataCategoryType = ChartDataCategoryTypes.DateType;
    component.customDataValueType = ChartDataValueTypes.Total;
    component.customTimeInterval = TimeIntervals.Auto;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(1);
    expect(tiles[0].chartType).toBe(ChartTypes.ColumnsVertical);
    expect(dialogData.user.settings.dashboardSettings.autoTiles.kpiAcwr).toMatchObject({
      state: 'dismissed',
      source: 'default-kpi',
    });
  });

  it('marks regular curated auto-tile state dismissed when replacing it with another tile', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Chart,
      order: 0,
      name: 'Intensity Distribution',
      chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
      dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
    }];
    dialogData.user.settings.dashboardSettings.autoTiles = {
      curatedIntensityDistribution: {
        state: 'added',
        addedAt: 1_777_000_000_000,
        source: 'default-curated',
      },
    };
    component.ngOnInit();
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'custom';
    component.customChartType = ChartTypes.ColumnsVertical;
    component.customDataType = DataDistance.type;
    component.customDataCategoryType = ChartDataCategoryTypes.DateType;
    component.customDataValueType = ChartDataValueTypes.Total;
    component.customTimeInterval = TimeIntervals.Auto;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(1);
    expect(tiles[0].chartType).toBe(ChartTypes.ColumnsVertical);
    expect(dialogData.user.settings.dashboardSettings.autoTiles.curatedIntensityDistribution).toMatchObject({
      state: 'dismissed',
      source: 'default-curated',
    });
  });

  it('marks Power Curve auto-tile state dismissed when replacing it with another tile', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Chart,
      order: 0,
      name: 'Cycling Power Curve',
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
      eventFilters: { range: '90d', activityTypes: [] },
    }];
    dialogData.user.settings.dashboardSettings.autoTiles = {
      powerCurve: {
        state: 'added',
        addedAt: 1_777_000_000_000,
        source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
      },
    };
    component.ngOnInit();
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'custom';
    component.customChartType = ChartTypes.ColumnsVertical;
    component.customDataType = DataDistance.type;
    component.customDataCategoryType = ChartDataCategoryTypes.DateType;
    component.customDataValueType = ChartDataValueTypes.Total;
    component.customTimeInterval = TimeIntervals.Auto;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(1);
    expect(tiles[0].chartType).toBe(ChartTypes.ColumnsVertical);
    expect(dialogData.user.settings.dashboardSettings.autoTiles.powerCurve).toMatchObject({
      state: 'dismissed',
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
  });

  it('normalizes edited Cycling Power Curve filters to derived scope defaults', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Chart,
      order: 0,
      name: 'Cycling Power Curve',
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
      eventFilters: { range: '30d', activityTypes: [ActivityTypes.Cycling] },
    }];
    component.ngOnInit();
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_POWER_CURVE_CHART_TYPE as any;

    await component.save();

    expect(dialogData.user.settings.dashboardSettings.tiles[0]).toMatchObject({
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      eventFilters: { range: '1y', activityTypes: getDashboardPowerCurveActivityTypes('cycling') },
    });
  });

  it('preserves Running Power Curve scope while normalizing derived filters when Cycling exists', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [
      {
        type: TileTypes.Chart,
        order: 0,
        name: 'Cycling Power Curve',
        chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
        dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Weekly,
        size: { columns: 1, rows: 1 },
        eventFilters: { range: '1y', activityTypes: getDashboardPowerCurveActivityTypes('cycling') },
      },
      {
        type: TileTypes.Chart,
        order: 1,
        name: 'Running Power Curve',
        chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
        dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Weekly,
        size: { columns: 1, rows: 1 },
        eventFilters: { range: '30d', activityTypes: [ActivityTypes.Running] },
      },
    ];
    component.ngOnInit();
    component.onModeChange('edit');
    component.onEditTileSelectionChange(1);

    expect(component.isSaveDisabled).toBe(false);

    await component.save();

    expect(dialogData.user.settings.dashboardSettings.tiles[1]).toMatchObject({
      name: 'Running Power Curve',
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      eventFilters: { range: '1y', activityTypes: getDashboardPowerCurveActivityTypes('running') },
    });
  });

  it('marks Recovery auto-tile and legacy recovery state dismissed when replacing Recovery', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Chart,
      order: 0,
      name: 'Recovery',
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      dataType: 'Recovery Time',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    }];
    dialogData.user.settings.dashboardSettings.dismissedCuratedRecoveryNowTile = false;
    dialogData.user.settings.dashboardSettings.autoTiles = {
      curatedRecoveryNow: {
        state: 'added',
        addedAt: 1_777_000_000_000,
        source: 'default-curated',
      },
    };
    component.ngOnInit();
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'custom';
    component.customChartType = ChartTypes.ColumnsVertical;
    component.customDataType = DataDistance.type;
    component.customDataCategoryType = ChartDataCategoryTypes.DateType;
    component.customDataValueType = ChartDataValueTypes.Total;
    component.customTimeInterval = TimeIntervals.Auto;

    await component.save();

    expect(dialogData.user.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(true);
    expect(dialogData.user.settings.dashboardSettings.autoTiles.curatedRecoveryNow).toMatchObject({
      state: 'dismissed',
      source: 'default-curated',
    });
  });

  it('preserves existing Sleep Trend auto-tile metadata when saving an unrelated tile', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Chart,
      order: 0,
      name: 'Sleep',
      chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
      dataType: 'SleepDuration',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }, {
      type: TileTypes.Chart,
      order: 1,
      name: 'Distance',
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    }];
    dialogData.user.settings.dashboardSettings.autoTiles = {
      sleepTrend: {
        state: 'added',
        addedAt: 1_777_000_000_000,
        lastQualifiedAt: 1_777_000_000_000,
        source: 'sleep-sync',
      },
    };
    component.ngOnInit();
    component.mode = 'edit';
    component.editTileOrder = 1;
    component.category = 'custom';
    component.customChartType = ChartTypes.LinesVertical;
    component.customDataType = DataDistance.type;
    component.customDataCategoryType = ChartDataCategoryTypes.DateType;
    component.customDataValueType = ChartDataValueTypes.Total;
    component.customTimeInterval = TimeIntervals.Weekly;

    await component.save();

    expect(dialogData.user.settings.dashboardSettings.autoTiles.sleepTrend).toEqual({
      state: 'added',
      addedAt: 1_777_000_000_000,
      lastQualifiedAt: 1_777_000_000_000,
      source: 'sleep-sync',
    });
  });

  it('applies freshness forecast curated preset with one-column default size', async () => {
    component.mode = 'add';
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('curated');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.CURATED_FRESHNESS_FORECAST);

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
      size: { columns: 1, rows: 1 },
    });
  });

  it('applies regular curated presets with one-column default size', async () => {
    component.mode = 'add';
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('curated');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.CURATED_RECOVERY);

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      size: { columns: 1, rows: 1 },
    });
  });

  it('applies Cycling Power Curve preset with its event-backed curated defaults', async () => {
    component.mode = 'add';
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('curated');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.CURATED_POWER_CURVE);

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      name: 'Cycling Power Curve',
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      size: { columns: 2, rows: 1 },
      eventFilters: { range: '1y', activityTypes: getDashboardPowerCurveActivityTypes('cycling') },
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.powerCurve).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
  });

  it('applies Running Power Curve preset independently from Cycling Power Curve', async () => {
    component.mode = 'add';
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('curated');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.CURATED_RUNNING_POWER_CURVE);

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      name: 'Running Power Curve',
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      size: { columns: 2, rows: 1 },
      eventFilters: { range: '1y', activityTypes: getDashboardPowerCurveActivityTypes('running') },
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.runningPowerCurve).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_SOURCE,
    });
  });

  it('filters manual KPI options by selected KPI group', () => {
    component.category = 'kpi' as any;
    component.onKpiGroupChange('readiness');

    expect(component.filteredKpiChartDefinitions.map(definition => definition.chartType)).toEqual([
      DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
      DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
      DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
      DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
      DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
      DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
    ]);

    component.onKpiGroupChange('execution');
    expect(component.filteredKpiChartDefinitions.map(definition => definition.chartType)).toEqual([
      DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
      DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
      DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
      DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
    ]);
  });

  it('filters KPI presets by selected KPI group', () => {
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('kpi');
    component.onPresetKpiGroupChange('readiness');

    expect(component.filteredPresetDefinitions.map(definition => definition.id)).toEqual([
      DASHBOARD_MANAGER_PRESET_IDS.KPI_LOAD_STATUS,
      DASHBOARD_MANAGER_PRESET_IDS.KPI_FORM_NOW,
      DASHBOARD_MANAGER_PRESET_IDS.KPI_FITNESS_CTL,
      DASHBOARD_MANAGER_PRESET_IDS.KPI_FATIGUE_ATL,
      DASHBOARD_MANAGER_PRESET_IDS.KPI_RECOVERY_DEBT,
      DASHBOARD_MANAGER_PRESET_IDS.KPI_FORM_PLUS_7D,
    ]);
  });

  it('should render presets tab content and category controls in template', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/summaries/dashboard-manager-dialog/dashboard-manager-dialog.component.html');
    const stylesPath = resolve(process.cwd(), 'src/app/components/summaries/dashboard-manager-dialog/dashboard-manager-dialog.component.css');
    const template = readFileSync(templatePath, 'utf8');
    const styles = readFileSync(stylesPath, 'utf8');

    expect(template).not.toContain('Simplify dashboard');
    expect(template).toContain('Add all');
    expect(template).toContain('Remove all');
    expect(template).toContain('Preset category');
    expect(template).toContain('Presets');
    expect(template).toContain('Apply preset');
    expect(template).toContain('mat-chip-listbox');
    expect(styles).toContain('.dashboard-manager-button-content');
    expect(styles).toContain('align-items: center;');
    expect(styles).toContain('line-height: 1;');
    expect(styles).toContain('.dashboard-manager-button-content mat-icon');
    expect(styles).toContain('.dashboard-manager-button-content mat-spinner');
  });

  it('starts a new dashboard clean rather than adding default training tiles', () => {
    dialogData.user.settings.dashboardSettings.tiles = [];

    expect(AppUserUtilities.getDefaultUserDashboardTiles()).toEqual([]);
    expect(component.dashboardTiles).toEqual([]);
    expect(component.isAddAllDisabled).toBe(false);
    expect(component.isRemoveAllDisabled).toBe(true);
  });

  it('adds every available dashboard manager preset tile when adding all', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [];

    await component.addAllTiles();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    const presetTiles = getDashboardManagerPresetDefinitions()
      .filter(definition => definition.id !== DASHBOARD_MANAGER_PRESET_IDS.CURATED_SLEEP)
      .map((definition, index) => buildDashboardManagerPresetTile({
        presetId: definition.id,
        order: index,
        size: getExpectedPresetDefaultSize(definition),
      }));

    expect(tiles).toHaveLength(presetTiles.length);
    expect(tiles.map(dashboardTileSignature)).toEqual(presetTiles.map(dashboardTileSignature));
    expect(tiles.filter((tile: any) => tile.type === TileTypes.Map)).toHaveLength(2);
    expect(tiles.some((tile: any) => tile.type === TileTypes.Map && tile.mapSource === 'events')).toBe(true);
    expect(tiles.some((tile: any) => tile.type === TileTypes.Map && tile.mapSource === 'routes')).toBe(true);
    expect(tiles.find((tile: any) => tile.type === TileTypes.Map && tile.mapSource === 'events')?.size).toEqual({ columns: 1, rows: 1 });
    expect(tiles.find((tile: any) => tile.type === TileTypes.Map && tile.mapSource === 'routes')?.size).toEqual({ columns: 2, rows: 1 });
    expect(tiles.some((tile: any) => tile.chartType === DASHBOARD_ACWR_KPI_CHART_TYPE)).toBe(true);
    expect(tiles.some((tile: any) => tile.chartType === DASHBOARD_RAMP_RATE_KPI_CHART_TYPE)).toBe(true);
    expect(tiles.some((tile: any) => tile.chartType === DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE)).toBe(true);
    expect(tiles.filter((tile: any) => tile.chartType === DASHBOARD_POWER_CURVE_CHART_TYPE)).toHaveLength(2);
    expect(tiles.some((tile: any) => tile.dataType === DataEnergy.type)).toBe(true);
    expect(tiles.some((tile: any) => tile.dataType === DataHeartRateAvg.type)).toBe(true);
    expect(tiles.some((tile: any) => tile.chartType === DASHBOARD_SLEEP_TREND_CHART_TYPE)).toBe(false);
    expect(dialogData.user.settings.dashboardSettings.autoTiles.kpiAcwr).toMatchObject({
      state: 'added',
      source: 'default-kpi',
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.powerCurve).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.runningPowerCurve).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_SOURCE,
    });
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
    expectDashboardSettingsOnlyWrite(userServiceMock, dialogData);
    expect(dialogRefMock.close).toHaveBeenCalledWith({ saved: true });
  });

  it('shows an Add all loading state while bulk all add is saving', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [];
    const saveDeferred = createDeferred<boolean>();
    userServiceMock.updateUserProperties.mockReturnValueOnce(saveDeferred.promise);

    const addAllPromise = component.addAllTiles();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const addAllButton: HTMLElement = fixture.nativeElement.querySelector('[data-testid="dashboard-manager-add-all-button"]');
    expect(component.isAddAllSaving).toBe(true);
    expect(component.savingAction).toBe('addAll');
    expect(addAllButton.getAttribute('aria-busy')).toBe('true');
    expect(addAllButton.textContent).toContain('Adding...');
    expect(addAllButton.querySelector('mat-spinner')).toBeTruthy();

    saveDeferred.resolve(true);
    await addAllPromise;

    expect(component.isSaving).toBe(false);
    expect(component.savingAction).toBeNull();
  });

  it('refreshes sleep eligibility when adding all tiles', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [];
    sleepServiceMock.watchHasAnySleepSession.mockReturnValueOnce(of(true));

    await component.addAllTiles();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles.some((tile: any) => tile.chartType === DASHBOARD_SLEEP_TREND_CHART_TYPE)).toBe(true);
    expect(sleepServiceMock.watchHasAnySleepSession).toHaveBeenCalledWith('user-1');
  });

  it('restores dashboard settings when adding all fails', async () => {
    dialogData.user.settings.dashboardSettings.autoTiles = {
      kpiAcwr: {
        state: 'dismissed',
        dismissedAt: 1_777_000_000_000,
        source: 'default-kpi',
      },
    };
    const originalTiles = dialogData.user.settings.dashboardSettings.tiles.map((tile: any) => ({
      ...tile,
      size: tile.size ? { ...tile.size } : tile.size,
    }));
    userServiceMock.updateUserProperties.mockRejectedValueOnce(new Error('network down'));

    await component.addAllTiles();

    expect(component.saveError).toBe('Could not save dashboard tile settings.');
    expect(dialogData.user.settings.dashboardSettings.tiles).toStrictEqual(originalTiles);
    expect(dialogData.user.settings.dashboardSettings.autoTiles.kpiAcwr).toEqual({
      state: 'dismissed',
      dismissedAt: 1_777_000_000_000,
      source: 'default-kpi',
    });
    expect(hapticsMock.error).toHaveBeenCalledTimes(1);
    expect(dialogRefMock.close).not.toHaveBeenCalledWith({ saved: true });
  });

  it('removes all dashboard tiles after confirmation and dismisses auto tiles', async () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Chart,
      order: 1,
      name: 'Recovery',
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      dataType: 'Recovery Time',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    });
    dialogData.user.settings.dashboardSettings.dismissedCuratedRecoveryNowTile = false;
    dialogData.user.settings.dashboardSettings.autoTiles = {
      curatedRecoveryNow: {
        state: 'added',
        addedAt: 1_777_000_000_000,
        source: 'default-curated',
      },
    };
    dialogMock.open.mockReturnValueOnce({
      afterClosed: () => of(true),
    });

    await component.removeAllTiles();

    expect(dialogData.user.settings.dashboardSettings.tiles).toEqual([]);
    expect(dialogData.user.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(true);
    expect(dialogData.user.settings.dashboardSettings.autoTiles.sleepTrend).toMatchObject({
      state: 'dismissed',
      source: 'sleep-sync',
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.routePreview).toMatchObject({
      state: 'dismissed',
      source: DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_SOURCE,
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.curatedRecoveryNow).toMatchObject({
      state: 'dismissed',
      source: 'default-curated',
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.powerCurve).toMatchObject({
      state: 'dismissed',
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.runningPowerCurve).toMatchObject({
      state: 'dismissed',
      source: DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_SOURCE,
    });
    expect(dialogData.user.settings.dashboardSettings.autoTiles.kpiAcwr).toMatchObject({
      state: 'dismissed',
      source: 'default-kpi',
    });
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
    expectDashboardSettingsOnlyWrite(userServiceMock, dialogData);
    expect(hapticsMock.success).toHaveBeenCalledTimes(1);
    expect(component.isRemoveAllDisabled).toBe(true);
    expect(component.isAddAllDisabled).toBe(false);
    expect(dialogRefMock.close).toHaveBeenCalledWith({ saved: true });
  });

  it('keeps dashboard tiles when remove all is cancelled', async () => {
    dialogMock.open.mockReturnValueOnce({
      afterClosed: () => of(false),
    });

    await component.removeAllTiles();

    expect(dialogData.user.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userServiceMock.updateUserProperties).not.toHaveBeenCalled();
    expect(dialogRefMock.close).not.toHaveBeenCalledWith({ saved: true });
  });

  it('restores dashboard settings when removing all fails', async () => {
    dialogData.user.settings.dashboardSettings.dismissedCuratedRecoveryNowTile = false;
    dialogData.user.settings.dashboardSettings.autoTiles = {
      curatedRecoveryNow: {
        state: 'added',
        addedAt: 1_777_000_000_000,
        source: 'default-curated',
      },
    };
    const originalTiles = dialogData.user.settings.dashboardSettings.tiles.map((tile: any) => ({
      ...tile,
      size: tile.size ? { ...tile.size } : tile.size,
    }));
    dialogMock.open.mockReturnValueOnce({
      afterClosed: () => of(true),
    });
    userServiceMock.updateUserProperties.mockRejectedValueOnce(new Error('network down'));

    await component.removeAllTiles();

    expect(component.saveError).toBe('Could not save dashboard tile settings.');
    expect(dialogData.user.settings.dashboardSettings.tiles).toStrictEqual(originalTiles);
    expect(dialogData.user.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(false);
    expect(dialogData.user.settings.dashboardSettings.autoTiles.curatedRecoveryNow).toEqual({
      state: 'added',
      addedAt: 1_777_000_000_000,
      source: 'default-curated',
    });
    expect(hapticsMock.error).toHaveBeenCalledTimes(1);
    expect(dialogRefMock.close).not.toHaveBeenCalledWith({ saved: true });
  });

  it('applies a preset in add mode and appends a new tile', async () => {
    component.mode = 'add';
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('custom');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_WEEKLY_DISTANCE_TREND);

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1]).toMatchObject({
      type: TileTypes.Chart,
      chartType: ChartTypes.LinesVertical,
      dataTimeInterval: TimeIntervals.Weekly,
      dataType: DataDistance.type,
      order: 1,
      size: { columns: 1, rows: 1 },
      eventFilters: { range: '90d', activityTypes: [] },
    });
  });

  it('applies a preset in edit mode and preserves tile order and size', async () => {
    dialogData.user.settings.dashboardSettings.tiles[0].size = { columns: 2, rows: 3 };
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('custom');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_DURATION_PIE);

    await component.save();

    const tile = dialogData.user.settings.dashboardSettings.tiles[0];
    expect(tile).toMatchObject({
      type: TileTypes.Chart,
      order: 0,
      size: { columns: 2, rows: 3 },
      chartType: ChartTypes.Pie,
      dataType: DataDuration.type,
      dataValueType: ChartDataValueTypes.Total,
    });
  });

  it('prevents adding a duplicate curated chart type', async () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Chart,
      order: 1,
      name: 'Recovery',
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      dataType: 'Recovery Time',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    });
    component.mode = 'add';
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE;

    expect(component.isCuratedOptionDisabled(component.curatedChartType)).toBe(true);
    expect(component.isSaveDisabled).toBe(true);

    await component.save();

    expect(component.saveError).toBe('');
    expect(userServiceMock.updateUserProperties).not.toHaveBeenCalled();
    expect(dialogRefMock.close).not.toHaveBeenCalledWith({ saved: true });
  });

  it('disables curated preset option when that curated tile already exists', () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Chart,
      order: 1,
      name: 'Recovery',
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      dataType: 'Recovery Time',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    });

    component.mode = 'add';
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('curated');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.CURATED_RECOVERY);

    expect(component.selectedPresetDisabledReason).toBe('Already on dashboard.');
    expect(component.isSaveDisabled).toBe(true);
  });

  it('disables KPI preset option when that KPI tile already exists', () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Chart,
      order: 1,
      name: 'ACWR',
      chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
      dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Weekly,
      size: { columns: 1, rows: 1 },
    });

    component.mode = 'add';
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('kpi');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.KPI_ACWR);

    expect(component.selectedPresetDisabledReason).toBe('Already on dashboard.');
    expect(component.isSaveDisabled).toBe(true);
  });

  it('prevents adding a duplicate map tile', async () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Map,
      order: 1,
      name: 'Map',
      mapStyle: 'default',
      mapTheme: 'normal',
      showHeatMap: true,
      clusterMarkers: true,
      size: { columns: 1, rows: 1 },
    });

    component.mode = 'add';
    component.category = 'map' as any;

    expect(component.isMapOptionDisabled()).toBe(true);
    expect(component.isSaveDisabled).toBe(true);

    await component.save();

    expect(component.saveError).toBe('');
    expect(userServiceMock.updateUserProperties).not.toHaveBeenCalled();
  });

  it('allows adding a routes map when an activities map already exists', () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Map,
      order: 1,
      name: 'Map',
      mapSource: 'events',
      mapStyle: 'default',
      mapTheme: 'normal',
      showHeatMap: true,
      clusterMarkers: true,
      size: { columns: 1, rows: 1 },
    });

    component.mode = 'add';
    component.category = 'map' as any;
    component.mapSource = 'routes';

    expect(component.isMapOptionDisabled()).toBe(false);
    expect(component.isSaveDisabled).toBe(false);
  });

  it('disables map preset option when a map tile already exists', () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Map,
      order: 1,
      name: 'Map',
      mapStyle: 'default',
      mapTheme: 'normal',
      showHeatMap: true,
      clusterMarkers: true,
      size: { columns: 1, rows: 1 },
    });

    component.mode = 'add';
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('map');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.MAP_DEFAULT_CLUSTERED);

    expect(component.selectedPresetDisabledReason).toBe('Map tile already exists.');
    expect(component.isSaveDisabled).toBe(true);
  });

  it('keeps the routes map preset enabled when only an activities map exists', () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Map,
      order: 1,
      name: 'Map',
      mapSource: 'events',
      mapStyle: 'default',
      mapTheme: 'normal',
      showHeatMap: true,
      clusterMarkers: true,
      size: { columns: 1, rows: 1 },
    });

    component.mode = 'add';
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('map');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.MAP_ROUTES_PREVIEW);

    expect(component.selectedPresetDisabledReason).toBeNull();
    expect(component.isSaveDisabled).toBe(false);
  });

  it('edits an existing chart and switches it to curated form', async () => {
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_FORM_CHART_TYPE;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles[0].chartType).toBe(DASHBOARD_FORM_CHART_TYPE);
    expect(tiles[0].dataType).toBe(DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE);
    expect(tiles[0].dataTimeInterval).toBe(TimeIntervals.Daily);
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
  });

  it('preserves persisted display settings when editing the same curated chart', async () => {
    dialogData.user.settings.dashboardSettings.tiles[0] = {
      type: TileTypes.Chart,
      order: 0,
      name: 'Form',
      chartType: DASHBOARD_FORM_CHART_TYPE,
      dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
      displaySettings: { formTimelineWindow: 'y', derivedChartRange: 'all' },
    };
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_FORM_CHART_TYPE;

    await component.save();

    expect(dialogData.user.settings.dashboardSettings.tiles[0].displaySettings).toEqual({
      formTimelineWindow: 'y',
    });
  });

  it('edits an existing map tile and updates map settings', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Map,
      order: 0,
      name: 'My map',
      mapStyle: 'default',
      mapTheme: 'normal',
      showHeatMap: true,
      clusterMarkers: true,
      size: { columns: 1, rows: 1 },
    }];
    component.ngOnInit();

    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'map' as any;
    component.mapStyle = 'outdoors';
    component.mapClusterMarkers = false;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles[0].type).toBe(TileTypes.Map);
    expect(tiles[0].mapStyle).toBe('outdoors');
    expect(tiles[0].clusterMarkers).toBe(false);
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
  });

  it('renames an event map to Routes when changing its source to saved routes', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Map,
      order: 0,
      name: 'Clustered HeatMap',
      mapSource: 'events',
      mapStyle: 'default',
      mapTheme: 'normal',
      showHeatMap: true,
      clusterMarkers: true,
      size: { columns: 1, rows: 1 },
      eventFilters: { range: '90d', activityTypes: [] },
    }];
    component.ngOnInit();

    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'map' as any;
    component.mapSource = 'routes';
    component.mapShowRouteEndpointMarkers = true;

    await component.save();

    const tile = dialogData.user.settings.dashboardSettings.tiles[0];
    expect(tile).toMatchObject({
      name: 'Routes',
      type: TileTypes.Map,
      mapSource: 'routes',
      clusterMarkers: false,
      showHeatMap: false,
      showRouteEndpointMarkers: true,
    });
    expect(tile.eventFilters).toBeUndefined();
  });

  it('converts a chart tile to map in edit mode', async () => {
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'map' as any;
    component.mapStyle = 'satellite';
    component.mapClusterMarkers = true;

    await component.save();

    const tile = dialogData.user.settings.dashboardSettings.tiles[0];
    expect(tile.type).toBe(TileTypes.Map);
    expect(tile.mapSource).toBe('events');
    expect(tile.mapStyle).toBe('satellite');
    expect(tile.clusterMarkers).toBe(true);
    expect(tile.eventFilters).toEqual({ range: '90d', activityTypes: [] });
  });

  it('converts a map tile to custom chart in edit mode', async () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Map,
      order: 0,
      name: 'Map tile',
      mapStyle: 'default',
      mapTheme: 'normal',
      showHeatMap: true,
      clusterMarkers: true,
      size: { columns: 1, rows: 1 },
    }];
    component.ngOnInit();

    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'custom';
    component.customChartType = ChartTypes.ColumnsHorizontal;
    component.customDataType = DataDistance.type;
    component.customDataCategoryType = ChartDataCategoryTypes.ActivityType;
    component.customDataValueType = ChartDataValueTypes.Total;
    component.customTimeInterval = TimeIntervals.Auto;

    await component.save();

    const tile = dialogData.user.settings.dashboardSettings.tiles[0];
    expect(tile.type).toBe(TileTypes.Chart);
    expect(tile.chartType).toBe(ChartTypes.ColumnsHorizontal);
    expect(tile.dataType).toBe(DataDistance.type);
    expect(tile.eventFilters).toEqual({ range: '90d', activityTypes: [] });
  });

  it('resets stale event filters when converting selected tiles into custom or map tiles', () => {
    dialogData.user.settings.dashboardSettings.tiles = [{
      type: TileTypes.Chart,
      order: 0,
      name: 'Custom distance',
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
      eventFilters: { range: '2y', activityTypes: [ActivityTypes.Running] },
    }, {
      type: TileTypes.Map,
      order: 1,
      name: 'Map tile',
      mapStyle: 'default',
      mapTheme: 'normal',
      showHeatMap: true,
      clusterMarkers: true,
      size: { columns: 1, rows: 1 },
      eventFilters: { range: '3y', activityTypes: [ActivityTypes.Cycling] },
    }];
    component.ngOnInit();
    component.onModeChange('edit');

    component.onEditTileSelectionChange(0);
    expect(component.customEventRange).toBe('2y');
    expect(component.customEventActivityTypes).toEqual([ActivityTypes.Running]);

    component.mapEventRange = '4y';
    component.mapEventActivityTypes = [ActivityTypes.Swimming];
    component.onCategoryChange('map');
    expect(component.mapEventRange).toBe('90d');
    expect(component.mapEventActivityTypes).toEqual([]);

    component.onEditTileSelectionChange(1);
    expect(component.mapEventRange).toBe('3y');
    expect(component.mapEventActivityTypes).toEqual([ActivityTypes.Cycling]);

    component.customEventRange = '1y';
    component.customEventActivityTypes = [ActivityTypes.Swimming];
    component.onCategoryChange('custom');
    expect(component.customEventRange).toBe('90d');
    expect(component.customEventActivityTypes).toEqual([]);
  });

  it('resets event filters when returning to add mode', () => {
    dialogData.user.settings.dashboardSettings.tiles[0].eventFilters = {
      range: '2y',
      activityTypes: [ActivityTypes.Running],
    };
    component.ngOnInit();

    component.onModeChange('edit');
    component.onEditTileSelectionChange(0);
    expect(component.customEventRange).toBe('2y');

    component.mapEventRange = '3y';
    component.mapEventActivityTypes = [ActivityTypes.Cycling];
    component.onModeChange('add');

    expect(component.category).toBe('custom');
    expect(component.customEventRange).toBe('90d');
    expect(component.customEventActivityTypes).toEqual([]);
    expect(component.mapEventRange).toBe('90d');
    expect(component.mapEventActivityTypes).toEqual([]);
  });

  it('requires confirmation before selecting all events in manager tile filters', async () => {
    component.customEventRange = '90d';
    dialogMock.open.mockReturnValueOnce({
      afterClosed: () => of(false),
    });

    await component.onCustomEventRangeChange('all');

    expect(component.customEventRange).toBe('90d');

    dialogMock.open.mockReturnValueOnce({
      afterClosed: () => of(true),
    });

    await component.onCustomEventRangeChange('all');

    expect(component.customEventRange).toBe('all');
  });

  it('restores dashboard settings when saving fails', async () => {
    dialogData.user.settings.dashboardSettings.dismissedCuratedRecoveryNowTile = true;
    const originalTiles = dialogData.user.settings.dashboardSettings.tiles.map((tile: any) => ({
      ...tile,
      size: tile.size ? { ...tile.size } : tile.size,
    }));

    userServiceMock.updateUserProperties.mockRejectedValueOnce(new Error('network down'));
    component.mode = 'add';
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE;

    await component.save();

    expect(component.saveError).toBe('Could not save dashboard tile settings.');
    expect(dialogData.user.settings.dashboardSettings.tiles).toStrictEqual(originalTiles);
    expect(dialogData.user.settings.dashboardSettings.tiles[0]).not.toHaveProperty('eventFilters');
    expect(dialogData.user.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(true);
    expect(hapticsMock.error).toHaveBeenCalledTimes(1);
    expect(dialogRefMock.close).not.toHaveBeenCalledWith({ saved: true });
  });

  it('restores nested event filters when saving an edit fails', async () => {
    dialogData.user.settings.dashboardSettings.tiles[0].eventFilters = {
      range: '30d',
      activityTypes: [ActivityTypes.Running],
    };
    userServiceMock.updateUserProperties.mockRejectedValueOnce(new Error('network down'));
    component.ngOnInit();
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'custom';
    component.customChartType = ChartTypes.ColumnsVertical;
    component.customDataType = DataDistance.type;
    component.customDataCategoryType = ChartDataCategoryTypes.DateType;
    component.customDataValueType = ChartDataValueTypes.Total;
    component.customTimeInterval = TimeIntervals.Auto;
    component.customEventRange = '1y';
    component.customEventActivityTypes = [ActivityTypes.Cycling];

    await component.save();

    expect(dialogData.user.settings.dashboardSettings.tiles[0].eventFilters).toEqual({
      range: '30d',
      activityTypes: [ActivityTypes.Running],
    });
    expect(dialogData.user.settings.dashboardSettings.tiles[0].eventFilters.activityTypes).toEqual([ActivityTypes.Running]);
  });

  it('triggers selection haptics for manager interaction changes and close', () => {
    component.onModeChange('edit');
    component.onWorkflowTabChange(1);
    component.onEditTileSelectionChange(0);
    component.onCategoryChange('custom');
    component.onPresetCategoryChange('custom');
    component.onKpiGroupChange('load');
    component.onPresetKpiGroupChange('load');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_WEEKLY_DISTANCE_TREND);
    component.onCustomChartTypeChange(ChartTypes.Pie);
    component.close();

    expect(hapticsMock.selection).toHaveBeenCalledTimes(10);
  });

  it('allows add save flow when dashboard already has many tiles', async () => {
    dialogData.user.settings.dashboardSettings.tiles = Array.from({ length: 12 }, (_value, index) => ({
      type: TileTypes.Chart,
      order: index,
      name: `Tile-${index}`,
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    }));

    component.ngOnInit();

    expect(component.isSaveDisabled).toBe(false);

    component.mode = 'add';
    component.category = 'custom';
    component.customChartType = ChartTypes.Pie;
    component.customDataType = DataDistance.type;
    component.customDataCategoryType = ChartDataCategoryTypes.ActivityType;
    component.customDataValueType = ChartDataValueTypes.Maximum;
    component.customTimeInterval = TimeIntervals.Monthly;

    await component.save();

    expect(dialogData.user.settings.dashboardSettings.tiles).toHaveLength(13);
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
  });

  it('allows preset add flow when dashboard already has many tiles', async () => {
    dialogData.user.settings.dashboardSettings.tiles = Array.from({ length: 12 }, (_value, index) => ({
      type: TileTypes.Chart,
      order: index,
      name: `Tile-${index}`,
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    }));

    component.ngOnInit();
    component.onWorkflowTabChange(1);
    component.onPresetCategoryChange('custom');
    component.onPresetSelectionChange(DASHBOARD_MANAGER_PRESET_IDS.CUSTOM_DURATION_PIE);

    expect(component.selectedPresetDisabledReason).toBe(null);
    expect(component.isSaveDisabled).toBe(false);

    await component.save();

    expect(dialogData.user.settings.dashboardSettings.tiles).toHaveLength(13);
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
  });

  it('loads current chart values when edit mode selects a tile', () => {
    component.onModeChange('edit');
    component.onEditTileSelectionChange(0);

    expect(component.category).toBe('custom');
    expect(component.customChartType).toBe(ChartTypes.ColumnsVertical);
    expect(component.customDataType).toBe(DataDistance.type);
  });

  it('loads current custom event filters when edit mode selects a custom tile', () => {
    dialogData.user.settings.dashboardSettings.tiles[0].eventFilters = {
      range: '2y',
      activityTypes: [ActivityTypes.Running],
    };
    component.ngOnInit();

    component.onModeChange('edit');
    component.onEditTileSelectionChange(0);

    expect(component.customEventRange).toBe('2y');
    expect(component.customEventActivityTypes).toEqual([ActivityTypes.Running]);
  });

  it('loads current map values when edit mode selects a map tile', () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Map,
      order: 1,
      name: 'Map tile',
      mapStyle: 'outdoors',
      mapTheme: 'normal',
      showHeatMap: true,
      clusterMarkers: false,
      size: { columns: 1, rows: 1 },
      eventFilters: { range: '3y', activityTypes: [ActivityTypes.Cycling] },
    });
    component.ngOnInit();
    component.onModeChange('edit');
    component.onEditTileSelectionChange(1);

    expect(component.category).toBe('map');
    expect(component.mapStyle).toBe('outdoors');
    expect(component.mapClusterMarkers).toBe(false);
    expect(component.mapEventRange).toBe('3y');
    expect(component.mapEventActivityTypes).toEqual([ActivityTypes.Cycling]);
  });

  it('initializes in edit mode when dialog receives initial edit state', () => {
    dialogData.user.settings.dashboardSettings.tiles.push({
      type: TileTypes.Chart,
      order: 1,
      name: 'Recovery',
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      dataType: 'Recovery Time',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    });
    (component as any).data.initialMode = 'edit';
    (component as any).data.initialEditTileOrder = 1;

    component.ngOnInit();

    expect(component.mode).toBe('edit');
    expect(component.editTileOrder).toBe(1);
    expect(component.category).toBe('curated');
    expect(component.curatedChartType).toBe(DASHBOARD_RECOVERY_NOW_CHART_TYPE);
  });

  it('scrolls and focuses the edit section after deep-link edit initialization', () => {
    (component as any).data.initialMode = 'edit';
    (component as any).data.initialEditTileOrder = 0;
    const focusSpy = vi.spyOn(component as any, 'scrollAndFocusInitialEditSection');

    component.ngOnInit();
    component.ngAfterViewInit();

    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('focuses custom chart type selector when auto-focusing a custom edit section', () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    (component as any).mode = 'edit';
    (component as any).category = 'custom';
    (component as any).shouldAutoFocusEditSection = true;
    (component as any).customSectionRef = { nativeElement: { scrollIntoView } };
    (component as any).customChartTypeSelect = { focus };

    (component as any).scrollAndFocusInitialEditSection();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('focuses first curated radio option when auto-focusing a curated edit section', () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    (component as any).mode = 'edit';
    (component as any).category = 'curated';
    (component as any).shouldAutoFocusEditSection = true;
    (component as any).curatedSectionRef = {
      nativeElement: {
        scrollIntoView,
        querySelector: vi.fn().mockReturnValue({ focus }),
      },
    };

    (component as any).scrollAndFocusInitialEditSection();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('focuses map style selector when auto-focusing a map edit section', () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    (component as any).mode = 'edit';
    (component as any).category = 'map';
    (component as any).shouldAutoFocusEditSection = true;
    (component as any).mapSectionRef = { nativeElement: { scrollIntoView } };
    (component as any).mapStyleSelect = { focus };

    (component as any).scrollAndFocusInitialEditSection();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
