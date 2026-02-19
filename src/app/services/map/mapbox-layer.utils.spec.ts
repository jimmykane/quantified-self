import { describe, expect, it, vi } from 'vitest';
import {
  bindLayerClickOnce,
  ensureLayer,
  LayerBindingRegistry,
  removeLayerIfExists,
  removeSourceIfExists,
  setPaintIfLayerExists,
  unbindLayerClicks,
  upsertGeoJsonSource,
} from './mapbox-layer.utils';

describe('mapbox-layer.utils', () => {
  it('upsertGeoJsonSource adds a missing source', () => {
    const map = {
      getSource: vi.fn().mockReturnValue(null),
      addSource: vi.fn(),
    };
    const feature = { type: 'FeatureCollection', features: [] };

    upsertGeoJsonSource(map as any, 's1', feature);

    expect(map.addSource).toHaveBeenCalledWith('s1', expect.objectContaining({
      type: 'geojson',
      data: feature,
    }));
  });

  it('upsertGeoJsonSource updates existing source data via setData', () => {
    const setData = vi.fn();
    const map = {
      getSource: vi.fn().mockReturnValue({ setData }),
      addSource: vi.fn(),
    };

    upsertGeoJsonSource(map as any, 's1', { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });

    expect(setData).toHaveBeenCalledTimes(1);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it('upsertGeoJsonSource forwards source options on creation', () => {
    const map = {
      getSource: vi.fn().mockReturnValue(null),
      addSource: vi.fn(),
    };

    upsertGeoJsonSource(map as any, 's1', { type: 'FeatureCollection', features: [] }, {
      cluster: true,
      clusterRadius: 60,
    });

    expect(map.addSource).toHaveBeenCalledWith('s1', expect.objectContaining({
      cluster: true,
      clusterRadius: 60,
    }));
  });

  it('ensureLayer only adds when missing', () => {
    const existing = new Set<string>();
    const map = {
      getLayer: vi.fn((layerId: string) => existing.has(layerId)),
      addLayer: vi.fn((layer: any) => existing.add(layer.id)),
    };

    ensureLayer(map as any, { id: 'track-layer-1', type: 'line', source: 'track-source-1' });
    ensureLayer(map as any, { id: 'track-layer-1', type: 'line', source: 'track-source-1' });

    expect(map.addLayer).toHaveBeenCalledTimes(1);
  });

  it('setPaintIfLayerExists updates all provided paint properties', () => {
    const map = {
      getLayer: vi.fn().mockReturnValue(true),
      setPaintProperty: vi.fn(),
    };

    setPaintIfLayerExists(map as any, 'track-layer-1', {
      'line-color': '#2ca3ff',
      'line-width': 3,
    });

    expect(map.setPaintProperty).toHaveBeenCalledWith('track-layer-1', 'line-color', '#2ca3ff');
    expect(map.setPaintProperty).toHaveBeenCalledWith('track-layer-1', 'line-width', 3);
  });

  it('bindLayerClickOnce and unbindLayerClicks manage click bindings without duplicates', () => {
    const map = {
      getLayer: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      off: vi.fn(),
    };
    const registry: LayerBindingRegistry = [];
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    bindLayerClickOnce(map as any, registry, 'track-layer-1', handlerA);
    bindLayerClickOnce(map as any, registry, 'track-layer-1', handlerB);

    expect(map.on).toHaveBeenCalledTimes(1);
    expect(registry.length).toBe(1);

    unbindLayerClicks(map as any, registry, 'track-layer-1');
    expect(map.off).toHaveBeenCalledWith('click', 'track-layer-1', handlerA);
    expect(registry.length).toBe(0);
  });

  it('remove helpers only remove existing resources', () => {
    const map = {
      getLayer: vi.fn((layerId: string) => layerId === 'existing-layer'),
      removeLayer: vi.fn(),
      getSource: vi.fn((sourceId: string) => sourceId === 'existing-source'),
      removeSource: vi.fn(),
    };

    removeLayerIfExists(map as any, 'missing-layer');
    removeLayerIfExists(map as any, 'existing-layer');
    removeSourceIfExists(map as any, 'missing-source');
    removeSourceIfExists(map as any, 'existing-source');

    expect(map.removeLayer).toHaveBeenCalledTimes(1);
    expect(map.removeLayer).toHaveBeenCalledWith('existing-layer');
    expect(map.removeSource).toHaveBeenCalledTimes(1);
    expect(map.removeSource).toHaveBeenCalledWith('existing-source');
  });
});
