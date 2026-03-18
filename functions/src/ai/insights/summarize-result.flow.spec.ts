import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

vi.mock('./genkit', () => ({
  aiInsightsGenkit: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: vi.fn(),
  },
}));

import {
  buildNarrativeFacts,
  buildInsightSummaryFacts,
  setSummarizeInsightDependenciesForTesting,
  summarizeAiInsightResult,
} from './summarize-result.flow';

const paceSummary = {
  matchedEventCount: 5,
  overallAggregateValue: 422.3478623928474,
  peakBucket: {
    bucketKey: '2026-03',
    time: Date.parse('2026-03-01T00:00:00.000Z'),
    aggregateValue: 422.3478623928474,
    totalCount: 5,
  },
  lowestBucket: {
    bucketKey: '2026-02',
    time: Date.parse('2026-02-01T00:00:00.000Z'),
    aggregateValue: 415,
    totalCount: 4,
  },
  latestBucket: {
    bucketKey: '2026-03',
    time: Date.parse('2026-03-01T00:00:00.000Z'),
    aggregateValue: 422.3478623928474,
    totalCount: 5,
  },
};

const paceInput = {
  status: 'ok' as const,
  prompt: 'Show my average pace for trailrunning over the last 6 months',
  metricLabel: 'pace',
  query: {
    dataType: 'Average Pace',
    valueType: ChartDataValueTypes.Average,
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: TimeIntervals.Monthly,
    activityTypes: [ActivityTypes.TrailRunning],
    dateRange: {
      startDate: '2025-09-17T21:00:00.000Z',
      endDate: '2026-03-18T21:59:59.999Z',
      timezone: 'Europe/Helsinki',
    },
    chartType: ChartTypes.LinesVertical,
  },
  aggregation: {
    dataType: 'Average Pace',
    valueType: ChartDataValueTypes.Average,
    categoryType: ChartDataCategoryTypes.DateType,
    resolvedTimeInterval: TimeIntervals.Monthly,
    buckets: [
      {
        bucketKey: '2026-03',
        time: Date.parse('2026-03-01T00:00:00.000Z'),
        totalCount: 5,
        aggregateValue: 422.3478623928474,
        seriesValues: { 'Trail Running': 422.3478623928474 },
        seriesCounts: { 'Trail Running': 5 },
      },
    ],
  },
  summary: paceSummary,
  presentation: {
    title: 'Average pace over time for Trail Running',
    chartType: ChartTypes.LinesVertical,
  },
};

describe('summarizeAiInsightResult', () => {
  afterEach(() => {
    setSummarizeInsightDependenciesForTesting();
    vi.restoreAllMocks();
  });

  it('formats pace summary facts using display values instead of raw storage numbers', () => {
    const summary = buildInsightSummaryFacts(paceInput);
    const facts = buildNarrativeFacts(paceInput) as {
      summary: { overallAggregateDisplayValue: string | null; matchedEventCount: number };
      buckets: Array<Record<string, unknown>>;
    };

    expect(summary).toEqual({
      matchedEventCount: 5,
      overallAggregateDisplayValue: '07:02 min/km',
      highestValueBucket: expect.objectContaining({
        label: 'Slowest period',
        aggregateDisplayValue: '07:02 min/km',
        totalCount: 5,
      }),
      lowestValueBucket: expect.objectContaining({
        label: 'Fastest period',
        aggregateDisplayValue: '06:55 min/km',
        totalCount: 4,
      }),
      latestBucket: expect.objectContaining({
        label: 'Latest period with data',
        aggregateDisplayValue: '07:02 min/km',
        totalCount: 5,
      }),
      improvedVerb: 'improved',
      declinedVerb: 'slowed',
    });
    expect(facts.summary).toEqual(expect.objectContaining({
      overallAggregateDisplayValue: '07:02 min/km',
      matchedEventCount: 5,
    }));
    expect(facts.buckets[0]?.aggregateDisplayValue).toBe('07:02 min/km');
    expect(facts.buckets[0]).not.toHaveProperty('aggregateValue');
  });

  it('uses direct metric semantics for highest and lowest labels', () => {
    const directSummary = buildInsightSummaryFacts({
      ...paceInput,
      metricLabel: 'heart rate',
      query: {
        ...paceInput.query,
        dataType: 'Average Heart Rate',
      },
      summary: {
        ...paceSummary,
        overallAggregateValue: 152,
      },
    });

    expect(directSummary.highestValueBucket?.label).toBe('Highest period');
    expect(directSummary.lowestValueBucket?.label).toBe('Lowest period');
    expect(directSummary.latestBucket?.label).toBe('Latest period with data');
    expect(directSummary.improvedVerb).toBe('increased');
    expect(directSummary.declinedVerb).toBe('decreased');
  });

  it('falls back to a formatted narrative when generation fails', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => {
        throw new Error('generation failed');
      },
    });

    const narrative = await summarizeAiInsightResult(paceInput);

    expect(narrative).toContain('07:02 min/km');
    expect(narrative).toContain('5 activities');
    expect(narrative).not.toContain('422.3478623928474');
  });
});
