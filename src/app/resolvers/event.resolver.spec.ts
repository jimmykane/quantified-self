import { TestBed } from '@angular/core/testing';
import { ResolveFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { EventInterface, User } from '@sports-alliance/sports-lib';
import { of, throwError, EMPTY } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../services/app.event.service';
import { AppUserService } from '../services/app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { eventResolver } from './event.resolver';

describe('eventResolver', () => {
    const executeResolver: ResolveFn<EventInterface> = (...resolverParameters) =>
        TestBed.runInInjectionContext(() => eventResolver(...resolverParameters));

    let eventServiceSpy: jasmine.SpyObj<AppEventService>;
    let userServiceSpy: jasmine.SpyObj<AppUserService>;
    let authServiceSpy: jasmine.SpyObj<AppAuthService>;
    let routerSpy: jasmine.SpyObj<Router>;
    let snackBarSpy: jasmine.SpyObj<MatSnackBar>;

    const mockUser = new User('testUser');
    mockUser.settings = {
        chartSettings: { showAllData: false },
        unitSettings: {}
    } as any;

    beforeEach(() => {
        eventServiceSpy = jasmine.createSpyObj('AppEventService', ['getEventActivitiesAndSomeStreams']);
        userServiceSpy = jasmine.createSpyObj('AppUserService', ['getUserChartDataTypesToUse']);
        authServiceSpy = jasmine.createSpyObj('AppAuthService', [], { user$: of(mockUser) });
        routerSpy = jasmine.createSpyObj('Router', ['navigate']);
        snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

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

    it('should resolve with event when event is found', (done) => {
        const mockEvent = { id: 'testEvent' } as any;
        eventServiceSpy.getEventActivitiesAndSomeStreams.and.returnValue(of(mockEvent));
        userServiceSpy.getUserChartDataTypesToUse.and.returnValue([]);

        const route = new ActivatedRouteSnapshot();
        // Use Object.defineProperty to mock paramMap.get since it's read-only/managed by Angular
        spyOn(route.paramMap, 'get').and.callFake((key) => {
            if (key === 'eventID') return '123';
            if (key === 'userID') return '456';
            return null;
        });

        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result) => {
            expect(result).toEqual(mockEvent);
            expect(eventServiceSpy.getEventActivitiesAndSomeStreams).toHaveBeenCalled();
            done();
        });
    });

    it('should redirect to dashboard if eventID or userID is missing', () => {
        const route = new ActivatedRouteSnapshot();
        spyOn(route.paramMap, 'get').and.returnValue(null);
        const state = {} as RouterStateSnapshot;

        executeResolver(route, state);

        expect(routerSpy.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should redirect to dashboard if event service returns null', (done) => {
        eventServiceSpy.getEventActivitiesAndSomeStreams.and.returnValue(of(null));
        userServiceSpy.getUserChartDataTypesToUse.and.returnValue([]);

        const route = new ActivatedRouteSnapshot();
        spyOn(route.paramMap, 'get').and.callFake((key) => {
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
    });

    it('should handle errors and redirect to dashboard', (done) => {
        eventServiceSpy.getEventActivitiesAndSomeStreams.and.returnValue(throwError(() => new Error('Error')));
        userServiceSpy.getUserChartDataTypesToUse.and.returnValue([]);

        const route = new ActivatedRouteSnapshot();
        spyOn(route.paramMap, 'get').and.callFake((key) => {
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
                expect(snackBarSpy.open).toHaveBeenCalled();
                done();
            }
        });
    });
});
