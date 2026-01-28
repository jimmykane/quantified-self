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

    const mockUser = new User('testUser');
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
});
