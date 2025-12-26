import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import {
    RemoteConfig,
    fetchAndActivate,
    getBoolean,
    getString,
    getRemoteConfig
} from 'firebase/remote-config';
import { Observable, from, map, of } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';
import { AppWindowService } from './app.window.service';

@Injectable({
    providedIn: 'root'
})
export class AppRemoteConfigService {
    private maintenanceMode$: Observable<boolean>;
    private maintenanceMessage$: Observable<string>;
    private remoteConfig: RemoteConfig;

    constructor(
        private firebaseApp: FirebaseApp,
        private windowService: AppWindowService
    ) {
        // Get the Remote Config instance directly from the Firebase App
        this.remoteConfig = getRemoteConfig(this.firebaseApp);

        // Initialize: Set defaults and fetch
        const initialized$ = from(this.initializeRemoteConfig()).pipe(shareReplay(1));

        this.maintenanceMode$ = initialized$.pipe(
            map(() => {
                const bypass = this.windowService.windowRef.location.search.includes('bypass_maintenance=true');
                if (bypass) {
                    console.log('Maintenance mode bypassed via query parameter');
                    return false;
                }
                return getBoolean(this.remoteConfig, 'maintenance_mode');
            }),
            catchError(error => {
                console.error('Error fetching remote config for mode:', error);
                return of(false);
            }),
            shareReplay(1)
        );

        this.maintenanceMessage$ = initialized$.pipe(
            map(() => getString(this.remoteConfig, 'maintenance_message')),
            catchError(error => {
                console.error('Error fetching remote config for message:', error);
                return of('We\'ll be back soon.');
            }),
            shareReplay(1)
        );
    }

    private async initializeRemoteConfig(): Promise<boolean> {
        try {
            // Set default values
            this.remoteConfig.defaultConfig = {
                maintenance_mode: false,
                maintenance_message: "We're currently upgrading the app to give you a better experience.\nWe'll be back in 2026."
            };

            // Set fetch interval to 10 seconds for faster updates
            // Note: Real-time updates are not supported with AngularFire's wrapped instances
            this.remoteConfig.settings.minimumFetchIntervalMillis = 10000;

            // Fetch and activate
            return await fetchAndActivate(this.remoteConfig);
        } catch (e) {
            console.error('Failed to init remote config', e);
            return false;
        }
    }

    getMaintenanceMode(): Observable<boolean> {
        return this.maintenanceMode$;
    }

    getMaintenanceMessage(): Observable<string> {
        return this.maintenanceMessage$;
    }
}
