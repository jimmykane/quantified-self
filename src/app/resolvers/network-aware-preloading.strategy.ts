import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Inject, Injectable, OnDestroy, PLATFORM_ID } from '@angular/core';
import { NavigationStart, PreloadingStrategy, Route, Router } from '@angular/router';
import { Observable, Observer, Subscription, of } from 'rxjs';
import { AppAuthService } from '../authentication/app.auth.service';
import { isPublicStartupDocument } from '../shared/public-startup-route';

const USER_INPUT_COOLDOWN_MS = 750;
const FALLBACK_IDLE_DELAY_MS = 1_500;
const MINIMUM_IDLE_BUDGET_MS = 8;

type IdleCapableWindow = Window & typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
};

type ScheduledWork =
    | { kind: 'idle'; id: number }
    | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

interface PendingPreload {
    load: () => Observable<unknown>;
    observer: Observer<unknown>;
    cancelled: boolean;
}

interface ActivePreload {
    pending: PendingPreload;
    subscription: Subscription;
}

/**
 * Defers optional route downloads until an authenticated workspace is visible
 * and idle. Public, prerendered routes deliberately do not compete with LCP
 * or INP for optional private-route code.
 */
@Injectable({
    providedIn: 'root'
})
export class NetworkAwarePreloadingStrategy implements PreloadingStrategy, OnDestroy {
    private readonly pendingPreloads: PendingPreload[] = [];
    private activePreload: ActivePreload | null = null;
    private scheduledWork: ScheduledWork | null = null;
    private userInputCooldownUntil = 0;
    private routerSubscription: Subscription | null = null;

    private readonly onVisibilityChange = (): void => {
        if (this.documentRef.visibilityState === 'hidden') {
            this.cancelScheduledWork();
            this.pauseActivePreload();
            return;
        }

        this.scheduleNextPreload();
    };

    private readonly onUserInteraction = (): void => {
        this.userInputCooldownUntil = Date.now() + USER_INPUT_COOLDOWN_MS;
        this.cancelScheduledWork();
        this.pauseActivePreload();
        this.scheduleNextPreload();
    };

    constructor(
        @Inject(DOCUMENT) private readonly documentRef: Document,
        @Inject(PLATFORM_ID) private readonly platformId: object,
        private readonly router: Router,
        private readonly authService: AppAuthService,
    ) {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        this.documentRef.addEventListener('visibilitychange', this.onVisibilityChange);
        for (const eventName of ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const) {
            this.documentRef.addEventListener(eventName, this.onUserInteraction, { passive: true });
        }

        this.routerSubscription = this.router.events.subscribe((event) => {
            if (event instanceof NavigationStart) {
                this.cancelAllPreloads();
            }
        });
    }

    preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
        if (route.data?.['preload'] !== true || !this.canPreload()) {
            return of(null);
        }

        return new Observable<unknown>((observer) => {
            const pending: PendingPreload = {
                load,
                observer,
                cancelled: false,
            };
            this.pendingPreloads.push(pending);
            this.scheduleNextPreload();

            return () => this.cancelPendingPreload(pending);
        });
    }

    ngOnDestroy(): void {
        this.documentRef.removeEventListener('visibilitychange', this.onVisibilityChange);
        for (const eventName of ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const) {
            this.documentRef.removeEventListener(eventName, this.onUserInteraction);
        }
        this.routerSubscription?.unsubscribe();
        this.cancelAllPreloads();
    }

    private scheduleNextPreload(): void {
        if (this.activePreload || this.scheduledWork || this.pendingPreloads.length === 0) {
            return;
        }

        if (!this.canPreload()) {
            if (isPublicStartupDocument(this.documentRef) || !this.hasGoodConnection()) {
                this.completePendingPreloads();
            }
            return;
        }

        const cooldownMs = this.userInputCooldownUntil - Date.now();
        if (cooldownMs > 0) {
            this.scheduleTimeout(() => this.scheduleNextPreload(), cooldownMs);
            return;
        }

        const run = (deadline?: IdleDeadline): void => {
            this.scheduledWork = null;
            if (deadline && (deadline.didTimeout || deadline.timeRemaining() < MINIMUM_IDLE_BUDGET_MS)) {
                this.scheduleNextPreload();
                return;
            }
            this.startNextPreload();
        };
        const windowRef = this.documentRef.defaultView as IdleCapableWindow | null;

        if (windowRef?.requestIdleCallback) {
            this.scheduledWork = {
                kind: 'idle',
                id: windowRef.requestIdleCallback(run),
            };
            return;
        }

        this.scheduleTimeout(run, FALLBACK_IDLE_DELAY_MS);
    }

    private startNextPreload(): void {
        if (this.activePreload || !this.canPreload()) {
            this.scheduleNextPreload();
            return;
        }

        const pending = this.pendingPreloads.shift();
        if (!pending || pending.cancelled) {
            this.scheduleNextPreload();
            return;
        }

        const active: ActivePreload = {
            pending,
            subscription: new Subscription(),
        };
        this.activePreload = active;
        let preloadObservable: Observable<unknown>;
        try {
            preloadObservable = pending.load();
        } catch (error) {
            this.finishActivePreload(active, error);
            return;
        }

        const subscription = preloadObservable.subscribe({
            next: (value) => pending.observer.next(value),
            error: (error) => this.finishActivePreload(active, error),
            complete: () => this.finishActivePreload(active),
        });
        if (this.activePreload === active) {
            active.subscription = subscription;
        } else {
            subscription.unsubscribe();
        }
    }

    private finishActivePreload(active: ActivePreload, error?: unknown): void {
        if (this.activePreload !== active) {
            return;
        }

        this.activePreload = null;
        if (error !== undefined) {
            active.pending.observer.error(error);
        } else {
            active.pending.observer.complete();
        }
        this.scheduleNextPreload();
    }

    private cancelPendingPreload(pending: PendingPreload): void {
        pending.cancelled = true;
        const pendingIndex = this.pendingPreloads.indexOf(pending);
        if (pendingIndex !== -1) {
            this.pendingPreloads.splice(pendingIndex, 1);
        }

        if (this.activePreload?.pending === pending) {
            const active = this.activePreload;
            this.activePreload = null;
            active.subscription.unsubscribe();
            this.scheduleNextPreload();
        }
    }

    private cancelAllPreloads(): void {
        this.cancelScheduledWork();
        const active = this.activePreload;
        this.activePreload = null;
        active?.subscription.unsubscribe();
        active?.pending.observer.complete();
        this.completePendingPreloads();
    }

    private pauseActivePreload(): void {
        const active = this.activePreload;
        if (!active) {
            return;
        }

        this.activePreload = null;
        active.subscription.unsubscribe();
        if (!active.pending.cancelled) {
            this.pendingPreloads.unshift(active.pending);
        }
    }

    private completePendingPreloads(): void {
        const pending = this.pendingPreloads.splice(0);
        pending.forEach((item) => item.observer.complete());
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

    private scheduleTimeout(callback: () => void, delayMs: number): void {
        this.scheduledWork = {
            kind: 'timeout',
            id: setTimeout(() => {
                this.scheduledWork = null;
                callback();
            }, delayMs),
        };
    }

    private canPreload(): boolean {
        return isPlatformBrowser(this.platformId)
            && this.documentRef.visibilityState !== 'hidden'
            && !isPublicStartupDocument(this.documentRef)
            && !!this.authService.currentUser
            && this.hasGoodConnection();
    }

    private hasGoodConnection(): boolean {
        if (typeof navigator === 'undefined') {
            return false;
        }

        const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
        return !conn?.saveData && !conn?.effectiveType?.includes('2g');
    }
}
