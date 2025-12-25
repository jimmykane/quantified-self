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
import { of, throwError } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock Firebase Auth functions
vi.mock('@angular/fire/auth', async () => {
    const actual = await vi.importActual('@angular/fire/auth');
    return {
        ...actual as any,
        signInWithPopup: vi.fn(),
        OAuthProvider: {
            credentialFromError: vi.fn().mockReturnValue({ providerId: 'github.com' })
        }
    };
});

import { signInWithPopup, OAuthProvider } from '@angular/fire/auth';

describe('LoginComponent', () => {
    let component: LoginComponent;

    const mockAuthService = {
        user$: of(null),
        isSignInWithEmailLink: () => false,
        googleLogin: vi.fn().mockResolvedValue({}),
        githubLogin: vi.fn().mockResolvedValue({}),
        fetchSignInMethods: vi.fn().mockResolvedValue([]),
        getProviderForId: vi.fn().mockReturnValue({}),
        linkCredential: vi.fn().mockResolvedValue({}),
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

    it('should handle account collision and link credentials', async () => {
        const collisionError = {
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'test@example.com' }
        };

        // 1. Mock first login to fail with collision
        (mockAuthService.githubLogin as any).mockRejectedValueOnce(collisionError);

        // 2. Mock fetchSignInMethods to return 'google.com'
        (mockAuthService as any).fetchSignInMethods = vi.fn().mockResolvedValue(['google.com']);
        (mockAuthService as any).getProviderForId = vi.fn().mockReturnValue({});
        (mockAuthService as any).linkCredential = vi.fn().mockResolvedValue({});

        // 3. Mock window.confirm
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        // 4. Mock secondary signInWithPopup success
        const mockUser = { uid: '123' };
        (signInWithPopup as any).mockResolvedValue({ user: mockUser });

        // Trigger flow
        component.signInWithProvider(SignInProviders.GitHub);

        // We need to wait for the async handle error flow
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAuthService.fetchSignInMethods).toHaveBeenCalledWith('test@example.com');
        expect(confirmSpy).toHaveBeenCalled();
        expect(signInWithPopup).toHaveBeenCalled();
        expect(mockAuthService.linkCredential).toHaveBeenCalledWith(mockUser, expect.anything());
        expect(mockSnackBar.open).toHaveBeenCalledWith('Accounts successfully linked!', 'Close', expect.anything());
    });
});
