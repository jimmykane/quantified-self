import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventSummaryComponent } from './event-summary.component';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import {
    ActivityTypes,
    DataDistance,
    DataDuration,
    DataFeeling,
    DataPaceAvg,
    DataSpeedAvg,
    DynamicDataLoader,
    EventInterface,
    Feelings,
    Privacy,
    User
} from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AppBenchmarkFlowService } from '../../services/app.benchmark-flow.service';



describe('EventSummaryComponent', () => {
    let component: EventSummaryComponent;
    let fixture: ComponentFixture<EventSummaryComponent>;
    let mockBottomSheet: any;
    let mockBenchmarkFlowService: any;

    const mockUser: User = {
        uid: 'test-user-id',
    } as any;

    const mockEvent = {
        getID: () => 'test-event-id',
        privacy: Privacy.Private,
        getActivities: () => [{ type: ActivityTypes.Running }],
        getStat: (type: string) => null,
        startDate: new Date(),
    } as unknown as EventInterface;

    beforeEach(async () => {
        mockBottomSheet = {
            open: vi.fn(),
        };

        mockBenchmarkFlowService = {
            openBenchmarkSelectionDialog: vi.fn(),
            generateAndOpenReport: vi.fn().mockResolvedValue(undefined),
            openBenchmarkReport: vi.fn(),
        };

        await TestBed.configureTestingModule({
            declarations: [
                EventSummaryComponent
            ],
            providers: [
                { provide: MatBottomSheet, useValue: mockBottomSheet },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
                { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn() } },
                { provide: AppBenchmarkFlowService, useValue: mockBenchmarkFlowService },
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

    describe('open... methods', () => {
        it('openEditDetails should open bottom sheet', () => {
            component.openEditDetails();
            expect(mockBottomSheet.open).toHaveBeenCalled();
        });

        it('openDetailedStats should open bottom sheet', () => {
            component.openDetailedStats();
            expect(mockBottomSheet.open).toHaveBeenCalled();
        });

        // openDevices requires data mocking for checks, but basic call check:
        it('openDevices should open bottom sheet', () => {
            component.openDevices();
            expect(mockBottomSheet.open).toHaveBeenCalled();
        });
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
