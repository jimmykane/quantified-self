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
import {MatIconRegistry, MatSidenav, MatSnackBar} from '@angular/material';
import {Subscription} from 'rxjs';
import {Router, RoutesRecognized} from '@angular/router';
import {filter, map} from 'rxjs/operators';
import {AppAuthService} from './authentication/app.auth.service';
import {SideNavService} from './services/side-nav/side-nav.service';
import {AppThemes} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import {DomSanitizer} from '@angular/platform-browser';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  // changeDetection: ChangeDetectionStrategy.OnPush,
})

export class AppComponent implements OnInit, AfterViewInit, OnDestroy, AfterViewChecked {
  @ViewChild('sidenav') sideNav: MatSidenav;
  public actionButtons: ActionButton[] = [];
  public title;
  private actionButtonsSubscription: Subscription;
  private routerEventSubscription: Subscription;
  private userSubscription: Subscription;

  constructor(
    public authService: AppAuthService,
    public router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private actionButtonService: ActionButtonService,
    private sideNavService: SideNavService,
    private matIconRegistry: MatIconRegistry,
    private domSanitizer: DomSanitizer,
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
      user.settings.appSettings.theme === AppThemes.Normal ? document.body.classList.remove('dark-theme') : document.body.classList.add('dark-theme');
      localStorage.setItem('appTheme', user.settings.appSettings.theme);
    })

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
