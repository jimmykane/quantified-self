import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataDistance,
  TileTypes,
  TimeIntervals,
  type TileSettingsInterface,
} from '@sports-alliance/sports-lib';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_ID,
  DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_SOURCE,
  DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID,
  DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_SOURCE,
} from '../helpers/dashboard-auto-tile.helper';
import { buildDashboardActivityCalendarTile } from '../helpers/dashboard-activity-calendar.helper';
import { DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE } from '../helpers/dashboard-special-chart-types';
import type { AppUserInterface } from '../models/app-user.interface';
import { AppRouteService } from './app.route.service';
import { AppUserService } from './app.user.service';
import {
  DASHBOARD_AUTO_TILE_RULES,
  DashboardAutoTileService,
  type DashboardAutoTileRule,
} from './dashboard-auto-tile.service';
import { LoggerService } from './logger.service';

describe('DashboardAutoTileService', () => {
  let service: DashboardAutoTileService;
  let routeEligibility$: Subject<boolean>;
  let mockRouteService: { watchHasAnyRoutePreview: ReturnType<typeof vi.fn> };
  let mockUserService: { updateUserProperties: ReturnType<typeof vi.fn> };
  let mockSnackBar: { open: ReturnType<typeof vi.fn> };
  let mockLogger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  let undo$: Subject<void>;

  beforeEach(() => {
    routeEligibility$ = new Subject<boolean>();
    undo$ = new Subject<void>();
    mockRouteService = { watchHasAnyRoutePreview: vi.fn(() => routeEligibility$.asObservable()) };
    mockUserService = { updateUserProperties: vi.fn().mockResolvedValue(true) };
    mockSnackBar = { open: vi.fn(() => ({ onAction: () => undo$.asObservable() })) };
    mockLogger = { error: vi.fn(), warn: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        DashboardAutoTileService,
        { provide: AppRouteService, useValue: mockRouteService },
        { provide: AppUserService, useValue: mockUserService },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: LoggerService, useValue: mockLogger },
      ],
    });
    service = TestBed.inject(DashboardAutoTileService);
  });

  it('keeps the default automatic rule set limited to Calendar and route previews', () => {
    expect(DASHBOARD_AUTO_TILE_RULES.map(rule => rule.id)).toEqual([
      DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_ID,
      DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID,
    ]);
  });

  it('adds the Activity Calendar once to an existing dashboard', async () => {
    const user = createUser([makeDistanceTile(3)]);

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_ID]: true,
    });

    expect(result.persisted).toBe(true);
    expect(result.addedRules.map(rule => rule.id)).toEqual([DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_ID]);
    expect(user.settings?.dashboardSettings?.tiles).toMatchObject([
      { name: 'Distance', order: 3 },
      {
        name: 'Activity calendar',
        order: 4,
        type: TileTypes.Chart,
        chartType: DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE,
        size: { columns: 1, rows: 1 },
      },
    ]);
    expect(user.settings?.dashboardSettings?.autoTiles?.activityCalendar).toMatchObject({
      state: 'added', source: DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_SOURCE,
    });
    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'Added Activity Calendar tile to your dashboard.',
      'Undo',
      { duration: 7000 },
    );
  });

  it('does not duplicate the Activity Calendar already present on a default dashboard', async () => {
    const user = createUser([buildDashboardActivityCalendarTile(0)]);

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_ID]: true,
    });

    expect(result).toEqual({ addedRules: [], persisted: false });
    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(1);
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
  });

  it('does not restore an Activity Calendar that the user dismissed', async () => {
    const user = createUser();
    user.settings!.dashboardSettings!.autoTiles = {
      activityCalendar: {
        state: 'dismissed',
        dismissedAt: 1_777_000_000_000,
        source: DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_SOURCE,
      },
    };

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_ID]: true,
    });

    expect(result).toEqual({ addedRules: [], persisted: false });
    expect(user.settings?.dashboardSettings?.tiles).toEqual([]);
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
  });

  it('adds a route-preview map once when route previews qualify', async () => {
    const user = createUser();

    const result = await service.applyEligibleAutoTiles(user, {
      [DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID]: true,
    });

    expect(result.persisted).toBe(true);
    expect(result.addedRules.map(rule => rule.id)).toEqual([DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID]);
    expect(user.settings?.dashboardSettings?.tiles).toMatchObject([{
      name: 'Routes', type: TileTypes.Map, mapSource: 'routes', size: { columns: 2, rows: 1 },
    }]);
    expect(user.settings?.dashboardSettings?.autoTiles?.routePreview).toMatchObject({
      state: 'added', source: DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_SOURCE,
    });
  });

  it('does not auto-add a KPI, curated chart, sleep, or power curve from unrelated eligibility', async () => {
    const user = createUser();

    const result = await service.applyEligibleAutoTiles(user, {
      kpiLoadStatus: true,
      curatedForm: true,
      sleepTrend: true,
      powerCurve: true,
    });

    expect(result).toEqual({ addedRules: [], persisted: false });
    expect(user.settings?.dashboardSettings?.tiles).toEqual([]);
    expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
  });

  it('watches route-preview eligibility without starting unrelated dashboard watchers', async () => {
    const user = createUser();
    const subscription = service.watchForDashboard(user);

    expect(mockRouteService.watchHasAnyRoutePreview).toHaveBeenCalledWith('user-1');
    routeEligibility$.next(true);
    await flushMicrotasks();

    expect(user.settings?.dashboardSettings?.tiles).toHaveLength(2);
    expect(`${(user.settings?.dashboardSettings?.tiles?.[0] as { chartType?: string }).chartType}`)
      .toBe(DASHBOARD_ACTIVITY_CALENDAR_CHART_TYPE);
    expect((user.settings?.dashboardSettings?.tiles?.[1] as { mapSource?: string }).mapSource).toBe('routes');
    subscription.unsubscribe();
  });

  it('undoes an Activity Calendar migration and keeps it dismissed', async () => {
    const user = createUser();
    await service.applyEligibleAutoTiles(user, { [DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_ID]: true });

    undo$.next();
    await flushMicrotasks();

    expect(user.settings?.dashboardSettings?.tiles).toEqual([]);
    expect(user.settings?.dashboardSettings?.autoTiles?.activityCalendar).toMatchObject({
      state: 'dismissed', source: DASHBOARD_AUTO_TILE_ACTIVITY_CALENDAR_SOURCE,
    });
  });

  it('undoes a route-preview auto tile by dismissing only that explicit suggestion', async () => {
    const user = createUser();
    await service.applyEligibleAutoTiles(user, { [DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID]: true });

    undo$.next();
    await flushMicrotasks();

    expect(user.settings?.dashboardSettings?.tiles).toEqual([]);
    expect(user.settings?.dashboardSettings?.autoTiles?.routePreview).toMatchObject({ state: 'dismissed' });
  });

  it('rolls back a route-preview addition when persistence fails', async () => {
    mockUserService.updateUserProperties.mockRejectedValueOnce(new Error('write failed'));
    const user = createUser();

    const result = await service.applyEligibleAutoTiles(user, { [DASHBOARD_AUTO_TILE_ROUTE_PREVIEW_ID]: true });

    expect(result).toEqual({ addedRules: [], persisted: false });
    expect(user.settings?.dashboardSettings?.tiles).toEqual([]);
    expect(user.settings?.dashboardSettings?.autoTiles).toEqual({});
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('still supports an explicitly supplied manual rule for reusable service behavior', async () => {
    const customRule: DashboardAutoTileRule = {
      id: 'manual-rule', label: 'Manual', source: 'test',
      qualifies: eligibility => eligibility['manual-rule'] === true,
      isPresent: tiles => tiles.some(tile => tile.name === 'Manual'),
      createTile: order => ({
        name: 'Manual', order, type: TileTypes.Chart, chartType: ChartTypes.ColumnsVertical,
        dataType: DataDistance.type, dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType, dataTimeInterval: TimeIntervals.Daily,
        size: { columns: 1, rows: 1 },
      }),
    };
    const user = createUser();

    const result = await service.applyEligibleAutoTiles(user, { 'manual-rule': true }, [customRule]);

    expect(result.persisted).toBe(true);
    expect(user.settings?.dashboardSettings?.tiles?.[0]?.name).toBe('Manual');
  });
});

function createUser(tiles: TileSettingsInterface[] = []): AppUserInterface {
  return {
    uid: 'user-1',
    settings: { dashboardSettings: { tiles, autoTiles: {} } },
  } as AppUserInterface;
}

function makeDistanceTile(order: number): TileSettingsInterface {
  return {
    name: 'Distance',
    order,
    type: TileTypes.Chart,
    chartType: ChartTypes.ColumnsVertical,
    dataType: DataDistance.type,
    dataValueType: ChartDataValueTypes.Total,
    dataCategoryType: ChartDataCategoryTypes.DateType,
    dataTimeInterval: TimeIntervals.Daily,
    size: { columns: 1, rows: 1 },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
