import { TestBed } from '@angular/core/testing';
import { MapStyleService } from './map-style.service';
import { LoggerService } from './logger.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('MapStyleService', () => {
    let service: MapStyleService;
    let loggerMock: any;

    beforeEach(() => {
        loggerMock = {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn()
        };

        TestBed.configureTestingModule({
            providers: [
                MapStyleService,
                { provide: LoggerService, useValue: loggerMock }
            ]
        });
        service = TestBed.inject(MapStyleService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('resolve', () => {
        it('should return standard style with preset for default style', () => {
            const result = service.resolve('default', AppThemes.Normal);
            expect(result.styleUrl).toBe(service.standard);
            expect(result.preset).toBe('day');
        });

        it('should return standard satellite style with preset for satellite', () => {
            const result = service.resolve('satellite', AppThemes.Dark);
            expect(result.styleUrl).toBe(service.standardSatellite);
            expect(result.preset).toBe('night');
        });

        it('should return outdoors style without preset', () => {
            const result = service.resolve('outdoors', AppThemes.Normal);
            expect(result.styleUrl).toBe(service.outdoors);
            expect(result.preset).toBeUndefined();
        });

        it('should handle undefined map style as default', () => {
            const result = service.resolve(undefined, AppThemes.Normal);
            expect(result.styleUrl).toBe(service.standard);
        });
    });

    describe('isStandard', () => {
        it('should return true for standard style', () => {
            expect(service.isStandard(service.standard)).toBe(true);
        });

        it('should return true for standard satellite style', () => {
            expect(service.isStandard(service.standardSatellite)).toBe(true);
        });

        it('should return false for other styles', () => {
            expect(service.isStandard('mapbox://styles/mapbox/outdoors-v12')).toBe(false);
            expect(service.isStandard(undefined)).toBe(false);
        });
    });

    describe('getPreset', () => {
        it('should return day for Light theme', () => {
            expect(service.getPreset(AppThemes.Normal)).toBe('day');
        });

        it('should return night for Dark theme', () => {
            expect(service.getPreset(AppThemes.Dark)).toBe('night');
        });
    });

    describe('adjustColorForTheme', () => {
        it('should return original color if not Dark theme', () => {
            const color = '#000000';
            const result = service.adjustColorForTheme(color, AppThemes.Normal);
            expect(result).toBe(color);
        });

        it('should return original color if color is invalid', () => {
            const invalidColor = 'invalid';
            const result = service.adjustColorForTheme(invalidColor, AppThemes.Dark);
            expect(result).toBe(invalidColor);
        });

        it('should lighten dark colors in Dark theme', () => {
            // Dark blue-ish color
            const darkColor = '#000033';
            const result = service.adjustColorForTheme(darkColor, AppThemes.Dark);

            // Should be lighter. We can check if it's not equal to original and roughly valid hex
            expect(result).not.toBe(darkColor);
            expect(result).toMatch(/^#[0-9a-f]{6}$/i);
        });

        it('should handle 3-digit hex codes', () => {
            const darkColor = '#003'; // #000033
            const result = service.adjustColorForTheme(darkColor, AppThemes.Dark);
            expect(result).not.toBe(darkColor);
            expect(result).toMatch(/^#[0-9a-f]{6}$/i);
            // Verify expansion
            // #000033 might be lightened. 
            // Logic check: r=0,g=0,b=0.2. max=0.2. L=0.1. 
            // targetL=0.7. L becomes 0.7. s becomes small max.
            // It definitely changes.
        });

        it('should not lighten already light colors excessively', () => {
            const lightColor = '#ffffff';
            const result = service.adjustColorForTheme(lightColor, AppThemes.Dark);
            // It should probably stay white or close to it, effectively being #ffffff
            expect(result.toLowerCase()).toBe('#ffffff');
        });
    });
});
