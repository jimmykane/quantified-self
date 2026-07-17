import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggerService } from '../logger.service';
import { MarkerFactoryService } from './marker-factory.service';
import { TrackMapManager } from './track-map.manager';

const createMarkerElement = () => document.createElement('div');

class MockMapboxMarker {
  public lngLat: [number, number] | null = null;
  public added = false;
  public element: HTMLElement | null;

  constructor(options?: any) {
    this.element = options?.element || null;
  }

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

  getElement() {
    return this.element;
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
      createEndpointDotMarker: vi.fn(() => createMarkerElement()),
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

  it('renders compact endpoint dots when requested', () => {
    manager.renderTrackData([{
      id: 'route-1',
      label: 'Morning route',
      strokeColor: '#1e88e5',
      positions: [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ],
    }], {
      showArrows: false,
      endpointMarkerStyle: 'dots',
      strokeWidth: 3,
    });

    expect(markerFactory.createEndpointDotMarker).toHaveBeenNthCalledWith(1, {
      color: '#1e88e5',
      endpoint: 'start',
      title: 'Morning route start',
      ariaLabel: 'Morning route start',
    });
    expect(markerFactory.createEndpointDotMarker).toHaveBeenNthCalledWith(2, {
      color: '#1e88e5',
      endpoint: 'end',
      title: 'Morning route end',
      ariaLabel: 'Morning route end',
    });
    expect(markerFactory.createHomeMarker).not.toHaveBeenCalled();
    expect(markerFactory.createFlagMarker).not.toHaveBeenCalled();
  });

  it('detaches style lifecycle handlers when cleared', () => {
    const styleLoadHandler = map.on.mock.calls.find((call: any[]) => call[0] === 'style.load')?.[1];
    expect(styleLoadHandler).toEqual(expect.any(Function));

    manager.clearAll();

    expect(map.off).toHaveBeenCalledWith('style.load', styleLoadHandler);
    map.addSource.mockClear();
    styleLoadHandler();

    expect(map.addSource).not.toHaveBeenCalled();
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

  it('retries track rendering when source creation fails during a style swap', () => {
    map.isStyleLoaded.mockReturnValue(true);
    map.addSource.mockImplementation(() => {
      throw new Error('Style is not done loading');
    });

    expect(() => manager.renderTrackData([{
      id: 'route-style-swap',
      label: 'Style Swap Route',
      strokeColor: '#1e88e5',
      positions: [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ],
    }], {
      showArrows: true,
      strokeWidth: 4,
    })).not.toThrow();

    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.on).toHaveBeenCalledWith('idle', expect.any(Function));

    map.addSource.mockReset();
    map.addSource.mockImplementation((sourceId: string) => sourceState.add(sourceId));
    map.getSource.mockImplementation((sourceId: string) => sourceState.has(sourceId) ? { setData: vi.fn() } : null);
    map.getLayer.mockImplementation((layerId: string) => layerState.has(layerId));

    map.on.mock.calls
      .filter((call: any[]) => call[0] === 'idle')
      .forEach((call: any[]) => call[1]());

    expect(map.addSource).toHaveBeenCalledWith(
      expect.stringMatching(/^route-track-source-route-style-swap-[a-z0-9]+$/),
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^route-track-line-route-style-swap-[a-z0-9]+$/),
    }));
  });

  it('retries track rendering when layer lookup fails during a style swap', () => {
    map.isStyleLoaded.mockReturnValue(true);
    map.getLayer.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'getOwnLayer')");
    });

    expect(() => manager.renderTrackData([{
      id: 'route-layer-swap',
      label: 'Layer Swap Route',
      strokeColor: '#43a047',
      positions: [
        { latitudeDegrees: 41.1, longitudeDegrees: 23.1 },
        { latitudeDegrees: 41.2, longitudeDegrees: 23.2 },
      ],
    }], {
      showArrows: false,
      strokeWidth: 5,
    })).not.toThrow();

    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.on).toHaveBeenCalledWith('idle', expect.any(Function));

    map.getLayer.mockReset();
    map.getLayer.mockImplementation((layerId: string) => layerState.has(layerId));

    map.on.mock.calls
      .filter((call: any[]) => call[0] === 'idle')
      .forEach((call: any[]) => call[1]());

    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^route-track-line-route-layer-swap-[a-z0-9]+$/),
      paint: expect.objectContaining({
        'line-color': '#43a047',
        'line-width': 5,
      }),
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

  it('binds and cleans wide track hit-area click handlers', () => {
    const onTrackClick = vi.fn();
    manager.renderTrackData([{
      id: 'route-click',
      label: 'Clickable route',
      strokeColor: '#1e88e5',
      positions: [
        { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
        { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
      ],
    }], {
      showArrows: false,
      strokeWidth: 3,
      onTrackClick,
    });

    const hitLayer = map.addLayer.mock.calls
      .map((call: any[]) => call[0])
      .find((layer: any) => String(layer.id).startsWith('route-track-hit-route-click-'));
    expect(hitLayer).toEqual(expect.objectContaining({
      type: 'line',
      paint: expect.objectContaining({
        'line-width': expect.any(Number),
        'line-opacity': 0.001,
      }),
    }));
    expect(hitLayer.paint['line-width']).toBeGreaterThanOrEqual(18);

    const clickBinding = map.on.mock.calls.find((call: any[]) => (
      call[0] === 'click'
      && String(call[1]).startsWith('route-track-hit-route-click-')
    ));
    expect(clickBinding).toBeTruthy();

    clickBinding?.[2]({ lngLat: { lng: 22.15, lat: 40.15 } });

    expect(onTrackClick).toHaveBeenCalledWith(expect.objectContaining({
      track: expect.objectContaining({ id: 'route-click' }),
      longitudeDegrees: 22.15,
      latitudeDegrees: 40.15,
    }));

    onTrackClick.mockClear();
    const startMarkerElement = markerFactory.createHomeMarker.mock.results[0]?.value as HTMLElement;
    startMarkerElement.click();
    expect(onTrackClick).toHaveBeenCalledWith(expect.objectContaining({
      track: expect.objectContaining({ id: 'route-click' }),
      longitudeDegrees: 22.1,
      latitudeDegrees: 40.1,
      originalEvent: expect.any(MouseEvent),
    }));

    manager.renderTrackData([], {
      showArrows: false,
      strokeWidth: 3,
    });

    expect(map.off).toHaveBeenCalledWith('click', clickBinding?.[1], clickBinding?.[2]);
    onTrackClick.mockClear();
    startMarkerElement.click();
    expect(onTrackClick).not.toHaveBeenCalled();
    expect(startMarkerElement.style.cursor).toBe('');
  });

  it('combines dense track collections into one source while preserving colors and clicks', () => {
    const combinedManager = new TrackMapManager(markerFactory, {
      log: vi.fn(),
      warn: vi.fn(),
    } as unknown as LoggerService, {
      layerPrefix: 'route-preview',
      logPrefix: 'RoutePreviewMapManager',
      combineTrackLayers: true,
    });
    combinedManager.setMap(map, { Marker: MockMapboxMarker, LngLatBounds: MockLngLatBounds });
    map.addSource.mockClear();
    map.addLayer.mockClear();
    const onTrackClick = vi.fn();

    combinedManager.renderTrackData([
      {
        id: 'route-1',
        strokeColor: '#1e88e5',
        positions: [
          { latitudeDegrees: 40.1, longitudeDegrees: 22.1 },
          { latitudeDegrees: 40.2, longitudeDegrees: 22.2 },
        ],
      },
      {
        id: 'route-2',
        strokeColor: '#43a047',
        positions: [
          { latitudeDegrees: 41.1, longitudeDegrees: 23.1 },
          { latitudeDegrees: 41.2, longitudeDegrees: 23.2 },
        ],
      },
    ], {
      showArrows: false,
      showEndpointMarkers: false,
      strokeWidth: 3,
      onTrackClick,
    });

    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledWith('route-preview-combined-source', {
      type: 'geojson',
      data: expect.objectContaining({
        type: 'FeatureCollection',
        features: [
          expect.objectContaining({ properties: expect.objectContaining({ trackId: 'route-1', strokeColor: '#1e88e5' }) }),
          expect.objectContaining({ properties: expect.objectContaining({ trackId: 'route-2', strokeColor: '#43a047' }) }),
        ],
      }),
    });
    expect(map.addLayer).toHaveBeenCalledTimes(2);
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'route-preview-combined-line',
      paint: expect.objectContaining({ 'line-color': ['get', 'strokeColor'] }),
    }));
    expect((combinedManager as any).extraMarkers.size).toBe(0);

    const clickBinding = map.on.mock.calls.find((call: any[]) => (
      call[0] === 'click' && call[1] === 'route-preview-combined-hit'
    ));
    clickBinding?.[2]({
      features: [{ properties: { trackId: 'route-2' } }],
      lngLat: { lng: 23.15, lat: 41.15 },
    });

    expect(onTrackClick).toHaveBeenCalledWith(expect.objectContaining({
      track: expect.objectContaining({ id: 'route-2' }),
      longitudeDegrees: 23.15,
      latitudeDegrees: 41.15,
    }));

    combinedManager.renderTrackData([], {
      showArrows: false,
      showEndpointMarkers: false,
      strokeWidth: 3,
      onTrackClick,
    });

    expect(map.off).toHaveBeenCalledWith('click', 'route-preview-combined-hit', clickBinding?.[2]);
    expect(map.removeLayer).toHaveBeenCalledWith('route-preview-combined-hit');
    expect(map.removeLayer).toHaveBeenCalledWith('route-preview-combined-line');
    expect(map.removeSource).toHaveBeenCalledWith('route-preview-combined-source');
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
