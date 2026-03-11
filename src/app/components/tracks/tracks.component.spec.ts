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
import { PolylineSimplificationService } from '../../services/polyline-simplification.service';
import { of, Subject } from 'rxjs';
import { ActivityTypes, AppThemes, DataPaceAvg, DataSpeedAvg, DataStartPosition, DateRanges } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from '@angular/cdk/overlay';
import { MaterialModule } from '../../modules/material.module';
import { MyTracksTripDetectionService } from '../../services/my-tracks-trip-detection.service';
import { MyTracksPolylineCacheService } from '../../services/my-tracks-polyline-cache.service';
import { TripLocationLabelService } from '../../services/trip-location-label.service';
import { PeekPanelComponent } from '../shared/peek-panel/peek-panel.component';
import { MapboxAutoResizeService } from '../../services/map/mapbox-auto-resize.service';
import { MapLayersActionsComponent } from '../map/map-layers-actions/map-layers-actions.component';
import { By } from '@angular/platform-browser';

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

const createTripDetectionResult = (overrides: {
  trips?: any[];
  homeArea?: any | null;
} = {}) => ({
  trips: overrides.trips || [],
  homeArea: overrides.homeArea ?? null,
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
  let mockPolylineSimplificationService: any;
  let mockMyTracksPolylineCacheService: any;

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
      getPitch: vi.fn().mockReturnValue(0),
      getBearing: vi.fn().mockReturnValue(0),
      fitBounds: vi.fn(),
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
        ScaleControl: class { },
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
      getEventsOnceBy: vi.fn().mockImplementation((...args: any[]) => mockEventService.getEventsBy(...args)),
      getActivities: vi.fn().mockReturnValue(of([])),
      getActivitiesOnceByEvent: vi.fn().mockImplementation((...args: any[]) => mockEventService.getActivities(...args)),
      getActivitiesOnceByEventWithOptions: vi.fn().mockImplementation((...args: any[]) => mockEventService.getActivities(...args)),
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
      detectTrips: vi.fn().mockReturnValue([]),
      detectTripsWithContext: vi.fn().mockReturnValue(createTripDetectionResult())
    };

    mockTripLocationLabelService = {
      resolveTripLocation: vi.fn().mockResolvedValue(null),
      resolveTripLocationFromCandidates: vi.fn().mockResolvedValue(null),
      resolveCountryName: vi.fn().mockResolvedValue(null),
    };

    mockPolylineSimplificationService = {
      simplifyVisvalingamWhyatt: vi.fn().mockImplementation((coordinates: number[][]) => ({
        coordinates,
        inputPointCount: coordinates?.length || 0,
        outputPointCount: coordinates?.length || 0,
        simplified: false
      }))
    };

    mockMyTracksPolylineCacheService = {
      resolveEventCacheKey: vi.fn().mockResolvedValue(null),
      getEventPolylines: vi.fn().mockResolvedValue(undefined),
      setEventPolylines: vi.fn().mockResolvedValue(undefined),
      hasMatchingActivityIdentity: vi.fn().mockImplementation((activities: any[], cached: any) => {
        if (!cached) {
          return false;
        }

        const signature = (activities || []).map((activity: any, activityIndex: number) => {
          const activityId = activity?.getID?.();
          if (activityId) {
            return `id:${activityId}`;
          }

          const activityType = typeof activity?.type === 'string' && activity.type.trim().length > 0
            ? activity.type
            : 'unknown';
          return `idx:${activityIndex}:type:${activityType}`;
        });

        return cached.activityCount === signature.length
          && Array.isArray(cached.activityIdentitySignature)
          && cached.activityIdentitySignature.length === signature.length
          && cached.activityIdentitySignature.every((entry: string, index: number) => entry === signature[index]);
      }),
      extractTrackPolylines: vi.fn().mockImplementation((activities: any[]) => ({
        activityCount: activities?.length || 0,
        activityIdentitySignature: (activities || []).map((activity: any, activityIndex: number) => {
          const activityId = activity?.getID?.();
          if (activityId) {
            return `id:${activityId}`;
          }

          const activityType = typeof activity?.type === 'string' && activity.type.trim().length > 0
            ? activity.type
            : 'unknown';
          return `idx:${activityIndex}:type:${activityType}`;
        }),
        trackActivities: (activities || []).reduce((acc: any[], activity: any, activityIndex: number) => {
          if (!activity?.hasPositionData?.()) {
            return acc;
          }
          const coordinates = (activity.getPositionData?.() || []).map((position: any) => [
            position.longitudeDegrees,
            position.latitudeDegrees,
          ]);
          if (coordinates.length <= 1) {
            return acc;
          }
          acc.push({
            activityId: activity.getID?.() || null,
            activityIndex,
            coordinates,
          });
          return acc;
        }, []),
      })),
      resolveTrackPolylines: vi.fn().mockImplementation((activities: any[], cached: any) => (
        (cached?.trackActivities || []).map((trackActivity: any) => ({
          activity: activities[trackActivity.activityIndex],
          activityIndex: trackActivity.activityIndex,
          coordinates: trackActivity.coordinates,
        }))
      )),
    };

    await TestBed.configureTestingModule({
      declarations: [TracksComponent, PeekPanelComponent, MapLayersActionsComponent],
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
        { provide: PolylineSimplificationService, useValue: mockPolylineSimplificationService },
        { provide: MyTracksPolylineCacheService, useValue: mockMyTracksPolylineCacheService },
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

      expect(mockEventService.getEventsOnceBy).not.toHaveBeenCalled();
      expect(mockEventService.getEventsBy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('[TracksComponent] Skipping track load because user is undefined.');
    });

    it('should use one-hour metadata cache TTL when hydrating streams for myTracks', async () => {
      const event = createMockEvent('hydration-cache-event', '2024-11-08T08:00:00Z', 40.64, 22.94);
      mockEventService.getEventsBy.mockReturnValue(of([event]));
      mockMyTracksPolylineCacheService.resolveEventCacheKey.mockResolvedValue('event-cache-key');

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockEventService.getActivitiesOnceByEventWithOptions).toHaveBeenCalledWith(
        mockUser,
        'hydration-cache-event',
        { preferCache: true, warmServer: false },
      );
      expect(mockMyTracksPolylineCacheService.resolveEventCacheKey).toHaveBeenCalledWith(
        expect.anything(),
        { metadataCacheTtlMs: 60 * 60 * 1000 },
      );
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

    it('should reuse cached track polylines and skip stream hydration on cache hit', async () => {
      const cachedActivity = {
        getID: () => 'activity-1',
        type: ActivityTypes.Running,
        hasPositionData: () => false,
        getPositionData: () => [],
      };
      const event = createMockEvent('cached-track-event', '2024-11-08T08:00:00Z', 40.64, 22.94);
      (event as any).getActivities = () => [cachedActivity];
      mockEventService.getEventsBy.mockReturnValue(of([event]));
      mockEventService.getActivities.mockReturnValue(of([cachedActivity]));
      mockMyTracksPolylineCacheService.resolveEventCacheKey.mockResolvedValue('event-cache-key');
      mockMyTracksPolylineCacheService.getEventPolylines.mockResolvedValue({
        activityCount: 1,
        activityIdentitySignature: ['id:activity-1'],
        trackActivities: [
          {
            activityId: 'activity-1',
            activityIndex: 0,
            coordinates: [[22.94, 40.64], [22.95, 40.65]],
          },
        ],
      });
      mockMyTracksPolylineCacheService.resolveTrackPolylines.mockReturnValue([
        {
          activity: cachedActivity,
          activityIndex: 0,
          coordinates: [[22.94, 40.64], [22.95, 40.65]],
        },
      ]);

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockEventService.attachStreamsToEventWithActivities).not.toHaveBeenCalled();
      expect(mockPolylineSimplificationService.simplifyVisvalingamWhyatt).toHaveBeenCalledWith(
        [[22.94, 40.64], [22.95, 40.65]],
        expect.anything(),
      );
    });

    it('should persist derived track polylines after hydrating a cache miss', async () => {
      const hydratedActivity = {
        getID: () => 'hydrated-activity-1',
        type: ActivityTypes.Running,
        hasPositionData: () => true,
        getPositionData: () => [
          { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
          { latitudeDegrees: 40.65, longitudeDegrees: 22.95 },
        ],
      };
      const sourceActivity = {
        getID: () => 'hydrated-activity-1',
        type: ActivityTypes.Running,
        hasPositionData: () => false,
        getPositionData: () => [],
      };
      const event = createMockEvent('cache-miss-event', '2024-11-08T08:00:00Z', 40.64, 22.94);
      (event as any).getActivities = () => [sourceActivity];
      const hydratedEvent = {
        ...event,
        getActivities: () => [hydratedActivity],
      };

      mockEventService.getEventsBy.mockReturnValue(of([event]));
      mockEventService.getActivities.mockReturnValue(of([sourceActivity]));
      mockEventService.attachStreamsToEventWithActivities.mockReturnValue(of(hydratedEvent));
      mockMyTracksPolylineCacheService.resolveEventCacheKey.mockResolvedValue('event-cache-key');
      mockMyTracksPolylineCacheService.getEventPolylines.mockResolvedValue(undefined);
      mockMyTracksPolylineCacheService.extractTrackPolylines.mockReturnValue({
        activityCount: 1,
        activityIdentitySignature: ['id:hydrated-activity-1'],
        trackActivities: [
          {
            activityId: 'hydrated-activity-1',
            activityIndex: 0,
            coordinates: [[22.94, 40.64], [22.95, 40.65]],
          },
        ],
      });
      mockMyTracksPolylineCacheService.resolveTrackPolylines.mockReturnValue([
        {
          activity: hydratedActivity,
          activityIndex: 0,
          coordinates: [[22.94, 40.64], [22.95, 40.65]],
        },
      ]);

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockEventService.attachStreamsToEventWithActivities).toHaveBeenCalledTimes(1);
      expect(mockMyTracksPolylineCacheService.extractTrackPolylines).toHaveBeenCalledWith([hydratedActivity]);
      expect(mockMyTracksPolylineCacheService.setEventPolylines).toHaveBeenCalledWith('event-cache-key', {
        activityCount: 1,
        activityIdentitySignature: ['id:hydrated-activity-1'],
        trackActivities: [
          {
            activityId: 'hydrated-activity-1',
            activityIndex: 0,
            coordinates: [[22.94, 40.64], [22.95, 40.65]],
          },
        ],
      });
    });

    it('should ignore cached track polylines when activity identities changed with the same count', async () => {
      const currentActivity = {
        getID: () => 'activity-current',
        type: ActivityTypes.Running,
        hasPositionData: () => false,
        getPositionData: () => [],
      };
      const hydratedActivity = {
        getID: () => 'activity-current',
        type: ActivityTypes.Running,
        hasPositionData: () => true,
        getPositionData: () => [
          { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
          { latitudeDegrees: 40.65, longitudeDegrees: 22.95 },
        ],
      };
      const event = createMockEvent('stale-cache-event', '2024-11-08T08:00:00Z', 40.64, 22.94);
      (event as any).getActivities = () => [currentActivity];
      const hydratedEvent = {
        ...event,
        getActivities: () => [hydratedActivity],
      };

      mockEventService.getEventsBy.mockReturnValue(of([event]));
      mockEventService.getActivities.mockReturnValue(of([currentActivity]));
      mockEventService.attachStreamsToEventWithActivities.mockReturnValue(of(hydratedEvent));
      mockMyTracksPolylineCacheService.resolveEventCacheKey.mockResolvedValue('event-cache-key');
      mockMyTracksPolylineCacheService.getEventPolylines.mockResolvedValue({
        activityCount: 1,
        activityIdentitySignature: ['id:activity-stale'],
        trackActivities: [
          {
            activityId: 'activity-stale',
            activityIndex: 0,
            coordinates: [[22.9, 40.6], [22.95, 40.65]],
          },
        ],
      });

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockMyTracksPolylineCacheService.hasMatchingActivityIdentity).toHaveBeenCalledWith(
        [currentActivity],
        expect.objectContaining({
          activityIdentitySignature: ['id:activity-stale'],
        }),
      );
      expect(mockEventService.attachStreamsToEventWithActivities).toHaveBeenCalledTimes(1);
      expect(mockMyTracksPolylineCacheService.setEventPolylines).toHaveBeenCalledWith('event-cache-key', expect.objectContaining({
        activityIdentitySignature: ['id:activity-current'],
      }));
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

    it('should persist 3d toggle under mapSettings', async () => {
      component.onMyTracks3DToggle(true);
      expect(mockUserSettingsQuery.updateMapSettings).toHaveBeenCalledWith({ is3D: true });
    });

    it('should persist jump heatmap setting when toggled', () => {
      component.onShowJumpHeatmapToggle(false);

      expect(mockUserSettingsQuery.updateMyTracksSettings).toHaveBeenCalledWith({ showJumpHeatmap: false });
    });

    it('should always expose jump heatmap toggle in layers menu', () => {
      let layersActions = fixture.debugElement.query(By.directive(MapLayersActionsComponent)).componentInstance as MapLayersActionsComponent;
      component.hasDetectedJumps.set(false);
      fixture.detectChanges();
      expect(layersActions.enableJumpHeatmapToggle).toBe(true);

      component.hasDetectedJumps.set(true);
      fixture.detectChanges();
      layersActions = fixture.debugElement.query(By.directive(MapLayersActionsComponent)).componentInstance as MapLayersActionsComponent;
      expect(layersActions.enableJumpHeatmapToggle).toBe(true);
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

    it('should use simplified coordinates for track rendering when simplification service returns reduced output', async () => {
      const trackManager = (component as any).tracksMapManager;
      const setTracksFromPreparedSpy = vi.spyOn(trackManager, 'setTracksFromPrepared');
      const eventId = 'simplify-render-event-1';
      const rawCoordinates: [number, number][] = [
        [22.94, 40.64],
        [22.941, 40.641],
        [22.942, 40.642],
        [22.943, 40.643],
        [22.944, 40.644],
        [22.945, 40.645],
      ];
      const simplifiedCoordinates: [number, number][] = [
        rawCoordinates[0],
        rawCoordinates[2],
        rawCoordinates[5],
      ];

      mockPolylineSimplificationService.simplifyVisvalingamWhyatt.mockReturnValue({
        coordinates: simplifiedCoordinates,
        inputPointCount: rawCoordinates.length,
        outputPointCount: simplifiedCoordinates.length,
        simplified: true
      });

      const activity = {
        type: ActivityTypes.Running,
        getID: () => 'activity-simplify-render-1',
        hasPositionData: () => true,
        getPositionData: () => rawCoordinates.map(([longitudeDegrees, latitudeDegrees]) => ({
          longitudeDegrees,
          latitudeDegrees,
        })),
        getDuration: () => ({ getDisplayValue: () => '00:30:00' }),
        getDistance: () => ({ getDisplayValue: () => '5.0', getDisplayUnit: () => 'km' }),
        getStat: () => null,
        getAllEvents: () => []
      };

      const event = createMockEvent(eventId, '2024-11-08T08:00:00Z', 40.64, 22.94);
      (event as any).getActivities = () => [activity];
      mockEventService.getEventsBy.mockReturnValue(of([event]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockPolylineSimplificationService.simplifyVisvalingamWhyatt).toHaveBeenCalled();
      expect(setTracksFromPreparedSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          activity,
          coordinates: simplifiedCoordinates,
        })
      ]);
    });

    it('should store simplified coordinates for event-based fit-bounds paths', async () => {
      const eventId = 'simplify-bounds-event-1';
      const rawCoordinates: [number, number][] = [
        [22.95, 40.65],
        [22.951, 40.651],
        [22.952, 40.652],
        [22.953, 40.653],
      ];
      const simplifiedCoordinates: [number, number][] = [
        rawCoordinates[0],
        rawCoordinates[3],
      ];

      mockPolylineSimplificationService.simplifyVisvalingamWhyatt.mockReturnValue({
        coordinates: simplifiedCoordinates,
        inputPointCount: rawCoordinates.length,
        outputPointCount: simplifiedCoordinates.length,
        simplified: true
      });

      const activity = {
        type: ActivityTypes.Running,
        getID: () => 'activity-simplify-bounds-1',
        hasPositionData: () => true,
        getPositionData: () => rawCoordinates.map(([longitudeDegrees, latitudeDegrees]) => ({
          longitudeDegrees,
          latitudeDegrees,
        })),
        getDuration: () => ({ getDisplayValue: () => '00:30:00' }),
        getDistance: () => ({ getDisplayValue: () => '5.0', getDisplayUnit: () => 'km' }),
        getStat: () => null,
        getAllEvents: () => []
      };

      const event = createMockEvent(eventId, '2024-11-09T08:00:00Z', 40.65, 22.95);
      (event as any).getActivities = () => [activity];
      mockEventService.getEventsBy.mockReturnValue(of([event]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect((component as any).trackCoordinatesByEventId.get(eventId)).toEqual(simplifiedCoordinates);
    });

    it('should fall back to original coordinates when simplification result is unsimplified', async () => {
      const trackManager = (component as any).tracksMapManager;
      const setTracksFromPreparedSpy = vi.spyOn(trackManager, 'setTracksFromPrepared');
      const eventId = 'simplify-fallback-event-1';
      const rawCoordinates: [number, number][] = [
        [22.96, 40.66],
        [22.961, 40.661],
        [22.962, 40.662],
      ];

      mockPolylineSimplificationService.simplifyVisvalingamWhyatt.mockReturnValue({
        coordinates: rawCoordinates,
        inputPointCount: rawCoordinates.length,
        outputPointCount: rawCoordinates.length,
        simplified: false
      });

      const activity = {
        type: ActivityTypes.Running,
        getID: () => 'activity-simplify-fallback-1',
        hasPositionData: () => true,
        getPositionData: () => rawCoordinates.map(([longitudeDegrees, latitudeDegrees]) => ({
          longitudeDegrees,
          latitudeDegrees,
        })),
        getDuration: () => ({ getDisplayValue: () => '00:30:00' }),
        getDistance: () => ({ getDisplayValue: () => '5.0', getDisplayUnit: () => 'km' }),
        getStat: () => null,
        getAllEvents: () => []
      };

      const event = createMockEvent(eventId, '2024-11-10T08:00:00Z', 40.66, 22.96);
      (event as any).getActivities = () => [activity];
      mockEventService.getEventsBy.mockReturnValue(of([event]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(setTracksFromPreparedSpy).toHaveBeenCalledWith([
        expect.objectContaining({
          activity,
          coordinates: rawCoordinates,
        })
      ]);
      expect((component as any).trackCoordinatesByEventId.get(eventId)).toEqual(rawCoordinates);
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

    it('should not apply stale jump heatmap data when a newer load starts', async () => {
      const trackManager = (component as any).tracksMapManager;
      const setJumpHeatPointsSpy = vi.spyOn(trackManager, 'setJumpHeatPoints');

      const slowHydrationSubject = new Subject<any>();
      const eventAActivity = {
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
        }],
        getDuration: () => ({ getDisplayValue: () => '00:40:00' }),
        getDistance: () => ({ getDisplayValue: () => '7.0', getDisplayUnit: () => 'km' }),
        getID: () => 'activity-a'
      };
      const eventA = createMockEvent('event-a', '2024-11-08T08:00:00Z', 40.64, 22.94);
      (eventA as any).getActivities = () => [eventAActivity];

      const eventB = createMockEvent('event-b', '2024-11-09T08:00:00Z', 40.66, 22.96);
      (eventB as any).getActivities = () => [];

      let eventsCallCount = 0;
      mockEventService.getEventsBy.mockImplementation(() => {
        eventsCallCount += 1;
        if (eventsCallCount === 1) {
          return of([eventA]);
        }
        return of([eventB]);
      });

      mockEventService.getActivities.mockImplementation((_user: any, eventId: string) => {
        if (eventId === 'event-a') return of([eventAActivity]);
        return of([]);
      });

      mockEventService.attachStreamsToEventWithActivities.mockImplementation((_user: any, event: any) => {
        if (event.getID?.() === 'event-a') {
          return slowHydrationSubject.asObservable();
        }
        return of(eventB as any);
      });

      const firstLoad = (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.lastMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      slowHydrationSubject.next(eventA as any);
      slowHydrationSubject.complete();
      await firstLoad;
      await waitForAsyncWork();

      expect(setJumpHeatPointsSpy).toHaveBeenCalledTimes(0);
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
      expect(mockMap.easeTo).toHaveBeenCalledWith(expect.objectContaining({
        center: [10, 20],
        essential: true,
        animate: true
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
      (event as any).getDuration = () => ({ getType: () => 'DataDuration', getDisplayValue: (..._args: any[]) => '00:45:00', getDisplayUnit: () => '' });
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
        expect.objectContaining({ value: '00:45:00', label: 'Duration' }),
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

    it('hides trips peek panel when no trips and no home area are detected', () => {
      component.user = mockUser as any;
      component.detectedTrips.set([]);
      component.detectedHomeArea.set(null);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripsPanel = fixture.nativeElement.querySelector('app-peek-panel.tracks-trips-peek');
      expect(tripsPanel).toBeNull();
    });

    it('renders trips peek panel when only a home area is detected', () => {
      component.user = mockUser as any;
      component.detectedTrips.set([]);
      component.detectedHomeArea.set({
        destinationId: 'destination-home',
        pointCount: 5,
        pointShare: 0.6,
        centroidLat: 37.9838,
        centroidLng: 23.7275,
        bounds: {
          west: 23.71,
          east: 23.74,
          south: 37.97,
          north: 38.0,
        },
        radiusKm: 3.2,
      });
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripsPanel = fixture.nativeElement.querySelector('app-peek-panel.tracks-trips-peek');
      const tripButtons = fixture.nativeElement.querySelectorAll('.detected-trip-button') as NodeListOf<HTMLButtonElement>;
      expect(tripsPanel).not.toBeNull();
      expect(tripButtons.length).toBe(1);
      expect(tripButtons[0]?.textContent).toContain('Home');
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
      const homeEvent = createMockEvent('home-athens-1', '2024-08-08T08:00:00Z', 37.9838, 23.7275);
      const setHomeAreaSpy = vi.spyOn((component as any).tracksMapManager, 'setHomeArea');
      mockEventService.getEventsBy
        .mockReturnValueOnce(of([event]))
        .mockReturnValueOnce(of([homeEvent]));
      mockTripDetectionService.detectTripsWithContext.mockReturnValue(createTripDetectionResult({
        trips: [{
          tripId: 'trip-nepal',
          destinationId: 'destination-nepal',
          destinationVisitIndex: 1,
          destinationVisitCount: 1,
          isRevisit: false,
          eventIds: ['trip-nepal-1'],
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
        }],
        homeArea: {
          destinationId: 'destination-home',
          pointCount: 5,
          pointShare: 0.62,
          centroidLat: 37.9838,
          centroidLng: 23.7275,
          bounds: {
            west: 23.71,
            east: 23.74,
            south: 37.97,
            north: 38.0,
          },
          radiusKm: 3.2,
        },
      }));
      mockTripLocationLabelService.resolveTripLocationFromCandidates.mockResolvedValue({
        city: 'Kathmandu',
        country: 'Nepal',
        label: 'Kathmandu, Nepal',
      });

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockTripDetectionService.detectTripsWithContext).toHaveBeenCalledTimes(1);
      expect(mockTripDetectionService.detectTripsWithContext.mock.calls[0][0]).toEqual([
        expect.objectContaining({ eventId: 'trip-nepal-1' })
      ]);
      expect(mockTripDetectionService.detectTripsWithContext.mock.calls[0][1]).toEqual({
        homeInferenceInputs: [
          expect.objectContaining({ eventId: 'home-athens-1' })
        ]
      });
      expect(mockTripLocationLabelService.resolveTripLocationFromCandidates).toHaveBeenCalledWith([
        { latitudeDegrees: 27.7172, longitudeDegrees: 85.3240 }
      ]);
      expect(mockTripLocationLabelService.resolveTripLocation).not.toHaveBeenCalled();
      expect(setHomeAreaSpy).toHaveBeenCalledWith(expect.objectContaining({
        destinationId: 'destination-home',
        radiusKm: 3.2,
      }));
      expect(component.detectedTrips().length).toBe(1);
      expect(component.detectedTripsPanelExpanded()).toBe(true);
      expect(component.detectedTrips()[0].locationLabel).toBe('Kathmandu, Nepal');
      expect(component.hasEvaluatedTripDetection()).toBe(true);
    });

    it('resolves location labels per trip for revisits that share a destination id', async () => {
      const firstVisitEvent = createMockEvent('trip-nepal-visit-1', '2024-11-08T08:00:00Z', 27.7172, 85.3240);
      const secondVisitEvent = createMockEvent('trip-nepal-visit-2', '2024-11-16T08:00:00Z', 27.7201, 85.3301);
      mockEventService.getEventsBy.mockReturnValue(of([firstVisitEvent, secondVisitEvent]));
      mockTripDetectionService.detectTripsWithContext.mockReturnValue(createTripDetectionResult({
        trips: [
          {
            tripId: 'trip-nepal-1',
            destinationId: 'destination-nepal',
            destinationVisitIndex: 1,
            destinationVisitCount: 2,
            isRevisit: false,
            eventIds: ['trip-nepal-visit-1'],
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
            eventIds: ['trip-nepal-visit-2'],
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
        ],
      }));
      mockTripLocationLabelService.resolveTripLocationFromCandidates
        .mockResolvedValueOnce({
          city: 'Ano Chora',
          country: 'Greece',
          label: 'Ano Chora, Greece',
        })
        .mockResolvedValueOnce({
          city: 'Patras',
          country: 'Greece',
          label: 'Patras, Greece',
        });

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockTripLocationLabelService.resolveTripLocationFromCandidates).toHaveBeenCalledTimes(2);
      expect(mockTripLocationLabelService.resolveTripLocationFromCandidates).toHaveBeenNthCalledWith(1, [
        { latitudeDegrees: 27.7172, longitudeDegrees: 85.3240 },
      ]);
      expect(mockTripLocationLabelService.resolveTripLocationFromCandidates).toHaveBeenNthCalledWith(2, [
        { latitudeDegrees: 27.7201, longitudeDegrees: 85.3301 },
      ]);
      expect(mockTripLocationLabelService.resolveTripLocation).not.toHaveBeenCalled();
      expect(component.detectedTrips().map((trip) => trip.locationLabel)).toEqual(['Ano Chora, Greece', 'Patras, Greece']);
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
        .mockReturnValueOnce(of([createMockEvent('range-a-home', '2024-01-20T08:00:00Z', 37.98, 23.72)]))
        .mockReturnValueOnce(of([rangeBEvent]))
        .mockReturnValueOnce(of([createMockEvent('range-b-home', '2024-03-20T08:00:00Z', 37.98, 23.72)]));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisWeek, [ActivityTypes.Running]);
      await waitForAsyncWork();

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.lastMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockTripDetectionService.detectTripsWithContext).toHaveBeenCalledTimes(2);
      expect(mockTripDetectionService.detectTripsWithContext.mock.calls[0][0]).toEqual([
        expect.objectContaining({ eventId: 'range-a-event' })
      ]);
      expect(mockTripDetectionService.detectTripsWithContext.mock.calls[0][1]).toEqual({
        homeInferenceInputs: [
          expect.objectContaining({ eventId: 'range-a-home' })
        ]
      });
      expect(mockTripDetectionService.detectTripsWithContext.mock.calls[1][0]).toEqual([
        expect.objectContaining({ eventId: 'range-b-event' })
      ]);
      expect(mockTripDetectionService.detectTripsWithContext.mock.calls[1][1]).toEqual({
        homeInferenceInputs: [
          expect.objectContaining({ eventId: 'range-b-home' })
        ]
      });
    });

    it('should reuse current candidates for home inference on DateRanges.all without an extra history query', async () => {
      const event = createMockEvent('trip-all-1', '2024-11-08T08:00:00Z', 27.7172, 85.3240);
      mockEventService.getEventsBy.mockReturnValue(of([event]));
      mockTripDetectionService.detectTripsWithContext.mockReturnValue(createTripDetectionResult({
        trips: [
          {
            tripId: 'trip-all',
            destinationId: 'destination-all',
            destinationVisitIndex: 1,
            destinationVisitCount: 1,
            isRevisit: false,
            eventIds: ['trip-all-1'],
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
        ],
      }));

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.all, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockEventService.getEventsOnceBy).toHaveBeenCalledTimes(1);
      expect(mockTripDetectionService.detectTripsWithContext).toHaveBeenCalledWith([
        expect.objectContaining({ eventId: 'trip-all-1' })
      ], {
        homeInferenceInputs: [
          expect.objectContaining({ eventId: 'trip-all-1' })
        ]
      });
    });

    it('should fit bounds when a detected trip is clicked without changing settings', () => {
      const fitBoundsSpy = vi.spyOn(component as any, 'fitBoundsToTracks');
      const setTripAreaSpy = vi.spyOn((component as any).tracksMapManager, 'setTripArea');
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const beforeCalls = mockUserSettingsQuery.updateMyTracksSettings.mock.calls.length;
      const tripButton = fixture.nativeElement.querySelector('.detected-trip-button') as HTMLButtonElement | null;
      tripButton?.click();

      expect(fitBoundsSpy).toHaveBeenCalledWith([[84.9, 27.5], [85.6, 28]]);
      expect(setTripAreaSpy).toHaveBeenCalledWith(expect.objectContaining({
        tripId: 'trip-id',
      }));
      expect(component.selectedDetectedTripId()).toBe('trip-id');
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

    it('should render a home entry above the trip list when a home area exists', () => {
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.detectedHomeArea.set({
        destinationId: 'destination-home',
        pointCount: 5,
        pointShare: 0.6,
        centroidLat: 37.9838,
        centroidLng: 23.7275,
        bounds: {
          west: 23.71,
          east: 23.74,
          south: 37.97,
          north: 38.0,
        },
        radiusKm: 3.2,
      });
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripButtons = fixture.nativeElement.querySelectorAll('.detected-trip-button') as NodeListOf<HTMLButtonElement>;
      expect(tripButtons[0]?.textContent).toContain('Home');
      expect(tripButtons[1]?.textContent).toContain('Nepal');
    });

    it('should select home from the peek card and clear the trip area overlay', () => {
      const fitBoundsSpy = vi.spyOn(component as any, 'fitBoundsToTracks');
      const setTripAreaSpy = vi.spyOn((component as any).tracksMapManager, 'setTripArea');
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.detectedHomeArea.set({
        destinationId: 'destination-home',
        pointCount: 5,
        pointShare: 0.6,
        centroidLat: 37.9838,
        centroidLng: 23.7275,
        bounds: {
          west: 23.71,
          east: 23.74,
          south: 37.97,
          north: 38.0,
        },
        radiusKm: 3.2,
      });
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripButtons = fixture.debugElement.queryAll(By.css('.detected-trip-button'));
      tripButtons[1]?.triggerEventHandler('click');
      tripButtons[0]?.triggerEventHandler('click');
      fixture.detectChanges();
      const updatedTripButtons = fixture.nativeElement.querySelectorAll('.detected-trip-button') as NodeListOf<HTMLButtonElement>;

      expect(fitBoundsSpy).toHaveBeenLastCalledWith([
        [23.71, 37.97],
        [23.74, 38.0],
      ]);
      expect(setTripAreaSpy).toHaveBeenLastCalledWith(null);
      expect(component.isHomeEntrySelected()).toBe(true);
      expect(updatedTripButtons[0]?.classList.contains('is-selected')).toBe(true);
      expect(updatedTripButtons[1]?.classList.contains('is-selected')).toBe(false);
    });

    it('should temporarily clear the selected trip overlay when the home entry is hovered', () => {
      const setTripAreaSpy = vi.spyOn((component as any).tracksMapManager, 'setTripArea');
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.detectedHomeArea.set({
        destinationId: 'destination-home',
        pointCount: 5,
        pointShare: 0.6,
        centroidLat: 37.9838,
        centroidLng: 23.7275,
        bounds: {
          west: 23.71,
          east: 23.74,
          south: 37.97,
          north: 38.0,
        },
        radiusKm: 3.2,
      });
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripButtons = fixture.nativeElement.querySelectorAll('.detected-trip-button') as NodeListOf<HTMLButtonElement>;
      tripButtons[1]?.click();
      tripButtons[0]?.dispatchEvent(new Event('pointerenter'));
      expect(setTripAreaSpy).toHaveBeenLastCalledWith(null);

      tripButtons[0]?.dispatchEvent(new Event('pointerleave'));
      expect(setTripAreaSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        tripId: 'trip-id',
      }));
    });

    it('should highlight the hovered detected trip area from the peek card', () => {
      const setTripAreaSpy = vi.spyOn((component as any).tracksMapManager, 'setTripArea');
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripButton = fixture.nativeElement.querySelector('.detected-trip-button') as HTMLButtonElement | null;
      tripButton?.dispatchEvent(new Event('pointerenter'));

      expect(component.hoveredDetectedTripId()).toBe('trip-id');
      expect(setTripAreaSpy).toHaveBeenCalledWith(expect.objectContaining({
        tripId: 'trip-id',
        centroidLat: 27.7172,
        centroidLng: 85.324,
      }));
    });

    it('should clear the trip area highlight when hover ends and no trip is selected', () => {
      const setTripAreaSpy = vi.spyOn((component as any).tracksMapManager, 'setTripArea');
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripButton = fixture.nativeElement.querySelector('.detected-trip-button') as HTMLButtonElement | null;
      tripButton?.dispatchEvent(new Event('pointerenter'));
      tripButton?.dispatchEvent(new Event('pointerleave'));

      expect(component.hoveredDetectedTripId()).toBeNull();
      expect(setTripAreaSpy).toHaveBeenLastCalledWith(null);
    });

    it('should keep the selected trip area visible after hover ends', () => {
      const setTripAreaSpy = vi.spyOn((component as any).tracksMapManager, 'setTripArea');
      component.detectedTrips.set([
        createDetectedTrip({
          tripId: 'trip-selected',
          destinationId: 'destination-selected',
          centroidLat: 27.7172,
          centroidLng: 85.3240,
          bounds: {
            west: 85.20,
            east: 85.40,
            south: 27.60,
            north: 27.80,
          },
        }) as any,
        createDetectedTrip({
          tripId: 'trip-hovered',
          destinationId: 'destination-hovered',
          centroidLat: 48.8566,
          centroidLng: 2.3522,
          bounds: {
            west: 2.10,
            east: 2.60,
            south: 48.75,
            north: 48.95,
          },
        }) as any,
      ]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripButtons = fixture.nativeElement.querySelectorAll('.detected-trip-button') as NodeListOf<HTMLButtonElement>;
      tripButtons[0]?.click();
      tripButtons[1]?.dispatchEvent(new Event('pointerenter'));
      tripButtons[1]?.dispatchEvent(new Event('pointerleave'));

      expect(component.selectedDetectedTripId()).toBe('trip-selected');
      expect(component.hoveredDetectedTripId()).toBeNull();
      expect(setTripAreaSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        tripId: 'trip-selected',
        centroidLat: 27.7172,
        centroidLng: 85.324,
      }));
    });

    it('should mark the selected detected trip button', () => {
      component.detectedTrips.set([createDetectedTrip() as any]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const tripButton = fixture.debugElement.query(By.css('.detected-trip-button'));
      tripButton.triggerEventHandler('click');
      fixture.detectChanges();

      expect(tripButton.nativeElement.classList.contains('is-selected')).toBe(true);
      expect(tripButton.attributes['aria-pressed']).toBe('true');
    });
  });
});
