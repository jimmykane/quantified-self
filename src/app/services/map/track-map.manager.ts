import { MarkerFactoryService } from './marker-factory.service';
import { LoggerService } from '../logger.service';
import {
  ensureLayer,
  bindLayerClickOnce,
  unbindLayerClicks,
  removeLayerIfExists,
  removeSourceIfExists,
  setPaintIfLayerExists,
  upsertGeoJsonSource,
  type LayerBindingRegistry,
} from './mapbox-layer.utils';
import {
  applyTerrain,
  clearDeferredTerrainToggleState,
  deferTerrainToggleUntilReady,
  DeferredTerrainToggleState,
} from './mapbox-terrain.utils';
import {
  attachStyleReloadHandler,
  isStyleReady,
  runWhenStyleReady,
  shouldDeferForMapboxStyle,
} from './mapbox-style-ready.utils';

export interface TrackMapPosition {
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface TrackMapExtraMarkerRenderData extends TrackMapPosition {
  id: string;
  element: HTMLElement;
  anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface TrackMapRenderData {
  id: string;
  label?: string;
  strokeColor: string;
  positions: TrackMapPosition[];
  markers?: TrackMapExtraMarkerRenderData[];
  metadata?: Record<string, unknown>;
}

export interface TrackMapClickEvent {
  track: TrackMapRenderData;
  originalEvent: unknown;
  latitudeDegrees: number | null;
  longitudeDegrees: number | null;
}

export interface TrackMapCursorRenderData extends TrackMapPosition {
  trackId: string;
  color: string;
}

export interface TrackMapRenderOptions {
  showArrows: boolean;
  showEndpointMarkers?: boolean;
  strokeWidth: number;
  onTrackClick?: (event: TrackMapClickEvent) => void;
}

type ResolvedTrackMapRenderOptions = Required<Omit<TrackMapRenderOptions, 'onTrackClick'>> & {
  onTrackClick?: (event: TrackMapClickEvent) => void;
};

interface StoredTrackLayers {
  sourceId: string;
  lineLayerId: string;
  hitLayerId: string;
  arrowLayerId: string;
}

export interface TrackMapManagerOptions {
  layerPrefix?: string;
  logPrefix?: string;
}

const TRACK_CLICK_HIT_STROKE_WIDTH = 18;
const TRACK_CLICK_HIT_OPACITY = 0.001;
const TRACK_MARKER_CLICK_CLEANUP = Symbol('trackMarkerClickCleanup');

type ClickableTrackMarkerElement = HTMLElement & {
  [TRACK_MARKER_CLICK_CLEANUP]?: () => void;
};

export class TrackMapManager {
  private map: any | null = null;
  private mapboxgl: any | null = null;
  private styleLoadHandler: (() => void) | null = null;
  private styleLoadHandlerCleanup: (() => void) | null = null;
  private styleReadyRenderCleanup: (() => void) | null = null;

  private currentTracks: TrackMapRenderData[] = [];
  private currentOptions: ResolvedTrackMapRenderOptions = {
    showArrows: true,
    showEndpointMarkers: true,
    strokeWidth: 3,
  };

  private activeLayersByTrackId = new Map<string, StoredTrackLayers>();
  private lineClickBindings: LayerBindingRegistry = [];
  private startMarkers = new Map<string, any>();
  private endMarkers = new Map<string, any>();
  private extraMarkers = new Map<string, any[]>();
  private cursorMarkers = new Map<string, any>();
  private cursorState = new Map<string, TrackMapCursorRenderData>();
  private terrainEnabled = false;
  private terrainToggleState: DeferredTerrainToggleState = { pendingRequest: null };

  private readonly layerPrefix: string;
  private readonly logPrefix: string;

  constructor(
    private markerFactory: MarkerFactoryService,
    private logger: LoggerService,
    options: TrackMapManagerOptions = {},
  ) {
    this.layerPrefix = options.layerPrefix || 'track';
    this.logPrefix = options.logPrefix || 'TrackMapManager';
  }

  public setMap(map: any, mapboxgl: any): void {
    if (!map || !mapboxgl) {
      return;
    }

    this.styleLoadHandlerCleanup?.();
    this.styleReadyRenderCleanup?.();
    this.styleReadyRenderCleanup = null;
    clearDeferredTerrainToggleState(this.terrainToggleState);

    this.map = map;
    this.mapboxgl = mapboxgl;
    this.styleLoadHandler = () => {
      this.logger.log(`[${this.logPrefix}] style.load received. Restoring map layers.`, {
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
      `${this.layerPrefix}-map-manager`,
    );
  }

  public renderTrackData(tracks: TrackMapRenderData[], options: TrackMapRenderOptions): void {
    const renderStartedAt = this.nowMs();
    this.currentTracks = tracks || [];
    this.currentOptions = {
      showArrows: options?.showArrows !== false,
      showEndpointMarkers: options?.showEndpointMarkers !== false,
      strokeWidth: Number.isFinite(options?.strokeWidth) ? options.strokeWidth : 3,
      ...(options?.onTrackClick ? { onTrackClick: options.onTrackClick } : {}),
    };
    this.renderTracks();
    this.renderCursorMarkers();
    this.logPerformance('renderTrackData:complete', renderStartedAt, {
      trackCount: this.currentTracks.length,
      showArrows: this.currentOptions.showArrows,
      showEndpointMarkers: this.currentOptions.showEndpointMarkers,
      strokeWidth: this.currentOptions.strokeWidth,
    });
  }

  public setCursorMarkers(cursors: TrackMapCursorRenderData[]): void {
    this.cursorState = new Map((cursors || []).map(cursor => [cursor.trackId, cursor]));
    this.renderCursorMarkers();
  }

  public clearCursorMarkers(): void {
    this.cursorState.clear();
    this.cursorMarkers.forEach(marker => this.removeMarker(marker));
    this.cursorMarkers.clear();
  }

  public clearAll(): void {
    this.styleLoadHandlerCleanup?.();
    this.styleLoadHandlerCleanup = null;
    this.styleLoadHandler = null;
    this.styleReadyRenderCleanup?.();
    this.styleReadyRenderCleanup = null;
    clearDeferredTerrainToggleState(this.terrainToggleState);
    this.clearTracksAndMarkers();
    this.clearCursorMarkers();
    this.currentTracks = [];
    this.map = null;
    this.mapboxgl = null;
    this.terrainEnabled = false;
  }

  public toggleTerrain(enable: boolean, animate: boolean = true): void {
    if (!this.map) {
      this.logger.warn(`[${this.logPrefix}] toggleTerrain called but map is not set.`, { enable, animate });
      return;
    }

    this.terrainEnabled = enable === true;
    this.logger.log(`[${this.logPrefix}] toggleTerrain requested.`, {
      enable: this.terrainEnabled,
      animate,
      styleReady: isStyleReady(this.map),
    });

    try {
      if (!isStyleReady(this.map)) {
        this.logger.log(`[${this.logPrefix}] Style not ready. Deferring terrain toggle.`, { enable, animate });
        deferTerrainToggleUntilReady(
          this.map,
          { enable: this.terrainEnabled, animate },
          this.terrainToggleState,
          (pending) => this.toggleTerrain(pending.enable, pending.animate),
        );
        return;
      }

      clearDeferredTerrainToggleState(this.terrainToggleState);
      applyTerrain(this.map, this.terrainEnabled, animate);

      this.logger.log(`[${this.logPrefix}] toggleTerrain applied.`, {
        enable: this.terrainEnabled,
        pitch: typeof this.map.getPitch === 'function' ? this.map.getPitch() : null,
      });
    } catch (error: any) {
      this.logger.warn(`[${this.logPrefix}] Failed to toggle terrain.`, {
        enable,
        animate,
        error,
      });
      if (shouldDeferForMapboxStyle(this.map, error)) {
        this.logger.log(`[${this.logPrefix}] Deferring terrain toggle after failure.`, { enable, animate });
        deferTerrainToggleUntilReady(
          this.map,
          { enable: this.terrainEnabled, animate },
          this.terrainToggleState,
          (pending) => this.toggleTerrain(pending.enable, pending.animate),
        );
      }
    }
  }

  public fitBoundsToTracks(animate: boolean = true): boolean {
    const fitStartedAt = this.nowMs();
    if (!this.map || !this.mapboxgl || !this.currentTracks.length) {
      this.logger.log(`[${this.logPrefix}Perf] fitBoundsToTracks:skipped`, {
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
        if (!this.isFinitePosition(position)) {
          return;
        }
        bounds.extend([position.longitudeDegrees, position.latitudeDegrees]);
        hasPoints = true;
      });
      (track.markers || []).forEach(marker => {
        if (!this.isFinitePosition(marker)) {
          return;
        }
        bounds.extend([marker.longitudeDegrees, marker.latitudeDegrees]);
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
      this.scheduleRenderWhenStyleReady();
      this.logger.log(`[${this.logPrefix}] Style not ready. Track layer render deferred.`, {
        trackCount: this.currentTracks.length,
      });
      return;
    }

    this.styleReadyRenderCleanup?.();
    this.styleReadyRenderCleanup = null;

    try {
      const incomingTrackIds = new Set((this.currentTracks || []).map((track) => track.id));
      this.activeLayersByTrackId.forEach((_ids, trackId) => {
        if (!incomingTrackIds.has(trackId)) {
          this.removeTrack(trackId);
        }
      });

      this.currentTracks.forEach((track) => this.renderSingleTrack(track));
    } catch (error) {
      if (shouldDeferForMapboxStyle(this.map, error)) {
        this.logger.log(`[${this.logPrefix}] Track layer render deferred after Mapbox style error.`, {
          trackCount: this.currentTracks.length,
          error,
        });
        this.scheduleRenderWhenStyleReady();
        return;
      }
      throw error;
    }
  }

  private scheduleRenderWhenStyleReady(): void {
    if (!this.map || this.styleReadyRenderCleanup) {
      return;
    }

    this.styleReadyRenderCleanup = runWhenStyleReady(
      this.map,
      () => {
        this.styleReadyRenderCleanup = null;
        this.renderTracks();
        this.renderCursorMarkers();
      },
      { runImmediately: false },
    );
  }

  private renderSingleTrack(track: TrackMapRenderData): void {
    if (!this.map || !track || !track.id) {
      return;
    }

    const coordinates = (track.positions || [])
      .filter(position => this.isFinitePosition(position))
      .map(position => [position.longitudeDegrees, position.latitudeDegrees] as [number, number]);

    if (coordinates.length <= 1) {
      this.removeTrack(track.id);
      return;
    }

    const safeTrackId = this.buildSafeLayerId(track.id);
    const sourceId = `${this.layerPrefix}-source-${safeTrackId}`;
    const lineLayerId = `${this.layerPrefix}-line-${safeTrackId}`;
    const hitLayerId = `${this.layerPrefix}-hit-${safeTrackId}`;
    const arrowLayerId = `${this.layerPrefix}-arrow-${safeTrackId}`;

    const sourceData = {
      type: 'Feature',
      properties: {
        trackId: track.id,
        label: track.label || '',
      },
      geometry: {
        type: 'LineString',
        coordinates,
      },
    };

    upsertGeoJsonSource(this.map, sourceId, sourceData);
    ensureLayer(this.map, {
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': track.strokeColor,
        'line-width': this.currentOptions.strokeWidth || 3,
        'line-opacity': 1,
        'line-emissive-strength': 1,
      },
    });
    setPaintIfLayerExists(this.map, lineLayerId, {
      'line-color': track.strokeColor,
      'line-width': this.currentOptions.strokeWidth || 3,
      'line-opacity': 1,
      'line-emissive-strength': 1,
    });
    this.syncTrackClickLayer(track, hitLayerId, sourceId);

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
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': track.strokeColor,
          'text-halo-width': 1.1,
          'text-opacity': 1,
        },
      });
      setPaintIfLayerExists(this.map, arrowLayerId, {
        'text-halo-color': track.strokeColor,
        'text-opacity': 1,
      });
    } else {
      removeLayerIfExists(this.map, arrowLayerId);
    }

    this.activeLayersByTrackId.set(track.id, {
      sourceId,
      lineLayerId,
      hitLayerId,
      arrowLayerId,
    });

    this.renderTrackMarkers(track, coordinates);
  }

  private syncTrackClickLayer(track: TrackMapRenderData, hitLayerId: string, sourceId: string): void {
    unbindLayerClicks(this.map, this.lineClickBindings, hitLayerId);
    const clickHandler = this.currentOptions.onTrackClick;
    if (!clickHandler) {
      removeLayerIfExists(this.map, hitLayerId);
      return;
    }

    const hitStrokeWidth = Math.max(TRACK_CLICK_HIT_STROKE_WIDTH, (this.currentOptions.strokeWidth || 3) + 12);
    ensureLayer(this.map, {
      id: hitLayerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#000000',
        'line-width': hitStrokeWidth,
        'line-opacity': TRACK_CLICK_HIT_OPACITY,
      },
    });
    setPaintIfLayerExists(this.map, hitLayerId, {
      'line-width': hitStrokeWidth,
      'line-opacity': TRACK_CLICK_HIT_OPACITY,
    });
    bindLayerClickOnce(this.map, this.lineClickBindings, hitLayerId, (event: unknown) => this.emitTrackClick(
      track,
      event,
      (event as { lngLat?: { lng?: unknown; lat?: unknown } } | null | undefined)?.lngLat,
    ));
  }

  private renderTrackMarkers(track: TrackMapRenderData, coordinates: [number, number][]): void {
    if (!this.map || !this.mapboxgl || !coordinates.length) {
      return;
    }

    this.removeTrackMarkers(track.id);
    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    if (this.currentOptions.showEndpointMarkers) {
      this.startMarkers.set(track.id, this.createMarker(
        this.markerFactory.createHomeMarker(track.strokeColor),
        start[0],
        start[1],
        'center',
        track,
      ));
      this.endMarkers.set(track.id, this.createMarker(
        this.markerFactory.createFlagMarker(track.strokeColor),
        end[0],
        end[1],
        'center',
        track,
      ));
    }

    const customMarkers = (track.markers || [])
      .filter(marker => marker?.id && marker.element && this.isFinitePosition(marker))
      .map(marker => this.createMarker(
        marker.element,
        marker.longitudeDegrees,
        marker.latitudeDegrees,
        marker.anchor || 'center',
        track,
      ));
    this.extraMarkers.set(track.id, customMarkers);
  }

  private createMarker(element: HTMLElement, lng: number, lat: number, anchor: string, track?: TrackMapRenderData): any {
    this.bindMarkerClick(element, lng, lat, track);
    const marker = new this.mapboxgl.Marker({
      element,
      anchor,
    });
    marker.setLngLat([lng, lat]);
    marker.addTo(this.map);
    return marker;
  }

  private bindMarkerClick(
    element: HTMLElement,
    lng: number,
    lat: number,
    track?: TrackMapRenderData,
  ): void {
    if (!element) {
      return;
    }

    this.cleanupMarkerClick(element);
    const clickableElement = element as ClickableTrackMarkerElement;

    if (!track || !this.currentOptions.onTrackClick) {
      return;
    }

    const previousCursor = clickableElement.style.cursor;
    clickableElement.style.cursor = 'pointer';
    const clickHandler = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.emitTrackClick(track, event, { lng, lat });
    };
    clickableElement.addEventListener('click', clickHandler);
    clickableElement[TRACK_MARKER_CLICK_CLEANUP] = () => {
      clickableElement.removeEventListener('click', clickHandler);
      clickableElement.style.cursor = previousCursor;
    };
  }

  private cleanupMarkerClick(element: HTMLElement | null | undefined): void {
    if (!element) {
      return;
    }

    const clickableElement = element as ClickableTrackMarkerElement;
    clickableElement[TRACK_MARKER_CLICK_CLEANUP]?.();
    delete clickableElement[TRACK_MARKER_CLICK_CLEANUP];
  }

  private removeMarker(marker: any): void {
    this.cleanupMarkerClick(this.getMarkerElement(marker));
    marker?.remove?.();
  }

  private getMarkerElement(marker: any): HTMLElement | null {
    const element = typeof marker?.getElement === 'function' ? marker.getElement() : null;
    if (!element || typeof element.removeEventListener !== 'function') {
      return null;
    }
    return element as HTMLElement;
  }

  private emitTrackClick(
    track: TrackMapRenderData,
    originalEvent: unknown,
    lngLat: { lng?: unknown; lat?: unknown } | null | undefined,
  ): void {
    const clickHandler = this.currentOptions.onTrackClick;
    if (!clickHandler) {
      return;
    }

    const longitudeDegrees = Number(lngLat?.lng);
    const latitudeDegrees = Number(lngLat?.lat);
    clickHandler({
      track,
      originalEvent,
      latitudeDegrees: Number.isFinite(latitudeDegrees) ? latitudeDegrees : null,
      longitudeDegrees: Number.isFinite(longitudeDegrees) ? longitudeDegrees : null,
    });
  }

  private renderCursorMarkers(): void {
    if (!this.map || !this.mapboxgl) {
      return;
    }

    this.cursorMarkers.forEach((marker, trackId) => {
      if (!this.cursorState.has(trackId)) {
        this.removeMarker(marker);
        this.cursorMarkers.delete(trackId);
      }
    });

    this.cursorState.forEach((cursor, trackId) => {
      const existing = this.cursorMarkers.get(trackId);
      if (existing) {
        existing.setLngLat([cursor.longitudeDegrees, cursor.latitudeDegrees]);
        return;
      }

      const marker = this.createMarker(
        this.markerFactory.createCursorMarker(cursor.color),
        cursor.longitudeDegrees,
        cursor.latitudeDegrees,
        'center',
      );
      this.cursorMarkers.set(trackId, marker);
    });
  }

  private clearTracksAndMarkers(): void {
    if (!this.map) {
      return;
    }

    this.activeLayersByTrackId.forEach((ids) => {
      unbindLayerClicks(this.map, this.lineClickBindings, ids.hitLayerId);
      unbindLayerClicks(this.map, this.lineClickBindings, ids.lineLayerId);
      removeLayerIfExists(this.map, ids.arrowLayerId);
      removeLayerIfExists(this.map, ids.hitLayerId);
      removeLayerIfExists(this.map, ids.lineLayerId);
      removeSourceIfExists(this.map, ids.sourceId);
    });
    unbindLayerClicks(this.map, this.lineClickBindings);
    this.activeLayersByTrackId.clear();

    this.startMarkers.forEach(marker => this.removeMarker(marker));
    this.startMarkers.clear();
    this.endMarkers.forEach(marker => this.removeMarker(marker));
    this.endMarkers.clear();

    this.extraMarkers.forEach(markers => markers.forEach(marker => this.removeMarker(marker)));
    this.extraMarkers.clear();
  }

  private removeTrack(trackId: string): void {
    if (!this.map) {
      return;
    }
    const ids = this.activeLayersByTrackId.get(trackId);
    if (ids) {
      unbindLayerClicks(this.map, this.lineClickBindings, ids.hitLayerId);
      unbindLayerClicks(this.map, this.lineClickBindings, ids.lineLayerId);
      removeLayerIfExists(this.map, ids.arrowLayerId);
      removeLayerIfExists(this.map, ids.hitLayerId);
      removeLayerIfExists(this.map, ids.lineLayerId);
      removeSourceIfExists(this.map, ids.sourceId);
      this.activeLayersByTrackId.delete(trackId);
    }
    this.removeTrackMarkers(trackId);
  }

  private removeTrackMarkers(trackId: string): void {
    const start = this.startMarkers.get(trackId);
    if (start) {
      this.removeMarker(start);
      this.startMarkers.delete(trackId);
    }
    const end = this.endMarkers.get(trackId);
    if (end) {
      this.removeMarker(end);
      this.endMarkers.delete(trackId);
    }
    const customMarkers = this.extraMarkers.get(trackId);
    if (customMarkers?.length) {
      customMarkers.forEach((marker) => this.removeMarker(marker));
    }
    this.extraMarkers.delete(trackId);
  }

  private buildSafeLayerId(value: string): string {
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '-');
    const readablePrefix = sanitized.length > 0 ? sanitized : 'track';
    return `${readablePrefix}-${this.hashTrackId(value)}`;
  }

  private hashTrackId(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  private isFinitePosition(position: TrackMapPosition | null | undefined): position is TrackMapPosition {
    return Number.isFinite(position?.latitudeDegrees)
      && Number.isFinite(position?.longitudeDegrees);
  }

  private nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  private logPerformance(stage: string, startedAt: number, state: Record<string, unknown> = {}): void {
    const durationMs = Math.round((this.nowMs() - startedAt) * 10) / 10;
    this.logger.log(`[${this.logPrefix}Perf] ${stage}`, {
      durationMs,
      ...state,
    });
  }
}
