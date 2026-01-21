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
        component.user = { uid: 'test', settings: { mapSettings: {} } } as any;
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
        fixture = TestBed.createComponent(EventCardMapComponent);
        component = fixture.componentInstance;

        const userWithMapSettings = {
            uid: 'test',
            settings: {
                mapSettings: {
                    mapType: 'satellite'
                }
            }
        } as any;
        component.user = userWithMapSettings;

        // Mock required inputs
        component.event = {
            getStat: () => ({ getValue: () => ({ latitudeDegrees: 0, longitudeDegrees: 0 }) }),
            getDuration: () => ({ getDisplayValue: () => '1h' }),
            getDistance: () => ({ getDisplayValue: () => '10km' }),
            getActivityTypesAsString: () => 'Run'
        } as any;

        // Reset spy counts to verify calls in this specific test cycle
        mockLoaderService.importLibrary.mockClear();

        fixture.detectChanges(); // Triggers ngOnInit

        expect(component.mapTypeId()).toBe('satellite');
    });


});
