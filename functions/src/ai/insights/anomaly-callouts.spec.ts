import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AI_INSIGHTS_ANOMALY_MAX_CALLOUTS } from '../../../../shared/ai-insights-anomaly.constants';
import { buildSummaryAnomalyCallouts } from './anomaly-callouts';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

const aggregateDateQuery = {
  resultKind: 'aggregate' as const,
  dataType: 'Distance',
  valueType: ChartDataValueTypes.Total,
  categoryType: ChartDataCategoryTypes.DateType,
  requestedTimeInterval: TimeIntervals.Monthly,
  activityTypeGroups: [],
  activityTypes: [ActivityTypes.Cycling],
  dateRange: {
    kind: 'bounded' as const,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-06-30T23:59:59.999Z',
    timezone: 'UTC',
    source: 'prompt' as const,
  },
  chartType: ChartTypes.ColumnsVertical,
};

const multiMetricDateQuery = {
  resultKind: 'multi_metric_aggregate' as const,
  groupingMode: 'date' as const,
  categoryType: ChartDataCategoryTypes.DateType,
  requestedTimeInterval: TimeIntervals.Monthly,
  activityTypeGroups: [],
  activityTypes: [ActivityTypes.Cycling],
  dateRange: {
    kind: 'bounded' as const,
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-06-30T23:59:59.999Z',
    timezone: 'UTC',
    source: 'prompt' as const,
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
};

describe('buildSummaryAnomalyCallouts', () => {
  it('detects spike/drop callouts with explicit confidence tiers', () => {
    const callouts = buildSummaryAnomalyCallouts({
      query: aggregateDateQuery,
      matchedEventCount: 24,
      buckets: [
        { bucketKey: '2026-01', aggregateValue: 100, totalCount: 4, seriesCounts: { [ActivityTypes.Cycling]: 4 } },
        { bucketKey: '2026-02', aggregateValue: 101, totalCount: 4, seriesCounts: { [ActivityTypes.Cycling]: 4 } },
        { bucketKey: '2026-03', aggregateValue: 99, totalCount: 4, seriesCounts: { [ActivityTypes.Cycling]: 4 } },
        { bucketKey: '2026-04', aggregateValue: 102, totalCount: 4, seriesCounts: { [ActivityTypes.Cycling]: 4 } },
        { bucketKey: '2026-05', aggregateValue: 98, totalCount: 4, seriesCounts: { [ActivityTypes.Cycling]: 4 } },
        { bucketKey: '2026-06', aggregateValue: 240, totalCount: 4, seriesCounts: { [ActivityTypes.Cycling]: 4 } },
      ],
    });

    expect(callouts).toBeTruthy();
    expect(callouts?.some(callout => callout.kind === 'spike')).toBe(true);
    expect(callouts?.every(callout => callout.confidenceTier === 'medium' || callout.confidenceTier === 'high')).toBe(true);
    expect(callouts?.length).toBeLessThanOrEqual(AI_INSIGHTS_ANOMALY_MAX_CALLOUTS);
  });

  it('detects distribution-shift callouts with series evidence', () => {
    const callouts = buildSummaryAnomalyCallouts({
      query: aggregateDateQuery,
      matchedEventCount: 30,
      buckets: [
        { bucketKey: '2026-01', aggregateValue: 100, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: '2026-02', aggregateValue: 99, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: '2026-03', aggregateValue: 100, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: '2026-04', aggregateValue: 101, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: '2026-05', aggregateValue: 100, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: '2026-06', aggregateValue: 102, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 4, [ActivityTypes.Cycling]: 6 } },
      ],
    });

    const mixShift = callouts?.find(callout => callout.kind === 'activity_mix_shift');
    expect(mixShift).toBeTruthy();
    expect(mixShift?.evidenceRefs.some(evidenceRef => evidenceRef.kind === 'series')).toBe(true);
    expect(mixShift?.confidenceTier).toBe('medium');
  });

  it('formats timestamp bucket keys into readable dates in anomaly snippets and evidence', () => {
    const callouts = buildSummaryAnomalyCallouts({
      query: aggregateDateQuery,
      matchedEventCount: 30,
      buckets: [
        { bucketKey: Date.UTC(2026, 0, 1), aggregateValue: 100, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 1, 1), aggregateValue: 99, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 2, 1), aggregateValue: 100, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 3, 1), aggregateValue: 101, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 4, 1), aggregateValue: 100, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 5, 1), aggregateValue: 102, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 4, [ActivityTypes.Cycling]: 6 } },
      ],
    });

    const mixShift = callouts?.find(callout => callout.kind === 'activity_mix_shift');
    expect(mixShift).toBeTruthy();
    expect(mixShift?.snippet).toContain('May 2026');
    expect(mixShift?.snippet).toContain('Jun 2026');
    expect(mixShift?.snippet).not.toMatch(/\d{11,}/);
    expect(mixShift?.evidenceRefs.find(evidenceRef => evidenceRef.kind === 'bucket' && evidenceRef.label.startsWith('From '))?.label)
      .toBe('From May 2026');
    expect(mixShift?.evidenceRefs.find(evidenceRef => evidenceRef.kind === 'bucket' && evidenceRef.label.startsWith('To '))?.label)
      .toBe('To Jun 2026');
  });

  it('formats timestamp bucket labels using UTC boundaries regardless of query timezone', () => {
    const callouts = buildSummaryAnomalyCallouts({
      query: {
        ...aggregateDateQuery,
        dateRange: {
          ...aggregateDateQuery.dateRange,
          timezone: 'America/Los_Angeles',
        },
      },
      matchedEventCount: 30,
      buckets: [
        { bucketKey: Date.UTC(2026, 0, 1), aggregateValue: 100, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 1, 1), aggregateValue: 99, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 2, 1), aggregateValue: 100, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 3, 1), aggregateValue: 101, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 4, 1), aggregateValue: 100, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 8, [ActivityTypes.Cycling]: 2 } },
        { bucketKey: Date.UTC(2026, 5, 1), aggregateValue: 102, totalCount: 10, seriesCounts: { [ActivityTypes.Running]: 4, [ActivityTypes.Cycling]: 6 } },
      ],
    });

    const mixShift = callouts?.find(callout => callout.kind === 'activity_mix_shift');
    expect(mixShift).toBeTruthy();
    expect(mixShift?.snippet).toContain('May 2026');
    expect(mixShift?.snippet).toContain('Jun 2026');
    expect(mixShift?.snippet).not.toContain('Apr 2026');
    expect(mixShift?.evidenceRefs.find(evidenceRef => evidenceRef.kind === 'bucket' && evidenceRef.label.startsWith('From '))?.label)
      .toBe('From May 2026');
    expect(mixShift?.evidenceRefs.find(evidenceRef => evidenceRef.kind === 'bucket' && evidenceRef.label.startsWith('To '))?.label)
      .toBe('To Jun 2026');
  });

  it('suppresses callouts for low-signal ranges', () => {
    const callouts = buildSummaryAnomalyCallouts({
      query: aggregateDateQuery,
      matchedEventCount: 7,
      buckets: [
        { bucketKey: '2026-01', aggregateValue: 100, totalCount: 2 },
        { bucketKey: '2026-02', aggregateValue: 120, totalCount: 2 },
        { bucketKey: '2026-03', aggregateValue: 130, totalCount: 2 },
        { bucketKey: '2026-04', aggregateValue: 90, totalCount: 2 },
        { bucketKey: '2026-05', aggregateValue: 110, totalCount: 2 },
        { bucketKey: '2026-06', aggregateValue: 80, totalCount: 2 },
      ],
    });

    expect(callouts).toBeNull();
  });

  it('returns null for unsupported non-date query categories', () => {
    const callouts = buildSummaryAnomalyCallouts({
      query: {
        ...aggregateDateQuery,
        categoryType: ChartDataCategoryTypes.ActivityType,
      },
      matchedEventCount: 20,
      buckets: [
        { bucketKey: ActivityTypes.Cycling, aggregateValue: 100, totalCount: 8 },
        { bucketKey: ActivityTypes.Running, aggregateValue: 120, totalCount: 8 },
        { bucketKey: ActivityTypes.Walking, aggregateValue: 80, totalCount: 8 },
        { bucketKey: ActivityTypes.Swimming, aggregateValue: 50, totalCount: 8 },
        { bucketKey: ActivityTypes.Triathlon, aggregateValue: 200, totalCount: 8 },
        { bucketKey: ActivityTypes.Hiking, aggregateValue: 90, totalCount: 8 },
      ],
    });

    expect(callouts).toBeNull();
  });

  it('supports date-grouped multi-metric anomaly detection and skips overall grouping', () => {
    const dateGroupedCallouts = buildSummaryAnomalyCallouts({
      query: multiMetricDateQuery,
      matchedEventCount: 20,
      buckets: [
        { bucketKey: '2026-01', aggregateValue: 100, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-02', aggregateValue: 101, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-03', aggregateValue: 99, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-04', aggregateValue: 98, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-05', aggregateValue: 102, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-06', aggregateValue: 220, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
      ],
    });
    const overallGroupedCallouts = buildSummaryAnomalyCallouts({
      query: {
        ...multiMetricDateQuery,
        groupingMode: 'overall',
      },
      matchedEventCount: 20,
      buckets: [
        { bucketKey: '2026-01', aggregateValue: 100, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-02', aggregateValue: 220, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-03', aggregateValue: 99, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-04', aggregateValue: 98, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-05', aggregateValue: 102, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
        { bucketKey: '2026-06', aggregateValue: 90, totalCount: 5, seriesCounts: { [ActivityTypes.Cycling]: 5 } },
      ],
    });

    expect(dateGroupedCallouts?.length).toBeGreaterThan(0);
    expect(overallGroupedCallouts).toBeNull();
  });
});
