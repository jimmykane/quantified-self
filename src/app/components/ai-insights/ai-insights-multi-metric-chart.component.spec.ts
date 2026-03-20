import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataCadenceAvg,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type { AiInsightsMultiMetricAggregateOkResponse } from '@shared/ai-insights.types';
import { AiInsightsMultiMetricChartComponent } from './ai-insights-multi-metric-chart.component';

function buildResponseWithThreeUniqueMetrics(): AiInsightsMultiMetricAggregateOkResponse {
  return {
    status: 'ok',
    resultKind: 'multi_metric_aggregate',
    narrative: 'Cadence, power, and heart rate trends.',
    query: {
      resultKind: 'multi_metric_aggregate',
      groupingMode: 'date',
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
      dateRange: {
        kind: 'bounded',
        startDate: '2025-12-01',
        endDate: '2026-03-01',
        timezone: 'Europe/Helsinki',
        source: 'prompt',
      },
      chartType: ChartTypes.LinesVertical,
      metricSelections: [
        { metricKey: 'cadence', dataType: DataCadenceAvg.type, valueType: ChartDataValueTypes.Average },
        { metricKey: 'power', dataType: 'Average Power', valueType: ChartDataValueTypes.Average },
        { metricKey: 'heart_rate', dataType: 'Heart Rate', valueType: ChartDataValueTypes.Average },
      ],
    },
    metricResults: [
      {
        metricKey: 'cadence',
        metricLabel: 'Average cadence',
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
            startDate: '2025-12-01',
            endDate: '2026-03-01',
            timezone: 'Europe/Helsinki',
            source: 'prompt',
          },
          chartType: ChartTypes.LinesVertical,
        },
        aggregation: {
          dataType: DataCadenceAvg.type,
          valueType: ChartDataValueTypes.Average,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [
            { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), totalCount: 1, aggregateValue: 86, seriesValues: { Cycling: 86 }, seriesCounts: { Cycling: 1 } },
          ],
        },
        summary: {
          matchedEventCount: 1,
          overallAggregateValue: 86,
          peakBucket: { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), aggregateValue: 86, totalCount: 1 },
          lowestBucket: { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), aggregateValue: 86, totalCount: 1 },
          latestBucket: { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), aggregateValue: 86, totalCount: 1 },
          activityMix: null,
          bucketCoverage: { nonEmptyBucketCount: 1, totalBucketCount: 1 },
          trend: null,
        },
        presentation: { title: 'Average cadence', chartType: ChartTypes.LinesVertical },
      },
      {
        metricKey: 'power',
        metricLabel: 'Average power',
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
            startDate: '2025-12-01',
            endDate: '2026-03-01',
            timezone: 'Europe/Helsinki',
            source: 'prompt',
          },
          chartType: ChartTypes.LinesVertical,
        },
        aggregation: {
          dataType: 'Average Power',
          valueType: ChartDataValueTypes.Average,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [
            { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), totalCount: 1, aggregateValue: 210, seriesValues: { Cycling: 210 }, seriesCounts: { Cycling: 1 } },
          ],
        },
        summary: {
          matchedEventCount: 1,
          overallAggregateValue: 210,
          peakBucket: { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), aggregateValue: 210, totalCount: 1 },
          lowestBucket: { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), aggregateValue: 210, totalCount: 1 },
          latestBucket: { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), aggregateValue: 210, totalCount: 1 },
          activityMix: null,
          bucketCoverage: { nonEmptyBucketCount: 1, totalBucketCount: 1 },
          trend: null,
        },
        presentation: { title: 'Average power', chartType: ChartTypes.LinesVertical },
      },
      {
        metricKey: 'heart_rate',
        metricLabel: 'Average heart rate',
        query: {
          resultKind: 'aggregate',
          dataType: 'Heart Rate',
          valueType: ChartDataValueTypes.Average,
          categoryType: ChartDataCategoryTypes.DateType,
          requestedTimeInterval: TimeIntervals.Monthly,
          activityTypeGroups: [],
          activityTypes: [ActivityTypes.Cycling],
          dateRange: {
            kind: 'bounded',
            startDate: '2025-12-01',
            endDate: '2026-03-01',
            timezone: 'Europe/Helsinki',
            source: 'prompt',
          },
          chartType: ChartTypes.LinesVertical,
        },
        aggregation: {
          dataType: 'Heart Rate',
          valueType: ChartDataValueTypes.Average,
          categoryType: ChartDataCategoryTypes.DateType,
          resolvedTimeInterval: TimeIntervals.Monthly,
          buckets: [
            { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), totalCount: 1, aggregateValue: 148, seriesValues: { Cycling: 148 }, seriesCounts: { Cycling: 1 } },
          ],
        },
        summary: {
          matchedEventCount: 1,
          overallAggregateValue: 148,
          peakBucket: { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), aggregateValue: 148, totalCount: 1 },
          lowestBucket: { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), aggregateValue: 148, totalCount: 1 },
          latestBucket: { bucketKey: '2026-01', time: Date.UTC(2026, 0, 1), aggregateValue: 148, totalCount: 1 },
          activityMix: null,
          bucketCoverage: { nonEmptyBucketCount: 1, totalBucketCount: 1 },
          trend: null,
        },
        presentation: { title: 'Average heart rate', chartType: ChartTypes.LinesVertical },
      },
    ],
    presentation: {
      title: 'Cadence, power, and heart rate over time',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

describe('AiInsightsMultiMetricChartComponent', () => {
  let fixture: ComponentFixture<AiInsightsMultiMetricChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AiInsightsMultiMetricChartComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AiInsightsMultiMetricChartComponent);
    fixture.componentRef.setInput('response', buildResponseWithThreeUniqueMetrics());
    fixture.componentRef.setInput('darkTheme', false);
    fixture.componentRef.setInput('useAnimations', false);
    fixture.componentRef.setInput('userUnitSettings', null);
    fixture.detectChanges();
  });

  it('assigns distinct axis indices for three unique metric units', () => {
    const series = (fixture.componentInstance as any).buildSeries().series as Array<{ axisIndex: number }>;
    expect(series.map(entry => entry.axisIndex)).toEqual([0, 1, 2]);
  });

  it('applies offset for the third axis to avoid right-side overlap', () => {
    const offset = (fixture.componentInstance as any).resolveAxisOffset(2) as number;
    expect(offset).toBeGreaterThan(0);
  });

  it('aligns axis names and tick labels consistently by axis side', () => {
    const leftAlign = (fixture.componentInstance as any).resolveAxisLabelAlign(0) as string;
    const rightAlign = (fixture.componentInstance as any).resolveAxisLabelAlign(1) as string;
    const leftPadding = (fixture.componentInstance as any).resolveAxisTextPadding(0) as [number, number, number, number];
    const rightPadding = (fixture.componentInstance as any).resolveAxisTextPadding(1) as [number, number, number, number];

    expect(leftAlign).toBe('right');
    expect(rightAlign).toBe('left');
    expect(leftPadding).toEqual([0, 8, 0, 0]);
    expect(rightPadding).toEqual([0, 0, 0, 8]);
  });

  it('keeps series labels short by dropping aggregation prefixes', () => {
    const series = (fixture.componentInstance as any).buildSeries().series as Array<{ metricLabel: string }>;
    expect(series.map(entry => entry.metricLabel)).toEqual(['cadence', 'power', 'heart rate']);
  });
});
