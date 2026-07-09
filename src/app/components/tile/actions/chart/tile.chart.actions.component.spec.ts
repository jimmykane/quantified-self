import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TileChartActionsComponent } from './tile.chart.actions.component';
import { AppUserService } from '../../../../services/app.user.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { AppHapticsService } from '../../../../services/app.haptics.service';
import { TileActionsFooterComponent } from '../footer/tile.actions.footer.component';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { ChartTypes, ChartDataValueTypes, ChartDataCategoryTypes, DataRecoveryTime, TileTypes } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
} from '../../../../helpers/dashboard-special-chart-types';

describe('TileChartActionsComponent', () => {
  let component: TileChartActionsComponent;
  let fixture: ComponentFixture<TileChartActionsComponent>;
  let userMock: any;
  let analyticsMock: any;
  let hapticsMock: { selection: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    userMock = {
      settings: {
        appSettings: { theme: 'dark' },
        unitSettings: { startOfTheWeek: 1 },
        dashboardSettings: {
          dismissedCuratedRecoveryNowTile: false,
          tiles: [
            {
              order: 0,
              chartType: ChartTypes.Bar,
              dataType: 'Distance',
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.ActivityType,
              size: { columns: 1, rows: 1 },
              type: 'Chart',
            },
            {
              order: 1,
              chartType: ChartTypes.Line,
              dataType: 'Duration',
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.ActivityType,
              size: { columns: 1, rows: 1 },
              type: 'Chart',
            },
          ],
        },
      },
      updateUserProperties: vi.fn().mockResolvedValue(true),
    };

    analyticsMock = {
      logEvent: vi.fn(),
    };
    hapticsMock = {
      selection: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [TileChartActionsComponent, TileActionsFooterComponent],
      imports: [
        MatMenuModule,
        MatSelectModule,
        MatIconModule,
        BrowserAnimationsModule,
        FormsModule,
      ],
      providers: [
        { provide: AppUserService, useValue: userMock },
        { provide: AppAnalyticsService, useValue: analyticsMock },
        { provide: AppHapticsService, useValue: hapticsMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TileChartActionsComponent);
    component = fixture.componentInstance;
    component.user = userMock;
    component.order = 0;
    component.chartType = ChartTypes.Bar;
    component.size = { columns: 1, rows: 1 };
    component.type = 'Chart' as any;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should use form menu panel classes', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/chart/tile.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toMatch(/<mat-menu[^>]*class="[^"]*qs-menu-panel[^"]*qs-menu-panel-form[^"]*qs-config-menu[^"]*"/);
  });

  it('should keep compact submenu panel classes for row and column size selects', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/chart/tile.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');
    const compactClassMatches = template.match(/panelClass="qs-config-submenu qs-config-submenu-compact"/g) ?? [];
    expect(compactClassMatches.length).toBe(2);
  });

  it('should remove chart data configuration controls and add-new action from the tile menu', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/chart/tile.chart.actions.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).not.toContain('app-tile-actions-header');
    expect(template).not.toContain('<mat-label>Type</mat-label>');
    expect(template).not.toContain('Chart type');
    expect(template).not.toContain('What data to look at');
    expect(template).not.toContain('How to look at the data');
    expect(template).not.toContain('Time interval');
    expect(template).toContain('Edit');
  });

  it('should emit editInDashboardManager with current tile order', () => {
    const emittedOrders: number[] = [];
    component.editInDashboardManager.subscribe((order) => emittedOrders.push(order));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    component.order = 1;
    component.openEditInDashboardManager({ preventDefault, stopPropagation } as any);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(emittedOrders).toEqual([1]);
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('should emit savingChange while persisting structural settings', async () => {
    const emittedStates: boolean[] = [];
    component.savingChange.subscribe(isSaving => emittedStates.push(isSaving));

    await component.changeTileColumnSize({ value: 2 } as any);

    expect(emittedStates).toEqual([true, false]);
    expect(userMock.updateUserProperties).toHaveBeenCalledWith(userMock, {
      settings: {
        dashboardSettings: {
          tiles: userMock.settings.dashboardSettings.tiles,
        },
      },
    });
    expect(userMock.updateUserProperties.mock.calls[0][1].settings.appSettings).toBeUndefined();
    expect(userMock.updateUserProperties.mock.calls[0][1].settings.unitSettings).toBeUndefined();
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('should hide and ignore layout controls when disabled', async () => {
    component.showLayoutControls = false;
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.tile-size-actions')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.tile-actions-divider')).toBeNull();

    await component.changeTileColumnSize({ value: 3 } as any);

    expect(userMock.settings.dashboardSettings.tiles[0].size.columns).toBe(1);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
    expect(hapticsMock.selection).not.toHaveBeenCalled();
  });

  it('should expose move boundaries for the first tile', () => {
    expect(component.canMoveTileBackward()).toBe(false);
    expect(component.canMoveTileForward()).toBe(true);
  });

  it('should move a tile forward and persist the new order', async () => {
    await component.moveTileForward();

    expect(analyticsMock.logEvent).toHaveBeenCalledWith('dashboard_tile_action', { method: 'moveTileForward' });
    expect(userMock.settings.dashboardSettings.tiles.map((tile: any) => tile.order)).toEqual([0, 1]);
    expect(userMock.settings.dashboardSettings.tiles[0].chartType).toBe(ChartTypes.Line);
    expect(userMock.settings.dashboardSettings.tiles[1].chartType).toBe(ChartTypes.Bar);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('should not move a chart tile into another inferred dashboard section', async () => {
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: ChartTypes.Bar,
        dataType: 'Distance',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.ActivityType,
        size: { columns: 1, rows: 1 },
        type: TileTypes.Chart,
      },
      {
        order: 1,
        mapStyle: 'default',
        clusterMarkers: true,
        size: { columns: 1, rows: 1 },
        type: TileTypes.Map,
      },
    ];

    expect(component.canMoveTileForward()).toBe(false);

    await component.moveTileForward();

    expect(userMock.settings.dashboardSettings.tiles[0].type).toBe(TileTypes.Chart);
    expect(userMock.settings.dashboardSettings.tiles[1].type).toBe(TileTypes.Map);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
  });

  it('should move KPI tiles within the Today lane before chart sections', async () => {
    userMock.settings.dashboardSettings.tiles = [
      {
        name: 'First KPI',
        order: 0,
        chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
        size: { columns: 1, rows: 1 },
        type: TileTypes.Chart,
      },
      {
        name: 'Activity chart',
        order: 1,
        chartType: ChartTypes.Bar,
        dataType: 'Distance',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.ActivityType,
        size: { columns: 1, rows: 1 },
        type: TileTypes.Chart,
      },
      {
        name: 'Second KPI',
        order: 2,
        chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
        size: { columns: 1, rows: 1 },
        type: TileTypes.Chart,
      },
    ];
    component.order = 0;

    expect(component.canMoveTileForward()).toBe(true);

    await component.moveTileForward();

    expect(userMock.settings.dashboardSettings.tiles.map((tile: any) => tile.name)).toEqual([
      'Second KPI',
      'First KPI',
      'Activity chart',
    ]);
    expect(userMock.settings.dashboardSettings.tiles.map((tile: any) => tile.order)).toEqual([0, 1, 2]);
    expect(component.order).toBe(1);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
  });

  it('should not persist when trying to move the first tile backward', async () => {
    await component.moveTileBackward();

    expect(userMock.settings.dashboardSettings.tiles.map((tile: any) => tile.order)).toEqual([0, 1]);
    expect(userMock.settings.dashboardSettings.tiles[0].chartType).toBe(ChartTypes.Bar);
    expect(userMock.settings.dashboardSettings.tiles[1].chartType).toBe(ChartTypes.Line);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
  });

  it('should persist curated recovery tile dismissal when deleting it', async () => {
    userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile = false;
    userMock.settings.dashboardSettings.autoTiles = {};
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
        dataType: 'Recovery Time',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        size: { columns: 1, rows: 1 },
        type: 'Chart',
      },
      { order: 1, chartType: ChartTypes.Line, size: { columns: 1, rows: 1 }, type: 'Chart' },
    ];
    component.chartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE as any;
    component.order = 0;
    fixture.detectChanges();

    await component.deleteTile({} as any);

    expect(userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(true);
    expect(userMock.settings.dashboardSettings.autoTiles.curatedRecoveryNow).toMatchObject({
      state: 'dismissed',
      source: 'default-curated',
    });
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('should persist recovery dismissal when deleting a legacy recovery metric tile', async () => {
    userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile = false;
    userMock.settings.dashboardSettings.autoTiles = {};
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: ChartTypes.LinesVertical,
        dataType: DataRecoveryTime.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        size: { columns: 1, rows: 1 },
        type: 'Chart',
      },
      { order: 1, chartType: ChartTypes.Line, size: { columns: 1, rows: 1 }, type: 'Chart' },
    ];
    component.chartType = ChartTypes.LinesVertical as any;
    component.order = 0;
    fixture.detectChanges();

    await component.deleteTile({} as any);

    expect(userMock.settings.dashboardSettings.dismissedCuratedRecoveryNowTile).toBe(true);
    expect(userMock.settings.dashboardSettings.autoTiles.curatedRecoveryNow).toMatchObject({
      state: 'dismissed',
      source: 'default-curated',
    });
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
  });

  it('should persist sleep auto-tile dismissal when deleting Sleep Trend', async () => {
    userMock.settings.dashboardSettings.autoTiles = {};
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
        dataType: 'SleepDuration',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        size: { columns: 1, rows: 1 },
        type: 'Chart',
      },
      { order: 1, chartType: ChartTypes.Line, size: { columns: 1, rows: 1 }, type: 'Chart' },
    ];
    component.chartType = DASHBOARD_SLEEP_TREND_CHART_TYPE as any;
    component.order = 0;
    fixture.detectChanges();

    await component.deleteTile({} as any);

    expect(userMock.settings.dashboardSettings.autoTiles.sleepTrend).toMatchObject({
      state: 'dismissed',
      source: 'sleep-sync',
    });
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('should restore auto-tile state and tiles when deleting Sleep Trend fails to persist', async () => {
    const previousAutoTileState = {
      state: 'added',
      addedAt: 1_777_000_000_000,
      source: 'sleep-sync',
    };
    userMock.settings.dashboardSettings.autoTiles = {
      sleepTrend: previousAutoTileState,
    };
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
        dataType: 'SleepDuration',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        size: { columns: 1, rows: 1 },
        type: 'Chart',
      },
      { order: 1, chartType: ChartTypes.Line, size: { columns: 1, rows: 1 }, type: 'Chart' },
    ];
    userMock.updateUserProperties.mockRejectedValueOnce(new Error('network down'));
    component.chartType = DASHBOARD_SLEEP_TREND_CHART_TYPE as any;
    component.order = 0;
    fixture.detectChanges();

    await expect(component.deleteTile({} as any)).rejects.toThrow('network down');

    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(2);
    expect(userMock.settings.dashboardSettings.tiles[0].chartType).toBe(DASHBOARD_SLEEP_TREND_CHART_TYPE);
    expect(userMock.settings.dashboardSettings.autoTiles.sleepTrend).toEqual(previousAutoTileState);
  });

  it('should not mark Sleep Trend dismissed when deleting the only tile is rejected', async () => {
    userMock.settings.dashboardSettings.autoTiles = {};
    userMock.settings.dashboardSettings.tiles = [{
      order: 0,
      chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
      dataType: 'SleepDuration',
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      size: { columns: 1, rows: 1 },
      type: 'Chart',
    }];
    component.chartType = DASHBOARD_SLEEP_TREND_CHART_TYPE as any;
    component.order = 0;
    fixture.detectChanges();

    await expect(component.deleteTile({} as any)).rejects.toThrow('Cannot delete tile there is only one left');

    expect(userMock.settings.dashboardSettings.autoTiles).toEqual({});
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
  });

  it('should persist KPI auto-tile dismissal when deleting a default KPI tile', async () => {
    userMock.settings.dashboardSettings.autoTiles = {};
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
        dataType: 'Training Stress Score',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        size: { columns: 1, rows: 1 },
        type: 'Chart',
      },
      { order: 1, chartType: ChartTypes.Line, size: { columns: 1, rows: 1 }, type: 'Chart' },
    ];
    component.chartType = DASHBOARD_ACWR_KPI_CHART_TYPE as any;
    component.order = 0;
    fixture.detectChanges();

    await component.deleteTile({} as any);

    expect(userMock.settings.dashboardSettings.autoTiles.kpiAcwr).toMatchObject({
      state: 'dismissed',
      source: 'default-kpi',
    });
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
  });

  it('should persist curated auto-tile dismissal when deleting a default curated tile', async () => {
    userMock.settings.dashboardSettings.autoTiles = {};
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
        dataType: 'Training Stress Score',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        size: { columns: 1, rows: 1 },
        type: 'Chart',
      },
      { order: 1, chartType: ChartTypes.Line, size: { columns: 1, rows: 1 }, type: 'Chart' },
    ];
    component.chartType = DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE as any;
    component.order = 0;
    fixture.detectChanges();

    await component.deleteTile({} as any);

    expect(userMock.settings.dashboardSettings.autoTiles.curatedIntensityDistribution).toMatchObject({
      state: 'dismissed',
      source: 'default-curated',
    });
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
  });
});
