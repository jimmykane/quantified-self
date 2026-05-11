import { LOCALE_ID, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { of, Subject, Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAscent,
  AppThemes,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { LoggerService } from '../../services/logger.service';
import { AppUserService } from '../../services/app.user.service';
import { DashboardDerivedMetricsService } from '../../services/dashboard-derived-metrics.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppEventService } from '../../services/app.event.service';
import { DashboardAutoTileService } from '../../services/dashboard-auto-tile.service';
import * as dashboardTileViewModelHelper from '../../helpers/dashboard-tile-view-model.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
} from '../../helpers/dashboard-special-chart-types';
import { SummariesComponent } from './summaries.component';
import { DashboardTileBoardComponent } from './dashboard-tile-board/dashboard-tile-board.component';
import { DashboardTileCellComponent } from './dashboard-tile-cell/dashboard-tile-cell.component';

describe('SummariesComponent', () => {
  let component: SummariesComponent;
  let fixture: ComponentFixture<SummariesComponent>;
  let mockThemeService: { getAppTheme: ReturnType<typeof vi.fn> };
  let mockUserService: { updateUserProperties: ReturnType<typeof vi.fn> };
  let mockDashboardDerivedMetricsService: {
    watch: ReturnType<typeof vi.fn>;
    ensureForDashboard: ReturnType<typeof vi.fn>;
  };
  let mockSleepService: { watchForDashboard: ReturnType<typeof vi.fn> };
  let mockEventService: { getEventsBy: ReturnType<typeof vi.fn> };
  let mockDashboardAutoTileService: { watchForDashboard: ReturnType<typeof vi.fn> };
  let mockLogger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> };
  let mockDialog: { open: ReturnType<typeof vi.fn> };
  let buildDashboardTileViewModelsSpy: ReturnType<typeof vi.spyOn>;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  const expectDashboardSettingsWrite = (user: any, dashboardSettingsPatch: Record<string, unknown>): void => {
    expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(user, {
      settings: {
        dashboardSettings: dashboardSettingsPatch,
      },
    });
    const settingsPayload = mockUserService.updateUserProperties.mock.calls.at(-1)?.[1]?.settings;
    expect(settingsPayload.appSettings).toBeUndefined();
    expect(settingsPayload.unitSettings).toBeUndefined();
  };

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
        acwr: null,
        rampRate: null,
        monotonyStrain: null,
        formNow: null,
        formPlus7d: null,
        easyPercent: null,
        hardPercent: null,
        efficiencyDelta4w: null,
        freshnessForecast: null,
        intensityDistribution: null,
        efficiencyTrend: null,
        formStatus: 'missing',
        recoveryNowStatus: 'missing',
        acwrStatus: 'missing',
        rampRateStatus: 'missing',
        monotonyStrainStatus: 'missing',
        formNowStatus: 'missing',
        formPlus7dStatus: 'missing',
        easyPercentStatus: 'missing',
        hardPercentStatus: 'missing',
        efficiencyDelta4wStatus: 'missing',
        freshnessForecastStatus: 'missing',
        intensityDistributionStatus: 'missing',
        efficiencyTrendStatus: 'missing',
      })),
      ensureForDashboard: vi.fn(),
    };
    mockSleepService = {
      watchForDashboard: vi.fn().mockReturnValue(of([])),
    };
    mockEventService = {
      getEventsBy: vi.fn().mockReturnValue(of([])),
    };
    mockDashboardAutoTileService = {
      watchForDashboard: vi.fn().mockImplementation(() => new Subscription()),
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
      declarations: [SummariesComponent, DashboardTileBoardComponent, DashboardTileCellComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: AppThemeService, useValue: mockThemeService },
        { provide: AppUserService, useValue: mockUserService },
        { provide: DashboardDerivedMetricsService, useValue: mockDashboardDerivedMetricsService },
        { provide: AppSleepService, useValue: mockSleepService },
        { provide: AppEventService, useValue: mockEventService },
        { provide: DashboardAutoTileService, useValue: mockDashboardAutoTileService },
        { provide: LoggerService, useValue: mockLogger },
        { provide: MatDialog, useValue: mockDialog },
        { provide: LOCALE_ID, useValue: 'en-US' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SummariesComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the Today dashboard header separately from KPI and main-grid tiles', () => {
    const kpiTile = {
      type: TileTypes.Chart,
      order: 0,
      chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    } as any;
    const mainGridTile = {
      type: TileTypes.Chart,
      order: 1,
      chartType: ChartTypes.ColumnsVertical,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    } as any;
    const mainMapTile = {
      type: TileTypes.Map,
      order: 2,
      events: [],
      mapStyle: 'default',
      clusterMarkers: true,
      size: { columns: 1, rows: 1 },
    } as any;

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.showActions = true;
    component.tiles = [kpiTile, mainGridTile, mainMapTile];
    component.kpiLaneTiles = [kpiTile];
    component.mainGridTiles = [mainGridTile, mainMapTile];

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const dashboardHeader = nativeElement.querySelector('.dashboard-summary-header');
    expect(dashboardHeader).not.toBeNull();
    expect(dashboardHeader?.querySelector('#dashboard-today-title')?.textContent?.trim()).toBe('Today');
    expect(dashboardHeader?.querySelector('.dashboard-section-subtitle')?.textContent?.trim()).toBe(component.todayDateSubtitle);
    expect(dashboardHeader?.querySelector('.dashboard-section-actions')).not.toBeNull();
    expect(dashboardHeader?.querySelector('.dashboard-manager-button-desktop span')?.textContent?.trim()).toBe('Dashboard manager');
    expect(dashboardHeader?.querySelector('.dashboard-manager-button-mobile')).not.toBeNull();
    expect(dashboardHeader?.querySelector('.dashboard-kpi-lane')).toBeNull();
    const kpiSection = nativeElement.querySelector('.dashboard-kpi-section');
    expect(kpiSection).not.toBeNull();
    expect(kpiSection?.classList.contains('dashboard-kpi-section--merged')).toBe(true);
    const kpiLane = kpiSection?.querySelector('.dashboard-kpi-lane') as HTMLElement | null;
    expect(kpiLane).not.toBeNull();
    expect(kpiLane?.classList.contains('qs-glass-card-panel')).toBe(true);
    expect(kpiLane?.classList.contains('dashboard-kpi-lane--merged-with-board')).toBe(true);
    expect(kpiSection?.querySelectorAll('.dashboard-kpi-tile')).toHaveLength(1);
    expect(kpiLane?.querySelector('app-tile-chart')?.classList.contains('qs-glass-card-panel')).toBe(false);
    expect(nativeElement.querySelectorAll('.dashboard-section-divider')).toHaveLength(0);
    const board = nativeElement.querySelector('app-dashboard-tile-board') as HTMLElement | null;
    expect(board).not.toBeNull();
    expect(board?.classList.contains('qs-glass-card-panel')).toBe(true);
    expect(board?.classList.contains('dashboard-tile-board--merged-after-kpis')).toBe(true);
    expect(board?.style.getPropertyValue('--dashboard-tile-board-cols')).toBe(`${component.numberOfCols}`);
    expect(nativeElement.querySelectorAll('app-dashboard-tile-cell.dashboard-grid-tile')).toHaveLength(2);
    const mainChart = board?.querySelector('app-tile-chart') as HTMLElement | null;
    expect(mainChart).not.toBeNull();
    expect(mainChart?.classList.contains('qs-glass-card-panel')).toBe(false);
    const mainMap = board?.querySelector('app-tile-map') as HTMLElement | null;
    expect(mainMap).not.toBeNull();
    expect(mainMap?.classList.contains('qs-glass-card-panel')).toBe(false);
  });

  it('squares loading shades inside the joined KPI lane surface', () => {
    const stylePath = resolve(process.cwd(), 'src/app/components/summaries/summaries.component.css');
    const styles = readFileSync(stylePath, 'utf8');

    expect(styles).toContain('.dashboard-kpi-lane {');
    expect(styles).toContain('--loading-shade-border-radius: 0;');
  });

  it('fills partial final chart-grid rows with non-draggable placeholder cells', () => {
    const mainGridTiles = [0, 1, 2].map(order => ({
      type: TileTypes.Chart,
      order,
      chartType: ChartTypes.ColumnsVertical,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    })) as any[];

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.numberOfCols = 2;
    component.tiles = mainGridTiles;
    component.kpiLaneTiles = [];
    component.mainGridTiles = mainGridTiles;
    (component as any).refreshMainGridTrailingPlaceholders();

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const board = nativeElement.querySelector('app-dashboard-tile-board') as HTMLElement | null;
    expect(board).not.toBeNull();
    expect(component.mainGridTrailingPlaceholders).toEqual([0]);
    expect(board?.querySelectorAll('app-dashboard-tile-cell.dashboard-grid-tile')).toHaveLength(4);
    const placeholder = board?.querySelector('app-dashboard-tile-cell.dashboard-grid-placeholder') as HTMLElement | null;
    expect(placeholder).not.toBeNull();
    expect(placeholder?.hasAttribute('cdkdrag')).toBe(false);
    expect(placeholder?.style.gridColumn).toBe('span 1');
    expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the dashboard header and manager action when there are no KPI tiles', () => {
    const mainGridTile = {
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.ColumnsVertical,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    } as any;

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.showActions = true;
    component.tiles = [mainGridTile];
    component.kpiLaneTiles = [];
    component.mainGridTiles = [mainGridTile];

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('.dashboard-kpi-section')).toBeNull();
    expect(nativeElement.querySelector('.dashboard-summary-header')).not.toBeNull();
    expect(nativeElement.querySelector('#dashboard-today-title')?.textContent?.trim()).toBe('Today');
    expect(nativeElement.querySelector('.dashboard-manager-button-desktop span')?.textContent?.trim()).toBe('Dashboard manager');
  });

  it('renders the dashboard header and manager action for an editable empty dashboard', () => {
    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.showActions = true;
    component.tiles = [];
    component.kpiLaneTiles = [];
    component.mainGridTiles = [];

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('.dashboard-kpi-section')).toBeNull();
    expect(nativeElement.querySelector('app-dashboard-tile-board')).toBeNull();
    expect(nativeElement.querySelector('.dashboard-summary-header')).not.toBeNull();
    expect(nativeElement.querySelector('#dashboard-today-title')?.textContent?.trim()).toBe('Today');
    expect(nativeElement.querySelector('.dashboard-manager-button-desktop span')?.textContent?.trim()).toBe('Dashboard manager');
  });

  it('does not render an empty read-only dashboard shell', () => {
    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.showActions = false;
    component.tiles = [];
    component.kpiLaneTiles = [];
    component.mainGridTiles = [];

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('.pie')).toBeNull();
    expect(nativeElement.querySelector('.dashboard-summary-header')).toBeNull();
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

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledWith({
      tiles: component.user.settings.dashboardSettings.tiles,
      events: [],
      tileEventsByOrder: {},
      preferences: {
        removeAscentForEventTypes: [ActivityTypes.Running],
        removeDescentForEventTypes: [ActivityTypes.Cycling],
      },
      sleepSessions: [],
      sleepTrendWindow: expect.objectContaining({
        range: '14d',
        startMs: expect.any(Number),
        endMs: expect.any(Number),
      }),
      logger: mockLogger,
      derivedMetrics: {
        formPoints: null,
        recoveryNow: null,
        acwr: null,
        rampRate: null,
        monotonyStrain: null,
        formNow: null,
        formPlus7d: null,
        easyPercent: null,
        hardPercent: null,
        efficiencyDelta4w: null,
        freshnessForecast: null,
        intensityDistribution: null,
        efficiencyTrend: null,
      },
    });
    expect(component.tiles).toBe(builtTiles);
  });

  it('subscribes to dashboard auto tiles for editable owner dashboards', async () => {
    const autoTileSubscription = new Subscription();
    const unsubscribeSpy = vi.spyOn(autoTileSubscription, 'unsubscribe');
    mockDashboardAutoTileService.watchForDashboard.mockReturnValueOnce(autoTileSubscription);
    component.user = {
      uid: 'owner-user',
      settings: { dashboardSettings: { tiles: [] } },
    } as any;
    component.showActions = true;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      showActions: {
        currentValue: true,
        previousValue: false,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(mockDashboardAutoTileService.watchForDashboard).toHaveBeenCalledWith(component.user);

    component.ngOnDestroy();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('resubscribes dashboard auto tiles when the owner user object refreshes with the same uid', async () => {
    const firstSubscription = new Subscription();
    const secondSubscription = new Subscription();
    const firstUnsubscribeSpy = vi.spyOn(firstSubscription, 'unsubscribe');
    mockDashboardAutoTileService.watchForDashboard
      .mockReturnValueOnce(firstSubscription)
      .mockReturnValueOnce(secondSubscription);
    const originalUser = {
      uid: 'owner-user',
      settings: { dashboardSettings: { tiles: [], testSettingsVersion: 'stale' } },
    } as any;
    const refreshedUser = {
      uid: 'owner-user',
      settings: { dashboardSettings: { tiles: [], testSettingsVersion: 'fresh' } },
    } as any;
    component.user = originalUser;
    component.showActions = true;

    await component.ngOnChanges({
      user: {
        currentValue: originalUser,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    component.user = refreshedUser;
    await component.ngOnChanges({
      user: {
        currentValue: refreshedUser,
        previousValue: originalUser,
        firstChange: false,
        isFirstChange: () => false,
      } as any,
    });

    expect(firstUnsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(mockDashboardAutoTileService.watchForDashboard).toHaveBeenCalledTimes(2);
    expect(mockDashboardAutoTileService.watchForDashboard).toHaveBeenNthCalledWith(1, originalUser);
    expect(mockDashboardAutoTileService.watchForDashboard).toHaveBeenNthCalledWith(2, refreshedUser);
  });

  it('does not subscribe to dashboard auto tiles for shared target dashboards', async () => {
    component.user = {
      uid: 'viewer-user',
      settings: { dashboardSettings: { tiles: [] } },
    } as any;
    component.eventUser = { uid: 'target-user' } as any;
    component.showActions = true;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      eventUser: {
        currentValue: component.eventUser,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(mockDashboardAutoTileService.watchForDashboard).not.toHaveBeenCalled();
  });

  it('unsubscribes dashboard auto tiles when dashboard actions become read-only', async () => {
    const autoTileSubscription = new Subscription();
    const unsubscribeSpy = vi.spyOn(autoTileSubscription, 'unsubscribe');
    mockDashboardAutoTileService.watchForDashboard.mockReturnValueOnce(autoTileSubscription);
    component.user = {
      uid: 'owner-user',
      settings: { dashboardSettings: { tiles: [] } },
    } as any;
    component.showActions = true;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    component.showActions = false;
    await component.ngOnChanges({
      showActions: {
        currentValue: false,
        previousValue: true,
        firstChange: false,
        isFirstChange: () => false,
      } as any,
    });

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('should keep table date-range state out of tile view-model building', async () => {
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

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledWith(expect.objectContaining({
      events: [],
      tileEventsByOrder: {},
    }));
    expect(buildDashboardTileViewModelsSpy.mock.calls[0][0]).not.toHaveProperty('dashboardDateRange');
  });

  it('should subscribe per custom and map tile using the event owner, not derived tiles', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'viewer-user',
      settings: {
        unitSettings: { startOfTheWeek: 1 },
        dashboardSettings: {
          tiles: [
            {
              type: TileTypes.Chart,
              order: 0,
              chartType: ChartTypes.ColumnsVertical,
              dataType: DataAscent.type,
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              size: { columns: 1, rows: 1 },
              eventFilters: { range: '90d', activityTypes: [] },
            },
            {
              type: TileTypes.Map,
              order: 1,
              mapStyle: 'default',
              clusterMarkers: true,
              size: { columns: 1, rows: 1 },
              eventFilters: { range: '30d', activityTypes: [ActivityTypes.Running] },
            },
            {
              type: TileTypes.Chart,
              order: 2,
              chartType: DASHBOARD_FORM_CHART_TYPE,
              dataType: 'Training Stress Score',
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              size: { columns: 1, rows: 1 },
            },
            {
              type: TileTypes.Chart,
              order: 3,
              chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
              dataType: 'Training Stress Score',
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              size: { columns: 1, rows: 1 },
            },
            {
              type: TileTypes.Chart,
              order: 4,
              chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE,
              dataType: 'Recovery Time',
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              size: { columns: 1, rows: 1 },
            },
            {
              type: TileTypes.Chart,
              order: 5,
              chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
              dataType: 'SleepDuration',
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              size: { columns: 1, rows: 1 },
            },
          ],
        },
      },
    } as any;
    component.eventUser = { uid: 'event-owner' } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
      eventUser: {
        currentValue: component.eventUser,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(mockEventService.getEventsBy).toHaveBeenCalledTimes(2);
    expect(mockEventService.getEventsBy.mock.calls.map(call => call[0].uid)).toEqual(['event-owner', 'event-owner']);
    expect(mockEventService.getEventsBy.mock.calls[0][1]).toEqual([
      { fieldPath: 'startDate', opStr: '>=', value: nowMs - (90 * 24 * 60 * 60 * 1000) },
      { fieldPath: 'startDate', opStr: '<=', value: nowMs },
    ]);
    expect(mockEventService.getEventsBy.mock.calls[1][1]).toEqual([
      { fieldPath: 'startDate', opStr: '>=', value: nowMs - (30 * 24 * 60 * 60 * 1000) },
      { fieldPath: 'startDate', opStr: '<=', value: nowMs },
    ]);
  });

  it('should maintain independent tile event loading states and pass per-tile events into the builder', async () => {
    const customEventsSubject = new Subject<any[]>();
    const mapEventsSubject = new Subject<any[]>();
    const customEvent = { id: 'custom-1', isMerge: false };
    const mergedEvent = { id: 'merged-1', isMerge: true };
    const mapEvent = { id: 'map-1', isMerge: false };
    mockEventService.getEventsBy
      .mockReturnValueOnce(customEventsSubject.asObservable())
      .mockReturnValueOnce(mapEventsSubject.asObservable());
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        unitSettings: { startOfTheWeek: 1 },
        dashboardSettings: {
          tiles: [
            {
              type: TileTypes.Chart,
              order: 0,
              chartType: ChartTypes.ColumnsVertical,
              dataType: DataAscent.type,
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              size: { columns: 1, rows: 1 },
              eventFilters: { range: '90d', activityTypes: [] },
            },
            {
              type: TileTypes.Map,
              order: 1,
              mapStyle: 'default',
              clusterMarkers: true,
              size: { columns: 1, rows: 1 },
              eventFilters: { range: '30d', activityTypes: [] },
            },
          ],
        },
      },
    } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(component.tileEventLoadingByOrder[0]).toBe(true);
    expect(component.tileEventLoadingByOrder[1]).toBe(true);

    customEventsSubject.next([customEvent, mergedEvent]);
    await Promise.resolve();

    expect(component.tileEventLoadingByOrder[0]).toBe(false);
    expect(component.tileEventLoadingByOrder[1]).toBe(true);
    expect(buildDashboardTileViewModelsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      tileEventsByOrder: {
        0: [customEvent],
      },
    }));

    mapEventsSubject.next([mapEvent]);
    await Promise.resolve();

    expect(component.tileEventLoadingByOrder[1]).toBe(false);
    expect(buildDashboardTileViewModelsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      tileEventsByOrder: {
        0: [customEvent],
        1: [mapEvent],
      },
    }));
  });

  it('should not drive derived tile loading from table loading state', () => {
    component.isLoading = true;
    (component as any).derivedMetricsHydrated = true;
    component.tileEventLoadingByOrder[0] = true;

    expect(component.isTileLoading({
      type: TileTypes.Chart,
      order: 0,
      chartType: ChartTypes.ColumnsVertical,
    } as any)).toBe(true);
    expect(component.isTileLoading({
      type: TileTypes.Chart,
      order: 1,
      chartType: DASHBOARD_FORM_CHART_TYPE,
    } as any)).toBe(false);
    expect(component.isTileLoading({
      type: TileTypes.Chart,
      order: 2,
      chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
    } as any)).toBe(false);
  });

  it('should show KPI loading until derived metrics hydrate', () => {
    const kpiTile = {
      type: TileTypes.Chart,
      order: 2,
      chartType: DASHBOARD_ACWR_KPI_CHART_TYPE,
    } as any;

    (component as any).derivedMetricsHydrated = false;
    expect(component.isTileLoading(kpiTile)).toBe(true);

    (component as any).derivedMetricsHydrated = true;
    expect(component.isTileLoading(kpiTile)).toBe(false);
  });

  it('should navigate duration tile event windows transiently without persisting filters', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        unitSettings: { startOfTheWeek: 1 },
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.ColumnsVertical,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
            eventFilters: { range: '14d', activityTypes: [] },
          }],
        },
      },
    } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });
    mockEventService.getEventsBy.mockClear();

    expect(component.canNavigateTileEventsNewer({ type: TileTypes.Chart, order: 0 } as any)).toBe(false);

    component.onTileEventFilterNavigate(0, 'older');

    expect(component.canNavigateTileEventsNewer({ type: TileTypes.Chart, order: 0 } as any)).toBe(true);
    expect(component.user.settings.dashboardSettings.tiles[0].eventFilters).toEqual({ range: '14d', activityTypes: [] });
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(mockEventService.getEventsBy).toHaveBeenLastCalledWith(
      component.user,
      [
        { fieldPath: 'startDate', opStr: '>=', value: nowMs - (2 * fourteenDaysMs) },
        { fieldPath: 'startDate', opStr: '<=', value: nowMs - fourteenDaysMs },
      ],
      'startDate',
      false,
      0,
    );

    mockEventService.getEventsBy.mockClear();
    component.onTileEventFilterNavigate(0, 'newer');

    expect(component.canNavigateTileEventsNewer({ type: TileTypes.Chart, order: 0 } as any)).toBe(false);
    expect(component.user.settings.dashboardSettings.tiles[0].eventFilters).toEqual({ range: '14d', activityTypes: [] });
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(mockEventService.getEventsBy).toHaveBeenLastCalledWith(
      component.user,
      [
        { fieldPath: 'startDate', opStr: '>=', value: nowMs - fourteenDaysMs },
        { fieldPath: 'startDate', opStr: '<=', value: nowMs },
      ],
      'startDate',
      false,
      0,
    );
  });

  it('should keep latest duration tile event listeners stable across repeated syncs', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        unitSettings: { startOfTheWeek: 1 },
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.ColumnsVertical,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
            eventFilters: { range: '90d', activityTypes: [] },
          }],
        },
      },
    } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });
    expect(mockEventService.getEventsBy).toHaveBeenCalledTimes(1);

    mockEventService.getEventsBy.mockClear();
    vi.setSystemTime(new Date(nowMs + 1000));
    (component as any).syncTileEventSubscriptions();

    expect(component.canNavigateTileEventsNewer({ type: TileTypes.Chart, order: 0 } as any)).toBe(false);
    expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
  });

  it('should require confirmation before switching a tile event range to all', async () => {
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        unitSettings: { startOfTheWeek: 1 },
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: ChartTypes.ColumnsVertical,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
            eventFilters: { range: '90d', activityTypes: [] },
          }],
        },
      },
    } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });
    mockEventService.getEventsBy.mockClear();
    mockDialog.open.mockReturnValueOnce({ afterClosed: () => of(false) });

    await component.onTileEventFilterRangeChange(0, 'all');

    expect(mockDialog.open).toHaveBeenCalledTimes(1);
    expect(component.user.settings.dashboardSettings.tiles[0].eventFilters.range).toBe('90d');
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(mockEventService.getEventsBy).not.toHaveBeenCalled();

    mockDialog.open.mockReturnValueOnce({ afterClosed: () => of(true) });

    await component.onTileEventFilterRangeChange(0, 'all');

    expect(component.user.settings.dashboardSettings.tiles[0].eventFilters).toEqual({ range: 'all', activityTypes: [] });
    expectDashboardSettingsWrite(component.user, {
      tiles: component.user.settings.dashboardSettings.tiles,
    });
    expect(mockEventService.getEventsBy).toHaveBeenLastCalledWith(component.user, [], 'startDate', false, 0);
  });

  it('should persist derived chart range changes on the owning tile', async () => {
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
            dataType: 'Training Stress Score',
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
            displaySettings: { derivedChartRange: '1y' },
          }],
        },
      },
    } as any;

    await component.onTileDerivedChartRangeChange(0, '12w');

    expect(component.user.settings.dashboardSettings.tiles[0].displaySettings).toEqual({
      derivedChartRange: '12w',
    });
    expectDashboardSettingsWrite(component.user, {
      tiles: component.user.settings.dashboardSettings.tiles,
    });
  });

  it('should persist Form/TSS timeline window changes on the owning tile', async () => {
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: DASHBOARD_FORM_CHART_TYPE,
            dataType: 'Training Stress Score',
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
            displaySettings: { formTimelineWindow: 'w' },
          }],
        },
      },
    } as any;

    await component.onTileFormTimelineWindowChange(0, 'm');

    expect(component.user.settings.dashboardSettings.tiles[0].displaySettings).toEqual({
      formTimelineWindow: 'm',
    });
    expectDashboardSettingsWrite(component.user, {
      tiles: component.user.settings.dashboardSettings.tiles,
    });
  });

  it('should rollback tile display settings when persistence fails', async () => {
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    mockUserService.updateUserProperties.mockRejectedValueOnce(new Error('persist failed'));
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
            dataType: 'Training Stress Score',
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
            displaySettings: { derivedChartRange: '8w' },
          }],
        },
      },
    } as any;

    await component.onTileDerivedChartRangeChange(0, 'all');

    expect(component.user.settings.dashboardSettings.tiles[0].displaySettings).toEqual({
      derivedChartRange: '8w',
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[SummariesComponent] Failed to persist dashboard tile display settings',
      expect.any(Error),
    );
  });

  it('should keep sleep listening independent from dashboard event date filters', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: 'SleepTrend',
            dataType: 'SleepDuration',
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 2, rows: 1 },
          }],
        },
      },
    } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(component.sleepTrendRange).toBe('14d');
    expect(component.sleepTrendWindowLabel).toBe('Last 14 days');
    expect(mockSleepService.watchForDashboard).toHaveBeenCalledWith('user-1', nowMs - fourteenDaysMs, nowMs);

    expect(mockSleepService.watchForDashboard).toHaveBeenCalledTimes(1);
  });

  it('should persist sleep range changes and reset the listener to the latest selected window', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          sleepTrend: { range: '14d' },
          tiles: [],
        },
      },
    } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });
    mockSleepService.watchForDashboard.mockClear();

    await component.onSleepTrendRangeChange('30d');

    expect(component.user.settings.dashboardSettings.sleepTrend.range).toBe('30d');
    expect(component.sleepTrendRange).toBe('30d');
    expect(component.sleepTrendWindowLabel).toBe('Last 30 days');
    expectDashboardSettingsWrite(component.user, {
      sleepTrend: component.user.settings.dashboardSettings.sleepTrend,
    });
    expect(mockSleepService.watchForDashboard).toHaveBeenCalledWith('user-1', nowMs - thirtyDaysMs, nowMs);
  });

  it('should page sleep windows by the selected range and cap newer navigation at latest', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          sleepTrend: { range: '14d' },
          tiles: [],
        },
      },
    } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });
    mockSleepService.watchForDashboard.mockClear();

    component.onSleepTrendNavigate('older');

    expect(component.sleepTrendCanNavigateNewer).toBe(true);
    expect(mockSleepService.watchForDashboard).toHaveBeenLastCalledWith(
      'user-1',
      nowMs - (2 * fourteenDaysMs),
      nowMs - fourteenDaysMs,
    );

    component.onSleepTrendNavigate('newer');

    expect(component.sleepTrendCanNavigateNewer).toBe(false);
    expect(component.sleepTrendWindowLabel).toBe('Last 14 days');
    expect(mockSleepService.watchForDashboard).toHaveBeenLastCalledWith(
      'user-1',
      nowMs - fourteenDaysMs,
      nowMs,
    );
  });

  it('should treat the 1y sleep range as a bounded pageable window', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          sleepTrend: { range: '1y' },
          tiles: [],
        },
      },
    } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    expect(component.sleepTrendRange).toBe('1y');
    expect(component.sleepTrendWindowLabel).toBe('Last 1 year');
    expect(component.sleepTrendCanNavigateOlder).toBe(true);
    expect(mockSleepService.watchForDashboard).toHaveBeenLastCalledWith(
      'user-1',
      nowMs - yearMs,
      nowMs,
    );

    mockSleepService.watchForDashboard.mockClear();
    component.onSleepTrendNavigate('older');

    expect(component.sleepTrendCanNavigateNewer).toBe(true);
    expect(component.sleepTrendWindowLabel).toContain('2024');
    expect(component.sleepTrendWindowLabel).toContain('2025');
    expect(mockSleepService.watchForDashboard).toHaveBeenLastCalledWith(
      'user-1',
      nowMs - (2 * yearMs),
      nowMs - yearMs,
    );
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

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
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

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    component.ngDoCheck();

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledTimes(1);
  });

  it('should snapshot tile event filter activity arrays without retaining mutable references', () => {
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
            eventFilters: {
              range: '90d',
              activityTypes: [],
            },
          }],
        },
      },
    } as any;

    const snapshot = (component as any).getDashboardTileSettingsSnapshot();
    component.user.settings.dashboardSettings.tiles[0].eventFilters.activityTypes.push(ActivityTypes.Running);

    expect(snapshot[0].eventFilters.activityTypes).toEqual([]);
    expect((component as any).getDashboardTileSettingsSnapshot()[0].eventFilters.activityTypes).toEqual([ActivityTypes.Running]);
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
    (component as any).derivedMetricsHydrated = true;
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
    vi.useFakeTimers();
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
    (component as any).derivedMetricsHydrated = true;
    (component as any).derivedFormStatus = 'stale';
    (component as any).derivedRecoveryNowStatus = 'ready';
    (component as any).refreshDerivedMetricsBannerState();

    expect(component.derivedMetricsBanner).toBeNull();
    vi.advanceTimersByTime(250);
    expect(component.derivedMetricsBanner?.type).toBe('pending');
    expect(component.derivedMetricsBanner?.title).toContain('Refreshing');
    expect(component.derivedMetricsBanner?.showRetry).toBe(false);
  });

  it('should suppress derived banner until first derived state hydration completes', () => {
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
    (component as any).derivedMetricsHydrated = false;
    (component as any).derivedFormStatus = 'missing';
    (component as any).refreshDerivedMetricsBannerState();

    expect(component.derivedMetricsBanner).toBeNull();
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

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
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

  it('should open dashboard manager dialog and rebuild tiles when dialog saves changes', async () => {
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
    component.showActions = true;
    mockDialog.open.mockReturnValue({
      afterClosed: () => of({ saved: true }),
    });
    const rebuildSpy = vi.spyOn(component as any, 'rebuildTilesFromCurrentState').mockResolvedValue(undefined);

    await component.openDashboardManagerDialog();

    expect(mockDialog.open).toHaveBeenCalledTimes(1);
    expect(mockDialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        user: component.user,
        initialMode: undefined,
        initialEditTileOrder: null,
      }),
    }));
    expect(rebuildSpy).toHaveBeenCalledTimes(1);
    expect(component.isDashboardManagerOpen).toBe(false);
  });

  it('should re-enable dashboard manager button as soon as the dialog starts closing', async () => {
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
    component.showActions = true;
    const beforeClosedSubject = new Subject<void>();
    const afterClosedSubject = new Subject<{ saved: boolean } | undefined>();
    mockDialog.open.mockReturnValueOnce({
      beforeClosed: () => beforeClosedSubject.asObservable(),
      afterClosed: () => afterClosedSubject.asObservable(),
    });

    const openPromise = component.openDashboardManagerDialog();

    expect(component.isDashboardManagerOpen).toBe(true);

    beforeClosedSubject.next();
    beforeClosedSubject.complete();

    expect(component.isDashboardManagerOpen).toBe(false);

    afterClosedSubject.next(undefined);
    afterClosedSubject.complete();
    await openPromise;

    expect(component.isDashboardManagerOpen).toBe(false);
  });

  it('should open dashboard manager dialog in edit mode for a specific chart tile order', async () => {
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 3,
            chartType: ChartTypes.ColumnsVertical,
            dataType: DataAscent.type,
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.ActivityType,
            size: { columns: 1, rows: 1 },
          }],
        },
      },
    } as any;
    component.showActions = true;
    mockDialog.open.mockReturnValue({
      afterClosed: () => of({ saved: false }),
    });

    await component.openDashboardManagerForTileOrder(3);

    expect(mockDialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        user: component.user,
        initialMode: 'edit',
        initialEditTileOrder: 3,
      }),
    }));
  });

  it('should open dashboard manager dialog in edit mode for a map tile order', async () => {
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Map,
            order: 4,
            mapStyle: 'default',
            clusterMarkers: true,
            size: { columns: 1, rows: 1 },
          }],
        },
      },
    } as any;
    component.showActions = true;
    mockDialog.open.mockReturnValue({
      afterClosed: () => of({ saved: false }),
    });

    await component.openDashboardManagerForTileOrder(4);

    expect(mockDialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        user: component.user,
        initialMode: 'edit',
        initialEditTileOrder: 4,
      }),
    }));
  });

  it('should ignore dashboard manager open requests when actions are hidden', async () => {
    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.showActions = false;

    await component.openDashboardManagerDialog();

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
    expectDashboardSettingsWrite(component.user, {
      tiles: component.user.settings.dashboardSettings.tiles,
    });
  });

  it('should reset per-order tile event state after dashboard tile reorder', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    component.showActions = true;
    component.desktopTileDragEnabled = true;
    component.user = {
      uid: 'user-1',
      settings: {
        unitSettings: { startOfTheWeek: 1 },
        dashboardSettings: {
          tiles: [
            {
              type: TileTypes.Chart,
              order: 0,
              size: { columns: 1, rows: 1 },
              chartType: ChartTypes.ColumnsVertical,
              dataType: DataAscent.type,
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              eventFilters: { range: '14d', activityTypes: [] },
            },
            {
              type: TileTypes.Map,
              order: 1,
              size: { columns: 1, rows: 1 },
              clusterMarkers: true,
              mapStyle: 'default',
              eventFilters: { range: '30d', activityTypes: [] },
            },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical } as any,
      { type: TileTypes.Map, order: 1, size: { columns: 1, rows: 1 }, clusterMarkers: true, mapStyle: 'default' } as any,
    ];
    (component as any).tileEventsByOrder = {
      0: [{ id: 'old-chart-event' }],
      1: [{ id: 'old-map-event' }],
    };

    component.onTilesSort({ previousIndex: 0, currentIndex: 1 } as any);
    mockEventService.getEventsBy.mockClear();
    await component.onTilesDrop({ previousIndex: 0, currentIndex: 1 } as any);

    expect((component as any).tileEventsByOrder).toEqual({ 0: [], 1: [] });
    expect(mockEventService.getEventsBy).toHaveBeenCalledTimes(2);
    expect(mockEventService.getEventsBy.mock.calls[0][1]).toEqual([
      { fieldPath: 'startDate', opStr: '>=', value: nowMs - (30 * 24 * 60 * 60 * 1000) },
      { fieldPath: 'startDate', opStr: '<=', value: nowMs },
    ]);
    expect(mockEventService.getEventsBy.mock.calls[1][1]).toEqual([
      { fieldPath: 'startDate', opStr: '>=', value: nowMs - (14 * 24 * 60 * 60 * 1000) },
      { fieldPath: 'startDate', opStr: '<=', value: nowMs },
    ]);
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

  it('should mark for check when app theme toggles dark mode', async () => {
    const theme$ = new Subject<any>();
    mockThemeService.getAppTheme.mockReturnValue(theme$ as any);
    const markForCheckSpy = vi.spyOn((component as any).changeDetector, 'markForCheck');

    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [],
        },
      },
    } as any;

    await component.ngOnChanges({
      user: {
        currentValue: component.user,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });

    theme$.next(AppThemes.Normal);
    expect(component.darkTheme).toBe(false);
    expect(markForCheckSpy).not.toHaveBeenCalled();

    theme$.next(AppThemes.Dark);
    expect(component.darkTheme).toBe(true);
    expect(markForCheckSpy).toHaveBeenCalledTimes(1);

    // No redundant marks when theme emission repeats.
    theme$.next(AppThemes.Dark);
    expect(markForCheckSpy).toHaveBeenCalledTimes(1);
  });
});
