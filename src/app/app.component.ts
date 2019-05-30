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
import {Router, RoutesRecognized} from '@angular/router';
import {filter, map} from 'rxjs/operators';
import {AppAuthService} from './authentication/app.auth.service';
import {SideNavService} from './services/side-nav/side-nav.service';
import {AppThemes} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import {DomSanitizer} from '@angular/platform-browser';
import {ThemeService} from './services/app.theme.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {AppInfoService} from "./services/app.info.service";
import {environment} from "../environments/environment";

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
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

  constructor(
    public authService: AppAuthService,
    public router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private actionButtonService: ActionButtonService,
    private sideNavService: SideNavService,
    private matIconRegistry: MatIconRegistry,
    private domSanitizer: DomSanitizer,
    public themeService: ThemeService,
    public appInfoSerice: AppInfoService,
    private snackBar: MatSnackBar) {

    this.matIconRegistry.addSvgIcon(
      'suunto',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/suunto_logo.svg')
    );
  }

  ngOnInit() {
    this.sideNavService.setSidenav(this.sideNav);
    this.routerEventSubscription = this.router.events
      .pipe(filter(event => event instanceof RoutesRecognized))
      .pipe(map((event: RoutesRecognized) => {
        return event.state.root.firstChild.data['title'];
      })).subscribe(title => {
        this.title = title;
      });
    this.actionButtonsSubscription = this.actionButtonService.getActionButtons().subscribe((actionButtons: Map<string, ActionButton>) => {
      this.actionButtons = Array.from(actionButtons.values());
    });
    this.actionButtonService.addActionButton('openSideNav', new ActionButton('list', () => {
      this.sideNav.toggle();
    }, 'material'));

    this.authService.user.subscribe((user) => {
      if (!user) {
        return;
      }
      this.user = user;
      this.themeService.changeTheme(user.settings.appSettings.theme);
    });

    this.appVersionSubscription = this.appInfoSerice.getAppVersions().subscribe((versions: { beta: string, production: string, localhost: string }) => {
      if (!versions) {
        return
      }

      if (environment.localhost && (versions.localhost !== localStorage.getItem('version'))) {
        this.showUpdateAppVersionSnackMessage(versions.localhost);
        return;
      }

      if (environment.production && (versions.production !== localStorage.getItem('version'))) {
        this.showUpdateAppVersionSnackMessage(versions.production);
        return;
      }

      if (environment.beta && (versions.beta !== localStorage.getItem('version'))) {
        this.showUpdateAppVersionSnackMessage(versions.beta);
        return;
      }

    });

  }

  private showUpdateAppVersionSnackMessage(version){
    const snackBarRef = this.snackBar.open(`New version ${version} found!`, 'Reload', {duration: 0});
    snackBarRef.onAction().subscribe(() => {
      window.location.reload(true);
      localStorage.clear();
      localStorage.setItem('version', version);
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
