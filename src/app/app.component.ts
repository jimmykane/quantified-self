import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  afterNextRender,
} from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { MatSidenav } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, Subscription } from 'rxjs';
import {
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { AppAuthService } from './authentication/app.auth.service';
import { AppUserService } from './services/app.user.service';
import { AppSideNavService } from './services/side-nav/app-side-nav.service';
import { AppRemoteConfigService } from './services/app.remote-config.service';
import { DomSanitizer } from '@angular/platform-browser';
import { slideInAnimation } from './animations/animations';

import * as firebase from 'firebase/app'
import { AppWindowService } from './services/app.window.service';

declare function require(moduleName: string): any;


import { LoggerService } from './services/logger.service';
import { AppAnalyticsService } from './services/app.analytics.service';
import { SeoService } from './services/seo.service';
import { AppIconService } from './services/app.icon.service';

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
  @ViewChild('sidenav') set sidenav(sidenav: MatSidenav) {
    if (sidenav) {
      this.sideNavService.setSidenav(sidenav);
    }
  }
  public bannerHeight = 0;
  public hasBanner = false;
  private actionButtonsSubscription!: Subscription;
  private routerEventSubscription!: Subscription;
  public authState: boolean | null = null;
  public isOnboardingRoute = false;
  private isFirstLoad = true;
  public onboardingCompleted = true; // Default to true to avoid hiding chrome of non-authenticated users prematurely
  public maintenanceMode$!: Observable<boolean>;
  public maintenanceMessage$!: Observable<string>;
  private currentUser: any = null;
  public isAdminUser = false;

  constructor(
    public authService: AppAuthService,
    private userService: AppUserService,
    public router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    public sideNavService: AppSideNavService,
    private remoteConfigService: AppRemoteConfigService,
    private logger: LoggerService,
    private analyticsService: AppAnalyticsService,
    private seoService: SeoService,
    private iconService: AppIconService
  ) {
    // this.afa.setAnalyticsCollectionEnabled(true)
    this.iconService.registerIcons();

    // Mark app as hydrated after Angular takes over (reveals SVG icons)
    afterNextRender(() => {
      document.body.classList.add('app-hydrated');
      // Allow animations after initial render
      setTimeout(() => this.isFirstLoad = false, 100);
    });
  }

  async ngOnInit() {
    this.maintenanceMode$ = this.remoteConfigService.getMaintenanceMode();
    this.maintenanceMessage$ = this.remoteConfigService.getMaintenanceMessage();
    this.seoService.init(); // Initialize SEO service

    this.authService.user$.subscribe(async user => {
      this.authState = !!user;
      this.currentUser = user;
      this.updateOnboardingState();
      // Check admin status when user is authenticated
      if (user) {
        try {
          this.isAdminUser = await this.userService.isAdmin();
        } catch {
          this.isAdminUser = false;
        }
      } else {
        this.isAdminUser = false;
      }
    });
    this.routerEventSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.updateOnboardingState();
      }
    });
  }

  get isDashboardRoute(): boolean {
    return this.router.url.includes('/dashboard');
  }

  get isLoginRoute(): boolean {
    return this.router.url.includes('/login');
  }

  get isAdminRoute(): boolean {
    return this.router.url.includes('/admin');
  }

  private updateOnboardingState() {
    const user = this.currentUser;
    const url = this.router.url;
    this.isOnboardingRoute = url.includes('onboarding');

    if (user) {
      const termsAccepted = user.acceptedPrivacyPolicy === true &&
        user.acceptedDataPolicy === true &&
        (user as any).acceptedTos === true;

      const hasSubscribedOnce = (user as any).hasSubscribedOnce === true;
      const stripeRole = user.stripeRole;
      const hasPaidAccess = stripeRole === 'pro' || stripeRole === 'basic' || user.isPro === true;

      const explicitOnboardingComplete = (user as any).onboardingCompleted === true;
      this.onboardingCompleted = termsAccepted && (hasPaidAccess || hasSubscribedOnce || explicitOnboardingComplete);

      // If user HAS pro access now, they definitely "subscribed once".
      // Mark it persistently if not already marked.
      if (hasPaidAccess && !hasSubscribedOnce) {
        // Fire and forget update to persist this fact for future (e.g. if they cancel)
        this.userService.updateUserProperties(user, { hasSubscribedOnce: true }).catch(err => this.logger.error('Failed to persist hasSubscribedOnce', err));
      }
    } else {
      // Not logged in - show chrome (login/landing page)
      this.onboardingCompleted = true;
    }
    this.changeDetectorRef.detectChanges();
  }

  get showNavigation(): boolean {
    if (!this.onboardingCompleted) {
      return false;
    }
    // Requirement: Hide sidenav/toolbar if user has NO product (undefined role) AND is on pricing page
    // If they have 'free', 'basic', or 'pro', they are good.
    // Constraint removed: Free tier users (no role) should still see nav on pricing page
    // if (this.currentUser && this.router.url.includes('pricing')) {
    //   const stripeRole = (this.currentUser as any).stripeRole;
    //   if (!stripeRole) {
    //     return false;
    //   }
    // }
    return true;
  }

  public onLogoClick() {
    if (this.authState) {
      this.router.navigate(['/dashboard']);
    } else {
      this.router.navigate(['/']);
    }
  }

  public toggleSidenav() {
    this.sideNavService.toggle();
  }

  ngAfterViewInit() {

  }

  dismissGracePeriodBanner() {
    this.bannerHeight = 0;
    this.hasBanner = false;
  }

  onBannerHeightChanged(height: number) {
    this.bannerHeight = height;
    this.hasBanner = height > 0;
    this.changeDetectorRef.detectChanges();
  }

  prepareRoute(outlet: RouterOutlet) {
    if (this.isFirstLoad) {
      return null;
    }
    return outlet && outlet.activatedRouteData && outlet.activatedRouteData['animation'];
  }

  ngAfterViewChecked() {
    // Reserved for future use
  }

  ngOnDestroy(): void {
    this.routerEventSubscription.unsubscribe();
    if (this.actionButtonsSubscription) {
      this.actionButtonsSubscription.unsubscribe();
    }
  }
}
