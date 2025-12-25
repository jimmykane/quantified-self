import { TestBed } from '@angular/core/testing';
import { AppAuthService } from './app.auth.service';
import { AppUserService } from '../services/app.user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LocalStorageService } from '../services/storage/app.local.storage.service';
import { Auth, GithubAuthProvider } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Analytics } from '@angular/fire/analytics';
import { EnvironmentInjector } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
const mockAuth = {
    currentUser: null
};

const mockFirestore = {};
const mockAnalytics = {};

const mockUserService = {
    fillMissingAppSettings: (settings: any) => settings
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

    beforeEach(() => {
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
});
