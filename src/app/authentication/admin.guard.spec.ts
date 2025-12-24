
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { adminGuard } from './admin.guard';
import { AppUserService } from '../services/app.user.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('adminGuard', () => {
    let router: Router;
    let userServiceSpy: any;

    beforeEach(() => {
        userServiceSpy = {
            isAdmin: vi.fn()
        };

        const routerSpy = {
            navigate: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppUserService, useValue: userServiceSpy },
                { provide: Router, useValue: routerSpy }
            ]
        });

        router = TestBed.inject(Router);
    });

    it('should allow access if user is admin', async () => {
        userServiceSpy.isAdmin.mockResolvedValue(true);

        const result = await TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any));
        expect(result).toBe(true);
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('should redirect to dashboard if user is not admin', async () => {
        userServiceSpy.isAdmin.mockResolvedValue(false);

        const result = await TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any));
        expect(result).toBe(false);
        expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should redirect to dashboard if isAdmin throws error', async () => {
        userServiceSpy.isAdmin.mockRejectedValue(new Error('Auth failed'));

        const result = await TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any));
        expect(result).toBe(false);
        expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });
});
