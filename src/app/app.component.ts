import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {MatIconRegistry} from '@angular/material/icon';
import {MatSidenav} from '@angular/material/sidenav';
import {MatSnackBar} from '@angular/material/snack-bar';
import {Subscription} from 'rxjs';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router, RouterEvent,
  RoutesRecognized
} from '@angular/router';
import {filter, map} from 'rxjs/operators';
import {AppAuthService} from './authentication/app.auth.service';
import {AppSideNavService} from './services/side-nav/app-side-nav.service';
import {DomSanitizer, Title} from '@angular/platform-browser';
import {AppThemeService} from './services/app.theme.service';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {AppInfoService} from './services/app.info.service';
import {environment} from '../environments/environment';
import {slideInAnimation} from './animations/animations';

import * as firebase from 'firebase/app'
import {AppWindowService} from './services/app.window.service';
import {AngularFireAnalytics} from '@angular/fire/analytics';

declare function require(moduleName: string): any;

const {version: appVersion} = require('../../package.json');


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [slideInAnimation]
  // changeDetection: ChangeDetectionStrategy.OnPush,
})

export class AppComponent implements OnInit, AfterViewInit, OnDestroy, AfterViewChecked {
  @ViewChild('sidenav', {static: true}) sideNav: MatSidenav;
  public title;
  private actionButtonsSubscription: Subscription;
  private routerEventSubscription: Subscription;
  private appVersionSubscription: Subscription;
  public loading: boolean;

  constructor(
    public authService: AppAuthService,
    public router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private sideNavService: AppSideNavService,
    private matIconRegistry: MatIconRegistry,
    private domSanitizer: DomSanitizer,
    public appInfoService: AppInfoService,
    private titleService: Title,
    private windowService: AppWindowService,
    private afa: AngularFireAnalytics,
    private snackBar: MatSnackBar) {

    this.addIconsToRegistry();
  }

  async ngOnInit() {
    this.sideNavService.setSidenav(this.sideNav);
    this.routerEventSubscription = this.router.events.subscribe((event: RouterEvent) => {
      switch (true) {
        case event instanceof RoutesRecognized:
          this.title = (<RoutesRecognized>event).state.root.firstChild.data['title'];
          this.titleService.setTitle(`${this.title} - Quantified Self`);
          break;
        case event instanceof NavigationStart:
          this.loading = true;
          break;
        case event instanceof NavigationEnd:
        case event instanceof NavigationCancel:
        case event instanceof NavigationError:
          this.loading = false;
          break;
        default: {
          break;
        }
      }
    });

    this.appVersionSubscription = this.appInfoService.getAppVersions().subscribe((versions: { beta: string, production: string, localhost: string }) => {
      if (!versions) {
        return
      }

      if (environment.localhost && (versions.localhost !== appVersion)) {
        this.showUpdateAppVersionSnackMessage(versions.localhost);
        return;
      }

      if (environment.production && (versions.production !== appVersion)) {
        this.showUpdateAppVersionSnackMessage(versions.production);
        return;
      }

      if (environment.beta && (versions.beta !== appVersion)) {
        this.showUpdateAppVersionSnackMessage(versions.beta);
        return;
      }

    });

  }

  private addIconsToRegistry() {
    this.matIconRegistry.addSvgIcon(
      'logo',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/app/logo.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'logo-font',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/app/logo-font.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'suunto',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/suunto.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'amcharts',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/amcharts.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'firebase',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/firebase.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'heart_rate',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/heart-rate.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'heart_pulse',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/heart-pulse.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'energy',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/energy.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'power',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/power.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'arrow_up_right',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/arrow-up-right.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'arrow_down_right',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/arrow-down-right.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'swimmer',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/swimmer.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'google_logo_light',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/google_logo_light.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'facebook_logo',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/facebook_logo.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'twitter_logo',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/twitter_logo.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'github_logo',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/github_logo.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'tte',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/tte.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'epoc',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/epoc.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'gas',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/gas.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'gap',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/gap.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'heat-map',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/heat-map.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'spiral',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/spiral.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'chart',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/chart.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'dashboard',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/dashboard.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'stacked-chart',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/stacked-chart.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'bar-chart',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/bar-chart.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'route',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/route.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'watch-sync',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/watch-sync.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'chart-types',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/chart-types.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'moving-time',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/moving-time.svg')
    );
  }

  private showUpdateAppVersionSnackMessage(version) {
    const snackBarRef = this.snackBar.open(`New version found!`, 'Reload', {duration: 15000});
    snackBarRef.onAction().subscribe(() => {
      this.windowService.windowRef.location.reload(true);
    });
  }

  ngAfterViewInit() {

  }

  /**
   * See https://github.com/angular/angular/issues/14748
   */
  ngAfterViewChecked() {
    // this.changeDetectorRef.detectChanges();
  }

  ngOnDestroy(): void {
    this.routerEventSubscription.unsubscribe();
    this.actionButtonsSubscription.unsubscribe();
  }
}
