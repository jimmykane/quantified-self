import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAuthService } from './app.auth.service';
import { aiInsightsGuard } from './ai-insights.guard';
import { LoggerService } from '../services/logger.service';
import { AppUserService } from '../services/app.user.service';

describe('aiInsightsGuard', () => {
  let authServiceStub: Partial<AppAuthService>;
  let router: Router;
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
        toString: () => commands.join('/'),
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AppAuthService, useValue: authServiceStub },
        { provide: AppUserService, useValue: userServiceStub },
        { provide: Router, useValue: routerSpy },
        { provide: LoggerService, useValue: { log: vi.fn(), error: vi.fn() } },
      ],
    });
    router = TestBed.inject(Router);
  });

  it('should allow access for a pro user', async () => {
    authServiceStub.user$ = of({
      uid: '123',
      stripeRole: 'pro',
      acceptedTos: true,
      acceptedPrivacyPolicy: true,
      acceptedDataPolicy: true,
      acceptedTrackingPolicy: true,
      acceptedDiagnosticsPolicy: true,
    } as any);

    const result = await TestBed.runInInjectionContext(() => aiInsightsGuard({} as any, [] as any));

    expect(result).toBe(true);
  });

  it('should allow access for a basic user', async () => {
    authServiceStub.user$ = of({
      uid: '123',
      stripeRole: 'basic',
      hasSubscribedOnce: true,
      acceptedTos: true,
      acceptedPrivacyPolicy: true,
      acceptedDataPolicy: true,
      acceptedTrackingPolicy: true,
      acceptedDiagnosticsPolicy: true,
    } as any);

    const result = await TestBed.runInInjectionContext(() => aiInsightsGuard({} as any, [] as any));

    expect(result).toBe(true);
  });

  it('should allow access for an active grace user', async () => {
    authServiceStub.user$ = of({
      uid: '123',
      stripeRole: 'free',
      gracePeriodUntil: Date.now() + 60_000,
      acceptedTos: true,
      acceptedPrivacyPolicy: true,
      acceptedDataPolicy: true,
      acceptedTrackingPolicy: true,
      acceptedDiagnosticsPolicy: true,
    } as any);

    const result = await TestBed.runInInjectionContext(() => aiInsightsGuard({} as any, [] as any));

    expect(result).toBe(true);
  });

  it('should allow a lapsed onboarded free user', async () => {
    authServiceStub.user$ = of({
      uid: '123',
      stripeRole: 'free',
      hasSubscribedOnce: true,
      acceptedTos: true,
      acceptedPrivacyPolicy: true,
      acceptedDataPolicy: true,
      acceptedTrackingPolicy: true,
      acceptedDiagnosticsPolicy: true,
    } as any);

    const result = await TestBed.runInInjectionContext(() => aiInsightsGuard({} as any, [] as any));

    expect(result).toBe(true);
  });

  it('should allow explicitly completed free onboarding users', async () => {
    authServiceStub.user$ = of({
      uid: '123',
      stripeRole: 'free',
      hasSubscribedOnce: false,
      onboardingCompleted: true,
      acceptedTos: true,
      acceptedPrivacyPolicy: true,
      acceptedDataPolicy: true,
      acceptedTrackingPolicy: true,
      acceptedDiagnosticsPolicy: true,
    } as any);

    const result = await TestBed.runInInjectionContext(() => aiInsightsGuard({} as any, [] as any));

    expect(result).toBe(true);
  });

  it('should defer to onboarding when onboarding is incomplete', async () => {
    authServiceStub.user$ = of({
      uid: '123',
      stripeRole: 'free',
      acceptedTos: false,
      hasSubscribedOnce: false,
      acceptedPrivacyPolicy: true,
      acceptedDataPolicy: true,
      acceptedTrackingPolicy: true,
      acceptedDiagnosticsPolicy: true,
    } as any);

    const result = await TestBed.runInInjectionContext(() => aiInsightsGuard({} as any, [] as any));

    expect(result).toBe(false);
  });

  it('should route an actionable profile failure to login recovery', async () => {
    authServiceStub.authState$ = of({ uid: 'current-user' } as any);
    authServiceStub.user$ = new BehaviorSubject<any>({ uid: 'current-user', stripeRole: 'pro' });
    userServiceStub.hasIncompleteProfileReads.mockReturnValue(true);
    profileReadStateSubject.next({ status: 'loading', uid: 'current-user' });

    const resultPromise = TestBed.runInInjectionContext(() => aiInsightsGuard(
      {} as any,
      [{ path: 'ai-insights' }] as any
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
      queryParams: { returnUrl: '/ai-insights' },
    });
    expect(authServiceStub.redirectUrl).toBe('/ai-insights');
  });
});
