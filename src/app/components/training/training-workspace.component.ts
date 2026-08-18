import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Inject, InjectionToken, LOCALE_ID, NgZone, OnDestroy, OnInit, Optional, Signal, TemplateRef, ViewChild, computed, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppThemes, DataAscent, DataAvgStrokeDistance, DataDistance, DataJumpDistance, DataSwimDistance, SwimPaceUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppAuthService } from '../../authentication/app.auth.service';
import type {
  DashboardTrainingBuildComparisonDiscipline,
  DashboardTrainingBuildWindow,
  DashboardTrainingDisciplineSummary,
  DashboardTrainingRecoveryComparison,
  DashboardTrainingRecoveryWindow,
} from '../../helpers/dashboard-derived-metrics.helper';
import {
  resolveDashboardFormNowContextFromPoints,
  resolveDashboardRampRateContextFromPoints,
} from '../../helpers/dashboard-derived-metrics.helper';
import { buildCurrentTrainingStateContext } from '../../helpers/current-training-state.helper';
import { resolveDashboardChartInfoTooltip } from '../../helpers/dashboard-chart-info.helper';
import {
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
} from '../../helpers/dashboard-special-chart-types';
import {
  buildTrainingCapacityViewModels,
  type TrainingCapacityDisciplineViewModel,
} from '../../helpers/training-capacity.helper';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { resolveMetricSemantics, type MetricSemanticsDirection } from '@shared/metric-semantics';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_TRAINING_RECOVERY_MIN_HRV_NIGHTS,
  DERIVED_TRAINING_RECOVERY_MIN_REGULARITY_NIGHTS,
  getDerivedTrainingRecoveryMinimumComparableNights,
  getTrainingBuildBenchmarkSelectionKey,
  isTrainingVisibleDiscipline,
  TRAINING_VISIBLE_DISCIPLINES,
  type DerivedTrainingDiscipline,
  type TrainingBuildBenchmarkSelection,
  type TrainingSettings,
  type TrainingVisibleDiscipline,
} from '@shared/derived-metrics';
import {
  createTrainingSportRecord,
  getTrainingProfileMetricDefinition,
  getTrainingSportContextDefinition,
  getTrainingSportDefinition,
  hasTrainingSportCapability,
  isTrainingDiscipline,
  normalizeTrainingDestinationId,
  TRAINING_DISCIPLINES,
  TRAINING_SPORT_DEFINITIONS,
  type TrainingDestinationId,
  type TrainingProfileMetricId,
  type TrainingSportCapability,
  type TrainingSportContextDefinition,
  type TrainingSportContextId,
  type TrainingSportDefinition,
} from '@shared/training-disciplines';
import {
  buildDashboardPowerCurveContextFromSnapshot,
  type DashboardPowerCurveContext,
} from '../../helpers/dashboard-power-curve.helper';
import {
  buildDashboardSleepTrendContext,
  formatSleepDuration,
} from '../../helpers/dashboard-sleep-chart.helper';
import {
  buildDashboardReadinessSleepQueryWindow,
  buildDashboardReadinessSignalsContext,
  resolveDashboardReadinessSleepRefreshAtMs,
} from '../../helpers/dashboard-training-insights.helper';
import {
  buildTrainingReadinessViewModel,
  type TrainingReadinessViewModel,
} from '../../helpers/training-readiness.helper';
import {
  buildTrainingBodyWeightViewModel,
  type TrainingBodyWeightViewModel,
} from '../../helpers/training-body-weight.helper';
import {
  isDerivedMetricPendingStatus,
  resolveDerivedMetricsRefreshPhase,
} from '../../helpers/derived-metric-status.helper';
import {
  buildTrainingAnalysis,
  type TrainingAnalysis,
  type TrainingComparisonState,
  type TrainingWindowComparison,
  resolveTrainingComparisonState,
} from '../../helpers/training-analysis.helper';
import { buildTrainingStateInfo, type TrainingStateInfo } from '../../helpers/training-state.helper';
import {
  RECOVERY_NOW_REFRESH_INTERVAL_MS,
} from '../../helpers/dashboard-recovery-now.helper';
import {
  buildTrainingRecoveryEstimateViewModel,
  type TrainingRecoveryEstimateViewModel,
} from '../../helpers/training-recovery-estimate.helper';
import {
  buildTrainingExplanationViewModel,
  type TrainingExplanationViewModel,
} from '../../helpers/training-explanation-view.helper';
import { resolveTrainingEventDisplayLabel } from '../../helpers/training-event-label.helper';
import {
  buildTrainingDurabilityScopeViewModels,
  type TrainingDurabilityScopeViewModel,
} from '../../helpers/training-durability-view.helper';
import {
  buildTrainingPowerProfileViewModel,
  type TrainingPowerProfileViewModel,
} from '../../helpers/training-power-profile.helper';
import {
  buildTrainingPowerSystemsActivityTypeViewModels,
  groupTrainingPowerSystemsActivityTypeViewModels,
  type TrainingPowerSystemsActivityTypeViewModel,
} from '../../helpers/training-power-systems.helper';
import {
  buildTrainingBuildGuidance,
  buildTrainingLoadGuidance,
  buildTrainingMixGuidance,
  type TrainingCardGuidanceViewModel,
} from '../../helpers/training-card-guidance.helper';
import { AppThemeService } from '../../services/app.theme.service';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import type { TrainingWorkspacePreferences } from '../../models/app-user.interface';
import type { SleepSession } from '@shared/sleep';
import {
  TrainingBuildBenchmarkDialogComponent,
  type TrainingBuildEventSuggestionsState,
} from './training-build-benchmark-dialog.component';
import {
  TrainingSportVisibilityDialogComponent,
  type TrainingSportVisibilityDialogResult,
} from './training-sport-visibility-dialog.component';
import {
  TrainingMobileDestinationSheetComponent,
  type TrainingMobileDestinationSheetData,
  type TrainingMobileDestinationSheetResult,
} from './training-mobile-destination-sheet.component';
import {
  formatTrainingVisibleDisciplinesActivityLabel,
  formatTrainingVisibleDisciplinesCompactLabel,
  formatTrainingVisibleDisciplinesLabel,
  normalizeTrainingSportShortcuts,
  resolveStableTrainingShortcutDestinations,
  resolveTrainingSportShortcuts,
  trainingSportVisibilitySelectionKey,
} from '../../helpers/training-sport-visibility.helper';
import { formatTrainingSwimPace } from '../../helpers/training-swim-performance.helper';
import {
  DashboardDerivedMetricsService,
  createDashboardDerivedMetricsMissingState,
  TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
  type DashboardDerivedMetricsState,
} from '../../services/dashboard-derived-metrics.service';
import { environment } from '../../../environments/environment';

interface TrainingMixDisciplineViewModel {
  summary: DashboardTrainingDisciplineSummary;
  label: string;
  iconActivityType: TrainingSportDefinition['iconActivityType'];
  activityCountText: string;
  baselineActivityCountText: string;
  durationText: string;
  baselineDurationText: string;
  tssText: string;
  baselineTssText: string;
  zones: TrainingMixZoneViewModel[];
  intensityEvidenceText: string | null;
  contexts: TrainingContextMetricsViewModel[];
  guidance: TrainingCardGuidanceViewModel;
}

interface TrainingDestinationOptionViewModel {
  id: TrainingDestinationId;
  label: string;
  details: string;
  sport: TrainingSportDefinition | null;
  materialIcon: string | null;
}

type TrainingDestinationSelectionSource = 'shortcut' | 'desktop_selector' | 'mobile_selector';

export interface TrainingWorkspacePreferenceWriter {
  updateTrainingWorkspacePreferences(
    expectedUserUID: string,
    preferences: Partial<TrainingWorkspacePreferences>,
  ): Promise<void>;
}

export const TRAINING_WORKSPACE_PREFERENCE_WRITER = new InjectionToken<TrainingWorkspacePreferenceWriter>(
  'TRAINING_WORKSPACE_PREFERENCE_WRITER',
);

interface TrainingContextMetricViewModel {
  metric: TrainingProfileMetricId;
  label: string;
  currentText: string;
  referenceText: string;
}

interface TrainingContextMetricsViewModel {
  context: TrainingSportContextId;
  label: string;
  metrics: TrainingContextMetricViewModel[];
}

interface TrainingMixZoneViewModel {
  label: 'Easy' | 'Moderate' | 'Hard';
  currentText: string;
  baselineText: string;
  currentPercent: number | null;
  baselinePercent: number | null;
}

interface TrainingStatusViewModel {
  stateLabel: string;
  stateCaption: string;
  stateInfo: TrainingStateInfo;
  stateUpdateText: string | null;
  volumeText: string;
  volumeCaption: string;
  sessionsText: string;
  sessionsCaption: string;
  volumeDeltaPercent: number | null;
  sessionsDeltaPercent: number | null;
}

interface TrainingLoadMetricsViewModel {
  ctlText: string;
  atlText: string;
  rampText: string;
  acwrText: string;
  monotonyText: string;
  strainText: string;
  freshnessNowText: string;
  freshnessPlusSevenDaysText: string;
}

interface TrainingDerivedMetricsRouteStatus {
  type: 'pending' | 'warning';
  title: string;
  description: string;
  showRetry: boolean;
}

type TrainingBuildCardState = 'not-configured' | 'updating' | 'invalid' | 'unavailable' | 'ready';

interface TrainingBuildCardViewModel {
  discipline: DerivedTrainingDiscipline;
  label: string;
  state: TrainingBuildCardState;
  source: DashboardTrainingBuildComparisonDiscipline | null;
  expectedSelection: TrainingBuildBenchmarkSelection | null;
  referenceText: string;
  rangeText: string;
  emptyMessage: string | null;
  guidance: TrainingCardGuidanceViewModel | null;
  metricRows: TrainingBuildMetricRowViewModel[];
  recovery: TrainingRecoveryViewModel | null;
  footnote: string;
}

const TRAINING_DAY_MS = 24 * 60 * 60 * 1000;

interface TrainingBuildMetricRowViewModel {
  label: string;
  currentText: string;
  benchmarkText: string;
  deltaText: string;
  deltaTone?: TrainingComparisonDeltaTone;
  isIntensity: boolean;
}

type TrainingRecoveryState = 'updating' | 'unavailable' | 'empty' | 'limited' | 'ready';
type TrainingComparisonDeltaTone = 'positive' | 'negative' | 'neutral';
const TRAINING_SWIM_PACE_DELTA_DIRECTION = resolveMetricSemantics('Swim pace').direction;
const TRAINING_RECOVERY_MEANINGFUL_SLEEP_DELTA_SECONDS = 15 * 60;

interface TrainingRecoveryMetricRowViewModel {
  label: string;
  currentText: string;
  referenceText: string;
  deltaText: string;
  deltaTone: TrainingComparisonDeltaTone;
}

interface TrainingRecoveryViewModel {
  state: TrainingRecoveryState;
  isUpdating: boolean;
  currentLabel: string;
  referenceLabel: string;
  compactText: string;
  detailText: string;
  sourceText: string;
  metricRows: TrainingRecoveryMetricRowViewModel[];
}

function createEmptyTrainingRecoveryViewModel(): TrainingRecoveryViewModel {
  return {
    state: 'updating',
    isUpdating: true,
    currentLabel: 'Now',
    referenceLabel: 'Usual',
    compactText: 'Updating recovery context…',
    detailText: 'Preparing recovery context from your recorded overnight sleep.',
    sourceText: 'Sleep context does not change your Training state.',
    metricRows: [],
  };
}

function createEmptyTrainingStatusViewModel(): TrainingStatusViewModel {
  return {
    stateLabel: 'Awaiting data',
    stateCaption: 'No current load signals',
    stateInfo: buildTrainingStateInfo({ form: null, rampRate: null, fitness: null, fatigue: null }),
    stateUpdateText: null,
    volumeText: '--',
    volumeCaption: 'Preparing your training comparison…',
    sessionsText: '--',
    sessionsCaption: 'Preparing your training comparison…',
    volumeDeltaPercent: null,
    sessionsDeltaPercent: null,
  };
}

function createEmptyTrainingLoadMetricsViewModel(): TrainingLoadMetricsViewModel {
  return {
    ctlText: '--',
    atlText: '--',
    rampText: '--',
    acwrText: '--',
    monotonyText: '--',
    strainText: '--',
    freshnessNowText: '--',
    freshnessPlusSevenDaysText: '--',
  };
}

@Component({
  selector: 'app-training-workspace',
  templateUrl: './training-workspace.component.html',
  styleUrls: ['./training-workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingWorkspaceComponent implements OnInit, OnDestroy {
  public readonly trainingFeedbackMailtoHref = `mailto:${environment.supportEmail}?subject=${encodeURIComponent('Training feedback')}`;
  public isLoading = true;
  public derivedState: DashboardDerivedMetricsState = createDashboardDerivedMetricsMissingState();
  public trainingRecovery = createEmptyTrainingRecoveryViewModel();
  public trainingReadiness: TrainingReadinessViewModel = buildTrainingReadinessViewModel(null, { isPreparing: true });
  public bodyWeightTrend: TrainingBodyWeightViewModel = buildTrainingBodyWeightViewModel(null, 'building', null);
  public trainingRecoveryEstimate: TrainingRecoveryEstimateViewModel | null = null;
  public trainingExplanationView: TrainingExplanationViewModel | null = null;
  public trainingDurabilityScopes: TrainingDurabilityScopeViewModel[] = [];
  public cyclingPowerCurve: DashboardPowerCurveContext | null = null;
  public runningPowerCurve: DashboardPowerCurveContext | null = null;
  public cyclingPowerProfile: TrainingPowerProfileViewModel | null = null;
  public runningPowerProfile: TrainingPowerProfileViewModel | null = null;
  public trainingPowerSystemsActivityTypes: TrainingPowerSystemsActivityTypeViewModel[] = [];
  public selectedTrainingPowerSystemsActivityType: string | null = null;
  public selectedTrainingPowerSystems: TrainingPowerSystemsActivityTypeViewModel | null = null;
  public trainingStatus = createEmptyTrainingStatusViewModel();
  public trainingComparisonState: TrainingComparisonState = 'preparing';
  public trainingDataAsOfText: string | null = null;
  public derivedMetricsRouteStatus: TrainingDerivedMetricsRouteStatus | null = {
    type: 'pending',
    title: 'Building derived metrics',
    description: 'Some Training insights are still being prepared.',
    showRetry: false,
  };
  public loadMetrics = createEmptyTrainingLoadMetricsViewModel();
  public trainingLoadGuidance = buildTrainingLoadGuidance(null, null);
  public readonly loadTrajectoryInfoTooltip = resolveDashboardChartInfoTooltip(DASHBOARD_FORM_CHART_TYPE);
  public readonly freshnessForecastInfoTooltip = resolveDashboardChartInfoTooltip(DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE);
  public trainingMixDisciplines: TrainingMixDisciplineViewModel[] = [];
  public capacityDisciplines: TrainingCapacityDisciplineViewModel[] = [];
  public trainingBuildCards: TrainingBuildCardViewModel[] = [];
  public selectedTrainingDestination: TrainingDestinationId = 'overview';
  public selectedTrainingSport: TrainingSportDefinition | null = null;
  public trainingDestinationLabel = 'All training';
  public trainingDestinationScopeLabel = 'All recorded training';
  public trainingDestinationOptions: TrainingDestinationOptionViewModel[] = [];
  public sportShortcuts: TrainingVisibleDiscipline[] = [];
  public visibleSportShortcuts: TrainingVisibleDiscipline[] = [];
  public visibleSportShortcutOptions: TrainingDestinationOptionViewModel[] = [];
  public desktopAllSportsSelectorValue: TrainingDestinationId | null = null;
  public sportShortcutsCompactLabel = 'Automatic shortcuts';
  public sportShortcutsAccessibleLabel = 'Choose sport shortcuts. Automatic selection.';
  public isOverviewDestination = true;
  public isSportDestination = false;
  public isOtherPowerDestination = false;
  public hasOtherPowerActivities = false;
  public isPowerSystemsSectionVisible = false;
  public isSavingDestination = false;
  public visibleDisciplines: TrainingVisibleDiscipline[] = [];
  public visibleDisciplinesActivityLabel = formatTrainingVisibleDisciplinesActivityLabel(this.visibleDisciplines);
  public isAutomaticSportVisibility = true;
  public visibleTrainingCapabilities = new Set<TrainingSportCapability>();
  public isPerformanceSectionVisible = false;
  public isCapacityVisible = false;
  public isSwimPerformanceVisible = false;
  public isDurabilityVisible = false;
  public isCyclingPowerProfileVisible = false;
  public isRunningPowerProfileVisible = false;
  public trainingBuildRecoveryExpanded: Record<DerivedTrainingDiscipline, boolean> = createTrainingSportRecord(() => false);
  public trainingRecoveryHistoryExpanded = false;
  public readonly isDarkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  public readonly useTrainingStateDetailsDialog: Signal<boolean>;

  private readonly subscriptions = new Subscription();
  private dataSubscriptions = new Subscription();
  private currentUserUID: string | null = null;
  private hasReceivedDerivedState = false;
  private readinessSleepSessions: SleepSession[] = [];
  private readinessSleepLoading = true;
  private readinessSleepFailed = false;
  private readinessSleepRefreshTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readinessDayRolloverTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private trainingSettings: TrainingSettings = {};
  private trainingWorkspacePreferences: TrainingWorkspacePreferences = {};
  private allTrainingPowerSystemsActivityTypes: TrainingPowerSystemsActivityTypeViewModel[] = [];
  private preferredDestinationOverride: TrainingDestinationId | null = null;
  private preferredDestinationOverrideBaseline: TrainingDestinationId | null = null;
  private acknowledgedDestinationWrites = new Set<TrainingDestinationId>();
  private preferredDestinationSaveFailed = false;
  private queuedDestinationWrite: {
    uid: string;
    destination: TrainingDestinationId;
    source: TrainingDestinationSelectionSource;
    generation: number;
  } | null = null;
  private destinationWriteInFlight = false;
  private preferenceWriteGeneration = 0;
  public unitSettings: UserUnitSettingsInterface | null = null;
  private pendingTrainingBuildSelections = new Map<DerivedTrainingDiscipline, TrainingBuildBenchmarkSelection | null>();
  private pendingTrainingVisibleDisciplines: TrainingVisibleDiscipline[] | null | undefined;
  private pendingTrainingVisibleDisciplinesBaselineKey: string | undefined;
  private trainingBuildBenchmarkDialogRef: MatDialogRef<TrainingBuildBenchmarkDialogComponent> | null = null;
  private trainingBuildBenchmarkDialogDiscipline: DerivedTrainingDiscipline | null = null;
  private trainingSportVisibilityDialogRef: MatDialogRef<TrainingSportVisibilityDialogComponent> | null = null;
  private trainingMobileDestinationSheetRef: MatBottomSheetRef<
    TrainingMobileDestinationSheetComponent,
    TrainingMobileDestinationSheetResult
  > | null = null;
  private trainingStateDetailsDialogRef: MatDialogRef<unknown> | null = null;

  @ViewChild('trainingStateDetailsDialogTemplate') private trainingStateDetailsDialogTemplate?: TemplateRef<unknown>;
  @ViewChild('mobileDestinationScroller') private mobileDestinationScroller?: ElementRef<HTMLElement>;

  constructor(
    private readonly authService: AppAuthService,
    private readonly derivedMetricsService: DashboardDerivedMetricsService,
    private readonly sleepService: AppSleepService,
    private readonly themeService: AppThemeService,
    private readonly dialog: MatDialog,
    private readonly changeDetector: ChangeDetectorRef,
    @Optional() private readonly ngZone: NgZone | null = null,
    @Optional() private readonly analyticsService: AppAnalyticsService | null = null,
    @Optional() breakpointObserver: BreakpointObserver | null = null,
    @Inject(LOCALE_ID) private readonly locale: string,
    @Optional() @Inject(TRAINING_WORKSPACE_PREFERENCE_WRITER)
    private readonly userSettingsService: TrainingWorkspacePreferenceWriter | null = null,
    @Optional() private readonly snackBar: MatSnackBar | null = null,
    @Optional() private readonly bottomSheet: MatBottomSheet | null = null,
  ) {
    this.useTrainingStateDetailsDialog = breakpointObserver
      ? toSignal(breakpointObserver.observe('(max-width: 767px)').pipe(map(state => state.matches)), { initialValue: false })
      : signal(false);
  }

  ngOnInit(): void {
    this.ngZone?.runOutsideAngular(() => {
      const recoveryRefreshTimer = globalThis.setInterval(() => {
        this.ngZone?.run(() => {
          this.refreshTrainingRecoveryEstimate();
          this.refreshDerivedMetricsRouteStatus();
          this.changeDetector.markForCheck();
        });
      }, RECOVERY_NOW_REFRESH_INTERVAL_MS);
      this.subscriptions.add(() => globalThis.clearInterval(recoveryRefreshTimer));
    });
    this.subscriptions.add(this.authService.user$.subscribe((user) => {
      const uid = `${user?.uid || ''}`.trim();
      if (uid === this.currentUserUID) {
        this.trainingSettings = user?.settings?.trainingSettings || {};
        this.trainingWorkspacePreferences = user?.settings?.appSettings?.trainingWorkspace || {};
        this.reconcilePendingTrainingSportVisibility();
        this.reconcilePreferredTrainingDestination();
        this.unitSettings = user?.settings?.unitSettings || null;
        this.refreshSportSpecificViewModels();
        this.refreshDerivedViewModels();
        this.changeDetector.markForCheck();
        return;
      }

      this.currentUserUID = uid || null;
      this.dataSubscriptions.unsubscribe();
      this.dataSubscriptions = new Subscription();
      this.resetWorkspace();
      this.trainingSettings = user?.settings?.trainingSettings || {};
      this.trainingWorkspacePreferences = user?.settings?.appSettings?.trainingWorkspace || {};
      this.reconcilePreferredTrainingDestination();
      this.unitSettings = user?.settings?.unitSettings || null;
      this.refreshSportSpecificViewModels();
      if (!user || !uid) {
        this.isLoading = false;
        this.changeDetector.markForCheck();
        return;
      }

      let hasReceivedDerivedState = false;
      const metricScope = { metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS };
      this.dataSubscriptions.add(this.derivedMetricsService.watch(user, metricScope).subscribe((state) => {
        hasReceivedDerivedState = true;
        this.hasReceivedDerivedState = true;
        this.applyDerivedState(state);
        this.isLoading = false;
        this.derivedMetricsService.ensureForDashboard(user, state, metricScope);
        this.changeDetector.markForCheck();
      }));

      // Firestore can wait for every derived snapshot before emitting. Do not let that
      // block the workspace that requests the missing snapshots in the first place.
      if (!hasReceivedDerivedState) {
        this.isLoading = false;
        this.derivedMetricsService.ensureForDashboard(user, this.derivedState, metricScope);
        this.changeDetector.markForCheck();
      }

      this.syncTrainingReadinessSleepSubscription(uid);
      this.scheduleTrainingReadinessDayRollover();

    }));
  }

  ngOnDestroy(): void {
    this.preferenceWriteGeneration += 1;
    this.queuedDestinationWrite = null;
    this.acknowledgedDestinationWrites.clear();
    this.trainingStateDetailsDialogRef?.close();
    this.trainingMobileDestinationSheetRef?.dismiss();
    this.clearTrainingReadinessSleepRefreshTimer();
    this.clearTrainingReadinessDayRolloverTimer();
    this.dataSubscriptions.unsubscribe();
    this.subscriptions.unsubscribe();
  }

  public toggleTrainingBuildRecovery(discipline: DerivedTrainingDiscipline): void {
    this.trainingBuildRecoveryExpanded = {
      ...this.trainingBuildRecoveryExpanded,
      [discipline]: !this.trainingBuildRecoveryExpanded[discipline],
    };
  }

  public hasVisibleTrainingCapability(capability: TrainingSportCapability): boolean {
    return this.visibleTrainingCapabilities.has(capability);
  }

  public formatTrainingBuildFootnote(discipline: DerivedTrainingDiscipline): string {
    const sport = getTrainingSportDefinition(discipline);
    const profiles = sport?.contexts.map(context => context.profile) || [];
    if (profiles.some(profile => profile === 'gravity' || profile === 'mixed-gravity')) {
      return 'For Enduro and Downhill workouts, only recorded volume and gravity metrics are shown; their durability, TSS, and zone intensity are intentionally omitted.';
    }
    if (profiles.some(profile => profile === 'pool' || profile === 'open-water')) {
      return 'Pool and open-water pace stay separate. Missing pace, TSS, or intensity remains unavailable rather than zero.';
    }
    if (profiles.every(profile => profile === 'strength')) {
      return 'Strength uses recorded session volume only; distance, TSS, and zone intensity are intentionally omitted.';
    }
    if (!hasTrainingSportCapability(discipline, 'durability')) {
      return `${sport?.label || 'This sport'} uses its recorded context metrics; durability is not available for this sport in this release.`;
    }
    return 'Merged events are excluded. Durability appears only for eligible, context-matched workouts; missing evidence remains unavailable.';
  }

  public toggleTrainingRecoveryHistory(): void {
    this.trainingRecoveryHistoryExpanded = !this.trainingRecoveryHistoryExpanded;
  }

  public retryDerivedMetricsRebuild(): void {
    const uid = this.currentUserUID;
    if (!uid) {
      return;
    }
    this.derivedMetricsService.ensureForDashboard({ uid }, this.derivedState, {
      force: true,
      metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
    });
  }

  public openTrainingStateDetailsDialog(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.trainingStateDetailsDialogTemplate || this.trainingStateDetailsDialogRef) {
      return;
    }

    const dialogRef = this.dialog.open(this.trainingStateDetailsDialogTemplate, {
      ariaLabel: 'Training state details',
      autoFocus: false,
      maxWidth: '340px',
      restoreFocus: true,
      width: 'calc(100vw - 32px)',
    });
    this.trainingStateDetailsDialogRef = dialogRef;
    dialogRef.afterClosed().subscribe(() => {
      if (this.trainingStateDetailsDialogRef === dialogRef) {
        this.trainingStateDetailsDialogRef = null;
      }
    });
  }

  private formatNumber(value: number | null | undefined, fractionDigits = 1, signed = false): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '--';
    }
    const prefix = signed && value > 0 ? '+' : '';
    return `${prefix}${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: 0,
    }).format(value)}`;
  }

  private formatPercent(numerator: number, denominator: number): string {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      return '--';
    }
    return `${this.formatNumber((numerator / denominator) * 100, 0)}%`;
  }

  private createTrainingMixZoneView(
    label: TrainingMixZoneViewModel['label'],
    currentSeconds: number,
    currentZoneSeconds: number,
    baselineSeconds: number,
    baselineZoneSeconds: number,
  ): TrainingMixZoneViewModel {
    return {
      label,
      currentText: this.formatPercent(currentSeconds, currentZoneSeconds),
      baselineText: this.formatPercent(baselineSeconds, baselineZoneSeconds),
      currentPercent: resolveTrainingZonePercentage(currentSeconds, currentZoneSeconds),
      baselinePercent: resolveTrainingZonePercentage(baselineSeconds, baselineZoneSeconds),
    };
  }

  private buildTrainingContextMetricViews(
    current: DashboardTrainingDisciplineSummary['current28d']['contexts'],
    reference: DashboardTrainingDisciplineSummary['baseline28d']['contexts'],
    discipline: DerivedTrainingDiscipline,
    showSummaryCommonMetrics = false,
  ): TrainingContextMetricsViewModel[] {
    const currentByContext = new Map(current.map(context => [context.context, context]));
    const referenceByContext = new Map(reference.map(context => [context.context, context]));
    const contextDefinitions: readonly TrainingSportContextDefinition[] = [
      ...(getTrainingSportDefinition(discipline)?.contexts || []),
    ];
    const observedContextCount = contextDefinitions.filter(
      context => currentByContext.has(context.id) || referenceByContext.has(context.id),
    ).length;
    return contextDefinitions.flatMap((contextDefinition) => {
      const currentContext = currentByContext.get(contextDefinition.id);
      const referenceContext = referenceByContext.get(contextDefinition.id);
      if (!currentContext && !referenceContext) {
        return [];
      }
      const currentMetrics = new Map(currentContext?.metrics.map(metric => [metric.metric, metric]) || []);
      const referenceMetrics = new Map(referenceContext?.metrics.map(metric => [metric.metric, metric]) || []);
      const metrics = contextDefinition.profileMetrics
        .filter(metric => metric !== 'moving-time')
        .filter(metric => metric !== 'elapsed-time'
          || (showSummaryCommonMetrics && contextDefinition.profile === 'strength'))
        .filter(metric => metric !== 'distance' || showSummaryCommonMetrics || observedContextCount > 1)
        .flatMap((metric): TrainingContextMetricViewModel[] => {
          const definition = getTrainingProfileMetricDefinition(metric);
          const currentMetric = currentMetrics.get(metric);
          const referenceMetric = referenceMetrics.get(metric);
          return definition && (currentMetric || referenceMetric) ? [{
            metric,
            label: definition.label,
            currentText: this.formatTrainingProfileMetric(metric, currentMetric?.value, discipline),
            referenceText: this.formatTrainingProfileMetric(metric, referenceMetric?.value, discipline),
          }] : [];
        });
      return metrics.length ? [{
        context: contextDefinition.id,
        label: contextDefinition.label,
        metrics,
      }] : [];
    });
  }

  private formatTrainingProfileMetric(
    metric: TrainingProfileMetricId,
    value: number | null | undefined,
    discipline: DerivedTrainingDiscipline,
  ): string {
    const definition = getTrainingProfileMetricDefinition(metric);
    if (!definition || value === null || value === undefined || !Number.isFinite(value)) {
      return '--';
    }
    switch (definition.unit) {
      case 'distance':
        return this.formatTrainingBuildDistance(value, discipline);
      case 'elevation': {
        const formattedElevation = resolveUnitAwareDisplayStat(
          new DataAscent(value),
          this.unitSettings,
          { stripRepeatedUnit: true },
        )?.text;
        return formattedElevation || `${this.formatNumber(value, 0)} m`;
      }
      case 'stroke-distance': {
        const formattedDistance = resolveUnitAwareDisplayStat(
          new DataAvgStrokeDistance(value),
          this.unitSettings,
          { stripRepeatedUnit: true },
        )?.text;
        return formattedDistance || `${this.formatNumber(value, 1)} m`;
      }
      case 'duration':
        return this.formatTrainingBuildDuration(value);
      case 'count':
        return this.formatNumber(value, 0);
      case 'jump-distance': {
        const formattedDistance = resolveUnitAwareDisplayStat(
          new DataJumpDistance(value),
          this.unitSettings,
          { stripRepeatedUnit: true },
        )?.text;
        return formattedDistance || `${this.formatNumber(value, 1)} m`;
      }
      case 'cadence':
        return `${this.formatNumber(value, 1)} /min`;
      case 'pace-500m': {
        const roundedSeconds = Math.max(0, Math.round(value));
        const minutes = Math.floor(roundedSeconds / 60);
        const seconds = roundedSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')} /500 m`;
      }
      case 'score':
        return this.formatNumber(value, 1);
    }
  }

  private formatTrainingProfileMetricDelta(
    metric: TrainingProfileMetricId,
    current: number | null | undefined,
    reference: number | null | undefined,
    discipline: DerivedTrainingDiscipline,
  ): string {
    if (!Number.isFinite(current) || !Number.isFinite(reference)) {
      return '--';
    }
    const delta = (current as number) - (reference as number);
    if (Math.abs(delta) < 0.005) {
      return 'Same';
    }
    const definition = getTrainingProfileMetricDefinition(metric);
    if (definition?.unit === 'pace-500m') {
      return `${this.formatTrainingProfileMetric(metric, Math.abs(delta), discipline)} ${delta < 0 ? 'faster' : 'slower'}`;
    }
    if (definition?.unit === 'duration') {
      return this.formatTrainingBuildDurationDelta(current, reference);
    }
    const formatted = this.formatTrainingProfileMetric(metric, Math.abs(delta), discipline);
    return `${delta > 0 ? '+' : '−'}${formatted}`;
  }

  private resetWorkspace(): void {
    this.preferenceWriteGeneration += 1;
    this.queuedDestinationWrite = null;
    this.isSavingDestination = false;
    this.preferredDestinationOverride = null;
    this.preferredDestinationOverrideBaseline = null;
    this.acknowledgedDestinationWrites.clear();
    this.preferredDestinationSaveFailed = false;
    this.clearTrainingReadinessSleepRefreshTimer();
    this.clearTrainingReadinessDayRolloverTimer();
    const activeDialogRef = this.trainingBuildBenchmarkDialogRef;
    const activeVisibilityDialogRef = this.trainingSportVisibilityDialogRef;
    const activeMobileDestinationSheetRef = this.trainingMobileDestinationSheetRef;
    this.trainingBuildBenchmarkDialogRef = null;
    this.trainingBuildBenchmarkDialogDiscipline = null;
    this.trainingSportVisibilityDialogRef = null;
    this.trainingMobileDestinationSheetRef = null;
    activeDialogRef?.close();
    activeVisibilityDialogRef?.close();
    activeMobileDestinationSheetRef?.dismiss();
    this.isLoading = true;
    this.derivedState = createDashboardDerivedMetricsMissingState();
    this.trainingRecovery = createEmptyTrainingRecoveryViewModel();
    this.trainingReadiness = buildTrainingReadinessViewModel(null, { isPreparing: true });
    this.bodyWeightTrend = buildTrainingBodyWeightViewModel(null, 'building', null);
    this.trainingRecoveryEstimate = null;
    this.trainingExplanationView = null;
    this.trainingDurabilityScopes = [];
    this.cyclingPowerCurve = null;
    this.runningPowerCurve = null;
    this.cyclingPowerProfile = null;
    this.runningPowerProfile = null;
    this.allTrainingPowerSystemsActivityTypes = [];
    this.trainingPowerSystemsActivityTypes = [];
    this.selectedTrainingPowerSystemsActivityType = null;
    this.selectedTrainingPowerSystems = null;
    this.trainingStatus = createEmptyTrainingStatusViewModel();
    this.trainingComparisonState = 'preparing';
    this.trainingDataAsOfText = null;
    this.derivedMetricsRouteStatus = {
      type: 'pending',
      title: 'Building derived metrics',
      description: 'Some Training insights are still being prepared.',
      showRetry: false,
    };
    this.loadMetrics = createEmptyTrainingLoadMetricsViewModel();
    this.trainingLoadGuidance = buildTrainingLoadGuidance(null, null);
    this.trainingMixDisciplines = [];
    this.capacityDisciplines = [];
    this.hasReceivedDerivedState = false;
    this.readinessSleepSessions = [];
    this.readinessSleepLoading = true;
    this.readinessSleepFailed = false;
    this.trainingSettings = {};
    this.trainingWorkspacePreferences = {};
    this.unitSettings = null;
    this.pendingTrainingBuildSelections.clear();
    this.pendingTrainingVisibleDisciplines = undefined;
    this.pendingTrainingVisibleDisciplinesBaselineKey = undefined;
    this.selectedTrainingDestination = 'overview';
    this.selectedTrainingSport = null;
    this.trainingDestinationLabel = 'All training';
    this.trainingDestinationScopeLabel = 'All recorded training';
    this.trainingDestinationOptions = [];
    this.sportShortcuts = [];
    this.visibleSportShortcuts = [];
    this.visibleSportShortcutOptions = [];
    this.desktopAllSportsSelectorValue = null;
    this.sportShortcutsCompactLabel = 'Automatic shortcuts';
    this.sportShortcutsAccessibleLabel = 'Choose sport shortcuts. Automatic selection.';
    this.isOverviewDestination = true;
    this.isSportDestination = false;
    this.isOtherPowerDestination = false;
    this.hasOtherPowerActivities = false;
    this.isPowerSystemsSectionVisible = false;
    this.visibleDisciplines = [...TRAINING_DISCIPLINES];
    this.visibleDisciplinesActivityLabel = formatTrainingVisibleDisciplinesActivityLabel(this.visibleDisciplines);
    this.isAutomaticSportVisibility = true;
    this.visibleTrainingCapabilities = new Set<TrainingSportCapability>();
    this.isPerformanceSectionVisible = false;
    this.isCapacityVisible = false;
    this.isSwimPerformanceVisible = false;
    this.isDurabilityVisible = false;
    this.isCyclingPowerProfileVisible = false;
    this.isRunningPowerProfileVisible = false;
    this.trainingBuildRecoveryExpanded = createTrainingSportRecord(() => false);
    this.trainingRecoveryHistoryExpanded = false;
    this.trainingBuildCards = this.buildTrainingBuildCards();
  }

  private applyDerivedState(state: DashboardDerivedMetricsState): void {
    this.derivedState = state;
    const cycling90dPowerCurve = buildDashboardPowerCurveContextFromSnapshot(state.powerCurve, {
      scope: 'cycling',
      range: '90d',
      latestSeriesLabel: 'Latest cycling activity',
    });
    this.cyclingPowerCurve = buildDashboardPowerCurveContextFromSnapshot(state.powerCurve, {
      scope: 'cycling',
      range: '1y',
      latestSeriesLabel: 'Latest cycling activity',
    });
    const running90dPowerCurve = buildDashboardPowerCurveContextFromSnapshot(state.powerCurve, {
      scope: 'running',
      range: '90d',
      latestSeriesLabel: 'Latest running activity',
    });
    this.runningPowerCurve = buildDashboardPowerCurveContextFromSnapshot(state.powerCurve, {
      scope: 'running',
      range: '1y',
      latestSeriesLabel: 'Latest running activity',
    });
    this.cyclingPowerProfile = buildTrainingPowerProfileViewModel(cycling90dPowerCurve, this.cyclingPowerCurve);
    this.runningPowerProfile = buildTrainingPowerProfileViewModel(running90dPowerCurve, this.runningPowerCurve);
    this.refreshTrainingPowerSystemsViewModels();
    this.refreshDerivedViewModels();
    this.refreshSportSpecificViewModels();
  }

  private refreshTrainingPowerSystemsViewModels(): void {
    this.allTrainingPowerSystemsActivityTypes = buildTrainingPowerSystemsActivityTypeViewModels(
      this.derivedState.trainingPowerSystems,
    );
    this.refreshTrainingPowerSystemsDestination();
  }

  private refreshTrainingPowerSystemsDestination(): void {
    const groups = groupTrainingPowerSystemsActivityTypeViewModels(
      this.allTrainingPowerSystemsActivityTypes,
    );
    this.hasOtherPowerActivities = groups.other.length > 0;
    this.trainingPowerSystemsActivityTypes = this.isOtherPowerDestination
      ? groups.other
      : this.selectedTrainingSport
        ? groups.bySport[this.selectedTrainingSport.id]
        : [];
    const selectedActivityType = this.trainingPowerSystemsActivityTypes.some(
      item => item.activityType === this.selectedTrainingPowerSystemsActivityType,
    )
      ? this.selectedTrainingPowerSystemsActivityType
      : this.trainingPowerSystemsActivityTypes[0]?.activityType ?? null;
    this.selectTrainingPowerSystemsActivityType(selectedActivityType);
    this.isPowerSystemsSectionVisible = !this.isOverviewDestination && (
      this.trainingPowerSystemsActivityTypes.length > 0 || this.isOtherPowerDestination
    );
    this.refreshTrainingDestinationOptions();
  }

  public selectTrainingPowerSystemsActivityType(activityType: string | null): void {
    this.selectedTrainingPowerSystemsActivityType = activityType;
    this.selectedTrainingPowerSystems = this.trainingPowerSystemsActivityTypes.find(
      item => item.activityType === activityType,
    ) ?? null;
  }

  private refreshSportSpecificViewModels(): void {
    this.refreshTrainingSportVisibility();
    if (
      this.trainingBuildBenchmarkDialogRef
      && this.trainingBuildBenchmarkDialogDiscipline
      && (
        !this.isSportDestination
        || this.selectedTrainingSport?.id !== this.trainingBuildBenchmarkDialogDiscipline
      )
    ) {
      const dialogRef = this.trainingBuildBenchmarkDialogRef;
      this.trainingBuildBenchmarkDialogRef = null;
      this.trainingBuildBenchmarkDialogDiscipline = null;
      dialogRef.close();
    }
    const trainingSummary = this.derivedState.trainingSummary;
    const currentTssByDiscipline = new Map<DerivedTrainingDiscipline, number | null>();
    const baselineTssByDiscipline = new Map<DerivedTrainingDiscipline, number | null>();
    const trainingExplanation = this.derivedState.trainingExplanation;

    // The summary and explanation snapshots are built independently. Do not
    // combine a fresh workout/time summary with load values from an older cutoff.
    if (
      trainingSummary
      && trainingExplanation
      && trainingSummary.asOfDayMs === trainingExplanation.asOfDayMs
    ) {
      trainingExplanation.current.sportLoads.forEach((sportLoad) => {
        if (isTrainingDiscipline(sportLoad.sport)) {
          currentTssByDiscipline.set(sportLoad.sport, sportLoad.trainingStressScore);
        }
      });
      trainingExplanation.baselineMedian.sportLoads.forEach((sportLoad) => {
        if (isTrainingDiscipline(sportLoad.sport)) {
          baselineTssByDiscipline.set(sportLoad.sport, sportLoad.trainingStressScore);
        }
      });
    }

    const summaries = trainingSummary?.disciplines || [];
    this.trainingMixDisciplines = summaries
      .filter(summary => isTrainingVisibleDiscipline(summary.discipline)
        && hasTrainingSportCapability(summary.discipline, 'training-mix'))
      .map((summary) => {
        const currentZoneSeconds = resolveTrainingZoneSeconds(summary.current28d);
        const baselineZoneSeconds = resolveTrainingZoneSeconds(summary.baseline28d);
        const hasZoneEvidence = currentZoneSeconds > 0 || baselineZoneSeconds > 0;
        const currentContexts = summary.current28d.contexts || [];
        const baselineContexts = summary.baseline28d.contexts || [];
        const observedContexts = [...currentContexts, ...baselineContexts];
        const isVolumeOnly = this.areObservedTrainingContextsVolumeOnly(
          observedContexts,
          'intensityPolicy',
        );
        const label = formatTrainingVisibleDisciplinesLabel([summary.discipline]);
        return {
          summary,
          label,
          iconActivityType: getTrainingSportDefinition(summary.discipline)?.iconActivityType
            || TRAINING_SPORT_DEFINITIONS[0].iconActivityType,
          activityCountText: this.formatNumber(summary.current28d.activityCount, 0),
          baselineActivityCountText: this.formatNumber(summary.baseline28d.activityCount, 0),
          durationText: formatSleepDuration(summary.current28d.durationSeconds),
          baselineDurationText: formatSleepDuration(summary.baseline28d.durationSeconds),
          tssText: this.formatNumber(currentTssByDiscipline.get(summary.discipline), 0),
          baselineTssText: this.formatNumber(baselineTssByDiscipline.get(summary.discipline), 0),
          guidance: buildTrainingMixGuidance(summary, label, isVolumeOnly ? 'volume-only' : 'zones'),
          intensityEvidenceText: hasZoneEvidence
            ? null
            : (isVolumeOnly
              ? 'This context is summarized by recorded volume; zone intensity is intentionally omitted.'
              : 'No eligible power or heart-rate zone evidence in these windows.'),
          contexts: this.buildTrainingContextMetricViews(
            currentContexts,
            baselineContexts,
            summary.discipline,
            true,
          ),
          zones: hasZoneEvidence ? [
            this.createTrainingMixZoneView('Easy', summary.current28d.easySeconds, currentZoneSeconds, summary.baseline28d.easySeconds, baselineZoneSeconds),
            this.createTrainingMixZoneView('Moderate', summary.current28d.moderateSeconds, currentZoneSeconds, summary.baseline28d.moderateSeconds, baselineZoneSeconds),
            this.createTrainingMixZoneView('Hard', summary.current28d.hardSeconds, currentZoneSeconds, summary.baseline28d.hardSeconds, baselineZoneSeconds),
          ] : [],
        };
      })
      .filter(view => this.visibleDisciplines.includes(view.summary.discipline))
      .filter(view => view.summary.current28d.activityCount > 0 || view.summary.baseline28d.activityCount > 0);
    this.capacityDisciplines = buildTrainingCapacityViewModels(this.derivedState.trainingCapacity)
      .filter(view => isTrainingVisibleDiscipline(view.discipline) && this.visibleDisciplines.includes(view.discipline));
    this.trainingDurabilityScopes = buildTrainingDurabilityScopeViewModels(
      this.derivedState.trainingDurability,
      this.visibleDisciplines,
    );
    this.refreshTrainingPowerSystemsDestination();
    this.refreshTrainingBuildCards();
    this.refreshDerivedMetricsRouteStatus();
  }

  private refreshDerivedMetricsRouteStatus(): void {
    const statuses = [];
    if (this.isOverviewDestination) {
      const nowMs = Date.now();
      const currentTrainingState = buildCurrentTrainingStateContext({
        formPoints: this.derivedState.formPoints,
        fallbackFormNow: this.derivedState.formNow,
        fallbackRampRate: this.derivedState.rampRate,
        nowMs,
      });
      const hasForecastFreshness = this.derivedState.freshnessForecast?.points
        ?.some(point => point.isForecast) === true;
      statuses.push(
        this.derivedState.formStatus,
        this.derivedState.acwrStatus,
        this.derivedState.monotonyStrainStatus,
        this.derivedState.freshnessForecastStatus,
        this.derivedState.intensityDistributionStatus,
        this.derivedState.trainingSummaryStatus,
        this.derivedState.trainingExplanationStatus,
        this.derivedState.trainingReadinessStatus,
        this.derivedState.trainingBuildComparisonStatus,
        this.derivedState.bodyWeightTrendStatus,
      );
      if (!currentTrainingState.formNowFromSeries) {
        statuses.push(this.derivedState.formNowStatus);
      }
      if (!currentTrainingState.rampRateFromSeries) {
        statuses.push(this.derivedState.rampRateStatus);
      }
      if (!hasForecastFreshness) {
        statuses.push(this.derivedState.formPlus7dStatus);
      }
      if (this.trainingRecoveryEstimate) {
        statuses.push(this.derivedState.recoveryNowStatus);
      }
    } else if (this.isSportDestination) {
      statuses.push(
        this.derivedState.trainingSummaryStatus,
        this.derivedState.trainingBuildComparisonStatus,
      );
      if (this.hasVisibleTrainingCapability('capacity')) {
        statuses.push(this.derivedState.trainingCapacityStatus);
      }
      if (this.isCyclingPowerProfileVisible || this.isRunningPowerProfileVisible) {
        statuses.push(this.derivedState.powerCurveStatus);
      }
      if (this.hasVisibleTrainingCapability('swim-performance')) {
        statuses.push(this.derivedState.trainingSwimPerformanceStatus);
      }
      if (this.hasVisibleTrainingCapability('durability')) {
        statuses.push(this.derivedState.trainingDurabilityStatus);
      }
    }
    if (this.isPowerSystemsSectionVisible) {
      statuses.push(this.derivedState.trainingPowerSystemsStatus);
    }

    const refreshPhase = resolveDerivedMetricsRefreshPhase(statuses);
    if (refreshPhase === 'failed') {
      this.derivedMetricsRouteStatus = {
        type: 'warning',
        title: 'Derived metrics update failed',
        description: 'Some Training values may be out of date.',
        showRetry: true,
      };
      return;
    }
    if (refreshPhase === 'refreshing' || refreshPhase === 'building') {
      this.derivedMetricsRouteStatus = {
        type: 'pending',
        title: refreshPhase === 'refreshing' ? 'Refreshing derived metrics' : 'Building derived metrics',
        description: refreshPhase === 'refreshing'
          ? 'Available last completed values stay visible while the update finishes.'
          : 'Some Training insights are still being prepared.',
        showRetry: false,
      };
      return;
    }
    this.derivedMetricsRouteStatus = null;
  }

  private refreshTrainingSportVisibility(): void {
    const preference = this.pendingTrainingVisibleDisciplines !== undefined
      ? this.pendingTrainingVisibleDisciplines
      : this.trainingWorkspacePreferences.sportShortcuts;
    const shortcutResolution = resolveTrainingSportShortcuts(
      preference,
      this.trainingSettings.visibleDisciplines,
      this.derivedState.trainingSummary,
      this.derivedState.trainingSummary !== null,
      this.trainingSettings.buildBenchmarks,
    );
    this.sportShortcuts = shortcutResolution.disciplines;
    this.isAutomaticSportVisibility = shortcutResolution.isAutomatic;
    this.selectedTrainingSport = isTrainingDiscipline(this.selectedTrainingDestination)
      ? getTrainingSportDefinition(this.selectedTrainingDestination)
      : null;
    this.isOverviewDestination = this.selectedTrainingDestination === 'overview';
    this.isOtherPowerDestination = this.selectedTrainingDestination === 'other-power';
    this.isSportDestination = this.selectedTrainingSport !== null;
    this.visibleDisciplines = this.isOverviewDestination
      ? [...TRAINING_DISCIPLINES]
      : this.selectedTrainingSport ? [this.selectedTrainingSport.id] : [];
    this.visibleTrainingCapabilities = new Set<TrainingSportCapability>(
      this.selectedTrainingSport?.capabilities || [],
    );
    this.isCapacityVisible = this.visibleTrainingCapabilities.has('capacity');
    this.isSwimPerformanceVisible = this.visibleTrainingCapabilities.has('swim-performance');
    this.isDurabilityVisible = this.visibleTrainingCapabilities.has('durability');
    this.isCyclingPowerProfileVisible = this.selectedTrainingSport?.id === 'cycling'
      && this.visibleTrainingCapabilities.has('power-profile');
    this.isRunningPowerProfileVisible = this.selectedTrainingSport?.id === 'running'
      && this.visibleTrainingCapabilities.has('power-profile');
    this.isPerformanceSectionVisible = this.isCapacityVisible
      || this.isSwimPerformanceVisible
      || this.isDurabilityVisible
      || this.isCyclingPowerProfileVisible
      || this.isRunningPowerProfileVisible;
    this.visibleDisciplinesActivityLabel = formatTrainingVisibleDisciplinesActivityLabel(this.visibleDisciplines);
    const compactShortcuts = formatTrainingVisibleDisciplinesCompactLabel(this.sportShortcuts);
    this.sportShortcutsCompactLabel = shortcutResolution.isAutomatic
      ? (this.sportShortcuts.length ? `Automatic · ${compactShortcuts}` : 'Automatic shortcuts')
      : compactShortcuts;
    const shortcutLabels = this.sportShortcuts.length
      ? formatTrainingVisibleDisciplinesLabel(this.sportShortcuts)
      : 'no current shortcuts';
    this.sportShortcutsAccessibleLabel = `Choose sport shortcuts. ${shortcutResolution.isAutomatic ? 'Automatic' : 'Fixed'} selection: ${shortcutLabels}.`;
    this.visibleSportShortcuts = resolveStableTrainingShortcutDestinations(
      this.visibleSportShortcuts,
      this.sportShortcuts,
      this.selectedTrainingDestination,
    );
    this.trainingDestinationLabel = this.selectedTrainingSport?.label
      || (this.isOtherPowerDestination ? 'Other power activities' : 'All training');
    this.trainingDestinationScopeLabel = this.selectedTrainingSport
      ? `${this.selectedTrainingSport.scopeLabel} only`
      : this.isOtherPowerDestination ? 'Unmatched exact power activity types' : 'All recorded training';
    this.refreshTrainingDestinationOptions();
  }

  private refreshTrainingDestinationOptions(): void {
    this.trainingDestinationOptions = [
      {
        id: 'overview',
        label: 'All training',
        details: 'Global readiness, load, sleep, intensity, and sport mix',
        sport: null,
        materialIcon: 'monitoring',
      },
      ...TRAINING_SPORT_DEFINITIONS.map(sport => ({
        id: sport.id,
        label: sport.label,
        details: sport.details,
        sport,
        materialIcon: null,
      })),
      ...(this.hasOtherPowerActivities || this.isOtherPowerDestination ? [{
        id: 'other-power' as const,
        label: 'Other power activities',
        details: 'Exact power activity types outside the Training sport registry',
        sport: null,
        materialIcon: 'bolt',
      }] : []),
    ];
    this.visibleSportShortcutOptions = this.visibleSportShortcuts
      .map(id => this.trainingDestinationOptions.find(option => option.id === id))
      .filter((option): option is TrainingDestinationOptionViewModel => option !== undefined);
    this.desktopAllSportsSelectorValue = this.isOtherPowerDestination
      ? this.selectedTrainingDestination
      : null;
  }

  private reconcilePreferredTrainingDestination(): void {
    const persisted = normalizeTrainingDestinationId(
      this.trainingWorkspacePreferences.preferredDestination,
    );
    const override = this.preferredDestinationOverride;
    if (override === null) {
      this.selectedTrainingDestination = persisted;
      return;
    }
    const hasAcknowledgedPersistedValue = this.acknowledgedDestinationWrites.has(persisted);
    if (override === persisted && hasAcknowledgedPersistedValue) {
      this.clearPreferredTrainingDestinationOverride();
      this.selectedTrainingDestination = persisted;
      return;
    }
    if (
      this.destinationWriteInFlight
      || this.queuedDestinationWrite !== null
      || this.preferredDestinationSaveFailed
      || this.acknowledgedDestinationWrites.has(override)
      || hasAcknowledgedPersistedValue
      || persisted === this.preferredDestinationOverrideBaseline
    ) {
      this.selectedTrainingDestination = override;
      return;
    }
    this.clearPreferredTrainingDestinationOverride();
    this.selectedTrainingDestination = persisted;
  }

  private clearPreferredTrainingDestinationOverride(): void {
    this.preferredDestinationOverride = null;
    this.preferredDestinationOverrideBaseline = null;
    this.acknowledgedDestinationWrites.clear();
    this.preferredDestinationSaveFailed = false;
  }

  public selectTrainingDestination(
    value: unknown,
    source: TrainingDestinationSelectionSource,
  ): void {
    const destination = normalizeTrainingDestinationId(value);
    if (destination === this.selectedTrainingDestination) {
      return;
    }
    this.preferredDestinationOverrideBaseline = normalizeTrainingDestinationId(
      this.trainingWorkspacePreferences.preferredDestination,
    );
    this.acknowledgedDestinationWrites.clear();
    this.preferredDestinationSaveFailed = false;
    this.selectedTrainingDestination = destination;
    this.preferredDestinationOverride = destination;
    if (isTrainingDiscipline(destination) && !this.sportShortcuts.includes(destination)) {
      // An explicit off-shortcut choice should still be brought to the leading
      // edge. Snapshot hydration uses stable reconciliation instead.
      this.visibleSportShortcuts = [];
    }
    this.refreshSportSpecificViewModels();
    this.changeDetector.markForCheck();
    this.queuePreferredTrainingDestinationWrite(destination, source);
  }

  public selectDesktopTrainingDestination(value: unknown, select: MatSelect): void {
    this.selectTrainingDestination(value, 'desktop_selector');
    // MatSelect updates its own value before selectionChange. When a selected
    // sport is then injected into the shortcut row, the bound value remains
    // null and Angular has no changed input to write back, so clear it through
    // the component's public value API to avoid showing the destination twice.
    select.value = this.desktopAllSportsSelectorValue;
  }

  public openTrainingMobileDestinationSheet(): void {
    if (
      !this.bottomSheet
      || this.trainingMobileDestinationSheetRef
      || this.trainingSportVisibilityDialogRef
      || this.trainingBuildBenchmarkDialogRef
    ) {
      return;
    }
    const data: TrainingMobileDestinationSheetData = {
      options: this.trainingDestinationOptions.map(option => ({
        id: option.id,
        label: option.label,
        iconActivityType: option.sport?.iconActivityType || null,
        materialIcon: option.materialIcon,
      })),
      shortcutIds: [...this.sportShortcuts],
      selectedDestination: this.selectedTrainingDestination,
      isAutomatic: this.isAutomaticSportVisibility,
    };
    const sheetRef = this.bottomSheet.open(TrainingMobileDestinationSheetComponent, {
      ariaLabel: 'Choose training view',
      data,
    });
    this.trainingMobileDestinationSheetRef = sheetRef;
    this.subscriptions.add(sheetRef.afterDismissed().subscribe((result) => {
      const applyResult = (): void => {
        if (this.trainingMobileDestinationSheetRef === sheetRef) {
          this.trainingMobileDestinationSheetRef = null;
        }
        if (result?.kind === 'destination') {
          this.selectTrainingDestination(result.destination, 'mobile_selector');
          if (this.mobileDestinationScroller) {
            this.mobileDestinationScroller.nativeElement.scrollLeft = 0;
          }
          return;
        }
        if (result?.kind === 'manage_shortcuts') {
          this.openTrainingSportVisibilityDialog();
        }
      };
      if (this.ngZone) {
        this.ngZone.run(applyResult);
      } else {
        applyResult();
      }
    }));
  }

  private queuePreferredTrainingDestinationWrite(
    destination: TrainingDestinationId,
    source: TrainingDestinationSelectionSource,
  ): void {
    const uid = this.currentUserUID;
    if (!uid || !this.userSettingsService) {
      return;
    }
    this.queuedDestinationWrite = {
      uid,
      destination,
      source,
      generation: this.preferenceWriteGeneration,
    };
    this.isSavingDestination = true;
    this.changeDetector.markForCheck();
    void this.flushPreferredTrainingDestinationWrites();
  }

  private async flushPreferredTrainingDestinationWrites(): Promise<void> {
    const userSettingsService = this.userSettingsService;
    if (this.destinationWriteInFlight || !userSettingsService) {
      return;
    }
    this.destinationWriteInFlight = true;
    this.isSavingDestination = true;
    this.changeDetector.markForCheck();
    while (this.queuedDestinationWrite) {
      const write = this.queuedDestinationWrite;
      this.queuedDestinationWrite = null;
      if (
        write.generation !== this.preferenceWriteGeneration
        || write.uid !== this.currentUserUID
      ) {
        continue;
      }
      try {
        await userSettingsService.updateTrainingWorkspacePreferences(write.uid, {
          preferredDestination: write.destination,
        });
        if (
          write.generation === this.preferenceWriteGeneration
          && write.uid === this.currentUserUID
        ) {
          this.acknowledgedDestinationWrites.add(write.destination);
          const isSportDestination = isTrainingDiscipline(write.destination);
          this.analyticsService?.logEvent('training_destination_saved', {
            destination_type: isSportDestination
              ? 'sport'
              : write.destination === 'other-power' ? 'other_power' : 'overview',
            selection_source: write.source,
            ...(isSportDestination ? { sport_family: write.destination } : {}),
          });
        }
      } catch {
        if (
          write.generation === this.preferenceWriteGeneration
          && write.uid === this.currentUserUID
          && this.queuedDestinationWrite === null
        ) {
          this.acknowledgedDestinationWrites.clear();
          this.preferredDestinationSaveFailed = true;
          this.snackBar?.open(
            'This view is open, but its account default was not saved.',
            'Dismiss',
            { duration: 6000 },
          );
        }
      }
    }
    this.destinationWriteInFlight = false;
    this.isSavingDestination = false;
    const destinationBeforeReconciliation = this.selectedTrainingDestination;
    this.reconcilePreferredTrainingDestination();
    if (this.selectedTrainingDestination !== destinationBeforeReconciliation) {
      this.refreshSportSpecificViewModels();
    }
    this.changeDetector.markForCheck();
  }

  private reconcilePendingTrainingSportVisibility(): void {
    if (this.pendingTrainingVisibleDisciplines === undefined) {
      this.pendingTrainingVisibleDisciplinesBaselineKey = undefined;
      return;
    }
    const persistedKey = this.resolvePersistedTrainingSportVisibilityKey();
    if (
      this.isPersistedTrainingSportVisibility(this.pendingTrainingVisibleDisciplines)
      || (
        this.pendingTrainingVisibleDisciplinesBaselineKey !== undefined
        && persistedKey !== this.pendingTrainingVisibleDisciplinesBaselineKey
      )
    ) {
      this.pendingTrainingVisibleDisciplines = undefined;
      this.pendingTrainingVisibleDisciplinesBaselineKey = undefined;
    }
  }

  private isPersistedTrainingSportVisibility(
    preference: readonly TrainingVisibleDiscipline[] | null,
  ): boolean {
    return this.resolvePersistedTrainingSportVisibilityKey()
      === this.resolveTrainingSportShortcutPreferenceKey(preference);
  }

  private resolvePersistedTrainingSportVisibilityKey(): string {
    return this.resolveTrainingSportShortcutPreferenceKey(
      normalizeTrainingSportShortcuts(this.trainingWorkspacePreferences.sportShortcuts),
    );
  }

  private resolveTrainingSportShortcutPreferenceKey(
    preference: readonly TrainingVisibleDiscipline[] | null | undefined,
  ): string {
    if (preference === undefined) {
      return 'missing';
    }
    return preference === null
      ? 'automatic'
      : `fixed:${trainingSportVisibilitySelectionKey(preference)}`;
  }

  public openTrainingSportVisibilityDialog(): void {
    const userUID = this.currentUserUID;
    if (
      !userUID
      || this.trainingSportVisibilityDialogRef
      || this.trainingBuildBenchmarkDialogRef
      || this.trainingMobileDestinationSheetRef
    ) {
      return;
    }
    const dialogRef = this.dialog.open(TrainingSportVisibilityDialogComponent, {
      width: 'min(100vw - 32px, 480px)',
      maxWidth: '480px',
      data: {
        userUID,
        visibleDisciplines: [...this.sportShortcuts],
        isAutomatic: this.isAutomaticSportVisibility,
      },
    });
    this.trainingSportVisibilityDialogRef = dialogRef;
    this.subscriptions.add(dialogRef.afterClosed().subscribe((result: TrainingSportVisibilityDialogResult | undefined) => {
      if (this.trainingSportVisibilityDialogRef === dialogRef) {
        this.trainingSportVisibilityDialogRef = null;
      }
      if (!result?.saved) {
        return;
      }
      this.analyticsService?.logEvent('training_sport_shortcuts_saved', {
        selection_mode: result.visibleDisciplines === null ? 'automatic' : 'fixed',
        shortcut_count: result.visibleDisciplines?.length ?? 0,
      });
      if (this.isPersistedTrainingSportVisibility(result.visibleDisciplines)) {
        this.pendingTrainingVisibleDisciplines = undefined;
        this.pendingTrainingVisibleDisciplinesBaselineKey = undefined;
      } else {
        this.pendingTrainingVisibleDisciplinesBaselineKey = this.resolvePersistedTrainingSportVisibilityKey();
        this.pendingTrainingVisibleDisciplines = result.visibleDisciplines;
      }
      this.visibleSportShortcuts = [];
      this.refreshSportSpecificViewModels();
      this.changeDetector.markForCheck();
    }));
  }

  public openTrainingBuildBenchmarkDialog(discipline: DerivedTrainingDiscipline): void {
    if (
      this.trainingBuildBenchmarkDialogRef
      || this.trainingSportVisibilityDialogRef
      || this.trainingMobileDestinationSheetRef
    ) {
      return;
    }
    const card = this.trainingBuildCards.find(item => item.discipline === discipline);
    const selection = this.resolveEffectiveTrainingBuildSelection(discipline);
    const dialogRef = this.dialog.open(TrainingBuildBenchmarkDialogComponent, {
      width: '720px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 32px)',
      data: {
        discipline,
        asOfDayMs: this.derivedState.trainingBuildComparison?.asOfDayMs ?? this.resolveCurrentUtcDayMs(),
        suggestedRaces: card?.source?.suggestedRaces || [],
        suggestedEvents: card?.source?.suggestedEvents || [],
        eventSuggestionsState: this.resolveTrainingBuildEventSuggestionsState(card?.source || null),
        selection,
        unitSettings: this.unitSettings,
      },
    });
    this.trainingBuildBenchmarkDialogRef = dialogRef;
    this.trainingBuildBenchmarkDialogDiscipline = discipline;
    this.subscriptions.add(dialogRef.afterClosed().subscribe((result: { saved?: boolean; selection?: TrainingBuildBenchmarkSelection | null } | undefined) => {
      if (this.trainingBuildBenchmarkDialogRef === dialogRef) {
        this.trainingBuildBenchmarkDialogRef = null;
        this.trainingBuildBenchmarkDialogDiscipline = null;
      }
      if (!result?.saved) {
        return;
      }
      const selection = result.selection ?? null;
      this.analyticsService?.logEvent(
        'training_benchmark_saved',
        selection
          ? {
            action: 'set',
            discipline,
            reference_mode: selection.mode,
            duration_weeks: selection.durationWeeks,
          }
          : {
            action: 'cleared',
            discipline,
          },
      );
      this.trainingBuildRecoveryExpanded = {
        ...this.trainingBuildRecoveryExpanded,
        [discipline]: false,
      };
      this.pendingTrainingBuildSelections.set(discipline, result.selection ?? null);
      this.refreshTrainingBuildCards();
      this.changeDetector.markForCheck();
    }));
  }

  private resolveTrainingBuildEventSuggestionsState(
    source: DashboardTrainingBuildComparisonDiscipline | null,
  ): TrainingBuildEventSuggestionsState {
    if (source) {
      return 'ready';
    }
    return this.derivedState.trainingBuildComparisonStatus === 'failed'
      ? 'unavailable'
      : 'loading';
  }

  private formatTrainingBuildDistance(
    value: number | null | undefined,
    discipline: DerivedTrainingDiscipline = 'running',
  ): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '--';
    }
    const distance = discipline === 'swimming' ? new DataSwimDistance(value) : new DataDistance(value);
    const formattedDistance = resolveUnitAwareDisplayStat(distance, this.unitSettings, { stripRepeatedUnit: true })?.text;
    if (formattedDistance) {
      return formattedDistance;
    }
    return discipline === 'swimming'
      ? `${this.formatNumber(value, 0)} m`
      : `${this.formatNumber(value / 1000, 1)} km`;
  }

  private formatTrainingBuildDuration(value: number | null | undefined): string {
    return value === null || value === undefined || !Number.isFinite(value) ? '--' : formatSleepDuration(value);
  }

  private formatTrainingBuildDistanceDelta(
    current: number | null | undefined,
    benchmark: number | null | undefined,
    discipline: DerivedTrainingDiscipline,
  ): string {
    if (current === null || current === undefined || benchmark === null || benchmark === undefined) {
      return '--';
    }
    const delta = current - benchmark;
    return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${this.formatTrainingBuildDistance(Math.abs(delta), discipline)}`;
  }

  private formatTrainingBuildSwimPace(value: number | null | undefined): string {
    const usesYards = this.unitSettings?.swimPaceUnits?.[0] === SwimPaceUnits.MinutesPer100Yard;
    return formatTrainingSwimPace(value, usesYards);
  }

  private formatTrainingBuildSwimPaceDelta(
    current: number | null | undefined,
    benchmark: number | null | undefined,
  ): string {
    if (!Number.isFinite(current) || !Number.isFinite(benchmark)) {
      return '--';
    }
    const delta = (current as number) - (benchmark as number);
    if (Math.abs(delta) < 0.5) {
      return 'Same pace';
    }
    return `${this.formatTrainingBuildSwimPace(Math.abs(delta))} ${delta < 0 ? 'faster' : 'slower'}`;
  }

  private resolveTrainingComparisonDeltaTone(
    current: number | null | undefined,
    reference: number | null | undefined,
    direction: MetricSemanticsDirection | 'absolute-inverse' = 'direct',
    minimumAbsoluteDelta = 0,
  ): TrainingComparisonDeltaTone {
    if (!Number.isFinite(current) || !Number.isFinite(reference)) {
      return 'neutral';
    }
    const rawDelta = (current as number) - (reference as number);
    const semanticDelta = direction === 'absolute-inverse'
      ? Math.abs(current as number) - Math.abs(reference as number)
      : rawDelta;
    if (Math.abs(semanticDelta) < minimumAbsoluteDelta || semanticDelta === 0) {
      return 'neutral';
    }
    const isPositive = direction === 'direct' ? semanticDelta > 0 : semanticDelta < 0;
    return isPositive ? 'positive' : 'negative';
  }

  private formatTrainingBuildNumber(value: number | null | undefined, fractionDigits = 0): string {
    return this.formatNumber(value, fractionDigits);
  }

  private formatTrainingBuildActiveWeeks(
    activeWeekCount: number | null | undefined,
    periodWeeks: number | null | undefined,
  ): string {
    if (
      activeWeekCount === null
      || activeWeekCount === undefined
      || periodWeeks === null
      || periodWeeks === undefined
      || !Number.isFinite(activeWeekCount)
      || !Number.isFinite(periodWeeks)
      || periodWeeks <= 0
    ) {
      return '--';
    }
    return `${this.formatTrainingBuildNumber(activeWeekCount)} / ${this.formatTrainingBuildNumber(periodWeeks)}`;
  }

  public formatTrainingBuildDelta(current: number | null | undefined, benchmark: number | null | undefined, fractionDigits = 0): string {
    if (current === null || current === undefined || benchmark === null || benchmark === undefined) {
      return '--';
    }
    return this.formatNumber(current - benchmark, fractionDigits, true);
  }

  public formatTrainingBuildDurationDelta(current: number | null | undefined, benchmark: number | null | undefined): string {
    if (current === null || current === undefined || benchmark === null || benchmark === undefined) {
      return '--';
    }
    const delta = current - benchmark;
    if (delta === 0) {
      return 'Same';
    }
    return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatSleepDuration(Math.abs(delta))}`;
  }

  private formatTrainingBuildIntensity(
    window: DashboardTrainingBuildComparisonDiscipline['current'] | null | undefined,
  ): string {
    if (!window || window.easySeconds === null || window.moderateSeconds === null || window.hardSeconds === null) {
      return '--';
    }
    const total = window.easySeconds + window.moderateSeconds + window.hardSeconds;
    if (total <= 0) {
      return '--';
    }
    return `E ${this.formatPercent(window.easySeconds, total)} · M ${this.formatPercent(window.moderateSeconds, total)} · H ${this.formatPercent(window.hardSeconds, total)}`;
  }

  private formatTrainingBuildReference(source: DashboardTrainingBuildComparisonDiscipline | null): string {
    const selection = source?.selection;
    if (!selection) {
      return '';
    }
    if (selection.mode === 'event') {
      const eventLabel = resolveTrainingEventDisplayLabel(selection.label);
      if (eventLabel) {
        return eventLabel;
      }
      const anchorDayMs = selection.windowEndDayMs + TRAINING_DAY_MS;
      return Number.isFinite(anchorDayMs)
        ? `Event on ${this.formatTrainingUtcDate(anchorDayMs)}`
        : 'Historical event';
    }
    return 'Manual historical period';
  }

  private formatTrainingBuildRange(startDayMs: number | null | undefined, endDayMs: number | null | undefined): string {
    if (!Number.isFinite(startDayMs) || !Number.isFinite(endDayMs)) {
      return '';
    }
    return `${this.formatTrainingUtcDate(startDayMs as number)} – ${this.formatTrainingUtcDate(endDayMs as number)}`;
  }

  private formatTrainingUtcDate(dayMs: number): string {
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return formatter.format(new Date(dayMs));
  }

  private formatTrainingDataAsOfDate(dayMs: number): string {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    };
    try {
      return new Intl.DateTimeFormat(this.locale || undefined, options).format(new Date(dayMs));
    } catch {
      return new Intl.DateTimeFormat(undefined, options).format(new Date(dayMs));
    }
  }

  private refreshDerivedViewModels(): void {
    const nowMs = Date.now();
    const trainingSummaryAsOfDayMs = this.derivedState.trainingSummary?.asOfDayMs;
    this.trainingDataAsOfText = Number.isFinite(trainingSummaryAsOfDayMs)
      ? `Data through ${this.formatTrainingDataAsOfDate(trainingSummaryAsOfDayMs as number)}`
      : null;
    const formPoints = this.derivedState.formPoints;
    const currentTrainingState = buildCurrentTrainingStateContext({
      formPoints,
      fallbackFormNow: this.derivedState.formNow,
      fallbackRampRate: this.derivedState.rampRate,
      nowMs,
    });
    const currentFormNow = currentTrainingState.formNow;
    const currentRampRate = currentTrainingState.rampRate;
    const stateSignals = currentTrainingState.signals;
    const analysis = buildTrainingAnalysis({
      disciplines: this.derivedState.trainingSummary?.disciplines || [],
      stateSignals,
    });
    const forecastPoints = this.derivedState.freshnessForecast?.points || [];
    const latestCurrentPoint = [...forecastPoints].reverse().find(point => !point.isForecast);
    const finalForecastPoint = [...forecastPoints].reverse().find(point => point.isForecast);

    this.trainingComparisonState = resolveTrainingComparisonState(
      this.derivedState.trainingSummaryStatus,
      !!this.derivedState.trainingSummary,
      analysis.activities.current,
      analysis.activities.baseline,
    );
    const stateSignalStatuses = [
      currentTrainingState.formNowFromSeries ? this.derivedState.formStatus : this.derivedState.formNowStatus,
      currentTrainingState.rampRateFromSeries ? this.derivedState.formStatus : this.derivedState.rampRateStatus,
    ];
    const isTrainingStateUpdating = stateSignalStatuses.some(isDerivedMetricPendingStatus);
    this.trainingStatus = this.buildTrainingStatus(
      analysis,
      this.trainingComparisonState,
      isTrainingStateUpdating,
      currentTrainingState.info,
    );
    this.trainingExplanationView = buildTrainingExplanationViewModel(this.derivedState.trainingExplanation);
    this.bodyWeightTrend = buildTrainingBodyWeightViewModel(
      this.derivedState.bodyWeightTrend,
      this.derivedState.bodyWeightTrendStatus,
      this.unitSettings,
    );
    this.refreshTrainingRecoveryEstimate();
    this.trainingRecovery = this.buildTrainingRecoveryViewModel(
      this.derivedState.trainingBuildComparison?.recovery || null,
      'Now',
      'Usual',
      analysis,
    );
    this.refreshTrainingReadiness();
    this.loadMetrics = {
      ctlText: this.formatNumber(currentTrainingState.fitness?.value, 0),
      atlText: this.formatNumber(currentTrainingState.fatigue?.value, 0),
      rampText: this.formatNumber(currentRampRate?.rampRate, 2, true),
      acwrText: this.formatNumber(this.derivedState.acwr?.ratio, 2),
      monotonyText: this.formatNumber(this.derivedState.monotonyStrain?.monotony, 2),
      strainText: this.formatNumber(this.derivedState.monotonyStrain?.strain, 0),
      freshnessNowText: this.formatNumber(currentFormNow?.value ?? latestCurrentPoint?.formSameDay, 0, true),
      freshnessPlusSevenDaysText: this.formatNumber(finalForecastPoint?.formSameDay ?? this.derivedState.formPlus7d?.value, 1, true),
    };
    this.trainingLoadGuidance = buildTrainingLoadGuidance(
      currentFormNow?.value ?? latestCurrentPoint?.formSameDay ?? null,
      finalForecastPoint?.formSameDay ?? this.derivedState.formPlus7d?.value ?? null,
    );
  }

  private refreshTrainingRecoveryEstimate(): void {
    this.trainingRecoveryEstimate = buildTrainingRecoveryEstimateViewModel(
      this.derivedState.recoveryNow,
      this.derivedState.recoveryNowStatus,
    );
  }

  private syncTrainingReadinessSleepSubscription(uid: string): void {
    const window = buildDashboardReadinessSleepQueryWindow();
    this.readinessSleepLoading = true;
    this.readinessSleepFailed = false;
    this.dataSubscriptions.add(this.sleepService.watchForDashboard(uid, window.startMs, window.endMs).subscribe({
      next: (sessions) => {
        this.readinessSleepSessions = sessions;
        this.readinessSleepLoading = false;
        this.readinessSleepFailed = false;
        this.updateTrainingReadinessSleepRefreshTimer();
        this.refreshTrainingReadiness();
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.readinessSleepLoading = false;
        this.readinessSleepFailed = true;
        this.updateTrainingReadinessSleepRefreshTimer();
        this.refreshTrainingReadiness();
        this.changeDetector.markForCheck();
      },
    }));
  }

  private refreshTrainingReadiness(): void {
    const nowMs = Date.now();
    const formNowFromSeries = resolveDashboardFormNowContextFromPoints(this.derivedState.formPoints, nowMs);
    const rampRateFromSeries = resolveDashboardRampRateContextFromPoints(this.derivedState.formPoints, nowMs);
    const formNow = formNowFromSeries
      || this.derivedState.formNow;
    const rampRate = rampRateFromSeries
      || this.derivedState.rampRate;
    const loadStatuses = [
      formNowFromSeries ? this.derivedState.formStatus : this.derivedState.formNowStatus,
      rampRateFromSeries ? this.derivedState.formStatus : this.derivedState.rampRateStatus,
    ];
    const isUpdating = this.readinessSleepLoading
      || !this.hasReceivedDerivedState
      || loadStatuses
        .some(status => isDerivedMetricPendingStatus(status));
    const context = buildDashboardReadinessSignalsContext({
      formNow,
      rampRate,
      sleepTrend: buildDashboardSleepTrendContext(this.readinessSleepSessions),
      nowMs,
    });
    this.trainingReadiness = buildTrainingReadinessViewModel(context, {
      isPreparing: !context && isUpdating,
      isUpdating,
      calculatedAtMs: nowMs,
      sleepEvidenceFailed: this.readinessSleepFailed,
      loadEvidenceFailed: loadStatuses
        .some(status => status === 'failed'),
      history: this.derivedState.trainingReadiness,
      historyStatus: this.derivedState.trainingReadinessStatus,
    });
  }

  private updateTrainingReadinessSleepRefreshTimer(): void {
    this.clearTrainingReadinessSleepRefreshTimer();
    const nowMs = Date.now();
    const refreshAtMs = resolveDashboardReadinessSleepRefreshAtMs(
      buildDashboardSleepTrendContext(this.readinessSleepSessions),
      nowMs,
    );
    if (refreshAtMs === null || refreshAtMs <= nowMs) {
      return;
    }
    this.readinessSleepRefreshTimeoutHandle = globalThis.setTimeout(() => {
      this.readinessSleepRefreshTimeoutHandle = null;
      this.refreshTrainingReadiness();
      this.updateTrainingReadinessSleepRefreshTimer();
      this.changeDetector.markForCheck();
    }, refreshAtMs - nowMs);
  }

  private clearTrainingReadinessSleepRefreshTimer(): void {
    if (this.readinessSleepRefreshTimeoutHandle === null) {
      return;
    }
    globalThis.clearTimeout(this.readinessSleepRefreshTimeoutHandle);
    this.readinessSleepRefreshTimeoutHandle = null;
  }

  private scheduleTrainingReadinessDayRollover(): void {
    this.clearTrainingReadinessDayRolloverTimer();
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const nextUtcDayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const handleRollover = (): void => {
      this.readinessDayRolloverTimeoutHandle = null;
      const refresh = (): void => {
        this.refreshTrainingReadiness();
        const uid = this.currentUserUID;
        if (uid) {
          this.derivedMetricsService.ensureForDashboard({ uid }, this.derivedState, {
            force: true,
            metricKinds: [
              DERIVED_METRIC_KINDS.FormNow,
              DERIVED_METRIC_KINDS.RampRate,
              DERIVED_METRIC_KINDS.FormPlus7d,
              DERIVED_METRIC_KINDS.FreshnessForecast,
              DERIVED_METRIC_KINDS.TrainingReadiness,
              DERIVED_METRIC_KINDS.BodyWeightTrend,
            ],
          });
        }
        this.scheduleTrainingReadinessDayRollover();
        this.changeDetector.markForCheck();
      };
      if (this.ngZone) {
        this.ngZone.run(refresh);
      } else {
        refresh();
      }
    };
    const schedule = (): ReturnType<typeof setTimeout> => globalThis.setTimeout(
      handleRollover,
      Math.max(1, nextUtcDayMs - nowMs + 1),
    );
    this.readinessDayRolloverTimeoutHandle = this.ngZone
      ? this.ngZone.runOutsideAngular(schedule)
      : schedule();
  }

  private clearTrainingReadinessDayRolloverTimer(): void {
    if (this.readinessDayRolloverTimeoutHandle === null) {
      return;
    }
    globalThis.clearTimeout(this.readinessDayRolloverTimeoutHandle);
    this.readinessDayRolloverTimeoutHandle = null;
  }

  private refreshTrainingBuildCards(): void {
    this.trainingBuildCards = this.buildTrainingBuildCards();
    this.syncTrainingBuildBenchmarkDialogSuggestions();
  }

  private syncTrainingBuildBenchmarkDialogSuggestions(): void {
    const dialogRef = this.trainingBuildBenchmarkDialogRef;
    const discipline = this.trainingBuildBenchmarkDialogDiscipline;
    if (!dialogRef || !discipline) {
      return;
    }
    const card = this.trainingBuildCards.find(item => item.discipline === discipline);
    dialogRef.componentInstance.updateEventSuggestions({
      asOfDayMs: this.derivedState.trainingBuildComparison?.asOfDayMs ?? this.resolveCurrentUtcDayMs(),
      suggestedRaces: card?.source?.suggestedRaces || [],
      suggestedEvents: card?.source?.suggestedEvents || [],
      state: this.resolveTrainingBuildEventSuggestionsState(card?.source || null),
    });
  }

  private buildTrainingBuildCards(): TrainingBuildCardViewModel[] {
    const contexts = this.derivedState.trainingBuildComparison?.disciplines || [];
    return TRAINING_VISIBLE_DISCIPLINES.filter(discipline => (
      this.selectedTrainingSport?.id === discipline
      && hasTrainingSportCapability(discipline, 'best-build')
    )).map((discipline) => {
      const source = contexts.find(item => item.discipline === discipline) || null;
      const expectedSelection = this.resolveEffectiveTrainingBuildSelection(discipline);
      const state = this.resolveTrainingBuildCardState(discipline, source, expectedSelection);
      const isVolumeOnly = this.areObservedTrainingContextsVolumeOnly([
        ...(source?.current?.contexts || []),
        ...(source?.benchmark?.contexts || []),
      ], 'loadPolicy');
      return {
        discipline,
        label: formatTrainingVisibleDisciplinesLabel([discipline]),
        state,
        source,
        expectedSelection,
        referenceText: this.formatTrainingBuildReference(source),
        rangeText: this.formatTrainingBuildRange(
          source?.selection?.windowStartDayMs,
          source?.selection?.windowEndDayMs,
        ),
        emptyMessage: this.resolveTrainingBuildEmptyMessage(source),
        guidance: buildTrainingBuildGuidance(source, isVolumeOnly ? 'volume-only' : 'recorded'),
        metricRows: this.buildTrainingBuildMetricRows(source, discipline),
        recovery: state === 'ready' && source?.recovery
          ? this.buildTrainingRecoveryViewModel(source.recovery, 'Now', 'Benchmark')
          : null,
        footnote: this.formatTrainingBuildFootnote(discipline),
      };
    });
  }

  private areObservedTrainingContextsVolumeOnly(
    contexts: readonly { context: TrainingSportContextId }[],
    policy: 'intensityPolicy' | 'loadPolicy',
  ): boolean {
    return contexts.length > 0 && contexts.every(
      context => getTrainingSportContextDefinition(context.context)?.[policy] === 'volume-only',
    );
  }

  private buildTrainingRecoveryViewModel(
    comparison: DashboardTrainingRecoveryComparison | null,
    currentLabel: string,
    referenceLabel: string,
    analysis?: TrainingAnalysis,
  ): TrainingRecoveryViewModel {
    const snapshotStatus = this.derivedState.trainingBuildComparisonStatus;
    const isUpdating = snapshotStatus !== 'ready' && snapshotStatus !== 'failed';
    if (snapshotStatus === 'failed') {
      return {
        state: 'unavailable',
        isUpdating: false,
        currentLabel,
        referenceLabel,
        compactText: 'Recovery context unavailable.',
        detailText: 'Recovery context could not be refreshed. Refresh to request another derived snapshot.',
        sourceText: 'Sleep values are withheld because this derived snapshot may be incomplete or stale. Sleep context does not change your Training state.',
        metricRows: [],
      };
    }
    if (!comparison) {
      return {
        state: 'updating',
        isUpdating,
        currentLabel,
        referenceLabel,
        compactText: 'Updating recovery context…',
        detailText: 'Preparing recovery context from your recorded overnight sleep.',
        sourceText: 'Sleep context does not change your Training state.',
        metricRows: [],
      };
    }
    const hasRecordedSleep = comparison.current.recordedNightCount > 0
      || comparison.reference.recordedNightCount > 0;
    const state: TrainingRecoveryState = !hasRecordedSleep
      ? 'empty'
      : (comparison.isComparable ? 'ready' : 'limited');
    const detailText = this.resolveTrainingRecoveryDetail(comparison, currentLabel, referenceLabel, analysis);
    return {
      state,
      isUpdating,
      currentLabel,
      referenceLabel,
      compactText: this.resolveTrainingRecoveryCompactText(comparison, detailText),
      detailText,
      sourceText: this.resolveTrainingRecoverySourceText(comparison, currentLabel, referenceLabel),
      metricRows: hasRecordedSleep ? this.buildTrainingRecoveryRows(comparison) : [],
    };
  }

  private resolveTrainingRecoveryCompactText(
    comparison: DashboardTrainingRecoveryComparison,
    fallbackText: string,
  ): string {
    if (!comparison.isComparable) {
      return fallbackText;
    }
    const summary: string[] = [];
    const sleepCurrent = comparison.current.averageSleepSeconds;
    const sleepReference = comparison.reference.averageSleepSeconds;
    if (sleepCurrent !== null && sleepReference !== null) {
      const sleepDelta = sleepCurrent - sleepReference;
      summary.push(Math.abs(sleepDelta) < TRAINING_RECOVERY_MEANINGFUL_SLEEP_DELTA_SECONDS
        ? 'Sleep is similar per night'
        : `Sleep ${this.formatTrainingRecoveryDuration(Math.abs(sleepDelta))} ${sleepDelta > 0 ? 'longer' : 'shorter'} per night`);
    }
    const hrvCurrent = comparison.current.medianOvernightHrvMs;
    const hrvReference = comparison.reference.medianOvernightHrvMs;
    if (hrvCurrent !== null && hrvReference !== null) {
      const hrvDelta = hrvCurrent - hrvReference;
      summary.push(Math.abs(hrvDelta) < 0.05
        ? 'Overnight HRV is similar'
        : `Overnight HRV ${this.formatTrainingRecoveryHrvDelta(hrvCurrent, hrvReference)}`);
    }
    const bedtimeCurrent = comparison.current.bedtimeVariationMinutes;
    const bedtimeReference = comparison.reference.bedtimeVariationMinutes;
    if (summary.length < 2 && bedtimeCurrent !== null && bedtimeReference !== null) {
      const bedtimeDelta = this.formatTrainingRecoveryVariationDelta(bedtimeCurrent, bedtimeReference);
      summary.push(bedtimeDelta === 'Same' ? 'Bedtime consistency is similar' : `Bedtime ${bedtimeDelta}`);
    }
    return summary.join(' · ') || fallbackText;
  }

  private buildTrainingRecoveryRows(
    comparison: DashboardTrainingRecoveryComparison,
  ): TrainingRecoveryMetricRowViewModel[] {
    const { current, reference, isComparable } = comparison;
    return [{
      label: 'Sleep / night',
      currentText: this.formatTrainingRecoveryDuration(current.averageSleepSeconds),
      referenceText: this.formatTrainingRecoveryDuration(reference.averageSleepSeconds),
      deltaText: isComparable
        ? this.formatTrainingRecoveryDurationDelta(current.averageSleepSeconds, reference.averageSleepSeconds)
        : '—',
      deltaTone: isComparable
        ? this.resolveTrainingComparisonDeltaTone(current.averageSleepSeconds, reference.averageSleepSeconds, 'direct', 60)
        : 'neutral',
    }, {
      label: 'Typical sleep window',
      currentText: this.formatTrainingRecoverySleepWindow(current),
      referenceText: this.formatTrainingRecoverySleepWindow(reference),
      deltaText: isComparable
        ? this.formatTrainingRecoverySleepStartDelta(
          current.typicalLocalStartMinutes,
          reference.typicalLocalStartMinutes,
        )
        : '—',
      deltaTone: 'neutral',
    }, {
      label: 'Recorded nights',
      currentText: `${current.recordedNightCount} / ${current.expectedNightCount}`,
      referenceText: `${reference.recordedNightCount} / ${reference.expectedNightCount}`,
      deltaText: isComparable ? this.formatTrainingRecoveryCoverageDelta(current, reference) : '—',
      deltaTone: isComparable ? this.resolveTrainingRecoveryCoverageDeltaTone(current, reference) : 'neutral',
    }, {
      label: 'Bedtime variation',
      currentText: this.formatTrainingRecoveryVariation(current.bedtimeVariationMinutes),
      referenceText: this.formatTrainingRecoveryVariation(reference.bedtimeVariationMinutes),
      deltaText: isComparable
        ? this.formatTrainingRecoveryVariationDelta(current.bedtimeVariationMinutes, reference.bedtimeVariationMinutes)
        : '—',
      deltaTone: isComparable
        ? this.resolveTrainingComparisonDeltaTone(current.bedtimeVariationMinutes, reference.bedtimeVariationMinutes, 'inverse', 0.5)
        : 'neutral',
    }, {
      label: 'Overnight HRV',
      currentText: this.formatTrainingRecoveryHrv(current.medianOvernightHrvMs),
      referenceText: this.formatTrainingRecoveryHrv(reference.medianOvernightHrvMs),
      deltaText: isComparable
        ? this.formatTrainingRecoveryHrvDelta(current.medianOvernightHrvMs, reference.medianOvernightHrvMs)
        : '—',
      deltaTone: isComparable
        ? this.resolveTrainingComparisonDeltaTone(current.medianOvernightHrvMs, reference.medianOvernightHrvMs, 'direct', 0.05)
        : 'neutral',
    }];
  }

  private resolveTrainingRecoveryCoverageDeltaTone(
    current: DashboardTrainingRecoveryWindow,
    reference: DashboardTrainingRecoveryWindow,
  ): TrainingComparisonDeltaTone {
    const deltaPoints = this.resolveTrainingRecoveryCoverageDeltaPoints(current, reference);
    return deltaPoints === null
      ? 'neutral'
      : this.resolveTrainingComparisonDeltaTone(deltaPoints, 0);
  }

  private resolveTrainingRecoveryDetail(
    comparison: DashboardTrainingRecoveryComparison,
    currentLabel: string,
    referenceLabel: string,
    analysis?: TrainingAnalysis,
  ): string {
    const { current, reference } = comparison;
    if (current.recordedNightCount === 0 && reference.recordedNightCount === 0) {
      return 'No recorded overnight sleep in these windows. Sync sleep from a supported provider to add recovery context.';
    }
    if (!comparison.sameProvider && current.provider && reference.provider) {
      return `${currentLabel} and ${referenceLabel.toLowerCase()} use different sleep providers, so values are shown without deltas.`;
    }
    if (!comparison.isComparable) {
      const currentMinimum = getDerivedTrainingRecoveryMinimumComparableNights(current.expectedNightCount);
      const referenceMinimum = getDerivedTrainingRecoveryMinimumComparableNights(reference.expectedNightCount);
      return `More recorded nights are needed for a fair comparison (${current.recordedNightCount} / ${currentMinimum} ${currentLabel.toLowerCase()}, ${reference.recordedNightCount} / ${referenceMinimum} ${referenceLabel.toLowerCase()}).`;
    }
    if (!analysis) {
      const hasUnavailableMetric = [
        current.averageSleepSeconds,
        reference.averageSleepSeconds,
        current.typicalLocalStartMinutes,
        current.typicalLocalEndMinutes,
        reference.typicalLocalStartMinutes,
        reference.typicalLocalEndMinutes,
        current.bedtimeVariationMinutes,
        reference.bedtimeVariationMinutes,
        current.medianOvernightHrvMs,
        reference.medianOvernightHrvMs,
      ].some(value => value === null);
      return hasUnavailableMetric
        ? 'Recorded sleep coverage supports comparison where matching metrics are available.'
        : 'Recorded recovery is comparable across both build windows.';
    }
    const loadDelta = analysis.duration.deltaPercent;
    const sleepDeltaSeconds = current.averageSleepSeconds !== null && reference.averageSleepSeconds !== null
      ? current.averageSleepSeconds - reference.averageSleepSeconds
      : null;
    const loadText = loadDelta === null
      ? 'Your usual training-time baseline is still building.'
      : (Math.abs(loadDelta) < 10
        ? 'Training time is close to your usual level.'
        : `Training time is ${this.formatNumber(Math.abs(loadDelta), 0)}% ${loadDelta > 0 ? 'above' : 'below'} usual.`);
    const sleepText = sleepDeltaSeconds === null
      || Math.abs(sleepDeltaSeconds) < TRAINING_RECOVERY_MEANINGFUL_SLEEP_DELTA_SECONDS
      ? 'Recorded sleep per night is similar.'
      : `Recorded sleep averages ${this.formatTrainingRecoveryDuration(Math.abs(sleepDeltaSeconds))} ${sleepDeltaSeconds > 0 ? 'longer' : 'shorter'} per night.`;
    return `${loadText} ${sleepText}`;
  }

  private resolveTrainingRecoverySourceText(
    comparison: DashboardTrainingRecoveryComparison,
    currentLabel: string,
    referenceLabel: string,
  ): string {
    const currentProvider = this.formatTrainingSleepProvider(comparison.current.provider);
    const referenceProvider = this.formatTrainingSleepProvider(comparison.reference.provider);
    const providerText = comparison.sameProvider && currentProvider
      ? currentProvider
      : (currentProvider || referenceProvider
        ? `${currentLabel}: ${currentProvider || 'no data'} · ${referenceLabel}: ${referenceProvider || 'no data'}`
        : 'No sleep source');
    const contextNote = referenceLabel === 'Usual'
      ? 'Main overnight sleep only; naps are excluded. Sleep context does not change your Training state.'
      : 'Main overnight sleep only; naps are excluded. This is context, not an explanation of training changes.';
    const hasMissingSleepTimingEvidence = [comparison.current, comparison.reference].some(window => (
      window.recordedNightCount >= DERIVED_TRAINING_RECOVERY_MIN_REGULARITY_NIGHTS
      && (
        window.bedtimeVariationMinutes === null
        || window.typicalLocalStartMinutes === null
        || window.typicalLocalEndMinutes === null
      )
    ));
    const sleepTimingNote = hasMissingSleepTimingEvidence
      ? ' Bedtime variation and the typical sleep window need at least five nights with local start and end times.'
      : '';
    const hasMissingHrvEvidence = [comparison.current, comparison.reference].some(window => (
      window.recordedNightCount >= DERIVED_TRAINING_RECOVERY_MIN_HRV_NIGHTS
      && window.medianOvernightHrvMs === null
    ));
    const hrvNote = hasMissingHrvEvidence
      ? ' Overnight HRV needs at least five nights that include HRV data.'
      : '';
    return `${providerText} · ${contextNote}${sleepTimingNote}${hrvNote}`;
  }

  private formatTrainingSleepProvider(provider: DashboardTrainingRecoveryWindow['provider']): string | null {
    if (provider === 'GarminAPI') {
      return 'Garmin';
    }
    if (provider === 'SuuntoApp') {
      return 'Suunto';
    }
    if (provider === 'COROSAPI') {
      return 'COROS';
    }
    return null;
  }

  private formatTrainingRecoveryDuration(value: number | null): string {
    return value === null ? '--' : formatSleepDuration(value);
  }

  private formatTrainingRecoverySleepWindow(window: DashboardTrainingRecoveryWindow): string {
    const { typicalLocalStartMinutes, typicalLocalEndMinutes } = window;
    if (typicalLocalStartMinutes === null || typicalLocalEndMinutes === null) {
      return '--';
    }
    return `${this.formatTrainingRecoveryClockTime(typicalLocalStartMinutes)}\n${this.formatTrainingRecoveryClockTime(typicalLocalEndMinutes)}`;
  }

  private formatTrainingRecoverySleepStartDelta(current: number | null, reference: number | null): string {
    if (current === null || reference === null) {
      return '--';
    }
    const rawDelta = current - reference;
    const normalizedDelta = ((rawDelta + (12 * 60)) % (24 * 60) + (24 * 60)) % (24 * 60) - (12 * 60);
    const deltaMinutes = normalizedDelta === -(12 * 60) ? 12 * 60 : normalizedDelta;
    if (Math.abs(deltaMinutes) < 5) {
      return 'Same start';
    }
    return `${Math.abs(deltaMinutes)}m ${deltaMinutes > 0 ? 'later' : 'earlier'}`;
  }

  private formatTrainingRecoveryClockTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}`;
  }

  private formatTrainingRecoveryDurationDelta(current: number | null, reference: number | null): string {
    if (current === null || reference === null) {
      return '--';
    }
    const delta = current - reference;
    if (Math.abs(delta) < 60) {
      return 'Same';
    }
    return `${delta > 0 ? '+' : '−'}${this.formatTrainingRecoveryDuration(Math.abs(delta))}`;
  }

  private formatTrainingRecoveryCoverageDelta(
    current: DashboardTrainingRecoveryWindow,
    reference: DashboardTrainingRecoveryWindow,
  ): string {
    const deltaPoints = this.resolveTrainingRecoveryCoverageDeltaPoints(current, reference);
    if (deltaPoints === null) {
      return '--';
    }
    if (deltaPoints === 0) {
      return 'Same coverage';
    }
    const pointLabel = Math.abs(deltaPoints) === 1 ? 'pt' : 'pts';
    return `${deltaPoints > 0 ? '+' : '−'}${Math.abs(deltaPoints)} ${pointLabel}`;
  }

  private resolveTrainingRecoveryCoverageDeltaPoints(
    current: DashboardTrainingRecoveryWindow,
    reference: DashboardTrainingRecoveryWindow,
  ): number | null {
    if (current.expectedNightCount <= 0 || reference.expectedNightCount <= 0) {
      return null;
    }
    const currentCoverage = current.recordedNightCount / current.expectedNightCount;
    const referenceCoverage = reference.recordedNightCount / reference.expectedNightCount;
    return Math.round((currentCoverage - referenceCoverage) * 100);
  }

  private formatTrainingRecoveryVariation(value: number | null): string {
    return value === null ? '--' : `±${this.formatNumber(value, 0)}m`;
  }

  private formatTrainingRecoveryVariationDelta(current: number | null, reference: number | null): string {
    if (current === null || reference === null) {
      return '--';
    }
    const delta = Math.round(current - reference);
    if (delta === 0) {
      return 'Same';
    }
    return `${Math.abs(delta)}m ${delta < 0 ? 'steadier' : 'more variable'}`;
  }

  private formatTrainingRecoveryHrv(value: number | null): string {
    return value === null ? '--' : `${this.formatNumber(value, 1)} ms`;
  }

  private formatTrainingRecoveryHrvDelta(current: number | null, reference: number | null): string {
    if (current === null || reference === null) {
      return '--';
    }
    const delta = current - reference;
    if (Math.abs(delta) < 0.05) {
      return 'Same';
    }
    return `${this.formatNumber(delta, 1, true)} ms`;
  }

  private resolveTrainingBuildEmptyMessage(source: DashboardTrainingBuildComparisonDiscipline | null): string | null {
    if (source?.current?.activityCount === 0) {
      return 'No eligible workouts in the current window.';
    }
    if (source?.benchmark?.activityCount === 0) {
      return 'No eligible workouts in the saved benchmark window.';
    }
    return null;
  }

  private buildTrainingBuildMetricRows(
    source: DashboardTrainingBuildComparisonDiscipline | null,
    discipline: DerivedTrainingDiscipline,
  ): TrainingBuildMetricRowViewModel[] {
    const current = source?.current;
    const benchmark = source?.benchmark;
    if (!current || !benchmark) {
      return [];
    }
    const rows: TrainingBuildMetricRowViewModel[] = [
      {
        label: 'Distance',
        currentText: this.formatTrainingBuildDistance(current.distanceMeters, discipline),
        benchmarkText: this.formatTrainingBuildDistance(benchmark.distanceMeters, discipline),
        deltaText: this.formatTrainingBuildDistanceDelta(current.distanceMeters, benchmark.distanceMeters, discipline),
        deltaTone: this.resolveTrainingComparisonDeltaTone(current.distanceMeters, benchmark.distanceMeters),
        isIntensity: false,
      },
      {
        label: 'Time',
        currentText: this.formatTrainingBuildDuration(current.durationSeconds),
        benchmarkText: this.formatTrainingBuildDuration(benchmark.durationSeconds),
        deltaText: this.formatTrainingBuildDurationDelta(current.durationSeconds, benchmark.durationSeconds),
        deltaTone: this.resolveTrainingComparisonDeltaTone(current.durationSeconds, benchmark.durationSeconds),
        isIntensity: false,
      },
      {
        label: 'Workouts',
        currentText: this.formatTrainingBuildNumber(current.activityCount),
        benchmarkText: this.formatTrainingBuildNumber(benchmark.activityCount),
        deltaText: this.formatTrainingBuildDelta(current.activityCount, benchmark.activityCount),
        deltaTone: this.resolveTrainingComparisonDeltaTone(current.activityCount, benchmark.activityCount),
        isIntensity: false,
      },
      {
        label: 'Active weeks',
        currentText: this.formatTrainingBuildActiveWeeks(current.activeWeekCount, current.periodWeeks),
        benchmarkText: this.formatTrainingBuildActiveWeeks(benchmark.activeWeekCount, benchmark.periodWeeks),
        deltaText: this.formatTrainingBuildDelta(current.activeWeekCount, benchmark.activeWeekCount),
        deltaTone: this.resolveTrainingComparisonDeltaTone(current.activeWeekCount, benchmark.activeWeekCount),
        isIntensity: false,
      },
      {
        label: 'Longest workout',
        currentText: this.formatTrainingBuildDuration(current.longestActivityDurationSeconds),
        benchmarkText: this.formatTrainingBuildDuration(benchmark.longestActivityDurationSeconds),
        deltaText: this.formatTrainingBuildDurationDelta(
          current.longestActivityDurationSeconds,
          benchmark.longestActivityDurationSeconds,
        ),
        deltaTone: this.resolveTrainingComparisonDeltaTone(
          current.longestActivityDurationSeconds,
          benchmark.longestActivityDurationSeconds,
        ),
        isIntensity: false,
      },
    ];
    if (!getTrainingSportDefinition(discipline)?.contexts.some(context => context.distancePolicy === 'recorded')) {
      rows.shift();
    }
    rows.push(...this.buildTrainingBuildContextMetricRows(current, benchmark, discipline));
    if (discipline === 'swimming') {
      rows.push({
        label: 'Pool pace',
        currentText: this.formatTrainingBuildSwimPace(current.poolAveragePaceSecondsPer100m),
        benchmarkText: this.formatTrainingBuildSwimPace(benchmark.poolAveragePaceSecondsPer100m),
        deltaText: this.formatTrainingBuildSwimPaceDelta(
          current.poolAveragePaceSecondsPer100m,
          benchmark.poolAveragePaceSecondsPer100m,
        ),
        deltaTone: this.resolveTrainingComparisonDeltaTone(
          current.poolAveragePaceSecondsPer100m,
          benchmark.poolAveragePaceSecondsPer100m,
          TRAINING_SWIM_PACE_DELTA_DIRECTION,
          0.5,
        ),
        isIntensity: false,
      }, {
        label: 'Open-water pace',
        currentText: this.formatTrainingBuildSwimPace(current.openWaterAveragePaceSecondsPer100m),
        benchmarkText: this.formatTrainingBuildSwimPace(benchmark.openWaterAveragePaceSecondsPer100m),
        deltaText: this.formatTrainingBuildSwimPaceDelta(
          current.openWaterAveragePaceSecondsPer100m,
          benchmark.openWaterAveragePaceSecondsPer100m,
        ),
        deltaTone: this.resolveTrainingComparisonDeltaTone(
          current.openWaterAveragePaceSecondsPer100m,
          benchmark.openWaterAveragePaceSecondsPer100m,
          TRAINING_SWIM_PACE_DELTA_DIRECTION,
          0.5,
        ),
        isIntensity: false,
      });
    }
    if (current.trainingStressScore !== null || benchmark.trainingStressScore !== null) {
      rows.push({
        label: 'TSS',
        currentText: this.formatTrainingBuildNumber(current.trainingStressScore),
        benchmarkText: this.formatTrainingBuildNumber(benchmark.trainingStressScore),
        deltaText: this.formatTrainingBuildDelta(current.trainingStressScore, benchmark.trainingStressScore),
        deltaTone: this.resolveTrainingComparisonDeltaTone(current.trainingStressScore, benchmark.trainingStressScore),
        isIntensity: false,
      });
    }
    rows.push(...this.buildTrainingBuildDurabilityRows(source));
    if (current.intensitySourceEventCount || benchmark.intensitySourceEventCount) {
      rows.push({
        label: 'Intensity mix',
        currentText: this.formatTrainingBuildIntensity(current),
        benchmarkText: this.formatTrainingBuildIntensity(benchmark),
        deltaText: '—',
        isIntensity: true,
      });
    }
    return rows;
  }

  private buildTrainingBuildContextMetricRows(
    current: DashboardTrainingBuildWindow,
    benchmark: DashboardTrainingBuildWindow,
    discipline: DerivedTrainingDiscipline,
  ): TrainingBuildMetricRowViewModel[] {
    const currentContexts = current.contexts || [];
    const benchmarkContexts = benchmark.contexts || [];
    const currentByContext = new Map(currentContexts.map(context => [context.context, context]));
    const benchmarkByContext = new Map(benchmarkContexts.map(context => [context.context, context]));
    return this.buildTrainingContextMetricViews(currentContexts, benchmarkContexts, discipline)
      .flatMap(context => context.metrics.map((metric) => {
        const currentValue = currentByContext.get(context.context)?.metrics
          .find(candidate => candidate.metric === metric.metric)?.value;
        const benchmarkValue = benchmarkByContext.get(context.context)?.metrics
          .find(candidate => candidate.metric === metric.metric)?.value;
        return {
          label: `${context.label} · ${metric.label}`,
          currentText: metric.currentText,
          benchmarkText: metric.referenceText,
          deltaText: this.formatTrainingProfileMetricDelta(
            metric.metric,
            currentValue,
            benchmarkValue,
            discipline,
          ),
          deltaTone: 'neutral' as const,
          isIntensity: false,
        };
      }));
  }

  private buildTrainingBuildDurabilityRows(
    source: DashboardTrainingBuildComparisonDiscipline,
  ): TrainingBuildMetricRowViewModel[] {
    return (source.durabilityComparisons || []).flatMap((comparison) => {
      const current = comparison.current;
      const benchmark = comparison.benchmark;
      if (!current && !benchmark) {
        return [];
      }
      const contextLabel = this.formatTrainingBuildDurabilityContext(comparison.context);
      const rows: TrainingBuildMetricRowViewModel[] = [{
        label: `${contextLabel} evidence`,
        currentText: current ? `${current.sampleCount} ${current.sampleCount === 1 ? 'workout' : 'workouts'}` : '—',
        benchmarkText: benchmark ? `${benchmark.sampleCount} ${benchmark.sampleCount === 1 ? 'workout' : 'workouts'}` : '—',
        deltaText: comparison.isComparable ? 'Comparable' : 'Limited',
        deltaTone: 'neutral',
        isIntensity: false,
      }];
      if (!comparison.isComparable || !current || !benchmark) {
        return rows;
      }
      const metrics = [{
        label: `${contextLabel} decoupling`,
        current: current.medianDecouplingPercent,
        benchmark: benchmark.medianDecouplingPercent,
        suffix: '%',
        direction: 'absolute-inverse' as const,
      }, {
        label: `${contextLabel} output retained`,
        current: current.medianOutputRetentionPercent,
        benchmark: benchmark.medianOutputRetentionPercent,
        suffix: '%',
        direction: 'direct' as const,
      }, {
        label: `${contextLabel} HR drift`,
        current: current.medianHeartRateDriftBpm,
        benchmark: benchmark.medianHeartRateDriftBpm,
        suffix: ' bpm',
        direction: 'absolute-inverse' as const,
      }, {
        label: `${contextLabel} pace retained`,
        current: current.medianPaceRetentionPercent,
        benchmark: benchmark.medianPaceRetentionPercent,
        suffix: '%',
        direction: 'direct' as const,
      }, {
        label: `${contextLabel} SWOLF change`,
        current: current.medianSwolfChange,
        benchmark: benchmark.medianSwolfChange,
        suffix: '',
        direction: 'inverse' as const,
      }];
      return [...rows, ...metrics.flatMap((metric) => {
        if (metric.current === null && metric.benchmark === null) {
          return [];
        }
        const delta = metric.current !== null && metric.benchmark !== null
          ? metric.current - metric.benchmark
          : null;
        return [{
          label: metric.label,
          currentText: this.formatTrainingBuildDurabilityMetric(metric.current, metric.suffix),
          benchmarkText: this.formatTrainingBuildDurabilityMetric(metric.benchmark, metric.suffix),
          deltaText: delta === null
            ? '—'
            : (Math.abs(delta) < 0.05 ? 'Same' : `${delta > 0 ? '+' : '−'}${this.formatTrainingBuildDurabilityMetric(Math.abs(delta), metric.suffix)}`),
          deltaTone: this.resolveTrainingComparisonDeltaTone(
            metric.current,
            metric.benchmark,
            metric.direction,
            0.05,
          ),
          isIntensity: false,
        }];
      })];
    });
  }

  private formatTrainingBuildDurabilityContext(
    context: DashboardTrainingBuildComparisonDiscipline['durabilityComparisons'][number]['context'],
  ): string {
    if (context.scope === 'pool-swimming') {
      return `${context.poolLengthMeters === null ? 'Pool' : `${this.formatNumber(context.poolLengthMeters, 0)} m`} ${context.stroke || 'swim'}`;
    }
    if (context.scope === 'open-water-swimming') {
      return 'Open-water';
    }
    if (context.outputSource === 'grade-adjusted-speed') {
      return 'Grade-adjusted';
    }
    return context.outputSource === 'power' ? 'Power' : 'Speed';
  }

  private formatTrainingBuildDurabilityMetric(value: number | null, suffix: string): string {
    return value === null ? '—' : `${this.formatNumber(value, 1)}${suffix}`;
  }

  private resolveEffectiveTrainingBuildSelection(discipline: DerivedTrainingDiscipline): TrainingBuildBenchmarkSelection | null {
    if (this.pendingTrainingBuildSelections.has(discipline)) {
      return this.pendingTrainingBuildSelections.get(discipline) || null;
    }
    const selection = this.trainingSettings.buildBenchmarks?.[discipline] || null;
    return getTrainingBuildBenchmarkSelectionKey(selection) ? selection : null;
  }

  private resolveCurrentUtcDayMs(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  private resolveTrainingBuildCardState(
    discipline: DerivedTrainingDiscipline,
    source: DashboardTrainingBuildComparisonDiscipline | null,
    expectedSelection: TrainingBuildBenchmarkSelection | null,
  ): TrainingBuildCardState {
    const pending = this.pendingTrainingBuildSelections.has(discipline);
    const expectedKey = getTrainingBuildBenchmarkSelectionKey(expectedSelection);
    const snapshotMatchesExpected = expectedKey
      ? source?.selection?.selectionKey === expectedKey && source.status === 'ready'
      : source?.status === 'not-configured' && this.derivedState.trainingBuildComparisonStatus === 'ready';
    if (pending && snapshotMatchesExpected) {
      this.pendingTrainingBuildSelections.delete(discipline);
    }
    if (pending && !snapshotMatchesExpected) {
      return 'updating';
    }
    if (!expectedSelection) {
      return 'not-configured';
    }
    if (this.derivedState.trainingBuildComparisonStatus === 'failed') {
      return 'unavailable';
    }
    if (
      this.derivedState.trainingBuildComparisonStatus === 'missing'
      || this.derivedState.trainingBuildComparisonStatus === 'queued'
      || this.derivedState.trainingBuildComparisonStatus === 'processing'
      || this.derivedState.trainingBuildComparisonStatus === 'building'
      || this.derivedState.trainingBuildComparisonStatus === 'stale'
      || !source
    ) {
      return 'updating';
    }
    if (source.status === 'invalid-selection') {
      return 'invalid';
    }
    return snapshotMatchesExpected ? 'ready' : 'updating';
  }

  private buildTrainingStatus(
    analysis: TrainingAnalysis,
    comparisonState: TrainingComparisonState,
    isStateUpdating: boolean,
    stateInfo: TrainingStateInfo,
  ): TrainingStatusViewModel {
    const currentState = {
      stateLabel: analysis.state.label || 'Awaiting data',
      stateCaption: analysis.state.caption || 'No current load signals',
      stateInfo,
      stateUpdateText: isStateUpdating
        ? (analysis.state.label ? 'Updating from the latest completed TSS calculation…' : 'Calculating current TSS state…')
        : null,
      volumeDeltaPercent: analysis.duration.deltaPercent,
      sessionsDeltaPercent: analysis.activities.deltaPercent,
    };
    if (comparisonState === 'preparing') {
      return {
        ...currentState,
        volumeText: '--',
        volumeCaption: 'Preparing your training comparison…',
        sessionsText: '--',
        sessionsCaption: 'Preparing your training comparison…',
      };
    }
    if (comparisonState === 'unavailable') {
      return {
        ...currentState,
        volumeText: '--',
        volumeCaption: 'Training comparison unavailable',
        sessionsText: '--',
        sessionsCaption: 'Training comparison unavailable',
      };
    }
    if (comparisonState === 'updating') {
      return {
        ...currentState,
        volumeText: analysis.duration.current > 0 ? formatSleepDuration(analysis.duration.current) : '0h',
        volumeCaption: 'Updating your training comparison…',
        sessionsText: `${this.formatNumber(analysis.activities.current, 0)} workouts`,
        sessionsCaption: 'Updating your training comparison…',
      };
    }
    if (comparisonState === 'empty') {
      return {
        ...currentState,
        volumeText: '0h',
        volumeCaption: 'No eligible Training workouts in the last 28 days',
        sessionsText: '0 workouts',
        sessionsCaption: 'No eligible Training workouts in the last 28 days',
      };
    }
    return {
      ...currentState,
      volumeText: analysis.duration.current > 0 ? formatSleepDuration(analysis.duration.current) : '0h',
      volumeCaption: this.formatVolumeComparison(analysis.duration),
      sessionsText: `${this.formatNumber(analysis.activities.current, 0)} workouts`,
      sessionsCaption: this.formatSessionsComparison(analysis.activities),
    };
  }

  private formatVolumeComparison(comparison: TrainingWindowComparison): string {
    if (comparison.deltaPercent === null) {
      return comparison.current > 0 ? 'Baseline builds with more history' : 'No baseline comparison yet';
    }
    if (Math.abs(comparison.deltaPercent) < 10) {
      return 'In line with your usual 28 days';
    }
    const direction = comparison.deltaPercent > 0 ? 'above' : 'below';
    return `${this.formatNumber(Math.abs(comparison.deltaPercent), 0)}% ${direction} your usual 28 days`;
  }

  private formatSessionsComparison(comparison: TrainingWindowComparison): string {
    if (comparison.baseline <= 0) {
      return comparison.current > 0 ? 'Baseline builds with more history' : 'No baseline comparison yet';
    }
    if (Math.abs(comparison.delta) < 2) {
      return 'In line with your usual 28 days';
    }
    const direction = comparison.delta > 0 ? 'more' : 'fewer';
    return `${this.formatNumber(Math.abs(comparison.delta), 0)} ${direction} than usual`;
  }

}

function resolveTrainingZoneSeconds(
  summary: DashboardTrainingDisciplineSummary['current28d'],
): number {
  return summary.easySeconds + summary.moderateSeconds + summary.hardSeconds;
}

function resolveTrainingZonePercentage(seconds: number, totalSeconds: number): number | null {
  if (!Number.isFinite(seconds) || !Number.isFinite(totalSeconds) || seconds < 0 || totalSeconds <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, (seconds / totalSeconds) * 100));
}
