import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, combineLatest } from 'rxjs';
import { map, filter, shareReplay } from 'rxjs/operators';
import { AppWindowService } from './app.window.service';
import { AppUserService } from './app.user.service';
import { environment } from '../../environments/environment';
import { LoggerService } from './logger.service';

/**
 * Remote Config Service - Bypasses Firebase SDK completely due to persistent bugs.
 * Uses Firebase Remote Config REST API directly.
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

    constructor(
        private windowService: AppWindowService,
        private userService: AppUserService,
        private logger: LoggerService
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

        this.initializeConfig();
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
            this.logger.log('[RemoteConfig] Fetching config...');

            const projectId = environment.firebase.projectId;
            const apiKey = environment.firebase.apiKey;
            const appId = environment.firebase.appId;

            // Firebase Remote Config v1 REST endpoint
            const url = `https://firebaseremoteconfig.googleapis.com/v1/projects/${projectId}/namespaces/firebase:fetch?key=${apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                cache: 'no-store', // Prevent browser caching
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    appId: appId,
                    appInstanceId: this.getOrCreateInstanceId(),
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const data = await response.json();
            this.logger.log('[RemoteConfig] Response:', data.state);

            if (data.entries) {
                let envSuffix: 'prod' | 'beta' | 'dev' = 'beta';
                if (environment.production) envSuffix = 'prod';
                else if (environment.beta) envSuffix = 'beta';
                else if (environment.localhost) envSuffix = 'dev';

                const modeKey = `maintenance_mode_${envSuffix}`;
                const messageKey = `maintenance_message_${envSuffix}`;

                // Try environment specific first
                if (modeKey in data.entries) {
                    const value = data.entries[modeKey];
                    this.maintenanceModeValue = value === 'true' || value === true;
                    this.logger.log(`[RemoteConfig] ${modeKey}:`, this.maintenanceModeValue);
                } else if ('maintenance_mode' in data.entries) {
                    // Fallback to legacy
                    const value = data.entries.maintenance_mode;
                    this.maintenanceModeValue = value === 'true' || value === true;
                    this.logger.log('[RemoteConfig] maintenance_mode (fallback):', this.maintenanceModeValue);
                }

                if (messageKey in data.entries) {
                    this.maintenanceMessageValue = data.entries[messageKey];
                } else if ('maintenance_message' in data.entries) {
                    this.maintenanceMessageValue = data.entries.maintenance_message;
                }
            }

            this.configLoaded$.next(true);
            return true;
        } catch (e) {
            this.logger.error('[RemoteConfig] Fetch failed:', e);
            this.configLoaded$.next(true);
            return false;
        }
    }

    private getOrCreateInstanceId(): string {
        const key = 'rc_instance_id';
        let id = localStorage.getItem(key);
        if (!id) {
            // crypto.randomUUID() is only available in secure contexts (HTTPS/localhost)
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                id = crypto.randomUUID();
            } else {
                // Fallback for insecure contexts or older browsers
                id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                    const r = Math.random() * 16 | 0;
                    const v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }
            localStorage.setItem(key, id);
        }
        return id;
    }

    private isBypassEnabled(): boolean {
        const STORAGE_KEY = 'bypass_maintenance';
        const hasQueryParam = this.windowService.windowRef.location.search.includes('bypass_maintenance=true');

        if (hasQueryParam) {
            localStorage.setItem(STORAGE_KEY, 'true');
            return true;
        }

        return localStorage.getItem(STORAGE_KEY) === 'true';
    }

    getMaintenanceMode(): Observable<boolean> {
        return this.maintenanceMode$;
    }

    getMaintenanceMessage(): Observable<string> {
        return this.maintenanceMessage$;
    }
}
