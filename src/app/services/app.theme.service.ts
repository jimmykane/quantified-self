import {Injectable} from '@angular/core';
import {AppThemes, UserAppSettingsInterface} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import {UserService} from './app.user.service';
import {AppAuthService} from '../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';


@Injectable()
export class ThemeService {
  constructor(
    private userService: UserService,
  ) {
  }

  public async changeTheme(theme: AppThemes, user?: User) {
    theme === AppThemes.Normal ? document.body.classList.remove('dark-theme') : document.body.classList.add('dark-theme');
    // Save it to the user if he exists
    if (user) {
      user.settings.appSettings.theme  = theme;
      await this.userService.updateUserProperties(user, {
        settings: user.settings
      });
    }
    // Save it to local storage to prevent flashes
    localStorage.setItem('appTheme', theme);
  }

  public getTheme(): AppThemes {
    return localStorage.getItem('appTheme') ===  AppThemes.Dark ? AppThemes.Dark : AppThemes.Normal;
  }

  public async toggleTheme(user?: User) {
    await this.changeTheme(this.getTheme() === AppThemes.Dark ? AppThemes.Normal : AppThemes.Dark, user);
  }
}
