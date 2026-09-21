import { isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { AppUserInterface } from '../models/app-user.interface';
import {
  APP_FORMAT_LOCALE_STORAGE_KEY,
  AppFormatLocalePreference,
  normalizeAppFormatLocalePreference,
  readStoredAppFormatLocalePreference,
  storeAppFormatLocalePreference,
} from '../shared/adapters/app-locale';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';
import { APP_STORAGE } from './storage/app.storage.token';

export type AppLocalePreferenceSyncResult = 'unchanged' | 'updated' | 'storage-unavailable';

const APP_FORMAT_LOCALE_RELOAD_GUARD_KEY = 'appFormatLocaleReloadAttempt';

/**
 * Keeps the account preference and the pre-bootstrap cache aligned. Angular's
 * locale providers are bootstrap-scoped, so applying a changed cache requires
 * one reload rather than maintaining two locale states in the same app session.
 */
@Injectable({ providedIn: 'root' })
export class AppLocaleService {
  private readonly isBrowser: boolean;

  constructor(
    @Inject(APP_STORAGE) private readonly storage: Storage,
    @Inject(PLATFORM_ID) platformId: object,
    private readonly windowService: AppWindowService,
    private readonly logger: LoggerService,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  public cachePreference(preference: unknown): AppLocalePreferenceSyncResult {
    if (!this.isBrowser) return 'unchanged';

    const normalizedPreference = normalizeAppFormatLocalePreference(preference);
    let storedPreference: string | null;
    try {
      storedPreference = this.storage.getItem(APP_FORMAT_LOCALE_STORAGE_KEY);
    } catch {
      this.logger.warn('[AppLocaleService] Regional format was saved but browser storage is unavailable.');
      return 'storage-unavailable';
    }

    if (storedPreference === normalizedPreference) {
      return 'unchanged';
    }

    if (!storeAppFormatLocalePreference(normalizedPreference, this.storage)) {
      this.logger.warn('[AppLocaleService] Regional format was saved but browser storage is unavailable.');
      return 'storage-unavailable';
    }

    if (normalizeAppFormatLocalePreference(storedPreference) === normalizedPreference) {
      // Repair missing or invalid cache values without reloading when they
      // already resolved to the same effective preference.
      return 'unchanged';
    }

    return 'updated';
  }

  public reconcileAccountPreference(user: AppUserInterface | null): AppLocalePreferenceSyncResult {
    if (!this.isBrowser || !user?.uid) return 'unchanged';

    const preference = normalizeAppFormatLocalePreference(user.settings?.appSettings?.formatLocale);
    const result = this.cachePreference(preference);
    if (result === 'unchanged') {
      this.clearReloadGuard(user.uid, preference);
    } else if (result === 'updated' && this.claimReload(user.uid, preference)) {
      this.reload();
    }
    return result;
  }

  public reload(): void {
    if (!this.isBrowser) return;
    this.windowService.windowRef.location.reload();
  }

  public getCachedPreference(): AppFormatLocalePreference {
    return readStoredAppFormatLocalePreference(this.isBrowser ? this.storage : null);
  }

  private claimReload(userId: string, preference: AppFormatLocalePreference): boolean {
    const guardValue = `${userId}:${preference}`;
    try {
      const sessionStorage = this.windowService.windowRef.sessionStorage;
      if (!sessionStorage) {
        this.logger.warn('[AppLocaleService] Regional format cache changed, but a guarded reload is unavailable.');
        return false;
      }
      if (sessionStorage.getItem(APP_FORMAT_LOCALE_RELOAD_GUARD_KEY) === guardValue) {
        this.logger.warn('[AppLocaleService] Prevented a repeated regional format reload.');
        return false;
      }
      sessionStorage.setItem(APP_FORMAT_LOCALE_RELOAD_GUARD_KEY, guardValue);
      if (sessionStorage.getItem(APP_FORMAT_LOCALE_RELOAD_GUARD_KEY) !== guardValue) {
        this.logger.warn('[AppLocaleService] Regional format cache changed, but the reload guard could not be verified.');
        return false;
      }
      return true;
    } catch {
      this.logger.warn('[AppLocaleService] Regional format cache changed, but the reload guard is unavailable.');
      return false;
    }
  }

  private clearReloadGuard(userId: string, preference: AppFormatLocalePreference): void {
    const guardValue = `${userId}:${preference}`;
    try {
      const sessionStorage = this.windowService.windowRef.sessionStorage;
      if (sessionStorage?.getItem(APP_FORMAT_LOCALE_RELOAD_GUARD_KEY) === guardValue) {
        sessionStorage.removeItem(APP_FORMAT_LOCALE_RELOAD_GUARD_KEY);
      }
    } catch {
      // The preference is already applied. A blocked cleanup must not affect the app.
    }
  }
}
