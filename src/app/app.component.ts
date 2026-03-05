import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  ViewChild,
  afterNextRender,
  inject,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatSidenav } from '@angular/material/sidenav';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  NavigationEnd,
  Router,
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
import { RouteAnimationStateService } from './services/route-animation-state.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppHapticsService } from './services/app.haptics.service';

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
  public authState: boolean | null = null;
  public showInitialLoader = true;
  public isOnboardingRoute = false;
  private destroyRef = inject(DestroyRef);
  private routeAnimationStateService = inject(RouteAnimationStateService);
  public routeAnimationState = this.routeAnimationStateService.animationState;
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
  private themeOverlayApplyTimeout: ReturnType<typeof setTimeout> | null = null;
  private themeOverlayResetTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialLoaderTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialAuthResolved = false;
  private readonly initialLoaderStartedAt = Date.now();
  private readonly minimumLoaderDurationMs = this.resolveMinimumLoaderDuration();

  private breakpointObserver = inject(BreakpointObserver);
  public isHandset = toSignal(this.breakpointObserver.observe([Breakpoints.XSmall, Breakpoints.Small]).pipe(map(result => result.matches)), { initialValue: false });
  private hapticsService = inject(AppHapticsService);

  get layoutTopOffsetPx(): number {
    return this.showNavigation ? this.bannerHeight + 64 : 0;
  }

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
    });
  }

  async ngOnInit() {
    this.seoService.init(); // Initialize SEO service
    this.seoService.init(); // Initialize SEO service

    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async user => {
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

        if (!this.initialAuthResolved) {
          this.initialAuthResolved = true;
          this.scheduleInitialLoaderHide();
        }
      });
    this.router.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event instanceof NavigationEnd) {
          this.updateOnboardingState();
          this.scrollToTopAfterNavigation();
        }
      });

    // Subscribe to theme changes for circular reveal animation
    this.themeService.themeChange$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(change => {
        if (change) {
          this.triggerThemeReveal(change.x, change.y, change.theme);
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
    const previousOnboardingRoute = this.isOnboardingRoute;
    const previousOnboardingCompleted = this.onboardingCompleted;
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

      const onboardingPatch: Record<string, boolean> = {};

      // If user has paid access now, persist the historical marker for future downgrades.
      if (hasPaidAccess && !hasSubscribedOnce) {
        onboardingPatch.hasSubscribedOnce = true;
      }

      // Auto-heal users that are paid and legally accepted but missing explicit onboarding flag.
      if (hasPaidAccess && termsAccepted && !explicitOnboardingComplete) {
        onboardingPatch.onboardingCompleted = true;
      }

      if (Object.keys(onboardingPatch).length > 0) {
        this.userService.updateUserProperties(user, onboardingPatch).catch(err => this.logger.error('Failed to persist onboarding state', err));
      }
    } else {
      // Not logged in - show chrome (login/landing page)
      this.onboardingCompleted = true;
    }
    const hasStateChanged =
      previousOnboardingRoute !== this.isOnboardingRoute ||
      previousOnboardingCompleted !== this.onboardingCompleted;

    if (hasStateChanged) {
      this.changeDetectorRef.detectChanges();
    }
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
    this.hapticsService.selection();
    if (this.authState) {
      this.router.navigate(['/dashboard']);
    } else {
      this.router.navigate(['/']);
    }
  }

  public toggleSidenav() {
    this.hapticsService.selection();
    this.sideNavService.toggle();
  }

  public navigateToDashboard() {
    this.hapticsService.selection();
    this.router.navigate(['/dashboard']);
  }

  public navigateToAdmin() {
    this.hapticsService.selection();
    this.router.navigate(['/admin']);
  }

  public navigateToLogin() {
    this.hapticsService.selection();
    this.router.navigate(['/login']);
  }

  dismissGracePeriodBanner() {
    this.bannerHeight = 0;
    this.hasBanner = false;
  }

  onBannerHeightChanged(height: number) {
    const nextHasBanner = height > 0;
    if (this.bannerHeight === height && this.hasBanner === nextHasBanner) {
      return;
    }
    this.bannerHeight = height;
    this.hasBanner = nextHasBanner;
    this.changeDetectorRef.detectChanges();
  }

  private scrollToTopAfterNavigation(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    // Reset the shell scroller used by mat-sidenav layouts.
    const shellScroller = document.querySelector('.app-sidenav-container .mat-drawer-content') as HTMLElement | null;
    if (shellScroller) {
      shellScroller.scrollTop = 0;
      shellScroller.scrollLeft = 0;
    }

    // Keep default window restoration behavior aligned as a fallback.
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      window.scrollTo(0, 0);
    }
  }

  private triggerThemeReveal(x: number, y: number, theme: AppThemes) {
    this.clearThemeOverlayTimeouts();

    this.themeOverlayClass = theme === AppThemes.Dark ? 'dark-theme' : '';
    this.themeOverlayStyle = {};

    // Activate overlay immediately
    this.themeOverlayActive = true;
    this.changeDetectorRef.detectChanges();

    this.themeOverlayApplyTimeout = setTimeout(() => {
      this.themeService.setAppTheme(theme, false);
    }, 300); // Apply at ~50% of 600ms animation

    this.themeOverlayResetTimeout = setTimeout(() => {
      this.themeOverlayActive = false;
      this.changeDetectorRef.detectChanges();
    }, 600); // Match animation duration
  }

  private clearThemeOverlayTimeouts() {
    if (this.themeOverlayApplyTimeout) {
      clearTimeout(this.themeOverlayApplyTimeout);
      this.themeOverlayApplyTimeout = null;
    }

    if (this.themeOverlayResetTimeout) {
      clearTimeout(this.themeOverlayResetTimeout);
      this.themeOverlayResetTimeout = null;
    }
  }

  private scheduleInitialLoaderHide(): void {
    const elapsed = Date.now() - this.initialLoaderStartedAt;
    const remaining = Math.max(0, this.minimumLoaderDurationMs - elapsed);

    if (remaining === 0) {
      this.hideInitialLoader();
      return;
    }

    this.initialLoaderTimeout = setTimeout(() => {
      this.initialLoaderTimeout = null;
      this.hideInitialLoader();
    }, remaining);
  }

  private hideInitialLoader(): void {
    if (!this.showInitialLoader) {
      return;
    }

    this.showInitialLoader = false;
    this.changeDetectorRef.detectChanges();
  }

  private resolveMinimumLoaderDuration(): number {
    if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')) {
      return 0;
    }

    return 950;
  }

  public openWhatsNew() {
    this.hapticsService.selection();
    this.dialog.open(WhatsNewDialogComponent, {
      width: '860px',
      maxWidth: '96vw',
      autoFocus: false,
      panelClass: ['qs-dialog-container', 'qs-whats-new-dialog']
    });
  }

  get unreadWhatsNewCount() {
    return this.whatsNewService.unreadCount();
  }

  ngOnDestroy(): void {
    this.clearThemeOverlayTimeouts();
    if (this.initialLoaderTimeout) {
      clearTimeout(this.initialLoaderTimeout);
      this.initialLoaderTimeout = null;
    }
    if (this.actionButtonsSubscription) {
      this.actionButtonsSubscription.unsubscribe();
    }
  }
}
