import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppUserService } from './app.user.service';
import {
    UserMyTracksSettingsInterface,
    UserSummariesSettingsInterface,
    AppThemes
} from '@sports-alliance/sports-lib';
import { AppUserUtilities } from '../utils/app.user.utilities';
import equal from 'fast-deep-equal';
import {
    AppMapSettingsInterface,
    AppChartSettingsInterface,
    AppMyTracksSettings,
    AppUserInterface
} from '../models/app-user.interface';

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
    private user$ = this.authService.user$ as Observable<AppUserInterface | null>;

    /**
     * Chart Settings Signal
     * Only emits when user.settings.chartSettings deeply changes.
     */
    public readonly chartSettings = toSignal(
        this.user$.pipe(
            map(user => (user?.settings?.chartSettings ?? {}) as AppChartSettingsInterface),
            distinctUntilChanged((prev, curr) => equal(prev, curr))
        ),
        { initialValue: {} as AppChartSettingsInterface }
    );

    /**
     * Map Settings Signal
     * Only emits when user.settings.mapSettings deeply changes.
     */
    public readonly mapSettings = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.mapSettings ?? {} as AppMapSettingsInterface),
            distinctUntilChanged((prev, curr) => equal(prev, curr))
        ),
        { initialValue: {} as AppMapSettingsInterface }
    );

    /**
     * Unit Settings Signal
     * Only emits when user.settings.unitSettings deeply changes.
     */
    public readonly unitSettings = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.unitSettings ?? AppUserUtilities.getDefaultUserUnitSettings()),
        ),
        { initialValue: AppUserUtilities.getDefaultUserUnitSettings() }
    );

    /**
     * My Tracks Settings Signal (for TracksComponent)
     */
    public readonly myTracksSettings = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.myTracksSettings ?? {} as UserMyTracksSettingsInterface),
            distinctUntilChanged((prev, curr) => equal(prev, curr))
        ),
        { initialValue: {} as UserMyTracksSettingsInterface }
    );

    /**
     * Summaries Settings Signal
     */
    public readonly summariesSettings = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.summariesSettings ?? {} as UserSummariesSettingsInterface),
            distinctUntilChanged((prev, curr) => equal(prev, curr))
        ),
        { initialValue: {} as UserSummariesSettingsInterface }
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
     * Last Seen Changelog Date Signal
     */
    public readonly lastSeenChangelogDate = toSignal(
        this.user$.pipe(
            map(user => user?.settings?.appSettings?.lastSeenChangelogDate),
            distinctUntilChanged()
        ),
        { initialValue: undefined }
    );

    /**
     * Updates My Tracks settings by merging the provided partial settings.
     * Handles missing 'settings' or 'myTracksSettings' on the user object internally.
     */
    public async updateMyTracksSettings(settings: Partial<AppMyTracksSettings>): Promise<void> {
        const currentSettings = this.myTracksSettings();
        const hasChanges = Object.keys(settings).some(key => !equal(settings[key as keyof AppMyTracksSettings], currentSettings[key as keyof AppMyTracksSettings]));
        if (!hasChanges) {
            return;
        }

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
    public async updateMapSettings(settings: Partial<AppMapSettingsInterface>): Promise<void> {
        const currentSettings = this.mapSettings();
        const hasChanges = Object.keys(settings).some(key => !equal(settings[key as keyof AppMapSettingsInterface], currentSettings[key as keyof AppMapSettingsInterface]));
        if (!hasChanges) {
            return;
        }

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
    public async updateChartSettings(settings: Partial<AppChartSettingsInterface>): Promise<void> {
        const currentSettings = this.chartSettings();
        const hasChanges = Object.keys(settings).some(key => !equal(settings[key as keyof AppChartSettingsInterface], currentSettings[key as keyof AppChartSettingsInterface]));
        if (!hasChanges) {
            return;
        }

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
     * Updates Summaries settings by merging the provided partial settings.
     */
    public async updateSummariesSettings(settings: Partial<UserSummariesSettingsInterface>): Promise<void> {
        const currentSettings = this.summariesSettings();
        const hasChanges = Object.keys(settings).some(key => !equal(settings[key as keyof UserSummariesSettingsInterface], currentSettings[key as keyof UserSummariesSettingsInterface]));
        if (!hasChanges) {
            return;
        }

        this.logger.info(`[AppUserSettingsQueryService] Updating Summaries Settings:`, settings);
        const user = await this.getCurrentUser();
        if (!user) {
            this.logger.warn(`[AppUserSettingsQueryService] Cannot update Summaries Settings. No user logged in.`);
            return;
        }

        const updatedSettings = {
            summariesSettings: settings
        };

        return this.userService.updateUserProperties(user, { settings: updatedSettings })
            .then(() => this.logger.info(`[AppUserSettingsQueryService] Summaries Settings updated successfully.`))
            .catch(err => this.logger.error(`[AppUserSettingsQueryService] Failed to update Summaries Settings:`, err));
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
     * Updates Last Seen Changelog Date.
     */
    public async updateAppLastSeenChangelogDate(date: Date): Promise<void> {
        this.logger.info(`[AppUserSettingsQueryService] Updating Last Seen Changelog Date:`, date);
        const user = await this.getCurrentUser();
        if (!user) {
            this.logger.warn(`[AppUserSettingsQueryService] Cannot update Last Seen Changelog Date. No user logged in.`);
            return;
        }

        const updatedSettings = {
            appSettings: {
                lastSeenChangelogDate: date
            }
        };

        return this.userService.updateUserProperties(user, { settings: updatedSettings })
            .then(() => this.logger.info(`[AppUserSettingsQueryService] Last Seen Changelog Date updated successfully.`))
            .catch(err => this.logger.error(`[AppUserSettingsQueryService] Failed to update Last Seen Changelog Date:`, err));
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
