import { Injectable, OnDestroy } from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppUserService } from './app.user.service';
import { User } from '@sports-alliance/sports-lib';
import { ChartThemes } from '@sports-alliance/sports-lib';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { MapThemes } from '@sports-alliance/sports-lib';
import { AppAuthService } from '../authentication/app.auth.service';


@Injectable({
  providedIn: 'root',
})
export class AppThemeService implements OnDestroy {

  private chartTheme: BehaviorSubject<ChartThemes | null> = new BehaviorSubject<ChartThemes | null>(null);
  private appTheme: BehaviorSubject<AppThemes | null> = new BehaviorSubject<AppThemes | null>(null);
  private mapTheme: BehaviorSubject<MapThemes | null> = new BehaviorSubject<MapThemes | null>(null);

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
    this.setMapTheme(this.getMapThemeFromStorage());
    this.userSubscription = this.authService.user$.subscribe(user => {
      this.user = user;
      if (this.user?.settings?.appSettings?.theme) {
        this.setAppTheme(this.user.settings.appSettings.theme)
      }
      if (this.user?.settings?.chartSettings?.theme) {
        this.setChartTheme(this.user.settings.chartSettings.theme)
      }
      if (this.user?.settings?.mapSettings?.theme) {
        this.setMapTheme(this.user.settings.mapSettings.theme)
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
    const mapTheme = theme === AppThemes.Normal ? MapThemes.Normal : MapThemes.Dark;
    // Save it to the user if he exists
    if (this.user?.settings) {
      if (this.user.settings.appSettings) {
        this.user.settings.appSettings.theme = theme;
      }
      if (this.user.settings.chartSettings) {
        this.user.settings.chartSettings.theme = chartTheme;
      }
      if (this.user.settings.mapSettings) {
        this.user.settings.mapSettings.theme = mapTheme;
      }
      await this.userService.updateUserProperties(this.user, {
        settings: this.user.settings
      });
    } else {
      // Save it to local storage to prevent flashes
      this.setAppTheme(theme);
      this.setChartTheme(chartTheme);
      this.setMapTheme(mapTheme);
    }
  }

  public setAppTheme(appTheme: AppThemes, saveToStorage: boolean = true) {
    if (appTheme === AppThemes.Normal) {
      document.body.classList.remove('dark-theme');
    } else {
      document.body.classList.add('dark-theme');
    }
    if (saveToStorage) {
      localStorage.setItem('appTheme', appTheme);
    }
    this.appTheme.next(appTheme);
  }

  public setChartTheme(chartTheme: ChartThemes) {
    localStorage.setItem('chartTheme', chartTheme);
    this.chartTheme.next(chartTheme);
  }

  public setMapTheme(mapTheme: MapThemes) {
    localStorage.setItem('mapTheme', mapTheme);
    this.mapTheme.next(mapTheme);
  }

  public getAppTheme(): Observable<AppThemes | null> {
    return this.appTheme.asObservable();
  }

  public getChartTheme(): Observable<ChartThemes | null> {
    return this.chartTheme.asObservable();
  }

  public getMapTheme(): Observable<MapThemes | null> {
    return this.mapTheme.asObservable();
  }

  // Subject for theme change animation
  private themeChangeSubject = new BehaviorSubject<{ x: number; y: number; theme: AppThemes } | null>(null);
  public themeChange$ = this.themeChangeSubject.asObservable();

  public async toggleTheme(event?: MouseEvent) {
    // Toggling implies an explicit action, so we use the current value to determine the next
    const current = this.appTheme.getValue();
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

  private getMapThemeFromStorage(): MapThemes {
    const item = localStorage.getItem('mapTheme');
    if (item !== null) {
      const key = this.getEnumKeyByEnumValue(MapThemes, item);
      if (key !== null) {
        return MapThemes[key];
      }
    }
    return AppUserService.getDefaultMapTheme();
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
