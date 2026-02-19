import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TracksComponent } from './tracks.component';
import { ChangeDetectorRef, NO_ERRORS_SCHEMA, PLATFORM_ID, signal } from '@angular/core';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { AppEventService } from '../../services/app.event.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { AppFileService } from '../../services/app.file.service';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppUserService } from '../../services/app.user.service';
import { MapboxLoaderService } from '../../services/mapbox-loader.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { BrowserCompatibilityService } from '../../services/browser.compatibility.service';
import { LoggerService } from '../../services/logger.service';
import { MapStyleService } from '../../services/map-style.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { of } from 'rxjs';
import { ActivityTypes, AppThemes, DataPaceAvg, DataSpeedAvg, DataStartPosition, DateRanges } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from '@angular/cdk/overlay';
import { MaterialModule } from '../../modules/material.module';
import { MyTracksTripDetectionService } from '../../services/my-tracks-trip-detection.service';
import { TripLocationLabelService } from '../../services/trip-location-label.service';
import { PeekPanelComponent } from '../shared/peek-panel/peek-panel.component';
import { MapboxAutoResizeService } from '../../services/map/mapbox-auto-resize.service';

const waitForAsyncWork = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createStat = (value: number) => ({
  getValue: () => value
});

const createMockEvent = (eventId: string, startDateIso: string, latitudeDegrees: number, longitudeDegrees: number, activityType = ActivityTypes.Running) => {
  const startPositionStat = {
    getValue: () => ({ latitudeDegrees, longitudeDegrees })
  };

  const activity = {
    type: activityType,
    hasPositionData: () => true,
    getPositionData: () => [
      { latitudeDegrees, longitudeDegrees },
      { latitudeDegrees: latitudeDegrees + 0.01, longitudeDegrees: longitudeDegrees + 0.01 }
    ]
  };

  return {
    isMerge: false,
    startDate: Date.parse(startDateIso),
    getID: () => eventId,
    getStat: (type: string) => (type === DataStartPosition.type ? startPositionStat : undefined),
    addActivities: vi.fn(),
    getActivities: () => [activity],
  };
};

const createDetectedTrip = (overrides: Record<string, unknown> = {}) => ({
  tripId: 'trip-id',
  destinationId: 'destination-nepal',
  destinationVisitIndex: 1,
  destinationVisitCount: 1,
  isRevisit: false,
  eventIds: [],
  locationLabel: 'Nepal',
  startDate: new Date('2022-11-08T00:00:00Z'),
  endDate: new Date('2022-11-16T00:00:00Z'),
  activityCount: 7,
  centroidLat: 27.7172,
  centroidLng: 85.3240,
  bounds: {
    west: 84.9,
    east: 85.6,
    south: 27.5,
    north: 28.0,
  },
  ...overrides
});

describe('TracksComponent', () => {
  let component: TracksComponent;
  let fixture: ComponentFixture<TracksComponent>;
  let mockAuthService: any;
  let mockUserService: any;
  let mockMapboxLoader: any;
  let mockThemeService: any;
  let mockEventService: any;
  let mockMap: any;
  let mockMapStyleService: any;
  let mockUserSettingsQuery: any;
  let mockTripDetectionService: any;
  let mockTripLocationLabelService: any;

  const mockUser = {
    uid: 'user-1',
    settings: {
      myTracksSettings: {
        dateRange: DateRanges.thisWeek,
        activityTypes: []
      },
      mapSettings: {
        mapStyle: 'default',
        is3D: true,
      },
      unitSettings: {
        startOfTheWeek: 1
      }
    }
  };

  beforeEach(async () => {
    mockMap = {
      addControl: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getSource: vi.fn().mockReturnValue(null),
      getLayer: vi.fn().mockReturnValue(null),
      flyTo: vi.fn(),
      setStyle: vi.fn(),
      once: vi.fn().mockImplementation((event, cb) => {
        if (event === 'style.load') cb();
      }),
      isStyleLoaded: vi.fn().mockReturnValue(true),
      getTerrain: vi.fn().mockReturnValue(null),
      setTerrain: vi.fn(),
      easeTo: vi.fn(),
      setPitch: vi.fn(),
      remove: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
      queryRenderedFeatures: vi.fn().mockReturnValue([]),
      getCanvas: vi.fn().mockReturnValue({ style: { cursor: '' } }),
      project: vi.fn().mockReturnValue({ x: 100, y: 120 }),
      panTo: vi.fn(),
    };

    mockAuthService = {
      user$: of(mockUser)
    };

    mockUserService = {
      updateUserProperties: vi.fn().mockResolvedValue({})
    };

    mockMapboxLoader = {
      createMap: vi.fn().mockResolvedValue(mockMap),
      loadMapbox: vi.fn().mockResolvedValue({
        FullscreenControl: class { },
        NavigationControl: class { },
        LngLatBounds: class {
          extend = vi.fn();
        }
      })
    };

    mockThemeService = {
      getAppTheme: vi.fn().mockReturnValue(of(AppThemes.Dark)),
      appTheme: signal(AppThemes.Dark)
    };

    mockEventService = {
      getEventsBy: vi.fn().mockReturnValue(of([])),
      getActivities: vi.fn().mockReturnValue(of([])),
      attachStreamsToEventWithActivities: vi.fn().mockImplementation((_user: unknown, event: any) => of(event))
    };

    mockMapStyleService = {
      resolve: vi.fn().mockReturnValue({ styleUrl: 'mapbox://styles/mapbox/standard', preset: 'day' }),
      isStandard: vi.fn().mockReturnValue(true),
      applyStandardPreset: vi.fn(),
      enforcePresetOnStyleEvents: vi.fn(),
      getSupportedStyleOptions: vi.fn().mockReturnValue([
        { value: 'default', label: 'Default' },
        { value: 'satellite', label: 'Satellite' },
        { value: 'outdoors', label: 'Outdoors' },
      ]),
      normalizeStyle: vi.fn().mockImplementation((value: string) => value || 'default'),
      adjustColorForTheme: vi.fn().mockReturnValue('#ffffff'),
      createSynchronizer: vi.fn().mockReturnValue({
        update: vi.fn()
      })
    };

    mockUserSettingsQuery = {
      myTracksSettings: signal({
        dateRange: DateRanges.thisWeek,
        activityTypes: []
      }),
      mapSettings: signal({
        mapStyle: 'default',
        is3D: true,
      }),
      updateMyTracksSettings: vi.fn(),
      updateMapSettings: vi.fn()
    };

    mockTripDetectionService = {
      detectTrips: vi.fn().mockReturnValue([])
    };

    mockTripLocationLabelService = {
      resolveTripLocation: vi.fn().mockResolvedValue(null),
      resolveCountryName: vi.fn().mockResolvedValue(null),
    };

    await TestBed.configureTestingModule({
      declarations: [TracksComponent, PeekPanelComponent],
      imports: [MaterialModule],
      providers: [
        { provide: AppAuthService, useValue: mockAuthService },
        { provide: AppUserService, useValue: mockUserService },
        { provide: MapboxLoaderService, useValue: mockMapboxLoader },
        { provide: AppThemeService, useValue: mockThemeService },
        { provide: AppEventService, useValue: mockEventService },
        { provide: AppEventColorService, useValue: { getTrackColor: vi.fn() } },
        { provide: AppAnalyticsService, useValue: { logEvent: vi.fn() } },
        { provide: BrowserCompatibilityService, useValue: { checkCompressionSupport: vi.fn().mockReturnValue(true) } },
        { provide: LoggerService, useValue: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() } },
        { provide: AppFileService, useValue: {} },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ChangeDetectorRef, useValue: { markForCheck: vi.fn(), detectChanges: vi.fn() } },
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: MatBottomSheet, useValue: { open: vi.fn(), dismiss: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: Overlay, useValue: { scrollStrategies: { reposition: vi.fn() } } },
        { provide: 'MatDialog', useValue: {} },
        { provide: MapStyleService, useValue: mockMapStyleService },
        { provide: AppUserSettingsQueryService, useValue: mockUserSettingsQuery },
        { provide: MyTracksTripDetectionService, useValue: mockTripDetectionService },
        { provide: TripLocationLabelService, useValue: mockTripLocationLabelService },
        { provide: MapboxAutoResizeService, useValue: { bind: vi.fn(), unbind: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(TracksComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Initialization robustness', () => {
    it('should skip geolocation flyTo when track bounds were already applied', () => {
      const originalGeolocation = navigator.geolocation;
      let successCallback: ((position: any) => void) | undefined;
      try {
        Object.defineProperty(navigator, 'geolocation', {
          configurable: true,
          value: {
            getCurrentPosition: vi.fn().mockImplementation((success: (position: any) => void) => {
              successCallback = success;
            })
          }
        });

        (component as any).centerMapToStartingLocation(mockMap);
        (component as any).hasTrackBoundsBeenApplied = true;
        successCallback?.({
          coords: {
            longitude: 10,
            latitude: 20
          }
        });

        expect(mockMap.flyTo).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(navigator, 'geolocation', {
          configurable: true,
          value: originalGeolocation
        });
      }
    });

    it('should wait for authenticated user before loading tracks', async () => {
      const logger = TestBed.inject(LoggerService) as any;
      await (component as any).loadTracksMapForUserByDateRange(undefined, DateRanges.thisWeek, []);

      expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('[TracksComponent] Skipping track load because user is undefined.');
    });

    it('should use one-hour metadata cache TTL when hydrating streams for myTracks', async () => {
      const event = createMockEvent('hydration-cache-event', '2024-11-08T08:00:00Z', 40.64, 22.94);
      mockEventService.getEventsBy.mockReturnValue(of([event]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockEventService.attachStreamsToEventWithActivities).toHaveBeenCalledWith(
        mockUser,
        expect.anything(),
        [expect.any(String), expect.any(String)],
        true,
        false,
        'attach_streams_only',
        { metadataCacheTtlMs: 60 * 60 * 1000 },
      );
    });

    it('should add mapbox-dem source before setting terrain', async () => {
      mockMap.isStyleLoaded.mockReturnValue(true);
      await component.ngOnInit();
      fixture.detectChanges();
      await waitForAsyncWork();

      expect(mockMap.addSource).toHaveBeenCalledWith('mapbox-dem', expect.anything());
      expect(mockMap.setTerrain).toHaveBeenCalled();
    });

    it('should not add mapbox-dem source if it already exists', async () => {
      mockMap.isStyleLoaded.mockReturnValue(true);
      mockMap.getSource.mockReturnValue({});

      await component.ngOnInit();
      fixture.detectChanges();
      await waitForAsyncWork();

      expect(mockMap.addSource).not.toHaveBeenCalledWith('mapbox-dem', expect.anything());
    });

    it('should initialize map synchronizer on init', async () => {
      await component.ngOnInit();
      fixture.detectChanges();
      await waitForAsyncWork();

      expect(mockMapStyleService.createSynchronizer).toHaveBeenCalledWith(mockMap);

      const synchronizer = mockMapStyleService.createSynchronizer.mock.results[0].value;
      expect(synchronizer.update).toHaveBeenCalled();
    });

    it('should update map style without reloading track data', async () => {
      const loadTracksSpy = vi
        .spyOn(component as any, 'loadTracksMapForUserByDateRange')
        .mockResolvedValue(undefined);

      await component.ngOnInit();
      fixture.detectChanges();
      await waitForAsyncWork();

      const loadCallsBefore = loadTracksSpy.mock.calls.length;
      expect(loadCallsBefore).toBeGreaterThan(0);

      mockUserSettingsQuery.mapSettings.set({
        ...mockUserSettingsQuery.mapSettings(),
        mapStyle: 'satellite'
      });
      await waitForAsyncWork();

      expect(loadTracksSpy.mock.calls.length).toBe(loadCallsBefore);
    });

    it('should persist map style under mapSettings', () => {
      component.setMapStyle('satellite');

      expect(mockUserSettingsQuery.updateMapSettings).toHaveBeenCalledWith({ mapStyle: 'satellite' });
    });

    it('should persist 3d toggle under mapSettings via terrain control', async () => {
      await component.ngOnInit();
      fixture.detectChanges();
      await waitForAsyncWork();
      mockUserSettingsQuery.updateMapSettings.mockClear();

      const terrainControl = mockMap.addControl.mock.calls
        .map((call: any[]) => call[0])
        .find((control: any) => typeof control?.set3DState === 'function');

      expect(terrainControl).toBeTruthy();
      (terrainControl as any).onToggle(true);

      expect(mockUserSettingsQuery.updateMapSettings).toHaveBeenCalledWith({ is3D: true });
    });

    it('should persist jump heatmap setting when toggled', () => {
      component.onShowJumpHeatmapToggle(false);

      expect(mockUserSettingsQuery.updateMyTracksSettings).toHaveBeenCalledWith({ showJumpHeatmap: false });
    });

    it('should show jump heatmap toggle only when jumps are detected', () => {
      component.hasDetectedJumps.set(false);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.jump-heat-toggle')).toBeNull();

      component.hasDetectedJumps.set(true);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.jump-heat-toggle')).not.toBeNull();
    });

    it('should collect jump heat points from loaded activities', async () => {
      const trackManager = (component as any).tracksMapManager;
      const setJumpHeatPointsSpy = vi.spyOn(trackManager, 'setJumpHeatPoints');

      const activity = {
        type: ActivityTypes.Running,
        hasPositionData: () => true,
        getPositionData: () => [
          { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
          { latitudeDegrees: 40.65, longitudeDegrees: 22.95 },
        ],
        getAllEvents: () => [{
          jumpData: {
            position_lat: createStat(40.645),
            position_long: createStat(22.945),
            hang_time: createStat(1.7),
            distance: createStat(4.2),
          }
        }]
      };

      const event = createMockEvent('jump-event-1', '2024-11-08T08:00:00Z', 40.64, 22.94);
      (event as any).getActivities = () => [activity];

      mockEventService.getEventsBy.mockReturnValue(of([event]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(setJumpHeatPointsSpy).toHaveBeenCalledTimes(1);
      expect(setJumpHeatPointsSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          lng: 22.945,
          lat: 40.645,
          hangTime: 1.7,
          distance: 4.2
        })
      ]);
    });

    it('should collect activity start points from loaded activities', async () => {
      const trackManager = (component as any).tracksMapManager;
      const setActivityStartPointsSpy = vi.spyOn(trackManager, 'setActivityStartPoints');

      const activity = {
        type: ActivityTypes.Running,
        getID: () => 'activity-start-1',
        hasPositionData: () => true,
        getPositionData: () => [
          { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
          { latitudeDegrees: 40.65, longitudeDegrees: 22.95 },
        ],
        getDuration: () => ({
          getDisplayValue: () => '01:00:00'
        }),
        getDistance: () => ({
          getDisplayValue: () => '10.5',
          getDisplayUnit: () => 'km'
        }),
        getStat: (type: string) => {
          if (type === DataPaceAvg.type) {
            return {
              getDisplayValue: () => '5:10',
              getDisplayUnit: () => 'min/km',
              getType: () => DataPaceAvg.type
            };
          }
          return null;
        },
        getAllEvents: () => []
      };

      const event = createMockEvent('start-event-1', '2024-11-08T08:00:00Z', 40.64, 22.94);
      (event as any).getActivities = () => [activity];
      mockEventService.getEventsBy.mockReturnValue(of([event]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(setActivityStartPointsSpy).toHaveBeenCalled();
      expect(setActivityStartPointsSpy).toHaveBeenLastCalledWith([
        expect.objectContaining({
          eventId: 'start-event-1',
          activityId: 'activity-start-1',
          durationLabel: '01:00:00',
          distanceLabel: '10.5 km',
          effortLabel: 'Pace',
          effortDisplayLabel: '5:10 min/km',
          lng: 22.94,
          lat: 40.64
        })
      ]);
    });

    it('should resolve pace metric for trail running start points', async () => {
      const trackManager = (component as any).tracksMapManager;
      const setActivityStartPointsSpy = vi.spyOn(trackManager, 'setActivityStartPoints');

      const activity = {
        type: ActivityTypes.TrailRunning,
        getID: () => 'activity-trail-1',
        hasPositionData: () => true,
        getPositionData: () => [
          { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
          { latitudeDegrees: 40.65, longitudeDegrees: 22.95 },
        ],
        getDuration: () => ({ getDisplayValue: () => '00:50:00' }),
        getDistance: () => ({ getDisplayValue: () => '8.0', getDisplayUnit: () => 'km' }),
        getStat: (type: string) => {
          if (type === DataPaceAvg.type) {
            return {
              getDisplayValue: () => '6:01',
              getDisplayUnit: () => 'min/km',
              getType: () => DataPaceAvg.type
            };
          }
          return null;
        },
        getAllEvents: () => []
      };

      const event = createMockEvent('trail-event-1', '2024-11-08T08:00:00Z', 40.64, 22.94, ActivityTypes.TrailRunning);
      (event as any).getActivities = () => [activity];
      mockEventService.getEventsBy.mockReturnValue(of([event]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.TrailRunning]);
      await waitForAsyncWork();

      expect(setActivityStartPointsSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          activityId: 'activity-trail-1',
          effortLabel: 'Pace',
          effortDisplayLabel: '6:01 min/km'
        })
      ]);
    });

    it('should resolve speed metric for cycling start points', async () => {
      const trackManager = (component as any).tracksMapManager;
      const setActivityStartPointsSpy = vi.spyOn(trackManager, 'setActivityStartPoints');

      const activity = {
        type: ActivityTypes.Cycling,
        getID: () => 'activity-bike-1',
        hasPositionData: () => true,
        getPositionData: () => [
          { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
          { latitudeDegrees: 40.65, longitudeDegrees: 22.95 },
        ],
        getDuration: () => ({ getDisplayValue: () => '00:45:00' }),
        getDistance: () => ({ getDisplayValue: () => '20.0', getDisplayUnit: () => 'km' }),
        getStat: (type: string) => {
          if (type === DataSpeedAvg.type) {
            return {
              getDisplayValue: () => '26.7',
              getDisplayUnit: () => 'km/h',
              getType: () => DataSpeedAvg.type
            };
          }
          return null;
        },
        getAllEvents: () => []
      };

      const event = createMockEvent('bike-event-1', '2024-11-08T08:00:00Z', 40.64, 22.94, ActivityTypes.Cycling);
      (event as any).getActivities = () => [activity];
      mockEventService.getEventsBy.mockReturnValue(of([event]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Cycling]);
      await waitForAsyncWork();

      expect(setActivityStartPointsSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          activityId: 'activity-bike-1',
          effortLabel: 'Speed',
          effortDisplayLabel: '26.7 km/h'
        })
      ]);
    });

    it('should clear jump heatmap when no valid jump points are found', async () => {
      const trackManager = (component as any).tracksMapManager;
      const setJumpHeatPointsSpy = vi.spyOn(trackManager, 'setJumpHeatPoints');
      const clearJumpHeatmapSpy = vi.spyOn(trackManager, 'clearJumpHeatmap');

      const activity = {
        type: ActivityTypes.Running,
        hasPositionData: () => true,
        getPositionData: () => [
          { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
          { latitudeDegrees: 40.65, longitudeDegrees: 22.95 },
        ],
        getAllEvents: () => [{
          jumpData: {
            position_lat: createStat(200),
            position_long: createStat(22.945),
            hang_time: createStat(1.2),
          }
        }]
      };

      const event = createMockEvent('jump-event-empty', '2024-11-08T08:00:00Z', 40.64, 22.94);
      (event as any).getActivities = () => [activity];

      mockEventService.getEventsBy.mockReturnValue(of([event]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(setJumpHeatPointsSpy).not.toHaveBeenCalled();
      expect(clearJumpHeatmapSpy).toHaveBeenCalled();
    });

    it('should update popup state from start marker selection handler', async () => {
      await component.ngOnInit();
      fixture.detectChanges();
      await waitForAsyncWork();

      const manager = (component as any).tracksMapManager as any;
      const selectionHandler = manager.startSelectionHandler as ((selection: any) => void);
      expect(typeof selectionHandler).toBe('function');

      component.searchPeekExpanded.set(true);
      component.detectedTripsPanelExpanded.set(true);

      selectionHandler({
        eventId: 'event-1',
        activityId: 'activity-1',
        activityType: 'Running',
        startDate: 1731062400000,
        durationLabel: '01:00:00',
        distanceLabel: '10 km',
        lng: 10,
        lat: 20
      });

      expect(component.selectedStartPoint()).toEqual(expect.objectContaining({
        eventId: 'event-1',
        activityId: 'activity-1'
      }));
      expect(component.selectedStartPointScreen()).toEqual({ x: 100, y: 120 });
      expect(component.searchPeekExpanded()).toBe(false);
      expect(component.detectedTripsPanelExpanded()).toBe(false);
      expect(mockMap.panTo).toHaveBeenCalledWith([10, 20], expect.objectContaining({
        essential: true
      }));

      selectionHandler(null);
      expect(component.selectedStartPoint()).toBeNull();
      expect(component.selectedStartPointScreen()).toBeNull();
    });

    it('should navigate to event when opening selected start marker activity', async () => {
      component.user = mockUser as any;
      component.selectedStartPoint.set({
        eventId: 'event-42',
        activityId: 'activity-42',
        activityType: 'Running',
        startDate: 1731062400000,
        durationLabel: '00:40:00',
        distanceLabel: '7 km',
        lng: 10,
        lat: 20
      });
      component.selectedStartPointScreen.set({ x: 120, y: 140 });

      component.openSelectedStartPointEvent();

      const router = TestBed.inject(Router) as any;
      expect(router.navigate).toHaveBeenCalledWith(['/user', 'user-1', 'event', 'event-42']);
      expect(component.selectedStartPoint()).toBeNull();
      expect(component.selectedStartPointScreen()).toBeNull();
    });

    it('should build start-point popup content from shared popup service using event data', () => {
      const event = createMockEvent('event-1', '2024-11-08T08:00:00Z', 40.64, 22.94);
      (event as any).getActivities = () => [];
      (event as any).getDuration = () => ({ getType: () => 'DataDuration', getDisplayValue: () => '00:45:00', getDisplayUnit: () => '' });
      (event as any).getDistance = () => ({ getType: () => 'DataDistance', getDisplayValue: () => '8.5', getDisplayUnit: () => 'km' });
      (event as any).getStat = (type: string) => {
        if (type === DataPaceAvg.type) {
          return {
            getDisplayValue: () => '5:20',
            getDisplayUnit: () => 'min/km',
            getType: () => DataPaceAvg.type
          };
        }
        return null;
      };
      (event as any).getActivityTypesAsArray = () => [ActivityTypes.Running];
      (event as any).getActivityTypesAsString = () => 'Running';
      (component as any).eventsById.set('event-1', event);

      const popupContent = component.getStartPointPopupContent({
        eventId: 'event-1',
      } as any);

      expect(popupContent?.metrics).toEqual([
        { value: '00:45:00', label: '' },
        { value: '8.5', label: 'km' },
        { value: '5:20', label: 'min/km' },
      ]);
      expect(popupContent?.iconEventType).toBe('Running');
    });
  });

  describe('Trip detection suggestions', () => {
    it('renders both peek panels when user has detected trips', () => {
      component.user = mockUser as any;
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const searchPanel = fixture.nativeElement.querySelector('app-peek-panel.tracks-search-peek');
      const tripsPanel = fixture.nativeElement.querySelector('app-peek-panel.tracks-trips-peek');
      expect(searchPanel).not.toBeNull();
      expect(tripsPanel).not.toBeNull();
    });

    it('hides trips peek panel when no trips are detected', () => {
      component.user = mockUser as any;
      component.detectedTrips.set([]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripsPanel = fixture.nativeElement.querySelector('app-peek-panel.tracks-trips-peek');
      expect(tripsPanel).toBeNull();
    });

    it('toggles detected-trips panel state without changing settings', () => {
      component.hasEvaluatedTripDetection.set(true);
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.detectedTripsPanelExpanded.set(true);
      fixture.detectChanges();

      const beforeCalls = mockUserSettingsQuery.updateMyTracksSettings.mock.calls.length;
      const toggle = fixture.nativeElement.querySelector('.tracks-trips-peek .peek-toggle') as HTMLButtonElement;
      toggle.click();
      fixture.detectChanges();

      expect(component.detectedTripsPanelExpanded()).toBe(false);
      expect(mockUserSettingsQuery.updateMyTracksSettings.mock.calls.length).toBe(beforeCalls);
    });

    it('should generate suggestions from activities in the selected range', async () => {
      const event = createMockEvent('trip-nepal-1', '2024-11-08T08:00:00Z', 27.7172, 85.3240);
      mockEventService.getEventsBy.mockReturnValue(of([event]));
      mockTripDetectionService.detectTrips.mockReturnValue([
        {
          tripId: 'trip-nepal',
          destinationId: 'destination-nepal',
          destinationVisitIndex: 1,
          destinationVisitCount: 1,
          isRevisit: false,
          startDate: new Date('2024-11-08T08:00:00Z'),
          endDate: new Date('2024-11-16T08:00:00Z'),
          activityCount: 3,
          centroidLat: 27.7172,
          centroidLng: 85.3240,
          bounds: {
            west: 85.20,
            east: 85.40,
            south: 27.60,
            north: 27.80,
          },
        }
      ]);
      mockTripLocationLabelService.resolveTripLocation.mockResolvedValue({
        city: 'Kathmandu',
        country: 'Nepal',
        label: 'Kathmandu, Nepal',
      });

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockTripDetectionService.detectTrips).toHaveBeenCalledTimes(1);
      expect(mockTripDetectionService.detectTrips.mock.calls[0][0]).toEqual([
        expect.objectContaining({ eventId: 'trip-nepal-1' })
      ]);
      expect(component.detectedTrips()[0].locationLabel).toBe('Kathmandu, Nepal');
      expect(component.hasEvaluatedTripDetection()).toBe(true);
    });

    it('memoizes location labels by destination id for revisits', async () => {
      const firstVisitEvent = createMockEvent('trip-nepal-visit-1', '2024-11-08T08:00:00Z', 27.7172, 85.3240);
      const secondVisitEvent = createMockEvent('trip-nepal-visit-2', '2024-11-16T08:00:00Z', 27.7201, 85.3301);
      mockEventService.getEventsBy.mockReturnValue(of([firstVisitEvent, secondVisitEvent]));
      mockTripDetectionService.detectTrips.mockReturnValue([
        {
          tripId: 'trip-nepal-1',
          destinationId: 'destination-nepal',
          destinationVisitIndex: 1,
          destinationVisitCount: 2,
          isRevisit: false,
          startDate: new Date('2024-11-08T08:00:00Z'),
          endDate: new Date('2024-11-09T10:00:00Z'),
          activityCount: 2,
          centroidLat: 27.7172,
          centroidLng: 85.3240,
          bounds: {
            west: 85.20,
            east: 85.40,
            south: 27.60,
            north: 27.80,
          },
        },
        {
          tripId: 'trip-nepal-2',
          destinationId: 'destination-nepal',
          destinationVisitIndex: 2,
          destinationVisitCount: 2,
          isRevisit: true,
          startDate: new Date('2024-11-16T08:00:00Z'),
          endDate: new Date('2024-11-17T10:00:00Z'),
          activityCount: 2,
          centroidLat: 27.7201,
          centroidLng: 85.3301,
          bounds: {
            west: 85.22,
            east: 85.45,
            south: 27.61,
            north: 27.82,
          },
        },
      ]);
      mockTripLocationLabelService.resolveTripLocation.mockResolvedValue({
        city: 'Kathmandu',
        country: 'Nepal',
        label: 'Kathmandu, Nepal',
      });

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockTripLocationLabelService.resolveTripLocation).toHaveBeenCalledTimes(2);
      expect(component.detectedTrips().map((trip) => trip.locationLabel)).toEqual(['Kathmandu, Nepal', 'Kathmandu, Nepal']);
    });

    it('falls back to "Trip" when location label resolution returns null', () => {
      component.detectedTrips.set([createDetectedTrip({ locationLabel: null }) as any]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const locationLabel = fixture.nativeElement.querySelector('.trip-location') as HTMLElement | null;
      expect(locationLabel?.textContent?.trim()).toBe('Trip');
    });

    it('should recompute suggestions when date range changes', async () => {
      const rangeAEvent = createMockEvent('range-a-event', '2024-02-01T08:00:00Z', 40.6401, 22.9444);
      const rangeBEvent = createMockEvent('range-b-event', '2024-04-13T08:00:00Z', 38.4237, 27.1428);

      mockEventService.getEventsBy
        .mockReturnValueOnce(of([rangeAEvent]))
        .mockReturnValueOnce(of([rangeBEvent]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisWeek, [ActivityTypes.Running]);
      await waitForAsyncWork();

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.lastMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockTripDetectionService.detectTrips).toHaveBeenCalledTimes(2);
      expect(mockTripDetectionService.detectTrips.mock.calls[0][0]).toEqual([
        expect.objectContaining({ eventId: 'range-a-event' })
      ]);
      expect(mockTripDetectionService.detectTrips.mock.calls[1][0]).toEqual([
        expect.objectContaining({ eventId: 'range-b-event' })
      ]);
    });

    it('should fit bounds when a detected trip is clicked without changing settings', () => {
      const fitBoundsSpy = vi.spyOn(component as any, 'fitBoundsToTracks');
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const beforeCalls = mockUserSettingsQuery.updateMyTracksSettings.mock.calls.length;
      const tripButton = fixture.nativeElement.querySelector('.detected-trip-button') as HTMLButtonElement | null;
      tripButton?.click();

      expect(fitBoundsSpy).toHaveBeenCalledWith([[84.9, 27.5], [85.6, 28]]);
      expect(mockUserSettingsQuery.updateMyTracksSettings.mock.calls.length).toBe(beforeCalls);
    });

    it('should fit bounds using trip event track coordinates when available', () => {
      const fitBoundsSpy = vi.spyOn(component as any, 'fitBoundsToTracks');
      (component as any).trackCoordinatesByEventId.set('event-1', [[85, 27.7], [85.2, 27.8]]);
      (component as any).trackCoordinatesByEventId.set('event-2', [[85.3, 27.81], [85.5, 27.9]]);
      component.detectedTrips.set([createDetectedTrip({ eventIds: ['event-1', 'event-2'] }) as any]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripButton = fixture.nativeElement.querySelector('.detected-trip-button') as HTMLButtonElement | null;
      tripButton?.click();

      expect(fitBoundsSpy).toHaveBeenCalledWith([
        [85, 27.7],
        [85.2, 27.8],
        [85.3, 27.81],
        [85.5, 27.9],
      ]);
    });
  });
});
