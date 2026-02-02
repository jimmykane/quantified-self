import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  afterNextRender,
  inject,
} from '@angular/core';
import { MatSidenav } from '@angular/material/sidenav';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { AppAuthService } from './authentication/app.auth.service';
import { AppUserService } from './services/app.user.service';
import { AppSideNavService } from './services/side-nav/app-side-nav.service';
import { AppRemoteConfigService } from './services/app.remote-config.service';
import { slideInAnimation } from './animations/animations';


import { LoggerService } from './services/logger.service';
import { AppAnalyticsService } from './services/app.analytics.service';
import { SeoService } from './services/seo.service';
import { AppIconService } from './services/app.icon.service';
import { AppThemeService } from './services/app.theme.service';
import { AppWhatsNewService } from './services/app.whats-new.service';
import { MatDialog } from '@angular/material/dialog';
import { WhatsNewDialogComponent } from './components/whats-new/whats-new-dialog.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [slideInAnimation]
  // changeDetection: ChangeDetectionStrategy.OnPush,
  ,
  standalone: false
})

export class AppComponent implements OnInit, OnDestroy {
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
  private remoteConfigService = inject(AppRemoteConfigService);
  public maintenanceMode = this.remoteConfigService.maintenanceMode;
  public maintenanceMessage = this.remoteConfigService.maintenanceMessage;
  public maintenanceLoading = this.remoteConfigService.isLoading;
  public configLoaded = this.remoteConfigService.configLoaded;
  public currentUser: any = null;
  public isAdminUser = false;
  public currentTheme$: Observable<any>;

  // Circular reveal animation state
  public themeOverlayActive = false;
  public themeOverlayClass = '';
  public themeOverlayStyle: { [key: string]: string } = {};

  private breakpointObserver = inject(BreakpointObserver);
  public isHandset = toSignal(this.breakpointObserver.observe([Breakpoints.XSmall, Breakpoints.Small]).pipe(map(result => result.matches)), { initialValue: false });

  constructor(
    public authService: AppAuthService,
    private userService: AppUserService,
    public router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    public sideNavService: AppSideNavService,
    private logger: LoggerService,
    private analyticsService: AppAnalyticsService,
    private seoService: SeoService,
    private iconService: AppIconService,
    private themeService: AppThemeService,
    private whatsNewService: AppWhatsNewService,
    public dialog: MatDialog
  ) {
    // this.afa.setAnalyticsCollectionEnabled(true)
    this.iconService.registerIcons();

    this.currentTheme$ = this.themeService.getAppTheme();

    // Mark app as hydrated after Angular takes over (reveals SVG icons)
    afterNextRender(() => {
      document.body.classList.add('app-hydrated');
      // Allow animations after initial render
      setTimeout(() => this.isFirstLoad = false, 100);
    });
  }

  async ngOnInit() {
    this.seoService.init(); // Initialize SEO service
    this.seoService.init(); // Initialize SEO service

    this.authService.user$.subscribe(async user => {
      this.authState = !!user;
      this.currentUser = user;
      this.updateOnboardingState();
      // Check admin status when user is authenticated
      if (user) {
        try {
          this.isAdminUser = await this.userService.isAdmin();
          this.whatsNewService.setAdminMode(this.isAdminUser);
        } catch {
          this.isAdminUser = false;
          this.whatsNewService.setAdminMode(false);
        }
      } else {
        this.isAdminUser = false;
        this.whatsNewService.setAdminMode(false);
      }
    });
    this.routerEventSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.updateOnboardingState();
      }
    });

    // Subscribe to theme changes for circular reveal animation
    this.themeService.themeChange$.subscribe(change => {
      if (change) {
        this.triggerCircularReveal(change.x, change.y, change.theme);
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

  get isHomeRoute(): boolean {
    return this.router.url === '/' || this.router.url.split('?')[0] === '/';
  }

  get showUploadActivities(): boolean {
    return this.isDashboardRoute && !!this.currentUser;
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

  private triggerCircularReveal(x: number, y: number, theme: any) {
    // Set the overlay class based on new theme
    this.themeOverlayClass = theme === 'Dark' ? 'dark-theme' : '';

    // Clear any previous style (not needed for gradient sweep, but kept for compatibility)
    this.themeOverlayStyle = {};

    // Activate overlay immediately
    this.themeOverlayActive = true;
    this.changeDetectorRef.detectChanges();

    // Apply the actual theme to body mid-animation (around 50%)
    // This ensures the theme changes under the overlay while it's still covering
    setTimeout(() => {
      if (theme === 'Dark') {
        document.body.classList.add('dark-theme');
      } else {
        document.body.classList.remove('dark-theme');
      }
    }, 300); // Apply at ~50% of 600ms animation

    // After animation completes, deactivate overlay
    setTimeout(() => {
      this.themeOverlayActive = false;
      this.changeDetectorRef.detectChanges();
    }, 600); // Match animation duration
  }

  public openWhatsNew() {
    this.dialog.open(WhatsNewDialogComponent, {
      width: '600px',
      autoFocus: false
    });
  }

  get unreadWhatsNewCount() {
    return this.whatsNewService.unreadCount();
  }

  ngOnDestroy(): void {
    this.routerEventSubscription.unsubscribe();
    if (this.actionButtonsSubscription) {
      this.actionButtonsSubscription.unsubscribe();
    }
  }
}
