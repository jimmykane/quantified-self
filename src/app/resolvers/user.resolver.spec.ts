import { TestBed } from '@angular/core/testing';
import { ResolveFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { User } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppUserService } from '../services/app.user.service';
import { AppAuthService } from '../authentication/app.auth.service';
import { userResolver, UserResolverData } from './user.resolver';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('userResolver', () => {
    const executeResolver: ResolveFn<UserResolverData> = (...resolverParameters) =>
        TestBed.runInInjectionContext(() => userResolver(...resolverParameters));

    let userServiceSpy: any;
    let authServiceSpy: any;
    let routerSpy: any;
    let snackBarSpy: any;

    const mockUser = new User('testUser');

    beforeEach(() => {
        userServiceSpy = { isPro: vi.fn() };
        authServiceSpy = { user$: of(mockUser) };
        routerSpy = { navigate: vi.fn() };
        snackBarSpy = { open: vi.fn() };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppUserService, useValue: userServiceSpy },
                { provide: AppAuthService, useValue: authServiceSpy },
                { provide: Router, useValue: routerSpy },
                { provide: MatSnackBar, useValue: snackBarSpy }
            ]
        });
    });

    it('should be created', () => {
        expect(executeResolver).toBeTruthy();
    });

    it('should resolve with user and isPro true', () => new Promise<void>(done => {
        userServiceSpy.isPro.mockResolvedValue(true);

        const route = new ActivatedRouteSnapshot();
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: UserResolverData) => {
            expect(result.user).toEqual(mockUser);
            expect(result.isPro).toBe(true);
            expect(userServiceSpy.isPro).toHaveBeenCalled();
            done();
        });
    }));

    it('should resolve with user and isPro false', () => new Promise<void>(done => {
        userServiceSpy.isPro.mockResolvedValue(false);

        const route = new ActivatedRouteSnapshot();
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: UserResolverData) => {
            expect(result.user).toEqual(mockUser);
            expect(result.isPro).toBe(false);
            done();
        });
    }));

    it('should resolve with null user if auth service returns null', () => new Promise<void>(done => {
        authServiceSpy.user$ = of(null);

        const route = new ActivatedRouteSnapshot();
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: UserResolverData) => {
            expect(result.user).toBeNull();
            expect(result.isPro).toBe(false);
            done();
        });
    }));
});
