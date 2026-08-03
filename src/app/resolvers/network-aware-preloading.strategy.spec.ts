import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Route, Router } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Subject, of, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { NetworkAwarePreloadingStrategy } from './network-aware-preloading.strategy';
import { AppAuthService } from '../authentication/app.auth.service';

describe('NetworkAwarePreloadingStrategy', () => {
    let strategy: NetworkAwarePreloadingStrategy;
    let documentRef: Document;
    let routerEvents: Subject<unknown>;
    let documentListeners: Map<string, EventListener>;
    let authService: { currentUser: { uid: string } | null };

    const preloadRoute: Route = { path: 'test', data: { preload: true } };
    const noPreloadRoute: Route = { path: 'test' };

    beforeEach(() => {
        vi.useFakeTimers();
        documentListeners = new Map<string, EventListener>();
        routerEvents = new Subject<unknown>();
        authService = { currentUser: { uid: 'test-user' } };
        documentRef = {
            location: { pathname: '/dashboard', search: '', hash: '', origin: 'https://quantified-self.io' },
            visibilityState: 'visible',
            defaultView: null,
            addEventListener: vi.fn((name: string, listener: EventListener) => documentListeners.set(name, listener)),
            removeEventListener: vi.fn((name: string) => documentListeners.delete(name)),
        } as unknown as Document;

        TestBed.configureTestingModule({
            providers: [
                NetworkAwarePreloadingStrategy,
                { provide: DOCUMENT, useValue: documentRef },
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: Router, useValue: { events: routerEvents } },
                { provide: AppAuthService, useValue: authService },
            ],
        });
        strategy = TestBed.inject(NetworkAwarePreloadingStrategy);
    });

    afterEach(() => {
        strategy.ngOnDestroy();
        vi.clearAllTimers();
        vi.useRealTimers();
        delete (navigator as Navigator & { connection?: unknown }).connection;
    });

    it('preloads one eligible route during idle time in the visible authenticated app', () => {
        const load = vi.fn(() => of('loaded'));
        let result: unknown;

        strategy.preload(preloadRoute, load).subscribe((value) => result = value);

        expect(load).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1_500);
        expect(load).toHaveBeenCalledTimes(1);
        expect(result).toBe('loaded');
    });

    it('does not preload routes that are not explicitly eligible', () => {
        const load = vi.fn(() => of('loaded'));
        let result: unknown;

        strategy.preload(noPreloadRoute, load).subscribe((value) => result = value);

        expect(load).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('does not preload while the current document is public content', () => {
        (documentRef.location as Location).pathname = '/';
        const load = vi.fn(() => of('loaded'));
        let result: unknown;

        strategy.preload(preloadRoute, load).subscribe((value) => result = value);
        vi.advanceTimersByTime(5_000);

        expect(load).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('does not preload before Firebase has an authenticated user', () => {
        authService.currentUser = null;
        const load = vi.fn(() => of('loaded'));
        let result: unknown;

        strategy.preload(preloadRoute, load).subscribe((value) => result = value);
        vi.advanceTimersByTime(5_000);

        expect(load).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('does not preload on data-saving or 2g connections', () => {
        Object.defineProperty(navigator, 'connection', {
            value: { saveData: true, effectiveType: '4g' },
            configurable: true,
        });
        const load = vi.fn(() => of('loaded'));

        strategy.preload(preloadRoute, load).subscribe();
        vi.advanceTimersByTime(5_000);
        expect(load).not.toHaveBeenCalled();

        Object.defineProperty(navigator, 'connection', {
            value: { saveData: false, effectiveType: 'slow-2g' },
            configurable: true,
        });
        strategy.preload(preloadRoute, load).subscribe();
        vi.advanceTimersByTime(5_000);
        expect(load).not.toHaveBeenCalled();
    });

    it('serializes route downloads and waits again after each route', () => {
        const firstLoad = vi.fn(() => timer(100).pipe(map(() => 'first')));
        const secondLoad = vi.fn(() => of('second'));

        strategy.preload(preloadRoute, firstLoad).subscribe();
        strategy.preload({ ...preloadRoute, path: 'second' }, secondLoad).subscribe();

        vi.advanceTimersByTime(1_500);
        expect(firstLoad).toHaveBeenCalledTimes(1);
        expect(secondLoad).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(secondLoad).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1_500);
        expect(secondLoad).toHaveBeenCalledTimes(1);
    });

    it('continues the queue when a route loader throws synchronously', () => {
        const loadError = new Error('route loader failed');
        const firstLoad = vi.fn(() => {
            throw loadError;
        });
        const secondLoad = vi.fn(() => of('second'));
        let observedError: unknown;

        strategy.preload(preloadRoute, firstLoad).subscribe({
            error: (error) => {
                observedError = error;
            },
        });
        strategy.preload({ ...preloadRoute, path: 'second' }, secondLoad).subscribe();

        vi.advanceTimersByTime(1_500);
        expect(observedError).toBe(loadError);
        expect(secondLoad).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1_500);
        expect(secondLoad).toHaveBeenCalledTimes(1);
    });

    it('yields queued preloads after user interaction', () => {
        const load = vi.fn(() => of('loaded'));

        strategy.preload(preloadRoute, load).subscribe();
        documentListeners.get('pointerdown')?.(new Event('pointerdown'));
        vi.advanceTimersByTime(2_249);
        expect(load).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('pauses an active preload after user interaction and retries it after idle time', () => {
        const download = new Subject<unknown>();
        const load = vi.fn(() => download.asObservable());

        strategy.preload(preloadRoute, load).subscribe();
        vi.advanceTimersByTime(1_500);
        expect(load).toHaveBeenCalledTimes(1);
        expect(download.observers).toHaveLength(1);

        documentListeners.get('pointerdown')?.(new Event('pointerdown'));
        expect(download.observers).toHaveLength(0);

        vi.advanceTimersByTime(2_249);
        expect(load).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1);
        expect(load).toHaveBeenCalledTimes(2);
        expect(download.observers).toHaveLength(1);
    });

    it('waits for an idle callback with enough main-thread budget', () => {
        const idleCallbacks: IdleRequestCallback[] = [];
        const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
            idleCallbacks.push(callback);
            return idleCallbacks.length;
        });
        Object.defineProperty(documentRef, 'defaultView', {
            value: { requestIdleCallback, cancelIdleCallback: vi.fn() },
            configurable: true,
        });
        const load = vi.fn(() => of('loaded'));

        strategy.preload(preloadRoute, load).subscribe();
        idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 0 });
        expect(load).not.toHaveBeenCalled();
        expect(requestIdleCallback).toHaveBeenCalledTimes(2);

        idleCallbacks[1]({ didTimeout: true, timeRemaining: () => 20 });
        expect(load).not.toHaveBeenCalled();
        expect(requestIdleCallback).toHaveBeenCalledTimes(3);

        idleCallbacks[2]({ didTimeout: false, timeRemaining: () => 8 });
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('cancels browser idle work while hidden and resumes it when visible', () => {
        const idleCallbacks: IdleRequestCallback[] = [];
        const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
            idleCallbacks.push(callback);
            return idleCallbacks.length;
        });
        const cancelIdleCallback = vi.fn();
        Object.defineProperty(documentRef, 'defaultView', {
            value: { requestIdleCallback, cancelIdleCallback },
            configurable: true,
        });
        const load = vi.fn(() => of('loaded'));

        strategy.preload(preloadRoute, load).subscribe();
        expect(requestIdleCallback).toHaveBeenCalledTimes(1);

        Object.defineProperty(documentRef, 'visibilityState', { value: 'hidden', configurable: true });
        documentListeners.get('visibilitychange')?.(new Event('visibilitychange'));
        expect(cancelIdleCallback).toHaveBeenCalledWith(1);
        expect(load).not.toHaveBeenCalled();

        Object.defineProperty(documentRef, 'visibilityState', { value: 'visible', configurable: true });
        documentListeners.get('visibilitychange')?.(new Event('visibilitychange'));
        expect(requestIdleCallback).toHaveBeenCalledTimes(2);

        idleCallbacks[1]({ didTimeout: false, timeRemaining: () => 20 });
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('pauses an active preload while hidden and retries it after the tab becomes visible', () => {
        const download = new Subject<unknown>();
        const load = vi.fn(() => download.asObservable());

        strategy.preload(preloadRoute, load).subscribe();
        vi.advanceTimersByTime(1_500);
        expect(load).toHaveBeenCalledTimes(1);
        expect(download.observers).toHaveLength(1);

        Object.defineProperty(documentRef, 'visibilityState', { value: 'hidden', configurable: true });
        documentListeners.get('visibilitychange')?.(new Event('visibilitychange'));
        expect(download.observers).toHaveLength(0);

        vi.advanceTimersByTime(5_000);
        expect(load).toHaveBeenCalledTimes(1);

        Object.defineProperty(documentRef, 'visibilityState', { value: 'visible', configurable: true });
        documentListeners.get('visibilitychange')?.(new Event('visibilitychange'));
        vi.advanceTimersByTime(1_500);

        expect(load).toHaveBeenCalledTimes(2);
        expect(download.observers).toHaveLength(1);
    });

    it('cancels queued work when navigation begins', () => {
        const load = vi.fn(() => of('loaded'));

        strategy.preload(preloadRoute, load).subscribe();
        routerEvents.next(new NavigationStart(1, '/settings'));
        vi.advanceTimersByTime(5_000);

        expect(load).not.toHaveBeenCalled();
    });

    it('does not preload during server rendering', () => {
        strategy.ngOnDestroy();
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                NetworkAwarePreloadingStrategy,
                { provide: DOCUMENT, useValue: documentRef },
                { provide: PLATFORM_ID, useValue: 'server' },
                { provide: Router, useValue: { events: routerEvents } },
                { provide: AppAuthService, useValue: authService },
            ],
        });
        strategy = TestBed.inject(NetworkAwarePreloadingStrategy);
        const load = vi.fn(() => of('loaded'));
        let result: unknown;

        strategy.preload(preloadRoute, load).subscribe((value) => result = value);

        expect(load).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });
});
