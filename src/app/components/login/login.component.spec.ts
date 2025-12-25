import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { LoginComponent, SignInProviders } from './login.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Auth } from '@angular/fire/auth';
import { Analytics } from '@angular/fire/analytics';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('LoginComponent', () => {
    let component: LoginComponent;

    const mockAuthService = {
        user$: of(null),
        isSignInWithEmailLink: () => false,
        googleLogin: vi.fn().mockResolvedValue({}),
        githubLogin: vi.fn().mockResolvedValue({}),
        localStorageService: { getItem: () => null }
    };

    const mockUserService = {
        getUserByID: () => of({ displayName: 'Test User' })
    };

    const mockRouter = {
        navigate: vi.fn()
    };

    const mockSnackBar = {
        open: vi.fn()
    };

    // Mock dependencies for inject()
    const mockAuth = {};
    const mockAnalytics = {};

    const mockDialog = {};

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                LoginComponent, // Provide the component itself
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: Router, useValue: mockRouter },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: MatDialog, useValue: mockDialog },
                { provide: Auth, useValue: mockAuth },
                { provide: Analytics, useValue: mockAnalytics }
            ],
            schemas: [NO_ERRORS_SCHEMA]
        });

        // Injecting the component like a service handles inject() calls correctly
        component = TestBed.inject(LoginComponent);
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should call githubLogin when github provider is selected', () => {
        component.signInWithProvider(SignInProviders.GitHub);
        expect(mockAuthService.githubLogin).toHaveBeenCalled();
    });

    it('should call googleLogin when google provider is selected', () => {
        component.signInWithProvider(SignInProviders.Google);
        expect(mockAuthService.googleLogin).toHaveBeenCalled();
    });
});
