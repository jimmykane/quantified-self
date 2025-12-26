import { Injectable } from '@angular/core';
import { FirebaseApp } from '@angular/fire/app';
import {
    RemoteConfig,
    fetchAndActivate,
    getBoolean,
    getString,
    getRemoteConfig
} from 'firebase/remote-config';
import { Observable, BehaviorSubject } from 'rxjs';
import { map, filter, shareReplay, startWith } from 'rxjs/operators';
import { AppWindowService } from './app.window.service';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class AppRemoteConfigService {
    private remoteConfig: RemoteConfig;
    private configLoaded$ = new BehaviorSubject<boolean>(false);

    readonly maintenanceMode$: Observable<boolean>;
    readonly maintenanceMessage$: Observable<string>;

    constructor(
        private firebaseApp: FirebaseApp,
        private windowService: AppWindowService
    ) {
        this.remoteConfig = getRemoteConfig(this.firebaseApp);

        // Set defaults (used if fetch fails)
        this.remoteConfig.defaultConfig = {
            maintenance_mode: false,
            maintenance_message: "We're currently performing maintenance. We'll be back soon."
        };

        // Fetch interval: 1 hour for production, 10 seconds for dev
        this.remoteConfig.settings.minimumFetchIntervalMillis =
            environment.production ? 3600000 : 10000;

        // Create observables that wait for config to load
        this.maintenanceMode$ = this.configLoaded$.pipe(
            filter(loaded => loaded),
            map(() => {
                if (this.isBypassEnabled()) {
                    return false;
                }
                return getBoolean(this.remoteConfig, 'maintenance_mode');
            }),
            shareReplay(1)
        );

        this.maintenanceMessage$ = this.configLoaded$.pipe(
            filter(loaded => loaded),
            map(() => getString(this.remoteConfig, 'maintenance_message')),
            shareReplay(1)
        );

        // Initialize config on construction
        this.initializeConfig();
    }

    /**
     * Initialize Remote Config - fetches and activates.
     * Called by APP_INITIALIZER to block app startup.
     */
    async initializeConfig(): Promise<boolean> {
        try {
            console.log('[RemoteConfig] Fetching config...');
            const fetchResult = await fetchAndActivate(this.remoteConfig);
            console.log('[RemoteConfig] Fetch complete. New values:', fetchResult);

            const maintenanceMode = getBoolean(this.remoteConfig, 'maintenance_mode');
            const maintenanceMessage = getString(this.remoteConfig, 'maintenance_message');
            console.log('[RemoteConfig] Config values:', { maintenanceMode, maintenanceMessage });

            this.configLoaded$.next(true);
            return true;
        } catch (e) {
            console.error('[RemoteConfig] Fetch failed, using defaults:', e);
            this.configLoaded$.next(true); // Use defaults on failure
            return false;
        }
    }

    /**
     * Check if maintenance mode bypass is enabled via URL parameter.
     */
    private isBypassEnabled(): boolean {
        const bypass = this.windowService.windowRef.location.search.includes('bypass_maintenance=true');
        if (bypass) {
            console.log('[RemoteConfig] Bypass enabled via URL parameter');
        }
        return bypass;
    }

    getMaintenanceMode(): Observable<boolean> {
        return this.maintenanceMode$;
    }

    getMaintenanceMessage(): Observable<string> {
        return this.maintenanceMessage$;
    }
}
