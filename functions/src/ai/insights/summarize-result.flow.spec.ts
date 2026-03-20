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
  activityMix: null,
  bucketCoverage: {
    nonEmptyBucketCount: 1,
    totalBucketCount: 6,
  },
  trend: {
    previousBucket: {
      bucketKey: '2026-02',
      time: Date.parse('2026-02-01T00:00:00.000Z'),
      aggregateValue: 415,
      totalCount: 4,
    },
    deltaAggregateValue: 7.347862392847379,
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
    activityTypeGroups: [],
    activityTypes: [ActivityTypes.TrailRunning],
    dateRange: {
      kind: 'bounded',
      startDate: '2025-09-17T21:00:00.000Z',
      endDate: '2026-03-18T21:59:59.999Z',
      timezone: 'Europe/Helsinki',
      source: 'prompt',
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

const eventLookupInput = {
  status: 'ok' as const,
  prompt: 'I want to know when I had my longest distance in cycling',
  metricLabel: 'distance',
  query: {
    dataType: 'Distance',
    valueType: ChartDataValueTypes.Maximum,
    categoryType: ChartDataCategoryTypes.DateType,
    requestedTimeInterval: TimeIntervals.Monthly,
    activityTypeGroups: [],
    activityTypes: [ActivityTypes.Cycling],
    dateRange: {
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-18T23:59:59.999Z',
      timezone: 'Europe/Helsinki',
      source: 'default',
    },
    chartType: ChartTypes.LinesVertical,
    resultKind: 'event_lookup' as const,
  },
  eventLookup: {
    matchedEventCount: 3,
    primaryEvent: {
      eventId: 'event-3',
      startDate: '2026-03-10T08:00:00.000Z',
      aggregateValue: 123400,
    },
    rankedEvents: [
      {
        eventId: 'event-3',
        startDate: '2026-03-10T08:00:00.000Z',
        aggregateValue: 123400,
      },
      {
        eventId: 'event-2',
        startDate: '2026-02-14T08:00:00.000Z',
        aggregateValue: 118200,
      },
      {
        eventId: 'event-1',
        startDate: '2026-01-11T08:00:00.000Z',
        aggregateValue: 105700,
      },
    ],
  },
  presentation: {
    title: 'Top distance events for Cycling',
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

  it('omits latest group facts for non-date grouped comparisons', () => {
    const groupedSummary = buildInsightSummaryFacts({
      ...paceInput,
      metricLabel: 'distance',
      query: {
        ...paceInput.query,
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.ActivityType,
      },
      summary: {
        ...paceSummary,
        overallAggregateValue: 24500,
        peakBucket: {
          bucketKey: ActivityTypes.Cycling,
          aggregateValue: 24500,
          totalCount: 5,
        },
        lowestBucket: {
          bucketKey: ActivityTypes.Diving,
          aggregateValue: 0,
          totalCount: 2,
        },
        latestBucket: {
          bucketKey: ActivityTypes.Yoga,
          aggregateValue: 0,
          totalCount: 3,
        },
      },
    });

    expect(groupedSummary.highestValueBucket?.label).toBe('Highest group');
    expect(groupedSummary.lowestValueBucket?.label).toBe('Lowest group');
    expect(groupedSummary.latestBucket).toBeNull();
  });

  it('falls back to a formatted narrative when generation fails', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => {
        throw new Error('generation failed');
      },
    });

    const result = await summarizeAiInsightResult(paceInput);

    expect(result.source).toBe('fallback');
    expect(result.narrative).toContain('07:02 min/km');
    expect(result.narrative).toContain('5 activities');
    expect(result.narrative).not.toContain('422.3478623928474');
  });

  it('builds a fallback narrative for multi-metric aggregate results', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => {
        throw new Error('generation failed');
      },
    });

    const result = await summarizeAiInsightResult({
      status: 'ok',
      prompt: 'show me avg cadence and avg power for the last 3 months for cycling',
      query: {
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-18T23:59:59.999Z',
          timezone: 'Europe/Helsinki',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        metricSelections: [
          {
            metricKey: 'cadence',
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
          },
          {
            metricKey: 'power',
            dataType: 'Average Power',
            valueType: ChartDataValueTypes.Average,
          },
        ],
      },
      metricLabels: ['cadence', 'power'],
      metricResults: [
        {
          metricKey: 'cadence',
          metricLabel: 'cadence',
          query: {
            ...paceInput.query,
            resultKind: 'aggregate',
            dataType: 'Average Cadence',
          },
          aggregation: {
            ...paceInput.aggregation,
            dataType: 'Average Cadence',
          },
          summary: {
            ...paceSummary,
            overallAggregateValue: 88,
            latestBucket: {
              bucketKey: '2026-03',
              time: Date.parse('2026-03-01T00:00:00.000Z'),
              aggregateValue: 88,
              totalCount: 5,
            },
          },
          presentation: {
            title: 'Cadence over time for Cycling',
            chartType: ChartTypes.LinesVertical,
          },
        },
        {
          metricKey: 'power',
          metricLabel: 'power',
          query: {
            ...paceInput.query,
            resultKind: 'aggregate',
            dataType: 'Average Power',
          },
          aggregation: {
            ...paceInput.aggregation,
            dataType: 'Average Power',
          },
          summary: {
            ...paceSummary,
            overallAggregateValue: 220,
            latestBucket: {
              bucketKey: '2026-03',
              time: Date.parse('2026-03-01T00:00:00.000Z'),
              aggregateValue: 220,
              totalCount: 4,
            },
          },
          presentation: {
            title: 'Power over time for Cycling',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      presentation: {
        title: 'Cadence and power over time for Cycling',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(result.source).toBe('fallback');
    expect(result.narrative.toLowerCase()).toContain('cadence');
    expect(result.narrative.toLowerCase()).toContain('power');
  });

  it('formats bounded narrative date ranges using the client locale and query timezone', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => {
        throw new Error('generation failed');
      },
    });

    const result = await summarizeAiInsightResult({
      ...paceInput,
      metricLabel: 'highest heart rate',
      clientLocale: 'en-US',
      query: {
        ...paceInput.query,
        dataType: 'Maximum Heart Rate',
        valueType: ChartDataValueTypes.Maximum,
        dateRange: {
          kind: 'bounded',
          startDate: '2026-02-16T22:00:00.000Z',
          endDate: '2026-03-18T21:59:59.999Z',
          timezone: 'Europe/Helsinki',
          source: 'prompt',
        },
      },
      summary: {
        ...paceSummary,
        overallAggregateValue: 140,
      },
    });

    expect(result.source).toBe('fallback');
    expect(result.narrative).toContain('from Feb 17, 2026 to Mar 18, 2026');
    expect(result.narrative).not.toContain('2026-02-17');
    expect(result.narrative).not.toContain('2026-03-18');
  });

  it('builds localized dateRangeLabel facts for model generation', () => {
    const facts = buildNarrativeFacts({
      ...paceInput,
      clientLocale: 'en-GB',
      query: {
        ...paceInput.query,
        dateRange: {
          kind: 'bounded',
          startDate: '2026-02-16T22:00:00.000Z',
          endDate: '2026-03-18T21:59:59.999Z',
          timezone: 'Europe/Helsinki',
          source: 'prompt',
        },
      },
    }) as { dateRangeLabel: string };

    expect(facts.dateRangeLabel).toBe('17 Feb 2026 to 18 Mar 2026');
  });

  it('uses all-time wording in the fallback narrative for explicit all-time queries', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => {
        throw new Error('generation failed');
      },
    });

    const result = await summarizeAiInsightResult({
      ...paceInput,
      query: {
        ...paceInput.query,
        dateRange: {
          kind: 'all_time',
          timezone: 'Europe/Helsinki',
          source: 'prompt',
        },
      },
    });

    expect(result.source).toBe('fallback');
    expect(result.narrative).toContain('across all recorded history');
    expect(result.narrative).not.toContain('between');
  });

  it('builds event-lookup facts with ranked event ids and display values', () => {
    const facts = buildNarrativeFacts(eventLookupInput) as {
      resultKind: string;
      descriptor: string;
      matchedEventCount: number;
      primaryEvent: { eventId: string; aggregateDisplayValue: string };
      rankedEvents: Array<{ eventId: string; aggregateDisplayValue: string }>;
    };

    expect(facts.resultKind).toBe('event_lookup');
    expect(facts.descriptor).toBe('longest distance');
    expect(facts.matchedEventCount).toBe(3);
    expect(facts.primaryEvent).toEqual(expect.objectContaining({
      eventId: 'event-3',
    }));
    expect(facts.primaryEvent.aggregateDisplayValue.toLowerCase()).toBe('123.40 km'.toLowerCase());
    expect(facts.rankedEvents).toHaveLength(3);
    expect(facts.rankedEvents[0]).toEqual(expect.objectContaining({
      eventId: 'event-3',
    }));
    expect(facts.rankedEvents[0]?.aggregateDisplayValue.toLowerCase()).toBe('123.40 km'.toLowerCase());
  });

  it('falls back to an event-lookup narrative without aggregate bucket text', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => {
        throw new Error('generation failed');
      },
    });

    const result = await summarizeAiInsightResult(eventLookupInput);

    expect(result.source).toBe('fallback');
    expect(result.narrative).toContain('longest distance event');
    expect(result.narrative).toContain('123.40');
    expect(result.narrative).toMatch(/km/i);
    expect(result.narrative).toContain('I ranked 3 matching events');
    expect(result.narrative).not.toContain('time buckets');
  });
});
