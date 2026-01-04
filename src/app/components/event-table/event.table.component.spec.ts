import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { EventTableComponent } from './event.table.component';
import { AppEventService } from '../../services/app.event.service';
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
            getColorForActivityTypeByActivityTypeGroup: vi.fn(),
            getGradientForActivityTypeGroup: vi.fn()
        };

        mockFileService = {
            downloadAsZip: vi.fn().mockReturnValue(Promise.resolve()),
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

        await TestBed.configureTestingModule({
            imports: [NoopAnimationsModule],
            declarations: [EventTableComponent],
            providers: [
                { provide: Analytics, useValue: {} },
                { provide: AppAnalyticsService, useValue: { logEvent: vi.fn() } },
                { provide: AppEventService, useValue: mockEventService },
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

    describe('downloadOriginals', () => {
        it('should show message when no events are selected', async () => {
            component.selection.clear();
            await component.downloadOriginals();
            expect(mockSnackBar.open).toHaveBeenCalledWith('No events selected', null, { duration: 2000 });
        });

        it('should show message when selected events have no original files', async () => {
            const e1 = new MockEvent('event1');
            e1.originalFiles = [];
            e1.originalFile = null;
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockSnackBar.open).toHaveBeenCalledWith('No original files available for selected events', null, { duration: 3000 });
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

        it('should download and zip files from events with legacy originalFile', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15');
            e1.originalFiles = [];
            e1.originalFile = { path: 'users/123/files/legacy.fit' };
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockEventService.downloadFile).toHaveBeenCalledWith('users/123/files/legacy.fit');
            expect(mockFileService.downloadAsZip).toHaveBeenCalled();
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith(expect.any(String), 'Downloaded 1 files');
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

        it('should name files using event date format', async () => {
            const e1 = new MockEvent('event1');
            e1.startDate = new Date('2024-12-15T08:30:00');
            e1.originalFiles = [{ path: 'users/123/files/activity.fit' }];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            // Verify the file is named with date format: 2024-12-15_08-30.fit
            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ fileName: '2024-12-15_08-30.fit' })
                ]),
                expect.any(String)
            );
        });

        it('should handle Firestore Timestamp objects', async () => {
            const e1 = new MockEvent('event1');
            // Simulate Firestore Timestamp with toDate() method
            (e1 as any).startDate = {
                toDate: () => new Date('2024-12-20T14:45:00')
            };
            e1.originalFiles = [{ path: 'users/123/files/activity.fit' }];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ fileName: '2024-12-20_14-45.fit' })
                ]),
                expect.any(String)
            );
        });

        it('should use event ID as fallback when date is missing', async () => {
            const e1 = new MockEvent('test-event-id');
            (e1 as any).startDate = null;
            e1.originalFiles = [{ path: 'users/123/files/activity.fit' }];
            component.selection.select({ 'Event': e1 } as any);

            await component.downloadOriginals();

            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ fileName: 'test-event-id.fit' })
                ]),
                expect.any(String)
            );
        });

        it('should handle download errors gracefully and continue with other files', async () => {
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

            // Filename should be date-based with index: 2024-12-01_10-30_1.fit
            expect(mockFileService.downloadAsZip).toHaveBeenCalledWith(
                expect.arrayContaining([expect.objectContaining({ fileName: expect.stringMatching(/2024-12-01.*\.fit/) })]),
                expect.any(String)
            );
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith(expect.any(String), 'Downloaded 1 files');
        });
    });
});
