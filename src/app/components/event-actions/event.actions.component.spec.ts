import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventActionsComponent } from './event.actions.component';
import { AppEventService } from '../../services/app.event.service';
import { AppFileService } from '../../services/app.file.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Analytics } from '@angular/fire/analytics';
import { Auth } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { AppSharingService } from '../../services/app.sharing.service';
import { AppWindowService } from '../../services/app.window.service';
import { Clipboard } from '@angular/cdk/clipboard';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppEventReprocessService, ReprocessError } from '../../services/app.event-reprocess.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MatMenuModule } from '@angular/material/menu';
import { of } from 'rxjs';

vi.mock('@angular/fire/analytics', () => ({
    Analytics: class { },
    logEvent: vi.fn(),
    setAnalyticsCollectionEnabled: vi.fn()
}));

describe('EventActionsComponent', () => {
    let component: EventActionsComponent;
    let fixture: ComponentFixture<EventActionsComponent>;
    let mockEventService: any;
    let mockEventReprocessService: any;
    let mockProcessingService: any;
    let mockFileService: any;
    let mockSnackBar: any;
    let mockDialog: any;

    beforeEach(async () => {
        mockEventService = {
            downloadFile: vi.fn(),
            getEventMetaData: vi.fn(),
            getEventAsJSONBloB: vi.fn(),
            getEventAsGPXBloB: vi.fn(),
            writeAllEventData: vi.fn().mockResolvedValue(true),
        };
        mockEventReprocessService = {
            regenerateEventStatistics: vi.fn().mockResolvedValue({ event: null }),
            reimportEventFromOriginalFiles: vi.fn().mockResolvedValue({ event: null }),
        };
        mockProcessingService = {
            addJob: vi.fn().mockReturnValue('job-id'),
            updateJob: vi.fn(),
            completeJob: vi.fn(),
            failJob: vi.fn(),
        };
        mockFileService = {
            downloadAsZip: vi.fn(),
            downloadFile: vi.fn(),
            toDate: vi.fn((rawDate: any) => {
                if (!rawDate) return null;
                if (rawDate instanceof Date) return rawDate;
                if (rawDate.toDate && typeof rawDate.toDate === 'function') return rawDate.toDate();
                if (typeof rawDate === 'number') return new Date(rawDate);
                if (typeof rawDate === 'string') return new Date(rawDate);
                return null;
            }),
            generateDateBasedFilename: vi.fn((date, extension, _index, _totalFiles, fallbackId) => {
                const dateStr = date ? date.toISOString().split('T')[0] : null;
                const baseStr = dateStr || fallbackId || 'activity';
                return `${baseStr}.${extension}`;
            }),
            generateDateRangeZipFilename: vi.fn((minDate, _maxDate, suffix = 'originals') => {
                const dateStr = minDate ? minDate.toISOString().split('T')[0] : 'unknown';
                return `${dateStr}_${suffix}.zip`;
            }),
            getExtensionFromPath: vi.fn((path: string) => {
                const parts = path.split('.');
                return parts.length > 1 ? parts[parts.length - 1] : 'fit';
            })
        };
        mockSnackBar = {
            open: vi.fn(),
        };
        mockDialog = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(true),
            }),
        };

        await TestBed.configureTestingModule({
            declarations: [EventActionsComponent],
            imports: [HttpClientTestingModule, MatMenuModule],
            providers: [
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppEventReprocessService, useValue: mockEventReprocessService },
                { provide: AppProcessingService, useValue: mockProcessingService },
                { provide: AppFileService, useValue: mockFileService },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: Analytics, useValue: null }, // Mock Analytics
                { provide: Auth, useValue: { currentUser: { uid: 'test-user' } } }, // Mock Auth
                { provide: Router, useValue: { navigate: vi.fn() } },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatBottomSheet, useValue: { open: vi.fn() } },
                { provide: AppSharingService, useValue: { getShareURLForEvent: vi.fn() } },
                { provide: AppWindowService, useValue: { windowRef: { open: vi.fn() } } },
                { provide: Clipboard, useValue: { copy: vi.fn() } },
                { provide: AppAnalyticsService, useValue: { logEvent: vi.fn() } }
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EventActionsComponent);
        component = fixture.componentInstance;
        component.user = { uid: 'test-uid' } as any;
        // Mock event object with minimal required methods and properties
        component.event = {
            getID: () => 'event-123',
            startDate: new Date(),
            getActivityTypesAsString: () => 'Run',
            getFirstActivity: () => ({ hasStreamData: () => false, hasPositionData: () => false }),
            getActivities: () => [],
            getStat: () => null
        } as any;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('downloadOriginals', () => {
        it('should download a single file if originalFile is present', async () => {
            const mockArrayBuffer = new ArrayBuffer(10);
            mockEventService.downloadFile.mockResolvedValue(mockArrayBuffer);
            (component.event as any).originalFile = { path: 'path/to/file.fit' };

            await component.downloadOriginals();

            expect(mockEventService.downloadFile).toHaveBeenCalledWith('path/to/file.fit');
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            // Check arguments for downloadFile. 
            // Arg 0 is Blob, Arg 1 is name, Arg 2 is extension
            const args = mockFileService.downloadFile.mock.calls[0];
            expect(args[2]).toBe('fit');
        });

        it('should download a zip if originalFiles (multiple) are present', async () => {
            const mockArrayBuffer = new ArrayBuffer(10);
            mockEventService.downloadFile.mockResolvedValue(mockArrayBuffer);
            (component.event as any).originalFiles = [
                { path: 'path/to/file1.fit' },
                { path: 'path/to/file2.fit' }
            ];

            await component.downloadOriginals();

            expect(mockEventService.downloadFile).toHaveBeenCalledTimes(2);
            expect(mockFileService.downloadAsZip).toHaveBeenCalled();
            const args = mockFileService.downloadAsZip.mock.calls[0];
            expect(args[0]).toHaveLength(2); // 2 files
            expect(args[1]).toContain('.zip');
        });

        it('should download a single file directly if originalFiles has exactly 1 item', async () => {
            const mockArrayBuffer = new ArrayBuffer(10);
            mockEventService.downloadFile.mockResolvedValue(mockArrayBuffer);
            (component.event as any).originalFiles = [
                { path: 'path/to/single.fit' }
            ];

            await component.downloadOriginals();

            expect(mockEventService.downloadFile).toHaveBeenCalledWith('path/to/single.fit');
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
            const args = mockFileService.downloadFile.mock.calls[0];
            expect(args[2]).toBe('fit');
        });

        it('should show snackbar if no files', async () => {
            (component.event as any).originalFile = undefined;
            (component.event as any).originalFiles = undefined;

            await component.downloadOriginals();

            expect(mockSnackBar.open).toHaveBeenCalledWith('No original files found.', undefined, { duration: 3000 });
        });
    });

    describe('downloadJSON', () => {
        it('should call getEventAsJSONBloB with the event object', async () => {
            const mockBlob = new Blob(['{}'], { type: 'application/json' });
            mockEventService.getEventAsJSONBloB.mockResolvedValue(mockBlob);

            await component.downloadJSON();

            expect(mockEventService.getEventAsJSONBloB).toHaveBeenCalledWith(component.user, component.event);
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            const args = mockFileService.downloadFile.mock.calls[0];
            expect(args[0]).toBe(mockBlob);
            expect(args[2]).toBe('json');
        });

        it('should show snackbar and avoid file download when JSON generation fails', async () => {
            mockEventService.getEventAsJSONBloB.mockRejectedValue(new Error('hydrate failed'));

            await component.downloadJSON();

            expect(mockFileService.downloadFile).not.toHaveBeenCalled();
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Could not download JSON file',
                undefined,
                { duration: 3000 },
            );
        });
    });

    describe('downloadGPX', () => {
        it('should call getEventAsGPXBloB with the event object', async () => {
            const mockBlob = new Blob(['<gpx></gpx>'], { type: 'application/gpx+xml' });
            mockEventService.getEventAsGPXBloB.mockResolvedValue(mockBlob);

            await component.downloadGPX();

            expect(mockEventService.getEventAsGPXBloB).toHaveBeenCalledWith(component.user, component.event);
            expect(mockFileService.downloadFile).toHaveBeenCalled();
            const args = mockFileService.downloadFile.mock.calls[0];
            expect(args[0]).toBe(mockBlob);
            expect(args[2]).toBe('gpx');
        });

        it('should show snackbar and avoid file download when GPX generation fails', async () => {
            mockEventService.getEventAsGPXBloB.mockRejectedValue(new Error('hydrate failed'));

            await component.downloadGPX();

            expect(mockFileService.downloadFile).not.toHaveBeenCalled();
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Could not download GPX file',
                undefined,
                { duration: 3000 },
            );
        });
    });

    describe('isHydrated', () => {
        it('should return true if any activity has streams', () => {
            const mockActivity = { getAllStreams: () => ['stream1'] };
            vi.spyOn(component.event, 'getActivities').mockReturnValue([mockActivity] as any);
            expect(component.isHydrated()).toBe(true);
        });

        it('should return false if no activities', () => {
            vi.spyOn(component.event, 'getActivities').mockReturnValue([]);
            expect(component.isHydrated()).toBe(false);
        });

        it('should return false if no activity has streams', () => {
            const mockActivity = { getAllStreams: () => [] };
            vi.spyOn(component.event, 'getActivities').mockReturnValue([mockActivity] as any);
            expect(component.isHydrated()).toBe(false);
        });

        it('should return true if first activity has no streams but another has streams', () => {
            const mockActivity1 = { getAllStreams: () => [] };
            const mockActivity2 = { getAllStreams: () => ['stream1'] };
            vi.spyOn(component.event, 'getActivities').mockReturnValue([mockActivity1, mockActivity2] as any);
            expect(component.isHydrated()).toBe(true);
        });
    });

    describe('hasDistance', () => {
        it('should return true if any activity has distance stream', () => {
            const mockActivity = { hasStreamData: vi.fn().mockReturnValue(true) };
            vi.spyOn(component.event, 'getActivities').mockReturnValue([mockActivity] as any);
            expect(component.hasDistance()).toBe(true);
            expect(mockActivity.hasStreamData).toHaveBeenCalled();
        });

        it('should return false if no activities', () => {
            vi.spyOn(component.event, 'getActivities').mockReturnValue([]);
            expect(component.hasDistance()).toBe(false);
        });

        it('should return true if first activity has no distance but another does', () => {
            const mockActivity1 = { hasStreamData: vi.fn().mockReturnValue(false) };
            const mockActivity2 = { hasStreamData: vi.fn().mockReturnValue(true) };
            vi.spyOn(component.event, 'getActivities').mockReturnValue([mockActivity1, mockActivity2] as any);
            expect(component.hasDistance()).toBe(true);
        });
    });

    describe('hasPositionalData', () => {
        it('should return true if event has start position', () => {
            vi.spyOn(component.event, 'getStat').mockReturnValue({} as any);
            expect(component.hasPositionalData()).toBeTruthy();
        });

        it('should return true if any activity has position data', () => {
            vi.spyOn(component.event, 'getStat').mockReturnValue(null);
            const mockActivity1 = { hasPositionData: () => false };
            const mockActivity2 = { hasPositionData: () => true };
            vi.spyOn(component.event, 'getActivities').mockReturnValue([mockActivity1, mockActivity2] as any);
            expect(component.hasPositionalData()).toBeTruthy();
        });

        it('should return false if no start position and no activity position data', () => {
            vi.spyOn(component.event, 'getStat').mockReturnValue(null);
            const mockActivity = { hasPositionData: () => false };
            vi.spyOn(component.event, 'getActivities').mockReturnValue([mockActivity] as any);
            expect(component.hasPositionalData()).toBeFalsy();
        });
    });

    describe('reGenerateStatistics', () => {
        it('should delegate to AppEventReprocessService and complete processing job', async () => {
            await component.reGenerateStatistics();
            expect(mockEventReprocessService.regenerateEventStatistics).toHaveBeenCalledWith(
                component.user,
                component.event,
                expect.objectContaining({ onProgress: expect.any(Function) }),
            );
            expect(mockProcessingService.addJob).toHaveBeenCalledWith('process', 'Re-calculating activity statistics...');
            expect(mockProcessingService.completeJob).toHaveBeenCalled();
        });

        it('should do nothing when confirmation is cancelled', async () => {
            mockDialog.open.mockReturnValueOnce({
                afterClosed: () => of(false),
            });

            await component.reGenerateStatistics();

            expect(mockEventReprocessService.regenerateEventStatistics).not.toHaveBeenCalled();
            expect(mockProcessingService.addJob).not.toHaveBeenCalled();
        });

        it('should fail processing job and show snackbar on regenerate failure', async () => {
            mockEventReprocessService.regenerateEventStatistics.mockRejectedValueOnce(
                new ReprocessError('PARSE_FAILED', 'boom'),
            );

            await component.reGenerateStatistics();

            expect(mockProcessingService.failJob).toHaveBeenCalled();
            expect(mockSnackBar.open).toHaveBeenCalledWith('Could not parse the original source file.', undefined, {
                duration: 4000,
            });
        });
    });

    describe('reImportActivityFromFile', () => {
        it('should delegate reimport to AppEventReprocessService', async () => {
            (component.event as any).originalFile = { path: 'path/to/file.fit' };

            await component.reImportActivityFromFile();

            expect(mockEventReprocessService.reimportEventFromOriginalFiles).toHaveBeenCalledWith(
                component.user,
                component.event,
                expect.objectContaining({ onProgress: expect.any(Function) }),
            );
            expect(mockProcessingService.completeJob).toHaveBeenCalled();
        });

        it('should not reimport when confirmation is cancelled', async () => {
            (component.event as any).originalFile = { path: 'path/to/file.fit' };
            mockDialog.open.mockReturnValueOnce({
                afterClosed: () => of(false),
            });

            await component.reImportActivityFromFile();

            expect(mockEventReprocessService.reimportEventFromOriginalFiles).not.toHaveBeenCalled();
        });

        it('should not call reimport when original file metadata is missing', async () => {
            (component.event as any).originalFile = undefined;
            (component.event as any).originalFiles = undefined;

            await component.reImportActivityFromFile();

            expect(mockEventReprocessService.reimportEventFromOriginalFiles).not.toHaveBeenCalled();
        });
    });

    describe('reimport visibility helpers', () => {
        it('canReimportFromOriginalFile should return true when originalFiles exists', () => {
            (component.event as any).originalFiles = [{ path: 'file.fit' }];
            expect(component.canReimportFromOriginalFile()).toBe(true);
        });

        it('canReimportFromOriginalFile should return false and expose disabled reason', () => {
            (component.event as any).originalFile = undefined;
            (component.event as any).originalFiles = undefined;
            expect(component.canReimportFromOriginalFile()).toBe(false);
            expect(component.getReimportDisabledReason()).toContain('No original source files');
        });
    });
});
