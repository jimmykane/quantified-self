import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { EventTableComponent } from './event.table.component';
import { AppEventService } from '../../services/app.event.service';
import { AppUserService } from '../../services/app.user.service';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, Subject, delay } from 'rxjs';
import { User, EventInterface } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Analytics } from '@angular/fire/analytics';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

// Mock Analytics module
vi.mock('@angular/fire/analytics', () => ({
    Analytics: class { },
    logEvent: vi.fn()
}));

// Mock Event Interface
class MockEvent {
    constructor(public id: string) { }
    getID() { return this.id; }
    getStatsAsArray() { return []; }
    getStat() { return null; }
    getActivityTypesAsString() { return 'Run'; }
    getActivityTypesAsArray() { return []; }
    getDeviceNamesAsString() { return ''; }
    isMerge = false;
    startDate = new Date();
    privacy = 'public';
    name = 'Test Run';
    description = 'Test Description';
    toJSON() { return {}; }
}

describe('EventTableComponent', () => {
    let component: EventTableComponent;
    let fixture: ComponentFixture<EventTableComponent>;

    let mockEventService: any;
    let mockUserService: any;
    let mockRouter: any;
    let mockDialog: any;
    let mockSnackBar: any;
    let mockBottomSheet: any;
    let mockColorService: any;

    const mockUser = new User('testUser');
    mockUser.settings = {
        dashboardSettings: {
            tableSettings: {
                selectedColumns: []
            }
        },
        unitSettings: { startOfTheWeek: 1 }
    } as any;

    beforeEach(async () => {
        mockEventService = {
            deleteAllEventData: vi.fn().mockReturnValue(Promise.resolve(true)),
            getEventActivitiesAndAllStreams: vi.fn(),
            writeAllEventData: vi.fn(),
            downloadFile: vi.fn()
        };

        mockUserService = {
            updateUserProperties: vi.fn().mockReturnValue(Promise.resolve())
        };

        mockRouter = { navigate: vi.fn() };
        mockDialog = { open: vi.fn() };
        mockSnackBar = { open: vi.fn() };

        mockBottomSheet = {
            open: vi.fn().mockReturnValue({
                afterDismissed: () => of(true).pipe(delay(1))
            })
        };

        mockColorService = {
            getColorForActivityTypeByActivityTypeGroup: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [NoopAnimationsModule],
            declarations: [EventTableComponent],
            providers: [
                { provide: Analytics, useValue: {} },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: Router, useValue: mockRouter },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: MatBottomSheet, useValue: mockBottomSheet },
                { provide: AppEventColorService, useValue: mockColorService },
                DatePipe
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EventTableComponent);
        component = fixture.componentInstance;
        component.user = mockUser;
        component.events = [
            new MockEvent('event1') as any,
            new MockEvent('event2') as any,
            new MockEvent('event3') as any
        ];

        // Mock ViewChildren
        component.sort = {
            sortChange: new Subject(),
            active: '',
            direction: ''
        } as any;

        component.paginator = {
            _changePageSize: vi.fn()
        } as any;

        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should initialize data source with events', () => {
        component.ngAfterViewInit();
        expect(component.data.data.length).toBe(3);
    });

    // it('should remove deleted events from view after deleteSelection', fakeAsync(() => {
    //     // Initialize View
    //     component.ngAfterViewInit();

    //     // Select 'event2'
    //     const event2Row = component.data.data.find((row: any) => row['Event'].getID() === 'event2');
    //     component.selection.select(event2Row);

    //     expect(component.selection.selected.length).toBe(1);

    //     // Trigger Delete
    //     component.deleteSelection();
    //     tick(1); // Wait for delay(1) of dialog
    //     tick(); // Wait for promise resolution

    //     expect(mockEventService.deleteAllEventData).toHaveBeenCalledWith(mockUser, 'event2');

    //     expect(component.events.length).toBe(2);
    //     expect(component.events.find(e => e.getID() === 'event2')).toBeUndefined();

    //     expect(component.data.data.length).toBe(2);
    //     expect(component.data.data.find((row: any) => row['Event'].getID() === 'event2')).toBeUndefined();
    // }));
});
