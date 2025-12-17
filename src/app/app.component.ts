import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { MatSidenav } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router, RouterEvent,
  RoutesRecognized
} from '@angular/router';
import { AppAuthService } from './authentication/app.auth.service';
import { AppUserService } from './services/app.user.service';
import { AppSideNavService } from './services/side-nav/app-side-nav.service';
import { DomSanitizer, Title } from '@angular/platform-browser';
import { slideInAnimation } from './animations/animations';

import * as firebase from 'firebase/app'
import { AppWindowService } from './services/app.window.service';

declare function require(moduleName: string): any;


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [slideInAnimation]
  // changeDetection: ChangeDetectionStrategy.OnPush,
  ,
  standalone: false
})

export class AppComponent implements OnInit, AfterViewInit, OnDestroy, AfterViewChecked {
  @ViewChild('sidenav', { static: true }) sideNav: MatSidenav;
  public title;
  private actionButtonsSubscription: Subscription;
  private routerEventSubscription: Subscription;
  public loading: boolean;
  public authState: boolean | null = null;
  public showOnboarding = true;
  private currentUser: any = null;

  constructor(
    public authService: AppAuthService,
    private userService: AppUserService,
    public router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private sideNavService: AppSideNavService,
    private matIconRegistry: MatIconRegistry,
    private domSanitizer: DomSanitizer,
    private titleService: Title) {
    // this.afa.setAnalyticsCollectionEnabled(true)
    this.addIconsToRegistry();
  }

  async ngOnInit() {
    this.authService.user$.subscribe(user => {
      this.authState = !!user;
      this.currentUser = user;
      this.updateOnboardingState();
    });
    this.sideNavService.setSidenav(this.sideNav);
    this.routerEventSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.updateOnboardingState();
      }
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
  }

  private updateOnboardingState() {
    const user = this.currentUser;
    if (user) {
      // Strict check for true
      const termsAccepted = user.acceptedPrivacyPolicy === true &&
        user.acceptedDataPolicy === true &&
        user.acceptedTrackingPolicy === true &&
        user.acceptedDiagnosticsPolicy === true;

      // Check explicit subscription requirement
      let hasSubscribedOnce = (user.hasSubscribedOnce === true);
      const isPremium = user.stripeRole === 'premium' || user.isPremium === true; // Simplify check

      // If user IS premium now, they definitely "subscribed once".
      // Mark it persistenty if not already marked.
      if (isPremium && !hasSubscribedOnce) {
        hasSubscribedOnce = true;
        // Fire and forget update to persist this fact for future (e.g. if they cancel)
        this.userService.updateUserProperties(user, { hasSubscribedOnce: true }).catch(err => console.error('Failed to persist hasSubscribedOnce', err));
      }

      const url = this.router.url;
      const isPaymentPath = url.includes('payment/');

      // A user is "onboarded" if they have accepted terms AND (have subscribed once OR are currently premium)
      const shouldShowOnboarding = !isPaymentPath && (!termsAccepted || (!hasSubscribedOnce && !isPremium));

      console.log('[AppComponent] Onboarding State Update:', {
        uid: user.uid,
        termsAccepted,
        hasSubscribedOnce,
        isPremium,
        role: user.stripeRole,
        isPaymentPath,
        currentUrl: url,
        shouldShowOnboarding
      });

      // Check if we just finished onboarding (transition from true to false)
      if (this.showOnboarding && !shouldShowOnboarding) {
        // If we are currently on the login page (or root), go to dashboard
        if (url.includes('/login') || url === '/') this.router.navigate(['/dashboard']);
      }
      this.showOnboarding = shouldShowOnboarding;
    } else {
      // Not logged in, so no onboarding needed (Login page handles auth)
      this.showOnboarding = false;
    }
    this.changeDetectorRef.detectChanges();
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
      'garmin',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/garmin.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'coros',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/coros.svg')
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
      'patreon',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/patreon.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'patreon-word',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/patreon-word.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'google_logo_light',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/google_logo_light.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'facebook_logo',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/facebook_logo.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'twitter_logo',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/twitter_logo.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'github_logo',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/github_logo.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'jetbrains_logo',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/logos/jetbrains.svg')
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
    this.matIconRegistry.addSvgIcon(
      'file-csv',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/file-csv.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'dark-mode',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/dark-mode.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'paypal',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/paypal.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'lap-type-manual',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/lap-types/manual.svg')
    );
    this.matIconRegistry.addSvgIcon(
      'lap-type-interval',
      this.domSanitizer.bypassSecurityTrustResourceUrl('../assets/icons/lap-types/interval.svg')
    );
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
    if (this.actionButtonsSubscription) {
      this.actionButtonsSubscription.unsubscribe();
    }
  }
}
