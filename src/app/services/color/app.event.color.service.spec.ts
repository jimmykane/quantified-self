import { TestBed } from '@angular/core/testing';
import { AppEventColorService } from './app.event.color.service';
import { AmChartsService } from '../am-charts.service';
import { LoggerService } from '../logger.service';
import { AppColors } from './app.colors';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('AppEventColorService', () => {
    let service: AppEventColorService;
    let mockAmChartsService: any;
    let mockLoggerService: any;

    beforeEach(() => {
        mockAmChartsService = {
            getCachedCore: vi.fn(),
        };
        mockLoggerService = {
            warn: vi.fn(),
            log: vi.fn(),
            error: vi.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                AppEventColorService,
                { provide: AmChartsService, useValue: mockAmChartsService },
                { provide: LoggerService, useValue: mockLoggerService },
            ],
        });
        service = TestBed.inject(AppEventColorService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('getDifferenceColor', () => {
        it('should return Green for percent <= 2', () => {
            expect(service.getDifferenceColor(0)).toBe(AppColors.Green);
            expect(service.getDifferenceColor(1.5)).toBe(AppColors.Green);
            expect(service.getDifferenceColor(2)).toBe(AppColors.Green);
        });

        it('should return Orange for percent > 2 and <= 5', () => {
            expect(service.getDifferenceColor(2.1)).toBe(AppColors.Orange);
            expect(service.getDifferenceColor(3.5)).toBe(AppColors.Orange);
            expect(service.getDifferenceColor(5)).toBe(AppColors.Orange);
        });

        it('should return Red for percent > 5', () => {
            expect(service.getDifferenceColor(5.1)).toBe(AppColors.Red);
            expect(service.getDifferenceColor(10)).toBe(AppColors.Red);
            expect(service.getDifferenceColor(100)).toBe(AppColors.Red);
        });
    });

    // Basic smoke tests for existing methods to ensure no regressions in injection/setup
    describe('getColorByNumber', () => {
        it('should return a string starting with #', () => {
            const color = service.getColorByNumber(123);
            expect(color).toMatch(/^#[0-9a-fA-F]{6}$/); // Simple hex check may fail if it doesn't pad? Implementation: .toString(16)
            // Implementation: '#' + Math.floor(...).toString(16)
            // If the number is small it might not be 6 chars, but let's check it's hex
            expect(color).toMatch(/^#[0-9a-fA-F]+$/);
        });

        it('should be deterministic', () => {
            expect(service.getColorByNumber(10)).toBe(service.getColorByNumber(10));
            expect(service.getColorByNumber(10)).not.toBe(service.getColorByNumber(11));
        });
    });
});
