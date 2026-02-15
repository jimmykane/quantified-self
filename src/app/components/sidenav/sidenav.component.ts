import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { EventInterface } from '@sports-alliance/sports-lib';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppSideNavService } from '../../services/side-nav/app-side-nav.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';
import { User } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppWindowService } from '../../services/app.window.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserService } from '../../services/app.user.service';
import { AppWhatsNewService } from '../../services/app.whats-new.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.scss'],
  standalone: false
})
export class SideNavComponent implements OnInit, OnDestroy {

  public events: EventInterface[] = [];
  public appVersion = environment.appVersion;


  public appTheme!: AppThemes
  public appThemes = AppThemes;

  private themeSubscription!: Subscription
  private analyticsService = inject(AppAnalyticsService);

  constructor(
    public authService: AppAuthService,
    public userService: AppUserService,
    public sideNav: AppSideNavService,
    public themeService: AppThemeService,
    public whatsNewService: AppWhatsNewService,
    private windowService: AppWindowService,
    private snackBar: MatSnackBar,
    private router: Router) {
  }


  ngOnInit() {
    this.themeSubscription = this.themeService.getAppTheme().subscribe(theme => {
      this.appTheme = theme
    })
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
    this.analyticsService.logEvent('donate_click', { method: 'PayPal' });
    window.open('https://paypal.me/DKanellopoulos');
  }





  async gitHubStar() {
    this.analyticsService.logEvent('github_star');
    window.open('https://github.com/jimmykane/quantified-self/');
  }

  async logout() {
    this.analyticsService.logEvent('logout', {});
    this.router.navigate(['/']).then(async () => {
      await this.authService.signOut();
      localStorage.clear();
      this.windowService.windowRef.location.reload();
      this.snackBar.open('Signed out', undefined, {
        duration: 2000,
      });
    });
  }

  ngOnDestroy(): void {
    if (this.themeSubscription) {
      this.themeSubscription.unsubscribe();
    }
  }

}
