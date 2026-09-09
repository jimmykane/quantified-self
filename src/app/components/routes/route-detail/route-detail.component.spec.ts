import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatMenuTrigger } from '@angular/material/menu';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataDistance, RouteFileInterface, RouteInterface, User, AppThemes, ServiceNames } from '@sports-alliance/sports-lib';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { RouteResolverData } from '../../../resolvers/route.resolver';
import { AppHapticsService } from '../../../services/app.haptics.service';
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
import { WahooRouteAccessReconnectDialogComponent } from '../../wahoo-route-access-reconnect-dialog/wahoo-route-access-reconnect-dialog.component';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { RouteNameDialogComponent } from '../route-name-dialog/route-name-dialog.component';
import { RouteDetailComponent } from './route-detail.component';

vi.mock('@shared/coros-rollout', () => ({
  COROS_ROUTE_UPLOAD_ALLOWED_UIDS: [],
  isCOROSRouteUploadUIDAllowlisted: (uid: string) => uid.length > 0,
}));

describe('RouteDetailComponent', () => {
  let component: RouteDetailComponent;
  let fixture: ComponentFixture<RouteDetailComponent>;
  let resolvedRouteData$: BehaviorSubject<{ route: RouteResolverData }>;
  let hapticsMock: { selection: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
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
  let garminRouteSendContext$: BehaviorSubject<any>;
  let activityServiceConnectionState$: BehaviorSubject<Record<string, boolean>>;

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
    hapticsMock = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    garminRouteSendContext$ = new BehaviorSubject({
      connected: false,
      reconnectRequired: false,
      missingPermissions: [],
      providerUserId: null,
      providerStates: [],
      serviceMeta: null,
      permissionPromptSource: null,
    });
    activityServiceConnectionState$ = new BehaviorSubject({
      [ServiceNames.GarminAPI]: false,
      [ServiceNames.SuuntoApp]: true,
      [ServiceNames.COROSAPI]: false,
      [ServiceNames.WahooAPI]: false,
    });
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
    resolvedRouteData$ = new BehaviorSubject({ route: resolvedData });
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
      hasProAccessSignal: signal(true),
      watchSuuntoRouteCatchUpPromptContext: vi.fn().mockReturnValue(of({
        connectionView: {
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
        },
        didLastRouteImport: new Date('2026-06-10T10:00:00.000Z'),
        promptSource: 'suunto-route-catch-up:connected:suunto-user-1:1710000000000',
        connectedProviderUserIds: ['suunto-user-1'],
      })),
      watchGarminRouteSendContext: vi.fn(),
      watchActivityServiceConnectionState: vi.fn(),
    };
    userServiceMock.watchGarminRouteSendContext.mockReturnValue(garminRouteSendContext$.asObservable());
    userServiceMock.watchActivityServiceConnectionState.mockReturnValue(activityServiceConnectionState$.asObservable());
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
      imports: [RouteDetailComponent, NoopAnimationsModule],
      providers: [
        { provide: ActivatedRoute, useValue: { data: resolvedRouteData$ } },
        { provide: AppHapticsService, useValue: hapticsMock },
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
    const template = readFileSync(resolve(process.cwd(), 'src/app/components/routes/route-detail/route-detail.component.html'), 'utf8');
    // Render the real actions and status without unrelated map/chart hydration.
    const actions = template.slice(template.indexOf('<div summary-actions'), template.indexOf('</app-summary-primary-info>'));
    const status = template.slice(template.indexOf('<div class="route-send-status"'), template.indexOf('</section>', template.indexOf('<div class="route-send-status"')));
    TestBed.overrideComponent(RouteDetailComponent, { set: { template: actions + status } });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(RouteDetailComponent);
    component = fixture.componentInstance;
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

  it('surfaces provenance labels and keeps same-account Suunto routes blocked from resend', () => {
    component.routeDocument.set({
      ...routeDocument,
      sourceSummary: {
        sourceType: 'service_sync',
        sourceServiceName: ServiceNames.SuuntoApp,
        providerUserId: 'suunto-user-1',
      },
      syncedDestinationServiceNames: [ServiceNames.GarminAPI],
    });

    expect(component.sourceSummaryLabel()).toBe('Synced from Suunto');
    expect(component.syncedDestinationLabels()).toEqual(['Sent to Garmin Connect']);
    expect(component.canSendRouteToSuunto()).toBe(false);
  });

  it('allows sending a Suunto-synced route when another connected Suunto account exists', () => {
    component.connectedSuuntoProviderUserIds.set(['suunto-user-1', 'suunto-user-2']);
    component.routeDocument.set({
      ...routeDocument,
      sourceSummary: {
        sourceType: 'service_sync',
        sourceServiceName: ServiceNames.SuuntoApp,
        providerUserId: 'suunto-user-1',
      },
    });

    expect(component.canSendRouteToSuunto()).toBe(true);
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

  function connectAllDestinations(): void {
    activityServiceConnectionState$.next({
      [ServiceNames.SuuntoApp]: true,
      [ServiceNames.GarminAPI]: true,
      [ServiceNames.COROSAPI]: true,
      [ServiceNames.WahooAPI]: true,
    });
    garminRouteSendContext$.next({
      connected: true,
      reconnectRequired: false,
      missingPermissions: [],
      providerUserId: 'garmin-user-1',
      providerStates: [{ providerUserId: 'garmin-user-1', permissionsLoaded: true, missingPermissions: [] }],
      serviceMeta: null,
    });
  }

  function successfulSend(destinationServiceName: ServiceNames) {
    return {
      destinationServiceName, status: 'success', routeCount: 1, successCount: 1,
      failureCount: 0, skippedCount: 0,
      results: [{ routeId: 'route-1', destinationServiceName, status: 'success' }],
    };
  }

  it('lists eligible providers in the same order and stays silent during initialization', () => {
    expect(component.routeSendActions().map(action => action.label)).toEqual(['Suunto']);
    connectAllDestinations();
    expect(component.routeSendActions().map(action => action.label)).toEqual(['Suunto', 'COROS', 'Garmin', 'Wahoo']);
    expect(hapticsMock.selection).not.toHaveBeenCalled();
    expect(hapticsMock.success).not.toHaveBeenCalled();
    expect(hapticsMock.error).not.toHaveBeenCalled();
  });

  it.each(['disconnected', 'non-pro', 'non-owner', 'no-originals'])(
    'hides and rejects Wahoo sends for %s routes/accounts', async reason => {
      connectAllDestinations();
      if (reason === 'disconnected') {
        // The shared watcher returns false for reconnect-required and pending disconnects too.
        activityServiceConnectionState$.next({ [ServiceNames.WahooAPI]: false });
      } else if (reason === 'non-pro') {
        userServiceMock.hasProAccessSignal.set(false);
      } else if (reason === 'non-owner') {
        component.user.set(new User('another-user'));
      } else {
        component.routeDocument.set({ ...routeDocument, originalFiles: [] });
      }
      expect(component.routeSendActions().some(action => action.serviceName === ServiceNames.WahooAPI)).toBe(false);
      await component.sendRouteToService(ServiceNames.WahooAPI);
      expect(routeSendServiceMock.sendRoutesToService).not.toHaveBeenCalled();
      expect(hapticsMock.selection).not.toHaveBeenCalled();
    },
  );

  it('hides all provider actions when entitlement is lost', async () => {
    connectAllDestinations();
    userServiceMock.hasProAccessSignal.set(false);
    expect(component.routeSendActions()).toEqual([]);
    expect(component.hasSendableRouteDestination()).toBe(false);
    fixture.detectChanges();
    fixture.debugElement.query(By.directive(MatMenuTrigger)).injector.get(MatMenuTrigger).openMenu();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('Send to');
  });

  it.each([ServiceNames.SuuntoApp, ServiceNames.COROSAPI, ServiceNames.GarminAPI, ServiceNames.WahooAPI])(
    'locks %s delivery, announces progress and reports completion through the shared interaction', async destination => {
      connectAllDestinations();
      let finish!: (value: ReturnType<typeof successfulSend>) => void;
      routeSendServiceMock.sendRoutesToService.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
      const sending = component.sendRouteToService(destination);
      expect(component.sendingToService()).toBe(true);
      expect(component.routeSendStatus()).toContain('Sending route to ');
      expect(component.routeSendStatus()).not.toContain('queued');
      expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
      expect(hapticsMock.success).not.toHaveBeenCalled();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain(component.routeSendStatus());
      expect(fixture.nativeElement.querySelector('mat-spinner')).toBeTruthy();
      await component.sendRouteToService(destination);
      await component.sendRouteToService(ServiceNames.WahooAPI);
      expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledTimes(1);
      expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(['route-1'], destination);
      finish(successfulSend(destination));
      await sending;
      fixture.detectChanges();
      expect(component.sendingToService()).toBe(false);
      expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
      expect(component.routeSendStatus()).toContain('Route sent to ');
      expect(hapticsMock.success).toHaveBeenCalledTimes(1);
      expect(hapticsMock.error).not.toHaveBeenCalled();
      expect(component.routeDocument()?.syncedDestinationServiceNames).toContain(destination);
    },
  );

  it.each([
    ['DESTINATION_PERMISSION_REQUIRED', 'Reconnect Wahoo and allow route access before sending routes.'],
    ['DESTINATION_AUTH_REQUIRED', 'Connect Wahoo again before sending routes.'],
    ['ACCOUNT_DELETION_IN_PROGRESS', 'Account is being deleted or no longer exists.'],
    ['PROVIDER_ERROR', 'Wahoo could not accept this route. Please retry.'],
  ])('shows actionable Wahoo %s responses and releases the send lock', async (reason, message) => {
    connectAllDestinations();
    routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce({
      ...successfulSend(ServiceNames.WahooAPI), status: 'failure', successCount: 0, failureCount: 1,
      results: [{ routeId: 'route-1', destinationServiceName: ServiceNames.WahooAPI, status: 'failure', reason, message }],
    });
    await component.sendRouteToService(ServiceNames.WahooAPI);
    expect(component.routeSendStatus()).toBe(message);
    if (reason === 'DESTINATION_PERMISSION_REQUIRED') {
      expect(dialogMock.open).toHaveBeenCalledWith(WahooRouteAccessReconnectDialogComponent);
    } else {
      expect(snackBarMock.open).toHaveBeenLastCalledWith(message, undefined, { duration: 3500 });
    }
    expect(component.sendingToService()).toBe(false);
    expect(hapticsMock.error).toHaveBeenCalledTimes(1);
    expect(hapticsMock.success).not.toHaveBeenCalled();
  });

  it('reports a thrown Wahoo failure and permits an explicit retry', async () => {
    connectAllDestinations();
    routeSendServiceMock.sendRoutesToService.mockRejectedValueOnce(new Error('Connection interrupted. Please retry.'));
    await component.sendRouteToService(ServiceNames.WahooAPI);
    expect(component.routeSendStatus()).toBe('Connection interrupted. Please retry.');
    expect(component.routeDocument()?.syncedDestinationServiceNames || []).not.toContain(ServiceNames.WahooAPI);
    expect(component.sendingToService()).toBe(false);
    expect(hapticsMock.error).toHaveBeenCalledTimes(1);
    routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce(successfulSend(ServiceNames.WahooAPI));
    await component.sendRouteToService(ServiceNames.WahooAPI);
    expect(component.routeSendStatus()).toBe('Route sent to Wahoo.');
    expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledTimes(2);
  });

  it('blocks duplicates throughout Suunto copy confirmation and rechecks eligibility before dispatch', async () => {
    component.routeDocument.set({ ...routeDocument, syncedDestinationServiceNames: [ServiceNames.SuuntoApp] });
    const confirmed$ = new Subject<boolean>();
    dialogMock.open.mockReturnValueOnce({ afterClosed: () => confirmed$ });
    const sending = component.sendRouteToSuunto();
    await component.sendRouteToSuunto();
    expect(dialogMock.open).toHaveBeenCalledTimes(1);
    expect(component.sendingToService()).toBe(true);
    expect(routeSendServiceMock.sendRoutesToService).not.toHaveBeenCalled();
    userServiceMock.hasProAccessSignal.set(false);
    confirmed$.next(true);
    await sending;
    expect(routeSendServiceMock.sendRoutesToService).not.toHaveBeenCalled();
    expect(component.sendingToService()).toBe(false);
    expect(component.routeSendStatus()).toBe('');
    expect(hapticsMock.success).not.toHaveBeenCalled();
    expect(hapticsMock.error).not.toHaveBeenCalled();
  });

  it('does not show the previous route delivery result after navigating to another route', async () => {
    connectAllDestinations();
    let finish!: (value: ReturnType<typeof successfulSend>) => void;
    routeSendServiceMock.sendRoutesToService.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const sending = component.sendRouteToService(ServiceNames.WahooAPI);
    resolvedRouteData$.next({ route: {
      ...resolvedRouteData$.value.route,
      routeDocument: { ...routeDocument, id: 'route-2', name: 'Another route' },
    } });
    expect(component.routeSendStatus()).toBe('');
    snackBarMock.open.mockClear();
    finish(successfulSend(ServiceNames.WahooAPI));
    await sending;
    expect(snackBarMock.open).not.toHaveBeenCalled();
    expect(hapticsMock.success).not.toHaveBeenCalled();
    expect(component.routeSendStatus()).toBe('');
    expect(component.sendingToService()).toBe(false);
    expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(['route-1'], ServiceNames.WahooAPI);
  });

  it.each(['destroyed', 'another-owner', 'away-and-back'])(
    'discards a Suunto copy confirmation after the originating view is %s', async transition => {
      component.routeDocument.set({ ...routeDocument, syncedDestinationServiceNames: [ServiceNames.SuuntoApp] });
      const confirmation$ = new Subject<boolean>();
      const close = vi.fn();
      dialogMock.open.mockReturnValueOnce({ afterClosed: () => confirmation$, close });
      const sending = component.sendRouteToSuunto();
      if (transition === 'destroyed') {
        fixture.destroy();
      } else if (transition === 'another-owner') {
        resolvedRouteData$.next({ route: {
          ...resolvedRouteData$.value.route,
          routeDocument: { ...routeDocument, userID: 'user-2' },
          user: new User('user-2'),
        } });
      } else {
        const original = resolvedRouteData$.value;
        resolvedRouteData$.next({ route: { ...original.route, routeDocument: { ...routeDocument, id: 'route-2' } } });
        resolvedRouteData$.next(original);
      }
      snackBarMock.open.mockClear();
      if (transition === 'destroyed') {
        expect(close).toHaveBeenCalledTimes(1);
      } else {
        confirmation$.next(true);
      }
      await sending;
      expect(routeSendServiceMock.sendRoutesToService).not.toHaveBeenCalled();
      expect(snackBarMock.open).not.toHaveBeenCalled();
      expect(hapticsMock.success).not.toHaveBeenCalled();
      expect(hapticsMock.error).not.toHaveBeenCalled();
    },
  );

  it.each(['success', 'failure', 'scope-failure'])(
    'does not publish a late %s after Route Details is destroyed', async outcome => {
      connectAllDestinations();
      let finish!: (value: unknown) => void;
      let fail!: (reason: unknown) => void;
      routeSendServiceMock.sendRoutesToService.mockReturnValueOnce(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
      const sending = component.sendRouteToService(ServiceNames.WahooAPI);
      fixture.destroy();
      snackBarMock.open.mockClear();
      if (outcome === 'failure') {
        fail(new Error('Service unavailable.'));
      } else if (outcome === 'scope-failure') {
        finish({
          ...successfulSend(ServiceNames.WahooAPI), status: 'failure', successCount: 0, failureCount: 1,
          results: [{ routeId: 'route-1', destinationServiceName: ServiceNames.WahooAPI, status: 'failure', reason: 'DESTINATION_PERMISSION_REQUIRED' }],
        });
      } else {
        finish(successfulSend(ServiceNames.WahooAPI));
      }
      await sending;
      expect(snackBarMock.open).not.toHaveBeenCalled();
      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(hapticsMock.success).not.toHaveBeenCalled();
      expect(hapticsMock.error).not.toHaveBeenCalled();
    },
  );

  it('remembers successful sends in the current view so Suunto resends require copy confirmation', async () => {
    await component.sendRouteToSuunto();
    expect(component.syncedDestinationLabels()).toContain('Sent to Suunto App');
    expect(component.routeSendActions().find(action => action.serviceName === ServiceNames.SuuntoApp)?.copy).toBe(true);
    dialogMock.open.mockReturnValueOnce({ afterClosed: () => of(false) });
    await component.sendRouteToSuunto();
    expect(dialogMock.open).toHaveBeenCalledWith(ConfirmationDialogComponent, expect.anything());
    expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledTimes(1);
    await component.sendRouteToSuunto();
    expect(routeSendServiceMock.sendRoutesToService).toHaveBeenLastCalledWith(
      ['route-1'], ServiceNames.SuuntoApp, { forceCopy: true },
    );
  });

  it.each(['response', 'exception'])(
    'opens the existing Wahoo route-access recovery dialog for a scope %s', async outcome => {
      connectAllDestinations();
      const message = 'Reconnect Wahoo and allow route access before sending routes.';
      if (outcome === 'response') {
        routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce({
          ...successfulSend(ServiceNames.WahooAPI), status: 'failure', successCount: 0, failureCount: 1,
          results: [{ routeId: 'route-1', destinationServiceName: ServiceNames.WahooAPI, status: 'failure', reason: 'DESTINATION_PERMISSION_REQUIRED', message }],
        });
      } else {
        routeSendServiceMock.sendRoutesToService.mockRejectedValueOnce(new Error(message));
      }
      await component.sendRouteToService(ServiceNames.WahooAPI);
      expect(dialogMock.open).toHaveBeenCalledWith(WahooRouteAccessReconnectDialogComponent);
      expect(component.routeSendStatus()).toBe(message);
      expect(component.sendingToService()).toBe(false);
      expect(hapticsMock.error).toHaveBeenCalledTimes(1);
    },
  );

  it('uses Material keyboard navigation and restores focus on submenu dismissal', async () => {
    connectAllDestinations();
    fixture.detectChanges();
    const actionsTrigger = fixture.debugElement.query(By.directive(MatMenuTrigger)).injector.get(MatMenuTrigger);
    actionsTrigger.openMenu();
    fixture.detectChanges();
    await fixture.whenStable();
    const sendTo = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.trim().endsWith('Send to'))!;
    sendTo.focus();
    sendTo.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    const menus = document.querySelectorAll<HTMLElement>('[role="menu"]');
    expect(menus.length).toBe(2);
    const menu = menus[1];
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', keyCode: 35, bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement?.textContent).toContain('Send to Wahoo');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(sendTo);
    expect(routeSendServiceMock.sendRoutesToService).not.toHaveBeenCalled();
  });

  it('renders accessible provider labels and dispatches Wahoo from the Material submenu', async () => {
    connectAllDestinations();
    routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce(successfulSend(ServiceNames.WahooAPI));
    fixture.detectChanges();
    const actionsTrigger = fixture.debugElement.query(By.directive(MatMenuTrigger)).injector.get(MatMenuTrigger);
    actionsTrigger.openMenu();
    fixture.detectChanges();
    await fixture.whenStable();
    const sendTo = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.trim().endsWith('Send to'))!;
    expect(sendTo).toBeTruthy();
    sendTo.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const providerButtons = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"]')].at(-1)!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect([...providerButtons].map(button => button.querySelector('span')?.textContent?.trim())).toEqual([
      'Send to Suunto', 'Send to COROS', 'Send to Garmin', 'Send to Wahoo',
    ]);
    const wahoo = providerButtons[3];
    expect(wahoo.disabled).toBe(false);
    wahoo.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(['route-1'], ServiceNames.WahooAPI);
    expect(component.routeSendStatus()).toBe('Route sent to Wahoo.');
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

  it('labels an already-sent Suunto route as an updated copy on the detail page', () => {
    component.routeDocument.set({
      ...routeDocument,
      syncedDestinationServiceNames: [ServiceNames.SuuntoApp],
      deliverySummaries: [{
        serviceName: ServiceNames.SuuntoApp,
        providerUserIds: ['suunto-user-1'],
        latestProviderUserId: 'suunto-user-1',
      }],
    });

    expect(component.routeSendActions().find(action => action.serviceName === ServiceNames.SuuntoApp)?.copy).toBe(true);
  });

  it('confirms before resending a detail route that was already sent to Suunto', async () => {
    component.routeDocument.set({
      ...routeDocument,
      syncedDestinationServiceNames: [ServiceNames.SuuntoApp],
    });
    dialogMock.open.mockReturnValueOnce({ afterClosed: () => of(false) });

    await component.sendRouteToSuunto();

    expect(dialogMock.open).toHaveBeenCalledWith(ConfirmationDialogComponent, expect.objectContaining({
      data: expect.objectContaining({
        title: 'Send updated copy to Suunto?',
        confirmLabel: 'Send copy',
      }),
    }));
    expect(routeSendServiceMock.sendRoutesToService).not.toHaveBeenCalled();
    expect(component.sendingToService()).toBe(false);
  });

  it('sends an updated Suunto copy from the detail page after confirmation', async () => {
    component.routeDocument.set({
      ...routeDocument,
      deliverySummaries: [{
        serviceName: ServiceNames.SuuntoApp,
        providerUserIds: ['suunto-user-1'],
        latestProviderUserId: 'suunto-user-1',
      }],
    });

    await component.sendRouteToSuunto();

    expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(
      ['route-1'],
      ServiceNames.SuuntoApp,
      { forceCopy: true },
    );
    expect(snackBarMock.open).toHaveBeenCalledWith('Route copy sent to Suunto.', undefined, { duration: 2500 });
    expect(component.sendingToService()).toBe(false);
  });

  it('sends the owner route to Garmin from the detail page action when Garmin route delivery is ready', async () => {
    garminRouteSendContext$.next({
      connected: true,
      reconnectRequired: false,
      missingPermissions: [],
      providerUserId: 'garmin-user-1',
      providerStates: [{
        providerUserId: 'garmin-user-1',
        permissionsLoaded: true,
        missingPermissions: [],
      }],
      serviceMeta: null,
    });
    routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce({
      destinationServiceName: ServiceNames.GarminAPI,
      status: 'success',
      routeCount: 1,
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
      results: [{
        routeId: 'route-1',
        destinationServiceName: ServiceNames.GarminAPI,
        status: 'success',
      }],
    });

    expect(component.canSendRouteToGarmin()).toBe(true);

    await component.sendRouteToGarmin();

    expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(['route-1'], ServiceNames.GarminAPI);
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('send_service_route', {
      status: 'success',
      routeCount: 1,
      failedCount: 0,
      skippedCount: 0,
      fileType: 'gpx',
      source: 'route_detail',
      destinationService: ServiceNames.GarminAPI,
    });
    expect(snackBarMock.open).toHaveBeenCalledWith('Route sent to Garmin.', undefined, { duration: 2500 });
    expect(component.sendingToService()).toBe(false);
  });

  it('sends the owner route to COROS from the detail page action when COROS is connected', async () => {
    activityServiceConnectionState$.next({
      ...activityServiceConnectionState$.value,
      [ServiceNames.COROSAPI]: true,
    });
    routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce({
      destinationServiceName: ServiceNames.COROSAPI,
      status: 'success',
      routeCount: 1,
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
      results: [{
        routeId: 'route-1',
        destinationServiceName: ServiceNames.COROSAPI,
        status: 'success',
      }],
    });

    expect(component.canSendRoutesToCOROS()).toBe(true);
    expect(component.canSendRouteToCOROS()).toBe(true);

    await component.sendRouteToCOROS();

    expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(['route-1'], ServiceNames.COROSAPI);
    expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('send_service_route', {
      status: 'success',
      routeCount: 1,
      failedCount: 0,
      skippedCount: 0,
      fileType: 'gpx',
      source: 'route_detail',
      destinationService: ServiceNames.COROSAPI,
    });
    expect(snackBarMock.open).toHaveBeenCalledWith('Route sent to COROS.', undefined, { duration: 2500 });
    expect(component.sendingToService()).toBe(false);
  });

  it('keeps COROS route actions available for another eligible user', () => {
    component.user.set(new User('user-2'));
    component.routeDocument.set({ ...routeDocument, userID: 'user-2' });
    activityServiceConnectionState$.next({
      ...activityServiceConnectionState$.value,
      [ServiceNames.COROSAPI]: true,
    });

    expect(component.canSendRouteToCOROS()).toBe(true);
    expect(component.isCOROSRouteUploadAvailableForUser()).toBe(true);
    expect(component.canSendRoutesToCOROS()).toBe(true);
  });

  it('hides Garmin resend when the original Garmin delivery account is not currently sendable', async () => {
    component.routeDocument.set({
      ...routeDocument,
      syncedDestinationServiceNames: [ServiceNames.GarminAPI],
      deliverySummaries: [{
        serviceName: ServiceNames.GarminAPI,
        providerUserIds: ['garmin-user-1'],
        latestProviderUserId: 'garmin-user-1',
      }],
    });
    garminRouteSendContext$.next({
      connected: true,
      reconnectRequired: false,
      missingPermissions: [],
      providerUserId: 'garmin-user-2',
      providerStates: [{
        providerUserId: 'garmin-user-2',
        permissionsLoaded: true,
        missingPermissions: [],
      }],
      serviceMeta: null,
    });

    expect(component.canSendRouteToGarmin()).toBe(false);
    expect(component.routeSendActions().some(action => action.serviceName === ServiceNames.GarminAPI)).toBe(false);
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
    expect(template).toContain('@for (action of routeSendActions(); track action.serviceName)');
    expect(template).toContain('(click)="sendRouteToService(action.serviceName)"');
    expect(template).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(template).toContain('Send to {{ action.label }}');
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
    const template = readFileSync(
      resolve(process.cwd(), 'src/app/components/routes/route-detail/route-detail.component.html'),
      'utf8',
    );

    expect(template).toContain('class="route-detail-page qs-workspace-page"');
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
