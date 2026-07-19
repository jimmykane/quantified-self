import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, of, Observable } from 'rxjs';
import { onboardingGuard } from './onboarding.guard';
import { AppAuthService } from './app.auth.service';
import { LoggerService } from '../services/logger.service';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../services/app.user.service';
import { Firestore } from 'app/firebase/firestore';
import { signal } from '@angular/core';

describe('onboardingGuard', () => {
    let router: Router;
    let authService: any;
    let logger: any;

    const mockRouter = {
        createUrlTree: vi.fn().mockImplementation((commands) => ({
            toString: () => commands.join('/')
        })),
        navigate: vi.fn()
    };

    const mockLogger = {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    };

    const mockAuthService: { authState$: Observable<any>; user$: Observable<any>; redirectUrl: string | null } = {
        authState$: of(null),
        user$: of(null),
        redirectUrl: null,
    };

    const profileReadStateSubject = new BehaviorSubject<any>({ status: 'signed-out' });
    const mockUserService = {
        hasPaidAccessSignal: signal(false),
        hasIncompleteProfileReads: vi.fn().mockReturnValue(false),
        profileReadState$: profileReadStateSubject.asObservable(),
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: AppUserService, useValue: mockUserService },
                { provide: Router, useValue: mockRouter },
                { provide: LoggerService, useValue: mockLogger },
                { provide: Firestore, useValue: {} }
            ]
        });

        router = TestBed.inject(Router);
        authService = TestBed.inject(AppAuthService);
        logger = TestBed.inject(LoggerService);
        mockUserService.hasPaidAccessSignal.set(false); // Reset state
        mockUserService.hasIncompleteProfileReads.mockReturnValue(false);
        profileReadStateSubject.next({ status: 'signed-out' });
        mockAuthService.redirectUrl = null;
        vi.clearAllMocks();
    });

    const runGuard = (user: Partial<User> | null, segments: any[] = []) => {
        mockAuthService.authState$ = of(user ? { uid: user.uid } : null);
        mockAuthService.user$ = of(user);
        profileReadStateSubject.next(user
            ? { status: 'ready', uid: user.uid, profileExists: true }
            : { status: 'signed-out' });
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

        mockUserService.hasPaidAccessSignal.set(true);

        const result = await (runGuard(user) as any).toPromise();
        expect(result).toBe(true);
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
        // Expect UrlTree
        expect(result).not.toBe(true);
        expect(result).not.toBe(false);
        expect((result as any).toString()).toContain('/onboarding');
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
        // Expect UrlTree
        expect(result).not.toBe(true);
        expect(result).not.toBe(false);
        expect((result as any).toString()).toContain('/onboarding');
    });

    it('should redirect payment cancel route to onboarding if onboarding is incomplete', async () => {
        const user = {
            uid: '123',
            stripeRole: null,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            hasSubscribedOnce: false,
            onboardingCompleted: false
        };

        const result = await (runGuard(user, [{ path: 'payment' }, { path: 'cancel' }] as any) as any).toPromise();
        expect(result).not.toBe(true);
        expect(result).not.toBe(false);
        expect((result as any).toString()).toContain('/onboarding');
    });

    it('should allow payment success route when onboarding is incomplete', async () => {
        const user = {
            uid: '123',
            stripeRole: null,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            hasSubscribedOnce: false,
            onboardingCompleted: false
        };

        const result = await (runGuard(user, [{ path: 'payment' }, { path: 'success' }] as any) as any).toPromise();
        expect(result).toBe(true);
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

        mockUserService.hasPaidAccessSignal.set(true);

        const result = await (runGuard(user) as any).toPromise();
        expect(result).toBe(true);
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
    });

    it('should wait for the recovered user emission before deciding whether to redirect to onboarding', async () => {
        const staleUser = {
            uid: '123',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            onboardingCompleted: true,
        };
        const users$ = new BehaviorSubject(staleUser);
        mockAuthService.authState$ = of({ uid: staleUser.uid });
        mockAuthService.user$ = users$;
        mockUserService.hasIncompleteProfileReads.mockReturnValue(true);

        const results: unknown[] = [];
        const guardResult = TestBed.runInInjectionContext(() => onboardingGuard(
            {} as any,
            [{ path: 'dashboard' }] as any
        ));
        const subscription = (guardResult as Observable<unknown>)
            .subscribe((result) => results.push(result));

        expect(results).toEqual([]);
        expect(mockRouter.createUrlTree).not.toHaveBeenCalledWith(['/onboarding']);

        mockUserService.hasIncompleteProfileReads.mockReturnValue(false);
        await Promise.resolve();

        expect(results).toEqual([]);

        users$.next(staleUser);
        await Promise.resolve();

        expect(results).toHaveLength(1);
        const result = results[0];
        expect(result).toBe(true);
        subscription.unsubscribe();
    });

    it('should wait for the app user matching the current Firebase account', async () => {
        const users$ = new BehaviorSubject<any>({
            uid: 'previous-user',
            acceptedPrivacyPolicy: false,
            acceptedDataPolicy: false,
            acceptedTos: false,
        });
        mockAuthService.authState$ = of({ uid: 'current-user' });
        mockAuthService.user$ = users$;

        const results: unknown[] = [];
        const guardResult = TestBed.runInInjectionContext(() => onboardingGuard(
            {} as any,
            [{ path: 'dashboard' }] as any
        ));
        const subscription = (guardResult as Observable<unknown>)
            .subscribe((result) => results.push(result));

        expect(results).toEqual([]);
        expect(mockRouter.createUrlTree).not.toHaveBeenCalledWith(['/onboarding']);

        users$.next({
            uid: 'current-user',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            onboardingCompleted: true,
        });

        expect(results).toEqual([true]);
        subscription.unsubscribe();
    });

    it('should route an actionable profile failure to login recovery', async () => {
        const users$ = new BehaviorSubject<any>({
            uid: 'current-user',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true,
            onboardingCompleted: true,
        });
        mockAuthService.authState$ = of({ uid: 'current-user' });
        mockAuthService.user$ = users$;
        mockUserService.hasIncompleteProfileReads.mockReturnValue(true);
        profileReadStateSubject.next({ status: 'loading', uid: 'current-user' });

        const guardPromise = firstValueFrom(TestBed.runInInjectionContext(() => onboardingGuard(
            {} as any,
            [{ path: 'dashboard' }] as any
        )) as Observable<unknown>);
        profileReadStateSubject.next({
            status: 'recovering',
            uid: 'current-user',
            attempt: 4,
            code: 'permission-denied',
        });

        const result = await guardPromise;

        expect(result).not.toBe(true);
        expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/login'], {
            queryParams: { returnUrl: '/dashboard' },
        });
        expect(mockAuthService.redirectUrl).toBe('/dashboard');
    });
});
