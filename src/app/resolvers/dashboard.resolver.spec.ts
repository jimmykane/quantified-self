import { TestBed } from '@angular/core/testing';
import { ResolveFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { EventInterface, User, DateRanges, DaysOfTheWeek, ActivityTypes } from '@sports-alliance/sports-lib';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../services/app.event.service';
import { AppUserService } from '../services/app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { dashboardResolver, DashboardResolverData } from './dashboard.resolver';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('dashboardResolver', () => {
    const executeResolver: ResolveFn<DashboardResolverData> = (...resolverParameters) =>
        TestBed.runInInjectionContext(() => dashboardResolver(...resolverParameters));

    let eventServiceSpy: any;
    let userServiceSpy: any;
    let authServiceSpy: any;
    let routerSpy: any;
    let snackBarSpy: any;

    const mockUser = new User('testUser');
    mockUser.settings = {
        dashboardSettings: {
            dateRange: DateRanges.all,
            activityTypes: ['Run']
        },
        unitSettings: {
            startOfTheWeek: DaysOfTheWeek.Monday
        }
    } as any;

    beforeEach(() => {
        eventServiceSpy = { getEventsBy: vi.fn() };
        userServiceSpy = { getUserByID: vi.fn() };
        authServiceSpy = { user$: of(mockUser) };
        routerSpy = { navigate: vi.fn() };
        snackBarSpy = { open: vi.fn() };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppEventService, useValue: eventServiceSpy },
                { provide: AppUserService, useValue: userServiceSpy },
                { provide: AppAuthService, useValue: authServiceSpy },
                { provide: Router, useValue: routerSpy },
                { provide: MatSnackBar, useValue: snackBarSpy }
            ]
        });
    });

    it('should be created', () => {
        expect(executeResolver).toBeTruthy();
    });

    it('should resolve with user and empty events when date range is all and no events returned', () => new Promise<void>(done => {
        eventServiceSpy.getEventsBy.mockReturnValue(of([]));

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockReturnValue(null);

        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: DashboardResolverData) => {
            expect(result.user).toEqual(mockUser);
            expect(result.events).toEqual([]);
            expect(result.targetUser).toBeUndefined(); // or null depending on impl
            expect(eventServiceSpy.getEventsBy).toHaveBeenCalled();
            done();
        });
    }));

    it('should resolve with targetUser when userID is present', () => new Promise<void>(done => {
        const mockTargetUser = new User('targetUser');
        userServiceSpy.getUserByID.mockReturnValue(of(mockTargetUser));
        eventServiceSpy.getEventsBy.mockReturnValue(of([]));

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockImplementation((key) => {
            if (key === 'userID') return 'targetUser';
            return null;
        });

        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: DashboardResolverData) => {
            expect(result.user).toEqual(mockUser);
            expect(result.targetUser).toEqual(mockTargetUser);
            expect(userServiceSpy.getUserByID).toHaveBeenCalledWith('targetUser');
            done();
        });
    }));

    it('should handle error when fetching targetUser and navigate', () => new Promise<void>(done => {
        userServiceSpy.getUserByID.mockReturnValue(throwError(() => new Error('User not found')));
        eventServiceSpy.getEventsBy.mockReturnValue(of([]));

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
});
