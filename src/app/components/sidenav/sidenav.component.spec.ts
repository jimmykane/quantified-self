import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SideNavComponent } from './sidenav.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { AppSideNavService } from '../../services/side-nav/app-side-nav.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppWindowService } from '../../services/app.window.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NO_ERRORS_SCHEMA } from '@angular/core';

describe('SideNavComponent', () => {
    let component: SideNavComponent;
    let fixture: ComponentFixture<SideNavComponent>;
    let mockAuthService: any;
    let mockUserService: any;

    beforeEach(async () => {
        mockAuthService = {
            user$: of(null),
        };
        mockUserService = {
            isAdmin: vi.fn().mockResolvedValue(false),
        };

        await TestBed.configureTestingModule({
            declarations: [SideNavComponent],
            providers: [
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppSideNavService, useValue: { close: vi.fn() } },
                { provide: AppThemeService, useValue: { getAppTheme: () => of('normal') } },
                { provide: AppWindowService, useValue: {} },
                { provide: AppAnalyticsService, useValue: { logEvent: vi.fn() } },
                { provide: MatSnackBar, useValue: {} },
                { provide: Router, useValue: {} },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        }).compileComponents();

        fixture = TestBed.createComponent(SideNavComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('isProUser should be false for basic role', () => {
        component.user = { stripeRole: 'basic' } as any;
        expect(component.isProUser).toBe(false);
    });

    it('isBasicUser should be true for basic role', () => {
        component.user = { stripeRole: 'basic' } as any;
        expect(component.isBasicUser).toBe(true);
    });

    it('isProUser should be true for pro role', () => {
        component.user = { stripeRole: 'pro' } as any;
        expect(component.isProUser).toBe(true);
    });

    it('isProUser should be true for admin', () => {
        component.user = { stripeRole: 'free' } as any;
        component.isAdminUser = true;
        expect(component.isProUser).toBe(true);
    });

    it('hasPaidAccess should be true for basic role', () => {
        component.user = { stripeRole: 'basic' } as any;
        expect(component.hasPaidAccess).toBe(true);
    });

    it('hasPaidAccess should be true for pro role', () => {
        component.user = { stripeRole: 'pro' } as any;
        expect(component.hasPaidAccess).toBe(true);
    });

    it('hasPaidAccess should be false for free role', () => {
        component.user = { stripeRole: 'free' } as any;
        expect(component.hasPaidAccess).toBe(false);
    });
});
