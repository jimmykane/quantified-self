import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

const hoisted = vi.hoisted(() => ({
  loggerDebug: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({
  debug: (...args: unknown[]) => hoisted.loggerDebug(...args),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./genkit', () => ({
  aiInsightsGenkit: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    generate: vi.fn(),
  },
}));

import {
  buildNarrativeFacts,
  buildInsightSummaryFacts,
  createSummarizeInsight,
  type SummarizeInsightDependencies,
  type SummarizeInsightResultInput,
} from './summarize-result.flow';

let summarizeInsightSubject = createSummarizeInsight();

function setSummarizeInsightDependenciesForTesting(
  dependencies: Partial<SummarizeInsightDependencies> = {},
): void {
  summarizeInsightSubject = createSummarizeInsight(dependencies);
}

async function summarizeAiInsightResult(
  input: SummarizeInsightResultInput,
) {
  return summarizeInsightSubject.summarizeAiInsightResult(input);
}

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

const compareDeltaInput = {
  ...paceInput,
  metricLabel: 'power',
  query: {
    ...paceInput.query,
    resultKind: 'aggregate' as const,
    dataType: 'Average Power',
    periodMode: 'compare' as const,
    requestedTimeInterval: TimeIntervals.Yearly,
    dateRange: {
      kind: 'bounded' as const,
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2028-12-31T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt' as const,
    },
  },
  aggregation: {
    dataType: 'Average Power',
    valueType: ChartDataValueTypes.Average,
    categoryType: ChartDataCategoryTypes.DateType,
    resolvedTimeInterval: TimeIntervals.Yearly,
    buckets: [
      {
        bucketKey: '2025',
        time: Date.parse('2025-01-01T00:00:00.000Z'),
        totalCount: 5,
        aggregateValue: 215,
        seriesValues: {
          [ActivityTypes.Cycling]: 220,
          [ActivityTypes.Running]: 190,
        },
        seriesCounts: {
          [ActivityTypes.Cycling]: 4,
          [ActivityTypes.Running]: 1,
        },
      },
      {
        bucketKey: '2026',
        time: Date.parse('2026-01-01T00:00:00.000Z'),
        totalCount: 5,
        aggregateValue: 230,
        seriesValues: {
          [ActivityTypes.Cycling]: 235,
          [ActivityTypes.Running]: 200,
        },
        seriesCounts: {
          [ActivityTypes.Cycling]: 4,
          [ActivityTypes.Running]: 1,
        },
      },
      {
        bucketKey: '2027',
        time: Date.parse('2027-01-01T00:00:00.000Z'),
        totalCount: 5,
        aggregateValue: 220,
        seriesValues: {
          [ActivityTypes.Cycling]: 225,
          [ActivityTypes.Running]: 195,
        },
        seriesCounts: {
          [ActivityTypes.Cycling]: 4,
          [ActivityTypes.Running]: 1,
        },
      },
      {
        bucketKey: '2028',
        time: Date.parse('2028-01-01T00:00:00.000Z'),
        totalCount: 5,
        aggregateValue: 220,
        seriesValues: {
          [ActivityTypes.Cycling]: 235,
          [ActivityTypes.Running]: 185,
        },
        seriesCounts: {
          [ActivityTypes.Cycling]: 4,
          [ActivityTypes.Running]: 1,
        },
      },
    ],
  },
  summary: {
    ...paceSummary,
    overallAggregateValue: 220,
    peakBucket: {
      bucketKey: '2026',
      time: Date.parse('2026-01-01T00:00:00.000Z'),
      aggregateValue: 230,
      totalCount: 5,
    },
    lowestBucket: {
      bucketKey: '2025',
      time: Date.parse('2025-01-01T00:00:00.000Z'),
      aggregateValue: 215,
      totalCount: 5,
    },
    latestBucket: {
      bucketKey: '2028',
      time: Date.parse('2028-01-01T00:00:00.000Z'),
      aggregateValue: 220,
      totalCount: 5,
    },
    periodDeltas: [
      {
        fromBucket: {
          bucketKey: '2025',
          time: Date.parse('2025-01-01T00:00:00.000Z'),
          aggregateValue: 215,
          totalCount: 5,
        },
        toBucket: {
          bucketKey: '2026',
          time: Date.parse('2026-01-01T00:00:00.000Z'),
          aggregateValue: 230,
          totalCount: 5,
        },
        deltaAggregateValue: 15,
        direction: 'increase' as const,
        contributors: [
          {
            seriesKey: ActivityTypes.Cycling,
            deltaAggregateValue: 15,
            direction: 'increase' as const,
          },
        ],
        eventContributors: [
          {
            eventId: 'event-2026-1',
            startDate: '2026-02-10T08:00:00.000Z',
            activityType: ActivityTypes.Cycling,
            eventStatValue: 235,
            deltaContributionValue: 47,
            direction: 'increase' as const,
          },
        ],
      },
      {
        fromBucket: {
          bucketKey: '2026',
          time: Date.parse('2026-01-01T00:00:00.000Z'),
          aggregateValue: 230,
          totalCount: 5,
        },
        toBucket: {
          bucketKey: '2027',
          time: Date.parse('2027-01-01T00:00:00.000Z'),
          aggregateValue: 220,
          totalCount: 5,
        },
        deltaAggregateValue: -10,
        direction: 'decrease' as const,
        contributors: [
          {
            seriesKey: ActivityTypes.Cycling,
            deltaAggregateValue: -10,
            direction: 'decrease' as const,
          },
        ],
      },
      {
        fromBucket: {
          bucketKey: '2027',
          time: Date.parse('2027-01-01T00:00:00.000Z'),
          aggregateValue: 220,
          totalCount: 5,
        },
        toBucket: {
          bucketKey: '2028',
          time: Date.parse('2028-01-01T00:00:00.000Z'),
          aggregateValue: 220,
          totalCount: 5,
        },
        deltaAggregateValue: 0,
        direction: 'no_change' as const,
        contributors: [
          {
            seriesKey: ActivityTypes.Cycling,
            deltaAggregateValue: 10,
            direction: 'increase' as const,
          },
          {
            seriesKey: ActivityTypes.Running,
            deltaAggregateValue: -10,
            direction: 'decrease' as const,
          },
        ],
      },
    ],
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

  it('forces empty narratives to use the resolved default date range text', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => ({
        source: 'genkit',
        narrative: 'No matching data was found for 2024 as the provided information covers the period from Jan 01, 2026 to Mar 20, 2026.',
      }),
    });

    const result = await summarizeAiInsightResult({
      ...paceInput,
      status: 'empty',
      query: {
        ...paceInput.query,
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-31T22:00:00.000Z',
          endDate: '2026-03-20T21:59:59.999Z',
          timezone: 'Europe/Helsinki',
          source: 'default',
        },
      },
    });

    expect(result.source).toBe('genkit');
    expect(result.narrative).toBe(
      'Used the default date range (Jan 01, 2026 to Mar 20, 2026) because no time range was found in your prompt. No matching trail running events with pace data were found in Jan 01, 2026 to Mar 20, 2026.',
    );
    expect(result.narrative).not.toContain('2024');
  });

  it('replaces successful default-range narratives that claim no matching data', async () => {
    hoisted.loggerDebug.mockClear();

    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => ({
        source: 'genkit',
        narrative: 'No matching data was found for 2024 as the provided information covers the period from Jan 01, 2026 to Mar 18, 2026.',
      }),
    });

    const result = await summarizeAiInsightResult({
      ...paceInput,
      query: {
        ...paceInput.query,
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-31T22:00:00.000Z',
          endDate: '2026-03-18T21:59:59.999Z',
          timezone: 'Europe/Helsinki',
          source: 'default',
        },
      },
    });

    expect(result.source).toBe('genkit');
    expect(result.narrative).toContain('from Jan 01, 2026 to Mar 18, 2026');
    expect(result.narrative).toContain('07:02 min/km');
    expect(result.narrative).not.toContain('No matching data was found');
    expect(result.narrative).not.toContain('2024');

    const debugLogCall = hoisted.loggerDebug.mock.calls.find(
      (call) => call[0] === '[aiInsights] Replaced inconsistent default-range narrative.',
    );
    expect(debugLogCall).toBeDefined();
    const debugPayload = debugLogCall?.[1] as Record<string, unknown>;

    expect(debugPayload.prompt).toBeUndefined();
    expect(debugPayload.promptLength).toBe(paceInput.prompt.length);
    expect(debugPayload.promptPreview).toBe(paceInput.prompt.slice(0, 60));
  });

  it('replaces successful default-range narratives that omit the effective range', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => ({
        source: 'genkit',
        narrative: 'Your average pace improved recently for trail running.',
      }),
    });

    const result = await summarizeAiInsightResult({
      ...paceInput,
      query: {
        ...paceInput.query,
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-31T22:00:00.000Z',
          endDate: '2026-03-18T21:59:59.999Z',
          timezone: 'Europe/Helsinki',
          source: 'default',
        },
      },
    });

    expect(result.source).toBe('genkit');
    expect(result.narrative).toContain('from Jan 01, 2026 to Mar 18, 2026');
    expect(result.narrative).toContain('07:02 min/km');
    expect(result.narrative).not.toContain('recently');
  });

  it('keeps successful default-range narratives that already match the effective range', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => ({
        source: 'genkit',
        narrative: 'From Jan 01, 2026 to Mar 18, 2026 for trail running, your average pace was 07:02 min/km.',
      }),
    });

    const result = await summarizeAiInsightResult({
      ...paceInput,
      query: {
        ...paceInput.query,
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-31T22:00:00.000Z',
          endDate: '2026-03-18T21:59:59.999Z',
          timezone: 'Europe/Helsinki',
          source: 'default',
        },
      },
    });

    expect(result.source).toBe('genkit');
    expect(result.narrative).toBe('From Jan 01, 2026 to Mar 18, 2026 for trail running, your average pace was 07:02 min/km.');
  });

  it('does not apply the default-range guard to prompt-sourced ranges', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => ({
        source: 'genkit',
        narrative: 'No matching data was found for 2024.',
      }),
    });

    const result = await summarizeAiInsightResult(paceInput);

    expect(result.source).toBe('genkit');
    expect(result.narrative).toBe('No matching data was found for 2024.');
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

  it('builds digest fallback narratives with explicit no-data period counts', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => {
        throw new Error('generation failed');
      },
    });

    const result = await summarizeAiInsightResult({
      status: 'ok',
      prompt: 'Give me a weekly digest for cycling this year',
      query: {
        ...paceInput.query,
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        requestedTimeInterval: TimeIntervals.Weekly,
        digestMode: 'weekly',
        metricSelections: [
          {
            metricKey: 'distance',
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
          },
          {
            metricKey: 'duration',
            dataType: 'Duration',
            valueType: ChartDataValueTypes.Total,
          },
        ],
      },
      metricLabels: ['distance', 'duration'],
      metricResults: [
        {
          metricKey: 'distance',
          metricLabel: 'distance',
          query: {
            ...paceInput.query,
            resultKind: 'aggregate',
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
          },
          aggregation: {
            ...paceInput.aggregation,
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
            resolvedTimeInterval: TimeIntervals.Weekly,
            buckets: [],
          },
          summary: {
            ...paceSummary,
            overallAggregateValue: null,
            latestBucket: null,
          },
          presentation: {
            title: 'Distance',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      digest: {
        granularity: 'weekly',
        periodCount: 3,
        nonEmptyPeriodCount: 2,
        periods: [
          {
            bucketKey: '2026-W09',
            time: Date.parse('2026-02-23T00:00:00.000Z'),
            hasData: true,
            metrics: [
              {
                metricKey: 'distance',
                metricLabel: 'Distance',
                dataType: 'Distance',
                valueType: ChartDataValueTypes.Total,
                aggregateValue: 54000,
                totalCount: 3,
              },
              {
                metricKey: 'duration',
                metricLabel: 'Duration',
                dataType: 'Duration',
                valueType: ChartDataValueTypes.Total,
                aggregateValue: 12400,
                totalCount: 3,
              },
            ],
          },
          {
            bucketKey: '2026-W10',
            time: Date.parse('2026-03-02T00:00:00.000Z'),
            hasData: false,
            metrics: [
              {
                metricKey: 'distance',
                metricLabel: 'Distance',
                dataType: 'Distance',
                valueType: ChartDataValueTypes.Total,
                aggregateValue: null,
                totalCount: 0,
              },
              {
                metricKey: 'duration',
                metricLabel: 'Duration',
                dataType: 'Duration',
                valueType: ChartDataValueTypes.Total,
                aggregateValue: null,
                totalCount: 0,
              },
            ],
          },
          {
            bucketKey: '2026-W11',
            time: Date.parse('2026-03-09T00:00:00.000Z'),
            hasData: true,
            metrics: [
              {
                metricKey: 'distance',
                metricLabel: 'Distance',
                dataType: 'Distance',
                valueType: ChartDataValueTypes.Total,
                aggregateValue: 32000,
                totalCount: 2,
              },
              {
                metricKey: 'duration',
                metricLabel: 'Duration',
                dataType: 'Duration',
                valueType: ChartDataValueTypes.Total,
                aggregateValue: 8600,
                totalCount: 2,
              },
            ],
          },
        ],
      },
      presentation: {
        title: 'Weekly digest',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(result.source).toBe('fallback');
    expect(result.narrative).toContain('Digest summary');
    expect(result.narrative).toContain('data in 2 of 3 weeks');
    expect(result.narrative).toContain('No data in 1 week');
  });

  it('builds digest fallback narratives without 0-period wording when no digest periods exist', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => {
        throw new Error('generation failed');
      },
    });

    const result = await summarizeAiInsightResult({
      status: 'empty',
      prompt: 'Give me a yearly digest for all activities all time',
      query: {
        ...paceInput.query,
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        requestedTimeInterval: TimeIntervals.Yearly,
        digestMode: 'yearly',
        dateRange: {
          kind: 'all_time',
          timezone: 'UTC',
          source: 'prompt',
        },
        metricSelections: [
          {
            metricKey: 'distance',
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
          },
          {
            metricKey: 'duration',
            dataType: 'Duration',
            valueType: ChartDataValueTypes.Total,
          },
        ],
      },
      metricLabels: ['distance', 'duration'],
      metricResults: [
        {
          metricKey: 'distance',
          metricLabel: 'distance',
          query: {
            ...paceInput.query,
            resultKind: 'aggregate',
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
          },
          aggregation: {
            ...paceInput.aggregation,
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
            resolvedTimeInterval: TimeIntervals.Yearly,
            buckets: [],
          },
          summary: {
            ...paceSummary,
            overallAggregateValue: null,
            latestBucket: null,
          },
          presentation: {
            title: 'Distance',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      digest: {
        granularity: 'yearly',
        periodCount: 0,
        nonEmptyPeriodCount: 0,
        periods: [],
      },
      presentation: {
        title: 'Yearly digest',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(result.source).toBe('fallback');
    expect(result.narrative).toContain('Digest summary');
    expect(result.narrative).toContain('no matching data was found for this range');
    expect(result.narrative).not.toContain('0 years');
  });

  it('includes digest facts in narrative generation payloads', () => {
    const facts = buildNarrativeFacts({
      status: 'empty',
      prompt: 'Give me a weekly digest',
      query: {
        ...paceInput.query,
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        requestedTimeInterval: TimeIntervals.Weekly,
        digestMode: 'weekly',
        metricSelections: [
          {
            metricKey: 'distance',
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
          },
          {
            metricKey: 'duration',
            dataType: 'Duration',
            valueType: ChartDataValueTypes.Total,
          },
        ],
      },
      metricLabels: ['distance', 'duration'],
      metricResults: [
        {
          metricKey: 'distance',
          metricLabel: 'distance',
          query: {
            ...paceInput.query,
            resultKind: 'aggregate',
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
          },
          aggregation: {
            ...paceInput.aggregation,
            dataType: 'Distance',
            valueType: ChartDataValueTypes.Total,
            resolvedTimeInterval: TimeIntervals.Weekly,
            buckets: [],
          },
          summary: {
            ...paceSummary,
            overallAggregateValue: null,
            latestBucket: null,
          },
          presentation: {
            title: 'Distance',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      digest: {
        granularity: 'weekly',
        periodCount: 2,
        nonEmptyPeriodCount: 0,
        periods: [
          {
            bucketKey: '2026-W09',
            time: Date.parse('2026-02-23T00:00:00.000Z'),
            hasData: false,
            metrics: [
              {
                metricKey: 'distance',
                metricLabel: 'Distance',
                dataType: 'Distance',
                valueType: ChartDataValueTypes.Total,
                aggregateValue: null,
                totalCount: 0,
              },
            ],
          },
          {
            bucketKey: '2026-W10',
            time: Date.parse('2026-03-02T00:00:00.000Z'),
            hasData: false,
            metrics: [
              {
                metricKey: 'distance',
                metricLabel: 'Distance',
                dataType: 'Distance',
                valueType: ChartDataValueTypes.Total,
                aggregateValue: null,
                totalCount: 0,
              },
            ],
          },
        ],
      },
      presentation: {
        title: 'Weekly digest',
        chartType: ChartTypes.LinesVertical,
      },
    }) as {
      narrativeMode?: string;
      digest?: {
        granularity: string;
        periods: Array<{ label: string; hasData: boolean }>;
      };
    };

    expect(facts.narrativeMode).toBe('digest');
    expect(facts.digest?.granularity).toBe('weekly');
    expect(facts.digest?.periods).toHaveLength(2);
    expect(facts.digest?.periods.every(period => period.hasData === false)).toBe(true);
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

  it('builds compact deterministic compare summary with net change, extremes, and period deltas', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => ({
        source: 'genkit',
        narrative: 'Base narrative.',
      }),
    });

    const result = await summarizeAiInsightResult(compareDeltaInput);

    expect(result.source).toBe('genkit');
    expect(result.narrative).toBe('Base narrative.');
    expect(result.deterministicCompareSummary).toContain('From 2025 to 2028, power increased by');
    expect(result.deterministicCompareSummary).toContain('Largest increase: 2025 to 2026');
    expect(result.deterministicCompareSummary).toContain('Largest decrease: 2026 to 2027');
    expect(result.deterministicCompareSummary).toContain('Period deltas:');
    expect(result.deterministicCompareSummary).toContain('2027 to 2028 (no change)');
    expect(result.deterministicCompareSummary).toMatch(
      /2025 to 2026 \(\+15 (?:W|watt)\)\. Likely contributors: Cycling \(\+15 (?:W|watt)\)/i,
    );
    expect(result.deterministicCompareSummary).toMatch(
      /2026 to 2027 \(-10 (?:W|watt)\)\. Likely contributors: Cycling \(-10 (?:W|watt)\)/i,
    );
    expect(result.deterministicCompareSummary).toMatch(
      /2027 to 2028 \(no change\)\. Likely contributors offset each other: Cycling \(\+10 (?:W|watt)\), Running \(-10 (?:W|watt)\)/i,
    );
    expect(result.deterministicCompareSummary).not.toContain('Event evidence is linked below.');
  });

  it('uses no-change contributor fallback copy when period deltas have no contributor shifts', async () => {
    setSummarizeInsightDependenciesForTesting({
      generateNarrative: async () => ({
        source: 'genkit',
        narrative: 'Base narrative.',
      }),
    });

    const result = await summarizeAiInsightResult({
      ...compareDeltaInput,
      summary: {
        ...compareDeltaInput.summary,
        periodDeltas: [
          {
            ...compareDeltaInput.summary.periodDeltas[2],
            contributors: [],
          },
        ],
      },
    });

    expect(result.source).toBe('genkit');
    expect(result.deterministicCompareSummary).toContain(
      '2027 to 2028 (no change). No major contributor shifts detected',
    );
  });
});
