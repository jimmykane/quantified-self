import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, LOCALE_ID, NgZone, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AppThemes,
  User,
} from '@sports-alliance/sports-lib';
import type {
  AiInsightsAggregateOkResponse,
  AiInsightsEmptyResponse,
  AiInsightsEventLookupOkResponse,
  AiInsightsLatestEventOkResponse,
  AiInsightsMultiMetricAggregateOkResponse,
  AiInsightsOkResponse,
  AiInsightsQuotaStatus,
  AiInsightsRequest,
  AiInsightsResponse,
  AiInsightsUnsupportedResponse,
} from '@shared/ai-insights.types';
import { resolveAiInsightsActivityFilterSummary } from '@shared/ai-insights-activity-filter';
import { formatUnitAwareDataValue, normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { AppAuthService } from '../../authentication/app.auth.service';
import { MaterialModule } from '../../modules/material.module';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppEventService } from '../../services/app.event.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AiInsightsLatestSnapshotService } from '../../services/ai-insights-latest-snapshot.service';
import { AiInsightsQuotaService } from '../../services/ai-insights-quota.service';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { AiInsightsService } from '../../services/ai-insights.service';
import { LoggerService } from '../../services/logger.service';
import { resolveAiInsightsDisplayTitle } from '../../helpers/ai-insights-title.helper';
import { AiInsightsChartComponent } from './ai-insights-chart.component';
import { AiInsightsLoadingStateComponent } from './ai-insights-loading-state.component';
import { AiInsightsMultiMetricChartComponent } from './ai-insights-multi-metric-chart.component';
import { AiInsightsPromptPickerDialogComponent } from './ai-insights-prompt-picker-dialog.component';
import {
  buildAggregateSummaryCards,
  buildMergedMultiMetricSummaryCards,
  formatDateRangeNote,
  formatDateSelectionSummary,
  formatEventLookupActivityLabel,
  formatEventLookupEventDate,
  formatQuotaStatusText,
  formatSavedInsightDate,
  getClientTimeZone,
  hasAggregateEventRanking,
  resolveAggregationLabel,
  resolveEventLookupStatValue,
  resolveQuotaBlockedMessage,
  resolveRankedEventIds,
  resolveRankedEventMatchedCount,
  resolveRankedEventPrimaryLabel,
  resolveRankedEventRankingCopy,
  resolveRankedEventSectionTitle,
  resolveResultCardSubtitle,
  resolveShortMetricLabel,
  type EventLookupDisplayItem,
  type EventLookupResolvedEvent,
  type InsightSummaryCard,
  type MultiMetricSection,
  type RankedEventResponse,
  type ResultNote,
} from './ai-insights-page.helpers';
import {
  AI_INSIGHTS_DEFAULT_PICKER_PROMPTS,
  AI_INSIGHTS_FEATURED_PROMPTS,
  resolveAiInsightsPromptSections,
  type AiInsightsPromptGroup,
  type AiInsightsPromptSection,
} from './ai-insights.prompts';

const HERO_PROMPT_TYPING_DELAY_MS = 38;
const HERO_PROMPT_DELETING_DELAY_MS = 20;
const HERO_PROMPT_HOLD_DELAY_MS = 1900;
const HERO_PROMPT_BETWEEN_PROMPTS_DELAY_MS = 280;
const AI_INSIGHTS_GENERATION_LOADING_STEPS = [
  'Parsing prompt',
  'Fetching matching events',
  'Computing metrics and buckets',
  'Preparing summary and chart',
  'Finalizing AI narrative',
] as const;
const AI_INSIGHTS_EVENT_LOOKUP_LOADING_STEPS = [
  'Finding the winning event',
  'Loading top ranked matches',
  'Preparing event shortcuts',
] as const;
const AI_INSIGHTS_GENERATION_LOADING_STEP_DELAY_MS = 1450;
const AI_INSIGHTS_PROCESSING_HAPTIC_DELAY_MS = 150;
const AI_INSIGHTS_LOADING_SUMMARY_SKELETON_ITEMS = [0, 1, 2, 3] as const;
const AI_INSIGHTS_LOADING_CHART_SKELETON_BARS = [
  '46%',
  '62%',
  '34%',
  '78%',
  '56%',
  '88%',
] as const;

@Component({
  selector: 'app-ai-insights-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    MaterialModule,
    AiInsightsChartComponent,
    AiInsightsLoadingStateComponent,
    AiInsightsMultiMetricChartComponent,
  ],
  templateUrl: './ai-insights-page.component.html',
  styleUrls: ['./ai-insights-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiInsightsPageComponent {
  private readonly authService = inject(AppAuthService);
  private readonly analyticsService = inject(AppAnalyticsService);
  private readonly eventService = inject(AppEventService);
  private readonly hapticsService = inject(AppHapticsService);
  private readonly aiInsightsService = inject(AiInsightsService);
  private readonly aiInsightsLatestSnapshotService = inject(AiInsightsLatestSnapshotService);
  private readonly aiInsightsQuotaService = inject(AiInsightsQuotaService);
  private readonly themeService = inject(AppThemeService);
  private readonly userSettingsQueryService = inject(AppUserSettingsQueryService);
  private readonly logger = inject(LoggerService);
  private readonly dialog = inject(MatDialog);
  // These animation loops are intentionally isolated from Angular's zone because
  // they are pure cosmetic timers for the hero prompt typing and the loading-step
  // progression. Keeping the timeout chains outside Angular avoids a full
  // change-detection pass on every tick while still letting the signal writes
  // themselves notify the template. A signal-only clock or setInterval would still
  // need the same scheduling edge; this keeps the Zone.js coupling narrow.
  private readonly ngZone = inject(NgZone);
  private readonly locale = inject(LOCALE_ID);
  private processingHapticTimer: ReturnType<typeof setTimeout> | null = null;

  readonly promptControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  readonly promptValue = toSignal(this.promptControl.valueChanges, {
    initialValue: this.promptControl.getRawValue(),
  });
  readonly isSubmitting = signal(false);
  readonly isRestoringLatestSnapshot = signal(false);
  readonly response = signal<AiInsightsResponse | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly latestSnapshotRestored = signal(false);
  readonly latestSnapshotPersistenceNotice = signal<string | null>(null);
  readonly latestSnapshotSavedAt = signal<string | null>(null);
  readonly quotaStatus = signal<AiInsightsQuotaStatus | null>(null);
  readonly quotaStatusLoadFailed = signal(false);
  readonly resultPrompt = signal('');
  readonly rankedEventResolvedEvents = signal<EventLookupResolvedEvent[]>([]);
  readonly rankedEventLoading = signal(false);
  readonly rankedEventLoadError = signal<string | null>(null);
  readonly appTheme = this.themeService.appTheme;
  readonly user = toSignal(this.authService.user$, { initialValue: null });
  readonly chartSettings = this.userSettingsQueryService.chartSettings;
  readonly userUnitSettings = computed(() =>
    normalizeUserUnitSettings(this.userSettingsQueryService.unitSettings())
  );
  readonly promptPlaceholder = AI_INSIGHTS_FEATURED_PROMPTS[0] ?? 'Show my total distance by activity type this year.';
  readonly currentUserID = computed(() => this.user()?.uid ?? null);
  readonly isDarkTheme = computed(() => this.appTheme() === AppThemes.Dark);
  readonly useAnimations = computed(() => this.chartSettings().useAnimations ?? false);
  readonly generationLoadingSteps = AI_INSIGHTS_GENERATION_LOADING_STEPS;
  readonly eventLookupLoadingSteps = AI_INSIGHTS_EVENT_LOOKUP_LOADING_STEPS;
  readonly loadingSummarySkeletonItems = AI_INSIGHTS_LOADING_SUMMARY_SKELETON_ITEMS;
  readonly loadingChartSkeletonBars = AI_INSIGHTS_LOADING_CHART_SKELETON_BARS;
  readonly generationLoadingStepIndex = signal(0);
  readonly generationLoadingActiveStep = computed(() => (
    this.generationLoadingSteps[
      Math.min(this.generationLoadingStepIndex(), this.generationLoadingSteps.length - 1)
    ] ?? ''
  ));
  readonly generationLoadingProgressLabel = computed(() => {
    const totalSteps = this.generationLoadingSteps.length;
    const currentStep = Math.min(this.generationLoadingStepIndex() + 1, totalSteps);
    return `${currentStep}/${totalSteps}`;
  });
  readonly generationLoadingRollerTransform = computed(() => (
    `translateY(calc(-1 * ${this.generationLoadingStepIndex()} * var(--ai-insights-loading-roller-row-height, 32px)))`
  ));
  readonly isPromptLocked = computed(() => (
    this.isSubmitting() || this.isRestoringLatestSnapshot()
  ));
  readonly hasQuotaAvailable = computed(() => {
    const quotaStatus = this.quotaStatus();
    if (!quotaStatus) {
      return true;
    }

    return quotaStatus.isEligible && quotaStatus.remainingCount > 0;
  });
  readonly canSubmit = computed(() =>
    !this.isPromptLocked()
    && this.promptValue().trim().length > 0
    && this.hasQuotaAvailable()
  );
  readonly okResponse = computed<AiInsightsOkResponse | null>(() => {
    const response = this.response();
    return response?.status === 'ok' ? response : null;
  });
  readonly aggregateOkResponse = computed<AiInsightsAggregateOkResponse | null>(() => {
    const response = this.okResponse();
    return response?.resultKind === 'aggregate' ? response : null;
  });
  readonly multiMetricOkResponse = computed<AiInsightsMultiMetricAggregateOkResponse | null>(() => {
    const response = this.okResponse();
    return response?.resultKind === 'multi_metric_aggregate' ? response : null;
  });
  readonly eventLookupOkResponse = computed<AiInsightsEventLookupOkResponse | null>(() => {
    const response = this.okResponse();
    return response?.resultKind === 'event_lookup' ? response : null;
  });
  readonly latestEventOkResponse = computed<AiInsightsLatestEventOkResponse | null>(() => {
    const response = this.okResponse();
    return response?.resultKind === 'latest_event' ? response : null;
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
  readonly canRefreshResult = computed(() => {
    if (this.isPromptLocked()) {
      return false;
    }

    const response = this.response();
    const hasRefreshableResult = response?.status === 'ok' || response?.status === 'empty';
    return hasRefreshableResult
      && this.resultPrompt().trim().length > 0
      && this.hasQuotaAvailable();
  });
  readonly latestSnapshotSupportNote = computed(() => {
    return 'Latest completed insights are temporarily restored from your account. Proper saved insights/history will come later.';
  });
  readonly resultCardSubtitle = computed(() => {
    const response = this.okResponse() ?? this.emptyResponse();
    return resolveResultCardSubtitle(response);
  });
  readonly resultCardMetaText = computed(() => {
    const savedAtLabel = formatSavedInsightDate(this.latestSnapshotSavedAt(), this.locale);
    if (!savedAtLabel) {
      return this.latestSnapshotRestored() ? 'Restored' : null;
    }

    return this.latestSnapshotRestored()
      ? `Restored • Saved ${savedAtLabel}`
      : `Saved ${savedAtLabel}`;
  });
  readonly resultNotes = computed<ResultNote[]>(() => {
    if (!this.hasCompletedResponse()) {
      return [];
    }

    const notes: ResultNote[] = [];
    if (this.latestSnapshotPersistenceNotice()) {
      notes.push({
        icon: 'info',
        message: this.latestSnapshotPersistenceNotice() as string,
      });
    }
    return notes;
  });
  private readonly generationLoadingAnimation = effect((onCleanup) => {
    const isSubmitting = this.isSubmitting();
    this.generationLoadingStepIndex.set(0);

    if (!isSubmitting || this.generationLoadingSteps.length < 2) {
      return;
    }

    let activeStepIndex = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (): void => {
      if (activeStepIndex >= this.generationLoadingSteps.length - 1) {
        return;
      }

      this.ngZone.runOutsideAngular(() => {
        timer = setTimeout(() => {
          activeStepIndex += 1;
          this.generationLoadingStepIndex.set(activeStepIndex);
          schedule();
        }, AI_INSIGHTS_GENERATION_LOADING_STEP_DELAY_MS);
      });
    };

    schedule();

    onCleanup(() => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    });
  });
  private readonly promptAvailabilityEffect = effect(() => {
    if (this.isPromptLocked()) {
      this.promptControl.disable({ emitEvent: false });
      return;
    }

    this.promptControl.enable({ emitEvent: false });
  });
  readonly quotaStatusText = computed(() => {
    const quotaStatus = this.quotaStatus();
    if (!quotaStatus) {
      return null;
    }

    return formatQuotaStatusText(quotaStatus, this.locale);
  });
  readonly promptHeaderQuotaText = computed(() => (
    this.quotaStatusText()
    ?? (
      this.isRestoringLatestSnapshot() && !this.quotaStatusLoadFailed()
        ? 'Loading quota…'
        : 'Quota unavailable'
    )
  ));
  readonly quotaBlockedMessage = computed(() => {
    const quotaStatus = this.quotaStatus();
    if (!quotaStatus || (quotaStatus.isEligible && quotaStatus.remainingCount > 0)) {
      return null;
    }

    return resolveQuotaBlockedMessage(quotaStatus);
  });
  readonly activeHeroPrompt = signal(AI_INSIGHTS_FEATURED_PROMPTS[0] ?? '');
  readonly typedHeroPrompt = signal((AI_INSIGHTS_FEATURED_PROMPTS[0] ?? '').slice(0, 1));
  readonly pickerPromptSource = computed<'default' | 'unsupported'>(() => {
    const unsupportedResponse = this.unsupportedResponse();
    return unsupportedResponse?.suggestedPrompts?.length ? 'unsupported' : 'default';
  });
  readonly pickerPromptSections = computed<readonly AiInsightsPromptSection[]>(() => {
    const unsupportedResponse = this.unsupportedResponse();
    return resolveAiInsightsPromptSections(unsupportedResponse?.suggestedPrompts);
  });
  readonly pickerPromptGroups = computed<readonly AiInsightsPromptGroup[]>(() => {
    return this.pickerPromptSections().flatMap((section) => section.groups);
  });
  readonly pickerPrompts = computed(() => (
    Array.from(new Set(
      this.pickerPromptSections().flatMap((section) => (
        section.groups.flatMap((group) => group.prompts.map((prompt) => prompt.prompt))
      )),
    ))
  ));
  readonly promptPickerTitle = computed(() => (
    this.pickerPromptSource() === 'unsupported'
      ? 'Try one of these prompts'
      : 'Browse prompts'
  ));
  readonly promptPickerButtonLabel = computed(() => (
    this.pickerPromptSource() === 'unsupported'
      ? 'Try supported prompts'
      : 'Browse prompts'
  ));
  readonly promptPickerButtonTooltip = computed(() => (
    this.pickerPromptSource() === 'unsupported'
      ? 'Browse supported prompt examples'
      : 'Browse prompt examples'
  ));
  private readonly heroPromptAnimation = effect((onCleanup) => {
    const prompts = AI_INSIGHTS_FEATURED_PROMPTS.filter(prompt => prompt.trim().length > 0);
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
      // The timer is the only integration edge that lives outside Angular; the
      // rest of the animation stays signal-driven inside the component state.
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
    this.latestSnapshotSavedAt.set(null);
    this.isRestoringLatestSnapshot.set(false);
    this.quotaStatus.set(null);
    this.quotaStatusLoadFailed.set(false);
    this.errorMessage.set(null);
    this.response.set(null);
    this.resultPrompt.set('');
    this.rankedEventResolvedEvents.set([]);
    this.rankedEventLoading.set(false);
    this.rankedEventLoadError.set(null);
    this.promptControl.setValue('');

    if (!userID) {
      return;
    }

    void (async () => {
      this.isRestoringLatestSnapshot.set(true);

      try {
        const [latestSnapshot, quotaStatusResult] = await Promise.all([
          this.aiInsightsLatestSnapshotService.loadLatest(userID),
          this.aiInsightsQuotaService
            .loadQuotaStatus()
            .then((quotaStatus) => ({ quotaStatus, error: null as unknown }))
            .catch((error: unknown) => ({ quotaStatus: null, error })),
        ]);
        if (cancelled) {
          return;
        }

        if (quotaStatusResult.error) {
          this.logger.warn('[AiInsightsPageComponent] Failed to load AI insights quota status.', quotaStatusResult.error);
          this.quotaStatus.set(null);
          this.quotaStatusLoadFailed.set(true);
        } else {
          this.quotaStatus.set(quotaStatusResult.quotaStatus);
          this.quotaStatusLoadFailed.set(false);
        }
        if (!latestSnapshot) {
          return;
        }

        this.promptControl.setValue(latestSnapshot.prompt);
        this.response.set(latestSnapshot.response);
        this.resultPrompt.set(latestSnapshot.prompt);
        this.latestSnapshotSavedAt.set(latestSnapshot.savedAt);
        this.latestSnapshotRestored.set(true);
      } finally {
        if (!cancelled) {
          this.isRestoringLatestSnapshot.set(false);
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });
  readonly rankedEventResponse = computed<RankedEventResponse | null>(() => {
    const latestEventResponse = this.latestEventOkResponse();
    if (latestEventResponse) {
      return latestEventResponse;
    }

    const eventLookupResponse = this.eventLookupOkResponse();
    if (eventLookupResponse) {
      return eventLookupResponse;
    }

    const aggregateResponse = this.aggregateOkResponse();
    return hasAggregateEventRanking(aggregateResponse) ? aggregateResponse : null;
  });
  private readonly rankedEventLoadEffect = effect((onCleanup) => {
    const response = this.rankedEventResponse();
    const userID = this.currentUserID();
    let cancelled = false;

    this.rankedEventResolvedEvents.set([]);
    this.rankedEventLoading.set(false);
    this.rankedEventLoadError.set(null);

    if (!response || !userID) {
      return;
    }

    const topEventIds = resolveRankedEventIds(response);
    if (!topEventIds.length) {
      return;
    }

    this.rankedEventLoading.set(true);

    void (async () => {
      try {
        const events = await firstValueFrom(
          this.eventService.getEventsOnceByIds(new User(userID), topEventIds),
        );
        if (cancelled) {
          return;
        }

        const eventsById = new Map(events.map(event => [event.getID(), event]));
        this.rankedEventResolvedEvents.set(topEventIds.map(eventId => ({
          eventId,
          event: eventsById.get(eventId) ?? null,
        })));
      } catch (error) {
        if (cancelled) {
          return;
        }

        this.logger.error('[AiInsightsPageComponent] Failed to load event lookup details.', {
          userID,
          eventIds: topEventIds,
          error,
        });
        this.rankedEventResolvedEvents.set(topEventIds.map(eventId => ({ eventId, event: null })));
        this.rankedEventLoadError.set('Could not load event details right now.');
      } finally {
        if (!cancelled) {
          this.rankedEventLoading.set(false);
        }
      }
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

    return `${formatDateSelectionSummary(response, this.locale)} • ${resolveAiInsightsActivityFilterSummary(response.query)}`;
  });
  readonly resultDisplayTitle = computed(() => {
    const response = this.okResponse() || this.emptyResponse();
    if (!response) {
      return null;
    }

    const metricLabels = this.multiMetricOkResponse()?.metricResults.map(metricResult => metricResult.metricLabel);
    return resolveAiInsightsDisplayTitle(response, {
      metricLabels,
    }) ?? response.presentation.title;
  });
  readonly resultCardHeaderTitle = computed(() => (
    this.resultDisplayTitle() ?? 'Result'
  ));
  readonly resultCardHeaderSubtitle = computed(() => (
    this.aggregationContextLine()
  ));
  readonly aggregationContextLine = computed(() => {
    const response = this.aggregateOkResponse() || this.multiMetricOkResponse() || this.emptyResponse();
    if (!response) {
      return null;
    }

    const valueType = response.query.resultKind === 'multi_metric_aggregate'
      ? response.query.metricSelections[0]?.valueType
      : response.query.resultKind === 'latest_event'
        ? null
      : response.query.valueType;
    if (!valueType) {
      return this.resultSubtitle();
    }

    return `Aggregation: ${resolveAggregationLabel(valueType)} • ${this.resultSubtitle()}`;
  });
  readonly resultDateRangeNote = computed(() => {
    const response = this.okResponse() || this.emptyResponse();
    if (!response) {
      return null;
    }

    return formatDateRangeNote(response.query.dateRange);
  });
  readonly resultWarnings = computed(() => (
    this.aggregateOkResponse()?.presentation.warnings
    ?? this.multiMetricOkResponse()?.presentation.warnings
    ?? []
  ));
  readonly resultSummaryCards = computed<InsightSummaryCard[]>(() => {
    const response = this.aggregateOkResponse();
    if (!response) {
      return [];
    }

    return buildAggregateSummaryCards(response, this.userUnitSettings(), this.locale);
  });
  readonly multiMetricSections = computed<MultiMetricSection[]>(() => {
    const response = this.multiMetricOkResponse();
    if (!response) {
      return [];
    }

    const unitSettings = this.userUnitSettings();
    const locale = this.locale;
    const metricSelectionsByKey = new Map(
      response.query.metricSelections.map((selection) => [selection.metricKey, selection] as const),
    );

    return response.metricResults.map((metricResult) => ({
      metricKey: metricResult.metricKey,
      title: (() => {
        const metricSelection = metricSelectionsByKey.get(metricResult.metricKey);
        return resolveShortMetricLabel(
          metricSelection?.dataType ?? metricResult.metricLabel,
          metricSelection?.valueType ?? metricResult.query.valueType,
        );
      })(),
      summaryCards: buildAggregateSummaryCards(metricResult, unitSettings, locale),
      isEmpty: metricResult.aggregation.buckets.length === 0,
      emptyState: (() => {
        const metricSelection = metricSelectionsByKey.get(metricResult.metricKey);
        const metricLabel = resolveShortMetricLabel(
          metricSelection?.dataType ?? metricResult.metricLabel,
          metricSelection?.valueType ?? metricResult.query.valueType,
        );
        return `No matching ${metricLabel} data was found for this result scope.`;
      })(),
    }));
  });
  readonly multiMetricMergedSummaryCards = computed<InsightSummaryCard[]>(() => (
    buildMergedMultiMetricSummaryCards(this.multiMetricSections())
  ));
  readonly multiMetricEmptySections = computed<MultiMetricSection[]>(() => (
    this.multiMetricSections().filter(section => section.isEmpty)
  ));
  readonly multiMetricChartVisible = computed(() => {
    const response = this.multiMetricOkResponse();
    return !!response
      && response.query.groupingMode === 'date'
      && response.metricResults.some(metricResult => metricResult.aggregation.buckets.length > 0);
  });
  readonly rankedEventItems = computed<EventLookupDisplayItem[]>(() => {
    const response = this.rankedEventResponse();
    if (!response) {
      return [];
    }

    const locale = this.locale;
    const unitSettings = this.userUnitSettings();
    const resolvedEvents = this.rankedEventResolvedEvents();

    return resolveRankedEventIds(response).map((eventId) => {
      const event = resolvedEvents.find(entry => entry.eventId === eventId)?.event ?? null;
      const value = response.resultKind === 'latest_event'
        ? 'Most recent in range'
        : (() => {
          const rawValue = resolveEventLookupStatValue(event, response.query.dataType);
          return rawValue === null
            ? 'Unavailable'
            : (formatUnitAwareDataValue(response.query.dataType, rawValue, unitSettings, {
              stripRepeatedUnit: true,
            }) ?? 'Unavailable');
        })();
      const date = formatEventLookupEventDate(event, locale, response.query.dateRange.timezone) ?? 'Event unavailable';
      const isAvailable = response.resultKind === 'latest_event'
        ? !!event
        : (() => {
          const rawValue = resolveEventLookupStatValue(event, response.query.dataType);
          return !!event && rawValue !== null;
        })();

      return {
        eventId,
        value,
        date,
        activityLabel: formatEventLookupActivityLabel(event),
        isAvailable,
      };
    });
  });
  readonly primaryRankedEventItem = computed<EventLookupDisplayItem | null>(() =>
    this.rankedEventItems()[0] ?? null
  );
  readonly rankedEventPrimaryLabel = computed(() => {
    const response = this.rankedEventResponse();
    return response ? resolveRankedEventPrimaryLabel(response) : null;
  });
  readonly rankedEventSectionTitle = computed(() => {
    const response = this.rankedEventResponse();
    return response ? resolveRankedEventSectionTitle(response) : null;
  });
  readonly rankedEventRankingCopy = computed(() => {
    const response = this.rankedEventResponse();
    if (!response) {
      return null;
    }

    const shownCount = resolveRankedEventIds(response).length;
    const matchedCount = resolveRankedEventMatchedCount(response);
    return resolveRankedEventRankingCopy(response, shownCount, matchedCount);
  });

  onFormSubmit(event: SubmitEvent | Event): void {
    event.preventDefault();
    this.logAiInsightsAction('ask_button_click', {
      promptLength: this.promptControl.getRawValue().trim().length,
    });
    void this.submitPrompt();
  }

  async submitPrompt(promptOverride?: string): Promise<void> {
    if (this.isPromptLocked()) {
      return;
    }

    const prompt = `${promptOverride ?? this.promptControl.getRawValue()}`.trim();
    if (!prompt) {
      this.promptControl.markAsTouched();
      return;
    }

    if (prompt !== this.promptControl.getRawValue()) {
      this.promptControl.setValue(prompt);
    }

    const quotaStatus = this.quotaStatus();
    if (quotaStatus && (!quotaStatus.isEligible || quotaStatus.remainingCount <= 0)) {
      this.errorMessage.set(resolveQuotaBlockedMessage(quotaStatus));
      return;
    }

    this.hapticsService.selection();
    this.isSubmitting.set(true);
    this.scheduleProcessingHaptic();
    this.latestSnapshotRestored.set(false);
    this.latestSnapshotPersistenceNotice.set(null);
    this.latestSnapshotSavedAt.set(null);
    this.errorMessage.set(null);
    this.response.set(null);

    try {
      const response = await this.aiInsightsService.runInsight(this.buildInsightRequest(prompt));
      this.response.set(response);
      this.hapticsService.success();
      this.quotaStatus.set(response.quota ?? this.quotaStatus());
      this.resultPrompt.set(prompt);
    } catch (error) {
      const nextQuotaStatus = await this.aiInsightsQuotaService.loadQuotaStatus();
      if (nextQuotaStatus) {
        this.quotaStatus.set(nextQuotaStatus);
      }
      this.errorMessage.set(this.aiInsightsService.getErrorMessage(error));
    } finally {
      this.clearProcessingHaptic();
      this.isSubmitting.set(false);
    }
  }

  async openPromptPicker(): Promise<void> {
    if (this.isPromptLocked() || !this.hasQuotaAvailable()) {
      return;
    }

    const promptSource = this.pickerPromptSource();
    const dialogRef = this.dialog.open(AiInsightsPromptPickerDialogComponent, {
      autoFocus: false,
      maxWidth: '44rem',
      width: 'calc(100vw - 32px)',
      data: {
        promptSections: this.pickerPromptSections(),
        promptSource,
      },
    });
    const prompt = await firstValueFrom(dialogRef.afterClosed());
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return;
    }

    await this.applySuggestedPrompt(prompt, { promptSource });
  }

  async applySuggestedPrompt(
    prompt: string,
    options: {
      logAnalytics?: boolean;
      promptSource?: 'default' | 'unsupported';
    } = {},
  ): Promise<void> {
    if (this.isPromptLocked() || !this.hasQuotaAvailable()) {
      return;
    }

    if (options.logAnalytics !== false) {
      const promptAnalytics = this.resolvePromptAnalytics(prompt, options.promptSource);
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
    if (!prompt || this.isPromptLocked() || !this.hasQuotaAvailable()) {
      return;
    }

    const promptAnalytics = this.resolvePromptAnalytics(prompt, 'default');
    this.logAiInsightsAction('hero_prompt_click', {
      promptIndex: promptAnalytics.promptIndex,
      promptSource: promptAnalytics.promptSource,
      promptLength: prompt.length,
    });
    await this.applySuggestedPrompt(prompt, { logAnalytics: false });
  }

  async refreshCurrentResult(): Promise<void> {
    const prompt = this.resultPrompt().trim();
    if (!prompt || !this.canRefreshResult()) {
      return;
    }

    this.logAiInsightsAction('refresh_result_click', {
      promptLength: prompt.length,
    });
    await this.submitPrompt(prompt);
  }

  clearPrompt(): void {
    if (this.isPromptLocked()) {
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

  private resolvePromptAnalytics(
    prompt: string,
    promptSource: 'default' | 'unsupported' = this.pickerPromptSource(),
  ): {
    promptIndex: number | undefined;
    promptSource: 'default' | 'unsupported';
  } {
    const prompts = promptSource === 'unsupported'
      ? [...this.pickerPrompts()]
      : [...AI_INSIGHTS_DEFAULT_PICKER_PROMPTS];
    const promptIndex = prompts.indexOf(prompt);

    return {
      promptIndex: promptIndex >= 0 ? promptIndex : undefined,
      promptSource,
    };
  }

  private buildInsightRequest(prompt: string): AiInsightsRequest {
    return {
      prompt,
      clientTimezone: getClientTimeZone(),
      clientLocale: this.locale,
    };
  }

  private scheduleProcessingHaptic(): void {
    this.clearProcessingHaptic();
    this.ngZone.runOutsideAngular(() => {
      this.processingHapticTimer = setTimeout(() => {
        this.processingHapticTimer = null;
        if (this.isSubmitting()) {
          this.hapticsService.selection();
        }
      }, AI_INSIGHTS_PROCESSING_HAPTIC_DELAY_MS);
    });
  }

  private clearProcessingHaptic(): void {
    if (this.processingHapticTimer === null) {
      return;
    }

    clearTimeout(this.processingHapticTimer);
    this.processingHapticTimer = null;
  }
}
