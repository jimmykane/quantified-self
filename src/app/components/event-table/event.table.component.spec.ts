import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { EventTableComponent, MatPaginatorIntlFireStore } from './event.table.component';
import { AppEventService } from '../../services/app.event.service';
import { AppEventMergeService } from '../../services/app.event-merge.service';
import { AppUserService } from '../../services/app.user.service';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { AppFileService } from '../../services/app.file.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, Subject, delay } from 'rxjs';
import { User, EventInterface, DataPace, DataGradeAdjustedPace, DataSpeedAvg, ActivityTypes } from '@sports-alliance/sports-lib';
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
    originalFiles: any[] = [];
    originalFile: any = null;
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
    let mockFileService: any;
    let mockProcessingService: any;
    let mockEventMergeService: any;
    let mockAnalyticsService: any;

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
            downloadFile: vi.fn().mockReturnValue(Promise.resolve(new ArrayBuffer(8))),
            updateEventProperties: vi.fn().mockResolvedValue(undefined),
        };
        mockEventMergeService = {
            mergeEvents: vi.fn().mockResolvedValue({ eventId: 'merged-event' }),
            getMergeErrorMessage: vi.fn().mockReturnValue('Could not merge events.'),
        };

        mockUserService = {
            updateUserProperties: vi.fn().mockReturnValue(Promise.resolve())
        };

        mockRouter = { navigate: vi.fn() };
        mockDialog = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(null),
                componentInstance: { mergeRequested: of('benchmark'), isMerging: false },
                disableClose: false,
                close: vi.fn()
            })
        };
        mockSnackBar = { open: vi.fn() };

        mockBottomSheet = {
            open: vi.fn().mockReturnValue({
                afterDismissed: () => of(true)
            })
        };

        mockColorService = {
            getColorForActivityTypeByActivityTypeGroup: vi.fn(),
            getGradientForActivityTypeGroup: vi.fn()
        };

        mockFileService = {
            downloadAsZip: vi.fn().mockReturnValue(Promise.resolve()),
            downloadFile: vi.fn(),
            toDate: vi.fn((rawDate: any) => {
                if (!rawDate) return null;
                if (rawDate instanceof Date) return rawDate;
                if (rawDate.toDate && typeof rawDate.toDate === 'function') return rawDate.toDate();
                if (typeof rawDate === 'number') return new Date(rawDate);
                if (typeof rawDate === 'string') return new Date(rawDate);
                return null;
            }),
            generateDateBasedFilename: vi.fn((date, extension, index, totalFiles, fallbackId) => {
                const datePipe = new DatePipe('en-US');
                const dateStr = date ? datePipe.transform(date, 'yyyy-MM-dd_HH-mm') : null;
                const baseStr = dateStr || fallbackId || 'activity';
                if (index !== undefined && totalFiles !== undefined && totalFiles > 1) {
                    return `${baseStr}_${index}.${extension}`;
                }
                return `${baseStr}.${extension}`;
            }),
            generateDateRangeZipFilename: vi.fn((minDate, maxDate, suffix = 'originals') => {
                const datePipe = new DatePipe('en-US');
                const startStr = minDate ? datePipe.transform(minDate, 'yyyy-MM-dd') : 'unknown';
                const endStr = maxDate ? datePipe.transform(maxDate, 'yyyy-MM-dd') : 'unknown';
                if (startStr === endStr) {
                    return `${startStr}_${suffix}.zip`;
                }
                return `${startStr}_to_${endStr}_${suffix}.zip`;
            }),
            getExtensionFromPath: vi.fn((path, defaultExt = 'fit') => {
                const parts = path.split('.');
                return parts.length > 1 ? parts[parts.length - 1] : defaultExt;
            })
        };

        mockProcessingService = {
            addJob: vi.fn().mockReturnValue('job-id'),
            updateJob: vi.fn(),
            completeJob: vi.fn(),
            failJob: vi.fn(),
            removeJob: vi.fn()
        };
        mockAnalyticsService = {
            logEvent: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [NoopAnimationsModule],
            declarations: [EventTableComponent],
            providers: [
                { provide: Analytics, useValue: {} },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppEventMergeService, useValue: mockEventMergeService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: Router, useValue: mockRouter },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: MatBottomSheet, useValue: mockBottomSheet },
                { provide: AppEventColorService, useValue: mockColorService },
                { provide: AppFileService, useValue: mockFileService },
                { provide: AppProcessingService, useValue: mockProcessingService },
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
            _changePageSize: vi.fn(),
            page: new Subject()
        } as any;

        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should call loading and return early in ngOnChanges when events are missing', () => {
        const loadingSpy = vi.spyOn(component as any, 'loading');
        component.events = null as any;

        component.ngOnChanges({
            events: new SimpleChange([], null, false),
        } as any);

        expect(loadingSpy).toHaveBeenCalled();
    });

    it('should update selected columns and page size on user/showActions changes', () => {
        const updateDisplayedColumnsSpy = vi.spyOn(component as any, 'updateDisplayedColumns');
        component.user.settings.dashboardSettings.tableSettings.selectedColumns = ['Name', 'Start Date'];
        component.user.settings.dashboardSettings.tableSettings.eventsPerPage = 25;

        component.ngOnChanges({
            user: new SimpleChange(null, component.user, false),
            showActions: new SimpleChange(false, true, false),
        } as any);

        expect(component.selectedColumns).toEqual(['Name', 'Start Date']);
        expect(component.paginator._changePageSize).toHaveBeenCalledWith(25);
        expect(updateDisplayedColumnsSpy).toHaveBeenCalled();
    });

    it('should not change paginator page size when already in sync', () => {
        const updateDisplayedColumnsSpy = vi.spyOn(component as any, 'updateDisplayedColumns');
        component.user.settings.dashboardSettings.tableSettings.selectedColumns = ['Name', 'Start Date'];
        component.user.settings.dashboardSettings.tableSettings.eventsPerPage = 25;
        (component.paginator as any).pageSize = 25;

        component.ngOnChanges({
            user: new SimpleChange(null, component.user, false),
        } as any);

        expect(component.paginator._changePageSize).not.toHaveBeenCalled();
        expect(updateDisplayedColumnsSpy).toHaveBeenCalled();
    });

    it('should not persist page size when page event does not change size', async () => {
        component.user.settings.dashboardSettings.tableSettings.eventsPerPage = 25;

        await component.pageChanges({ pageSize: 25 } as any);

        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    });

    it('should initialize data source with events', () => {
        component.ngAfterViewInit();
        expect(component.data.data.length).toBe(3);
    });

    it('should reuse cached row models when the next event list contains the same event instances', () => {
        const initialRows = [...component.data.data];
        const getStatsRowElementSpy = vi.spyOn(component, 'getStatsRowElement');

        component.events = [...component.events];

        (component as any).processChanges('spec_cached_rows');

        expect(getStatsRowElementSpy).not.toHaveBeenCalled();
        expect(component.data.data).toHaveLength(initialRows.length);
        expect(component.data.data[0]).toBe(initialRows[0]);
        expect(component.data.data[1]).toBe(initialRows[1]);
        expect(component.data.data[2]).toBe(initialRows[2]);
    });

    it('should rebuild only rows whose event identity changed', () => {
        const initialRows = [...component.data.data];
        const updatedEvent = new MockEvent('event2') as any;
        updatedEvent.name = 'Updated Event 2';
        const getStatsRowElementSpy = vi.spyOn(component, 'getStatsRowElement');

        component.events = [
            component.events[0],
            updatedEvent,
            component.events[2],
        ];

        (component as any).processChanges('spec_partial_row_rebuild');

        expect(getStatsRowElementSpy).toHaveBeenCalledTimes(1);
        expect(component.data.data[0]).toBe(initialRows[0]);
        expect(component.data.data[1]).not.toBe(initialRows[1]);
        expect(component.data.data[2]).toBe(initialRows[2]);
        expect((component.data.data[1] as any).Name).toBe('Updated Event 2');
    });

    it('should support comma-separated search terms', () => {
        component.ngAfterViewInit();
        const row = component.data.data[0] as any;

        expect(component.data.filterPredicate(row, 'test run,missing')).toBe(true);
        expect(component.data.filterPredicate(row, 'missing,test description')).toBe(true);
        expect(component.data.filterPredicate(row, 'missing,unknown')).toBe(false);
    });

    it('should patch-save event description via updateEventProperties', async () => {
        const event = new MockEvent('event-description') as any;

        await component.saveEventDescription('Updated Description', event);

        expect(mockEventService.updateEventProperties).toHaveBeenCalledWith(
            mockUser,
            'event-description',
            { description: 'Updated Description' }
        );
        expect(mockSnackBar.open).toHaveBeenCalledWith('Event saved', undefined, { duration: 2000 });
    });

    it('should patch-save event name via updateEventProperties', async () => {
        const event = new MockEvent('event-name') as any;

        await component.saveEventName('Updated Name', event);

        expect(mockEventService.updateEventProperties).toHaveBeenCalledWith(
            mockUser,
            'event-name',
            { name: 'Updated Name' }
        );
        expect(mockSnackBar.open).toHaveBeenCalledWith('Event saved', undefined, { duration: 2000 });
    });

    it('should process rows with multisport fallback color and skip null events', () => {
        const multiEvent = new MockEvent('multi');
        (multiEvent as any).getActivityTypesAsArray = () => ['Running', 'Cycling'];
        (multiEvent as any).getActivityTypesAsString = () => 'Running,Cycling';
        (multiEvent as any).getStat = (_type: string) => ({ getValue: () => ['Running', 'Cycling'] });
        component.events = [null as any, multiEvent as any];

        (component as any).processChanges('spec_multisport');

        expect(component.data.data.length).toBe(1);
        expect(mockColorService.getColorForActivityTypeByActivityTypeGroup)
            .toHaveBeenCalledWith(ActivityTypes.Multisport);
    });

    it('should unsubscribe tracked subscriptions on destroy', () => {
        const deleteSub = { unsubscribe: vi.fn() } as any;
        const searchSub = { unsubscribe: vi.fn() } as any;
        const sortSub = { unsubscribe: vi.fn() } as any;
        const breakpointSub = { unsubscribe: vi.fn() } as any;

        (component as any).deleteConfirmationSubscription = deleteSub;
        (component as any).searchSubscription = searchSub;
        (component as any).sortSubscription = sortSub;
        (component as any).breakpointSubscription = breakpointSub;

        component.ngOnDestroy();

        expect(deleteSub.unsubscribe).toHaveBeenCalledTimes(1);
        expect(searchSub.unsubscribe).toHaveBeenCalledTimes(1);
        expect(sortSub.unsubscribe).toHaveBeenCalledTimes(1);
        expect(breakpointSub.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('should call mergeSelection', async () => {
        const e1 = new MockEvent('event1');
        const e2 = new MockEvent('event2');
        component.selection.select({ 'Event': e1 } as any);
        component.selection.select({ 'Event': e2 } as any);
        fixture.detectChanges();

        await component.mergeSelection(new Event('click'));

        expect(mockEventMergeService.mergeEvents).toHaveBeenCalledWith(['event1', 'event2'], 'benchmark');
        expect(mockRouter.navigate).toHaveBeenCalled();
    });

    it('should show snackbar when trying to merge fewer than two events', async () => {
        component.selection.clear();

        await component.mergeSelection(new Event('click'));

        expect(mockSnackBar.open).toHaveBeenCalledWith('Select at least two events to merge', undefined, { duration: 2000 });
        expect(mockEventMergeService.mergeEvents).not.toHaveBeenCalled();
    });

    it('should abort merge when dialog closes without selection', async () => {
        const e1 = new MockEvent('event1');
        const e2 = new MockEvent('event2');
        component.selection.select({ 'Event': e1 } as any);
        component.selection.select({ 'Event': e2 } as any);
        mockDialog.open.mockReturnValueOnce({
            componentInstance: { mergeRequested: of(null), isMerging: false },
            afterClosed: () => of(null),
            disableClose: false,
            close: vi.fn(),
        });

        await component.mergeSelection(new Event('click'));

        expect(mockEventMergeService.mergeEvents).not.toHaveBeenCalled();
    });

    it('should show snackbar when selected rows do not contain at least two valid event IDs', async () => {
        component.selection.select({ Event: { getID: () => undefined } } as any);
        component.selection.select({ Event: { getID: () => 'event2' } } as any);

        await component.mergeSelection(new Event('click'));

        expect(mockEventMergeService.mergeEvents).not.toHaveBeenCalled();
        expect(mockSnackBar.open).toHaveBeenCalledWith('Not enough events to merge', undefined, { duration: 3000 });
    });

    it('should pass multi merge mode to backend service', async () => {
        const e1 = new MockEvent('event1');
        const e2 = new MockEvent('event2');
        component.selection.select({ 'Event': e1 } as any);
        component.selection.select({ 'Event': e2 } as any);
        mockDialog.open.mockReturnValueOnce({
            componentInstance: { mergeRequested: of('multi'), isMerging: false },
            afterClosed: () => of(null),
            disableClose: false,
            close: vi.fn(),
        });

        await component.mergeSelection(new Event('click'));

        expect(mockEventMergeService.mergeEvents).toHaveBeenCalledWith(['event1', 'event2'], 'multi');
    });

    it('should show mapped error message when backend merge fails', async () => {
        const e1 = new MockEvent('event1');
        const e2 = new MockEvent('event2');
        component.selection.select({ 'Event': e1 } as any);
        component.selection.select({ 'Event': e2 } as any);
        mockEventMergeService.mergeEvents.mockRejectedValueOnce(new Error('boom'));
        mockEventMergeService.getMergeErrorMessage.mockReturnValueOnce('Mapped merge error');

        await component.mergeSelection(new Event('click'));

        expect(mockSnackBar.open).toHaveBeenCalledWith('Mapped merge error', undefined, { duration: 5000 });
    });

    describe('deleteSelection', () => {
        it('should abort delete when confirmation dialog is cancelled', async () => {
            const e1 = new MockEvent('event1');
            component.selection.select({ Event: e1 } as any);
            mockDialog.open.mockReturnValueOnce({
                afterClosed: () => of(false),
            });

            await component.deleteSelection();
            await Promise.resolve();

            expect(mockEventService.deleteAllEventData).not.toHaveBeenCalled();
        });

        it('should delete selected events and refresh local table when confirmed', async () => {
            const e1 = new MockEvent('event1');
            const e2 = new MockEvent('event2');
            component.events = [e1 as any, e2 as any, new MockEvent('event3') as any];
            component.selection.select({ Event: e1 } as any);
            component.selection.select({ Event: e2 } as any);
            const processChangesSpy = vi.spyOn(component as any, 'processChanges');

            mockDialog.open.mockReturnValueOnce({
                afterClosed: () => of(true),
            });

            await component.deleteSelection();
            await Promise.resolve();

            expect(mockEventService.deleteAllEventData).toHaveBeenCalledTimes(2);
            expect(mockEventService.deleteAllEventData).toHaveBeenCalledWith(component.user, 'event1');
            expect(mockEventService.deleteAllEventData).toHaveBeenCalledWith(component.user, 'event2');
            expect(component.events.map((event: any) => event.getID())).toEqual(['event3']);
            expect(processChangesSpy).toHaveBeenCalledWith('after_delete_selection');
            expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('delete_events');
            expect(mockSnackBar.open).toHaveBeenCalledWith('Events deleted', undefined, { duration: 2000 });
        });
    });

    describe('downloadOriginals', () => {
        it('should show message when no events are selected', async () => {
            component.selection.clear();
            await component.downloadOriginals();
            expect(mockSnackBar.open).toHaveBeenCalledWith('No events selected', undefined, { duration: 2000 });
        });

        it('should show message when selected events have no original files', async () => {
            const e1 = new MockEvent('event1');
            e1.originalFiles = [];
            e1.originalFile = null;
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockSnackBar.open).toHaveBeenCalledWith('No original files available for selected events', undefined, { duration: 3000 });
        });

        it('should download and zip files from events with originalFiles array', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-01');
            e1.originalFiles = [
                { path: 'users/123/files/activity1.fit' },
                { path: 'users/123/files/activity2.fit' }
            ];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockEventService.downloadFile).toHaveBeenCalledTimes(2);
            expect(mockEventService.downloadFile).toHaveBeenCalledWith('users/123/files/activity1.fit');
            expect(mockEventService.downloadFile).toHaveBeenCalledWith('users/123/files/activity2.fit');
            expect(mockFileService.downloadAsZip).toHaveBeenCalled();
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith(expect.any(String), 'Downloaded 2 files');
        });

        it('should download single file directly from events with legacy originalFile', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15');
            e1.originalFiles = [];
            e1.originalFile = { path: 'users/123/files/legacy.fit' };
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockEventService.downloadFile).toHaveBeenCalledWith('users/123/files/legacy.fit');
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith(expect.any(String), 'Downloaded 1 file');
        });

        it('should generate correct ZIP filename from date range', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-01');
            e1.originalFiles = [{ path: 'users/123/files/file1.fit' }];

            const e2 = new MockEvent('event2');
            e2.startDate = new Date('2024-12-25');
            e2.originalFiles = [{ path: 'users/123/files/file2.fit' }];

            component.selection.select({ 'Event': e1 } as any);
            component.selection.select({ 'Event': e2 } as any);

            await component.downloadOriginals();

            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                expect.any(Array),
                '2024-12-01_to_2024-12-25_originals.zip'
            );
        });

        it('should name files using activity-specific dates for merged events', async () => {
            const e1 = new MockEvent('merged_event');
            e1.startDate = new Date('2024-12-25'); // Merged event date
            e1.originalFiles = [
                { path: 'users/123/files/act1.fit', startDate: new Date('2024-12-20T10:00:00') },
                { path: 'users/123/files/act2.fit', startDate: new Date('2024-12-22T07:30:00') },
                { path: 'users/123/files/act3.fit' } // No per-file date, should fallback to merged event date
            ];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ fileName: expect.stringMatching(/2024-12-20_.*\.fit/) }),
                    expect.objectContaining({ fileName: expect.stringMatching(/2024-12-22_.*\.fit/) }),
                    expect.objectContaining({ fileName: expect.stringMatching(/2024-12-25_.*_3\.fit/) })
                ]),
                expect.any(String)
            );
        });

        it('should name single file using event date format and download directly', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15T08:30:00');
            e1.originalFiles = [{ path: 'users/123/files/activity.fit' }];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            // Single file should be downloaded directly, not zipped
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            // Check that the filename was generated correctly (basename without extension)
            const args = mockFileService.downloadFile.mock.calls[0];
            expect(args[1]).toBe('2024-12-15_08-30'); // basename
            expect(args[2]).toBe('fit'); // extension
        });

        it('should handle Firestore Timestamp objects with single file direct download', async () => {
            const e1 = new MockEvent('event1');
            // Simulate Firestore Timestamp with toDate() method
            (e1 as any).startDate = {
                toDate: () => new Date('2024-12-20T14:45:00')
            };
            e1.originalFiles = [{ path: 'users/123/files/activity.fit' }];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            // Single file should be downloaded directly
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            const args = mockFileService.downloadFile.mock.calls[0];
            expect(args[1]).toBe('2024-12-20_14-45'); // basename
            expect(args[2]).toBe('fit'); // extension
        });

        it('should use event ID as fallback for single file when date is missing', async () => {
            const e1 = new MockEvent('test-event-id');
            (e1 as any).startDate = null;
            e1.originalFiles = [{ path: 'users/123/files/activity.fit' }];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            // Single file should be downloaded directly
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            const args = mockFileService.downloadFile.mock.calls[0];
            expect(args[1]).toBe('test-event-id'); // basename falls back to event ID
            expect(args[2]).toBe('fit'); // extension
        });

        it('should handle download errors gracefully and download single remaining file directly', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-01T10:30:00');
            e1.originalFiles = [
                { path: 'users/123/files/good.fit' },
                { path: 'users/123/files/bad.fit' }
            ];
            component.selection.select({ 'Event': e1 } as any);

            // First call succeeds, second fails
            mockEventService.downloadFile
                .mockResolvedValueOnce(new ArrayBuffer(8))
                .mockRejectedValueOnce(new Error('Download failed'));

            await component.downloadOriginals();

            // Only 1 file succeeded, so it should be downloaded directly (not zipped)
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith(expect.any(String), 'Downloaded 1 file');
        });
    });

    describe('downloadOriginals - Compression Handling', () => {
        it('should correctly name downloaded .gz files with base extension and download directly', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15T10:00:00');
            e1.originalFiles = [
                { path: 'users/123/files/activity.json.gz', startDate: new Date('2024-12-15T10:00:00') }
            ];
            component.selection.select({ 'Event': e1 } as any);

            // Mock to return base extension
            mockFileService.getExtensionFromPath = vi.fn().mockReturnValue('json');

            await component.downloadOriginals();

            // Single file should be downloaded directly with json extension
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            const args = mockFileService.downloadFile.mock.calls[0];
            expect(args[2]).toBe('json'); // extension should be json, not json.gz
        });

        it('should handle deeply nested paths', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15');
            e1.originalFiles = [
                { path: 'users/abc123/events/xyz789/subdir/nested/original.tcx.gz' }
            ];
            component.selection.select({ 'Event': e1 } as any);

            mockFileService.getExtensionFromPath = vi.fn().mockReturnValue('tcx');

            await component.downloadOriginals();

            expect(mockEventService.downloadFile).toHaveBeenCalledWith(
                'users/abc123/events/xyz789/subdir/nested/original.tcx.gz'
            );
        });

        it('should handle unicode in file paths', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15');
            e1.originalFiles = [
                { path: 'users/用户/events/活动/original.gpx.gz' }
            ];
            component.selection.select({ 'Event': e1 } as any);

            mockFileService.getExtensionFromPath = vi.fn().mockReturnValue('gpx');

            await component.downloadOriginals();

            expect(mockEventService.downloadFile).toHaveBeenCalledWith(
                'users/用户/events/活动/original.gpx.gz'
            );
        });
    });



    describe('Dashboard GAP Display', () => {
        it('should exclude Grade Adjusted Pace from Average Speed column', () => {
            const e1 = new MockEvent('event1');
            (e1 as any).getStatsAsArray = () => [
                { getType: () => DataPace.type, getValue: () => 300, getDisplayValue: () => '5:00', getDisplayUnit: () => ' min/km' } as any,
                { getType: () => 'Average Grade Adjusted Pace', getValue: () => 295, getDisplayValue: () => '4:55', getDisplayUnit: () => ' min/km' } as any,
            ];
            (e1 as any).getActivityTypesAsString = () => 'Running';
            (e1 as any).getActivityTypesAsArray = () => ['Running'];
            (e1 as any).getStat = (type: string) => {
                if (type === 'Activity Types') {
                    return { getValue: () => ['Running'] };
                }
                return null;
            };

            component.events = [e1 as any];

            (component as any).processChanges();

            const row = component.data.data[0];
            const paceValue = row[DataSpeedAvg.type];

            expect(paceValue).not.toContain('4:55');
            expect(paceValue).toBeDefined();
        });
    });

    describe('Selection Limits', () => {
        it('should prevent downloadOriginals and show snackbar if more than 20 events are selected', async () => {
            const events = Array.from({ length: 21 }, (_, i) => new MockEvent(`event${i}`));
            events.forEach(e => component.selection.select({ 'Event': e } as any));

            await component.downloadOriginals();

            expect(mockSnackBar.open).toHaveBeenCalledWith('Cannot download more than 20 events at once', 'Close', { duration: 3000 });
            expect(mockProcessingService.addJob).not.toHaveBeenCalled();
        });

        it('should prevent downloadAsCSV and show snackbar if more than 20 events are selected', () => {
            const events = Array.from({ length: 21 }, (_, i) => new MockEvent(`event${i}`));
            events.forEach(e => component.selection.select({ 'Event': e } as any));

            component.downloadAsCSV(new Event('click'));

            expect(mockSnackBar.open).toHaveBeenCalledWith('Cannot download more than 20 events at once', 'Close', { duration: 3000 });
            expect(mockDialog.open).not.toHaveBeenCalled();
        });

        it('should allow downloadOriginals if 20 or fewer events are selected', async () => {
            const events = Array.from({ length: 20 }, (_, i) => new MockEvent(`event${i}`));
            events.forEach(e => {
                e.originalFiles = [{ path: `path/to/${e.id}.fit` }];
                component.selection.select({ 'Event': e } as any);
            });

            await component.downloadOriginals();

            expect(mockProcessingService.addJob).toHaveBeenCalled();
        });

        it('should allow downloadAsCSV if 20 or fewer events are selected', () => {
            const events = Array.from({ length: 20 }, (_, i) => new MockEvent(`event${i}`));
            events.forEach(e => component.selection.select({ 'Event': e } as any));

            component.downloadAsCSV(new Event('click'));

            expect(mockDialog.open).toHaveBeenCalled();
        });
    });

    it('should expose custom paginator labels', () => {
        const intl = new MatPaginatorIntlFireStore();
        expect(intl.itemsPerPageLabel).toBe('Items');
        expect(intl.nextPageLabel).toBe('Next');
        expect(intl.previousPageLabel).toBe('Previous');
    });
});
