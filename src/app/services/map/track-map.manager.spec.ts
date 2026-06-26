import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggerService } from '../logger.service';
import { MarkerFactoryService } from './marker-factory.service';
import { TrackMapManager } from './track-map.manager';

const createMarkerElement = () => document.createElement('div');

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

class MockLngLatBounds {
  public points: Array<[number, number]> = [];

  extend(point: [number, number]) {
    this.points.push(point);
    return this;
  }
}

describe('TrackMapManager', () => {
  let manager: TrackMapManager;
  let markerFactory: any;
  let map: any;
  let sourceState: Set<string>;
  let layerState: Set<string>;

  beforeEach(() => {
    sourceState = new Set<string>();
    layerState = new Set<string>();
    map = {
      addSource: vi.fn((sourceId: string) => sourceState.add(sourceId)),
      getSource: vi.fn((sourceId: string) => sourceState.has(sourceId) ? { setData: vi.fn() } : null),
      removeSource: vi.fn((sourceId: string) => sourceState.delete(sourceId)),
      addLayer: vi.fn((layer: any) => layerState.add(layer.id)),
      getLayer: vi.fn((layerId: string) => layerState.has(layerId)),
      removeLayer: vi.fn((layerId: string) => layerState.delete(layerId)),
      setPaintProperty: vi.fn(),
      fitBounds: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      isStyleLoaded: vi.fn(() => true),
    };
    markerFactory = {
      createHomeMarker: vi.fn(() => createMarkerElement()),
      createFlagMarker: vi.fn(() => createMarkerElement()),
      createCursorMarker: vi.fn(() => createMarkerElement()),
    } as unknown as MarkerFactoryService;
    manager = new TrackMapManager(markerFactory, {
      log: vi.fn(),
      warn: vi.fn(),
    } as unknown as LoggerService, {
      layerPrefix: 'route-track',
      logPrefix: 'RouteMapManager',
    });
    manager.setMap(map, { Marker: MockMapboxMarker, LngLatBounds: MockLngLatBounds });
  });

  it('renders track lines, arrows, start/end markers, and extra markers from valid coordinates', () => {
    manager.renderTrackData([{
      id: 'route-1',
      label: 'Route 1',
      strokeColor: '#1e88e5',
      positions: [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: Number.NaN, longitudeDegrees: 22.2 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ],
      markers: [{
        id: 'wp-1',
        latitudeDegrees: 40.15,
        longitudeDegrees: 22.15,
        element: createMarkerElement(),
      }],
    }], {
      showArrows: true,
      strokeWidth: 4,
    });

    expect(map.addSource).toHaveBeenCalledWith(
      expect.stringMatching(/^route-track-source-route-1-[a-z0-9]+$/),
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^route-track-line-route-1-[a-z0-9]+$/),
    }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^route-track-arrow-route-1-[a-z0-9]+$/),
    }));
    expect(markerFactory.createHomeMarker).toHaveBeenCalledWith('#1e88e5');
    expect(markerFactory.createFlagMarker).toHaveBeenCalledWith('#1e88e5');
  });

  it('defers track layer rendering until the Mapbox style is ready', () => {
    map.isStyleLoaded.mockReturnValue(false);

    manager.renderTrackData([{
      id: 'route-loading',
      label: 'Loading Route',
      strokeColor: '#1e88e5',
      positions: [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ],
    }], {
      showArrows: true,
      strokeWidth: 4,
    });

    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();

    manager.renderTrackData([{
      id: 'route-ready',
      label: 'Ready Route',
      strokeColor: '#43a047',
      positions: [
        { latitudeDegrees: 41.1, longitudeDegrees: 23.1 },
        { latitudeDegrees: 41.2, longitudeDegrees: 23.2 },
      ],
    }], {
      showArrows: false,
      strokeWidth: 5,
    });

    map.isStyleLoaded.mockReturnValue(true);
    map.on.mock.calls
      .filter((call: any[]) => call[0] === 'style.load')
      .forEach((call: any[]) => call[1]());

    const addedSources = map.addSource.mock.calls.map((call: any[]) => String(call[0]));
    expect(addedSources.some((sourceId: string) => sourceId.includes('route-loading'))).toBe(false);
    expect(addedSources.some((sourceId: string) => sourceId.includes('route-ready'))).toBe(true);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^route-track-line-route-ready-[a-z0-9]+$/),
      paint: expect.objectContaining({
        'line-color': '#43a047',
        'line-width': 5,
      }),
    }));
    expect(map.addLayer).not.toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^route-track-arrow-route-ready-[a-z0-9]+$/),
    }));
  });

  it('keeps layer IDs distinct when track IDs sanitize to the same value', () => {
    manager.renderTrackData([
      {
        id: 'route/1',
        strokeColor: '#1e88e5',
        positions: [
          { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
          { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
        ],
      },
      {
        id: 'route:1',
        strokeColor: '#43a047',
        positions: [
          { latitudeDegrees: 41.1, longitudeDegrees: 23.1 },
          { latitudeDegrees: 41.2, longitudeDegrees: 23.2 },
        ],
      },
    ], {
      showArrows: false,
      strokeWidth: 3,
    });

    const routeSourceIds = map.addSource.mock.calls
      .map((call: any[]) => String(call[0]))
      .filter((sourceId: string) => sourceId.startsWith('route-track-source-route-1-'));
    expect(routeSourceIds).toHaveLength(2);
    expect(new Set(routeSourceIds).size).toBe(2);
  });

  it('fits bounds across selected track coordinates and markers', () => {
    manager.renderTrackData([{
      id: 'route-1',
      strokeColor: '#1e88e5',
      positions: [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ],
      markers: [{
        id: 'wp-1',
        latitudeDegrees: 40.3,
        longitudeDegrees: 22.3,
        element: createMarkerElement(),
      }],
    }], {
      showArrows: false,
      strokeWidth: 3,
    });

    expect(manager.fitBoundsToTracks(false)).toBe(true);
    expect(map.fitBounds).toHaveBeenCalledWith(expect.any(MockLngLatBounds), expect.objectContaining({
      animate: false,
      padding: 50,
    }));
    const bounds = map.fitBounds.mock.calls[0][0] as MockLngLatBounds;
    expect(bounds.points).toEqual([
      [22.1, 40.1],
      [22.2, 40.2],
      [22.3, 40.3],
    ]);
  });

  it('can suppress endpoint markers while keeping custom markers for dense route files', () => {
    manager.renderTrackData([{
      id: 'route-1',
      strokeColor: '#1e88e5',
      positions: [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ],
      markers: [{
        id: 'wp-1',
        latitudeDegrees: 40.3,
        longitudeDegrees: 22.3,
        element: createMarkerElement(),
      }],
    }], {
      showArrows: false,
      showEndpointMarkers: false,
      strokeWidth: 3,
    });

    expect(markerFactory.createHomeMarker).not.toHaveBeenCalled();
    expect(markerFactory.createFlagMarker).not.toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalled();
  });
});
