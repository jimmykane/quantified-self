import {Injectable} from '@angular/core';
import {AppThemes} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import {UserService} from './app.user.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {ChartThemes} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {BehaviorSubject, Observable} from 'rxjs';


@Injectable()
export class ThemeService {

  private chartTheme: BehaviorSubject<ChartThemes> = new BehaviorSubject(null);
  private appTheme: BehaviorSubject<AppThemes> = new BehaviorSubject(null);

  constructor(
    private userService: UserService,
  ) {
    this.appTheme.next(this.getAppThemeFromStorage());
    this.chartTheme.next(this.getChartThemeFromStorage());
  }

  public async changeTheme(theme: AppThemes, user?: User) {
    theme === AppThemes.Normal ? document.body.classList.remove('dark-theme') : document.body.classList.add('dark-theme');
    const chartTheme = theme === AppThemes.Normal ? ChartThemes.Material : ChartThemes.ChartsDark;
    // Save it to the user if he exists
    if (user) {
      user.settings.appSettings.theme = theme;
      user.settings.chartSettings.theme = chartTheme;
      await this.userService.updateUserProperties(user, {
        settings: user.settings
      });
    }
    // Save it to local storage to prevent flashes
    localStorage.setItem('appTheme', theme);
    localStorage.setItem('chartTheme', chartTheme);
  }


  public setAppTheme(appTheme: AppThemes){
    localStorage.setItem('appTheme', appTheme);
    this.appTheme.next(appTheme);
  }

  public setChartTheme(chartTheme: ChartThemes) {
    localStorage.setItem('chartTheme', chartTheme);
    this.chartTheme.next(chartTheme);
  }

  public getAppTheme(): Observable<AppThemes> {
    return this.appTheme.asObservable();
  }

  public getChartTheme(): Observable<ChartThemes> {
    return this.chartTheme.asObservable();
  }

  public async toggleTheme(user?: User) {
    await this.changeTheme(localStorage.getItem('appTheme') === AppThemes.Dark ? AppThemes.Normal : AppThemes.Dark, user);
    this.appTheme.next(this.getAppThemeFromStorage());
    this.chartTheme.next(this.getChartThemeFromStorage());
  }

  private getAppThemeFromStorage(): AppThemes {
    return localStorage.getItem('appTheme') === AppThemes.Dark ? AppThemes.Dark : AppThemes.Normal
  }

  private getChartThemeFromStorage(): ChartThemes {
    return localStorage.getItem('chartTheme') !== null ? ChartThemes[this.getEnumKeyByEnumValue(ChartThemes, localStorage.getItem('chartTheme'))] : this.userService.getDefaultChartTheme();
  }

  private getEnumKeyByEnumValue(myEnum, enumValue) {
    const keys = Object.keys(myEnum).filter(x => myEnum[x] === enumValue);
    return keys.length > 0 ? keys[0] : null;
  }
}
