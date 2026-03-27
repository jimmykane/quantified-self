import { describe, expect, it, vi } from 'vitest';
import {
  buildMapSearchScopeOverlayFeatureCollection,
  removeMapSearchScopeOverlay,
  resolveMapSearchScopeFitCoordinates,
  upsertMapSearchScopeOverlay,
} from './map-search-scope-overlay.utils';

describe('map-search-scope-overlay.utils', () => {
  it('builds a closed polygon ring for radius scopes', () => {
    const featureCollection = buildMapSearchScopeOverlayFeatureCollection({
      mode: 'radius',
      center: {
        latitudeDegrees: 38.245506,
        longitudeDegrees: 21.734795,
      },
      radiusKm: 50,
    }, {
      label: 'Patras radius',
    });

    expect(featureCollection).not.toBeNull();
    expect(featureCollection?.features[0]?.geometry?.type).toBe('Polygon');
    const ring = featureCollection?.features[0]?.geometry?.coordinates?.[0] as number[][];
    expect(ring.length).toBeGreaterThan(20);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(featureCollection?.features[0]?.properties?.label).toBe('Patras radius');
  });

  it('builds a polygon for non-wrapped bbox scopes', () => {
    const featureCollection = buildMapSearchScopeOverlayFeatureCollection({
      mode: 'bbox',
      bbox: {
        west: 19.3736,
        south: 34.8021,
        east: 28.2471,
        north: 41.7485,
      },
    });

    expect(featureCollection).not.toBeNull();
    expect(featureCollection?.features[0]?.geometry?.type).toBe('Polygon');
    expect(featureCollection?.features[0]?.geometry?.coordinates?.[0]).toEqual([
      [19.3736, 34.8021],
      [28.2471, 34.8021],
      [28.2471, 41.7485],
      [19.3736, 41.7485],
      [19.3736, 34.8021],
    ]);
  });

  it('builds a multipolygon for anti-meridian bbox scopes', () => {
    const featureCollection = buildMapSearchScopeOverlayFeatureCollection({
      mode: 'bbox',
      bbox: {
        west: 170,
        south: -10,
        east: -170,
        north: 10,
      },
    });

    expect(featureCollection).not.toBeNull();
    expect(featureCollection?.features[0]?.geometry?.type).toBe('MultiPolygon');
    expect(featureCollection?.features[0]?.geometry?.coordinates?.length).toBe(2);
  });

  it('returns fit coordinates for radius and bbox scopes', () => {
    const radiusCoordinates = resolveMapSearchScopeFitCoordinates({
      mode: 'radius',
      center: {
        latitudeDegrees: 38.245506,
        longitudeDegrees: 21.734795,
      },
      radiusKm: 50,
    });
    const bboxCoordinates = resolveMapSearchScopeFitCoordinates({
      mode: 'bbox',
      bbox: {
        west: 170,
        south: -10,
        east: -170,
        north: 10,
      },
    });

    expect(radiusCoordinates.length).toBeGreaterThan(20);
    expect(radiusCoordinates[0]).toEqual([21.734795, 38.245506]);
    expect(bboxCoordinates.some(([lng]) => lng === 170)).toBe(true);
    expect(bboxCoordinates.some(([lng]) => lng === -170)).toBe(true);
  });

  it('upserts and removes overlay layers and source', () => {
    const layerState = new Set<string>();
    const sourceState = new Map<string, any>();
    const map = {
      getLayer: vi.fn((id: string) => (layerState.has(id) ? { id } : null)),
      addLayer: vi.fn((layer: any) => {
        layerState.add(layer.id);
      }),
      removeLayer: vi.fn((id: string) => {
        layerState.delete(id);
      }),
      getSource: vi.fn((id: string) => sourceState.get(id) || null),
      addSource: vi.fn((id: string, source: any) => {
        sourceState.set(id, {
          ...source,
          setData: vi.fn(),
        });
      }),
      removeSource: vi.fn((id: string) => {
        sourceState.delete(id);
      }),
      setPaintProperty: vi.fn(),
    };

    const featureCollection = buildMapSearchScopeOverlayFeatureCollection({
      mode: 'radius',
      center: {
        latitudeDegrees: 38.245506,
        longitudeDegrees: 21.734795,
      },
      radiusKm: 50,
    });

    expect(featureCollection).not.toBeNull();
    upsertMapSearchScopeOverlay(map as any, {
      sourceId: 'scope-source',
      fillLayerId: 'scope-fill',
      outlineLayerId: 'scope-outline',
      featureCollection: featureCollection as { type: 'FeatureCollection'; features: any[] },
      fillPaint: { 'fill-color': '#22c55e', 'fill-opacity': 0.1 },
      outlinePaint: { 'line-color': '#15803d', 'line-width': 2 },
    });

    expect(map.addSource).toHaveBeenCalledWith('scope-source', expect.objectContaining({
      type: 'geojson',
    }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'scope-fill' }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'scope-outline' }));

    removeMapSearchScopeOverlay(map as any, 'scope-source', 'scope-fill', 'scope-outline');
    expect(map.removeLayer).toHaveBeenCalledWith('scope-outline');
    expect(map.removeLayer).toHaveBeenCalledWith('scope-fill');
    expect(map.removeSource).toHaveBeenCalledWith('scope-source');
  });
});
