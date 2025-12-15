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

  private chartTheme: BehaviorSubject<ChartThemes> = new BehaviorSubject(null);
  private appTheme: BehaviorSubject<AppThemes> = new BehaviorSubject(null);
  private mapTheme: BehaviorSubject<MapThemes> = new BehaviorSubject(null);

  private userSubscription: Subscription;

  private user: User

  constructor(
    private userService: AppUserService,
    private authService: AppAuthService,
  ) {
    this.appTheme.next(this.getAppThemeFromStorage());
    this.chartTheme.next(this.getChartThemeFromStorage());
    this.mapTheme.next(this.getMapThemeFromStorage());
    this.userSubscription = this.authService.user$.subscribe(user => {
      this.user = user;
      if (this.user) {
        this.setAppTheme(this.user.settings.appSettings.theme)
        this.setChartTheme(this.user.settings.chartSettings.theme)
        this.setMapTheme(this.user.settings.mapSettings.theme)
      }
    })
  }

  private async changeTheme(theme: AppThemes) {
    const chartTheme = theme === AppThemes.Normal ? ChartThemes.Material : ChartThemes.Dark;
    const mapTheme = theme === AppThemes.Normal ? MapThemes.Normal : MapThemes.Dark;
    // Save it to the user if he exists
    if (this.user) {
      this.user.settings.appSettings.theme = theme;
      this.user.settings.chartSettings.theme = chartTheme;
      this.user.settings.mapSettings.theme = mapTheme;
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

  public setAppTheme(appTheme: AppThemes) {
    if (appTheme === AppThemes.Normal) {
      document.body.classList.remove('dark-theme');
    } else {
      document.body.classList.add('dark-theme');
    }
    localStorage.setItem('appTheme', appTheme);
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

  public getAppTheme(): Observable<AppThemes> {
    return this.appTheme.asObservable();
  }

  public getChartTheme(): Observable<ChartThemes> {
    return this.chartTheme.asObservable();
  }

  public getMapTheme(): Observable<MapThemes> {
    return this.mapTheme.asObservable();
  }

  public async toggleTheme() {
    await this.changeTheme(localStorage.getItem('appTheme') === AppThemes.Dark ? AppThemes.Normal : AppThemes.Dark);
  }

  private getAppThemeFromStorage(): AppThemes {
    return localStorage.getItem('appThemes') !== null ? AppThemes[this.getEnumKeyByEnumValue(AppThemes, localStorage.getItem('appThemes'))] : AppUserService.getDefaultAppTheme();
  }

  private getMapThemeFromStorage(): MapThemes {
    return localStorage.getItem('mapThemes') !== null ? MapThemes[this.getEnumKeyByEnumValue(MapThemes, localStorage.getItem('mapThemes'))] : AppUserService.getDefaultMapTheme();
  }

  private getChartThemeFromStorage(): ChartThemes {
    return localStorage.getItem('chartTheme') !== null ? ChartThemes[this.getEnumKeyByEnumValue(ChartThemes, localStorage.getItem('chartTheme'))] : AppUserService.getDefaultChartTheme();
  }

  private getEnumKeyByEnumValue(myEnum, enumValue) {
    const keys = Object.keys(myEnum).filter(x => myEnum[x] === enumValue);
    return keys.length > 0 ? keys[0] : null;
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe()
    }
  }
}
