import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppComponent } from './app.component';
import { AppAuthService } from './authentication/app.auth.service';
import { AppSideNavService } from './services/side-nav/app-side-nav.service';
import { AppUserService } from './services/app.user.service';
import { MatIconRegistry } from '@angular/material/icon';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { DomSanitizer, Title } from '@angular/platform-browser';
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

    const mockMatIconRegistry = {
        addSvgIcon: vi.fn()
    };

    const mockDomSanitizer = {
        bypassSecurityTrustResourceUrl: vi.fn()
    };

    const mockTitleService = {
        setTitle: vi.fn()
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
                { provide: MatIconRegistry, useValue: mockMatIconRegistry },
                { provide: DomSanitizer, useValue: mockDomSanitizer },
                { provide: Title, useValue: mockTitleService },
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

    it('should hide navigation for free users on pricing page', () => {
        // Mock user as free
        component['currentUser'] = { stripeRole: undefined };
        component.onboardingCompleted = true;

        // Mock router URL
        mockRouter.url = '/pricing';

        expect(component.showNavigation).toBe(false);
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

    it('should show grace period banner when date is present', () => {
        const mockDate = new Date();
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'getGracePeriodUntil').mockReturnValue(of(mockDate));

        // Re-init component to trigger ngOnInit
        component.ngOnInit();
        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.grace-period-banner');
        expect(banner).toBeTruthy();
        expect(banner.textContent).toContain('Your Pro plan has ended');
    });

    it('should hide grace period banner when date is null', () => {
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'getGracePeriodUntil').mockReturnValue(of(null));

        component.ngOnInit();
        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.grace-period-banner');
        expect(banner).toBeFalsy();
    });
});
