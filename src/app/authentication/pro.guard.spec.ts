import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { proGuard } from './pro.guard';
import { AppUserService } from '../services/app.user.service';
import { AppAuthService } from './app.auth.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { of } from 'rxjs';

describe('proGuard', () => {
    let router: Router;
    let authServiceStub: Partial<AppAuthService>;
    let userServiceStub: Partial<AppUserService>;

    beforeEach(() => {
        authServiceStub = {
            user$: of(null)
        };
        userServiceStub = {}; // No methods needed for seemingly, as guard checks authService user directly now? 
        // Actually guard uses authService.user$ to get user claims.

        const routerSpy = {
            navigate: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: authServiceStub },
                { provide: AppUserService, useValue: userServiceStub },
                { provide: Router, useValue: routerSpy }
            ]
        });

        router = TestBed.inject(Router);
    });

    it('should allow access if user is pro', async () => {
        authServiceStub.user$ = of({
            uid: '123',
            stripeRole: 'pro',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTrackingPolicy: true,
            acceptedDiagnosticsPolicy: true
        } as any);

        const result = await TestBed.runInInjectionContext(() => proGuard({} as any, {} as any));
        expect(result).toBe(true);
    });

    it('should allow access if user is basic', async () => {
        authServiceStub.user$ = of({
            uid: '123',
            stripeRole: 'basic',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTrackingPolicy: true,
            acceptedDiagnosticsPolicy: true
        } as any);

        const result = await TestBed.runInInjectionContext(() => proGuard({} as any, {} as any));
        expect(result).toBe(true);
    });

    it('should redirect to pricing if user is free and subscribed once', async () => {
        authServiceStub.user$ = of({
            uid: '123',
            stripeRole: 'free',
            hasSubscribedOnce: true,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTrackingPolicy: true,
            acceptedDiagnosticsPolicy: true
        } as any);

        const result = await TestBed.runInInjectionContext(() => proGuard({} as any, {} as any));
        expect(result).toBe(false);
        expect(router.navigate).toHaveBeenCalledWith(['/pricing']);
    });
});
