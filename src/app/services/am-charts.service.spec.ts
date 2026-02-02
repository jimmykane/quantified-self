import { TestBed } from '@angular/core/testing';
import { AmChartsService } from './am-charts.service';
import { LoggerService } from './logger.service';
import { ChartThemes } from '@sports-alliance/sports-lib';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('AmChartsService', () => {
    let service: AmChartsService;
    let loggerMock: any;
    let mockCore: any;

    beforeEach(() => {
        loggerMock = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        };
        mockCore = {
            unuseAllThemes: vi.fn(),
            useTheme: vi.fn(),
            options: {},
            color: (c: string) => c
        };

        TestBed.configureTestingModule({
            providers: [
                AmChartsService,
                { provide: LoggerService, useValue: loggerMock }
            ]
        });
        service = TestBed.inject(AmChartsService);

        // Mock load() to return our mock core directly
        vi.spyOn(service, 'load').mockResolvedValue({
            core: mockCore,
            charts: {} as any
        });
    });

    it('should set theme and log when called first time', async () => {
        await service.setChartTheme(ChartThemes.Dark, false);

        expect(mockCore.unuseAllThemes).toHaveBeenCalled();
        expect(loggerMock.log).toHaveBeenCalledWith(expect.stringContaining('Setting chart theme to: dark'));
    });

    it('should NOT set theme if called again with same values (idempotency)', async () => {
        // First call
        await service.setChartTheme(ChartThemes.Dark, false);

        // Reset spies
        loggerMock.log.mockClear();
        mockCore.unuseAllThemes.mockClear();

        // Second call - should be ignored
        await service.setChartTheme(ChartThemes.Dark, false);

        expect(mockCore.unuseAllThemes).not.toHaveBeenCalled();
        expect(loggerMock.log).not.toHaveBeenCalled();
    });

    it('should set theme if called with DIFFERENT values', async () => {
        // First call
        await service.setChartTheme(ChartThemes.Dark, false);

        // Reset spies
        loggerMock.log.mockClear();
        mockCore.unuseAllThemes.mockClear();

        // Second call with different theme
        await service.setChartTheme(ChartThemes.Material, false);

        expect(mockCore.unuseAllThemes).toHaveBeenCalled();
        expect(loggerMock.log).toHaveBeenCalledWith(expect.stringContaining('Setting chart theme to: material'));
    });
});
