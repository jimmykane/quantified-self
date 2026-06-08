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

  it('keeps at least one segment selected when filtering', () => {
    component.onSegmentSelectionChange([]);
    expect(component.selectedSegmentIDs()).toEqual(['segment-1']);

    component.onSegmentSelectionChange('segment-1');
    expect(component.selectedSegments().map(segment => segment.id)).toEqual(['segment-1']);
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

  it('bounds large segment and waypoint lists with internal scroll containers', () => {
    const styles = readFileSync(
      resolve(process.cwd(), 'src/app/components/routes/route-detail/route-detail.component.scss'),
      'utf8',
    );

    expect(styles).toContain('box-sizing: border-box;');
    expect(styles).toContain('.segment-toggle-group');
    expect(styles).toContain('max-height: min(28vh, 190px);');
    expect(styles).toContain('.waypoint-table-wrap');
    expect(styles).toContain('max-height: min(40vh, 440px);');
    expect(styles).toContain('vertical-align: middle;');
    expect(styles).toContain('.segment-detail-grid');
    expect(styles).toContain('max-height: min(46vh, 560px);');
    expect(styles.match(/overflow(?:-y)?: auto/g)?.length).toBeGreaterThanOrEqual(2);
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
