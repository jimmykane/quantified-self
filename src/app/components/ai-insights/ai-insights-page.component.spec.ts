import { CommonModule } from '@angular/common';
import { Component, LOCALE_ID, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
  AppThemes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataCadenceAvg,
  DataPaceAvg,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightsLatestSnapshot,
  AiInsightsEmptyResponse,
  AiInsightsOkResponse,
  AiInsightsQuotaStatus,
  AiInsightsResponse,
  AiInsightsUnsupportedResponse,
} from '@shared/ai-insights.types';
import { formatUnitAwareDataValue, normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AiInsightsLatestSnapshotService } from '../../services/ai-insights-latest-snapshot.service';
import { AiInsightsQuotaService } from '../../services/ai-insights-quota.service';
import { AiInsightsService } from '../../services/ai-insights.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AiInsightsChartComponent } from './ai-insights-chart.component';
import { AiInsightsPageComponent } from './ai-insights-page.component';
import { AI_INSIGHTS_SUGGESTED_PROMPTS } from './ai-insights.prompts';

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

function buildQuotaStatus(overrides: Partial<AiInsightsQuotaStatus> = {}): AiInsightsQuotaStatus {
  return {
    role: 'pro',
    limit: 100,
    successfulGenkitCount: 12,
    activeReservationCount: 0,
    remainingCount: 88,
    periodStart: '2026-03-01T00:00:00.000Z',
    periodEnd: '2026-04-01T00:00:00.000Z',
    periodKind: 'subscription',
    resetMode: 'date',
    isEligible: true,
    blockedReason: null,
    ...overrides,
  };
}

function buildOkResponse(): AiInsightsOkResponse {
  return {
    status: 'ok',
    narrative: 'Your average cadence has trended up over the last three months.',
    query: {
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

function buildEmptyResponse(): AiInsightsEmptyResponse {
  return {
    status: 'empty',
    narrative: 'I could not find matching events with cadence data in that range.',
    query: {
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

function buildPaceResponse(): AiInsightsOkResponse {
  return {
    status: 'ok',
    narrative: 'Your average running pace improved over the last two years.',
    query: {
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
      'Show my total distance by activity type this year',
      'Tell me my avg cadence for cycling the last 3 months',
    ],
  };
}

function buildGroupResponse(): AiInsightsOkResponse {
  return {
    status: 'ok',
    narrative: 'Your average pace across water sports has improved.',
    query: {
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
    saveLatest: vi.fn<() => Promise<'saved' | 'skipped_too_large' | 'failed'>>(),
  };
  const aiInsightsQuotaServiceMock = {
    loadQuotaStatus: vi.fn<() => Promise<AiInsightsQuotaStatus | null>>(),
  };
  const themeServiceMock = {
    appTheme: signal(AppThemes.Normal),
  };
  const analyticsServiceMock = {
    logEvent: vi.fn(),
  };
  const userSettingsQueryServiceMock = {
    chartSettings: signal({ useAnimations: true }),
    unitSettings: signal(normalizeUserUnitSettings({})),
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
        { provide: AiInsightsLatestSnapshotService, useValue: aiInsightsLatestSnapshotServiceMock },
        { provide: AiInsightsQuotaService, useValue: aiInsightsQuotaServiceMock },
        { provide: AiInsightsService, useValue: aiInsightsServiceMock },
        { provide: AppThemeService, useValue: themeServiceMock },
        { provide: AppUserSettingsQueryService, useValue: userSettingsQueryServiceMock },
      ],
    })
      .overrideComponent(AiInsightsPageComponent, {
        remove: {
          imports: [AiInsightsChartComponent],
        },
        add: {
          imports: [MockAiInsightsChartComponent],
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
    aiInsightsLatestSnapshotServiceMock.saveLatest.mockReset();
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockReset();
    analyticsServiceMock.logEvent.mockReset();
    aiInsightsLatestSnapshotServiceMock.loadLatest.mockResolvedValue(null);
    aiInsightsLatestSnapshotServiceMock.saveLatest.mockResolvedValue('saved');
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValue(buildQuotaStatus());
    await createComponent();
  });

  it('should render the hero title and default suggested prompts', () => {
    const title = fixture.debugElement.query(By.css('.hero-title'))?.nativeElement as HTMLElement | undefined;
    const suggestionTrigger = fixture.debugElement.query(By.css('.suggestion-menu-trigger'))?.nativeElement as HTMLButtonElement | undefined;
    const heroPromptRotator = fixture.debugElement.query(By.css('.hero-prompt-rotator'))?.nativeElement as HTMLButtonElement | undefined;
    const supportNote = fixture.debugElement.query(By.css('.prompt-support-note'))?.nativeElement as HTMLElement | undefined;
    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;

    expect(title?.textContent).toContain('Ask a focused question about your training data.');
    expect(suggestionTrigger?.getAttribute('aria-label')).toBe('Suggested prompts');
    expect(component.suggestedPrompts()).toEqual([...AI_INSIGHTS_SUGGESTED_PROMPTS]);
    expect(heroPromptRotator?.getAttribute('aria-label')).toContain(AI_INSIGHTS_SUGGESTED_PROMPTS[0]);
    expect(quotaLine?.textContent).toContain('88 of 100 left');
    expect(supportNote?.textContent).toContain('Latest completed insights are temporarily restored from your account.');
  });

  it('should render the Basic tier quota limit in the prompt header', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(buildQuotaStatus({
      role: 'basic',
      limit: 50,
      successfulGenkitCount: 8,
      remainingCount: 42,
    }));

    await createComponent();

    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;

    expect(quotaLine?.textContent).toContain('42 of 50 left');
  });

  it('should submit the active hero prompt when clicked', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildOkResponse());
    const heroPrompt = 'Show my total distance by activity type this year';
    component.activeHeroPrompt.set(heroPrompt);
    component.typedHeroPrompt.set(heroPrompt);
    fixture.detectChanges();

    const heroPromptRotator = fixture.debugElement.query(By.css('.hero-prompt-rotator'))?.nativeElement as HTMLButtonElement | undefined;

    heroPromptRotator?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.promptControl.getRawValue()).toBe(heroPrompt);
    expect(aiInsightsServiceMock.runInsight).toHaveBeenCalledWith(expect.objectContaining({
      prompt: heroPrompt,
    }));
    expect(analyticsServiceMock.logEvent).toHaveBeenCalledWith('ai_insights_action', {
      method: 'hero_prompt_click',
      prompt_index: 1,
      prompt_length: heroPrompt.length,
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
      quota: buildQuotaStatus({ successfulGenkitCount: 13, remainingCount: 87 }),
    };
    aiInsightsServiceMock.runInsight.mockResolvedValue(response);
    component.promptControl.setValue('Tell me my avg cadence for cycling the last 3 months');

    const submitEvent = {
      preventDefault: vi.fn(),
    };
    fixture.debugElement.query(By.css('form')).triggerEventHandler('submit', submitEvent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(submitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(aiInsightsServiceMock.runInsight).toHaveBeenCalledTimes(1);
    expect(aiInsightsLatestSnapshotServiceMock.saveLatest).toHaveBeenCalledWith(
      'user-1',
      'Tell me my avg cadence for cycling the last 3 months',
      response,
    );
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
    const chart = fixture.debugElement.query(By.css('.chart-stub'))?.nativeElement as HTMLElement | undefined;
    const chartComponent = fixture.debugElement.query(By.directive(MockAiInsightsChartComponent))?.componentInstance as MockAiInsightsChartComponent | undefined;
    const resultCardSubtitle = fixture.debugElement.query(By.css('.result-card-subtitle'))?.nativeElement as HTMLElement | undefined;
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
    expect(chart?.textContent).toContain('Average cadence over time for Cycling');
    expect(chartComponent?.userUnitSettings()).toEqual(userSettingsQueryServiceMock.unitSettings());
    expect(resultCardSubtitle?.textContent).toContain('Insight summary and chart for this prompt.');
    expect(resultCardMeta?.textContent).toContain('Saved');
    expect(quotaLine?.textContent).toContain('87 of 100 left');
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Overall'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Highest period'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Lowest period'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Latest period with data'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Coverage'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('1 of 4 months'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Trend'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('+7 rpm'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Peak bucket'))).toBe(false);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Latest bucket'))).toBe(false);
    expect(summaryHelpButtons).toHaveLength(5);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes(expectedOverall ?? ''))).toBe(true);
  });

  it('should refresh the visible result with the same prompt even if the input was edited', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildOkResponse());
    component.promptControl.setValue('Tell me my avg cadence for cycling the last 3 months');

    const submitEvent = {
      preventDefault: vi.fn(),
    };
    fixture.debugElement.query(By.css('form')).triggerEventHandler('submit', submitEvent);
    await fixture.whenStable();
    fixture.detectChanges();

    component.promptControl.setValue('A different prompt in the input');
    fixture.detectChanges();

    const refreshButton = fixture.debugElement.query(By.css('.result-refresh-button'))?.nativeElement as HTMLButtonElement | undefined;

    refreshButton?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(aiInsightsServiceMock.runInsight).toHaveBeenLastCalledWith(expect.objectContaining({
      prompt: 'Tell me my avg cadence for cycling the last 3 months',
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
    expect(component.suggestedPrompts()).toContain('Show my total distance by activity type this year');
  });

  it('should restore the latest completed response from Firestore when the signed-in user changes', async () => {
    const restoredSnapshot: AiInsightsLatestSnapshot = {
      version: 1,
      savedAt: '2026-03-18T12:00:00.000Z',
      prompt: 'Show my total distance all time',
      response: buildAllTimeResponse(),
    };
    aiInsightsLatestSnapshotServiceMock.loadLatest.mockResolvedValueOnce(restoredSnapshot);

    authUserSubject.next({ uid: 'user-2' });
    TestBed.flushEffects();
    await fixture.whenStable();
    fixture.detectChanges();

    const subtitle = fixture.debugElement.query(By.css('.result-subtitle'))?.nativeElement as HTMLElement | undefined;
    const resultCardSubtitle = fixture.debugElement.query(By.css('.result-card-subtitle'))?.nativeElement as HTMLElement | undefined;
    const resultCardMeta = fixture.debugElement.query(By.css('.result-card-meta'))?.nativeElement as HTMLElement | undefined;
    const resultNotes = fixture.debugElement.queryAll(By.css('.result-note'));

    expect(aiInsightsLatestSnapshotServiceMock.loadLatest).toHaveBeenLastCalledWith('user-2');
    expect(component.promptControl.getRawValue()).toBe('Show my total distance all time');
    expect(subtitle?.textContent).toContain('All time');
    expect(resultCardSubtitle?.textContent).toContain('Insight summary and chart for this prompt.');
    expect(resultCardMeta?.textContent).toContain('Restored');
    expect(resultCardMeta?.textContent).toContain('Saved Mar 18, 2026');
    expect(resultNotes).toHaveLength(0);
  });

  it('should use pace-specific summary labels for inverse metrics', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildPaceResponse());

    await component.applySuggestedPrompt('Show my average pace for running over the last 2 years');
    fixture.detectChanges();

    const summaryCards = fixture.debugElement.queryAll(By.css('.summary-card'));

    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Slowest period'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Fastest period'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Latest period with data'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Coverage'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('2 of 25 months'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Trend'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('02:37 min/km faster'))).toBe(true);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Peak period'))).toBe(false);
    expect(summaryCards.some((card) => card.nativeElement.textContent.includes('Lowest period'))).toBe(false);
  });

  it('should explain when the backend defaulted the query to the current year', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildDefaultedRangeResponse());

    await component.applySuggestedPrompt('Show my average cadence');
    fixture.detectChanges();

    const note = fixture.debugElement.query(By.css('.result-date-range-note'))?.nativeElement as HTMLElement | undefined;

    expect(note?.textContent).toContain('Used the current year to date because no time range was found in your prompt.');
  });

  it('should render bounded subtitles using the injected en-US locale instead of raw ISO dates', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildDefaultedRangeResponse());

    await component.applySuggestedPrompt('Show my average cadence');
    fixture.detectChanges();

    const subtitle = fixture.debugElement.query(By.css('.result-subtitle'))?.nativeElement as HTMLElement | undefined;

    expect(subtitle?.textContent).toContain('Jan 01, 2026 to Mar 18, 2026');
    expect(subtitle?.textContent).not.toContain('2025-12-18T22:00:00.000Z');
  });

  it('should render bounded subtitles using the injected en-GB locale order', async () => {
    await createComponent('en-GB');
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildDefaultedRangeResponse());

    await component.applySuggestedPrompt('Show my average cadence');
    fixture.detectChanges();

    const subtitle = fixture.debugElement.query(By.css('.result-subtitle'))?.nativeElement as HTMLElement | undefined;

    expect(subtitle?.textContent).toContain('01 Jan 2026 to 18 Mar 2026');
  });

  it('should format bounded subtitles in the query timezone instead of the browser timezone', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildPacificRangeResponse());

    await component.applySuggestedPrompt('Show my average cadence for cycling');
    fixture.detectChanges();

    const subtitle = fixture.debugElement.query(By.css('.result-subtitle'))?.nativeElement as HTMLElement | undefined;

    expect(subtitle?.textContent).toContain('Dec 19, 2025 to Mar 18, 2026');
  });

  it('should render all-time responses without a raw date span', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildAllTimeResponse());

    await component.applySuggestedPrompt('Show my total distance all time');
    fixture.detectChanges();

    const subtitle = fixture.debugElement.query(By.css('.result-subtitle'))?.nativeElement as HTMLElement | undefined;
    const note = fixture.debugElement.query(By.css('.result-date-range-note'));

    expect(subtitle?.textContent).toContain('All time');
    expect(subtitle?.textContent).not.toContain('to');
    expect(note).toBeNull();
  });

  it('should show a non-blocking note when a result is too large to save to Firestore', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildOkResponse());
    aiInsightsLatestSnapshotServiceMock.saveLatest.mockResolvedValue('skipped_too_large');

    await component.applySuggestedPrompt('Show my total distance by activity type this year');
    fixture.detectChanges();

    const resultNotes = fixture.debugElement.queryAll(By.css('.result-note'));

    expect(resultNotes.some((note) => note.nativeElement.textContent.includes('This result is too large to save to your account yet'))).toBe(true);
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

    const subtitle = fixture.debugElement.query(By.css('.result-subtitle'))?.nativeElement as HTMLElement | undefined;
    const summaryCards = fixture.debugElement.queryAll(By.css('.summary-card'));
    const activitiesCard = summaryCards.find((card) => card.nativeElement.textContent.includes('Activities'))?.nativeElement as HTMLElement | undefined;

    expect(subtitle?.textContent).toContain('Water Sports');
    expect(subtitle?.textContent).toContain('Rowing');
    expect(subtitle?.textContent).toContain('Surfing');
    expect(subtitle?.textContent).toContain('Kitesurfing');
    expect(subtitle?.textContent).toContain('+6 more');
    expect(activitiesCard?.textContent).toContain('Rowing');
    expect(activitiesCard?.textContent).toContain('5');
    expect(activitiesCard?.textContent).toContain('Surfing');
    expect(activitiesCard?.textContent).toContain('4');
    expect(activitiesCard?.textContent).toContain('Kitesurfing');
    expect(activitiesCard?.textContent).toContain('2');
    expect(activitiesCard?.textContent).toContain('+1 more');
  });

  it('should render the empty state without the chart', async () => {
    aiInsightsServiceMock.runInsight.mockResolvedValue(buildEmptyResponse());

    await component.applySuggestedPrompt('Tell me my avg cadence for cycling the last 3 months');
    fixture.detectChanges();

    const stateTitle = fixture.debugElement.query(By.css('.result-content .state-title'))?.nativeElement as HTMLElement | undefined;
    const chart = fixture.debugElement.query(By.css('.chart-stub'));

    expect(stateTitle?.textContent).toContain('No matching data');
    expect(chart).toBeNull();
  });

  it('should render the mapped error message when the request fails', async () => {
    aiInsightsServiceMock.runInsight.mockRejectedValue(new Error('Could not generate AI insights.'));

    await component.applySuggestedPrompt('Tell me my avg cadence for cycling the last 3 months');
    fixture.detectChanges();

    const errorTitle = fixture.debugElement.query(By.css('.state-panel-error .state-title'))?.nativeElement as HTMLElement | undefined;
    const errorCopy = fixture.debugElement.query(By.css('.state-panel-error .state-copy'))?.nativeElement as HTMLElement | undefined;

    expect(errorTitle?.textContent).toContain('Could not generate this insight');
    expect(errorCopy?.textContent).toContain('Could not generate AI insights.');
    expect(aiInsightsLatestSnapshotServiceMock.saveLatest).not.toHaveBeenCalled();
  });

  it('should disable prompt submission surfaces when the quota is exhausted', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(buildQuotaStatus({
      successfulGenkitCount: 100,
      remainingCount: 0,
      blockedReason: 'limit_reached',
    }));

    await createComponent();

    const askButton = fixture.debugElement.query(By.css('button[type="submit"]'))?.nativeElement as HTMLButtonElement | undefined;
    const heroPromptRotator = fixture.debugElement.query(By.css('.hero-prompt-rotator'))?.nativeElement as HTMLButtonElement | undefined;
    const suggestionTrigger = fixture.debugElement.query(By.css('.suggestion-menu-trigger'))?.nativeElement as HTMLButtonElement | undefined;
    const quotaLine = fixture.debugElement.query(By.css('.prompt-quota-line'))?.nativeElement as HTMLElement | undefined;
    const quotaNote = fixture.debugElement.query(By.css('.prompt-quota-note'))?.nativeElement as HTMLElement | undefined;

    expect(askButton?.disabled).toBe(true);
    expect(heroPromptRotator?.disabled).toBe(true);
    expect(suggestionTrigger?.disabled).toBe(true);
    expect(quotaLine?.textContent).toContain('0 of 100 left');
    expect(quotaNote?.textContent).toContain('limit reached');
  });

  it('should show the paid-tier access message when AI Insights is unavailable for the current account', async () => {
    aiInsightsQuotaServiceMock.loadQuotaStatus.mockResolvedValueOnce(buildQuotaStatus({
      role: 'free',
      limit: 0,
      successfulGenkitCount: 0,
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
