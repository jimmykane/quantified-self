import { APP_STORAGE } from './storage/app.storage.token';
import { Inject, PLATFORM_ID, Injectable } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, BehaviorSubject, combineLatest, from } from 'rxjs';
import { map, filter, shareReplay, catchError, tap } from 'rxjs/operators';
import { AppWindowService } from './app.window.service';
import { AppUserService } from './app.user.service';
import { environment } from '../../environments/environment';
import { LoggerService } from './logger.service';
import { RemoteConfig, fetchAndActivate, getAll, getValue } from '@angular/fire/remote-config';

/**
 * Remote Config Service
 * Uses AngularFire SDK to fetch maintenance mode configuration.
 * Initialization is non-blocking to ensure fast app startup.
 * 
 * Admin users automatically bypass maintenance mode.
 */
@Injectable({
    providedIn: 'root'
})
export class AppRemoteConfigService {
    private configLoaded$ = new BehaviorSubject<boolean>(false);
    private isAdmin$ = new BehaviorSubject<boolean | null>(null);
    private maintenanceModeValue = false;
    private maintenanceMessageValue = "";

    readonly maintenanceMode$: Observable<boolean>;
    readonly maintenanceMessage$: Observable<string>;
    readonly isLoading: Observable<boolean>;

    constructor(
        private windowService: AppWindowService,
        private userService: AppUserService,
        private logger: LoggerService,
        @Inject(APP_STORAGE) private storage: Storage,
        @Inject(PLATFORM_ID) private platformId: object,
        private remoteConfig: RemoteConfig
    ) {
        // Check admin status initially
        this.checkAdminStatus();

        this.maintenanceMode$ = combineLatest([
            this.configLoaded$.pipe(filter(loaded => loaded)),
            this.isAdmin$
        ]).pipe(
            map(([_, isAdmin]) => {
                // Not in maintenance? Return false immediately, no need to wait for admin check.
                if (!this.maintenanceModeValue) return false;

                // In maintenance? We must wait for admin check to complete.
                if (isAdmin === null) return null;

                // Admin? Bypass.
                if (isAdmin) {
                    this.logger.log('[RemoteConfig] Admin user - bypassing maintenance mode');
                    return false;
                }

                // URL bypass?
                if (this.isBypassEnabled()) {
                    this.logger.log('[RemoteConfig] URL bypass enabled');
                    return false;
                }

                // Strictly in maintenance mode for regular user
                return true;
            }),
            // Filter out pending states (null)
            filter((mode): mode is boolean => mode !== null),
            shareReplay(1)
        );

        this.maintenanceMessage$ = this.configLoaded$.pipe(
            filter(loaded => loaded),
            map(() => this.maintenanceMessageValue),
            shareReplay(1)
        );

        this.isLoading = this.configLoaded$.pipe(
            map(loaded => !loaded),
            shareReplay(1)
        );

        this.initializeConfig();
    }

    getIsLoading(): Observable<boolean> {
        return this.isLoading;
    }

    /**
     * Check if current user is admin
     */
    private async checkAdminStatus(): Promise<void> {
        try {
            const isAdmin = await this.userService.isAdmin();
            this.logger.log('[RemoteConfig] Admin status:', isAdmin);
            this.isAdmin$.next(isAdmin);
        } catch (e) {
            this.logger.log('[RemoteConfig] Could not check admin status:', e);
            this.isAdmin$.next(false);
        }
    }

    async initializeConfig(): Promise<boolean> {
        try {
            this.logger.log('[RemoteConfig] Fetching config via SDK...');

            // Set settings (optional, e.g. minimumFetchIntervalMillis)
            // this.remoteConfig.settings.minimumFetchIntervalMillis = 3600000; 

            const activated = await fetchAndActivate(this.remoteConfig);
            this.logger.log('[RemoteConfig] Activated:', activated);

            const allConfigs = getAll(this.remoteConfig);

            let envSuffix: 'prod' | 'beta' | 'dev' = 'beta';
            if (environment.production) envSuffix = 'prod';
            else if (environment.beta) envSuffix = 'beta';
            else if (environment.localhost) envSuffix = 'dev';

            const modeKey = `maintenance_mode_${envSuffix}`;
            const messageKey = `maintenance_message_${envSuffix}`;

            // Try environment specific first
            if (allConfigs[modeKey]) {
                const value = allConfigs[modeKey].asBoolean();
                this.maintenanceModeValue = value;
                this.logger.log(`[RemoteConfig] ${modeKey}:`, this.maintenanceModeValue);
            } else if (allConfigs['maintenance_mode']) {
                // Fallback to legacy
                const value = allConfigs['maintenance_mode'].asBoolean();
                this.maintenanceModeValue = value;
                this.logger.log('[RemoteConfig] maintenance_mode (fallback):', this.maintenanceModeValue);
            }

            if (allConfigs[messageKey]) {
                this.maintenanceMessageValue = allConfigs[messageKey].asString();
            } else if (allConfigs['maintenance_message']) {
                this.maintenanceMessageValue = allConfigs['maintenance_message'].asString();
            }

            this.configLoaded$.next(true);
            return true;
        } catch (e) {
            this.logger.error('[RemoteConfig] Fetch failed:', e);
            this.configLoaded$.next(true); // Still mark as loaded to allow app to proceed/hide loading state
            return false;
        }
    }

    private isBypassEnabled(): boolean {
        const STORAGE_KEY = 'bypass_maintenance';

        if (isPlatformBrowser(this.platformId)) {
            const hasQueryParam = this.windowService.windowRef.location.search.includes('bypass_maintenance=true');

            if (hasQueryParam) {
                this.storage.setItem(STORAGE_KEY, 'true');
                return true;
            }
        }

        return this.storage.getItem(STORAGE_KEY) === 'true';
    }

    getMaintenanceMode(): Observable<boolean> {
        return this.maintenanceMode$;
    }

    getMaintenanceMessage(): Observable<string> {
        return this.maintenanceMessage$;
    }
}
