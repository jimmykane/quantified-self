import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapboxStartPointLayerService } from './mapbox-start-point-layer.service';

describe('MapboxStartPointLayerService', () => {
  let service: MapboxStartPointLayerService;
  let mockMap: any;

  beforeEach(() => {
    mockMap = {
      addSource: vi.fn(),
      getSource: vi.fn().mockReturnValue(null),
      addLayer: vi.fn(),
      getLayer: vi.fn().mockReturnValue(null),
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      moveLayer: vi.fn(),
      setLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
      isStyleLoaded: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      off: vi.fn(),
      queryRenderedFeatures: vi.fn().mockReturnValue([]),
      getCanvas: vi.fn().mockReturnValue({ style: { cursor: '' } })
    };

    service = new MapboxStartPointLayerService({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as any);
  });

  it('should render source and layers with minzoom', () => {
    service.renderStartPoints(mockMap, {
      sourceId: 'track-start-source',
      layerId: 'track-start-layer',
      hitLayerId: 'track-start-hit-layer',
      minzoom: 10,
      points: [{ lng: 20, lat: 40, properties: { pointId: 'p1' } }]
    });

    expect(mockMap.addSource).toHaveBeenCalledWith(
      'track-start-source',
      expect.objectContaining({ type: 'geojson' })
    );
    const markerLayerCall = mockMap.addLayer.mock.calls.find((call: any[]) => call[0]?.id === 'track-start-layer');
    const hitLayerCall = mockMap.addLayer.mock.calls.find((call: any[]) => call[0]?.id === 'track-start-hit-layer');
    expect(markerLayerCall?.[0]?.minzoom).toBe(10);
    expect(hitLayerCall?.[0]?.minzoom).toBe(10);
  });

  it('should bind interaction and emit selection/clear events', () => {
    const onSelect = vi.fn();
    const onClear = vi.fn();

    service.bindInteraction(mockMap, {
      hitLayerId: 'track-start-hit-layer',
      onSelect,
      onClear
    });

    const layerClickHandler = mockMap.on.mock.calls.find(
      (call: any[]) => call[0] === 'click' && call[1] === 'track-start-hit-layer'
    )?.[2];
    const mapClickHandler = mockMap.on.mock.calls.find(
      (call: any[]) => call[0] === 'click' && typeof call[1] === 'function'
    )?.[1];

    layerClickHandler?.({
      features: [{
        properties: { pointId: 'p1' },
        geometry: { coordinates: [10, 20] }
      }]
    });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      pointId: 'p1',
      lng: 10,
      lat: 20
    }));

    mockMap.queryRenderedFeatures.mockReturnValue([]);
    mapClickHandler?.({ point: { x: 12, y: 34 } });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('should clear layers/source and unbind interactions', () => {
    mockMap.getLayer.mockImplementation((id: string) => id === 'track-start-layer' || id === 'track-start-hit-layer');
    mockMap.getSource.mockImplementation((id: string) => id === 'track-start-source');

    service.bindInteraction(mockMap, {
      hitLayerId: 'track-start-hit-layer',
      onSelect: vi.fn(),
      onClear: vi.fn()
    });

    service.clear(mockMap, {
      sourceId: 'track-start-source',
      layerId: 'track-start-layer',
      hitLayerId: 'track-start-hit-layer'
    });

    expect(mockMap.removeLayer).toHaveBeenCalledWith('track-start-hit-layer');
    expect(mockMap.removeLayer).toHaveBeenCalledWith('track-start-layer');
    expect(mockMap.removeSource).toHaveBeenCalledWith('track-start-source');
    expect(mockMap.off).toHaveBeenCalled();
  });

  it('should defer rendering until style is ready', () => {
    mockMap.isStyleLoaded.mockReturnValue(false);

    service.renderStartPoints(mockMap, {
      sourceId: 'track-start-source',
      layerId: 'track-start-layer',
      hitLayerId: 'track-start-hit-layer',
      points: [{ lng: 20, lat: 40, properties: { pointId: 'p1' } }]
    });

    expect(mockMap.addSource).not.toHaveBeenCalled();

    const styleLoadHandler = mockMap.on.mock.calls.find(
      (call: any[]) => call[0] === 'style.load' && typeof call[1] === 'function'
    )?.[1];
    mockMap.isStyleLoaded.mockReturnValue(true);
    styleLoadHandler?.();

    expect(mockMap.addSource).toHaveBeenCalled();
  });
});

