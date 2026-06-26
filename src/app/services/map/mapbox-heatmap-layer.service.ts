import { Injectable } from '@angular/core';
import { LoggerService } from '../logger.service';
import { isStyleReady, shouldDeferForMapboxStyle } from './mapbox-style-ready.utils';

export interface MapboxHeatmapRenderConfig {
  sourceId: string;
  layerId: string;
  featureCollection: { type: 'FeatureCollection'; features: any[] };
  paint: Record<string, any>;
  maxzoom?: number;
  visibility?: 'visible' | 'none';
  beforeLayerId?: string;
}

interface DeferredHeatmapRenderRegistration {
  callback: () => void;
  tryRun: () => void;
}

@Injectable({
  providedIn: 'root'
})
export class MapboxHeatmapLayerService {
  private pendingRendersByMap = new WeakMap<any, Map<string, DeferredHeatmapRenderRegistration>>();

  constructor(private logger: LoggerService) { }

  public renderGeoJsonHeatmapLayer(map: any, config: MapboxHeatmapRenderConfig): void {
    if (!map || !config) return;
    const pendingRenderKey = this.buildPendingRenderKey(config.layerId);

    if (!config.featureCollection?.features?.length) {
      this.clearLayerAndSource(map, config.sourceId, config.layerId);
      return;
    }

    if (!this.isStyleReady(map)) {
      if (this.isMapRemoved(map)) return;
      this.logger.log('[MapboxHeatmapLayerService] Heatmap render deferred; style not ready.', {
        layerId: config.layerId
      });
      this.deferRender(
        map,
        pendingRenderKey,
        () => this.renderGeoJsonHeatmapLayer(map, config)
      );
      return;
    }

    try {
      const visibility = config.visibility || 'visible';
      const existingSource = this.getSourceSafely(map, config.sourceId);

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

      if (!this.getLayerSafely(map, config.layerId)) {
        if (config.beforeLayerId) {
          map.addLayer(layerDefinition, config.beforeLayerId);
        } else {
          map.addLayer(layerDefinition);
        }
      } else {
        if (config.beforeLayerId && typeof map.moveLayer === 'function') {
          map.moveLayer(config.layerId, config.beforeLayerId);
        }
        if (typeof map.setLayoutProperty === 'function') {
          map.setLayoutProperty(config.layerId, 'visibility', visibility);
        }
      }
      this.cancelDeferredRender(map, pendingRenderKey);
    } catch (error) {
      if (this.shouldDeferAfterMapboxError(map, error)) {
        this.deferRender(
          map,
          pendingRenderKey,
          () => this.renderGeoJsonHeatmapLayer(map, config),
          { runImmediately: false }
        );
        return;
      }
      this.logger.warn?.('[MapboxHeatmapLayerService] Failed to render heatmap layer.', {
        layerId: config.layerId,
        error
      });
    }
  }

  public setLayerVisibility(map: any, layerId: string, visible: boolean): void {
    if (!map || !layerId) return;
    const pendingVisibilityKey = this.buildPendingVisibilityKey(layerId);
    if (!this.isStyleReady(map)) {
      if (this.isMapRemoved(map)) return;
      this.deferRender(
        map,
        pendingVisibilityKey,
        () => this.setLayerVisibility(map, layerId, visible)
      );
      return;
    }
    try {
      if (!this.getLayerSafely(map, layerId)) return;
      if (typeof map.setLayoutProperty === 'function') {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
      this.cancelDeferredRender(map, pendingVisibilityKey);
    } catch (error) {
      if (this.shouldDeferAfterMapboxError(map, error)) {
        this.deferRender(
          map,
          pendingVisibilityKey,
          () => this.setLayerVisibility(map, layerId, visible),
          { runImmediately: false }
        );
        return;
      }
      this.logger.warn?.('[MapboxHeatmapLayerService] Failed to set heatmap visibility.', {
        layerId,
        error
      });
    }
  }

  public clearLayerAndSource(map: any, sourceId: string, layerId: string): void {
    if (!map) return;
    this.cancelDeferredRender(map, this.buildPendingRenderKey(layerId));
    this.cancelDeferredRender(map, this.buildPendingVisibilityKey(layerId));
    this.removeLayerIfPresent(map, layerId);
    this.removeSourceIfPresent(map, sourceId);
  }

  private isStyleReady(map: any): boolean {
    if (this.isMapRemoved(map)) return false;
    return isStyleReady(map);
  }

  private isMapRemoved(map: any): boolean {
    return map?._removed === true;
  }

  private getLayerSafely(map: any, layerId: string): any {
    if (!map?.getLayer || !layerId) return null;
    try {
      return map.getLayer(layerId);
    } catch {
      // Mapbox can throw while a style is being torn down or swapped.
      return null;
    }
  }

  private getSourceSafely(map: any, sourceId: string): any {
    if (!map?.getSource || !sourceId) return null;
    try {
      return map.getSource(sourceId);
    } catch {
      // Mapbox can throw while a style is being torn down or swapped.
      return null;
    }
  }

  private removeLayerIfPresent(map: any, layerId: string): void {
    if (!map?.removeLayer || !layerId) return;
    if (!this.getLayerSafely(map, layerId)) return;
    try {
      map.removeLayer(layerId);
    } catch {
      // Cleanup is best-effort during Mapbox teardown/reload races.
    }
  }

  private removeSourceIfPresent(map: any, sourceId: string): void {
    if (!map?.removeSource || !sourceId) return;
    if (!this.getSourceSafely(map, sourceId)) return;
    try {
      map.removeSource(sourceId);
    } catch {
      // Cleanup is best-effort during Mapbox teardown/reload races.
    }
  }

  private shouldDeferAfterMapboxError(map: any, error: any): boolean {
    return !this.isMapRemoved(map) && shouldDeferForMapboxStyle(map, error);
  }

  private deferRender(
    map: any,
    key: string,
    callback: () => void,
    options: { runImmediately?: boolean } = {}
  ): void {
    if (!map?.on || !key || this.isMapRemoved(map)) return;

    const pendingRenders = this.getPendingRenderMap(map);
    const existingRegistration = pendingRenders.get(key);
    if (existingRegistration) {
      existingRegistration.callback = callback;
      return;
    }

    const registration = {
      callback,
      tryRun: () => {
        if (this.isMapRemoved(map)) {
          this.cancelDeferredRender(map, key);
          return;
        }
        if (!this.isStyleReady(map)) return;

        const activeRegistration = this.getPendingRenderMap(map).get(key);
        if (activeRegistration !== registration) return;

        this.detachDeferredRenderListeners(map, registration.tryRun);
        this.getPendingRenderMap(map).delete(key);
        registration.callback();
      }
    };
    pendingRenders.set(key, registration);

    map.on('style.load', registration.tryRun);
    map.on('styledata', registration.tryRun);
    map.on('load', registration.tryRun);
    map.on('idle', registration.tryRun);
    if (options.runImmediately !== false) {
      registration.tryRun();
    }
  }

  private cancelDeferredRender(map: any, key: string): void {
    if (!map || !key) return;
    const pendingRenders = this.pendingRendersByMap.get(map);
    const registration = pendingRenders?.get(key);
    if (!registration) return;

    this.detachDeferredRenderListeners(map, registration.tryRun);
    pendingRenders?.delete(key);
  }

  private detachDeferredRenderListeners(map: any, tryRun: () => void): void {
    if (!map?.off) return;
    map.off('style.load', tryRun);
    map.off('styledata', tryRun);
    map.off('load', tryRun);
    map.off('idle', tryRun);
  }

  private getPendingRenderMap(map: any): Map<string, DeferredHeatmapRenderRegistration> {
    let renderMap = this.pendingRendersByMap.get(map);
    if (!renderMap) {
      renderMap = new Map<string, DeferredHeatmapRenderRegistration>();
      this.pendingRendersByMap.set(map, renderMap);
    }
    return renderMap;
  }

  private buildPendingRenderKey(layerId: string): string {
    return `render:${layerId}`;
  }

  private buildPendingVisibilityKey(layerId: string): string {
    return `visibility:${layerId}`;
  }
}
