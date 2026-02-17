import { Injectable } from '@angular/core';
import { LoggerService } from '../logger.service';

export interface MapboxStartPointRenderPoint {
  lng: number;
  lat: number;
  properties?: Record<string, string | number | boolean | null>;
}

export interface MapboxStartPointLayerRenderConfig {
  sourceId: string;
  layerId: string;
  hitLayerId: string;
  points: MapboxStartPointRenderPoint[];
  minzoom?: number;
  visibility?: 'visible' | 'none';
  beforeLayerId?: string;
  markerColor?: string;
  markerStrokeColor?: string;
}

export interface MapboxStartPointSelection {
  pointId: string | null;
  lng: number;
  lat: number;
  feature: any;
}

export interface MapboxStartPointInteractionConfig {
  hitLayerId: string;
  interactionLayerId?: string;
  onSelect: (selection: MapboxStartPointSelection) => void;
  onClear: () => void;
}

interface BoundInteractionHandlers {
  layerId: string;
  onLayerClick: (event: any) => void;
  onMapClick: (event: any) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

@Injectable({
  providedIn: 'root'
})
export class MapboxStartPointLayerService {
  private pendingRenderKeysByMap = new WeakMap<any, Set<string>>();
  private interactionHandlersByMap = new WeakMap<any, BoundInteractionHandlers>();

  constructor(private logger: LoggerService) { }

  public renderStartPoints(map: any, config: MapboxStartPointLayerRenderConfig): void {
    if (!map || !config) return;

    if (!Array.isArray(config.points) || !config.points.length) {
      this.clear(map, config);
      return;
    }

    if (!this.isStyleReady(map)) {
      this.logger.log('[MapboxStartPointLayerService] Start-point render deferred; style not ready.', {
        layerId: config.layerId
      });
      this.deferRender(map, `${config.sourceId}:${config.layerId}:${config.hitLayerId}`, () => this.renderStartPoints(map, config));
      return;
    }

    const sourceData = {
      type: 'FeatureCollection',
      features: config.points.map((point) => ({
        type: 'Feature',
        properties: point.properties || {},
        geometry: {
          type: 'Point',
          coordinates: [point.lng, point.lat]
        }
      }))
    };

    const source = map.getSource?.(config.sourceId);
    if (!source) {
      map.addSource(config.sourceId, {
        type: 'geojson',
        data: sourceData
      });
    } else if (typeof source.setData === 'function') {
      source.setData(sourceData);
    }

    const visibility = config.visibility || 'visible';
    const minzoom = config.minzoom ?? 10;

    const markerLayer = {
      id: config.layerId,
      type: 'circle',
      source: config.sourceId,
      minzoom,
      layout: { visibility },
      paint: {
        'circle-color': ['coalesce', ['get', 'markerColor'], config.markerColor || '#2ca3ff'],
        'circle-stroke-color': config.markerStrokeColor || '#f5f8ff',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], minzoom, 5.6, 14, 7.2, 18, 9.6],
        'circle-opacity': 1,
        // Keep marker color readable in Mapbox Standard night lighting.
        'circle-emissive-strength': 1,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], minzoom, 2.6, 18, 3.4],
        'circle-stroke-opacity': 0.96,
        'circle-blur': 0.03
      }
    };

    this.ensureLayer(map, markerLayer, config.beforeLayerId);
    // Ensure any legacy hit layer is removed so it cannot appear as a visual artifact.
    if (map.getLayer?.(config.hitLayerId)) {
      map.removeLayer(config.hitLayerId);
    }
  }

  public bindInteraction(map: any, config: MapboxStartPointInteractionConfig): void {
    if (!map?.on || !config) return;
    this.unbindInteraction(map);
    const layerId = config.interactionLayerId || config.hitLayerId;

    const onLayerClick = (event: any) => {
      const feature = event?.features?.[0];
      if (!feature) {
        config.onClear();
        return;
      }
      const coordinates = feature?.geometry?.coordinates;
      const lng = Array.isArray(coordinates) ? Number(coordinates[0]) : NaN;
      const lat = Array.isArray(coordinates) ? Number(coordinates[1]) : NaN;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        config.onClear();
        return;
      }

      const pointIdRaw = feature?.properties?.pointId;
      const pointId = pointIdRaw === undefined || pointIdRaw === null ? null : String(pointIdRaw);
      config.onSelect({ pointId, lng, lat, feature });
    };

    const onMapClick = (event: any) => {
      if (typeof map.queryRenderedFeatures !== 'function') return;
      const features = map.queryRenderedFeatures(event?.point, { layers: [layerId] }) || [];
      if (Array.isArray(features) && features.length > 0) return;
      config.onClear();
    };

    const onMouseEnter = () => {
      const canvas = map.getCanvas?.();
      if (canvas?.style) {
        canvas.style.cursor = 'pointer';
      }
    };

    const onMouseLeave = () => {
      const canvas = map.getCanvas?.();
      if (canvas?.style) {
        canvas.style.cursor = '';
      }
    };

    map.on('click', layerId, onLayerClick);
    map.on('click', onMapClick);
    map.on('mouseenter', layerId, onMouseEnter);
    map.on('mouseleave', layerId, onMouseLeave);

    this.interactionHandlersByMap.set(map, {
      layerId,
      onLayerClick,
      onMapClick,
      onMouseEnter,
      onMouseLeave
    });
  }

  public unbindInteraction(map: any): void {
    if (!map?.off) return;
    const handlers = this.interactionHandlersByMap.get(map);
    if (!handlers) return;

    map.off('click', handlers.layerId, handlers.onLayerClick);
    map.off('click', handlers.onMapClick);
    map.off('mouseenter', handlers.layerId, handlers.onMouseEnter);
    map.off('mouseleave', handlers.layerId, handlers.onMouseLeave);
    this.interactionHandlersByMap.delete(map);
  }

  public clear(
    map: any,
    ids: Pick<MapboxStartPointLayerRenderConfig, 'sourceId' | 'layerId' | 'hitLayerId'>
  ): void {
    if (!map || !ids) return;
    this.unbindInteraction(map);

    if (map.getLayer?.(ids.hitLayerId)) {
      map.removeLayer(ids.hitLayerId);
    }
    if (map.getLayer?.(ids.layerId)) {
      map.removeLayer(ids.layerId);
    }
    if (map.getSource?.(ids.sourceId)) {
      map.removeSource(ids.sourceId);
    }
  }

  private ensureLayer(map: any, layer: any, beforeLayerId?: string): void {
    if (!map.getLayer?.(layer.id)) {
      if (beforeLayerId) {
        map.addLayer(layer, beforeLayerId);
      } else {
        map.addLayer(layer);
      }
      return;
    }

    if (beforeLayerId && typeof map.moveLayer === 'function') {
      map.moveLayer(layer.id, beforeLayerId);
    }
    if (typeof map.setLayoutProperty === 'function') {
      map.setLayoutProperty(layer.id, 'visibility', layer.layout?.visibility || 'visible');
    }
    if (layer.paint && typeof map.setPaintProperty === 'function') {
      Object.entries(layer.paint).forEach(([property, value]) => {
        map.setPaintProperty(layer.id, property, value);
      });
    }
  }

  private isStyleReady(map: any): boolean {
    if (!map) return false;
    if (typeof map.isStyleLoaded === 'function') {
      return map.isStyleLoaded();
    }
    if (typeof map.loaded === 'function') {
      return map.loaded();
    }
    return true;
  }

  private deferRender(map: any, key: string, callback: () => void): void {
    if (!map?.on || !key) return;
    const pendingKeys = this.getPendingKeySet(map);
    if (pendingKeys.has(key)) return;
    pendingKeys.add(key);

    const tryRun = () => {
      if (!this.isStyleReady(map)) return;
      pendingKeys.delete(key);
      if (map?.off) {
        map.off('style.load', tryRun);
        map.off('styledata', tryRun);
        map.off('load', tryRun);
        map.off('idle', tryRun);
      }
      callback();
    };

    map.on('style.load', tryRun);
    map.on('styledata', tryRun);
    map.on('load', tryRun);
    map.on('idle', tryRun);
    tryRun();
  }

  private getPendingKeySet(map: any): Set<string> {
    let keySet = this.pendingRenderKeysByMap.get(map);
    if (!keySet) {
      keySet = new Set<string>();
      this.pendingRenderKeysByMap.set(map, keySet);
    }
    return keySet;
  }
}
