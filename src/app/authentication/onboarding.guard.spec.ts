import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Observable } from 'rxjs';
import { onboardingGuard } from './onboarding.guard';
import { AppAuthService } from './app.auth.service';
import { LoggerService } from '../services/logger.service';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../services/app.user.service';
import { Firestore } from 'app/firebase/firestore';
import { signal } from '@angular/core';

describe('onboardingGuard', () => {
    let router: Router;
    let authService: any;
    let logger: any;

    const mockRouter = {
        createUrlTree: vi.fn().mockImplementation((commands) => ({
            toString: () => commands.join('/')
        })),
        navigate: vi.fn()
    };

    const mockLogger = {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    };

    const mockAuthService: { user$: Observable<any> } = {
        user$: of(null)
    };

    const mockUserService = {
        hasPaidAccessSignal: signal(false)
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: Router, useValue: mockRouter },
                { provide: LoggerService, useValue: mockLogger },
                { provide: Firestore, useValue: {} }
            ]
        });

        router = TestBed.inject(Router);
        authService = TestBed.inject(AppAuthService);
        logger = TestBed.inject(LoggerService);
        mockUserService.hasPaidAccessSignal.set(false); // Reset state
        vi.clearAllMocks();
    });

    const runGuard = (user: Partial<User> | null, segments: any[] = []) => {
        mockAuthService.user$ = of(user);
        return TestBed.runInInjectionContext(() => onboardingGuard({} as any, segments));
    };

    it('should allow access if user has accepted policies and has paid access', async () => {
        const user = {
            uid: '123',
            stripeRole: 'pro',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true
        };

        mockUserService.hasPaidAccessSignal.set(true);

        const result = await (runGuard(user) as any).toPromise();
        expect(result).toBe(true);
    });

    it('should redirect to onboarding if policies not accepted', async () => {
        const user = {
            uid: '123',
            stripeRole: 'pro',
            acceptedPrivacyPolicy: false,
            acceptedDataPolicy: true,
            acceptedTos: true
        };

        const result = await (runGuard(user, [{ path: 'dashboard' }] as any) as any).toPromise();
        // Expect UrlTree
        expect(result).not.toBe(true);
        expect(result).not.toBe(false);
        expect((result as any).toString()).toContain('/onboarding');
    });

    it('should redirect to onboarding if no paid access and no subscription history', async () => {
        const user = {
            uid: '123',
            stripeRole: null,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            hasSubscribedOnce: false,
            onboardingCompleted: false
        };

        const result = await (runGuard(user, [{ path: 'dashboard' }] as any) as any).toPromise();
        // Expect UrlTree
        expect(result).not.toBe(true);
        expect(result).not.toBe(false);
        expect((result as any).toString()).toContain('/onboarding');
    });

    it('should redirect payment cancel route to onboarding if onboarding is incomplete', async () => {
        const user = {
            uid: '123',
            stripeRole: null,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            hasSubscribedOnce: false,
            onboardingCompleted: false
        };

        const result = await (runGuard(user, [{ path: 'payment' }, { path: 'cancel' }] as any) as any).toPromise();
        expect(result).not.toBe(true);
        expect(result).not.toBe(false);
        expect((result as any).toString()).toContain('/onboarding');
    });

    it('should allow payment success route when onboarding is incomplete', async () => {
        const user = {
            uid: '123',
            stripeRole: null,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            hasSubscribedOnce: false,
            onboardingCompleted: false
        };

        const result = await (runGuard(user, [{ path: 'payment' }, { path: 'success' }] as any) as any).toPromise();
        expect(result).toBe(true);
    });

    it('should allow access if hasSubscribedOnce is true', async () => {
        const user = {
            uid: '123',
            stripeRole: null,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            hasSubscribedOnce: true
        };

        mockUserService.hasPaidAccessSignal.set(true);

        const result = await (runGuard(user) as any).toPromise();
        expect(result).toBe(true);
    });

    it('should allow access if explicitly completed onboarding', async () => {
        const user = {
            uid: '123',
            stripeRole: null,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            onboardingCompleted: true
        };

        const result = await (runGuard(user) as any).toPromise();
        expect(result).toBe(true);
    });
});
