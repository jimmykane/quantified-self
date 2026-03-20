import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataAerobicTrainingEffect,
  DataAnaerobicTrainingEffect,
  DataCadenceAvg,
  DataDistance,
  DataEffortPaceAvg,
  DataGradeAdjustedPaceAvg,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataPowerNormalized,
  DataPowerTrainingStressScore,
  DataRecoveryTime,
  DataSwimPaceAvg,
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
