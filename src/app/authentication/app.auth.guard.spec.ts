import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { authGuard } from './app.auth.guard';
import { AppAuthService } from './app.auth.service';
import { AppUserService } from '../services/app.user.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject, of, Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';

describe('authGuard', () => {
    let router: Router;
    let authServiceStub: any;
    let userServiceStub: any;
    let profileReadStateSubject: BehaviorSubject<any>;
    let snackBarSpy: any;

    beforeEach(() => {
        authServiceStub = {
            authState$: of(null),
            user$: of(null),
            redirectUrl: null
        };

        profileReadStateSubject = new BehaviorSubject<any>({ status: 'signed-out' });
        userServiceStub = {
            hasIncompleteProfileReads: vi.fn().mockReturnValue(false),
            profileReadState$: profileReadStateSubject,
        };

        const routerSpy = {
            createUrlTree: vi.fn().mockImplementation((commands) => ({
                toString: () => commands.join('/')
            })),
            navigate: vi.fn()
        };

        snackBarSpy = {
            open: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: authServiceStub },
                { provide: AppUserService, useValue: userServiceStub },
                { provide: Router, useValue: routerSpy },
                { provide: MatSnackBar, useValue: snackBarSpy }
            ]
        });

        router = TestBed.inject(Router);
    });

    const runGuard = async (user: any) => {
        authServiceStub.authState$ = of(user ? { uid: user.uid } : null);
        authServiceStub.user$ = of(user);
        profileReadStateSubject.next(user
            ? { status: 'ready', uid: user.uid, profileExists: true }
            : { status: 'signed-out' });
        const result = TestBed.runInInjectionContext(() => authGuard({} as any, [{ path: 'test' }] as any) as Observable<boolean>);
        return await firstValueFrom(result);
    };

    it('should allow access if user is logged in', async () => {
        const result = await runGuard({ uid: '123' });
        expect(result).toBe(true);
        expect(authServiceStub.redirectUrl).toBeNull();
    });

    it('should redirect to login if user is not logged in', async () => {
        const result = await runGuard(null);

        // Expect UrlTree
        expect(result).not.toBe(true);
        expect(result).not.toBe(false);
        expect((result as any).toString()).toContain('/login');

        expect(snackBarSpy.open).toHaveBeenCalledWith('You must login first', undefined, { duration: 2000 });
        expect(authServiceStub.redirectUrl).toBe('/test');
    });

    it('should treat Firebase sign-out as authoritative over a replayed app user', async () => {
        authServiceStub.authState$ = of(null);
        authServiceStub.user$ = of({ uid: 'stale-user' });

        const guardResult = TestBed.runInInjectionContext(() => authGuard(
            {} as any,
            [{ path: 'dashboard' }] as any
        )) as Observable<unknown>;
        const result = await firstValueFrom(guardResult);

        expect(result).not.toBe(true);
        expect((result as any).toString()).toContain('/login');
        expect(authServiceStub.redirectUrl).toBe('/dashboard');
    });

    it('should redirect a signed-in user to login recovery when profile loading becomes actionable', async () => {
        authServiceStub.authState$ = of({ uid: 'current-user' });
        authServiceStub.user$ = new BehaviorSubject<any>({ uid: 'stale-current-user' });
        userServiceStub.hasIncompleteProfileReads.mockReturnValue(true);
        profileReadStateSubject.next({
            status: 'recovering',
            uid: 'current-user',
            attempt: 4,
            code: 'permission-denied',
        });

        const guardResult = TestBed.runInInjectionContext(() => authGuard(
            {} as any,
            [{ path: 'dashboard' }] as any
        )) as Observable<unknown>;
        const result = await firstValueFrom(guardResult);

        expect(result).not.toBe(true);
        expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
            queryParams: { returnUrl: '/dashboard' },
        });
        expect(authServiceStub.redirectUrl).toBe('/dashboard');
        expect(snackBarSpy.open).not.toHaveBeenCalled();
    });

    it('should wait for a matching recovered app user before allowing a signed-in account', async () => {
        const firebaseUsers$ = new BehaviorSubject<any>({ uid: 'current-user' });
        const appUsers$ = new BehaviorSubject<any>({ uid: 'stale-user' });
        const userService = TestBed.inject(AppUserService) as any;
        userService.hasIncompleteProfileReads.mockReturnValue(true);
        authServiceStub.authState$ = firebaseUsers$;
        authServiceStub.user$ = appUsers$;

        const guardResult = TestBed.runInInjectionContext(() => authGuard(
            {} as any,
            [{ path: 'dashboard' }] as any
        )) as Observable<unknown>;
        const results: unknown[] = [];
        const subscription = guardResult.subscribe((result) => results.push(result));

        expect(results).toEqual([]);
        expect(snackBarSpy.open).not.toHaveBeenCalled();

        userService.hasIncompleteProfileReads.mockReturnValue(false);
        appUsers$.next({ uid: 'current-user' });

        expect(results).toEqual([true]);
        expect(authServiceStub.redirectUrl).toBeNull();
        subscription.unsubscribe();
    });
});
