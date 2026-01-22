import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { EventsMapComponent } from './events-map.component';
import { AppEventService } from '../../services/app.event.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { LoggerService } from '../../services/logger.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserService } from '../../services/app.user.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { signal } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { GoogleMapsLoaderService } from '../../services/google-maps-loader.service';
import { NgZone, ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import {
    EventInterface,
    MapTypes,
    User,
    ActivityInterface,
    DataPositionInterface,
    DataStartPosition,
    DataLatitudeDegrees,
    DataLongitudeDegrees,
    ActivityTypes
} from '@sports-alliance/sports-lib';
import { MarkerClusterer } from '@googlemaps/markerclusterer';

vi.mock('@googlemaps/markerclusterer', () => {
    return {
        MarkerClusterer: vi.fn().mockImplementation(() => ({
            addMarkers: vi.fn(),
            clearMarkers: vi.fn()
        }))
    };
});

describe('EventsMapComponent', () => {
    let component: EventsMapComponent;
    let fixture: ComponentFixture<EventsMapComponent>;
    let mockEventService: any;
    let mockColorService: any;
    let mockLogger: any;
    let mockZone: any;
    let mockUser: User;
    let mockEvent: any; // Use any to allow easy mocking of methods
    let mockThemeService: any;

    beforeEach(async () => {
        mockEventService = {
            attachStreamsToEventWithActivities: vi.fn(),
            getActivities: vi.fn()
        };
        mockColorService = {
            getColorForActivityTypeByActivityTypeGroup: vi.fn(),
            getActivityColor: vi.fn()
        };
        mockLogger = {
            error: vi.fn(),
            log: vi.fn()
        };
        mockThemeService = {
            appTheme: signal(AppThemes.Normal),
            getAppTheme: vi.fn().mockReturnValue(of(AppThemes.Normal)),
            getChartTheme: vi.fn().mockReturnValue(of(AppThemes.Normal)),
        };

        await TestBed.configureTestingModule({
            declarations: [EventsMapComponent], // Standalone: false, so declare it
            providers: [
                { provide: AppEventService, useValue: mockEventService },
                { provide: AppEventColorService, useValue: mockColorService },
                { provide: LoggerService, useValue: mockLogger },
                { provide: AppThemeService, useValue: mockThemeService },
                {
                    provide: GoogleMapsLoaderService,
                    useValue: {
                        importLibrary: vi.fn().mockResolvedValue({
                            Map: vi.fn(),
                            AdvancedMarkerElement: vi.fn()
                        })
                    }
                },
                {
                    provide: AppUserService,
                    useValue: {
                        updateUserProperties: vi.fn().mockResolvedValue(true)
                    }
                },
                ChangeDetectorRef
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA],
            imports: [RouterTestingModule]
        })
            .compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(EventsMapComponent);
        component = fixture.componentInstance;

        // Inject real NgZone
        const zone = TestBed.inject(NgZone);

        // Mock global google object
        (window as any).google = {
            maps: {
                Map: vi.fn().mockImplementation(() => ({
                    setOptions: vi.fn(),
                    fitBounds: vi.fn(),
                    mapTypes: { set: vi.fn() },
                    setMapTypeId: vi.fn()
                })),
                LatLng: class { },
                LatLngLiteral: class { },
                MapTypeId: { ROADMAP: 'roadmap' },
                Marker: vi.fn().mockImplementation((options) => ({
                    setMap: vi.fn(),
                    addListener: vi.fn((event, handler) => {
                        // Store handler to trigger click manually in tests if needed
                        (this as any)._clickHandler = handler;
                    }),
                    setPosition: vi.fn(),
                    setIcon: vi.fn(),
                    setTitle: vi.fn()
                })),
                SymbolPath: { CIRCLE: 'CIRCLE' },
                LatLngBounds: vi.fn().mockImplementation(() => ({
                    extend: vi.fn()
                })),
                StyledMapType: vi.fn(),
                event: {
                    addListenerOnce: vi.fn()
                },
                marker: {
                    AdvancedMarkerElement: vi.fn().mockImplementation((options) => ({
                        map: null,
                        content: options.content,
                        position: options.position,
                        addListener: vi.fn((event, handler) => {
                            (this as any)._clickHandler = handler;
                        }),
                        setMap: vi.fn() // For compatibility if used
                    }))
                }
            }
        };

        // Mock User and Event
        mockUser = { uid: 'test-uid' } as User;
        mockEvent = {
            getStat: vi.fn(),
            getActivityTypesAsString: vi.fn(),
            getDuration: vi.fn(),
            getDistance: vi.fn(),
            getActivityTypesAsArray: vi.fn(),
            getID: vi.fn()
        };

        component.user = mockUser;
        component['AdvancedMarkerElement'] = (window as any).google.maps.marker.AdvancedMarkerElement;
    });

    afterEach(() => {
        // Cleanup if necessary
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('onMapReady', () => {
        it('should initialize map and data', () => {
            component.apiLoaded.set(true);
            const mockMap = new (window as any).google.maps.Map();

            // Spy on initMapData
            const initMapDataSpy = vi.spyOn(component, 'initMapData' as any); // Cast to any to spy on private method

            component.onMapReady(mockMap);
            expect(component['nativeMap']).toBe(mockMap);
            expect(initMapDataSpy).toHaveBeenCalled();
        });
    });

    describe('initMapData (called via onMapReady)', () => {
        it('should create markers for events', () => {
            // Mock Stat for position
            const mockStat = { getValue: () => ({ latitudeDegrees: 10, longitudeDegrees: 20 }) } as DataStartPosition;
            mockEvent.getStat.mockReturnValue(mockStat);

            // Mock display values
            mockEvent.getDuration.mockReturnValue({ getDisplayValue: () => '1h' });
            mockEvent.getDistance.mockReturnValue({ getDisplayValue: () => '10km' });
            mockEvent.getActivityTypesAsArray.mockReturnValue([ActivityTypes.Running]);
            mockEvent.getActivityTypesAsString.mockReturnValue('Running');
            mockEvent.getID.mockReturnValue('evt1');

            component.events = [mockEvent];
            component.apiLoaded = true;

            const mockMap = new (window as any).google.maps.Map();
            component['nativeMap'] = mockMap; // Set nativeMap directly for initMapData

            // Use spy to check private methods if needed, or just check effects
            // Here we stick to public effects or inspecting the markers array if public
            component['initMapData'](); // Call private method directly

            expect(component.markers.length).toBe(1);
            expect((window as any).google.maps.marker.AdvancedMarkerElement).toHaveBeenCalledWith(expect.objectContaining({
                // map: mockMap, // Map is not passed to constructor, it's set via setMap later
                title: 'Running for 1h and 10km'
            }));
        });

        it('should initialize MarkerClusterer when clusterMarkers is true', () => {
            const mockStat = { getValue: () => ({ latitudeDegrees: 10, longitudeDegrees: 20 }) } as DataStartPosition;
            mockEvent.getStat.mockReturnValue(mockStat);
            // Mock display values - add defaults to avoid errors if referenced
            mockEvent.getDuration.mockReturnValue({ getDisplayValue: () => '1h' });
            mockEvent.getDistance.mockReturnValue({ getDisplayValue: () => '10km' });
            mockEvent.getActivityTypesAsArray.mockReturnValue([ActivityTypes.Running]);
            mockEvent.getActivityTypesAsString.mockReturnValue('Running');
            mockEvent.getID.mockReturnValue('evt1');

            component.events = [mockEvent];
            component.clusterMarkers = true;
            component.apiLoaded.set(true);

            const mockMap = new (window as any).google.maps.Map();
            component['nativeMap'] = mockMap;

            component['initMapData']();

            expect(MarkerClusterer).toHaveBeenCalled();
            // Verify constructor arguments if possible, though checking call is a good start
            // The new API expects an object { map, markers, renderer }
            expect(MarkerClusterer).toHaveBeenCalledWith(expect.objectContaining({
                map: mockMap,
                markers: expect.any(Array)
            }));
        });

        it('should initialize mapTypeId from user settings', async () => {
            const userWithMapSettings = {
                ...mockUser,
                settings: {
                    mapSettings: {
                        mapType: 'satellite'
                    }
                }
            } as any;
            component.user = userWithMapSettings;

            // Re-run init logic effectively by calling ngOnInit or just checking the effect if it was in ngOnInit
            // Since the logic is in ngOnInit:
            await component.ngOnInit();

            expect(component.mapTypeId()).toBe('satellite');
        });

        it('should update user settings when map type changes', async () => {
            const spy = vi.fn().mockResolvedValue(true);
            mockUser.settings = { mapSettings: { mapType: 'roadmap' } } as any;
            (component as any).userService = { updateUserProperties: spy };
            component.user = mockUser;

            await component.changeMapType('hybrid' as any);

            expect(component.mapTypeId()).toBe('hybrid');
            expect(spy).toHaveBeenCalledWith(mockUser, { settings: expect.objectContaining({ mapSettings: { mapType: 'hybrid' } }) });
        });
    });

    describe('Marker Click Handler', () => {
        describe('Marker Click Handler', () => {
            it('should load streams and update map bounds on click', async () => {
                // 1. Setup Data
                const mockMap = new (window as any).google.maps.Map();

                const mockStat = { getValue: () => ({ latitudeDegrees: 10, longitudeDegrees: 20 }) } as DataStartPosition;
                mockEvent.getStat.mockReturnValue(mockStat);
                mockEvent.getDuration.mockReturnValue({ getDisplayValue: () => '1h' });
                mockEvent.getDistance.mockReturnValue({ getDisplayValue: () => '10km' });
                mockEvent.getActivityTypesAsArray.mockReturnValue([ActivityTypes.Running]);
                mockEvent.getID.mockReturnValue('evt1');

                component.events = [mockEvent];
                component.apiLoaded.set(true);
                component.onMapReady(mockMap);

                // 2. Setup Service Return
                const mockActivity = {
                    getSquashedPositionData: vi.fn(),
                    getID: vi.fn()
                } as any;

                mockActivity.getSquashedPositionData.mockReturnValue([{ latitudeDegrees: 10, longitudeDegrees: 20 }] as DataPositionInterface[]);
                mockActivity.getID.mockReturnValue('act1');

                const mockPopulatedEvent = {
                    getActivities: vi.fn(),
                    getID: vi.fn().mockReturnValue('evt1'),
                    getActivityTypesAsString: vi.fn().mockReturnValue('Run'),
                    getDuration: vi.fn().mockReturnValue({ getValue: () => 100, getDisplayValue: () => '100 mins', getDisplayUnit: () => 'mins' }),
                    getDistance: vi.fn().mockReturnValue({ getValue: () => 1000, getDisplayValue: () => '1km', getDisplayUnit: () => 'km' }),
                    getStat: vi.fn().mockReturnValue({ getValue: () => ({ latitudeDegrees: 10, longitudeDegrees: 20 }) }),
                    getActivityTypesAsArray: vi.fn().mockReturnValue(['Run']),
                    originalFile: { path: 'path/to/file' }
                } as any;
                mockPopulatedEvent.getActivities.mockReturnValue([mockActivity]);

                mockEventService.attachStreamsToEventWithActivities.mockReturnValue(of(mockPopulatedEvent));
                mockColorService.getActivityColor.mockReturnValue('red');

                // 3. Trigger Click
                // Access the marker created
                const marker = component.markers[0];
                // We need to access the spy to get the handler
                const addListenerSpy = marker.addListener as unknown as Mock;
                // The mock implementation we defined: (event, handler) => { (this as any)._clickHandler = handler; }
                // BUT 'this' in arrow function might not be what we expect.
                // Let's rely on the call arguments to get the handler.
                expect(addListenerSpy).toHaveBeenCalled();
                const handler = addListenerSpy.mock.calls[0][1];

                expect(handler).toBeDefined();

                await handler(); // Trigger click and await promise

                // 4. Verify
                expect(mockEventService.attachStreamsToEventWithActivities).toHaveBeenCalledWith(
                    mockUser,
                    mockEvent,
                    [DataLatitudeDegrees.type, DataLongitudeDegrees.type]
                );
                expect(component.selectedEventPositionsByActivity.length).toBe(1);
                expect(component.selectedEventPositionsByActivity[0].color).toBe('red');
                expect(mockMap.fitBounds).toHaveBeenCalled();
                expect(component.selectedEvent).toBe(mockPopulatedEvent);
            });
        });

    });
});
