import { TestBed } from '@angular/core/testing';
import { Analytics } from 'app/firebase/analytics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeferredFirebaseAnalyticsService,
  FIREBASE_ANALYTICS_STARTUP_DELAY_MS,
} from './deferred-firebase-analytics.service';
import { LoggerService } from './logger.service';

describe('DeferredFirebaseAnalyticsService', () => {
  let analyticsFactory: ReturnType<typeof vi.fn>;
  let idleCallbacks: IdleRequestCallback[];
  let originalRequestIdleCallback: typeof window.requestIdleCallback;
  let originalCancelIdleCallback: typeof window.cancelIdleCallback;

  beforeEach(() => {
    vi.useFakeTimers();
    analyticsFactory = vi.fn(() => ({ app: {} }));
    idleCallbacks = [];
    originalRequestIdleCallback = window.requestIdleCallback;
    originalCancelIdleCallback = window.cancelIdleCallback;
    window.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    });
    window.cancelIdleCallback = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        DeferredFirebaseAnalyticsService,
        { provide: Analytics, useFactory: analyticsFactory },
        {
          provide: LoggerService,
          useValue: {
            warn: vi.fn(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
    vi.useRealTimers();
  });

  it('keeps Analytics unresolved until the startup delay and visible idle time have elapsed', () => {
    const service = TestBed.inject(DeferredFirebaseAnalyticsService);
    const task = vi.fn();

    expect(service.run(task)).toBe(true);
    expect(analyticsFactory).not.toHaveBeenCalled();

    vi.advanceTimersByTime(FIREBASE_ANALYTICS_STARTUP_DELAY_MS - 1);
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    expect(analyticsFactory).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(window.requestIdleCallback).toHaveBeenCalledOnce();
    expect(analyticsFactory).not.toHaveBeenCalled();

    idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 20 });

    expect(analyticsFactory).toHaveBeenCalledOnce();
    expect(task).toHaveBeenCalledWith(expect.anything());
  });

  it('flushes queued tasks in order and runs later tasks immediately', () => {
    const service = TestBed.inject(DeferredFirebaseAnalyticsService);
    const calls: string[] = [];

    service.run(() => calls.push('first'));
    service.run(() => calls.push('second'));
    vi.advanceTimersByTime(FIREBASE_ANALYTICS_STARTUP_DELAY_MS);
    idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 20 });
    service.run(() => calls.push('third'));

    expect(calls).toEqual(['first', 'second', 'third']);
    expect(analyticsFactory).toHaveBeenCalledOnce();
  });

  it('uses a delayed fallback when requestIdleCallback is unavailable', () => {
    window.requestIdleCallback = undefined as unknown as typeof window.requestIdleCallback;
    const service = TestBed.inject(DeferredFirebaseAnalyticsService);
    const task = vi.fn();

    service.run(task);
    vi.advanceTimersByTime(FIREBASE_ANALYTICS_STARTUP_DELAY_MS);

    expect(analyticsFactory).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

    expect(analyticsFactory).toHaveBeenCalledOnce();
    expect(task).toHaveBeenCalledOnce();
  });

  it('cancels and reschedules pending idle initialization after user input', () => {
    const service = TestBed.inject(DeferredFirebaseAnalyticsService);

    service.run(vi.fn());
    vi.advanceTimersByTime(FIREBASE_ANALYTICS_STARTUP_DELAY_MS);

    expect(window.requestIdleCallback).toHaveBeenCalledOnce();

    document.dispatchEvent(new Event('pointerdown'));

    expect(window.cancelIdleCallback).toHaveBeenCalledWith(1);
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(2);

    idleCallbacks[1]({ didTimeout: false, timeRemaining: () => 20 });

    expect(analyticsFactory).toHaveBeenCalledOnce();
  });

  it('does not resolve Analytics when no work has requested it', () => {
    TestBed.inject(DeferredFirebaseAnalyticsService);

    vi.advanceTimersByTime(FIREBASE_ANALYTICS_STARTUP_DELAY_MS * 2);

    expect(analyticsFactory).not.toHaveBeenCalled();
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
  });
});
