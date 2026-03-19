import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAuthService } from './app.auth.service';
import { aiInsightsGuard } from './ai-insights.guard';
import { LoggerService } from '../services/logger.service';

describe('aiInsightsGuard', () => {
  let authServiceStub: Partial<AppAuthService>;

  beforeEach(() => {
    authServiceStub = {
      user$: of(null),
    };

    const routerSpy = {
      createUrlTree: vi.fn().mockImplementation((commands) => ({
        toString: () => commands.join('/'),
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AppAuthService, useValue: authServiceStub },
        { provide: Router, useValue: routerSpy },
        { provide: LoggerService, useValue: { log: vi.fn(), error: vi.fn() } },
      ],
    });
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

  it('should redirect a lapsed onboarded user to subscriptions', async () => {
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

    expect(result).not.toBe(true);
    expect(result).not.toBe(false);
    expect((result as any).toString()).toContain('/subscriptions');
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
});
