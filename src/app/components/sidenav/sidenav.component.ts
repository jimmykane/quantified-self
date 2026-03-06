import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { EventInterface } from '@sports-alliance/sports-lib';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppSideNavService } from '../../services/side-nav/app-side-nav.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppWindowService } from '../../services/app.window.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserService } from '../../services/app.user.service';
import { AppWhatsNewService } from '../../services/app.whats-new.service';
import { environment } from '../../../environments/environment';
import { AppThemePreference, SYSTEM_THEME_PREFERENCE } from '../../models/app-theme-preference.type';
import { AppHapticsService } from '../../services/app.haptics.service';

@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.scss'],
  standalone: false
})
export class SideNavComponent {

  public events: EventInterface[] = [];
  public appVersion = environment.appVersion;

  private themeService = inject(AppThemeService);
  public appThemes = AppThemes;
  public readonly systemThemePreference = SYSTEM_THEME_PREFERENCE;
  public themePreference = toSignal(this.themeService.getThemePreference(), { initialValue: SYSTEM_THEME_PREFERENCE });
  private analyticsService = inject(AppAnalyticsService);
  private hapticsService = inject(AppHapticsService);

  constructor(
    public authService: AppAuthService,
    public userService: AppUserService,
    public sideNav: AppSideNavService,
    public whatsNewService: AppWhatsNewService,
    private windowService: AppWindowService,
    private snackBar: MatSnackBar,
    private router: Router) {
  }


  get isProUser(): boolean {
    return this.userService.isProSignal();
  }

  get isBasicUser(): boolean {
    return this.userService.isBasicSignal();
  }

  get hasPaidAccess(): boolean {
    return this.userService.hasPaidAccessSignal();
  }

  get user(): User | null {
    return this.userService.user();
  }

  async donate() {
    this.hapticsService.selection();
    this.analyticsService.logEvent('donate_click', { method: 'PayPal' });
    window.open('https://paypal.me/DKanellopoulos');
  }





  async gitHubStar() {
    this.hapticsService.selection();
    this.analyticsService.logEvent('github_star');
    window.open('https://github.com/jimmykane/quantified-self/');
  }

  async logout() {
    this.hapticsService.selection();
    this.analyticsService.logEvent('logout', {});
    try {
      await this.router.navigate(['/']);
      await this.authService.signOut();
      localStorage.clear();
      this.windowService.windowRef.location.reload();
      this.snackBar.open('Signed out', undefined, {
        duration: 2000,
      });
    } catch {
      this.snackBar.open('Could not sign out', undefined, {
        duration: 2000,
      });
    }
  }

  public async setTheme(theme: AppThemePreference, event?: MouseEvent) {
    this.hapticsService.selection();
    await this.themeService.setPreferredTheme(theme, event);
  }

  public closeSideNavWithHaptic(): void {
    this.hapticsService.selection();
    this.sideNav.close();
  }

}
