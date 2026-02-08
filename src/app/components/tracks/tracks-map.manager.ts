import { NgZone } from '@angular/core';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes, AppThemes } from '@sports-alliance/sports-lib';
import { MapStyleService } from '../../services/map-style.service';
import { LoggerService } from '../../services/logger.service';

export class TracksMapManager {
    private map: any; // Mapbox GL map instance
    private activeLayerIds: string[] = []; // Store IDs of added layers/sources
    private mapboxgl: any; // Mapbox GL JS library reference
    private tracksByActivityId = new Map<string, { activity: any; coordinates: number[][]; baseColor: string }>();
    private styleLoadListenerAttached = false;
    private terrainControl: any;
    private pendingTerrainToggle: { enable: boolean; animate: boolean } | null = null;
    private pendingTerrainListenerAttached = false;
    private isDarkTheme = false;
    private trackLayerBaseColors = new Map<string, string>();

    constructor(
        private zone: NgZone,
        private eventColorService: AppEventColorService,
        private mapStyleService: MapStyleService,
        private logger: LoggerService
    ) { }

    public setMap(map: any, mapboxgl: any) {
        this.map = map;
        this.mapboxgl = mapboxgl;
        this.attachStyleReloadHandler();
    }

    public setIsDarkTheme(isDark: boolean) {
        this.isDarkTheme = isDark;
    }

    public getMap(): any {
        return this.map;
    }

    public addTracks(activities: any[]) {
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
        const sourceId = `track-source-${activityId}`;
        const layerId = `track-layer-${activityId}`;
        const glowLayerId = `track-layer-glow-${activityId}`;
        const colorInfo = this.resolveTrackColors(activity?.type);
        this.tracksByActivityId.set(activityId, {
            activity,
            coordinates: validCoordinates,
            baseColor: colorInfo.baseColor
        });

        this.zone.runOutsideAngular(() => {
            try {
                this.ensureTrackSource(sourceId, validCoordinates);
                this.ensureTrackLayer(glowLayerId, sourceId, colorInfo.adjustedColor, {
                    'line-width': 6,
                    'line-blur': 3,
                    'line-opacity': 0.6
                });
                this.ensureTrackLayer(layerId, sourceId, colorInfo.adjustedColor, {
                    'line-width': 2.5,
                    'line-opacity': 0.9
                });

                this.rememberActiveId(layerId);
                this.rememberActiveId(glowLayerId);
                this.rememberActiveId(sourceId);
                this.trackLayerBaseColors.set(layerId, colorInfo.baseColor);
                this.trackLayerBaseColors.set(glowLayerId, colorInfo.baseColor);

            } catch (error: any) {
                if (error?.message?.includes('Style is not done loading')) {
                    this.map.once('style.load', () => this.addTrackFromActivity(activity, coordinates));
                } else {
                    this.logger.warn('Failed to add track layer:', error);
                }
            }
        });
    }

    public clearAllTracks() {
        if (!this.map) return;

        this.zone.runOutsideAngular(() => {
            const layers = this.activeLayerIds.filter(id => id.startsWith('track-layer-'));
            const sources = this.activeLayerIds.filter(id => id.startsWith('track-source-'));

            layers.forEach(id => {
                if (this.map.getLayer(id)) this.map.removeLayer(id);
            });

            sources.forEach(id => {
                if (this.map.getSource(id)) this.map.removeSource(id);
            });

            this.activeLayerIds = [];
            this.trackLayerBaseColors.clear();
            this.tracksByActivityId.clear();
        });
    }

    public get hasTracks(): boolean {
        return this.activeLayerIds.length > 0;
    }

    public refreshTrackColors() {
        if (!this.map || !this.trackLayerBaseColors.size) return;
        if (!this.isStyleReady()) {
            this.map.once('style.load', () => this.refreshTrackColors());
            return;
        }

        this.zone.runOutsideAngular(() => {
            this.trackLayerBaseColors.forEach((baseColor, layerId) => {
                if (!this.map.getLayer?.(layerId) || !this.map.setPaintProperty) return;
                try {
                    const color = this.mapStyleService.adjustColorForTheme(baseColor, this.isDarkTheme ? AppThemes.Dark : AppThemes.Normal);
                    this.map.setPaintProperty(layerId, 'line-color', color);
                    this.map.setPaintProperty(layerId, 'line-emissive-strength', 1.0);
                } catch (error: any) {
                    if (error?.message?.includes('Style is not done loading')) {
                        this.map.once('style.load', () => this.refreshTrackColors());
                    }
                }
            });
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
                if (!this.isStyleReady()) {
                    this.logger.log('[TracksMapManager] Style not loaded yet. Deferring terrain toggle.');
                    this.deferTerrainToggle(enable, animate);
                    return;
                }

                if (enable) {
                    if (!this.map.getSource('mapbox-dem')) {
                        this.logger.log('[TracksMapManager] Adding mapbox-dem source.');
                        this.map.addSource('mapbox-dem', {
                            'type': 'raster-dem',
                            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                            'tileSize': 512,
                            'maxzoom': 14
                        });
                    } else {
                        this.logger.log('[TracksMapManager] mapbox-dem source already exists.');
                    }
                }

                if (enable) {
                    this.logger.log('[TracksMapManager] Setting terrain to mapbox-dem and pitching to 60.');
                    this.map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
                    if (animate) this.map.easeTo({ pitch: 60 });
                    else this.map.setPitch(60);
                } else {
                    this.logger.log('[TracksMapManager] Removing terrain and pitching to 0.');
                    this.map.setTerrain(null);
                    if (animate) this.map.easeTo({ pitch: 0 });
                    else this.map.setPitch(0);
                }

                if (this.terrainControl) {
                    this.terrainControl.set3DState(enable);
                }

            } catch (error: any) {
                this.logger.error('[TracksMapManager] Error toggling terrain:', error);
                if (error?.message?.includes('Style is not done loading') || !this.isStyleReady()) {
                    this.logger.log('[TracksMapManager] Style/Map state not ready, deferring terrain toggle.');
                    this.deferTerrainToggle(enable, animate);
                }
            }
        });
    }

    private isStyleReady(): boolean {
        if (!this.map) return false;
        if (typeof this.map.isStyleLoaded === 'function') {
            return this.map.isStyleLoaded();
        }
        if (typeof this.map.loaded === 'function') {
            return this.map.loaded();
        }
        return true;
    }

    private deferTerrainToggle(enable: boolean, animate: boolean) {
        this.pendingTerrainToggle = { enable, animate };
        if (this.pendingTerrainListenerAttached || !this.map?.on) return;
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

    private attachStyleReloadHandler() {
        if (!this.map || this.styleLoadListenerAttached || !this.map.on) return;
        this.styleLoadListenerAttached = true;

        this.map.on('style.load', () => {
            this.restoreTracksAfterStyleReload();
        });
    }

    private restoreTracksAfterStyleReload() {
        if (!this.map || this.tracksByActivityId.size === 0) return;

        this.zone.runOutsideAngular(() => {
            this.tracksByActivityId.forEach(({ activity, coordinates }) => {
                this.addTrackFromActivity(activity, coordinates);
            });
            this.refreshTrackColors();
        });
    }

    private ensureTrackSource(sourceId: string, coordinates: number[][]) {
        const sourceData = {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates
            }
        };

        const source = this.map.getSource(sourceId);
        if (!source) {
            this.map.addSource(sourceId, {
                type: 'geojson',
                data: sourceData
            });
            return;
        }

        if (typeof source.setData === 'function') {
            source.setData(sourceData);
        }
    }

    private ensureTrackLayer(layerId: string, sourceId: string, color: string, paintOverrides: Record<string, number>) {
        if (this.map.getLayer(layerId)) return;

        this.map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': color,
                ...paintOverrides,
                'line-emissive-strength': 1.0
            }
        });
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

    private resolveTrackColors(activityType: ActivityTypes | undefined): { baseColor: string; adjustedColor: string } {
        const fallbackColor = '#2ca3ff';
        const maybeBaseColor = activityType ? this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activityType) : undefined;
        const baseColor = this.isHexColor(maybeBaseColor) ? maybeBaseColor : fallbackColor;
        const adjusted = this.mapStyleService.adjustColorForTheme(baseColor, this.isDarkTheme ? AppThemes.Dark : AppThemes.Normal);
        const adjustedColor = this.isHexColor(adjusted) ? adjusted : fallbackColor;
        return { baseColor, adjustedColor };
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
