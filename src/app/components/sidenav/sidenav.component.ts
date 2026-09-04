import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { isHealthWorkspaceNavigationUIDAllowed } from '@shared/health-workspace-rollout';
import { EventInterface } from '@sports-alliance/sports-lib';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppSideNavService } from '../../services/side-nav/app-side-nav.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserService } from '../../services/app.user.service';
import { AppWhatsNewService } from '../../services/app.whats-new.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { environment } from '../../../environments/environment';
import { AppThemePreference, SYSTEM_THEME_PREFERENCE } from '../../models/app-theme-preference.type';
import { getAssistantRequestLimitForRole } from '@shared/limits';

@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.scss'],
  standalone: false
})
export class SideNavComponent {

  public events: EventInterface[] = [];
  public appVersion = environment.appVersion;
  public readonly supportMailtoHref = `mailto:${environment.supportEmail}`;

  private themeService = inject(AppThemeService);
  public appThemes = AppThemes;
  public readonly systemThemePreference = SYSTEM_THEME_PREFERENCE;
  public themePreference = toSignal(this.themeService.getThemePreference(), { initialValue: SYSTEM_THEME_PREFERENCE });
  private analyticsService = inject(AppAnalyticsService);
  private hapticsService = inject(AppHapticsService);
  public readonly hasHealthWorkspaceNavigationAccess = computed(() =>
    isHealthWorkspaceNavigationUIDAllowed(this.userService.user()?.uid));

  constructor(
    public authService: AppAuthService,
    public userService: AppUserService,
    public sideNav: AppSideNavService,
    public whatsNewService: AppWhatsNewService,
    private snackBar: MatSnackBar) {
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

  get assistantRoute(): string {
    return this.hasAssistantAccess ? '/ai-insights' : '/subscriptions';
  }

  get hasAssistantAccess(): boolean {
    const currentUser = this.user;
    if (!currentUser) {
      return false;
    }

    if ((currentUser as any).admin === true) {
      return true;
    }

    const stripeRole = `${(currentUser as any).stripeRole || 'free'}`;
    try {
      return getAssistantRequestLimitForRole(stripeRole) > 0;
    } catch {
      return this.hasPaidAccess;
    }
  }

  get user(): User | null {
    return this.userService.user();
  }

  async donate() {
    this.analyticsService.logEvent('donate_click', { method: 'PayPal' });
    this.hapticsService.selection();
    window.open('https://paypal.me/DKanellopoulos');
  }





  async gitHubStar() {
    this.analyticsService.logEvent('github_star');
    this.hapticsService.selection();
    window.open('https://github.com/jimmykane/quantified-self/');
  }

  async facebookGroup() {
    this.analyticsService.logEvent('facebook_group_click');
    this.hapticsService.selection();
    window.open('https://www.facebook.com/groups/quantifiedself.io');
  }

  reportBug(): void {
    window.open('https://github.com/jimmykane/quantified-self/issues');
  }

  async logout() {
    this.analyticsService.logEvent('logout', {});
    this.hapticsService.selection();
    try {
      await this.authService.signOut();
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

  public closeSideNav(): void {
    this.hapticsService.selection();
    this.sideNav.close();
  }

  public openCompareFilesFromNav(): void {
    this.analyticsService.logToolCompareEntry('side_nav', !!this.user);
    this.closeSideNav();
  }

}
