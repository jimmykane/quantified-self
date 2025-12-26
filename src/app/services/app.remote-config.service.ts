import { Injectable, inject } from '@angular/core';
import { Observable, BehaviorSubject, from, of, combineLatest } from 'rxjs';
import { map, filter, shareReplay, switchMap, take, catchError } from 'rxjs/operators';
import { AppWindowService } from './app.window.service';
import { AppUserService } from './app.user.service';
import { environment } from '../../environments/environment';

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
        private userService: AppUserService
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
                    console.log('[RemoteConfig] Admin user - bypassing maintenance mode');
                    return false;
                }

                // URL bypass?
                if (this.isBypassEnabled()) {
                    console.log('[RemoteConfig] URL bypass enabled');
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
            console.log('[RemoteConfig] Admin status:', isAdmin);
            this.isAdmin$.next(isAdmin);
        } catch (e) {
            console.log('[RemoteConfig] Could not check admin status:', e);
            this.isAdmin$.next(false);
        }
    }

    async initializeConfig(): Promise<boolean> {
        try {
            console.log('[RemoteConfig] Fetching config...');

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
            console.log('[RemoteConfig] Response:', data.state);

            if (data.entries) {
                if ('maintenance_mode' in data.entries) {
                    const value = data.entries.maintenance_mode;
                    this.maintenanceModeValue = value === 'true' || value === true;
                    console.log('[RemoteConfig] maintenance_mode:', this.maintenanceModeValue);
                }
                if ('maintenance_message' in data.entries) {
                    this.maintenanceMessageValue = data.entries.maintenance_message;
                }
            }

            this.configLoaded$.next(true);
            return true;
        } catch (e) {
            console.error('[RemoteConfig] Fetch failed:', e);
            this.configLoaded$.next(true);
            return false;
        }
    }

    private getOrCreateInstanceId(): string {
        const key = 'rc_instance_id';
        let id = localStorage.getItem(key);
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem(key, id);
        }
        return id;
    }

    private isBypassEnabled(): boolean {
        return this.windowService.windowRef.location.search.includes('bypass_maintenance=true');
    }

    getMaintenanceMode(): Observable<boolean> {
        return this.maintenanceMode$;
    }

    getMaintenanceMessage(): Observable<string> {
        return this.maintenanceMessage$;
    }
}
