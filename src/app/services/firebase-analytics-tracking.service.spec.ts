import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Analytics } from 'app/firebase/analytics';
import { Auth } from 'app/firebase/auth';
import { logEvent, setUserId } from 'firebase/analytics';
import { LoggerService } from './logger.service';
import { FirebaseAnalyticsTrackingService } from './firebase-analytics-tracking.service';

const hoisted = vi.hoisted(() => ({
  mockUserObservableFactory: vi.fn(),
}));

vi.mock('app/firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/firebase/auth')>();
  return {
    ...actual,
    user: (...args: unknown[]) => hoisted.mockUserObservableFactory(...args),
  };
});

vi.mock('firebase/analytics', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    logEvent: vi.fn(),
    setUserId: vi.fn(),
  };
});

describe('FirebaseAnalyticsTrackingService', () => {
  let authUser$: BehaviorSubject<{ uid: string } | null>;
  let routerEvents$: Subject<unknown>;
  let logger: Pick<LoggerService, 'warn' | 'error' | 'log'>;

  class DashboardPageComponent { }

  beforeEach(() => {
    vi.clearAllMocks();
    authUser$ = new BehaviorSubject<{ uid: string } | null>(null);
    routerEvents$ = new Subject<unknown>();
    hoisted.mockUserObservableFactory.mockReturnValue(authUser$.asObservable());
    logger = {
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    };
  });

  afterEach(() => {
    authUser$.complete();
    routerEvents$.complete();
  });

  it('tracks screen views and analytics user ids', () => {
    TestBed.configureTestingModule({
      providers: [
        FirebaseAnalyticsTrackingService,
        { provide: Analytics, useValue: {} },
        { provide: Auth, useValue: {} },
        {
          provide: Router,
          useValue: {
            events: routerEvents$.asObservable(),
            routerState: {
              snapshot: {
                root: {
                  firstChild: {
                    firstChild: {
                      firstChild: null,
                      routeConfig: { component: DashboardPageComponent },
                    },
                  },
                },
              },
            },
          },
        },
        { provide: LoggerService, useValue: logger },
      ],
    });

    const service = TestBed.inject(FirebaseAnalyticsTrackingService);
    expect(service).toBeTruthy();

    routerEvents$.next(new NavigationEnd(1, '/dashboard', '/dashboard?tab=all#details'));
    authUser$.next({ uid: 'user-123' });

    expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'screen_view', {
      firebase_screen: '/dashboard',
      firebase_screen_class: 'DashboardPageComponent',
    });
    expect(setUserId).toHaveBeenCalledWith(expect.anything(), 'user-123');
  });

  it('falls back to AppComponent screen class when route component is unavailable', () => {
    TestBed.configureTestingModule({
      providers: [
        FirebaseAnalyticsTrackingService,
        { provide: Analytics, useValue: {} },
        { provide: Auth, useValue: {} },
        {
          provide: Router,
          useValue: {
            events: routerEvents$.asObservable(),
            routerState: {
              snapshot: {
                root: {
                  firstChild: {
                    firstChild: null,
                    routeConfig: {},
                  },
                },
              },
            },
          },
        },
        { provide: LoggerService, useValue: logger },
      ],
    });

    const service = TestBed.inject(FirebaseAnalyticsTrackingService);
    expect(service).toBeTruthy();

    routerEvents$.next(new NavigationEnd(1, '/dashboard', '/dashboard'));

    expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'screen_view', {
      firebase_screen: '/dashboard',
      firebase_screen_class: 'AppComponent',
    });
  });

  it('does nothing when analytics is not provided', () => {
    TestBed.configureTestingModule({
      providers: [
        FirebaseAnalyticsTrackingService,
        { provide: Auth, useValue: {} },
        {
          provide: Router,
          useValue: {
            events: routerEvents$.asObservable(),
          },
        },
        { provide: LoggerService, useValue: logger },
      ],
    });

    const service = TestBed.inject(FirebaseAnalyticsTrackingService);
    expect(service).toBeTruthy();

    routerEvents$.next(new NavigationEnd(1, '/dashboard', '/dashboard'));
    authUser$.next({ uid: 'user-123' });

    expect(logEvent).not.toHaveBeenCalled();
    expect(setUserId).not.toHaveBeenCalled();
    expect(hoisted.mockUserObservableFactory).not.toHaveBeenCalled();
  });
});
