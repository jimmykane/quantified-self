import { Injectable, NgZone } from '@angular/core';
import type { Map as MapboxMap, MapOptions } from 'mapbox-gl';
import { TracksMapManager } from '../../tracks/tracks-map.manager';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { MapStyleService } from '../../../services/map-style.service';
import { MapboxHeatmapLayerService } from '../../../services/map/mapbox-heatmap-layer.service';
import { JumpHeatmapWeightingService } from '../../../services/map/jump-heatmap-weighting.service';
import { MapboxStartPointLayerService } from '../../../services/map/mapbox-start-point-layer.service';
import { MapboxAutoResizeService } from '../../../services/map/mapbox-auto-resize.service';
import { MapboxLoaderService } from '../../../services/mapbox-loader.service';
import { LoggerService } from '../../../services/logger.service';

export type MyTracksMapControlMode = 'none' | 'preview' | 'workspace';

export interface MyTracksMapViewConfig {
  controlMode?: MyTracksMapControlMode;
  onResize?: () => void;
}

export interface MyTracksMapViewHandle {
  readonly map: MapboxMap;
  readonly mapboxgl: typeof import('mapbox-gl/dist/esm/mapbox-gl.js')['default'];
  readonly manager: TracksMapManager;
  destroy(): void;
}

/**
 * The shared browser boundary for MyTracks maps.
 *
 * Both the authenticated MyTracks workspace and public previews use this factory,
 * so Mapbox loading, track-layer construction, controls, resize handling, and
 * disposal stay in one implementation.
 */
@Injectable({ providedIn: 'root' })
export class MyTracksMapViewFactory {
  constructor(
    private readonly zone: NgZone,
    private readonly eventColorService: AppEventColorService,
    private readonly mapStyleService: MapStyleService,
    private readonly mapboxHeatmapLayerService: MapboxHeatmapLayerService,
    private readonly jumpHeatmapWeightingService: JumpHeatmapWeightingService,
    private readonly mapboxStartPointLayerService: MapboxStartPointLayerService,
    private readonly mapboxAutoResizeService: MapboxAutoResizeService,
    private readonly mapboxLoader: MapboxLoaderService,
    private readonly logger: LoggerService,
  ) {}

  createManager(): TracksMapManager {
    return new TracksMapManager(
      this.zone,
      this.eventColorService,
      this.mapStyleService,
      this.mapboxHeatmapLayerService,
      this.jumpHeatmapWeightingService,
      this.mapboxStartPointLayerService,
      this.logger,
    );
  }

  async initialize(
    manager: TracksMapManager,
    container: HTMLElement,
    options: Omit<MapOptions, 'container'>,
    config: MyTracksMapViewConfig = {},
  ): Promise<MyTracksMapViewHandle> {
    const map = await this.mapboxLoader.createMap(container, options);

    try {
      const mapboxgl = await this.mapboxLoader.loadMapbox();
      manager.setMap(map, mapboxgl);
      this.mapboxAutoResizeService.bind(map, {
        container,
        onResize: config.onResize,
      });
      this.addControls(map, mapboxgl, config.controlMode ?? 'none');

      let destroyed = false;
      return {
        map,
        mapboxgl,
        manager,
        destroy: () => {
          if (destroyed) return;
          destroyed = true;
          this.mapboxAutoResizeService.unbind(map);
          map.remove();
        },
      };
    } catch (error) {
      map.remove();
      throw error;
    }
  }

  private addControls(
    map: MapboxMap,
    mapboxgl: typeof import('mapbox-gl/dist/esm/mapbox-gl.js')['default'],
    mode: MyTracksMapControlMode,
  ): void {
    if (mode === 'none') return;

    if (mode === 'workspace') {
      map.addControl(new mapboxgl.FullscreenControl(), 'bottom-right');
      map.addControl(new mapboxgl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
        showZoom: true,
      }), 'bottom-right');
      return;
    }

    map.addControl(new mapboxgl.NavigationControl({
      showCompass: false,
      showZoom: true,
    }), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 96, unit: 'metric' }), 'bottom-left');
  }
}
