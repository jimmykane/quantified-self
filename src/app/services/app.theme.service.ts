import {Injectable} from '@angular/core';
import {AppThemes} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import {UserService} from './app.user.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {ChartThemes} from 'quantified-self-lib/lib/users/user.chart.settings.interface';


@Injectable()
export class ThemeService {
  constructor(
    private userService: UserService,
  ) {
  }

  public async changeTheme(theme: AppThemes, user?: User) {
    theme === AppThemes.Normal ? document.body.classList.remove('dark-theme') : document.body.classList.add('dark-theme');
    const chartTheme = theme === AppThemes.Normal ? ChartThemes.Material : ChartThemes.ChartsDark;
    // Save it to the user if he exists
    if (user) {
      user.settings.appSettings.theme  = theme;
      user.settings.chartSettings.theme = chartTheme;
      await this.userService.updateUserProperties(user, {
        settings: user.settings
      });
    }
    // Save it to local storage to prevent flashes
    localStorage.setItem('appTheme', theme);
    localStorage.setItem('chartTheme', chartTheme);
  }

  public getAppTheme(): AppThemes {
    return localStorage.getItem('appTheme') ===  AppThemes.Dark ? AppThemes.Dark : AppThemes.Normal;
  }

  public getChartTheme(): ChartThemes {
    return localStorage.getItem('chartTheme') !== null ? ChartThemes[this.getEnumKeyByEnumValue(ChartThemes, localStorage.getItem('chartTheme'))] : ChartThemes.Material;
  }

  public async toggleTheme(user?: User) {
    await this.changeTheme(this.getAppTheme() === AppThemes.Dark ? AppThemes.Normal : AppThemes.Dark, user);
  }

  private getEnumKeyByEnumValue(myEnum, enumValue) {
    const keys = Object.keys(myEnum).filter(x => myEnum[x] === enumValue);
    return keys.length > 0 ? keys[0] : null;
  }
}
