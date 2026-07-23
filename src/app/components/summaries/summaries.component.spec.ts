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
  DataDistance,
  DataDuration,
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
import { AppRouteService } from '../../services/app.route.service';
import { DashboardAutoTileService } from '../../services/dashboard-auto-tile.service';
import * as dashboardTileViewModelHelper from '../../helpers/dashboard-tile-view-model.helper';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
} from '../../helpers/dashboard-special-chart-types';
import { getDashboardPowerCurveActivityTypes } from '../../helpers/dashboard-power-curve-scope.helper';
import { DASHBOARD_READINESS_SLEEP_MAX_AGE_MS } from '../../helpers/dashboard-training-insights.helper';
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
  let mockRouteService: { watchRecentRoutePreviews: ReturnType<typeof vi.fn> };
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
        trainingCapacity: null,
        trainingDurability: null,
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
        trainingCapacityStatus: 'missing',
        trainingDurabilityStatus: 'missing',
      })),
      ensureForDashboard: vi.fn(),
    };
    mockSleepService = {
      watchForDashboard: vi.fn().mockReturnValue(of([])),
    };
    mockEventService = {
      getEventsBy: vi.fn().mockReturnValue(of([])),
    };
    mockRouteService = {
      watchRecentRoutePreviews: vi.fn().mockReturnValue(of([])),
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
        { provide: AppRouteService, useValue: mockRouteService },
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

  it('exposes the Training action beside Dashboard manager', () => {
    component.showActions = true;

    fixture.detectChanges();
    const trainingLink = (fixture.nativeElement as HTMLElement).querySelector('.dashboard-training-link') as HTMLAnchorElement;
    expect(trainingLink).not.toBeNull();
    expect(trainingLink.getAttribute('aria-label')).toBe('Open Training workspace');
    expect(trainingLink.textContent).toContain('Open Training');
    expect(trainingLink.querySelector('mat-icon')?.textContent?.trim()).toBe('monitoring');
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
      dataType: DataDistance.type,
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
    (component as any).refreshTileLanes();

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
    const kpiLane = kpiSection?.querySelector('.dashboard-kpi-lane') as HTMLElement | null;
    expect(kpiLane).not.toBeNull();
    expect(kpiLane?.classList.contains('qs-glass-card-panel')).toBe(true);
    expect(kpiSection?.querySelectorAll('.dashboard-kpi-tile')).toHaveLength(1);
    expect(kpiLane?.querySelector('app-tile-chart')?.classList.contains('qs-glass-card-panel')).toBe(false);
    expect(nativeElement.querySelectorAll('.dashboard-section-divider')).toHaveLength(0);
    expect(nativeElement.querySelector('.dashboard-main-sections')).not.toBeNull();
    expect(nativeElement.querySelector('.dashboard-empty-section-guidance')).toBeNull();
    const sectionHeadings = Array.from(nativeElement.querySelectorAll('.dashboard-main-section h2'))
      .map(heading => heading.textContent?.trim());
    expect(sectionHeadings).toEqual(['Activity Overview', 'Routes & Maps']);
    const boards = nativeElement.querySelectorAll('app-dashboard-tile-board');
    expect(boards).toHaveLength(2);
    const board = boards[0] as HTMLElement | null;
    expect(board?.classList.contains('qs-glass-card-panel')).toBe(true);
    expect(board?.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('1');
    expect(nativeElement.querySelectorAll('app-dashboard-tile-cell.dashboard-grid-tile:not(.dashboard-grid-placeholder)')).toHaveLength(2);
    expect(nativeElement.querySelectorAll('app-dashboard-tile-cell.dashboard-grid-placeholder')).toHaveLength(0);
    expect(component.mainGridSections.every(section => section.trailingPlaceholders.length === 0)).toBe(true);
    expect(component.mainGridSections.every(section => section.columns === 1)).toBe(true);
    expect(component.mainGridSections.every(section => section.cells[0]?.columns === 1)).toBe(true);
    const singletonCells = nativeElement.querySelectorAll('app-dashboard-tile-cell.dashboard-grid-tile:not(.dashboard-grid-placeholder)');
    singletonCells.forEach((cell) => {
      expect((cell as HTMLElement).style.gridColumn).toBe('span 1');
    });
    expect(mainGridTile.size.columns).toBe(1);
    expect(mainMapTile.size.columns).toBe(1);
    const mainChart = board?.querySelector('app-tile-chart') as HTMLElement | null;
    expect(mainChart).not.toBeNull();
    expect(mainChart?.classList.contains('qs-glass-card-panel')).toBe(false);
    const mainMap = boards[1]?.querySelector('app-tile-map') as HTMLElement | null;
    expect(mainMap).not.toBeNull();
    expect(mainMap?.classList.contains('qs-glass-card-panel')).toBe(false);
  });

  it('squares loading shades inside the KPI lane surface', () => {
    const stylePath = resolve(process.cwd(), 'src/app/components/summaries/summaries.component.css');
    const styles = readFileSync(stylePath, 'utf8');

    expect(styles).toContain('.dashboard-kpi-lane {');
    expect(styles).toContain('--loading-shade-border-radius: 0;');
  });

  it('passes training insight contexts through the compact KPI lane', () => {
    const aerobicCapacity = {
      value: 55.9,
      discipline: 'cycling',
      sourceKey: 'garmin edge mtb',
      sourceLabel: 'Garmin Edge MTB',
      observationCount: 7,
      changePct: 1.2,
      lastSeenAtMs: Date.UTC(2026, 6, 11),
      trend: [],
    };
    const tiles = [
      {
        type: TileTypes.Chart,
        order: 0,
        chartType: DASHBOARD_AEROBIC_CAPACITY_KPI_CHART_TYPE,
        aerobicCapacity,
        size: { columns: 1, rows: 1 },
      },
    ] as any[];

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.tiles = tiles;
    component.kpiLaneTiles = tiles;

    fixture.detectChanges();

    const charts = (fixture.nativeElement as HTMLElement).querySelectorAll('app-tile-chart');
    expect(charts).toHaveLength(1);
    expect((charts[0] as any).aerobicCapacity).toBe(aerobicCapacity);
  });

  it('keeps intent section headings compact against the shared dashboard header style', () => {
    const stylePath = resolve(process.cwd(), 'src/app/components/summaries/summaries.component.css');
    const styles = readFileSync(stylePath, 'utf8');

    expect(styles).toContain('.dashboard-section-header.dashboard-main-section-header h2');
    expect(styles).toContain('font-size: 1rem;');
  });

  it('does not mutate dashboard tile arrays during live drag sorting', () => {
    const templatePath = resolve(process.cwd(), 'src/app/components/summaries/summaries.component.html');
    const template = readFileSync(templatePath, 'utf8');

    expect(template).not.toContain('cdkDropListSorted');
    expect(template).toContain('(cdkDropListDropped)="onKpiTilesDrop($event)"');
    expect(template).toContain('(cdkDropListDropped)="onTilesDrop($event, section.id)"');
  });

  it('uses compact section columns instead of placeholders for sparse single-row sections', () => {
    const mainGridTiles = [0, 1, 2].map(order => ({
      type: TileTypes.Chart,
      order,
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    })) as any[];

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.numberOfCols = 4;
    component.tiles = mainGridTiles;
    component.kpiLaneTiles = [];
    component.mainGridTiles = mainGridTiles;
    (component as any).refreshTileLanes();

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const board = nativeElement.querySelector('app-dashboard-tile-board') as HTMLElement | null;
    expect(board).not.toBeNull();
    expect(board?.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('3');
    expect(component.mainGridSections[0]?.columns).toBe(3);
    expect(component.mainGridSections[0]?.trailingPlaceholders).toEqual([]);
    expect(board?.querySelectorAll('app-dashboard-tile-cell.dashboard-grid-tile')).toHaveLength(3);
    expect(board?.querySelector('app-dashboard-tile-cell.dashboard-grid-placeholder')).toBeNull();
  });

  it('packs mixed-width charts without leaving empty grid columns', () => {
    const mainGridTiles = [
      {
        type: TileTypes.Chart,
        order: 0,
        name: 'Efficiency Trend',
        chartType: DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
        data: [],
        size: { columns: 1, rows: 1 },
      },
      {
        type: TileTypes.Chart,
        order: 1,
        name: 'Cycling Power Curve',
        chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
        data: [],
        size: { columns: 2, rows: 1 },
      },
      {
        type: TileTypes.Chart,
        order: 2,
        name: 'Running Power Curve',
        chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
        data: [],
        size: { columns: 2, rows: 1 },
      },
    ] as any[];

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.numberOfCols = 4;
    component.tiles = mainGridTiles;
    component.kpiLaneTiles = [];
    component.mainGridTiles = mainGridTiles;
    (component as any).refreshTileLanes();

    fixture.detectChanges();

    const performanceSection = component.mainGridSections.find(section => section.id === 'performancePower');
    expect(performanceSection?.columns).toBe(3);
    expect(performanceSection?.cells.map(cell => cell.columns)).toEqual([1, 2, 3]);
    expect(performanceSection?.trailingPlaceholders).toEqual([]);

    const nativeElement = fixture.nativeElement as HTMLElement;
    const board = nativeElement.querySelector('app-dashboard-tile-board') as HTMLElement | null;
    const cells = Array.from(
      board?.querySelectorAll('app-dashboard-tile-cell.dashboard-grid-tile:not(.dashboard-grid-placeholder)') || [],
    ) as HTMLElement[];
    expect(board?.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('3');
    expect(cells.map(cell => cell.style.gridColumn)).toEqual(['span 1', 'span 2', 'span 3']);
  });

  it('balances sparse map sections so one route map does not consume all leftover columns', () => {
    const mainGridTiles = [
      {
        type: TileTypes.Map,
        order: 0,
        name: 'Clustered HeatMap',
        mapSource: 'events',
        events: [],
        size: { columns: 1, rows: 1 },
      },
      {
        type: TileTypes.Map,
        order: 1,
        name: 'Routes',
        mapSource: 'routes',
        routePreviews: [],
        size: { columns: 3, rows: 1 },
      },
    ] as any[];

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.numberOfCols = 4;
    component.tiles = mainGridTiles;
    component.kpiLaneTiles = [];
    component.mainGridTiles = mainGridTiles;
    (component as any).refreshTileLanes();

    fixture.detectChanges();

    const routesSection = component.mainGridSections.find(section => section.id === 'routesMaps');
    expect(routesSection?.columns).toBe(4);
    expect(routesSection?.cells.map(cell => cell.columns)).toEqual([2, 2]);
    expect(routesSection?.trailingPlaceholders).toEqual([]);

    const nativeElement = fixture.nativeElement as HTMLElement;
    const board = nativeElement.querySelector('app-dashboard-tile-board') as HTMLElement | null;
    const cells = Array.from(board?.querySelectorAll('app-dashboard-tile-cell.dashboard-grid-tile:not(.dashboard-grid-placeholder)') || []) as HTMLElement[];
    expect(board?.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('4');
    expect(cells.map(cell => cell.style.gridColumn)).toEqual(['span 2', 'span 2']);
  });

  it('balances one-column section grids to avoid a lonely final row tile', () => {
    const mainGridTiles = [0, 1, 2, 3, 4].map(order => ({
      type: TileTypes.Chart,
      order,
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    })) as any[];

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.numberOfCols = 4;
    component.tiles = mainGridTiles;
    component.kpiLaneTiles = [];
    component.mainGridTiles = mainGridTiles;
    (component as any).refreshTileLanes();

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const board = nativeElement.querySelector('app-dashboard-tile-board') as HTMLElement | null;
    expect(board).not.toBeNull();
    expect(board?.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('3');
    expect(component.mainGridSections[0]?.columns).toBe(3);
    expect(component.mainGridSections[0]?.trailingPlaceholders).toEqual([0]);
    expect(board?.querySelectorAll('app-dashboard-tile-cell.dashboard-grid-tile')).toHaveLength(6);
  });

  it('balances six one-column section tiles as two full rows of three', () => {
    const mainGridTiles = [0, 1, 2, 3, 4, 5].map(order => ({
      type: TileTypes.Chart,
      order,
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    })) as any[];

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.numberOfCols = 4;
    component.tiles = mainGridTiles;
    component.kpiLaneTiles = [];
    component.mainGridTiles = mainGridTiles;
    (component as any).refreshTileLanes();

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const board = nativeElement.querySelector('app-dashboard-tile-board') as HTMLElement | null;
    expect(board).not.toBeNull();
    expect(board?.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('3');
    expect(component.mainGridSections[0]?.columns).toBe(3);
    expect(component.mainGridSections[0]?.trailingPlaceholders).toEqual([]);
  });

  it('keeps larger one-column sections at the normal grid width', () => {
    const mainGridTiles = [0, 1, 2, 3, 4, 5, 6, 7].map(order => ({
      type: TileTypes.Chart,
      order,
      chartType: ChartTypes.ColumnsVertical,
      dataType: DataDistance.type,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataValueType: ChartDataValueTypes.Total,
      data: [],
      timeInterval: TimeIntervals.Daily,
      size: { columns: 1, rows: 1 },
    })) as any[];

    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.numberOfCols = 4;
    component.tiles = mainGridTiles;
    component.kpiLaneTiles = [];
    component.mainGridTiles = mainGridTiles;
    (component as any).refreshTileLanes();

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const board = nativeElement.querySelector('app-dashboard-tile-board') as HTMLElement | null;
    expect(board).not.toBeNull();
    expect(board?.style.getPropertyValue('--dashboard-tile-board-cols')).toBe('4');
    expect(component.mainGridSections[0]?.columns).toBe(4);
    expect(component.mainGridSections[0]?.trailingPlaceholders).toEqual([]);
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
    const emptyGuidance = nativeElement.querySelector('.dashboard-empty-section-guidance');
    expect(emptyGuidance).not.toBeNull();
    expect(emptyGuidance?.textContent).toContain('Build your dashboard by intent');
    expect(emptyGuidance?.textContent).not.toContain('Training State');
    expect(emptyGuidance?.textContent).not.toContain('Performance & Power');
  });

  it('hides the Today summary while preserving manager access on an editable dashboard', () => {
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [],
          showTodaySummary: false,
        },
      },
    } as any;
    component.showActions = true;
    component.tiles = [];
    component.kpiLaneTiles = [];
    component.mainGridTiles = [];

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    const dashboardHeader = nativeElement.querySelector('.dashboard-summary-header');
    expect(component.showTodaySummary).toBe(false);
    expect(dashboardHeader).not.toBeNull();
    expect(dashboardHeader?.classList.contains('dashboard-summary-header-actions-only')).toBe(true);
    expect(dashboardHeader?.getAttribute('aria-label')).toBe('Dashboard controls');
    expect(nativeElement.querySelector('#dashboard-today-title')).toBeNull();
    expect(nativeElement.querySelector('.dashboard-current-state-row')).toBeNull();
    expect(nativeElement.querySelector('.dashboard-manager-button-desktop span')?.textContent?.trim()).toBe('Dashboard manager');
  });

  it('renders the fixed Today summary on an otherwise empty read-only dashboard', () => {
    component.user = { settings: { dashboardSettings: { tiles: [] } } } as any;
    component.showActions = false;
    component.tiles = [];
    component.kpiLaneTiles = [];
    component.mainGridTiles = [];

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('.pie')).not.toBeNull();
    expect(nativeElement.querySelector('.dashboard-summary-header')).not.toBeNull();
    expect(nativeElement.querySelector('.dashboard-current-state-row')).not.toBeNull();
    expect(nativeElement.querySelector('.dashboard-empty-section-guidance')).toBeNull();
  });

  it('shows shared readiness drivers in Today and treats lower overnight heart rate as supportive', () => {
    const nowMs = Date.UTC(2026, 6, 18, 12);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    (component as any).derivedFormNowContext = { value: 12, latestDayMs: nowMs };
    (component as any).derivedRampRateContext = { rampRate: 1, latestDayMs: nowMs };
    (component as any).derivedRecoveryNowContext = { totalSeconds: 7_200, endTimeMs: nowMs };
    (component as any).readinessSleepSessions = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `baseline-${index}`,
        sleepDate: new Date(nowMs - ((index + 2) * 86_400_000)).toISOString().slice(0, 10),
        startTimeMs: nowMs - ((index + 2) * 86_400_000) - (9 * 3_600_000),
        endTimeMs: nowMs - ((index + 2) * 86_400_000) - 3_600_000,
        durationSeconds: 8 * 3_600,
        score: { value: 80 },
        vitals: { averageHrvMs: 50, averageHeartRateBpm: 52, minimumHeartRateBpm: 44 },
        source: { provider: 'GarminAPI', sourceSessionKey: `baseline-${index}` },
      })),
      {
        id: 'latest',
        sleepDate: new Date(nowMs).toISOString().slice(0, 10),
        startTimeMs: nowMs - (9 * 3_600_000),
        endTimeMs: nowMs - 3_600_000,
        durationSeconds: 8 * 3_600,
        score: { value: 90 },
        vitals: { averageHrvMs: 55, averageHeartRateBpm: 48, minimumHeartRateBpm: 40 },
        source: { provider: 'GarminAPI', sourceSessionKey: 'latest' },
      },
    ];
    component.dashboardTodayReadiness = (component as any).buildDashboardTodayReadiness();

    fixture.detectChanges();

    const nativeElement = fixture.nativeElement as HTMLElement;
    expect(nativeElement.querySelector('.dashboard-readiness-primary-value')?.textContent).toContain('/100');
    expect(nativeElement.querySelector('.dashboard-readiness-method')?.textContent).toContain('Freshness stays TSS-only');
    expect(nativeElement.querySelector('.dashboard-readiness-imported-recovery')?.textContent)
      .toContain('2h 00m remaining · separate from score');
    expect([...nativeElement.querySelectorAll('.dashboard-current-state-primary small')]
      .some(element => element.textContent?.includes('High confidence · 4/4 signals'))).toBe(true);
    expect(nativeElement.querySelector('dd[data-tone="positive"]')?.textContent).toContain('+10%');
    const overnightHeartRate = [...nativeElement.querySelectorAll('.dashboard-current-state-row dl > div')]
      .find(element => element.querySelector('dt')?.textContent?.trim() === 'Overnight HR');
    expect(overnightHeartRate?.querySelector('dd')?.getAttribute('data-tone')).toBe('positive');
    expect(overnightHeartRate?.querySelector('dd')?.textContent).toContain('-8');
  });

  it('shows the same TSS-only training state as Training above Today readiness', () => {
    const nowMs = Date.UTC(2026, 6, 18, 12);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    (component as any).derivedFormPoints = [{
      time: Date.UTC(2026, 6, 18),
      trainingStressScore: 0,
      ctl: 102,
      atl: 114,
      formSameDay: -12,
      formPriorDay: -10,
    }];
    (component as any).derivedRampRateContext = {
      latestDayMs: nowMs,
      ctlToday: 102,
      ctl7DaysAgo: 100,
      rampRate: 2,
      trend8Weeks: [],
    };
    (component as any).dashboardTodayTrainingState = (component as any).buildDashboardTodayTrainingState();

    fixture.detectChanges();

    const state = fixture.nativeElement.querySelector('.dashboard-training-state-primary') as HTMLElement;
    expect(state.textContent).toContain('Training state');
    expect(state.textContent).toContain('Fatigued');
    expect(state.textContent).toContain('Absorb the load');
    expect(state.textContent).toContain('TSS only');
  });

  it('uses the same current-day Form series as dashboard load KPIs for Today readiness', () => {
    const nowMs = Date.UTC(2026, 6, 18, 12);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    (component as any).derivedFormPoints = [{
      time: Date.UTC(2026, 6, 11),
      trainingStressScore: 84,
      ctl: 42,
      atl: 50,
      formSameDay: -8,
      formPriorDay: -4,
    }];
    (component as any).derivedFormNowContext = { value: -99, latestDayMs: Date.UTC(2026, 6, 11) };
    (component as any).derivedRampRateContext = { rampRate: 99, latestDayMs: Date.UTC(2026, 6, 11) };

    const readiness = (component as any).buildDashboardTodayReadiness();

    expect(readiness.loadText).toBe('+18.5 / -6.5');
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
      routePreviews: [],
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
      startOfWeek: null,
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
        powerCurve: null,
        trainingCapacity: null,
        trainingDurability: null,
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
            {
              type: TileTypes.Chart,
              order: 6,
              chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
              name: 'Cycling Power Curve',
              dataType: 'Training Stress Score',
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              size: { columns: 1, rows: 1 },
              eventFilters: { range: '1y', activityTypes: getDashboardPowerCurveActivityTypes('cycling') },
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

  it('should load route preview maps from route previews without event subscriptions', async () => {
    const routePreviewsSubject = new Subject<any[]>();
    const previewRoute = {
      id: 'route-1',
      preview: {
        version: 1,
        encoding: 'polyline5',
        precision: 5,
        sourcePointCount: 2,
        pointCount: 2,
        segments: [{
          sourcePointCount: 2,
          pointCount: 2,
          encodedPolyline: '_p~iF~ps|U_ulLnnqC',
        }],
      },
    };
    mockRouteService.watchRecentRoutePreviews.mockReturnValueOnce(routePreviewsSubject.asObservable());
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'viewer-user',
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Map,
            order: 0,
            name: 'Routes',
            mapSource: 'routes',
            mapStyle: 'default',
            clusterMarkers: false,
            showHeatMap: false,
            size: { columns: 2, rows: 2 },
            eventFilters: { range: '90d', activityTypes: [ActivityTypes.Running] },
          }],
        },
      },
    } as any;
    component.eventUser = { uid: 'route-owner' } as any;

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

    expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
    expect(mockRouteService.watchRecentRoutePreviews).toHaveBeenCalledWith(component.eventUser, 50);
    expect(component.routePreviewLoading).toBe(true);
    expect(component.isTileLoading({
      type: TileTypes.Map,
      order: 0,
      mapSource: 'routes',
    } as any)).toBe(true);

    routePreviewsSubject.next([previewRoute]);
    await Promise.resolve();

    expect(component.routePreviewLoading).toBe(false);
    expect(buildDashboardTileViewModelsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      tileEventsByOrder: {},
      routePreviews: [previewRoute],
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

  it('should switch Power Curve ranges without a query or all-range confirmation', async () => {
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            name: 'Running Power Curve',
            chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
            dataType: 'Training Stress Score',
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
            eventFilters: { range: '1y', activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running] },
          }],
        },
      },
    } as any;

    await component.onTileEventFilterRangeChange(0, 'all');

    expect(mockDialog.open).not.toHaveBeenCalled();
    expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
    expect(component.user.settings.dashboardSettings.tiles[0].eventFilters).toEqual({
      range: 'all',
      activityTypes: getDashboardPowerCurveActivityTypes('running'),
    });
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

  it('should persist Power Curve compare mode changes on the owning tile', async () => {
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
            dataType: 'Training Stress Score',
            dataValueType: ChartDataValueTypes.Total,
            dataCategoryType: ChartDataCategoryTypes.DateType,
            size: { columns: 1, rows: 1 },
            displaySettings: { powerCurveCompareMode: 'latest' },
          }],
        },
      },
    } as any;

    await component.onTilePowerCurveCompareModeChange(0, 'best30d');

    expect(component.user.settings.dashboardSettings.tiles[0].displaySettings).toEqual({
      powerCurveCompareMode: 'best30d',
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

    expect(mockSleepService.watchForDashboard).toHaveBeenCalledTimes(2);
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

  it('should refresh sleep listening when a user input refresh changes only the sleep trend range', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    const originalUser = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          sleepTrend: { range: '14d' },
          tiles: [],
        },
      },
    } as any;
    component.user = originalUser;

    await component.ngOnChanges({
      user: {
        currentValue: originalUser,
        previousValue: null,
        firstChange: true,
        isFirstChange: () => true,
      } as any,
    });
    mockSleepService.watchForDashboard.mockClear();
    buildDashboardTileViewModelsSpy.mockClear();

    const refreshedUser = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          sleepTrend: { range: '30d' },
          tiles: [],
        },
      },
    } as any;
    component.user = refreshedUser;

    await component.ngOnChanges({
      user: {
        currentValue: refreshedUser,
        previousValue: originalUser,
        firstChange: false,
        isFirstChange: () => false,
      } as any,
    });

    expect(component.sleepTrendRange).toBe('30d');
    expect(mockSleepService.watchForDashboard).toHaveBeenCalledWith('user-1', nowMs - thirtyDaysMs, nowMs);
    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalled();
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

  it('should rebuild sleep tiles when paging to a window with the same session array', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const sleepStreams: Array<Subject<any[]>> = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    mockSleepService.watchForDashboard.mockImplementation(() => {
      const stream = new Subject<any[]>();
      sleepStreams.push(stream);
      return stream.asObservable();
    });
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          sleepTrend: { range: '14d' },
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
    buildDashboardTileViewModelsSpy.mockClear();

    component.onSleepTrendNavigate('older');
    sleepStreams[2].next([]);
    await Promise.resolve();

    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledTimes(1);
    expect(buildDashboardTileViewModelsSpy).toHaveBeenCalledWith(expect.objectContaining({
      sleepSessions: [],
      sleepTrendWindow: {
        range: '14d',
        startMs: nowMs - (2 * fourteenDaysMs),
        endMs: nowMs - fourteenDaysMs,
      },
    }));
  });

  it('keeps readiness sleep evidence on the current window while the Sleep tile pages backward', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    const dayMs = 24 * 60 * 60 * 1000;
    const sleepStreams: Array<{ startMs: number; endMs: number; stream: Subject<any[]> }> = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
    mockSleepService.watchForDashboard.mockImplementation((_uid, startMs, endMs) => {
      const stream = new Subject<any[]>();
      sleepStreams.push({ startMs, endMs, stream });
      return stream.asObservable();
    });
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          sleepTrend: { range: '14d' },
          tiles: [{
            type: TileTypes.Chart,
            order: 0,
            chartType: DASHBOARD_SLEEP_TREND_CHART_TYPE,
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

    const readinessStream = sleepStreams.find(({ startMs, endMs }) => (
      endMs === Number.MAX_SAFE_INTEGER
      && startMs === nowMs - (30 * dayMs)
    ));
    expect(readinessStream).toBeTruthy();
    readinessStream?.stream.next([{ id: 'current-sleep' }]);
    buildDashboardTileViewModelsSpy.mockClear();

    component.onSleepTrendNavigate('older');
    const historicalStream = sleepStreams.at(-1);
    historicalStream?.stream.next([{ id: 'historical-sleep' }]);
    await Promise.resolve();

    expect(mockSleepService.watchForDashboard).toHaveBeenCalledTimes(3);
    expect(buildDashboardTileViewModelsSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      sleepSessions: [{ id: 'historical-sleep' }],
    }));
  });

  it('rebuilds readiness at time-only boundaries and keeps scheduling remaining transitions', async () => {
    const nowMs = Date.UTC(2026, 3, 30, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    (component as any).readinessSleepSessions = [
      {
        id: 'current-sleep',
        sleepDate: '2026-04-30',
        startTimeMs: nowMs - (8 * 60 * 60 * 1000),
        endTimeMs: nowMs,
        durationSeconds: 8 * 60 * 60,
        isNap: false,
        source: { provider: 'GarminAPI', sourceSessionKey: 'current-sleep' },
      },
      {
        id: 'future-sleep',
        sleepDate: '2026-05-01',
        startTimeMs: nowMs + (16 * 60 * 60 * 1000),
        endTimeMs: nowMs + (24 * 60 * 60 * 1000),
        durationSeconds: 8 * 60 * 60,
        isNap: false,
        source: { provider: 'GarminAPI', sourceSessionKey: 'future-sleep' },
      },
    ];
    const rebuildSpy = vi.spyOn(component as any, 'rebuildTilesFromCurrentState').mockResolvedValue(undefined);

    (component as any).updateReadinessSleepRefreshTimer();
    expect((component as any).readinessSleepRefreshTimeoutHandle).not.toBeNull();

    await vi.advanceTimersByTimeAsync(DASHBOARD_READINESS_SLEEP_MAX_AGE_MS + 1);

    expect(rebuildSpy).toHaveBeenCalledTimes(1);
    expect((component as any).readinessSleepRefreshTimeoutHandle).not.toBeNull();
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
    expect(mockSleepService.watchForDashboard).toHaveBeenCalledWith(
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
      expect.objectContaining({
        force: true,
        metricKinds: expect.arrayContaining(['form']),
      }),
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
      showRouteEndpointMarkers: false,
      mapTheme: 'normal',
      mapStyle: 'streets',
      showHeatMap: false,
      events: [],
      size: { columns: 2, rows: 1 },
    } as any);
    const routeMapKey = component.trackByTile(2, {
      type: TileTypes.Map,
      order: 4,
      name: 'Routes',
      clusterMarkers: false,
      showRouteEndpointMarkers: true,
      mapTheme: 'normal',
      mapStyle: 'default',
      mapSource: 'routes',
      showHeatMap: false,
      routePreviews: [{ id: 'route-1' }, { id: 'route-2' }],
      size: { columns: 1, rows: 1 },
    } as any);

    expect(chartKey).toBe(`${ChartTypes.ColumnsVertical}${ChartDataCategoryTypes.DateType}${ChartDataValueTypes.Total}Distance2${TimeIntervals.Monthly}`);
    expect(mapKey).toBe('truefalsenormalstreetseventsMap3false0');
    expect(routeMapKey).toBe('falsetruenormaldefaultroutesRoutes4false2');
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
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDistance.type },
      { type: TileTypes.Chart, order: 1, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDuration.type },
    ] as any;

    (component as any).updateDesktopTileDragCapability();
    expect(component.desktopTileDragEnabled).toBe(true);

    mediaMatches['(hover: hover)'] = false;
    (component as any).updateDesktopTileDragCapability();
    expect(component.desktopTileDragEnabled).toBe(false);
  });

  it('should resynchronize dashboard subscriptions when the manager saves changes', async () => {
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
    const refreshSpy = vi.spyOn(component as any, 'unsubscribeAndCreateCharts').mockResolvedValue(undefined);

    await component.openDashboardManagerDialog();

    expect(mockDialog.open).toHaveBeenCalledTimes(1);
    expect(mockDialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        user: component.user,
        initialMode: undefined,
        initialEditTileOrder: null,
        previewTodaySummaryVisibility: expect.any(Function),
      }),
    }));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(component.isDashboardManagerOpen).toBe(false);
  });

  it('previews Today summary visibility while the manager remains open', async () => {
    component.user = {
      settings: {
        dashboardSettings: {
          tiles: [],
          showTodaySummary: true,
        },
      },
    } as any;
    component.showActions = true;
    const afterClosedSubject = new Subject<{ saved: boolean } | undefined>();
    mockDialog.open.mockReturnValueOnce({
      afterClosed: () => afterClosedSubject.asObservable(),
    });

    const openPromise = component.openDashboardManagerDialog();
    const dialogConfig = mockDialog.open.mock.calls[0]?.[1];
    const previewTodaySummaryVisibility = dialogConfig?.data?.previewTodaySummaryVisibility;

    expect(previewTodaySummaryVisibility).toEqual(expect.any(Function));

    (component.user as any).settings.dashboardSettings.showTodaySummary = false;
    previewTodaySummaryVisibility(false);
    fixture.detectChanges();

    expect(component.showTodaySummary).toBe(false);
    expect((component.user as any).settings.dashboardSettings.showTodaySummary).toBe(false);
    expect(fixture.nativeElement.querySelector('#dashboard-today-title')).toBeNull();

    (component.user as any).settings.dashboardSettings.showTodaySummary = true;
    previewTodaySummaryVisibility(true);
    fixture.detectChanges();

    expect(component.showTodaySummary).toBe(true);
    expect((component.user as any).settings.dashboardSettings.showTodaySummary).toBe(true);
    expect(fixture.nativeElement.querySelector('#dashboard-today-title')?.textContent?.trim()).toBe('Today');

    afterClosedSubject.next(undefined);
    afterClosedSubject.complete();
    await openPromise;
  });

  it('starts and stops the bounded readiness listener with the Today preview', () => {
    const nowMs = Date.UTC(2026, 6, 18, 12);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    component.user = {
      uid: 'user-1',
      settings: { dashboardSettings: { tiles: [], showTodaySummary: false } },
    } as any;
    component.showTodaySummary = false;

    (component as any).previewTodaySummaryVisibility(true);

    expect(mockSleepService.watchForDashboard).toHaveBeenCalledWith(
      'user-1',
      nowMs - (30 * 24 * 60 * 60 * 1000),
      Number.MAX_SAFE_INTEGER,
    );
    expect((component as any).readinessSleepListenerKey).toBe('user-1:current-readiness');

    (component as any).previewTodaySummaryVisibility(false);

    expect((component as any).readinessSleepListenerKey).toBeNull();
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
            { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDistance.type },
            { type: TileTypes.Chart, order: 1, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDuration.type },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDistance.type } as any,
      { type: TileTypes.Chart, order: 1, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDuration.type } as any,
    ];

    mockEventService.getEventsBy.mockClear();
    buildDashboardTileViewModelsSpy.mockClear();
    await component.onTilesDrop({ previousIndex: 0, currentIndex: 1 } as any, 'activityOverview');

    expect(component.user.settings.dashboardSettings.tiles[0].dataType).toBe(DataDuration.type);
    expect(component.user.settings.dashboardSettings.tiles[1].dataType).toBe(DataDistance.type);
    expect(component.user.settings.dashboardSettings.tiles[0].order).toBe(0);
    expect(component.user.settings.dashboardSettings.tiles[1].order).toBe(1);
    expect(component.tiles[0].dataType).toBe(DataDuration.type);
    expect(component.tiles[1].dataType).toBe(DataDistance.type);
    expectDashboardSettingsWrite(component.user, {
      tiles: component.user.settings.dashboardSettings.tiles,
    });
    expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
    expect(buildDashboardTileViewModelsSpy).not.toHaveBeenCalled();

    const previousUser = component.user;
    const echoedUser = JSON.parse(JSON.stringify(previousUser));
    component.user = echoedUser as any;
    mockEventService.getEventsBy.mockClear();
    buildDashboardTileViewModelsSpy.mockClear();

    await component.ngOnChanges({
      user: {
        currentValue: echoedUser,
        previousValue: previousUser,
        firstChange: false,
        isFirstChange: () => false,
      } as any,
    });

    expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
    expect(buildDashboardTileViewModelsSpy).not.toHaveBeenCalled();
  });

  it('should reorder and persist KPI tiles from the drop event without live sort mutation', async () => {
    component.showActions = true;
    component.desktopTileDragEnabled = true;
    component.user = {
      uid: 'user-1',
      settings: {
        dashboardSettings: {
          tiles: [
            { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: DASHBOARD_ACWR_KPI_CHART_TYPE },
            { type: TileTypes.Chart, order: 1, size: { columns: 1, rows: 1 }, chartType: DASHBOARD_RAMP_RATE_KPI_CHART_TYPE },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: DASHBOARD_ACWR_KPI_CHART_TYPE } as any,
      { type: TileTypes.Chart, order: 1, size: { columns: 1, rows: 1 }, chartType: DASHBOARD_RAMP_RATE_KPI_CHART_TYPE } as any,
    ];

    mockEventService.getEventsBy.mockClear();
    buildDashboardTileViewModelsSpy.mockClear();
    await component.onKpiTilesDrop({ previousIndex: 0, currentIndex: 1 } as any);

    expect(component.user.settings.dashboardSettings.tiles[0].chartType).toBe(DASHBOARD_RAMP_RATE_KPI_CHART_TYPE);
    expect(component.user.settings.dashboardSettings.tiles[1].chartType).toBe(DASHBOARD_ACWR_KPI_CHART_TYPE);
    expect(component.user.settings.dashboardSettings.tiles[0].order).toBe(0);
    expect(component.user.settings.dashboardSettings.tiles[1].order).toBe(1);
    expect(component.tiles[0].chartType).toBe(DASHBOARD_RAMP_RATE_KPI_CHART_TYPE);
    expect(component.tiles[1].chartType).toBe(DASHBOARD_ACWR_KPI_CHART_TYPE);
    expectDashboardSettingsWrite(component.user, {
      tiles: component.user.settings.dashboardSettings.tiles,
    });
    expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
    expect(buildDashboardTileViewModelsSpy).not.toHaveBeenCalled();
  });

  it('should remap per-order tile event state after dashboard tile reorder without refetching', async () => {
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
              type: TileTypes.Chart,
              order: 1,
              size: { columns: 1, rows: 1 },
              chartType: ChartTypes.ColumnsVertical,
              dataType: DataDuration.type,
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              eventFilters: { range: '30d', activityTypes: [] },
            },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataAscent.type } as any,
      { type: TileTypes.Chart, order: 1, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDuration.type } as any,
    ];
    (component as any).tileEventsByOrder = {
      0: [{ id: 'old-chart-event' }],
      1: [{ id: 'old-map-event' }],
    };
    component.tileEventLoadingByOrder = {
      0: false,
      1: true,
    };
    const firstSubscription = new Subscription();
    const secondSubscription = new Subscription();
    const firstUnsubscribeSpy = vi.spyOn(firstSubscription, 'unsubscribe');
    const secondUnsubscribeSpy = vi.spyOn(secondSubscription, 'unsubscribe');
    (component as any).tileEventSubscriptions = new Map([
      [0, firstSubscription],
      [1, secondSubscription],
    ]);

    mockEventService.getEventsBy.mockClear();
    await component.onTilesDrop({ previousIndex: 0, currentIndex: 1 } as any, 'activityOverview');

    expect((component as any).tileEventsByOrder).toEqual({
      0: [{ id: 'old-map-event' }],
      1: [{ id: 'old-chart-event' }],
    });
    expect(component.tileEventLoadingByOrder).toEqual({
      0: true,
      1: false,
    });
    expect((component as any).tileEventSubscriptions.get(0)).toBe(secondSubscription);
    expect((component as any).tileEventSubscriptions.get(1)).toBe(firstSubscription);
    expect(firstUnsubscribeSpy).not.toHaveBeenCalled();
    expect(secondUnsubscribeSpy).not.toHaveBeenCalled();
    expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
  });

  it('should keep late tile event emissions aligned with remapped orders after dashboard tile reorder', async () => {
    const firstTileEvents = new Subject<any[]>();
    const secondTileEvents = new Subject<any[]>();
    mockEventService.getEventsBy
      .mockReturnValueOnce(firstTileEvents.asObservable())
      .mockReturnValueOnce(secondTileEvents.asObservable());
    buildDashboardTileViewModelsSpy.mockReturnValue([]);
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
              type: TileTypes.Chart,
              order: 1,
              size: { columns: 1, rows: 1 },
              chartType: ChartTypes.ColumnsVertical,
              dataType: DataDuration.type,
              dataValueType: ChartDataValueTypes.Total,
              dataCategoryType: ChartDataCategoryTypes.DateType,
              eventFilters: { range: '30d', activityTypes: [] },
            },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataAscent.type } as any,
      { type: TileTypes.Chart, order: 1, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDuration.type } as any,
    ];
    (component as any).syncTileEventSubscriptions();
    expect(mockEventService.getEventsBy).toHaveBeenCalledTimes(2);

    mockEventService.getEventsBy.mockClear();
    await component.onTilesDrop({ previousIndex: 0, currentIndex: 1 } as any, 'activityOverview');

    const lateFirstTileEvent = { id: 'late-first-tile-event', isMerge: false };
    const lateSecondTileEvent = { id: 'late-second-tile-event', isMerge: false };
    firstTileEvents.next([lateFirstTileEvent]);
    secondTileEvents.next([lateSecondTileEvent]);
    await Promise.resolve();

    expect((component as any).tileEventsByOrder).toEqual({
      0: [lateSecondTileEvent],
      1: [lateFirstTileEvent],
    });
    expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
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

    await component.onTilesDrop({ previousIndex: 1, currentIndex: 1 } as any, 'activityOverview');

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

    await component.onTilesDrop({ previousIndex: 0, currentIndex: 1 } as any, 'activityOverview');

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
            { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDistance.type },
            { type: TileTypes.Chart, order: 1, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDuration.type },
          ],
        },
      },
    } as any;
    component.tiles = [
      { type: TileTypes.Chart, order: 0, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDistance.type } as any,
      { type: TileTypes.Chart, order: 1, size: { columns: 1, rows: 1 }, chartType: ChartTypes.ColumnsVertical, dataType: DataDuration.type } as any,
    ];

    await component.onTilesDrop({ previousIndex: 0, currentIndex: 1 } as any, 'activityOverview');

    expect(component.user.settings.dashboardSettings.tiles[0].dataType).toBe(DataDistance.type);
    expect(component.user.settings.dashboardSettings.tiles[1].dataType).toBe(DataDuration.type);
    expect(component.tiles[0].dataType).toBe(DataDistance.type);
    expect(component.tiles[1].dataType).toBe(DataDuration.type);
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
