import { TestBed } from '@angular/core/testing';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import type { AiInsightsQuotaStatusResponse } from '@shared/ai-insights.types';
import { AppFunctionsService } from './app.functions.service';
import { AiInsightsQuotaService } from './ai-insights-quota.service';
import { LoggerService } from './logger.service';

describe('AiInsightsQuotaService', () => {
  const functionsServiceMock = {
    call: vi.fn(),
  };
  const loggerMock = {
    warn: vi.fn(),
  };

  let service: AiInsightsQuotaService;

  beforeEach(() => {
    functionsServiceMock.call.mockReset();
    loggerMock.warn.mockReset();

    TestBed.configureTestingModule({
      providers: [
        AiInsightsQuotaService,
        { provide: AppFunctionsService, useValue: functionsServiceMock },
        { provide: LoggerService, useValue: loggerMock },
      ],
    });

    service = TestBed.inject(AiInsightsQuotaService);
  });

  it('should call the quota status callable and unwrap the response payload', async () => {
    const quotaStatus: AiInsightsQuotaStatusResponse = {
      role: 'pro',
      limit: 100,
      successfulRequestCount: 12,
      activeRequestCount: 0,
      remainingCount: 88,
      periodStart: '2026-03-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      periodKind: 'subscription',
      resetMode: 'date',
      isEligible: true,
      blockedReason: null,
    };
    functionsServiceMock.call.mockResolvedValue({ data: quotaStatus });

    const result = await service.loadQuotaStatus();

    expect(functionsServiceMock.call).toHaveBeenCalledWith('getAiInsightsQuotaStatus');
    expect(result).toEqual(quotaStatus);
  });

  it('should swallow callable failures and return null', async () => {
    const error = new Error('quota failed');
    functionsServiceMock.call.mockRejectedValue(error);

    const result = await service.loadQuotaStatus();

    expect(result).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith('[AiInsightsQuotaService] Failed to load AI Insights quota status.', error);
  });
});
