import { Injectable, OnDestroy, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppUserService } from './app.user.service';
import { User } from '@sports-alliance/sports-lib';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { AppAuthService } from '../authentication/app.auth.service';

type ThemeChangeOrigin = MouseEvent | HTMLElement | { x: number; y: number } | null | undefined;

@Injectable({
  providedIn: 'root',
})
export class AppThemeService implements OnDestroy {

  private appThemeSubject: BehaviorSubject<AppThemes> = new BehaviorSubject<AppThemes>(AppThemes.Normal);

  /**
   * Signal that tracks the current application theme.
   */
  public appTheme: Signal<AppThemes> = toSignal(this.appThemeSubject, { initialValue: AppThemes.Normal });

  private userSubscription: Subscription;
  private readonly MEDIA_QUERY = '(prefers-color-scheme: dark)';
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
      if (this.user?.settings?.appSettings?.theme) {
        this.setAppTheme(this.user.settings.appSettings.theme)
      }
    })
  }

  private initializeTheme() {
    const storedTheme = this.getAppThemeFromStorage();
    if (storedTheme) {
      this.setAppTheme(storedTheme);
    } else {
      // No preference? Use system default
      this.setAppTheme(this.mediaQueryList.matches ? AppThemes.Dark : AppThemes.Normal, false);
    }
  }

  private handleSystemThemeChange(e: MediaQueryListEvent) {
    // Only react to system changes if no explicit preference is stored
    if (!localStorage.getItem('appTheme') && !this.user) {
      this.setAppTheme(e.matches ? AppThemes.Dark : AppThemes.Normal, false);
    }
  }

  private async persistTheme(theme: AppThemes) {
    if (!this.user) {
      return;
    }

    const nextSettings = {
      ...this.user.settings,
      appSettings: {
        ...this.user.settings?.appSettings,
        theme,
      }
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

  private applyThemeState(appTheme: AppThemes, saveToStorage: boolean = true, applyToBody: boolean = true) {
    if (this.appThemeSubject.getValue() === appTheme) {
      return;
    }
    if (applyToBody) {
      this.applyBodyTheme(appTheme);
    }
    if (saveToStorage) {
      localStorage.setItem('appTheme', appTheme);
    }
    this.appThemeSubject.next(appTheme);
  }

  public applyBodyTheme(appTheme: AppThemes) {
    if (appTheme === AppThemes.Normal) {
      document.body.classList.remove('dark-theme');
      return;
    }

    document.body.classList.add('dark-theme');
  }

  public setAppTheme(appTheme: AppThemes, saveToStorage: boolean = true) {
    this.applyThemeState(appTheme, saveToStorage, true);
  }

  public getAppTheme(): Observable<AppThemes> {
    return this.appThemeSubject.asObservable();
  }


  // Subject for theme change animation
  private themeChangeSubject = new BehaviorSubject<{ x: number; y: number; theme: AppThemes } | null>(null);
  public themeChange$ = this.themeChangeSubject.asObservable();

  public async setPreferredTheme(theme: AppThemes, origin?: ThemeChangeOrigin) {
    if (this.appThemeSubject.getValue() === theme) {
      return;
    }

    if (origin) {
      const coordinates = this.resolveThemeOrigin(origin);
      this.themeChangeSubject.next({
        ...coordinates,
        theme
      });
    }

    this.applyThemeState(theme, true, !origin);
    await this.persistTheme(theme);
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

  private getAppThemeFromStorage(): AppThemes | null {
    const item = localStorage.getItem('appTheme');
    if (item !== null) {
      const key = this.getEnumKeyByEnumValue(AppThemes, item);
      if (key !== null) {
        return AppThemes[key];
      }
    }
    return null;
  }

  private getEnumKeyByEnumValue<T extends Record<string, string>>(myEnum: T, enumValue: string): keyof T | null {
    const keys = Object.keys(myEnum).filter(x => myEnum[x] === enumValue);
    return keys.length > 0 ? keys[0] as keyof T : null;
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe()
    }
    if (this.mediaQueryList) {
      this.mediaQueryList.removeEventListener('change', this.systemThemeListener);
    }
  }
}
