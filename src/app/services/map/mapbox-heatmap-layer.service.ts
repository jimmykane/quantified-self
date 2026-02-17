import { Injectable } from '@angular/core';
import { LoggerService } from '../logger.service';

export interface MapboxHeatmapRenderConfig {
  sourceId: string;
  layerId: string;
  featureCollection: { type: 'FeatureCollection'; features: any[] };
  paint: Record<string, any>;
  maxzoom?: number;
  visibility?: 'visible' | 'none';
  beforeLayerId?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MapboxHeatmapLayerService {
  private pendingRenderLayersByMap = new WeakMap<any, Set<string>>();

  constructor(private logger: LoggerService) { }

  public renderGeoJsonHeatmapLayer(map: any, config: MapboxHeatmapRenderConfig): void {
    if (!map || !config) return;

    if (!config.featureCollection?.features?.length) {
      this.clearLayerAndSource(map, config.sourceId, config.layerId);
      return;
    }

    if (!this.isStyleReady(map)) {
      this.logger.log('[MapboxHeatmapLayerService] Heatmap render deferred; style not ready.', {
        layerId: config.layerId
      });
      this.deferRender(map, config.layerId, () => this.renderGeoJsonHeatmapLayer(map, config));
      return;
    }

    const visibility = config.visibility || 'visible';
    const existingSource = map.getSource?.(config.sourceId);

    if (!existingSource) {
      map.addSource(config.sourceId, {
        type: 'geojson',
        data: config.featureCollection
      });
    } else if (typeof existingSource.setData === 'function') {
      existingSource.setData(config.featureCollection);
    }

    const layerDefinition = {
      id: config.layerId,
      type: 'heatmap',
      source: config.sourceId,
      maxzoom: config.maxzoom ?? 18,
      layout: {
        visibility
      },
      paint: {
        ...(config.paint || {})
      }
    };

    if (!map.getLayer?.(config.layerId)) {
      if (config.beforeLayerId) {
        map.addLayer(layerDefinition, config.beforeLayerId);
      } else {
        map.addLayer(layerDefinition);
      }
      return;
    }

    if (config.beforeLayerId && typeof map.moveLayer === 'function') {
      map.moveLayer(config.layerId, config.beforeLayerId);
    }
    if (typeof map.setLayoutProperty === 'function') {
      map.setLayoutProperty(config.layerId, 'visibility', visibility);
    }
  }

  public setLayerVisibility(map: any, layerId: string, visible: boolean): void {
    if (!map || !layerId) return;
    if (!this.isStyleReady(map)) {
      this.deferRender(map, layerId, () => this.setLayerVisibility(map, layerId, visible));
      return;
    }
    if (!map.getLayer?.(layerId)) return;
    if (typeof map.setLayoutProperty === 'function') {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }

  public clearLayerAndSource(map: any, sourceId: string, layerId: string): void {
    if (!map) return;
    if (map.getLayer?.(layerId)) {
      map.removeLayer(layerId);
    }
    if (map.getSource?.(sourceId)) {
      map.removeSource(sourceId);
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

  private deferRender(map: any, layerId: string, callback: () => void): void {
    if (!map?.on || !layerId) return;

    const pendingLayers = this.getPendingLayerSet(map);
    if (pendingLayers.has(layerId)) return;
    pendingLayers.add(layerId);

    const tryRun = () => {
      if (!this.isStyleReady(map)) return;

      pendingLayers.delete(layerId);
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

  private getPendingLayerSet(map: any): Set<string> {
    let layerSet = this.pendingRenderLayersByMap.get(map);
    if (!layerSet) {
      layerSet = new Set<string>();
      this.pendingRenderLayersByMap.set(map, layerSet);
    }
    return layerSet;
  }
}

