import { CommonModule } from '@angular/common';
import { Component, LOCALE_ID, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
  AppThemes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataCadenceAvg,
  DataDistance,
  DataPaceAvg,
  DataStartPosition,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightsLatestSnapshot,
  AiInsightsAggregateOkResponse,
  AiInsightsEmptyResponse,
  AiInsightsEventLookupOkResponse,
  AiInsightsLatestEventOkResponse,
  AiInsightsMultiMetricAggregateOkResponse,
  AiInsightsOkResponse,
  AiInsightsPowerCurveOkResponse,
  AiInsightsQuotaStatus,
  AiInsightsResponse,
  AiInsightsUnsupportedResponse,
} from '@shared/ai-insights.types';
import { AI_INSIGHTS_REQUEST_LIMITS } from '@shared/limits';
import { formatUnitAwareDataValue, normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AiInsightsLatestSnapshotService } from '../../services/ai-insights-latest-snapshot.service';
import { AiInsightsQuotaService } from '../../services/ai-insights-quota.service';
import { AiInsightsService } from '../../services/ai-insights.service';
import { AppEventService } from '../../services/app.event.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { LoggerService } from '../../services/logger.service';
import { AiInsightsChartComponent } from './ai-insights-chart.component';
import { AiInsightsMultiMetricChartComponent } from './ai-insights-multi-metric-chart.component';
import { AiInsightsPowerCurveChartComponent } from './ai-insights-power-curve-chart.component';
import { AiInsightsPageComponent } from './ai-insights-page.component';
import { formatAiInsightsNarrativeForDisplay } from './ai-insights-page.helpers';
import { EventsMapComponent } from '../events-map/events-map.component';
import {
  AI_INSIGHTS_DEFAULT_PICKER_PROMPTS,
  AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS,
  AI_INSIGHTS_FEATURED_PROMPTS,
} from './ai-insights.prompts';

@Component({
  selector: 'app-ai-insights-chart',
  standalone: true,
  imports: [CommonModule],
  template: '<div class="chart-stub">{{ response().presentation.title }}</div>',
})
class MockAiInsightsChartComponent {
  readonly response = input.required<AiInsightsOkResponse>();
  readonly darkTheme = input(false);
  readonly useAnimations = input(false);
  readonly userUnitSettings = input<any>(null);
}

@Component({
  selector: 'app-ai-insights-multi-metric-chart',
  standalone: true,
  imports: [CommonModule],
  template: '<div class="multi-chart-stub">{{ response().presentation.title }}</div>',
})
class MockAiInsightsMultiMetricChartComponent {
  readonly response = input.required<AiInsightsMultiMetricAggregateOkResponse>();
  readonly darkTheme = input(false);
  readonly useAnimations = input(false);
  readonly userUnitSettings = input<any>(null);
}

@Component({
  selector: 'app-ai-insights-power-curve-chart',
  standalone: true,
  imports: [CommonModule],
  template: '<div class="power-curve-chart-stub">{{ response().presentation.title }}</div>',
})
class MockAiInsightsPowerCurveChartComponent {
  readonly response = input.required<AiInsightsPowerCurveOkResponse>();
  readonly darkTheme = input(false);
  readonly useAnimations = input(false);
}

@Component({
  selector: 'app-events-map',
  standalone: true,
  imports: [CommonModule],
  template: '<div class="events-map-stub">{{ events().length }}</div>',
})
class MockEventsMapComponent {
  readonly events = input<any[]>([]);
  readonly user = input<any>(undefined);
  readonly clusterMarkers = input(true);
}

describe('formatAiInsightsNarrativeForDisplay', () => {
  it('returns a trimmed narrative without marker parsing', () => {
    expect(
      formatAiInsightsNarrativeForDisplay('  Base narrative. Deterministic compare summary: From 2025 to 2026, distance increased by 10 km.  '),
    ).toBe('Base narrative. Deterministic compare summary: From 2025 to 2026, distance increased by 10 km.');
  });
});

function buildQuotaStatus(overrides: Partial<AiInsightsQuotaStatus> = {}): AiInsightsQuotaStatus {
  return {
    role: 'pro',
    limit: AI_INSIGHTS_REQUEST_LIMITS.pro,
    successfulRequestCount: 12,
    activeRequestCount: 0,
    remainingCount: AI_INSIGHTS_REQUEST_LIMITS.pro - 12,
    periodStart: '2026-03-01T00:00:00.000Z',
    periodEnd: '2026-04-01T00:00:00.000Z',
    periodKind: 'subscription',
    resetMode: 'date',
    isEligible: true,
    blockedReason: null,
    ...overrides,
  };
}

function buildOkResponse(): AiInsightsAggregateOkResponse {
  return {
    status: 'ok',
    resultKind: 'aggregate',
    narrative: 'Your average cadence has trended up over the last three months.',
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
        {
          bucketKey: '2026-01',
          time: Date.UTC(2026, 0, 1),
          totalCount: 4,
          aggregateValue: 86,
          seriesValues: { Cycling: 86 },
          seriesCounts: { Cycling: 4 },
        },
      ],
    },
    summary: {
      matchedEventCount: 4,
      overallAggregateValue: 86,
      peakBucket: {
        bucketKey: '2026-01',
        time: Date.UTC(2026, 0, 1),
        aggregateValue: 86,
        totalCount: 4,
      },
      lowestBucket: {
        bucketKey: '2025-12',
        time: Date.UTC(2025, 11, 1),
        aggregateValue: 79,
        totalCount: 2,
      },
      latestBucket: {
        bucketKey: '2026-01',
        time: Date.UTC(2026, 0, 1),
        aggregateValue: 86,
        totalCount: 4,
      },
      activityMix: {
        topActivityTypes: [
          { activityType: ActivityTypes.Cycling, eventCount: 4 },
        ],
        remainingActivityTypeCount: 0,
      },
      bucketCoverage: {
        nonEmptyBucketCount: 1,
        totalBucketCount: 4,
      },
      trend: {
        previousBucket: {
          bucketKey: '2025-12',
          time: Date.UTC(2025, 11, 1),
          aggregateValue: 79,
          totalCount: 2,
        },
        deltaAggregateValue: 7,
      },
    },
    presentation: {
      title: 'Average cadence over time for Cycling',
      chartType: ChartTypes.LinesVertical,
      warnings: ['Single activity type selected'],
    },
  };
}

function buildLocationScopedResponse(): AiInsightsAggregateOkResponse {
  return {
    ...buildOkResponse(),
    query: {
      ...buildOkResponse().query,
      locationFilter: {
        requestedText: 'Greece',
        effectiveText: 'Greece',
        resolvedLabel: 'Greece',
        source: 'input',
        mode: 'bbox',
        radiusKm: 50,
        center: {
          latitudeDegrees: 39.0742,
          longitudeDegrees: 21.8243,
        },
        bbox: {
          west: 19.3736,
          south: 34.8021,
          east: 28.2471,
          north: 41.7485,
        },
      },
    },
  };
}

function buildAggregateMaxBySportResponse(): AiInsightsAggregateOkResponse {
  return {
    ...buildOkResponse(),
    narrative: 'Cycling had the highest max distance overall, and I ranked the top matching events across all matched sports.',
    query: {
      ...buildOkResponse().query,
      valueType: ChartDataValueTypes.Maximum,
      categoryType: ChartDataCategoryTypes.ActivityType,
      activityTypes: [ActivityTypes.Cycling, ActivityTypes.Running],
      chartType: ChartTypes.ColumnsHorizontal,
    },
    aggregation: {
      ...buildOkResponse().aggregation,
      valueType: ChartDataValueTypes.Maximum,
      categoryType: ChartDataCategoryTypes.ActivityType,
      resolvedTimeInterval: TimeIntervals.Auto,
      buckets: [
        {
          bucketKey: ActivityTypes.Cycling,
          totalCount: 2,
          aggregateValue: 123400,
          seriesValues: { Cycling: 123400 },
          seriesCounts: { Cycling: 2 },
        },
        {
          bucketKey: ActivityTypes.Running,
          totalCount: 1,
          aggregateValue: 18700,
          seriesValues: { Running: 18700 },
          seriesCounts: { Running: 1 },
        },
      ],
    },
    summary: {
      ...buildOkResponse().summary,
      matchedEventCount: 3,
      overallAggregateValue: 123400,
      peakBucket: {
        bucketKey: ActivityTypes.Cycling,
        aggregateValue: 123400,
        totalCount: 2,
      },
      lowestBucket: {
        bucketKey: ActivityTypes.Running,
        aggregateValue: 18700,
        totalCount: 1,
      },
      latestBucket: null,
      bucketCoverage: null,
      trend: null,
      activityMix: {
        topActivityTypes: [
          { activityType: ActivityTypes.Cycling, eventCount: 2 },
          { activityType: ActivityTypes.Running, eventCount: 1 },
        ],
        remainingActivityTypeCount: 0,
      },
    },
    eventRanking: {
      primaryEventId: 'event-3',
      topEventIds: ['event-3', 'event-2', 'event-1'],
      matchedEventCount: 3,
    },
    presentation: {
      title: 'Maximum distance by activity type',
      chartType: ChartTypes.ColumnsHorizontal,
    },
  };
}

function buildEmptyResponse(): AiInsightsEmptyResponse {
  return {
    status: 'empty',
    narrative: 'I could not find matching events with cadence data in that range.',
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
      title: 'Average cadence over time for Cycling',
      chartType: ChartTypes.LinesVertical,
      emptyState: 'No matching events were found for this insight in the requested range.',
    },
  };
}

function buildMultiMetricResponse(): AiInsightsMultiMetricAggregateOkResponse {
  return {
    status: 'ok',
    resultKind: 'multi_metric_aggregate',
    narrative: 'Cadence and power both trended upward over the last three months.',
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
        {
          metricKey: 'cadence',
          dataType: DataCadenceAvg.type,
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
        metricLabel: 'cadence',
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
            {
              bucketKey: '2026-01',
              time: Date.UTC(2026, 0, 1),
              totalCount: 4,
              aggregateValue: 86,
              seriesValues: { Cycling: 86 },
              seriesCounts: { Cycling: 4 },
            },
          ],
        },
        summary: {
          matchedEventCount: 4,
          overallAggregateValue: 86,
          peakBucket: {
            bucketKey: '2026-01',
            time: Date.UTC(2026, 0, 1),
            aggregateValue: 86,
            totalCount: 4,
          },
          lowestBucket: {
            bucketKey: '2026-01',
            time: Date.UTC(2026, 0, 1),
            aggregateValue: 86,
            totalCount: 4,
          },
          latestBucket: {
            bucketKey: '2026-01',
            time: Date.UTC(2026, 0, 1),
            aggregateValue: 86,
            totalCount: 4,
          },
          activityMix: null,
          bucketCoverage: {
            nonEmptyBucketCount: 1,
            totalBucketCount: 4,
          },
          trend: null,
        },
        presentation: {
          title: 'Average cadence over time for Cycling',
          chartType: ChartTypes.LinesVertical,
        },
      },
      {
        metricKey: 'power',
        metricLabel: 'power',
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
            {
              bucketKey: '2026-01',
              time: Date.UTC(2026, 0, 1),
              totalCount: 4,
              aggregateValue: 210,
              seriesValues: { Cycling: 210 },
              seriesCounts: { Cycling: 4 },
            },
          ],
        },
        summary: {
          matchedEventCount: 4,
          overallAggregateValue: 210,
          peakBucket: {
            bucketKey: '2026-01',
            time: Date.UTC(2026, 0, 1),
            aggregateValue: 210,
            totalCount: 4,
          },
          lowestBucket: {
            bucketKey: '2026-01',
            time: Date.UTC(2026, 0, 1),
            aggregateValue: 210,
            totalCount: 4,
          },
          latestBucket: {
            bucketKey: '2026-01',
            time: Date.UTC(2026, 0, 1),
            aggregateValue: 210,
            totalCount: 4,
          },
          activityMix: null,
          bucketCoverage: {
            nonEmptyBucketCount: 1,
            totalBucketCount: 4,
          },
          trend: null,
        },
        presentation: {
          title: 'Average power over time for Cycling',
          chartType: ChartTypes.LinesVertical,
        },
      },
    ],
    presentation: {
      title: 'Cadence and power over time for Cycling',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

function buildMultiMetricDigestResponse(): AiInsightsMultiMetricAggregateOkResponse {
  const baseResponse = buildMultiMetricResponse();
  return {
    ...baseResponse,
    narrative: 'Weekly digest with 2 active weeks and 1 no-data week.',
    query: {
      ...baseResponse.query,
      requestedTimeInterval: TimeIntervals.Weekly,
      digestMode: 'weekly',
    },
    digest: {
      granularity: 'weekly',
      periodCount: 3,
      nonEmptyPeriodCount: 2,
      periods: [
        {
          bucketKey: '2026-W09',
          time: Date.UTC(2026, 1, 23),
          hasData: true,
          metrics: [
            {
              metricKey: 'distance',
              metricLabel: 'Distance',
              dataType: DataDistance.type,
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
            {
              metricKey: 'ascent',
              metricLabel: 'Ascent',
              dataType: 'Ascent',
              valueType: ChartDataValueTypes.Total,
              aggregateValue: 900,
              totalCount: 3,
            },
          ],
        },
        {
          bucketKey: '2026-W10',
          time: Date.UTC(2026, 2, 2),
          hasData: false,
          metrics: [
            {
              metricKey: 'distance',
              metricLabel: 'Distance',
              dataType: DataDistance.type,
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
            {
              metricKey: 'ascent',
              metricLabel: 'Ascent',
              dataType: 'Ascent',
              valueType: ChartDataValueTypes.Total,
              aggregateValue: null,
              totalCount: 0,
            },
          ],
        },
        {
          bucketKey: '2026-W11',
          time: Date.UTC(2026, 2, 9),
          hasData: true,
          metrics: [
            {
              metricKey: 'distance',
              metricLabel: 'Distance',
              dataType: DataDistance.type,
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
            {
              metricKey: 'ascent',
              metricLabel: 'Ascent',
              dataType: 'Ascent',
              valueType: ChartDataValueTypes.Total,
              aggregateValue: 620,
              totalCount: 2,
            },
          ],
        },
      ],
    },
  };
}

function buildYearlyDigestResponse(): AiInsightsMultiMetricAggregateOkResponse {
  const baseResponse = buildMultiMetricDigestResponse();
  return {
    ...baseResponse,
    narrative: 'Yearly digest with one active year and two no-data years.',
    query: {
      ...baseResponse.query,
      requestedTimeInterval: TimeIntervals.Yearly,
      digestMode: 'yearly',
      dateRange: {
        kind: 'bounded',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2026-12-31T23:59:59.999Z',
        timezone: 'UTC',
        source: 'prompt',
      },
    },
    digest: {
      granularity: 'yearly',
      periodCount: 3,
      nonEmptyPeriodCount: 1,
      periods: [
        {
          bucketKey: '2024',
          time: Date.UTC(2024, 0, 1),
          hasData: false,
          metrics: [
            {
              metricKey: 'distance',
              metricLabel: 'Distance',
              dataType: DataDistance.type,
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
            {
              metricKey: 'ascent',
              metricLabel: 'Ascent',
              dataType: 'Ascent',
              valueType: ChartDataValueTypes.Total,
              aggregateValue: null,
              totalCount: 0,
            },
          ],
        },
        {
          bucketKey: '2025',
          time: Date.UTC(2025, 0, 1),
          hasData: true,
          metrics: [
            {
              metricKey: 'distance',
              metricLabel: 'Distance',
              dataType: DataDistance.type,
              valueType: ChartDataValueTypes.Total,
              aggregateValue: 126000,
              totalCount: 8,
            },
            {
              metricKey: 'duration',
              metricLabel: 'Duration',
              dataType: 'Duration',
              valueType: ChartDataValueTypes.Total,
              aggregateValue: 41000,
              totalCount: 8,
            },
            {
              metricKey: 'ascent',
              metricLabel: 'Ascent',
              dataType: 'Ascent',
              valueType: ChartDataValueTypes.Total,
              aggregateValue: 2800,
              totalCount: 8,
            },
          ],
        },
        {
          bucketKey: '2026',
          time: Date.UTC(2026, 0, 1),
          hasData: false,
          metrics: [
            {
              metricKey: 'distance',
              metricLabel: 'Distance',
              dataType: DataDistance.type,
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
            {
              metricKey: 'ascent',
              metricLabel: 'Ascent',
              dataType: 'Ascent',
              valueType: ChartDataValueTypes.Total,
              aggregateValue: null,
              totalCount: 0,
            },
          ],
        },
      ],
    },
  };
}

function buildEmptyDigestResponse(): AiInsightsEmptyResponse {
  const baseResponse = buildEmptyResponse();
  const digestQuery = buildMultiMetricDigestResponse().query;
  return {
    ...baseResponse,
    query: digestQuery,
    digest: {
      granularity: 'weekly',
      periodCount: 2,
      nonEmptyPeriodCount: 0,
      periods: [
        {
          bucketKey: '2026-W09',
          time: Date.UTC(2026, 1, 23),
          hasData: false,
          metrics: [
            {
              metricKey: 'distance',
              metricLabel: 'Distance',
              dataType: DataDistance.type,
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
            {
              metricKey: 'ascent',
              metricLabel: 'Ascent',
              dataType: 'Ascent',
              valueType: ChartDataValueTypes.Total,
              aggregateValue: null,
              totalCount: 0,
            },
          ],
        },
        {
          bucketKey: '2026-W10',
          time: Date.UTC(2026, 2, 2),
          hasData: false,
          metrics: [
            {
              metricKey: 'distance',
              metricLabel: 'Distance',
              dataType: DataDistance.type,
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
            {
              metricKey: 'ascent',
              metricLabel: 'Ascent',
              dataType: 'Ascent',
              valueType: ChartDataValueTypes.Total,
              aggregateValue: null,
              totalCount: 0,
            },
          ],
        },
      ],
    },
  };
}

function buildEmptyDigestWithoutPeriodsResponse(): AiInsightsEmptyResponse {
  const baseResponse = buildEmptyResponse();
  return {
    ...baseResponse,
    query: {
      ...buildYearlyDigestResponse().query,
      dateRange: {
        kind: 'all_time',
        timezone: 'UTC',
        source: 'prompt',
      },
    },
    digest: {
      granularity: 'yearly',
      periodCount: 0,
      nonEmptyPeriodCount: 0,
      periods: [],
    },
  };
}

function buildPaceResponse(): AiInsightsAggregateOkResponse {
  return {
    status: 'ok',
    resultKind: 'aggregate',
    narrative: 'Your average running pace improved over the last two years.',
    query: {
      resultKind: 'aggregate',
      dataType: DataPaceAvg.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Running],
      dateRange: {
        kind: 'bounded',
        startDate: '2024-03-17T00:00:00.000Z',
        endDate: '2026-03-18T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'prompt',
      },
      chartType: ChartTypes.LinesVertical,
    },
    aggregation: {
      dataType: DataPaceAvg.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        {
          bucketKey: '2024-01',
          time: Date.UTC(2024, 0, 1),
          totalCount: 10,
          aggregateValue: 630,
          seriesValues: { Running: 630 },
          seriesCounts: { Running: 10 },
        },
        {
          bucketKey: '2025-01',
          time: Date.UTC(2025, 0, 1),
          totalCount: 8,
          aggregateValue: 473,
          seriesValues: { Running: 473 },
          seriesCounts: { Running: 8 },
        },
      ],
    },
    summary: {
      matchedEventCount: 18,
      overallAggregateValue: 552,
      peakBucket: {
        bucketKey: '2024-01',
        time: Date.UTC(2024, 0, 1),
        aggregateValue: 630,
        totalCount: 10,
      },
      lowestBucket: {
        bucketKey: '2025-01',
        time: Date.UTC(2025, 0, 1),
        aggregateValue: 473,
        totalCount: 8,
      },
      latestBucket: {
        bucketKey: '2025-01',
        time: Date.UTC(2025, 0, 1),
        aggregateValue: 473,
        totalCount: 8,
      },
      activityMix: {
        topActivityTypes: [
          { activityType: ActivityTypes.Running, eventCount: 18 },
        ],
        remainingActivityTypeCount: 0,
      },
      bucketCoverage: {
        nonEmptyBucketCount: 2,
        totalBucketCount: 25,
      },
      trend: {
        previousBucket: {
          bucketKey: '2024-01',
          time: Date.UTC(2024, 0, 1),
          aggregateValue: 630,
          totalCount: 10,
        },
        deltaAggregateValue: -157,
      },
    },
    presentation: {
      title: 'Average pace over time for Running',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

function buildDefaultedRangeResponse(): AiInsightsOkResponse {
  return {
    ...buildOkResponse(),
    query: {
      ...buildOkResponse().query,
      dateRange: {
        kind: 'bounded',
        startDate: '2025-12-31T22:00:00.000Z',
        endDate: '2026-03-18T21:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'default',
      },
    },
  };
}

function buildPacificRangeResponse(): AiInsightsOkResponse {
  return {
    ...buildOkResponse(),
    query: {
      ...buildOkResponse().query,
      dateRange: {
        kind: 'bounded',
        startDate: '2025-12-19T08:00:00.000Z',
        endDate: '2026-03-19T06:59:59.999Z',
        timezone: 'America/Los_Angeles',
        source: 'prompt',
      },
    },
  };
}

function buildAllTimeResponse(): AiInsightsOkResponse {
  return {
    ...buildOkResponse(),
    query: {
      ...buildOkResponse().query,
      dateRange: {
        kind: 'all_time',
        timezone: 'Europe/Helsinki',
        source: 'prompt',
      },
    },
    presentation: {
      ...buildOkResponse().presentation,
      title: 'Total distance over time for All activities',
    },
  };
}

function buildUnsupportedResponse(): AiInsightsUnsupportedResponse {
  return {
    status: 'unsupported',
    narrative: 'Streams and splits are out of scope right now.',
    reasonCode: 'unsupported_capability',
    suggestedPrompts: [
      'Show my total distance by activity type this year.',
      'Tell me my average cadence for cycling over the last 3 months.',
    ],
  };
}

function buildGroupResponse(): AiInsightsAggregateOkResponse {
  return {
    status: 'ok',
    resultKind: 'aggregate',
    narrative: 'Your average pace across water sports has improved.',
    query: {
      resultKind: 'aggregate',
      dataType: DataPaceAvg.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Monthly,
      activityTypeGroups: [ActivityTypeGroups.WaterSportsGroup],
      activityTypes: [ActivityTypes.Rowing, ActivityTypes.Kayaking, ActivityTypes.Sailing, ActivityTypes.Surfing],
      dateRange: {
        kind: 'bounded',
        startDate: '2025-09-17T00:00:00.000Z',
        endDate: '2026-03-18T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'prompt',
      },
      chartType: ChartTypes.LinesVertical,
    },
    aggregation: {
      dataType: DataPaceAvg.type,
      valueType: ChartDataValueTypes.Average,
      categoryType: ChartDataCategoryTypes.DateType,
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [],
    },
    summary: {
      matchedEventCount: 12,
      overallAggregateValue: 520,
      peakBucket: null,
      lowestBucket: null,
      latestBucket: null,
      activityMix: {
        topActivityTypes: [
          { activityType: ActivityTypes.Rowing, eventCount: 5 },
          { activityType: ActivityTypes.Surfing, eventCount: 4 },
          { activityType: ActivityTypes.Kitesurfing, eventCount: 2 },
        ],
        remainingActivityTypeCount: 1,
      },
      bucketCoverage: null,
      trend: null,
    },
    presentation: {
      title: 'Average pace over time for Water Sports',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

function buildActivityTypeComparisonResponse(): AiInsightsAggregateOkResponse {
  return {
    status: 'ok',
    resultKind: 'aggregate',
    narrative: 'Cycling carried the most activity volume, while Diving and Yoga both sat at zero distance.',
    query: {
      resultKind: 'aggregate',
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.ActivityType,
      requestedTimeInterval: null,
      activityTypeGroups: [],
      activityTypes: [],
      dateRange: {
        kind: 'bounded',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-18T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'prompt',
      },
      chartType: ChartTypes.ColumnsHorizontal,
    },
    aggregation: {
      dataType: DataDistance.type,
      valueType: ChartDataValueTypes.Total,
      categoryType: ChartDataCategoryTypes.ActivityType,
      resolvedTimeInterval: TimeIntervals.Monthly,
      buckets: [
        {
          bucketKey: ActivityTypes.Diving,
          totalCount: 2,
          aggregateValue: 0,
          seriesValues: { [ActivityTypes.Diving]: 0 },
          seriesCounts: { [ActivityTypes.Diving]: 2 },
        },
        {
          bucketKey: ActivityTypes.Yoga,
          totalCount: 3,
          aggregateValue: 0,
          seriesValues: { [ActivityTypes.Yoga]: 0 },
          seriesCounts: { [ActivityTypes.Yoga]: 3 },
        },
        {
          bucketKey: ActivityTypes.Cycling,
          totalCount: 5,
          aggregateValue: 24500,
          seriesValues: { [ActivityTypes.Cycling]: 24500 },
          seriesCounts: { [ActivityTypes.Cycling]: 5 },
        },
      ],
    },
    summary: {
      matchedEventCount: 10,
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
      activityMix: {
        topActivityTypes: [
          { activityType: ActivityTypes.Cycling, eventCount: 5 },
          { activityType: ActivityTypes.Yoga, eventCount: 3 },
          { activityType: ActivityTypes.Diving, eventCount: 2 },
        ],
        remainingActivityTypeCount: 0,
      },
      bucketCoverage: null,
      trend: null,
    },
    presentation: {
      title: 'Total distance by activity type',
      chartType: ChartTypes.ColumnsHorizontal,
    },
  };
}

function buildDailyResponse(): AiInsightsOkResponse {
  return {
    ...buildOkResponse(),
    query: {
      ...buildOkResponse().query,
      requestedTimeInterval: TimeIntervals.Daily,
      dateRange: {
        kind: 'bounded',
        startDate: '2026-03-01T00:00:00.000Z',
        endDate: '2026-03-18T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'prompt',
      },
    },
    aggregation: {
      ...buildOkResponse().aggregation,
      resolvedTimeInterval: TimeIntervals.Daily,
      buckets: [
        {
          bucketKey: '2026-03-02',
          time: Date.UTC(2026, 2, 2),
          totalCount: 2,
          aggregateValue: 84,
          seriesValues: { Cycling: 84 },
          seriesCounts: { Cycling: 2 },
        },
      ],
    },
    summary: {
      ...buildOkResponse().summary,
      peakBucket: {
        bucketKey: '2026-03-02',
        time: Date.UTC(2026, 2, 2),
        aggregateValue: 84,
        totalCount: 2,
      },
      lowestBucket: {
        bucketKey: '2026-03-02',
        time: Date.UTC(2026, 2, 2),
        aggregateValue: 84,
        totalCount: 2,
      },
      latestBucket: {
        bucketKey: '2026-03-02',
        time: Date.UTC(2026, 2, 2),
        aggregateValue: 84,
        totalCount: 2,
      },
      trend: {
        previousBucket: {
          bucketKey: '2026-03-01',
          time: Date.UTC(2026, 2, 1),
          aggregateValue: 81,
          totalCount: 1,
        },
        deltaAggregateValue: 3,
      },
    },
  };
}

function buildEventLookupResponse(): AiInsightsEventLookupOkResponse {
  return {
    status: 'ok',
    resultKind: 'event_lookup',
    narrative: 'Your longest distance event for Cycling was 123.4 km on Mar 10, 2026. I ranked 3 matching events.',
    query: {
      resultKind: 'event_lookup',
      dataType: DataDistance.type,
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
    },
    eventLookup: {
      primaryEventId: 'event-3',
      topEventIds: ['event-3', 'event-2', 'event-1'],
      matchedEventCount: 3,
    },
    presentation: {
      title: 'Top distance events for Cycling',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

function buildLatestEventResponse(): AiInsightsLatestEventOkResponse {
  return {
    status: 'ok',
    resultKind: 'latest_event',
    narrative: 'Your latest cycling event was on Mar 18, 2026. I matched 4 events.',
    query: {
      resultKind: 'latest_event',
      categoryType: ChartDataCategoryTypes.DateType,
      requestedTimeInterval: TimeIntervals.Daily,
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
    },
    latestEvent: {
      eventId: 'event-9',
      startDate: '2026-03-18T08:00:00.000Z',
      matchedEventCount: 4,
    },
    presentation: {
      title: 'Latest event for Cycling',
      chartType: ChartTypes.LinesVertical,
    },
  };
}

function buildPowerCurveResponse(): AiInsightsPowerCurveOkResponse {
  return {
    status: 'ok',
    resultKind: 'power_curve',
    narrative: 'I built your best power curve for cycling as the max-power envelope across 4 matching events.',
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
        endDate: '2026-03-18T23:59:59.999Z',
        timezone: 'Europe/Helsinki',
        source: 'default',
      },
      chartType: ChartTypes.LinesVertical,
      defaultedToCycling: true,
    },
    powerCurve: {
      mode: 'best',
      resolvedTimeInterval: TimeIntervals.Auto,
      matchedEventCount: 4,
      requestedSeriesCount: 1,
      returnedSeriesCount: 1,
      safetyGuardApplied: false,
      safetyGuardMaxSeries: null,
      trimmedSeriesCount: 0,
      series: [
        {
          seriesKey: 'best',
          label: 'Best power curve',
          matchedEventCount: 4,
          bucketStartDate: null,
          bucketEndDate: null,
          points: [
            { duration: 5, power: 640, wattsPerKg: 8.9 },
            { duration: 60, power: 420, wattsPerKg: 5.7 },
          ],
        },
      ],
    },
    presentation: {
      title: 'Best power curve for Cycling',
      chartType: ChartTypes.LinesVertical,
      warnings: [
        'No activity filter was specified, so this power-curve result defaults to Cycling.',
      ],
    },
  };
}

function buildMockEvent(options: {
  id: string;
  startDate: string;
  activityTypes: ActivityTypes[];
  stats: Record<string, unknown>;
}) {
  return {
    startDate: new Date(options.startDate),
    getID: () => options.id,
    getStat: (dataType: string) => ({
      getValue: () => options.stats[dataType] ?? null,
    }),
    getActivityTypesAsArray: () => options.activityTypes,
  };
}

describe('AiInsightsPageComponent', () => {
  const authUserSubject = new BehaviorSubject<any>({ uid: 'user-1' });
  const authServiceMock = {
    user$: authUserSubject.asObservable(),
  };
  const aiInsightsServiceMock = {
    runInsight: vi.fn<() => Promise<AiInsightsResponse>>(),
    getErrorMessage: vi.fn((error: unknown) => error instanceof Error ? error.message : 'Could not generate AI insights.'),
  };
  const aiInsightsLatestSnapshotServiceMock = {
    loadLatest: vi.fn<() => Promise<AiInsightsLatestSnapshot | null>>(),
  };
  const aiInsightsQuotaServiceMock = {
    loadQuotaStatus: vi.fn<() => Promise<AiInsightsQuotaStatus | null>>(),
  };
  const appEventServiceMock = {
    getEventsOnceByIds: vi.fn(() => of([])),
  };
  const themeServiceMock = {
    appTheme: signal(AppThemes.Normal),
  };
  const matDialogMock = {
    open: vi.fn(() => ({
      afterClosed: () => of(undefined),
    })),
  };
  const analyticsServiceMock = {
    logEvent: vi.fn(),
  };
  const hapticsServiceMock = {
    selection: vi.fn(),
    success: vi.fn(),
  };
  const userSettingsQueryServiceMock = {
    chartSettings: signal({ useAnimations: true }),
    unitSettings: signal(normalizeUserUnitSettings({})),
  };
  const loggerServiceMock = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };

  let fixture: ComponentFixture<AiInsightsPageComponent>;
  let component: AiInsightsPageComponent;

  async function createComponent(locale = 'en-US'): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [
        AiInsightsPageComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
      ],
      providers: [
        { provide: LOCALE_ID, useValue: locale },
        { provide: AppAuthService, useValue: authServiceMock },
        { provide: AppAnalyticsService, useValue: analyticsServiceMock },
        { provide: AppHapticsService, useValue: hapticsServiceMock },
        { provide: AiInsightsLatestSnapshotService, useValue: aiInsightsLatestSnapshotServiceMock },
        { provide: AiInsightsQuotaService, useValue: aiInsightsQuotaServiceMock },
        { provide: AiInsightsService, useValue: aiInsightsServiceMock },
        { provide: AppEventService, useValue: appEventServiceMock },
        { provide: AppThemeService, useValue: themeServiceMock },
        { provide: AppUserSettingsQueryService, useValue: userSettingsQueryServiceMock },
        { provide: LoggerService, useValue: loggerServiceMock },
        { provide: MatDialog, useValue: matDialogMock },
      ],
    })
      .overrideComponent(AiInsightsPageComponent, {
        remove: {
          imports: [AiInsightsChartComponent, AiInsightsMultiMetricChartComponent, AiInsightsPowerCurveChartComponent, EventsMapComponent],
        },
        add: {
          imports: [
            MockAiInsightsChartComponent,
            MockAiInsightsMultiMetricChartComponent,
            MockAiInsightsPowerCurveChartComponent,
            MockEventsMapComponent,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AiInsightsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    authUserSubject.next({ uid: 'user-1' });
    aiInsightsServiceMock.runInsight.mockReset();
    aiInsightsServiceMock.getErrorMessage.mockClear();
    aiInsightsLatestSnapshotServiceMock.loadLatest.mockReset();
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockReset();
    appEventServiceMock.getEventsOnceByIds.mockReset();
    matDialogMock.open.mockReset();
    analyticsServiceMock.logEvent.mockReset();
    hapticsServiceMock.selection.mockReset();
    hapticsServiceMock.success.mockReset();
    loggerServiceMock.error.mockReset();
    aiInsightsLatestSnapshotServiceMock.loadLatest.mockResolvedValue(null);
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValue(buildQuotaStatus());
    appEventServiceMock.getEventsOnceByIds.mockReturnValue(of([]));
    matDialogMock.open.mockReturnValue({
      afterClosed: () => of(undefined),
    });
    await createComponent();
  });

  it('should render the hero title and featured hero prompts', () => {
    const title = fixture.debugElement.query(By.css('.hero-title'))?.nativeElement as HTMLElement | undefined;
    const pickerButton = fixture.debugElement.query(By.css('.suggestion-picker-button'))?.nativeElement as HTMLButtonElement | undefined;
    const heroPromptRotator = fixture.debugElement.query(By.css('.hero-prompt-rotator'))?.nativeElement as HTMLButtonElement | undefined;
    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;

    expect(title?.textContent).toContain('Turn Your Activity Data Into Insight');
    expect(pickerButton?.getAttribute('aria-label')).toBe('Browse prompts');
    expect(component.pickerPromptSections()).toEqual(AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS);
    expect(component.pickerPromptGroups()).toEqual(
      AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS.flatMap((section) => section.groups),
    );
    expect(heroPromptRotator?.getAttribute('aria-label')).toContain(AI_INSIGHTS_FEATURED_PROMPTS[0]);
    expect(quotaLine?.textContent).toContain(`${AI_INSIGHTS_REQUEST_LIMITS.pro - 12} of ${AI_INSIGHTS_REQUEST_LIMITS.pro} left`);
  });

  it('should disable prompt interactions while restoring the latest insight', async () => {
    let resolveLatestSnapshot: ((value: AiInsightsLatestSnapshot | null) => void) | null = null;
    aiInsightsLatestSnapshotServiceMock.loadLatest.mockReturnValueOnce(
      new Promise<AiInsightsLatestSnapshot | null>((resolve) => {
        resolveLatestSnapshot = resolve;
      }),
    );
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(buildQuotaStatus());

    await createComponent();

    const promptInput = fixture.debugElement.query(By.css('.prompt-field input'))?.nativeElement as HTMLInputElement | undefined;
    const heroPromptRotator = fixture.debugElement.query(By.css('.hero-prompt-rotator'))?.nativeElement as HTMLButtonElement | undefined;
    const pickerButton = fixture.debugElement.query(By.css('.suggestion-picker-button'))?.nativeElement as HTMLButtonElement | undefined;
    const submitButton = fixture.debugElement.query(By.css('.prompt-actions button[type="submit"]'))?.nativeElement as HTMLButtonElement | undefined;
    const loadingPanel = fixture.debugElement.query(By.css('.result-content--loading'))?.nativeElement as HTMLElement | undefined;
    const loadingStepChip = fixture.debugElement.query(By.css('.result-loading-step-chip'));

    expect(component.isRestoringLatestSnapshot()).toBe(true);
    expect(component.promptControl.disabled).toBe(true);
    expect(promptInput?.disabled).toBe(true);
    expect(heroPromptRotator?.disabled).toBe(true);
    expect(pickerButton?.disabled).toBe(true);
    expect(submitButton?.disabled).toBe(true);
    expect(loadingPanel).toBeTruthy();
    expect(loadingStepChip).toBeNull();

    resolveLatestSnapshot?.(null);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.isRestoringLatestSnapshot()).toBe(false);
    expect(component.promptControl.disabled).toBe(false);
    expect(promptInput?.disabled).toBe(false);
    expect(heroPromptRotator?.disabled).toBe(false);
    expect(pickerButton?.disabled).toBe(false);
    expect(fixture.debugElement.query(By.css('.result-content--loading'))).toBeNull();
  });

  it('should render the Basic tier quota limit in the prompt header', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(buildQuotaStatus({
      role: 'basic',
      limit: AI_INSIGHTS_REQUEST_LIMITS.basic,
      successfulRequestCount: 8,
      remainingCount: AI_INSIGHTS_REQUEST_LIMITS.basic - 8,
    }));

    await createComponent();

    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;

    expect(quotaLine?.textContent).toContain(`${AI_INSIGHTS_REQUEST_LIMITS.basic - 8} of ${AI_INSIGHTS_REQUEST_LIMITS.basic} left`);
  });

  it('should show a quota error message in the prompt header when quota loading fails', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockRejectedValueOnce(new Error('quota failure'));

    await createComponent();

    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;

    expect(quotaLine?.textContent).toContain('Quota unavailable');
    expect(loggerServiceMock.warn).toHaveBeenCalledWith(
      '[AiInsightsPageComponent] Failed to load AI insights quota status.',
      expect.any(Error),
    );
  });

  it('should show a quota error message in the prompt header when quota loading returns null', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(null);

    await createComponent();

    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;

    expect(quotaLine?.textContent).toContain('Quota unavailable');
  });

  it('should fill the prompt input from the active hero prompt without submitting', async () => {
    const heroPrompt = AI_INSIGHTS_FEATURED_PROMPTS[0];
    component.activeHeroPrompt.set(heroPrompt);
    component.typedHeroPrompt.set(heroPrompt);
    fixture.detectChanges();

    const heroPromptRotator = fixture.debugElement.query(By.css('.hero-prompt-rotator'))?.nativeElement as HTMLButtonElement | undefined;

    heroPromptRotator?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.promptControl.getRawValue()).toBe(heroPrompt);
    expect(aiInsightsServiceMock.runInsight).not.toHaveBeenCalled();
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('ai_insights_action', {
      method: 'hero_prompt_click',
      prompt_index: 0,
      prompt_length: heroPrompt.length,
      prompt_source: 'default',
    });
  });

  it('should open the grouped prompt picker and submit the selected prompt', async () => {
    const selectedPrompt = 'Show my average power over time for cycling this year.';
    const expectedPromptIndex = AI_INSIGHTS_DEFAULT_PICKER_PROMPTS.findIndex(prompt => prompt === selectedPrompt);
    expect(expectedPromptIndex).toBeGreaterThanOrEqual(0);
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildOkResponse());
    matDialogMock.open.mockReturnValueOnce({
      afterClosed: () => of(selectedPrompt),
    });
    Object.defineProperty(component, 'dialog', {
      value: matDialogMock,
    });

    await component.openPromptPicker();
    fixture.detectChanges();

    expect(matDialogMock.open).toHaveBeenCalledTimes(1);
    expect(matDialogMock.open.mock.calls[0]?.[1]).toMatchObject({
      data: {
        promptSections: AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS,
        promptSource: 'default',
      },
    });
    expect(component.promptControl.getRawValue()).toBe(selectedPrompt);
    expect(aiInsightsServiceMock.runInsight).toHaveBeenCalledWith(expect.objectContaining({
      prompt: selectedPrompt,
    }));
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('ai_insights_action', {
      method: 'suggested_prompt_select',
      prompt_index: expectedPromptIndex,
      prompt_length: selectedPrompt.length,
      prompt_source: 'default',
    });
  });

  it('should render a Material suffix clear button and clear the prompt input', () => {
    component.promptControl.setValue('Show my total distance all time');
    fixture.detectChanges();

    const clearButton = fixture.debugElement.query(By.css('button[aria-label="Clear prompt"]'))?.nativeElement as HTMLButtonElement | undefined;

    expect(clearButton).toBeTruthy();

    clearButton?.click();
    fixture.detectChanges();

    expect(component.promptControl.getRawValue()).toBe('');
    expect(fixture.debugElement.query(By.css('button[aria-label="Clear prompt"]'))).toBeNull();
  });

  it('should submit the prompt and render the result narrative and chart', async () => {
    const response = {
      ...buildOkResponse(),
      quota: buildQuotaStatus({ successfulRequestCount: 13, remainingCount: 87 }),
    };
    aiInsightsServiceMock.runInsight.mockResolvedValue(response);
    component.promptControl.setValue('Tell me my avg cadence for cycling the last 3 months');
    const resultCard = fixture.debugElement.query(By.css('.result-card'))?.nativeElement as HTMLElement | undefined;
    const scrollIntoViewSpy = vi.fn();
    if (resultCard) {
      Object.defineProperty(resultCard, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoViewSpy,
      });
    }
    const scrollToSpy = vi.fn();
    const originalScrollTo = window.scrollTo;
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: scrollToSpy,
    });

    const submitEvent = {
      preventDefault: vi.fn(),
    };
    fixture.debugElement.query(By.css('form')).triggerEventHandler('submit', submitEvent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(submitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(aiInsightsServiceMock.runInsight).toHaveBeenCalledTimes(1);
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('ai_insights_action', {
      method: 'ask_button_click',
      prompt_length: 'Tell me my avg cadence for cycling the last 3 months'.length,
    });
    expect(aiInsightsServiceMock.runInsight.mock.calls[0][0]).toMatchObject({
      prompt: 'Tell me my avg cadence for cycling the last 3 months',
      clientTimezone: expect.any(String),
      clientLocale: 'en-US',
    });

    const narrative = fixture.debugElement.query(By.css('.narrative'))?.nativeElement as HTMLElement | undefined;
    const resultTitle = fixture.debugElement.query(By.css('.result-card-title'))?.nativeElement as HTMLElement | undefined;
    const chart = fixture.debugElement.query(By.css('.chart-stub'))?.nativeElement as HTMLElement | undefined;
    const chartComponent = fixture.debugElement.query(By.directive(MockAiInsightsChartComponent))?.componentInstance as MockAiInsightsChartComponent | undefined;
    const resultContextRows = fixture.debugElement.queryAll(By.css('.result-card-context-row'));
    const resultCardMeta = fixture.debugElement.query(By.css('.result-card-meta'))?.nativeElement as HTMLElement | undefined;
    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;
    const summaryCards = fixture.debugElement.queryAll(By.css('.summary-card'));
    const summaryHelpButtons = fixture.debugElement.queryAll(By.css('.summary-help-button'));
    const expectedOverall = formatUnitAwareDataValue(
      DataCadenceAvg.type,
      86,
      userSettingsQueryServiceMock.unitSettings(),
      { stripRepeatedUnit: true },
    );

    expect(narrative?.textContent).toContain('trended up');
    expect(resultTitle?.textContent).toContain('Cadence over time for cycling');
    expect(chart?.textContent).toContain('Average cadence over time for Cycling');
    expect(chartComponent?.userUnitSettings()).toEqual(userSettingsQueryServiceMock.unitSettings());
    expect(resultContextRows.some((row) => row.nativeElement.textContent.includes('Aggregation') && row.nativeElement.textContent.includes('Average'))).toBe(true);
    expect(resultCardMeta).toBeUndefined();
    expect(quotaLine?.textContent).toContain(`${AI_INSIGHTS_REQUEST_LIMITS.pro - 13} of ${AI_INSIGHTS_REQUEST_LIMITS.pro} left`);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Overall'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Highest average'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Lowest average'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Latest average'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Coverage'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('1 of 4 months'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Trend'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('+7 rpm'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Peak bucket'))).toBe(false);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Latest bucket'))).toBe(false);
    expect(summaryHelpButtons).toHaveLength(5);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes(expectedOverall ?? ''))).toBe(true);
    expect(fixture.debugElement.query(By.css('.narrative-info--secondary'))).toBeNull();
    const calledWindowScroll = scrollToSpy.mock.calls.length > 0;
    const calledElementScroll = scrollIntoViewSpy.mock.calls.length > 0;
    expect(calledWindowScroll || calledElementScroll).toBe(true);
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: originalScrollTo,
    });
  });

  it('should submit prompt text without adding an explicit location filter payload', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildLocationScopedResponse());
    component.promptControl.setValue('Show my total distance within 75 km of Greece this year');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(aiInsightsServiceMock.runInsight).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Show my total distance within 75 km of Greece this year',
    }));
    expect(aiInsightsServiceMock.runInsight.mock.calls[0]?.[0]).not.toHaveProperty('locationFilter');
  });

  it('should not render separate location and radius controls in the prompt form', () => {
    expect(fixture.debugElement.query(By.css('.prompt-location-field'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.prompt-radius-field'))).toBeNull();
  });

  it('should render the resolved location scope in the result context rows', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildLocationScopedResponse());
    component.promptControl.setValue('Show my total distance in Greece this year');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    const resultContextRows = fixture.debugElement.queryAll(By.css('.result-card-context-row'));

    expect(resultContextRows.some((row) => row.nativeElement.textContent.includes('Location') && row.nativeElement.textContent.includes('Greece') && row.nativeElement.textContent.includes('region bbox'))).toBe(true);
  });

  it('should render deterministic compare summary in a dedicated aggregate section', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue({
      ...buildOkResponse(),
      query: {
        ...buildOkResponse().query,
        periodMode: 'compare',
      },
      deterministicCompareSummary: 'From 2025 to 2026, cadence increased by 7 rpm. Likely contributors: Cycling (up by 7 rpm).',
    });
    component.promptControl.setValue('compare my cadence this year vs last year');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    const compareSection = fixture.debugElement.query(By.css('.narrative-info--secondary'))?.nativeElement as HTMLElement | undefined;
    const compareTitle = fixture.debugElement.query(By.css('.narrative-section-title'))?.nativeElement as HTMLElement | undefined;
    const compareNarrative = compareSection?.querySelector('.narrative') as HTMLElement | null;
    const mainNarrative = fixture.debugElement.queryAll(By.css('.narrative-info .narrative'))[0]?.nativeElement as HTMLElement | undefined;

    expect(compareSection).toBeTruthy();
    expect(compareTitle?.textContent).toContain('Delta explanation');
    expect(compareNarrative?.textContent).toContain('cadence increased by 7 rpm');
    expect(mainNarrative?.textContent).toContain('trended up');
    expect(mainNarrative?.textContent).not.toContain('Delta explanation');
    expect(fixture.debugElement.query(By.css('.compare-evidence-group'))).toBeNull();
  });

  it('should render confidence and evidence chips for ok responses', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue({
      ...buildOkResponse(),
      statementChips: [
        {
          statementId: 'aggregate:narrative',
          chipType: 'confidence',
          label: 'High confidence',
          confidenceTier: 'high',
        },
        {
          statementId: 'aggregate:narrative',
          chipType: 'evidence',
          label: 'Evidence linked',
          evidenceRefs: [
            {
              kind: 'bucket',
              label: 'Bucket 2026-01',
              bucketKey: '2026-01',
            },
          ],
        },
      ],
    });
    component.promptControl.setValue('show my cadence trend');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    const chipSet = fixture.debugElement.query(By.css('.statement-chip-set'))?.nativeElement as HTMLElement | undefined;
    const chips = fixture.debugElement.queryAll(By.css('.statement-chip'));

    expect(chipSet).toBeTruthy();
    expect(chips.some((chip) => chip.nativeElement.textContent.includes('High confidence'))).toBe(true);
    expect(chips.some((chip) => chip.nativeElement.textContent.includes('Evidence linked'))).toBe(true);
  });

  it('should collapse duplicate narrative chip labels into a single display chip', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue({
      ...buildOkResponse(),
      statementChips: [
        {
          statementId: 'aggregate:narrative',
          chipType: 'confidence',
          label: 'Medium confidence',
          confidenceTier: 'medium',
        },
        {
          statementId: 'aggregate:narrative',
          chipType: 'confidence',
          label: 'Medium confidence',
          confidenceTier: 'medium',
        },
        {
          statementId: 'aggregate:narrative',
          chipType: 'confidence',
          label: 'Medium confidence',
          confidenceTier: 'medium',
        },
        {
          statementId: 'aggregate:narrative',
          chipType: 'evidence',
          label: 'Evidence linked',
          evidenceRefs: [
            {
              kind: 'bucket',
              label: 'Previous 2026-01',
              bucketKey: '2026-01',
            },
          ],
        },
        {
          statementId: 'aggregate:narrative',
          chipType: 'evidence',
          label: 'Evidence linked',
          evidenceRefs: [
            {
              kind: 'bucket',
              label: 'To 2026-02',
              bucketKey: '2026-02',
            },
          ],
        },
      ],
    });
    component.promptControl.setValue('show my cadence trend');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    const chips = fixture.debugElement
      .queryAll(By.css('.statement-chip'))
      .map(chip => (chip.nativeElement.textContent || '').trim());
    const mediumConfidenceCount = chips.filter(label => label.includes('Medium confidence')).length;
    const evidenceLinkedCount = chips.filter(label => label.includes('Evidence linked')).length;

    expect(mediumConfidenceCount).toBe(1);
    expect(evidenceLinkedCount).toBe(1);
  });

  it('should only render narrative-linked chips in the narrative chip row', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue({
      ...buildOkResponse(),
      statementChips: [
        {
          statementId: 'aggregate:trend',
          chipType: 'confidence',
          label: 'Medium confidence',
          confidenceTier: 'medium',
        },
      ],
    });
    component.promptControl.setValue('show my cadence trend');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.statement-chip-set'))).toBeNull();
  });

  it('should not render statement chips for empty responses', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildEmptyResponse());
    component.promptControl.setValue('show a metric with no results');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.statement-chip-set'))).toBeNull();
  });

  it('should render aggregate anomaly callouts with kind, confidence, and evidence chips', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue({
      ...buildOkResponse(),
      summary: {
        ...buildOkResponse().summary,
        anomalyCallouts: [
          {
            id: 'callout:spike:cadence:2026-01',
            statementId: 'anomaly:spike:cadence:2026-01',
            kind: 'spike',
            snippet: 'Unusual spike at 2026-01: Average Cadence was 110.',
            confidenceTier: 'high',
            score: 4.4,
            evidenceRefs: [
              {
                kind: 'bucket',
                label: 'Bucket 2026-01',
                bucketKey: '2026-01',
              },
            ],
          },
        ],
      },
      statementChips: [
        {
          statementId: 'anomaly:spike:cadence:2026-01',
          chipType: 'confidence',
          label: 'High confidence',
          confidenceTier: 'high',
        },
        {
          statementId: 'anomaly:spike:cadence:2026-01',
          chipType: 'evidence',
          label: 'Evidence linked',
          evidenceRefs: [
            {
              kind: 'bucket',
              label: 'Bucket 2026-01',
              bucketKey: '2026-01',
            },
          ],
        },
      ],
    });
    component.promptControl.setValue('show unusual cadence changes');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    const anomalySection = fixture.debugElement
      .queryAll(By.css('.narrative-section-title'))
      .find((node) => node.nativeElement.textContent.includes('Anomaly callouts'));
    const anomalySnippet = fixture.debugElement.query(By.css('.anomaly-callout-snippet'))?.nativeElement as HTMLElement | undefined;
    const anomalyEvidence = fixture.debugElement.query(By.css('.anomaly-callout-evidence'))?.nativeElement as HTMLElement | undefined;

    expect(anomalySection).toBeTruthy();
    expect(anomalySnippet?.textContent).toContain('Unusual spike');
    expect(fixture.debugElement.queryAll(By.css('.anomaly-callout-chip-set .statement-chip')).some((chip) => chip.nativeElement.textContent.includes('Spike'))).toBe(true);
    expect(fixture.debugElement.queryAll(By.css('.anomaly-callout-chip-set .statement-chip')).some((chip) => chip.nativeElement.textContent.includes('High confidence'))).toBe(true);
    expect(fixture.debugElement.queryAll(By.css('.anomaly-callout-chip-set .statement-chip')).some((chip) => chip.nativeElement.textContent.includes('Evidence linked'))).toBe(true);
    expect(anomalyEvidence?.textContent).toContain('Bucket 2026-01');
  });

  it('should render grouped multi-metric anomaly callouts by metric', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue({
      ...buildMultiMetricResponse(),
      metricResults: [
        {
          ...buildMultiMetricResponse().metricResults[0],
          summary: {
            ...buildMultiMetricResponse().metricResults[0].summary,
            anomalyCallouts: [
              {
                id: 'callout:drop:average_cadence:2026-01',
                statementId: 'anomaly:drop:average_cadence:2026-01',
                kind: 'drop',
                snippet: 'Unusual drop at 2026-01 for cadence.',
                confidenceTier: 'medium',
                score: 2.8,
                evidenceRefs: [
                  {
                    kind: 'bucket',
                    label: 'Bucket 2026-01',
                    bucketKey: '2026-01',
                  },
                ],
              },
            ],
          },
        },
        {
          ...buildMultiMetricResponse().metricResults[1],
        },
      ],
      statementChips: [
        {
          statementId: 'anomaly:drop:average_cadence:2026-01',
          chipType: 'confidence',
          label: 'Medium confidence',
          confidenceTier: 'medium',
        },
        {
          statementId: 'anomaly:drop:average_cadence:2026-01',
          chipType: 'evidence',
          label: 'Evidence linked',
          evidenceRefs: [
            {
              kind: 'bucket',
              label: 'Bucket 2026-01',
              bucketKey: '2026-01',
            },
          ],
        },
      ],
    });
    component.promptControl.setValue('show unusual cadence and power changes');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    const sectionHeadings = fixture.debugElement.queryAll(By.css('.anomaly-section-heading'));
    const anomalySnippets = fixture.debugElement.queryAll(By.css('.anomaly-callout-snippet'));
    const anomalyChipLabels = fixture.debugElement.queryAll(By.css('.anomaly-callout-chip-set .statement-chip'));

    expect(sectionHeadings).toHaveLength(1);
    expect(sectionHeadings[0]?.nativeElement.textContent).toContain('Cadence');
    expect(anomalySnippets[0]?.nativeElement.textContent).toContain('Unusual drop');
    expect(anomalyChipLabels.some((chip) => chip.nativeElement.textContent.includes('Drop'))).toBe(true);
    expect(anomalyChipLabels.some((chip) => chip.nativeElement.textContent.includes('Medium confidence'))).toBe(true);
  });

  it('should render grouped clickable compare evidence rows for all period deltas', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue({
      ...buildOkResponse(),
      query: {
        ...buildOkResponse().query,
        dataType: DataDistance.type,
        valueType: ChartDataValueTypes.Total,
        periodMode: 'compare',
      },
      summary: {
        ...buildOkResponse().summary,
        periodDeltas: [
          {
            fromBucket: {
              bucketKey: '2025',
              time: Date.parse('2025-01-01T00:00:00.000Z'),
              aggregateValue: 3200,
              totalCount: 18,
            },
            toBucket: {
              bucketKey: '2026',
              time: Date.parse('2026-01-01T00:00:00.000Z'),
              aggregateValue: 2800,
              totalCount: 16,
            },
            deltaAggregateValue: -400,
            direction: 'decrease',
            contributors: [],
            eventContributors: [
              {
                eventId: 'event-a',
                startDate: '2026-02-11T08:00:00.000Z',
                activityType: ActivityTypes.Cycling,
                eventStatValue: 142,
                deltaContributionValue: -142,
                direction: 'decrease',
              },
              {
                eventId: 'event-b',
                startDate: '2026-01-20T08:00:00.000Z',
                activityType: ActivityTypes.MountainBiking,
                eventStatValue: 128,
                deltaContributionValue: -128,
                direction: 'decrease',
              },
            ],
          },
          {
            fromBucket: {
              bucketKey: '2024',
              time: Date.parse('2024-01-01T00:00:00.000Z'),
              aggregateValue: 3000,
              totalCount: 14,
            },
            toBucket: {
              bucketKey: '2025',
              time: Date.parse('2025-01-01T00:00:00.000Z'),
              aggregateValue: 3200,
              totalCount: 18,
            },
            deltaAggregateValue: 200,
            direction: 'increase',
            contributors: [],
            eventContributors: [
              {
                eventId: 'event-c',
                startDate: '2025-06-15T08:00:00.000Z',
                activityType: ActivityTypes.Cycling,
                eventStatValue: 95,
                deltaContributionValue: 95,
                direction: 'increase',
              },
            ],
          },
        ],
      },
      deterministicCompareSummary: 'From 2025 to 2026, distance decreased by 400 km. Event evidence is linked below.',
    });
    component.promptControl.setValue('compare my total distance this year vs last year');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    const evidenceGroups = fixture.debugElement.queryAll(By.css('.compare-evidence-group'));
    const evidenceColumns = fixture.debugElement.queryAll(By.css('.compare-evidence-column'));
    const evidenceRows = fixture.debugElement.queryAll(By.css('.compare-evidence-link'));
    const evidenceActionLinks = fixture.debugElement.queryAll(By.css('.compare-evidence-link-action'));
    const downwardColumns = fixture.debugElement.queryAll(By.css('.compare-evidence-column .compare-evidence-link--downward'));
    const upwardColumns = fixture.debugElement.queryAll(By.css('.compare-evidence-column .compare-evidence-link--upward'));
    const emptyEvidenceMessages = fixture.debugElement.queryAll(By.css('.compare-evidence-empty'));
    const compareNarrative = fixture.debugElement.query(By.css('.narrative-info--secondary .narrative'))?.nativeElement as HTMLElement | undefined;
    const evidenceSummary = fixture.debugElement.query(By.css('.compare-evidence-summary'))?.nativeElement as HTMLElement | undefined;

    expect(evidenceGroups).toHaveLength(2);
    expect(evidenceColumns).toHaveLength(4);
    expect(evidenceGroups[0]?.nativeElement.textContent).toContain('From Jan 2025 to Jan 2026');
    expect(evidenceGroups[1]?.nativeElement.textContent).toContain('From Jan 2024 to Jan 2025');
    expect(evidenceRows).toHaveLength(3);
    expect(evidenceActionLinks).toHaveLength(3);
    expect(downwardColumns).toHaveLength(2);
    expect(upwardColumns).toHaveLength(1);
    expect(emptyEvidenceMessages).toHaveLength(2);
    expect(emptyEvidenceMessages.some((message) => message.nativeElement.textContent.includes('No upward contributors in this period pair.'))).toBe(true);
    expect(emptyEvidenceMessages.some((message) => message.nativeElement.textContent.includes('No downward contributors in this period pair.'))).toBe(true);
    expect(evidenceGroups[0]?.nativeElement.textContent).toContain('Downward contributors (from Jan 2025)');
    expect(evidenceGroups[1]?.nativeElement.textContent).toContain('Upward contributors (to Jan 2025)');
    expect(compareNarrative?.textContent).not.toContain('Event evidence is linked below');
    expect(evidenceSummary?.textContent).toContain('Shown events account for');
    expect(evidenceSummary?.textContent).toContain('% of the net');
    expect(evidenceRows[0]?.nativeElement.tagName).toBe('DIV');
    expect(evidenceRows[0]?.nativeElement.textContent).toContain(ActivityTypes.Cycling);
    expect(evidenceRows[0]?.nativeElement.textContent).toContain('% of net delta');
    expect(evidenceActionLinks[0]?.nativeElement.textContent).toContain('Review event');
    expect(evidenceActionLinks[0]?.nativeElement.getAttribute('href')).toContain('/user/user-1/event/event-a');
  });

  it('should render power-curve results with the dedicated chart and no aggregate summary cards', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildPowerCurveResponse());
    component.promptControl.setValue('What is my best power curve?');

    await component.submitPrompt();
    await fixture.whenStable();
    fixture.detectChanges();

    const powerCurveChart = fixture.debugElement.query(By.css('.power-curve-chart-stub'))?.nativeElement as HTMLElement | undefined;
    const aggregateChart = fixture.debugElement.query(By.css('.chart-stub'));
    const multiMetricChart = fixture.debugElement.query(By.css('.multi-chart-stub'));
    const summaryCards = fixture.debugElement.queryAll(By.css('.summary-card'));
    const warningChips = fixture.debugElement.queryAll(By.css('.warning-chips mat-chip'));
    const resultTitle = fixture.debugElement.query(By.css('.result-card-title'))?.nativeElement as HTMLElement | undefined;

    expect(powerCurveChart?.textContent).toContain('Best power curve for Cycling');
    expect(aggregateChart).toBeNull();
    expect(multiMetricChart).toBeNull();
    expect(summaryCards).toHaveLength(0);
    expect(warningChips.some((chip) => chip.nativeElement.textContent.includes('defaults to Cycling'))).toBe(true);
    expect(resultTitle?.textContent?.toLowerCase()).toContain('best power curve');
  });

  it('should trigger haptics on submit, processing start, and successful response', async () => {
    let resolveResponse: ((response: AiInsightsResponse) => void) | null = null;
    aiInsightsServiceMock.runInsight.mockReturnValue(new Promise<AiInsightsResponse>((resolve) => {
      resolveResponse = resolve;
    }));
    component.promptControl.setValue('Tell me my avg cadence for cycling the last 3 months');

    const submitPromise = component.submitPrompt();
    expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(1);

    await new Promise<void>((resolve) => setTimeout(resolve, 180));
    expect(hapticsServiceMock.selection).toHaveBeenCalledTimes(2);

    resolveResponse?.(buildOkResponse());
    await submitPromise;
    await fixture.whenStable();

    expect(hapticsServiceMock.success).toHaveBeenCalledTimes(1);
  });

  it('should scroll to the result card immediately when prompt submission starts', async () => {
    let resolveResponse: ((response: AiInsightsResponse) => void) | null = null;
    aiInsightsServiceMock.runInsight.mockReturnValue(new Promise<AiInsightsResponse>((resolve) => {
      resolveResponse = resolve;
    }));
    component.promptControl.setValue('Tell me my avg cadence for cycling the last 3 months');

    const resultCard = fixture.debugElement.query(By.css('.result-card'))?.nativeElement as HTMLElement | undefined;
    const scrollIntoViewSpy = vi.fn();
    if (resultCard) {
      Object.defineProperty(resultCard, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoViewSpy,
      });
    }
    const scrollToSpy = vi.fn();
    const originalScrollTo = window.scrollTo;
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: scrollToSpy,
    });

    const submitPromise = component.submitPrompt();
    fixture.detectChanges();

    const calledWindowScroll = scrollToSpy.mock.calls.length > 0;
    const calledElementScroll = scrollIntoViewSpy.mock.calls.length > 0;
    expect(calledWindowScroll || calledElementScroll).toBe(true);

    resolveResponse?.(buildOkResponse());
    await submitPromise;
    await fixture.whenStable();

    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: originalScrollTo,
    });
  });

  it('should render multi-metric responses with the combined chart and merged summary cards', async () => {
    const response = buildMultiMetricResponse();
    aiInsightsServiceMock.runInsight.mockResolvedValue(response);
    component.promptControl.setValue('Show me avg cadence and avg power for the last 3 months for cycling');

    fixture.debugElement.query(By.css('form')).triggerEventHandler('submit', {
      preventDefault: vi.fn(),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const narrative = fixture.debugElement.query(By.css('.narrative'))?.nativeElement as HTMLElement | undefined;
    const resultTitle = fixture.debugElement.query(By.css('.result-card-title'))?.nativeElement as HTMLElement | undefined;
    const multiChart = fixture.debugElement.query(By.css('.multi-chart-stub'))?.nativeElement as HTMLElement | undefined;
    const resultContextRows = fixture.debugElement.queryAll(By.css('.result-card-context-row'));
    const summaryCards = fixture.debugElement.queryAll(By.css('.summary-card'));
    const overallCard = summaryCards.find((card) => card.nativeElement.textContent.includes('Overall'))?.nativeElement as HTMLElement | undefined;
    const expectedCadenceOverall = formatUnitAwareDataValue(
      DataCadenceAvg.type,
      86,
      userSettingsQueryServiceMock.unitSettings(),
      { stripRepeatedUnit: true },
    );
    const expectedPowerOverall = formatUnitAwareDataValue(
      'Average Power',
      210,
      userSettingsQueryServiceMock.unitSettings(),
      { stripRepeatedUnit: true },
    );
    const metricSections = fixture.debugElement.queryAll(By.css('.multi-metric-section'));

    expect(narrative?.textContent).toContain('Cadence and power');
    expect(resultTitle?.textContent).toContain('Cadence and power over time for cycling');
    expect(multiChart?.textContent).toContain('Cadence and power over time for Cycling');
    expect(resultContextRows.some((row) => row.nativeElement.textContent.includes('Aggregation') && row.nativeElement.textContent.includes('Average'))).toBe(true);
    expect(overallCard?.textContent).toContain('Cadence');
    expect(overallCard?.textContent).toContain('Power');
    expect(overallCard?.textContent).toContain(expectedCadenceOverall ?? '');
    expect(overallCard?.textContent).toContain(expectedPowerOverall ?? '');
    expect(metricSections).toHaveLength(0);
  });

  it('should render digest periods for multi-metric digest responses, including no-data periods', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildMultiMetricDigestResponse());

    await component.applySuggestedPrompt('Give me a weekly digest for cycling this year.');
    fixture.detectChanges();

    const digestTitle = fixture.debugElement.queryAll(By.css('.narrative-section-title'))
      .map((element) => element.nativeElement.textContent?.trim());
    const digestRows = fixture.debugElement.queryAll(By.css('.digest-period-row'));
    const noDataBadges = fixture.debugElement.queryAll(By.css('.digest-period-badge'));
    const metricRows = fixture.debugElement.queryAll(By.css('.digest-metric-row'));

    expect(digestTitle).toContain('Digest timeline');
    expect(digestRows.length).toBeGreaterThanOrEqual(3);
    expect(noDataBadges.some((badge) => badge.nativeElement.textContent.includes('No data'))).toBe(true);
    expect(metricRows.some((row) => row.nativeElement.textContent.includes('Distance'))).toBe(true);
  });

  it('should render yearly digest labels as calendar years', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildYearlyDigestResponse());

    await component.applySuggestedPrompt('Give me a yearly digest for cycling this year.');
    fixture.detectChanges();

    const digestLabels = fixture.debugElement.queryAll(By.css('.digest-period-label'))
      .map((element) => `${element.nativeElement.textContent || ''}`.trim());

    expect(digestLabels).toEqual(expect.arrayContaining(['2024', '2025', '2026']));
  });

  it('should render the richer AI loading state while an insight request is in flight', async () => {
    let resolveResponse: ((response: AiInsightsResponse) => void) | null = null;
    aiInsightsServiceMock.runInsight.mockReturnValue(new Promise<AiInsightsResponse>((resolve) => {
      resolveResponse = resolve;
    }));
    component.promptControl.setValue('Tell me my avg cadence for cycling the last 3 months');

    const submitEvent = {
      preventDefault: vi.fn(),
    };
    fixture.debugElement.query(By.css('form')).triggerEventHandler('submit', submitEvent);
    fixture.detectChanges();

    const loadingStatus = fixture.debugElement.query(By.css('.result-loading-step-chip'))?.nativeElement as HTMLElement | undefined;
    const loadingActiveStep = fixture.debugElement.query(By.css('.result-loading-roller-row--active'))?.nativeElement as HTMLElement | undefined;
    const loadingSummaryCards = fixture.debugElement.queryAll(By.css('.summary-card--loading'));
    const loadingChartShell = fixture.debugElement.query(By.css('.result-loading-chart-shell'));
    const loadingStateComponent = fixture.debugElement.query(By.css('app-ai-insights-loading-state'));

    expect(loadingStatus?.textContent).toContain('Step 1/5');
    expect(loadingActiveStep?.textContent).toContain('Parsing prompt');
    expect(loadingSummaryCards).toHaveLength(4);
    expect(loadingChartShell).toBeTruthy();
    expect(loadingStateComponent).toBeNull();

    resolveResponse?.(buildOkResponse());
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should render event-lookup results without the aggregate chart', async () => {
    appEventServiceMock.getEventsOnceByIds.mockReturnValueOnce(of([
      buildMockEvent({
        id: 'event-3',
        startDate: '2026-03-10T08:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 123400,
          [DataStartPosition.type]: { latitudeDegrees: 38.2466, longitudeDegrees: 21.7346 },
        },
      }),
      buildMockEvent({
        id: 'event-2',
        startDate: '2026-02-14T08:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 118200,
          [DataStartPosition.type]: { latitudeDegrees: 38.25, longitudeDegrees: 21.74 },
        },
      }),
      buildMockEvent({
        id: 'event-1',
        startDate: '2026-01-11T08:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 105700,
          [DataStartPosition.type]: { latitudeDegrees: 38.24, longitudeDegrees: 21.72 },
        },
      }),
    ]));

    component.response.set(buildEventLookupResponse());
    component.resultPrompt.set('I want to know when I had my longest distance in cycling');
    fixture.detectChanges();
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.css('.chart-stub'));
    const contextRows = fixture.debugElement.queryAll(By.css('.result-card-context-row'));
    const primaryCard = fixture.debugElement.query(By.css('.event-lookup-primary'))?.nativeElement as HTMLElement | undefined;
    const rankingRows = fixture.debugElement.queryAll(By.css('.event-lookup-row'));
    const openButtons = fixture.debugElement.queryAll(By.css('.event-lookup-actions button'));
    const mapComponent = fixture.debugElement.query(By.directive(MockEventsMapComponent))?.componentInstance as MockEventsMapComponent | undefined;
    const expectedPrimaryValue = formatUnitAwareDataValue(
      DataDistance.type,
      123400,
      userSettingsQueryServiceMock.unitSettings(),
      { stripRepeatedUnit: true },
    );

    expect(chart).toBeNull();
    expect(contextRows.some((row) => row.nativeElement.textContent.includes('Date range'))).toBe(true);
    expect(contextRows.some((row) => row.nativeElement.textContent.includes('Activities'))).toBe(true);
    expect(primaryCard?.textContent).toContain('Winning event');
    expect(primaryCard?.textContent).toContain(expectedPrimaryValue ?? '');
    expect(primaryCard?.textContent).toContain('Mar 10, 2026');
    expect(rankingRows).toHaveLength(3);
    expect(openButtons.length).toBeGreaterThanOrEqual(4);
    expect(mapComponent).toBeTruthy();
    expect(mapComponent?.events()).toHaveLength(3);
    expect(mapComponent?.clusterMarkers()).toBe(false);
  });

  it('should fetch event details once when an event-lookup response becomes active', async () => {
    component.response.set(buildEventLookupResponse());
    fixture.detectChanges();

    TestBed.flushEffects();
    await fixture.whenStable();

    expect(appEventServiceMock.getEventsOnceByIds).toHaveBeenCalledTimes(1);
    expect(appEventServiceMock.getEventsOnceByIds.mock.calls[0]?.[1]).toEqual(['event-3', 'event-2', 'event-1']);
  });

  it('should fetch all ranked event ids when event-lookup returns more than ten items', async () => {
    const topEventIds = Array.from({ length: 12 }, (_, index) => `event-${index + 1}`);
    component.response.set({
      ...buildEventLookupResponse(),
      eventLookup: {
        primaryEventId: topEventIds[0],
        topEventIds,
        matchedEventCount: 12,
      },
    });
    fixture.detectChanges();

    TestBed.flushEffects();
    await fixture.whenStable();

    expect(appEventServiceMock.getEventsOnceByIds).toHaveBeenCalledTimes(1);
    expect(appEventServiceMock.getEventsOnceByIds.mock.calls[0]?.[1]).toEqual(topEventIds);
  });

  it('should render latest-event responses as text plus one event card', async () => {
    appEventServiceMock.getEventsOnceByIds.mockReturnValueOnce(of([
      buildMockEvent({
        id: 'event-9',
        startDate: '2026-03-18T08:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 20000,
          [DataStartPosition.type]: { latitudeDegrees: 37.9838, longitudeDegrees: 23.7275 },
        },
      }),
    ]));

    component.response.set(buildLatestEventResponse());
    component.resultPrompt.set('When was my last ride?');
    fixture.detectChanges();
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    const primaryCard = fixture.debugElement.query(By.css('.event-lookup-primary'))?.nativeElement as HTMLElement | undefined;
    const rankingRows = fixture.debugElement.queryAll(By.css('.event-lookup-row'));
    const mapComponent = fixture.debugElement.query(By.directive(MockEventsMapComponent))?.componentInstance as MockEventsMapComponent | undefined;

    expect(primaryCard?.textContent).toContain('Latest event');
    expect(primaryCard?.textContent).toContain('Mar 18, 2026');
    expect(rankingRows).toHaveLength(0);
    expect(mapComponent?.events()).toHaveLength(1);
    expect(appEventServiceMock.getEventsOnceByIds.mock.calls.at(-1)?.[1]).toEqual(['event-9']);
  });

  it('should show unavailable event rows gracefully when event details are missing', async () => {
    component.response.set(buildEventLookupResponse());
    component.resultPrompt.set('I want to know when I had my longest distance in cycling');
    fixture.detectChanges();
    TestBed.flushEffects();
    await fixture.whenStable();
    component.rankedEventLoadError.set('Could not load event details right now.');
    fixture.detectChanges();

    const notices = fixture.debugElement.queryAll(By.css('.result-date-range-note'));
    const rankingRows = fixture.debugElement.queryAll(By.css('.event-lookup-row'));

    expect(notices.some((notice) => notice.nativeElement.textContent.includes('Could not load event details right now.'))).toBe(true);
    expect(rankingRows[0]?.nativeElement.textContent).toContain('Unavailable');
  });

  it('should render aggregate max results with a global top-events section across all matched sports', async () => {
    appEventServiceMock.getEventsOnceByIds.mockReturnValueOnce(of([
      buildMockEvent({
        id: 'event-3',
        startDate: '2026-03-10T08:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 123400,
          [DataStartPosition.type]: { latitudeDegrees: 38.2466, longitudeDegrees: 21.7346 },
        },
      }),
      buildMockEvent({
        id: 'event-2',
        startDate: '2026-02-14T08:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: {
          [DataDistance.type]: 118200,
          [DataStartPosition.type]: { latitudeDegrees: 38.25, longitudeDegrees: 21.74 },
        },
      }),
      buildMockEvent({
        id: 'event-1',
        startDate: '2026-01-11T08:00:00.000Z',
        activityTypes: [ActivityTypes.Running],
        stats: {
          [DataDistance.type]: 18700,
          [DataStartPosition.type]: { latitudeDegrees: 38.24, longitudeDegrees: 21.72 },
        },
      }),
    ]));

    component.response.set(buildAggregateMaxBySportResponse());
    component.resultPrompt.set('Show my longest distances by sport');
    fixture.detectChanges();
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.css('.chart-stub'))?.nativeElement as HTMLElement | undefined;
    const primaryCard = fixture.debugElement.query(By.css('.event-lookup-primary'))?.nativeElement as HTMLElement | undefined;
    const sectionHeading = fixture.debugElement.queryAll(By.css('.section-heading .suggestions-title'))
      .map(debugElement => debugElement.nativeElement as HTMLElement)
      .find(element => element.textContent?.includes('Top events across all matched sports'));
    const sectionCopy = fixture.debugElement.queryAll(By.css('.section-heading .section-supporting-copy'))
      .map(debugElement => debugElement.nativeElement as HTMLElement)
      .find(element => element.textContent?.includes('across all matched sports'));
    const rankingRows = fixture.debugElement.queryAll(By.css('.event-lookup-row'));
    const mapComponent = fixture.debugElement.query(By.directive(MockEventsMapComponent))?.componentInstance as MockEventsMapComponent | undefined;

    expect(chart?.textContent).toContain('Maximum distance by activity type');
    expect(primaryCard?.textContent).toContain('Overall best event across all matched sports');
    expect(sectionHeading).toBeTruthy();
    expect(sectionCopy?.textContent).toContain('3 matching events ranked across all matched sports.');
    expect(rankingRows).toHaveLength(3);
    expect(mapComponent?.events()).toHaveLength(3);
    expect(appEventServiceMock.getEventsOnceByIds).toHaveBeenCalledWith(expect.anything(), ['event-3', 'event-2', 'event-1']);
  });

  it('should not render the top-events section for average aggregate results', async () => {
    component.response.set(buildOkResponse());
    fixture.detectChanges();
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    const sectionHeading = fixture.debugElement.queryAll(By.css('.section-heading .suggestions-title'))
      .map(debugElement => debugElement.nativeElement as HTMLElement)
      .find(element => element.textContent?.includes('Top events'));

    expect(sectionHeading).toBeFalsy();
    expect(appEventServiceMock.getEventsOnceByIds).not.toHaveBeenCalled();
    expect(fixture.debugElement.query(By.directive(MockEventsMapComponent))).toBeNull();
  });

  it('should not render the result map for multi-metric responses without surfaced events', async () => {
    component.response.set(buildMultiMetricResponse());
    fixture.detectChanges();
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(MockEventsMapComponent))).toBeNull();
  });

  it('should not render the result map when surfaced events do not have valid start positions', async () => {
    appEventServiceMock.getEventsOnceByIds.mockReturnValueOnce(of([
      buildMockEvent({
        id: 'event-3',
        startDate: '2026-03-10T08:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 123400 },
      }),
      buildMockEvent({
        id: 'event-2',
        startDate: '2026-02-14T08:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 118200 },
      }),
      buildMockEvent({
        id: 'event-1',
        startDate: '2026-01-11T08:00:00.000Z',
        activityTypes: [ActivityTypes.Cycling],
        stats: { [DataDistance.type]: 105700 },
      }),
    ]));

    component.response.set(buildEventLookupResponse());
    fixture.detectChanges();
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.directive(MockEventsMapComponent))).toBeNull();
  });

  it('should refresh the visible result with the same prompt and legacy location filter even if the input was edited', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildLocationScopedResponse());
    component.response.set(buildLocationScopedResponse());
    component.resultPrompt.set('Tell me my avg cadence for cycling the last 3 months');
    component.resultLocationFilter.set({
      locationText: 'Greece',
      radiusKm: 50,
    });
    fixture.detectChanges();

    component.promptControl.setValue('A different prompt in the input');
    fixture.detectChanges();

    const refreshButton = fixture.debugElement.query(By.css('.result-refresh-button'))?.nativeElement as HTMLButtonElement | undefined;

    refreshButton?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(aiInsightsServiceMock.runInsight).toHaveBeenLastCalledWith(expect.objectContaining({
      prompt: 'Tell me my avg cadence for cycling the last 3 months',
      locationFilter: {
        locationText: 'Greece',
        radiusKm: 50,
      },
    }));
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('ai_insights_action', {
      method: 'refresh_result_click',
      prompt_length: 'Tell me my avg cadence for cycling the last 3 months'.length,
    });
  });

  it('should render unsupported responses and swap in backend suggestions', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue({
      ...buildUnsupportedResponse(),
      quota: buildQuotaStatus(),
    });

    await component.applySuggestedPrompt('Show cadence splits for cycling');
    fixture.detectChanges();

    const unsupportedTitle = fixture.debugElement.query(By.css('.state-panel-warning .state-title'))?.nativeElement as HTMLElement | undefined;

    expect(unsupportedTitle?.textContent).toContain('Unsupported request');
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('ai_insights_action', {
      method: 'suggested_prompt_select',
      prompt_length: 'Show cadence splits for cycling'.length,
      prompt_source: 'default',
    });
    expect(component.pickerPromptSource()).toBe('unsupported');
    expect(component.pickerPrompts()).toContain('Show my total distance by activity type this year.');
  });

  it('should fall back to backend presentation title when frontend title composition is not possible', async () => {
    await createComponent();

    component.response.set({
      status: 'empty',
      narrative: 'No data',
      query: {
        resultKind: 'multi_metric_aggregate',
        groupingMode: 'date',
        categoryType: ChartDataCategoryTypes.DateType,
        requestedTimeInterval: TimeIntervals.Monthly,
        activityTypeGroups: [],
        activityTypes: [],
        dateRange: {
          kind: 'bounded',
          startDate: '2025-12-01',
          endDate: '2026-03-01',
          timezone: 'Europe/Helsinki',
          source: 'prompt',
        },
        chartType: ChartTypes.LinesVertical,
        metricSelections: [],
      },
      aggregation: {
        dataType: 'Unknown',
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
        title: 'Backend fallback title',
        chartType: ChartTypes.LinesVertical,
        emptyState: 'No matching events',
      },
    });
    fixture.detectChanges();

    const resultTitle = fixture.debugElement.query(By.css('.result-card-title'))?.nativeElement as HTMLElement | undefined;
    expect(resultTitle?.textContent).toContain('Backend fallback title');
  });

  it('should restore event-lookup snapshots and refetch the referenced event ids', async () => {
    aiInsightsLatestSnapshotServiceMock.loadLatest.mockResolvedValueOnce({
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'I want to know when I had my longest distance in cycling',
      response: buildEventLookupResponse(),
    });

    authUserSubject.next({ uid: 'user-2' });
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(appEventServiceMock.getEventsOnceByIds).toHaveBeenCalledTimes(1);
    expect(appEventServiceMock.getEventsOnceByIds.mock.calls[0]?.[1]).toEqual(['event-3', 'event-2', 'event-1']);
  });

  it('should restore the latest completed response from Firestore when the signed-in user changes', async () => {
    const restoredSnapshot: AiInsightsLatestSnapshot = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance all time',
      response: buildAllTimeResponse(),
    };
    aiInsightsLatestSnapshotServiceMock.loadLatest.mockResolvedValueOnce(restoredSnapshot);
    const resultCard = fixture.debugElement.query(By.css('.result-card'))?.nativeElement as HTMLElement | undefined;
    const scrollIntoViewSpy = vi.fn();
    if (resultCard) {
      Object.defineProperty(resultCard, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoViewSpy,
      });
    }
    const scrollToSpy = vi.fn();
    const originalScrollTo = window.scrollTo;
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: scrollToSpy,
    });

    authUserSubject.next({ uid: 'user-2' });
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    const resultContextRows = fixture.debugElement.queryAll(By.css('.result-card-context-row'));
    const resultStatusChips = fixture.debugElement.queryAll(By.css('.result-status-chip'));
    const restoredInfoButton = fixture.debugElement.query(By.css('.result-status-info-button'))?.nativeElement as HTMLButtonElement | undefined;
    const resultNotes = fixture.debugElement.queryAll(By.css('.result-note'));

    expect(aiInsightsLatestSnapshotServiceMock.loadLatest).toHaveBeenLastCalledWith('user-2');
    expect(component.promptControl.getRawValue()).toBe('Show my total distance all time');
    expect(resultContextRows.some((row) => row.nativeElement.textContent.includes('Aggregation'))).toBe(true);
    expect(resultStatusChips.length).toBeGreaterThanOrEqual(2);
    expect(resultStatusChips.some((chip) => chip.nativeElement.textContent.includes('Restored'))).toBe(true);
    expect(resultStatusChips.some((chip) => chip.nativeElement.textContent.includes('Saved Mar 18, 2026'))).toBe(true);
    expect(restoredInfoButton).toBeTruthy();
    expect(restoredInfoButton?.getAttribute('aria-label')).toBe('Restored snapshot info');
    expect(component.latestSnapshotSupportNote()).toBe('Latest completed insights are temporarily restored from your account. Proper saved insights/history will come later.');
    expect(fixture.debugElement.query(By.css('.prompt-support-note'))).toBeNull();
    expect(resultNotes).toHaveLength(0);
    const calledWindowScroll = scrollToSpy.mock.calls.length > 0;
    const calledElementScroll = scrollIntoViewSpy.mock.calls.length > 0;
    expect(calledWindowScroll || calledElementScroll).toBe(false);
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: originalScrollTo,
    });
  });

  it('should restore the latest snapshot location filter for legacy refresh behavior', async () => {
    aiInsightsLatestSnapshotServiceMock.loadLatest.mockResolvedValueOnce({
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance all time',
      response: buildLocationScopedResponse(),
    });

    authUserSubject.next({ uid: 'user-2' });
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.resultLocationFilter()).toEqual({
      locationText: 'Greece',
      radiusKm: 50,
    });
    expect(component.promptControl.getRawValue()).toBe('Show my total distance all time');
    expect(fixture.debugElement.query(By.css('.prompt-location-field'))).toBeNull();
  });

  it('should use pace-specific summary labels for inverse metrics', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildPaceResponse());

    await component.applySuggestedPrompt('Show my average pace for running over the last 2 years');
    fixture.detectChanges();

    const summaryCards = fixture.debugElement.queryAll(By.css('.summary-card'));

    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Slowest period'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Fastest period'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Latest average'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Coverage'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('2 of 25 months'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Trend'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('02:37 min/km faster'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Peak period'))).toBe(false);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Lowest average'))).toBe(false);
  });

  it('should explain when the backend defaulted the query to the current year', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildDefaultedRangeResponse());

    await component.applySuggestedPrompt('Show my average cadence');
    fixture.detectChanges();

    const note = fixture.debugElement.query(By.css('.result-date-range-note'))?.nativeElement as HTMLElement | undefined;
    const narrative = fixture.debugElement.query(By.css('.narrative'))?.nativeElement as HTMLElement | undefined;

    expect(note?.textContent).toContain('Used the current year to date because no time range was found in your prompt.');
    expect(narrative?.textContent).not.toContain('No matching data');
  });

  it('should render bounded subtitles using the injected en-US locale instead of raw ISO dates', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildDefaultedRangeResponse());

    await component.applySuggestedPrompt('Show my average cadence');
    fixture.detectChanges();

    const subtitleValues = fixture.debugElement.queryAll(By.css('.result-card-context-value'));

    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('Jan 01, 2026 to Mar 18, 2026'))).toBe(true);
    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('2025-12-18T22:00:00.000Z'))).toBe(false);
  });

  it('should render bounded subtitles using the injected en-GB locale order', async () => {
    await createComponent('en-GB');
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildDefaultedRangeResponse());

    await component.applySuggestedPrompt('Show my average cadence');
    fixture.detectChanges();

    const subtitleValues = fixture.debugElement.queryAll(By.css('.result-card-context-value'));

    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('01 Jan 2026 to 18 Mar 2026'))).toBe(true);
  });

  it('should format bounded subtitles in the query timezone instead of the browser timezone', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildPacificRangeResponse());

    await component.applySuggestedPrompt('Show my average cadence for cycling');
    fixture.detectChanges();

    const subtitleValues = fixture.debugElement.queryAll(By.css('.result-card-context-value'));

    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('Dec 19, 2025 to Mar 18, 2026'))).toBe(true);
  });

  it('should render all-time responses without a raw date span', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildAllTimeResponse());

    await component.applySuggestedPrompt('Show my total distance all time');
    fixture.detectChanges();

    const subtitleValues = fixture.debugElement.queryAll(By.css('.result-card-context-value'));
    const note = fixture.debugElement.query(By.css('.result-date-range-note'));

    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('All time'))).toBe(true);
    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('to'))).toBe(false);
    expect(note).toBeNull();
  });

  it('should format date bucket meta using the injected locale and shared dashboard date helpers', async () => {
    await createComponent('en-GB');
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildDailyResponse());

    await component.applySuggestedPrompt('Show my average cadence for cycling this month');
    fixture.detectChanges();

    const summaryCards = fixture.debugElement.queryAll(By.css('.summary-card'));

    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('02 Mar 2026'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('01 Mar 2026'))).toBe(true);
  });

  it('should render activity type groups with a compact member summary in the subtitle', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildGroupResponse());

    await component.applySuggestedPrompt('Show my average pace for water sports over the last 6 months');
    fixture.detectChanges();

    const subtitleValues = fixture.debugElement.queryAll(By.css('.result-card-context-value'));
    const summaryCards = fixture.debugElement.queryAll(By.css('.summary-card'));
    const activitiesCard = summaryCards.find((card) => card.nativeElement.textContent.includes('Activities'))?.nativeElement as HTMLElement | undefined;

    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('Water Sports'))).toBe(true);
    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('Rowing'))).toBe(true);
    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('Surfing'))).toBe(true);
    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('Kitesurfing'))).toBe(true);
    expect(subtitleValues.some((value) => value.nativeElement.textContent.includes('+6 more'))).toBe(true);
    expect(activitiesCard?.textContent).toContain('Rowing');
    expect(activitiesCard?.textContent).toContain('5');
    expect(activitiesCard?.textContent).toContain('Surfing');
    expect(activitiesCard?.textContent).toContain('4');
    expect(activitiesCard?.textContent).toContain('Kitesurfing');
    expect(activitiesCard?.textContent).toContain('2');
    expect(activitiesCard?.textContent).toContain('+1 more');
  });

  it('should hide the arbitrary latest group card and show most activities for grouped comparisons', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildActivityTypeComparisonResponse());

    await component.applySuggestedPrompt('Show my total distance by activity type this year');
    fixture.detectChanges();

    const summaryCards = fixture.debugElement.queryAll(By.css('.summary-card'));

    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Latest group'))).toBe(false);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Lowest total'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Diving'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Most activities'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Cycling'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('5'))).toBe(true);
  });

  it('should render the empty state without the chart', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildEmptyResponse());

    await component.applySuggestedPrompt('Tell me my avg cadence for cycling the last 3 months');
    fixture.detectChanges();

    const stateTitle = fixture.debugElement.query(By.css('.result-content .state-title'))?.nativeElement as HTMLElement | undefined;
    const supportLink = fixture.debugElement.query(By.css('.result-content .state-support-button'))?.nativeElement as HTMLAnchorElement | undefined;
    const chart = fixture.debugElement.query(By.css('.chart-stub'));

    expect(stateTitle?.textContent).toContain('No matching data');
    expect(supportLink?.getAttribute('href')).toBe('mailto:support@quantified-self.io?subject=AI%20Insights%20-%20No%20prompt%20results');
    expect(chart).toBeNull();
  });

  it('should render digest periods for empty digest responses', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildEmptyDigestResponse());

    await component.applySuggestedPrompt('Give me a weekly digest for cycling this year');
    fixture.detectChanges();

    const digestRows = fixture.debugElement.queryAll(By.css('.digest-period-row'));
    const digestBadges = fixture.debugElement.queryAll(By.css('.digest-period-badge'));
    const emptyCopy = fixture.debugElement.queryAll(By.css('.digest-period-empty'));

    expect(digestRows.length).toBe(2);
    expect(digestBadges.every((badge) => badge.nativeElement.textContent.includes('No data'))).toBe(true);
    expect(emptyCopy.every((row) => row.nativeElement.textContent.includes('No matching events in this period.'))).toBe(true);
  });

  it('should render digest empty-state copy when digest exists without period rows', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildEmptyDigestWithoutPeriodsResponse());

    await component.applySuggestedPrompt('Give me a yearly digest for all activities all time');
    fixture.detectChanges();

    const digestTitle = fixture.debugElement.queryAll(By.css('.narrative-section-title'))
      .map((element) => element.nativeElement.textContent?.trim());
    const digestRows = fixture.debugElement.queryAll(By.css('.digest-period-row'));
    const digestEmptyState = fixture.debugElement.query(By.css('.digest-empty-state'))?.nativeElement as HTMLElement | undefined;

    expect(digestTitle).toContain('Digest timeline');
    expect(digestRows).toHaveLength(0);
    expect(digestEmptyState?.textContent).toContain('No period timeline is available yet for this digest range.');
  });

  it('should render the mapped error message when the request fails', async () => {
    aiInsightsServiceMock.runInsight.mockRejectedValue(new Error('Could not generate AI insights.'));

    await component.applySuggestedPrompt('Tell me my avg cadence for cycling the last 3 months');
    fixture.detectChanges();

    const errorTitle = fixture.debugElement.query(By.css('.state-panel-error .state-title'))?.nativeElement as HTMLElement | undefined;
    const errorCopy = fixture.debugElement.query(By.css('.state-panel-error .state-copy'))?.nativeElement as HTMLElement | undefined;
    const supportLink = fixture.debugElement.query(By.css('.state-panel-error .state-support-button'))?.nativeElement as HTMLAnchorElement | undefined;

    expect(errorTitle?.textContent).toContain('Could not generate this insight');
    expect(errorCopy?.textContent).toContain('Could not generate AI insights.');
    expect(supportLink?.getAttribute('href')).toBe('mailto:support@quantified-self.io?subject=AI%20Insights%20-%20Prompt%20error');
  });

  it('should preserve location-specific invalid-argument errors from the backend', async () => {
    aiInsightsServiceMock.runInsight.mockRejectedValue(new Error('Could not resolve the location "Grece". Try a city, region, country, or coordinates.'));

    await component.applySuggestedPrompt('Tell me my avg cadence for cycling the last 3 months');
    fixture.detectChanges();

    const errorCopy = fixture.debugElement.query(By.css('.state-panel-error .state-copy'))?.nativeElement as HTMLElement | undefined;

    expect(errorCopy?.textContent).toContain('Could not resolve the location "Grece". Try a city, region, country, or coordinates.');
  });

  it('should disable prompt submission surfaces when the quota is exhausted', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(buildQuotaStatus({
      successfulRequestCount: 100,
      remainingCount: 0,
      blockedReason: 'limit_reached',
    }));

    await createComponent();

    const askButton = fixture.debugElement.query(By.css('button[type="submit"]'))?.nativeElement as HTMLButtonElement | undefined;
    const heroPromptRotator = fixture.debugElement.query(By.css('.hero-prompt-rotator'))?.nativeElement as HTMLButtonElement | undefined;
    const pickerButton = fixture.debugElement.query(By.css('.suggestion-picker-button'))?.nativeElement as HTMLButtonElement | undefined;
    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;
    const quotaNote = fixture.debugElement.query(By.css('.prompt-quota-note'))?.nativeElement as HTMLElement | undefined;

    expect(askButton?.disabled).toBe(true);
    expect(heroPromptRotator?.disabled).toBe(true);
    expect(pickerButton?.disabled).toBe(true);
    expect(quotaLine?.textContent).toContain(`0 of ${AI_INSIGHTS_REQUEST_LIMITS.pro} left`);
    expect(quotaNote?.textContent).toContain('limit reached');
  });

  it('should show support contact details when quota resets after next successful payment', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(buildQuotaStatus({
      periodEnd: null,
      resetMode: 'next_successful_payment',
    }));

    await createComponent();

    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;
    const quotaSupportLink = fixture.debugElement.query(By.css('.prompt-quota-line a'))?.nativeElement as HTMLAnchorElement | undefined;

    expect(quotaLine?.textContent).toContain('resets after next successful payment');
    expect(quotaLine?.textContent).toContain('Need more?');
    expect(quotaSupportLink?.textContent).toContain('Contact us');
    expect(quotaSupportLink?.getAttribute('href')).toBe('mailto:support@quantified-self.io?subject=Renew%20tokens');
  });

  it('should navigate to support mailto when the quota support contact is clicked', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(buildQuotaStatus({
      periodEnd: null,
      resetMode: 'next_successful_payment',
    }));

    await createComponent();

    const quotaSupportLink = fixture.debugElement.query(By.css('.prompt-quota-line a'))?.nativeElement as HTMLAnchorElement | undefined;
    quotaSupportLink?.click();

    expect(quotaSupportLink?.getAttribute('href')).toBe('mailto:support@quantified-self.io?subject=Renew%20tokens');
  });

  it('should show the paid-tier access message when AI Insights is unavailable for the current account', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(buildQuotaStatus({
      role: 'free',
      limit: 0,
      successfulRequestCount: 0,
      remainingCount: 0,
      isEligible: false,
      periodStart: null,
      periodEnd: null,
      periodKind: 'no_billing_period',
      resetMode: 'next_successful_payment',
      blockedReason: 'requires_pro',
    }));

    await createComponent();

    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;
    const quotaNote = fixture.debugElement.query(By.css('.prompt-quota-note'))?.nativeElement as HTMLElement | undefined;

    expect(quotaLine?.textContent).toContain('0 of 0 left');
    expect(quotaLine?.textContent).toContain('Basic or Pro required');
    expect(quotaNote?.textContent).toContain('Basic and Pro members');
  });
});
