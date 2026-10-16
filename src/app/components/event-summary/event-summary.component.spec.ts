import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventSummaryComponent } from './event-summary.component';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { ChangeDetectorRef, Component, NO_ERRORS_SCHEMA, SimpleChange } from '@angular/core';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    ActivityTypes,
    DataDistance,
    DataDuration,
    DataFeeling,
    DataRPE,
    DataPaceAvg,
    DataSpeedAvg,
    DataSwimDistance,
    DistanceUnits,
    DynamicDataLoader,
    EventInterface,
    Feelings,
    Privacy,
    SwimPaceUnits,
    User
} from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';
import { EventTagService } from '../../services/event-tag.service';
import { EventDetailsSummaryBottomSheetComponent } from './event-details-summary-bottom-sheet/event-details-summary-bottom-sheet.component';
import { EventTagsDialogComponent } from '../event-tags/event-tags-dialog.component';
import { TrainingLoadDialogComponent } from '../training-load/training-load-dialog.component';
import { AppHapticsService } from '../../services/app.haptics.service';
import { from, of, Subject } from 'rxjs';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';

@Component({
    standalone: false,
    template: `<app-event-summary [event]="event" [user]="user" [unitSettings]="{}" [isOwner]="true">
        <div after-summary data-testid="impact">Training impact strip</div>
        <div after-stats data-testid="analysis">Activity analysis</div>
    </app-event-summary>`,
})
class SummaryProjectionHost {
    event!: EventInterface;
    user!: User;
}

describe('EventSummaryComponent', () => {
    let component: EventSummaryComponent;
    let fixture: ComponentFixture<EventSummaryComponent>;
    let mockBottomSheet: any;
    let mockBenchmarkFlowService: any;
    let mockDialog: any;
    let mockEventTagService: any;
    let mockHaptics: { selection: ReturnType<typeof vi.fn> };

    const mockUser: User = {
        uid: 'test-user-id',
    } as any;

    const mockEvent = {
        getID: () => 'test-event-id',
        privacy: Privacy.Private,
        getActivities: () => [{ type: ActivityTypes.Running }],
        getStat: (_type: string) => null,
        startDate: new Date(),
    } as unknown as EventInterface;

    beforeEach(async () => {
        mockBottomSheet = {
            open: vi.fn().mockReturnValue({ afterDismissed: () => of(false) }),
        };

        mockBenchmarkFlowService = {
            openBenchmarkEntry: vi.fn().mockResolvedValue(undefined),
            openBenchmarkSelectionDialog: vi.fn(),
            generateAndOpenReport: vi.fn().mockResolvedValue(undefined),
            openBenchmarkReport: vi.fn(),
        };
        mockDialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(null) }) };
        mockHaptics = { selection: vi.fn() };
        mockEventTagService = {
            getTags: vi.fn((event: any) => event.tags || event.benchmarkReviewTags || []),
            saveTags: vi.fn(async (_user: unknown, event: any, tags: string[]) => {
                event.tags = tags;
                return tags;
            }),
        };

        await TestBed.configureTestingModule({
            imports: [MatButtonModule, MatChipsModule],
            declarations: [
                EventSummaryComponent,
                SummaryProjectionHost,
            ],
            providers: [
                { provide: MatBottomSheet, useValue: mockBottomSheet },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
                { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
                { provide: AppBenchmarkFlowService, useValue: mockBenchmarkFlowService },
                { provide: MatDialog, useValue: mockDialog },
                { provide: EventTagService, useValue: mockEventTagService },
                { provide: AppHapticsService, useValue: mockHaptics },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(EventSummaryComponent);
        component = fixture.componentInstance;
        component.event = mockEvent;
        component.user = mockUser;
        component.unitSettings = {} as any;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
    it.each([
        { value: 0, settings: {} },
        { value: 0.5, settings: { distanceUnits: [DistanceUnits.Miles] } },
        { value: 2.5, settings: {} },
    ])('shows saved RPE $value with canonical display after feedback editing', ({ value, settings }) => {
        const next = TestBed.createComponent(EventSummaryComponent);
        next.componentInstance.event = { ...mockEvent, getStat: (type: string) => type === DataRPE.type ? new DataRPE(value) : null } as never;
        next.componentInstance.user = mockUser; next.componentInstance.unitSettings = settings as never;
        next.detectChanges();
        expect(next.nativeElement.querySelector('.rpe-chip')?.textContent)
            .toContain(resolveUnitAwareDisplayFromValue(DataRPE.type, value, settings as never)?.text);
    });

    it.each([
        { isMerge: true },
        { mergeType: 'benchmark' },
        { mergeType: ' Benchmark ', isMerge: false },
    ])('hides and guards Training load for comparison records %j', classification => {
        fixture.componentRef.setInput('event', { ...mockEvent, ...classification });
        fixture.componentRef.setInput('isOwner', true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[aria-label="Edit Training load"]')).toBeNull();
        component.openTrainingLoad();
        expect(mockDialog.open).not.toHaveBeenCalled();
        expect(mockHaptics.selection).not.toHaveBeenCalled();
    });

    it.each([{}, { isMerge: true, mergeType: 'multi' }])('opens Training load for an owned eligible workout %j', classification => {
        fixture.componentRef.setInput('event', { ...mockEvent, ...classification });
        fixture.componentRef.setInput('isOwner', true);
        fixture.detectChanges();
        const button = fixture.nativeElement.querySelector('[aria-label="Edit Training load"]') as HTMLButtonElement;
        expect(button).toBeTruthy();
        button.click();
        expect(mockDialog.open).toHaveBeenCalledWith(TrainingLoadDialogComponent, expect.objectContaining({
            data: { event: component.event, user: mockUser, unitSettings: component.unitSettings },
        }));
        expect(mockHaptics.selection).toHaveBeenCalledOnce();
    });

    it('does not show or open Training load for another viewer', () => {
        expect(fixture.nativeElement.querySelector('[aria-label="Edit Training load"]')).toBeNull();
        component.openTrainingLoad();
        expect(mockDialog.open).not.toHaveBeenCalled();
        expect(mockHaptics.selection).not.toHaveBeenCalled();
    });

    it('places the impact below the primary summary and before tags, devices, and further statistics', () => {
        const host = TestBed.createComponent(SummaryProjectionHost);
        host.componentInstance.event = mockEvent;
        host.componentInstance.user = mockUser;
        host.detectChanges();
        const element = host.nativeElement as HTMLElement;
        const extension = element.querySelector('.summary-primary-extension')!;
        expect(extension.previousElementSibling?.tagName).toBe('APP-SUMMARY-PRIMARY-INFO');
        expect(extension.querySelector('[data-testid="impact"]')?.textContent).toContain('Training impact strip');
        expect(extension.nextElementSibling?.className).toBe('event-metadata-row');
        expect(element.querySelector('.summary-stats-area [data-testid="analysis"]')).toBeTruthy();
        expect(element.querySelector('.summary-stats-area [data-testid="impact"]')).toBeNull();
    });

    it('does not show a supported activity types shortcut in event details', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/event-summary/event-summary.component.html'),
            'utf8'
        );

        expect(template).not.toContain('routerLink="/features/supported-activities"');
        expect(template).not.toContain('Supported activity types');
        expect(template).not.toContain('<mat-icon>category</mat-icon>');
    });

    it('keeps the event detail summary out of an outer glass card surface', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/event-summary/event-summary.component.html'),
            'utf8'
        );
        const styles = readFileSync(
            resolve(process.cwd(), 'src/app/components/event-summary/event-summary.component.scss'),
            'utf8'
        );

        expect(template).toContain('class="event-summary-content"');
        expect(template).not.toContain('qs-glass-card-panel');
        expect(styles).toContain('--summary-primary-info-padding-top: 0;');
    });

    it('renders event tags read-only for public viewers', () => {
        fixture.componentRef.setInput('event', { ...mockEvent, tags: ['Race', '2026'] } as any);
        fixture.componentRef.setInput('isOwner', false);
        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.event-tags-banner') as HTMLElement;
        const chipSet = banner?.querySelector('mat-chip-set');
        expect(banner?.textContent).toContain('Race');
        expect(banner?.textContent).toContain('2026');
        expect(banner?.querySelector('button')).toBeNull();
        expect(chipSet?.getAttribute('aria-label')).toBe('Activity tags');
        expect(chipSet?.hasAttribute('aria-hidden')).toBe(false);
    });

    it('keeps decorative owner tag chips out of the labelled edit button accessibility tree', () => {
        fixture.componentRef.setInput('event', { ...mockEvent, tags: ['Race'] } as any);
        fixture.componentRef.setInput('isOwner', true);
        fixture.detectChanges();

        const button = fixture.nativeElement.querySelector('.event-tags-button') as HTMLButtonElement;
        const chipSet = button?.querySelector('mat-chip-set');
        expect(button?.getAttribute('aria-label')).toBe('Edit activity tags');
        expect(chipSet?.getAttribute('aria-hidden')).toBe('true');
    });

    it('places Add tags alongside the device and uses the shared editor once', () => {
        fixture.componentRef.setInput('event', { ...mockEvent, getDeviceNamesAsString: () => 'Suunto' } as any);
        fixture.componentRef.setInput('isOwner', true);
        fixture.detectChanges();

        const row = fixture.nativeElement.querySelector('.event-metadata-row') as HTMLElement;
        const button = row.querySelector('.event-tags-button') as HTMLButtonElement;
        expect(row.querySelector('.device-info-banner')?.textContent).toContain('Suunto');
        expect(button.getAttribute('aria-label')).toBe('Add activity tags');
        expect(button.textContent).toContain('Add tags');
        expect(row.querySelector('mat-chip-set')).toBeNull();
        expect(mockHaptics.selection).not.toHaveBeenCalled();

        button.click();

        expect(mockDialog.open).toHaveBeenCalledTimes(1);
        expect(mockHaptics.selection).toHaveBeenCalledTimes(1);
    });

    it('keeps Add tags available without device metadata and removes the action when tags exist', () => {
        fixture.componentRef.setInput('event', { ...mockEvent, tags: [] } as any);
        fixture.componentRef.setInput('isOwner', true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.device-info-banner')).toBeNull();
        expect(fixture.nativeElement.querySelector('.event-tags-button')?.textContent).toContain('Add tags');

        fixture.componentRef.setInput('event', { ...mockEvent, tags: ['Race'] } as any);
        fixture.detectChanges();
        const row = fixture.nativeElement.querySelector('.event-metadata-row') as HTMLElement;
        expect(row.textContent).toContain('Race');
        expect(row.textContent).not.toContain('Add tags');
        expect(row.querySelectorAll('.event-tags-button')).toHaveLength(1);
    });

    it('hides the empty metadata row from public viewers', () => {
        fixture.componentRef.setInput('event', { ...mockEvent, tags: [] } as any);
        fixture.componentRef.setInput('isOwner', false);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.event-metadata-row')).toBeNull();
        expect(mockHaptics.selection).not.toHaveBeenCalled();
    });

    describe('open... methods', () => {
        it('openEditDetails should open bottom sheet', () => {
            component.isOwner = true;
            component.openEditDetails();
            expect(mockBottomSheet.open).toHaveBeenCalled();
        });
        it('refreshes workout RPE after the combined form commits and ignores dismissal after teardown', () => {
            const dismissed = new Subject<boolean>();
            let stat = new DataRPE(5);
            mockBottomSheet.open.mockReturnValue({ afterDismissed: () => dismissed });
            component.event = { ...mockEvent, getStat: (type: string) => type === DataRPE.type ? stat : null } as never;
            component.isOwner = true; component.openEditDetails();
            expect(component.rpe).toBe(5);
            stat = new DataRPE(0); dismissed.next(true);
            expect(component.rpe).toBe(0);
            component.openEditDetails(); fixture.destroy();
            stat = new DataRPE(7); dismissed.next(true);
            expect(component.rpe).toBe(0);
        });

        it('openDetailedStats should open bottom sheet', () => {
            component.openDetailedStats();
            expect(mockBottomSheet.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                data: expect.objectContaining({
                    event: component.event,
                    user: null,
                    selectedActivities: component.selectedActivities,
                    userUnitSettings: component.unitSettings,
                }),
            }));
        });

        it('openDetailedStats should pass the user only for owners', () => {
            component.isOwner = true;

            component.openDetailedStats();

            expect(mockBottomSheet.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                data: expect.objectContaining({
                    user: component.user,
                }),
            }));
        });

        // openDevices requires data mocking for checks, but basic call check:
        it('openDevices should open bottom sheet', () => {
            component.openDevices();
            expect(mockBottomSheet.open).toHaveBeenCalled();
        });

        it('openBenchmark should delegate to the shared benchmark entry flow', async () => {
            await component.openBenchmark();

            expect(mockBenchmarkFlowService.openBenchmarkEntry).toHaveBeenCalledWith(expect.objectContaining({
                event: component.event,
                user: component.user,
                initialSelection: component.selectedActivities,
            }));
        });

        it('refreshes cached details tags when the benchmark sheet saves them in place', async () => {
            (component.event as any).tags = ['Original'];
            fixture.detectChanges();

            await component.openBenchmark();
            const benchmarkConfig = mockBenchmarkFlowService.openBenchmarkEntry.mock.calls[0][0];
            benchmarkConfig.onEventTagsSaved(['Updated']);

            expect((component.event as any).tags).toEqual(['Updated']);
            expect(component.eventTags).toEqual(['Updated']);
        });

        it('opens the shared tag editor for owners and applies saved tags', async () => {
            component.isOwner = true;
            mockDialog.open.mockImplementation((_component: unknown, config: any) => {
                const saved = config.data.save(['Race', '2026']);
                return { afterClosed: () => from(saved) };
            });

            await component.openTags();

            expect(mockDialog.open).toHaveBeenCalledWith(EventTagsDialogComponent, expect.objectContaining({
                data: expect.objectContaining({ title: 'Activity tags' }),
            }));
            expect((component.event as any).tags).toEqual(['Race', '2026']);
        });

        it('does not overwrite a newer same-event refresh after the tag save completes', async () => {
            component.isOwner = true;
            const originalEvent = { ...mockEvent, getID: () => 'event-a', tags: ['Original'] } as any;
            const refreshedEvent = { ...mockEvent, getID: () => 'event-a', tags: ['Concurrent'] } as any;
            component.event = originalEvent;
            fixture.detectChanges();

            const closed = new Subject<string[] | null>();
            let dialogData: any;
            mockDialog.open.mockImplementation((_component: unknown, config: any) => {
                dialogData = config.data;
                return { afterClosed: () => closed.asObservable() };
            });

            const openPromise = component.openTags();
            const savedTags = await dialogData.save(['Updated']);
            component.event = refreshedEvent;
            fixture.detectChanges();
            closed.next(savedTags);
            closed.complete();
            await openPromise;

            expect(originalEvent.tags).toEqual(['Updated']);
            expect(refreshedEvent.tags).toEqual(['Concurrent']);
            expect(component.eventTags).toEqual(['Concurrent']);
        });

        it('keeps an open tag dialog pinned to the event that opened it', async () => {
            component.isOwner = true;
            const originalEvent = { ...mockEvent, getID: () => 'event-a', tags: ['Original'] } as any;
            const replacementEvent = {
                ...mockEvent,
                getID: () => 'event-b',
                tags: ['Replacement'],
                benchmarkReviewTags: ['Replacement legacy'],
            } as any;
            component.event = originalEvent;
            fixture.detectChanges();

            const closed = new Subject<string[] | null>();
            let dialogData: any;
            mockDialog.open.mockImplementation((_component: unknown, config: any) => {
                dialogData = config.data;
                return { afterClosed: () => closed.asObservable() };
            });

            const openPromise = component.openTags();
            component.event = replacementEvent;
            fixture.detectChanges();
            const savedTags = await dialogData.save(['Updated']);
            closed.next(savedTags);
            closed.complete();
            await openPromise;

            expect(mockEventTagService.saveTags).toHaveBeenCalledWith(
                mockUser,
                originalEvent,
                ['Updated'],
                ['Original'],
            );
            expect(originalEvent.tags).toEqual(['Updated']);
            expect(replacementEvent.tags).toEqual(['Replacement']);
            expect(replacementEvent.benchmarkReviewTags).toEqual(['Replacement legacy']);
        });

        it('does not open tag editing for public viewers', async () => {
            component.isOwner = false;

            await component.openTags();

            expect(mockDialog.open).not.toHaveBeenCalled();
            expect(mockHaptics.selection).not.toHaveBeenCalled();
        });

        it('does not give tag feedback for a missing user or unsaved activity', async () => {
            component.isOwner = true;
            component.user = null as unknown as User;
            await component.openTags();
            component.user = mockUser;
            component.event = { ...mockEvent, getID: () => '' } as any;
            await component.openTags();

            expect(mockDialog.open).not.toHaveBeenCalled();
            expect(mockHaptics.selection).not.toHaveBeenCalled();
        });
    });

    it('offers one combined editor only for a saved owner recording with one accepted-action haptic', () => {
        component.isOwner = false; component.openEditDetails();
        expect(mockBottomSheet.open).not.toHaveBeenCalled(); expect(mockHaptics.selection).not.toHaveBeenCalled();
        component.isOwner = true;
        component.event = { ...mockEvent, getID: () => '' } as any;
        component.openEditDetails(); expect(mockBottomSheet.open).not.toHaveBeenCalled();
        component.event = mockEvent; component.openEditDetails();
        expect(mockBottomSheet.open).toHaveBeenCalledWith(EventDetailsSummaryBottomSheetComponent, expect.objectContaining({
            data: { event: mockEvent, user: mockUser },
        }));
        fixture.componentRef.setInput('isOwner', true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('[aria-label="Edit details"]')).toHaveLength(1);
        expect(fixture.nativeElement.querySelector('[aria-label="Post-workout reflection"]')).toBeNull();
        expect(mockDialog.open).not.toHaveBeenCalled();
        expect(mockHaptics.selection).toHaveBeenCalledOnce();
    });

    describe('Getters', () => {
        it('mainActivityType should return activity type', () => {
            expect(component.mainActivityType).toBe(ActivityTypes.Running);
        });

        it('getHeroStats should return specific stats for Running', () => {
            const stats = component.getHeroStats();
            expect(stats).toEqual([DataDuration.type, DataDistance.type, DataPaceAvg.type]);
        });

        it('getHeroStats should use pace family for Trail Running', () => {
            component.event = {
                ...mockEvent,
                getActivities: () => [{ type: ActivityTypes.TrailRunning }],
            } as any;

            fixture.detectChanges();
            expect(component.getHeroStats()).toEqual([DataDuration.type, DataDistance.type, DataPaceAvg.type]);
        });

        it('getHeroStats should use speed family for Cycling', () => {
            component.event = {
                ...mockEvent,
                getActivities: () => [{ type: ActivityTypes.Cycling }],
            } as any;

            fixture.detectChanges();
            expect(component.getHeroStats()).toEqual([DataDuration.type, DataDistance.type, DataSpeedAvg.type]);
        });

        it('should resolve hero stat value from unit-aware DynamicDataLoader output', () => {
            const basePaceStat = {
                getType: () => DataPaceAvg.type,
                getDisplayValue: () => 'base-pace',
                getDisplayUnit: () => 'base-unit'
            } as any;

            const dynamicSpy = vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance')
                .mockReturnValue([{
                    getType: () => DataPaceAvg.type,
                    getDisplayValue: () => '5:05',
                    getDisplayUnit: () => 'min/km'
                }] as any);

            component.event = {
                ...mockEvent,
                getActivities: () => [{ type: ActivityTypes.Running }],
                getStat: (type: string) => {
                    if (type === DataPaceAvg.type) {
                        return basePaceStat;
                    }
                    return null;
                }
            } as any;

            fixture.detectChanges();

            expect(component.getStatValue(DataPaceAvg.type)).toBe('5:05');
            expect(component.getStatUnit(DataPaceAvg.type)).toBe('min/km');
            expect(dynamicSpy).toHaveBeenCalled();
            dynamicSpy.mockRestore();
        });

        it('shows swimming hero and summary distances in yards when selected', () => {
            component.unitSettings = { swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] } as any;
            component.event = {
                ...mockEvent,
                getActivities: () => [{ type: ActivityTypes.Swimming }],
                getStat: (type: string) => type === DataDistance.type ? new DataDistance(91.44) : null,
            } as any;
            fixture.detectChanges();
            expect(component.getStatValue(DataDistance.type)).toBe('100');
            expect(component.getStatUnit(DataDistance.type)).toBe('yd');
            expect(component.heroSummaryMetrics[1]).toEqual({ value: '100', label: 'yd' });
        });

        it('refreshes cached swim distance when only the unit preference changes', () => {
            component.unitSettings = { swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter] } as any;
            component.event = {
                ...mockEvent,
                getActivities: () => [{ type: ActivityTypes.Swimming }],
                getStat: (type: string) => type === DataDistance.type ? new DataDistance(91.44) : null,
            } as any;
            fixture.detectChanges();
            expect(component.getStatUnit(DataDistance.type)).toBe('m');

            const meters = component.unitSettings;
            component.unitSettings = { swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] } as any;
            component.ngOnChanges({ unitSettings: new SimpleChange(meters, component.unitSettings, false) });

            expect(component.getStatValue(DataDistance.type)).toBe('100');
            expect(component.getStatUnit(DataDistance.type)).toBe('yd');
            expect(component.heroSummaryMetrics[1]).toEqual({ value: '100', label: 'yd' });
        });

        it('keeps mixed-sport event totals in general units even when the first or selected activity is swimming', () => {
            const activities = [{ type: ActivityTypes.Swimming }, { type: ActivityTypes.Running }];
            component.unitSettings = {
                distanceUnits: DistanceUnits.Miles,
                swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
            } as any;
            component.event = {
                ...mockEvent,
                getActivities: () => activities,
                getStat: (type: string) => type === DataDistance.type ? new DataDistance(1609.344) : null,
            } as any;
            component.selectedActivities = [activities[0]] as any;
            fixture.detectChanges();

            expect(component.getStatValue(DataDistance.type)).toBe('1.00');
            expect(component.getStatUnit(DataDistance.type)).toBe('mi');
            expect(component.heroSummaryMetrics[1]).toEqual({ value: '1.00', label: 'mi' });
        });

        it('should keep swimming summary distance in meters with miles distance preference', () => {
            component.unitSettings = { distanceUnits: DistanceUnits.Miles } as any;
            component.event = {
                ...mockEvent,
                getActivities: () => [{ type: ActivityTypes.Swimming }],
                getStat: (type: string) => {
                    if (type === DataDistance.type) {
                        return new DataDistance(1500);
                    }
                    return null;
                },
            } as any;

            fixture.detectChanges();

            const expectedDistance = new DataSwimDistance(1500);
            expect(component.getStatValue(DataDistance.type)).toBe(`${expectedDistance.getDisplayValue()}`);
            expect(component.getStatUnit(DataDistance.type)).toBe('m');
            expect(component.heroSummaryMetrics[1]).toEqual({ value: `${expectedDistance.getDisplayValue()}`, label: 'm' });
        });

        it('should expose single selected device name in the summary chip', () => {
            component.selectedActivities = [
                {
                    creator: {
                        name: 'Garmin Edge 540',
                        swInfo: '21.19',
                        devices: [],
                    },
                } as any,
            ];

            fixture.detectChanges();

            expect(component.showDeviceChip).toBe(true);
            expect(component.deviceChipLabel).toBe('Garmin Edge 540 21.19');
            expect(component.deviceChipTooltip).toBe('Garmin Edge 540 21.19');
        });

        it('should collapse multiple selected device names into a count chip with tooltip list', () => {
            component.selectedActivities = [
                {
                    creator: {
                        name: 'Garmin Edge 540',
                        swInfo: '',
                        devices: [],
                    },
                } as any,
                {
                    creator: {
                        name: 'Wahoo ELEMNT',
                        swInfo: '',
                        devices: [],
                    },
                } as any,
                {
                    creator: {
                        name: 'Garmin Edge 540',
                        swInfo: '',
                        devices: [],
                    },
                } as any,
            ];

            fixture.detectChanges();

            expect(component.showDeviceChip).toBe(true);
            expect(component.deviceChipLabel).toBe('2 devices');
            expect(component.deviceChipTooltip).toContain('Garmin Edge 540');
            expect(component.deviceChipTooltip).toContain('Wahoo ELEMNT');
        });

        it('should resolve fallback device name from device details when creator name is missing', () => {
            component.selectedActivities = [
                {
                    creator: {
                        name: '',
                        swInfo: '',
                        devices: [{ type: 'bike_power' }],
                    },
                } as any,
            ];

            fixture.detectChanges();

            expect(component.showDeviceChip).toBe(true);
            expect(component.hasDevices).toBe(true);
            expect(component.deviceChipLabel).toBe('Bike Power');
            expect(component.deviceChipTooltip).toBe('Bike Power');
        });

        it('should prefer event device names string like dashboard table', () => {
            component.event = {
                ...mockEvent,
                getDeviceNamesAsString: () => 'Garmin Edge 540, HRM Pro',
            } as any;
            component.selectedActivities = [
                {
                    creator: {
                        name: 'Fallback Device',
                        swInfo: '',
                        devices: [],
                    },
                } as any,
            ];

            fixture.detectChanges();

            expect(component.showDeviceChip).toBe(true);
            expect(component.deviceChipLabel).toBe('Garmin Edge 540, HRM Pro');
            expect(component.deviceChipTooltip).toBe('Garmin Edge 540, HRM Pro');
        });
    });

    describe('summary actions placement', () => {
        it('should render show more action in summary actions area outside the stats grid component', () => {
            const outsideAction = fixture.nativeElement.querySelector('.event-summary-actions .show-more-button');
            const insideGridAction = fixture.nativeElement.querySelector('app-event-card-stats-grid .show-more-button');

            expect(outsideAction).toBeTruthy();
            expect(insideGridAction).toBeFalsy();
        });

        it('should render sensors action in summary actions area when devices exist', () => {
            const devicesFixture = TestBed.createComponent(EventSummaryComponent);
            const devicesComponent = devicesFixture.componentInstance;

            devicesComponent.event = mockEvent;
            devicesComponent.user = mockUser;
            devicesComponent.selectedActivities = [
                {
                    creator: {
                        devices: [{ name: 'HRM' }]
                    }
                } as any
            ];

            devicesFixture.detectChanges();

            const sensorsAction = devicesFixture.nativeElement.querySelector('.event-summary-actions .devices-button');
            expect(devicesComponent.hasDevices).toBe(true);
            expect(sensorsAction).toBeTruthy();
        });

        it('should expose clickable device-chip state when device details exist', () => {
            component.selectedActivities = [
                {
                    creator: {
                        name: 'Garmin Edge 540',
                        swInfo: '',
                        devices: [{ name: 'HRM Pro' }],
                    },
                } as any,
            ];

            fixture.detectChanges();

            expect(component.showDeviceChip).toBe(true);
            expect(component.hasDevices).toBe(true);
            expect(component.deviceChipLabel).toBe('Garmin Edge 540');
        });

        it('should expose non-clickable device-chip state when only creator name is available', () => {
            component.selectedActivities = [
                {
                    creator: {
                        name: 'Garmin Edge 540',
                        swInfo: '',
                        devices: [],
                    },
                } as any,
            ];

            fixture.detectChanges();

            expect(component.showDeviceChip).toBe(true);
            expect(component.hasDevices).toBe(false);
            expect(component.deviceChipLabel).toBe('Garmin Edge 540');
        });

        it('should pass the visible device label to the source label suppression input', () => {
            component.selectedActivities = [
                {
                    creator: {
                        name: 'Garmin Edge MTB',
                        swInfo: '',
                        devices: [],
                    },
                } as any,
            ];

            fixture.detectChanges();

            expect(component.deviceSourceSuppressedLabels).toEqual(['Garmin Edge MTB']);
            const template = readFileSync(
                resolve(process.cwd(), 'src/app/components/event-summary/event-summary.component.html'),
                'utf8',
            );
            expect(template).toContain('[suppressedTextLabels]="deviceSourceSuppressedLabels"');
        });

        it('should expose no metadata lookup user for non-owners', () => {
            component.isOwner = false;

            expect(component.ownerMetadataLookupUser).toBeNull();
        });

        it('should expose the metadata lookup user for owners', () => {
            component.isOwner = true;

            expect(component.ownerMetadataLookupUser).toBe(component.user);
        });

        it('should bind source icon metadata lookup to the owner-only user', () => {
            const template = readFileSync(
                resolve(process.cwd(), 'src/app/components/event-summary/event-summary.component.html'),
                'utf8',
            );
            expect(template).toContain('[user]="ownerMetadataLookupUser"');
            expect(template).not.toContain('[user]="user" [showIcon]="false"');
        });
    });

    describe('feeling icon', () => {
        it('should render material symbol for feeling when present', () => {
            component.event = {
                ...mockEvent,
                getStat: (type: string) => {
                    if (type === DataFeeling.type) {
                        return { getValue: () => Feelings.Excellent } as any;
                    }
                    return null;
                }
            } as any;

            fixture.detectChanges();

            expect(component.feelingIcon).toBe('sentiment_very_satisfied');
        });
    });
});
