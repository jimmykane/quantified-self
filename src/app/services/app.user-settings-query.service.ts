import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, distinctUntilChanged } from 'rxjs/operators';
import { AppAuthService } from '../authentication/app.auth.service';
import { AppUserService } from './app.user.service';
import {
    User,
    UserChartSettingsInterface,
    UserMapSettingsInterface,
    UserUnitSettingsInterface,
    UserMyTracksSettingsInterface
} from '@sports-alliance/sports-lib';
import equal from 'fast-deep-equal';

@Injectable({
    providedIn: 'root'
})
export class AppUserSettingsQueryService {
    private authService = inject(AppAuthService);

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
            distinctUntilChanged((prev, curr) => equal(prev, curr))
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

}
