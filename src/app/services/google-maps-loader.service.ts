import { Injectable, NgZone, EnvironmentInjector, runInInjectionContext, inject } from '@angular/core';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { AppCheck, getToken } from '@angular/fire/app-check';

import { environment } from '../../environments/environment';
import { LoggerService } from './logger.service';

@Injectable({
    providedIn: 'root'
})
export class GoogleMapsLoaderService {

    private appCheck = inject(AppCheck);
    private injector = inject(EnvironmentInjector);
    private logger = inject(LoggerService);

    constructor(private zone: NgZone) {
        // Official way to set globally shared options as per:
        // https://developers.google.com/maps/documentation/javascript/load-maps-js-api#js-api-loader
        setOptions({
            key: environment.firebase.apiKey,
            v: 'weekly',
        });

        // Initialize App Check for Maps immediately
        this.initializeGoogleMapsAppCheck();
    }

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
    private async initializeGoogleMapsAppCheck() {
        const { Settings } = await importLibrary('core');
        (Settings.getInstance() as any).fetchAppCheckToken = () => {
            return runInInjectionContext(this.injector, () => {
                return getToken(this.appCheck).then((tokenResult) => {
                    return { token: tokenResult.token };
                }).catch((error) => {
                    this.logger.error('[GoogleMaps] App Check token fetch failed:', error);
                    throw error;
                });
            });
        };
    }
}
