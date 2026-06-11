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
import { LoggerService } from '../../services/logger.service';
import { DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, Subject } from 'rxjs';
import { User, DataPace, DataSpeedAvg, ActivityTypes, DataDeviceNames } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Analytics } from 'app/firebase/analytics';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock MatTableDataSource without hiding MatTableModule from shared Material imports.
vi.mock('@angular/material/table', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@angular/material/table')>();
    const { of: observableOf } = await import('rxjs');
    return {
        ...actual,
        MatTableDataSource: class {
            data = [];
            paginator = null;
            sort = null;
            sortingDataAccessor = null;
            filter = '';
            connect() { return observableOf([]); }
            disconnect() { }
        }
    };
});
// Mock Analytics module
vi.mock('app/firebase/analytics', () => ({
    Analytics: class { },
    logEvent: vi.fn()
}));

class MockActivity {
    constructor(
        private id = 'activity1',
        public type = 'Run',
        public creator: { name: string; swInfo?: string } | undefined = { name: 'Garmin' }
    ) { }
    startDate = new Date();
    endDate = new Date();
    getStartDate() { return this.startDate; }
    toJSON() { return {}; }
    getID() { return this.id; }
    setID(_id: any) { return this; }
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
    let mockLogger: any;

    const mockUser = new User('testUser');
    mockUser.settings = {
        dashboardSettings: {
            tableSettings: {
                selectedColumns: []
            }
        },
        appSettings: { theme: 'dark' },
        unitSettings: { startOfTheWeek: 1 }
    } as any;

    beforeEach(async () => {
        mockEventService = {
            deleteAllEventData: vi.fn().mockReturnValue(Promise.resolve(true)),
            downloadFile: vi.fn().mockReturnValue(Promise.resolve(new ArrayBuffer(8))),
            downloadOriginalFile: vi.fn().mockReturnValue(Promise.resolve(new ArrayBuffer(8))),
            getOriginalEventDownloadSources: vi.fn((event: { originalFiles?: any[]; originalFile?: any; startDate?: any; getID?: () => string }) => (
                Array.isArray(event.originalFiles) && event.originalFiles.length > 0
                    ? event.originalFiles
                        .filter((file: any) => !!file?.path)
                        .map((file: any) => ({
                            ...file,
                            eventId: event.getID?.() || null,
                            fallbackDate: file.fallbackDate || file.startDate || event.startDate,
                            downloadFileName: file.downloadFileName || file.originalFilename || file.path?.split('/').filter(Boolean).pop(),
                        }))
                    : event.originalFile?.path ? [{
                        ...event.originalFile,
                        eventId: event.getID?.() || null,
                        fallbackDate: event.originalFile.fallbackDate || event.originalFile.startDate || event.startDate,
                        downloadFileName: event.originalFile.downloadFileName || event.originalFile.originalFilename || event.originalFile.path.split('/').filter(Boolean).pop(),
                    }] : []
            )),
            getEventAsGPXBloB: vi.fn().mockResolvedValue(new Blob(['<gpx></gpx>'], { type: 'application/gpx+xml' })),
            updateEventProperties: vi.fn().mockResolvedValue(undefined),
        };
        mockEventMergeService = {
            mergeEvents: vi.fn().mockResolvedValue({ eventId: 'merged-event' }),
            getMergeErrorMessage: vi.fn().mockReturnValue('Could not merge events.'),
        };

        mockUserService = {
            updateUserProperties: vi.fn().mockReturnValue(Promise.resolve())
        };

        mockRouter = { navigate: vi.fn().mockResolvedValue(true) };
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
            getGradientForActivityTypeGroup: vi.fn(),
            getActivityColor: vi.fn((_activities, activity) => activity.getID() === 'activity1' ? '#ff0000' : '#00ff00')
        };

        mockFileService = {
            downloadAsZip: vi.fn().mockReturnValue(Promise.resolve()),
            downloadFile: vi.fn(),
            downloadNamedFile: vi.fn(),
            toDate: vi.fn((rawDate: any) => {
                if (!rawDate) return null;
                if (rawDate instanceof Date) return rawDate;
                if (rawDate.toDate && typeof rawDate.toDate === 'function') return rawDate.toDate();
                if (typeof rawDate === 'number') return new Date(rawDate);
                if (typeof rawDate === 'string') return new Date(rawDate);
                return null;
            }),
            resolveOriginalSourceFileName: vi.fn((file: { originalFilename?: string; path?: string }, fallbackExtension = 'fit') => {
                const value = file.originalFilename || file.path?.split('/').filter(Boolean).pop();
                return value || `original-file.${fallbackExtension}`;
            }),
            getUniqueFileName: vi.fn((fileName: string, usedNames?: Set<string>) => {
                if (!usedNames) {
                    return fileName;
                }
                let candidate = fileName;
                const lower = () => candidate.toLowerCase();
                if (!usedNames.has(lower())) {
                    usedNames.add(lower());
                    return candidate;
                }
                const lastDotIndex = fileName.lastIndexOf('.');
                const stem = lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName;
                const extension = lastDotIndex > 0 ? fileName.slice(lastDotIndex + 1) : '';
                let suffix = 2;
                do {
                    candidate = extension ? `${stem}_${suffix}.${extension}` : `${stem}_${suffix}`;
                    suffix++;
                } while (usedNames.has(candidate.toLowerCase()));
                usedNames.add(candidate.toLowerCase());
                return candidate;
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
                if (parts.length <= 1) {
                    return defaultExt;
                }
                let extension = parts[parts.length - 1].toLowerCase();
                if (extension === 'gz' && parts.length > 2) {
                    extension = parts[parts.length - 2].toLowerCase();
                }
                return extension;
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
        mockLogger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            captureException: vi.fn(),
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
                { provide: LoggerService, useValue: mockLogger },
                DatePipe
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EventTableComponent);
        component = fixture.componentInstance;
        mockUser.settings = {
            dashboardSettings: {
                tableSettings: {
                    selectedColumns: []
                }
            },
            appSettings: { theme: 'dark' },
            unitSettings: { startOfTheWeek: 1 }
        } as any;
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

    const expectDashboardSettingsWrite = (dashboardSettingsPatch: Record<string, unknown>) => {
        const calls = mockUserService.updateUserProperties.mock.calls;
        const settingsPayload = calls[calls.length - 1][1].settings;
        expect(settingsPayload).toEqual({
            dashboardSettings: dashboardSettingsPatch,
        });
        expect(settingsPayload.appSettings).toBeUndefined();
        expect(settingsPayload.unitSettings).toBeUndefined();
    };

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render a table toolbar with a filter projection slot', () => {
        const toolbar = fixture.nativeElement.querySelector('.table-toolbar') as HTMLElement;
        const mainRow = fixture.nativeElement.querySelector('.table-toolbar-main') as HTMLElement;
        const filtersRow = fixture.nativeElement.querySelector('.table-toolbar-filters') as HTMLElement;
        const searchField = fixture.nativeElement.querySelector('.qs-search-field') as HTMLElement;

        expect(toolbar).toBeTruthy();
        expect(mainRow).toBeTruthy();
        expect(filtersRow).toBeTruthy();
        expect(searchField).toBeTruthy();
        expect(mainRow.contains(filtersRow)).toBe(true);
    });

    it('should render selected-event actions outside the main toolbar row', () => {
        fixture.componentRef.setInput('showActions', true);
        component.selection.select({ Event: new MockEvent('selected') } as any);
        fixture.detectChanges();

        const mainRow = fixture.nativeElement.querySelector('.table-toolbar-main') as HTMLElement;
        const selectionToolbar = fixture.nativeElement.querySelector('.table-selection-toolbar') as HTMLElement;
        const actionButtons = fixture.nativeElement.querySelectorAll('.table-selection-toolbar .bulk-action-button');

        expect(selectionToolbar).toBeTruthy();
        expect(selectionToolbar.textContent).toContain('1 event selected');
        expect(mainRow.contains(selectionToolbar)).toBe(false);
        expect(mainRow.querySelector('.selection-actions')).toBeNull();
        expect(actionButtons.length).toBe(6);
    });

    it('should keep selected-event actions accessible without hover tooltip overlays', () => {
        fixture.componentRef.setInput('showActions', true);
        component.selection.select({ Event: new MockEvent('selected-1') } as any);
        component.selection.select({ Event: new MockEvent('selected-2') } as any);
        fixture.detectChanges();

        const actionButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.table-selection-toolbar .bulk-action-button')
        ) as HTMLButtonElement[];

        expect(actionButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
            'Merge 2 events',
            'Download CSV for 2 events',
            'Download GPX for 2 events',
            'Download original files',
            'Delete 2 events',
            'Clear selection',
        ]);
        expect(actionButtons.every((button) => !button.hasAttribute('mattooltip'))).toBe(true);
    });

    it('should clip selected-event action state layers to their Material buttons', () => {
        const styles = readFileSync(
            join(process.cwd(), 'src/app/components/event-table/event.table.component.scss'),
            'utf8'
        );

        expect(styles).toMatch(/\.bulk-action-button\s*{[\s\S]*overflow:\s*hidden;/);
        expect(styles).toMatch(/\.bulk-action-button\s*{[\s\S]*isolation:\s*isolate;/);
        expect(styles).toMatch(/\.bulk-action-button\s*{[\s\S]*--mat-button-text-state-layer-color:\s*var\(--mat-sys-on-surface\);/);
    });

    it('should avoid backdrop blur on the large table surface under hover overlays', () => {
        const styles = readFileSync(
            join(process.cwd(), 'src/app/components/event-table/event.table.component.scss'),
            'utf8'
        );

        expect(styles).toMatch(/\.table-container\s*{[\s\S]*--qs-glass-panel-blur:\s*0px;/);
        expect(styles).toMatch(/\.table-container\s*{[\s\S]*backdrop-filter:\s*none;/);
        expect(styles).toMatch(/\.table-container\s*{[\s\S]*-webkit-backdrop-filter:\s*none;/);
    });

    it('should clear the contextual table selection', () => {
        component.selection.select({ Event: new MockEvent('selected') } as any);

        component.clearSelection();

        expect(component.selection.selected).toHaveLength(0);
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

    it('should persist page size without writing unrelated user settings', async () => {
        component.user.settings.dashboardSettings.tableSettings.eventsPerPage = 25;

        await component.pageChanges({ pageSize: 50 } as any);

        expectDashboardSettingsWrite({ tableSettings: { eventsPerPage: 50 } });
    });

    it('should persist selected columns without writing unrelated user settings', async () => {
        await component.selectedColumnsChange(['Name', 'Start Date']);

        expectDashboardSettingsWrite({ tableSettings: { selectedColumns: ['Name', 'Start Date'] } });
    });

    it('should persist sort changes without writing unrelated user settings', async () => {
        (component.sort.sortChange as Subject<any>).next({ active: 'startDate', direction: 'asc' });
        await Promise.resolve();

        expectDashboardSettingsWrite({ tableSettings: { active: 'startDate', direction: 'asc' } });
    });

    it('should initialize data source with events', () => {
        component.ngAfterViewInit();
        expect(component.data.data.length).toBe(3);
    });

    it('should build colored device name items from event activities', () => {
        const a1 = new MockActivity('activity1', 'Run', { name: 'Garmin', swInfo: 'Edge' });
        const a2 = new MockActivity('activity2', 'Ride', { name: 'Wahoo' });
        const event = new MockEvent('event-devices') as any;
        event.getActivities = () => [a1, a2];
        event.getDeviceNamesAsString = () => 'Garmin Edge, Wahoo';
        mockColorService.getActivityColor.mockImplementation((_activities, activity) =>
            activity.getID() === 'activity1' ? '#123456' : '#abcdef'
        );
        component.events = [event];

        (component as any).processChanges('spec_device_names');

        const row = component.data.data[0] as any;
        expect(row['Device Names']).toBe('Garmin Edge, Wahoo');
        expect(row['Device Name Items']).toEqual([
            { label: 'Garmin Edge', color: '#123456', trackKey: 'activity1' },
            { label: 'Wahoo', color: '#abcdef', trackKey: 'activity2' },
        ]);
        expect(mockColorService.getActivityColor).toHaveBeenCalledWith([a1, a2], a1);
        expect(mockColorService.getActivityColor).toHaveBeenCalledWith([a1, a2], a2);
    });

    it('should build colored device name items from event device-name stats when activities are not hydrated', () => {
        const event = new MockEvent('event-dashboard-devices') as any;
        event.getActivities = () => [];
        event.getDeviceNamesAsString = () => 'Garmin Edge, Wahoo';
        event.getStat = (type: string) => {
            if (type === DataDeviceNames.type) {
                return { getValue: () => ['Garmin Edge', 'Wahoo'] };
            }
            return null;
        };
        mockColorService.getActivityColor.mockImplementation((_activities, activity) =>
            activity.creator.name === 'Garmin Edge' ? '#123456' : '#abcdef'
        );
        component.events = [event];

        (component as any).processChanges('spec_dashboard_device_names');

        expect((component.data.data[0] as any)['Device Name Items']).toEqual([
            { label: 'Garmin Edge', color: '#123456', trackKey: 'device-name-0-Garmin Edge' },
            { label: 'Wahoo', color: '#abcdef', trackKey: 'device-name-1-Wahoo' },
        ]);
    });

    it('should rebuild cached rows when activity device metadata changes in place', () => {
        const activity = new MockActivity('activity1', 'Run', { name: 'Garmin', swInfo: 'Edge' });
        const event = new MockEvent('event-device-cache') as any;
        event.getActivities = () => [activity];
        event.getDeviceNamesAsString = () => 'Garmin';
        component.events = [event];

        (component as any).processChanges('spec_device_names_initial');
        const initialRow = component.data.data[0] as any;
        activity.creator!.swInfo = 'Fenix';

        (component as any).processChanges('spec_device_names_mutated');

        const updatedRow = component.data.data[0] as any;
        expect(updatedRow).not.toBe(initialRow);
        expect(updatedRow['Device Name Items']).toEqual([
            { label: 'Garmin Fenix', color: '#ff0000', trackKey: 'activity1' },
        ]);
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

    it('should rebuild a cached row when the same event instance is mutated in place', () => {
        const initialRows = [...component.data.data];
        const getStatsRowElementSpy = vi.spyOn(component, 'getStatsRowElement');
        const mutatedEvent = component.events[1] as any;
        mutatedEvent.name = 'Mutated Event 2';
        mutatedEvent.privacy = 'private';
        mutatedEvent.benchmarkResult = { score: 42 };

        (component as any).processChanges('spec_in_place_mutation');

        expect(getStatsRowElementSpy).toHaveBeenCalledTimes(1);
        expect(component.data.data[0]).toBe(initialRows[0]);
        expect(component.data.data[1]).not.toBe(initialRows[1]);
        expect(component.data.data[2]).toBe(initialRows[2]);
        expect((component.data.data[1] as any).Name).toBe('Mutated Event 2');
        expect((component.data.data[1] as any).Privacy).toBe('private');
        expect((component.data.data[1] as any)['Has Benchmark']).toBeTruthy();
    });

    it('should support comma-separated search terms', () => {
        component.ngAfterViewInit();
        const row = component.data.data[0] as any;

        expect(component.data.filterPredicate(row, 'test run,missing')).toBe(true);
        expect(component.data.filterPredicate(row, 'missing,test description')).toBe(true);
        expect(component.data.filterPredicate(row, 'missing,unknown')).toBe(false);
    });

    it('should treat all filtered rows as selected even when full data has additional hidden rows', () => {
        const visibleRow = { Event: new MockEvent('visible') } as any;
        const hiddenRow = { Event: new MockEvent('hidden') } as any;
        component.data.data = [visibleRow, hiddenRow];
        (component.data as any).filteredData = [visibleRow];
        component.selection.select(visibleRow);

        expect(component.isAllSelected()).toBe(true);
    });

    it('should only select filtered rows when masterToggle is used', () => {
        const visibleRow = { Event: new MockEvent('visible') } as any;
        const hiddenRow = { Event: new MockEvent('hidden') } as any;
        component.data.data = [visibleRow, hiddenRow];
        (component.data as any).filteredData = [visibleRow];

        component.masterToggle();

        expect(component.selection.isSelected(visibleRow)).toBe(true);
        expect(component.selection.isSelected(hiddenRow)).toBe(false);
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

    it('should stop merge when selected events include duplicate source files', async () => {
        const e1 = new MockEvent('event1');
        const e2 = new MockEvent('event2');
        e1.originalFiles = [{ path: 'users/u1/events/shared/original.fit' }];
        e2.originalFiles = [{ path: 'users/u1/events/shared/original.fit' }];
        component.selection.select({ Event: e1 } as any);
        component.selection.select({ Event: e2 } as any);

        await component.mergeSelection(new Event('click'));

        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Selected events include identical source files. Deselect duplicates and try again.',
            undefined,
            { duration: 4000 }
        );
        expect(mockDialog.open).not.toHaveBeenCalled();
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

    it('should not report merge failure when opening the merged event fails after a successful merge', async () => {
        const e1 = new MockEvent('event1');
        const e2 = new MockEvent('event2');
        const navigationError = new Error('navigation failed');
        component.selection.select({ 'Event': e1 } as any);
        component.selection.select({ 'Event': e2 } as any);
        mockRouter.navigate.mockRejectedValueOnce(navigationError);

        await component.mergeSelection(new Event('click'));

        expect(mockEventMergeService.mergeEvents).toHaveBeenCalledWith(['event1', 'event2'], 'benchmark');
        expect(mockEventMergeService.getMergeErrorMessage).not.toHaveBeenCalled();
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Events merged. Open the merged event from the table once it appears.',
            undefined,
            { duration: 5000 }
        );
        expect(mockLogger.captureException).toHaveBeenCalledWith(navigationError, {
            extra: {
                eventIDs: ['event1', 'event2'],
                mergeType: 'benchmark',
                mergedEventID: 'merged-event',
                stage: 'open_merged_event',
            }
        });
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

            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledTimes(2);
            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledWith('users/123/files/activity1.fit');
            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledWith('users/123/files/activity2.fit');
            expect(mockFileService.downloadAsZip).toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                [
                    expect.objectContaining({ fileName: 'activity1.fit' }),
                    expect.objectContaining({ fileName: 'activity2.fit' }),
                ],
                '2024-12-01_originals.zip'
            );
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith(expect.any(String), 'Downloaded 2 files');
        });

        it('should download single file directly from events with legacy originalFile', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15');
            e1.originalFiles = [];
            e1.originalFile = { path: 'users/123/files/legacy.fit' };
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledWith('users/123/files/legacy.fit');
            expect(mockFileService.downloadNamedFile).toHaveBeenCalledWith(
                expect.any(Blob),
                'legacy.fit',
                'fit',
            );
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

        it('should preserve original filenames and dedupe collisions across merged event files', async () => {
            const e1 = new MockEvent('merged_event');
            e1.startDate = new Date('2024-12-25'); // Merged event date
            e1.originalFiles = [
                { path: 'users/123/files/act1.fit', originalFilename: 'track.fit', startDate: new Date('2024-12-20T10:00:00') },
                { path: 'users/123/files/act2.fit', originalFilename: 'track.fit', startDate: new Date('2024-12-22T07:30:00') },
                { path: 'users/123/files/act3.fit', originalFilename: 'track.fit' }
            ];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ fileName: 'track.fit' }),
                    expect.objectContaining({ fileName: 'track_2.fit' }),
                    expect.objectContaining({ fileName: 'track_3.fit' })
                ]),
                expect.any(String)
            );
        });

        it('should preserve single original filenames when downloading directly', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15T08:30:00');
            e1.originalFiles = [{ path: 'users/123/files/activity.fit', originalFilename: 'watch.fit' }];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            // Single file should be downloaded directly, not zipped
            expect(mockFileService.downloadNamedFile).toHaveBeenCalledWith(
                expect.any(Blob),
                'watch.fit',
                'fit',
            );
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
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
            expect(mockFileService.downloadNamedFile).toHaveBeenCalledWith(
                expect.any(Blob),
                'activity.fit',
                'fit',
            );
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
        });

        it('should fall back to the stored path basename when the event date is missing', async () => {
            const e1 = new MockEvent('test-event-id');
            (e1 as any).startDate = null;
            e1.originalFiles = [{ path: 'users/123/files/activity.fit' }];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            // Single file should be downloaded directly
            expect(mockFileService.downloadNamedFile).toHaveBeenCalledWith(
                expect.any(Blob),
                'activity.fit',
                'fit',
            );
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
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
            mockEventService.downloadOriginalFile
                .mockResolvedValueOnce(new ArrayBuffer(8))
                .mockRejectedValueOnce(new Error('Download failed'));

            await component.downloadOriginals();

            // Only 1 file succeeded, so it should be downloaded directly (not zipped)
            expect(mockFileService.downloadNamedFile).toHaveBeenCalledWith(
                expect.any(Blob),
                'good.fit',
                'fit',
            );
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith(expect.any(String), 'Downloaded 1 file');
            expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('download_originals', {
                count: 1,
                failedCount: 1,
            });
            expect(mockSnackBar.open).toHaveBeenCalledWith('Downloaded 1 file. Failed 1.', undefined, { duration: 4000 });
        });
    });

    describe('downloadGPXSelection', () => {
        it('should show message when no events are selected', async () => {
            component.selection.clear();

            await component.downloadGPXSelection();

            expect(mockSnackBar.open).toHaveBeenCalledWith('No events selected', undefined, { duration: 2000 });
            expect(mockProcessingService.removeJob).toHaveBeenCalledWith('job-id');
        });

        it('should download a direct GPX file when one event is selected', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15T08:30:00');
            const gpxBlob = new Blob(['<gpx>one</gpx>'], { type: 'application/gpx+xml' });
            mockEventService.getEventAsGPXBloB.mockResolvedValue(gpxBlob);
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadGPXSelection();

            expect(mockEventService.getEventAsGPXBloB).toHaveBeenCalledWith(component.user, e1);
            expect(mockFileService.downloadFile).toHaveBeenCalledWith(gpxBlob, '2024-12-15_08-30', 'gpx');
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-id', 'Downloaded 1 GPX file');
            expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('downloaded_gpx_file', {
                count: 1,
                skipped: 0,
                source: 'event_table_selection',
            });
            expect(mockSnackBar.open).toHaveBeenCalledWith('GPX file served', undefined, { duration: 2000 });
        });

        it('should zip generated GPX files when multiple events are selected', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-01T10:00:00');
            const e2 = new MockEvent('event2');
            e2.startDate = new Date('2024-12-25T11:00:00');
            const gpxBlob1 = new Blob(['<gpx>one</gpx>'], { type: 'application/gpx+xml' });
            const gpxBlob2 = new Blob(['<gpx>two</gpx>'], { type: 'application/gpx+xml' });
            mockEventService.getEventAsGPXBloB
                .mockResolvedValueOnce(gpxBlob1)
                .mockResolvedValueOnce(gpxBlob2);
            component.selection.select({ 'Event': e1 } as any);
            component.selection.select({ 'Event': e2 } as any);

            await component.downloadGPXSelection();

            expect(mockFileService.downloadFile).not.toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ data: gpxBlob1, fileName: expect.stringMatching(/_1\.gpx$/) }),
                    expect.objectContaining({ data: gpxBlob2, fileName: expect.stringMatching(/_2\.gpx$/) }),
                ]),
                '2024-12-01_to_2024-12-25_gpx.zip',
            );
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-id', 'Downloaded 2 GPX files');
            expect(mockSnackBar.open).toHaveBeenCalledWith('GPX files served', undefined, { duration: 2000 });
        });

        it('should download successful GPX files and report skipped failures', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-01T10:00:00');
            const e2 = new MockEvent('event2');
            e2.startDate = new Date('2024-12-02T10:00:00');
            const e3 = new MockEvent('event3');
            e3.startDate = new Date('2024-12-03T10:00:00');
            const gpxBlob1 = new Blob(['<gpx>one</gpx>'], { type: 'application/gpx+xml' });
            const gpxBlob3 = new Blob(['<gpx>three</gpx>'], { type: 'application/gpx+xml' });
            mockEventService.getEventAsGPXBloB
                .mockResolvedValueOnce(gpxBlob1)
                .mockRejectedValueOnce(new Error('no route'))
                .mockResolvedValueOnce(gpxBlob3);
            component.selection.select({ 'Event': e1 } as any);
            component.selection.select({ 'Event': e2 } as any);
            component.selection.select({ 'Event': e3 } as any);

            await component.downloadGPXSelection();

            expect(mockEventService.getEventAsGPXBloB).toHaveBeenCalledTimes(3);
            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ data: gpxBlob1 }),
                    expect.objectContaining({ data: gpxBlob3 }),
                ]),
                '2024-12-01_to_2024-12-03_gpx.zip',
            );
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-id', 'Downloaded 2 GPX files');
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Downloaded 2 GPX files. Skipped 1 event.',
                undefined,
                { duration: 4000 },
            );
        });

        it('should zip the only successful GPX when multiple events are selected', async () => {
            const e1 = new MockEvent('event1');
            const e2 = new MockEvent('event2');
            e2.startDate = new Date('2024-12-02T10:00:00');
            const gpxBlob = new Blob(['<gpx>two</gpx>'], { type: 'application/gpx+xml' });
            mockEventService.getEventAsGPXBloB
                .mockRejectedValueOnce(new Error('no route'))
                .mockResolvedValueOnce(gpxBlob);
            component.selection.select({ 'Event': e1 } as any);
            component.selection.select({ 'Event': e2 } as any);

            await component.downloadGPXSelection();

            expect(mockFileService.downloadFile).not.toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                [expect.objectContaining({ data: gpxBlob, fileName: expect.stringMatching(/\.gpx$/) })],
                '2024-12-02_gpx.zip',
            );
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-id', 'Downloaded 1 GPX file');
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Downloaded 1 GPX file. Skipped 1 event.',
                undefined,
                { duration: 4000 },
            );
        });

        it('should not download anything when all selected GPX exports fail', async () => {
            const e1 = new MockEvent('event1');
            const e2 = new MockEvent('event2');
            mockEventService.getEventAsGPXBloB
                .mockRejectedValueOnce(new Error('no route'))
                .mockRejectedValueOnce(new Error('no route'));
            component.selection.select({ 'Event': e1 } as any);
            component.selection.select({ 'Event': e2 } as any);

            await component.downloadGPXSelection();

            expect(mockFileService.downloadFile).not.toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            expect(mockProcessingService.failJob).toHaveBeenCalledWith('job-id', 'No GPX files exported');
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Could not export GPX for selected events',
                undefined,
                { duration: 3000 },
            );
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

            // Single file should be downloaded directly with the original gz filename preserved
            expect(mockFileService.downloadNamedFile).toHaveBeenCalledWith(
                expect.any(Blob),
                'activity.json.gz',
                'json',
            );
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
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

            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledWith(
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

            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledWith(
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

    describe('Selection actions', () => {
        it('should allow downloadOriginals when more than 20 events are selected', async () => {
            const events = Array.from({ length: 21 }, (_, i) => new MockEvent(`event${i}`));
            events.forEach(e => {
                e.originalFiles = [{ path: `path/to/${e.id}.fit` }];
                component.selection.select({ 'Event': e } as any);
            });

            await component.downloadOriginals();

            expect(mockProcessingService.addJob).toHaveBeenCalled();
        });

        it('should allow downloadAsCSV when more than 20 events are selected', () => {
            const events = Array.from({ length: 21 }, (_, i) => new MockEvent(`event${i}`));
            events.forEach(e => component.selection.select({ 'Event': e } as any));

            component.downloadAsCSV(new Event('click'));

            expect(mockDialog.open).toHaveBeenCalled();
        });

        it('should allow downloadGPXSelection when more than 20 events are selected', async () => {
            const events = Array.from({ length: 21 }, (_, i) => new MockEvent(`event${i}`));
            events.forEach(e => component.selection.select({ 'Event': e } as any));

            await component.downloadGPXSelection();

            expect(mockProcessingService.addJob).toHaveBeenCalled();
            expect(mockEventService.getEventAsGPXBloB).toHaveBeenCalledTimes(21);
        });
    });

    it('should expose custom paginator labels', () => {
        const intl = new MatPaginatorIntlFireStore();
        expect(intl.itemsPerPageLabel).toBe('Items');
        expect(intl.nextPageLabel).toBe('Next');
        expect(intl.previousPageLabel).toBe('Previous');
    });
});
