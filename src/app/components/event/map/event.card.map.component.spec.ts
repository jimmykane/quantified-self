import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardMapComponent } from './event.card.map.component';
import { GoogleMapsLoaderService } from '../../../services/google-maps-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA, NgZone } from '@angular/core';
import { of, Subject } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AppEventService } from '../../../services/app.event.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { signal } from '@angular/core';

describe('EventCardMapComponent', () => {
    let component: EventCardMapComponent;
    let fixture: ComponentFixture<EventCardMapComponent>;
    let mockLoaderService: any;
    let mockColorService: any;
    let mockLogger: any;
    let mockEventService: any;
    let mockUserService: any;
    let mockCursorService: any;
    let mockThemeService: any;

    beforeEach(async () => {
        const mockLoader = {
            importLibrary: vi.fn().mockResolvedValue({
                Map: vi.fn(),
                visualization: { HeatmapLayer: vi.fn() }
            })
        };
        const mockColor = { getActivityColor: vi.fn() };
        const mockLog = { error: vi.fn(), log: vi.fn() };
        const mockEvent = {};
        const mockUserSvc = { updateUserProperties: vi.fn() };
        const mockCursor = { cursors: new Subject() };
        const mockTheme = {
            appTheme: signal(AppThemes.Normal),
            getAppTheme: vi.fn().mockReturnValue(of(AppThemes.Normal)),
            getChartTheme: vi.fn().mockReturnValue(of(AppThemes.Normal)),
        };

        mockLoaderService = mockLoader;
        mockColorService = mockColor;
        mockLogger = mockLog;
        mockEventService = mockEvent;
        mockUserService = mockUserSvc;
        mockCursorService = mockCursor;
        mockThemeService = mockTheme;

        await TestBed.configureTestingModule({
            declarations: [EventCardMapComponent],
            providers: [
                { provide: GoogleMapsLoaderService, useValue: mockLoader },
                { provide: AppEventColorService, useValue: mockColor },
                { provide: LoggerService, useValue: mockLog },
                { provide: AppEventService, useValue: mockEvent },
                { provide: AppUserService, useValue: mockUserSvc },
                { provide: AppActivityCursorService, useValue: mockCursor },
                { provide: AppThemeService, useValue: mockTheme },
                {
                    provide: AppUserSettingsQueryService,
                    useValue: {
                        mapSettings: signal({ mapType: 'roadmap' }),
                        chartSettings: signal({}),
                        unitSettings: signal({}),
                        updateMapSettings: vi.fn()
                    }
                },
                {
                    provide: MarkerFactoryService,
                    useValue: {
                        createPinMarker: vi.fn(),
                        createJumpMarker: vi.fn().mockReturnValue(document.createElement('div')),
                    }
                },
                { provide: NgZone, useValue: new NgZone({ enableLongStackTrace: false }) },
                ChangeDetectorRef
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EventCardMapComponent);
        component = fixture.componentInstance;

        // Mock user input
        component.user = { uid: 'test' } as any;
        component.targetUserID = 'test-uid';
        component.event = {
            getStat: () => ({ getValue: () => ({ latitudeDegrees: 0, longitudeDegrees: 0 }) }),
            getDuration: () => ({ getDisplayValue: () => '1h' }),
            getDistance: () => ({ getDisplayValue: () => '10km' }),
            getActivityTypesAsString: () => 'Run'
        } as any;

        try {
            fixture.detectChanges();
        } catch (e) {
            console.error('Error during detectChanges:', e);
            throw e;
        }
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should call importLibrary on init', () => {
        component.apiLoaded.set(true);
        expect(mockLoaderService.importLibrary).toHaveBeenCalledWith('maps');
        expect(mockLoaderService.importLibrary).toHaveBeenCalledWith('marker');
    });

    it('should initialize mapTypeId from user settings', async () => {
        const userWithMapSettings = {
            ...component.user,
            settings: {
                mapSettings: {
                    mapType: 'satellite'
                }
            }
        } as any;
        component.user = userWithMapSettings;

        // Reset spy counts to verify calls in this specific test cycle
        mockLoaderService.importLibrary.mockClear();

        await component.ngOnInit();

        expect(component.mapTypeId()).toBe('satellite');
    });

    it('should use smallest jump marker bucket when hang time is missing', () => {
        const markerFactory = TestBed.inject(MarkerFactoryService) as any;
        const jump = {
            jumpData: {
                distance: { getValue: () => 1, getDisplayUnit: () => 'm' },
                score: { getValue: () => 1 },
            }
        } as any;

        (component as any).jumpHangTimeMin = 1;
        (component as any).jumpHangTimeMax = 2;

        component.getJumpMarkerOptions(jump, '#ff0000');

        expect(markerFactory.createJumpMarker).toHaveBeenCalledWith(
            '#ff0000',
            EventCardMapComponent.JUMP_MARKER_SIZE_BUCKETS[0]
        );
    });

    it('should use middle jump marker bucket when all hang times are identical', () => {
        const markerFactory = TestBed.inject(MarkerFactoryService) as any;
        const jump = {
            jumpData: {
                hang_time: { getValue: () => 1.5 },
                distance: { getValue: () => 1, getDisplayUnit: () => 'm' },
                score: { getValue: () => 1 },
            }
        } as any;

        (component as any).jumpHangTimeMin = 1.5;
        (component as any).jumpHangTimeMax = 1.5;

        component.getJumpMarkerOptions(jump, '#00ff00');

        expect(markerFactory.createJumpMarker).toHaveBeenCalledWith(
            '#00ff00',
            EventCardMapComponent.JUMP_MARKER_SIZE_BUCKETS[2]
        );
    });

    it('should use largest jump marker bucket for max hang time', () => {
        const markerFactory = TestBed.inject(MarkerFactoryService) as any;
        const jump = {
            jumpData: {
                hang_time: { getValue: () => 5 },
                distance: { getValue: () => 1, getDisplayUnit: () => 'm' },
                score: { getValue: () => 1 },
            }
        } as any;

        (component as any).jumpHangTimeMin = 1;
        (component as any).jumpHangTimeMax = 5;

        component.getJumpMarkerOptions(jump, '#0000ff');

        expect(markerFactory.createJumpMarker).toHaveBeenCalledWith(
            '#0000ff',
            EventCardMapComponent.JUMP_MARKER_SIZE_BUCKETS[4]
        );
    });

    it('should format hang time in marker title using display formatter with milliseconds', () => {
        const getDisplayValue = vi.fn().mockReturnValue('01.3s');
        const jump = {
            jumpData: {
                hang_time: {
                    getValue: () => 1.3,
                    getDisplayValue
                },
                distance: { getValue: () => 3.2, getDisplayUnit: () => 'm' },
                score: { getValue: () => 8.7 },
                speed: { getValue: () => 12.3, getDisplayUnit: () => 'km/h' },
                rotations: { getValue: () => 1.1 }
            }
        } as any;

        const options = component.getJumpMarkerOptions(jump, '#111111');

        expect(getDisplayValue).toHaveBeenCalledWith(false, true, true);
        expect(options.title).toContain('Hang Time: 01.3s');
    });


});
