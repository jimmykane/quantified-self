import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataCadenceAvg,
  DataDistance,
  DataHeartRateAvg,
  DataHeartRateMax,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

import { normalizeInsightQuery, normalizeInsightQueryFlow, setNormalizeQueryDependenciesForTesting } from './normalize-query.flow';

describe('normalizeInsightQuery', () => {
  afterEach(() => {
    setNormalizeQueryDependenciesForTesting();
    vi.restoreAllMocks();
  });

  it('normalizes average cadence for cycling over the last 3 months', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'avg cadence',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Cycling'],
        dateRange: {
          kind: 'last_n',
          amount: 3,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'tell me my avg cadence for cycling the last 3 months',
      clientTimezone: 'UTC',
    });

    expect(result).toEqual({
      status: 'ok',
      metricKey: 'cadence',
      query: {
        dataType: DataCadenceAvg.type,
        valueType: ChartDataValueTypes.Average,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          startDate: '2025-12-18T00:00:00.000Z',
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'UTC',
        },
        chartType: ChartTypes.LinesVertical,
      },
    });
  });

  it('runs through the Genkit flow schema without duplicate activity enum failures', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'avg cadence',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Cycling'],
        dateRange: {
          kind: 'last_n',
          amount: 3,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQueryFlow({
      prompt: 'tell me my avg cadence for cycling the last 3 months',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.activityTypes).toEqual([ActivityTypes.Cycling]);
  });

  it('accepts the model returning the legacy "last" relative date kind', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'avg cadence',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Cycling'],
        dateRange: {
          kind: 'last',
          amount: 3,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQueryFlow({
      prompt: 'tell me my avg cadence for cycling the last 3 months',
      clientTimezone: 'UTC',
    });

    expect(result).toEqual({
      status: 'ok',
      metricKey: 'cadence',
      query: {
        dataType: DataCadenceAvg.type,
        valueType: ChartDataValueTypes.Average,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          startDate: '2025-12-18T00:00:00.000Z',
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'UTC',
        },
        chartType: ChartTypes.LinesVertical,
      },
    });
  });

  it('normalizes total distance by activity type this year', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'total',
        category: 'activity',
        activityTypes: [],
        dateRange: {
          kind: 'current_period',
          unit: 'year',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my total distance by activity type this year',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dataType).toBe(DataDistance.type);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.ActivityType);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Total);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsHorizontal);
    expect(result.query.dateRange).toEqual({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
    });
  });

  it('defaults to the last 90 days when the model omits a range', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'total',
        category: 'date',
        requestedTimeInterval: 'auto',
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my distance',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dateRange).toEqual({
      startDate: '2025-12-19T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
    });
  });

  it('infers monthly buckets for date-based prompts over the current year', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'total',
        category: 'date',
        requestedTimeInterval: 'auto',
        dateRange: {
          kind: 'current_period',
          unit: 'year',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my distance this year',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Monthly);
    expect(result.query.dateRange).toEqual({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
    });
  });

  it('uses the maximum heart rate data type for highest max heart rate prompts', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'heart rate',
        aggregation: 'maximum',
        category: 'date',
        requestedTimeInterval: 'auto',
        dateRange: {
          kind: 'current_period',
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'What was my highest max heart rate last month',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('heart_rate');
    expect(result.query.dataType).toBe(DataHeartRateMax.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Daily);
  });

  it('keeps the average heart rate data type for highest average heart rate prompts', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'heart rate',
        aggregation: 'maximum',
        category: 'date',
        requestedTimeInterval: 'auto',
        dateRange: {
          kind: 'current_period',
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'What was my highest average heart rate last month',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('heart_rate');
    expect(result.query.dataType).toBe(DataHeartRateAvg.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Daily);
  });

  it('accepts the model returning the legacy "this" current-period kind', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'heart_rate',
        aggregation: 'maximum',
        category: 'date',
        requestedTimeInterval: 'auto',
        dateRange: {
          kind: 'this',
          unit: 'year',
        },
      }),
    });

    const result = await normalizeInsightQueryFlow({
      prompt: 'What was my highest max heart rate this year',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dataType).toBe(DataHeartRateMax.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Monthly);
    expect(result.query.dateRange).toEqual({
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
    });
  });

  it('rejects unsupported split prompts before calling the model', async () => {
    const generateIntent = vi.fn();
    setNormalizeQueryDependenciesForTesting({
      generateIntent,
    });

    const result = await normalizeInsightQuery({
      prompt: 'show cadence per kilometer splits',
      clientTimezone: 'UTC',
    });

    expect(result).toEqual({
      status: 'unsupported',
      reasonCode: 'unsupported_capability',
      suggestedPrompts: expect.any(Array),
    });
    expect(generateIntent).not.toHaveBeenCalled();
  });

  it('rejects ambiguous metric responses from the model', async () => {
    setNormalizeQueryDependenciesForTesting({
      generateIntent: async () => ({
        status: 'unsupported',
        unsupportedReasonCode: 'ambiguous_metric',
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show me that thing from my workouts',
      clientTimezone: 'UTC',
    });

    expect(result).toEqual({
      status: 'unsupported',
      reasonCode: 'ambiguous_metric',
      suggestedPrompts: expect.any(Array),
    });
  });
});
