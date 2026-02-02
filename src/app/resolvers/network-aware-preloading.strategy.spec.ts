import { TestBed } from '@angular/core/testing';
import { NetworkAwarePreloadingStrategy } from './network-aware-preloading.strategy';
import { of } from 'rxjs';
import { Route } from '@angular/router';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('NetworkAwarePreloadingStrategy', () => {
    let strategy: NetworkAwarePreloadingStrategy;

    // Mock route and load function
    const mockRoute: Route = { path: 'test' };
    const mockLoad = () => of('loaded');

    beforeEach(() => {
        vi.useFakeTimers();
        TestBed.configureTestingModule({
            providers: [NetworkAwarePreloadingStrategy]
        });
        strategy = TestBed.inject(NetworkAwarePreloadingStrategy);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        // Clean up navigator mock
        delete (navigator as any).connection;
    });

    it('should be created', () => {
        expect(strategy).toBeTruthy();
    });

    it('should preload after delay when connection is good (no connection API)', () => {
        // Case where navigator.connection is undefined (default implementation)
        // It should proceed with preload
        let result: any = undefined;
        strategy.preload(mockRoute, mockLoad).subscribe(r => result = r);

        expect(result).toBeUndefined(); // Should be waiting
        vi.advanceTimersByTime(5000); // Wait for the delay
        expect(result).toBe('loaded');
    });

    it('should NOT preload if saveData is true', () => {
        // Mock navigator.connection
        Object.defineProperty(navigator, 'connection', {
            value: { saveData: true, effectiveType: '4g' },
            configurable: true,
            writable: true
        });

        let result: any = undefined;
        strategy.preload(mockRoute, mockLoad).subscribe(r => result = r);

        vi.advanceTimersByTime(5000);
        expect(result).toBeNull(); // Should return null (no preload)
    });

    it('should NOT preload if effectiveType is 2g', () => {
        // Mock navigator.connection
        Object.defineProperty(navigator, 'connection', {
            value: { saveData: false, effectiveType: '2g' },
            configurable: true,
            writable: true
        });

        let result: any = undefined;
        strategy.preload(mockRoute, mockLoad).subscribe(r => result = r);

        vi.advanceTimersByTime(5000);
        expect(result).toBeNull();
    });

    it('should NOT preload if effectiveType is slow-2g', () => {
        Object.defineProperty(navigator, 'connection', {
            value: { saveData: false, effectiveType: 'slow-2g' },
            configurable: true,
            writable: true
        });

        let result: any = undefined;
        strategy.preload(mockRoute, mockLoad).subscribe(r => result = r);

        vi.advanceTimersByTime(5000);
        expect(result).toBeNull();
    });

    it('should preload after delay if connection is 4g and saveData is false', () => {
        Object.defineProperty(navigator, 'connection', {
            value: { saveData: false, effectiveType: '4g' },
            configurable: true,
            writable: true
        });

        let result: any = undefined;
        strategy.preload(mockRoute, mockLoad).subscribe(r => result = r);

        expect(result).toBeUndefined();
        vi.advanceTimersByTime(5000);
        expect(result).toBe('loaded');
    });
});
