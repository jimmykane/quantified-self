import { Injectable, NgZone } from '@angular/core';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class GoogleMapsLoaderService {

    constructor(private zone: NgZone) {
        // Official way to set globally shared options as per:
        // https://developers.google.com/maps/documentation/javascript/load-maps-js-api#js-api-loader
        setOptions({
            key: environment.firebase.apiKey,
            v: 'weekly',
        });
    }

    /**
     * Loads a specific Google Maps library using the dynamic importLibrary pattern.
     * See: https://developers.google.com/maps/documentation/javascript/load-maps-js-api#js-api-loader
     * @param name The name of the library (e.g., 'maps', 'visualization', 'places', 'core').
     */
    /**
     * Loads a specific Google Maps library using the dynamic importLibrary pattern.
     * See: https://developers.google.com/maps/documentation/javascript/load-maps-js-api#js-api-loader
     * @param name The name of the library (e.g., 'maps', 'visualization', 'places', 'core').
     */
    importLibrary(name: string): Promise<any> {
        return this.zone.runOutsideAngular(() => importLibrary(name));
    }

    /**
     * Helper to set App Check token provider in the official way.
     * See: https://developers.google.com/maps/documentation/javascript/places-app-check#step-4-initialize-the-places-and-app-check-apis
     */
    async setAppCheckProvider(getTokenFn: () => Promise<any>) {
        const { Settings } = await importLibrary('core');
        (Settings.getInstance() as any).fetchAppCheckToken = getTokenFn;
    }
}
