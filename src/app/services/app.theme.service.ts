import { Injectable, OnDestroy, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppThemes, User } from '@sports-alliance/sports-lib';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { AppUserService } from './app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
import {
  AppThemePreference,
  isAppThemePreference,
  SYSTEM_THEME_PREFERENCE,
} from '../models/app-theme-preference.type';

type ThemeChangeOrigin = MouseEvent | HTMLElement | { x: number; y: number } | null | undefined;

@Injectable({
  providedIn: 'root',
})
export class AppThemeService implements OnDestroy {

  private readonly LOCAL_STORAGE_KEY = 'appTheme';
  private readonly MEDIA_QUERY = '(prefers-color-scheme: dark)';

  private appThemeSubject: BehaviorSubject<AppThemes> = new BehaviorSubject<AppThemes>(AppThemes.Normal);

  /**
   * Signal that tracks the currently applied application theme.
   */
  public appTheme: Signal<AppThemes> = toSignal(this.appThemeSubject, { initialValue: AppThemes.Normal });

  private themePreferenceSubject = new BehaviorSubject<AppThemePreference>(SYSTEM_THEME_PREFERENCE);

  /**
   * Signal that tracks the selected theme preference (Light / Dark / System).
   */
  public themePreference: Signal<AppThemePreference> = toSignal(
    this.themePreferenceSubject,
    { initialValue: SYSTEM_THEME_PREFERENCE }
  );

  private userSubscription: Subscription;
  private mediaQueryList: MediaQueryList;
  private systemThemeListener: (e: MediaQueryListEvent) => void;

  private user: User | null = null;

  constructor(
    private userService: AppUserService,
    private authService: AppAuthService,
  ) {
    this.mediaQueryList = window.matchMedia(this.MEDIA_QUERY);
    this.systemThemeListener = this.handleSystemThemeChange.bind(this);
    this.mediaQueryList.addEventListener('change', this.systemThemeListener);

    this.initializeTheme();
    this.userSubscription = this.authService.user$.subscribe(user => {
      this.user = user;
      const userPreference = this.getThemePreferenceFromUser(user);
      if (!userPreference) {
        return;
      }

      if (!this.hasExplicitUserThemePreference(user) && this.getThemePreferenceFromStorage()) {
        return;
      }

      this.applyThemePreference(userPreference, true, true);
    });
  }

  private initializeTheme() {
    const storedPreference = this.getThemePreferenceFromStorage();
    if (storedPreference) {
      this.applyThemePreference(storedPreference, false, true);
      return;
    }

    // No saved preference? Follow the operating system.
    this.applyThemePreference(SYSTEM_THEME_PREFERENCE, false, true);
  }

  private handleSystemThemeChange(e: MediaQueryListEvent) {
    if (this.themePreferenceSubject.getValue() !== SYSTEM_THEME_PREFERENCE) {
      return;
    }

    this.setAppTheme(e.matches ? AppThemes.Dark : AppThemes.Normal, false);
  }

  private async persistTheme(themePreference: AppThemePreference) {
    if (!this.user) {
      return;
    }

    const currentSettings = this.user.settings ?? {};
    const currentAppSettings = currentSettings.appSettings ?? {};
    const resolvedTheme = this.resolveThemePreference(themePreference);

    const nextSettings = {
      ...currentSettings,
      appSettings: {
        ...currentAppSettings,
        theme: resolvedTheme,
        themePreference,
      },
    };

    this.user = Object.assign(
      Object.create(Object.getPrototypeOf(this.user)),
      this.user,
      { settings: nextSettings }
    ) as User;

    await this.userService.updateUserProperties(this.user, {
      settings: nextSettings
    });
  }

  private applyThemeState(appTheme: AppThemes, applyToBody: boolean = true) {
    if (this.appThemeSubject.getValue() === appTheme) {
      return;
    }

    if (applyToBody) {
      this.applyBodyTheme(appTheme);
    }

    this.appThemeSubject.next(appTheme);
  }

  private setThemePreference(themePreference: AppThemePreference, saveToStorage: boolean = true) {
    if (this.themePreferenceSubject.getValue() !== themePreference) {
      this.themePreferenceSubject.next(themePreference);
    }

    if (saveToStorage) {
      localStorage.setItem(this.LOCAL_STORAGE_KEY, themePreference);
    }
  }

  private applyThemePreference(themePreference: AppThemePreference, saveToStorage: boolean = true, applyToBody: boolean = true) {
    this.setThemePreference(themePreference, saveToStorage);
    this.applyThemeState(this.resolveThemePreference(themePreference), applyToBody);
  }

  private resolveThemePreference(themePreference: AppThemePreference): AppThemes {
    if (themePreference === SYSTEM_THEME_PREFERENCE) {
      return this.mediaQueryList.matches ? AppThemes.Dark : AppThemes.Normal;
    }

    return themePreference;
  }

  private getThemePreferenceFromUser(user: User | null): AppThemePreference | null {
    const userPreference = (user?.settings?.appSettings as { themePreference?: unknown } | undefined)?.themePreference;
    if (isAppThemePreference(userPreference)) {
      return userPreference;
    }

    const userTheme = user?.settings?.appSettings?.theme;
    if (isAppThemePreference(userTheme)) {
      return userTheme;
    }

    return null;
  }

  private hasExplicitUserThemePreference(user: User | null): boolean {
    const userPreference = (user?.settings?.appSettings as { themePreference?: unknown } | undefined)?.themePreference;
    return isAppThemePreference(userPreference);
  }

  public applyBodyTheme(appTheme: AppThemes) {
    if (appTheme === AppThemes.Normal) {
      document.body.classList.remove('dark-theme');
      return;
    }

    document.body.classList.add('dark-theme');
  }

  /**
   * Applies a concrete theme immediately. When `saveToStorage` is true,
   * this also stores an explicit Light/Dark preference.
   */
  public setAppTheme(appTheme: AppThemes, saveToStorage: boolean = true) {
    if (saveToStorage) {
      this.setThemePreference(appTheme, true);
    }

    this.applyThemeState(appTheme, true);
  }

  public getAppTheme(): Observable<AppThemes> {
    return this.appThemeSubject.asObservable();
  }

  public getThemePreference(): Observable<AppThemePreference> {
    return this.themePreferenceSubject.asObservable();
  }

  // Subject for theme change animation
  private themeChangeSubject = new BehaviorSubject<{ x: number; y: number; theme: AppThemes } | null>(null);
  public themeChange$ = this.themeChangeSubject.asObservable();

  public async setPreferredTheme(themePreference: AppThemePreference, origin?: ThemeChangeOrigin) {
    const currentPreference = this.themePreferenceSubject.getValue();
    const resolvedTheme = this.resolveThemePreference(themePreference);
    const currentTheme = this.appThemeSubject.getValue();
    const preferenceChanged = currentPreference !== themePreference;
    const themeChanged = currentTheme !== resolvedTheme;

    // Ensure explicit user selections are persisted even when already on the same state.
    if (!preferenceChanged
      && !themeChanged
      && this.getThemePreferenceFromStorage() === themePreference) {
      return;
    }

    this.setThemePreference(themePreference, true);

    if (origin && themeChanged) {
      const coordinates = this.resolveThemeOrigin(origin);
      this.themeChangeSubject.next({
        ...coordinates,
        theme: resolvedTheme
      });
      await this.persistTheme(themePreference);
      return;
    }

    this.applyThemeState(resolvedTheme, true);
    await this.persistTheme(themePreference);
  }

  public async toggleTheme(origin?: ThemeChangeOrigin) {
    const current = this.appThemeSubject.getValue();
    const newTheme = current === AppThemes.Dark ? AppThemes.Normal : AppThemes.Dark;
    await this.setPreferredTheme(newTheme, origin);
  }

  private resolveThemeOrigin(origin: ThemeChangeOrigin): { x: number; y: number } {
    if (origin instanceof MouseEvent) {
      return { x: origin.clientX, y: origin.clientY };
    }

    if (origin instanceof HTMLElement) {
      const rect = origin.getBoundingClientRect();
      return {
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
      };
    }

    if (origin && typeof origin === 'object' && 'x' in origin && 'y' in origin) {
      return origin;
    }

    return {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    };
  }

  private getThemePreferenceFromStorage(): AppThemePreference | null {
    const item = localStorage.getItem(this.LOCAL_STORAGE_KEY);
    if (!item) {
      return null;
    }

    if (isAppThemePreference(item)) {
      return item;
    }

    return null;
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
    if (this.mediaQueryList) {
      this.mediaQueryList.removeEventListener('change', this.systemThemeListener);
    }
  }
}
