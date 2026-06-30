import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouteLoaderComponent } from './route-loader.component';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterEvent } from '@angular/router';
import { Subject } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

describe('RouteLoaderComponent', () => {
    let component: RouteLoaderComponent;
    let fixture: ComponentFixture<RouteLoaderComponent>;
    let routerEvents$: Subject<RouterEvent>;

    beforeEach(async () => {
        window.history.pushState({}, '', '/');
        routerEvents$ = new Subject<RouterEvent>();

        // Mock Router with an events Observable we can control
        const routerMock = {
            events: routerEvents$.asObservable(),
            getCurrentNavigation: () => null
        };

        await TestBed.configureTestingModule({
            declarations: [RouteLoaderComponent],
            imports: [MatProgressSpinnerModule],
            providers: [
                { provide: Router, useValue: routerMock }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(RouteLoaderComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should not be loading by default', () => {
        expect(component.isLoading).toBe(false);
    });

    it('should set isLoading to true on NavigationStart', () => {
        routerEvents$.next(new NavigationStart(1, '/test'));
        expect(component.isLoading).toBe(true);
    });

    it('should set isLoading to false on NavigationEnd', () => {
        // Start loading first
        component.isLoading = true;

        routerEvents$.next(new NavigationEnd(1, '/test', '/test'));
        expect(component.isLoading).toBe(false);
    });

    it('should set isLoading to false on NavigationCancel', () => {
        component.isLoading = true;
        routerEvents$.next(new NavigationCancel(1, '/test', 'reason'));
        expect(component.isLoading).toBe(false);
    });

    it('should set isLoading to false on NavigationError', () => {
        component.isLoading = true;
        routerEvents$.next(new NavigationError(1, '/test', 'error'));
        expect(component.isLoading).toBe(false);
    });

    it('should initialize isLoading to true if getCurrentNavigation returns a value', () => {
        window.history.pushState({}, '', '/dashboard');

        // Test constructor logic directly to avoid TestBed set up complexity for this specific case
        const mockRouter = {
            events: new Subject(),
            getCurrentNavigation: () => ({ id: 1, initialUrl: '/loading' })
        } as any;

        const comp = new RouteLoaderComponent(mockRouter, document);
        expect(comp.isLoading).toBe(true);
    });

    it('should suppress an active startup navigation on public startup routes', () => {
        window.history.pushState({}, '', '/guides');
        const mockRouter = {
            events: new Subject(),
            getCurrentNavigation: () => ({ id: 1, initialUrl: '/guides' })
        } as any;

        const comp = new RouteLoaderComponent(mockRouter, document);

        expect(comp.isLoading).toBe(false);
    });

    it('should show an active startup navigation on dynamic share routes', () => {
        window.history.pushState({}, '', '/share/event/user-1/event-1');
        const mockRouter = {
            events: new Subject(),
            getCurrentNavigation: () => ({ id: 1, initialUrl: '/share/event/user-1/event-1' })
        } as any;

        const comp = new RouteLoaderComponent(mockRouter, document);

        expect(comp.isLoading).toBe(true);
    });

    it('should suppress only the same-document startup navigation on public routes', () => {
        window.history.pushState({}, '', '/features');
        const events$ = new Subject<RouterEvent>();
        const mockRouter = {
            events: events$.asObservable(),
            getCurrentNavigation: () => null
        } as any;
        const comp = new RouteLoaderComponent(mockRouter, document);

        events$.next(new NavigationStart(1, '/features'));
        expect(comp.isLoading).toBe(false);

        events$.next(new NavigationStart(2, '/features/ai-insights'));
        expect(comp.isLoading).toBe(true);
    });
});
