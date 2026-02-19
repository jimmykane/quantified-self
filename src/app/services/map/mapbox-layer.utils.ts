import { MapboxLikeMap } from './mapbox-style-ready.utils';

export interface LayerDescriptor {
  id: string;
  type: string;
  source: string;
  layout?: Record<string, any>;
  paint?: Record<string, any>;
  [key: string]: any;
}

export interface LayerBindingEntry {
  event: string;
  layerId: string;
  handler: (event: any) => void;
}

export type LayerBindingRegistry = LayerBindingEntry[];

export interface GeoJsonSourceOptions {
  cluster?: boolean;
  clusterRadius?: number;
  clusterMaxZoom?: number;
  generateId?: boolean;
}

export function upsertGeoJsonSource(
  map: MapboxLikeMap | null | undefined,
  sourceId: string,
  feature: any,
  options: GeoJsonSourceOptions = {}
): void {
  if (!map) return;

  const source = map.getSource?.(sourceId);
  if (!source) {
    map.addSource?.(sourceId, {
      type: 'geojson',
      data: feature,
      ...options,
    });
    return;
  }

  if (typeof source.setData === 'function') {
    source.setData(feature);
  }
}

export function ensureLayer(
  map: MapboxLikeMap | null | undefined,
  layer: LayerDescriptor,
  beforeLayerId?: string
): void {
  if (!map) return;
  if (map.getLayer?.(layer.id)) return;

  if (beforeLayerId) {
    map.addLayer?.(layer, beforeLayerId);
    return;
  }
  map.addLayer?.(layer);
}

export function removeLayerIfExists(map: MapboxLikeMap | null | undefined, layerId: string): void {
  if (!map) return;
  if (!map.getLayer?.(layerId)) return;
  map.removeLayer?.(layerId);
}

export function removeSourceIfExists(map: MapboxLikeMap | null | undefined, sourceId: string): void {
  if (!map) return;
  if (!map.getSource?.(sourceId)) return;
  map.removeSource?.(sourceId);
}

export function setPaintIfLayerExists(
  map: MapboxLikeMap | null | undefined,
  layerId: string,
  paint: Record<string, any>
): void {
  if (!map?.setPaintProperty) return;
  if (!map.getLayer?.(layerId)) return;

  Object.entries(paint).forEach(([property, value]) => {
    map.setPaintProperty?.(layerId, property, value);
  });
}

export function bindLayerClickOnce(
  map: MapboxLikeMap | null | undefined,
  registry: LayerBindingRegistry,
  layerId: string,
  handler: (event: any) => void
): void {
  if (!map?.on) return;
  if (!map.getLayer?.(layerId)) return;
  if (registry.some((binding) => binding.event === 'click' && binding.layerId === layerId)) {
    return;
  }
  map.on('click', layerId, handler);
  registry.push({ event: 'click', layerId, handler });
}

export function unbindLayerClicks(
  map: MapboxLikeMap | null | undefined,
  registry: LayerBindingRegistry,
  layerId?: string
): void {
  if (!registry.length) return;

  const retained: LayerBindingRegistry = [];
  registry.forEach((binding) => {
    if (layerId && binding.layerId !== layerId) {
      retained.push(binding);
      return;
    }
    map?.off?.(binding.event, binding.layerId, binding.handler);
  });

  registry.splice(0, registry.length, ...retained);
}
