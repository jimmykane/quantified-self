import { Injectable, OnDestroy, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppUserService } from './app.user.service';
import { User } from '@sports-alliance/sports-lib';
import { ChartThemes } from '@sports-alliance/sports-lib';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { AppAuthService } from '../authentication/app.auth.service';


@Injectable({
  providedIn: 'root',
})
export class AppThemeService implements OnDestroy {

  private chartTheme: BehaviorSubject<ChartThemes | null> = new BehaviorSubject<ChartThemes | null>(null);
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

    this.setChartTheme(this.getChartThemeFromStorage());
    this.userSubscription = this.authService.user$.subscribe(user => {
      this.user = user;
      if (this.user?.settings?.appSettings?.theme) {
        this.setAppTheme(this.user.settings.appSettings.theme)
      }
      if (this.user?.settings?.chartSettings?.theme) {
        this.setChartTheme(this.user.settings.chartSettings.theme)
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

  private async changeTheme(theme: AppThemes) {
    const chartTheme = theme === AppThemes.Normal ? ChartThemes.Material : ChartThemes.Dark;
    // Save it to the user if he exists
    if (this.user?.settings) {
      if (this.user.settings.appSettings) {
        this.user.settings.appSettings.theme = theme;
      }
      if (this.user.settings.chartSettings) {
        this.user.settings.chartSettings.theme = chartTheme;
      }
      await this.userService.updateUserProperties(this.user, {
        settings: this.user.settings
      });
    } else {
      // Save it to local storage to prevent flashes
      this.setAppTheme(theme);
      this.setChartTheme(chartTheme);
    }
  }

  public setAppTheme(appTheme: AppThemes, saveToStorage: boolean = true) {
    if (this.appThemeSubject.getValue() === appTheme) {
      return;
    }
    if (appTheme === AppThemes.Normal) {
      document.body.classList.remove('dark-theme');
    } else {
      document.body.classList.add('dark-theme');
    }
    if (saveToStorage) {
      localStorage.setItem('appTheme', appTheme);
    }
    this.appThemeSubject.next(appTheme);
  }

  public setChartTheme(chartTheme: ChartThemes) {
    if (this.chartTheme.getValue() === chartTheme) {
      return;
    }
    localStorage.setItem('chartTheme', chartTheme);
    this.chartTheme.next(chartTheme);
  }


  public getAppTheme(): Observable<AppThemes> {
    return this.appThemeSubject.asObservable();
  }

  public getChartTheme(): Observable<ChartThemes | null> {
    return this.chartTheme.asObservable();
  }


  // Subject for theme change animation
  private themeChangeSubject = new BehaviorSubject<{ x: number; y: number; theme: AppThemes } | null>(null);
  public themeChange$ = this.themeChangeSubject.asObservable();

  public async toggleTheme(event?: MouseEvent) {
    // Toggling implies an explicit action, so we use the current value to determine the next
    const current = this.appThemeSubject.getValue();
    const newTheme = current === AppThemes.Dark ? AppThemes.Normal : AppThemes.Dark;

    // Emit animation coordinates if event is provided
    if (event) {
      this.themeChangeSubject.next({
        x: event.clientX,
        y: event.clientY,
        theme: newTheme
      });
    }

    await this.changeTheme(newTheme);
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


  private getChartThemeFromStorage(): ChartThemes {
    const item = localStorage.getItem('chartTheme');
    if (item !== null) {
      const key = this.getEnumKeyByEnumValue(ChartThemes, item);
      if (key !== null) {
        return ChartThemes[key];
      }
    }
    return AppUserService.getDefaultChartTheme();
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
