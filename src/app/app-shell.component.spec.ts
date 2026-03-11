import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APP_SHELL_HEADER_HEIGHT_PX, AppShellComponent } from './app-shell.component';
import { AppAuthService } from './authentication/app.auth.service';
import { AppSideNavService } from './services/side-nav/app-side-nav.service';
import { AppUserService } from './services/app.user.service';
import { AppRemoteConfigService } from './services/app.remote-config.service';
import { AppAnalyticsService } from './services/app.analytics.service';
import { SeoService } from './services/seo.service';
import { AppIconService } from './services/app.icon.service';
import { AppThemeService } from './services/app.theme.service';
import { AppWhatsNewService } from './services/app.whats-new.service';
import { MatDialog } from '@angular/material/dialog';
import { AppHapticsService } from './services/app.haptics.service';

import { Router, ActivatedRoute, NavigationEnd, NavigationStart } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';

// ... (existing imports)

describe('AppShellComponent', () => {
    let component: AppShellComponent;
    let fixture: ComponentFixture<AppShellComponent>;

    const mockAppAuthService = {
        user$: of(null)
    };

    const mockRouter = {
        events: new Subject(),
        navigate: vi.fn(),
        createUrlTree: vi.fn(),
        serializeUrl: vi.fn(),
        url: '/'
    };

    const mockActivatedRoute = {
        snapshot: { data: {} }
    };

    const mockAppSideNavService = {
        setSidenav: vi.fn(),
        toggle: vi.fn()
    };

    const mockAppIconService = {
        registerIcons: vi.fn()
    };

    const mockDomSanitizer = {
        bypassSecurityTrustResourceUrl: vi.fn()
    };

    const mockRemoteConfigService = {
        maintenanceMode: signal(false),
        maintenanceMessage: signal(''),
        isLoading: signal(false),
        configLoaded: signal(true)
    };

    const mockSeoService = {
        init: vi.fn()
    };

    const mockAnalyticsService = {
        setAnalyticsCollectionEnabled: vi.fn()
    };
    const mockThemeService = {
        getAppTheme: vi.fn().mockReturnValue(of('Normal')),
        applyBodyTheme: vi.fn(),
        setAppTheme: vi.fn(),
        themeChange$: new Subject()
    };
    const mockHapticsService = {
        selection: vi.fn()
    };


    beforeEach(async () => {
        mockRouter.events = new Subject();
        mockThemeService.themeChange$ = new Subject();
        mockAppAuthService.user$ = of(null);

        await TestBed.configureTestingModule({
            declarations: [AppShellComponent],
            imports: [
                MatSidenavModule,
                MatTabsModule,
                MatTooltipModule,
                NoopAnimationsModule,
                RouterTestingModule
            ],
            providers: [
                { provide: AppAuthService, useValue: mockAppAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppSideNavService, useValue: mockAppSideNavService },
                { provide: AppIconService, useValue: mockAppIconService },
                { provide: DomSanitizer, useValue: mockDomSanitizer },
                { provide: AppRemoteConfigService, useValue: mockRemoteConfigService },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: SeoService, useValue: mockSeoService },
                { provide: AppThemeService, useValue: mockThemeService },
                {
                    provide: AppUserService, useValue: {
                        updateUserProperties: vi.fn().mockReturnValue(Promise.resolve()),
                        getSubscriptionRole: vi.fn().mockReturnValue(Promise.resolve('free')),
                        gracePeriodUntil: signal(null),
                        isAdmin: vi.fn().mockReturnValue(Promise.resolve(false))
                    }
                },
                {
                    provide: AppWhatsNewService, useValue: {
                        unreadCount: signal(0),
                        markAsRead: vi.fn(),
                        setAdminMode: vi.fn()
                    }
                },
                {
                    provide: MatDialog, useValue: {
                        open: vi.fn()
                    }
                },
                { provide: AppHapticsService, useValue: mockHapticsService },
                ChangeDetectorRef
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(AppShellComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should initialize analytics service', () => {
        expect(component['analyticsService']).toBeTruthy();
    });

    it('should show navigation for free users on subscriptions page', () => {
        // Mock user as free
        component['currentUser'] = { stripeRole: undefined };
        component.onboardingCompleted = true;

        // Mock router URL
        mockRouter.url = '/subscriptions';

        expect(component.showNavigation).toBe(true);
    });

    it('should show navigation for free users on dashboard', () => {
        // Mock user as free
        component['currentUser'] = { stripeRole: undefined };
        component.onboardingCompleted = true;

        // Mock router URL
        mockRouter.url = '/dashboard';

        expect(component.showNavigation).toBe(true);
    });

    it('should show navigation for basic users on subscriptions page', () => {
        // Mock user as basic
        component['currentUser'] = { stripeRole: 'basic' };
        component.onboardingCompleted = true;

        // Mock router URL
        mockRouter.url = '/subscriptions';

        expect(component.showNavigation).toBe(true);
    });

    it('should include grace period banner component', () => {
        fixture.detectChanges();
        const bannerComponent = fixture.nativeElement.querySelector('app-grace-period-banner');
        expect(bannerComponent).toBeTruthy();
    });

    it('should expose layout css variables based on banner height', () => {
        component.onboardingCompleted = true;
        component.onBannerHeightChanged(36);
        fixture.detectChanges();

        const expectedTopOffsetPx = `${component.bannerHeight + APP_SHELL_HEADER_HEIGHT_PX}px`;
        const wrapper = fixture.nativeElement.querySelector('.app-layout-wrapper') as HTMLElement | null;
        expect(wrapper).toBeTruthy();
        expect(component.layoutTopOffsetPx).toBe(component.bannerHeight + APP_SHELL_HEADER_HEIGHT_PX);
        expect(wrapper?.style.getPropertyValue('--qs-layout-top-offset')).toBe(expectedTopOffsetPx);
        expect(wrapper?.style.getPropertyValue('--qs-effective-top-offset')).toBe(expectedTopOffsetPx);
        expect(wrapper?.style.getPropertyValue('--qs-banner-height')).toBe('36px');
    });

    it('should expose zero effective top offset when onboarding is not completed', () => {
        component.onboardingCompleted = false;
        component.onBannerHeightChanged(36);
        fixture.detectChanges();

        const wrapper = fixture.nativeElement.querySelector('.app-layout-wrapper') as HTMLElement | null;
        expect(wrapper).toBeTruthy();
        expect(wrapper?.style.getPropertyValue('--qs-layout-top-offset')).toBe('0px');
        expect(wrapper?.style.getPropertyValue('--qs-effective-top-offset')).toBe('0px');
        expect(wrapper?.style.getPropertyValue('--qs-banner-height')).toBe('0px');
    });

    it('should hide header after scrolling beyond threshold', () => {
        component.onboardingCompleted = true;
        component.bannerHeight = 24;
        component.headerHidden = false;
        (component as any).lastShellScrollTop = 0;

        (component as any).updateHeaderVisibilityFromScroll(90);

        expect(component.headerHidden).toBe(true);
        expect(component.layoutTopOffsetPx).toBe(24);
    });

    it('should reveal header again near the top of the page', () => {
        component.onboardingCompleted = true;
        component.headerHidden = true;
        (component as any).lastShellScrollTop = 90;

        (component as any).updateHeaderVisibilityFromScroll(24);

        expect(component.headerHidden).toBe(false);
        expect(component.layoutTopOffsetPx).toBe(APP_SHELL_HEADER_HEIGHT_PX);
    });

    it('should react to small scroll deltas once threshold is crossed', () => {
        component.onboardingCompleted = true;
        component.headerHidden = false;
        (component as any).lastShellScrollTop = 60;

        (component as any).updateHeaderVisibilityFromScroll(61);
        expect(component.headerHidden).toBe(true);

        (component as any).updateHeaderVisibilityFromScroll(60);
        expect(component.headerHidden).toBe(false);
    });

    it('should ignore nested scroll containers when tracking header visibility globally', () => {
        component.onboardingCompleted = true;
        component.headerHidden = false;
        (component as any).lastShellScrollTop = 0;
        fixture.detectChanges();

        const shellScroller = fixture.nativeElement.querySelector('.app-sidenav-container .mat-drawer-content') as HTMLElement | null;
        expect(shellScroller).toBeTruthy();

        const nestedPanel = document.createElement('div');
        nestedPanel.className = 'nested-scroll-panel';
        nestedPanel.scrollTop = 120;
        shellScroller?.appendChild(nestedPanel);

        nestedPanel.dispatchEvent(new Event('scroll', { bubbles: true }));

        expect(component.headerHidden).toBe(false);
    });

    it('should return true for isDashboardRoute when url includes dashboard', () => {
        mockRouter.url = '/dashboard';
        expect(component.isDashboardRoute).toBe(true);
    });

    it('should return true for isLoginRoute when url includes login', () => {
        mockRouter.url = '/login';
        expect(component.isLoginRoute).toBe(true);
    });

    it('should return true for isAdminRoute when url includes admin', () => {
        mockRouter.url = '/admin';
        expect(component.isAdminRoute).toBe(true);
    });

    it('should return true for isHomeRoute when url is /', () => {
        mockRouter.url = '/';
        expect(component.isHomeRoute).toBe(true);
    });

    it('should return true for isHomeRoute when url is /?param=value', () => {
        mockRouter.url = '/?param=value';
        expect(component.isHomeRoute).toBe(true);
    });

    it('should return false for isHomeRoute when url is /dashboard', () => {
        mockRouter.url = '/dashboard';
        expect(component.isHomeRoute).toBe(false);
    });

    it('should expose showUploadActivities only on dashboard with user', () => {
        mockRouter.url = '/dashboard';
        component['currentUser'] = { uid: 'u1' };
        expect(component.showUploadActivities).toBe(true);

        mockRouter.url = '/subscriptions';
        expect(component.showUploadActivities).toBe(false);
    });

    it('should place the impersonation banner inside the maintenance branch', () => {
        mockRouter.url = '/dashboard';
        mockRemoteConfigService.maintenanceMode.set(true);
        fixture.detectChanges();

        const banners = fixture.nativeElement.querySelectorAll('app-impersonation-banner');
        expect(banners).toHaveLength(1);
    });

    it('should return unread whats-new count from service signal', () => {
        expect(component.unreadWhatsNewCount).toBe(0);
    });

    it('should navigate to dashboard on logo click when authenticated', () => {
        component.authState = true;
        component.onLogoClick();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should navigate home on logo click when unauthenticated', () => {
        component.authState = false;
        component.onLogoClick();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/']);
    });

    it('should toggle sidenav through side nav service', () => {
        mockHapticsService.selection.mockClear();
        component.toggleSidenav();
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(1);
        expect(mockAppSideNavService.toggle).toHaveBeenCalled();
    });

    it('should navigate to dashboard', () => {
        component.navigateToDashboard();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should navigate to admin', () => {
        component.navigateToAdmin();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin']);
    });

    it('should navigate to login', () => {
        component.navigateToLogin();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('should place the impersonation banner inside the main shell content', () => {
        mockRemoteConfigService.maintenanceMode.set(false);
        fixture.detectChanges();

        const sidenavContent = fixture.nativeElement.querySelector('mat-sidenav-content') as HTMLElement | null;
        const banner = sidenavContent?.querySelector('app-impersonation-banner');
        expect(banner).toBeTruthy();
    });

    it('should no-op banner updates when height and state are unchanged', () => {
        const detectSpy = vi.spyOn((component as any).changeDetectorRef, 'detectChanges');
        component.onBannerHeightChanged(0);
        expect(detectSpy).not.toHaveBeenCalled();
    });

    it('should reset banner fields when dismissing grace period banner', () => {
        component.bannerHeight = 42;
        component.hasBanner = true;
        component.dismissGracePeriodBanner();
        expect(component.bannerHeight).toBe(0);
        expect(component.hasBanner).toBe(false);
    });

    it('should open whats new dialog with expected config', () => {
        const dialog = TestBed.inject(MatDialog) as any;
        component.openWhatsNew();
        expect(dialog.open).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                width: '860px',
                maxWidth: '96vw',
                autoFocus: false
            })
        );
    });

    it('should apply and clear theme overlay during reveal animation', () => {
        vi.useFakeTimers();
        const detectSpy = vi.spyOn((component as any).changeDetectorRef, 'detectChanges');
        mockThemeService.setAppTheme.mockClear();

        (component as any).triggerThemeReveal('Dark');
        expect(component.themeOverlayActive).toBe(true);
        expect(component.themeOverlayClass).toBe('dark-theme');
        expect(detectSpy).toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        expect(mockThemeService.setAppTheme).toHaveBeenCalledWith('Dark', false);

        vi.advanceTimersByTime(300);
        expect(component.themeOverlayActive).toBe(false);

        (component as any).triggerThemeReveal('Light');
        vi.advanceTimersByTime(300);
        expect(mockThemeService.setAppTheme).toHaveBeenCalledWith('Light', false);

        vi.useRealTimers();
    });

    it('should hide initial loader immediately when minimum duration has elapsed', () => {
        component.showInitialLoader = true;
        const detectSpy = vi.spyOn((component as any).changeDetectorRef, 'detectChanges');
        (component as any).initialLoaderStartedAt = Date.now() - 1500;
        (component as any).minimumLoaderDurationMs = 950;

        (component as any).scheduleInitialLoaderHide();

        expect(component.showInitialLoader).toBe(false);
        expect((component as any).initialLoaderTimeout).toBeNull();
        expect(detectSpy).toHaveBeenCalled();
    });

    it('should keep initial loader visible until minimum duration is reached', () => {
        vi.useFakeTimers();
        try {
            component.showInitialLoader = true;
            (component as any).initialLoaderTimeout = null;
            (component as any).initialLoaderStartedAt = Date.now();
            (component as any).minimumLoaderDurationMs = 600;

            (component as any).scheduleInitialLoaderHide();

            expect(component.showInitialLoader).toBe(true);
            expect((component as any).initialLoaderTimeout).toBeTruthy();

            vi.advanceTimersByTime(599);
            expect(component.showInitialLoader).toBe(true);

            vi.advanceTimersByTime(1);
            expect(component.showInitialLoader).toBe(false);
            expect((component as any).initialLoaderTimeout).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('should render metric loader component while initial loader is visible', () => {
        component.authState = true;
        component.showInitialLoader = true;
        fixture.detectChanges();

        const overlay = fixture.nativeElement.querySelector('.qs-loader-overlay') as HTMLElement | null;
        expect(overlay).toBeTruthy();
        expect(overlay?.querySelector('app-metric-loader')).toBeTruthy();
    });

    it('should no-op when hideInitialLoader is called while already hidden', () => {
        component.showInitialLoader = false;
        const detectSpy = vi.spyOn((component as any).changeDetectorRef, 'detectChanges');

        (component as any).hideInitialLoader();

        expect(component.showInitialLoader).toBe(false);
        expect(detectSpy).not.toHaveBeenCalled();
    });

    it('should reset scroll to top on NavigationEnd', () => {
        const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => { });
        fixture.detectChanges();
        component.headerHidden = true;

        const shellScroller = fixture.nativeElement.querySelector('.mat-drawer-content') as HTMLElement | null;
        if (shellScroller) {
            shellScroller.scrollTop = 120;
            shellScroller.scrollLeft = 20;
        }

        (mockRouter.events as Subject<any>).next(new NavigationEnd(1, '/dashboard', '/dashboard'));
        (mockRouter.events as Subject<any>).next(new NavigationEnd(1, '/dashboard', '/dashboard'));

        if (shellScroller) {
            expect(shellScroller.scrollTop).toBe(0);
            expect(shellScroller.scrollLeft).toBe(0);
        }
        expect(component.headerHidden).toBe(false);
        expect(scrollSpy).toHaveBeenCalled();
    });

    it('should trigger haptics for imperative navigations after initial navigation', () => {
        mockHapticsService.selection.mockClear();

        (mockRouter.events as Subject<any>).next(new NavigationEnd(1, '/dashboard', '/dashboard'));
        expect(mockHapticsService.selection).not.toHaveBeenCalled();

        (mockRouter.events as Subject<any>).next(new NavigationStart(2, '/help', 'imperative'));
        (mockRouter.events as Subject<any>).next(new NavigationEnd(2, '/help', '/help'));
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(1);
    });

    it('should not trigger haptics for popstate navigations', () => {
        mockHapticsService.selection.mockClear();

        (mockRouter.events as Subject<any>).next(new NavigationEnd(1, '/dashboard', '/dashboard'));
        (mockRouter.events as Subject<any>).next(new NavigationStart(2, '/dashboard', 'popstate'));
        (mockRouter.events as Subject<any>).next(new NavigationEnd(2, '/dashboard', '/dashboard'));

        expect(mockHapticsService.selection).not.toHaveBeenCalled();
    });

    it('should persist hasSubscribedOnce and onboardingCompleted for paid users with accepted terms', () => {
        const appUserService = TestBed.inject(AppUserService) as any;
        appUserService.updateUserProperties.mockClear();

        component['currentUser'] = {
            uid: 'u1',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            stripeRole: 'pro',
            hasSubscribedOnce: false,
            onboardingCompleted: false
        };
        mockRouter.url = '/dashboard';

        (component as any).updateOnboardingState();

        expect(appUserService.updateUserProperties).toHaveBeenCalledWith(
            component['currentUser'],
            { hasSubscribedOnce: true, onboardingCompleted: true }
        );
    });

    it('should not persist onboardingCompleted when terms are not accepted', () => {
        const appUserService = TestBed.inject(AppUserService) as any;
        appUserService.updateUserProperties.mockClear();

        component['currentUser'] = {
            uid: 'u1',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: false,
            acceptedTos: true,
            stripeRole: 'pro',
            hasSubscribedOnce: false,
            onboardingCompleted: false
        };
        mockRouter.url = '/dashboard';

        (component as any).updateOnboardingState();

        expect(appUserService.updateUserProperties).toHaveBeenCalledWith(
            component['currentUser'],
            { hasSubscribedOnce: true }
        );
    });

    it('should clear pending initial loader timeout on destroy', () => {
        vi.useFakeTimers();
        try {
            component.showInitialLoader = true;
            (component as any).initialLoaderStartedAt = Date.now();
            (component as any).minimumLoaderDurationMs = 450;
            (component as any).scheduleInitialLoaderHide();
            expect((component as any).initialLoaderTimeout).toBeTruthy();

            component.ngOnDestroy();
            expect((component as any).initialLoaderTimeout).toBeNull();

            vi.advanceTimersByTime(450);
            expect(component.showInitialLoader).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
