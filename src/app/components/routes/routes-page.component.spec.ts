import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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

describe('RoutesPageComponent', () => {
    let component: RoutesPageComponent;
    let authServiceMock: any;
    let routeServiceMock: any;
    let dialogMock: any;
    let snackBarMock: any;
    let fileServiceMock: any;
    let analyticsServiceMock: any;
    let loggerMock: any;

    const route: FirestoreRouteJSON = {
        id: 'route-1',
        userID: 'user-1',
        name: 'Morning Route',
        srcFileType: 'gpx',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        routes: [],
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
            getOriginalRouteFiles: vi.fn().mockReturnValue(route.originalFiles),
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

    it('deletes owner route documents after confirmation and refreshes count', async () => {
        await component.ngOnInit();

        await component.confirmDeleteRoute(route);

        expect(dialogMock.open).toHaveBeenCalled();
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
