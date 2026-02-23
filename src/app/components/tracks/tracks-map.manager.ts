import { NgZone } from '@angular/core';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes, AppThemes } from '@sports-alliance/sports-lib';
import { MapStyleService } from '../../services/map-style.service';
import { MapStyleName } from '../../services/map/map-style.types';
import { LoggerService } from '../../services/logger.service';
import { MapboxHeatmapLayerService } from '../../services/map/mapbox-heatmap-layer.service';
import { JumpHeatPointInput, JumpHeatmapWeightingService } from '../../services/map/jump-heatmap-weighting.service';
import {
    MapboxStartPointLayerService,
    MapboxStartPointSelection
} from '../../services/map/mapbox-start-point-layer.service';
import {
    ensureLayer,
    removeLayerIfExists,
    removeSourceIfExists,
    setPaintIfLayerExists,
    upsertGeoJsonSource
} from '../../services/map/mapbox-layer.utils';
import {
    applyTerrain,
    clearDeferredTerrainToggleState,
    deferTerrainToggleUntilReady,
    DeferredTerrainToggleState
} from '../../services/map/mapbox-terrain.utils';
import {
    attachStyleReloadHandler,
    isStyleReady,
    runWhenStyleReady
} from '../../services/map/mapbox-style-ready.utils';
import { resolveThemedActivityColor } from '../../services/map/map-activity-color.utils';

type TrackStyleMode = 'dark-glow' | 'light-contrast';
type TrackLayerRole = 'glow' | 'casing' | 'main';

interface TrackRenderRecord {
    activity: any;
    coordinates: number[][];
    baseColor: string;
}

export interface TrackStartPoint {
    eventId: string;
    activityId: string;
    activityType: string;
    activityTypeValue?: ActivityTypes | string | number | null;
    durationValue?: number | null;
    distanceValue?: number | null;
    startDate: number | null;
    durationLabel: string;
    distanceLabel: string;
    effortLabel?: string;
    effortDisplayLabel?: string;
    effortStatType?: string;
    lng: number;
    lat: number;
}

export type TrackStartSelection = TrackStartPoint;

interface TrackStartPointWithId extends TrackStartPoint {
    pointId: string;
}

export class TracksMapManager {
    private static readonly JUMP_HEAT_SOURCE_ID = 'jump-heat-source';
    private static readonly JUMP_HEAT_LAYER_ID = 'jump-heat-layer';
    private static readonly TRACK_START_SOURCE_ID = 'track-start-source';
    private static readonly TRACK_START_LAYER_ID = 'track-start-layer';
    private static readonly TRACK_START_HIT_LAYER_ID = 'track-start-hit-layer';
    private static readonly TRACK_START_MIN_ZOOM = 0;
    private static readonly TRACK_START_MARKER_STROKE = '#f5f8ff';
    private static readonly TRACK_START_MARKER_SELECTED_COLOR = '#22c55e';
    private static readonly TRACK_START_MARKER_RADIUS_MIN = 5.6;
    private static readonly TRACK_START_MARKER_RADIUS_MAX = 6.72;
    private static readonly TRACK_BATCH_SOURCE_ID = 'track-source-batch';
    private static readonly TRACK_BATCH_LAYER_ID = 'track-layer-batch';
    private static readonly TRACK_BATCH_GLOW_LAYER_ID = 'track-layer-glow-batch';
    private static readonly TRACK_BATCH_CASING_LAYER_ID = 'track-layer-casing-batch';

    private map: any; // Mapbox GL map instance
    private activeLayerIds: string[] = []; // Store IDs of added layers/sources
    private mapboxgl: any; // Mapbox GL JS library reference
    private tracksByActivityId = new Map<string, TrackRenderRecord>();
    private styleLoadHandlerCleanup: (() => void) | null = null;
    private terrainControl: any;
    private terrainToggleState: DeferredTerrainToggleState = { pendingRequest: null };
    private isDarkTheme = false;
    private mapStyle: MapStyleName = 'default';
    private trackLayerBaseColors = new Map<string, string>();
    private jumpHeatPoints: JumpHeatPointInput[] = [];
    private jumpHeatmapVisible = true;
    private trackStartPoints: TrackStartPointWithId[] = [];
    private trackStartPointsById = new Map<string, TrackStartPointWithId>();
    private startSelectionHandler: ((selection: TrackStartSelection | null) => void) | null = null;
    private selectedTrackStartPointId: string | null = null;
    private hoveredTrackStartPointId: string | null = null;
    private trackRenderEpoch = 0;
    private panPerformanceModeEnabled = false;
    private batchRenderingEnabled = false;

    constructor(
        private zone: NgZone,
        private eventColorService: AppEventColorService,
        private mapStyleService: MapStyleService,
        private mapboxHeatmapLayerService: MapboxHeatmapLayerService,
        private jumpHeatmapWeightingService: JumpHeatmapWeightingService,
        private mapboxStartPointLayerService: MapboxStartPointLayerService,
        private logger: LoggerService
    ) { }

    public setMap(map: any, mapboxgl: any) {
        this.styleLoadHandlerCleanup?.();
        clearDeferredTerrainToggleState(this.terrainToggleState);
        this.map = map;
        this.mapboxgl = mapboxgl;
        this.attachStyleReloadHandler();
        if (this.jumpHeatPoints.length > 0) {
            this.renderJumpHeatmap();
        } else {
            this.updateJumpHeatmapVisibility();
        }
        if (this.trackStartPoints.length > 0) {
            this.renderTrackStartPoints();
        } else {
            this.clearTrackStartPointsLayerAndInteraction();
        }
        this.applyPanPerformanceMode();
    }

    public setIsDarkTheme(isDark: boolean) {
        this.isDarkTheme = isDark;
        if (this.map && this.trackStartPoints.length > 0) {
            this.renderTrackStartPoints();
        }
    }

    public setMapStyle(mapStyle: MapStyleName) {
        this.mapStyle = mapStyle ?? 'default';
        if (this.map && this.trackStartPoints.length > 0) {
            this.renderTrackStartPoints();
        }
    }

    public setPanPerformanceMode(enabled: boolean): void {
        const nextEnabled = enabled === true;
        if (this.panPerformanceModeEnabled === nextEnabled) return;
        this.panPerformanceModeEnabled = nextEnabled;
        this.applyPanPerformanceMode();
    }

    public getMap(): any {
        return this.map;
    }

    public setJumpHeatmapVisible(visible: boolean): void {
        this.jumpHeatmapVisible = visible !== false;
        this.updateJumpHeatmapVisibility();
    }

    public setJumpHeatPoints(points: { lng: number; lat: number; hangTime: number | null; distance: number | null; }[]): void {
        this.jumpHeatPoints = (points || [])
            .filter((point) =>
                Number.isFinite(point?.lng)
                && Number.isFinite(point?.lat)
                && Math.abs(point.lng) <= 180
                && Math.abs(point.lat) <= 90
            )
            .map((point) => ({
                lng: point.lng,
                lat: point.lat,
                hangTime: typeof point.hangTime === 'number' && Number.isFinite(point.hangTime) ? point.hangTime : null,
                distance: typeof point.distance === 'number' && Number.isFinite(point.distance) ? point.distance : null
            }))
            .filter((point) => point.hangTime !== null || point.distance !== null);

        this.logger.log('[TracksMapManager] setJumpHeatPoints called.', {
            inputPoints: points?.length || 0,
            validWeightedPoints: this.jumpHeatPoints.length
        });

        if (!this.jumpHeatPoints.length) {
            this.removeJumpHeatmapLayerAndSource();
            return;
        }

        this.renderJumpHeatmap();
    }

    public clearJumpHeatmap(): void {
        this.jumpHeatPoints = [];
        this.removeJumpHeatmapLayerAndSource();
    }

    public setStartMarkerSelectionHandler(handler: ((selection: TrackStartSelection | null) => void) | null): void {
        this.startSelectionHandler = handler;
    }

    public clearStartPointSelection(): void {
        if (!this.selectedTrackStartPointId && !this.hoveredTrackStartPointId) return;
        this.selectedTrackStartPointId = null;
        this.hoveredTrackStartPointId = null;
        this.refreshTrackStartPointsForSelectionState();
        this.applyTrackHighlightState();
    }

    public setActivityStartPoints(points: TrackStartPoint[]): void {
        const duplicateCounter = new Map<string, number>();
        this.trackStartPoints = (points || [])
            .filter((point) =>
                typeof point?.eventId === 'string'
                && point.eventId.length > 0
                && typeof point?.activityId === 'string'
                && point.activityId.length > 0
                && Number.isFinite(point?.lng)
                && Number.isFinite(point?.lat)
                && Math.abs(point.lng) <= 180
                && Math.abs(point.lat) <= 90
            )
            .map((point) => {
                const normalizedPoint: TrackStartPoint = {
                    eventId: point.eventId,
                    activityId: point.activityId,
                    activityType: (point.activityType || 'Activity').toString(),
                    activityTypeValue: this.normalizeActivityTypeValue(point.activityTypeValue),
                    durationValue: this.normalizeMetricValue(point.durationValue),
                    distanceValue: this.normalizeMetricValue(point.distanceValue),
                    startDate: typeof point.startDate === 'number' && Number.isFinite(point.startDate) ? point.startDate : null,
                    durationLabel: (point.durationLabel || '-').toString(),
                    distanceLabel: (point.distanceLabel || '-').toString(),
                    effortLabel: (point.effortLabel || '').toString(),
                    effortDisplayLabel: (point.effortDisplayLabel || '-').toString(),
                    effortStatType: typeof point.effortStatType === 'string' && point.effortStatType.trim().length > 0
                        ? point.effortStatType.trim()
                        : undefined,
                    lng: point.lng,
                    lat: point.lat
                };
                const pointId = this.buildTrackStartPointId(normalizedPoint, duplicateCounter);
                return {
                    ...normalizedPoint,
                    pointId
                };
            });

        this.trackStartPointsById = new Map(this.trackStartPoints.map((point) => [point.pointId, point]));
        if (this.selectedTrackStartPointId && !this.trackStartPointsById.has(this.selectedTrackStartPointId)) {
            this.selectedTrackStartPointId = null;
        }
        if (this.hoveredTrackStartPointId && !this.trackStartPointsById.has(this.hoveredTrackStartPointId)) {
            this.hoveredTrackStartPointId = null;
        }

        this.logger.log('[TracksMapManager] setActivityStartPoints called.', {
            inputPoints: points?.length || 0,
            validPoints: this.trackStartPoints.length
        });

        if (!this.trackStartPoints.length) {
            this.clearActivityStartPoints();
            return;
        }

        this.renderTrackStartPoints();
    }

    public clearActivityStartPoints(): void {
        this.trackStartPoints = [];
        this.trackStartPointsById.clear();
        this.selectedTrackStartPointId = null;
        this.hoveredTrackStartPointId = null;
        this.clearTrackStartPointsLayerAndInteraction();
        this.applyTrackHighlightState();
        this.emitTrackStartSelection(null);
    }

    public addTracks(_activities: any[]) {
        if (!this.map) return;

        // We expect the caller to filter activities and attach streams before calling this
        // but we can do the coordinate mapping here to keep component clean.

        // Actually, the current component logic does a lot of async fetching inside the loop.
        // To cleanly separate, the component should fetch data and pass ready-to-render objects.
        // However, the component processes chunks. 
        // Let's allow adding a single track or a batch of tracks.
    }

    public addTrackFromActivity(activity: any, coordinates: number[][]) {
        if (!this.map || !coordinates || coordinates.length <= 1) return;
        const renderEpoch = this.trackRenderEpoch;

        const validCoordinates = coordinates
            .filter((coordinate) =>
                Array.isArray(coordinate)
                && coordinate.length >= 2
                && Number.isFinite(coordinate[0])
                && Number.isFinite(coordinate[1])
                && Math.abs(coordinate[0]) <= 180
                && Math.abs(coordinate[1]) <= 90
            )
            .map((coordinate) => [coordinate[0], coordinate[1]]);

        if (validCoordinates.length <= 1) {
            this.logger.warn('[TracksMapManager] Skipping track with insufficient valid coordinates.', {
                activityId: activity?.getID?.()
            });
            return;
        }

        const rawActivityId = activity?.getID?.() ? String(activity.getID()) : `temp-${Date.now()}-${Math.random()}`;
        const activityId = this.sanitizeLayerId(rawActivityId);
        this.batchRenderingEnabled = false;
        const sourceId = `track-source-${activityId}`;
        const layerId = `track-layer-${activityId}`;
        const glowLayerId = `track-layer-glow-${activityId}`;
        const casingLayerId = `track-layer-casing-${activityId}`;
        const colorInfo = this.resolveTrackColors(activity?.type);
        this.tracksByActivityId.set(activityId, {
            activity,
            coordinates: validCoordinates,
            baseColor: colorInfo.baseColor
        });

        this.zone.runOutsideAngular(() => {
            try {
                const sourceData = {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: validCoordinates
                    }
                };
                upsertGeoJsonSource(this.map, sourceId, sourceData);

                const glowPaint = this.buildLayerPaint('glow', colorInfo.baseColor);
                const casingPaint = this.buildLayerPaint('casing', colorInfo.baseColor);
                const mainPaint = this.buildLayerPaint('main', colorInfo.baseColor);
                const layerLayout = { 'line-join': 'round', 'line-cap': 'round' };

                ensureLayer(this.map, {
                    id: glowLayerId,
                    type: 'line',
                    source: sourceId,
                    layout: layerLayout,
                    paint: glowPaint
                });
                ensureLayer(this.map, {
                    id: casingLayerId,
                    type: 'line',
                    source: sourceId,
                    layout: layerLayout,
                    paint: casingPaint
                });
                ensureLayer(this.map, {
                    id: layerId,
                    type: 'line',
                    source: sourceId,
                    layout: layerLayout,
                    paint: mainPaint
                });
                setPaintIfLayerExists(this.map, glowLayerId, glowPaint);
                setPaintIfLayerExists(this.map, casingLayerId, casingPaint);
                setPaintIfLayerExists(this.map, layerId, mainPaint);

                this.rememberActiveId(glowLayerId);
                this.rememberActiveId(casingLayerId);
                this.rememberActiveId(layerId);
                this.rememberActiveId(sourceId);
                this.trackLayerBaseColors.set(glowLayerId, colorInfo.baseColor);
                this.trackLayerBaseColors.set(casingLayerId, colorInfo.baseColor);
                this.trackLayerBaseColors.set(layerId, colorInfo.baseColor);
                this.applyTrackHighlightState();
                this.applyPanPerformanceModeToActivity(activityId);

            } catch (error: any) {
                if (error?.message?.includes('Style is not done loading')) {
                    this.map.once('style.load', () => {
                        if (this.trackRenderEpoch !== renderEpoch) {
                            return;
                        }
                        this.addTrackFromActivity(activity, coordinates);
                    });
                } else {
                    this.logger.warn('Failed to add track layer:', error);
                }
            }
        });
    }

    public setTracksFromPrepared(tracks: Array<{ activity: any; coordinates: number[][] }>): void {
        if (!this.map) return;
        const renderEpoch = this.trackRenderEpoch;
        this.batchRenderingEnabled = true;
        const nextTracksByActivityId = new Map<string, TrackRenderRecord>();
        const features: any[] = [];

        (tracks || []).forEach((track) => {
            const activity = track?.activity;
            const coordinates = track?.coordinates;
            if (!coordinates || coordinates.length <= 1) return;
            const validCoordinates = coordinates
                .filter((coordinate) =>
                    Array.isArray(coordinate)
                    && coordinate.length >= 2
                    && Number.isFinite(coordinate[0])
                    && Number.isFinite(coordinate[1])
                    && Math.abs(coordinate[0]) <= 180
                    && Math.abs(coordinate[1]) <= 90
                )
                .map((coordinate) => [coordinate[0], coordinate[1]]);
            if (validCoordinates.length <= 1) return;

            const rawActivityId = activity?.getID?.() ? String(activity.getID()) : `temp-${Date.now()}-${Math.random()}`;
            const activityId = this.sanitizeLayerId(rawActivityId);
            const colorInfo = this.resolveTrackColors(activity?.type);
            nextTracksByActivityId.set(activityId, {
                activity,
                coordinates: validCoordinates,
                baseColor: colorInfo.baseColor
            });
            features.push({
                type: 'Feature',
                properties: {
                    activityId,
                    baseColor: colorInfo.baseColor
                },
                geometry: {
                    type: 'LineString',
                    coordinates: validCoordinates
                }
            });
        });

        this.tracksByActivityId = nextTracksByActivityId;

        this.zone.runOutsideAngular(() => {
            try {
                const sourceData = {
                    type: 'FeatureCollection',
                    features
                };
                upsertGeoJsonSource(this.map, TracksMapManager.TRACK_BATCH_SOURCE_ID, sourceData);
                const layerLayout = { 'line-join': 'round', 'line-cap': 'round' };
                ensureLayer(this.map, {
                    id: TracksMapManager.TRACK_BATCH_GLOW_LAYER_ID,
                    type: 'line',
                    source: TracksMapManager.TRACK_BATCH_SOURCE_ID,
                    layout: layerLayout,
                    paint: this.buildBatchLayerPaint('glow', new Set<string>())
                });
                ensureLayer(this.map, {
                    id: TracksMapManager.TRACK_BATCH_CASING_LAYER_ID,
                    type: 'line',
                    source: TracksMapManager.TRACK_BATCH_SOURCE_ID,
                    layout: layerLayout,
                    paint: this.buildBatchLayerPaint('casing', new Set<string>())
                });
                ensureLayer(this.map, {
                    id: TracksMapManager.TRACK_BATCH_LAYER_ID,
                    type: 'line',
                    source: TracksMapManager.TRACK_BATCH_SOURCE_ID,
                    layout: layerLayout,
                    paint: this.buildBatchLayerPaint('main', new Set<string>())
                });

                this.rememberActiveId(TracksMapManager.TRACK_BATCH_GLOW_LAYER_ID);
                this.rememberActiveId(TracksMapManager.TRACK_BATCH_CASING_LAYER_ID);
                this.rememberActiveId(TracksMapManager.TRACK_BATCH_LAYER_ID);
                this.rememberActiveId(TracksMapManager.TRACK_BATCH_SOURCE_ID);
                this.trackLayerBaseColors.delete(TracksMapManager.TRACK_BATCH_GLOW_LAYER_ID);
                this.trackLayerBaseColors.delete(TracksMapManager.TRACK_BATCH_CASING_LAYER_ID);
                this.trackLayerBaseColors.delete(TracksMapManager.TRACK_BATCH_LAYER_ID);
                this.applyTrackHighlightState();
                this.applyPanPerformanceMode();
            } catch (error: any) {
                if (error?.message?.includes('Style is not done loading')) {
                    this.map.once('style.load', () => {
                        if (this.trackRenderEpoch !== renderEpoch) {
                            return;
                        }
                        this.setTracksFromPrepared(tracks);
                    });
                } else {
                    this.logger.warn('Failed to add batched track layers:', error);
                }
            }
        });
    }

    public clearAllTracks() {
        this.trackRenderEpoch += 1;
        this.batchRenderingEnabled = false;

        if (this.map) {
            this.zone.runOutsideAngular(() => {
                const layers = this.activeLayerIds.filter(id => id.startsWith('track-layer-'));
                const sources = this.activeLayerIds.filter(id => id.startsWith('track-source-'));

                layers.forEach(id => {
                    removeLayerIfExists(this.map, id);
                });

                sources.forEach(id => {
                    removeSourceIfExists(this.map, id);
                });

                this.activeLayerIds = [];
            });
        } else {
            this.activeLayerIds = [];
        }
        this.trackLayerBaseColors.clear();
        this.tracksByActivityId.clear();
        this.clearActivityStartPoints();
    }

    public get hasTracks(): boolean {
        return this.activeLayerIds.length > 0;
    }

    public refreshTrackColors() {
        if (this.batchRenderingEnabled) {
            this.applyTrackHighlightState();
            return;
        }
        if (!this.map || !this.trackLayerBaseColors.size) return;
        if (!isStyleReady(this.map)) {
            runWhenStyleReady(this.map, () => this.refreshTrackColors(), {
                events: ['style.load'],
                runImmediately: false
            });
            return;
        }

        this.zone.runOutsideAngular(() => {
            this.trackLayerBaseColors.forEach((baseColor, layerId) => {
                if (!this.map.getLayer?.(layerId) || !this.map.setPaintProperty) return;
                try {
                    const role = this.resolveLayerRole(layerId);
                    const paint = this.buildLayerPaint(role, baseColor);
                    this.applyPaintProperties(layerId, paint);
                } catch (error: any) {
                    if (error?.message?.includes('Style is not done loading')) {
                        this.map.once('style.load', () => this.refreshTrackColors());
                    }
                }
            });
            this.applyTrackHighlightState();
        });
    }

    public fitBoundsToCoordinates(coordinates: number[][]) {
        if (!this.map || !this.mapboxgl || !coordinates || !coordinates.length) return;

        const bounds = new this.mapboxgl.LngLatBounds();
        coordinates.forEach(coord => {
            bounds.extend(coord as [number, number]);
        });

        this.zone.runOutsideAngular(() => {
            this.map.fitBounds(bounds, {
                padding: 50,
                animate: true,
                pitch: this.map.getPitch(),
                bearing: this.map.getBearing()
            });
        });
    }

    public toggleTerrain(enable: boolean, animate: boolean = true) {
        if (!this.map) {
            this.logger.warn('[TracksMapManager] toggleTerrain called but map is not set.');
            return;
        }

        this.logger.log(`[TracksMapManager] toggleTerrain called. Enable: ${enable}, Animate: ${animate}`);

        this.zone.runOutsideAngular(() => {
            try {
                if (!isStyleReady(this.map)) {
                    this.logger.log('[TracksMapManager] Style not loaded yet. Deferring terrain toggle.');
                    deferTerrainToggleUntilReady(
                        this.map,
                        { enable, animate },
                        this.terrainToggleState,
                        (pending) => this.toggleTerrain(pending.enable, pending.animate)
                    );
                    return;
                }

                clearDeferredTerrainToggleState(this.terrainToggleState);
                applyTerrain(this.map, enable, animate);

                if (this.terrainControl) {
                    this.terrainControl.set3DState(enable);
                }

            } catch (error: any) {
                this.logger.error('[TracksMapManager] Error toggling terrain:', error);
                if (error?.message?.includes('Style is not done loading') || !isStyleReady(this.map)) {
                    this.logger.log('[TracksMapManager] Style/Map state not ready, deferring terrain toggle.');
                    deferTerrainToggleUntilReady(
                        this.map,
                        { enable, animate },
                        this.terrainToggleState,
                        (pending) => this.toggleTerrain(pending.enable, pending.animate)
                    );
                }
            }
        });
    }

    private attachStyleReloadHandler() {
        if (!this.map) return;
        this.styleLoadHandlerCleanup?.();
        this.styleLoadHandlerCleanup = attachStyleReloadHandler(
            this.map,
            () => this.restoreTracksAfterStyleReload(),
            'tracks-map-manager'
        );
    }

    private restoreTracksAfterStyleReload() {
        if (!this.map || (this.tracksByActivityId.size === 0 && this.jumpHeatPoints.length === 0 && this.trackStartPoints.length === 0)) return;

        this.zone.runOutsideAngular(() => {
            this.renderJumpHeatmap();
            if (this.batchRenderingEnabled) {
                const preparedTracks = Array.from(this.tracksByActivityId.values()).map(({ activity, coordinates }) => ({
                    activity,
                    coordinates
                }));
                this.setTracksFromPrepared(preparedTracks);
            } else {
                this.tracksByActivityId.forEach(({ activity, coordinates }) => {
                    this.addTrackFromActivity(activity, coordinates);
                });
            }
            this.refreshTrackColors();
            this.updateJumpHeatmapVisibility();
            this.renderTrackStartPoints();
            this.applyTrackHighlightState();
        });
    }

    private renderJumpHeatmap(): void {
        if (!this.map) return;
        const sourceData = this.jumpHeatmapWeightingService.buildWeightedFeatureCollection(this.jumpHeatPoints);
        if (!sourceData.features.length) {
            this.logger.log('[TracksMapManager] No renderable jump heat features after weighting.', {
                inputPoints: this.jumpHeatPoints.length
            });
            this.removeJumpHeatmapLayerAndSource();
            return;
        }

        this.zone.runOutsideAngular(() => {
            const visibility = this.jumpHeatmapVisible ? 'visible' : 'none';
            const beforeLayerId = this.getFirstTrackLayerId();
            this.logger.log('[TracksMapManager] Rendering jump heatmap layer.', {
                inputPoints: this.jumpHeatPoints.length,
                renderableFeatures: sourceData.features.length,
                visibility,
                beforeLayerId: beforeLayerId || null
            });

            this.mapboxHeatmapLayerService.renderGeoJsonHeatmapLayer(this.map, {
                sourceId: TracksMapManager.JUMP_HEAT_SOURCE_ID,
                layerId: TracksMapManager.JUMP_HEAT_LAYER_ID,
                featureCollection: sourceData,
                maxzoom: 18,
                visibility,
                beforeLayerId,
                paint: {
                    'heatmap-weight': [
                        'interpolate',
                        ['linear'],
                        ['coalesce', ['get', 'heatWeight'], 0],
                        0, 0.2,
                        1, 1.0
                    ],
                    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 8, 0.9, 12, 1.15, 18, 1.35],
                    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 8, 14, 12, 20, 18, 28],
                    'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.48, 10, 0.65, 18, 0.72],
                    'heatmap-color': [
                        'interpolate',
                        ['linear'],
                        ['heatmap-density'],
                        0, 'rgba(0, 0, 255, 0)',
                        0.08, 'rgba(30, 136, 229, 0.35)',
                        0.2, '#1e88e5',
                        0.4, '#00acc1',
                        0.62, '#fdd835',
                        0.82, '#fb8c00',
                        1, '#e53935'
                    ]
                }
            });
        });
    }

    private updateJumpHeatmapVisibility(): void {
        if (!this.map) return;
        if (!this.jumpHeatPoints.length) {
            this.removeJumpHeatmapLayerAndSource();
            return;
        }

        this.zone.runOutsideAngular(() => {
            const layerId = TracksMapManager.JUMP_HEAT_LAYER_ID;
            if (!this.map.getLayer?.(layerId)) {
                this.renderJumpHeatmap();
                return;
            }
            this.mapboxHeatmapLayerService.setLayerVisibility(this.map, layerId, this.jumpHeatmapVisible);
        });
    }

    private removeJumpHeatmapLayerAndSource(): void {
        if (!this.map) return;

        this.zone.runOutsideAngular(() => {
            this.mapboxHeatmapLayerService.clearLayerAndSource(
                this.map,
                TracksMapManager.JUMP_HEAT_SOURCE_ID,
                TracksMapManager.JUMP_HEAT_LAYER_ID
            );
        });
    }

    private getFirstTrackLayerId(): string | undefined {
        const layers = this.map?.getStyle?.()?.layers;
        if (!Array.isArray(layers)) return undefined;
        return layers.find((layer: any) => typeof layer?.id === 'string' && layer.id.startsWith('track-layer-'))?.id;
    }

    private renderTrackStartPoints(): void {
        if (!this.map) return;
        if (!this.trackStartPoints.length) {
            this.clearTrackStartPointsLayerAndInteraction();
            return;
        }
        const sizeWeightsByPointId = this.buildTrackStartMarkerSizeWeights(this.trackStartPoints);
        this.zone.runOutsideAngular(() => {
            this.mapboxStartPointLayerService.renderStartPoints(this.map, {
                sourceId: TracksMapManager.TRACK_START_SOURCE_ID,
                layerId: TracksMapManager.TRACK_START_LAYER_ID,
                hitLayerId: TracksMapManager.TRACK_START_HIT_LAYER_ID,
                minzoom: TracksMapManager.TRACK_START_MIN_ZOOM,
                markerColor: '#2ca3ff',
                markerStrokeColor: TracksMapManager.TRACK_START_MARKER_STROKE,
                points: this.trackStartPoints.map((point) => ({
                    lng: point.lng,
                    lat: point.lat,
                    properties: {
                        pointId: point.pointId,
                        markerColor: this.resolveTrackStartPointMarkerColor(point),
                        markerRadius: this.resolveTrackStartMarkerRadius(sizeWeightsByPointId.get(point.pointId) ?? 0)
                    }
                }))
            });

            this.mapboxStartPointLayerService.bindInteraction(this.map, {
                hitLayerId: TracksMapManager.TRACK_START_HIT_LAYER_ID,
                interactionLayerId: TracksMapManager.TRACK_START_LAYER_ID,
                onSelect: (selection) => this.handleTrackStartPointSelection(selection),
                onClear: () => {
                    this.selectedTrackStartPointId = null;
                    this.hoveredTrackStartPointId = null;
                    this.refreshTrackStartPointsForSelectionState();
                    this.applyTrackHighlightState();
                    this.emitTrackStartSelection(null);
                },
                onHover: (selection) => this.handleTrackStartPointHover(selection?.pointId || null)
            });
        });
    }

    private clearTrackStartPointsLayerAndInteraction(): void {
        if (!this.map) return;
        this.zone.runOutsideAngular(() => {
            this.mapboxStartPointLayerService.clear(this.map, {
                sourceId: TracksMapManager.TRACK_START_SOURCE_ID,
                layerId: TracksMapManager.TRACK_START_LAYER_ID,
                hitLayerId: TracksMapManager.TRACK_START_HIT_LAYER_ID
            });
        });
    }

    private refreshTrackStartPointsForSelectionState(): void {
        if (!this.map || !this.trackStartPoints.length) return;
        this.renderTrackStartPoints();
    }

    private resolveTrackStartPointMarkerColor(point: TrackStartPointWithId): string {
        if (this.selectedTrackStartPointId === point.pointId) {
            return TracksMapManager.TRACK_START_MARKER_SELECTED_COLOR;
        }
        return this.resolveTrackColors(point.activityTypeValue ?? undefined).adjustedColor;
    }

    private handleTrackStartPointHover(pointId: string | null): void {
        const normalizedPointId = pointId && this.trackStartPointsById.has(pointId) ? pointId : null;
        if (this.hoveredTrackStartPointId === normalizedPointId) return;
        this.hoveredTrackStartPointId = normalizedPointId;
        this.applyTrackHighlightState();
    }

    private handleTrackStartPointSelection(selection: MapboxStartPointSelection): void {
        if (!selection?.pointId) {
            this.selectedTrackStartPointId = null;
            this.refreshTrackStartPointsForSelectionState();
            this.applyTrackHighlightState();
            this.emitTrackStartSelection(null);
            return;
        }

        const point = this.trackStartPointsById.get(selection.pointId);
        if (!point) {
            this.selectedTrackStartPointId = null;
            this.refreshTrackStartPointsForSelectionState();
            this.applyTrackHighlightState();
            this.emitTrackStartSelection(null);
            return;
        }

        this.selectedTrackStartPointId = point.pointId;
        this.refreshTrackStartPointsForSelectionState();
        this.applyTrackHighlightState();

        this.emitTrackStartSelection({
            ...point,
            lng: selection.lng,
            lat: selection.lat
        });
    }

    private applyTrackHighlightState(): void {
        if (!this.map || !this.tracksByActivityId.size) return;
        if (this.panPerformanceModeEnabled) {
            return;
        }
        const highlightedActivityIds = new Set<string>();
        const selectedPoint = this.selectedTrackStartPointId ? this.trackStartPointsById.get(this.selectedTrackStartPointId) : null;
        const hoveredPoint = this.hoveredTrackStartPointId ? this.trackStartPointsById.get(this.hoveredTrackStartPointId) : null;
        if (selectedPoint?.activityId) {
            highlightedActivityIds.add(this.sanitizeLayerId(String(selectedPoint.activityId)));
        }
        if (hoveredPoint?.activityId) {
            highlightedActivityIds.add(this.sanitizeLayerId(String(hoveredPoint.activityId)));
        }

        if (this.batchRenderingEnabled) {
            const highlightedIds = Array.from(highlightedActivityIds.values());
            this.applyPaintProperties(
                TracksMapManager.TRACK_BATCH_GLOW_LAYER_ID,
                this.buildBatchLayerPaint('glow', new Set<string>(highlightedIds))
            );
            this.applyPaintProperties(
                TracksMapManager.TRACK_BATCH_CASING_LAYER_ID,
                this.buildBatchLayerPaint('casing', new Set<string>(highlightedIds))
            );
            this.applyPaintProperties(
                TracksMapManager.TRACK_BATCH_LAYER_ID,
                this.buildBatchLayerPaint('main', new Set<string>(highlightedIds))
            );
            return;
        }

        this.tracksByActivityId.forEach(({ baseColor }, activityId) => {
            const isHighlighted = highlightedActivityIds.has(activityId);
            const layerIds = [
                `track-layer-glow-${activityId}`,
                `track-layer-casing-${activityId}`,
                `track-layer-${activityId}`
            ];
            layerIds.forEach((layerId) => {
                if (!this.map.getLayer?.(layerId) || !this.map.setPaintProperty) return;
                const role = this.resolveLayerRole(layerId);
                const paint = this.buildLayerPaint(role, baseColor, isHighlighted);
                this.applyPaintProperties(layerId, paint);
            });
        });
    }

    private applyPanPerformanceMode(): void {
        if (!this.map) return;

        this.zone.runOutsideAngular(() => {
            this.applyPanPerformanceModeToAllTracks();
            const markerVisibility = this.panPerformanceModeEnabled ? 'none' : 'visible';
            this.setLayerVisibilityIfExists(TracksMapManager.TRACK_START_LAYER_ID, markerVisibility);
            this.setLayerVisibilityIfExists(TracksMapManager.TRACK_START_HIT_LAYER_ID, markerVisibility);
            if (this.panPerformanceModeEnabled) {
                this.setLayerVisibilityIfExists(TracksMapManager.JUMP_HEAT_LAYER_ID, 'none');
            } else {
                this.updateJumpHeatmapVisibility();
                if (this.trackStartPoints.length > 0) {
                    this.refreshTrackStartPointsForSelectionState();
                }
                this.applyTrackHighlightState();
            }
        });
    }

    private applyPanPerformanceModeToAllTracks(): void {
        if (this.batchRenderingEnabled) {
            if (this.panPerformanceModeEnabled) {
                this.applyPaintProperties(TracksMapManager.TRACK_BATCH_GLOW_LAYER_ID, {
                    'line-opacity': 0,
                    'line-width': 0,
                    'line-blur': 0,
                    'line-emissive-strength': 0
                });
                this.applyPaintProperties(TracksMapManager.TRACK_BATCH_CASING_LAYER_ID, {
                    'line-opacity': 0,
                    'line-width': 0,
                    'line-blur': 0,
                    'line-emissive-strength': 0
                });
                this.applyPaintProperties(TracksMapManager.TRACK_BATCH_LAYER_ID, {
                    'line-color': ['coalesce', ['get', 'baseColor'], '#2ca3ff'],
                    'line-opacity': 0.55,
                    'line-width': 1.4,
                    'line-blur': 0,
                    'line-emissive-strength': 0
                });
            } else {
                this.applyTrackHighlightState();
            }
            return;
        }
        this.tracksByActivityId.forEach((_track, activityId) => this.applyPanPerformanceModeToActivity(activityId));
    }

    private applyPanPerformanceModeToActivity(activityId: string): void {
        if (!this.map?.getLayer || !this.map?.setPaintProperty) return;
        const glowLayerId = `track-layer-glow-${activityId}`;
        const casingLayerId = `track-layer-casing-${activityId}`;
        const mainLayerId = `track-layer-${activityId}`;
        if (this.panPerformanceModeEnabled) {
            this.applyPaintProperties(glowLayerId, {
                'line-opacity': 0,
                'line-width': 0,
                'line-blur': 0,
                'line-emissive-strength': 0
            });
            this.applyPaintProperties(casingLayerId, {
                'line-opacity': 0,
                'line-width': 0,
                'line-blur': 0,
                'line-emissive-strength': 0
            });
            this.applyPaintProperties(mainLayerId, {
                'line-opacity': 0.55,
                'line-width': 1.4,
                'line-blur': 0,
                'line-emissive-strength': 0
            });
            return;
        }

        const baseColor = this.trackLayerBaseColors.get(mainLayerId) || this.trackLayerBaseColors.get(casingLayerId) || this.trackLayerBaseColors.get(glowLayerId);
        if (!baseColor) return;
        this.applyPaintProperties(glowLayerId, this.buildLayerPaint('glow', baseColor));
        this.applyPaintProperties(casingLayerId, this.buildLayerPaint('casing', baseColor));
        this.applyPaintProperties(mainLayerId, this.buildLayerPaint('main', baseColor));
    }

    private setLayerVisibilityIfExists(layerId: string, visibility: 'visible' | 'none'): void {
        if (!this.map?.getLayer?.(layerId) || !this.map?.setLayoutProperty) return;
        this.map.setLayoutProperty(layerId, 'visibility', visibility);
    }

    private buildBatchLayerPaint(role: TrackLayerRole, highlightedActivityIds: Set<string>): Record<string, any> {
        const styleMode = this.resolveStyleMode();
        const isBusy = this.isBusyMapStyle();
        const hasHighlights = highlightedActivityIds.size > 0;
        const highlightedList = Array.from(highlightedActivityIds.values());
        const defaultHighlightedOpacity = role === 'main' ? 1 : role === 'casing' ? 1 : 0.34;
        const defaultRegularOpacity = role === 'main' ? 0.95 : role === 'casing' ? (isBusy ? 0.85 : 0.75) : 0;
        const defaultHighlightedWidth = role === 'main' ? (isBusy ? 4.5 : 4.2) : role === 'casing' ? (isBusy ? 8.2 : 7.2) : 3.8;
        const defaultRegularWidth = role === 'main' ? (isBusy ? 3.2 : 3.0) : role === 'casing' ? (isBusy ? 6.5 : 5.5) : 0;
        const opacityExpression = hasHighlights
            ? ['case', ['match', ['get', 'activityId'], highlightedList, true, false], defaultHighlightedOpacity, role === 'main' ? 0.55 : 0]
            : defaultRegularOpacity;
        const widthExpression = hasHighlights
            ? ['case', ['match', ['get', 'activityId'], highlightedList, true, false], defaultHighlightedWidth, role === 'main' ? defaultRegularWidth : 0]
            : defaultRegularWidth;

        if (styleMode === 'dark-glow') {
            if (role === 'glow') {
                return {
                    'line-color': ['coalesce', ['get', 'baseColor'], '#2ca3ff'],
                    'line-width': hasHighlights ? widthExpression : 7,
                    'line-blur': hasHighlights ? 5 : 4,
                    'line-opacity': hasHighlights ? opacityExpression : 0.55,
                    'line-emissive-strength': 1.0
                };
            }
            if (role === 'casing') {
                return {
                    'line-color': ['coalesce', ['get', 'baseColor'], '#2ca3ff'],
                    'line-width': 0,
                    'line-blur': 0,
                    'line-opacity': 0,
                    'line-emissive-strength': 0
                };
            }
            return {
                'line-color': ['coalesce', ['get', 'baseColor'], '#2ca3ff'],
                'line-width': hasHighlights ? widthExpression : 3,
                'line-blur': 0,
                'line-opacity': hasHighlights ? opacityExpression : 0.95,
                'line-emissive-strength': 1.0
            };
        }

        if (role === 'glow') {
            return {
                'line-color': ['coalesce', ['get', 'baseColor'], '#2ca3ff'],
                'line-width': hasHighlights ? widthExpression : 0,
                'line-blur': hasHighlights ? 2.2 : 0,
                'line-opacity': hasHighlights ? opacityExpression : 0,
                'line-emissive-strength': hasHighlights ? 0.45 : 0
            };
        }
        if (role === 'casing') {
            return {
                'line-color': ['coalesce', ['get', 'baseColor'], '#2ca3ff'],
                'line-width': hasHighlights ? widthExpression : defaultRegularWidth,
                'line-blur': 0,
                'line-opacity': hasHighlights ? opacityExpression : defaultRegularOpacity,
                'line-emissive-strength': 0
            };
        }
        return {
            'line-color': ['coalesce', ['get', 'baseColor'], '#2ca3ff'],
            'line-width': hasHighlights ? widthExpression : defaultRegularWidth,
            'line-blur': 0,
            'line-opacity': hasHighlights ? opacityExpression : defaultRegularOpacity,
            'line-emissive-strength': hasHighlights ? 0.9 : 0.6
        };
    }

    private emitTrackStartSelection(selection: TrackStartSelection | null): void {
        this.startSelectionHandler?.(selection);
    }

    private normalizeActivityTypeValue(value: unknown): ActivityTypes | string | number | null {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
        return null;
    }

    private normalizeMetricValue(value: unknown): number | null {
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        if (value < 0) return null;
        return value;
    }

    private buildTrackStartMarkerSizeWeights(points: TrackStartPointWithId[]): Map<string, number> {
        const durationValues = points
            .map((point) => point.durationValue)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
        const distanceValues = points
            .map((point) => point.distanceValue)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

        const durationMin = durationValues.length ? Math.min(...durationValues) : null;
        const durationMax = durationValues.length ? Math.max(...durationValues) : null;
        const distanceMin = distanceValues.length ? Math.min(...distanceValues) : null;
        const distanceMax = distanceValues.length ? Math.max(...distanceValues) : null;

        const weights = new Map<string, number>();
        points.forEach((point) => {
            const durationWeight = durationMin === null || durationMax === null
                ? null
                : this.normalizeValue(point.durationValue, durationMin, durationMax);
            const distanceWeight = distanceMin === null || distanceMax === null
                ? null
                : this.normalizeValue(point.distanceValue, distanceMin, distanceMax);

            let finalWeight = 0;
            if (durationWeight !== null && distanceWeight !== null) {
                // 50/50 weighting as requested.
                finalWeight = 0.5 * durationWeight + 0.5 * distanceWeight;
            } else if (durationWeight !== null) {
                finalWeight = durationWeight;
            } else if (distanceWeight !== null) {
                finalWeight = distanceWeight;
            }
            weights.set(point.pointId, finalWeight);
        });

        return weights;
    }

    private normalizeValue(value: number | null | undefined, min: number, max: number): number | null {
        if (value === null || value === undefined || !Number.isFinite(value)) return null;
        if (min === max) return 1;
        return (value - min) / (max - min);
    }

    private resolveTrackStartMarkerRadius(weight: number): number {
        const safeWeight = Number.isFinite(weight) ? Math.min(Math.max(weight, 0), 1) : 0;
        const range = TracksMapManager.TRACK_START_MARKER_RADIUS_MAX - TracksMapManager.TRACK_START_MARKER_RADIUS_MIN;
        return TracksMapManager.TRACK_START_MARKER_RADIUS_MIN + (range * safeWeight);
    }

    private buildTrackStartPointId(point: TrackStartPoint, duplicateCounter: Map<string, number>): string {
        const baseId = this.sanitizeLayerId(`${point.eventId}_${point.activityId}`);
        const count = duplicateCounter.get(baseId) || 0;
        duplicateCounter.set(baseId, count + 1);
        return count === 0 ? baseId : `${baseId}-${count}`;
    }

    private sanitizeLayerId(activityId: string): string {
        const sanitized = activityId.replace(/[^a-zA-Z0-9_-]/g, '-');
        if (sanitized.length > 0) return sanitized;
        return `track-${Date.now()}`;
    }

    private isHexColor(value: string | undefined): value is string {
        if (!value) return false;
        return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
    }

    private resolveTrackColors(activityType: ActivityTypes | string | number | undefined | null): { baseColor: string; adjustedColor: string } {
        const fallbackColor = '#2ca3ff';
        const normalizedActivityType = activityType !== undefined && activityType !== null
            ? activityType as ActivityTypes
            : ActivityTypes.unknown;
        return resolveThemedActivityColor(
            normalizedActivityType,
            this.isDarkTheme ? AppThemes.Dark : AppThemes.Normal,
            this.eventColorService,
            this.mapStyleService,
            fallbackColor
        );
    }

    private resolveStyleMode(): TrackStyleMode {
        if (this.mapStyle === 'default' && this.isDarkTheme) {
            return 'dark-glow';
        }
        return 'light-contrast';
    }

    private isBusyMapStyle(): boolean {
        return this.mapStyle === 'satellite' || this.mapStyle === 'outdoors';
    }

    private resolveLayerRole(layerId: string): TrackLayerRole {
        if (layerId.includes('track-layer-glow-')) return 'glow';
        if (layerId.includes('track-layer-casing-')) return 'casing';
        return 'main';
    }

    private buildLayerPaint(role: TrackLayerRole, baseColor: string, isHighlighted: boolean = false): Record<string, any> {
        const theme = this.isDarkTheme ? AppThemes.Dark : AppThemes.Normal;
        const styleMode = this.resolveStyleMode();
        const isBusy = this.isBusyMapStyle();
        const mainColor = this.getSafeColor(
            this.mapStyleService.adjustColorForTheme(baseColor, theme),
            baseColor
        );
        const casingColor = this.deriveCasingColor(baseColor, isBusy);

        if (styleMode === 'dark-glow') {
            switch (role) {
                case 'glow':
                    return {
                        'line-color': mainColor,
                        'line-width': isHighlighted ? 10 : 7,
                        'line-blur': isHighlighted ? 5 : 4,
                        'line-opacity': isHighlighted ? 0.85 : 0.55,
                        'line-emissive-strength': 1.0
                    };
                case 'casing':
                    return {
                        'line-color': casingColor,
                        'line-width': 0,
                        'line-blur': 0,
                        'line-opacity': 0,
                        'line-emissive-strength': 0
                    };
                case 'main':
                default:
                    return {
                        'line-color': mainColor,
                        'line-width': isHighlighted ? 4.8 : 3,
                        'line-blur': 0,
                        'line-opacity': isHighlighted ? 1.0 : 0.95,
                        'line-emissive-strength': 1.0
                    };
            }
        }

        switch (role) {
            case 'glow':
                return {
                    'line-color': mainColor,
                    'line-width': isHighlighted ? 3.8 : 0,
                    'line-blur': isHighlighted ? 2.2 : 0,
                    'line-opacity': isHighlighted ? 0.34 : 0,
                    'line-emissive-strength': isHighlighted ? 0.45 : 0
                };
            case 'casing':
                return {
                    'line-color': casingColor,
                    'line-width': isHighlighted ? (isBusy ? 8.2 : 7.2) : (isBusy ? 6.5 : 5.5),
                    'line-blur': 0,
                    'line-opacity': isHighlighted ? 1 : (isBusy ? 0.85 : 0.75),
                    'line-emissive-strength': 0
                };
            case 'main':
            default:
                return {
                    'line-color': mainColor,
                    'line-width': isHighlighted ? (isBusy ? 4.5 : 4.2) : (isBusy ? 3.2 : 3.0),
                    'line-blur': 0,
                    'line-opacity': isHighlighted ? 1 : 0.95,
                    'line-emissive-strength': isHighlighted ? 0.9 : 0.6
                };
        }
    }

    private applyPaintProperties(layerId: string, paint: Record<string, any>) {
        setPaintIfLayerExists(this.map, layerId, paint);
    }

    private getSafeColor(color: string, fallback: string): string {
        return this.isHexColor(color) ? color : fallback;
    }

    private deriveCasingColor(baseColor: string, isBusy: boolean): string {
        const fallback = isBusy ? '#111111' : '#1a1a1a';
        if (!this.isHexColor(baseColor)) return fallback;
        let hex = baseColor.trim().toLowerCase();
        if (hex.startsWith('#')) hex = hex.slice(1);
        if (hex.length === 3) hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
        if (!/^[0-9a-f]{6}$/.test(hex)) return fallback;

        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        let l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        const targetL = isBusy ? 0.15 : 0.18;
        const minS = isBusy ? 0.55 : 0.5;
        l = targetL;
        s = Math.max(s, minS);

        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        let nr: number, ng: number, nb: number;
        if (s === 0) {
            nr = ng = nb = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            nr = hue2rgb(p, q, h + 1 / 3);
            ng = hue2rgb(p, q, h);
            nb = hue2rgb(p, q, h - 1 / 3);
        }

        const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
        return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
    }

    private rememberActiveId(id: string) {
        if (!this.activeLayerIds.includes(id)) {
            this.activeLayerIds.push(id);
        }
    }

    public addControl(control: any, position?: string) {
        if (this.map) {
            this.map.addControl(control, position);
        }
    }

    public setTerrainControl(control: any) {
        this.terrainControl = control;
    }
}
