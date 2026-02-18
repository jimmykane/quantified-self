import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventCardMapComponent } from './event.card.map.component';
import { ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA, NgZone, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppActivityCursorService } from '../../../services/activity-cursor/app-activity-cursor.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { AppThemes, DynamicDataLoader } from '@sports-alliance/sports-lib';
import { AppUserSettingsQueryService } from '../../../services/app.user-settings-query.service';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { MapboxLoaderService } from '../../../services/mapbox-loader.service';
import { MapStyleService } from '../../../services/map-style.service';

describe('EventCardMapComponent', () => {
  let component: EventCardMapComponent;
  let fixture: ComponentFixture<EventCardMapComponent>;
  let mockMapboxLoader: any;
  let mockMapStyleService: any;
  let mockSettingsQuery: any;

  const makeStat = (value: string, unit = '') => ({
    getDisplayValue: () => value,
    getDisplayUnit: () => unit,
  });

  beforeEach(async () => {
    const mockMap = {
      addControl: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      remove: vi.fn(),
      panTo: vi.fn(),
      getSource: vi.fn().mockReturnValue(null),
      addSource: vi.fn(),
      getLayer: vi.fn().mockReturnValue(null),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      fitBounds: vi.fn(),
      project: vi.fn().mockReturnValue({ x: 100, y: 100 }),
      setStyle: vi.fn(),
      setPaintProperty: vi.fn(),
      setLayoutProperty: vi.fn(),
    };

    mockMapboxLoader = {
      createMap: vi.fn().mockResolvedValue(mockMap),
      loadMapbox: vi.fn().mockResolvedValue({
        Marker: class {
          setLngLat() { return this; }
          addTo() { return this; }
          remove() { return this; }
        },
        FullscreenControl: class { },
        NavigationControl: class { },
        LngLatBounds: class {
          extend = vi.fn();
        }
      })
    };

    mockMapStyleService = {
      resolve: vi.fn().mockReturnValue({ styleUrl: 'mapbox://styles/mapbox/standard', preset: 'day' }),
      isStandard: vi.fn().mockReturnValue(true),
      createSynchronizer: vi.fn().mockReturnValue({ update: vi.fn() }),
      adjustColorForTheme: vi.fn((color: string) => color)
    };

    mockSettingsQuery = {
      mapSettings: signal({ mapType: 'roadmap' }),
      chartSettings: signal({}),
      unitSettings: signal({}),
      updateMapSettings: vi.fn()
    };

    await TestBed.configureTestingModule({
      declarations: [EventCardMapComponent],
      providers: [
        { provide: MapboxLoaderService, useValue: mockMapboxLoader },
        { provide: MapStyleService, useValue: mockMapStyleService },
        {
          provide: AppEventColorService,
          useValue: {
            getActivityColor: vi.fn().mockReturnValue('#ff0000')
          }
        },
        {
          provide: LoggerService,
          useValue: {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
            info: vi.fn(),
          }
        },
        { provide: AppUserService, useValue: { updateUserProperties: vi.fn() } },
        { provide: AppActivityCursorService, useValue: { cursors: new Subject() } },
        {
          provide: AppThemeService,
          useValue: {
            appTheme: signal(AppThemes.Normal)
          }
        },
        { provide: AppUserSettingsQueryService, useValue: mockSettingsQuery },
        {
          provide: MarkerFactoryService,
          useValue: {
            createHomeMarker: vi.fn().mockReturnValue(document.createElement('div')),
            createFlagMarker: vi.fn().mockReturnValue(document.createElement('div')),
            createLapMarker: vi.fn().mockReturnValue(document.createElement('div')),
            createCursorMarker: vi.fn().mockReturnValue(document.createElement('div')),
            createJumpMarker: vi.fn().mockReturnValue(document.createElement('div')),
          }
        },
        { provide: NgZone, useValue: new NgZone({ enableLongStackTrace: false }) },
        ChangeDetectorRef
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    }).compileComponents();
  });

  beforeEach(async () => {
    fixture = TestBed.createComponent(EventCardMapComponent);
    component = fixture.componentInstance;

    component.user = { uid: 'test' } as any;
    component.targetUserID = 'target-user';
    component.event = {
      getActivities: () => []
    } as any;
    component.selectedActivities = [];

    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize mapbox on view init', async () => {
    await component.ngAfterViewInit();
    expect(mockMapboxLoader.createMap).toHaveBeenCalled();
    expect(mockMapboxLoader.loadMapbox).toHaveBeenCalled();
    expect(mockMapStyleService.createSynchronizer).toHaveBeenCalled();
  });

  it('should not persist default mapStyle during init when missing', async () => {
    vi.clearAllMocks();
    await component.ngOnInit();
    expect(mockSettingsQuery.updateMapSettings).not.toHaveBeenCalledWith({ mapStyle: 'default' });
  });

  it('should update mapStyle through user settings service', async () => {
    await component.onMapStyleChange('satellite');
    expect(mockSettingsQuery.updateMapSettings).toHaveBeenCalledWith({ mapStyle: 'satellite' });
  });

  it('should update 3d setting through user settings service and manager', async () => {
    const toggleSpy = vi.spyOn((component as any).mapManager, 'toggleTerrain');
    component.onShow3DChange(true);
    expect(mockSettingsQuery.updateMapSettings).toHaveBeenCalledWith({ is3D: true });
    expect(toggleSpy).toHaveBeenCalledWith(true, true);
  });

  it('should use safe fallback stroke color when activity color is missing', () => {
    const colorService = TestBed.inject(AppEventColorService) as any;
    colorService.getActivityColor.mockReturnValue(undefined);

    const resolved = (component as any).resolveActivityStrokeColor({} as any);

    expect(resolved).toBe('#2ca3ff');
  });

  it('should use smallest jump marker bucket when hang time is missing', () => {
    const jump = {
      jumpData: {
        distance: makeStat('1', 'm'),
        score: makeStat('1'),
      }
    } as any;

    (component as any).jumpHangTimeMin = 1;
    (component as any).jumpHangTimeMax = 2;

    const options = component.getJumpMarkerOptions(jump, '#ff0000');

    expect(options.title).toContain('Jump Stats:');
  });

  it('should use middle jump marker bucket when all hang times are identical', () => {
    const markerFactory = TestBed.inject(MarkerFactoryService) as any;
    const jump = {
      jumpData: {
        hang_time: { getValue: () => 1.5, getDisplayValue: () => '01.5s' },
        distance: makeStat('1', 'm'),
        score: makeStat('1'),
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
        hang_time: { getValue: () => 5, getDisplayValue: () => '05.0s' },
        distance: makeStat('1', 'm'),
        score: makeStat('1'),
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
        distance: makeStat('3.2', 'm'),
        score: makeStat('8.7'),
        speed: makeStat('12.3', 'km/h'),
        rotations: makeStat('1.1')
      }
    } as any;

    const options = component.getJumpMarkerOptions(jump, '#111111');

    expect(getDisplayValue).toHaveBeenCalledWith(false, true, true);
    expect(options.title).toContain('Hang Time: 01.3s');
  });

  it('should format speed in marker title using unit-based conversion', () => {
    const conversionSpy = vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockReturnValue([{
      getDisplayValue: () => '15.4',
      getDisplayUnit: () => 'km/h'
    }] as any);
    const jump = {
      jumpData: {
        hang_time: { getValue: () => 1.3, getDisplayValue: () => '01.3s' },
        distance: makeStat('3.2', 'm'),
        score: makeStat('8.7'),
        speed: { getDisplayValue: () => '9.6', getDisplayUnit: () => 'm/s' },
        rotations: makeStat('1.1')
      }
    } as any;

    const options = component.getJumpMarkerOptions(jump, '#222222');

    expect(options.title).toContain('Speed: 15.4 km/h');
    conversionSpy.mockRestore();
  });
});
