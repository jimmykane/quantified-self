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
    resultKind: 'aggregate',
    narrative: 'Average cadence improved.',
    query: {
      resultKind: 'aggregate',
      dataType: DataCadenceAvg.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded',
        startDate: '2025-12-01T00:00:00.000Z',
        endDate: '2026-03-01T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'prompt',
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
      activityMix: null,
      bucketCoverage: null,
      trend: null,
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

  it('should reject invalid callable payloads before they reach the page state', async () => {
    functionsServiceMock.call.mockResolvedValue({
      data: {
        status: 'ok',
        narrative: 'Average cadence improved.',
        query: {
          resultKind: 'not-a-real-kind',
          dataType: DataCadenceAvg.type,
          valueType: ChartDataValueTypes.Average,
          categoryType: ChartDataCategoryTypes.DateType,
          requestedTimeInterval: TimeIntervals.Monthly,
          activityTypeGroups: [],
          activityTypes: [ActivityTypes.Cycling],
          dateRange: {
            kind: 'bounded',
            startDate: '2025-12-01T00:00:00.000Z',
            endDate: '2026-03-01T23:59:59.999Z',
            timezone: 'Europe/Helsinki',
            source: 'prompt',
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
          activityMix: null,
          bucketCoverage: null,
          trend: null,
        },
        presentation: {
          title: 'Average cadence over time for Cycling',
          chartType: ChartTypes.LinesVertical,
        },
      },
    });

    await expect(service.runInsight({
      prompt: 'Tell me my avg cadence for cycling the last 3 months',
      clientTimezone: 'Europe/Helsinki',
      clientLocale: 'en-US',
    })).rejects.toThrow('AI Insights returned an invalid response (shape_invalid).');

    await expect(service.runInsight({
      prompt: 'Tell me my avg cadence for cycling the last 3 months',
      clientTimezone: 'Europe/Helsinki',
      clientLocale: 'en-US',
    })).rejects.toMatchObject({
      name: 'AiInsightsError',
      code: 'INTERNAL',
    });
  });

  it('should map function errors into AiInsightsError instances', async () => {
    functionsServiceMock.call.mockRejectedValue({
      code: 'functions/permission-denied',
      message: 'AI Insights is unavailable for this account.',
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
    expect(service.getErrorMessage(new AiInsightsError('PERMISSION_DENIED', 'AI Insights is unavailable for this account.')))
      .toBe('AI Insights is unavailable for this account.');
    expect(service.getErrorMessage(new AiInsightsError(
      'INVALID_ARGUMENT',
      'Could not resolve the location "Grece". Try a city, region, country, or coordinates.',
    ))).toBe('Could not resolve the location "Grece". Try a city, region, country, or coordinates.');
    expect(service.getErrorMessage(new AiInsightsError(
      'INTERNAL',
      'Location filtering is unavailable because MAPBOX_ACCESS_TOKEN is not configured on the backend.',
    ))).toBe('Location filtering is unavailable because MAPBOX_ACCESS_TOKEN is not configured on the backend.');
  });

  it('should map resource exhausted function errors into quota limit errors', async () => {
    functionsServiceMock.call.mockRejectedValue({
      code: 'functions/resource-exhausted',
      message: 'AI Insights limit reached for this billing period.',
    });

    await expect(service.runInsight({
      prompt: 'Average cadence',
      clientTimezone: 'Europe/Helsinki',
    })).rejects.toMatchObject({
      name: 'AiInsightsError',
      code: 'RESOURCE_EXHAUSTED',
    });

    expect(service.getErrorMessage(new AiInsightsError('RESOURCE_EXHAUSTED', 'AI Insights limit reached for this billing period.')))
      .toBe('AI Insights limit reached for this billing period.');
  });
});
