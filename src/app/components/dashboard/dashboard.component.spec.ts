import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashboardComponent } from './dashboard.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppEventService } from '../../services/app.event.service';
import { AppUserService } from '../../services/app.user.service';
import { Router, ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { User } from '@sports-alliance/sports-lib';
import { AppUserInterface } from '../../models/app-user.interface';
import { Analytics } from '@angular/fire/analytics';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { EventInterface } from '@sports-alliance/sports-lib';

describe('DashboardComponent', () => {
    let component: DashboardComponent;
    let fixture: ComponentFixture<DashboardComponent>;

    let mockAuthService: any;
    let mockEventService: any;
    let mockUserService: any;
    let mockRouter: any;
    let mockActivatedRoute: any;
    let mockDialog: any;
    let mockSnackBar: any;

    const mockUser = new User('testUser') as AppUserInterface;
    mockUser.settings = {
        dashboardSettings: {
            dateRange: 0,
            startDate: null,
            endDate: null,
            activityTypes: [],
            tableSettings: {}
        },
        unitSettings: { startOfTheWeek: 1 },
        chartSettings: {}
    } as any;

    beforeEach(async () => {
        mockAuthService = {
            user$: of(mockUser),

        };

        mockEventService = {
            getEventsBy: vi.fn().mockReturnValue(of([{ id: 'event1' }]))
        };

        mockUserService = {
            getUserByID: vi.fn().mockReturnValue(of(new User('targetUser'))),
            shouldShowPromo: vi.fn().mockReturnValue(false),
            updateUserProperties: vi.fn().mockReturnValue(Promise.resolve())
        };

        mockRouter = { navigate: vi.fn() };

        mockActivatedRoute = {
            snapshot: {
                paramMap: {
                    get: (key: string) => null
                },
                data: {
                    dashboardData: {
                        events: [{ id: 'event1' }]
                    }
                }
            }
        };

        mockDialog = { open: vi.fn() };
        mockSnackBar = { open: vi.fn() };

        await TestBed.configureTestingModule({
            declarations: [DashboardComponent],
            providers: [
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: Analytics, useValue: null }
            ],
            schemas: [NO_ERRORS_SCHEMA]
        })
            .compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(DashboardComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    it('should use resolved events on init', async () => {
        fixture.detectChanges(); // Trigger ngOnInit
        await fixture.whenStable(); // Wait for async operations to complete

        expect(mockEventService.getEventsBy).toHaveBeenCalled();
        expect(component.events.length).toBe(1);
        expect(component.isLoading).toBe(false);
    });

    it('should attach initial live query when resolver already returned user data', async () => {
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.events = [{ id: 'event1' }];

        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockEventService.getEventsBy).toHaveBeenCalled();
        expect(component.events.length).toBe(1);
    });

    it('should skip only the first identical live emission and then update on subsequent changes', async () => {
        const resolvedEvents = [{ id: 'event1' }] as any;
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.events = resolvedEvents;

        const eventsSubject = new BehaviorSubject([{ id: 'event1' }] as any);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events).toBe(resolvedEvents);

        const updatedEvents = [{ id: 'event1' }, { id: 'event2' }] as any;
        eventsSubject.next(updatedEvents);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events).toEqual(updatedEvents);
        expect(component.events).not.toBe(resolvedEvents);
    });

    it('should stay live-reactive after cache-backed resolver data', async () => {
        mockActivatedRoute.snapshot.data.dashboardData.user = mockUser;
        mockActivatedRoute.snapshot.data.dashboardData.events = [{ id: 'event1' }];
        mockActivatedRoute.snapshot.data.dashboardData.eventsSource = 'cache';

        const eventsSubject = new BehaviorSubject([{ id: 'event1' }] as any);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        eventsSubject.next([{ id: 'event1' }, { id: 'event2' }] as any);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events.length).toBe(2);
        expect((component.events[1] as any).id).toBe('event2');
    });

    it('should update events when service emits new data', async () => {
        const eventsSubject = new BehaviorSubject([{ id: 'event1' }]);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        // Initial state
        expect(component.events.length).toBe(1);
        expect((component.events[0] as any).id).toBe('event1');

        // Emit new data
        eventsSubject.next([{ id: 'event1' }, { id: 'event2' }]);
        fixture.detectChanges();
        await fixture.whenStable();

        // Should update
        expect(component.events.length).toBe(2);
        expect((component.events[1] as any).id).toBe('event2');
    });

    it('should not have throttle delay on data loading', async () => {
        // This test ensures that data is available immediately (in same tick or microtask) 
        // without needing to advance time by a large amount (e.g. 2000ms).
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events).toBeDefined();
        expect(component.events.length).toBeGreaterThan(0);
    });

    it('should handle circular references in events safely during comparison', async () => {
        const event1: any = {
            getID: () => 'event1',
            name: 'Event 1',
            startDate: new Date(1000),
            toJSON: () => ({ id: 'event1' })
        };
        // Create a circular reference
        event1.self = event1;

        const eventsSubject = new BehaviorSubject([event1]);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events.length).toBe(1);

        // This should not throw 'Converting circular structure to JSON'
        expect(() => {
            eventsSubject.next([event1]);
            fixture.detectChanges();
        }).not.toThrow();
    });

    it('should update when an event is renamed or its date changes', async () => {
        class MockEvent {
            constructor(public id: string, public name: string, public startDate: Date) { }
            getID() { return this.id; }
            getActivityTypesAsArray() { return []; }
            toJSON() { return {}; }
        }

        const date1 = new Date(2024, 1, 1);
        const event1 = new MockEvent('e1', 'Original Name', date1) as any;

        const eventsSubject = new BehaviorSubject([event1]);
        mockEventService.getEventsBy.mockReturnValue(eventsSubject.asObservable());

        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.events[0].name).toBe('Original Name');

        // 1. Update with same data (should not trigger change if we were strictly checking, 
        // but here we check if it updates the property if we were to just re-assign)
        const event1Same = new MockEvent('e1', 'Original Name', date1) as any;
        eventsSubject.next([event1Same]);
        fixture.detectChanges();
        // Since they are "equal" by our logic, component.events shouldn't change reference 
        // if we were being super strict, but actually distinctUntilChanged prevents the 
        // subscribe block from running.

        // 2. Update name
        const event1Renamed = new MockEvent('e1', 'New Name', date1) as any;
        eventsSubject.next([event1Renamed]);
        fixture.detectChanges();
        expect(component.events[0].name).toBe('New Name');

        // 3. Update date
        const date2 = new Date(2024, 1, 2);
        const event1NewDate = new MockEvent('e1', 'New Name', date2) as any;
        eventsSubject.next([event1NewDate]);
        fixture.detectChanges();
        expect(component.events[0].startDate.getTime()).toBe(date2.getTime());
    });
});
