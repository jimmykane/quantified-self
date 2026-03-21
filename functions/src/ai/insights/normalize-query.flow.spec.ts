import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAerobicTrainingEffect,
  DataAnaerobicTrainingEffect,
  DataAscent,
  DataCadenceAvg,
  DataDistance,
  DataDuration,
  DataEffortPaceAvg,
  DataGradeAdjustedPaceAvg,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataJumpDistanceMax,
  DataJumpHangTimeMax,
  DataJumpHeightAvg,
  DataJumpHeightMax,
  DataPowerAvg,
  DataPowerNormalized,
  DataPowerTrainingStressScore,
  DataRecoveryTime,
  DataSwimPaceAvg,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

import {
  createNormalizeQuery,
  type NormalizeQueryApi,
  type NormalizeQueryDependencies,
} from './normalize-query.flow';
import { getActivityTypesForGroup } from '../../../../shared/activity-type-group.metadata';

let normalizeQuerySubject = createNormalizeQuery();

function setNormalizeQueryDependenciesForTesting(
  dependencies: Partial<NormalizeQueryDependencies> = {},
): void {
  normalizeQuerySubject = createNormalizeQuery(dependencies);
}

async function withNormalizeQueryDependenciesForTesting<T>(
  dependencies: Partial<NormalizeQueryDependencies>,
  run: () => Promise<T> | T,
): Promise<T> {
  const previousSubject = normalizeQuerySubject;
  normalizeQuerySubject = createNormalizeQuery(dependencies);
  try {
    return await run();
  } finally {
    normalizeQuerySubject = previousSubject;
  }
}

async function normalizeInsightQuery(
  ...args: Parameters<NormalizeQueryApi['normalizeInsightQuery']>
): ReturnType<NormalizeQueryApi['normalizeInsightQuery']> {
  return normalizeQuerySubject.normalizeInsightQuery(...args);
}

async function normalizeInsightQueryFlow(
  ...args: Parameters<NormalizeQueryApi['normalizeInsightQueryFlow']>
): ReturnType<NormalizeQueryApi['normalizeInsightQueryFlow']> {
  return normalizeQuerySubject.normalizeInsightQueryFlow(...args);
}

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
        resultKind: 'aggregate',
        dataType: DataCadenceAvg.type,
        valueType: ChartDataValueTypes.Average,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-18T00:00:00.000Z',
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
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
        resultKind: 'aggregate',
        dataType: DataCadenceAvg.type,
        valueType: ChartDataValueTypes.Average,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-18T00:00:00.000Z',
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
    });
  });

  it('scopes normalize-query dependencies and restores previous test dependencies', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'total',
        category: 'date',
        dateRange: {
          kind: 'current_period',
          unit: 'year',
        },
      }),
    });

    const scopedResult = await withNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-01-15T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'total',
        category: 'date',
        dateRange: {
          kind: 'current_period',
          unit: 'year',
        },
      }),
    }, async () => normalizeInsightQuery({
      prompt: 'show my total distance this year',
      clientTimezone: 'UTC',
    }));

    const restoredResult = await normalizeInsightQuery({
      prompt: 'show my total distance this year',
      clientTimezone: 'UTC',
    });

    expect(scopedResult.status).toBe('ok');
    expect(restoredResult.status).toBe('ok');
    if (scopedResult.status !== 'ok' || restoredResult.status !== 'ok') {
      return;
    }

    expect(scopedResult.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-01-15T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    });
    expect(restoredResult.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
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
    expect(result.query.activityTypeGroups).toEqual([]);
    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    });
  });

  it('normalizes explicit calendar-year prompts such as "in year 2024"', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'how much ascent did i do in year 2024 as a total per sport',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dataType).toBe(DataAscent.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Total);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.ActivityType);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsHorizontal);
    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-12-31T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    });
  });

  it('normalizes heart-rate token variants such as heartrate and question-form activity grouping', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'what activities had the max heartrate in 2024 and 2025',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('heart_rate');
    expect(result.query.dataType).toBe(DataHeartRateMax.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.ActivityType);
    expect(result.query.periodMode).toBe('combined');
    expect(result.query.requestedDateRanges).toEqual([
      {
        kind: 'bounded',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
    ]);
  });

  it('resolves date-based year lists to compare mode with yearly buckets', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'compare my max heart rate in 2024 and 2025',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.DateType);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Yearly);
    expect(result.query.periodMode).toBe('compare');
    expect(result.query.requestedDateRanges).toEqual([
      {
        kind: 'bounded',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
    ]);
  });

  it('honors explicit column chart wording for sparse multi-year comparisons', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'compare my max heart rate in 2024 and 2026 as columns?',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('heart_rate');
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.DateType);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Yearly);
    expect(result.query.periodMode).toBe('compare');
    expect(result.query.chartType).toBe(ChartTypes.ColumnsVertical);
    expect(result.query.requestedDateRanges).toEqual([
      {
        kind: 'bounded',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
      {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
    ]);
  });

  it('keeps total multi-year prompts in combined mode', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my total ascent in 2024 and 2025',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.valueType).toBe(ChartDataValueTypes.Total);
    expect(result.query.periodMode).toBe('combined');
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Auto);
  });

  it('defaults ambiguous multi-year prompts to combined mode', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my average heart rate in 2024 and 2025',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.periodMode).toBe('combined');
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Auto);
  });

  it('sorts comma-separated year lists and collapses contiguous years into one exact requested window', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my max heart rate in 2025, 2024',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.requestedDateRanges).toEqual([
      {
        kind: 'bounded',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
    ]);
  });

  it('keeps discrete year lists as separate requested windows', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my max heart rate in 2024, 2026',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.requestedDateRanges).toEqual([
      {
        kind: 'bounded',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
      {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
    ]);
  });

  it('normalizes explicit month-year prompts such as "in January 2024"', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my total distance per sport in january 2024',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dataType).toBe(DataDistance.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Total);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.ActivityType);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsHorizontal);
    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-01-31T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    });
  });

  it('normalizes quarter prompts such as "in Q1 2024"', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my total distance by sport in q1 2024',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dataType).toBe(DataDistance.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Total);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.ActivityType);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsHorizontal);
    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2024-01-01T00:00:00.000Z',
      endDate: '2024-03-31T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    });
  });

  it('normalizes half-year prompts such as "in H2 2024"', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-20T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my total ascent by sport in h2 2024',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dataType).toBe(DataAscent.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Total);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.ActivityType);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsHorizontal);
    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2024-07-01T00:00:00.000Z',
      endDate: '2024-12-31T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    });
  });

  it('forces date columns when prompt asks for stacked activity-type columns over time', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'max heart rate',
        aggregation: 'maximum',
        category: 'activity',
        activityTypes: [],
        dateRange: {
          kind: 'last_n',
          amount: 1,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my max heart rate last month as stacked columns by activity type over time',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dataType).toBe(DataHeartRateMax.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.DateType);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsVertical);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Weekly);
  });

  it('keeps stacked date columns for last 5 months by activity type over time prompts', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'max heart rate',
        aggregation: 'maximum',
        category: 'activity',
        activityTypes: [],
        dateRange: {
          kind: 'last_n',
          amount: 5,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my max heart rate last 5 months as stacked columns by activity type over time',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dataType).toBe(DataHeartRateMax.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.DateType);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsVertical);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Monthly);
  });

  it('resolves singular longest-event prompts to event lookup mode', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'maximum',
        category: 'date',
        activityTypes: ['Cycling'],
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'I want to know when I had my longest distance in cycling',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('distance');
    expect(result.query.resultKind).toBe('event_lookup');
    expect(result.query.dataType).toBe(DataDistance.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.DateType);
    expect(result.query.activityTypes).toEqual([ActivityTypes.Cycling]);
    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-19T23:59:59.999Z',
      timezone: 'UTC',
      source: 'default',
    });
  });

  it('maps longest jump prompts to jump-distance event lookup by default', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Find my longest jump.',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('jump_distance');
    expect(result.query.resultKind).toBe('event_lookup');
    expect(result.query.dataType).toBe(DataJumpDistanceMax.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
  });

  it('maps highest jump prompts to jump-height event lookup by default', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Find my highest jump.',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('jump_height');
    expect(result.query.resultKind).toBe('event_lookup');
    expect(result.query.dataType).toBe(DataJumpHeightMax.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
  });

  it('maps biggest hang-time prompts to jump-hang-time event lookup by default', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Find my biggest hang time.',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('jump_hang_time');
    expect(result.query.resultKind).toBe('event_lookup');
    expect(result.query.dataType).toBe(DataJumpHangTimeMax.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
  });

  it('keeps jump-height over-time prompts in aggregate mode', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my jump height over time in the last 90 days.',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('jump_height');
    expect(result.query.resultKind).toBe('aggregate');
    expect(result.query.dataType).toBe(DataJumpHeightAvg.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Average);
  });

  it('resolves latest ride prompts to latest_event mode with cycling filters', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'When was my last ride?',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBeUndefined();
    expect(result.query.resultKind).toBe('latest_event');
    expect(result.query.activityTypes).toEqual([ActivityTypes.Cycling]);
    expect(result.query.dateRange.kind).toBe('bounded');
    if (result.query.dateRange.kind !== 'bounded') {
      return;
    }
    expect(result.query.dateRange.startDate).toBe('2026-01-01T00:00:00.000Z');
    expect(result.query.dateRange.endDate).toBe('2026-03-19T23:59:59.999Z');
  });

  it('keeps explicit date ranges for latest-event prompts', async () => {
    const result = await normalizeInsightQuery({
      prompt: 'When was my last ride in 2023?',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.resultKind).toBe('latest_event');
    expect(result.query.dateRange.kind).toBe('bounded');
    if (result.query.dateRange.kind !== 'bounded') {
      return;
    }
    expect(result.query.dateRange.startDate).toBe('2023-01-01T00:00:00.000Z');
    expect(result.query.dateRange.endDate).toBe('2023-12-31T23:59:59.999Z');
  });

  it('resolves latest run and latest swim prompts to activity aliases', async () => {
    const latestRunResult = await normalizeInsightQuery({
      prompt: 'latest run',
      clientTimezone: 'UTC',
    });
    expect(latestRunResult.status).toBe('ok');
    if (latestRunResult.status === 'ok') {
      expect(latestRunResult.query.resultKind).toBe('latest_event');
      expect(latestRunResult.query.activityTypes).toEqual([ActivityTypes.Running]);
    }

    const latestSwimResult = await normalizeInsightQuery({
      prompt: 'last swim',
      clientTimezone: 'UTC',
    });
    expect(latestSwimResult.status).toBe('ok');
    if (latestSwimResult.status === 'ok') {
      expect(latestSwimResult.query.resultKind).toBe('latest_event');
      expect(latestSwimResult.query.activityTypes).toEqual([ActivityTypes.Swimming]);
    }
  });

  it('keeps latest metric prompts in metric mode instead of latest_event mode', async () => {
    const result = await normalizeInsightQuery({
      prompt: 'latest average cadence',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('cadence');
    expect(result.query.resultKind).toBe('aggregate');
    expect(result.query.dataType).toBe(DataCadenceAvg.type);
  });

  it('does not treat verb "run" as an activity type alias', async () => {
    const result = await normalizeInsightQuery({
      prompt: 'run a distance comparison by activity type',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.resultKind).toBe('aggregate');
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.ActivityType);
    expect(result.query.activityTypes).toEqual([]);
  });

  it('resolves shared-average multi-metric prompts to multi-metric over-time mode', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show me avg cadence and avg power for the last 3 months for cycling',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.resultKind).toBe('multi_metric_aggregate');
    if (result.query.resultKind !== 'multi_metric_aggregate') {
      return;
    }

    expect(result.query.groupingMode).toBe('date');
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Monthly);
    expect(result.query.activityTypes).toEqual([ActivityTypes.Cycling]);
    expect(result.query.metricSelections).toEqual([
      {
        metricKey: 'cadence',
        dataType: DataCadenceAvg.type,
        valueType: ChartDataValueTypes.Average,
      },
      {
        metricKey: 'power',
        dataType: DataPowerAvg.type,
        valueType: ChartDataValueTypes.Average,
      },
    ]);
  });

  it('defaults multi-metric prompts without grouping wording to overall summaries only', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show me cadence, power, and heart rate for cycling',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok' || result.query.resultKind !== 'multi_metric_aggregate') {
      return;
    }

    expect(result.query.groupingMode).toBe('overall');
    expect(result.query.requestedTimeInterval).toBeUndefined();
    expect(result.query.metricSelections.map(metric => metric.metricKey)).toEqual([
      'cadence',
      'power',
      'heart_rate',
    ]);
  });

  it('rejects multi-metric prompts with more than three metrics', async () => {
    const result = await normalizeInsightQuery({
      prompt: 'Show me cadence, power, heart rate, and speed for cycling',
      clientTimezone: 'UTC',
    });

    expect(result).toEqual({
      status: 'unsupported',
      reasonCode: 'too_many_metrics',
      suggestedPrompts: expect.any(Array),
    });
  });

  it('rejects mixed-aggregation multi-metric prompts', async () => {
    const result = await normalizeInsightQuery({
      prompt: 'Show me avg cadence and max power for cycling',
      clientTimezone: 'UTC',
    });

    expect(result).toEqual({
      status: 'unsupported',
      reasonCode: 'unsupported_multi_metric_combination',
      suggestedPrompts: expect.any(Array),
    });
  });

  it('keeps aggregate mode for over-time prompts even when ranking words are present', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'maximum',
        category: 'date',
        activityTypes: ['Cycling'],
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my longest distance in cycling over time by month',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.resultKind).toBe('aggregate');
  });

  it('detects stacked date-by-activity intent with noisy punctuation and spacing', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'max heart rate',
        aggregation: 'maximum',
        category: 'activity',
        activityTypes: [],
        dateRange: {
          kind: 'last_n',
          amount: 3,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my max heart rate last  3 months, as stacked columns by activity-type timeline.',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.DateType);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsVertical);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Monthly);
  });

  it('detects stacked date-by-activity intent for activity types wording with explicit range', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-19T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'max heart rate',
        aggregation: 'maximum',
        category: 'activity',
        activityTypes: [],
        dateRange: {
          kind: 'last_n',
          amount: 3,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my max heart rate last 3 months as stacked columns by activity types',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.DateType);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsVertical);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Monthly);
  });

  it('defaults to the current year when the model omits a range', async () => {
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
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
      source: 'default',
    });
  });

  it('resolves bounded default ranges to the query timezone instead of UTC calendar boundaries', async () => {
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
      clientTimezone: 'Europe/Helsinki',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2025-12-31T22:00:00.000Z',
      endDate: '2026-03-18T21:59:59.999Z',
      timezone: 'Europe/Helsinki',
      source: 'default',
    });
  });

  it('treats explicit all-time prompts as an all-time range even when the model omits a range', async () => {
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
      prompt: 'show my total distance all time',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dateRange).toEqual({
      kind: 'all_time',
      timezone: 'UTC',
      source: 'prompt',
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
    expect(result.query.activityTypeGroups).toEqual([]);
    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    });
  });

  it('infers weekly buckets for date-based prompts over the last 90 days', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'total',
        category: 'date',
        requestedTimeInterval: 'auto',
        dateRange: {
          kind: 'last_n',
          amount: 90,
          unit: 'day',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my total distance over time in the last 90 days',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Weekly);
  });

  it('keeps explicit daily interval wording for last-90-days prompts', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'total',
        category: 'date',
        requestedTimeInterval: 'auto',
        dateRange: {
          kind: 'last_n',
          amount: 90,
          unit: 'day',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my total distance by day in the last 90 days',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Daily);
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
    expect(result.query.activityTypeGroups).toEqual([]);
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
    expect(result.query.activityTypeGroups).toEqual([]);
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
    expect(result.query.activityTypeGroups).toEqual([]);
    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    });
  });

  it('prefers the prompt alias for grade adjusted pace families', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'pace',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Trail Running'],
        dateRange: {
          kind: 'current_period',
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my average gap for trail running this month',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('grade_adjusted_pace');
    expect(result.query.dataType).toBe(DataGradeAdjustedPaceAvg.type);
    expect(result.query.activityTypeGroups).toEqual([]);
  });

  it('prefers the prompt alias for effort pace families', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'pace',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Running'],
        dateRange: {
          kind: 'current_period',
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my effort pace for running this month',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('effort_pace');
    expect(result.query.dataType).toBe(DataEffortPaceAvg.type);
    expect(result.query.activityTypeGroups).toEqual([]);
  });

  it('prefers the prompt alias for swim pace families', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'pace',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Swimming'],
        dateRange: {
          kind: 'current_period',
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my swim pace over time this month',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('swim_pace');
    expect(result.query.dataType).toBe(DataSwimPaceAvg.type);
    expect(result.query.activityTypeGroups).toEqual([]);
  });

  it('normalizes total TSS over time for cycling this year', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'training stress score',
        aggregation: 'total',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Cycling'],
        dateRange: {
          kind: 'current_period',
          unit: 'year',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my total TSS over time for cycling this year',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('training_stress_score');
    expect(result.query.dataType).toBe(DataPowerTrainingStressScore.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Total);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Monthly);
    expect(result.query.activityTypes).toEqual([ActivityTypes.Cycling]);
  });

  it('does not treat generic "training duration" wording as a Training activity filter', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'duration',
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
      prompt: 'Show my total training duration over time this year',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('duration');
    expect(result.query.dataType).toBe(DataDuration.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Total);
    expect(result.query.activityTypes).toEqual([]);
    expect(result.query.activityTypes).not.toContain(ActivityTypes.Training);
  });

  it('normalizes average normalized power for cycling this month', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'normalized power',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Cycling'],
        dateRange: {
          kind: 'current_period',
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my average normalized power for cycling this month',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.metricKey).toBe('normalized_power');
    expect(result.query.dataType).toBe(DataPowerNormalized.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Average);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Daily);
    expect(result.query.activityTypes).toEqual([ActivityTypes.Cycling]);
  });

  it('keeps aerobic and anaerobic training effect metrics distinct', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'anaerobic training effect',
        aggregation: 'maximum',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Cycling'],
        dateRange: {
          kind: 'current_period',
          unit: 'month',
        },
      }),
    });

    const anaerobicResult = await normalizeInsightQuery({
      prompt: 'Show my highest anaerobic training effect for cycling this month',
      clientTimezone: 'UTC',
    });

    expect(anaerobicResult.status).toBe('ok');
    if (anaerobicResult.status !== 'ok') {
      return;
    }

    expect(anaerobicResult.metricKey).toBe('anaerobic_training_effect');
    expect(anaerobicResult.query.dataType).toBe(DataAnaerobicTrainingEffect.type);

    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'recovery time',
        aggregation: 'maximum',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Running'],
        dateRange: {
          kind: 'current_period',
          unit: 'month',
        },
      }),
    });

    const recoveryResult = await normalizeInsightQuery({
      prompt: 'Show my highest recovery time for running this month',
      clientTimezone: 'UTC',
    });

    expect(recoveryResult.status).toBe('ok');
    if (recoveryResult.status !== 'ok') {
      return;
    }

    expect(recoveryResult.metricKey).toBe('recovery_time');
    expect(recoveryResult.query.dataType).toBe(DataRecoveryTime.type);
    expect(recoveryResult.query.valueType).toBe(ChartDataValueTypes.Maximum);
  });

  it('uses activity type groups for non-ambiguous broad group prompts', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'pace',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypeGroups: ['water sports'],
        dateRange: {
          kind: 'last_n',
          amount: 6,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my average pace for water sports over the last 6 months',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.activityTypeGroups).toEqual([ActivityTypeGroups.WaterSportsGroup]);
    expect(result.query.activityTypes).toEqual(
      expect.arrayContaining([
        ActivityTypes.Rowing,
        ActivityTypes.Kayaking,
        ActivityTypes.Sailing,
      ]),
    );
  });

  it('keeps ambiguous activity labels as exact activities by default', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'pace',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypes: ['Running'],
        dateRange: {
          kind: 'last_n',
          amount: 3,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my average pace for running over the last 3 months',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.activityTypeGroups).toEqual([]);
    expect(result.query.activityTypes).toEqual([ActivityTypes.Running]);
  });

  it('uses a group when an ambiguous label is made explicit with group wording', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'pace',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypeGroups: ['running group'],
        dateRange: {
          kind: 'last_n',
          amount: 3,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my average pace for the running group over the last 3 months',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.activityTypeGroups).toEqual([ActivityTypeGroups.RunningGroup]);
    expect(result.query.activityTypes).toEqual(
      expect.arrayContaining([
        ActivityTypes.Running,
        ActivityTypes.Treadmill,
        ActivityTypes.IndoorRunning,
      ]),
    );
  });

  it('prefers exact activities when a prompt mixes a group and an exact activity', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'pace',
        aggregation: 'average',
        category: 'date',
        requestedTimeInterval: 'auto',
        activityTypeGroups: ['running group'],
        activityTypes: ['Trail Running'],
        dateRange: {
          kind: 'last_n',
          amount: 3,
          unit: 'month',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'Show my average pace for running group and trail running over the last 3 months',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.activityTypeGroups).toEqual([]);
    expect(result.query.activityTypes).toEqual([ActivityTypes.TrailRunning]);
  });

  it('treats excluded activities as exclusions instead of positive filters', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'maximum',
        category: 'activity',
        activityTypes: ['Diving'],
        dateRange: {
          kind: 'all_time',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'I want to know my longest distances by sport all time excluding diving',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.ActivityType);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.dateRange).toEqual({
      kind: 'all_time',
      timezone: 'UTC',
      source: 'prompt',
    });
    expect(result.query.activityTypes).not.toContain(ActivityTypes.Diving);
    expect(result.query.activityTypes).toEqual(expect.arrayContaining([
      ActivityTypes.Cycling,
      ActivityTypes.Running,
    ]));
  });

  it('treats excluded indoor activity-type phrasing as the indoor sports group', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'supported',
        metric: 'distance',
        aggregation: 'maximum',
        category: 'activity',
        dateRange: {
          kind: 'all_time',
        },
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'I want to know my longest distances by sport all time excluding any indoor type',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    const indoorActivityTypes = getActivityTypesForGroup(ActivityTypeGroups.IndoorSportsGroup);

    expect(result.query.activityTypes).toEqual(expect.arrayContaining([
      ActivityTypes.Cycling,
      ActivityTypes.Running,
    ]));
    expect(result.query.activityTypes.some(activityType => indoorActivityTypes.includes(activityType))).toBe(false);
    expect(result.query.activityTypes).not.toContain(ActivityTypes.IndoorCycling);
    expect(result.query.activityTypes).not.toContain(ActivityTypes.IndoorClimbing);
    expect(result.query.activityTypes).not.toContain(ActivityTypes.IndoorRunning);
    expect(result.query.activityTypes).not.toContain(ActivityTypes.IndoorTraining);
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
      suggestedPrompts: [
        'Tell me my average cadence for cycling over the last 3 months.',
        'Show my total distance by activity type this year.',
        'Show my total training duration over time this year.',
      ],
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

  it('falls back to deterministic prompt parsing when the model returns unsupported for a supported prompt', async () => {
    setNormalizeQueryDependenciesForTesting({
      now: () => new Date('2026-03-18T12:00:00.000Z'),
      generateIntent: async () => ({
        status: 'unsupported',
        unsupportedReasonCode: 'unsupported_capability',
      }),
    });

    const result = await normalizeInsightQuery({
      prompt: 'show my max heart rate last month as stacked columns by activity type over time',
      clientTimezone: 'UTC',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.query.dataType).toBe(DataHeartRateMax.type);
    expect(result.query.valueType).toBe(ChartDataValueTypes.Maximum);
    expect(result.query.categoryType).toBe(ChartDataCategoryTypes.DateType);
    expect(result.query.chartType).toBe(ChartTypes.ColumnsVertical);
    expect(result.query.requestedTimeInterval).toBe(TimeIntervals.Weekly);
    expect(result.query.dateRange).toEqual({
      kind: 'bounded',
      startDate: '2026-02-18T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    });
  });
});
