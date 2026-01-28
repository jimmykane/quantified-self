import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, distinctUntilChanged, tap } from 'rxjs/operators';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppUserService } from './app.user.service';
import {
    UserChartSettingsInterface,
    UserMapSettingsInterface,
    UserMyTracksSettingsInterface,
    AppThemes
} from '@sports-alliance/sports-lib';
import equal from 'fast-deep-equal';
import { AppMyTracksSettings } from '../models/app-user.interface';

import { LoggerService } from './logger.service';

@Injectable({
    providedIn: 'root'
})
export class AppUserSettingsQueryService {
    private authService = inject(AppAuthService);
    private userService = inject(AppUserService);
    private logger = inject(LoggerService);

    /**
     * Base user stream, distinct until the user object identity modification or deep content change.
     * However, we primarily use this to derive granular settings.
     */
    private user$ = this.authService.user$;

    /**
     * Chart Settings Signal
     * Only emits when user.settings.chartSettings deeply changes.
     */
    public readonly chartSettings = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.chartSettings ?? {} as UserChartSettingsInterface),
            distinctUntilChanged((prev, curr) => equal(prev, curr))
        ),
        { initialValue: {} as UserChartSettingsInterface }
    );

    /**
     * Map Settings Signal
     * Only emits when user.settings.mapSettings deeply changes.
     */
    public readonly mapSettings = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.mapSettings ?? {} as UserMapSettingsInterface),
            distinctUntilChanged((prev, curr) => equal(prev, curr))
        ),
        { initialValue: {} as UserMapSettingsInterface }
    );

    /**
     * Unit Settings Signal
     * Only emits when user.settings.unitSettings deeply changes.
     */
    public readonly unitSettings = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.unitSettings ?? AppUserService.getDefaultUserUnitSettings()),
            distinctUntilChanged((prev, curr) => equal(prev, curr))
        ),
        { initialValue: AppUserService.getDefaultUserUnitSettings() }
    );

    /**
     * My Tracks Settings Signal (for TracksComponent)
     */
    public readonly myTracksSettings = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.myTracksSettings ?? {} as UserMyTracksSettingsInterface),
            distinctUntilChanged((prev, curr) => equal(prev, curr)),
            tap(settings => this.logger.info('[AppUserSettingsQueryService] Only Emitting My Tracks Settings Change:', settings))
        ),
        { initialValue: {} as UserMyTracksSettingsInterface }
    );

    /**
     * App Theme Signal (from settings)
     * Note: AppThemeService handles the actual logic, but this exposes the setting itself.
     */
    public readonly appThemeSetting = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.appSettings?.theme),
            distinctUntilChanged()
        ),
        { initialValue: undefined }
    );

    /**
     * Updates My Tracks settings by merging the provided partial settings.
     * Handles missing 'settings' or 'myTracksSettings' on the user object internally.
     */
    public async updateMyTracksSettings(settings: Partial<AppMyTracksSettings>): Promise<void> {
        this.logger.info(`[AppUserSettingsQueryService] Updating My Tracks Settings:`, settings);
        const user = await this.getCurrentUser();
        if (!user) {
            this.logger.warn(`[AppUserSettingsQueryService] Cannot update My Tracks Settings. No user logged in.`);
            return;
        }

        const updatedSettings = {
            myTracksSettings: settings
        };

        return this.userService.updateUserProperties(user, { settings: updatedSettings })
            .then(() => this.logger.info(`[AppUserSettingsQueryService] My Tracks Settings updated successfully.`))
            .catch(err => this.logger.error(`[AppUserSettingsQueryService] Failed to update My Tracks Settings:`, err));
    }

    /**
     * Updates Map settings by merging the provided partial settings.
     */
    public async updateMapSettings(settings: Partial<UserMapSettingsInterface>): Promise<void> {
        this.logger.info(`[AppUserSettingsQueryService] Updating Map Settings:`, settings);
        const user = await this.getCurrentUser();
        if (!user) {
            this.logger.warn(`[AppUserSettingsQueryService] Cannot update Map Settings. No user logged in.`);
            return;
        }

        const updatedSettings = {
            mapSettings: settings
        };

        return this.userService.updateUserProperties(user, { settings: updatedSettings })
            .then(() => this.logger.info(`[AppUserSettingsQueryService] Map Settings updated successfully.`))
            .catch(err => this.logger.error(`[AppUserSettingsQueryService] Failed to update Map Settings:`, err));
    }

    /**
     * Updates Chart settings by merging the provided partial settings.
     */
    public async updateChartSettings(settings: Partial<UserChartSettingsInterface>): Promise<void> {
        this.logger.info(`[AppUserSettingsQueryService] Updating Chart Settings:`, settings);
        const user = await this.getCurrentUser();
        if (!user) {
            this.logger.warn(`[AppUserSettingsQueryService] Cannot update Chart Settings. No user logged in.`);
            return;
        }

        const updatedSettings = {
            chartSettings: settings
        };

        return this.userService.updateUserProperties(user, { settings: updatedSettings })
            .then(() => this.logger.info(`[AppUserSettingsQueryService] Chart Settings updated successfully.`))
            .catch(err => this.logger.error(`[AppUserSettingsQueryService] Failed to update Chart Settings:`, err));
    }

    /**
     * Updates App Theme.
     */
    public async updateAppTheme(theme: string): Promise<void> {
        this.logger.info(`[AppUserSettingsQueryService] Updating App Theme:`, theme);
        const user = await this.getCurrentUser();
        if (!user) {
            this.logger.warn(`[AppUserSettingsQueryService] Cannot update App Theme. No user logged in.`);
            return;
        }

        const updatedSettings = {
            appSettings: {
                theme
            }
        };

        return this.userService.updateUserProperties(user, { settings: updatedSettings })
            .then(() => this.logger.info(`[AppUserSettingsQueryService] App Theme updated successfully.`))
            .catch(err => this.logger.error(`[AppUserSettingsQueryService] Failed to update App Theme:`, err));
    }

    /**
     * Transforms a theme string to an AppThemes enum.
     */
    public transformToUserAppTheme(theme: string): AppThemes {
        switch (theme) {
            case 'light':
                return AppThemes.Normal;
            case 'dark':
                return AppThemes.Dark;
            default:
                return AppThemes.Normal;
        }
    }

    private async getCurrentUser() {
        // We get the latest user from the auth service synchronously if possible via getValue() if it was a BehaviorSubject,
        // but since it's an Observable, we take(1).
        // OR better: rely on the injected Auth object if possible, but keeping consistent with app flow:
        const { take } = await import('rxjs/operators');
        const { firstValueFrom } = await import('rxjs');
        return firstValueFrom(this.authService.user$.pipe(take(1)));
    }

}
