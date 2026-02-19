import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, NgZone, SimpleChange, signal } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  AppThemes,
  DataLatitudeDegrees,
  DataLongitudeDegrees,
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
import { MatSnackBar } from '@angular/material/snack-bar';

const EVENTS_SOURCE_ID = 'events-map-events-source';
const EVENTS_UNCLUSTERED_LAYER_ID = 'events-map-events-unclustered';
const EVENTS_CLUSTER_LAYER_ID = 'events-map-events-clusters';
const SELECTED_TRACKS_SOURCE_ID = 'events-map-selected-event-tracks-source';

describe('EventsMapComponent', () => {
  let component: EventsMapComponent;
  let fixture: ComponentFixture<EventsMapComponent>;

  let mockEventService: any;
  let mockColorService: any;
  let mockMapboxLoader: any;
  let mockMapStyleService: any;
  let mockSnackBar: any;

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
      attachStreamsToEventWithActivities: vi.fn(),
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

    mockSnackBar = {
      open: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [EventsMapComponent],
      imports: [RouterTestingModule],
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
        { provide: MatSnackBar, useValue: mockSnackBar },
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

  it('should hydrate selected event tracks when clicking an event point', async () => {
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
    };

    mockEventService.attachStreamsToEventWithActivities.mockReturnValue(of(populatedEvent));

    await initMap();

    emitLayerEvent('click', EVENTS_UNCLUSTERED_LAYER_ID, {
      features: [{ properties: { eventId: 'event-1' } }],
    });

    await flush();

    expect(mockEventService.attachStreamsToEventWithActivities).toHaveBeenCalledWith(
      component.user,
      clickedEvent,
      [DataLatitudeDegrees.type, DataLongitudeDegrees.type]
    );
    expect(component.selectedEvent).toBe(populatedEvent);
    expect(map.addSource).toHaveBeenCalledWith(SELECTED_TRACKS_SOURCE_ID, expect.anything());
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

  it('should not show a zero activities metric in selected event popup summary', () => {
    const event = createEvent('event-1');
    (event as any).getActivities = () => [];

    const metrics = component.getSelectedEventSummaryMetrics(event);

    expect(metrics.some((metric) => metric.label === 'activity' || metric.label === 'activities')).toBe(false);
  });
});
