import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataDistance,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from '../../../helpers/dashboard-form.helper';
import {
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
} from '../../../helpers/dashboard-special-chart-types';
import { AppUserService } from '../../../services/app.user.service';
import { DashboardChartManagerDialogComponent } from './chart-manager-dialog.component';

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

describe('DashboardChartManagerDialogComponent', () => {
  let component: DashboardChartManagerDialogComponent;
  let fixture: ComponentFixture<DashboardChartManagerDialogComponent>;
  let userServiceMock: { updateUserProperties: ReturnType<typeof vi.fn> };
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let dialogData: { user: any };

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
      declarations: [DashboardChartManagerDialogComponent],
      providers: [
        { provide: AppUserService, useValue: userServiceMock },
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardChartManagerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.curatedChartDefinitions.map(definition => definition.chartType)).toEqual([
      DASHBOARD_RECOVERY_NOW_CHART_TYPE,
      DASHBOARD_FORM_CHART_TYPE,
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

  it('edits an existing chart and switches it to curated form', async () => {
    component.mode = 'edit';
    component.editChartOrder = 0;
    component.category = 'curated';
    component.curatedChartType = DASHBOARD_FORM_CHART_TYPE;

    await component.save();

    const tiles = dialogData.user.settings.dashboardSettings.tiles;
    expect(tiles[0].chartType).toBe(DASHBOARD_FORM_CHART_TYPE);
    expect(tiles[0].dataType).toBe(DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE);
    expect(tiles[0].dataTimeInterval).toBe(TimeIntervals.Daily);
    expect(userServiceMock.updateUserProperties).toHaveBeenCalledTimes(1);
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

    expect(component.saveError).toBe('Could not save chart settings.');
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

  it('loads current chart values when edit mode selects a tile', () => {
    component.onModeChange('edit');
    component.onEditChartSelectionChange(0);

    expect(component.category).toBe('custom');
    expect(component.customChartType).toBe(ChartTypes.ColumnsVertical);
    expect(component.customDataType).toBe(DataDistance.type);
  });
});
