import { ActivitySendService } from './services/activity-send.service';
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
import { AppLocaleService } from './services/app.locale.service';
import { AppWindowService } from './services/app.window.service';
import { LoggerService } from './services/logger.service';
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
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { AppThemes } from '@sports-alliance/sports-lib';

// ... (existing imports)

describe('AppShellComponent', () => {
    let component: AppShellComponent;
    let fixture: ComponentFixture<AppShellComponent>;

    const syncRoute = (url: string) => {
        mockRouter.url = url;
        (component as any).syncCurrentRouteState();
    };

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
        isLoading: signal(true),
    };

    const mockSeoService = {
        init: vi.fn()
    };

    const mockAnalyticsService = {
        setAnalyticsCollectionEnabled: vi.fn()
    };
    const mockThemeService = {
        getAppTheme: vi.fn().mockReturnValue(of(AppThemes.Normal)),
        applyBodyTheme: vi.fn(),
        setAppTheme: vi.fn(),
        themeChange$: new Subject()
    };
    const mockHapticsService = {
        selection: vi.fn()
    };
    const mockLocaleService = {
        reconcileAccountPreference: vi.fn()
    };


    const renderShellFixture = () => {
        fixture = TestBed.createComponent(AppShellComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    };

    beforeEach(async () => {
        window.history.pushState({}, '', '/');
        mockRouter.events = new Subject();
        mockRouter.url = '/';
        mockThemeService.themeChange$ = new Subject();
        mockAppAuthService.user$ = of(null);
        mockLocaleService.reconcileAccountPreference.mockReset();

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
                { provide: ActivitySendService, useValue: {} },
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
                { provide: AppLocaleService, useValue: mockLocaleService },
                {
                    provide: AppUserService, useValue: {
                        updateUserProperties: vi.fn().mockReturnValue(Promise.resolve()),
                        getSubscriptionRole: vi.fn().mockReturnValue(Promise.resolve('free')),
                        gracePeriodUntil: signal(null),
                        profileReadState: signal({ status: 'initializing' }),
                        isAdmin: vi.fn().mockReturnValue(Promise.resolve(false)),
                        hasIncompleteProfileReads: vi.fn().mockReturnValue(false)
                    }
                },
                {
                    provide: AppWhatsNewService, useValue: {
                        unreadCount: signal(0),
                        markAsRead: vi.fn(),
                        ensureChangelogsLoaded: vi.fn(),
                        setAdminMode: vi.fn()
                    }
                },
                {
                    provide: MatDialog, useValue: {
                        open: vi.fn()
                    }
                },
                { provide: AppHapticsService, useValue: mockHapticsService }
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();

    });

    const createPendingStartup = () => {
        window.history.pushState({}, '', '/dashboard');
        mockRouter.url = '/dashboard';
        const authUser = new Subject<any>();
        mockAppAuthService.user$ = authUser.asObservable();
        const pendingFixture = TestBed.createComponent(AppShellComponent);
        pendingFixture.detectChanges();
        return { pendingFixture, pendingComponent: pendingFixture.componentInstance, authUser };
    };

    it('replaces stalled startup with recovery at the deadline and reports it once', async () => {
        vi.useFakeTimers();
        const report = vi.spyOn(TestBed.inject(LoggerService), 'captureMessage').mockImplementation(() => {});
        const { pendingFixture, pendingComponent } = createPendingStartup();
        try {
            await vi.advanceTimersByTimeAsync(14_999);
            expect(pendingComponent.startupStalled()).toBe(false);
            expect(report).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            pendingFixture.detectChanges();
            expect(pendingFixture.nativeElement.querySelector('app-metric-loader')).toBeNull();
            expect(pendingFixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Loading is taking longer');
            expect(report).toHaveBeenCalledExactlyOnceWith('App startup stalled', {
                level: 'warning', tags: { startup_failure: 'timeout', profile_state: 'initializing' },
            });
            expect(pendingComponent.authState).toBeNull();
            await vi.advanceTimersByTimeAsync(120_000);
            expect(report).toHaveBeenCalledTimes(1);
        } finally { pendingFixture.destroy(); vi.useRealTimers(); }
    });

    it.each(['before', 'after'])('accepts late auth %s the startup deadline without a reload', async timing => {
        vi.useFakeTimers();
        const report = vi.spyOn(TestBed.inject(LoggerService), 'captureMessage').mockImplementation(() => {});
        const { pendingFixture, pendingComponent, authUser } = createPendingStartup();
        try {
            await vi.advanceTimersByTimeAsync(timing === 'before' ? 14_999 : 15_000);
            authUser.next(null);
            pendingFixture.detectChanges();
            expect(pendingComponent.startupStalled()).toBe(false);
            expect(pendingComponent.showInitialLoader).toBe(false);
            expect(pendingComponent.authState).toBe(false);
            await vi.advanceTimersByTimeAsync(120_000);
            expect(report).toHaveBeenCalledTimes(timing === 'before' ? 0 : 1);
        } finally { pendingFixture.destroy(); vi.useRealTimers(); }
    });

    it('opens a late authenticated session without discarding it or writing account data', async () => {
        vi.useFakeTimers();
        vi.spyOn(TestBed.inject(LoggerService), 'captureMessage').mockImplementation(() => {});
        const { pendingFixture, pendingComponent, authUser } = createPendingStartup();
        try {
            await vi.advanceTimersByTimeAsync(15_000);
            authUser.next({ uid: 'u1', acceptedPrivacyPolicy: true, acceptedDataPolicy: true,
                acceptedTos: true, onboardingCompleted: true, hasSubscribedOnce: true });
            pendingFixture.detectChanges();
            expect(pendingComponent.startupStalled()).toBe(false);
            expect(pendingComponent.authState).toBe(true);
            expect(pendingComponent.currentUser?.uid).toBe('u1');
            expect(TestBed.inject(AppUserService).updateUserProperties).not.toHaveBeenCalled();
        } finally { pendingFixture.destroy(); vi.useRealTimers(); }
    });

    it('keeps public content visible when authentication is pending', async () => {
        vi.useFakeTimers();
        const report = vi.spyOn(TestBed.inject(LoggerService), 'captureMessage').mockImplementation(() => {});
        mockAppAuthService.user$ = new Subject().asObservable();
        const publicFixture = TestBed.createComponent(AppShellComponent);
        publicFixture.detectChanges();
        try {
            await vi.advanceTimersByTimeAsync(30_000);
            expect(publicFixture.componentInstance.startupStalled()).toBe(false);
            expect(publicFixture.componentInstance.showInitialLoader).toBe(false);
            expect(report).not.toHaveBeenCalled();
        } finally { publicFixture.destroy(); vi.useRealTimers(); }
    });

    it.each(['error', 'complete'])('shows startup recovery when the user stream ends with %s before emitting', end => {
        const report = vi.spyOn(TestBed.inject(LoggerService), 'captureMessage').mockImplementation(() => {});
        const { pendingFixture, pendingComponent, authUser } = createPendingStartup();
        try {
            if (end === 'error') authUser.error(new Error('stream failed'));
            else authUser.complete();
            pendingFixture.detectChanges();
            expect(pendingComponent.startupStalled()).toBe(true);
            expect(report).toHaveBeenCalledTimes(1);
        } finally { pendingFixture.destroy(); }
    });

    it('cancels the startup deadline on destruction', async () => {
        vi.useFakeTimers();
        const report = vi.spyOn(TestBed.inject(LoggerService), 'captureMessage').mockImplementation(() => {});
        const { pendingFixture } = createPendingStartup();
        pendingFixture.destroy();
        try {
            await vi.advanceTimersByTimeAsync(120_000);
            expect(report).not.toHaveBeenCalled();
        } finally { vi.useRealTimers(); }
    });

    it('keeps recovery usable if telemetry throws and guards explicit reload clicks', async () => {
        vi.useFakeTimers();
        vi.spyOn(TestBed.inject(LoggerService), 'captureMessage').mockImplementation(() => { throw new Error('telemetry blocked'); });
        const reload = vi.fn();
        vi.spyOn(TestBed.inject(AppWindowService), 'windowRef', 'get').mockReturnValue({ location: { reload } } as unknown as Window);
        const { pendingFixture, pendingComponent } = createPendingStartup();
        try {
            await vi.advanceTimersByTimeAsync(15_000);
            pendingFixture.detectChanges();
            const button = pendingFixture.nativeElement.querySelector('button');
            button.click();
            pendingFixture.detectChanges();
            button.click();
            expect(reload).toHaveBeenCalledTimes(1);
            expect(mockHapticsService.selection).toHaveBeenCalledTimes(1);
            expect(button.disabled).toBe(true);
            expect(button.textContent).toContain('Reloading');
            await vi.advanceTimersByTimeAsync(5_000);
            pendingFixture.detectChanges();
            expect(button.disabled).toBe(false);
            expect(pendingComponent.startupStalled()).toBe(true);
        } finally { pendingFixture.destroy(); vi.useRealTimers(); }
    });

    it('should create', () => {
        renderShellFixture();
        expect(component).toBeTruthy();
    });

    it('should initialize analytics service', () => {
        renderShellFixture();
        expect(component['analyticsService']).toBeTruthy();
    });

    it('reconciles the regional format when an authenticated account hydrates', () => {
        const user = { uid: 'locale-user', settings: { appSettings: { formatLocale: 'fr-FR' } } };
        mockLocaleService.reconcileAccountPreference.mockReset();
        mockAppAuthService.user$ = of(user);

        const authenticatedFixture = TestBed.createComponent(AppShellComponent);
        authenticatedFixture.detectChanges();

        expect(mockLocaleService.reconcileAccountPreference).toHaveBeenCalledWith(user);
        authenticatedFixture.destroy();
    });

    it('should keep prerendered public startup pages visible while browser auth resolves', () => {
        window.history.pushState({}, '', '/features/ai-insights');

        const publicFixture = TestBed.createComponent(AppShellComponent);
        const publicComponent = publicFixture.componentInstance;

        expect(publicComponent.authState).toBe(false);
        expect(publicComponent.showInitialLoader).toBe(false);

        publicFixture.destroy();
    });

    it('should keep the workout file analyzer public startup page visible while browser auth resolves', () => {
        window.history.pushState({}, '', '/features/fit-gpx-tcx-file-analyzer');

        const publicFixture = TestBed.createComponent(AppShellComponent);
        const publicComponent = publicFixture.componentInstance;

        expect(publicComponent.authState).toBe(false);
        expect(publicComponent.showInitialLoader).toBe(false);

        publicFixture.destroy();
    });

    it('should keep compare routes neutral while browser auth resolves', () => {
        window.history.pushState({}, '', '/tools/compare');

        const compareFixture = TestBed.createComponent(AppShellComponent);
        const compareComponent = compareFixture.componentInstance;

        expect(compareComponent.authState).toBeNull();
        expect(compareComponent.showInitialLoader).toBe(false);
        expect(compareComponent.renderPublicShellWhileAuthPending).toBe(true);

        compareFixture.destroy();
    });

    it('should keep saved comparisons neutral while browser auth resolves', () => {
        window.history.pushState({}, '', '/tools/compare/saved');

        const publicFixture = TestBed.createComponent(AppShellComponent);
        const publicComponent = publicFixture.componentInstance;

        expect(publicComponent.authState).toBeNull();
        expect(publicComponent.showInitialLoader).toBe(false);
        expect(publicComponent.renderPublicShellWhileAuthPending).toBe(true);

        publicFixture.destroy();
    });

    it('should leave compare auth-pending shell mode after navigating away', () => {
        window.history.pushState({}, '', '/tools/compare');

        const compareFixture = TestBed.createComponent(AppShellComponent);
        const compareComponent = compareFixture.componentInstance;
        mockRouter.url = '/features/fit-gpx-tcx-file-analyzer';

        (compareComponent as any).syncCurrentRouteState();

        expect(compareComponent.renderPublicShellWhileAuthPending).toBe(false);

        compareFixture.destroy();
    });

    it('should leave compare auth-pending shell mode after auth resolves', () => {
        window.history.pushState({}, '', '/tools/compare');

        const compareFixture = TestBed.createComponent(AppShellComponent);
        const compareComponent = compareFixture.componentInstance;

        expect(compareComponent.renderPublicShellWhileAuthPending).toBe(true);

        compareFixture.detectChanges();

        expect(compareComponent.authState).toBe(false);
        expect(compareComponent.renderPublicShellWhileAuthPending).toBe(false);

        compareFixture.destroy();
    });

    it('should keep the initial loader behavior for private startup routes', () => {
        window.history.pushState({}, '', '/dashboard');

        const privateFixture = TestBed.createComponent(AppShellComponent);
        const privateComponent = privateFixture.componentInstance;

        expect(privateComponent.authState).toBeNull();
        expect(privateComponent.showInitialLoader).toBe(true);

        privateFixture.destroy();
    });

    it('should show navigation for free users on subscriptions page', () => {
        renderShellFixture();
        // Mock user as free
        component['currentUser'] = { stripeRole: undefined };
        component.onboardingCompleted = true;

        // Mock router URL
        mockRouter.url = '/subscriptions';

        expect(component.showNavigation()).toBe(true);
    });

    it('should show navigation for free users on dashboard', () => {
        renderShellFixture();
        // Mock user as free
        component['currentUser'] = { stripeRole: undefined };
        component.onboardingCompleted = true;

        // Mock router URL
        mockRouter.url = '/dashboard';

        expect(component.showNavigation()).toBe(true);
    });

    it('should show navigation for basic users on subscriptions page', () => {
        renderShellFixture();
        // Mock user as basic
        component['currentUser'] = { stripeRole: 'basic' };
        component.onboardingCompleted = true;

        // Mock router URL
        mockRouter.url = '/subscriptions';

        expect(component.showNavigation()).toBe(true);
    });

    it('should include grace period banner component', () => {
        renderShellFixture();
        fixture.detectChanges();
        const bannerComponent = fixture.nativeElement.querySelector('app-grace-period-banner');
        expect(bannerComponent).toBeTruthy();
    });

    it('should expose layout css variables based on banner height', () => {
        renderShellFixture();
        component.onboardingCompleted = true;
        component.onBannerHeightChanged(36);
        fixture.detectChanges();

        const expectedTopOffsetPx = `${component.bannerHeight + APP_SHELL_HEADER_HEIGHT_PX}px`;
        const wrapper = fixture.nativeElement.querySelector('.app-layout-wrapper') as HTMLElement | null;
        const scrollContent = fixture.nativeElement.querySelector('.app-shell-scroll-content') as HTMLElement | null;
        expect(wrapper).toBeTruthy();
        expect(scrollContent).toBeTruthy();
        expect(component.layoutTopOffsetPx).toBe(component.bannerHeight + APP_SHELL_HEADER_HEIGHT_PX);
        expect(component.effectiveTopOffsetPx).toBe(component.bannerHeight + APP_SHELL_HEADER_HEIGHT_PX);
        expect(component.visibleTopOffsetPx).toBe(component.bannerHeight + APP_SHELL_HEADER_HEIGHT_PX);
        expect(wrapper?.style.getPropertyValue('--qs-layout-top-offset')).toBe(expectedTopOffsetPx);
        expect(wrapper?.style.getPropertyValue('--qs-effective-top-offset')).toBe(expectedTopOffsetPx);
        expect(wrapper?.style.getPropertyValue('--qs-visible-top-offset')).toBe(expectedTopOffsetPx);
        expect(wrapper?.style.getPropertyValue('--qs-banner-height')).toBe('36px');
        expect(scrollContent?.style.paddingTop).toBe(expectedTopOffsetPx);
    });

    it('should expose zero effective top offset when onboarding is not completed', () => {
        renderShellFixture();
        component.onboardingCompleted = false;
        component.onBannerHeightChanged(36);
        fixture.detectChanges();

        const wrapper = fixture.nativeElement.querySelector('.app-layout-wrapper') as HTMLElement | null;
        const scrollContent = fixture.nativeElement.querySelector('.app-shell-scroll-content') as HTMLElement | null;
        expect(wrapper).toBeTruthy();
        expect(scrollContent).toBeTruthy();
        expect(wrapper?.style.getPropertyValue('--qs-layout-top-offset')).toBe('0px');
        expect(wrapper?.style.getPropertyValue('--qs-effective-top-offset')).toBe('0px');
        expect(wrapper?.style.getPropertyValue('--qs-visible-top-offset')).toBe('0px');
        expect(wrapper?.style.getPropertyValue('--qs-banner-height')).toBe('0px');
        expect(scrollContent?.style.paddingTop).toBe('0px');
    });

    it('should hide header after scrolling beyond threshold', () => {
        renderShellFixture();
        component.onboardingCompleted = true;
        component.bannerHeight = 24;
        component.headerHidden = false;
        (component as any).lastShellScrollTop = 0;

        (component as any).updateHeaderVisibilityFromScroll(90);

        expect(component.headerHidden).toBe(true);
        expect(component.layoutTopOffsetPx).toBe(24 + APP_SHELL_HEADER_HEIGHT_PX);
        expect(component.effectiveTopOffsetPx).toBe(24 + APP_SHELL_HEADER_HEIGHT_PX);
        expect(component.visibleTopOffsetPx).toBe(24);
    });

    it('should reveal header again near the top of the page', () => {
        renderShellFixture();
        component.onboardingCompleted = true;
        component.headerHidden = true;
        (component as any).lastShellScrollTop = 90;

        (component as any).updateHeaderVisibilityFromScroll(24);

        expect(component.headerHidden).toBe(false);
        expect(component.layoutTopOffsetPx).toBe(APP_SHELL_HEADER_HEIGHT_PX);
        expect(component.effectiveTopOffsetPx).toBe(APP_SHELL_HEADER_HEIGHT_PX);
        expect(component.visibleTopOffsetPx).toBe(APP_SHELL_HEADER_HEIGHT_PX);
    });

    it('should keep the content top offsets stable when the header is hidden', () => {
        renderShellFixture();
        component.onboardingCompleted = true;
        component.bannerHeight = 18;
        component.headerHidden = false;

        const visibleOffset = component.layoutTopOffsetPx;

        component.headerHidden = true;

        expect(visibleOffset).toBe(18 + APP_SHELL_HEADER_HEIGHT_PX);
        expect(component.layoutTopOffsetPx).toBe(18 + APP_SHELL_HEADER_HEIGHT_PX);
        expect(component.effectiveTopOffsetPx).toBe(18 + APP_SHELL_HEADER_HEIGHT_PX);
        expect(component.visibleTopOffsetPx).toBe(18);
    });

    it('should ignore small scroll deltas once threshold is crossed', () => {
        renderShellFixture();
        component.onboardingCompleted = true;
        component.headerHidden = false;
        (component as any).lastShellScrollTop = 60;
        (component as any).headerVisibilityAnchorScrollTop = 60;

        (component as any).updateHeaderVisibilityFromScroll(61);
        expect(component.headerHidden).toBe(false);

        (component as any).updateHeaderVisibilityFromScroll(85);
        expect(component.headerHidden).toBe(true);
    });

    it('should require sustained upward scrolling before revealing the header again', () => {
        renderShellFixture();
        component.onboardingCompleted = true;
        component.headerHidden = true;
        (component as any).lastShellScrollTop = 120;
        (component as any).headerVisibilityAnchorScrollTop = 120;

        (component as any).updateHeaderVisibilityFromScroll(119);
        expect(component.headerHidden).toBe(true);

        (component as any).updateHeaderVisibilityFromScroll(95);
        expect(component.headerHidden).toBe(false);
    });

    it('should ignore nested scroll containers when tracking header visibility globally', () => {
        renderShellFixture();
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

    it('should use window scroll as a fallback when no shell scroller is registered', () => {
        renderShellFixture();
        const originalScrollY = window.scrollY;

        component.onboardingCompleted = true;
        component.headerHidden = false;
        (component as any).lastShellScrollTop = 0;
        (component as any).currentSidenavContainer = null;

        Object.defineProperty(window, 'scrollY', {
            configurable: true,
            value: 120
        });

        window.dispatchEvent(new Event('scroll'));

        expect(component.headerHidden).toBe(true);

        Object.defineProperty(window, 'scrollY', {
            configurable: true,
            value: originalScrollY
        });
    });

    it('should reveal the header when navigating to onboarding even if the shell scroller is still offset', () => {
        renderShellFixture();
        component['currentUser'] = {
            uid: 'u1',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            stripeRole: 'pro',
            onboardingCompleted: true
        };
        component.headerHidden = true;
        (component as any).lastShellScrollTop = 120;
        fixture.detectChanges();

        const shellScroller = fixture.nativeElement.querySelector('.app-sidenav-container .mat-drawer-content') as HTMLElement | null;
        expect(shellScroller).toBeTruthy();
        if (shellScroller) {
            shellScroller.scrollTop = 120;
        }

        syncRoute('/onboarding/profile');
        (mockRouter.events as Subject<any>).next(new NavigationEnd(1, '/onboarding/profile', '/onboarding/profile'));

        expect(component.isOnboardingRoute).toBe(true);
        expect(component.showNavigation()).toBe(true);
        expect(component.headerHidden).toBe(false);
    });

    it('should return true for isDashboardRoute when url includes dashboard', () => {
        renderShellFixture();
        syncRoute('/dashboard');
        expect(component.isDashboardRoute).toBe(true);
    });

    it('should return true for isLoginRoute when url includes login', () => {
        renderShellFixture();
        syncRoute('/login');
        expect(component.isLoginRoute).toBe(true);
    });

    it('should return true for isAdminRoute when url includes admin', () => {
        renderShellFixture();
        syncRoute('/admin');
        expect(component.isAdminRoute).toBe(true);
    });

    it('should return true for isHomeRoute when url is /', () => {
        renderShellFixture();
        syncRoute('/');
        expect(component.isHomeRoute).toBe(true);
    });

    it('should return true for isHomeRoute when url is /?param=value', () => {
        renderShellFixture();
        syncRoute('/?param=value');
        expect(component.isHomeRoute).toBe(true);
    });

    it('should return false for isHomeRoute when url is /dashboard', () => {
        renderShellFixture();
        syncRoute('/dashboard');
        expect(component.isHomeRoute).toBe(false);
    });

    it('should expose showUploadActivities only on dashboard with user', () => {
        renderShellFixture();
        syncRoute('/dashboard');
        component['currentUser'] = { uid: 'u1' };
        expect(component.showUploadActivities()).toBe(true);

        syncRoute('/subscriptions');
        expect(component.showUploadActivities()).toBe(false);
    });

    it('should place the impersonation banner inside the maintenance branch', () => {
        renderShellFixture();
        syncRoute('/dashboard');
        mockRemoteConfigService.maintenanceMode.set(true);
        fixture.detectChanges();

        const banners = fixture.nativeElement.querySelectorAll('app-impersonation-banner');
        expect(banners).toHaveLength(1);
    });

    it('should return unread whats-new count from service signal', () => {
        renderShellFixture();
        expect(component.unreadWhatsNewCount).toBe(0);
    });

    it('should navigate to dashboard on logo click when authenticated', () => {
        renderShellFixture();
        component.authState = true;
        component.onLogoClick();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should navigate home on logo click when unauthenticated', () => {
        renderShellFixture();
        component.authState = false;
        component.onLogoClick();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/']);
    });

    it('should toggle sidenav through side nav service', () => {
        renderShellFixture();
        mockHapticsService.selection.mockClear();
        component.toggleSidenav();
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(1);
        expect(mockAppSideNavService.toggle).toHaveBeenCalled();
    });

    it('should navigate to dashboard', () => {
        renderShellFixture();
        component.navigateToDashboard();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should navigate to admin', () => {
        renderShellFixture();
        component.navigateToAdmin();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin']);
    });

    it('should navigate to login', () => {
        renderShellFixture();
        component.navigateToLogin();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('should place the impersonation banner inside the main shell content', () => {
        renderShellFixture();
        mockRemoteConfigService.maintenanceMode.set(false);
        fixture.detectChanges();

        const sidenavContent = fixture.nativeElement.querySelector('mat-sidenav-content') as HTMLElement | null;
        const banner = sidenavContent?.querySelector('app-impersonation-banner');
        expect(banner).toBeTruthy();
    });

    it('should no-op banner updates when height and state are unchanged', () => {
        renderShellFixture();
        component.bannerHeight = 0;
        component.hasBanner = false;

        component.onBannerHeightChanged(0);

        expect(component.bannerHeight).toBe(0);
        expect(component.hasBanner).toBe(false);
    });

    it('should ignore tiny banner height deltas to prevent shell wobble', () => {
        renderShellFixture();
        component.bannerHeight = 56;
        component.hasBanner = true;

        component.onBannerHeightChanged(58);

        expect(component.bannerHeight).toBe(56);
        expect(component.hasBanner).toBe(true);

        component.onBannerHeightChanged(60);

        expect(component.bannerHeight).toBe(60);
        expect(component.hasBanner).toBe(true);
    });

    it('should reset banner fields when dismissing grace period banner', () => {
        renderShellFixture();
        component.bannerHeight = 42;
        component.hasBanner = true;
        component.dismissGracePeriodBanner();
        expect(component.bannerHeight).toBe(0);
        expect(component.hasBanner).toBe(false);
    });

    it('should open whats new dialog with expected config', async () => {
        renderShellFixture();
        const dialog = TestBed.inject(MatDialog) as any;
        const whatsNewService = TestBed.inject(AppWhatsNewService) as any;
        await component.openWhatsNew();
        const [, config] = dialog.open.mock.calls.at(-1);

        expect(whatsNewService.ensureChangelogsLoaded).toHaveBeenCalledOnce();
        expect(dialog.open).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                width: '860px',
                maxWidth: '96vw',
                autoFocus: false
            })
        );
        expect(config.panelClass).toBeUndefined();
    });

    it('should apply and clear theme overlay during reveal animation', () => {
        renderShellFixture();
        vi.useFakeTimers();
        mockThemeService.setAppTheme.mockClear();

        (component as any).triggerThemeReveal('Dark');
        expect(component.themeOverlayActive).toBe(true);
        expect(component.themeOverlayClass).toBe('dark-theme');

        vi.advanceTimersByTime(300);
        expect(mockThemeService.setAppTheme).toHaveBeenCalledWith('Dark', false);

        vi.advanceTimersByTime(300);
        expect(component.themeOverlayActive).toBe(false);

        (component as any).triggerThemeReveal('Light');
        vi.advanceTimersByTime(300);
        expect(mockThemeService.setAppTheme).toHaveBeenCalledWith('Light', false);

        vi.useRealTimers();
    });

    it('should hide the initial loader before the admin-role lookup completes', async () => {
        window.history.pushState({}, '', '/dashboard');
        mockRouter.url = '/dashboard';
        const authUser$ = new Subject<any>();
        mockAppAuthService.user$ = authUser$.asObservable();
        const appUserService = TestBed.inject(AppUserService) as any;
        let resolveAdminLookup: (isAdmin: boolean) => void;
        appUserService.isAdmin.mockReturnValue(new Promise<boolean>(resolve => {
            resolveAdminLookup = resolve;
        }));
        const privateFixture = TestBed.createComponent(AppShellComponent);
        const privateComponent = privateFixture.componentInstance;
        privateFixture.detectChanges();

        expect(privateComponent.showInitialLoader).toBe(true);

        authUser$.next({
            uid: 'u1',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            hasSubscribedOnce: true,
            onboardingCompleted: true
        });

        expect(privateComponent.showInitialLoader).toBe(false);

        resolveAdminLookup!(false);
        await Promise.resolve();
        privateFixture.destroy();
    });

    it('does not render a shell overlay while maintenance configuration is still resolving', () => {
        renderShellFixture();
        mockRemoteConfigService.maintenanceMode.set(false);
        mockRemoteConfigService.isLoading.set(true);
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.loading-overlay')).toBeNull();
        expect(fixture.nativeElement.querySelector('.logo-spinner')).toBeNull();
    });

    it('should no-op when hideInitialLoader is called while already hidden', () => {
        renderShellFixture();
        component.showInitialLoader = false;

        (component as any).hideInitialLoader();

        expect(component.showInitialLoader).toBe(false);
    });

    it('should reset scroll to top when NavigationEnd changes route', () => {
        renderShellFixture();
        const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => { });
        fixture.detectChanges();
        component.headerHidden = true;

        const shellScroller = fixture.nativeElement.querySelector('.mat-drawer-content') as HTMLElement | null;
        if (shellScroller) {
            shellScroller.scrollTop = 120;
            shellScroller.scrollLeft = 20;
        }

        // The shell resets only for an actual path change, not a duplicate NavigationEnd.
        (mockRouter.events as Subject<any>).next(new NavigationEnd(1, '/dashboard', '/dashboard'));
        (mockRouter.events as Subject<any>).next(new NavigationEnd(2, '/help', '/help'));

        if (shellScroller) {
            expect(shellScroller.scrollTop).toBe(0);
            expect(shellScroller.scrollLeft).toBe(0);
        }
        expect(component.headerHidden).toBe(false);
        expect(scrollSpy).toHaveBeenCalled();
    });

    it('should trigger haptics for imperative navigations after initial navigation', () => {
        renderShellFixture();
        mockHapticsService.selection.mockClear();

        (mockRouter.events as Subject<any>).next(new NavigationEnd(1, '/dashboard', '/dashboard'));
        expect(mockHapticsService.selection).not.toHaveBeenCalled();

        (mockRouter.events as Subject<any>).next(new NavigationStart(2, '/help', 'imperative'));
        (mockRouter.events as Subject<any>).next(new NavigationEnd(2, '/help', '/help'));
        expect(mockHapticsService.selection).toHaveBeenCalledTimes(1);
    });

    it('should not trigger haptics for popstate navigations', () => {
        renderShellFixture();
        mockHapticsService.selection.mockClear();

        (mockRouter.events as Subject<any>).next(new NavigationEnd(1, '/dashboard', '/dashboard'));
        (mockRouter.events as Subject<any>).next(new NavigationStart(2, '/dashboard', 'popstate'));
        (mockRouter.events as Subject<any>).next(new NavigationEnd(2, '/dashboard', '/dashboard'));

        expect(mockHapticsService.selection).not.toHaveBeenCalled();
    });

    it('should persist hasSubscribedOnce and onboardingCompleted for paid users with accepted terms', () => {
        renderShellFixture();
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
        renderShellFixture();
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

    it('should defer onboarding persistence when profile reads are incomplete', () => {
        renderShellFixture();
        const appUserService = TestBed.inject(AppUserService) as any;
        appUserService.updateUserProperties.mockClear();
        appUserService.hasIncompleteProfileReads.mockReturnValue(true);

        component['currentUser'] = {
            uid: 'u1',
            acceptedPrivacyPolicy: false,
            acceptedDataPolicy: false,
            acceptedTos: false,
            stripeRole: 'pro',
            hasSubscribedOnce: false,
            onboardingCompleted: false
        };
        mockRouter.url = '/dashboard';

        (component as any).updateOnboardingState();

        expect(component.onboardingCompleted).toBe(true);
        expect(appUserService.updateUserProperties).not.toHaveBeenCalled();
    });

});
