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

describe('EventCardMapComponent', () => {
    let component: EventCardMapComponent;
    let fixture: ComponentFixture<EventCardMapComponent>;
    let mockLoaderService: any;
    let mockColorService: any;
    let mockLogger: any;
    let mockEventService: any;
    let mockUserService: any;
    let mockCursorService: any;

    beforeEach(async () => {
        const mockLoader = {
            importLibrary: vi.fn().mockReturnValue(of({
                Map: vi.fn(),
                visualization: { HeatmapLayer: vi.fn() }
            }))
        };
        const mockColor = { getActivityColor: vi.fn() };
        const mockLog = { error: vi.fn(), log: vi.fn() };
        const mockEvent = {};
        const mockUserSvc = { updateUserProperties: vi.fn() };
        const mockCursor = { cursors: new Subject() };

        mockLoaderService = mockLoader;
        mockColorService = mockColor;
        mockLogger = mockLog;
        mockEventService = mockEvent;
        mockUserService = mockUserSvc;
        mockCursorService = mockCursor;

        await TestBed.configureTestingModule({
            declarations: [EventCardMapComponent],
            providers: [
                { provide: GoogleMapsLoaderService, useValue: mockLoader },
                { provide: AppEventColorService, useValue: mockColor },
                { provide: LoggerService, useValue: mockLog },
                { provide: AppEventService, useValue: mockEvent },
                { provide: AppUserService, useValue: mockUserSvc },
                { provide: AppActivityCursorService, useValue: mockCursor },
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
        expect(mockLoaderService.importLibrary).toHaveBeenCalledWith('maps');
        expect(mockLoaderService.importLibrary).toHaveBeenCalledWith('visualization');
    });
});
