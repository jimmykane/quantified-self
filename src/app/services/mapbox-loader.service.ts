import { Injectable, NgZone, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class MapboxLoaderService {
    private mapboxgl: any | null = null;
    private apiLoadingPromise: Promise<any> | null = null;

    constructor(
        private zone: NgZone,
        @Inject(PLATFORM_ID) private platformId: object
    ) { }

    /**
     * Loads the Mapbox GL JS library dynamically.
     * This ensures the library is only loaded in the browser and not during SSR.
     */
    async loadMapbox(): Promise<any> {
        if (!isPlatformBrowser(this.platformId)) {
            throw new Error('Mapbox GL JS can only be loaded in the browser.');
        }

        if (this.mapboxgl) {
            return this.mapboxgl;
        }

        if (this.apiLoadingPromise) {
            return this.apiLoadingPromise;
        }

        this.apiLoadingPromise = import('mapbox-gl').then(module => {
            const mapboxgl = module.default || module;
            (mapboxgl as any).accessToken = environment.mapboxAccessToken;
            this.mapboxgl = mapboxgl;
            return mapboxgl;
        });

        return this.apiLoadingPromise;
    }

    /**
     * Creates a Mapbox GL map instance running outside of Angular's zone to prevent
     * excessive change detection cycles during map interactions.
     */
    async createMap(container: HTMLElement, options?: Omit<mapboxgl.MapOptions, 'container'>): Promise<mapboxgl.Map> {
        const mapboxgl = await this.loadMapbox();

        return this.zone.runOutsideAngular(() => {
            return new mapboxgl.Map({
                container,
                style: 'mapbox://styles/mapbox/dark-v11', // Default dark style
                center: [0, 0],
                zoom: 2,
                ...options
            });
        });
    }
}
