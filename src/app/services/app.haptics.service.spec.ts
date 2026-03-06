import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppHapticsService } from './app.haptics.service';
import { BrowserCompatibilityService } from './browser.compatibility.service';
import { AppWindowService } from './app.window.service';

describe('AppHapticsService', () => {
    let service: AppHapticsService;
    let checkVibrationSupport: ReturnType<typeof vi.fn>;
    let vibrate: ReturnType<typeof vi.fn>;
    let matchMedia: ReturnType<typeof vi.fn>;

    const setMatchMedia = (map: Record<string, boolean>) => {
        matchMedia.mockImplementation((query: string) => ({ matches: !!map[query] }));
    };

    beforeEach(() => {
        checkVibrationSupport = vi.fn().mockReturnValue(true);
        vibrate = vi.fn().mockReturnValue(true);
        matchMedia = vi.fn();
        setMatchMedia({
            '(pointer: coarse)': true,
            '(prefers-reduced-motion: reduce)': false
        });

        TestBed.configureTestingModule({
            providers: [
                AppHapticsService,
                { provide: BrowserCompatibilityService, useValue: { checkVibrationSupport } },
                {
                    provide: AppWindowService,
                    useValue: {
                        windowRef: {
                            navigator: { vibrate },
                            matchMedia
                        }
                    }
                }
            ]
        });

        service = TestBed.inject(AppHapticsService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should trigger a selection vibration on supported touch devices', () => {
        expect(service.selection()).toBe(true);
        expect(vibrate).toHaveBeenCalledWith(8);
    });

    it('should not vibrate when vibration API is unsupported', () => {
        checkVibrationSupport.mockReturnValue(false);
        expect(service.selection()).toBe(false);
        expect(vibrate).not.toHaveBeenCalled();
    });

    it('should not vibrate when reduced motion is enabled', () => {
        setMatchMedia({
            '(pointer: coarse)': true,
            '(prefers-reduced-motion: reduce)': true
        });

        expect(service.selection()).toBe(false);
        expect(vibrate).not.toHaveBeenCalled();
    });

    it('should not vibrate on non-touch pointers when pointer media is available', () => {
        setMatchMedia({
            '(pointer: coarse)': false,
            '(prefers-reduced-motion: reduce)': false
        });

        expect(service.selection()).toBe(false);
        expect(vibrate).not.toHaveBeenCalled();
    });

    it('should return false when vibrate throws', () => {
        vibrate.mockImplementation(() => {
            throw new Error('vibrate failed');
        });

        expect(service.selection()).toBe(false);
    });

    it('should use the success haptic pattern', () => {
        service.success();
        expect(vibrate).toHaveBeenCalledWith([10, 30, 20]);
    });

    it('should use the warning haptic pattern', () => {
        service.warning();
        expect(vibrate).toHaveBeenCalledWith([20, 30, 20]);
    });

    it('should use the error haptic pattern', () => {
        service.error();
        expect(vibrate).toHaveBeenCalledWith([30, 40, 30, 40, 40]);
    });
});
