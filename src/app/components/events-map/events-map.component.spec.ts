import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, NgZone, SimpleChange, signal } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  AppThemes,
  DataDistance,
  DataDuration,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
  DataPaceAvg,
  DataPositionInterface,
  DataStartPosition,
  EventInterface,
  User,
} from '@sports-alliance/sports-lib';
import { EventsMapComponent } from './events-map.component';
import { AppEventService } from '../../services/app.event.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { LoggerService } from '../../services/logger.service';
import { AppThemeService } from '../../services/app.theme.service';
import { MapboxLoaderService } from '../../services/mapbox-loader.service';
import { MapStyleService } from '../../services/map-style.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';

const EVENTS_SOURCE_ID = 'events-map-events-source';
const EVENTS_UNCLUSTERED_LAYER_ID = 'events-map-events-unclustered';
const EVENTS_CLUSTER_LAYER_ID = 'events-map-events-clusters';
const EVENTS_CLUSTER_COUNT_LAYER_ID = 'events-map-events-cluster-count';
const SEARCH_SCOPE_SOURCE_ID = 'events-map-search-scope-source';
const SEARCH_SCOPE_FILL_LAYER_ID = 'events-map-search-scope-fill';
const SEARCH_SCOPE_OUTLINE_LAYER_ID = 'events-map-search-scope-outline';
const SELECTED_TRACKS_SOURCE_ID = 'events-map-selected-event-tracks-source';

describe('EventsMapComponent', () => {
  let component: EventsMapComponent;
  let fixture: ComponentFixture<EventsMapComponent>;

  let mockEventService: any;
  let mockColorService: any;
  let mockMapboxLoader: any;
  let mockMapStyleService: any;
  let mockUserSettingsQuery: any;

  let map: any;
  let mapEventHandlers: Record<string, Array<(...args: any[]) => void>>;
  let layerEventHandlers: Record<string, Array<(...args: any[]) => void>>;

  const emitMapEvent = (event: string, payload?: any) => {
    const handlers = mapEventHandlers[event] || [];
    handlers.forEach((handler) => handler(payload));
  };

  const emitLayerEvent = (event: string, layerId: string, payload?: any) => {
    const handlers = layerEventHandlers[`${event}:${layerId}`] || [];
    handlers.forEach((handler) => handler(payload));
  };

  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const initMap = async () => {
    fixture.detectChanges();
    await flush();
    emitMapEvent('load');
    await flush();
  };

  const createEvent = (eventId: string, latitudeDegrees = 40.64, longitudeDegrees = 22.94): EventInterface => {
    const startPosition = {
      getValue: () => ({ latitudeDegrees, longitudeDegrees }),
    } as DataStartPosition;

    const event = {
      getID: () => eventId,
      getStat: (type: string) => (type === DataStartPosition.type ? startPosition : null),
      getActivityTypesAsArray: () => [ActivityTypes.Running],
      getActivityTypesAsString: () => 'Running',
      getDuration: () => ({ getDisplayValue: () => '1h' }),
      getDistance: () => ({ getDisplayValue: () => '10', getDisplayUnit: () => 'km' }),
      getActivities: () => [],
      startDate: new Date('2025-01-01T10:00:00Z'),
      description: 'Test event',
    } as unknown as EventInterface;

    return event;
  };

  beforeEach(async () => {
    mapEventHandlers = {};
    layerEventHandlers = {};

    const sourceState = new Map<string, any>();
    const layerState = new Set<string>();

    map = {
      on: vi.fn((event: string, layerOrHandler: any, maybeHandler?: any) => {
        if (typeof layerOrHandler === 'function') {
          mapEventHandlers[event] = mapEventHandlers[event] || [];
          mapEventHandlers[event].push(layerOrHandler);
          return;
        }

        const key = `${event}:${layerOrHandler}`;
        layerEventHandlers[key] = layerEventHandlers[key] || [];
        layerEventHandlers[key].push(maybeHandler);
      }),
      off: vi.fn((event: string, layerOrHandler: any, maybeHandler?: any) => {
        if (typeof layerOrHandler === 'function') {
          mapEventHandlers[event] = (mapEventHandlers[event] || []).filter((handler) => handler !== layerOrHandler);
          return;
        }

        const key = `${event}:${layerOrHandler}`;
        layerEventHandlers[key] = (layerEventHandlers[key] || []).filter((handler) => handler !== maybeHandler);
      }),
      addSource: vi.fn((sourceId: string, source: any) => {
        sourceState.set(sourceId, {
          ...source,
          setData: vi.fn(),
          getClusterExpansionZoom: vi.fn((_clusterId: number, callback: (error: any, zoom: number) => void) => callback(null, 8)),
        });
      }),
      getSource: vi.fn((sourceId: string) => sourceState.get(sourceId) || null),
      removeSource: vi.fn((sourceId: string) => {
        sourceState.delete(sourceId);
      }),
      addLayer: vi.fn((layer: any) => {
        layerState.add(layer.id);
      }),
      getLayer: vi.fn((layerId: string) => (layerState.has(layerId) ? { id: layerId } : null)),
      removeLayer: vi.fn((layerId: string) => {
        layerState.delete(layerId);
      }),
      setPaintProperty: vi.fn(),
      easeTo: vi.fn(),
      fitBounds: vi.fn(),
      remove: vi.fn(),
      isStyleLoaded: vi.fn().mockReturnValue(true),
    };

    mockEventService = {
      getEventActivitiesAndSomeStreams: vi.fn(),
    };

    mockColorService = {
      getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#00aaff'),
      getActivityColor: vi.fn().mockReturnValue('#ff5500'),
    };

    mockMapStyleService = {
      resolve: vi.fn().mockReturnValue({ styleUrl: 'mapbox://styles/mapbox/standard', preset: 'day' }),
      isStandard: vi.fn().mockReturnValue(true),
      normalizeStyle: vi.fn((value: string | undefined) => (value === 'satellite' ? 'satellite' : 'default')),
      createSynchronizer: vi.fn().mockReturnValue({ update: vi.fn() }),
      adjustColorForTheme: vi.fn((color: string) => color),
    };

    mockMapboxLoader = {
      createMap: vi.fn().mockResolvedValue(map),
      loadMapbox: vi.fn().mockResolvedValue({
        LngLatBounds: class {
          public points: [number, number][] = [];

          extend(point: [number, number]) {
            this.points.push(point);
          }
        },
      }),
    };

    mockUserSettingsQuery = {
      unitSettings: vi.fn().mockReturnValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [EventsMapComponent, RouterTestingModule],
      providers: [
        { provide: AppEventService, useValue: mockEventService },
        { provide: AppEventColorService, useValue: mockColorService },
        {
          provide: LoggerService,
          useValue: {
            error: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
            info: vi.fn(),
          },
        },
        {
          provide: AppThemeService,
          useValue: {
            appTheme: signal(AppThemes.Normal),
          },
        },
        { provide: MapboxLoaderService, useValue: mockMapboxLoader },
        { provide: MapStyleService, useValue: mockMapStyleService },
        { provide: AppUserSettingsQueryService, useValue: mockUserSettingsQuery },
        { provide: NgZone, useValue: new NgZone({ enableLongStackTrace: false }) },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsMapComponent);
    component = fixture.componentInstance;

    component.user = { uid: 'test-user' } as User;
    component.events = [createEvent('event-1')];
    component.mapStyle = 'default';
    component.clusterMarkers = true;
    component.searchScope = null;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize mapbox and render clustered event layers on load', async () => {
    await initMap();

    expect(mockMapboxLoader.createMap).toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalledWith(EVENTS_SOURCE_ID, expect.objectContaining({ cluster: true }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: EVENTS_UNCLUSTERED_LAYER_ID }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: EVENTS_CLUSTER_LAYER_ID }));
    expect(component.noMapData).toBe(false);
  });

  it('should mark map data as empty when no event has start positions', async () => {
    component.events = [];
    await initMap();

    expect(component.noMapData).toBe(true);
    expect(map.addSource).not.toHaveBeenCalledWith(EVENTS_SOURCE_ID, expect.anything());
  });

  it('applies theme-adjusted marker color for event points', async () => {
    await initMap();

    expect(mockMapStyleService.adjustColorForTheme).toHaveBeenCalledWith('#00aaff', AppThemes.Normal);
  });

  it('uses emissive marker paint for dark-style readability on unclustered points', async () => {
    await initMap();

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      EVENTS_UNCLUSTERED_LAYER_ID,
      'circle-emissive-strength',
      1
    );
  });

  it('normalizes lowercase event activity type before resolving marker color', async () => {
    const cyclingEvent = {
      ...createEvent('event-lower'),
      getActivityTypesAsArray: () => ['cycling'],
    } as EventInterface;
    component.events = [cyclingEvent];

    mockColorService.getColorForActivityTypeByActivityTypeGroup = vi.fn().mockImplementation((activityType: ActivityTypes) => {
      return activityType === ActivityTypes.Cycling ? '#FF7C3B' : '#A3ADB0';
    });

    await initMap();

    expect(mockColorService.getColorForActivityTypeByActivityTypeGroup).toHaveBeenCalledWith(ActivityTypes.Cycling);
  });

  it('uses polished cluster colors with readable outlines and labels', async () => {
    await initMap();

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      EVENTS_CLUSTER_LAYER_ID,
      'circle-color',
      expect.arrayContaining(['step', ['get', 'point_count'], '#87d4ff'])
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      EVENTS_CLUSTER_LAYER_ID,
      'circle-stroke-color',
      'rgba(244, 248, 255, 0.92)'
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      EVENTS_CLUSTER_LAYER_ID,
      'circle-emissive-strength',
      1
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      EVENTS_CLUSTER_COUNT_LAYER_ID,
      'text-halo-color',
      'rgba(16, 37, 63, 0.28)'
    );
  });

  it('hydrates selected event and renders selected track polylines on click', async () => {
    const clickedEvent = component.events[0];
    const populatedActivity = {
      getSquashedPositionData: vi.fn().mockReturnValue([
        { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
        { latitudeDegrees: 40.66, longitudeDegrees: 22.96 },
      ] as DataPositionInterface[]),
    };
    const populatedEvent = {
      ...clickedEvent,
      getActivities: () => [populatedActivity],
    } as EventInterface;
    mockEventService.getEventActivitiesAndSomeStreams.mockReturnValue(of(populatedEvent));

    await initMap();
    const fitBoundsCallsBefore = map.fitBounds.mock.calls.length;

    emitLayerEvent('click', EVENTS_UNCLUSTERED_LAYER_ID, {
      features: [{ properties: { eventId: 'event-1' } }],
    });

    await flush();

    expect(mockEventService.getEventActivitiesAndSomeStreams).toHaveBeenCalledWith(
      component.user,
      'event-1',
      [DataLatitudeDegrees.type, DataLongitudeDegrees.type]
    );
    expect(component.selectedEvent?.getID?.()).toBe('event-1');
    expect(map.addSource).toHaveBeenCalledWith(SELECTED_TRACKS_SOURCE_ID, expect.anything());
    expect(map.fitBounds.mock.calls.length).toBeGreaterThan(fitBoundsCallsBefore);
  });

  it('does not render selected tracks when hydration returns no position streams', async () => {
    const clickedEvent = component.events[0];
    const populatedEvent = {
      ...clickedEvent,
      getActivities: () => [
        {
          getSquashedPositionData: () => [],
        },
      ],
    } as EventInterface;
    mockEventService.getEventActivitiesAndSomeStreams.mockReturnValue(of(populatedEvent));

    await initMap();
    const fitBoundsCallsBefore = map.fitBounds.mock.calls.length;

    emitLayerEvent('click', EVENTS_UNCLUSTERED_LAYER_ID, {
      features: [{ properties: { eventId: 'event-1' } }],
    });

    await flush();

    const selectedSourceCalls = map.addSource.mock.calls.filter((call: any[]) => call[0] === SELECTED_TRACKS_SOURCE_ID);
    expect(selectedSourceCalls.length).toBe(0);
    expect(map.fitBounds.mock.calls.length).toBe(fitBoundsCallsBefore);
  });

  it('reclicking same selected marker refits bounds without re-hydration', async () => {
    const clickedEvent = component.events[0];
    const populatedEvent = {
      ...clickedEvent,
      getActivities: () => [
        {
          getSquashedPositionData: () => [
            { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
            { latitudeDegrees: 40.66, longitudeDegrees: 22.96 },
          ],
        },
      ],
    } as EventInterface;
    mockEventService.getEventActivitiesAndSomeStreams.mockReturnValue(of(populatedEvent));

    await initMap();

    emitLayerEvent('click', EVENTS_UNCLUSTERED_LAYER_ID, {
      features: [{ properties: { eventId: 'event-1' } }],
    });
    await flush();

    const hydrateCallsBeforeReclick = mockEventService.getEventActivitiesAndSomeStreams.mock.calls.length;
    const fitBoundsCallsBeforeReclick = map.fitBounds.mock.calls.length;

    emitLayerEvent('click', EVENTS_UNCLUSTERED_LAYER_ID, {
      features: [{ properties: { eventId: 'event-1' } }],
    });
    await flush();

    expect(mockEventService.getEventActivitiesAndSomeStreams.mock.calls.length).toBe(hydrateCallsBeforeReclick);
    expect(map.fitBounds.mock.calls.length).toBeGreaterThan(fitBoundsCallsBeforeReclick);
  });

  it('ignores stale hydration responses when a newer marker click happens', async () => {
    const firstEvent = createEvent('event-1', 40.64, 22.94);
    const secondEvent = createEvent('event-2', 41.05, 23.77);
    component.events = [firstEvent, secondEvent];

    const firstHydration$ = new Subject<EventInterface>();
    const secondHydration$ = new Subject<EventInterface>();
    mockEventService.getEventActivitiesAndSomeStreams.mockImplementation((_user: User, eventId: string) => {
      if (eventId === 'event-1') {
        return firstHydration$.asObservable();
      }
      return secondHydration$.asObservable();
    });

    await initMap();

    emitLayerEvent('click', EVENTS_UNCLUSTERED_LAYER_ID, {
      features: [{ properties: { eventId: 'event-1' } }],
    });
    emitLayerEvent('click', EVENTS_UNCLUSTERED_LAYER_ID, {
      features: [{ properties: { eventId: 'event-2' } }],
    });
    await flush();

    firstHydration$.next({
      ...firstEvent,
      getActivities: () => [
        {
          getSquashedPositionData: () => [
            { latitudeDegrees: 40.64, longitudeDegrees: 22.94 },
            { latitudeDegrees: 40.66, longitudeDegrees: 22.96 },
          ],
        },
      ],
    } as EventInterface);
    firstHydration$.complete();
    await flush();

    const selectedSourceCallsAfterStale = map.addSource.mock.calls.filter((call: any[]) => call[0] === SELECTED_TRACKS_SOURCE_ID);
    expect(selectedSourceCallsAfterStale.length).toBe(0);
    expect(component.selectedEvent?.getID?.()).toBe('event-2');

    secondHydration$.next({
      ...secondEvent,
      getActivities: () => [
        {
          getSquashedPositionData: () => [
            { latitudeDegrees: 41.05, longitudeDegrees: 23.77 },
            { latitudeDegrees: 41.09, longitudeDegrees: 23.8 },
          ],
        },
      ],
    } as EventInterface);
    secondHydration$.complete();
    await flush();

    const selectedSourceCallsFinal = map.addSource.mock.calls.filter((call: any[]) => call[0] === SELECTED_TRACKS_SOURCE_ID);
    expect(selectedSourceCallsFinal.length).toBe(1);
    expect(component.selectedEvent?.getID?.()).toBe('event-2');
  });

  it('should switch to non-clustered source/layers when clustering is disabled', async () => {
    await initMap();

    component.clusterMarkers = false;
    component.ngOnChanges({
      clusterMarkers: new SimpleChange(true, false, false),
    });

    expect(map.removeLayer).toHaveBeenCalledWith(EVENTS_CLUSTER_LAYER_ID);
    const eventsSourceCalls = map.addSource.mock.calls.filter((call: any[]) => call[0] === EVENTS_SOURCE_ID);
    const lastSourceCall = eventsSourceCalls[eventsSourceCalls.length - 1];
    expect(lastSourceCall?.[1]?.cluster).toBeUndefined();
  });

  it('should bootstrap map with bounds when multiple event start positions are available', async () => {
    component.events = [
      createEvent('event-1', 40.64, 22.94),
      createEvent('event-2', 41.05, 23.77),
    ];

    fixture.detectChanges();
    await flush();

    const createMapCall = mockMapboxLoader.createMap.mock.calls[0];
    const mapOptions = createMapCall?.[1];

    expect(mapOptions?.bounds).toEqual([
      [22.94, 40.64],
      [23.77, 41.05],
    ]);
    expect(mapOptions?.center).toBeUndefined();
    expect(mapOptions?.zoom).toBeUndefined();
  });

  it('should include focusLocation in initial bounds when events are present', async () => {
    component.events = [createEvent('event-1', 40.64, 22.94)];
    component.focusLocation = { latitudeDegrees: 41.05, longitudeDegrees: 23.77 };

    fixture.detectChanges();
    await flush();

    const createMapCall = mockMapboxLoader.createMap.mock.calls[0];
    const mapOptions = createMapCall?.[1];

    expect(mapOptions?.bounds).toEqual([
      [22.94, 40.64],
      [23.77, 41.05],
    ]);
  });

  it('should include focusLocation in fitBounds camera updates for event points', async () => {
    component.events = [createEvent('event-1', 40.64, 22.94)];
    component.focusLocation = { latitudeDegrees: 41.05, longitudeDegrees: 23.77 };

    await initMap();

    const fitBoundsCall = map.fitBounds.mock.calls.at(-1);
    const bounds = fitBoundsCall?.[0] as [[number, number], [number, number]];

    expect(bounds?.[0]?.[0]).toBeLessThanOrEqual(22.94);
    expect(bounds?.[1]?.[0]).toBeGreaterThanOrEqual(23.77);
    expect(bounds?.[0]?.[1]).toBeLessThanOrEqual(40.64);
    expect(bounds?.[1]?.[1]).toBeGreaterThanOrEqual(41.05);
  });

  it('should render a radius search-scope overlay with fill and outline layers', async () => {
    component.searchScope = {
      mode: 'radius',
      center: { latitudeDegrees: 41.05, longitudeDegrees: 23.77 },
      radiusKm: 50,
    };

    await initMap();

    const scopeSourceCall = map.addSource.mock.calls.find((call: any[]) => call[0] === SEARCH_SCOPE_SOURCE_ID);
    expect(scopeSourceCall).toBeDefined();
    expect(scopeSourceCall?.[1]?.data?.features?.[0]?.geometry?.type).toBe('Polygon');
    expect(map.addLayer.mock.calls.some((call: any[]) => call[0]?.id === SEARCH_SCOPE_FILL_LAYER_ID)).toBe(true);
    expect(map.addLayer.mock.calls.some((call: any[]) => call[0]?.id === SEARCH_SCOPE_OUTLINE_LAYER_ID)).toBe(true);
  });

  it('should render a wrapped bbox search-scope overlay as multipolygon', async () => {
    component.searchScope = {
      mode: 'bbox',
      bbox: {
        west: 170,
        south: -10,
        east: -170,
        north: 10,
      },
    };

    await initMap();

    const scopeSourceCall = map.addSource.mock.calls.find((call: any[]) => call[0] === SEARCH_SCOPE_SOURCE_ID);
    expect(scopeSourceCall).toBeDefined();
    expect(scopeSourceCall?.[1]?.data?.features?.[0]?.geometry?.type).toBe('MultiPolygon');
  });

  it('should include searchScope geometry in initial bounds resolution', async () => {
    component.events = [createEvent('event-1', 40.64, 22.94)];
    component.searchScope = {
      mode: 'radius',
      center: { latitudeDegrees: 41.05, longitudeDegrees: 23.77 },
      radiusKm: 50,
    };

    fixture.detectChanges();
    await flush();

    const createMapCall = mockMapboxLoader.createMap.mock.calls[0];
    const mapOptions = createMapCall?.[1];

    expect(mapOptions?.bounds).toBeDefined();
    expect(mapOptions?.bounds?.[0]?.[0]).toBeLessThanOrEqual(22.94);
    expect(mapOptions?.bounds?.[1]?.[0]).toBeGreaterThan(23.9);
    expect(mapOptions?.center).toBeUndefined();
  });

  it('should include searchScope geometry in fitBounds camera updates', async () => {
    component.events = [createEvent('event-1', 40.64, 22.94)];
    component.searchScope = {
      mode: 'radius',
      center: { latitudeDegrees: 41.05, longitudeDegrees: 23.77 },
      radiusKm: 50,
    };

    await initMap();

    const fitBoundsCall = map.fitBounds.mock.calls.at(-1);
    const bounds = fitBoundsCall?.[0] as [[number, number], [number, number]];

    expect(bounds?.[0]?.[0]).toBeLessThanOrEqual(22.94);
    expect(bounds?.[1]?.[0]).toBeGreaterThan(23.9);
    expect(bounds?.[0]?.[1]).toBeLessThan(40.64);
    expect(bounds?.[1]?.[1]).toBeGreaterThan(41.05);
  });

  it('should refit camera bounds when focusLocation changes after map initialization', async () => {
    component.events = [createEvent('event-1', 40.64, 22.94)];
    component.focusLocation = undefined;

    await initMap();
    const fitBoundsCallsBefore = map.fitBounds.mock.calls.length;

    component.focusLocation = { latitudeDegrees: 41.05, longitudeDegrees: 23.77 };
    component.ngOnChanges({
      focusLocation: new SimpleChange(undefined, component.focusLocation, false),
    });
    await flush();

    expect(map.fitBounds.mock.calls.length).toBeGreaterThan(fitBoundsCallsBefore);
    const fitBoundsCall = map.fitBounds.mock.calls.at(-1);
    const bounds = fitBoundsCall?.[0] as [[number, number], [number, number]];
    expect(bounds?.[0]?.[0]).toBeLessThanOrEqual(22.94);
    expect(bounds?.[1]?.[0]).toBeGreaterThanOrEqual(23.77);
    expect(bounds?.[0]?.[1]).toBeLessThanOrEqual(40.64);
    expect(bounds?.[1]?.[1]).toBeGreaterThanOrEqual(41.05);
  });

  it('should refit camera bounds when searchScope changes after map initialization', async () => {
    component.events = [createEvent('event-1', 40.64, 22.94)];
    component.searchScope = undefined;

    await initMap();
    const fitBoundsCallsBefore = map.fitBounds.mock.calls.length;

    component.searchScope = {
      mode: 'radius',
      center: { latitudeDegrees: 41.05, longitudeDegrees: 23.77 },
      radiusKm: 50,
    };
    component.ngOnChanges({
      searchScope: new SimpleChange(undefined, component.searchScope, false),
    });
    await flush();

    expect(map.fitBounds.mock.calls.length).toBeGreaterThan(fitBoundsCallsBefore);
    const fitBoundsCall = map.fitBounds.mock.calls.at(-1);
    const bounds = fitBoundsCall?.[0] as [[number, number], [number, number]];
    expect(bounds?.[0]?.[0]).toBeLessThanOrEqual(22.94);
    expect(bounds?.[1]?.[0]).toBeGreaterThan(23.9);
    expect(bounds?.[0]?.[1]).toBeLessThan(40.64);
    expect(bounds?.[1]?.[1]).toBeGreaterThan(41.05);
  });

  it('should use wrapped longitude bounds for anti-meridian search scopes', async () => {
    component.events = [createEvent('event-1', -9, -175)];
    component.searchScope = {
      mode: 'bbox',
      bbox: {
        west: 170,
        south: -10,
        east: -170,
        north: 10,
      },
    };

    await initMap();

    const fitBoundsCall = map.fitBounds.mock.calls.at(-1);
    const bounds = fitBoundsCall?.[0] as [[number, number], [number, number]];

    expect(bounds?.[0]?.[0]).toBe(170);
    expect(bounds?.[1]?.[0]).toBe(190);
    expect(bounds?.[0]?.[1]).toBe(-10);
    expect(bounds?.[1]?.[1]).toBe(10);
  });

  it('should preserve event-only camera behavior when focusLocation is undefined', async () => {
    component.events = [createEvent('event-1', 40.64, 22.94)];
    component.focusLocation = undefined;

    fixture.detectChanges();
    await flush();

    const createMapCall = mockMapboxLoader.createMap.mock.calls[0];
    const mapOptions = createMapCall?.[1];

    expect(mapOptions?.bounds).toBeUndefined();
    expect(mapOptions?.center).toEqual([22.94, 40.64]);
    expect(mapOptions?.zoom).toBe(10);
  });

  it('should use mytracks-like popup metric slots without activities count', () => {
    const event = createEvent('event-1');
    (event as any).getActivities = () => [];
    (event as any).getDuration = () => ({ getType: () => DataDuration.type, getDisplayValue: () => '42:10', getDisplayUnit: () => '' });
    (event as any).getDistance = () => ({ getType: () => DataDistance.type, getDisplayValue: () => '10.0', getDisplayUnit: () => 'km' });
    (event as any).getStat = (type: string) => {
      if (type === DataPaceAvg.type) {
        return { getType: () => type, getDisplayValue: () => '4:13', getDisplayUnit: () => 'min/km' };
      }
      return null;
    };

    const popupContent = component.getSelectedEventPopupContent(event);
    const metrics = popupContent.metrics;

    expect(metrics.length).toBe(3);
    expect(metrics[0]).toBeTruthy();
    expect(metrics[1]).toBeTruthy();
    expect(metrics[2]).toBeTruthy();
    expect(metrics.some((metric) => metric.label === 'activity' || metric.label === 'activities')).toBe(false);
  });
});
