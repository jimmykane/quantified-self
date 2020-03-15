import {Component, OnInit} from '@angular/core';
import {AppEventService} from '../../services/app.event.service';
import {ActivatedRoute, Router} from '@angular/router';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {AppAuthService} from '../../authentication/app.auth.service';
import {MatSnackBar} from '@angular/material/snack-bar';
import {AppSideNavService} from '../../services/side-nav/app-side-nav.service';
import {AppWindowService} from '../../services/app.window.service';
import {AngularFireAnalytics} from '@angular/fire/analytics';

declare function require(moduleName: string): any;

const {version: appVersion} = require('../../../../package.json');


@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.css'],
})
export class SideNavComponent implements OnInit {

  public events: EventInterface[] = [];
  public appVersion = appVersion;

  constructor(
    public authService: AppAuthService,
    public sideNav: AppSideNavService,
    private windowService: AppWindowService,
    private afa: AngularFireAnalytics,
    private snackBar: MatSnackBar,
    private router: Router) {
  }

  ngOnInit() {
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
}
