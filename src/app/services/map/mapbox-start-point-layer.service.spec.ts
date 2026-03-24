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
    expect(markerLayerCall?.[0]?.minzoom).toBe(10);
    expect(mockMap.addLayer.mock.calls.some((call: any[]) => call[0]?.id === 'track-start-hit-layer')).toBe(false);
  });

  it('should bind interaction and emit selection/clear events', () => {
    const onSelect = vi.fn();
    const onClear = vi.fn();

    service.bindInteraction(mockMap, {
      hitLayerId: 'track-start-hit-layer',
      interactionLayerId: 'track-start-layer',
      onSelect,
      onClear
    });

    const layerClickHandler = mockMap.on.mock.calls.find(
      (call: any[]) => call[0] === 'click' && call[1] === 'track-start-layer'
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
      interactionLayerId: 'track-start-layer',
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

  it('should not throw when clear runs during style teardown', () => {
    mockMap.getLayer.mockImplementation(() => {
      throw new TypeError('undefined is not an object (evaluating "this.style.getOwnLayer")');
    });
    mockMap.getSource.mockImplementation(() => {
      throw new TypeError('undefined is not an object (evaluating "this.style.getOwnSource")');
    });

    expect(() => service.clear(mockMap, {
      sourceId: 'track-start-source',
      layerId: 'track-start-layer',
      hitLayerId: 'track-start-hit-layer'
    })).not.toThrow();

    expect(mockMap.removeLayer).not.toHaveBeenCalled();
    expect(mockMap.removeSource).not.toHaveBeenCalled();
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

  it('should replace a deferred render with the latest points for the same layer key', () => {
    mockMap.isStyleLoaded.mockReturnValue(false);

    service.renderStartPoints(mockMap, {
      sourceId: 'track-start-source',
      layerId: 'track-start-layer',
      hitLayerId: 'track-start-hit-layer',
      points: [{ lng: 20, lat: 40, properties: { pointId: 'old-point' } }]
    });

    service.renderStartPoints(mockMap, {
      sourceId: 'track-start-source',
      layerId: 'track-start-layer',
      hitLayerId: 'track-start-hit-layer',
      points: [{ lng: 30, lat: 50, properties: { pointId: 'new-point' } }]
    });

    const styleLoadHandlers = mockMap.on.mock.calls.filter(
      (call: any[]) => call[0] === 'style.load' && typeof call[1] === 'function'
    );
    expect(styleLoadHandlers).toHaveLength(1);

    mockMap.isStyleLoaded.mockReturnValue(true);
    const styleLoadHandler = styleLoadHandlers[0][1];
    styleLoadHandler();

    expect(mockMap.addSource).toHaveBeenCalledTimes(1);
    const sourceData = mockMap.addSource.mock.calls[0][1]?.data;
    expect(sourceData?.features).toEqual([
      expect.objectContaining({
        properties: { pointId: 'new-point' },
        geometry: expect.objectContaining({
          coordinates: [30, 50],
        }),
      }),
    ]);
  });

  it('should cancel deferred renders when the layer is cleared', () => {
    mockMap.isStyleLoaded.mockReturnValue(false);

    service.renderStartPoints(mockMap, {
      sourceId: 'track-start-source',
      layerId: 'track-start-layer',
      hitLayerId: 'track-start-hit-layer',
      points: [{ lng: 20, lat: 40, properties: { pointId: 'p1' } }]
    });

    const styleLoadHandler = mockMap.on.mock.calls.find(
      (call: any[]) => call[0] === 'style.load' && typeof call[1] === 'function'
    )?.[1];

    service.clear(mockMap, {
      sourceId: 'track-start-source',
      layerId: 'track-start-layer',
      hitLayerId: 'track-start-hit-layer'
    });

    mockMap.isStyleLoaded.mockReturnValue(true);
    styleLoadHandler?.();

    expect(mockMap.addSource).not.toHaveBeenCalled();
    expect(mockMap.off).toHaveBeenCalledWith('style.load', expect.any(Function));
  });

  it('should refresh paint on existing layers', () => {
    mockMap.getSource.mockReturnValue({ setData: vi.fn() });
    mockMap.getLayer.mockImplementation((id: string) => id === 'track-start-layer' || id === 'track-start-hit-layer');

    service.renderStartPoints(mockMap, {
      sourceId: 'track-start-source',
      layerId: 'track-start-layer',
      hitLayerId: 'track-start-hit-layer',
      markerColor: '#ffffff',
      markerStrokeColor: '#000000',
      points: [{ lng: 20, lat: 40, properties: { pointId: 'p1' } }]
    });

    expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
      'track-start-layer',
      'circle-color',
      expect.arrayContaining(['coalesce'])
    );
    expect(mockMap.setPaintProperty).toHaveBeenCalledWith('track-start-layer', 'circle-stroke-color', '#000000');
    expect(mockMap.moveLayer).toHaveBeenCalledWith('track-start-layer');
  });
});
