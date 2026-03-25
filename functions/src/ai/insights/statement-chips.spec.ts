import { describe, expect, it } from 'vitest';
import {
  buildAggregateStatementChips,
  buildEventLookupStatementChips,
  buildLatestEventStatementChips,
  buildMultiMetricStatementChips,
  buildPowerCurveStatementChips,
} from './statement-chips';

const aggregateSummary = {
  matchedEventCount: 22,
  overallAggregateValue: 420,
  peakBucket: { bucketKey: '2026-02', aggregateValue: 180, totalCount: 6 },
  lowestBucket: { bucketKey: '2026-01', aggregateValue: 90, totalCount: 6 },
  latestBucket: { bucketKey: '2026-03', aggregateValue: 150, totalCount: 10 },
  activityMix: null,
  bucketCoverage: { nonEmptyBucketCount: 6, totalBucketCount: 6 },
  trend: {
    previousBucket: { bucketKey: '2026-02', aggregateValue: 120, totalCount: 6 },
    deltaAggregateValue: 30,
  },
  periodDeltas: [
    {
      fromBucket: { bucketKey: '2026-02', aggregateValue: 120, totalCount: 6 },
      toBucket: { bucketKey: '2026-03', aggregateValue: 150, totalCount: 10 },
      deltaAggregateValue: 30,
      direction: 'increase' as const,
      contributors: [],
      eventContributors: [{
        eventId: 'event-1',
        startDate: '2026-03-02T00:00:00.000Z',
        activityType: 'Cycling',
        eventStatValue: 150,
        deltaContributionValue: 15,
        direction: 'increase' as const,
      }],
    },
  ],
  anomalyCallouts: [
    {
      id: 'callout:spike',
      statementId: 'anomaly:spike:distance:2026-03',
      kind: 'spike' as const,
      snippet: 'Unusual spike',
      confidenceTier: 'high' as const,
      score: 4.1,
      evidenceRefs: [{
        kind: 'bucket' as const,
        label: 'Bucket 2026-03',
        bucketKey: '2026-03',
      }],
    },
  ],
};

describe('statement-chips', () => {
  it('builds aggregate chips with narrative, trend, compare, and anomaly links', () => {
    const chips = buildAggregateStatementChips({
      summary: aggregateSummary,
      eventRanking: {
        primaryEventId: 'event-9',
        topEventIds: ['event-9', 'event-1'],
        matchedEventCount: 2,
      },
    });

    expect(chips.some(chip => chip.statementId === 'aggregate:narrative' && chip.chipType === 'confidence')).toBe(true);
    expect(chips.some(chip => chip.statementId === 'aggregate:trend' && chip.chipType === 'evidence')).toBe(true);
    expect(chips.some(chip => chip.statementId === 'aggregate:compare' && chip.chipType === 'confidence')).toBe(true);
    expect(chips.some(chip => chip.statementId === 'anomaly:spike:distance:2026-03' && chip.chipType === 'evidence')).toBe(true);
  });

  it('builds multi-metric narrative and metric-level chips', () => {
    const chips = buildMultiMetricStatementChips({
      metricResults: [
        {
          metricKey: 'cadence',
          metricLabel: 'Cadence',
          query: {} as never,
          aggregation: {} as never,
          summary: aggregateSummary,
          presentation: {} as never,
        },
      ],
    });

    expect(chips.some(chip => chip.statementId === 'multi_metric:narrative' && chip.chipType === 'confidence')).toBe(true);
    expect(chips.some(chip => chip.statementId === 'multi_metric:cadence' && chip.chipType === 'confidence')).toBe(true);
  });

  it('builds event lookup chips with event evidence', () => {
    const chips = buildEventLookupStatementChips({
      primaryEventId: 'event-3',
      topEventIds: ['event-3', 'event-2'],
      matchedEventCount: 4,
    });

    expect(chips).toHaveLength(2);
    expect(chips.some(chip => chip.chipType === 'evidence')).toBe(true);
  });

  it('builds latest event chips with event evidence', () => {
    const chips = buildLatestEventStatementChips({
      eventId: 'event-8',
      startDate: '2026-03-03T10:00:00.000Z',
      matchedEventCount: 3,
    });

    expect(chips).toHaveLength(2);
    expect(chips.some(chip => chip.statementId === 'latest_event:narrative')).toBe(true);
  });

  it('builds power-curve chips only when concrete series evidence exists', () => {
    const withSeries = buildPowerCurveStatementChips({
      mode: 'best',
      resolvedTimeInterval: 0 as never,
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
    });
    const withoutSeries = buildPowerCurveStatementChips({
      mode: 'best',
      resolvedTimeInterval: 0 as never,
      matchedEventCount: 0,
      requestedSeriesCount: 1,
      returnedSeriesCount: 0,
      safetyGuardApplied: false,
      safetyGuardMaxSeries: null,
      trimmedSeriesCount: 0,
      series: [],
    });

    expect(withSeries.some(chip => chip.chipType === 'evidence')).toBe(true);
    expect(withoutSeries.some(chip => chip.chipType === 'evidence')).toBe(false);
  });
});
