import { TestBed } from '@angular/core/testing';
import { ResolveFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { EventInterface, User } from '@sports-alliance/sports-lib';
import { of, throwError, EMPTY } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../services/app.event.service';
import { AppUserService } from '../services/app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
// Moved import to top of file
import { eventResolver, EventResolverData } from './event.resolver';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('eventResolver', () => {
    // Update ResolveFn generic type to include EventResolverData
    const executeResolver: ResolveFn<EventResolverData> = (...resolverParameters) =>
        TestBed.runInInjectionContext(() => eventResolver(...resolverParameters));

    let eventServiceSpy: any;
    let userServiceSpy: any;
    let authServiceSpy: any;
    let routerSpy: any;
    let snackBarSpy: any;

    const mockUser = new User('testUser');
    mockUser.settings = {
        chartSettings: { showAllData: false },
        unitSettings: {}
    } as any;

    beforeEach(() => {
        eventServiceSpy = { getEventActivitiesAndSomeStreams: vi.fn() };
        userServiceSpy = { getUserChartDataTypesToUse: vi.fn() };
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

    it('should resolve with event when event is found', () => new Promise<void>(done => {
        const mockEvent = { id: 'testEvent' } as any;
        eventServiceSpy.getEventActivitiesAndSomeStreams.mockReturnValue(of(mockEvent));
        userServiceSpy.getUserChartDataTypesToUse.mockReturnValue([]);

        const route = new ActivatedRouteSnapshot();
        // Use Object.defineProperty to mock paramMap.get since it's read-only/managed by Angular
        vi.spyOn(route.paramMap, 'get').mockImplementation((key) => {
            if (key === 'eventID') return '123';
            if (key === 'userID') return '456';
            return null;
        });

        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: any) => {
            expect(result.event).toEqual(mockEvent);
            expect(result.user).toEqual(mockUser);
            expect(eventServiceSpy.getEventActivitiesAndSomeStreams).toHaveBeenCalled();
            done();
        });
    }));

    it('should redirect to dashboard if eventID or userID is missing', () => {
        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockReturnValue(null);
        const state = {} as RouterStateSnapshot;

        executeResolver(route, state);

        expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should redirect to dashboard if event service returns null', () => new Promise<void>(done => {
        eventServiceSpy.getEventActivitiesAndSomeStreams.mockReturnValue(of(null));
        userServiceSpy.getUserChartDataTypesToUse.mockReturnValue([]);

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockImplementation((key) => {
            if (key === 'eventID') return '123';
            if (key === 'userID') return '456';
            return null;
        });
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result) => {
            expect(result).toBeNull();
            expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
            expect(snackBarSpy.open).toHaveBeenCalled();
            done();
        });
    }));

    it('should handle permission errors with specific message', () => new Promise<void>(done => {
        const error = new Error('Missing or insufficient permissions');
        // Simulate Firebase error code if needed, but message check involves substring
        (error as any).code = 'permission-denied';
        eventServiceSpy.getEventActivitiesAndSomeStreams.mockReturnValue(throwError(() => error));
        userServiceSpy.getUserChartDataTypesToUse.mockReturnValue([]);

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockImplementation((key) => {
            if (key === 'eventID') return '123';
            if (key === 'userID') return '456';
            return null;
        });
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe({
            next: () => { },
            error: () => { },
            complete: () => {
                expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
                expect(snackBarSpy.open).toHaveBeenCalledWith(
                    'Event data unavailable: Original file missing and legacy access denied.',
                    'Close',
                    { duration: 5000 }
                );
                done();
            }
        });
    }));

    it('should handle errors and redirect to dashboard', () => new Promise<void>(done => {
        eventServiceSpy.getEventActivitiesAndSomeStreams.mockReturnValue(throwError(() => new Error('Error')));
        userServiceSpy.getUserChartDataTypesToUse.mockReturnValue([]);

        const route = new ActivatedRouteSnapshot();
        vi.spyOn(route.paramMap, 'get').mockImplementation((key) => {
            if (key === 'eventID') return '123';
            if (key === 'userID') return '456';
            return null;
        });
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe({
            next: () => { },
            error: () => { },
            complete: () => {
                expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
                expect(snackBarSpy.open).toHaveBeenCalledWith('Error loading event', 'Close', { duration: 5000 });
                done();
            }
        });
    }));
});
