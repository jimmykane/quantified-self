import {
  Component,
  computed,
  DestroyRef,
  OnDestroy,
  OnInit,
  ViewChild,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatSidenav, MatSidenavContainer } from '@angular/material/sidenav';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';
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
import { AppThemes } from '@sports-alliance/sports-lib';
import { AppHapticsService } from './services/app.haptics.service';
import { AppUserInterface } from './models/app-user.interface';
import { AppUserUtilities } from './utils/app.user.utilities';
import { ShellNavigationEffectsService } from './services/shell-navigation-effects.service';

export const APP_SHELL_HEADER_HEIGHT_PX = 64;
const APP_SHELL_BANNER_HEIGHT_WOBBLE_TOLERANCE_PX = 2;
const APP_SHELL_HEADER_VISIBILITY_TOGGLE_DELTA_PX = 24;

@Component({
  selector: 'app-shell',
  templateUrl: './app-shell.component.html',
  styleUrls: ['./app-shell.component.scss'],
  animations: [slideInAnimation],
  standalone: false
})

export class AppShellComponent implements OnInit, OnDestroy {
  @ViewChild(MatSidenavContainer) set sidenavContainer(container: MatSidenavContainer | undefined) {
    if (!container) {
      this.currentSidenavContainer = null;
      this.shellNavigationEffectsService.setShellScroller(null);
      if (this.shellScrollSubscription) {
        this.shellScrollSubscription.unsubscribe();
        this.shellScrollSubscription = null;
      }
      return;
    }

    if (this.currentSidenavContainer === container) {
      return;
    }

    this.currentSidenavContainer = container;
    this.bindShellScrollTracking(container);
  }

  @ViewChild('sidenav') set sidenav(sidenav: MatSidenav) {
    if (sidenav) {
      this.sideNavService.setSidenav(sidenav);
    }
  }
  private readonly bannerHeightSignal = signal(0);
  private readonly hasBannerSignal = signal(false);
  public authState: boolean | null = null;
  private readonly showInitialLoaderSignal = signal(true);
  private readonly currentUrlSignal = signal('');
  private readonly isOnboardingRouteComputed = computed(() => this.currentUrlSignal().includes('onboarding'));
  private readonly isDashboardRouteComputed = computed(() => this.currentUrlSignal().includes('/dashboard'));
  private readonly isLoginRouteComputed = computed(() => this.currentUrlSignal().includes('/login'));
  private readonly isAdminRouteComputed = computed(() => this.currentUrlSignal().includes('/admin'));
  private readonly isHomeRouteComputed = computed(() => {
    const currentUrl = this.currentUrlSignal();
    return currentUrl === '/' || currentUrl.split('?')[0] === '/';
  });
  private destroyRef = inject(DestroyRef);
  private shellNavigationEffectsService = inject(ShellNavigationEffectsService);
  public routeAnimationState = this.shellNavigationEffectsService.animationState;
  private readonly onboardingCompletedSignal = signal(true); // Default to true to avoid hiding chrome of non-authenticated users prematurely
  private readonly currentUserSignal = signal<AppUserInterface | null>(null);
  public readonly showNavigation = computed(() => {
    if (!this.onboardingCompletedSignal()) {
      return false;
    }
    // Requirement: Hide sidenav/toolbar if user has NO product (undefined role) AND is on pricing page
    // If they have 'free', 'basic', or 'pro', they are good.
    // Constraint removed: Free tier users (no role) should still see nav on pricing page
    // if (this.currentUserSignal() && this.currentUrlSignal().includes('pricing')) {
    //   const stripeRole = this.currentUserSignal()?.stripeRole;
    //   if (!stripeRole) {
    //     return false;
    //   }
    // }
    return true;
  });
  public readonly showUploadActivities = computed(() => this.isDashboardRouteComputed() && !!this.currentUserSignal());
  public authService = inject(AppAuthService);
  private userService = inject(AppUserService);
  public router = inject(Router);
  public sideNavService = inject(AppSideNavService);
  private remoteConfigService = inject(AppRemoteConfigService);
  private logger = inject(LoggerService);
  private analyticsService = inject(AppAnalyticsService);
  private seoService = inject(SeoService);
  private iconService = inject(AppIconService);
  private themeService = inject(AppThemeService);
  private whatsNewService = inject(AppWhatsNewService);
  public dialog = inject(MatDialog);
  public maintenanceMode = this.remoteConfigService.maintenanceMode;
  public maintenanceMessage = this.remoteConfigService.maintenanceMessage;
  public maintenanceLoading = this.remoteConfigService.isLoading;
  public configLoaded = this.remoteConfigService.configLoaded;
  public isAdminUser = false;
  public currentTheme$: Observable<AppThemes> = this.themeService.getAppTheme();
  private readonly headerHiddenSignal = signal(false);

  // Circular reveal animation state
  private readonly themeOverlayActiveSignal = signal(false);
  private readonly themeOverlayClassSignal = signal('');
  private themeOverlayApplyTimeout: ReturnType<typeof setTimeout> | null = null;
  private themeOverlayResetTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialLoaderTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialAuthResolved = false;
  private readonly initialLoaderStartedAt = Date.now();
  private readonly minimumLoaderDurationMs = this.resolveMinimumLoaderDuration();

  private breakpointObserver = inject(BreakpointObserver);
  public isHandset = toSignal(this.breakpointObserver.observe([Breakpoints.XSmall, Breakpoints.Small]).pipe(map(result => result.matches)), { initialValue: false });
  private hapticsService = inject(AppHapticsService);
  private documentRef = inject(DOCUMENT);
  private currentSidenavContainer: MatSidenavContainer | null = null;
  private shellScrollSubscription: Subscription | null = null;
  private globalScrollListener: ((event: Event) => void) | null = null;
  private lastShellScrollTop = 0;
  private headerVisibilityAnchorScrollTop = 0;
  private readonly hideHeaderScrollThresholdPx = 48;

  get bannerHeight(): number {
    return this.bannerHeightSignal();
  }

  set bannerHeight(value: number) {
    this.bannerHeightSignal.set(value);
  }

  get hasBanner(): boolean {
    return this.hasBannerSignal();
  }

  set hasBanner(value: boolean) {
    this.hasBannerSignal.set(value);
  }

  get showInitialLoader(): boolean {
    return this.showInitialLoaderSignal();
  }

  set showInitialLoader(value: boolean) {
    this.showInitialLoaderSignal.set(value);
  }

  get isOnboardingRoute(): boolean {
    return this.isOnboardingRouteComputed();
  }

  get onboardingCompleted(): boolean {
    return this.onboardingCompletedSignal();
  }

  set onboardingCompleted(value: boolean) {
    this.onboardingCompletedSignal.set(value);
  }

  get headerHidden(): boolean {
    return this.headerHiddenSignal();
  }

  set headerHidden(value: boolean) {
    this.headerHiddenSignal.set(value);
  }

  get themeOverlayActive(): boolean {
    return this.themeOverlayActiveSignal();
  }

  set themeOverlayActive(value: boolean) {
    this.themeOverlayActiveSignal.set(value);
  }

  get themeOverlayClass(): string {
    return this.themeOverlayClassSignal();
  }

  set themeOverlayClass(value: string) {
    this.themeOverlayClassSignal.set(value);
  }

  get currentUser(): AppUserInterface | null {
    return this.currentUserSignal();
  }

  set currentUser(value: AppUserInterface | null) {
    this.currentUserSignal.set(value);
  }

  get layoutTopOffsetPx(): number {
    if (!this.showNavigation()) {
      return 0;
    }

    return this.bannerHeight + (this.headerHidden ? 0 : APP_SHELL_HEADER_HEIGHT_PX);
  }

  get effectiveTopOffsetPx(): number {
    return this.layoutTopOffsetPx;
  }

  constructor() {
    // this.afa.setAnalyticsCollectionEnabled(true)
    this.iconService.registerIcons();

    // Mark app as hydrated after Angular takes over (reveals SVG icons)
    afterNextRender(() => {
      document.body.classList.add('app-hydrated');
    });
  }

  async ngOnInit() {
    this.seoService.init(); // Initialize SEO service
    this.syncCurrentRouteState();

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

    this.shellNavigationEffectsService.navigationEnd$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateOnboardingState();
        if (this.shouldForceVisibleHeader()) {
          this.resetHeaderVisibilityTracking(0);
          this.setHeaderHidden(false);
          return;
        }
        this.syncHeaderVisibilityFromCurrentScrollPosition();
      });

    // Subscribe to theme changes for circular reveal animation
    this.themeService.themeChange$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(change => {
        if (change) {
          this.triggerThemeReveal(change.theme);
        }
      });

    this.bindGlobalScrollTracking();
  }

  get isDashboardRoute(): boolean {
    return this.isDashboardRouteComputed();
  }

  get isLoginRoute(): boolean {
    return this.isLoginRouteComputed();
  }

  get isAdminRoute(): boolean {
    return this.isAdminRouteComputed();
  }

  get isHomeRoute(): boolean {
    return this.isHomeRouteComputed();
  }

  private updateOnboardingState() {
    this.syncCurrentRouteState();
    const user = this.currentUser;

    if (user) {
      const termsAccepted = user.acceptedPrivacyPolicy === true &&
        user.acceptedDataPolicy === true &&
        user.acceptedTos === true;

      const hasSubscribedOnce = user.hasSubscribedOnce === true;
      const hasPaidAccess = AppUserUtilities.hasPaidAccessUser(user);

      const explicitOnboardingComplete = user.onboardingCompleted === true;
      this.onboardingCompleted = termsAccepted && (hasPaidAccess || hasSubscribedOnce || explicitOnboardingComplete);

      const onboardingPatch: Partial<Pick<AppUserInterface, 'hasSubscribedOnce' | 'onboardingCompleted'>> = {};

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

    if (this.shouldForceVisibleHeader()) {
      this.resetHeaderVisibilityTracking(this.lastShellScrollTop);
      this.setHeaderHidden(false);
    }
  }

  private shouldForceVisibleHeader(): boolean {
    return this.isOnboardingRoute || !this.showNavigation();
  }

  private syncCurrentRouteState(): void {
    const currentUrl = this.router.url;
    if (this.currentUrlSignal() === currentUrl) {
      return;
    }

    this.currentUrlSignal.set(currentUrl);
  }

  public onLogoClick() {
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
    this.router.navigate(['/dashboard']);
  }

  public navigateToAdmin() {
    this.router.navigate(['/admin']);
  }

  public navigateToLogin() {
    this.router.navigate(['/login']);
  }

  dismissGracePeriodBanner() {
    this.bannerHeight = 0;
    this.hasBanner = false;
  }

  onBannerHeightChanged(height: number) {
    const nextHasBanner = height > 0;
    const heightDelta = Math.abs(this.bannerHeight - height);
    if (this.hasBanner === nextHasBanner && heightDelta <= APP_SHELL_BANNER_HEIGHT_WOBBLE_TOLERANCE_PX) {
      return;
    }
    this.bannerHeight = height;
    this.hasBanner = nextHasBanner;
  }

  private bindShellScrollTracking(container: MatSidenavContainer): void {
    if (this.shellScrollSubscription) {
      this.shellScrollSubscription.unsubscribe();
      this.shellScrollSubscription = null;
    }

    const shellScroller = container.scrollable.getElementRef().nativeElement as HTMLElement;
    this.shellNavigationEffectsService.setShellScroller(shellScroller);
    this.lastShellScrollTop = Math.max(0, shellScroller.scrollTop);
    this.headerVisibilityAnchorScrollTop = this.lastShellScrollTop;

    this.shellScrollSubscription = container.scrollable.elementScrolled().subscribe(() => {
      this.updateHeaderVisibilityFromScroll(shellScroller.scrollTop);
    });
  }

  private bindGlobalScrollTracking(): void {
    const doc = this.documentRef;
    const windowRef = doc?.defaultView;
    if (!windowRef || this.globalScrollListener) {
      return;
    }

    this.globalScrollListener = () => {
      const shellScroller = this.currentSidenavContainer?.scrollable.getElementRef().nativeElement as HTMLElement | undefined;
      if (!shellScroller) {
        this.updateHeaderVisibilityFromScroll(windowRef.scrollY || 0);
      }
    };

    windowRef.addEventListener('scroll', this.globalScrollListener);
  }

  private unbindGlobalScrollTracking(): void {
    const doc = this.documentRef;
    const windowRef = doc?.defaultView;
    if (!windowRef || !this.globalScrollListener) {
      return;
    }

    windowRef.removeEventListener('scroll', this.globalScrollListener);
    this.globalScrollListener = null;
  }

  private updateHeaderVisibilityFromScroll(scrollTop: number): void {
    const nextScrollTop = Math.max(0, scrollTop);

    if (!this.showNavigation()) {
      this.resetHeaderVisibilityTracking(nextScrollTop);
      this.setHeaderHidden(false);
      return;
    }

    if (nextScrollTop <= this.hideHeaderScrollThresholdPx) {
      this.resetHeaderVisibilityTracking(nextScrollTop);
      this.setHeaderHidden(false);
      return;
    }

    const delta = nextScrollTop - this.lastShellScrollTop;
    this.lastShellScrollTop = nextScrollTop;

    if (delta === 0) {
      return;
    }

    if (!this.headerHidden) {
      if (delta < 0) {
        this.headerVisibilityAnchorScrollTop = nextScrollTop;
        return;
      }

      if ((nextScrollTop - this.headerVisibilityAnchorScrollTop) < APP_SHELL_HEADER_VISIBILITY_TOGGLE_DELTA_PX) {
        return;
      }

      this.headerVisibilityAnchorScrollTop = nextScrollTop;
      this.setHeaderHidden(true);
      return;
    }

    if (delta > 0) {
      this.headerVisibilityAnchorScrollTop = nextScrollTop;
      return;
    }

    if ((this.headerVisibilityAnchorScrollTop - nextScrollTop) < APP_SHELL_HEADER_VISIBILITY_TOGGLE_DELTA_PX) {
      return;
    }

    this.headerVisibilityAnchorScrollTop = nextScrollTop;
    this.setHeaderHidden(false);
  }

  private syncHeaderVisibilityFromCurrentScrollPosition(): void {
    const shellScroller = this.currentSidenavContainer?.scrollable.getElementRef().nativeElement as HTMLElement | undefined;
    if (shellScroller) {
      this.updateHeaderVisibilityFromScroll(shellScroller.scrollTop);
      return;
    }

    const windowRef = this.documentRef?.defaultView;
    if (windowRef) {
      this.updateHeaderVisibilityFromScroll(windowRef.scrollY || 0);
      return;
    }

    this.updateHeaderVisibilityFromScroll(0);
  }

  private setHeaderHidden(hidden: boolean): void {
    if (this.headerHidden === hidden) {
      return;
    }

    this.headerHidden = hidden;
  }

  private resetHeaderVisibilityTracking(scrollTop: number): void {
    this.lastShellScrollTop = scrollTop;
    this.headerVisibilityAnchorScrollTop = scrollTop;
  }

  private triggerThemeReveal(theme: AppThemes) {
    this.clearThemeOverlayTimeouts();

    this.themeOverlayClass = theme === AppThemes.Dark ? 'dark-theme' : '';

    // Activate overlay immediately
    this.themeOverlayActive = true;

    this.themeOverlayApplyTimeout = setTimeout(() => {
      this.themeService.setAppTheme(theme, false);
    }, 300); // Apply at ~50% of 600ms animation

    this.themeOverlayResetTimeout = setTimeout(() => {
      this.themeOverlayActive = false;
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
  }

  private resolveMinimumLoaderDuration(): number {
    if (typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('jsdom')) {
      return 0;
    }

    return 950;
  }

  public openWhatsNew() {
    this.dialog.open(WhatsNewDialogComponent, {
      width: '860px',
      maxWidth: '96vw',
      autoFocus: false
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
    if (this.shellScrollSubscription) {
      this.shellScrollSubscription.unsubscribe();
      this.shellScrollSubscription = null;
    }
    this.shellNavigationEffectsService.setShellScroller(null);
    this.unbindGlobalScrollTracking();
  }
}
