import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { validateAiInsightsResponse } from '@shared/ai-insights-response.contract';
import { AI_INSIGHTS_TOP_RESULTS_MAX } from '@shared/ai-insights-ranking.constants';

describe('Ai insights shared response contract', () => {
  it('accepts valid responses for all result kinds', () => {
    const aggregate = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      deterministicCompareSummary: 'From 2025 to 2026, distance increased by 10 km.',
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
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
        periodDeltas: [
          {
            fromBucket: {
              bucketKey: '2025',
              time: Date.parse('2025-01-01T00:00:00.000Z'),
              aggregateValue: 120,
              totalCount: 3,
            },
            toBucket: {
              bucketKey: '2026',
              time: Date.parse('2026-01-01T00:00:00.000Z'),
              aggregateValue: 130,
              totalCount: 4,
            },
            deltaAggregateValue: 10,
            direction: 'increase',
            contributors: [
              {
                seriesKey: ActivityTypes.Cycling,
                deltaAggregateValue: 10,
                direction: 'increase',
              },
            ],
            eventContributors: [
              {
                eventId: 'event-123',
                startDate: '2026-02-10T08:00:00.000Z',
                activityType: ActivityTypes.Cycling,
                eventStatValue: 130,
                deltaContributionValue: 10,
                direction: 'increase',
              },
            ],
          },
        ],
      },
      presentation: {
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });
    const eventLookup = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: 'ok',
      query: {
        resultKind: 'event_lookup',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Maximum,
        categoryType: ChartDataCategoryTypes.DateType,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
      eventLookup: {
        primaryEventId: 'event-1',
        topEventIds: ['event-1'],
        matchedEventCount: 1,
      },
      presentation: {
        title: 'Top event',
        chartType: ChartTypes.LinesVertical,
      },
    });
    const latestEvent = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'latest_event',
      narrative: 'ok',
      query: {
        resultKind: 'latest_event',
        categoryType: ChartDataCategoryTypes.DateType,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Running],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
      latestEvent: {
        eventId: 'event-2',
        startDate: '2026-03-21T10:00:00.000Z',
        matchedEventCount: 4,
      },
      presentation: {
        title: 'Latest event',
        chartType: ChartTypes.LinesVertical,
      },
    });
    const multiMetric = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      narrative: 'ok',
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
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
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
      metricResults: [
        {
          metricKey: 'cadence',
          metricLabel: 'Cadence',
          query: {
            resultKind: 'aggregate',
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            requestedTimeInterval: TimeIntervals.Monthly,
            activityTypeGroups: [],
            activityTypes: [ActivityTypes.Cycling],
            dateRange: {
              kind: 'bounded',
              startDate: '2026-01-01T00:00:00.000Z',
              endDate: '2026-03-22T23:59:59.999Z',
              timezone: 'UTC',
              source: 'prompt',
            },
            chartType: ChartTypes.LinesVertical,
          },
          aggregation: {
            dataType: 'Average Cadence',
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
            title: 'Cadence',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      digest: {
        granularity: 'weekly',
        periodCount: 2,
        nonEmptyPeriodCount: 1,
        periods: [
          {
            bucketKey: '2026-W09',
            time: Date.parse('2026-02-23T00:00:00.000Z'),
            hasData: true,
            metrics: [
              {
                metricKey: 'cadence',
                metricLabel: 'Cadence',
                dataType: 'Average Cadence',
                valueType: ChartDataValueTypes.Average,
                aggregateValue: 86,
                totalCount: 4,
              },
            ],
          },
          {
            bucketKey: '2026-W10',
            time: Date.parse('2026-03-02T00:00:00.000Z'),
            hasData: false,
            metrics: [
              {
                metricKey: 'cadence',
                metricLabel: 'Cadence',
                dataType: 'Average Cadence',
                valueType: ChartDataValueTypes.Average,
                aggregateValue: null,
                totalCount: 0,
              },
            ],
          },
        ],
      },
      presentation: {
        title: 'Cadence and power',
        chartType: ChartTypes.LinesVertical,
      },
    });
    const powerCurve = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'power_curve',
      narrative: 'Best power curve',
      query: {
        resultKind: 'power_curve',
        mode: 'best',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        defaultedToCycling: true,
      },
      powerCurve: {
        mode: 'best',
        resolvedTimeInterval: TimeIntervals.Auto,
        matchedEventCount: 2,
        requestedSeriesCount: 1,
        returnedSeriesCount: 1,
        safetyGuardApplied: false,
        safetyGuardMaxSeries: null,
        trimmedSeriesCount: 0,
        series: [
          {
            seriesKey: 'best',
            label: 'Best power curve',
            matchedEventCount: 2,
            bucketStartDate: null,
            bucketEndDate: null,
            points: [
              { duration: 5, power: 620, wattsPerKg: 8.1 },
              { duration: 60, power: 410, wattsPerKg: 5.4 },
            ],
          },
        ],
      },
      presentation: {
        title: 'Best power curve for Cycling',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(aggregate.ok).toBe(true);
    expect(eventLookup.ok).toBe(true);
    expect(latestEvent.ok).toBe(true);
    expect(multiMetric.ok).toBe(true);
    expect(powerCurve.ok).toBe(true);
  });

  it('rejects malformed digest payloads with a dedicated reason', () => {
    const invalidDigestResponse = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      narrative: 'ok',
      query: {
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Weekly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
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
      metricResults: [
        {
          metricKey: 'cadence',
          metricLabel: 'Cadence',
          query: {
            resultKind: 'aggregate',
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            requestedTimeInterval: TimeIntervals.Weekly,
            activityTypeGroups: [],
            activityTypes: [ActivityTypes.Cycling],
            dateRange: {
              kind: 'bounded',
              startDate: '2026-01-01T00:00:00.000Z',
              endDate: '2026-03-22T23:59:59.999Z',
              timezone: 'UTC',
              source: 'prompt',
            },
            chartType: ChartTypes.LinesVertical,
          },
          aggregation: {
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Weekly,
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
            title: 'Cadence',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      digest: {
        granularity: 'weekly',
        periodCount: 1,
        nonEmptyPeriodCount: 0,
        periods: [
          {
            bucketKey: '2026-W09',
            time: Date.parse('2026-02-23T00:00:00.000Z'),
            hasData: false,
            metrics: [],
          },
        ],
      },
      presentation: {
        title: 'Digest',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(invalidDigestResponse.ok).toBe(false);
    if (invalidDigestResponse.ok) {
      return;
    }

    expect(invalidDigestResponse.reason).toBe('digest_invalid');
  });

  it('rejects invalid query combinations with deterministic reason', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: 'not-valid',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: null,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        periodMode: 'not-valid',
        requestedDateRanges: [{}],
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
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
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('query_invalid');
    expect(result.details?.queryKeys).toContain('periodMode');
    expect(result.details?.queryKeys).toContain('requestedDateRanges');
    expect(result.details?.valueTypeType).toBe('string');
  });

  it('accepts topEventIds up to the shared max cap and rejects values above it', () => {
    const topIdsAtLimit = Array.from({ length: AI_INSIGHTS_TOP_RESULTS_MAX }, (_, index) => `event-${index + 1}`);
    const validResult = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: 'ok',
      query: {
        resultKind: 'event_lookup',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Maximum,
        categoryType: ChartDataCategoryTypes.DateType,
        topResultsLimit: AI_INSIGHTS_TOP_RESULTS_MAX,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
      eventLookup: {
        primaryEventId: topIdsAtLimit[0],
        topEventIds: topIdsAtLimit,
        matchedEventCount: AI_INSIGHTS_TOP_RESULTS_MAX,
      },
      presentation: {
        title: 'Top events',
        chartType: ChartTypes.LinesVertical,
      },
    });

    const invalidResult = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: 'ok',
      query: {
        resultKind: 'event_lookup',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Maximum,
        categoryType: ChartDataCategoryTypes.DateType,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
      eventLookup: {
        primaryEventId: 'event-1',
        topEventIds: [...topIdsAtLimit, 'event-over-cap'],
        matchedEventCount: AI_INSIGHTS_TOP_RESULTS_MAX + 1,
      },
      presentation: {
        title: 'Top events',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(validResult.ok).toBe(true);
    expect(invalidResult.ok).toBe(false);
    if (invalidResult.ok) {
      return;
    }
    expect(invalidResult.reason).toBe('event_lookup_invalid');
  });

  it('rejects invalid period delta directions in aggregate summaries', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
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
        periodDeltas: [
          {
            fromBucket: {
              bucketKey: '2025',
              time: Date.parse('2025-01-01T00:00:00.000Z'),
              aggregateValue: 120,
              totalCount: 3,
            },
            toBucket: {
              bucketKey: '2026',
              time: Date.parse('2026-01-01T00:00:00.000Z'),
              aggregateValue: 130,
              totalCount: 4,
            },
            deltaAggregateValue: 10,
            direction: 'not-valid',
            contributors: [],
          },
        ],
      },
      presentation: {
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('summary_invalid');
  });

  it('rejects invalid period-delta event contributor fields', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
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
        periodDeltas: [
          {
            fromBucket: {
              bucketKey: '2025',
              time: Date.parse('2025-01-01T00:00:00.000Z'),
              aggregateValue: 120,
              totalCount: 3,
            },
            toBucket: {
              bucketKey: '2026',
              time: Date.parse('2026-01-01T00:00:00.000Z'),
              aggregateValue: 130,
              totalCount: 4,
            },
            deltaAggregateValue: 10,
            direction: 'increase',
            contributors: [],
            eventContributors: [
              {
                eventId: 42,
                startDate: '2026-02-10T08:00:00.000Z',
                activityType: ActivityTypes.Cycling,
                eventStatValue: 130,
                deltaContributionValue: 10,
                direction: 'increase',
              },
            ],
          },
        ],
      },
      presentation: {
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('summary_invalid');
  });

  it('rejects non-string deterministic compare summary values for aggregate responses', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      deterministicCompareSummary: 42,
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
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
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('deterministic_compare_summary_invalid');
  });

  it('accepts anomaly callouts and statement chips for aggregate responses', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      statementChips: [
        {
          statementId: 'aggregate:narrative',
          chipType: 'confidence',
          label: 'High confidence',
          confidenceTier: 'high',
        },
        {
          statementId: 'anomaly:spike:distance:2026-02',
          chipType: 'evidence',
          label: 'Evidence linked',
          evidenceRefs: [
            {
              kind: 'bucket',
              label: 'Bucket 2026-02',
              bucketKey: '2026-02',
            },
          ],
        },
      ],
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        resolvedTimeInterval: TimeIntervals.Monthly,
        buckets: [],
      },
      summary: {
        matchedEventCount: 12,
        overallAggregateValue: 350,
        peakBucket: {
          bucketKey: '2026-02',
          time: Date.parse('2026-02-01T00:00:00.000Z'),
          aggregateValue: 220,
          totalCount: 4,
        },
        lowestBucket: {
          bucketKey: '2026-01',
          time: Date.parse('2026-01-01T00:00:00.000Z'),
          aggregateValue: 40,
          totalCount: 4,
        },
        latestBucket: {
          bucketKey: '2026-03',
          time: Date.parse('2026-03-01T00:00:00.000Z'),
          aggregateValue: 90,
          totalCount: 4,
        },
        activityMix: null,
        bucketCoverage: {
          nonEmptyBucketCount: 3,
          totalBucketCount: 3,
        },
        trend: null,
        periodDeltas: null,
        anomalyCallouts: [
          {
            id: 'callout:spike:distance:2026-02',
            statementId: 'anomaly:spike:distance:2026-02',
            kind: 'spike',
            snippet: 'Unusual spike at 2026-02.',
            confidenceTier: 'high',
            score: 4.2,
            evidenceRefs: [
              {
                kind: 'bucket',
                label: 'Bucket 2026-02',
                bucketKey: '2026-02',
              },
            ],
          },
        ],
      },
      presentation: {
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(true);
  });

  it('rejects malformed statement chips', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      statementChips: [
        {
          statementId: 'aggregate:narrative',
          chipType: 'confidence',
          label: 'Missing tier',
        },
      ],
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
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
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('statement_chips_invalid');
  });

  it('rejects malformed anomaly callouts with a dedicated reason', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        resolvedTimeInterval: TimeIntervals.Monthly,
        buckets: [],
      },
      summary: {
        matchedEventCount: 10,
        overallAggregateValue: 120,
        peakBucket: null,
        lowestBucket: null,
        latestBucket: null,
        activityMix: null,
        bucketCoverage: null,
        trend: null,
        periodDeltas: null,
        anomalyCallouts: [
          {
            id: 'callout:spike:distance:2026-02',
            statementId: 'anomaly:spike:distance:2026-02',
            kind: 'spike',
            snippet: 'Unusual spike at 2026-02.',
            confidenceTier: 'critical',
            score: 4.2,
            evidenceRefs: [
              {
                kind: 'bucket',
                label: 'Bucket 2026-02',
                bucketKey: '2026-02',
              },
            ],
          },
        ],
      },
      presentation: {
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('anomaly_callouts_invalid');
  });

  it('rejects statement chips that do not link to allowed statement ids', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      statementChips: [
        {
          statementId: 'power_curve:narrative',
          chipType: 'confidence',
          label: 'High confidence',
          confidenceTier: 'high',
        },
      ],
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
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
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('statement_chips_invalid');
  });

  it('rejects malformed statement chip evidence references', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'aggregate',
      narrative: 'ok',
      statementChips: [
        {
          statementId: 'aggregate:narrative',
          chipType: 'evidence',
          label: 'Evidence linked',
          evidenceRefs: [
            {
              kind: 'bucket',
              label: 'Bucket 2026-02',
            },
          ],
        },
      ],
      query: {
        resultKind: 'aggregate',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.ColumnsVertical,
      },
      aggregation: {
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Total,
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
        title: 'Total distance',
        chartType: ChartTypes.ColumnsVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('statement_chips_invalid');
  });

  it('rejects metric-level malformed anomaly callouts with dedicated reason', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      narrative: 'ok',
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
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
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
      metricResults: [
        {
          metricKey: 'cadence',
          metricLabel: 'Cadence',
          query: {
            resultKind: 'aggregate',
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            requestedTimeInterval: TimeIntervals.Monthly,
            activityTypeGroups: [],
            activityTypes: [ActivityTypes.Cycling],
            dateRange: {
              kind: 'bounded',
              startDate: '2026-01-01T00:00:00.000Z',
              endDate: '2026-03-22T23:59:59.999Z',
              timezone: 'UTC',
              source: 'prompt',
            },
            chartType: ChartTypes.LinesVertical,
          },
          aggregation: {
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Monthly,
            buckets: [],
          },
          summary: {
            matchedEventCount: 12,
            overallAggregateValue: 88,
            peakBucket: null,
            lowestBucket: null,
            latestBucket: null,
            activityMix: null,
            bucketCoverage: null,
            trend: null,
            anomalyCallouts: [
              {
                id: 'callout:drop:average_cadence:2026-02',
                statementId: 'anomaly:drop:average_cadence:2026-02',
                kind: 'drop',
                snippet: 'Unusual drop at 2026-02.',
                confidenceTier: 'critical',
                score: 2.6,
                evidenceRefs: [
                  {
                    kind: 'bucket',
                    label: 'Bucket 2026-02',
                    bucketKey: '2026-02',
                  },
                ],
              },
            ],
          },
          presentation: {
            title: 'Cadence',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      presentation: {
        title: 'Cadence and power',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('anomaly_callouts_invalid');
  });

  it('rejects statement chip linkage for event_lookup responses', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'event_lookup',
      narrative: 'ok',
      statementChips: [
        {
          statementId: 'aggregate:narrative',
          chipType: 'confidence',
          label: 'High confidence',
          confidenceTier: 'high',
        },
      ],
      query: {
        resultKind: 'event_lookup',
        dataType: 'Distance',
        valueType: ChartDataValueTypes.Maximum,
        categoryType: ChartDataCategoryTypes.DateType,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
      eventLookup: {
        primaryEventId: 'event-1',
        topEventIds: ['event-1'],
        matchedEventCount: 1,
      },
      presentation: {
        title: 'Top event',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('statement_chips_invalid');
  });

  it('rejects statement chip linkage for latest_event responses', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'latest_event',
      narrative: 'ok',
      statementChips: [
        {
          statementId: 'multi_metric:narrative',
          chipType: 'confidence',
          label: 'High confidence',
          confidenceTier: 'high',
        },
      ],
      query: {
        resultKind: 'latest_event',
        categoryType: ChartDataCategoryTypes.DateType,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
      },
      latestEvent: {
        eventId: 'event-2',
        startDate: '2026-03-21T10:00:00.000Z',
        matchedEventCount: 4,
      },
      presentation: {
        title: 'Latest event',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('statement_chips_invalid');
  });

  it('rejects statement chip linkage for power_curve responses', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'power_curve',
      narrative: 'Best power curve',
      statementChips: [
        {
          statementId: 'latest_event:narrative',
          chipType: 'confidence',
          label: 'High confidence',
          confidenceTier: 'high',
        },
      ],
      query: {
        resultKind: 'power_curve',
        mode: 'best',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [ActivityTypes.Cycling],
        dateRange: {
          kind: 'bounded',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        defaultedToCycling: false,
      },
      powerCurve: {
        mode: 'best',
        resolvedTimeInterval: TimeIntervals.Monthly,
        matchedEventCount: 3,
        requestedSeriesCount: 1,
        returnedSeriesCount: 1,
        safetyGuardApplied: false,
        safetyGuardMaxSeries: null,
        trimmedSeriesCount: 0,
        series: [{
          seriesKey: 'best',
          label: 'Best power curve',
          matchedEventCount: 3,
          bucketStartDate: null,
          bucketEndDate: null,
          points: [{ duration: 5, power: 600 }],
        }],
      },
      presentation: {
        title: 'Best power curve',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('statement_chips_invalid');
  });

  it('accepts multi-metric statement chips linked to metric and anomaly statement ids', () => {
    const result = validateAiInsightsResponse({
      status: 'ok',
      resultKind: 'multi_metric_aggregate',
      narrative: 'ok',
      statementChips: [
        {
          statementId: 'multi_metric:narrative',
          chipType: 'confidence',
          label: 'Medium confidence',
          confidenceTier: 'medium',
        },
        {
          statementId: 'multi_metric:cadence',
          chipType: 'confidence',
          label: 'High confidence',
          confidenceTier: 'high',
        },
        {
          statementId: 'anomaly:drop:average_cadence:2026-02',
          chipType: 'evidence',
          label: 'Evidence linked',
          evidenceRefs: [
            {
              kind: 'bucket',
              label: 'Bucket 2026-02',
              bucketKey: '2026-02',
            },
          ],
        },
      ],
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
          endDate: '2026-03-22T23:59:59.999Z',
          timezone: 'UTC',
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
      metricResults: [
        {
          metricKey: 'cadence',
          metricLabel: 'Cadence',
          query: {
            resultKind: 'aggregate',
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            requestedTimeInterval: TimeIntervals.Monthly,
            activityTypeGroups: [],
            activityTypes: [ActivityTypes.Cycling],
            dateRange: {
              kind: 'bounded',
              startDate: '2026-01-01T00:00:00.000Z',
              endDate: '2026-03-22T23:59:59.999Z',
              timezone: 'UTC',
              source: 'prompt',
            },
            chartType: ChartTypes.LinesVertical,
          },
          aggregation: {
            dataType: 'Average Cadence',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Monthly,
            buckets: [],
          },
          summary: {
            matchedEventCount: 12,
            overallAggregateValue: 88,
            peakBucket: null,
            lowestBucket: null,
            latestBucket: null,
            activityMix: null,
            bucketCoverage: null,
            trend: null,
            anomalyCallouts: [
              {
                id: 'callout:drop:average_cadence:2026-02',
                statementId: 'anomaly:drop:average_cadence:2026-02',
                kind: 'drop',
                snippet: 'Unusual drop at 2026-02.',
                confidenceTier: 'medium',
                score: 2.6,
                evidenceRefs: [
                  {
                    kind: 'bucket',
                    label: 'Bucket 2026-02',
                    bucketKey: '2026-02',
                  },
                ],
              },
            ],
          },
          presentation: {
            title: 'Cadence',
            chartType: ChartTypes.LinesVertical,
          },
        },
        {
          metricKey: 'power',
          metricLabel: 'Power',
          query: {
            resultKind: 'aggregate',
            dataType: 'Average Power',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            requestedTimeInterval: TimeIntervals.Monthly,
            activityTypeGroups: [],
            activityTypes: [ActivityTypes.Cycling],
            dateRange: {
              kind: 'bounded',
              startDate: '2026-01-01T00:00:00.000Z',
              endDate: '2026-03-22T23:59:59.999Z',
              timezone: 'UTC',
              source: 'prompt',
            },
            chartType: ChartTypes.LinesVertical,
          },
          aggregation: {
            dataType: 'Average Power',
            valueType: ChartDataValueTypes.Average,
            categoryType: ChartDataCategoryTypes.DateType,
            resolvedTimeInterval: TimeIntervals.Monthly,
            buckets: [],
          },
          summary: {
            matchedEventCount: 12,
            overallAggregateValue: 210,
            peakBucket: null,
            lowestBucket: null,
            latestBucket: null,
            activityMix: null,
            bucketCoverage: null,
            trend: null,
          },
          presentation: {
            title: 'Power',
            chartType: ChartTypes.LinesVertical,
          },
        },
      ],
      presentation: {
        title: 'Cadence and power',
        chartType: ChartTypes.LinesVertical,
      },
    });

    expect(result.ok).toBe(true);
  });
});
