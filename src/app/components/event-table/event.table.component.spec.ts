import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
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
import { User, EventInterface, EventUtilities } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Analytics } from '@angular/fire/analytics';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

// Mock MatTableDataSource
vi.mock('@angular/material/table', () => ({
    MatTableDataSource: class {
        data = [];
        paginator = null;
        sort = null;
        sortingDataAccessor = null;
        filter = '';
        connect() { return of([]); }
        disconnect() { }
    }
}));
// Mock Analytics module
vi.mock('@angular/fire/analytics', () => ({
    Analytics: class { },
    logEvent: vi.fn()
}));

class MockActivity {
    startDate = new Date();
    endDate = new Date();
    type = 'Run';
    creator = { name: 'Garmin' };
    getStartDate() { return this.startDate; }
    toJSON() { return {}; }
    getID() { return 'activity1'; }
    setID(id: any) { return this; }
    getStats() { return []; }
}

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
    getFirstActivity() { return new MockActivity(); }
    getStartDate() { return this.startDate; }
    getActivities() { return [new MockActivity()]; }
    clearActivities() { }
    addActivities() { }
    setName(name: string) { this.name = name; return this; }
    getPrivacy() { return this.privacy; }
    getName() { return this.name; }
    getDescription() { return this.description; }
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
            getEventActivitiesAndAllStreams: vi.fn().mockReturnValue(of(new MockEvent('event_mocked'))),
            writeAllEventData: vi.fn().mockReturnValue(Promise.resolve()),
            downloadFile: vi.fn().mockReturnValue(Promise.resolve(new ArrayBuffer(8)))
        };

        mockUserService = {
            updateUserProperties: vi.fn().mockReturnValue(Promise.resolve())
        };

        mockRouter = { navigate: vi.fn() };
        mockDialog = { open: vi.fn() };
        mockSnackBar = { open: vi.fn() };

        mockBottomSheet = {
            open: vi.fn().mockReturnValue({
                afterDismissed: () => of(true)
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

        // Ensure mock is set
        mockEventService.getEventActivitiesAndAllStreams.mockReturnValue(of(new MockEvent('event_mocked')));

        // Mock ViewChildren
        component.sort = {
            sortChange: new Subject(),
            active: '',
            direction: ''
        } as any;

        component.paginator = {
            _changePageSize: vi.fn(),
            page: new Subject()
        } as any;

        fixture.detectChanges();

        // Spy on EventUtilities.mergeEvents
        vi.spyOn(EventUtilities, 'mergeEvents').mockReturnValue(new MockEvent('merged_event') as any);
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should initialize data source with events', () => {
        component.ngAfterViewInit();
        expect(component.data.data.length).toBe(3);
    });

    it('should call mergeSelection', async () => {
        const e1 = new MockEvent('event1');
        const e2 = new MockEvent('event2');
        component.selection.select({ 'Event': e1 } as any);
        component.selection.select({ 'Event': e2 } as any);
        fixture.detectChanges();

        await component.mergeSelection(new Event('click'));

        expect(mockEventService.getEventActivitiesAndAllStreams).toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalled();
    });
});
