import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardComponent } from './event.card.component';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { AppActivitySelectionService } from '../../services/activity-selection-service/app-activity-selection.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppThemeService } from '../../services/app.theme.service';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { EventInterface, User, ActivityInterface, ChartThemes, AppThemes, XAxisTypes } from '@sports-alliance/sports-lib';
import { LoggerService } from '../../services/logger.service';
import { MatBottomSheet } from '@angular/material/bottom-sheet';

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
            showPoints: false,
            showArrows: true,
            strokeWidth: 3,
            lapTypes: []
        }
    } as any;

    const mockActivity = {
        getID: () => 'act1',
        getLaps: () => [],
        intensityZones: [],
        creator: { devices: [], name: 'Test Device', swInfo: '' },
        hasPositionData: () => false
    } as unknown as ActivityInterface;

    const mockEvent = {
        getActivities: () => [mockActivity],
        getID: () => 'evt1',
        isMerge: false
    } as unknown as EventInterface;

    beforeEach(async () => {
        mockActivatedRoute = {
            data: of({ event: mockEvent }),
            snapshot: {
                paramMap: {
                    get: (key: string) => (key === 'userID' ? 'testUser' : null)
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

        mockThemeService = {
            getChartTheme: () => of(ChartThemes.Material),
            getAppTheme: () => of(AppThemes.Normal),

        };

        mockRouter = { navigate: vi.fn() };
        mockLoggerService = { log: vi.fn() };

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
                { provide: LoggerService, useValue: mockLoggerService }
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

    it('should compute hasDevicesFlag as false when no devices', () => {
        expect(component.hasDevicesFlag()).toBe(false);
    });

    it('should compute hasPositionsFlag as false when no position data', () => {
        expect(component.hasPositionsFlag()).toBe(false);
    });

    it('should derive chart settings from user signal', () => {
        expect(component.chartXAxisType()).toBe(XAxisTypes.Duration);
        expect(component.showChartLaps()).toBe(true);
        expect(component.showChartGrid()).toBe(true);
    });

    it('should derive map settings from user signal', () => {
        expect(component.showMapLaps()).toBe(true);
        expect(component.showMapPoints()).toBe(false);
        expect(component.showMapArrows()).toBe(true);
    });

    it('should get theme signals from theme service', () => {
        expect(component.chartTheme()).toBe(ChartThemes.Material);
        expect(component.appTheme()).toBe(AppThemes.Normal);
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
    });
});
