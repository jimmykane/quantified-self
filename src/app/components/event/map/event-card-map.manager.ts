import { DataJumpEvent } from '@sports-alliance/sports-lib';
import { MarkerFactoryService } from '../../../services/map/marker-factory.service';
import { LoggerService } from '../../../services/logger.service';
import {
  ensureLayer,
  removeLayerIfExists,
  removeSourceIfExists,
  setPaintIfLayerExists,
  upsertGeoJsonSource,
} from '../../../services/map/mapbox-layer.utils';
import {
  applyTerrain,
  clearDeferredTerrainToggleState,
  deferTerrainToggleUntilReady,
  DeferredTerrainToggleState,
} from '../../../services/map/mapbox-terrain.utils';
import {
  attachStyleReloadHandler,
  isStyleReady,
} from '../../../services/map/mapbox-style-ready.utils';

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

type JumpClickHandler = (jump: DataJumpEvent, latitudeDegrees: number, longitudeDegrees: number) => void;

interface StoredTrackLayers {
  sourceId: string;
  lineLayerId: string;
  arrowLayerId: string;
}

export class EventCardMapManager {
  private map: any | null = null;
  private mapboxgl: any | null = null;
  private styleLoadHandler: (() => void) | null = null;
  private styleLoadHandlerCleanup: (() => void) | null = null;
  private jumpClickHandler: JumpClickHandler | null = null;

  private currentTracks: EventTrackRenderData[] = [];
  private currentOptions: EventMapRenderOptions = { showArrows: true, strokeWidth: 3 };

  private activeLayersByActivityId = new Map<string, StoredTrackLayers>();
  private startMarkers = new Map<string, any>();
  private endMarkers = new Map<string, any>();
  private lapMarkers = new Map<string, any[]>();
  private jumpMarkers = new Map<string, any[]>();
  private cursorMarkers = new Map<string, any>();
  private cursorState = new Map<string, EventCursorRenderData>();
  private terrainEnabled = false;
  private terrainToggleState: DeferredTerrainToggleState = { pendingRequest: null };

  constructor(
    private markerFactory: MarkerFactoryService,
    private logger: LoggerService
  ) { }

  public setMap(map: any, mapboxgl: any): void {
    if (!map || !mapboxgl) {
      return;
    }

    this.styleLoadHandlerCleanup?.();
    clearDeferredTerrainToggleState(this.terrainToggleState);

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
    this.styleLoadHandlerCleanup = attachStyleReloadHandler(
      this.map,
      this.styleLoadHandler,
      'event-card-map-manager'
    );
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
      styleReady: isStyleReady(this.map),
    });

    try {
      if (!isStyleReady(this.map)) {
        this.logger.log('[EventCardMapManager] Style not ready. Deferring terrain toggle.', { enable, animate });
        deferTerrainToggleUntilReady(
          this.map,
          { enable: this.terrainEnabled, animate },
          this.terrainToggleState,
          (pending) => this.toggleTerrain(pending.enable, pending.animate)
        );
        return;
      }

      clearDeferredTerrainToggleState(this.terrainToggleState);
      applyTerrain(this.map, this.terrainEnabled, animate);

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
      if (message.includes('Style is not done loading') || !isStyleReady(this.map)) {
        this.logger.log('[EventCardMapManager] Deferring terrain toggle after failure.', { enable, animate });
        deferTerrainToggleUntilReady(
          this.map,
          { enable: this.terrainEnabled, animate },
          this.terrainToggleState,
          (pending) => this.toggleTerrain(pending.enable, pending.animate)
        );
      }
    }
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
    if (!isStyleReady(this.map)) {
      this.logger.log('[EventCardMapManager] renderTracks skipped because style is not ready.', {
        trackCount: this.currentTracks.length,
      });
      return;
    }
    try {
      const incomingActivityIds = new Set((this.currentTracks || []).map((track) => track.activityId));
      this.activeLayersByActivityId.forEach((_ids, activityId) => {
        if (!incomingActivityIds.has(activityId)) {
          this.removeTrack(activityId);
        }
      });

      this.currentTracks.forEach((track) => this.renderSingleTrack(track));
    } catch (error: any) {
      const message = String(error?.message || '');
      if (message.includes('Style is not done loading') || !isStyleReady(this.map)) {
        this.logger.log('[EventCardMapManager] renderTracks interrupted because style is not ready.', {
          trackCount: this.currentTracks.length,
        });
        return;
      }
      throw error;
    }
  }

  private renderSingleTrack(track: EventTrackRenderData): void {
    if (!this.map || !track || !track.activityId) {
      return;
    }

    const coordinates = (track.positions || [])
      .filter(position => Number.isFinite(position?.latitudeDegrees) && Number.isFinite(position?.longitudeDegrees))
      .map(position => [position.longitudeDegrees, position.latitudeDegrees] as [number, number]);

    if (coordinates.length <= 1) {
      this.removeTrack(track.activityId);
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

    upsertGeoJsonSource(this.map, sourceId, sourceData);
    ensureLayer(this.map, {
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
    setPaintIfLayerExists(this.map, lineLayerId, {
      'line-color': track.strokeColor,
      'line-width': this.currentOptions.strokeWidth || 3,
      'line-opacity': 1,
      'line-emissive-strength': 1,
    });

    if (this.currentOptions.showArrows) {
      ensureLayer(this.map, {
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
      setPaintIfLayerExists(this.map, arrowLayerId, {
        'text-halo-color': track.strokeColor,
        'text-opacity': 1,
      });
    } else {
      removeLayerIfExists(this.map, arrowLayerId);
    }

    this.activeLayersByActivityId.set(track.activityId, {
      sourceId,
      lineLayerId,
      arrowLayerId
    });

    this.renderTrackMarkers(track, coordinates);
  }

  private renderTrackMarkers(track: EventTrackRenderData, coordinates: [number, number][]): void {
    if (!this.map || !this.mapboxgl || !coordinates.length) {
      return;
    }

    const activityId = track.activityId;
    this.removeTrackMarkers(activityId);
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

    this.activeLayersByActivityId.forEach((ids) => {
      removeLayerIfExists(this.map, ids.arrowLayerId);
      removeLayerIfExists(this.map, ids.lineLayerId);
      removeSourceIfExists(this.map, ids.sourceId);
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

  private removeTrack(activityId: string): void {
    if (!this.map) {
      return;
    }
    const ids = this.activeLayersByActivityId.get(activityId);
    if (ids) {
      removeLayerIfExists(this.map, ids.arrowLayerId);
      removeLayerIfExists(this.map, ids.lineLayerId);
      removeSourceIfExists(this.map, ids.sourceId);
      this.activeLayersByActivityId.delete(activityId);
    }
    this.removeTrackMarkers(activityId);
  }

  private removeTrackMarkers(activityId: string): void {
    const start = this.startMarkers.get(activityId);
    if (start) {
      start.remove();
      this.startMarkers.delete(activityId);
    }
    const end = this.endMarkers.get(activityId);
    if (end) {
      end.remove();
      this.endMarkers.delete(activityId);
    }
    const laps = this.lapMarkers.get(activityId);
    if (laps?.length) {
      laps.forEach((marker) => marker.remove());
      this.lapMarkers.delete(activityId);
    }
    const jumps = this.jumpMarkers.get(activityId);
    if (jumps?.length) {
      jumps.forEach((marker) => marker.remove());
      this.jumpMarkers.delete(activityId);
    }
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
