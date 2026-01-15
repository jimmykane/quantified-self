import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppComponent } from './app.component';
import { AppAuthService } from './authentication/app.auth.service';
import { AppSideNavService } from './services/side-nav/app-side-nav.service';
import { AppUserService } from './services/app.user.service';
import { AppRemoteConfigService } from './services/app.remote-config.service';
import { AppAnalyticsService } from './services/app.analytics.service';
import { SeoService } from './services/seo.service';
import { AppIconService } from './services/app.icon.service';
import { AppThemeService } from './services/app.theme.service';

import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSidenavModule } from '@angular/material/sidenav';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ChangeDetectorRef, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

// ... (existing imports)

describe('AppComponent', () => {
    let component: AppComponent;
    let fixture: ComponentFixture<AppComponent>;

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
        setSidenav: vi.fn()
    };

    const mockAppIconService = {
        registerIcons: vi.fn()
    };

    const mockDomSanitizer = {
        bypassSecurityTrustResourceUrl: vi.fn()
    };

    const mockTitleService = {
        setTitle: vi.fn()
    };

    const mockRemoteConfigService = {
        getMaintenanceMode: vi.fn().mockReturnValue(of(false)),
        getMaintenanceMessage: vi.fn().mockReturnValue(of(''))
    };

    const mockSeoService = {
        init: vi.fn()
    };

    const mockAnalyticsService = {
        setAnalyticsCollectionEnabled: vi.fn()
    };
    const mockThemeService = {
        getAppTheme: vi.fn().mockReturnValue(of('Normal')),
        themeChange$: new Subject()
    };


    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [AppComponent],
            imports: [
                MatSidenavModule,
                MatTabsModule,
                NoopAnimationsModule,
                RouterModule
            ],
            providers: [
                { provide: AppAuthService, useValue: mockAppAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: AppSideNavService, useValue: mockAppSideNavService },
                { provide: AppIconService, useValue: mockAppIconService },
                { provide: DomSanitizer, useValue: mockDomSanitizer },
                // { provide: Title, useValue: mockTitleService }, // Removed
                { provide: AppRemoteConfigService, useValue: mockRemoteConfigService },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: SeoService, useValue: mockSeoService },
                { provide: AppThemeService, useValue: mockThemeService },
                {
                    provide: AppUserService, useValue: {
                        updateUserProperties: vi.fn().mockReturnValue(Promise.resolve()),
                        getSubscriptionRole: vi.fn().mockReturnValue(Promise.resolve('free')),
                        getGracePeriodUntil: vi.fn().mockReturnValue(of(null))
                    }
                },
                ChangeDetectorRef
            ],
            schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(AppComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should initialize analytics service', () => {
        expect(component['analyticsService']).toBeTruthy();
    });

    it('should show navigation for free users on pricing page', () => {
        // Mock user as free
        component['currentUser'] = { stripeRole: undefined };
        component.onboardingCompleted = true;

        // Mock router URL
        mockRouter.url = '/pricing';

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

    it('should show navigation for basic users on pricing page', () => {
        // Mock user as basic
        component['currentUser'] = { stripeRole: 'basic' };
        component.onboardingCompleted = true;

        // Mock router URL
        mockRouter.url = '/pricing';

        expect(component.showNavigation).toBe(true);
    });

    it('should include grace period banner component', () => {
        fixture.detectChanges();
        const bannerComponent = fixture.nativeElement.querySelector('app-grace-period-banner');
        expect(bannerComponent).toBeTruthy();
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
});
