import { Injectable, NgZone, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Map as MapboxMap, MapOptions } from 'mapbox-gl';
import { environment } from '../../environments/environment';

type MapboxGlRuntime = typeof import('mapbox-gl/dist/esm/mapbox-gl.js');
type MapboxGlApi = MapboxGlRuntime['default'];

export const MAPBOX_ESM_WORKER_ASSET_PATH = 'assets/mapbox-gl/esm/worker.js';
export const MAPBOX_CSS_ASSET_PATH = 'assets/mapbox-gl/mapbox-gl.css';

export function resolveMapboxEsmWorkerUrl(baseUri: string): string {
    return new URL(MAPBOX_ESM_WORKER_ASSET_PATH, baseUri).toString();
}

export function resolveMapboxCssUrl(baseUri: string): string {
    return new URL(MAPBOX_CSS_ASSET_PATH, baseUri).toString();
}

@Injectable({
    providedIn: 'root'
})
export class MapboxLoaderService {
    private mapboxgl: MapboxGlApi | null = null;
    private apiLoadingPromise: Promise<MapboxGlApi> | null = null;
    private stylesLoadingPromise: Promise<void> | null = null;

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

        this.apiLoadingPromise = Promise.all([
            import('mapbox-gl/dist/esm/mapbox-gl.js'),
            this.loadMapboxStyles(),
        ]).then(([module]) => {
            const mapboxgl = module.default || (module as unknown as MapboxGlApi);
            mapboxgl.workerUrl = resolveMapboxEsmWorkerUrl(document.baseURI);
            mapboxgl.accessToken = environment.mapboxAccessToken;
            this.mapboxgl = mapboxgl;
            return mapboxgl;
        }).catch((error: unknown) => {
            this.apiLoadingPromise = null;
            throw error;
        });

        return this.apiLoadingPromise;
    }

    private loadMapboxStyles(): Promise<void> {
        if (!this.stylesLoadingPromise) {
            this.stylesLoadingPromise = new Promise<void>((resolve, reject) => {
                const stylesheet = document.createElement('link');
                stylesheet.rel = 'stylesheet';
                stylesheet.href = resolveMapboxCssUrl(document.baseURI);
                stylesheet.dataset['mapboxGlStylesheet'] = 'true';
                stylesheet.addEventListener('load', () => resolve(), { once: true });
                stylesheet.addEventListener('error', () => {
                    stylesheet.remove();
                    reject(new Error('Failed to load Mapbox GL CSS.'));
                }, { once: true });
                document.head.appendChild(stylesheet);
            }).catch((error: unknown) => {
                this.stylesLoadingPromise = null;
                throw error;
            });
        }

        return this.stylesLoadingPromise;
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
