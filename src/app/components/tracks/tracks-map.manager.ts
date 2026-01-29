import { NgZone } from '@angular/core';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES } from '@sports-alliance/sports-lib';

export class TracksMapManager {
    private map: any; // Mapbox GL map instance
    private activeLayerIds: string[] = []; // Store IDs of added layers/sources
    private mapboxgl: any; // Mapbox GL JS library reference
    private terrainControl: any;

    constructor(
        private zone: NgZone,
        private eventColorService: AppEventColorService
    ) { }

    public setMap(map: any, mapboxgl: any) {
        this.map = map;
        this.mapboxgl = mapboxgl;
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
        const color = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activity.type);

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
                        'line-opacity': 0.6
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
                        'line-opacity': 0.9
                    }
                });

                this.activeLayerIds.push(layerId);
                this.activeLayerIds.push(glowLayerId);
                this.activeLayerIds.push(sourceId);

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
        });
    }

    public get hasTracks(): boolean {
        return this.activeLayerIds.length > 0;
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
                    this.map.once('style.load', () => this.toggleTerrain(enable, animate));
                }
            }
        });
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
