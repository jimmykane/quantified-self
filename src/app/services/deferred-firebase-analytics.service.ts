import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, Injector, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { Analytics } from 'app/firebase/analytics';
import type { FirebaseAnalyticsType } from 'app/firebase/analytics';
import { LoggerService } from './logger.service';

export const FIREBASE_ANALYTICS_STARTUP_DELAY_MS = 8_000;
const FIREBASE_ANALYTICS_FALLBACK_IDLE_DELAY_MS = 1_500;
const FIREBASE_ANALYTICS_IDLE_TIMEOUT_MS = 5_000;
const MAX_PENDING_ANALYTICS_TASKS = 100;

type AnalyticsTask = (analytics: FirebaseAnalyticsType) => void;

type IdleCapableWindow = Window & typeof globalThis & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type ScheduledAnalyticsWork =
  | { kind: 'idle'; id: number }
  | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

/**
 * Keeps Firebase Analytics out of the critical startup path while preserving
 * tracking calls made before the SDK is ready. Auth and App Check do not depend
 * on this service and continue to initialize eagerly.
 */
@Injectable({ providedIn: 'root' })
export class DeferredFirebaseAnalyticsService implements OnDestroy {
  private readonly documentRef = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly logger = inject(LoggerService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly pendingTasks: AnalyticsTask[] = [];

  private analytics: FirebaseAnalyticsType | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledWork: ScheduledAnalyticsWork | null = null;
  private unavailable = false;
  private startupDelayElapsed = false;
  private interactionListenersAttached = false;

  private readonly onVisibilityChange = (): void => {
    if (this.documentRef.visibilityState === 'hidden') {
      this.cancelScheduledWork();
      return;
    }

    if (this.startupDelayElapsed) {
      this.scheduleIdleInitialization();
    }
  };

  private readonly onUserInteraction = (): void => {
    if (!this.startupDelayElapsed) {
      return;
    }

    this.cancelScheduledWork();
    this.scheduleIdleInitialization();
  };

  run(task: AnalyticsTask): boolean {
    if (!this.isBrowser || this.unavailable) {
      return false;
    }

    if (this.analytics) {
      this.runTask(task, this.analytics);
      return true;
    }

    if (this.pendingTasks.length >= MAX_PENDING_ANALYTICS_TASKS) {
      this.logger.warn('[Analytics] Deferred task queue is full; dropping an analytics task.');
      return false;
    }

    this.pendingTasks.push(task);
    this.attachInteractionListeners();
    this.scheduleInitialization();
    return true;
  }

  ngOnDestroy(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }

    this.cancelScheduledWork();
    this.detachInteractionListeners();
    this.pendingTasks.length = 0;
  }

  private scheduleInitialization(): void {
    if (this.startupTimer || this.startupDelayElapsed) {
      return;
    }

    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      this.startupDelayElapsed = true;
      this.scheduleIdleInitialization();
    }, FIREBASE_ANALYTICS_STARTUP_DELAY_MS);
  }

  private scheduleIdleInitialization(): void {
    if (this.analytics || this.unavailable || this.scheduledWork) {
      return;
    }

    if (this.documentRef.visibilityState === 'hidden') {
      return;
    }

    const windowRef = this.documentRef.defaultView as IdleCapableWindow | null;
    const initialize = (): void => {
      this.scheduledWork = null;
      this.initializeAnalytics();
    };

    if (windowRef?.requestIdleCallback) {
      this.scheduledWork = {
        kind: 'idle',
        id: windowRef.requestIdleCallback(initialize, {
          timeout: FIREBASE_ANALYTICS_IDLE_TIMEOUT_MS,
        }),
      };
      return;
    }

    this.scheduledWork = {
      kind: 'timeout',
      id: setTimeout(initialize, FIREBASE_ANALYTICS_FALLBACK_IDLE_DELAY_MS),
    };
  }

  private initializeAnalytics(): void {
    try {
      const analytics = this.injector.get(Analytics, null);
      if (!analytics) {
        this.markUnavailable();
        return;
      }

      this.analytics = analytics;
      this.detachInteractionListeners();
      const pendingTasks = this.pendingTasks.splice(0);
      pendingTasks.forEach(task => this.runTask(task, analytics));
    } catch (error) {
      this.logger.warn('[Analytics] Deferred initialization failed.', error);
      this.markUnavailable();
    }
  }

  private runTask(task: AnalyticsTask, analytics: FirebaseAnalyticsType): void {
    try {
      task(analytics);
    } catch (error) {
      this.logger.warn('[Analytics] Deferred task failed.', error);
    }
  }

  private markUnavailable(): void {
    this.unavailable = true;
    this.detachInteractionListeners();
    this.pendingTasks.length = 0;
  }

  private cancelScheduledWork(): void {
    if (!this.scheduledWork) {
      return;
    }

    const windowRef = this.documentRef.defaultView as IdleCapableWindow | null;
    if (this.scheduledWork.kind === 'idle') {
      windowRef?.cancelIdleCallback?.(this.scheduledWork.id);
    } else {
      clearTimeout(this.scheduledWork.id);
    }
    this.scheduledWork = null;
  }

  private attachInteractionListeners(): void {
    if (this.interactionListenersAttached) {
      return;
    }

    this.interactionListenersAttached = true;
    this.documentRef.addEventListener('visibilitychange', this.onVisibilityChange);
    for (const eventName of ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const) {
      this.documentRef.addEventListener(eventName, this.onUserInteraction, { passive: true });
    }
  }

  private detachInteractionListeners(): void {
    if (!this.interactionListenersAttached) {
      return;
    }

    this.interactionListenersAttached = false;
    this.documentRef.removeEventListener('visibilitychange', this.onVisibilityChange);
    for (const eventName of ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const) {
      this.documentRef.removeEventListener(eventName, this.onUserInteraction);
    }
  }
}
