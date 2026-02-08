import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { paidGuard, proGuard } from './pro.guard';
import { AppAuthService } from './app.auth.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { LoggerService } from '../services/logger.service';

describe('paidGuard', () => {
    let router: Router;
    let authServiceStub: Partial<AppAuthService>;

    beforeEach(() => {
        authServiceStub = {
            user$: of(null)
        };

        const routerSpy = {
            createUrlTree: vi.fn().mockImplementation((commands) => ({
                toString: () => commands.join('/')
            }))
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: authServiceStub },
                { provide: Router, useValue: routerSpy },
                { provide: LoggerService, useValue: { log: vi.fn(), error: vi.fn() } },
            ]
        });

        router = TestBed.inject(Router);
    });

    it('should allow access if user is pro', async () => {
        authServiceStub.user$ = of({
            uid: '123',
            stripeRole: 'pro',
            acceptedTos: true,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTrackingPolicy: true,
            acceptedDiagnosticsPolicy: true
        } as any);

        const result = await TestBed.runInInjectionContext(() => paidGuard({} as any, [] as any));
        expect(result).toBe(true);
    });

    it('should allow access if user is basic', async () => {
        authServiceStub.user$ = of({
            uid: '123',
            stripeRole: 'basic',
            acceptedTos: true,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTrackingPolicy: true,
            acceptedDiagnosticsPolicy: true
        } as any);

        const result = await TestBed.runInInjectionContext(() => paidGuard({} as any, [] as any));
        expect(result).toBe(true);
    });

    it('should redirect to subscriptions if user is free and subscribed once', async () => {
        authServiceStub.user$ = of({
            uid: '123',
            stripeRole: 'free',
            acceptedTos: true,
            hasSubscribedOnce: true,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTrackingPolicy: true,
            acceptedDiagnosticsPolicy: true
        } as any);

        const result = await TestBed.runInInjectionContext(() => paidGuard({} as any, [] as any));
        // Expect a UrlTree (or our mock of it)
        expect(result).not.toBe(true);
        expect(result).not.toBe(false);
        expect((result as any).toString()).toContain('/subscriptions');
    });

    it('should deny without redirect when onboarding is incomplete', async () => {
        authServiceStub.user$ = of({
            uid: '123',
            stripeRole: 'free',
            acceptedTos: false,
            hasSubscribedOnce: false,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTrackingPolicy: true,
            acceptedDiagnosticsPolicy: true
        } as any);

        const result = await TestBed.runInInjectionContext(() => paidGuard({} as any, [] as any));
        expect(result).toBe(false);
    });

    it('should keep proGuard as a backward-compatible alias', async () => {
        authServiceStub.user$ = of({
            uid: '123',
            stripeRole: 'basic',
            acceptedTos: true,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTrackingPolicy: true,
            acceptedDiagnosticsPolicy: true
        } as any);

        const result = await TestBed.runInInjectionContext(() => proGuard({} as any, [] as any));
        expect(result).toBe(true);
    });
});
