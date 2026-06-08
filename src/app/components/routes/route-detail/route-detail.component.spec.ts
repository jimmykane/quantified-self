import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataDistance, RouteFileInterface, RouteInterface, User, AppThemes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { RouteResolverData } from '../../../resolvers/route.resolver';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppRouteService } from '../../../services/app.route.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { LoggerService } from '../../../services/logger.service';
import { RouteNameDialogComponent } from '../route-name-dialog/route-name-dialog.component';
import { RouteDetailComponent } from './route-detail.component';

describe('RouteDetailComponent', () => {
  let component: RouteDetailComponent;
  let routeServiceMock: any;
  let fileServiceMock: any;
  let analyticsServiceMock: any;
  let dialogMock: any;
  let snackBarMock: any;
  let routerMock: any;
  let loggerMock: any;

  const routeDocument: FirestoreRouteJSON = {
    id: 'route-1',
    userID: 'user-1',
    name: 'Detail Route',
    srcFileType: 'gpx',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    routes: [{
      id: 'segment-1',
      name: 'Stored Segment',
      activityType: 'Running',
      pointCount: 2,
      streamTypes: [],
      stats: {
        [DataDistance.type]: 1000,
      },
    }],
    routeCount: 1,
    waypointCount: 0,
    pointCount: 2,
    activityTypes: ['Running'],
    streamTypes: [],
    originalFiles: [{
      path: 'users/user-1/routes/route-1/original.gpx',
      extension: 'gpx',
    }],
  };

  beforeEach(async () => {
    const parsedRoute = {
      name: 'Parsed Segment',
      activityType: 'Running',
      getID: vi.fn(() => 'segment-1'),
      getPointCount: vi.fn(() => 2),
      getSquashedPositionData: vi.fn(() => [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ]),
      getStat: vi.fn((type: string) => type === DataDistance.type ? { getValue: () => 1200 } : undefined),
    } as unknown as RouteInterface;
    const routeFile = {
      name: 'Parsed Route File',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      getRoutes: vi.fn(() => [parsedRoute]),
      getWaypoints: vi.fn(() => []),
    } as unknown as RouteFileInterface;
    const resolvedData: RouteResolverData = {
      routeDocument,
      routeFile,
      sourceFile: routeDocument.originalFiles![0],
      user: new User('user-1'),
    };
    routeServiceMock = {
      getOriginalRouteFiles: vi.fn((route: FirestoreRouteJSON) => route.originalFiles || []),
      downloadFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      updateRouteName: vi.fn().mockResolvedValue(undefined),
      deleteRoute: vi.fn().mockResolvedValue(undefined),
    };
    fileServiceMock = {
      getExtensionFromPath: vi.fn().mockReturnValue('gpx'),
      toDate: vi.fn((value: unknown) => value instanceof Date ? value : null),
      generateDateBasedFilename: vi.fn().mockReturnValue('route.gpx'),
      downloadFile: vi.fn(),
      downloadAsZip: vi.fn().mockResolvedValue(undefined),
    };
    analyticsServiceMock = {
      logSavedRouteAction: vi.fn(),
    };
    dialogMock = {
      open: vi.fn().mockReturnValue({ afterClosed: () => of(true) }),
    };
    snackBarMock = {
      open: vi.fn(),
    };
    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
    };
    loggerMock = {
      error: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [RouteDetailComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { data: of({ route: resolvedData }) } },
        { provide: AppRouteService, useValue: routeServiceMock },
        { provide: AppFileService, useValue: fileServiceMock },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: Router, useValue: routerMock },
        { provide: LoggerService, useValue: loggerMock },
        { provide: AppUserSettingsQueryService, useValue: { unitSettings: () => null } },
        { provide: AppThemeService, useValue: { appTheme: () => AppThemes.Normal } },
      ],
    });
    TestBed.overrideComponent(RouteDetailComponent, {
      set: { template: '' },
    });
    await TestBed.compileComponents();
    component = TestBed.createComponent(RouteDetailComponent).componentInstance;
    (component as any).dialog = dialogMock;
    (component as any).snackBar = snackBarMock;
    (component as any).router = routerMock;
  });

  it('initializes from resolved route data with all segments selected by default', () => {
    expect(component.routeName()).toBe('Detail Route');
    expect(component.segments()).toHaveLength(1);
    expect(component.segments()[0].id).toBe('segment-1');
    expect(component.selectedSegmentIDs()).toEqual(['segment-1']);
    expect(component.selectedSegments()).toHaveLength(1);
    expect(component.summaryMetrics().find(metric => metric.label === 'Points')?.value).toBe('2');
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('open_details', {
      fileType: 'gpx',
      fileCount: 1,
    });
  });

  it('keeps a single-segment route visible when toggling segment table visibility', () => {
    component.onSegmentVisibilityChange('segment-1', false);
    expect(component.selectedSegmentIDs()).toEqual(['segment-1']);
    expect(component.selectedSegments().map(segment => segment.id)).toEqual(['segment-1']);
  });

  it('only exposes the segment table affordance when a route has multiple segments', () => {
    expect(component.hasMultipleSegments()).toBe(false);

    component.routeDocument.set({
      ...routeDocument,
      routes: [
        routeDocument.routes[0],
        {
          id: 'segment-2',
          name: 'Stored Segment 2',
          activityType: 'Running',
          pointCount: 2,
          streamTypes: [],
          stats: {},
        },
      ],
    });
    component.routeFile.set({
      getRoutes: vi.fn(() => [
        createParsedRoute('segment-1', 'First Segment', 0),
        createParsedRoute('segment-2', 'Second Segment', 1),
      ]),
      getWaypoints: vi.fn(() => []),
    } as unknown as RouteFileInterface);

    expect(component.hasMultipleSegments()).toBe(true);
  });

  it('updates visible segments from the segment table without allowing an empty map', () => {
    const firstRoute = createParsedRoute('segment-1', 'First Segment', 0);
    const secondRoute = createParsedRoute('segment-2', 'Second Segment', 1);
    component.routeDocument.set({
      ...routeDocument,
      routes: [
        routeDocument.routes[0],
        {
          id: 'segment-2',
          name: 'Stored Segment 2',
          activityType: 'Running',
          pointCount: 2,
          streamTypes: [],
          stats: {},
        },
      ],
    });
    component.routeFile.set({
      getRoutes: vi.fn(() => [firstRoute, secondRoute]),
      getWaypoints: vi.fn(() => []),
    } as unknown as RouteFileInterface);
    component.selectedSegmentIDs.set(['segment-1', 'segment-2']);

    component.onSegmentVisibilityChange('segment-1', false);
    expect(component.selectedSegmentIDs()).toEqual(['segment-2']);
    expect(component.segmentSelectionLabel()).toBe('1/2 visible');

    component.onSegmentVisibilityChange('segment-2', false);
    expect(component.selectedSegmentIDs()).toEqual(['segment-2']);

    component.onSegmentVisibilityChange('segment-1', true);
    expect(component.selectedSegmentIDs()).toEqual(['segment-1', 'segment-2']);
    expect(component.allSegmentsSelected()).toBe(true);
  });

  it('filters waypoint details with the selected original route segments', () => {
    const firstRoute = createParsedRoute('segment-1', 'First Segment', 0);
    const secondRoute = createParsedRoute('segment-2', 'Second Segment', 1);
    component.routeDocument.set({
      ...routeDocument,
      routes: [
        routeDocument.routes[0],
        {
          id: 'segment-2',
          name: 'Stored Segment 2',
          activityType: 'Running',
          pointCount: 2,
          streamTypes: [],
          stats: {},
        },
      ],
    });
    component.routeFile.set({
      getRoutes: vi.fn(() => [firstRoute, secondRoute]),
      getWaypoints: vi.fn(() => [
        createWaypoint('First waypoint', 0),
        createWaypoint('Second waypoint', 1),
        createWaypoint('Global waypoint', null),
      ]),
    } as unknown as RouteFileInterface);
    component.selectedSegmentIDs.set(['segment-2']);

    expect(component.selectedSegments().map(segment => segment.id)).toEqual(['segment-2']);
    expect(component.selectedWaypoints().map(waypoint => waypoint.name)).toEqual([
      'Second waypoint',
      'Global waypoint',
    ]);
    expect(component.waypointDisplayViews().map(waypoint => waypoint.segmentLabel)).toEqual([
      'Second Segment',
      'Global',
    ]);
  });

  it('renames the owner route from the detail page action', async () => {
    dialogMock.open.mockReturnValueOnce({ afterClosed: () => of('  New   Route Name  ') });

    await component.renameRoute();

    expect(dialogMock.open).toHaveBeenCalledWith(RouteNameDialogComponent, expect.objectContaining({
      width: '420px',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        currentName: 'Detail Route',
      },
    }));
    expect(routeServiceMock.updateRouteName).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      'route-1',
      'New Route Name',
    );
    expect(component.routeName()).toBe('New Route Name');
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('rename', {
      status: 'success',
      fileType: 'gpx',
    });
    expect(snackBarMock.open).toHaveBeenCalledWith('Route name saved.', undefined, { duration: 2500 });
  });

  it('rolls back the visible route name when saving a rename fails', async () => {
    dialogMock.open.mockReturnValueOnce({ afterClosed: () => of('Broken Rename') });
    routeServiceMock.updateRouteName.mockRejectedValueOnce(new Error('write failed'));

    await component.renameRoute();

    expect(routeServiceMock.updateRouteName).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      'route-1',
      'Broken Rename',
    );
    expect(component.routeName()).toBe('Detail Route');
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('rename', {
      status: 'failure',
      fileType: 'gpx',
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[RouteDetailComponent] Failed to rename route',
      { routeID: 'route-1' },
      expect.any(Error),
    );
    expect(snackBarMock.open).toHaveBeenCalledWith('Failed to save route name.', undefined, { duration: 3000 });
  });

  it('downloads the original route file from the detail page action', async () => {
    await component.downloadRouteOriginals();

    expect(routeServiceMock.downloadFile).toHaveBeenCalledWith('users/user-1/routes/route-1/original.gpx');
    expect(fileServiceMock.downloadFile).toHaveBeenCalled();
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('download', {
      status: 'success',
      fileCount: 1,
      fileType: 'gpx',
      zipped: false,
    });
  });

  it('does not rename, download, or delete when the resolved user is not the route owner', async () => {
    component.user.set(new User('other-user'));
    dialogMock.open.mockClear();
    routeServiceMock.updateRouteName.mockClear();
    routeServiceMock.downloadFile.mockClear();
    routeServiceMock.deleteRoute.mockClear();

    await component.renameRoute();
    await component.downloadRouteOriginals();
    await component.confirmDeleteRoute();

    expect(routeServiceMock.updateRouteName).not.toHaveBeenCalled();
    expect(routeServiceMock.downloadFile).not.toHaveBeenCalled();
    expect(dialogMock.open).not.toHaveBeenCalled();
    expect(routeServiceMock.deleteRoute).not.toHaveBeenCalled();
  });

  it('orders route detail sections as map, charts, segments, then waypoints', () => {
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/components/routes/route-detail/route-detail.component.html'),
      'utf8',
    );

    const mapIndex = template.indexOf('<app-route-map');
    const chartsIndex = template.indexOf('<app-route-chart');
    const segmentsIndex = template.indexOf('id="route-segments-heading"');
    const waypointsIndex = template.indexOf('id="route-waypoints-heading"');

    expect(mapIndex).toBeGreaterThan(-1);
    expect(chartsIndex).toBeGreaterThan(mapIndex);
    expect(segmentsIndex).toBeGreaterThan(chartsIndex);
    expect(waypointsIndex).toBeGreaterThan(segmentsIndex);
    expect(template).toContain('@if (hasMultipleSegments())');
    expect(template).toContain('class="segment-table route-data-table"');
    expect(template).toContain('class="segment-visibility-control"');
    expect(template).toContain('(change)="onSegmentVisibilityChange(segment.id, $event.checked)"');
    expect(template).not.toContain('class="segment-visible-header"');
    expect(template).not.toContain('id="route-map-heading"');
    expect(template).not.toContain('id="route-charts-heading"');
  });

  it('keeps route child components out of parent card wrappers', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/routes/route-detail/route-detail.component.scss'),
      'utf8',
    );

    expect(styles).not.toContain('.route-detail-summary,\n.route-detail-section');
    expect(styles).not.toContain('.route-detail-section--map');
    expect(styles).toMatch(/\.route-detail-section\s*\{\s*display: grid;\s*gap: 16px;\s*\}/);
    expect(styles).toMatch(/\.route-detail-summary\s*\{\s*border: 1px solid var\(--mat-sys-outline-variant\);/);
  });

  it('bounds large segment and waypoint tables with internal scroll containers', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/routes/route-detail/route-detail.component.scss'),
      'utf8',
    );

    expect(styles).toContain('box-sizing: border-box;');
    expect(styles).toContain('.segment-table-wrap');
    expect(styles).toContain('max-height: min(42vh, 520px);');
    expect(styles).toContain('min-width: 900px;');
    expect(styles).toContain('.waypoint-table-wrap');
    expect(styles).toContain('max-height: min(40vh, 440px);');
    expect(styles).toContain('min-width: 620px;');
    expect(styles).toContain('.route-data-table-wrap');
    expect(styles).toContain('.route-data-table th');
    expect(styles).toContain("font-family: 'Barlow Condensed', 'Inter', sans-serif;");
    expect(styles).toContain('--qs-route-table-header-bg: #ffffff;');
    expect(styles).toContain(':host-context(.dark-theme) .route-data-table-wrap');
    expect(styles).toContain('background: var(--qs-route-table-header-bg);');
    expect(styles).toContain('vertical-align: middle;');
    expect(styles).toContain('position: sticky;');
    expect(styles.match(/overflow(?:-y)?: auto/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('deletes the owner route and navigates back to routes', async () => {
    component.routeDocument.set({
      ...routeDocument,
      name: '<strong>Detail Route</strong>',
    });

    await component.confirmDeleteRoute();

    const dialogData = dialogMock.open.mock.calls[0][1].data;
    expect(dialogData.message).toBe('Delete <strong>Detail Route</strong> and its original file?');
    expect(dialogData.htmlMessage).toBeUndefined();
    expect(routeServiceMock.deleteRoute).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), 'route-1');
    expect(snackBarMock.open).toHaveBeenCalledWith('Route deleted.', undefined, { duration: 2500 });
    expect(routerMock.navigate).toHaveBeenCalledWith(['/routes']);
  });

  function createParsedRoute(id: string, name: string, offset: number): RouteInterface {
    return {
      name,
      activityType: 'Running',
      getID: vi.fn(() => id),
      getPointCount: vi.fn(() => 2),
      getSquashedPositionData: vi.fn(() => [
        { latitudeDegrees: 40.1 + offset, longitudeDegrees: 22.1 + offset },
        { latitudeDegrees: 40.2 + offset, longitudeDegrees: 22.2 + offset },
      ]),
      getStat: vi.fn((type: string) => type === DataDistance.type ? { getValue: () => 1200 } : undefined),
    } as unknown as RouteInterface;
  }

  function createWaypoint(name: string, routeIndex: number | null) {
    return {
      name,
      type: 'Waypoint',
      routeIndex,
      routePointIndex: null,
      latitudeDegrees: 40.2,
      longitudeDegrees: 22.2,
    };
  }
});
