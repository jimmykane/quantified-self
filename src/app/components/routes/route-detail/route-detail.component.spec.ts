import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataDistance, RouteFileInterface, RouteInterface, User, AppThemes, ServiceNames } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { RouteResolverData } from '../../../resolvers/route.resolver';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppFileService } from '../../../services/app.file.service';
import { AppProcessingService } from '../../../services/app.processing.service';
import { AppRouteGPXExportService } from '../../../services/app.route-gpx-export.service';
import { AppRouteReprocessService, RouteReprocessError } from '../../../services/app.route-reprocess.service';
import { AppRouteSendService } from '../../../services/app.route-send.service';
import { AppRouteService } from '../../../services/app.route.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { LoggerService } from '../../../services/logger.service';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { RouteNameDialogComponent } from '../route-name-dialog/route-name-dialog.component';
import { RouteDetailComponent } from './route-detail.component';

describe('RouteDetailComponent', () => {
  let component: RouteDetailComponent;
  let routeServiceMock: any;
  let routeReprocessServiceMock: any;
  let processingServiceMock: any;
  let fileServiceMock: any;
  let routeGPXExportServiceMock: any;
  let routeSendServiceMock: any;
  let userServiceMock: any;
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
      downloadOriginalFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      updateRouteName: vi.fn().mockResolvedValue(undefined),
      deleteRoute: vi.fn().mockResolvedValue(undefined),
    };
    routeReprocessServiceMock = {
      reprocessRouteFromOriginalFile: vi.fn().mockResolvedValue({
        routeDocument: {
          ...routeDocument,
          name: 'Reprocessed Route',
          routeCount: 1,
          waypointCount: 1,
          pointCount: 2,
        },
        routeFile,
        sourceFile: routeDocument.originalFiles![0],
        user: new User('user-1'),
        sourceFilesCount: 1,
        routeCount: 1,
        waypointCount: 1,
        pointCount: 2,
      }),
    };
    processingServiceMock = {
      addJob: vi.fn().mockReturnValue('job-1'),
      updateJob: vi.fn(),
      completeJob: vi.fn(),
      failJob: vi.fn(),
    };
    fileServiceMock = {
      getExtensionFromPath: vi.fn().mockReturnValue('gpx'),
      toDate: vi.fn((value: unknown) => value instanceof Date ? value : null),
      generateDateBasedFilename: vi.fn().mockReturnValue('route.gpx'),
      generateDateRangeZipFilename: vi.fn().mockReturnValue('2026-01-02_route_originals.zip'),
      resolveOriginalSourceFileName: vi.fn((file: { originalFilename?: string; path?: string }, fallbackExtension = 'gpx') => (
        file.originalFilename
          || file.path?.split('/').filter(Boolean).pop()
          || `route.${fallbackExtension}`
      )),
      getUniqueFileName: vi.fn((fileName: string) => fileName),
      downloadFile: vi.fn(),
      downloadNamedFile: vi.fn(),
      downloadAsZip: vi.fn().mockResolvedValue(undefined),
    };
    routeGPXExportServiceMock = {
      getRouteFileAsGPXBlob: vi.fn().mockResolvedValue(new Blob(['<gpx></gpx>'], { type: 'application/gpx+xml' })),
    };
    routeSendServiceMock = {
      sendRoutesToService: vi.fn().mockResolvedValue({
        destinationServiceName: ServiceNames.SuuntoApp,
        status: 'success',
        routeCount: 1,
        successCount: 1,
        failureCount: 0,
        skippedCount: 0,
        results: [{
          routeId: 'route-1',
          destinationServiceName: ServiceNames.SuuntoApp,
          status: 'success',
        }],
      }),
    };
    userServiceMock = {
      hasProAccessSignal: vi.fn().mockReturnValue(true),
      watchSuuntoServiceConnectionView: vi.fn().mockReturnValue(of({
        connected: true,
        reconnectRequired: false,
        showDetails: true,
        description: 'Connected',
        failureMessage: null,
        statusLabelOverride: null,
        statusIconOverride: null,
        statusTone: 'default',
        connectButtonLabel: 'Connect',
        reconnectPromptSource: 'test',
      })),
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
        { provide: AppRouteReprocessService, useValue: routeReprocessServiceMock },
        { provide: AppProcessingService, useValue: processingServiceMock },
        { provide: AppFileService, useValue: fileServiceMock },
        { provide: AppRouteGPXExportService, useValue: routeGPXExportServiceMock },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
        { provide: AppRouteSendService, useValue: routeSendServiceMock },
        { provide: AppUserService, useValue: userServiceMock },
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
    expect(component.singleSegment()?.label).toBe('Parsed Segment');
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
    expect(component.singleSegment()).toBeNull();
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

    expect(routeServiceMock.downloadOriginalFile).toHaveBeenCalledWith('users/user-1/routes/route-1/original.gpx');
    expect(fileServiceMock.downloadNamedFile).toHaveBeenCalledWith(
      expect.any(Blob),
      'original.gpx',
      'gpx',
    );
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('download', {
      status: 'success',
      fileCount: 1,
      fileType: 'gpx',
      zipped: false,
    });
  });

  it('downloads gzipped originals without renaming them to the saved route title', async () => {
    const gzRouteDocument: FirestoreRouteJSON = {
      ...routeDocument,
      name: 'Edited Route Name',
      srcFileType: 'fit',
      originalFiles: [{
        path: 'users/user-1/routes/route-1/original.fit.gz',
        originalFilename: 'recorded-route.fit.gz',
        extension: 'fit',
      }],
    };

    component.routeDocument.set(gzRouteDocument);
    component.sourceFile.set(gzRouteDocument.originalFiles![0]);
    routeServiceMock.getOriginalRouteFiles.mockReturnValue(gzRouteDocument.originalFiles);
    fileServiceMock.getExtensionFromPath.mockReturnValue('fit');

    await component.downloadRouteOriginals();

    expect(routeServiceMock.downloadOriginalFile).toHaveBeenCalledWith('users/user-1/routes/route-1/original.fit.gz');
    expect(fileServiceMock.downloadNamedFile).toHaveBeenCalledWith(
      expect.any(Blob),
      'recorded-route.fit.gz',
      'fit',
    );
  });

  it('exports the hydrated route file as generated GPX from the detail page action', async () => {
    await component.exportRouteAsGPX();

    expect(routeGPXExportServiceMock.getRouteFileAsGPXBlob).toHaveBeenCalledWith(component.routeFile());
    expect(fileServiceMock.downloadFile).toHaveBeenCalledWith(
      expect.any(Blob),
      'Detail_Route',
      'gpx',
    );
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('export_gpx', {
      status: 'success',
      fileCount: 1,
      fileType: 'gpx',
      zipped: false,
      source: 'route_detail',
    });
    expect(component.exportingGPX()).toBe(false);
  });

  it('sends the owner route to Suunto from the detail page action', async () => {
    await component.sendRouteToSuunto();

    expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(['route-1'], ServiceNames.SuuntoApp);
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('send_service_route', {
      status: 'success',
      routeCount: 1,
      failedCount: 0,
      skippedCount: 0,
      fileType: 'gpx',
      source: 'route_detail',
      destinationService: ServiceNames.SuuntoApp,
    });
    expect(snackBarMock.open).toHaveBeenCalledWith('Route sent to Suunto.', undefined, { duration: 2500 });
    expect(component.sendingToService()).toBe(false);
  });

  it('shows reconnect guidance when route-detail Suunto send returns an auth-required response', async () => {
    routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce({
      destinationServiceName: ServiceNames.SuuntoApp,
      status: 'failure',
      routeCount: 1,
      successCount: 0,
      failureCount: 1,
      skippedCount: 0,
      results: [{
        routeId: 'route-1',
        destinationServiceName: ServiceNames.SuuntoApp,
        status: 'failure',
        reason: 'DESTINATION_AUTH_REQUIRED',
        message: 'Authentication failed. Please re-connect your Suunto account.',
      }],
    });

    await component.sendRouteToSuunto();

    expect(snackBarMock.open).toHaveBeenCalledWith('Connect Suunto again before sending routes.', undefined, { duration: 3500 });
    expect(component.sendingToService()).toBe(false);
  });

  it('reprocesses the owner route from the original source file', async () => {
    await component.reprocessRouteFromOriginalFile();

    expect(dialogMock.open).toHaveBeenCalledWith(ConfirmationDialogComponent, expect.objectContaining({
      data: expect.objectContaining({
        title: 'Reprocess route from original file?',
        confirmLabel: 'Reprocess',
      }),
    }));
    expect(processingServiceMock.addJob).toHaveBeenCalledWith('process', 'Reprocessing route from source file...');
    expect(routeReprocessServiceMock.reprocessRouteFromOriginalFile).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'user-1' }),
      routeDocument,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(component.routeName()).toBe('Reprocessed Route');
    expect(processingServiceMock.completeJob).toHaveBeenCalledWith('job-1', 'Route reprocess completed');
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('reprocess', {
      status: 'success',
      fileCount: 1,
      routeCount: 1,
      fileType: 'gpx',
    });
    expect(snackBarMock.open).toHaveBeenCalledWith('Route reprocessed from source file.', undefined, { duration: 2500 });
  });

  it('does not reprocess when the route has no original source file', async () => {
    component.routeDocument.set({
      ...routeDocument,
      originalFiles: [],
      originalFile: undefined,
    });

    await component.reprocessRouteFromOriginalFile();

    expect(dialogMock.open).not.toHaveBeenCalled();
    expect(routeReprocessServiceMock.reprocessRouteFromOriginalFile).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('reprocess', {
      status: 'missing_file',
      fileCount: 0,
      fileType: 'gpx',
    });
    expect(snackBarMock.open).toHaveBeenCalledWith('No original route file found.', undefined, { duration: 3000 });
  });

  it('reports route reprocess failures with a typed message', async () => {
    routeReprocessServiceMock.reprocessRouteFromOriginalFile.mockRejectedValueOnce(
      new RouteReprocessError('PARSE_FAILED', 'Could not parse'),
    );

    await component.reprocessRouteFromOriginalFile();

    expect(processingServiceMock.failJob).toHaveBeenCalledWith('job-1', 'Route reprocess failed');
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('reprocess', {
      status: 'failure',
      fileCount: 1,
      fileType: 'gpx',
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[RouteDetailComponent] Failed to reprocess route',
      { routeID: 'route-1' },
      expect.any(RouteReprocessError),
    );
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Could not parse the original route source file.',
      undefined,
      { duration: 4000 },
    );
  });

  it('does not rename, send, download, export, reprocess, or delete when the resolved user is not the route owner', async () => {
    component.user.set(new User('other-user'));
    dialogMock.open.mockClear();
    routeServiceMock.updateRouteName.mockClear();
    routeServiceMock.downloadOriginalFile.mockClear();
    routeServiceMock.deleteRoute.mockClear();
    routeGPXExportServiceMock.getRouteFileAsGPXBlob.mockClear();
    routeReprocessServiceMock.reprocessRouteFromOriginalFile.mockClear();
    routeSendServiceMock.sendRoutesToService.mockClear();

    await component.renameRoute();
    await component.sendRouteToSuunto();
    await component.downloadRouteOriginals();
    await component.exportRouteAsGPX();
    await component.reprocessRouteFromOriginalFile();
    await component.confirmDeleteRoute();

    expect(routeServiceMock.updateRouteName).not.toHaveBeenCalled();
    expect(routeSendServiceMock.sendRoutesToService).not.toHaveBeenCalled();
    expect(routeServiceMock.downloadOriginalFile).not.toHaveBeenCalled();
    expect(routeGPXExportServiceMock.getRouteFileAsGPXBlob).not.toHaveBeenCalled();
    expect(dialogMock.open).not.toHaveBeenCalled();
    expect(routeServiceMock.deleteRoute).not.toHaveBeenCalled();
    expect(routeReprocessServiceMock.reprocessRouteFromOriginalFile).not.toHaveBeenCalled();
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
    expect(template).toContain('@if (singleSegment(); as segment)');
    expect(template).toContain('aria-label="Route actions"');
    expect(template).toContain('[matMenuTriggerFor]="routeDetailActionsMenu"');
    expect(template).toContain('Export GPX');
    expect(template).toContain('(click)="exportRouteAsGPX()"');
    expect(template).toContain('(click)="reprocessRouteFromOriginalFile()"');
    expect(template).toContain('Send to Suunto');
    expect(template).toContain('(click)="sendRouteToSuunto()"');
    expect(template).toContain('class="route-chip route-chip--segment"');
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
