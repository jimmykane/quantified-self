import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { AppAuthService } from '../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppFileService } from '../../services/app.file.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { AppRouteGPXExportService } from '../../services/app.route-gpx-export.service';
import { AppRouteReprocessService, RouteReprocessError } from '../../services/app.route-reprocess.service';
import { AppRouteSendService } from '../../services/app.route-send.service';
import { AppRouteService } from '../../services/app.route.service';
import { AppUserService } from '../../services/app.user.service';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';
import { RoutesPageComponent } from './routes-page.component';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID } from '../../helpers/dashboard-action-prompt.helper';

describe('RoutesPageComponent', () => {
    let component: RoutesPageComponent;
    let authServiceMock: any;
    let routeServiceMock: any;
    let dialogMock: any;
    let snackBarMock: any;
    let fileServiceMock: any;
    let analyticsServiceMock: any;
    let hapticsServiceMock: any;
    let processingServiceMock: any;
    let routeGPXExportServiceMock: any;
    let routeReprocessServiceMock: any;
    let routeSendServiceMock: any;
    let userServiceMock: any;
    let loggerMock: any;
    let routerMock: any;
    let windowServiceMock: any;
    let suuntoRouteCatchUpPromptContext$: BehaviorSubject<any>;
    let garminRouteSendContext$: BehaviorSubject<any>;

    const route: FirestoreRouteJSON = {
        id: 'route-1',
        userID: 'user-1',
        name: 'Morning Route',
        srcFileType: 'gpx',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        stats: {
            Distance: 10000,
            Ascent: 120,
            Descent: 118,
            'Minimum Grade': -3.2,
            'Maximum Grade': 8.6,
        },
        routes: [{
            id: 'segment-1',
            name: 'Segment',
            activityType: 'Running',
            stats: {
                Distance: 10000,
                Ascent: 120,
                Descent: 118,
                'Minimum Grade': -3.2,
                'Maximum Grade': 8.6,
            },
            pointCount: 2,
            streamTypes: [],
        }],
        routeCount: 1,
        waypointCount: 0,
        pointCount: 2,
        activityTypes: ['Running'],
        streamTypes: [],
        originalFiles: [{
            path: 'users/user-1/routes/route-1/original.gpx',
            startDate: new Date('2026-01-02T00:00:00.000Z'),
            extension: 'gpx',
        }],
    };

    function withoutTopLevelStats(sourceRoute: FirestoreRouteJSON): FirestoreRouteJSON {
        const routeClone = { ...sourceRoute };
        delete routeClone.stats;
        return routeClone;
    }

    beforeEach(async () => {
        const currentUser = {
            uid: 'user-1',
            settings: {
                appSettings: {},
            },
        };
        suuntoRouteCatchUpPromptContext$ = new BehaviorSubject({
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
                reconnectPromptSource: 'test-reconnect-source',
            },
            didLastRouteImport: new Date('2026-06-10T10:00:00.000Z'),
            promptSource: 'suunto-route-catch-up:connected:1710000000000',
            connectedProviderUserIds: ['suunto-user-1'],
        });
        garminRouteSendContext$ = new BehaviorSubject({
            connected: false,
            reconnectRequired: false,
            missingPermissions: [],
            providerUserId: null,
            providerStates: [],
            serviceMeta: null,
        });
        authServiceMock = {
            getUser: vi.fn().mockResolvedValue(currentUser),
        };
        routeServiceMock = {
            getRoutes: vi.fn().mockReturnValue(of([route])),
            getRouteCount: vi.fn().mockResolvedValue(1),
            getOriginalRouteFiles: vi.fn((sourceRoute: FirestoreRouteJSON) => sourceRoute.originalFiles || []),
            downloadFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
            downloadOriginalFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
            deleteRoute: vi.fn().mockResolvedValue(undefined),
        };
        dialogMock = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(true),
            }),
        };
        snackBarMock = {
            open: vi.fn(),
        };
        fileServiceMock = {
            getExtensionFromPath: vi.fn().mockReturnValue('gpx'),
            toDate: vi.fn((value: unknown) => value instanceof Date ? value : null),
            generateDateBasedFilename: vi.fn().mockReturnValue('2026-01-02_Morning_Route.gpx'),
            generateDateRangeZipFilename: vi.fn((_minDate: Date | null, _maxDate: Date | null, suffix = 'originals') => (
                `2026-01-02_${suffix}.zip`
            )),
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
        analyticsServiceMock = {
            logEvent: vi.fn(),
            logSavedRouteAction: vi.fn(),
        };
        hapticsServiceMock = {
            selection: vi.fn(),
        };
        processingServiceMock = {
            addJob: vi.fn().mockReturnValue('job-1'),
            updateJob: vi.fn(),
            completeJob: vi.fn(),
            failJob: vi.fn(),
        };
        routeGPXExportServiceMock = {
            getRouteDocumentAsGPXBlob: vi.fn().mockResolvedValue({
                blob: new Blob(['<gpx></gpx>'], { type: 'application/gpx+xml' }),
                hydratedRoute: {
                    routeDocument: route,
                },
            }),
        };
        routeReprocessServiceMock = {
            reprocessRouteDocumentFromOriginalFile: vi.fn().mockResolvedValue({
                routeDocument: {
                    ...route,
                    stats: { Distance: 12000 },
                    routeCount: 1,
                    waypointCount: 1,
                    pointCount: 4,
                },
                sourceFilesCount: 1,
                routeCount: 1,
                waypointCount: 1,
                pointCount: 4,
            }),
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
            watchSuuntoRouteCatchUpPromptContext: vi.fn().mockReturnValue(suuntoRouteCatchUpPromptContext$.asObservable()),
            watchGarminRouteSendContext: vi.fn().mockReturnValue(garminRouteSendContext$.asObservable()),
            addSuuntoRoutesToQueueForCurrentUser: vi.fn().mockResolvedValue({
                queuedCount: 2,
                skippedCount: 1,
                failureCount: 0,
                totalCount: 3,
            }),
            getCurrentUserServiceTokenAndRedirectURI: vi.fn().mockResolvedValue({
                redirect_uri: 'https://suunto.example/reconnect',
            }),
            updateUserProperties: vi.fn().mockResolvedValue(undefined),
        };
        loggerMock = {
            error: vi.fn(),
        };
        routerMock = {
            navigate: vi.fn().mockResolvedValue(true),
        };
        windowServiceMock = {
            windowRef: {
                location: {
                    href: '',
                },
            },
        };

        TestBed.configureTestingModule({
            imports: [RoutesPageComponent],
            providers: [
                { provide: AppAuthService, useValue: authServiceMock },
                { provide: AppRouteService, useValue: routeServiceMock },
                { provide: MatDialog, useValue: dialogMock },
                { provide: MatSnackBar, useValue: snackBarMock },
                { provide: AppFileService, useValue: fileServiceMock },
                { provide: AppAnalyticsService, useValue: analyticsServiceMock },
                { provide: AppHapticsService, useValue: hapticsServiceMock },
                { provide: AppProcessingService, useValue: processingServiceMock },
                { provide: AppRouteGPXExportService, useValue: routeGPXExportServiceMock },
                { provide: AppRouteReprocessService, useValue: routeReprocessServiceMock },
                { provide: AppRouteSendService, useValue: routeSendServiceMock },
                { provide: AppUserService, useValue: userServiceMock },
                { provide: AppWindowService, useValue: windowServiceMock },
                { provide: LoggerService, useValue: loggerMock },
                { provide: Router, useValue: routerMock },
            ],
            schemas: [NO_ERRORS_SCHEMA],
        });
        TestBed.overrideComponent(RoutesPageComponent, {
            set: {
                imports: [CommonModule],
            },
        });
        await TestBed.compileComponents();

        component = TestBed.createComponent(RoutesPageComponent).componentInstance;
    });

    it('initializes owner routes and count', async () => {
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        expect(authServiceMock.getUser).toHaveBeenCalled();
        expect(routeServiceMock.getRoutes).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'user-1' }),
            50,
            { active: 'date', direction: 'desc' },
        );
        expect(routeServiceMock.getRouteCount).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }));
        expect(component.routeCount()).toBe(1);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('view', {
            routeCount: 1,
        });
    });

    it('shows the actionable Suunto route catch-up prompt when manual catch-up has never run', async () => {
        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            didLastRouteImport: null,
        });

        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        expect(component.suuntoRouteCatchUpPrompt()).toMatchObject({
            primaryAction: {
                id: 'queueSuuntoRouteCatchUp',
            },
            secondaryAction: {
                id: 'dismissSuuntoRouteCatchUp',
            },
        });
    });

    it('shows the locked Suunto route catch-up prompt for non-pro users', async () => {
        userServiceMock.hasProAccessSignal.mockReturnValue(false);
        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            didLastRouteImport: null,
        });

        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        expect(component.suuntoRouteCatchUpPrompt()).toMatchObject({
            primaryAction: {
                id: 'upgradeToPro',
            },
        });
    });

    it('shows the reconnect Suunto route catch-up prompt when reconnect is required', async () => {
        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            didLastRouteImport: null,
            connectionView: {
                ...suuntoRouteCatchUpPromptContext$.value.connectionView,
                connected: false,
                reconnectRequired: true,
            },
            promptSource: 'suunto-route-catch-up:suunto-reconnect-required:1710000000000',
        });

        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        expect(component.suuntoRouteCatchUpPrompt()).toMatchObject({
            primaryAction: {
                id: 'reconnectSuuntoService',
            },
        });
    });

    it('hides the Suunto route catch-up prompt after route catch-up metadata exists', async () => {
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        expect(component.suuntoRouteCatchUpPrompt()).toBeNull();
    });

    it('queues Suunto route catch-up from the shared routes prompt', async () => {
        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            didLastRouteImport: null,
        });

        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        await component.queueSuuntoRouteCatchUpPrompt();

        expect(userServiceMock.addSuuntoRoutesToQueueForCurrentUser).toHaveBeenCalled();
        expect(snackBarMock.open).toHaveBeenLastCalledWith('Queued 2 routes. Skipped 1.', undefined, { duration: 3500 });
        expect(component.suuntoRouteCatchUpPromptError()).toBeNull();
        expect(component.suuntoRouteCatchUpPrompt()).toBeNull();
    });

    it('keeps the Suunto route catch-up prompt visible after partial connected-account failures', async () => {
        userServiceMock.addSuuntoRoutesToQueueForCurrentUser.mockResolvedValueOnce({
            queuedCount: 2,
            skippedCount: 1,
            failureCount: 0,
            failedProviderCount: 1,
            totalCount: 3,
        });
        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            didLastRouteImport: null,
            connectedProviderUserIds: ['suunto-user-1', 'suunto-user-2'],
        });

        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        await component.queueSuuntoRouteCatchUpPrompt();

        expect(snackBarMock.open).toHaveBeenLastCalledWith(
            'Queued 2 routes. Skipped 1. Failed 1 connected account.',
            undefined,
            { duration: 4500 },
        );
        expect(component.didLastSuuntoRouteCatchUp()).toBeNull();
        expect(component.suuntoRouteCatchUpPrompt()).not.toBeNull();
    });

    it('keeps the Suunto route catch-up prompt visible after per-route queue failures', async () => {
        userServiceMock.addSuuntoRoutesToQueueForCurrentUser.mockResolvedValueOnce({
            queuedCount: 1,
            skippedCount: 1,
            failureCount: 1,
            failedProviderCount: 0,
            totalCount: 3,
        });
        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            didLastRouteImport: null,
        });

        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        await component.queueSuuntoRouteCatchUpPrompt();

        expect(snackBarMock.open).toHaveBeenLastCalledWith(
            'Queued 1 route. Skipped 1. Failed 1.',
            undefined,
            { duration: 4500 },
        );
        expect(component.didLastSuuntoRouteCatchUp()).toBeNull();
        expect(component.suuntoRouteCatchUpPrompt()).not.toBeNull();
    });

    it('dismisses the Suunto route catch-up prompt through dashboardActionPrompts', async () => {
        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            didLastRouteImport: null,
        });

        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        await component.dismissSuuntoRouteCatchUpPrompt();

        expect(userServiceMock.updateUserProperties).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'user-1' }),
            {
                settings: {
                    appSettings: {
                        dashboardActionPrompts: {
                            [DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID]: expect.objectContaining({
                                state: 'dismissed',
                                source: 'suunto-route-catch-up:connected:1710000000000',
                            }),
                        },
                    },
                },
            },
        );
        expect(component.suuntoRouteCatchUpPrompt()).toBeNull();
    });

    it('re-shows the Suunto route catch-up prompt when the dismissal source changes', async () => {
        authServiceMock.getUser.mockResolvedValueOnce({
            uid: 'user-1',
            settings: {
                appSettings: {
                    dashboardActionPrompts: {
                        [DASHBOARD_ACTION_PROMPT_SUUNTO_ROUTE_CATCH_UP_ID]: {
                            state: 'dismissed',
                            source: 'suunto-route-catch-up:connected:1710000000000',
                        },
                    },
                },
            },
        });
        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            didLastRouteImport: null,
        });

        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        expect(component.suuntoRouteCatchUpPrompt()).toBeNull();

        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            promptSource: 'suunto-route-catch-up:connected:1810000000000',
        });

        expect(component.suuntoRouteCatchUpPrompt()).toMatchObject({
            primaryAction: {
                id: 'queueSuuntoRouteCatchUp',
            },
        });
    });

    it('projects route display values for table rendering', async () => {
        await component.ngOnInit();

        const routes = await firstValueFrom(component.routes$!);

        expect(routes).toHaveLength(1);
        expect(routes[0]).toMatchObject({
            route,
            sourceServiceLabel: 'Saved route',
            sourceServiceTitle: 'Saved route',
            sourceServiceName: null,
            activityTypes: 'Running',
            activityTypesTitle: 'Running',
            activityTypeFilterValues: ['Running'],
            activityTypeSummaries: [{
                id: 'running-0',
                activityTypeLabel: 'Running',
                activityTypeIconValue: 'Running',
            }],
            fileTypeFilterValue: 'gpx',
            originalFilename: 'original.gpx',
            routeCountLabel: '1 route',
            pointCountLabel: '2 points',
            waypointCountLabel: null,
            provenanceSummary: 'Saved route',
            provenanceItems: [{
                id: 'source',
                label: 'Saved route',
                title: 'Saved route',
                serviceName: null,
            }],
            distance: {
                label: '10.00 Km',
                sortValue: 10000,
                title: 'Distance: 10.00 Km',
            },
            ascent: {
                label: '120 m',
                sortValue: 120,
                title: 'Ascent: 120 m',
            },
            descent: {
                label: '118 m',
                sortValue: 118,
                title: 'Descent: 118 m',
            },
            minGrade: {
                label: '-3 %',
                sortValue: -3.2,
                title: 'Minimum grade: -3 %',
            },
            maxGrade: {
                label: '9 %',
                sortValue: 8.6,
                title: 'Maximum grade: 9 %',
            },
            canReprocess: true,
            canExportGPX: true,
            canDownloadOriginals: true,
            canDelete: true,
        });
        expect(routes[0].routeDate?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
        expect(component.trackByRouteID(0, routes[0])).toBe('route-1');
    });

    it('keeps Suunto-synced routes sendable when another connected Suunto account exists and exposes provenance text', async () => {
        suuntoRouteCatchUpPromptContext$.next({
            ...suuntoRouteCatchUpPromptContext$.value,
            connectedProviderUserIds: ['suunto-user-1', 'suunto-user-2'],
        });
        routeServiceMock.getRoutes.mockReturnValueOnce(of([{
            ...route,
            sourceSummary: {
                sourceType: 'service_sync',
                sourceServiceName: ServiceNames.SuuntoApp,
                providerUserId: 'suunto-user-1',
            },
            syncedDestinationServiceNames: [ServiceNames.GarminAPI],
        }]));
        await component.ngOnInit();

        const routes = await firstValueFrom(component.routes$!);

        expect(routes[0].canSendToSuunto).toBe(true);
        expect(routes[0].sourceServiceLabel).toBe('Suunto');
        expect(routes[0].sourceServiceTitle).toBe('Synced from Suunto');
        expect(routes[0].sourceServiceName).toBe(ServiceNames.SuuntoApp);
        expect(routes[0].provenanceSummary).toBe('Synced from Suunto · Sent to Garmin Connect');
        expect(routes[0].provenanceItems).toEqual([
            {
                id: 'source',
                label: 'Synced from Suunto',
                title: 'Synced from Suunto',
                serviceName: ServiceNames.SuuntoApp,
            },
            {
                id: 'destination-Garmin API',
                label: 'Sent to Garmin Connect',
                title: 'Sent to Garmin Connect',
                serviceName: ServiceNames.GarminAPI,
            },
        ]);
    });

    it('keeps same-account Suunto routes blocked from resend', async () => {
        routeServiceMock.getRoutes.mockReturnValueOnce(of([{
            ...route,
            sourceSummary: {
                sourceType: 'service_sync',
                sourceServiceName: ServiceNames.SuuntoApp,
                providerUserId: 'suunto-user-1',
            },
        }]));
        await component.ngOnInit();

        const routes = await firstValueFrom(component.routes$!);

        expect(routes[0].canSendToSuunto).toBe(false);
    });

    it('reads persisted route-file aggregate stats for table metrics', async () => {
        const routeWithAggregateStats: FirestoreRouteJSON = {
            ...route,
            stats: {
                Distance: 12000,
                Ascent: 150,
                Descent: 145,
                'Minimum Grade': -5,
                'Maximum Grade': 11,
            },
        };
        routeServiceMock.getRoutes.mockReturnValue(of([routeWithAggregateStats]));
        await component.ngOnInit();

        const routes = await firstValueFrom(component.routes$!);

        expect(routes[0].distance).toMatchObject({
            label: '12.00 Km',
            sortValue: 12000,
            title: 'Distance: 12.00 Km',
        });
        expect(routes[0].ascent.sortValue).toBe(150);
        expect(routes[0].descent.sortValue).toBe(145);
        expect(routes[0].minGrade.sortValue).toBe(-5);
        expect(routes[0].maxGrade.sortValue).toBe(11);
    });

    it('does not aggregate table metrics from segment summaries when top-level stats are missing', async () => {
        const routeWithoutTopLevelStats = withoutTopLevelStats(route);
        routeServiceMock.getRoutes.mockReturnValue(of([routeWithoutTopLevelStats]));
        await component.ngOnInit();

        const routes = await firstValueFrom(component.routes$!);

        expect(routes[0].distance).toMatchObject({
            label: '-',
            sortValue: null,
            title: 'Distance unknown',
        });
        expect(routes[0].ascent.sortValue).toBeNull();
        expect(routes[0].descent.sortValue).toBeNull();
        expect(routes[0].minGrade.sortValue).toBeNull();
        expect(routes[0].maxGrade.sortValue).toBeNull();
    });

    it('filters loaded route rows with compare-style search and facets', async () => {
        const cyclingRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Evening Ride',
            srcFileType: 'fit',
            stats: {
                Distance: 24000,
                Ascent: 420,
                Descent: 410,
            },
            routes: [{
                id: 'segment-2',
                name: 'Ride segment',
                activityType: 'Cycling',
                stats: {
                    Distance: 24000,
                    Ascent: 420,
                    Descent: 410,
                },
                pointCount: 3,
                streamTypes: [],
            }],
            routeCount: 1,
            waypointCount: 2,
            pointCount: 3,
            activityTypes: ['Cycling'],
            originalFiles: [{
                path: 'users/user-1/routes/route-2/evening.fit',
                originalFilename: 'evening.fit',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'fit',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, cyclingRoute]));
        routeServiceMock.getRouteCount.mockResolvedValueOnce(2);
        await component.ngOnInit();

        let routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2', 'route-1']);
        expect(component.loadedRouteCount()).toBe(2);
        expect(component.filteredRouteCount()).toBe(2);
        expect(component.routeResultSummary()).toBe('2 routes');
        expect(component.routeFileTypeFilterOptions()).toEqual([
            { value: 'fit', label: 'FIT' },
            { value: 'gpx', label: 'GPX' },
        ]);
        expect(component.routeActivityTypeFilterOptions()).toEqual([
            { value: 'cycling', label: 'Cycling' },
            { value: 'running', label: 'Running' },
        ]);

        component.updateRouteFilter('ride');
        routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2']);
        expect(component.routeResultSummary()).toBe('1 of 2 loaded routes');
        expect(component.routeFilterActive()).toBe(true);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('filter', {
            status: 'applied',
            filterActive: true,
            resultCount: 1,
        });

        component.updateRouteFilter('');
        routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2', 'route-1']);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('filter', {
            status: 'cleared',
            filterActive: false,
            resultCount: 2,
        });

        component.updateRouteFileTypeFilter('gpx');
        routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-1']);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('filter', {
            status: 'applied',
            filterActive: true,
            resultCount: 1,
        });

        component.updateRouteActivityTypeFilter('Running');
        routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-1']);
        expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(4);
    });

    it('selects only visible rows and drops hidden selections after filtering', async () => {
        const cyclingRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Evening Ride',
            srcFileType: 'fit',
            activityTypes: ['Cycling'],
            originalFiles: [{
                path: 'users/user-1/routes/route-2/evening.fit',
                originalFilename: 'evening.fit',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'fit',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, cyclingRoute]));
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        component.toggleVisibleRouteSelection(true);

        expect([...component.selectedRouteIDs()].sort()).toEqual(['route-1', 'route-2']);
        expect(component.selectedRouteCount()).toBe(2);
        expect(component.allVisibleRoutesSelected()).toBe(true);

        component.updateRouteFilter('Morning');
        await firstValueFrom(component.routes$!);

        expect(component.selectedRouteIDs()).toEqual(['route-1']);
        expect(component.selectedRouteCount()).toBe(1);
        expect(component.allVisibleRoutesSelected()).toBe(true);
    });

    it('renders compare-style route filter controls and filtered empty state', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/routes/routes-page.component.html'),
            'utf8',
        );
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/routes/routes-page.component.scss'),
            'utf8',
        );
        const sharedTableControls = readFileSync(
            resolve(process.cwd(), 'src/styles/_table-controls.scss'),
            'utf8',
        );

        expect(template).toContain('class="routes-table-panel"');
        expect(template).toContain('class="comparison-table-controls"');
        expect(template).toContain('Filter loaded routes');
        expect(template).toContain('(input)="updateRouteFilter($any($event.target).value)"');
        expect(template).toContain('(selectionChange)="updateRouteFileTypeFilter($event.value)"');
        expect(template).toContain('(selectionChange)="updateRouteActivityTypeFilter($event.value)"');
        expect(template).toContain('{{ routeResultSummary() }}');
        expect(template).toContain('No loaded routes match this filter');
        expect(styles).toContain('.routes-table-panel');
        expect(styles).toContain("@use '../../../styles/table-controls' as tableControls;");
        expect(styles).toContain('@include tableControls.comparisonTableControlsLayout();');
        expect(styles).toContain('@include bp.max-768 {');
        expect(sharedTableControls).toContain('.comparison-table-controls');
        expect(sharedTableControls).toContain('.filter-field');
        expect(sharedTableControls).toContain('.facet-filter-field');
        expect(sharedTableControls).toContain('.result-summary');
    });

    it('renders route type cells with the compare icon and label structure', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/routes/routes-page.component.html'),
            'utf8',
        );
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/routes/routes-page.component.scss'),
            'utf8',
        );

        expect(template).toContain('class="route-type-line"');
        expect(template).toContain('<app-activity-type-icon');
        expect(template).toContain('[activityType]="summary.activityTypeIconValue"');
        expect(template).toContain('class="route-type-value"');
        expect(styles).toContain('.route-type-line');
        expect(styles).toContain('.route-type-line app-activity-type-icon');
        expect(styles).toContain('.route-type-value');
        expect(styles).toContain('font-weight: 500;');
    });

    it('keeps route details in the row action menu while also allowing guarded row activation', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/routes/routes-page.component.html'),
            'utf8',
        );
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/routes/routes-page.component.scss'),
            'utf8',
        );

        expect(template).toContain('class="route-table-row"');
        const rowDefinition = template.match(/<tr\s+mat-row[\s\S]*?class="route-table-row"[\s\S]*?\*matRowDef="let item; columns: routeColumns;"[\s\S]*?>/)?.[0] ?? '';
        expect(rowDefinition).toContain('(pointerdown)="onRouteRowPointerDown($event)"');
        expect(rowDefinition).toContain('(pointermove)="onRouteRowPointerMove($event)"');
        expect(rowDefinition).toContain('(pointerup)="onRouteRowPointerUp($event)"');
        expect(rowDefinition).toContain('(pointercancel)="onRouteRowPointerCancel($event)"');
        expect(rowDefinition).toContain('(click)="onRouteRowClick(item, $event)"');
        expect(rowDefinition).toContain('(keydown.enter)="onRouteRowKeydown(item, $event)"');
        expect(rowDefinition).toContain('(keydown.space)="onRouteRowKeydown(item, $event)"');
        expect(rowDefinition).toContain('tabindex="0"');
        expect(template).toContain('matColumnDef="sourceService"');
        expect(template).toContain('class="route-source-service-cell"');
        expect(template).toContain('[presentation]="item.sourcePresentation"');
        expect(template).toContain('class="route-original-file-cell"');
        expect(template).toContain('<span>Original</span>');
        expect(template).toContain('<app-service-source-icon');
        expect(template).toContain('matColumnDef="select"');
        expect(template).toContain('aria-label="Select all visible routes"');
        expect(template).toContain('(change)="toggleVisibleRouteSelection($event.checked)"');
        expect(template).toContain('(change)="toggleRouteSelection(item, $event.checked)"');
        expect(template).toContain('[checked]="!!item.route.id && selectedRouteIDSet().has(item.route.id)"');
        expect(template).toContain('(keydown)="$event.stopPropagation()"');
        expect(template).toContain('class="route-selection-toolbar"');
        expect(template).toContain('Export GPX');
        expect(template).toContain('(click)="exportRouteAsGPX(item.route)"');
        expect(template).toContain('(click)="downloadRouteOriginals(item.route)"');
        expect(template).toContain('(click)="sendRouteToSuunto(item.route)"');
        expect(template).toContain('(click)="$event.preventDefault(); $event.stopPropagation(); sendSelectedRoutesToSuunto()"');
        expect(template).toContain('@if (showGarminRouteSend && (item.canSendToGarmin || canSendRoutesToGarmin() || item.garminSendDisabledReason))');
        expect(template).toContain('@if (showGarminRouteSend && (selectedSendableRoutesToGarminCount() > 0 || canSendRoutesToGarmin()))');
        expect(template).toContain('<span>Send to</span>');
        expect(template).toContain('(click)="confirmDeleteRoute(item.route)"');
        expect(template).toContain('(click)="reprocessRouteFromOriginalFile(item.route)"');
        expect(template).toContain('[matMenuTriggerFor]="routeRowActionsMenu"');
        expect(template).toContain('!item.canReprocess');
        expect(template).not.toContain('canReprocessRoute(item.route)');
        expect(template).not.toContain('isRouteSelected(item)');
        expect(template).toContain('<mat-icon>autorenew</mat-icon>');
        expect(template).toContain('<mat-icon>cloud_upload</mat-icon>');
        expect(template).toContain('<mat-icon>open_in_new</mat-icon>');
        expect(styles).toContain('.route-table-row');
        expect(styles).toContain('cursor: pointer;');
        expect(styles).toContain('.route-table-row:focus-visible');
        expect(styles).toContain('.route-selection-toolbar');
        expect(styles).toContain('.route-table .mat-column-name');
        expect(styles).toContain('width: 14rem;');
        expect(styles).toContain('min-width: 12rem;');
        expect(styles).toContain('max-width: 16rem;');
        expect(styles).toContain('.route-table .mat-column-sourceService');
        expect(styles).toContain('.route-source-service-cell');
        expect(styles).toContain('.route-original-file-cell');
        expect(styles).toContain('.route-table .mat-column-select');
        expect(template).not.toContain('class="route-provenance-item"');
    });

    it('uses the compare-style horizontal scroll shell for the routes table', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/routes/routes-page.component.html'),
            'utf8',
        );
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/routes/routes-page.component.scss'),
            'utf8',
        );

        expect(template).toContain('class="route-table-shell qs-scrollbar"');
        expect(template).not.toContain('class="route-table-scroll qs-scrollbar"');
        expect(styles).toContain('.route-table-shell');
        expect(styles).toContain('--route-table-min-width: 108rem;');
        expect(styles).toContain('overflow-x: auto;');
        expect(styles).not.toContain('.route-table-scroll');
        expect(styles).not.toContain('overscroll-behavior: contain;');
        expect(styles).not.toContain('touch-action: pan-x pan-y;');
        const selectionToolbarStyles = styles.match(/\.route-selection-toolbar\s*{(?<body>[^}]*)}/)?.groups?.['body'] ?? '';
        expect(selectionToolbarStyles).toContain('position: sticky;');
        expect(selectionToolbarStyles).toContain('left: 0;');
        expect(selectionToolbarStyles).toContain('width: 100%;');
        expect(selectionToolbarStyles).toContain('justify-content: flex-start;');
        expect(selectionToolbarStyles).not.toContain('min-width');
    });

    it('sorts route table rows by normalized route stats', async () => {
        const shorterRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Short Route',
            stats: {
                Distance: 5000,
                Ascent: 40,
                Descent: 39,
                'Minimum Grade': -7,
                'Maximum Grade': 5,
            },
            routes: [{
                id: 'segment-2',
                name: 'Short segment',
                activityType: 'Running',
                stats: {
                    Distance: 5000,
                    Ascent: 40,
                    Descent: 39,
                    'Minimum Grade': -7,
                    'Maximum Grade': 5,
                },
                pointCount: 1,
                streamTypes: [],
            }],
            pointCount: 1,
            originalFiles: [{
                path: 'users/user-1/routes/route-2/original.gpx',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'gpx',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, shorterRoute]));
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        component.onRouteSortChange({ active: 'distance', direction: 'asc' });
        const routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2', 'route-1']);
        expect(routes.map(item => item.distance.label)).toEqual(['5.00 Km', '10.00 Km']);
        expect(routeServiceMock.getRoutes).not.toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'user-1' }),
            50,
            { active: 'distance', direction: 'asc' },
        );
        expect(routeServiceMock.getRoutes).toHaveBeenLastCalledWith(
            expect.objectContaining({ uid: 'user-1' }),
            50,
            { active: 'date', direction: 'desc' },
        );
        expect(hapticsServiceMock.selection).toHaveBeenCalled();
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('sort', {
            sortColumn: 'distance',
            sortDirection: 'asc',
            filterActive: false,
            resultCount: 2,
        });
    });

    it('sorts route table rows by synced-from source label', async () => {
        const manualUploadRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Manual Upload Route',
            sourceSummary: {
                sourceType: 'manual_upload',
            },
            originalFiles: [{
                path: 'users/user-1/routes/route-2/manual-upload.gpx',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'gpx',
            }],
        };
        const syncedRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-3',
            name: 'Suunto Route',
            sourceSummary: {
                sourceType: 'service_sync',
                sourceServiceName: ServiceNames.SuuntoApp,
                providerUserId: 'suunto-user-1',
            },
            originalFiles: [{
                path: 'users/user-1/routes/route-3/suunto-route.gpx',
                startDate: new Date('2026-01-04T00:00:00.000Z'),
                extension: 'gpx',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([syncedRoute, manualUploadRoute]));
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        component.onRouteSortChange({ active: 'sourceService', direction: 'asc' });
        const routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2', 'route-3']);
        expect(routes.map(item => item.sourceServiceTitle)).toEqual(['Manual upload', 'Synced from Suunto']);
        expect(routeServiceMock.getRoutes).toHaveBeenLastCalledWith(
            expect.objectContaining({ uid: 'user-1' }),
            50,
            { active: 'date', direction: 'desc' },
        );
    });

    it('keeps routes without top-level metric stats visible when metric sorting', async () => {
        const routeWithoutTopLevelStats = withoutTopLevelStats({
            ...route,
            id: 'route-2',
            name: 'No Elevation Route',
            originalFiles: [{
                path: 'users/user-1/routes/route-2/original.gpx',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'gpx',
            }],
        });
        routeServiceMock.getRoutes.mockReturnValue(of([routeWithoutTopLevelStats, route]));
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);

        component.onRouteSortChange({ active: 'ascent', direction: 'asc' });
        const routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-1', 'route-2']);
        expect(routes.map(item => item.ascent.label)).toEqual(['120 m', '-']);
        expect(routeServiceMock.getRoutes).not.toHaveBeenCalledWith(
            { uid: 'user-1' },
            50,
            { active: 'ascent', direction: 'asc' },
        );
    });

    it('sorts route table rows by min and max grade stats', async () => {
        const steeperRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Steeper Route',
            stats: {
                Distance: 5000,
                Ascent: 400,
                Descent: 300,
                'Minimum Grade': -12,
                'Maximum Grade': 18,
            },
            routes: [{
                id: 'segment-2',
                name: 'Steep segment',
                activityType: 'Running',
                stats: {
                    Distance: 5000,
                    Ascent: 400,
                    Descent: 300,
                    'Minimum Grade': -12,
                    'Maximum Grade': 18,
                },
                pointCount: 1,
                streamTypes: [],
            }],
            pointCount: 1,
            originalFiles: [{
                path: 'users/user-1/routes/route-2/original.gpx',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'gpx',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, steeperRoute]));
        await component.ngOnInit();

        component.onRouteSortChange({ active: 'minGrade', direction: 'asc' });
        let routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2', 'route-1']);
        expect(routes.map(item => item.minGrade.label)).toEqual(['-12 %', '-3 %']);

        component.onRouteSortChange({ active: 'maxGrade', direction: 'desc' });
        routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2', 'route-1']);
        expect(routes.map(item => item.maxGrade.label)).toEqual(['18 %', '9 %']);
    });

    it('sorts zero point routes as zero instead of missing data', async () => {
        const emptyRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Empty Route',
            routes: [],
            pointCount: 0,
            originalFiles: [{
                path: 'users/user-1/routes/route-2/original.gpx',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'gpx',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, emptyRoute]));
        await component.ngOnInit();

        component.onRouteSortChange({ active: 'pointCount', direction: 'asc' });
        const routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2', 'route-1']);
        expect(routes[0].pointCountLabel).toBe('0 points');
    });

    it('keeps point count table values on the default row text color', () => {
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/routes/routes-page.component.scss'),
            'utf8',
        );

        expect(styles).toContain('.route-detail-stack');
        expect(styles).toContain('color: inherit;');
        expect(styles).not.toContain('.route-detail-stack {\n  align-content: center;\n  color: var(--qs-secondary-text-color');
    });

    it('opens route details from the table row handler', async () => {
        await component.ngOnInit();
        const routes = await firstValueFrom(component.routes$!);

        component.openRouteDetails(routes[0]);

        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('open_details', {
            fileType: 'gpx',
        });
        expect(routerMock.navigate).toHaveBeenCalledWith(['/user', 'user-1', 'route', 'route-1']);
    });

    it('exports a row route as generated GPX', async () => {
        await component.ngOnInit();

        await component.exportRouteAsGPX(route);

        expect(routeGPXExportServiceMock.getRouteDocumentAsGPXBlob).toHaveBeenCalledWith(route);
        expect(fileServiceMock.downloadFile).toHaveBeenCalledWith(
            expect.any(Blob),
            'Morning_Route',
            'gpx',
        );
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('export_gpx', {
            status: 'success',
            fileCount: 1,
            fileType: 'gpx',
            zipped: false,
            source: 'routes_list_row',
        });
        expect(component.exportingRouteID()).toBeNull();
    });

    it('exports selected route GPX files as a zip for bulk selections', async () => {
        const secondRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Evening Ride',
            createdAt: new Date('2026-01-03T00:00:00.000Z'),
            originalFiles: [{
                path: 'users/user-1/routes/route-2/evening.fit',
                originalFilename: 'evening.fit',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'fit',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, secondRoute]));
        routeGPXExportServiceMock.getRouteDocumentAsGPXBlob.mockImplementation(async (routeDocument: FirestoreRouteJSON) => ({
            blob: new Blob([`<gpx>${routeDocument.id}</gpx>`], { type: 'application/gpx+xml' }),
            hydratedRoute: { routeDocument },
        }));
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        component.toggleVisibleRouteSelection(true);

        await component.exportSelectedRoutesAsGPX();

        expect(routeGPXExportServiceMock.getRouteDocumentAsGPXBlob).toHaveBeenCalledTimes(2);
        expect(fileServiceMock.generateDateRangeZipFilename).toHaveBeenCalledWith(
            new Date('2026-01-02T00:00:00.000Z'),
            new Date('2026-01-03T00:00:00.000Z'),
            'route_gpx',
        );
        expect(fileServiceMock.downloadAsZip).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ data: expect.any(Blob), fileName: '2026-01-02_Morning_Route.gpx' }),
            ]),
            '2026-01-02_route_gpx.zip',
        );
        expect(processingServiceMock.completeJob).toHaveBeenCalledWith('job-1', 'Exported 2 route GPX files');
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('export_gpx', {
            status: 'success',
            routeCount: 2,
            fileCount: 2,
            failedCount: 0,
            skippedCount: 0,
            fileType: 'gpx',
            zipped: true,
            source: 'routes_list_bulk',
        });
        expect(component.bulkActionInProgress()).toBe(false);
    });

    it('sends a row route to Suunto', async () => {
        await component.ngOnInit();

        await component.sendRouteToSuunto(route);

        expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(['route-1'], ServiceNames.SuuntoApp);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('send_service_route', {
            status: 'success',
            routeCount: 1,
            failedCount: 0,
            skippedCount: 0,
            fileType: 'gpx',
            source: 'routes_list_row',
            destinationService: ServiceNames.SuuntoApp,
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('Route sent to Suunto.', undefined, { duration: 2500 });
        expect(component.sendingToServiceRouteID()).toBeNull();
    });

    it('enables Garmin as a route-send destination when Garmin route delivery is ready', async () => {
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
        await component.ngOnInit();
        const routes = await firstValueFrom(component.routes$!);

        expect(routes[0].canSendToGarmin).toBe(true);
        expect(component.canSendRoutesToGarmin()).toBe(true);
    });

    it('sends a row route to Garmin', async () => {
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
        await component.ngOnInit();

        await component.sendRouteToGarmin(route);

        expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(['route-1'], ServiceNames.GarminAPI);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('send_service_route', {
            status: 'success',
            routeCount: 1,
            failedCount: 0,
            skippedCount: 0,
            fileType: 'gpx',
            source: 'routes_list_row',
            destinationService: ServiceNames.GarminAPI,
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('Route sent to Garmin.', undefined, { duration: 2500 });
        expect(component.sendingToServiceRouteID()).toBeNull();
    });

    it('disables Garmin resend for routes pinned to a different Garmin account', async () => {
        const garminDeliveredRoute: FirestoreRouteJSON = {
            ...route,
            syncedDestinationServiceNames: [ServiceNames.GarminAPI],
            deliverySummaries: [{
                serviceName: ServiceNames.GarminAPI,
                providerUserIds: ['garmin-user-1'],
                latestProviderUserId: 'garmin-user-1',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValueOnce(of([garminDeliveredRoute]));
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
        await component.ngOnInit();
        const routes = await firstValueFrom(component.routes$!);

        expect(routes[0].canSendToGarmin).toBe(false);
        expect(routes[0].garminSendDisabledReason).toBe('Reconnect the Garmin account previously used for this route before sending it again.');
        expect(routes[0].garminSendMenuLabel).toBe('Garmin (reconnect original account)');
    });

    it('shows reconnect guidance when a row send returns an auth-required response', async () => {
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
        await component.ngOnInit();

        await component.sendRouteToSuunto(route);

        expect(snackBarMock.open).toHaveBeenCalledWith('Connect Suunto again before sending routes.', undefined, { duration: 3500 });
        expect(component.sendingToServiceRouteID()).toBeNull();
    });

    it('keeps failed rows selected after bulk Garmin sends', async () => {
        const secondRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Evening Ride',
            originalFiles: [{
                path: 'users/user-1/routes/route-2/evening.gpx',
                originalFilename: 'evening.gpx',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'gpx',
            }],
        };
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
        routeServiceMock.getRoutes.mockReturnValue(of([route, secondRoute]));
        routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce({
            destinationServiceName: ServiceNames.GarminAPI,
            status: 'partial_success',
            routeCount: 2,
            successCount: 1,
            failureCount: 1,
            skippedCount: 0,
            results: [
                { routeId: 'route-1', destinationServiceName: ServiceNames.GarminAPI, status: 'success' },
                { routeId: 'route-2', destinationServiceName: ServiceNames.GarminAPI, status: 'failure', reason: 'PROVIDER_ERROR' },
            ],
        });
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        component.toggleVisibleRouteSelection(true);

        await component.sendSelectedRoutesToGarmin();

        expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(
            expect.arrayContaining(['route-1', 'route-2']),
            ServiceNames.GarminAPI,
            expect.objectContaining({ onProgress: expect.any(Function) }),
        );
        expect(component.selectedRouteIDs()).toEqual(['route-2']);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('send_service_route', {
            status: 'partial_success',
            routeCount: 2,
            failedCount: 1,
            skippedCount: 0,
            source: 'routes_list_bulk',
            destinationService: ServiceNames.GarminAPI,
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('Sent 1 route to Garmin. Failed 1.', undefined, { duration: 4000 });
        expect(component.bulkActionInProgress()).toBe(false);
    });

    it('keeps failed rows selected after bulk Suunto sends', async () => {
        const secondRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Evening Ride',
            originalFiles: [{
                path: 'users/user-1/routes/route-2/evening.gpx',
                originalFilename: 'evening.gpx',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'gpx',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, secondRoute]));
        routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce({
            destinationServiceName: ServiceNames.SuuntoApp,
            status: 'partial_success',
            routeCount: 2,
            successCount: 1,
            failureCount: 1,
            skippedCount: 0,
            results: [
                { routeId: 'route-1', destinationServiceName: ServiceNames.SuuntoApp, status: 'success' },
                { routeId: 'route-2', destinationServiceName: ServiceNames.SuuntoApp, status: 'failure', reason: 'PROVIDER_ERROR' },
            ],
        });
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        component.toggleVisibleRouteSelection(true);

        await component.sendSelectedRoutesToSuunto();

        expect(routeSendServiceMock.sendRoutesToService).toHaveBeenCalledWith(
            expect.arrayContaining(['route-1', 'route-2']),
            ServiceNames.SuuntoApp,
            expect.objectContaining({ onProgress: expect.any(Function) }),
        );
        expect(component.selectedRouteIDs()).toEqual(['route-2']);
        expect(processingServiceMock.completeJob).toHaveBeenCalledWith('job-1', 'Sent 1 route to Suunto');
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('send_service_route', {
            status: 'partial_success',
            routeCount: 2,
            failedCount: 1,
            skippedCount: 0,
            source: 'routes_list_bulk',
            destinationService: ServiceNames.SuuntoApp,
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('Sent 1 route to Suunto. Failed 1.', undefined, { duration: 4000 });
        expect(component.bulkActionInProgress()).toBe(false);
    });

    it('reports skipped bulk Suunto rows as skipped instead of failed', async () => {
        const routeWithoutOriginals: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'No Source Route',
            originalFiles: [],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, routeWithoutOriginals]));
        routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce({
            destinationServiceName: ServiceNames.SuuntoApp,
            status: 'success',
            routeCount: 1,
            successCount: 1,
            failureCount: 0,
            skippedCount: 0,
            results: [
                { routeId: 'route-1', destinationServiceName: ServiceNames.SuuntoApp, status: 'success' },
            ],
        });
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        component.toggleVisibleRouteSelection(true);

        await component.sendSelectedRoutesToSuunto();

        expect(component.selectedRouteIDs()).toEqual(['route-2']);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('send_service_route', {
            status: 'partial_success',
            routeCount: 2,
            failedCount: 0,
            skippedCount: 1,
            source: 'routes_list_bulk',
            destinationService: ServiceNames.SuuntoApp,
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('Sent 1 route to Suunto. Skipped 1.', undefined, { duration: 4000 });
        expect(component.bulkActionInProgress()).toBe(false);
    });

    it('includes reconnect guidance in partial-success bulk Suunto sends when later routes require re-authentication', async () => {
        const secondRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Evening Ride',
            originalFiles: [{
                path: 'users/user-1/routes/route-2/evening.gpx',
                originalFilename: 'evening.gpx',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'gpx',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, secondRoute]));
        routeSendServiceMock.sendRoutesToService.mockResolvedValueOnce({
            destinationServiceName: ServiceNames.SuuntoApp,
            status: 'partial_success',
            routeCount: 2,
            successCount: 1,
            failureCount: 1,
            skippedCount: 0,
            results: [
                { routeId: 'route-1', destinationServiceName: ServiceNames.SuuntoApp, status: 'success' },
                {
                    routeId: 'route-2',
                    destinationServiceName: ServiceNames.SuuntoApp,
                    status: 'failure',
                    reason: 'DESTINATION_AUTH_REQUIRED',
                    message: 'Authentication failed. Please re-connect your Suunto account.',
                },
            ],
        });
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        component.toggleVisibleRouteSelection(true);

        await component.sendSelectedRoutesToSuunto();

        expect(snackBarMock.open).toHaveBeenCalledWith(
            'Sent 1 route to Suunto. Failed 1. Connect Suunto again before sending routes.',
            undefined,
            { duration: 4000 },
        );
        expect(component.bulkActionInProgress()).toBe(false);
    });

    it('reports partial success when bulk original downloads skip routes without source files', async () => {
        const routeWithoutOriginals: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'No Source Route',
            originalFiles: [],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, routeWithoutOriginals]));
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        component.toggleVisibleRouteSelection(true);

        await component.downloadSelectedRouteOriginals();

        expect(routeServiceMock.downloadOriginalFile).toHaveBeenCalledTimes(1);
        expect(routeServiceMock.downloadOriginalFile).toHaveBeenCalledWith('users/user-1/routes/route-1/original.gpx');
        expect(fileServiceMock.generateDateRangeZipFilename).toHaveBeenCalledWith(
            new Date('2026-01-02T00:00:00.000Z'),
            new Date('2026-01-02T00:00:00.000Z'),
            'route_originals',
        );
        expect(fileServiceMock.downloadAsZip).toHaveBeenCalledWith(
            [expect.objectContaining({ data: expect.any(ArrayBuffer), fileName: 'original.gpx' })],
            '2026-01-02_route_originals.zip',
        );
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('download', {
            status: 'partial_success',
            routeCount: 2,
            fileCount: 1,
            failedCount: 0,
            skippedCount: 1,
            zipped: true,
            source: 'routes_list_bulk',
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('Downloaded 1 original file. Skipped 1.', undefined, { duration: 4000 });
    });

    it('reports failed and skipped route original downloads separately during bulk download', async () => {
        const secondRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Broken Source Route',
            originalFiles: [{
                path: 'users/user-1/routes/route-2/original.fit',
                originalFilename: 'broken.fit',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'fit',
            }],
        };
        const routeWithoutOriginals: FirestoreRouteJSON = {
            ...route,
            id: 'route-3',
            name: 'No Source Route',
            originalFiles: [],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, secondRoute, routeWithoutOriginals]));
        routeServiceMock.downloadOriginalFile
            .mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer)
            .mockRejectedValueOnce(new Error('download failed'));
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        component.toggleVisibleRouteSelection(true);

        await component.downloadSelectedRouteOriginals();

        expect(routeServiceMock.downloadOriginalFile).toHaveBeenCalledTimes(2);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('download', {
            status: 'partial_success',
            routeCount: 3,
            fileCount: 1,
            failedCount: 1,
            skippedCount: 1,
            zipped: true,
            source: 'routes_list_bulk',
        });
        expect(snackBarMock.open).toHaveBeenCalledWith(
            'Downloaded 1 original file. Failed 1. Skipped 1.',
            undefined,
            { duration: 4000 },
        );
    });

    it('keeps failed rows selected after bulk delete partial failures', async () => {
        const secondRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Evening Ride',
            originalFiles: [{
                path: 'users/user-1/routes/route-2/evening.gpx',
                originalFilename: 'evening.gpx',
                startDate: new Date('2026-01-03T00:00:00.000Z'),
                extension: 'gpx',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([route, secondRoute]));
        routeServiceMock.deleteRoute.mockImplementation(async (_user: unknown, routeID: string) => {
            if (routeID === 'route-2') {
                throw new Error('delete failed');
            }
        });
        await component.ngOnInit();
        await firstValueFrom(component.routes$!);
        component.toggleVisibleRouteSelection(true);

        await component.confirmDeleteSelectedRoutes();

        expect(routeServiceMock.deleteRoute).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), 'route-1');
        expect(routeServiceMock.deleteRoute).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), 'route-2');
        expect(component.selectedRouteIDs()).toEqual(['route-2']);
        expect(processingServiceMock.completeJob).toHaveBeenCalledWith('job-1', 'Deleted 1 route');
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('delete', {
            status: 'partial_success',
            routeCount: 1,
            failedCount: 1,
            source: 'routes_list_bulk',
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('Deleted 1 route. Failed 1.', undefined, { duration: 4000 });
    });

    it('reprocesses a route from the table action', async () => {
        routeReprocessServiceMock.reprocessRouteDocumentFromOriginalFile.mockImplementationOnce(async (
            _user: unknown,
            _route: FirestoreRouteJSON,
            options: { onProgress?: (progress: unknown) => void },
        ) => {
            options.onProgress?.({ phase: 'parsing', progress: 45, details: 'Parsing route' });
            return {
                routeDocument: {
                    ...route,
                    stats: { Distance: 12000 },
                    routeCount: 1,
                    waypointCount: 1,
                    pointCount: 4,
                },
                sourceFilesCount: 1,
                routeCount: 1,
                waypointCount: 1,
                pointCount: 4,
            };
        });
        await component.ngOnInit();

        await component.reprocessRouteFromOriginalFile(route);

        expect(dialogMock.open).toHaveBeenCalledWith(
            ConfirmationDialogComponent,
            expect.objectContaining({
                data: expect.objectContaining({
                    title: 'Reprocess route from original file?',
                    confirmLabel: 'Reprocess',
                }),
            }),
        );
        expect(processingServiceMock.addJob).toHaveBeenCalledWith('process', 'Reprocessing route from source file...');
        expect(processingServiceMock.updateJob).toHaveBeenCalledWith('job-1', { status: 'processing', progress: 5 });
        expect(processingServiceMock.updateJob).toHaveBeenCalledWith('job-1', {
            status: 'processing',
            title: 'Parsing route...',
            progress: 45,
            details: 'Parsing route',
        });
        expect(routeReprocessServiceMock.reprocessRouteDocumentFromOriginalFile).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'user-1' }),
            route,
            expect.objectContaining({ onProgress: expect.any(Function) }),
        );
        expect(processingServiceMock.completeJob).toHaveBeenCalledWith('job-1', 'Route reprocess completed');
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('reprocess', {
            status: 'success',
            fileCount: 1,
            routeCount: 1,
            fileType: 'gpx',
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('Route reprocessed from source file.', undefined, { duration: 2500 });
        expect(component.reprocessingRouteID()).toBeNull();
    });

    it('reports missing original files for table reprocesses', async () => {
        await component.ngOnInit();
        const routeWithoutOriginalFile: FirestoreRouteJSON = {
            ...route,
            originalFiles: [],
        };

        await component.reprocessRouteFromOriginalFile(routeWithoutOriginalFile);

        expect(dialogMock.open).not.toHaveBeenCalled();
        expect(routeReprocessServiceMock.reprocessRouteDocumentFromOriginalFile).not.toHaveBeenCalled();
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('reprocess', {
            status: 'missing_file',
            fileCount: 0,
            fileType: 'gpx',
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('No original route file found.', undefined, { duration: 3000 });
    });

    it('logs and reports table reprocess failures without leaving the row disabled', async () => {
        await component.ngOnInit();
        const error = new RouteReprocessError('PARSE_FAILED', 'parse failed');
        routeReprocessServiceMock.reprocessRouteDocumentFromOriginalFile.mockRejectedValueOnce(error);

        await component.reprocessRouteFromOriginalFile(route);

        expect(processingServiceMock.failJob).toHaveBeenCalledWith('job-1', 'Route reprocess failed');
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('reprocess', {
            status: 'failure',
            fileCount: 1,
            fileType: 'gpx',
        });
        expect(loggerMock.error).toHaveBeenCalledWith(
            '[RoutesPageComponent] Failed to reprocess route',
            { routeID: 'route-1' },
            error,
        );
        expect(snackBarMock.open).toHaveBeenCalledWith('Could not parse the original route source file.', undefined, { duration: 4000 });
        expect(component.reprocessingRouteID()).toBeNull();
    });

    it('deletes owner route documents after confirmation and refreshes count', async () => {
        await component.ngOnInit();
        const routeWithMarkupName = {
            ...route,
            name: '<strong>Morning Route</strong>',
        };

        await component.confirmDeleteRoute(routeWithMarkupName);

        expect(dialogMock.open).toHaveBeenCalledWith(
            ConfirmationDialogComponent,
            expect.objectContaining({
                data: expect.objectContaining({
                    message: 'Delete <strong>Morning Route</strong> and its original file?',
                }),
            }),
        );
        expect(dialogMock.open.mock.calls[0][1].data.htmlMessage).toBeUndefined();
        expect(routeServiceMock.deleteRoute).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }), 'route-1');
        expect(routeServiceMock.getRouteCount).toHaveBeenCalledTimes(2);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('delete', {
            status: 'success',
            routeCount: 1,
            fileType: 'gpx',
        });
        expect(snackBarMock.open).toHaveBeenCalledWith('Route deleted.', undefined, { duration: 2500 });
        expect(component.deletingRouteID()).toBeNull();
    });

    it('logs and reports route delete failures without leaving the row disabled', async () => {
        await component.ngOnInit();
        const error = new Error('delete failed');
        routeServiceMock.deleteRoute.mockRejectedValueOnce(error);

        await component.confirmDeleteRoute(route);

        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('delete', {
            status: 'failure',
            fileType: 'gpx',
        });
        expect(loggerMock.error).toHaveBeenCalledWith(
            '[RoutesPageComponent] Failed to delete route',
            { routeID: 'route-1' },
            error,
        );
        expect(snackBarMock.open).toHaveBeenCalledWith('Failed to delete route.', undefined, { duration: 3000 });
        expect(component.deletingRouteID()).toBeNull();
    });

    it('downloads the canonical original route file', async () => {
        await component.ngOnInit();

        await component.downloadRouteOriginals(route);

        expect(routeServiceMock.getOriginalRouteFiles).toHaveBeenCalledWith(route);
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
        expect(component.downloadingRouteID()).toBeNull();
    });

    it('preserves gzipped original filenames for row downloads', async () => {
        const gzRoute: FirestoreRouteJSON = {
            ...route,
            name: 'Edited Route Name',
            srcFileType: 'fit',
            originalFiles: [{
                path: 'users/user-1/routes/route-1/original.fit.gz',
                originalFilename: 'source-route.fit.gz',
                extension: 'fit',
            }],
        };
        routeServiceMock.getRoutes.mockReturnValue(of([gzRoute]));
        routeServiceMock.getOriginalRouteFiles.mockReturnValue(gzRoute.originalFiles || []);
        fileServiceMock.getExtensionFromPath.mockReturnValue('fit');

        await component.ngOnInit();
        await component.downloadRouteOriginals(gzRoute);

        expect(routeServiceMock.downloadOriginalFile).toHaveBeenCalledWith('users/user-1/routes/route-1/original.fit.gz');
        expect(fileServiceMock.downloadNamedFile).toHaveBeenCalledWith(
            expect.any(Blob),
            'source-route.fit.gz',
            'fit',
        );
    });

    it('logs and reports route download failures without leaving the row disabled', async () => {
        await component.ngOnInit();
        const error = new Error('download failed');
        routeServiceMock.downloadOriginalFile.mockRejectedValueOnce(error);

        await component.downloadRouteOriginals(route);

        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('download', {
            status: 'failure',
            fileCount: 1,
            fileType: 'gpx',
            zipped: false,
        });
        expect(loggerMock.error).toHaveBeenCalledWith(
            '[RoutesPageComponent] Failed to download route original file',
            { routeID: 'route-1' },
            error,
        );
        expect(snackBarMock.open).toHaveBeenCalledWith('Failed to download route file.', undefined, { duration: 3000 });
        expect(component.downloadingRouteID()).toBeNull();
    });
});
