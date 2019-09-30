import {Injectable} from '@angular/core';
import {AppThemes} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import {UserService} from './app.user.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {ChartThemes} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {BehaviorSubject, Observable} from 'rxjs';
import {MapThemes} from 'quantified-self-lib/lib/users/user.map.settings.interface';


@Injectable()
export class ThemeService {

  private chartTheme: BehaviorSubject<ChartThemes> = new BehaviorSubject(null);
  private appTheme: BehaviorSubject<AppThemes> = new BehaviorSubject(null);
  private mapTheme: BehaviorSubject<MapThemes> = new BehaviorSubject(null);

  constructor(
    private userService: UserService,
  ) {
    this.appTheme.next(this.getAppThemeFromStorage());
    this.chartTheme.next(this.getChartThemeFromStorage());
    this.mapTheme.next(this.getMapThemeFromStorage());
  }

  private async changeTheme(theme: AppThemes, user?: User) {
    const chartTheme = theme === AppThemes.Normal ? ChartThemes.Material : ChartThemes.Dark;
    const mapTheme = theme === AppThemes.Normal ? MapThemes.Normal : MapThemes.Dark;
    // Save it to the user if he exists
    if (user) {
      user.settings.appSettings.theme = theme;
      user.settings.chartSettings.theme = chartTheme;
      user.settings.mapSettings.theme = mapTheme;
      await this.userService.updateUserProperties(user, {
        settings: user.settings
      });
    }
    // Save it to local storage to prevent flashes
    this.setAppTheme(theme);
    this.setChartTheme(chartTheme);
  }

  public setAppTheme(appTheme: AppThemes) {
    appTheme === AppThemes.Normal ? document.body.classList.remove('dark-theme') : document.body.classList.add('dark-theme');
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

  public async toggleTheme(user?: User) {
    await this.changeTheme(localStorage.getItem('appTheme') === AppThemes.Dark ? AppThemes.Normal : AppThemes.Dark, user);
    this.appTheme.next(this.getAppThemeFromStorage());
    this.chartTheme.next(this.getChartThemeFromStorage());
  }

  private getAppThemeFromStorage(): AppThemes {
    return localStorage.getItem('appThemes') !== null ? AppThemes[this.getEnumKeyByEnumValue(AppThemes, localStorage.getItem('appThemes'))] : UserService.getDefaultAppTheme();
  }

  private getMapThemeFromStorage(): MapThemes {
    return localStorage.getItem('mapThemes') !== null ? MapThemes[this.getEnumKeyByEnumValue(MapThemes, localStorage.getItem('mapThemes'))] : UserService.getDefaultMapTheme();
  }

  private getChartThemeFromStorage(): ChartThemes {
    return localStorage.getItem('chartTheme') !== null ? ChartThemes[this.getEnumKeyByEnumValue(ChartThemes, localStorage.getItem('chartTheme'))] : UserService.getDefaultChartTheme();
  }

  private getEnumKeyByEnumValue(myEnum, enumValue) {
    const keys = Object.keys(myEnum).filter(x => myEnum[x] === enumValue);
    return keys.length > 0 ? keys[0] : null;
  }
}
