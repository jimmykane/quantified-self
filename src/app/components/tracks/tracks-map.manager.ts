import { NgZone } from '@angular/core';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES, AppThemes } from '@sports-alliance/sports-lib';
import { MapStyleService } from '../../services/map-style.service';

export class TracksMapManager {
    private map: any; // Mapbox GL map instance
    private activeLayerIds: string[] = []; // Store IDs of added layers/sources
    private mapboxgl: any; // Mapbox GL JS library reference
    private terrainControl: any;
    private pendingTerrainToggle: { enable: boolean; animate: boolean } | null = null;
    private pendingTerrainListenerAttached = false;
    private isDarkTheme = false;
    private trackLayerBaseColors = new Map<string, string>();

    constructor(
        private zone: NgZone,
        private eventColorService: AppEventColorService,
        private mapStyleService: MapStyleService
    ) { }

    public setMap(map: any, mapboxgl: any) {
        this.map = map;
        this.mapboxgl = mapboxgl;
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

        const activityId = activity.getID() ? activity.getID() : `temp-${Date.now()}-${Math.random()}`;
        const sourceId = `track-source-${activityId}`;
        const layerId = `track-layer-${activityId}`;
        const glowLayerId = `track-layer-glow-${activityId}`;
        const baseColor = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activity.type);
        const color = this.mapStyleService.adjustColorForTheme(baseColor, this.isDarkTheme ? AppThemes.Dark : AppThemes.Normal);

        this.zone.runOutsideAngular(() => {
            // Check duplicates inside zone to be safe, though outside is also fine.
            // But we must wrap the map calls in try/catch for style loading issues.
            try {
                if (this.map.getSource(sourceId)) return;

                this.map.addSource(sourceId, {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: {
                            type: 'LineString',
                            coordinates: coordinates
                        }
                    }
                });

                // Add Glow Layer
                this.map.addLayer({
                    id: glowLayerId,
                    type: 'line',
                    source: sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': color,
                        'line-width': 6,
                        'line-blur': 3,
                        'line-opacity': 0.6,
                        'line-emissive-strength': 1.0 // Ensures visibility on Mapbox Standard Night
                    }
                });

                // Add Main Track Layer
                this.map.addLayer({
                    id: layerId,
                    type: 'line',
                    source: sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': color,
                        'line-width': 2.5,
                        'line-opacity': 0.9,
                        'line-emissive-strength': 1.0 // Ensures visibility on Mapbox Standard Night
                    }
                });

                this.activeLayerIds.push(layerId);
                this.activeLayerIds.push(glowLayerId);
                this.activeLayerIds.push(sourceId);
                this.trackLayerBaseColors.set(layerId, baseColor);
                this.trackLayerBaseColors.set(glowLayerId, baseColor);

            } catch (error: any) {
                if (error?.message?.includes('Style is not done loading')) {
                    // console.log('Style loading in progress, retrying track...');
                    this.map.once('style.load', () => this.addTrackFromActivity(activity, coordinates));
                } else {
                    console.warn('Failed to add track layer:', error);
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
            console.warn('[TracksMapManager] toggleTerrain called but map is not set.');
            return;
        }

        console.log(`[TracksMapManager] toggleTerrain called. Enable: ${enable}, Animate: ${animate}`);

        this.zone.runOutsideAngular(() => {
            try {
                if (!this.isStyleReady()) {
                    console.log('[TracksMapManager] Style not loaded yet. Deferring terrain toggle.');
                    this.deferTerrainToggle(enable, animate);
                    return;
                }

                if (enable) {
                    if (!this.map.getSource('mapbox-dem')) {
                        console.log('[TracksMapManager] Adding mapbox-dem source.');
                        this.map.addSource('mapbox-dem', {
                            'type': 'raster-dem',
                            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                            'tileSize': 512,
                            'maxzoom': 14
                        });
                    } else {
                        console.log('[TracksMapManager] mapbox-dem source already exists.');
                    }
                }

                if (enable) {
                    console.log('[TracksMapManager] Setting terrain to mapbox-dem and pitching to 60.');
                    this.map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
                    if (animate) this.map.easeTo({ pitch: 60 });
                    else this.map.setPitch(60);
                } else {
                    console.log('[TracksMapManager] Removing terrain and pitching to 0.');
                    this.map.setTerrain(null);
                    if (animate) this.map.easeTo({ pitch: 0 });
                    else this.map.setPitch(0);
                }

                if (this.terrainControl) {
                    this.terrainControl.set3DState(enable);
                }

            } catch (error: any) {
                console.error('[TracksMapManager] Error toggling terrain:', error);
                if (error?.message?.includes('Style is not done loading')) {
                    console.log('[TracksMapManager] Caught "Style is not done loading" error. Retrying on style.load.');
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

    public addControl(control: any, position?: string) {
        if (this.map) {
            this.map.addControl(control, position);
        }
    }

    public setTerrainControl(control: any) {
        this.terrainControl = control;
    }
}
