import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataRecoveryTime,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE,
  DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE,
  DASHBOARD_AUTO_TILE_POWER_CURVE_ID,
  DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
  DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID,
  DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID,
  DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_SOURCE,
  DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_SOURCE,
  DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
  buildDashboardSleepTrendAutoTile,
  type DashboardDefaultCuratedChartType,
} from '../helpers/dashboard-auto-tile.helper';
import { getDashboardPowerCurveActivityTypes } from '../helpers/dashboard-power-curve-scope.helper';
import {
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  getDefaultDashboardKpiChartDefinitions,
  getDashboardCuratedChartDefinitions,
} from '../helpers/dashboard-special-chart-types';
import { AppUserInterface } from '../models/app-user.interface';
import { AppEventService } from './app.event.service';
import { AppRouteService } from './app.route.service';
import { AppSleepService } from './app.sleep.service';
import { AppUserService } from './app.user.service';
import { DashboardAutoTileRule, DashboardAutoTileService } from './dashboard-auto-tile.service';
import { LoggerService } from './logger.service';

describe('DashboardAutoTileService', () => {
  let service: DashboardAutoTileService;
  let mockSleepService: { watchHasAnySleepSession: ReturnType<typeof vi.fn> };
  let mockEventService: { watchHasAnyPowerCurveEventForActivityTypes: ReturnType<typeof vi.fn> };
  let mockRouteService: { watchHasAnyRoutePreview: ReturnType<typeof vi.fn> };
  let mockUserService: { updateUserProperties: ReturnType<typeof vi.fn> };
  let mockSnackBar: { open: ReturnType<typeof vi.fn> };
  let mockLogger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  let actionSubject: Subject<void>;

  beforeEach(() => {
    vi.useRealTimers();
    mockSleepService = {
      watchHasAnySleepSession: vi.fn().mockReturnValue(of(false)),
    };
    mockEventService = {
      watchHasAnyPowerCurveEventForActivityTypes: vi.fn().mockReturnValue(of(false)),
    };
    mockRouteService = {
      watchHasAnyRoutePreview: vi.fn().mockReturnValue(of(false)),
    };
    mockUserService = {
      updateUserProperties: vi.fn().mockResolvedValue(true),
    };
    actionSubject = new Subject<void>();
    mockSnackBar = {
      open: vi.fn().mockReturnValue({
        onAction: () => actionSubject.asObservable(),
      }),
    };
    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        DashboardAutoTileService,
        { provide: AppSleepService, useValue: mockSleepService },
        { provide: AppEventService, useValue: mockEventService },
        { provide: AppRouteService, useValue: mockRouteService },
        { provide: AppUserService, useValue: mockUserService },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: LoggerService, useValue: mockLogger },
      ],
    });
    service = TestBed.inject(DashboardAutoTileService);
  });

  it('adds Sleep Trend once when sleep data exists', async () => {
    const user = createUser([createCustomTile(0)]);

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_SLEEP_TREND_ID]: true,
    });

    expect(result.persisted).toBe(true);
    expect(result.addedRules.map(rule => rule.id)).toEqual([DASHBOARD_AUTO_TILE_SLEEP_TREND_ID]);
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(2);
    expect((user.settings?.dashboardSettings?.tiles?.[1] as any).chartType).toBe(DASHBOARD_SLEEP_TREND_CHART_TYPE);
    expect(user.settings?.dashboardSettings?.autoTiles?.sleepTrend?.state).toBe('added');
    expect(user.settings?.dashboardSettings?.autoTiles?.sleepTrend?.source).toBe('sleep-sync');
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expectDashboardSettingsOnlyWrite(mockUserService, user);
    expect(mockSnackBar.open).toHaveBeenCalledWith('Added Sleep chart to your dashboard.', 'Undo', { duration: 7000 });
  });

  it('does not add Sleep Trend when the tile already exists', async () => {
    const user = createUser([buildDashboardSleepTrendAutoTile(0)]);

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_SLEEP_TREND_ID]: true,
    });

    expect(result.persisted).toBe(false);
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(1);
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });

  it('does not add Sleep Trend when it was dismissed', async () => {
    const user = createUser([createCustomTile(0)], {
      sleepTrend: {
        state: 'dismissed',
        dismissedAt: 1_777_000_000_000,
        source: 'sleep-sync',
      },
    });

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_SLEEP_TREND_ID]: true,
    });

    expect(result.persisted).toBe(false);
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(1);
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });

  it('adds Routes map once when route previews exist', async () => {
    const user = createUser([createCustomTile(0)]);

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID]: true,
    });

    expect(result.persisted).toBe(true);
    expect(result.addedRules.map(rule => rule.id)).toEqual([DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID]);
    const routeTile = user.settings?.dashboardSettings?.tiles?.[1] as any;
    expect(routeTile).toMatchObject({
      name: 'Routes',
      type: TileTypes.Map,
      mapSource: 'routes',
      mapStyle: 'default',
      clusterMarkers: false,
      size: { columns: 2, rows: 2 },
    });
    expect(routeTile).not.toHaveProperty('eventFilters');
    expect(user.settings?.dashboardSettings?.autoTiles?.routePreview).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_SOURCE,
    });
    expectDashboardSettingsOnlyWrite(mockUserService, user);
    expect(mockSnackBar.open).toHaveBeenCalledWith('Added Routes map to your dashboard.', 'Undo', { duration: 7000 });
  });

  it('does not add Routes map when a route-preview map already exists', async () => {
    const user = createUser([{
      type: TileTypes.Map,
      order: 0,
      name: 'Routes',
      mapSource: 'routes',
      size: { columns: 2, rows: 2 },
    } as any]);

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID]: true,
    });

    expect(result.persisted).toBe(false);
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(1);
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });

  it('batches multiple eligible rules into one settings write and one snackbar', async () => {
    const user = createUser([createCustomTile(0)]);
    const rules = [
      createRule('first', 'First'),
      createRule('second', 'Second'),
    ];

    const result = await service.applyEligibleAutoTiles(user, {
      first: true,
      second: true,
    }, rules);

    expect(result.persisted).toBe(true);
    expect(user.settings?.dashboardSettings?.tiles?.map(tile => tile.name)).toEqual(['Base', 'First', 'Second']);
    expect((user.settings?.dashboardSettings?.autoTiles as any).first.state).toBe('added');
    expect((user.settings?.dashboardSettings?.autoTiles as any).second.state).toBe('added');
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith('Added 2 dashboard tiles: First, Second.', 'Undo', { duration: 7000 });
  });

  it('adds missing default KPI tiles as one auto-tile batch', async () => {
    const user = createUser([createCustomTile(0)]);
    const eligibility = getDefaultDashboardKpiChartDefinitions().reduce<Record<string, boolean>>((result, definition) => {
      result[DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE[definition.chartType]] = true;
      return result;
    }, {});

    const result = await service.applyEligibleAutoTiles(user, eligibility);

    const kpiDefinitions = getDefaultDashboardKpiChartDefinitions();
    expect(result.persisted).toBe(true);
    expect(result.addedRules.map(rule => rule.id)).toEqual(kpiDefinitions.map(definition => (
      DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE[definition.chartType]
    )));
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(1 + kpiDefinitions.length);
    expect((user.settings?.dashboardSettings?.tiles?.[1] as any).chartType).toBe(DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE);
    expect(user.settings?.dashboardSettings?.autoTiles?.kpiLoadStatus).toMatchObject({
      state: 'added',
      source: 'default-kpi',
    });
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'Added 6 dashboard tiles: Load Status, Form Now, Fitness Trend, and 3 more.',
      'Undo',
      { duration: 7000 },
    );
  });

  it('adds missing default curated tiles as one auto-tile batch', async () => {
    const user = createUser([createCustomTile(0)]);
    const curatedDefinitions = getDashboardCuratedChartDefinitions()
      .filter(definition => (
        definition.chartType !== DASHBOARD_SLEEP_TREND_CHART_TYPE
        && definition.chartType !== DASHBOARD_POWER_CURVE_CHART_TYPE
      ));
    const eligibility = curatedDefinitions.reduce<Record<string, boolean>>((result, definition) => {
      result[DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE[definition.chartType as DashboardDefaultCuratedChartType]] = true;
      return result;
    }, {});

    const result = await service.applyEligibleAutoTiles(user, eligibility);

    expect(result.persisted).toBe(true);
    expect(result.addedRules.map(rule => rule.id)).toEqual(curatedDefinitions.map(definition => (
      DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE[definition.chartType as DashboardDefaultCuratedChartType]
    )));
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(1 + curatedDefinitions.length);
    expect((user.settings?.dashboardSettings?.tiles?.[1] as any).chartType).toBe(DASHBOARD_RECOVERY_NOW_CHART_TYPE);
    expect(user.settings?.dashboardSettings?.autoTiles?.curatedIntensityDistribution).toMatchObject({
      state: 'added',
      source: 'default-curated',
    });
    expect(user.settings?.dashboardSettings?.autoTiles?.powerCurve).toBeUndefined();
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'Added 5 dashboard tiles: Recovery, Form, Freshness Forecast, and 2 more.',
      'Undo',
      { duration: 7000 },
    );
  });

  it('adds Cycling Power Curve with scoped event filters when eligible power data exists', async () => {
    const user = createUser([createCustomTile(0)]);

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_POWER_CURVE_ID]: true,
    });

    expect(result.persisted).toBe(true);
    expect(result.addedRules.map(rule => rule.id)).toEqual([DASHBOARD_AUTO_TILE_POWER_CURVE_ID]);
    const powerCurveTile = user.settings?.dashboardSettings?.tiles?.[1] as any;
    expect(powerCurveTile).toMatchObject({
      name: 'Cycling Power Curve',
      chartType: DASHBOARD_POWER_CURVE_CHART_TYPE,
      eventFilters: {
        range: '1y',
        activityTypes: getDashboardPowerCurveActivityTypes('cycling'),
      },
    });
    expect(user.settings?.dashboardSettings?.autoTiles?.powerCurve).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
    expectDashboardSettingsOnlyWrite(mockUserService, user);
    expect(mockSnackBar.open).toHaveBeenCalledWith('Added Cycling Power Curve chart to your dashboard.', 'Undo', { duration: 7000 });
  });

  it('does not add Recovery when a legacy recovery metric tile already exists', async () => {
    const user = createUser([{
      ...createCustomTile(0),
      name: 'Recovery',
      chartType: ChartTypes.LinesVertical,
      dataType: DataRecoveryTime.type,
    }]);

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID]: true,
    });

    expect(result.persisted).toBe(false);
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(1);
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });

  it('undo removes the whole auto-added batch and marks those rules dismissed', async () => {
    const user = createUser([createCustomTile(0)]);
    const rules = [
      createRule('first', 'First'),
      createRule('second', 'Second'),
    ];
    await service.applyEligibleAutoTiles(user, {
      first: true,
      second: true,
    }, rules);
    mockUserService.updateUserProperties.mockClear();

    actionSubject.next();
    await flushMicrotasks();

    expect(user.settings?.dashboardSettings?.tiles?.map(tile => tile.name)).toEqual(['Base']);
    expect(user.settings?.dashboardSettings?.tiles?.[0].order).toBe(0);
    expect((user.settings?.dashboardSettings?.autoTiles as any).first.state).toBe('dismissed');
    expect((user.settings?.dashboardSettings?.autoTiles as any).second.state).toBe('dismissed');
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expectDashboardSettingsOnlyWrite(mockUserService, user);
  });

  it('undo dismisses auto-added Recovery through both auto-tile state and the legacy recovery flag', async () => {
    const user = createUser([createCustomTile(0)]);
    await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID]: true,
    });
    expect(user.settings?.dashboardSettings?.dismissedCuratedRecoveryNowTile).toBe(false);
    mockUserService.updateUserProperties.mockClear();

    actionSubject.next();
    await flushMicrotasks();

    expect(user.settings?.dashboardSettings?.tiles?.map(tile => tile.name)).toEqual(['Base']);
    expect(user.settings?.dashboardSettings?.autoTiles?.curatedRecoveryNow).toMatchObject({
      state: 'dismissed',
      source: 'default-curated',
    });
    expect(user.settings?.dashboardSettings?.dismissedCuratedRecoveryNowTile).toBe(true);
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
  });

  it('rolls back in-memory settings when persistence fails', async () => {
    const user = createUser([createCustomTile(0)]);
    mockUserService.updateUserProperties.mockRejectedValueOnce(new Error('failed'));

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_SLEEP_TREND_ID]: true,
    });

    expect(result.persisted).toBe(false);
    expect(user.settings?.dashboardSettings?.tiles?.map(tile => tile.name)).toEqual(['Base']);
    expect(user.settings?.dashboardSettings?.autoTiles).toEqual({});
    expect(mockSnackBar.open).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('rolls back the legacy recovery flag when a default curated add fails', async () => {
    const user = createUser([createCustomTile(0)]);
    user.settings!.dashboardSettings!.dismissedCuratedRecoveryNowTile = true;
    mockUserService.updateUserProperties.mockRejectedValueOnce(new Error('failed'));

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID]: true,
    });

    expect(result.persisted).toBe(false);
    expect(user.settings?.dashboardSettings?.tiles?.map(tile => tile.name)).toEqual(['Base']);
    expect(user.settings?.dashboardSettings?.autoTiles).toEqual({});
    expect(user.settings?.dashboardSettings?.dismissedCuratedRecoveryNowTile).toBe(true);
  });

  it('preserves nested tile event filters when rolling back a failed add', async () => {
    const baseTile = createCustomTile(0) as TileSettingsInterface & { eventFilters?: { range: string; activityTypes: unknown[] } };
    baseTile.eventFilters = { range: '30d', activityTypes: [] };
    const user = createUser([baseTile]);
    mockUserService.updateUserProperties.mockRejectedValueOnce(new Error('failed'));

    await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_SLEEP_TREND_ID]: true,
    });

    expect((user.settings?.dashboardSettings?.tiles?.[0] as any).eventFilters).toEqual({
      range: '30d',
      activityTypes: [],
    });
  });

  it('watches eligibility and applies Sleep Trend plus default KPI rules together', async () => {
    const sleepEligibility = new Subject<boolean>();
    mockSleepService.watchHasAnySleepSession.mockReturnValueOnce(sleepEligibility.asObservable());
    const user = createUser([createCustomTile(0)]);

    const subscription = service.watchForDashboard(user);
    sleepEligibility.next(true);
    await flushMicrotasks();

    expect(mockSleepService.watchHasAnySleepSession).toHaveBeenCalledWith('user-1');
    expect(mockEventService.watchHasAnyPowerCurveEventForActivityTypes).toHaveBeenCalledWith(
      'user-1',
      getDashboardPowerCurveActivityTypes('cycling'),
    );
    expect(mockEventService.watchHasAnyPowerCurveEventForActivityTypes).toHaveBeenCalledWith(
      'user-1',
      getDashboardPowerCurveActivityTypes('running'),
    );
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(13);
    expect((user.settings?.dashboardSettings?.tiles?.[1] as any).chartType).toBe(DASHBOARD_SLEEP_TREND_CHART_TYPE);
    expect((user.settings?.dashboardSettings?.tiles?.[2] as any).chartType).toBe(DASHBOARD_RECOVERY_NOW_CHART_TYPE);
    expect((user.settings?.dashboardSettings?.tiles?.[5] as any).chartType).toBe(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE);
    expect((user.settings?.dashboardSettings?.tiles?.[7] as any).chartType).toBe(DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE);
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'Added 12 dashboard tiles: Sleep, Recovery, Form, and 9 more.',
      'Undo',
      { duration: 7000 },
    );
    subscription.unsubscribe();
  });

  it('applies default curated and KPI rules without waiting for sleep eligibility to emit', async () => {
    const sleepEligibility = new Subject<boolean>();
    mockSleepService.watchHasAnySleepSession.mockReturnValueOnce(sleepEligibility.asObservable());
    const user = createUser([createCustomTile(0)]);

    const subscription = service.watchForDashboard(user);
    await flushMicrotasks();

    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(12);
    expect(user.settings?.dashboardSettings?.tiles?.some(tile => (
      (tile as any).chartType === DASHBOARD_SLEEP_TREND_CHART_TYPE
    ))).toBe(false);
    expect(user.settings?.dashboardSettings?.tiles?.some(tile => (
      (tile as any).chartType === DASHBOARD_POWER_CURVE_CHART_TYPE
    ))).toBe(false);
    expect((user.settings?.dashboardSettings?.tiles?.[1] as any).chartType).toBe(DASHBOARD_RECOVERY_NOW_CHART_TYPE);
    expect((user.settings?.dashboardSettings?.tiles?.[4] as any).chartType).toBe(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE);
    expect((user.settings?.dashboardSettings?.tiles?.[6] as any).chartType).toBe(DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE);
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'Added 11 dashboard tiles: Recovery, Form, Freshness Forecast, and 8 more.',
      'Undo',
      { duration: 7000 },
    );
    subscription.unsubscribe();
  });

  it('adds Cycling Power Curve from the scoped eligibility watcher after cycling power data qualifies', async () => {
    const sleepEligibility = new Subject<boolean>();
    const cyclingPowerCurveEligibility = new Subject<boolean>();
    mockSleepService.watchHasAnySleepSession.mockReturnValueOnce(sleepEligibility.asObservable());
    mockEventService.watchHasAnyPowerCurveEventForActivityTypes
      .mockReturnValueOnce(cyclingPowerCurveEligibility.asObservable())
      .mockReturnValueOnce(of(false));
    const user = createUser([createCustomTile(0)]);

    const subscription = service.watchForDashboard(user);
    await flushMicrotasks();
    mockUserService.updateUserProperties.mockClear();
    mockSnackBar.open.mockClear();

    cyclingPowerCurveEligibility.next(true);
    await flushMicrotasks();

    expect(mockEventService.watchHasAnyPowerCurveEventForActivityTypes).toHaveBeenNthCalledWith(
      1,
      'user-1',
      getDashboardPowerCurveActivityTypes('cycling'),
    );
    const powerCurveTile = user.settings?.dashboardSettings?.tiles?.find(tile => (
      (tile as any).chartType === DASHBOARD_POWER_CURVE_CHART_TYPE
    )) as any;
    expect(powerCurveTile).toMatchObject({
      name: 'Cycling Power Curve',
      eventFilters: {
        range: '1y',
        activityTypes: getDashboardPowerCurveActivityTypes('cycling'),
      },
    });
    expect(user.settings?.dashboardSettings?.autoTiles?.powerCurve).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith('Added Cycling Power Curve chart to your dashboard.', 'Undo', { duration: 7000 });
    subscription.unsubscribe();
  });

  it('adds Routes map from the route preview eligibility watcher', async () => {
    const sleepEligibility = new Subject<boolean>();
    const routePreviewEligibility = new Subject<boolean>();
    mockSleepService.watchHasAnySleepSession.mockReturnValueOnce(sleepEligibility.asObservable());
    mockRouteService.watchHasAnyRoutePreview.mockReturnValueOnce(routePreviewEligibility.asObservable());
    const user = createUser([createCustomTile(0)]);

    const subscription = service.watchForDashboard(user);
    await flushMicrotasks();
    mockUserService.updateUserProperties.mockClear();
    mockSnackBar.open.mockClear();

    routePreviewEligibility.next(true);
    await flushMicrotasks();

    expect(mockRouteService.watchHasAnyRoutePreview).toHaveBeenCalledWith('user-1');
    const routeTile = user.settings?.dashboardSettings?.tiles?.find(tile => (
      tile.type === TileTypes.Map && (tile as any).mapSource === 'routes'
    )) as any;
    expect(routeTile).toMatchObject({
      name: 'Routes',
      size: { columns: 2, rows: 2 },
      clusterMarkers: false,
    });
    expect(user.settings?.dashboardSettings?.autoTiles?.routePreview).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_SOURCE,
    });
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith('Added Routes map to your dashboard.', 'Undo', { duration: 7000 });
    subscription.unsubscribe();
  });

  it('adds Running Power Curve independently from Cycling Power Curve', async () => {
    const sleepEligibility = new Subject<boolean>();
    const runningPowerCurveEligibility = new Subject<boolean>();
    mockSleepService.watchHasAnySleepSession.mockReturnValueOnce(sleepEligibility.asObservable());
    mockEventService.watchHasAnyPowerCurveEventForActivityTypes
      .mockReturnValueOnce(of(false))
      .mockReturnValueOnce(runningPowerCurveEligibility.asObservable());
    const user = createUser([createCustomTile(0)], {
      [DASHBOARD_AUTO_TILE_POWER_CURVE_ID]: {
        state: 'dismissed',
        source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
      },
    });

    const subscription = service.watchForDashboard(user);
    await flushMicrotasks();
    mockUserService.updateUserProperties.mockClear();
    mockSnackBar.open.mockClear();

    runningPowerCurveEligibility.next(true);
    await flushMicrotasks();

    const powerCurveTile = user.settings?.dashboardSettings?.tiles?.find(tile => (
      (tile as any).chartType === DASHBOARD_POWER_CURVE_CHART_TYPE
    )) as any;
    expect(powerCurveTile).toMatchObject({
      name: 'Running Power Curve',
      eventFilters: {
        range: '1y',
        activityTypes: getDashboardPowerCurveActivityTypes('running'),
      },
    });
    expect(user.settings?.dashboardSettings?.autoTiles?.runningPowerCurve).toMatchObject({
      state: 'added',
      source: DASHBOARD_AUTO_TILE_RUNNING_POWER_CURVE_SOURCE,
    });
    expect(user.settings?.dashboardSettings?.autoTiles?.powerCurve).toMatchObject({
      state: 'dismissed',
      source: DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
    });
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith('Added Running Power Curve chart to your dashboard.', 'Undo', { duration: 7000 });
    subscription.unsubscribe();
  });

  it('respects the legacy Recovery dismissal while still applying other default curated and KPI rules', async () => {
    const sleepEligibility = new Subject<boolean>();
    mockSleepService.watchHasAnySleepSession.mockReturnValueOnce(sleepEligibility.asObservable());
    const user = createUser([createCustomTile(0)]);
    user.settings!.dashboardSettings!.dismissedCuratedRecoveryNowTile = true;

    const subscription = service.watchForDashboard(user);
    await flushMicrotasks();

    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(11);
    expect(user.settings?.dashboardSettings?.tiles?.some(tile => (
      (tile as any).chartType === DASHBOARD_RECOVERY_NOW_CHART_TYPE
    ))).toBe(false);
    expect((user.settings?.dashboardSettings?.tiles?.[1] as any).name).toBe('Form');
    expect((user.settings?.dashboardSettings?.tiles?.[3] as any).chartType).toBe(DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE);
    expect(user.settings?.dashboardSettings?.autoTiles?.curatedRecoveryNow).toBeUndefined();
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'Added 10 dashboard tiles: Form, Freshness Forecast, Intensity Distribution, and 7 more.',
      'Undo',
      { duration: 7000 },
    );
    subscription.unsubscribe();
  });

  it('does not apply a scheduled auto-tile batch after the watcher is unsubscribed', async () => {
    const sleepEligibility = new Subject<boolean>();
    mockSleepService.watchHasAnySleepSession.mockReturnValueOnce(sleepEligibility.asObservable());
    const user = createUser([createCustomTile(0)]);

    const subscription = service.watchForDashboard(user);
    subscription.unsubscribe();
    await flushMicrotasks();

    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(1);
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });

  it('replays the latest eligibility when an auto-tile write is already in flight', async () => {
    const user = createUser([createCustomTile(0)]);
    const kpiEligibility = getDefaultDashboardKpiChartDefinitions().reduce<Record<string, boolean>>((result, definition) => {
      result[DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE[definition.chartType]] = true;
      return result;
    }, {});
    let resolveFirstWrite: ((value: unknown) => void) | null = null;
    mockUserService.updateUserProperties
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveFirstWrite = resolve;
      }))
      .mockResolvedValue(true);

    const firstApply = service.applyEligibleAutoTiles(user, kpiEligibility);
    const queuedApplyResult = await service.applyEligibleAutoTiles(user, {
      ...kpiEligibility,
      [DASHBOARD_AUTO_TILE_SLEEP_TREND_ID]: true,
    });

    expect(queuedApplyResult.persisted).toBe(false);
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);

    resolveFirstWrite?.(true);
    await firstApply;
    await flushMicrotasks();

    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(2);
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(8);
    expect(user.settings?.dashboardSettings?.tiles?.some(tile => (
      (tile as any).chartType === DASHBOARD_SLEEP_TREND_CHART_TYPE
    ))).toBe(true);
    expect(user.settings?.dashboardSettings?.autoTiles?.sleepTrend).toMatchObject({
      state: 'added',
      source: 'sleep-sync',
    });
  });

  it('still applies default KPI rules when sleep eligibility watch fails', async () => {
    mockSleepService.watchHasAnySleepSession.mockReturnValueOnce(throwError(() => new Error('watch failed')));
    const user = createUser([createCustomTile(0)]);

    service.watchForDashboard(user);
    await flushMicrotasks();

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(12);
    expect(mockUserService.updateUserProperties).toHaveBeenCalledTimes(1);
  });
});

function createUser(
  tiles: TileSettingsInterface[],
  autoTiles: Record<string, any> = {},
): AppUserInterface {
  return {
    uid: 'user-1',
    settings: {
      appSettings: { theme: 'dark' } as any,
      unitSettings: { startOfTheWeek: 1 } as any,
      dashboardSettings: {
        tiles,
        autoTiles,
      },
    },
  } as AppUserInterface;
}

function expectDashboardSettingsOnlyWrite(
  mockUserService: { updateUserProperties: ReturnType<typeof vi.fn> },
  user: AppUserInterface,
): void {
  const calls = mockUserService.updateUserProperties.mock.calls;
  const dashboardSettings = user.settings?.dashboardSettings;
  const dashboardSettingsPatch: Record<string, unknown> = {
    tiles: dashboardSettings?.tiles || [],
    autoTiles: dashboardSettings?.autoTiles || {},
  };
  if (dashboardSettings?.dismissedCuratedRecoveryNowTile !== undefined) {
    dashboardSettingsPatch.dismissedCuratedRecoveryNowTile = dashboardSettings.dismissedCuratedRecoveryNowTile;
  }
  const settingsPayload = calls[calls.length - 1][1].settings;
  expect(settingsPayload).toEqual({
    dashboardSettings: dashboardSettingsPatch,
  });
  expect(settingsPayload.appSettings).toBeUndefined();
  expect(settingsPayload.unitSettings).toBeUndefined();
}

function createCustomTile(order: number): TileSettingsInterface {
  return {
    name: 'Base',
    type: TileTypes.Chart,
    order,
    size: { columns: 1, rows: 1 },
    chartType: ChartTypes.ColumnsVertical,
    dataType: 'Distance',
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Daily,
  } as TileSettingsInterface;
}

function createRule(id: string, label: string): DashboardAutoTileRule {
  return {
    id,
    label,
    source: 'test',
    qualifies: (eligibility) => eligibility[id] === true,
    isPresent: (tiles) => tiles.some(tile => tile.name === label),
    createTile: (order) => ({
      name: label,
      type: TileTypes.Chart,
      order,
      size: { columns: 1, rows: 1 },
      chartType: ChartTypes.ColumnsVertical,
      dataType: label,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Daily,
    } as TileSettingsInterface),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
