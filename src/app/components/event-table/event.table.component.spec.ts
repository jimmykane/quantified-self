import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { EventTableComponent, MatPaginatorIntlFireStore } from './event.table.component';
import { EventTableActionsComponent } from './actions/event.table.actions.component';
import { MatListModule, type MatSelectionListChange } from '@angular/material/list';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { OverlayContainer } from '@angular/cdk/overlay';
import { By } from '@angular/platform-browser';
import { HapticTapDirective } from '../../directives/haptic-tap.directive';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';
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
import { EventTagService } from '../../services/event-tag.service';
import { EventTagCatalogService } from '../../services/event-tag-catalog.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { from, of, Subject } from 'rxjs';
import { User, DataAscent, DataPace, DataSpeedAvg, ActivityTypes, DataDeviceNames } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Analytics } from 'app/firebase/analytics';
import { Auth } from 'app/firebase/auth';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock MatTableDataSource without hiding MatTableModule from shared Material imports.
vi.mock('@angular/material/table', (importOriginal) => importOriginal<typeof import('@angular/material/table')>()
    .then(actual => import('rxjs').then(({ of: observableOf }) => Object.assign({}, actual, {
        MatTableDataSource: class {
            data = [];
            paginator = null;
            sort = null;
            sortingDataAccessor = null;
            filter = '';
            connect() { return observableOf([]); }
            disconnect() { }
        }
    }))));
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
    let mockEventTagService: any;
    let mockEventTagCatalogService: any;
    let mockHapticsService: any;

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
            getMergeErrorMessage: vi.fn().mockReturnValue('Could not merge activities.'),
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
        mockEventTagService = {
            getTags: vi.fn((event: any) => event.tags || event.benchmarkReviewTags || []),
            saveTags: vi.fn(async (_user: any, event: any, tags: string[]) => {
                event.tags = tags;
                return tags;
            }),
            applyBulkChanges: vi.fn().mockResolvedValue({}),
        };
        mockEventTagCatalogService = {
            listAllTags: vi.fn().mockResolvedValue([]),
        };
        mockHapticsService = {
            selection: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [NoopAnimationsModule],
            declarations: [EventTableComponent],
            providers: [
                { provide: Analytics, useValue: {} },
                { provide: Auth, useValue: { currentUser: { uid: 'testUser' } } },
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
                { provide: EventTagService, useValue: mockEventTagService },
                { provide: EventTagCatalogService, useValue: mockEventTagCatalogService },
                { provide: AppHapticsService, useValue: mockHapticsService },
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

    it.each([false, true])('loads streams when starting or rerunning a benchmark from the list (saved: %s)', saved => {
        const flow = TestBed.inject(AppBenchmarkFlowService);
        const selection = vi.spyOn(flow, 'openBenchmarkSelectionDialog').mockResolvedValue(undefined);
        const report = vi.spyOn(flow, 'openBenchmarkReport').mockResolvedValue(undefined);
        const event = { getActivities: () => [], benchmarkResults: saved ? { pair: { referenceId: 'ref', testId: 'test' } } : {} } as any;
        component.openBenchmarkFlow({ stopPropagation: vi.fn(), preventDefault: vi.fn() } as any, event);
        expect(saved ? report : selection).toHaveBeenCalledWith(expect.objectContaining({
            event, hydrateStreamsForGeneration: true,
        }));
    });

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

    it('allows a parent tag selector without leaving a hidden table tag filter active', () => {
        component.tagFilter = 'Race';
        component.showTagFilter = false;
        component.ngOnChanges({ showTagFilter: new SimpleChange(true, false, false) });
        fixture.detectChanges();
        expect(component.tagFilter).toBe('');
        expect(fixture.nativeElement.querySelector('.tag-filter-field')).toBeNull();
        expect(fixture.nativeElement.querySelector('.qs-search-field')).toBeTruthy();
    });

    it('presents the Tag library with grouped activity names and the same date display as Calendar and Dashboard', () => {
        component.showActions = true;
        component.events[0].startDate = new Date('2026-10-11T08:15:00');
        component.ngOnChanges({ events: new SimpleChange(component.events, [...component.events], false) });
        const dashboardDate = component.data.data[0]['Start Date'];
        component.presentation = 'tag-library';
        component.ngOnChanges({ presentation: new SimpleChange('dashboard', 'tag-library', false) });
        expect(component.displayedColumns).toEqual(['Checkbox', 'Start Date', 'Name', 'Distance', 'Duration', 'Tags', 'Actions']);
        expect(component.tablePageSize).toBe(5);
        expect(component.tableSortActive).toBe('Start Date');
        expect(component.tableSortDirection).toBe('desc');
        expect(component.isColumnHeaderSortable('Name')).toBe(true);
        expect(component.data.data[0]['Name']).toBe('Test Run');
        expect(component.data.data[0]['Activity Types']).toBe('Run');
        expect(component.data.data[0]['Start Date']).toBe(dashboardDate);
    });

    it('keeps the complete table and hides only generated names when Activities opts in', () => {
        const event = component.events[0];
        event.name = event.startDate.toISOString();
        const originalColumns = [...component.displayedColumns];
        component.hideGeneratedNames = true;
        component.ngOnChanges({ hideGeneratedNames: new SimpleChange(false, true, false) });
        expect(component.data.data[0].Name).toBe('');
        expect(component.displayedColumns).toEqual(originalColumns);
        expect(component.data.data[0]['Tag Action Label']).not.toContain(event.name);
        expect(event.name).toBe(event.startDate.toISOString());
        event.name = 'Autumn race';
        component.ngOnChanges({ events: new SimpleChange(component.events, [...component.events], false) });
        expect(component.data.data[0].Name).toBe('Autumn race');
        expect(component.data.data[0]['Library Activity Label']).toBe('Autumn race');
        component.hideGeneratedNames = false;
        event.name = event.startDate.toISOString();
        component.ngOnChanges({ hideGeneratedNames: new SimpleChange(true, false, false) });
        expect(component.data.data[0].Name).toBe(event.name);
        expect(mockEventService.updateEventProperties).not.toHaveBeenCalled();
    });

    it('preserves shared search but resets page and selection when explorer filters change', () => {
        component.preserveSearchOnFilterChange = true;
        component.search('Run');
        component.selection.select(component.data.data[0]);
        component.paginator.pageIndex = 2;
        component.paginator.firstPage = vi.fn(() => { component.paginator.pageIndex = 0; });
        mockHapticsService.selection.mockClear();
        component.ngOnChanges({ filterContext: new SimpleChange('all', 'Running', false) });
        expect(component.searchTerm).toBe('Run');
        expect(JSON.parse(component.data.filter).text).toBe('run');
        expect(component.selection.isEmpty()).toBe(true);
        expect(component.paginator.pageIndex).toBe(0);
        expect(component.paginator.firstPage).toHaveBeenCalledOnce();
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
    });

    it('keeps Tag library columns, sorting, and pagination local without changing Dashboard preferences', async () => {
        const previousSettings = JSON.stringify(mockUser.settings.dashboardSettings);
        component.presentation = 'tag-library';
        component.ngOnChanges({ presentation: new SimpleChange('dashboard', 'tag-library', false) });
        await component.selectedColumnsChange(['Distance', 'Ascent', 'Activity Types']);
        await component.pageChanges({ pageSize: 10 } as any);
        component.sort.sortChange.next({ active: 'Name', direction: 'asc' });
        expect(component.selectedColumns).toEqual(['Distance', 'Ascent']);
        expect(component.displayedColumns).toContain('Name');
        expect(component.tablePageSize).toBe(10);
        expect(component.tableSortActive).toBe('Name');
        expect(component.tableSortDirection).toBe('asc');
        expect(JSON.stringify(mockUser.settings.dashboardSettings)).toBe(previousSettings);
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        component.ngOnChanges({ user: new SimpleChange(mockUser, mockUser, false) });
        expect(component.selectedColumns).toEqual(['Distance', 'Ascent']);
    });

    it('uses sport and readable date labels for generated names in Tags without changing the event', () => {
        const event = component.events[0];
        event.startDate = new Date('2026-10-11T08:15:00');
        event.name = event.startDate.toISOString();
        component.presentation = 'tag-library';
        component.ngOnChanges({ presentation: new SimpleChange('dashboard', 'tag-library', false) });
        const row = component.data.data[0];
        expect(row['Library Activity Name']).toBe('');
        expect(row['Library Activity Label']).toBe('Run on 11 Oct 2026, 08:15');
        expect(row['Tag Action Label']).toBe('Add activity tags for Run on 11 Oct 2026, 08:15');
        expect(row['sort.Name']).toBe('Run');
        expect(row.Name).toBe(event.startDate.toISOString());
        expect(event.name).toBe(event.startDate.toISOString());
        expect(mockEventService.updateEventProperties).not.toHaveBeenCalled();
    });

    it('restores a custom name immediately when a cached generated-name row is renamed', () => {
        const event = component.events[0];
        event.name = event.startDate.toISOString();
        component.presentation = 'tag-library';
        component.ngOnChanges({ presentation: new SimpleChange('dashboard', 'tag-library', false) });
        expect(component.data.data[0]['Library Activity Name']).toBe('');
        event.name = 'Spring race';
        component.ngOnChanges({ events: new SimpleChange(component.events, [...component.events], false) });
        expect(component.data.data[0]['Library Activity Name']).toBe('Spring race');
        expect(component.data.data[0]['Library Activity Label']).toBe('Spring race');
        expect(component.data.data[0]['sort.Name']).toBe('Spring race');
    });

    it('keeps timestamp names and existing accessible labels in Dashboard presentation', () => {
        const event = component.events[0];
        event.name = event.startDate.toISOString();
        component.presentation = 'tag-library';
        component.ngOnChanges({ presentation: new SimpleChange('dashboard', 'tag-library', false) });
        expect(component.data.data[0]['Library Activity Name']).toBe('');
        const libraryDate = component.data.data[0]['Start Date'];
        component.presentation = 'dashboard';
        component.ngOnChanges({ presentation: new SimpleChange('tag-library', 'dashboard', false) });
        const row = component.data.data[0];
        expect(row['Start Date']).toBe(libraryDate);
        expect(row['Library Activity Name']).toBeUndefined();
        expect(row['Library Activity Label']).toBeUndefined();
        expect(row['Tag Action Label']).toBe(`Add activity tags for ${event.name}`);
        expect(row['sort.Name']).toBe(event.name);
    });

    it('initializes library column choices before a synchronous loading render can create the Material menu', () => {
        component.presentation = 'tag-library';
        component.selectedColumns = ['Distance', 'Duration', 'Ascent'];
        const renderedChoices: string[][] = [];
        vi.spyOn(component, 'loaded').mockImplementation(() => { renderedChoices.push([...component.selectedColumns]); });
        component.ngOnChanges({ presentation: new SimpleChange('dashboard', 'tag-library', true) });
        expect(renderedChoices.length).toBeGreaterThan(0);
        expect(renderedChoices.every(choices => choices.join(',') === 'Distance,Duration')).toBe(true);
    });

    it('keeps the Tag library metric order stable when the picker adds and restores columns', async () => {
        component.showActions = true;
        component.presentation = 'tag-library';
        component.ngOnChanges({ presentation: new SimpleChange('dashboard', 'tag-library', false) });
        await component.selectedColumnsChange(['Duration', 'Distance', 'Ascent']);
        expect(component.displayedColumns).toEqual(['Checkbox', 'Start Date', 'Name', 'Distance', 'Duration', 'Ascent', 'Tags', 'Actions']);
        await component.selectedColumnsChange(['Duration', 'Ascent']);
        await component.selectedColumnsChange(['Duration', 'Ascent', 'Distance']);
        expect(component.selectedColumns).toEqual(['Distance', 'Duration', 'Ascent']);
        expect(component.libraryAvailableColumns.slice(0, 2)).toEqual(['Distance', 'Duration']);
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    });

    it.each(['dashboard', 'tag-library'] as const)('keeps parent-owned history loading active in %s while rendering empty rows or rebuilding them', (presentation) => {
        component.presentation = presentation;
        component.events = [];
        component.isLoading = true;
        component.ngOnChanges({ events: new SimpleChange(component.events, [], false) });
        expect(component.isLoading).toBe(true);
        component.events = [new MockEvent('loaded') as any];
        component.ngOnChanges({ events: new SimpleChange([], component.events, false) });
        expect(component.isLoading).toBe(true);
        component.isLoading = false;
        component.ngOnChanges({ isLoading: new SimpleChange(true, false, false) });
        expect(component.isLoading).toBe(false);
    });

    it('restores Dashboard presentation when leaving the Tag library mode', () => {
        component.presentation = 'tag-library';
        component.ngOnChanges({ presentation: new SimpleChange('dashboard', 'tag-library', false) });
        component.presentation = 'dashboard';
        component.ngOnChanges({ presentation: new SimpleChange('tag-library', 'dashboard', false) });
        expect(component.selectedColumns).toEqual(mockUser.settings.dashboardSettings.tableSettings.selectedColumns);
        expect(component.displayedColumns).toContain('Description');
        expect(component.displayedColumns).not.toContain('Name');
        expect(component.tablePageSize).toBe(10);
    });

    it('selects only the current sorted page in the Tag library and preserves selection on other pages', async () => {
        const { MatTableDataSource } = await vi.importActual<typeof import('@angular/material/table')>('@angular/material/table');
        const materialData = new MatTableDataSource();
        materialData.sortingDataAccessor = component.data.sortingDataAccessor;
        component.data.sortData = materialData.sortData.bind(materialData);
        component.presentation = 'tag-library';
        component.events = Array.from({ length: 6 }, (_value, index) => {
            const event = new MockEvent(`page-${index}`);
            event.startDate = new Date(2026, 9, 1 + index);
            return event as any;
        });
        component.paginator.pageSize = 5;
        component.paginator.pageIndex = 0;
        component.sort.active = 'Start Date';
        component.sort.direction = 'desc';
        component.ngOnChanges({ events: new SimpleChange([], component.events, false) });
        component.masterToggle();
        expect(component.selection.selected.map(row => row.Event.getID())).toEqual(['page-5', 'page-4', 'page-3', 'page-2', 'page-1']);
        component.paginator.pageIndex = 1;
        expect(component.isSelectionIndeterminate).toBe(false);
        expect(component.isAllSelected()).toBe(false);
        component.masterToggle();
        expect(component.selection.selected).toHaveLength(6);
        component.masterToggle();
        expect(component.selection.selected).toHaveLength(5);
        materialData.disconnect();
    });

    it('gives column selection feedback once and stays silent when the selection is unchanged', () => {
        const actions = TestBed.runInInjectionContext(() => new EventTableActionsComponent());
        actions.selectedDataTypes = ['Distance'];
        const change = { source: { selectedOptions: { selected: [{ value: 'Distance' }, { value: 'Duration' }] } } } as unknown as MatSelectionListChange;
        actions.selectionChange(change);
        actions.selectionChange(change);
        expect(actions.selectedDataTypes).toEqual(['Distance', 'Duration']);
        expect(mockHapticsService.selection).toHaveBeenCalledOnce();
    });

    it('gives library sorting and pagination feedback for changes while keeping hydration and parent resets silent', async () => {
        component.presentation = 'tag-library';
        component.ngOnChanges({ presentation: new SimpleChange('dashboard', 'tag-library', false) });
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
        component.sort.sortChange.next({ active: 'Distance', direction: 'asc' });
        component.sort.sortChange.next({ active: 'Distance', direction: 'asc' });
        await component.pageChanges({ pageIndex: 1, pageSize: 5 } as any);
        await component.pageChanges({ pageIndex: 1, pageSize: 5 } as any);
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(2);
        component.paginator.firstPage = () => { void component.pageChanges({ pageIndex: 0, pageSize: 5 } as any); };
        component.ngOnChanges({ filterContext: new SimpleChange('endurance', 'recovery', false) });
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(2);
    });

    it('gives page feedback after the data source silently clamps a filtered page back to the first page', async () => {
        component.presentation = 'tag-library';
        await component.pageChanges({ pageIndex: 1, previousPageIndex: 0, pageSize: 5 } as any);
        mockHapticsService.selection.mockClear();
        // Material can clamp pageIndex without emitting a page event after filtering.
        component.paginator.pageIndex = 0;
        await component.pageChanges({ pageIndex: 1, previousPageIndex: 0, pageSize: 5 } as any);
        expect(mockHapticsService.selection).toHaveBeenCalledOnce();
    });

    it('does not restore pending activity search after the user clears it and gives one feedback', async () => {
        component.onSearchInput({ target: { value: 'old search' } } as unknown as Event);
        component.clearSearch();
        component.clearSearch();
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(component.searchTerm).toBe('');
        expect(JSON.parse(component.data.filter).text).toBe('');
        expect(mockHapticsService.selection).toHaveBeenCalledOnce();
    });

    it('clears previous activity search, selection and pagination when the parent tag context changes', () => {
        component.searchTerm = 'old search';
        component.selection.select(component.data.data[0]);
        const firstPage = vi.fn();
        component.paginator.firstPage = firstPage;
        component.ngOnChanges({ filterContext: new SimpleChange('endurance', 'recovery', false) });
        expect(component.searchTerm).toBe('');
        expect(component.selection.isEmpty()).toBe(true);
        expect(firstPage).toHaveBeenCalledOnce();
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
    });

    it('does not restore a pending activity search after the parent switches tags', async () => {
        component.paginator.firstPage = vi.fn();
        component.onSearchInput({ target: { value: 'old search' } } as unknown as Event);
        component.ngOnChanges({ filterContext: new SimpleChange('endurance', 'recovery', false) });
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(component.searchTerm).toBe('');
        expect(JSON.parse(component.data.filter).text).toBe('');
    });

    it('renders row actions in browse presentation without bulk controls or persisted table changes', async () => {
        component.presentation = 'browse';
        component.showActions = true;
        component.ngOnChanges({
            presentation: new SimpleChange('dashboard', 'browse', false),
            showActions: new SimpleChange(false, true, false),
        });
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.table-toolbar')).toBeNull();
        expect(component.displayedColumns).not.toContain('Checkbox');
        expect(component.displayedColumns).toContain('Actions');
        expect(component.displayedColumns).not.toContain('Shared');
        expect(component.displayedColumns).not.toContain('Tags');
        const template = readFileSync(
            join(process.cwd(), 'src/app/components/event-table/event.table.component.html'),
            'utf8'
        );
        expect(template).toContain("[attr.aria-label]=\"isLibraryPresentation || !canManageEvents ? 'Activity actions' : null\"");
        expect(fixture.nativeElement.querySelector('app-event-table-actions')).toBeNull();
        expect(component.showRowActions).toBe(true);

        await component.pageChanges({ pageSize: 50 } as any);
        await component.selectedColumnsChange(['Name', 'Start Date']);
        component.sort.sortChange.next({ active: 'Start Date', direction: 'asc' });

        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    });

    it('should render selected-event actions outside the main toolbar row', () => {
        fixture.componentRef.setInput('showActions', true);
        component.selection.select({ Event: new MockEvent('selected') } as any);
        fixture.detectChanges();

        const mainRow = fixture.nativeElement.querySelector('.table-toolbar-main') as HTMLElement;
        const selectionToolbar = fixture.nativeElement.querySelector('.table-selection-toolbar') as HTMLElement;
        const actionButtons = fixture.nativeElement.querySelectorAll('.table-selection-toolbar .bulk-action-button');

        expect(selectionToolbar).toBeTruthy();
        expect(selectionToolbar.textContent).toContain('1 activity selected');
        expect(mainRow.contains(selectionToolbar)).toBe(false);
        expect(mainRow.querySelector('.selection-actions')).toBeNull();
        expect(actionButtons.length).toBe(8);
        expect(actionButtons.item(5).getAttribute('aria-label')).toBe('Send to service: review 1 selected activity');
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
            'Update tags on 2 selected activities',
            'Merge 2 activities',
            'Download CSV for 2 activities',
            'Download GPX for 2 activities',
            'Download original files',
            'Send to service: review 2 selected activities',
            'Delete 2 activities',
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

    it('should use activity language and keep the glass empty state clear of the paginator', () => {
        const template = readFileSync(
            join(process.cwd(), 'src/app/components/event-table/event.table.component.html'),
            'utf8'
        );
        const styles = readFileSync(
            join(process.cwd(), 'src/app/components/event-table/event.table.component.scss'),
            'utf8'
        );

        expect(template).toContain('placeholder="Search activities"');
        expect(template).toContain('[errorMessage]="emptyMessage"');
        expect(component.emptyMessage).toBe('No activities yet');
        expect(component.emptyHint).toBe('Import an activity or change your filters');
        expect(template).toContain('[allowErrorPassthrough]="true"');
        expect(template).toContain('activity-table-no-data-row--hidden');
        expect(template).not.toContain('No events found');
        expect(template.indexOf('</app-loading-overlay>')).toBeLessThan(template.indexOf('<mat-paginator'));
        expect(styles).toMatch(/\.activity-table-overlay\s*{[\s\S]*--loading-shade-error-blur:\s*16px;/);
        expect(styles).toMatch(/\.activity-table-overlay\s*{[\s\S]*--loading-shade-error-shadow:\s*var\(--qs-overlay-shadow\);/);
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

    it('should add a fixed Shared column before Actions only for owner action tables', () => {
        component.selectedColumns = ['Shared', 'Distance'];
        component.showActions = true;
        (component as any).updateDisplayedColumns();

        expect(component.displayedColumns).toContain('Shared');
        expect(component.displayedColumns.filter(column => column === 'Shared')).toHaveLength(1);
        expect(component.displayedColumns.indexOf('Shared')).toBeLessThan(component.displayedColumns.indexOf('Actions'));
        expect(component.isColumnHeaderSortable('Shared')).toBe(true);

        component.showActions = false;
        (component as any).updateDisplayedColumns();

        expect(component.displayedColumns).not.toContain('Shared');
    });

    it('should keep the compact Tags action beside Activity Types on handsets', () => {
        component.selectedColumns = ['Duration', 'Activity Types', 'Distance'];
        component.showActions = true;
        (component as any).isHandset = true;

        (component as any).updateDisplayedColumns();

        expect(component.displayedColumns.slice(0, 5)).toEqual([
            'Checkbox',
            'Start Date',
            'Activity Types',
            'Tags',
            'Duration',
        ]);
    });

    it('should derive shared row display and sorting state from event privacy', () => {
        const publicEvent = new MockEvent('public-event') as any;
        publicEvent.privacy = 'public';
        const privateEvent = new MockEvent('private-event') as any;
        privateEvent.privacy = 'private';
        component.events = [publicEvent, privateEvent];

        (component as any).processChanges('spec_shared_state');

        expect((component.data.data[0] as any).Shared).toBe('Shared');
        expect((component.data.data[0] as any)['Shared Title']).toContain('Anyone with the link can view this activity');
        expect((component.data.data[0] as any)['sort.Shared']).toBe(1);
        expect((component.data.data[1] as any).Shared).toBe('');
        expect((component.data.data[1] as any)['Shared Title']).toBe('');
        expect((component.data.data[1] as any)['sort.Shared']).toBe(0);
    });

    it('should render shared state through an explicit table cell branch', () => {
        const template = readFileSync(
            join(process.cwd(), 'src/app/components/event-table/event.table.component.html'),
            'utf8'
        );

        expect(template).toContain("column === 'Shared'");
        expect(template).toContain('shared-state-cell');
        expect(template).toContain("row['Shared Title']");
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

    it('should preserve selected event IDs across live row refreshes and drop removed rows', () => {
        const previousEvents = [...component.events];
        const selectedRows = component.data.data.slice(0, 2) as any[];
        const refreshedEvent = new MockEvent('event1') as any;
        component.selection.select(...selectedRows);
        component.events = [
            refreshedEvent,
            new MockEvent('event3') as any,
        ];

        component.ngOnChanges({
            events: new SimpleChange(previousEvents, component.events, false),
        });

        expect(component.selection.selected).toHaveLength(1);
        expect(component.selection.selected[0]).not.toBe(selectedRows[0]);
        expect(component.selection.selected[0].Event).toBe(refreshedEvent);
        expect(component.selection.selected[0].Event.getID()).toBe('event1');
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

    it.each([0, 250, null])('refreshes saved ascent in cached rows and preserves selection: %s', value => {
        const event = component.events[0];
        let ascent: DataAscent | null = new DataAscent(100);
        vi.spyOn(event, 'getStatsAsArray').mockImplementation(() => ascent ? [ascent] : []);
        (component as any).processChanges('ascent_initial');
        const previousRows = [...component.data.data];
        expect(previousRows[0].Ascent).toBe('100 m');
        component.selection.select(previousRows[0], previousRows[1]);
        ascent = value === null ? null : new DataAscent(value);
        component.refreshSavedAscent(event);
        expect(component.data.data[0].Ascent).toBe(value === null ? '' : `${value} m`);
        expect(component.data.data[1]).toBe(previousRows[1]);
        expect(component.selection.selected.map(row => row.Event.getID())).toEqual(['event1', 'event2']);
    });
    it('ignores a saved-ascent callback for an event instance replaced by newer input', () => {
        const rows = [...component.data.data];
        const previous = component.events[0];
        component.events = [new MockEvent('event1') as any, ...component.events.slice(1)];
        const rebuild = vi.spyOn(component, 'getStatsRowElement');
        component.refreshSavedAscent(previous);
        expect(rebuild).not.toHaveBeenCalled();
        expect(component.data.data).toEqual(rows);
    });

    it('should support comma-separated search terms', () => {
        component.ngAfterViewInit();
        const row = component.data.data[0] as any;

        expect(component.data.filterPredicate(row, 'test run,missing')).toBe(true);
        expect(component.data.filterPredicate(row, 'missing,test description')).toBe(true);
        expect(component.data.filterPredicate(row, 'missing,unknown')).toBe(false);
        expect(component.data.filterPredicate(row, 'shared')).toBe(true);
        expect(component.data.filterPredicate(row, 'anyone with the link')).toBe(false);
    });

    it('should build tag rows and filter by one exact tag without disabling text search', () => {
        (component.events[0] as any).tags = ['Race', 'Long run'];
        (component.events[1] as any).tags = ['Recovery'];
        (component as any).processChanges('spec_tags');
        component.ngAfterViewInit();

        const raceRow = component.data.data[0] as any;
        const recoveryRow = component.data.data[1] as any;
        component.updateTagFilter('race');

        expect(component.tagFilterOptions).toEqual(['Long run', 'Race', 'Recovery']);
        expect(component.tagFilter).toBe('Race');
        expect(raceRow['Tag Values']).toEqual(['Race', 'Long run']);
        expect(component.data.filterPredicate(raceRow, component.data.filter)).toBe(true);
        expect(component.data.filterPredicate(recoveryRow, component.data.filter)).toBe(false);

        component.search('long');
        expect(component.data.filterPredicate(raceRow, component.data.filter)).toBe(true);

        (component.events[0] as any).tags = ['race', 'Long run'];
        (component as any).processChanges('spec_recased_selected_tag');
        expect(component.tagFilterOptions).toEqual(['Long run', 'race', 'Recovery']);
        expect(component.tagFilter).toBe('race');

        (component.events[0] as any).tags = ['Long run'];
        (component as any).processChanges('spec_removed_selected_tag');
        expect(component.tagFilter).toBe('');
    });

    it('keeps historical tag choices while the table changes to a different date range', async () => {
        mockEventTagCatalogService.listAllTags.mockResolvedValue(['Historical', 'Race']);
        (component.events[0] as any).tags = ['Race'];
        (component as any).processChanges('spec_tags');
        await (component as any).loadAllHistoryTags(true);
        const catalogCalls = mockEventTagCatalogService.listAllTags.mock.calls.length;

        expect(component.tagFilterOptions).toEqual(['Historical', 'Race']);
        component.updateTagFilter('historical');
        expect(component.tagFilter).toBe('Historical');

        component.events = [new MockEvent('new-range-event') as any];
        (component as any).processChanges('spec_new_date_range');

        expect(component.tagFilterOptions).toEqual(['Historical', 'Race']);
        expect(component.tagFilter).toBe('Historical');
        expect(component.data.filterPredicate(component.data.data[0], component.data.filter)).toBe(false);
        expect(mockEventTagCatalogService.listAllTags).toHaveBeenCalledTimes(catalogCalls);
    });

    it('keeps a selected historical tag while refreshing the catalog and ignores stale owner results', async () => {
        mockEventTagCatalogService.listAllTags.mockResolvedValueOnce(['Historical']);
        await (component as any).loadAllHistoryTags(true);
        component.updateTagFilter('Historical');

        let resolveRefresh!: (tags: string[]) => void;
        mockEventTagCatalogService.listAllTags.mockReturnValueOnce(new Promise<string[]>(resolve => {
            resolveRefresh = resolve;
        }));
        const refresh = (component as any).loadAllHistoryTags(true);
        component.events = [new MockEvent('new-range-event') as any];
        (component as any).processChanges('spec_range_changed_during_refresh');

        expect(component.tagFilter).toBe('Historical');
        expect(component.tagFilterOptions).toContain('Historical');

        component.targetUser = new User('other-user');
        component.ngOnChanges({ targetUser: new SimpleChange(null, component.targetUser, false) });
        resolveRefresh(['Private owner tag']);
        await refresh;

        expect(component.tagFilterOptions).not.toContain('Private owner tag');
    });

    it('retries a failed full-history tag load when the filter is opened', async () => {
        mockEventTagCatalogService.listAllTags.mockRejectedValueOnce(new Error('offline'));
        await (component as any).loadAllHistoryTags(true);
        expect(component.tagCatalogLoadFailed).toBe(true);

        mockEventTagCatalogService.listAllTags.mockResolvedValueOnce(['Historical']);
        component.onTagFilterOpened(true);
        await fixture.whenStable();

        expect(component.tagCatalogLoadFailed).toBe(false);
        expect(component.tagFilterOptions).toContain('Historical');
    });

    it('rechecks historical tags when the filter is reopened', async () => {
        mockEventTagCatalogService.listAllTags.mockResolvedValueOnce(['Old tag']);
        await (component as any).loadAllHistoryTags(true);
        expect(component.tagFilterOptions).toContain('Old tag');

        mockEventTagCatalogService.listAllTags.mockResolvedValueOnce(['New tag']);
        component.onTagFilterOpened(true);
        await fixture.whenStable();

        expect(component.tagFilterOptions).toContain('New tag');
        expect(component.tagFilterOptions).not.toContain('Old tag');
        expect(mockEventTagCatalogService.listAllTags).toHaveBeenLastCalledWith('testUser', false);
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
    });

    it('gives one selection haptic for each changed tag choice', () => {
        (component.events[0] as any).tags = ['Race'];
        (component as any).processChanges('spec_tag_haptics');

        component.updateTagFilter('race');
        component.updateTagFilter('Race');
        expect(mockHapticsService.selection).toHaveBeenCalledOnce();

        component.updateTagFilter('');
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(2);
    });

    it('does not request the owner tag catalog for another user dashboard', () => {
        mockEventTagCatalogService.listAllTags.mockClear();
        component.targetUser = new User('other-user');
        component.ngOnChanges({ targetUser: new SimpleChange(null, component.targetUser, false) });

        expect(mockEventTagCatalogService.listAllTags).not.toHaveBeenCalled();
    });

    it('should identify tag controls by event and expose every read-only tag', () => {
        (component.events[0] as any).tags = ['Race', 'Long run', '2026'];
        (component as any).processChanges('spec_tag_accessibility');
        const row = component.data.data[0] as any;

        expect(row['Tag Action Label']).toBe('Edit activity tags for Test Run');
        expect(row['Tags Accessible Label']).toBe('Activity tags for Test Run: Race, Long run, 2026');
    });

    it('should provide compact mobile tag markup and stack toolbar filters on small screens', () => {
        const template = readFileSync(
            join(process.cwd(), 'src/app/components/event-table/event.table.component.html'),
            'utf8'
        );
        const styles = readFileSync(
            join(process.cwd(), 'src/app/components/event-table/event.table.component.scss'),
            'utf8'
        );

        expect(template).toContain('event-tags-mobile-summary');
        expect(template).toContain('event-tags-add-text');
        expect(template).toContain("[attr.aria-label]=\"row['Tags Accessible Label']\"");
        expect(styles).toMatch(/@include bp\.xsmall[\s\S]*\.table-toolbar-filters\s*{[\s\S]*flex-direction:\s*column;/);
        expect(styles).toMatch(/@include bp\.xsmall[\s\S]*\.mat-column-Tags[\s\S]*width:\s*52px !important;/);
    });

    it('should save tags from a row dialog without navigating the row', async () => {
        const changes = vi.fn();
        component.eventsChange.subscribe(changes);
        const event = component.events[0] as any;
        const domEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
        component.showActions = true;
        mockDialog.open.mockImplementation((_component: unknown, config: any) => {
            const saved = config.data.save(['Race']);
            return { afterClosed: () => from(saved.then(() => ['Race'])) };
        });

        await component.openEventTagsDialog(domEvent, event);

        expect(domEvent.preventDefault).toHaveBeenCalled();
        expect(domEvent.stopPropagation).toHaveBeenCalled();
        expect(mockEventTagService.saveTags).toHaveBeenCalledWith(mockUser, event, ['Race'], []);
        expect(event.tags).toEqual(['Race']);
        expect(changes).toHaveBeenCalledOnce();
        expect(changes).toHaveBeenCalledWith({ userID: mockUser.uid, updatedTags: { [event.getID()]: ['Race'] }, deletedEventIDs: [] });
    });

    it('should apply saved row tags to a refreshed event instance with the same ID', async () => {
        const originalEvent = component.events[0] as any;
        const refreshedEvent = new MockEvent(originalEvent.getID()) as any;
        originalEvent.benchmarkReviewTags = ['Original legacy'];
        refreshedEvent.benchmarkReviewTags = ['Refreshed legacy'];
        const domEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
        const closed = new Subject<string[] | null>();
        let dialogData: any;
        component.showActions = true;
        mockDialog.open.mockImplementation((_component: unknown, config: any) => {
            dialogData = config.data;
            return { afterClosed: () => closed.asObservable() };
        });

        const openPromise = component.openEventTagsDialog(domEvent, originalEvent);
        component.events = [refreshedEvent, ...component.events.slice(1)];
        const savedTags = await dialogData.save(['Race']);
        closed.next(savedTags);
        closed.complete();
        await openPromise;

        expect(originalEvent.tags).toEqual(['Race']);
        expect(refreshedEvent.tags).toEqual(['Race']);
        expect(originalEvent.benchmarkReviewTags).toBeUndefined();
        expect(refreshedEvent.benchmarkReviewTags).toBeUndefined();
        expect((component.data.data[0] as any)['Tag Values']).toEqual(['Race']);
    });

    it('should not overwrite a newer row refresh that arrives after the tag save completes', async () => {
        const changes = vi.fn();
        component.eventsChange.subscribe(changes);
        const originalEvent = component.events[0] as any;
        const refreshedEvent = new MockEvent(originalEvent.getID()) as any;
        refreshedEvent.tags = ['Concurrent'];
        const closed = new Subject<string[] | null>();
        let dialogData: any;
        component.showActions = true;
        mockDialog.open.mockImplementation((_component: unknown, config: any) => {
            dialogData = config.data;
            return { afterClosed: () => closed.asObservable() };
        });

        const openPromise = component.openEventTagsDialog(
            { preventDefault: vi.fn(), stopPropagation: vi.fn() } as any,
            originalEvent,
        );
        const savedTags = await dialogData.save(['Race']);
        expect(changes).toHaveBeenCalledWith({ userID: mockUser.uid, updatedTags: { [originalEvent.getID()]: ['Race'] }, deletedEventIDs: [] });
        component.events = [refreshedEvent, ...component.events.slice(1)];
        closed.next(savedTags);
        closed.complete();
        await openPromise;

        expect(originalEvent.tags).toEqual(['Race']);
        expect(refreshedEvent.tags).toEqual(['Concurrent']);
        expect((component.data.data[0] as any)['Tag Values']).toEqual(['Concurrent']);
        expect(changes).toHaveBeenCalledOnce();
    });

    it.each(['account change', 'component teardown'])('ignores a completed tag save and its closing notification after %s', async (contextChange) => {
        const originalEvent = component.events[0] as any;
        const otherEvent = new MockEvent(originalEvent.getID()) as any;
        otherEvent.tags = ['Other owner'];
        const closed = new Subject<string[] | null>();
        let dialogData: any;
        let resolveSave: (tags: string[]) => void;
        mockEventTagService.saveTags.mockReturnValue(new Promise<string[]>(resolve => { resolveSave = resolve; }));
        component.showActions = true;
        mockDialog.open.mockImplementation((_component: unknown, config: any) => {
            dialogData = config.data;
            return { afterClosed: () => closed.asObservable() };
        });
        const open = component.openEventTagsDialog({ preventDefault: vi.fn(), stopPropagation: vi.fn() } as any, originalEvent);
        const save = dialogData.save(['Old owner edit']);
        component.events = [otherEvent];
        if (contextChange === 'account change') {
            component.user = new User('other-owner');
            component.user.settings = mockUser.settings;
        } else {
            fixture.destroy();
        }
        const changes = vi.fn();
        component.eventsChange.subscribe(changes);
        resolveSave(['Old owner edit']);
        const savedTags = await save;
        closed.next(savedTags);
        closed.complete();
        await open;
        expect(mockEventTagService.saveTags).toHaveBeenCalledWith(mockUser, originalEvent, ['Old owner edit'], []);
        expect(otherEvent.tags).toEqual(['Other owner']);
        expect(changes).not.toHaveBeenCalled();
        expect(mockSnackBar.open).not.toHaveBeenCalled();
    });

    it('should apply bulk add/remove changes and update selected event rows', async () => {
        const changes = vi.fn();
        component.eventsChange.subscribe(changes);
        const selectedRows = component.data.data.slice(0, 2) as any[];
        component.selection.select(...selectedRows);
        mockEventTagService.applyBulkChanges.mockResolvedValue({
            event1: ['Race'],
            event2: ['Recovery'],
        });
        mockDialog.open.mockImplementation((_component: unknown, config: any) => {
            const saved = config.data.save({ add: ['Race'], remove: ['Old'] });
            return { afterClosed: () => from(saved.then(() => true)) };
        });

        await component.openBulkEventTagsDialog({ preventDefault: vi.fn(), stopPropagation: vi.fn() } as any);

        expect(mockEventTagService.applyBulkChanges).toHaveBeenCalledWith(
            mockUser,
            ['event1', 'event2'],
            { add: ['Race'], remove: ['Old'] },
        );
        expect((component.events[0] as any).tags).toEqual(['Race']);
        expect((component.events[1] as any).tags).toEqual(['Recovery']);
        expect(component.selection.isEmpty()).toBe(true);
        expect(changes).toHaveBeenCalledOnce();
        expect(changes).toHaveBeenCalledWith({ userID: mockUser.uid, updatedTags: { event1: ['Race'], event2: ['Recovery'] }, deletedEventIDs: [] });
    });

    it('should not overwrite a newer row refresh after a bulk tag save completes', async () => {
        const changes = vi.fn();
        component.eventsChange.subscribe(changes);
        const selectedRow = component.data.data[0] as any;
        const selectedEvent = selectedRow.Event as any;
        const refreshedEvent = new MockEvent(selectedEvent.getID()) as any;
        refreshedEvent.tags = ['Concurrent'];
        const closed = new Subject<boolean>();
        let dialogData: any;
        component.selection.select(selectedRow);
        mockEventTagService.applyBulkChanges.mockResolvedValue({
            [selectedEvent.getID()]: ['Race'],
        });
        mockDialog.open.mockImplementation((_component: unknown, config: any) => {
            dialogData = config.data;
            return { afterClosed: () => closed.asObservable() };
        });

        const openPromise = component.openBulkEventTagsDialog(
            { preventDefault: vi.fn(), stopPropagation: vi.fn() } as any,
        );
        await dialogData.save({ add: ['Race'], remove: [] });
        expect(changes).toHaveBeenCalledWith({ userID: mockUser.uid, updatedTags: { [selectedEvent.getID()]: ['Race'] }, deletedEventIDs: [] });
        component.events = [refreshedEvent, ...component.events.slice(1)];
        closed.next(true);
        closed.complete();
        await openPromise;

        expect(selectedEvent.tags).toEqual(['Race']);
        expect(refreshedEvent.tags).toEqual(['Concurrent']);
        expect((component.data.data[0] as any)['Tag Values']).toEqual(['Concurrent']);
        expect(changes).toHaveBeenCalledOnce();
    });

    it.each(['account change', 'component teardown'])('ignores completed bulk tag saves and their closing notification after %s', async (contextChange) => {
        const selectedRow = component.data.data[0] as any;
        const otherEvent = new MockEvent(selectedRow.Event.getID()) as any;
        otherEvent.tags = ['Other owner'];
        const closed = new Subject<boolean>();
        let dialogData: any;
        let resolveSave: (tags: Record<string, string[]>) => void;
        mockEventTagService.applyBulkChanges.mockReturnValue(new Promise<Record<string, string[]>>(resolve => { resolveSave = resolve; }));
        component.selection.select(selectedRow);
        mockDialog.open.mockImplementation((_component: unknown, config: any) => {
            dialogData = config.data;
            return { afterClosed: () => closed.asObservable() };
        });
        const open = component.openBulkEventTagsDialog({ preventDefault: vi.fn(), stopPropagation: vi.fn() } as any);
        const save = dialogData.save({ add: ['Old owner edit'], remove: [] });
        component.events = [otherEvent];
        if (contextChange === 'account change') {
            component.user = new User('other-owner');
            component.user.settings = mockUser.settings;
        } else {
            fixture.destroy();
        }
        const changes = vi.fn();
        component.eventsChange.subscribe(changes);
        resolveSave({ [selectedRow.Event.getID()]: ['Old owner edit'] });
        await save;
        closed.next(true);
        closed.complete();
        await open;
        expect(mockEventTagService.applyBulkChanges).toHaveBeenCalledWith(mockUser, [selectedRow.Event.getID()], { add: ['Old owner edit'], remove: [] });
        expect(otherEvent.tags).toEqual(['Other owner']);
        expect(changes).not.toHaveBeenCalled();
        expect(mockSnackBar.open).not.toHaveBeenCalled();
    });

    it('should reject oversized bulk tag selections before opening the dialog', async () => {
        const selectedRows = Array.from({ length: 251 }, (_value, index) => ({
            Event: new MockEvent(`event-${index}`),
        })) as any[];
        component.selection.select(...selectedRows);

        await component.openBulkEventTagsDialog({ preventDefault: vi.fn(), stopPropagation: vi.fn() } as any);

        expect(mockDialog.open).not.toHaveBeenCalled();
        expect(mockEventTagService.applyBulkChanges).not.toHaveBeenCalled();
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Select up to 250 activities to update tags.',
            undefined,
            { duration: 3000 },
        );
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
        expect(mockSnackBar.open).toHaveBeenCalledWith('Activity saved', undefined, { duration: 2000 });
    });

    it('should patch-save event name via updateEventProperties', async () => {
        const event = new MockEvent('event-name') as any;

        await component.saveEventName('Updated Name', event);

        expect(mockEventService.updateEventProperties).toHaveBeenCalledWith(
            mockUser,
            'event-name',
            { name: 'Updated Name' }
        );
        expect(mockSnackBar.open).toHaveBeenCalledWith('Activity saved', undefined, { duration: 2000 });
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
        expect(component.selection.selected).toHaveLength(0);
    });

    it('should show snackbar when trying to merge fewer than two events', async () => {
        component.selection.clear();

        await component.mergeSelection(new Event('click'));

        expect(mockSnackBar.open).toHaveBeenCalledWith('Select at least two activities to merge', undefined, { duration: 2000 });
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
            'Selected activities include identical source files. Deselect duplicates and try again.',
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
        expect(mockSnackBar.open).toHaveBeenCalledWith('Not enough activities to merge', undefined, { duration: 3000 });
        expect(mockDialog.open.mock.results[0].value.close).toHaveBeenCalledWith(null);
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
        const refreshedRows = [
            { Event: new MockEvent('event1') },
            { Event: new MockEvent('event2') },
        ] as any[];
        component.data.data = refreshedRows;
        mockEventMergeService.mergeEvents.mockImplementationOnce(async () => {
            component.selection.clear();
            throw new Error('boom');
        });
        mockEventMergeService.getMergeErrorMessage.mockReturnValueOnce('Mapped merge error');

        await component.mergeSelection(new Event('click'));

        expect(mockSnackBar.open).toHaveBeenCalledWith('Mapped merge error', undefined, { duration: 5000 });
        expect(component.selection.selected).toHaveLength(2);
        expect(component.selection.selected).toEqual(refreshedRows);
        expect(mockDialog.open.mock.results[0].value.close).toHaveBeenCalledWith(null);
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
            'Activities merged. Open the merged activity from the table once it appears.',
            undefined,
            { duration: 5000 }
        );
        expect(mockLogger.captureException).toHaveBeenCalledWith(navigationError, {
            extra: {
                sourceEventsCount: 2,
                mergeType: 'benchmark',
                mergedEventID: 'merged-event',
                stage: 'open_merged_event',
            }
        });
    });

    describe('deleteSelection', () => {
        it('removes a row deleted through its action menu', () => {
            const changes = vi.fn();
            component.eventsChange.subscribe(changes);
            const e1 = new MockEvent('event1');
            const e2 = new MockEvent('event2');
            component.events = [e1 as any, e2 as any];
            component.selection.select({ Event: e1 } as any);
            const processChangesSpy = vi.spyOn(component as any, 'processChanges');

            component.removeDeletedEvent('event1');

            expect(component.events.map((event: any) => event.getID())).toEqual(['event2']);
            expect(component.selection.selected).toEqual([]);
            expect(processChangesSpy).toHaveBeenCalledWith('after_delete_row');
            expect(changes).toHaveBeenCalledWith({ userID: mockUser.uid, updatedTags: {}, deletedEventIDs: ['event1'] });
        });

        it('reports a confirmed deletion even after a parent filter removed the row from this table', () => {
            const changes = vi.fn();
            component.eventsChange.subscribe(changes);
            component.events = [new MockEvent('event2') as any];
            component.removeDeletedEvent('event1');
            expect(component.events.map(event => event.getID())).toEqual(['event2']);
            expect(changes).toHaveBeenCalledWith({ userID: mockUser.uid, updatedTags: {}, deletedEventIDs: ['event1'] });
        });

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
            expect(mockSnackBar.open).toHaveBeenCalledWith('Activities deleted', undefined, { duration: 2000 });
            expect(component.isLoading).toBe(false);
        });

        it('reconciles confirmed deletions even when another selected activity fails to delete', async () => {
            const changes = vi.fn();
            component.eventsChange.subscribe(changes);
            const e1 = new MockEvent('event1');
            const e2 = new MockEvent('event2');
            component.events = [e1 as any, e2 as any, new MockEvent('event3') as any];
            component.selection.select({ Event: e1 } as any, { Event: e2 } as any);
            mockEventService.deleteAllEventData.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('failed'));
            mockDialog.open.mockReturnValueOnce({ afterClosed: () => of(true) });

            await component.deleteSelection();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(component.events.map(event => event.getID())).toEqual(['event2', 'event3']);
            expect(changes).toHaveBeenCalledOnce();
            expect(changes).toHaveBeenCalledWith({ userID: mockUser.uid, updatedTags: {}, deletedEventIDs: ['event1'] });
            expect(mockHapticsService.error).toHaveBeenCalledOnce();
            expect(mockHapticsService.success).not.toHaveBeenCalled();
            expect(component.isLoading).toBe(false);
        });

        it('keeps activity search and sort persistence active after bulk deletion', async () => {
            component.events = [new MockEvent('event1') as any, new MockEvent('event2') as any];
            component.selection.select({ Event: component.events[0] } as any);
            mockDialog.open.mockReturnValueOnce({ afterClosed: () => of(true) });
            await component.deleteSelection();
            await new Promise(resolve => setTimeout(resolve, 0));

            component.onSearchInput({ target: { value: 'test run' } } as unknown as Event);
            await new Promise(resolve => setTimeout(resolve, 300));
            expect(component.searchTerm).toBe('test run');
            expect(JSON.parse(component.data.filter).text).toBe('test run');
            component.sort.sortChange.next({ active: 'Distance', direction: 'asc' });
            expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(mockUser, {
                settings: { dashboardSettings: { tableSettings: { active: 'Distance', direction: 'asc' } } },
            });
        });

        it('deletes the confirmed IDs when the tag context changes while confirmation is open', async () => {
            const original = new MockEvent('event1');
            component.events = [original as any, new MockEvent('event2') as any];
            component.selection.select({ Event: original } as any);
            const closed = new Subject<boolean>();
            mockDialog.open.mockReturnValueOnce({ afterClosed: () => closed.asObservable() });
            const changes = vi.fn();
            component.eventsChange.subscribe(changes);
            await component.deleteSelection();

            component.events = [new MockEvent('event2') as any];
            component.paginator.firstPage = vi.fn();
            component.ngOnChanges({ filterContext: new SimpleChange('Endurance', 'Recovery', false) });
            closed.next(true);
            closed.complete();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(mockEventService.deleteAllEventData).toHaveBeenCalledWith(mockUser, 'event1');
            expect(changes).toHaveBeenCalledWith({ userID: mockUser.uid, updatedTags: {}, deletedEventIDs: ['event1'] });
            expect(component.events.map(event => event.getID())).toEqual(['event2']);
        });

        it('abandons a pending delete confirmation when the account changes', async () => {
            component.selection.select({ Event: component.events[0] } as any);
            const closed = new Subject<boolean>();
            mockDialog.open.mockReturnValueOnce({ afterClosed: () => closed.asObservable() });
            await component.deleteSelection();
            component.user = new User('other');
            closed.next(true);
            closed.complete();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(mockEventService.deleteAllEventData).not.toHaveBeenCalled();
            expect(mockHapticsService.success).not.toHaveBeenCalled();
            expect(mockHapticsService.error).not.toHaveBeenCalled();
        });

        it.each(['account change', 'component teardown'])('keeps completed bulk deletion callbacks silent after %s', async (contextChange) => {
            const originalEvent = component.events[0];
            component.selection.select({ Event: originalEvent } as any);
            let resolveDelete: (value: boolean) => void;
            mockEventService.deleteAllEventData.mockReturnValueOnce(new Promise<boolean>(resolve => { resolveDelete = resolve; }));
            mockDialog.open.mockReturnValueOnce({ afterClosed: () => of(true) });
            const changes = vi.fn();
            component.eventsChange.subscribe(changes);
            await component.deleteSelection();
            if (contextChange === 'account change') {
                component.user = new User('other-owner');
                component.user.settings = mockUser.settings;
            } else {
                fixture.destroy();
            }
            const loaded = vi.spyOn(component, 'loaded');
            resolveDelete(true);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(mockEventService.deleteAllEventData).toHaveBeenCalledWith(mockUser, originalEvent.getID());
            expect(changes).not.toHaveBeenCalled();
            expect(loaded).not.toHaveBeenCalled();
            expect(mockSnackBar.open).not.toHaveBeenCalled();
            expect(mockHapticsService.success).not.toHaveBeenCalled();
            expect(mockHapticsService.error).not.toHaveBeenCalled();
        });
    });

    describe('downloadOriginals', () => {
        it('should show message when no events are selected', async () => {
            component.selection.clear();
            await component.downloadOriginals();
            expect(mockSnackBar.open).toHaveBeenCalledWith('No activities selected', undefined, { duration: 2000 });
        });

        it('should show message when selected events have no original files', async () => {
            const e1 = new MockEvent('event1');
            e1.originalFiles = [];
            e1.originalFile = null;
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockSnackBar.open).toHaveBeenCalledWith('No original files available for selected activities', undefined, { duration: 3000 });
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

            expect(mockSnackBar.open).toHaveBeenCalledWith('No activities selected', undefined, { duration: 2000 });
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
                'Downloaded 2 GPX files. Skipped 1 activity.',
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
                'Downloaded 1 GPX file. Skipped 1 activity.',
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
                'Could not export GPX for selected activities',
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
        it.each([true, false])('waits for accepted selection-send navigation before feedback: %s', async opened => {
            component.selection.select({ Event: new MockEvent('event1') });
            let finishNavigation!: (result: boolean) => void;
            mockRouter.navigate.mockReturnValueOnce(new Promise<boolean>(resolve => { finishNavigation = resolve; }));
            const action = component.sendToService();
            expect(mockRouter.navigate).toHaveBeenCalledWith(['/send-activities'], { queryParams: { source: 'saved' }, state: { activitySendSelection: ['event1'], activitySendOwner: 'testUser' } });
            expect(mockHapticsService.selection).not.toHaveBeenCalled();
            finishNavigation(opened); await action;
            expect(mockHapticsService.selection).toHaveBeenCalledTimes(Number(opened));
            expect(mockHapticsService.success).not.toHaveBeenCalled();
            expect(mockHapticsService.error).not.toHaveBeenCalled();
        });
        it('keeps shared selections outside activity sending', async () => {
            component.selection.select({ Event: new MockEvent('event1') });
            component.targetUser = new User('another-owner');
            await component.sendToService();
            expect(mockRouter.navigate).not.toHaveBeenCalled();
            expect(mockHapticsService.selection).not.toHaveBeenCalled();
        });
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

describe('EventTableActionsComponent Material menu', () => {
    it('initializes only the visible metric columns as selected and applies an accepted change', async () => {
        const haptics = { selection: vi.fn() };
        await TestBed.configureTestingModule({
            declarations: [EventTableActionsComponent, HapticTapDirective],
            imports: [MatListModule, MatMenuModule, MatButtonModule, MatIconModule, NoopAnimationsModule],
            providers: [{ provide: AppHapticsService, useValue: haptics }],
        }).compileComponents();
        const menuFixture = TestBed.createComponent(EventTableActionsComponent);
        menuFixture.componentRef.setInput('selectedDataTypes', ['Distance', 'Duration']);
        menuFixture.componentRef.setInput('dataTypes', ['Duration', 'Distance', 'Ascent']);
        menuFixture.detectChanges();
        const changes = vi.fn();
        menuFixture.componentInstance.selectedDataTypesChange.subscribe(changes);
        const trigger = menuFixture.debugElement.query(By.directive(MatMenuTrigger)).injector.get(MatMenuTrigger);
        trigger.openMenu();
        menuFixture.detectChanges();
        await menuFixture.whenStable();
        const overlay = TestBed.inject(OverlayContainer).getContainerElement();
        const options = [...overlay.querySelectorAll<HTMLElement>('[role="option"]')];
        expect(options.map(option => [option.textContent.trim(), option.getAttribute('aria-selected')])).toEqual([
            ['Duration', 'true'], ['Distance', 'true'], ['Ascent', 'false'],
        ]);
        expect(haptics.selection).not.toHaveBeenCalled();
        options[2].click();
        menuFixture.detectChanges();
        expect(haptics.selection).toHaveBeenCalledOnce();
        trigger.closeMenu();
        await menuFixture.whenStable();
        expect(changes).toHaveBeenCalledWith(['Duration', 'Distance', 'Ascent']);
    });
});
