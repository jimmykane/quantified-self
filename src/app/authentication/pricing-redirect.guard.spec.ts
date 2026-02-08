import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AppAuthService } from './app.auth.service';
import { pricingRedirectGuard } from './pricing-redirect.guard';
import { of, firstValueFrom } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('pricingRedirectGuard', () => {
    let authServiceStub: Partial<AppAuthService>;
    let router: Router;

    beforeEach(() => {
        authServiceStub = {
            authState$: of(null)
        };

        const routerSpy = {
            parseUrl: vi.fn().mockImplementation((url: string) => ({ redirectedTo: url }))
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: authServiceStub },
                { provide: Router, useValue: routerSpy }
            ]
        });

        router = TestBed.inject(Router);
    });

    it('should redirect authenticated users to /subscriptions', async () => {
        authServiceStub.authState$ = of({ uid: '123', isAnonymous: false } as any);

        const result = await firstValueFrom(
            TestBed.runInInjectionContext(() => pricingRedirectGuard({} as any, []))
        );

        expect(router.parseUrl).toHaveBeenCalledWith('/subscriptions');
        expect(result).toEqual({ redirectedTo: '/subscriptions' });
    });

    it('should allow anonymous users to access /pricing', async () => {
        authServiceStub.authState$ = of(null);

        const result = await firstValueFrom(
            TestBed.runInInjectionContext(() => pricingRedirectGuard({} as any, []))
        );

        expect(result).toBe(true);
        expect(router.parseUrl).not.toHaveBeenCalled();
    });

    it('should allow anonymous auth sessions to access /pricing', async () => {
        authServiceStub.authState$ = of({ uid: 'anon', isAnonymous: true } as any);

        const result = await firstValueFrom(
            TestBed.runInInjectionContext(() => pricingRedirectGuard({} as any, []))
        );

        expect(result).toBe(true);
        expect(router.parseUrl).not.toHaveBeenCalled();
    });
});
