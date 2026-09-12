import { DashboardConfigurationService } from '../../../../services/dashboard-configuration.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TileChartActionsComponent } from './tile.chart.actions.component';
import { AppUserService } from '../../../../services/app.user.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { AppHapticsService } from '../../../../services/app.haptics.service';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';
import { ChartTypes, ChartDataValueTypes, ChartDataCategoryTypes, DataRecoveryTime, TileTypes } from '@sports-alliance/sports-lib';
import { vi } from 'vitest';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
} from '../../../../helpers/dashboard-special-chart-types';
import { DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_SOURCE } from '../../../../helpers/dashboard-auto-tile.helper';

describe('TileChartActionsComponent', () => {
  let component: TileChartActionsComponent;
  let fixture: ComponentFixture<TileChartActionsComponent>;
  let userMock: any;
  let analyticsMock: any;
  let hapticsMock: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    userMock = {
      uid: 'owner',
      settings: {
        appSettings: { theme: 'dark' },
        unitSettings: { startOfTheWeek: 1 },
        dashboardSettings: {
          dismissedCuratedRecoveryNowTile: false,
          tiles: [
            {
              order: 0,
              chartType: ChartTypes.ColumnsVertical,
              dataType: 'Distance',
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.ActivityType,
              size: { columns: 1, rows: 1 },
              type: 'Chart',
            },
            {
              order: 1,
              chartType: ChartTypes.LinesVertical,
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
      selection: vi.fn(), success: vi.fn(), error: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [TileChartActionsComponent],
      imports: [
        MatMenuModule,
        MatIconModule,
        MatProgressSpinnerModule,
        BrowserAnimationsModule,
        FormsModule,
      ],
      providers: [
        { provide: DashboardConfigurationService, useValue: { save: (_uid, _expected, patch) => userMock.updateUserProperties(userMock, { settings: { dashboardSettings: patch } }) } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: AppUserService, useValue: userMock },
        { provide: AppAnalyticsService, useValue: analyticsMock },
        { provide: AppHapticsService, useValue: hapticsMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TileChartActionsComponent);
    component = fixture.componentInstance;
    component.user = userMock;
    component.order = 0;
    component.chartType = ChartTypes.ColumnsVertical;
    component.size = { columns: 1, rows: 1 };
    component.type = 'Chart' as any;
    fixture.detectChanges();
  });

  it.each([
    [ChartTypes.LinesVertical, 'Chart', 'chart'],
    [DASHBOARD_ACWR_KPI_CHART_TYPE, 'KPI', 'KPI'],
    [DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE, 'Calendar', 'calendar'],
  ])('renders type-specific actions for %s and updates when inputs change', async (chartType, label, noun) => {
    expect(hapticsMock.selection).not.toHaveBeenCalled();
    fixture.componentRef.setInput('chartType', chartType); fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('.tile-actions-trigger') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-label')).toBe(`${label} actions`);
    trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    const menu = document.body.querySelector('[role="menu"]')!;
    const editLabel = chartType === ChartTypes.LinesVertical ? `Edit ${noun}` : `${label} details`;
    expect(menu.textContent).toContain(editLabel);
    expect(menu.textContent).toContain(`Remove ${noun}`);
    hapticsMock.selection.mockClear();
    const emitted = vi.spyOn(component.editTile, 'emit');
    const edit = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes(editLabel))!;
    edit.click(); fixture.detectChanges();
    expect(emitted).toHaveBeenCalledWith(0);
    expect(hapticsMock.selection).toHaveBeenCalledOnce();
  });
  it.each([
    [ChartTypes.LinesVertical, 'chart'],
    [DASHBOARD_ACWR_KPI_CHART_TYPE, 'KPI'],
    [DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE, 'calendar'],
  ])('includes Remove %s in keyboard navigation and persists it once', async (chartType, noun) => {
    fixture.componentRef.setInput('chartType', chartType); fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('.tile-actions-trigger') as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
    hapticsMock.selection.mockClear();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', keyCode: 35, bubbles: true }));
    const remove = document.activeElement as HTMLButtonElement;
    expect(remove.textContent).toContain(`Remove ${noun}`);
    expect(hapticsMock.selection).not.toHaveBeenCalled();
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
    remove.click(); fixture.detectChanges(); await fixture.whenStable();
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).toHaveBeenCalledOnce();
    expect(hapticsMock.selection).toHaveBeenCalledOnce();
    expect(hapticsMock.success).toHaveBeenCalledOnce();
    expect(hapticsMock.error).not.toHaveBeenCalled();
  });
  it.each([
    ['columns', 'Columns: 1', '2 columns'],
    ['rows', 'Rows: 1', '2 rows'],
  ])('opens %s with arrow keys and saves the selected size once', async (dimension, label, choice) => {
    const trigger = fixture.nativeElement.querySelector('.tile-actions-trigger') as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', keyCode: 36, bubbles: true }));
    if (dimension === 'rows') menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
    expect(document.activeElement?.textContent).toContain(label);
    hapticsMock.selection.mockClear();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
    fixture.detectChanges(); await fixture.whenStable();
    const choices = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    expect(choices).toHaveLength(4);
    expect(choices[0].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(choices[0]);
    expect(userMock.updateUserProperties).not.toHaveBeenCalled();
    expect(hapticsMock.selection).toHaveBeenCalledOnce();
    hapticsMock.selection.mockClear();
    choices.find(button => button.textContent?.includes(choice))!.click();
    fixture.detectChanges(); await fixture.whenStable();
    expect(userMock.settings.dashboardSettings.tiles[0].size[dimension]).toBe(2);
    expect(userMock.updateUserProperties).toHaveBeenCalledOnce();
    expect(hapticsMock.selection).toHaveBeenCalledOnce();
    expect(hapticsMock.success).toHaveBeenCalledOnce();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should use form menu panel classes', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/tile-actions-menu.html');
    const template = readFileSync(templatePath, 'utf8');
    expect(template).toMatch(/<mat-menu[^>]*class="[^"]*qs-menu-panel[^"]*qs-menu-panel-form[^"]*qs-config-menu[^"]*"/);
  });

  it('should remove chart data configuration controls and add-new action from the tile menu', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/tile/actions/tile-actions-menu.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).not.toContain('app-tile-actions-header');
    expect(template).not.toContain('<mat-label>Type</mat-label>');
    expect(template).not.toContain('Chart type');
    expect(template).not.toContain('What data to look at');
    expect(template).not.toContain('How to look at the data');
    expect(template).not.toContain('Time interval');
    expect(template).toContain('Edit');
  });

  it('should emit editTile with current tile order', () => {
    const emittedOrders: number[] = [];
    component.editTile.subscribe((order) => emittedOrders.push(order));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    const trigger = { restoreFocus: true, closeMenu: vi.fn() };
    (component as any).menuTrigger = trigger;
    component.order = 1;
    component.openEditTile({ preventDefault, stopPropagation } as any);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(emittedOrders).toEqual([1]);
    expect(trigger.closeMenu).toHaveBeenCalledOnce();
    expect(trigger.restoreFocus).toBe(false);
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'])('shows progress until a layout save finishes with %s', async outcome => {
    let resolveSave!: () => void;
    let rejectSave!: (error: Error) => void;
    userMock.updateUserProperties.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      resolveSave = resolve;
      rejectSave = reject;
    }));
    const save = component.changeTileColumnSize({ value: 2 }).catch(error => error);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('.tile-actions-trigger') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect(trigger.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Saving dashboard changes');
    expect(hapticsMock.success).not.toHaveBeenCalled();
    expect(hapticsMock.error).not.toHaveBeenCalled();
    await component.changeTileRowSize({ value: 3 });
    expect(userMock.updateUserProperties).toHaveBeenCalledOnce();
    if (outcome === 'success') resolveSave();
    else rejectSave(new Error('Save failed'));
    await save;
    fixture.detectChanges();
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-busy')).toBe('false');
    expect(trigger.querySelector('[role="progressbar"]')).toBeNull();
    expect(hapticsMock.selection).toHaveBeenCalledOnce();
    expect(hapticsMock.success).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
    expect(hapticsMock.error).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
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

  it('omits layout choices for compact tiles and ignores resizing', async () => {
    component.showLayoutControls = false; fixture.detectChanges();
    fixture.nativeElement.querySelector('.tile-actions-trigger').click();
    fixture.detectChanges(); await fixture.whenStable();
    const menu = document.body.querySelector('[role="menu"]')!;
    expect(menu.textContent).not.toContain('Columns:');
    expect(menu.textContent).not.toContain('Rows:');
    expect(menu.textContent).toContain('Move earlier');
    hapticsMock.selection.mockClear();
    await component.changeTileColumnSize({ value: 3 });
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
    expect(userMock.settings.dashboardSettings.tiles[0].chartType).toBe(ChartTypes.LinesVertical);
    expect(userMock.settings.dashboardSettings.tiles[1].chartType).toBe(ChartTypes.ColumnsVertical);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
  });

  it('should not move a chart tile into another inferred dashboard section', async () => {
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: ChartTypes.ColumnsVertical,
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
        chartType: ChartTypes.ColumnsVertical,
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
    expect(userMock.settings.dashboardSettings.tiles[0].chartType).toBe(ChartTypes.ColumnsVertical);
    expect(userMock.settings.dashboardSettings.tiles[1].chartType).toBe(ChartTypes.LinesVertical);
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
      { order: 1, chartType: ChartTypes.LinesVertical, size: { columns: 1, rows: 1 }, type: 'Chart' },
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
        chartType: ChartTypes.LinesVerticalsVertical,
        dataType: DataRecoveryTime.type,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        size: { columns: 1, rows: 1 },
        type: 'Chart',
      },
      { order: 1, chartType: ChartTypes.LinesVertical, size: { columns: 1, rows: 1 }, type: 'Chart' },
    ];
    component.chartType = ChartTypes.LinesVerticalsVertical as any;
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
      { order: 1, chartType: ChartTypes.LinesVertical, size: { columns: 1, rows: 1 }, type: 'Chart' },
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

  it('should persist Activity Calendar auto-tile dismissal when deleting it', async () => {
    userMock.settings.dashboardSettings.autoTiles = {};
    userMock.settings.dashboardSettings.tiles = [
      {
        order: 0,
        chartType: DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
        dataType: 'Duration',
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        size: { columns: 2, rows: 2 },
        type: TileTypes.Chart,
      },
      { order: 1, chartType: ChartTypes.LinesVertical, size: { columns: 1, rows: 1 }, type: TileTypes.Chart },
    ];
    component.chartType = DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE as any;
    component.order = 0;
    fixture.detectChanges();

    await component.deleteTile({} as any);

    expect(userMock.settings.dashboardSettings.autoTiles.activityCalendar).toMatchObject({
      state: 'dismissed',
      source: DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_SOURCE,
    });
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(1);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
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
      { order: 1, chartType: ChartTypes.LinesVertical, size: { columns: 1, rows: 1 }, type: 'Chart' },
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

  it('allows removing the last Sleep tile and keeps it dismissed', async () => {
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

    await component.deleteTile({} as any);
    expect(userMock.settings.dashboardSettings.autoTiles.sleepTrend.state).toBe('dismissed');
    expect(userMock.settings.dashboardSettings.tiles).toHaveLength(0);
    expect(userMock.updateUserProperties).toHaveBeenCalled();
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
      { order: 1, chartType: ChartTypes.LinesVertical, size: { columns: 1, rows: 1 }, type: 'Chart' },
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
      { order: 1, chartType: ChartTypes.LinesVertical, size: { columns: 1, rows: 1 }, type: 'Chart' },
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
