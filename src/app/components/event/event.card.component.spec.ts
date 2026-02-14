import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardComponent } from './event.card.component';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { AppActivitySelectionService } from '../../services/activity-selection-service/app-activity-selection.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppThemeService } from '../../services/app.theme.service';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { EventInterface, User, ActivityInterface, ChartThemes, AppThemes, XAxisTypes } from '@sports-alliance/sports-lib';
import { LoggerService } from '../../services/logger.service';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { shouldRenderIntensityZonesChart } from '../../helpers/intensity-zones-chart-data-helper';
import { shouldRenderPowerCurveChart } from '../../helpers/power-curve-chart-data-helper';
import { AppEventService } from '../../services/app.event.service';

vi.mock('../../helpers/intensity-zones-chart-data-helper', () => ({
    shouldRenderIntensityZonesChart: vi.fn(),
}));
vi.mock('../../helpers/power-curve-chart-data-helper', () => ({
    shouldRenderPowerCurveChart: vi.fn(),
}));

describe('EventCardComponent', () => {
    let component: EventCardComponent;
    let fixture: ComponentFixture<EventCardComponent>;

    let mockActivatedRoute: any;
    let mockAuthService: any;
    let mockUserService: any;
    let mockActivitySelectionService: any;
    let mockSnackBar: any;
    let mockThemeService: any;
    let mockRouter: any;
    let mockLoggerService: any;
    let mockBottomSheet: any;
    let mockEventService: any;
    let liveEventDetails$: Subject<EventInterface | null>;
    const mockedShouldRenderIntensityZonesChart = vi.mocked(shouldRenderIntensityZonesChart);
    const mockedShouldRenderPowerCurveChart = vi.mocked(shouldRenderPowerCurveChart);

    const mockUser = new User('testUser');
    mockUser.settings = {
        unitSettings: {},
        chartSettings: {
            xAxisType: XAxisTypes.Duration,
            chartCursorBehaviour: 'Zoom',
            downSamplingLevel: 1,
            gainAndLossThreshold: 1,
            showAllData: false,
            useAnimations: false,
            disableGrouping: false,
            showLaps: true,
            showGrid: true,
            stackYAxes: true,
            hideAllSeriesOnInit: false,
            lapTypes: [],
            strokeWidth: 2,
            strokeOpacity: 1,
            fillOpacity: 0.2,
            extraMaxForPower: 0,
            extraMaxForPace: 0
        },
        mapSettings: {
            showLaps: true,

            showArrows: true,
            strokeWidth: 3,
            lapTypes: []
        }
    } as any;

    const createActivity = (id: string, hasData = false): ActivityInterface => ({
        getID: () => id,
        getLaps: () => hasData ? [{ type: 'Manual' }] as any : [],
        intensityZones: hasData ? [{ zone: 1 }] as any : [],
        creator: hasData
            ? { devices: [{ name: 'HRM' }], name: `Device ${id}`, swInfo: '' }
            : { devices: [], name: `Device ${id}`, swInfo: '' },
        hasPositionData: () => hasData,
        getStreams: () => [],
        clearStreams: vi.fn(),
        addStreams: vi.fn(),
    } as unknown as ActivityInterface);

    const createEvent = (id: string, activities: ActivityInterface[], name = 'Event'): EventInterface => ({
        name,
        getActivities: () => activities,
        getID: () => id,
        isMerge: false
    } as unknown as EventInterface);

    const mockActivity = createActivity('act1');
    const mockEvent = createEvent('evt1', [mockActivity], 'Initial Event');

    beforeEach(async () => {
        mockedShouldRenderIntensityZonesChart.mockReturnValue(false);
        mockedShouldRenderPowerCurveChart.mockReturnValue(false);
        liveEventDetails$ = new Subject<EventInterface | null>();

        mockActivatedRoute = {
            data: of({ event: mockEvent }),
            snapshot: {
                paramMap: {
                    get: (key: string) => {
                        if (key === 'userID') return 'testUser';
                        if (key === 'eventID') return 'evt1';
                        return null;
                    }
                }
            }
        };

        mockAuthService = {
            user$: of(mockUser)
        };

        mockUserService = {
            getUserChartDataTypesToUse: vi.fn().mockReturnValue(['speed'])
        };

        mockActivitySelectionService = {
            selectedActivities: {
                clear: vi.fn(),
                select: vi.fn(),
                isSelected: vi.fn().mockReturnValue(true),
                deselect: vi.fn(),
                changed: {
                    asObservable: () => of({ source: { selected: [] } }),
                    pipe: () => of({ source: { selected: [] } })
                }
            }
        };

        mockSnackBar = { open: vi.fn() };
        mockBottomSheet = { open: vi.fn() };
        mockEventService = {
            getEventDetailsLive: vi.fn(() => liveEventDetails$.asObservable()),
            getEventActivitiesAndSomeStreams: vi.fn(() => of(mockEvent)),
        };

        mockThemeService = {
            getChartTheme: () => of(ChartThemes.Material),
            getAppTheme: () => of(AppThemes.Normal),

        };

        mockRouter = { navigate: vi.fn() };
        mockLoggerService = { log: vi.fn(), error: vi.fn() };

        await TestBed.configureTestingModule({
            declarations: [EventCardComponent],
            providers: [
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppActivitySelectionService, useValue: mockActivitySelectionService },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: MatBottomSheet, useValue: mockBottomSheet },
                { provide: AppThemeService, useValue: mockThemeService },
                { provide: Router, useValue: mockRouter },
                { provide: LoggerService, useValue: mockLoggerService },
                { provide: AppEventService, useValue: mockEventService },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        })
            .compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EventCardComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should initialize event from route data as signal', () => {
        expect(component.event()).toBe(mockEvent);
        expect(mockActivitySelectionService.selectedActivities.clear).toHaveBeenCalled();
        expect(mockActivitySelectionService.selectedActivities.select).toHaveBeenCalled();
        expect(mockEventService.getEventDetailsLive).toHaveBeenCalledTimes(1);
        expect(mockedShouldRenderIntensityZonesChart).toHaveBeenCalled();
        expect(mockedShouldRenderPowerCurveChart).toHaveBeenCalled();
    });

    it('should apply live event updates for matching activity IDs', () => {
        const liveUpdatedEvent = createEvent('evt1', [createActivity('act1')], 'Live Updated Event');

        liveEventDetails$.next(liveUpdatedEvent);

        expect(component.event()).toBe(liveUpdatedEvent);
        expect(component.event()?.name).toBe('Live Updated Event');
    });

    it('should trigger one full refresh when live activity IDs mismatch', async () => {
        const liveMismatchedEvent = createEvent('evt1', [createActivity('act2')], 'Live Mismatch Event');
        const refreshedEvent = createEvent('evt1', [createActivity('act1')], 'Refreshed Event');
        mockEventService.getEventActivitiesAndSomeStreams.mockReturnValue(of(refreshedEvent));

        liveEventDetails$.next(liveMismatchedEvent);
        await Promise.resolve();
        await Promise.resolve();

        expect(mockEventService.getEventActivitiesAndSomeStreams).toHaveBeenCalledTimes(1);
        expect(component.event()).toBe(refreshedEvent);
    });

    it('should preserve selected activity IDs on live updates', () => {
        const activityA = createActivity('act-a');
        const activityB = createActivity('act-b');
        const initialEvent = createEvent('evt1', [activityA, activityB], 'Initial Multi Event');
        component.event.set(initialEvent as any);
        component.selectedActivitiesInstant.set([activityB]);
        component.selectedActivitiesDebounced.set([activityB]);

        const liveUpdatedEvent = createEvent('evt1', [createActivity('act-a'), createActivity('act-b')], 'Live Multi Event');
        liveEventDetails$.next(liveUpdatedEvent);

        expect(component.selectedActivitiesInstant().map((activity) => activity.getID())).toEqual(['act-b']);
    });

    it('should set targetUserID signal from route', () => {
        expect(component.targetUserID()).toBe('testUser');
    });

    it('should update currentUser signal from auth', () => {
        expect(component.currentUser()).toBe(mockUser);
    });

    it('should compute isOwner correctly', () => {
        // targetUserID is 'testUser' and currentUser.uid is 'testUser'
        expect(component.isOwner()).toBe(true);
    });

    it('should compute hasLapsFlag as false when no laps', () => {
        expect(component.hasLapsFlag()).toBe(false);
    });

    it('should compute hasIntensityZonesFlag as false when no zones', () => {
        expect(component.hasIntensityZonesFlag()).toBe(false);
    });

    it('should compute hasIntensityZonesFlag as false when data collapses to one zone', () => {
        mockedShouldRenderIntensityZonesChart.mockReturnValue(false);
        expect(component.hasIntensityZonesFlag()).toBe(false);
    });

    it('should compute hasPowerCurveFlag as false when no power curve exists', () => {
        expect(component.hasPowerCurveFlag()).toBe(false);
    });

    it('should compute hasPerformanceChartsFlag as false when intensity and power curve are both unavailable', () => {
        expect(component.hasPerformanceChartsFlag()).toBe(false);
    });

    it('should compute hasDevicesFlag as false when no devices', () => {
        expect(component.hasDevicesFlag()).toBe(false);
    });

    it('should compute hasPositionsFlag as false when no position data', () => {
        expect(component.hasPositionsFlag()).toBe(false);
    });

    it('should get theme signals from theme service', () => {
        expect(component.chartTheme()).toBe(ChartThemes.Material);
    });

    describe('computed flags with activities that have data', () => {
        const activityWithData = {
            getID: () => 'act2',
            getLaps: () => [{ type: 'Manual' }],
            intensityZones: [{ zone: 1 }],
            creator: { devices: [{ name: 'HRM' }], name: 'Device', swInfo: '' },
            hasPositionData: () => true
        } as unknown as ActivityInterface;

        const eventWithData = {
            getActivities: () => [activityWithData],
            getID: () => 'evt2',
            isMerge: false
        } as unknown as EventInterface;

        beforeEach(() => {
            mockedShouldRenderIntensityZonesChart.mockReturnValue(true);
            mockedShouldRenderPowerCurveChart.mockReturnValue(true);
            // Update the route data mock
            mockActivatedRoute.data = of({ event: eventWithData });

            // Recreate fixture with new data
            fixture = TestBed.createComponent(EventCardComponent);
            component = fixture.componentInstance;
            fixture.detectChanges();
        });

        it('should compute hasLapsFlag as true when laps exist', () => {
            expect(component.hasLapsFlag()).toBe(true);
        });

        it('should compute hasIntensityZonesFlag as true when zones exist', () => {
            expect(component.hasIntensityZonesFlag()).toBe(true);
        });

        it('should compute hasDevicesFlag as true when devices exist', () => {
            expect(component.hasDevicesFlag()).toBe(true);
        });

        it('should compute hasPositionsFlag as true when position data exists', () => {
            expect(component.hasPositionsFlag()).toBe(true);
        });

        it('should compute hasPowerCurveFlag as true when power curve exists', () => {
            expect(component.hasPowerCurveFlag()).toBe(true);
        });

        it('should compute hasPerformanceChartsFlag as true when either chart is available', () => {
            expect(component.hasPerformanceChartsFlag()).toBe(true);
        });
    });

});
