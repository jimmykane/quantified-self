import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventCardMapManager } from './event-card-map.manager';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { LoggerService } from '../../../services/logger.service';

const createMarkerElement = () => {
  const element = document.createElement('div');
  element.textContent = 'marker';
  return element;
};

class MockMapboxMarker {
  public lngLat: [number, number] | null = null;
  public added = false;

  constructor(_options?: any) { }

  setLngLat(lngLat: [number, number]) {
    this.lngLat = lngLat;
    return this;
  }

  addTo(_map: any) {
    this.added = true;
    return this;
  }

  remove() {
    this.added = false;
  }
}

describe('EventCardMapManager', () => {
  let manager: EventCardMapManager;
  let markerFactory: MarkerFactoryService;
  let map: any;
  let handlers: Record<string, any[]>;
  let layerState: Set<string>;
  let sourceState: Set<string>;

  beforeEach(() => {
    handlers = {};
    layerState = new Set<string>();
    sourceState = new Set<string>();

    map = {
      addSource: vi.fn((sourceId: string) => sourceState.add(sourceId)),
      getSource: vi.fn((sourceId: string) => sourceState.has(sourceId) ? { setData: vi.fn() } : null),
      removeSource: vi.fn((sourceId: string) => sourceState.delete(sourceId)),
      addLayer: vi.fn((layer: any) => layerState.add(layer.id)),
      getLayer: vi.fn((layerId: string) => layerState.has(layerId)),
      removeLayer: vi.fn((layerId: string) => layerState.delete(layerId)),
      fitBounds: vi.fn(),
      project: vi.fn(() => ({ x: 120, y: 220 })),
      setTerrain: vi.fn(),
      setPitch: vi.fn(),
      easeTo: vi.fn(),
      once: vi.fn(),
      on: vi.fn((event: string, layerOrHandler: any, maybeHandler?: any) => {
        const handler = typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler;
        handlers[event] = handlers[event] || [];
        handlers[event].push({ layerId: typeof layerOrHandler === 'string' ? layerOrHandler : null, handler });
      }),
      off: vi.fn((event: string, layerOrHandler: any, maybeHandler?: any) => {
        const handler = typeof layerOrHandler === 'function' ? layerOrHandler : maybeHandler;
        const layerId = typeof layerOrHandler === 'string' ? layerOrHandler : null;
        handlers[event] = (handlers[event] || []).filter((binding) => {
          if (layerId && binding.layerId !== layerId) {
            return true;
          }
          return binding.handler !== handler;
        });
      }),
    };

    markerFactory = {
      createHomeMarker: vi.fn(() => createMarkerElement()),
      createFlagMarker: vi.fn(() => createMarkerElement()),
      createLapMarker: vi.fn(() => createMarkerElement()),
      createJumpMarker: vi.fn(() => createMarkerElement()),
      createCursorMarker: vi.fn(() => createMarkerElement()),
    } as unknown as MarkerFactoryService;

    manager = new EventCardMapManager(markerFactory, {
      warn: vi.fn(),
      log: vi.fn(),
    } as unknown as LoggerService);

    manager.setMap(map, { Marker: MockMapboxMarker, LngLatBounds: class { extend = vi.fn(); } });
  });

  it('renders track layers and markers', () => {
    manager.renderActivities([
      {
        activityId: 'a1',
        strokeColor: '#ff0000',
        positions: [
          { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
          { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
        ],
        laps: [{ lapIndex: 0, latitudeDegrees: 40.2, longitudeDegrees: 22.2 }],
        jumps: []
      }
    ], {
      showArrows: true,
      strokeWidth: 4,
    });

    expect(map.addSource).toHaveBeenCalled();
    expect(map.addLayer).toHaveBeenCalled();
    const lineLayerCall = map.addLayer.mock.calls.find((call: any[]) => String(call?.[0]?.id || '').startsWith('event-track-line-'));
    expect(lineLayerCall?.[0]?.paint?.['line-emissive-strength']).toBe(1);
    expect(markerFactory.createHomeMarker).toHaveBeenCalledWith('#ff0000');
    expect(markerFactory.createFlagMarker).toHaveBeenCalledWith('#ff0000');
    expect(markerFactory.createLapMarker).toHaveBeenCalledWith('#ff0000', 0);
  });

  it('does not register line click handlers for track layers', () => {
    manager.renderActivities([
      {
        activityId: 'a1',
        strokeColor: '#00ff00',
        positions: [
          { latitudeDegrees: 41.1, longitudeDegrees: 23.1 },
          { latitudeDegrees: 41.2, longitudeDegrees: 23.2 },
        ],
        laps: [],
        jumps: []
      }
    ], {
      showArrows: false,
      strokeWidth: 3,
    });

    expect(handlers.click ?? []).toHaveLength(0);
  });

  it('propagates jump marker click events to callback', () => {
    const jumpEvent = { jumpData: {} } as any;
    const onJumpClick = vi.fn();
    manager.setJumpClickHandler(onJumpClick);

    manager.renderActivities([
      {
        activityId: 'a1',
        strokeColor: '#0000ff',
        positions: [
          { latitudeDegrees: 41.1, longitudeDegrees: 23.1 },
          { latitudeDegrees: 41.2, longitudeDegrees: 23.2 },
        ],
        laps: [],
        jumps: [{
          event: jumpEvent,
          latitudeDegrees: 41.15,
          longitudeDegrees: 23.15,
          markerSize: 24,
        }]
      }
    ], {
      showArrows: true,
      strokeWidth: 3,
    });

    const jumpMarkerElement = (markerFactory.createJumpMarker as any).mock.results[0].value as HTMLElement;
    jumpMarkerElement.dispatchEvent(new Event('click'));

    expect(onJumpClick).toHaveBeenCalledWith(jumpEvent, 41.15, 23.15);
  });

  it('updates cursor markers', () => {
    manager.setCursorMarkers([
      {
        activityId: 'a1',
        latitudeDegrees: 40.5,
        longitudeDegrees: 22.5,
        color: '#abcdef'
      }
    ]);

    expect(markerFactory.createCursorMarker).toHaveBeenCalledWith('#abcdef');

    manager.clearCursorMarkers();
    expect(markerFactory.createCursorMarker).toHaveBeenCalledTimes(1);
  });

  it('fits map bounds when tracks exist', () => {
    manager.renderActivities([
      {
        activityId: 'a1',
        strokeColor: '#fff000',
        positions: [
          { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
          { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
        ],
        laps: [],
        jumps: []
      }
    ], {
      showArrows: true,
      strokeWidth: 3,
    });

    const didFit = manager.fitBoundsToTracks();
    expect(didFit).toBe(true);
    expect(map.fitBounds).toHaveBeenCalled();
  });

  it('toggles terrain and pitch', () => {
    manager.toggleTerrain(true, false);
    expect(map.addSource).toHaveBeenCalledWith('mapbox-dem', expect.anything());
    expect(map.setTerrain).toHaveBeenCalledWith(expect.objectContaining({ source: 'mapbox-dem' }));
    expect(map.setPitch).toHaveBeenCalledWith(60);

    manager.toggleTerrain(false, false);
    expect(map.setTerrain).toHaveBeenCalledWith(null);
    expect(map.setPitch).toHaveBeenCalledWith(0);
  });

  it('defers terrain toggle until style is ready', () => {
    map.isStyleLoaded = vi.fn().mockReturnValue(false);

    manager.toggleTerrain(true, false);
    expect(map.addSource).not.toHaveBeenCalled();

    map.isStyleLoaded.mockReturnValue(true);
    (handlers['style.load'] || []).forEach(binding => binding.handler());

    expect(map.addSource).toHaveBeenCalledWith('mapbox-dem', expect.anything());
    expect(map.setTerrain).toHaveBeenCalledWith(expect.objectContaining({ source: 'mapbox-dem' }));
    expect(map.setPitch).toHaveBeenCalledWith(60);
  });

  it('applies only latest deferred terrain toggle request', () => {
    map.isStyleLoaded = vi.fn().mockReturnValue(false);

    manager.toggleTerrain(true, false);
    manager.toggleTerrain(false, false);
    expect(map.setTerrain).not.toHaveBeenCalled();

    map.isStyleLoaded.mockReturnValue(true);
    (handlers['style.load'] || []).forEach(binding => binding.handler());

    expect(map.setTerrain).toHaveBeenCalledTimes(1);
    expect(map.setTerrain).toHaveBeenCalledWith(null);
    expect(map.setPitch).toHaveBeenCalledWith(0);
  });
});
