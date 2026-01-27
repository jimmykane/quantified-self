
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { loggedInGuard } from './logged-in.guard';
import { AppAuthService } from './app.auth.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { of, Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';

describe('loggedInGuard', () => {
    let router: Router;
    let authServiceSpy: any;

    beforeEach(() => {
        authServiceSpy = {
            user$: of(null)
        };

        const routerSpy = {
            navigate: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: authServiceSpy },
                { provide: Router, useValue: routerSpy }
            ]
        });

        router = TestBed.inject(Router);
    });

    it('should allow access if user is logged out (user is null)', async () => {
        authServiceSpy.user$ = of(null);

        const result = TestBed.runInInjectionContext(() => loggedInGuard({} as any, []) as Observable<boolean>);
        const canMatch = await firstValueFrom(result);

        expect(canMatch).toBe(true);
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('should redirect to dashboard and block access if user is logged in', async () => {
        authServiceSpy.user$ = of({ uid: '123', email: 'test@example.com' });

        const result = TestBed.runInInjectionContext(() => loggedInGuard({} as any, []) as Observable<boolean>);
        const canMatch = await firstValueFrom(result);

        expect(canMatch).toBe(false);
        expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });
});
