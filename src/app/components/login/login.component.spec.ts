import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { LoginComponent, SignInProviders } from './login.component';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { AppEventService } from '../../services/app.event.service';
import { LoggerService } from '../../services/logger.service';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Auth } from 'app/firebase/auth';
import { Analytics } from 'app/firebase/analytics';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { of, throwError, BehaviorSubject, map, NEVER } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EMAIL_LINK_RETURN_URL_STORAGE_KEY } from '../../authentication/auth-redirect-url';
import { APP_STORAGE } from '../../services/storage/app.storage.token';
import { MemoryStorage } from '../../services/storage/memory.storage';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock Firebase Auth functions
vi.mock('app/firebase/auth', async () => {
    const actual = await vi.importActual('app/firebase/auth');
    return {
        ...actual as any,
        signInWithPopup: vi.fn(),
        authState: () => of(null), // Mock authState to return null by default
        OAuthProvider: {
            credentialFromError: vi.fn().mockReturnValue({ providerId: 'github.com' })
        }
    };
});

import { signInWithPopup, OAuthProvider, authState } from 'app/firebase/auth';

describe('LoginComponent', () => {
    let component: LoginComponent;

    let mockAuthService: any;
    let activatedRouteSnapshot: { queryParamMap: ReturnType<typeof convertToParamMap> };

    const profileReadStateSubject = new BehaviorSubject<any>({ status: 'signed-out' });
    const mockUserService = {
        getUserByID: vi.fn().mockReturnValue(of({ displayName: 'Test User' })),
        hasIncompleteProfileReads: vi.fn().mockReturnValue(false),
        isProfileReadBlocking: signal(false),
        hasActionableProfileReadFailure: signal(false),
        profileReadState: signal<any>({ status: 'signed-out' }),
        profileReadState$: profileReadStateSubject.asObservable(),
    };

    const mockRouter = {
        navigate: vi.fn(),
        navigateByUrl: vi.fn()
    };

    const mockSnackBar = {
        open: vi.fn()
    };

    // Mock dependencies for inject()
    const mockAuth = {};
    const mockAnalytics = null;

    const mockDialog = {};
    const mockLogger = {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        captureException: vi.fn(),
        captureMessage: vi.fn(),
        setUser: vi.fn(),
        setTag: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks(); // Clear spies to prevent accumulation
        mockUserService.hasIncompleteProfileReads.mockReturnValue(false);
        mockUserService.isProfileReadBlocking.set(false);
        mockUserService.hasActionableProfileReadFailure.set(false);
        mockUserService.profileReadState.set({ status: 'signed-out' });
        profileReadStateSubject.next({ status: 'signed-out' });
        (mockRouter.navigate as any).mockResolvedValue(true);
        (mockRouter.navigateByUrl as any).mockResolvedValue(true);
        activatedRouteSnapshot = { queryParamMap: convertToParamMap({}) };

        const userSubject = new BehaviorSubject<any>(null);
        mockAuthService = {
            user$: userSubject,
            authState$: userSubject.pipe(map((appUser) => appUser ? { uid: appUser.uid } : null)),
            redirectUrl: null,
            isSignInWithEmailLink: () => false,
            googleLogin: vi.fn().mockResolvedValue({ user: { uid: '123' } }),
            githubLogin: vi.fn().mockResolvedValue({ user: { uid: '123' } }),
            fetchSignInMethods: vi.fn().mockResolvedValue([]),
            getProviderForId: vi.fn().mockReturnValue({}),
            linkCredential: vi.fn().mockResolvedValue({}),
            sendEmailLink: vi.fn().mockResolvedValue(true),
            linkWithPopup: vi.fn().mockResolvedValue({}),
            signInWithPopup: vi.fn().mockResolvedValue({ user: { uid: '123' } }),
            getRedirectResult: vi.fn().mockResolvedValue(null),
            signOut: vi.fn().mockResolvedValue(undefined),
            localStorageService: {
                getItem: vi.fn().mockReturnValue(null),
                setItem: vi.fn(),
                removeItem: vi.fn()
            }
        };

        TestBed.configureTestingModule({
            providers: [
                LoginComponent, // Provide the component itself
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: AppEventService, useValue: {} },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: { snapshot: activatedRouteSnapshot } },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: MatDialog, useValue: mockDialog },
                { provide: LoggerService, useValue: mockLogger },
                { provide: Auth, useValue: mockAuth },
                { provide: Analytics, useValue: mockAnalytics },
                { provide: APP_STORAGE, useClass: MemoryStorage },
            ],
            schemas: [NO_ERRORS_SCHEMA]
        });

        // Injecting the component like a service handles inject() calls correctly
        component = TestBed.inject(LoginComponent);
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render a recovery action instead of an endless loading state for terminal profile errors', () => {
        const template = readFileSync(
            resolve(process.cwd(), 'src/app/components/login/login.component.html'),
            'utf8'
        );

        expect(template).toContain('!userService.hasActionableProfileReadFailure()');
        expect(template).toContain('data-testid="profile-read-error"');
        expect(template).toContain('Sign out and try again');
        expect(template).toContain('(click)="recoverFromProfileReadError()"');
        expect(template).toContain('[disabled]="isProfileRecoveryInProgress"');
        expect(template).not.toContain('(click)="recoverFromProfileReadError()" [disabled]="isLoading"');
        expect(template).toContain("We can't reach your account data");
    });

    it('should sign out to recover from a terminal profile read error', async () => {
        await component.recoverFromProfileReadError();

        expect(mockAuthService.signOut).toHaveBeenCalledTimes(1);
        expect(component.isLoading).toBe(true);
        expect(component.isProfileRecoveryInProgress).toBe(true);
    });

    it('should keep the recovery action available when profile loading fails during login', async () => {
        mockAuthService.authState$ = of({ uid: '123' });
        mockAuthService.user$ = NEVER;

        const loginCompletion = (component as any).redirectOrShowDataPrivacyDialog({
            user: { uid: '123' },
            credential: { signInMethod: 'google.com' },
        });
        await Promise.resolve();

        expect(component.isLoading).toBe(true);
        profileReadStateSubject.next({
            status: 'recovering',
            uid: '123',
            attempt: 4,
            code: 'permission-denied',
        });

        await loginCompletion;

        expect(component.isLoading).toBe(false);
        expect(component.isProfileRecoveryInProgress).toBe(false);
        expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });

    it('should re-enable profile recovery when sign-out fails', async () => {
        mockAuthService.signOut.mockRejectedValueOnce(new Error('sign-out failed'));

        await component.recoverFromProfileReadError();

        expect(component.isLoading).toBe(false);
        expect(component.isProfileRecoveryInProgress).toBe(false);
        expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should stop waiting when Firebase signs out during post-login profile loading', async () => {
        const firebaseAuthState$ = new BehaviorSubject<any>({ uid: '123' });
        mockAuthService.authState$ = firebaseAuthState$;
        mockAuthService.user$ = NEVER;
        profileReadStateSubject.next({ status: 'loading', uid: '123' });

        const loginCompletion = (component as any).redirectOrShowDataPrivacyDialog({
            user: { uid: '123' },
        });
        firebaseAuthState$.next(null);

        await loginCompletion;

        expect(component.isLoading).toBe(false);
        expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });

    it('should stop waiting when the authenticated account changes during post-login profile loading', async () => {
        const firebaseAuthState$ = new BehaviorSubject<any>({ uid: '123' });
        mockAuthService.authState$ = firebaseAuthState$;
        mockAuthService.user$ = NEVER;
        profileReadStateSubject.next({ status: 'loading', uid: '123' });

        const loginCompletion = (component as any).redirectOrShowDataPrivacyDialog({
            user: { uid: '123' },
        });
        firebaseAuthState$.next({ uid: 'different-user' });

        await loginCompletion;

        expect(component.isLoading).toBe(false);
        expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });

    it('should consume the service recovery signal instead of a template method', () => {
        mockUserService.hasActionableProfileReadFailure.set(true);

        expect(mockUserService.hasActionableProfileReadFailure()).toBe(true);
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
        expect(mockAuthService.sendEmailLink).toHaveBeenCalledWith('test@example.com', null);
        // Check if persist was called. The mock collision error creates a credential.
        expect(mockAuthService.localStorageService.setItem).toHaveBeenCalledWith('pendingLinkProvider', 'github.com');
    });

    it('should pass a safe returnUrl query parameter when sending an email link', async () => {
        activatedRouteSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/tools/compare' });

        await component.sendEmailLink('test@example.com');

        expect(mockAuthService.sendEmailLink).toHaveBeenCalledWith('test@example.com', '/tools/compare');
    });

    it('should not fall back to a stale service redirect when email link returnUrl query parameter is unsafe', async () => {
        mockAuthService.redirectUrl = '/tools/compare/saved';
        activatedRouteSnapshot.queryParamMap = convertToParamMap({ returnUrl: '//evil.example/path' });

        await component.sendEmailLink('test@example.com');

        expect(mockAuthService.sendEmailLink).toHaveBeenCalledWith('test@example.com', null);
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

    it('should retry an email-link sign-in with the matching email without logging an expected error', async () => {
        mockAuthService.isSignInWithEmailLink = vi.fn().mockReturnValue(true);
        mockAuthService.localStorageService.getItem = vi.fn().mockImplementation((key) => {
            if (key === 'emailForSignIn') return 'wrong@example.com';
            return null;
        });
        mockAuthService.signInWithEmailLink = vi.fn()
            .mockRejectedValueOnce({ code: 'auth/invalid-email' })
            .mockResolvedValueOnce({ user: { uid: 'email-link-user' } });
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('matching@example.com');

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAuthService.localStorageService.removeItem).toHaveBeenCalledWith('emailForSignIn');
        expect(promptSpy).toHaveBeenCalledWith(
            'This magic link was sent to a different email address. Enter the email address that received it to continue.'
        );
        expect(mockAuthService.signInWithEmailLink).toHaveBeenNthCalledWith(1, 'wrong@example.com', window.location.href);
        expect(mockAuthService.signInWithEmailLink).toHaveBeenNthCalledWith(2, 'matching@example.com', window.location.href);
        expect(mockLogger.error).not.toHaveBeenCalled();

        promptSpy.mockRestore();
    });

    it('should show an expired magic-link message without reporting it to Sentry', async () => {
        mockAuthService.isSignInWithEmailLink = vi.fn().mockReturnValue(true);
        mockAuthService.localStorageService.getItem = vi.fn().mockReturnValue('test@example.com');
        mockAuthService.signInWithEmailLink = vi.fn().mockRejectedValue({
            code: 'auth/invalid-action-code',
            message: 'The action code is invalid or expired.',
        });

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Error signing in. The link might be invalid or expired.',
            'Close'
        );
    });

    it('should show a cancelled provider sign-in without reporting it to Sentry', async () => {
        mockAuthService.googleLogin = vi.fn().mockRejectedValue({
            code: 'auth/user-cancelled',
            message: 'The user cancelled sign-in.',
        });
        (mockDialog as any).open = vi.fn();

        component.signInWithProvider(SignInProviders.Google);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockLogger.error).not.toHaveBeenCalled();
        expect((mockDialog as any).open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({ title: 'Login Failed' })
        }));
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
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('should not navigate to dashboard until user$ emits after redirect result (race regression)', async () => {
        const mockRedirectResult = { user: { uid: 'redirect-user' }, credential: { signInMethod: 'google.com' } };
        (mockAuthService.getRedirectResult as any).mockResolvedValue(mockRedirectResult);

        // Keep auth user stream unresolved for one tick to simulate the race window.
        (mockAuthService.user$ as BehaviorSubject<any>).next(null);

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        // Before user$ emits, we should not have navigated yet.
        expect(mockRouter.navigateByUrl).not.toHaveBeenCalledWith('/dashboard');
        expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();

        // Once user$ is populated, navigation is allowed.
        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'redirect-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('should not navigate for a truthy user until profile reads are authoritative', async () => {
        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        mockUserService.hasIncompleteProfileReads.mockReturnValue(true);
        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'returning-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();

        mockUserService.hasIncompleteProfileReads.mockReturnValue(false);
        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'returning-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    });

    it('should not navigate from a replayed app user after Firebase has signed out', async () => {
        mockAuthService.authState$ = of(null);
        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'stale-user' });

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });

    it('should wait for the app user matching the current Firebase account', async () => {
        const firebaseUsers$ = new BehaviorSubject<any>({ uid: 'current-user' });
        const appUsers$ = new BehaviorSubject<any>({ uid: 'previous-user' });
        mockAuthService.authState$ = firebaseUsers$;
        mockAuthService.user$ = appUsers$;

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();

        appUsers$.next({ uid: 'current-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    });

    it('should avoid duplicate dashboard navigation when user subscription and redirect flow resolve together', async () => {
        const mockRedirectResult = { user: { uid: 'redirect-user' }, credential: { signInMethod: 'google.com' } };
        (mockAuthService.getRedirectResult as any).mockResolvedValue(mockRedirectResult);

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        // Emit the user multiple times, similar to auth stream + claim refresh emissions.
        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'redirect-user' });
        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'redirect-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    });

    it('should return to a safe local returnUrl query parameter after login', async () => {
        activatedRouteSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/tools/compare' });

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'return-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tools/compare');
        expect(mockAuthService.redirectUrl).toBeNull();
    });

    it('should prefer the returnUrl query parameter over a stale auth service redirect', async () => {
        mockAuthService.redirectUrl = '/tools/compare/saved';
        activatedRouteSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/subscriptions' });

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'redirect-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/subscriptions');
        expect(mockAuthService.redirectUrl).toBeNull();
    });

    it('should use the auth service redirect when no returnUrl query parameter exists', async () => {
        mockAuthService.redirectUrl = '/tools/compare/saved';

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'guard-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tools/compare/saved');
        expect(mockAuthService.redirectUrl).toBeNull();
    });

    it('should use the cached email-link return URL after the magic-link reload', async () => {
        mockAuthService.isSignInWithEmailLink = vi.fn().mockReturnValue(true);
        mockAuthService.localStorageService.getItem = vi.fn().mockImplementation((key) => {
            if (key === 'emailForSignIn') return 'test@example.com';
            if (key === EMAIL_LINK_RETURN_URL_STORAGE_KEY) return '/tools/compare';
            return null;
        });
        mockAuthService.signInWithEmailLink = vi.fn().mockResolvedValue({ user: { uid: 'email-link-user' } });

        await component.ngOnInit();
        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'email-link-user' });
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAuthService.signInWithEmailLink).toHaveBeenCalledWith('test@example.com', window.location.href);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tools/compare');
        expect(mockAuthService.localStorageService.removeItem).toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY);
    });

    it('should clear cached email-link return URL when email confirmation is cancelled', async () => {
        mockAuthService.isSignInWithEmailLink = vi.fn().mockReturnValue(true);
        mockAuthService.localStorageService.getItem = vi.fn().mockImplementation((key) => {
            if (key === EMAIL_LINK_RETURN_URL_STORAGE_KEY) return '/tools/compare';
            return null;
        });
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('');

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'later-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(promptSpy).toHaveBeenCalled();
        expect(mockAuthService.localStorageService.removeItem).toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');

        promptSpy.mockRestore();
    });

    it('should clear cached email-link return URL when account-linking is cancelled during email-link completion', async () => {
        mockAuthService.isSignInWithEmailLink = vi.fn().mockReturnValue(true);
        mockAuthService.localStorageService.getItem = vi.fn().mockImplementation((key) => {
            if (key === 'emailForSignIn') return 'test@example.com';
            if (key === EMAIL_LINK_RETURN_URL_STORAGE_KEY) return '/tools/compare';
            return null;
        });
        mockAuthService.signInWithEmailLink = vi.fn().mockRejectedValue({
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'test@example.com' },
        });
        mockAuthService.fetchSignInMethods = vi.fn().mockResolvedValue(['google.com']);
        (mockDialog as any).open = vi.fn().mockReturnValue({ afterClosed: () => of(null) });

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 10));

        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'later-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAuthService.fetchSignInMethods).toHaveBeenCalledWith('test@example.com');
        expect(mockAuthService.localStorageService.removeItem).toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    });

    it('should preserve the active email-link return URL when sending a replacement magic link', async () => {
        mockAuthService.isSignInWithEmailLink = vi.fn().mockReturnValue(true);
        mockAuthService.localStorageService.getItem = vi.fn().mockImplementation((key) => {
            if (key === 'emailForSignIn') return 'test@example.com';
            if (key === EMAIL_LINK_RETURN_URL_STORAGE_KEY) return '/tools/compare';
            return null;
        });
        mockAuthService.signInWithEmailLink = vi.fn().mockRejectedValue({
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'test@example.com' },
        });
        mockAuthService.fetchSignInMethods = vi.fn().mockResolvedValue(['password']);
        (mockDialog as any).open = vi.fn().mockReturnValue({ afterClosed: () => of('emailLink') });

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockAuthService.sendEmailLink).toHaveBeenCalledWith('test@example.com', '/tools/compare');
    });

    it('should clear the active email-link return URL when replacement magic-link sending fails', async () => {
        mockAuthService.isSignInWithEmailLink = vi.fn().mockReturnValue(true);
        mockAuthService.localStorageService.getItem = vi.fn().mockImplementation((key) => {
            if (key === 'emailForSignIn') return 'test@example.com';
            if (key === EMAIL_LINK_RETURN_URL_STORAGE_KEY) return '/tools/compare';
            return null;
        });
        mockAuthService.signInWithEmailLink = vi.fn().mockRejectedValue({
            code: 'auth/account-exists-with-different-credential',
            customData: { email: 'test@example.com' },
        });
        mockAuthService.fetchSignInMethods = vi.fn().mockResolvedValue(['password']);
        mockAuthService.sendEmailLink = vi.fn().mockResolvedValue(false);
        (mockDialog as any).open = vi.fn().mockReturnValue({ afterClosed: () => of('emailLink') });

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockAuthService.sendEmailLink).toHaveBeenCalledWith('test@example.com', '/tools/compare');
        expect(mockAuthService.localStorageService.removeItem).toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY);
    });

    it('should ignore a cached email-link return URL when the current login is not an email-link sign-in', async () => {
        mockAuthService.localStorageService.getItem = vi.fn().mockImplementation((key) => {
            if (key === EMAIL_LINK_RETURN_URL_STORAGE_KEY) return '/tools/compare';
            return null;
        });

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'oauth-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    });

    it('should clear a stale email-link return URL before starting non-email provider login', () => {
        component.signInWithProvider(SignInProviders.Google);

        expect(mockAuthService.localStorageService.removeItem).toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY);
    });

    it('should ignore unsafe returnUrl values and fall back to dashboard', async () => {
        mockAuthService.redirectUrl = '/tools/compare/saved';
        activatedRouteSnapshot.queryParamMap = convertToParamMap({ returnUrl: '//evil.example/path' });

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'safe-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    });

    it('should ignore login returnUrl values and fall back to dashboard', async () => {
        activatedRouteSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/login?returnUrl=/tools/compare' });

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'loop-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    });

    it('should retry dashboard navigation after a rejected navigation attempt', async () => {
        const mockRedirectResult = { user: { uid: 'retry-user' }, credential: { signInMethod: 'google.com' } };
        (mockAuthService.getRedirectResult as any).mockResolvedValue(mockRedirectResult);
        (mockRouter.navigateByUrl as any)
            .mockRejectedValueOnce(new Error('guard failure'))
            .mockResolvedValueOnce(true);

        component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'retry-user' });
        await new Promise(resolve => setTimeout(resolve, 0));
        (mockAuthService.user$ as BehaviorSubject<any>).next({ uid: 'retry-user' });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockRouter.navigateByUrl).toHaveBeenCalledTimes(2);
        expect(mockRouter.navigateByUrl).toHaveBeenNthCalledWith(1, '/dashboard');
        expect(mockRouter.navigateByUrl).toHaveBeenNthCalledWith(2, '/dashboard');
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

    it('should treat invalid-session-id from redirect result as recoverable', async () => {
        const invalidSessionError = {
            code: 'auth/invalid-session-id',
            message: 'Firebase: verification failure: invalid session_id in request (auth/invalid-session-id).'
        };
        (mockAuthService.getRedirectResult as any).mockRejectedValue(invalidSessionError);
        (mockDialog as any).open = vi.fn();

        await component.ngOnInit();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockAuthService.getRedirectResult).toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalled();
        expect((mockDialog as any).open).not.toHaveBeenCalled();
        expect(mockSnackBar.open).toHaveBeenCalledWith(
            'Session expired, please sign in again.',
            'Close',
            expect.objectContaining({ duration: 5000 })
        );
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
