import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { paidGuard, proGuard } from './pro.guard';
import { AppAuthService } from './app.auth.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BehaviorSubject, of } from 'rxjs';
import { LoggerService } from '../services/logger.service';
import { AppUserService } from '../services/app.user.service';

describe('paidGuard', () => {
    let router: Router;
    let authServiceStub: Partial<AppAuthService>;
    let profileReadStateSubject: BehaviorSubject<any>;
    let userServiceStub: any;

    beforeEach(() => {
        authServiceStub = {
            authState$: of({ uid: '123' } as any),
            user$: of(null),
            redirectUrl: null,
        };
        profileReadStateSubject = new BehaviorSubject<any>({ status: 'ready', uid: '123', profileExists: true });
        userServiceStub = {
            hasIncompleteProfileReads: vi.fn().mockReturnValue(false),
            profileReadState$: profileReadStateSubject,
        };

        const routerSpy = {
            createUrlTree: vi.fn().mockImplementation((commands) => ({
                toString: () => commands.join('/')
            }))
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: authServiceStub },
                { provide: AppUserService, useValue: userServiceStub },
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

    it('should wait for the paid user matching the current Firebase account', async () => {
        const users$ = new BehaviorSubject<any>({
            uid: 'previous-user',
            stripeRole: 'pro',
        });
        authServiceStub.authState$ = of({ uid: 'current-user' } as any);
        authServiceStub.user$ = users$;

        let resolved = false;
        const resultPromise = TestBed.runInInjectionContext(() => paidGuard({} as any, [] as any))
            .then((result) => {
                resolved = true;
                return result;
            });
        await Promise.resolve();
        expect(resolved).toBe(false);

        users$.next({
            uid: 'current-user',
            stripeRole: 'basic',
            acceptedTos: true,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
        });

        await expect(resultPromise).resolves.toBe(true);
    });

    it('should route an actionable profile failure to login recovery', async () => {
        authServiceStub.authState$ = of({ uid: 'current-user' } as any);
        authServiceStub.user$ = new BehaviorSubject<any>({ uid: 'current-user', stripeRole: 'pro' });
        userServiceStub.hasIncompleteProfileReads.mockReturnValue(true);
        profileReadStateSubject.next({ status: 'loading', uid: 'current-user' });

        const resultPromise = TestBed.runInInjectionContext(() => paidGuard(
            {} as any,
            [{ path: 'dashboard' }] as any
        ));
        profileReadStateSubject.next({
            status: 'recovering',
            uid: 'current-user',
            attempt: 4,
            code: 'permission-denied',
        });

        const result = await resultPromise;

        expect(result).not.toBe(true);
        expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
            queryParams: { returnUrl: '/dashboard' },
        });
        expect(authServiceStub.redirectUrl).toBe('/dashboard');
    });
});
