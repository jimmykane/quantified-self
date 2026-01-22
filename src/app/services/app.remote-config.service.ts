import { APP_STORAGE } from './storage/app.storage.token';
import { Inject, PLATFORM_ID, Injectable, inject, signal, Signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AppWindowService } from './app.window.service';
import { AppUserService } from './app.user.service';
import { environment } from '../../environments/environment';
import { LoggerService } from './logger.service';
import { RemoteConfig } from '@angular/fire/remote-config';
import { fetchAndActivate, getString } from 'firebase/remote-config';


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
    private readonly remoteConfig = inject(RemoteConfig);
    private readonly windowService = inject(AppWindowService);
    private readonly userService = inject(AppUserService);
    private readonly logger = inject(LoggerService);
    private readonly storage = inject(APP_STORAGE);
    private readonly platformId = inject(PLATFORM_ID);

    // Signals for state management
    private readonly _configLoaded = signal<boolean>(false);
    private readonly _isAdmin = signal<boolean | null>(null);
    private readonly _maintenanceModeRaw = signal<boolean>(false);
    private readonly _maintenanceMessageRaw = signal<string>('');

    // Public signals
    readonly configLoaded: Signal<boolean> = this._configLoaded.asReadonly();
    readonly maintenanceMessage: Signal<string> = this._maintenanceMessageRaw.asReadonly();

    /**
     * Computed maintenance mode status.
     * Takes into account admin status and bypass flags.
     */
    readonly maintenanceMode = computed(() => {
        const loaded = this._configLoaded();
        const isAdmin = this._isAdmin();
        const rawMode = this._maintenanceModeRaw();

        if (!loaded) return false;

        // Not in maintenance? Return false immediately.
        if (!rawMode) return false;

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
    });

    readonly isLoading = computed(() => !this._configLoaded());

    constructor() {
        // Set minimum fetch interval:
        // - Production: 1 hour (3,600,000ms) - balance between freshness and throttle limits
        // - Dev/Beta: 5 minutes (300,000ms) - faster updates for testing
        const fiveMinutes = 300000;
        const oneHour = 3600000;
        this.remoteConfig.settings.minimumFetchIntervalMillis = environment.production ? oneHour : fiveMinutes;

        this.checkAdminStatus();
        this.initializeConfig();
    }

    private async checkAdminStatus(): Promise<void> {
        try {
            const isAdmin = await this.userService.isAdmin();
            this.logger.log('[RemoteConfig] Admin status:', isAdmin);
            this._isAdmin.set(isAdmin);
        } catch (e) {
            this.logger.log('[RemoteConfig] Could not check admin status:', e);
            this._isAdmin.set(false);
        }
    }

    private async initializeConfig(): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        try {
            await fetchAndActivate(this.remoteConfig);
            this.updateMaintenanceState();
            this._configLoaded.set(true);
            this.logger.log('[RemoteConfig] Configuration initialized');
        } catch (err) {
            this.logger.error('[RemoteConfig] Failed to fetch remote config', err);
        }
    }

    private updateMaintenanceState(): void {
        try {
            const env = this.environmentName;

            // Read from parameterGroups structure: {env}_enabled, {env}_message
            const enabledValue = getString(this.remoteConfig, `${env}_enabled`);
            const messageValue = getString(this.remoteConfig, `${env}_message`);

            const enabled = enabledValue === 'true';
            const message = messageValue || '';

            this._maintenanceModeRaw.set(enabled);
            this._maintenanceMessageRaw.set(message);
            this.logger.log(`[RemoteConfig] Maintenance Mode (${env}):`, enabled);
        } catch (err) {
            this.logger.warn('[RemoteConfig] Failed to read maintenance config', err);
        }
    }


    private get environmentName(): string {
        if (environment.production) {
            return 'prod';
        }

        if (environment.beta) {
            return 'beta';
        }

        if (environment.localhost) {
            return 'dev';
        }

        throw new Error('[RemoteConfig] Unknown environment - cannot determine maintenance key');
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
}
