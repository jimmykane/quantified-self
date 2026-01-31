import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { LoginComponent, SignInProviders } from './login.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { AppEventService } from '../../services/app.event.service';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Auth } from '@angular/fire/auth';
import { Analytics } from '@angular/fire/analytics';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock Firebase Auth functions
vi.mock('@angular/fire/auth', async () => {
    const actual = await vi.importActual('@angular/fire/auth');
    return {
        ...actual as any,
        signInWithPopup: vi.fn(),
        authState: () => of(null), // Mock authState to return null by default
        OAuthProvider: {
            credentialFromError: vi.fn().mockReturnValue({ providerId: 'github.com' })
        }
    };
});

import { signInWithPopup, OAuthProvider, authState } from '@angular/fire/auth';

describe('LoginComponent', () => {
    let component: LoginComponent;

    const mockAuthService = {
        user$: new BehaviorSubject(null) as any, // Use BehaviorSubject to control emission
        authState$: of(null),
        isSignInWithEmailLink: () => false,
        googleLogin: vi.fn().mockResolvedValue({ user: { uid: '123' } }),
        githubLogin: vi.fn().mockResolvedValue({ user: { uid: '123' } }),
        fetchSignInMethods: vi.fn().mockResolvedValue([]),
        getProviderForId: vi.fn().mockReturnValue({}),
        linkCredential: vi.fn().mockResolvedValue({}),
        sendEmailLink: vi.fn().mockResolvedValue(true),
        linkWithPopup: vi.fn().mockResolvedValue({}),
        signInWithPopup: vi.fn().mockResolvedValue({ user: { uid: '123' } }), // Add missing method
        getRedirectResult: vi.fn().mockResolvedValue(null),
        localStorageService: {
            getItem: vi.fn().mockReturnValue(null),
            setItem: vi.fn(),
            removeItem: vi.fn()
        }
    };

    const mockUserService = {
        getUserByID: vi.fn().mockReturnValue(of({ displayName: 'Test User' }))
    };

    const mockRouter = {
        navigate: vi.fn()
    };

    const mockSnackBar = {
        open: vi.fn()
    };

    // Mock dependencies for inject()
    const mockAuth = {};
    const mockAnalytics = null;

    const mockDialog = {};

    beforeEach(() => {
        vi.clearAllMocks(); // Clear spies to prevent accumulation
        TestBed.configureTestingModule({
            providers: [
                LoginComponent, // Provide the component itself
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppEventService, useValue: {} },
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

        // 3. Mock dialog to return 'google.com'
        const mockDialogRef = {
            afterClosed: () => of('google.com')
        };
        (mockDialog as any).open = vi.fn().mockReturnValue(mockDialogRef);

        // 4. Mock secondary signInWithPopup success
        const mockUser = { uid: '123' };
        (signInWithPopup as any).mockResolvedValue({ user: mockUser });

        // Trigger flow
        component.signInWithProvider(SignInProviders.GitHub);

        // We need to wait for the async handle error flow
        await new Promise(resolve => setTimeout(resolve, 0));

        // Emit user to allow navigation to proceed
        (mockAuthService.user$ as any).next({ uid: '123' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAuthService.fetchSignInMethods).toHaveBeenCalledWith('test@example.com');
        expect((mockDialog as any).open).toHaveBeenCalled();
        expect(mockAuthService.signInWithPopup).toHaveBeenCalled();
        expect(mockAuthService.linkCredential).toHaveBeenCalledWith(mockUser, expect.anything());
        expect(mockSnackBar.open).toHaveBeenCalledWith('Accounts successfully linked!', 'Close', expect.anything());
    });

    it('should handle account collision and select Email Link', async () => {
        const collisionError = {
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'test@example.com' }
        };

        (mockAuthService.githubLogin as any).mockRejectedValueOnce(collisionError);
        (mockAuthService as any).fetchSignInMethods = vi.fn().mockResolvedValue(['password']); // Password provider implies we can offer Email Link
        (mockAuthService as any).sendEmailLink = vi.fn().mockResolvedValue(true);
        (mockAuthService.localStorageService.setItem as any) = vi.fn();

        // Mock dialog to return 'emailLink'
        const mockDialogRef = {
            afterClosed: () => of('emailLink')
        };
        (mockDialog as any).open = vi.fn().mockReturnValue(mockDialogRef);

        component.signInWithProvider(SignInProviders.GitHub);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect((mockDialog as any).open).toHaveBeenCalled();
        expect(mockAuthService.sendEmailLink).toHaveBeenCalledWith('test@example.com');
        // Check if persist was called. The mock collision error creates a credential.
        expect(mockAuthService.localStorageService.setItem).toHaveBeenCalledWith('pendingLinkProvider', 'github.com');
    });

    it('should handle pending link persistence in ngOnInit', async () => {
        // Mock email link sign in
        (mockAuthService as any).isSignInWithEmailLink = vi.fn().mockReturnValue(true);
        (mockAuthService.localStorageService.getItem as any) = vi.fn().mockImplementation((key) => {
            if (key === 'emailForSignIn') return 'test@example.com';
            if (key === 'pendingLinkProvider') return 'github.com';
            return null;
        });

        const mockUser = { uid: '456' };
        (mockAuthService as any).signInWithEmailLink = vi.fn().mockResolvedValue({ user: mockUser });
        (mockAuthService as any).linkWithPopup = vi.fn().mockResolvedValue({});

        // Mock window.confirm
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(confirmSpy).toHaveBeenCalled();
        expect(mockAuthService.linkWithPopup).toHaveBeenCalledWith(mockUser, expect.anything());
    });

    // --- Extensive Testing Additions ---

    it('should show error dialog if fetchSignInMethods fails during collision', async () => {
        const collisionError = {
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'test@example.com' }
        };
        (mockAuthService.githubLogin as any).mockRejectedValueOnce(collisionError);
        (mockAuthService as any).fetchSignInMethods = vi.fn().mockRejectedValue(new Error('Network error'));

        component.signInWithProvider(SignInProviders.GitHub);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect((mockDialog as any).open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                title: 'Account Linking Failed',
                message: expect.stringContaining('Network error')
            })
        }));
    });

    it('should do nothing if linking dialog is cancelled', async () => {
        const collisionError = {
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'test@example.com' }
        };
        (mockAuthService.githubLogin as any).mockRejectedValueOnce(collisionError);
        (mockAuthService as any).fetchSignInMethods = vi.fn().mockResolvedValue(['google.com']);
        (mockAuthService as any).getProviderForId = vi.fn().mockReturnValue({});

        // Mock dialog cancelled (returns null/undefined)
        const mockDialogRef = {
            afterClosed: () => of(null)
        };
        (mockDialog as any).open = vi.fn().mockReturnValue(mockDialogRef);

        component.signInWithProvider(SignInProviders.GitHub);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAuthService.signInWithPopup).not.toHaveBeenCalled();
        expect(mockAuthService.linkCredential).not.toHaveBeenCalled();
    });

    it('should show error dialog if secondary provider login fails during linking', async () => {
        const collisionError = {
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'test@example.com' }
        };
        (mockAuthService.githubLogin as any).mockRejectedValueOnce(collisionError);
        (mockAuthService as any).fetchSignInMethods = vi.fn().mockResolvedValue(['google.com']);
        (mockAuthService as any).getProviderForId = vi.fn().mockReturnValue({});

        // Select Google
        const mockDialogRef = {
            afterClosed: () => of('google.com')
        };
        (mockDialog as any).open = vi.fn().mockReturnValue(mockDialogRef);

        // Secondary login fails (e.g. user closed popup)
        const popupError = { code: 'auth/popup-closed-by-user' };
        // Use spyOn or just assign the mock to the SERVICE method, not the imported function
        (mockAuthService as any).signInWithPopup = vi.fn().mockRejectedValue(popupError);

        component.signInWithProvider(SignInProviders.GitHub);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect((mockDialog as any).open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                message: 'The sign-in popup was closed before completing the process. Please try again.'
            })
        }));
    });

    it('should show error dialog if linkCredential fails', async () => {
        const collisionError = {
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'test@example.com' }
        };
        (mockAuthService.githubLogin as any).mockRejectedValueOnce(collisionError);
        (mockAuthService as any).fetchSignInMethods = vi.fn().mockResolvedValue(['google.com']);
        (mockAuthService as any).getProviderForId = vi.fn().mockReturnValue({});

        const mockDialogRef = { afterClosed: () => of('google.com') };
        (mockDialog as any).open = vi.fn().mockReturnValue(mockDialogRef);

        // Ensure signInWithPopup succeeds on the service
        (mockAuthService as any).signInWithPopup = vi.fn().mockResolvedValue({ user: { uid: '123' } });

        // Link fails
        (mockAuthService as any).linkCredential = vi.fn().mockRejectedValue({ code: 'auth/credential-already-in-use' });

        component.signInWithProvider(SignInProviders.GitHub);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect((mockDialog as any).open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                title: 'Account Linking Failed',
                message: 'This account is already linked to another user. Please sign in with the original account.'
            })
        }));
    });

    it('should handle pending link failure (reverse flow)', async () => {
        (mockAuthService as any).isSignInWithEmailLink = vi.fn().mockReturnValue(true);
        (mockAuthService.localStorageService.getItem as any) = vi.fn().mockImplementation((key) => {
            if (key === 'emailForSignIn') return 'test@example.com';
            if (key === 'pendingLinkProvider') return 'github.com';
            return null;
        });

        const mockUser = { uid: '456' };
        (mockAuthService as any).signInWithEmailLink = vi.fn().mockResolvedValue({ user: mockUser });

        // User says OK to link
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        // Link fails
        (mockAuthService as any).linkWithPopup = vi.fn().mockRejectedValue(new Error('Link error'));

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect((mockDialog as any).open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                title: 'Account Linking Failed',
                message: expect.stringContaining('Link error')
            })
        }));
    });

    it('should handle successful redirect result on init', async () => {
        const mockRedirectResult = { user: { uid: 'redirect-user' }, credential: { signInMethod: 'google.com' } };
        (mockAuthService.getRedirectResult as any).mockResolvedValue(mockRedirectResult);
        (mockUserService.getUserByID as any).mockReturnValue(of({ displayName: 'Redirect User' }));

        component.ngOnInit(); // Do not await ngOnInit directly if it returns void/promise we don't control fully? Actually it is async.
        // But we want to trigger emission.

        await new Promise(resolve => setTimeout(resolve, 0));
        (mockAuthService.user$ as any).next({ uid: 'redirect-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAuthService.getRedirectResult).toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should handle failed redirect result on init', async () => {
        const redirectError = { code: 'auth/network-request-failed', message: 'Network error' };
        (mockAuthService.getRedirectResult as any).mockRejectedValue(redirectError);
        (mockDialog as any).open = vi.fn();

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAuthService.getRedirectResult).toHaveBeenCalled();
        expect((mockDialog as any).open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                title: 'Login Failed',
                message: expect.stringContaining('Network connection failed')
            })
        }));
    });

    it('should handle account collision from redirect result', async () => {
        const collisionError = {
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'conflict@example.com' }
        };
        (mockAuthService.getRedirectResult as any).mockRejectedValue(collisionError);
        (mockAuthService.fetchSignInMethods as any).mockResolvedValue(['google.com']);

        const mockDialogRef = {
            afterClosed: () => of(null) // Cancel linking for this test
        };
        (mockDialog as any).open = vi.fn().mockReturnValue(mockDialogRef);

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 10)); // Allow more time for nested promises

        expect(mockAuthService.fetchSignInMethods).toHaveBeenCalledWith('conflict@example.com');
        expect((mockDialog as any).open).toHaveBeenCalled();
    });
});
