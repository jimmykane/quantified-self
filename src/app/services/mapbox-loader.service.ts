import { Injectable, NgZone, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Map as MapboxMap, MapOptions } from 'mapbox-gl';
import { environment } from '../../environments/environment';

type MapboxGlRuntime = typeof import('mapbox-gl');
type MapboxGlApi = MapboxGlRuntime['default'];

@Injectable({
    providedIn: 'root'
})
export class MapboxLoaderService {
    private mapboxgl: MapboxGlApi | null = null;
    private apiLoadingPromise: Promise<MapboxGlApi> | null = null;

    constructor(
        private zone: NgZone,
        @Inject(PLATFORM_ID) private platformId: object
    ) { }

    /**
     * Loads the Mapbox GL JS library dynamically.
     * This ensures the library is only loaded in the browser and not during SSR.
     */
    async loadMapbox(): Promise<MapboxGlApi> {
        if (!isPlatformBrowser(this.platformId)) {
            throw new Error('Mapbox GL JS can only be loaded in the browser.');
        }

        if (this.mapboxgl) {
            return this.mapboxgl;
        }

        if (this.apiLoadingPromise) {
            return this.apiLoadingPromise;
        }

        // @ts-expect-error Mapbox exports this ESM subpath, but this project uses node module resolution.
        const mapboxGlModulePromise = import('mapbox-gl/esm') as Promise<MapboxGlRuntime>;

        this.apiLoadingPromise = mapboxGlModulePromise.then(module => {
            const mapboxgl = module.default || (module as unknown as MapboxGlApi);
            mapboxgl.accessToken = environment.mapboxAccessToken;
            this.mapboxgl = mapboxgl;
            return mapboxgl;
        });

        return this.apiLoadingPromise;
    }

    /**
     * Creates a Mapbox GL map instance running outside of Angular's zone to prevent
     * excessive change detection cycles during map interactions.
     */
    async createMap(container: HTMLElement, options?: Omit<MapOptions, 'container'>): Promise<MapboxMap> {
        const mapboxgl = await this.loadMapbox();

        return this.zone.runOutsideAngular(() => {
            return new mapboxgl.Map({
                container,
                style: 'mapbox://styles/mapbox/standard', // Default standard style
                center: [0, 0],
                zoom: 2,
                cooperativeGestures: true,
                ...options
            });
        });
    }
}
