import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';

const {
    mockUserFunction,
    getMockEnvironmentLocalhost,
    setMockEnvironmentLocalhost,
    getDefaultMockEnvironmentLocalhost,
    setDefaultMockEnvironmentLocalhost,
    resetMockEnvironmentLocalhost
} = vi.hoisted(() => {
    let localhost = true;
    let defaultLocalhost = true;

    return {
        mockUserFunction: vi.fn(),
        getMockEnvironmentLocalhost: () => localhost,
        setMockEnvironmentLocalhost: (value: boolean) => {
            localhost = value;
        },
        getDefaultMockEnvironmentLocalhost: () => defaultLocalhost,
        setDefaultMockEnvironmentLocalhost: (value: boolean) => {
            defaultLocalhost = value;
            localhost = value;
        },
        resetMockEnvironmentLocalhost: () => {
            localhost = defaultLocalhost;
        }
    };
});

// Mock app/firebase/auth modular functions MUST be at the top level
vi.mock('app/firebase/auth', async () => {
    const actual = await vi.importActual('app/firebase/auth');
    return {
        ...actual,
        user: mockUserFunction,
        authState: vi.fn(() => of(null)),
        signInWithPopup: vi.fn(),
        signInWithRedirect: vi.fn(),
        signInWithCustomToken: vi.fn(),
        getRedirectResult: vi.fn(),
        sendSignInLinkToEmail: vi.fn(),
        signInWithEmailLink: vi.fn(),
        createUserWithEmailAndPassword: vi.fn(),
        signInWithEmailAndPassword: vi.fn(),
        sendPasswordResetEmail: vi.fn(),
        signOut: vi.fn(),
    };
});

vi.mock('app/firebase/firestore', async () => {
    const actual = await vi.importActual('app/firebase/firestore');
    return {
        ...actual,
        terminate: vi.fn(),
        clearIndexedDbPersistence: vi.fn(),
    };
});

vi.mock('../../environments/environment', async () => {
    const actual = await vi.importActual<typeof import('../../environments/environment')>('../../environments/environment');
    setDefaultMockEnvironmentLocalhost(actual.environment.localhost);

    return {
        ...actual,
        environment: {
            ...actual.environment,
            get localhost() {
                return getMockEnvironmentLocalhost();
            },
            set localhost(value: boolean) {
                setMockEnvironmentLocalhost(value);
            }
        }
    };
});

import { TestBed } from '@angular/core/testing';
import { AppAuthService } from './app.auth.service';
import { AppUserService } from '../services/app.user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import {
    Auth,
    FacebookAuthProvider,
    GithubAuthProvider,
    GoogleAuthProvider,
    TwitterAuthProvider,
    authState as fireAuthState,
    user as fireAuthUser
} from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { Analytics } from 'app/firebase/analytics';
import { EnvironmentInjector } from '@angular/core';
import { of, BehaviorSubject } from 'rxjs';
import { Privacy, ServiceNames } from '@sports-alliance/sports-lib';
import { APP_STORAGE } from '../services/storage/app.storage.token';
import { environment } from '../../environments/environment';
import { EMAIL_LINK_RETURN_URL_STORAGE_KEY } from './auth-redirect-url';
import { AppWindowService } from '../services/app.window.service';
import { DAILY_WORKOUT_SUGGESTION_SESSION_CACHE_KEY } from '../shared/daily-workout-suggestion-cache';
import { HistoryImportProgressService } from '../services/history-import-progress.service';
import { HISTORY_IMPORT_PROVIDERS } from '../helpers/history-import-progress.helper';
import { MemoryStorage } from '../services/storage/memory.storage';

import { signal } from '@angular/core';

const defaultMockAuthDomain = environment.firebase.authDomain;

// Mock dependencies
const mockAuth = {
    currentUser: null
};

const mockFirestore = {};
const mockAnalytics = {};

const mockUserService = {
    user$: new BehaviorSubject<any>(null),
    profileReadState$: new BehaviorSubject<any>({ status: 'signed-out' }),
    fillMissingAppSettings: (settings: any) => settings,
    getUserByID: vi.fn(),
    getUserMetaForService: vi.fn(),
    isPro: vi.fn(),
    hasIncompleteProfileReads: vi.fn().mockReturnValue(false),
    hasPaidAccessSignal: signal(true)
};

const mockSnackBar = {
    open: vi.fn()
};

const mockLocalStorageService = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clearAllStorage: vi.fn()
};
const mockSessionStorage = { removeItem: vi.fn() };


describe('AppAuthService', () => {
    let service: AppAuthService;
    let userSubject: BehaviorSubject<any>;
    let authStateSubject: BehaviorSubject<any>;
    let storage: MemoryStorage;

    beforeEach(() => {
        vi.clearAllMocks();
        mockAuth.currentUser = null;
        userSubject = new BehaviorSubject<any>(null);
        authStateSubject = new BehaviorSubject<any>(null);
        mockUserFunction.mockReturnValue(userSubject);
        (fireAuthState as Mock).mockReturnValue(authStateSubject);
        mockUserService.user$.next(null); // Reset
        mockUserService.profileReadState$.next({ status: 'signed-out' });
        mockUserService.hasIncompleteProfileReads.mockReturnValue(false);
        mockUserService.hasPaidAccessSignal.set(true); // Default to pro for these tests unless specified
        mockUserService.getUserMetaForService.mockReset().mockReturnValue(of(undefined));
        storage = new MemoryStorage();

        TestBed.configureTestingModule({
            providers: [
                AppAuthService,
                { provide: Auth, useValue: mockAuth },
                { provide: Firestore, useValue: mockFirestore },
                { provide: Analytics, useValue: null },
                { provide: AppUserService, useValue: mockUserService },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: LocalStorageService, useValue: mockLocalStorageService },
                { provide: APP_STORAGE, useValue: storage },
                { provide: AppWindowService, useValue: { windowRef: { sessionStorage: mockSessionStorage } } },
            ]
        });
        service = TestBed.inject(AppAuthService);
    });

    afterEach(() => {
        resetMockEnvironmentLocalhost();
        environment.firebase.authDomain = defaultMockAuthDomain;
        expect(getMockEnvironmentLocalhost()).toBe(getDefaultMockEnvironmentLocalhost());
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('getUser should return the matching authoritative profile', async () => {
        const firebaseUser = { uid: 'current-user' };
        const appUser = { uid: 'current-user', displayName: 'Current User' };
        mockAuth.currentUser = firebaseUser;
        mockUserService.profileReadState$.next({
            status: 'ready',
            uid: firebaseUser.uid,
            profileExists: true,
        });
        mockUserService.user$.next(appUser);
        authStateSubject.next(firebaseUser);

        await expect(service.getUser()).resolves.toBe(appUser);
    });

    it('getUser should resolve null when profile recovery becomes actionable', async () => {
        const firebaseUser = { uid: 'current-user' };
        mockAuth.currentUser = firebaseUser;
        mockUserService.hasIncompleteProfileReads.mockReturnValue(true);
        authStateSubject.next(firebaseUser);
        mockUserService.profileReadState$.next({ status: 'loading', uid: firebaseUser.uid });

        const userPromise = service.getUser();
        mockUserService.profileReadState$.next({
            status: 'recovering',
            uid: firebaseUser.uid,
            attempt: 4,
            code: 'permission-denied',
        });

        await expect(userPromise).resolves.toBeNull();
    });

    it('getUser should ignore a replayed app profile after Firebase sign-out', async () => {
        mockUserService.user$.next({ uid: 'stale-user' });
        authStateSubject.next(null);

        await expect(service.getUser()).resolves.toBeNull();
    });

    it('signOut should clear storage, purge Firestore persistence, and redirect', async () => {
        const redirectSpy = vi.spyOn(service as any, 'redirectToLogin').mockImplementation(() => { });
        const { signOut } = await import('app/firebase/auth');
        const { terminate, clearIndexedDbPersistence } = await import('app/firebase/firestore');

        await service.signOut();

        expect(signOut).toHaveBeenCalledWith(mockAuth);
        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(DAILY_WORKOUT_SUGGESTION_SESSION_CACHE_KEY);
        expect(terminate).toHaveBeenCalledWith(mockFirestore);
        expect(mockLocalStorageService.clearAllStorage).toHaveBeenCalled();
        expect(clearIndexedDbPersistence).toHaveBeenCalledWith(mockFirestore);
        expect(redirectSpy).toHaveBeenCalled();
    });

    it('finishes sign-out even if private session cache cleanup is blocked', async () => {
        const redirectSpy = vi.spyOn(service as any, 'redirectToLogin').mockImplementation(() => { });
        const { clearIndexedDbPersistence } = await import('app/firebase/firestore');
        mockSessionStorage.removeItem.mockImplementationOnce(() => { throw Error('Storage blocked'); });
        await service.signOut();
        expect(mockLocalStorageService.clearAllStorage).toHaveBeenCalled();
        expect(clearIndexedDbPersistence).toHaveBeenCalledWith(mockFirestore);
        expect(redirectSpy).toHaveBeenCalled();
    });

    it.each(HISTORY_IMPORT_PROVIDERS)('keeps dismissed %s results hidden after actual logout, service recreation and login', async serviceName => {
        const projection = {runId: 'finished-run', rangePreset: '30_days', active: false, updatedAtMs: Date.now(),
            steps: [{id: 'activities', resources: ['activities'], status: 'failed', count: 7}]};
        const metadata = new BehaviorSubject({connectionState: 'connected', connectionHistoryImport: projection});
        mockUserService.getUserMetaForService.mockImplementation((_user, provider) => provider === serviceName ? metadata : of(undefined));
        const login = (uid: string) => {
            mockAuth.currentUser = {uid}; authStateSubject.next(mockAuth.currentUser); mockUserService.user$.next({uid});
        };
        login('account-a');
        const progress = TestBed.inject(HistoryImportProgressService);
        expect(progress.dismissResult(progress.view().items[0], progress.owner())).toBe(true);
        storage.setItem('private-activity-cache', 'private-data');
        vi.spyOn(service as any, 'redirectToLogin').mockImplementation(() => {});
        mockLocalStorageService.clearAllStorage.mockImplementationOnce(() => storage.clear());
        const {signOut} = await import('app/firebase/auth');
        vi.mocked(signOut).mockImplementationOnce(async () => {
            mockAuth.currentUser = null; authStateSubject.next(null); mockUserService.user$.next(null);
        });

        await service.signOut();
        expect(storage.getItem('private-activity-cache')).toBeNull();
        expect(progress.view().items).toEqual([]);
        // Drop the in-memory dismissal, as redirecting to Login and reloading does.
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({providers: [
            {provide: Auth, useValue: mockAuth}, {provide: AppUserService, useValue: mockUserService},
            {provide: APP_STORAGE, useValue: storage},
        ]});
        const restored = TestBed.inject(HistoryImportProgressService);
        login('account-b'); expect(restored.view().items).toHaveLength(1);
        login('account-a'); expect(restored.view().items).toEqual([]);
        expect(restored.latestImports()).toHaveLength(1);
        metadata.next({connectionState: 'connected', connectionHistoryImport: {...projection, runId: 'new-run'}});
        expect(restored.view().items[0].runId).toBe('new-run');
    });

    it('preserves only valid history dismissal fields while purging unrelated browser data on logout', async () => {
        const receipt = {serviceName: ServiceNames.SuuntoApp, runId: 'run', updatedAtMs: Date.now()};
        const key = 'history-import.dismissed-result.v1.other-account.Suunto%20app';
        storage.setItem(key, JSON.stringify({...receipt, privateData: 'must-be-purged'}));
        storage.setItem('history-import.dismissed-result.v1.broken.Suunto%20app', '{invalid');
        storage.setItem('history-import.dismissed-result.v1.mismatch.COROS%20API', JSON.stringify(receipt));
        storage.setItem('private-cache', 'must-be-purged');
        vi.spyOn(service as any, 'redirectToLogin').mockImplementation(() => {});
        mockLocalStorageService.clearAllStorage.mockImplementationOnce(() => storage.clear());
        await service.signOut();
        expect(storage.length).toBe(1);
        expect(JSON.parse(storage.getItem(key)!)).toEqual(receipt);
    });

    it.each(['getItem', 'setItem'] as const)('still clears private data and finishes logout when preference %s is blocked', async operation => {
        const key = 'history-import.dismissed-result.v1.account-a.Suunto%20app';
        storage.setItem(key, JSON.stringify({serviceName: ServiceNames.SuuntoApp, runId: 'run', updatedAtMs: Date.now()}));
        storage.setItem('private-cache', 'private-data');
        vi.spyOn(storage, operation).mockImplementation(() => { throw Error('Storage blocked'); });
        const redirect = vi.spyOn(service as any, 'redirectToLogin').mockImplementation(() => {});
        mockLocalStorageService.clearAllStorage.mockImplementationOnce(() => storage.clear());
        await expect(service.signOut()).resolves.toBeUndefined();
        expect(mockLocalStorageService.clearAllStorage).toHaveBeenCalledOnce();
        expect(storage.keys()).not.toContain('private-cache');
        expect(redirect).toHaveBeenCalledOnce();
    });

    it('githubLogin should call signInWithProvider with GithubAuthProvider', async () => {
        // We need to spy on the private method or the public one that calls it.
        // Since signInWithProvider is private, we cast to any.
        // In Vitest, safe way is vi.spyOn
        const signInSpy = vi.spyOn(service as any, 'signInWithProvider').mockResolvedValue({});

        await service.githubLogin();

        expect(signInSpy).toHaveBeenCalled();
        const args = signInSpy.mock.calls[0];
        expect(args[0]).toBeInstanceOf(GithubAuthProvider);
    });

    it('should create a synthetic user with default Private privacy when user is not in DB', async () => {
        const mockFirebaseUser = {
            uid: 'new-uid',
            email: 'new@example.com',
            displayName: 'New User',
            photoURL: 'photo-url',
            emailVerified: true,
            metadata: {
                creationTime: new Date().toISOString(),
                lastSignInTime: new Date().toISOString(),
            },
            getIdTokenResult: vi.fn().mockResolvedValue({
                claims: {},
            }),
        };

        (mockUserService.getUserByID as Mock).mockReturnValue(of(null));

        const userPromise = new Promise<any>((resolve) => {
            const sub = service.user$.subscribe((u) => {
                if (u && u.uid === 'new-uid') {
                    sub.unsubscribe();
                    resolve(u);
                }
            });
        });

        // Since AppAuthService now delegates to AppUserService.user$, we mock the delegation
        mockUserService.user$.next({
            ...mockFirebaseUser,
            privacy: Privacy.Private,
            acceptedPrivacyPolicy: false
        });

        const user = await userPromise;

        expect(user.privacy).toBe(Privacy.Private);
        expect(user.acceptedPrivacyPolicy).toBe(false);
    });


    it('should refresh token if claimsUpdatedAt is newer than iat', async () => {
        const iat = Math.floor(Date.now() / 1000); // iat in seconds
        const newerTime = new Date((iat + 50) * 1000); // 50 seconds later

        const mockFirebaseUser = {
            uid: 'existing-uid',
            getIdTokenResult: vi.fn(),
            getIdToken: vi.fn(),
        };

        // First call return old token with iat
        mockFirebaseUser.getIdTokenResult.mockResolvedValueOnce({
            claims: {
                iat: iat,
                stripeRole: 'basic'
            }
        });

        // Second call (after refresh) returns new token with updated role
        mockFirebaseUser.getIdTokenResult.mockResolvedValueOnce({
            claims: {
                iat: iat + 60, // newer iat after refresh
                stripeRole: 'pro'
            }
        });

        const mockDbUser = {
            uid: 'existing-uid',
            claimsUpdatedAt: {
                // Firestore Timestamp-like object - newer than iat
                seconds: iat + 50,
                nanoseconds: 0,
                toDate: () => newerTime
            },
            stripeRole: 'basic' // DB has old role initially on object, but logic should update it
        };

        (mockUserService.getUserByID as Mock).mockReturnValue(of(mockDbUser));

        const userPromise = new Promise<any>((resolve) => {
            const sub = service.user$.subscribe((u) => {
                if (u && u.uid === 'existing-uid' && (u as any).stripeRole === 'pro') {
                    sub.unsubscribe();
                    resolve(u);
                }
            });
        });

        // Simulate AppUserService processing the user and updating its user$ stream
        mockUserService.user$.next({
            ...mockFirebaseUser,
            ...mockDbUser,
            stripeRole: 'pro'
        });

        const updatedUser = await userPromise;

        expect(updatedUser.stripeRole).toBe('pro');
    });

    describe('signInWithProvider branching logic', () => {
        it('should use signInWithPopup on localhost', async () => {
            const { signInWithPopup, signInWithRedirect } = await import('app/firebase/auth');
            const provider = new GoogleAuthProvider();
            const popupResult = { user: { uid: 'popup-user' } };
            setMockEnvironmentLocalhost(true);
            (signInWithPopup as Mock).mockResolvedValueOnce(popupResult as any);

            const result = await service.signInWithProvider(provider);

            expect(signInWithPopup).toHaveBeenCalledWith(mockAuth, provider);
            expect(signInWithRedirect).not.toHaveBeenCalled();
            expect(result).toEqual(popupResult);
        });

        it('should use signInWithRedirect on non-localhost', async () => {
            const { signInWithPopup, signInWithRedirect } = await import('app/firebase/auth');
            const provider = new GoogleAuthProvider();
            const redirectResult = { redirected: true };
            setMockEnvironmentLocalhost(false);
            (signInWithRedirect as Mock).mockResolvedValueOnce(redirectResult as any);

            const result = await service.signInWithProvider(provider);

            expect(signInWithRedirect).toHaveBeenCalledWith(mockAuth, provider);
            expect(signInWithPopup).not.toHaveBeenCalled();
            expect(result).toEqual(redirectResult);
        });

        it('should rethrow provider sign-in failures for the login flow to report', async () => {
            const { signInWithPopup } = await import('app/firebase/auth');
            const provider = new GoogleAuthProvider();
            const authError = { code: 'auth/popup-blocked', message: 'Popup blocked by browser' };
            const loggerErrorSpy = vi.spyOn((service as any).logger, 'error').mockImplementation(() => { });
            setMockEnvironmentLocalhost(true);
            (signInWithPopup as Mock).mockRejectedValueOnce(authError);

            await expect(service.signInWithProvider(provider)).rejects.toBe(authError);

            expect(loggerErrorSpy).not.toHaveBeenCalled();
        });
    });

    describe('email link auth', () => {
        it('keeps demo billing email links on the current local HTTP origin and port', async () => {
            const previous = environment.firebase.projectId;
            environment.firebase.projectId = 'demo-stripe-billing';
            try {
                const { sendSignInLinkToEmail } = await import('app/firebase/auth');
                await service.sendEmailLink('synthetic@example.com', '/payment/success');
                expect(sendSignInLinkToEmail).toHaveBeenCalledWith(mockAuth, 'synthetic@example.com', expect.objectContaining({
                    url: `${window.location.origin}/login?returnUrl=%2Fpayment%2Fsuccess`, handleCodeInApp: true,
                }));
            } finally { environment.firebase.projectId = previous; }
        });

        it('sendEmailLink should persist email and show success snackbar', async () => {
            const { sendSignInLinkToEmail } = await import('app/firebase/auth');
            const email = 'test@example.com';
            (sendSignInLinkToEmail as Mock).mockResolvedValueOnce(undefined);

            const result = await service.sendEmailLink(email);

            expect(result).toBe(true);
            expect(sendSignInLinkToEmail).toHaveBeenCalledWith(
                mockAuth,
                email,
                expect.objectContaining({
                    url: `${environment.appUrl}/login`,
                    handleCodeInApp: true,
                })
            );
            expect(mockLocalStorageService.setItem).toHaveBeenCalledWith('emailForSignIn', email);
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                `Magic link sent to ${email} `,
                'Close',
                { duration: 5000 }
            );
        });

        it('sendEmailLink should encode and persist a safe local return URL', async () => {
            const { sendSignInLinkToEmail } = await import('app/firebase/auth');
            const email = 'tool@example.com';
            (sendSignInLinkToEmail as Mock).mockResolvedValueOnce(undefined);

            const result = await service.sendEmailLink(email, '/tools/compare/saved');

            expect(result).toBe(true);
            expect(sendSignInLinkToEmail).toHaveBeenCalledWith(
                mockAuth,
                email,
                expect.objectContaining({
                    url: `${environment.appUrl}/login?returnUrl=%2Ftools%2Fcompare%2Fsaved`,
                    handleCodeInApp: true,
                })
            );
            expect(mockLocalStorageService.setItem).toHaveBeenCalledWith('emailForSignIn', email);
            expect(mockLocalStorageService.setItem).toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY, '/tools/compare/saved');
        });

        it('keeps the selected membership price through an email sign-in link', async () => {
            const { sendSignInLinkToEmail } = await import('app/firebase/auth');
            const returnUrl = '/subscriptions?priceId=price_pro_yearly';

            await service.sendEmailLink('member@example.com', returnUrl);

            expect(sendSignInLinkToEmail).toHaveBeenCalledWith(mockAuth, 'member@example.com', expect.objectContaining({
                url: `${environment.appUrl}/login?returnUrl=%2Fsubscriptions%3FpriceId%3Dprice_pro_yearly`,
                handleCodeInApp: true,
            }));
            expect(mockLocalStorageService.setItem).toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY, returnUrl);
        });

        it('sendEmailLink should ignore unsafe return URLs and clear stale cached return URLs', async () => {
            const { sendSignInLinkToEmail } = await import('app/firebase/auth');
            const email = 'unsafe-return@example.com';
            (sendSignInLinkToEmail as Mock).mockResolvedValueOnce(undefined);

            const result = await service.sendEmailLink(email, '//evil.example/path');

            expect(result).toBe(true);
            expect(sendSignInLinkToEmail).toHaveBeenCalledWith(
                mockAuth,
                email,
                expect.objectContaining({
                    url: `${environment.appUrl}/login`,
                    handleCodeInApp: true,
                })
            );
            expect(mockLocalStorageService.removeItem).toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY);
        });

        it('sendEmailLink should return false and show error snackbar when send fails', async () => {
            const { sendSignInLinkToEmail } = await import('app/firebase/auth');
            const email = 'test@example.com';
            const authError = new Error('send failed');
            const loggerErrorSpy = vi.spyOn((service as any).logger, 'error').mockImplementation(() => { });
            (sendSignInLinkToEmail as Mock).mockRejectedValueOnce(authError);

            const result = await service.sendEmailLink(email);

            expect(result).toBe(false);
            expect(mockLocalStorageService.setItem).not.toHaveBeenCalled();
            expect(loggerErrorSpy).toHaveBeenCalledWith(authError);
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Could not login due to error send failed ',
                undefined,
                { duration: 2000 }
            );
        });

        it('sendEmailLink should include linkDomain outside localhost', async () => {
            const { sendSignInLinkToEmail } = await import('app/firebase/auth');
            const email = 'prod-like@example.com';
            setMockEnvironmentLocalhost(false);
            environment.firebase.authDomain = 'quantified-self.io';
            (sendSignInLinkToEmail as Mock).mockResolvedValueOnce(undefined);

            const result = await service.sendEmailLink(email);

            expect(result).toBe(true);
            expect(sendSignInLinkToEmail).toHaveBeenCalledWith(
                mockAuth,
                email,
                expect.objectContaining({
                    url: `${environment.appUrl}/login`,
                    handleCodeInApp: true,
                    linkDomain: environment.firebase.authDomain,
                })
            );
        });

        it('signInWithEmailLink should remove cached email after successful sign-in', async () => {
            const { signInWithEmailLink: signInWithEmailLinkFn } = await import('app/firebase/auth');
            const email = 'test@example.com';
            const link = 'https://quantified-self.io/login?mode=signIn&code=test';
            const authResult = { user: { uid: 'email-link-user' } };
            (signInWithEmailLinkFn as Mock).mockResolvedValueOnce(authResult as any);

            const result = await service.signInWithEmailLink(email, link);

            expect(result).toEqual(authResult);
            expect(signInWithEmailLinkFn).toHaveBeenCalledWith(mockAuth, email, link);
            expect(mockLocalStorageService.removeItem).toHaveBeenCalledWith('emailForSignIn');
        });

        it('signInWithEmailLink should let the login flow surface errors once', async () => {
            const { signInWithEmailLink: signInWithEmailLinkFn } = await import('app/firebase/auth');
            const email = 'test@example.com';
            const link = 'https://quantified-self.io/login?mode=signIn&code=test';
            const authError = new Error('invalid-action-code');
            const loggerErrorSpy = vi.spyOn((service as any).logger, 'error').mockImplementation(() => { });
            (signInWithEmailLinkFn as Mock).mockRejectedValueOnce(authError);

            await expect(service.signInWithEmailLink(email, link)).rejects.toBe(authError);

            expect(mockLocalStorageService.removeItem).toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY);
            expect(loggerErrorSpy).not.toHaveBeenCalled();
            expect(mockSnackBar.open).not.toHaveBeenCalled();
        });

        it('signInWithEmailLink should preserve cached return URL for account-linking failures', async () => {
            const { signInWithEmailLink: signInWithEmailLinkFn } = await import('app/firebase/auth');
            const email = 'test@example.com';
            const link = 'https://quantified-self.io/login?mode=signIn&code=test';
            const authError = {
                code: 'auth/account-exists-with-different-credential',
                message: 'Account exists with different credential',
            };
            vi.spyOn((service as any).logger, 'error').mockImplementation(() => { });
            (signInWithEmailLinkFn as Mock).mockRejectedValueOnce(authError);

            await expect(service.signInWithEmailLink(email, link)).rejects.toBe(authError);

            expect(mockLocalStorageService.removeItem).not.toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY);
        });

        it('signInWithEmailLink should not report an email that does not match the magic link', async () => {
            const { signInWithEmailLink: signInWithEmailLinkFn } = await import('app/firebase/auth');
            const authError = {
                code: 'auth/invalid-email',
                message: 'The email provided does not match the sign-in email address.',
            };
            const loggerErrorSpy = vi.spyOn((service as any).logger, 'error').mockImplementation(() => { });
            (signInWithEmailLinkFn as Mock).mockRejectedValueOnce(authError);

            await expect(service.signInWithEmailLink('wrong@example.com', 'https://quantified-self.io/login?mode=signIn&code=test'))
                .rejects.toBe(authError);

            expect(mockLocalStorageService.removeItem).not.toHaveBeenCalledWith(EMAIL_LINK_RETURN_URL_STORAGE_KEY);
            expect(loggerErrorSpy).not.toHaveBeenCalled();
            expect(mockSnackBar.open).not.toHaveBeenCalled();
        });
    });

    describe('provider mapping', () => {
        it('getProviderForId should map known provider ids', () => {
            expect(service.getProviderForId(GoogleAuthProvider.PROVIDER_ID)).toBeInstanceOf(GoogleAuthProvider);
            expect(service.getProviderForId(GithubAuthProvider.PROVIDER_ID)).toBeInstanceOf(GithubAuthProvider);
            expect(service.getProviderForId(FacebookAuthProvider.PROVIDER_ID)).toBeInstanceOf(FacebookAuthProvider);
            expect(service.getProviderForId(TwitterAuthProvider.PROVIDER_ID)).toBeInstanceOf(TwitterAuthProvider);
        });

        it('getProviderForId should throw for unsupported providers', () => {
            expect(() => service.getProviderForId('custom-provider')).toThrow('Unsupported provider ID: custom-provider');
        });
    });

    describe('email/password auth', () => {
        it('emailSignUp should call Firebase createUserWithEmailAndPassword and return result', async () => {
            const { createUserWithEmailAndPassword } = await import('app/firebase/auth');
            const result = { user: { uid: 'signup-user' } };
            (createUserWithEmailAndPassword as Mock).mockResolvedValueOnce(result as any);

            await expect(service.emailSignUp('signup@example.com', 'super-secret')).resolves.toEqual(result);
            expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(mockAuth, 'signup@example.com', 'super-secret');
        });

        it('emailSignUp should handle errors and rethrow', async () => {
            const { createUserWithEmailAndPassword } = await import('app/firebase/auth');
            const authError = new Error('signup failed');
            const loggerErrorSpy = vi.spyOn((service as any).logger, 'error').mockImplementation(() => { });
            (createUserWithEmailAndPassword as Mock).mockRejectedValueOnce(authError);

            await expect(service.emailSignUp('signup@example.com', 'super-secret')).rejects.toBe(authError);

            expect(loggerErrorSpy).toHaveBeenCalledWith(authError);
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Could not login due to error signup failed ',
                undefined,
                { duration: 2000 }
            );
        });

        it('emailLogin should call Firebase signInWithEmailAndPassword and return result', async () => {
            const { signInWithEmailAndPassword } = await import('app/firebase/auth');
            const result = { user: { uid: 'login-user' } };
            (signInWithEmailAndPassword as Mock).mockResolvedValueOnce(result as any);

            await expect(service.emailLogin('login@example.com', 'super-secret')).resolves.toEqual(result);
            expect(signInWithEmailAndPassword).toHaveBeenCalledWith(mockAuth, 'login@example.com', 'super-secret');
        });

        it('emailLogin should handle errors and rethrow', async () => {
            const { signInWithEmailAndPassword } = await import('app/firebase/auth');
            const authError = new Error('login failed');
            const loggerErrorSpy = vi.spyOn((service as any).logger, 'error').mockImplementation(() => { });
            (signInWithEmailAndPassword as Mock).mockRejectedValueOnce(authError);

            await expect(service.emailLogin('login@example.com', 'super-secret')).rejects.toBe(authError);

            expect(loggerErrorSpy).toHaveBeenCalledWith(authError);
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Could not login due to error login failed ',
                undefined,
                { duration: 2000 }
            );
        });

        it('resetPassword should send reset email and show success snackbar', async () => {
            const { sendPasswordResetEmail } = await import('app/firebase/auth');
            (sendPasswordResetEmail as Mock).mockResolvedValueOnce(undefined);

            await service.resetPassword('reset@example.com');

            expect(sendPasswordResetEmail).toHaveBeenCalledWith(
                mockAuth,
                'reset@example.com',
                expect.objectContaining({
                    url: `${environment.appUrl}/login`,
                })
            );
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Password update email sent',
                undefined,
                { duration: 2000 }
            );
        });

        it('resetPassword should handle errors without throwing', async () => {
            const { sendPasswordResetEmail } = await import('app/firebase/auth');
            const authError = new Error('reset failed');
            const loggerErrorSpy = vi.spyOn((service as any).logger, 'error').mockImplementation(() => { });
            (sendPasswordResetEmail as Mock).mockRejectedValueOnce(authError);

            await expect(service.resetPassword('reset@example.com')).resolves.toBeUndefined();

            expect(loggerErrorSpy).toHaveBeenCalledWith(authError);
            expect(mockSnackBar.open).toHaveBeenCalledWith(
                'Could not login due to error reset failed ',
                undefined,
                { duration: 2000 }
            );
        });

        it('resetPassword should include linkDomain outside localhost', async () => {
            const { sendPasswordResetEmail } = await import('app/firebase/auth');
            setMockEnvironmentLocalhost(false);
            environment.firebase.authDomain = 'quantified-self.io';
            (sendPasswordResetEmail as Mock).mockResolvedValueOnce(undefined);

            await service.resetPassword('reset-prod-like@example.com');

            expect(sendPasswordResetEmail).toHaveBeenCalledWith(
                mockAuth,
                'reset-prod-like@example.com',
                expect.objectContaining({
                    url: `${environment.appUrl}/login`,
                    linkDomain: environment.firebase.authDomain,
                })
            );
        });
    });

    describe('loginWithCustomToken', () => {
        it('should call signInWithCustomToken with correct params', async () => {
            const { signInWithCustomToken } = await import('app/firebase/auth');
            const token = 'test-token-123';

            await service.loginWithCustomToken(token);

            expect(signInWithCustomToken).toHaveBeenCalled();
        });
    });
});
