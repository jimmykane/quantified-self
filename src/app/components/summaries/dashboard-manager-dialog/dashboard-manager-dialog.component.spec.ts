import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataDistance,
  DataDuration,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from '../../../helpers/dashboard-form.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
} from '../../../helpers/dashboard-special-chart-types';
import { DASHBOARD_MANAGER_PRESET_IDS } from '../../../helpers/dashboard-manager-presets.helper';
import { AppUserService } from '../../../services/app.user.service';
import { DashboardManagerDialogComponent } from './dashboard-manager-dialog.component';

function createUser(tiles: any[] = []): any {
  return {
    uid: 'user-1',
    settings: {
      unitSettings: {
        speedUnits: [],
      },
      dashboardSettings: {
        tiles,
      },
    },
  };
}

describe('DashboardManagerDialogComponent', () => {
  let component: DashboardManagerDialogComponent;
  let fixture: ComponentFixture<DashboardManagerDialogComponent>;
  let userServiceMock: { updateUserProperties: ReturnType<typeof vi.fn> };
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
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

    await TestBed.configureTestingModule({
      declarations: [DashboardManagerDialogComponent],
      providers: [
        { provide: AppUserService, useValue: userServiceMock },
        { provide: MatDialogRef, useValue: dialogRefMock },
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
    ]);
    expect(component.kpiChartDefinitions.map(definition => definition.chartType)).toEqual([
      DASHBOARD_ACWR_KPI_CHART_TYPE,
      DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
      DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
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

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1].chartType).toBe(ChartTypes.Pie);
    expect(tiles[1].dataType).toBe(DataDistance.type);
    expect(tiles[1].dataValueType).toBe(ChartDataValueTypes.Total);
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledWith(dialogData.user, {
      settings: dialogData.user.settings,
    });
    expect(dialogRefMock.close).toHaveBeenCalledWith({ saved: true });
  });

  it('adds a map tile and persists map settings', async () => {
    component.mode = 'add';
    component.category = 'map' as any;
    component.mapStyle = 'satellite';
    component.mapClusterMarkers = false;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles).toHaveLength(2);
    expect(tiles[1].type).toBe(TileTypes.Map);
    expect(tiles[1].mapStyle).toBe('satellite');
    expect(tiles[1].clusterMarkers).toBe(false);
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
  });

  it('adds a KPI tile with fixed derived settings', async () => {
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
  });

  it('should render presets tab content and category controls in template', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/summaries/dashboard-manager-dialog/dashboard-manager-dialog.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).toContain('Preset category');
    expect(template).toContain('Presets');
    expect(template).toContain('Apply preset');
    expect(template).toContain('mat-chip-listbox');
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

  it('converts a chart tile to map in edit mode', async () => {
    component.mode = 'edit';
    component.editTileOrder = 0;
    component.category = 'map' as any;
    component.mapStyle = 'satellite';
    component.mapClusterMarkers = true;

    await component.save();

    const tile = dialogData.user.settings.dashboardSettings.tiles[0];
    expect(tile.type).toBe(TileTypes.Map);
    expect(tile.mapStyle).toBe('satellite');
    expect(tile.clusterMarkers).toBe(true);
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
    expect(dialogData.user.settings.dashboardSettings.tiles).toEqual(originalTiles);
    expect(dialogData.user.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(true);
    expect(dialogRefMock.close).not.toHaveBeenCalledWith({ saved: true });
  });

  it('disables add save flow when dashboard tile limit is reached', () => {
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

    expect(component.isTileLimitReached).toBe(true);
    expect(component.isSaveDisabled).toBe(true);
  });

  it('disables preset add flow when dashboard tile limit is reached', () => {
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

    expect(component.selectedPresetDisabledReason).toBe('Tile limit reached.');
    expect(component.isSaveDisabled).toBe(true);
  });

  it('loads current chart values when edit mode selects a tile', () => {
    component.onModeChange('edit');
    component.onEditTileSelectionChange(0);

    expect(component.category).toBe('custom');
    expect(component.customChartType).toBe(ChartTypes.ColumnsVertical);
    expect(component.customDataType).toBe(DataDistance.type);
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
    });
    component.ngOnInit();
    component.onModeChange('edit');
    component.onEditTileSelectionChange(1);

    expect(component.category).toBe('map');
    expect(component.mapStyle).toBe('outdoors');
    expect(component.mapClusterMarkers).toBe(false);
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
