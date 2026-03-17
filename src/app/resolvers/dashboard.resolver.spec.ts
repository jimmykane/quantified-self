import { TestBed } from '@angular/core/testing';
import { ResolveFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { EventInterface, User, DateRanges, DaysOfTheWeek, ActivityTypes } from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../models/app-user.interface';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../services/app.event.service';
import { AppUserService } from '../services/app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { dashboardResolver, DashboardResolverData } from './dashboard.resolver';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { LoggerService } from '../services/logger.service';

describe('dashboardResolver', () => {
    const executeResolver: ResolveFn<DashboardResolverData> = (...resolverParameters) =>
        TestBed.runInInjectionContext(() => dashboardResolver(...resolverParameters));

    let eventServiceSpy: any;
    let userServiceSpy: any;
    let authServiceSpy: any;
    let routerSpy: any;
    let snackBarSpy: any;
    let loggerSpy: any;
    let userSubject: BehaviorSubject<AppUserInterface | null>;

    const mockUser = new User('testUser') as AppUserInterface;
    mockUser.settings = {
        dashboardSettings: {
            dateRange: DateRanges.all,
            activityTypes: ['Run'],
            includeMergedEvents: true
        },
        unitSettings: {
            startOfTheWeek: DaysOfTheWeek.Monday
        }
    } as any;

    beforeEach(() => {
        eventServiceSpy = { getEventsBy: vi.fn(), getEventsOnceByWithMeta: vi.fn() };
        userServiceSpy = { getUserByID: vi.fn() };
        userSubject = new BehaviorSubject<AppUserInterface | null>(mockUser);
        authServiceSpy = { user$: userSubject, authState$: of({ uid: mockUser.uid }) };
        routerSpy = { navigate: vi.fn() };
        snackBarSpy = { open: vi.fn() };
        loggerSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppEventService, useValue: eventServiceSpy },
                { provide: AppUserService, useValue: userServiceSpy },
                { provide: AppAuthService, useValue: authServiceSpy },
                { provide: Router, useValue: routerSpy },
                { provide: MatSnackBar, useValue: snackBarSpy },
                { provide: LoggerService, useValue: loggerSpy }
            ]
        });
    });

    it('should be created', () => {
        expect(executeResolver).toBeTruthy();
    });

    it('should resolve with user and empty events when date range is all and no events returned', () => new Promise<void>(done => {
        eventServiceSpy.getEventsOnceByWithMeta.mockReturnValue(of({ events: [], source: 'cache' }));

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockReturnValue(null);

        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: DashboardResolverData) => {
            expect(result.user).toEqual(mockUser);
            expect(result.events).toEqual([]);
            expect(result.eventsSource).toBe('cache');
            expect(result.targetUser).toBeUndefined(); // or null depending on impl
            expect(eventServiceSpy.getEventsOnceByWithMeta).toHaveBeenCalledWith(
                mockUser,
                [],
                'startDate',
                false,
                0,
                {
                    preferCache: true,
                    seedLiveQuery: true,
                    warmServer: false
                }
            );
            done();
        });
    }));

    it('should resolve with targetUser when userID is present', () => new Promise<void>(done => {
        const mockTargetUser = new User('targetUser');
        userServiceSpy.getUserByID.mockReturnValue(of(mockTargetUser));
        eventServiceSpy.getEventsOnceByWithMeta.mockReturnValue(of({ events: [], source: 'server' }));

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockImplementation((key) => {
            if (key === 'userID') return 'targetUser';
            return null;
        });

        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: DashboardResolverData) => {
            expect(result.user).toEqual(mockUser);
            expect(result.targetUser).toEqual(mockTargetUser);
            expect(result.eventsSource).toBe('server');
            expect(userServiceSpy.getUserByID).toHaveBeenCalledWith('targetUser');
            done();
        });
    }));

    it('should filter out merged events when includeMergedEvents is false', () => new Promise<void>(done => {
        mockUser.settings.dashboardSettings.includeMergedEvents = false;
        mockUser.settings.dashboardSettings.activityTypes = [];
        const mergedEvent = { isMerge: true, getActivityTypesAsArray: () => [] } as any;
        const normalEvent = { isMerge: false, getActivityTypesAsArray: () => [] } as any;
        eventServiceSpy.getEventsOnceByWithMeta.mockReturnValue(of({
            events: [mergedEvent, normalEvent],
            source: 'cache'
        }));

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockReturnValue(null);

        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: DashboardResolverData) => {
            expect(result.events).toEqual([normalEvent]);
            expect(result.eventsSource).toBe('cache');
            done();
        });
    }));

    it('should handle error when fetching targetUser and navigate', () => new Promise<void>(done => {
        userServiceSpy.getUserByID.mockReturnValue(throwError(() => new Error('User not found')));
        eventServiceSpy.getEventsOnceByWithMeta.mockReturnValue(of({ events: [], source: 'cache' }));

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockReturnValue('targetUser');

        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: DashboardResolverData) => {
            // Depending on impl, it returns partial data or navigates
            expect(snackBarSpy.open).toHaveBeenCalled();
            expect(routerSpy.navigate).toHaveBeenCalledWith(['dashboard']);
            done();
        });
    }));

    it('should redirect to login when authState is unauthenticated', () => new Promise<void>(done => {
        authServiceSpy.authState$ = of(null);

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockReturnValue(null);

        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: DashboardResolverData) => {
            expect(routerSpy.navigate).toHaveBeenCalledWith(['login']);
            expect(result.user).toBeNull();
            expect(result.events).toEqual([]);
            done();
        });
    }));

    it('should wait for matching user$ value after authState to avoid stale null race', () => new Promise<void>(done => {
        authServiceSpy.authState$ = of({ uid: mockUser.uid });
        userSubject.next(null);
        eventServiceSpy.getEventsOnceByWithMeta.mockReturnValue(of({ events: [], source: 'cache' }));

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockReturnValue(null);
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: DashboardResolverData) => {
            expect(routerSpy.navigate).not.toHaveBeenCalledWith(['login']);
            expect(result.user?.uid).toBe(mockUser.uid);
            expect(result.events).toEqual([]);
            done();
        });

        setTimeout(() => {
            userSubject.next(mockUser);
        }, 0);
    }));
});
