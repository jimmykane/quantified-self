import { Component, OnDestroy, OnInit } from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {AppAuthService} from '../../authentication/app.auth.service';
import {AppSideNavService} from '../../services/side-nav/app-side-nav.service';
import { AppThemes } from '@sports-alliance/sports-lib/lib/users/settings/user.app.settings.interface';
import { Subscription } from 'rxjs';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AngularFireAnalytics } from '@angular/fire/analytics';
import { AppWindowService } from '../../services/app.window.service';
import { AppThemeService } from '../../services/app.theme.service';

declare function require(moduleName: string): any;

const {version: appVersion} = require('../../../../package.json');


@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.css'],
})
export class SideNavComponent implements OnInit, OnDestroy {

  public events: EventInterface[] = [];
  public appVersion = appVersion;

  public user: User;

  public appTheme: AppThemes
  public appThemes = AppThemes;

  private themeSubscription: Subscription

  constructor(
    public authService: AppAuthService,
    public sideNav: AppSideNavService,
    public themeService: AppThemeService,
    private windowService: AppWindowService,
    private afa: AngularFireAnalytics,
    private snackBar: MatSnackBar,
    private router: Router) {
  }

  ngOnInit() {
    this.themeSubscription = this.themeService.getAppTheme().subscribe(theme => {
      this.appTheme = theme
    })
  }

  async donate() {
    this.afa.logEvent('donate_click', {method: 'PayPal'});
    window.open('https://paypal.me/DKanellopoulos');
  }

  async logout() {
    this.afa.logEvent('logout', {});
    this.router.navigate(['/']).then(async () => {
      await this.authService.signOut();
      localStorage.clear();
      this.windowService.windowRef.location.reload();
      this.snackBar.open('Signed out', null, {
        duration: 2000,
      });
    });
  }

  ngOnDestroy(): void {
    if (this.themeSubscription){
      this.themeSubscription.unsubscribe();
    }
  }


}
