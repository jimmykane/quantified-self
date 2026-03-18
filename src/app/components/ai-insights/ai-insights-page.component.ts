import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, LOCALE_ID, NgZone, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  AppThemes,
  ChartDataCategoryTypes,
  TimeIntervals,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightSummaryBucket,
  AiInsightsEmptyResponse,
  AiInsightsOkResponse,
  AiInsightsRequest,
  AiInsightsResponse,
  AiInsightsUnsupportedResponse,
  NormalizedInsightDateRange,
} from '@shared/ai-insights.types';
import { resolveAiInsightsActivityFilterSummary } from '@shared/ai-insights-activity-filter';
import { resolveMetricSemantics, resolveMetricSummarySemantics } from '@shared/metric-semantics';
import { formatUnitAwareDataValue, normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { AppAuthService } from '../../authentication/app.auth.service';
import { MaterialModule } from '../../modules/material.module';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AiInsightsLatestSnapshotService } from '../../services/ai-insights-latest-snapshot.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AiInsightsService } from '../../services/ai-insights.service';
import { formatDashboardBucketDateByInterval, formatDashboardDateRange } from '../../helpers/dashboard-chart-data.helper';
import { AiInsightsChartComponent } from './ai-insights-chart.component';
import { AI_INSIGHTS_SUGGESTED_PROMPTS } from './ai-insights.prompts';

const HERO_PROMPT_TYPING_DELAY_MS = 38;
const HERO_PROMPT_DELETING_DELAY_MS = 20;
const HERO_PROMPT_HOLD_DELAY_MS = 1900;
const HERO_PROMPT_BETWEEN_PROMPTS_DELAY_MS = 280;

function getClientTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function formatDateRange(dateRange: NormalizedInsightDateRange, locale: string): string {
  if (dateRange.kind === 'all_time') {
    return 'All time';
  }

  return formatDashboardDateRange(dateRange.startDate, dateRange.endDate, locale);
}

function formatDateRangeNote(dateRange: NormalizedInsightDateRange): string | null {
  if (dateRange.kind !== 'bounded' || dateRange.source !== 'default') {
    return null;
  }

  return 'Used the last 90 days because no time range was found in your prompt.';
}

function formatBucketMeta(
  response: AiInsightsOkResponse,
  bucket: AiInsightSummaryBucket,
  locale?: string,
): string | null {
  if (
    response.query.categoryType === ChartDataCategoryTypes.DateType
    && Number.isFinite(bucket.time)
  ) {
    return formatDashboardBucketDateByInterval(
      bucket.time as number,
      response.aggregation.resolvedTimeInterval,
      locale,
    );
  }

  return `${bucket.bucketKey}`;
}

function formatSummaryValue(
  dataType: string,
  value: number | null,
  unitSettings: UserUnitSettingsInterface,
): string | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  return formatUnitAwareDataValue(dataType, value, unitSettings, {
    stripRepeatedUnit: true,
  });
}

function buildActivityMixDetails(
  response: AiInsightsOkResponse,
  locale: string | undefined,
): Pick<InsightSummaryCard, 'detailRows' | 'metaFooter'> {
  const activityMix = response.summary.activityMix;
  if (!activityMix?.topActivityTypes.length) {
    return {};
  }

  const shouldShowMix = response.query.activityTypeGroups.length > 0
    || response.query.activityTypes.length !== 1
    || activityMix.topActivityTypes.length > 1;
  if (!shouldShowMix) {
    return {};
  }

  const numberFormat = new Intl.NumberFormat(locale || undefined);
  return {
    detailRows: activityMix.topActivityTypes.map(entry => ({
      label: entry.activityType,
      value: numberFormat.format(entry.eventCount),
    })),
    metaFooter: activityMix.remainingActivityTypeCount > 0
      ? `+${numberFormat.format(activityMix.remainingActivityTypeCount)} more`
      : undefined,
  };
}

function resolveCoveragePeriodLabel(timeInterval: TimeIntervals, count: number): string {
  const singularLabel = (() => {
    switch (timeInterval) {
      case TimeIntervals.Hourly:
        return 'hour';
      case TimeIntervals.Daily:
        return 'day';
      case TimeIntervals.Weekly:
      case TimeIntervals.BiWeekly:
        return 'week';
      case TimeIntervals.Monthly:
        return 'month';
      case TimeIntervals.Quarterly:
        return 'quarter';
      case TimeIntervals.Semesterly:
        return 'semester';
      case TimeIntervals.Yearly:
        return 'year';
      default:
        return 'period';
    }
  })();

  return count === 1 ? singularLabel : `${singularLabel}s`;
}

function formatCoverageValue(response: AiInsightsOkResponse): string | null {
  const coverage = response.summary.bucketCoverage;
  if (!coverage) {
    return null;
  }

  const periodLabel = resolveCoveragePeriodLabel(
    response.aggregation.resolvedTimeInterval,
    coverage.totalBucketCount,
  );
  return `${coverage.nonEmptyBucketCount} of ${coverage.totalBucketCount} ${periodLabel}`;
}

function formatTrendValue(
  response: AiInsightsOkResponse,
  unitSettings: UserUnitSettingsInterface,
): string | null {
  const trend = response.summary.trend;
  if (!trend || !Number.isFinite(trend.deltaAggregateValue)) {
    return null;
  }

  if (trend.deltaAggregateValue === 0) {
    return 'No change';
  }

  const absoluteDisplayValue = formatSummaryValue(
    response.query.dataType,
    Math.abs(trend.deltaAggregateValue),
    unitSettings,
  );
  if (!absoluteDisplayValue) {
    return null;
  }

  const semantics = resolveMetricSemantics(response.query.dataType);
  if (semantics.direction === 'inverse') {
    return `${absoluteDisplayValue} ${trend.deltaAggregateValue < 0 ? 'faster' : 'slower'}`;
  }

  return `${trend.deltaAggregateValue > 0 ? '+' : '-'}${absoluteDisplayValue}`;
}

interface InsightSummaryCard {
  label: string;
  value: string;
  meta?: string;
  detailRows?: Array<{
    label: string;
    value: string;
  }>;
  metaFooter?: string;
  helpText?: string;
}

interface ResultNote {
  icon: 'info' | 'history';
  message: string;
}

@Component({
  selector: 'app-ai-insights-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    MaterialModule,
    AiInsightsChartComponent,
  ],
  templateUrl: './ai-insights-page.component.html',
  styleUrls: ['./ai-insights-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInsightsPageComponent {
  private readonly authService = inject(AppAuthService);
  private readonly analyticsService = inject(AppAnalyticsService);
  private readonly aiInsightsService = inject(AiInsightsService);
  private readonly aiInsightsLatestSnapshotService = inject(AiInsightsLatestSnapshotService);
  private readonly themeService = inject(AppThemeService);
  private readonly userSettingsQueryService = inject(AppUserSettingsQueryService);
  private readonly ngZone = inject(NgZone);
  private readonly locale = inject(LOCALE_ID);

  readonly promptControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  readonly promptValue = toSignal(this.promptControl.valueChanges, {
    initialValue: this.promptControl.getRawValue(),
  });
  readonly isSubmitting = signal(false);
  readonly response = signal<AiInsightsResponse | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly latestSnapshotRestored = signal(false);
  readonly latestSnapshotPersistenceNotice = signal<string | null>(null);
  readonly appTheme = this.themeService.appTheme;
  readonly user = toSignal(this.authService.user$, { initialValue: null });
  readonly chartSettings = this.userSettingsQueryService.chartSettings;
  readonly userUnitSettings = computed(() =>
    normalizeUserUnitSettings(this.userSettingsQueryService.unitSettings())
  );
  readonly currentUserID = computed(() => this.user()?.uid ?? null);
  readonly isDarkTheme = computed(() => this.appTheme() === AppThemes.Dark);
  readonly useAnimations = computed(() => this.chartSettings().useAnimations ?? false);
  readonly canSubmit = computed(() => !this.isSubmitting() && this.promptValue().trim().length > 0);
  readonly okResponse = computed<AiInsightsOkResponse | null>(() => {
    const response = this.response();
    return response?.status === 'ok' ? response : null;
  });
  readonly emptyResponse = computed<AiInsightsEmptyResponse | null>(() => {
    const response = this.response();
    return response?.status === 'empty' ? response : null;
  });
  readonly unsupportedResponse = computed<AiInsightsUnsupportedResponse | null>(() => {
    const response = this.response();
    return response?.status === 'unsupported' ? response : null;
  });
  readonly hasCompletedResponse = computed(() => {
    const response = this.response();
    return response?.status === 'ok'
      || response?.status === 'empty'
      || response?.status === 'unsupported';
  });
  readonly latestSnapshotSupportNote = computed(() =>
    'Latest completed insights are temporarily restored from your account. Proper saved insights/history will come later.'
  );
  readonly resultNotes = computed<ResultNote[]>(() => {
    if (!this.hasCompletedResponse()) {
      return [];
    }

    const notes: ResultNote[] = [];
    if (this.latestSnapshotRestored()) {
      notes.push({
        icon: 'history',
        message: 'Restored the latest completed insight from your account.',
      });
    }
    if (this.latestSnapshotPersistenceNotice()) {
      notes.push({
        icon: 'info',
        message: this.latestSnapshotPersistenceNotice() as string,
      });
    }
    return notes;
  });
  readonly activeHeroPrompt = signal(AI_INSIGHTS_SUGGESTED_PROMPTS[0] ?? '');
  readonly typedHeroPrompt = signal((AI_INSIGHTS_SUGGESTED_PROMPTS[0] ?? '').slice(0, 1));
  readonly suggestedPrompts = computed(() => {
    const unsupportedResponse = this.unsupportedResponse();
    if (unsupportedResponse?.suggestedPrompts?.length) {
      return unsupportedResponse.suggestedPrompts;
    }
    return AI_INSIGHTS_SUGGESTED_PROMPTS;
  });
  private readonly heroPromptAnimation = effect((onCleanup) => {
    const prompts = this.suggestedPrompts().filter(prompt => prompt.trim().length > 0);
    if (!prompts.length) {
      this.activeHeroPrompt.set('');
      this.typedHeroPrompt.set('');
      return;
    }

    let promptIndex = 0;
    let charIndex = Math.min(1, prompts[0].length);
    let deleting = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const applyPromptFrame = (nextPromptIndex: number, nextCharIndex: number): void => {
      const prompt = prompts[nextPromptIndex] ?? '';
      promptIndex = nextPromptIndex;
      charIndex = nextCharIndex;
      this.activeHeroPrompt.set(prompt);
      this.typedHeroPrompt.set(prompt.slice(0, nextCharIndex));
    };

    const schedule = (delay: number): void => {
      this.ngZone.runOutsideAngular(() => {
        timer = setTimeout(tick, delay);
      });
    };

    const tick = (): void => {
      const prompt = prompts[promptIndex] ?? '';
      if (!prompt) {
        return;
      }

      if (!deleting) {
        if (charIndex < prompt.length) {
          applyPromptFrame(promptIndex, charIndex + 1);
          schedule(HERO_PROMPT_TYPING_DELAY_MS);
          return;
        }

        deleting = true;
        schedule(HERO_PROMPT_HOLD_DELAY_MS);
        return;
      }

      if (charIndex > 1) {
        applyPromptFrame(promptIndex, charIndex - 1);
        schedule(HERO_PROMPT_DELETING_DELAY_MS);
        return;
      }

      deleting = false;
      const nextPromptIndex = (promptIndex + 1) % prompts.length;
      applyPromptFrame(nextPromptIndex, Math.min(1, prompts[nextPromptIndex]?.length ?? 0));
      schedule(HERO_PROMPT_BETWEEN_PROMPTS_DELAY_MS);
    };

    applyPromptFrame(0, charIndex);
    schedule(HERO_PROMPT_TYPING_DELAY_MS);

    onCleanup(() => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    });
  });
  private readonly latestSnapshotRestoreEffect = effect((onCleanup) => {
    const userID = this.currentUserID();
    let cancelled = false;

    this.latestSnapshotRestored.set(false);
    this.latestSnapshotPersistenceNotice.set(null);
    this.errorMessage.set(null);
    this.response.set(null);
    this.promptControl.setValue('');

    if (!userID) {
      return;
    }

    void (async () => {
      const latestSnapshot = await this.aiInsightsLatestSnapshotService.loadLatest(userID);
      if (cancelled || !latestSnapshot) {
        return;
      }

      this.promptControl.setValue(latestSnapshot.prompt);
      this.response.set(latestSnapshot.response);
      this.latestSnapshotRestored.set(true);
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });
  readonly resultSubtitle = computed(() => {
    const response = this.okResponse() || this.emptyResponse();
    if (!response) {
      return '';
    }

    return `${formatDateRange(response.query.dateRange, this.locale)} • ${resolveAiInsightsActivityFilterSummary(response.query)}`;
  });
  readonly resultDateRangeNote = computed(() => {
    const response = this.okResponse() || this.emptyResponse();
    if (!response) {
      return null;
    }

    return formatDateRangeNote(response.query.dateRange);
  });
  readonly resultWarnings = computed(() => this.okResponse()?.presentation.warnings ?? []);
  readonly resultSummaryCards = computed<InsightSummaryCard[]>(() => {
    const response = this.okResponse();
    if (!response) {
      return [];
    }

    const unitSettings = this.userUnitSettings();
    const locale = this.locale;
    const summarySemantics = resolveMetricSummarySemantics(
      response.query.dataType,
      response.query.categoryType,
    );
    const cards: InsightSummaryCard[] = [
      {
        label: 'Activities',
        value: new Intl.NumberFormat(locale || undefined).format(response.summary.matchedEventCount),
        ...buildActivityMixDetails(response, locale),
      },
    ];

    const overallValue = formatSummaryValue(
      response.query.dataType,
      response.summary.overallAggregateValue,
      unitSettings,
    );
    if (overallValue) {
      cards.unshift({
        label: 'Overall',
        value: overallValue,
      });
    }

    if (response.summary.peakBucket) {
      const peakValue = formatSummaryValue(
        response.query.dataType,
        response.summary.peakBucket.aggregateValue,
        unitSettings,
      );
      if (peakValue) {
        cards.push({
          label: summarySemantics.highestLabel,
          value: peakValue,
          meta: formatBucketMeta(response, response.summary.peakBucket, locale) || undefined,
          helpText: summarySemantics.highestHelpText,
        });
      }
    }

    if (response.summary.lowestBucket) {
      const lowestValue = formatSummaryValue(
        response.query.dataType,
        response.summary.lowestBucket.aggregateValue,
        unitSettings,
      );
      if (lowestValue) {
        cards.push({
          label: summarySemantics.lowestLabel,
          value: lowestValue,
          meta: formatBucketMeta(response, response.summary.lowestBucket, locale) || undefined,
          helpText: summarySemantics.lowestHelpText,
        });
      }
    }

    if (response.summary.latestBucket) {
      const latestValue = formatSummaryValue(
        response.query.dataType,
        response.summary.latestBucket.aggregateValue,
        unitSettings,
      );
      if (latestValue) {
        cards.push({
          label: summarySemantics.latestLabel,
          value: latestValue,
          meta: formatBucketMeta(response, response.summary.latestBucket, locale) || undefined,
          helpText: summarySemantics.latestHelpText,
        });
      }
    }

    const coverageValue = formatCoverageValue(response);
    if (coverageValue) {
      cards.push({
        label: 'Coverage',
        value: coverageValue,
        helpText: 'How many chart periods in the requested range contained matching data.',
      });
    }

    const trendValue = formatTrendValue(response, unitSettings);
    if (trendValue && response.summary.trend) {
      cards.push({
        label: 'Trend',
        value: trendValue,
        meta: formatBucketMeta(response, response.summary.trend.previousBucket, locale)
          ? `vs ${formatBucketMeta(response, response.summary.trend.previousBucket, locale)}`
          : undefined,
        helpText: 'Difference between the latest period with data and the previous period with data.',
      });
    }

    return cards;
  });

  onFormSubmit(event: SubmitEvent | Event): void {
    event.preventDefault();
    this.logAiInsightsAction('ask_button_click', {
      promptLength: this.promptControl.getRawValue().trim().length,
    });
    void this.submitPrompt();
  }

  async submitPrompt(promptOverride?: string): Promise<void> {
    const prompt = `${promptOverride ?? this.promptControl.getRawValue()}`.trim();
    if (!prompt) {
      this.promptControl.markAsTouched();
      return;
    }

    if (prompt !== this.promptControl.getRawValue()) {
      this.promptControl.setValue(prompt);
    }

    this.isSubmitting.set(true);
    this.latestSnapshotRestored.set(false);
    this.latestSnapshotPersistenceNotice.set(null);
    this.errorMessage.set(null);
    this.response.set(null);

    try {
      const response = await this.aiInsightsService.runInsight(this.buildInsightRequest(prompt));
      this.response.set(response);
      const userID = this.currentUserID();
      if (userID) {
        const saveResult = await this.aiInsightsLatestSnapshotService.saveLatest(userID, prompt, response);
        if (saveResult === 'skipped_too_large') {
          this.latestSnapshotPersistenceNotice.set(
            'This result is too large to save to your account yet, so a refresh will lose it.',
          );
        }
      }
    } catch (error) {
      this.errorMessage.set(this.aiInsightsService.getErrorMessage(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async applySuggestedPrompt(prompt: string, options: { logAnalytics?: boolean } = {}): Promise<void> {
    if (options.logAnalytics !== false) {
      const promptAnalytics = this.resolvePromptAnalytics(prompt);
      this.logAiInsightsAction('suggested_prompt_select', {
        promptIndex: promptAnalytics.promptIndex,
        promptSource: promptAnalytics.promptSource,
        promptLength: prompt.trim().length,
      });
    }
    this.promptControl.setValue(prompt);
    await this.submitPrompt(prompt);
  }

  async onHeroPromptClick(): Promise<void> {
    const prompt = this.activeHeroPrompt().trim();
    if (!prompt || this.isSubmitting()) {
      return;
    }

    const promptAnalytics = this.resolvePromptAnalytics(prompt);
    this.logAiInsightsAction('hero_prompt_click', {
      promptIndex: promptAnalytics.promptIndex,
      promptSource: promptAnalytics.promptSource,
      promptLength: prompt.length,
    });
    await this.applySuggestedPrompt(prompt, { logAnalytics: false });
  }

  clearPrompt(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.promptControl.setValue('');
    this.promptControl.markAsPristine();
    this.promptControl.markAsUntouched();
  }

  private logAiInsightsAction(
    method: string,
    params: {
      promptIndex?: number;
      promptLength?: number;
      promptSource?: 'default' | 'unsupported';
    } = {},
  ): void {
    const eventParams = Object.fromEntries(
      Object.entries({
        method,
        prompt_index: params.promptIndex,
        prompt_length: params.promptLength,
        prompt_source: params.promptSource,
      }).filter(([, value]) => value !== undefined),
    );

    this.analyticsService.logEvent('ai_insights_action', eventParams);
  }

  private resolvePromptAnalytics(prompt: string): {
    promptIndex: number | undefined;
    promptSource: 'default' | 'unsupported';
  } {
    const prompts = [...this.suggestedPrompts()] as string[];
    const promptIndex = prompts.indexOf(prompt);

    return {
      promptIndex: promptIndex >= 0 ? promptIndex : undefined,
      promptSource: this.unsupportedResponse()?.suggestedPrompts?.length ? 'unsupported' : 'default',
    };
  }

  private buildInsightRequest(prompt: string): AiInsightsRequest {
    return {
      prompt,
      clientTimezone: getClientTimeZone(),
      clientLocale: this.locale,
    };
  }
}
