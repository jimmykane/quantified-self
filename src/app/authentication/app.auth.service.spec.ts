import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';

const { mockUserFunction } = vi.hoisted(() => {
    return {
        mockUserFunction: vi.fn(),
    };
});

// Mock @angular/fire/auth modular functions MUST be at the top level
vi.mock('@angular/fire/auth', async () => {
    const actual = await vi.importActual('@angular/fire/auth');
    return {
        ...actual,
        user: mockUserFunction,
        signInWithPopup: vi.fn(),
        signOut: vi.fn(),
    };
});

import { TestBed } from '@angular/core/testing';
import { AppAuthService } from './app.auth.service';
import { AppUserService } from '../services/app.user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import { Auth, GithubAuthProvider, user as fireAuthUser } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Analytics } from '@angular/fire/analytics';
import { EnvironmentInjector } from '@angular/core';
import { of, BehaviorSubject } from 'rxjs';
import { Privacy } from '@sports-alliance/sports-lib';

// Mock dependencies
const mockAuth = {
    currentUser: null
};

const mockFirestore = {};
const mockAnalytics = {};

const mockUserService = {
    fillMissingAppSettings: (settings: any) => settings,
    getUserByID: vi.fn(),
    isPro: vi.fn(),
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


describe('AppAuthService', () => {
    let service: AppAuthService;
    let userSubject: BehaviorSubject<any>;

    beforeEach(() => {
        userSubject = new BehaviorSubject<any>(null);
        mockUserFunction.mockReturnValue(userSubject);
        TestBed.configureTestingModule({
            providers: [
                AppAuthService,
                { provide: Auth, useValue: mockAuth },
                { provide: Firestore, useValue: mockFirestore },
                { provide: Analytics, useValue: mockAnalytics },
                { provide: AppUserService, useValue: mockUserService },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: LocalStorageService, useValue: mockLocalStorageService },
                { provide: EnvironmentInjector, useValue: {} }
            ]
        });
        service = TestBed.inject(AppAuthService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
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
            isAnonymous: false,
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

        userSubject.next(mockFirebaseUser);

        const user = await userPromise;

        expect(user.privacy).toBe(Privacy.Private);
        expect(user.acceptedPrivacyPolicy).toBe(false);
    });
});
