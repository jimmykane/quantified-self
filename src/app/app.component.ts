import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {ActionButton} from './services/action-buttons/app.action-button';
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
import {SideNavService} from './services/side-nav/side-nav.service';
import {DomSanitizer, Title} from '@angular/platform-browser';
import {ThemeService} from './services/app.theme.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {AppInfoService} from './services/app.info.service';
import {environment} from '../environments/environment';
import {slideInAnimation} from './animations/animations';

import * as firebase from 'firebase/app'
import {WindowService} from './services/app.window.service';

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
  public actionButtons: ActionButton[] = [];
  public title;
  private actionButtonsSubscription: Subscription;
  private routerEventSubscription: Subscription;
  private appVersionSubscription: Subscription;
  private userSubscription: Subscription;
  public user: User;
  public loading: boolean;

  constructor(
    public authService: AppAuthService,
    public router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private actionButtonService: ActionButtonService,
    private sideNavService: SideNavService,
    private matIconRegistry: MatIconRegistry,
    private domSanitizer: DomSanitizer,
    public themeService: ThemeService,
    public appInfoService: AppInfoService,
    private titleService: Title,
    private windowService: WindowService,
    private snackBar: MatSnackBar) {

    this.matIconRegistry.addSvgIcon(
      'suunto',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/suunto_logo.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'heart_rate',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/heart-rate.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'energy',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/energy.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'arrow_up_right',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/arrow-up-right.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'arrow_down_right',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/arrow-down-right.svg')
    );
  }

  async ngOnInit() {
    this.sideNavService.setSidenav(this.sideNav);
    this.router.events.subscribe((event: RouterEvent) => {
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
    this.routerEventSubscription = this.router.events
      .pipe(filter(event => event instanceof RoutesRecognized))
      .pipe(map((event: RoutesRecognized) => {
        return event.state.root.firstChild.data['title'];
      })).subscribe(title => {
        this.title = title;
        this.titleService.setTitle(`${title} - Quantified Self`);
      });
    this.actionButtonService.addActionButton('openSideNav', new ActionButton('list', () => {
      this.sideNav.toggle();
    }, 'material'));
    this.actionButtonsSubscription = this.actionButtonService.getActionButtons().subscribe((actionButtons: Map<string, ActionButton>) => {
      this.actionButtons = Array.from(actionButtons.values());
      this.changeDetectorRef.detectChanges()
    });
    this.authService.user.subscribe((user) => {
      this.user = user;
      if (!user) {
        return;
      }
      this.themeService.setAppTheme(user.settings.appSettings.theme);
      this.themeService.setChartTheme(user.settings.chartSettings.theme);
      this.themeService.setMapTheme(user.settings.mapSettings.theme);
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

  private showUpdateAppVersionSnackMessage(version) {
    const snackBarRef = this.snackBar.open(`New version found!`, 'Reload', {duration: 5000});
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
    this.userSubscription.unsubscribe();
  }
}
