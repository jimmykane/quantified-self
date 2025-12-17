import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { premiumGuard } from './premium.guard';
import { AppUserService } from '../services/app.user.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('premiumGuard', () => {
    let router: Router;
    let userService: { isPremium: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        userService = {
            isPremium: vi.fn()
        };

        const routerSpy = {
            navigate: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppUserService, useValue: userService },
                { provide: Router, useValue: routerSpy }
            ]
        });

        router = TestBed.inject(Router);
    });

    it('should allow access if user is premium', async () => {
        userService.isPremium.mockResolvedValue(true);
        const result = await TestBed.runInInjectionContext(() => premiumGuard({} as any, {} as any));
        expect(result).toBe(true);
    });

    it('should redirect to pricing if user is not premium', async () => {
        userService.isPremium.mockResolvedValue(false);
        const result = await TestBed.runInInjectionContext(() => premiumGuard({} as any, {} as any));
        expect(result).toBe(false);
        expect(router.navigate).toHaveBeenCalledWith(['/pricing']);
    });
});
