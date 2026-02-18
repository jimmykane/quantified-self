import { DataJumpEvent } from '@sports-alliance/sports-lib';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { LoggerService } from '../../../services/logger.service';

export interface EventTrackLapRenderData {
  lapIndex: number;
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface EventTrackJumpRenderData {
  event: DataJumpEvent;
  latitudeDegrees: number;
  longitudeDegrees: number;
  markerSize: number;
}

export interface EventTrackRenderData {
  activityId: string;
  strokeColor: string;
  positions: Array<{ latitudeDegrees: number; longitudeDegrees: number }>;
  laps: EventTrackLapRenderData[];
  jumps: EventTrackJumpRenderData[];
}

export interface EventCursorRenderData {
  activityId: string;
  latitudeDegrees: number;
  longitudeDegrees: number;
  color: string;
}

export interface EventMapRenderOptions {
  showArrows: boolean;
  strokeWidth: number;
}

type TrackClickHandler = (activityId: string, latitudeDegrees: number, longitudeDegrees: number) => void;
type JumpClickHandler = (jump: DataJumpEvent, latitudeDegrees: number, longitudeDegrees: number) => void;

interface LayerClickBinding {
  layerId: string;
  handler: (event: any) => void;
}

interface StoredTrackLayers {
  sourceId: string;
  lineLayerId: string;
  arrowLayerId: string;
}

interface PendingTerrainToggle {
  enable: boolean;
  animate: boolean;
}

export class EventCardMapManager {
  private map: any | null = null;
  private mapboxgl: any | null = null;
  private styleLoadHandler: (() => void) | null = null;
  private trackClickHandler: TrackClickHandler | null = null;
  private jumpClickHandler: JumpClickHandler | null = null;

  private currentTracks: EventTrackRenderData[] = [];
  private currentOptions: EventMapRenderOptions = { showArrows: true, strokeWidth: 3 };

  private activeLayersByActivityId = new Map<string, StoredTrackLayers>();
  private clickBindings: LayerClickBinding[] = [];
  private startMarkers = new Map<string, any>();
  private endMarkers = new Map<string, any>();
  private lapMarkers = new Map<string, any[]>();
  private jumpMarkers = new Map<string, any[]>();
  private cursorMarkers = new Map<string, any>();
  private cursorState = new Map<string, EventCursorRenderData>();
  private terrainEnabled = false;
  private pendingTerrainToggle: PendingTerrainToggle | null = null;
  private pendingTerrainListenerAttached = false;

  constructor(
    private markerFactory: MarkerFactoryService,
    private logger: LoggerService
  ) { }

  public setMap(map: any, mapboxgl: any): void {
    if (!map || !mapboxgl) {
      return;
    }

    if (this.map && this.styleLoadHandler && this.map.off) {
      this.map.off('style.load', this.styleLoadHandler);
    }

    this.map = map;
    this.mapboxgl = mapboxgl;
    this.styleLoadHandler = () => {
      this.logger.log('[EventCardMapManager] style.load received. Restoring map layers.', {
        trackCount: this.currentTracks.length,
        terrainEnabled: this.terrainEnabled,
      });
      this.renderTracks();
      this.renderCursorMarkers();
      if (this.terrainEnabled) {
        this.toggleTerrain(true, false);
      }
    };
    this.map.on?.('style.load', this.styleLoadHandler);
  }

  public setTrackClickHandler(handler: TrackClickHandler | null): void {
    this.trackClickHandler = handler;
  }

  public setJumpClickHandler(handler: JumpClickHandler | null): void {
    this.jumpClickHandler = handler;
  }

  public renderActivities(tracks: EventTrackRenderData[], options: EventMapRenderOptions): void {
    const renderStartedAt = this.nowMs();
    this.currentTracks = tracks || [];
    this.currentOptions = {
      showArrows: options?.showArrows !== false,
      strokeWidth: Number.isFinite(options?.strokeWidth) ? options.strokeWidth : 3,
    };
    this.renderTracks();
    this.renderCursorMarkers();
    this.logPerformance('renderActivities:complete', renderStartedAt, {
      trackCount: this.currentTracks.length,
      showArrows: this.currentOptions.showArrows,
      strokeWidth: this.currentOptions.strokeWidth,
    });
  }

  public setCursorMarkers(cursors: EventCursorRenderData[]): void {
    this.cursorState = new Map((cursors || []).map(cursor => [cursor.activityId, cursor]));
    this.renderCursorMarkers();
  }

  public clearCursorMarkers(): void {
    this.cursorState.clear();
    this.cursorMarkers.forEach(marker => marker.remove());
    this.cursorMarkers.clear();
  }

  public clearAll(): void {
    this.clearTracksAndMarkers();
    this.clearCursorMarkers();
    this.currentTracks = [];
  }

  public toggleTerrain(enable: boolean, animate: boolean = true): void {
    if (!this.map) {
      this.logger.warn('[EventCardMapManager] toggleTerrain called but map is not set.', { enable, animate });
      return;
    }

    this.terrainEnabled = enable === true;
    this.logger.log('[EventCardMapManager] toggleTerrain requested.', {
      enable: this.terrainEnabled,
      animate,
      styleReady: this.isStyleReady(),
    });

    try {
      if (!this.isStyleReady()) {
        this.logger.log('[EventCardMapManager] Style not ready. Deferring terrain toggle.', { enable, animate });
        this.deferTerrainToggle(enable, animate);
        return;
      }

      if (this.terrainEnabled) {
        if (!this.map.getSource?.('mapbox-dem')) {
          this.map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14
          });
        }
        this.map.setTerrain?.({ source: 'mapbox-dem', exaggeration: 1.5 });
        if (animate) {
          this.map.easeTo?.({ pitch: 60 });
        } else {
          this.map.setPitch?.(60);
        }
      } else {
        this.map.setTerrain?.(null);
        if (animate) {
          this.map.easeTo?.({ pitch: 0 });
        } else {
          this.map.setPitch?.(0);
        }
      }

      this.logger.log('[EventCardMapManager] toggleTerrain applied.', {
        enable: this.terrainEnabled,
        pitch: typeof this.map.getPitch === 'function' ? this.map.getPitch() : null,
      });
    } catch (error: any) {
      const message = String(error?.message || '');
      this.logger.warn('[EventCardMapManager] Failed to toggle terrain.', {
        enable,
        animate,
        error,
      });
      if (message.includes('Style is not done loading') || !this.isStyleReady()) {
        this.logger.log('[EventCardMapManager] Deferring terrain toggle after failure.', { enable, animate });
        this.deferTerrainToggle(enable, animate);
      }
    }
  }

  private isStyleReady(): boolean {
    if (!this.map) {
      return false;
    }
    if (typeof this.map.isStyleLoaded === 'function') {
      return this.map.isStyleLoaded();
    }
    if (typeof this.map.loaded === 'function') {
      return this.map.loaded();
    }
    return true;
  }

  private deferTerrainToggle(enable: boolean, animate: boolean): void {
    this.pendingTerrainToggle = { enable, animate };
    if (this.pendingTerrainListenerAttached || !this.map?.on) {
      return;
    }
    this.pendingTerrainListenerAttached = true;

    const tryApply = () => {
      if (!this.isStyleReady()) {
        return;
      }

      this.pendingTerrainListenerAttached = false;
      if (this.map?.off) {
        this.map.off('style.load', tryApply);
        this.map.off('styledata', tryApply);
        this.map.off('load', tryApply);
        this.map.off('idle', tryApply);
      }

      const pending = this.pendingTerrainToggle;
      this.pendingTerrainToggle = null;
      if (pending) {
        this.toggleTerrain(pending.enable, pending.animate);
      }
    };

    this.map.on('style.load', tryApply);
    this.map.on('styledata', tryApply);
    this.map.on('load', tryApply);
    this.map.on('idle', tryApply);
    tryApply();
  }

  public fitBoundsToTracks(animate: boolean = true): boolean {
    const fitStartedAt = this.nowMs();
    if (!this.map || !this.mapboxgl || !this.currentTracks.length) {
      this.logger.log('[EventCardMapManagerPerf] fitBoundsToTracks:skipped', {
        hasMap: !!this.map,
        hasMapboxgl: !!this.mapboxgl,
        trackCount: this.currentTracks.length,
      });
      return false;
    }

    const bounds = new this.mapboxgl.LngLatBounds();
    let hasPoints = false;
    this.currentTracks.forEach(track => {
      (track.positions || []).forEach(position => {
        if (!Number.isFinite(position?.longitudeDegrees) || !Number.isFinite(position?.latitudeDegrees)) {
          return;
        }
        bounds.extend([position.longitudeDegrees, position.latitudeDegrees]);
        hasPoints = true;
      });
    });

    if (!hasPoints) {
      this.logPerformance('fitBoundsToTracks:noPoints', fitStartedAt, { trackCount: this.currentTracks.length });
      return false;
    }

    this.map.fitBounds(bounds, {
      padding: 50,
      animate,
    });
    this.logPerformance('fitBoundsToTracks:complete', fitStartedAt, {
      trackCount: this.currentTracks.length,
      animate,
      hasPoints,
    });
    return true;
  }

  public project(latitudeDegrees: number, longitudeDegrees: number): { x: number; y: number } | null {
    if (!this.map?.project) {
      return null;
    }
    const point = this.map.project([longitudeDegrees, latitudeDegrees]);
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x, y };
  }

  private renderTracks(): void {
    if (!this.map || !this.mapboxgl) {
      return;
    }
    this.clearTracksAndMarkers();

    this.currentTracks.forEach((track) => this.renderSingleTrack(track));
  }

  private renderSingleTrack(track: EventTrackRenderData): void {
    if (!this.map || !track || !track.activityId) {
      return;
    }

    const coordinates = (track.positions || [])
      .filter(position => Number.isFinite(position?.latitudeDegrees) && Number.isFinite(position?.longitudeDegrees))
      .map(position => [position.longitudeDegrees, position.latitudeDegrees] as [number, number]);

    if (coordinates.length <= 1) {
      return;
    }

    const safeActivityId = this.sanitizeLayerId(track.activityId);
    const sourceId = `event-track-source-${safeActivityId}`;
    const lineLayerId = `event-track-line-${safeActivityId}`;
    const arrowLayerId = `event-track-arrow-${safeActivityId}`;

    const sourceData = {
      type: 'Feature',
      properties: {
        activityId: track.activityId
      },
      geometry: {
        type: 'LineString',
        coordinates
      }
    };

    const source = this.map.getSource?.(sourceId);
    if (!source) {
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: sourceData
      });
    } else if (typeof source.setData === 'function') {
      source.setData(sourceData);
    }

    if (!this.map.getLayer?.(lineLayerId)) {
      this.map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round'
        },
        paint: {
          'line-color': track.strokeColor,
          'line-width': this.currentOptions.strokeWidth || 3,
          'line-opacity': 1,
          // Keep line color visible under dark/night lighting and terrain shading.
          'line-emissive-strength': 1
        }
      });
    }

    if (this.currentOptions.showArrows) {
      if (!this.map.getLayer?.(arrowLayerId)) {
        this.map.addLayer({
          id: arrowLayerId,
          type: 'symbol',
          source: sourceId,
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 100,
            'text-field': '▶',
            'text-size': 11,
            'text-rotation-alignment': 'map',
            'text-keep-upright': false,
            'text-allow-overlap': true,
            'text-ignore-placement': true
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': track.strokeColor,
            'text-halo-width': 1.1,
            'text-opacity': 1
          }
        });
      }
    }

    this.activeLayersByActivityId.set(track.activityId, {
      sourceId,
      lineLayerId,
      arrowLayerId
    });

    this.bindLineClick(lineLayerId, track.activityId);
    if (this.currentOptions.showArrows) {
      this.bindLineClick(arrowLayerId, track.activityId);
    }

    this.renderTrackMarkers(track, coordinates);
  }

  private renderTrackMarkers(track: EventTrackRenderData, coordinates: [number, number][]): void {
    if (!this.map || !this.mapboxgl || !coordinates.length) {
      return;
    }

    const activityId = track.activityId;
    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    this.startMarkers.set(activityId, this.createMarker(
      this.markerFactory.createHomeMarker(track.strokeColor),
      start[0],
      start[1]
    ));
    this.endMarkers.set(activityId, this.createMarker(
      this.markerFactory.createFlagMarker(track.strokeColor),
      end[0],
      end[1]
    ));

    const lapMarkers = (track.laps || []).map((lap) => this.createMarker(
      this.markerFactory.createLapMarker(track.strokeColor, lap.lapIndex),
      lap.longitudeDegrees,
      lap.latitudeDegrees
    ));
    this.lapMarkers.set(activityId, lapMarkers);

    const jumpMarkers = (track.jumps || []).map((jump) => {
      const markerElement = this.markerFactory.createJumpMarker(track.strokeColor, jump.markerSize);
      markerElement.addEventListener('click', (event: Event) => {
        event.stopPropagation();
        this.jumpClickHandler?.(jump.event, jump.latitudeDegrees, jump.longitudeDegrees);
      });
      return this.createMarker(markerElement, jump.longitudeDegrees, jump.latitudeDegrees);
    });
    this.jumpMarkers.set(activityId, jumpMarkers);
  }

  private createMarker(element: HTMLElement, lng: number, lat: number): any {
    const marker = new this.mapboxgl.Marker({
      element,
      anchor: 'center'
    });
    marker.setLngLat([lng, lat]);
    marker.addTo(this.map);
    return marker;
  }

  private bindLineClick(layerId: string, activityId: string): void {
    if (!this.map || !this.map.getLayer?.(layerId) || !this.map.on) {
      return;
    }

    const clickHandler = (event: any) => {
      const lat = event?.lngLat?.lat;
      const lng = event?.lngLat?.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }
      this.trackClickHandler?.(activityId, lat, lng);
    };

    this.map.on('click', layerId, clickHandler);
    this.clickBindings.push({ layerId, handler: clickHandler });
  }

  private renderCursorMarkers(): void {
    if (!this.map || !this.mapboxgl) {
      return;
    }

    this.cursorMarkers.forEach((marker, activityId) => {
      if (!this.cursorState.has(activityId)) {
        marker.remove();
        this.cursorMarkers.delete(activityId);
      }
    });

    this.cursorState.forEach((cursor, activityId) => {
      const existing = this.cursorMarkers.get(activityId);
      if (existing) {
        existing.setLngLat([cursor.longitudeDegrees, cursor.latitudeDegrees]);
        return;
      }

      const marker = this.createMarker(
        this.markerFactory.createCursorMarker(cursor.color),
        cursor.longitudeDegrees,
        cursor.latitudeDegrees
      );
      this.cursorMarkers.set(activityId, marker);
    });
  }

  private clearTracksAndMarkers(): void {
    if (!this.map) {
      return;
    }

    this.clickBindings.forEach((binding) => {
      this.map?.off?.('click', binding.layerId, binding.handler);
    });
    this.clickBindings = [];

    this.activeLayersByActivityId.forEach((ids) => {
      if (this.map.getLayer?.(ids.arrowLayerId)) {
        this.map.removeLayer(ids.arrowLayerId);
      }
      if (this.map.getLayer?.(ids.lineLayerId)) {
        this.map.removeLayer(ids.lineLayerId);
      }
      if (this.map.getSource?.(ids.sourceId)) {
        this.map.removeSource(ids.sourceId);
      }
    });
    this.activeLayersByActivityId.clear();

    this.startMarkers.forEach(marker => marker.remove());
    this.startMarkers.clear();
    this.endMarkers.forEach(marker => marker.remove());
    this.endMarkers.clear();

    this.lapMarkers.forEach(markers => markers.forEach(marker => marker.remove()));
    this.lapMarkers.clear();

    this.jumpMarkers.forEach(markers => markers.forEach(marker => marker.remove()));
    this.jumpMarkers.clear();
  }

  private sanitizeLayerId(value: string): string {
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '-');
    if (sanitized.length > 0) {
      return sanitized;
    }
    this.logger.warn('[EventCardMapManager] Falling back to autogenerated layer id.');
    return `event-track-${Date.now()}`;
  }

  private nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  private logPerformance(stage: string, startedAt: number, state: Record<string, unknown> = {}): void {
    const durationMs = Math.round((this.nowMs() - startedAt) * 10) / 10;
    this.logger.log(`[EventCardMapManagerPerf] ${stage}`, {
      durationMs,
      ...state,
    });
  }
}
