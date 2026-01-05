import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { onboardingGuard } from './onboarding.guard';
import { AppAuthService } from './app.auth.service';
import { LoggerService } from '../services/logger.service';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { User } from '@sports-alliance/sports-lib';

describe('onboardingGuard', () => {
    let router: Router;
    let authService: any;
    let logger: any;

    const mockRouter = {
        navigate: vi.fn()
    };

    const mockLogger = {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    };

    const mockAuthService = {
        user$: of(null)
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: LoggerService, useValue: mockLogger }
            ]
        });

        router = TestBed.inject(Router);
        authService = TestBed.inject(AppAuthService);
        logger = TestBed.inject(LoggerService);
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

        const result = await (runGuard(user) as any).toPromise();
        expect(result).toBe(true);
        expect(router.navigate).not.toHaveBeenCalled();
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
        expect(result).toBe(false);
        expect(router.navigate).toHaveBeenCalledWith(['/onboarding']);
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
        expect(result).toBe(false);
        expect(router.navigate).toHaveBeenCalledWith(['/onboarding']);
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

        const result = await (runGuard(user) as any).toPromise();
        expect(result).toBe(true);
        expect(router.navigate).not.toHaveBeenCalled();
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
        expect(router.navigate).not.toHaveBeenCalled();
    });
});
