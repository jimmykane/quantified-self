import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAscent,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { LoggerService } from '../../services/logger.service';
import { AppUserService } from '../../services/app.user.service';
import { DashboardDerivedMetricsService } from '../../services/dashboard-derived-metrics.service';
import * as dashboardTileViewModelHelper from '../../helpers/dashboard-tile-view-model.helper';
import { SummariesComponent } from './summaries.component';

describe('SummariesComponent', () => {
  let component: SummariesComponent;
  let fixture: ComponentFixture<SummariesComponent>;
  let mockThemeService: { getAppTheme: ReturnType<typeof vi.fn> };
  let mockUserService: { updateUserProperties: ReturnType<typeof vi.fn> };
  let mockDashboardDerivedMetricsService: {
    watch: ReturnType<typeof vi.fn>;
    ensureForDashboard: ReturnType<typeof vi.fn>;
  };
  let mockLogger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> };
  let mockDialog: { open: ReturnType<typeof vi.fn> };
  let buildDashboardTileViewModelsSpy: ReturnType<typeof vi.spyOn>;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockThemeService = {
      getAppTheme: vi.fn().mockReturnValue(of('light')),
    };
    mockUserService = {
      updateUserProperties: vi.fn().mockResolvedValue(true),
    };
    mockDashboardDerivedMetricsService = {
      watch: vi.fn().mockReturnValue(of({
        formPoints: null,
        recoveryNow: null,
        formStatus: 'missing',
        recoveryNowStatus: 'missing',
      })),
      ensureForDashboard: vi.fn(),
    };
    mockLogger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
    mockDialog = {
      open: vi.fn().mockReturnValue({
        afterClosed: () => of({ saved: false }),
      }),
    };
    buildDashboardTileViewModelsSpy = vi.spyOn(dashboardTileViewModelHelper, 'buildDashboardTileViewModels');
    originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    await TestBed.configureTestingModule({
      declarations: [SummariesComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: AppThemeService, useValue: mockThemeService },
        { provide: AppUserService, useValue: mockUserService },
        { provide: DashboardDerivedMetricsService, useValue: mockDashboardDerivedMetricsService },
        { provide: LoggerService, useValue: mockLogger },
        { provide: MatDialog, useValue: mockDialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SummariesComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should delegate tile building with dashboard tiles, events, preferences, and logger on input changes', async () => {
    const builtTiles = [{
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.ColumnsVertical,
      dataCategoryType: ChartDataCategoryTypes.ActivityType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }] as any[];
    buildDashboardTileViewModelsSpy.mockReturnValue(builtTiles as any);

    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.ColumnsVertical,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            size: { columns: 1, rows: 1 },
          }],
        },
        summariesSettings: {
          removeAscentForEventTypes: [ActivityTypes.Running],
          removeDescentForEventTypes: [ActivityTypes.Cycling],
        },
      },
    } as any;
    component.events = [{ id: 'event-1' }] as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      events: {
        currentValue: component.events,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledWith({
      tiles: component.user.settings.dashboardSettings.tiles,
      events: component.events,
      dashboardDateRange: {
        dateRange: null,
        startDate: null,
        endDate: null,
      },
      preferences: {
        removeAscentForEventTypes: [ActivityTypes.Running],
        removeDescentForEventTypes: [ActivityTypes.Cycling],
      },
      logger: mockLogger,
      derivedMetrics: {
        formPoints: null,
        recoveryNow: null,
      },
    });
    expect(component.tiles).toBe(builtTiles);
  });

  it('should pass dashboard date-range input values to tile view-model building', async () => {
    const builtTiles = [{
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.ColumnsVertical,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }] as any[];
    buildDashboardTileViewModelsSpy.mockReturnValue(builtTiles as any);

    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.ColumnsVertical,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
          }],
        },
      },
    } as any;
    component.events = [{ id: 'event-1' }] as any;
    component.dashboardDateRange = 2 as any;
    component.dashboardStartDate = new Date('2026-03-01T00:00:00.000Z');
    component.dashboardEndDate = new Date('2026-03-31T23:59:59.999Z');

    await component.ngOnChanges({
      dashboardDateRange: {
        currentValue: component.dashboardDateRange,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      dashboardStartDate: {
        currentValue: component.dashboardStartDate,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      dashboardEndDate: {
        currentValue: component.dashboardEndDate,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledWith(expect.objectContaining({
      dashboardDateRange: expect.objectContaining({
        dateRange: component.dashboardDateRange,
        startDate: component.dashboardStartDate,
        endDate: component.dashboardEndDate,
      }),
    }));
  });

  it('should rebuild tiles when dashboard settings mutate in place', async () => {
    const initialTiles = [{
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.IntensityZones,
      data: [],
      timeInterval: TimeIntervals.Auto,
      size: { columns: 1, rows: 1 },
    }] as any[];
    const updatedTiles = [{
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.ColumnsVertical,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }] as any[];

    buildDashboardTileViewModelsSpy
      .mockReturnValueOnce(initialTiles as any)
      .mockReturnValueOnce(updatedTiles as any);

    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.IntensityZones,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            size: { columns: 1, rows: 1 },
          }],
        },
      },
    } as any;
    component.events = [];

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      events: {
        currentValue: component.events,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    component.user.settings.dashboardSettings.tiles[0].chartType = ChartTypes.ColumnsVertical;
    component.ngDoCheck();
    await Promise.resolve();

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledTimes(2);
    expect((component.tiles[0] as any).chartType).toBe(ChartTypes.ColumnsVertical);
  });

  it('should not rebuild tiles during ngDoCheck when the tile snapshot is unchanged', async () => {
    const builtTiles = [{
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.ColumnsVertical,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }] as any[];
    buildDashboardTileViewModelsSpy.mockReturnValue(builtTiles as any);

    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.ColumnsVertical,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            size: { columns: 1, rows: 1 },
          }],
        },
      },
    } as any;
    component.events = [];

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      events: {
        currentValue: component.events,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    component.ngDoCheck();

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledTimes(1);
  });

  it('should show a warning banner and force retry when derived metrics fail for a form tile', () => {
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: 'Form',
            dataType: 'Training Stress Score',
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
          }],
        },
      },
    } as any;
    (component as any).derivedFormStatus = 'failed';
    (component as any).derivedRecoveryNowStatus = 'ready';
    (component as any).refreshDerivedMetricsBannerState();

    expect(component.derivedMetricsBanner?.type).toBe('warning');
    expect(component.derivedMetricsBanner?.showRetry).toBe(true);

    component.retryDerivedMetricsRebuild();

    expect(mockDashboardDerivedMetricsService.ensureForDashboard).toHaveBeenLastCalledWith(
      component.user,
      expect.objectContaining({
        formStatus: 'failed',
        recoveryNowStatus: 'ready',
      }),
      { force: true },
    );
  });

  it('should show a pending banner while derived metrics are stale', () => {
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: 'Form',
            dataType: 'Training Stress Score',
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
          }],
        },
      },
    } as any;
    (component as any).derivedFormStatus = 'stale';
    (component as any).derivedRecoveryNowStatus = 'ready';
    (component as any).refreshDerivedMetricsBannerState();

    expect(component.derivedMetricsBanner?.type).toBe('pending');
    expect(component.derivedMetricsBanner?.title).toContain('Refreshing');
    expect(component.derivedMetricsBanner?.showRetry).toBe(false);
  });

  it('should remove tiles that are no longer returned by the tile builder', async () => {
    const initialTiles = [{
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.ColumnsVertical,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }, {
      type: TileTypes.Chart,
      order: 1,
      chartType: ChartTypes.ColumnsHorizontal,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    }] as any[];
    const updatedTiles = [initialTiles[0]];

    buildDashboardTileViewModelsSpy
      .mockReturnValueOnce(initialTiles as any)
      .mockReturnValueOnce(updatedTiles as any);

    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [
            {
              type: TileTypes.Chart,
              order: 0,
              chartType: ChartTypes.ColumnsVertical,
              dataType: DataAscent.type,
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.ActivityType,
              size: { columns: 1, rows: 1 },
            },
            {
              type: TileTypes.Chart,
              order: 1,
              chartType: ChartTypes.ColumnsHorizontal,
              dataType: DataAscent.type,
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.ActivityType,
              size: { columns: 1, rows: 1 },
            },
          ],
        },
      },
    } as any;
    component.events = [];

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      events: {
        currentValue: component.events,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    component.user.settings.dashboardSettings.tiles.pop();
    component.ngDoCheck();
    await Promise.resolve();

    expect(component.tiles).toHaveLength(1);
    expect((component.tiles[0] as any).order).toBe(0);
  });

  it('should build stable trackBy keys for chart and map tiles', () => {
    const chartKey = component.trackByTile(0, {
      type: TileTypes.Chart,
      order: 2,
      name: 'Distance',
      chartType: ChartTypes.ColumnsVertical,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      timeInterval: TimeIntervals.Monthly,
      data: [],
      size: { columns: 1, rows: 1 },
    } as any);
    const mapKey = component.trackByTile(1, {
      type: TileTypes.Map,
      order: 3,
      name: 'Map',
      clusterMarkers: true,
      mapTheme: 'normal',
      mapStyle: 'streets',
      showHeatMap: false,
      events: [],
      size: { columns: 2, rows: 1 },
    } as any);

    expect(chartKey).toBe(`${ChartTypes.ColumnsVertical}${ChartDataCategoryTypes.DateType}${ChartDataValueTypes.Total}Distance2${TimeIntervals.Monthly}`);
    expect(mapKey).toBe('truenormalstreetsMap3false');
  });

  it('should enable desktop drag only when width, fine pointer, and hover are all available', () => {
    const mediaMatches = {
      '(min-width: 960px)': true,
      '(pointer: fine)': true,
      '(hover: hover)': true,
    };
    (window.matchMedia as any).mockImplementation((query: string) => ({
      matches: !!mediaMatches[query],
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    component.showActions = true;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 } },
      { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 } },
    ] as any;

    (component as any).updateDesktopTileDragCapability();
    expect(component.desktopTileDragEnabled).toBe(true);

    mediaMatches['(hover: hover)'] = false;
    (component as any).updateDesktopTileDragCapability();
    expect(component.desktopTileDragEnabled).toBe(false);
  });

  it('should open chart manager dialog and rebuild tiles when dialog saves changes', async () => {
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.ColumnsVertical,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            size: { columns: 1, rows: 1 },
          }],
        },
      },
    } as any;
    component.events = [];
    component.showActions = true;
    mockDialog.open.mockReturnValue({
      afterClosed: () => of({ saved: true }),
    });
    const rebuildSpy = vi.spyOn(component as any, 'rebuildTilesFromCurrentState').mockResolvedValue(undefined);

    await component.openChartManagerDialog();

    expect(mockDialog.open).toHaveBeenCalledTimes(1);
    expect(rebuildSpy).toHaveBeenCalledTimes(1);
    expect(component.isChartManagerOpen).toBe(false);
  });

  it('should ignore chart manager open requests when actions are hidden', async () => {
    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.showActions = false;

    await component.openChartManagerDialog();

    expect(mockDialog.open).not.toHaveBeenCalled();
  });

  it('should reorder and persist dashboard tiles on valid drop', async () => {
    component.showActions = true;
    component.desktopTileDragEnabled = true;
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          tiles: [
            { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical },
            { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 }, clusterMarkers: true, mapStyle: 'default' },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical } as any,
      { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 }, clusterMarkers: true, mapStyle: 'default' } as any,
    ];

    component.onTilesSort({ previousIndex: 0, currentIndex: 1 } as any);
    await component.onTilesDrop({ previousIndex: 0, currentIndex: 1 } as any);

    expect(component.user.settings.dashboardSettings.tiles[0].type).toBe(TileTypes.Map);
    expect(component.user.settings.dashboardSettings.tiles[1].type).toBe(TileTypes.Chart);
    expect(component.user.settings.dashboardSettings.tiles[0].order).toBe(0);
    expect(component.user.settings.dashboardSettings.tiles[1].order).toBe(1);
    expect(component.tiles[0].type).toBe(TileTypes.Map);
    expect(component.tiles[1].type).toBe(TileTypes.Chart);
    expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, { settings: component.user.settings });
  });

  it('should not persist when dropped at the same index', async () => {
    component.showActions = true;
    component.desktopTileDragEnabled = true;
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [
            { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical },
            { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 }, clusterMarkers: true, mapStyle: 'default' },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical } as any,
      { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 }, clusterMarkers: true, mapStyle: 'default' } as any,
    ];

    await component.onTilesDrop({ previousIndex: 1, currentIndex: 1 } as any);

    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(component.user.settings.dashboardSettings.tiles[0].type).toBe(TileTypes.Chart);
    expect(component.user.settings.dashboardSettings.tiles[1].type).toBe(TileTypes.Map);
  });

  it('should not reorder or persist when desktop drag is disabled', async () => {
    component.showActions = true;
    component.desktopTileDragEnabled = false;
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [
            { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical },
            { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 }, clusterMarkers: true, mapStyle: 'default' },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical } as any,
      { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 }, clusterMarkers: true, mapStyle: 'default' } as any,
    ];

    await component.onTilesDrop({ previousIndex: 0, currentIndex: 1 } as any);

    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(component.user.settings.dashboardSettings.tiles[0].type).toBe(TileTypes.Chart);
    expect(component.user.settings.dashboardSettings.tiles[1].type).toBe(TileTypes.Map);
  });

  it('should rollback tile order when persistence fails', async () => {
    component.showActions = true;
    component.desktopTileDragEnabled = true;
    mockUserService.updateUserProperties.mockRejectedValueOnce(new Error('persist failed'));
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [
            { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical },
            { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 }, clusterMarkers: true, mapStyle: 'default' },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical } as any,
      { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 }, clusterMarkers: true, mapStyle: 'default' } as any,
    ];

    component.onTilesSort({ previousIndex: 0, currentIndex: 1 } as any);
    await component.onTilesDrop({ previousIndex: 0, currentIndex: 1 } as any);

    expect(component.user.settings.dashboardSettings.tiles[0].type).toBe(TileTypes.Chart);
    expect(component.user.settings.dashboardSettings.tiles[1].type).toBe(TileTypes.Map);
    expect(component.tiles[0].type).toBe(TileTypes.Chart);
    expect(component.tiles[1].type).toBe(TileTypes.Map);
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[SummariesComponent] Failed to persist dashboard tile drag order update',
      expect.any(Error)
    );
  });

  it('should unsubscribe from the theme subscription on destroy', () => {
    const unsubscribe = vi.fn();
    (component as any).appThemeSubscription = { unsubscribe };

    component.ngOnDestroy();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
