import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AppAuthService } from '../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppFileService } from '../../services/app.file.service';
import { AppRouteService } from '../../services/app.route.service';
import { LoggerService } from '../../services/logger.service';
import { RoutesPageComponent } from './routes-page.component';
import { FirestoreRouteJSON } from '@shared/app-route.interface';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';

describe('RoutesPageComponent', () => {
    let component: RoutesPageComponent;
    let authServiceMock: any;
    let routeServiceMock: any;
    let dialogMock: any;
    let snackBarMock: any;
    let fileServiceMock: any;
    let analyticsServiceMock: any;
    let loggerMock: any;
    let routerMock: any;

    const route: FirestoreRouteJSON = {
        id: 'route-1',
        userID: 'user-1',
        name: 'Morning Route',
        srcFileType: 'gpx',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
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

    beforeEach(async () => {
        authServiceMock = {
            getUser: vi.fn().mockResolvedValue({ uid: 'user-1' }),
        };
        routeServiceMock = {
            getRoutes: vi.fn().mockReturnValue(of([route])),
            getRouteCount: vi.fn().mockResolvedValue(1),
            getOriginalRouteFiles: vi.fn((sourceRoute: FirestoreRouteJSON) => sourceRoute.originalFiles || []),
            downloadFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
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
            downloadFile: vi.fn(),
            downloadAsZip: vi.fn().mockResolvedValue(undefined),
        };
        analyticsServiceMock = {
            logEvent: vi.fn(),
            logSavedRouteAction: vi.fn(),
        };
        loggerMock = {
            error: vi.fn(),
        };
        routerMock = {
            navigate: vi.fn().mockResolvedValue(true),
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

        expect(authServiceMock.getUser).toHaveBeenCalled();
        expect(routeServiceMock.getRoutes).toHaveBeenCalledWith({ uid: 'user-1' });
        expect(routeServiceMock.getRouteCount).toHaveBeenCalledWith({ uid: 'user-1' });
        expect(component.routeCount()).toBe(1);
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('view', {
            routeCount: 1,
        });
    });

    it('projects route display values for table rendering', async () => {
        await component.ngOnInit();

        const routes = await firstValueFrom(component.routes$!);

        expect(routes).toHaveLength(1);
        expect(routes[0]).toMatchObject({
            route,
            activityTypes: 'Running',
            originalFilename: 'original.gpx',
            routeCountLabel: '1 route',
            pointCountLabel: '2 points',
            waypointCountLabel: null,
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
        });
        expect(routes[0].routeDate?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
        expect(component.trackByRouteID(0, routes[0])).toBe('route-1');
    });

    it('sorts route table rows by normalized route stats', async () => {
        const shorterRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Short Route',
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
        routeServiceMock.getRoutes.mockReturnValueOnce(of([route, shorterRoute]));
        await component.ngOnInit();

        component.onRouteSortChange({ active: 'distance', direction: 'asc' });
        const routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2', 'route-1']);
        expect(routes.map(item => item.distance.label)).toEqual(['5.00 Km', '10.00 Km']);
    });

    it('sorts route table rows by min and max grade stats', async () => {
        const steeperRoute: FirestoreRouteJSON = {
            ...route,
            id: 'route-2',
            name: 'Steeper Route',
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
        routeServiceMock.getRoutes.mockReturnValueOnce(of([route, steeperRoute]));
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
        routeServiceMock.getRoutes.mockReturnValueOnce(of([route, emptyRoute]));
        await component.ngOnInit();

        component.onRouteSortChange({ active: 'pointCount', direction: 'asc' });
        const routes = await firstValueFrom(component.routes$!);

        expect(routes.map(item => item.route.id)).toEqual(['route-2', 'route-1']);
        expect(routes[0].pointCountLabel).toBe('0 points');
    });

    it('opens route details from the explicit table action', async () => {
        await component.ngOnInit();
        const routes = await firstValueFrom(component.routes$!);

        component.openRouteDetails(routes[0]);

        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('open_details', {
            fileType: 'gpx',
        });
        expect(routerMock.navigate).toHaveBeenCalledWith(['/user', 'user-1', 'route', 'route-1']);
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
        expect(routeServiceMock.deleteRoute).toHaveBeenCalledWith({ uid: 'user-1' }, 'route-1');
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
        await component.downloadRouteOriginals(route);

        expect(routeServiceMock.getOriginalRouteFiles).toHaveBeenCalledWith(route);
        expect(routeServiceMock.downloadFile).toHaveBeenCalledWith('users/user-1/routes/route-1/original.gpx');
        expect(fileServiceMock.downloadFile).toHaveBeenCalled();
        expect(analyticsServiceMock.logSavedRouteAction).toHaveBeenCalledWith('download', {
            status: 'success',
            fileCount: 1,
            fileType: 'gpx',
            zipped: false,
        });
        expect(component.downloadingRouteID()).toBeNull();
    });

    it('logs and reports route download failures without leaving the row disabled', async () => {
        const error = new Error('download failed');
        routeServiceMock.downloadFile.mockRejectedValueOnce(error);

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
