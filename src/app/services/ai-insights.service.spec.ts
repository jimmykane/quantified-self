import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataCadenceAvg,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { AiInsightsResponse } from '@shared/ai-insights.types';
import { AiInsightsError, AiInsightsService } from './ai-insights.service';
import { AppFunctionsService } from './app.functions.service';

describe('AiInsightsService', () => {
  const functionsServiceMock = {
    call: vi.fn(),
  };

  let service: AiInsightsService;

  const response: AiInsightsResponse = {
    status: 'ok',
    narrative: 'Average cadence improved.',
    query: {
      dataType: DataCadenceAvg.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        startDate: '2025-12-01',
        endDate: '2026-03-01',
        timezone: 'Europe/Helsinki',
      },
      chartType: ChartTypes.LinesVertical,
    },
    aggregation: {
      dataType: DataCadenceAvg.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [],
    },
    summary: {
      matchedEventCount: 0,
      overallAggregateValue: null,
      peakBucket: null,
      lowestBucket: null,
      latestBucket: null,
    },
    presentation: {
      title: 'Average cadence over time for Cycling',
      chartType: ChartTypes.LinesVertical,
    },
  };

  beforeEach(() => {
    functionsServiceMock.call.mockReset();

    TestBed.configureTestingModule({
      providers: [
        AiInsightsService,
        { provide: AppFunctionsService, useValue: functionsServiceMock },
      ],
    });

    service = TestBed.inject(AiInsightsService);
  });

  it('should call aiInsights and unwrap the typed response payload', async () => {
    functionsServiceMock.call.mockResolvedValue({ data: response });

    const result = await service.runInsight({
      prompt: 'Tell me my avg cadence for cycling the last 3 months',
      clientTimezone: 'Europe/Helsinki',
      clientLocale: 'en-US',
    });

    expect(functionsServiceMock.call).toHaveBeenCalledWith('aiInsights', {
      prompt: 'Tell me my avg cadence for cycling the last 3 months',
      clientTimezone: 'Europe/Helsinki',
      clientLocale: 'en-US',
    });
    expect(result).toEqual(response);
  });

  it('should map function errors into AiInsightsError instances', async () => {
    functionsServiceMock.call.mockRejectedValue({
      code: 'functions/permission-denied',
      message: 'AI Insights is a Pro feature. Please upgrade to Pro.',
    });

    await expect(service.runInsight({
      prompt: 'Average cadence',
      clientTimezone: 'Europe/Helsinki',
    })).rejects.toMatchObject({
      name: 'AiInsightsError',
      code: 'PERMISSION_DENIED',
    });
  });

  it('should provide a friendly error message for mapped errors', () => {
    expect(service.getErrorMessage(new AiInsightsError('APP_CHECK_REQUIRED', 'App Check verification failed.')))
      .toBe('App verification failed. Refresh the page and try again.');
  });
});
