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
import { ActivityTypes, AppThemes, DataStartPosition, DateRanges } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from '@angular/cdk/overlay';
import { MaterialModule } from '../../modules/material.module';
import { MyTracksTripDetectionService } from '../../services/my-tracks-trip-detection.service';
import { TripLocationLabelService } from '../../services/trip-location-label.service';
import { PeekPanelComponent } from '../shared/peek-panel/peek-panel.component';

const waitForAsyncWork = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

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
    settings: {
      myTracksSettings: {
        dateRange: DateRanges.thisWeek,
        is3D: true,
        activityTypes: []
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
      adjustColorForTheme: vi.fn().mockReturnValue('#ffffff'),
      createSynchronizer: vi.fn().mockReturnValue({
        update: vi.fn()
      })
    };

    mockUserSettingsQuery = {
      myTracksSettings: signal({
        dateRange: DateRanges.thisWeek,
        is3D: true,
        activityTypes: []
      }),
      updateMyTracksSettings: vi.fn()
    };

    mockTripDetectionService = {
      detectTrips: vi.fn().mockReturnValue([])
    };

    mockTripLocationLabelService = {
      resolveCountryName: vi.fn().mockResolvedValue(null)
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
  });

  describe('Trip detection suggestions', () => {
    it('renders both peek panels when user and trip evaluation state are available', () => {
      component.user = mockUser as any;
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const searchPanel = fixture.nativeElement.querySelector('app-peek-panel.tracks-search-peek');
      const tripsPanel = fixture.nativeElement.querySelector('app-peek-panel.tracks-trips-peek');
      expect(searchPanel).not.toBeNull();
      expect(tripsPanel).not.toBeNull();
    });

    it('toggles detected-trips panel state without changing settings', () => {
      component.hasEvaluatedTripDetection.set(true);
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
      mockTripLocationLabelService.resolveCountryName.mockResolvedValue('Nepal');

      await (component as any).loadTracksMapForUserByDateRange(mockUser, DateRanges.thisMonth, [ActivityTypes.Running]);
      await waitForAsyncWork();

      expect(mockTripDetectionService.detectTrips).toHaveBeenCalledTimes(1);
      expect(mockTripDetectionService.detectTrips.mock.calls[0][0]).toEqual([
        expect.objectContaining({ eventId: 'trip-nepal-1' })
      ]);
      expect(component.detectedTrips()[0].locationLabel).toBe('Nepal');
      expect(component.hasEvaluatedTripDetection()).toBe(true);
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
      component.detectedTrips.set([
        {
          tripId: 'trip-id',
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
          }
        }
      ]);
      component.hasEvaluatedTripDetection.set(true);
      fixture.detectChanges();

      const beforeCalls = mockUserSettingsQuery.updateMyTracksSettings.mock.calls.length;
      const tripButton = fixture.nativeElement.querySelector('.detected-trip-button') as HTMLButtonElement | null;
      tripButton?.click();

      expect(fitBoundsSpy).toHaveBeenCalledWith([[84.9, 27.5], [85.6, 28]]);
      expect(mockUserSettingsQuery.updateMyTracksSettings.mock.calls.length).toBe(beforeCalls);
    });
  });
});
