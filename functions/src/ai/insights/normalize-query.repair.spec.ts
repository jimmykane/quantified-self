import { describe, expect, it, vi } from 'vitest';
import {
  ChartDataCategoryTypes,
  ChartTypes,
  DataHeartRateMax,
} from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

import { createRepairInsightQuery } from './normalize-query.repair';

describe('repairUnsupportedInsightQuery', () => {
  it('uses AI repair only to fill unresolved fields while keeping deterministic activity/date parsing authoritative', async () => {
    const { repairUnsupportedInsightQuery } = createRepairInsightQuery({
      repairIntent: async () => ({
        status: 'supported',
        metric: 'max heart rate',
        aggregation: 'maximum',
        category: 'date',
      }),
    });

    const repaired = await repairUnsupportedInsightQuery({
      prompt: 'which sports had my max cardio in 2024 and 2025',
      clientTimezone: 'UTC',
    }, {
      status: 'unsupported',
      reasonCode: 'unsupported_metric',
      suggestedPrompts: ['show my max heart rate by sport in 2024'],
    });

    expect(repaired.source).toBe('genkit');
    expect(repaired.result.status).toBe('ok');
    if (repaired.result.status !== 'ok') {
      return;
    }

    expect(repaired.result.metricKey).toBe('heart_rate');
    expect(repaired.result.query.dataType).toBe(DataHeartRateMax.type);
    expect(repaired.result.query.categoryType).toBe(ChartDataCategoryTypes.ActivityType);
    expect(repaired.result.query.periodMode).toBe('combined');
    expect(repaired.result.query.requestedTimeInterval).toBeUndefined();
    expect(repaired.result.query.requestedDateRanges).toEqual([
      {
        kind: 'bounded',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
    ]);
  });

  it('falls back to the deterministic unsupported result when AI repair fails', async () => {
    const { repairUnsupportedInsightQuery } = createRepairInsightQuery({
      repairIntent: async () => {
        throw new Error('model failed');
      },
    });

    const repaired = await repairUnsupportedInsightQuery({
      prompt: 'which sports had my max cardio in 2024 and 2025',
      clientTimezone: 'UTC',
    }, {
      status: 'unsupported',
      reasonCode: 'unsupported_metric',
      suggestedPrompts: ['show my max heart rate by sport in 2024'],
    });

    expect(repaired).toEqual({
      source: 'none',
      result: {
        status: 'unsupported',
        reasonCode: 'unsupported_metric',
        suggestedPrompts: ['show my max heart rate by sport in 2024'],
      },
    });
  });

  it('keeps explicit prompt chart intent when repair succeeds', async () => {
    const { repairUnsupportedInsightQuery } = createRepairInsightQuery({
      repairIntent: async () => ({
        status: 'supported',
        metric: 'max heart rate',
        aggregation: 'maximum',
        category: 'date',
      }),
    });

    const repaired = await repairUnsupportedInsightQuery({
      prompt: 'what was my max heart rate in 2024 and 2026 as columns?',
      clientTimezone: 'UTC',
    }, {
      status: 'unsupported',
      reasonCode: 'unsupported_metric',
      suggestedPrompts: ['show my max heart rate in 2024'],
    });

    expect(repaired.source).toBe('genkit');
    expect(repaired.result.status).toBe('ok');
    if (repaired.result.status !== 'ok') {
      return;
    }

    expect(repaired.result.query.chartType).toBe(ChartTypes.ColumnsVertical);
  });
});
