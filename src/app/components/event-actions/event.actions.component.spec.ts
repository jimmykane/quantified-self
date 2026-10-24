import { AppEventSummary } from '@shared/event-summary';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { EventActionsComponent } from './event.actions.component';
import { AppEventService } from '../../services/app.event.service';
import { AppFileService } from '../../services/app.file.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Analytics } from 'app/firebase/analytics';
import { Auth } from 'app/firebase/auth';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { AppWindowService } from '../../services/app.window.service';
import { Clipboard } from '@angular/cdk/clipboard';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppEventReprocessService, ReprocessError } from '../../services/app.event-reprocess.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { AppEventSharingService, SetEventSharingResponse } from '../../services/app.event-sharing.service';
import { ApplicationRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { By } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MAT_ICON_DEFAULT_OPTIONS, MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Privacy } from '@sports-alliance/sports-lib';
import { of, Subject } from 'rxjs';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { CalendarDayDetailsNavigationService } from '../../services/calendar-day-details-navigation.service';
import { AppHapticsService } from '../../services/app.haptics.service';

vi.mock('app/firebase/analytics', () => ({
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
    let mockEventSharingService: any;
    let mockRouter: any;
    let mockLocation: any;
    let mockDayDetailsNavigation: any;
    let mockHapticsService: any;

    beforeEach(async () => {
        mockEventService = {
            deleteAllEventData: vi.fn().mockResolvedValue(true),
            downloadFile: vi.fn(),
            downloadOriginalFile: vi.fn(),
            getOriginalEventDownloadSources: vi.fn((event: { originalFiles?: any[]; originalFile?: any; startDate?: any }) => (
                Array.isArray(event.originalFiles) && event.originalFiles.length > 0
                    ? event.originalFiles
                        .filter((file: any) => !!file?.path)
                        .map((file: any) => ({
                            ...file,
                            fallbackDate: file.fallbackDate || file.startDate || event.startDate,
                            downloadFileName: file.downloadFileName || file.originalFilename || file.path?.split('/').filter(Boolean).pop(),
                        }))
                    : event.originalFile?.path ? [{
                        ...event.originalFile,
                        fallbackDate: event.originalFile.fallbackDate || event.originalFile.startDate || event.startDate,
                        downloadFileName: event.originalFile.downloadFileName || event.originalFile.originalFilename || event.originalFile.path.split('/').filter(Boolean).pop(),
                    }] : []
            )),
            getEventMetaData: vi.fn(),
            getEventAsGPXBloB: vi.fn(),
            getEventAndActivitiesOnce: vi.fn(),
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
            removeJob: vi.fn(),
        };
        mockFileService = {
            downloadAsZip: vi.fn(),
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
            resolveOriginalSourceFileName: vi.fn((file: { originalFilename?: string; path?: string }, fallbackExtension = 'fit') => (
                file.originalFilename
                    || file.path?.split('/').filter(Boolean).pop()
                    || `original-file.${fallbackExtension}`
            )),
            getUniqueFileName: vi.fn((fileName: string) => fileName),
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
                if (parts.length <= 1) {
                    return 'fit';
                }
                let extension = parts[parts.length - 1].toLowerCase();
                if (extension === 'gz' && parts.length > 2) {
                    extension = parts[parts.length - 2].toLowerCase();
                }
                return extension;
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
        mockEventSharingService = {
            setEventSharing: vi.fn().mockResolvedValue({
                eventID: 'event-123',
                privacy: 'public',
                publicEventUrl: '/share/event/test-uid/event-123',
                publicComparisonUrl: '/share/comparison/test-uid/event-123',
            }),
            copyShareUrl: vi.fn(() => true),
        };
        mockRouter = {
            navigate: vi.fn().mockResolvedValue(true),
            lastSuccessfulNavigation: null,
        };
        mockLocation = { back: vi.fn() };
        mockDayDetailsNavigation = { markEventDeleted: vi.fn() };
        mockHapticsService = {
            selection: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        };

        await TestBed.configureTestingModule({
            declarations: [EventActionsComponent],
            imports: [HttpClientTestingModule, MatMenuModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
            providers: [
                { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppEventReprocessService, useValue: mockEventReprocessService },
                { provide: AppProcessingService, useValue: mockProcessingService },
                { provide: AppFileService, useValue: mockFileService },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: Analytics, useValue: null }, // Mock Analytics
                { provide: Auth, useValue: { currentUser: { uid: 'test-user' } } }, // Mock Auth
                { provide: Router, useValue: mockRouter },
                { provide: Location, useValue: mockLocation },
                { provide: CalendarDayDetailsNavigationService, useValue: mockDayDetailsNavigation },
                { provide: MatDialog, useValue: mockDialog },
                { provide: MatBottomSheet, useValue: { open: vi.fn() } },
                { provide: AppWindowService, useValue: { windowRef: { open: vi.fn() } } },
                { provide: Clipboard, useValue: { copy: vi.fn() } },
                { provide: AppEventSharingService, useValue: mockEventSharingService },
                { provide: AppAnalyticsService, useValue: { logEvent: vi.fn() } },
                { provide: AppHapticsService, useValue: mockHapticsService },
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
            toJSON: () => ({}),
            getID: () => 'event-123',
            startDate: new Date(),
            getActivityTypesAsString: () => 'Run',
            getFirstActivity: () => ({ hasStreamData: () => false, hasPositionData: () => false }),
            getActivities: () => [],
            getStat: () => null,
            privacy: 'private',
        } as any;
        fixture.detectChanges();
    });

    it('loads a complete event for a summary GPX action and keeps metadata checks lazy', async () => {
        const full = component.event;
        component.event = new AppEventSummary({ id: 'event-123', name: 'Run', startDate: 1000, endDate: 2000,
            stats: { 'Start Position': { latitudeDegrees: 0, longitudeDegrees: 0 } } } as any);
        expect(component.hasPositionalData()).toBeTruthy();
        expect(component.isHydrated()).toBe(false);
        mockEventService.getEventAndActivitiesOnce = vi.fn().mockReturnValue(of(full));
        mockEventService.getEventAsGPXBloB.mockResolvedValue(new Blob());
        await component.downloadGPX();
        expect(mockEventService.getEventAndActivitiesOnce).toHaveBeenCalledExactlyOnceWith(component.user, 'event-123');
        expect(mockEventService.getEventAsGPXBloB).toHaveBeenCalledExactlyOnceWith(component.user, full);
    });

    it('applies committed elevation to a lazy summary without fetching child activities', async () => {
        component.user = { uid: 'test-user' } as any;
        component.event = new AppEventSummary({ id: 'event-123', name: 'Hike', startDate: 1000, endDate: 2000, stats: { Ascent: 100 } } as any);
        const closed = new Subject<unknown>();
        mockDialog.open.mockReturnValueOnce({ afterClosed: () => closed });
        await component.editAscent();
        closed.next({ activityId: 'hike', metric: 'ascent', value: 0, eventValue: 0, correction: { value: 0, sourceValue: 100 } });
        expect(component.event.getStat('Ascent')?.getValue()).toBe(0);
    });

    it.each(['reGenerateStatistics', 'reImportActivityFromFile'] as const)(
        'does not retarget %s when the row changes during confirmation', async action => {
            (component.event as any).originalFile = { path: 'source.fit' };
            const closed = new Subject<boolean>();
            mockDialog.open.mockReturnValueOnce({ afterClosed: () => closed });
            const work = component[action]();
            component.event = { ...component.event, getID: () => 'other-event' } as any;
            closed.next(true);
            await work;
            expect(mockEventService.getEventAndActivitiesOnce).not.toHaveBeenCalled();
            expect(mockEventReprocessService.regenerateEventStatistics).not.toHaveBeenCalled();
            expect(mockEventReprocessService.reimportEventFromOriginalFiles).not.toHaveBeenCalled();
            expect(mockProcessingService.addJob).not.toHaveBeenCalled();
            expect(component.isReprocessing).toBe(false);
        });

    it.each(['reGenerateStatistics', 'reImportActivityFromFile'] as const)(
        'runs %s from summary identity without requiring malformed stats to hydrate', async action => {
            component.event = new AppEventSummary({ id: 'event-123', name: 'Run', startDate: 1000, endDate: 2000,
                stats: { 'Average Power': 'malformed stored value' } } as any);
            component.event.originalFile = { path: 'source.fit' } as any;
            mockEventService.getEventAndActivitiesOnce.mockImplementation(() => { throw new Error('Cannot restore malformed source'); });
            await component[action]();
            const reprocess = action === 'reGenerateStatistics' ? mockEventReprocessService.regenerateEventStatistics
                : mockEventReprocessService.reimportEventFromOriginalFiles;
            expect(reprocess).toHaveBeenCalledWith(component.user, component.event, expect.any(Object));
            expect(mockEventService.getEventAndActivitiesOnce).not.toHaveBeenCalled();
            expect(mockProcessingService.completeJob).toHaveBeenCalled();
            expect(mockHapticsService.error).not.toHaveBeenCalled();
        });

    it.each([
        ['reGenerateStatistics', 'owner'], ['reGenerateStatistics', 'account'],
        ['reImportActivityFromFile', 'owner'], ['reImportActivityFromFile', 'account'],
    ] as const)(
        'cancels %s quietly if its %s changes while callable preparation is pending', async (action, changed) => {
            (component.event as any).originalFile = { path: 'source.fit' };
            let ready!: () => void;
            const preparation = new Promise<void>(resolve => { ready = resolve; });
            const reprocess = action === 'reGenerateStatistics' ? mockEventReprocessService.regenerateEventStatistics
                : mockEventReprocessService.reimportEventFromOriginalFiles;
            const dispatch = vi.fn();
            reprocess.mockImplementation(async (_owner, _event, options) => {
                await preparation;
                if (!options.canExecute()) throw new ReprocessError('CANCELLED', 'Operation cancelled');
                dispatch();
            });
            const work = component[action]();
            await vi.waitFor(() => expect(reprocess).toHaveBeenCalledOnce());
            if (changed === 'owner') component.user = { uid: 'new-owner' } as any;
            else (TestBed.inject(Auth) as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'new-account' };
            ready();
            await work;
            expect(dispatch).not.toHaveBeenCalled();
            expect(mockProcessingService.removeJob).toHaveBeenCalledWith('job-id');
            expect(mockProcessingService.failJob).not.toHaveBeenCalled();
            expect(mockHapticsService.success).not.toHaveBeenCalled();
            expect(mockHapticsService.error).not.toHaveBeenCalled();
        });

    it.each(['reGenerateStatistics', 'reImportActivityFromFile'] as const)(
        'reports %s as saved when only the refreshed read fails', async action => {
            (component.event as any).originalFile = { path: 'source.fit' };
            const reprocess = action === 'reGenerateStatistics' ? mockEventReprocessService.regenerateEventStatistics
                : mockEventReprocessService.reimportEventFromOriginalFiles;
            const message = 'Activity was reprocessed, but its updated data could not be loaded. Refresh the page.';
            reprocess.mockRejectedValueOnce(new ReprocessError('PERSIST_FAILED', message));
            await component[action]();
            expect(reprocess).toHaveBeenCalledOnce();
            expect(mockProcessingService.completeJob).toHaveBeenCalledWith('job-id', 'Activity reprocessed; refresh needed');
            expect(mockProcessingService.failJob).not.toHaveBeenCalled();
            expect(mockSnackBar.open).toHaveBeenCalledWith(message, undefined, { duration: 4000 });
            expect(mockHapticsService.success).not.toHaveBeenCalled();
        });

    it.each(['reGenerateStatistics', 'reImportActivityFromFile'] as const)(
        're-enables the rendered menu after %s confirmation is cancelled', async action => {
            (component.event as any).originalFile = { path: 'source.fit' };
            fixture.autoDetectChanges();
            const trigger = fixture.debugElement.query(By.directive(MatMenuTrigger)).injector.get(MatMenuTrigger);
            trigger.openMenu();
            fixture.detectChanges();
            const selector = action === 'reGenerateStatistics' ? '.regenerate-stat-item' : '.reimport-stat-item';
            const button = document.getElementById(trigger.menu!.panelId)!.querySelector<HTMLButtonElement>(selector)!;
            const closed = new Subject<boolean>();
            mockDialog.open.mockReturnValueOnce({ afterClosed: () => closed });

            const work = component[action]();
            (component as any).changeDetectorRef.markForCheck();
            fixture.detectChanges();
            TestBed.inject(ApplicationRef).tick();
            expect(button.disabled).toBe(true);
            closed.next(false);
            await work;
            await fixture.whenStable();

            expect(button.disabled).toBe(false);
            expect(mockEventReprocessService.regenerateEventStatistics).not.toHaveBeenCalled();
            expect(mockEventReprocessService.reimportEventFromOriginalFiles).not.toHaveBeenCalled();
            trigger.closeMenu();
        });

    it.each(['reGenerateStatistics', 'reImportActivityFromFile'] as const)(
        're-enables the rendered menu after %s fails', async action => {
            (component.event as any).originalFile = { path: 'source.fit' };
            fixture.autoDetectChanges();
            const trigger = fixture.debugElement.query(By.directive(MatMenuTrigger)).injector.get(MatMenuTrigger);
            trigger.openMenu();
            fixture.detectChanges();
            const selector = action === 'reGenerateStatistics' ? '.regenerate-stat-item' : '.reimport-stat-item';
            const button = document.getElementById(trigger.menu!.panelId)!.querySelector<HTMLButtonElement>(selector)!;
            let fail!: (reason: Error) => void;
            const reprocess = action === 'reGenerateStatistics' ? mockEventReprocessService.regenerateEventStatistics
                : mockEventReprocessService.reimportEventFromOriginalFiles;
            reprocess.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));

            const work = component[action]();
            await vi.waitFor(() => expect(reprocess).toHaveBeenCalledOnce());
            (component as any).changeDetectorRef.markForCheck();
            fixture.detectChanges();
            TestBed.inject(ApplicationRef).tick();
            expect(button.disabled).toBe(true);
            fail(new ReprocessError('PARSE_FAILED', 'Source parsing failed'));
            await work;
            await fixture.whenStable();

            expect(button.disabled).toBe(false);
            expect(mockProcessingService.failJob).toHaveBeenCalled();
            expect(mockHapticsService.error).toHaveBeenCalledOnce();
            trigger.closeMenu();
        });

    it('abandons GPX generation when its summary changes while loading details', async () => {
        const full = component.event;
        component.event = new AppEventSummary({ id: 'event-123', name: 'Run', startDate: 1000, endDate: 2000, stats: {} } as any);
        const loaded = new Subject<any>();
        mockEventService.getEventAndActivitiesOnce.mockReturnValue(loaded);
        const work = component.downloadGPX();
        component.event = full;
        loaded.next(full);
        await work;
        expect(mockEventService.getEventAsGPXBloB).not.toHaveBeenCalled();
        expect(mockFileService.downloadFile).not.toHaveBeenCalled();
        expect(mockHapticsService.error).not.toHaveBeenCalled();
    });

    it('does not start a GPX export if a complete event changes before the action resumes', async () => {
        const work = component.downloadGPX();
        component.user = { uid: 'other-owner' } as any;
        await work;
        expect(mockEventService.getEventAsGPXBloB).not.toHaveBeenCalled();
        expect(mockFileService.downloadFile).not.toHaveBeenCalled();
    });

    it('abandons summary GPX hydration after an auth switch before the input owner changes', async () => {
        const full = component.event;
        component.event = new AppEventSummary({ id: 'event-123', name: 'Run', startDate: 1000, endDate: 2000, stats: {} } as any);
        const loaded = new Subject<any>();
        mockEventService.getEventAndActivitiesOnce.mockReturnValue(loaded);
        const work = component.downloadGPX();
        (TestBed.inject(Auth) as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'new-account' };
        loaded.next(full);
        await work;
        expect(mockEventService.getEventAsGPXBloB).not.toHaveBeenCalled();
        expect(mockFileService.downloadFile).not.toHaveBeenCalled();
        expect(mockHapticsService.success).not.toHaveBeenCalled();
        expect(mockHapticsService.error).not.toHaveBeenCalled();
    });

    it('does not serve a GPX or use a new row filename after the export finishes for an old row', async () => {
        let finish!: (blob: Blob) => void;
        mockEventService.getEventAsGPXBloB.mockReturnValue(new Promise<Blob>(resolve => finish = resolve));
        const work = component.downloadGPX();
        await vi.waitFor(() => expect(mockEventService.getEventAsGPXBloB).toHaveBeenCalledOnce());
        component.event = { ...component.event, getID: () => 'other-event' } as any;
        finish(new Blob());
        await work;
        expect(mockFileService.downloadFile).not.toHaveBeenCalled();
        expect(mockHapticsService.success).not.toHaveBeenCalled();
        expect(mockHapticsService.error).not.toHaveBeenCalled();
    });

    it('opens an owned activity selection without starting provider delivery', async () => {
        component.user = { uid: 'test-user' } as any;
        component.event = { getID: () => 'owned-event' } as any;
        await component.sendToService();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/send-activities'], { queryParams: { source: 'saved' }, state: { activitySendSelection: ['owned-event'], activitySendOwner: 'test-user' } });
        expect(mockHapticsService.selection).toHaveBeenCalledOnce();
    });
    it('does not send a shared activity owned by another account', async () => {
        component.user = { uid: 'other-user' } as any;
        await component.sendToService();
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
    });
    it('opens ascent editing for the signed-in owner with the recording identity', async () => {
        component.user = { uid: 'test-user' } as any;
        mockDialog.open.mockReturnValueOnce({ afterClosed: () => of(false) });
        await component.editAscent();
        expect(mockDialog.open).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
            data: { eventId: 'event-123', user: component.user }, width: '480px',
        }));
        expect(mockHapticsService.selection).toHaveBeenCalledOnce();
    });
    it.each(['shared', 'benchmark', 'processing'])('does not open ascent editing for %s recordings', async kind => {
        component.user = { uid: kind === 'shared' ? 'other-user' : 'test-user' } as any;
        if (kind === 'benchmark') (component.event as any).mergeType = 'benchmark';
        if (kind === 'processing') component.isReprocessing = true;
        await component.editAscent();
        expect(mockDialog.open).not.toHaveBeenCalled();
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
    });
    it.each(['ascent', 'descent'])('applies committed %s without replacing hydrated activities or reading a cached snapshot', async metric => {
        const changed = vi.spyOn(component.ascentChanged, 'emit');
        component.user = { uid: 'test-user' } as any;
        const activity = { getID: () => 'hike', addStat: vi.fn(), removeStat: vi.fn() };
        Object.assign(component.event, { getActivities: () => [activity], addStat: vi.fn(), clearActivities: vi.fn(), addActivities: vi.fn() });
        mockEventService.getEventAndActivitiesOnce = vi.fn().mockReturnValue(of(component.event));
        const closed = new Subject<unknown>();
        mockDialog.open.mockReturnValueOnce({ afterClosed: () => closed });
        await component.editAscent();
        closed.next({ activityId: 'hike', metric, value: 75, eventValue: 275, correction: { value: 75, sourceValue: 100 } });
        await Promise.resolve();
        expect(mockEventService.getEventAndActivitiesOnce).not.toHaveBeenCalled();
        expect(component.event.clearActivities).not.toHaveBeenCalled();
        expect(component.event.getActivities()[0]).toBe(activity);
        expect(activity.addStat.mock.calls[0][0].getValue()).toBe(75);
        expect(activity).toHaveProperty(`${metric}Correction`, { value: 75, sourceValue: 100 });
        expect((component.event.addStat as any).mock.calls[0][0].getValue()).toBe(275);
        expect(changed).toHaveBeenCalledExactlyOnceWith(component.event);
    });
    it.each(['other', 'event-123'])('ignores an ascent result after the component receives another event instance: %s', async eventId => {
        const changed = vi.spyOn(component.ascentChanged, 'emit');
        component.user = { uid: 'test-user' } as any;
        const closed = new Subject<unknown>();
        mockDialog.open.mockReturnValueOnce({ afterClosed: () => closed });
        mockEventService.getEventAndActivitiesOnce = vi.fn().mockReturnValue(of(component.event));
        await component.editAscent();
        const nextEvent = { getID: () => eventId, clearActivities: vi.fn(), addActivities: vi.fn(), addStat: vi.fn() };
        component.event = nextEvent as any;
        closed.next({ activityId: 'hike', metric: 'ascent', value: 75, eventValue: 75, correction: null });
        await Promise.resolve();
        expect(nextEvent.clearActivities).not.toHaveBeenCalled();
        expect(nextEvent.addStat).not.toHaveBeenCalled();
        expect(mockEventService.getEventAndActivitiesOnce).not.toHaveBeenCalled();
        expect(changed).not.toHaveBeenCalled();
    });
    it('opens only one ascent editor when requested twice during lazy loading', async () => {
        component.user = { uid: 'test-user' } as any;
        mockDialog.open.mockReturnValueOnce({ afterClosed: () => new Subject() });
        await Promise.all([component.editAscent(), component.editAscent()]);
        expect(mockDialog.open).toHaveBeenCalledOnce();
        expect(mockHapticsService.selection).toHaveBeenCalledOnce();
    });
    it('does not open an ascent dialog if destroyed while its code is loading', async () => {
        component.user = { uid: 'test-user' } as any;
        const opening = component.editAscent();
        fixture.destroy();
        await opening;
        expect(mockDialog.open).not.toHaveBeenCalled();
    });
    it.each([true, false])('waits for accepted activity-send navigation before feedback: %s', async opened => {
        component.user = { uid: 'test-user' } as typeof component.user;
        let finishNavigation!: (result: boolean) => void;
        mockRouter.navigate.mockReturnValueOnce(new Promise<boolean>(resolve => { finishNavigation = resolve; }));
        const action = component.sendToService();
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
        finishNavigation(opened); await action;
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(Number(opened));
        expect(mockHapticsService.success).not.toHaveBeenCalled();
        expect(mockHapticsService.error).not.toHaveBeenCalled();
    });
    it('should create', () => {
        expect(component).toBeTruthy();
        expect(mockHapticsService.selection).not.toHaveBeenCalled();
        expect(mockHapticsService.success).not.toHaveBeenCalled();
        expect(mockHapticsService.error).not.toHaveBeenCalled();
    });

    it('provides selection feedback only when the actions menu can open', async () => {
        await component.menuOpen(undefined);
        expect(mockHapticsService.selection).toHaveBeenCalledOnce();

        component.isSharing = true;
        await component.menuOpen(undefined);
        expect(mockHapticsService.selection).toHaveBeenCalledOnce();
    });

    it('should stay on the current page after a table action deletes an event', async () => {
        component.navigateAfterDelete = false;
        const deleted = vi.fn();
        component.eventDeleted.subscribe(deleted);

        await component.delete();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockEventService.deleteAllEventData).toHaveBeenCalledWith(component.user, 'event-123');
        expect(deleted).toHaveBeenCalledWith('event-123');
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(mockSnackBar.open).toHaveBeenCalledWith('Activity deleted', undefined, { duration: 2000 });
        expect(mockHapticsService.success).toHaveBeenCalledOnce();
    });

    it('should leave a deleted event details route by default', async () => {
        await component.delete();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should return through browser history after deleting an event opened from another page', async () => {
        mockRouter.lastSuccessfulNavigation = { previousNavigation: { id: 1 } };

        await component.delete();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockLocation.back).toHaveBeenCalledOnce();
        expect(mockDayDetailsNavigation.markEventDeleted).toHaveBeenCalledWith('event-123');
        expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should enable sharing and copy the event link after confirmation', async () => {
        await component.shareEventLink();

        expect(mockDialog.open).toHaveBeenCalled();
        expect(mockEventSharingService.setEventSharing).toHaveBeenCalledWith(component.user, 'event-123', true);
        expect(mockEventSharingService.copyShareUrl).toHaveBeenCalledWith('event', 'test-uid', 'event-123');
        expect((component.event as any).privacy).toBe('public');
        expect(mockHapticsService.success).toHaveBeenCalledOnce();
    });

    it.each([
        { action: 'shareEventLink' as const, enabled: true, privacy: 'public' as const },
        { action: 'stopSharingEvent' as const, enabled: false, privacy: 'private' as const },
    ])('shows a visible loader and blocks repeated actions during $action', async ({ action, enabled, privacy }) => {
        let resolveSharing!: (response: SetEventSharingResponse) => void;
        const pendingSharing = new Promise<SetEventSharingResponse>(resolve => {
            resolveSharing = resolve;
        });
        let notifySharingStarted!: () => void;
        const sharingStarted = new Promise<void>(resolve => { notifySharingStarted = resolve; });
        mockEventSharingService.setEventSharing.mockImplementationOnce(() => {
            notifySharingStarted();
            return pendingSharing;
        });
        if (!enabled) {
            component.event.privacy = Privacy.Public;
        }
        const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
        expect(trigger.disabled).toBe(false);
        expect(trigger.querySelector('mat-spinner')).toBeNull();

        const sharing = component[action]();
        await sharingStarted;
        fixture.detectChanges();

        expect(mockEventSharingService.setEventSharing).toHaveBeenCalledWith(component.user, 'event-123', enabled);
        expect(component.isSharing).toBe(true);
        expect(trigger.disabled).toBe(true);
        expect(trigger.getAttribute('aria-busy')).toBe('true');
        expect(trigger.getAttribute('aria-label')).toBe('Updating sharing');
        expect(trigger.querySelector('mat-spinner')?.getAttribute('aria-label')).toBe('Updating sharing');
        expect(trigger.querySelector('mat-icon')).toBeNull();
        expect(mockHapticsService.success).not.toHaveBeenCalled();
        expect(mockHapticsService.error).not.toHaveBeenCalled();

        await component.shareEventLink();
        await component.stopSharingEvent();
        await component.copyPublicEventLink();
        expect(mockEventSharingService.setEventSharing).toHaveBeenCalledOnce();
        expect(mockDialog.open).toHaveBeenCalledOnce();
        expect(mockEventSharingService.copyShareUrl).not.toHaveBeenCalled();

        resolveSharing({ eventID: 'event-123', privacy, publicEventUrl: '', publicComparisonUrl: '' });
        await sharing;
        fixture.detectChanges();

        expect(component.isSharing).toBe(false);
        expect(trigger.disabled).toBe(false);
        expect(trigger.getAttribute('aria-busy')).toBe('false');
        expect(trigger.querySelector('mat-spinner')).toBeNull();
        expect(trigger.querySelector('mat-icon')?.textContent).toContain('more_vert');
        expect(mockHapticsService.success).toHaveBeenCalledOnce();
    });

    it('clears the loading state after a sharing failure and allows retry', async () => {
        mockEventSharingService.setEventSharing.mockRejectedValueOnce(new Error('Sharing failed'));

        await component.shareEventLink();
        fixture.detectChanges();

        const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
        expect(component.isSharing).toBe(false);
        expect(trigger.disabled).toBe(false);
        expect(trigger.querySelector('mat-spinner')).toBeNull();
        expect(component.event.privacy).toBe('private');
        expect(mockEventSharingService.copyShareUrl).not.toHaveBeenCalled();
        expect(mockSnackBar.open).toHaveBeenCalledWith('Could not update sharing', undefined, { duration: 3500 });
        expect(mockHapticsService.error).toHaveBeenCalledOnce();
        expect(mockHapticsService.success).not.toHaveBeenCalled();

        await component.shareEventLink();
        expect(mockEventSharingService.setEventSharing).toHaveBeenCalledTimes(2);
        expect(mockHapticsService.success).toHaveBeenCalledOnce();
    });

    it('should not enable sharing when the public-share confirmation is cancelled', async () => {
        mockDialog.open.mockReturnValueOnce({
            afterClosed: () => of(false),
        });

        await component.shareEventLink();

        expect(mockDialog.open).toHaveBeenCalledWith(ConfirmationDialogComponent, expect.objectContaining({
            data: expect.objectContaining({
                title: 'Share activity publicly?',
                message: expect.stringContaining('view this activity and its source files'),
            }),
        }));
        expect(mockEventSharingService.setEventSharing).not.toHaveBeenCalled();
        expect(mockEventSharingService.copyShareUrl).not.toHaveBeenCalled();
        expect((component.event as any).privacy).toBe('private');
        expect(component.isSharing).toBe(false);
        expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
        expect(mockHapticsService.success).not.toHaveBeenCalled();
        expect(mockHapticsService.error).not.toHaveBeenCalled();
    });

    it('should copy an existing public event link without calling the backend', async () => {
        (component.event as any).privacy = 'public';

        await component.copyPublicEventLink();

        expect(mockEventSharingService.setEventSharing).not.toHaveBeenCalled();
        expect(mockEventSharingService.copyShareUrl).toHaveBeenCalledWith('event', 'test-uid', 'event-123');
        expect(mockHapticsService.success).toHaveBeenCalledOnce();
    });

    it('should disable sharing after confirmation', async () => {
        (component.event as any).privacy = 'public';
        mockEventSharingService.setEventSharing.mockResolvedValueOnce({
            eventID: 'event-123',
            privacy: 'private',
            publicEventUrl: '/share/event/test-uid/event-123',
            publicComparisonUrl: '/share/comparison/test-uid/event-123',
        });

        await component.stopSharingEvent();

        expect(mockEventSharingService.setEventSharing).toHaveBeenCalledWith(component.user, 'event-123', false);
        expect((component.event as any).privacy).toBe('private');
    });

    describe('downloadOriginals', () => {
        it('should download a single file if originalFile is present', async () => {
            const mockArrayBuffer = new ArrayBuffer(10);
            mockEventService.downloadOriginalFile.mockResolvedValue(mockArrayBuffer);
            (component.event as any).originalFile = { path: 'path/to/file.fit' };

            await component.downloadOriginals();

            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledWith('path/to/file.fit');
            expect(mockFileService.downloadNamedFile).toHaveBeenCalledWith(
                expect.any(Blob),
                'file.fit',
                'fit',
            );
        });

        it('should download a zip if originalFiles (multiple) are present', async () => {
            const mockArrayBuffer = new ArrayBuffer(10);
            mockEventService.downloadOriginalFile.mockResolvedValue(mockArrayBuffer);
            (component.event as any).originalFiles = [
                { path: 'path/to/file1.fit' },
                { path: 'path/to/file2.fit' }
            ];

            await component.downloadOriginals();

            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledTimes(2);
            expect(mockFileService.downloadAsZip).toHaveBeenCalled();
            const args = mockFileService.downloadAsZip.mock.calls[0];
            expect(args[0]).toHaveLength(2); // 2 files
            expect(args[0]).toEqual([
                expect.objectContaining({ fileName: 'file1.fit' }),
                expect.objectContaining({ fileName: 'file2.fit' }),
            ]);
            expect(args[1]).toContain('.zip');
        });

        it('should download a single file directly if originalFiles has exactly 1 item', async () => {
            const mockArrayBuffer = new ArrayBuffer(10);
            mockEventService.downloadOriginalFile.mockResolvedValue(mockArrayBuffer);
            (component.event as any).originalFiles = [
                { path: 'path/to/single.fit' }
            ];

            await component.downloadOriginals();

            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledWith('path/to/single.fit');
            expect(mockFileService.downloadNamedFile).toHaveBeenCalledWith(
                expect.any(Blob),
                'single.fit',
                'fit',
            );
            expect(mockFileService.downloadAsZip).not.toHaveBeenCalled();
        });

        it('should preserve gzipped original filenames for direct downloads', async () => {
            const mockArrayBuffer = new ArrayBuffer(10);
            mockEventService.downloadOriginalFile.mockResolvedValue(mockArrayBuffer);
            (component.event as any).originalFiles = [
                { path: 'path/to/original.fit.gz', originalFilename: 'watch-record.fit.gz' }
            ];

            await component.downloadOriginals();

            expect(mockEventService.downloadOriginalFile).toHaveBeenCalledWith('path/to/original.fit.gz');
            expect(mockFileService.downloadNamedFile).toHaveBeenCalledWith(
                expect.any(Blob),
                'watch-record.fit.gz',
                'fit',
            );
        });

        it('should show snackbar if no files', async () => {
            (component.event as any).originalFile = undefined;
            (component.event as any).originalFiles = undefined;

            await component.downloadOriginals();

            expect(mockSnackBar.open).toHaveBeenCalledWith('No original files found.', undefined, { duration: 3000 });
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
            expect(component.isReprocessing).toBe(false);
        });

        it('should prevent concurrent regenerate requests while one is in progress', async () => {
            let resolveRegenerate: ((value: unknown) => void) | undefined;
            mockEventReprocessService.regenerateEventStatistics.mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveRegenerate = resolve;
                }),
            );

            const firstCall = component.reGenerateStatistics();
            await Promise.resolve();
            await Promise.resolve();

            await component.reGenerateStatistics();
            await vi.waitFor(() => expect(mockEventReprocessService.regenerateEventStatistics).toHaveBeenCalledTimes(1));

            expect(mockEventReprocessService.regenerateEventStatistics).toHaveBeenCalledTimes(1);
            expect(component.isReprocessing).toBe(true);

            resolveRegenerate?.({ event: null });
            await firstCall;
            expect(component.isReprocessing).toBe(false);
        });

        it('shows the retained-route explanation without a successful reprocessing notification', async () => {
            const message = 'Reprocessing skipped: the original is a route. The saved activity has been kept.';
            mockEventReprocessService.regenerateEventStatistics.mockRejectedValueOnce(new ReprocessError('NON_ACTIVITY_SOURCE', message));
            await component.reGenerateStatistics();
            expect(mockProcessingService.failJob).toHaveBeenCalled();
            expect(mockSnackBar.open).toHaveBeenCalledWith(message, undefined, { duration: 4000 });
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
            expect(component.isReprocessing).toBe(false);
        });

        it('should not call reimport when original file metadata is missing', async () => {
            (component.event as any).originalFile = undefined;
            (component.event as any).originalFiles = undefined;

            await component.reImportActivityFromFile();

            expect(mockEventReprocessService.reimportEventFromOriginalFiles).not.toHaveBeenCalled();
        });

        it('should prevent concurrent reimport requests while one is in progress', async () => {
            (component.event as any).originalFile = { path: 'path/to/file.fit' };
            let resolveReimport: ((value: unknown) => void) | undefined;
            mockEventReprocessService.reimportEventFromOriginalFiles.mockReturnValueOnce(
                new Promise((resolve) => {
                    resolveReimport = resolve;
                }),
            );

            const firstCall = component.reImportActivityFromFile();
            await Promise.resolve();
            await Promise.resolve();

            await component.reImportActivityFromFile();
            await vi.waitFor(() => expect(mockEventReprocessService.reimportEventFromOriginalFiles).toHaveBeenCalledTimes(1));

            expect(mockEventReprocessService.reimportEventFromOriginalFiles).toHaveBeenCalledTimes(1);
            expect(component.isReprocessing).toBe(true);

            resolveReimport?.({ event: null });
            await firstCall;
            expect(component.isReprocessing).toBe(false);
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
